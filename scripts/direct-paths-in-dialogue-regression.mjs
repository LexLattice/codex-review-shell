#!/usr/bin/env node
// Paths are ordinary content: a prompt naming /tmp/... or C:\... is sent as
// written, and a reply that contains a path stays in later turns' context.
// Found live: such prompts were refused (current_user_prompt_redaction_failed)
// and replies with paths were silently dropped from the next turn's history.
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
const { scanTextForRawExposure } = require("../src/main/direct/thread/renderer-transcript-projection.js");

let checks = 0;
const block = (text) => scanTextForRawExposure(text).filter((finding) => finding.severity === "block").map((finding) => finding.reason);
assert.deepEqual(block("Edit /home/rose/work/app.js and C:\\Work\\notes.txt"), [], "paths don't block");
assert(scanTextForRawExposure("see /tmp/x.log").some((finding) => finding.reason === "raw_path" && finding.severity === "warn"));
assert.deepEqual(block("Authorization: Bearer abcdefghijklmnop"), ["secret_pattern"], "secrets still block");
assert.deepEqual(block("access_token=abcdefghijklmnop"), ["secret_pattern"]);
checks += 1;

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, text) {
  const body = event("response.created", { response: { id, model: "gpt-6-luna" } }) +
    event("response.output_text.delta", { item_id: `msg_${id}`, delta: text }) +
    event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-paths-dialogue-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "paths_in_dialogue", name: "Paths",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "sessions"), mode: "context_build_required" });
const replies = [
  "The log is at /home/rose/work/app/logs/today.log and the config at C:\\Work\\app\\config.json.",
  "That first path is 36 characters long.",
];
const bodies = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-6-luna", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-6-luna", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(`paths_${bodies.length}`, replies[bodies.length - 1] || "ok");
  },
});
try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Paths", model: "gpt-6-luna", accessProfile: "full_access", workThreadId: "work_thread_paths",
  }, context);
  const threadId = started.thread.id;
  const runTurn = async (promptText, id) => {
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: id, promptText }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    return sessionStore.readTurn(threadId, turn.turn.id);
  };

  const first = await runTurn("Where are /tmp/demo/notes.txt and C:\\Work\\app\\config.json used?", "paths_turn_1");
  assert.equal(first.state, "completed", JSON.stringify(first.error));
  const firstInput = JSON.stringify(bodies[0].input);
  assert(firstInput.includes("/tmp/demo/notes.txt"), "the prompt's Linux path is sent as written");
  assert(firstInput.includes("C:\\\\Work\\\\app\\\\config.json"), "the prompt's Windows path is sent as written");
  checks += 1;

  const second = await runTurn("How long is the first path you gave?", "paths_turn_2");
  assert.equal(second.state, "completed", JSON.stringify(second.error));
  const secondInput = JSON.stringify(bodies[1].input);
  assert(secondInput.includes("/home/rose/work/app/logs/today.log"), "the earlier reply, path included, stays in context");
  assert(secondInput.includes("/tmp/demo/notes.txt"), "the earlier prompt, path included, stays in context");
  checks += 1;

  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true });
}
