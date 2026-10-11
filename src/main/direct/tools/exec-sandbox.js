"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SANDBOXED_MODES = new Set(["read-only", "workspace-write"]);
const SANDBOX_HIDDEN_DIRECTORIES = Object.freeze(["/mnt", "/run/WSL"]);

// Credential-store policy for the sandboxed profiles (Workspace, Read only):
// commands and read_file must not reach the harness's own credentials. Full
// access is deliberately unrestricted, like a native full-access agent.
function credentialPathKey(target, options = {}) {
  const fileSystem = options.fs || fs;
  const windows = (options.platform || process.platform) === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  let resolved = String(target || "");
  try { resolved = fileSystem.realpathSync(resolved); } catch {}
  const normalized = pathApi.resolve(resolved);
  return windows ? normalized.toLowerCase() : normalized;
}

function isCredentialStorePath(target, options = {}) {
  const segments = String(target || "").split(/[\\/]+/).filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.length >= 2 && segments[segments.length - 1] === "auth.json"
    && [".codex", "direct-auth"].includes(segments[segments.length - 2])) return true;
  const key = credentialPathKey(target, options);
  return discoverCredentialStoreFiles(options).some((candidate) => credentialPathKey(candidate, options) === key);
}

function discoverCredentialStoreFiles(options = {}) {
  const fileSystem = options.fs || fs;
  const env = options.env || process.env;
  const windows = (options.platform || process.platform) === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  const home = normalizeString(windows ? env.USERPROFILE || options.homedir : options.homedir, os.homedir());
  const isFile = (candidate) => {
    try { return fileSystem.statSync(candidate).isFile(); } catch { return false; }
  };
  const candidates = new Set();
  if (normalizeString(env.CODEX_HOME, "")) candidates.add(pathApi.join(env.CODEX_HOME, "auth.json"));
  if (normalizeString(options.codexHome, "")) candidates.add(pathApi.join(options.codexHome, "auth.json"));
  for (const candidate of [env.CODEX_DIRECT_CODEX_AUTH_FILE, env.CODEX_AUTH_FILE]) {
    if (normalizeString(candidate, "")) candidates.add(candidate);
  }
  if (home) {
    candidates.add(pathApi.join(home, ".codex", "auth.json"));
    // The auth store's own default outside Electron.
    candidates.add(pathApi.join(home, ".codex-review-shell", "direct-auth", "auth.json"));
  }
  // Direct's store lives in the app's userData: <config>/<app>/direct-auth or
  // <config>/<app>/<profile>/direct-auth, where <config> is ~/.config on
  // Linux and %APPDATA% on Windows.
  const configRoot = windows
    ? normalizeString(env.APPDATA, home ? pathApi.join(home, "AppData", "Roaming") : "")
    : (home ? pathApi.join(home, ".config") : "");
  if (configRoot) {
    let apps = [];
    try { apps = fileSystem.readdirSync(configRoot); } catch {}
    for (const app of apps.slice(0, 200)) {
      const appRoot = pathApi.join(configRoot, app);
      candidates.add(pathApi.join(appRoot, "direct-auth", "auth.json"));
      let profiles = [];
      try { profiles = fileSystem.readdirSync(appRoot); } catch {}
      for (const profile of profiles.slice(0, 50)) {
        candidates.add(pathApi.join(appRoot, profile, "direct-auth", "auth.json"));
      }
    }
  }
  return [...candidates].filter(isFile).sort();
}

/**
 * Why a sandboxed profile may not read `target` (a resolved absolute path),
 * or "" if it may. Mirrors what the sandboxed shell can see.
 */
function sandboxedReadRefusal(target, options = {}) {
  const resolved = String(target || "");
  if (isCredentialStorePath(resolved, options)) return "direct_access_profile_credential_store_hidden";
  if ((options.platform || process.platform) === "win32") return "";
  const root = normalizeString(options.workspaceRoot, "");
  const insideWorkspace = Boolean(root) && (resolved === root || resolved.startsWith(`${root.replace(/\/+$/, "")}/`));
  if (insideWorkspace) return "";
  for (const hidden of SANDBOX_HIDDEN_DIRECTORIES) {
    if (resolved === hidden || resolved.startsWith(`${hidden}/`)) return "direct_access_profile_path_hidden";
  }
  return "";
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sandboxError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.userActionable = true;
  return error;
}

// A WSL workspace is directly reachable only when this process itself runs
// inside that distro, and a Windows workspace only from Windows. Otherwise
// the environment's own executor runs it.
function workspaceExecutesLocally(kind, project = {}, options = {}) {
  const workspaceKind = normalizeString(kind, "local");
  const platform = options.platform || process.platform;
  if (workspaceKind === "local") return true;
  if (workspaceKind === "windows") return platform === "win32";
  if (workspaceKind !== "wsl") return false;
  const env = options.env || process.env;
  const currentDistro = normalizeString(env.WSL_DISTRO_NAME, "");
  if (platform !== "linux" || !currentDistro) return false;
  const workspace = project && typeof project.workspace === "object" ? project.workspace : {};
  const wantedDistro = normalizeString(workspace.distro, "");
  return !wantedDistro || wantedDistro.toLowerCase() === currentDistro.toLowerCase();
}

function findExecutableOnPath(name, env = process.env) {
  const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

class BubblewrapExecSandbox {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.executable = normalizeString(options.executable, "");
    this.env = options.env || process.env;
    this.homedir = options.homedir || os.homedir();
    this.codexHome = normalizeString(options.codexHome, "");
    this.fs = options.fs || fs;
    this.resolved = null;
  }

  directoryExists(target) {
    try { return this.fs.statSync(target).isDirectory(); } catch { return false; }
  }

  credentialStoreFiles() {
    const options = { platform: "linux", homedir: this.homedir, codexHome: this.codexHome, env: this.env, fs: this.fs };
    return [...new Set(discoverCredentialStoreFiles(options).map((candidate) => credentialPathKey(candidate, options)))];
  }

  resolveExecutable() {
    if (this.resolved !== null) return this.resolved;
    if (this.platform !== "linux") {
      this.resolved = "";
    } else if (this.executable) {
      this.resolved = this.executable;
    } else {
      this.resolved = findExecutableOnPath("bwrap", this.env);
    }
    return this.resolved;
  }

  available() {
    return Boolean(this.resolveExecutable());
  }

  /**
   * Returns the spawn command/args that run `command` inside a sandbox where
   * the whole filesystem is read-only, the network is unshared, and only the
   * workspace root (workspace-write) plus /tmp stay writable.
   */
  wrap(spec = {}) {
    const sandboxMode = normalizeString(spec.sandboxMode, "");
    if (!SANDBOXED_MODES.has(sandboxMode)) {
      throw sandboxError("direct_exec_sandbox_mode_invalid", "Sandbox wrapping requires read-only or workspace-write mode.");
    }
    const executable = this.resolveExecutable();
    if (!executable) {
      throw sandboxError(
        "direct_stateful_exec_sandbox_unavailable",
        "Commands in Workspace and Read-only access run inside a sandbox, and no sandbox is available on this host (bubblewrap on Linux is required). Ask the user to switch Access to Full access if the command must run.",
      );
    }
    const root = normalizeString(spec.root, "");
    const cwd = normalizeString(spec.cwd, root);
    if (!root || !path.isAbsolute(root) || !path.isAbsolute(cwd)) {
      throw sandboxError("direct_exec_sandbox_root_invalid", "Sandboxed exec requires an absolute workspace root and cwd.");
    }
    const args = [
      "--die-with-parent",
      "--unshare-net",
      "--unshare-pid",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
    ];
    // Hidden paths come before the workspace bind so a workspace under /mnt is
    // re-exposed. /mnt holds the Windows drives and /run/WSL the interop
    // sockets; with either visible, a sandboxed command could start a Windows
    // process that runs outside the sandbox.
    for (const hidden of SANDBOX_HIDDEN_DIRECTORIES) {
      if (this.directoryExists(hidden)) args.push("--tmpfs", hidden);
    }
    // bwrap applies mounts in order: the workspace bind comes after /tmp so
    // a workspace that lives under /tmp stays visible in both modes.
    if (sandboxMode === "workspace-write") {
      if (fs.existsSync("/tmp")) args.push("--bind", "/tmp", "/tmp");
      args.push("--bind", root, root);
    } else {
      args.push("--tmpfs", "/tmp");
      args.push("--ro-bind", root, root);
    }
    // Parent mounts would otherwise expose the original credential files again.
    for (const credentialFile of this.credentialStoreFiles()) {
      args.push("--ro-bind", "/dev/null", credentialFile);
    }
    args.push("--chdir", cwd, "--");
    const shellCommand = typeof spec.shellCommand === "string" ? spec.shellCommand : "";
    if (shellCommand) {
      args.push("/bin/sh", "-c", shellCommand);
    } else {
      const command = normalizeString(spec.command, "");
      if (!command) throw sandboxError("direct_stateful_exec_command_invalid", "Sandboxed exec requires a command.");
      args.push(command, ...(Array.isArray(spec.args) ? spec.args.map(String) : []));
    }
    return {
      command: executable,
      args,
      launcher: "bubblewrap",
      sandboxMode,
      networkAccess: false,
      writableRoots: sandboxMode === "workspace-write" ? ["workspace", "tmp"] : ["private_tmp"],
    };
  }
}

module.exports = {
  BubblewrapExecSandbox,
  SANDBOXED_MODES,
  SANDBOX_HIDDEN_DIRECTORIES,
  discoverCredentialStoreFiles,
  isCredentialStorePath,
  sandboxedReadRefusal,
  workspaceExecutesLocally,
};
