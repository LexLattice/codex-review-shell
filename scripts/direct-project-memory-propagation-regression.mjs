#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { buildWorkThread } = require("../src/main/direct/bridge/work-thread-registry.js");
const { buildOdeuResultEnvelope } = require("../src/main/direct/odeu/result.js");
const {
  applyWorldToProjectUpdatePacket,
  admitProjectMemoryCandidate,
  buildCrossProjectMemoryEscalation,
  buildGovernanceProvenanceRegistry,
  buildHierarchicalWorldmodelGraph,
  buildWorldmodelTrustAnchor,
  buildProjectGraphUpdateAcknowledgement,
  buildProjectManagerProfile,
  buildProjectMemoryCandidate,
  buildProjectToWorldStatusProjection,
  buildProjectUpdateImpactWitness,
  buildScopedWorldMemoryBinding,
  buildScopedWorldmodelRevisionRef,
  buildWorkThreadClosureEvidenceWitness,
  buildWorldToProjectUpdatePacket,
  buildWorldmodelContextualAuthorityDecision,
  createWorldmodelTrustStore,
  evaluateProjectionMateriality,
  promoteCrossProjectMemoryEscalation,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  validateCrossProjectMemoryEscalation,
  validateProjectGraphUpdateAcknowledgement,
  validateProjectMemoryAdmission,
  validateProjectMemoryCandidate,
  validateProjectToWorldStatusProjection,
  validateProjectUpdateImpactWitness,
  validateScopedWorldMemoryBinding,
  validateWorkThreadClosureEvidenceWitness,
  validateWorldToProjectUpdatePacket,
  registryRef,
} = require("../src/main/direct/worldmodel");

const now = () => Date.UTC(2026, 6, 15, 12, 0, 0);
const source = (id, sourceKind = "family_specific") => ({ sourceRefId: `ref_${id}`, sourceKind, sourceId: id, sourceConfidence: "exact", freshness: "fresh", observedAt: "2026-07-15T12:00:00.000Z", sourceDigest: { algorithm: "sha256", value: `sha256:${id}`, digestOf: "canonical_json" } });
const ref = (kind, id) => ({ kind, id, digest: `sha256:${id}`, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false });
const throws = (fn, code) => assert.throws(fn, (error) => error?.code === code);

const projectId = "project_fixture";
const graphId = "project_memory_graph";
const trustDirectory = mkdtempSync(join(tmpdir(), "wave26-project-memory-trust-"));
const trustStore = createWorldmodelTrustStore(trustDirectory, { storeId: "project_memory_trust_store", now });
const graph = buildHierarchicalWorldmodelGraph({
  graphId, userProfileId: "user_fixture", rootNodeId: "user_root", trustAnchorRef: buildWorldmodelTrustAnchor(trustStore, graphId),
  scopedRevisionRefs: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId, revision: 0 })],
  nodes: [
    { nodeId: "user_root", scope: { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["user"] }, nodeKind: "world_root", abstractionLevel: "world", semanticSummary: "User world", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"], projectionEligibility: "eligible", sourceRefs: [source("root")] },
    { nodeId: "project_root", scope: { scopeKind: "project", userProfileId: "user_fixture", projectId, semanticPath: ["projects", projectId] }, nodeKind: "project_root", abstractionLevel: "strategic", semanticSummary: "Project root", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: [source("project_root")] },
  ],
}, { now });
const manager = buildProjectManagerProfile({ projectManagerProfileId: "pm_profile", projectManagerAgentId: "pm_agent", worldManagerAgentId: "wm_agent", projectId, projectRootNodeId: "project_root", authorityBoundaryRef: ref("authority_boundary", "pm_boundary"), graphProjectionPolicyRef: ref("graph_projection_policy", "projection_policy"), sourceRefs: [source("pm_profile")] }, { now });
const workThread = buildWorkThread({ workThreadId: "work_thread_fixture", projectId, lifecycleState: "completed", objective: "Closed project-memory evidence" }, { nowMs: now() });
const closureIdentity = { managerProfileId: manager.projectManagerProfileId, managerAgentId: manager.projectManagerAgentId, runId: "closure_run", callId: "closure_call" };
const closureResultEnvelope = buildOdeuResultEnvelope({ resultEnvelopeId: "closure_result_fixture", capabilityId: "closure_capability", callId: "closure_call", transactionId: "closure_run", resultKind: "agent_result", sourceRefs: [source("closure_result_source")], rendererSafeSummary: "Closure evidence admitted.", visibility: { rendererVisible: "summary", residentVisible: "summary", providerVisible: "not_seen", transcriptVisible: "none" }, payloadPolicy: { rawPayloadStored: false, rawPayloadProviderSent: false, rawPayloadRendererVisible: false, redactionState: "none_needed", truncationState: "none" }, rawTextIncluded: false, rawPathIncluded: false, rawProviderPayloadIncluded: false, confidence: "exact" }, { now });
const closure = buildWorkThreadClosureEvidenceWitness({ projectId, witnessId: "work_thread_closure_fixture", workThread, closureResultEnvelope, closureIdentity, sourceRefs: [source("closure_evidence")] }, { now });
validateWorkThreadClosureEvidenceWitness(closure, { workThread, closureResultEnvelope, closureIdentity });
throws(() => buildWorkThreadClosureEvidenceWitness({ projectId, workThread: { ...workThread, digest: "sha256:forged" }, closureResultEnvelope, closureIdentity }, { now }), "direct_project_memory_closure_work_thread_invalid");
throws(() => buildWorkThreadClosureEvidenceWitness({ projectId, workThread: { ...workThread, lifecycleState: "active" }, closureResultEnvelope, closureIdentity }, { now }), "direct_project_memory_closure_work_thread_invalid");
throws(() => validateWorkThreadClosureEvidenceWitness(closure, { workThread, closureResultEnvelope: { ...closureResultEnvelope, resultEnvelopeId: "wrong_result" } }), "direct_project_memory_closure_binding_mismatch");
throws(() => validateWorkThreadClosureEvidenceWitness({ ...closure, closureReportRef: { ...closure.closureReportRef, sourceDigest: { ...closure.closureReportRef.sourceDigest, value: "sha256:forged" } } }, { workThread, closureResultEnvelope }), "direct_project_memory_closure_binding_mismatch");
throws(() => validateWorkThreadClosureEvidenceWitness(closure, { workThread, closureResultEnvelope, closureIdentity: { ...closureIdentity, callId: "wrong_call" } }), "direct_project_memory_closure_identity_mismatch");
const closureEvidenceContexts = [{ witness: closure, workThread, closureResultEnvelope, closureIdentity }];
const candidate = buildProjectMemoryCandidate({ candidateId: "memory_candidate", projectId, projectManagerAgentId: "pm_agent", closureEvidenceContexts, candidateKind: "decision", proposedSemanticPath: ["projects", projectId, "memory", "decisions"], proposedNode: { nodeId: "memory_decision", graphId: graph.graphId, nodeKind: "decision", abstractionLevel: "strategic", semanticSummary: "Use admitted project memory only.", odeuImpact: {}, epistemicStatus: "accepted", normativeForce: "project_commitment", projectionEligibility: "eligible" }, expectedProjectRevision: 0, sourceRefs: [source("memory_evidence")] }, { now });
validateProjectMemoryCandidate(candidate, { closureEvidenceContexts });
assert.equal(candidate.candidateIsProjectTruth, false, "closure evidence is not project truth before admission");
throws(() => buildProjectMemoryCandidate({ projectId, projectManagerAgentId: "pm_agent", sourceRefs: [source("missing_closure")] }, { now }), "direct_project_memory_missing_array");
throws(() => validateProjectMemoryCandidate(candidate), "direct_project_memory_missing_array");
throws(() => validateProjectMemoryCandidate({ ...candidate, candidateIsProjectTruth: true }, { closureEvidenceContexts }), "direct_project_memory_candidate_authority_violation");
throws(() => validateProjectMemoryCandidate({ ...candidate, expectedProjectRevision: 3 }, { closureEvidenceContexts }), "direct_project_memory_digest_mismatch");
const wrongManager = buildProjectManagerProfile({ ...manager, projectManagerProfileId: "wrong_pm_profile", projectManagerAgentId: "wrong_pm_agent" }, { now });
const mismatchedManagerAdmission = admitProjectMemoryCandidate({ candidate, graph, projectManagerProfile: wrongManager, closureEvidenceContexts, decision: "admit", custodyWriteWitness: { bad: true }, authorityTraceRef: source("separate_promotion_authority", "promotion_decision") }, { now });
assert.equal(mismatchedManagerAdmission.admission.decision, "remand");

const custodyMatrix = require("../src/main/direct/worldmodel").buildProjectCustodyWriteMatrix({ projectId });
const custodyWriteWitness = require("../src/main/direct/worldmodel").buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: "project_manager", path: "project.memory.decisions", action: "mutate" });
const memoryTargetScope = { scopeKind: "project", userProfileId: graph.userProfileId, projectId, semanticPath: candidate.proposedSemanticPath };
const memoryAuthorityDecision = buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: "memory_candidate_authority", graph, managerProfile: manager, actorAgentId: manager.projectManagerAgentId, actorRole: "project_manager", targetScope: memoryTargetScope, issuedAt: "2026-07-15T12:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
const projectRoot = graph.nodes.find((entry) => entry.nodeId === manager.projectRootNodeId);
const projectRevision = graph.scopedRevisionRefs.find((entry) => entry.scopeKind === "project" && entry.projectId === projectId);
const memoryBinding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId, projectRootNodeId: projectRoot.nodeId, role: "project_manager", agentId: manager.projectManagerAgentId, purpose: "graph_append", expectedScopeRevisionDigest: projectRevision.digest };
const memoryGovernanceRegistry = buildGovernanceProvenanceRegistry({ registryId: "memory_admission_registry", userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: manager, binding: memoryBinding }, { kind: "project_root", body: projectRoot, binding: memoryBinding }, { kind: "custody_matrix", body: custodyMatrix, binding: memoryBinding }, { kind: "custody_witness", body: custodyWriteWitness, binding: memoryBinding }, { kind: "authority_decision", body: memoryAuthorityDecision, binding: memoryBinding, oneShot: true }] }, { now });
initializeAuthoritativeWorldmodelGraph(trustStore, graph, memoryGovernanceRegistry);
const memoryRequiredArtifacts = [
  { kind: "project_manager_profile", id: manager.projectManagerProfileId, digest: manager.profileDigest },
  { kind: "authority_decision", id: memoryAuthorityDecision.authorityDecisionId, digest: memoryAuthorityDecision.digest, oneShot: true },
  { kind: "project_root", id: projectRoot.nodeId, digest: projectRoot.digest },
  { kind: "custody_matrix", id: custodyMatrix.matrixId, digest: custodyMatrix.matrixDigest },
  { kind: "custody_witness", id: custodyWriteWitness.path, digest: custodyWriteWitness.writeWitnessDigest },
];
const memoryStoreAdmission = admitWorldmodelGovernanceRequest(trustStore, { admissionId: "memory_candidate_store_admission", graph, context: { ...memoryBinding, requiredArtifacts: memoryRequiredArtifacts }, issuedAt: "2026-07-15T12:00:00.000Z" });
const admitted = admitProjectMemoryCandidate({ candidate, graph, projectManagerProfile: manager, closureEvidenceContexts, decision: "admit", custodyMatrix, custodyWriteWitness, authorityDecision: memoryAuthorityDecision, governanceRegistry: memoryGovernanceRegistry, registryRef: registryRef(memoryGovernanceRegistry), expectedRegistryRevision: memoryGovernanceRegistry.revision, storeAdmission: memoryStoreAdmission, authorityTraceRef: source("separate_promotion_authority", "promotion_decision") }, { now });
validateProjectMemoryAdmission(admitted.admission);
assert.equal(admitted.committed, true);
assert.equal(admitted.admission.decision, "admit");
assert.equal(admitted.governanceRegistry.revision, memoryGovernanceRegistry.revision + 1, "memory admission returns the consumed current registry snapshot");
assert.equal(admitted.governanceRegistry.records.find((entry) => entry.kind === "authority_decision").consumed, true);
assert.equal(admitted.graph.scopedRevisionRefs.find((entry) => entry.projectId === projectId).revision, 1, "PR153 CAS advances only the project revision");
assert.equal(admitted.graph.nodes.find((node) => node.nodeId === "memory_decision").lifecycle, "active");

for (const [state, legacy, graphProjection] of [["graph_primary", false, true], ["legacy_memory_primary", true, false], ["migration_pending", false, false], ["agent_private_unpromoted", true, false]]) {
  const binding = buildScopedWorldMemoryBinding({ bindingId: `binding_${state}`, memoryId: `memory_${state}`, memoryArtifactRef: source(`memory_artifact_${state}`), semanticNodeId: "memory_decision", semanticNodeDigest: admitted.graph.nodes.find((node) => node.nodeId === "memory_decision").digest, homeScope: state === "agent_private_unpromoted" ? "agent_private" : "project", projectId, custodianRole: state === "agent_private_unpromoted" ? "agent" : "project_manager", compatibilityState: state, sourceRefs: [source(`binding_${state}`)] }, { now });
  validateScopedWorldMemoryBinding(binding, state === "graph_primary" ? { graph: admitted.graph } : {}); assert.equal(binding.mayEnterContextThroughLegacyMemoryProjection, legacy); assert.equal(binding.mayEnterContextThroughGraphProjection, graphProjection);
}
const graphBinding = buildScopedWorldMemoryBinding({ memoryArtifactRef: source("double_memory"), sourceRefs: [source("double_binding")], projectId, semanticNodeId: "memory_decision", semanticNodeDigest: admitted.graph.nodes.find((node) => node.nodeId === "memory_decision").digest });
throws(() => validateScopedWorldMemoryBinding({ ...graphBinding, mayEnterContextThroughLegacyMemoryProjection: true }), "direct_project_memory_double_inclusion_forbidden");
throws(() => buildScopedWorldMemoryBinding({ memoryArtifactRef: source("unknown_scope_memory"), homeScope: "unknown", sourceRefs: [source("unknown_scope_binding")] }, { now }), "direct_project_memory_binding_state_invalid");

const packet = buildWorldToProjectUpdatePacket({ updatePacketId: "goal_packet", projectId, sourceGraphTransitionRefs: [source("world_transition")], affectedNodeRefs: [source("goal_node")], affectedEdgeRefs: [], updateKind: "goal_change", changeClass: "terminal_goal_contradiction", normativeForce: "binding", expectedProjectRevision: 1, resultingProjectRevision: 1, sourceRefs: [source("packet_evidence")] }, { now });
validateWorldToProjectUpdatePacket(packet);
const immediatePacket = buildWorldToProjectUpdatePacket({ updatePacketId: "architecture_packet", projectId, sourceGraphTransitionRefs: [source("architecture_transition")], affectedNodeRefs: [source("architecture_node")], affectedEdgeRefs: [], updateKind: "goal_change", changeClass: "active_goal_change", impactPosture: { kind: "evidence_backed_immediate", evidenceRefs: [source("impact_evidence_ref")] }, normativeForce: "binding", expectedProjectRevision: 1, resultingProjectRevision: 1, sourceRefs: [source("architecture_packet_evidence")] }, { now });
validateWorldToProjectUpdatePacket(immediatePacket); assert.equal(immediatePacket.materiality, "immediate_rebase");
throws(() => buildWorldToProjectUpdatePacket({ projectId, sourceGraphTransitionRefs: [source("bad_transition")], updateKind: "goal_change", changeClass: "active_goal_change", impactPosture: { kind: "evidence_backed_immediate", evidenceRefs: [] }, sourceRefs: [source("bad_packet")] }, { now }), "direct_project_memory_evidence_required");
throws(() => validateWorldToProjectUpdatePacket({ ...packet, sourceGraphTransitionRefs: [{ ...packet.sourceGraphTransitionRefs[0], sourceDigest: { ...packet.sourceGraphTransitionRefs[0].sourceDigest, value: "sha256:forged" } }] }), "direct_project_memory_digest_mismatch");
throws(() => buildProjectGraphUpdateAcknowledgement({ packet, projectManagerProfile: manager, outcome: "applied", affectedWorkThreadRefs: [ref("work_thread", "work_thread_fixture")], sourceRefs: [source("ack_evidence")] }, { now }), "direct_project_memory_ack_authoritative_admission_required");
throws(() => buildProjectGraphUpdateAcknowledgement({ packet, projectManagerProfile: manager, outcome: "applied", destinationTransition: { outcome: "committed", transitionId: "unrelated_semantic_promotion", digest: "sha256:unrelated_semantic_promotion" }, affectedWorkThreadRefs: [ref("work_thread", "work_thread_fixture")], sourceRefs: [source("unrelated_transition_ack")] }, { now, _controllerAdmission: true }), "direct_project_memory_ack_authoritative_admission_required");
const acknowledgement = buildProjectGraphUpdateAcknowledgement({ packet, projectManagerProfile: manager, outcome: "stale_remand", affectedWorkThreadRefs: [ref("work_thread", "work_thread_fixture")], sourceRefs: [source("ack_evidence")] }, { now });
validateProjectGraphUpdateAcknowledgement(acknowledgement, { packet, projectManagerProfile: manager });
throws(() => validateProjectGraphUpdateAcknowledgement({ ...acknowledgement, projectId: "other_project" }, { packet, projectManagerProfile: manager }), "direct_project_memory_ack_packet_mismatch");
const newerProjectAck = applyWorldToProjectUpdatePacket({ packet, projectManagerProfile: manager, currentProjectRevision: 2, affectedWorkThreadRefs: [ref("work_thread", "work_thread_fixture")] }, { now });
assert.equal(newerProjectAck.outcome, "stale_remand", "a parent packet cannot overwrite newer project operational state");
throws(() => applyWorldToProjectUpdatePacket({ packet, projectManagerProfile: buildProjectManagerProfile({ ...manager, projectId: "other_project", projectManagerProfileId: "other_pm", projectManagerAgentId: "other_pm_agent" }, { now }), currentProjectRevision: 1 }, { now }), "direct_project_memory_packet_manager_project_mismatch");

const status = buildProjectToWorldStatusProjection({ projectId, projectRevision: 1, terminalGoalNodeRefs: [ref("worldmodel_semantic_node", "goal")], currentPhase: "implementation", progressSummaryNodeRef: ref("worldmodel_semantic_node", "status"), activeWorkThreadRefs: [ref("work_thread", "work_thread_fixture")], blockerRefs: [], profileNeedRefs: [], crossProjectCandidateRefs: [], strategicChangeRefs: [ref("worldmodel_semantic_node", "decision")], sourceRefs: [source("status_evidence")] }, { now });
validateProjectToWorldStatusProjection(status);
assert.equal(status.rawProjectMemoryIncluded, false); assert.equal(status.rawWorkThreadEvidenceIncluded, false);
assert.equal(evaluateProjectionMateriality({ event: "authority_revocation" }).impact, "immediate_rebase_block");
assert.equal(evaluateProjectionMateriality({ event: "active_architecture_change" }).impact, "next_safe_checkpoint");
assert.equal(evaluateProjectionMateriality({ event: "ordinary_idea" }).impact, "next_manager_turn");
assert.equal(evaluateProjectionMateriality({ event: "historical_only" }).impact, "no_invalidation");
assert.equal(evaluateProjectionMateriality({ projectAffected: false }).impact, "unaffected");
const impact = buildProjectUpdateImpactWitness({ packet, event: "terminal_goal_contradiction", affectedWorkThreadRefs: [ref("work_thread", "work_thread_fixture")], affectedBootPacketRefs: [ref("worker_boot_packet", "boot_fixture")], sourceRefs: [source("impact_evidence")] }, { now });
validateProjectUpdateImpactWitness(impact, { packet }); assert.equal(impact.blockWorkThreads, true); assert.equal(impact.rebaseBootPackets, true);

const escalation = buildCrossProjectMemoryEscalation({ candidate, closureEvidenceContexts, sourceRefs: [source("cross_evidence")] }, { now });
validateCrossProjectMemoryEscalation(escalation);
throws(() => promoteCrossProjectMemoryEscalation(escalation), "direct_project_memory_cross_project_auto_promotion_forbidden");
rmSync(trustDirectory, { recursive: true, force: true });
console.log("direct-project-memory-propagation-regression: ok");
