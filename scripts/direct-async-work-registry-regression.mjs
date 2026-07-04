#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ASYNC_META_TOOL_NAMES,
  buildAsyncCondition,
  buildAsyncProgressSignal,
  buildAsyncWakePolicy,
  buildAsyncWorkMetaToolCatalog,
  buildAsyncWorkOutcome,
  buildAsyncWorkRegistration,
  buildAsyncWorkRegistryStore,
  buildAsyncWorkStateTransition,
  buildAsyncWorkStatusSnapshot,
  buildAwaitableWorkContract,
  validateAsyncCondition,
  validateAsyncProgressSignal,
  validateAsyncWakePolicy,
  validateAsyncWorkMetaToolCatalog,
  validateAsyncWorkOutcome,
  validateAsyncWorkRegistration,
  validateAsyncWorkRegistryStore,
  validateAsyncWorkStateTransition,
  validateAsyncWorkStatusSnapshot,
  validateAwaitableWorkContract,
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

const now = () => Date.UTC(2026, 6, 4, 18, 15, 0);

const processTarget = {
  kind: "process",
  id: "pid_4242",
  digest: "sha256:process_4242",
  label: "Long-running npm test process",
};
const doneCondition = buildAsyncCondition({
  conditionId: "condition_process_exit_zero",
  kind: "process_exit_code",
  targetRef: processTarget,
  operator: "equals",
  expected: 0,
  evidenceRequired: true,
}, { now });
validateAsyncCondition(doneCondition);

const traceCountCondition = buildAsyncCondition({
  conditionId: "condition_trace_count_25",
  kind: "file_count_at_least",
  targetRef: {
    kind: "artifact_directory",
    id: "trace_output_dir",
    digest: "sha256:trace_output_dir",
    label: "Trace output directory",
  },
  operator: "gte",
  expected: 25,
  evidenceRequired: true,
}, { now });

const progressSignal = buildAsyncProgressSignal({
  signalId: "signal_test_progress",
  kind: "stdout_pattern",
  targetRef: processTarget,
  summary: "Test runner emitted progress heartbeat.",
  evidenceRefs: [{
    kind: "bounded_stdout_excerpt",
    id: "stdout_excerpt_1",
    digest: "sha256:stdout_excerpt_1",
    label: "Bounded stdout excerpt",
  }],
}, { now });
validateAsyncProgressSignal(progressSignal);

const processContract = buildAwaitableWorkContract({
  contractId: "contract_process_test_run",
  purpose: "Wait for the test process and verify required trace artifacts exist.",
  expectedOutputs: ["exit_code_zero", "trace_artifacts_complete"],
  doneConditions: [doneCondition, traceCountCondition],
  failConditions: [{
    conditionId: "condition_process_exit_nonzero",
    kind: "process_exit_code",
    targetRef: processTarget,
    operator: "not_equals",
    expected: 0,
    evidenceRequired: true,
  }],
  progressSignals: [progressSignal],
  timeoutMs: 120000,
  pollStrategy: "harness_default",
  rawOutputPolicy: "bounded_excerpt",
}, { now });
validateAwaitableWorkContract(processContract);
assert.equal(processContract.harnessOwnsPolling, true);
assert.equal(processContract.modelShouldPollLowLevelTools, false);

const wakePolicy = buildAsyncWakePolicy({
  wakePolicyId: "wake_policy_process_complete",
  wakeOwnerAgent: true,
  wakeThreadManager: true,
  wakeWorldmodelManager: false,
  wakeOn: "completed_or_failed",
  messageShape: "evidence_packet",
}, { now });
validateAsyncWakePolicy(wakePolicy);
assert.equal(wakePolicy.automaticProviderWakeEnabledInThisPr, false);

const processRegistration = buildAsyncWorkRegistration({
  workId: "async_work_process_4242",
  ownerAgentId: "agent_main_worker_async",
  parentTurnId: "turn_async_parent",
  workThreadId: "work_thread_async",
  kind: "process",
  targetRef: {
    pid: 4242,
    artifactRef: processTarget,
  },
  contract: processContract,
  registrationMode: "start_registered_atomically",
  startedByHarness: true,
  status: "registered",
  wakePolicy,
  sourceRefs: [{
    kind: "tool_call",
    id: "tool_call_run_tests",
    digest: "sha256:tool_call_run_tests",
    label: "run_command tool call",
  }],
}, { now });
validateAsyncWorkRegistration(processRegistration);
assert.equal(processRegistration.liveProcessStartedInThisPr, false);

const subAgentRegistration = buildAsyncWorkRegistration({
  workId: "async_work_sub_agent_robie",
  ownerAgentId: "agent_main_worker_async",
  parentTurnId: "turn_async_parent",
  workThreadId: "work_thread_async",
  kind: "sub_agent",
  targetRef: {
    subAgentId: "agent_robie",
    threadId: "direct_sub_agent_thread_robie",
  },
  contract: {
    contractId: "contract_sub_agent_wait",
    purpose: "Wait until the sub-agent reaches a terminal status.",
    expectedOutputs: ["sub_agent_status_terminal"],
    doneConditions: [{
      conditionId: "condition_sub_agent_completed",
      kind: "status_snapshot_field",
      targetRef: {
        kind: "sub_agent_status",
        id: "agent_robie",
        digest: "sha256:agent_robie_status",
        label: "Robie status",
      },
      operator: "equals",
      expected: "completed",
      evidenceRequired: true,
    }],
    pollStrategy: "event_driven",
    rawOutputPolicy: "summary_only",
  },
  registrationMode: "pre_registered",
  status: "waiting",
  wakePolicy: {
    wakeOwnerAgent: false,
    wakeThreadManager: true,
    wakeOn: "completed",
    messageShape: "status_summary",
  },
}, { now });
validateAsyncWorkRegistration(subAgentRegistration);
assert.equal(subAgentRegistration.kind, "sub_agent");

const browserWorkerRegistration = buildAsyncWorkRegistration({
  workId: "async_work_browser_verifier",
  ownerAgentId: "agent_main_worker_async",
  parentTurnId: "turn_async_parent",
  workThreadId: "work_thread_async",
  kind: "browser_worker",
  targetRef: {
    browserSessionId: "browser_session_fixture",
  },
  contract: {
    contractId: "contract_browser_worker",
    purpose: "Wait for browser verifier to return bounded evidence.",
    expectedOutputs: ["browser_verification_evidence_summary"],
    doneConditions: [{
      conditionId: "condition_browser_evidence_packet",
      kind: "artifact_digest_exists",
      targetRef: {
        kind: "browser_evidence_packet",
        id: "browser_packet_fixture",
        digest: "sha256:browser_packet_fixture",
        label: "Browser evidence packet",
      },
      operator: "exists",
      evidenceRequired: true,
    }],
    pollStrategy: "event_driven",
    rawOutputPolicy: "artifact_ref_only",
  },
  registrationMode: "adopted_existing_work",
  adoptionEvidenceRefs: [{
    kind: "plugin_specialist_delegation_packet",
    id: "plugin_specialist_delegation_packet_fixture",
    digest: "sha256:plugin_specialist_delegation_packet_fixture",
    label: "Browser specialist delegation",
  }],
  status: "running",
}, { now });
validateAsyncWorkRegistration(browserWorkerRegistration);

const runningSnapshot = buildAsyncWorkStatusSnapshot({
  snapshotId: "snapshot_process_running",
  workId: processRegistration.workId,
  status: "running",
  progressSummary: "Process is still running; harness owns polling.",
  evidenceRefs: [{
    kind: "heartbeat",
    id: "heartbeat_process_1",
    digest: "sha256:heartbeat_process_1",
    label: "Process heartbeat",
  }],
}, { now });
validateAsyncWorkStatusSnapshot(runningSnapshot);

const completedSnapshot = buildAsyncWorkStatusSnapshot({
  snapshotId: "snapshot_process_completed",
  workId: processRegistration.workId,
  status: "completed",
  progressSummary: "Process exited 0; only 20 of 25 expected traces found.",
  matchedConditionRefs: [doneCondition],
  evidenceRefs: [{
    kind: "bounded_stdout_excerpt",
    id: "stdout_exit_zero",
    digest: "sha256:stdout_exit_zero",
    label: "Exit zero evidence",
  }],
}, { now });
validateAsyncWorkStatusSnapshot(completedSnapshot);

const registeredTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_process_registered",
  workId: processRegistration.workId,
  sequence: 1,
  fromStatus: "unknown",
  toStatus: "registered",
  reason: "registered",
  evidenceRefs: [processRegistration],
}, { now });
validateAsyncWorkStateTransition(registeredTransition);

const runningTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_process_running",
  workId: processRegistration.workId,
  sequence: 2,
  previousTransitionDigest: registeredTransition.transitionDigest,
  fromStatus: "registered",
  toStatus: "running",
  reason: "started",
  snapshotRef: {
    kind: "async_work_status_snapshot",
    id: runningSnapshot.snapshotId,
    digest: runningSnapshot.snapshotDigest,
    label: "Running snapshot",
  },
}, { now });
validateAsyncWorkStateTransition(runningTransition);

const completedTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_process_completed",
  workId: processRegistration.workId,
  sequence: 3,
  previousTransitionDigest: runningTransition.transitionDigest,
  fromStatus: "running",
  toStatus: "completed",
  reason: "done_condition_met",
  snapshotRef: {
    kind: "async_work_status_snapshot",
    id: completedSnapshot.snapshotId,
    digest: completedSnapshot.snapshotDigest,
    label: "Completed snapshot",
  },
}, { now });
validateAsyncWorkStateTransition(completedTransition);

const violatedOutcome = buildAsyncWorkOutcome({
  outcomeId: "outcome_process_contract_violated",
  workId: processRegistration.workId,
  processStatus: "completed",
  contractStatus: "violated",
  closureReportRef: {
    kind: "async_work_closeout",
    id: "closeout_trace_count_violated",
    digest: "sha256:closeout_trace_count_violated",
    label: "Trace count closeout",
  },
  evidenceRefs: [{
    kind: "artifact_count",
    id: "trace_count_20",
    digest: "sha256:trace_count_20",
    label: "20 traces found",
  }],
}, { now });
validateAsyncWorkOutcome(violatedOutcome);
assert.equal(violatedOutcome.processStatus, "completed");
assert.equal(violatedOutcome.contractStatus, "violated");
assert.equal(violatedOutcome.processCompletionDoesNotImplyContractSuccess, true);

const store = buildAsyncWorkRegistryStore({
  storeId: "async_work_registry_store_fixture",
  projectId: "project_async_work",
  workThreadId: "work_thread_async",
  registrations: [processRegistration, subAgentRegistration, browserWorkerRegistration],
  snapshots: [runningSnapshot, completedSnapshot],
  transitions: [runningTransition, completedTransition, registeredTransition],
  outcomes: [violatedOutcome],
}, { now });
validateAsyncWorkRegistryStore(store);
assert.equal(store.appendOnlyTransitions, true);
assert.equal(store.currentStatusByWorkId[processRegistration.workId].currentStatus, "completed");
assert.equal(store.currentStatusByWorkId[processRegistration.workId].terminal, true);
assert.equal(store.currentStatusByWorkId[processRegistration.workId].outcomeRef.processStatus, "completed");
assert.equal(store.currentStatusByWorkId[subAgentRegistration.workId].currentStatus, "waiting");
assert.equal(store.currentStatusByWorkId[browserWorkerRegistration.workId].currentStatus, "running");

const metaTools = buildAsyncWorkMetaToolCatalog({
  catalogId: "async_work_meta_tool_catalog_fixture",
  projectId: "project_async_work",
  workThreadId: "work_thread_async",
}, { now });
validateAsyncWorkMetaToolCatalog(metaTools);
assert.deepEqual(metaTools.tools.map((tool) => tool.toolName).sort(), [...ASYNC_META_TOOL_NAMES].sort());
assert(metaTools.tools.every((tool) => tool.operatesOnRegisteredWorkIdsOnly));
assert(metaTools.tools.every((tool) => tool.liveToolExecutionEnabledInThisPr === false));

expectThrows(() => validateAwaitableWorkContract({
  ...processContract,
  providerWakeEnabledInThisPr: true,
}), "direct_async_work_authority_leak");

expectThrows(() => validateAsyncWakePolicy({
  ...wakePolicy,
  automaticProviderWakeEnabledInThisPr: true,
}), "direct_async_work_authority_leak");

expectThrows(() => validateAsyncWorkRegistration({
  ...processRegistration,
  liveProcessStartedInThisPr: true,
}), "direct_async_work_authority_leak");

expectThrows(() => validateAsyncWorkStatusSnapshot({
  ...completedSnapshot,
  rawOutputIncluded: "yes",
}), "direct_async_work_raw_exposure");

expectThrows(() => validateAsyncWorkOutcome({
  ...violatedOutcome,
  processCompletionDoesNotImplyContractSuccess: false,
}), "direct_async_work_contract_violation");

expectThrows(() => validateAsyncWorkMetaToolCatalog({
  ...metaTools,
  tools: metaTools.tools.map((tool) => tool.toolName === "cancel_async_work"
    ? { ...tool, startsProcessTransport: true }
    : tool),
}), "direct_async_work_authority_leak");

const badFromStatusTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_process_bad_from_status",
  workId: processRegistration.workId,
  sequence: 4,
  previousTransitionDigest: completedTransition.transitionDigest,
  fromStatus: "waiting",
  toStatus: "failed",
  reason: "fail_condition_met",
}, { now });

expectThrows(() => buildAsyncWorkRegistryStore({
  storeId: "async_work_registry_bad_from_status",
  registrations: [processRegistration],
  transitions: [registeredTransition, runningTransition, completedTransition, badFromStatusTransition],
}), "direct_async_work_transition_chain_violation");

const duplicateSequenceTransition = buildAsyncWorkStateTransition({
  transitionId: "transition_process_duplicate_sequence",
  workId: processRegistration.workId,
  sequence: 3,
  previousTransitionDigest: runningTransition.transitionDigest,
  fromStatus: "running",
  toStatus: "failed",
  reason: "fail_condition_met",
}, { now });

expectThrows(() => buildAsyncWorkRegistryStore({
  storeId: "async_work_registry_duplicate_sequence",
  registrations: [processRegistration],
  transitions: [registeredTransition, runningTransition, completedTransition, duplicateSequenceTransition],
}), "direct_async_work_transition_sequence_duplicate");

console.log(JSON.stringify({
  ok: true,
  registrationSchema: processRegistration.schema,
  storeSchema: store.schema,
  processStatus: store.currentStatusByWorkId[processRegistration.workId].currentStatus,
  contractStatus: violatedOutcome.contractStatus,
  metaToolCount: metaTools.tools.length,
}, null, 2));
