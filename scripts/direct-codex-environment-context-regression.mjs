#!/usr/bin/env node
// What Direct reads from an environment's Codex home and project, as Codex
// reads it: config.toml (TOML subset), MCP servers (user config plus a
// trusted project's .codex/config.toml), AGENTS.md (global, then root to
// cwd, 32 KiB cap), skills (Codex's roots plus ~/.direct and
// <project>/.direct), and hooks (config.toml, hooks.json, Direct's own).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseToml } = require("../src/main/direct/external/toml-lite.js");
const { buildMcpToolCatalog } = require("../src/main/direct/external/mcp-tool-calls.js");
const { readCodexEnvironmentContext, parseSkillFrontMatter, readSkillBody } = require("../src/main/direct/codex-home/codex-environment-context.js");

// TOML.
{
  const parsed = parseToml([
    "model = \"gpt-5\" # comment",
    "n = 1_000",
    "[mcp_servers.docs]",
    "command = \"npx\"",
    "args = [",
    "  \"-y\", # comment",
    "  \"@x/docs\",",
    "]",
    "env = { API_KEY = \"k\", \"WITH SPACE\" = 'v' }",
    "[mcp_servers.\"my.server\"]",
    "url = \"https://example.com/mcp\"",
    "[[hooks.PreToolUse]]",
    "matcher = \"Bash\"",
    "text = \"\"\"",
    "a\\",
    "   b\"\"\"",
    "lit = '''raw\\n'''",
    "esc = \"tab\\there \\u00e9\"",
  ].join("\n"));
  assert.equal(parsed.n, 1000);
  assert.deepEqual(parsed.mcp_servers.docs.args, ["-y", "@x/docs"]);
  assert.deepEqual(parsed.mcp_servers.docs.env, { API_KEY: "k", "WITH SPACE": "v" });
  assert.equal(parsed.mcp_servers["my.server"].url, "https://example.com/mcp");
  assert.equal(parsed.hooks.PreToolUse[0].text, "ab");
  assert.equal(parsed.hooks.PreToolUse[0].lit, "raw\\n");
  assert.equal(parsed.hooks.PreToolUse[0].esc, "tab\there é");
  assert.throws(() => parseToml("a = 1\na = 2"), /duplicate/);
  assert.throws(() => parseToml("[t]\n[t]"), /twice/);
  assert.throws(() => parseToml("a = \"x"), /unterminated/);
  const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
  const tools = [{ serverIdentityId: "real", tools: [{ name: "write", inputSchema: { type: "object" } }] }];
  for (const source of [
    "[__proto__]\nfoo = 1",
    "[a.__proto__]\nfoo = 1",
    "[mcp_servers.__proto__]\nreadOnlyHint = true",
    "[constructor.prototype]\nfoo = 1",
    '"__proto__" = { readOnlyHint = true }',
    'a = { "__proto__".foo = 1 }',
    "[[a.__proto__]]\nfoo = 1",
    "a.constructor.prototype.foo = 1",
    "a.prototype = 1",
  ]) {
    assert.throws(() => parseToml(source), /unsafe key/, source);
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototypeBefore, source);
    assert.equal(({}).foo, undefined);
    assert.equal(buildMcpToolCatalog(tools).entries[0].needsApproval, true);
  }
  const inherited = parseToml("[toString]\nfoo = 1\n[[valueOf]]\nfoo = 2");
  assert.deepEqual(inherited.toString, { foo: 1 });
  assert.deepEqual(inherited.valueOf, [{ foo: 2 }]);
  assert.deepEqual(parseToml("hasOwnProperty.foo = 3").hasOwnProperty, { foo: 3 });
  assert.equal(Object.getPrototypeOf(inherited), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototypeBefore);
}

assert.deepEqual(parseSkillFrontMatter("---\nname: deploy\ndescription: >\n  Ship the\n  thing.\nmetadata:\n  short-description: Ship\n---\nbody"), {
  name: "deploy", description: "Ship the thing.", shortDescription: "Ship",
});
assert.equal(parseSkillFrontMatter("no front matter"), null);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-context-"));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
try {
  const home = path.join(root, "home");
  const codexHome = path.join(home, ".codex");
  const repo = path.join(root, "repo");
  const project = path.join(repo, "packages", "app");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  write(path.join(codexHome, "config.toml"), [
    "notify = [\"notify-send\", \"done\"]",
    "[mcp_servers.local_tools]",
    "command = \"node\"",
    "args = [\"server.js\"]",
    "env = { TOKEN = \"secret-value\" }",
    "env_vars = [\"HOME\", { name = \"PATH\", source = \"local\" }]",
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 90",
    "disabled_tools = [\"dangerous\"]",
    "[mcp_servers.local_tools.tools.write]",
    "approval_mode = \"approve\"",
    "[mcp_servers.docs]",
    "url = \"https://docs.example/mcp\"",
    "bearer_token_env_var = \"DOCS_TOKEN\"",
    "http_headers = { \"X-Client\" = \"direct\" }",
    "env_http_headers = { \"X-Org\" = \"DOCS_ORG\" }",
    "[mcp_servers.broken]",
    "command = \"a\"",
    "url = \"https://b\"",
    "[mcp_servers.\"bad name!\"]",
    "command = \"x\"",
    `[projects."${repo.replace(/\\/g, "\\\\")}"]`,
    "trust_level = \"trusted\"",
    "[[hooks.PreToolUse]]",
    "matcher = \"exec_command\"",
    "hooks = [{ type = \"command\", command = \"check.sh\", timeout = 5 }]",
    "[skills]",
    "[[skills.config]]",
    "name = \"disabled-skill\"",
    "enabled = false",
  ].join("\n"));
  write(path.join(codexHome, "AGENTS.md"), "Global rules.");
  write(path.join(repo, "AGENTS.md"), "Repo rules.");
  write(path.join(project, "AGENTS.override.md"), "App override.");
  write(path.join(project, "AGENTS.md"), "Ignored: the override wins.");
  write(path.join(repo, ".codex", "config.toml"), "[mcp_servers.docs]\nurl = \"https://project.example/mcp\"\n");
  write(path.join(repo, ".codex", "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] } }));
  write(path.join(home, ".direct", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }] } }));
  const skill = (dir, name, description) => write(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  skill(path.join(codexHome, "skills", "deploy"), "deploy", "Ship a release.");
  skill(path.join(codexHome, "skills", "off"), "disabled-skill", "Turned off in config.");
  skill(path.join(home, ".agents", "skills", "review"), "review", "Review a diff.");
  skill(path.join(home, ".direct", "skills", "triage"), "triage", "Triage issues.");
  skill(path.join(repo, ".agents", "skills", "repo-skill"), "repo-skill", "Repo-wide skill.");
  skill(path.join(project, ".direct", "skills", "app-skill"), "", "Name from the folder.");
  write(path.join(codexHome, "skills", "bad", "SKILL.md"), "no front matter");

  const env = { DOCS_TOKEN: "tok", DOCS_ORG: "org1", PATH: process.env.PATH };
  const context = readCodexEnvironmentContext({ projectRoot: project, cwd: project, env: { ...env, CODEX_HOME: codexHome }, homedir: home });
  assert.equal(context.projectTrust, "trusted");
  assert.equal(context.gitRoot, repo);
  const byName = Object.fromEntries(context.mcpServers.map((server) => [server.name, server]));
  assert.deepEqual(Object.keys(byName).sort(), ["docs", "local_tools"]);
  assert.deepEqual(context.invalidMcpServers.map((entry) => entry.name).sort(), ["bad name!", "broken"]);
  const local = byName.local_tools;
  assert.deepEqual([local.transport, local.command, local.args, local.env, local.envVars], ["stdio", "node", ["server.js"], { TOKEN: "secret-value" }, ["HOME", "PATH"]]);
  assert.deepEqual([local.startupTimeoutMs, local.toolTimeoutMs, local.disabledTools, local.toolApprovalModes], [20_000, 90_000, ["dangerous"], { write: "approve" }]);
  const docs = byName.docs;
  assert.equal(docs.url, "https://project.example/mcp", "the trusted project's layer overrides the user's");
  assert.equal(docs.source.startsWith("codex-project:"), true);
  assert.equal(docs.unavailable, undefined);

  write(path.join(repo, ".codex", "config.toml"), "[mcp_servers.docs]\nenabled = false\n");
  const reread = () => readCodexEnvironmentContext({ projectRoot: project, cwd: project, env: { ...env, CODEX_HOME: codexHome }, homedir: home });
  const disabled = reread();
  const disabledDocs = disabled.mcpServers.find((server) => server.name === "docs");
  assert.equal(disabledDocs.enabled, false);
  assert.equal(disabledDocs.url, "https://docs.example/mcp");
  assert.equal(disabledDocs.headers.Authorization, "Bearer tok");
  assert(!disabled.invalidMcpServers.some((entry) => entry.name === "docs"));

  write(path.join(repo, ".codex", "config.toml"), [
    "[mcp_servers.docs]",
    "enabled = false",
    "[mcp_servers.local_tools]",
    'enabled_tools = ["read", "write"]',
    'disabled_tools = ["write"]',
    "startup_timeout_sec = 2",
    "tool_timeout_sec = 3",
    'default_tools_approval_mode = "prompt"',
    'env = { EXTRA = "project-value" }',
    "[mcp_servers.local_tools.tools.read]",
    'approval_mode = "prompt"',
    "[mcp_servers.orphan]",
    "enabled = false",
  ].join("\n"));
  write(path.join(project, ".codex", "config.toml"), [
    "[mcp_servers.local_tools]",
    "disabled_tools = []",
    "tool_timeout_sec = 4",
    "[mcp_servers.local_tools.tools.write]",
    'approval_mode = "writes"',
  ].join("\n"));
  const layered = reread();
  const layeredLocal = layered.mcpServers.find((server) => server.name === "local_tools");
  assert.equal(layeredLocal.command, "node");
  assert.deepEqual(layeredLocal.args, ["server.js"]);
  assert.deepEqual(layeredLocal.env, { TOKEN: "secret-value", EXTRA: "project-value" });
  assert.deepEqual(layeredLocal.enabledTools, ["read", "write"]);
  assert.deepEqual(layeredLocal.disabledTools, []);
  assert.deepEqual([layeredLocal.startupTimeoutMs, layeredLocal.toolTimeoutMs, layeredLocal.defaultToolsApprovalMode], [2000, 4000, "prompt"]);
  assert.deepEqual(layeredLocal.toolApprovalModes, { write: "writes", read: "prompt" });
  assert.equal(layered.mcpServers.find((server) => server.name === "docs").enabled, false);
  assert(layered.invalidMcpServers.some((entry) => entry.name === "orphan" && /needs command or url/.test(entry.message)));
  assert(!layered.mcpServers.some((server) => server.name === "orphan"));
  write(path.join(project, ".codex", "config.toml"), '[mcp_servers.docs]\ncommand = "node"\n');
  const invalidOverride = reread();
  assert(!invalidOverride.mcpServers.some((server) => server.name === "docs"), "invalid merged overrides must not fall back to the inherited server");
  assert(invalidOverride.invalidMcpServers.some((entry) => entry.name === "docs" && /not both/.test(entry.message)));

  // Without trust, project layers and project hooks are ignored.
  const otherRepo = path.join(root, "other-repo");
  fs.mkdirSync(path.join(otherRepo, ".git"), { recursive: true });
  write(path.join(otherRepo, ".codex", "config.toml"), "[mcp_servers.docs]\nurl = \"https://untrusted.example/mcp\"\n");
  write(path.join(otherRepo, ".codex", "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "untrusted.sh" }] }] } }));
  const untrusted = readCodexEnvironmentContext({ projectRoot: otherRepo, cwd: otherRepo, env: { ...env, CODEX_HOME: codexHome, DOCS_TOKEN: "" }, homedir: path.join(root, "other-home") });
  assert.equal(untrusted.userConfigFound, true);
  assert.equal(untrusted.projectTrust, "unknown");
  const userDocs = untrusted.mcpServers.find((server) => server.name === "docs");
  assert.equal(userDocs.url, "https://docs.example/mcp");
  assert.match(userDocs.unavailable, /DOCS_TOKEN is not set/);
  assert(!untrusted.hooks.some((hook) => hook.command === "untrusted.sh"));
  const plain = readCodexEnvironmentContext({ projectRoot: project, cwd: project, env: { CODEX_HOME: path.join(root, "nowhere") }, homedir: path.join(root, "nobody") });
  assert.deepEqual([plain.userConfigFound, plain.mcpServers.length, plain.projectTrust], [false, 0, "unknown"]);
  // The deepest listed directory decides trust, in either listing order: an
  // untrusted nested project stays untrusted under a trusted repository.
  const tomlPath = (dir) => dir.replace(/\\/g, "\\\\");
  for (const [label, entries] of [
    ["nested first", [[project, "untrusted"], [repo, "trusted"]]],
    ["repo first", [[repo, "trusted"], [project, "untrusted"]]],
  ]) {
    const nestedHome = path.join(root, `nested-${label.replace(/ /g, "-")}`, ".codex");
    write(path.join(nestedHome, "config.toml"), [
      "[mcp_servers.docs]",
      "url = \"https://docs.example/mcp\"",
      ...entries.flatMap(([dir, level]) => [`[projects."${tomlPath(dir)}"]`, `trust_level = "${level}"`]),
    ].join("\n"));
    const nested = readCodexEnvironmentContext({ projectRoot: project, cwd: project, env: { ...env, CODEX_HOME: nestedHome }, homedir: path.dirname(nestedHome) });
    assert.equal(nested.projectTrust, "untrusted", label);
    const nestedDocs = nested.mcpServers.find((server) => server.name === "docs");
    assert.equal(nestedDocs.url, "https://docs.example/mcp", `${label}: the repository's project layer isn't loaded`);
    assert(!nested.hooks.some((hook) => hook.command === "stop.sh"), `${label}: project hooks aren't loaded`);
  }
  const httpHeaders = readCodexEnvironmentContext({ projectRoot: path.join(root, "elsewhere"), env: { ...env, CODEX_HOME: codexHome }, homedir: home })
    .mcpServers.find((server) => server.name === "docs").headers;
  assert.deepEqual(httpHeaders, { "X-Client": "direct", "X-Org": "org1", Authorization: "Bearer tok" });

  // AGENTS.md.
  assert.equal(context.agentsMd.global.text, "Global rules.");
  assert.deepEqual(context.agentsMd.projectDocs.map((doc) => [doc.dir, doc.text]), [[repo, "Repo rules."], [project, "App override."]]);

  // Skills.
  const skills = Object.fromEntries(context.skills.map((entry) => [entry.name, entry.scope]));
  assert.deepEqual(skills, { deploy: "user", review: "user", triage: "direct-user", "repo-skill": "repo", "app-skill": "direct-project" });
  assert(context.errors.some((error) => /SKILL\.md needs front matter/.test(error.message)));
  // A mentioned skill's body is read only from inside a skill root.
  const skillEnv = { ...env, CODEX_HOME: codexHome };
  const body = readSkillBody({ path: path.join(codexHome, "skills", "deploy", "SKILL.md"), projectRoot: project, env: skillEnv, homedir: home });
  assert.match(body.text, /# deploy/);
  write(path.join(root, "outside", "SKILL.md"), "---\ndescription: x\n---\nsecret");
  assert.equal(readSkillBody({ path: path.join(root, "outside", "SKILL.md"), projectRoot: project, env: skillEnv, homedir: home }), null);
  assert.equal(readSkillBody({ path: path.join(codexHome, "config.toml"), projectRoot: project, env: skillEnv, homedir: home }), null, "only SKILL.md files");

  // Hooks.
  // The legacy notify program is listed with the hooks (it needs trust too).
  assert.deepEqual(context.hooks.map((hook) => [hook.event, hook.command]).sort(), [["Notify", "notify-send done"], ["PreToolUse", "check.sh"], ["Stop", "stop.sh"], ["UserPromptSubmit", "prompt.sh"]]);
  assert.deepEqual(context.hooks.find((hook) => hook.event === "Notify").argv, ["notify-send", "done"]);
  const pre = context.hooks.find((hook) => hook.event === "PreToolUse");
  assert.deepEqual([pre.matcher, pre.timeoutSec], ["exec_command", 5]);
  assert.match(pre.id, /^hook_[0-9a-f]{24}$/);
  assert.deepEqual(context.notify, ["notify-send", "done"]);
  console.log(JSON.stringify({ ok: true, servers: context.mcpServers.length, skills: context.skills.length, hooks: context.hooks.length }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
