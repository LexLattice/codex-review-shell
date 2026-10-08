#!/usr/bin/env node
// A patch that passes its dry run but then fails to apply is an answer for
// the model, as in Codex, not the end of the turn. When the apply fails while
// re-matching the files (nothing written), the model is told nothing changed;
// when it fails while writing, it is told files may have changed.
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

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Handled the failed patch." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const lastOutput = (body) => JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);
const PATCH = "*** Begin Patch\n*** Update File: notes.txt\n@@\n-alpha\n+beta\n*** End Patch";

// beforeApply runs just before the real apply; it can edit the file or throw.
async function runCase(root, name, beforeApply) {
  const workspace = path.join(root, name);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "notes.txt"), "alpha\n");
  const project = {
    id: `patch_failure_${name}`, name: "Patch apply failure",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `${name}-sessions`) });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `${name}-grants`) });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, `${name}-threads`), mode: "index_only" });
  const executor = new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace });
  const realRequest = executor.request.bind(executor);
  executor.request = async (binding, method, params = {}) => {
    if (method === "applyPatch" && params.mode === "apply") await beforeApply(workspace);
    return realRequest(binding, method, params);
  };
  const bodies = [];
  const steps = [() => ({ name: "apply_patch", args: { patch: PATCH } }), () => null];
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    fullAccessLocalEnvironmentExecutor: executor,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      assert(bodies.length <= steps.length, `${name}: unexpected extra provider request`);
      return response(`${name}_${bodies.length}`, steps[bodies.length - 1]());
    },
  });
  try {
    const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: name, model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: `work_thread_${name}`,
    }, context);
    const turn = await controller.handleRequest("turn/start", { threadId: started.thread.id, clientTurnRequestId: `patch_${name}`, promptText: "Change alpha to beta." }, context);
    await controller.waitForTurnCompletion({ sessionId: started.thread.id, turnId: turn.turn.id });
    return {
      turn: sessionStore.readTurn(started.thread.id, turn.turn.id),
      bodies,
      fileText: await fs.readFile(path.join(workspace, "notes.txt"), "utf8"),
    };
  } finally {
    controller.close("regression cleanup");
    await manager.dispose("regression cleanup");
    threadStore.close();
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-patch-apply-failure-"));
try {
  // The file changed after the dry run: the apply re-matches, finds no
  // "alpha", and writes nothing.
  const stale = await runCase(root, "changed_after_dry_run", async (workspace) => {
    await fs.writeFile(path.join(workspace, "notes.txt"), "gamma\n");
  });
  assert.equal(stale.turn.state, "completed", JSON.stringify(stale.turn.error));
  assert.equal(stale.turn.error ?? null, null);
  assert.equal(stale.bodies.length, 2, "the failure went back to the model");
  const staleOutput = lastOutput(stale.bodies[1]);
  assert.equal(staleOutput.status, "failed");
  assert.equal(staleOutput.workspaceChanged, false);
  assert.match(staleOutput.error.message, /Nothing was written/);
  assert.equal(stale.fileText, "gamma\n", "the concurrent edit is untouched");

  // Writing failed: the harness can't prove nothing changed, so the model is
  // told to re-read before retrying.
  const writeFailure = await runCase(root, "write_failed", async () => {
    throw Object.assign(new Error("Disk write failed."), { code: "fixture_write_failed" });
  });
  assert.equal(writeFailure.turn.state, "completed", JSON.stringify(writeFailure.turn.error));
  assert.equal(writeFailure.bodies.length, 2);
  const writeOutput = lastOutput(writeFailure.bodies[1]);
  assert.equal(writeOutput.status, "failed");
  assert.equal(writeOutput.error.code, "patch_execution_ambiguous");
  assert.equal(writeOutput.workspaceMayHaveChanged, true);
  assert.match(writeOutput.error.message, /read them before retrying/);

  console.log(JSON.stringify({ ok: true, changedAfterDryRun: staleOutput.error.code, writeFailed: writeOutput.error.code }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
