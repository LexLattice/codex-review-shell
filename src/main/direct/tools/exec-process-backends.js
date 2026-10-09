"use strict";

// Process backends for Direct stateful exec. The session manager in
// stateful-exec-session.js is the host-side router: it owns session identity,
// grant checks, budgets, timeouts, output admission, and events. A backend
// owns everything that touches the execution environment itself: resolving
// the workspace and cwd natively, wrapping the command in that environment's
// sandbox, starting the process, and killing its tree.
//
// Backend contract:
//   id                                   stable backend identifier
//   resolveWorkspace(input, grant)       -> { root, cwd, cwdRelPath }; throws
//   planLaunch(spec)                     -> launch plan; throws before any
//                                           session exists (e.g. no sandbox)
//   launch(plan, { cwd, env })           -> process handle; a throw here
//                                           becomes a failed session
//
// Process handle contract:
//   onStdout(fn) / onStderr(fn)          raw output chunks (Buffer or string)
//   onStdoutError / onStderrError / onStdinError / onError (fn(error))
//   onClose(fn(exitCode, signal))
//   stdinWritable() -> boolean
//   writeStdin(text, callback) / endStdin(callback)
//   kill(signal) -> boolean              terminates the whole process tree
//   resize(rows, cols)                   terminal sessions only (plan.tty)
//
// A terminal session (spec.tty = { rows, cols }) runs the command under a
// terminal helper (pty-frames.js): its stdout is the terminal's output
// (stdout and stderr merged, as in a real terminal) and its input is typed.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { BubblewrapExecSandbox, workspaceExecutesLocally } = require("./exec-sandbox");
const { WindowsJobSandbox } = require("./windows-job-runner");
const {
  nativeInteractiveShell,
  nativeShellCommand,
  prewarmedPowerShellCommand,
  prewarmedPowerShellScriptLine,
} = require("../runtime/execution-environment-contract");
const { PtyChannel, normalizePtySize, ptyHelperArgs } = require("./pty-frames");
const { findExecutableOnPath } = require("../../../shared/executor-protocol");

const LOCAL_CHILD_BACKEND_ID = "local-child";

// Variables every command inherits from the process that starts it. Windows
// programs need far more than POSIX ones: without USERPROFILE, APPDATA,
// PATHEXT, and friends, pwsh, git, and npm misbehave or fail.
const BASE_COMMAND_ENVIRONMENT_KEYS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec",
  "PATHEXT", "windir", "SystemDrive", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
  "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
  "USERNAME", "USERDOMAIN", "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
]);

const PREWARM_IDLE_MS = 5 * 60_000;
const PREWARM_MAX_SHAPES = 4;

function setChildRef(child, referenced) {
  for (const target of [child, child?.stdin, child?.stdout, child?.stderr]) {
    try {
      if (referenced) target?.ref?.();
      else target?.unref?.();
    } catch {}
  }
}

function defaultExecSandbox(platform) {
  return platform === "win32" ? new WindowsJobSandbox({ platform }) : new BubblewrapExecSandbox({ platform });
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function statefulExecError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeExecRelativePath(value, label) {
  const text = normalizeString(value, "").replace(/\\/g, "/");
  if (!text) return "";
  if (
    text.startsWith("/") ||
    /^[A-Za-z]:\//.test(text) ||
    text.split("/").includes("..") ||
    /[\0-\x1f\x7f]/.test(text)
  ) {
    throw statefulExecError("direct_stateful_exec_cwd_invalid", `${label} must be a workspace-relative directory.`);
  }
  return text.replace(/^\.\/+/, "");
}

function processTreeKill(child, signal = "SIGTERM") {
  if (!child) return false;
  let killed = false;
  if (process.platform !== "win32" && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      killed = true;
    } catch (error) {
      if (!['ESRCH', 'EINVAL'].includes(error?.code)) throw error;
    }
  }
  if (!killed && typeof child.kill === "function" && !child.killed) {
    try { killed = child.kill(signal) || killed; } catch {}
  }
  return killed;
}

// Wraps a Node ChildProcess. The raw child stays reachable as `child`, and
// stdin methods are looked up at call time rather than bound at launch.
class LocalChildProcessHandle {
  constructor(child, plan = {}) {
    this.child = child;
    this.launcher = plan.launcher || "none";
    this.networkAccess = plan.networkAccess !== false;
  }

  onStdout(fn) { this.child?.stdout?.on("data", fn); }

  onStderr(fn) { this.child?.stderr?.on("data", fn); }

  onStdoutError(fn) { this.child?.stdout?.on("error", fn); }

  onStderrError(fn) { this.child?.stderr?.on("error", fn); }

  onStdinError(fn) { this.child?.stdin?.on?.("error", fn); }

  onError(fn) { this.child?.on?.("error", fn); }

  onClose(fn) { this.child?.on?.("close", fn); }

  stdinWritable() {
    return Boolean(this.child?.stdin) && !this.child.stdin.destroyed;
  }

  writeStdin(text, callback) {
    this.child.stdin.write(text, callback);
  }

  endStdin(callback) {
    this.child.stdin.end(callback);
  }

  kill(signal) {
    return processTreeKill(this.child, signal);
  }
}

// A command running in a terminal helper. Signals go to the command's own
// process group through the helper, since the helper puts the command in a
// session of its own that killing the helper's group wouldn't reach.
class LocalPtyProcessHandle extends LocalChildProcessHandle {
  constructor(child, plan = {}) {
    super(child, plan);
    this.tty = { ...plan.tty };
    this.channel = new PtyChannel(child?.stdin, { platform: plan.platform || process.platform });
  }

  stdinWritable() { return this.channel.writable(); }

  writeStdin(text, callback) { this.channel.write(text, callback); }

  endStdin(callback) { this.channel.eof(callback); }

  resize(rows, cols) {
    this.tty = normalizePtySize({ rows, cols });
    this.channel.resize(this.tty.rows, this.tty.cols);
  }

  kill(signal) {
    if (signal === "SIGINT") return this.channel.signal("SIGINT");
    this.channel.signal(signal === "SIGKILL" ? "SIGKILL" : "SIGTERM");
    // Then hang up, and stop the helper itself if it lingers.
    this.channel.close();
    const timer = setTimeout(() => {
      if (this.child && this.child.exitCode === null && this.child.signalCode === null) processTreeKill(this.child, "SIGKILL");
    }, signal === "SIGKILL" ? 200 : 1000);
    timer.unref?.();
    return true;
  }
}

class LocalChildProcessBackend {
  constructor(options = {}) {
    this.id = LOCAL_CHILD_BACKEND_ID;
    this.spawnImpl = typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
    this.workspaceRootResolver = typeof options.workspaceRootResolver === "function"
      ? options.workspaceRootResolver
      : (input = {}) => input.workspaceRoot || input.project?.workspaceRoot || "";
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.sandbox = options.sandbox && typeof options.sandbox.wrap === "function"
      ? options.sandbox
      : defaultExecSandbox(this.platform);
    this.workspaceLocalityResolver = typeof options.workspaceLocalityResolver === "function"
      ? options.workspaceLocalityResolver
      : (kind, project) => workspaceExecutesLocally(kind, project);
    // Windows: one idle, already-started PowerShell per launch shape (sandbox
    // profile, folder, environment), so a command skips PowerShell's startup.
    this.prewarm = options.prewarm === false ? false : this.platform === "win32";
    this.prewarmed = new Map();
    this.prewarmStats = { warm: 0, cold: 0 };
  }

  prewarmKey(plan, options = {}) {
    const env = { ...(options.env || {}), ...(plan.env || {}) };
    delete env.TEMP;
    delete env.TMP;
    const args = [];
    for (let index = 0; index < plan.args.length; index += 1) {
      // Each process gets its own scratch folder; it doesn't change the shape.
      if (plan.args[index] === "--scratch") { index += 1; continue; }
      args.push(plan.args[index]);
    }
    return JSON.stringify([plan.command, args, options.cwd || "", Object.entries(env).sort()]);
  }

  takePrewarmed(key) {
    const entry = this.prewarmed.get(key);
    if (!entry) return null;
    this.prewarmed.delete(key);
    clearTimeout(entry.timer);
    const child = entry.child;
    if (!child || child.exitCode !== null || child.signalCode !== null || child.stdin?.destroyed) return null;
    setChildRef(child, true);
    return entry;
  }

  spawnPlanned(plan, options = {}) {
    const env = plan.env && Object.keys(plan.env).length ? { ...(options.env || {}), ...plan.env } : options.env;
    const child = this.spawnImpl(plan.command, plan.args, {
      cwd: options.cwd,
      env,
      shell: plan.shell,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (plan.scratchDir && typeof child?.once === "function") {
      child.once("close", () => {
        fs.rm(plan.scratchDir, { recursive: true, force: true, maxRetries: 3 }, () => {});
      });
    }
    return child;
  }

  refillPrewarmed(key, plan, options = {}) {
    if (this.prewarmed.has(key)) return;
    let fresh;
    try {
      // Re-plan for a fresh scratch folder.
      fresh = { ...plan, ...this.planLaunch(plan.prewarmSpec) };
      const child = this.spawnPlanned(fresh, options);
      child.on?.("error", () => this.prewarmed.get(key)?.child === child && this.prewarmed.delete(key));
      child.once?.("close", () => {
        if (this.prewarmed.get(key)?.child === child) this.prewarmed.delete(key);
      });
      // An idle shell must not keep this process alive.
      setChildRef(child, false);
      // An idle shell that isn't used for a while exits (EOF ends its wait).
      const timer = setTimeout(() => {
        if (this.prewarmed.get(key)?.child !== child) return;
        this.prewarmed.delete(key);
        try { child.stdin.end(); } catch {}
      }, PREWARM_IDLE_MS);
      timer.unref?.();
      this.prewarmed.set(key, { child, plan: fresh, timer });
      while (this.prewarmed.size > PREWARM_MAX_SHAPES) {
        const [oldestKey, oldest] = this.prewarmed.entries().next().value;
        this.prewarmed.delete(oldestKey);
        clearTimeout(oldest.timer);
        try { oldest.child.stdin.end(); } catch {}
      }
    } catch {}
  }

  // Starts an idle shell for a launch shape before its first command (a
  // thread opening), so even that command starts warm.
  prewarmShape(plan, options = {}) {
    if (!plan?.prewarmScriptLine) return false;
    this.refillPrewarmed(this.prewarmKey(plan, options), plan, options);
    return true;
  }

  // Resolves once the idle shells have exited: on Windows a running shell
  // keeps its project folder (its working directory) from being removed.
  disposePrewarmed(options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3_000;
    const exits = [];
    for (const entry of this.prewarmed.values()) {
      clearTimeout(entry.timer);
      const child = entry.child;
      if (child && child.exitCode === null && child.signalCode === null && typeof child.once === "function") {
        // Idle shells are unref'd; while disposal waits for them they (and
        // the bounded timer) must keep the process alive.
        setChildRef(child, true);
        exits.push(new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            resolve();
          }, timeoutMs);
          child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
        }));
      }
      try { child.stdin.end(); } catch {}
    }
    this.prewarmed.clear();
    return Promise.all(exits).then(() => undefined);
  }

  resolveWorkspace(input = {}, grant = null) {
    const kind = normalizeString(grant?.executionEnvironment?.kind || input.executionEnvironment?.kind, "local");
    if (!this.workspaceLocalityResolver(kind, input.project || {})) {
      const error = statefulExecError(
        "direct_stateful_exec_environment_not_local",
        "Direct cannot run commands in this workspace from this host yet (for example, a WSL workspace opened from a Windows host).",
      );
      error.userActionable = true;
      throw error;
    }
    const rootCandidate = this.workspaceRootResolver(input, grant?.executionEnvironment || {});
    const root = path.resolve(String(rootCandidate || ""));
    if (!rootCandidate || !fs.existsSync(root)) {
      throw statefulExecError("direct_stateful_exec_workspace_unavailable", "The selected local execution environment has no available workspace root.");
    }
    const fullAccess = grant?.sandboxMode === "danger-full-access";
    const requestedCwd = normalizeString(input.cwdRelPath || input.cwd, "");
    const rel = fullAccess
      ? requestedCwd.replace(/\\/g, "/")
      : normalizeExecRelativePath(requestedCwd, "cwd");
    if (/[\0-\x1f\x7f]/.test(rel)) {
      throw statefulExecError("direct_stateful_exec_cwd_invalid", "Stateful exec cwd contains control characters.");
    }
    const cwd = path.resolve(root, rel || ".");
    if (fullAccess) {
      let cwdReal;
      try {
        cwdReal = fs.realpathSync(cwd);
        if (!fs.statSync(cwdReal).isDirectory()) throw new Error("not a directory");
      } catch (error) {
        if (error?.code?.startsWith("direct_stateful_exec_")) throw error;
        throw statefulExecError("direct_stateful_exec_cwd_unavailable", "Stateful exec cwd is unavailable in the selected local environment.");
      }
      return { root, cwd: cwdReal, cwdRelPath: path.relative(root, cwdReal).split(path.sep).join("/") || "." };
    }
    const relative = path.relative(root, cwd);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw statefulExecError("direct_stateful_exec_cwd_outside_workspace", "Stateful exec cwd must remain inside the selected workspace.");
    }
    let rootReal;
    let cwdReal;
    try {
      rootReal = fs.realpathSync(root);
      cwdReal = fs.realpathSync(cwd);
      const realRelative = path.relative(rootReal, cwdReal);
      if (realRelative.startsWith(`..${path.sep}`) || realRelative === ".." || path.isAbsolute(realRelative)) {
        throw statefulExecError("direct_stateful_exec_cwd_outside_workspace", "Stateful exec cwd resolves outside the selected workspace.");
      }
      if (!fs.statSync(cwdReal).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      if (error?.code?.startsWith("direct_stateful_exec_")) throw error;
      throw statefulExecError("direct_stateful_exec_cwd_unavailable", "Stateful exec cwd is unavailable in the selected workspace.");
    }
    return { root: rootReal, cwd: cwdReal, cwdRelPath: relative.split(path.sep).join("/") };
  }

  planLaunch(spec = {}) {
    const sandboxMode = normalizeString(spec.sandboxMode, "danger-full-access");
    const tty = normalizePtySize(spec.tty);
    // Command strings run in the environment's native shell (bash -c on
    // Linux, PowerShell on Windows), matching what the model is told and what
    // the WSL executor does. A person's terminal gets their interactive shell.
    const prewarmable = this.prewarm && this.platform === "win32" && !tty && !spec.interactiveShell &&
      Boolean(spec.shellCommand) && spec.prewarmBootstrap !== false;
    const native = spec.interactiveShell
      ? nativeInteractiveShell({ platform: this.platform, env: this.env })
      : prewarmable
        ? prewarmedPowerShellCommand({ platform: this.platform, env: this.env })
        : spec.shellCommand
          ? nativeShellCommand(spec.shellCommand, { platform: this.platform, env: this.env, terminal: Boolean(tty) })
          : null;
    const prewarmFields = prewarmable
      ? { prewarmScriptLine: prewarmedPowerShellScriptLine(spec.shellCommand), prewarmSpec: { ...spec, shellCommand: "prewarm" } }
      : {};
    let command = native ? native.command : spec.command;
    let args = native ? native.args : spec.args;
    const shellName = native ? native.shell : "";
    // Linux: the terminal helper runs inside the sandbox and gives the
    // command its terminal there. (Windows: the job runner hosts the
    // pseudoconsole.)
    if (tty && this.platform !== "win32") {
      const python = findExecutableOnPath("python3", { platform: this.platform, env: this.env });
      if (!python) {
        throw statefulExecError("direct_pty_unavailable", "Terminal sessions in this environment need python3, which isn't installed.");
      }
      args = ptyHelperArgs(tty.rows, tty.cols, command, args);
      command = python;
    }
    // On Windows the sandbox also wraps Full access: the job that stops the
    // whole process tree applies to every profile.
    if (sandboxMode === "danger-full-access" && this.sandbox.containsFullAccess !== true) {
      return {
        command,
        args,
        shell: false,
        shellName,
        launcher: "none",
        networkAccess: true,
        tty,
        platform: this.platform,
        ...prewarmFields,
      };
    }
    return {
      ...prewarmFields,
      ...this.sandbox.wrap({
        sandboxMode,
        root: spec.workspace?.root,
        cwd: spec.workspace?.cwd,
        shellCommand: "",
        command,
        args,
        tty: this.platform === "win32" ? tty : null,
      }),
      shell: false,
      shellName,
      tty,
      platform: this.platform,
    };
  }

  launch(plan, options = {}) {
    if (plan.prewarmScriptLine) {
      const key = this.prewarmKey(plan, options);
      const warm = this.takePrewarmed(key);
      let child;
      if (warm) {
        child = warm.child;
        this.prewarmStats.warm += 1;
      } else {
        child = this.spawnPlanned(plan, options);
        this.prewarmStats.cold += 1;
      }
      child.stdin.write(plan.prewarmScriptLine);
      setImmediate(() => this.refillPrewarmed(key, plan, options));
      return new LocalChildProcessHandle(child, warm ? warm.plan : plan);
    }
    const child = this.spawnPlanned(plan, options);
    return plan.tty ? new LocalPtyProcessHandle(child, plan) : new LocalChildProcessHandle(child, plan);
  }
}

module.exports = {
  BASE_COMMAND_ENVIRONMENT_KEYS,
  LOCAL_CHILD_BACKEND_ID,
  LocalChildProcessBackend,
  LocalChildProcessHandle,
  LocalPtyProcessHandle,
  normalizeExecRelativePath,
  processTreeKill,
  statefulExecError,
};
