#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildContextRemainingWitness,
  buildPlanProjectionMutationEnvelope,
  buildPlanProjectionStore,
} = require("../src/main/direct/tools/control-perception-decision-substrate");
const {
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildContextRemainingResultEnvelope,
  buildUpdatePlanResultEnvelope,
} = require("../src/main/direct/headless/first-tool-slice");

function activationRow(toolName, toolClassId, requestShapeFamily) {
  return {
    schema: "direct_tool_activation_row@1",
    activationRowId: `${toolName}_activation`,
    toolClassId,
    toolName,
    toolSchemaVersion: "direct_tool_class@1",
    state: "active",
    activationEffect: "allow",
    scope: { kind: "project_default", projectId: "project_context_plan_fixture" },
    promotionDecisionRef: {
      decisionId: `${toolName}_decision`,
      decisionDigest: `${toolName}_decision_digest`,
      decisionState: "promotable",
      evidenceClass: "real_provider_full_loop",
    },
    providerRequestShapeSupport: {
      requestShapeFamily,
      providerProfileId: "context_plan_provider",
      modelId: "gpt-fixture",
      declarationEligibleByRegistry: true,
    },
    localExecutorState: { authorityFamily: "session_control" },
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

const contextWitness = buildContextRemainingWitness({
  projectId: "project_context_plan_fixture",
  workThreadId: "work_thread_context_plan_fixture",
  threadId: "thread_context_plan_fixture",
  model: "gpt-fixture",
  contextWindow: 100000,
  usedTokens: 25000,
  remainingTokens: 75000,
  usableFor: "request_blocking",
  estimateKind: "provider_reported",
  confidence: "exact",
  evidenceRefs: [{ kind: "provider_usage_snapshot", refId: "usage_snapshot_1" }],
  observedAt: "1970-01-01T00:00:00.000Z",
  staleAfterMs: 1000,
  nowMs: 2001,
});
assert.equal(contextWitness.usableFor, "display_only", "request_blocking must be normalized out of resident context witness");
assert.equal(contextWitness.freshness, "stale", "expired witness should be stale");
assert.equal(contextWitness.pressurePercent, 25, "pressure percent should derive from used/window");
assert.equal(contextWitness.permissionToContinue, false, "context witness must not authorize continuation");
assert.equal(contextWitness.compactionAuthority, false, "context witness must not authorize compaction");

const acceptedPlan = buildPlanProjectionMutationEnvelope({
  projectId: "project_context_plan_fixture",
  workThreadId: "work_thread_context_plan_fixture",
  threadId: "thread_context_plan_fixture",
  planId: "plan_context_fixture",
  mutationKind: "replace_plan",
  steps: [{ stepId: "step_1", text: "Keep projection scoped", status: "completed" }],
  nowMs: 0,
});
assert.equal(acceptedPlan.schema, "plan_projection_mutation_envelope@1", "plan envelope schema mismatch");
assert.equal(acceptedPlan.mutationKind, "replace_plan", "valid resident plan update should be accepted");
assert.equal(acceptedPlan.afterPlan.steps[0].status, "completed_in_plan", "completion must remain plan-level");
assert.equal(acceptedPlan.mutatesWorkThreadTruth, false, "plan update must not mutate WorkThread truth");
assert.equal(acceptedPlan.provesCompletion, false, "plan update must not prove objective completion");

const blockedOperatorPlan = buildPlanProjectionMutationEnvelope({
  projectId: "project_context_plan_fixture",
  workThreadId: "work_thread_context_plan_fixture",
  threadId: "thread_context_plan_fixture",
  planId: "operator_plan_context_fixture",
  actorKind: "resident_model",
  planOwner: "operator",
  planAuthority: "operator_plan",
  steps: [{ text: "Overwrite human plan" }],
  nowMs: 0,
});
assert.equal(blockedOperatorPlan.mutationKind, "blocked", "resident must not overwrite operator plan");
assert(blockedOperatorPlan.blockerCodes.includes("resident_cannot_mutate_non_resident_plan"), "operator-owner blocker missing");
assert(blockedOperatorPlan.blockerCodes.includes("resident_cannot_mutate_non_assistant_working_plan"), "operator-authority blocker missing");

const store = buildPlanProjectionStore({
  projectId: "project_context_plan_fixture",
  workThreadId: "work_thread_context_plan_fixture",
  threadId: "thread_context_plan_fixture",
  planId: "plan_context_fixture",
  envelopes: [acceptedPlan, blockedOperatorPlan],
  nowMs: 0,
});
assert.equal(store.schema, "plan_projection_store@1", "plan store schema mismatch");
assert.equal(store.acceptedEnvelopeCount, 1, "plan store should accept only lawful update");
assert.equal(store.blockedEnvelopeCount, 1, "plan store should retain blocked envelope evidence");
assert.equal(store.currentPlan.steps.length, 1, "plan store current plan should come from accepted envelope");

const slice = buildDirectFirstToolSlice({
  activationRegistry: {
    schema: "direct_tool_activation_registry@1",
    registryId: "context_plan_activation_registry",
    registryDigest: "context_plan_activation_registry_digest",
    status: "passed",
    validationErrors: [],
    snapshot: { snapshotId: "context_plan_snapshot" },
    rows: [
      activationRow("get_context_remaining", "session_control.get_context_remaining", "context_status_or_control"),
      activationRow("update_plan", "session_control.update_plan", "plan_projection"),
    ],
  },
  nowMs: 0,
});
assert.deepEqual(slice.summary.declaredToolNames.sort(), ["get_context_remaining", "update_plan"], "context/plan tools should be declared from active rows");

const contextGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: { callId: "context_call", name: "get_context_remaining", arguments: "{}" },
});
const contextEnvelope = buildContextRemainingResultEnvelope({
  gate: contextGate,
  contextRemainingInput: { remainingTokens: 75000, usedTokens: 25000, contextWindow: 100000 },
  nowMs: 0,
});
assert.equal(contextEnvelope.providerOutput.usableFor, "display_only", "provider context output must be display-only");
assert.equal(contextEnvelope.providerOutput.permissionToContinue, false, "provider context output must not grant continuation");

const planGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    callId: "plan_call",
    name: "update_plan",
    arguments: JSON.stringify({
      planId: "plan_context_fixture",
      mutationKind: "append_steps",
      steps: [{ text: "Append resident step" }],
    }),
  },
});
const planEnvelope = buildUpdatePlanResultEnvelope({
  gate: planGate,
  projectId: "project_context_plan_fixture",
  workThreadId: "work_thread_context_plan_fixture",
  threadId: "thread_context_plan_fixture",
  nowMs: 0,
});
assert.equal(planEnvelope.status, "ready_for_provider_continuation", "lawful plan update should return a provider continuation envelope");
assert.equal(planEnvelope.providerOutput.planOwner, "resident_model", "plan result should be resident-owned");
assert.equal(planEnvelope.providerOutput.planAuthority, "assistant_working_plan", "plan result should be assistant working plan only");
assert.equal(planEnvelope.providerOutput.mutatesProjectTruth, false, "plan result must not mutate project truth");

console.log(JSON.stringify({
  ok: true,
  contextWitnessId: contextWitness.witnessId,
  acceptedPlanEnvelopeId: acceptedPlan.envelopeId,
  planStoreId: store.storeId,
  declaredToolNames: slice.summary.declaredToolNames,
}, null, 2));
