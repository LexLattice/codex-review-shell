#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const {
  WorkspaceWorkerLifecycleRegistry,
  normalizeBinding,
} = require("../src/main/direct/agents/workspace-worker-lifecycle-registry");
const {
  assertWorkspaceWorkerCleanupPlanSafe,
  buildWorkspaceWorkerCleanupReceipt,
  buildWorkspaceWorkerCleanupPlan,
} = require("../src/main/direct/agents/workspace-worker-cleanup");
const {
  buildWorkspaceWorkerShutdownPlan,
  runWorkspaceWorkerShutdown,
} = require("../src/main/direct/agents/workspace-worker-shutdown");
const { NdjsonTransport, WorkspaceBackendManager } = require("../src/main/workspace-backend");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-lifecycle-"));
try {
  const dbPath = path.join(temporaryRoot, "worker-lifecycle.sqlite");
  let registry = new WorkspaceWorkerLifecycleRegistry({ dbPath });
  const opened = registry.openSession({
    sessionId: "session_fixture",
    leaseId: "lease_fixture",
    childAgentId: "child_fixture",
    projectId: "project_fixture",
    workThreadId: "work_fixture",
    primaryThreadId: "primary_fixture",
    toolProfile: "implementation_worker",
    operationId: "open_fixture",
  });
  assert.equal(opened.state, "registered");
  assert.equal(opened.leaseState, "reserved");
  assert.throws(
    () => registry.openSession({
      sessionId: "session_operation_conflict",
      leaseId: "lease_operation_conflict",
      childAgentId: "child_operation_conflict",
      projectId: "project_operation_conflict",
      operationId: "open_fixture",
    }),
    /direct_workspace_worker_operation_id_conflict/,
    "an operation ID cannot replay another session's registration",
  );

  const binding = normalizeBinding({
    workerKey: "worker_fixture",
    branchName: "codex/worker/fixture",
    baseCommit: "a".repeat(40),
    headCommit: "a".repeat(40),
    worktreePathDigest: `sha256:${"b".repeat(64)}`,
    sourceRepositoryDigest: `sha256:${"c".repeat(64)}`,
  });
  const bound = registry.bindWorkspace(opened.sessionId, {
    binding,
    operationId: "bind_fixture",
  });
  assert.equal(bound.binding.bindingDigest, binding.bindingDigest);
  const active = registry.activateLease(opened.sessionId, { operationId: "activate_fixture" });
  assert.equal(active.state, "active");
  assert.equal(active.leaseState, "active");
  assert.equal(active.processState, "running");

  const cancelling = registry.requestCancellation(opened.sessionId, {
    operationId: "cancel_fixture",
    reasonCode: "fixture_cancelled",
  });
  assert.equal(cancelling.state, "cancelling");
  assert.equal(cancelling.leaseState, "active", "cancellation must retain the lease");
  assert.equal(cancelling.cancellation.acknowledged, false);
  registry.close();

  registry = new WorkspaceWorkerLifecycleRegistry({ dbPath });
  assert.equal(registry.session(opened.sessionId).state, "cancelling", "cancellation survives restart");
  const recovery = registry.recoverySnapshot();
  assert.equal(recovery.status, "reconciliation_required");
  assert.equal(recovery.candidates[0].automaticReplayAllowed, false);
  assert.equal(recovery.candidates[0].automaticCleanupAllowed, false);
  const cancelled = registry.acknowledgeCancellation(opened.sessionId, {
    operationId: "cancel_ack_fixture",
    reasonCode: "fixture_cancelled",
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.leaseState, "released");
  assert.equal(cancelled.processState, "quiescent");
  const duplicateAck = registry.acknowledgeCancellation(opened.sessionId, {
    operationId: "cancel_ack_fixture",
    reasonCode: "fixture_cancelled",
  });
  assert.equal(duplicateAck.sessionDigest, cancelled.sessionDigest, "settlement operation is idempotent");
  assert.equal(registry.events(opened.sessionId).length, 5);

  const observation = {
    observationComplete: true,
    observationDigest: `sha256:${"d".repeat(64)}`,
    workerKey: binding.workerKey,
    branchName: binding.branchName,
    bindingDigest: binding.bindingDigest,
    worktreePathDigest: binding.worktreePathDigest,
    worktreeRegistered: true,
    processQuiescent: true,
    activeProcessCount: 0,
    gitStatusReadSucceeded: true,
    statusEntries: [],
    untrackedFileCount: 0,
    headReadSucceeded: true,
    headCommit: binding.headCommit,
    uniqueWorkReadSucceeded: true,
    uniqueCommitCount: 0,
    conflictState: false,
    gitOperationInProgress: false,
  };
  const cleanupPlan = buildWorkspaceWorkerCleanupPlan({ session: cancelled, observation });
  assertWorkspaceWorkerCleanupPlanSafe(cleanupPlan);
  assert.equal(cleanupPlan.canRemove, true);
  assert.equal(cleanupPlan.dryRun, true);
  assert.equal(cleanupPlan.forceRemovalAllowed, false);
  const missingStatusPlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: { ...observation, statusEntries: undefined },
  });
  assert.equal(missingStatusPlan.canRemove, false);
  assert(missingStatusPlan.blockerCodes.includes("cleanup_git_status_entries_invalid"));
  const missingUntrackedPlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: { ...observation, untrackedFileCount: undefined },
  });
  assert.equal(missingUntrackedPlan.canRemove, false);
  assert(missingUntrackedPlan.blockerCodes.includes("cleanup_untracked_work_present"));
  const malformedUntrackedPlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: { ...observation, untrackedFileCount: "0" },
  });
  assert.equal(malformedUntrackedPlan.canRemove, false);
  const foreignPlan = buildWorkspaceWorkerCleanupPlan({
    session: { ...cancelled, sessionId: "session_other" },
    observation,
  });
  assertWorkspaceWorkerCleanupPlanSafe(foreignPlan);
  assert.throws(
    () => registry.markCleanupEligible(opened.sessionId, {
      operationId: "wrong_session_cleanup_fixture",
      plan: foreignPlan,
    }),
    /direct_workspace_worker_cleanup_plan_binding_mismatch/,
  );
  const mutateSession = registry.mutateSession.bind(registry);
  let injectedCleanupRace = false;
  registry.mutateSession = (sessionId, mutation) => {
    if (mutation.eventKind === "cleanup_eligible" && !injectedCleanupRace) {
      injectedCleanupRace = true;
      mutateSession(sessionId, {
        ...mutation,
        operationId: "cleanup_eligible_competing_fixture",
      });
    }
    return mutateSession(sessionId, mutation);
  };
  assert.throws(
    () => registry.markCleanupEligible(opened.sessionId, {
      operationId: "cleanup_eligible_fixture",
      plan: cleanupPlan,
    }),
    /direct_workspace_worker_session_revision_conflict/,
    "cleanup eligibility must reject a plan raced by another registry writer",
  );
  registry.mutateSession = mutateSession;
  const eligible = registry.session(opened.sessionId);
  assert.equal(eligible.state, "cleanup_eligible");

  const dirtyPlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: { ...observation, statusEntries: [" M protected.js"] },
  });
  assert.equal(dirtyPlan.canRemove, false);
  assert(dirtyPlan.blockerCodes.includes("cleanup_worktree_dirty"));
  assert.throws(
    () => registry.markCleanupEligible(opened.sessionId, {
      operationId: "unsafe_cleanup_fixture",
      plan: dirtyPlan,
    }),
    /direct_workspace_worker_cleanup_plan_not_safe/,
  );
  assert.throws(
    () => registry.markCleaned(opened.sessionId, {
      operationId: "legacy_cleaned_fixture",
      planDigest: cleanupPlan.planDigest,
      receiptDigest: `sha256:${"e".repeat(64)}`,
      removed: true,
      forced: false,
    }),
    /direct_workspace_worker_cleanup_receipt_unsafe/,
    "an unbound receipt digest cannot mark a workspace cleaned",
  );
  const cleanupReceipt = buildWorkspaceWorkerCleanupReceipt({
    sessionId: eligible.sessionId,
    sessionRevision: eligible.revision,
    bindingDigest: eligible.binding.bindingDigest,
    planDigest: cleanupPlan.planDigest,
    removed: true,
    forced: false,
    removalMode: "non_force",
    outcome: "removed",
  });
  assert.throws(
    () => registry.markCleaned(opened.sessionId, {
      operationId: "foreign_receipt_cleaned_fixture",
      receipt: buildWorkspaceWorkerCleanupReceipt({
        ...cleanupReceipt,
        bindingDigest: "sha256:foreign",
        receiptId: "foreign_cleanup_receipt",
      }),
    }),
    /direct_workspace_worker_cleanup_plan_digest_mismatch/,
  );
  const cleaned = registry.markCleaned(opened.sessionId, {
    operationId: "cleaned_fixture",
    receipt: cleanupReceipt,
  });
  assert.equal(cleaned.state, "cleaned");
  assert.equal(cleaned.cleanupReceipt.receiptDigest, cleanupReceipt.receiptDigest);
  const durableEventCount = registry.events(opened.sessionId).length;
  registry.close();

  const poolRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const runnerCalls = [];
  const runnerGates = [];
  const pool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    maxQueuedChildren: 2,
    workspaceWorkerLifecycleRegistry: poolRegistry,
    workspaceWorkerRunner: async ({ signal, childAgentId }) => {
      const gate = deferred();
      runnerCalls.push({ signal, childAgentId });
      runnerGates.push(gate);
      return gate.promise;
    },
  });
  const first = pool.launch({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    workThreadId: "work_pool_lifecycle",
    taskName: "first_worker",
    message: "first",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_pool_lifecycle" },
  });
  const second = pool.launch({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    workThreadId: "work_pool_lifecycle",
    taskName: "second_worker",
    message: "second",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_pool_lifecycle" },
  });
  await tick();
  assert.equal(runnerCalls.length, 1);
  const firstLifecycleBinding = normalizeBinding({
    workerKey: "first_worker",
    branchName: "codex/worker/first-worker",
    baseCommit: "1".repeat(40),
    headCommit: "1".repeat(40),
    worktreePathDigest: `sha256:${"2".repeat(64)}`,
    sourceRepositoryDigest: `sha256:${"3".repeat(64)}`,
  });
  pool.bindWorkspaceForChild(first.childAgentId, { binding: firstLifecycleBinding });
  assert.equal(
    pool.inspect({ target: first.childAgentId }).workspaceLifecycle.bindingDigest,
    firstLifecycleBinding.bindingDigest,
    "validated private binding evidence is reflected through the safe pool lifecycle projection",
  );
  const interruption = pool.interrupt({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    target: first.childAgentId,
    reasonCode: "fixture_interrupt",
  });
  assert.equal(interruption.status, "cancelling");
  assert.equal(interruption.record.state, "cancelling");
  assert.equal(interruption.record.cancellation.leaseActive, true);
  assert.equal(pool.descriptor().activeChildren, 1);
  assert.equal(pool.descriptor().queuedChildren, 1);
  assert.equal(runnerCalls[0].signal.aborted, true);
  const stillPending = await pool.wait({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    target: first.childAgentId,
    timeoutMs: 0,
  });
  assert.equal(stillPending.status, "timeout", "cancel request is not terminal before runner acknowledgement");
  runnerGates[0].resolve({
    status: "cancelled",
    blockerCode: "fixture_interrupt",
    cancellationAcknowledged: true,
    backendQuiesced: true,
    cancellationReceipt: { acknowledged: true, quiesced: true },
  });
  const firstDone = await pool.wait({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    target: first.childAgentId,
    timeoutMs: 2_000,
  });
  assert.equal(firstDone.updates[0].state, "cancelled");
  assert.equal(firstDone.updates[0].cancellation.acknowledged, true);
  assert.equal(firstDone.updates[0].cancellation.leaseActive, false);
  await tick();
  assert.equal(runnerCalls.length, 2, "queued worker starts only after cancellation acknowledgement");
  runnerGates[1].resolve({ status: "completed", outputText: "second complete" });
  const secondDone = await pool.wait({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    target: second.childAgentId,
    timeoutMs: 2_000,
  });
  assert.equal(secondDone.updates[0].state, "completed");
  assert.equal(pool.settleRecord(pool.resolveTarget(second.childAgentId), { state: "failed" }), false);
  assert.equal(poolRegistry.sessionForChild(second.childAgentId).state, "completed");

  const closeAck = deferred();
  const closePool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    providerTurnRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      await closeAck.promise;
      const error = new Error("provider cancellation acknowledged");
      error.name = "AbortError";
      throw error;
    },
  });
  closePool.launch({
    projectId: "project_close_ack",
    primaryThreadId: "primary_close_ack",
    taskName: "close_ack",
    message: "wait for exact acknowledgement",
  });
  await tick();
  const intakeStopped = closePool.stopAccepting({ reasonCode: "fixture_shutdown" });
  assert.equal(intakeStopped.acceptingNewChildren, false);
  assert.equal(intakeStopped.cancellationRequestedAll, false);
  assert.equal(intakeStopped.activeChildren, 1);
  const drainPromise = closePool.drainAndClose({ reasonCode: "fixture_shutdown", timeoutMs: 2_000 });
  assert.equal(closePool.descriptor().activeChildren, 1);
  assert.equal(closePool.descriptor().cancellingChildren, 1);
  closeAck.resolve();
  const drained = await drainPromise;
  assert.equal(drained.status, "drained");
  assert.equal(drained.pool.activeChildren, 0);

  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.stdin = new PassThrough();
      this.exitCode = null;
      this.signalCode = null;
    }

    kill(signal) {
      this.signalCode = signal;
      this.emit("exit", null, signal);
      return true;
    }
  }

  const fakeChild = new FakeChild();
  const transport = new NdjsonTransport(fakeChild);
  const writes = [];
  let writeBuffer = "";
  fakeChild.stdin.setEncoding("utf8");
  fakeChild.stdin.on("data", (chunk) => {
    writeBuffer += chunk;
    let newline = writeBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = writeBuffer.slice(0, newline).trim();
      writeBuffer = writeBuffer.slice(newline + 1);
      if (line) writes.push(JSON.parse(line));
      newline = writeBuffer.indexOf("\n");
    }
  });
  const controller = new AbortController();
  const backendPromise = transport.request(
    "runDirectWorkspaceWorkerTest",
    { target: "fixture" },
    2_000,
    { signal: controller.signal },
  );
  await tick();
  assert.equal(writes.length, 1);
  controller.abort("fixture_backend_cancel");
  await tick();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].method, "cancelRequest");
  assert.equal(writes[1].params.requestId, writes[0].id);
  let backendSettled = false;
  backendPromise.finally(() => { backendSettled = true; }).catch(() => {});
  await tick();
  assert.equal(backendSettled, false, "transport waits for backend quiescence acknowledgement");
  fakeChild.stdout.write(`${JSON.stringify({
    id: writes[1].id,
    result: {
      targetRequestId: writes[0].id,
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "fixture_process_exit",
    },
  })}\n`);
  await assert.rejects(backendPromise, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.backendQuiesced, true);
    assert.equal(error.cancellationAcknowledged, true);
    return true;
  });
  assert.equal(transport.pendingRequestCount(), 0);

  const timeoutWriteStart = writes.length;
  const timeoutPromise = transport.request(
    "runDirectWorkspaceWorkerTest",
    { target: "ordinary_timeout" },
    30,
  );
  await assert.rejects(timeoutPromise, (error) => {
    assert.equal(error.code, "workspace_backend_request_timeout");
    assert.equal(error.backendQuiesced, false);
    return true;
  });
  await tick();
  assert.equal(writes.length, timeoutWriteStart + 2, "a timed-out request must issue backend cancellation");
  assert.equal(writes[timeoutWriteStart + 1].method, "cancelRequest");
  assert.equal(transport.pendingRequestCount(), 1, "an unquiesced timeout remains in drain accounting");
  assert.equal((await transport.waitForDrain({ timeoutMs: 0 })).status, "timeout");
  fakeChild.stdout.write(`${JSON.stringify({
    id: writes[timeoutWriteStart + 1].id,
    result: {
      targetRequestId: writes[timeoutWriteStart].id,
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "fixture_timeout_process_exit",
    },
  })}\n`);
  await tick();
  assert.equal(transport.pendingRequestCount(), 0);
  assert.equal((await transport.waitForDrain({ timeoutMs: 0 })).status, "drained");

  const unacknowledgedController = new AbortController();
  const unacknowledgedPromise = transport.request(
    "runDirectWorkspaceWorkerTest",
    { target: "unacknowledged" },
    30,
    { signal: unacknowledgedController.signal },
  );
  await tick();
  unacknowledgedController.abort("fixture_backend_cancel_unacknowledged");
  await assert.rejects(unacknowledgedPromise, (error) => {
    assert.equal(error.code, "workspace_backend_cancel_unacknowledged");
    assert.equal(error.backendQuiesced, false);
    assert.equal(error.cancellationAcknowledged, false);
    return true;
  });
  assert.equal(transport.pendingRequestCount(), 1);
  assert.equal((await transport.waitForDrain({ timeoutMs: 0 })).status, "timeout");
  transport.dispose();

  const unacknowledgedPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      const error = new Error("backend did not acknowledge process quiescence");
      error.code = "workspace_backend_cancel_unacknowledged";
      error.backendQuiesced = false;
      throw error;
    },
  });
  const unacknowledgedLaunch = unacknowledgedPool.launch({
    projectId: "project_unacknowledged",
    primaryThreadId: "primary_unacknowledged",
    taskName: "unacknowledged_worker",
    message: "retain lease",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_unacknowledged" },
  });
  await tick();
  unacknowledgedPool.interrupt({
    projectId: "project_unacknowledged",
    primaryThreadId: "primary_unacknowledged",
    target: unacknowledgedLaunch.childAgentId,
  });
  await tick();
  const unacknowledgedRecord = unacknowledgedPool.inspect({
    projectId: "project_unacknowledged",
    primaryThreadId: "primary_unacknowledged",
    target: unacknowledgedLaunch.childAgentId,
  });
  assert.equal(unacknowledgedRecord.state, "cancellation_unacknowledged");
  assert.equal(unacknowledgedRecord.cancellation.leaseActive, true);
  assert.equal(unacknowledgedPool.descriptor().activeChildren, 1);
  assert.equal(unacknowledgedPool.descriptor().cancellationUnacknowledgedChildren, 1);
  const unacknowledgedDrain = await unacknowledgedPool.drainAndClose({ timeoutMs: 10 });
  assert.equal(unacknowledgedDrain.status, "timeout", "unacknowledged cancellation must block shutdown drain");

  const missingAcknowledgementGate = deferred();
  const missingAcknowledgementPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async () => missingAcknowledgementGate.promise,
  });
  const missingAcknowledgementLaunch = missingAcknowledgementPool.launch({
    projectId: "project_missing_acknowledgement",
    primaryThreadId: "primary_missing_acknowledgement",
    taskName: "missing_acknowledgement_worker",
    message: "do not release capacity without a positive receipt",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_missing_acknowledgement" },
  });
  await tick();
  missingAcknowledgementPool.interrupt({ target: missingAcknowledgementLaunch.childAgentId });
  missingAcknowledgementGate.resolve({ status: "cancelled", blockerCode: "runner_returned_without_receipt" });
  await tick();
  const missingAcknowledgementRecord = missingAcknowledgementPool.inspect({
    target: missingAcknowledgementLaunch.childAgentId,
  });
  assert.equal(missingAcknowledgementRecord.state, "cancellation_unacknowledged");
  assert.equal(missingAcknowledgementRecord.cancellation.leaseActive, true);
  assert.equal(missingAcknowledgementPool.descriptor().activeChildren, 1);

  const settlementRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const settlementGate = deferred();
  const settlementPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: settlementRegistry,
    workspaceWorkerRunner: async () => settlementGate.promise,
  });
  const settlementLaunch = settlementPool.launch({
    projectId: "project_settlement_failure",
    primaryThreadId: "primary_settlement_failure",
    taskName: "settlement_failure_worker",
    message: "retain the lease across a registry read failure",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_settlement_failure" },
  });
  await tick();
  const readSettlementSession = settlementRegistry.session.bind(settlementRegistry);
  settlementRegistry.session = () => {
    const error = new Error("fixture registry read failed");
    error.code = "fixture_registry_read_failed";
    throw error;
  };
  settlementGate.resolve({ status: "completed", resultDigest: "sha256:settlement_fixture" });
  await tick();
  const blockedSettlement = settlementPool.inspect({ target: settlementLaunch.childAgentId });
  assert.equal(blockedSettlement.state, "settlement_blocked");
  assert.equal(blockedSettlement.lifecycleErrorCode, "fixture_registry_read_failed");
  assert.equal(blockedSettlement.cancellation.leaseActive, true);
  settlementRegistry.session = readSettlementSession;
  assert.equal(settlementPool.retrySettlement({ target: settlementLaunch.childAgentId }), true);
  assert.equal(settlementPool.inspect({ target: settlementLaunch.childAgentId }).state, "completed");
  settlementRegistry.close();

  const shutdownPlan = buildWorkspaceWorkerShutdownPlan({ reasonCode: "fixture_shutdown" });
  assert.deepEqual(shutdownPlan.steps.map((step) => step.action), [
    "stop_worker_intake",
    "request_child_cancellation",
    "await_child_and_provider_acknowledgement",
    "drain_workspace_backend_requests",
    "dispose_workspace_backends",
    "close_lifecycle_registry",
  ]);
  const order = [];
  const shutdown = await runWorkspaceWorkerShutdown({
    reasonCode: "fixture_shutdown",
    stopWorkerIntake: async () => order.push("stop"),
    requestChildCancellation: async () => order.push("cancel"),
    awaitChildAcknowledgement: async () => { order.push("child_ack"); return { status: "drained" }; },
    drainWorkspaceBackends: async () => { order.push("backend_drain"); return { status: "drained" }; },
    disposeWorkspaceBackends: async () => order.push("backend_dispose"),
    closeLifecycleRegistry: async () => order.push("registry_close"),
  });
  assert.equal(shutdown.status, "completed");
  assert.deepEqual(order, ["stop", "cancel", "child_ack", "backend_drain", "backend_dispose", "registry_close"]);

  let unsafeDisposalStarted = false;
  const blockedShutdown = await runWorkspaceWorkerShutdown({
    stopWorkerIntake: async () => {},
    requestChildCancellation: async () => {},
    awaitChildAcknowledgement: async () => ({ status: "timeout" }),
    drainWorkspaceBackends: async () => ({ status: "drained" }),
    disposeWorkspaceBackends: async () => { unsafeDisposalStarted = true; },
    closeLifecycleRegistry: async () => {},
  });
  assert.equal(blockedShutdown.status, "blocked");
  assert.equal(unsafeDisposalStarted, false, "backends stay alive until child acknowledgement");

  const liveBackendRoot = path.join(temporaryRoot, "live-backend");
  fs.mkdirSync(liveBackendRoot, { recursive: true });
  const lateMarkerPath = path.join(liveBackendRoot, "late-marker.txt");
  fs.writeFileSync(path.join(liveBackendRoot, "package.json"), JSON.stringify({
    name: "direct-worker-live-cancellation-fixture",
    private: true,
    scripts: { test: "node long-test.js" },
  }, null, 2));
  fs.writeFileSync(path.join(liveBackendRoot, "long-test.js"), [
    'const fs = require("node:fs");',
    `setTimeout(() => fs.writeFileSync(${JSON.stringify(lateMarkerPath)}, "escaped"), 5000);`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const liveManager = new WorkspaceBackendManager({
    agentPath: path.resolve("src/backend/wsl-agent.js"),
    fallbackRoot: liveBackendRoot,
  });
  const liveProject = {
    id: "project_live_backend_cancellation",
    repoPath: liveBackendRoot,
    workspace: { kind: "local", localPath: liveBackendRoot },
  };
  const liveSession = await liveManager.ensureForProject(liveProject, { workspaceHygiene: false });
  const liveProfile = await liveSession.request("directTestProfile", {}, 5_000);
  const liveRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const livePool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: liveRegistry,
    workspaceWorkerRunner: async ({ signal }) => {
      try {
        await liveSession.request("runDirectTest", {
          profileDigest: liveProfile.profileDigest,
          timeoutMs: 30_000,
        }, 35_000, { signal });
        return { status: "completed" };
      } catch (error) {
        return {
          status: "cancelled",
          blockerCode: error.code,
          cancellationAcknowledged: error.cancellationAcknowledged === true,
          backendQuiesced: error.backendQuiesced === true,
          cancellationReceipt: error.cancellationReceipt,
        };
      }
    },
  });
  const liveLaunch = livePool.launch({
    childAgentId: "child_live_backend_cancellation",
    projectId: liveProject.id,
    primaryThreadId: "primary_live_backend_cancellation",
    taskName: "live_backend_cancellation",
    message: "run until cancelled",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    project: liveProject,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  livePool.interrupt({ target: liveLaunch.childAgentId, reasonCode: "fixture_live_cancel" });
  const liveDone = await livePool.wait({ target: liveLaunch.childAgentId, timeoutMs: 5_000 });
  assert.equal(liveDone.updates[0].state, "cancelled");
  assert.equal(liveDone.updates[0].cancellation.acknowledged, true);
  assert.equal(liveDone.updates[0].cancellation.leaseActive, false);
  assert.equal(livePool.descriptor().activeChildren, 0, "capacity releases only after exact backend quiescence");
  await assert.rejects(
    liveSession.request("cancelRequest", { requestId: "forged_request_id" }, 2_000),
    (error) => error.code === "workspace_backend_cancel_target_unavailable",
    "an absent or forged request ID cannot receive a quiescence acknowledgement",
  );
  const liveShutdownOrder = [];
  const liveShutdown = await runWorkspaceWorkerShutdown({
    reasonCode: "fixture_live_shutdown",
    stopWorkerIntake: () => { liveShutdownOrder.push("stop"); return livePool.stopAccepting(); },
    requestChildCancellation: () => { liveShutdownOrder.push("cancel"); return livePool.requestCancellationForAll(); },
    awaitChildAcknowledgement: async () => {
      liveShutdownOrder.push("child_ack");
      return livePool.drainAndClose({ timeoutMs: 1_000 });
    },
    drainWorkspaceBackends: async () => {
      liveShutdownOrder.push("backend_drain");
      return liveManager.drainAll({ timeoutMs: 1_000 });
    },
    disposeWorkspaceBackends: () => { liveShutdownOrder.push("backend_dispose"); liveManager.disposeAll(); },
    closeLifecycleRegistry: () => { liveShutdownOrder.push("registry_close"); liveRegistry.close(); },
  });
  assert.equal(liveShutdown.status, "completed");
  assert.deepEqual(liveShutdownOrder, [
    "stop",
    "cancel",
    "child_ack",
    "backend_drain",
    "backend_dispose",
    "registry_close",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(fs.existsSync(lateMarkerPath), false, "the cancelled process group cannot escape and finish later");

  const mainSource = fs.readFileSync(path.resolve("src/main.js"), "utf8");
  assert.match(mainSource, /workspaceWorkerLifecycleRegistry: ensureWorkspaceWorkerLifecycleRegistry\(\)/);
  assert.match(mainSource, /installOrderedWorkspaceWorkerWindowClose\(mainWindow,/);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf("async function provisionDirectWorkspaceWorker"), mainSource.indexOf("function tokenUsageFromWorkspaceWorkerCapture")),
    /removeGitWorktree/,
    "failed or cancelled provisioning retains the worktree for inspection",
  );

  console.log(JSON.stringify({
    ok: true,
    durableEvents: durableEventCount,
    exactCancellationLeaseHeld: true,
    positiveCancellationReceiptRequired: true,
    backendCancellationAcknowledged: true,
    unquiescedTimeoutBlocksDrain: true,
    cleanupDryRunSafe: cleanupPlan.canRemove,
    cleanupReceiptDigestBound: true,
    operationIdentityBound: true,
    settlementFailureRetryable: true,
    shutdownOrder: order,
    liveBackendCancellationQuiesced: true,
    liveCapacityReleasedAfterAcknowledgement: true,
    liveOrderedShutdown: liveShutdownOrder,
    failedWorktreeRetentionWired: true,
  }, null, 2));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
