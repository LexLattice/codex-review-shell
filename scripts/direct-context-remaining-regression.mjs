#!/usr/bin/env node
// get_context_remaining answers from real numbers: the model's context
// window from the account's model list and what this turn's last request
// used (input plus output, as Codex counts it). Before, Direct's runtime
// status had no context fields, so the tool always said "unknown".
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
function response(id, call, usage) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed", usage } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-context-remaining-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "context_remaining", name: "Context remaining",
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
    return bodies.length === 1
      ? response("r1", { name: "get_context_remaining", args: {} }, { input_tokens: 5000, output_tokens: 100, total_tokens: 5100 })
      : response(`r${bodies.length}`, null, { input_tokens: 5300, output_tokens: 20, total_tokens: 5320 });
  },
});

// The account's model list entry (a full provider metadata profile is out of
// scope here).
controller.catalogModelDescriptor = (_project, model) => (model === "gpt-5.6-sol" ? { model, contextWindow: 272_000 } : null);

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", {
    title: "Context", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_context",
  }, context)).thread.id;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "context_1", promptText: "How much context is left?" }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(bodies.length, 2);
  const output = JSON.parse(bodies[1].input.filter((item) => item.type === "function_call_output").at(-1).output);
  assert.equal(output.contextWindow, 272_000, JSON.stringify(output));
  assert.equal(output.usedTokens, 5100, "the last request's input plus output");
  assert.equal(output.remainingTokens, 266_900);
  assert.equal(output.estimateKind, "provider_reported");
  console.log(JSON.stringify({ ok: true, remaining: output.remainingTokens, pressure: output.pressurePercent }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
