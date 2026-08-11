#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectNativeAgentPool,
  normalizeForkTurns,
  selectContextMessages,
} = require("../src/main/direct/agents/native-agent-pool");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

assert.deepEqual(normalizeForkTurns("all"), { mode: "full", recentTurnCount: 0, forkTurns: "all" });
assert.deepEqual(normalizeForkTurns("none"), { mode: "none", recentTurnCount: 0, forkTurns: "none" });
assert.deepEqual(normalizeForkTurns("3"), { mode: "recent", recentTurnCount: 3, forkTurns: "3" });
assert.throws(() => normalizeForkTurns("0"), /fork_turns/);

const history = [
  { turnId: "t1", role: "user", text: "one" },
  { turnId: "t1", role: "assistant", text: "one reply" },
  { turnId: "t2", role: "user", text: "two" },
  { turnId: "t2", role: "assistant", text: "two reply" },
  { turnId: "t3", role: "user", text: "three" },
];
assert.equal(selectContextMessages(history, normalizeForkTurns("none")).length, 0);
assert.equal(selectContextMessages(history, normalizeForkTurns("all")).length, 5);
assert.deepEqual(
  selectContextMessages(history, normalizeForkTurns("2")).map((item) => item.turnId),
  ["t2", "t2", "t3"],
);

const calls = [];
const pending = [];
const pool = new DirectNativeAgentPool({
  maxActiveChildren: 6,
  maxQueuedChildren: 16,
  defaultModel: "gpt-5.6-sol",
  defaultReasoningEffort: "medium",
  providerTurnRunner: async (request) => {
    calls.push(request);
    const gate = deferred();
    pending.push(gate);
    return gate.promise;
  },
});

const launches = Array.from({ length: 10 }, (_, index) => pool.launch({
  projectId: "project_pool_fixture",
  primaryThreadId: "primary_pool_fixture",
  workThreadId: "work_pool_fixture",
  taskName: `child_${index + 1}`,
  message: `bounded task ${index + 1}`,
  parentContextMessages: history,
  forkTurns: index === 0 ? "all" : index === 1 ? "none" : "2",
  model: index === 0 ? "gpt-5.6-terra" : "gpt-5.6-sol",
  reasoningEffort: index === 0 ? "low" : index === 1 ? "ultra" : "high",
}));

assert.equal(pool.descriptor().maxActiveChildren, 6);
assert.equal(pool.descriptor().activeChildren, 6, "pool should allow more than three active child agents");
assert.equal(pool.descriptor().queuedChildren, 4);
assert.equal(launches.filter((row) => row.status === "running").length, 6);
assert.equal(launches.filter((row) => row.status === "queued").length, 4);
assert(launches.every((row) => row.runtimeProfileIndependentOfContext));

await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.length, 6, "only capacity-bound provider turns may start");
assert.equal(calls[0].requestBody.model, "gpt-5.6-terra");
assert.equal(calls[0].requestBody.reasoning.effort, "low");
assert.equal(calls[0].requestShape.contextHandoffMode, "full");
assert.equal(calls[0].requestShape.contextMessageCount, 5);
assert.equal(calls[1].requestBody.model, "gpt-5.6-sol");
assert.equal(calls[1].requestBody.reasoning.effort, "ultra");
assert.equal(calls[1].requestShape.contextHandoffMode, "none");
assert.equal(calls[1].requestShape.contextMessageCount, 0);

assert.equal(pool.inspect({
  projectId: "project_other_fixture",
  primaryThreadId: "primary_pool_fixture",
  childAgentId: launches[0].childAgentId,
}), null, "exact child ids must not bypass project scope");
assert.equal(pool.inspect({
  projectId: "project_pool_fixture",
  primaryThreadId: "primary_other_fixture",
  childAgentId: launches[0].childAgentId,
}), null, "exact child ids must not bypass primary-thread scope");
const crossScopeWait = await pool.wait({
  projectId: "project_other_fixture",
  primaryThreadId: "primary_pool_fixture",
  targets: [launches[0].childAgentId],
  timeoutMs: 0,
});
assert.equal(crossScopeWait.status, "blocked");
assert.equal(crossScopeWait.blockerCode, "target_agent_missing");

const pollStartedAt = Date.now();
const nonBlockingPoll = await pool.wait({
  projectId: "project_pool_fixture",
  primaryThreadId: "primary_pool_fixture",
  targets: [launches[1].childAgentId],
  timeoutMs: 0,
});
assert.equal(nonBlockingPoll.status, "timeout");
assert(Date.now() - pollStartedAt < 250, "zero-millisecond wait should return without blocking");

pending[0].resolve({ ok: true, terminalState: "completed", outputText: "child one done" });
const firstWait = await pool.wait({
  projectId: "project_pool_fixture",
  primaryThreadId: "primary_pool_fixture",
  targets: [launches[0].childAgentId],
  timeoutMs: 2_000,
});
assert.equal(firstWait.status, "completed");
assert.equal(firstWait.updates[0].resultSummary, "child one done");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.length, 7, "releasing a lease should start the next queued child");
assert.equal(pool.descriptor().activeChildren, 6);
assert.equal(pool.descriptor().queuedChildren, 3);

for (const gate of pending) gate.resolve({ ok: true, terminalState: "completed", outputText: "done" });
while (pool.descriptor().activeChildren || pool.descriptor().queuedChildren) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (const gate of pending) gate.resolve({ ok: true, terminalState: "completed", outputText: "done" });
}

const records = pool.records({ projectId: "project_pool_fixture", primaryThreadId: "primary_pool_fixture" });
assert.equal(records.length, 10);
assert(records.every((record) => record.state === "completed"));
assert(records.every((record) => record.rawTaskIncluded === false && record.rawContextIncluded === false));
assert(records.every((record) => record.epistemicCapture.status === "unavailable"));
assert(records.every((record) => record.epistemicCaptureComplete === false));
assert(records.every((record) => record.epistemicCaptureOmission?.schema === "sub_agent_epistemic_capture_omission@1"));
assert(records.every((record) => record.evidenceConfidence === "partial"));
assert.equal(pool.statusSurface({
  projectId: "project_pool_fixture",
  primaryThreadId: "primary_pool_fixture",
}).listAgents().result.listProjection.rowCount, 10);

const capturePool = new DirectNativeAgentPool({
  maxActiveChildren: 1,
  providerTurnRunner: async () => ({
    ok: true,
    terminalState: "completed",
    outputText: "provider completed while capture failed",
    epistemicCapture: {
      status: "failed",
      errorCode: "fixture_capture_failed",
      receiptDigest: "",
      sessionId: "",
      turnId: "",
    },
  }),
});
const captureLaunch = capturePool.launch({
  projectId: "project_capture_fixture",
  primaryThreadId: "primary_capture_fixture",
  taskName: "capture_failure",
  message: "capture failure propagation",
});
const captureWait = await capturePool.wait({
  projectId: "project_capture_fixture",
  primaryThreadId: "primary_capture_fixture",
  target: captureLaunch.childAgentId,
  timeoutMs: 2_000,
});
const captureRecord = captureWait.updates[0];
assert.equal(captureRecord.state, "completed", "capture failure must not rewrite provider completion");
assert.equal(captureRecord.epistemicCapture.status, "failed");
assert.equal(captureRecord.epistemicCapture.errorCode, "fixture_capture_failed");
assert.equal(captureRecord.epistemicCaptureComplete, false);
assert.equal(captureRecord.epistemicCaptureOmission.code, "fixture_capture_failed");
assert.equal(captureRecord.evidenceConfidence, "partial");

const unsafeWorkspacePool = new DirectNativeAgentPool({
  maxActiveChildren: 1,
  workspaceWorkerRunner: async () => ({
    status: "completed",
    outputText: "unsafe projection fixture",
    workspaceExecution: {
      schema: "direct_workspace_worker_execution@1",
      status: "completed",
      workspaceMode: "isolated_worktree",
      toolProfile: "read_only_worker",
      nativeRoot: "/private/worktree/path",
      rawWorkspacePathIncluded: false,
    },
  }),
});
const unsafeWorkspaceLaunch = unsafeWorkspacePool.launch({
  projectId: "project_unsafe_workspace_fixture",
  primaryThreadId: "primary_unsafe_workspace_fixture",
  taskName: "unsafe_workspace_projection",
  message: "projection must fail closed",
  workspaceMode: "isolated_worktree",
  toolProfile: "read_only_worker",
  project: { id: "project_unsafe_workspace_fixture" },
});
const unsafeWorkspaceWait = await unsafeWorkspacePool.wait({
  projectId: "project_unsafe_workspace_fixture",
  primaryThreadId: "primary_unsafe_workspace_fixture",
  target: unsafeWorkspaceLaunch.childAgentId,
  timeoutMs: 2_000,
});
const unsafeWorkspaceRecord = unsafeWorkspaceWait.updates[0];
assert.equal(unsafeWorkspaceRecord.state, "failed");
assert.equal(
  unsafeWorkspaceRecord.blockerCode,
  "direct_workspace_worker_execution_private_realization_present",
);
assert.equal(JSON.stringify(unsafeWorkspaceRecord).includes("/private/worktree/path"), false);

const closeCalls = [];
const closePool = new DirectNativeAgentPool({
  maxActiveChildren: 1,
  maxQueuedChildren: 4,
  providerTurnRunner: ({ signal }) => new Promise((_resolve, reject) => {
    closeCalls.push({ signal });
    signal.addEventListener("abort", () => {
      const error = new Error("closed fixture provider turn");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }),
});
const runningAtClose = closePool.launch({
  projectId: "project_close_fixture",
  primaryThreadId: "primary_close_fixture",
  taskName: "running_at_close",
  message: "running child",
});
const queuedAtClose = closePool.launch({
  projectId: "project_close_fixture",
  primaryThreadId: "primary_close_fixture",
  taskName: "queued_at_close",
  message: "queued child",
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(closeCalls.length, 1, "only the active child may reach the provider before close");
const runningWait = closePool.wait({
  projectId: "project_close_fixture",
  primaryThreadId: "primary_close_fixture",
  target: runningAtClose.childAgentId,
  timeoutMs: 2_000,
});
const queuedWait = closePool.wait({
  projectId: "project_close_fixture",
  primaryThreadId: "primary_close_fixture",
  target: queuedAtClose.childAgentId,
  timeoutMs: 2_000,
});
const closedDescriptor = closePool.close({ reasonCode: "fixture_runtime_closed" });
assert.equal(closedDescriptor.closed, true);
assert.equal(closedDescriptor.acceptingNewChildren, false);
assert.equal(closedDescriptor.activeChildren, 0);
assert.equal(closedDescriptor.queuedChildren, 0);
assert.equal(closeCalls[0].signal.aborted, true, "pool close must abort the running provider contract");
const [closedRunning, closedQueued] = await Promise.all([runningWait, queuedWait]);
assert.equal(closedRunning.updates[0].state, "cancelled");
assert.equal(closedRunning.updates[0].blockerCode, "fixture_runtime_closed");
assert.equal(closedQueued.updates[0].state, "cancelled");
assert.equal(closedQueued.updates[0].blockerCode, "fixture_runtime_closed");
await new Promise((resolve) => setImmediate(resolve));
closePool.drain();
assert.equal(closeCalls.length, 1, "close must prevent queued children from draining into the provider");
const postCloseLaunch = closePool.launch({ message: "must not launch" });
assert.equal(postCloseLaunch.status, "blocked");
assert.equal(postCloseLaunch.blockerCode, "direct_agent_pool_closed");
assert.equal(closePool.close().closed, true, "pool close must be idempotent");

console.log(JSON.stringify({
  ok: true,
  maxActiveChildren: pool.descriptor().maxActiveChildren,
  providerCalls: calls.length,
  completedChildren: records.length,
  independentFullHistoryProfile: {
    model: calls[0].requestBody.model,
    reasoningEffort: calls[0].requestBody.reasoning.effort,
    contextHandoffMode: calls[0].requestShape.contextHandoffMode,
  },
}, null, 2));
