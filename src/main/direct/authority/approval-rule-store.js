"use strict";

// The owner's saved "don't ask again" answers, kept by the main process (not
// the renderer): MCP tools allowed for a project (Codex writes
// `approval_mode = "approve"` for the tool), and command prefix rules
// (Codex's `prefix_rule(..., decision="allow")`), global or for one project
// and environment.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RULES_SCHEMA = "direct_approval_rules@1";
const MAX_RULES = 2_000;
const MAX_PATTERN_TOKENS = 64;
const ENVIRONMENT_KINDS = new Set(["wsl", "windows", "linux", "local", "macos"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function emptyRules() {
  return { schema: RULES_SCHEMA, mcpToolAllows: [], commandRules: [] };
}

function normalizePattern(pattern) {
  if (!Array.isArray(pattern) || !pattern.length || pattern.length > MAX_PATTERN_TOKENS) return null;
  const tokens = pattern.map((token) => (typeof token === "string" ? token : null));
  if (tokens.some((token) => token === null || token.length > 4_096 || /[\r\n]/.test(token))) return null;
  return tokens;
}

class DirectApprovalRuleStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("DirectApprovalRuleStore requires a rootDir.");
    this.filePath = path.join(rootDir, "approval-rules.json");
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!isPlainObject(parsed) || parsed.schema !== RULES_SCHEMA) return emptyRules();
      return {
        schema: RULES_SCHEMA,
        mcpToolAllows: Array.isArray(parsed.mcpToolAllows) ? parsed.mcpToolAllows.filter(isPlainObject) : [],
        commandRules: Array.isArray(parsed.commandRules) ? parsed.commandRules.filter(isPlainObject) : [],
      };
    } catch {
      return emptyRules();
    }
  }

  write(rules) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(rules, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }

  isMcpToolAllowed(projectId, serverIdentityId, toolName) {
    return this.read().mcpToolAllows.some((rule) =>
      rule.projectId === projectId && rule.serverIdentityId === serverIdentityId && rule.toolName === toolName);
  }

  allowMcpTool(projectId, serverIdentityId, toolName) {
    const ids = [projectId, serverIdentityId, toolName].map((value) => normalizeString(value, ""));
    if (ids.some((value) => !value)) throw new Error("An MCP tool rule needs a project, server, and tool.");
    if (this.isMcpToolAllowed(...ids)) return false;
    const rules = this.read();
    rules.mcpToolAllows = [...rules.mcpToolAllows, { projectId: ids[0], serverIdentityId: ids[1], toolName: ids[2], addedAt: new Date().toISOString() }].slice(-MAX_RULES);
    this.write(rules);
    return true;
  }

  // Global rules plus the project's rules for this environment.
  commandRulesFor(projectId, environmentKind) {
    return this.read().commandRules.filter((rule) => normalizePattern(rule.pattern) && (
      rule.scope === "global" ||
      (rule.scope === "project" && rule.projectId === projectId && rule.environmentKind === environmentKind)
    ));
  }

  addCommandRule(input = {}) {
    const scope = input.scope === "global" ? "global" : "project";
    const pattern = normalizePattern(input.pattern);
    if (!pattern) throw new Error("A command rule needs a pattern of argument tokens.");
    const projectId = scope === "project" ? normalizeString(input.projectId, "") : "";
    const environmentKind = scope === "project" ? normalizeString(input.environmentKind, "") : "";
    if (scope === "project" && (!projectId || !ENVIRONMENT_KINDS.has(environmentKind))) {
      throw new Error("A project command rule needs a project and its environment.");
    }
    const rules = this.read();
    const same = (rule) => rule.scope === scope && normalizeString(rule.projectId, "") === projectId &&
      normalizeString(rule.environmentKind, "") === environmentKind &&
      JSON.stringify(rule.pattern) === JSON.stringify(pattern);
    if (rules.commandRules.some(same)) return false;
    rules.commandRules = [...rules.commandRules, {
      scope,
      ...(scope === "project" ? { projectId, environmentKind } : {}),
      pattern,
      decision: "allow",
      addedAt: new Date().toISOString(),
    }].slice(-MAX_RULES);
    this.write(rules);
    return true;
  }
}

module.exports = { DirectApprovalRuleStore, RULES_SCHEMA };
