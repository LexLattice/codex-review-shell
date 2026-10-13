"use strict";

// A local channel the launcher uses to reach the app already running from
// the same folder and profile: what it runs (experience, code generation),
// or quit it the ordinary way (ordered shutdown). Bringing it to the front
// goes through a second launch instead (src/boot.js): only that hands over
// the right to take the foreground. A named pipe on Windows, a Unix socket
// elsewhere. One JSON request line per connection, one JSON reply line.
//
// Who can use it: the pipe's default security lets only this user (and
// administrators) write to it; the socket sits in the user's runtime folder.
// Its strongest request is quit.
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

// Written by sync-from-wsl.cmd whenever it changes the mirror's files or
// dependencies, and by scripts/release-install.mjs for an installed version.
// A running app whose generation differs runs older code.
const SYNC_GENERATION_FILE = ".sync-generation.txt";
// Installed versions each have their own folder; the release launcher names
// their shared root here so every version answers on one channel.
const CONTROL_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_CONTROL_ROOT";
const MAX_REQUEST_BYTES = 4096;
const SERVER_SOCKET_TIMEOUT_MS = 5000;

const shortHash = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
const folderKey = (folder) => {
  const resolved = path.resolve(folder);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

// userData: "" for the default profile (the launcher can't work out which of
// the default profile's former folders the app picks, and doesn't need to).
function appControlChannel({ appRoot, userData = "" }) {
  const name = `codex-review-shell-${shortHash(folderKey(appRoot))}-${userData ? shortHash(folderKey(userData)) : "default"}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}`;
  const runtimeDir = process.env.XDG_RUNTIME_DIR && fs.existsSync(process.env.XDG_RUNTIME_DIR)
    ? process.env.XDG_RUNTIME_DIR
    : os.tmpdir();
  return path.join(runtimeDir, `${name}.sock`);
}

function appControlRoot(appRoot, env = process.env) {
  const configured = typeof env[CONTROL_ROOT_ENV_VAR] === "string" ? env[CONTROL_ROOT_ENV_VAR].trim() : "";
  return configured ? path.resolve(configured) : appRoot;
}

function readSyncGeneration(appRoot) {
  try {
    return fs.readFileSync(path.join(appRoot, SYNC_GENERATION_FILE), "utf8").trim();
  } catch {
    return "";
  }
}

function requestAppControl(channel, request, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const socket = net.connect(channel);
    const timer = setTimeout(() => done({ ok: false, error: "timeout" }), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        done(JSON.parse(buffer.slice(0, end)));
      } catch {
        done({ ok: false, error: "bad_reply" });
      }
    });
    socket.on("error", (error) => done({ ok: false, error: error.code || "connect_failed" }));
    socket.on("close", () => done({ ok: false, error: "closed" }));
  });
}

// handlers: { hello() -> object, quit() }.
function startAppControlServer(channel, handlers) {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(SERVER_SOCKET_TIMEOUT_MS, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) return socket.destroy();
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      socket.removeAllListeners("data");
      let op = "";
      try {
        op = JSON.parse(buffer.slice(0, end))?.op;
      } catch {}
      const reply = (value) => socket.end(`${JSON.stringify(value)}\n`);
      if (op === "hello") reply({ ok: true, ...handlers.hello() });
      else if (op === "quit") {
        reply({ ok: true });
        setImmediate(() => handlers.quit());
      } else reply({ ok: false, error: "unknown_request" });
    });
  });
  const listen = () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(channel, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const started = (async () => {
    try {
      await listen();
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      // Another instance of this folder and profile already answers; leave
      // it be. A socket file left by a crashed app answers nothing.
      if (process.platform === "win32") return false;
      const probe = await requestAppControl(channel, { op: "hello" }, { timeoutMs: 500 });
      if (probe.ok) return false;
      fs.rmSync(channel, { force: true });
      await listen();
    }
    if (process.platform !== "win32") fs.chmodSync(channel, 0o600);
    return true;
  })();
  return {
    started,
    close() {
      server.close();
    },
  };
}

module.exports = {
  CONTROL_ROOT_ENV_VAR,
  SYNC_GENERATION_FILE,
  appControlChannel,
  appControlRoot,
  readSyncGeneration,
  requestAppControl,
  startAppControlServer,
};
