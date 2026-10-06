"use strict";

// One configured-MCP stdio exchange: start the server, initialize, send one
// request, return its result, and reap the process. The host runs this for
// servers local to it; an environment's executor runs the same code natively
// behind `mcp/request` for servers that live there. Trust, freshness, scope,
// and the result envelope stay with the host (configured-mcp-adapter.js).

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

module.exports = {
  DEFAULT_MCP_TIMEOUT_MS,
  MAX_MCP_RESULT_BYTES,
  MAX_MCP_TIMEOUT_MS,
  lineOrContentLengthParser,
  mcpServerEnvironment,
  requestMcpStdio,
};
