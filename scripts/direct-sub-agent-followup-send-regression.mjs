#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentMailbox,
  buildAgentThreadGraph,
} = require("../src/main/direct/agents/runtime-substrate");
const {
  SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA,
  SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA,
  buildSubAgentControlledContinuation,
  validateSubAgentControlledContinuation,
} = require("../src/main/direct/agents/sub-agent-followup-send");
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

const nowMs = Date.UTC(2026, 5, 20, 15, 10, 0);
const graph = buildAgentThreadGraph({
  projectId: "project_followup_fixture",
  primaryThreadId: "primary_followup_fixture",
  graphRevision: 7,
  nodes: [{
    agentThreadId: "agent_carver",
    parentAgentThreadId: "primary_followup_fixture",
    displayLabel: "Carver",
    agentClassKind: "sub_agent_worker",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    nodeState: "running",
    lifecycleState: "running",
  }],
});
const mailbox = buildAgentMailbox({
  projectId: "project_followup_fixture",
  primaryThreadId: "primary_followup_fixture",
  graphId: graph.graphId,
  messages: [{
    messageId: "spawn_agent_carver",
    sequence: 1,
    messageKind: "spawn_intent",
    direction: "parent_to_child",
    parentAgentId: "primary_followup_fixture",
    childAgentId: "agent_carver",
    state: "recorded",
    createdAt: new Date(nowMs - 1000).toISOString(),
    payloadRef: {
      kind: "spawn_prompt_ref",
      id: "spawn_prompt_carver",
      digest: "sha256:spawn",
      label: "Spawn prompt",
      rawTextIncluded: false,
    },
  }],
});

const commonInput = {
  projectId: "project_followup_fixture",
  workThreadId: "work_thread_followup_fixture",
  primaryThreadId: "primary_followup_fixture",
  graph,
  mailbox,
  targetAgentId: "agent_carver",
  parentAgentId: "primary_followup_fixture",
  deliverySupport: {
    supported: true,
    deliveryMode: "provider_backed_existing_child",
    deliveryAdapter: "direct_test_child_delivery_adapter",
  },
  providerDeliveryResult: {
    status: "delivered",
    deliveryReceiptId: "receipt_send_agent_carver",
  },
};

const send = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Continue with the next scoped check.",
  idempotencyKey: "idem_send_carver_1",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { nowMs });

assert.equal(send.schema, SUB_AGENT_CONTROLLED_CONTINUATION_SCHEMA);
validateSubAgentControlledContinuation(send);
assert.equal(send.plan.schema, "sub_agent_send_message_plan@1");
assert.equal(send.authorityDecision.finalDecision, "allow");
assert.equal(send.mailboxLedgerRow.schema, SUB_AGENT_FOLLOWUP_MAILBOX_LEDGER_SCHEMA);
assert.equal(send.mailboxLedgerRow.status, "accepted");
assert.equal(send.mailboxLedgerRow.sequence, 2);
assert.equal(send.resultEnvelope.status, "completed");
assert.equal(send.resultEnvelope.providerTransportStarted, true);
assert.equal(send.resultEnvelope.contextAdmission.mode, "summary_only");
assert.equal(send.resultEnvelope.contextAdmission.childTranscriptAdmitted, false);
assert.equal(send.resultEnvelope.fallbackSpawnStarted, false);
assert.equal(send.resultEnvelope.childToolInheritanceStarted, false);

const followup = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "followup_task",
  task: "Run the second reconciliation pass without widening scope.",
  idempotencyKey: "idem_followup_carver_1",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "followup_task"],
}, { nowMs });

validateSubAgentControlledContinuation(followup);
assert.equal(followup.plan.schema, "sub_agent_followup_task_plan@1");
assert.equal(followup.authorityDecision.finalDecision, "allow");
assert.equal(followup.resultEnvelope.contextAdmission.rawPayloadAdmitted, false);

const duplicate = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Continue with the next scoped check.",
  idempotencyKey: "idem_send_carver_1",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  existingLedgerRows: [send.mailboxLedgerRow],
}, { nowMs });

validateSubAgentControlledContinuation(duplicate);
assert.equal(duplicate.authorityDecision.finalDecision, "allow");
assert.equal(duplicate.authorityDecision.duplicateSuppressed, true);
assert.equal(duplicate.mailboxLedgerRow.status, "duplicate_suppressed");
assert.equal(duplicate.resultEnvelope.providerTransportStarted, false);

const secondDistinct = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Distinct follow-up after the first accepted message.",
  idempotencyKey: "idem_send_carver_2",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  existingLedgerRows: [send.mailboxLedgerRow],
}, { nowMs });

assert.equal(secondDistinct.mailboxLedgerRow.status, "accepted");
assert.equal(secondDistinct.mailboxLedgerRow.sequence, send.mailboxLedgerRow.sequence + 1, "accepted ledger rows should advance sequence from prior accepted rows");

const conflict = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Different payload under the same key.",
  idempotencyKey: "idem_send_carver_1",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  existingLedgerRows: [send.mailboxLedgerRow],
}, { nowMs });

assert.equal(conflict.authorityDecision.finalDecision, "block");
assert(conflict.authorityDecision.blockerCodes.includes("idempotency_conflict"));
assert.equal(conflict.mailboxLedgerRow.status, "blocked");
assert.equal(conflict.resultEnvelope.providerTransportStarted, false);

const sharedPrefix = `${"x".repeat(300)} tail `;
const longFirst = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: `${sharedPrefix}one`,
  idempotencyKey: "idem_long_payload",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { nowMs });
const longConflict = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: `${sharedPrefix}two`,
  idempotencyKey: "idem_long_payload",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  existingLedgerRows: [longFirst.mailboxLedgerRow],
}, { nowMs });

assert.equal(longConflict.authorityDecision.finalDecision, "block");
assert(longConflict.authorityDecision.blockerCodes.includes("idempotency_conflict"), "full payload digest should distinguish long same-prefix messages");

const policyBlockedEnvelope = buildSubAgentInteractionPolicyEnvelope({
  actorKind: "resident_model",
  targetKind: "child_agent",
  targetId: "agent_carver",
  scope: "single_child",
  policy: "observe_only",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { now: nowMs });
const policyBlocked = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "This should be blocked by observe-only.",
  idempotencyKey: "idem_send_blocked_policy",
  policyEnvelope: policyBlockedEnvelope,
}, { nowMs });

assert.equal(policyBlocked.authorityDecision.finalDecision, "block");
assert(policyBlocked.authorityDecision.blockerCodes.includes("policy_blocks_followup_action"));
assert.equal(policyBlocked.resultEnvelope.providerTransportStarted, false);

const invalidPolicyEnvelope = clone(policyBlockedEnvelope);
invalidPolicyEnvelope.schema = "bad_policy_envelope@1";
const invalidPolicy = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Invalid policy envelope should become a blocker, not a crash.",
  idempotencyKey: "idem_invalid_policy",
  policyEnvelope: invalidPolicyEnvelope,
}, { nowMs });

assert.equal(invalidPolicy.authorityDecision.finalDecision, "block");
assert(invalidPolicy.authorityDecision.blockerCodes.includes("policy_envelope_invalid"));
assert.equal(invalidPolicy.resultEnvelope.providerTransportStarted, false);

const unsupportedDelivery = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Provider cannot deliver to existing child.",
  idempotencyKey: "idem_send_unsupported_delivery",
  deliverySupport: {
    supported: false,
    supportState: "unsupported",
  },
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { nowMs });

assert.equal(unsupportedDelivery.authorityDecision.finalDecision, "block");
assert(unsupportedDelivery.authorityDecision.blockerCodes.includes("delivery_not_supported"));
assert.equal(unsupportedDelivery.deliverySupportWitness.fallbackSpawnAllowed, false);
assert.equal(unsupportedDelivery.resultEnvelope.fallbackSpawnStarted, false);

const invalidAction = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "close_agent",
  text: "This must not be coerced into send_message.",
  idempotencyKey: "idem_invalid_action",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { nowMs });

assert.equal(invalidAction.writeKind, "close_agent");
assert.equal(invalidAction.authorityDecision.finalDecision, "block");
assert(invalidAction.authorityDecision.blockerCodes.includes("invalid_followup_write_kind"));
assert.equal(invalidAction.resultEnvelope.providerTransportStarted, false);

const failedDelivery = buildSubAgentControlledContinuation({
  ...commonInput,
  writeKind: "send_message",
  text: "Adapter will fail this delivery.",
  idempotencyKey: "idem_failed_delivery",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  providerDeliveryResult: {
    status: "failed",
    deliveryReceiptId: "receipt_failed_delivery",
  },
}, { nowMs });

assert.equal(failedDelivery.authorityDecision.finalDecision, "allow");
assert.equal(failedDelivery.resultEnvelope.providerDelivery.status, "failed");
assert.equal(failedDelivery.resultEnvelope.status, "failed", "failed provider delivery must not be reported as completed");

const missingTarget = buildSubAgentControlledContinuation({
  ...commonInput,
  targetAgentId: "agent_missing",
  writeKind: "send_message",
  text: "Missing target should block before provider transport.",
  idempotencyKey: "idem_missing_target",
  deliverySupport: {
    supported: true,
    deliveryMode: "provider_backed_existing_child",
  },
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
}, { nowMs });

assert.equal(missingTarget.authorityDecision.finalDecision, "block");
assert(missingTarget.authorityDecision.blockerCodes.includes("target_not_found"));
assert(missingTarget.authorityDecision.blockerCodes.includes("target_stale_or_terminal"));
assert.equal(missingTarget.resultEnvelope.providerTransportStarted, false);

const staleGraph = buildAgentThreadGraph({
  projectId: "project_followup_fixture",
  primaryThreadId: "primary_followup_fixture",
  graphRevision: 8,
  nodes: [{
    agentThreadId: "agent_carver",
    parentAgentThreadId: "primary_followup_fixture",
    displayLabel: "Carver",
    agentClassKind: "sub_agent_worker",
    nodeState: "completed",
    lifecycleState: "completed",
  }],
});
const staleTarget = buildSubAgentControlledContinuation({
  ...commonInput,
  graph: staleGraph,
  writeKind: "followup_task",
  task: "Terminal target should not accept follow-up.",
  idempotencyKey: "idem_stale_target",
  otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "followup_task"],
}, { nowMs });

assert.equal(staleTarget.authorityDecision.finalDecision, "block");
assert(staleTarget.authorityDecision.blockerCodes.includes("target_stale_or_terminal"));

{
  const malformed = clone(send);
  malformed.resultEnvelope.contextAdmission.childTranscriptAdmitted = true;
  expectThrows(() => validateSubAgentControlledContinuation(malformed), "context_admission_not_summary_only");
}
{
  const malformed = clone(send);
  malformed.resultEnvelope.fallbackSpawnStarted = true;
  expectThrows(() => validateSubAgentControlledContinuation(malformed), "fallback_spawn_leak");
}
{
  const malformed = clone(send);
  malformed.resultEnvelope.childToolInheritanceStarted = true;
  expectThrows(() => validateSubAgentControlledContinuation(malformed), "child_tool_inheritance_leak");
}
{
  const malformed = clone(send);
  malformed.resultEnvelope.rawProviderPayloadIncluded = true;
  expectThrows(() => validateSubAgentControlledContinuation(malformed), "result_raw_exposure_leak:rawProviderPayloadIncluded");
}

const serialized = JSON.stringify({
  send,
  followup,
  duplicate,
  secondDistinct,
  conflict,
  longConflict,
  policyBlocked,
  invalidPolicy,
  unsupportedDelivery,
  invalidAction,
  failedDelivery,
  missingTarget,
  staleTarget,
});
assert(!serialized.includes("\"fallbackSpawnStarted\":true"), "fallback spawn leak");
assert(!serialized.includes("\"childToolInheritanceStarted\":true"), "child tool inheritance leak");
assert(!serialized.includes("\"rawPayloadIncluded\":true"), "raw payload leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");
assert(!serialized.includes("\"rawChildTranscriptIncluded\":true"), "raw child transcript leak");

console.log(JSON.stringify({
  ok: true,
  acceptedLedgerRow: send.mailboxLedgerRow.ledgerRowId,
  duplicateStatus: duplicate.mailboxLedgerRow.status,
  blockedCases: [
    conflict.authorityDecision.blockerCodes[0],
    longConflict.authorityDecision.blockerCodes[0],
    policyBlocked.authorityDecision.blockerCodes[0],
    invalidPolicy.authorityDecision.blockerCodes[0],
    unsupportedDelivery.authorityDecision.blockerCodes[0],
    invalidAction.authorityDecision.blockerCodes[0],
    missingTarget.authorityDecision.blockerCodes[0],
    staleTarget.authorityDecision.blockerCodes[0],
  ],
  residentWitnessRows: send.residentWitnessRows.length,
}, null, 2));
