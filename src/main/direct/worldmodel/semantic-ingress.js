"use strict";

// Wave 26 PR 153.  This is deliberately separate from governance/broker.js:
// that module diagnoses prompt/task routing; this module carries auditable
// evidence into the hierarchical graph's existing CAS controller.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const {
  buildProjectCustodyWriteMatrix,
  validateProjectCustodyWriteMatrix,
  validateProjectCustodyWriteWitness,
  validateProjectManagerProfile,
} = require("./project-manager");
const { validateWorldmodelManagerProfile } = require("./manager");
const {
  appendWorldmodelGraphTransition,
  buildScopedWorldmodelRevisionRef,
  buildWorldmodelSemanticEdge,
  buildWorldmodelSemanticNode,
  validateHierarchicalWorldmodelGraph,
  validateScopedWorldmodelRevisionRef,
  validateWorldmodelSemanticEdge,
  validateWorldmodelSemanticNode,
  normalizedMutationDigest,
} = require("./hierarchical-graph");

const WORLDMODEL_INGRESS_ENVELOPE_SCHEMA =
  "direct_worldmodel_ingress_envelope@1";
const TRANSCRIPT_EVIDENCE_REF_SCHEMA = "direct_transcript_evidence_ref@1";
const TRANSCRIPT_INSPECTION_ARTIFACT_SCHEMA =
  "direct_transcript_inspection_artifact@1";
const SEMANTIC_INGRESS_BROKER_PACKET_SCHEMA =
  "direct_semantic_ingress_broker_packet@1";
const SEMANTIC_TARGET_RESOLUTION_SCHEMA = "direct_semantic_target_resolution@1";
const WORLDMODEL_DELTA_CANDIDATE_SCHEMA = "direct_worldmodel_delta_candidate@1";
const WORLDMODEL_PROMOTION_TRANSITION_SCHEMA =
  "direct_worldmodel_promotion_transition@1";
const WORLDMODEL_CONTEXTUAL_ADMISSION_SCHEMA =
  "direct_worldmodel_contextual_admission@1";
const WORLDMODEL_CONTEXTUAL_AUTHORITY_DECISION_SCHEMA =
  "direct_worldmodel_contextual_authority_decision@1";

const INGRESS_KINDS = new Set([
  "current_user_message",
  "historical_transcript_inspection",
  "artifact_inspection",
  "work_thread_closure",
  "control_panel_change",
  "system_event",
  "migration_candidate",
]);
const MANAGER_ROLES = new Set([
  "world_manager",
  "project_manager",
  "thread_manager",
]);
const TARGET_SCOPES = new Set(["user_world", "project", "work_thread"]);
const TARGET_ROUTES = new Set([
  "commit_current_scope",
  "world_to_project_descent",
  "project_to_world_escalation",
  "project_to_thread_descent",
  "multi_scope_split",
  "remand",
]);
const CONFIDENCES = new Set(["exact", "high", "derived", "ambiguous"]);
const DELTA_STATES = new Set([
  "candidate",
  "needs_review",
  "accepted_for_commit",
  "rejected",
  "deferred",
  "conflicted",
]);
const PROMOTION_DECISIONS = new Set([
  "admit",
  "reject",
  "defer",
  "remand",
  "split",
  "conflict",
]);
const INSPECTION_STATES = new Set([
  "not_loaded",
  "bounded_excerpt_loaded",
  "audited",
  "stale",
  "unavailable",
]);
const NODE_OPERATIONS = new Set([
  "add",
  "revise",
  "supersede",
  "set_lifecycle",
  "no_change",
]);
const EDGE_OPERATIONS = new Set(["add", "revise", "supersede", "no_change"]);
const NON_ACTIVE_LIFECYCLES = new Set([
  "proposed",
  "deferred",
  "rejected",
  "superseded",
  "refuted",
  "stale",
  "archived",
]);
const PROMOTION_ORIGINS = new Set([
  "user_evidence",
  "transcript_evidence",
  "artifact_evidence",
  "work_thread_evidence",
  "provider_output",
  "tool_output",
  "system_event",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function object(value, label) {
  if (!isPlainObject(value))
    fail("direct_semantic_ingress_invalid_object", label);
  return value;
}
function text(value, fallback = "") {
  return normalizeString(value, fallback);
}
function required(value, label) {
  const result = text(value);
  if (!result) fail("direct_semantic_ingress_missing_string", label);
  return result;
}
function list(value, label) {
  if (!Array.isArray(value))
    fail("direct_semantic_ingress_missing_array", label);
  return value;
}
function enumValue(value, allowed, label) {
  if (!allowed.has(value))
    fail("direct_semantic_ingress_invalid_enum", `${label}:${value || ""}`);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (
        ![
          "digest",
          "candidateDigest",
          "normalizedSemanticMutationDigest",
        ].includes(key) &&
        typeof value[key] !== "undefined"
      )
        output[key] = stable(value[key]);
      return output;
    }, {});
}
function digest(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stable(value))}`);
}
function checkDigest(value, field, domain, label) {
  if (required(value[field], `${label}.${field}`) !== digest(domain, value))
    fail("direct_semantic_ingress_digest_mismatch", label);
}
function noRawBody(value, label) {
  object(value, label);
  for (const key of [
    "rawTranscript",
    "rawTranscriptBody",
    "rawText",
    "rawInput",
    "body",
    "excerptText",
    "messageText",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      value[key] !== false &&
      value[key] !== ""
    )
      fail("direct_semantic_ingress_raw_evidence_embedded", `${label}.${key}`);
  }
}
function refs(value, options = {}) {
  return normalizeOdeuSourceRefs(value, options);
}
function requireRefs(value, label) {
  list(value, label);
  if (!value.length)
    fail("direct_semantic_ingress_source_evidence_required", label);
  return value;
}
function exactDigest(value, label) {
  const result = required(value, label);
  if (!result.startsWith("sha256:"))
    fail("direct_semantic_ingress_exact_digest_required", label);
  return result;
}
function sourceRef(kind, id, digestValue, options = {}) {
  const exact = exactDigest(digestValue, `${kind}.digest`);
  return refs(
    [
      {
        sourceRefId: `${kind}_${id}`,
        sourceKind: "family_specific",
        sourceId: id,
        sourceConfidence: options.confidence || "derived",
        freshness: options.freshness || "fresh",
        observedAt: options.observedAt,
        sourceDigest: {
          algorithm: "sha256",
          value: exact,
          digestOf: "canonical_json",
        },
      },
    ],
    options,
  )[0];
}
function validateExactSourceRef(
  value,
  label,
  expectedId = "",
  expectedDigest = "",
) {
  object(value, label);
  const id = required(value.sourceId, `${label}.sourceId`);
  if (expectedId && id !== expectedId)
    fail("direct_semantic_ingress_source_ref_id_mismatch", label);
  const digestValue = exactDigest(
    value.sourceDigest?.value,
    `${label}.sourceDigest.value`,
  );
  if (value.sourceDigest?.algorithm !== "sha256")
    fail("direct_semantic_ingress_source_ref_algorithm", label);
  if (
    expectedDigest &&
    digestValue !== exactDigest(expectedDigest, `${label}.expectedDigest`)
  )
    fail("direct_semantic_ingress_source_ref_digest_mismatch", label);
  return true;
}
function normalizeScope(value = {}) {
  const source = isPlainObject(value) ? value : {};
  if (
    ["sessionId", "chatId", "conversationId"].some((key) => text(source[key]))
  )
    fail(
      "direct_semantic_ingress_interaction_scope_forbidden",
      "session/chat identifiers are not semantic scope",
    );
  const scopeKind = TARGET_SCOPES.has(source.scopeKind)
    ? source.scopeKind
    : "project";
  const semanticPath = Array.isArray(source.semanticPath)
    ? source.semanticPath.map((entry) => text(entry)).filter(Boolean)
    : [];
  if (
    semanticPath.some((entry) =>
      /^(sessions?|chats?|conversations?)$/i.test(entry),
    )
  )
    fail(
      "direct_semantic_ingress_interaction_scope_forbidden",
      "session/chat path segment is not semantic scope",
    );
  const result = { scopeKind, userProfileId: normalizeId(source.userProfileId, "user_profile"), semanticPath };
  if (scopeKind === "project" || scopeKind === "work_thread")
    result.projectId = normalizeId(source.projectId, "project");
  if (scopeKind === "work_thread")
    result.workThreadId = normalizeId(source.workThreadId, "work_thread");
  return result;
}
function validateScope(value, label) {
  object(value, label);
  enumValue(value.scopeKind, TARGET_SCOPES, `${label}.scopeKind`);
  list(value.semanticPath, `${label}.semanticPath`);
  if (
    ["sessionId", "chatId", "conversationId"].some((key) => text(value[key])) ||
    value.semanticPath.some((entry) =>
      /^(sessions?|chats?|conversations?)$/i.test(text(entry)),
    )
  )
    fail("direct_semantic_ingress_interaction_scope_forbidden", label);
  if (value.scopeKind === "project" || value.scopeKind === "work_thread")
    required(value.projectId, `${label}.projectId`);
  if (value.scopeKind === "work_thread")
    required(value.workThreadId, `${label}.workThreadId`);
}
function scopeKey(scope) {
  return `${scope.scopeKind}:${scope.projectId || ""}:${scope.workThreadId || ""}:${scope.semanticPath.join("/")}`;
}
function scopeRevisionFor(scope, revision = 0) {
  return buildScopedWorldmodelRevisionRef({
    scopeKind: scope.scopeKind,
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    revision,
  });
}
function expectedScopeFor(graph, scope) {
  return graph.scopedRevisionRefs.find(
    (ref) =>
      ref.scopeKind === scope.scopeKind &&
      ref.projectId === scope.projectId &&
      ref.workThreadId === scope.workThreadId,
  );
}
function normalizedOdeuImpact(value) {
  const source = isPlainObject(value) ? value : {};
  return ["O", "E", "D", "U"].reduce((out, key) => {
    out[key] = Array.isArray(source[key])
      ? source[key]
          .map((entry) => text(entry))
          .filter(Boolean)
          .sort()
      : [];
    return out;
  }, {});
}

function buildWorldmodelIngressEnvelope(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = {
    schema: WORLDMODEL_INGRESS_ENVELOPE_SCHEMA,
    ingressId: normalizeId(source.ingressId || source.id, "worldmodel_ingress"),
    inputKind: INGRESS_KINDS.has(source.inputKind)
      ? source.inputKind
      : "current_user_message",
    receivedByAgentId: normalizeId(source.receivedByAgentId, "manager_agent"),
    receivedByRole: MANAGER_ROLES.has(source.receivedByRole)
      ? source.receivedByRole
      : "project_manager",
    declaredScopeHints: (Array.isArray(source.declaredScopeHints)
      ? source.declaredScopeHints
      : []
    ).map(normalizeScope),
    sourceRefs: refs(source.sourceRefs, options),
    currentInstructionAuthority: source.currentInstructionAuthority === true,
    rawTranscriptPersistedSeparately: true,
    rawTranscriptIncluded: false,
    createdAt: text(source.createdAt, nowIso(options.now || Date.now)),
  };
  result.digest = digest("direct-worldmodel-ingress-envelope@1", result);
  return result;
}
function validateWorldmodelIngressEnvelope(value) {
  object(value, "worldmodelIngressEnvelope");
  if (value.schema !== WORLDMODEL_INGRESS_ENVELOPE_SCHEMA)
    fail(
      "direct_semantic_ingress_schema_mismatch",
      "worldmodelIngressEnvelope",
    );
  required(value.ingressId, "worldmodelIngressEnvelope.ingressId");
  enumValue(
    value.inputKind,
    INGRESS_KINDS,
    "worldmodelIngressEnvelope.inputKind",
  );
  required(
    value.receivedByAgentId,
    "worldmodelIngressEnvelope.receivedByAgentId",
  );
  enumValue(
    value.receivedByRole,
    MANAGER_ROLES,
    "worldmodelIngressEnvelope.receivedByRole",
  );
  list(
    value.declaredScopeHints,
    "worldmodelIngressEnvelope.declaredScopeHints",
  ).forEach((scope, index) =>
    validateScope(
      scope,
      `worldmodelIngressEnvelope.declaredScopeHints.${index}`,
    ),
  );
  requireRefs(value.sourceRefs, "worldmodelIngressEnvelope.sourceRefs");
  if (
    typeof value.currentInstructionAuthority !== "boolean" ||
    (value.currentInstructionAuthority === true &&
      value.inputKind !== "current_user_message") ||
    value.rawTranscriptPersistedSeparately !== true ||
    value.rawTranscriptIncluded !== false
  )
    fail(
      "direct_semantic_ingress_envelope_authority_boundary",
      "worldmodelIngressEnvelope",
    );
  noRawBody(value, "worldmodelIngressEnvelope");
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-ingress-envelope@1",
    "worldmodelIngressEnvelope",
  );
  return true;
}

function buildTranscriptEvidenceRef(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const storeId = normalizeId(
    source.transcriptStoreRef?.id || source.transcriptStoreId,
    "transcript_store",
  );
  const storeDigest = exactDigest(
    source.sourceDigest || source.transcriptStoreRef?.digest,
    "transcriptEvidenceRef.sourceDigest",
  );
  const result = {
    schema: TRANSCRIPT_EVIDENCE_REF_SCHEMA,
    projectId: normalizeId(source.projectId, "project"),
    threadId: normalizeId(source.threadId, "thread"),
    turnIds: (Array.isArray(source.turnIds) ? source.turnIds : []).map((id) =>
      normalizeId(id, "turn"),
    ),
    messageItemIds: (Array.isArray(source.messageItemIds)
      ? source.messageItemIds
      : []
    ).map((id) => normalizeId(id, "message_item")),
    transcriptStoreRef: sourceRef(
      "transcript_store",
      storeId,
      storeDigest,
      options,
    ),
    sourceDigest: storeDigest,
    evidenceAuthority: "historical_evidence",
    inspectionState: INSPECTION_STATES.has(source.inspectionState)
      ? source.inspectionState
      : "not_loaded",
    rawTextIncluded: false,
  };
  result.digest = digest("direct-transcript-evidence-ref@1", result);
  return result;
}
function validateTranscriptEvidenceRef(value) {
  object(value, "transcriptEvidenceRef");
  if (value.schema !== TRANSCRIPT_EVIDENCE_REF_SCHEMA)
    fail("direct_semantic_ingress_schema_mismatch", "transcriptEvidenceRef");
  required(value.projectId, "transcriptEvidenceRef.projectId");
  required(value.threadId, "transcriptEvidenceRef.threadId");
  list(value.turnIds, "transcriptEvidenceRef.turnIds");
  list(value.messageItemIds, "transcriptEvidenceRef.messageItemIds");
  validateExactSourceRef(
    value.transcriptStoreRef,
    "transcriptEvidenceRef.transcriptStoreRef",
    "",
    value.sourceDigest,
  );
  exactDigest(value.sourceDigest, "transcriptEvidenceRef.sourceDigest");
  if (
    value.evidenceAuthority !== "historical_evidence" ||
    !INSPECTION_STATES.has(value.inspectionState) ||
    value.rawTextIncluded !== false
  )
    fail(
      "direct_semantic_ingress_transcript_authority_boundary",
      "transcriptEvidenceRef",
    );
  noRawBody(value, "transcriptEvidenceRef");
  checkDigest(
    value,
    "digest",
    "direct-transcript-evidence-ref@1",
    "transcriptEvidenceRef",
  );
  return true;
}
function buildTranscriptInspectionArtifact(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const evidenceRef = source.evidenceRef?.schema
    ? source.evidenceRef
    : buildTranscriptEvidenceRef(source.evidenceRef || source, options);
  validateTranscriptEvidenceRef(evidenceRef);
  const excerptId = normalizeId(
    source.boundedExcerptRef?.id || source.boundedExcerptId,
    "bounded_excerpt",
  );
  const excerptDigest = exactDigest(
    source.boundedExcerptRef?.digest || source.boundedExcerptDigest,
    "transcriptInspectionArtifact.boundedExcerptDigest",
  );
  const result = {
    schema: TRANSCRIPT_INSPECTION_ARTIFACT_SCHEMA,
    inspectionId: normalizeId(
      source.inspectionId || source.id,
      "transcript_inspection",
    ),
    evidenceRef,
    question: required(
      source.question,
      "transcriptInspectionArtifact.question",
    ),
    boundedExcerptRef: sourceRef(
      "bounded_excerpt",
      excerptId,
      excerptDigest,
      options,
    ),
    extractedClaimCandidates: (Array.isArray(source.extractedClaimCandidates)
      ? source.extractedClaimCandidates
      : []
    )
      .map((claim) => text(claim))
      .filter(Boolean),
    omissions: (Array.isArray(source.omissions) ? source.omissions : [])
      .map((entry) => text(entry))
      .filter(Boolean),
    historicalInstructionAuthorityGranted: false,
    contextMutationGranted: false,
  };
  result.digest = digest("direct-transcript-inspection-artifact@1", result);
  return result;
}
function validateTranscriptInspectionArtifact(value) {
  object(value, "transcriptInspectionArtifact");
  if (value.schema !== TRANSCRIPT_INSPECTION_ARTIFACT_SCHEMA)
    fail(
      "direct_semantic_ingress_schema_mismatch",
      "transcriptInspectionArtifact",
    );
  required(value.inspectionId, "transcriptInspectionArtifact.inspectionId");
  validateTranscriptEvidenceRef(value.evidenceRef);
  required(value.question, "transcriptInspectionArtifact.question");
  validateExactSourceRef(
    value.boundedExcerptRef,
    "transcriptInspectionArtifact.boundedExcerptRef",
  );
  list(
    value.extractedClaimCandidates,
    "transcriptInspectionArtifact.extractedClaimCandidates",
  );
  list(value.omissions, "transcriptInspectionArtifact.omissions");
  if (
    value.historicalInstructionAuthorityGranted !== false ||
    value.contextMutationGranted !== false
  )
    fail(
      "direct_semantic_ingress_inspection_authority_leak",
      "transcriptInspectionArtifact",
    );
  noRawBody(value, "transcriptInspectionArtifact");
  checkDigest(
    value,
    "digest",
    "direct-transcript-inspection-artifact@1",
    "transcriptInspectionArtifact",
  );
  return true;
}

function buildSemanticTargetResolution(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const targets = (
    Array.isArray(source.candidateTargets) ? source.candidateTargets : []
  ).map((target) => ({
    ...normalizeScope(target),
    candidateNodeIds: (Array.isArray(target?.candidateNodeIds)
      ? target.candidateNodeIds
      : []
    ).map((id) => normalizeId(id, "candidate_node")),
    confidence: CONFIDENCES.has(target?.confidence)
      ? target.confidence
      : "ambiguous",
  }));
  const result = {
    schema: SEMANTIC_TARGET_RESOLUTION_SCHEMA,
    resolutionId: normalizeId(
      source.resolutionId || source.id,
      "semantic_target_resolution",
    ),
    ingressId: normalizeId(source.ingressId, "worldmodel_ingress"),
    candidateTargets: targets,
    route: TARGET_ROUTES.has(source.route)
      ? source.route
      : targets.length > 1
        ? "multi_scope_split"
        : "remand",
    brokerMayCommit: false,
    rationale: text(
      source.rationale,
      "Semantic target requires contextual audit.",
    ),
    sourceRefs: refs(source.sourceRefs, options),
  };
  result.digest = digest("direct-semantic-target-resolution@1", result);
  return result;
}
function validateSemanticTargetResolution(value) {
  object(value, "semanticTargetResolution");
  if (value.schema !== SEMANTIC_TARGET_RESOLUTION_SCHEMA)
    fail("direct_semantic_ingress_schema_mismatch", "semanticTargetResolution");
  required(value.resolutionId, "semanticTargetResolution.resolutionId");
  required(value.ingressId, "semanticTargetResolution.ingressId");
  list(
    value.candidateTargets,
    "semanticTargetResolution.candidateTargets",
  ).forEach((target, index) => {
    validateScope(target, `semanticTargetResolution.candidateTargets.${index}`);
    list(
      target.candidateNodeIds,
      `semanticTargetResolution.candidateTargets.${index}.candidateNodeIds`,
    );
    enumValue(
      target.confidence,
      CONFIDENCES,
      `semanticTargetResolution.candidateTargets.${index}.confidence`,
    );
  });
  enumValue(value.route, TARGET_ROUTES, "semanticTargetResolution.route");
  if (value.brokerMayCommit !== false)
    fail(
      "direct_semantic_ingress_broker_commit_forbidden",
      "semanticTargetResolution",
    );
  requireRefs(value.sourceRefs, "semanticTargetResolution.sourceRefs");
  checkDigest(
    value,
    "digest",
    "direct-semantic-target-resolution@1",
    "semanticTargetResolution",
  );
  return true;
}
function buildSemanticIngressBrokerPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const ingress = source.ingressEnvelope?.schema
    ? source.ingressEnvelope
    : buildWorldmodelIngressEnvelope(source.ingressEnvelope || source, options);
  validateWorldmodelIngressEnvelope(ingress);
  const resolution = source.targetResolution?.schema
    ? source.targetResolution
    : buildSemanticTargetResolution(
        {
          ...source.targetResolution,
          ingressId: ingress.ingressId,
          sourceRefs: source.targetResolution?.sourceRefs || ingress.sourceRefs,
        },
        options,
      );
  validateSemanticTargetResolution(resolution);
  if (resolution.ingressId !== ingress.ingressId)
    fail(
      "direct_semantic_ingress_broker_ingress_mismatch",
      "targetResolution.ingressId",
    );
  const result = {
    schema: SEMANTIC_INGRESS_BROKER_PACKET_SCHEMA,
    brokerPacketId: normalizeId(
      source.brokerPacketId || source.id,
      "semantic_ingress_broker",
    ),
    ingressRef: sourceRef(
      "worldmodel_ingress",
      ingress.ingressId,
      ingress.digest,
      options,
    ),
    targetResolution: resolution,
    brokerMayCommit: false,
    interpretationState: text(
      source.interpretationState,
      resolution.route === "remand" ? "remand" : "candidate",
    ),
    requestedInspectionRefs: refs(source.requestedInspectionRefs, options),
    sourceRefs: refs(source.sourceRefs || ingress.sourceRefs, options),
  };
  result.digest = digest("direct-semantic-ingress-broker-packet@1", result);
  return result;
}
function validateSemanticIngressBrokerPacket(value) {
  object(value, "semanticIngressBrokerPacket");
  if (value.schema !== SEMANTIC_INGRESS_BROKER_PACKET_SCHEMA)
    fail(
      "direct_semantic_ingress_schema_mismatch",
      "semanticIngressBrokerPacket",
    );
  required(value.brokerPacketId, "semanticIngressBrokerPacket.brokerPacketId");
  object(value.ingressRef, "semanticIngressBrokerPacket.ingressRef");
  validateSemanticTargetResolution(value.targetResolution);
  if (value.brokerMayCommit !== false)
    fail(
      "direct_semantic_ingress_broker_commit_forbidden",
      "semanticIngressBrokerPacket",
    );
  requireRefs(value.sourceRefs, "semanticIngressBrokerPacket.sourceRefs");
  checkDigest(
    value,
    "digest",
    "direct-semantic-ingress-broker-packet@1",
    "semanticIngressBrokerPacket",
  );
  return true;
}
function commitSemanticIngressBrokerPacket() {
  fail(
    "direct_semantic_ingress_broker_commit_forbidden",
    "broker packet is proposal-only",
  );
}

function semanticNodeBasis(node) {
  return {
    nodeKind: node.nodeKind,
    abstractionLevel: node.abstractionLevel,
    semanticSummary: node.semanticSummary,
    structuredValue: node.structuredValue,
    odeuImpact: normalizedOdeuImpact(node.odeuImpact),
    lifecycle: node.lifecycle,
    integrationStatus: node.integrationStatus,
    epistemicStatus: node.epistemicStatus,
    normativeForce: node.normativeForce,
    projectionEligibility: node.projectionEligibility,
    invalidationRules: [...node.invalidationRules].sort(),
  };
}
function semanticEdgeBasis(edge) {
  return {
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    relationKind: edge.relationKind,
    epistemicStatus: edge.epistemicStatus,
    lifecycle: edge.lifecycle,
  };
}
function mutationBasis(candidate) {
  return {
    targetScope: candidate.targetScope,
    abstractionLevel: candidate.abstractionLevel,
    proposedNodeMutations: candidate.proposedNodeMutations
      .map((mutation) => ({
        operation: mutation.operation,
        targetNodeId: mutation.targetNodeId || "",
        candidateNode: semanticNodeBasis(mutation.candidateNode),
      }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    proposedEdgeMutations: candidate.proposedEdgeMutations
      .map((mutation) => ({
        operation: mutation.operation,
        targetEdgeId: mutation.targetEdgeId || "",
        candidateEdge: semanticEdgeBasis(mutation.candidateEdge),
      }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    odeuImpact: normalizedOdeuImpact(candidate.odeuImpact),
  };
}
function normalizeCandidateNode(input, targetScope, sourceRefs, options) {
  const node = buildWorldmodelSemanticNode(
    {
      ...input,
      scope: { ...(input?.scope || {}), ...targetScope },
      sourceRefs: input?.sourceRefs || sourceRefs,
      promotionTransitionRefs: input?.promotionTransitionRefs || [],
    },
    options,
  );
  validateWorldmodelSemanticNode(node);
  return node;
}
function normalizeCandidateEdge(input, sourceRefs, options) {
  const edge = buildWorldmodelSemanticEdge(
    { ...input, sourceRefs: input?.sourceRefs || sourceRefs },
    options,
  );
  validateWorldmodelSemanticEdge(edge);
  return edge;
}
function buildWorldmodelDeltaCandidate(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const targetScope = normalizeScope(source.targetScope);
  const sourceRefs = refs(source.sourceRefs, options);
  const nodes = (
    Array.isArray(source.proposedNodeMutations)
      ? source.proposedNodeMutations
      : []
  ).map((mutation) => ({
    operation: NODE_OPERATIONS.has(mutation?.operation)
      ? mutation.operation
      : "add",
    ...(text(mutation?.targetNodeId)
      ? { targetNodeId: normalizeId(mutation.targetNodeId, "worldmodel_node") }
      : {}),
    candidateNode: normalizeCandidateNode(
      mutation?.candidateNode || {},
      targetScope,
      sourceRefs,
      options,
    ),
  }));
  const edges = (
    Array.isArray(source.proposedEdgeMutations)
      ? source.proposedEdgeMutations
      : []
  ).map((mutation) => ({
    operation: EDGE_OPERATIONS.has(mutation?.operation)
      ? mutation.operation
      : "add",
    ...(text(mutation?.targetEdgeId)
      ? { targetEdgeId: normalizeId(mutation.targetEdgeId, "worldmodel_edge") }
      : {}),
    candidateEdge: normalizeCandidateEdge(
      mutation?.candidateEdge || {},
      sourceRefs,
      options,
    ),
  }));
  const expectedScopeRevisions =
    Array.isArray(source.expectedScopeRevisions) &&
    source.expectedScopeRevisions.length
      ? source.expectedScopeRevisions
      : [scopeRevisionFor(targetScope)];
  const result = {
    schema: WORLDMODEL_DELTA_CANDIDATE_SCHEMA,
    candidateId: normalizeId(
      source.candidateId || source.id,
      "worldmodel_delta",
    ),
    ingressId: normalizeId(source.ingressId, "worldmodel_ingress"),
    targetResolutionId: normalizeId(
      source.targetResolutionId,
      "semantic_target_resolution",
    ),
    receivedByRole: MANAGER_ROLES.has(source.receivedByRole)
      ? source.receivedByRole
      : "project_manager",
    targetScope,
    abstractionLevel: [
      "world",
      "strategic",
      "conceptual",
      "operational",
      "execution",
    ].includes(source.abstractionLevel)
      ? source.abstractionLevel
      : "conceptual",
    proposedNodeMutations: nodes,
    proposedEdgeMutations: edges,
    odeuImpact: normalizedOdeuImpact(source.odeuImpact),
    candidateState: DELTA_STATES.has(source.candidateState)
      ? source.candidateState
      : "candidate",
    promotionOrigin: PROMOTION_ORIGINS.has(source.promotionOrigin)
      ? source.promotionOrigin
      : "user_evidence",
    expectedScopeRevisions: expectedScopeRevisions.map(
      buildScopedWorldmodelRevisionRef,
    ),
    sourceRefs,
  };
  result.normalizedSemanticMutationDigest = digest(
    "direct-worldmodel-normalized-semantic-mutation@1",
    mutationBasis(result),
  );
  result.digest = digest("direct-worldmodel-delta-candidate@1", result);
  return result;
}
function validateWorldmodelDeltaCandidate(value) {
  object(value, "worldmodelDeltaCandidate");
  if (value.schema !== WORLDMODEL_DELTA_CANDIDATE_SCHEMA)
    fail("direct_semantic_ingress_schema_mismatch", "worldmodelDeltaCandidate");
  required(value.candidateId, "worldmodelDeltaCandidate.candidateId");
  required(value.ingressId, "worldmodelDeltaCandidate.ingressId");
  required(
    value.targetResolutionId,
    "worldmodelDeltaCandidate.targetResolutionId",
  );
  enumValue(
    value.receivedByRole,
    MANAGER_ROLES,
    "worldmodelDeltaCandidate.receivedByRole",
  );
  validateScope(value.targetScope, "worldmodelDeltaCandidate.targetScope");
  list(
    value.proposedNodeMutations,
    "worldmodelDeltaCandidate.proposedNodeMutations",
  ).forEach((mutation, index) => {
    enumValue(
      mutation.operation,
      NODE_OPERATIONS,
      `worldmodelDeltaCandidate.proposedNodeMutations.${index}.operation`,
    );
    validateWorldmodelSemanticNode(mutation.candidateNode);
  });
  list(
    value.proposedEdgeMutations,
    "worldmodelDeltaCandidate.proposedEdgeMutations",
  ).forEach((mutation, index) => {
    enumValue(
      mutation.operation,
      EDGE_OPERATIONS,
      `worldmodelDeltaCandidate.proposedEdgeMutations.${index}.operation`,
    );
    validateWorldmodelSemanticEdge(mutation.candidateEdge);
  });
  enumValue(
    value.candidateState,
    DELTA_STATES,
    "worldmodelDeltaCandidate.candidateState",
  );
  enumValue(
    value.promotionOrigin,
    PROMOTION_ORIGINS,
    "worldmodelDeltaCandidate.promotionOrigin",
  );
  list(
    value.expectedScopeRevisions,
    "worldmodelDeltaCandidate.expectedScopeRevisions",
  ).forEach((ref) => validateScopedWorldmodelRevisionRef(ref));
  requireRefs(value.sourceRefs, "worldmodelDeltaCandidate.sourceRefs");
  if (
    required(
      value.normalizedSemanticMutationDigest,
      "worldmodelDeltaCandidate.normalizedSemanticMutationDigest",
    ) !==
    digest(
      "direct-worldmodel-normalized-semantic-mutation@1",
      mutationBasis(value),
    )
  )
    fail(
      "direct_semantic_ingress_normalized_digest_mismatch",
      "worldmodelDeltaCandidate",
    );
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-delta-candidate@1",
    "worldmodelDeltaCandidate",
  );
  return true;
}
function splitWorldmodelDeltaCandidate(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const resolution = source.targetResolution;
  validateSemanticTargetResolution(resolution);
  if (
    resolution.route !== "multi_scope_split" ||
    resolution.candidateTargets.length < 2
  )
    fail("direct_semantic_ingress_split_not_required", "targetResolution");
  return resolution.candidateTargets.map((target, index) => {
    const proposedNodeMutations = (source.proposedNodeMutations || [])
      .filter(
        (mutation) =>
          !mutation?.targetScope ||
          scopeKey(normalizeScope(mutation.targetScope)) === scopeKey(target),
      )
      .map((mutation) => ({
        ...mutation,
        candidateNode: {
          ...(mutation.candidateNode || {}),
          scope: { ...(mutation.candidateNode?.scope || {}), ...target },
        },
      }));
    const expectedScopeRevisions = (source.expectedScopeRevisions || []).filter(
      (ref) =>
        ref.scopeKind === target.scopeKind &&
        ref.projectId === target.projectId &&
        ref.workThreadId === target.workThreadId,
    );
    return buildWorldmodelDeltaCandidate(
      {
        ...source,
        candidateId: `${normalizeId(source.candidateId || "worldmodel_delta", "worldmodel_delta")}_${index + 1}`,
        targetResolutionId: resolution.resolutionId,
        targetScope: target,
        proposedNodeMutations,
        proposedEdgeMutations: [],
        expectedScopeRevisions,
      },
      options,
    );
  });
}

function buildWorldmodelPromotionTransition(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const graphTransitionRef = source.graphTransitionRef
    ? sourceRef(
        "worldmodel_graph_transition",
        normalizeId(
          source.graphTransitionRef.id || source.graphTransitionRef.sourceId,
          "worldmodel_transition",
        ),
        source.graphTransitionRef.digest,
        options,
      )
    : null;
  const result = {
    schema: WORLDMODEL_PROMOTION_TRANSITION_SCHEMA,
    promotionId: normalizeId(
      source.promotionId || source.id,
      "worldmodel_promotion",
    ),
    candidateId: normalizeId(source.candidateId, "worldmodel_delta"),
    decidedByAgentId: normalizeId(source.decidedByAgentId, "manager_agent"),
    decidedByRole: ["world_manager", "project_manager"].includes(
      source.decidedByRole,
    )
      ? source.decidedByRole
      : "project_manager",
    decision: PROMOTION_DECISIONS.has(source.decision)
      ? source.decision
      : "remand",
    targetNodeIds: (source.targetNodeIds || []).map((id) =>
      normalizeId(id, "worldmodel_node"),
    ),
    targetEdgeIds: (source.targetEdgeIds || []).map((id) =>
      normalizeId(id, "worldmodel_edge"),
    ),
    duplicateOfNodeIds: (source.duplicateOfNodeIds || []).map((id) =>
      normalizeId(id, "worldmodel_node"),
    ),
    conflictRefs: refs(source.conflictRefs, options),
    sourceRefs: refs(source.sourceRefs, options),
    omissions: (source.omissions || [])
      .map((entry) => text(entry))
      .filter(Boolean),
    ...(graphTransitionRef ? { graphTransitionRef } : {}),
  };
  result.digest = digest("direct-worldmodel-promotion-transition@1", result);
  return result;
}
function validateWorldmodelPromotionTransition(value) {
  object(value, "worldmodelPromotionTransition");
  if (value.schema !== WORLDMODEL_PROMOTION_TRANSITION_SCHEMA)
    fail(
      "direct_semantic_ingress_schema_mismatch",
      "worldmodelPromotionTransition",
    );
  required(value.promotionId, "worldmodelPromotionTransition.promotionId");
  required(value.candidateId, "worldmodelPromotionTransition.candidateId");
  required(
    value.decidedByAgentId,
    "worldmodelPromotionTransition.decidedByAgentId",
  );
  if (!["world_manager", "project_manager"].includes(value.decidedByRole))
    fail(
      "direct_semantic_ingress_invalid_decider",
      "worldmodelPromotionTransition.decidedByRole",
    );
  enumValue(
    value.decision,
    PROMOTION_DECISIONS,
    "worldmodelPromotionTransition.decision",
  );
  [
    "targetNodeIds",
    "targetEdgeIds",
    "duplicateOfNodeIds",
    "conflictRefs",
    "sourceRefs",
    "omissions",
  ].forEach((key) => list(value[key], `worldmodelPromotionTransition.${key}`));
  requireRefs(value.sourceRefs, "worldmodelPromotionTransition.sourceRefs");
  if (value.decision === "admit" && !value.graphTransitionRef)
    fail(
      "direct_semantic_ingress_admission_receipt_required",
      "worldmodelPromotionTransition",
    );
  if (value.graphTransitionRef)
    validateExactSourceRef(
      value.graphTransitionRef,
      "worldmodelPromotionTransition.graphTransitionRef",
    );
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-promotion-transition@1",
    "worldmodelPromotionTransition",
  );
  return true;
}

function requiredCustodian(scope) {
  return scope.scopeKind === "user_world"
    ? "world_manager"
    : scope.scopeKind === "project"
      ? "project_manager"
      : "thread_manager";
}
function canonicalProjectCustodyPath(scope) {
  const projectsIndex = scope.semanticPath.indexOf("projects");
  const path =
    projectsIndex >= 0
      ? scope.semanticPath.slice(projectsIndex + 2)
      : scope.semanticPath;
  return `project.${path.join(".") || "architecture"}`;
}
function validProjectCustodyWitness(witness, candidate) {
  try {
    validateProjectCustodyWriteWitness(witness);
  } catch (_) {
    return false;
  }
  return (
    witness.projectId === candidate.targetScope.projectId &&
    witness.actorRole === "project_manager" &&
    witness.controllerRole === "project_manager" &&
    witness.path === canonicalProjectCustodyPath(candidate.targetScope) &&
    witness.decision === "authorized" &&
    witness.custodyRouteSatisfied === true &&
    witness.actionAuthorityGranted === false &&
    witness.requiresGraphCas === true &&
    witness.requiresAuthorityTrace === true
  );
}
function normalizeAuthorityTrace(value, candidate, options) {
  const trace = refs([value], options)[0];
  if (
    !trace ||
    trace.sourceKind !== "promotion_decision" ||
    !text(trace.sourceId) ||
    candidate.sourceRefs.some((ref) => ref.sourceId === trace.sourceId)
  )
    return null;
  return trace;
}
function activeDuplicate(graph, candidate) {
  const basis = canonicalJson(mutationBasis(candidate));
  return (
    graph.transitions.some(
      (transition) =>
        transition.normalizedSemanticMutationDigest ===
        candidate.normalizedSemanticMutationDigest,
    ) ||
    graph.nodes.some((node) =>
      candidate.proposedNodeMutations.some(
        (mutation) =>
          mutation.operation === "add" &&
          canonicalJson(semanticNodeBasis(node)) ===
            canonicalJson(semanticNodeBasis(mutation.candidateNode)),
      ),
    )
  );
}
function candidateGraphMutations(candidate, graph) {
  const nodes = candidate.proposedNodeMutations.flatMap((mutation) => {
    if (mutation.operation === "no_change") return [];
    if (mutation.operation !== "supersede")
      return [
        {
          mutationKind:
            mutation.operation === "add"
              ? "add_node"
              : mutation.operation === "set_lifecycle"
                ? "set_node_lifecycle"
                : "revise_node",
          targetId: mutation.targetNodeId || mutation.candidateNode.nodeId,
          node: mutation.candidateNode,
          ...(mutation.operation === "set_lifecycle"
            ? { lifecycle: mutation.candidateNode.lifecycle }
            : {}),
        },
      ];
    const oldNode = graph.nodes.find(
      (node) => node.nodeId === mutation.candidateNode.supersedesNodeId,
    );
    const newNode = {
      ...mutation.candidateNode,
      supersedesNodeId: oldNode.nodeId,
    };
    return [
      {
        mutationKind: "set_node_lifecycle",
        targetId: oldNode.nodeId,
        lifecycle: "superseded",
        node: {
          supersededByNodeId: newNode.nodeId,
          projectionEligibility: "history_only",
          sourceRefs: candidate.sourceRefs,
        },
      },
      { mutationKind: "add_node", targetId: newNode.nodeId, node: newNode },
      {
        mutationKind: "add_edge",
        targetId: `supersedes_${newNode.nodeId}_${oldNode.nodeId}`,
        edge: {
          edgeId: `supersedes_${newNode.nodeId}_${oldNode.nodeId}`,
          graphId: graph.graphId,
          fromNodeId: newNode.nodeId,
          toNodeId: oldNode.nodeId,
          relationKind: "supersedes",
          epistemicStatus: "accepted",
          lifecycle: "active",
          sourceRefs: candidate.sourceRefs,
        },
      },
    ];
  });
  const edges = candidate.proposedEdgeMutations
    .filter((mutation) => mutation.operation !== "no_change")
    .map((mutation) => ({
      mutationKind: mutation.operation === "add" ? "add_edge" : "revise_edge",
      targetId: mutation.targetEdgeId || mutation.candidateEdge.edgeId,
      edge: mutation.candidateEdge,
    }));
  return [...nodes, ...edges];
}

// A graph-write authorization is intentionally only a narrow, consumable
// kernel token.  This envelope is the admission boundary that gives that
// token meaning: it closes the manager/profile, ingress chain, custody row,
// authority decision, exact graph revision and exact mutations together.
function admissionManager(
  profile,
  graph,
  actorAgentId,
  actorRole,
  targetScope,
) {
  if (actorRole === "project_manager") {
    validateProjectManagerProfile(profile);
    if (
      profile.projectManagerAgentId !== actorAgentId ||
      profile.projectId !== targetScope.projectId ||
      !graph.nodes.some(
        (node) =>
          node.nodeId === profile.projectRootNodeId &&
          node.nodeKind === "project_root" &&
          node.scope.projectId === profile.projectId &&
          node.scope.userProfileId === graph.userProfileId,
      )
    )
      fail(
        "direct_semantic_ingress_admission_manager_mismatch",
        "project manager/profile/root",
      );
    return {
      managerKind: "project_manager",
      managerId: profile.projectManagerProfileId,
      managerDigest: profile.profileDigest,
    };
  }
  if (actorRole === "world_manager") {
    validateWorldmodelManagerProfile(profile);
    if (
      profile.managerAgentId !== actorAgentId ||
      profile.scope?.scopeKind !== "global_user" ||
      profile.scope?.userProfileId !== graph.userProfileId
    )
      fail(
        "direct_semantic_ingress_admission_manager_mismatch",
        "world manager/profile",
      );
    return {
      managerKind: "world_manager",
      managerId: profile.managerProfileId,
      managerDigest: profile.profileDigest,
    };
  }
  fail("direct_semantic_ingress_admission_role_forbidden", actorRole);
}
function buildWorldmodelContextualAuthorityDecision(input = {}, options = {}) {
  const source = object(input, "contextualAuthorityDecisionInput");
  const graph = source.graph;
  validateHierarchicalWorldmodelGraph(graph);
  const actorAgentId = required(
    source.actorAgentId,
    "contextualAuthorityDecision.actorAgentId",
  );
  const actorRole = enumValue(
    source.actorRole,
    new Set(["world_manager", "project_manager"]),
    "contextualAuthorityDecision.actorRole",
  );
  const targetScope = source.targetScope;
  if (!targetScope || !TARGET_SCOPES.has(targetScope.scopeKind))
    fail(
      "direct_semantic_ingress_admission_scope_required",
      "contextualAuthorityDecision.targetScope",
    );
  const manager = admissionManager(
    source.managerProfile,
    graph,
    actorAgentId,
    actorRole,
    targetScope,
  );
  const result = {
    schema: WORLDMODEL_CONTEXTUAL_AUTHORITY_DECISION_SCHEMA,
    authorityDecisionId: normalizeId(
      source.authorityDecisionId || source.id,
      "worldmodel_contextual_authority",
    ),
    graphId: graph.graphId,
    graphDigest: graph.digest,
    userProfileId: graph.userProfileId,
    actorAgentId,
    actorRole,
    manager,
    targetScope: normalizeScope(targetScope),
    decision: "grant",
    issuedAt: text(source.issuedAt, nowIso(options.now || Date.now)),
    expiresAt: required(
      source.expiresAt,
      "contextualAuthorityDecision.expiresAt",
    ),
    oneShot: true,
    rawTextIncluded: false,
  };
  if (Date.parse(result.expiresAt) <= Date.parse(result.issuedAt))
    fail(
      "direct_semantic_ingress_admission_authority_expiry",
      "contextualAuthorityDecision",
    );
  result.digest = digest(
    "direct-worldmodel-contextual-authority-decision@1",
    result,
  );
  return result;
}
function validateWorldmodelContextualAuthorityDecision(value, context = {}) {
  object(value, "contextualAuthorityDecision");
  if (
    value.schema !== WORLDMODEL_CONTEXTUAL_AUTHORITY_DECISION_SCHEMA ||
    value.decision !== "grant" ||
    value.oneShot !== true ||
    value.rawTextIncluded !== false
  )
    fail(
      "direct_semantic_ingress_admission_authority_invalid",
      "contextualAuthorityDecision",
    );
  [
    "authorityDecisionId",
    "graphId",
    "graphDigest",
    "userProfileId",
    "actorAgentId",
    "issuedAt",
    "expiresAt",
    "digest",
  ].forEach((field) =>
    required(value[field], `contextualAuthorityDecision.${field}`),
  );
  enumValue(
    value.actorRole,
    new Set(["world_manager", "project_manager"]),
    "contextualAuthorityDecision.actorRole",
  );
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt))
    fail(
      "direct_semantic_ingress_admission_authority_expiry",
      "contextualAuthorityDecision",
    );
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-contextual-authority-decision@1",
    "contextualAuthorityDecision",
  );
  if (
    context.graph &&
    (value.graphId !== context.graph.graphId ||
      value.graphDigest !== context.graph.digest ||
      value.userProfileId !== context.graph.userProfileId)
  )
    fail(
      "direct_semantic_ingress_admission_authority_context_mismatch",
      "contextualAuthorityDecision.graph",
    );
  return true;
}
function buildWorldmodelContextualAdmission(input = {}, options = {}) {
  const source = object(input, "contextualAdmissionInput");
  const graph = source.graph;
  const candidate = source.candidate;
  const resolution = source.targetResolution;
  const ingress = source.ingressEnvelope;
  const broker = source.brokerPacket;
  validateHierarchicalWorldmodelGraph(graph);
  validateWorldmodelIngressEnvelope(ingress);
  validateSemanticIngressBrokerPacket(broker);
  validateSemanticTargetResolution(resolution);
  validateWorldmodelDeltaCandidate(candidate);
  const actorAgentId = required(
    source.decidedByAgentId,
    "contextualAdmission.decidedByAgentId",
  );
  const actorRole = enumValue(
    source.decidedByRole,
    new Set(["world_manager", "project_manager"]),
    "contextualAdmission.decidedByRole",
  );
  const mutations = candidateGraphMutations(candidate, graph);
  if (!mutations.length)
    fail(
      "direct_semantic_ingress_admission_mutations_required",
      "contextualAdmission",
    );
  const expected = candidate.expectedScopeRevisions.map(
    buildScopedWorldmodelRevisionRef,
  );
  const authorityDecision = source.authorityDecision;
  validateWorldmodelContextualAuthorityDecision(authorityDecision, { graph });
  const manager = admissionManager(
    source.managerProfile,
    graph,
    actorAgentId,
    actorRole,
    candidate.targetScope,
  );
  const matrix = source.custodyMatrix;
  const witness = source.custodyWriteWitness;
  if (candidate.targetScope.scopeKind === "project") {
    validateProjectCustodyWriteMatrix(matrix);
    validateProjectCustodyWriteWitness(witness);
    if (
      matrix.projectId !== candidate.targetScope.projectId ||
      witness.matrixRef.digest !== matrix.matrixDigest ||
      witness.projectId !== candidate.targetScope.projectId ||
      witness.actorRole !== "project_manager" ||
      witness.decision !== "authorized"
    )
      fail(
        "direct_semantic_ingress_admission_custody_mismatch",
        "contextualAdmission.custody",
      );
  }
  const result = {
    schema: WORLDMODEL_CONTEXTUAL_ADMISSION_SCHEMA,
    admissionId: normalizeId(
      source.admissionId || source.id,
      "worldmodel_contextual_admission",
    ),
    graphRef: {
      graphId: graph.graphId,
      graphDigest: graph.digest,
      userProfileId: graph.userProfileId,
    },
    ingressEnvelope: ingress,
    brokerPacket: broker,
    targetResolution: resolution,
    candidate,
    managerProfile: source.managerProfile,
    manager,
    custodyMatrix: matrix || null,
    custodyWriteWitness: witness || null,
    authorityDecision,
    actorAgentId,
    actorRole,
    expectedScopeRevisions: expected,
    mutations,
    normalizedSemanticMutationDigest: normalizedMutationDigest(mutations),
    candidateMutationDigest: candidate.normalizedSemanticMutationDigest,
    idempotencyKey: required(
      source.idempotencyKey,
      "contextualAdmission.idempotencyKey",
    ),
    expiresAt: authorityDecision.expiresAt,
    oneShot: true,
    rawTextIncluded: false,
  };
  // Admission is only a portable receipt until this exact bundle has been
  // admitted by the current revision of the durable governance registry.
  const { requireGovernanceProvenanceAdmission, registryRef } = require("./governance-provenance-registry");
  const root = candidate.targetScope.projectId ? graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === candidate.targetScope.projectId) : null;
  const managerKind = actorRole === "world_manager" ? "world_manager_profile" : "project_manager_profile";
  const managerId = actorRole === "world_manager" ? source.managerProfile.managerProfileId : source.managerProfile.projectManagerProfileId;
  const managerDigest = source.managerProfile.profileDigest;
  const requiredArtifacts = [
    { kind: managerKind, id: managerId, digest: managerDigest },
    { kind: "authority_decision", id: authorityDecision.authorityDecisionId, digest: authorityDecision.digest, oneShot: true },
  ];
  if (root) requiredArtifacts.push({ kind: "project_root", id: root.nodeId, digest: root.digest });
  if (matrix) requiredArtifacts.push({ kind: "custody_matrix", id: matrix.matrixId, digest: matrix.matrixDigest });
  if (witness) requiredArtifacts.push({ kind: "custody_witness", id: witness.path, digest: witness.writeWitnessDigest });
  if (source.parentDelegation) requiredArtifacts.push({ kind: "parent_delegation", id: source.parentDelegation.delegationId, digest: source.parentDelegation.delegationDigest });
  const registryContext = { registryRef: source.registryRef || registryRef(source.governanceRegistry), expectedRegistryRevision: source.expectedRegistryRevision, graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: candidate.targetScope.scopeKind, projectId: candidate.targetScope.projectId, workThreadId: candidate.targetScope.workThreadId, projectRootNodeId: root?.nodeId, role: actorRole, agentId: actorAgentId, purpose: "graph_append", expectedScopeRevisionDigest: expected.find((ref) => ref.scopeKind === candidate.targetScope.scopeKind && ref.projectId === candidate.targetScope.projectId && ref.workThreadId === candidate.targetScope.workThreadId)?.digest, requiredArtifacts };
  requireGovernanceProvenanceAdmission(source.governanceRegistry, registryContext);
  result.registryRef = registryContext.registryRef;
  result.registryRevision = registryContext.expectedRegistryRevision;
  result.registryRequiredArtifacts = requiredArtifacts;
  result.digest = digest("direct-worldmodel-contextual-admission@1", result);
  validateWorldmodelContextualAdmission(result, { graph, governanceRegistry: source.governanceRegistry });
  return result;
}
function validateWorldmodelContextualAdmission(value, context = {}) {
  object(value, "contextualAdmission");
  if (
    value.schema !== WORLDMODEL_CONTEXTUAL_ADMISSION_SCHEMA ||
    value.oneShot !== true ||
    value.rawTextIncluded !== false
  )
    fail("direct_semantic_ingress_admission_invalid", "contextualAdmission");
  const graph = context.graph;
  if (!graph)
    fail(
      "direct_semantic_ingress_admission_graph_context_required",
      "contextualAdmission",
    );
  validateHierarchicalWorldmodelGraph(graph);
  validateWorldmodelIngressEnvelope(value.ingressEnvelope);
  validateSemanticIngressBrokerPacket(value.brokerPacket);
  validateSemanticTargetResolution(value.targetResolution);
  validateWorldmodelDeltaCandidate(value.candidate);
  validateWorldmodelContextualAuthorityDecision(value.authorityDecision, {
    graph,
  });
  const { requireGovernanceProvenanceAdmission } = require("./governance-provenance-registry");
  if (!value.registryRef || !Number.isInteger(value.registryRevision) || !Array.isArray(value.registryRequiredArtifacts)) fail("direct_semantic_ingress_admission_registry_required", "contextualAdmission");
  if (
    value.graphRef?.graphId !== graph.graphId ||
    value.graphRef?.graphDigest !== graph.digest ||
    value.graphRef?.userProfileId !== graph.userProfileId ||
    value.ingressEnvelope.ingressId !==
      value.brokerPacket.ingressRef.sourceId ||
    value.brokerPacket.targetResolution.ingressId !==
      value.ingressEnvelope.ingressId ||
    value.targetResolution.digest !==
      value.brokerPacket.targetResolution.digest ||
    value.targetResolution.resolutionId !==
      value.candidate.targetResolutionId ||
    value.targetResolution.ingressId !== value.candidate.ingressId ||
    value.authorityDecision.actorAgentId !== value.actorAgentId ||
    value.authorityDecision.actorRole !== value.actorRole ||
    value.expiresAt !== value.authorityDecision.expiresAt
  )
    fail(
      "direct_semantic_ingress_admission_chain_mismatch",
      "contextualAdmission",
    );
  const target = value.targetResolution.candidateTargets.find(
    (scope) =>
      scope.scopeKind === value.candidate.targetScope.scopeKind &&
      scope.projectId === value.candidate.targetScope.projectId &&
      scope.workThreadId === value.candidate.targetScope.workThreadId &&
      canonicalJson(scope.semanticPath) ===
        canonicalJson(value.candidate.targetScope.semanticPath),
  );
  if (
    !target ||
    value.candidate.proposedNodeMutations.some(
      (mutation) =>
        mutation.candidateNode.graphId !== graph.graphId ||
        mutation.candidateNode.scope.userProfileId !== graph.userProfileId ||
        mutation.candidateNode.scope.scopeKind !==
          value.candidate.targetScope.scopeKind ||
        mutation.candidateNode.scope.projectId !==
          value.candidate.targetScope.projectId ||
        mutation.candidateNode.scope.workThreadId !==
          value.candidate.targetScope.workThreadId,
    ) ||
    value.candidate.sourceRefs.some(
      (ref) =>
        !value.ingressEnvelope.sourceRefs.some(
          (source) =>
            source.sourceId === ref.sourceId &&
            source.sourceDigest?.value === ref.sourceDigest?.value,
        ),
    )
  )
    fail(
      "direct_semantic_ingress_admission_target_mismatch",
      "contextualAdmission",
    );
  const mutations = candidateGraphMutations(value.candidate, graph);
  if (
    canonicalJson(mutations) !== canonicalJson(value.mutations) ||
    normalizedMutationDigest(mutations) !==
      value.normalizedSemanticMutationDigest ||
    value.candidateMutationDigest !==
      value.candidate.normalizedSemanticMutationDigest ||
    canonicalJson(
      value.expectedScopeRevisions.map((ref) => ref.digest).sort(),
    ) !==
      canonicalJson(
        value.candidate.expectedScopeRevisions.map((ref) => ref.digest).sort(),
      )
  )
    fail(
      "direct_semantic_ingress_admission_mutation_mismatch",
      "contextualAdmission",
    );
  admissionManager(
    value.managerProfile,
    graph,
    value.actorAgentId,
    value.actorRole,
    value.candidate.targetScope,
  );
  if (value.candidate.targetScope.scopeKind === "project") {
    validateProjectCustodyWriteMatrix(value.custodyMatrix);
    validateProjectCustodyWriteWitness(value.custodyWriteWitness);
    if (
      value.custodyMatrix.projectId !== value.candidate.targetScope.projectId ||
      value.custodyWriteWitness.matrixRef.digest !==
        value.custodyMatrix.matrixDigest ||
      value.custodyWriteWitness.path !==
        canonicalProjectCustodyPath(value.candidate.targetScope) ||
      value.custodyWriteWitness.actorRole !== "project_manager" ||
      value.custodyWriteWitness.decision !== "authorized"
    )
      fail(
        "direct_semantic_ingress_admission_custody_mismatch",
        "contextualAdmission",
      );
  }
  if (
    value.authorityDecision.targetScope.scopeKind !==
      value.candidate.targetScope.scopeKind ||
    value.authorityDecision.targetScope.projectId !==
      value.candidate.targetScope.projectId ||
    value.authorityDecision.targetScope.workThreadId !==
      value.candidate.targetScope.workThreadId ||
    Date.parse(value.expiresAt) <= Date.now()
  )
    fail(
      "direct_semantic_ingress_admission_authority_invalid",
      "contextualAdmission",
    );
  const projectRoot = value.candidate.targetScope.projectId ? graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === value.candidate.targetScope.projectId) : null;
  requireGovernanceProvenanceAdmission(context.governanceRegistry, {
    registryRef: value.registryRef, expectedRegistryRevision: value.registryRevision,
    graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId,
    scopeKind: value.candidate.targetScope.scopeKind, projectId: value.candidate.targetScope.projectId, workThreadId: value.candidate.targetScope.workThreadId,
    projectRootNodeId: projectRoot?.nodeId, role: value.actorRole, agentId: value.actorAgentId, purpose: "graph_append",
    expectedScopeRevisionDigest: value.expectedScopeRevisions.find((ref) => ref.scopeKind === value.candidate.targetScope.scopeKind && ref.projectId === value.candidate.targetScope.projectId && ref.workThreadId === value.candidate.targetScope.workThreadId)?.digest,
    requiredArtifacts: value.registryRequiredArtifacts,
  });
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-contextual-admission@1",
    "contextualAdmission",
  );
  return true;
}
function assessWorldmodelPromotion(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const graph = source.graph;
  const candidate = source.candidate;
  const resolution = source.targetResolution;
  validateHierarchicalWorldmodelGraph(graph);
  validateWorldmodelDeltaCandidate(candidate);
  validateSemanticTargetResolution(resolution);
  const base = {
    candidateId: candidate.candidateId,
    decidedByAgentId: source.decidedByAgentId,
    decidedByRole: source.decidedByRole,
    sourceRefs: candidate.sourceRefs,
    targetNodeIds: candidate.proposedNodeMutations.map(
      (mutation) => mutation.targetNodeId || mutation.candidateNode.nodeId,
    ),
    targetEdgeIds: candidate.proposedEdgeMutations.map(
      (mutation) => mutation.targetEdgeId || mutation.candidateEdge.edgeId,
    ),
    omissions: [],
  };
  if (source.currentIngress) {
    validateWorldmodelIngressEnvelope(source.currentIngress);
    if (
      source.currentIngress.currentInstructionAuthority === true &&
      source.currentIngress.ingressId !== candidate.ingressId
    )
      return {
        promotion: buildWorldmodelPromotionTransition(
          {
            ...base,
            decision: "remand",
            omissions: ["historical_instruction_cannot_beat_current_ingress"],
          },
          options,
        ),
        graph,
        committed: false,
      };
  }
  if (
    resolution.ingressId !== candidate.ingressId ||
    resolution.resolutionId !== candidate.targetResolutionId
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["target_resolution_does_not_bind_candidate"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (["remand", "multi_scope_split"].includes(resolution.route))
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision:
            resolution.route === "multi_scope_split" ? "split" : "remand",
          omissions: [resolution.route],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (!candidate.sourceRefs.length)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "reject",
          omissions: ["source_evidence_required"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (candidate.candidateState !== "accepted_for_commit")
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "defer",
          omissions: ["candidate_not_accepted_for_commit"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  const custodian = requiredCustodian(candidate.targetScope);
  const allowedDescent =
    candidate.receivedByRole === "world_manager" &&
    candidate.targetScope.scopeKind === "project" &&
    resolution.route === "world_to_project_descent" &&
    source.decidedByRole === "project_manager";
  if (
    custodian === "thread_manager" ||
    (source.decidedByRole !== custodian && !allowedDescent)
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["custody_write_route_required"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (
    candidate.targetScope.scopeKind === "project" &&
    !validProjectCustodyWitness(source.custodyWriteWitness, candidate)
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["valid_project_custody_witness_required"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  const authorityTraceRef = normalizeAuthorityTrace(
    source.authorityTraceRef,
    candidate,
    options,
  );
  if (!authorityTraceRef)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["separate_authority_trace_required"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (
    source.explicitPromotionRequested !== true &&
    ["provider_output", "tool_output"].includes(candidate.promotionOrigin)
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "defer",
          omissions: ["provider_or_tool_requires_explicit_promotion"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  const current = expectedScopeFor(graph, candidate.targetScope);
  const expected = candidate.expectedScopeRevisions.find(
    (ref) =>
      ref.scopeKind === candidate.targetScope.scopeKind &&
      ref.projectId === candidate.targetScope.projectId &&
      ref.workThreadId === candidate.targetScope.workThreadId,
  );
  if (
    !current ||
    !expected ||
    current.revision !== expected.revision ||
    current.digest !== expected.digest
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        { ...base, decision: "remand", omissions: ["stale_scope_revision"] },
        options,
      ),
      graph,
      committed: false,
    };
  const invalidSupersession = candidate.proposedNodeMutations.find(
    (mutation) =>
      mutation.operation === "supersede" &&
      (!text(mutation.candidateNode.supersedesNodeId) ||
        mutation.candidateNode.nodeId ===
          mutation.candidateNode.supersedesNodeId ||
        !graph.nodes.some(
          (node) => node.nodeId === mutation.candidateNode.supersedesNodeId,
        )),
  );
  if (invalidSupersession)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["supersession_target_missing"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (
    candidate.proposedEdgeMutations.some(
      (mutation) => mutation.operation === "supersede",
    )
  )
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "remand",
          omissions: ["edge_supersession_not_supported"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (activeDuplicate(graph, candidate))
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "defer",
          duplicateOfNodeIds: base.targetNodeIds,
          omissions: ["duplicate_semantic_mutation"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  const conflicting = candidate.proposedNodeMutations.find(
    (mutation) =>
      mutation.operation === "add" &&
      graph.nodes.some(
        (node) =>
          node.nodeId === mutation.candidateNode.nodeId &&
          node.digest !== mutation.candidateNode.digest,
      ),
  );
  if (conflicting)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          ...base,
          decision: "conflict",
          conflictRefs: [
            sourceRef(
              "worldmodel_node",
              conflicting.candidateNode.nodeId,
              graph.nodes.find(
                (node) => node.nodeId === conflicting.candidateNode.nodeId,
              ).digest,
              options,
            ),
          ],
          omissions: ["node_id_conflict"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  return { promotion: null, graph, committed: false };
}
function promoteWorldmodelDeltaCandidate(input = {}, options = {}) {
  const audit = assessWorldmodelPromotion(input, options);
  if (audit.promotion) return audit;
  const { graph, candidate } = input;
  const mutations = candidateGraphMutations(candidate, graph);
  if (!mutations.length)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          candidateId: candidate.candidateId,
          decidedByAgentId: input.decidedByAgentId,
          decidedByRole: input.decidedByRole,
          decision: "defer",
          sourceRefs: candidate.sourceRefs,
          omissions: ["no_semantic_mutation"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  if (!input.contextualAdmission || !input.writeAuthorization)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          candidateId: candidate.candidateId,
          decidedByAgentId: input.decidedByAgentId,
          decidedByRole: input.decidedByRole,
          decision: "remand",
          sourceRefs: candidate.sourceRefs,
          omissions: ["contextual_admission_and_write_authorization_required"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  try {
    validateWorldmodelContextualAdmission(input.contextualAdmission, { graph, governanceRegistry: input.governanceRegistry });
  } catch (error) {
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          candidateId: candidate.candidateId,
          decidedByAgentId: input.decidedByAgentId,
          decidedByRole: input.decidedByRole,
          decision: "remand",
          sourceRefs: candidate.sourceRefs,
          omissions: [error.code || "contextual_admission_invalid"],
        },
        options,
      ),
      graph,
      committed: false,
    };
  }
  const authorityTraceRef = normalizeAuthorityTrace(
    input.authorityTraceRef,
    candidate,
    options,
  );
  const transitionInput = {
    transitionId: normalizeId(
      input.graphTransitionId,
      "semantic_promotion_transition",
    ),
    deltaCandidateId: candidate.candidateId,
    actorAgentId: normalizeId(input.decidedByAgentId, "manager_agent"),
    actorRole: input.decidedByRole,
    idempotencyKey: text(
      input.idempotencyKey,
      `promotion_${candidate.normalizedSemanticMutationDigest.slice(-24)}`,
    ),
    authorityTraceRef,
    sourceRefs: candidate.sourceRefs,
    expectedScopeRevisions: candidate.expectedScopeRevisions,
    mutations,
    createdAt: input.createdAt,
    normalizedSemanticMutationDigest:
      candidate.normalizedSemanticMutationDigest,
  };
  const result = appendWorldmodelGraphTransition(
    graph,
    {
      ...transitionInput,
      writeAuthorization: input.writeAuthorization,
      contextualAdmission: input.contextualAdmission,
      governanceRegistry: input.governanceRegistry,
      storeAdmission: input.storeAdmission,
    },
    options,
  );
  if (!result.committed)
    return {
      promotion: buildWorldmodelPromotionTransition(
        {
          candidateId: candidate.candidateId,
          decidedByAgentId: input.decidedByAgentId,
          decidedByRole: input.decidedByRole,
          decision: "remand",
          sourceRefs: candidate.sourceRefs,
          omissions: [result.remand?.code || "graph_cas_remand"],
        },
        options,
      ),
      graph: result.graph,
      committed: false,
      remand: result.remand,
    };
  const promotion = buildWorldmodelPromotionTransition(
    {
      promotionId: input.promotionId,
      candidateId: candidate.candidateId,
      decidedByAgentId: input.decidedByAgentId,
      decidedByRole: input.decidedByRole,
      decision: "admit",
      targetNodeIds: candidate.proposedNodeMutations.map(
        (mutation) => mutation.targetNodeId || mutation.candidateNode.nodeId,
      ),
      targetEdgeIds: candidate.proposedEdgeMutations.map(
        (mutation) => mutation.targetEdgeId || mutation.candidateEdge.edgeId,
      ),
      sourceRefs: candidate.sourceRefs,
      graphTransitionRef: {
        id: result.transition.transitionId,
        digest: result.transition.digest,
      },
    },
    options,
  );
  validateWorldmodelPromotionTransition(promotion);
  return {
    promotion,
    graph: result.graph,
    governanceRegistry: result.governanceRegistry,
    transition: result.transition,
    committed: true,
  };
}

module.exports = {
  WORLDMODEL_INGRESS_ENVELOPE_SCHEMA,
  TRANSCRIPT_EVIDENCE_REF_SCHEMA,
  TRANSCRIPT_INSPECTION_ARTIFACT_SCHEMA,
  SEMANTIC_INGRESS_BROKER_PACKET_SCHEMA,
  SEMANTIC_TARGET_RESOLUTION_SCHEMA,
  WORLDMODEL_DELTA_CANDIDATE_SCHEMA,
  WORLDMODEL_PROMOTION_TRANSITION_SCHEMA,
  WORLDMODEL_CONTEXTUAL_ADMISSION_SCHEMA,
  WORLDMODEL_CONTEXTUAL_AUTHORITY_DECISION_SCHEMA,
  NON_ACTIVE_LIFECYCLES,
  buildWorldmodelIngressEnvelope,
  validateWorldmodelIngressEnvelope,
  buildTranscriptEvidenceRef,
  validateTranscriptEvidenceRef,
  buildTranscriptInspectionArtifact,
  validateTranscriptInspectionArtifact,
  buildSemanticTargetResolution,
  validateSemanticTargetResolution,
  buildSemanticIngressBrokerPacket,
  validateSemanticIngressBrokerPacket,
  commitSemanticIngressBrokerPacket,
  buildWorldmodelDeltaCandidate,
  validateWorldmodelDeltaCandidate,
  splitWorldmodelDeltaCandidate,
  buildWorldmodelPromotionTransition,
  validateWorldmodelPromotionTransition,
  buildWorldmodelContextualAuthorityDecision,
  validateWorldmodelContextualAuthorityDecision,
  buildWorldmodelContextualAdmission,
  validateWorldmodelContextualAdmission,
  assessWorldmodelPromotion,
  promoteWorldmodelDeltaCandidate,
};
