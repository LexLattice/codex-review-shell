#!/usr/bin/env node
// A thread goes on after a turn that didn't complete, as in Codex and Claude
// Code: the next message starts a turn instead of failing with "requires
// the previous turn to have completed safely". Its history keeps what the
// ended turn did, gives a call that never finished Codex's "aborted"
// output, and notes how that turn ended.
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

// Works in bash and PowerShell: no quotes inside the script (backticks for
// JS strings), and PowerShell needs & to run a quoted program path.
const nodeCommand = (script) => `${process.platform === "win32" ? "& " : ""}'${process.execPath}' -e '${script}'`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function response(id, step = {}) {
  if (step.status) {
    return { ok: false, status: step.status, headers: { get: () => "application/json" }, text: async () => "{\"error\":\"fixture\"}", json: async () => ({ error: "fixture" }) };
  }
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  for (const [index, call] of (step.calls || []).entries()) {
    const item = { id: `item_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  }
  if (!step.calls) text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: step.text || "Done." });
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const textOf = (item) => item?.content?.[0]?.text;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-followup-stopped-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "followup_stopped_project", name: "Follow-up after a stopped turn",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const requests = [];
let script = [];
let turnStart = 0;
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return response(`r${requests.length}`, script[requests.length - 1 - turnStart]);
  },
});

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Stopped", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_stopped",
  }, context);
  const threadId = started.thread.id;
  const startTurn = async (prompt, steps) => {
    turnStart = requests.length;
    script = steps;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `stopped_${requests.length}`, promptText: prompt }, context);
    return turn.turn.id;
  };
  const finish = async (turnId) => {
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId });
    return sessionStore.readTurn(threadId, turnId);
  };

  // 1. The model runs a slow command, then would update its plan (not
  // parallel-safe, so it waits for the command); the user stops the turn
  // while the command runs.
  const stoppedId = await startTurn("Count to a big number, then plan the rest.", [
    {
      calls: [
        { name: "exec_command", args: { cmd: nodeCommand("console.log(`counting`); setTimeout(() => {}, 60000)") } },
        { name: "update_plan", args: { plan: [{ step: "Write done.txt", status: "pending" }] } },
      ],
    },
    { text: "Counted and wrote done.txt." },
  ]);
  for (let i = 0; i < 200 && requests.length - turnStart < 1; i += 1) await delay(25);
  await delay(500);
  const interrupted = await controller.handleRequest("turn/interrupt", { threadId, turnId: stoppedId }, context);
  assert.ok(["abort_requested", "aborted"].includes(interrupted.status), JSON.stringify(interrupted));
  const stopped = await finish(stoppedId);
  assert.equal(stopped.state, "aborted");
  assert.equal(requests.length - turnStart, 1, "nothing ran after the stop");

  // 2. The next message starts a turn.
  const followupId = await startTurn("Never mind, what did you get to?", [{ text: "I was counting when you stopped me." }]);
  const followup = await finish(followupId);
  assert.equal(followup.state, "completed", JSON.stringify(followup.error));
  const input = requests[turnStart].input;
  assert.equal(textOf(input.find((item) => item.role === "user")), "Count to a big number, then plan the rest.");
  const calls = input.filter((item) => item.type === "function_call");
  const outputs = input.filter((item) => item.type === "function_call_output");
  assert.equal(calls.length, 2, "both calls of the stopped turn are in history");
  for (const call of calls) {
    assert.ok(outputs.some((output) => output.call_id === call.call_id), `every call has an output (${call.call_id})`);
  }
  const planCall = calls.find((call) => call.name === "update_plan");
  assert.equal(outputs.find((output) => output.call_id === planCall.call_id).output, "aborted", "a call that never ran reads as Codex's \"aborted\"");
  const note = input.findIndex((item) => item.role === "user" && textOf(item) === "[The user stopped this turn before it finished.]");
  assert.ok(note > input.indexOf(outputs.at(-1)), "the stop note follows the stopped turn's items");
  const current = input.findIndex((item) => item.role === "user" && textOf(item) === "Never mind, what did you get to?");
  assert.ok(current > note, "and the new message follows it");

  // 3. A turn that failed (the provider answered 500) doesn't block either.
  const failedId = await startTurn("Try again.", [{ status: 500 }]);
  const failed = await finish(failedId);
  assert.equal(failed.state, "failed", JSON.stringify(failed));
  const afterFailureId = await startTurn("And now?", [{ text: "Working now." }]);
  const afterFailure = await finish(afterFailureId);
  assert.equal(afterFailure.state, "completed", JSON.stringify(afterFailure.error));
  const afterInput = JSON.stringify(requests[turnStart].input);
  if (!failed.preTransportFailed) {
    assert.match(afterInput, /\[This turn ended before it finished \(failed\)\.\]/, "the failed turn is marked in history");
  }
  assert.match(afterInput, /\[The user stopped this turn before it finished\.\]/, "the stopped turn stays marked");

  console.log(JSON.stringify({ ok: true, stoppedHistoryItems: input.length, failedPreTransport: failed.preTransportFailed === true }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true });
}
