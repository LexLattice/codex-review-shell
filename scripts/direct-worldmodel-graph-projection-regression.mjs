#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  admitWorldmodelGraphProjectionAgainstContext,
  buildHierarchicalWorldmodelGraph,
  buildProjectManagerProfile,
  buildWorldmodelGraphProjection,
  buildWorldmodelHistoryAuditProjection,
  buildWorldmodelProjectionPolicy,
  buildGovernanceProvenanceRegistry,
  registryRef,
  createWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  validateWorldmodelGraphProjection,
  validateWorldmodelGraphProjectionShape,
  validateWorldmodelHistoryAuditProjection,
  validateWorldmodelProjectionPolicy,
  validateWorldmodelProjectionPolicyShape,
} = require("../src/main/direct/worldmodel");
const { canonicalJson, sha256 } = require("../src/main/direct/meta-session/digest");

const now = "2026-07-15T00:00:00.000Z";
const exact = (kind, id) => ({ kind, id, digest: sha256(`${kind}:${id}`) });
const source = (id) => [{ sourceRefId: `source_${id}`, sourceKind: "fixture", sourceId: id, sourceConfidence: "exact", freshness: "fresh", observedAt: now }];
const expectThrows = (fn, code) => assert.throws(fn, (error) => error?.code === code, code);
const scopeA = { scopeKind: "project", projectId: "project_a", semanticPath: ["projects", "a"] };
const scopeB = { scopeKind: "project", projectId: "project_b", semanticPath: ["projects", "b"] };
const threadA = { scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a", semanticPath: ["projects", "a", "threads", "a"] };
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-projection-trust-"));
const trustStore = createWorldmodelTrustStore(storeDir, { storeId: "projection_trust_root", now: Date.parse(now) });
const recreatedStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-projection-trust-recreated-"));
const recreatedTrustStore = createWorldmodelTrustStore(recreatedStoreDir, { storeId: "projection_trust_root", now: Date.parse(now) });
function node(nodeId, scope, nodeKind = "idea", overrides = {}) {
  return { nodeId, scope, nodeKind, abstractionLevel: nodeKind.endsWith("root") ? "strategic" : "conceptual", semanticSummary: nodeId, odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "informational", custodianRole: scope.scopeKind === "user_world" ? "world_manager" : scope.scopeKind === "work_thread" ? "thread_manager" : "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: source(nodeId), ...overrides };
}
const graph = buildHierarchicalWorldmodelGraph({
  graphId: "policy_projection_graph", userProfileId: "user_fixture", rootNodeId: "world_root",
  trustAnchorRef: buildWorldmodelTrustAnchor(trustStore, "policy_projection_graph"),
  scopedRevisionRefs: [{ scopeKind: "user_world", revision: 2 }, { scopeKind: "project", projectId: "project_a", revision: 5 }, { scopeKind: "project", projectId: "project_b", revision: 3 }, { scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a", revision: 4 }],
  nodes: [
    node("world_root", { scopeKind: "user_world", semanticPath: ["user"] }, "world_root"),
    node("global_constraint", { scopeKind: "user_world", semanticPath: ["constraints"] }, "constraint", { normativeForce: "binding_constraint" }),
    node("private_preference", { scopeKind: "user_world", semanticPath: ["private"] }, "preference", { structuredValue: { sensitivity: "user_private" } }),
    node("project_a_root", scopeA, "project_root"), node("project_a_goal", { ...scopeA, semanticPath: [...scopeA.semanticPath, "goal"] }, "goal"),
    node("project_a_archived", { ...scopeA, semanticPath: [...scopeA.semanticPath, "history"] }, "idea", { lifecycle: "archived", projectionEligibility: "history_only" }),
    node("project_a_private", { ...scopeA, semanticPath: [...scopeA.semanticPath, "private"] }, "decision", { structuredValue: { classification: "private" } }),
    node("thread_a_root", threadA, "work_thread_root"), node("thread_a_task", { ...threadA, semanticPath: [...threadA.semanticPath, "task"] }, "procedure"),
    node("project_b_root", scopeB, "project_root"), node("project_b_secret", { ...scopeB, semanticPath: [...scopeB.semanticPath, "secret"] }, "decision"),
  ],
  edges: [
    { edgeId: "a_goal", fromNodeId: "project_a_root", toNodeId: "project_a_goal", relationKind: "supports", lifecycle: "active", sourceRefs: source("a_goal") },
    { edgeId: "a_archived", fromNodeId: "project_a_root", toNodeId: "project_a_archived", relationKind: "relevant_to", lifecycle: "active", sourceRefs: source("a_archived") },
    { edgeId: "a_private", fromNodeId: "project_a_root", toNodeId: "project_a_private", relationKind: "relevant_to", lifecycle: "active", sourceRefs: source("a_private") },
    { edgeId: "a_thread", fromNodeId: "project_a_root", toNodeId: "thread_a_root", relationKind: "relevant_to", lifecycle: "active", sourceRefs: source("a_thread") },
    { edgeId: "thread_task", fromNodeId: "thread_a_root", toNodeId: "thread_a_task", relationKind: "implements", lifecycle: "active", sourceRefs: source("thread_task") },
    { edgeId: "b_secret", fromNodeId: "project_b_root", toNodeId: "project_b_secret", relationKind: "supports", lifecycle: "active", sourceRefs: source("b_secret") },
  ], materializedAt: now,
}, { now });
assert.notEqual(buildWorldmodelTrustAnchor(recreatedTrustStore, graph.graphId).anchorDigest, graph.trustAnchorRef.anchorDigest, "C-03 recreated public store metadata cannot reproduce the canonical policy authority anchor");

const authority = exact("authority_boundary", "project_a_authority");
const policyId = "project_a_projection_policy";
const manager = buildProjectManagerProfile({ projectManagerProfileId: "pm_a", projectManagerAgentId: "pm_a_agent", worldManagerAgentId: "wm_agent", projectId: "project_a", projectRootNodeId: "project_a_root", authorityBoundaryRef: authority, graphProjectionPolicyRef: { ...exact("graph_projection_policy", policyId), id: policyId } }, { now: () => Date.parse(now) });
const currentPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef: authority, policyId, purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: "project_a" }], trustedSeedNodeRefs: [exact("worldmodel_semantic_node", "placeholder")].map(() => { const value = graph.nodes.find((entry) => entry.nodeId === "project_a_root"); return { kind: "worldmodel_semantic_node", id: value.nodeId, digest: value.digest }; }), custodyDenyList: [], sensitivityDenyList: ["private", "user_private"], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 20, maxEdges: 20, maxSummaryChars: 2000 }, workerAllowedProjectNodeRefs: [] });
validateWorldmodelProjectionPolicy(currentPolicy, { graph, managerProfile: manager, authoritySourceRef: authority });
assert.deepEqual(validateWorldmodelProjectionPolicyShape(currentPolicy), { shapeValid: true, currentContextAdmissible: false, reason: "context_admission_required" });

const projection = buildWorldmodelGraphProjection({ graph, policyArtifact: currentPolicy, managerProfile: manager, authoritySourceRef: authority, projectionId: "project_a_current", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_a" } });
validateWorldmodelGraphProjection(projection);
assert.equal(validateWorldmodelGraphProjectionShape(projection).currentContextAdmissible, false, "portable shape validation is explicitly non-admissible");
const projectionAuthority = { authorityDecisionId: "projection_authority", digest: sha256("projection_authority") };
const projectionBinding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: "project_a", projectRootNodeId: "project_a_root", role: "project_manager", agentId: "pm_a_agent", purpose: "current_context" };
const projectionRegistry = buildGovernanceProvenanceRegistry({ registryId: "projection_registry", userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: manager, binding: projectionBinding }, { kind: "projection_policy", body: currentPolicy, binding: projectionBinding }, { kind: "authority_decision", body: projectionAuthority, binding: projectionBinding, oneShot: true }] });
initializeAuthoritativeWorldmodelGraph(trustStore, graph, projectionRegistry);
expectThrows(() => initializeAuthoritativeWorldmodelGraph(recreatedTrustStore, graph, projectionRegistry), "direct_worldmodel_trust_store_graph_anchor_mismatch");
const projectionRequiredArtifacts = [{ kind: "project_manager_profile", id: manager.projectManagerProfileId, digest: manager.profileDigest }, { kind: "projection_policy", id: currentPolicy.policyId, digest: currentPolicy.policyDigest }, { kind: "authority_decision", id: projectionAuthority.authorityDecisionId, digest: projectionAuthority.digest, oneShot: true }];
const storeAdmission = admitWorldmodelGovernanceRequest(trustStore, { admissionId: "projection_store_admission", graph, context: { registryRef: registryRef(projectionRegistry), expectedRegistryRevision: projectionRegistry.revision, ...projectionBinding, requiredArtifacts: projectionRequiredArtifacts } });
const projectionContext = { graph, policy: currentPolicy, managerProfile: manager, authoritySourceRef: authority, authorityDecision: projectionAuthority, governanceRegistry: projectionRegistry, registryRef: registryRef(projectionRegistry), expectedRegistryRevision: projectionRegistry.revision, projectRootNodeId: "project_a_root", trustStore, storeAdmission };
const receipt = admitWorldmodelGraphProjectionAgainstContext(projection, projectionContext);
assert.equal(receipt.admitted, true); assert.equal(projection.graphRef.digest, graph.digest); assert.equal(projection.policyRef.digest, currentPolicy.policyDigest);
assert(projection.selectedNodeRefs.some((ref) => ref.id === "project_a_goal"));
assert(!projection.selectedNodeRefs.some((ref) => ["project_a_archived", "project_a_private", "private_preference", "project_b_secret"].includes(ref.id)), "current context excludes history/private/foreign nodes");

for (const [field, value] of [["auditMode", true], ["seedNodeIds", ["project_b_secret"]], ["workerProjectNodeIds", ["project_b_secret"]], ["custodyDenyList", []], ["maxTraversalDepth", 99]]) {
  expectThrows(() => buildWorldmodelGraphProjection({ graph, policyArtifact: currentPolicy, managerProfile: manager, authoritySourceRef: authority, entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_a" }, [field]: value }), "direct_worldmodel_graph_projection_ambient_policy_forbidden");
}

const workerPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef: authority, policyId, audienceRole: "worker", audienceAgentId: "worker_a", purpose: "current_context", allowedEntryPaths: ["worker_boot"], allowedFocalScopes: [{ scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "thread_a_root", digest: graph.nodes.find((entry) => entry.nodeId === "thread_a_root").digest }], custodyDenyList: [], sensitivityDenyList: ["private", "user_private"], maxTraversalDepth: 1, semanticBudget: { maxNodes: 8, maxEdges: 8, maxSummaryChars: 500 }, workerAllowedProjectNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_a_root", digest: graph.nodes.find((entry) => entry.nodeId === "project_a_root").digest }] });
const worker = buildWorldmodelGraphProjection({ graph, policyArtifact: workerPolicy, managerProfile: manager, authoritySourceRef: authority, entryPath: "worker_boot", focalScope: { scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a" } });
assert(!worker.selectedNodeRefs.some((ref) => ref.id === "project_b_secret"));
expectThrows(() => buildWorldmodelGraphProjection({ graph, policyArtifact: workerPolicy, managerProfile: manager, authoritySourceRef: authority, entryPath: "worker_boot", focalScope: { scopeKind: "work_thread", projectId: "project_a", workThreadId: "thread_a" }, workerAllowedProjectNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_b_secret", digest: graph.nodes.find((entry) => entry.nodeId === "project_b_secret").digest }] }), "direct_worldmodel_graph_projection_ambient_policy_forbidden");

const forged = structuredClone(projection); forged.selectedNodeRefs.push({ kind: "worldmodel_semantic_node", id: "foreign_unbound_secret", digest: sha256("foreign") }); forged.selectedNodeRefs.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
const stableProjection = (value) => Object.keys(value).sort().reduce((out, key) => { if (key !== "projectionDigest") out[key] = value[key] && typeof value[key] === "object" ? JSON.parse(canonicalJson(value[key], { omitDigestFields: false })) : value[key]; return out; }, {});
const resignProjection = (value) => { value.projectionDigest = sha256(`direct-worldmodel-graph-projection@1\0${canonicalJson(stableProjection(value), { omitDigestFields: false })}`); return value; };
resignProjection(forged);
validateWorldmodelGraphProjection(forged); expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(forged, projectionContext), "direct_worldmodel_graph_projection_context_revalidation_failed");
for (const forbiddenId of ["project_b_secret", "project_a_private", "private_preference"]) {
  const leaked = structuredClone(projection); const forbiddenNode = graph.nodes.find((entry) => entry.nodeId === forbiddenId); leaked.selectedNodeRefs.push({ kind: "worldmodel_semantic_node", id: forbiddenNode.nodeId, digest: forbiddenNode.digest }); leaked.selectedNodeRefs.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)); resignProjection(leaked);
  expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(leaked, projectionContext), "direct_worldmodel_graph_projection_context_revalidation_failed");
}
const graphSwap = structuredClone(projection); graphSwap.graphRef.digest = sha256("other_graph"); resignProjection(graphSwap); expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(graphSwap, projectionContext), "direct_worldmodel_graph_projection_context_mismatch");
const policySwap = structuredClone(projection); policySwap.policyRef.digest = sha256("other_policy"); resignProjection(policySwap); expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(policySwap, projectionContext), "direct_worldmodel_graph_projection_context_mismatch");
const substitutedPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef: authority, policyId, purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: "project_a" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_a_root", digest: graph.nodes.find((entry) => entry.nodeId === "project_a_root").digest }], custodyDenyList: [], sensitivityDenyList: ["private", "user_private"], maxTraversalDepth: 0, semanticBudget: { maxNodes: 1, maxEdges: 0, maxSummaryChars: 100 }, workerAllowedProjectNodeRefs: [] });
expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(projection, { ...projectionContext, policy: substitutedPolicy }), "direct_worldmodel_graph_projection_store_policy_substitution");
const attackerRegistry = buildGovernanceProvenanceRegistry({ registryId: "attacker_same_id_registry", userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: manager, binding: projectionBinding }, { kind: "projection_policy", body: substitutedPolicy, binding: projectionBinding }, { kind: "authority_decision", body: projectionAuthority, binding: projectionBinding, oneShot: true }] });
const attackerProjection = buildWorldmodelGraphProjection({ graph, policyArtifact: substitutedPolicy, managerProfile: manager, authoritySourceRef: authority, projectionId: "attacker_same_id_projection", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_a" } });
expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(attackerProjection, { ...projectionContext, policy: substitutedPolicy, governanceRegistry: attackerRegistry, registryRef: registryRef(attackerRegistry), expectedRegistryRevision: attackerRegistry.revision }), "direct_worldmodel_graph_projection_context_mismatch");

const auditPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: manager, authoritySourceRef: authority, policyId, purpose: "audit_history", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: "project_a" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_a_root", digest: graph.nodes.find((entry) => entry.nodeId === "project_a_root").digest }], custodyDenyList: [], sensitivityDenyList: ["private", "user_private"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 20, maxEdges: 20, maxSummaryChars: 2000 }, workerAllowedProjectNodeRefs: [] });
const audit = buildWorldmodelHistoryAuditProjection({ graph, policyArtifact: auditPolicy, managerProfile: manager, authoritySourceRef: authority, projectionId: "project_a_audit", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_a" } }); validateWorldmodelHistoryAuditProjection(audit);
const archivedRef = audit.selectedNodeRefs.find((ref) => ref.id === "project_a_archived"); assert.equal(archivedRef.lifecycle, "archived"); assert.equal(archivedRef.projectionEligibility, "history_only"); assert.equal(audit.currentContextAdmissible, false); assert(!audit.selectedNodeRefs.some((ref) => ref.id === "project_a_private" || ref.id === "project_b_secret"));
expectThrows(() => admitWorldmodelGraphProjectionAgainstContext(audit, { ...projectionContext, policy: auditPolicy }), "direct_worldmodel_graph_projection_audit_not_current_context");

console.log("direct-worldmodel-graph-projection-regression: ok");
fs.rmSync(storeDir, { recursive: true, force: true });
fs.rmSync(recreatedStoreDir, { recursive: true, force: true });
