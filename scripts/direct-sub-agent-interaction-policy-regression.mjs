#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  INTERFERING_ACTIONS,
  LIFECYCLE_CONTROL_ACTIONS,
  OBSERVATION_ACTIONS,
  SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA,
  buildSubAgentInteractionPolicyEnvelope,
  validateSubAgentInteractionPolicyEnvelope,
} = require("../src/main/direct/agents/sub-agent-interaction-policy");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

const fixedNow = () => Date.UTC(2026, 5, 20, 12, 30, 0);

const observeOnly = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "resident_model",
  actorId: "resident_primary",
  targetKind: "child_agent",
  targetId: "agent_carver",
  scope: "single_child",
  policy: "observe_only",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message", "followup_task", "close_agent"],
  sourceRefs: [{ kind: "spawn_policy", id: "spawn_agent_carver" }],
}, { now: fixedNow });

assert.equal(observeOnly.schema, SUB_AGENT_INTERACTION_POLICY_ENVELOPE_SCHEMA);
validateSubAgentInteractionPolicyEnvelope(observeOnly);
assert.deepEqual(observeOnly.allowedActions.sort(), [...OBSERVATION_ACTIONS].sort(), "observe_only should allow observation actions only");
for (const action of INTERFERING_ACTIONS) {
  assert.ok(observeOnly.blockedActions.includes(action), `observe_only should block ${action}`);
  const row = observeOnly.residentToolCatalogPolicyRows.find((entry) => entry.action === action);
  assert(row, `missing catalog row for ${action}`);
  assert.equal(row.callableInCurrentRequest, false, `${action} must not be callable`);
  assert.equal(row.declaredAsProviderTool, false, `${action} must not be provider-declared`);
  assert.equal(row.blockerReason, "blocked_by_observe_only_policy", `${action} blocker mismatch`);
  assert.equal(row.blockedResultEnvelope.outcome, "blocked", `${action} should route to deterministic blocked result`);
  assert.equal(row.blockedResultEnvelope.providerTransportStarted, false, `${action} must not start provider transport`);
}
assert.equal(observeOnly.noInterferencePolicyWitness.selfBindingEnforced, true, "resident observe-only should self-bind");
assert.equal(observeOnly.noInterferencePolicyWitness.policyInferredFromUiLabel, false, "policy must not come from UI label");
assert.equal(observeOnly.operatorBlockedControlProjection.grantsAuthority, false, "operator projection must not grant authority");

const noInterference = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "headless_route",
  actorId: "route_probe",
  targetKind: "child_thread",
  targetId: "child_thread_carver",
  scope: "parent_turn",
  policy: "no_interference",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message", "interrupt_agent", "resume_agent"],
  sourceRefs: [{ kind: "headless_policy", id: "route_probe_policy" }],
}, { now: fixedNow });

validateSubAgentInteractionPolicyEnvelope(noInterference);
assert.equal(noInterference.scope, "parent_turn");
for (const action of INTERFERING_ACTIONS) {
  assert.ok(noInterference.blockedActions.includes(action), `no_interference should block ${action}`);
  const row = noInterference.residentToolCatalogPolicyRows.find((entry) => entry.action === action);
  assert.equal(row.blockerReason, "blocked_by_no_interference_policy", `${action} blocker mismatch`);
}

const followupAllowed = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "resident_model",
  actorId: "resident_primary",
  targetKind: "child_agent",
  targetId: "agent_carver",
  scope: "single_child",
  policy: "followup_allowed",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message", "followup_task"],
}, { now: fixedNow });

validateSubAgentInteractionPolicyEnvelope(followupAllowed);
assert.ok(followupAllowed.allowedActions.includes("send_message"), "followup_allowed should allow send_message when otherwise authorized");
assert.ok(followupAllowed.allowedActions.includes("followup_task"), "followup_allowed should allow followup_task when otherwise authorized");
for (const action of LIFECYCLE_CONTROL_ACTIONS) {
  assert.ok(followupAllowed.blockedActions.includes(action), `followup_allowed should still block ${action} in PR99`);
  assert.equal(followupAllowed.residentToolCatalogPolicyRows.find((row) => row.action === action).blockerReason, "blocked_lifecycle_controls_not_promoted_in_pr99");
}

const residentLifecycleGated = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "resident_model",
  targetKind: "child_agent",
  targetId: "agent_carver",
  policy: "lifecycle_operator_gated",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent", "close_agent", "resume_agent"],
}, { now: fixedNow });

validateSubAgentInteractionPolicyEnvelope(residentLifecycleGated);
for (const action of LIFECYCLE_CONTROL_ACTIONS) {
  assert.equal(residentLifecycleGated.residentToolCatalogPolicyRows.find((row) => row.action === action).blockerReason, "blocked_lifecycle_operator_gate");
}

const operatorLifecycleGated = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "operator",
  targetKind: "child_agent",
  targetId: "agent_carver",
  policy: "lifecycle_operator_gated",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent", "close_agent", "resume_agent"],
}, { now: fixedNow });

validateSubAgentInteractionPolicyEnvelope(operatorLifecycleGated);
for (const action of LIFECYCLE_CONTROL_ACTIONS) {
  assert.ok(operatorLifecycleGated.allowedActions.includes(action), `operator lifecycle gate should allow ${action} when otherwise authorized`);
  assert.equal(operatorLifecycleGated.residentToolCatalogPolicyRows.find((row) => row.action === action).declaredAsProviderTool, true);
}

{
  const malformed = clone(observeOnly);
  malformed.allowedActions.push("send_message");
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "interfering_action_allowed:send_message");
}
{
  const malformed = clone(observeOnly);
  malformed.blockedActions = malformed.blockedActions.filter((action) => action !== "close_agent");
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "interfering_action_not_blocked:close_agent");
}
{
  const malformed = clone(observeOnly);
  malformed.policyInferredFromUiLabel = true;
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "envelope_boundary_leak:policyInferredFromUiLabel");
}
{
  const malformed = clone(observeOnly);
  malformed.residentToolCatalogPolicyRows.find((row) => row.action === "send_message").declaredAsProviderTool = true;
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "provider_declaration_mismatch:send_message");
}
{
  const malformed = clone(observeOnly);
  malformed.residentToolCatalogPolicyRows.find((row) => row.action === "send_message").blockedResultEnvelope.providerTransportStarted = true;
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "blocked_result_provider_transport_leak:send_message");
}
{
  const malformed = clone(observeOnly);
  malformed.noInterferencePolicyWitness.policyRelaxationFlowAvailable = true;
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "policy_relaxation_flow_leak");
}
{
  const malformed = clone(observeOnly);
  malformed.operatorBlockedControlProjection.grantsAuthority = true;
  expectThrows(() => validateSubAgentInteractionPolicyEnvelope(malformed), "operator_projection_grants_authority");
}

const serialized = JSON.stringify({
  observeOnly,
  noInterference,
  followupAllowed,
  residentLifecycleGated,
});
assert(!serialized.includes("\"providerTransportStarted\":true"), "provider transport leak");
assert(!serialized.includes("\"followupTransportStarted\":true"), "follow-up transport leak");
assert(!serialized.includes("\"lifecycleMutationStarted\":true"), "lifecycle mutation leak");
assert(!serialized.includes("\"policyInferredFromUiLabel\":true"), "UI-inferred policy leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");

console.log(JSON.stringify({
  ok: true,
  policyIds: [
    observeOnly.policyId,
    noInterference.policyId,
    followupAllowed.policyId,
  ],
  observeOnlyBlocked: observeOnly.blockedActions.length,
  noInterferenceBlocked: noInterference.blockedActions.length,
  followupAllowedActions: followupAllowed.allowedActions,
}, null, 2));
