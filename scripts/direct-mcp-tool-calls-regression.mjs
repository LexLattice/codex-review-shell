#!/usr/bin/env node
// Configured MCP server tools work as in Codex: each tool is a function
// (mcp__<server>__<tool>) in every request of the turn; calls run tools/call
// on the server; tools not marked read-only ask the owner first (Allow, for
// this thread, always), except in Full access; forms the server asks for
// during a call go to the owner (checked against their schema), and an empty
// confirmation is accepted without asking in Full access; results go back as
// Codex formats them, images as input_image content items.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
const { buildExternalCapabilityProfile, mcpServerIdentityFor } = require("../src/main/direct/external/external-capability-profile");
const { createDirectConfiguredMcpResolvers, disposeHostMcpSessions, normalizeConfiguredMcpServer } = require("../src/main/direct/external/configured-mcp-adapter");
const { buildMcpToolCatalog, sanitizeMcpToolSchema } = require("../src/main/direct/external/mcp-tool-calls");

// Naming and schema rules, as Codex applies them.
{
  const catalog = buildMcpToolCatalog([
    { serverIdentityId: "s1", serverName: "my-server", tools: [{ name: "do.it", inputSchema: { type: "object", properties: { a: { type: "string", format: "uri", pattern: "x" } } } }] },
    { serverIdentityId: "s2", serverName: "my_server", tools: [{ name: "do_it" }] },
    { serverIdentityId: "s3", serverName: "x".repeat(80), tools: [{ name: "t" }] },
  ]);
  const names = catalog.entries.map((entry) => entry.functionName);
  assert(names.every((name) => /^mcp__[A-Za-z0-9_]+$/.test(name) && name.length <= 64), names.join(","));
  assert.equal(new Set(names).size, 3, "colliding sanitized names get distinct hashed names");
  const first = catalog.entries.find((entry) => entry.serverIdentityId === "s1");
  assert.deepEqual(first.parameters, { type: "object", properties: { a: { type: "string" } } }, "only Codex's schema keywords are kept");
  assert.equal(first.needsApproval, true, "a tool without annotations asks");
  assert.deepEqual(sanitizeMcpToolSchema(undefined), { type: "object", properties: {} });
}

const projectId = "project_mcp_tool_calls";
const workThreadId = "work_thread_mcp_tool_calls";
// The id the default capability witness rows name.
const serverIdentityId = "mcp_server_project_fixture";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-mcp-tool-calls-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const serverScript = path.join(root, "server.js");
await fs.writeFile(serverScript, `
const readline = require("node:readline");
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const waiting = new Map();
let asked = 0;
const ask = (callId, params, then) => { const id = "srv-" + (++asked); waiting.set(id, { callId, then }); send({ jsonrpc: "2.0", id, method: "elicitation/create", params }); };
const text = (id, value) => send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: value }] } });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const q = JSON.parse(line);
  if (!q.method && waiting.has(q.id)) { const w = waiting.get(q.id); waiting.delete(q.id); return w.then(w.callId, q.result || {}); }
  if (q.id === undefined) return;
  if (q.method === "initialize") return send({ jsonrpc: "2.0", id: q.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, clientCapabilities: q.params.capabilities } });
  if (q.method === "tools/list") return send({ jsonrpc: "2.0", id: q.id, result: { tools: [
    { name: "lookup", description: "Look something up.", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
    { name: "write_note", description: "Write a note.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
    { name: "pick-color", description: "Ask the user for a color.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "snap", description: "Take a picture.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "confirm", description: "Ask the user to confirm.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  ] } });
  if (q.method !== "tools/call") return send({ jsonrpc: "2.0", id: q.id, result: {} });
  const args = q.params.arguments || {};
  if (q.params.name === "lookup") return text(q.id, "found " + args.q);
  if (q.params.name === "write_note") return send({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "ignored" }], structuredContent: { saved: args.text } } });
  if (q.params.name === "pick-color") return ask(q.id, { mode: "form", message: "Pick a color", requestedSchema: { type: "object", properties: { color: { type: "string", enum: ["red", "blue"] } }, required: ["color"] } },
    (id, answer) => text(id, answer.action === "accept" ? "picked " + answer.content.color : "no pick: " + answer.action));
  if (q.params.name === "confirm") return ask(q.id, { mode: "form", message: "Go ahead?", requestedSchema: { type: "object", properties: {} } },
    (id, answer) => text(id, "confirmed: " + answer.action));
  if (q.params.name === "snap") return send({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "a dot" }, { type: "image", mimeType: "image/png", data: ${JSON.stringify(PNG)} }] } });
  send({ jsonrpc: "2.0", id: q.id, error: { code: -32602, message: "unknown tool" } });
});
`);
const configuredServer = normalizeConfiguredMcpServer({
  serverIdentityId,
  displayName: "fixture",
  transport: "stdio",
  command: process.execPath,
  args: [serverScript],
  projectId,
  workThreadId,
  trustState: "configured",
  enabledState: "enabled",
  freshness: "fresh",
  authPosture: "local_config",
});
const profile = buildExternalCapabilityProfile({
  projectId,
  workThreadId,
  serverIdentities: [mcpServerIdentityFor({
    serverIdentityId,
    displayName: configuredServer.displayName,
    selectorKey: configuredServer.selectorKey,
    transportKind: configuredServer.transportKind,
    authPosture: configuredServer.authPosture,
    trustState: configuredServer.trustState,
    enabledState: configuredServer.enabledState,
    freshness: configuredServer.freshness,
  })],
});
const project = {
  id: projectId,
  name: "MCP tool calls",
  workThreadId,
  workspace: { kind: "local", localPath: workspace },
  mcpServers: [configuredServer],
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};

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
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}
const lastOutput = (body) => body.input.filter((item) => item.type === "function_call_output").at(-1)?.output;

const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const resolvers = createDirectConfiguredMcpResolvers();
const bodies = [];
let steps = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  externalCapabilityProfileResolver: () => profile,
  ...resolvers,
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const step = steps.shift();
    assert(step !== undefined, "no extra request");
    return response(`r${bodies.length}`, typeof step === "function" ? step(body) : step);
  },
});
const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
const prompts = [];
let answers = [];
surface.on("event", (e) => {
  if (e.type !== "rpc-request" || e.request?.method !== "mcpServer/elicitation/request") return;
  prompts.push(e.request);
  const planned = answers.shift();
  assert(planned, `unexpected prompt: ${e.request.summary}`);
  setImmediate(async () => {
    for (const answer of Array.isArray(planned) ? planned : [planned]) {
      try {
        await surface.respond(e.request.key, answer);
        return;
      } catch (error) {
        prompts.push({ refused: error.message });
      }
    }
  });
});

async function runTurn(accessProfile, turnSteps, turnAnswers, existingThreadId = "") {
  steps = [...turnSteps];
  answers = [...turnAnswers];
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = existingThreadId || (await controller.handleRequest("thread/start", {
    title: "MCP", model: "gpt-5.6-sol", accessProfile, workThreadId,
  }, context)).thread.id;
  const start = bodies.length;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `t_${bodies.length}`, promptText: "Use the tools." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const deadline = Date.now() + 15_000;
  while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turn.turn.id).state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(steps.length, 0, "every scripted request was made");
  assert.equal(answers.length, 0, "every planned prompt appeared");
  return { threadId, turnId: turn.turn.id, bodies: bodies.slice(start), stored };
}

try {
  // Thread A, Workspace access.
  const a = await runTurn("workspace", [
    { name: "mcp__fixture__lookup", args: { q: "x" } },
    { name: "mcp__fixture__write_note", args: { text: "hi" } },
    { name: "mcp__fixture__write_note", args: { text: "again" } },
    { name: "mcp__fixture__pick_color", args: {} },
    { name: "mcp__fixture__snap", args: {} },
    null,
  ], [
    { action: "accept", _meta: { persist: "session" } },
    [{ action: "accept", content: { color: "green" } }, { action: "accept", content: { color: "blue" } }],
  ]);
  const declared = a.bodies[0].tools.filter((tool) => tool.name?.startsWith("mcp__"));
  assert.deepEqual(declared.map((tool) => tool.name).sort(), [
    "mcp__fixture__confirm", "mcp__fixture__lookup", "mcp__fixture__pick_color", "mcp__fixture__snap", "mcp__fixture__write_note",
  ]);
  assert.deepEqual(declared.find((tool) => tool.name === "mcp__fixture__lookup").parameters, { type: "object", properties: { q: { type: "string" } }, required: ["q"] });
  assert(a.bodies.every((body) => body.tools.some((tool) => tool.name === "mcp__fixture__snap")), "every request of the turn declares them");
  assert.match(lastOutput(a.bodies[1]), /^Wall time: \d+\.\d seconds\nOutput:\nfound x$/);
  assert.match(lastOutput(a.bodies[2]), /\{"saved":"hi"\}$/, "structuredContent wins over content");
  assert.match(lastOutput(a.bodies[3]), /\{"saved":"again"\}$/);
  assert.match(lastOutput(a.bodies[4]), /picked blue$/);
  const snap = lastOutput(a.bodies[5]);
  assert(Array.isArray(snap), "an image result goes back as content items");
  assert.equal(snap[0].type, "input_text");
  assert.match(snap[0].text, /a dot/);
  assert.equal(snap[1].image_url, `data:image/png;base64,${PNG}`);
  const approvals = prompts.filter((prompt) => prompt.params?._meta?.codex_approval_kind === "mcp_tool_call");
  assert.equal(approvals.length, 1, "only the first write_note asked; read-only tools and the thread allow didn't");
  assert.equal(approvals[0].params.message, 'Allow the fixture MCP server to run tool "write_note"?');
  assert.deepEqual(approvals[0].params._meta.tool_params, { text: "hi" });
  const form = prompts.find((prompt) => prompt.params?.message === "Pick a color");
  assert.deepEqual(form.params.requestedSchema.required, ["color"]);
  assert(prompts.some((prompt) => /must be one of/.test(prompt.refused || "")), "an answer outside the form is refused and the form stays open");
  const items = a.stored.unresolvedObligations.map((obligation) => obligation.mcpTool);
  assert(items.every((entry) => entry?.status === "completed" && entry.serverName === "fixture"), JSON.stringify(items));
  assert.equal(items[1].toolName, "write_note");

  // Thread B, Workspace: a decline goes back to the model; "always" is saved.
  prompts.length = 0;
  const b = await runTurn("workspace", [
    { name: "mcp__fixture__write_note", args: { text: "no" } },
    { name: "mcp__fixture__write_note", args: { text: "yes" } },
    null,
  ], [{ action: "decline" }, { action: "accept", _meta: { persist: "always" } }]);
  assert.match(lastOutput(b.bodies[1]), /user rejected MCP tool call/);
  assert.match(lastOutput(b.bodies[2]), /\{"saved":"yes"\}$/);
  assert(controller.approvalRuleStore.isMcpToolAllowed(projectId, serverIdentityId, "write_note"));

  // Thread C, Workspace: the saved rule means no prompt.
  prompts.length = 0;
  const c = await runTurn("workspace", [{ name: "mcp__fixture__write_note", args: { text: "saved rule" } }, null], []);
  assert.match(lastOutput(c.bodies[1]), /saved rule/);
  assert.equal(prompts.length, 0);

  // Thread D, Full access: an empty confirmation form is accepted without
  // asking; a form with fields still goes to the owner, and cancelling it
  // reaches the server.
  const d = await runTurn("full_access", [
    { name: "mcp__fixture__confirm", args: {} },
    { name: "mcp__fixture__pick_color", args: {} },
    null,
  ], [{ action: "cancel" }]);
  assert.match(lastOutput(d.bodies[1]), /confirmed: accept$/);
  assert.match(lastOutput(d.bodies[2]), /no pick: cancel$/);
  assert.equal(prompts.length, 1);

  console.log(JSON.stringify({ ok: true, requests: bodies.length, prompts: prompts.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await disposeHostMcpSessions().catch(() => {});
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
