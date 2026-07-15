#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  buildActiveInteractionWorldmodel,
  buildHierarchicalWorldmodelGraph,
  buildProjectManagerProfile,
  buildWorldmodelManagerProfile,
  buildManagerDialogueFrame,
  buildManagerGraphFirstContextAdapter,
  buildManagerTurnBootPacket,
  admitManagerTurnBootPacket,
  buildActiveInteractionWorldmodelCompilationWitness,
  buildGraphOdeuCompilation,
  buildScopedWorldmodelRevisionRef,
  buildTranscriptEvidenceRef,
  buildTranscriptInspectionArtifact,
  buildWorldmodelGraphProjection,
  buildWorldmodelProjectionPolicy,
  buildWorldmodelIngressEnvelope,
  validateActiveInteractionWorldmodelCompilationWitness,
  validateManagerDialogueFrame,
  validateManagerGraphFirstContextAdapter,
  validateManagerTurnBootPacket,
  validateGraphOdeuCompilation,
  buildGovernanceProvenanceRegistry,
  registryRef,
  createWorldmodelTrustStore,
  buildWorldmodelTrustAnchor,
  initializeAuthoritativeWorldmodelGraph,
  admitWorldmodelGovernanceRequest,
  installHeadlessCurrentGraphContextProvider,
  uninstallHeadlessCurrentGraphContextProvider,
  HEADLESS_CURRENT_GRAPH_PROVIDER_ID,
  registerManagerGraphContextProvider,
  unregisterManagerGraphContextProvider,
} = require("../src/main/direct/worldmodel");
const { sha256 } = require("../src/main/direct/meta-session/digest");
const { buildContextPack } = require("../src/main/direct/thread/context-pack");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

const now = () => Date.UTC(2026, 6, 15, 12, 0, 0);
const sourceRefs = (id) => [{ sourceRefId: `source_${id}`, sourceKind: "fixture", sourceId: id, sourceConfidence: "exact", freshness: "fresh", observedAt: "2026-07-15T12:00:00.000Z" }];
const typed = (kind, id) => ({ kind, id, digest: `sha256:${id}` });
const expectThrows = (fn, code) => assert.throws(fn, (error) => error?.code === code);
const trustStore = createWorldmodelTrustStore(fs.mkdtempSync(path.join(os.tmpdir(), "wave26-manager-context-")), { storeId: "manager_context_trust", now: now() });

const graph = buildHierarchicalWorldmodelGraph({
  graphId: "manager_context_graph", userProfileId: "user_fixture", rootNodeId: "world_root",
  trustAnchorRef: buildWorldmodelTrustAnchor(trustStore, "manager_context_graph"),
  scopedRevisionRefs: [buildScopedWorldmodelRevisionRef({ scopeKind: "project", projectId: "project_fixture", revision: 4 })],
  nodes: [
    { nodeId: "world_root", scope: { scopeKind: "user_world", userProfileId: "user_fixture", semanticPath: ["world"] }, nodeKind: "world_root", abstractionLevel: "world", semanticSummary: "World root", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "world_manager", authorizedWriterRoles: ["world_manager"], projectionEligibility: "eligible", sourceRefs: sourceRefs("world") },
    { nodeId: "project_root", scope: { scopeKind: "project", userProfileId: "user_fixture", projectId: "project_fixture", semanticPath: ["projects", "fixture"] }, nodeKind: "project_root", abstractionLevel: "strategic", semanticSummary: "Project canonical semantic head", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "none", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: sourceRefs("project") },
    { nodeId: "pending_decision", scope: { scopeKind: "project", userProfileId: "user_fixture", projectId: "project_fixture", semanticPath: ["projects", "fixture", "decision"] }, nodeKind: "decision", abstractionLevel: "conceptual", semanticSummary: "Approve the project plan", odeuImpact: {}, lifecycle: "active", integrationStatus: "not_integrated", epistemicStatus: "accepted", normativeForce: "project_commitment", custodianRole: "project_manager", authorizedWriterRoles: ["project_manager"], projectionEligibility: "eligible", sourceRefs: sourceRefs("decision") },
  ],
  edges: [{ edgeId: "project_decision", fromNodeId: "project_root", toNodeId: "pending_decision", relationKind: "supports", epistemicStatus: "accepted", lifecycle: "active", sourceRefs: sourceRefs("edge") }],
}, { now });

const pmProfile = buildProjectManagerProfile({ projectManagerProfileId: "pm_profile", projectManagerAgentId: "pm_agent", worldManagerAgentId: "wm_agent", projectId: "project_fixture", projectRootNodeId: "project_root", authorityBoundaryRef: typed("authority_boundary", "pm_authority"), graphProjectionPolicyRef: typed("graph_projection_policy", "pm_policy") }, { now });
const wmProfile = buildWorldmodelManagerProfile({ managerProfileId: "wm_profile", managerAgentId: "wm_agent", scope: { scopeKind: "global_user", userProfileId: "user_fixture" }, sourceRefs: sourceRefs("wm_profile") }, { now });
const policyAuthority = typed("authority_boundary", "pm_authority");
const pmPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: pmProfile, authoritySourceRef: policyAuthority, policyId: "pm_policy", purpose: "current_context", allowedEntryPaths: ["project_resident"], allowedFocalScopes: [{ scopeKind: "project", projectId: "project_fixture" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "project_root", digest: graph.nodes.find((node) => node.nodeId === "project_root").digest }], custodyDenyList: [], sensitivityDenyList: [], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 8, maxEdges: 8, maxSummaryChars: 500 }, workerAllowedProjectNodeRefs: [] });
const wmPolicy = buildWorldmodelProjectionPolicy({ graph, managerProfile: wmProfile, authoritySourceRef: typed("authority_boundary", "wm_authority"), policyId: "wm_policy", purpose: "current_context", allowedEntryPaths: ["world_root"], allowedFocalScopes: [{ scopeKind: "user_world" }], trustedSeedNodeRefs: [{ kind: "worldmodel_semantic_node", id: "world_root", digest: graph.nodes.find((node) => node.nodeId === "world_root").digest }], custodyDenyList: [], sensitivityDenyList: [], allowedRelationKinds: ["supports", "relevant_to"], maxTraversalDepth: 3, semanticBudget: { maxNodes: 8, maxEdges: 8, maxSummaryChars: 500 }, workerAllowedProjectNodeRefs: [] });
const pmProjection = buildWorldmodelGraphProjection({ graph, policyArtifact: pmPolicy, managerProfile: pmProfile, authoritySourceRef: policyAuthority, projectionId: "pm_projection", entryPath: "project_resident", focalScope: { scopeKind: "project", projectId: "project_fixture" } });
const wmProjection = buildWorldmodelGraphProjection({ graph, policyArtifact: wmPolicy, managerProfile: wmProfile, authoritySourceRef: typed("authority_boundary", "wm_authority"), projectionId: "wm_projection", entryPath: "world_root", focalScope: { scopeKind: "user_world" } });
const pmAuthorityDecision = { authorityDecisionId: "pm_context_authority", digest: sha256("pm_context_authority") };
const pmBinding = { graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: "project_fixture", projectRootNodeId: "project_root", role: "project_manager", agentId: "pm_agent", purpose: "current_context" };
const pmRegistry = buildGovernanceProvenanceRegistry({ registryId: "pm_context_registry", userProfileId: graph.userProfileId, records: [{ kind: "project_manager_profile", body: pmProfile, binding: pmBinding }, { kind: "projection_policy", body: pmPolicy, binding: pmBinding }, { kind: "authority_decision", body: pmAuthorityDecision, binding: pmBinding, oneShot: true }] });
initializeAuthoritativeWorldmodelGraph(trustStore, graph, pmRegistry);
const pmStoreAdmission = admitWorldmodelGovernanceRequest(trustStore, { admissionId: "pm_context_read", graph, context: { registryRef: registryRef(pmRegistry), expectedRegistryRevision: pmRegistry.revision, ...pmBinding, requiredArtifacts: [{ kind: "project_manager_profile", id: pmProfile.projectManagerProfileId, digest: pmProfile.profileDigest }, { kind: "projection_policy", id: pmPolicy.policyId, digest: pmPolicy.policyDigest }, { kind: "authority_decision", id: pmAuthorityDecision.authorityDecisionId, digest: pmAuthorityDecision.digest, oneShot: true }] } });
const pmGovernance = { authorityDecision: pmAuthorityDecision, governanceRegistry: pmRegistry, registryRef: registryRef(pmRegistry), expectedRegistryRevision: pmRegistry.revision, projectRootNodeId: "project_root", trustStore, storeAdmission: pmStoreAdmission };
const pmIngress = buildWorldmodelIngressEnvelope({ ingressId: "pm_ingress", inputKind: "current_user_message", receivedByAgentId: "pm_agent", receivedByRole: "project_manager", declaredScopeHints: [{ scopeKind: "project", projectId: "project_fixture" }], sourceRefs: sourceRefs("pm_ingress"), currentInstructionAuthority: true }, { now });
const wmIngress = buildWorldmodelIngressEnvelope({ ingressId: "wm_ingress", inputKind: "current_user_message", receivedByAgentId: "wm_agent", receivedByRole: "world_manager", sourceRefs: sourceRefs("wm_ingress"), currentInstructionAuthority: true }, { now });

const graphCompilation = buildGraphOdeuCompilation({ compilationId: "pm_graph_compilation", graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, ...pmGovernance });
validateGraphOdeuCompilation(graphCompilation);
assert.equal(graphCompilation.laneEntries.length, pmProjection.selectedNodeRefs.length + pmProjection.selectedEdgeRefs.length, "every selected graph ref has one O/E/D/U lineage entry");
assert.equal(["O", "E", "D", "U"].flatMap((sectionKey) => graphCompilation.activeInteractionWorldmodel.task[sectionKey].entries).length, graphCompilation.laneEntries.length, "the compiler places each selected graph ref in an ActiveInteraction O/E/D/U section exactly once");
expectThrows(() => buildGraphOdeuCompilation({ graph, graphProjection: pmProjection, profileSnapshot: wmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, ...pmGovernance }), "direct_worldmodel_graph_projection_store_profile_substitution");

const frame = buildManagerDialogueFrame({ dialogueFrameId: "yes_frame", managerAgentId: "pm_agent", managerRole: "project_manager", activeProjectRefs: [typed("project", "project_fixture")], activeTopicNodeRefs: [typed("worldmodel_semantic_node", "pending_decision")], pendingDecisionRefs: [typed("worldmodel_decision", "pending_decision")], pendingClarificationRefs: [], userRoleStateRef: typed("user_role_state", "user_state"), expiresAfter: "decision_closed", sourceRefs: [typed("source", "frame_source")] });
validateManagerDialogueFrame(frame);
assert.equal(frame.pendingDecisionRefs[0].id, "pending_decision", "typed frame makes a subsequent yes interpretable without replay");
assert.equal(frame.grantsAuthority, false, "dialogue dependencies never grant authority");

const evidence = buildTranscriptEvidenceRef({ projectId: "project_fixture", threadId: "thread_fixture", turnIds: ["turn_1"], messageItemIds: ["item_1"], transcriptStoreId: "store_fixture", sourceDigest: "sha256:store_fixture", inspectionState: "bounded_excerpt_loaded" }, { now });
const inspection = buildTranscriptInspectionArtifact({ inspectionId: "bounded_inspection", evidenceRef: evidence, question: "What did the user approve?", boundedExcerptId: "bounded_excerpt", boundedExcerptDigest: "sha256:bounded_excerpt", extractedClaimCandidates: ["Approval is pending."], omissions: ["Other turns omitted."] }, { now });

const boot = buildManagerTurnBootPacket({ bootPacketId: "pm_boot", managerRole: "project_manager", managerAgentId: "pm_agent", graphProjection: pmProjection, profileSnapshot: pmProfile, dialogueFrame: frame, openDecisionRefs: [typed("worldmodel_decision", "pending_decision")], openRemandRefs: [], changesSincePreviousTurnRefs: [typed("worldmodel_change", "project_change")], currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection] });
validateManagerTurnBootPacket(boot);
assert.equal(boot.targetedEvidenceInspectionRefs[0].id, inspection.inspectionId, "bounded inspection enters boot only by typed artifact ref");
assert.equal(boot.historicalTranscriptIncluded, false);
const bootAdmission = admitManagerTurnBootPacket({ bootPacket: boot, graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: frame, ...pmGovernance });
assert.equal(bootAdmission.granted, false, "boot admission is contextual readback and never authority");
expectThrows(() => admitManagerTurnBootPacket({ bootPacket: boot, graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, currentIngress: wmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: frame, ...pmGovernance }), "direct_manager_turn_context_boot_context_mismatch");
expectThrows(() => admitManagerTurnBootPacket({ bootPacket: boot, graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [], dialogueFrame: frame, ...pmGovernance }), "direct_manager_turn_context_boot_context_mismatch");
expectThrows(() => admitManagerTurnBootPacket({ bootPacket: boot, graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: { ...frame, managerAgentId: "wrong_agent" }, ...pmGovernance }), "direct_manager_turn_context_digest_mismatch");

// WM and PM reconstruct their boots from graph/profile/ingress state alone.
const pmRestart = buildManagerTurnBootPacket({ bootPacketId: "pm_boot", managerRole: "project_manager", managerAgentId: "pm_agent", graphProjection: pmProjection, profileSnapshot: pmProfile, dialogueFrame: frame, openDecisionRefs: [typed("worldmodel_decision", "pending_decision")], openRemandRefs: [], changesSincePreviousTurnRefs: [typed("worldmodel_change", "project_change")], currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection] });
const wmBoot = buildManagerTurnBootPacket({ bootPacketId: "wm_boot", managerRole: "world_manager", managerAgentId: "wm_agent", graphProjection: wmProjection, profileSnapshot: wmProfile, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [], currentIngress: wmIngress });
assert.equal(pmRestart.digest, boot.digest, "PM restart is deterministic without transcript replay");
assert.equal(wmBoot.historicalTranscriptIncluded, false, "WM restart carries no transcript replay");

expectThrows(() => buildManagerDialogueFrame({ ...frame, rawText: "yes" }), "direct_manager_turn_context_raw_state_forbidden");
expectThrows(() => buildManagerDialogueFrame({ ...frame, expiresAfter: "forever" }), "direct_manager_turn_context_invalid_expiry");
expectThrows(() => buildManagerDialogueFrame({ ...frame, managerAgentId: "" }), "direct_manager_turn_context_missing_string");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, rawTranscript: "history" }), "direct_manager_turn_context_raw_state_forbidden");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, context_recent_dialogue: "legacy context" }), "direct_manager_turn_context_raw_state_forbidden");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, managerAgentId: "wrong_agent", graphProjection: pmProjection, profileSnapshot: pmProfile, currentIngress: pmIngress }), "direct_manager_turn_context_role_agent_mismatch");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, profileSnapshot: { projectManagerProfileId: "forged", projectManagerAgentId: "pm_agent", profileDigest: "sha256:forged" }, graphProjection: pmProjection, currentIngress: pmIngress }), "direct_manager_turn_context_invalid_profile_snapshot");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, profileSnapshot: { ...pmProfile, profileDigest: "sha256:tampered" }, graphProjection: pmProjection, currentIngress: pmIngress }), "direct_project_manager_digest_mismatch");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, graphProjection: undefined, profileSnapshot: pmProfile, currentIngress: pmIngress }), "direct_manager_turn_context_artifact_required");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, graphProjection: pmProjection, profileSnapshot: pmProfile, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [{ ...inspection, rawText: "forbidden" }] }), "direct_semantic_ingress_raw_evidence_embedded");
expectThrows(() => buildManagerTurnBootPacket({ ...boot, graphProjection: pmProjection, profileSnapshot: pmProfile, currentIngress: pmIngress, targetedEvidenceInspectionRefs: [typed("transcript_inspection_artifact", "forged")], targetedEvidenceInspectionArtifacts: [] }), "direct_manager_turn_context_unvalidated_inspection_ref");
expectThrows(() => validateManagerTurnBootPacket({ ...boot, nested: { rawText: "forbidden" } }), "direct_manager_turn_context_unknown_field");
expectThrows(() => validateManagerTurnBootPacket({ ...boot, canExecute: true }), "direct_manager_turn_context_unknown_field");

const managerGraphContext = { graph, graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: frame, ...pmGovernance };
const adapter = buildManagerGraphFirstContextAdapter({ adapterId: "pm_adapter", bootPacket: boot, graphContext: managerGraphContext });
validateManagerGraphFirstContextAdapter(adapter);
assert.equal(adapter.contextPolicyId, "direct_manager_graph_first_context@1");
assert.equal(adapter.contextRecentDialogueIncluded, false);
expectThrows(() => validateManagerGraphFirstContextAdapter({ ...adapter, contextRecentDialogueIncluded: true }), "direct_manager_turn_context_authority_boundary");
expectThrows(() => validateManagerGraphFirstContextAdapter({ ...adapter, nested: { body: "forbidden" } }), "direct_manager_turn_context_unknown_field");
expectThrows(() => buildManagerGraphFirstContextAdapter({ adapterId: "missing_graph_context", bootPacket: boot }), "direct_manager_turn_context_graph_context_required");

// H-08: the ordinary Direct context-pack builder has one harness-installed,
// pinned current-graph provider.  Request-level provider substitution is not
// a supported authority path.
const inactiveRuntimePack = buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request." });
assert.equal(inactiveRuntimePack.managerGraphContextReadback.status, "inactive_unconfigured");
expectThrows(() => installHeadlessCurrentGraphContextProvider({ trustStore, graph: { ...graph, trustAnchorRef: undefined }, resolveManagerContext: () => ({}) }), "direct_worldmodel_trust_store_graph_anchor_mismatch");
let selectedHeadlessProjection = pmProjection;
let headlessAdmissionAvailable = true;
installHeadlessCurrentGraphContextProvider({ trustStore, graph, resolveManagerContext: ({ projectId, threadId, turnId, graph: currentGraph }) => {
  assert.equal(projectId, "project_fixture"); assert.equal(threadId, "runtime_thread"); assert.equal(turnId, "runtime_turn"); assert.equal(currentGraph.digest, graph.digest);
  return { bootPacket: boot, ...(headlessAdmissionAvailable ? { storeAdmission: pmStoreAdmission } : {}), compilationId: "runtime_pm_compilation", graphContext: { graphProjection: selectedHeadlessProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, authorityDecision: pmAuthorityDecision, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: frame, projectRootNodeId: "project_root" } };
} });
const runtimePack = buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } });
assert.equal(runtimePack.managerGraphContextReadback.status, "compiled_and_readback");
assert.deepEqual(runtimePack.managerGraphContextReadback.selectedRefs, graphCompilation.laneEntries.map((entry) => `${entry.ref.kind}:${entry.ref.id}:${entry.ref.digest}`).sort());
assert.equal(runtimePack.managerGraphContextReadback.odeuEntries.length, graphCompilation.laneEntries.length);
assert(runtimePack.messages.some((message) => message.authority === "governed-manager-graph-context" && message.text.includes("[D] Approve the project plan")), "bounded O/E/D/U semantics reach the provider-consumed context pack");
selectedHeadlessProjection = wmProjection;
expectThrows(() => buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } }), "direct_worldmodel_graph_projection_context_mismatch");
selectedHeadlessProjection = pmProjection;
headlessAdmissionAvailable = false;
expectThrows(() => buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } }), "direct_manager_runtime_headless_provider_readback_invalid");
headlessAdmissionAvailable = true;
const threadStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave26-h08-thread-store-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(threadStoreRoot, "sessions") });
  const threadStore = new DirectThreadStore({ rootDir: path.join(threadStoreRoot, "threads"), mode: "index_only" });
  const session = sessionStore.createSession({ sessionId: "runtime_thread", projectId: "project_fixture", title: "H08 headless graph runtime", model: "gpt-5" }, { nowMs: now() });
  const turn = sessionStore.createTurn(session.sessionId, { turnId: "runtime_turn", input: [{ role: "user", text: "Current request." }], model: "gpt-5" }, { nowMs: now() });
  threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), [sessionStore.readTurn(session.sessionId, turn.turnId)], { nowMs: now() });
  const persisted = threadStore.buildAndPersistContextForTextTurn({ session, projectId: "project_fixture", threadId: session.sessionId, turnId: turn.turnId, useRecentDialogue: false, currentUserPrompt: "Current request.", model: "gpt-5", requestShape: { requestShapeClass: "direct_text_turn_empty_context@1" }, managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } }, { nowMs: now() });
  const readback = threadStore.readContextPack(persisted.contextPack.contextBuildId);
  assert.equal(readback.managerGraphContextReadback.status, "compiled_and_readback", "indexed DirectThreadStore persists the H-08 graph readback");
  assert.equal(readback.managerGraphContextReadback.compilationRef.digest, persisted.contextPack.managerGraphContextReadback.compilationRef.digest, "stored context retains its exact compilation ref");
  assert(persisted.providerInput.prompt.includes("[GOVERNED MANAGER GRAPH CONTEXT]"), "the persisted manager path consumes materialized graph O/E/D/U semantics");
} finally {
  fs.rmSync(threadStoreRoot, { recursive: true, force: true });
}
expectThrows(() => buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: "caller_provider" } }), "direct_manager_runtime_provider_substitution_forbidden");
const refreshedPmStoreAdmission = admitWorldmodelGovernanceRequest(trustStore, { admissionId: "pm_context_read_after_restart", graph, context: { registryRef: registryRef(pmRegistry), expectedRegistryRevision: pmRegistry.revision, ...pmBinding, requiredArtifacts: [{ kind: "project_manager_profile", id: pmProfile.projectManagerProfileId, digest: pmProfile.profileDigest }, { kind: "projection_policy", id: pmPolicy.policyId, digest: pmPolicy.policyDigest }, { kind: "authority_decision", id: pmAuthorityDecision.authorityDecisionId, digest: pmAuthorityDecision.digest, oneShot: true }] } });
expectThrows(() => buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } }), "direct_worldmodel_trust_store_admission_invalid");
uninstallHeadlessCurrentGraphContextProvider();
installHeadlessCurrentGraphContextProvider({ trustStore, graph, resolveManagerContext: () => ({ bootPacket: boot, storeAdmission: refreshedPmStoreAdmission, compilationId: "runtime_pm_compilation_restart", graphContext: { graphProjection: pmProjection, profileSnapshot: pmProfile, policy: pmPolicy, authoritySourceRef: policyAuthority, authorityDecision: pmAuthorityDecision, currentIngress: pmIngress, targetedEvidenceInspectionArtifacts: [inspection], dialogueFrame: frame, projectRootNodeId: "project_root" } }) });
const restartPack = buildContextPack({ projectId: "project_fixture", threadId: "runtime_thread", turnId: "runtime_turn", policyId: "direct_text_turn_empty_context@1", currentUserPrompt: "Current request.", managerGraphContextRuntime: { enabled: true, providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID } });
assert.equal(restartPack.managerGraphContextReadback.status, "compiled_and_readback", "a restarted headless provider needs and consumes a fresh current-store admission");
uninstallHeadlessCurrentGraphContextProvider();

const projectRevision = graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project");
const worldmodel = graphCompilation.activeInteractionWorldmodel;
const witness = buildActiveInteractionWorldmodelCompilationWitness({ witnessId: "pm_compilation", graph, graphProjection: pmProjection, graphOdeuCompilation: graphCompilation, worldmodel, bootPacket: boot });
validateActiveInteractionWorldmodelCompilationWitness(witness);
assert.equal(witness.grantsAuthority, false);
expectThrows(() => validateActiveInteractionWorldmodelCompilationWitness({ ...witness, graphDigest: "sha256:tampered" }), "direct_manager_turn_context_digest_mismatch");
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: pmProjection, graphOdeuCompilation: graphCompilation, worldmodel, bootPacket: { ...boot, graphProjectionRef: { ...boot.graphProjectionRef, digest: "sha256:tampered" } } }), "direct_manager_turn_context_digest_mismatch");
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: { ...pmProjection, audienceAgentId: "wrong_agent" }, graphOdeuCompilation: graphCompilation, worldmodel, bootPacket: boot }), "direct_worldmodel_graph_projection_digest_mismatch");
const wrongAudienceProjection = { ...pmProjection, projectionId: "wrong_audience", audienceAgentId: "wrong_agent" };
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: wrongAudienceProjection, graphOdeuCompilation: graphCompilation, worldmodel, bootPacket: boot }), "direct_worldmodel_graph_projection_digest_mismatch");
const wrongScopeWorldmodel = buildActiveInteractionWorldmodel({ ...worldmodel, hierarchicalGraphProjectionRef: { ...worldmodel.hierarchicalGraphProjectionRef, scopeRevision: 99 } }, { now });
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: pmProjection, graphOdeuCompilation: graphCompilation, worldmodel: wrongScopeWorldmodel, bootPacket: boot }), "direct_manager_turn_context_compilation_mismatch");
const wrongFocalWorldmodel = buildActiveInteractionWorldmodel({ ...worldmodel, scope: { scopeKind: "global_user", userProfileId: "user_fixture" }, hierarchicalGraphProjectionRef: { ...worldmodel.hierarchicalGraphProjectionRef, scopeKind: "user_world", scopeRevision: graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "user_world").revision, scopeRevisionDigest: graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "user_world").digest } }, { now });
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: pmProjection, graphOdeuCompilation: graphCompilation, worldmodel: wrongFocalWorldmodel, bootPacket: boot }), "direct_manager_turn_context_compilation_mismatch");
expectThrows(() => buildActiveInteractionWorldmodelCompilationWitness({ graph, graphProjection: pmProjection, worldmodel, bootPacket: boot }), "direct_manager_turn_context_compilation_required");

console.log("direct-manager-turn-context-regression: ok");
