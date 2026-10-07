"use strict";

// Linux process-tree containment: a command runs as PID 1's child in a new
// user and PID namespace (util-linux `unshare`), so when it ends, or its
// launcher is killed, the kernel takes everything it started with it. Used by
// the executor for its processes and by the host for MCP servers it runs
// itself. No side effects at load time.

const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const TRUSTED_UNSHARE_PATH = "/usr/bin/unshare";
const TRUSTED_SETPRIV_PATH = "/usr/bin/setpriv";

let trustedUnshareIdentity = null;
let trustedSetprivChecked = null;

function sha256Digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

// Opens the launcher by descriptor after checking it is a root-owned,
// non-writable executable that didn't change while it was read, and pins
// its identity for the life of this process.
function openTrustedUnshareLauncher() {
  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(TRUSTED_UNSHARE_PATH, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== 0 ||
      (before.mode & 0o022) !== 0 ||
      (before.mode & 0o111) === 0
    ) {
      const error = new Error("The Linux process-containment launcher failed its ownership or mode invariant.");
      error.code = "workspace_linux_pid_namespace_launcher_untrusted";
      throw error;
    }
    const digest = sha256Digest(fs.readFileSync(fd));
    const after = fs.fstatSync(fd);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      const error = new Error("The Linux process-containment launcher changed during verification.");
      error.code = "workspace_linux_pid_namespace_launcher_changed";
      throw error;
    }
    const identity = {
      dev: String(after.dev),
      ino: String(after.ino),
      size: after.size,
      mode: after.mode & 0o777,
      uid: after.uid,
      gid: after.gid,
      digest,
    };
    const identityJson = canonicalJson(identity);
    if (trustedUnshareIdentity && canonicalJson(trustedUnshareIdentity) !== identityJson) {
      const error = new Error("The pinned Linux process-containment launcher identity drifted.");
      error.code = "workspace_linux_pid_namespace_launcher_identity_drift";
      throw error;
    }
    if (!trustedUnshareIdentity) trustedUnshareIdentity = identity;
    return { fd, identity };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    if (!error.code) error.code = "workspace_linux_pid_namespace_launcher_unavailable";
    throw error;
  }
}

function trustedSetprivAvailable() {
  if (trustedSetprivChecked !== null) return trustedSetprivChecked;
  try {
    const stat = fs.statSync(TRUSTED_SETPRIV_PATH);
    trustedSetprivChecked = stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0 && (stat.mode & 0o111) !== 0;
  } catch {
    trustedSetprivChecked = false;
  }
  return trustedSetprivChecked;
}

/**
 * Spawns `command args` in a new user+PID namespace. `options.env` is used
 * exactly as given; `options.dieWithParent` also ends the namespace when the
 * caller dies (setpriv PDEATHSIG, when a trusted setpriv exists). Other
 * options pass to child_process.spawn.
 */
function spawnInLinuxPidNamespace(command, args = [], options = {}) {
  const { fd, identity } = openTrustedUnshareLauncher();
  const requestedStdio = Array.isArray(options.stdio)
    ? options.stdio.slice(0, 3)
    : ["ignore", "pipe", "pipe"];
  while (requestedStdio.length < 3) requestedStdio.push("pipe");
  const unshareArgs = [
    "--user",
    "--map-current-user",
    "--pid",
    "--fork",
    "--kill-child=SIGKILL",
    "--mount-proc",
    "--",
    command,
    ...args,
  ];
  // unshare does not die with its parent, so a SIGKILLed caller would
  // orphan the namespace. setpriv sets PDEATHSIG and execs the launcher in
  // place; the signal survives exec, and --kill-child then takes the tree.
  const dieWithParent = options.dieWithParent === true && trustedSetprivAvailable();
  const { dieWithParent: _dieWithParent, env, stdio: _stdio, ...spawnOptions } = options;
  let child;
  try {
    child = spawn(
      dieWithParent ? TRUSTED_SETPRIV_PATH : "/proc/self/fd/3",
      dieWithParent ? ["--pdeathsig", "SIGKILL", "--", "/proc/self/fd/3", ...unshareArgs] : unshareArgs,
      {
        ...spawnOptions,
        env: { ...(env || {}) },
        stdio: [...requestedStdio, fd],
        shell: false,
        windowsHide: true,
        detached: true,
      },
    );
    child.workspaceProcessContainment = {
      guaranteed: true,
      kind: "linux_pid_namespace",
      launcherDigest: identity.digest,
      diesWithParent: dieWithParent,
    };
    return child;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  TRUSTED_SETPRIV_PATH,
  TRUSTED_UNSHARE_PATH,
  openTrustedUnshareLauncher,
  spawnInLinuxPidNamespace,
  trustedSetprivAvailable,
};
