#!/usr/bin/env node
// As in Codex, the Ultra effort turns on proactive delegation: the turn's
// input ends with Codex's multi-agent mode message, which tells the model to
// hand parallelizable work to sub-agents without being asked. Other efforts
// don't get it. The request itself carries the model's real effort, never
// "ultra".
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
function response(id) {
  const text = event("response.created", { response: { id, model: "gpt-5.6-sol" } }) +
    event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." }) +
    event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const proactive = (body) => (body.input || []).some((item) => item.role === "developer" &&
  /Proactive multi-agent delegation is active/.test(item.content?.[0]?.text || ""));

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-proactive-delegation-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "proactive_delegation_project", name: "Proactive delegation",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const bodies = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(`r${bodies.length}`);
  },
});

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const runTurn = async (threadId, effort, label) => {
    const before = bodies.length;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `proactive_${label}`, promptText: "Refactor the project.", effort }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const stored = sessionStore.readTurn(threadId, turn.turn.id);
    assert.equal(stored.state, "completed", JSON.stringify(stored.error));
    return { body: bodies[before], stored };
  };
  const ultraThread = (await controller.handleRequest("thread/start", {
    title: "Ultra", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_ultra",
  }, context)).thread.id;
  const ultra = await runTurn(ultraThread, "ultra", "ultra");
  assert(ultra.body.tools.some((tool) => tool.name === "spawn_agent"), "the turn can spawn agents");
  assert(proactive(ultra.body), "Ultra turns get the proactive delegation message");
  assert.equal(ultra.body.input.at(-1).role, "developer", "it follows the dialogue");
  assert.notEqual(ultra.body.reasoning?.effort, "ultra", "the request carries a real effort");
  assert.equal(ultra.stored.requestShape.proactiveDelegation, true);

  const highThread = (await controller.handleRequest("thread/start", {
    title: "High", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_high",
  }, context)).thread.id;
  const high = await runTurn(highThread, "high", "high");
  assert(!proactive(high.body), "other efforts delegate only when asked");
  assert.equal(high.stored.requestShape.proactiveDelegation, undefined);

  console.log(JSON.stringify({ ok: true, ultraEffort: ultra.body.reasoning?.effort || "", highProactive: false }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
