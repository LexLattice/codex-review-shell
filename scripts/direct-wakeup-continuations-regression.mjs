#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentSuspensionState,
  buildAgentWakeEvent,
  buildAsyncCondition,
  buildAsyncWakePolicy,
  buildAsyncWorkOutcome,
  buildAsyncWorkRegistration,
  buildAsyncWorkRegistryStore,
  buildAsyncWorkStateTransition,
  buildAsyncWorkStatusSnapshot,
  buildAwaitableWorkContract,
  buildTypedContinuationPacket,
  buildWakeQueue,
  buildWakeupHeadlessGameReport,
  validateAgentSuspensionState,
  validateAgentWakeEvent,
  validateTypedContinuationPacket,
  validateWakeQueue,
  validateWakeupHeadlessGameReport,
} = require("../src/main/direct/worldmodel");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 4, 19, 30, 0);

const processTarget = {
  kind: "process",
  id: "pid_8172",
  digest: "sha256:pid_8172",
  label: "Long-running implementation test process",
};

const exitCondition = buildAsyncCondition({
  conditionId: "condition_process_8172_exit_zero",
  kind: "process_exit_code",
  targetRef: processTarget,
  operator: "equals",
  expected: 0,
}, { now });

const contract = buildAwaitableWorkContract({
  contractId: "contract_async_test_completion",
  purpose: "Wait for test process completion and resume the worker with bounded evidence.",
  expectedOutputs: ["process_exit_zero", "test_summary_artifact"],
  doneConditions: [exitCondition],
  pollStrategy: "harness_default",
  rawOutputPolicy: "bounded_excerpt",
}, { now });

const wakePolicy = buildAsyncWakePolicy({
  wakePolicyId: "wake_policy_async_test_completion",
  wakeOwnerAgent: true,
  wakeThreadManager: true,
  wakeOn: "completed",
  messageShape: "evidence_packet",
}, { now });

const registration = buildAsyncWorkRegistration({
  workId: "async_work_test_process_8172",
  ownerAgentId: "agent_implementer_main",
  parentTurnId: "turn_async_wakeup_parent",
  workThreadId: "work_thread_wakeup",
  kind: "process",
  targetRef: {
    pid: 8172,
    artifactRef: processTarget,
  },
  contract,
  wakePolicy,
  registrationMode: "start_registered_atomically",
  startedByHarness: true,
  status: "registered",
}, { now });

const registeredTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_8172_registered",
  workId: registration.workId,
  sequence: 1,
  fromStatus: "unknown",
  toStatus: "registered",
  reason: "registered",
}, { now });

const runningTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_8172_running",
  workId: registration.workId,
  sequence: 2,
  previousTransitionDigest: registeredTransition.transitionDigest,
  fromStatus: "registered",
  toStatus: "running",
  reason: "started",
}, { now });

const completedSnapshot = buildAsyncWorkStatusSnapshot({
  snapshotId: "snapshot_8172_completed",
  workId: registration.workId,
  status: "completed",
  progressSummary: "Process exited 0 and wrote test summary artifact.",
  matchedConditionRefs: [exitCondition],
  evidenceRefs: [{
    kind: "bounded_stdout_excerpt",
    id: "stdout_8172_exit_zero",
    digest: "sha256:stdout_8172_exit_zero",
    label: "Bounded stdout excerpt",
  }],
}, { now });

const completedTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_8172_completed",
  workId: registration.workId,
  sequence: 3,
  previousTransitionDigest: runningTransition.transitionDigest,
  fromStatus: "running",
  toStatus: "completed",
  reason: "done_condition_met",
  snapshotRef: {
    kind: "async_work_status_snapshot",
    id: completedSnapshot.snapshotId,
    digest: completedSnapshot.snapshotDigest,
    label: "Completed process snapshot",
  },
}, { now });

const outcome = buildAsyncWorkOutcome({
  outcomeId: "outcome_8172_contract_satisfied",
  workId: registration.workId,
  processStatus: "completed",
  contractStatus: "satisfied",
  closureReportRef: {
    kind: "async_work_closeout",
    id: "closeout_8172",
    digest: "sha256:closeout_8172",
    label: "Process closeout",
  },
}, { now });

const registryStore = buildAsyncWorkRegistryStore({
  storeId: "async_registry_wakeup_fixture",
  projectId: "project_wakeup",
  workThreadId: "work_thread_wakeup",
  registrations: [registration],
  snapshots: [completedSnapshot],
  transitions: [registeredTransition, runningTransition, completedTransition],
  outcomes: [outcome],
}, { now });

const suspension = buildAgentSuspensionState({
  suspensionId: "suspension_agent_waits_for_8172",
  agentId: "agent_implementer_main",
  agentRunId: "agent_run_implementation_001",
  reason: "awaiting_async_work",
  awaitingWorkIds: [registration.workId],
  continuationContractRef: {
    kind: "awaitable_work_contract",
    id: contract.contractId,
    digest: contract.contractDigest,
    label: contract.purpose,
  },
  wakePolicyRef: {
    kind: "async_wake_policy",
    id: wakePolicy.wakePolicyId,
    digest: wakePolicy.wakePolicyDigest,
    label: wakePolicy.wakeOn,
  },
  sourceRefs: [registration],
}, { now });
validateAgentSuspensionState(suspension, { registryStore });
assert.equal(suspension.modelAttentionReleased, true);
assert.equal(suspension.modelShouldPollRawWork, false);

const wakeEvent = buildAgentWakeEvent({
  wakeEventId: "wake_event_8172_completed",
  targetAgentId: suspension.agentId,
  targetAgentRunId: suspension.agentRunId,
  sourceSuspensionId: suspension.suspensionId,
  reason: "async_work_completed",
  payloadRef: outcome,
  wakePolicyRef: suspension.wakePolicyRef,
  sourceWorkId: registration.workId,
  consumptionMode: "exactly_once",
  status: "queued",
}, { now });
validateAgentWakeEvent(wakeEvent, { registryStore });
assert.equal(wakeEvent.providerWakeStartedInThisPr, false);
assert.equal(wakeEvent.hiddenProviderSpendAllowed, false);
assert.equal(wakeEvent.payloadRef.id, outcome.outcomeId);

const continuationPacket = buildTypedContinuationPacket({
  packetId: "continuation_8172_completed",
  suspension,
  wakeEvent,
  sourceWorkIds: [registration.workId],
  evidenceRefs: [completedSnapshot, outcome],
  continuationSummary: "Resume the implementer with the completed process status and closeout evidence; do not poll the process directly.",
}, { registryStore });
validateTypedContinuationPacket(continuationPacket, { registryStore });
assert.equal(continuationPacket.registeredEvidenceOnly, true);
assert.equal(continuationPacket.modelShouldPollRawWork, false);

const wakeQueue = buildWakeQueue({
  queueId: "wake_queue_fixture",
  projectId: "project_wakeup",
  workThreadId: "work_thread_wakeup",
  registryStore,
  suspensions: [suspension],
  wakeEvents: [wakeEvent],
  continuationPackets: [continuationPacket],
}, { now });
validateWakeQueue(wakeQueue);
assert.equal(wakeQueue.queuedCount, 1);
assert.equal(wakeQueue.deliveredCount, 0);
assert.equal(wakeQueue.providerWakeEnabledInThisPr, false);
assert.equal(wakeQueue.backgroundAutonomyEnabledInThisPr, false);

const report = buildWakeupHeadlessGameReport({
  reportId: "wakeup_headless_game_fixture",
  gameName: "registered_process_completion_wakes_agent",
  queue: wakeQueue,
  suspensionRef: {
    kind: "agent_suspension_state",
    id: suspension.suspensionId,
    digest: suspension.suspensionDigest,
    label: suspension.reason,
  },
  wakeEventRef: {
    kind: "agent_wake_event",
    id: wakeEvent.wakeEventId,
    digest: wakeEvent.wakeEventDigest,
    label: wakeEvent.reason,
  },
  continuationPacketRef: {
    kind: "typed_continuation_packet",
    id: continuationPacket.packetId,
    digest: continuationPacket.packetDigest,
    label: continuationPacket.resumeReason,
  },
  result: "passed",
}, { now });
validateWakeupHeadlessGameReport(report);
assert.equal(report.provesNoRawPollingLoop, true);
assert.equal(report.provesNoHiddenProviderSpend, true);

expectThrows(() => validateAgentSuspensionState({
  ...suspension,
  modelShouldPollRawWork: true,
}), "direct_wakeup_authority_leak");

expectThrows(() => validateAgentWakeEvent({
  ...wakeEvent,
  hiddenProviderSpendAllowed: true,
}), "direct_wakeup_authority_leak");

expectThrows(() => buildWakeQueue({
  queueId: "wake_queue_duplicate_idempotency",
  registryStore,
  suspensions: [suspension],
  wakeEvents: [wakeEvent, buildAgentWakeEvent({
    wakeEventId: "wake_event_duplicate_key",
    idempotencyKey: wakeEvent.idempotencyKey,
    targetAgentId: suspension.agentId,
    targetAgentRunId: suspension.agentRunId,
    sourceSuspensionId: suspension.suspensionId,
    reason: "async_work_completed",
    payloadRef: outcome,
    wakePolicyRef: suspension.wakePolicyRef,
    sourceWorkId: registration.workId,
  }, { now })],
  continuationPackets: [],
}), "direct_wakeup_duplicate_idempotency_key");

const unregisteredWake = buildAgentWakeEvent({
  wakeEventId: "wake_event_unregistered_work",
  targetAgentId: suspension.agentId,
  targetAgentRunId: suspension.agentRunId,
  sourceSuspensionId: suspension.suspensionId,
  reason: "async_work_completed",
  payloadRef: {
    kind: "async_work_outcome",
    id: "outcome_missing",
    digest: "sha256:outcome_missing",
    label: "Missing outcome",
  },
  wakePolicyRef: suspension.wakePolicyRef,
  sourceWorkId: "async_work_not_registered",
}, { now });

expectThrows(() => validateAgentWakeEvent(unregisteredWake, { registryStore }), "direct_wakeup_unregistered_source_work");

expectThrows(() => buildWakeQueue({
  queueId: "wake_queue_work_not_awaited",
  registeredWorkIds: [registration.workId, "async_work_other_registered"],
  suspensions: [suspension],
  wakeEvents: [buildAgentWakeEvent({
    wakeEventId: "wake_event_other_work",
    targetAgentId: suspension.agentId,
    targetAgentRunId: suspension.agentRunId,
    sourceSuspensionId: suspension.suspensionId,
    reason: "async_work_completed",
    payloadRef: {
      kind: "async_work_outcome",
      id: "outcome_other",
      digest: "sha256:outcome_other",
      label: "Other outcome",
    },
    wakePolicyRef: suspension.wakePolicyRef,
    sourceWorkId: "async_work_other_registered",
  }, { now })],
}), "direct_wakeup_source_work_not_awaited");

const digestOnlyRefSuspension = buildAgentSuspensionState({
  suspensionId: "suspension_digest_only_source_ref",
  agentId: "agent_digest_only",
  agentRunId: "agent_run_digest_only",
  reason: "awaiting_async_work",
  awaitingWorkIds: [registration.workId],
  continuationContractRef: suspension.continuationContractRef,
  sourceRefs: [{
    kind: "digest_only_ref",
    digest: "sha256:digest_only_ref",
    label: "Digest-only ref should be filtered before validation",
  }],
});
validateAgentSuspensionState(digestOnlyRefSuspension, { registryStore });
assert.equal(digestOnlyRefSuspension.sourceRefs.length, 0);

const otherRegisteredWorkId = "async_work_registered_but_not_triggering";
const mismatchedWorkPacket = buildTypedContinuationPacket({
  packetId: "continuation_wrong_work",
  suspension,
  wakeEvent,
  sourceWorkIds: [otherRegisteredWorkId],
  evidenceRefs: [completedSnapshot],
}, { registeredWorkIds: [registration.workId, otherRegisteredWorkId] });

expectThrows(() => buildWakeQueue({
  queueId: "wake_queue_packet_wrong_work",
  registeredWorkIds: [registration.workId, otherRegisteredWorkId],
  suspensions: [suspension],
  wakeEvents: [wakeEvent],
  continuationPackets: [mismatchedWorkPacket],
}), "direct_wakeup_packet_source_work_mismatch");

const otherSuspension = buildAgentSuspensionState({
  suspensionId: "suspension_other_agent_same_work",
  agentId: suspension.agentId,
  agentRunId: suspension.agentRunId,
  reason: "awaiting_async_work",
  awaitingWorkIds: [registration.workId],
  continuationContractRef: suspension.continuationContractRef,
  wakePolicyRef: suspension.wakePolicyRef,
}, { now });

const mismatchedSuspensionPacket = buildTypedContinuationPacket({
  packetId: "continuation_wrong_suspension",
  targetAgentId: suspension.agentId,
  targetAgentRunId: suspension.agentRunId,
  sourceSuspensionRef: {
    kind: "agent_suspension_state",
    id: otherSuspension.suspensionId,
    digest: otherSuspension.suspensionDigest,
    label: otherSuspension.reason,
  },
  wakeEvent,
  sourceWorkIds: [registration.workId],
  evidenceRefs: [completedSnapshot],
}, { registryStore });

expectThrows(() => buildWakeQueue({
  queueId: "wake_queue_packet_wrong_suspension",
  registryStore,
  suspensions: [suspension, otherSuspension],
  wakeEvents: [wakeEvent],
  continuationPackets: [mismatchedSuspensionPacket],
}), "direct_wakeup_packet_suspension_mismatch");

expectThrows(() => validateTypedContinuationPacket({
  ...continuationPacket,
  providerCallStartedInThisPr: true,
}), "direct_wakeup_authority_leak");

expectThrows(() => validateWakeupHeadlessGameReport({
  ...report,
  provesNoHiddenProviderSpend: false,
}), "direct_wakeup_contract_violation");

console.log(JSON.stringify({
  ok: true,
  suspensionSchema: suspension.schema,
  wakeEventSchema: wakeEvent.schema,
  queueSchema: wakeQueue.schema,
  reportSchema: report.schema,
  queuedCount: wakeQueue.queuedCount,
  sourceWorkId: wakeEvent.sourceWorkId,
}, null, 2));
