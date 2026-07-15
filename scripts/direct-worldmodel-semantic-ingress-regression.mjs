#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  assessWorldmodelPromotion,
  buildGraphWriteAuthorizationForTransition,
  buildHierarchicalWorldmodelGraph,
  buildProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  buildProjectManagerProfile,
  buildScopedWorldmodelRevisionRef,
  buildSemanticIngressBrokerPacket,
  buildSemanticTargetResolution,
  buildTranscriptEvidenceRef,
  buildTranscriptInspectionArtifact,
  buildWorldmodelDeltaCandidate,
  buildWorldmodelContextualAdmission,
  buildWorldmodelContextualAuthorityDecision,
  buildWorldmodelIngressEnvelope,
  buildGovernanceProvenanceRegistry,
  createWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  graphDigestFor,
  registryRef,
  commitSemanticIngressBrokerPacket,
  promoteWorldmodelDeltaCandidate,
  splitWorldmodelDeltaCandidate,
  validateTranscriptEvidenceRef,
  validateTranscriptInspectionArtifact,
  validateWorldmodelIngressEnvelope,
  validateWorldmodelPromotionTransition,
} = require("../src/main/direct/worldmodel");

const now = () => Date.UTC(2026, 6, 15, 12, 0, 0);
const sourceRefs = (id) => [{ sourceRefId: `source_${id}`, sourceKind: "family_specific", sourceId: id, sourceConfidence: "exact", freshness: "fresh", observedAt: "2026-07-15T12:00:00.000Z" }];
const authorityTrace = (id = "authority_trace") => ({ sourceRefId: id, sourceKind: "promotion_decision", sourceId: id, sourceConfidence: "accepted_profile", freshness: "fresh", observedAt: "2026-07-15T12:00:00.000Z" });
function expectThrows(fn, code) { assert.throws(fn, (error) => error?.code === code); }
const activeStoreDirs = [];
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function activateGraph(portableGraph) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-semantic-ingress-trust-")); activeStoreDirs.push(directory);
  const store = createWorldmodelTrustStore(directory, { storeId: "semantic_ingress_trust", now: now() });
  const graph = clone(portableGraph); graph.trustAnchorRef = buildWorldmodelTrustAnchor(store, graph.graphId); graph.digest = graphDigestFor("direct-hierarchical-worldmodel-graph@1", graph);
  return { graph, store };
}
function provisionCurrentPromotion(input, store) {
  initializeAuthoritativeWorldmodelGraph(store, input.graph, input.governanceRegistry);
  const admission = input.contextualAdmission; const scope = admission.candidate.targetScope;
  const revision = admission.expectedScopeRevisions.find((ref) => ref.scopeKind === scope.scopeKind && ref.projectId === scope.projectId && ref.workThreadId === scope.workThreadId);
  const storeAdmission = admitWorldmodelGovernanceRequest(store, { admissionId: `store_${admission.admissionId}`, graph: input.graph, context: {
    registryRef: registryRef(input.governanceRegistry), expectedRegistryRevision: input.governanceRegistry.revision,
    graphId: input.graph.graphId, graphDigest: input.graph.digest, userProfileId: input.graph.userProfileId,
    scopeKind: scope.scopeKind, projectId: scope.projectId, workThreadId: scope.workThreadId,
    projectRootNodeId: input.graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === scope.projectId)?.nodeId,
    role: admission.actorRole, agentId: admission.actorAgentId, purpose: "graph_append", expectedScopeRevisionDigest: revision.digest,
    requiredArtifacts: admission.registryRequiredArtifacts,
  } });
  return { ...input, storeAdmission };
}

const projectScope = { scopeKind: "project", userProfileId: "user_fixture", projectId: "project_fixture", semanticPath: ["projects", "fixture", "architecture"] };
const graph = buildHierarchicalWorldmodelGraph({
  graphId: "semantic_ingress_graph", userProfileId: "user_fixture", rootNodeId: "user_root",
  scopedRevisionRefs: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_fixture", revision: 0 })],
  nodes: [
    { nodeId: "user_root", scope: { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["user"] }, nodeKind: "world_root", abstractionLevel: "world", semanticSummary: "User world", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"], projectionEligibility: "eligible", sourceRefs: sourceRefs("root") },
    { nodeId: "project_root", scope: { ...projectScope, semanticPath: ["projects", "fixture"] }, nodeKind: "project_root", abstractionLevel: "strategic", semanticSummary: "Project root", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: sourceRefs("project_root") },
  ],
}, { now });
const custodyMatrix = buildProjectCustodyWriteMatrix({ projectId: "project_fixture" });
const custodyWitness = buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: "project_manager", path: "project.architecture", action: "mutate" });
const expectedProjectRevision = graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project");
const projectManagerProfile = buildProjectManagerProfile({ projectManagerProfileId: "semantic_pm_profile", projectManagerAgentId: "project_manager_agent", worldManagerAgentId: "world_manager_agent", projectId: "project_fixture", projectRootNodeId: "project_root", authorityBoundaryRef: { kind: "authority_boundary", id: "semantic_boundary", digest: "sha256:semantic_boundary" }, graphProjectionPolicyRef: { kind: "graph_projection_policy", id: "semantic_policy", digest: "sha256:semantic_policy" }, sourceRefs: sourceRefs("semantic_pm_profile") }, { now });

function ingress(role, id) {
  return buildWorldmodelIngressEnvelope({ ingressId: id, inputKind: "current_user_message", receivedByAgentId: `${role}_agent`, receivedByRole: role, declaredScopeHints: [projectScope], sourceRefs: sourceRefs(`ingress_${id}`), currentInstructionAuthority: true }, { now });
}
function resolution(ingressEnvelope, route) {
  return buildSemanticTargetResolution({ resolutionId: `resolution_${ingressEnvelope.ingressId}`, ingressId: ingressEnvelope.ingressId, candidateTargets: [{ ...projectScope, candidateNodeIds: ["architecture_idea"], confidence: "exact" }], route, sourceRefs: ingressEnvelope.sourceRefs });
}
function candidate(ingressEnvelope, targetResolution, overrides = {}) {
  return buildWorldmodelDeltaCandidate({ candidateId: `candidate_${ingressEnvelope.ingressId}`, ingressId: ingressEnvelope.ingressId, targetResolutionId: targetResolution.resolutionId, receivedByRole: ingressEnvelope.receivedByRole, targetScope: projectScope, abstractionLevel: "conceptual", candidateState: "accepted_for_commit", proposedNodeMutations: [{ operation: "add", targetNodeId: "architecture_idea", candidateNode: { nodeId: "architecture_idea", graphId: graph.graphId, scope: projectScope, nodeKind: "idea", abstractionLevel: "conceptual", semanticSummary: "Adopt the shared semantic ingress boundary.", odeuImpact: { O: ["architecture"], E: ["user proposal"], D: ["promotion"], U: ["project"] }, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "informational", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: ingressEnvelope.sourceRefs } }], odeuImpact: { O: ["architecture"], E: ["user proposal"], D: ["promotion"], U: ["project"] }, expectedScopeRevisions: [expectedProjectRevision], sourceRefs: ingressEnvelope.sourceRefs, ...overrides }, { now });
}
function promotionInput(candidateValue, resolutionValue, extra = {}) {
  const targetGraph = extra.graph || graph;
  if (candidateValue.proposedNodeMutations.some((mutation) => mutation.operation === "supersede" && !targetGraph.nodes.some((entry) => entry.nodeId === mutation.candidateNode.supersedesNodeId))) return { graph: targetGraph, candidate: candidateValue, targetResolution: resolutionValue, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", custodyWriteWitness: custodyWitness, authorityTraceRef: authorityTrace(`trace_${candidateValue.candidateId}`), explicitPromotionRequested: true, ...extra };
  const brokerPacket = buildSemanticIngressBrokerPacket({ ingressEnvelope: extra.ingressEnvelope || (candidateValue.ingressId === "world_ingress" ? worldIngress : projectIngress), targetResolution: resolutionValue });
  const authorityDecision = buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `authority_${candidateValue.candidateId}`, graph: targetGraph, managerProfile: projectManagerProfile, actorAgentId: "project_manager_agent", actorRole: "project_manager", targetScope: candidateValue.targetScope, issuedAt: "2026-07-15T12:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
  const root = targetGraph.nodes.find((entry) => entry.nodeId === "project_root"); const revision = candidateValue.expectedScopeRevisions.find((entry) => entry.scopeKind === "project" && entry.projectId === "project_fixture");
  const binding = { graphId: targetGraph.graphId, graphDigest: targetGraph.digest, userProfileId: targetGraph.userProfileId, scopeKind: "project", projectId: "project_fixture", projectRootNodeId: root.nodeId, role: "project_manager", agentId: "project_manager_agent", purpose: "graph_append", expectedScopeRevisionDigest: revision.digest };
  const governanceRegistry = buildGovernanceProvenanceRegistry({ registryId: `registry_${candidateValue.candidateId}`, userProfileId: targetGraph.userProfileId, records: [
    { kind: "project_manager_profile", body: projectManagerProfile, binding }, { kind: "project_root", body: root, binding }, { kind: "custody_matrix", body: custodyMatrix, binding }, { kind: "custody_witness", body: custodyWitness, binding }, { kind: "authority_decision", body: authorityDecision, binding, oneShot: true },
  ] }, { now });
  const admission = buildWorldmodelContextualAdmission({ admissionId: `admission_${candidateValue.candidateId}`, graph: targetGraph, ingressEnvelope: extra.ingressEnvelope || (candidateValue.ingressId === "world_ingress" ? worldIngress : projectIngress), brokerPacket, targetResolution: resolutionValue, candidate: candidateValue, managerProfile: projectManagerProfile, custodyMatrix, custodyWriteWitness: custodyWitness, authorityDecision, governanceRegistry, registryRef: registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", idempotencyKey: extra.idempotencyKey || candidateValue.candidateId }, { now });
  const writeAuthorization = buildGraphWriteAuthorizationForTransition(targetGraph, { authorizationId: `write_${candidateValue.candidateId}`, actorAgentId: "project_manager_agent", actorRole: "project_manager", mutations: admission.mutations, expectedScopeRevisions: admission.expectedScopeRevisions, authorityTraceRef: authorityTrace(`trace_${candidateValue.candidateId}`), idempotencyKey: admission.idempotencyKey, authorizationExpiresAt: admission.expiresAt });
  return { graph: targetGraph, candidate: candidateValue, targetResolution: resolutionValue, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", custodyWriteWitness: custodyWitness, authorityTraceRef: authorityTrace(`trace_${candidateValue.candidateId}`), explicitPromotionRequested: true, contextualAdmission: admission, governanceRegistry, writeAuthorization, ...extra };
}
function commitCurrentPromotion(candidateValue, resolutionValue, extra = {}) {
  const portable = clone(extra.graph || graph); delete portable.trustAnchorRef;
  const active = activateGraph(portable);
  const input = promotionInput(candidateValue, resolutionValue, { ...extra, graph: active.graph });
  return promoteWorldmodelDeltaCandidate(provisionCurrentPromotion(input, active.store), { now });
}

const worldIngress = ingress("world_manager", "world_ingress");
const projectIngress = ingress("project_manager", "project_ingress");
validateWorldmodelIngressEnvelope(worldIngress);
assert.equal(graph.nodes.length, 2, "raw ingress remains evidence and does not mutate graph");
expectThrows(() => validateWorldmodelIngressEnvelope(buildWorldmodelIngressEnvelope({ ingressId: "historic_instruction", inputKind: "historical_transcript_inspection", receivedByAgentId: "project_manager_agent", receivedByRole: "project_manager", sourceRefs: sourceRefs("historic"), currentInstructionAuthority: true }, { now })), "direct_semantic_ingress_envelope_authority_boundary");

const worldResolution = resolution(worldIngress, "world_to_project_descent");
const projectResolution = resolution(projectIngress, "commit_current_scope");
const worldBroker = buildSemanticIngressBrokerPacket({ ingressEnvelope: worldIngress, targetResolution: worldResolution });
assert.equal(worldBroker.brokerMayCommit, false);
expectThrows(() => commitSemanticIngressBrokerPacket(worldBroker), "direct_semantic_ingress_broker_commit_forbidden");

const worldCandidate = candidate(worldIngress, worldResolution);
const projectCandidate = candidate(projectIngress, projectResolution);
assert.equal(worldCandidate.normalizedSemanticMutationDigest, projectCandidate.normalizedSemanticMutationDigest, "dual ingress converges on route-independent semantic content");
assert.notEqual(worldCandidate.sourceRefs[0].sourceId, projectCandidate.sourceRefs[0].sourceId, "dual ingress retains distinct evidence provenance");
const worldPromotion = commitCurrentPromotion(worldCandidate, worldResolution, { idempotencyKey: "world_route" });
const projectPromotion = commitCurrentPromotion(projectCandidate, projectResolution, { idempotencyKey: "resident_route" });
assert.equal(worldPromotion.committed, true);
assert.equal(projectPromotion.committed, true);
assert.equal(worldPromotion.graph.nodes.find((node) => node.nodeId === "architecture_idea").semanticSummary, projectPromotion.graph.nodes.find((node) => node.nodeId === "architecture_idea").semanticSummary);
assert.notEqual(worldPromotion.graph.nodes.find((node) => node.nodeId === "architecture_idea").digest, projectPromotion.graph.nodes.find((node) => node.nodeId === "architecture_idea").digest, "content convergence does not depend on identical source refs");
assert.equal(worldPromotion.promotion.graphTransitionRef.sourceDigest.value, worldPromotion.transition.digest, "promotion receipt preserves the committed transition digest");
expectThrows(() => validateWorldmodelPromotionTransition({ ...worldPromotion.promotion, graphTransitionRef: { ...worldPromotion.promotion.graphTransitionRef, sourceDigest: { ...worldPromotion.promotion.graphTransitionRef.sourceDigest, value: "sha256:tampered" } } }), "direct_semantic_ingress_digest_mismatch");

const duplicateCandidate = candidate(projectIngress, projectResolution, { candidateId: "duplicate_candidate", expectedScopeRevisions: [worldPromotion.graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project")] });
const duplicatePromotion = promoteWorldmodelDeltaCandidate(promotionInput(duplicateCandidate, projectResolution, { idempotencyKey: "duplicate_route", graph: worldPromotion.graph }), { now });
assert.equal(duplicatePromotion.promotion.decision, "defer", "equivalent semantic mutation is never silently re-applied");

const activeIntegrated = candidate(worldIngress, worldResolution, { candidateId: "active_integrated", proposedNodeMutations: [{ operation: "add", targetNodeId: "integrated_idea", candidateNode: { ...worldCandidate.proposedNodeMutations[0].candidateNode, nodeId: "integrated_idea", semanticSummary: "Integrated idea remains an active commitment.", lifecycle: "active", integrationStatus: "integrated" } }] });
const integratedPromotion = commitCurrentPromotion(activeIntegrated, worldResolution, { idempotencyKey: "active_integrated" });
assert.equal(integratedPromotion.committed, true);
assert.equal(integratedPromotion.graph.nodes.find((node) => node.nodeId === "integrated_idea").lifecycle, "active");
assert.equal(integratedPromotion.graph.nodes.find((node) => node.nodeId === "integrated_idea").integrationStatus, "integrated");
assert.equal(integratedPromotion.graph.materializedView.activeNodeRefs.some((ref) => ref.id === "integrated_idea"), true, "integration does not hide an active accepted idea");

const evidenceRef = buildTranscriptEvidenceRef({ projectId: "project_fixture", threadId: "thread_fixture", turnIds: ["turn_1"], messageItemIds: ["item_1"], transcriptStoreId: "thread_store_fixture", sourceDigest: "sha256:transcript_fixture", inspectionState: "bounded_excerpt_loaded" }, { now });
assert.equal(evidenceRef.transcriptStoreRef.sourceDigest.value, "sha256:transcript_fixture");
expectThrows(() => validateTranscriptEvidenceRef({ ...evidenceRef, transcriptStoreRef: { ...evidenceRef.transcriptStoreRef, sourceDigest: { ...evidenceRef.transcriptStoreRef.sourceDigest, value: "sha256:tampered" } } }), "direct_semantic_ingress_source_ref_digest_mismatch");
const inspection = buildTranscriptInspectionArtifact({ evidenceRef, inspectionId: "inspection_fixture", question: "What architecture proposal was made?", boundedExcerptId: "excerpt_fixture", boundedExcerptDigest: "sha256:excerpt_fixture", extractedClaimCandidates: ["Proposal needs audit."], omissions: ["Earlier turns omitted."] }, { now });
validateTranscriptInspectionArtifact(inspection);
assert.equal(inspection.boundedExcerptRef.sourceDigest.value, "sha256:excerpt_fixture");
assert.equal(inspection.historicalInstructionAuthorityGranted, false);
assert.equal(inspection.contextMutationGranted, false);
expectThrows(() => validateTranscriptInspectionArtifact({ ...inspection, historicalInstructionAuthorityGranted: true }), "direct_semantic_ingress_inspection_authority_leak");

const sourceLess = { ...worldCandidate, sourceRefs: [] };
expectThrows(() => promoteWorldmodelDeltaCandidate(promotionInput(sourceLess, worldResolution), { now }), "direct_semantic_ingress_source_evidence_required");
const roleOnly = promoteWorldmodelDeltaCandidate({ ...promotionInput(worldCandidate, worldResolution), custodyWriteWitness: undefined }, { now });
assert.equal(roleOnly.promotion.decision, "remand", "caller role plus evidence cannot license project mutation");
const badPathWitness = buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: "project_manager", path: "project.progress", action: "mutate" });
assert.equal(promoteWorldmodelDeltaCandidate({ ...promotionInput(worldCandidate, worldResolution), custodyWriteWitness: badPathWitness }, { now }).promotion.decision, "remand", "path-fit witness is required");
const forgedWitness = { ...custodyWitness, projectId: "other_project" };
assert.equal(promoteWorldmodelDeltaCandidate({ ...promotionInput(worldCandidate, worldResolution), custodyWriteWitness: forgedWitness }, { now }).promotion.decision, "remand", "forged or mismatched witness cannot commit");
assert.equal(promoteWorldmodelDeltaCandidate({ ...promotionInput(worldCandidate, worldResolution), authorityTraceRef: worldCandidate.sourceRefs[0] }, { now }).promotion.decision, "remand", "candidate evidence cannot masquerade as authority trace");
for (const candidateState of ["rejected", "deferred", "conflicted", "needs_review"]) {
  const blocked = candidate(worldIngress, worldResolution, { candidateId: `state_${candidateState}`, candidateState });
  assert.equal(promoteWorldmodelDeltaCandidate(promotionInput(blocked, worldResolution), { now }).promotion.decision, "defer", `${candidateState} cannot admit`);
}

const staleCandidate = candidate(worldIngress, worldResolution, { candidateId: "stale_candidate", expectedScopeRevisions: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_fixture", revision: 99 })] });
assert.equal(promoteWorldmodelDeltaCandidate(promotionInput(staleCandidate, worldResolution), { now }).promotion.decision, "remand", "stale revision remands");
const invalidSupersession = candidate(worldIngress, worldResolution, { candidateId: "invalid_supersession", proposedNodeMutations: [{ operation: "supersede", candidateNode: { ...worldCandidate.proposedNodeMutations[0].candidateNode, nodeId: "replacement_idea", supersedesNodeId: "missing_idea" } }] });
assert.equal(promoteWorldmodelDeltaCandidate(promotionInput(invalidSupersession, worldResolution), { now }).promotion.decision, "remand", "missing supersession target remands");
const supersedingCandidate = candidate(worldIngress, worldResolution, { candidateId: "superseding_candidate", expectedScopeRevisions: [worldPromotion.graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project")], proposedNodeMutations: [{ operation: "supersede", candidateNode: { ...worldCandidate.proposedNodeMutations[0].candidateNode, nodeId: "replacement_idea", semanticSummary: "Replacement semantic ingress boundary.", supersedesNodeId: "architecture_idea" } }] });
const superseded = commitCurrentPromotion(supersedingCandidate, worldResolution, { graph: worldPromotion.graph, idempotencyKey: "supersede" });
assert.equal(superseded.committed, true);
assert.equal(superseded.graph.nodes.find((node) => node.nodeId === "architecture_idea").lifecycle, "superseded");
assert.equal(superseded.graph.nodes.find((node) => node.nodeId === "architecture_idea").supersededByNodeId, "replacement_idea");
assert.equal(superseded.graph.nodes.find((node) => node.nodeId === "replacement_idea").supersedesNodeId, "architecture_idea");
assert.equal(superseded.graph.edges.some((edge) => edge.relationKind === "supersedes" && edge.fromNodeId === "replacement_idea"), true);

const mixedResolution = buildSemanticTargetResolution({ resolutionId: "mixed_resolution", ingressId: worldIngress.ingressId, route: "multi_scope_split", candidateTargets: [{ scopeKind: "user_world", semanticPath: ["preferences"], candidateNodeIds: ["global_preference"], confidence: "high" }, { ...projectScope, candidateNodeIds: ["project_idea"], confidence: "high" }], sourceRefs: worldIngress.sourceRefs });
assert.equal(splitWorldmodelDeltaCandidate({ candidateId: "mixed_candidate", ingressId: worldIngress.ingressId, receivedByRole: "world_manager", targetResolution: mixedResolution, proposedNodeMutations: [], expectedScopeRevisions: [expectedProjectRevision], sourceRefs: worldIngress.sourceRefs }, { now }).length, 2);
const mixedProjectCandidate = candidate(worldIngress, mixedResolution, { candidateId: "mixed_project_candidate" });
assert.equal(assessWorldmodelPromotion(promotionInput(mixedProjectCandidate, mixedResolution), { now }).promotion.decision, "split");
const providerCandidate = candidate(worldIngress, worldResolution, { candidateId: "provider_candidate", promotionOrigin: "provider_output" });
assert.equal(promoteWorldmodelDeltaCandidate({ ...promotionInput(providerCandidate, worldResolution), explicitPromotionRequested: false }, { now }).promotion.decision, "defer");

console.log("direct-worldmodel-semantic-ingress-regression: ok");
for (const directory of activeStoreDirs) fs.rmSync(directory, { recursive: true, force: true });
