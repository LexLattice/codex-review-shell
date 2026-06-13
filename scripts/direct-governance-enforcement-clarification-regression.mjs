#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildOperatorBrokerResolution,
} = require("../src/main/direct/governance/operator-broker-resolution");
const {
  buildGovernanceEnforcementPreflight,
  validateGovernanceEnforcementPreflight,
} = require("../src/main/direct/governance/enforcement-gate");

const nowMs = Date.parse("2026-06-13T15:30:00.000Z");
const projectId = "codex-review-shell-direct";
const branchName = "codex/direct-chatgpt-harness";

function directWorkThread(overrides = {}) {
  return buildWorkThread({
    workThreadId: "work_thread_direct_bridge",
    projectId,
    title: "Direct information bridge implementation",
    objective: {
      summary: "Build direct harness governance transitions.",
      currentObjective: "Promote broker preconditions before mutation.",
    },
    branchIdentity: {
      branchName,
      branchEvidenceKey: "branch_direct_harness",
    },
    workspaceIdentity: {
      workspaceKind: "wsl",
      workspaceEvidenceKey: "workspace_direct_harness",
    },
    activeRuntimePath: "direct-implementation",
    authorityBoundary: {
      allowedActions: ["provider_call", "workspace_mutation", "tool_transition"],
      forbiddenActions: ["mutate_unresolved_work_thread", "route_by_chat_recency_only"],
      summary: "Direct harness work may mutate only after WorkThread resolution and branch confirmation.",
      evidenceRefs: [{ kind: "authority_contract", id: "auth_direct_bridge" }],
    },
    linkedCodexThreads: [{ threadId: "codex_direct_thread", title: "Direct path implementation" }],
    linkedChatGptThreads: [{ threadId: "gpt_direct_review", title: "Direct path review" }],
    openObligations: [
      { obligationId: "obl_governance_enforcement", kind: "governance", status: "open", summary: "Resolve target before mutation." },
    ],
    evidenceRefs: [{ kind: "roadmap", id: "direct_information_bridge_wave_roadmap" }],
    ...overrides,
  }, { nowMs });
}

function docsWorkThread(overrides = {}) {
  return buildWorkThread({
    workThreadId: "work_thread_direct_docs",
    projectId,
    title: "Direct documentation alignment",
    objective: "Keep direct branch docs aligned with implementation waves.",
    branchIdentity: {
      branchName,
      branchEvidenceKey: "branch_direct_harness",
    },
    activeRuntimePath: "direct-text",
    authorityBoundary: {
      allowedActions: ["provider_call"],
      forbiddenActions: ["workspace_mutation"],
      summary: "Documentation alignment is read/provider-only unless a separate mutation contract exists.",
    },
    openObligations: [
      { obligationId: "obl_docs", kind: "documentation", status: "open", summary: "Update direct roadmap docs." },
    ],
    ...overrides,
  }, { nowMs });
}

function brokerFor(request, workThreads) {
  return buildOperatorBrokerResolution({
    projectId,
    branchName,
    activeRuntimePath: request.activeRuntimePath,
    codexThreadId: request.codexThreadId,
    chatGptThreadId: request.chatGptThreadId,
    userRequest: request.userRequest,
    workspaceIdentity: {
      workspaceKind: "wsl",
      workspaceEvidenceKey: "workspace_direct_harness",
    },
    branchIdentity: {
      branchName,
      branchEvidenceKey: "branch_direct_harness",
    },
    openObligations: [{
      obligationId: "obl_governance_enforcement",
      kind: "governance",
      status: "open",
      summary: "Resolve target before mutation.",
      evidenceRefs: [{ kind: "obligation", id: "obl_governance_enforcement" }],
    }],
  }, workThreads, { nowMs });
}

const clearWorkThread = directWorkThread();
const docsThread = docsWorkThread();
const clearBroker = brokerFor({
  activeRuntimePath: "direct-implementation",
  codexThreadId: "codex_direct_thread",
  chatGptThreadId: "gpt_direct_review",
  userRequest: "continue governance enforcement for the direct information bridge implementation",
}, [clearWorkThread, docsThread]);

const clearMutationGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "workspace_mutation",
  workThread: clearWorkThread,
  workTargetResolutionReport: clearBroker.workTargetResolutionReport,
  operatorBrokerResolution: clearBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(clearMutationGate);
assert.equal(clearMutationGate.gateState, "allowed");
assert.equal(clearMutationGate.allowed, true);
assert.equal(clearMutationGate.workspaceMutationAllowed, true);
assert.equal(clearMutationGate.providerTransportAllowed, false);
assert.equal(clearMutationGate.executionAuthorityGranted, false);
assert.equal(clearMutationGate.brokerPerformedObjectAudit, false);
assert.equal(clearMutationGate.selectedWorkThreadId, "work_thread_direct_bridge");
assert(clearMutationGate.nonTargetPreservationConstraints.includes("preserve_non_target_workthreads"));

const clearProviderGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "provider_call",
  workThread: clearWorkThread,
  workTargetResolutionReport: clearBroker.workTargetResolutionReport,
  operatorBrokerResolution: clearBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(clearProviderGate);
assert.equal(clearProviderGate.gateState, "allowed");
assert.equal(clearProviderGate.providerTransportAllowed, true);
assert.equal(clearProviderGate.workspaceMutationAllowed, false);

const ambiguousBroker = brokerFor({
  activeRuntimePath: "direct-text",
  userRequest: "continue direct work",
}, [clearWorkThread, docsThread]);
const ambiguousGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "provider_call",
  workThread: clearWorkThread,
  workTargetResolutionReport: ambiguousBroker.workTargetResolutionReport,
  operatorBrokerResolution: ambiguousBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(ambiguousGate);
assert.equal(ambiguousGate.gateState, "clarification_required");
assert.equal(ambiguousGate.providerTransportAllowed, false);
assert.equal(ambiguousGate.workspaceMutationAllowed, false);
assert(ambiguousGate.blockerCodes.includes("operator_broker_clarification_required"));
assert(ambiguousGate.clarificationPacket.blockerCodes.includes("operator_broker_clarification_required"));
assert(ambiguousGate.clarificationPacket.nonTargetPreservationConstraints.includes("ask_operator_for_clarification"));

const wrongBranchGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "workspace_mutation",
  workThread: clearWorkThread,
  workTargetResolutionReport: clearBroker.workTargetResolutionReport,
  operatorBrokerResolution: clearBroker,
  activeBranchName: "codex/wrong-branch",
}, { nowMs });
validateGovernanceEnforcementPreflight(wrongBranchGate);
assert.equal(wrongBranchGate.gateState, "blocked");
assert.equal(wrongBranchGate.workspaceMutationAllowed, false);
assert(wrongBranchGate.blockerCodes.includes("branch_mismatch"));

const missingAuthorityThread = directWorkThread({
  workThreadId: "work_thread_no_authority",
  title: "Direct bridge without authority boundary",
  authorityBoundary: {
    allowedActions: [],
    forbiddenActions: [],
    summary: "",
    evidenceRefs: [],
  },
  linkedCodexThreads: [{ threadId: "codex_no_authority", title: "No authority" }],
});
const missingAuthorityBroker = brokerFor({
  activeRuntimePath: "direct-implementation",
  codexThreadId: "codex_no_authority",
  userRequest: "continue governance enforcement for the direct bridge without authority",
}, [missingAuthorityThread]);
const missingAuthorityGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "tool_transition",
  workThread: missingAuthorityThread,
  workTargetResolutionReport: missingAuthorityBroker.workTargetResolutionReport,
  operatorBrokerResolution: missingAuthorityBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(missingAuthorityGate);
assert.equal(missingAuthorityGate.gateState, "blocked");
assert.equal(missingAuthorityGate.toolTransitionAllowed, false);
assert(missingAuthorityGate.blockerCodes.includes("authority_boundary_missing"));

const mismatchGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "provider_call",
  workThread: docsThread,
  workTargetResolutionReport: clearBroker.workTargetResolutionReport,
  operatorBrokerResolution: clearBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(mismatchGate);
assert.equal(mismatchGate.gateState, "blocked");
assert.equal(mismatchGate.providerTransportAllowed, false);
assert(mismatchGate.blockerCodes.includes("operator_broker_work_thread_mismatch"));

const unknownTransitionGate = buildGovernanceEnforcementPreflight({
  projectId,
  transitionKind: "not_a_known_transition",
  workThread: clearWorkThread,
  workTargetResolutionReport: clearBroker.workTargetResolutionReport,
  operatorBrokerResolution: clearBroker,
  activeBranchName: branchName,
}, { nowMs });
validateGovernanceEnforcementPreflight(unknownTransitionGate);
assert.equal(unknownTransitionGate.gateState, "blocked");
assert.equal(unknownTransitionGate.allowed, false);
assert(unknownTransitionGate.blockerCodes.includes("unsupported_transition_kind"));

console.log(JSON.stringify({
  ok: true,
  clearMutationGate: clearMutationGate.gateState,
  clearProviderGate: clearProviderGate.gateState,
  ambiguousGate: ambiguousGate.gateState,
  wrongBranchGate: wrongBranchGate.gateState,
  missingAuthorityGate: missingAuthorityGate.gateState,
  mismatchGate: mismatchGate.gateState,
  unknownTransitionGate: unknownTransitionGate.gateState,
}, null, 2));
