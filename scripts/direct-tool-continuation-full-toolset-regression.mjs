#!/usr/bin/env node
// Every continuation keeps the turn's full tool set (as in Codex): after any
// tool result the model may call any granted tool, several in one response,
// with no step cap. Once, a self-constitution check left the model with no
// tools ("this continuation exposes no executable tool interface"), and a
// command could only be followed by more commands.
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
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const quote = (s) => `'${s.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
const node = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)}`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

// One provider response: tool calls (in order) or final text.
function response(id, { calls = [], text = "" } = {}) {
  let body = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  calls.forEach(([name, args], index) => {
    const item = { id: `item_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name, arguments: JSON.stringify(args) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  });
  if (text) body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: text });
  body += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}

const PATCH = `diff --git a/calc.js b/calc.js
--- a/calc.js
+++ b/calc.js
@@ -1,1 +1,1 @@
-module.exports = (a, b) => a - b;
+module.exports = (a, b) => a + b;
`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-full-toolset-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "calc.js"), "module.exports = (a, b) => a - b;\n");
const project = {
  id: "full_toolset_project", name: "Full tool set",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });

const script = [
  { calls: [["inspect_self_constitution", {}]] },
  { calls: [["exec_command", { cmd: `${node} -e ${quote("console.log('step-two-ran')")}` }]] },
  // Two calls in one response: the patch, then a read that must see it.
  { calls: [["apply_patch", { patch: PATCH }], ["read_file", { path: "calc.js" }]] },
  { text: "Verified: the environment, a command, the patch, and the read." },
];
const bodies = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const step = script[bodies.length - 1];
    assert(step, `unexpected provider request ${bodies.length}`);
    return response(`full_toolset_${bodies.length}`, step);
  },
});

const toolNames = (body) => (body.tools || []).map((tool) => tool.name).sort();
let checks = 0;
try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  let approvals = 0;
  const warnings = [];
  surface.on("event", (e) => {
    if (e.type === "rpc-request") approvals += 1;
    if (e.type === "rpc-notification" && e.method === "warning") warnings.push(String(e.params?.message || ""));
  });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Full tool set", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_full_toolset",
  }, context);
  const taskId = started.thread.id;
  const turnStart = await controller.handleRequest("turn/start", {
    threadId: taskId, clientTurnRequestId: "full_toolset_turn", promptText: "Check your environment, then verify it in practice and fix calc.js.",
  }, context);
  await controller.waitForTurnCompletion({ sessionId: taskId, turnId: turnStart.turn.id });
  const turn = sessionStore.readTurn(taskId, turnStart.turn.id);

  assert.equal(turn.state, "completed", JSON.stringify(turn.error));
  assert.equal(bodies.length, 4, "initial request, then one continuation per model response");
  checks += 1;

  const initialTools = toolNames(bodies[0]);
  for (const name of ["inspect_self_constitution", "exec_command", "apply_patch", "read_file"]) {
    assert(initialTools.includes(name), `${name} is declared initially`);
  }
  for (const [index, body] of bodies.slice(1).entries()) {
    assert.deepEqual(toolNames(body), initialTools, `continuation ${index + 1} declares the turn's full tool set`);
    assert.doesNotMatch(body.instructions, /without requesting another tool|Do not request|must not be requested|at most one/i);
  }
  checks += 1;

  const results = turn.toolResults.map((result) => ({ result, obligation: turn.unresolvedObligations.find((o) => o.obligationId === result.obligationId) }));
  assert.deepEqual(results.map(({ obligation }) => obligation.name), ["inspect_self_constitution", "exec_command", "apply_patch", "read_file"]);
  assert.match(JSON.parse(results[1].result.providerOutputText).stdoutPreview, /step-two-ran/);
  // The model's own view of its tools reflects the thread's Full access: the
  // grant authorizes edits and commands, nothing waits on per-action approval.
  const rows = JSON.parse(results[0].result.providerOutputText).snapshot.capabilities.rows;
  for (const name of ["apply_patch", "exec_command", "read_file"]) {
    const row = rows.find((entry) => entry.toolName === name);
    assert.equal(row?.grantedState, "granted", `${name} reads as granted`);
    assert.equal(row.authority.requirement, "durable_task_grant", `${name} is authorized by the thread grant`);
  }
  assert.equal(rows.some((entry) => entry.authority?.requirement === "per_action_human_approval"), false);
  assert.equal(await fs.readFile(path.join(workspace, "calc.js"), "utf8"), "module.exports = (a, b) => a + b;\n");
  assert.match(results[3].result.providerOutputText, /a \+ b/, "the read in the same response sees the patch");
  checks += 1;

  // The two calls of one response produce one continuation carrying both,
  // and every continuation resends the turn's start and all results so far.
  // As in Codex, each earlier call is replayed as the call itself followed by
  // its output, in order.
  const lastInput = JSON.stringify(bodies[3].input);
  assert.match(lastInput, /a \+ b/);
  const replayed = bodies[3].input.filter((item) => item.type === "function_call" || item.type === "function_call_output");
  assert.deepEqual(
    replayed.map((item) => [item.type, item.call_id]),
    results.flatMap(({ obligation }) => [["function_call", obligation.callId], ["function_call_output", obligation.callId]]),
  );
  assert.equal(replayed[0].name, "inspect_self_constitution");
  assert.match(lastInput, /step-two-ran/, "the command output from two steps back is still in context");
  assert.doesNotMatch(lastInput, /PRIOR TOOL EVIDENCE/);
  for (const body of bodies.slice(1)) {
    assert.match(JSON.stringify(body.input), /fix calc\.js/, "each continuation carries the user's request");
  }
  checks += 1;

  assert.equal(approvals, 0, "Full access asks nothing");
  assert.equal(warnings.some((message) => /approval/i.test(message)), false, warnings.join(" | "));
  checks += 1;

  console.log(JSON.stringify({ ok: true, checks, requests: bodies.length, tools: initialTools.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
