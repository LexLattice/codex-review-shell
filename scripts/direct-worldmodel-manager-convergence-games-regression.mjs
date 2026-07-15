#!/usr/bin/env node
// Wave26 PR157 focused convergence games: all claims bind production artifacts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wm = require("../src/main/direct/worldmodel");
const now = () => Date.UTC(2026, 6, 15, 12, 0, 0);
const projectX = "project_x";
const projectB = "project_b";
const xScope = { scopeKind: "project", userProfileId: "user_wave26", projectId: projectX, semanticPath: ["projects", projectX, "architecture"] };
const ref = (id, kind = "fixture") => ({ sourceRefId: `ref_${id}`, sourceKind: kind, sourceId: id, sourceConfidence: "exact", freshness: "fresh", observedAt: "2026-07-15T12:00:00.000Z" });
const authority = (id) => ref(id, "promotion_decision");
const typed = (kind, id) => ({ kind, id, digest: `sha256:${id}` });
const throws = (fn, code) => assert.throws(fn, (error) => error?.code === code, code);
const projectRevision = (graph, projectId = projectX) => graph.scopedRevisionRefs.find((entry) => entry.scopeKind === "project" && entry.projectId === projectId);
const node = (nodeId, scope, summary, extras = {}) => ({ nodeId, scope, nodeKind: "idea", abstractionLevel: "conceptual", semanticSummary: summary, odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "informational", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: [ref(nodeId)], ...extras });
const trustDirectories = [];
const initializedTrustStores = new WeakSet();
const trustStoresByAnchor = new Map();

function trustedGraphFixture(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `wave26-convergence-${label}-`));
  trustDirectories.push(directory);
  const store = wm.createWorldmodelTrustStore(directory, { storeId: `convergence_${label}_store`, now });
  const graph = graphFixture(wm.buildWorldmodelTrustAnchor(store, "wave26_convergence_graph"));
  trustStoresByAnchor.set(graph.trustAnchorRef.anchorDigest, store);
  return { graph, store };
}
function trustStoreFor(graph) {
  const store = trustStoresByAnchor.get(graph.trustAnchorRef?.anchorDigest);
  if (!store) throw new Error("convergence fixture trust store missing");
  return store;
}
function installRegistry(store, graph, registry) {
  if (initializedTrustStores.has(store)) wm.installAuthoritativeWorldmodelGovernanceRegistry(store, graph, registry);
  else { wm.initializeAuthoritativeWorldmodelGraph(store, graph, registry); initializedTrustStores.add(store); }
}

function graphFixture(trustAnchorRef) {
  return wm.buildHierarchicalWorldmodelGraph({ graphId: "wave26_convergence_graph", userProfileId: "user_wave26", rootNodeId: "world_root", ...(trustAnchorRef ? { trustAnchorRef } : {}), scopedRevisionRefs: [wm.buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: projectX, revision: 4 }), wm.buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: projectB, revision: 9 })], nodes: [
    node("world_root", { scopeKind: "user_world", userProfileId: "user_wave26", semanticPath: ["world"] }, "World root", { nodeKind: "world_root", abstractionLevel: "world", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"] }),
    node("project_x_root", { ...xScope, semanticPath: ["projects", projectX] }, "Project X root", { nodeKind: "project_root", abstractionLevel: "strategic" }),
    node("project_x_z_detail", xScope, "Project X detailed architecture"),
    node("project_x_z_execution_detail", { ...xScope, semanticPath: ["projects", projectX, "architecture", "execution"] }, "Project X execution detail", { abstractionLevel: "operational" }),
    node("project_x_z_review_detail", { ...xScope, semanticPath: ["projects", projectX, "architecture", "review"] }, "Project X review detail", { abstractionLevel: "operational" }),
    node("wm_private_x", xScope, "Private World Manager material", { custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"] }),
    node("project_b_root", { scopeKind: "project", userProfileId: "user_wave26", projectId: projectB, semanticPath: ["projects", projectB] }, "Project B root", { nodeKind: "project_root", abstractionLevel: "strategic" }),
    node("project_b_detail", { scopeKind: "project", userProfileId: "user_wave26", projectId: projectB, semanticPath: ["projects", projectB, "detail"] }, "Project B secret detail"),
    ...["rejected", "deferred", "refuted", "superseded", "stale"].map((lifecycle) => node(`history_${lifecycle}`, xScope, `${lifecycle} idea`, { lifecycle, epistemicStatus: lifecycle === "refuted" ? "refuted" : lifecycle === "stale" ? "stale" : "derived", projectionEligibility: lifecycle === "stale" ? "blocked_stale" : lifecycle === "refuted" ? "blocked_conflicted" : "history_only" })),
  ], edges: [
    { edgeId: "world_x", fromNodeId: "world_root", toNodeId: "project_x_root", relationKind: "relevant_to", lifecycle: "active", sourceRefs: [ref("world_x")] },
    { edgeId: "x_detail", fromNodeId: "project_x_root", toNodeId: "project_x_z_detail", relationKind: "supports", lifecycle: "active", sourceRefs: [ref("x_detail")] },
    { edgeId: "x_execution_detail", fromNodeId: "project_x_root", toNodeId: "project_x_z_execution_detail", relationKind: "supports", lifecycle: "active", sourceRefs: [ref("x_execution_detail")] },
    { edgeId: "x_review_detail", fromNodeId: "project_x_root", toNodeId: "project_x_z_review_detail", relationKind: "supports", lifecycle: "active", sourceRefs: [ref("x_review_detail")] },
    { edgeId: "x_private", fromNodeId: "project_x_root", toNodeId: "wm_private_x", relationKind: "relevant_to", lifecycle: "active", sourceRefs: [ref("x_private")] },
    { edgeId: "world_b", fromNodeId: "world_root", toNodeId: "project_b_root", relationKind: "relevant_to", lifecycle: "active", sourceRefs: [ref("world_b")] },
    { edgeId: "b_detail", fromNodeId: "project_b_root", toNodeId: "project_b_detail", relationKind: "supports", lifecycle: "active", sourceRefs: [ref("b_detail")] },
  ] }, { now });
}

function ingress(role, id) { return wm.buildWorldmodelIngressEnvelope({ ingressId: id, inputKind: "current_user_message", receivedByAgentId: `${role}_agent`, receivedByRole: role, declaredScopeHints: [xScope], sourceRefs: [ref(id)], currentInstructionAuthority: true }, { now }); }
function resolution(envelope, route, id) { return wm.buildSemanticTargetResolution({ resolutionId: id, ingressId: envelope.ingressId, candidateTargets: [{ ...xScope, candidateNodeIds: ["project_x_detail"], confidence: "exact" }], route, sourceRefs: envelope.sourceRefs }); }
function candidate(graph, envelope, target, id, overrides = {}) {
  return wm.buildWorldmodelDeltaCandidate({ candidateId: id, ingressId: envelope.ingressId, targetResolutionId: target.resolutionId, receivedByRole: envelope.receivedByRole, targetScope: xScope, candidateState: "accepted_for_commit", sourceRefs: envelope.sourceRefs, expectedScopeRevisions: [projectRevision(graph)], proposedNodeMutations: [{ operation: "add", targetNodeId: "converged_project_x_idea", candidateNode: node("converged_project_x_idea", xScope, "Adopt the shared Project X boundary.", { graphId: graph.graphId, sourceRefs: envelope.sourceRefs }) }], ...overrides }, { now });
}
function promote(graph, candidateValue, target, transitionId, currentIngress, projectManagerProfile) {
  const custodyMatrix = wm.buildProjectCustodyWriteMatrix({ projectId: projectX });
  const custody = wm.buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: "project_manager", path: "project.architecture" });
  if (candidateValue.ingressId !== currentIngress.ingressId) return wm.promoteWorldmodelDeltaCandidate({ graph, candidate: candidateValue, targetResolution: target, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", custodyWriteWitness: custody, authorityTraceRef: authority(`authority_${transitionId}`), explicitPromotionRequested: true, graphTransitionId: transitionId, idempotencyKey: transitionId, currentIngress }, { now });
  const brokerPacket = wm.buildSemanticIngressBrokerPacket({ ingressEnvelope: currentIngress, targetResolution: target });
  const authorityDecision = wm.buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `authority_${transitionId}`, graph, managerProfile: projectManagerProfile, actorAgentId: "project_manager_agent", actorRole: "project_manager", targetScope: candidateValue.targetScope, issuedAt: "2026-07-15T12:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
  const root = graph.nodes.find((entry) => entry.nodeId === "project_x_root"); const revision = projectRevision(graph); const binding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: projectX, projectRootNodeId: root.nodeId, role: "project_manager", agentId: "project_manager_agent", purpose: "graph_append", expectedScopeRevisionDigest: revision.digest };
  const governanceRegistry = wm.buildGovernanceProvenanceRegistry({ registryId: `registry_${transitionId}`, userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: projectManagerProfile, binding }, { kind: "project_root", body: root, binding }, { kind: "custody_matrix", body: custodyMatrix, binding }, { kind: "custody_witness", body: custody, binding }, { kind: "authority_decision", body: authorityDecision, binding, oneShot: true }] });
  const contextualAdmission = wm.buildWorldmodelContextualAdmission({ admissionId: `admission_${transitionId}`, graph, ingressEnvelope: currentIngress, brokerPacket, targetResolution: target, candidate: candidateValue, managerProfile: projectManagerProfile, custodyMatrix, custodyWriteWitness: custody, authorityDecision, governanceRegistry, registryRef: wm.registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", idempotencyKey: transitionId }, { now });
  const writeAuthorization = wm.buildGraphWriteAuthorizationForTransition(graph, { authorizationId: `write_${transitionId}`, actorAgentId: "project_manager_agent", actorRole: "project_manager", mutations: contextualAdmission.mutations, expectedScopeRevisions: contextualAdmission.expectedScopeRevisions, authorityTraceRef: authority(`authority_${transitionId}`), idempotencyKey: transitionId, authorizationExpiresAt: contextualAdmission.expiresAt });
  const trustStore = trustStoreFor(graph);
  installRegistry(trustStore, graph, governanceRegistry);
  const registryBinding = governanceRegistry.records.find((record) => record.kind === "project_manager_profile").binding;
  const storeAdmission = wm.admitWorldmodelGovernanceRequest(trustStore, { admissionId: `store_${transitionId}`, graph, context: { ...registryBinding, requiredArtifacts: contextualAdmission.registryRequiredArtifacts }, issuedAt: "2026-07-15T12:00:00.000Z" });
  return wm.promoteWorldmodelDeltaCandidate({ graph, candidate: candidateValue, targetResolution: target, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager", custodyWriteWitness: custody, authorityTraceRef: authority(`authority_${transitionId}`), contextualAdmission, governanceRegistry, storeAdmission, writeAuthorization, explicitPromotionRequested: true, graphTransitionId: transitionId, idempotencyKey: transitionId, currentIngress }, { now });
}
function extensionalProjectState(graph) {
  const withoutGenealogy = (entry) => { const { sourceRefs, promotionTransitionRefs, digest, ...semantic } = entry; return semantic; };
  return { nodes: graph.nodes.filter((entry) => entry.scope.projectId === projectX).map(withoutGenealogy).sort((a, b) => a.nodeId.localeCompare(b.nodeId)), edges: graph.edges.filter((entry) => graph.nodes.find((nodeValue) => nodeValue.nodeId === entry.fromNodeId)?.scope.projectId === projectX).map(withoutGenealogy).sort((a, b) => a.edgeId.localeCompare(b.edgeId)), revision: projectRevision(graph) };
}

function gameDualIngressConvergence() {
  // The two ingress routes intentionally begin from extensionally identical,
  // independently anchored graphs.  Convergence is semantic, not an attempt to
  // reuse one store admission or one-shot authority decision across branches.
  const worldRoute = trustedGraphFixture("world_route"); const projectRoute = trustedGraphFixture("project_route");
  const base = worldRoute.graph; const pmBase = projectRoute.graph; const wmIngress = ingress("world_manager", "wm_ingress"); const pmIngress = ingress("project_manager", "pm_ingress");
  const pmAuthority = typed("authority_boundary", "pm_authority");
  const pmProfile = wm.buildProjectManagerProfile({ projectManagerProfileId: "pm_profile", projectManagerAgentId: "project_manager_agent", worldManagerAgentId: "world_manager_agent", projectId: projectX, projectRootNodeId: "project_x_root", authorityBoundaryRef: pmAuthority, graphProjectionPolicyRef: typed("graph_projection_policy", "pm_policy") }, { now });
  const wmResolution = resolution(wmIngress, "world_to_project_descent", "wm_resolution"); const pmResolution = resolution(pmIngress, "commit_current_scope", "pm_resolution");
  const wmCandidate = candidate(base, wmIngress, wmResolution, "wm_candidate"); const pmCandidate = candidate(pmBase, pmIngress, pmResolution, "pm_candidate");
  assert.equal(wmCandidate.normalizedSemanticMutationDigest, pmCandidate.normalizedSemanticMutationDigest);
  assert.deepEqual(wmCandidate.expectedScopeRevisions, pmCandidate.expectedScopeRevisions);
  assert.deepEqual(wmResolution.candidateTargets[0].candidateNodeIds, pmResolution.candidateTargets[0].candidateNodeIds);
  const wmCommit = promote(base, wmCandidate, wmResolution, "wm_transition", wmIngress, pmProfile); const pmCommit = promote(pmBase, pmCandidate, pmResolution, "pm_transition", pmIngress, pmProfile);
  assert(wmCommit.committed && pmCommit.committed, "both isolated ingress routes commit");
  assert.deepEqual(extensionalProjectState(wmCommit.graph), extensionalProjectState(pmCommit.graph));
  assert.notEqual(wmIngress.sourceRefs[0].sourceId, pmIngress.sourceRefs[0].sourceId);
  assert.notEqual(wmCommit.transition.digest, pmCommit.transition.digest);
  assert.notEqual(wmCommit.graph.nodes.find((entry) => entry.nodeId === "converged_project_x_idea").sourceRefs[0].sourceId, pmCommit.graph.nodes.find((entry) => entry.nodeId === "converged_project_x_idea").sourceRefs[0].sourceId);
  return { base, pmBase, wmIngress, pmIngress, wmResolution, pmResolution, wmCandidate, pmCandidate, wmCommit, pmCommit, pmProfile, pmAuthority };
}

function gameTargetedDescentAndProjection(base, convergence) {
  const wmAuthority = typed("authority_boundary", "wm_authority");
  const wmProfile = wm.buildWorldmodelManagerProfile({ managerProfileId: "wm_profile", scopeKind: "global_user", userProfileId: "user_wave26", managerAgentId: "world_manager_agent" }, { now });
  const wmPolicy = wm.buildWorldmodelProjectionPolicy({ graph: base, managerProfile: wmProfile, authoritySourceRef: wmAuthority, policyId: "wm_policy", purpose: "current_context", allowedEntryPaths: ["world_root", "world_to_project_descent"], allowedFocalScopes: [{ scopeKind: "user_world" }, { scopeKind: "project", projectId: projectX }], trustedSeedNodeRefs: ["world_root", "project_x_root"].map((nodeId) => ({ kind: "worldmodel_semantic_node", id: nodeId, digest: base.nodes.find((node) => node.nodeId === nodeId).digest })), custodyDenyList: ["world_manager"], sensitivityDenyList: [], allowedRelationKinds: ["relevant_to", "supports", "implements", "refines", "affects", "depends_on", "applies_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 3, maxEdges: 3, maxSummaryChars: 240 }, workerAllowedProjectNodeRefs: [] });
  const pmPolicy = wm.buildWorldmodelProjectionPolicy({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyId: "pm_policy", purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: projectX }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_x_root", digest: base.nodes.find((node) => node.nodeId === "project_x_root").digest }], custodyDenyList: ["world_manager"], sensitivityDenyList: [], allowedRelationKinds: ["relevant_to", "supports", "implements", "refines", "affects", "depends_on", "applies_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 20, maxEdges: 20, maxSummaryChars: 2000 }, workerAllowedProjectNodeRefs: [] });
  const wmDescent = wm.buildWorldmodelGraphProjection({ graph: base, managerProfile: wmProfile, authoritySourceRef: wmAuthority, policyArtifact: wmPolicy, projectionId: "wm_descent", entryPath: "world_to_project_descent", focalScope: { scopeKind: "project", projectId: projectX } });
  const pmProjection = wm.buildWorldmodelGraphProjection({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyArtifact: pmPolicy, projectionId: "pm_project", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: projectX } });
  const wmRoot = wm.buildWorldmodelGraphProjection({ graph: base, managerProfile: wmProfile, authoritySourceRef: wmAuthority, policyArtifact: wmPolicy, projectionId: "wm_root", entryPath: "world_root", focalScope: { scopeKind: "user_world" } });
  const shared = (projection) => projection.selectedNodeRefs.find((entry) => entry.id === "project_x_root");
  assert.deepEqual(shared(wmDescent), shared(pmProjection));
  assert.deepEqual(wmDescent.sourceScopeRevisions.find((entry) => entry.projectId === projectX), projectRevision(base));
  assert.deepEqual(pmProjection.sourceScopeRevisions.find((entry) => entry.projectId === projectX), projectRevision(base));
  assert(wmDescent.selectedNodeRefs.length < pmProjection.selectedNodeRefs.length, "descent remains compact");
  assert(pmProjection.selectedNodeRefs.some((entry) => entry.id === "project_x_z_detail"));
  for (const projection of [wmDescent, pmProjection]) { assert(!projection.selectedNodeRefs.some((entry) => entry.id.startsWith("project_b") || entry.id === "wm_private_x")); assert(!projection.sourceScopeRevisions.some((entry) => entry.projectId === projectB)); assert.equal(projection.rawTranscriptIncluded, false); }
  assert(wmRoot.selectedNodeRefs.some((entry) => entry.id === "project_b_root") && !wmRoot.selectedNodeRefs.some((entry) => entry.id === "project_b_detail"));
  return { wmDescent, pmProjection, wmRoot, wmProfile, wmAuthority, wmPolicy, pmPolicy };
}

function gameGraphFirstRestart(base, projections, ingressArtifacts) {
  const wmProfile = projections.wmProfile;
  const pmProfile = ingressArtifacts.pmProfile;
  const wmBoot = wm.buildManagerTurnBootPacket({ bootPacketId: "wm_restart", managerRole: "world_manager", managerAgentId: "world_manager_agent", graphProjection: projections.wmRoot, profileSnapshot: wmProfile, currentIngress: ingressArtifacts.wmIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [] });
  const pmBoot = wm.buildManagerTurnBootPacket({ bootPacketId: "pm_restart", managerRole: "project_manager", managerAgentId: "project_manager_agent", graphProjection: projections.pmProjection, profileSnapshot: pmProfile, currentIngress: ingressArtifacts.pmIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [] });
  const pmRestart = wm.buildManagerTurnBootPacket({ bootPacketId: "pm_restart", managerRole: "project_manager", managerAgentId: "project_manager_agent", graphProjection: projections.pmProjection, profileSnapshot: pmProfile, currentIngress: ingressArtifacts.pmIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [] });
  assert.equal(pmBoot.digest, pmRestart.digest); assert.notEqual(wmBoot.graphProjectionRef.digest, pmBoot.graphProjectionRef.digest); assert.equal(wmBoot.historicalTranscriptIncluded, false); assert.equal(pmBoot.historicalTranscriptIncluded, false);
  throws(() => wm.buildManagerTurnBootPacket({ bootPacketId: "bad_raw_boot", managerRole: "project_manager", managerAgentId: "project_manager_agent", graphProjection: projections.pmProjection, profileSnapshot: pmProfile, currentIngress: ingressArtifacts.pmIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [], rawTranscript: "forbidden" }), "direct_manager_turn_context_raw_state_forbidden");
  return { wmProfile, pmProfile, wmBoot, pmBoot };
}

function gameLifecycleHistory(base, projections, convergence) {
  const active = wm.buildWorldmodelGraphProjection({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyArtifact: projections.pmPolicy, projectionId: "active_pm", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: projectX } });
  const auditPolicy = wm.buildWorldmodelProjectionPolicy({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyId: "pm_policy", purpose: "audit_history", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: projectX }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_x_root", digest: base.nodes.find((node) => node.nodeId === "project_x_root").digest }], custodyDenyList: ["world_manager"], sensitivityDenyList: [], allowedRelationKinds: ["relevant_to", "supports", "implements", "refines", "affects", "depends_on", "applies_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 30, maxEdges: 30, maxSummaryChars: 3000 }, workerAllowedProjectNodeRefs: [] });
  const history = wm.buildWorldmodelHistoryAuditProjection({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyArtifact: auditPolicy, projectionId: "project_x_history", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: projectX } }); wm.validateWorldmodelHistoryAuditProjection(history);
  for (const lifecycle of ["rejected", "deferred", "refuted", "superseded", "stale"]) assert(!active.selectedNodeRefs.some((entry) => entry.id === `history_${lifecycle}`));
  assert.equal(history.currentContextAdmissible, false); assert.equal(history.rawTranscriptIncluded, false); assert(history.sourceScopeRevisions.some((entry) => entry.digest === projectRevision(base).digest));
}

function gameTranscriptAndAuthority(base, ingressArtifacts) {
  const evidence = wm.buildTranscriptEvidenceRef({ projectId: projectX, threadId: "thread_x", turnIds: ["turn_7"], messageItemIds: ["item_7"], transcriptStoreId: "transcript_store", sourceDigest: "sha256:transcript_store", inspectionState: "bounded_excerpt_loaded" }, { now });
  const inspection = wm.buildTranscriptInspectionArtifact({ inspectionId: "exact_ref_drilldown", evidenceRef: evidence, question: "What was the prior rationale?", boundedExcerptId: "excerpt_7", boundedExcerptDigest: "sha256:excerpt_7", extractedClaimCandidates: ["Historical claim."], omissions: ["All other transcript material omitted."] }, { now });
  const drilldown = wm.buildTargetedEvidenceDrilldown({ drilldownId: "exact_ref_drilldown", targetedEvidenceInspectionArtifacts: [inspection] });
  assert.equal(evidence.rawTextIncluded, false); assert.equal(inspection.historicalInstructionAuthorityGranted, false); assert.equal(drilldown.historicalInstructionAuthorityGranted, false);
  const historicalIngress = wm.buildWorldmodelIngressEnvelope({ ingressId: "historic_ingress", inputKind: "historical_transcript_inspection", receivedByAgentId: "project_manager_agent", receivedByRole: "project_manager", declaredScopeHints: [xScope], sourceRefs: [ref("historic_ingress")], currentInstructionAuthority: false }, { now });
  const historicResolution = resolution(historicalIngress, "commit_current_scope", "historic_resolution"); const historicCandidate = candidate(base, historicalIngress, historicResolution, "historic_candidate");
  const remand = promote(base, historicCandidate, historicResolution, "historic_transition", ingressArtifacts.pmIngress);
  assert.equal(remand.committed, false); assert(remand.promotion.omissions.includes("historical_instruction_cannot_beat_current_ingress"));
}

function gameNegativeLaws(base, ingressArtifacts, convergence, projections) {
  throws(() => wm.buildWorldmodelGraphProjection({ graph: base, managerProfile: convergence.pmProfile, authoritySourceRef: convergence.pmAuthority, policyArtifact: projections.pmPolicy, entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: projectX }, rawTranscriptIncluded: true }), "direct_worldmodel_graph_projection_raw_transcript_forbidden");
  throws(() => wm.commitSemanticIngressBrokerPacket(wm.buildSemanticIngressBrokerPacket({ ingressEnvelope: convergence.wmIngress, targetResolution: convergence.wmResolution })), "direct_semantic_ingress_broker_commit_forbidden");
  const sourceless = wm.buildWorldmodelDeltaCandidate({ candidateId: "sourceless", ingressId: convergence.pmIngress.ingressId, targetResolutionId: convergence.pmResolution.resolutionId, receivedByRole: "project_manager", targetScope: xScope, candidateState: "accepted_for_commit", expectedScopeRevisions: [projectRevision(base)], sourceRefs: [], proposedNodeMutations: [] });
  throws(() => wm.assessWorldmodelPromotion({ graph: base, candidate: sourceless, targetResolution: convergence.pmResolution, decidedByAgentId: "project_manager_agent", decidedByRole: "project_manager" }, { now }), "direct_semantic_ingress_source_evidence_required");
  assert.equal(wm.assessWorldmodelPromotion({ graph: base, candidate: convergence.pmCandidate, targetResolution: convergence.pmResolution, decidedByAgentId: "worker", decidedByRole: "thread_manager", custodyWriteWitness: wm.buildProjectCustodyWriteWitness({ projectId: projectX, actorRole: "thread_manager", path: "project.architecture" }), authorityTraceRef: authority("worker") }, { now }).promotion.decision, "remand");
  assert.equal(wm.buildProjectCustodyWriteWitness({ projectId: projectX, actorRole: "project_manager", path: "user.constitution" }).decision, "remanded");
  throws(() => wm.buildWorldmodelIngressEnvelope({ ingressId: "chat_scope", inputKind: "current_user_message", receivedByAgentId: "project_manager_agent", receivedByRole: "project_manager", declaredScopeHints: [{ ...xScope, sessionId: "session_99" }], sourceRefs: [ref("chat_scope")], currentInstructionAuthority: true }, { now }), "direct_semantic_ingress_interaction_scope_forbidden");
  assert.equal(ingressArtifacts.pmIngress.currentInstructionAuthority, true);
}

const convergence = gameDualIngressConvergence();
const projections = gameTargetedDescentAndProjection(convergence.base, convergence);
gameGraphFirstRestart(convergence.base, projections, convergence);
gameLifecycleHistory(convergence.base, projections, convergence);
gameTranscriptAndAuthority(convergence.base, convergence);
gameNegativeLaws(convergence.base, convergence, convergence, projections);
for (const directory of trustDirectories) fs.rmSync(directory, { recursive: true, force: true });
console.log("direct-worldmodel-manager-convergence-games-regression: ok");
