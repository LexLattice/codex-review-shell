"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SANDBOXED_MODES = new Set(["read-only", "workspace-write"]);

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
// inside that distro.  From a Windows host the Linux path is not a local path.
function workspaceExecutesLocally(kind, project = {}, options = {}) {
  const workspaceKind = normalizeString(kind, "local");
  if (workspaceKind === "local") return true;
  if (workspaceKind !== "wsl") return false;
  const platform = options.platform || process.platform;
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
    this.resolved = null;
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
    // bwrap applies mounts in order: the workspace bind comes after /tmp so
    // a workspace that lives under /tmp stays visible in both modes.
    if (sandboxMode === "workspace-write") {
      if (fs.existsSync("/tmp")) args.push("--bind", "/tmp", "/tmp");
      args.push("--bind", root, root);
    } else {
      args.push("--tmpfs", "/tmp");
      args.push("--ro-bind", root, root);
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
  workspaceExecutesLocally,
};
