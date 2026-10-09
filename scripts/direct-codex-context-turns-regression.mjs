#!/usr/bin/env node
// A turn gets what Codex would give it from its home and project: MCP
// servers from config.toml (callable as tools), AGENTS.md (Codex's wrapper,
// first in the input; the project's scope setting decides who gets it), the
// skills catalog (a developer message) and a `$name`-mentioned skill's
// SKILL.md (after the prompt), and the owner-trusted hooks: UserPromptSubmit
// context, PreToolUse blocking a call, PostToolUse adding context, Stop
// continuing the work once. An untrusted hook never runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");
const { buildExternalCapabilityProfile, capabilityWitnessFor, mcpServerIdentityFor } = require("../src/main/direct/external/external-capability-profile");
const {
  configuredMcpServerIdentityInput,
  configuredMcpServersForProject,
  createDirectConfiguredMcpResolvers,
  disposeHostMcpSessions,
} = require("../src/main/direct/external/configured-mcp-adapter");
const { CodexContextService } = require("../src/main/direct/codex-home/codex-context-service.js");
const { readCodexEnvironmentContext, readSkillBody } = require("../src/main/direct/codex-home/codex-environment-context.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-codex-turns-"));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const home = path.join(root, "home");
const codexHome = path.join(home, ".codex");
const workspace = path.join(root, "project");
fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
const hookDir = path.join(root, "hooks");
const stopMarker = path.join(root, "stop-once");
const runCommand = (script) => `${process.platform === "win32" ? "& " : ""}'${process.execPath}' '${script}'`;
const hookScript = (name, source) => {
  const file = path.join(hookDir, name);
  write(file, `let input = ""; process.stdin.on("data", (d) => input += d).on("end", () => { const event = JSON.parse(input || "{}"); ${source} });`);
  return runCommand(file);
};
const promptHook = hookScript("prompt.js", `console.log("CTX-PROMPT " + event.hook_event_name + " " + event.prompt.slice(0, 12));`);
const denyHook = hookScript("deny.js", `process.stderr.write("no shell today for " + event.tool_name); process.exit(2);`);
const postHook = hookScript("post.js", `console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "POST-CTX " + event.tool_name } }));`);
const stopHook = hookScript("stop.js", `const fs = require("fs"); if (fs.existsSync(${JSON.stringify(stopMarker)})) process.exit(0); fs.writeFileSync(${JSON.stringify(stopMarker)}, "1"); console.log(JSON.stringify({ decision: "block", reason: "keep going " + event.stop_hook_active }));`);
const untrustedHook = hookScript("untrusted.js", `process.stderr.write("should not run"); process.exit(2);`);
const serverScript = path.join(root, "server.js");
write(serverScript, `
const readline = require("node:readline");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const q = JSON.parse(line);
  if (q.id === undefined) return;
  if (q.method === "initialize") return send({ jsonrpc: "2.0", id: q.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
  if (q.method === "tools/list") return send({ jsonrpc: "2.0", id: q.id, result: { tools: [
    { name: "lookup", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "hidden", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  ] } });
  if (q.method === "tools/call") return send({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "looked up " + (process.env.FROM_CONFIG || "?") }] } });
  send({ jsonrpc: "2.0", id: q.id, result: {} });
});
`);
const toml = (value) => JSON.stringify(value);
write(path.join(codexHome, "config.toml"), [
  "[mcp_servers.fixture]",
  `command = ${toml(process.execPath)}`,
  `args = [${toml(serverScript)}]`,
  "env = { FROM_CONFIG = \"config-value\" }",
  "disabled_tools = [\"hidden\"]",
  "[[hooks.UserPromptSubmit]]",
  `hooks = [{ type = "command", command = ${toml(promptHook)} }]`,
  "[[hooks.UserPromptSubmit]]",
  `hooks = [{ type = "command", command = ${toml(untrustedHook)} }]`,
  "[[hooks.PreToolUse]]",
  "matcher = \"exec_command\"",
  `hooks = [{ type = "command", command = ${toml(denyHook)} }]`,
  "[[hooks.PostToolUse]]",
  "matcher = \"mcp__.*\"",
  `hooks = [{ type = "command", command = ${toml(postHook)} }]`,
  "[[hooks.Stop]]",
  `hooks = [{ type = "command", command = ${toml(stopHook)} }]`,
].join("\n"));
write(path.join(codexHome, "AGENTS.md"), "Global: be brief.");
write(path.join(workspace, "AGENTS.md"), "Project: use tabs.");
write(path.join(codexHome, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship a release.\n---\n# Deploy steps\nRun the release script.");

const env = { ...process.env, CODEX_HOME: codexHome };
const service = new CodexContextService({
  reader: (input) => readCodexEnvironmentContext({ ...input, env, homedir: home }),
  skillReader: (input) => readSkillBody({ ...input, env, homedir: home }),
});
const projectId = "codex_context_turns";
const workThreadId = "work_thread_codex_context";
const project = {
  id: projectId,
  name: "Codex context",
  workThreadId,
  workspace: { kind: "local", localPath: workspace },
  agentsMdScope: "workbench_and_children",
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
// As main.js builds it: the project's configured servers are witnessed.
function profileFor(currentProject) {
  const servers = configuredMcpServersForProject(currentProject);
  const capabilityRows = servers.length
    ? buildExternalCapabilityProfile({ projectId, workThreadId }).capabilityRows.map((row) => row.serverIdentityId
      ? capabilityWitnessFor({ ...row, serverIdentityId: servers[0].serverIdentityId, rowId: "" })
      : row)
    : undefined;
  return buildExternalCapabilityProfile({
    projectId,
    workThreadId,
    serverIdentities: servers.map((server) => mcpServerIdentityFor(configuredMcpServerIdentityInput(server))),
    ...(capabilityRows ? { capabilityRows } : {}),
  });
}

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let body = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args || {}) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  body += event("response.completed", { response: { id, status: "completed" } });
  return { ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } } };
}
const textOf = (item) => (Array.isArray(item?.content) ? item.content.map((part) => part.text || "").join("") : "");
const lastOutput = (body) => body.input.filter((item) => item.type === "function_call_output").at(-1)?.output;

const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const bodies = [];
let steps = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  externalCapabilityProfileResolver: (input) => profileFor(input.project || input),
  ...createDirectConfiguredMcpResolvers(),
  codexContextResolver: (currentProject) => service.contextFor(currentProject),
  codexSkillResolver: (currentProject, skillPath) => service.skillBody(currentProject, skillPath),
  hookRunner: (currentProject, hook, stdin) => service.runHook(currentProject, hook, stdin),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    assert(steps.length, `no extra request (${bodies.length})`);
    return response(`r${bodies.length}`, steps.shift());
  },
});
const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
const context = { project, ownerControlled: true, surfaceSession: surface };

async function settle(threadId, turnId) {
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId });
  const deadline = Date.now() + 20_000;
  while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turnId).state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return sessionStore.readTurn(threadId, turnId);
}

try {
  // Trust every hook but one.
  const discovered = await service.contextFor(project, { force: true });
  for (const hook of discovered.hooks) {
    if (!hook.command.includes("untrusted.js")) controller.approvalRuleStore.setHookTrusted(hook.id, true);
  }

  steps = [
    { name: "exec_command", args: { cmd: "echo hi" } },
    { name: "mcp__fixture__lookup", args: {} },
    null,
    null, // the Stop hook's continuation turn
  ];
  const threadId = (await controller.handleRequest("thread/start", { title: "Codex context", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId }, context)).thread.id;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "t1", promptText: "Deploy it with $deploy please." }, context);
  const stored = await settle(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));

  const first = bodies[0];
  // AGENTS.md first, in Codex's wrapper.
  assert.equal(first.input[0].role, "user");
  assert.equal(textOf(first.input[0]), `# AGENTS.md instructions for ${workspace}\n\n<INSTRUCTIONS>\nGlobal: be brief.\n\n--- project-doc ---\n\nProject: use tabs.\n</INSTRUCTIONS>`);
  // Then the skills catalog.
  assert.equal(first.input[1].role, "developer");
  assert.match(textOf(first.input[1]), /^<skills_instructions>\n## Skills\n/);
  assert.match(textOf(first.input[1]), new RegExp(`- deploy: Ship a release\\. \\(file: ${path.join(codexHome, "skills", "deploy", "SKILL.md").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\)`));
  // The mentioned skill and the prompt hook's context follow the prompt.
  const promptIndex = first.input.findIndex((item) => item.role === "user" && textOf(item).includes("Deploy it with $deploy"));
  assert(promptIndex > 1, "the prompt comes after AGENTS.md and the catalog");
  const after = first.input.slice(promptIndex + 1).map(textOf);
  assert(after.some((text) => text.startsWith("<skill>\n<name>deploy</name>") && text.includes("# Deploy steps")), JSON.stringify(after));
  assert(after.some((text) => text === "CTX-PROMPT UserPromptSubmit Deploy it wi"), JSON.stringify(after));
  assert(!JSON.stringify(first.input).includes("should not run"), "the untrusted hook didn't run");
  // config.toml's server is a tool (its disabled tool isn't), with its env.
  const mcpTools = first.tools.map((tool) => tool.name).filter((name) => name.startsWith("mcp__"));
  assert.deepEqual(mcpTools, ["mcp__fixture__lookup"]);
  // PreToolUse blocked exec_command before it ran.
  assert.match(lastOutput(bodies[1]), /Blocked by a hook: no shell today for exec_command/);
  // PostToolUse added context to the MCP result.
  assert.match(lastOutput(bodies[2]), /looked up config-value[\s\S]*Hook context: POST-CTX mcp__fixture__lookup/);

  // The Stop hook blocked once: a new turn continues with its reason.
  const deadline = Date.now() + 20_000;
  let continuation = null;
  while (Date.now() < deadline) {
    const turns = (sessionStore.readSession(threadId)?.turns || []).filter((entry) => entry.turnId !== turn.turn.id);
    if (turns.length) {
      const candidate = sessionStore.readTurn(threadId, turns[0].turnId);
      if (["completed", "failed"].includes(candidate?.state)) {
        continuation = candidate;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(continuation, "the Stop hook started a continuation turn");
  assert.equal(continuation.state, "completed", JSON.stringify(continuation.error));
  assert.match(JSON.stringify(continuation.input), /Stop hook feedback: keep going false/);
  assert.equal(steps.length, 0);

  // Scope "workbench": a delegated child thread gets no AGENTS.md.
  project.agentsMdScope = "workbench";
  steps = [null];
  const child = (await controller.handleRequest("thread/start", { title: "Child", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId, parentThreadId: threadId }, context)).thread.id;
  const childTurn = await controller.handleRequest("turn/start", { threadId: child, clientTurnRequestId: "t_child", promptText: "Hello." }, context);
  assert.equal((await settle(child, childTurn.turn.id)).state, "completed");
  assert(!textOf(bodies.at(-1).input[0]).startsWith("# AGENTS.md"), "no AGENTS.md for a child thread under the workbench scope");
  console.log(JSON.stringify({ ok: true, requests: bodies.length }));
} finally {
  controller.close("regression cleanup");
  await disposeHostMcpSessions().catch(() => {});
  await manager.dispose("regression cleanup");
  threadStore.close();
  // Asynchronously: the last turns' Stop hooks may still be starting in the
  // project folder, and they need this process's event loop to get their
  // stdin (a blocking rmSync would starve them and keep the folder open).
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
}
