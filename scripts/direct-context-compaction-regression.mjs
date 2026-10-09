#!/usr/bin/env node
// Context compaction, as in Codex. Before, a long thread just dropped its
// oldest turns past a fixed size, and a long turn grew until the request
// failed. Now:
// - before a turn, when the request would reach the auto-compact limit (90%
//   of the context window), the earlier history is compacted: a request
//   ending with a compaction_trigger item returns one encrypted compaction
//   item, and the thread's checkpoint (newest user messages + that item)
//   replaces the history it covers in this and later turns;
// - if that fails, the model writes a handoff summary instead (Codex's
//   local compaction prompt and summary prefix);
// - mid-turn, a continuation that would reach the limit compacts the turn's
//   input and results so far, and later continuations carry the checkpoint;
// - the owner's Compact action (thread/compact/start) does the same on demand.
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
const { COMPACTION_PROMPT, COMPACTION_SUMMARY_PREFIX } = require("../src/main/direct/transport/codex-responses-transport.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function sse(id, step = {}) {
  if (step.httpStatus) {
    return { ok: false, status: step.httpStatus, statusText: "Bad Request", headers: { get: () => "application/json" }, text: async () => JSON.stringify({ detail: "compaction unsupported" }) };
  }
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (step.compaction) {
    const item = { id: `cmp_${id}`, type: "compaction", encrypted_content: step.compaction };
    text += event("response.output_item.added", { item: { ...item, encrypted_content: null } }) + event("response.output_item.done", { item });
  }
  for (const [index, call] of (step.calls || []).entries()) {
    const item = { id: `fc_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  }
  if (step.text) text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: step.text });
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const estimate = (body) => Math.ceil(Buffer.byteLength(JSON.stringify({ instructions: body.instructions, tools: body.tools, input: body.input }), "utf8") / 4);
const isCompactionRequest = (body) => body.input?.at(-1)?.type === "compaction_trigger";
const isLocalCompactionRequest = (body) => body.input?.at(-1)?.content?.[0]?.text === COMPACTION_PROMPT;
const textOf = (item) => item?.content?.[0]?.text || "";
const LONG_PROMPT = `Remember this project brief. ${"The brief repeats a long requirement. ".repeat(220)}`.trim();
// Long enough that history plus this message is well over the first request.
const SECOND_PROMPT = `Now the second request. ${"With more detail. ".repeat(60)}`.trim();

async function harness(root, name) {
  const workspace = path.join(root, name);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "big.txt"), `${"0123456789".repeat(1200)}\n`);
  const project = {
    id: `compaction_${name}`, name: "Compaction",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `${name}-sessions`) });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `${name}-grants`) });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, `${name}-threads`), mode: "index_only" });
  const bodies = [];
  let respond = () => ({ text: "Done." });
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return sse(`${name}_${bodies.length}`, respond(body, bodies.length));
    },
  });
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const notifications = [];
  surface.on("event", (e) => { if (e.type === "notification" || e.method) notifications.push(e); });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", {
    title: name, model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: `work_thread_${name}`,
  }, context)).thread.id;
  const runTurn = async (prompt, label) => {
    const before = bodies.length;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `${name}_${label}`, promptText: prompt }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const stored = sessionStore.readTurn(threadId, turn.turn.id);
    assert.equal(stored.state, "completed", `${name}/${label}: ${JSON.stringify(stored.error)}`);
    return { bodies: bodies.slice(before), stored };
  };
  return {
    controller, sessionStore, threadId, bodies, context, notifications, runTurn,
    setRespond: (fn) => { respond = fn; },
    close: async () => {
      controller.close("regression cleanup");
      await manager.dispose("regression cleanup");
      threadStore.close();
    },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-context-compaction-"));
try {
  // 1. Before a turn, remote compaction replaces the earlier history.
  {
    const h = await harness(root, "pre_turn");
    try {
      h.setRespond(() => ({ text: "Noted the brief." }));
      const first = await h.runTurn(LONG_PROMPT, "one");
      assert.equal(first.bodies.length, 1);
      // The next request (history + a new message) is over the limit.
      h.controller.autoCompactTokenLimit = estimate(first.bodies[0]) + 50;
      h.setRespond((body) => isCompactionRequest(body) ? { compaction: "ENC_PRE_TURN" } : { text: "Second answer." });
      const second = await h.runTurn(SECOND_PROMPT, "two");
      assert.equal(second.bodies.length, 2, "a compaction request, then the turn's request");
      const compactionBody = second.bodies[0];
      assert(isCompactionRequest(compactionBody), "ends with compaction_trigger");
      assert.equal(compactionBody.store, false);
      assert(compactionBody.tools?.length, "sent with the turn's tools, as Codex does");
      assert.equal(compactionBody.instructions, second.bodies[1].instructions, "and its instructions");
      assert(compactionBody.input.some((item) => item.role === "assistant" && textOf(item) === "Noted the brief."), "the history to compact");
      assert(!compactionBody.input.some((item) => textOf(item) === SECOND_PROMPT), "not the new message");
      const input = second.bodies[1].input;
      const compactionIndex = input.findIndex((item) => item.type === "compaction");
      assert(compactionIndex > 0, "the checkpoint replaces the history");
      assert.equal(input[compactionIndex].encrypted_content, "ENC_PRE_TURN");
      assert.equal(textOf(input[0]), LONG_PROMPT, "the user's earlier message is kept");
      assert(!input.some((item) => item.role === "assistant" && textOf(item) === "Noted the brief."), "the earlier reply is in the checkpoint");
      assert(input.findIndex((item) => textOf(item) === SECOND_PROMPT) > compactionIndex);
      assert.equal(second.stored.requestShape.threadCompactedBeforeTurn.mode, "remote");
      const checkpoint = h.sessionStore.readCompaction(h.threadId);
      assert.equal(checkpoint.coversThroughTurnId, first.stored.turnId);
      const sessionText = await fs.readFile(h.sessionStore.sessionPath(h.threadId), "utf8");
      assert(!sessionText.includes("ENC_PRE_TURN"), "the checkpoint stays out of the session file");
      assert(h.notifications.some((e) => JSON.stringify(e).includes("contextCompaction")), "the transcript shows the compaction");

      // A later turn starts from the checkpoint, then the turns after it.
      h.controller.autoCompactTokenLimit = 0;
      h.setRespond(() => ({ text: "Third answer." }));
      const third = await h.runTurn("Third request.", "three");
      const thirdInput = third.bodies[0].input;
      assert.equal(third.bodies.length, 1, "under the limit: no compaction");
      assert.deepEqual(thirdInput.slice(0, compactionIndex + 1), input.slice(0, compactionIndex + 1), "same checkpoint prefix (cache-stable)");
      assert(thirdInput.some((item) => item.role === "assistant" && textOf(item) === "Second answer."), "turns after the checkpoint follow it");
      assert.equal(third.stored.requestShape.historyCompactionId, checkpoint.compactionId);
    } finally {
      await h.close();
    }
  }

  // 2. Remote compaction refused: the model writes a summary instead.
  {
    const h = await harness(root, "local_fallback");
    try {
      h.setRespond(() => ({ text: "Noted the brief." }));
      const first = await h.runTurn(LONG_PROMPT, "one");
      h.controller.autoCompactTokenLimit = estimate(first.bodies[0]) + 50;
      h.setRespond((body) => isCompactionRequest(body)
        ? { httpStatus: 400 }
        : isLocalCompactionRequest(body) ? { text: "SUMMARY: the brief and its requirement." } : { text: "Answer." });
      const second = await h.runTurn(SECOND_PROMPT, "two");
      assert.equal(second.bodies.length, 3, "remote, local, then the turn");
      assert(isLocalCompactionRequest(second.bodies[1]), "Codex's compaction prompt");
      assert.equal(second.bodies[1].tools, undefined, "the summary request has no tools");
      const summary = second.bodies[2].input.find((item) => textOf(item).startsWith(COMPACTION_SUMMARY_PREFIX));
      assert(summary, "the summary replaces the history");
      assert.match(textOf(summary), /SUMMARY: the brief and its requirement\./);
      assert.equal(summary.role, "user");
      assert.equal(second.stored.requestShape.threadCompactedBeforeTurn.mode, "local");
      assert(h.notifications.some((e) => /Long threads and multiple compactions/.test(JSON.stringify(e))), "Codex's warning after a local compaction");
    } finally {
      await h.close();
    }
  }

  // 3. Mid-turn: a continuation over the limit compacts the turn so far.
  {
    const h = await harness(root, "mid_turn");
    try {
      const readBig = { name: "exec_command", args: { cmd: `${process.platform === "win32" ? "Get-Content" : "cat"} big.txt` } };
      h.setRespond((body, index) => {
        if (isCompactionRequest(body)) return { compaction: "ENC_MID_TURN" };
        if (index === 1) {
          // The output (12,000 characters) puts the continuation over.
          h.controller.autoCompactTokenLimit = estimate(body) + 1000;
          return { calls: [readBig] };
        }
        return { text: "Read it." };
      });
      const turn = await h.runTurn("Read big.txt.", "one");
      assert.equal(turn.bodies.length, 3, "first request, compaction, continuation");
      const compactionBody = turn.bodies[1];
      assert(isCompactionRequest(compactionBody));
      assert(compactionBody.input.some((item) => item.type === "function_call_output" && item.output.includes("0123456789")), "compacts the result so far");
      assert.equal(compactionBody.input.at(-2).type, "function_call_output", "the results end the history, without the continuation's guidance");
      const continuation = turn.bodies[2].input;
      assert(continuation.some((item) => item.type === "compaction" && item.encrypted_content === "ENC_MID_TURN"), "the continuation carries the checkpoint");
      assert(!continuation.some((item) => item.type === "function_call_output"), "the compacted result isn't resent");
      assert.match(textOf(continuation[0]), /Read big\.txt\.$/, "the user's message is kept");
      assert.equal(continuation.at(-1).role, "developer", "the continuation's guidance stays last");
      assert.equal(turn.stored.turnCompaction.compactionCount, 1);
      assert.equal(turn.stored.turnCompaction.mode, "remote");
    } finally {
      await h.close();
    }
  }

  // 4. The owner's Compact action.
  {
    const h = await harness(root, "manual");
    try {
      h.setRespond(() => ({ text: "First answer." }));
      const nothing = await h.controller.handleRequest("thread/compact/start", { threadId: h.threadId }, h.context);
      assert.equal(nothing.compacted, false, "nothing to compact in a new thread");
      await h.runTurn("First request.", "one");
      await h.runTurn("Second request.", "two");
      h.setRespond((body) => isCompactionRequest(body) ? { compaction: "ENC_MANUAL" } : { text: "Third answer." });
      const before = h.bodies.length;
      const result = await h.controller.handleRequest("thread/compact/start", { threadId: h.threadId }, h.context);
      assert.equal(result.compacted, true);
      assert.equal(result.compaction.trigger, "manual");
      assert.equal(h.bodies.length, before + 1);
      assert(isCompactionRequest(h.bodies.at(-1)));
      const again = await h.controller.handleRequest("thread/compact/start", { threadId: h.threadId }, h.context);
      assert.equal(again.compacted, false);
      assert.equal(again.reason, "already_compacted");
      const third = await h.runTurn("Third request.", "three");
      const input = third.bodies[0].input;
      assert(input.some((item) => item.type === "compaction" && item.encrypted_content === "ENC_MANUAL"));
      assert(!input.some((item) => item.role === "assistant"), "both earlier replies are in the checkpoint");
      assert.deepEqual(input.filter((item) => item.role === "user").slice(0, 2).map(textOf), ["First request.", "Second request."], "the user's messages are kept");
    } finally {
      await h.close();
    }
  }

  console.log(JSON.stringify({ ok: true, cases: ["pre_turn", "local_fallback", "mid_turn", "manual"] }));
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
