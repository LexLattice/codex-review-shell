#!/usr/bin/env node
// The model's update_plan shows in the turn as a checklist, as Codex shows
// its plan: one plan item per turn, replaced by each update, kept in the
// transcript so it shows again after a reload. Before, the plan was only
// recorded as plan evidence and never appeared in the Workbench.
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
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "All done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const plan = (statuses) => ({
  name: "update_plan",
  args: {
    planId: "plan_fixture",
    mutationKind: "replace_plan",
    steps: [
      { stepId: "read", text: "Read the code", status: statuses[0] },
      { stepId: "patch", text: "Patch the bug", status: statuses[1] },
      { stepId: "test", text: "Run the tests", status: statuses[2] },
    ],
  },
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-plan-ui-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "plan_ui_project", name: "Plan UI",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const steps = [plan(["completed_in_plan", "in_progress", "pending"]), plan(["completed_in_plan", "completed_in_plan", "in_progress"]), null];
const bodies = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(`r${bodies.length}`, steps[bodies.length - 1]);
  },
});

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const planEvents = [];
  surface.on("event", (e) => {
    if (e.type === "rpc-notification" && e.method === "item/completed" && e.params?.item?.type === "plan") planEvents.push(e.params.item);
  });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", {
    title: "Plan", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_plan",
  }, context)).thread.id;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "plan_1", promptText: "Fix the bug." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(planEvents.length, 2, "each update shows");
  assert.equal(planEvents[0].id, planEvents[1].id, "the same plan item, replaced");
  assert.equal(planEvents[0].text, "[x] Read the code\n[~] Patch the bug\n[ ] Run the tests");
  assert.equal(planEvents[1].text, "[x] Read the code\n[x] Patch the bug\n[~] Run the tests");
  const message = sessionStore.readSession(threadId).messages.find((entry) => entry.id === turn.turn.id);
  const kept = message.items.filter((item) => item.type === "plan");
  assert.equal(kept.length, 1, "one plan item in the transcript");
  assert.equal(kept[0].text, planEvents[1].text, "the latest plan is kept");
  console.log(JSON.stringify({ ok: true, updates: planEvents.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
