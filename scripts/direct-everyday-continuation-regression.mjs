#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const initialSource = "module.exports = (a, b) => a - b;\n";
const expectedSource = initialSource.replace("a - b", "a + b");
const testSource = "const assert = require('node:assert/strict'); const add = require('./calc'); assert.equal(add(2, 3), 5); console.log('repair-test-passed');\n";
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function processObservation(result) {
  const snapshot = structuredClone(result);
  // Observation timestamps and their derived digests can change on a read.
  delete snapshot.resultDigest;
  delete snapshot.surface.generatedAt;
  delete snapshot.surface.surfaceDigest;
  return snapshot;
}
function response(id, command) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (command) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: "exec_command", arguments: JSON.stringify({ cmd: command }) };
    text += event("response.output_item.added", { item });
    text += event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Repair tested." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const authStore = {
  readStatus: () => ({ status: "authenticated", hasAccessToken: true }),
  readCredentials: () => ({ accessToken: "fixture" }),
};

async function runRoute(root, threaded) {
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "calc.js"), initialSource);
  await fs.writeFile(path.join(workspace, "test.js"), testSource);
  const project = {
    id: threaded ? "with_thread_store" : "without_thread_store", name: "Continuation regression",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = threaded ? new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" }) : null;
  const commands = [
    `${node} -e ${quote("console.log(require('node:fs').readFileSync('calc.js', 'utf8'))")}`,
    `${node} -e ${quote("const fs = require('node:fs'); fs.writeFileSync('calc.js', fs.readFileSync('calc.js', 'utf8').replace('a - b', 'a + b')); console.log('repair-applied')")}`,
    `${node} test.js`,
  ];
  const bodies = [];
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses", authStore,
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert(bodies.length <= 4, "unexpected continuation loop");
      return response(`response_${bodies.length}`, commands[bodies.length - 1]);
    },
  });
  try {
    const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
    let approvals = 0;
    surface.on("event", (e) => { if (e.type === "rpc-request") approvals += 1; });
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: "Read repair test", model: "gpt-5.6-sol", reasoningEffort: "max", serviceTier: "flex", accessProfile: "full_access",
    }, context);
    const taskId = started.thread.id;
    const prompt = "Read calc.js, repair addition, and run test.js. Preserve the test file.";
    const startedTurn = await controller.handleRequest("turn/start", {
      threadId: taskId, clientTurnRequestId: `read_repair_test_${project.id}`, promptText: prompt,
    }, context);
    const turnId = startedTurn.turn.id;
    await controller.waitForTurnCompletion({ sessionId: taskId, turnId });
    const turn = sessionStore.readTurn(taskId, turnId);
    assert.equal(turn.state, "completed", JSON.stringify(turn.error));
    assert.equal(bodies.length, 4);
    assert.equal(approvals, 0);
    assert.equal(await fs.readFile(path.join(workspace, "calc.js"), "utf8"), expectedSource);
    assert.equal(await fs.readFile(path.join(workspace, "test.js"), "utf8"), testSource);
    assert.equal(spawnSync(process.execPath, ["test.js"], { cwd: workspace, timeout: 5000 }).status, 0);
    const admitted = turn.admittedProviderContext;
    assert.deepEqual(admitted.input, bodies[0].input);
    assert.equal(admitted.instructions, bodies[0].instructions);
    assert(JSON.stringify(admitted.input).includes(prompt));
    assert.equal(turn.toolResults.length, 3);
    assert.equal(new Set(turn.toolResults.map((r) => r.resultId)).size, 3);
    assert.equal(new Set(turn.toolResults.map((r) => r.obligationId)).size, 3);
    for (const body of bodies) {
      assert.equal(body.model, "gpt-5.6-sol");
      assert.equal(body.reasoning.effort, "max");
      assert.equal(body.service_tier, "flex");
      assert.equal(body.store, false);
      assert.equal(body.previous_response_id, undefined);
    }
    for (let i = 0; i < 3; i += 1) {
      const result = turn.toolResults[i];
      const obligation = turn.unresolvedObligations.find((o) => o.obligationId === result.obligationId);
      assert.deepEqual(obligation.result, result);
      assert.equal(obligation.executionAllowed, false);
      const output = JSON.parse(result.providerOutputText);
      assert.equal(output.exitCode, 0);
      assert.equal(output.status, "completed");
      assert.equal(output.taskId, taskId);
      const body = bodies[i + 1];
      assert.deepEqual(body.input.slice(0, admitted.input.length), admitted.input);
      assert(body.instructions.startsWith(admitted.instructions));
      const evidence = obligation.continuationRequest.context.priorToolResults;
      assert.deepEqual(evidence.map((r) => r.resultId), turn.toolResults.slice(0, i + 1).map((r) => r.resultId));
      const quoted = body.input.at(-1).content[0].text;
      assert(quoted.includes(JSON.stringify(evidence)), "exact cumulative result records reach the request");
      assert.equal(evidence.at(-1).providerOutputText, result.providerOutputText);
    }
    assert(JSON.parse(turn.toolResults[0].providerOutputText).stdoutPreview.includes("a - b"));
    assert(JSON.parse(turn.toolResults[1].providerOutputText).stdoutPreview.includes("repair-applied"));
    assert(JSON.parse(turn.toolResults[2].providerOutputText).stdoutPreview.includes("repair-test-passed"));
    const reopened = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
    const persisted = reopened.readTurn(taskId, turnId);
    assert.deepEqual(persisted.toolResults, turn.toolResults);
    assert.deepEqual(persisted.admittedProviderContext, admitted);
    assert.deepEqual(persisted.unresolvedObligations, turn.unresolvedObligations);
    const session = reopened.readSession(taskId);
    const reopenedGrants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
    const grant = reopenedGrants.currentForScope({ taskId, threadId: taskId, projectId: project.id, executionEnvironmentDigest: session.executionEnvironmentDigest });
    assert.equal(grant.grantId, session.harnessGrantId);
    return { threaded, requests: bodies.length, results: turn.toolResults.length };
  } finally {
    controller.close("regression cleanup");
    assert.equal((await manager.dispose("regression cleanup")).status, "completed");
    threadStore?.close();
  }
}

async function pollBoundary(root) {
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "poll-grants") });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => root });
  try {
    const grant = grants.issueFullAccess({ taskId: "poll_task", threadId: "poll_task", projectId: "poll_project", executionEnvironment: { environmentId: "poll_env", kind: "local", bindingDigest: "sha256:poll-env" }, capabilities: ["exec_command", "write_stdin"] });
    const scope = { taskId: "poll_task", threadId: "poll_task", projectId: "poll_project", grantId: grant.grantId, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
    const initial = manager.start({ ...scope, cmd: `${node} -e ${quote("process.stdin.once('data', () => { console.log('poll-complete'); process.exit(0); });")}`, stdinPolicy: "line_input" });
    const input = { ...scope, sessionId: initial.sessionId };
    const poll1 = manager.writeStdin({ ...input, chars: "" });
    const poll2 = manager.writeStdin({ ...input, chars: "" });
    assert.equal(poll1.status, "running");
    assert.equal(poll1.sessionState, initial.sessionState);
    assert.equal(poll1.emptyPoll, true);
    assert.equal(poll1.stdinAccepted, false);
    assert.deepEqual(processObservation(poll2), processObservation(poll1), "empty reads cannot mutate process state");
    manager.writeStdin({ ...input, chars: "finish\n" });
    const ended = await manager.wait(input);
    assert.equal(ended.exitCode, 0);
    const terminal = manager.writeStdin({ ...input, chars: "" });
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.exitCode, 0);
    assert(terminal.stdoutPreview.includes("poll-complete"));
    assert.equal(terminal.emptyPoll, true);
    assert.deepEqual(processObservation(manager.writeStdin({ ...input, chars: "" })), processObservation(terminal));
    assert.throws(() => manager.writeStdin({ ...input, chars: "late" }), { code: "direct_stateful_exec_session_not_live" });
    assert.throws(() => manager.writeStdin({ ...input, eof: true }), { code: "direct_stateful_exec_session_not_live" });
    assert.throws(() => manager.writeStdin({ ...input, taskId: "foreign", chars: "" }), { code: "direct_stateful_exec_scope_mismatch" });
    assert.throws(() => manager.writeStdin({ ...input, sessionId: "unknown", chars: "" }), { code: "direct_stateful_exec_session_missing" });
    grants.revoke(grant.grantId, "fixture revocation");
    assert.throws(() => manager.writeStdin({ ...input, chars: "" }), { code: "direct_stateful_exec_grant_not_current" });
  } finally {
    assert.equal((await manager.dispose("poll cleanup")).status, "completed");
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-continuity-regression-"));
try {
  const routes = [];
  for (const threaded of [false, true]) routes.push(await runRoute(path.join(root, String(threaded)), threaded));
  await pollBoundary(root);
  console.log(JSON.stringify({ ok: true, routes, readRepairTest: true, terminalPollAuthorization: true }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
