#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentThreadGraph,
} = require("../src/main/direct/agents/runtime-substrate");
const {
  SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA,
  buildSubAgentLifecycleControlPacket,
  validateSubAgentLifecycleControlPacket,
} = require("../src/main/direct/agents/sub-agent-lifecycle-controls");
const {
  buildSubAgentInteractionPolicyEnvelope,
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

const nowMs = Date.UTC(2026, 5, 20, 16, 5, 0);
const graph = buildAgentThreadGraph({
  projectId: "project_lifecycle_fixture",
  primaryThreadId: "primary_lifecycle_fixture",
  graphRevision: 11,
  nodes: [
    {
      agentThreadId: "agent_running",
      parentAgentThreadId: "primary_lifecycle_fixture",
      displayLabel: "Runner",
      agentClassKind: "sub_agent_worker",
      nodeState: "running",
      lifecycleState: "running",
    },
    {
      agentThreadId: "agent_interrupted",
      parentAgentThreadId: "primary_lifecycle_fixture",
      displayLabel: "Paused",
      agentClassKind: "sub_agent_worker",
      nodeState: "interrupted",
      lifecycleState: "interrupted",
    },
    {
      agentThreadId: "agent_closed",
      parentAgentThreadId: "primary_lifecycle_fixture",
      displayLabel: "Closed",
      agentClassKind: "sub_agent_worker",
      nodeState: "closed",
      lifecycleState: "closed",
    },
    {
      agentThreadId: "agent_completed",
      parentAgentThreadId: "primary_lifecycle_fixture",
      displayLabel: "Completed",
      agentClassKind: "sub_agent_worker",
      nodeState: "completed",
      lifecycleState: "completed",
    },
    {
      agentThreadId: "agent_stale",
      parentAgentThreadId: "primary_lifecycle_fixture",
      displayLabel: "Stale",
      agentClassKind: "sub_agent_worker",
      nodeState: "stale",
      lifecycleState: "stale",
    },
  ],
});

const commonInput = {
  projectId: "project_lifecycle_fixture",
  workThreadId: "work_thread_lifecycle_fixture",
  primaryThreadId: "primary_lifecycle_fixture",
  graph,
  actorKind: "operator",
  actorId: "operator_fixture",
  providerSupport: {
    supported: true,
    providerPrimitive: "provider_lifecycle_fixture",
    closeModes: ["graceful", "force"],
  },
};

const close = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "close_agent",
  targetAgentId: "agent_running",
  closeMode: "graceful",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { nowMs });

assert.equal(close.schema, SUB_AGENT_LIFECYCLE_CONTROL_PACKET_SCHEMA);
validateSubAgentLifecycleControlPacket(close);
assert.equal(close.authorityDecision.finalDecision, "allow");
assert.equal(close.transitionLedger.beforeLifecycleState, "running");
assert.equal(close.transitionLedger.afterLifecycleState, "closed");
assert.equal(close.transitionLedger.providerTransportStarted, true);
assert.equal(close.transitionLedger.lifecycleMutationStarted, true);
assert.equal(close.cancellationWitness.applicable, true);
assert.equal(close.resultEnvelope.status, "completed");
assert.equal(close.resultEnvelope.residentCallableLifecycleAction, false);
assert(close.providerSupportWitness.closeModeRows.some((row) => row.mode === "graceful" && row.supported === true && row.selected === true));

const interrupt = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "interrupt_agent",
  targetAgentId: "agent_running",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent"],
}, { nowMs });

assert.equal(interrupt.authorityDecision.finalDecision, "allow");
assert.equal(interrupt.transitionLedger.afterLifecycleState, "interrupted");
assert.equal(interrupt.cancellationWitness.cancellationKind, "interrupt");

const resume = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "resume_agent",
  targetAgentId: "agent_interrupted",
  targetLifecycleState: "interrupted",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "resume_agent"],
}, { nowMs });

assert.equal(resume.authorityDecision.finalDecision, "allow");
assert.equal(resume.transitionLedger.beforeLifecycleState, "interrupted");
assert.equal(resume.transitionLedger.afterLifecycleState, "running");
assert.equal(resume.resumeViabilityWitness.viable, true);

const unsupported = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "interrupt_agent",
  targetAgentId: "agent_running",
  providerSupport: {
    supported: false,
    supportState: "unsupported",
  },
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent"],
}, { nowMs });

assert.equal(unsupported.authorityDecision.finalDecision, "block");
assert(unsupported.authorityDecision.blockerCodes.includes("provider_lifecycle_control_unsupported"));
assert.equal(unsupported.transitionLedger.status, "unsupported");
assert.equal(unsupported.transitionLedger.providerTransportStarted, false);
assert.equal(unsupported.transitionLedger.lifecycleMutationStarted, false);
assert.equal(unsupported.transitionLedger.simulatedSuccessStarted, false);

const residentBlocked = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "close_agent",
  actorKind: "resident_model",
  targetAgentId: "agent_running",
  policy: "lifecycle_operator_gated",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { nowMs });

assert.equal(residentBlocked.authorityDecision.finalDecision, "block");
assert(residentBlocked.authorityDecision.blockerCodes.includes("operator_required_for_lifecycle_control"));
assert(residentBlocked.authorityDecision.blockerCodes.includes("policy_blocks_lifecycle_action"));
assert.equal(residentBlocked.transitionLedger.lifecycleMutationStarted, false);

const noInterferencePolicy = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "operator",
  targetKind: "child_agent",
  targetId: "agent_running",
  scope: "single_child",
  policy: "no_interference",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { now: nowMs });
const noInterferenceBlocked = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "close_agent",
  targetAgentId: "agent_running",
  policyEnvelope: noInterferencePolicy,
}, { nowMs });

assert.equal(noInterferenceBlocked.authorityDecision.finalDecision, "block");
assert(noInterferenceBlocked.authorityDecision.blockerCodes.includes("policy_blocks_lifecycle_action"));
assert.equal(noInterferenceBlocked.transitionLedger.providerTransportStarted, false);

const idempotentClose = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "close_agent",
  targetAgentId: "agent_closed",
  targetLifecycleState: "closed",
  providerSupport: {
    supported: false,
    supportState: "unsupported",
  },
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { nowMs });

assert.equal(idempotentClose.authorityDecision.finalDecision, "idempotent_noop");
assert.equal(idempotentClose.transitionLedger.status, "idempotent_noop");
assert.equal(idempotentClose.transitionLedger.beforeLifecycleState, "closed");
assert.equal(idempotentClose.transitionLedger.afterLifecycleState, "closed");
assert.equal(idempotentClose.transitionLedger.providerTransportStarted, false);
assert.equal(idempotentClose.cancellationWitness.idempotentNoop, true);

const resumeCompleted = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "resume_agent",
  targetAgentId: "agent_completed",
  targetLifecycleState: "completed",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "resume_agent"],
}, { nowMs });

assert.equal(resumeCompleted.authorityDecision.finalDecision, "block");
assert(resumeCompleted.authorityDecision.blockerCodes.includes("target_not_resumable"));
assert.equal(resumeCompleted.resumeViabilityWitness.viable, false);

const stale = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "interrupt_agent",
  targetAgentId: "agent_stale",
  targetLifecycleState: "stale",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent"],
}, { nowMs });

assert.equal(stale.authorityDecision.finalDecision, "block");
assert(stale.authorityDecision.blockerCodes.includes("target_stale_or_not_found"));
assert.equal(stale.transitionLedger.lifecycleMutationStarted, false);

const missing = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "close_agent",
  targetAgentId: "agent_missing",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { nowMs });

assert.equal(missing.authorityDecision.finalDecision, "block");
assert(missing.authorityDecision.blockerCodes.includes("target_not_found"));
assert.equal(missing.transitionLedger.providerTransportStarted, false);

const invalidAction = buildSubAgentLifecycleControlPacket({
  ...commonInput,
  action: "send_message",
  targetAgentId: "agent_running",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
}, { nowMs });

assert.equal(invalidAction.action, "send_message");
assert.equal(invalidAction.authorityDecision.finalDecision, "block");
assert(invalidAction.authorityDecision.blockerCodes.includes("invalid_lifecycle_action"));
assert.equal(invalidAction.transitionLedger.providerTransportStarted, false);

{
  const malformed = clone(close);
  malformed.resultEnvelope.residentCallableLifecycleAction = true;
  expectThrows(() => validateSubAgentLifecycleControlPacket(malformed), "resident_callable_lifecycle_leak");
}
{
  const malformed = clone(close);
  malformed.transitionLedger.simulatedSuccessStarted = true;
  expectThrows(() => validateSubAgentLifecycleControlPacket(malformed), "simulated_success_leak");
}
{
  const malformed = clone(residentBlocked);
  malformed.transitionLedger.lifecycleMutationStarted = true;
  expectThrows(() => validateSubAgentLifecycleControlPacket(malformed), "blocked_lifecycle_mutation_leak");
}
{
  const malformed = clone(close);
  malformed.resultEnvelope.rawProviderPayloadIncluded = true;
  expectThrows(() => validateSubAgentLifecycleControlPacket(malformed), "result_raw_exposure_leak:rawProviderPayloadIncluded");
}

const serialized = JSON.stringify({
  close,
  interrupt,
  resume,
  unsupported,
  residentBlocked,
  noInterferenceBlocked,
  idempotentClose,
  resumeCompleted,
  stale,
  missing,
  invalidAction,
});
assert(!serialized.includes("\"simulatedSuccessStarted\":true"), "simulated success leak");
assert(!serialized.includes("\"residentCallableLifecycleAction\":true"), "resident callable lifecycle leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");
assert(!serialized.includes("\"rawChildTranscriptIncluded\":true"), "raw child transcript leak");

console.log(JSON.stringify({
  ok: true,
  closeStatus: close.resultEnvelope.status,
  interruptAfter: interrupt.transitionLedger.afterLifecycleState,
  resumeAfter: resume.transitionLedger.afterLifecycleState,
  unsupportedStatus: unsupported.transitionLedger.status,
  idempotentStatus: idempotentClose.transitionLedger.status,
  residentWitnessRows: close.residentWitnessRows.length,
}, null, 2));
