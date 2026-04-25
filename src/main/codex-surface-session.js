"use strict";

const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const WebSocket = require("ws");
const {
  SUPPORTED_SERVER_REQUEST_METHODS: SUPPORTED_SERVER_REQUEST_METHOD_LIST,
  AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS: AUTO_UNSUPPORTED_SERVER_REQUEST_METHOD_LIST,
} = require("./codex-app-server-protocol");

const DEFAULT_RPC_REQUEST_TIMEOUT_MS = 60_000;
const OVERLOAD_RETRY_CODE = -32001;
const OVERLOAD_RETRY_ATTEMPTS = 3;
const OVERLOAD_RETRY_BASE_MS = 250;
const MAX_BEARER_TOKEN_FILE_BYTES = 16 * 1024;

const SUPPORTED_SERVER_REQUEST_METHODS = new Set(SUPPORTED_SERVER_REQUEST_METHOD_LIST);
const AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS = new Set(AUTO_UNSUPPORTED_SERVER_REQUEST_METHOD_LIST);

const HARD_TIMEOUT_MS_BY_METHOD = new Map([
  ["account/chatgptAuthTokens/refresh", 9_000],
  ["item/tool/call", 0],
  ["item/commandExecution/requestApproval", 30 * 60_000],
  ["item/fileChange/requestApproval", 30 * 60_000],
  ["item/tool/requestUserInput", 30 * 60_000],
  ["mcpServer/elicitation/request", 30 * 60_000],
  ["item/permissions/requestApproval", 30 * 60_000],
  ["applyPatchApproval", 30 * 60_000],
  ["execCommandApproval", 30 * 60_000],
]);

function toErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function hasJsonRpcId(message) {
  return message && message.id !== undefined && message.id !== null;
}

function makeJsonRpcError(code, message, data) {
  return {
    code: Number.isFinite(Number(code)) ? Number(code) : -32000,
    message: String(message || "Codex app-server request failed."),
    ...(data === undefined ? {} : { data }),
  };
}

function jsonRpcErrorToError(error) {
  const wrapped = new Error(error?.message || JSON.stringify(error || {}));
  if (error && Number.isFinite(Number(error.code))) wrapped.code = Number(error.code);
  if (error?.data !== undefined) wrapped.data = error.data;
  return wrapped;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function jitteredBackoff(attempt) {
  const base = OVERLOAD_RETRY_BASE_MS * 2 ** Math.max(0, attempt);
  return base + Math.floor(Math.random() * Math.min(base, 400));
}

function compactValue(value, maxLength = 220) {
  if (value == null) return "";
  if (typeof value === "string") return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  try {
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function normalizeAuthMode(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["none", "bearer-token-file", "bearer-token-env"].includes(candidate) ? candidate : "none";
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function isSafeBearerUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol === "wss:") return true;
    if (parsed.protocol === "ws:" && isLoopbackHost(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

async function resolveBearerAuth(connection) {
  const auth = connection?.remoteAuth || connection?.auth || {};
  const mode = normalizeAuthMode(auth.mode);
  if (mode === "none") return { headers: undefined, metadata: { mode: "none" } };
  if (!isSafeBearerUrl(connection?.wsUrl)) {
    throw new Error("Bearer auth is only allowed for wss:// or loopback ws:// Codex app-server URLs.");
  }

  let token = "";
  if (mode === "bearer-token-file") {
    const tokenFilePath = String(auth.tokenFilePath || "").trim();
    if (!tokenFilePath) throw new Error("Bearer token file path is missing.");
    const stats = await fs.stat(tokenFilePath);
    if (!stats.isFile()) throw new Error("Bearer token path must point to a regular file.");
    if (stats.size > MAX_BEARER_TOKEN_FILE_BYTES) {
      throw new Error(`Bearer token file is too large. Limit is ${MAX_BEARER_TOKEN_FILE_BYTES} bytes.`);
    }
    token = (await fs.readFile(tokenFilePath, "utf8")).trim();
  } else if (mode === "bearer-token-env") {
    const tokenEnvVar = String(auth.tokenEnvVar || "").trim();
    if (!tokenEnvVar) throw new Error("Bearer token environment variable is missing.");
    token = String(process.env[tokenEnvVar] || "").trim();
  }
  if (!token) throw new Error("Bearer token source is empty.");

  return {
    headers: { Authorization: `Bearer ${token}` },
    metadata: {
      mode,
      serverAuthScheme: String(auth.serverAuthScheme || "unknown"),
      tokenSource: mode === "bearer-token-file" ? "file" : "env",
    },
  };
}

function extractThreadId(method, params) {
  return String(params?.threadId || params?.conversationId || "");
}

function extractTurnId(_method, params) {
  return String(params?.turnId || "");
}

function extractItemId(method, params) {
  if (params?.itemId) return String(params.itemId);
  if (method === "applyPatchApproval") return String(params?.callId || "");
  if (method === "execCommandApproval") return String(params?.callId || "");
  return "";
}

function classifyRisk(method, params) {
  if (method === "item/commandExecution/requestApproval") return params?.networkApprovalContext ? "network" : "command";
  if (method === "execCommandApproval") return "command";
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "file-change";
  if (method === "item/tool/requestUserInput") return "user-input";
  if (method === "mcpServer/elicitation/request") return "mcp";
  if (method === "item/permissions/requestApproval") return "permission";
  if (method === "item/tool/call") return "dynamic-tool";
  if (method === "account/chatgptAuthTokens/refresh") return "auth";
  return SUPPORTED_SERVER_REQUEST_METHODS.has(method) ? "legacy" : "unknown";
}

function requestTitle(method, params) {
  if (method === "item/commandExecution/requestApproval") {
    if (params?.networkApprovalContext) return "Network access approval";
    return "Command approval";
  }
  if (method === "execCommandApproval") return "Legacy command approval";
  if (method === "item/fileChange/requestApproval") return "File change approval";
  if (method === "applyPatchApproval") return "Legacy patch approval";
  if (method === "item/tool/requestUserInput") return "Tool user input";
  if (method === "mcpServer/elicitation/request") return "MCP elicitation";
  if (method === "item/permissions/requestApproval") return "Permission approval";
  if (method === "item/tool/call") return "Dynamic tool call";
  if (method === "account/chatgptAuthTokens/refresh") return "ChatGPT auth token refresh";
  return "Unknown Codex request";
}

function summarizeRequest(method, params) {
  if (method === "item/commandExecution/requestApproval") {
    if (params?.networkApprovalContext) {
      const context = params.networkApprovalContext;
      return `${context.protocol || "network"}://${context.host || "unknown host"}`;
    }
    return compactValue(params?.command || params?.reason || "Command approval requested.", 180);
  }
  if (method === "execCommandApproval") {
    return compactValue(Array.isArray(params?.command) ? params.command.join(" ") : params?.command || params?.reason, 180);
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    return compactValue(params?.reason || params?.grantRoot || "File change approval requested.", 180);
  }
  if (method === "item/tool/requestUserInput") {
    const first = Array.isArray(params?.questions) ? params.questions[0] : null;
    return compactValue(first?.question || first?.header || "Tool input requested.", 180);
  }
  if (method === "mcpServer/elicitation/request") {
    return compactValue(params?.message || params?.url || params?.serverName || "MCP elicitation requested.", 180);
  }
  if (method === "item/permissions/requestApproval") {
    return compactValue(params?.reason || "Additional permissions requested.", 180);
  }
  return compactValue(params, 180);
}

function summarizeResponse(result) {
  if (result?.decision !== undefined) return `decision=${compactValue(result.decision, 80)}`;
  if (result?.action !== undefined) return `action=${compactValue(result.action, 80)}`;
  if (result?.scope !== undefined) return `scope=${compactValue(result.scope, 80)}`;
  if (result?.answers !== undefined) return "answers submitted";
  return compactValue(result, 120);
}

function statusFromResult(result) {
  const decision = result?.decision;
  const action = result?.action;
  if (decision === "decline" || decision === "denied") return "declined";
  if (decision === "cancel" || decision === "abort" || action === "cancel") return "canceled";
  if (action === "decline") return "declined";
  return "responding";
}

function timeoutResultFor(method) {
  if (method === "item/commandExecution/requestApproval") return { result: { decision: "decline" } };
  if (method === "item/fileChange/requestApproval") return { result: { decision: "decline" } };
  if (method === "item/permissions/requestApproval") return { result: { permissions: {}, scope: "turn" } };
  if (method === "applyPatchApproval" || method === "execCommandApproval") return { result: { decision: "timed_out" } };
  if (method === "mcpServer/elicitation/request") return { result: { action: "cancel", content: null, _meta: null } };
  return { error: makeJsonRpcError(-32000, "Timed out waiting for user response.") };
}

class CodexSurfaceSession extends EventEmitter {
  constructor(webContents) {
    super();
    this.webContents = webContents;
    this.socket = null;
    this.connection = null;
    this.connectionId = "";
    this.nextId = 0;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.lastError = "";
    this.disposing = false;
    this.requestTimeoutMs = Number.isFinite(Number(process.env.CODEX_SURFACE_RPC_TIMEOUT_MS))
      ? Math.max(5_000, Math.min(Number(process.env.CODEX_SURFACE_RPC_TIMEOUT_MS), 5 * 60_000))
      : DEFAULT_RPC_REQUEST_TIMEOUT_MS;
  }

  sendEvent(payload) {
    this.emit("event", payload);
    if (!this.webContents || this.webContents.isDestroyed()) return;
    this.webContents.send("codex-surface:event", payload);
  }

  emitStatus(status, extra = {}) {
    this.sendEvent({
      type: "connection-status",
      status,
      error: extra.error || "",
      connection: this.connection,
      connectionId: this.connectionId,
    });
  }

  requestKey(requestId) {
    return `${this.connectionId}:${String(requestId)}`;
  }

  publicRequestRecord(record) {
    if (!record) return null;
    return {
      key: record.key,
      connectionId: record.connectionId,
      requestId: record.requestId,
      method: record.method,
      params: record.params,
      projectId: record.projectId || "",
      threadId: record.threadId || "",
      turnId: record.turnId || "",
      itemId: record.itemId || "",
      surfaceConnectionId: record.surfaceConnectionId || "",
      riskCategory: record.riskCategory,
      status: record.status,
      title: record.title,
      summary: record.summary,
      receivedAt: record.receivedAt,
      respondedAt: record.respondedAt || "",
      resolvedAt: record.resolvedAt || "",
      timeoutAt: record.timeoutAt || "",
      responseSummary: record.responseSummary || "",
      errorSummary: record.errorSummary || "",
    };
  }

  emitRequestEvent(record, type = "rpc-request") {
    const request = this.publicRequestRecord(record);
    if (!request) return;
    this.sendEvent({
      type,
      ...request,
      request,
    });
  }

  clearServerRequestTimers(record) {
    if (!record) return;
    if (record.hardTimer) clearTimeout(record.hardTimer);
    record.hardTimer = null;
  }

  rejectPending(message) {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  closeServerRequests(message) {
    for (const record of this.serverRequests.values()) {
      this.clearServerRequestTimers(record);
      record.status = "connection-closed";
      record.errorSummary = message;
      record.resolvedAt = new Date().toISOString();
      this.emitRequestEvent(record, "rpc-request-updated");
    }
    this.serverRequests.clear();
  }

  async connect(connection) {
    const nextWsUrl = String(connection?.wsUrl || "").trim();
    if (!nextWsUrl) throw new Error("No Codex app-server connection URL was provided.");
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.connection?.wsUrl === nextWsUrl) {
      this.replayPendingServerRequests();
      return { connected: true, connection: this.connection, connectionId: this.connectionId };
    }

    await this.dispose({ silent: true });

    const auth = await resolveBearerAuth(connection);
    this.connectionId = crypto.randomUUID();
    this.connection = {
      ...connection,
      transport: "websocket",
      connectionId: this.connectionId,
      remoteAuth: auth.metadata,
    };
    this.disposing = false;
    this.emitStatus("connecting");

    await new Promise((resolve, reject) => {
      const socket = auth.headers ? new WebSocket(nextWsUrl, { headers: auth.headers }) : new WebSocket(nextWsUrl);
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      socket.once("open", () => {
        this.socket = socket;
        this.lastError = "";
        this.emitStatus("connected");
        finish();
      });

      socket.on("message", (data) => {
        try {
          const message = JSON.parse(String(data || ""));
          if (!message.method && hasJsonRpcId(message) && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (pending.timer) clearTimeout(pending.timer);
            if (message.error) pending.reject(jsonRpcErrorToError(message.error));
            else pending.resolve(message.result);
            return;
          }

          if (message.method && hasJsonRpcId(message)) {
            this.handleServerRequest(message);
            return;
          }

          if (message.method) {
            this.handleServerNotification(message.method, message.params || {});
          }
        } catch (error) {
          this.sendEvent({ type: "protocol-error", error: toErrorMessage(error, "Invalid Codex RPC payload.") });
        }
      });

      socket.once("error", () => {
        if (this.disposing) return;
        this.lastError = "Codex app-server connection failed.";
        this.emitStatus("error", { error: this.lastError });
        if (socket !== this.socket) finish(new Error(this.lastError));
      });

      socket.once("close", () => {
        if (this.disposing) return;
        const message = this.lastError || "Codex app-server connection closed.";
        this.rejectPending(message);
        this.closeServerRequests(message);
        if (this.socket === socket) this.socket = null;
        this.emitStatus("disconnected", { error: message });
        if (!settled) finish(new Error(message));
      });
    });

    return { connected: true, connection: this.connection, connectionId: this.connectionId };
  }

  replayPendingServerRequests() {
    for (const record of this.serverRequests.values()) {
      if (record.status === "pending" || record.status === "responding") this.emitRequestEvent(record, "rpc-request");
    }
  }

  handleServerNotification(method, params) {
    if (method === "serverRequest/resolved") {
      this.resolveServerRequest(params);
    }
    this.sendEvent({ type: "rpc-notification", method, params: params || {} });
  }

  handleServerRequest(message) {
    const method = String(message.method || "");
    const params = message.params || {};
    const key = this.requestKey(message.id);
    const now = new Date().toISOString();
    const record = {
      key,
      connectionId: this.connectionId,
      requestId: message.id,
      method,
      params,
      projectId: String(this.connection?.projectId || ""),
      threadId: extractThreadId(method, params),
      turnId: extractTurnId(method, params),
      itemId: extractItemId(method, params),
      surfaceConnectionId: this.connectionId,
      riskCategory: classifyRisk(method, params),
      status: "pending",
      title: requestTitle(method, params),
      summary: summarizeRequest(method, params),
      receivedAt: now,
      hardTimer: null,
    };
    this.serverRequests.set(key, record);
    this.emitRequestEvent(record, "rpc-request");

    if (AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS.has(method)) {
      const reason = method === "account/chatgptAuthTokens/refresh"
        ? "Externally managed ChatGPT auth token refresh is not configured in codex-review-shell."
        : "Dynamic client-side tool calls are not supported by codex-review-shell v0.";
      queueMicrotask(() => {
        this.sendServerRequestError(key, makeJsonRpcError(-32601, reason)).catch(() => {});
      });
      return;
    }

    if (!SUPPORTED_SERVER_REQUEST_METHODS.has(method)) {
      queueMicrotask(() => {
        this.sendServerRequestError(key, makeJsonRpcError(-32601, `Unsupported Codex server request method: ${method}`)).catch(() => {});
      });
      return;
    }

    const hardTimeoutMs = HARD_TIMEOUT_MS_BY_METHOD.get(method);
    if (Number.isFinite(hardTimeoutMs) && hardTimeoutMs >= 0) {
      record.timeoutAt = new Date(Date.now() + hardTimeoutMs).toISOString();
      record.hardTimer = setTimeout(() => {
        this.timeoutServerRequest(key).catch(() => {});
      }, hardTimeoutMs);
    }
  }

  resolveServerRequest(params = {}) {
    const requestId = params?.requestId;
    if (requestId === undefined || requestId === null) return;
    const key = this.requestKey(requestId);
    const record = this.serverRequests.get(key);
    if (!record) return;
    this.clearServerRequestTimers(record);
    record.status = "resolved";
    record.resolvedAt = new Date().toISOString();
    this.emitRequestEvent(record, "rpc-request-updated");
    this.serverRequests.delete(key);
  }

  findServerRequest(idOrKey) {
    const raw = typeof idOrKey === "object" && idOrKey ? (idOrKey.key ?? idOrKey.id ?? idOrKey.requestId) : idOrKey;
    const text = String(raw ?? "");
    if (this.serverRequests.has(text)) return this.serverRequests.get(text);
    const key = this.requestKey(raw);
    if (this.serverRequests.has(key)) return this.serverRequests.get(key);
    for (const record of this.serverRequests.values()) {
      if (String(record.requestId) === text) return record;
    }
    return null;
  }

  hasServerRequest(idOrKey) {
    return Boolean(this.findServerRequest(idOrKey));
  }

  async timeoutServerRequest(key) {
    const record = this.serverRequests.get(key);
    if (!record || record.status !== "pending") return false;
    const response = timeoutResultFor(record.method);
    if (response.error) await this.sendServerRequestError(key, response.error, { status: "timed-out" });
    else await this.respondServerRequest(key, response.result, { status: "timed-out" });
    return true;
  }

  async sendClientRequestOnce(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const message = `Codex RPC timed out after ${this.requestTimeoutMs}ms: ${method}`;
        this.sendEvent({ type: "rpc-timeout", id, method, timeoutMs: this.requestTimeoutMs });
        reject(new Error(message));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async request(method, params = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < OVERLOAD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await this.sendClientRequestOnce(method, params);
      } catch (error) {
        lastError = error;
        if (error?.code !== OVERLOAD_RETRY_CODE || attempt >= OVERLOAD_RETRY_ATTEMPTS - 1) throw error;
        const delayMs = jitteredBackoff(attempt);
        this.sendEvent({ type: "rpc-retry", method, attempt: attempt + 1, delayMs, code: OVERLOAD_RETRY_CODE });
        await sleep(delayMs);
      }
    }
    throw lastError || new Error(`Codex RPC failed: ${method}`);
  }

  async notify(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    return true;
  }

  async sendResponse(id, result) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    return true;
  }

  async sendError(id, error) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex connection is not open.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, error: makeJsonRpcError(error?.code, error?.message, error?.data) }));
    return true;
  }

  async respondServerRequest(idOrKey, result, options = {}) {
    const record = this.findServerRequest(idOrKey);
    if (!record) throw new Error("Codex server request is no longer pending.");
    if (record.status !== "pending") throw new Error(`Codex server request is ${record.status}.`);

    this.clearServerRequestTimers(record);
    await this.sendResponse(record.requestId, result || {});
    record.status = options.status || statusFromResult(result || {});
    record.respondedAt = new Date().toISOString();
    record.responseSummary = summarizeResponse(result || {});
    this.emitRequestEvent(record, "rpc-request-updated");
    if (record.status === "timed-out" || record.status === "declined" || record.status === "canceled") {
      this.serverRequests.delete(record.key);
    }
    return { ok: true, request: this.publicRequestRecord(record) };
  }

  async sendServerRequestError(idOrKey, error, options = {}) {
    const record = this.findServerRequest(idOrKey);
    if (!record) return { ok: false, error: "Codex server request is no longer pending." };
    if (record.status !== "pending") return { ok: false, error: `Codex server request is ${record.status}.` };

    this.clearServerRequestTimers(record);
    const rpcError = makeJsonRpcError(error?.code, error?.message, error?.data);
    await this.sendError(record.requestId, rpcError);
    record.status = options.status || "declined";
    record.respondedAt = new Date().toISOString();
    record.errorSummary = rpcError.message;
    this.emitRequestEvent(record, "rpc-request-updated");
    this.serverRequests.delete(record.key);
    return { ok: true, request: this.publicRequestRecord(record) };
  }

  async respond(idOrKey, result) {
    const record = this.findServerRequest(idOrKey);
    if (record) return this.respondServerRequest(record.key, result || {});
    return this.sendResponse(idOrKey, result || {});
  }

  async dispose(options = {}) {
    const socket = this.socket;
    this.disposing = true;
    this.socket = null;
    this.connection = options.keepConnection ? this.connection : null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.close();
      } catch {}
    }
    const reason = options.reason || "Codex surface session disposed.";
    this.rejectPending(reason);
    this.closeServerRequests(reason);
    if (!options.keepConnection) this.connectionId = "";
    if (!options.silent) this.emitStatus("disconnected", { error: options.reason || "" });
  }
}

module.exports = {
  CodexSurfaceSession,
  SUPPORTED_SERVER_REQUEST_METHODS,
};
