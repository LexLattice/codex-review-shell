"use strict";

// Contract between the Direct host and the per-environment executor (the
// resident workspace agent). Method names follow Codex's exec-server
// (`process/*`, `fs/*`) so the executor stays swappable. This module must stay
// dependency-free: it is loaded both by the host and by the executor running
// inside WSL or natively on Windows.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXECUTOR_PROTOCOL_NAME = "direct_environment_executor";
const EXECUTOR_PROTOCOL_VERSION = 1;
const ENVIRONMENT_DESCRIPTION_SCHEMA = "direct_environment_description@1";
const PUBLIC_ENVIRONMENT_DESCRIPTION_SCHEMA = "direct_environment_description_public@1";

const EXECUTOR_METHODS = Object.freeze({
  environmentDescribe: "environment/describe",
  processStart: "process/start",
  processWrite: "process/write",
  processRead: "process/read",
  processSignal: "process/signal",
  processWait: "process/wait",
  fsRead: "fs/read",
  fsApplyPlannedPatch: "fs/applyPlannedPatch",
  fsList: "fs/list",
  fsSearch: "fs/search",
  fsStat: "fs/stat",
});

// Methods this executor build actually serves. Later turns add to this list
// as each method is implemented.
const IMPLEMENTED_EXECUTOR_METHODS = Object.freeze([
  EXECUTOR_METHODS.environmentDescribe,
  EXECUTOR_METHODS.processStart,
  EXECUTOR_METHODS.processWrite,
  EXECUTOR_METHODS.processSignal,
]);

// Events the executor pushes for a process session. Each carries
// `processSessionId` (the host router's session id).
const EXECUTOR_PROCESS_EVENTS = Object.freeze({
  output: "process/output",
  activity: "process/activity",
  error: "process/error",
  exited: "process/exited",
});

const ENVIRONMENT_KINDS = new Set(["windows", "wsl", "linux", "macos", "unknown"]);
const SHELL_NAMES = new Set(["powershell", "bash", "sh", "unknown"]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathApiFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function findExecutableOnPath(name, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fileExists = options.fileExists || fs.existsSync;
  const api = pathApiFor(platform);
  const pathValue = env.PATH || env.Path || "";
  const dirs = String(pathValue).split(platform === "win32" ? ";" : ":").filter(Boolean);
  const extensions = platform === "win32"
    ? ["", ...String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((ext) => ext.toLowerCase())]
    : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = api.join(dir, `${name}${ext}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return "";
}

function environmentKindFor(platform, env, release) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") {
    if (normalizeString(env.WSL_DISTRO_NAME, "") || /microsoft|wsl/i.test(String(release || ""))) return "wsl";
    return "linux";
  }
  return "unknown";
}

// Shell facts come from the filesystem and environment only. Describing an
// environment must not spawn processes: the Windows executor refuses to create
// processes until Job Object containment exists.
function windowsShellFor(env, fileExists, platformOptions) {
  const programFiles = normalizeString(env.ProgramFiles || env.PROGRAMFILES, "C:\\Program Files");
  const pwshCandidates = [
    findExecutableOnPath("pwsh", platformOptions),
    path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
  ].filter(Boolean);
  const pwsh = pwshCandidates.find((candidate) => fileExists(candidate)) || "";
  if (pwsh) {
    const majorMatch = /[\\/]PowerShell[\\/](\d+)(?:[-.][^\\/]*)?[\\/]pwsh\.exe$/i.exec(pwsh);
    return {
      name: "powershell",
      flavor: "pwsh",
      path: pwsh,
      version: majorMatch ? `${majorMatch[1]}` : "",
      versionSource: majorMatch ? "install_path" : "unprobed",
      invocation: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
    };
  }
  const systemRoot = normalizeString(env.SystemRoot || env.SYSTEMROOT || env.windir, "C:\\Windows");
  const windowsPowerShell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return {
    name: "powershell",
    flavor: "windows-powershell",
    path: windowsPowerShell,
    version: "5.1",
    versionSource: "product_constant",
    available: fileExists(windowsPowerShell),
    invocation: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
  };
}

function posixShellFor(fileExists) {
  const bash = ["/bin/bash", "/usr/bin/bash"].find((candidate) => fileExists(candidate)) || "";
  if (bash) {
    return {
      name: "bash",
      flavor: "bash",
      path: bash,
      version: "",
      versionSource: "unprobed",
      invocation: ["-lc"],
    };
  }
  return {
    name: "sh",
    flavor: "sh",
    path: "/bin/sh",
    version: "",
    versionSource: "unprobed",
    invocation: ["-c"],
  };
}

/**
 * Describes the environment this process runs in. The executor answers
 * `environment/describe` with this; the host never computes it for another
 * environment.
 */
function describeExecutionEnvironment(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fileExists = options.fileExists || fs.existsSync;
  const release = options.release === undefined ? os.release() : options.release;
  const kind = environmentKindFor(platform, env, release);
  const platformOptions = { platform, env, fileExists };
  const shell = platform === "win32" ? windowsShellFor(env, fileExists, platformOptions) : posixShellFor(fileExists);
  const containment = isPlainObject(options.containment) ? options.containment : { available: false, kind: "unknown" };
  const bubblewrap = platform === "linux" ? findExecutableOnPath("bwrap", platformOptions) : "";
  return {
    schema: ENVIRONMENT_DESCRIPTION_SCHEMA,
    protocol: { name: EXECUTOR_PROTOCOL_NAME, version: EXECUTOR_PROTOCOL_VERSION },
    environmentKind: kind,
    distro: kind === "wsl" ? normalizeString(env.WSL_DISTRO_NAME, "") : "",
    os: {
      platform,
      release: String(release || ""),
      arch: options.arch || process.arch,
    },
    shell,
    pathStyle: platform === "win32" ? "windows" : "posix",
    pathSeparator: platform === "win32" ? "\\" : "/",
    defaultLineEnding: platform === "win32" ? "crlf" : "lf",
    home: options.homedir === undefined ? os.homedir() : options.homedir,
    temp: options.tmpdir === undefined ? os.tmpdir() : options.tmpdir,
    workspaceRoot: normalizeString(options.root, ""),
    workspaceKind: normalizeString(options.workspaceKind, ""),
    node: options.nodeVersion || process.version,
    capabilities: {
      processContainment: {
        available: containment.available === true,
        kind: normalizeString(containment.kind, "unknown"),
        blockerCode: normalizeString(containment.blockerCode, ""),
      },
      sandbox: bubblewrap
        ? { available: true, kind: "bubblewrap" }
        : { available: false, kind: "none" },
      pty: { available: false, kind: "none" },
    },
    methods: [...IMPLEMENTED_EXECUTOR_METHODS],
    rawPathIncluded: true,
  };
}

function validateEnvironmentDescription(description) {
  const errors = [];
  if (!isPlainObject(description) || description.schema !== ENVIRONMENT_DESCRIPTION_SCHEMA) {
    return ["environment_description_schema_mismatch"];
  }
  if (description.protocol?.name !== EXECUTOR_PROTOCOL_NAME) errors.push("environment_description_protocol_mismatch");
  if (!Number.isInteger(description.protocol?.version)) errors.push("environment_description_protocol_version_invalid");
  if (!ENVIRONMENT_KINDS.has(description.environmentKind)) errors.push("environment_description_kind_invalid");
  if (!isPlainObject(description.shell) || !SHELL_NAMES.has(description.shell.name)) errors.push("environment_description_shell_invalid");
  if (!["windows", "posix"].includes(description.pathStyle)) errors.push("environment_description_path_style_invalid");
  if (!Array.isArray(description.methods) || !description.methods.includes(EXECUTOR_METHODS.environmentDescribe)) {
    errors.push("environment_description_methods_invalid");
  }
  if (description.environmentKind === "windows" && (description.shell?.name !== "powershell" || description.pathStyle !== "windows")) {
    errors.push("environment_description_windows_inconsistent");
  }
  if (["wsl", "linux"].includes(description.environmentKind) && description.pathStyle !== "posix") {
    errors.push("environment_description_posix_inconsistent");
  }
  return errors;
}

/** Strips raw paths so the description can reach renderers and logs. */
function publicEnvironmentDescription(description) {
  if (!isPlainObject(description)) return null;
  const shell = isPlainObject(description.shell) ? description.shell : {};
  return {
    schema: PUBLIC_ENVIRONMENT_DESCRIPTION_SCHEMA,
    protocol: description.protocol,
    environmentKind: description.environmentKind,
    distro: normalizeString(description.distro, ""),
    os: description.os,
    shell: {
      name: shell.name,
      flavor: shell.flavor,
      executable: shell.path ? pathApiFor(description.pathStyle === "windows" ? "win32" : "linux").basename(shell.path) : "",
      version: normalizeString(shell.version, ""),
      versionSource: normalizeString(shell.versionSource, ""),
    },
    pathStyle: description.pathStyle,
    defaultLineEnding: description.defaultLineEnding,
    node: description.node,
    capabilities: description.capabilities,
    methods: Array.isArray(description.methods) ? [...description.methods] : [],
    rawPathIncluded: false,
  };
}

module.exports = {
  ENVIRONMENT_DESCRIPTION_SCHEMA,
  EXECUTOR_METHODS,
  EXECUTOR_PROCESS_EVENTS,
  EXECUTOR_PROTOCOL_NAME,
  EXECUTOR_PROTOCOL_VERSION,
  IMPLEMENTED_EXECUTOR_METHODS,
  PUBLIC_ENVIRONMENT_DESCRIPTION_SCHEMA,
  describeExecutionEnvironment,
  findExecutableOnPath,
  publicEnvironmentDescription,
  validateEnvironmentDescription,
};
