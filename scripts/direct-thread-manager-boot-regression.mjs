#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildAuthorityBoundary,
  buildLegacyWorkerBootPacket,
  buildHierarchicalWorldmodelGraph,
  buildGraphOdeuCompilation,
  buildProjectManagerProfile,
  buildScopedWorldmodelRevisionRef,
  buildWorldmodelGraphProjection,
  buildRevisionCompatibility,
  buildThreadManagerProfile,
  buildWorkThreadDelegationPacket,
  buildWorkerBootPacket,
  buildWorldmodelManagerProfile,
  buildWorldmodelProjectionPolicy,
  buildGovernanceProvenanceRegistry,
  createWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  registryRef,
  compareAuthorityBoundaries,
  validateAuthorityBoundaryComparisonWitness,
  validateThreadManagerProfile,
  validateWorkThreadDelegationPacket,
  validateWorkerBootPacket,
} = require("../src/main/direct/worldmodel");
const { sha256 } = require("../src/main/direct/meta-session/digest");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 3, 13, 30, 0);

const managerProfile = buildWorldmodelManagerProfile({
  scopeKind: "work_thread",
  userProfileId: "user_profile_fixture",
  projectId: "project_fixture",
  workThreadId: "work_thread_boot_fixture",
  managerAgentId: "agent_worldmodel_manager_fixture",
}, { now });

const threadManagerProfile = buildThreadManagerProfile({
  managerProfile,
  threadManagerProfileId: "thread_manager_profile_fixture",
  threadManagerAgentId: "agent_thread_manager_fixture",
  workThreadId: "work_thread_boot_fixture",
}, { now });
validateThreadManagerProfile(threadManagerProfile);
assert.equal(threadManagerProfile.roleKind, "thread_manager");
assert.equal(threadManagerProfile.canReceiveDelegation, true);
assert.equal(threadManagerProfile.canBuildWorkerBootPackets, true);
assert.equal(threadManagerProfile.canExecuteWorkerTasks, false);

const threadManagerProfileFromRef = buildThreadManagerProfile({
  managerProfileRef: {
    kind: "worldmodel_manager_profile",
    id: managerProfile.managerProfileId,
    digest: managerProfile.profileDigest,
    label: "Stored manager profile ref",
  },
  threadManagerProfileId: "thread_manager_profile_from_ref_fixture",
  threadManagerAgentId: "agent_thread_manager_from_ref_fixture",
  workThreadId: "work_thread_boot_fixture",
}, { now });
validateThreadManagerProfile(threadManagerProfileFromRef);
assert.equal(threadManagerProfileFromRef.managerProfileRef.id, managerProfile.managerProfileId);
assert.equal(threadManagerProfileFromRef.managerProfileRef.digest, managerProfile.profileDigest);

const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 3,
  subjectAgentId: "agent_worker_subject_fixture",
});

const graphAuthority = { kind: "authority_boundary", id: "thread_boot_graph_authority", digest: "sha256:thread_boot_graph_authority" };
const graphStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-thread-boot-trust-"));
const graphTrustStore = createWorldmodelTrustStore(graphStoreDir, { storeId: "thread_boot_trust", now: now() });
const graph = buildHierarchicalWorldmodelGraph({ graphId: "thread_boot_graph", userProfileId: "user_profile_fixture", rootNodeId: "graph_world_root", trustAnchorRef: buildWorldmodelTrustAnchor(graphTrustStore, "thread_boot_graph"), scopedRevisionRefs: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_fixture", revision: 1 })], nodes: [
  { nodeId: "graph_world_root", scope: { scopeKind: "user_world", userProfileId: "user_profile_fixture", semanticPath: ["world"] }, nodeKind: "world_root", abstractionLevel: "world", semanticSummary: "Graph world root", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"], projectionEligibility: "eligible", sourceRefs: [] },
  { nodeId: "graph_project_root", scope: { scopeKind: "project", userProfileId: "user_profile_fixture", projectId: "project_fixture", semanticPath: ["project"] }, nodeKind: "project_root", abstractionLevel: "strategic", semanticSummary: "Graph project root", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: [] },
], edges: [] }, { now });
const graphPmProfile = buildProjectManagerProfile({ projectManagerProfileId: "thread_boot_pm", projectManagerAgentId: "thread_boot_pm_agent", worldManagerAgentId: "agent_worldmodel_manager_fixture", projectId: "project_fixture", projectRootNodeId: "graph_project_root", authorityBoundaryRef: graphAuthority, graphProjectionPolicyRef: { kind: "graph_projection_policy", id: "thread_boot_policy", digest: "sha256:thread_boot_policy" } }, { now });
const graphPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: graphPmProfile, authoritySourceRef: graphAuthority, policyId: "thread_boot_policy", purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: "project_fixture" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "graph_project_root", digest: graph.nodes.find((node) => node.nodeId === "graph_project_root").digest }], custodyDenyList: [], sensitivityDenyList: [], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 2, semanticBudget: { maxNodes: 8, maxEdges: 8, maxSummaryChars: 1000 }, workerAllowedProjectNodeRefs: [] });
const graphProjection = buildWorldmodelGraphProjection({ graph, managerProfile: graphPmProfile, authoritySourceRef: graphAuthority, policyArtifact: graphPolicy, projectionId: "thread_boot_projection", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_fixture" } });
const graphProjectionAuthority = { authorityDecisionId: "thread_boot_projection_authority", digest: sha256("thread_boot_projection_authority") };
const graphProjectionBinding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: "project_fixture", projectRootNodeId: "graph_project_root", role: "project_manager", agentId: "thread_boot_pm_agent", purpose: "current_context" };
const graphProjectionRegistry = buildGovernanceProvenanceRegistry({ registryId: "thread_boot_projection_registry", userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: graphPmProfile, binding: graphProjectionBinding }, { kind: "projection_policy", body: graphPolicy, binding: graphProjectionBinding }, { kind: "authority_decision", body: graphProjectionAuthority, binding: graphProjectionBinding, oneShot: true }] });
initializeAuthoritativeWorldmodelGraph(graphTrustStore, graph, graphProjectionRegistry);
const graphStoreAdmission = admitWorldmodelGovernanceRequest(graphTrustStore, { admissionId: "thread_boot_projection_store_admission", graph, context: { registryRef: registryRef(graphProjectionRegistry), expectedRegistryRevision: graphProjectionRegistry.revision, ...graphProjectionBinding, requiredArtifacts: [{ kind: "project_manager_profile", id: graphPmProfile.projectManagerProfileId, digest: graphPmProfile.profileDigest }, { kind: "projection_policy", id: graphPolicy.policyId, digest: graphPolicy.policyDigest }, { kind: "authority_decision", id: graphProjectionAuthority.authorityDecisionId, digest: graphProjectionAuthority.digest, oneShot: true }] } });

const delegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  targetWorkThreadId: "work_thread_boot_fixture",
  objectiveSummary: "Implement a bounded worker task from the active worldmodel.",
  roleLane: "implementation_worker",
  requestedLaneKeys: ["task", "environment", "modelSelf"],
  requestedSectionKeys: ["O", "E", "D"],
  capabilityBundleRefs: [{
    kind: "capability_bundle",
    id: "capability_bundle_readonly_fixture",
    digest: "sha256:capability_bundle_fixture",
    label: "Readonly worker bundle",
  }],
  authorizationChannelRefs: [{
    kind: "authorization_channel",
    id: "authorization_channel_manager_fixture",
    digest: "sha256:authorization_channel_fixture",
    label: "Manager authorization route",
  }],
}, { now });
validateWorkThreadDelegationPacket(delegation);
assert.equal(delegation.status, "ready_for_thread_manager");
assert.equal(delegation.blockerCodes.length, 0);
assert.equal(delegation.worldmodelRef.id, worldmodel.worldmodelId);

const bootPacket = buildLegacyWorkerBootPacket({
  bootPacketId: "worker_boot_packet_fixture",
  delegationPacket: delegation,
  worldmodel,
  contextPackRef: {
    kind: "context_pack",
    id: "context_pack_shadow_fixture",
    digest: "sha256:context_pack_shadow_fixture",
    label: "Shadow context pack",
  },
}, { now });
validateWorkerBootPacket(bootPacket);
assert.equal(bootPacket.status, "ready_for_worker_boot");
assert.equal(bootPacket.targetWorkThreadId, "work_thread_boot_fixture");
assert.deepEqual(bootPacket.includedLaneKeys, ["task", "environment", "modelSelf"]);
assert.deepEqual(bootPacket.includedSectionKeys, ["O", "E", "D"]);
assert(bootPacket.roleLaneProjection.task.sections.O.summary.includes("task object world"));
assert(bootPacket.bootOmissions.some((omission) => omission.laneKey === "governance"));
assert(bootPacket.bootOmissions.some((omission) => omission.sectionKey === "U"));
assert.equal(bootPacket.shadowContextPackIntegration.mode, "shadow_only");
assert.equal(bootPacket.shadowContextPackIntegration.providerInjectionEnabled, false);
assert.equal(bootPacket.projectionWitness.bootPacketId, "worker_boot_packet_fixture");
assert.equal(bootPacket.projectionWitness.rawTextIncluded, false);
assert.equal(bootPacket.rawPromptIncluded, false);
assert.equal(bootPacket.rawTextIncluded, false);
assert.equal(bootPacket.rawPathIncluded, false);
assert.equal(bootPacket.rawSecretIncluded, false);

const graphCompilation = buildGraphOdeuCompilation({ compilationId: "thread_boot_compilation", graph, graphProjection, profileSnapshot: graphPmProfile, policy: graphPolicy, authoritySourceRef: graphAuthority, authorityDecision: graphProjectionAuthority, governanceRegistry: graphProjectionRegistry, registryRef: registryRef(graphProjectionRegistry), expectedRegistryRevision: graphProjectionRegistry.revision, projectRootNodeId: "graph_project_root", trustStore: graphTrustStore, storeAdmission: graphStoreAdmission, compiledAt: "2026-07-03T13:30:00.000Z" });
const graphDelegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel: graphCompilation.activeInteractionWorldmodel,
  targetWorkThreadId: "work_thread_boot_fixture",
  objectiveSummary: "Implement a graph-derived worker task.",
  roleLane: "implementation_worker",
  requestedLaneKeys: ["task", "environment", "modelSelf"],
  requestedSectionKeys: ["O", "E", "D"],
}, { now });
const graphGuardedBootPacket = buildWorkerBootPacket({ delegationPacket: graphDelegation, worldmodel: graphCompilation.activeInteractionWorldmodel, graphContext: { compilation: graphCompilation } }, { now });
validateWorkerBootPacket(graphGuardedBootPacket);
assert.equal(graphGuardedBootPacket.graphOdeuCompilation.projectionRef.digest, graphProjection.projectionDigest, "Thread Manager transports only a context-admitted graph compilation");
expectThrows(() => buildWorkerBootPacket({ delegationPacket: graphDelegation, worldmodel: worldmodel, graphContext: { compilation: graphCompilation } }, { now }), "direct_thread_manager_worldmodel_mismatch");

const generatedIdBootPacket = buildLegacyWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel,
  contextPackRef: {
    kind: "context_pack",
    id: "context_pack_generated_id_fixture",
    digest: "sha256:context_pack_generated_id_fixture",
    label: "Generated-id shadow context pack",
  },
}, { now });
validateWorkerBootPacket(generatedIdBootPacket);
assert.equal(generatedIdBootPacket.shadowContextPackIntegration.bootPacketId, generatedIdBootPacket.bootPacketId);
assert.equal(generatedIdBootPacket.projectionWitness.bootPacketId, generatedIdBootPacket.bootPacketId);

const broadWorkerBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_broad_worker",
  workThreadId: "work_thread_boot_fixture",
  roleLane: "implementation_worker",
  allowedActionClasses: ["read_context", "summarize", "request_authorization", "apply_patch"],
  forbiddenActionClasses: ["run_command", "external_write", "account_mutation"],
});
const broadBootPacket = buildLegacyWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel,
  workerAuthorityBoundary: broadWorkerBoundary,
}, { now });
validateWorkerBootPacket(broadBootPacket);
assert.equal(broadBootPacket.status, "blocked");
assert(broadBootPacket.blockerCodes.includes("authority_boundary_broadened"));

const parentBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_parent_fixture",
  allowedActionClasses: ["read_context", "summarize", "request_authorization"],
  forbiddenActionClasses: ["apply_patch", "run_command"],
});
const narrowerBoundary = buildAuthorityBoundary({
  authorityBoundaryId: "authority_boundary_narrower_fixture",
  allowedActionClasses: ["read_context"],
  forbiddenActionClasses: ["apply_patch", "run_command", "external_write"],
});
const comparison = compareAuthorityBoundaries({ parentBoundary, childBoundary: narrowerBoundary });
validateAuthorityBoundaryComparisonWitness(comparison);
assert.equal(comparison.decision, "narrower");
assert.equal(comparison.blocksBoot, false);

const staleCompatibility = buildRevisionCompatibility({
  expectedWorldmodelId: worldmodel.worldmodelId,
  expectedRevision: 2,
  currentWorldmodel: worldmodel,
});
const staleDelegation = buildWorkThreadDelegationPacket({
  managerProfile,
  threadManagerProfile,
  worldmodel,
  revisionCompatibility: staleCompatibility,
  targetWorkThreadId: "work_thread_boot_fixture",
}, { now });
validateWorkThreadDelegationPacket(staleDelegation);
assert.equal(staleDelegation.status, "blocked");
assert(staleDelegation.blockerCodes.includes("worldmodel_revision_not_current"));

const staleBootPacket = buildLegacyWorkerBootPacket({
  delegationPacket: staleDelegation,
  worldmodel,
}, { now });
validateWorkerBootPacket(staleBootPacket);
assert.equal(staleBootPacket.status, "blocked");
assert(staleBootPacket.staleWarnings.some((warning) => warning.warningKind === "worldmodel_revision_stale"));

const differentWorldmodel = activeWorldmodelFixture("project", {
  revision: 3,
  subjectAgentId: "agent_worker_different_fixture",
});
expectThrows(() => buildLegacyWorkerBootPacket({
  delegationPacket: delegation,
  worldmodel: differentWorldmodel,
}, { now }), "direct_thread_manager_worldmodel_mismatch");

expectThrows(() => buildWorkerBootPacket({ delegationPacket: delegation, worldmodel }, { now }), "direct_thread_manager_wave26_graph_context_required");
expectThrows(() => buildLegacyWorkerBootPacket({ delegationPacket: delegation, worldmodel, graphContext: {} }, { now }), "direct_thread_manager_legacy_graph_claim_forbidden");

const tamperedBootPacket = {
  ...bootPacket,
  roleLane: "review_auditor",
};
expectThrows(() => validateWorkerBootPacket(tamperedBootPacket), "direct_thread_manager_digest_mismatch");

const invalidContextIntegration = {
  ...bootPacket,
  shadowContextPackIntegration: {
    ...bootPacket.shadowContextPackIntegration,
    providerInjectionEnabled: true,
  },
};
expectThrows(() => validateWorkerBootPacket(invalidContextIntegration), "direct_thread_manager_context_integration_not_shadow");

console.log("direct thread manager boot regression passed");
