"use strict";

// Wave 26 PR 154 (manager-context half).  Manager turns are graph-first:
// dialogue and historic material travel only as typed, bounded references.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const { isPlainObject, normalizeId, normalizeString } = require("../meta-session/ids");
const { validateTranscriptInspectionArtifact } = require("./semantic-ingress");
const { validateWorldmodelIngressEnvelope } = require("./semantic-ingress");
const { buildActiveInteractionWorldmodel, validateActiveInteractionWorldmodel } = require("./kernel");
const { validateHierarchicalWorldmodelGraph } = require("./hierarchical-graph");
const { validateWorldmodelGraphProjection, admitWorldmodelGraphProjectionAgainstContext } = require("./graph-projection");
const { validateWorldmodelManagerProfile } = require("./manager");
const { validateProjectManagerProfile } = require("./project-manager");

const DIRECT_MANAGER_DIALOGUE_FRAME_SCHEMA = "direct_manager_dialogue_frame@1";
const DIRECT_MANAGER_TURN_BOOT_PACKET_SCHEMA = "direct_manager_turn_boot_packet@1";
const DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_ADAPTER_SCHEMA = "direct_manager_graph_first_context_adapter@1";
const DIRECT_ACTIVE_INTERACTION_WORLDMODEL_COMPILATION_WITNESS_SCHEMA = "direct_active_interaction_worldmodel_compilation_witness@1";
const DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_POLICY = "direct_manager_graph_first_context@1";
const DIRECT_GRAPH_ODEU_COMPILATION_SCHEMA = "direct_graph_odeu_compilation@1";
const MANAGER_ROLES = Object.freeze(["world_manager", "project_manager"]);
const EXPIRIES = Object.freeze(["next_turn", "decision_closed", "session"]);
const DIGEST_FIELDS = new Set(["digest", "adapterDigest", "witnessDigest"]);

function fail(code, detail = "") { const error = new Error(detail ? `${code}:${detail}` : code); error.code = code; throw error; }
function object(value, label) { if (!isPlainObject(value)) fail("direct_manager_turn_context_invalid_object", label); return value; }
function required(value, label) { const text = normalizeString(value, ""); if (!text) fail("direct_manager_turn_context_missing_string", label); return text; }
function list(value, label) { if (!Array.isArray(value)) fail("direct_manager_turn_context_missing_array", label); return value; }
// Only the artifact's own computed digest is excluded.  Nested typed-ref
// digests are identity-bearing data and must remain covered by the signature.
function stable(value, nested = false) { if (Array.isArray(value)) return value.map((entry) => stable(entry, true)); if (!isPlainObject(value)) return value; return Object.keys(value).sort().reduce((out, key) => { if ((!nested && DIGEST_FIELDS.has(key)) || typeof value[key] === "undefined") return out; out[key] = stable(value[key], true); return out; }, {}); }
function digest(domain, value) { return sha256(`${domain}\0${canonicalJson(stable(value), { omitDigestFields: false })}`); }
function checkDigest(value, field, domain, label) { if (required(value[field], `${label}.${field}`) !== digest(domain, value)) fail("direct_manager_turn_context_digest_mismatch", label); }

function exactKeys(value, allowed, label) { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("direct_manager_turn_context_unknown_field", `${label}.${key}`); }
function rejectRaw(value, label, skipped = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (skipped.has(value)) return;
  if (Array.isArray(value)) { value.forEach((entry, index) => rejectRaw(entry, `${label}.${index}`, skipped)); return; }
  object(value, label);
  for (const [key, entry] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if ((/(raw|transcript|message|excerpt|body|content|history)/.test(lowered) || lowered === "text" || lowered === "context_recent_dialogue") && entry !== false && entry !== "" && typeof entry !== "undefined") fail("direct_manager_turn_context_raw_state_forbidden", `${label}.${key}`);
    if (/(grant|authority|permission|can|may|allow|execute|write|mutat)/.test(lowered) && entry === true) fail("direct_manager_turn_context_authority_boundary", `${label}.${key}`);
    rejectRaw(entry, `${label}.${key}`, skipped);
  }
}

function typedRef(input = {}, fallbackKind = "worldmodel_artifact") {
  const source = isPlainObject(input) ? input : {};
  rejectRaw(source, "ref");
  return { kind: required(source.kind || fallbackKind, "ref.kind"), id: required(source.id || source.sourceId || source.artifactId || source.nodeId, "ref.id"), digest: required(source.digest || source.sourceDigest?.value || source.artifactDigest, "ref.digest"), rawTextIncluded: false, grantsAuthority: false };
}
function validateTypedRef(value, label, expectedKind = "") {
  exactKeys(value, ["kind", "id", "digest", "rawTextIncluded", "grantsAuthority"], label); if (expectedKind && value.kind !== expectedKind) fail("direct_manager_turn_context_ref_kind_mismatch", label);
  required(value.kind, `${label}.kind`); required(value.id, `${label}.id`); const valueDigest = required(value.digest, `${label}.digest`); if (!valueDigest.startsWith("sha256:")) fail("direct_manager_turn_context_ref_digest", label);
  if (value.rawTextIncluded !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_ref_boundary", label); rejectRaw(value, label); return true;
}
function sortedUniqueRefs(values, label) { const refs = values.sort((left, right) => `${left.kind}:${left.id}:${left.digest}`.localeCompare(`${right.kind}:${right.id}:${right.digest}`)); for (let index = 1; index < refs.length; index += 1) if (`${refs[index - 1].kind}:${refs[index - 1].id}:${refs[index - 1].digest}` === `${refs[index].kind}:${refs[index].id}:${refs[index].digest}`) fail("direct_manager_turn_context_duplicate_ref", label); return refs; }
function typedRefs(values, label, kind) { return sortedUniqueRefs(list(values || [], label).map((value) => typedRef(value, kind)), label); }
function validateTypedRefs(values, label, kind = "") { list(values, label).forEach((ref, index) => validateTypedRef(ref, `${label}.${index}`, kind)); const canonical = [...values].sort((left, right) => `${left.kind}:${left.id}:${left.digest}`.localeCompare(`${right.kind}:${right.id}:${right.digest}`)); if (canonical.some((ref, index) => ref !== values[index])) fail("direct_manager_turn_context_ref_order", label); sortedUniqueRefs([...values], label); return true; }

function projectionRef(projection) {
  validateWorldmodelGraphProjection(projection);
  return typedRef({ kind: "worldmodel_graph_projection", id: projection.projectionId, digest: projection.projectionDigest });
}
function ingressRef(ingress) {
  validateWorldmodelIngressEnvelope(ingress);
  return typedRef({ kind: "worldmodel_ingress", id: ingress.ingressId, digest: ingress.digest });
}
function profileIdentity(profile) {
  object(profile, "profileSnapshot");
  if (profile.schema === "odeu_worldmodel_manager_profile@1") { validateWorldmodelManagerProfile(profile); return { id: profile.managerProfileId, digest: profile.profileDigest, agentId: profile.managerAgentId, role: "world_manager" }; }
  if (profile.schema === "direct_project_manager_profile@1") { validateProjectManagerProfile(profile); return { id: profile.projectManagerProfileId, digest: profile.profileDigest, agentId: profile.projectManagerAgentId, role: "project_manager" }; }
  fail("direct_manager_turn_context_invalid_profile_snapshot", "profileSnapshot");
}
function profileRef(profile) { const identity = profileIdentity(profile); return typedRef({ kind: "manager_profile_snapshot", id: identity.id, digest: identity.digest }); }
function dialogueFrameRef(frame) { validateManagerDialogueFrame(frame); return typedRef({ kind: "manager_dialogue_frame", id: frame.dialogueFrameId, digest: frame.digest }); }
function inspectionRef(artifact) {
  validateTranscriptInspectionArtifact(artifact);
  return typedRef({ kind: "transcript_inspection_artifact", id: artifact.inspectionId, digest: artifact.digest });
}

function projectionContextAdmission(graph, projection, profile, policy, authoritySourceRef, governance = {}) {
  // Graph-first manager context is intentionally an authoritative-read path.
  // Do not let an adapter validate a portable graph/projection pair with a
  // request-supplied registry or a stale admission receipt.
  if (!graph?.trustAnchorRef) fail("direct_manager_turn_context_trust_anchor_required", "graph");
  if (!governance.trustStore) fail("direct_manager_turn_context_trust_store_required", "graph");
  if (!governance.storeAdmission) fail("direct_manager_turn_context_store_admission_required", "graph");
  let authoritative;
  try {
    authoritative = require("./governance-trust-store").readAuthoritativeWorldmodelGraph(governance.trustStore, graph);
  } catch (cause) {
    fail(cause?.code || "direct_manager_turn_context_trust_store_readback_invalid", "graph");
  }
  if (authoritative.graph.digest !== graph.digest) fail("direct_manager_turn_context_current_graph_mismatch", graph.graphId);
  validateHierarchicalWorldmodelGraph(graph); validateWorldmodelGraphProjection(projection); const identity = profileIdentity(profile); const receipt = admitWorldmodelGraphProjectionAgainstContext(projection, { graph, policy, managerProfile: profile, authoritySourceRef, authorityDecision: governance.authorityDecision, governanceRegistry: governance.governanceRegistry, registryRef: governance.registryRef, expectedRegistryRevision: governance.expectedRegistryRevision, projectRootNodeId: governance.projectRootNodeId, trustStore: governance.trustStore, storeAdmission: governance.storeAdmission }); const policyRef = typedRef({ kind: "graph_projection_policy", id: policy.policyId, digest: policy.policyDigest }, "graph_projection_policy");
  if (projection.audienceRole !== identity.role || projection.audienceAgentId !== identity.agentId) fail("direct_manager_turn_context_projection_profile_mismatch", "projection/profile");
  if (profile.schema === "direct_project_manager_profile@1" && (projection.focalScope.scopeKind !== "project" || projection.focalScope.projectId !== profile.projectId || !graph.nodes.some((node) => node.nodeId === profile.projectRootNodeId && node.scope.projectId === profile.projectId))) fail("direct_manager_turn_context_project_closure_mismatch", "projectProfile/projection");
  const selected = [...projection.selectedNodeRefs, ...projection.selectedEdgeRefs]; const keys = selected.map((ref) => `${ref.kind}:${ref.id}:${ref.digest}`); if (new Set(keys).size !== keys.length) fail("direct_manager_turn_context_duplicate_compilation_ref", "projection");
  for (const ref of projection.selectedNodeRefs) if (!graph.nodes.some((node) => node.nodeId === ref.id && node.digest === ref.digest)) fail("direct_manager_turn_context_projection_graph_mismatch", ref.id);
  for (const ref of projection.selectedEdgeRefs) if (!graph.edges.some((edge) => edge.edgeId === ref.id && edge.digest === ref.digest)) fail("direct_manager_turn_context_projection_graph_mismatch", ref.id);
  const focalRevision = projection.sourceScopeRevisions.find((ref) => ref.scopeKind === projection.focalScope.scopeKind && ref.projectId === projection.focalScope.projectId && ref.workThreadId === projection.focalScope.workThreadId);
  if (!focalRevision || !graph.scopedRevisionRefs.some((ref) => ref.digest === focalRevision.digest)) fail("direct_manager_turn_context_projection_revision_mismatch", "projection");
  return { identity, policyRef, focalRevision, receipt, storeAdmissionRef: typedRef({ kind: "worldmodel_store_admission", id: governance.storeAdmission.admissionId, digest: governance.storeAdmission.digest }, "worldmodel_store_admission") };
}
function laneForGraphRef(graph, ref) { if (ref.kind === "worldmodel_semantic_edge") return "D"; const node = graph.nodes.find((entry) => entry.nodeId === ref.id); if (["environment_binding", "agent_profile_binding"].includes(node.nodeKind)) return "E"; if (["policy", "constraint", "principle", "invariant"].includes(node.nodeKind)) return "U"; if (["decision", "procedure", "work_thread_summary"].includes(node.nodeKind)) return "D"; return "O"; }
function activeInteractionScope(projection, graph) { const focal = projection.focalScope; return { scopeKind: focal.scopeKind === "user_world" ? "global_user" : focal.scopeKind, userProfileId: graph.userProfileId, ...(focal.projectId ? { projectId: focal.projectId } : {}), ...(focal.workThreadId ? { workThreadId: focal.workThreadId } : {}) }; }
function activeInteractionEntry(graph, entry, observedAt) { const node = entry.ref.kind === "worldmodel_semantic_node" ? graph.nodes.find((candidate) => candidate.nodeId === entry.ref.id) : null; const edge = entry.ref.kind === "worldmodel_semantic_edge" ? graph.edges.find((candidate) => candidate.edgeId === entry.ref.id) : null; return { entryId: `graph_${entry.ref.kind}_${entry.ref.id}`, statement: node?.semanticSummary || `${edge?.relationKind || "graph"} relation ${entry.ref.id}`, posture: "accepted", sourceRefs: [{ sourceRefId: `graph_${entry.ref.kind}_${entry.ref.id}`, sourceKind: "family_specific", sourceId: `${entry.ref.kind}:${entry.ref.id}`, sourceDigest: { algorithm: "sha256", value: entry.ref.digest }, sourceConfidence: "exact", freshness: "fresh", observedAt }] }; }
function compileActiveInteractionWorldmodel(input, graph, projection, identity, laneEntries, focalRevision) {
  const compiledAt = normalizeString(input.compiledAt || input.createdAt, "1970-01-01T00:00:00.000Z");
  const sections = { O: [], E: [], D: [], U: [] };
  laneEntries.forEach((entry) => sections[entry.laneKey].push(activeInteractionEntry(graph, entry, compiledAt)));
  return buildActiveInteractionWorldmodel({ worldmodelId: `${normalizeId(input.compilationId || input.id, "graph_odeu_compilation")}_active_interaction`, managerAgentId: identity.agentId, revision: 1, scope: activeInteractionScope(projection, graph), createdAt: compiledAt, updatedAt: compiledAt, hierarchicalGraphProjectionRef: { graphId: graph.graphId, graphDigest: graph.digest, scopeKind: focalRevision.scopeKind, scopeRevision: focalRevision.revision, scopeRevisionDigest: focalRevision.digest }, task: { status: "complete", O: { entries: sections.O }, E: { entries: sections.E }, D: { entries: sections.D }, U: { entries: sections.U } } });
}
function buildGraphOdeuCompilation(input = {}) {
  object(input, "graphOdeuCompilation.input"); rejectRaw(input, "graphOdeuCompilation.input", new Set([input.graph, input.graphProjection, input.profileSnapshot || input.profile, input.governanceRegistry])); const graph = input.graph; const projection = input.graphProjection; const profile = input.profileSnapshot || input.profile; const admitted = projectionContextAdmission(graph, projection, profile, input.policy, input.authoritySourceRef, input);
  if (input.auditProjection === true || projection.auditMode === true || projection.contextClass === "audit_history") fail("direct_manager_turn_context_audit_projection_forbidden", "projection");
  const refs = [...projection.selectedNodeRefs, ...projection.selectedEdgeRefs]; if (!refs.length) fail("direct_manager_turn_context_empty_compilation", "projection"); const laneEntries = refs.map((ref) => ({ laneKey: laneForGraphRef(graph, ref), ref: typedRef(ref, ref.kind), lineage: { graphId: graph.graphId, graphDigest: graph.digest, projectionId: projection.projectionId, projectionDigest: projection.projectionDigest } })).sort((a, b) => `${a.laneKey}:${a.ref.kind}:${a.ref.id}`.localeCompare(`${b.laneKey}:${b.ref.kind}:${b.ref.id}`));
  const activeInteractionWorldmodel = compileActiveInteractionWorldmodel(input, graph, projection, admitted.identity, laneEntries, admitted.focalRevision);
  const result = { schema: DIRECT_GRAPH_ODEU_COMPILATION_SCHEMA, compilationId: normalizeId(input.compilationId || input.id, "graph_odeu_compilation"), graphRef: { graphId: graph.graphId, graphDigest: graph.digest }, projectionRef: projectionRef(projection), profileRef: profileRef(profile), policyRef: admitted.policyRef, storeAdmissionRef: admitted.storeAdmissionRef, focalScope: projection.focalScope, focalRevision: admitted.focalRevision, laneEntries, activeInteractionWorldmodel, lawfulOmissionRefs: typedRefs(input.lawfulOmissionRefs, "graphOdeuCompilation.lawfulOmissionRefs", "worldmodel_projection_omission"), rawTextIncluded: false, grantsAuthority: false };
  result.digest = digest("direct-graph-odeu-compilation@1", result); validateGraphOdeuCompilation(result); return result;
}
function validateGraphOdeuCompilation(value, label = "graphOdeuCompilation") {
  exactKeys(value, ["schema", "compilationId", "graphRef", "projectionRef", "profileRef", "policyRef", "storeAdmissionRef", "focalScope", "focalRevision", "laneEntries", "activeInteractionWorldmodel", "lawfulOmissionRefs", "rawTextIncluded", "grantsAuthority", "digest"], label); if (value.schema !== DIRECT_GRAPH_ODEU_COMPILATION_SCHEMA) fail("direct_manager_turn_context_schema_mismatch", label); required(value.compilationId, `${label}.compilationId`); required(value.graphRef?.graphId, `${label}.graphRef.graphId`); required(value.graphRef?.graphDigest, `${label}.graphRef.graphDigest`); validateTypedRef(value.projectionRef, `${label}.projectionRef`, "worldmodel_graph_projection"); validateTypedRef(value.profileRef, `${label}.profileRef`, "manager_profile_snapshot"); validateTypedRef(value.policyRef, `${label}.policyRef`, "graph_projection_policy"); validateTypedRef(value.storeAdmissionRef, `${label}.storeAdmissionRef`, "worldmodel_store_admission"); list(value.laneEntries, `${label}.laneEntries`).forEach((entry, index) => { exactKeys(entry, ["laneKey", "ref", "lineage"], `${label}.laneEntries.${index}`); if (!["O", "E", "D", "U"].includes(entry.laneKey)) fail("direct_manager_turn_context_invalid_lane", `${label}.laneEntries.${index}`); validateTypedRef(entry.ref, `${label}.laneEntries.${index}.ref`); if (entry.lineage?.graphId !== value.graphRef.graphId || entry.lineage?.graphDigest !== value.graphRef.graphDigest || entry.lineage?.projectionId !== value.projectionRef.id || entry.lineage?.projectionDigest !== value.projectionRef.digest) fail("direct_manager_turn_context_compilation_mismatch", `${label}.laneEntries.${index}`); }); const refs = value.laneEntries.map((entry) => `${entry.ref.kind}:${entry.ref.id}:${entry.ref.digest}`); if (!refs.length || new Set(refs).size !== refs.length) fail("direct_manager_turn_context_compilation_accounting", label); validateActiveInteractionWorldmodel(value.activeInteractionWorldmodel); const compiledEntries = ["O", "E", "D", "U"].flatMap((sectionKey) => value.activeInteractionWorldmodel.task[sectionKey].entries).flatMap((entry) => entry.sourceRefs || []).map((ref) => ref.sourceId).sort(); const expectedEntries = value.laneEntries.map((entry) => `${entry.ref.kind}:${entry.ref.id}`).sort(); if (compiledEntries.length !== expectedEntries.length || compiledEntries.some((ref, index) => ref !== expectedEntries[index])) fail("direct_manager_turn_context_compilation_accounting", `${label}.activeInteractionWorldmodel`); validateTypedRefs(value.lawfulOmissionRefs, `${label}.lawfulOmissionRefs`, "worldmodel_projection_omission"); if (value.rawTextIncluded !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); checkDigest(value, "digest", "direct-graph-odeu-compilation@1", label); return true;
}

function buildManagerDialogueFrame(input = {}) {
  object(input, "managerDialogueFrame.input"); rejectRaw(input, "managerDialogueFrame.input");
  const role = required(input.managerRole, "managerDialogueFrame.managerRole"); if (!MANAGER_ROLES.includes(role)) fail("direct_manager_turn_context_invalid_role", role);
  const managerAgentId = required(input.managerAgentId, "managerDialogueFrame.managerAgentId");
  if (!Object.prototype.hasOwnProperty.call(input, "expiresAfter") || !EXPIRIES.includes(input.expiresAfter)) fail("direct_manager_turn_context_invalid_expiry", "managerDialogueFrame.expiresAfter");
  const result = {
    schema: DIRECT_MANAGER_DIALOGUE_FRAME_SCHEMA,
    dialogueFrameId: normalizeId(input.dialogueFrameId || input.id, "manager_dialogue_frame"),
    managerAgentId: normalizeId(managerAgentId, "manager_agent"),
    managerRole: role,
    activeProjectRefs: typedRefs(input.activeProjectRefs, "managerDialogueFrame.activeProjectRefs", "project"),
    activeTopicNodeRefs: typedRefs(input.activeTopicNodeRefs, "managerDialogueFrame.activeTopicNodeRefs", "worldmodel_semantic_node"),
    pendingDecisionRefs: typedRefs(input.pendingDecisionRefs, "managerDialogueFrame.pendingDecisionRefs", "worldmodel_decision"),
    pendingClarificationRefs: typedRefs(input.pendingClarificationRefs, "managerDialogueFrame.pendingClarificationRefs", "worldmodel_clarification"),
    userRoleStateRef: typedRef(input.userRoleStateRef, "user_role_state"),
    expiresAfter: input.expiresAfter,
    sourceRefs: typedRefs(input.sourceRefs, "managerDialogueFrame.sourceRefs", "source"),
    rawTranscriptIncluded: false,
    grantsAuthority: false,
  };
  result.digest = digest("direct-manager-dialogue-frame@1", result); validateManagerDialogueFrame(result); return result;
}
function validateManagerDialogueFrame(value, label = "managerDialogueFrame") {
  exactKeys(value, ["schema", "dialogueFrameId", "managerAgentId", "managerRole", "activeProjectRefs", "activeTopicNodeRefs", "pendingDecisionRefs", "pendingClarificationRefs", "userRoleStateRef", "expiresAfter", "sourceRefs", "rawTranscriptIncluded", "grantsAuthority", "digest"], label); if (value.schema !== DIRECT_MANAGER_DIALOGUE_FRAME_SCHEMA) fail("direct_manager_turn_context_schema_mismatch", label);
  required(value.dialogueFrameId, `${label}.dialogueFrameId`); required(value.managerAgentId, `${label}.managerAgentId`); if (!MANAGER_ROLES.includes(value.managerRole)) fail("direct_manager_turn_context_invalid_role", `${label}.managerRole`);
  validateTypedRefs(value.activeProjectRefs, `${label}.activeProjectRefs`, "project"); validateTypedRefs(value.activeTopicNodeRefs, `${label}.activeTopicNodeRefs`, "worldmodel_semantic_node"); validateTypedRefs(value.pendingDecisionRefs, `${label}.pendingDecisionRefs`, "worldmodel_decision"); validateTypedRefs(value.pendingClarificationRefs, `${label}.pendingClarificationRefs`, "worldmodel_clarification"); validateTypedRef(value.userRoleStateRef, `${label}.userRoleStateRef`, "user_role_state");
  if (!EXPIRIES.includes(value.expiresAfter)) fail("direct_manager_turn_context_invalid_expiry", `${label}.expiresAfter`); validateTypedRefs(value.sourceRefs, `${label}.sourceRefs`);
  if (value.rawTranscriptIncluded !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); rejectRaw(value, label); checkDigest(value, "digest", "direct-manager-dialogue-frame@1", label); return true;
}

function normalizedInspectionRefs(input) {
  const artifacts = input.targetedEvidenceInspectionArtifacts || input.inspectionArtifacts || [];
  if (!Array.isArray(artifacts)) fail("direct_manager_turn_context_missing_array", "targetedEvidenceInspectionArtifacts");
  const built = artifacts.map(inspectionRef);
  const supplied = input.targetedEvidenceInspectionRefs || [];
  if (!Array.isArray(supplied)) fail("direct_manager_turn_context_missing_array", "targetedEvidenceInspectionRefs");
  const builtKeys = new Set(built.map((ref) => `${ref.kind}:${ref.id}:${ref.digest}`));
  const external = supplied.map((ref) => typedRef(ref, "transcript_inspection_artifact"));
  external.forEach((ref) => { if (!builtKeys.has(`${ref.kind}:${ref.id}:${ref.digest}`)) fail("direct_manager_turn_context_unvalidated_inspection_ref", ref.id); });
  return sortedUniqueRefs(built, "targetedEvidenceInspectionRefs");
}
function buildTargetedEvidenceDrilldown(input = {}) {
  object(input, "targetedEvidenceDrilldown.input"); rejectRaw(input, "targetedEvidenceDrilldown.input", new Set([...(input.targetedEvidenceInspectionArtifacts || []), ...(input.inspectionArtifacts || [])]));
  const inspectionRefs = normalizedInspectionRefs(input);
  const result = { schema: "direct_targeted_evidence_drilldown@1", drilldownId: normalizeId(input.drilldownId || input.id, "targeted_evidence_drilldown"), inspectionRefs, omittedInspectionCount: Number.isInteger(input.omittedInspectionCount) && input.omittedInspectionCount >= 0 ? input.omittedInspectionCount : 0, rawTextIncluded: false, historicalInstructionAuthorityGranted: false, contextMutationGranted: false, grantsAuthority: false };
  result.digest = digest("direct-targeted-evidence-drilldown@1", result); validateTargetedEvidenceDrilldown(result); return result;
}
function validateTargetedEvidenceDrilldown(value, label = "targetedEvidenceDrilldown") {
  exactKeys(value, ["schema", "drilldownId", "inspectionRefs", "omittedInspectionCount", "rawTextIncluded", "historicalInstructionAuthorityGranted", "contextMutationGranted", "grantsAuthority", "digest"], label); if (value.schema !== "direct_targeted_evidence_drilldown@1") fail("direct_manager_turn_context_schema_mismatch", label); required(value.drilldownId, `${label}.drilldownId`); validateTypedRefs(value.inspectionRefs, `${label}.inspectionRefs`, "transcript_inspection_artifact"); if (!Number.isInteger(value.omittedInspectionCount) || value.omittedInspectionCount < 0) fail("direct_manager_turn_context_invalid_omission_count", label); if (value.rawTextIncluded !== false || value.historicalInstructionAuthorityGranted !== false || value.contextMutationGranted !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); rejectRaw(value, label); checkDigest(value, "digest", "direct-targeted-evidence-drilldown@1", label); return true;
}

function buildManagerTurnBootPacket(input = {}) {
  object(input, "managerTurnBootPacket.input"); const projection = input.graphProjection; const profile = input.profileSnapshot || input.profile; const ingress = input.currentIngress; const frame = input.dialogueFrame; const artifacts = input.targetedEvidenceInspectionArtifacts || input.inspectionArtifacts || []; rejectRaw(input, "managerTurnBootPacket.input", new Set([projection, profile, ingress, frame, ...artifacts]));
  const role = required(input.managerRole, "managerTurnBootPacket.managerRole"); if (!MANAGER_ROLES.includes(role)) fail("direct_manager_turn_context_invalid_role", role);
  const agentId = normalizeId(required(input.managerAgentId, "managerTurnBootPacket.managerAgentId"), "manager_agent");
  if (!projection || !profile || !ingress) fail("direct_manager_turn_context_artifact_required", "graphProjection/profileSnapshot/currentIngress");
  const graphProjectionRef = projectionRef(projection); const profileSnapshotRef = profileRef(profile); const currentIngressRef = ingressRef(ingress);
  if (projection.audienceRole !== role || projection.audienceAgentId !== agentId) fail("direct_manager_turn_context_role_agent_mismatch", "graphProjection");
  { const identity = profileIdentity(profile); if (identity.role !== role || identity.agentId !== agentId) fail("direct_manager_turn_context_role_agent_mismatch", "profileSnapshot"); }
  if (ingress.receivedByRole !== role || ingress.receivedByAgentId !== agentId) fail("direct_manager_turn_context_role_agent_mismatch", "currentIngress");
  let frameRef;
  if (input.dialogueFrame) { if (input.dialogueFrame.managerRole !== role || input.dialogueFrame.managerAgentId !== agentId) fail("direct_manager_turn_context_role_agent_mismatch", "dialogueFrame"); frameRef = dialogueFrameRef(input.dialogueFrame); }
  else if (input.dialogueFrameRef) frameRef = typedRef(input.dialogueFrameRef, "manager_dialogue_frame");
  const result = {
    schema: DIRECT_MANAGER_TURN_BOOT_PACKET_SCHEMA, bootPacketId: normalizeId(input.bootPacketId || input.id, "manager_turn_boot_packet"), managerRole: role, managerAgentId: agentId, graphProjectionRef, profileSnapshotRef,
    ...(frameRef ? { dialogueFrameRef: frameRef } : {}), openDecisionRefs: typedRefs(input.openDecisionRefs, "managerTurnBootPacket.openDecisionRefs", "worldmodel_decision"), openRemandRefs: typedRefs(input.openRemandRefs, "managerTurnBootPacket.openRemandRefs", "worldmodel_remand"), changesSincePreviousTurnRefs: typedRefs(input.changesSincePreviousTurnRefs, "managerTurnBootPacket.changesSincePreviousTurnRefs", "worldmodel_change"), currentIngressRef,
    targetedEvidenceInspectionRefs: normalizedInspectionRefs(input), historicalTranscriptIncluded: false, rawUnrelatedProjectStateIncluded: false, grantsAuthority: false,
  };
  result.digest = digest("direct-manager-turn-boot-packet@1", result); validateManagerTurnBootPacket(result); return result;
}
function validateManagerTurnBootPacket(value, label = "managerTurnBootPacket") {
  exactKeys(value, ["schema", "bootPacketId", "managerRole", "managerAgentId", "graphProjectionRef", "profileSnapshotRef", "dialogueFrameRef", "openDecisionRefs", "openRemandRefs", "changesSincePreviousTurnRefs", "currentIngressRef", "targetedEvidenceInspectionRefs", "historicalTranscriptIncluded", "rawUnrelatedProjectStateIncluded", "grantsAuthority", "digest"], label); if (value.schema !== DIRECT_MANAGER_TURN_BOOT_PACKET_SCHEMA) fail("direct_manager_turn_context_schema_mismatch", label); required(value.bootPacketId, `${label}.bootPacketId`); if (!MANAGER_ROLES.includes(value.managerRole)) fail("direct_manager_turn_context_invalid_role", `${label}.managerRole`); required(value.managerAgentId, `${label}.managerAgentId`); validateTypedRef(value.graphProjectionRef, `${label}.graphProjectionRef`, "worldmodel_graph_projection"); validateTypedRef(value.profileSnapshotRef, `${label}.profileSnapshotRef`, "manager_profile_snapshot"); if (value.dialogueFrameRef) validateTypedRef(value.dialogueFrameRef, `${label}.dialogueFrameRef`, "manager_dialogue_frame"); validateTypedRefs(value.openDecisionRefs, `${label}.openDecisionRefs`, "worldmodel_decision"); validateTypedRefs(value.openRemandRefs, `${label}.openRemandRefs`, "worldmodel_remand"); validateTypedRefs(value.changesSincePreviousTurnRefs, `${label}.changesSincePreviousTurnRefs`, "worldmodel_change"); validateTypedRef(value.currentIngressRef, `${label}.currentIngressRef`, "worldmodel_ingress"); validateTypedRefs(value.targetedEvidenceInspectionRefs, `${label}.targetedEvidenceInspectionRefs`, "transcript_inspection_artifact"); if (value.historicalTranscriptIncluded !== false || value.rawUnrelatedProjectStateIncluded !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); rejectRaw(value, label); checkDigest(value, "digest", "direct-manager-turn-boot-packet@1", label); return true;
}
function admitManagerTurnBootPacket(input = {}) {
  object(input, "managerTurnBootAdmission.input"); const boot = input.bootPacket; const graph = input.graph; const projection = input.graphProjection; const profile = input.profileSnapshot || input.profile; const ingress = input.currentIngress; validateManagerTurnBootPacket(boot); validateWorldmodelIngressEnvelope(ingress); const admitted = projectionContextAdmission(graph, projection, profile, input.policy, input.authoritySourceRef, input);
  if (boot.graphProjectionRef.id !== projection.projectionId || boot.graphProjectionRef.digest !== projection.projectionDigest || boot.profileSnapshotRef.id !== admitted.identity.id || boot.profileSnapshotRef.digest !== admitted.identity.digest || boot.currentIngressRef.id !== ingress.ingressId || boot.currentIngressRef.digest !== ingress.digest) fail("direct_manager_turn_context_boot_context_mismatch", "boot");
  if (ingress.receivedByRole !== boot.managerRole || ingress.receivedByAgentId !== boot.managerAgentId || (projection.focalScope.projectId && !ingress.declaredScopeHints.some((scope) => scope.projectId === projection.focalScope.projectId))) fail("direct_manager_turn_context_boot_context_mismatch", "ingress");
  const inspections = input.targetedEvidenceInspectionArtifacts || []; if (!Array.isArray(inspections) || inspections.length !== boot.targetedEvidenceInspectionRefs.length) fail("direct_manager_turn_context_boot_context_mismatch", "inspections"); inspections.forEach((artifact) => { validateTranscriptInspectionArtifact(artifact); if (artifact.evidenceRef.projectId !== projection.focalScope.projectId || !boot.targetedEvidenceInspectionRefs.some((ref) => ref.id === artifact.inspectionId && ref.digest === artifact.digest)) fail("direct_manager_turn_context_boot_context_mismatch", "inspection"); });
  if (boot.dialogueFrameRef) {
    if (!input.dialogueFrame) fail("direct_manager_turn_context_boot_context_mismatch", "dialogueFrame");
    validateManagerDialogueFrame(input.dialogueFrame);
    if (input.dialogueFrame.dialogueFrameId !== boot.dialogueFrameRef.id || input.dialogueFrame.digest !== boot.dialogueFrameRef.digest || input.dialogueFrame.managerAgentId !== boot.managerAgentId || input.dialogueFrame.managerRole !== boot.managerRole) fail("direct_manager_turn_context_boot_context_mismatch", "dialogueFrame");
  } else if (input.dialogueFrame) fail("direct_manager_turn_context_boot_context_mismatch", "dialogueFrame");
  return { bootPacketRef: bootRef(boot), graphRef: { graphId: graph.graphId, graphDigest: graph.digest }, projectionRef: projectionRef(projection), profileRef: profileRef(profile), policyRef: admitted.policyRef, storeAdmissionRef: admitted.storeAdmissionRef, focalRevision: admitted.focalRevision, granted: false };
}

function bootRef(boot) { validateManagerTurnBootPacket(boot); return typedRef({ kind: "manager_turn_boot_packet", id: boot.bootPacketId, digest: boot.digest }); }
function buildManagerGraphFirstContextAdapter(input = {}) {
  object(input, "managerGraphFirstContextAdapter.input"); const graphContext = input.graphContext; if (!isPlainObject(graphContext)) fail("direct_manager_turn_context_graph_context_required", "managerGraphFirstContextAdapter.graphContext"); rejectRaw(input, "managerGraphFirstContextAdapter.input", new Set([input.bootPacket, graphContext.graph, graphContext.graphProjection, graphContext.profileSnapshot || graphContext.profile, graphContext.currentIngress, graphContext.dialogueFrame, graphContext.governanceRegistry, ...(graphContext.targetedEvidenceInspectionArtifacts || [])])); const boot = input.bootPacket; validateManagerTurnBootPacket(boot);
  admitManagerTurnBootPacket({ bootPacket: boot, graph: graphContext.graph, graphProjection: graphContext.graphProjection, profileSnapshot: graphContext.profileSnapshot || graphContext.profile, policy: graphContext.policy, authoritySourceRef: graphContext.authoritySourceRef, authorityDecision: graphContext.authorityDecision, governanceRegistry: graphContext.governanceRegistry, registryRef: graphContext.registryRef, expectedRegistryRevision: graphContext.expectedRegistryRevision, projectRootNodeId: graphContext.projectRootNodeId, trustStore: graphContext.trustStore, storeAdmission: graphContext.storeAdmission, currentIngress: graphContext.currentIngress, targetedEvidenceInspectionArtifacts: graphContext.targetedEvidenceInspectionArtifacts || [], dialogueFrame: graphContext.dialogueFrame });
  const result = { schema: DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_ADAPTER_SCHEMA, adapterId: normalizeId(input.adapterId || input.id, "manager_graph_first_context_adapter"), contextPolicyId: DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_POLICY, managerRole: boot.managerRole, managerAgentId: boot.managerAgentId, bootPacketRef: bootRef(boot), graphProjectionRef: boot.graphProjectionRef, profileSnapshotRef: boot.profileSnapshotRef, currentIngressRef: boot.currentIngressRef, ...(boot.dialogueFrameRef ? { dialogueFrameRef: boot.dialogueFrameRef } : {}), targetedEvidenceInspectionRefs: boot.targetedEvidenceInspectionRefs, contextRecentDialogueIncluded: false, historicalTranscriptIncluded: false, grantsAuthority: false };
  result.adapterDigest = digest("direct-manager-graph-first-context-adapter@1", result); validateManagerGraphFirstContextAdapter(result); return result;
}
function validateManagerGraphFirstContextAdapter(value, label = "managerGraphFirstContextAdapter") {
  exactKeys(value, ["schema", "adapterId", "contextPolicyId", "managerRole", "managerAgentId", "bootPacketRef", "graphProjectionRef", "profileSnapshotRef", "currentIngressRef", "dialogueFrameRef", "targetedEvidenceInspectionRefs", "contextRecentDialogueIncluded", "historicalTranscriptIncluded", "grantsAuthority", "adapterDigest"], label); if (value.schema !== DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_ADAPTER_SCHEMA) fail("direct_manager_turn_context_schema_mismatch", label); required(value.adapterId, `${label}.adapterId`); if (value.contextPolicyId !== DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_POLICY) fail("direct_manager_turn_context_policy_mismatch", label); if (!MANAGER_ROLES.includes(value.managerRole)) fail("direct_manager_turn_context_invalid_role", label); required(value.managerAgentId, `${label}.managerAgentId`); validateTypedRef(value.bootPacketRef, `${label}.bootPacketRef`, "manager_turn_boot_packet"); validateTypedRef(value.graphProjectionRef, `${label}.graphProjectionRef`, "worldmodel_graph_projection"); validateTypedRef(value.profileSnapshotRef, `${label}.profileSnapshotRef`, "manager_profile_snapshot"); validateTypedRef(value.currentIngressRef, `${label}.currentIngressRef`, "worldmodel_ingress"); if (value.dialogueFrameRef) validateTypedRef(value.dialogueFrameRef, `${label}.dialogueFrameRef`, "manager_dialogue_frame"); validateTypedRefs(value.targetedEvidenceInspectionRefs, `${label}.targetedEvidenceInspectionRefs`, "transcript_inspection_artifact"); if (value.contextRecentDialogueIncluded !== false || value.historicalTranscriptIncluded !== false || value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); rejectRaw(value, label); checkDigest(value, "adapterDigest", "direct-manager-graph-first-context-adapter@1", label); return true;
}

function buildActiveInteractionWorldmodelCompilationWitness(input = {}) {
  object(input, "activeInteractionWorldmodelCompilationWitness.input"); const graph = input.graph; const projection = input.graphProjection; const compilation = input.graphOdeuCompilation; const worldmodel = input.worldmodel; const boot = input.bootPacket; rejectRaw(input, "activeInteractionWorldmodelCompilationWitness.input", new Set([graph, projection, compilation, worldmodel, boot]));
  if (!compilation) fail("direct_manager_turn_context_compilation_required", "graphOdeuCompilation");
  validateHierarchicalWorldmodelGraph(graph); validateWorldmodelGraphProjection(projection); validateGraphOdeuCompilation(compilation); validateActiveInteractionWorldmodel(worldmodel); validateManagerTurnBootPacket(boot);
  if (compilation.graphRef.graphId !== graph.graphId || compilation.graphRef.graphDigest !== graph.digest || compilation.projectionRef.id !== projection.projectionId || compilation.projectionRef.digest !== projection.projectionDigest || compilation.activeInteractionWorldmodel.worldmodelId !== worldmodel.worldmodelId || compilation.activeInteractionWorldmodel.digest !== worldmodel.digest) fail("direct_manager_turn_context_compilation_mismatch", "graphOdeuCompilation");
  if (boot.graphProjectionRef.id !== projection.projectionId || boot.graphProjectionRef.digest !== projection.projectionDigest) fail("direct_manager_turn_context_compilation_mismatch", "bootPacket.projection"); if (projection.audienceRole !== boot.managerRole || projection.audienceAgentId !== boot.managerAgentId || worldmodel.managerAgentId !== boot.managerAgentId) fail("direct_manager_turn_context_role_agent_mismatch", "projection/worldmodel");
  const graphRef = worldmodel.hierarchicalGraphProjectionRef; if (!graphRef || graphRef.graphId !== graph.graphId || graphRef.graphDigest !== graph.digest) fail("direct_manager_turn_context_compilation_mismatch", "worldmodel.graph");
  const worldScopeKind = worldmodel.scope.scopeKind === "global_user" ? "user_world" : worldmodel.scope.scopeKind; const scopeMatch = (scope) => scope.scopeKind === worldScopeKind && scope.projectId === worldmodel.scope.projectId && scope.workThreadId === worldmodel.scope.workThreadId;
  const focal = projection.focalScope; if (focal.scopeKind !== worldScopeKind || focal.projectId !== worldmodel.scope.projectId || focal.workThreadId !== worldmodel.scope.workThreadId) fail("direct_manager_turn_context_compilation_mismatch", "focalScope");
  const revision = projection.sourceScopeRevisions.filter(scopeMatch); if (revision.length !== 1 || graphRef.scopeKind !== revision[0].scopeKind || graphRef.scopeRevision !== revision[0].revision || graphRef.scopeRevisionDigest !== revision[0].digest) fail("direct_manager_turn_context_compilation_mismatch", "scopeRevision");
  const result = { schema: DIRECT_ACTIVE_INTERACTION_WORLDMODEL_COMPILATION_WITNESS_SCHEMA, witnessId: normalizeId(input.witnessId || input.id, "active_interaction_worldmodel_compilation_witness"), graphId: graph.graphId, graphDigest: graph.digest, projectionId: projection.projectionId, projectionDigest: projection.projectionDigest, compilationId: compilation.compilationId, compilationDigest: compilation.digest, worldmodelId: worldmodel.worldmodelId, worldmodelRevision: worldmodel.revision, worldmodelDigest: worldmodel.digest, bootPacketId: boot.bootPacketId, bootPacketDigest: boot.digest, grantsAuthority: false };
  result.witnessDigest = digest("direct-active-interaction-worldmodel-compilation-witness@1", result); validateActiveInteractionWorldmodelCompilationWitness(result); return result;
}
function validateActiveInteractionWorldmodelCompilationWitness(value, label = "activeInteractionWorldmodelCompilationWitness") {
  exactKeys(value, ["schema", "witnessId", "graphId", "graphDigest", "projectionId", "projectionDigest", "compilationId", "compilationDigest", "worldmodelId", "worldmodelRevision", "worldmodelDigest", "bootPacketId", "bootPacketDigest", "grantsAuthority", "witnessDigest"], label); if (value.schema !== DIRECT_ACTIVE_INTERACTION_WORLDMODEL_COMPILATION_WITNESS_SCHEMA) fail("direct_manager_turn_context_schema_mismatch", label); for (const key of ["witnessId", "graphId", "graphDigest", "projectionId", "projectionDigest", "compilationId", "compilationDigest", "worldmodelId", "worldmodelDigest", "bootPacketId", "bootPacketDigest"]) required(value[key], `${label}.${key}`); if (!Number.isInteger(value.worldmodelRevision) || value.worldmodelRevision < 1) fail("direct_manager_turn_context_invalid_revision", label); if (value.grantsAuthority !== false) fail("direct_manager_turn_context_authority_boundary", label); rejectRaw(value, label); checkDigest(value, "witnessDigest", "direct-active-interaction-worldmodel-compilation-witness@1", label); return true;
}

module.exports = {
  DIRECT_MANAGER_DIALOGUE_FRAME_SCHEMA,
  DIRECT_MANAGER_TURN_BOOT_PACKET_SCHEMA,
  DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_ADAPTER_SCHEMA,
  DIRECT_ACTIVE_INTERACTION_WORLDMODEL_COMPILATION_WITNESS_SCHEMA,
  DIRECT_MANAGER_GRAPH_FIRST_CONTEXT_POLICY,
  DIRECT_GRAPH_ODEU_COMPILATION_SCHEMA,
  buildGraphOdeuCompilation,
  validateGraphOdeuCompilation,
  buildManagerDialogueFrame,
  validateManagerDialogueFrame,
  buildManagerTurnBootPacket,
  validateManagerTurnBootPacket,
  admitManagerTurnBootPacket,
  buildTargetedEvidenceDrilldown,
  validateTargetedEvidenceDrilldown,
  buildManagerGraphFirstContextAdapter,
  validateManagerGraphFirstContextAdapter,
  buildActiveInteractionWorldmodelCompilationWitness,
  validateActiveInteractionWorldmodelCompilationWitness,
};
