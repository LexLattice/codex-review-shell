"use strict";

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const net = require("node:net");
const {
  SUPPORTED_SERVER_REQUEST_METHODS,
  AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS,
} = require("./codex-app-server-protocol");
const {
  buildRuntimeProviderProfile,
  normalizeRuntimeProviderConfig,
} = require("./runtime-provider-profile");

const DEFAULT_READY_TIMEOUT_MS = 35_000;
const DEFAULT_STARTUP_ATTEMPTS = 2;
const READY_POLL_MS = 200;
const READY_HTTP_TIMEOUT_MS = 1_000;
const READY_TCP_TIMEOUT_MS = 650;
const READY_TCP_STABLE_POLLS = 3;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const READY_TIMEOUT_MS = normalizeInteger(
  process.env.CODEX_APP_SERVER_READY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  5_000,
  180_000,
);
const STARTUP_ATTEMPTS = normalizeInteger(
  process.env.CODEX_APP_SERVER_STARTUP_ATTEMPTS,
  DEFAULT_STARTUP_ATTEMPTS,
  1,
  4,
);

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

function portFromReadyUrl(readyUrl) {
  try {
    const parsed = new URL(String(readyUrl || ""));
    const parsedPort = Number.parseInt(parsed.port, 10);
    return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 0;
  } catch {
    return 0;
  }
}

async function probeReadyHttpStatus(readyUrl, timeoutMs = READY_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const response = await fetch(readyUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return Number(response.status) || 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTcpPort(port, timeoutMs = READY_TCP_TIMEOUT_MS) {
  if (!Number.isFinite(port) || port <= 0) return false;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(Boolean(value));
    };
    socket.setTimeout(Math.max(100, timeoutMs));
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect({ host: "127.0.0.1", port });
  });
}

async function waitForReady(readyUrl, child, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const port = portFromReadyUrl(readyUrl);
  let tcpReadyStreak = 0;
  let lastReadyStatus = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Codex app-server exited before becoming ready (code ${child.exitCode}).`);
    }
    const readyStatus = await probeReadyHttpStatus(readyUrl, READY_HTTP_TIMEOUT_MS);
    if (readyStatus > 0) lastReadyStatus = readyStatus;
    if (readyStatus >= 200 && readyStatus < 300) {
      return { readyBy: "readyz", status: readyStatus };
    }
    if (port > 0) {
      const tcpReachable = await probeTcpPort(port, READY_TCP_TIMEOUT_MS);
      tcpReadyStreak = tcpReachable ? tcpReadyStreak + 1 : 0;
      if (tcpReadyStreak >= READY_TCP_STABLE_POLLS) {
        return { readyBy: "tcp", status: lastReadyStatus };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  const statusNote = lastReadyStatus ? ` (last /readyz status ${lastReadyStatus})` : "";
  throw new Error(`Timed out waiting for Codex app-server readiness at ${readyUrl}.${statusNote}`);
}

function resolveRuntime(project, codex) {
  const requested = normalizeString(codex.runtime, "auto");
  if (requested === "host" || requested === "wsl") return requested;
  if (process.platform === "win32" && project?.workspace?.kind === "wsl") return "wsl";
  return "host";
}

function buildRuntimeCapabilityProfile(session) {
  const status = normalizeString(session?.status, "unknown");
  const ready = status === "ready";
  const profile = {
    version: 1,
    status,
    generatedAt: new Date().toISOString(),
    coreRuntime: {
      canConnect: ready,
      canInitialize: ready,
      transport: "websocket",
      transports: ["websocket"],
      schemaSource: "unknown",
    },
    threads: {
      canStart: ready,
      canRead: ready,
      canResume: ready,
      canList: ready,
      canFork: ready,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: ready,
      canSteer: ready,
      canInterrupt: ready,
      canOverrideModel: ready,
      canOverrideReasoning: ready,
      canUseOutputSchema: false,
    },
    model: {
      canList: ready,
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    reasoning: {
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    authority: {
      commandApproval: ready,
      fileChangeApproval: ready,
      permissionsApproval: ready,
      approvalPolicies: ["untrusted", "on-failure", "on-request", "never"],
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
      canSetNextTurnApprovalPolicy: ready,
      canSetNextTurnSandbox: ready,
    },
    usage: {
      canReadRateLimits: ready,
      rateLimitMethod: "account/rateLimits/read",
    },
    requests: {
      supportedServerMethods: SUPPORTED_SERVER_REQUEST_METHODS,
      unsupportedButHandledMethods: AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS,
      unknownRequestPolicy: "error-visible",
    },
    fork: {
      present: false,
      governancePath: false,
      contextMaintenance: false,
      continuationBridge: false,
      threadMemoryArtifacts: false,
      refreshPruneMethods: false,
      agentProgressArtifacts: false,
    },
    diagnostics: {
      runtime: normalizeString(session?.runtime, ""),
      binaryPath: normalizeString(session?.binaryPath, ""),
      codexHome: normalizeString(session?.codexHome, ""),
      readyUrl: normalizeString(session?.readyUrl, ""),
      source: "runtime-manager",
    },
  };
  profile.provider = buildRuntimeProviderProfile(session, profile);
  return profile;
}

function buildDescriptor(project, codex, port, options = {}) {
  const runtime = resolveRuntime(project, codex);
  const wsUrl = `ws://127.0.0.1:${port}`;
  const readyUrl = `http://127.0.0.1:${port}/readyz`;
  const binaryPath = normalizeBinaryCommand(codex.binaryPath, runtime);
  const codexHome = normalizeString(options.codexHome, "");
  const workspace = project?.workspace || { kind: "local", localPath: project?.repoPath || process.cwd() };
  const provider = normalizeRuntimeProviderConfig(codex);
  if (provider.kind === "direct_oai") {
    return {
      key: `provider-unavailable:${project?.id || "project"}:direct_oai`,
      runtime: "direct_oai",
      wsUrl: "",
      readyUrl: "",
      command: "",
      args: [],
      cwd: undefined,
      binaryPath: "",
      workspaceRoot: workspace.kind === "wsl"
        ? normalizeString(workspace.linuxPath, project?.repoPath || "")
        : normalizeString(workspace.localPath, project?.repoPath || process.cwd()),
      codexHome,
      provider,
      envExtras: {},
      unavailable: true,
      error: "Direct OpenAI harness provider is not implemented in this shell workspace yet.",
    };
  }

  if (runtime === "wsl") {
    const linuxPath = normalizeString(workspace.linuxPath, "/home");
    if (process.platform === "win32") {
      const codexHomeExport = codexHome ? `export CODEX_HOME=${shellQuote(codexHome)}; ` : "";
      const args = [];
      if (workspace.distro) args.push("-d", workspace.distro);
      args.push(
        "--cd",
        linuxPath,
        "--",
        "bash",
        "-lc",
        `set -e; ${codexHomeExport}exec ${shellQuote(binaryPath)} app-server --listen ${shellQuote(wsUrl)}`,
      );
      return {
        key: `wsl:${workspace.distro || "default"}:${linuxPath}:${binaryPath}:${codexHome || "default"}`,
        runtime,
        wsUrl,
        readyUrl,
        command: "wsl.exe",
        args,
        cwd: undefined,
        binaryPath,
        workspaceRoot: linuxPath,
        codexHome,
        provider,
        envExtras: {},
      };
    }
    return {
      key: `linux:${linuxPath}:${binaryPath}:${codexHome || "default"}`,
      runtime,
      wsUrl,
      readyUrl,
      command: binaryPath,
      args: ["app-server", "--listen", wsUrl],
      cwd: linuxPath,
      binaryPath,
      workspaceRoot: linuxPath,
      codexHome,
      provider,
      envExtras: codexHome ? { CODEX_HOME: codexHome } : {},
    };
  }

  if (workspace.kind === "wsl" && process.platform === "win32") {
    throw new Error("Host runtime cannot target a WSL workspace on Windows. Use Codex runtime = WSL.");
  }

  const localPath = normalizeString(workspace.localPath, project?.repoPath || process.cwd());
  return {
    key: `host:${localPath}:${binaryPath}:${codexHome || "default"}`,
    runtime,
    wsUrl,
    readyUrl,
    command: binaryPath,
    args: ["app-server", "--listen", wsUrl],
    cwd: localPath,
    binaryPath,
    workspaceRoot: localPath,
    codexHome,
    provider,
    envExtras: codexHome ? { CODEX_HOME: codexHome } : {},
  };
}

class CodexAppServerManager extends EventEmitter {
  constructor() {
    super();
    this.session = null;
  }

  snapshot() {
    if (!this.session) return null;
    const { key, status, runtime, wsUrl, readyUrl, binaryPath, workspaceRoot, codexHome, provider, error, logs } = this.session;
    return {
      key,
      status,
      runtime,
      wsUrl,
      readyUrl,
      binaryPath,
      workspaceRoot,
      codexHome,
      provider,
      error,
      capabilities: buildRuntimeCapabilityProfile(this.session),
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

  async ensureForProject(project, options = {}) {
    const codex = project?.surfaceBinding?.codex || {};
    const probeDescriptor = buildDescriptor(project, codex, 1, options);
    if (probeDescriptor.unavailable) {
      await this.dispose();
      this.session = {
        ...probeDescriptor,
        child: null,
        status: "unavailable",
        error: probeDescriptor.error || "Codex runtime provider is unavailable.",
        logs: [{
          kind: "status",
          line: probeDescriptor.error || "Codex runtime provider is unavailable.",
          at: new Date().toISOString(),
        }],
      };
      this.emitStatus();
      return this.snapshot();
    }
    if (this.session && this.session.key === probeDescriptor.key && this.session.status === "ready") {
      return this.snapshot();
    }

    const startupAttempts = normalizeInteger(options.startupAttempts, STARTUP_ATTEMPTS, 1, 4);
    let lastFailure = null;

    for (let attempt = 1; attempt <= startupAttempts; attempt += 1) {
      const port = await allocatePort();
      const descriptor = buildDescriptor(project, codex, port, options);

      await this.dispose();

      const child = spawn(descriptor.command, descriptor.args, {
        cwd: descriptor.cwd,
        env: { ...process.env, ...(descriptor.envExtras || {}) },
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
        const ready = await waitForReady(descriptor.readyUrl, child);
        if (!this.session || this.session.child !== child) throw new Error("Codex app-server session was replaced before readiness.");
        this.session.status = "ready";
        if (ready?.readyBy === "tcp") {
          this.appendLog(
            "status",
            `Codex app-server accepted as ready via TCP probe after /readyz status ${ready.status || "unavailable"}.`,
          );
        }
        this.emitStatus();
        return this.snapshot();
      } catch (error) {
        if (this.session && this.session.child === child) {
          this.session.status = "failed";
          const logTail = this.session.logs
            .slice(-6)
            .map((entry) => `${entry.kind}: ${entry.line}`)
            .join(" | ");
          this.session.error = error.message;
          this.emitStatus();
          lastFailure = new Error(logTail ? `${error.message} Last logs: ${logTail}` : error.message);
        } else {
          lastFailure = error instanceof Error ? error : new Error(String(error));
        }
        await this.dispose();
        if (attempt < startupAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        }
      }
    }

    throw lastFailure || new Error("Codex app-server startup failed.");
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
