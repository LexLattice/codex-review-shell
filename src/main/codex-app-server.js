"use strict";

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const net = require("node:net");

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 200;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (!text) return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function normalizeBinaryCommand(binaryPath, runtime) {
  const text = normalizeString(binaryPath, "codex");
  if (process.platform === "win32" && runtime === "host" && !/[.][A-Za-z0-9]+$/.test(text)) {
    return `${text}.cmd`;
  }
  return text;
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForReady(readyUrl, child, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Codex app-server exited before becoming ready (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(readyUrl, { method: "GET" });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`Timed out waiting for Codex app-server readiness at ${readyUrl}.`);
}

function resolveRuntime(project, codex) {
  const requested = normalizeString(codex.runtime, "auto");
  if (requested === "host" || requested === "wsl") return requested;
  if (process.platform === "win32" && project?.workspace?.kind === "wsl") return "wsl";
  return "host";
}

function buildDescriptor(project, codex, port) {
  const runtime = resolveRuntime(project, codex);
  const wsUrl = `ws://127.0.0.1:${port}`;
  const readyUrl = `http://127.0.0.1:${port}/readyz`;
  const binaryPath = normalizeBinaryCommand(codex.binaryPath, runtime);
  const workspace = project?.workspace || { kind: "local", localPath: project?.repoPath || process.cwd() };

  if (runtime === "wsl") {
    const linuxPath = normalizeString(workspace.linuxPath, "/home");
    if (process.platform === "win32") {
      const args = [];
      if (workspace.distro) args.push("-d", workspace.distro);
      args.push(
        "--cd",
        linuxPath,
        "--",
        "bash",
        "-lc",
        `set -e; exec ${shellQuote(binaryPath)} app-server --listen ${shellQuote(wsUrl)}`,
      );
      return {
        key: `wsl:${workspace.distro || "default"}:${linuxPath}:${binaryPath}`,
        runtime,
        wsUrl,
        readyUrl,
        command: "wsl.exe",
        args,
        cwd: undefined,
        binaryPath,
        workspaceRoot: linuxPath,
      };
    }
    return {
      key: `linux:${linuxPath}:${binaryPath}`,
      runtime,
      wsUrl,
      readyUrl,
      command: binaryPath,
      args: ["app-server", "--listen", wsUrl],
      cwd: linuxPath,
      binaryPath,
      workspaceRoot: linuxPath,
    };
  }

  if (workspace.kind === "wsl" && process.platform === "win32") {
    throw new Error("Host runtime cannot target a WSL workspace on Windows. Use Codex runtime = WSL.");
  }

  const localPath = normalizeString(workspace.localPath, project?.repoPath || process.cwd());
  return {
    key: `host:${localPath}:${binaryPath}`,
    runtime,
    wsUrl,
    readyUrl,
    command: binaryPath,
    args: ["app-server", "--listen", wsUrl],
    cwd: localPath,
    binaryPath,
    workspaceRoot: localPath,
  };
}

class CodexAppServerManager extends EventEmitter {
  constructor() {
    super();
    this.session = null;
  }

  snapshot() {
    if (!this.session) return null;
    const { key, status, runtime, wsUrl, readyUrl, binaryPath, workspaceRoot, error, logs } = this.session;
    return {
      key,
      status,
      runtime,
      wsUrl,
      readyUrl,
      binaryPath,
      workspaceRoot,
      error,
      logs: logs.slice(-20),
    };
  }

  emitStatus() {
    this.emit("status", {
      at: new Date().toISOString(),
      session: this.snapshot(),
    });
  }

  appendLog(kind, chunk) {
    if (!this.session) return;
    const lines = String(chunk || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      this.session.logs.push({ kind, line, at: new Date().toISOString() });
    }
    if (this.session.logs.length > 200) this.session.logs.splice(0, this.session.logs.length - 200);
  }

  async ensureForProject(project) {
    const codex = project?.surfaceBinding?.codex || {};
    const port = await allocatePort();
    const descriptor = buildDescriptor(project, codex, port);

    if (this.session && this.session.key === descriptor.key && this.session.status === "ready") {
      return this.snapshot();
    }

    await this.dispose();

    const child = spawn(descriptor.command, descriptor.args, {
      cwd: descriptor.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    this.session = {
      ...descriptor,
      child,
      status: "starting",
      error: "",
      logs: [],
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.appendLog("stdout", chunk));
    child.stderr?.on("data", (chunk) => this.appendLog("stderr", chunk));
    child.on("error", (error) => {
      if (!this.session || this.session.child !== child) return;
      this.session.status = "failed";
      this.session.error = error.message;
      this.emitStatus();
    });
    child.on("exit", (code, signal) => {
      if (!this.session || this.session.child !== child) return;
      if (this.session.status !== "disposed") {
        this.session.status = "exited";
        this.session.error = `Codex app-server exited (code=${code ?? "null"} signal=${signal ?? "null"}).`;
        this.emitStatus();
      }
    });

    this.emitStatus();

    try {
      await waitForReady(descriptor.readyUrl, child);
      if (!this.session || this.session.child !== child) throw new Error("Codex app-server session was replaced before readiness.");
      this.session.status = "ready";
      this.emitStatus();
      return this.snapshot();
    } catch (error) {
      if (this.session && this.session.child === child) {
        this.session.status = "failed";
        this.session.error = error.message;
        this.emitStatus();
      }
      await this.dispose();
      throw error;
    }
  }

  async dispose() {
    if (!this.session) return;
    const { child } = this.session;
    this.session.status = "disposed";
    this.emitStatus();
    this.session = null;
    if (!child || child.killed) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 1200);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

module.exports = {
  CodexAppServerManager,
  resolveRuntime,
};
