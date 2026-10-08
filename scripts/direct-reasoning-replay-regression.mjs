#!/usr/bin/env node
// Like Codex, every request asks for reasoning as encrypted content, and each
// continuation sends a response's reasoning back right before the calls it
// led to. Requests are stateless (store is off), so without this the model
// started every step of a turn with no memory of why it made its last call.
// The encrypted content stays in the turn record, out of the session file.
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

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const printCommand = (text) => `${node} -e ${quote(`process.stdout.write(${JSON.stringify(text)})`)}`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const encrypted = (id) => `gAAAA_${id}_${"x".repeat(64)}`;
function response(id, step = {}) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (step.reasoning) {
    const item = { id: `rs_${id}`, type: "reasoning", summary: [{ type: "summary_text", text: `thinking ${id}` }], content: null, encrypted_content: encrypted(id) };
    text += event("response.output_item.added", { item: { ...item, encrypted_content: null } }) + event("response.output_item.done", { item });
  }
  for (const [index, call] of (step.calls || []).entries()) {
    const item = { id: `fc_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name: "exec_command", arguments: JSON.stringify({ cmd: printCommand(call) }) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  }
  if (!step.calls?.length) text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: step.text || "Done." });
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-reasoning-replay-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "reasoning_replay_project", name: "Reasoning replay",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionsDir = path.join(root, "sessions");
const sessionStore = new DirectSessionStore({ rootDir: sessionsDir });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const requests = [];
// r1: reasoning + one call; r2: reasoning + two calls; r3: no reasoning, one
// call; r4: the reply.
const script = [
  { reasoning: true, calls: ["one"] },
  { reasoning: true, calls: ["two", "three"] },
  { calls: ["four"] },
  { text: "All four printed." },
];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return response(`r${requests.length}`, script[requests.length - 1]);
  },
});

const callIndex = (input, callId) => input.findIndex((item) => item.type === "function_call" && item.call_id === callId);
function assertReasoningBefore(input, callId, id) {
  const index = callIndex(input, callId);
  assert(index > 0, `${callId} is replayed`);
  const before = input[index - 1];
  assert.equal(before.type, "reasoning", `reasoning sits right before ${callId}`);
  assert.equal(before.encrypted_content, encrypted(id));
  assert.equal(before.id, `rs_${id}`);
  assert.deepEqual(before.summary, [{ type: "summary_text", text: `thinking ${id}` }]);
}
function assertNoReasoningBefore(input, callId) {
  const index = callIndex(input, callId);
  assert(index > 0, `${callId} is replayed`);
  assert.notEqual(input[index - 1].type, "reasoning", `no reasoning before ${callId}`);
}

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Reasoning", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_reasoning",
  }, context);
  const threadId = started.thread.id;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "reasoning_1", promptText: "Print one, two, three, four." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(requests.length, 4, "one request per step");

  for (const request of requests) {
    assert.deepEqual(request.include, ["reasoning.encrypted_content"], "every request asks for encrypted reasoning");
    assert.equal(request.store, false);
  }
  assert(!requests[0].input.some((item) => item.type === "reasoning"), "the first request has no reasoning to send back");

  const second = requests[1].input;
  assertReasoningBefore(second, "call_r1_0", "r1");
  assert.equal(second.filter((item) => item.type === "reasoning").length, 1);

  const third = requests[2].input;
  assertReasoningBefore(third, "call_r1_0", "r1");
  assertReasoningBefore(third, "call_r2_0", "r2");
  assertNoReasoningBefore(third, "call_r2_1");
  assert.equal(third.filter((item) => item.type === "reasoning").length, 2, "each response's reasoning is sent once");

  const fourth = requests[3].input;
  assertReasoningBefore(fourth, "call_r1_0", "r1");
  assertReasoningBefore(fourth, "call_r2_0", "r2");
  assertNoReasoningBefore(fourth, "call_r3_0");
  // Each request extends the one before it (prompt cache).
  const guidanceFree = (input) => input.filter((item) => item.role !== "developer");
  assert.deepEqual(guidanceFree(fourth).slice(0, guidanceFree(third).length), guidanceFree(third), "the input only grows");

  // The encrypted content lives on the turn record, never in the session file
  // the transcript and thread list read.
  assert(JSON.stringify(stored).includes(encrypted("r1")), "the turn record keeps the reasoning");
  const sessionText = await fs.readFile(sessionStore.sessionPath(threadId), "utf8");
  assert.match(sessionText, /call_r2_0/, "the session file records the calls");
  assert(!sessionText.includes("gAAAA_"), "the session file holds no encrypted reasoning");
  assert(!sessionText.includes("precedingReasoningItems"));

  console.log(JSON.stringify({ ok: true, requests: requests.length, replayed: fourth.filter((item) => item.type === "reasoning").length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  // On Windows the warm PowerShell shells exit a moment after disposal.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
