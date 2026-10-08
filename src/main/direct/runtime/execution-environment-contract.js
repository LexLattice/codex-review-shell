"use strict";

// The model-facing contract for a thread's execution environment: which OS
// and shell its tools run in, how paths and line endings work there, and
// what its access profile allows. The same facts render into the turn
// instructions, specialize the shell-dependent tool descriptions, and appear
// in the self-constitution snapshot. Facts never carry raw paths.

const fs = require("node:fs");
const path = require("node:path");
const { findExecutableOnPath } = require("../../../shared/executor-protocol");
const { grantAccessProfile } = require("../authority/direct-thread-harness-grant");
const { workspaceExecutesLocally } = require("../tools/exec-sandbox");

const EXECUTION_ENVIRONMENT_FACTS_SCHEMA = "direct_execution_environment_facts@1";
const POWERSHELL_ARGS = Object.freeze(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
// Redirected PowerShell output otherwise uses the console's OEM code page,
// which mangles anything outside ASCII.
const POWERSHELL_UTF8_PRELUDE = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The native shell invocation for a command string in an environment:
 * `bash -c` on Linux (falling back to `sh -c`), PowerShell on Windows
 * (`pwsh` when installed, otherwise Windows PowerShell 5.1). Shared by the
 * local process backend and the executor so both run commands the same way.
 * Not a login shell: sourcing a profile costs ~0.4s per command (nvm), and
 * executors are already started through a login shell, so commands inherit
 * the login PATH anyway.
 */
function windowsPowerShell(options = {}) {
  const platform = "win32";
  const env = options.env || process.env;
  const fileExists = options.fileExists || fs.existsSync;
  const programFiles = normalizeString(env.ProgramFiles || env.PROGRAMFILES, "C:\\Program Files");
  const pwsh = [
    findExecutableOnPath("pwsh", { platform, env, fileExists }),
    path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
  ].find((candidate) => candidate && fileExists(candidate));
  if (pwsh) return { command: pwsh, flavor: "pwsh" };
  const systemRoot = normalizeString(env.SystemRoot || env.SYSTEMROOT, "C:\\Windows");
  return {
    command: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    flavor: "windows-powershell",
  };
}

function nativeShellCommand(shellCommand, options = {}) {
  const platform = options.platform || process.platform;
  const fileExists = options.fileExists || fs.existsSync;
  if (platform === "win32") {
    const powershell = windowsPowerShell(options);
    // In a terminal the command may prompt, so it isn't -NonInteractive.
    const args = options.terminal === true ? POWERSHELL_ARGS.filter((arg) => arg !== "-NonInteractive") : POWERSHELL_ARGS;
    const script = shellCommand ? `${POWERSHELL_UTF8_PRELUDE}${shellCommand}` : shellCommand;
    return { command: powershell.command, args: [...args, script], shell: "powershell", flavor: powershell.flavor };
  }
  const bash = ["/bin/bash", "/usr/bin/bash"].find((candidate) => fileExists(candidate));
  if (bash) return { command: bash, args: ["-c", shellCommand], shell: "bash", flavor: "bash" };
  return { command: "/bin/sh", args: ["-c", shellCommand], shell: "sh", flavor: "sh" };
}

// A PowerShell started ahead of time that waits for one command on its first
// stdin line (base64 UTF-8) and runs it as `-Command <script>` would: the
// script is dot-sourced at the top level and a failing last statement exits 1.
// Startup (~0.4 s for pwsh) is then paid before the command arrives, and
// stdin after that line belongs to the command.
const POWERSHELL_PREWARM_BOOTSTRAP = `${POWERSHELL_UTF8_PRELUDE}$__l=[Console]::In.ReadLine();if($null -eq $__l){exit 0};$__b=[scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($__l)));Remove-Variable __l;. $__b`;

function prewarmedPowerShellCommand(options = {}) {
  const powershell = windowsPowerShell(options);
  return { command: powershell.command, args: [...POWERSHELL_ARGS, POWERSHELL_PREWARM_BOOTSTRAP], shell: "powershell", flavor: powershell.flavor };
}

function prewarmedPowerShellScriptLine(shellCommand = "") {
  return `${Buffer.from(`${shellCommand}\n;if(-not $?){exit 1}`, "utf8").toString("base64")}\n`;
}

/**
 * The shell a person gets in a terminal there: PowerShell (pwsh when
 * installed) with their profile on Windows; their login shell ($SHELL, else
 * bash) as a login shell on Linux and WSL.
 */
function nativeInteractiveShell(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fileExists = options.fileExists || fs.existsSync;
  if (platform === "win32") {
    const powershell = windowsPowerShell(options);
    return { command: powershell.command, args: ["-NoLogo"], shell: "powershell", flavor: powershell.flavor };
  }
  const preferred = normalizeString(env.SHELL, "");
  const shell = [preferred, "/bin/bash", "/usr/bin/bash", "/bin/sh"].find((candidate) => candidate && path.posix.isAbsolute(candidate) && fileExists(candidate)) || "/bin/sh";
  return { command: shell, args: ["-l"], shell: path.posix.basename(shell), flavor: path.posix.basename(shell) };
}

function environmentKindFor(workspaceKind, hostPlatform, env) {
  if (workspaceKind === "wsl") return "wsl";
  if (workspaceKind === "windows") return "windows";
  if (hostPlatform === "win32") return "windows";
  if (hostPlatform === "darwin") return "macos";
  return normalizeString(env.WSL_DISTRO_NAME, "") ? "wsl" : "linux";
}

function shellFactsFor(kind, options) {
  if (kind === "windows") {
    // Only a Windows host can see which PowerShell is installed; from
    // elsewhere, report the family without a flavor.
    if (options.hostPlatform === "win32") {
      const invocation = nativeShellCommand("", { platform: "win32", env: options.env, fileExists: options.fileExists });
      return {
        name: "powershell",
        flavor: invocation.flavor,
        invocation: `${invocation.flavor === "pwsh" ? "pwsh" : "powershell.exe"} ${POWERSHELL_ARGS.join(" ")} <cmd>`,
      };
    }
    return { name: "powershell", flavor: "", invocation: `pwsh ${POWERSHELL_ARGS.join(" ")} <cmd>` };
  }
  // Executors and the local backend both run `bash -c` whenever bash exists.
  const bashLocal = options.executesLocally
    ? ["/bin/bash", "/usr/bin/bash"].some((candidate) => options.fileExists(candidate))
    : true;
  return bashLocal
    ? { name: "bash", flavor: "bash", invocation: "bash -c <cmd>" }
    : { name: "sh", flavor: "sh", invocation: "sh -c <cmd>" };
}

function accessFactsFor(grant, kind) {
  const profile = grant ? grantAccessProfile(grant) : "";
  if (profile === "full_access") {
    return { accessProfile: profile, sandboxMode: "danger-full-access", networkAccess: true, networkEnforced: false, writableScope: "anywhere", hidden: [] };
  }
  if (profile === "workspace" || profile === "read_only") {
    const posix = kind !== "windows";
    // Windows has no way to block a command's network without admin rights
    // (see DIRECT_WINDOWS_CONTAINMENT_DECISION.md), so it is reported open.
    return {
      accessProfile: profile,
      sandboxMode: profile === "workspace" ? "workspace-write" : "read-only",
      networkAccess: !posix,
      networkEnforced: posix,
      writableScope: profile === "workspace" ? "workspace_and_tmp" : "none",
      hidden: [
        ...(posix ? ["windows_drives", "wsl_interop"] : ["wsl"]),
        "credential_stores",
      ],
    };
  }
  return { accessProfile: "restricted", sandboxMode: "", networkAccess: null, networkEnforced: false, writableScope: "per_call_approval", hidden: [] };
}

function resolveExecutionEnvironmentFacts(input = {}) {
  const grant = isPlainObject(input.grant) ? input.grant : null;
  const project = isPlainObject(input.project) ? input.project : {};
  const session = isPlainObject(input.session) ? input.session : {};
  const hostPlatform = input.hostPlatform || process.platform;
  const env = input.env || process.env;
  const fileExists = input.fileExists || fs.existsSync;
  const workspace = isPlainObject(session.workspace) && Object.keys(session.workspace).length
    ? session.workspace
    : isPlainObject(project.workspace) ? project.workspace : {};
  const workspaceKind = normalizeString(grant?.executionEnvironment?.kind || workspace.kind, "local");
  const kind = environmentKindFor(workspaceKind, hostPlatform, env);
  const executesLocally = typeof input.workspaceLocalityResolver === "function"
    ? input.workspaceLocalityResolver(workspaceKind, project)
    : workspaceExecutesLocally(workspaceKind, project);
  const shell = shellFactsFor(kind, { hostPlatform, env, fileExists, executesLocally });
  const access = accessFactsFor(grant, kind);
  return {
    schema: EXECUTION_ENVIRONMENT_FACTS_SCHEMA,
    environmentKind: kind,
    distro: kind === "wsl" ? normalizeString(workspace.distro || env.WSL_DISTRO_NAME, "") : "",
    os: kind === "windows" ? "windows" : kind === "macos" ? "macos" : "linux",
    shell,
    pathStyle: kind === "windows" ? "windows" : "posix",
    defaultLineEnding: kind === "windows" ? "crlf" : "lf",
    executesVia: executesLocally ? "host" : "environment_executor",
    ...access,
    rawPathIncluded: false,
  };
}

function environmentLabel(facts) {
  if (facts.environmentKind === "wsl") return `WSL${facts.distro ? ` (${facts.distro})` : ""}, Linux`;
  if (facts.environmentKind === "windows") return "Windows";
  if (facts.environmentKind === "macos") return "macOS";
  return "Linux";
}

function shellLabel(facts) {
  if (facts.shell.name === "powershell") {
    return facts.shell.flavor === "windows-powershell" ? "Windows PowerShell 5.1" : "PowerShell (pwsh)";
  }
  return facts.shell.name;
}

function accessSentence(facts) {
  if (facts.accessProfile === "full_access") {
    return "Access: Full access. No sandbox; commands and file changes can reach the whole machine and the network.";
  }
  if (facts.accessProfile === "workspace" || facts.accessProfile === "read_only") {
    const windows = facts.environmentKind === "windows";
    const tmp = windows ? "a private TEMP folder" : "/tmp";
    const writes = facts.accessProfile === "workspace"
      ? `File changes and command writes are limited to the project folder${facts.writableScope === "workspace_and_tmp" ? ` and ${tmp}` : ""}.`
      : "No file changes; commands run read-only.";
    const network = facts.networkEnforced
      ? " No network."
      : " The network is not blocked on Windows; use it only when the task needs it.";
    const hidden = facts.hidden.includes("windows_drives")
      ? " Windows drives (/mnt), WSL interop, and credential stores are not visible."
      : facts.hidden.includes("wsl")
        ? " WSL and credential stores are not reachable."
        : facts.hidden.includes("credential_stores") ? " Credential stores are not readable." : "";
    return `Access: ${facts.accessProfile === "workspace" ? "Workspace" : "Read only"}. ${writes}${network}${hidden} If a task needs more, ask the user to switch Access.`;
  }
  return "Access: restricted. File reads, patches, and commands each need the user's approval.";
}

/** The environment block appended to every implementation turn's instructions. */
function renderExecutionEnvironmentInstructions(facts) {
  if (!isPlainObject(facts) || facts.schema !== EXECUTION_ENVIRONMENT_FACTS_SCHEMA) return "";
  const windows = facts.environmentKind === "windows";
  return [
    "Execution environment (authoritative for this thread):",
    `- Environment: ${environmentLabel(facts)}. Tools run natively here${facts.executesVia === "environment_executor" ? " through this environment's own executor" : ""}; there is no other operating system to reach through wrappers.`,
    `- Shell: ${shellLabel(facts)}. exec_command runs \`cmd\` as \`${facts.shell.invocation}\`, starting in the project folder. Write commands in ${windows ? "PowerShell syntax (for example Get-ChildItem, Select-String, $env:NAME)" : `${facts.shell.name} syntax (for example ls, grep, $NAME)`}.`,
    `- Paths: ${windows ? "Windows paths with backslashes (C:\\...)" : "POSIX paths with forward slashes"}. Use project-relative paths for read_file and apply_patch.`,
    `- Line endings: new files default to ${facts.defaultLineEnding.toUpperCase()}.`,
    `- ${accessSentence(facts)}`,
  ].join("\n");
}

function withDescription(schema, description, parameterDescriptions = {}) {
  const next = { ...schema, description };
  if (isPlainObject(schema.parameters?.properties)) {
    const properties = { ...schema.parameters.properties };
    for (const [name, text] of Object.entries(parameterDescriptions)) {
      if (isPlainObject(properties[name])) properties[name] = { ...properties[name], description: text };
    }
    next.parameters = { ...schema.parameters, properties };
  }
  return next;
}

/** Specializes the shell- and path-dependent tool descriptions. */
function applyEnvironmentToToolSchemas(tools, facts) {
  if (!Array.isArray(tools) || !isPlainObject(facts) || facts.schema !== EXECUTION_ENVIRONMENT_FACTS_SCHEMA) return tools;
  const windows = facts.environmentKind === "windows";
  const env = environmentLabel(facts);
  const shell = shellLabel(facts);
  const pathHint = windows ? "Windows path" : "POSIX path";
  return tools.map((tool) => {
    if (!isPlainObject(tool)) return tool;
    if (tool.name === "exec_command") {
      return withDescription(
        tool,
        `Run a ${shell} command in ${env}. \`cmd\` runs as \`${facts.shell.invocation}\` and starts a process session; poll or answer prompts with write_stdin. Use command plus args to run an executable directly without the shell.`,
        {
          cmd: `${shell} command string, for example ${windows ? "\"Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 20\"" : "\"ls -la && npm test\""}.`,
          cwd: `Working directory as a project-relative ${pathHint}${facts.accessProfile === "full_access" ? " or an absolute path" : ""}.`,
        },
      );
    }
    if (tool.name === "apply_patch") {
      return withDescription(
        tool,
        `Apply a patch to files in ${env}. Accepts a git-style unified diff or the *** Begin Patch format. Use project-relative ${pathHint}s${facts.accessProfile === "full_access" ? " (absolute paths are allowed)" : ""}; new files default to ${facts.defaultLineEnding.toUpperCase()} line endings.`,
      );
    }
    if (tool.name === "read_file") {
      return withDescription(
        tool,
        `Read one UTF-8 text file in ${env} by project-relative ${pathHint}${facts.accessProfile === "full_access" ? " or absolute path" : ""}.`,
        { path: `Project-relative ${pathHint}${facts.accessProfile === "full_access" ? " or absolute path" : ""}.` },
      );
    }
    return tool;
  });
}

/**
 * The copy the self-constitution snapshot carries. Facts hold no raw paths,
 * so the snapshot keeps them whole; instructions and tool descriptions are
 * rendered from this same copy.
 */
function selfConstitutionEnvironmentProjection(facts) {
  if (!isPlainObject(facts) || facts.schema !== EXECUTION_ENVIRONMENT_FACTS_SCHEMA) return null;
  return JSON.parse(JSON.stringify({ ...facts, rawPathIncluded: false }));
}

module.exports = {
  EXECUTION_ENVIRONMENT_FACTS_SCHEMA,
  applyEnvironmentToToolSchemas,
  nativeInteractiveShell,
  nativeShellCommand,
  prewarmedPowerShellCommand,
  prewarmedPowerShellScriptLine,
  renderExecutionEnvironmentInstructions,
  resolveExecutionEnvironmentFacts,
  selfConstitutionEnvironmentProjection,
};
