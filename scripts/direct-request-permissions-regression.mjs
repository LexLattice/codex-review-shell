#!/usr/bin/env node
// request_permissions, Direct's form of Codex's tool: in a Read only or
// Workspace thread the model can ask the owner to raise the thread's Access.
// The owner allows it for this turn (Access returns when the turn ends) or
// for the thread, or denies it; a grant applies to the rest of the turn at
// once. Full access threads aren't offered the tool.
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

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const toolNames = (body) => (body.tools || []).map((tool) => tool.name);
const permissionsTool = (body) => (body.tools || []).find((tool) => tool.name === "request_permissions");
const lastOutput = (body) => JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);

async function runCase(root, name, { accessProfile, answer, ask = { access: "full_access", scope: "turn", reason: "needs the network" }, asks = null }) {
  const workspace = path.join(root, name);
  await fs.mkdir(workspace, { recursive: true });
  const project = {
    id: `permissions_${name}`, name: "Permissions",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `${name}-sessions`) });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `${name}-grants`) });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, `${name}-threads`), mode: "index_only" });
  const bodies = [];
  const steps = answer ? [...(asks || [ask]).map((args) => ({ name: "request_permissions", args })), null] : [null];
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      assert(bodies.length <= steps.length, `${name}: unexpected extra provider request`);
      return response(`${name}_${bodies.length}`, steps[bodies.length - 1]);
    },
  });
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const questions = [];
  surface.on("event", (e) => {
    const request = e.request;
    if (e.type !== "rpc-request" || request?.method !== "item/tool/requestUserInput") return;
    questions.push(request.params);
    setImmediate(() => surface.respond(request.key, { answers: { permission_decision: { answers: [answer] } } }).catch(() => {}));
  });
  try {
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: name, model: "gpt-5.6-sol", accessProfile, workThreadId: `work_thread_${name}`,
    }, context);
    const threadId = started.thread.id;
    const before = sessionStore.readSession(threadId).harnessAccessProfile;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `permissions_${name}`, promptText: "Do the task." }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const deadline = Date.now() + 5000;
    while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turn.turn.id).state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return {
      bodies,
      questions,
      before,
      turn: sessionStore.readTurn(threadId, turn.turn.id),
      after: sessionStore.readSession(threadId),
    };
  } finally {
    controller.close("regression cleanup");
    await manager.dispose("regression cleanup");
    threadStore.close();
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-request-permissions-"));
try {
  // Allowed for this turn: the rest of the turn runs with Full access, and
  // the thread is back at Workspace afterwards.
  const turnOnly = await runCase(root, "allow_turn", { accessProfile: "workspace", answer: "allow_turn" });
  assert.equal(turnOnly.before, "workspace");
  assert.deepEqual(permissionsTool(turnOnly.bodies[0]).parameters.properties.access.enum, ["full_access"], "only higher levels are offered");
  assert.equal(turnOnly.questions.length, 1, "the owner was asked once");
  assert.match(turnOnly.questions[0].questions[0].question, /Workspace to Full access/);
  assert.equal(turnOnly.turn.state, "completed", JSON.stringify(turnOnly.turn.error));
  const granted = lastOutput(turnOnly.bodies[1]);
  assert.equal(granted.status, "granted");
  assert.equal(granted.scope, "turn");
  assert.equal(granted.accessProfile, "full_access");
  assert(!toolNames(turnOnly.bodies[0]).includes("run_command"), "Workspace doesn't declare run_command");
  assert(toolNames(turnOnly.bodies[1]).includes("run_command"), "the next request already has Full access tools");
  assert.equal(permissionsTool(turnOnly.bodies[1]), undefined, "nothing higher to ask for");
  assert(turnOnly.turn.requestShape.declaredToolNames.includes("run_command"), "the running turn is rebound to the new grant");
  assert.equal(turnOnly.after.harnessAccessProfile, "workspace", "Access returns when the turn ends");
  assert.equal(turnOnly.after.accessRevertAfterTurn, null);

  // Allowed for the thread: Full access stays.
  const thread = await runCase(root, "allow_thread", { accessProfile: "workspace", answer: "Allow for this thread" });
  assert.equal(lastOutput(thread.bodies[1]).scope, "thread");
  assert.equal(thread.after.harnessAccessProfile, "full_access");

  // Denied: the model is told, and Access doesn't change.
  const denied = await runCase(root, "deny", { accessProfile: "read_only", answer: "deny", ask: { access: "workspace", reason: "edit a file" } });
  assert.deepEqual(permissionsTool(denied.bodies[0]).parameters.properties.access.enum, ["workspace", "full_access"]);
  assert.equal(lastOutput(denied.bodies[1]).status, "denied");
  assert.equal(denied.turn.state, "completed");
  assert.equal(denied.after.harnessAccessProfile, "read_only");

  // Two raises in one turn (Read only to Workspace, then to Full access):
  // the thread returns to Read only, not to the first raise's Workspace.
  const nested = await runCase(root, "nested_turn", {
    accessProfile: "read_only",
    answer: "allow_turn",
    asks: [
      { access: "workspace", scope: "turn", reason: "edit a file" },
      { access: "full_access", scope: "turn", reason: "fetch a dependency" },
    ],
  });
  assert.equal(nested.questions.length, 2);
  assert.equal(nested.turn.state, "completed", JSON.stringify(nested.turn.error));
  assert.deepEqual([lastOutput(nested.bodies[1]).accessProfile, lastOutput(nested.bodies[2]).accessProfile], ["workspace", "full_access"]);
  assert.equal(nested.after.harnessAccessProfile, "read_only", "a turn-only raise never outlives its turn");
  assert.equal(nested.after.accessRevertAfterTurn, null);

  // Full access threads aren't offered the tool.
  const full = await runCase(root, "full_access", { accessProfile: "full_access" });
  assert.equal(permissionsTool(full.bodies[0]), undefined);

  console.log(JSON.stringify({ ok: true, allowTurn: turnOnly.after.harnessAccessProfile, allowThread: thread.after.harnessAccessProfile, denied: denied.after.harnessAccessProfile }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
