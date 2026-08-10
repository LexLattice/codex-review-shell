#!/usr/bin/env node

import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildGovernanceEnforcementPreflight,
  validateGovernanceEnforcementPreflight,
} = require("../src/main/direct/governance/enforcement-gate");
const {
  assertOperatorBrokerResolutionSafe,
  buildOperatorBrokerResolution,
} = require("../src/main/direct/governance/operator-broker-resolution");
const {
  assertClarificationTargetAnswerSafe,
  assertClarificationTargetPickerSafe,
  buildClarificationTargetAnswer,
  buildClarificationTargetPicker,
} = require("../src/main/direct/governance/target-picker");

const nowMs = Date.parse("2026-06-14T09:00:00.000Z");
const projectId = "codex-review-shell-direct";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if ([
        "pickerDigest",
        "answerDigest",
        "rowDigest",
        "sourceDigest",
        "artifactDigest",
        "clarificationAnswerDigest",
      ].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${JSON.stringify(stableValue(value))}`).digest("hex")}`;
}

const workThreads = [
  buildWorkThread({
    workThreadId: "work_thread_bridge",
    projectId,
    title: "Direct bridge work",
    objective: "Productize the direct information bridge.",
    branchIdentity: { branchName: "codex/direct-chatgpt-harness", branchEvidenceKey: "branch_direct" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_direct" },
    activeRuntimePath: "direct-implementation",
    openObligations: [{ obligationId: "obl_bridge", kind: "governance", summary: "Clarify target picker." }],
  }, { nowMs }),
  buildWorkThread({
    workThreadId: "work_thread_bridge_shadow",
    projectId,
    title: "Direct bridge shadow lane",
    objective: "Productize the direct information bridge.",
    branchIdentity: { branchName: "codex/direct-chatgpt-harness", branchEvidenceKey: "branch_direct" },
    workspaceIdentity: { workspaceKind: "wsl", workspaceEvidenceKey: "workspace_direct" },
    activeRuntimePath: "direct-implementation",
    openObligations: [{ obligationId: "obl_shadow", kind: "governance", summary: "Clarify target picker." }],
  }, { nowMs: nowMs - 1000 }),
  buildWorkThread({
    workThreadId: "work_thread_stale",
    projectId,
    title: "Stale lane",
    lifecycleState: "stale",
    objective: "Productize the direct information bridge.",
    activeRuntimePath: "direct-implementation",
  }, { nowMs: nowMs - 2000 }),
];

const operatorBrokerResolution = buildOperatorBrokerResolution({
  projectId,
  userRequest: "direct bridge governance target picker",
  branchName: "codex/direct-chatgpt-harness",
}, workThreads, { nowMs });
assertOperatorBrokerResolutionSafe(operatorBrokerResolution);
assert.equal(operatorBrokerResolution.resolutionState, "ambiguous");
assert.equal(operatorBrokerResolution.clarificationRequired, true);

const preflight = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "provider_call",
  operatorBrokerResolution,
}, { nowMs });
validateGovernanceEnforcementPreflight(preflight);
assert.equal(preflight.gateState, "clarification_required");
assert(preflight.clarificationPacket.candidates.length >= 2);

const picker = buildClarificationTargetPicker({
  projectId,
  clarificationPacket: preflight.clarificationPacket,
  operatorBrokerResolution,
}, { nowMs });
assertClarificationTargetPickerSafe(picker);
assert.equal(picker.schema, "direct_clarification_target_picker@1");
assert.equal(picker.pickerState, "ready");
assert.equal(picker.candidateCount, 3);
assert.equal(picker.selectableCandidateCount, 2);
assert.equal(picker.actions.chooseCandidateAvailable, true);
assert.equal(picker.actions.providerCallAuthorityGranted, false);
assert.equal(picker.downstreamRoutePacketConstraints.providerCallBlocked, true);
assert(picker.blockerCodes.includes("operator_broker_clarification_required"));
assert.equal(picker.candidates.find((candidate) => candidate.workThreadId === "work_thread_stale").selectable, false);
assert(picker.candidates.find((candidate) => candidate.workThreadId === "work_thread_stale").blockerCodes.includes("candidate_stale"));

const selectedAnswer = buildClarificationTargetAnswer({
  targetPicker: picker,
  answerKind: "choose_candidate",
  selectedWorkThreadId: "work_thread_bridge",
}, { nowMs });
assertClarificationTargetAnswerSafe(selectedAnswer);
assert.equal(selectedAnswer.answerState, "accepted");
assert.equal(selectedAnswer.selectedWorkThreadId, "work_thread_bridge");
assert.equal(selectedAnswer.routingEvidenceReady, true);
assert.equal(selectedAnswer.authority.providerCallAuthorityGranted, false);
assert.equal(selectedAnswer.downstreamRoutePacketConstraints.providerCallBlocked, true);
assert.equal(digestFor("direct-clarification-target-answer@1", selectedAnswer), selectedAnswer.answerDigest);

const staleAnswer = buildClarificationTargetAnswer({
  targetPicker: picker,
  answerKind: "choose_candidate",
  selectedWorkThreadId: "work_thread_stale",
}, { nowMs });
assertClarificationTargetAnswerSafe(staleAnswer);
assert.equal(staleAnswer.answerState, "blocked");
assert.equal(staleAnswer.selectedWorkThreadId, "");
assert(staleAnswer.blockerCodes.includes("selected_work_thread_not_selectable"));

const rejectAnswer = buildClarificationTargetAnswer({
  targetPicker: picker,
  answerKind: "reject_all",
}, { nowMs });
assertClarificationTargetAnswerSafe(rejectAnswer);
assert.equal(rejectAnswer.answerState, "accepted");
assert.equal(rejectAnswer.selectedWorkThreadId, "");
assert.equal(rejectAnswer.rejectedCandidateCount, 3);

const keepBlockedAnswer = buildClarificationTargetAnswer({
  targetPicker: picker,
  answerKind: "keep_blocked",
}, { nowMs });
assertClarificationTargetAnswerSafe(keepBlockedAnswer);
assert.equal(keepBlockedAnswer.answerState, "accepted");
assert.equal(keepBlockedAnswer.selectedWorkThreadId, "");

const emptyPicker = buildClarificationTargetPicker({
  projectId,
  clarificationPacket: {
    schema: "direct_governance_clarification_packet@1",
    projectId,
    clarificationPacketId: "clarification_empty",
    clarificationPacketDigest: "sha256:empty",
    blockerCodes: ["target_resolution_unresolved"],
  },
}, { nowMs });
assertClarificationTargetPickerSafe(emptyPicker);
assert.equal(emptyPicker.pickerState, "no_candidates");
assert.equal(emptyPicker.actions.chooseCandidateAvailable, false);
assert(emptyPicker.blockerCodes.includes("target_picker_no_candidates"));

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  clarificationTargetPicker: picker,
}, { nowMs });
assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("clarification_target_picker"));
assert.equal(settingsProjection.sections.clarificationTargetPicker.available, true);
assert.equal(settingsProjection.sections.clarificationTargetPicker.pickerState, "ready");
assert(settingsProjection.rows.clarificationTargetPicker.some((row) => row.label === "Authority" && row.value === "no grant"));

console.log(JSON.stringify({
  ok: true,
  picker: picker.targetPickerId,
  state: picker.pickerState,
  candidates: picker.candidateCount,
  selectable: picker.selectableCandidateCount,
  selectedAnswer: selectedAnswer.answerState,
  staleAnswer: staleAnswer.answerState,
  rejectAnswer: rejectAnswer.answerState,
}, null, 2));
