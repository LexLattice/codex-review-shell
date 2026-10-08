#!/usr/bin/env node
// exec_command waits (bounded) for the command to finish, as Codex does, so a
// short command settles in one call instead of a provider poll round trip.
// write_stdin waits briefly after writing, and input aimed at a process that
// already exited reports its final result instead of failing the turn.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const authStore = {
  readStatus: () => ({ status: "authenticated", hasAccessToken: true }),
  readCredentials: () => ({ accessToken: "fixture" }),
};

function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item });
    text += event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}

function lastCallOutput(body) {
  const outputs = body.input.filter((item) => item.type === "function_call_output");
  return JSON.parse(outputs.at(-1).output);
}

// steps: each entry receives the request bodies so far and returns the next
// provider call ({ name, args }), null for a final answer, or a promise.
async function runTurn(root, name, steps) {
  const workspace = path.join(root, name);
  await fs.mkdir(workspace, { recursive: true });
  const project = {
    id: `exec_yield_${name}`, name: "Exec yield regression",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `${name}-sessions`) });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `${name}-grants`) });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const bodies = [];
  const controller = new DirectLiveTextController({
    sessionStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses", authStore,
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      assert(bodies.length <= steps.length + 1, `${name}: unexpected extra provider request`);
      const step = steps[bodies.length - 1];
      const call = step ? await step(bodies) : null;
      return response(`${name}_${bodies.length}`, call);
    },
  });
  try {
    const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: name, model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: `work_thread_${name}`,
    }, context);
    const taskId = started.thread.id;
    const startedAt = Date.now();
    const startedTurn = await controller.handleRequest("turn/start", {
      threadId: taskId, clientTurnRequestId: `exec_yield_${name}`, promptText: "Run it.",
    }, context);
    await controller.waitForTurnCompletion({ sessionId: taskId, turnId: startedTurn.turn.id });
    const turn = sessionStore.readTurn(taskId, startedTurn.turn.id);
    return { turn, bodies, elapsedMs: Date.now() - startedAt, outputs: turn.toolResults.map((r) => JSON.parse(r.providerOutputText)) };
  } finally {
    controller.close("regression cleanup");
    await manager.dispose("regression cleanup");
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-exec-yield-"));
try {
  // A 1.5 s command finishes inside the default wait: one tool call, one
  // continuation, and the result already carries the exit code and output.
  const slow = await runTurn(root, "slow_command", [
    () => ({ name: "exec_command", args: { cmd: `${node} -e ${quote("setTimeout(() => console.log('slow-done'), 1500)")}` } }),
  ]);
  assert.equal(slow.turn.state, "completed", JSON.stringify(slow.turn.error));
  assert.equal(slow.bodies.length, 2);
  assert.equal(slow.outputs[0].status, "completed");
  assert.equal(slow.outputs[0].exitCode, 0);
  assert(slow.outputs[0].stdoutPreview.includes("slow-done"));

  // The model chose a short wait, the process exited while the model was
  // still answering, then it sent EOF: the turn continues with the final
  // result instead of failing with session_not_live.
  const late = await runTurn(root, "late_eof", [
    () => ({ name: "exec_command", args: { cmd: `${node} -e ${quote("setTimeout(() => { console.log('exited-early'); process.exit(0); }, 200)")}`, stdinPolicy: "line_input", yield_time_ms: 50 } }),
    async (bodies) => {
      const running = lastCallOutput(bodies.at(-1));
      assert.equal(running.status, "running", "yield_time_ms shortens the wait");
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { name: "write_stdin", args: { session_id: running.sessionId, eof: true } };
    },
  ]);
  assert.equal(late.turn.state, "completed", JSON.stringify(late.turn.error));
  assert.equal(late.bodies.length, 3);
  assert.equal(late.outputs[1].status, "completed");
  assert.equal(late.outputs[1].alreadyTerminal, true);
  assert.equal(late.outputs[1].stdinAccepted, false);
  assert(late.outputs[1].stdoutPreview.includes("exited-early"));

  // Input to a live process: write_stdin waits briefly, so a process that
  // answers and exits reports completion in the same call.
  const live = await runTurn(root, "live_input", [
    () => ({ name: "exec_command", args: { cmd: `${node} -e ${quote("process.stdin.once('data', (d) => { console.log('got ' + String(d).trim()); process.exit(0); })")}`, stdinPolicy: "line_input", yield_time_ms: 100 } }),
    (bodies) => ({ name: "write_stdin", args: { session_id: lastCallOutput(bodies.at(-1)).sessionId, chars: "hi\n" } }),
  ]);
  assert.equal(live.turn.state, "completed", JSON.stringify(live.turn.error));
  assert.equal(live.outputs[0].status, "running");
  assert.equal(live.outputs[1].status, "completed");
  assert.equal(live.outputs[1].stdinAccepted, true);
  assert(live.outputs[1].stdoutPreview.includes("got hi"));

  // A silent process waiting for input is returned well before its idle
  // timeout would kill it.
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "idle-grants") });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => root, idleTimeoutMs: 600 });
  try {
    const grant = grants.issueFullAccess({ taskId: "idle_task", threadId: "idle_task", projectId: "idle_project", executionEnvironment: { environmentId: "idle_env", kind: "local", bindingDigest: "sha256:idle-env" }, capabilities: ["exec_command", "write_stdin"] });
    const scope = { taskId: "idle_task", threadId: "idle_task", projectId: "idle_project", grantId: grant.grantId, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
    const started = manager.start({ ...scope, cmd: `${node} -e ${quote("process.stdin.once('data', () => process.exit(0))")}`, stdinPolicy: "line_input" });
    const before = Date.now();
    const observed = await manager.initialYield({ ...scope, sessionId: started.sessionId });
    assert.equal(observed.status, "running");
    assert(Date.now() - before < 600, "the wait stays inside the idle timeout");
    assert.equal(manager.settledResult({ ...scope, sessionId: started.sessionId }), null, "a live session has no settled result");
  } finally {
    await manager.dispose("idle cleanup");
  }

  console.log(JSON.stringify({
    ok: true,
    slowCommandSingleCall: slow.bodies.length === 2,
    lateEofContinues: late.turn.state,
    liveInputSettlesInCall: live.outputs[1].status,
    elapsedMs: { slow: slow.elapsedMs, late: late.elapsedMs, live: live.elapsedMs },
  }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
