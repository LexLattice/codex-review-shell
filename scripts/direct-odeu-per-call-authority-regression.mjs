#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA,
  ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA,
  buildOdeuDigest,
  buildOdeuLiveCapabilityTransaction,
  buildOdeuPerCallAuthorityDecision,
  decideFinalAuthority,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuLiveCapabilityTransaction,
  validateOdeuPerCallAuthorityDecision,
} = require("../src/main/direct/odeu");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const fixedNow = () => Date.UTC(2026, 5, 19, 18, 0, 0);

const sourceRef = normalizeOdeuSourceRef({
  sourceRefId: "source_per_call_fixture",
  sourceKind: "tool_call",
  sourceId: "tool_call_fixture",
  sourceConfidence: "fixture",
  freshness: "fresh",
  callId: "call_read_file_fixture",
}, { now: fixedNow });

const argumentDigest = digestCanonicalJson({
  pathEvidenceKey: "workspace_file_ref_fixture",
}, { domain: "per-call-arguments-fixture@1", digestOf: "metadata" });

const allowReadDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_read_fixture",
  callId: "call_read_file_fixture",
  capabilityId: "capability_read_file_fixture",
  scope: {
    projectId: "project_authority_fixture",
    workThreadId: "work_thread_authority_fixture",
    turnId: "turn_authority_fixture",
  },
  activationSnapshotId: "activation_snapshot_read_fixture",
  declarationSnapshotId: "declaration_snapshot_read_fixture",
  activationRowId: "activation_read_file_fixture",
  caller: "resident_model",
  callSurface: "provider_tool_call",
  argumentValidation: {
    state: "valid",
    schemaDigest: buildOdeuDigest({ digestOf: "metadata", unavailableReason: "not_applicable" }),
    argumentsDigest: argumentDigest,
    blockers: [],
  },
  activationDecision: "active",
  policyDecision: "allow",
  approvalRequirement: "none",
  executorState: "ready",
  recoveryState: "not_needed",
  replayPolicy: "idempotent_same_key",
  sideEffectClass: "workspace_read",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(allowReadDecision.schema === ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA, "authority decision schema mismatch");
assert(allowReadDecision.finalDecision === "allow_read_only", "workspace_read should become allow_read_only");
assert(allowReadDecision.scope.projectId === "project_authority_fixture", "authority scope project mismatch");
assert(allowReadDecision.sourceRefs[0].schema === "odeu_source_ref@1", "authority source refs should normalize");
validateOdeuPerCallAuthorityDecision(allowReadDecision);

const readTransaction = buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_read_file_fixture",
  authorityDecision: allowReadDecision,
  lifecycle: "result_recorded",
  replayAllowed: true,
  idempotencyKey: "idem_read_file_fixture",
  recoveryClassifierId: "recovery_not_needed_fixture",
  startedAt: "2026-06-19T18:00:01.000Z",
  completedAt: "2026-06-19T18:00:02.000Z",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(readTransaction.schema === ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA, "transaction schema mismatch");
assert(readTransaction.authorityDecisionId === allowReadDecision.authorityDecisionId, "transaction should cite authority decision");
assert(readTransaction.lifecycle === "result_recorded", "transaction lifecycle mismatch");
assert(readTransaction.replayAllowed === true, "idempotent same-key transaction should allow replay");
validateOdeuLiveCapabilityTransaction(readTransaction, { authorityDecision: allowReadDecision });

const allowWriteDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_write_fixture",
  callId: "call_write_fixture",
  capabilityId: "capability_write_fixture",
  scope: {
    projectId: "project_authority_fixture",
    workThreadId: "work_thread_authority_fixture",
  },
  caller: "headless_route",
  callSurface: "headless_command",
  argumentValidation: { state: "valid", blockers: [] },
  activationDecision: "active",
  policyDecision: "allow",
  executorState: "ready",
  recoveryState: "retryable",
  replayPolicy: "manual_only",
  sideEffectClass: "workspace_write",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(allowWriteDecision.finalDecision === "allow_execute", "workspace_write should become allow_execute");

const blockedDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_blocked_fixture",
  callId: "call_blocked_fixture",
  capabilityId: "capability_write_fixture",
  scope: {
    projectId: "project_authority_fixture",
    workThreadId: "work_thread_authority_fixture",
  },
  caller: "resident_model",
  callSurface: "provider_tool_call",
  argumentValidation: {
    state: "invalid",
    blockers: ["path_outside_workspace"],
  },
  activationDecision: "active",
  policyDecision: "allow",
  executorState: "ready",
  recoveryState: "not_retryable",
  replayPolicy: "never",
  sideEffectClass: "workspace_write",
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(blockedDecision.finalDecision === "block", "invalid arguments should block per-call authority");
const blockedTransaction = buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_blocked_fixture",
  authorityDecision: blockedDecision,
  lifecycle: "authority_blocked",
  replayAllowed: true,
  idempotencyKey: "idem_blocked_fixture",
}, { now: fixedNow });

assert(blockedTransaction.lifecycle === "authority_blocked", "blocked decision should create blocked transaction");
assert(blockedTransaction.replayAllowed === false, "non-idempotent replay policy must force replayAllowed false");

const needsHumanDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_human_fixture",
  callId: "call_human_fixture",
  capabilityId: "capability_external_action_fixture",
  scope: {
    projectId: "project_authority_fixture",
    workThreadId: "work_thread_authority_fixture",
  },
  caller: "resident_model",
  callSurface: "provider_tool_call",
  argumentValidation: { state: "valid", blockers: [] },
  activationDecision: "active",
  policyDecision: "needs_human",
  approvalRequirement: "operator_confirm",
  executorState: "ready",
  recoveryState: "handoff_unknown",
  replayPolicy: "manual_only",
  sideEffectClass: "external_action",
}, { now: fixedNow });

assert(needsHumanDecision.finalDecision === "needs_human", "needs_human policy should be terminal authority state");
const waitingTransaction = buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_human_fixture",
  authorityDecision: needsHumanDecision,
}, { now: fixedNow });
assert(waitingTransaction.lifecycle === "waiting_for_human", "needs_human should infer waiting lifecycle");

const suspendedDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_suspended_fixture",
  callId: "call_suspended_fixture",
  capabilityId: "capability_write_fixture",
  scope: {
    projectId: "project_authority_fixture",
    workThreadId: "work_thread_authority_fixture",
  },
  caller: "resident_model",
  callSurface: "provider_tool_call",
  argumentValidation: { state: "valid", blockers: [] },
  activationDecision: "suspended",
  policyDecision: "allow",
  executorState: "ready",
  recoveryState: "not_retryable",
  replayPolicy: "never",
  sideEffectClass: "workspace_write",
}, { now: fixedNow });
assert(suspendedDecision.finalDecision === "block", "suspended activation must not allow execution");

assert(decideFinalAuthority(null) === "block", "null authority basis should fail closed");
assert(decideFinalAuthority({
  argumentValidation: { state: "valid", blockers: [] },
  activationDecision: "active",
  policyDecision: "allow",
  executorState: "ready",
}) === "allow_read_only", "missing sideEffectClass should default to read-only");

const noDigestDecision = buildOdeuPerCallAuthorityDecision({
  authorityDecisionId: "authority_decision_no_digest_fixture",
  callId: "call_no_digest_fixture",
  capabilityId: "capability_no_digest_fixture",
  scope: {
    projectId: "project_authority_fixture",
  },
  argumentValidation: {
    state: "valid",
    schemaDigest: null,
    argumentsDigest: [],
    blockers: [],
  },
  activationDecision: "active",
  policyDecision: "allow",
  executorState: "ready",
  sideEffectClass: "workspace_read",
}, { now: fixedNow });
assert(noDigestDecision.finalDecision === "allow_read_only", "non-object digests should be ignored safely");

expectThrows(() => buildOdeuPerCallAuthorityDecision({
  ...allowReadDecision,
  authorityDecisionId: "authority_decision_bad_final_fixture",
  finalDecision: "allow_execute",
}), "final_decision_mismatch:allow_read_only");

expectThrows(() => buildOdeuPerCallAuthorityDecision({
  ...needsHumanDecision,
  authorityDecisionId: "authority_decision_missing_approval_fixture",
  approvalRequirement: "none",
}), "needs_human_requires_approval_requirement");

expectThrows(() => buildOdeuPerCallAuthorityDecision({
  ...needsHumanDecision,
  authorityDecisionId: "authority_decision_omitted_approval_fixture",
  approvalRequirement: undefined,
}), "needs_human_requires_approval_requirement");

expectThrows(() => buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_illegal_executor_fixture",
  authorityDecision: blockedDecision,
  lifecycle: "executor_started",
}), "executor_lifecycle_requires_allowing_authority_decision");

expectThrows(() => buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_mismatched_call_fixture",
  authorityDecision: allowReadDecision,
  callId: "call_different_fixture",
}), "authority_call_id_mismatch");

expectThrows(() => buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_mismatched_capability_fixture",
  authorityDecision: allowReadDecision,
  capabilityId: "capability_different_fixture",
}), "authority_capability_id_mismatch");

expectThrows(() => buildOdeuLiveCapabilityTransaction({
  transactionId: "transaction_mismatched_side_effect_fixture",
  authorityDecision: allowReadDecision,
  sideEffectClass: "workspace_write",
}), "authority_side_effect_class_mismatch");

expectThrows(() => validateOdeuLiveCapabilityTransaction({
  ...readTransaction,
  replayAllowed: true,
  idempotencyKey: "",
}, { authorityDecision: allowReadDecision }), "replay_allowed_requires_idempotency_key");

expectThrows(() => validateOdeuPerCallAuthorityDecision({
  ...allowReadDecision,
  argumentValidation: {
    state: "valid",
    blockers: ["should_not_exist"],
  },
}), "valid_arguments_cannot_have_blockers");

expectThrows(() => validateOdeuPerCallAuthorityDecision(null), "missing_required_object:decision");
expectThrows(() => validateOdeuLiveCapabilityTransaction(null), "missing_required_object:transaction");

const report = {
  schema: "direct_odeu_per_call_authority_regression@1",
  checks: {
    perCallAuthorityDecision: true,
    liveCapabilityTransaction: true,
    readOnlyDecision: true,
    writeDecision: true,
    blockedDecision: true,
    humanApprovalDecision: true,
    idempotencyReplay: true,
    validationFailures: true,
  },
  authorityIds: {
    allowReadDecisionId: allowReadDecision.authorityDecisionId,
    allowWriteDecisionId: allowWriteDecision.authorityDecisionId,
    blockedDecisionId: blockedDecision.authorityDecisionId,
    needsHumanDecisionId: needsHumanDecision.authorityDecisionId,
    transactionId: readTransaction.transactionId,
  },
  sentinelCounters: {
    executorCalls: 0,
    workspaceMutations: 0,
    providerTransportCalls: 0,
    humanApprovalMutations: 0,
    contextAdmissionRows: 0,
    providerResultSends: 0,
  },
};

for (const [name, value] of Object.entries(report.sentinelCounters)) {
  assert(value === 0, `${name} should remain zero`);
}

console.log(JSON.stringify(report, null, 2));
