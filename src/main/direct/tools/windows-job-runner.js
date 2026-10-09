"use strict";

// Windows containment for Direct commands, per
// docs/DIRECT_WINDOWS_CONTAINMENT_DECISION.md. Every Windows command runs
// under direct-job-runner.exe (windows-job-runner.cs): a Job Object with
// kill-on-close and no breakaway for every access profile, Low integrity for
// Workspace, Low integrity plus a write-restricted token for Read only, a
// private scratch TEMP, and no-read-up labels on credential stores. The
// network is not blocked on Windows.
//
// The runner is built at first use by the .NET Framework compiler that ships
// with Windows and cached by source digest, so no binary lives in the repo.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discoverCredentialStoreFiles } = require("./exec-sandbox");
const { normalizePtySize } = require("./pty-frames");

const WINDOWS_JOB_LAUNCHER = "windows_job_object";
const WINDOWS_JOB_RUNNER_SOURCE = path.join(__dirname, "windows-job-runner.cs");
const WINDOWS_JOB_RUNNER_EXE = "direct-job-runner.exe";
const BUILD_RETRY_MS = 60_000;
const WINDOWS_SANDBOX_MODES = new Set(["danger-full-access", "workspace-write", "read-only"]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function runnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.userActionable = true;
  return error;
}

// Quoting that CommandLineToArgvW and the MSVC runtime parse back into the
// same argv: backslashes are literal except before a quote or the closing
// quote, where they are doubled.
function quoteWindowsArgument(value) {
  const text = String(value ?? "");
  if (text && !/[\s"]/.test(text)) return text;
  let quoted = "\"";
  let backslashes = 0;
  for (const character of text) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === "\"") {
      quoted += `${"\\".repeat(backslashes * 2 + 1)}"`;
    } else {
      quoted += `${"\\".repeat(backslashes)}${character}`;
    }
    backslashes = 0;
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

function windowsCommandLine(command, args = []) {
  return [command, ...args].map(quoteWindowsArgument).join(" ");
}

function defaultRunnerRoot(env = process.env) {
  const override = normalizeString(env.DIRECT_JOB_RUNNER_DIR, "");
  if (override) return override;
  const localAppData = normalizeString(env.LOCALAPPDATA, "") || path.win32.join(os.homedir(), "AppData", "Local");
  return path.win32.join(localAppData, "codex-review-shell", "direct-job-runner");
}

// Scratch folders are removed when their command closes; a host or executor
// that died abruptly leaves them behind. Older than this, they are swept on
// the next start (another app instance's live scratch is younger, and a file
// still open inside one makes its removal fail, which is ignored).
const STALE_SCRATCH_MS = 24 * 60 * 60 * 1000;
const sweptScratchRoots = new Set();

async function sweepStaleScratch(scratchRoot, options = {}) {
  const fsp = options.fs?.promises || fs.promises;
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const maxAgeMs = Number(options.maxAgeMs) > 0 ? Number(options.maxAgeMs) : STALE_SCRATCH_MS;
  let entries;
  try {
    entries = await fsp.readdir(scratchRoot, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: 0 };
  }
  let removed = 0;
  let kept = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{16}$/.test(entry.name)) continue;
    const dir = path.join(scratchRoot, entry.name);
    try {
      const stats = await fsp.stat(dir);
      if (now - stats.mtimeMs < maxAgeMs) {
        kept += 1;
        continue;
      }
      await fsp.rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      kept += 1;
    }
  }
  return { removed, kept };
}

function compilerCandidates(env = process.env) {
  const systemRoot = normalizeString(env.SystemRoot || env.SYSTEMROOT || env.windir, "C:\\Windows");
  return [
    path.win32.join(systemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.win32.join(systemRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
}

/** Builds direct-job-runner.exe once per source digest and caches the path. */
class WindowsJobRunner {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.fs = options.fs || fs;
    this.spawnSync = options.spawnSync || spawnSync;
    this.sourcePath = options.sourcePath || WINDOWS_JOB_RUNNER_SOURCE;
    this.rootDir = options.rootDir || defaultRunnerRoot(this.env);
    this.compilers = options.compilers || compilerCandidates(this.env);
    this.cachedPath = "";
    this.failure = null;
    this.failedAt = 0;
  }

  executable() {
    if (this.cachedPath) return this.cachedPath;
    if (this.failure && Date.now() - this.failedAt < BUILD_RETRY_MS) throw this.failure;
    try {
      this.cachedPath = this.build();
      this.failure = null;
      return this.cachedPath;
    } catch (error) {
      this.failure = error;
      this.failedAt = Date.now();
      throw error;
    }
  }

  cacheLocation() {
    const source = this.fs.readFileSync(this.sourcePath, "utf8");
    const digest = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
    const dir = path.win32.join(this.rootDir, digest);
    return { source, dir, exe: path.win32.join(dir, WINDOWS_JOB_RUNNER_EXE) };
  }

  /** Whether commands can be contained here, without spawning anything. */
  status() {
    const base = { kind: WINDOWS_JOB_LAUNCHER };
    if (this.platform !== "win32") return { ...base, available: false, built: false, blockerCode: "direct_windows_job_runner_unsupported" };
    if (this.cachedPath) return { ...base, available: true, built: true, blockerCode: "" };
    try {
      if (this.fs.existsSync(this.cacheLocation().exe)) return { ...base, available: true, built: true, blockerCode: "" };
    } catch {
      return { ...base, available: false, built: false, blockerCode: "direct_windows_job_runner_source_missing" };
    }
    return this.compilers.some((candidate) => this.fs.existsSync(candidate))
      ? { ...base, available: true, built: false, blockerCode: "" }
      : { ...base, available: false, built: false, blockerCode: "direct_windows_job_runner_compiler_missing" };
  }

  build() {
    if (this.platform !== "win32") {
      throw runnerError("direct_windows_job_runner_unsupported", "The Windows job runner only runs on Windows.");
    }
    const { source, dir, exe } = this.cacheLocation();
    if (this.fs.existsSync(exe)) return exe;
    const compiler = this.compilers.find((candidate) => this.fs.existsSync(candidate));
    if (!compiler) {
      throw runnerError(
        "direct_windows_job_runner_compiler_missing",
        "the .NET Framework compiler (csc.exe) is not installed",
      );
    }
    this.fs.mkdirSync(dir, { recursive: true });
    // Host and executor may build at the same moment: each compiles to its
    // own name and the first rename wins.
    const tag = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const tempSource = path.win32.join(dir, `runner-${tag}.cs`);
    const tempExe = path.win32.join(dir, `runner-${tag}.exe`);
    this.fs.writeFileSync(tempSource, source, "utf8");
    let result;
    try {
      result = this.spawnSync(compiler, ["/nologo", "/optimize+", `/out:${tempExe}`, tempSource], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 120_000,
      });
    } finally {
      try { this.fs.rmSync(tempSource, { force: true }); } catch {}
    }
    if (result?.status !== 0 || !this.fs.existsSync(tempExe)) {
      try { this.fs.rmSync(tempExe, { force: true }); } catch {}
      const detail = `${result?.stdout || ""}${result?.stderr || ""}${result?.error?.message || ""}`.trim().slice(0, 400);
      throw runnerError("direct_windows_job_runner_build_failed", `csc.exe could not build it${detail ? `: ${detail}` : ""}`);
    }
    try {
      this.fs.renameSync(tempExe, exe);
    } catch (error) {
      try { this.fs.rmSync(tempExe, { force: true }); } catch {}
      if (!this.fs.existsSync(exe)) throw error;
    }
    return exe;
  }
}

/**
 * The exec sandbox for Windows. Unlike bubblewrap it also wraps Full access,
 * because containment (the job) applies to every profile.
 */
class WindowsJobSandbox {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.runner = options.runner || new WindowsJobRunner({ platform: this.platform, env: this.env });
    this.scratchRoot = options.scratchRoot || path.win32.join(this.runner.rootDir || defaultRunnerRoot(this.env), "scratch");
    this.credentialStoreFiles = typeof options.credentialStoreFiles === "function"
      ? options.credentialStoreFiles
      : () => discoverCredentialStoreFiles({ platform: "win32", env: this.env, homedir: os.homedir() });
    this.containsFullAccess = true;
    if (this.platform === "win32" && options.sweepScratch !== false && !sweptScratchRoots.has(this.scratchRoot)) {
      sweptScratchRoots.add(this.scratchRoot);
      sweepStaleScratch(this.scratchRoot).catch(() => {});
    }
  }

  available() {
    try {
      this.runner.executable();
      return true;
    } catch {
      return false;
    }
  }

  wrap(spec = {}) {
    const sandboxMode = normalizeString(spec.sandboxMode, "danger-full-access");
    if (!WINDOWS_SANDBOX_MODES.has(sandboxMode)) {
      throw runnerError("direct_exec_sandbox_mode_invalid", "Windows exec requires a known sandbox mode.");
    }
    const command = normalizeString(spec.command, "");
    if (!command) throw runnerError("direct_stateful_exec_command_invalid", "Windows exec requires a command.");
    let executable;
    try {
      executable = this.runner.executable();
    } catch (error) {
      throw runnerError(
        "direct_stateful_exec_windows_containment_unavailable",
        `Commands on Windows run inside a Job Object so their whole process tree can be stopped, and Direct could not prepare that runner (${error.message}). Commands can't run in this environment until it can.`,
      );
    }
    const args = [];
    const env = {};
    let scratchDir = "";
    let integrity = "medium";
    if (sandboxMode !== "danger-full-access") {
      integrity = sandboxMode === "read-only" ? "low-read-only" : "low";
      args.push("--integrity", integrity);
      if (sandboxMode === "workspace-write") {
        const root = normalizeString(spec.root, "");
        if (!root || !path.win32.isAbsolute(root)) {
          throw runnerError("direct_exec_sandbox_root_invalid", "Workspace exec on Windows requires an absolute project folder.");
        }
        args.push("--label-low", root, "--project-sid", projectSidFor(root));
      }
      for (const file of this.credentialStoreFiles()) args.push("--hide", file);
      scratchDir = path.win32.join(this.scratchRoot, crypto.randomBytes(8).toString("hex"));
      args.push("--scratch", scratchDir);
      env.TEMP = scratchDir;
      env.TMP = scratchDir;
    }
    // A terminal: the runner hosts the command in a pseudoconsole and its
    // stdin becomes the frame channel (pty-frames.js).
    const tty = normalizePtySize(spec.tty);
    if (tty) args.push("--conpty", String(tty.rows), String(tty.cols));
    // A receipt channel (cancel, then proof that the whole job is gone), for
    // callers that must prove quiescence (the workspace backend).
    let controlPath = "";
    if (spec.control === true && !tty) {
      controlPath = path.win32.join(this.scratchRoot, `control-${crypto.randomBytes(8).toString("hex")}`);
      fs.mkdirSync(this.scratchRoot, { recursive: true });
      args.push("--control", controlPath);
    }
    const commandLine = windowsCommandLine(command, Array.isArray(spec.args) ? spec.args.map(String) : []);
    args.push("--cmdline-b64", Buffer.from(commandLine, "utf8").toString("base64"));
    return {
      command: executable,
      args,
      tty,
      launcher: WINDOWS_JOB_LAUNCHER,
      sandboxMode,
      integrity,
      networkAccess: true,
      networkEnforced: false,
      env,
      scratchDir,
      controlPath,
      writableRoots: sandboxMode === "workspace-write" ? ["workspace", "scratch_tmp"] : sandboxMode === "read-only" ? ["scratch_tmp"] : ["anywhere"],
    };
  }
}

// The runner's receipt for a job started with `control: true`: with
// `cancel`, the job is stopped first. Resolves with
// { quiesced, containmentKind: "windows_job_object", jobClosed, ... }; a
// missing receipt (the runner died first, or no answer in time) is not
// proof and reports quiesced: false.
async function windowsJobReceipt(controlPath, options = {}) {
  const receiptPath = `${controlPath}.receipt`;
  const cancelPath = `${controlPath}.cancel`;
  if (!controlPath) return { quiesced: false, blockerCode: "workspace_windows_job_control_missing" };
  if (options.cancel === true && !fs.existsSync(receiptPath)) {
    try { fs.writeFileSync(cancelPath, ""); } catch {}
  }
  const deadline = Date.now() + Math.max(100, Number(options.timeoutMs) || 5_000);
  while (Date.now() < deadline) {
    if (fs.existsSync(receiptPath)) {
      try {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
        for (const file of [receiptPath, cancelPath]) {
          try { fs.rmSync(file, { force: true }); } catch {}
        }
        return {
          quiesced: receipt.quiesced === true,
          containmentKind: WINDOWS_JOB_LAUNCHER,
          jobClosed: receipt.jobClosed === true,
          activeProcesses: Number(receipt.activeProcesses),
          exitCode: Number(receipt.exitCode),
          blockerCode: receipt.quiesced === true ? "" : "workspace_windows_job_processes_remain",
        };
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { quiesced: false, containmentKind: WINDOWS_JOB_LAUNCHER, jobClosed: false, blockerCode: "workspace_windows_job_receipt_missing" };
}

// A project folder's own SID (domain-style, from a 128-bit hash of the
// folder, so it is the same each time): Workspace commands there are
// write-restricted to it.
function projectSidFor(root) {
  const normalized = path.win32.resolve(String(root)).replace(/[\\/]+$/, "").toLowerCase();
  const digest = crypto.createHash("sha256").update(`direct-project:${normalized}`).digest();
  const parts = [];
  for (let offset = 0; offset < 16; offset += 4) parts.push(digest.readUInt32LE(offset));
  return `S-1-5-21-${parts.join("-")}`;
}

module.exports = {
  STALE_SCRATCH_MS,
  projectSidFor,
  windowsJobReceipt,
  sweepStaleScratch,
  WINDOWS_JOB_LAUNCHER,
  WINDOWS_JOB_RUNNER_SOURCE,
  WindowsJobRunner,
  WindowsJobSandbox,
  defaultRunnerRoot,
  quoteWindowsArgument,
  windowsCommandLine,
};
