"use strict";

// Codex exec-server as an alternative to Direct's own executor for agent
// commands and file tools. One `codex exec-server --listen stdio` runs per
// execution environment (this host, or a WSL distro opened from Windows) and
// speaks JSON-RPC, one message per line. Grants, budgets, approvals, and
// output admission stay on the host as with Direct's executor; only starting
// processes and touching files moves into exec-server, which applies the
// sandbox sent with each request.

const { execFileSync, spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { BASE_COMMAND_ENVIRONMENT_KEYS, dedupedPath } = require("./exec-process-backends");
const { discoverCredentialStoreFiles, workspaceExecutesLocally } = require("./exec-sandbox");
const { findExecutableOnPath } = require("../../../shared/executor-protocol");
const { normalizeWorkspace } = require("../../workspace-backend");

const CODEX_EXEC_SERVER_BACKEND_ID = "codex-exec-server";
// The oldest exec-server whose process, file, and sandbox requests were
// checked against this client.
const MIN_EXEC_SERVER_VERSION = "0.160.0";
const INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const CONCURRENT_REQUESTS = 4;
const STDERR_TAIL_CHARS = 2_000;
const WINDOWS_SANDBOX_LEVELS = new Set(["restricted-token", "elevated", "mxc"]);
// Read only commands' scratch folders (Linux): SCRATCH_PARENT/SCRATCH_PREFIX<session>.
const SCRATCH_PARENT = "/tmp";
const SCRATCH_PREFIX = "codex-direct-ro-";
const STALE_SCRATCH_MS = 60 * 60_000;
// What a command may inherit from exec-server's own environment, matching
// what Direct's backends give commands.
const COMMAND_ENVIRONMENT_KEYS = Object.freeze([...BASE_COMMAND_ENVIRONMENT_KEYS, "LANG", "LC_ALL"]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function execServerError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function versionAtLeast(version, minimum) {
  const parse = (text) => String(text || "").split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return true;
}

function pathApiFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function encodeSegments(text) {
  return text.split("/").map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":")).join("/");
}

// exec-server takes paths as file URIs in its own environment's path rules.
function pathToExecUri(nativePath, platform) {
  const text = String(nativePath || "");
  if (platform === "win32") {
    const normalized = path.win32.resolve(text).replace(/\\/g, "/");
    if (normalized.startsWith("//")) return `file:${encodeSegments(normalized)}`;
    return `file:///${encodeSegments(normalized)}`;
  }
  return `file://${encodeSegments(path.posix.resolve(text))}`;
}

function execUriToPath(uri, platform) {
  const text = String(uri || "");
  if (!text.startsWith("file:")) return text;
  let rest = text.slice("file:".length);
  if (rest.startsWith("///")) rest = rest.slice(2);
  else if (rest.startsWith("//") && platform === "win32") return path.win32.normalize(decodeURIComponent(rest));
  const decoded = decodeURIComponent(rest);
  if (platform === "win32") return path.win32.normalize(decoded.replace(/^\/([A-Za-z]:)/, "$1"));
  return decoded;
}

function isAbsoluteFor(platform, text) {
  return platform === "win32"
    ? /^[A-Za-z]:[\\/]/.test(text) || /^[\\/]{2}/.test(text)
    : text.startsWith("/");
}

function pathInside(platform, root, target) {
  const api = pathApiFor(platform);
  const fold = (value) => (platform === "win32" ? value.toLowerCase() : value);
  const relative = api.relative(fold(root), fold(target));
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative));
}

/**
 * The environment a project's commands and files live in, as exec-server
 * sees it: which exec-server serves it (`key`), its path rules, and the
 * workspace root in its own paths.
 */
function execServerEnvironmentFor(project = {}, options = {}) {
  const hostPlatform = options.hostPlatform || process.platform;
  const env = options.env || process.env;
  const workspace = normalizeWorkspace(project?.workspace, project?.repoPath, options.fallbackRoot);
  const unsupported = (what) => execServerError(
    "direct_codex_exec_server_environment_unsupported",
    `Codex exec-server can't reach ${what} from this host yet. Switch Command execution back to Direct.`,
    { userActionable: true },
  );
  if (workspace.kind === "wsl") {
    if (workspaceExecutesLocally("wsl", project, { platform: hostPlatform, env })) {
      return { key: "local", kind: "wsl", platform: "linux", distro: "", root: workspace.linuxPath, local: true };
    }
    if (hostPlatform !== "win32") throw unsupported("a WSL workspace in another distro");
    const distro = normalizeString(workspace.distro, "");
    return { key: `wsl:${distro || "default"}`, kind: "wsl", platform: "linux", distro, root: workspace.linuxPath, local: false };
  }
  if (workspace.kind === "windows") {
    const root = path.win32.resolve(workspace.windowsPath);
    if (hostPlatform === "win32") return { key: "local", kind: "windows", platform: "win32", distro: "", root, local: true };
    // From WSL, Windows' own codex.exe runs through interop.
    if (hostPlatform === "linux" && normalizeString(env.WSL_DISTRO_NAME, "")) {
      return { key: "windows", kind: "windows", platform: "win32", distro: "", root, local: false };
    }
    throw unsupported("a Windows workspace");
  }
  const root = pathApiFor(hostPlatform).resolve(normalizeString(workspace.localPath, options.fallbackRoot || "."));
  return {
    key: "local",
    kind: "local",
    platform: hostPlatform === "win32" ? "win32" : hostPlatform === "darwin" ? "darwin" : "linux",
    distro: "",
    root,
    local: true,
  };
}

function shellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'"'"'`)}'`;
}

// Starts exec-server from a login shell (the PATH Direct's executor gives
// commands) but with only the variables commands are allowed to see, so a
// request's env policy can't hand a command anything else. codex installed
// with nvm is often only on an interactive shell's PATH, so that is the
// fallback for finding it.
function posixExecServerScript(binary) {
  const keys = COMMAND_ENVIRONMENT_KEYS.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
  const assignments = keys.map((key) => `\${${key}:+"${key}=$${key}"}`).join(" ");
  const quoted = shellSingleQuote(binary);
  return [
    "set -e",
    `codex_bin="$(command -v ${quoted} || bash -ic ${shellSingleQuote(`command -v ${quoted}`)} 2>/dev/null </dev/null | tail -n 1 || true)"`,
    "if [ -z \"$codex_bin\" ]; then echo 'Codex CLI (codex) is not installed in this environment.' >&2; exit 127; fi",
    `exec env -i ${assignments} "$codex_bin" exec-server --listen stdio --concurrent-requests ${CONCURRENT_REQUESTS}`,
  ].join("; ");
}

// npm installs codex on Windows as a .cmd shim around a Node launcher; the
// native binary it wraps (with the launcher's PATH addition) runs instead.
function windowsCodexFromShim(found, fileExists) {
  if (/\.exe$/i.test(found)) return fileExists(found) ? { command: found, pathPrepend: [] } : null;
  const packageRoot = path.win32.join(path.win32.dirname(found), "node_modules", "@openai", "codex");
  const layouts = [
    ["codex-win32-x64", "x86_64-pc-windows-msvc"],
    ["codex-win32-arm64", "aarch64-pc-windows-msvc"],
  ];
  for (const [pkg, triple] of layouts) {
    const vendor = path.win32.join(packageRoot, "node_modules", "@openai", pkg, "vendor", triple);
    const command = path.win32.join(vendor, "bin", "codex.exe");
    if (fileExists(command)) {
      const codexPath = path.win32.join(vendor, "codex-path");
      return { command, pathPrepend: fileExists(codexPath) ? [codexPath] : [] };
    }
  }
  return null;
}

function codexNotFound(where) {
  return execServerError(
    "direct_codex_exec_server_unavailable",
    `Codex CLI (codex.exe) wasn't found ${where}. Install it (npm install -g @openai/codex) or switch Command execution back to Direct.`,
    { userActionable: true },
  );
}

function windowsCodexExecutable(env = process.env, fileExists = fs.existsSync) {
  const configured = normalizeString(env.CODEX_DIRECT_EXEC_SERVER_BINARY, "");
  if (configured) return { command: configured, pathPrepend: [] };
  const found = findExecutableOnPath("codex", { platform: "win32", env, fileExists });
  const resolved = found ? windowsCodexFromShim(found, fileExists) : null;
  if (resolved) return resolved;
  throw codexNotFound("on this host");
}

// A Windows path as WSL mounts it (default automount root).
function wslMountPathFor(windowsPath) {
  const text = String(windowsPath || "");
  if (!/^[A-Za-z]:[\\/]/.test(text)) return "";
  return `/mnt/${text[0].toLowerCase()}${text.slice(2).replace(/\\/g, "/")}`;
}

const WINDOWS_CMD_FROM_WSL = "/mnt/c/Windows/System32/cmd.exe";

function whereCodexFromWsl() {
  // cmd.exe warns about (and falls back from) a UNC working folder.
  return execFileSync(WINDOWS_CMD_FROM_WSL, ["/d", "/c", "where", "codex"], {
    cwd: "/mnt/c",
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// From WSL: Windows' codex.exe, as a /mnt path this host can execute. The
// Windows exec-server adds its own codex-path to commands' PATH.
function windowsCodexExecutableFromWsl(env = process.env, options = {}) {
  const fileExists = options.fileExists || fs.existsSync;
  const exists = (windowsPath) => fileExists(wslMountPathFor(windowsPath));
  const configured = normalizeString(env.CODEX_DIRECT_WINDOWS_EXEC_SERVER_BINARY, "");
  if (configured) return configured.startsWith("/") ? configured : wslMountPathFor(configured);
  let output = "";
  try {
    output = (options.whereCodex || whereCodexFromWsl)();
  } catch {
    output = "";
  }
  for (const line of String(output).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (!/\.(exe|cmd)$/i.test(line)) continue;
    const resolved = windowsCodexFromShim(line, exists);
    if (resolved) return wslMountPathFor(resolved.command);
  }
  throw codexNotFound("on Windows");
}

function hostCommandEnvironment(env = process.env, pathPrepend = []) {
  const result = {};
  for (const key of COMMAND_ENVIRONMENT_KEYS) {
    if (env[key] !== undefined) result[key] = env[key];
  }
  if (process.platform === "win32" && result.PATH === undefined && env.Path !== undefined) result.PATH = env.Path;
  if (pathPrepend.length) result.PATH = [...pathPrepend, result.PATH || ""].filter(Boolean).join(";");
  if (result.PATH) result.PATH = dedupedPath(result.PATH);
  return result;
}

/** How to start the exec-server for an environment from this host. */
function execServerLaunchSpec(environment, options = {}) {
  const hostPlatform = options.hostPlatform || process.platform;
  const env = options.env || process.env;
  const args = ["exec-server", "--listen", "stdio", "--concurrent-requests", String(CONCURRENT_REQUESTS)];
  if (environment.key === "windows") {
    // The Windows process gets Windows' own environment; only what interop
    // needs to reach it goes along (WSLENV is left out so no WSL variable
    // is shared into it).
    const launchEnv = {};
    for (const key of ["PATH", "HOME", "WSL_INTEROP", "WSL_DISTRO_NAME"]) {
      if (env[key] !== undefined) launchEnv[key] = env[key];
    }
    return {
      command: windowsCodexExecutableFromWsl(env, options),
      args,
      env: launchEnv,
      cwd: "/mnt/c",
      transport: "wsl_interop",
    };
  }
  if (environment.key !== "local") {
    const wslArgs = [];
    if (environment.distro) wslArgs.push("-d", environment.distro);
    // --exec: the script reaches bash as one argument, not re-parsed by the
    // distro's default shell.
    wslArgs.push("--cd", "~", "--exec", "bash", "-lc", posixExecServerScript(normalizeString(env.CODEX_DIRECT_WSL_EXEC_SERVER_BINARY, "codex")));
    return { command: "wsl.exe", args: wslArgs, env: hostCommandEnvironment(env), transport: "wsl.exe" };
  }
  if (hostPlatform === "win32") {
    const resolved = windowsCodexExecutable(env, options.fileExists);
    return { command: resolved.command, args, env: hostCommandEnvironment(env, resolved.pathPrepend), transport: "stdio" };
  }
  const shell = ["/bin/bash", "/usr/bin/bash"].find((candidate) => (options.fileExists || fs.existsSync)(candidate)) || "/bin/sh";
  return {
    command: shell,
    args: ["-lc", posixExecServerScript(normalizeString(env.CODEX_DIRECT_EXEC_SERVER_BINARY, "codex"))],
    env: hostCommandEnvironment(env),
    transport: "stdio",
  };
}

/**
 * The exec-server sandbox for a Direct access profile, or null for Full
 * access. Read only: read everything, write only `writableDirs` (a
 * command's own scratch folder, Linux only: Windows' restricted-token
 * sandbox refuses a read-only profile with any writable folder), no
 * network. Workspace:
 * also write the project folder and the temp folders. Both hide the
 * harness's credential stores and, in WSL, the Windows interop socket (and
 * the Windows drives unless the project lives on one).
 */
function execServerSandboxFor(sandboxMode, environment, info = {}, options = {}) {
  if (sandboxMode !== "read-only" && sandboxMode !== "workspace-write") return null;
  const platform = environment.platform === "win32" ? "win32" : "linux";
  const uri = (target) => pathToExecUri(target, platform);
  const special = (kind) => ({ type: "special", value: { kind } });
  const entries = [{ path: special("root"), access: "read" }];
  if (sandboxMode === "workspace-write") {
    entries.push({ path: special("project_roots"), access: "write" });
    entries.push({ path: special("tmpdir"), access: "write" });
    if (platform !== "win32") entries.push({ path: special("slash_tmp"), access: "write" });
  }
  for (const dir of Array.isArray(options.writableDirs) ? options.writableDirs : []) {
    entries.push({ path: { type: "path", path: uri(dir) }, access: "write" });
  }
  const level = normalizeString(options.windowsSandboxLevel, "restricted-token");
  // The restricted-token sandbox refuses any profile with denied paths
  // ("requires the elevated Windows sandbox backend"), so it can't hide
  // credential stores. The backend refuses sandboxed commands at that level;
  // file tools still use this profile and refuse credential paths host-side.
  const denials = !(platform === "win32" && level === "restricted-token");
  const deny = (target) => {
    if (denials) entries.push({ path: { type: "path", path: uri(target) }, access: "deny", missing_path_behavior: "skip" });
  };
  const api = pathApiFor(platform);
  const home = info.userHomeDir ? execUriToPath(info.userHomeDir, platform) : "";
  const credentialFiles = new Set();
  if (home) {
    credentialFiles.add(api.join(home, ".codex", "auth.json"));
    credentialFiles.add(api.join(home, ".codex-review-shell", "direct-auth", "auth.json"));
  }
  // Only this host's own stores can be discovered from here.
  if (environment.local) {
    for (const file of (options.discoverCredentials || discoverCredentialStoreFiles)({ platform: process.platform })) credentialFiles.add(file);
  }
  for (const file of credentialFiles) deny(file);
  if (platform === "linux") {
    deny("/run/WSL");
    if (!pathInside("linux", "/mnt", environment.root)) deny("/mnt");
  }
  const rootUri = uri(environment.root);
  return {
    permissions: {
      type: "managed",
      file_system: { type: "restricted", entries },
      network: "restricted",
    },
    cwd: rootUri,
    workspaceRoots: [rootUri],
    ...(info.userHomeDir ? { userHomeDir: info.userHomeDir } : {}),
    windowsSandboxLevel: platform === "win32" ? (WINDOWS_SANDBOX_LEVELS.has(level) ? level : "restricted-token") : "disabled",
  };
}

class CodexExecServerConnection extends EventEmitter {
  constructor(options = {}) {
    super();
    this.key = options.key;
    this.spec = options.spec;
    this.spawnImpl = options.spawnImpl || spawn;
    this.child = null;
    this.state = "starting";
    this.nextId = 1;
    this.pending = new Map();
    this.late = new Map();
    this.stderrTail = "";
    this.environmentInfo = null;
    this.error = null;
    this.startedAtMs = 0;
    this.readyAtMs = 0;
  }

  async start() {
    this.startedAtMs = Date.now();
    const child = this.spawnImpl(this.spec.command, this.spec.args, {
      env: this.spec.env,
      ...(this.spec.cwd ? { cwd: this.spec.cwd } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stderr?.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_TAIL_CHARS);
    });
    child.stdin?.on("error", () => {});
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.on("error", (error) => this.handleExit(error));
    child.on("close", (code, signal) => this.handleExit(null, code, signal));
    let response;
    try {
      response = await this.request("initialize", { clientName: "codex-review-shell-direct" }, INITIALIZE_TIMEOUT_MS);
    } catch (error) {
      this.close();
      throw this.startError(error);
    }
    const info = response?.environmentInfo || {};
    const version = normalizeString(info.executorVersion, "0.0.0");
    if (!versionAtLeast(version, MIN_EXEC_SERVER_VERSION)) {
      this.close();
      throw execServerError(
        "direct_codex_exec_server_too_old",
        `Codex exec-server ${version} is older than ${MIN_EXEC_SERVER_VERSION}, the oldest this app supports. Update the Codex CLI in this environment.`,
        { userActionable: true },
      );
    }
    this.environmentInfo = info;
    this.sessionId = normalizeString(response?.sessionId, "");
    this.notify("initialized");
    this.state = "ready";
    this.readyAtMs = Date.now();
    return this;
  }

  startError(error) {
    const detail = normalizeString(this.stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(" "), "");
    return execServerError(
      "direct_codex_exec_server_unavailable",
      `Codex exec-server didn't start${detail ? `: ${detail}` : ` (${error?.message || "no response"})`}`,
      { userActionable: true, cause: error },
    );
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message && message.id !== undefined && this.late.has(message.id)) {
      const onLate = this.late.get(message.id);
      this.late.delete(message.id);
      onLate(message.error ? execServerError("direct_codex_exec_server_request_failed", normalizeString(message.error.message, "exec-server request failed")) : null, message.result);
      return;
    }
    if (message && message.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(execServerError("direct_codex_exec_server_request_failed", normalizeString(message.error.message, "exec-server request failed"), {
          rpcCode: message.error.code,
          method: entry.method,
        }));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message && typeof message.method === "string") this.emit("notification", message.method, message.params || {});
  }

  handleExit(error, code, signal) {
    if (this.state === "closed") return;
    this.state = "closed";
    const detail = normalizeString(this.stderrTail.split(/\r?\n/).filter(Boolean).slice(-2).join(" "), "");
    this.error = execServerError(
      "direct_codex_exec_server_lost",
      `Codex exec-server stopped${error ? ` (${error.code || error.message})` : code !== undefined ? ` (exit ${code ?? signal})` : ""}${detail ? `: ${detail}` : ""}.`,
    );
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(this.error);
    }
    this.pending.clear();
    // exec-server stops the processes it started when it exits, so a late
    // answer has nothing left to act on.
    this.late.clear();
    this.emit("closed", { error: this.error });
  }

  // `options.onLate(error, result)` gets the answer if it arrives after the
  // request timed out (a JSON-RPC timeout doesn't cancel the server's work).
  request(method, params = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, options = {}) {
    if (this.state === "closed" || !this.child?.stdin?.writable) {
      return Promise.reject(this.error || execServerError("direct_codex_exec_server_lost", "Codex exec-server isn't running."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (typeof options.onLate === "function") this.late.set(id, options.onLate);
        reject(execServerError("direct_codex_exec_server_timeout", `Codex exec-server didn't answer ${method} in ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    if (this.state === "closed" || !this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`);
  }

  // exec-server exits when its input closes; stop it outright if it lingers.
  close() {
    const child = this.child;
    if (!child) return;
    try { child.stdin?.end(); } catch {}
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(); } catch {}
      }
    }, 2_000);
    timer.unref?.();
  }

  status() {
    return {
      key: this.key,
      state: this.state,
      transport: this.spec?.transport || "stdio",
      executorVersion: normalizeString(this.environmentInfo?.executorVersion, ""),
      platformOs: normalizeString(this.environmentInfo?.platformOs, ""),
      shell: normalizeString(this.environmentInfo?.shell?.name, ""),
      startupMs: this.readyAtMs ? this.readyAtMs - this.startedAtMs : null,
      error: this.state === "closed" ? normalizeString(this.error?.message, "") : "",
    };
  }
}

/** One exec-server connection per environment, started on first use. */
class CodexExecServerManager {
  constructor(options = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.hostPlatform = options.hostPlatform || process.platform;
    this.env = options.env || process.env;
    this.fallbackRoot = options.fallbackRoot || "";
    this.launchSpecFor = typeof options.launchSpecFor === "function" ? options.launchSpecFor : execServerLaunchSpec;
    this.connections = new Map();
    this.lastErrors = new Map();
    this.pendingScratch = new Map();
    this.now = typeof options.now === "function" ? options.now : Date.now;
  }

  // A Read only command's scratch folder whose exec-server died before it
  // could be removed; removed once that environment has a connection again.
  queueScratchCleanup(key, dir) {
    if (!this.pendingScratch.has(key)) this.pendingScratch.set(key, new Set());
    this.pendingScratch.get(key).add(dir);
  }

  // Removes queued scratch folders, and any left by an app that didn't get
  // to (a crash, another instance): a command can't outlive the 10-minute
  // hard timeout, so a folder untouched for an hour belongs to no command.
  async reclaimScratch(connection, environment) {
    if (environment.platform !== "linux") return;
    const uri = (target) => pathToExecUri(target, "linux");
    const queued = [...(this.pendingScratch.get(environment.key) || [])];
    this.pendingScratch.delete(environment.key);
    const stale = [];
    try {
      const listing = await connection.request("fs/readDirectory", { path: uri(SCRATCH_PARENT) });
      for (const entry of Array.isArray(listing?.entries) ? listing.entries : []) {
        const name = String(entry?.fileName || "");
        if (!entry?.isDirectory || !name.startsWith(SCRATCH_PREFIX)) continue;
        const dir = path.posix.join(SCRATCH_PARENT, name);
        if (queued.includes(dir)) continue;
        const metadata = await connection.request("fs/getMetadata", { path: uri(dir) }).catch(() => null);
        if (!metadata || metadata.isSymlink || !metadata.isDirectory) continue;
        if (this.now() - Number(metadata.modifiedAtMs || 0) > STALE_SCRATCH_MS) stale.push(dir);
      }
    } catch {
      // Listing is best effort; the queued folders are still removed.
    }
    for (const dir of [...queued, ...stale]) {
      await connection.request("fs/remove", { path: uri(dir), recursive: true, force: true }).catch(() => {});
    }
  }

  environmentFor(project) {
    return execServerEnvironmentFor(project, { hostPlatform: this.hostPlatform, env: this.env, fallbackRoot: this.fallbackRoot });
  }

  async connectionFor(project) {
    const environment = this.environmentFor(project);
    let entry = this.connections.get(environment.key);
    if (entry && entry.connection.state === "closed") {
      this.connections.delete(environment.key);
      entry = null;
    }
    if (!entry) {
      const spec = this.launchSpecFor(environment, { hostPlatform: this.hostPlatform, env: this.env });
      const connection = new CodexExecServerConnection({ key: environment.key, spec, spawnImpl: this.spawnImpl });
      const ready = connection.start().then(
        () => {
          this.lastErrors.delete(environment.key);
          this.reclaimScratch(connection, environment).catch(() => {});
          return connection;
        },
        (error) => {
          if (this.connections.get(environment.key)?.connection === connection) this.connections.delete(environment.key);
          this.lastErrors.set(environment.key, normalizeString(error?.message, "unavailable"));
          throw error;
        },
      );
      connection.on("closed", ({ error }) => {
        if (this.connections.get(environment.key)?.connection === connection) this.connections.delete(environment.key);
        this.lastErrors.set(environment.key, normalizeString(error?.message, "stopped"));
      });
      entry = { connection, ready };
      this.connections.set(environment.key, entry);
    }
    const connection = await entry.ready;
    return { connection, environment, info: connection.environmentInfo || {} };
  }

  status() {
    return {
      connections: [...this.connections.values()].map((entry) => entry.connection.status()),
      lastErrors: Object.fromEntries(this.lastErrors),
    };
  }

  disposeAll() {
    for (const entry of this.connections.values()) entry.connection.close();
    this.connections.clear();
  }
}

module.exports = {
  CODEX_EXEC_SERVER_BACKEND_ID,
  COMMAND_ENVIRONMENT_KEYS,
  CodexExecServerConnection,
  CodexExecServerManager,
  MIN_EXEC_SERVER_VERSION,
  SCRATCH_PARENT,
  SCRATCH_PREFIX,
  execServerEnvironmentFor,
  execServerError,
  execServerLaunchSpec,
  execServerSandboxFor,
  execUriToPath,
  isAbsoluteFor,
  pathApiFor,
  pathInside,
  pathToExecUri,
  posixExecServerScript,
  versionAtLeast,
  windowsCodexExecutable,
  windowsCodexExecutableFromWsl,
  wslMountPathFor,
};
