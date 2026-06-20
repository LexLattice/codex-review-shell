#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildRequestPermissionsResultEnvelope,
} = require("../src/main/direct/headless/first-tool-slice");
const {
  PERMISSION_WIDENING_DECISION_SCHEMA,
  PERMISSION_WIDENING_REQUEST_SCHEMA,
  buildPermissionWideningDecision,
  buildPermissionWideningRequest,
} = require("../src/main/direct/tools/control-perception-decision-substrate");

function activationRow(toolName, toolClassId, requestShapeFamily) {
  return {
    schema: "direct_tool_activation_row@1",
    activationRowId: `${toolName}_activation`,
    toolClassId,
    toolName,
    toolSchemaVersion: "direct_tool_class@1",
    state: "active",
    activationEffect: "allow",
    scope: { kind: "project_default", projectId: "project_permission_fixture" },
    promotionDecisionRef: {
      decisionId: `${toolName}_decision`,
      decisionDigest: `${toolName}_decision_digest`,
      decisionState: "promotable",
      evidenceClass: "real_provider_full_loop",
    },
    providerRequestShapeSupport: {
      requestShapeFamily,
      providerProfileId: "permission_fixture_provider",
      modelId: "gpt-fixture",
      declarationEligibleByRegistry: true,
    },
    localExecutorState: { authorityFamily: "human_decision" },
    authorityEnvelope: { authorityEnvelopeVersion: "authority_envelope@1" },
    recoveryReplayClassifier: { classifierId: "direct_recovery_replay_classifier@1" },
    contextResultEnvelopePolicy: { resultEnvelopeVersion: "tool_result_envelope@1" },
    blockerCodes: [],
    rowDigest: `${toolName}_activation_digest`,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
}

const singleActionRequest = buildPermissionWideningRequest({
  projectId: "project_permission_fixture",
  workThreadId: "work_thread_permission_fixture",
  threadId: "thread_permission_fixture",
  turnId: "turn_permission_fixture",
  sourceCallId: "call_request_permissions",
  targetCapability: "exec_command",
  proposedCallId: "proposed_call_1",
  scope: "single_action",
  reason: "Need one npm test run.",
  nowMs: 0,
});
assert.equal(singleActionRequest.schema, PERMISSION_WIDENING_REQUEST_SCHEMA, "request schema mismatch");
assert.equal(singleActionRequest.status, "operator_confirmation_required", "single-action request should require operator confirmation");
assert.equal(singleActionRequest.requiresOperatorConfirmation, true, "operator confirmation should be required");
assert.equal(singleActionRequest.decisionRequiredBeforeGrant, true, "separate decision should be required");
assert.equal(singleActionRequest.authorityGranted, false, "request must not grant authority");
assert.equal(singleActionRequest.grantsAuthority, false, "request must not become grant");
assert.equal(singleActionRequest.mayStartProviderTurn, false, "request must not start provider turn");
assert.equal(singleActionRequest.blockerCodes.length, 0, "valid single-action request should not have blockers");

const confirmRequiredDecision = buildPermissionWideningDecision({
  requestId: singleActionRequest.requestId,
  decisionState: "operator_confirm_required",
  nowMs: 0,
});
assert.equal(confirmRequiredDecision.schema, PERMISSION_WIDENING_DECISION_SCHEMA, "decision schema mismatch");
assert.equal(confirmRequiredDecision.grantState, "not_granted", "decision scaffold should not grant authority");
assert.equal(confirmRequiredDecision.authorityGranted, false, "decision scaffold must not grant authority");
assert.equal(confirmRequiredDecision.grantApplied, false, "decision scaffold must not apply grant");

const broadRequest = buildPermissionWideningRequest({
  targetCapability: "exec_command",
  proposedCallId: "proposed_call_2",
  scope: "project",
  nowMs: 0,
});
assert.equal(broadRequest.status, "blocked", "project-scope request should be blocked");
assert(broadRequest.blockerCodes.includes("permission_widening_scope_blocked:project"), "project scope blocker should be explicit");
assert.equal(broadRequest.requiresOperatorConfirmation, false, "blocked broad request should not ask operator to confirm");

const malformedRequest = buildPermissionWideningRequest({
  scope: "single_action",
  nowMs: 0,
});
assert.equal(malformedRequest.status, "blocked", "missing target/call request should be blocked");
assert(malformedRequest.blockerCodes.includes("permission_widening_missing_target_capability"), "missing target blocker should be explicit");
assert(malformedRequest.blockerCodes.includes("permission_widening_missing_proposed_call_id"), "missing proposed call blocker should be explicit");

const unsupportedScopeRequest = buildPermissionWideningRequest({
  targetCapability: "exec_command",
  proposedCallId: "proposed_call_unsupported",
  scope: "global",
  nowMs: 0,
});
assert.equal(unsupportedScopeRequest.status, "blocked", "unsupported scope should be blocked");
assert(unsupportedScopeRequest.blockerCodes.includes("permission_widening_scope_blocked:unsupported"), "unsupported scope blocker should be explicit");

const slice = buildDirectFirstToolSlice({
  activationRegistry: {
    schema: "direct_tool_activation_registry@1",
    registryId: "permission_activation_registry",
    registryDigest: "permission_activation_registry_digest",
    status: "passed",
    validationErrors: [],
    snapshot: { snapshotId: "permission_snapshot" },
    rows: [
      activationRow("request_permissions", "human_decision.request_permissions", "permission_widening_request@1"),
    ],
  },
  nowMs: 0,
});
assert.deepEqual(slice.summary.declaredToolNames, ["request_permissions"], "request_permissions should be declared from active row");
assert.equal(slice.summary.requestPermissionsDeclared, true, "slice summary should expose request_permissions declaration");

const gate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_permission",
    callId: "call_permission",
    name: "request_permissions",
    arguments: JSON.stringify({
      targetCapability: "exec_command",
      proposedCallId: "proposed_call_3",
      scope: "single_action",
      reason: "Need one command.",
    }),
  },
});
assert.equal(gate.status, "accepted", "single-action request_permissions call should pass declaration gate");

const envelope = buildRequestPermissionsResultEnvelope({
  gate,
  projectId: "project_permission_fixture",
  workThreadId: "work_thread_permission_fixture",
  threadId: "thread_permission_fixture",
  turnId: "turn_permission_fixture",
  nowMs: 0,
});
assert.equal(envelope.schema, "direct_first_tool_result_envelope@1", "result envelope schema mismatch");
assert.equal(envelope.status, "operator_confirmation_required", "valid request should require operator confirmation");
assert.equal(envelope.resultKind, "permission_widening_request", "result kind mismatch");
assert.equal(envelope.providerOutput.kind, "request_permissions_result", "provider output kind mismatch");
assert.equal(envelope.providerOutput.authorityGranted, false, "provider output must not grant authority");
assert.equal(envelope.providerOutput.permissionGranted, false, "provider output must not grant permission");
assert.equal(envelope.providerOutput.mayStartProviderTurn, false, "provider output must not start provider turn");
assert.equal(envelope.permissionRequest.targetCapability, "exec_command", "target capability should be preserved");
assert.equal(envelope.permissionRequest.proposedCallId, "proposed_call_3", "proposed call id should be preserved");
assert.equal(envelope.permissionDecision.decisionState, "operator_confirm_required", "decision should require operator confirmation");
assert.equal(envelope.contextAdmission.admissionState, "operator_confirmation_required", "context admission should carry request status");

const broadGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_permission_broad",
    callId: "call_permission_broad",
    name: "request_permissions",
    arguments: JSON.stringify({
      targetCapability: "exec_command",
      proposedCallId: "proposed_call_4",
      scope: "session",
      reason: "Need all future commands.",
    }),
  },
});
assert.equal(broadGate.status, "accepted", "broad request reaches result gate so it can return deterministic blocker");
const broadEnvelope = buildRequestPermissionsResultEnvelope({
  gate: broadGate,
  projectId: "project_permission_fixture",
  workThreadId: "work_thread_permission_fixture",
  threadId: "thread_permission_fixture",
  turnId: "turn_permission_fixture",
  nowMs: 0,
});
assert.equal(broadEnvelope.status, "blocked", "session-scope widening should be blocked");
assert(broadEnvelope.blockerCodes.includes("permission_widening_scope_blocked:session"), "session scope blocker should be explicit");
assert.equal(broadEnvelope.providerOutput.authorityGranted, false, "blocked broad request must not grant authority");
assert.equal(broadEnvelope.permissionDecision.decisionState, "denied", "blocked request should produce denied decision scaffold");

const unsupportedScopeGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_permission_unsupported",
    callId: "call_permission_unsupported",
    name: "request_permissions",
    arguments: JSON.stringify({
      targetCapability: "exec_command",
      proposedCallId: "proposed_call_unsupported_gate",
      scope: "global",
      reason: "Unsupported scope.",
    }),
  },
});
const unsupportedScopeEnvelope = buildRequestPermissionsResultEnvelope({
  gate: unsupportedScopeGate,
  projectId: "project_permission_fixture",
  workThreadId: "work_thread_permission_fixture",
  threadId: "thread_permission_fixture",
  turnId: "turn_permission_fixture",
  nowMs: 0,
});
assert.equal(unsupportedScopeEnvelope.status, "blocked", "unsupported scope envelope should be blocked");
assert(unsupportedScopeEnvelope.blockerCodes.includes("permission_widening_scope_blocked:unsupported"), "unsupported scope envelope blocker should be explicit");

const missingTargetGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_permission_missing",
    callId: "call_permission_missing",
    name: "request_permissions",
    arguments: JSON.stringify({
      scope: "single_action",
      reason: "Missing target.",
    }),
  },
});
const missingTargetEnvelope = buildRequestPermissionsResultEnvelope({
  gate: missingTargetGate,
  projectId: "project_permission_fixture",
  workThreadId: "work_thread_permission_fixture",
  threadId: "thread_permission_fixture",
  turnId: "turn_permission_fixture",
  nowMs: 0,
});
assert.equal(missingTargetEnvelope.status, "blocked", "missing target/call request should be blocked");
assert(missingTargetEnvelope.blockerCodes.includes("permission_widening_missing_target_capability"), "missing target blocker should be returned");
assert(missingTargetEnvelope.blockerCodes.includes("permission_widening_missing_proposed_call_id"), "missing call blocker should be returned");
assert.equal(missingTargetEnvelope.providerOutput.permissionGranted, false, "malformed request must not grant permission");

console.log(JSON.stringify({
  ok: true,
  requestId: singleActionRequest.requestId,
  declaredToolNames: slice.summary.declaredToolNames,
  envelopeStatus: envelope.status,
  broadEnvelopeStatus: broadEnvelope.status,
}, null, 2));
