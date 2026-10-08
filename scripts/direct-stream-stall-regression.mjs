#!/usr/bin/env node
// A provider stream that goes quiet mid-response is reported: the transport
// emits stream_stalled once per pause and stream_resumed when bytes return,
// records the longest silence, and the turn shows a warning, so a long wait
// reads as the backend pausing rather than the app hanging.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { runDirectCodexStreamingRequest } = require("../src/main/direct/transport/codex-responses-transport.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const authStore = {
  readStatus: () => ({ status: "authenticated", hasAccessToken: true }),
  readCredentials: () => ({ accessToken: "fixture" }),
};
// The response starts, pauses for pauseMs, then finishes.
function pausingResponse(id, pauseMs) {
  const head = event("response.created", { response: { id, model: "gpt-5.6-sol" } })
    + event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Thinking" });
  const tail = event("response.output_text.delta", { item_id: `msg_${id}`, delta: " done." })
    + event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(head);
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
        yield new TextEncoder().encode(tail);
      },
    },
  };
}

// Transport: one stall notice, one resume, and the silence on record.
const phases = [];
const result = await runDirectCodexStreamingRequest({
  authStore,
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  fetchImpl: async () => pausingResponse("resp_stall", 400),
  streamStallNoticeMs: 100,
  onLifecycle: (lifecycle) => phases.push(lifecycle),
}, { model: "gpt-5.6-sol", stream: true, store: false, input: [] }, { schema: "fixture@1", kind: "text_probe" });
const stalls = phases.filter((entry) => entry.phase === "stream_stalled");
const resumes = phases.filter((entry) => entry.phase === "stream_resumed");
assert.equal(stalls.length, 1, "one notice per pause");
assert.equal(resumes.length, 1);
assert(resumes[0].silentMs >= 350, `resume reports the pause (${resumes[0].silentMs} ms)`);
assert.equal(result.lifecycle.timing.stallCount, 1);
assert(result.lifecycle.timing.longestSilenceMs >= 350);

// A stream without pauses reports none.
const quietPhases = [];
const quiet = await runDirectCodexStreamingRequest({
  authStore,
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  fetchImpl: async () => pausingResponse("resp_quick", 0),
  streamStallNoticeMs: 100,
  onLifecycle: (lifecycle) => quietPhases.push(lifecycle),
}, { model: "gpt-5.6-sol", stream: true, store: false, input: [] }, { schema: "fixture@1", kind: "text_probe" });
assert.equal(quietPhases.some((entry) => entry.phase === "stream_stalled"), false);
assert.equal(quiet.lifecycle.timing.stallCount, 0);

// Controller: the paused turn completes and shows a warning while waiting.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-stream-stall-"));
try {
  const project = {
    id: "stream_stall_project", name: "Stream stall",
    workspace: { kind: "local", localPath: root },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
  const controller = new DirectLiveTextController({
    sessionStore,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses", authStore,
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    streamStallNoticeMs: 100,
    fetchImpl: async () => pausingResponse("resp_turn", 400),
  });
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const warnings = [];
  surface.on("event", (e) => {
    if (e.type === "rpc-notification" && e.method === "warning") warnings.push(e.params);
  });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", { title: "Stall", model: "gpt-5.6-sol" }, context);
  const turn = await controller.handleRequest("turn/start", { threadId: started.thread.id, clientTurnRequestId: "stall_turn", promptText: "Answer slowly." }, context);
  await controller.waitForTurnCompletion({ sessionId: started.thread.id, turnId: turn.turn.id });
  assert.equal(sessionStore.readTurn(started.thread.id, turn.turn.id).state, "completed");
  assert(warnings.some((warning) => warning.kind === "stream_stalled" && /paused/.test(warning.message)), JSON.stringify(warnings));
  assert(warnings.some((warning) => warning.kind === "stream_resumed"), "the resume is noted too");
  controller.close("regression cleanup");
  console.log(JSON.stringify({ ok: true, transportStalls: stalls.length, longestSilenceMs: result.lifecycle.timing.longestSilenceMs, turnWarnings: warnings.length }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
