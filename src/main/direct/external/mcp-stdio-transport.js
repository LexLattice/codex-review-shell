"use strict";

// Configured-MCP stdio transport. McpSessionPool keeps initialized servers
// for reuse (below); requestMcpStdio is the one-shot form (start,
// initialize, one request, reap). The host runs this for servers local to
// it; an environment's executor runs the same code natively behind
// `mcp/request` for servers that live there. Trust, freshness, scope, and the
// result envelope stay with the host (configured-mcp-adapter.js).

const { spawn } = require("node:child_process");
const { BASE_COMMAND_ENVIRONMENT_KEYS } = require("../tools/exec-process-backends");

const MAX_MCP_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_MCP_HEADER_BYTES = 64 * 1024;
const DEFAULT_MCP_TIMEOUT_MS = 15_000;
const MAX_MCP_TIMEOUT_MS = 60_000;
const MCP_CHILD_TERM_GRACE_MS = 200;
const MCP_CHILD_CLEANUP_DEADLINE_MS = 2_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, maxLength = 320) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function mcpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * The server's environment: the variables any process needs to start
 * (PATH, HOME, SystemRoot, ...) plus the names the config allowlists, all
 * read from the environment the server runs in. Nothing else crosses.
 */
function mcpServerEnvironment(processEnvNames = [], sourceEnv = process.env) {
  const env = {};
  for (const key of [...BASE_COMMAND_ENVIRONMENT_KEYS, ...processEnvNames]) {
    if (typeof key === "string" && sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  return env;
}

function lineOrContentLengthParser(onMessage, onError) {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = (error) => {
    if (failed) return;
    failed = true;
    onError(error);
  };
  const contentLengthPrefix = "content-length";
  const startsWithContentLengthPrefix = () => {
    const prefixLength = Math.min(buffer.length, contentLengthPrefix.length);
    if (!prefixLength) return false;
    return buffer.toString("ascii", 0, prefixLength).toLowerCase() === contentLengthPrefix.slice(0, prefixLength);
  };
  return (chunk) => {
    if (failed) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    if (buffer.length > MAX_MCP_RESULT_BYTES) {
      fail(mcpError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
      return;
    }
    while (buffer.length) {
      if (startsWithContentLengthPrefix() && buffer.length > MAX_MCP_HEADER_BYTES) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0 || headerEnd > MAX_MCP_HEADER_BYTES) {
          fail(mcpError("direct_mcp_invalid_frame", "Configured MCP returned an oversized content-length header."));
          return;
        }
      }
      const separator = buffer.indexOf("\r\n\r\n");
      if (startsWithContentLengthPrefix()) {
        const firstNewline = buffer.indexOf("\n");
        if (firstNewline >= 0 && buffer[firstNewline - 1] !== 13) {
          fail(mcpError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
          return;
        }
        const headerLineEnd = buffer.indexOf("\r\n");
        if (headerLineEnd >= 0) {
          const firstLine = buffer.toString("utf8", 0, headerLineEnd);
          const declaredMatch = firstLine.match(/^content-length\s*:\s*(\d+)\s*$/i);
          if (!declaredMatch) {
            fail(mcpError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
            return;
          }
          const declaredLength = Number(declaredMatch[1]);
          if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_MCP_RESULT_BYTES) {
            fail(mcpError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
            return;
          }
        }
        if (separator < 0) return;
        const header = buffer.toString("utf8", 0, separator);
        const match = header.match(/^content-length\s*:\s*(\d+)\s*(?:\r\n|$)/i);
        if (!match) {
          fail(mcpError("direct_mcp_invalid_frame", "Configured MCP returned an invalid content-length frame."));
          return;
        }
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length > MAX_MCP_RESULT_BYTES) {
          fail(mcpError("direct_mcp_result_too_large", "Configured MCP result exceeded the bounded output limit."));
          return;
        }
        const start = separator + 4;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString("utf8");
        buffer = buffer.subarray(start + length);
        try { onMessage(JSON.parse(body)); } catch { fail(mcpError("direct_mcp_invalid_json", "Configured MCP returned invalid JSON.")); }
        continue;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch { fail(mcpError("direct_mcp_invalid_json", "Configured MCP returned invalid JSON.")); }
    }
  };
}

/**
 * Runs one request against a stdio MCP server. `options.spawnProcess`
 * (command, args, { cwd, env }) -> ChildProcess lets each placement start the
 * server under its own containment; `options.env` defaults to
 * mcpServerEnvironment(server.processEnv).
 */
function requestMcpStdio(server, method, params = {}, options = {}) {
  if (!server.command) return Promise.reject(mcpError("direct_mcp_transport_unavailable", "The configured MCP server has no local transport command."));
  if (server.transportKind !== "stdio") return Promise.reject(mcpError("direct_mcp_transport_unsupported", "The configured MCP transport is not supported by Direct."));
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 100, MAX_MCP_TIMEOUT_MS);
  const signal = options.signal;
  const spawnProcess = typeof options.spawnProcess === "function"
    ? options.spawnProcess
    : (command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const env = isPlainObject(options.env) ? options.env : mcpServerEnvironment(server.processEnv || []);
  return new Promise((resolve, reject) => {
    let settled = false;
    let finishing = false;
    let timer = null;
    let child = null;
    let childExited = false;
    let resolveChildExit;
    const childExit = new Promise((resolveExit) => { resolveChildExit = resolveExit; });
    const isChildLive = () => Boolean(child && !childExited && child.exitCode === null && child.signalCode === null);
    const markChildExited = () => {
      if (childExited) return;
      childExited = true;
      resolveChildExit();
    };
    const waitForChildExit = async (durationMs) => {
      if (!isChildLive()) return true;
      let timeout;
      await Promise.race([
        childExit,
        new Promise((resolveExit) => { timeout = setTimeout(resolveExit, durationMs); }),
      ]);
      if (timeout) clearTimeout(timeout);
      return !isChildLive();
    };
    const cleanupChild = async () => {
      if (!child || childExited) return true;
      const cleanupDeadline = Date.now() + MCP_CHILD_CLEANUP_DEADLINE_MS;
      if (isChildLive()) {
        try { child.kill("SIGTERM"); } catch {}
        await waitForChildExit(Math.min(MCP_CHILD_TERM_GRACE_MS, Math.max(0, cleanupDeadline - Date.now())));
      }
      if (isChildLive()) {
        try { child.kill("SIGKILL"); } catch {}
        await waitForChildExit(Math.max(0, cleanupDeadline - Date.now()));
      }
      return !isChildLive();
    };
    const finish = (error, result) => {
      if (settled || finishing) return;
      finishing = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (signal) signal.removeEventListener?.("abort", abort);
      child?.stdin?.destroy?.();
      child?.stdout?.removeListener?.("data", parser);
      child?.stderr?.removeListener?.("data", onStderr);
      void (async () => {
        const reaped = await cleanupChild();
        const cleanupError = reaped ? null : mcpError("direct_mcp_cleanup_timeout", "Configured MCP process cleanup did not complete within the bounded deadline.");
        settled = true;
        child?.removeListener?.("error", onChildError);
        child?.removeListener?.("exit", onChildExit);
        child?.removeListener?.("close", onChildClose);
        const finalError = error || cleanupError;
        if (finalError) reject(finalError);
        else resolve(result);
      })();
    };
    const abort = () => finish(mcpError("direct_mcp_request_aborted", "Configured MCP request was cancelled."));
    const send = (request) => {
      if (finishing || !child?.stdin?.writable) return finish(mcpError("direct_mcp_transport_closed", "Configured MCP transport closed before the response."));
      child.stdin.write(`${JSON.stringify(request)}\n`);
    };
    let phase = "initialize";
    let activeRequestId = 1;
    const parser = lineOrContentLengthParser((message) => {
      if (finishing || !isPlainObject(message)) return;
      if (message.method && !String(message.method).startsWith("notifications/")) {
        return finish(mcpError("mcp_elicitation_owner_required", "Configured MCP requested owner-controlled interaction."));
      }
      if (Number(message.id) !== activeRequestId) return;
      if (message.error) return finish(mcpError("direct_mcp_rpc_error", boundedString(message.error.message, 360) || "Configured MCP returned an error."));
      if (phase === "initialize") {
        phase = "request";
        activeRequestId = 2;
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({ jsonrpc: "2.0", id: activeRequestId, method, params });
        return;
      }
      finish(null, message.result || {});
    }, (error) => finish(error));
    const onStderr = (chunk) => {
      if (String(chunk).length > MAX_MCP_RESULT_BYTES) finish(mcpError("direct_mcp_result_too_large", "Configured MCP stderr exceeded the bounded output limit."));
    };
    const onChildError = (error) => finish(error);
    const onChildExit = (code, signalName) => {
      markChildExited();
      if (!settled) finish(mcpError("direct_mcp_transport_exited", `Configured MCP exited before completing the request (${code ?? signalName ?? "unknown"}).`));
    };
    const onChildClose = () => markChildExited();
    try {
      child = spawnProcess(server.command, server.args || [], { cwd: server.cwd || undefined, env });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout?.on("data", parser);
    child.stderr?.on("data", onStderr);
    child.once("error", onChildError);
    child.once("exit", onChildExit);
    child.once("close", onChildClose);
    timer = setTimeout(() => finish(mcpError("direct_mcp_request_timeout", "Configured MCP request exceeded the timeout.")), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    send({ jsonrpc: "2.0", id: activeRequestId, method: "initialize", params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-direct", version: "1" },
    }});
  });
}

// Long-lived sessions, as Codex keeps its MCP connections: one initialized
// server per (placement, command, args, cwd, environment), reused across
// requests (concurrent ones share it), closed after a quiet period, on a
// config change for the same server, or when the pool is disposed. The pool
// lives where the server runs (the host for its own servers, an executor for
// servers in its environment), so a lost executor takes its servers with it.
// Trust, freshness, and scope are still checked by the host on every
// operation before a request reaches here.
const MCP_SESSION_IDLE_MS = 10 * 60_000;
const MCP_SESSION_MAX = 16;

function setChildReferenced(child, referenced) {
  for (const target of [child, child?.stdin, child?.stdout, child?.stderr]) {
    try {
      if (referenced) target?.ref?.();
      else target?.unref?.();
    } catch {}
  }
}

class McpStdioSession {
  constructor(pool, key, identityKey, server, options) {
    this.pool = pool;
    this.key = key;
    this.identityKey = identityKey;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.idleTimer = null;
    this.lastUsedAt = Date.now();
    this.child = options.spawnProcess(server.command, server.args || [], { cwd: server.cwd || undefined, env: options.env });
    this.exited = new Promise((resolve) => { this.resolveExited = resolve; });
    const parser = lineOrContentLengthParser((message) => this.onMessage(message), (error) => this.close(error));
    this.child.stdout?.on("data", parser);
    this.child.stderr?.on("data", (chunk) => {
      if (String(chunk).length > MAX_MCP_RESULT_BYTES) this.close(mcpError("direct_mcp_result_too_large", "Configured MCP stderr exceeded the bounded output limit."));
    });
    this.child.once("error", (error) => this.close(error));
    this.child.once("exit", (code, signalName) => {
      this.resolveExited();
      this.close(mcpError("direct_mcp_transport_exited", `Configured MCP exited (${code ?? signalName ?? "unknown"}).`));
    });
    this.child.once("close", () => this.resolveExited());
    this.ready = this.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-direct", version: "1" },
    }, { timeoutMs: options.timeoutMs }).then((result) => {
      this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      return result;
    });
    // A failed start is reported by the request that waits on it; the next
    // request starts a fresh server.
    this.ready.catch((error) => this.close(error));
  }

  get pid() {
    return this.child?.pid;
  }

  write(message) {
    if (this.closed || !this.child?.stdin?.writable) return false;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  call(method, params = {}, options = {}) {
    if (this.closed) return Promise.reject(mcpError("direct_mcp_transport_closed", "Configured MCP transport closed before the response."));
    const id = ++this.nextId;
    const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 100, MAX_MCP_TIMEOUT_MS);
    const signal = options.signal;
    clearTimeout(this.idleTimer);
    if (this.pending.size === 0) setChildReferenced(this.child, true);
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null, onAbort: null };
      const settle = () => {
        clearTimeout(entry.timer);
        if (signal && entry.onAbort) signal.removeEventListener?.("abort", entry.onAbort);
        this.pending.delete(id);
        this.lastUsedAt = Date.now();
        if (!this.pending.size) this.idle();
      };
      entry.resolve = (value) => { settle(); resolve(value); };
      entry.reject = (error) => { settle(); reject(error); };
      // A request that never answers may mean a wedged server: replace it.
      entry.timer = setTimeout(() => {
        entry.reject(mcpError("direct_mcp_request_timeout", "Configured MCP request exceeded the timeout."));
        this.close(mcpError("direct_mcp_request_timeout", "Configured MCP request exceeded the timeout."));
      }, timeoutMs);
      if (signal) {
        if (signal.aborted) {
          entry.reject(mcpError("direct_mcp_request_aborted", "Configured MCP request was cancelled."));
          return;
        }
        entry.onAbort = () => {
          // The server keeps running for other requests; it is told to stop.
          this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "cancelled by Direct" } });
          entry.reject(mcpError("direct_mcp_request_aborted", "Configured MCP request was cancelled."));
        };
        signal.addEventListener?.("abort", entry.onAbort, { once: true });
      }
      this.pending.set(id, entry);
      if (!this.write({ jsonrpc: "2.0", id, method, params })) {
        entry.reject(mcpError("direct_mcp_transport_closed", "Configured MCP transport closed before the response."));
      }
    });
  }

  onMessage(message) {
    if (this.closed || !isPlainObject(message)) return;
    if (message.method) {
      if (String(message.method).startsWith("notifications/")) return;
      // Server-initiated requests (elicitation, sampling, roots) need the
      // owner; Direct answers with an error and fails what is in flight.
      if (message.id !== undefined) {
        this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Direct does not answer server requests; owner interaction is required." } });
      }
      for (const entry of [...this.pending.values()]) {
        entry.reject(mcpError("mcp_elicitation_owner_required", "Configured MCP requested owner-controlled interaction."));
      }
      return;
    }
    const entry = this.pending.get(Number(message.id));
    if (!entry) return;
    if (message.error) entry.reject(mcpError("direct_mcp_rpc_error", boundedString(message.error.message, 360) || "Configured MCP returned an error."));
    else entry.resolve(isPlainObject(message.result) ? message.result : {});
  }

  idle() {
    // An idle server neither keeps this process alive nor runs forever.
    setChildReferenced(this.child, false);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(null), this.pool.idleMs);
    this.idleTimer.unref?.();
  }

  close(error) {
    if (this.closed) return this.exited;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.pool.forget(this);
    const failure = error || mcpError("direct_mcp_transport_closed", "Configured MCP session closed.");
    for (const entry of [...this.pending.values()]) entry.reject(failure);
    try { this.child.stdin?.destroy?.(); } catch {}
    const child = this.child;
    const live = () => child && child.exitCode === null && child.signalCode === null;
    if (live()) {
      setChildReferenced(child, true);
      try { child.kill("SIGTERM"); } catch {}
      const kill = setTimeout(() => { if (live()) { try { child.kill("SIGKILL"); } catch {} } }, MCP_CHILD_TERM_GRACE_MS);
      kill.unref?.();
      const giveUp = setTimeout(() => this.resolveExited(), MCP_CHILD_CLEANUP_DEADLINE_MS);
      giveUp.unref?.();
    } else {
      this.resolveExited();
    }
    return this.exited;
  }
}

class McpSessionPool {
  constructor(options = {}) {
    this.sessions = new Map();
    this.idleMs = Number(options.idleMs) > 0 ? Number(options.idleMs) : MCP_SESSION_IDLE_MS;
    this.maxSessions = Number(options.maxSessions) > 0 ? Number(options.maxSessions) : MCP_SESSION_MAX;
    this.started = 0;
  }

  static keyFor(server, options = {}) {
    const env = isPlainObject(options.env) ? Object.entries(options.env).sort(([a], [b]) => a.localeCompare(b)) : [];
    return JSON.stringify([
      String(options.placementKey || ""),
      server.command,
      server.args || [],
      server.cwd || "",
      env,
    ]);
  }

  sessionFor(server, options) {
    const key = McpSessionPool.keyFor(server, options);
    const existing = this.sessions.get(key);
    if (existing && !existing.closed) {
      // Most recently used last, for eviction.
      this.sessions.delete(key);
      this.sessions.set(key, existing);
      return existing;
    }
    const identityKey = options.identityKey ? `${options.placementKey || ""}::${options.identityKey}` : "";
    if (identityKey) {
      // The same server with a changed config: the old process goes.
      for (const session of [...this.sessions.values()]) {
        if (session.identityKey === identityKey) session.close(null);
      }
    }
    while (this.sessions.size >= this.maxSessions) {
      const [, oldest] = this.sessions.entries().next().value;
      oldest.close(null);
    }
    const session = new McpStdioSession(this, key, identityKey, server, options);
    this.sessions.set(key, session);
    this.started += 1;
    return session;
  }

  forget(session) {
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
  }

  async request(server, method, params = {}, options = {}) {
    if (!server.command) throw mcpError("direct_mcp_transport_unavailable", "The configured MCP server has no local transport command.");
    if (server.transportKind !== "stdio") throw mcpError("direct_mcp_transport_unsupported", "The configured MCP transport is not supported by Direct.");
    if (options.signal?.aborted) throw mcpError("direct_mcp_request_aborted", "Configured MCP request was cancelled.");
    const spawnProcess = typeof options.spawnProcess === "function"
      ? options.spawnProcess
      : (command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const env = isPlainObject(options.env) ? options.env : mcpServerEnvironment(server.processEnv || []);
    const session = this.sessionFor(server, { ...options, spawnProcess, env });
    await session.ready;
    return session.call(method, params, { timeoutMs: options.timeoutMs, signal: options.signal });
  }

  async dispose() {
    await Promise.all([...this.sessions.values()].map((session) => session.close(null)));
  }
}

module.exports = {
  DEFAULT_MCP_TIMEOUT_MS,
  MAX_MCP_RESULT_BYTES,
  MAX_MCP_TIMEOUT_MS,
  MCP_SESSION_IDLE_MS,
  McpSessionPool,
  lineOrContentLengthParser,
  mcpServerEnvironment,
  requestMcpStdio,
};
