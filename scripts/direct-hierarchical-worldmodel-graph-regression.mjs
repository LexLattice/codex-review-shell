#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  appendWorldmodelGraphTransition,
  appendLegacyNonWave26WorldmodelGraphTransition,
  buildGraphWriteAuthorizationForTransition,
  buildHierarchicalWorldmodelGraph,
  buildProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  buildProjectManagerProfile,
  buildScopedWorldmodelRevisionRef,
  buildSemanticIngressBrokerPacket,
  buildSemanticTargetResolution,
  buildWorldmodelContextualAdmission,
  buildWorldmodelContextualAuthorityDecision,
  buildWorldmodelDeltaCandidate,
  buildWorldmodelIngressEnvelope,
  buildGovernanceProvenanceRegistry,
  registryRef,
  graphDigestFor,
  validateHierarchicalWorldmodelGraph,
  validateWorldmodelGraphReplay,
  validateLegacyNonWave26WorldmodelGraphReplay,
  createWorldmodelTrustStore,
  openWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  resolveAuthoritativeWorldmodelTrustStore,
  initializeAuthoritativeWorldmodelGraph,
  installAuthoritativeWorldmodelGovernanceRegistry,
  readAuthoritativeWorldmodelGraph,
} = require("../src/main/direct/worldmodel");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try { fn(); } catch (error) {
    if (!String(error.code || error.message).includes(expectedCode)) throw error;
    return;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function append(graph, input) {
  if (input.actorRole !== "project_manager") return appendLegacyNonWave26WorldmodelGraphTransition(graph, { ...input, writeAuthorization: buildGraphWriteAuthorizationForTransition(graph, input) });
  const targetMutation = input.mutations[0];
  const prior = graph.nodes.find((entry) => entry.nodeId === targetMutation.targetId);
  const targetScope = targetMutation.node?.scope || prior?.scope;
  const projectRoot = graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === targetScope.projectId);
  const profile = buildProjectManagerProfile({ projectManagerProfileId: `profile_${targetScope.projectId}`, projectManagerAgentId: input.actorAgentId, worldManagerAgentId: "world_manager_fixture", projectId: targetScope.projectId, projectRootNodeId: projectRoot.nodeId, authorityBoundaryRef: { kind: "authority_boundary", id: `boundary_${targetScope.projectId}`, digest: `sha256:boundary_${targetScope.projectId}` }, graphProjectionPolicyRef: { kind: "graph_projection_policy", id: `policy_${targetScope.projectId}`, digest: `sha256:policy_${targetScope.projectId}` }, sourceRefs: input.sourceRefs });
  const ingress = buildWorldmodelIngressEnvelope({ ingressId: `ingress_${input.transitionId}`, inputKind: "current_user_message", receivedByAgentId: input.actorAgentId, receivedByRole: "project_manager", declaredScopeHints: [targetScope], sourceRefs: input.sourceRefs, currentInstructionAuthority: true });
  const resolution = buildSemanticTargetResolution({ resolutionId: `resolution_${input.transitionId}`, ingressId: ingress.ingressId, route: "commit_current_scope", candidateTargets: [{ ...targetScope, candidateNodeIds: [targetMutation.targetId], confidence: "exact" }], sourceRefs: ingress.sourceRefs });
  const candidateNode = { ...(prior || {}), ...(targetMutation.node || {}), nodeId: targetMutation.targetId, graphId: graph.graphId, scope: targetScope, lifecycle: targetMutation.mutationKind === "set_node_lifecycle" ? targetMutation.lifecycle : targetMutation.node?.lifecycle || prior?.lifecycle, sourceRefs: ingress.sourceRefs };
  const candidate = buildWorldmodelDeltaCandidate({ candidateId: input.deltaCandidateId, ingressId: ingress.ingressId, targetResolutionId: resolution.resolutionId, receivedByRole: "project_manager", targetScope, candidateState: "accepted_for_commit", sourceRefs: ingress.sourceRefs, expectedScopeRevisions: input.expectedScopeRevisions, proposedNodeMutations: [{ operation: targetMutation.mutationKind === "add_node" ? "add" : targetMutation.mutationKind === "set_node_lifecycle" ? "set_lifecycle" : "revise", targetNodeId: targetMutation.targetId, candidateNode }] });
  const matrix = buildProjectCustodyWriteMatrix({ projectId: targetScope.projectId });
  const custodyWriteWitness = buildProjectCustodyWriteWitness({ matrix, actorRole: "project_manager", path: "project.architecture" });
  const brokerPacket = buildSemanticIngressBrokerPacket({ ingressEnvelope: ingress, targetResolution: resolution });
  const authorityDecision = buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `authority_${input.transitionId}`, graph, managerProfile: profile, actorAgentId: input.actorAgentId, actorRole: "project_manager", targetScope, issuedAt: input.createdAt, expiresAt: "2099-01-01T00:00:00.000Z" });
  const revision = input.expectedScopeRevisions.find((ref) => ref.scopeKind === targetScope.scopeKind && ref.projectId === targetScope.projectId && ref.workThreadId === targetScope.workThreadId);
  const binding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: targetScope.scopeKind, projectId: targetScope.projectId, workThreadId: targetScope.workThreadId, projectRootNodeId: projectRoot.nodeId, role: "project_manager", agentId: input.actorAgentId, purpose: "graph_append", expectedScopeRevisionDigest: revision.digest };
  const governanceRegistry = buildGovernanceProvenanceRegistry({ registryId: `registry_${input.transitionId}`, userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: profile, binding }, { kind: "project_root", body: projectRoot, binding }, { kind: "custody_matrix", body: matrix, binding }, { kind: "custody_witness", body: custodyWriteWitness, binding }, { kind: "authority_decision", body: authorityDecision, binding, oneShot: true }] });
  const contextualAdmission = buildWorldmodelContextualAdmission({ admissionId: `admission_${input.transitionId}`, graph, ingressEnvelope: ingress, brokerPacket, targetResolution: resolution, candidate, managerProfile: profile, custodyMatrix: matrix, custodyWriteWitness, authorityDecision, governanceRegistry, registryRef: registryRef(governanceRegistry), expectedRegistryRevision: governanceRegistry.revision, decidedByAgentId: input.actorAgentId, decidedByRole: "project_manager", idempotencyKey: input.idempotencyKey });
  const writeAuthorization = buildGraphWriteAuthorizationForTransition(graph, { ...input, mutations: contextualAdmission.mutations, expectedScopeRevisions: contextualAdmission.expectedScopeRevisions, authorizationExpiresAt: input.authorizationExpiresAt || contextualAdmission.expiresAt });
  return appendLegacyNonWave26WorldmodelGraphTransition(graph, { ...input, mutations: contextualAdmission.mutations, sourceRefs: ingress.sourceRefs, expectedScopeRevisions: contextualAdmission.expectedScopeRevisions, contextualAdmission, governanceRegistry, writeAuthorization });
}

function sourceRefs(label) {
  return [{
    sourceRefId: `source_${label}`,
    sourceKind: "family_specific",
    sourceId: label,
    sourceConfidence: "fixture",
    freshness: "fresh",
    observedAt: "2026-07-15T09:00:00.000Z",
  }];
}

function node(nodeId, scope, nodeKind = "idea", lifecycle = "active") {
  return {
    nodeId,
    scope,
    nodeKind,
    abstractionLevel: nodeKind.endsWith("root") ? "world" : "conceptual",
    semanticSummary: `${nodeId} semantic state`,
    odeuImpact: { O: [nodeId], E: ["fixture evidence"], D: ["bounded"], U: ["regression" ] },
    lifecycle,
    epistemicStatus: "accepted",
    normativeForce: "informational",
    custodianRole: scope.scopeKind === "work_thread" ? "thread_manager" : scope.scopeKind === "project" ? "project_manager" : "world_manager",
    authorizedWriterRoles: ["project_manager"],
    projectionEligibility: lifecycle === "active" ? "eligible" : "history_only",
    sourceRefs: sourceRefs(nodeId),
  };
}

const userScope = { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["user"] };
const projectAScope = { scopeKind: "project", userProfileId: "user_fixture", projectId: "project_a", semanticPath: ["projects", "a"] };
const projectBScope = { scopeKind: "project", userProfileId: "user_fixture", projectId: "project_b", semanticPath: ["projects", "b"] };
const threadAScope = { scopeKind: "work_thread", userProfileId: "user_fixture", projectId: "project_a", workThreadId: "thread_a", semanticPath: ["projects", "a", "threads", "a"] };
const threadBScope = { scopeKind: "work_thread", userProfileId: "user_fixture", projectId: "project_b", workThreadId: "thread_b", semanticPath: ["projects", "b", "threads", "b"] };

let graph = buildHierarchicalWorldmodelGraph({
  graphId: "wave26_graph_fixture",
  userProfileId: "user_fixture",
  rootNodeId: "user_root",
  nodes: [
    node("user_root", userScope, "world_root"),
    node("project_a_root", projectAScope, "project_root"),
    node("project_b_root", projectBScope, "project_root"),
    node("thread_a_root", threadAScope, "work_thread_root"),
    node("thread_b_root", threadBScope, "work_thread_root"),
    node("project_a_idea", projectAScope),
    node("project_b_idea", projectBScope),
  ],
  edges: [{
    edgeId: "a_to_b_explicit_cross_scope",
    fromNodeId: "project_a_idea",
    toNodeId: "project_b_idea",
    relationKind: "relevant_to",
    epistemicStatus: "accepted",
    lifecycle: "active",
    sourceRefs: sourceRefs("a_to_b_explicit_cross_scope"),
  }],
  scopedRevisionRefs: [
    buildScopedWorldmodelRevisionRef({ scopeKind: "user_world", revision: 1 }),
    buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_a", revision: 1 }),
    buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_b", revision: 1 }),
    buildScopedWorldmodelRevisionRef({ scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a", revision: 1 }),
    buildScopedWorldmodelRevisionRef({ scopeKind: "work_thread", projectId: "project_b", workThreadId: "thread_b", revision: 1 }),
  ],
  materializedAt: "2026-07-15T09:00:00.000Z",
});
validateHierarchicalWorldmodelGraph(graph);
validateLegacyNonWave26WorldmodelGraphReplay(graph);
assert(graph.projectRootRefs.length === 2, "fixture must contain two ProjectWorld roots");
assert(graph.nodes.filter((entry) => entry.nodeKind === "work_thread_root").length === 2, "fixture must contain two WorkThreads");
assert(graph.nodes.find((entry) => entry.nodeId === "project_a_idea").scope.projectId === "project_a", "node home scope must be explicit");
assert(graph.edges[0].fromNodeId === "project_a_idea" && graph.edges[0].toNodeId === "project_b_idea", "cross-scope relation must remain an explicit edge");

const projectARevisionBeforeB = graph.scopedRevisionRefs.find((ref) => ref.projectId === "project_a" && ref.scopeKind === "project");
const projectBRevision = graph.scopedRevisionRefs.find((ref) => ref.projectId === "project_b" && ref.scopeKind === "project");
const projectBIdeaBefore = graph.nodes.find((entry) => entry.nodeId === "project_b_idea");
let result = append(graph, {
  transitionId: "project_b_update",
  deltaCandidateId: "candidate_project_b_update",
  actorAgentId: "project_manager_b",
  actorRole: "project_manager",
  idempotencyKey: "project-b-update-1",
  authorityTraceRef: sourceRefs("authority_project_b")[0],
  sourceRefs: sourceRefs("project_b_update"),
  // Project A is a read/dependency witness only; Project B is the sole write scope.
  expectedScopeRevisions: [projectARevisionBeforeB, projectBRevision],
  mutations: [{ mutationKind: "revise_node", targetId: "project_b_idea", node: { semanticSummary: "Project B changed independently", sourceRefs: sourceRefs("project_b_update") } }],
  createdAt: "2026-07-15T09:01:00.000Z",
});
assert(result.committed, "Project B write should commit");
graph = result.graph;
const projectARevisionAfterB = graph.scopedRevisionRefs.find((ref) => ref.projectId === "project_a" && ref.scopeKind === "project");
assert(projectARevisionAfterB.revision === projectARevisionBeforeB.revision && projectARevisionAfterB.digest === projectARevisionBeforeB.digest, "Project B update must not stale Project A revision");
assert(result.transition.resultingScopeRevisions.length === 1 && result.transition.resultingScopeRevisions[0].projectId === "project_b", "only actually touched Project B scope may advance");
const projectBReceipt = result.transition.mutations.find((mutation) => mutation.targetId === "project_b_idea");
const projectBIdeaAfter = graph.nodes.find((entry) => entry.nodeId === "project_b_idea");
assert(projectBReceipt.beforeDigest === projectBIdeaBefore.digest, "receipt beforeDigest must equal actual stored prior node");
assert(projectBReceipt.afterDigest === projectBIdeaAfter.digest, "receipt afterDigest must equal actual materialized node");

result = append(graph, {
  transitionId: "stale_project_a_write",
  deltaCandidateId: "candidate_stale_project_a",
  actorAgentId: "project_manager_a",
  actorRole: "project_manager",
  idempotencyKey: "stale-project-a-0",
  authorityTraceRef: sourceRefs("authority_project_a")[0],
  sourceRefs: sourceRefs("stale_project_a"),
  expectedScopeRevisions: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_a", revision: 0 })],
  mutations: [{ mutationKind: "revise_node", targetId: "project_a_idea", node: { semanticSummary: "This stale update must not apply", sourceRefs: sourceRefs("stale_project_a") } }],
  createdAt: "2026-07-15T09:02:00.000Z",
});
assert(!result.committed && result.remand?.code === "direct_hierarchical_graph_stale_scope_revision", "stale CAS write must remand");
graph = result.graph;

result = append(graph, {
  transitionId: "inactive_history",
  deltaCandidateId: "candidate_inactive_history",
  actorAgentId: "project_manager_a",
  actorRole: "project_manager",
  idempotencyKey: "inactive-history-1",
  authorityTraceRef: sourceRefs("authority_project_a_history")[0],
  sourceRefs: sourceRefs("inactive_history"),
  expectedScopeRevisions: [projectARevisionAfterB],
  mutations: [
    { mutationKind: "set_node_lifecycle", targetId: "project_a_idea", lifecycle: "superseded", node: { projectionEligibility: "history_only", sourceRefs: sourceRefs("superseded_a") } },
  ],
  createdAt: "2026-07-15T09:03:00.000Z",
});
assert(result.committed, "current Project A CAS write should commit");
graph = result.graph;
result = append(graph, {
  transitionId: "rejected_history",
  deltaCandidateId: "candidate_rejected_history",
  actorAgentId: "project_manager_a",
  actorRole: "project_manager",
  idempotencyKey: "rejected-history-1",
  authorityTraceRef: sourceRefs("authority_project_a_rejected")[0],
  sourceRefs: sourceRefs("rejected_history"),
  expectedScopeRevisions: [graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project" && ref.projectId === "project_a")],
  mutations: [{ mutationKind: "add_node", targetId: "project_a_rejected", node: node("project_a_rejected", projectAScope, "idea", "rejected") }],
  createdAt: "2026-07-15T09:04:00.000Z",
});
assert(result.committed, "rejected history node should commit");
graph = result.graph;
validateHierarchicalWorldmodelGraph(graph);
validateLegacyNonWave26WorldmodelGraphReplay(graph);
assert(graph.nodeHistoryRefs.some((ref) => ref.id === "project_a_idea" && ref.lifecycle === "superseded"), "superseded node must remain in history");
assert(graph.nodeHistoryRefs.some((ref) => ref.id === "project_a_rejected" && ref.lifecycle === "rejected"), "rejected node must remain in history");
assert(!graph.materializedView.activeNodeRefs.some((ref) => ref.id === "project_a_idea" || ref.id === "project_a_rejected"), "rejected and superseded nodes must be inactive in materialized view");

const currentA = graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project" && ref.projectId === "project_a");
const adversarialWrite = { transitionId: "adversarial_write", deltaCandidateId: "adversarial_candidate", actorAgentId: "project_manager_a", actorRole: "project_manager", idempotencyKey: "adversarial-write", authorityTraceRef: sourceRefs("adversarial_authority")[0], sourceRefs: sourceRefs("adversarial_write"), expectedScopeRevisions: [currentA], mutations: [{ mutationKind: "add_node", targetId: "authorized_add", node: node("authorized_add", projectAScope) }], createdAt: "2026-07-15T09:05:00.000Z" };
const authorize = (input) => buildGraphWriteAuthorizationForTransition(graph, input);
assert(appendWorldmodelGraphTransition(graph, { ...adversarialWrite, actorRole: "thread_manager", writeAuthorization: authorize(adversarialWrite) }).remand.code === "direct_hierarchical_graph_trust_anchor_required", "Wave 26 append must fail closed before any unanchored authority claim");
const foreignThreadWrite = { ...adversarialWrite, transitionId: "foreign_thread", deltaCandidateId: "foreign_thread", actorAgentId: "thread_manager_b", actorRole: "thread_manager", idempotencyKey: "foreign-thread", mutations: [{ mutationKind: "add_node", targetId: "foreign_thread_node", node: node("foreign_thread_node", projectBScope) }] };
assert(appendWorldmodelGraphTransition(graph, { ...foreignThreadWrite, writeAuthorization: authorize(foreignThreadWrite) }).remand.code === "direct_hierarchical_graph_trust_anchor_required", "unanchored foreign writes cannot enter the active API");
const expiredWrite = { ...adversarialWrite, transitionId: "expired", deltaCandidateId: "expired", idempotencyKey: "expired", createdAt: "2019-01-01T00:00:00.000Z", authorizationExpiresAt: "2020-01-01T00:00:00.000Z" };
assert(append(graph, expiredWrite).remand.code === "direct_hierarchical_graph_write_authorization_expired", "expired authorization remands after contextual admission");
const authorizedCommit = append(graph, adversarialWrite);
assert(authorizedCommit.committed, "authorized write commits");
graph = authorizedCommit.graph;
assert(append(graph, adversarialWrite).committed === false, "identical add cannot commit twice");
expectThrows(() => buildHierarchicalWorldmodelGraph({ graphId: "foreign_user", userProfileId: "user_a", rootNodeId: "root", nodes: [node("root", { ...userScope, userProfileId: "user_b" }, "world_root")] }), "direct_hierarchical_graph_foreign_node");

const badLedgerHead = clone(graph);
badLedgerHead.transitionLedgerHeadRef.sourceId = "tampered_transition";
badLedgerHead.digest = graphDigestFor("direct-hierarchical-worldmodel-graph@1", badLedgerHead);
expectThrows(() => validateLegacyNonWave26WorldmodelGraphReplay(badLedgerHead), "direct_hierarchical_graph_ledger_head_mismatch");

// C-01/N-01 and H-03/N-04: portable fixtures can be built freely, but an
// active graph is anchored at creation to a durable harness store.  A request
// cannot mint a registry/admission, rewrite the actor, or replace genesis and
// history while keeping that store's head.
const trustDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-graph-trust-"));
const trustStore = createWorldmodelTrustStore(trustDir, { storeId: "graph_trust_root", now: Date.parse("2026-07-15T10:00:00.000Z") });
assert(Object.isFrozen(trustStore) && Object.keys(trustStore).length === 0, "trust-store handles expose neither mutable state nor caller-settable authority identity");
const recreatedTrustDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-graph-trust-recreated-"));
const recreatedTrustStore = createWorldmodelTrustStore(recreatedTrustDir, { storeId: "graph_trust_root", now: Date.parse("2026-07-15T10:00:00.000Z") });
const trustedGraph = clone(graph);
trustedGraph.trustAnchorRef = buildWorldmodelTrustAnchor(trustStore, trustedGraph.graphId);
trustedGraph.digest = graphDigestFor("direct-hierarchical-worldmodel-graph@1", trustedGraph);
assert(buildWorldmodelTrustAnchor(recreatedTrustStore, trustedGraph.graphId).anchorDigest !== trustedGraph.trustAnchorRef.anchorDigest, "C-01/H-03 same public store metadata must generate a distinct authority anchor");
const rootRegistry = buildGovernanceProvenanceRegistry({ registryId: "harness_owned_empty_root", userProfileId: trustedGraph.userProfileId, records: [] });
initializeAuthoritativeWorldmodelGraph(trustStore, trustedGraph, rootRegistry);
expectThrows(() => initializeAuthoritativeWorldmodelGraph(recreatedTrustStore, trustedGraph, rootRegistry), "direct_worldmodel_trust_store_graph_anchor_mismatch");
expectThrows(() => validateLegacyNonWave26WorldmodelGraphReplay(trustedGraph), "direct_hierarchical_graph_legacy_anchor_forbidden");
const attackerAttempt = appendWorldmodelGraphTransition(trustedGraph, { transitionId: "c01_attacker_self_minted", deltaCandidateId: "c01_attacker_candidate", actorAgentId: "attacker_unregistered_pm", actorRole: "project_manager", idempotencyKey: "c01-attacker", authorityTraceRef: sourceRefs("c01_authority")[0], sourceRefs: sourceRefs("c01_attacker"), expectedScopeRevisions: [trustedGraph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project" && ref.projectId === "project_a")], mutations: [{ mutationKind: "add_node", targetId: "c01_attacker_node", node: node("c01_attacker_node", projectAScope) }], createdAt: "2026-07-15T10:01:00.000Z" });
assert(attackerAttempt.committed === false, "C-01 attacker cannot convert a self-minted registry into a store admission");
assert(attackerAttempt.remand.code === "direct_hierarchical_graph_store_admission_required", "C-01 attacker must be stopped before request governance is considered");
assert(appendWorldmodelGraphTransition(graph, { transitionId: "unanchored_self_mint", mutations: [{ mutationKind: "add_node", targetId: "unanchored_self_mint", node: node("unanchored_self_mint", projectAScope) }] }).remand.code === "direct_hierarchical_graph_trust_anchor_required", "current Wave 26 append cannot self-mint an unanchored graph");
const actorRewrite = clone(trustedGraph); actorRewrite.transitions.at(-1).actorAgentId = "forged_actor"; actorRewrite.transitions.at(-1).digest = graphDigestFor("direct-worldmodel-graph-transition@2", actorRewrite.transitions.at(-1)); actorRewrite.digest = graphDigestFor("direct-hierarchical-worldmodel-graph@1", actorRewrite);
expectThrows(() => readAuthoritativeWorldmodelGraph(trustStore, actorRewrite), "direct_worldmodel_trust_store_stale_or_swapped_graph");
expectThrows(() => validateWorldmodelGraphReplay(actorRewrite, { trustStore }), "direct_worldmodel_trust_store_stale_or_swapped_graph");
const erasedHistory = clone(trustedGraph); erasedHistory.genesis = { nodes: clone(erasedHistory.nodes), edges: clone(erasedHistory.edges), scopedRevisionRefs: clone(erasedHistory.scopedRevisionRefs) }; erasedHistory.transitions = []; erasedHistory.nodeVersionBodies = clone(erasedHistory.nodes); erasedHistory.edgeVersionBodies = clone(erasedHistory.edges); erasedHistory.nodeHistoryRefs = erasedHistory.nodes.map((entry) => ({ kind: "worldmodel_semantic_node", id: entry.nodeId, digest: entry.digest, lifecycle: entry.lifecycle })); erasedHistory.edgeHistoryRefs = erasedHistory.edges.map((entry) => ({ kind: "worldmodel_semantic_edge", id: entry.edgeId, digest: entry.digest, lifecycle: entry.lifecycle })); erasedHistory.transitionLedgerHeadRef.sourceId = erasedHistory.graphId; erasedHistory.digest = graphDigestFor("direct-hierarchical-worldmodel-graph@1", erasedHistory);
expectThrows(() => readAuthoritativeWorldmodelGraph(trustStore, erasedHistory), "direct_worldmodel_trust_store_stale_or_swapped_graph");
expectThrows(() => validateWorldmodelGraphReplay(erasedHistory, { trustStore }), "direct_worldmodel_trust_store_stale_or_swapped_graph");
assert(readAuthoritativeWorldmodelGraph(openWorldmodelTrustStore(trustDir), trustedGraph).graph.digest === trustedGraph.digest, "durable store must reload the anchored graph after restart");
const resolverBeforeCopiedStoreAttempt = resolveAuthoritativeWorldmodelTrustStore(trustedGraph);
const copiedTrustDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-graph-trust-copy-"));
fs.rmSync(copiedTrustDir, { recursive: true, force: true });
fs.cpSync(trustDir, copiedTrustDir, { recursive: true });
expectThrows(() => openWorldmodelTrustStore(copiedTrustDir), "direct_worldmodel_trust_store_authority_location_mismatch");
assert(resolveAuthoritativeWorldmodelTrustStore(trustedGraph) === resolverBeforeCopiedStoreAttempt, "C-01 copied store open cannot replace the registered authoritative resolver");
assert(readAuthoritativeWorldmodelGraph(trustStore, trustedGraph).graph.digest === trustedGraph.digest, "C-01 copied store attempt leaves original authority usable");
const currentPointer = fs.readFileSync(path.join(trustDir, "trust-store.json"), "utf8");
fs.writeFileSync(path.join(trustDir, "trust-store.json"), JSON.stringify({ revision: 0, digest: "sha256:rollback" }));
expectThrows(() => openWorldmodelTrustStore(trustDir), "direct_worldmodel_trust_store_rollback_detected");
fs.writeFileSync(path.join(trustDir, "trust-store.json"), currentPointer);
const preAdvancePointer = fs.readFileSync(path.join(trustDir, "trust-store.json"), "utf8");
const preAdvanceState = JSON.parse(preAdvancePointer);
installAuthoritativeWorldmodelGovernanceRegistry(trustStore, trustedGraph, rootRegistry);
const advancedPointer = JSON.parse(fs.readFileSync(path.join(trustDir, "trust-store.json"), "utf8"));
assert(advancedPointer.revision > preAdvanceState.revision, "C-03 fixture must advance the authoritative head before rollback");
fs.rmSync(path.join(trustDir, "revisions", `${String(advancedPointer.revision).padStart(12, "0")}.json`));
fs.writeFileSync(path.join(trustDir, "trust-store.json"), preAdvancePointer);
expectThrows(() => openWorldmodelTrustStore(trustDir), "direct_worldmodel_trust_store_rollback_detected");
fs.rmSync(trustDir, { recursive: true, force: true });
fs.rmSync(recreatedTrustDir, { recursive: true, force: true });
fs.rmSync(copiedTrustDir, { recursive: true, force: true });

console.log("direct-hierarchical-worldmodel-graph-regression: ok");
