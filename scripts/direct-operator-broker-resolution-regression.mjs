#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertOperatorBrokerProjectionSafe,
  assertOperatorBrokerResolutionSafe,
  buildOperatorBrokerResolution,
  buildOperatorBrokerResolutionProjection,
} = require("../src/main/direct/governance/operator-broker-resolution");
const {
  buildControlledRoutingSlice,
  validateControlledRoutingSlice,
} = require("../src/main/direct/bridge/controlled-routing");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");

const nowMs = Date.parse("2026-06-13T12:00:00.000Z");
const projectId = "codex-review-shell-direct";

function directWorkThread() {
  return buildWorkThread({
    workThreadId: "work_thread_direct_bridge",
    projectId,
    title: "Direct information bridge implementation",
    objective: {
      summary: "Build the direct harness as a unified information bridge.",
      currentObjective: "Implement operator broker resolution over active WorkThreads.",
    },
    workspaceIdentity: {
      workspaceKind: "wsl",
      workspaceEvidenceKey: "workspace_codex_review_shell_direct",
      workspaceRoot: "/home/rose/private/not-exported",
    },
    branchIdentity: {
      branchName: "codex/direct-chatgpt-harness",
      branchEvidenceKey: "branch_direct_harness",
    },
    activeRuntimePath: "direct-implementation",
    linkedCodexThreads: [
      { threadId: "codex_direct_thread", title: "Direct path implementation", status: "active" },
    ],
    linkedChatGptThreads: [
      { threadId: "gpt_direct_review", title: "Direct path review", status: "linked" },
    ],
    openObligations: [
      { obligationId: "obl_operator_broker", kind: "governance", status: "open", summary: "Resolve target work thread before mutation." },
    ],
    evidenceRefs: [{ kind: "roadmap", id: "direct_information_bridge_wave_roadmap", confidence: "accepted" }],
  }, { nowMs });
}

function docsWorkThread() {
  return buildWorkThread({
    workThreadId: "work_thread_direct_docs",
    projectId,
    title: "Direct documentation alignment",
    objective: "Keep direct branch docs aligned with implementation waves.",
    branchIdentity: {
      branchName: "codex/direct-chatgpt-harness",
      branchEvidenceKey: "branch_direct_harness",
    },
    activeRuntimePath: "direct-text",
    openObligations: [
      { obligationId: "obl_docs", kind: "documentation", status: "open", summary: "Update implementation ledger docs." },
    ],
  }, { nowMs });
}

const workThreads = [directWorkThread(), docsWorkThread()];

const selectedResolution = buildOperatorBrokerResolution({
  projectId,
  branchName: "codex/direct-chatgpt-harness",
  codexThreadId: "codex_direct_thread",
  chatGptThreadId: "gpt_direct_review",
  activeRuntimePath: "direct-implementation",
  userRequest: "continue the operator broker resolution implementation in the direct information bridge",
  workspaceIdentity: {
    workspaceKind: "wsl",
    workspaceEvidenceKey: "workspace_codex_review_shell_direct",
    workspaceRoot: "/home/rose/private/not-exported",
  },
  branchIdentity: {
    branchName: "codex/direct-chatgpt-harness",
    branchEvidenceKey: "branch_direct_harness",
  },
  linkedCodexThreads: [{ threadId: "codex_direct_thread", title: "Direct path implementation" }],
  linkedChatGptThreads: [{ threadId: "gpt_direct_review", title: "Direct path review" }],
  openObligations: [{ obligationId: "obl_operator_broker", kind: "governance", status: "open", summary: "Resolve target before mutation." }],
  recentContextRefs: [{ kind: "context_packet", id: "ctx_direct_broker", label: "Recent direct broker packet" }],
}, workThreads, { nowMs });

assertOperatorBrokerResolutionSafe(selectedResolution);
assert.equal(selectedResolution.schema, "operator_broker_resolution@1");
assert.equal(selectedResolution.resolutionState, "selected");
assert.equal(selectedResolution.routingGateState, "selected_ready");
assert.equal(selectedResolution.selectedWorkThreadId, "work_thread_direct_bridge");
assert.equal(selectedResolution.clarificationRequired, false);
assert.equal(selectedResolution.authority.mutationAuthorityGranted, false);
assert.equal(selectedResolution.authority.providerCallAuthorityGranted, false);
assert.equal(selectedResolution.authority.routingEnforced, false);
assert.equal(selectedResolution.workWorldSnapshot.workspaceIdentity.rawPathIncluded, false);
assert.equal(selectedResolution.rawPathIncluded, false);
assert(selectedResolution.nonTargetPreservationConstraints.includes("do_not_route_by_chat_recency_only"));
assert(selectedResolution.downstreamRoutePacketConstraints.constraintCodes.includes("preserve_non_target_workthreads"));

const selectedProjection = buildOperatorBrokerResolutionProjection(selectedResolution);
assertOperatorBrokerProjectionSafe(selectedProjection);
assert.equal(selectedProjection.schema, "operator_broker_resolution_projection@1");
assert.equal(selectedProjection.resolutionState, "selected");
assert.equal(selectedProjection.selectedWorkThreadId, "work_thread_direct_bridge");
assert.equal(selectedProjection.authority.workspaceMutationAllowed, false);
assert.equal(selectedProjection.workWorld.linkedCodexThreadCount, 1);

const ambiguousResolution = buildOperatorBrokerResolution({
  projectId,
  userRequest: "continue direct work",
  branchName: "codex/direct-chatgpt-harness",
}, workThreads, { nowMs });
assertOperatorBrokerResolutionSafe(ambiguousResolution);
assert.notEqual(ambiguousResolution.resolutionState, "selected");
assert.equal(ambiguousResolution.selectedWorkThreadId, "");
assert.equal(ambiguousResolution.clarificationRequired, true);
assert.equal(ambiguousResolution.downstreamRoutePacketConstraints.providerCallBlocked, true);
assert.equal(ambiguousResolution.downstreamRoutePacketConstraints.workspaceMutationBlocked, true);
assert(ambiguousResolution.nonTargetPreservationConstraints.includes("ask_operator_for_clarification"));

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  operatorBroker: selectedProjection,
  workThreads: {
    projection: {
      schema: "direct_work_thread_projection@1",
      rowCount: 2,
      activeCount: 2,
      projectionDigest: "sha256:workthreads",
    },
  },
});
assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert.equal(settingsProjection.sections.operatorBroker.available, true);
assert.equal(settingsProjection.sections.operatorBroker.selectedWorkThreadId, "work_thread_direct_bridge");
assert(settingsProjection.bridgeOrgans.includes("operator_broker"));
assert(settingsProjection.rows.operatorBroker.some((row) => row.label === "Clarification"));

const routed = buildControlledRoutingSlice({
  projectId,
  threadId: "thread_operator_broker",
  turnId: "turn_selected_broker",
  requestPreview: "continue the operator broker resolution implementation in the direct information bridge",
  workThread: workThreads[0],
  operatorBrokerResolution: selectedResolution,
}, { nowMs });
validateControlledRoutingSlice(routed.route);
assert.equal(routed.route.gateState, "ready_for_direct_text_turn");
assert.equal(routed.route.operatorBrokerResolution.brokerResolutionDigest, selectedResolution.brokerResolutionDigest);
assert(routed.route.nonTargetPreservationConstraints.includes("preserve_non_target_workthreads"));
assert(routed.route.evidenceRefs.some((ref) => ref.kind === "operator_broker_resolution"));

const blockedByBroker = buildControlledRoutingSlice({
  projectId,
  threadId: "thread_operator_broker",
  turnId: "turn_ambiguous_broker",
  requestPreview: "continue the operator broker resolution implementation in the direct information bridge",
  workThread: workThreads[0],
  operatorBrokerResolution: ambiguousResolution,
}, { nowMs });
validateControlledRoutingSlice(blockedByBroker.route);
assert.equal(blockedByBroker.route.gateState, "blocked");
assert.equal(blockedByBroker.route.controlledProviderCallAllowed, false);
assert(blockedByBroker.route.blockerCodes.includes("operator_broker_clarification_required"));

console.log(JSON.stringify({
  ok: true,
  selected: selectedResolution.selectedWorkThreadId,
  selectedGate: selectedResolution.routingGateState,
  ambiguousGate: ambiguousResolution.routingGateState,
  settingsRows: settingsProjection.rows.operatorBroker.length,
  routedGate: routed.route.gateState,
  blockedGate: blockedByBroker.route.gateState,
}, null, 2));
