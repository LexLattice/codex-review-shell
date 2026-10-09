"use strict";

// Reads a project's Codex context (config.toml MCP servers, AGENTS.md,
// skills, hooks) in the project's own environment: in this process when
// the project runs here, through its executor's codex/context otherwise.
// Results are kept a few seconds (a turn and its continuations reuse them)
// and the MCP servers are published to the configured-MCP adapter.

const { readCodexEnvironmentContext, readSkillBody } = require("./codex-environment-context");
const { runHookProcess } = require("./hook-runner");
const { EXECUTOR_METHODS } = require("../../../shared/executor-protocol");
const { workspaceExecutesLocally } = require("../tools/exec-sandbox");
const { setCodexMcpServersForProject } = require("../external/configured-mcp-adapter");

const CONTEXT_CACHE_MS = 5_000;
const EXECUTOR_TIMEOUT_MS = 15_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function projectRoot(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return normalizeString(workspace.linuxPath, normalizeString(workspace.localPath, ""));
  if (workspace.kind === "windows") return normalizeString(workspace.windowsPath, normalizeString(workspace.localPath, ""));
  return normalizeString(workspace.localPath, normalizeString(project.repoPath, ""));
}

function emptyContext(error) {
  return {
    schema: "direct_codex_environment_context@1",
    mcpServers: [],
    invalidMcpServers: [],
    agentsMd: { global: null, projectDocs: [], truncated: false },
    skills: [],
    skillsIncludeInstructions: true,
    hooks: [],
    notify: [],
    errors: error ? [{ source: "codex/context", message: error }] : [],
    unavailable: Boolean(error),
  };
}

class CodexContextService {
  constructor(options = {}) {
    this.executors = options.executors || null;
    this.reader = typeof options.reader === "function" ? options.reader : readCodexEnvironmentContext;
    this.skillReader = typeof options.skillReader === "function" ? options.skillReader : readSkillBody;
    this.hookRunner = typeof options.hookRunner === "function" ? options.hookRunner : runHookProcess;
    this.locality = typeof options.workspaceLocalityResolver === "function"
      ? options.workspaceLocalityResolver
      : (kind, project) => workspaceExecutesLocally(kind, project);
    this.cacheMs = Number.isFinite(options.cacheMs) ? options.cacheMs : CONTEXT_CACHE_MS;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  key(project = {}) {
    const workspace = isPlainObject(project.workspace) ? project.workspace : {};
    return JSON.stringify([normalizeString(project.id || project.projectId, ""), workspace.kind || "local", workspace.distro || "", projectRoot(project)]);
  }

  async contextFor(project = {}, options = {}) {
    const key = this.key(project);
    const cached = this.cache.get(key);
    if (!options.force && cached && Date.now() - cached.at < this.cacheMs) return cached.context;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = this.read(project).then((context) => {
      this.cache.set(key, { at: Date.now(), context });
      setCodexMcpServersForProject(project.id || project.projectId, context.mcpServers);
      return context;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  async read(project = {}) {
    const kind = normalizeString(project.workspace?.kind, "local");
    try {
      if (kind === "local" || this.locality(kind, project)) {
        const root = projectRoot(project);
        return this.reader({ projectRoot: root, cwd: root });
      }
      if (!this.executors || typeof this.executors.requestForProject !== "function") {
        return emptyContext("No executor is available for this project's environment.");
      }
      const context = await this.executors.requestForProject(project, EXECUTOR_METHODS.codexContext, {}, EXECUTOR_TIMEOUT_MS);
      return context?.schema === "direct_codex_environment_context@1" ? context : emptyContext("The executor returned no Codex context.");
    } catch (error) {
      return emptyContext(normalizeString(error?.message, "The Codex context couldn't be read."));
    }
  }

  // A skill's SKILL.md (for a `$name` mention), read where the skill lives.
  async skillBody(project = {}, skillPath = "") {
    const kind = normalizeString(project.workspace?.kind, "local");
    try {
      if (kind === "local" || this.locality(kind, project)) {
        return this.skillReader({ path: skillPath, projectRoot: projectRoot(project) });
      }
      const result = await this.executors?.requestForProject?.(project, EXECUTOR_METHODS.codexSkill, { path: skillPath }, EXECUTOR_TIMEOUT_MS);
      return result?.skill || null;
    } catch {
      return null;
    }
  }

  // One trusted hook, run in the project's environment.
  async runHook(project = {}, hook = {}, stdin = "") {
    const timeoutMs = Math.max(1, Number(hook.timeoutSec) || 600) * 1000;
    const kind = normalizeString(project.workspace?.kind, "local");
    if (kind === "local" || this.locality(kind, project)) {
      return this.hookRunner({ ...hook, stdin, cwd: projectRoot(project), timeoutMs });
    }
    if (!this.executors || typeof this.executors.requestForProject !== "function") {
      return { exitCode: null, stdout: "", stderr: "No executor is available for this project's environment.", spawnError: true };
    }
    return this.executors.requestForProject(project, EXECUTOR_METHODS.hookRun, {
      hook: { command: hook.command, commandWindows: hook.commandWindows, argv: hook.argv },
      stdin,
      timeoutMs,
    }, timeoutMs + 10_000);
  }

  forget(project) {
    this.cache.delete(this.key(project));
  }
}

module.exports = { CodexContextService, projectRoot };
