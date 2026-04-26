#!/usr/bin/env node

import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCallbackUrl } = require("../src/main/direct/auth/oauth-shapes");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_REDIRECT_HOST = "localhost";
const DEFAULT_PORT = 1455;
const DEFAULT_PATH = "/auth/callback";
const DEFAULT_PROBE_PATH = "/__direct_auth_probe";
const DEFAULT_TIMEOUT_MS = 180_000;

function argMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      result.set(key.slice(2), "true");
    } else {
      result.set(key.slice(2), next);
      index += 1;
    }
  }
  return result;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePath(value, fallback = DEFAULT_PATH) {
  const text = normalizeString(value, fallback);
  return text.startsWith("/") ? text : `/${text}`;
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callbackResponseHtml(status) {
  const title = status === "ok" ? "Codex auth complete" : "Codex auth failed";
  const body = status === "ok"
    ? "You can return to Codex Review Shell."
    : "The auth callback could not be accepted. Return to Codex Review Shell and try again.";
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><p>${body}</p></body>`;
}

function closeSoon(server, exitCode = 0) {
  setTimeout(() => {
    server.close(() => process.exit(exitCode));
  }, 25);
}

const args = argMap(process.argv.slice(2));
const host = normalizeString(args.get("host"), DEFAULT_HOST);
const redirectHost = normalizeString(args.get("redirect-host"), DEFAULT_REDIRECT_HOST);
const port = Number(args.get("port") || DEFAULT_PORT) || DEFAULT_PORT;
const callbackPath = normalizePath(args.get("path"), DEFAULT_PATH);
const probePath = normalizePath(args.get("probe-path"), DEFAULT_PROBE_PATH);
const state = normalizeString(args.get("state"), "");
const probeToken = normalizeString(args.get("probe-token"), "");
const timeoutMs = Math.max(1_000, Number(args.get("timeout-ms") || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
const redirectUri = `http://${redirectHost}:${port}${callbackPath}`;
const probeUrl = `http://${redirectHost}:${port}${probePath}?token=${encodeURIComponent(probeToken)}`;

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", redirectUri);
  if (requestUrl.pathname === probePath) {
    const ok = probeToken && requestUrl.searchParams.get("token") === probeToken;
    response.writeHead(ok ? 200 : 403, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok, token: ok ? probeToken : "" }));
    return;
  }
  if (requestUrl.pathname !== callbackPath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const parsed = parseCallbackUrl(requestUrl.toString(), { expectedState: state });
  response.writeHead(parsed.status === "code" ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
  response.end(callbackResponseHtml(parsed.status === "code" ? "ok" : "error"));
  writeMessage({ type: "callback", result: parsed });
  closeSoon(server);
});

const timeout = setTimeout(() => {
  writeMessage({ type: "timeout", result: { status: "timeout", reason: "callback_timeout" } });
  closeSoon(server);
}, timeoutMs);
timeout.unref();

server.on("error", (error) => {
  writeMessage({
    type: "error",
    code: error?.code || "LISTEN_FAILED",
    message: error?.message || "Callback listener failed.",
  });
  process.exit(2);
});

server.listen(port, host, () => {
  writeMessage({
    type: "ready",
    redirectUri,
    probeUrl,
    host,
    port,
    path: callbackPath,
  });
});
