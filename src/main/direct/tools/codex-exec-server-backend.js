"use strict";

// The process backend (exec-process-backends.js contract) and file port
// (LocalFilePort contract in full-access-local-environment.js) that run
// agent commands and file tools through Codex exec-server instead of
// Direct's own executor. Selected by the Command execution setting.
//
// exec-server gaps this has to live with (Codex 0.160-0.162):
// - a terminal is always 80x24 (no resize request);
// - a command's input can't be closed (no EOF for pipes; a terminal gets ^D);
// - signals are interrupt and terminate only;
// - file writes are plain writes, one file at a time (no atomic rename).

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  COMMAND_ENVIRONMENT_KEYS,
  CODEX_EXEC_SERVER_BACKEND_ID,
  SCRATCH_PARENT,
  SCRATCH_PREFIX,
  execServerSandboxFor,
  execUriToPath,
  isAbsoluteFor,
  pathApiFor,
  pathInside,
  pathToExecUri,
  wslMountPathFor,
} = require("./codex-exec-server");
const { normalizeExecRelativePath, statefulExecError } = require("./exec-process-backends");
const { sandboxedReadRefusal } = require("./exec-sandbox");
const {
  MAX_IMAGE_BYTES,
  MAX_PATCH_TARGET_BYTES,
  MAX_READ_FILE_BYTES,
  localError,
  pathText,
  safePathEvidence,
  sha256,
} = require("./full-access-local-environment");
const { nativeInteractiveShell, nativeShellCommand } = require("../runtime/execution-environment-contract");
const { normalizePtySize } = require("./pty-frames");

const PROCESS_START_TIMEOUT_MS = 30_000;
const START_ABANDON_GRACE_MS = 30_000;
const WINDOWS_LEVELS_WITH_DENIALS = new Set(["elevated", "mxc"]);
const PROCESS_CONTROL_TIMEOUT_MS = 10_000;
const FILE_REQUEST_TIMEOUT_MS = 30_000;
// exec-server reports a process's exit before its output streams close; a
// command whose background child keeps them open is settled after this.
const CLOSE_AFTER_EXIT_MS = 1_000;
const READ_BLOCK_BYTES = 1024 * 1024;
const COMMAND_ENVIRONMENT_KEY_SET = new Set(COMMAND_ENVIRONMENT_KEYS);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function windowsSandboxLevel(env = process.env) {
  return normalizeString(env.CODEX_DIRECT_EXEC_SERVER_WINDOWS_SANDBOX, "restricted-token");
}

// What the host's command environment adds on top of the variables
// exec-server's own environment provides (CI, NO_COLOR, the caller's own
// additions); the base variables come from the target environment itself.
function commandEnvironmentAdditions(hostEnv = {}, requestedEnv = {}) {
  const requested = requestedEnv && typeof requestedEnv === "object" ? requestedEnv : {};
  const result = {};
  for (const [key, value] of Object.entries(hostEnv || {})) {
    if (typeof value !== "string") continue;
    if (COMMAND_ENVIRONMENT_KEY_SET.has(key) && !Object.prototype.hasOwnProperty.call(requested, key)) continue;
    result[key] = value;
  }
  return result;
}

function scratchEnvironment(dir) {
  return { TMPDIR: dir };
}

function envPolicy() {
  return {
    inherit: "all",
    ignoreDefaultExcludes: false,
    exclude: [],
    set: {},
    includeOnly: [...COMMAND_ENVIRONMENT_KEYS],
  };
}

function rpcMissing(error) {
  return error?.rpcCode === -32004 || /os error 2\b|no such file|cannot find the (file|path)/i.test(String(error?.message || ""));
}

function rpcDenied(error) {
  return /os error (5|13|30)\b|permission denied|access is denied|read-only file system/i.test(String(error?.message || ""));
}

class CodexExecServerProcessHandle extends EventEmitter {
  constructor(options = {}) {
    super();
    this.manager = options.manager;
    this.project = options.project;
    this.sessionId = options.sessionId;
    this.plan = options.plan;
    this.commandEnv = options.commandEnv || {};
    this.child = null;
    this.state = "starting";
    this.startDispatched = false;
    this.stdinEnded = false;
    this.pendingStdin = [];
    this.pendingSignals = [];
    this.connection = null;
    this.launcher = "pending";
    this.networkAccess = options.plan?.networkAccess !== false;
    this.tty = options.plan?.tty ? { ...options.plan.tty } : null;
    this.exitCode = null;
    this.killSignal = "";
    this.closeTimer = null;
    this.scratch = null;
    this.startTimeoutMs = options.startTimeoutMs || PROCESS_START_TIMEOUT_MS;
    this.startAbandonGraceMs = options.startAbandonGraceMs || START_ABANDON_GRACE_MS;
    this.writeSequence = 0;
    this.onNotification = (method, params) => this.handleNotification(method, params);
    this.onClosed = (payload) => this.handleConnectionClosed(payload);
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
  onStarted(fn) { this.on("started", fn); }

  async begin() {
    if (this.state !== "starting") return;
    let connection = null;
    let startAnswered = false;
    try {
      const resolved = await this.manager.connectionFor(this.project);
      connection = resolved.connection;
      const { environment, info } = resolved;
      if (this.state !== "starting") return;
      this.connection = connection;
      connection.on("notification", this.onNotification);
      connection.on("closed", this.onClosed);
      const scratch = this.plan.sandboxMode === "read-only" && environment.platform !== "win32"
        ? await this.createScratch(connection, environment)
        : "";
      if (this.state !== "starting") {
        this.removeScratch();
        return;
      }
      const sandbox = execServerSandboxFor(this.plan.sandboxMode, environment, info, {
        windowsSandboxLevel: this.plan.windowsSandboxLevel || windowsSandboxLevel(),
        writableDirs: scratch ? [scratch] : [],
      });
      this.startDispatched = true;
      const result = await connection.request("process/start", {
        processId: this.sessionId,
        argv: this.plan.argv,
        cwd: pathToExecUri(this.plan.cwd, environment.platform),
        envPolicy: envPolicy(),
        env: scratch ? { ...this.commandEnv, ...scratchEnvironment(scratch) } : this.commandEnv,
        tty: Boolean(this.plan.tty),
        pipeStdin: !this.plan.tty,
        arg0: null,
        ...(sandbox ? { sandbox } : {}),
      }, this.startTimeoutMs, {
        // The start finished after this session reported it failed: stop
        // the process, or the whole exec-server if it won't answer.
        onLate: (error) => {
          startAnswered = true;
          if (error) return;
          connection.request("process/terminate", { processId: this.sessionId }, PROCESS_CONTROL_TIMEOUT_MS)
            .catch(() => connection.close());
        },
      });
      startAnswered = true;
      if (this.state !== "starting") return;
      this.state = "running";
      const sandboxType = normalizeString(result?.sandboxType, "unknown");
      this.launcher = `codex_exec_server:${sandboxType}`;
      this.networkAccess = !sandbox;
      this.emit("started", { shell: this.plan.shellName || "" });
      // The idle timer was armed when this handle was created; launching
      // exec-server and starting the process doesn't count against the
      // command's own quiet time.
      this.emit("activity", { droppedBytes: 0 });
      for (const signal of this.pendingSignals.splice(0)) this.sendSignal(signal);
      for (const pending of this.pendingStdin.splice(0)) this.sendStdin(pending);
    } catch (error) {
      if (this.startDispatched && error?.code === "direct_codex_exec_server_timeout" && connection) {
        this.abandonStart(connection, () => startAnswered);
      }
      if (this.state !== "starting") return;
      this.state = "closed";
      this.detach();
      this.removeScratch();
      this.emit("process-error", error);
      this.emit("close", null, "");
    }
  }

  // A start that timed out may still be running in exec-server. Ask it to
  // stop now (a no-op if it never started); if the start still hasn't
  // answered after a grace period, the exec-server is stuck, and closing it
  // stops every process it started.
  abandonStart(connection, answered) {
    connection.request("process/terminate", { processId: this.sessionId }, PROCESS_CONTROL_TIMEOUT_MS).catch(() => {});
    const guard = setTimeout(() => {
      if (!answered()) connection.close();
    }, this.startAbandonGraceMs);
    guard.unref?.();
  }

  // Read only writes nothing of the user's, but tools still expect a temp
  // folder (Direct's sandbox gives a private /tmp): one per command, removed
  // when it ends. Linux only; see execServerSandboxFor for Windows.
  async createScratch(connection, environment) {
    const dir = path.posix.join(SCRATCH_PARENT, `${SCRATCH_PREFIX}${this.sessionId}`);
    // Recorded first: a create that fails half way is still cleaned up.
    this.scratch = { connection, dir, platform: environment.platform, key: environment.key };
    await connection.request("fs/createDirectory", { path: pathToExecUri(dir, environment.platform), recursive: true }, FILE_REQUEST_TIMEOUT_MS);
    return dir;
  }

  removeScratch() {
    const scratch = this.scratch;
    this.scratch = null;
    if (!scratch) return;
    if (scratch.connection.state === "closed") {
      this.manager?.queueScratchCleanup?.(scratch.key, scratch.dir);
      return;
    }
    scratch.connection.request("fs/remove", { path: pathToExecUri(scratch.dir, scratch.platform), recursive: true, force: true }, FILE_REQUEST_TIMEOUT_MS)
      .catch(() => {});
  }

  detach() {
    clearTimeout(this.closeTimer);
    this.connection?.removeListener("notification", this.onNotification);
    this.connection?.removeListener("closed", this.onClosed);
  }

  handleNotification(method, params = {}) {
    if (params.processId !== this.sessionId || this.state === "closed") return;
    if (method === "process/output") {
      const chunk = Buffer.from(String(params.chunk || ""), "base64");
      this.emit(params.stream === "stderr" ? "stderr" : "stdout", chunk);
      return;
    }
    if (method === "process/exited") {
      this.exitCode = Number.isInteger(params.exitCode) ? params.exitCode : null;
      this.sandboxDenied = params.sandboxDenied === true;
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => this.finish(), CLOSE_AFTER_EXIT_MS);
      this.closeTimer.unref?.();
      return;
    }
    if (method === "process/closed") this.finish();
  }

  finish() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.detach();
    this.removeScratch();
    // Report a requested kill the way a local child reports it (by signal),
    // so cancellation and timeouts read the same on either backend.
    if (this.killSignal && (this.exitCode === null || this.exitCode >= 128)) {
      this.emit("close", null, this.killSignal);
      return;
    }
    this.emit("close", this.exitCode, null);
  }

  handleConnectionClosed() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.detach();
    this.removeScratch();
    this.emit("lost", statefulExecError(
      "direct_stateful_exec_executor_lost",
      "Codex exec-server stopped; the process was not re-run.",
    ));
  }

  stdinWritable() {
    return !this.stdinEnded && this.state !== "closed";
  }

  writeStdin(text, callback) {
    const pending = { data: Buffer.from(String(text), "utf8"), callback };
    if (this.state === "starting") this.pendingStdin.push(pending);
    else this.sendStdin(pending);
  }

  // exec-server can't close a command's input. A terminal reads ^D as end of
  // input; a pipe has no equivalent, so EOF fails visibly instead.
  endStdin(callback) {
    this.stdinEnded = true;
    if (this.plan.tty) {
      this.writeStdin("\x04", callback);
      return;
    }
    const error = statefulExecError(
      "direct_stateful_exec_stdin_eof_unsupported",
      "Codex exec-server can't close a command's input. Switch Command execution to Direct for commands that read to end of input.",
    );
    setImmediate(() => callback?.(error));
  }

  sendStdin(pending) {
    if (this.state !== "running" || !this.connection) {
      const error = statefulExecError("EPIPE", "The process no longer accepts input.");
      pending.callback?.(error);
      return;
    }
    this.writeSequence += 1;
    this.connection.request("process/write", {
      processId: this.sessionId,
      chunk: pending.data.toString("base64"),
      writeId: `${this.sessionId}:${this.writeSequence}`,
    }, PROCESS_CONTROL_TIMEOUT_MS).then(
      (result) => {
        if (result?.status === "accepted") pending.callback?.(null);
        else pending.callback?.(statefulExecError("EPIPE", `The process no longer accepts input (${normalizeString(result?.status, "unknown")}).`));
      },
      (error) => pending.callback?.(Object.assign(error, { code: error.code || "EPIPE" })),
    );
  }

  kill(signal = "SIGTERM") {
    if (this.state === "closed") return false;
    if (signal !== "SIGINT") this.killSignal = signal;
    if (this.state === "starting") {
      if (!this.startDispatched) {
        this.state = "closed";
        this.detach();
        this.pendingSignals.length = 0;
        const exitSignal = ["SIGTERM", "SIGKILL", "SIGINT"].includes(signal) ? signal : "SIGTERM";
        setImmediate(() => {
          this.emit("close", null, exitSignal);
          for (const pending of this.pendingStdin.splice(0)) this.sendStdin(pending);
        });
        return true;
      }
      this.pendingSignals.push(signal);
      return true;
    }
    this.sendSignal(signal);
    return true;
  }

  // exec-server has no resize; the terminal keeps its size.
  resize(rows, cols) {
    if (!this.tty) return;
    this.tty = normalizePtySize({ rows, cols });
  }

  sendSignal(signal) {
    if (!this.connection) return;
    const request = signal === "SIGINT"
      ? this.connection.request("process/signal", { processId: this.sessionId, signal: "interrupt" }, PROCESS_CONTROL_TIMEOUT_MS)
      : this.connection.request("process/terminate", { processId: this.sessionId }, PROCESS_CONTROL_TIMEOUT_MS);
    request.catch(() => {});
  }
}

class CodexExecServerProcessBackend {
  constructor(options = {}) {
    this.id = CODEX_EXEC_SERVER_BACKEND_ID;
    this.manager = options.manager || null;
    this.env = options.env || process.env;
    // Test hook: { startTimeoutMs, startAbandonGraceMs }.
    this.timing = options.timing || {};
  }

  environment(input = {}) {
    if (!this.manager) {
      throw statefulExecError("direct_stateful_exec_backend_unavailable", "Codex exec-server isn't available in this app session.");
    }
    try {
      return this.manager.environmentFor(input.project || {});
    } catch (error) {
      throw Object.assign(statefulExecError(error.code || "direct_stateful_exec_backend_unavailable", error.message), { userActionable: true });
    }
  }

  // Lexical checks only: exec-server resolves the folder when it starts the
  // process and fails the start if it doesn't exist.
  resolveWorkspace(input = {}, grant = null) {
    const environment = this.environment(input);
    const api = pathApiFor(environment.platform);
    const fullAccess = grant?.sandboxMode === "danger-full-access";
    const requested = normalizeString(input.cwdRelPath || input.cwd, "");
    if (/[\0-\x1f\x7f]/.test(requested)) {
      throw statefulExecError("direct_stateful_exec_cwd_invalid", "Stateful exec cwd contains control characters.");
    }
    const located = { root: environment.root, remote: true, platform: environment.platform, local: environment.local };
    if (fullAccess && requested && isAbsoluteFor(environment.platform, requested)) {
      return { ...located, cwd: api.resolve(requested), cwdRelPath: requested.replace(/\\/g, "/") };
    }
    const rel = fullAccess ? requested.replace(/\\/g, "/") : normalizeExecRelativePath(requested, "cwd");
    const cwd = api.resolve(environment.root, rel || ".");
    if (!fullAccess && !pathInside(environment.platform, environment.root, cwd)) {
      throw statefulExecError("direct_stateful_exec_cwd_outside_workspace", "Stateful exec cwd must remain inside the selected workspace.");
    }
    return { ...located, cwd, cwdRelPath: rel || "." };
  }

  planLaunch(spec = {}) {
    const sandboxMode = normalizeString(spec.sandboxMode, "danger-full-access");
    const platform = spec.workspace?.platform || process.platform;
    const tty = normalizePtySize(spec.tty);
    // A WSL distro reached from Windows can't be probed from here; executors
    // there run bash, so do the same. Windows reached from WSL is probed
    // through its drive mount (pwsh when installed).
    const remote = spec.workspace?.local === false;
    const remoteFileExists = platform === "win32"
      ? (candidate) => { const mounted = wslMountPathFor(candidate); return Boolean(mounted) && fs.existsSync(mounted); }
      : (candidate) => candidate === "/bin/bash";
    const shellOptions = {
      platform,
      env: remote ? {} : this.env,
      ...(remote ? { fileExists: remoteFileExists } : {}),
      terminal: Boolean(tty),
    };
    const native = spec.interactiveShell
      ? nativeInteractiveShell(shellOptions)
      : spec.shellCommand
        ? nativeShellCommand(spec.shellCommand, shellOptions)
        : null;
    const command = native ? native.command : spec.command;
    const args = native ? native.args : (Array.isArray(spec.args) ? spec.args : []);
    if (!normalizeString(command, "")) {
      throw statefulExecError("direct_stateful_exec_command_invalid", "Stateful exec requires a command.");
    }
    const level = windowsSandboxLevel(this.env);
    // restricted-token can't deny any path, so a sandboxed command there could
    // read the credential stores (read_file's host-side check doesn't cover
    // shell commands). Only a level that keeps the denials may run them.
    if (platform === "win32" && sandboxMode !== "danger-full-access" && !WINDOWS_LEVELS_WITH_DENIALS.has(level)) {
      throw statefulExecError(
        "direct_stateful_exec_sandbox_unavailable",
        `Codex exec-server's Windows sandbox (${level}) can't hide credential stores, so it doesn't run Read only or Workspace commands. Switch Command execution to Direct executor in settings, or use Full access.`,
      );
    }
    return {
      remote: true,
      sandboxMode,
      windowsSandboxLevel: level,
      argv: [command, ...args.map(String)],
      cwd: spec.workspace?.cwd || "",
      platform,
      shellName: native ? native.shell : "",
      launcher: sandboxMode === "danger-full-access" ? "codex_exec_server" : "codex_exec_server_sandbox",
      networkAccess: sandboxMode === "danger-full-access",
      shell: false,
      tty,
    };
  }

  launch(plan, options = {}) {
    if (!options.project || !options.sessionId) {
      throw statefulExecError("direct_stateful_exec_backend_unavailable", "exec-server launch requires the project and session identity.");
    }
    return new CodexExecServerProcessHandle({
      manager: this.manager,
      project: options.project,
      sessionId: options.sessionId,
      plan,
      commandEnv: commandEnvironmentAdditions(options.env, options.requestedEnv),
      ...this.timing,
    });
  }
}

/**
 * read_file, view_image, and apply_patch through exec-server's fs requests.
 * The host keeps grants, patch parsing, and planning; profile checks run
 * here against paths exec-server resolves, and exec-server's own sandbox
 * enforces them again on every request.
 */
class CodexExecServerFilePort {
  constructor(options = {}) {
    this.kind = CODEX_EXEC_SERVER_BACKEND_ID;
    this.manager = options.manager || null;
  }

  async session(input) {
    if (!this.manager || !input?.project) {
      throw localError("direct_full_access_environment_unavailable", "Codex exec-server isn't available for this workspace.");
    }
    return this.manager.connectionFor(input.project);
  }

  async request(input, method, params) {
    const { connection } = await this.session(input);
    return connection.request(method, params, FILE_REQUEST_TIMEOUT_MS);
  }

  sandbox(grant, session) {
    return execServerSandboxFor(grant?.sandboxMode, session.environment, session.info, { windowsSandboxLevel: windowsSandboxLevel() });
  }

  resolveTarget(input, _grant, rawPath, label) {
    if (!this.manager) throw localError("direct_full_access_environment_unavailable", "Codex exec-server isn't available for this workspace.");
    let environment;
    try {
      environment = this.manager.environmentFor(input?.project || {});
    } catch (error) {
      throw localError(error.code || "direct_full_access_environment_unavailable", error.message);
    }
    const api = pathApiFor(environment.platform);
    const text = pathText(rawPath, label);
    const target = api.resolve(isAbsoluteFor(environment.platform, text) ? text : api.join(environment.root, text));
    return {
      root: environment.root,
      target,
      canonicalTarget: environment.platform === "win32" ? target.toLowerCase() : target,
      pathEvidenceKey: safePathEvidence(target),
      platform: environment.platform,
      remote: true,
    };
  }

  // The real path of a target, or of the deepest existing folder above it
  // with the rest appended (for files a patch would create).
  async realPath(session, resolved, target = resolved.target) {
    const api = pathApiFor(resolved.platform);
    const suffix = [];
    let current = target;
    for (let depth = 0; depth < 64; depth += 1) {
      try {
        const result = await session.connection.request("fs/canonicalize", {
          path: pathToExecUri(current, resolved.platform),
          sandbox: null,
        }, FILE_REQUEST_TIMEOUT_MS);
        return api.join(execUriToPath(result?.path, resolved.platform), ...suffix.reverse());
      } catch (error) {
        if (!rpcMissing(error)) throw error;
        const parent = api.dirname(current);
        if (parent === current) return target;
        suffix.push(api.basename(current));
        current = parent;
      }
    }
    return target;
  }

  async assertReadable(grant, resolved, input) {
    if (grant?.sandboxMode === "danger-full-access") return;
    const session = await this.session(input);
    const real = await this.realPath(session, resolved);
    const realRoot = await this.realPath(session, resolved, resolved.root);
    const refusal = sandboxedReadRefusal(real, { platform: resolved.platform === "win32" ? "win32" : "linux", workspaceRoot: realRoot });
    if (refusal) {
      throw localError(
        refusal,
        refusal === "direct_access_profile_credential_store_hidden"
          ? "Workspace and Read-only access cannot read credential stores. Ask the user to switch Access to Full access if this file is needed."
          : "Workspace and Read-only access cannot read outside this environment's own filesystem. Ask the user to switch Access to Full access if this file is needed.",
      );
    }
  }

  // Unsandboxed: the profile checks have already passed, and every sandboxed
  // request starts a sandbox helper (~0.1 s). The request that reads or
  // writes the content carries the sandbox.
  async metadata(session, resolved) {
    return session.connection.request("fs/getMetadata", {
      path: pathToExecUri(resolved.target, resolved.platform),
      sandbox: null,
    }, FILE_REQUEST_TIMEOUT_MS);
  }

  deniedError() {
    return localError(
      "direct_access_profile_path_hidden",
      "The sandbox for this access profile doesn't allow this file. Ask the user to switch Access to Full access if it is needed.",
    );
  }

  async readFile(resolved, maxBytesInput, input = {}, grant = null, capBytes = MAX_READ_FILE_BYTES) {
    const session = await this.session(input);
    let meta;
    try {
      meta = await this.metadata(session, resolved, grant);
    } catch (error) {
      if (rpcDenied(error)) throw this.deniedError();
      throw localError("direct_full_access_file_unavailable", "The selected file is unavailable.");
    }
    if (!meta?.isFile) throw localError("direct_full_access_file_invalid", "The selected path is not a regular file.");
    const requested = Number(maxBytesInput);
    const ceiling = Math.min(Math.max(Number(capBytes) || MAX_READ_FILE_BYTES, MAX_READ_FILE_BYTES), MAX_IMAGE_BYTES);
    const maxBytes = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : ceiling, ceiling);
    const handleId = `direct_read_${crypto.randomBytes(8).toString("hex")}`;
    const chunks = [];
    let total = 0;
    try {
      await session.connection.request("fs/open", {
        handleId,
        path: pathToExecUri(resolved.target, resolved.platform),
        sandbox: this.sandbox(grant, session),
      }, FILE_REQUEST_TIMEOUT_MS);
    } catch (error) {
      if (rpcDenied(error)) throw this.deniedError();
      throw localError("direct_full_access_file_unavailable", "The selected file is unavailable.");
    }
    try {
      while (total < maxBytes) {
        const block = await session.connection.request("fs/readBlock", {
          handleId,
          offset: total,
          len: Math.min(READ_BLOCK_BYTES, maxBytes - total),
        }, FILE_REQUEST_TIMEOUT_MS);
        const bytes = Buffer.from(String(block?.chunk || ""), "base64");
        chunks.push(bytes);
        total += bytes.length;
        if (block?.eof || !bytes.length) break;
      }
    } finally {
      await session.connection.request("fs/close", { handleId }, FILE_REQUEST_TIMEOUT_MS).catch(() => {});
    }
    return { size: Number(meta.size || 0), bytes: Buffer.concat(chunks).subarray(0, maxBytes) };
  }

  async readPatchTarget(resolved, operation, input = {}, grant = null) {
    const session = await this.session(input);
    let meta;
    try {
      meta = await this.metadata(session, resolved, grant);
    } catch (error) {
      if (operation === "create" && rpcMissing(error)) return { exists: false, bytes: Buffer.alloc(0) };
      if (rpcDenied(error)) throw this.deniedError();
      throw localError("direct_full_access_patch_target_unavailable", "The selected patch target is unavailable.");
    }
    if (!meta?.isFile) throw localError("direct_full_access_patch_target_invalid", "The selected patch target is not a regular file.");
    if (Number(meta.size) > MAX_PATCH_TARGET_BYTES) {
      throw localError("direct_full_access_patch_target_oversized", "The selected patch target exceeds the bounded patch input limit.");
    }
    let result;
    try {
      result = await session.connection.request("fs/readFile", {
        path: pathToExecUri(resolved.target, resolved.platform),
        sandbox: this.sandbox(grant, session),
      }, FILE_REQUEST_TIMEOUT_MS);
    } catch (error) {
      if (rpcDenied(error)) throw this.deniedError();
      throw localError("direct_full_access_patch_target_unavailable", "The selected patch target is unavailable.");
    }
    const bytes = Buffer.from(String(result?.dataBase64 || ""), "base64");
    if (bytes.length > MAX_PATCH_TARGET_BYTES || bytes.length !== Number(meta.size)) {
      throw localError("direct_full_access_patch_target_changed", "The selected patch target changed during bounded validation.");
    }
    return { exists: true, bytes };
  }

  async assertWritable(grant, resolved, input) {
    if (grant?.sandboxMode === "danger-full-access") return;
    if (grant?.sandboxMode === "read-only") {
      throw localError(
        "direct_access_profile_write_blocked",
        "Read-only access does not allow file changes. Ask the user to switch Access to Workspace or Full access.",
      );
    }
    const session = await this.session(input);
    const realRoot = await this.realPath(session, resolved, resolved.root);
    const realTarget = await this.realPath(session, resolved);
    if (!pathInside(resolved.platform, realRoot, realTarget)) {
      throw localError(
        "direct_access_profile_path_outside_workspace",
        "Workspace access only allows changes inside the project folder. Ask the user to switch Access to Full access to change files outside it.",
      );
    }
  }

  // Revalidates every target before writing any, like LocalFilePort; the
  // writes themselves are exec-server's plain per-file writes.
  async commit(grant, plans, input) {
    for (const plan of plans) {
      await this.assertWritable(grant, plan._resolved, input);
      if (!plan.beforeExists) {
        const current = await this.readPatchTarget(plan._resolved, "create", input, grant);
        if (current.exists) throw localError("direct_full_access_patch_target_exists", "Patch create target appeared before apply.");
        continue;
      }
      const current = await this.readPatchTarget(plan._resolved, plan.operation === "delete" ? "delete" : "update", input, grant);
      if (!current.exists || sha256(current.bytes.toString("utf8")) !== plan.beforeDigest) {
        throw localError("direct_full_access_patch_conflict", "The selected patch target changed before apply.");
      }
    }
    const session = await this.session(input);
    const sandbox = this.sandbox(grant, session);
    for (const plan of plans) {
      const resolved = plan._resolved;
      const api = pathApiFor(resolved.platform);
      const uri = (target) => pathToExecUri(target, resolved.platform);
      try {
        if (plan.operation === "delete") {
          await session.connection.request("fs/remove", { path: uri(resolved.target), recursive: false, force: false, sandbox }, FILE_REQUEST_TIMEOUT_MS);
          continue;
        }
        if (!plan.beforeExists) {
          await session.connection.request("fs/createDirectory", { path: uri(api.dirname(resolved.target)), recursive: true, sandbox }, FILE_REQUEST_TIMEOUT_MS);
        }
        await session.connection.request("fs/writeFile", {
          path: uri(resolved.target),
          dataBase64: Buffer.from(plan._afterText, "utf8").toString("base64"),
          sandbox,
        }, FILE_REQUEST_TIMEOUT_MS);
      } catch (error) {
        if (rpcDenied(error)) {
          throw localError(
            "direct_access_profile_path_outside_workspace",
            "The sandbox for this access profile refused the change. Ask the user to switch Access to Full access to change files outside the project folder.",
          );
        }
        throw localError("direct_full_access_patch_apply_failed", `Applying the patch failed: ${normalizeString(error?.message, "exec-server error")}`);
      }
    }
  }
}

module.exports = {
  CodexExecServerFilePort,
  CodexExecServerProcessBackend,
  CodexExecServerProcessHandle,
  commandEnvironmentAdditions,
};
