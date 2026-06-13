#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentClassRegistry,
} = require("../src/main/direct/bridge/agent-class-spec");
const {
  buildDirectRoleHandoffPacket,
  buildDirectRoleHandoffPreview,
  stableStringify,
  validateDirectRoleHandoffPacket,
  validateDirectRoleHandoffPreview,
} = require("../src/main/direct/bridge/role-handoff-packet");
const {
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildSemanticBrokerInputSnapshot,
  buildSemanticBrokerPacket,
  buildSemanticBrokerPreflight,
  buildSemanticBrokerRegistrySnapshot,
  candidateFromRoute,
  sha256,
  validateSemanticBrokerPreflight,
} = require("../src/main/direct/governance/broker");
const {
  buildOperatorBrokerResolution,
} = require("../src/main/direct/governance/operator-broker-resolution");

const nowMs = Date.parse("2026-06-13T12:00:00.000Z");
const projectId = "project_role_handoff_fixture";
const threadId = "thread_role_handoff_fixture";
const turnId = "turn_role_handoff_fixture";

const workThread = buildWorkThread({
  projectId,
  workThreadId: "work_thread_role_handoff_fixture",
  title: "Role handoff fixture",
  currentObjective: "Prepare a role handoff packet from semantic broker evidence.",
  activeRuntimePath: "direct-implementation",
  authorityBoundary: {
    summary: "Role handoff may be previewed but cannot spawn workers or call providers.",
    forbiddenActions: ["worker_spawn_without_later_transition", "provider_call_from_handoff_preview"],
  },
}, { nowMs });

const resolution = buildWorkTargetResolution({
  projectId,
  userRequest: "hand this to the implementation worker",
  activeRuntimePath: "direct-implementation",
}, [workThread], { nowMs });
const workTargetResolutionReport = buildWorkTargetResolutionReport({
  projectId,
  resolution,
}, { nowMs });
assert.equal(workTargetResolutionReport.routingGateState, "selected_ready");

const operatorBrokerResolution = buildOperatorBrokerResolution({
  projectId,
  userRequest: "hand this to the implementation worker",
  workTargetResolutionReport,
  workThreads: [workThread],
}, { nowMs });
assert.equal(operatorBrokerResolution.selectedWorkThreadId, workThread.workThreadId);

const agentRegistry = buildAgentClassRegistry({
  projectId,
  workThreadId: workThread.workThreadId,
  nowMs,
});
const implementationWorker = agentRegistry.specs.find((spec) => spec.agentClassKind === "implementation_worker");
const primaryAgent = agentRegistry.specs.find((spec) => spec.agentClassKind === "primary_agent");
assert(implementationWorker, "implementation worker spec must exist");
assert(primaryAgent, "primary agent spec must exist");

const semanticRegistry = buildSemanticBrokerRegistrySnapshot({ projectId });
const brokerInput = buildSemanticBrokerInputSnapshot({
  projectId,
  threadId,
  turnId,
  currentUserIntentRef: {
    kind: "current_user_intent",
    artifactId: "intent_role_handoff_fixture",
    artifactDigest: sha256("intent_role_handoff_fixture"),
    sourceConfidence: "diagnostic",
    rendererSafeLabel: "Current user intent",
  },
  runtimeTierRef: {
    kind: "runtime_tier",
    artifactId: "runtime_direct_implementation",
    artifactDigest: sha256("runtime_direct_implementation"),
    sourceConfidence: "accepted",
    rendererSafeLabel: "Direct implementation runtime",
  },
});
const textRoute = semanticRegistry.routes.find((route) => route.routeKind === "text_only");
const brokerPacket = buildSemanticBrokerPacket({
  projectId,
  threadId,
  turnId,
  registrySnapshot: semanticRegistry,
  inputSnapshot: brokerInput,
  candidates: [
    candidateFromRoute(textRoute, {
      confidence: "high",
      reasonCodes: ["role_specific_handoff_requested"],
      rendererSafeSummary: "Operator request maps to a role handoff diagnostic.",
    }),
  ],
});

const routeToRolePreflight = buildSemanticBrokerPreflight({
  projectId,
  threadId,
  turnId,
  semanticBrokerPacket: brokerPacket,
  workTargetResolutionReport,
  agentClassSpec: implementationWorker,
  contextRefs: [{
    kind: "context_pack",
    artifactId: "context_pack_role_handoff_fixture",
    artifactDigest: sha256("context_pack_role_handoff_fixture"),
    sourceConfidence: "accepted",
    rendererSafeLabel: "Context pack",
  }],
  requestRefs: [{
    kind: "request_manifest",
    artifactId: "request_manifest_role_handoff_fixture",
    artifactDigest: sha256("request_manifest_role_handoff_fixture"),
    sourceConfidence: "diagnostic",
    rendererSafeLabel: "Request manifest",
  }],
});
validateSemanticBrokerPreflight(routeToRolePreflight);
assert.equal(routeToRolePreflight.recommendationClass, "route_to_role");
assert.equal(routeToRolePreflight.providerCallAllowed, false);
assert.equal(routeToRolePreflight.brokerPerformedWorkerTask, false);

const handoffPacket = buildDirectRoleHandoffPacket({
  projectId,
  threadId,
  turnId,
  semanticPreflight: routeToRolePreflight,
  operatorBrokerResolution,
  workTargetResolutionReport,
  workThread,
  agentClassSpec: implementationWorker,
  authorityBoundary: workThread.authorityBoundary,
  contextRefs: routeToRolePreflight.contextRefs,
  requestRefs: routeToRolePreflight.requestRefs,
  evidenceRefs: [{
    kind: "operator_broker_resolution",
    artifactId: operatorBrokerResolution.brokerResolutionId,
    artifactDigest: operatorBrokerResolution.brokerResolutionDigest,
    sourceConfidence: "accepted",
    rendererSafeLabel: "Operator broker resolution",
  }],
}, { nowMs });
validateDirectRoleHandoffPacket(handoffPacket);

assert.equal(handoffPacket.status, "operator_review_required");
assert.equal(handoffPacket.acceptancePosture, "operator_accept_required");
assert.equal(handoffPacket.selectedAgentClass.agentClassKind, "implementation_worker");
assert.equal(handoffPacket.expectedOutputArtifactFamily, "implementation_evidence_artifact");
assert.equal(handoffPacket.workThreadRef.workThreadId, workThread.workThreadId);
assert.equal(handoffPacket.operatorBrokerResolutionRef.brokerResolutionId, operatorBrokerResolution.brokerResolutionId);
assert.equal(handoffPacket.semanticPreflight.recommendationClass, "route_to_role");
assert.equal(handoffPacket.canAcceptInThisPr, false);
assert.equal(handoffPacket.acceptTransitionEnabled, false);
assert.equal(handoffPacket.providerCallAllowed, false);
assert.equal(handoffPacket.workerSpawnAllowed, false);
assert.equal(handoffPacket.objectAuditAllowed, false);
assert.equal(handoffPacket.workspaceMutationAllowed, false);
assert.equal(handoffPacket.providerCallPerformed, false);
assert.equal(handoffPacket.workerSpawnPerformed, false);
assert.equal(handoffPacket.objectAuditPerformed, false);
assert.equal(handoffPacket.rawTextIncluded, false);
assert.equal(handoffPacket.rawPathIncluded, false);
assert.equal(handoffPacket.rawSecretIncluded, false);
assert(handoffPacket.evidenceRefs.some((ref) => ref.kind === "operator_broker_resolution"));
assert(handoffPacket.evidenceRefs.some((ref) => ref.kind === "semantic_registry" && ref.rendererSafeLabel === "Agent class spec"));
assert.equal(
  stableStringify({ keep: true, omit: undefined, nested: { fn: () => "drop" }, arr: [undefined, Symbol("x"), 1] }),
  "{\"arr\":[null,null,1],\"keep\":true,\"nested\":{}}",
);

const datePacket = buildDirectRoleHandoffPacket({
  projectId,
  threadId,
  turnId: "turn_role_handoff_date_fixture",
  semanticPreflight: routeToRolePreflight,
  operatorBrokerResolution,
  workTargetResolutionReport,
  workThread,
  agentClassSpec: implementationWorker,
}, { nowMs: new Date(nowMs) });
validateDirectRoleHandoffPacket(datePacket);
assert.equal(datePacket.createdAt, "2026-06-13T12:00:00.000Z");

const preview = buildDirectRoleHandoffPreview(handoffPacket);
validateDirectRoleHandoffPreview(preview);
assert.equal(preview.status, "operator_review_required");
assert.equal(preview.selectedWorkThreadId, workThread.workThreadId);
assert.equal(preview.selectedAgentClass.agentClassKind, "implementation_worker");
assert.equal(preview.expectedOutputArtifactFamily, "implementation_evidence_artifact");
assert.equal(preview.canAcceptInThisPr, false);
assert.equal(preview.workerSpawnAllowed, false);
assert.equal(preview.rendererSafe, true);

const allowPreflight = buildSemanticBrokerPreflight({
  projectId,
  threadId,
  turnId: "turn_role_handoff_allow_fixture",
  semanticBrokerPacket: brokerPacket,
  workTargetResolutionReport,
  agentClassSpec: primaryAgent,
});
validateSemanticBrokerPreflight(allowPreflight);
assert.equal(allowPreflight.recommendationClass, "allow");
const blockedPacket = buildDirectRoleHandoffPacket({
  projectId,
  threadId,
  turnId: "turn_role_handoff_allow_fixture",
  semanticPreflight: allowPreflight,
  workTargetResolutionReport,
  workThread,
  agentClassSpec: primaryAgent,
}, { nowMs });
validateDirectRoleHandoffPacket(blockedPacket);
assert.equal(blockedPacket.status, "blocked");
assert(blockedPacket.blockerCodes.includes("preflight_not_route_to_role"));
assert(blockedPacket.blockerCodes.includes("primary_agent_not_role_handoff"));
assert.equal(blockedPacket.acceptancePosture, "blocked");
assert.equal(blockedPacket.providerCallAllowed, false);
assert.equal(blockedPacket.workerSpawnAllowed, false);

const mismatchedTargetPacket = buildDirectRoleHandoffPacket({
  projectId,
  threadId,
  turnId: "turn_role_handoff_mismatch_fixture",
  semanticPreflight: routeToRolePreflight,
  operatorBrokerResolution: {
    ...operatorBrokerResolution,
    selectedWorkThreadId: "work_thread_other_fixture",
  },
  workTargetResolutionReport,
  workThread,
  agentClassSpec: implementationWorker,
}, { nowMs });
validateDirectRoleHandoffPacket(mismatchedTargetPacket);
assert.equal(mismatchedTargetPacket.status, "blocked");
assert(mismatchedTargetPacket.blockerCodes.includes("work_thread_ref_mismatch"));
assert.equal(mismatchedTargetPacket.providerCallAllowed, false);
assert.equal(mismatchedTargetPacket.workerSpawnAllowed, false);

const hostilePacket = {
  ...handoffPacket,
  providerCallAllowed: true,
};
assert.throws(
  () => validateDirectRoleHandoffPacket(hostilePacket),
  /direct_role_handoff_packet_authority_leak:providerCallAllowed/,
);

const rawSerialized = JSON.stringify({ handoffPacket, preview, blockedPacket });
assert(!rawSerialized.includes("rawTextIncluded\":true"), "handoff artifacts must not include raw text");
assert(!rawSerialized.includes("rawPathIncluded\":true"), "handoff artifacts must not include raw paths");
assert(!rawSerialized.includes("rawSecretIncluded\":true"), "handoff artifacts must not include raw secrets");

console.log(JSON.stringify({
  ok: true,
  handoffPacketId: handoffPacket.handoffPacketId,
  packetDigest: handoffPacket.packetDigest,
  previewDigest: preview.previewDigest,
  blockedPacketStatus: blockedPacket.status,
}, null, 2));
