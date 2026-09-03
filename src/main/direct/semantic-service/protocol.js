"use strict";

const net = require("node:net");
const fs = require("node:fs");
const {
  DSS02_PROTOCOL,
  dss02Fail,
  ensureObject,
  parseJsonStrict,
  canonicalJson,
  deriveProfilePaths,
  safeJson,
  randomRef,
  digestObject,
} = require("./dss02-common");
const { createAuthorizationProof } = require("./authority-store");

const FRAME_BYTES = 1024 * 1024;
const RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUESTS_PER_CONNECTION = 100;

function encodeFrame(value, maximumBytes = FRAME_BYTES) {
  ensureObject(value, "DSS02_PROTOCOL_MESSAGE_INVALID");
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  if (bytes.length > maximumBytes || bytes.length > 0xffffffff) dss02Fail("DSS02_PROTOCOL_FRAME_TOO_LARGE");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

class FrameDecoder {
  constructor({ maximumBytes = FRAME_BYTES } = {}) { this.maximumBytes = maximumBytes; this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > this.maximumBytes + 4) dss02Fail("DSS02_PROTOCOL_FRAME_TOO_LARGE");
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > this.maximumBytes) dss02Fail("DSS02_PROTOCOL_FRAME_TOO_LARGE");
      if (this.buffer.length < length + 4) break;
      const text = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      const message = parseJsonStrict(text, { maximumBytes: this.maximumBytes });
      ensureObject(message, "DSS02_PROTOCOL_MESSAGE_INVALID");
      messages.push(message);
    }
    return messages;
  }
}

function validateRequestEnvelope(message) {
  ensureObject(message, "DSS02_PROTOCOL_MESSAGE_INVALID");
  if (message.schema !== DSS02_PROTOCOL || typeof message.requestId !== "string" || typeof message.method !== "string" || !Object.prototype.hasOwnProperty.call(message, "params")) dss02Fail("DSS02_PROTOCOL_ENVELOPE_INVALID");
  ensureObject(message.params, "DSS02_PROTOCOL_PARAMS_INVALID");
  const allowed = new Set(["schema", "requestId", "method", "params"]);
  for (const key of Object.keys(message)) if (!allowed.has(key)) dss02Fail("DSS02_PROTOCOL_UNKNOWN_FIELD", key);
  return message;
}

function responseEnvelope(requestId, result) {
  return { schema: DSS02_PROTOCOL, requestId, ok: true, result: safeJson(result) };
}

function errorEnvelope(requestId, error) {
  const code = error?.code || "DSS02_INTERNAL_FAILURE";
  return { schema: DSS02_PROTOCOL, requestId, ok: false, error: { code, message: String(error?.message || code).slice(0, 512) } };
}

class Dss02ProtocolServer {
  constructor({ daemon, idleTimeoutMs = 60_000, maximumFrameBytes = FRAME_BYTES, maximumResponseBytes = RESPONSE_BYTES } = {}) {
    if (!daemon) dss02Fail("DSS02_PROTOCOL_DAEMON_REQUIRED");
    this.daemon = daemon;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maximumFrameBytes = maximumFrameBytes;
    this.maximumResponseBytes = maximumResponseBytes;
    this.server = null;
    this.connections = new Set();
  }

  async start() {
    if (this.server) return this;
    const socketPath = this.daemon.store.paths.socket;
    try { fs.unlinkSync(socketPath); } catch (_) {}
    this.server = net.createServer((socket) => this.handleConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(socketPath, () => { this.server.removeListener("error", reject); resolve(); });
    });
    try { fs.chmodSync(socketPath, 0o600); } catch (_) {}
    return this;
  }

  handleConnection(socket) {
    this.connections.add(socket);
    const connectionRef = randomRef("connection");
    let requestCount = 0;
    let idleTimer;
    const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => socket.destroy(), this.idleTimeoutMs); };
    const decoder = new FrameDecoder({ maximumBytes: this.maximumFrameBytes });
    socket.setTimeout(this.idleTimeoutMs, () => socket.destroy());
    resetIdle();
    const transport = this.daemon.observeTransportPeer({ connectionRef, socket });
    socket.on("data", async (chunk) => {
      resetIdle();
      try {
        for (const message of decoder.push(chunk)) {
          requestCount += 1;
          if (requestCount > MAX_REQUESTS_PER_CONNECTION) dss02Fail("DSS02_PROTOCOL_REQUEST_LIMIT");
          let envelope;
          try {
            envelope = validateRequestEnvelope(message);
            const result = await this.daemon.handleProtocolRequest({ connectionRef, transport, request: envelope });
            if (!socket.destroyed) socket.write(encodeFrame(responseEnvelope(envelope.requestId, result), this.maximumResponseBytes));
          } catch (error) {
            // Keep the request identity on protocol failures.  A client must
            // be able to distinguish a closed error response from a timeout
            // or an unrelated response on the same connection.
            const requestId = envelope?.requestId || (typeof message?.requestId === "string" ? message.requestId : "unknown");
            if (!socket.destroyed) socket.write(encodeFrame(errorEnvelope(requestId, error), this.maximumResponseBytes));
          }
        }
      } catch (error) {
        try { socket.write(encodeFrame(errorEnvelope("unknown", error), this.maximumResponseBytes)); } catch (_) {}
        socket.destroy();
      }
    });
    socket.on("close", () => { clearTimeout(idleTimer); this.connections.delete(socket); this.daemon.disconnectTransport?.(connectionRef); });
    socket.on("error", () => { clearTimeout(idleTimer); this.connections.delete(socket); });
  }

  async stop() {
    for (const socket of this.connections) socket.destroy();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
    try { fs.unlinkSync(this.daemon.store.paths.socket); } catch (_) {}
  }
}

class Dss02Client {
  constructor({ profileRoot, timeoutMs = 30_000 } = {}) {
    this.paths = deriveProfilePaths(profileRoot);
    this.timeoutMs = timeoutMs;
  }

  request(method, params = {}) {
    const request = { schema: DSS02_PROTOCOL, requestId: randomRef("request"), method, params };
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.paths.socket);
      const decoder = new FrameDecoder();
      const timer = setTimeout(() => { socket.destroy(); const error = new Error("DSS02 protocol timeout"); error.code = "DSS02_PROTOCOL_TIMEOUT"; reject(error); }, this.timeoutMs);
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); fn(value); };
      socket.once("error", (error) => finish(reject, error));
      socket.on("data", (chunk) => {
        try {
          for (const response of decoder.push(chunk)) {
            if (!response.ok) { const error = new Error(response.error?.message || response.error?.code); error.code = response.error?.code; finish(reject, error); return; }
            finish(resolve, response.result);
          }
        } catch (error) { finish(reject, error); }
      });
      socket.once("connect", () => socket.write(encodeFrame(request)));
    });
  }

  challenge() { return this.request("challenge", {}); }

  requestAuthorized({ method, params = {}, operation = method, request = params, purposeScopes = [], objectScopeDigest, registryRevisionSet = [], credential } = {}) {
    if (!credential?.verifier || !credential?.privateKey) dss02Fail("DSS02_CLIENT_CREDENTIAL_REQUIRED");
    const deadlineAt = Date.now() + Math.max(0, Number(this.timeoutMs) || 0);
    const socket = net.createConnection(this.paths.socket);
    const decoder = new FrameDecoder();
    return new Promise((resolve, reject) => {
      let settled = false;
      let requestCounter = 0;
      let timer;
      let connectWaiter = null;
      const pending = new Map();
      const connectionClosedError = () => {
        const error = new Error("DSS02 protocol connection closed before authorized response");
        error.code = "DSS02_PROTOCOL_CONNECTION_CLOSED";
        return error;
      };
      const removeListeners = () => {
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
        socket.removeListener("close", onClose);
        socket.removeListener("data", onData);
      };
      const finish = (error = null, value = undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (connectWaiter) {
          const waiter = connectWaiter;
          connectWaiter = null;
          if (error) waiter.reject(error);
          else waiter.resolve();
        }
        if (error) for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
        removeListeners();
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const onConnect = () => {
        if (!connectWaiter) return;
        const waiter = connectWaiter;
        connectWaiter = null;
        waiter.resolve();
      };
      const onError = (error) => finish(error || connectionClosedError());
      const onClose = () => finish(connectionClosedError());
      const onData = (chunk) => {
        try {
          for (const response of decoder.push(chunk)) {
            const waiter = pending.get(response.requestId);
            if (!waiter) continue;
            pending.delete(response.requestId);
            if (!response.ok) {
              const error = new Error(response.error?.message || response.error?.code);
              error.code = response.error?.code;
              waiter.reject(error);
            } else waiter.resolve(response.result);
          }
        } catch (error) { finish(error); }
      };
      const waitForConnect = () => new Promise((resolveConnect, rejectConnect) => {
        if (settled) { rejectConnect(connectionClosedError()); return; }
        if (socket.readyState === "open") { resolveConnect(); return; }
        connectWaiter = { resolve: resolveConnect, reject: rejectConnect };
      });
      const send = (methodName, methodParams) => new Promise((resolveSend, rejectSend) => {
        if (settled) { rejectSend(connectionClosedError()); return; }
        const requestId = randomRef("request") + "-" + (++requestCounter);
        pending.set(requestId, { resolve: resolveSend, reject: rejectSend });
        try {
          socket.write(encodeFrame({ schema: DSS02_PROTOCOL, requestId, method: methodName, params: methodParams }), (error) => {
            if (error && !settled) finish(error);
          });
        } catch (error) { finish(error); }
      });
      socket.on("connect", onConnect);
      socket.on("error", onError);
      socket.on("close", onClose);
      socket.on("data", onData);
      timer = setTimeout(() => {
        const error = new Error("DSS02 protocol timeout");
        error.code = "DSS02_PROTOCOL_TIMEOUT";
        finish(error);
      }, Math.max(0, deadlineAt - Date.now()));
      (async () => {
        try {
          await waitForConnect();
          const challenge = await send("challenge", {});
          const requestDigest = method === "submit" ? digestObject("DirectSemanticService.SemanticJobRequest.v1", request) : digestObject("DirectSemanticService.SemanticRequestBoundary.v1", request);
          const scope = objectScopeDigest || digestObject("DirectSemanticService.ObjectScope.v1", request);
          const proof = createAuthorizationProof({ challenge, requestDigest, operation, purposeScopes, objectScopeDigest: scope, verifier: credential.verifier, privateKey: credential.privateKey, registryRevisionSet });
          const result = await send(method, { ...params, request, challengeRef: challenge.challengeRef, proof, purposeScopes, registryRevisionSet });
          finish(null, result);
        } catch (error) { finish(error); }
      })();
    });
  }

  submit(params) { return this.request("submit", params); }
  inspect(params) { return this.request("inspect", params); }
  wait(params) { return this.request("wait", params); }
  ack(params) { return this.request("ack", params); }
  results(params) { return this.request("results", params); }
  subscribe(params) { return this.request("subscribe", params); }
  cancel(params) { return this.request("cancel", params); }
  serviceStatus(params = {}) { return this.request("service status", params); }
}

function createDss02ProtocolServer(options) { return new Dss02ProtocolServer(options); }
function createDss02Client(options) { return new Dss02Client(options); }

module.exports = { FRAME_BYTES, RESPONSE_BYTES, Dss02ProtocolServer, Dss02Client, FrameDecoder, encodeFrame, validateRequestEnvelope, createDss02ProtocolServer, createDss02Client };
