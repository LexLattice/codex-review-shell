#!/usr/bin/env node
// Codex's view_image: the model can look at an image file. It is offered
// wherever read_file is (same read rules), and the image goes back as a
// function_call_output whose output is one input_image (a data URL), the way
// Codex sends it. Non-images are refused as an answer, not a failed turn;
// earlier turns replay a text note instead of the image.
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

// A 1x1 PNG.
const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "It is a single pixel." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-view-image-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "pixel.png"), Buffer.from(PIXEL_PNG, "base64"));
await fs.writeFile(path.join(workspace, "notes.txt"), "not an image\n");
const project = {
  id: "view_image_project", name: "View image",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const executor = new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace });
const bodies = [];
let script = [];
let start = 0;
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: executor,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(`r${bodies.length}`, script[bodies.length - 1 - start]);
  },
});
const outputOf = (body, callId) => body.input.find((item) => item.type === "function_call_output" && item.call_id === callId)?.output;

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", {
    title: "Image", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_image",
  }, context)).thread.id;
  const runTurn = async (prompt, steps, label) => {
    start = bodies.length;
    script = steps;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `image_${label}`, promptText: prompt }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const stored = sessionStore.readTurn(threadId, turn.turn.id);
    assert.equal(stored.state, "completed", JSON.stringify(stored.error));
    return { bodies: bodies.slice(start), stored };
  };

  const first = await runTurn("What is in pixel.png? Also look at notes.txt as an image.", [
    { name: "view_image", args: { path: "pixel.png" } },
    { name: "view_image", args: { path: "notes.txt" } },
    null,
  ], "one");
  const tool = first.bodies[0].tools.find((entry) => entry.name === "view_image");
  assert(tool, "view_image is offered with read_file");
  assert.deepEqual(tool.parameters.required, ["path"]);
  const imageOutput = outputOf(first.bodies[1], "call_r1");
  assert(Array.isArray(imageOutput), "the output is content items");
  assert.deepEqual(imageOutput, [{ type: "input_image", image_url: `data:image/png;base64,${PIXEL_PNG}`, detail: "high" }]);
  const refused = JSON.parse(outputOf(first.bodies[2], "call_r2"));
  assert.equal(refused.status, "failed");
  assert.equal(refused.error.code, "direct_view_image_unsupported", "a non-image is an answer, not a failed turn");
  assert.deepEqual(outputOf(first.bodies[2], "call_r1"), imageOutput, "later continuations still carry the image");
  assert(!JSON.stringify(first.stored).includes(PIXEL_PNG), "the image isn't stored in the turn record");

  // The next turn's history notes the image instead of resending it.
  const second = await runTurn("Thanks.", [null], "two");
  const historyOutput = outputOf(second.bodies[0], "call_r1");
  assert.equal(typeof historyOutput, "string");
  assert.match(historyOutput, /view_image_result/);
  assert.match(historyOutput, /call view_image again/);
  assert(!JSON.stringify(second.bodies[0]).includes(PIXEL_PNG), "no image data in later turns");

  console.log(JSON.stringify({ ok: true, requests: bodies.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
