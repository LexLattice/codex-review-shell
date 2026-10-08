"use strict";

// The owner's own terminals in the Terminal panel: an interactive shell in a
// project's environment (PowerShell on Windows, the login shell in WSL),
// started the way that environment starts processes (in-process here, or
// through its executor), with the owner's environment and no sandbox. It is
// still contained, so it ends with the app or the executor.

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { normalizePtySize } = require("../tools/pty-frames");

const TERMINAL_REPLAY_BYTES = 512 * 1024;
const MAX_TERMINALS_PER_PROJECT = 8;
const MAX_INPUT_BYTES = 64 * 1024;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function terminalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function environmentLabel(project = {}) {
  const workspace = project.workspace || {};
  if (workspace.kind === "wsl") return `WSL · ${normalizeString(workspace.distro, "default")}`;
  if (workspace.kind === "windows") return "Windows";
  return "Local";
}

class DirectTerminalService extends EventEmitter {
  /**
   * backendFor(project) -> a process backend (exec-process-backends.js
   *   contract) for that project's environment.
   * environment() -> the host's environment for in-process terminals.
   */
  constructor(options = {}) {
    super();
    if (typeof options.backendFor !== "function") throw new TypeError("DirectTerminalService needs backendFor(project).");
    this.backendFor = options.backendFor;
    this.environment = typeof options.environment === "function" ? options.environment : () => process.env;
    this.terminals = new Map();
  }

  create(input = {}) {
    const project = input.project || {};
    const projectId = normalizeString(project.id, "");
    if (!projectId) throw terminalError("direct_terminal_project_required", "A terminal opens in a project.");
    const open = [...this.terminals.values()].filter((terminal) => terminal.projectId === projectId && !terminal.exited);
    if (open.length >= MAX_TERMINALS_PER_PROJECT) {
      throw terminalError("direct_terminal_limit", `A project can have up to ${MAX_TERMINALS_PER_PROJECT} open terminals.`);
    }
    const size = normalizePtySize({ rows: input.rows, cols: input.cols });
    const kind = normalizeString(project.workspace?.kind, "local");
    // The owner's terminal: Full access semantics (no sandbox), in the
    // project's own environment.
    const grant = { sandboxMode: "danger-full-access", executionEnvironment: { kind } };
    const backend = this.backendFor(project, grant);
    const workspace = backend.resolveWorkspace({ project, cwd: "" }, grant);
    const plan = backend.planLaunch({
      sandboxMode: "danger-full-access",
      workspace,
      interactiveShell: true,
      fullEnvironment: true,
      tty: size,
    });
    const terminalId = `terminal_${crypto.randomBytes(8).toString("hex")}`;
    const handle = backend.launch(plan, {
      cwd: workspace.cwd,
      env: { ...this.environment(), TERM: "xterm-256color", COLORTERM: "truecolor" },
      project,
      sessionId: terminalId,
    });
    const terminal = {
      terminalId,
      projectId,
      environment: environmentLabel(project),
      shell: normalizeString(plan.shellName, ""),
      rows: size.rows,
      cols: size.cols,
      createdAt: new Date().toISOString(),
      handle,
      replay: [],
      replayBytes: 0,
      exited: false,
      exitCode: null,
    };
    this.terminals.set(terminalId, terminal);
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "utf8");
      if (!bytes.length) return;
      terminal.replay.push(bytes);
      terminal.replayBytes += bytes.length;
      while (terminal.replayBytes > TERMINAL_REPLAY_BYTES && terminal.replay.length > 1) {
        terminal.replayBytes -= terminal.replay.shift().length;
      }
      this.emit("data", { terminalId, projectId, data: bytes });
    };
    const onExit = (exitCode) => {
      if (terminal.exited) return;
      terminal.exited = true;
      terminal.exitCode = exitCode === undefined ? null : exitCode;
      this.emit("exit", { terminalId, projectId, exitCode: terminal.exitCode });
    };
    handle.onStarted?.(({ shell } = {}) => {
      if (!shell || shell === terminal.shell) return;
      terminal.shell = shell;
      this.emit("shell", { terminalId, projectId, shell });
    });
    handle.onStdout(onData);
    // The helpers' own errors (e.g. no shell) land on stderr; show them.
    handle.onStderr(onData);
    handle.onClose((exitCode) => onExit(exitCode));
    handle.onLost?.(() => onExit(null));
    handle.onError?.((error) => {
      onData(Buffer.from(`\r\n[terminal error: ${normalizeString(error?.message, "unknown")}]\r\n`));
      onExit(null);
    });
    return this.summary(terminal);
  }

  terminalFor(terminalId, projectId = "") {
    const terminal = this.terminals.get(normalizeString(terminalId, ""));
    if (!terminal || (projectId && terminal.projectId !== projectId)) {
      throw terminalError("direct_terminal_missing", "That terminal isn't open.");
    }
    return terminal;
  }

  write(input = {}) {
    const terminal = this.terminalFor(input.terminalId, input.projectId);
    if (terminal.exited) return { accepted: false };
    const data = typeof input.data === "string" ? input.data : "";
    if (!data) return { accepted: false };
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) throw terminalError("direct_terminal_input_too_large", "Terminal input is limited to 64 KiB at a time.");
    terminal.handle.writeStdin(data, () => {});
    return { accepted: true };
  }

  resize(input = {}) {
    const terminal = this.terminalFor(input.terminalId, input.projectId);
    const size = normalizePtySize({ rows: input.rows, cols: input.cols });
    terminal.rows = size.rows;
    terminal.cols = size.cols;
    if (!terminal.exited) terminal.handle.resize?.(size.rows, size.cols);
    return this.summary(terminal);
  }

  close(input = {}) {
    const terminal = this.terminalFor(input.terminalId, input.projectId);
    if (!terminal.exited) terminal.handle.kill("SIGTERM");
    this.terminals.delete(terminal.terminalId);
    return { closed: true };
  }

  list(input = {}) {
    const projectId = normalizeString(input.projectId, "");
    return [...this.terminals.values()]
      .filter((terminal) => !projectId || terminal.projectId === projectId)
      .map((terminal) => this.summary(terminal));
  }

  replay(input = {}) {
    const terminal = this.terminalFor(input.terminalId, input.projectId);
    return Buffer.concat(terminal.replay);
  }

  summary(terminal) {
    return {
      terminalId: terminal.terminalId,
      projectId: terminal.projectId,
      environment: terminal.environment,
      shell: terminal.shell,
      rows: terminal.rows,
      cols: terminal.cols,
      createdAt: terminal.createdAt,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
    };
  }

  dispose() {
    for (const terminal of this.terminals.values()) {
      if (!terminal.exited) {
        try { terminal.handle.kill("SIGKILL"); } catch {}
      }
    }
    this.terminals.clear();
  }
}

module.exports = {
  DirectTerminalService,
  MAX_TERMINALS_PER_PROJECT,
};
