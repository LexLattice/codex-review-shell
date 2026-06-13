"use strict";

const crypto = require("node:crypto");

const DIRECT_ROLE_HANDOFF_PACKET_SCHEMA = "direct_role_handoff_packet@1";
const DIRECT_ROLE_HANDOFF_PREVIEW_SCHEMA = "direct_role_handoff_preview@1";
const DIRECT_ROLE_HANDOFF_PACKET_VERSION = "direct-role-handoff-packet@1";

const ROUTE_TO_ROLE_STATUS = new Set([
  "operator_review_required",
  "blocked",
]);

const ACCEPTANCE_POSTURES = new Set([
  "operator_accept_required",
  "blocked",
]);

const ARTIFACT_FAMILY_BY_AGENT_KIND = Object.freeze({
  implementation_worker: "implementation_evidence_artifact",
  audit_worker: "audit_artifact",
  fix_worker: "fix_artifact",
  closeout_worker: "closeout_artifact",
  meta_orchestrator: "workflow_transition_artifact",
  work_thread_broker: "work_target_resolution",
  memory_compaction_worker: "memory_baton_omission_witness",
  governance_broker: "governance_shadow_packet",
  sub_agent_worker: "sub_agent_result_artifact",
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 360) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  }
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestFor(domain, value) {
  return `sha256:${sha256(`${domain}:${stableStringify(value)}`)}`;
}

function isoTimestamp(input) {
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString();
  const parsed = Date.parse(normalizeString(input, ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function compactEvidenceRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const artifactId = normalizeString(source.artifactId || source.id || source.refId, "");
  const artifactDigest = normalizeString(source.artifactDigest || source.digest || source.specDigest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    kind: normalizeString(source.kind, fallbackKind),
    artifactId,
    artifactDigest,
    sourceConfidence: normalizeString(source.sourceConfidence || source.confidence, "diagnostic"),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || source.label || fallbackKind, 120),
  };
}

function normalizeRefs(value, fallbackKind) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => compactEvidenceRef(entry, fallbackKind))
    .filter(Boolean);
}

function agentClassRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    agentClassId: normalizeString(source.agentClassId || source.id, ""),
    agentClassKind: normalizeString(source.agentClassKind || source.kind, ""),
    displayName: boundedString(source.displayName || source.name || source.agentClassKind || source.kind, 160),
    specDigest: normalizeString(source.specDigest || source.digest, ""),
    producedArtifactFamilies: Array.isArray(source.producedArtifactFamilies)
      ? source.producedArtifactFamilies.map((item) => normalizeString(item, "")).filter(Boolean)
      : [],
    consumedContextFamilies: Array.isArray(source.consumedContextFamilies)
      ? source.consumedContextFamilies.map((item) => normalizeString(item, "")).filter(Boolean)
      : [],
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
}

function workThreadRefFrom(input = {}, fallback = {}) {
  const source = isPlainObject(input) ? input : {};
  const fallbackSource = isPlainObject(fallback) ? fallback : {};
  return {
    workThreadId: normalizeString(source.workThreadId || source.id || fallbackSource.selectedWorkThreadId, ""),
    projectId: normalizeString(source.projectId || fallbackSource.projectId, ""),
    title: boundedString(source.title || source.displayTitle || "", 180),
    sourceDigest: normalizeString(source.workThreadDigest || source.sourceDigest || source.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
}

function targetResolutionRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    reportId: normalizeString(source.reportId || source.resolutionId || source.artifactId, ""),
    projectId: normalizeString(source.projectId, ""),
    selectedWorkThreadId: normalizeString(source.selectedWorkThreadId, ""),
    routingGateState: normalizeString(source.routingGateState, ""),
    reportDigest: normalizeString(source.reportDigest || source.artifactDigest || source.digest, ""),
    stale: source.stale === true,
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
}

function operatorBrokerResolutionRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    brokerResolutionId: normalizeString(source.brokerResolutionId || source.artifactId, ""),
    selectedWorkThreadId: normalizeString(source.selectedWorkThreadId, ""),
    routingGateState: normalizeString(source.routingGateState, ""),
    brokerResolutionDigest: normalizeString(source.brokerResolutionDigest || source.artifactDigest || source.digest, ""),
    stale: source.stale === true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function semanticPreflightRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    preflightId: normalizeString(source.preflightId || source.artifactId, ""),
    recommendationClass: normalizeString(source.recommendationClass, ""),
    selectedWorkThreadId: normalizeString(source.selectedWorkThreadId, ""),
    selectedCandidateId: normalizeString(source.selectedCandidateId, ""),
    selectedRouteKind: normalizeString(source.selectedRouteKind, ""),
    preflightDigest: normalizeString(source.integrity?.artifactDigest || source.artifactDigest || source.preflightDigest || source.sourceDigest, ""),
    stale: source.stale === true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function defaultOutputArtifactFamily(agentClassRef = {}) {
  const kind = normalizeString(agentClassRef.agentClassKind, "");
  if (Array.isArray(agentClassRef.producedArtifactFamilies) && agentClassRef.producedArtifactFamilies.length) {
    return agentClassRef.producedArtifactFamilies[0];
  }
  return ARTIFACT_FAMILY_BY_AGENT_KIND[kind] || "role_output_artifact";
}

function authorityBoundarySummary(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    summary: boundedString(source.summary || source.rendererSafeSummary || "Role handoff is display-only until an explicit later transition grants execution authority.", 420),
    forbiddenActions: Array.isArray(source.forbiddenActions)
      ? source.forbiddenActions.map((item) => boundedString(item, 160)).filter(Boolean)
      : [
          "provider_call_from_handoff_packet",
          "worker_spawn_from_handoff_packet",
          "object_audit_from_handoff_packet",
          "workspace_mutation_from_handoff_packet",
        ],
    providerCallAllowed: false,
    workerSpawnAllowed: false,
    objectAuditAllowed: false,
    workspaceMutationAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function packetBlockers({ semanticPreflight, agentClassRef, workThreadRef, targetResolutionRef }) {
  const blockers = [];
  if (semanticPreflight.recommendationClass !== "route_to_role") blockers.push("preflight_not_route_to_role");
  if (semanticPreflight.stale) blockers.push("semantic_preflight_stale");
  if (!semanticPreflight.preflightId) blockers.push("semantic_preflight_missing");
  if (!workThreadRef.workThreadId && !semanticPreflight.selectedWorkThreadId && !targetResolutionRef.selectedWorkThreadId) blockers.push("work_thread_ref_missing");
  if (!agentClassRef.agentClassId) blockers.push("agent_class_id_missing");
  if (!agentClassRef.agentClassKind) blockers.push("agent_class_kind_missing");
  if (agentClassRef.agentClassKind === "primary_agent") blockers.push("primary_agent_not_role_handoff");
  if (targetResolutionRef.reportId && targetResolutionRef.stale) blockers.push("target_resolution_stale");
  return [...new Set(blockers)];
}

function buildDirectRoleHandoffPacket(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const semanticPreflight = semanticPreflightRefFrom(source.semanticPreflight || source.semanticBrokerPreflight || {});
  const targetResolutionRef = targetResolutionRefFrom(source.workTargetResolutionReport || source.targetResolution || {});
  const operatorBrokerResolutionRef = operatorBrokerResolutionRefFrom(source.operatorBrokerResolution || source.operatorBrokerResolutionRef || {});
  const workThreadRef = workThreadRefFrom(source.workThread || source.workThreadRef || {}, {
    projectId: source.projectId || semanticPreflight.projectId || targetResolutionRef.projectId,
    selectedWorkThreadId: semanticPreflight.selectedWorkThreadId || targetResolutionRef.selectedWorkThreadId,
  });
  const agentClassRef = agentClassRefFrom(source.agentClassSpec || source.agentClassRef || source.semanticPreflight?.recommendedAgentClass || source.semanticBrokerPreflight?.recommendedAgentClass || {});
  const expectedOutputArtifactFamily = normalizeString(source.expectedOutputArtifactFamily, defaultOutputArtifactFamily(agentClassRef));
  const blockers = packetBlockers({ semanticPreflight, agentClassRef, workThreadRef, targetResolutionRef });
  const status = blockers.length ? "blocked" : "operator_review_required";
  const acceptancePosture = status === "operator_review_required" ? "operator_accept_required" : "blocked";
  const contextRefs = normalizeRefs(source.contextRefs, "context_pack");
  const requestRefs = normalizeRefs(source.requestRefs, "request_manifest");
  const authorityTransitionRefs = normalizeRefs(source.authorityTransitionRefs, "authority_transition");
  const evidenceRefs = [
    compactEvidenceRef({
      kind: "semantic_registry",
      artifactId: semanticPreflight.preflightId,
      artifactDigest: semanticPreflight.preflightDigest,
      sourceConfidence: semanticPreflight.stale ? "diagnostic" : "accepted",
      rendererSafeLabel: "Semantic broker preflight",
    }, "semantic_registry"),
    compactEvidenceRef({
      kind: "work_thread_binding",
      artifactId: targetResolutionRef.reportId,
      artifactDigest: targetResolutionRef.reportDigest,
      sourceConfidence: targetResolutionRef.stale ? "diagnostic" : "accepted",
      rendererSafeLabel: "Work-target resolution report",
    }, "work_thread_binding"),
    compactEvidenceRef({
      kind: "work_thread",
      artifactId: workThreadRef.workThreadId,
      artifactDigest: workThreadRef.sourceDigest,
      sourceConfidence: "accepted",
      rendererSafeLabel: "WorkThread",
    }, "work_thread"),
    compactEvidenceRef({
      kind: "semantic_registry",
      artifactId: agentClassRef.agentClassId,
      artifactDigest: agentClassRef.specDigest,
      sourceConfidence: "accepted",
      rendererSafeLabel: "Agent class spec",
    }, "semantic_registry"),
    compactEvidenceRef({
      kind: "operator_broker_resolution",
      artifactId: operatorBrokerResolutionRef.brokerResolutionId,
      artifactDigest: operatorBrokerResolutionRef.brokerResolutionDigest,
      sourceConfidence: operatorBrokerResolutionRef.stale ? "diagnostic" : "accepted",
      rendererSafeLabel: "Operator broker resolution",
    }, "operator_broker_resolution"),
    ...contextRefs,
    ...requestRefs,
    ...authorityTransitionRefs,
    ...normalizeRefs(source.evidenceRefs, "unknown"),
  ].filter(Boolean);
  const createdAt = isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt);
  const sourceDigest = digestFor("direct-role-handoff-source@1", {
    semanticPreflight,
    operatorBrokerResolutionRef,
    targetResolutionRef,
    workThreadRef,
    agentClassRef,
    expectedOutputArtifactFamily,
    contextRefs,
    requestRefs,
    authorityTransitionRefs,
    blockers,
    version: DIRECT_ROLE_HANDOFF_PACKET_VERSION,
  });
  const packet = {
    schema: DIRECT_ROLE_HANDOFF_PACKET_SCHEMA,
    version: DIRECT_ROLE_HANDOFF_PACKET_VERSION,
    handoffPacketId: normalizeString(source.handoffPacketId, `role_handoff_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(source.projectId || workThreadRef.projectId, ""),
    threadId: normalizeString(source.threadId || source.semanticPreflight?.threadId || source.semanticBrokerPreflight?.threadId, ""),
    turnId: normalizeString(source.turnId || source.semanticPreflight?.turnId || source.semanticBrokerPreflight?.turnId, ""),
    createdAt,
    status,
    acceptancePosture,
    rejectionPosture: "operator_may_reject_preview",
    semanticPreflight,
    operatorBrokerResolutionRef,
    targetResolutionRef,
    workThreadRef,
    selectedAgentClass: agentClassRef,
    authorityBoundary: authorityBoundarySummary(source.authorityBoundary),
    contextRefs,
    requestRefs,
    authorityTransitionRefs,
    expectedOutputArtifactFamily,
    expectedOutputArtifactFamilySource: normalizeString(source.expectedOutputArtifactFamilySource, source.expectedOutputArtifactFamily ? "explicit" : "agent_class_spec"),
    evidenceRefs,
    evidenceRefCount: evidenceRefs.length,
    blockerCodes: blockers,
    canPreview: true,
    canAcceptInThisPr: false,
    canRejectInThisPr: false,
    acceptTransitionEnabled: false,
    rejectTransitionEnabled: false,
    providerCallAllowed: false,
    workerSpawnAllowed: false,
    objectAuditAllowed: false,
    workspaceMutationAllowed: false,
    routingEnforced: false,
    providerCallPerformed: false,
    workerSpawnPerformed: false,
    objectAuditPerformed: false,
    workspaceMutationPerformed: false,
    rendererSafeSummary: status === "operator_review_required"
      ? `Role handoff preview prepared for ${agentClassRef.displayName || agentClassRef.agentClassKind}; execution remains disabled.`
      : "Role handoff preview is blocked until route-to-role evidence is complete.",
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  packet.packetDigest = digestFor(DIRECT_ROLE_HANDOFF_PACKET_SCHEMA, { ...packet, packetDigest: "" });
  return packet;
}

function buildDirectRoleHandoffPreview(packet = {}) {
  const source = isPlainObject(packet) ? packet : {};
  const status = ROUTE_TO_ROLE_STATUS.has(source.status) ? source.status : "blocked";
  const selectedAgentClass = agentClassRefFrom(source.selectedAgentClass || {});
  const workThreadRef = workThreadRefFrom(source.workThreadRef || {});
  const preview = {
    schema: DIRECT_ROLE_HANDOFF_PREVIEW_SCHEMA,
    previewId: `role_handoff_preview_${sha256(`${source.handoffPacketId || ""}:${source.packetDigest || ""}`).slice(0, 24)}`,
    handoffPacketId: normalizeString(source.handoffPacketId, ""),
    projectId: normalizeString(source.projectId, ""),
    threadId: normalizeString(source.threadId, ""),
    turnId: normalizeString(source.turnId, ""),
    status,
    acceptancePosture: ACCEPTANCE_POSTURES.has(source.acceptancePosture) ? source.acceptancePosture : "blocked",
    rejectionPosture: normalizeString(source.rejectionPosture, "operator_may_reject_preview"),
    selectedWorkThreadId: workThreadRef.workThreadId,
    selectedAgentClass: {
      agentClassId: selectedAgentClass.agentClassId,
      agentClassKind: selectedAgentClass.agentClassKind,
      displayName: selectedAgentClass.displayName,
    },
    expectedOutputArtifactFamily: normalizeString(source.expectedOutputArtifactFamily, ""),
    previewLabel: selectedAgentClass.displayName
      ? `Prepare ${selectedAgentClass.displayName} handoff`
      : "Prepare role handoff",
    previewSummary: boundedString(source.rendererSafeSummary || "Role handoff preview is display-only.", 360),
    blockerCodes: Array.isArray(source.blockerCodes) ? source.blockerCodes.map((code) => normalizeString(code, "")).filter(Boolean) : [],
    canPreview: true,
    canAcceptInThisPr: false,
    canRejectInThisPr: false,
    acceptTransitionEnabled: false,
    rejectTransitionEnabled: false,
    providerCallAllowed: false,
    workerSpawnAllowed: false,
    objectAuditAllowed: false,
    workspaceMutationAllowed: false,
    rendererSafe: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  preview.previewDigest = digestFor(DIRECT_ROLE_HANDOFF_PREVIEW_SCHEMA, { ...preview, previewDigest: "" });
  return preview;
}

function validateNoAuthorityLeak(artifact = {}, label = "direct_role_handoff") {
  for (const flag of [
    "canAcceptInThisPr",
    "canRejectInThisPr",
    "acceptTransitionEnabled",
    "rejectTransitionEnabled",
    "providerCallAllowed",
    "workerSpawnAllowed",
    "objectAuditAllowed",
    "workspaceMutationAllowed",
  ]) {
    if (artifact[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
  for (const flag of [
    "providerCallPerformed",
    "workerSpawnPerformed",
    "objectAuditPerformed",
    "workspaceMutationPerformed",
    "routingEnforced",
  ]) {
    if (flag in artifact && artifact[flag] !== false) throw new Error(`${label}_execution_leak:${flag}`);
  }
  if (artifact.rawTextIncluded !== false || artifact.rawPathIncluded !== false || artifact.rawSecretIncluded !== false) {
    throw new Error(`${label}_raw_exposure`);
  }
}

function validateDirectRoleHandoffPacket(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_ROLE_HANDOFF_PACKET_SCHEMA) {
    throw new Error("direct_role_handoff_packet_schema_mismatch");
  }
  if (!ROUTE_TO_ROLE_STATUS.has(packet.status)) {
    throw new Error(`direct_role_handoff_packet_status_invalid:${packet.status || ""}`);
  }
  if (!ACCEPTANCE_POSTURES.has(packet.acceptancePosture)) {
    throw new Error(`direct_role_handoff_packet_acceptance_posture_invalid:${packet.acceptancePosture || ""}`);
  }
  if (!normalizeString(packet.projectId, "")) throw new Error("direct_role_handoff_packet_missing_project_id");
  if (!normalizeString(packet.handoffPacketId, "")) throw new Error("direct_role_handoff_packet_missing_id");
  if (!normalizeString(packet.packetDigest, "")) throw new Error("direct_role_handoff_packet_missing_digest");
  if (packet.status === "operator_review_required") {
    if (packet.semanticPreflight?.recommendationClass !== "route_to_role") throw new Error("direct_role_handoff_packet_missing_route_to_role_preflight");
    if (!normalizeString(packet.workThreadRef?.workThreadId, "")) throw new Error("direct_role_handoff_packet_missing_work_thread");
    if (!normalizeString(packet.selectedAgentClass?.agentClassId, "")) throw new Error("direct_role_handoff_packet_missing_agent_class");
    if (!normalizeString(packet.expectedOutputArtifactFamily, "")) throw new Error("direct_role_handoff_packet_missing_expected_output");
  }
  validateNoAuthorityLeak(packet, "direct_role_handoff_packet");
  return true;
}

function validateDirectRoleHandoffPreview(preview = {}) {
  if (!isPlainObject(preview) || preview.schema !== DIRECT_ROLE_HANDOFF_PREVIEW_SCHEMA) {
    throw new Error("direct_role_handoff_preview_schema_mismatch");
  }
  if (preview.rendererSafe !== true) throw new Error("direct_role_handoff_preview_not_renderer_safe");
  validateNoAuthorityLeak(preview, "direct_role_handoff_preview");
  return true;
}

module.exports = {
  ACCEPTANCE_POSTURES,
  ARTIFACT_FAMILY_BY_AGENT_KIND,
  DIRECT_ROLE_HANDOFF_PACKET_SCHEMA,
  DIRECT_ROLE_HANDOFF_PACKET_VERSION,
  DIRECT_ROLE_HANDOFF_PREVIEW_SCHEMA,
  ROUTE_TO_ROLE_STATUS,
  buildDirectRoleHandoffPacket,
  buildDirectRoleHandoffPreview,
  stableStringify,
  validateDirectRoleHandoffPacket,
  validateDirectRoleHandoffPreview,
};
