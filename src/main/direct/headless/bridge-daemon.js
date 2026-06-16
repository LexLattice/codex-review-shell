"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DirectHeadlessBridgeStore, normalizeString } = require("./bridge-store");

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
  }

  statusProjection() {
    return this.store.statusProjection({
      daemonState: this.state === "listening" ? "ready" : this.state,
      lastErrorClass: this.lastErrorClass,
      backpressure: {
        maxInboxEvents: this.maxInboxEvents,
        acceptedEvents: this.store.count("direct_bridge_inbox_events"),
      },
    });
  }

  submitEvent(body = {}) {
    if (this.store.count("direct_bridge_inbox_events") >= this.maxInboxEvents) {
      return {
        ok: false,
        status: "blocked_ingress",
        error: "queue_full",
        providerRequestStarted: false,
        rawPayloadIncluded: false,
      };
    }
    return this.store.submitEvent(body);
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
        jsonResponse(res, error.code === "invalid_json" ? 400 : 500, {
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
    if (req.method === "POST" && url.pathname === "/v1/bridge/events") {
      const body = await readRequestJson(req, this.maxBodyBytes);
      const result = this.submitEvent(body);
      return jsonResponse(res, result.ok ? 202 : 400, result);
    }
    return jsonResponse(res, 404, { ok: false, error: "not_found" });
  }
}

function buildHeadlessBridgeDaemonFromConfig(options = {}) {
  const config = isPlainObject(options.config) ? options.config : readConfigFile(options.configPath);
  const rootDir = normalizeString(options.rootDir || config.rootDir || config.root, path.join(process.cwd(), ".codex", "headless-bridge"));
  return new DirectHeadlessBridgeDaemon({
    ...config,
    rootDir,
    host: options.host || config.host,
    port: options.port ?? config.port,
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
