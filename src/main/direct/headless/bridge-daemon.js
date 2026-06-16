"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DirectHeadlessBridgeStore, clientCapabilityTokenDigest, normalizeString } = require("./bridge-store");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readRequestJson(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("request_body_too_large"), { code: "request_body_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(Object.assign(new Error("invalid_json"), { code: "invalid_json", cause: error }));
      }
    });
    req.on("error", reject);
  });
}

function readConfigFile(configPath = "") {
  const safePath = normalizeString(configPath, "");
  if (!safePath) return {};
  const text = fs.readFileSync(safePath, "utf8");
  return JSON.parse(text);
}

function requireLoopbackHost(host = "") {
  const safeHost = normalizeString(host, "127.0.0.1");
  if (!LOOPBACK_HOSTS.has(safeHost)) {
    const error = new Error(`Headless bridge daemon refuses non-loopback host: ${safeHost}`);
    error.code = "non_loopback_host_rejected";
    throw error;
  }
  return safeHost;
}

function sameDigest(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req) {
  const auth = normalizeString(req.headers.authorization, "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return normalizeString(match?.[1] || req.headers["x-bridge-capability-token"], "");
}

function httpStatusForError(error) {
  if (error.code === "invalid_json") return 400;
  if (error.code === "request_body_too_large") return 413;
  return 500;
}

class DirectHeadlessBridgeDaemon {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir || options.root, "");
    if (!rootDir) throw new Error("headless_bridge_daemon_missing_root");
    this.host = requireLoopbackHost(options.host);
    this.port = Number.isFinite(Number(options.port)) ? Number(options.port) : 0;
    this.maxBodyBytes = Number.isFinite(Number(options.maxBodyBytes)) ? Number(options.maxBodyBytes) : 256 * 1024;
    this.maxInboxEvents = Number.isFinite(Number(options.maxInboxEvents)) ? Number(options.maxInboxEvents) : 1000;
    this.store = options.store || new DirectHeadlessBridgeStore({
      rootDir,
      dbPath: options.dbPath,
      clients: options.clients,
      routes: options.routes,
      workThreads: options.workThreads,
    });
    this.server = null;
    this.state = "stopped";
    this.startedAt = "";
    this.lastErrorClass = "";
    this.intakePaused = false;
    this.draining = false;
    this.shutdownRequested = false;
    this.controlEvents = [];
    this._turnRuntime = options.turnRuntime || options.textRuntime || null;
    Object.defineProperty(this, "turnRuntime", {
      enumerable: true,
      configurable: true,
      get: () => this._turnRuntime,
      set: (runtime) => {
        this._turnRuntime = runtime || null;
      },
    });
    Object.defineProperty(this, "textRuntime", {
      enumerable: true,
      configurable: true,
      get: () => this._turnRuntime,
      set: (runtime) => {
        this._turnRuntime = runtime || null;
      },
    });
  }

  statusProjection() {
    const status = this.store.statusProjection({
      daemonState: this.state === "listening" ? "ready" : this.state,
      lastErrorClass: this.lastErrorClass,
      backpressure: {
        maxInboxEvents: this.maxInboxEvents,
        acceptedEvents: this.store.count("direct_bridge_inbox_events"),
      },
    });
    return {
      ...status,
      control: this.controlProjection(),
      textRuntime: this.textRuntime?.statusProjection ? this.textRuntime.statusProjection() : {
        schema: "headless_direct_text_runtime_status@1",
        state: "not_configured",
        activeTurns: 0,
        queuedTurns: 0,
      },
      turnRuntime: this.turnRuntime?.statusProjection ? this.turnRuntime.statusProjection() : {
        schema: "headless_direct_turn_runtime_status@1",
        state: "not_configured",
        activeTurns: 0,
        queuedTurns: 0,
      },
    };
  }

  controlProjection() {
    return {
      schema: "headless_daemon_control_projection@1",
      intakeState: this.intakePaused ? "paused" : "accepting",
      drainState: this.draining ? "draining" : "idle",
      shutdownState: this.shutdownRequested ? "requested" : "idle",
      safeControls: ["pause_intake", "resume_intake", "drain", "shutdown"],
      routeAuthorityMutable: false,
      providerTransportAllowed: false,
      rawPayloadIncluded: false,
      rawSecretsIncluded: false,
      recentEvents: this.controlEvents.slice(-10),
    };
  }

  recordControlEvent(action, status, reason = "") {
    const event = {
      controlEventId: `headless_control_${crypto.randomUUID()}`,
      action: normalizeString(action, "unknown"),
      status: normalizeString(status, "unknown"),
      reason: normalizeString(reason, ""),
      observedAt: new Date().toISOString(),
      routeAuthorityMutable: false,
      providerTransportStarted: false,
      rawPayloadIncluded: false,
    };
    this.controlEvents.push(event);
    if (this.controlEvents.length > 25) this.controlEvents.splice(0, this.controlEvents.length - 25);
    return event;
  }

  controlDaemon(body = {}) {
    const action = normalizeString(body.action || body.controlAction, "");
    if (action === "pause_intake") {
      this.intakePaused = true;
      this.draining = false;
      return {
        ok: true,
        status: "control_applied",
        action,
        controlEvent: this.recordControlEvent(action, "applied"),
        control: this.controlProjection(),
        providerRequestStarted: false,
        routeAuthorityMutable: false,
        rawPayloadIncluded: false,
      };
    }
    if (action === "resume_intake") {
      this.intakePaused = false;
      this.draining = false;
      return {
        ok: true,
        status: "control_applied",
        action,
        controlEvent: this.recordControlEvent(action, "applied"),
        control: this.controlProjection(),
        providerRequestStarted: false,
        routeAuthorityMutable: false,
        rawPayloadIncluded: false,
      };
    }
    if (action === "drain") {
      this.intakePaused = true;
      this.draining = true;
      return {
        ok: true,
        status: "control_applied",
        action,
        controlEvent: this.recordControlEvent(action, "applied"),
        control: this.controlProjection(),
        providerRequestStarted: false,
        routeAuthorityMutable: false,
        rawPayloadIncluded: false,
      };
    }
    if (action === "shutdown") {
      this.shutdownRequested = true;
      this.intakePaused = true;
      this.draining = true;
      return {
        ok: true,
        status: "shutdown_requested",
        action,
        controlEvent: this.recordControlEvent(action, "requested"),
        control: this.controlProjection(),
        providerRequestStarted: false,
        routeAuthorityMutable: false,
        rawPayloadIncluded: false,
      };
    }
    return {
      ok: false,
      status: "control_blocked",
      error: "unknown_control_action",
      action,
      controlEvent: this.recordControlEvent(action || "missing", "blocked", "unknown_control_action"),
      control: this.controlProjection(),
      providerRequestStarted: false,
      routeAuthorityMutable: false,
      rawPayloadIncluded: false,
    };
  }

  submitEvent(body = {}) {
    if (this.draining) {
      return {
        ok: false,
        status: "blocked_ingress",
        error: "daemon_draining",
        providerRequestStarted: false,
        rawPayloadIncluded: false,
      };
    }
    if (this.intakePaused) {
      return {
        ok: false,
        status: "blocked_ingress",
        error: "intake_paused",
        providerRequestStarted: false,
        rawPayloadIncluded: false,
      };
    }
    if (this.store.count("direct_bridge_inbox_events") >= this.maxInboxEvents) {
      return {
        ok: false,
        status: "blocked_ingress",
        error: "queue_full",
        providerRequestStarted: false,
        rawPayloadIncluded: false,
      };
    }
    if (this.turnRuntime?.submitEvent) return this.turnRuntime.submitEvent(body);
    return this.store.submitEvent(body);
  }

  authenticateEventRequest(req, body = {}) {
    const clientId = normalizeString(body.clientId || body.client_id, "");
    const client = this.store.readClient(clientId);
    if (!client) {
      return {
        ok: true,
        reason: "",
      };
    }
    if (client.authMode === "disabled" || client.authMode === "none") {
      return {
        ok: true,
        reason: "",
      };
    }
    if (client.authMode === "capability_token") {
      const expectedDigest = normalizeString(client.capabilityTokenDigest || client.capability_token_digest, "");
      const actualDigest = clientCapabilityTokenDigest(client.clientId, bearerToken(req));
      if (!expectedDigest) {
        return {
          ok: false,
          reason: "client_auth_not_configured",
        };
      }
      if (!actualDigest || !sameDigest(actualDigest, expectedDigest)) {
        return {
          ok: false,
          reason: "client_auth_failed",
        };
      }
      return {
        ok: true,
        reason: "",
      };
    }
    return {
      ok: false,
      reason: `client_auth_mode_unsupported:${client.authMode}`,
    };
  }

  authenticateKnownClientRequest(req, body = {}) {
    const clientId = normalizeString(body.clientId || body.client_id, "");
    const client = this.store.readClient(clientId);
    if (!client) {
      return {
        ok: false,
        reason: "unknown_client",
      };
    }
    if (client.status !== "active") {
      return {
        ok: false,
        reason: "client_inactive",
      };
    }
    return this.authenticateEventRequest(req, body);
  }

  readEvent(envelopeId = "") {
    return this.store.readEvent(envelopeId);
  }

  async listen() {
    if (this.server) return this.address();
    this.state = "starting";
    this.startedAt = new Date().toISOString();
    this.server = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        this.lastErrorClass = normalizeString(error.code, "internal_error");
        jsonResponse(res, httpStatusForError(error), {
          ok: false,
          error: this.lastErrorClass,
          providerRequestStarted: false,
          rawPayloadIncluded: false,
        });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        this.state = "listening";
        resolve();
      });
    });
    return this.address();
  }

  address() {
    const address = this.server?.address();
    if (!address || typeof address === "string") return { host: this.host, port: this.port };
    return { host: address.address, port: address.port };
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.state = "stopped";
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    this.store.close();
  }

  async handleHttp(req, res) {
    const url = new URL(req.url || "/", `http://${this.host}:${this.port || 0}`);
    if (req.method === "GET" && url.pathname === "/v1/bridge/status") {
      return jsonResponse(res, 200, this.statusProjection());
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/bridge/events/")) {
      const envelopeId = decodeURIComponent(url.pathname.slice("/v1/bridge/events/".length));
      const event = this.readEvent(envelopeId);
      if (!event) return jsonResponse(res, 404, { ok: false, error: "event_not_found" });
      return jsonResponse(res, 200, { ok: true, ...event });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/bridge/turn-packets/")) {
      const packetId = decodeURIComponent(url.pathname.slice("/v1/bridge/turn-packets/".length));
      const packet = this.store.readTurnPacket(packetId);
      if (!packet) return jsonResponse(res, 404, { ok: false, error: "turn_packet_not_found" });
      return jsonResponse(res, 200, { ok: true, packet });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/bridge/reduced-results/")) {
      const resultId = decodeURIComponent(url.pathname.slice("/v1/bridge/reduced-results/".length));
      const result = this.store.readReducedResult(resultId);
      if (!result) return jsonResponse(res, 404, { ok: false, error: "reduced_result_not_found" });
      return jsonResponse(res, 200, { ok: true, result });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/bridge/outbox-actions/")) {
      const actionId = decodeURIComponent(url.pathname.slice("/v1/bridge/outbox-actions/".length));
      const action = this.store.readOutboxAction(actionId);
      if (!action) return jsonResponse(res, 404, { ok: false, error: "outbox_action_not_found" });
      return jsonResponse(res, 200, { ok: true, action });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/bridge/human-decisions/")) {
      const decisionId = decodeURIComponent(url.pathname.slice("/v1/bridge/human-decisions/".length));
      if (decisionId.endsWith("/replies")) return jsonResponse(res, 405, { ok: false, error: "method_not_allowed" });
      const decision = this.store.readHumanDecisionPacket(decisionId);
      if (!decision) return jsonResponse(res, 404, { ok: false, error: "human_decision_not_found" });
      return jsonResponse(res, 200, { ok: true, decision });
    }
    if (req.method === "POST" && url.pathname.startsWith("/v1/bridge/human-decisions/") && url.pathname.endsWith("/replies")) {
      const decisionId = decodeURIComponent(url.pathname.slice("/v1/bridge/human-decisions/".length, -"/replies".length));
      const body = await readRequestJson(req, this.maxBodyBytes);
      const auth = this.authenticateKnownClientRequest(req, body);
      if (!auth.ok) {
        return jsonResponse(res, 401, {
          ok: false,
          status: "blocked_ingress",
          error: auth.reason,
          providerRequestStarted: false,
          rawPayloadIncluded: false,
        });
      }
      const result = this.store.submitHumanDecisionReply({ ...body, decisionId });
      return jsonResponse(res, result.ok ? 202 : 400, result);
    }
    if (req.method === "POST" && url.pathname === "/v1/bridge/control") {
      const body = await readRequestJson(req, this.maxBodyBytes);
      const auth = this.authenticateKnownClientRequest(req, body);
      if (!auth.ok) {
        return jsonResponse(res, 401, {
          ok: false,
          status: "control_blocked",
          error: auth.reason,
          providerRequestStarted: false,
          routeAuthorityMutable: false,
          rawPayloadIncluded: false,
        });
      }
      const result = this.controlDaemon(body);
      return jsonResponse(res, result.ok ? 202 : 400, result);
    }
    if (req.method === "POST" && url.pathname === "/v1/bridge/events") {
      const body = await readRequestJson(req, this.maxBodyBytes);
      const auth = this.authenticateEventRequest(req, body);
      if (!auth.ok) {
        return jsonResponse(res, 401, {
          ok: false,
          status: "blocked_ingress",
          error: auth.reason,
          providerRequestStarted: false,
          rawPayloadIncluded: false,
        });
      }
      const result = this.submitEvent(body);
      return jsonResponse(res, result.ok ? 202 : 400, result);
    }
    return jsonResponse(res, 404, { ok: false, error: "not_found" });
  }
}

function buildHeadlessBridgeDaemonFromConfig(options = {}) {
  const config = isPlainObject(options.config) ? options.config : readConfigFile(options.configPath);
  const rootDir = normalizeString(options.rootDir || config.rootDir || config.root, path.join(process.cwd(), ".codex", "headless-bridge"));
  const hasHostOverride = Object.hasOwn(options, "host") && normalizeString(options.host, "");
  const hasPortOverride = Object.hasOwn(options, "port") && options.port !== undefined;
  return new DirectHeadlessBridgeDaemon({
    ...config,
    rootDir,
    host: hasHostOverride ? options.host : config.host,
    port: hasPortOverride ? options.port : config.port,
    maxInboxEvents: options.maxInboxEvents ?? config.maxInboxEvents,
    maxBodyBytes: options.maxBodyBytes ?? config.maxBodyBytes,
  });
}

module.exports = {
  DirectHeadlessBridgeDaemon,
  buildHeadlessBridgeDaemonFromConfig,
  readConfigFile,
  requireLoopbackHost,
};
