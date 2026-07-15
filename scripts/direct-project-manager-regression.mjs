#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  activeWorldmodelFixture,
  buildHistoricalWorldManagerThreadParentAdapter,
  buildHierarchicalWorldmodelGraph,
  buildHierarchicalWorldmodelMigrationWitness,
  buildManagerScopeMigrationWitness,
  buildProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  buildProjectManagerChatMarker,
  buildProjectManagerProfile,
  buildProjectManagerContextualAdmission,
  buildProjectWorldState,
  buildThreadManagerProfile,
  buildWorldManagerTargetPosture,
  buildWorldToProjectDelegationPacket,
  buildWorldmodelManagerProfile,
  buildWorldmodelContextualAuthorityDecision,
  buildGovernanceProvenanceRegistry,
  createWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  resolveAuthoritativeWorldmodelTrustStore,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  registryRef,
  buildWorkThreadDelegationPacket,
  buildLegacyWorkerBootPacket,
  validateHistoricalWorldManagerThreadParentAdapter,
  validateHierarchicalWorldmodelMigrationWitness,
  validateProjectCustodyWriteWitness,
  validateProjectManagerChatMarker,
  validateProjectManagerProfile,
  validateProjectManagerContextualAdmission,
  validateProjectManagerProfileAgainstContext,
  validateProjectWorldState,
  validateThreadManagerProfile,
  validateWorldManagerTargetPosture,
  validateWorldToProjectDelegationPacket,
  validateWorldmodelManagerProfile,
  validateWorkThreadDelegationPacket,
} = require("../src/main/direct/worldmodel");
const { buildWorkThread } = require("../src/main/direct/bridge/work-thread-registry");
const { canonicalJson, sha256 } = require("../src/main/direct/meta-session/digest");

function expectThrows(fn, expectedCode) {
  try { fn(); } catch (error) { assert.equal(error.code, expectedCode); return; }
  throw new Error(`expected throw: ${expectedCode}`);
}
function ref(kind, id) { return { kind, id, digest: `sha256:${id}`, label: id }; }
const exact = (id) => `sha256:${crypto.createHash("sha256").update(id).digest("hex")}`;
const now = () => Date.UTC(2026, 6, 15, 10, 0, 0);

const worldManager = buildWorldmodelManagerProfile({
  scopeKind: "global_user", userProfileId: "user_fixture", managerAgentId: "agent_world_manager",
}, { now });
validateWorldmodelManagerProfile(worldManager);
expectThrows(() => validateWorldmodelManagerProfile({ ...worldManager, canExecuteWorkerTasks: true }), "direct_worldmodel_manager_worker_boundary_violation");

const projectManager = buildProjectManagerProfile({
  projectManagerProfileId: "project_manager_fixture", projectManagerAgentId: "agent_project_manager",
  worldManagerAgentId: worldManager.managerAgentId, projectId: "project_fixture", projectRootNodeId: "project_root_fixture",
  authorityBoundaryRef: ref("authority_boundary", "project_manager_boundary"),
  graphProjectionPolicyRef: ref("graph_projection_policy", "project_projection_policy"),
}, { now });
validateProjectManagerProfile(projectManager);
assert.equal(projectManager.humanFacingConversation, true);
assert.equal(projectManager.mayUpdateGlobalWorldState, false);
assert.equal(projectManager.mayExecuteWorkerTasks, false);
expectThrows(() => validateProjectManagerProfile({ ...projectManager, mayModifyConstitutionalPolicy: true }), "direct_project_manager_control_plane_boundary_violation");
const projectManagerB = buildProjectManagerProfile({
  projectManagerProfileId: "project_manager_b_fixture", projectManagerAgentId: "agent_project_manager_b",
  worldManagerAgentId: worldManager.managerAgentId, projectId: "project_b_fixture", projectRootNodeId: "project_b_root_fixture",
  authorityBoundaryRef: ref("authority_boundary", "project_manager_b_boundary"),
  graphProjectionPolicyRef: ref("graph_projection_policy", "project_b_projection_policy"),
}, { now });

const projectWorld = buildProjectWorldState({
  projectManagerProfile: projectManager, canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"), projectRevision: 4,
  charterNodeRefs: [ref("worldmodel_semantic_node", "charter")], terminalGoalNodeRefs: [ref("worldmodel_semantic_node", "goal")],
  statusSummaryNodeRef: ref("worldmodel_semantic_node", "status"), activeWorkThreadRefs: [ref("work_thread", "thread_fixture")],
  ancestorRevisionRefs: [{ scopeKind: "user_world", userProfileId: "user_fixture", revision: 2 }],
});
validateProjectWorldState(projectWorld);
assert.equal(projectWorld.projectRevisionRef.projectId, projectManager.projectId);
expectThrows(() => validateProjectWorldState({ ...projectWorld, projectRevision: 5 }), "direct_project_manager_project_revision_mismatch");
expectThrows(() => buildProjectWorldState({
  projectManagerProfile: projectManager, projectId: projectManagerB.projectId, projectRootNodeId: projectManagerB.projectRootNodeId,
  canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"), statusSummaryNodeRef: ref("worldmodel_semantic_node", "status"),
}), "direct_project_manager_state_project_identity_mismatch");
expectThrows(() => validateProjectWorldState({ ...projectWorld, projectManagerProjectId: projectManagerB.projectId }), "direct_project_manager_state_project_identity_mismatch");
const refOnlyProjectWorld = buildProjectWorldState({
  projectManagerProfileRef: ref("project_manager_profile", projectManager.projectManagerProfileId), projectManagerProjectId: projectManager.projectId,
  projectId: projectManager.projectId, projectRootNodeId: projectManager.projectRootNodeId, canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"),
  statusSummaryNodeRef: ref("worldmodel_semantic_node", "ref_only_status"),
});
validateProjectWorldState(refOnlyProjectWorld);
assert.equal(refOnlyProjectWorld.projectManagerProfileRef.id, projectManager.projectManagerProfileId);
assert.equal(refOnlyProjectWorld.projectManagerProfileRef.digest, `sha256:${projectManager.projectManagerProfileId}`);

const posture = buildWorldManagerTargetPosture({ worldManagerProfile: worldManager });
validateWorldManagerTargetPosture(posture);
assert.equal(posture.mayDirectlyMutateProjectOperationalState, false);
expectThrows(() => buildWorldManagerTargetPosture({ worldManagerProfile: buildWorldmodelManagerProfile({ scopeKind: "project", projectId: "project_fixture" }, { now }) }), "direct_project_manager_world_manager_not_global");

const worldToProject = buildWorldToProjectDelegationPacket({
  worldManagerProfile: worldManager, projectManagerProfile: projectManager,
  canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"), expectedProjectRevision: 4,
});
validateWorldToProjectDelegationPacket(worldToProject);
assert.equal(worldToProject.targetPosture, "project_delta_candidate_only");
expectThrows(() => buildWorldToProjectDelegationPacket({
  worldManagerProfile: worldManager, projectManagerProfile: projectManager, projectId: projectManagerB.projectId,
  projectRootNodeId: projectManagerB.projectRootNodeId, canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"), expectedProjectRevision: 4,
}), "direct_project_manager_delegation_project_identity_mismatch");
const refOnlyWorldToProject = buildWorldToProjectDelegationPacket({
  worldManagerProfile: worldManager, projectManagerProfileRef: ref("project_manager_profile", projectManager.projectManagerProfileId),
  projectManagerProjectId: projectManager.projectId, projectId: projectManager.projectId, projectRootNodeId: projectManager.projectRootNodeId,
  canonicalGraphRef: ref("hierarchical_worldmodel_graph", "graph_fixture"), expectedProjectRevision: 4,
});
validateWorldToProjectDelegationPacket(refOnlyWorldToProject);
assert.equal(refOnlyWorldToProject.projectManagerProfileRef.id, projectManager.projectManagerProfileId);

const projectThreadManager = buildThreadManagerProfile({
  projectManagerProfile: projectManager, threadManagerProfileId: "thread_manager_project_parent",
  threadManagerAgentId: "agent_thread_manager", workThreadId: "thread_fixture",
}, { now });
validateThreadManagerProfile(projectThreadManager);
assert.equal(projectThreadManager.parentManagerRole, "project_manager");
assert.equal(projectThreadManager.parentManagerProfileId, projectManager.projectManagerProfileId);
assert.equal(projectThreadManager.parentRelationship, "owning_project_manager");
expectThrows(() => buildThreadManagerProfile({
  projectManagerProfile: projectManager, projectId: projectManagerB.projectId, workThreadId: "thread_b_fixture",
  threadManagerProfileId: "thread_manager_project_mismatch", threadManagerAgentId: "agent_thread_manager_mismatch",
}, { now }), "direct_thread_manager_project_identity_mismatch");
expectThrows(() => buildThreadManagerProfile({ threadManagerProfileId: "thread_manager_missing_parent", threadManagerAgentId: "agent_missing_parent", projectId: "project_fixture", workThreadId: "thread_fixture" }, { now }), "direct_thread_manager_missing_explicit_parent_manager");

const legacyThreadManager = buildThreadManagerProfile({
  managerProfile: worldManager, projectId: "project_fixture", workThreadId: "legacy_thread_fixture",
  threadManagerProfileId: "thread_manager_legacy_parent", threadManagerAgentId: "agent_legacy_thread_manager",
}, { now });
validateThreadManagerProfile(legacyThreadManager);
assert.equal(legacyThreadManager.parentRelationship, "historical_direct_world_manager_compatibility");
const legacyAdapter = buildHistoricalWorldManagerThreadParentAdapter({
  historicalWorldManagerProfileRef: ref("worldmodel_manager_profile", worldManager.managerProfileId),
  threadManagerProfileRef: ref("thread_manager_profile", legacyThreadManager.threadManagerProfileId),
});
validateHistoricalWorldManagerThreadParentAdapter(legacyAdapter);

const projectDelegation = buildWorkThreadDelegationPacket({
  projectManagerProfile: projectManager, threadManagerProfile: projectThreadManager,
  worldmodel: activeWorldmodelFixture("work_thread", { revision: 2 }), targetWorkThreadId: "thread_fixture", legacyNonWave26Delegation: true,
});
validateWorkThreadDelegationPacket(projectDelegation);
assert.equal(projectDelegation.managerProfileRef.kind, "project_manager_profile");
assert.equal(projectDelegation.delegationPosture, "legacy_non_wave26_ref_only");
assert.equal(projectDelegation.status, "diagnostic_only");
expectThrows(() => validateWorkThreadDelegationPacket({ ...projectDelegation, threadManagerProjectId: projectManagerB.projectId }), "direct_thread_manager_project_delegation_project_mismatch");
expectThrows(() => validateWorkThreadDelegationPacket({ ...projectDelegation, threadManagerParentProfileRef: ref("project_manager_profile", projectManagerB.projectManagerProfileId) }), "direct_thread_manager_project_delegation_parent_mismatch");
const projectBThreadManager = buildThreadManagerProfile({
  projectManagerProfile: projectManagerB, threadManagerProfileId: "thread_manager_b_parent", threadManagerAgentId: "agent_thread_manager_b", workThreadId: "thread_b_fixture",
}, { now });
expectThrows(() => buildWorkThreadDelegationPacket({
  projectManagerProfile: projectManager, threadManagerProfile: projectBThreadManager,
  worldmodel: activeWorldmodelFixture("work_thread", { revision: 2 }), targetWorkThreadId: "thread_b_fixture",
}), "direct_thread_manager_project_delegation_parent_mismatch");

const matrix = buildProjectCustodyWriteMatrix({ projectId: projectManager.projectId });
const worldProjectWrite = buildProjectCustodyWriteWitness({ matrix, actorRole: "world_manager", path: "project.progress", action: "mutate" });
const projectGlobalWrite = buildProjectCustodyWriteWitness({ matrix, actorRole: "project_manager", path: "user.constitution", action: "mutate" });
const projectOperationalWrite = buildProjectCustodyWriteWitness({ matrix, actorRole: "project_manager", path: "project.progress", action: "mutate" });
[worldProjectWrite, projectGlobalWrite, projectOperationalWrite].forEach(validateProjectCustodyWriteWitness);
assert.equal(worldProjectWrite.decision, "remanded");
assert.equal(worldProjectWrite.reasonCode, "direct_world_manager_project_write_blocked");
assert.equal(projectGlobalWrite.decision, "remanded");
assert.equal(projectGlobalWrite.reasonCode, "project_manager_global_write_blocked");
assert.equal(projectOperationalWrite.decision, "authorized");
assert.equal(projectOperationalWrite.custodyRouteSatisfied, true);
assert.equal(projectOperationalWrite.actionAuthorityGranted, false);
assert.equal(projectOperationalWrite.requiresGraphCas, true);
assert.equal(projectOperationalWrite.requiresAuthorityTrace, true);
expectThrows(() => validateProjectCustodyWriteWitness({ ...projectOperationalWrite, actionAuthorityGranted: true }), "direct_project_manager_custody_not_action_authority");

const chatMarker = buildProjectManagerChatMarker({ projectManagerProfile: projectManager, sessionId: "project_manager_chat_fixture" }, { now });
validateProjectManagerChatMarker(chatMarker);
assert.equal(chatMarker.humanFacingConversation, true);
expectThrows(() => validateProjectManagerChatMarker({ ...chatMarker, rawTranscriptIncluded: true }), "direct_project_manager_chat_identity_violation");

const migrationWitness = buildHierarchicalWorldmodelMigrationWitness({
  witnessId: "migration_fixture", projectId: "project_fixture", sourceArtifactRefs: [ref("agent_memory_row", "memory_fixture")],
  resultingNodeRefs: [ref("worldmodel_semantic_node", "memory_node_fixture")], compatibilityBindingRefs: [ref("compatibility_binding", "memory_binding_fixture")], preservedProvenanceCount: 1,
});
validateHierarchicalWorldmodelMigrationWitness(migrationWitness);
assert.equal(migrationWitness.doubleInclusionCount, 0);
expectThrows(() => validateHierarchicalWorldmodelMigrationWitness({ ...migrationWitness, doubleInclusionCount: 1 }), "direct_project_manager_migration_boundary_violation");
const scopeMigration = buildManagerScopeMigrationWitness({
  witnessId: "project_scope_migration_fixture", projectId: "project_fixture", legacyScopeKind: "project",
  legacyManagerProfileRef: ref("worldmodel_manager_profile", "legacy_project_scope_manager"),
  resultingManagerProfileRef: ref("project_manager_profile", projectManager.projectManagerProfileId),
});
validateHierarchicalWorldmodelMigrationWitness(scopeMigration);
assert.equal(scopeMigration.managerScopeMigration.targetRole, "project_manager");

// H-04: ref-only compatibility remains readable, but only this contextual
// admission may bind a PM, ProjectWorld, child Thread Manager and WorkThread.
const contextualStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-pm-trust-"));
const contextualTrustStore = createWorldmodelTrustStore(contextualStoreDir, { storeId: "contextual_pm_trust", now: now() });
const contextualGraph = buildHierarchicalWorldmodelGraph({ graphId: "contextual_pm_graph", userProfileId: "user_fixture", rootNodeId: "contextual_world_root", trustAnchorRef: buildWorldmodelTrustAnchor(contextualTrustStore, "contextual_pm_graph"), scopedRevisionRefs: [{ scopeKind: "project", projectId: "contextual_project", revision: 2 }], nodes: [
  { nodeId: "contextual_world_root", scope: { scopeKind: "user_world", userProfileId: "user_fixture" }, nodeKind: "world_root", semanticSummary: "World", lifecycle: "active", epistemicStatus: "accepted", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"], projectionEligibility: "eligible", sourceRefs: [] },
  { nodeId: "contextual_project_root", scope: { scopeKind: "project", userProfileId: "user_fixture", projectId: "contextual_project" }, nodeKind: "project_root", semanticSummary: "Project", lifecycle: "active", epistemicStatus: "accepted", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: [] },
] }, { now });
const contextualWorldManager = buildWorldmodelManagerProfile({ scopeKind: "global_user", userProfileId: "user_fixture", managerAgentId: "contextual_wm" }, { now });
const contextualPm = buildProjectManagerProfile({ projectManagerProfileId: "contextual_pm", projectManagerAgentId: "contextual_pm_agent", worldManagerAgentId: "contextual_wm", projectId: "contextual_project", projectRootNodeId: "contextual_project_root", authorityBoundaryRef: { kind: "authority_boundary", id: "contextual_boundary", digest: exact("contextual_boundary") }, graphProjectionPolicyRef: { kind: "graph_projection_policy", id: "contextual_policy", digest: exact("contextual_policy") } }, { now });
const contextualState = buildProjectWorldState({ projectManagerProfile: contextualPm, canonicalGraphRef: { kind: "hierarchical_worldmodel_graph", id: contextualGraph.graphId, digest: contextualGraph.digest }, projectRevision: 2, statusSummaryNodeRef: { kind: "worldmodel_semantic_node", id: "contextual_project_root", digest: contextualGraph.nodes.find((node) => node.nodeId === "contextual_project_root").digest } });
const contextualMatrix = buildProjectCustodyWriteMatrix({ matrixId: "contextual_matrix", projectId: "contextual_project" });
const contextualWitness = buildProjectCustodyWriteWitness({ matrix: contextualMatrix, actorRole: "project_manager", path: "project.work_threads", action: "mutate" });
const contextualAuthority = buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: "contextual_pm_authority", graph: contextualGraph, managerProfile: contextualPm, actorAgentId: contextualPm.projectManagerAgentId, actorRole: "project_manager", targetScope: { scopeKind: "project", userProfileId: "user_fixture", projectId: "contextual_project" }, issuedAt: "2026-07-15T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }, { now });
const contextualThread = buildThreadManagerProfile({ projectManagerProfile: contextualPm, threadManagerProfileId: "contextual_thread_manager", threadManagerAgentId: "contextual_thread_agent", workThreadId: "contextual_thread" }, { now });
const contextualWorkThread = buildWorkThread({ workThreadId: "contextual_thread", projectId: "contextual_project", title: "Contextual thread", objective: "Bound delegation" }, { nowMs: now() });
const contextualBinding = { graphId: contextualGraph.graphId, graphDigest: contextualGraph.digest, userProfileId: contextualGraph.userProfileId, scopeKind: "project", projectId: "contextual_project", projectRootNodeId: "contextual_project_root", role: "project_manager", agentId: "contextual_pm_agent", purpose: "manager_context", expectedScopeRevisionDigest: contextualState.projectRevisionRef.digest };
const contextualRegistry = buildGovernanceProvenanceRegistry({ registryId: "contextual_registry", userProfileId: contextualGraph.userProfileId, records: [{ kind: "world_manager_profile", body: contextualWorldManager, binding: contextualBinding }, { kind: "project_manager_profile", body: contextualPm, binding: contextualBinding }, { kind: "project_root", body: contextualGraph.nodes.find((node) => node.nodeId === "contextual_project_root"), binding: contextualBinding }, { kind: "custody_matrix", body: contextualMatrix, binding: contextualBinding }, { kind: "custody_witness", body: contextualWitness, binding: contextualBinding }, { kind: "authority_decision", body: contextualAuthority, binding: contextualBinding, oneShot: true }] });
initializeAuthoritativeWorldmodelGraph(contextualTrustStore, contextualGraph, contextualRegistry);
const contextualRequiredArtifacts = [{ kind: "world_manager_profile", id: contextualWorldManager.managerProfileId, digest: contextualWorldManager.profileDigest }, { kind: "project_manager_profile", id: contextualPm.projectManagerProfileId, digest: contextualPm.profileDigest }, { kind: "project_root", id: "contextual_project_root", digest: contextualGraph.nodes.find((node) => node.nodeId === "contextual_project_root").digest }, { kind: "custody_matrix", id: contextualMatrix.matrixId, digest: contextualMatrix.matrixDigest }, { kind: "custody_witness", id: contextualWitness.path, digest: contextualWitness.writeWitnessDigest }, { kind: "authority_decision", id: contextualAuthority.authorityDecisionId, digest: contextualAuthority.digest, oneShot: true }];
const contextualStoreAdmission = admitWorldmodelGovernanceRequest(contextualTrustStore, { admissionId: "contextual_pm_store_admission", graph: contextualGraph, context: { registryRef: registryRef(contextualRegistry), expectedRegistryRevision: contextualRegistry.revision, ...contextualBinding, requiredArtifacts: contextualRequiredArtifacts } });
const contextualAdmissionContext = { graph: contextualGraph, worldManagerProfile: contextualWorldManager, projectManagerProfile: contextualPm, projectWorldState: contextualState, custodyMatrix: contextualMatrix, custodyWriteWitness: contextualWitness, authorityDecision: contextualAuthority, governanceRegistry: contextualRegistry, storeAdmission: contextualStoreAdmission, threadManagerProfile: contextualThread, workThread: contextualWorkThread };
const contextualAdmission = buildProjectManagerContextualAdmission({ admissionId: "contextual_pm_admission", ...contextualAdmissionContext, registryRef: registryRef(contextualRegistry), expectedRegistryRevision: contextualRegistry.revision });
validateProjectManagerContextualAdmission(contextualAdmission, contextualAdmissionContext);
expectThrows(() => buildWorkThreadDelegationPacket({ projectManagerProfile: contextualPm, threadManagerProfile: contextualThread, workThread: contextualWorkThread, worldmodel: activeWorldmodelFixture("work_thread", { revision: 2 }), targetWorkThreadId: contextualThread.workThreadId }), "direct_thread_manager_project_contextual_admission_required");
const contextualDelegation = buildWorkThreadDelegationPacket({
  projectManagerProfile: contextualPm,
  threadManagerProfile: contextualThread,
  workThread: contextualWorkThread,
  worldmodel: activeWorldmodelFixture("work_thread", { revision: 2 }),
  targetWorkThreadId: contextualThread.workThreadId,
  projectManagerContextualAdmission: contextualAdmission,
  projectManagerAdmissionContext: contextualAdmissionContext,
});
validateWorkThreadDelegationPacket(contextualDelegation, { projectManagerContextualAdmission: contextualAdmission, projectManagerAdmissionContext: contextualAdmissionContext });
assert.equal(contextualDelegation.status, "ready_for_thread_manager");
assert.equal(contextualDelegation.delegationPosture, "wave26_contextually_admitted");
assert.equal(validateProjectManagerProfileAgainstContext(contextualPm, { graph: contextualGraph, worldManagerProfile: contextualWorldManager }).projectRootDigest, contextualGraph.nodes.find((node) => node.nodeId === "contextual_project_root").digest);
expectThrows(() => validateProjectManagerProfileAgainstContext({ ...contextualPm, projectManagerAgentId: "wrong_pm" }, { graph: contextualGraph, worldManagerProfile: contextualWorldManager }), "direct_project_manager_digest_mismatch");
expectThrows(() => validateProjectManagerContextualAdmission({ ...contextualAdmission, projectRootRef: { ...contextualAdmission.projectRootRef, digest: exact("wrong_root") } }, contextualAdmissionContext), "direct_project_manager_context_admission_mismatch");
expectThrows(() => validateProjectManagerContextualAdmission(contextualAdmission, { ...contextualAdmissionContext, threadManagerProfile: { ...contextualThread, parentManagerProfileId: "wrong_parent" } }), "direct_thread_manager_parent_ref_identity_mismatch");

// Permanent H-04 attacker probes: an anchor claim, caller-built registry, a
// missing store admission, and a recomputed cross-project packet must not
// cross the operational boundary.  The trusted path above is the control.
const resignDelegation = (packet) => ({ ...packet, delegationDigest: sha256(`work-thread-delegation-packet@1\0${canonicalJson(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== "delegationDigest").sort(([a], [b]) => a.localeCompare(b))), { omitDigestFields: false })}`) });
expectThrows(() => buildProjectManagerContextualAdmission({ ...contextualAdmissionContext, admissionId: "omitted_pm_store_admission", storeAdmission: undefined }), "direct_project_manager_context_store_admission_required");
const selfMintedRegistry = buildGovernanceProvenanceRegistry({ registryId: "self_minted_pm_registry", userProfileId: contextualGraph.userProfileId, records: contextualRegistry.records });
expectThrows(() => buildProjectManagerContextualAdmission({ ...contextualAdmissionContext, admissionId: "self_minted_pm_registry_admission", governanceRegistry: selfMintedRegistry }), "direct_project_manager_context_store_registry_substitution");
const claimedAnchorGraph = buildHierarchicalWorldmodelGraph({ graphId: "claimed_pm_anchor_graph", userProfileId: "user_fixture", rootNodeId: "claimed_world_root", trustAnchorRef: buildWorldmodelTrustAnchor(contextualTrustStore, "claimed_pm_anchor_graph"), scopedRevisionRefs: [{ scopeKind: "project", projectId: "contextual_project", revision: 2 }], nodes: contextualGraph.nodes.map((entry) => ({ ...entry, nodeId: entry.nodeId.replace("contextual_", "claimed_") })) }, { now });
expectThrows(() => resolveAuthoritativeWorldmodelTrustStore(claimedAnchorGraph), "direct_worldmodel_trust_store_authority_unresolved");
expectThrows(() => validateWorkThreadDelegationPacket(contextualDelegation), "direct_thread_manager_project_operational_context_required");
const borrowedProjectPacket = resignDelegation({ ...contextualDelegation, projectId: "project_borrowed", threadManagerProjectId: "project_borrowed" });
expectThrows(() => validateWorkThreadDelegationPacket(borrowedProjectPacket, { projectManagerContextualAdmission: contextualAdmission, projectManagerAdmissionContext: contextualAdmissionContext }), "direct_thread_manager_project_operational_context_mismatch");
const trustedBoot = buildLegacyWorkerBootPacket({ delegationPacket: contextualDelegation, worldmodel: activeWorldmodelFixture("work_thread", { revision: 2 }), projectManagerContextualAdmission: contextualAdmission, projectManagerAdmissionContext: contextualAdmissionContext }, { now });
assert.equal(trustedBoot.status, "ready_for_worker_boot");
console.log(JSON.stringify({ probe: "forged_operational_pm_delegation", result: "rejected", code: "direct_thread_manager_project_operational_context_required" }));
console.log(JSON.stringify({ probe: "anchored_pm_self_mint", result: "rejected", code: "direct_worldmodel_trust_store_authority_unresolved" }));
console.log(JSON.stringify({ probe: "self_minted_pm_registry", result: "rejected", code: "direct_project_manager_context_store_registry_substitution" }));
console.log(JSON.stringify({ probe: "omitted_pm_store_admission", result: "rejected", code: "direct_project_manager_context_store_admission_required" }));
console.log(JSON.stringify({ probe: "cross_project_borrowed_pm_ref", result: "rejected", code: "direct_thread_manager_project_operational_context_mismatch" }));
console.log(JSON.stringify({ probe: "lawful_trusted_pm_delegation", result: "ready_for_thread_manager", boot: trustedBoot.status }));

console.log("direct-project-manager-regression: ok");
