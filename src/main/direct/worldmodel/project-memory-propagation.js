"use strict";

// Wave 26 PR 155.  These packets are projection/control evidence only: the
// hierarchical graph remains the single semantic truth and PR153 remains its
// sole promotion/CAS controller.
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const { validateOdeuResultEnvelope } = require("../odeu/result");
const { buildWorkThread } = require("../bridge/work-thread-registry");
const {
  appendWorldmodelGraphTransition,
  buildGraphWriteAuthorizationForTransition,
  buildWorldmodelSemanticNode,
  validateHierarchicalWorldmodelGraph,
  validateWorldmodelSemanticNode,
} = require("./hierarchical-graph");
const {
  buildGraphOdeuCompilation,
  buildManagerTurnBootPacket,
  admitManagerTurnBootPacket,
  validateGraphOdeuCompilation,
  validateManagerTurnBootPacket,
} = require("./manager-turn-context");
const { buildWorldmodelProjectionPolicy, buildWorldmodelGraphProjection, validateWorldmodelGraphProjection } = require("./graph-projection");
const {
  registryRef: governanceRegistryRef,
  validateGovernanceProvenanceRegistry,
} = require("./governance-provenance-registry");
const {
  resolveAuthoritativeWorldmodelTrustStore,
  installAuthoritativeWorldmodelGovernanceRegistry,
  admitWorldmodelGovernanceRequest,
} = require("./governance-trust-store");
const {
  buildProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  validateProjectManagerProfile,
} = require("./project-manager");
const {
  buildSemanticIngressBrokerPacket,
  buildSemanticTargetResolution,
  buildWorldmodelContextualAdmission,
  buildWorldmodelContextualAuthorityDecision,
  buildWorldmodelDeltaCandidate,
  buildWorldmodelIngressEnvelope,
  promoteWorldmodelDeltaCandidate,
} = require("./semantic-ingress");

const PROJECT_MEMORY_CANDIDATE_SCHEMA = "direct_project_memory_candidate@1";
const WORK_THREAD_CLOSURE_EVIDENCE_WITNESS_SCHEMA =
  "direct_work_thread_closure_evidence_witness@1";
const SCOPED_WORLD_MEMORY_BINDING_SCHEMA =
  "direct_scoped_world_memory_binding@1";
const WORLD_TO_PROJECT_UPDATE_PACKET_SCHEMA =
  "direct_world_to_project_update_packet@1";
const PROJECT_TO_WORLD_STATUS_PROJECTION_SCHEMA =
  "direct_project_to_world_status_projection@1";
const PROJECT_GRAPH_UPDATE_ACKNOWLEDGEMENT_SCHEMA =
  "direct_project_graph_update_acknowledgement@1";
const PROJECT_MEMORY_ADMISSION_SCHEMA = "direct_project_memory_admission@1";
const PROJECT_UPDATE_IMPACT_WITNESS_SCHEMA =
  "direct_project_update_impact_witness@1";
const CROSS_PROJECT_MEMORY_ESCALATION_SCHEMA =
  "direct_cross_project_memory_escalation@1";
const PROPAGATION_RECORD_SCHEMA = "direct_project_world_propagation_record@1";
const PROPAGATION_STATE_STORE_SCHEMA = "direct_project_world_propagation_state_store@1";

// These are deliberately module-private capabilities.  A file-backed store is
// not an authority merely because it has the right-looking methods: only a
// handle made by this factory is recognised, and only an owner controller can
// recover its operations.  The persisted state and its operations stay in the
// closure/WeakMap rather than on a caller-supplied object.
const PROPAGATION_STORE_HANDLES = new WeakMap();
const PROPAGATION_CONTROLLERS = new WeakMap();
const INTERNAL_PROPAGATION_ADMISSION = Symbol("internal_propagation_admission");

const KINDS = new Set([
  "project_fact",
  "decision",
  "invariant",
  "constraint",
  "open_question",
  "risk",
  "procedure",
  "pattern",
  "progress",
]);
const BINDING_STATES = new Set([
  "graph_primary",
  "legacy_memory_primary",
  "migration_pending",
  "agent_private_unpromoted",
]);
const UPDATE_KINDS = new Set([
  "goal_change",
  "idea_admitted",
  "global_preference_relevance",
  "global_policy_relevance",
  "environment_change",
  "profile_change",
  "cross_project_dependency",
]);
const FORCES = new Set(["binding", "candidate", "informational"]);
const MATERIALITIES = new Set([
  "immediate_rebase",
  "next_safe_checkpoint",
  "next_manager_turn",
  "future_work_only",
]);
const ACKS = new Set([
  "applied",
  "already_current",
  "scheduled_checkpoint",
  "stale_remand",
  "conflict_remand",
]);
const ADMISSION_DECISIONS = new Set(["admit", "defer", "reject", "remand"]);
const IMPACTS = new Set([
  "immediate_rebase_block",
  "next_safe_checkpoint",
  "next_manager_turn",
  "no_invalidation",
  "unaffected",
]);
const PROPAGATION_STATES = new Set(["pending", "delivered", "applied", "failed", "stale_remand"]);
const CHANGE_CLASSES = new Set([
  "authority_revocation",
  "terminal_goal_contradiction",
  "active_architecture_change",
  "active_goal_change",
  "ordinary_idea",
  "historical_only",
]);
const DIGEST_FIELDS = new Set([
  "digest",
  "candidateDigest",
  "bindingDigest",
  "packetDigest",
  "projectionDigest",
  "acknowledgementDigest",
  "admissionDigest",
  "impactDigest",
  "escalationDigest",
  "propagationDigest",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function object(value, label) {
  if (!isPlainObject(value))
    fail("direct_project_memory_invalid_object", label);
  return value;
}
function string(value, label) {
  const result = normalizeString(value, "");
  if (!result) fail("direct_project_memory_missing_string", label);
  return result;
}
function array(value, label) {
  if (!Array.isArray(value)) fail("direct_project_memory_missing_array", label);
  return value;
}
function integer(value, label) {
  if (!Number.isInteger(value) || value < 0)
    fail("direct_project_memory_invalid_revision", label);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      if (!DIGEST_FIELDS.has(key) && typeof value[key] !== "undefined")
        out[key] = stable(value[key]);
      return out;
    }, {});
}
function digest(domain, value) {
  return sha256(
    `${domain}\0${canonicalJson(stable(value), { omitDigestFields: false })}`,
  );
}
function checked(value, field, domain, label) {
  if (string(value[field], `${label}.${field}`) !== digest(domain, value))
    fail("direct_project_memory_digest_mismatch", label);
}
function closed(value, allowed, label) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key))
      fail("direct_project_memory_closed_schema_violation", `${label}.${key}`);
  });
}
function noRawOrAuthority(value, label) {
  object(value, label);
  for (const [key, entry] of Object.entries(value)) {
    if (
      /raw|prompt|transcript|tool|spawn|action.*authority|authority.*grant/i.test(
        key,
      ) &&
      entry !== false &&
      entry !== "" &&
      entry != null
    )
      fail(
        "direct_project_memory_authority_or_raw_forbidden",
        `${label}.${key}`,
      );
    if (isPlainObject(entry)) noRawOrAuthority(entry, `${label}.${key}`);
    if (Array.isArray(entry))
      entry.forEach((child, index) => {
        if (isPlainObject(child))
          noRawOrAuthority(child, `${label}.${key}.${index}`);
      });
  }
}
function exactRefs(values, label, { required = true } = {}) {
  const refs = array(values, label);
  if (required && !refs.length)
    fail("direct_project_memory_evidence_required", label);
  const keys = new Set();
  refs.forEach((ref, index) => {
    object(ref, `${label}.${index}`);
    string(ref.sourceRefId, `${label}.${index}.sourceRefId`);
    const sourceId = string(ref.sourceId, `${label}.${index}.sourceId`);
    const value = ref.sourceDigest?.value;
    if (
      ref.sourceDigest?.algorithm !== "sha256" ||
      !normalizeString(value, "").startsWith("sha256:")
    )
      fail("direct_project_memory_exact_digest_required", `${label}.${index}`);
    if (
      ref.rawTextIncluded === true ||
      ref.rawPathIncluded === true ||
      ref.rawSecretIncluded === true
    )
      fail("direct_project_memory_raw_ref_forbidden", `${label}.${index}`);
    const key = `${ref.sourceRefId}:${sourceId}:${value}`;
    if (keys.has(key)) fail("direct_project_memory_duplicate_ref", label);
    keys.add(key);
  });
  return true;
}
function refs(values, options) {
  return normalizeOdeuSourceRefs(values, options).sort((a, b) =>
    `${a.sourceRefId}:${a.sourceId || ""}`.localeCompare(
      `${b.sourceRefId}:${b.sourceId || ""}`,
    ),
  );
}
function nodeRef(value, label) {
  object(value, label);
  const kind = string(value.kind, `${label}.kind`);
  string(value.id, `${label}.id`);
  if (
    !string(value.digest, `${label}.digest`).startsWith("sha256:") ||
    /memory|evidence|procedure|operational/i.test(kind)
  )
    fail("direct_project_memory_non_strategic_ref", label);
  if (
    value.rawTextIncluded === true ||
    value.rawPathIncluded === true ||
    value.rawSecretIncluded === true
  )
    fail("direct_project_memory_raw_ref_forbidden", label);
  return value;
}
function nodeRefs(values, label, required = false) {
  const result = array(values, label);
  if (required && !result.length)
    fail("direct_project_memory_evidence_required", label);
  result.forEach((ref, index) => nodeRef(ref, `${label}.${index}`));
  return true;
}
function normalizedNodeRef(value = {}, kind = "worldmodel_semantic_node") {
  const source = isPlainObject(value) ? value : {};
  const digestValue = normalizeString(source.digest, "");
  if (!digestValue.startsWith("sha256:"))
    fail("direct_project_memory_exact_digest_required", "semanticRef");
  return {
    kind: normalizeString(source.kind, kind),
    id: normalizeId(source.id || source.nodeId, "semantic_node"),
    digest: digestValue,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}
function projectPath(projectId, value) {
  const path = (Array.isArray(value) ? value : [])
    .map((entry) => normalizeString(entry, ""))
    .filter(Boolean);
  return path.length >= 3 &&
    path[0] === "projects" &&
    path[1] === projectId &&
    path[2] === "memory"
    ? path
    : ["projects", projectId, "memory", ...path];
}
function sourceRef(value = {}, options) {
  return refs([value], options)[0];
}

function closureArtifactRef(sourceRefId, sourceId, digestValue, options) {
  return sourceRef(
    {
      sourceRefId,
      sourceKind: "family_specific",
      sourceId,
      sourceConfidence: "exact",
      freshness: "fresh",
      sourceDigest: {
        algorithm: "sha256",
        value: digestValue,
        digestOf: "canonical_json",
      },
    },
    options,
  );
}
function closureIdentity(input = {}) {
  const source = object(input, "closureIdentity");
  return {
    managerProfileId: normalizeId(string(source.managerProfileId, "closureIdentity.managerProfileId"), "manager_profile"),
    managerAgentId: normalizeId(string(source.managerAgentId, "closureIdentity.managerAgentId"), "manager_agent"),
    runId: normalizeId(string(source.runId, "closureIdentity.runId"), "manager_run"),
    callId: normalizeId(string(source.callId, "closureIdentity.callId"), "odeu_capability_call"),
  };
}
function validateClosureArtifacts(
  workThread,
  closureResultEnvelope,
  projectId,
  identity,
) {
  object(workThread, "workThread");
  const rebuilt = buildWorkThread(workThread, {
    nowMs: Date.parse(workThread.updatedAt) || Date.now(),
  });
  if (
    workThread.schema !== "direct_work_thread@1" ||
    rebuilt.digest !== workThread.digest ||
    canonicalJson(rebuilt) !== canonicalJson(workThread) ||
    !["completed", "archived"].includes(workThread.lifecycleState) ||
    workThread.projectId !== projectId ||
    !normalizeString(workThread.workThreadId, "") ||
    !normalizeString(workThread.digest, "").startsWith("sha256:")
  )
    fail("direct_project_memory_closure_work_thread_invalid", "workThread");
  try {
    validateOdeuResultEnvelope(closureResultEnvelope);
  } catch (_) {
    fail(
      "direct_project_memory_closure_result_invalid",
      "closureResultEnvelope",
    );
  }
  if (
    !normalizeString(closureResultEnvelope.resultEnvelopeId, "") ||
    !normalizeString(
      closureResultEnvelope.artifactDigest?.value,
      "",
    ).startsWith("sha256:") ||
    !["agent_result", "status"].includes(closureResultEnvelope.resultKind) ||
    closureResultEnvelope.rawTextIncluded !== false ||
    closureResultEnvelope.rawPathIncluded !== false ||
    closureResultEnvelope.rawProviderPayloadIncluded !== false
  )
    fail(
      "direct_project_memory_closure_result_invalid",
      "closureResultEnvelope",
    );
  if (!identity || closureResultEnvelope.callId !== identity.callId || closureResultEnvelope.transactionId !== identity.runId)
    fail("direct_project_memory_closure_identity_mismatch", "closureResultEnvelope");
}
function buildWorkThreadClosureEvidenceWitness(input = {}, options = {}) {
  const source = object(input, "workThreadClosureEvidenceWitnessInput");
  const projectId = normalizeId(source.projectId, "project");
  const identity = closureIdentity(source.closureIdentity);
  validateClosureArtifacts(
    source.workThread,
    source.closureResultEnvelope,
    projectId,
    identity,
  );
  const workThreadRef = closureArtifactRef(
    `work_thread_${source.workThread.workThreadId}`,
    source.workThread.workThreadId,
    source.workThread.digest,
    options,
  );
  const closureReportRef = closureArtifactRef(
    `work_thread_closure_${source.closureResultEnvelope.resultEnvelopeId}`,
    source.closureResultEnvelope.resultEnvelopeId,
    source.closureResultEnvelope.artifactDigest.value,
    options,
  );
  const result = {
    schema: WORK_THREAD_CLOSURE_EVIDENCE_WITNESS_SCHEMA,
    witnessId: normalizeId(
      source.witnessId || source.id,
      "work_thread_closure",
    ),
    projectId,
    closureIdentity: identity,
    workThreadRef,
    closureReportRef,
    closureState: "closed",
    evidenceValidated: true,
    actionAuthorityGranted: false,
    toolAuthorityGranted: false,
    spawnAuthorityGranted: false,
    sourceRefs: refs(
      source.sourceRefs || [workThreadRef, closureReportRef],
      options,
    ),
  };
  result.digest = digest(
    "direct-work-thread-closure-evidence-witness@1",
    result,
  );
  return result;
}
function validateWorkThreadClosureEvidenceWitness(value, context = {}) {
  object(value, "workThreadClosureEvidenceWitness");
  closed(
    value,
    new Set([
      "schema",
      "witnessId",
      "projectId",
      "closureIdentity",
      "workThreadRef",
      "closureReportRef",
      "closureState",
      "evidenceValidated",
      "actionAuthorityGranted",
      "toolAuthorityGranted",
      "spawnAuthorityGranted",
      "sourceRefs",
      "digest",
    ]),
    "workThreadClosureEvidenceWitness",
  );
  if (value.schema !== WORK_THREAD_CLOSURE_EVIDENCE_WITNESS_SCHEMA)
    fail(
      "direct_project_memory_schema_mismatch",
      "workThreadClosureEvidenceWitness",
    );
  ["witnessId", "projectId"].forEach((key) =>
    string(value[key], `workThreadClosureEvidenceWitness.${key}`),
  );
  const identity = closureIdentity(value.closureIdentity);
  exactRefs(
    [value.workThreadRef],
    "workThreadClosureEvidenceWitness.workThreadRef",
  );
  exactRefs(
    [value.closureReportRef],
    "workThreadClosureEvidenceWitness.closureReportRef",
  );
  exactRefs(value.sourceRefs, "workThreadClosureEvidenceWitness.sourceRefs");
  if (
    value.closureState !== "closed" ||
    value.evidenceValidated !== true ||
    value.actionAuthorityGranted !== false ||
    value.toolAuthorityGranted !== false ||
    value.spawnAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_closure_evidence_invalid",
      "workThreadClosureEvidenceWitness",
    );
  if (!context.workThread || !context.closureResultEnvelope)
    fail(
      "direct_project_memory_closure_context_required",
      "workThreadClosureEvidenceWitness",
    );
  validateClosureArtifacts(
    context.workThread,
    context.closureResultEnvelope,
    value.projectId,
    identity,
  );
  if (context.closureIdentity && canonicalJson(identity) !== canonicalJson(closureIdentity(context.closureIdentity)))
    fail("direct_project_memory_closure_identity_mismatch", "workThreadClosureEvidenceWitness");
  if (
    value.workThreadRef.sourceId !== context.workThread.workThreadId ||
    value.workThreadRef.sourceDigest.value !== context.workThread.digest ||
    value.closureReportRef.sourceId !==
      context.closureResultEnvelope.resultEnvelopeId ||
    value.closureReportRef.sourceDigest.value !==
      context.closureResultEnvelope.artifactDigest.value
  )
    fail(
      "direct_project_memory_closure_binding_mismatch",
      "workThreadClosureEvidenceWitness",
    );
  noRawOrAuthority(value, "workThreadClosureEvidenceWitness");
  checked(
    value,
    "digest",
    "direct-work-thread-closure-evidence-witness@1",
    "workThreadClosureEvidenceWitness",
  );
  return true;
}
function closureContexts(values, label) {
  const contexts = array(values, label);
  if (!contexts.length)
    fail("direct_project_memory_closure_context_required", label);
  contexts.forEach((context, index) => {
    object(context, `${label}.${index}`);
    closed(
      context,
      new Set(["witness", "workThread", "closureResultEnvelope", "closureIdentity"]),
      `${label}.${index}`,
    );
    validateWorkThreadClosureEvidenceWitness(context.witness, context);
  });
  return contexts;
}

function buildProjectMemoryCandidate(input = {}, options = {}) {
  const source = object(input, "projectMemoryCandidateInput");
  const projectId = normalizeId(source.projectId, "project");
  const proposedSemanticPath = projectPath(
    projectId,
    source.proposedSemanticPath,
  );
  const sourceRefs = refs(source.sourceRefs, options);
  const closureEvidenceContexts = closureContexts(
    source.closureEvidenceContexts,
    "projectMemoryCandidateInput.closureEvidenceContexts",
  );
  const closureWitnesses = closureEvidenceContexts.map(
    (context) => context.witness,
  );
  if (closureWitnesses.some((witness) => witness.projectId !== projectId))
    fail(
      "direct_project_memory_closure_project_mismatch",
      "closureEvidenceContexts",
    );
  const closureWitnessRefs = closureWitnesses.map((witness) =>
    closureArtifactRef(
      `closure_witness_${witness.witnessId}`,
      witness.witnessId,
      witness.digest,
      options,
    ),
  );
  const result = {
    schema: PROJECT_MEMORY_CANDIDATE_SCHEMA,
    candidateId: normalizeId(
      source.candidateId || source.id,
      "project_memory_candidate",
    ),
    projectId,
    projectManagerAgentId: normalizeId(
      source.projectManagerAgentId,
      "project_manager_agent",
    ),
    sourceWorkThreadRefs: closureWitnesses.map(
      (witness) => witness.workThreadRef,
    ),
    closureReportRefs: closureWitnessRefs,
    candidateKind: KINDS.has(source.candidateKind)
      ? source.candidateKind
      : "project_fact",
    proposedSemanticPath,
    proposedNode: buildWorldmodelSemanticNode(
      {
        ...(source.proposedNode || {}),
        scope: {
          ...(source.proposedNode?.scope || {}),
          scopeKind: "project",
          projectId,
          semanticPath: proposedSemanticPath,
        },
        lifecycle: "proposed",
        custodianRole: "project_manager",
        authorizedWriterRoles: ["project_manager"],
        sourceRefs: source.proposedNode?.sourceRefs || sourceRefs,
      },
      options,
    ),
    expectedProjectRevision: Number.isInteger(source.expectedProjectRevision)
      ? source.expectedProjectRevision
      : 0,
    sourceRefs: refs([...sourceRefs, ...closureWitnessRefs], options),
    candidateIsProjectTruth: false,
    actionAuthorityGranted: false,
    toolAuthorityGranted: false,
    spawnAuthorityGranted: false,
  };
  result.candidateDigest = digest("direct-project-memory-candidate@1", result);
  return result;
}
function validateProjectMemoryCandidate(value, context = {}) {
  object(value, "projectMemoryCandidate");
  closed(
    value,
    new Set([
      "schema",
      "candidateId",
      "projectId",
      "projectManagerAgentId",
      "sourceWorkThreadRefs",
      "closureReportRefs",
      "candidateKind",
      "proposedSemanticPath",
      "proposedNode",
      "expectedProjectRevision",
      "sourceRefs",
      "candidateIsProjectTruth",
      "actionAuthorityGranted",
      "toolAuthorityGranted",
      "spawnAuthorityGranted",
      "candidateDigest",
    ]),
    "projectMemoryCandidate",
  );
  if (value.schema !== PROJECT_MEMORY_CANDIDATE_SCHEMA)
    fail("direct_project_memory_schema_mismatch", "projectMemoryCandidate");
  ["candidateId", "projectId", "projectManagerAgentId"].forEach((key) =>
    string(value[key], `projectMemoryCandidate.${key}`),
  );
  if (!KINDS.has(value.candidateKind))
    fail(
      "direct_project_memory_invalid_candidate_kind",
      "projectMemoryCandidate.candidateKind",
    );
  array(
    value.proposedSemanticPath,
    "projectMemoryCandidate.proposedSemanticPath",
  );
  if (
    canonicalJson(value.proposedSemanticPath) !==
    canonicalJson(projectPath(value.projectId, value.proposedSemanticPath))
  )
    fail(
      "direct_project_memory_project_path_mismatch",
      "projectMemoryCandidate.proposedSemanticPath",
    );
  integer(
    value.expectedProjectRevision,
    "projectMemoryCandidate.expectedProjectRevision",
  );
  exactRefs(
    value.sourceWorkThreadRefs,
    "projectMemoryCandidate.sourceWorkThreadRefs",
  );
  exactRefs(
    value.closureReportRefs,
    "projectMemoryCandidate.closureReportRefs",
  );
  exactRefs(value.sourceRefs, "projectMemoryCandidate.sourceRefs");
  const contexts = closureContexts(
    context.closureEvidenceContexts,
    "projectMemoryCandidate.closureEvidenceContexts",
  );
  const witnesses = contexts.map((entry) => entry.witness);
  if (
    witnesses.some((witness) => witness.projectId !== value.projectId) ||
    witnesses.length !== value.closureReportRefs.length ||
    witnesses.some(
      (witness, index) =>
        value.closureReportRefs[index].sourceId !== witness.witnessId ||
        value.closureReportRefs[index].sourceDigest.value !== witness.digest ||
        value.sourceWorkThreadRefs[index].sourceId !==
          witness.workThreadRef.sourceId ||
        value.sourceWorkThreadRefs[index].sourceDigest.value !==
          witness.workThreadRef.sourceDigest.value ||
        !value.sourceRefs.some(
          (ref) =>
            ref.sourceId === witness.witnessId &&
            ref.sourceDigest.value === witness.digest,
        ),
    )
  )
    fail(
      "direct_project_memory_closure_binding_mismatch",
      "projectMemoryCandidate",
    );
  validateWorldmodelSemanticNode(value.proposedNode);
  if (
    value.proposedNode.scope.scopeKind !== "project" ||
    value.proposedNode.scope.projectId !== value.projectId ||
    canonicalJson(value.proposedNode.scope.semanticPath) !==
      canonicalJson(value.proposedSemanticPath) ||
    value.proposedNode.lifecycle !== "proposed" ||
    value.proposedNode.custodianRole !== "project_manager" ||
    canonicalJson(value.proposedNode.authorizedWriterRoles) !==
      canonicalJson(["project_manager"])
  )
    fail(
      "direct_project_memory_proposed_node_scope_mismatch",
      "projectMemoryCandidate.proposedNode",
    );
  if (
    value.candidateIsProjectTruth !== false ||
    value.actionAuthorityGranted !== false ||
    value.toolAuthorityGranted !== false ||
    value.spawnAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_candidate_authority_violation",
      "projectMemoryCandidate",
    );
  noRawOrAuthority(value, "projectMemoryCandidate");
  checked(
    value,
    "candidateDigest",
    "direct-project-memory-candidate@1",
    "projectMemoryCandidate",
  );
  return true;
}

function buildScopedWorldMemoryBinding(input = {}, options = {}) {
  const source = object(input, "scopedWorldMemoryBindingInput");
  if (
    source.homeScope &&
    !["user_world", "project", "agent_private"].includes(source.homeScope)
  )
    fail(
      "direct_project_memory_binding_state_invalid",
      "scopedWorldMemoryBindingInput.homeScope",
    );
  const state = BINDING_STATES.has(source.compatibilityState)
    ? source.compatibilityState
    : "migration_pending";
  const graph = state === "graph_primary";
  const legacy =
    state === "legacy_memory_primary" || state === "agent_private_unpromoted";
  const result = {
    schema: SCOPED_WORLD_MEMORY_BINDING_SCHEMA,
    bindingId: normalizeId(
      source.bindingId || source.id,
      "scoped_memory_binding",
    ),
    memoryId: normalizeId(source.memoryId, "memory"),
    memoryArtifactRef: sourceRef(source.memoryArtifactRef, options),
    semanticNodeId: normalizeId(source.semanticNodeId, "semantic_node"),
    semanticNodeDigest: normalizeString(source.semanticNodeDigest, ""),
    homeScope: ["user_world", "project", "agent_private"].includes(
      source.homeScope,
    )
      ? source.homeScope
      : "project",
    ...(source.homeScope === "project"
      ? { projectId: normalizeId(source.projectId, "project") }
      : {}),
    custodianRole: ["world_manager", "project_manager", "agent"].includes(
      source.custodianRole,
    )
      ? source.custodianRole
      : "project_manager",
    compatibilityState: state,
    mayEnterContextThroughLegacyMemoryProjection: legacy,
    mayEnterContextThroughGraphProjection: graph,
    doubleInclusionForbidden: true,
    sourceRefs: refs(source.sourceRefs, options),
    actionAuthorityGranted: false,
    toolAuthorityGranted: false,
    spawnAuthorityGranted: false,
  };
  result.bindingDigest = digest("direct-scoped-world-memory-binding@1", result);
  return result;
}
function validateScopedWorldMemoryBinding(value, context = {}) {
  object(value, "scopedWorldMemoryBinding");
  closed(
    value,
    new Set([
      "schema",
      "bindingId",
      "memoryId",
      "memoryArtifactRef",
      "semanticNodeId",
      "semanticNodeDigest",
      "homeScope",
      "projectId",
      "custodianRole",
      "compatibilityState",
      "mayEnterContextThroughLegacyMemoryProjection",
      "mayEnterContextThroughGraphProjection",
      "doubleInclusionForbidden",
      "sourceRefs",
      "actionAuthorityGranted",
      "toolAuthorityGranted",
      "spawnAuthorityGranted",
      "bindingDigest",
    ]),
    "scopedWorldMemoryBinding",
  );
  if (value.schema !== SCOPED_WORLD_MEMORY_BINDING_SCHEMA)
    fail("direct_project_memory_schema_mismatch", "scopedWorldMemoryBinding");
  ["bindingId", "memoryId", "semanticNodeId"].forEach((key) =>
    string(value[key], `scopedWorldMemoryBinding.${key}`),
  );
  exactRefs(
    [value.memoryArtifactRef],
    "scopedWorldMemoryBinding.memoryArtifactRef",
  );
  exactRefs(value.sourceRefs, "scopedWorldMemoryBinding.sourceRefs", {
    required: false,
  });
  if (
    !["user_world", "project", "agent_private"].includes(value.homeScope) ||
    !BINDING_STATES.has(value.compatibilityState) ||
    value.doubleInclusionForbidden !== true
  )
    fail(
      "direct_project_memory_binding_state_invalid",
      "scopedWorldMemoryBinding",
    );
  const legacy = value.mayEnterContextThroughLegacyMemoryProjection;
  const graph = value.mayEnterContextThroughGraphProjection;
  if (
    typeof legacy !== "boolean" ||
    typeof graph !== "boolean" ||
    (legacy && graph) ||
    (value.compatibilityState === "graph_primary" && (!graph || legacy)) ||
    (value.compatibilityState === "legacy_memory_primary" &&
      (!legacy || graph)) ||
    (value.compatibilityState === "migration_pending" && (legacy || graph)) ||
    (value.compatibilityState === "agent_private_unpromoted" &&
      (!legacy || graph))
  )
    fail(
      "direct_project_memory_double_inclusion_forbidden",
      "scopedWorldMemoryBinding",
    );
  if (
    value.homeScope === "project" &&
    (!normalizeString(value.projectId, "") ||
      value.custodianRole !== "project_manager")
  )
    fail(
      "direct_project_memory_binding_custody_mismatch",
      "scopedWorldMemoryBinding",
    );
  if (
    value.homeScope !== "project" &&
    Object.prototype.hasOwnProperty.call(value, "projectId")
  )
    fail(
      "direct_project_memory_binding_custody_mismatch",
      "scopedWorldMemoryBinding",
    );
  if (
    value.homeScope === "user_world" &&
    value.custodianRole !== "world_manager"
  )
    fail(
      "direct_project_memory_binding_custody_mismatch",
      "scopedWorldMemoryBinding",
    );
  if (
    value.homeScope === "agent_private" &&
    (value.custodianRole !== "agent" ||
      value.compatibilityState !== "agent_private_unpromoted")
  )
    fail(
      "direct_project_memory_binding_custody_mismatch",
      "scopedWorldMemoryBinding",
    );
  if (value.compatibilityState === "graph_primary") {
    if (!context.graph)
      fail(
        "direct_project_memory_binding_graph_context_required",
        "scopedWorldMemoryBinding",
      );
    const node = context.graph.nodes?.find(
      (entry) => entry.nodeId === value.semanticNodeId,
    );
    if (
      !node ||
      node.digest !== value.semanticNodeDigest ||
      (value.homeScope === "project" &&
        node.scope?.projectId !== value.projectId)
    )
      fail(
        "direct_project_memory_binding_graph_node_mismatch",
        "scopedWorldMemoryBinding",
      );
  }
  if (
    value.actionAuthorityGranted !== false ||
    value.toolAuthorityGranted !== false ||
    value.spawnAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_binding_authority_violation",
      "scopedWorldMemoryBinding",
    );
  noRawOrAuthority(value, "scopedWorldMemoryBinding");
  checked(
    value,
    "bindingDigest",
    "direct-scoped-world-memory-binding@1",
    "scopedWorldMemoryBinding",
  );
  return true;
}

function impactPosture(input = {}, options = {}) {
  const source = object(input, "impactPosture");
  const kind = ["checkpoint", "evidence_backed_immediate"].includes(source.kind)
    ? source.kind
    : "checkpoint";
  const evidenceRefs = refs(source.evidenceRefs, options);
  if (kind === "evidence_backed_immediate")
    exactRefs(evidenceRefs, "impactPosture.evidenceRefs");
  return { kind, evidenceRefs };
}
function validateImpactPosture(value) {
  object(value, "impactPosture");
  closed(value, new Set(["kind", "evidenceRefs"]), "impactPosture");
  if (!["checkpoint", "evidence_backed_immediate"].includes(value.kind))
    fail("direct_project_memory_impact_posture_invalid", "impactPosture");
  exactRefs(value.evidenceRefs, "impactPosture.evidenceRefs", {
    required: value.kind === "evidence_backed_immediate",
  });
  return true;
}
function buildWorldToProjectUpdatePacket(input = {}, options = {}) {
  const source = object(input, "worldToProjectUpdatePacketInput");
  if (source.sourceTransition) {
    const mutationIds = transitionMutationIds(source.sourceTransition);
    const suppliedAffectedIds = [...(source.affectedNodeRefs || []), ...(source.affectedEdgeRefs || [])].map((ref) => normalizeString(ref.sourceId || ref.id, "")).filter(Boolean).sort();
    if (canonicalJson(mutationIds) !== canonicalJson(suppliedAffectedIds))
      fail("direct_project_memory_packet_mutation_mismatch", "worldToProjectUpdatePacket");
  }
  const updateKind = UPDATE_KINDS.has(source.updateKind)
    ? source.updateKind
    : "idea_admitted";
  const changeClass = CHANGE_CLASSES.has(source.changeClass)
    ? source.changeClass
    : updateKind === "goal_change"
      ? "active_goal_change"
      : "ordinary_idea";
  const posture = impactPosture(source.impactPosture || {}, options);
  const immediate = posture.kind === "evidence_backed_immediate";
  if (
    immediate &&
    !["active_architecture_change", "active_goal_change"].includes(changeClass)
  )
    fail(
      "direct_project_memory_impact_posture_invalid",
      "worldToProjectUpdatePacket",
    );
  const derived = evaluateProjectionMateriality({
    event: changeClass,
    impactEvidenceImmediate: immediate,
  });
  const result = {
    schema: WORLD_TO_PROJECT_UPDATE_PACKET_SCHEMA,
    updatePacketId: normalizeId(
      source.updatePacketId || source.id,
      "world_to_project_update",
    ),
    projectId: normalizeId(source.projectId, "project"),
    sourceGraphTransitionRefs: source.sourceTransition ? [transitionRef(source.sourceTransition, options)] : refs(source.sourceGraphTransitionRefs, options),
    affectedNodeRefs: refs(source.affectedNodeRefs, options),
    affectedEdgeRefs: refs(source.affectedEdgeRefs, options),
    updateKind,
    changeClass,
    impactPosture: posture,
    normativeForce: FORCES.has(source.normativeForce)
      ? source.normativeForce
      : "informational",
    materiality: derived.materiality,
    expectedProjectRevision: Number.isInteger(source.expectedProjectRevision)
      ? source.expectedProjectRevision
      : 0,
    resultingProjectRevision: Number.isInteger(source.resultingProjectRevision)
      ? source.resultingProjectRevision
      : 0,
    sourceRefs: refs(source.sourceRefs, options),
    copiesProjectTruth: false,
    actionAuthorityGranted: false,
  };
  result.packetDigest = digest(
    "direct-world-to-project-update-packet@1",
    result,
  );
  return result;
}
function validateWorldToProjectUpdatePacket(value) {
  object(value, "worldToProjectUpdatePacket");
  closed(
    value,
    new Set([
      "schema",
      "updatePacketId",
      "projectId",
      "sourceGraphTransitionRefs",
      "affectedNodeRefs",
      "affectedEdgeRefs",
      "updateKind",
      "changeClass",
      "impactPosture",
      "normativeForce",
      "materiality",
      "expectedProjectRevision",
      "resultingProjectRevision",
      "sourceRefs",
      "copiesProjectTruth",
      "actionAuthorityGranted",
      "packetDigest",
    ]),
    "worldToProjectUpdatePacket",
  );
  if (value.schema !== WORLD_TO_PROJECT_UPDATE_PACKET_SCHEMA)
    fail("direct_project_memory_schema_mismatch", "worldToProjectUpdatePacket");
  ["updatePacketId", "projectId"].forEach((key) =>
    string(value[key], `worldToProjectUpdatePacket.${key}`),
  );
  ["sourceGraphTransitionRefs", "sourceRefs"].forEach((key) =>
    exactRefs(value[key], `worldToProjectUpdatePacket.${key}`),
  );
  ["affectedNodeRefs", "affectedEdgeRefs"].forEach((key) =>
    exactRefs(value[key], `worldToProjectUpdatePacket.${key}`, {
      required: false,
    }),
  );
  validateImpactPosture(value.impactPosture);
  if (
    !UPDATE_KINDS.has(value.updateKind) ||
    !FORCES.has(value.normativeForce) ||
    !CHANGE_CLASSES.has(value.changeClass) ||
    !MATERIALITIES.has(value.materiality) ||
    (value.updateKind === "goal_change" &&
      ["ordinary_idea", "historical_only"].includes(value.changeClass)) ||
    value.materiality !==
      evaluateProjectionMateriality({
        event: value.changeClass,
        impactEvidenceImmediate:
          value.impactPosture.kind === "evidence_backed_immediate",
      }).materiality
  )
    fail(
      "direct_project_memory_packet_kind_invalid",
      "worldToProjectUpdatePacket",
    );
  integer(
    value.expectedProjectRevision,
    "worldToProjectUpdatePacket.expectedProjectRevision",
  );
  integer(
    value.resultingProjectRevision,
    "worldToProjectUpdatePacket.resultingProjectRevision",
  );
  if (
    value.copiesProjectTruth !== false ||
    value.actionAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_packet_authority_violation",
      "worldToProjectUpdatePacket",
    );
  noRawOrAuthority(value, "worldToProjectUpdatePacket");
  checked(
    value,
    "packetDigest",
    "direct-world-to-project-update-packet@1",
    "worldToProjectUpdatePacket",
  );
  return true;
}
function applyWorldToProjectUpdatePacket(input = {}, options = {}) {
  const source = object(input, "worldToProjectUpdateApplyInput");
  const packet = source.packet;
  const manager = source.projectManagerProfile;
  validateWorldToProjectUpdatePacket(packet);
  validateProjectManagerProfile(manager);
  const currentRevision = integer(
    source.currentProjectRevision,
    "worldToProjectUpdateApplyInput.currentProjectRevision",
  );
  if (manager.projectId !== packet.projectId)
    fail(
      "direct_project_memory_packet_manager_project_mismatch",
      "worldToProjectUpdateApplyInput",
    );
  const outcome =
    currentRevision === packet.resultingProjectRevision
      ? "already_current"
      : currentRevision !== packet.expectedProjectRevision
        ? "stale_remand"
        : packet.materiality === "next_safe_checkpoint"
          ? "scheduled_checkpoint"
          : "applied";
  return buildProjectGraphUpdateAcknowledgement(
    {
      acknowledgementId: source.acknowledgementId,
      packet,
      projectManagerProfile: manager,
      outcome,
      currentProjectRevision: currentRevision,
      affectedWorkThreadRefs: source.affectedWorkThreadRefs,
      resultingProjectionRef: source.resultingProjectionRef,
      sourceRefs: source.sourceRefs || packet.sourceRefs,
    },
    options,
  );
}

// A propagation record is the persisted owner of delivery state.  Packets are
// immutable descriptions; they cannot by themselves claim that another scope
// was changed or that a consumer refreshed its context.
function transitionRef(transition, options) {
  if (!transition || transition.outcome !== "committed")
    fail("direct_project_memory_transition_receipt_required", "transition");
  return closureArtifactRef(`graph_transition_${transition.transitionId}`, transition.transitionId, transition.digest, options);
}
function transitionMutationIds(transition) {
  return (transition.mutations || []).map((mutation) => mutation.targetId).sort();
}
function graphReceipt(graph) {
  validateHierarchicalWorldmodelGraph(graph);
  return { graphId: graph.graphId, graphDigest: graph.digest };
}
function registryReceipt(registry) {
  validateGovernanceProvenanceRegistry(registry);
  return governanceRegistryRef(registry);
}
function revisionReceipts(values) {
  return (values || []).map((value) => ({
    scopeKind: value.scopeKind,
    projectId: value.projectId || "",
    workThreadId: value.workThreadId || "",
    revision: value.revision,
    digest: value.digest,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}
function graphReceiptMatches(value, graph, label) {
  if (!value || value.graphId !== graph.graphId || value.graphDigest !== graph.digest)
    fail("direct_project_memory_propagation_graph_receipt_mismatch", label);
}
function consumedTransition(graph, ref, label) {
  const transition = graph.transitions.find((entry) => entry.transitionId === ref?.sourceId && entry.digest === ref?.sourceDigest?.value);
  if (!transition || transition.outcome !== "committed")
    fail("direct_project_memory_propagation_foreign_transition", label);
  if (!graph.consumedWriteAuthorizationRefs.some((entry) => entry.id === transition.writeAuthorizationRef.id && entry.digest === transition.writeAuthorizationRef.digest) || !graph.consumedContextualAdmissionRefs.some((entry) => entry.id === transition.contextualAdmissionRef.id && entry.digest === transition.contextualAdmissionRef.digest))
    fail("direct_project_memory_propagation_consumption_mismatch", label);
  return transition;
}
function transitionBinding(transition, preGraph, postGraph, preRegistry, postRegistry) {
  return {
    graphPreRef: graphReceipt(preGraph),
    graphPostRef: graphReceipt(postGraph),
    preScopeRevisions: revisionReceipts(transition.expectedScopeRevisions),
    postScopeRevisions: revisionReceipts(transition.resultingScopeRevisions),
    affectedSemanticIds: transitionMutationIds(transition),
    consumedWriteAuthorizationRef: { id: transition.writeAuthorizationRef.id, digest: transition.writeAuthorizationRef.digest },
    consumedContextualAdmissionRef: { id: transition.contextualAdmissionRef.id, digest: transition.contextualAdmissionRef.digest },
    governanceRegistryPreRef: registryReceipt(preRegistry),
    governanceRegistryPostRef: registryReceipt(postRegistry),
  };
}
function exactTransitionBinding(binding, transition, postGraph, postRegistry, label) {
  graphReceiptMatches(binding.graphPostRef, postGraph, `${label}.postGraph`);
  if (canonicalJson(binding.preScopeRevisions) !== canonicalJson(revisionReceipts(transition.expectedScopeRevisions)) || canonicalJson(binding.postScopeRevisions) !== canonicalJson(revisionReceipts(transition.resultingScopeRevisions)) || canonicalJson(binding.affectedSemanticIds) !== canonicalJson(transitionMutationIds(transition)) || binding.consumedWriteAuthorizationRef?.id !== transition.writeAuthorizationRef.id || binding.consumedWriteAuthorizationRef?.digest !== transition.writeAuthorizationRef.digest || binding.consumedContextualAdmissionRef?.id !== transition.contextualAdmissionRef.id || binding.consumedContextualAdmissionRef?.digest !== transition.contextualAdmissionRef.digest || canonicalJson(binding.governanceRegistryPostRef) !== canonicalJson(registryReceipt(postRegistry)))
    fail("direct_project_memory_propagation_transition_binding_mismatch", label);
}
function transitionTouchesOnlyScope(transition, scope, label) {
  const expected = transition.expectedScopeRevisions || [];
  if (!expected.length || !expected.every((ref) => ref.scopeKind === scope.scopeKind && (ref.projectId || "") === (scope.projectId || "") && (ref.workThreadId || "") === (scope.workThreadId || "")))
    fail("direct_project_memory_propagation_scope_mismatch", label);
}
function validatePropagationBootRefreshes(refreshes, options) {
  const values = array(refreshes, "propagationRecord.bootRefreshes");
  values.forEach((refresh, index) => {
    object(refresh, `propagationRecord.bootRefreshes.${index}`);
    closed(refresh, new Set(["staleBootPacketRef", "replacementCompilation", "replacementBootPacketRef", "managerProfileRef", "managerRole", "managerAgentId", "focalScope", "focalRevision", "destinationGraphRef", "staleGovernanceRegistryRef", "replacementGovernanceRegistryRef", "staleAuthorityDecisionRef", "replacementAuthorityDecisionRef", "propagationId"]), `propagationRecord.bootRefreshes.${index}`);
    exactRefs([refresh.staleBootPacketRef, refresh.replacementBootPacketRef], `propagationRecord.bootRefreshes.${index}`);
    validateGraphOdeuCompilation(refresh.replacementCompilation);
    if (refresh.staleBootPacketRef.sourceId === refresh.replacementBootPacketRef.sourceId || refresh.replacementCompilation.activeInteractionWorldmodel.managerAgentId === "" || !["world_manager", "project_manager"].includes(refresh.managerRole) || refresh.managerProfileRef?.id !== refresh.replacementCompilation.profileRef.id || refresh.managerProfileRef?.digest !== refresh.replacementCompilation.profileRef.digest)
      fail("direct_project_memory_boot_refresh_mismatch", `propagationRecord.bootRefreshes.${index}`);
    if (refresh.managerAgentId !== refresh.replacementCompilation.activeInteractionWorldmodel.managerAgentId || canonicalJson(refresh.focalScope) !== canonicalJson(refresh.replacementCompilation.focalScope) || canonicalJson(refresh.focalRevision) !== canonicalJson(refresh.replacementCompilation.focalRevision) || refresh.destinationGraphRef?.graphId !== refresh.replacementCompilation.graphRef.graphId || refresh.destinationGraphRef?.graphDigest !== refresh.replacementCompilation.graphRef.graphDigest || refresh.replacementGovernanceRegistryRef?.kind !== "governance_provenance_registry" || !Number.isInteger(refresh.replacementGovernanceRegistryRef?.revision) || refresh.staleGovernanceRegistryRef?.kind !== "governance_provenance_registry" || !Number.isInteger(refresh.staleGovernanceRegistryRef?.revision) || !normalizeString(refresh.staleAuthorityDecisionRef?.digest, "").startsWith("sha256:") || !normalizeString(refresh.replacementAuthorityDecisionRef?.digest, "").startsWith("sha256:") || refresh.propagationId !== options?.propagationId)
      fail("direct_project_memory_boot_refresh_mismatch", `propagationRecord.bootRefreshes.${index}`);
    if (options?.destinationGraph) graphReceiptMatches(refresh.destinationGraphRef, options.destinationGraph, `propagationRecord.bootRefreshes.${index}.destinationGraph`);
  });
  return values;
}
function buildProjectWorldPropagationRecord(input = {}, options = {}, admission = null) {
  const source = object(input, "projectWorldPropagationRecordInput");
  if (!["project_to_world", "world_to_project"].includes(source.direction))
    fail("direct_project_memory_propagation_direction_required", "projectWorldPropagationRecord");
  if (!PROPAGATION_STATES.has(source.state))
    fail("direct_project_memory_propagation_state_required", "projectWorldPropagationRecord");
  // A portable artifact may describe delivery, but must never self-attest an
  // effect.  The controller store is the only writer of an applied record.
  if (source.state === "applied" && admission !== INTERNAL_PROPAGATION_ADMISSION)
    fail("direct_project_memory_propagation_authoritative_admission_required", "applied");
  const direction = source.direction;
  const state = source.state;
  const record = {
    schema: PROPAGATION_RECORD_SCHEMA,
    propagationId: normalizeId(source.propagationId || source.id, "project_world_propagation"),
    direction,
    projectId: normalizeId(source.projectId, "project"),
    state,
    sourceTransitionRef: source.sourceTransition ? transitionRef(source.sourceTransition, options) : null,
    destinationTransitionRef: source.destinationTransition ? transitionRef(source.destinationTransition, options) : null,
    sourceBinding: source.sourceBinding || null,
    destinationBinding: source.destinationBinding || null,
    sourceExpectedRevisionRefs: refs(source.sourceExpectedRevisionRefs || [], options),
    destinationExpectedRevisionRefs: refs(source.destinationExpectedRevisionRefs || [], options),
    affectedNodeIds: [...new Set((source.affectedNodeIds || []).map((id) => normalizeId(id, "semantic_node")))].sort(),
    affectedEdgeIds: [...new Set((source.affectedEdgeIds || []).map((id) => normalizeId(id, "semantic_edge")))].sort(),
    bootRefreshes: source.bootRefreshes || [],
    failureCode: normalizeString(source.failureCode, ""),
    sourceRefs: refs(source.sourceRefs || [], options),
    actionAuthorityGranted: false,
  };
  if (state === "pending" && (record.sourceTransitionRef || record.destinationTransitionRef || record.sourceBinding || record.destinationBinding)) fail("direct_project_memory_propagation_state_mismatch", "pending");
  if (state === "delivered" && (!record.sourceTransitionRef || record.destinationTransitionRef || !record.sourceBinding || record.destinationBinding)) fail("direct_project_memory_propagation_state_mismatch", "delivered");
  if (state === "applied" && (!record.sourceTransitionRef || !record.destinationTransitionRef || !record.sourceBinding || !record.destinationBinding || !record.bootRefreshes.length)) fail("direct_project_memory_propagation_state_mismatch", "applied");
  if (["failed", "stale_remand"].includes(state) && !record.failureCode) fail("direct_project_memory_propagation_state_mismatch", state);
  if (state === "applied") validatePropagationBootRefreshes(record.bootRefreshes, { ...options, propagationId: record.propagationId });
  record.propagationDigest = digest("direct-project-world-propagation-record@1", record);
  return record;
}
function buildAppliedProjectWorldPropagationRecord(input = {}, options = {}) {
  return buildProjectWorldPropagationRecord(
    input,
    options,
    INTERNAL_PROPAGATION_ADMISSION,
  );
}
function validateProjectWorldPropagationRecordShape(value, { allowApplied = false } = {}) {
  object(value, "projectWorldPropagationRecord");
  closed(value, new Set(["schema", "propagationId", "direction", "projectId", "state", "sourceTransitionRef", "destinationTransitionRef", "sourceBinding", "destinationBinding", "sourceExpectedRevisionRefs", "destinationExpectedRevisionRefs", "affectedNodeIds", "affectedEdgeIds", "bootRefreshes", "failureCode", "sourceRefs", "actionAuthorityGranted", "propagationDigest"]), "projectWorldPropagationRecord");
  if (value.schema !== PROPAGATION_RECORD_SCHEMA || !["project_to_world", "world_to_project"].includes(value.direction) || !PROPAGATION_STATES.has(value.state)) fail("direct_project_memory_propagation_invalid", "projectWorldPropagationRecord");
  ["propagationId", "projectId"].forEach((key) => string(value[key], `projectWorldPropagationRecord.${key}`));
  if (value.sourceTransitionRef) exactRefs([value.sourceTransitionRef], "projectWorldPropagationRecord.sourceTransitionRef");
  if (value.destinationTransitionRef) exactRefs([value.destinationTransitionRef], "projectWorldPropagationRecord.destinationTransitionRef");
  exactRefs(value.sourceExpectedRevisionRefs, "projectWorldPropagationRecord.sourceExpectedRevisionRefs", { required: false });
  exactRefs(value.destinationExpectedRevisionRefs, "projectWorldPropagationRecord.destinationExpectedRevisionRefs", { required: false });
  array(value.affectedNodeIds, "projectWorldPropagationRecord.affectedNodeIds"); array(value.affectedEdgeIds, "projectWorldPropagationRecord.affectedEdgeIds");
  if (["delivered", "applied"].includes(value.state)) {
    object(value.sourceBinding, "projectWorldPropagationRecord.sourceBinding");
    ["graphPreRef", "graphPostRef", "preScopeRevisions", "postScopeRevisions", "affectedSemanticIds", "consumedWriteAuthorizationRef", "consumedContextualAdmissionRef", "governanceRegistryPreRef", "governanceRegistryPostRef"].forEach((key) => { if (!value.sourceBinding[key]) fail("direct_project_memory_propagation_binding_required", `sourceBinding.${key}`); });
  }
  if (value.state === "applied") {
    if (!allowApplied)
      fail("direct_project_memory_propagation_authoritative_admission_required", "applied");
    object(value.destinationBinding, "projectWorldPropagationRecord.destinationBinding");
    ["graphPreRef", "graphPostRef", "preScopeRevisions", "postScopeRevisions", "affectedSemanticIds", "consumedWriteAuthorizationRef", "consumedContextualAdmissionRef", "governanceRegistryPreRef", "governanceRegistryPostRef"].forEach((key) => { if (!value.destinationBinding[key]) fail("direct_project_memory_propagation_binding_required", `destinationBinding.${key}`); });
    validatePropagationBootRefreshes(value.bootRefreshes, { propagationId: value.propagationId });
  }
  if (value.actionAuthorityGranted !== false) fail("direct_project_memory_propagation_authority_violation", "projectWorldPropagationRecord");
  checked(value, "propagationDigest", "direct-project-world-propagation-record@1", "projectWorldPropagationRecord"); return true;
}
function validateProjectWorldPropagationRecord(value) {
  return validateProjectWorldPropagationRecordShape(value);
}
function receiptIds(record) {
  return [...new Set([...(record.affectedNodeIds || []), ...(record.affectedEdgeIds || [])])].sort();
}
function sameReceipt(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function requirePropagationGraph(value, label) {
  validateHierarchicalWorldmodelGraph(value);
  return value;
}
function requirePropagationRegistry(value, label) {
  try { validateGovernanceProvenanceRegistry(value); } catch (_) { fail("direct_project_memory_propagation_store_context_mismatch", label); }
  return value;
}
function bindingMatchesContext(binding, transition, preGraph, postGraph, preRegistry, postRegistry, label) {
  graphReceiptMatches(binding.graphPreRef, preGraph, `${label}.preGraph`);
  graphReceiptMatches(binding.graphPostRef, postGraph, `${label}.postGraph`);
  if (canonicalJson(binding.governanceRegistryPreRef) !== canonicalJson(registryReceipt(preRegistry)) || canonicalJson(binding.governanceRegistryPostRef) !== canonicalJson(registryReceipt(postRegistry)))
    fail("direct_project_memory_propagation_transition_binding_mismatch", label);
  exactTransitionBinding(binding, transition, postGraph, postRegistry, label);
}
function packetAffectedIds(packet) {
  return [...(packet.affectedNodeRefs || []), ...(packet.affectedEdgeRefs || [])]
    .map((ref) => ref.sourceId || ref.id)
    .filter(Boolean)
    .sort();
}
// This is deliberately the sole contextual admission point for the word
// "applied".  Portable records are evidence-shaped only; this admission binds
// them to graph/readback state held by a controller-owned store.
function admitProjectWorldPropagationRecordAgainstContext(value, context = {}, admission = null) {
  if (admission !== INTERNAL_PROPAGATION_ADMISSION)
    fail("direct_project_memory_propagation_authoritative_admission_required", "applied");
  requirePropagationStateStore(context.propagationStateStore);
  validateProjectWorldPropagationRecordShape(value, { allowApplied: true });
  if (value.state !== "applied")
    fail("direct_project_memory_propagation_applied_required", "record");
  const sourcePreGraph = requirePropagationGraph(context.sourcePreGraph, "sourcePreGraph");
  const sourcePostGraph = requirePropagationGraph(context.sourcePostGraph, "sourcePostGraph");
  const destinationPostGraph = requirePropagationGraph(context.destinationPostGraph, "destinationPostGraph");
  const sourcePreRegistry = requirePropagationRegistry(context.sourcePreGovernanceRegistry, "sourcePreGovernanceRegistry");
  const sourcePostRegistry = requirePropagationRegistry(context.sourcePostGovernanceRegistry, "sourcePostGovernanceRegistry");
  const destinationPostRegistry = requirePropagationRegistry(context.destinationPostGovernanceRegistry, "destinationPostGovernanceRegistry");
  const sourceTransition = consumedTransition(sourcePostGraph, value.sourceTransitionRef, "sourceTransition");
  const destinationTransition = consumedTransition(destinationPostGraph, value.destinationTransitionRef, "destinationTransition");
  if (value.sourceTransitionRef.sourceId === value.destinationTransitionRef.sourceId || value.sourceTransitionRef.sourceDigest?.value === value.destinationTransitionRef.sourceDigest?.value)
    fail("direct_project_memory_propagation_foreign_transition", "same_transition_both_legs");
  bindingMatchesContext(value.sourceBinding, sourceTransition, sourcePreGraph, sourcePostGraph, sourcePreRegistry, sourcePostRegistry, "sourceTransition");
  bindingMatchesContext(value.destinationBinding, destinationTransition, sourcePostGraph, destinationPostGraph, sourcePostRegistry, destinationPostRegistry, "destinationTransition");
  const sourceScope = value.direction === "project_to_world"
    ? { scopeKind: "project", projectId: value.projectId, workThreadId: "" }
    : { scopeKind: "user_world", projectId: "", workThreadId: "" };
  const destinationScope = value.direction === "project_to_world"
    ? { scopeKind: "user_world", projectId: "", workThreadId: "" }
    : { scopeKind: "project", projectId: value.projectId, workThreadId: "" };
  transitionTouchesOnlyScope(sourceTransition, sourceScope, "sourceTransition");
  transitionTouchesOnlyScope(destinationTransition, destinationScope, "destinationTransition");
  if (!sameReceipt(receiptIds(value), transitionMutationIds(sourceTransition)))
    fail("direct_project_memory_packet_mutation_mismatch", "record");
  if (context.packet) {
    validateWorldToProjectUpdatePacket(context.packet);
    if (value.direction !== "world_to_project" || context.packet.projectId !== value.projectId || !context.packet.sourceGraphTransitionRefs.some((ref) => ref.sourceId === value.sourceTransitionRef.sourceId && ref.sourceDigest?.value === value.sourceTransitionRef.sourceDigest?.value) || !sameReceipt(packetAffectedIds(context.packet), receiptIds(value)))
      fail("direct_project_memory_packet_mutation_mismatch", "packet");
  }
  validatePropagationBootRefreshes(value.bootRefreshes, { propagationId: value.propagationId, destinationGraph: destinationPostGraph });
  return true;
}
function storeDigest(state) {
  return digest("direct-project-world-propagation-state-store@1", state);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createPropagationStateStore(input = {}) {
  const filePath = normalizeString(input.filePath || input.stateFile, "");
  if (!filePath) fail("direct_project_memory_propagation_store_path_required", "filePath");
  const configuredStoreId = normalizeString(input.storeId, "");
  let observed = null;
  function initial() {
    const state = { schema: PROPAGATION_STATE_STORE_SCHEMA, storeId: configuredStoreId || `propagation_store_${sha256(path.resolve(filePath)).slice(7, 23)}`, revision: 0, chainHead: "", records: {} };
    state.digest = storeDigest(state); return state;
  }
  function read() {
    const state = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : initial();
    if (!isPlainObject(state) || state.schema !== PROPAGATION_STATE_STORE_SCHEMA || !normalizeString(state.storeId, "") || !Number.isInteger(state.revision) || state.revision < 0 || !isPlainObject(state.records) || state.digest !== storeDigest(state))
      fail("direct_project_memory_propagation_store_invalid", filePath);
    if (configuredStoreId && state.storeId !== configuredStoreId) fail("direct_project_memory_propagation_store_swap", "storeId");
    if (observed && (state.revision < observed.revision || (state.revision === observed.revision && state.chainHead !== observed.chainHead)))
      fail("direct_project_memory_propagation_store_rollback", filePath);
    observed = { revision: state.revision, chainHead: state.chainHead };
    return state;
  }
  function write(state) {
    state.digest = storeDigest(state);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    observed = { revision: state.revision, chainHead: state.chainHead };
  }
  function persist(record, state) {
    const next = clone(state);
    next.revision += 1;
    next.chainHead = sha256(`${state.chainHead}\0${record.propagationDigest}\0${next.revision}`);
    next.records[record.propagationId] = { record: clone(record), storeRevision: next.revision, chainHead: next.chainHead };
    write(next); return clone(next.records[record.propagationId].record);
  }
  const storeApi = {
    storeId: read().storeId,
    read(propagationId) {
      const entry = read().records[normalizeId(propagationId, "project_world_propagation")];
      if (entry?.record?.state === "applied")
        fail("direct_project_memory_propagation_authoritative_admission_required", "store.readApplied_required");
      return entry ? clone(entry.record) : null;
    },
    recordDelivered(record) {
      validateProjectWorldPropagationRecord(record);
      if (record.state !== "delivered") fail("direct_project_memory_propagation_state_mismatch", "store.delivered");
      const state = read();
      if (state.records[record.propagationId]) fail("direct_project_memory_propagation_reused", record.propagationId);
      return persist(record, state);
    },
    admitApplied(record, context) {
      const state = read(); const prior = state.records[record.propagationId]?.record;
      if (!prior || prior.state !== "delivered" || prior.propagationDigest !== context?.deliveredRecordDigest || prior.direction !== record.direction || prior.projectId !== record.projectId || !sameReceipt(prior.sourceTransitionRef, record.sourceTransitionRef) || !sameReceipt(prior.sourceBinding, record.sourceBinding))
        fail("direct_project_memory_propagation_store_context_mismatch", "delivered_record");
      admitProjectWorldPropagationRecordAgainstContext(record, { ...context, propagationStateStore: storeHandle }, INTERNAL_PROPAGATION_ADMISSION);
      if (Object.values(state.records).some((entry) => entry.record.state === "applied" && entry.record.propagationId !== record.propagationId && entry.record.sourceTransitionRef?.sourceId === record.sourceTransitionRef?.sourceId && entry.record.sourceTransitionRef?.sourceDigest?.value === record.sourceTransitionRef?.sourceDigest?.value))
        fail("direct_project_memory_propagation_reused", record.propagationId);
      return persist(record, state);
    },
    readApplied(propagationId, context) {
      const entry = read().records[normalizeId(propagationId, "project_world_propagation")];
      const record = entry ? clone(entry.record) : null;
      if (!record || record.state !== "applied") fail("direct_project_memory_propagation_store_context_mismatch", "applied_record");
      admitProjectWorldPropagationRecordAgainstContext(record, { ...context, propagationStateStore: storeHandle }, INTERNAL_PROPAGATION_ADMISSION);
      return record;
    },
  };
  // This is intentionally an opaque handle: no read/write/admission method or
  // mutable state is available for a caller to copy onto a duck-typed object.
  const storeHandle = Object.freeze({ storeId: storeApi.storeId });
  PROPAGATION_STORE_HANDLES.set(storeHandle, storeApi);
  return storeHandle;
}
function requirePropagationStateStore(value) {
  const storeApi = value && PROPAGATION_STORE_HANDLES.get(value);
  if (!storeApi)
    fail("direct_project_memory_propagation_store_required", "propagationStateStore");
  return storeApi;
}
function createPropagationController(input = {}) {
  const source = object(input, "propagationControllerInput");
  const storeApi = requirePropagationStateStore(source.propagationStateStore);
  const controller = Object.freeze({ storeId: storeApi.storeId });
  PROPAGATION_CONTROLLERS.set(controller, storeApi);
  return controller;
}
function requirePropagationController(value) {
  const storeApi = value && PROPAGATION_CONTROLLERS.get(value);
  if (!storeApi)
    fail("direct_project_memory_propagation_controller_required", "propagationController");
  return storeApi;
}
function readAppliedProjectWorldPropagationRecordFromController(input = {}, options = {}) {
  const source = object(input, "readAppliedProjectWorldPropagationRecordInput");
  const propagationStateStore = requirePropagationController(options.propagationController);
  return propagationStateStore.readApplied(source.propagationId, source.propagationContext || {});
}
function executePropagationLeg(graph, leg, expectedRole, options) {
  validateHierarchicalWorldmodelGraph(graph);
  if (!leg || leg.actorRole !== expectedRole || !leg.contextualAdmission || !leg.writeAuthorization || !leg.governanceRegistry)
    fail("direct_project_memory_propagation_authority_mismatch", expectedRole);
  const result = appendWorldmodelGraphTransition(graph, leg, options);
  if (!result.committed) fail(result.remand?.code || "direct_project_memory_propagation_transition_remand", expectedRole);
  return result;
}
function propagationDestinationLeg(record, graph, sourceGovernanceRegistry, leg, expectedRole, expectedScope) {
  if (!leg || leg.actorRole !== expectedRole || leg.propagationId !== record.propagationId || leg.propagationDirection !== record.direction || leg.propagationSourceTransitionRef?.sourceId !== record.sourceTransitionRef.sourceId || leg.propagationSourceTransitionRef?.sourceDigest?.value !== record.sourceTransitionRef.sourceDigest?.value)
    fail("direct_project_memory_propagation_destination_admission_mismatch", "destinationLeg");
  const scope = leg.contextualAdmission?.candidate?.targetScope;
  if (!scope || scope.scopeKind !== expectedScope.scopeKind || (scope.projectId || "") !== (expectedScope.projectId || "") || (scope.workThreadId || "") !== (expectedScope.workThreadId || ""))
    fail("direct_project_memory_propagation_scope_mismatch", "destinationLeg");
  const sourceTransition = consumedTransition(graph, record.sourceTransitionRef, "sourceTransition");
  exactTransitionBinding(record.sourceBinding, sourceTransition, graph, sourceGovernanceRegistry, "sourceTransition");
  transitionTouchesOnlyScope(sourceTransition, record.direction === "project_to_world" ? { scopeKind: "project", projectId: record.projectId, workThreadId: "" } : { scopeKind: "user_world", projectId: "", workThreadId: "" }, "sourceTransition");
  if (record.sourceBinding.graphPreRef.graphId !== graph.graphId || record.sourceBinding.graphPostRef.graphId !== graph.graphId || record.sourceBinding.graphPreRef.graphDigest === record.sourceBinding.graphPostRef.graphDigest)
    fail("direct_project_memory_propagation_graph_receipt_mismatch", "sourceTransition");
  if (graph.consumedPropagationTransactionRefs.some((ref) => ref.sourceId === record.propagationId && ref.sourceDigest?.value === record.propagationDigest))
    fail("direct_project_memory_propagation_reused", record.propagationId);
  return sourceTransition;
}
function rejectForeignSuppliedSourceResult(record, graph, sourceResult) {
  if (!sourceResult) return;
  if (sourceResult.transition?.transitionId !== record.sourceTransitionRef.sourceId || sourceResult.transition?.digest !== record.sourceTransitionRef.sourceDigest?.value || sourceResult.graph?.graphId !== graph.graphId || sourceResult.graph?.digest !== graph.digest)
    fail("direct_project_memory_propagation_foreign_transition", "sourceResult");
}
function managerRoleForProfile(profile) {
  if (profile?.schema === "direct_project_manager_profile@1") return "project_manager";
  if (profile?.schema === "odeu_worldmodel_manager_profile@1") return "world_manager";
  fail("direct_project_memory_propagation_refresh_profile_invalid", "managerProfile");
}
function managerIdentity(profile) {
  const role = managerRoleForProfile(profile);
  return role === "project_manager"
    ? { role, id: profile.projectManagerProfileId, digest: profile.profileDigest, agentId: profile.projectManagerAgentId }
    : { role, id: profile.managerProfileId, digest: profile.profileDigest, agentId: profile.managerAgentId };
}
function validatePropagationRefreshPreconditions(record, currentGraph, context) {
  object(context, "propagationRefreshContext");
  const profile = context.managerProfile;
  const identity = managerIdentity(profile);
  const staleBoot = context.staleBootPacket;
  const staleProjection = context.staleProjection;
  const staleGraph = context.staleGraph;
  const staleGovernanceRegistry = context.staleGovernanceRegistry;
  validateHierarchicalWorldmodelGraph(staleGraph);
  validateGovernanceProvenanceRegistry(staleGovernanceRegistry);
  validateManagerTurnBootPacket(staleBoot);
  validateWorldmodelGraphProjection(staleProjection);
  graphReceiptMatches(record.sourceBinding.graphPostRef, staleGraph, "staleBoot.sourceGraph");
  if (staleGraph.graphId !== currentGraph.graphId || staleGraph.digest !== currentGraph.digest)
    fail("direct_project_memory_propagation_graph_receipt_mismatch", "staleBoot.currentGraph");
  if (staleBoot.managerRole !== identity.role || staleBoot.managerAgentId !== identity.agentId || staleBoot.profileSnapshotRef.id !== identity.id || staleBoot.profileSnapshotRef.digest !== identity.digest || staleBoot.graphProjectionRef.id !== staleProjection.projectionId || staleBoot.graphProjectionRef.digest !== staleProjection.projectionDigest || staleProjection.graphRef.id !== staleGraph.graphId || staleProjection.graphRef.digest !== staleGraph.digest)
    fail("direct_project_memory_propagation_stale_boot_mismatch", "staleBoot");
  return { profile, identity, staleBoot, staleProjection, staleGraph, staleGovernanceRegistry, staleAuthorityDecision: context.staleAuthorityDecision };
}
function rebuildPropagationBootRefresh(graph, record, context, options) {
  const { profile, identity, staleBoot, staleProjection, staleGraph, staleGovernanceRegistry, staleAuthorityDecision } = validatePropagationRefreshPreconditions(record, context.staleGraph, context);
  if (staleGraph.graphId !== graph.graphId || staleGraph.digest === graph.digest)
    fail("direct_project_memory_propagation_stale_boot_mismatch", "staleBoot");
  // The prior packet is historical evidence after the destination transition;
  // it must not be re-admitted as current context against the advanced store
  // head.  Shape and exact graph/projection/profile linkage above establish the
  // stale witness; only the replacement packet receives current admission.
  const focalScope = context.focalScope || staleProjection.focalScope;
  const policy = buildWorldmodelProjectionPolicy({ ...context.policyArtifact, graph, managerProfile: profile, authoritySourceRef: context.authoritySourceRef });
  const replacementAuthorityDecision = buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: context.replacementAuthorityDecisionId || `${record.propagationId}_${identity.role}_refresh_authority`, graph, managerProfile: profile, actorAgentId: identity.agentId, actorRole: identity.role, targetScope: focalScope, issuedAt: context.issuedAt, expiresAt: context.authorityExpiresAt || "2099-01-01T00:00:00.000Z" }, options);
  if (typeof context.buildReplacementGovernanceRegistry !== "function") fail("direct_project_memory_propagation_refresh_registry_required", "replacement");
  const replacementGovernance = object(context.buildReplacementGovernanceRegistry({ graph, managerProfile: profile, policyArtifact: policy, authorityDecision: replacementAuthorityDecision, focalScope, managerRole: identity.role, managerAgentId: identity.agentId }), "replacementGovernance");
  const replacementGovernanceRegistry = replacementGovernance.governanceRegistry;
  validateGovernanceProvenanceRegistry(replacementGovernanceRegistry);
  const projection = buildWorldmodelGraphProjection({ graph, managerProfile: profile, authoritySourceRef: context.authoritySourceRef, policyArtifact: policy, projectionId: `${record.propagationId}_${identity.role}_refresh_projection`, audienceAgentId: identity.agentId, entryPath: context.entryPath || staleProjection.entryPath, focalScope });
  const trustStore = resolveAuthoritativeWorldmodelTrustStore(graph);
  installAuthoritativeWorldmodelGovernanceRegistry(trustStore, graph, replacementGovernanceRegistry);
  const requiredArtifacts = [
    { kind: identity.role === "project_manager" ? "project_manager_profile" : "world_manager_profile", id: identity.id, digest: identity.digest },
    { kind: "projection_policy", id: policy.policyId, digest: policy.policyDigest },
    { kind: "authority_decision", id: replacementAuthorityDecision.authorityDecisionId, digest: replacementAuthorityDecision.digest, oneShot: true },
  ];
  const projectRootNodeId = replacementGovernance.projectRootNodeId || context.projectRootNodeId;
  const storeAdmission = admitWorldmodelGovernanceRequest(trustStore, {
    admissionId: `${record.propagationId}_${identity.role}_refresh_store_admission`,
    graph,
    context: {
      graphId: graph.graphId,
      graphDigest: graph.digest,
      userProfileId: graph.userProfileId,
      scopeKind: focalScope.scopeKind,
      ...(focalScope.projectId ? { projectId: focalScope.projectId } : {}),
      ...(focalScope.workThreadId ? { workThreadId: focalScope.workThreadId } : {}),
      ...(projectRootNodeId ? { projectRootNodeId } : {}),
      role: identity.role,
      agentId: identity.agentId,
      purpose: "current_context",
      requiredArtifacts,
    },
    issuedAt: context.issuedAt,
  });
  const governanceContext = { authorityDecision: replacementAuthorityDecision, governanceRegistry: replacementGovernanceRegistry, registryRef: replacementGovernance.registryRef, expectedRegistryRevision: replacementGovernance.expectedRegistryRevision, projectRootNodeId, trustStore, storeAdmission };
  const compilation = buildGraphOdeuCompilation({ graph, graphProjection: projection, profileSnapshot: profile, policy, authoritySourceRef: context.authoritySourceRef, ...governanceContext, compilationId: `${record.propagationId}_${identity.role}_refresh_compilation` });
  const replacementBoot = buildManagerTurnBootPacket({ bootPacketId: `${record.propagationId}_${identity.role}_refresh_boot`, managerRole: identity.role, managerAgentId: identity.agentId, graphProjection: projection, profileSnapshot: profile, currentIngress: context.currentIngress, openDecisionRefs: [], openRemandRefs: [], changesSincePreviousTurnRefs: [] });
  admitManagerTurnBootPacket({ bootPacket: replacementBoot, graph, graphProjection: projection, profileSnapshot: profile, policy, authoritySourceRef: context.authoritySourceRef, ...governanceContext, currentIngress: context.currentIngress, targetedEvidenceInspectionArtifacts: [] });
  return {
    staleBootPacketRef: closureArtifactRef(`manager_turn_boot_packet_${staleBoot.bootPacketId}`, staleBoot.bootPacketId, staleBoot.digest, options),
    replacementCompilation: compilation,
    replacementBootPacketRef: closureArtifactRef(`manager_turn_boot_packet_${replacementBoot.bootPacketId}`, replacementBoot.bootPacketId, replacementBoot.digest, options),
    managerProfileRef: { id: identity.id, digest: identity.digest },
    managerRole: identity.role,
    managerAgentId: identity.agentId,
    focalScope: projection.focalScope,
    focalRevision: compilation.focalRevision,
    destinationGraphRef: graphReceipt(graph),
    staleGovernanceRegistryRef: registryReceipt(staleGovernanceRegistry),
    replacementGovernanceRegistryRef: registryReceipt(replacementGovernanceRegistry),
    staleAuthorityDecisionRef: { id: staleAuthorityDecision.authorityDecisionId, digest: staleAuthorityDecision.digest },
    replacementAuthorityDecisionRef: { id: replacementAuthorityDecision.authorityDecisionId, digest: replacementAuthorityDecision.digest },
    propagationId: record.propagationId,
  };
}
function beginProjectToWorldPropagation(input = {}, options = {}) {
  const source = object(input, "beginProjectToWorldPropagationInput");
  if (Object.hasOwn(source, "propagationStateStore"))
    fail("direct_project_memory_propagation_store_request_forbidden", "propagationStateStore");
  const propagationStateStore = requirePropagationController(options.propagationController);
  if (source.sourceLeg?.transitionId !== `${source.propagationId}_source` || source.sourceLeg?.idempotencyKey !== `${source.propagationId}_source`) fail("direct_project_memory_propagation_transaction_mismatch", "sourceLeg");
  if (source.sourceLeg?.actorRole !== "project_manager" || !source.sourceLeg?.contextualAdmission || !source.sourceLeg?.writeAuthorization || !source.sourceLeg?.governanceRegistry)
    fail("direct_project_memory_propagation_authority_mismatch", "project_manager");
  const scope = source.sourceLeg.contextualAdmission.candidate.targetScope;
  if (scope.scopeKind !== "project" || scope.projectId !== source.projectId) fail("direct_project_memory_propagation_project_mismatch", "sourceLeg");
  const sourceResult = executePropagationLeg(source.graph, source.sourceLeg, "project_manager", options);
  const record = propagationStateStore.recordDelivered(buildProjectWorldPropagationRecord({ propagationId: source.propagationId, direction: "project_to_world", projectId: source.projectId, state: "delivered", sourceTransition: sourceResult.transition, sourceBinding: transitionBinding(sourceResult.transition, source.graph, sourceResult.graph, source.sourceLeg.governanceRegistry, sourceResult.governanceRegistry), affectedNodeIds: transitionMutationIds(sourceResult.transition), sourceRefs: source.sourceRefs }, options));
  return { graph: sourceResult.graph, governanceRegistry: sourceResult.governanceRegistry, sourceResult, sourcePreGraph: source.graph, sourcePreGovernanceRegistry: source.sourceLeg.governanceRegistry, record };
}
function completeProjectToWorldPropagation(input = {}, options = {}) {
  const source = object(input, "completeProjectToWorldPropagationInput");
  if (Object.hasOwn(source, "propagationStateStore"))
    fail("direct_project_memory_propagation_store_request_forbidden", "propagationStateStore");
  const propagationStateStore = requirePropagationController(options.propagationController); validateProjectWorldPropagationRecord(source.record);
  const storedRecord = propagationStateStore.read(source.record.propagationId);
  if (!storedRecord || !sameReceipt(storedRecord, source.record)) fail("direct_project_memory_propagation_store_context_mismatch", "delivered_record");
  if (source.record.direction !== "project_to_world" || source.record.state !== "delivered") fail("direct_project_memory_propagation_state_mismatch", "project_to_world");
  rejectForeignSuppliedSourceResult(source.record, source.graph, source.sourceResult);
  propagationDestinationLeg(source.record, source.graph, source.governanceRegistry, source.destinationLeg, "world_manager", { scopeKind: "user_world", projectId: "", workThreadId: "" });
  validatePropagationRefreshPreconditions(source.record, source.graph, source.refreshContext);
  const destinationResult = executePropagationLeg(source.graph, { ...source.destinationLeg, propagationTransactionRef: closureArtifactRef(`project_world_propagation_${source.record.propagationId}`, source.record.propagationId, source.record.propagationDigest, options) }, "world_manager", options);
  const refresh = rebuildPropagationBootRefresh(destinationResult.graph, source.record, source.refreshContext, options);
  const candidate = buildAppliedProjectWorldPropagationRecord({ ...source.record, state: "applied", sourceTransition: consumedTransition(source.graph, source.record.sourceTransitionRef, "sourceTransition"), destinationTransition: destinationResult.transition, destinationBinding: transitionBinding(destinationResult.transition, source.graph, destinationResult.graph, source.governanceRegistry, destinationResult.governanceRegistry), destinationExpectedRevisionRefs: [], bootRefreshes: [refresh], sourceRefs: source.record.sourceRefs }, options);
  const record = propagationStateStore.admitApplied(candidate, { deliveredRecordDigest: source.record.propagationDigest, sourcePreGraph: source.sourcePreGraph, sourcePostGraph: source.graph, destinationPostGraph: destinationResult.graph, sourcePreGovernanceRegistry: source.sourcePreGovernanceRegistry, sourcePostGovernanceRegistry: source.governanceRegistry, destinationPostGovernanceRegistry: destinationResult.governanceRegistry });
  return { graph: destinationResult.graph, governanceRegistry: destinationResult.governanceRegistry, destinationResult, record };
}
function beginWorldToProjectPropagation(input = {}, options = {}) {
  const source = object(input, "beginWorldToProjectPropagationInput");
  if (Object.hasOwn(source, "propagationStateStore"))
    fail("direct_project_memory_propagation_store_request_forbidden", "propagationStateStore");
  const propagationStateStore = requirePropagationController(options.propagationController);
  if (source.sourceLeg?.transitionId !== `${source.propagationId}_source` || source.sourceLeg?.idempotencyKey !== `${source.propagationId}_source`) fail("direct_project_memory_propagation_transaction_mismatch", "sourceLeg");
  if (source.sourceLeg?.actorRole !== "world_manager" || !source.sourceLeg?.contextualAdmission || !source.sourceLeg?.writeAuthorization || !source.sourceLeg?.governanceRegistry)
    fail("direct_project_memory_propagation_authority_mismatch", "world_manager");
  if (source.sourceLeg.contextualAdmission.candidate.targetScope.scopeKind !== "user_world") fail("direct_project_memory_propagation_scope_mismatch", "sourceLeg");
  const sourceResult = executePropagationLeg(source.graph, source.sourceLeg, "world_manager", options);
  const record = propagationStateStore.recordDelivered(buildProjectWorldPropagationRecord({ propagationId: source.propagationId, direction: "world_to_project", projectId: source.projectId, state: "delivered", sourceTransition: sourceResult.transition, sourceBinding: transitionBinding(sourceResult.transition, source.graph, sourceResult.graph, source.sourceLeg.governanceRegistry, sourceResult.governanceRegistry), affectedNodeIds: transitionMutationIds(sourceResult.transition), sourceRefs: source.sourceRefs }, options));
  return { graph: sourceResult.graph, governanceRegistry: sourceResult.governanceRegistry, sourceResult, sourcePreGraph: source.graph, sourcePreGovernanceRegistry: source.sourceLeg.governanceRegistry, record };
}
function completeWorldToProjectPropagation(input = {}, options = {}) {
  const source = object(input, "completeWorldToProjectPropagationInput");
  if (Object.hasOwn(source, "propagationStateStore"))
    fail("direct_project_memory_propagation_store_request_forbidden", "propagationStateStore");
  const propagationStateStore = requirePropagationController(options.propagationController); validateProjectWorldPropagationRecord(source.record);
  const storedRecord = propagationStateStore.read(source.record.propagationId);
  if (!storedRecord || !sameReceipt(storedRecord, source.record)) fail("direct_project_memory_propagation_store_context_mismatch", "delivered_record");
  if (source.record.direction !== "world_to_project" || source.record.state !== "delivered") fail("direct_project_memory_propagation_state_mismatch", "world_to_project");
  rejectForeignSuppliedSourceResult(source.record, source.graph, source.sourceResult);
  propagationDestinationLeg(source.record, source.graph, source.governanceRegistry, source.destinationLeg, "project_manager", { scopeKind: "project", projectId: source.record.projectId, workThreadId: "" });
  validatePropagationRefreshPreconditions(source.record, source.graph, source.refreshContext);
  const destinationResult = executePropagationLeg(source.graph, { ...source.destinationLeg, propagationTransactionRef: closureArtifactRef(`project_world_propagation_${source.record.propagationId}`, source.record.propagationId, source.record.propagationDigest, options) }, "project_manager", options);
  const affected = transitionMutationIds(consumedTransition(source.graph, source.record.sourceTransitionRef, "sourceTransition"));
  if (canonicalJson(affected) !== canonicalJson(source.record.affectedNodeIds.concat(source.record.affectedEdgeIds).sort())) fail("direct_project_memory_packet_mutation_mismatch", "record");
  const refresh = rebuildPropagationBootRefresh(destinationResult.graph, source.record, source.refreshContext, options);
  const candidate = buildAppliedProjectWorldPropagationRecord({ ...source.record, state: "applied", sourceTransition: consumedTransition(source.graph, source.record.sourceTransitionRef, "sourceTransition"), destinationTransition: destinationResult.transition, destinationBinding: transitionBinding(destinationResult.transition, source.graph, destinationResult.graph, source.governanceRegistry, destinationResult.governanceRegistry), destinationExpectedRevisionRefs: [], bootRefreshes: [refresh], sourceRefs: source.record.sourceRefs }, options);
  const record = propagationStateStore.admitApplied(candidate, { deliveredRecordDigest: source.record.propagationDigest, sourcePreGraph: source.sourcePreGraph, sourcePostGraph: source.graph, destinationPostGraph: destinationResult.graph, sourcePreGovernanceRegistry: source.sourcePreGovernanceRegistry, sourcePostGovernanceRegistry: source.governanceRegistry, destinationPostGovernanceRegistry: destinationResult.governanceRegistry });
  return { graph: destinationResult.graph, governanceRegistry: destinationResult.governanceRegistry, destinationResult, record };
}

function buildProjectToWorldStatusProjection(input = {}, options = {}) {
  const source = object(input, "projectToWorldStatusProjectionInput");
  const graph = source.graph;
  if (graph) validateHierarchicalWorldmodelGraph(graph);
  const projectId = normalizeId(source.projectId, "project");
  const graphNodes = graph ? graph.nodes.filter((node) => node.scope?.projectId === projectId) : null;
  if (graph && !graphNodes.some((node) => node.nodeKind === "project_root")) fail("direct_project_memory_status_graph_project_mismatch", projectId);
  const graphRef = (node, kind = "worldmodel_semantic_node") => ({ kind, id: node.nodeId, digest: node.digest, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false });
  const revision = graph?.scopedRevisionRefs.find((entry) => entry.scopeKind === "project" && entry.projectId === projectId);
  const goals = graphNodes?.filter((node) => node.lifecycle === "active" && ["goal", "terminal_goal", "invariant"].includes(node.nodeKind)).map(graphRef) || source.terminalGoalNodeRefs || [];
  const progress = graphNodes?.find((node) => node.lifecycle === "active" && ["progress", "project_root", "decision"].includes(node.nodeKind));
  const strategic = graph ? graph.transitions.flatMap((transition) => transition.mutations || []).map((mutation) => mutation.afterRef).filter(Boolean).filter((ref) => graph.nodes.some((node) => node.nodeId === ref.id && node.scope?.projectId === projectId)).map((ref) => ({ ...ref, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false })) : source.strategicChangeRefs || [];
  const result = {
    schema: PROJECT_TO_WORLD_STATUS_PROJECTION_SCHEMA,
    projectionId: normalizeId(
      source.projectionId || source.id,
      "project_to_world_status",
    ),
    projectId,
    projectRevision: revision ? revision.revision : Number.isInteger(source.projectRevision)
      ? source.projectRevision
      : 0,
    terminalGoalNodeRefs: goals.map((ref) =>
      normalizedNodeRef(ref),
    ),
    currentPhase: graph ? "active_project_graph" : normalizeString(source.currentPhase, "unknown"),
    progressSummaryNodeRef: normalizedNodeRef(progress ? graphRef(progress) : source.progressSummaryNodeRef),
    activeWorkThreadRefs: (graphNodes?.filter((node) => node.scope?.scopeKind === "work_thread" && node.lifecycle === "active").map((node) => graphRef(node, "work_thread")) || source.activeWorkThreadRefs || []).map((ref) =>
      normalizedNodeRef(ref, "work_thread"),
    ),
    blockerRefs: (source.blockerRefs || []).map((ref) =>
      normalizedNodeRef(ref),
    ),
    profileNeedRefs: (source.profileNeedRefs || []).map((ref) =>
      normalizedNodeRef(ref),
    ),
    crossProjectCandidateRefs: (source.crossProjectCandidateRefs || []).map(
      (ref) => normalizedNodeRef(ref, "cross_project_memory_candidate"),
    ),
    strategicChangeRefs: strategic.map((ref) =>
      normalizedNodeRef(ref),
    ),
    rawProjectMemoryIncluded: false,
    rawWorkThreadEvidenceIncluded: false,
    sourceRefs: refs(source.sourceRefs, options),
    actionAuthorityGranted: false,
  };
  result.projectionDigest = digest(
    "direct-project-to-world-status-projection@1",
    result,
  );
  return result;
}
function validateProjectToWorldStatusProjection(value) {
  object(value, "projectToWorldStatusProjection");
  closed(
    value,
    new Set([
      "schema",
      "projectionId",
      "projectId",
      "projectRevision",
      "terminalGoalNodeRefs",
      "currentPhase",
      "progressSummaryNodeRef",
      "activeWorkThreadRefs",
      "blockerRefs",
      "profileNeedRefs",
      "crossProjectCandidateRefs",
      "strategicChangeRefs",
      "rawProjectMemoryIncluded",
      "rawWorkThreadEvidenceIncluded",
      "sourceRefs",
      "actionAuthorityGranted",
      "projectionDigest",
    ]),
    "projectToWorldStatusProjection",
  );
  if (value.schema !== PROJECT_TO_WORLD_STATUS_PROJECTION_SCHEMA)
    fail(
      "direct_project_memory_schema_mismatch",
      "projectToWorldStatusProjection",
    );
  ["projectionId", "projectId", "currentPhase"].forEach((key) =>
    string(value[key], `projectToWorldStatusProjection.${key}`),
  );
  integer(
    value.projectRevision,
    "projectToWorldStatusProjection.projectRevision",
  );
  [
    "terminalGoalNodeRefs",
    "activeWorkThreadRefs",
    "blockerRefs",
    "profileNeedRefs",
    "crossProjectCandidateRefs",
    "strategicChangeRefs",
  ].forEach((key) =>
    nodeRefs(value[key], `projectToWorldStatusProjection.${key}`),
  );
  nodeRef(
    value.progressSummaryNodeRef,
    "projectToWorldStatusProjection.progressSummaryNodeRef",
  );
  exactRefs(value.sourceRefs, "projectToWorldStatusProjection.sourceRefs");
  if (
    value.rawProjectMemoryIncluded !== false ||
    value.rawWorkThreadEvidenceIncluded !== false ||
    value.actionAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_status_projection_boundary",
      "projectToWorldStatusProjection",
    );
  noRawOrAuthority(value, "projectToWorldStatusProjection");
  checked(
    value,
    "projectionDigest",
    "direct-project-to-world-status-projection@1",
    "projectToWorldStatusProjection",
  );
  return true;
}

function buildProjectGraphUpdateAcknowledgement(input = {}, options = {}, admission = null) {
  const source = object(input, "projectGraphUpdateAcknowledgementInput");
  const packet = source.packet;
  const manager = source.projectManagerProfile;
  validateWorldToProjectUpdatePacket(packet);
  validateProjectManagerProfile(manager);
  if (packet.projectId !== manager.projectId)
    fail(
      "direct_project_memory_ack_manager_mismatch",
      "projectGraphUpdateAcknowledgement",
    );
  if (source.outcome === "applied" && admission !== INTERNAL_PROPAGATION_ADMISSION)
    fail("direct_project_memory_ack_authoritative_admission_required", "applied");
  if (source.outcome === "applied" && !source.destinationTransition)
    fail("direct_project_memory_ack_transition_required", "projectGraphUpdateAcknowledgement");
  const destinationTransitionRef = source.destinationTransition
    ? transitionRef(source.destinationTransition, options)
    : null;
  const outcome = source.destinationTransition ? "applied" : ACKS.has(source.outcome) ? source.outcome : "stale_remand";
  const result = {
    schema: PROJECT_GRAPH_UPDATE_ACKNOWLEDGEMENT_SCHEMA,
    acknowledgementId: normalizeId(
      source.acknowledgementId || source.id,
      "project_graph_update_ack",
    ),
    updatePacketId: packet.updatePacketId,
    projectId: packet.projectId,
    projectManagerAgentId: manager.projectManagerAgentId,
    outcome,
    ...(destinationTransitionRef ? { destinationTransitionRef } : {}),
    ...(source.resultingProjectionRef
      ? {
          resultingProjectionRef: normalizedNodeRef(
            source.resultingProjectionRef,
            "project_to_world_status_projection",
          ),
        }
      : {}),
    affectedWorkThreadRefs: (source.affectedWorkThreadRefs || []).map((ref) =>
      normalizedNodeRef(ref, "work_thread"),
    ),
    sourceRefs: refs(source.sourceRefs || packet.sourceRefs, options),
    actionAuthorityGranted: false,
  };
  result.acknowledgementDigest = digest(
    "direct-project-graph-update-acknowledgement@1",
    result,
  );
  return result;
}
function validateProjectGraphUpdateAcknowledgementShape(value, context = {}, { allowApplied = false } = {}) {
  object(value, "projectGraphUpdateAcknowledgement");
  closed(
    value,
    new Set([
      "schema",
      "acknowledgementId",
      "updatePacketId",
      "projectId",
      "projectManagerAgentId",
      "outcome",
      "destinationTransitionRef",
      "resultingProjectionRef",
      "affectedWorkThreadRefs",
      "sourceRefs",
      "actionAuthorityGranted",
      "acknowledgementDigest",
    ]),
    "projectGraphUpdateAcknowledgement",
  );
  if (value.schema !== PROJECT_GRAPH_UPDATE_ACKNOWLEDGEMENT_SCHEMA)
    fail(
      "direct_project_memory_schema_mismatch",
      "projectGraphUpdateAcknowledgement",
    );
  [
    "acknowledgementId",
    "updatePacketId",
    "projectId",
    "projectManagerAgentId",
  ].forEach((key) =>
    string(value[key], `projectGraphUpdateAcknowledgement.${key}`),
  );
  if (!ACKS.has(value.outcome))
    fail(
      "direct_project_memory_invalid_acknowledgement",
      "projectGraphUpdateAcknowledgement.outcome",
    );
  if (value.resultingProjectionRef)
    nodeRef(
      value.resultingProjectionRef,
      "projectGraphUpdateAcknowledgement.resultingProjectionRef",
    );
  nodeRefs(
    value.affectedWorkThreadRefs,
    "projectGraphUpdateAcknowledgement.affectedWorkThreadRefs",
  );
  exactRefs(value.sourceRefs, "projectGraphUpdateAcknowledgement.sourceRefs");
  if (context.packet) {
    validateWorldToProjectUpdatePacket(context.packet);
    if (
      value.updatePacketId !== context.packet.updatePacketId ||
      value.projectId !== context.packet.projectId ||
      (context.packet.materiality === "immediate_rebase" &&
        value.outcome === "scheduled_checkpoint")
    )
      fail(
        "direct_project_memory_ack_packet_mismatch",
        "projectGraphUpdateAcknowledgement",
      );
  }
  if (value.outcome === "applied" && !value.destinationTransitionRef)
    fail("direct_project_memory_ack_transition_required", "projectGraphUpdateAcknowledgement");
  if (value.outcome === "applied" && !allowApplied)
    fail("direct_project_memory_ack_authoritative_admission_required", "applied");
  if (value.destinationTransitionRef)
    exactRefs([value.destinationTransitionRef], "projectGraphUpdateAcknowledgement.destinationTransitionRef");
  if (context.projectManagerProfile) {
    validateProjectManagerProfile(context.projectManagerProfile);
    if (
      value.projectId !== context.projectManagerProfile.projectId ||
      value.projectManagerAgentId !==
        context.projectManagerProfile.projectManagerAgentId
    )
      fail(
        "direct_project_memory_ack_manager_mismatch",
        "projectGraphUpdateAcknowledgement",
      );
  }
  if (value.actionAuthorityGranted !== false)
    fail(
      "direct_project_memory_ack_authority_violation",
      "projectGraphUpdateAcknowledgement",
    );
  noRawOrAuthority(value, "projectGraphUpdateAcknowledgement");
  checked(
    value,
    "acknowledgementDigest",
    "direct-project-graph-update-acknowledgement@1",
    "projectGraphUpdateAcknowledgement",
  );
  return true;
}
function validateProjectGraphUpdateAcknowledgement(value, context = {}) {
  return validateProjectGraphUpdateAcknowledgementShape(value, context);
}
// Applied acknowledgements are store readbacks, not portable packet receipts.
// The store's applied propagation admission binds the packet's exact mutation
// set and transition before this function returns a runtime effect claim.
function admitProjectGraphUpdateAcknowledgementAgainstContext(value, context = {}) {
  const propagationStateStore = requirePropagationController(context.propagationController);
  const packet = context.packet;
  validateProjectGraphUpdateAcknowledgementShape(value, { packet, projectManagerProfile: context.projectManagerProfile }, { allowApplied: true });
  if (value.outcome !== "applied") fail("direct_project_memory_ack_applied_required", "acknowledgement");
  const propagationContext = { ...(context.propagationContext || {}), packet };
  const record = propagationStateStore.readApplied(context.propagationId, propagationContext);
  if (record.direction !== "world_to_project" || record.projectId !== value.projectId || value.destinationTransitionRef?.sourceId !== record.destinationTransitionRef.sourceId || value.destinationTransitionRef?.sourceDigest?.value !== record.destinationTransitionRef.sourceDigest?.value || !sameReceipt(packetAffectedIds(packet), receiptIds(record)))
    fail("direct_project_memory_ack_context_mismatch", "propagation");
  return clone(value);
}
// The only supported way to emit an applied acknowledgement.  It reads the
// durable, branded record first, then derives the acknowledgement from that
// exact entry.  A packet or a transition receipt alone can never produce one.
function buildAppliedProjectGraphUpdateAcknowledgementFromController(input = {}, options = {}) {
  const source = object(input, "projectGraphAppliedAcknowledgementInput");
  const propagationStateStore = requirePropagationController(options.propagationController);
  const packet = source.packet;
  const propagationContext = { ...(source.propagationContext || {}), packet };
  const record = propagationStateStore.readApplied(source.propagationId, propagationContext);
  if (record.direction !== "world_to_project" || record.projectId !== packet?.projectId)
    fail("direct_project_memory_ack_context_mismatch", "propagation");
  const acknowledgement = buildProjectGraphUpdateAcknowledgement({
    acknowledgementId: source.acknowledgementId,
    packet,
    projectManagerProfile: source.projectManagerProfile,
    outcome: "applied",
    destinationTransition: {
      outcome: "committed",
      transitionId: record.destinationTransitionRef.sourceId,
      digest: record.destinationTransitionRef.sourceDigest.value,
    },
    resultingProjectionRef: source.resultingProjectionRef,
    affectedWorkThreadRefs: source.affectedWorkThreadRefs,
    sourceRefs: source.sourceRefs || packet?.sourceRefs,
  }, options, INTERNAL_PROPAGATION_ADMISSION);
  return admitProjectGraphUpdateAcknowledgementAgainstContext(acknowledgement, {
    packet,
    projectManagerProfile: source.projectManagerProfile,
    propagationId: source.propagationId,
    propagationContext: source.propagationContext,
    propagationController: options.propagationController,
  });
}

function evaluateProjectionMateriality(input = {}) {
  const source = object(input, "projectionMaterialityInput");
  const affected = source.projectAffected !== false;
  if (!affected)
    return {
      impact: "unaffected",
      materiality: "future_work_only",
      blockWorkThreads: false,
      rebaseBootPackets: false,
    };
  const event = normalizeString(source.event, "ordinary_idea");
  if (["authority_revocation", "terminal_goal_contradiction"].includes(event))
    return {
      impact: "immediate_rebase_block",
      materiality: "immediate_rebase",
      blockWorkThreads: true,
      rebaseBootPackets: true,
    };
  if (["active_architecture_change", "active_goal_change"].includes(event))
    return {
      impact:
        source.impactEvidenceImmediate === true
          ? "immediate_rebase_block"
          : "next_safe_checkpoint",
      materiality:
        source.impactEvidenceImmediate === true
          ? "immediate_rebase"
          : "next_safe_checkpoint",
      blockWorkThreads: source.impactEvidenceImmediate === true,
      rebaseBootPackets: true,
    };
  if (event === "historical_only")
    return {
      impact: "no_invalidation",
      materiality: "future_work_only",
      blockWorkThreads: false,
      rebaseBootPackets: false,
    };
  return {
    impact: "next_manager_turn",
    materiality: "next_manager_turn",
    blockWorkThreads: false,
    rebaseBootPackets: false,
  };
}
function buildProjectUpdateImpactWitness(input = {}, options = {}) {
  const source = object(input, "projectUpdateImpactWitnessInput");
  const packet = source.packet;
  validateWorldToProjectUpdatePacket(packet);
  const materiality = evaluateProjectionMateriality({
    ...source,
    event: packet.changeClass,
    impactEvidenceImmediate:
      packet.impactPosture.kind === "evidence_backed_immediate",
  });
  const result = {
    schema: PROJECT_UPDATE_IMPACT_WITNESS_SCHEMA,
    witnessId: normalizeId(
      source.witnessId || source.id,
      "project_update_impact",
    ),
    updatePacketId: packet.updatePacketId,
    projectId: packet.projectId,
    changeClass: packet.changeClass,
    impact: materiality.impact,
    materiality: materiality.materiality,
    affectedWorkThreadRefs: (source.affectedWorkThreadRefs || []).map((ref) =>
      normalizedNodeRef(ref, "work_thread"),
    ),
    affectedBootPacketRefs: (source.affectedBootPacketRefs || []).map((ref) =>
      normalizedNodeRef(ref, "worker_boot_packet"),
    ),
    blockWorkThreads: materiality.blockWorkThreads,
    rebaseBootPackets: materiality.rebaseBootPackets,
    sourceRefs: refs(source.sourceRefs || packet.sourceRefs, options),
    actionAuthorityGranted: false,
  };
  result.impactDigest = digest(
    "direct-project-update-impact-witness@1",
    result,
  );
  return result;
}
function validateProjectUpdateImpactWitness(value, context = {}) {
  object(value, "projectUpdateImpactWitness");
  closed(
    value,
    new Set([
      "schema",
      "witnessId",
      "updatePacketId",
      "projectId",
      "changeClass",
      "impact",
      "materiality",
      "affectedWorkThreadRefs",
      "affectedBootPacketRefs",
      "blockWorkThreads",
      "rebaseBootPackets",
      "sourceRefs",
      "actionAuthorityGranted",
      "impactDigest",
    ]),
    "projectUpdateImpactWitness",
  );
  if (
    value.schema !== PROJECT_UPDATE_IMPACT_WITNESS_SCHEMA ||
    !IMPACTS.has(value.impact) ||
    !CHANGE_CLASSES.has(value.changeClass) ||
    !MATERIALITIES.has(value.materiality)
  )
    fail("direct_project_memory_impact_invalid", "projectUpdateImpactWitness");
  ["witnessId", "updatePacketId", "projectId"].forEach((key) =>
    string(value[key], `projectUpdateImpactWitness.${key}`),
  );
  ["affectedWorkThreadRefs", "affectedBootPacketRefs"].forEach((key) =>
    nodeRefs(value[key], `projectUpdateImpactWitness.${key}`),
  );
  exactRefs(value.sourceRefs, "projectUpdateImpactWitness.sourceRefs");
  if (
    (value.impact === "immediate_rebase_block") !==
      (value.blockWorkThreads === true) ||
    (value.impact === "immediate_rebase_block" &&
      (!value.affectedWorkThreadRefs.length ||
        !value.affectedBootPacketRefs.length)) ||
    value.actionAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_impact_authority_violation",
      "projectUpdateImpactWitness",
    );
  if (
    context.packet &&
    (value.updatePacketId !== context.packet.updatePacketId ||
      value.projectId !== context.packet.projectId ||
      value.changeClass !== context.packet.changeClass ||
      value.materiality !== context.packet.materiality)
  )
    fail(
      "direct_project_memory_impact_packet_mismatch",
      "projectUpdateImpactWitness",
    );
  noRawOrAuthority(value, "projectUpdateImpactWitness");
  checked(
    value,
    "impactDigest",
    "direct-project-update-impact-witness@1",
    "projectUpdateImpactWitness",
  );
  return true;
}

function admitProjectMemoryCandidate(input = {}, options = {}) {
  const source = object(input, "projectMemoryAdmissionInput");
  const candidate = source.candidate;
  const graph = source.graph;
  const manager = source.projectManagerProfile;
  validateProjectMemoryCandidate(candidate, {
    closureEvidenceContexts: source.closureEvidenceContexts,
  });
  validateProjectManagerProfile(manager);
  const base = {
    schema: PROJECT_MEMORY_ADMISSION_SCHEMA,
    admissionId: normalizeId(
      source.admissionId || source.id,
      "project_memory_admission",
    ),
    candidateId: candidate.candidateId,
    projectId: candidate.projectId,
    projectManagerAgentId: manager.projectManagerAgentId,
    decision: "remand",
    sourceRefs: refs(source.sourceRefs || candidate.sourceRefs, options),
    candidateIsProjectTruth: false,
    directGraphWrite: false,
    actionAuthorityGranted: false,
  };
  if (
    candidate.projectId !== manager.projectId ||
    candidate.projectManagerAgentId !== manager.projectManagerAgentId
  )
    base.reasonCode = "project_manager_identity_mismatch";
  else if (source.decision === "reject" || source.decision === "defer") {
    base.decision = source.decision;
    base.reasonCode =
      source.decision === "reject"
        ? "contextual_audit_rejected"
        : "contextual_audit_deferred";
  } else if (source.decision !== "admit")
    base.reasonCode = "explicit_admit_required";
  else {
    const expected = graph?.scopedRevisionRefs?.find(
      (ref) =>
        ref.scopeKind === "project" && ref.projectId === candidate.projectId,
    );
    if (!expected || expected.revision !== candidate.expectedProjectRevision)
      base.reasonCode = "stale_project_revision";
    else {
      const custodyPath = `project.${candidate.proposedSemanticPath.slice(2).join(".")}`;
      const custodyWriteWitness = source.custodyWriteWitness;
      if (!custodyWriteWitness) {
        base.reasonCode = "explicit_custody_witness_required";
        const artifact = { ...base };
        artifact.admissionDigest = digest(
          "direct-project-memory-admission@1",
          artifact,
        );
        return { admission: artifact, graph, committed: false };
      }
      if (
        !source.authorityTraceRef ||
        source.authorityTraceRef.sourceKind !== "promotion_decision" ||
        !normalizeString(
          source.authorityTraceRef.sourceDigest?.value,
          "",
        ).startsWith("sha256:") ||
        candidate.sourceRefs.some(
          (ref) => ref.sourceId === source.authorityTraceRef.sourceId,
        )
      ) {
        base.reasonCode = "separate_promotion_authority_required";
        const artifact = { ...base };
        artifact.admissionDigest = digest(
          "direct-project-memory-admission@1",
          artifact,
        );
        return { admission: artifact, graph, committed: false };
      }
      const ingressId = normalizeId(source.ingressId, "project_memory_ingress");
      const ingress = buildWorldmodelIngressEnvelope({ ingressId, inputKind: "work_thread_closure", receivedByAgentId: manager.projectManagerAgentId, receivedByRole: "project_manager", declaredScopeHints: [{ scopeKind: "project", userProfileId: graph.userProfileId, projectId: candidate.projectId, semanticPath: candidate.proposedSemanticPath }], sourceRefs: candidate.sourceRefs, currentInstructionAuthority: false }, options);
      const resolution = buildSemanticTargetResolution({
        resolutionId: `${ingressId}_resolution`,
        ingressId,
        candidateTargets: [
          {
            scopeKind: "project",
            userProfileId: graph.userProfileId,
            projectId: candidate.projectId,
            semanticPath: candidate.proposedSemanticPath,
            confidence: "exact",
          },
        ],
        route: "commit_current_scope",
        sourceRefs: candidate.sourceRefs,
      });
      const delta = buildWorldmodelDeltaCandidate(
        {
          candidateId: `${candidate.candidateId}_promotion`,
          ingressId,
          targetResolutionId: resolution.resolutionId,
          receivedByRole: "project_manager",
          targetScope: {
            scopeKind: "project",
            userProfileId: graph.userProfileId,
            projectId: candidate.projectId,
            semanticPath: candidate.proposedSemanticPath,
          },
          abstractionLevel: candidate.proposedNode.abstractionLevel,
          candidateState: "accepted_for_commit",
          promotionOrigin: "work_thread_evidence",
          proposedNodeMutations: [
            {
              operation: "add",
              targetNodeId: candidate.proposedNode.nodeId,
              candidateNode: {
                ...candidate.proposedNode,
                graphId: graph.graphId,
                lifecycle: "active",
                sourceRefs: candidate.sourceRefs,
              },
            },
          ],
          expectedScopeRevisions: [expected],
          sourceRefs: candidate.sourceRefs,
        },
        options,
      );
      const brokerPacket = buildSemanticIngressBrokerPacket({ ingressEnvelope: ingress, targetResolution: resolution }, options);
      const custodyMatrix = source.custodyMatrix || buildProjectCustodyWriteMatrix({ matrixId: custodyWriteWitness.matrixRef.id, projectId: candidate.projectId });
      const authorityDecision = source.authorityDecision || buildWorldmodelContextualAuthorityDecision({ authorityDecisionId: `${candidate.candidateId}_authority`, graph, managerProfile: manager, actorAgentId: manager.projectManagerAgentId, actorRole: "project_manager", targetScope: delta.targetScope, issuedAt: source.issuedAt, expiresAt: source.authorityExpiresAt || "2099-01-01T00:00:00.000Z" }, options);
      const contextualAdmission = buildWorldmodelContextualAdmission({ admissionId: `${candidate.candidateId}_contextual_admission`, graph, ingressEnvelope: ingress, brokerPacket, targetResolution: resolution, candidate: delta, managerProfile: manager, custodyMatrix, custodyWriteWitness, authorityDecision, governanceRegistry: source.governanceRegistry, registryRef: source.registryRef || governanceRegistryRef(source.governanceRegistry), expectedRegistryRevision: source.expectedRegistryRevision, decidedByAgentId: manager.projectManagerAgentId, decidedByRole: "project_manager", idempotencyKey: source.idempotencyKey || `project_memory_${candidate.candidateId}` }, options);
      const writeAuthorization = buildGraphWriteAuthorizationForTransition(graph, { authorizationId: `${candidate.candidateId}_write`, actorAgentId: manager.projectManagerAgentId, actorRole: "project_manager", mutations: contextualAdmission.mutations, expectedScopeRevisions: contextualAdmission.expectedScopeRevisions, authorityTraceRef: source.authorityTraceRef, idempotencyKey: contextualAdmission.idempotencyKey, authorizationExpiresAt: contextualAdmission.expiresAt });
      const promotion = promoteWorldmodelDeltaCandidate(
        {
          graph,
          candidate: delta,
          targetResolution: resolution,
          decidedByAgentId: manager.projectManagerAgentId,
          decidedByRole: "project_manager",
          custodyWriteWitness,
          authorityTraceRef: source.authorityTraceRef,
          contextualAdmission,
          governanceRegistry: source.governanceRegistry,
          storeAdmission: source.storeAdmission,
          writeAuthorization,
          explicitPromotionRequested: true,
          idempotencyKey:
            source.idempotencyKey || `project_memory_${candidate.candidateId}`,
        },
        options,
      );
      base.decision = promotion.committed
        ? "admit"
        : promotion.promotion.decision === "reject"
          ? "reject"
          : promotion.promotion.decision === "defer"
            ? "defer"
            : "remand";
      base.reasonCode = promotion.committed
        ? "governed_promotion_committed"
        : promotion.promotion.omissions?.[0] || "governed_promotion_remand";
      base.promotionRef = sourceRef(
        {
          sourceRefId: `promotion_${promotion.promotion.promotionId}`,
          sourceKind: "promotion_decision",
          sourceId: promotion.promotion.promotionId,
          sourceConfidence: "accepted_profile",
          freshness: "fresh",
          sourceDigest: {
            algorithm: "sha256",
            value: promotion.promotion.digest,
            digestOf: "canonical_json",
          },
        },
        options,
      );
      base.resultingProjectRevision = promotion.graph.scopedRevisionRefs.find(
        (ref) =>
          ref.scopeKind === "project" && ref.projectId === candidate.projectId,
      )?.revision;
      base.result = promotion;
    }
  }
  const artifact = { ...base };
  delete artifact.result;
  artifact.admissionDigest = digest(
    "direct-project-memory-admission@1",
    artifact,
  );
  return {
    admission: artifact,
    ...(base.result
      ? {
          graph: base.result.graph,
          governanceRegistry: base.result.governanceRegistry,
          promotion: base.result.promotion,
          committed: base.result.committed,
        }
      : { graph, committed: false }),
  };
}
function validateProjectMemoryAdmission(value) {
  object(value, "projectMemoryAdmission");
  closed(
    value,
    new Set([
      "schema",
      "admissionId",
      "candidateId",
      "projectId",
      "projectManagerAgentId",
      "decision",
      "reasonCode",
      "sourceRefs",
      "candidateIsProjectTruth",
      "directGraphWrite",
      "actionAuthorityGranted",
      "promotionRef",
      "resultingProjectRevision",
      "admissionDigest",
    ]),
    "projectMemoryAdmission",
  );
  if (
    value.schema !== PROJECT_MEMORY_ADMISSION_SCHEMA ||
    !ADMISSION_DECISIONS.has(value.decision)
  )
    fail("direct_project_memory_admission_invalid", "projectMemoryAdmission");
  [
    "admissionId",
    "candidateId",
    "projectId",
    "projectManagerAgentId",
    "reasonCode",
  ].forEach((key) => string(value[key], `projectMemoryAdmission.${key}`));
  exactRefs(value.sourceRefs, "projectMemoryAdmission.sourceRefs");
  if (value.decision === "admit") {
    exactRefs([value.promotionRef], "projectMemoryAdmission.promotionRef");
    integer(
      value.resultingProjectRevision,
      "projectMemoryAdmission.resultingProjectRevision",
    );
  }
  if (
    value.candidateIsProjectTruth !== false ||
    value.directGraphWrite !== false ||
    value.actionAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_admission_authority_violation",
      "projectMemoryAdmission",
    );
  checked(
    value,
    "admissionDigest",
    "direct-project-memory-admission@1",
    "projectMemoryAdmission",
  );
  return true;
}

function buildCrossProjectMemoryEscalation(input = {}, options = {}) {
  const source = object(input, "crossProjectMemoryEscalationInput");
  const candidate = source.candidate;
  validateProjectMemoryCandidate(candidate, {
    closureEvidenceContexts: source.closureEvidenceContexts,
  });
  const result = {
    schema: CROSS_PROJECT_MEMORY_ESCALATION_SCHEMA,
    escalationId: normalizeId(
      source.escalationId || source.id,
      "cross_project_memory_escalation",
    ),
    sourceProjectId: candidate.projectId,
    targetScope: "user_world",
    candidateRef: sourceRef(
      {
        sourceRefId: `project_memory_candidate_${candidate.candidateId}`,
        sourceKind: "family_specific",
        sourceId: candidate.candidateId,
        sourceConfidence: "derived",
        freshness: "fresh",
        sourceDigest: {
          algorithm: "sha256",
          value: candidate.candidateDigest,
          digestOf: "canonical_json",
        },
      },
      options,
    ),
    autoPromotionAllowed: false,
    actionAuthorityGranted: false,
    sourceRefs: refs(source.sourceRefs || candidate.sourceRefs, options),
  };
  result.escalationDigest = digest(
    "direct-cross-project-memory-escalation@1",
    result,
  );
  return result;
}
function validateCrossProjectMemoryEscalation(value) {
  object(value, "crossProjectMemoryEscalation");
  closed(
    value,
    new Set([
      "schema",
      "escalationId",
      "sourceProjectId",
      "targetScope",
      "candidateRef",
      "autoPromotionAllowed",
      "actionAuthorityGranted",
      "sourceRefs",
      "escalationDigest",
    ]),
    "crossProjectMemoryEscalation",
  );
  if (
    value.schema !== CROSS_PROJECT_MEMORY_ESCALATION_SCHEMA ||
    value.targetScope !== "user_world" ||
    value.autoPromotionAllowed !== false ||
    value.actionAuthorityGranted !== false
  )
    fail(
      "direct_project_memory_cross_project_boundary",
      "crossProjectMemoryEscalation",
    );
  ["escalationId", "sourceProjectId"].forEach((key) =>
    string(value[key], `crossProjectMemoryEscalation.${key}`),
  );
  exactRefs([value.candidateRef], "crossProjectMemoryEscalation.candidateRef");
  exactRefs(value.sourceRefs, "crossProjectMemoryEscalation.sourceRefs");
  checked(
    value,
    "escalationDigest",
    "direct-cross-project-memory-escalation@1",
    "crossProjectMemoryEscalation",
  );
  return true;
}
function promoteCrossProjectMemoryEscalation() {
  fail(
    "direct_project_memory_cross_project_auto_promotion_forbidden",
    "candidate requires World Manager admission",
  );
}

module.exports = {
  PROJECT_MEMORY_CANDIDATE_SCHEMA,
  WORK_THREAD_CLOSURE_EVIDENCE_WITNESS_SCHEMA,
  SCOPED_WORLD_MEMORY_BINDING_SCHEMA,
  WORLD_TO_PROJECT_UPDATE_PACKET_SCHEMA,
  PROJECT_TO_WORLD_STATUS_PROJECTION_SCHEMA,
  PROJECT_GRAPH_UPDATE_ACKNOWLEDGEMENT_SCHEMA,
  PROJECT_MEMORY_ADMISSION_SCHEMA,
  PROJECT_UPDATE_IMPACT_WITNESS_SCHEMA,
  CROSS_PROJECT_MEMORY_ESCALATION_SCHEMA,
  PROPAGATION_RECORD_SCHEMA,
  PROPAGATION_STATE_STORE_SCHEMA,
  buildWorkThreadClosureEvidenceWitness,
  validateWorkThreadClosureEvidenceWitness,
  buildProjectMemoryCandidate,
  validateProjectMemoryCandidate,
  buildScopedWorldMemoryBinding,
  validateScopedWorldMemoryBinding,
  buildWorldToProjectUpdatePacket,
  validateWorldToProjectUpdatePacket,
  applyWorldToProjectUpdatePacket,
  buildProjectWorldPropagationRecord,
  validateProjectWorldPropagationRecord,
  admitProjectWorldPropagationRecordAgainstContext,
  createPropagationStateStore,
  createPropagationController,
  readAppliedProjectWorldPropagationRecordFromController,
  beginProjectToWorldPropagation,
  completeProjectToWorldPropagation,
  beginWorldToProjectPropagation,
  completeWorldToProjectPropagation,
  buildProjectToWorldStatusProjection,
  validateProjectToWorldStatusProjection,
  buildProjectGraphUpdateAcknowledgement,
  validateProjectGraphUpdateAcknowledgement,
  admitProjectGraphUpdateAcknowledgementAgainstContext,
  buildAppliedProjectGraphUpdateAcknowledgementFromController,
  evaluateProjectionMateriality,
  buildProjectUpdateImpactWitness,
  validateProjectUpdateImpactWitness,
  admitProjectMemoryCandidate,
  validateProjectMemoryAdmission,
  buildCrossProjectMemoryEscalation,
  validateCrossProjectMemoryEscalation,
  promoteCrossProjectMemoryEscalation,
};
