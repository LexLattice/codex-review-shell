#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildHumanDecisionAnswerResultEnvelope,
  buildRequestUserInputResultEnvelope,
} = require("../src/main/direct/headless/first-tool-slice");
const {
  buildHumanDecisionLedger,
  buildHumanDecisionResultEnvelope,
  buildHumanDecisionToolPacket,
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
    scope: { kind: "project_default", projectId: "project_human_decision_fixture" },
    promotionDecisionRef: {
      decisionId: `${toolName}_decision`,
      decisionDigest: `${toolName}_decision_digest`,
      decisionState: "promotable",
      evidenceClass: "real_provider_full_loop",
    },
    providerRequestShapeSupport: {
      requestShapeFamily,
      providerProfileId: "human_decision_provider",
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

const packet = buildHumanDecisionToolPacket({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_fixture",
  promptPreview: "Choose next route.",
  choices: [
    { choiceId: "continue", label: "Continue", carriesAuthority: true, authorityScope: "single_action" },
    { choiceId: "pause", label: "Pause" },
  ],
  freeTextAllowed: true,
  nowMs: 0,
});
assert.equal(packet.schema, "direct_human_decision_tool_packet@1", "packet schema mismatch");
assert.equal(packet.status, "pending", "packet should default pending");
assert.equal(packet.pendingPolicy, "single_pending_per_turn", "packet should use single pending per turn");
assert.equal(packet.choices.length, 2, "packet should preserve bounded choices");
assert.equal(packet.choices[0].carriesAuthority, false, "choice authority must be stripped");
assert.equal(packet.choices[0].authorityScope, "none", "choice authority scope must be none");
assert.equal(packet.boundedChoiceMayCarryAuthority, false, "bounded choices may not carry authority");
assert.equal(packet.freeTextCanWidenAuthority, false, "free text must not widen authority");
assert.equal(packet.mayStartProviderTurn, false, "packet must not start provider turn");

const numericChoicePacket = buildHumanDecisionToolPacket({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_fixture",
  promptPreview: "Numeric choices should normalize.",
  choices: [
    { choiceId: 7, label: 42, description: false },
  ],
  nowMs: 0,
});
assert.equal(numericChoicePacket.choices[0].choiceId, "7", "numeric choice id should normalize to string");
assert.equal(numericChoicePacket.choices[0].label, "42", "numeric choice label should normalize to string");

const answer = buildHumanDecisionResultEnvelope({
  decisionPacketId: packet.decisionPacketId,
  selectedChoiceIds: ["continue"],
  freeText: "Context-only note.",
  resultState: "answered",
  nowMs: 0,
});
assert.equal(answer.schema, "human_decision_result_envelope@1", "answer result schema mismatch");
assert.deepEqual(answer.selectedChoiceIds, ["continue"], "answer should preserve selected choices");
assert.equal(answer.freeTextPresent, true, "answer should record free-text presence");
assert.equal(answer.freeTextAdmittedAs, "context_only", "free text should be admitted as context only");
assert.equal(answer.authorityGranted, false, "answer must not grant authority");
assert.equal(answer.mayStartProviderTurn, false, "answer must not start provider turn");

const secondPacket = buildHumanDecisionToolPacket({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_fixture",
  promptPreview: "Superseding question.",
  choices: ["Acknowledge"],
  nowMs: 1,
});
const ledger = buildHumanDecisionLedger({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  packets: [packet, secondPacket],
  nowMs: 2,
});
assert.equal(ledger.schema, "human_decision_ledger@1", "ledger schema mismatch");
assert.equal(ledger.pendingPacketCount, 1, "single-pending policy should leave one pending packet");
assert.equal(ledger.supersededPacketCount, 1, "single-pending policy should supersede prior pending packet");
assert.equal(ledger.packets[0].status, "superseded", "first packet should be superseded");
assert.equal(ledger.packets[1].status, "pending", "second packet should remain pending");
assert.equal(ledger.authorityGranted, false, "ledger must not grant authority");

const expiredPacket = buildHumanDecisionToolPacket({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_expired",
  promptPreview: "Expired question.",
  choices: ["Expired"],
  expiresAt: "1970-01-01T00:00:00.001Z",
  nowMs: 0,
});
const expiredLedger = buildHumanDecisionLedger({
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  packets: [expiredPacket],
  nowMs: 2,
});
assert.equal(expiredLedger.pendingPacketCount, 0, "expired packet should not remain pending");
assert.equal(expiredLedger.expiredPacketCount, 1, "expired packet should be counted as expired");
assert.equal(expiredLedger.packets[0].status, "expired", "expired packet status should be explicit");

const slice = buildDirectFirstToolSlice({
  activationRegistry: {
    schema: "direct_tool_activation_registry@1",
    registryId: "human_decision_activation_registry",
    registryDigest: "human_decision_activation_registry_digest",
    status: "passed",
    validationErrors: [],
    snapshot: { snapshotId: "human_decision_snapshot" },
    rows: [
      activationRow("request_user_input", "human_decision.request_user_input", "direct_human_decision_tool_packet@1"),
    ],
  },
  nowMs: 0,
});
assert.deepEqual(slice.summary.declaredToolNames, ["request_user_input"], "request_user_input should be declared from active row");
assert.equal(slice.summary.requestUserInputDeclared, true, "slice summary should expose request_user_input declaration");

const gate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_human_decision",
    callId: "call_human_decision",
    name: "request_user_input",
    arguments: JSON.stringify({
      prompt: "Should I continue?",
      choices: [
        { choiceId: 1, label: 100 },
        { choiceId: "no", label: "No" },
      ],
      freeTextAllowed: true,
    }),
  },
});
assert.equal(gate.status, "accepted", "bounded request_user_input call should be accepted");
assert.equal(gate.parsedArguments.choices[0].choiceId, "1", "numeric provider choice id should normalize to string");
assert.equal(gate.parsedArguments.choices[0].label, "100", "numeric provider choice label should normalize to string");

const requestEnvelope = buildRequestUserInputResultEnvelope({
  gate,
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_fixture",
  nowMs: 0,
});
assert.equal(requestEnvelope.status, "waiting_for_human", "request_user_input should wait for human");
assert.equal(requestEnvelope.providerOutput.kind, "request_user_input_result", "provider output kind mismatch");
assert.equal(requestEnvelope.providerOutput.authorityGranted, false, "request envelope must not grant authority");
assert.equal(requestEnvelope.providerOutput.mayStartProviderTurn, false, "request envelope must not start provider turn");
assert.equal(requestEnvelope.decisionPacket.boundedChoiceMayCarryAuthority, false, "request packet choices must be non-authoritative");

const answerEnvelope = buildHumanDecisionAnswerResultEnvelope({
  decisionPacketId: requestEnvelope.decisionPacket.decisionPacketId,
  selectedChoiceIds: ["yes"],
  freeText: "Use this only as context.",
  resultState: "answered",
  nowMs: 0,
});
assert.equal(answerEnvelope.schema, "direct_first_tool_result_envelope@1", "answer envelope schema mismatch");
assert.equal(answerEnvelope.providerOutput.authorityGranted, false, "answer envelope must not grant authority");
assert.equal(answerEnvelope.providerOutput.freeTextAdmittedAs, "context_only", "answer free text must stay context-only");

const blockedGate = buildDirectFirstToolCallGate({
  slice,
  toolCall: {
    itemId: "tool_item_human_decision_bad",
    callId: "call_human_decision_bad",
    name: "request_user_input",
    arguments: JSON.stringify({ prompt: "No choices", choices: [] }),
  },
});
const blockedEnvelope = buildRequestUserInputResultEnvelope({
  gate: blockedGate,
  projectId: "project_human_decision_fixture",
  workThreadId: "work_thread_human_decision_fixture",
  threadId: "thread_human_decision_fixture",
  turnId: "turn_human_decision_fixture",
  humanDecisionLedgerInput: {
    packets: [requestEnvelope.decisionPacket],
  },
  nowMs: 0,
});
assert.equal(blockedEnvelope.status, "blocked", "request without bounded choices should be blocked");
assert(blockedEnvelope.blockerCodes.includes("human_decision_missing_bounded_choices"), "missing choices blocker should be explicit");
assert.equal(blockedEnvelope.decisionLedger.pendingPacketCount, 1, "blocked request should not add a pending packet");
assert.equal(blockedEnvelope.decisionLedger.packets.length, 1, "blocked request should not append a ledger packet");
assert.equal(blockedEnvelope.decisionLedger.packets[0].decisionPacketId, requestEnvelope.decisionPacket.decisionPacketId, "blocked request should preserve existing pending packet");
assert.equal(blockedEnvelope.contextAdmission.admissionState, "blocked", "blocked request context admission should be blocked");

console.log(JSON.stringify({
  ok: true,
  packetId: packet.decisionPacketId,
  ledgerId: ledger.ledgerId,
  declaredToolNames: slice.summary.declaredToolNames,
  requestEnvelopeStatus: requestEnvelope.status,
}, null, 2));
