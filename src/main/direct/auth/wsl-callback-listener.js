"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const DEFAULT_PROBE_TIMEOUT_MS = 2_500;
const DEFAULT_WSL_CALLBACK_HOST = "127.0.0.1";
const DEFAULT_REDIRECT_HOST = "localhost";
const DEFAULT_CALLBACK_PATH = "/auth/callback";
const DEFAULT_PROBE_PATH = "/__direct_auth_probe";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeLinuxPath(value, fallback = "/home") {
  const text = normalizeString(value, fallback).replace(/\\/g, "/");
  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeCallbackPath(value) {
  const text = normalizeString(value, DEFAULT_CALLBACK_PATH);
  return text.startsWith("/") ? text : `/${text}`;
}

function shellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function makeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function callbackListenerScriptPath(linuxPath) {
  return `${normalizeLinuxPath(linuxPath).replace(/\/+$/, "")}/scripts/direct-auth-callback-listener.mjs`;
}

function buildWslArgs(options = {}) {
  const linuxPath = normalizeLinuxPath(options.linuxPath, "/home");
  const scriptPath = normalizeString(options.scriptPath, callbackListenerScriptPath(linuxPath));
  const callbackPath = normalizeCallbackPath(options.callbackPath);
  const host = normalizeString(options.host, DEFAULT_WSL_CALLBACK_HOST);
  const redirectHost = normalizeString(options.redirectHost, DEFAULT_REDIRECT_HOST);
  const port = Number(options.callbackPort || options.port || 1455) || 1455;
  const timeoutMs = Math.max(1_000, Number(options.callbackTimeoutMs || options.timeoutMs || 180_000) || 180_000);
  const state = normalizeString(options.state, "");
  const probeToken = normalizeString(options.probeToken, crypto.randomBytes(18).toString("base64url"));
  const command = [
    "set -e",
    "if ! command -v node >/dev/null 2>&1; then echo 'Node.js is required inside the selected WSL distro.' >&2; exit 127; fi",
    [
      "exec node",
      shellSingleQuote(scriptPath),
      "--host",
      shellSingleQuote(host),
      "--redirect-host",
      shellSingleQuote(redirectHost),
      "--port",
      shellSingleQuote(String(port)),
      "--path",
      shellSingleQuote(callbackPath),
      "--state",
      shellSingleQuote(state),
      "--timeout-ms",
      shellSingleQuote(String(timeoutMs)),
      "--probe-path",
      shellSingleQuote(DEFAULT_PROBE_PATH),
      "--probe-token",
      shellSingleQuote(probeToken),
    ].join(" "),
  ].join("; ");
  const args = [];
  const distro = normalizeString(options.distro, "");
  if (distro) args.push("-d", distro);
  args.push("--cd", linuxPath, "--", "bash", "-lc", command);
  return {
    command: "wsl.exe",
    args,
    linuxPath,
    port,
    probeToken,
  };
}

class WslCallbackListener {
  constructor(child, ready, options = {}) {
    this.child = child;
    this.ready = ready;
    this.redirectUri = ready.redirectUri;
    this.kind = "wsl";
    this.closed = false;
    this.callbackSettled = false;
    this.callbackPromise = new Promise((resolve) => {
      this.resolveCallback = resolve;
    });
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child.__directAuthOnMessage = (message) => this.handleMessage(message);
    child.once("exit", (code, signal) => {
      if (!this.callbackSettled) {
        this.callbackSettled = true;
        this.resolveCallback({
          status: "callback_listener_exited",
          reason: `wsl_callback_listener_exited_${code ?? signal ?? "unknown"}`,
        });
      }
    });
    if (options.pendingLines) {
      for (const line of options.pendingLines) this.handleMessage(line);
    }
  }

  handleMessage(message) {
    if (!isPlainObject(message) || this.callbackSettled) return;
    if (["callback", "timeout"].includes(message.type)) {
      this.callbackSettled = true;
      this.resolveCallback(isPlainObject(message.result) ? message.result : {
        status: String(message.type),
        reason: String(message.reason || message.type),
      });
    }
  }

  wait() {
    return this.callbackPromise;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.child.killed) {
      this.child.kill();
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    if (this.child.__directAuthOnMessage) delete this.child.__directAuthOnMessage;
  }
}

function wireJsonLines(child, onMessage, onInvalidLine) {
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        if (typeof onInvalidLine === "function") onInvalidLine(line);
      }
    }
  });
}

function waitForReady(child, options = {}) {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_PROBE_TIMEOUT_MS));
  const pendingLines = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timeout = setTimeout(() => {
      finish(reject, makeError("WSL_CALLBACK_READY_TIMEOUT", "WSL callback listener did not become ready."));
    }, timeoutMs);

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    }

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    wireJsonLines(child, (message) => {
      if (settled) {
        if (typeof child.__directAuthOnMessage === "function") {
          child.__directAuthOnMessage(message);
        } else {
          pendingLines.push(message);
        }
        return;
      }
      if (isPlainObject(message) && message.type === "ready" && message.redirectUri) {
        finish(resolve, { ready: message, pendingLines });
      } else {
        pendingLines.push(message);
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) => {
      const reason = stderr.trim() || `code=${code ?? "null"} signal=${signal ?? "null"}`;
      finish(reject, makeError("WSL_CALLBACK_EXITED", `WSL callback listener exited before ready: ${reason}`));
    });
  });
}

async function probeWslCallbackListener(ready, options = {}) {
  const probeUrl = normalizeString(ready.probeUrl, "");
  const probeToken = normalizeString(options.probeToken, "");
  if (!probeUrl || !probeToken) throw makeError("WSL_CALLBACK_PROBE_UNAVAILABLE", "WSL callback probe is unavailable.");
  const timeoutMs = Math.max(500, Number(options.probeTimeoutMs || DEFAULT_PROBE_TIMEOUT_MS));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(probeUrl, { signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isPlainObject(payload) || payload.token !== probeToken) {
      throw makeError("WSL_CALLBACK_PROBE_MISMATCH", "Windows localhost did not reach the WSL callback listener.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function createWslCallbackListener(options = {}) {
  if (process.platform !== "win32" && options.forceWin32 !== true) {
    throw makeError("WSL_CALLBACK_UNSUPPORTED", "WSL callback listener is only available from Windows.");
  }
  const descriptor = buildWslArgs(options);
  const child = spawn(descriptor.command, descriptor.args, {
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let readyResult;
  try {
    readyResult = await waitForReady(child, { timeoutMs: options.readyTimeoutMs });
    await probeWslCallbackListener(readyResult.ready, {
      probeToken: descriptor.probeToken,
      probeTimeoutMs: options.probeTimeoutMs,
    });
  } catch (error) {
    if (!child.killed) child.kill();
    throw error;
  }
  return new WslCallbackListener(child, readyResult.ready, { pendingLines: readyResult.pendingLines });
}

function createWslCallbackListenerFactory(options = {}) {
  return (listenerOptions = {}) => createWslCallbackListener({
    ...options,
    ...listenerOptions,
  });
}

module.exports = {
  buildWslArgs,
  createWslCallbackListener,
  createWslCallbackListenerFactory,
};
