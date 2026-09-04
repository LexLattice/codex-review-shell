#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const {
  WORKSPACE_WORKER_TOOLS,
  createWorkspaceParentAuthorityPacket,
  genericWorkspaceRepositoryProfile,
} = require("../src/main/direct/agents/workspace-worker-policy-profile");
const {
  admittedWorkspaceWorkerCancellationReceipt,
  projectAdmittedWorkspaceWorkerResult,
  runDirectWorkspaceWorker,
} = require("../src/main/direct/agents/workspace-worker-runtime");
const {
  safeWorkspaceExecutionProjection,
} = require("../src/main/direct/agents/workspace-worker-contract");
const {
  WorkspaceWorkerLifecycleRegistry,
  buildWorkspaceWorkerReconciliationReceipt,
  normalizeBinding,
} = require("../src/main/direct/agents/workspace-worker-lifecycle-registry");
const {
  assertWorkspaceWorkerCleanupPlanSafe,
  buildWorkspaceWorkerCleanupObservation,
  buildWorkspaceWorkerCleanupReceipt,
  buildWorkspaceWorkerCleanupPlan,
} = require("../src/main/direct/agents/workspace-worker-cleanup");
const {
  buildWorkspaceWorkerShutdownPlan,
  runWorkspaceWorkerShutdown,
} = require("../src/main/direct/agents/workspace-worker-shutdown");
const {
  NdjsonTransport,
  WorkspaceBackendManager,
  publicBackendErrorCode,
  workspaceAttachFailureCode,
  workspaceBackendRecovery,
} = require("../src/main/workspace-backend");
const { terminateWorkspaceProcessTree } = require("../src/backend/workspace-process-tree");

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

function toolWaitingEvents(responseId, toolName, args) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    {
      type: "tool_call_started",
      sequence: 1,
      responseId,
      itemId: `${responseId}_item`,
      callId: `${responseId}_call`,
      name: toolName,
      toolType: "function_call",
    },
    {
      type: "tool_call_completed",
      sequence: 2,
      responseId,
      itemId: `${responseId}_item`,
      callId: `${responseId}_call`,
      name: toolName,
      toolType: "function_call",
      argumentsJson: JSON.stringify(args),
    },
    { type: "response_completed", sequence: 3, responseId, stopReason: "completed" },
  ];
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function mutationOutcome(input) {
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId: input.requestId,
    method: input.method,
    commitKind: input.commitKind,
    committed: input.committed === true,
    ...(input.committed === true ? {} : {
      indeterminate: true,
      partialMutationPossible: true,
    }),
    retainedForInspection: input.retainedForInspection === true,
    ...(input.committed === true
      ? { resultDigest: input.resultDigest }
      : { failureCode: input.failureCode }),
    rawPathIncluded: false,
  };
  return {
    ...base,
    outcomeDigest: `sha256:${crypto.createHash("sha256").update(stableStringify(base)).digest("hex")}`,
  };
}

function committedMutationResult(result, input) {
  return {
    ...result,
    requestOutcome: mutationOutcome({
      ...input,
      committed: true,
      resultDigest: `sha256:${crypto.createHash("sha256").update(stableStringify(result)).digest("hex")}`,
    }),
  };
}

function cancellationReceipt(input = {}) {
  const base = {
    schema: "direct_workspace_worker_cancellation_receipt@1",
    targetRequestId: String(input.targetRequestId || ""),
    launchDigest: String(input.launchDigest || ""),
    lifecycleSessionId: String(input.lifecycleSessionId || ""),
    lifecycleLeaseId: String(input.lifecycleLeaseId || ""),
    reasonCode: String(input.reasonCode || ""),
    acknowledged: true,
    quiesced: true,
    acknowledgementKind: String(input.acknowledgementKind || "request_execution_quiesced"),
    outcomeDigest: String(input.mutationOutcome?.outcomeDigest || ""),
    rawProcessDetailsIncluded: false,
  };
  return {
    ...base,
    receiptDigest: `sha256:${crypto.createHash("sha256")
      .update(`direct-workspace-worker-cancellation-receipt@1\0${stableStringify(base)}`)
      .digest("hex")}`,
  };
}

function fixtureLaunchDigest(label) {
  return `sha256:${crypto.createHash("sha256").update(`fixture-launch\0${label}`).digest("hex")}`;
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-lifecycle-"));
const lifecycleAuthorityPacket = createWorkspaceParentAuthorityPacket({
  boundaryId: "workspace_worker_lifecycle_fixture_authority",
  upstreamPolicyId: "workspace_worker_lifecycle_fixture_policy",
  upstreamAllowedTools: [...WORKSPACE_WORKER_TOOLS],
  allowedTools: [...WORKSPACE_WORKER_TOOLS],
});
try {
  for (const privatePath of [
    "/home/rose/private/worktree",
    "C:\\Users\\Rose\\private\\worktree",
    "\\\\server\\private\\worktree",
    "file:///home/rose/private/worktree",
    "FiLe:///C:/Users/Rose/private/worktree",
    "f%69le%3A%2F%2F%2Fhome%2Frose%2Fprivate%2Fworktree",
  ]) {
    assert.throws(
      () => safeWorkspaceExecutionProjection({
        schema: "direct_workspace_worker_execution@1",
        status: "completed",
        diagnostic: privatePath,
        rawWorkspacePathIncluded: false,
      }),
      (error) => error?.code === "direct_workspace_worker_execution_native_path_present",
    );
    assert.throws(
      () => safeWorkspaceExecutionProjection({
        schema: "direct_workspace_worker_execution@1",
        status: "completed",
        diagnostics: [[privatePath]],
        rawWorkspacePathIncluded: false,
      }),
      (error) => error?.code === "direct_workspace_worker_execution_native_path_present",
    );
  }
  const dbPath = path.join(temporaryRoot, "worker-lifecycle.sqlite");
  let registry = new WorkspaceWorkerLifecycleRegistry({ dbPath });
  const opened = registry.openSession({
    sessionId: "session_fixture",
    leaseId: "lease_fixture",
    childAgentId: "child_fixture",
    projectId: "project_fixture",
    workThreadId: "work_fixture",
    primaryThreadId: "primary_fixture",
    launchDigest: fixtureLaunchDigest("session_fixture"),
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
      launchDigest: fixtureLaunchDigest("session_operation_conflict"),
      operationId: "open_fixture",
    }),
    /direct_workspace_worker_operation_id_conflict/,
    "an operation ID cannot replay another session's registration",
  );
  const legacyRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  legacyRegistry.openSession({
    sessionId: "session_legacy_operation",
    leaseId: "lease_legacy_operation",
    childAgentId: "child_legacy_operation",
    projectId: "project_legacy_original",
    launchDigest: fixtureLaunchDigest("session_legacy_operation"),
    operationId: "legacy_blank_operation",
  });
  const legacyEventRow = legacyRegistry.db.prepare(
    "select event_json from workspace_worker_lifecycle_events where operation_id = ?",
  ).get("legacy_blank_operation");
  const legacyEvent = JSON.parse(legacyEventRow.event_json);
  delete legacyEvent.operationDigest;
  legacyRegistry.db.prepare(`
    update workspace_worker_lifecycle_events
    set operation_digest = '', event_json = ? where operation_id = ?
  `).run(JSON.stringify(legacyEvent), "legacy_blank_operation");
  assert.throws(
    () => legacyRegistry.openSession({
      sessionId: "session_legacy_operation",
      leaseId: "lease_legacy_operation",
      childAgentId: "child_legacy_operation",
      projectId: "project_legacy_conflicting",
      launchDigest: fixtureLaunchDigest("session_legacy_conflicting"),
      operationId: "legacy_blank_operation",
    }),
    /direct_workspace_worker_operation_digest_unverifiable/,
    "a migrated blank operation digest cannot act as a wildcard for conflicting canonical input",
  );
  legacyRegistry.close();

  const binding = normalizeBinding({
    workerKey: "worker_fixture",
    branchName: "codex/worker/fixture",
    baseCommit: "a".repeat(40),
    headCommit: "a".repeat(40),
    worktreePathDigest: `sha256:${"b".repeat(64)}`,
    sourceRepositoryDigest: `sha256:${"c".repeat(64)}`,
  });
  registry.beginProvisioning(opened.sessionId, {
    workerKey: binding.workerKey,
    branchName: binding.branchName,
    operationId: "provision_fixture",
  });
  assert.throws(
    () => registry.bindWorkspace(opened.sessionId, {
      binding: normalizeBinding({
        workerKey: "wrong_custody_worker",
        branchName: binding.branchName,
        baseCommit: binding.baseCommit,
        headCommit: binding.headCommit,
        worktreePathDigest: binding.worktreePathDigest,
        sourceRepositoryDigest: binding.sourceRepositoryDigest,
      }),
      operationId: "wrong_custody_binding_fixture",
    }),
    /direct_workspace_worker_binding_provisioning_custody_mismatch/,
  );
  const bound = registry.bindWorkspace(opened.sessionId, {
    binding,
    operationId: "bind_fixture",
  });
  assert.equal(bound.binding.bindingDigest, binding.bindingDigest);
  const active = registry.activateLease(opened.sessionId, { operationId: "activate_fixture" });
  assert.equal(active.state, "active");
  assert.equal(active.leaseState, "active");
  assert.equal(active.processState, "running");

  assert.throws(
    () => registry.requestCancellation(opened.sessionId, {
      operationId: "invalid_cancel_reason_fixture",
      reasonCode: "123 invalid reason",
    }),
    /direct_workspace_worker_cancellation_reason_invalid/,
  );
  assert.equal(registry.session(opened.sessionId).state, "active");

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
    cancellationReceipt: cancellationReceipt({
      launchDigest: opened.launchDigest,
      lifecycleSessionId: opened.sessionId,
      lifecycleLeaseId: opened.leaseId,
      reasonCode: "fixture_cancelled",
      acknowledgementKind: "fixture_registry_quiesced",
    }),
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.leaseState, "released");
  assert.equal(cancelled.processState, "quiescent");
  const duplicateAck = registry.acknowledgeCancellation(opened.sessionId, {
    operationId: "cancel_ack_fixture",
    reasonCode: "fixture_cancelled",
    cancellationReceipt: cancellationReceipt({
      launchDigest: opened.launchDigest,
      lifecycleSessionId: opened.sessionId,
      lifecycleLeaseId: opened.leaseId,
      reasonCode: "fixture_cancelled",
      acknowledgementKind: "fixture_registry_quiesced",
    }),
  });
  assert.equal(duplicateAck.sessionDigest, cancelled.sessionDigest, "settlement operation is idempotent");
  assert.equal(registry.events(opened.sessionId).length, 6);

  const receiptIsolationRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const receiptSource = receiptIsolationRegistry.openSession({
    sessionId: "session_receipt_source",
    leaseId: "lease_receipt_source",
    childAgentId: "child_receipt_source",
    projectId: "project_receipt_isolation",
    launchDigest: fixtureLaunchDigest("session_receipt_source"),
    operationId: "open_receipt_source",
  });
  const receiptTarget = receiptIsolationRegistry.openSession({
    sessionId: "session_receipt_target",
    leaseId: "lease_receipt_target",
    childAgentId: "child_receipt_target",
    projectId: "project_receipt_isolation",
    launchDigest: fixtureLaunchDigest("session_receipt_target"),
    operationId: "open_receipt_target",
  });
  for (const session of [receiptSource, receiptTarget]) {
    receiptIsolationRegistry.activateLease(session.sessionId, {
      operationId: `activate_${session.sessionId}`,
    });
    receiptIsolationRegistry.requestCancellation(session.sessionId, {
      operationId: `cancel_${session.sessionId}`,
      reasonCode: "fixture_receipt_isolation_cancel",
    });
  }
  const sourceRuntimeReceipt = cancellationReceipt({
    launchDigest: receiptSource.launchDigest,
    lifecycleSessionId: receiptSource.sessionId,
    lifecycleLeaseId: receiptSource.leaseId,
    reasonCode: "fixture_receipt_isolation_cancel",
    acknowledgementKind: "fixture_receipt_source_quiesced",
  });
  assert.throws(
    () => receiptIsolationRegistry.acknowledgeCancellation(receiptTarget.sessionId, {
      operationId: "transplant_source_receipt_into_target",
      reasonCode: "fixture_receipt_isolation_cancel",
      cancellationReceipt: sourceRuntimeReceipt,
    }),
    /direct_workspace_worker_cancellation_receipt_invalid/,
    "a runtime receipt cannot be transplanted into another lifecycle session",
  );
  assert.equal(receiptIsolationRegistry.session(receiptTarget.sessionId).leaseState, "active");

  const monotonicOutcome = mutationOutcome({
    requestId: "monotonic_mutation_request",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    committed: false,
    retainedForInspection: true,
    failureCode: "fixture_monotonic_partial_outcome",
  });
  receiptIsolationRegistry.recordMutationOutcome(receiptTarget.sessionId, {
    operationId: "record_monotonic_partial_outcome",
    mutationOutcome: monotonicOutcome,
  });
  assert.throws(
    () => receiptIsolationRegistry.acknowledgeCancellation(receiptTarget.sessionId, {
      operationId: "erase_monotonic_partial_outcome",
      reasonCode: "fixture_receipt_isolation_cancel",
      cancellationReceipt: cancellationReceipt({
        launchDigest: receiptTarget.launchDigest,
        lifecycleSessionId: receiptTarget.sessionId,
        lifecycleLeaseId: receiptTarget.leaseId,
        reasonCode: "fixture_receipt_isolation_cancel",
        acknowledgementKind: "fixture_empty_outcome_receipt",
      }),
    }),
    /direct_workspace_worker_cancellation_receipt_invalid/,
    "cancellation acknowledgement cannot erase previously admitted mutation evidence",
  );
  const monotonicSettled = receiptIsolationRegistry.acknowledgeCancellation(receiptTarget.sessionId, {
    operationId: "settle_monotonic_partial_outcome",
    reasonCode: "fixture_receipt_isolation_cancel",
    cancellationReceipt: cancellationReceipt({
      targetRequestId: monotonicOutcome.requestId,
      launchDigest: receiptTarget.launchDigest,
      lifecycleSessionId: receiptTarget.sessionId,
      lifecycleLeaseId: receiptTarget.leaseId,
      reasonCode: "fixture_receipt_isolation_cancel",
      acknowledgementKind: "fixture_monotonic_outcome_quiesced",
      mutationOutcome: monotonicOutcome,
    }),
  });
  assert.equal(monotonicSettled.mutationOutcome.outcomeDigest, monotonicOutcome.outcomeDigest);
  receiptIsolationRegistry.close();

  const observation = buildWorkspaceWorkerCleanupObservation({
    observationComplete: true,
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
  });
  const cleanupPlan = buildWorkspaceWorkerCleanupPlan({ session: cancelled, observation });
  assertWorkspaceWorkerCleanupPlanSafe(cleanupPlan);
  assert.equal(cleanupPlan.canRemove, true);
  assert.equal(cleanupPlan.dryRun, true);
  assert.equal(cleanupPlan.forceRemovalAllowed, false);
  const forgedObservationPlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: { ...observation, observationDigest: "not-a-digest" },
  });
  assert.equal(forgedObservationPlan.canRemove, false);
  assert(forgedObservationPlan.blockerCodes.includes("cleanup_observation_invalid"));
  const omittedNegativeEvidencePlan = buildWorkspaceWorkerCleanupPlan({
    session: cancelled,
    observation: {
      ...observation,
      conflictState: undefined,
      gitOperationInProgress: undefined,
      observationDigest: undefined,
    },
  });
  assert.equal(omittedNegativeEvidencePlan.canRemove, false);
  assert(omittedNegativeEvidencePlan.blockerCodes.includes("cleanup_conflict_state_unavailable"));
  assert(omittedNegativeEvidencePlan.blockerCodes.includes("cleanup_git_operation_state_unavailable"));
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
  const partialOutcomeBinding = normalizeBinding({
    workerKey: "partial_outcome_worker",
    branchName: "codex/worker/partial-outcome-worker",
    baseCommit: "4".repeat(40),
    headCommit: "4".repeat(40),
    worktreePathDigest: `sha256:${"5".repeat(64)}`,
    sourceRepositoryDigest: `sha256:${"6".repeat(64)}`,
  });
  const partialOutcomeSession = registry.openSession({
    sessionId: "session_partial_outcome_durable",
    leaseId: "lease_partial_outcome_durable",
    childAgentId: "child_partial_outcome_durable",
    projectId: "project_partial_outcome_durable",
    launchDigest: fixtureLaunchDigest("session_partial_outcome_durable"),
    operationId: "open_partial_outcome_durable",
  });
  registry.beginProvisioning(partialOutcomeSession.sessionId, {
    operationId: "provision_partial_outcome_durable",
    workerKey: partialOutcomeBinding.workerKey,
    branchName: partialOutcomeBinding.branchName,
  });
  registry.bindWorkspace(partialOutcomeSession.sessionId, {
    operationId: "bind_partial_outcome_durable",
    binding: partialOutcomeBinding,
  });
  registry.activateLease(partialOutcomeSession.sessionId, {
    operationId: "activate_partial_outcome_durable",
  });
  registry.requestCancellation(partialOutcomeSession.sessionId, {
    operationId: "cancel_partial_outcome_durable",
    reasonCode: "fixture_partial_outcome",
  });
  const durablePartialOutcome = mutationOutcome({
    requestId: "durable_partial_backend_request",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    committed: false,
    retainedForInspection: true,
    failureCode: "fixture_partial_outcome",
  });
  registry.settleSession(partialOutcomeSession.sessionId, {
    operationId: "settle_partial_outcome_durable",
    state: "failed",
    blockerCode: "workspace_backend_mutation_commit_failed_indeterminate",
    mutationOutcome: durablePartialOutcome,
    cancellationReceipt: cancellationReceipt({
      targetRequestId: durablePartialOutcome.requestId,
      launchDigest: partialOutcomeSession.launchDigest,
      lifecycleSessionId: partialOutcomeSession.sessionId,
      lifecycleLeaseId: partialOutcomeSession.leaseId,
      reasonCode: "fixture_partial_outcome",
      acknowledgementKind: "mutation_commit_failed_indeterminate",
      mutationOutcome: durablePartialOutcome,
    }),
  });
  registry.close();

  registry = new WorkspaceWorkerLifecycleRegistry({ dbPath });
  const restoredPartialOutcomeSession = registry.session(partialOutcomeSession.sessionId);
  assert.deepEqual(
    restoredPartialOutcomeSession.mutationOutcome,
    durablePartialOutcome,
    "mutation outcome evidence survives lifecycle registry restart",
  );
  assert.equal(restoredPartialOutcomeSession.cancellation.acknowledged, true);
  assert.match(
    restoredPartialOutcomeSession.cancellationReceipt?.receiptDigest || "",
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    restoredPartialOutcomeSession.cancellationReceipt?.outcomeDigest,
    durablePartialOutcome.outcomeDigest,
  );
  const partialOutcomeObservation = buildWorkspaceWorkerCleanupObservation({
    observationComplete: true,
    workerKey: partialOutcomeBinding.workerKey,
    branchName: partialOutcomeBinding.branchName,
    bindingDigest: partialOutcomeBinding.bindingDigest,
    worktreePathDigest: partialOutcomeBinding.worktreePathDigest,
    worktreeRegistered: true,
    processQuiescent: true,
    activeProcessCount: 0,
    gitStatusReadSucceeded: true,
    statusEntries: [],
    untrackedFileCount: 0,
    headReadSucceeded: true,
    headCommit: partialOutcomeBinding.headCommit,
    uniqueWorkReadSucceeded: true,
    uniqueCommitCount: 0,
    conflictState: false,
    gitOperationInProgress: false,
  });
  const partialOutcomeCleanupPlan = buildWorkspaceWorkerCleanupPlan({
    session: restoredPartialOutcomeSession,
    observation: partialOutcomeObservation,
  });
  assert.equal(partialOutcomeCleanupPlan.canRemove, false);
  assert.equal(partialOutcomeCleanupPlan.mutationOutcomeDigest, durablePartialOutcome.outcomeDigest);
  assert(partialOutcomeCleanupPlan.blockerCodes.includes("cleanup_mutation_outcome_indeterminate"));
  const forgedPartialOutcomeCleanupPlan = buildWorkspaceWorkerCleanupPlan({
    session: {
      ...restoredPartialOutcomeSession,
      mutationOutcome: {
        ...durablePartialOutcome,
        indeterminate: false,
        partialMutationPossible: false,
      },
    },
    observation: partialOutcomeObservation,
  });
  assert.equal(forgedPartialOutcomeCleanupPlan.canRemove, true);
  assert.throws(
    () => registry.markCleanupEligible(partialOutcomeSession.sessionId, {
      operationId: "forged_partial_outcome_cleanup",
      plan: forgedPartialOutcomeCleanupPlan,
    }),
    /direct_workspace_worker_cleanup_plan_binding_mismatch/,
    "a caller cannot preserve an outcome digest while stripping its indeterminate semantics",
  );
  registry.close();

  const recoveryDbPath = path.join(temporaryRoot, "worker-recovery.sqlite");
  let recoveryRegistry = new WorkspaceWorkerLifecycleRegistry({ dbPath: recoveryDbPath });
  const interrupted = recoveryRegistry.openSession({
    sessionId: "session_restart_interrupted",
    leaseId: "lease_restart_interrupted",
    childAgentId: "child_restart_interrupted",
    projectId: "project_restart_interrupted",
    launchDigest: fixtureLaunchDigest("session_restart_interrupted"),
    operationId: "open_restart_interrupted",
  });
  recoveryRegistry.activateLease(interrupted.sessionId, { operationId: "activate_restart_interrupted" });
  recoveryRegistry.close();
  recoveryRegistry = new WorkspaceWorkerLifecycleRegistry({ dbPath: recoveryDbPath });
  const recoveryPool = new DirectNativeAgentPool({
    workspaceWorkerLifecycleRegistry: recoveryRegistry,
    workspaceWorkerRunner: async () => ({ status: "completed" }),
  });
  assert.equal(recoveryPool.recoverySnapshot().status, "reconciliation_required");
  assert.equal(recoveryPool.descriptor().durableRecoveryCandidateCount, 1);
  assert.throws(
    () => buildWorkspaceWorkerReconciliationReceipt({
      sessionId: interrupted.sessionId,
      expectedRevision: recoveryRegistry.session(interrupted.sessionId).revision,
      providerAcknowledged: true,
      backendQuiesced: true,
      verifierId: "workspace_backend_restart_verifier",
    }),
    /direct_workspace_worker_reconciliation_evidence_invalid/,
  );
  const blockedRecoveryLaunch = recoveryPool.launch({
    childAgentId: "new_child_while_recovery_pending",
    projectId: "project_restart_interrupted",
    taskName: "new_child_while_recovery_pending",
    message: "must not launch",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_restart_interrupted" },
  });
  assert.equal(blockedRecoveryLaunch.blockerCode, "direct_workspace_worker_restart_reconciliation_required");
  assert.equal((await recoveryPool.drainAndClose({ timeoutMs: 0 })).status, "reconciliation_required");
  assert.equal(recoveryRegistry.session(interrupted.sessionId).leaseState, "active");
  const reconciliationReceipt = buildWorkspaceWorkerReconciliationReceipt({
    sessionId: interrupted.sessionId,
    expectedRevision: recoveryRegistry.session(interrupted.sessionId).revision,
    outcome: "failed",
    reasonCode: "restart_process_absent_and_verified_quiescent",
    providerAcknowledged: true,
    backendQuiesced: true,
    providerAcknowledgementDigest: `sha256:${"e".repeat(64)}`,
    backendQuiescenceDigest: `sha256:${"f".repeat(64)}`,
    verifierId: "workspace_backend_restart_verifier",
    processIdentityRecovered: false,
    bindingRetainedForInspection: true,
  });
  recoveryPool.reconcileRecoveredSession({ receipt: reconciliationReceipt });
  assert.equal(recoveryPool.recoverySnapshot().status, "clean");
  assert.equal(recoveryRegistry.session(interrupted.sessionId).leaseState, "released");
  assert.throws(
    () => recoveryPool.reconcileRecoveredSession({ receipt: reconciliationReceipt }),
    /direct_workspace_worker_recovery_candidate_missing/,
  );
  recoveryRegistry.close();

  const preStartRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  let preStartRunnerCalls = 0;
  const preStartPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: preStartRegistry,
    workspaceWorkerRunner: async () => {
      preStartRunnerCalls += 1;
      throw new Error("a synchronously cancelled child must not reach the workspace runner");
    },
  });
  const preStartLaunch = preStartPool.launch({
    childAgentId: "child_cancelled_before_runner_start",
    projectId: "project_pre_start_cancel",
    primaryThreadId: "primary_pre_start_cancel",
    workThreadId: "work_pre_start_cancel",
    taskName: "cancelled_before_runner_start",
    message: "cancel before the runner is invoked",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_pre_start_cancel" },
  });
  preStartPool.interrupt({
    projectId: "project_pre_start_cancel",
    primaryThreadId: "primary_pre_start_cancel",
    target: preStartLaunch.childAgentId,
    reasonCode: "fixture_pre_start_cancel",
  });
  const preStartDone = await preStartPool.wait({
    projectId: "project_pre_start_cancel",
    primaryThreadId: "primary_pre_start_cancel",
    target: preStartLaunch.childAgentId,
    timeoutMs: 2_000,
  });
  assert.equal(preStartRunnerCalls, 0);
  assert.equal(preStartDone.updates[0].state, "cancelled");
  assert.equal(preStartDone.updates[0].cancellation.acknowledged, true);
  assert.match(preStartDone.updates[0].cancellation.receiptDigest, /^sha256:[a-f0-9]{64}$/);
  const preStartDurable = preStartRegistry.sessionForChild(preStartLaunch.childAgentId);
  assert.equal(preStartDurable.state, "cancelled");
  assert.equal(preStartDurable.cancellation.acknowledged, true);
  assert.equal(
    preStartDurable.cancellationReceipt.receiptDigest,
    preStartDone.updates[0].cancellation.receiptDigest,
    "the public cancellation witness is the session-and-lease-bound lifecycle receipt",
  );
  assert.notEqual(
    preStartDurable.cancellationReceipt.runtimeReceiptDigest,
    preStartDurable.cancellationReceipt.receiptDigest,
  );
  preStartRegistry.close();

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
    parentAuthorityPacket: lifecycleAuthorityPacket,
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
    parentAuthorityPacket: lifecycleAuthorityPacket,
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
  pool.beginWorkspaceProvisioning(first.childAgentId, {
    workerKey: firstLifecycleBinding.workerKey,
    branchName: firstLifecycleBinding.branchName,
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
  runnerGates[0].resolve(runDirectWorkspaceWorker({
    childAgentId: first.childAgentId,
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    workThreadId: "work_pool_lifecycle",
    launchDigest: pool.inspect({ target: first.childAgentId }).launchDigest,
    lifecycleSessionId: pool.inspect({ target: first.childAgentId }).workspaceLifecycle.sessionId,
    lifecycleLeaseId: pool.inspect({ target: first.childAgentId }).workspaceLifecycle.leaseId,
    signal: runnerCalls[0].signal,
    task: "produce a harness-owned pre-provision cancellation receipt",
    workspaceProvisioner: async () => { throw new Error("must not provision after cancellation"); },
    providerRequestRunner: async () => { throw new Error("must not call provider after cancellation"); },
  }));
  const firstDone = await pool.wait({
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    target: first.childAgentId,
    timeoutMs: 2_000,
  });
  assert.equal(firstDone.updates[0].state, "cancelled");
  assert.equal(firstDone.updates[0].cancellation.acknowledged, true);
  assert.equal(firstDone.updates[0].cancellation.leaseActive, false);
  const firstTerminalRecord = pool.resolveTarget(first.childAgentId);
  const firstCancellationReason = firstTerminalRecord._cancelReasonCode;
  firstTerminalRecord._cancelReasonCode = "conflicting_replay_reason";
  assert.equal(
    pool.commitLifecycleSettlement(firstTerminalRecord, {
      state: "cancelled",
      blockerCode: firstTerminalRecord.blockerCode,
      resultDigest: firstTerminalRecord.resultDigest,
      mutationOutcome: firstTerminalRecord.mutationOutcome,
      cancellationReceipt: firstTerminalRecord._cancellationReceipt,
    }),
    "direct_workspace_worker_lifecycle_settlement_conflict",
    "terminal replay cannot substitute a different cancellation reason",
  );
  firstTerminalRecord._cancelReasonCode = firstCancellationReason;
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
  assert.equal(
    pool.commitLifecycleSettlement(pool.resolveTarget(second.childAgentId), {
      state: "completed",
      blockerCode: "",
      resultDigest: `sha256:${"b".repeat(64)}`,
      mutationOutcome: null,
      cancellationReceipt: null,
    }),
    "direct_workspace_worker_lifecycle_settlement_conflict",
    "terminal replay cannot substitute different result evidence",
  );
  const reusedIdentity = pool.launch({
    childAgentId: second.childAgentId,
    projectId: "project_pool_lifecycle",
    primaryThreadId: "primary_pool_lifecycle",
    workThreadId: "work_pool_lifecycle",
    taskName: "reused_terminal_identity",
    message: "must not execute",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_pool_lifecycle" },
  });
  assert.equal(reusedIdentity.blockerCode, "direct_agent_child_identity_reused");

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

  const lateWriteChild = new FakeChild();
  let lateWriteCallback = null;
  lateWriteChild.stdin.write = (_chunk, callback) => {
    lateWriteCallback = callback;
    return true;
  };
  const lateWriteTransport = new NdjsonTransport(lateWriteChild);
  const lateWriteRequest = lateWriteTransport.request("hello", {}, 2_000);
  const lateWriteRequestId = [...lateWriteTransport.pending.keys()][0];
  assert.ok(lateWriteRequestId);
  lateWriteTransport.handleLine(JSON.stringify({ id: lateWriteRequestId, result: { ok: true } }));
  assert.deepEqual(await lateWriteRequest, { ok: true });
  assert.doesNotThrow(
    () => lateWriteCallback?.(Object.assign(new Error("late write callback"), { code: "EPIPE" })),
    "a write callback arriving after terminal response settlement must be ignored",
  );
  assert.equal(lateWriteTransport.pendingRequestCount(), 0);

  const failedWriteChild = new FakeChild();
  let failedWriteCallback = null;
  failedWriteChild.stdin.write = (_chunk, callback) => {
    failedWriteCallback = callback;
    return true;
  };
  const failedWriteTransport = new NdjsonTransport(failedWriteChild);
  const failedWritePromise = failedWriteTransport.request("applyPatch", { patch: "fixture" }, 2_000);
  const failedWriteRequestId = [...failedWriteTransport.pending.keys()][0];
  failedWriteCallback?.(Object.assign(new Error("fixture write failure"), { code: "EPIPE" }));
  await assert.rejects(failedWritePromise, (error) => {
    assert.equal(error.code, "EPIPE");
    assert.equal(error.requestId, failedWriteRequestId);
    assert.equal(error.workspaceBackendRequest, true);
    assert.equal(error.backendRequestCompleted, false);
    assert.equal(error.backendQuiesced, false);
    assert.equal(error.partialMutationPossible, true);
    assert.equal(error.mutationOutcome?.schema, "workspace_backend_mutation_outcome@1");
    assert.equal(error.mutationOutcome?.requestId, failedWriteRequestId);
    assert.equal(error.mutationOutcome?.method, "applyPatch");
    assert.equal(error.mutationOutcome?.commitKind, "apply_patch_files");
    assert.equal(error.mutationOutcome?.committed, false);
    assert.equal(error.mutationOutcome?.indeterminate, true);
    assert.equal(error.mutationOutcome?.failureCode, "EPIPE");
    assert.match(error.mutationOutcome?.outcomeDigest || "", /^sha256:[a-f0-9]{64}$/);
    return true;
  });
  assert.equal(failedWriteTransport.pendingRequestCount(), 0);

  const oversizedFrameTransport = new NdjsonTransport(new FakeChild());
  const oversizedFrameRequest = oversizedFrameTransport.request("hello", {}, 2_000);
  oversizedFrameTransport.handleData("x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(
    oversizedFrameRequest,
    (error) => error.code === "workspace_backend_ndjson_frame_too_large",
    "partial backend stdout frames must fail closed before unbounded buffering",
  );
  assert.equal(oversizedFrameTransport.pendingRequestCount(), 0);

  const boundaryTransport = new NdjsonTransport(new FakeChild());
  const boundaryMessages = [];
  boundaryTransport.handleLine = (line) => boundaryMessages.push(JSON.parse(line));
  const boundaryPayload = Buffer.from(
    '{"id":"utf8","result":{"text":"€"}}\n{"id":"small","result":{"ok":true}}\n',
    "utf8",
  );
  const euroOffset = boundaryPayload.indexOf(Buffer.from("€", "utf8"));
  boundaryTransport.handleData(boundaryPayload.subarray(0, euroOffset + 1));
  boundaryTransport.handleData(boundaryPayload.subarray(euroOffset + 1));
  assert.deepEqual(
    boundaryMessages,
    [
      { id: "utf8", result: { text: "€" } },
      { id: "small", result: { ok: true } },
    ],
    "NDJSON frames must be admitted as raw bytes before decoding, preserving split UTF-8 and multiple lines",
  );

  const windowsTreeChild = new EventEmitter();
  windowsTreeChild.pid = 4242;
  windowsTreeChild.exitCode = null;
  windowsTreeChild.signalCode = null;
  const windowsTaskkillArgs = [];
  const verifiedWindowsTreeKill = terminateWorkspaceProcessTree(windowsTreeChild, {
    platform: "win32",
    timeoutMs: 100,
    spawnImpl: (command, args) => {
      windowsTaskkillArgs.push({ command, args });
      const taskkill = new EventEmitter();
      setImmediate(() => {
        taskkill.emit("exit", 0);
        windowsTreeChild.exitCode = 1;
        windowsTreeChild.emit("exit", 1, null);
      });
      return taskkill;
    },
  });
  const uncontainedWindowsTreeReceipt = await verifiedWindowsTreeKill;
  assert.equal(uncontainedWindowsTreeReceipt.quiesced, false);
  assert.equal(uncontainedWindowsTreeReceipt.method, "taskkill_tree_force_uncontained");
  assert.equal(
    uncontainedWindowsTreeReceipt.blockerCode,
    "workspace_windows_job_object_containment_unavailable",
    "taskkill is cleanup, not a containment witness",
  );
  assert.deepEqual(windowsTaskkillArgs[0], {
    command: "taskkill",
    args: ["/PID", "4242", "/T", "/F"],
  });
  const hungWindowsTreeChild = new EventEmitter();
  hungWindowsTreeChild.pid = 4343;
  hungWindowsTreeChild.exitCode = null;
  hungWindowsTreeChild.signalCode = null;
  let hungTaskkillKilled = false;
  const hungWindowsTreeKill = await terminateWorkspaceProcessTree(hungWindowsTreeChild, {
    platform: "win32",
    timeoutMs: 20,
    spawnImpl: () => {
      const taskkill = new EventEmitter();
      taskkill.kill = () => {
        hungTaskkillKilled = true;
        setImmediate(() => taskkill.emit("exit", null));
        return true;
      };
      return taskkill;
    },
  });
  assert.equal(hungWindowsTreeKill.quiesced, false);
  assert.equal(hungWindowsTreeKill.blockerCode, "taskkill_timeout");
  assert.equal(hungTaskkillKilled, true, "a hung taskkill helper is itself bounded and terminated");

  const exitedWindowsLeader = new EventEmitter();
  exitedWindowsLeader.pid = 4400;
  exitedWindowsLeader.exitCode = 0;
  exitedWindowsLeader.signalCode = null;
  const retainedWindowsTaskkillPids = [];
  const retainedWindowsTreeKill = await terminateWorkspaceProcessTree(exitedWindowsLeader, {
    platform: "win32",
    timeoutMs: 20,
    spawnImpl: (_command, args) => {
      const taskkill = new EventEmitter();
      const targetPid = Number(args[1]);
      retainedWindowsTaskkillPids.push(targetPid);
      setImmediate(() => taskkill.emit("exit", 1));
      return taskkill;
    },
  });
  assert.equal(retainedWindowsTreeKill.quiesced, false);
  assert.equal(retainedWindowsTreeKill.method, "taskkill_tree_force_uncontained");
  assert.deepEqual(retainedWindowsTaskkillPids, [4400]);

  const jobContainedWindowsTree = await terminateWorkspaceProcessTree(exitedWindowsLeader, {
    platform: "win32",
    timeoutMs: 20,
    windowsJobObjectTerminationImpl: async () => ({
      quiesced: true,
      containmentKind: "windows_job_object",
      jobClosed: true,
    }),
  });
  assert.equal(jobContainedWindowsTree.quiesced, true);
  assert.equal(jobContainedWindowsTree.method, "windows_job_object_closed");

  const posixTreeChild = new EventEmitter();
  posixTreeChild.pid = 4444;
  posixTreeChild.exitCode = null;
  posixTreeChild.signalCode = null;
  let posixGroupAlive = true;
  const posixSignals = [];
  const verifiedPosixTreeKill = await terminateWorkspaceProcessTree(posixTreeChild, {
    platform: "linux",
    timeoutMs: 20,
    pollMs: 1,
    killImpl: (pid, signal) => {
      assert.equal(pid, -posixTreeChild.pid);
      if (signal === 0) {
        if (posixGroupAlive) return true;
        const error = new Error("group absent");
        error.code = "ESRCH";
        throw error;
      }
      posixSignals.push(signal);
      if (signal === "SIGTERM") {
        posixTreeChild.exitCode = 0;
        posixTreeChild.emit("exit", 0, null);
      }
      if (signal === "SIGKILL") posixGroupAlive = false;
      return true;
    },
  });
  assert.equal(verifiedPosixTreeKill.quiesced, true);
  assert.equal(verifiedPosixTreeKill.method, "posix_process_group_signal_escalated");
  assert.deepEqual(posixSignals, ["SIGTERM", "SIGKILL"], "direct-child exit cannot substitute for process-group quiescence");

  const zombieTreeChild = new EventEmitter();
  zombieTreeChild.pid = 4545;
  zombieTreeChild.exitCode = null;
  zombieTreeChild.signalCode = null;
  let zombieOnly = false;
  const zombieSignals = [];
  const zombieOnlyTreeKill = await terminateWorkspaceProcessTree(zombieTreeChild, {
    platform: "linux",
    timeoutMs: 20,
    pollMs: 1,
    killImpl: (pid, signal) => {
      assert.equal(pid, -zombieTreeChild.pid);
      if (signal !== 0) {
        zombieSignals.push(signal);
        zombieOnly = true;
      }
      return true;
    },
    processGroupStateImpl: () => zombieOnly ? "zombie_only" : "mutable",
  });
  assert.equal(zombieOnlyTreeKill.quiesced, true);
  assert.equal(zombieOnlyTreeKill.method, "posix_process_group_signal");
  assert.deepEqual(zombieSignals, ["SIGTERM"], "a zombie-only group needs no SIGKILL escalation");

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

  const forgedReceiptPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "forged-receipt", branch: "codex/worker/forged-receipt", baseRef: "HEAD" },
    2_000,
  );
  await tick();
  const forgedReceiptRequest = writes.at(-1);
  const foreignOutcome = mutationOutcome({
    requestId: "foreign_request",
    method: "removeGitWorktree",
    commitKind: "git_worktree_remove_non_force",
    committed: true,
    retainedForInspection: true,
    resultDigest: `sha256:${"2".repeat(64)}`,
  });
  fakeChild.stdout.write(`${JSON.stringify({
    id: forgedReceiptRequest.id,
    result: {
      workerKey: "forged-receipt",
      requestOutcome: foreignOutcome,
    },
  })}\n`);
  await assert.rejects(forgedReceiptPromise, (error) => {
    assert.equal(error.code, "workspace_backend_mutation_outcome_invalid");
    assert.equal(error.backendQuiesced, false);
    return true;
  });

  const forgedResultDigestPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "forged-result", branch: "codex/worker/forged-result", baseRef: "HEAD" },
    2_000,
  );
  await tick();
  const forgedResultDigestRequest = writes.at(-1);
  fakeChild.stdout.write(`${JSON.stringify({
    id: forgedResultDigestRequest.id,
    result: {
      workerKey: "substituted-result",
      requestOutcome: mutationOutcome({
        requestId: forgedResultDigestRequest.id,
        method: "provisionGitWorktree",
        commitKind: "git_worktree_add",
        committed: true,
        retainedForInspection: true,
        resultDigest: `sha256:${"9".repeat(64)}`,
      }),
    },
  })}\n`);
  await assert.rejects(
    forgedResultDigestPromise,
    (error) => error.code === "workspace_backend_mutation_outcome_invalid",
    "a structurally valid receipt cannot bless a substituted result body",
  );

  const wrongCommitKindPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "wrong-kind", branch: "codex/worker/wrong-kind", baseRef: "HEAD" },
    2_000,
  );
  await tick();
  const wrongCommitKindRequest = writes.at(-1);
  const wrongCommitKindBase = { workerKey: "wrong-kind" };
  fakeChild.stdout.write(`${JSON.stringify({
    id: wrongCommitKindRequest.id,
    result: {
      ...wrongCommitKindBase,
      requestOutcome: mutationOutcome({
        requestId: wrongCommitKindRequest.id,
        method: "provisionGitWorktree",
        commitKind: "import_file",
        committed: true,
        retainedForInspection: true,
        resultDigest: `sha256:${crypto.createHash("sha256").update(stableStringify(wrongCommitKindBase)).digest("hex")}`,
      }),
    },
  })}\n`);
  await assert.rejects(
    wrongCommitKindPromise,
    (error) => error.code === "workspace_backend_mutation_outcome_invalid",
    "each mutating method admits only its exact commit kinds",
  );

  const mutationController = new AbortController();
  const mutationPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "retained-worker", branch: "codex/worker/retained-worker", baseRef: "HEAD" },
    2_000,
    { signal: mutationController.signal },
  );
  await tick();
  const mutationRequest = writes.at(-1);
  mutationController.abort("fixture_cancel_after_commit");
  await tick();
  const mutationCancel = writes.at(-1);
  assert.equal(mutationCancel.method, "cancelRequest");
  const retainedMutationResult = committedMutationResult({
      schema: "direct_workspace_worker_binding@1",
      projectId: "project_retained_binding",
      workerKey: "retained-worker",
      workspaceKind: "local",
      branch: "codex/worker/retained-worker",
      baseCommit: "a".repeat(40),
      rootEvidenceDigest: `sha256:${"b".repeat(64)}`,
      sourceRepositoryDigest: `sha256:${"c".repeat(64)}`,
      retainedAfterCompletion: true,
      rawWorkspacePathIncluded: false,
      bindingId: "workspace_worker_binding_fixture",
      bindingDigest: `sha256:${"d".repeat(64)}`,
    }, {
      requestId: mutationRequest.id,
      method: "provisionGitWorktree",
      commitKind: "git_worktree_add",
      retainedForInspection: true,
    });
  fakeChild.stdout.write(`${JSON.stringify({
    id: mutationRequest.id,
    result: retainedMutationResult,
  })}\n`);
  const retainedMutation = await mutationPromise;
  assert.equal(retainedMutation.requestOutcome.committed, true);
  assert.equal(retainedMutation.workerKey, "retained-worker");
  assert.equal(retainedMutation.branch, "codex/worker/retained-worker");
  assert.equal(retainedMutation.retainedAfterCompletion, true);
  assert.match(retainedMutation.bindingDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(transport.pendingRequestCount(), 0);

  const cancelReceiptFirstController = new AbortController();
  const cancelReceiptFirstPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "receipt-first", branch: "codex/worker/receipt-first", baseRef: "HEAD" },
    2_000,
    { signal: cancelReceiptFirstController.signal },
  );
  let cancelReceiptFirstSettled = false;
  cancelReceiptFirstPromise.finally(() => { cancelReceiptFirstSettled = true; }).catch(() => {});
  await tick();
  const cancelReceiptFirstRequest = writes.at(-1);
  cancelReceiptFirstController.abort("fixture_cancel_receipt_first");
  await tick();
  const cancelReceiptFirstControl = writes.at(-1);
  const cancelReceiptFirstResult = committedMutationResult({
    workerKey: "receipt-first",
    retainedAfterCompletion: true,
  }, {
    requestId: cancelReceiptFirstRequest.id,
    method: "provisionGitWorktree",
    commitKind: "git_worktree_add",
    retainedForInspection: true,
  });
  fakeChild.stdout.write(`${JSON.stringify({
    id: cancelReceiptFirstControl.id,
    result: {
      targetRequestId: cancelReceiptFirstRequest.id,
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "fixture_commit_completed_before_cancel",
      mutationOutcome: cancelReceiptFirstResult.requestOutcome,
    },
  })}\n`);
  await tick();
  assert.equal(
    cancelReceiptFirstSettled,
    false,
    "a committed cancellation receipt waits for the exact body-bound original result",
  );
  fakeChild.stdout.write(`${JSON.stringify({
    id: cancelReceiptFirstRequest.id,
    result: cancelReceiptFirstResult,
  })}\n`);
  assert.equal((await cancelReceiptFirstPromise).workerKey, "receipt-first");

  const missingCommittedResultController = new AbortController();
  const missingCommittedResultPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "missing-committed-result", branch: "codex/worker/missing-committed-result", baseRef: "HEAD" },
    2_000,
    { signal: missingCommittedResultController.signal },
  );
  await tick();
  const missingCommittedResultRequest = writes.at(-1);
  missingCommittedResultController.abort("fixture_missing_committed_result");
  await tick();
  const missingCommittedResultControl = writes.at(-1);
  const missingCommittedResult = committedMutationResult({
    workerKey: "missing-committed-result",
    retainedAfterCompletion: true,
  }, {
    requestId: missingCommittedResultRequest.id,
    method: "provisionGitWorktree",
    commitKind: "git_worktree_add",
    retainedForInspection: true,
  });
  fakeChild.stdout.write(`${JSON.stringify({
    id: missingCommittedResultControl.id,
    result: {
      targetRequestId: missingCommittedResultRequest.id,
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "fixture_commit_completed_before_missing_result",
      mutationOutcome: missingCommittedResult.requestOutcome,
    },
  })}\n`);
  await tick();
  fakeChild.stdout.write(`${JSON.stringify({
    id: missingCommittedResultRequest.id,
    result: { workerKey: "missing-committed-result", retainedAfterCompletion: true },
  })}\n`);
  await assert.rejects(missingCommittedResultPromise, (error) => {
    assert.equal(error.code, "workspace_backend_committed_result_receipt_missing");
    assert.equal(error.backendQuiesced, true);
    assert.equal(error.cancellationAcknowledged, true);
    assert.deepEqual(error.mutationOutcome, missingCommittedResult.requestOutcome);
    return true;
  });

  const conflictingCommittedResultController = new AbortController();
  const conflictingCommittedResultPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "conflicting-committed-result", branch: "codex/worker/conflicting-committed-result", baseRef: "HEAD" },
    2_000,
    { signal: conflictingCommittedResultController.signal },
  );
  await tick();
  const conflictingCommittedResultRequest = writes.at(-1);
  conflictingCommittedResultController.abort("fixture_conflicting_committed_result");
  await tick();
  const conflictingCommittedResultControl = writes.at(-1);
  const firstCommittedResult = committedMutationResult({ workerKey: "first-body" }, {
    requestId: conflictingCommittedResultRequest.id,
    method: "provisionGitWorktree",
    commitKind: "git_worktree_add",
    retainedForInspection: true,
  });
  const conflictingCommittedResult = committedMutationResult({ workerKey: "conflicting-body" }, {
    requestId: conflictingCommittedResultRequest.id,
    method: "provisionGitWorktree",
    commitKind: "git_worktree_add",
    retainedForInspection: true,
  });
  fakeChild.stdout.write(`${JSON.stringify({
    id: conflictingCommittedResultControl.id,
    result: {
      targetRequestId: conflictingCommittedResultRequest.id,
      acknowledged: true,
      quiesced: true,
      acknowledgementKind: "fixture_conflicting_commit_receipt",
      mutationOutcome: firstCommittedResult.requestOutcome,
    },
  })}\n`);
  await tick();
  fakeChild.stdout.write(`${JSON.stringify({
    id: conflictingCommittedResultRequest.id,
    result: conflictingCommittedResult,
  })}\n`);
  await assert.rejects(conflictingCommittedResultPromise, (error) => {
    assert.equal(error.code, "workspace_backend_mutation_outcome_conflict");
    assert.equal(error.backendQuiesced, true);
    assert.equal(error.cancellationAcknowledged, true);
    assert.deepEqual(error.mutationOutcome, firstCommittedResult.requestOutcome);
    return true;
  });
  assert.equal(transport.pendingRequestCount(), 0);

  const indeterminateController = new AbortController();
  const indeterminatePromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "indeterminate-worker", branch: "codex/worker/indeterminate-worker", baseRef: "HEAD" },
    2_000,
    { signal: indeterminateController.signal },
  );
  await tick();
  const indeterminateRequest = writes.at(-1);
  indeterminateController.abort("fixture_cancel_during_failed_commit");
  await tick();
  const indeterminateCancel = writes.at(-1);
  assert.equal(indeterminateCancel.method, "cancelRequest");
  const indeterminateOutcome = mutationOutcome({
    requestId: indeterminateRequest.id,
    method: "provisionGitWorktree",
    commitKind: "git_worktree_add",
    committed: false,
    retainedForInspection: true,
    failureCode: "fixture_commit_failure",
  });
  fakeChild.stdout.write(`${JSON.stringify({
    id: indeterminateRequest.id,
    error: {
      message: "partial mutation may have occurred",
      code: "workspace_backend_mutation_commit_failed_indeterminate",
      backendRequestCompleted: true,
      backendQuiesced: true,
      mutationOutcome: indeterminateOutcome,
    },
  })}\n`);
  await assert.rejects(indeterminatePromise, (error) => {
    assert.equal(error.name, "Error", "an indeterminate mutation must not collapse into AbortError");
    assert.equal(error.code, "workspace_backend_mutation_commit_failed_indeterminate");
    assert.equal(error.backendQuiesced, true);
    assert.equal(error.partialMutationPossible, true);
    assert.deepEqual(error.mutationOutcome, indeterminateOutcome);
    return true;
  });
  assert.equal(transport.pendingRequestCount(), 0);

  const lateCommitWriteStart = writes.length;
  let lateCommitSettled = false;
  const lateCommitPromise = transport.request(
    "provisionGitWorktree",
    { workerKey: "late-commit", branch: "codex/worker/late-commit", baseRef: "HEAD" },
    30,
  ).finally(() => { lateCommitSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(writes[lateCommitWriteStart + 1].method, "cancelRequest");
  assert.equal(lateCommitSettled, false, "mutation timeout retains request ownership until an exact outcome arrives");
  assert.equal(transport.pendingRequestCount(), 1);
  const lateCommitResult = committedMutationResult({
      workerKey: "late-commit",
      retainedAfterCompletion: true,
    }, {
      requestId: writes[lateCommitWriteStart].id,
      method: "provisionGitWorktree",
      commitKind: "git_worktree_add",
      retainedForInspection: true,
    });
  fakeChild.stdout.write(`${JSON.stringify({
    id: writes[lateCommitWriteStart].id,
    result: lateCommitResult,
  })}\n`);
  const lateCommittedMutation = await lateCommitPromise;
  assert.equal(lateCommittedMutation.requestOutcome.committed, true, "a committed mutation result wins after timeout");
  assert.equal(transport.pendingRequestCount(), 0);

  const timeoutWriteStart = writes.length;
  const timeoutPromise = transport.request(
    "runDirectWorkspaceWorkerTest",
    { target: "ordinary_timeout" },
    30,
  );
  let timeoutSettled = false;
  timeoutPromise.finally(() => { timeoutSettled = true; }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(writes.length, timeoutWriteStart + 2, "a timed-out request must issue backend cancellation");
  assert.equal(writes[timeoutWriteStart + 1].method, "cancelRequest");
  assert.equal(timeoutSettled, false, "timeout alone cannot settle an owned backend request");
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
  await assert.rejects(timeoutPromise, (error) => {
    assert.equal(error.code, "workspace_backend_request_timeout");
    assert.equal(error.backendQuiesced, true);
    assert.equal(error.cancellationAcknowledged, true);
    return true;
  });
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
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(transport.pendingRequestCount(), 1);
  assert.equal((await transport.waitForDrain({ timeoutMs: 0 })).status, "timeout");
  transport.dispose();
  await assert.rejects(unacknowledgedPromise, (error) => {
    assert.equal(error.code, "workspace_backend_transport_closed");
    assert.equal(error.backendQuiesced, false);
    assert.equal(error.cancellationAcknowledged, false);
    return true;
  });

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
    parentAuthorityPacket: lifecycleAuthorityPacket,
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

  const indeterminatePool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: (input) => runDirectWorkspaceWorker({
      ...input,
      task: "surface a harness-admitted partial mutation cancellation",
      workspaceProvisioner: async () => {
        await new Promise((resolve) => input.signal.addEventListener("abort", resolve, { once: true }));
        const outcome = mutationOutcome({
          requestId: "pool_backend_request",
          method: "applyWorkspaceWorkerPatch",
          commitKind: "apply_patch_files",
          committed: false,
          retainedForInspection: true,
          failureCode: "fixture_partial_patch_failure",
        });
        const error = new Error("fixture partial mutation");
        error.code = "workspace_backend_mutation_commit_failed_indeterminate";
        error.cancellationAcknowledged = true;
        error.backendQuiesced = true;
        error.mutationOutcome = outcome;
        error.cancellationReceipt = {
          targetRequestId: outcome.requestId,
          acknowledged: true,
          quiesced: true,
          acknowledgementKind: "mutation_commit_failed_indeterminate",
          outcomeDigest: outcome.outcomeDigest,
          rawProcessDetailsIncluded: false,
        };
        throw error;
      },
      providerRequestRunner: async () => { throw new Error("provider must not start"); },
    }),
  });
  const indeterminateLaunch = indeterminatePool.launch({
    projectId: "project_indeterminate_pool",
    primaryThreadId: "primary_indeterminate_pool",
    taskName: "indeterminate_pool_worker",
    message: "retain partial mutation evidence",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_indeterminate_pool" },
  });
  await tick();
  indeterminatePool.interrupt({ target: indeterminateLaunch.childAgentId, reasonCode: "fixture_user_cancel" });
  const indeterminateDone = await indeterminatePool.wait({
    target: indeterminateLaunch.childAgentId,
    timeoutMs: 1_000,
  });
  const indeterminateRecord = indeterminateDone.updates[0];
  assert.equal(indeterminateRecord.state, "failed");
  assert.equal(indeterminateRecord.blockerCode, "workspace_backend_mutation_commit_failed_indeterminate");
  assert.equal(indeterminateRecord.partialMutationPossible, true);
  assert.equal(indeterminateRecord.mutationOutcome.failureCode, "fixture_partial_patch_failure");
  assert.match(indeterminateRecord.mutationOutcome.outcomeDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(indeterminateRecord.cancellation.acknowledged, true);

  const unacknowledgedIndeterminateDbPath = path.join(
    temporaryRoot,
    "unacknowledged-indeterminate.sqlite",
  );
  let unacknowledgedIndeterminateRegistry = new WorkspaceWorkerLifecycleRegistry({
    dbPath: unacknowledgedIndeterminateDbPath,
  });
  const unacknowledgedIndeterminatePool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: unacknowledgedIndeterminateRegistry,
    workspaceWorkerRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return {
        status: "cancelled",
        blockerCode: "direct_workspace_worker_aborted",
        cancellationAcknowledged: false,
        backendQuiesced: true,
        mutationOutcome: mutationOutcome({
          requestId: "pool_backend_unacknowledged_partial",
          method: "applyWorkspaceWorkerPatch",
          commitKind: "apply_patch_files",
          committed: false,
          retainedForInspection: true,
          failureCode: "fixture_unacknowledged_partial_patch",
        }),
      };
    },
  });
  const unacknowledgedIndeterminateLaunch = unacknowledgedIndeterminatePool.launch({
    projectId: "project_unacknowledged_indeterminate",
    primaryThreadId: "primary_unacknowledged_indeterminate",
    taskName: "unacknowledged_indeterminate_worker",
    message: "retain partial evidence and the worker lease",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_unacknowledged_indeterminate" },
  });
  await tick();
  const unacknowledgedIndeterminateBinding = normalizeBinding({
    workerKey: "unacknowledged_indeterminate_worker",
    branchName: "codex/worker/unacknowledged-indeterminate-worker",
    baseCommit: "7".repeat(40),
    headCommit: "7".repeat(40),
    worktreePathDigest: `sha256:${"8".repeat(64)}`,
    sourceRepositoryDigest: `sha256:${"9".repeat(64)}`,
  });
  unacknowledgedIndeterminatePool.beginWorkspaceProvisioning(
    unacknowledgedIndeterminateLaunch.childAgentId,
    {
      workerKey: unacknowledgedIndeterminateBinding.workerKey,
      branchName: unacknowledgedIndeterminateBinding.branchName,
    },
  );
  unacknowledgedIndeterminatePool.bindWorkspaceForChild(
    unacknowledgedIndeterminateLaunch.childAgentId,
    { binding: unacknowledgedIndeterminateBinding },
  );
  unacknowledgedIndeterminatePool.interrupt({
    target: unacknowledgedIndeterminateLaunch.childAgentId,
    reasonCode: "fixture_unacknowledged_partial_cancel",
  });
  await tick();
  const unacknowledgedIndeterminateRecord = unacknowledgedIndeterminatePool.inspect({
    target: unacknowledgedIndeterminateLaunch.childAgentId,
  });
  assert.equal(unacknowledgedIndeterminateRecord.state, "cancellation_unacknowledged");
  assert.equal(unacknowledgedIndeterminateRecord.cancellation.leaseActive, true);
  assert.equal(unacknowledgedIndeterminateRecord.partialMutationPossible, true);
  assert.equal(
    unacknowledgedIndeterminateRecord.mutationOutcome.failureCode,
    "fixture_unacknowledged_partial_patch",
  );
  assert.equal(unacknowledgedIndeterminatePool.descriptor().activeChildren, 1);
  const unacknowledgedIndeterminateSessionId =
    unacknowledgedIndeterminateRecord.workspaceLifecycle.sessionId;
  assert.equal(
    unacknowledgedIndeterminateRegistry.session(unacknowledgedIndeterminateSessionId)
      .mutationOutcome.outcomeDigest,
    unacknowledgedIndeterminateRecord.mutationOutcome.outcomeDigest,
    "unacknowledged cancellation persists mutation evidence before retaining the lease",
  );
  unacknowledgedIndeterminateRegistry.close();
  unacknowledgedIndeterminateRegistry = new WorkspaceWorkerLifecycleRegistry({
    dbPath: unacknowledgedIndeterminateDbPath,
  });
  let restoredUnacknowledgedIndeterminate = unacknowledgedIndeterminateRegistry.session(
    unacknowledgedIndeterminateSessionId,
  );
  assert.deepEqual(
    restoredUnacknowledgedIndeterminate.mutationOutcome,
    unacknowledgedIndeterminateRecord.mutationOutcome,
  );
  const unacknowledgedReconciliationReceipt = buildWorkspaceWorkerReconciliationReceipt({
    sessionId: restoredUnacknowledgedIndeterminate.sessionId,
    expectedRevision: restoredUnacknowledgedIndeterminate.revision,
    outcome: "cancelled",
    reasonCode: "restart_verified_unacknowledged_partial_quiescent",
    providerAcknowledged: true,
    backendQuiesced: true,
    providerAcknowledgementDigest: `sha256:${"a".repeat(64)}`,
    backendQuiescenceDigest: `sha256:${"b".repeat(64)}`,
    verifierId: "workspace_backend_restart_verifier",
    processIdentityRecovered: false,
    bindingRetainedForInspection: true,
  });
  unacknowledgedIndeterminateRegistry.reconcileInterruptedSession(
    unacknowledgedIndeterminateSessionId,
    { receipt: unacknowledgedReconciliationReceipt },
  );
  restoredUnacknowledgedIndeterminate = unacknowledgedIndeterminateRegistry.session(
    unacknowledgedIndeterminateSessionId,
  );
  assert.equal(
    restoredUnacknowledgedIndeterminate.mutationOutcome.outcomeDigest,
    unacknowledgedIndeterminateRecord.mutationOutcome.outcomeDigest,
    "restart reconciliation preserves the prior epistemic mutation receipt",
  );
  const unacknowledgedCleanupObservation = buildWorkspaceWorkerCleanupObservation({
    observationComplete: true,
    workerKey: unacknowledgedIndeterminateBinding.workerKey,
    branchName: unacknowledgedIndeterminateBinding.branchName,
    bindingDigest: unacknowledgedIndeterminateBinding.bindingDigest,
    worktreePathDigest: unacknowledgedIndeterminateBinding.worktreePathDigest,
    worktreeRegistered: true,
    processQuiescent: true,
    activeProcessCount: 0,
    gitStatusReadSucceeded: true,
    statusEntries: [],
    untrackedFileCount: 0,
    headReadSucceeded: true,
    headCommit: unacknowledgedIndeterminateBinding.headCommit,
    uniqueWorkReadSucceeded: true,
    uniqueCommitCount: 0,
    conflictState: false,
    gitOperationInProgress: false,
  });
  const unacknowledgedCleanupPlan = buildWorkspaceWorkerCleanupPlan({
    session: restoredUnacknowledgedIndeterminate,
    observation: unacknowledgedCleanupObservation,
  });
  assert.equal(unacknowledgedCleanupPlan.canRemove, false);
  assert(unacknowledgedCleanupPlan.blockerCodes.includes("cleanup_mutation_outcome_indeterminate"));
  unacknowledgedIndeterminateRegistry.close();

  const forgedPositiveReceiptPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return {
        status: "cancelled",
        blockerCode: "forged_positive_cancellation",
        cancellationAcknowledged: true,
        backendQuiesced: true,
        cancellationReceipt: {
          targetRequestId: "forged",
          acknowledged: false,
          quiesced: false,
          acknowledgementKind: "forged",
        },
      };
    },
  });
  const forgedPositiveReceiptLaunch = forgedPositiveReceiptPool.launch({
    projectId: "project_forged_positive_receipt",
    primaryThreadId: "primary_forged_positive_receipt",
    taskName: "forged_positive_receipt_worker",
    message: "attempt to release capacity with unowned booleans",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_forged_positive_receipt" },
  });
  await tick();
  forgedPositiveReceiptPool.interrupt({ target: forgedPositiveReceiptLaunch.childAgentId });
  await tick();
  const forgedPositiveReceiptRecord = forgedPositiveReceiptPool.inspect({
    target: forgedPositiveReceiptLaunch.childAgentId,
  });
  assert.equal(forgedPositiveReceiptRecord.state, "cancellation_unacknowledged");
  assert.equal(forgedPositiveReceiptRecord.cancellation.leaseActive, true);
  assert.equal(forgedPositiveReceiptPool.descriptor().activeChildren, 1);

  const frozenCancellationController = new AbortController();
  frozenCancellationController.abort("fixture_frozen_cancellation");
  const frozenCancellationResult = await runDirectWorkspaceWorker({
    childAgentId: "child_frozen_cancellation",
    projectId: "project_frozen_cancellation",
    signal: frozenCancellationController.signal,
    task: "verify admitted cancellation immutability",
    workspaceProvisioner: async () => { throw new Error("must not provision"); },
    providerRequestRunner: async () => { throw new Error("must not call provider"); },
  });
  assert.ok(admittedWorkspaceWorkerCancellationReceipt(frozenCancellationResult));
  assert.equal(Object.isFrozen(frozenCancellationResult), true);
  assert.equal(Object.isFrozen(frozenCancellationResult.cancellationReceipt), true);
  assert.throws(
    () => { frozenCancellationResult.cancellationReceipt = { acknowledged: true, quiesced: true }; },
    TypeError,
    "an admitted receipt cannot be substituted after runtime admission",
  );

  const splicedRequestController = new AbortController();
  const splicedMutationOutcome = mutationOutcome({
    requestId: "mutation_request_b",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    committed: false,
    retainedForInspection: true,
    failureCode: "fixture_spliced_request_outcome",
  });
  const splicedRequestResult = await runDirectWorkspaceWorker({
    childAgentId: "child_spliced_request_receipt",
    projectId: "project_spliced_request_receipt",
    signal: splicedRequestController.signal,
    task: "reject a cancellation receipt spliced across backend requests",
    workspaceProvisioner: async () => {
      splicedRequestController.abort("fixture_spliced_request_receipt");
      const error = new Error("fixture spliced request receipt");
      error.code = "workspace_backend_mutation_commit_failed_indeterminate";
      error.cancellationAcknowledged = true;
      error.backendQuiesced = true;
      error.mutationOutcome = splicedMutationOutcome;
      error.cancellationReceipt = {
        targetRequestId: "different_request_a",
        acknowledged: true,
        quiesced: true,
        acknowledgementKind: "mutation_commit_failed_indeterminate",
        outcomeDigest: splicedMutationOutcome.outcomeDigest,
        rawProcessDetailsIncluded: false,
      };
      throw error;
    },
    providerRequestRunner: async () => { throw new Error("provider must not start"); },
  });
  assert.equal(
    admittedWorkspaceWorkerCancellationReceipt(splicedRequestResult),
    null,
    "a cancellation receipt cannot borrow a different backend request's mutation outcome",
  );

  const crossChildReplayPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return frozenCancellationResult;
    },
  });
  const crossChildReplayLaunch = crossChildReplayPool.launch({
    childAgentId: "child_cross_replay_target",
    projectId: "project_frozen_cancellation",
    primaryThreadId: "primary_cross_replay_target",
    taskName: "cross_replay_target",
    message: "reject another child's admitted receipt",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_frozen_cancellation" },
  });
  await tick();
  crossChildReplayPool.interrupt({ target: crossChildReplayLaunch.childAgentId });
  await tick();
  const crossChildReplayRecord = crossChildReplayPool.inspect({
    target: crossChildReplayLaunch.childAgentId,
  });
  assert.equal(crossChildReplayRecord.state, "cancellation_unacknowledged");
  assert.equal(crossChildReplayRecord.cancellation.leaseActive, true);

  const priorLaunchController = new AbortController();
  priorLaunchController.abort("direct_agent_interrupted");
  const priorLaunchResult = await runDirectWorkspaceWorker({
    childAgentId: "child_reused_across_pools",
    projectId: "project_reused_across_pools",
    primaryThreadId: "primary_reused_across_pools",
    workThreadId: "work_reused_across_pools",
    launchDigest: fixtureLaunchDigest("prior_pool_launch"),
    signal: priorLaunchController.signal,
    task: "mint a receipt for an earlier launch",
    workspaceProvisioner: async () => { throw new Error("must not provision"); },
    providerRequestRunner: async () => { throw new Error("must not call provider"); },
  });
  const sameIdentityReplayPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return priorLaunchResult;
    },
  });
  const sameIdentityReplayLaunch = sameIdentityReplayPool.launch({
    childAgentId: "child_reused_across_pools",
    projectId: "project_reused_across_pools",
    primaryThreadId: "primary_reused_across_pools",
    workThreadId: "work_reused_across_pools",
    taskName: "reused_across_pools",
    message: "reject an earlier launch's process-owned receipt",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_reused_across_pools" },
  });
  assert.notEqual(sameIdentityReplayLaunch.launchDigest, priorLaunchResult.cancellationReceipt.launchDigest);
  await tick();
  sameIdentityReplayPool.interrupt({ target: sameIdentityReplayLaunch.childAgentId });
  await tick();
  const sameIdentityReplayRecord = sameIdentityReplayPool.inspect({
    target: sameIdentityReplayLaunch.childAgentId,
  });
  assert.equal(sameIdentityReplayRecord.state, "cancellation_unacknowledged");
  assert.equal(sameIdentityReplayRecord.cancellation.leaseActive, true);
  const projectedCancellationResult = projectAdmittedWorkspaceWorkerResult(
    frozenCancellationResult,
    {
      epistemicCapture: { status: "unavailable", errorCode: "cancelled_before_capture" },
      reducedSummary: { summaryText: "Cancelled before provisioning." },
      captureResult: undefined,
    },
  );
  assert.ok(
    admittedWorkspaceWorkerCancellationReceipt(projectedCancellationResult),
    "the production projection adapter transfers process-owned receipt standing",
  );
  assert.throws(
    () => projectAdmittedWorkspaceWorkerResult(frozenCancellationResult, {
      backendQuiesced: false,
    }),
    (error) => error?.code === "direct_workspace_worker_cancellation_projection_conflict",
  );

  const runtimePatchApplied = deferred();
  const allowRuntimePatchReturn = deferred();
  const runtimeRepositoryPolicy = genericWorkspaceRepositoryProfile();
  const runtimePatchBase = {
    schema: "workspace_apply_patch_result@1",
    mode: "apply",
    status: "applied",
    patchPlanId: "patch_plan_runtime_committed",
    patchTextHash: "runtime_patch_hash",
    files: [],
    totals: { fileCount: 0 },
    rawPathsExposed: false,
  };
  const runtimeCommittedPatch = committedMutationResult(runtimePatchBase, {
    requestId: "runtime_apply_request",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    retainedForInspection: true,
  });
  const runtimeCommittedPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: (input) => runDirectWorkspaceWorker({
      ...input,
      workspaceProvisioner: async () => ({
        binding: {
          schema: "direct_workspace_worker_binding@1",
          bindingId: "workspace_worker_binding_runtime_committed",
          bindingDigest: `sha256:${"4".repeat(64)}`,
          projectId: "project_runtime_committed",
          workerKey: "runtime-committed",
          workspaceKind: "local",
          branch: "codex/worker/runtime-committed",
          baseCommit: "5".repeat(40),
          rootEvidenceDigest: `sha256:${"6".repeat(64)}`,
          sourceRepositoryDigest: `sha256:${"7".repeat(64)}`,
          retainedAfterCompletion: true,
          rawWorkspacePathIncluded: false,
        },
        testProfile: {
          schema: "direct_workspace_worker_test_profile@1",
          available: false,
          repositoryPolicy: runtimeRepositoryPolicy,
          substrateCapabilities: {
            schema: "direct_workspace_worker_substrate_capability@1",
            capabilityProfileId: "runtime_committed_fixture",
            capabilityDigest: `sha256:${"8".repeat(64)}`,
            availableTools: [...WORKSPACE_WORKER_TOOLS],
            rawWorkspacePathIncluded: false,
          },
        },
        nativeRoot: temporaryRoot,
        workspaceRequest: async (method, params) => {
          assert.equal(method, "applyWorkspaceWorkerPatch");
          if (params.mode === "dryRun") {
            return { patchPlanId: runtimePatchBase.patchPlanId };
          }
          runtimePatchApplied.resolve();
          await allowRuntimePatchReturn.promise;
          return runtimeCommittedPatch;
        },
        release: async () => {},
      }),
      providerRequestRunner: async () => ({
        terminal: { state: "tool_waiting", error: null },
        responseId: "runtime_committed_response",
        normalizedEvents: toolWaitingEvents(
          "runtime_committed_response",
          "apply_patch",
          {
            patch: [
              "--- a/runtime.txt",
              "+++ b/runtime.txt",
              "@@ -1 +1 @@",
              "-before",
              "+after",
              "",
            ].join("\n"),
          },
        ),
      }),
    }),
  });
  const runtimeCommittedLaunch = runtimeCommittedPool.launch({
    childAgentId: "child_runtime_committed",
    projectId: "project_runtime_committed",
    primaryThreadId: "primary_runtime_committed",
    taskName: "runtime_committed_worker",
    message: "Apply one patch, then accept cancellation.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_runtime_committed" },
  });
  await runtimePatchApplied.promise;
  runtimeCommittedPool.interrupt({
    target: runtimeCommittedLaunch.childAgentId,
    reasonCode: "fixture_cancel_after_runtime_commit",
  });
  allowRuntimePatchReturn.resolve();
  const runtimeCommittedDone = await runtimeCommittedPool.wait({
    target: runtimeCommittedLaunch.childAgentId,
    timeoutMs: 1_000,
  });
  const runtimeCommittedRecord = runtimeCommittedDone.updates[0];
  assert.equal(runtimeCommittedRecord.state, "cancelled");
  assert.equal(runtimeCommittedRecord.mutationOutcome.committed, true);
  assert.equal(runtimeCommittedRecord.mutationOutcome.method, "applyWorkspaceWorkerPatch");
  assert.equal(runtimeCommittedRecord.cancellation.acknowledged, true);
  assert.equal(runtimeCommittedRecord.partialMutationPossible, false);

  const providerAfterMutationEntered = deferred();
  const providerAfterMutationPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: (input) => runDirectWorkspaceWorker({
      ...input,
      workspaceProvisioner: async () => ({
        binding: {
          schema: "direct_workspace_worker_binding@1",
          bindingId: "workspace_worker_binding_provider_after_mutation",
          bindingDigest: `sha256:${"9".repeat(64)}`,
          projectId: "project_provider_after_mutation",
          workerKey: "provider-after-mutation",
          workspaceKind: "local",
          branch: "codex/worker/provider-after-mutation",
          baseCommit: "a".repeat(40),
          rootEvidenceDigest: `sha256:${"b".repeat(64)}`,
          sourceRepositoryDigest: `sha256:${"c".repeat(64)}`,
          retainedAfterCompletion: true,
          rawWorkspacePathIncluded: false,
        },
        testProfile: {
          schema: "direct_workspace_worker_test_profile@1",
          available: false,
          repositoryPolicy: runtimeRepositoryPolicy,
          substrateCapabilities: {
            schema: "direct_workspace_worker_substrate_capability@1",
            capabilityProfileId: "provider_after_mutation_fixture",
            capabilityDigest: `sha256:${"d".repeat(64)}`,
            availableTools: [...WORKSPACE_WORKER_TOOLS],
            rawWorkspacePathIncluded: false,
          },
        },
        nativeRoot: temporaryRoot,
        workspaceRequest: async (method, params) => {
          assert.equal(method, "applyWorkspaceWorkerPatch");
          return params.mode === "dryRun"
            ? { patchPlanId: runtimePatchBase.patchPlanId }
            : runtimeCommittedPatch;
        },
        release: async () => {},
      }),
      providerRequestRunner: async ({ stepOrdinal, signal }) => {
        if (stepOrdinal === 1) {
          return {
            terminal: { state: "tool_waiting", error: null },
            responseId: "provider_after_mutation_step_1",
            normalizedEvents: toolWaitingEvents(
              "provider_after_mutation_step_1",
              "apply_patch",
              { patch: "--- a/runtime.txt\n+++ b/runtime.txt\n@@ -1 +1 @@\n-before\n+after\n" },
            ),
          };
        }
        providerAfterMutationEntered.resolve();
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        const error = new Error("provider request cancelled");
        error.name = "AbortError";
        error.code = "workspace_backend_request_cancelled";
        error.cancellationAcknowledged = true;
        error.backendQuiesced = true;
        error.cancellationReceipt = {
          targetRequestId: "provider_request_after_mutation",
          acknowledged: true,
          quiesced: true,
          acknowledgementKind: "provider_request_cancelled",
          outcomeDigest: "",
          rawProcessDetailsIncluded: false,
        };
        throw error;
      },
    }),
  });
  const providerAfterMutationLaunch = providerAfterMutationPool.launch({
    childAgentId: "child_provider_after_mutation",
    projectId: "project_provider_after_mutation",
    primaryThreadId: "primary_provider_after_mutation",
    taskName: "provider_after_mutation",
    message: "Cancel the provider request after one committed patch.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_provider_after_mutation" },
  });
  await providerAfterMutationEntered.promise;
  providerAfterMutationPool.interrupt({
    target: providerAfterMutationLaunch.childAgentId,
    reasonCode: "fixture_cancel_provider_after_mutation",
  });
  const providerAfterMutationDone = await providerAfterMutationPool.wait({
    target: providerAfterMutationLaunch.childAgentId,
    timeoutMs: 2_000,
  });
  assert.equal(providerAfterMutationDone.updates[0].state, "cancelled");
  assert.equal(providerAfterMutationDone.updates[0].mutationOutcome.committed, true);
  assert.equal(providerAfterMutationDone.updates[0].cancellation.acknowledged, true);

  const foreignProviderOutcome = mutationOutcome({
    requestId: "foreign_provider_request",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    committed: true,
    retainedForInspection: true,
    resultDigest: `sha256:${"e".repeat(64)}`,
  });
  const hostileProviderEntered = deferred();
  const hostileProviderController = new AbortController();
  const hostileProviderPromise = runDirectWorkspaceWorker({
    childAgentId: "child_hostile_provider_outcome",
    projectId: "project_provider_after_mutation",
    primaryThreadId: "primary_provider_after_mutation",
    workThreadId: "work_thread_provider_after_mutation",
    task: "Keep the real committed workspace outcome canonical.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_provider_after_mutation" },
    signal: hostileProviderController.signal,
    workspaceProvisioner: async () => ({
      binding: {
        schema: "direct_workspace_worker_binding@1",
        bindingId: "workspace_worker_binding_hostile_provider_outcome",
        bindingDigest: `sha256:${"1".repeat(64)}`,
        projectId: "project_provider_after_mutation",
        workerKey: "hostile-provider-outcome",
        workspaceKind: "local",
        branch: "codex/worker/hostile-provider-outcome",
        baseCommit: "2".repeat(40),
        rootEvidenceDigest: `sha256:${"3".repeat(64)}`,
        sourceRepositoryDigest: `sha256:${"4".repeat(64)}`,
        retainedAfterCompletion: true,
        rawWorkspacePathIncluded: false,
      },
      testProfile: {
        schema: "direct_workspace_worker_test_profile@1",
        available: false,
        repositoryPolicy: runtimeRepositoryPolicy,
        substrateCapabilities: {
          schema: "direct_workspace_worker_substrate_capability@1",
          capabilityProfileId: "hostile_provider_outcome_fixture",
          capabilityDigest: `sha256:${"5".repeat(64)}`,
          availableTools: [...WORKSPACE_WORKER_TOOLS],
          rawWorkspacePathIncluded: false,
        },
      },
      nativeRoot: temporaryRoot,
      workspaceRequest: async (method, params) => {
        assert.equal(method, "applyWorkspaceWorkerPatch");
        return params.mode === "dryRun"
          ? { patchPlanId: runtimePatchBase.patchPlanId }
          : runtimeCommittedPatch;
      },
      release: async () => {},
    }),
    providerRequestRunner: async ({ stepOrdinal, signal }) => {
      if (stepOrdinal === 1) {
        return {
          terminal: { state: "tool_waiting", error: null },
          responseId: "hostile_provider_outcome_step_1",
          normalizedEvents: toolWaitingEvents(
            "hostile_provider_outcome_step_1",
            "apply_patch",
            { patch: "--- a/runtime.txt\n+++ b/runtime.txt\n@@ -1 +1 @@\n-before\n+after\n" },
          ),
        };
      }
      hostileProviderEntered.resolve();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      const error = new Error("provider supplied foreign workspace outcome");
      error.name = "AbortError";
      error.code = "workspace_backend_request_cancelled";
      error.cancellationAcknowledged = true;
      error.backendQuiesced = true;
      error.mutationOutcome = foreignProviderOutcome;
      error.cancellationReceipt = {
        targetRequestId: foreignProviderOutcome.requestId,
        acknowledged: true,
        quiesced: true,
        acknowledgementKind: "provider_request_cancelled",
        outcomeDigest: foreignProviderOutcome.outcomeDigest,
        rawProcessDetailsIncluded: false,
      };
      throw error;
    },
  });
  await hostileProviderEntered.promise;
  hostileProviderController.abort("fixture_hostile_provider_outcome");
  const hostileProviderResult = await hostileProviderPromise;
  assert.equal(hostileProviderResult.workspaceExecution.latestMutationOutcome.outcomeDigest, runtimeCommittedPatch.requestOutcome.outcomeDigest);
  assert.equal(hostileProviderResult.mutationOutcome.outcomeDigest, runtimeCommittedPatch.requestOutcome.outcomeDigest);
  assert.equal(hostileProviderResult.cancellationReceipt.targetRequestId, runtimeCommittedPatch.requestOutcome.requestId);
  assert.equal(hostileProviderResult.cancellationReceipt.outcomeDigest, runtimeCommittedPatch.requestOutcome.outcomeDigest);

  const postCommitEvidenceBase = {
    ...runtimePatchBase,
    patchPlanId: "patch_plan_post_commit_evidence_failure",
    files: [{
      displayPath: "api_key=abcdefghijklmnop",
      operation: "update",
      beforeDigest: `sha256:${"6".repeat(64)}`,
      afterDigest: `sha256:${"7".repeat(64)}`,
      addedLineCount: 1,
      removedLineCount: 1,
    }],
  };
  const postCommitEvidenceResult = committedMutationResult(postCommitEvidenceBase, {
    requestId: "post_commit_evidence_request",
    method: "applyWorkspaceWorkerPatch",
    commitKind: "apply_patch_files",
    retainedForInspection: true,
  });
  const postCommitEvidenceFailure = await runDirectWorkspaceWorker({
    childAgentId: "child_post_commit_evidence_failure",
    projectId: "project_provider_after_mutation",
    primaryThreadId: "primary_provider_after_mutation",
    workThreadId: "work_thread_provider_after_mutation",
    task: "Retain mutation custody if provider evidence projection fails after commit.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_provider_after_mutation" },
    workspaceProvisioner: async () => ({
      binding: {
        schema: "direct_workspace_worker_binding@1",
        bindingId: "workspace_worker_binding_post_commit_evidence",
        bindingDigest: `sha256:${"8".repeat(64)}`,
        projectId: "project_provider_after_mutation",
        workerKey: "post-commit-evidence",
        workspaceKind: "local",
        branch: "codex/worker/post-commit-evidence",
        baseCommit: "9".repeat(40),
        rootEvidenceDigest: `sha256:${"a".repeat(64)}`,
        sourceRepositoryDigest: `sha256:${"b".repeat(64)}`,
        retainedAfterCompletion: true,
        rawWorkspacePathIncluded: false,
      },
      testProfile: {
        schema: "direct_workspace_worker_test_profile@1",
        available: false,
        repositoryPolicy: runtimeRepositoryPolicy,
        substrateCapabilities: {
          schema: "direct_workspace_worker_substrate_capability@1",
          capabilityProfileId: "post_commit_evidence_fixture",
          capabilityDigest: `sha256:${"c".repeat(64)}`,
          availableTools: [...WORKSPACE_WORKER_TOOLS],
          rawWorkspacePathIncluded: false,
        },
      },
      nativeRoot: temporaryRoot,
      workspaceRequest: async (method, params) => {
        assert.equal(method, "applyWorkspaceWorkerPatch");
        return params.mode === "dryRun"
          ? { patchPlanId: postCommitEvidenceBase.patchPlanId }
          : postCommitEvidenceResult;
      },
      release: async () => {},
    }),
    providerRequestRunner: async () => ({
      terminal: { state: "tool_waiting", error: null },
      responseId: "post_commit_evidence_step_1",
      normalizedEvents: toolWaitingEvents(
        "post_commit_evidence_step_1",
        "apply_patch",
        { patch: "--- a/runtime.txt\n+++ b/runtime.txt\n@@ -1 +1 @@\n-before\n+after\n" },
      ),
    }),
  });
  assert.equal(postCommitEvidenceFailure.status, "failed");
  assert.equal(postCommitEvidenceFailure.workspaceMutationStarted, true);
  assert.equal(postCommitEvidenceFailure.workspaceExecution.workspaceMutationStarted, true);
  assert.equal(
    postCommitEvidenceFailure.workspaceExecution.latestMutationOutcome.outcomeDigest,
    postCommitEvidenceResult.requestOutcome.outcomeDigest,
  );
  assert.equal(
    postCommitEvidenceFailure.mutationOutcome.outcomeDigest,
    postCommitEvidenceResult.requestOutcome.outcomeDigest,
  );

  const lateProviderEntered = deferred();
  const releaseLateProvider = deferred();
  const lateProviderController = new AbortController();
  let lateProviderWorkspaceCalls = 0;
  const lateProviderPromise = runDirectWorkspaceWorker({
    childAgentId: "child_late_provider_after_cancel",
    projectId: "project_provider_after_mutation",
    primaryThreadId: "primary_provider_after_mutation",
    workThreadId: "work_thread_provider_after_mutation",
    task: "Do not execute a late provider tool request after cancellation.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_provider_after_mutation" },
    signal: lateProviderController.signal,
    workspaceProvisioner: async () => ({
      binding: {
        schema: "direct_workspace_worker_binding@1",
        bindingId: "workspace_worker_binding_late_provider",
        bindingDigest: `sha256:${"d".repeat(64)}`,
        projectId: "project_provider_after_mutation",
        workerKey: "late-provider",
        workspaceKind: "local",
        branch: "codex/worker/late-provider",
        baseCommit: "e".repeat(40),
        rootEvidenceDigest: `sha256:${"f".repeat(64)}`,
        sourceRepositoryDigest: `sha256:${"1".repeat(64)}`,
        retainedAfterCompletion: true,
        rawWorkspacePathIncluded: false,
      },
      testProfile: {
        schema: "direct_workspace_worker_test_profile@1",
        available: false,
        repositoryPolicy: runtimeRepositoryPolicy,
        substrateCapabilities: {
          schema: "direct_workspace_worker_substrate_capability@1",
          capabilityProfileId: "late_provider_fixture",
          capabilityDigest: `sha256:${"2".repeat(64)}`,
          availableTools: [...WORKSPACE_WORKER_TOOLS],
          rawWorkspacePathIncluded: false,
        },
      },
      nativeRoot: temporaryRoot,
      workspaceRequest: async () => {
        lateProviderWorkspaceCalls += 1;
        return runtimeCommittedPatch;
      },
      release: async () => {},
    }),
    providerRequestRunner: async () => {
      lateProviderEntered.resolve();
      await releaseLateProvider.promise;
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId: "late_provider_after_cancel",
        normalizedEvents: toolWaitingEvents(
          "late_provider_after_cancel",
          "apply_patch",
          { patch: "--- a/runtime.txt\n+++ b/runtime.txt\n@@ -1 +1 @@\n-before\n+after\n" },
        ),
      };
    },
  });
  await lateProviderEntered.promise;
  lateProviderController.abort("fixture_late_provider_cancelled");
  releaseLateProvider.resolve();
  const lateProviderResult = await lateProviderPromise;
  assert.equal(lateProviderResult.status, "cancelled");
  assert.equal(lateProviderWorkspaceCalls, 0);
  assert.equal(lateProviderResult.workspaceMutationStarted, false);

  const privateTerminalBlocker = path.join(temporaryRoot, "private-terminal-blocker");
  const terminalBlockerRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const terminalBlockerPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: terminalBlockerRegistry,
    workspaceWorkerRunner: async () => ({
      status: "failed",
      blockerCode: privateTerminalBlocker,
    }),
  });
  const terminalBlockerLaunch = terminalBlockerPool.launch({
    childAgentId: "child_private_terminal_blocker",
    projectId: "project_private_terminal_blocker",
    primaryThreadId: "primary_private_terminal_blocker",
    taskName: "private_terminal_blocker",
    message: "Reject a private path returned as a terminal blocker.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_private_terminal_blocker" },
  });
  const terminalBlockerDone = await terminalBlockerPool.wait({
    target: terminalBlockerLaunch.childAgentId,
    timeoutMs: 1_000,
  });
  assert.equal(terminalBlockerDone.updates[0].state, "failed");
  assert.equal(terminalBlockerDone.updates[0].blockerCode, "direct_agent_child_failed");
  assert.equal(terminalBlockerDone.updates[0].resultSummary, "direct_agent_child_failed");
  assert.equal(
    terminalBlockerRegistry.session(`workspace_worker_session_${terminalBlockerLaunch.childAgentId}`).blockerCode,
    "direct_agent_child_failed",
  );
  assert.doesNotMatch(JSON.stringify(terminalBlockerDone.updates[0]), /private-terminal-blocker/);
  terminalBlockerRegistry.close();

  const terminalStateRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const completedWithBlockerPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: terminalStateRegistry,
    workspaceWorkerRunner: async () => ({
      status: "completed",
      blockerCode: "valid_but_contradictory_blocker",
      outputText: "failure at /home/rose/private/worktree",
      resultDigest: "/home/rose/private/result-digest",
      epistemicCapture: {
        status: "captured",
        errorCode: "/home/rose/private/error",
        receiptDigest: "/home/rose/private/receipt",
        sessionId: "/home/rose/private/session",
        turnId: "/home/rose/private/turn",
      },
      resultEnvelope: { confidence: "/home/rose/private/confidence" },
    }),
  });
  const completedWithBlockerLaunch = completedWithBlockerPool.launch({
    childAgentId: "child_completed_with_blocker",
    projectId: "project_terminal_state_projection",
    primaryThreadId: "primary_terminal_state_projection",
    taskName: "completed_with_blocker",
    message: "Canonicalize contradictory and private terminal evidence.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_terminal_state_projection" },
  });
  const completedWithBlockerDone = (await completedWithBlockerPool.wait({
    target: completedWithBlockerLaunch.childAgentId,
    timeoutMs: 1_000,
  })).updates[0];
  assert.equal(completedWithBlockerDone.state, "completed");
  assert.equal(completedWithBlockerDone.blockerCode, "");
  assert.equal(completedWithBlockerDone.resultSummary, "direct_workspace_worker_completed");
  assert.equal(completedWithBlockerDone.resultSummaryKind, "typed_status_code");
  assert.equal(completedWithBlockerDone.resultDigest, "");
  assert.equal(completedWithBlockerDone.epistemicCaptureComplete, false);
  assert.equal(completedWithBlockerDone.evidenceConfidence, "partial");
  assert.doesNotMatch(JSON.stringify(completedWithBlockerDone), /\/home\/rose\/private/);
  assert.equal(
    terminalStateRegistry.session(`workspace_worker_session_${completedWithBlockerLaunch.childAgentId}`).blockerCode,
    "",
  );

  const timeoutPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: terminalStateRegistry,
    workspaceWorkerRunner: async () => ({ status: "timeout", blockerCode: "valid_timeout" }),
  });
  const timeoutLaunch = timeoutPool.launch({
    childAgentId: "child_timeout_state",
    projectId: "project_timeout_state",
    primaryThreadId: "primary_timeout_state",
    taskName: "timeout_state",
    message: "Keep public and durable timeout settlement coherent.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_timeout_state" },
  });
  const timeoutDone = (await timeoutPool.wait({
    target: timeoutLaunch.childAgentId,
    timeoutMs: 1_000,
  })).updates[0];
  assert.equal(timeoutDone.state, "failed");
  assert.equal(
    terminalStateRegistry.session(`workspace_worker_session_${timeoutLaunch.childAgentId}`).state,
    "failed",
  );
  terminalStateRegistry.close();

  const invalidReasonGate = deferred();
  const invalidReasonPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async () => invalidReasonGate.promise,
  });
  const invalidReasonLaunch = invalidReasonPool.launch({
    projectId: "project_invalid_cancel_reason",
    primaryThreadId: "primary_invalid_cancel_reason",
    taskName: "invalid_cancel_reason",
    message: "Keep running while an invalid reason is rejected.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_invalid_cancel_reason" },
  });
  await tick();
  const invalidReasonInterrupt = invalidReasonPool.interrupt({
    target: invalidReasonLaunch.childAgentId,
    reasonCode: "123 invalid reason",
  });
  assert.equal(invalidReasonInterrupt.status, "blocked");
  assert.equal(invalidReasonInterrupt.blockerCode, "direct_agent_cancellation_reason_invalid");
  assert.equal(invalidReasonPool.inspect({ target: invalidReasonLaunch.childAgentId }).state, "running");
  invalidReasonGate.resolve({ status: "completed", outputText: "invalid reason never entered state" });
  assert.equal((await invalidReasonPool.wait({
    target: invalidReasonLaunch.childAgentId,
    timeoutMs: 1_000,
  })).updates[0].state, "completed");

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
    parentAuthorityPacket: lifecycleAuthorityPacket,
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

  const unresolvedBackendPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async () => ({
      status: "failed",
      blockerCode: "workspace_backend_transport_closed",
      backendOwnershipUnresolved: true,
      cancellationAcknowledged: false,
      backendQuiesced: false,
    }),
  });
  const unresolvedBackendLaunch = unresolvedBackendPool.launch({
    projectId: "project_unresolved_backend",
    primaryThreadId: "primary_unresolved_backend",
    taskName: "unresolved_backend_worker",
    message: "retain capacity until backend quiescence is proved",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_unresolved_backend" },
  });
  await tick();
  const unresolvedBackendRecord = unresolvedBackendPool.inspect({ target: unresolvedBackendLaunch.childAgentId });
  assert.equal(unresolvedBackendRecord.state, "cancellation_unacknowledged");
  assert.equal(unresolvedBackendRecord.cancellation.leaseActive, true);
  assert.equal(unresolvedBackendPool.descriptor().activeChildren, 1, "unresolved backend ownership cannot release worker capacity");

  const privateUnresolvedCode = path.join(temporaryRoot, "private-unresolved-backend");
  const privateUnresolvedPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerRunner: async () => ({
      status: "failed",
      blockerCode: privateUnresolvedCode,
      backendOwnershipUnresolved: true,
      cancellationAcknowledged: false,
      backendQuiesced: false,
    }),
  });
  const privateUnresolvedLaunch = privateUnresolvedPool.launch({
    projectId: "project_private_unresolved_backend",
    primaryThreadId: "primary_private_unresolved_backend",
    taskName: "private_unresolved_backend",
    message: "Do not leak a private backend code while retaining custody.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_private_unresolved_backend" },
  });
  await tick();
  const privateUnresolvedRecord = privateUnresolvedPool.inspect({
    target: privateUnresolvedLaunch.childAgentId,
  });
  assert.equal(
    privateUnresolvedRecord.blockerCode,
    "direct_workspace_worker_cancellation_unacknowledged",
  );
  assert.equal(
    privateUnresolvedRecord.cancellation.reasonCode,
    "direct_workspace_worker_backend_quiescence_unacknowledged",
  );
  assert.equal(JSON.stringify(privateUnresolvedRecord).includes(privateUnresolvedCode), false);

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
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_settlement_failure" },
  });
  await tick();
  const readSettlementSession = settlementRegistry.session.bind(settlementRegistry);
  settlementRegistry.session = () => {
    const error = new Error("fixture registry read failed");
    error.code = "fixture_registry_read_failed";
    throw error;
  };
  settlementGate.resolve({ status: "completed", resultDigest: `sha256:${"6".repeat(64)}` });
  await tick();
  const blockedSettlement = settlementPool.inspect({ target: settlementLaunch.childAgentId });
  assert.equal(blockedSettlement.state, "settlement_blocked");
  assert.equal(blockedSettlement.lifecycleErrorCode, "fixture_registry_read_failed");
  assert.equal(blockedSettlement.cancellation.leaseActive, true);
  settlementRegistry.session = readSettlementSession;
  assert.equal(settlementPool.retrySettlement({ target: settlementLaunch.childAgentId }), true);
  assert.equal(settlementPool.inspect({ target: settlementLaunch.childAgentId }).state, "completed");
  settlementRegistry.close();

  const automaticSettlementRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const automaticSettlementGate = deferred();
  const automaticSettlementPool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    settlementRetryAttempts: 3,
    workspaceWorkerLifecycleRegistry: automaticSettlementRegistry,
    workspaceWorkerRunner: async () => automaticSettlementGate.promise,
  });
  const automaticSettlementLaunch = automaticSettlementPool.launch({
    childAgentId: "child_automatic_settlement_retry",
    projectId: "project_automatic_settlement_retry",
    taskName: "automatic_settlement_retry",
    message: "retry before cancellation",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: { id: "project_automatic_settlement_retry" },
  });
  await tick();
  let transientSettlementFailures = 1;
  const automaticSession = automaticSettlementRegistry.session.bind(automaticSettlementRegistry);
  automaticSettlementRegistry.session = (...args) => {
    if (transientSettlementFailures > 0) {
      transientSettlementFailures -= 1;
      const error = new Error("fixture transient registry read failure");
      error.code = "fixture_transient_registry_failure";
      throw error;
    }
    return automaticSession(...args);
  };
  automaticSettlementGate.resolve({ status: "completed", resultDigest: `sha256:${"7".repeat(64)}` });
  await tick();
  assert.equal(automaticSettlementPool.inspect({ target: automaticSettlementLaunch.childAgentId }).state, "settlement_blocked");
  const automaticSettlementDrain = await automaticSettlementPool.drainAndClose({ timeoutMs: 1_000 });
  assert.equal(automaticSettlementDrain.status, "drained");
  assert.equal(automaticSettlementPool.inspect({ target: automaticSettlementLaunch.childAgentId }).state, "completed");
  automaticSettlementRegistry.close();

  const shutdownPlan = buildWorkspaceWorkerShutdownPlan({ reasonCode: "fixture_shutdown" });
  assert.deepEqual(shutdownPlan.steps.map((step) => step.action), [
    "stop_worker_intake",
    "verify_restart_reconciliation",
    "retry_child_settlement",
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
    verifyRestartReconciliation: async () => { order.push("recovery"); return { status: "clean" }; },
    retryChildSettlement: async () => { order.push("settlement"); return { status: "settled" }; },
    requestChildCancellation: async () => order.push("cancel"),
    awaitChildAcknowledgement: async () => { order.push("child_ack"); return { status: "drained" }; },
    drainWorkspaceBackends: async () => { order.push("backend_drain"); return { status: "drained" }; },
    disposeWorkspaceBackends: async () => order.push("backend_dispose"),
    closeLifecycleRegistry: async () => order.push("registry_close"),
  });
  assert.equal(shutdown.status, "completed");
  assert.deepEqual(order, ["stop", "recovery", "settlement", "cancel", "child_ack", "backend_drain", "backend_dispose", "registry_close"]);

  let unsafeDisposalStarted = false;
  const blockedShutdown = await runWorkspaceWorkerShutdown({
    stopWorkerIntake: async () => {},
    verifyRestartReconciliation: async () => ({ status: "clean" }),
    retryChildSettlement: async () => ({ status: "settled" }),
    requestChildCancellation: async () => {},
    awaitChildAcknowledgement: async () => ({ status: "timeout" }),
    drainWorkspaceBackends: async () => ({ status: "drained" }),
    disposeWorkspaceBackends: async () => { unsafeDisposalStarted = true; },
    closeLifecycleRegistry: async () => {},
  });
  assert.equal(blockedShutdown.status, "blocked");
  assert.equal(unsafeDisposalStarted, false, "backends stay alive until child acknowledgement");

  const intakeBarrierManager = new WorkspaceBackendManager({
    agentPath: path.resolve("src/backend/wsl-agent.js"),
    fallbackRoot: temporaryRoot,
  });
  const ownedBarrierProject = {
    id: "project_backend_drain_barrier",
    repoPath: temporaryRoot,
    workspace: { kind: "local", localPath: temporaryRoot },
  };
  const ownedBarrierSession = intakeBarrierManager.sessionForProject(ownedBarrierProject);
  const barrierDrainGate = deferred();
  ownedBarrierSession.beginDrain = () => { ownedBarrierSession.acceptingRequests = false; };
  ownedBarrierSession.drain = async () => {
    await barrierDrainGate.promise;
    return { status: "drained", blockerCode: "", pendingRequests: 0 };
  };
  ownedBarrierSession.request = async (method) => ({ method });
  const barrierDrain = intakeBarrierManager.drainAll({ timeoutMs: 1_000 });
  assert.throws(
    () => intakeBarrierManager.sessionForProject({
      id: "project_admitted_during_drain",
      repoPath: path.join(temporaryRoot, "late"),
      workspace: { kind: "local", localPath: path.join(temporaryRoot, "late") },
    }),
    /Workspace backend intake is closed/,
    "drain atomically closes new backend-session admission",
  );
  await assert.rejects(
    intakeBarrierManager.requestForProject(ownedBarrierProject, "readFile", {}),
    (error) => error.code === "workspace_backend_manager_intake_closed",
    "ordinary requests are rejected after drain starts",
  );
  assert.equal(
    (await intakeBarrierManager.requestForProject(ownedBarrierProject, "cancelRequest", { requestId: "owned" })).method,
    "cancelRequest",
    "an exact control request for an owned session remains admissible during drain",
  );
  barrierDrainGate.resolve();
  assert.equal((await barrierDrain).status, "drained");
  intakeBarrierManager.disposeAll();

  const privateMissingAgentPath = path.join(
    temporaryRoot,
    "private-native-backend",
    "missing-agent.js",
  );
  const missingAgentManager = new WorkspaceBackendManager({
    agentPath: privateMissingAgentPath,
    fallbackRoot: temporaryRoot,
  });
  const missingAgentProject = {
    id: "project_missing_backend_agent",
    repoPath: temporaryRoot,
    workspace: { kind: "local", localPath: temporaryRoot },
  };
  await assert.rejects(
    missingAgentManager.ensureForProject(missingAgentProject, { workspaceHygiene: false }),
    (error) => {
      assert.equal(error.code, "workspace_backend_agent_missing");
      assert.equal(String(error.message).includes(privateMissingAgentPath), false);
      return true;
    },
  );
  const missingAgentPublicStatus = missingAgentManager.statusForProject(missingAgentProject);
  assert.equal(missingAgentPublicStatus.lastErrorCode, "workspace_backend_agent_missing");
  assert.equal(JSON.stringify(missingAgentPublicStatus).includes(privateMissingAgentPath), false);
  const missingAgentSession = missingAgentManager.sessionForProject(missingAgentProject);
  missingAgentSession.hello = {
    protocolVersion: 1,
    sessionId: "fixture_hello_capabilities",
    projectId: missingAgentProject.id,
    workspaceKind: "local",
    platform: "linux",
    node: process.version,
    capabilities: {
      runCommand: true,
      readFilePreview: true,
      diagnosticRoot: privateMissingAgentPath,
    },
  };
  const boundedHelloCapabilities = missingAgentSession.publicSnapshot().hello.capabilities;
  assert.equal(boundedHelloCapabilities.runCommand, true);
  assert.equal(boundedHelloCapabilities.readFilePreview, true);
  assert.equal(boundedHelloCapabilities.diagnosticRoot, undefined);
  assert.equal(JSON.stringify(boundedHelloCapabilities).includes(privateMissingAgentPath), false);
  missingAgentSession.lastError = { code: privateMissingAgentPath };
  assert.equal(
    missingAgentSession.publicSnapshot().lastErrorCode,
    "workspace_backend_unavailable",
    "a path-bearing private error code cannot cross the public status boundary",
  );
  const pathBearingAgentEvent = missingAgentSession.publicAgentEvent({
    event: "startup-error",
    code: privateMissingAgentPath,
  });
  assert.equal(pathBearingAgentEvent.errorCode, "workspace_backend_event_error");
  assert.equal(JSON.stringify(pathBearingAgentEvent).includes(privateMissingAgentPath), false);
  assert.equal(
    publicBackendErrorCode(privateMissingAgentPath, "workspace_backend_attach_failed"),
    "workspace_backend_attach_failed",
    "attach rejections canonicalize arbitrary private error codes",
  );
  missingAgentManager.disposeAll();

  assert.equal(
    workspaceAttachFailureCode({
      error: { code: "workspace_backend_attach_handshake_timeout" },
      descriptor: { transport: "wsl.exe" },
      readySeen: false,
      recentDiagnostics: [],
    }),
    "workspace_wsl_interop_unavailable",
    "a WSL pre-handshake timeout is classified as host interop unavailability",
  );
  assert.equal(
    workspaceAttachFailureCode({
      error: { code: "workspace_backend_transport_closed" },
      descriptor: { transport: "wsl.exe" },
      readySeen: false,
      recentDiagnostics: [{ type: "stderr", text: "Node.js is required inside the selected WSL distro." }],
    }),
    "workspace_wsl_node_missing",
  );
  assert.deepEqual(
    workspaceBackendRecovery("workspace_wsl_interop_unavailable", "wsl"),
    {
      retryAvailable: true,
      hostActionRequired: true,
      action: "restart_wsl_interop_then_retry",
      automaticResetAllowed: false,
      canonicalHistoryAtRisk: false,
    },
    "WSL recovery remains explicit and never authorizes an automatic host reset",
  );

  const silentChild = new EventEmitter();
  silentChild.stdin = new PassThrough();
  silentChild.stdout = new PassThrough();
  silentChild.stderr = new PassThrough();
  silentChild.exitCode = null;
  silentChild.signalCode = null;
  silentChild.kill = (signal = "SIGTERM") => {
    if (silentChild.exitCode !== null || silentChild.signalCode !== null) return false;
    silentChild.exitCode = 0;
    silentChild.signalCode = signal;
    queueMicrotask(() => silentChild.emit("exit", 0, signal));
    return true;
  };
  const hungAttachManager = new WorkspaceBackendManager({
    agentPath: path.resolve("src/backend/wsl-agent.js"),
    fallbackRoot: temporaryRoot,
    attachTimeoutMs: 250,
    spawnImpl: () => silentChild,
  });
  const hungAttachProject = {
    id: "project_hung_backend_handshake",
    repoPath: temporaryRoot,
    workspace: { kind: "local", localPath: temporaryRoot },
  };
  const hungAttachStartedAt = Date.now();
  await assert.rejects(
    hungAttachManager.ensureForProject(hungAttachProject, { workspaceHygiene: false }),
    (error) => error?.code === "workspace_backend_attach_handshake_timeout",
    "a backend that never speaks must be bounded by an outer attach watchdog",
  );
  assert(Date.now() - hungAttachStartedAt < 2_000, "the attach watchdog must not leave startup pending indefinitely");
  const hungAttachStatus = hungAttachManager.statusForProject(hungAttachProject);
  assert.equal(hungAttachStatus.status, "failed");
  assert.equal(hungAttachStatus.lastErrorCode, "workspace_backend_attach_handshake_timeout");
  assert.equal(hungAttachStatus.recovery.retryAvailable, true);
  assert.equal(hungAttachStatus.recovery.automaticResetAllowed, false);
  hungAttachManager.disposeAll();

  const liveBackendRoot = path.join(temporaryRoot, "live-backend");
  fs.mkdirSync(liveBackendRoot, { recursive: true });
  const lateMarkerPath = path.join(liveBackendRoot, "late-marker.txt");
  const longTestStartedPath = path.join(liveBackendRoot, "long-test-started.txt");
  fs.writeFileSync(path.join(liveBackendRoot, "package.json"), JSON.stringify({
    name: "direct-worker-live-cancellation-fixture",
    private: true,
    scripts: { test: "node long-test.js" },
  }, null, 2));
  fs.writeFileSync(path.join(liveBackendRoot, "late-descendant.js"), [
    'const fs = require("node:fs");',
    `setTimeout(() => fs.writeFileSync(${JSON.stringify(lateMarkerPath)}, "escaped"), 800);`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  fs.writeFileSync(path.join(liveBackendRoot, "long-test.js"), [
    'const fs = require("node:fs");',
    'const { spawn } = require("node:child_process");',
    `fs.writeFileSync(${JSON.stringify(longTestStartedPath)}, "started");`,
    'spawn(process.execPath, ["late-descendant.js"], { detached: true, stdio: "ignore" }).unref();',
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const probeRaceChild = spawn(process.execPath, [
    path.resolve("src/backend/wsl-agent.js"),
    "--root",
    liveBackendRoot,
    "--workspace-kind",
    "local",
    "--project-id",
    "project_containment_probe_race",
  ], {
    cwd: liveBackendRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const probeRaceStdinWrite = probeRaceChild.stdin.write.bind(probeRaceChild.stdin);
  probeRaceChild.stdin.write = (chunk, encoding, callback) => {
    const done = typeof encoding === "function" ? encoding : callback;
    const payload = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8");
    const euroOffset = payload.indexOf(Buffer.from("€", "utf8"));
    if (euroOffset < 0) {
      return typeof encoding === "function"
        ? probeRaceStdinWrite(chunk, encoding)
        : probeRaceStdinWrite(chunk, encoding, callback);
    }
    const splitAt = euroOffset + 1;
    probeRaceStdinWrite(payload.subarray(0, splitAt));
    probeRaceStdinWrite(payload.subarray(splitAt), done);
    return true;
  };
  const probeRaceTransport = new NdjsonTransport(probeRaceChild);
  const firstProbeHello = probeRaceTransport.request("hello", { marker: "€" }, 8_000);
  const firstProbeRequestId = [...probeRaceTransport.pending.values()]
    .find((pending) => pending.method === "hello")?.requestId;
  assert.ok(firstProbeRequestId, "the first containment probe request is addressable for cancellation");
  const firstProbeCancel = await probeRaceTransport.request("cancelRequest", {
    requestId: firstProbeRequestId,
    reasonCode: "fixture_cancel_first_containment_probe_owner",
  }, 8_000);
  assert.equal(firstProbeCancel.acknowledged, true);
  assert.equal(firstProbeCancel.quiesced, true);
  await assert.rejects(firstProbeHello, (error) => error?.workspaceBackendRequest === true);
  const retriedProbeHello = await probeRaceTransport.request("hello", {}, 8_000);
  assert.equal(
    retriedProbeHello.capabilities.runCommand,
    true,
    "cancelling one hello cannot kill or poison the process-owned global containment witness",
  );
  assert.equal(retriedProbeHello.capabilities.provisionGitWorktree, true);
  probeRaceTransport.dispose();
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
  const liveTestProfile = await liveSession.request("directTestProfile", {}, 8_000);
  assert.equal(liveTestProfile.available, true);
  assert.equal(liveTestProfile.substrateCapabilities.processContainmentGuaranteed, true);
  assert.equal(liveTestProfile.substrateCapabilities.processContainmentKind, "linux_pid_namespace");
  const livePublicSnapshot = liveSession.publicSnapshot();
  assert.equal(livePublicSnapshot.rawWorkspacePathIncluded, false);
  assert.equal(livePublicSnapshot.hello.root, undefined);
  assert.equal(livePublicSnapshot.hello.cwd, undefined);
  assert.equal(JSON.stringify(livePublicSnapshot).includes(liveBackendRoot), false);
  const livePublicEvent = liveSession.publicAgentEvent({
    event: "ready",
    root: liveBackendRoot,
    cwd: liveBackendRoot,
    command: `node ${liveBackendRoot}/worker.js`,
  });
  assert.equal(JSON.stringify(livePublicEvent).includes(liveBackendRoot), false);
  const escapedDescendantMarker = path.join(liveBackendRoot, "escaped-descendant-marker.txt");
  const shortLeaderStartedMarker = path.join(liveBackendRoot, "short-leader-started.txt");
  fs.writeFileSync(path.join(liveBackendRoot, "escaped-descendant.js"), [
    'const fs = require("node:fs");',
    `setTimeout(() => fs.writeFileSync(${JSON.stringify(escapedDescendantMarker)}, "escaped"), 750);`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  fs.writeFileSync(path.join(liveBackendRoot, "short-leader.js"), [
    'const fs = require("node:fs");',
    'const { spawn } = require("node:child_process");',
    `fs.writeFileSync(${JSON.stringify(shortLeaderStartedMarker)}, "started");`,
    'spawn(process.execPath, ["escaped-descendant.js"], { detached: true, stdio: "ignore" }).unref();',
  ].join("\n"));
  const shortLeaderResult = await liveSession.request("runDirectCommand", {
    command: process.execPath,
    args: ["short-leader.js"],
    cwdRelPath: "",
    timeoutMs: 5_000,
  }, 8_000);
  assert.equal(shortLeaderResult.exitCode, 0);
  assert.equal(fs.readFileSync(shortLeaderStartedMarker, "utf8"), "started");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(
    fs.existsSync(escapedDescendantMarker),
    false,
    "PID-namespace containment must kill a detached/setsid descendant after its direct leader exits",
  );

  fs.rmSync(shortLeaderStartedMarker, { force: true });
  const legacyLeaderResult = await liveSession.request("runCommand", {
    command: process.execPath,
    args: ["short-leader.js"],
    cwdRelPath: "",
    timeoutMs: 5_000,
  }, 8_000);
  assert.equal(legacyLeaderResult.exitCode, 0);
  assert.equal(fs.readFileSync(shortLeaderStartedMarker, "utf8"), "started");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(
    fs.existsSync(escapedDescendantMarker),
    false,
    "the legacy runCommand route must use the same Linux containment gate",
  );

  await assert.rejects(
    liveSession.request("runCommand", {
      command: process.execPath,
      args: ["-e", "process.stdout.write('o'.repeat(300 * 1024))"],
      cwdRelPath: "",
      timeoutMs: 5_000,
    }, 8_000),
    (error) => error?.code === "workspace_backend_process_output_limit_exceeded",
    "generic process capture must stop and report bounded stdout overflow",
  );

  const shadowDir = path.join(liveBackendRoot, "launcher-shadow");
  const shadowMarker = path.join(liveBackendRoot, "launcher-shadow-invoked.txt");
  fs.mkdirSync(shadowDir);
  fs.writeFileSync(path.join(shadowDir, "unshare"), [
    "#!/bin/sh",
    `printf shadowed > ${JSON.stringify(shadowMarker)}`,
    "exit 99",
    "",
  ].join("\n"));
  fs.chmodSync(path.join(shadowDir, "unshare"), 0o755);
  fs.rmSync(shortLeaderStartedMarker, { force: true });
  const shadowedPathAttempt = await liveSession.request("runDirectCommand", {
    command: process.execPath,
    args: ["short-leader.js"],
    cwdRelPath: "",
    timeoutMs: 5_000,
    env: { PATH: shadowDir, LD_PRELOAD: path.join(shadowDir, "untrusted.so") },
  }, 8_000);
  assert.equal(shadowedPathAttempt.exitCode, 0);
  assert.equal(fs.readFileSync(shortLeaderStartedMarker, "utf8"), "started");
  assert.equal(fs.existsSync(shadowMarker), false, "request environment cannot replace the pinned launcher");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(fs.existsSync(escapedDescendantMarker), false);

  const commitBlocker = path.join(liveBackendRoot, "commit-blocker");
  fs.writeFileSync(commitBlocker, "not a directory");
  await assert.rejects(
    liveSession.request("importFile", {
      relDir: "commit-blocker",
      fileName: "partial.txt",
      contentBase64: Buffer.from("fixture").toString("base64"),
    }, 5_000),
    (error) => {
      assert.equal(error.code, "workspace_backend_mutation_commit_failed_indeterminate");
      assert.equal(error.backendQuiesced, true);
      assert.equal(error.partialMutationPossible, true);
      assert.equal(error.mutationOutcome?.schema, "workspace_backend_mutation_outcome@1");
      assert.equal(error.mutationOutcome?.committed, false);
      assert.equal(error.mutationOutcome?.indeterminate, true);
      assert.equal(error.mutationOutcome?.partialMutationPossible, true);
      assert.match(error.mutationOutcome?.outcomeDigest || "", /^sha256:[a-f0-9]{64}$/);
      return true;
    },
    "a post-commit failure must retain an explicit indeterminate mutation receipt",
  );
  const liveRegistry = new WorkspaceWorkerLifecycleRegistry({ db: new DatabaseSync(":memory:") });
  const livePool = new DirectNativeAgentPool({
    maxActiveChildren: 1,
    workspaceWorkerLifecycleRegistry: liveRegistry,
    workspaceWorkerRunner: (input) => runDirectWorkspaceWorker({
      ...input,
      task: "exercise live backend cancellation through the admitted workspace runtime",
      workspaceProvisioner: async () => {
        await liveSession.request("runDirectCommand", {
          command: process.execPath,
          args: ["long-test.js"],
          cwdRelPath: "",
          timeoutMs: 30_000,
        }, 35_000, { signal: input.signal });
        throw new Error("fixture command unexpectedly completed");
      },
      providerRequestRunner: async () => { throw new Error("provider must not start"); },
    }),
  });
  const liveLaunch = livePool.launch({
    childAgentId: "child_live_backend_cancellation",
    projectId: liveProject.id,
    primaryThreadId: "primary_live_backend_cancellation",
    taskName: "live_backend_cancellation",
    message: "run until cancelled",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    parentAuthorityPacket: lifecycleAuthorityPacket,
    project: liveProject,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(fs.readFileSync(longTestStartedPath, "utf8"), "started");
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
    verifyRestartReconciliation: () => { liveShutdownOrder.push("recovery"); return livePool.recoverySnapshot(); },
    retryChildSettlement: () => { liveShutdownOrder.push("settlement"); return livePool.retryPendingSettlements(); },
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
    "recovery",
    "settlement",
    "cancel",
    "child_ack",
    "backend_drain",
    "backend_dispose",
    "registry_close",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(fs.existsSync(lateMarkerPath), false, "a detached descendant cannot escape cancellation and finish later");

  const mainSource = fs.readFileSync(path.resolve("src/main.js"), "utf8");
  const backendSource = fs.readFileSync(path.resolve("src/backend/wsl-agent.js"), "utf8");
  for (const method of [
    "hello", "listTree", "readFile", "applyPatch", "applyWorkspaceWorkerPatch", "readFileTransfer",
    "repositorySemanticSnapshot", "directEpistemicRepositoryObservation",
    "repositoryRealizationContext", "listMatchingFiles", "resolvePath", "runCommand",
    "runDirectCommand", "provisionGitWorktree", "removeGitWorktree", "initializeWorkspaceWorkerBinding",
    "directTestProfile", "runDirectTest", "inspectWorkspaceRepository", "listWorkspaceRepositoryFiles",
    "matchWorkspaceRepositoryFiles", "searchWorkspaceRepositoryText", "readWorkspaceRepositoryFile",
    "ensureCodexSandboxArtifactIgnored", "watchStatus", "listCodexThreads",
    "readCodexThreadTranscript", "analyzeCodexThread", "stageAttachment",
    "removeAttachmentDraft", "importFile",
  ]) {
    assert.match(backendSource, new RegExp(`\\b${method}: \\"(?:cancellable|two_phase)`));
  }
  assert.match(mainSource, /workspaceWorkerLifecycleRegistry: ensureWorkspaceWorkerLifecycleRegistry\(\)/);
  assert.match(mainSource, /beginWorkspaceProvisioning\(input\.childAgentId/);
  assert.match(mainSource, /provisioning_cancelled_binding_retained/);
  assert.match(mainSource, /return session\.publicSnapshot\(\)/);
  assert.match(
    mainSource,
    /return projectAdmittedWorkspaceWorkerResult\(workspaceResult,/,
    "the production worker adapter preserves runtime admission through its final projection",
  );
  assert.doesNotMatch(mainSource, /type: "backend-status",[\s\S]{0,180}error: error\.message/);
  assert.match(mainSource, /installOrderedWorkspaceWorkerWindowClose\(mainWindow,/);
  assert.doesNotMatch(
    mainSource,
    /\bcloseDirectNativeAgentPool\s*\(/,
    "native pool shutdown remains exclusively owned by the ordered workspace-worker coordinator",
  );
  assert.match(backendSource, /requireProcessContainment: true/);
  assert.match(backendSource, /workspace_windows_job_object_containment_unavailable/);
  assert.match(
    backendSource,
    /function spawnWorkspaceProcess[\s\S]*?return containedWorkspaceProcessSpawn\(command, args, options\);[\s\S]*?\n}/,
    "all backend subprocess routes fail closed through the one proven containment launcher",
  );
  assert.match(
    backendSource,
    /if \(process\.platform !== "win32"\) requestScope\?\.children\.delete\(child\)/,
    "an exited Windows leader retains scope custody until a Job Object receipt can close it",
  );
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf("async function provisionDirectWorkspaceWorker"), mainSource.indexOf("function tokenUsageFromWorkspaceWorkerCapture")),
    /removeGitWorktree/,
    "failed or cancelled provisioning retains the worktree for inspection",
  );
  const rendererSource = fs.readFileSync(path.resolve("src/renderer/app.js"), "utf8");
  assert.doesNotMatch(rendererSource, /status\.lastError\b/, "workspace status consumers use only the safe error code");
  assert.doesNotMatch(rendererSource, /event\.session\.lastError\b/, "backend event consumers cannot expect a private error string");
  assert.doesNotMatch(
    rendererSource,
    /workspaceStatuses\[project\.id\] = \{ status: "failed", lastError:/,
    "renderer fallback retains only a typed public backend error code",
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
