#!/usr/bin/env node
// Patches in Codex's own format apply (bare `@@`, `@@ anchor`, a first hunk
// without `@@`, `*** End of File`, whitespace-tolerant context), and a patch
// that doesn't match goes back to the model as the call's output instead of
// failing the turn. Found live: luna's bare-`@@` patch failed a Windows
// Full-access turn as direct_full_access_patch_invalid.
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
const {
  DirectFullAccessLocalEnvironmentExecutor,
  applyHunks,
  parseUnifiedPatch,
} = require("../src/main/direct/tools/full-access-local-environment.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

let checks = 0;
const apply = (patch, before) => {
  const [file] = parseUnifiedPatch(patch);
  return applyHunks(before, file.hunks, file.operation);
};
const begin = (body) => `*** Begin Patch\n*** Update File: a.py\n${body}\n*** End Patch\n`;

// 1. The format, hunk by hunk.
assert.deepEqual(apply(begin("@@\n-alpha\n+beta"), ["alpha"]), ["beta"], "bare @@");
assert.deepEqual(apply(begin("-alpha\n+beta"), ["alpha"]), ["beta"], "first hunk without @@");
assert.deepEqual(
  apply(begin("@@ def two():\n-    return 1\n+    return 2"), ["def one():", "    return 1", "def two():", "    return 1"]),
  ["def one():", "    return 1", "def two():", "    return 2"],
  "@@ anchor picks the hunk after the anchor line",
);
assert.deepEqual(apply(begin("@@\n+tail\n*** End of File"), ["x", "y"]), ["x", "y", "tail"], "pure addition at the end");
assert.deepEqual(apply(begin("@@\n x  \n-y\n+z\n"), ["x", "y"]), ["x", "z"], "loose context keeps the file's own text");
assert.deepEqual(apply("--- a/a.txt\n+++ b/a.txt\n@@ -2,1 +2,1 @@\n-y\n+Y\n", ["x", "y"]), ["x", "Y"], "unified diffs unchanged");
assert.throws(() => apply(begin("@@\n-nope\n+z"), ["x"]), (error) => error.code === "direct_full_access_patch_conflict" && /no lines matching "nope"/.test(error.message));
assert.throws(() => apply(begin("@@ class Missing\n-x\n+z"), ["x"]), (error) => error.code === "direct_full_access_patch_conflict" && /anchor "class Missing"/.test(error.message));
checks += 1;

// 2. A live-shaped turn: a patch that misses, then the fix.
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, { calls = [], text = "" } = {}) {
  let body = event("response.created", { response: { id, model: "gpt-6-luna" } });
  calls.forEach(([name, args], index) => {
    const item = { id: `item_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name, arguments: JSON.stringify(args) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  });
  if (text) body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: text });
  body += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-patch-codex-format-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "notes.txt"), "title\nalpha\n");
const project = {
  id: "patch_codex_format", name: "Patch format",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const script = [
  { calls: [["apply_patch", { patch: "*** Begin Patch\n*** Update File: notes.txt\n@@\n-gamma\n+beta\n*** End Patch" }]] },
  { calls: [["read_file", { path: "notes.txt" }]] },
  { calls: [["apply_patch", { patch: "*** Begin Patch\n*** Update File: notes.txt\n@@ title\n-alpha\n+beta\n*** End Patch" }]] },
  { text: "notes.txt now says beta." },
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
    const step = script[bodies.length - 1];
    assert(step, `unexpected provider request ${bodies.length}`);
    return response(`patch_format_${bodies.length}`, step);
  },
});
try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const warnings = [];
  surface.on("event", (e) => {
    if (e.type === "rpc-notification" && e.method === "warning") warnings.push(String(e.params?.message || ""));
  });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Patch format", model: "gpt-6-luna", accessProfile: "full_access", workThreadId: "work_thread_patch_format",
  }, context);
  const turnStart = await controller.handleRequest("turn/start", {
    threadId: started.thread.id, clientTurnRequestId: "patch_format_turn", promptText: "Change alpha to beta in notes.txt.",
  }, context);
  await controller.waitForTurnCompletion({ sessionId: started.thread.id, turnId: turnStart.turn.id });
  const turn = sessionStore.readTurn(started.thread.id, turnStart.turn.id);

  assert.equal(turn.state, "completed", JSON.stringify(turn.error));
  assert.equal(turn.error ?? null, null);
  assert.equal(bodies.length, 4);
  assert.equal(await fs.readFile(path.join(workspace, "notes.txt"), "utf8"), "title\nbeta\n");
  checks += 1;

  // The miss reached the model as the call's output, with what to do next.
  const missOutput = bodies[1].input.find((item) => item.type === "function_call_output");
  const miss = JSON.parse(missOutput.output);
  assert.equal(miss.status, "failed");
  assert.equal(miss.error.code, "direct_full_access_patch_conflict");
  assert.match(miss.error.message, /no lines matching "gamma".*Read the file and retry/);
  assert.equal(miss.workspaceChanged, false);
  assert(bodies[1].tools?.some((tool) => tool.name === "read_file"), "the model can read the file after the miss");
  assert.equal(warnings.length, 0, warnings.join(" | "));
  checks += 1;

  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true });
}
