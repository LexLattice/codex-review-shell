#!/usr/bin/env node

// Wave 26 governance integration games.  These games intentionally use only
// persisted artifacts and their validators: a passing assertion is not prose.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const wm = require("../src/main/direct/worldmodel");
const { buildWorkThread } = require("../src/main/direct/bridge/work-thread-registry.js");
const { buildOdeuResultEnvelope } = require("../src/main/direct/odeu/result.js");
const { buildToolCapabilityRegistry } = require("../src/main/direct/bridge/tool-capability-registry.js");
const { sha256 } = require("../src/main/direct/meta-session/digest.js");

const now = () => Date.UTC(2026, 6, 15, 15, 0, 0);
const source = (id, sourceKind = "family_specific") => ({
  sourceRefId: `source_${id}`, sourceKind, sourceId: id, sourceConfidence: "exact", freshness: "fresh",
  observedAt: "2026-07-15T15:00:00.000Z", sourceDigest: { algorithm: "sha256", value: `sha256:${id}`, digestOf: "canonical_json" },
});
const ref = (kind, id) => ({ kind, id, digest: sha256(`${kind}:${id}`), rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false });
const throws = (fn, code) => assert.throws(fn, (error) => error?.code === code, code);
const projectId = "project_x";
const projectB = "project_b";
const projectScope = { scopeKind: "project", userProfileId: "user_fixture", projectId, semanticPath: ["projects", "x", "architecture"] };

function node(nodeId, scope, nodeKind = "idea", summary = nodeId) {
  return { nodeId, scope, nodeKind, abstractionLevel: nodeKind.endsWith("root") ? "strategic" : "conceptual", semanticSummary: summary,
    odeuImpact: { O: [nodeId], E: ["fixture"], D: ["bounded"], U: ["test"] }, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted",
    normativeForce: "informational", custodianRole: scope.scopeKind === "user_world" ? "world_manager" : scope.scopeKind === "work_thread" ? "thread_manager" : "project_manager",
    authorizedWriterRoles: [scope.scopeKind === "user_world" ? "world_manager" : "project_manager"], projectionEligibility: "eligible", sourceRefs: [source(nodeId)] };
}
function graphFixture(trustAnchorRef) {
  return wm.buildHierarchicalWorldmodelGraph({ graphId: "governance_games_graph", userProfileId: "user_fixture", rootNodeId: "user_root",
    ...(trustAnchorRef ? { trustAnchorRef } : {}),
    scopedRevisionRefs: [
      wm.buildScopedWorldmodelRevisionRef({ scopeKind: "user_world", revision: 1 }),
      wm.buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId, revision: 1 }),
      wm.buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: projectB, revision: 1 }),
      wm.buildScopedWorldmodelRevisionRef({ scopeKind: "work_thread", projectId, workThreadId: "thread_later", revision: 1 }),
    ],
    nodes: [
      node("user_root", { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["user"] }, "world_root", "User world"),
      node("global_preference", { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["preferences"] }, "preference", "Current user preference"),
      node("private_world_memory", { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["private"] }, "idea", "Private world-manager memory"),
      node("project_x_root", { scopeKind: "project", userProfileId: "user_fixture", projectId, semanticPath: ["projects", "x"] }, "project_root", "Project X root"),
      node("project_x_operation", projectScope, "decision", "Current operational decision"),
      node("project_b_root", { scopeKind: "project", userProfileId: "user_fixture", projectId: projectB, semanticPath: ["projects", "b"] }, "project_root", "Project B root"),
      node("project_b_memory", { scopeKind: "project", userProfileId: "user_fixture", projectId: projectB, semanticPath: ["projects", "b", "memory"] }, "decision", "Project B memory"),
      node("thread_later_root", { scopeKind: "work_thread", userProfileId: "user_fixture", projectId, workThreadId: "thread_later", semanticPath: ["projects", "x", "threads", "later"] }, "work_thread_root", "Later work thread"),
    ],
    edges: [
      { edgeId: "x_contains_operation", fromNodeId: "project_x_root", toNodeId: "project_x_operation", relationKind: "supports", lifecycle: "active", sourceRefs: [source("x_operation")] },
      { edgeId: "b_contains_memory", fromNodeId: "project_b_root", toNodeId: "project_b_memory", relationKind: "supports", lifecycle: "active", sourceRefs: [source("b_memory")] },
    ],
  }, { now });
}
const trustDirectories = [];
const initializedTrustStores = new WeakSet();
function trustedGraphFixture(label) {
  const directory = mkdtempSync(join(tmpdir(), `wave26-governance-${label}-`));
  trustDirectories.push(directory);
  const store = wm.createWorldmodelTrustStore(directory, { storeId: `governance_${label}_store`, now });
  return { store, graph: graphFixture(wm.buildWorldmodelTrustAnchor(store, "governance_games_graph")) };
}
function installRegistry(store, graph, registry) {
  if (initializedTrustStores.has(store)) wm.installAuthoritativeWorldmodelGovernanceRegistry(store, graph, registry);
  else { wm.initializeAuthoritativeWorldmodelGraph(store, graph, registry); initializedTrustStores.add(store); }
}
function pmProfile() { return wm.buildProjectManagerProfile({ projectManagerProfileId: "pm_x", projectManagerAgentId: "pm_x_agent", worldManagerAgentId: "wm_agent", projectId, projectRootNodeId: "project_x_root", authorityBoundaryRef: ref("authority_boundary", "pm"), graphProjectionPolicyRef: ref("graph_projection_policy", "projection"), sourceRefs: [source("pm")] }, { now }); }
function pmAuthority(manager) { return { kind: manager.authorityBoundaryRef.kind, id: manager.authorityBoundaryRef.id, digest: manager.authorityBoundaryRef.digest }; }
function pmProjectionPolicy(graph, manager, budget = { maxNodes: 20, maxEdges: 20, maxSummaryChars: 2000 }) { const authoritySourceRef = { kind: manager.authorityBoundaryRef.kind, id: manager.authorityBoundaryRef.id, digest: manager.authorityBoundaryRef.digest }; return wm.buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef, policyId: "projection", purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_x_root", digest: graph.nodes.find((entry) => entry.nodeId === "project_x_root").digest }], custodyDenyList: [], sensitivityDenyList: [], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 3, semanticBudget: budget, workerAllowedProjectNodeRefs: [] }); }
function wmProjectionPolicy(graph, manager, authoritySourceRef, budget = { maxNodes: 20, maxEdges: 20, maxSummaryChars: 2000 }) { return wm.buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef, policyId: "wm_projection", purpose: "current_context", allowedEntryPaths: ["world_root"], allowedFocalScopes: [{ scopeKind: "user_world" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "user_root", digest: graph.nodes.find((entry) => entry.nodeId === "user_root").digest }], custodyDenyList: [], sensitivityDenyList: [], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 3, semanticBudget: budget, workerAllowedProjectNodeRefs: [] }); }
function ingress(id, role, scope = projectScope) { return wm.buildWorldmodelIngressEnvelope({ ingressId: id, inputKind: "current_user_message", receivedByAgentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", receivedByRole: role, declaredScopeHints: [scope], currentInstructionAuthority: true, sourceRefs: [source(id)] }, { now }); }
function scopeRevision(graph, scopeKind, id = projectId) { return graph.scopedRevisionRefs.find((entry) => entry.scopeKind === scopeKind && (scopeKind === "user_world" || entry.projectId === id)); }
function contextualLeg(graph, { role, managerProfile, authoritySourceRef, targetScope, targetId, transitionId, summary, propagationId, propagationDirection, propagationSourceTransitionRef, trustStore, admitToStore = true }) {
  const prior = graph.nodes.find((entry) => entry.nodeId === targetId);
  targetScope = { ...prior.scope };
  const currentIngress = ingress(`${transitionId}_ingress`, role, targetScope);
  const targetResolution = wm.buildSemanticTargetResolution({ resolutionId: `${transitionId}_resolution`, ingressId: currentIngress.ingressId, route: targetScope.scopeKind === "user_world" ? "project_to_world_escalation" : "commit_current_scope", candidateTargets: [{ ...targetScope, candidateNodeIds: [targetId], confidence: "exact" }], sourceRefs: currentIngress.sourceRefs });
  const expectedScopeRevisions = [scopeRevision(graph, targetScope.scopeKind, targetScope.projectId)];
  const candidate = wm.buildWorldmodelDeltaCandidate({ candidateId: `${transitionId}_candidate`, ingressId: currentIngress.ingressId, targetResolutionId: targetResolution.resolutionId, receivedByRole: role, targetScope, candidateState: "accepted_for_commit", promotionOrigin: "user_evidence", expectedScopeRevisions, proposedNodeMutations: [{ operation: "revise", targetNodeId: targetId, candidateNode: { ...prior, semanticSummary: summary } }], sourceRefs: currentIngress.sourceRefs }, { now });
  const brokerPacket = wm.buildSemanticIngressBrokerPacket({ ingressEnvelope: currentIngress, targetResolution });
  const authorityDecision = wm.buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `${transitionId}_authority`, graph, managerProfile, actorAgentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", actorRole: role, targetScope, issuedAt: "2026-07-15T15:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
  const custodyMatrix = role === "project_manager" ? wm.buildProjectCustodyWriteMatrix({ projectId: targetScope.projectId }) : null;
  const custodyWriteWitness = custodyMatrix ? wm.buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: role, path: "project.architecture", action: "mutate" }) : null;
  const projectRoot = targetScope.projectId ? graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === targetScope.projectId) : null;
  const binding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: targetScope.scopeKind, ...(targetScope.projectId ? { projectId: targetScope.projectId } : {}), ...(targetScope.workThreadId ? { workThreadId: targetScope.workThreadId } : {}), ...(projectRoot ? { projectRootNodeId: projectRoot.nodeId } : {}), role, agentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", purpose: "graph_append", expectedScopeRevisionDigest: expectedScopeRevisions[0].digest };
  const records = [{ kind: role === "world_manager" ? "world_manager_profile" : "project_manager_profile", body: managerProfile, binding }, { kind: "authority_decision", body: authorityDecision, binding, oneShot: true }];
  if (projectRoot) records.push({ kind: "project_root", body: projectRoot, binding });
  if (custodyMatrix) records.push({ kind: "custody_matrix", body: custodyMatrix, binding }, { kind: "custody_witness", body: custodyWriteWitness, binding });
  const governanceRegistry = wm.buildGovernanceProvenanceRegistry({ registryId: `${transitionId}_registry`, userProfileId: graph.userProfileId, records }, { now });
  const admission = wm.buildWorldmodelContextualAdmission({ admissionId: `${transitionId}_admission`, graph, ingressEnvelope: currentIngress, brokerPacket, targetResolution, candidate, managerProfile, custodyMatrix, custodyWriteWitness, authorityDecision, governanceRegistry, registryRef: wm.registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision, decidedByAgentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", decidedByRole: role, idempotencyKey: transitionId }, { now });
  const writeAuthorization = wm.buildGraphWriteAuthorizationForTransition(graph, { authorizationId: `${transitionId}_write`, actorAgentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", actorRole: role, mutations: admission.mutations, expectedScopeRevisions: admission.expectedScopeRevisions, authorityTraceRef: { sourceRefId: `authority_${transitionId}`, sourceKind: "promotion_decision", sourceId: `${transitionId}_authority`, sourceConfidence: "exact", freshness: "fresh", observedAt: "2026-07-15T15:00:00.000Z", sourceDigest: { algorithm: "sha256", value: authorityDecision.digest, digestOf: "canonical_json" } }, idempotencyKey: transitionId, authorizationExpiresAt: admission.expiresAt });
  let storeAdmission;
  if (admitToStore) {
    if (!trustStore) throw new Error("contextual leg requires harness trust store");
    installRegistry(trustStore, graph, governanceRegistry);
    storeAdmission = wm.admitWorldmodelGovernanceRequest(trustStore, { admissionId: `${transitionId}_store_admission`, graph, context: { ...binding, requiredArtifacts: admission.registryRequiredArtifacts }, issuedAt: "2026-07-15T15:00:00.000Z" });
  }
  return { transitionId, deltaCandidateId: candidate.candidateId, idempotencyKey: transitionId, actorAgentId: role === "world_manager" ? "wm_agent" : "pm_x_agent", actorRole: role, expectedScopeRevisions: admission.expectedScopeRevisions, mutations: admission.mutations, contextualAdmission: admission, governanceRegistry, ...(storeAdmission ? { storeAdmission } : {}), writeAuthorization, sourceRefs: currentIngress.sourceRefs, ...(propagationId ? { propagationId, propagationDirection, propagationSourceTransitionRef } : {}) };
}
function refreshContext(graph, { propagationId, managerProfile, authoritySourceRef, policyArtifact, entryPath, focalScope, id }) {
  const role = managerProfile.schema === "direct_project_manager_profile@1" ? "project_manager" : "world_manager";
  const agentId = role === "project_manager" ? managerProfile.projectManagerAgentId : managerProfile.managerAgentId;
  const projectRootNodeId = focalScope.projectId ? graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === focalScope.projectId)?.nodeId : undefined;
  const staleAuthorityDecision = wm.buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `${id}_stale_context_authority`, graph, managerProfile, actorAgentId: agentId, actorRole: role, targetScope: focalScope, issuedAt: "2026-07-15T15:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
  const binding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: focalScope.scopeKind, ...(focalScope.projectId ? { projectId: focalScope.projectId } : {}), ...(focalScope.workThreadId ? { workThreadId: focalScope.workThreadId } : {}), ...(projectRootNodeId ? { projectRootNodeId } : {}), role, agentId, purpose: "current_context" };
  const staleGovernanceRegistry = wm.buildGovernanceProvenanceRegistry({ registryId: `${id}_stale_context_registry`, userProfileId: graph.userProfileId, records: [{ kind: role === "project_manager" ? "project_manager_profile" : "world_manager_profile", body: managerProfile, binding }, { kind: "projection_policy", body: policyArtifact, binding }, { kind: "authority_decision", body: staleAuthorityDecision, binding, oneShot: true }] }, { now });
  const projection = wm.buildWorldmodelGraphProjection({ graph, managerProfile, authoritySourceRef, policyArtifact, projectionId: `${id}_stale_projection`, audienceAgentId: agentId, entryPath, focalScope });
  const currentIngress = ingress(`${id}_refresh_ingress`, role, focalScope);
  const staleBootPacket = wm.buildManagerTurnBootPacket({ bootPacketId: `${id}_stale_boot`, managerRole: role, managerAgentId: agentId, graphProjection: projection, profileSnapshot: managerProfile, currentIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [] });
  const buildReplacementGovernanceRegistry = ({ graph: nextGraph, policyArtifact: nextPolicy, authorityDecision }) => {
    const nextRootNodeId = focalScope.projectId ? nextGraph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === focalScope.projectId)?.nodeId : undefined;
    const nextBinding = { ...binding, graphDigest: nextGraph.digest, ...(nextRootNodeId ? { projectRootNodeId: nextRootNodeId } : {}) };
    const governanceRegistry = wm.buildGovernanceProvenanceRegistry({ registryId: `${id}_replacement_context_registry`, userProfileId: nextGraph.userProfileId, records: [{ kind: role === "project_manager" ? "project_manager_profile" : "world_manager_profile", body: managerProfile, binding: nextBinding }, { kind: "projection_policy", body: nextPolicy, binding: nextBinding }, { kind: "authority_decision", body: authorityDecision, binding: nextBinding, oneShot: true }] }, { now });
    return { governanceRegistry, registryRef: wm.registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision, projectRootNodeId: nextRootNodeId };
  };
  return { managerProfile, authoritySourceRef, policyArtifact, entryPath, focalScope, projectRootNodeId, staleGraph: graph, staleProjection: projection, staleBootPacket, staleAuthorityDecision, staleGovernanceRegistry, staleRegistryRef: wm.registryRef(staleGovernanceRegistry), staleExpectedRegistryRevision: staleGovernanceRegistry.revision, buildReplacementGovernanceRegistry, currentIngress, propagationId, issuedAt: "2026-07-15T15:00:00.000Z" };
}
function memoryGovernance(graph, managerProfile, candidate, custodyMatrix, custodyWriteWitness, id) {
  const targetScope = { scopeKind: "project", userProfileId: graph.userProfileId, projectId: candidate.projectId, semanticPath: candidate.proposedSemanticPath };
  const authorityDecision = wm.buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `${id}_authority`, graph, managerProfile, actorAgentId: managerProfile.projectManagerAgentId, actorRole: "project_manager", targetScope, issuedAt: "2026-07-15T15:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
  const projectRoot = graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === candidate.projectId);
  const revision = scopeRevision(graph, "project", candidate.projectId);
  const binding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: candidate.projectId, projectRootNodeId: projectRoot.nodeId, role: "project_manager", agentId: managerProfile.projectManagerAgentId, purpose: "graph_append", expectedScopeRevisionDigest: revision.digest };
  const governanceRegistry = wm.buildGovernanceProvenanceRegistry({ registryId: `${id}_registry`, userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: managerProfile, binding }, { kind: "project_root", body: projectRoot, binding }, { kind: "custody_matrix", body: custodyMatrix, binding }, { kind: "custody_witness", body: custodyWriteWitness, binding }, { kind: "authority_decision", body: authorityDecision, binding, oneShot: true }] }, { now });
  return { custodyMatrix, authorityDecision, governanceRegistry, registryRef: wm.registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision };
}

function gameUpwardEscalationAndMixedScope() {
  const graph = graphFixture(); const manager = pmProfile(); const globalIngress = ingress("pm_global_idea", "project_manager", { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["preferences"] });
  const globalResolution = wm.buildSemanticTargetResolution({ ingressId: globalIngress.ingressId, route: "project_to_world_escalation", candidateTargets: [{ scopeKind: "user_world", semanticPath: ["preferences"], confidence: "exact" }], sourceRefs: globalIngress.sourceRefs });
  const globalCandidate = wm.buildWorldmodelDeltaCandidate({ candidateId: "pm_global_candidate", ingressId: globalIngress.ingressId, targetResolutionId: globalResolution.resolutionId, receivedByRole: "project_manager", targetScope: globalResolution.candidateTargets[0], candidateState: "accepted_for_commit", promotionOrigin: "user_evidence", proposedNodeMutations: [{ operation: "add", targetNodeId: "new_global_pref", candidateNode: node("new_global_pref", globalResolution.candidateTargets[0], "preference", "Requested global preference") }], sourceRefs: globalIngress.sourceRefs });
  const matrix = wm.buildProjectCustodyWriteMatrix({ projectId });
  const pmGlobal = wm.promoteWorldmodelDeltaCandidate({ graph, candidate: globalCandidate, targetResolution: globalResolution, decidedByAgentId: manager.projectManagerAgentId, decidedByRole: "project_manager", custodyWriteWitness: wm.buildProjectCustodyWriteWitness({ matrix, actorRole: "project_manager", path: "user.preferences", action: "mutate" }), authorityTraceRef: source("pm_global_authority", "promotion_decision"), explicitPromotionRequested: true }, { now });
  assert.equal(pmGlobal.committed, false); assert.equal(pmGlobal.promotion.decision, "remand", "PM must route global changes upward");
  const wmAdmission = wm.promoteWorldmodelDeltaCandidate({ graph, candidate: globalCandidate, targetResolution: globalResolution, decidedByAgentId: "wm_agent", decidedByRole: "world_manager", authorityTraceRef: source("wm_global_authority", "promotion_decision"), explicitPromotionRequested: true }, { now });
  assert.equal(wmAdmission.promotion.decision, "remand", "World Manager cannot silently admit a PM-shaped global candidate without a lawful controller path");
  const mixed = wm.buildSemanticTargetResolution({ ingressId: globalIngress.ingressId, route: "multi_scope_split", candidateTargets: [{ scopeKind: "user_world", semanticPath: ["preferences"], confidence: "high" }, { ...projectScope, confidence: "high" }], sourceRefs: globalIngress.sourceRefs });
  const split = wm.splitWorldmodelDeltaCandidate({ candidateId: "mixed_scope", ingressId: globalIngress.ingressId, receivedByRole: "world_manager", targetResolution: mixed, proposedNodeMutations: [{ targetScope: mixed.candidateTargets[0], candidateNode: node("mixed_user", mixed.candidateTargets[0], "preference") }, { targetScope: mixed.candidateTargets[1], candidateNode: node("mixed_project", mixed.candidateTargets[1]) }], expectedScopeRevisions: graph.scopedRevisionRefs, sourceRefs: globalIngress.sourceRefs }, { now });
  assert.equal(split.length, 2); assert.deepEqual(new Set(split.map((candidate) => candidate.targetScope.scopeKind)), new Set(["user_world", "project"])); assert.equal(split[0].ingressId, split[1].ingressId, "split candidates retain a linked ingress witness");
  const packet = wm.buildWorldToProjectUpdatePacket({ projectId, sourceGraphTransitionRefs: [source("world_change")], affectedNodeRefs: [source("goal")], affectedEdgeRefs: [], updateKind: "goal_change", changeClass: "active_goal_change", normativeForce: "binding", expectedProjectRevision: 1, resultingProjectRevision: 1, sourceRefs: [source("packet")] }, { now });
  const impact = wm.buildProjectUpdateImpactWitness({ packet, event: "active_goal_change", affectedWorkThreadRefs: [], affectedBootPacketRefs: [], sourceRefs: [source("impact")] }, { now });
  assert.equal(impact.projectId, projectId); assert.equal(wm.evaluateProjectionMateriality({ projectAffected: false }).impact, "unaffected", "unaffected projects must not invalidate");
}

function gameBidirectionalPropagationControllers() {
  const pm = pmProfile(); const pmAuthorityValue = pmAuthority(pm); const wmProfile = wm.buildWorldmodelManagerProfile({ managerProfileId: "wm_propagation", scopeKind: "global_user", userProfileId: "user_fixture", managerAgentId: "wm_agent" }, { now }); const wmAuthority = { kind: "authority_boundary", id: "wm_propagation_authority", digest: "sha256:wm_propagation_authority" };
  const upwardFixture = trustedGraphFixture("upward");
  const graph = upwardFixture.graph;
  const propagationStateDirectory = mkdtempSync(join(tmpdir(), "wave26-propagation-"));
  const propagationStateStore = wm.createPropagationStateStore({ filePath: join(propagationStateDirectory, "state.json"), storeId: "governance_integration_store" });
  const propagationController = wm.createPropagationController({ propagationStateStore });
  throws(() => wm.beginProjectToWorldPropagation({ propagationStateStore: { storeId: propagationStateStore.storeId, recordDelivered() {}, admitApplied() {}, read() {} } }, { now, propagationController }), "direct_project_memory_propagation_store_request_forbidden");
  const upwardSource = contextualLeg(graph, { role: "project_manager", managerProfile: pm, authoritySourceRef: pmAuthorityValue, targetScope: { scopeKind: "project", projectId }, targetId: "project_x_operation", transitionId: "upward_source", summary: "Project approved escalation", trustStore: upwardFixture.store });
  const foreignUpwardSource = contextualLeg(graph, { role: "project_manager", managerProfile: pm, authoritySourceRef: pmAuthorityValue, targetScope: { scopeKind: "project", projectId }, targetId: "project_x_operation", transitionId: "foreign_upward_source", summary: "Foreign registry source", admitToStore: false });
  throws(() => wm.beginProjectToWorldPropagation({ propagationId: "upward", projectId, graph, sourceLeg: { ...upwardSource, governanceRegistry: foreignUpwardSource.governanceRegistry, storeAdmission: { ...upwardSource.storeAdmission, registryRef: wm.registryRef(foreignUpwardSource.governanceRegistry) } }, sourceRefs: [source("upward")] }, { now, propagationController }), "direct_worldmodel_trust_store_admission_invalid");
  throws(() => wm.beginProjectToWorldPropagation({ propagationId: "upward", projectId, graph, sourceLeg: { ...upwardSource, actorRole: "world_manager" } }, { now, propagationController }), "direct_project_memory_propagation_authority_mismatch");
  throws(() => wm.beginProjectToWorldPropagation({ propagationId: "upward", projectId: projectB, graph, sourceLeg: upwardSource }, { now, propagationController }), "direct_project_memory_propagation_project_mismatch");
  const upwardStart = wm.beginProjectToWorldPropagation({ propagationId: "upward", projectId, graph, sourceLeg: upwardSource, sourceRefs: [source("upward")] }, { now, propagationController }); assert.equal(upwardStart.record.state, "delivered");
  throws(() => wm.beginProjectToWorldPropagation({ propagationId: "upward", projectId, graph: upwardStart.graph, sourceLeg: upwardSource }, { now, propagationController }), "direct_hierarchical_graph_transition_reused");
  const upwardDestination = contextualLeg(upwardStart.graph, { role: "world_manager", managerProfile: wmProfile, authoritySourceRef: wmAuthority, targetScope: { scopeKind: "user_world" }, targetId: "global_preference", transitionId: "upward_destination", summary: "World accepted escalated project preference", propagationId: "upward", propagationDirection: "project_to_world", propagationSourceTransitionRef: upwardStart.record.sourceTransitionRef, trustStore: upwardFixture.store });
  const upPolicy = wmProjectionPolicy(upwardStart.graph, wmProfile, wmAuthority);
  const upRefresh = refreshContext(upwardStart.graph, { propagationId: "upward", managerProfile: wmProfile, authoritySourceRef: wmAuthority, policyArtifact: upPolicy, entryPath: "world_root", focalScope: { scopeKind: "user_world" }, id: "upward" });
  const upwardContext = { sourcePreGraph: upwardStart.sourcePreGraph, sourcePreGovernanceRegistry: upwardStart.sourcePreGovernanceRegistry };
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardStart.governanceRegistry, destinationLeg: { ...upwardDestination, propagationDirection: "world_to_project" }, refreshContext: upRefresh }, { now, propagationController }), "direct_project_memory_propagation_destination_admission_mismatch");
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardStart.governanceRegistry, sourceResult: { graph: upwardStart.graph, transition: { ...upwardStart.sourceResult.transition, transitionId: "foreign_transition" } }, destinationLeg: upwardDestination, refreshContext: upRefresh }, { now, propagationController }), "direct_project_memory_propagation_foreign_transition");
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardStart.governanceRegistry, destinationLeg: upwardDestination, refreshContext: { ...upRefresh, staleBootPacket: { ...upRefresh.staleBootPacket, digest: "sha256:fake" } } }, { now, propagationController }), "direct_manager_turn_context_digest_mismatch");
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardStart.governanceRegistry, destinationLeg: upwardDestination, refreshContext: { ...upRefresh, staleGraph: graph } }, { now, propagationController }), "direct_project_memory_propagation_graph_receipt_mismatch");
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardSource.governanceRegistry, destinationLeg: upwardDestination, refreshContext: upRefresh }, { now, propagationController }), "direct_project_memory_propagation_transition_binding_mismatch");
  // Replacement-registry substitution is covered before current-context
  // admission in the dedicated manager-context/projection regressions.  This
  // propagation game keeps the one-shot destination admission for its lawful
  // completion instead of deliberately committing a destination then failing
  // a post-transition refresh.
  const upward = wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upwardStart.graph, governanceRegistry: upwardStart.governanceRegistry, destinationLeg: upwardDestination, refreshContext: upRefresh }, { now, propagationController }); assert.equal(upward.record.state, "applied"); assert.equal(upward.record.bootRefreshes[0].replacementCompilation.graphRef.graphDigest, upward.graph.digest);
  throws(() => wm.validateProjectWorldPropagationRecord({ ...upward.record, direction: "world_to_project", projectId: projectB, sourceTransitionRef: upward.record.destinationTransitionRef, affectedNodeIds: ["unrelated_node"] }), "direct_project_memory_propagation_authoritative_admission_required");
  const restartedPropagationStateStore = wm.createPropagationStateStore({ filePath: join(propagationStateDirectory, "state.json"), storeId: "governance_integration_store" });
  const restartedPropagationController = wm.createPropagationController({ propagationStateStore: restartedPropagationStateStore });
  const restartContext = { sourcePreGraph: upwardStart.sourcePreGraph, sourcePostGraph: upwardStart.graph, destinationPostGraph: upward.graph, sourcePreGovernanceRegistry: upwardStart.sourcePreGovernanceRegistry, sourcePostGovernanceRegistry: upwardStart.governanceRegistry, destinationPostGovernanceRegistry: upward.governanceRegistry };
  assert.equal(wm.readAppliedProjectWorldPropagationRecordFromController({ propagationId: "upward", propagationContext: restartContext }, { propagationController: restartedPropagationController }).propagationDigest, upward.record.propagationDigest, "applied must survive only as verified controller readback");
  throws(() => wm.admitProjectWorldPropagationRecordAgainstContext(upward.record, { ...restartContext, propagationStateStore: restartedPropagationStateStore }), "direct_project_memory_propagation_authoritative_admission_required");
  throws(() => wm.createPropagationStateStore({ filePath: join(propagationStateDirectory, "state.json"), storeId: "swapped_store" }), "direct_project_memory_propagation_store_swap");
  assert.deepEqual(upward.record.sourceBinding.governanceRegistryPostRef, wm.registryRef(upwardStart.governanceRegistry)); assert.deepEqual(upward.record.destinationBinding.governanceRegistryPostRef, wm.registryRef(upward.governanceRegistry));
  assert.equal(upward.record.bootRefreshes[0].replacementGovernanceRegistryRef.revision, 0);
  throws(() => wm.completeProjectToWorldPropagation({ ...upwardContext, record: upwardStart.record, graph: upward.graph, governanceRegistry: upwardStart.governanceRegistry, destinationLeg: upwardDestination, refreshContext: upRefresh }, { now, propagationController }), "direct_project_memory_propagation_authoritative_admission_required");
  const downwardFixture = trustedGraphFixture("downward");
  const downwardGraph = downwardFixture.graph;
  const downwardSource = contextualLeg(downwardGraph, { role: "world_manager", managerProfile: wmProfile, authoritySourceRef: wmAuthority, targetScope: { scopeKind: "user_world" }, targetId: "global_preference", transitionId: "downward_source", summary: "World change for project", trustStore: downwardFixture.store });
  const downwardStart = wm.beginWorldToProjectPropagation({ propagationId: "downward", projectId, graph: downwardGraph, sourceLeg: downwardSource, sourceRefs: [source("downward")] }, { now, propagationController });
  const downwardDestination = contextualLeg(downwardStart.graph, { role: "project_manager", managerProfile: pm, authoritySourceRef: pmAuthorityValue, targetScope: { scopeKind: "project", projectId }, targetId: "project_x_operation", transitionId: "downward_destination", summary: "Project applied world change", propagationId: "downward", propagationDirection: "world_to_project", propagationSourceTransitionRef: downwardStart.record.sourceTransitionRef, trustStore: downwardFixture.store });
  const downPolicy = pmProjectionPolicy(downwardStart.graph, pm);
  const downRefresh = refreshContext(downwardStart.graph, { propagationId: "downward", managerProfile: pm, authoritySourceRef: pmAuthorityValue, policyArtifact: downPolicy, entryPath: "project_resident", focalScope: { scopeKind: "project", projectId }, id: "downward" });
  const downward = wm.completeWorldToProjectPropagation({ sourcePreGraph: downwardStart.sourcePreGraph, sourcePreGovernanceRegistry: downwardStart.sourcePreGovernanceRegistry, record: downwardStart.record, graph: downwardStart.graph, governanceRegistry: downwardStart.governanceRegistry, destinationLeg: downwardDestination, refreshContext: downRefresh }, { now, propagationController }); assert.equal(downward.record.state, "applied"); assert.equal(downward.record.bootRefreshes[0].replacementCompilation.graphRef.graphDigest, downward.graph.digest);
  const downwardPacket = wm.buildWorldToProjectUpdatePacket({ updatePacketId: "downward_packet", projectId, sourceGraphTransitionRefs: [downward.record.sourceTransitionRef], affectedNodeRefs: downward.record.affectedNodeIds.map((id) => source(id)), affectedEdgeRefs: [], updateKind: "goal_change", changeClass: "active_goal_change", normativeForce: "binding", expectedProjectRevision: 0, resultingProjectRevision: 0, sourceRefs: [source("downward_packet")] }, { now });
  const downwardPropagationContext = { sourcePreGraph: downwardStart.sourcePreGraph, sourcePostGraph: downwardStart.graph, destinationPostGraph: downward.graph, sourcePreGovernanceRegistry: downwardStart.sourcePreGovernanceRegistry, sourcePostGovernanceRegistry: downwardStart.governanceRegistry, destinationPostGovernanceRegistry: downward.governanceRegistry };
  const downwardAcknowledgement = wm.buildAppliedProjectGraphUpdateAcknowledgementFromController({ acknowledgementId: "downward_ack", propagationId: "downward", packet: downwardPacket, projectManagerProfile: pm, propagationContext: downwardPropagationContext, affectedWorkThreadRefs: [], sourceRefs: [source("downward_ack")] }, { now, propagationController });
  assert.equal(downwardAcknowledgement.outcome, "applied", "only the persisted entry may produce an applied acknowledgement");
  const duckStoreController = { storeId: propagationStateStore.storeId, readApplied() { return downward.record; }, recordDelivered() {}, admitApplied() {} };
  throws(() => wm.admitProjectGraphUpdateAcknowledgementAgainstContext(downwardAcknowledgement, { packet: downwardPacket, projectManagerProfile: pm, propagationId: "downward", propagationContext: downwardPropagationContext, propagationController: duckStoreController }), "direct_project_memory_propagation_controller_required");
  throws(() => wm.buildProjectGraphUpdateAcknowledgement({ packet: downwardPacket, projectManagerProfile: pm, outcome: "applied", destinationTransition: { outcome: "committed", transitionId: "semantic_promotion_transition_unrelated", digest: "sha256:unrelated" }, affectedWorkThreadRefs: [], sourceRefs: [source("unrelated_transition_ack")] }, { now, _controllerAdmission: true }), "direct_project_memory_ack_authoritative_admission_required");
  rmSync(propagationStateDirectory, { recursive: true, force: true });
}

function gameClosureMemoryReuseAndWorkerBoundary() {
  const fixture = trustedGraphFixture("project_memory"); const graph = fixture.graph; const manager = pmProfile(); const workThread = buildWorkThread({ workThreadId: "thread_closed", projectId, lifecycleState: "completed", objective: "Close and retain decision" }, { nowMs: now() });
  const closureIdentity = { managerProfileId: manager.projectManagerProfileId, managerAgentId: manager.projectManagerAgentId, runId: "closure_run", callId: "closure_call" };
  const closureResultEnvelope = buildOdeuResultEnvelope({ resultEnvelopeId: "closure_result", capabilityId: "closure", callId: "closure_call", transactionId: "closure_run", resultKind: "agent_result", sourceRefs: [source("closure_result")], rendererSafeSummary: "Closure is evidence.", visibility: { rendererVisible: "summary", residentVisible: "summary", providerVisible: "not_seen", transcriptVisible: "none" }, payloadPolicy: { rawPayloadStored: false, rawPayloadProviderSent: false, rawPayloadRendererVisible: false, redactionState: "none_needed", truncationState: "none" }, rawTextIncluded: false, rawPathIncluded: false, rawProviderPayloadIncluded: false, confidence: "exact" }, { now });
  const closure = wm.buildWorkThreadClosureEvidenceWitness({ projectId, workThread, closureResultEnvelope, closureIdentity, sourceRefs: [source("closure_witness")] }, { now }); const contexts = [{ witness: closure, workThread, closureResultEnvelope, closureIdentity }];
  const candidate = wm.buildProjectMemoryCandidate({ candidateId: "memory_candidate", projectId, projectManagerAgentId: manager.projectManagerAgentId, closureEvidenceContexts: contexts, candidateKind: "decision", proposedSemanticPath: ["projects", projectId, "memory", "decisions"], proposedNode: { ...node("admitted_memory", projectScope, "decision", "Admitted memory reused later"), graphId: graph.graphId }, expectedProjectRevision: 1, sourceRefs: [source("memory_candidate")] }, { now });
  const custodyMatrix = wm.buildProjectCustodyWriteMatrix({ projectId });
  const custody = wm.buildProjectCustodyWriteWitness({ matrix: custodyMatrix, actorRole: "project_manager", path: "project.memory.decisions", action: "mutate" });
  const governance = memoryGovernance(graph, manager, candidate, custodyMatrix, custody, "memory_admission");
  installRegistry(fixture.store, graph, governance.governanceRegistry);
  const governanceBinding = governance.governanceRegistry.records.find((record) => record.kind === "project_manager_profile").binding;
  const requiredArtifacts = [
    { kind: "project_manager_profile", id: manager.projectManagerProfileId, digest: manager.profileDigest },
    { kind: "authority_decision", id: governance.authorityDecision.authorityDecisionId, digest: governance.authorityDecision.digest, oneShot: true },
    { kind: "project_root", id: graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === projectId).nodeId, digest: graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === projectId).digest },
    { kind: "custody_matrix", id: custodyMatrix.matrixId, digest: custodyMatrix.matrixDigest },
    { kind: "custody_witness", id: custody.path, digest: custody.writeWitnessDigest },
  ];
  const storeAdmission = wm.admitWorldmodelGovernanceRequest(fixture.store, { admissionId: "memory_admission_store", graph, context: { ...governanceBinding, requiredArtifacts }, issuedAt: "2026-07-15T15:00:00.000Z" });
  const admitted = wm.admitProjectMemoryCandidate({ candidate, graph, projectManagerProfile: manager, closureEvidenceContexts: contexts, decision: "admit", custodyWriteWitness: custody, authorityTraceRef: source("memory_admission", "promotion_decision"), ...governance, storeAdmission }, { now });
  assert.equal(admitted.committed, true); wm.validateProjectMemoryAdmission(admitted.admission); const memoryNode = admitted.graph.nodes.find((entry) => entry.nodeId === "admitted_memory");
  const binding = wm.buildScopedWorldMemoryBinding({ memoryArtifactRef: source("memory_artifact"), memoryId: "memory_row", semanticNodeId: memoryNode.nodeId, semanticNodeDigest: memoryNode.digest, homeScope: "project", projectId, custodianRole: "project_manager", compatibilityState: "graph_primary", sourceRefs: [source("memory_binding")] }, { now }); wm.validateScopedWorldMemoryBinding(binding, { graph: admitted.graph });
  assert.equal(binding.mayEnterContextThroughLegacyMemoryProjection, false); assert.equal(binding.mayEnterContextThroughGraphProjection, true);
  const laterPolicy = pmProjectionPolicy(admitted.graph, manager);
  const later = wm.buildWorldmodelGraphProjection({ graph: admitted.graph, managerProfile: manager, authoritySourceRef: pmAuthority(manager), policyArtifact: laterPolicy, audienceAgentId: "pm_x_agent", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId } });
  assert(later.selectedNodeRefs.some((entry) => entry.id === memoryNode.nodeId)); assert.equal(later.rawTranscriptIncluded, false, "later boot reuses graph state, never transcript replay");
  const workerWrite = wm.buildProjectCustodyWriteWitness({ matrix: wm.buildProjectCustodyWriteMatrix({ projectId }), actorRole: "worker", path: "project.memory", action: "mutate" }); assert.equal(workerWrite.decision, "remanded", "worker lane cannot directly write ProjectWorld");
  throws(() => wm.validateScopedWorldMemoryBinding({ ...binding, mayEnterContextThroughLegacyMemoryProjection: true }, { graph: admitted.graph }), "direct_project_memory_double_inclusion_forbidden");
}

function gameRevisionPrivacyAndCurrentIngress() {
  const graph = graphFixture(); const manager = pmProfile();
  const packet = wm.buildWorldToProjectUpdatePacket({ projectId, sourceGraphTransitionRefs: [source("parent_transition")], affectedNodeRefs: [source("operational")], affectedEdgeRefs: [], updateKind: "goal_change", changeClass: "active_goal_change", normativeForce: "binding", expectedProjectRevision: 1, resultingProjectRevision: 1, sourceRefs: [source("parent_packet")] }, { now });
  const stale = wm.applyWorldToProjectUpdatePacket({ packet, projectManagerProfile: manager, currentProjectRevision: 2 }, { now }); assert.equal(stale.outcome, "stale_remand", "parent update cannot overwrite newer project state");
  const projectionPolicy = pmProjectionPolicy(graph, manager);
  const projection = wm.buildWorldmodelGraphProjection({ graph, managerProfile: manager, authoritySourceRef: pmAuthority(manager), policyArtifact: projectionPolicy, entryPath: "project_resident", focalScope: { scopeKind: "project", projectId } });
  assert(!projection.selectedNodeRefs.some((entry) => ["private_world_memory", "project_b_memory"].includes(entry.id)), "private/unrelated state cannot enter Project X projection");
  const current = ingress("current_instruction", "project_manager"); const history = wm.buildWorldmodelIngressEnvelope({ ingressId: "older_instruction", inputKind: "historical_transcript_inspection", receivedByAgentId: "pm_x_agent", receivedByRole: "project_manager", currentInstructionAuthority: false, sourceRefs: [source("older_instruction")] }, { now });
  assert.equal(current.currentInstructionAuthority, true); assert.equal(history.currentInstructionAuthority, false, "current user ingress outranks historical instruction");
  throws(() => wm.validateWorldmodelIngressEnvelope({ ...history, currentInstructionAuthority: true }), "direct_semantic_ingress_envelope_authority_boundary");
  throws(() => wm.buildManagerTurnBootPacket({ rawTranscript: "private historical content" }), "direct_manager_turn_context_raw_state_forbidden");
  throws(() => wm.buildWorldmodelIngressEnvelope({ ingressId: "chat_scope", inputKind: "current_user_message", receivedByAgentId: "pm_x_agent", receivedByRole: "project_manager", declaredScopeHints: [{ scopeKind: "project", projectId, sessionId: "chat_1", semanticPath: ["sessions", "chat_1"] }], currentInstructionAuthority: true, sourceRefs: [source("chat_scope")] }, { now }), "direct_semantic_ingress_interaction_scope_forbidden");
  const pmConstitutional = wm.buildProjectCustodyWriteWitness({ matrix: wm.buildProjectCustodyWriteMatrix({ projectId }), actorRole: "project_manager", path: "user.constitution.policy", action: "mutate" }); assert.equal(pmConstitutional.decision, "remanded");
  const bProjection = wm.buildWorldmodelGraphProjection({ graph, managerProfile: manager, authoritySourceRef: pmAuthority(manager), policyArtifact: projectionPolicy, entryPath: "project_resident", focalScope: { scopeKind: "project", projectId } }); assert(!bProjection.selectedNodeRefs.some((entry) => entry.id === "project_b_memory"));
}

function gameProfileFitDoesNotGrantAuthority() {
  const topology = wm.buildDirectEnvironmentTopology({ topologyId: "games_topology", projectId, revision: 3, defaultEnvironmentId: "wsl", environments: [{ environmentId: "wsl", environmentKind: "wsl", displayLabel: "WSL", defaultShell: "bash", availableToolFamilyRefs: [ref("tool_family", "workspace")] }, { environmentId: "windows", environmentKind: "windows", displayLabel: "Windows browser", defaultShell: "powershell", availableToolFamilyRefs: [ref("tool_family", "browser")] }], mappings: [{ mappingId: "wsl_windows", fromEnvironmentId: "wsl", toEnvironmentId: "windows", fromRootEvidenceKey: "wsl", toRootEvidenceKey: "win", direction: "two_way", mappingKind: "wsl_windows_path", readAllowed: true, writeAllowed: false }], constraints: [{ constraintId: "no_win_mutation", environmentId: "windows", constraintKind: "no_workspace_mutation", rationale: "route is evidence, not authority" }] }, { now });
  const topologyRef = ref("direct_environment_topology", topology.topologyId); topologyRef.digest = topology.topologyDigest;
  const registry = buildToolCapabilityRegistry({ projectId, workThreadId: "profile_thread", rows: [{ toolId: "browser.verify", displayName: "browser", directNames: ["browser"], odeuFamily: "external_capability_discovery", capabilityState: "runtime_probed", implementationState: "projection_only", promotionState: "diagnostic_only", providerDeclarationState: "not_declared", localExecutorState: "scaffolded", requestShapeFamilies: ["browser"], localExecutor: "browser" }] });
  const turn = wm.buildTurnExecutionEnvironment({ topology, turnId: "turn", threadId: "profile_thread", residentEnvironmentId: "wsl", selectionKind: "thread_default", reason: "work" }, { now }); const catalogTools = wm.buildEnvironmentAwareToolCatalog({ projectId, capabilityRegistry: registry, topology, turnEnvironment: turn, rows: [{ toolId: "browser.verify", ownerEnvironmentId: "windows", environmentRouteClass: "specialist_worker_required", environmentActionClass: "browser" }] }, { now });
  const seed = wm.buildProjectExecutionProfileCatalog({ profiles: [{ profileId: "model", profileKind: "model", label: "model", availability: "available", sourceRefs: [ref("evidence", "model")] }, { profileId: "high", profileKind: "reasoning_effort", label: "high", availability: "available", sourceRefs: [ref("evidence", "high")] }], sourceRefs: [ref("evidence", "seed")] }, { now }); const model = seed.profiles[0]; const effort = seed.profiles[1]; const modelRef = ref("model_profile", model.profileId); modelRef.digest = model.profileDigest; const effortRef = ref("reasoning_effort_profile", effort.profileId); effortRef.digest = effort.profileDigest;
  const profiles = wm.buildProjectExecutionProfileCatalog({ profiles: [...seed.profiles, { profileId: "pm_wsl", profileKind: "project_manager", label: "PM", availability: "available", environmentId: "wsl", modelProfileRef: modelRef, reasoningEffortProfileRef: effortRef, sourceRefs: [ref("evidence", "pm")] }, { profileId: "worker_wsl", profileKind: "worker", label: "Worker", availability: "available", environmentId: "wsl", sourceRefs: [ref("evidence", "worker")] }, { profileId: "browser_windows", profileKind: "specialist", label: "Browser", availability: "available", environmentId: "windows", operationalNeeds: ["browser_verification"], sourceRefs: [ref("evidence", "browser")] }], sourceRefs: [ref("evidence", "profiles")] }, { now });
  const manager = pmProfile(); const projectWorld = wm.buildProjectWorldState({ projectManagerProfile: manager, canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph"), projectRevision: 3, terminalGoalNodeRefs: [ref("worldmodel_semantic_node", "ship")], conceptualModelNodeRefs: [ref("worldmodel_semantic_node", "architecture")], statusSummaryNodeRef: ref("worldmodel_semantic_node", "status") }, { now }); const control = wm.buildProjectControlProfileSnapshot({ projectId, projectRevision: 3, userControlProfileRefs: [ref("user_control", "u")], environmentTopologyRef: topologyRef, authorizationBoundaryRef: ref("authorization_boundary", "auth"), configuredModelProfileRef: modelRef, configuredReasoningEffortProfileRef: effortRef, concurrencyLimit: 2, delegationDepthLimit: 1, sourceRefs: [ref("evidence", "control")] }, { now }); const browserContract = wm.buildPluginSpecialistWorkerContract({ contractId: "governance_browser_contract", routeRow: catalogTools.routeRows[0], targetEnvironmentId: "windows", operationalNeed: "browser_verification" }, { now });
  const result = wm.resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: profiles, environmentAwareToolCatalog: catalogTools, projectNeeds: { homeEnvironmentId: "wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [{ operationalNeed: "browser_verification", environmentId: "windows", routeRowId: catalogTools.routeRows[0].rowId, specialistContract: browserContract }] } });
  assert.equal(result.status, "bound"); assert.equal(result.effectiveTruth.runtimeEffectStatus, "not_yet_observed"); for (const field of ["authorityGranted", "spawnAllowed", "toolUseAllowed", "workspaceMutationAllowed"]) assert.equal(result.binding[field], false); assert.equal(result.binding.preferredSpecialistRoutes[0].environmentRef.id, "windows");
  const unavailable = wm.buildProjectExecutionProfileCatalog({ profiles: profiles.profiles.map((entry) => entry.profileId === "pm_wsl" ? { ...entry, availability: "unavailable" } : entry), sourceRefs: [ref("evidence", "unavailable")] }, { now }); const remand = wm.resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: unavailable, environmentAwareToolCatalog: catalogTools, projectNeeds: { homeEnvironmentId: "wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } }); assert.equal(remand.status, "remand"); assert(remand.unresolvedNeeds.includes("project_manager_profile_unavailable"));
  const ambiguous = wm.buildProjectExecutionProfileCatalog({ profiles: [...profiles.profiles, { ...profiles.profiles.find((entry) => entry.profileId === "pm_wsl"), profileId: "pm_wsl_second", sourceRefs: [ref("evidence", "pm_second")] }], sourceRefs: [ref("evidence", "ambiguous")] }, { now }); const ambiguousRemand = wm.resolveProjectExecutionProfile({ projectWorldState: projectWorld, projectManagerProfile: manager, controlProfileSnapshot: control, environmentTopology: topology, profileCatalog: ambiguous, environmentAwareToolCatalog: catalogTools, projectNeeds: { homeEnvironmentId: "wsl", forkTurns: "none", requestedModelProfileRef: modelRef, requestedReasoningEffortProfileRef: effortRef, specialistNeeds: [] } }); assert.equal(ambiguousRemand.status, "remand"); assert(ambiguousRemand.unresolvedNeeds.includes("ambiguous_project_manager_profile"));
}

gameUpwardEscalationAndMixedScope();
gameBidirectionalPropagationControllers();
gameClosureMemoryReuseAndWorkerBoundary();
gameRevisionPrivacyAndCurrentIngress();
gameProfileFitDoesNotGrantAuthority();
for (const directory of trustDirectories) rmSync(directory, { recursive: true, force: true });
console.log("direct-worldmodel-governance-integration-games-regression: ok");
