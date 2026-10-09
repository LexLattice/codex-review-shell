"use strict";

// What Direct takes from an environment's Codex home and project, read the
// way Codex reads it: MCP servers from config.toml (the user's, plus a
// trusted project's .codex/config.toml), AGENTS.md instructions, skills,
// and hooks. Direct's own additions live beside them in ~/.direct and
// <project>/.direct. Runs where the files are: in-process for the host's
// own environment, behind the executor's codex/context for another one.
// Dependency-free apart from the TOML reader (the executors load it).

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseToml } = require("../external/toml-lite");

const MCP_SERVER_NAME = /^[a-zA-Z0-9_:@/.-]+$/;
const DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;
const SKILL_MAX_DEPTH = 6;
const SKILL_MAX_DIRS = 2_000;
const SKILL_MAX_ENTRIES = 20_000;
const SKILL_FILE_MAX_BYTES = 256 * 1024;
const MAX_SKILLS = 500;
const HOOK_EVENTS = new Set([
  "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "UserPromptSubmit", "PreToolUse",
  "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "Stop", "Interrupt",
]);
const APPROVAL_MODES = new Set(["auto", "prompt", "writes", "approve"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readText(file, maxBytes = 4 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function exists(target) {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function samePath(a, b, platform) {
  const norm = (value) => {
    const resolved = path.resolve(String(value || "")).replace(/[\\/]+$/, "");
    return platform === "win32" ? resolved.toLowerCase().replace(/\//g, "\\") : resolved;
  };
  return Boolean(a) && Boolean(b) && norm(a) === norm(b);
}

function readTomlFile(file, errors) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return parseToml(text);
  } catch (error) {
    errors.push({ source: file, message: error.message });
    return null;
  }
}

// Directories from the nearest .git ancestor (Codex's default project-root
// marker) down to cwd; just cwd when there is none.
function projectDirectories(cwd) {
  const start = path.resolve(cwd);
  const chain = [];
  let current = start;
  let root = null;
  for (;;) {
    chain.push(current);
    if (exists(path.join(current, ".git"))) {
      root = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!root) return { gitRoot: "", dirs: [start] };
  return { gitRoot: root, dirs: chain.reverse() };
}

function trustLevel(userConfig, dirs, platform) {
  const projects = isPlainObject(userConfig?.projects) ? userConfig.projects : {};
  let level = "";
  let depth = -1;
  for (const [projectPath, entry] of Object.entries(projects)) {
    if (!isPlainObject(entry) || typeof entry.trust_level !== "string") continue;
    // The deepest configured ancestor decides (dirs run from the root down),
    // whatever order the entries are listed in.
    const matched = dirs.findIndex((dir) => samePath(dir, projectPath, platform));
    if (matched > depth) {
      depth = matched;
      level = entry.trust_level;
    }
  }
  return level;
}

function secondsToMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : undefined;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry) : undefined;
}

function stringMap(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v]));
}

// One [mcp_servers.<name>] table, in Codex's terms, with variables it names
// read from this environment.
function normalizeCodexMcpServer(name, raw, source, env) {
  const errors = [];
  if (!MCP_SERVER_NAME.test(name)) return { name, source, invalid: `server name "${name}" is not valid` };
  if (!isPlainObject(raw)) return { name, source, invalid: "the entry is not a table" };
  const command = str(raw.command);
  const url = str(raw.url);
  if (command && url) return { name, source, invalid: "a server has either command or url, not both" };
  if (!command && !url) return { name, source, invalid: "a server needs command or url" };
  if (raw.bearer_token !== undefined) return { name, source, invalid: "bearer_token isn't allowed; use bearer_token_env_var" };
  const tools = isPlainObject(raw.tools) ? raw.tools : {};
  const toolApprovalModes = {};
  for (const [toolName, toolConfig] of Object.entries(tools)) {
    if (isPlainObject(toolConfig) && APPROVAL_MODES.has(toolConfig.approval_mode)) toolApprovalModes[toolName] = toolConfig.approval_mode;
  }
  const server = {
    name,
    source,
    enabled: raw.enabled !== false,
    transport: url ? "streamable_http" : "stdio",
    startupTimeoutMs: secondsToMs(raw.startup_timeout_sec) ?? (Number.isInteger(raw.startup_timeout_ms) ? raw.startup_timeout_ms : undefined),
    toolTimeoutMs: secondsToMs(raw.tool_timeout_sec),
    enabledTools: stringList(raw.enabled_tools),
    disabledTools: stringList(raw.disabled_tools),
    defaultToolsApprovalMode: APPROVAL_MODES.has(raw.default_tools_approval_mode) ? raw.default_tools_approval_mode : "auto",
    toolApprovalModes,
    supportsParallelToolCalls: raw.supports_parallel_tool_calls === true,
  };
  if (command) {
    const envVars = (Array.isArray(raw.env_vars) ? raw.env_vars : [])
      .map((entry) => (typeof entry === "string" ? entry : isPlainObject(entry) ? str(entry.name) : ""))
      .filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry));
    Object.assign(server, {
      command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
      env: stringMap(raw.env),
      envVars,
      cwd: str(raw.cwd),
    });
  } else {
    const headers = stringMap(raw.http_headers);
    for (const [header, variable] of Object.entries(stringMap(raw.env_http_headers))) {
      const value = env[variable];
      if (typeof value === "string" && value.trim()) headers[header] = value;
    }
    const bearerVariable = str(raw.bearer_token_env_var);
    if (bearerVariable) {
      const token = env[bearerVariable];
      if (typeof token === "string" && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
      else errors.push(`bearer_token_env_var ${bearerVariable} is not set`);
    }
    if (!/^https?:\/\//i.test(url)) errors.push("url must be http or https");
    Object.assign(server, { url, headers });
  }
  if (errors.length) server.unavailable = errors.join("; ");
  return server;
}

function collectMcpServers(layers, env) {
  const byName = new Map();
  const invalid = [];
  for (const { config, source } of layers) {
    const servers = isPlainObject(config?.mcp_servers) ? config.mcp_servers : {};
    for (const [name, raw] of Object.entries(servers)) {
      const server = normalizeCodexMcpServer(name, raw, source, env);
      if (server.invalid) invalid.push({ name, source, message: server.invalid });
      else byName.set(name, server);
    }
  }
  return { servers: [...byName.values()], invalid };
}

function readInstructionsFile(dir, names) {
  for (const name of names) {
    const file = path.join(dir, name);
    const text = readText(file);
    if (text !== null && text.trim()) return { file, text };
  }
  return null;
}

// AGENTS.md as Codex reads it: the global file in CODEX_HOME (override
// first), then one file per directory from the project root down to cwd,
// within project_doc_max_bytes (later files are truncated).
function collectAgentsMd({ codexHome, dirs, userConfig, trust }) {
  const global = readInstructionsFile(codexHome, ["AGENTS.override.md", "AGENTS.md"]);
  const projectDocs = [];
  let truncated = false;
  if (trust !== "untrusted") {
    const fallback = stringList(userConfig?.project_doc_fallback_filenames) || [];
    const cap = Number.isInteger(userConfig?.project_doc_max_bytes) && userConfig.project_doc_max_bytes >= 0
      ? userConfig.project_doc_max_bytes
      : DEFAULT_PROJECT_DOC_MAX_BYTES;
    let remaining = cap;
    for (const dir of dirs) {
      const found = readInstructionsFile(dir, ["AGENTS.override.md", "AGENTS.md", ...fallback]);
      if (!found) continue;
      const bytes = Buffer.from(found.text, "utf8");
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const kept = bytes.length > remaining ? bytes.subarray(0, remaining).toString("utf8") : found.text;
      if (bytes.length > remaining) truncated = true;
      remaining -= Math.min(bytes.length, remaining);
      projectDocs.push({ dir, file: found.file, text: kept });
    }
  }
  return { global: global ? { file: global.file, text: global.text } : null, projectDocs, truncated };
}

// SKILL.md front matter: name (optional; the folder name otherwise),
// description (required), metadata.short-description.
function parseSkillFrontMatter(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return null;
  const fields = {};
  let parent = "";
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent, key, rawValue] = match;
    let value = rawValue.trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block = [];
      while (index + 1 < end && (/^\s+\S/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        index += 1;
        block.push(lines[index].trim());
      }
      value = block.join(value.startsWith("|") ? "\n" : " ").trim();
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!indent) {
      parent = value ? "" : key;
      if (value) fields[key] = value;
    } else if (parent) {
      fields[`${parent}.${key}`] = value;
    }
  }
  const collapse = (value) => String(value || "").replace(/\s+/g, " ").trim();
  return {
    name: collapse(fields.name),
    description: collapse(fields.description),
    shortDescription: collapse(fields["metadata.short-description"]),
  };
}

function discoverSkills(roots, skillsConfig, errors, platform) {
  const skills = [];
  const seenDocs = new Set();
  const rules = Array.isArray(skillsConfig?.config) ? skillsConfig.config.filter(isPlainObject) : [];
  const disabled = (skill) => {
    let enabled = true;
    for (const rule of rules) {
      if (typeof rule.enabled !== "boolean") continue;
      if ((typeof rule.name === "string" && rule.name === skill.name) || (typeof rule.path === "string" && samePath(rule.path, skill.path, platform))) {
        enabled = rule.enabled;
      }
    }
    return !enabled;
  };
  for (const root of roots) {
    if (!isDirectory(root.dir)) continue;
    let dirs = 0;
    let entries = 0;
    const visited = new Set();
    const walk = (dir, depth) => {
      if (depth > SKILL_MAX_DEPTH || dirs >= SKILL_MAX_DIRS || skills.length >= MAX_SKILLS) return;
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch {
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      dirs += 1;
      let listing;
      try {
        listing = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries += listing.length;
      if (entries > SKILL_MAX_ENTRIES) return;
      if (listing.some((entry) => entry.name === "SKILL.md" && entry.isFile())) {
        const file = path.join(dir, "SKILL.md");
        let canonical = file;
        try {
          canonical = fs.realpathSync(file);
        } catch {}
        if (!seenDocs.has(canonical)) {
          seenDocs.add(canonical);
          const text = readText(file, SKILL_FILE_MAX_BYTES);
          const parsed = text === null ? null : parseSkillFrontMatter(text);
          if (!parsed || !parsed.description) {
            errors.push({ source: file, message: "SKILL.md needs front matter with a description" });
          } else {
            const skill = {
              name: (parsed.name || path.basename(dir)).slice(0, 64),
              description: parsed.description,
              shortDescription: parsed.shortDescription,
              path: file,
              scope: root.scope,
            };
            if (!disabled(skill)) skills.push(skill);
          }
        }
      }
      for (const entry of listing) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          const child = path.join(dir, entry.name);
          if (entry.isSymbolicLink() && !isDirectory(child)) continue;
          walk(child, depth + 1);
        }
      }
    };
    walk(root.dir, 0);
  }
  return skills;
}

// Hooks from config.toml [hooks] and hooks.json, Codex's shape:
// { EventName: [ { matcher, hooks: [ { type: "command", command, ... } ] } ] }.
function collectHooks(sources, errors) {
  const hooks = [];
  for (const { table, source } of sources) {
    if (!isPlainObject(table)) continue;
    for (const [event, groups] of Object.entries(table)) {
      if (!HOOK_EVENTS.has(event)) continue;
      for (const group of Array.isArray(groups) ? groups : []) {
        if (!isPlainObject(group)) continue;
        const matcher = str(group.matcher);
        for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
          if (!isPlainObject(handler)) continue;
          if ((handler.type || "command") !== "command") {
            errors.push({ source, message: `hook type ${handler.type} isn't supported in Direct` });
            continue;
          }
          const command = str(handler.command);
          if (!command) continue;
          const timeout = Number(handler.timeout);
          const entry = {
            event,
            matcher,
            command,
            commandWindows: str(handler.commandWindows),
            timeoutSec: Number.isFinite(timeout) && timeout >= 1 ? Math.min(timeout, 3_600) : (event === "Interrupt" || event === "SessionEnd" ? 1 : 600),
            async: handler.async === true,
            statusMessage: str(handler.statusMessage),
            source,
          };
          // Trust is per exact hook: an edit needs a new approval.
          entry.id = `hook_${sha256(JSON.stringify([entry.event, entry.matcher, entry.command, entry.commandWindows, entry.source])).slice(0, 24)}`;
          hooks.push(entry);
        }
      }
    }
  }
  return hooks;
}

function readHooksJson(file, errors) {
  const text = readText(file);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed?.hooks) ? parsed.hooks : null;
  } catch (error) {
    errors.push({ source: file, message: `hooks.json: ${error.message}` });
    return null;
  }
}

function skillRootsFor({ codexHome, homedir, projectRoot, dirs, trusted }) {
  const directHome = path.join(homedir, ".direct");
  return [
    { dir: path.join(codexHome, "skills"), scope: "user" },
    { dir: path.join(homedir, ".agents", "skills"), scope: "user" },
    { dir: path.join(directHome, "skills"), scope: "direct-user" },
    ...(trusted ? dirs.map((dir) => ({ dir: path.join(dir, ".codex", "skills"), scope: "project" })) : []),
    ...dirs.map((dir) => ({ dir: path.join(dir, ".agents", "skills"), scope: "repo" })),
    ...(projectRoot ? [{ dir: path.join(projectRoot, ".direct", "skills"), scope: "direct-project" }] : []),
  ];
}

const SKILL_BODY_MAX_BYTES = 32 * 1024;

// A skill's SKILL.md for a `$name` mention, only from inside a skill root
// of this environment (and only a file named SKILL.md).
function readSkillBody(input = {}) {
  const env = isPlainObject(input.env) ? input.env : process.env;
  const homedir = input.homedir || os.homedir();
  const platform = input.platform || process.platform;
  const codexHome = str(env.CODEX_HOME).trim() || path.join(homedir, ".codex");
  const projectRoot = str(input.projectRoot);
  const { dirs } = projectRoot ? projectDirectories(projectRoot) : { dirs: [] };
  const userConfig = readTomlFile(path.join(codexHome, "config.toml"), []) || {};
  const trusted = dirs.length > 0 && trustLevel(userConfig, dirs, platform) === "trusted";
  const target = str(input.path);
  if (!target || path.basename(target) !== "SKILL.md") return null;
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return null;
  }
  const inside = skillRootsFor({ codexHome, homedir, projectRoot, dirs, trusted }).some((root) => {
    let rootReal;
    try {
      rootReal = fs.realpathSync(root.dir);
    } catch {
      return false;
    }
    const relative = path.relative(rootReal, real);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!inside) return null;
  let text = readText(real, 4 * 1024 * 1024);
  if (text === null) return null;
  let truncated = false;
  if (Buffer.byteLength(text, "utf8") > SKILL_BODY_MAX_BYTES) {
    text = Buffer.from(text, "utf8").subarray(0, SKILL_BODY_MAX_BYTES).toString("utf8");
    truncated = true;
  }
  return { path: target, text, truncated };
}

function readCodexEnvironmentContext(input = {}) {
  const env = isPlainObject(input.env) ? input.env : process.env;
  const homedir = input.homedir || os.homedir();
  const platform = input.platform || process.platform;
  const codexHome = str(env.CODEX_HOME).trim() || path.join(homedir, ".codex");
  const directHome = path.join(homedir, ".direct");
  const projectRoot = str(input.projectRoot);
  const cwd = str(input.cwd) || projectRoot;
  const errors = [];
  const userConfigPath = path.join(codexHome, "config.toml");
  const userConfig = readTomlFile(userConfigPath, errors) || {};
  const { gitRoot, dirs } = cwd ? projectDirectories(cwd) : { gitRoot: "", dirs: [] };
  // The project folder itself counts even when it isn't under the git root.
  if (projectRoot && !dirs.some((dir) => samePath(dir, projectRoot, platform))) dirs.unshift(path.resolve(projectRoot));
  const trust = dirs.length ? trustLevel(userConfig, dirs, platform) : "";
  const trusted = trust === "trusted";
  const projectLayers = trusted
    ? dirs.map((dir) => ({ dir, file: path.join(dir, ".codex", "config.toml") }))
        .map((layer) => ({ ...layer, config: readTomlFile(layer.file, errors) }))
        .filter((layer) => layer.config)
    : [];

  const mcp = collectMcpServers([
    { config: userConfig, source: `codex:${userConfigPath}` },
    ...projectLayers.map((layer) => ({ config: layer.config, source: `codex-project:${layer.file}` })),
  ], env);

  const agentsMd = collectAgentsMd({ codexHome, dirs, userConfig, trust });

  const skillsConfig = isPlainObject(userConfig.skills) ? userConfig.skills : {};
  const skillRoots = skillRootsFor({ codexHome, homedir, projectRoot, dirs, trusted });
  const skills = discoverSkills(skillRoots, skillsConfig, errors, platform);

  const hooksEnabled = !(isPlainObject(userConfig.features) && userConfig.features.hooks === false);
  const hookSources = hooksEnabled ? [
    { table: userConfig.hooks, source: `codex:${userConfigPath}` },
    { table: readHooksJson(path.join(codexHome, "hooks.json"), errors), source: `codex:${path.join(codexHome, "hooks.json")}` },
    ...projectLayers.map((layer) => ({ table: layer.config.hooks, source: `codex-project:${layer.file}` })),
    ...(trusted ? dirs.map((dir) => ({ table: readHooksJson(path.join(dir, ".codex", "hooks.json"), errors), source: `codex-project:${path.join(dir, ".codex", "hooks.json")}` })) : []),
    { table: readHooksJson(path.join(directHome, "hooks.json"), errors), source: `direct:${path.join(directHome, "hooks.json")}` },
    ...(projectRoot ? [{ table: readHooksJson(path.join(projectRoot, ".direct", "hooks.json"), errors), source: `direct-project:${path.join(projectRoot, ".direct", "hooks.json")}` }] : []),
  ] : [];
  const hooks = collectHooks(hookSources, errors);
  const notify = stringList(userConfig.notify) || [];
  // Codex's legacy notify program (run after each finished turn) is listed
  // with the hooks so it, too, runs only once the owner trusts it.
  if (notify.length) {
    const source = `codex:${userConfigPath}`;
    hooks.push({
      event: "Notify",
      matcher: "",
      command: notify.join(" "),
      argv: notify,
      commandWindows: "",
      timeoutSec: 60,
      async: true,
      statusMessage: "",
      source,
      id: `hook_${sha256(JSON.stringify(["Notify", notify, source])).slice(0, 24)}`,
    });
  }

  return {
    schema: "direct_codex_environment_context@1",
    platform,
    codexHome,
    userConfigPath,
    userConfigFound: exists(userConfigPath),
    projectRoot,
    cwd,
    gitRoot,
    projectTrust: trust || "unknown",
    mcpServers: mcp.servers,
    invalidMcpServers: mcp.invalid,
    agentsMd,
    skills,
    skillsIncludeInstructions: skillsConfig.include_instructions !== false,
    hooks,
    notify,
    errors: errors.slice(0, 50),
  };
}

module.exports = {
  normalizeCodexMcpServer,
  parseSkillFrontMatter,
  readCodexEnvironmentContext,
  readSkillBody,
};
