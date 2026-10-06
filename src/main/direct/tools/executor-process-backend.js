"use strict";

// Process backend that runs sessions inside another environment's executor
// (for example, a WSL workspace opened from a Windows host). It implements
// the backend contract from exec-process-backends.js over the workspace
// backend manager's NDJSON transport.
//
// The router's start() is synchronous, so `launch` returns a handle at once
// and the handle starts the remote process asynchronously. A refusal from the
// executor (bad cwd, no containment, no sandbox) surfaces as a process error
// followed by close, which the router settles as a failed session with the
// executor's message.

const { EventEmitter } = require("node:events");
const {
  EXECUTOR_METHODS,
  EXECUTOR_PROCESS_EVENTS,
} = require("../../../shared/executor-protocol");
const {
  LOCAL_CHILD_BACKEND_ID,
  normalizeExecRelativePath,
  statefulExecError,
} = require("./exec-process-backends");
const { workspaceExecutesLocally } = require("./exec-sandbox");

const ENVIRONMENT_EXECUTOR_BACKEND_ID = "environment-executor";
const EXECUTOR_ENVIRONMENT_KINDS = new Set(["wsl", "windows"]);
const PROCESS_START_TIMEOUT_MS = 30_000;
const PROCESS_CONTROL_TIMEOUT_MS = 10_000;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function errorFrom(payload = {}, fallbackCode = "direct_stateful_exec_executor_error") {
  const error = new Error(normalizeString(payload.message, "The executor reported a process error."));
  error.code = normalizeString(payload.code, fallbackCode);
  return error;
}

class ExecutorProcessHandle extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workspaceBackends = options.workspaceBackends;
    this.project = options.project;
    this.sessionId = options.sessionId;
    this.plan = options.plan;
    this.requestedEnv = options.requestedEnv;
    this.child = null;
    this.state = "starting";
    this.stdinEnded = false;
    this.pendingStdin = [];
    this.pendingSignals = [];
    this.session = null;
    this.transport = null;
    this.launcher = "pending";
    this.networkAccess = options.plan?.networkAccess !== false;
    this.onExecutorEvent = (event) => this.handleExecutorEvent(event);
    this.onTransportClosed = (payload) => this.handleTransportClosed(payload);
    // Listeners are attached by the router right after launch returns; start
    // on the next tick so nothing emitted early is missed.
    setImmediate(() => { this.begin(); });
  }

  onStdout(fn) { this.on("stdout", fn); }
  onStderr(fn) { this.on("stderr", fn); }
  onStdoutError(fn) { this.on("stdout-error", fn); }
  onStderrError(fn) { this.on("stderr-error", fn); }
  onStdinError(fn) { this.on("stdin-error", fn); }
  onError(fn) { this.on("process-error", fn); }
  onClose(fn) { this.on("close", fn); }
  onActivity(fn) { this.on("activity", fn); }
  onLost(fn) { this.on("lost", fn); }

  async begin() {
    try {
      const session = await this.workspaceBackends.ensureForProject(this.project);
      this.session = session;
      this.transport = session.transport;
      session.on("executor-process-event", this.onExecutorEvent);
      session.on("transport-closed", this.onTransportClosed);
      if (this.state !== "starting") return;
      const result = await this.transport.request(EXECUTOR_METHODS.processStart, {
        processSessionId: this.sessionId,
        sandboxMode: this.plan.sandboxMode,
        cwd: this.plan.cwd,
        shellCommand: this.plan.shellCommand,
        command: this.plan.command,
        args: this.plan.args,
        env: this.requestedEnv && typeof this.requestedEnv === "object" ? this.requestedEnv : {},
      }, PROCESS_START_TIMEOUT_MS);
      if (this.state !== "starting") return;
      this.state = "running";
      this.launcher = normalizeString(result?.launcher, "unknown");
      this.networkAccess = result?.networkAccess !== false;
      for (const signal of this.pendingSignals.splice(0)) this.sendSignal(signal);
      for (const pending of this.pendingStdin.splice(0)) this.sendStdin(pending);
    } catch (error) {
      if (this.state !== "starting") return;
      this.state = "closed";
      this.detach();
      this.emit("process-error", error);
      this.emit("close", null, "");
    }
  }

  detach() {
    this.session?.removeListener("executor-process-event", this.onExecutorEvent);
    this.session?.removeListener("transport-closed", this.onTransportClosed);
  }

  handleExecutorEvent(event = {}) {
    if (event.processSessionId !== this.sessionId || this.state === "closed") return;
    if (event.event === EXECUTOR_PROCESS_EVENTS.output) {
      const chunk = Buffer.from(String(event.dataBase64 || ""), "base64");
      this.emit(event.stream === "stderr" ? "stderr" : "stdout", chunk);
      return;
    }
    if (event.event === EXECUTOR_PROCESS_EVENTS.activity) {
      this.emit("activity", { droppedBytes: Number(event.droppedBytes || 0) });
      return;
    }
    if (event.event === EXECUTOR_PROCESS_EVENTS.error) {
      const source = normalizeString(event.source, "child");
      const name = source === "stdout"
        ? "stdout-error"
        : source === "stderr" ? "stderr-error" : source === "stdin" ? "stdin-error" : "process-error";
      this.emit(name, errorFrom(event));
      return;
    }
    if (event.event === EXECUTOR_PROCESS_EVENTS.exited) {
      this.state = "closed";
      this.detach();
      this.emit("close", event.exitCode === undefined ? null : event.exitCode, normalizeString(event.signal, "") || null);
    }
  }

  handleTransportClosed(payload = {}) {
    if (this.state === "closed") return;
    if (payload.transport && this.transport && payload.transport !== this.transport) return;
    this.state = "closed";
    this.detach();
    const error = statefulExecError(
      "direct_stateful_exec_executor_lost",
      "The execution environment's executor stopped; the process was not re-run.",
    );
    error.cause = payload.error;
    this.emit("lost", error);
  }

  stdinWritable() {
    return !this.stdinEnded && this.state !== "closed";
  }

  writeStdin(text, callback) {
    const pending = { data: String(text), eof: false, callback };
    if (this.state === "starting") this.pendingStdin.push(pending);
    else this.sendStdin(pending);
  }

  endStdin(callback) {
    this.stdinEnded = true;
    const pending = { data: "", eof: true, callback };
    if (this.state === "starting") this.pendingStdin.push(pending);
    else this.sendStdin(pending);
  }

  sendStdin(pending) {
    if (this.state !== "running" || !this.transport) {
      const error = statefulExecError("EPIPE", "The remote process no longer accepts input.");
      error.code = "EPIPE";
      pending.callback?.(error);
      return;
    }
    this.transport.request(EXECUTOR_METHODS.processWrite, {
      processSessionId: this.sessionId,
      data: pending.data,
      eof: pending.eof,
    }, PROCESS_CONTROL_TIMEOUT_MS).then(
      () => pending.callback?.(null),
      (error) => pending.callback?.(Object.assign(error, { code: error.code || "EPIPE" })),
    );
  }

  kill(signal = "SIGTERM") {
    if (this.state === "closed") return false;
    if (this.state === "starting") {
      this.pendingSignals.push(signal);
      return true;
    }
    this.sendSignal(signal);
    return true;
  }

  sendSignal(signal) {
    if (!this.transport) return;
    this.transport.request(EXECUTOR_METHODS.processSignal, {
      processSessionId: this.sessionId,
      signal,
    }, PROCESS_CONTROL_TIMEOUT_MS).catch(() => {});
  }
}

class EnvironmentExecutorProcessBackend {
  constructor(options = {}) {
    this.id = ENVIRONMENT_EXECUTOR_BACKEND_ID;
    this.workspaceBackends = options.workspaceBackends || null;
  }

  // Lexical checks only: the executor resolves and checks the cwd against its
  // own filesystem when the process starts.
  resolveWorkspace(input = {}, grant = null) {
    if (!this.workspaceBackends) {
      throw statefulExecError("direct_stateful_exec_backend_unavailable", "No executor manager is available for this execution environment.");
    }
    const fullAccess = grant?.sandboxMode === "danger-full-access";
    const requested = normalizeString(input.cwdRelPath || input.cwd, "");
    const rel = fullAccess ? requested.replace(/\\/g, "/") : normalizeExecRelativePath(requested, "cwd");
    if (/[\0-\x1f\x7f]/.test(rel)) {
      throw statefulExecError("direct_stateful_exec_cwd_invalid", "Stateful exec cwd contains control characters.");
    }
    return { root: "", cwd: rel, cwdRelPath: rel || ".", remote: true };
  }

  planLaunch(spec = {}) {
    const sandboxMode = normalizeString(spec.sandboxMode, "danger-full-access");
    return {
      remote: true,
      sandboxMode,
      cwd: spec.workspace?.cwd || "",
      shellCommand: spec.shellCommand || "",
      command: spec.shellCommand ? "" : spec.command,
      args: spec.shellCommand ? [] : (Array.isArray(spec.args) ? spec.args : []),
      launcher: sandboxMode === "danger-full-access" ? "executor" : "executor_sandbox",
      networkAccess: sandboxMode === "danger-full-access",
      shell: false,
    };
  }

  launch(plan, options = {}) {
    if (!options.project || !options.sessionId) {
      throw statefulExecError("direct_stateful_exec_backend_unavailable", "Executor launch requires the project and session identity.");
    }
    return new ExecutorProcessHandle({
      workspaceBackends: this.workspaceBackends,
      project: options.project,
      sessionId: options.sessionId,
      plan,
      requestedEnv: options.requestedEnv,
    });
  }
}

/**
 * Picks the process backend for a session: the in-process local backend when
 * the workspace is local to this host, otherwise the environment's executor
 * (WSL from Windows or another distro, Windows from WSL or Linux).
 */
function createEnvironmentExecBackendResolver(options = {}) {
  const localBackend = options.localBackend;
  const executorBackend = options.executorBackend;
  const locality = typeof options.workspaceLocalityResolver === "function"
    ? options.workspaceLocalityResolver
    : (kind, project) => workspaceExecutesLocally(kind, project);
  return (input = {}, grant = null) => {
    const kind = normalizeString(grant?.executionEnvironment?.kind || input.executionEnvironment?.kind, "local");
    if (EXECUTOR_ENVIRONMENT_KINDS.has(kind) && executorBackend && !locality(kind, input.project || {})) return executorBackend;
    return localBackend;
  };
}

module.exports = {
  ENVIRONMENT_EXECUTOR_BACKEND_ID,
  EXECUTOR_ENVIRONMENT_KINDS,
  EnvironmentExecutorProcessBackend,
  ExecutorProcessHandle,
  LOCAL_CHILD_BACKEND_ID,
  createEnvironmentExecBackendResolver,
};
