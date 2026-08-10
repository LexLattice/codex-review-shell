"use strict";

const crypto = require("node:crypto");
const {
  compileSemanticSurfaceProjection,
  validateSemanticSurfaceProjection,
} = require("./semantic-surface-compiler");
const {
  buildAroCurrentTargetComparison,
  validateAbstractReasoningObject,
  validateAroAdmissionReceipt,
  validateAroCurrentTargetComparison,
  validateAroReconstructionCandidate,
  validateAroReviewReceipt,
} = require("./aro-kernel");
const {
  validateAroReconstructionRun,
  validateRepositorySemanticSnapshot,
} = require("./aro-reconstruction-runtime");
const {
  validateAroMutationCompilationRun,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  validateAroRealizationContextImport,
  validateAroRealizationMappingRun,
  validateAroRealizationMappingWitness,
} = require("./aro-realization-mapping");
const {
  validateAroTargetDefinitionRun,
} = require("./aro-target-definition");
const {
  validateAroWorkerAuthorizationReceipt,
  validateAroWorkerCapabilityObservation,
  validateAroWorkerConstitution,
  validateAroWorkerHandoffRun,
  validateAroWorkerReviewReceipt,
  validateAroWorkerSourceFreshnessWitness,
} = require("./aro-worker-handoff");
const {
  validateAroExecutionEvidenceBundle,
  validateAroExecutionEvidenceRun,
} = require("./aro-execution-evidence");
const {
  validateAroClosureCandidate,
  validateAroSemanticVerificationAssessment,
  validateAroSemanticVerificationRun,
} = require("./aro-semantic-verification");
const {
  contextCanvasRef,
  thoughtBrushRegistry,
  thoughtBrushStrokeRef,
  validateContextCanvas,
  validateThoughtBrushStroke,
} = require("./thought-brush");
const {
  compileUnifiedWorldManagerProjection,
  validateUnifiedWorldManagerProjection,
} = require("./unified-projection");

const WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA = "direct_world_manager_submit_request@1";
const WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA = "direct_world_manager_bootstrap_manifest@1";
const WORLD_MANAGER_SEMANTIC_EVENT_SCHEMA = "direct_world_manager_semantic_event@2";
const WORLD_MANAGER_MESSAGE_SCHEMA = "direct_world_manager_message@1";
const WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA = "direct_world_manager_workbench_projection@1";
const WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA = "direct_world_manager_control_plane_store@1";

const K1_STAGE = "wm_k1";
const K2_STAGE = "wm_k2";
const K3_STAGE = "wm_k3";
const K4_STAGE = "wm_k4";
const K5_PLANNING_STAGE = "wm_k5_planning";
const K6_GENESIS_STAGE = "wm_k6_genesis";
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_SUMMARY_CHARS = 480;
const MAX_PROJECTS = 128;

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (!text) fail("world_manager_control_plane_missing_string", label);
  return text;
}

function boundedString(value, fallback = "", maxLength = MAX_SUMMARY_CHARS) {
  const text = normalizeString(value, fallback);
  return text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : text;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function stableValue(value, omittedFields = new Set()) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, omittedFields));
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (omittedFields.has(key) || typeof value[key] === "undefined") return output;
    output[key] = stableValue(value[key], omittedFields);
    return output;
  }, {});
}

function digestFor(domain, value, omittedFields = []) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value, new Set(omittedFields)))}`)
    .digest("hex")}`;
}

function stableId(prefix, value, length = 24) {
  return `${prefix}_${digestFor(`${prefix}@1`, value).slice(7, 7 + length)}`;
}

function normalizeRef(input = {}, fallbackKind = "world_manager_artifact") {
  const source = isPlainObject(input) ? input : {};
  const id = normalizeString(source.id || source.refId || source.artifactId, "");
  const digest = normalizeString(source.digest || source.artifactDigest, "");
  if (!id || !digest) fail("world_manager_control_plane_invalid_ref", fallbackKind);
  return {
    kind: normalizeString(source.kind, fallbackKind),
    id,
    digest,
    label: boundedString(source.label, fallbackKind, 160),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeRefs(values, fallbackKind) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 64).map((value) => normalizeRef(value, fallbackKind));
}

function optionalProjectionRef(
  kind,
  id,
  digest,
  label = "",
  projectId = "",
) {
  if (
    !normalizeString(kind, "") ||
    !normalizeString(id, "") ||
    !normalizeString(digest, "")
  ) {
    return null;
  }
  return normalizeRef({
    kind,
    id,
    digest,
    label:
      label ||
      kind.replace(/_/g, " "),
    ...(projectId
      ? { projectId }
      : {}),
  });
}

function validateRef(ref, label) {
  if (!isPlainObject(ref)) fail("world_manager_control_plane_invalid_ref", label);
  requireString(ref.kind, `${label}.kind`);
  requireString(ref.id, `${label}.id`);
  requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded !== false || ref.rawPathIncluded !== false || ref.rawSecretIncluded !== false) {
    fail("world_manager_control_plane_raw_ref_exposure", label);
  }
  return true;
}

function projectWorldId(userWorldId, projectId) {
  return stableId("project_world", { userWorldId, projectId });
}

function normalizeConfiguredProject(input = {}, index = 0, userWorldId = "user_world_local") {
  const projectId = requireString(input.id || input.projectId, `projects.${index}.projectId`);
  const configuration = {
    projectId,
    name: boundedString(input.name || input.label, projectId, 180),
    summary: boundedString(
      input.summary || input.description || input.goal,
      "Configured project awaiting semantic worldmodel binding.",
      640,
    ),
    runtimePath: boundedString(input.runtimePath, "unknown", 100),
    displayOrder: index,
  };
  return {
    ...configuration,
    projectWorldId: projectWorldId(userWorldId, projectId),
    configurationDigest: digestFor("direct-world-manager-configured-project@1", configuration),
    graphBindingState: "awaiting_worldmodel_binding",
    graphRef: null,
    grantsAuthority: false,
  };
}

function bootstrapConfigurationDigest(userWorldId, projects) {
  return digestFor("direct-world-manager-bootstrap-configuration@1", {
    userWorldId,
    projects: projects.map((project) => ({
      projectId: project.projectId,
      projectWorldId: project.projectWorldId,
      configurationDigest: project.configurationDigest,
      displayOrder: project.displayOrder,
    })),
  });
}

function buildWorldManagerBootstrapManifest(input = {}, options = {}) {
  const userWorldId = boundedString(input.userWorldId, "user_world_local", 180);
  const rawProjects = Array.isArray(input.projects) ? input.projects : [];
  if (!rawProjects.length) fail("world_manager_bootstrap_projects_required");
  if (rawProjects.length > MAX_PROJECTS) fail("world_manager_bootstrap_project_limit");
  const projects = rawProjects.map((project, index) =>
    normalizeConfiguredProject(project, index, userWorldId));
  const projectIds = new Set();
  for (const project of projects) {
    if (projectIds.has(project.projectId)) {
      fail("world_manager_bootstrap_duplicate_project", project.projectId);
    }
    projectIds.add(project.projectId);
  }
  const createdAt = normalizeString(input.createdAt, nowIso(options.now || Date.now));
  const manifest = {
    schema: WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA,
    bootstrapId: stableId("world_manager_bootstrap", { userWorldId }),
    revision: Number.isInteger(Number(input.revision)) && Number(input.revision) > 0
      ? Number(input.revision)
      : 1,
    userWorld: {
      userWorldId,
      identitySource: "local_app_profile",
      graphBindingState: "awaiting_worldmodel_binding",
      graphRef: null,
    },
    projects,
    configurationDigest: bootstrapConfigurationDigest(userWorldId, projects),
    worldmodelBindingState: "awaiting_k2",
    sourceKind: "workspace_config",
    createdAt,
    grantsAuthority: false,
    rawWorkspacePathIncluded: false,
    rawCredentialIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  manifest.manifestDigest = digestFor(
    WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA,
    manifest,
    ["manifestDigest"],
  );
  validateWorldManagerBootstrapManifest(manifest);
  return manifest;
}

function validateWorldManagerBootstrapManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schema !== WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA) {
    fail("world_manager_bootstrap_schema_mismatch");
  }
  requireString(manifest.bootstrapId, "bootstrap.bootstrapId");
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) {
    fail("world_manager_bootstrap_revision_invalid");
  }
  requireString(manifest.userWorld?.userWorldId, "bootstrap.userWorld.userWorldId");
  if (
    manifest.userWorld?.graphBindingState !== "awaiting_worldmodel_binding" ||
    manifest.userWorld?.graphRef !== null ||
    manifest.worldmodelBindingState !== "awaiting_k2" ||
    manifest.grantsAuthority !== false
  ) {
    fail("world_manager_bootstrap_authority_inflation");
  }
  if (!Array.isArray(manifest.projects) || !manifest.projects.length) {
    fail("world_manager_bootstrap_projects_required");
  }
  const ids = new Set();
  for (const [index, project] of manifest.projects.entries()) {
    requireString(project.projectId, `bootstrap.projects.${index}.projectId`);
    requireString(project.projectWorldId, `bootstrap.projects.${index}.projectWorldId`);
    requireString(project.configurationDigest, `bootstrap.projects.${index}.configurationDigest`);
    if (
      ids.has(project.projectId) ||
      project.graphBindingState !== "awaiting_worldmodel_binding" ||
      project.graphRef !== null ||
      project.grantsAuthority !== false
    ) {
      fail("world_manager_bootstrap_project_boundary", project.projectId);
    }
    ids.add(project.projectId);
  }
  if (
    manifest.rawWorkspacePathIncluded !== false ||
    manifest.rawCredentialIncluded !== false ||
    manifest.rawProviderPayloadIncluded !== false
  ) {
    fail("world_manager_bootstrap_raw_exposure");
  }
  const expected = digestFor(
    WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA,
    manifest,
    ["manifestDigest"],
  );
  if (manifest.manifestDigest !== expected) fail("world_manager_bootstrap_digest_mismatch");
  return true;
}

function normalizeScopeHint(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const bindingPosture = normalizeString(
    source.bindingPosture,
    "",
  );
  if (
    bindingPosture &&
    !["ambient_focus", "explicit_constraint"].includes(
      bindingPosture,
    )
  ) {
    fail("world_manager_submit_scope_binding_posture_invalid");
  }
  return {
    projectId: boundedString(source.projectId, "", 180),
    proposalId: boundedString(source.proposalId, "", 180),
    workThreadId: boundedString(source.workThreadId, "", 180),
    ...(bindingPosture ? { bindingPosture } : {}),
  };
}

function normalizeWorldManagerSubmitRequest(input = {}) {
  if (!isPlainObject(input)) fail("world_manager_submit_invalid_object");
  const schema = normalizeString(input.schema, WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA);
  if (schema !== WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA) fail("world_manager_submit_schema_mismatch");
  const clientRequestId = requireString(input.clientRequestId, "submit.clientRequestId");
  if (clientRequestId.length > 200) fail("world_manager_submit_client_id_too_long");
  const text = requireString(input.text, "submit.text");
  if (text.length > MAX_MESSAGE_CHARS) fail("world_manager_submit_text_too_large");
  const scopeHint = normalizeScopeHint(input.scopeHint);
  const request = {
    schema: WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
    clientRequestId,
    text,
    scopeHint,
    expectedProjectionRevision:
      Number.isInteger(Number(input.expectedProjectionRevision)) &&
      Number(input.expectedProjectionRevision) >= 0
        ? Number(input.expectedProjectionRevision)
        : null,
    attachmentDraftRefs: normalizeRefs(input.attachmentDraftRefs, "attachment_draft"),
  };
  request.requestDigest = digestFor(
    WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
    request,
    ["requestDigest", "expectedProjectionRevision"],
  );
  return request;
}

function validateWorldManagerSubmitRequest(request) {
  const normalized = normalizeWorldManagerSubmitRequest(request);
  if (request.requestDigest && request.requestDigest !== normalized.requestDigest) {
    fail("world_manager_submit_digest_mismatch");
  }
  return true;
}

function semanticEventDigest(event) {
  return digestFor(WORLD_MANAGER_SEMANTIC_EVENT_SCHEMA, event, ["eventDigest"]);
}

function buildWorldManagerMessage(input = {}, options = {}) {
  const message = {
    schema: WORLD_MANAGER_MESSAGE_SCHEMA,
    messageId: requireString(input.messageId, "message.messageId"),
    semanticEventId: requireString(input.semanticEventId, "message.semanticEventId"),
    clientRequestId: requireString(input.clientRequestId, "message.clientRequestId"),
    authorKind: "user",
    authorRole: "operator",
    projectId: boundedString(input.projectId, "", 180),
    text: requireString(input.text, "message.text"),
    presentationState: "received",
    createdAt: normalizeString(input.createdAt, nowIso(options.now || Date.now)),
    rawProviderPayloadIncluded: false,
    rawChainOfThoughtIncluded: false,
  };
  message.messageDigest = digestFor(
    WORLD_MANAGER_MESSAGE_SCHEMA,
    message,
    ["messageDigest"],
  );
  return message;
}

function validateWorldManagerMessage(message) {
  if (!isPlainObject(message) || message.schema !== WORLD_MANAGER_MESSAGE_SCHEMA) {
    fail("world_manager_message_schema_mismatch");
  }
  requireString(message.messageId, "message.messageId");
  requireString(message.semanticEventId, "message.semanticEventId");
  requireString(message.clientRequestId, "message.clientRequestId");
  requireString(message.text, "message.text");
  if (
    message.authorKind !== "user" ||
    message.authorRole !== "operator" ||
    message.presentationState !== "received" ||
    message.rawProviderPayloadIncluded !== false ||
    message.rawChainOfThoughtIncluded !== false
  ) {
    fail("world_manager_message_boundary_violation");
  }
  const expected = digestFor(WORLD_MANAGER_MESSAGE_SCHEMA, message, ["messageDigest"]);
  if (message.messageDigest !== expected) fail("world_manager_message_digest_mismatch");
  return true;
}

function buildWorldManagerSemanticEvent(input = {}, options = {}) {
  const eventKind = normalizeString(input.eventKind, "user_utterance_observed");
  const userIngress = eventKind === "user_utterance_observed";
  const event = {
    schema: WORLD_MANAGER_SEMANTIC_EVENT_SCHEMA,
    semanticEventId: requireString(input.semanticEventId, "event.semanticEventId"),
    lineageRootId: requireString(input.lineageRootId, "event.lineageRootId"),
    sequence: Number(input.sequence),
    clientRequestId: requireString(input.clientRequestId, "event.clientRequestId"),
    clientRequestDigest: requireString(input.clientRequestDigest, "event.clientRequestDigest"),
    eventKind,
    presentationState: normalizeString(
      input.presentationState,
      userIngress ? "received" : "queued",
    ),
    epistemicState: normalizeString(
      input.epistemicState,
      userIngress ? "observed" : "settled",
    ),
    authorityState: normalizeString(
      input.authorityState,
      userIngress ? "user_authored" : "non_authoritative",
    ),
    actorKind: normalizeString(input.actorKind, userIngress ? "user" : "harness"),
    actorRole: normalizeString(input.actorRole, userIngress ? "operator" : "semantic_router"),
    projectId: boundedString(input.projectId, "", 180),
    taskType: boundedString(input.taskType, "", 120),
    parentSemanticEventIds: Array.isArray(input.parentSemanticEventIds)
      ? input.parentSemanticEventIds.slice(0, 16).map((entry) =>
          boundedString(entry, "", 180)).filter(Boolean)
      : [],
    artifactRefs: normalizeRefs(input.artifactRefs, "world_manager_artifact"),
    sourceScopeRevisions: Array.isArray(input.sourceScopeRevisions)
      ? input.sourceScopeRevisions.slice(0, 16).map((entry) => ({
          scopeKind: boundedString(entry?.scopeKind, "bootstrap", 80),
          scopeId: boundedString(entry?.scopeId, "", 180),
          revision: Number(entry?.revision || 0),
          digest: boundedString(entry?.digest, "", 180),
        }))
      : [],
    expectedProjectionRevision:
      Number.isInteger(Number(input.expectedProjectionRevision)) &&
      Number(input.expectedProjectionRevision) >= 0
        ? Number(input.expectedProjectionRevision)
        : null,
    rendererSafeSummary: boundedString(input.rendererSafeSummary, "User message received."),
    previousEventDigest: normalizeString(input.previousEventDigest, ""),
    occurredAt: normalizeString(input.occurredAt, nowIso(options.now || Date.now)),
    grantsAuthority: false,
    rawProviderPayloadIncluded: false,
    rawChainOfThoughtIncluded: false,
  };
  event.eventDigest = semanticEventDigest(event);
  validateWorldManagerSemanticEvent(event);
  return event;
}

function validateWorldManagerSemanticEvent(event) {
  if (!isPlainObject(event) || event.schema !== WORLD_MANAGER_SEMANTIC_EVENT_SCHEMA) {
    fail("world_manager_semantic_event_schema_mismatch");
  }
  requireString(event.semanticEventId, "event.semanticEventId");
  requireString(event.lineageRootId, "event.lineageRootId");
  requireString(event.clientRequestId, "event.clientRequestId");
  requireString(event.clientRequestDigest, "event.clientRequestDigest");
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    fail("world_manager_semantic_event_sequence_invalid");
  }
  const allowedEventKinds = new Set([
    "user_utterance_observed",
    "task_settled",
    "clarification_requested",
    "settlement_remanded",
    "manager_context_prepared",
    "agent_world_compiled",
    "role_turn_started",
    "agent_result_completed",
    "reconciliation_started",
    "reconciliation_completed",
    "project_constitution_candidate_registered",
    "project_constitution_evidence_reviewed",
    "project_constitution_admitted",
    "project_substrate_provisioned",
    "plan_proposal_revision_registered",
    "aro_reconstruction_candidate_registered",
    "aro_reconstruction_evidence_reviewed",
    "abstract_reasoning_object_admitted",
    "semantic_child_materialized",
    "semantic_split_materialized",
    "semantic_split_execution_started",
    "semantic_split_join_started",
    "semantic_split_join_completed",
  ]);
  const allowedPresentationStates = new Set([
    "received",
    "settled",
    "clarification_required",
    "remanded",
    "queued",
    "validated",
    "running",
    "replied",
    "failed",
    "reconciling",
    "reconciled",
    "candidate",
    "evidence_reviewed",
    "canonical",
  ]);
  const allowedEpistemicStates = new Set([
    "observed",
    "settled",
    "ambiguous",
    "validated",
    "remanded",
    "running",
    "evidenced",
    "failed",
    "advisory",
    "candidate",
    "accepted",
  ]);
  if (
    !allowedEventKinds.has(event.eventKind) ||
    !allowedPresentationStates.has(event.presentationState) ||
    !allowedEpistemicStates.has(event.epistemicState) ||
    ![
      "user_authored",
      "non_authoritative",
      "authoritative",
    ].includes(event.authorityState) ||
    !["user", "harness"].includes(event.actorKind) ||
    ![
      "operator",
      "semantic_router",
      "world_manager_service",
      "direct_role_runtime",
      "project_manager",
      "world_manager_reconciler",
      "world_manager_reconstructor",
    ].includes(event.actorRole) ||
    event.grantsAuthority !== false ||
    event.rawProviderPayloadIncluded !== false ||
    event.rawChainOfThoughtIncluded !== false
  ) {
    fail("world_manager_semantic_event_boundary_violation");
  }
  if (!Array.isArray(event.parentSemanticEventIds)) {
    fail("world_manager_semantic_event_parent_boundary");
  }
  if (
    (event.eventKind === "user_utterance_observed" &&
      (event.presentationState !== "received" ||
        event.epistemicState !== "observed" ||
        event.authorityState !== "user_authored" ||
        event.actorKind !== "user" ||
        event.actorRole !== "operator" ||
        event.parentSemanticEventIds.length)) ||
    (event.eventKind !== "user_utterance_observed" &&
      (event.actorKind !== "harness" ||
        !event.parentSemanticEventIds.length ||
        ([
          "project_constitution_admitted",
          "project_substrate_provisioned",
          "abstract_reasoning_object_admitted",
        ].includes(event.eventKind)
          ? event.authorityState !== "authoritative" ||
            event.actorRole !== "operator"
          : event.authorityState !== "non_authoritative")))
  ) {
    fail("world_manager_semantic_event_kind_boundary_violation");
  }
  if (!Array.isArray(event.artifactRefs)) fail("world_manager_semantic_event_refs_required");
  event.artifactRefs.forEach((ref, index) => validateRef(ref, `event.artifactRefs.${index}`));
  if (event.eventDigest !== semanticEventDigest(event)) {
    fail("world_manager_semantic_event_digest_mismatch");
  }
  return true;
}

function workThreadProjection(workThread = {}) {
  return {
    workThreadId: boundedString(workThread.workThreadId, "", 180),
    projectId: boundedString(workThread.projectId, "", 180),
    title: boundedString(workThread.title, "WorkThread", 180),
    lifecycleState: boundedString(workThread.lifecycleState, "unknown", 80),
    phase: boundedString(workThread.phaseState?.phaseKind, "unknown", 80),
    activeRuntimePath: boundedString(workThread.activeRuntimePath, "unknown", 80),
    digest: boundedString(workThread.digest, "", 180),
    sourcePosture: "work_thread_registry",
    rawPathIncluded: false,
  };
}

function buildWorldManagerWorkbenchProjection(input = {}) {
  const bootstrap = input.bootstrap;
  validateWorldManagerBootstrapManifest(bootstrap);
  const events = Array.isArray(input.events) ? input.events : [];
  const messages = Array.isArray(input.messages) ? input.messages : [];
  events.forEach(validateWorldManagerSemanticEvent);
  messages.forEach(validateWorldManagerMessage);
  const candidateArtifacts = Array.isArray(input.candidateArtifacts) ? input.candidateArtifacts : [];
  const planProposalRevisions = Array.isArray(input.planProposalRevisions)
    ? input.planProposalRevisions
    : [];
  const planAdmissions = Array.isArray(input.planAdmissions)
    ? input.planAdmissions
    : [];
  const implementationContracts = Array.isArray(input.implementationContracts)
    ? input.implementationContracts
    : [];
  const pendingDecisions = Array.isArray(input.pendingDecisions) ? input.pendingDecisions : [];
  const settlements = Array.isArray(input.settlements) ? input.settlements : [];
  const semanticIngressRuns = Array.isArray(
    input.semanticIngressRuns,
  )
    ? input.semanticIngressRuns
    : [];
  const semanticIngressAvailable =
    input.semanticIngressAvailable !== false;
  const semanticSettlementRevisions = Array.isArray(
    input.semanticSettlementRevisions,
  )
    ? input.semanticSettlementRevisions
    : [];
  const semanticHistoryRelationRecords = Array.isArray(
    input.semanticHistoryRelations,
  )
    ? input.semanticHistoryRelations
    : [];
  const semanticShelves = Array.isArray(
    input.semanticShelves,
  )
    ? input.semanticShelves
    : [];
  const semanticArtifacts = Array.isArray(
    input.semanticArtifacts,
  )
    ? input.semanticArtifacts
    : [];
  const aroReconstructionCandidates =
    Array.isArray(
      input.aroReconstructionCandidates,
    )
      ? input.aroReconstructionCandidates
      : [];
  const abstractReasoningObjects =
    Array.isArray(
      input.abstractReasoningObjects,
    )
      ? input.abstractReasoningObjects
      : [];
  const aroReviewReceipts = Array.isArray(
    input.aroReviewReceipts,
  )
    ? input.aroReviewReceipts
    : [];
  const aroAdmissionReceipts =
    Array.isArray(
      input.aroAdmissionReceipts,
    )
      ? input.aroAdmissionReceipts
      : [];
  const repositorySemanticSnapshots =
    Array.isArray(
      input.repositorySemanticSnapshots,
    )
      ? input.repositorySemanticSnapshots
      : [];
  const aroReconstructionRuns =
    Array.isArray(
      input.aroReconstructionRuns,
    )
      ? input.aroReconstructionRuns
      : [];
  const aroTargetDefinitionRuns =
    Array.isArray(
      input.aroTargetDefinitionRuns,
    )
      ? input.aroTargetDefinitionRuns
      : [];
  const aroMutationContracts =
    Array.isArray(
      input.aroMutationContracts,
    )
      ? input.aroMutationContracts
      : [];
  const aroMutationCompilationRuns =
    Array.isArray(
      input.aroMutationCompilationRuns,
    )
      ? input.aroMutationCompilationRuns
      : [];
  const aroRealizationContextImports =
    Array.isArray(
      input.aroRealizationContextImports,
    )
      ? input.aroRealizationContextImports
      : [];
  const aroRealizationMappingWitnesses =
    Array.isArray(
      input.aroRealizationMappingWitnesses,
    )
      ? input.aroRealizationMappingWitnesses
      : [];
  const aroRealizationMappingRuns =
    Array.isArray(
      input.aroRealizationMappingRuns,
    )
      ? input.aroRealizationMappingRuns
      : [];
  const aroWorkerSourceFreshness =
    Array.isArray(
      input.aroWorkerSourceFreshness,
    )
      ? input.aroWorkerSourceFreshness
      : [];
  const aroWorkerCapabilityObservations =
    Array.isArray(
      input.aroWorkerCapabilityObservations,
    )
      ? input.aroWorkerCapabilityObservations
      : [];
  const aroWorkerReviewReceipts =
    Array.isArray(
      input.aroWorkerReviewReceipts,
    )
      ? input.aroWorkerReviewReceipts
      : [];
  const aroWorkerConstitutions =
    Array.isArray(
      input.aroWorkerConstitutions,
    )
      ? input.aroWorkerConstitutions
      : [];
  const aroWorkerAuthorizations =
    Array.isArray(
      input.aroWorkerAuthorizations,
    )
      ? input.aroWorkerAuthorizations
      : [];
  const aroWorkerHandoffRuns =
    Array.isArray(
      input.aroWorkerHandoffRuns,
    )
      ? input.aroWorkerHandoffRuns
      : [];
  const aroExecutionEvidenceBundles =
    Array.isArray(
      input.aroExecutionEvidenceBundles,
    )
      ? input.aroExecutionEvidenceBundles
      : [];
  const aroExecutionEvidenceRuns =
    Array.isArray(
      input.aroExecutionEvidenceRuns,
    )
      ? input.aroExecutionEvidenceRuns
      : [];
  const aroSemanticVerificationAssessments =
    Array.isArray(
      input.aroSemanticVerificationAssessments,
    )
      ? input.aroSemanticVerificationAssessments
      : [];
  const aroClosureCandidates =
    Array.isArray(
      input.aroClosureCandidates,
    )
      ? input.aroClosureCandidates
      : [];
  const aroSemanticVerificationRuns =
    Array.isArray(
      input.aroSemanticVerificationRuns,
    )
      ? input.aroSemanticVerificationRuns
      : [];
  const thoughtBrushStrokes =
    Array.isArray(
      input.thoughtBrushStrokes,
    )
      ? input.thoughtBrushStrokes
      : [];
  const contextCanvases =
    Array.isArray(
      input.contextCanvases,
    )
      ? input.contextCanvases
      : [];
  thoughtBrushStrokes.forEach(
    validateThoughtBrushStroke,
  );
  contextCanvases.forEach(
    validateContextCanvas,
  );
  aroReconstructionCandidates.forEach(
    validateAroReconstructionCandidate,
  );
  abstractReasoningObjects.forEach(
    validateAbstractReasoningObject,
  );
  aroReviewReceipts.forEach(
    validateAroReviewReceipt,
  );
  aroAdmissionReceipts.forEach(
    validateAroAdmissionReceipt,
  );
  repositorySemanticSnapshots.forEach(
    validateRepositorySemanticSnapshot,
  );
  aroReconstructionRuns.forEach(
    validateAroReconstructionRun,
  );
  aroMutationContracts.forEach(
    validateAroMutationContract,
  );
  aroMutationCompilationRuns.forEach(
    validateAroMutationCompilationRun,
  );
  aroRealizationContextImports.forEach(
    validateAroRealizationContextImport,
  );
  aroRealizationMappingWitnesses.forEach(
    validateAroRealizationMappingWitness,
  );
  aroRealizationMappingRuns.forEach(
    validateAroRealizationMappingRun,
  );
  aroTargetDefinitionRuns.forEach(
    validateAroTargetDefinitionRun,
  );
  aroWorkerSourceFreshness.forEach(
    validateAroWorkerSourceFreshnessWitness,
  );
  aroWorkerCapabilityObservations.forEach(
    validateAroWorkerCapabilityObservation,
  );
  aroWorkerReviewReceipts.forEach(
    validateAroWorkerReviewReceipt,
  );
  aroWorkerConstitutions.forEach(
    validateAroWorkerConstitution,
  );
  aroWorkerAuthorizations.forEach(
    validateAroWorkerAuthorizationReceipt,
  );
  aroWorkerHandoffRuns.forEach(
    validateAroWorkerHandoffRun,
  );
  aroExecutionEvidenceBundles.forEach(
    validateAroExecutionEvidenceBundle,
  );
  aroExecutionEvidenceRuns.forEach(
    validateAroExecutionEvidenceRun,
  );
  aroSemanticVerificationAssessments.forEach(
    validateAroSemanticVerificationAssessment,
  );
  aroClosureCandidates.forEach(
    validateAroClosureCandidate,
  );
  aroSemanticVerificationRuns.forEach(
    validateAroSemanticVerificationRun,
  );
  const latestAroRunByProject =
    new Map();
  for (const run of aroReconstructionRuns) {
    if (
      !latestAroRunByProject.has(
        run.projectId,
      )
    ) {
      latestAroRunByProject.set(
        run.projectId,
        run,
      );
    }
  }
  const aroCurrentTargetComparisons = [];
  const aroByScope = new Map();
  for (const aro of abstractReasoningObjects) {
    const scopeKey =
      `${aro.projectId}\0${aro.conceptKey}`;
    const scoped =
      aroByScope.get(scopeKey) || {};
    scoped[aro.posture] = aro;
    aroByScope.set(scopeKey, scoped);
  }
  for (const scoped of aroByScope.values()) {
    if (scoped.current && scoped.target) {
      aroCurrentTargetComparisons.push(
        buildAroCurrentTargetComparison(
          scoped.current,
          scoped.target,
        ),
      );
    }
  }
  const decisionTransitions = Array.isArray(
    input.decisionTransitions,
  )
    ? input.decisionTransitions
    : [];
  const latestDecisionTransitionByDecisionId =
    new Map();
  for (const transition of decisionTransitions) {
    const decisionId =
      transition?.request?.decisionRef?.id || "";
    if (
      decisionId &&
      !latestDecisionTransitionByDecisionId.has(
        decisionId,
      )
    ) {
      latestDecisionTransitionByDecisionId.set(
        decisionId,
        transition,
      );
    }
  }
  const currentOpenDecisionArtifacts =
    semanticArtifacts.filter((artifact) =>
      artifact?.schema ===
        "direct_open_decision@1" &&
      artifact?.header?.artifactKind ===
        "open_decision" &&
      artifact?.currentState !== "superseded" &&
      ["open", "blocked", "conflicted"].includes(
        artifact.decisionState,
      ));
  const staleDecisionArtifacts =
    semanticArtifacts.filter((artifact) =>
      artifact?.schema ===
        "direct_open_decision@1" &&
      artifact?.header?.artifactKind ===
        "open_decision" &&
      artifact?.currentState !== "superseded" &&
      artifact.decisionState === "stale");
  const semanticChildContractRecords = Array.isArray(
    input.semanticChildContracts,
  )
    ? input.semanticChildContracts
    : [];
  const semanticSplitCoordinations = Array.isArray(
    input.semanticSplitCoordinations,
  )
    ? input.semanticSplitCoordinations
    : [];
  const routingDecisions = Array.isArray(input.routingDecisions)
    ? input.routingDecisions
    : [];
  const managerContexts = Array.isArray(input.managerContexts)
    ? input.managerContexts
    : [];
  const agentWorldCompilations = Array.isArray(
    input.agentWorldCompilations,
  )
    ? input.agentWorldCompilations
    : [];
  const operationalMetaContexts = Array.isArray(
    input.operationalMetaContexts,
  )
    ? input.operationalMetaContexts
    : [];
  const pipelineStage = input.pipelineStage === K6_GENESIS_STAGE
    ? K6_GENESIS_STAGE
    : input.pipelineStage === K5_PLANNING_STAGE
      ? K5_PLANNING_STAGE
    : input.pipelineStage === K4_STAGE
      ? K4_STAGE
      : K3_STAGE;
  const roleRuntimeStage = [K4_STAGE, K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(
    pipelineStage,
  );
  const roleRuns = Array.isArray(input.roleRuns) ? input.roleRuns : [];
  const agentResults = Array.isArray(input.agentResults)
    ? input.agentResults
    : [];
  const inboxEntries = Array.isArray(input.inboxEntries)
    ? input.inboxEntries
    : [];
  const reconciliations = Array.isArray(input.reconciliations)
    ? input.reconciliations
    : [];
  const projectConstitutions = Array.isArray(input.projectConstitutions)
    ? input.projectConstitutions
    : [];
  const projectRuntimeDefaults = Array.isArray(input.projectRuntimeDefaults)
    ? input.projectRuntimeDefaults
    : [];
  const projectWorkspaceBindings = Array.isArray(
    input.projectWorkspaceBindings,
  )
    ? input.projectWorkspaceBindings
    : [];
  const environmentProbeReceipts = Array.isArray(
    input.environmentProbeReceipts,
  )
    ? input.environmentProbeReceipts
    : [];
  const threadEnvironmentBindings = Array.isArray(
    input.threadEnvironmentBindings,
  )
    ? input.threadEnvironmentBindings
    : [];
  const stepEnvironmentSnapshots = Array.isArray(
    input.stepEnvironmentSnapshots,
  )
    ? input.stepEnvironmentSnapshots
    : [];
  const childEnvironmentInheritances = Array.isArray(
    input.childEnvironmentInheritances,
  )
    ? input.childEnvironmentInheritances
    : [];
  const workspaceBindingByProjectId = new Map(
    projectWorkspaceBindings.map((binding) => [binding.projectId, binding]),
  );
  const probeById = new Map(
    environmentProbeReceipts.map((receipt) => [receipt.probeReceiptId, receipt]),
  );
  const graphBinding = isPlainObject(input.graphBinding) ? input.graphBinding : null;
  if (
    ![K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(pipelineStage) &&
    candidateArtifacts.length
  ) {
    fail("world_manager_projection_k2_candidate_forbidden");
  }
  if (
    pendingDecisions.some((decision) =>
      !(
        decision.decisionKind === "clarification" ||
        ([K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(pipelineStage) &&
          [
            "project_constitution_admission",
            "plan_proposal_admission",
          ].includes(decision.decisionKind))
      ) ||
      !["pending", "clarification_required"].includes(decision.state))
  ) {
    fail("world_manager_projection_k2_decision_boundary");
  }
  const focusedProjectId = normalizeString(
    input.focusedProjectId,
    bootstrap.projects[0]?.projectId || "",
  );
  const configuredProjectIds = new Set(
    bootstrap.projects.map((project) =>
      project.projectId),
  );
  const workThreads = (Array.isArray(input.workThreads) ? input.workThreads : [])
    .map(workThreadProjection);
  const projects = bootstrap.projects.map((project, index) => {
    const activeCount = workThreads.filter((thread) =>
      thread.projectId === project.projectId &&
      ["active", "paused", "blocked"].includes(thread.lifecycleState)).length;
    const sourceCandidate = candidateArtifacts
      .filter((candidate) =>
        candidate.proposedProjectId ===
          project.projectId)
      .at(-1);
    const projectCandidates =
      sourceCandidate?.lifecycle === "candidate"
        ? [sourceCandidate]
        : [];
    const planCandidates = planProposalRevisions.filter((proposal) =>
      proposal.projectId === project.projectId &&
      ["candidate", "candidate_reconciled"].includes(proposal.state));
    const projectContracts = implementationContracts.filter((contract) =>
      contract.projectId === project.projectId);
    const constitution = projectConstitutions.find((entry) =>
      entry.projectId === project.projectId);
    const workspaceBinding = workspaceBindingByProjectId.get(
      project.projectId,
    ) || null;
    const environmentProbe = workspaceBinding
      ? probeById.get(workspaceBinding.probeRef?.id) || null
      : null;
    const latestAroReconstructionRun =
      latestAroRunByProject.get(
        project.projectId,
      ) || null;
    return {
      projectId: project.projectId,
      projectWorldId: project.projectWorldId,
      name: project.name,
      summary: project.summary,
      runtimePath: project.runtimePath,
      activityState: project.projectId === focusedProjectId
        ? "active"
        : index === 1
          ? "semi_active"
          : "inactive",
      posture: graphBinding?.projectRootNodeIds?.[project.projectId]
        ? "bound"
        : project.graphBindingState,
      graphBindingState: graphBinding?.projectRootNodeIds?.[project.projectId]
        ? "bound"
        : project.graphBindingState,
      activeWorkThreadCount: activeCount,
      candidateCount: projectCandidates.length + planCandidates.length,
      canonicalContractCount: projectContracts.length,
      constitutionState: constitution ? "canonical" : "not_admitted",
      primaryAgentEnvironmentId:
        constitution?.primaryAgentEnvironmentId || "",
      activationState:
        workspaceBinding
          ? "workspace_provisioned"
          : constitution?.activationState || "configured_legacy_project",
      workspaceProvisioningState:
        workspaceBinding ? "provisioned" : "not_provisioned",
      projectWorkspaceBindingRef: workspaceBinding
        ? {
            kind: "project_workspace_binding",
            id: workspaceBinding.workspaceBindingId,
            digest: workspaceBinding.digest,
            projectId: workspaceBinding.projectId,
          }
        : null,
      primaryEnvironmentReady:
        environmentProbe?.probeState === "ready",
      threadEnvironmentBindingCount:
        threadEnvironmentBindings.filter((binding) =>
          binding.projectId === project.projectId).length,
      stepEnvironmentSnapshotCount:
        stepEnvironmentSnapshots.filter((snapshot) =>
          snapshot.projectId === project.projectId).length,
      sourceKind: "configured_project",
      inspectionPosture: "runtime_project",
      focusEligible: true,
      candidateId:
        sourceCandidate?.candidateId || "",
      candidateLifecycle:
        sourceCandidate?.lifecycle || "",
      evidenceReviewState:
        sourceCandidate?.evidenceReviewState || "",
      reconciliationState:
        sourceCandidate?.reconciliationState || "",
      openDecisionCount:
        semanticArtifacts.length
          ? currentOpenDecisionArtifacts.filter((decision) =>
              decision.header?.scope?.projectId ===
                project.projectId).length
          : projectCandidates
              .flatMap((candidate) =>
                candidate.openDecisions || [])
              .length,
      aroCount:
        abstractReasoningObjects.filter((aro) =>
          aro.projectId === project.projectId).length,
      aroCandidateCount:
        aroReconstructionCandidates.filter((candidate) =>
          candidate.projectId === project.projectId &&
          candidate.lifecycle === "candidate").length,
      aroAttentionRequired:
        aroReconstructionCandidates.some((candidate) =>
          candidate.projectId === project.projectId &&
          candidate.lifecycle === "candidate") ||
        ["failed", "remanded"].includes(
          latestAroReconstructionRun?.state,
        ),
      aroReconstructionState:
        latestAroReconstructionRun?.state ||
        "not_scheduled",
      aroReconstructionRetryable:
        latestAroReconstructionRun
          ?.retryable === true,
      aroReconstructionRunRef:
        latestAroReconstructionRun
          ? {
              kind:
                "aro_reconstruction_run",
              id:
                latestAroReconstructionRun
                  .runId,
              digest:
                latestAroReconstructionRun
                  .digest,
              projectId:
                project.projectId,
            }
          : null,
      attentionRequired: pendingDecisions.some((decision) =>
        decision.targetArtifactRef?.projectId === project.projectId) ||
        aroReconstructionCandidates.some((candidate) =>
          candidate.projectId === project.projectId &&
          candidate.lifecycle === "candidate") ||
        ["failed", "remanded"].includes(
          latestAroReconstructionRun?.state,
        ),
      grantsAuthority: false,
    };
  });
  for (const constitution of projectConstitutions) {
    if (projects.some((project) =>
      project.projectId === constitution.projectId)) {
      continue;
    }
    const runtimeDefault = projectRuntimeDefaults.find((entry) =>
      entry.projectId === constitution.projectId);
    const workspaceBinding = workspaceBindingByProjectId.get(
      constitution.projectId,
    ) || null;
    const environmentProbe = workspaceBinding
      ? probeById.get(workspaceBinding.probeRef?.id) || null
      : null;
    const sourceCandidate = candidateArtifacts.find((candidate) =>
      candidate.proposedProjectId ===
        constitution.projectId);
    const latestAroReconstructionRun =
      latestAroRunByProject.get(
        constitution.projectId,
      ) || null;
    projects.push({
      projectId: constitution.projectId,
      projectWorldId: "",
      name: constitution.identity,
      summary: constitution.purpose,
      runtimePath: "direct",
      activityState: "inactive",
      posture: "canonical_constitution",
      graphBindingState: "awaiting_worldmodel_activation",
      activeWorkThreadCount: workThreads.filter((thread) =>
        thread.projectId === constitution.projectId &&
        ["active", "paused", "blocked"].includes(thread.lifecycleState)).length,
      candidateCount: 0,
      canonicalContractCount: 0,
      constitutionState: "canonical",
      primaryAgentEnvironmentId:
        constitution.primaryAgentEnvironmentId,
      activationState: workspaceBinding
        ? "workspace_provisioned"
        : constitution.activationState,
      workspaceProvisioningState:
        workspaceBinding ? "provisioned" : "not_provisioned",
      projectWorkspaceBindingRef: workspaceBinding
        ? {
            kind: "project_workspace_binding",
            id: workspaceBinding.workspaceBindingId,
            digest: workspaceBinding.digest,
            projectId: workspaceBinding.projectId,
          }
        : null,
      primaryEnvironmentReady:
        environmentProbe?.probeState === "ready",
      threadEnvironmentBindingCount:
        threadEnvironmentBindings.filter((binding) =>
          binding.projectId === constitution.projectId).length,
      stepEnvironmentSnapshotCount:
        stepEnvironmentSnapshots.filter((snapshot) =>
          snapshot.projectId === constitution.projectId).length,
      sourceKind: "canonical_project_constitution",
      inspectionPosture:
        constitution.activationState === "active"
          ? "runtime_project"
          : workspaceBinding
            ? "provisioned_constitution"
          : "semantic_constitution",
      focusEligible:
        constitution.activationState === "active" &&
        configuredProjectIds.has(
          constitution.projectId,
        ),
      candidateId:
        sourceCandidate?.candidateId || "",
      candidateLifecycle:
        sourceCandidate?.lifecycle || "admitted",
      evidenceReviewState:
        sourceCandidate?.evidenceReviewState || "reviewed",
      reconciliationState:
        sourceCandidate?.reconciliationState || "reconciled",
      openDecisionCount:
        semanticArtifacts.length
          ? currentOpenDecisionArtifacts.filter((decision) =>
              decision.header?.scope?.projectId ===
                constitution.projectId).length
          : sourceCandidate?.openDecisions?.length || 0,
      aroCount:
        abstractReasoningObjects.filter((aro) =>
          aro.projectId === constitution.projectId).length,
      aroCandidateCount:
        aroReconstructionCandidates.filter((candidate) =>
          candidate.projectId === constitution.projectId &&
          candidate.lifecycle === "candidate").length,
      aroAttentionRequired:
        aroReconstructionCandidates.some((candidate) =>
          candidate.projectId === constitution.projectId &&
          candidate.lifecycle === "candidate") ||
        ["failed", "remanded"].includes(
          latestAroReconstructionRun?.state,
        ),
      aroReconstructionState:
        latestAroReconstructionRun?.state ||
        "not_scheduled",
      aroReconstructionRetryable:
        latestAroReconstructionRun
          ?.retryable === true,
      aroReconstructionRunRef:
        latestAroReconstructionRun
          ? {
              kind:
                "aro_reconstruction_run",
              id:
                latestAroReconstructionRun
                  .runId,
              digest:
                latestAroReconstructionRun
                  .digest,
              projectId:
                constitution.projectId,
            }
          : null,
      runtimeDefaultBindingRef: runtimeDefault
        ? {
            kind: "project_runtime_default_binding",
            id: runtimeDefault.bindingId,
            digest: runtimeDefault.digest,
          }
        : null,
      attentionRequired:
        (!workspaceBinding && constitution.activationState !== "active") ||
        aroReconstructionCandidates.some((candidate) =>
          candidate.projectId === constitution.projectId &&
          candidate.lifecycle === "candidate") ||
        ["failed", "remanded"].includes(
          latestAroReconstructionRun?.state,
        ),
      grantsAuthority: false,
    });
  }
  for (const candidate of candidateArtifacts) {
    if (
      candidate?.schema !==
        "direct_project_constitution_candidate@1" ||
      projects.some((project) =>
        project.projectId ===
          candidate.proposedProjectId)
    ) {
      continue;
    }
    projects.push({
      projectId: candidate.proposedProjectId,
      projectWorldId: "",
      name: candidate.identity,
      summary:
        candidate.purpose ||
        candidate.semanticSummary,
      runtimePath: "not_activated",
      activityState: "inactive",
      posture:
        candidate.evidenceReviewState === "reviewed"
          ? "candidate_reviewed"
          : "candidate",
      graphBindingState: "not_admitted",
      activeWorkThreadCount: 0,
      candidateCount: 1,
      canonicalContractCount: 0,
      constitutionState: "not_admitted",
      primaryAgentEnvironmentId:
        candidate.primaryAgentEnvironmentId,
      activationState:
        candidate.activationState ||
        "not_admitted",
      sourceKind:
        "project_constitution_candidate",
      inspectionPosture: "semantic_candidate",
      focusEligible: false,
      candidateId: candidate.candidateId,
      candidateLifecycle:
        candidate.lifecycle,
      evidenceReviewState:
        candidate.evidenceReviewState,
      reconciliationState:
        candidate.reconciliationState,
      openDecisionCount:
        semanticArtifacts.length
          ? currentOpenDecisionArtifacts.filter((decision) =>
              decision.header?.scope?.projectId ===
                candidate.proposedProjectId).length
          : candidate.openDecisions?.length || 0,
      aroCount:
        abstractReasoningObjects.filter((aro) =>
          aro.projectId === candidate.proposedProjectId).length,
      aroCandidateCount:
        aroReconstructionCandidates.filter((aroCandidate) =>
          aroCandidate.projectId === candidate.proposedProjectId &&
          aroCandidate.lifecycle === "candidate").length,
      aroAttentionRequired:
        aroReconstructionCandidates.some((aroCandidate) =>
          aroCandidate.projectId === candidate.proposedProjectId &&
          aroCandidate.lifecycle === "candidate"),
      aroReconstructionState:
        latestAroRunByProject.get(
          candidate.proposedProjectId,
        )?.state ||
        "not_scheduled",
      aroReconstructionRetryable:
        latestAroRunByProject.get(
          candidate.proposedProjectId,
        )?.retryable === true,
      aroReconstructionRunRef:
        latestAroRunByProject.get(
          candidate.proposedProjectId,
        )
          ? {
              kind:
                "aro_reconstruction_run",
              id:
                latestAroRunByProject.get(
                  candidate.proposedProjectId,
                ).runId,
              digest:
                latestAroRunByProject.get(
                  candidate.proposedProjectId,
                ).digest,
              projectId:
                candidate.proposedProjectId,
            }
          : null,
      attentionRequired:
        candidate.evidenceReviewState !== "reviewed" ||
        candidate.reconciliationState !== "reconciled" ||
        aroReconstructionCandidates.some((aroCandidate) =>
          aroCandidate.projectId === candidate.proposedProjectId &&
          aroCandidate.lifecycle === "candidate"),
      canonical: false,
      grantsAuthority: false,
    });
  }
  const userIngressEvents = events.filter((event) =>
    event.eventKind === "user_utterance_observed");
  const eventById = new Map(
    events.map((event) => [
      event.semanticEventId,
      event,
    ]),
  );
  const settlementByEventId = new Map(
    settlements.map((settlement) => [settlement.semanticEventId, settlement]),
  );
  const routingDecisionByEventId = new Map(
    routingDecisions.map((decision) => [
      decision.semanticEventId,
      decision,
    ]),
  );
  const semanticIngressByEventId = new Map(
    semanticIngressRuns.map((run) => [
      run.semanticEventId,
      run,
    ]),
  );
  const messageByEventId = new Map(
    messages.map((message) => [
      message.semanticEventId,
      message,
    ]),
  );
  const semanticChildContractByEventId = new Map(
    semanticChildContractRecords.map((record) => [
      record.contract?.childSemanticEventId,
      record,
    ]),
  );
  const contextByEventId = new Map(
    managerContexts.map((context) => [context.semanticEventId, context]),
  );
  const agentWorldByEventId = new Map(
    agentWorldCompilations.map((compilation) => [
      compilation.semanticEventId,
      compilation,
    ]),
  );
  const operationalMetaContextByEventId = new Map();
  for (const context of operationalMetaContexts) {
    operationalMetaContextByEventId.set(
      context.semanticEventId,
      context,
    );
  }
  const reconciliationResultIds = new Set(
    reconciliations
      .map((record) => record.reconciliationAgentResultRef?.id)
      .filter(Boolean),
  );
  const managerResultByEventId = new Map(
    agentResults
      .filter((record) =>
        !reconciliationResultIds.has(
          record.agentResult?.agentResultId,
        ))
      .map((record) => [
        record.agentResult.sourceSemanticEventId,
        record,
      ]),
  );
  const reconciliationByEventId = new Map(
    reconciliations.map((record) => [
      record.sourceSemanticEventId,
      record,
    ]),
  );
  const roleRunByEventId = new Map();
  for (const run of roleRuns) {
    roleRunByEventId.set(run.sourceSemanticEventId, run);
  }
  const splitCoordinationByParentEventId = new Map(
    semanticSplitCoordinations.map((coordination) => [
      coordination.parentEventRef?.id,
      coordination,
    ]),
  );
  const splitOutcomeByChildEventId = new Map(
    semanticSplitCoordinations.flatMap((coordination) =>
      coordination.childOutcomes.map((outcome) => [
        outcome.childEventRef.id,
        outcome,
      ])),
  );
  const unsettledIngressCount = userIngressEvents.filter((event) =>
    !settlementByEventId.has(event.semanticEventId)).length;
  const latestIngressEventId =
    userIngressEvents.at(-1)?.semanticEventId || "";
  const latestSettlement =
    settlementByEventId.get(latestIngressEventId) ||
    null;
  const latestSemanticIngress =
    semanticIngressByEventId.get(latestIngressEventId) ||
    null;
  const latestRoutingDecision =
    routingDecisionByEventId.get(latestIngressEventId) ||
    null;
  const latestSplitCoordination =
    splitCoordinationByParentEventId.get(
      latestIngressEventId,
    ) || null;
  const clarificationCount = latestSettlement &&
    ["clarification_required", "remanded"].includes(latestSettlement.state)
    ? 1
    : 0;
  const preparedContextCount = managerContexts.length;
  const compiledAgentWorldCount = agentWorldCompilations.length;
  const latestManagerResult =
    managerResultByEventId.get(latestIngressEventId) || null;
  const latestReconciliation =
    reconciliationByEventId.get(latestIngressEventId) || null;
  const latestRoleRun =
    roleRunByEventId.get(latestIngressEventId) || null;
  const latestAgentWorldCompilation =
    agentWorldByEventId.get(latestIngressEventId) ||
    null;
  const latestOperationalMetaContext =
    operationalMetaContextByEventId.get(
      latestIngressEventId,
    ) || null;
  const selfContainedWorldManagerResponse = Boolean(
    latestManagerResult?.agentResult?.roleKind ===
      "world_manager" &&
    !latestReconciliation,
  );
  const selfContainedWorldManagerResponseCompleted =
    selfContainedWorldManagerResponse &&
    latestManagerResult?.agentResult?.resultState === "completed";
  const k4Running = roleRuntimeStage &&
    ["starting", "running"].includes(latestRoleRun?.state);
  const splitRunning = [
    "executing",
    "joining",
  ].includes(latestSplitCoordination?.state);
  const splitAttentionRequired = [
    "partially_remanded",
    "remanded",
    "failed",
    "interrupted",
  ].includes(latestSplitCoordination?.state);
  const latestAroBackgroundRun =
    aroReconstructionRuns[0] || null;
  const aroReconstructionRunning =
    ["scheduled", "running"].includes(
      latestAroBackgroundRun?.state,
    );
  const latestGenesisCandidateBeforeProjection =
    candidateArtifacts
      .filter((candidate) =>
        candidate?.schema ===
          "direct_project_constitution_candidate@1")
      .at(-1) || null;
  const latestGenesisWorkspaceBindingBeforeProjection =
    latestGenesisCandidateBeforeProjection
      ? workspaceBindingByProjectId.get(
          latestGenesisCandidateBeforeProjection.proposedProjectId,
        ) || null
      : null;
  const latestPlanProposalBeforeProjection =
    planProposalRevisions.at(-1) || null;
  const latestPlanContractBeforeProjection =
    implementationContracts.at(-1) || null;
  const latestPlanOwnsCurrentPosture =
    !latestManagerResult ||
    latestPlanProposalBeforeProjection?.sourceSemanticEventRef?.id ===
      latestManagerResult.agentResult?.sourceSemanticEventId;
  const planPostureVisible =
    latestPlanOwnsCurrentPosture &&
    latestRoleRun?.state !== "interrupted" &&
    !["interrupted", "failed", "remanded"].includes(
      latestReconciliation?.state,
    );
  const lifecycleState = clarificationCount
    ? "clarification_required"
    : latestSplitCoordination?.state ===
        "partially_remanded"
      ? "attention_required"
    : ["failed", "remanded", "interrupted"].includes(
        latestSplitCoordination?.state,
      )
      ? "failed"
    : splitRunning
      ? latestSplitCoordination.state === "joining"
        ? "reconciling"
        : "role_running"
    : aroReconstructionRunning
      ? "role_running"
    : pipelineStage === K6_GENESIS_STAGE &&
        latestGenesisCandidateBeforeProjection?.lifecycle ===
          "admitted"
      ? latestGenesisWorkspaceBindingBeforeProjection
        ? "project_substrate_provisioned"
        : "constitution_admitted"
    : pipelineStage === K6_GENESIS_STAGE &&
        latestGenesisCandidateBeforeProjection?.lifecycle ===
          "candidate"
      ? latestGenesisCandidateBeforeProjection
          .evidenceReviewState === "reviewed"
        ? "candidate_reviewed"
        : "candidate_ready"
    : pipelineStage === K5_PLANNING_STAGE &&
        latestPlanContractBeforeProjection &&
        planPostureVisible
      ? "contract_received"
    : pipelineStage === K5_PLANNING_STAGE &&
        latestPlanProposalBeforeProjection &&
        planPostureVisible
      ? latestPlanProposalBeforeProjection.evidenceReviewState === "reviewed"
        ? "candidate_reviewed"
        : "candidate_ready"
    : roleRuntimeStage &&
        (latestRoleRun?.state === "interrupted" ||
          ["interrupted", "failed", "remanded"].includes(
            latestReconciliation?.state,
          ))
      ? "failed"
    : k4Running
      ? latestRoleRun.roleKind === "world_manager"
        ? "reconciling"
        : "role_running"
    : roleRuntimeStage &&
        latestReconciliation?.state === "reconciled"
      ? "reconciled"
    : roleRuntimeStage &&
        latestReconciliation?.state === "processing"
      ? "reconciling"
    : roleRuntimeStage &&
        ["failed", "remanded"].includes(
          latestManagerResult?.agentResult?.resultState,
        )
      ? "failed"
    : roleRuntimeStage && latestManagerResult
      ? "replied"
    : unsettledIngressCount
      ? "settling"
      : compiledAgentWorldCount
        ? "agent_world_ready"
        : preparedContextCount
          ? "context_ready"
        : "idle";
  const lifecycleLabel = clarificationCount
    ? `${clarificationCount} request${clarificationCount === 1 ? " needs" : "s need"} semantic clarification`
    : splitAttentionRequired
      ? latestSplitCoordination.summary ||
        "Compound semantic coordination needs attention"
    : splitRunning
      ? latestSplitCoordination.summary ||
        "WorldManager is coordinating semantic child events"
    : aroReconstructionRunning
      ? "Repository semantic anatomy is being reconstructed in the background"
    : pipelineStage === K6_GENESIS_STAGE &&
        latestGenesisCandidateBeforeProjection?.lifecycle ===
          "admitted"
      ? latestGenesisWorkspaceBindingBeforeProjection
        ? "Project substrate provisioned · native environment ready"
        : "Project constitution admitted · workspace provisioning pending"
    : pipelineStage === K6_GENESIS_STAGE &&
        latestGenesisCandidateBeforeProjection?.lifecycle ===
          "candidate"
      ? latestGenesisCandidateBeforeProjection
          .evidenceReviewState === "reviewed"
        ? "Project constitution evidence reviewed · admission available"
        : "Project constitution candidate ready · evidence review required"
    : pipelineStage === K5_PLANNING_STAGE &&
        latestPlanContractBeforeProjection &&
        planPostureVisible
      ? "Plan admitted · implementation contract received · worker start pending"
    : pipelineStage === K5_PLANNING_STAGE &&
        latestPlanProposalBeforeProjection &&
        planPostureVisible
      ? latestPlanProposalBeforeProjection.evidenceReviewState === "reviewed"
        ? "Plan evidence reviewed · exact admission available"
        : "Plan proposal ready · evidence review required"
    : roleRuntimeStage &&
        (latestRoleRun?.state === "interrupted" ||
          ["interrupted", "failed", "remanded"].includes(
            latestReconciliation?.state,
          ))
      ? latestReconciliation?.state === "interrupted" ||
          latestRoleRun?.state === "interrupted"
        ? "A persisted Direct role turn was interrupted by runtime restart"
        : "WorldManager reconciliation failed visibly"
    : k4Running
      ? latestRoleRun.roleKind === "world_manager"
        ? "WorldManager is reconciling the manager result"
        : "Project Manager is formulating a bounded response"
    : roleRuntimeStage &&
        latestReconciliation?.state === "reconciled"
      ? "Manager response rendered · WorldManager reconciliation complete"
    : roleRuntimeStage &&
        latestReconciliation?.state === "processing"
      ? "Manager response rendered · WorldManager reconciliation active"
    : roleRuntimeStage && latestManagerResult
      ? latestManagerResult.userFacingResponse?.provenanceLabel ||
        "Manager role turn completed"
    : unsettledIngressCount
      ? `${unsettledIngressCount} message${unsettledIngressCount === 1 ? "" : "s"} awaiting settlement`
      : compiledAgentWorldCount
        ? `${compiledAgentWorldCount} agent world${compiledAgentWorldCount === 1 ? "" : "s"} validated · role execution remains stopped`
        : preparedContextCount
          ? `${preparedContextCount} manager context${preparedContextCount === 1 ? "" : "s"} prepared · agent compilation pending`
        : "WorldManager settlement plane ready for keyboard ingress";
  const projectedMessages = messages.flatMap((message) => {
    const resultRecord = managerResultByEventId.get(
      message.semanticEventId,
    );
    const reconciliation = reconciliationByEventId.get(
      message.semanticEventId,
    );
    const roleRun = roleRunByEventId.get(message.semanticEventId);
    const settlement = settlementByEventId.get(message.semanticEventId);
    const splitCoordination =
      splitCoordinationByParentEventId.get(
        message.semanticEventId,
      ) || null;
    const settledProjectId = settlement
      ? settlement.projectId
      : message.projectId;
    const userMessage = {
      messageId: message.messageId,
      semanticEventId: message.semanticEventId,
      clientRequestId: message.clientRequestId,
      authorKind: message.authorKind,
      authorRole: message.authorRole,
      projectId: settledProjectId,
      text: message.text,
      state: message.presentationState,
      provenanceLabel: "You",
      createdAt: message.createdAt,
      messageDigest: message.messageDigest,
      lineageState:
        splitCoordination &&
        [
          "partially_remanded",
          "remanded",
          "failed",
          "interrupted",
        ].includes(splitCoordination.state)
          ? splitCoordination.state
        : resultRecord
        ? reconciliation?.state === "reconciled"
          ? "reconciled"
          : resultRecord.agentResult.resultState
        : roleRun && ["starting", "running"].includes(roleRun.state)
          ? "role_running"
          : roleRun?.state === "interrupted"
            ? "interrupted"
          : splitCoordination
            ? splitCoordination.state ===
                "materialized"
              ? "split_materialized"
              : splitCoordination.state ===
                  "executing"
                ? "split_executing"
                : splitCoordination.state ===
                    "joining"
                  ? "split_joining"
                  : splitCoordination.state
          : contextByEventId.has(message.semanticEventId)
            ? agentWorldByEventId.has(message.semanticEventId)
              ? "agent_world_ready"
              : "context_ready"
            : settlementByEventId.get(message.semanticEventId)?.state ||
              "awaiting_settlement",
    };
    if (!resultRecord) {
      const terminalSettlement = settlement &&
        [
          "clarification_required",
          "remanded",
        ].includes(settlement.state);
      if (!splitCoordination && !terminalSettlement) {
        return [userMessage];
      }
      const noticeText = splitCoordination
        ? splitCoordination.summary ||
          `WorldManager semantic coordination is ${splitCoordination.state.replace(/_/g, " ")}.`
        : settlement.clarificationPrompt ||
          "WorldManager stopped at a visible semantic boundary.";
      const noticeRef = splitCoordination
        ? {
            kind: "semantic_split_coordination",
            id: splitCoordination.coordinationId,
            digest: splitCoordination.digest,
          }
        : {
            kind: "world_manager_task_settlement",
            id: settlement.taskSettlementId,
            digest: settlement.digest,
          };
      const noticeDigest = digestFor(
        "direct_world_manager_harness_notice@1",
        {
          sourceSemanticEventId:
            message.semanticEventId,
          noticeRef,
          noticeText,
        },
      );
      return [
        userMessage,
        {
          messageId: stableId(
            "wm_harness_notice",
            {
              sourceSemanticEventId:
                message.semanticEventId,
              noticeDigest,
            },
          ),
          semanticEventId:
            message.semanticEventId,
          sourceSemanticEventId:
            message.semanticEventId,
          clientRequestId:
            message.clientRequestId,
          authorKind: "harness",
          authorRole: splitCoordination
            ? "world_manager_service"
            : "semantic_router",
          projectId: settledProjectId,
          text: noticeText,
          state: splitCoordination?.state ||
            settlement.state,
          provenanceLabel: splitCoordination
            ? "WorldManager coordination"
            : "WorldManager routing",
          createdAt:
            splitCoordination?.updatedAt ||
            settlement.createdAt ||
            message.createdAt,
          messageDigest: noticeDigest,
          noticeRef,
          lineageState:
            splitCoordination?.state ||
            settlement.state,
          canonical: false,
          grantsAuthority: false,
        },
      ];
    }
    const result = resultRecord.agentResult;
    const response = resultRecord.userFacingResponse;
    const agentMessage = {
      messageId: response.userFacingResponseId,
      semanticEventId: result.semanticEventId,
      sourceSemanticEventId: message.semanticEventId,
      clientRequestId: message.clientRequestId,
      authorKind: "agent",
      authorRole: result.roleKind,
      projectId: settledProjectId,
      text: response.text,
      state: response.presentationState,
      provenanceLabel: response.provenanceLabel,
      createdAt: resultRecord.telemetry?.completedAt ||
        message.createdAt,
      messageDigest: response.digest,
      agentResultRef: {
        kind: "agent_result",
        id: result.agentResultId,
        digest: result.digest,
      },
      lineageState:
        splitCoordination &&
        [
          "partially_remanded",
          "remanded",
          "failed",
          "interrupted",
        ].includes(splitCoordination.state)
          ? splitCoordination.state
        : reconciliation?.state === "reconciled"
          ? "reconciled"
          : reconciliation?.state === "processing"
            ? "worldmanager_reconciling"
            : result.resultState,
      canonical: false,
    };
    if (
      !splitCoordination ||
      splitCoordination.state === "completed"
    ) {
      return [userMessage, agentMessage];
    }
    const incompleteChildCount =
      splitCoordination.childOutcomes.filter((outcome) =>
        outcome.state !== "completed").length;
    const noticeText =
      `A unified response was produced, but ${incompleteChildCount} of ` +
      `${splitCoordination.childOutcomes.length} semantic child${
        splitCoordination.childOutcomes.length === 1 ? "" : "ren"
      } did not complete. Inspect child outcomes before treating this compound turn as closed.`;
    const noticeRef = {
      kind: "semantic_split_coordination",
      id: splitCoordination.coordinationId,
      digest: splitCoordination.digest,
    };
    const noticeDigest = digestFor(
      "direct_world_manager_harness_notice@1",
      {
        sourceSemanticEventId:
          message.semanticEventId,
        noticeRef,
        noticeText,
      },
    );
    return [
      userMessage,
      agentMessage,
      {
        messageId: stableId(
          "wm_harness_notice",
          {
            sourceSemanticEventId:
              message.semanticEventId,
            noticeDigest,
          },
        ),
        semanticEventId: message.semanticEventId,
        sourceSemanticEventId:
          message.semanticEventId,
        clientRequestId: message.clientRequestId,
        authorKind: "harness",
        authorRole: "world_manager_service",
        projectId: settledProjectId,
        text: noticeText,
        state: splitCoordination.state,
        provenanceLabel: "WorldManager coordination",
        createdAt:
          splitCoordination.updatedAt ||
          resultRecord.telemetry?.completedAt ||
          message.createdAt,
        messageDigest: noticeDigest,
        noticeRef,
        lineageState: splitCoordination.state,
        canonical: false,
        grantsAuthority: false,
      },
    ];
  });
  const semanticLineage = events.slice(-100).map((event) => ({
    semanticEventId: event.semanticEventId,
    lineageRootId: event.lineageRootId,
    eventKind: event.eventKind,
    presentationState: event.presentationState,
    epistemicState: event.epistemicState,
    authorityState: event.authorityState,
    actorRole: event.actorRole,
    projectId: event.projectId,
    parentSemanticEventIds: event.parentSemanticEventIds,
    artifactRefs: event.artifactRefs,
    rendererSafeSummary: event.rendererSafeSummary,
    occurredAt: event.occurredAt,
    eventDigest: event.eventDigest,
  }));
  const projectGenesisCandidates = candidateArtifacts.filter((candidate) =>
    candidate?.schema === "direct_project_constitution_candidate@1");
  const latestProjectGenesisCandidate =
    projectGenesisCandidates.at(-1) || null;
  const latestPlanProposal = planProposalRevisions.at(-1) || null;
  const latestImplementationContract =
    implementationContracts.at(-1) || null;
  const latestPlanAdmission = latestPlanProposal
    ? planAdmissions.find((record) =>
        record.request?.proposalRevisionRef?.id ===
          latestPlanProposal.proposalRevisionId) || null
    : null;
  const latestContractWorkThread = latestImplementationContract
    ? workThreads.find((thread) =>
        thread.workThreadId === latestImplementationContract.workThreadId) || null
    : null;
  const latestProjectConstitution =
    latestProjectGenesisCandidate
      ? projectConstitutions.find((constitution) =>
          constitution.projectId ===
            latestProjectGenesisCandidate.proposedProjectId) ||
        projectConstitutions.at(-1) ||
        null
      : projectConstitutions.at(-1) || null;
  const latestWorkspaceBinding = latestProjectConstitution
    ? workspaceBindingByProjectId.get(
        latestProjectConstitution.projectId,
      ) || null
    : projectWorkspaceBindings.at(-1) || null;
  const candidateBySourceEventId = new Map(
    projectGenesisCandidates.map((candidate) => [
      candidate.sourceSemanticEventRef?.id,
      candidate,
    ]),
  );
  const projectSeedProjections =
    semanticChildContractRecords.flatMap((record) => {
      const contract = record.contract;
      const childEventId =
        contract?.childSemanticEventId || "";
      const settlement =
        settlementByEventId.get(childEventId);
      if (
        settlement?.taskType !==
          "project_initialization" ||
        candidateBySourceEventId.has(childEventId)
      ) {
        return [];
      }
      const resultRecord =
        managerResultByEventId.get(childEventId);
      const typedPayload =
        resultRecord?.typedPayload;
      const project = isPlainObject(
        typedPayload?.projectConstitution,
      )
        ? typedPayload.projectConstitution
        : {};
      const outcome =
        splitOutcomeByChildEventId.get(childEventId);
      const parentMessage =
        messageByEventId.get(
          contract.parentEventRef?.id,
        );
      const identity = boundedString(
        project.name,
        contract.semanticTypeExpression
          ?.proposedLabel ||
          "Unregistered project seed",
        180,
      );
      const semanticPrompt = boundedString(
        contract.semanticPrompt,
        identity,
        2_000,
      );
      return [{
        projectSeedId: stableId(
          "wm_project_seed_projection",
          {
            childEventId,
            childContractId:
              contract.childContractId,
          },
        ),
        childEventRef: {
          kind:
            "world_manager_semantic_event",
          id: childEventId,
          digest:
            outcome?.childEventRef?.digest ||
            eventById.get(childEventId)
              ?.eventDigest ||
            contract.digest,
        },
        parentEventRef:
          contract.parentEventRef,
        childContractRef: {
          kind: "semantic_child_contract",
          id: contract.childContractId,
          digest: contract.digest,
        },
        identity,
        summary: boundedString(
          project.summary ||
            typedPayload?.semanticSummary,
          semanticPrompt,
          640,
        ),
        semanticPrompt,
        originalUtteranceSummary:
          boundedString(
            parentMessage?.text,
            "",
            640,
          ),
        state:
          outcome?.state ||
          resultRecord?.agentResult
            ?.resultState ||
          settlement.state,
        openDecisions: Array.isArray(
          typedPayload?.openDecisions,
        )
          ? typedPayload.openDecisions
              .map((decision) =>
                boundedString(
                  typeof decision === "string"
                    ? decision
                    : decision?.summary ||
                      decision?.question,
                  "",
                  480,
                ))
              .filter(Boolean)
          : [],
        recoveryPosture:
          resultRecord?.agentResult
            ?.resultState === "remanded"
            ? "retry_available"
            : "inspection_only",
        retryPrompt:
          `Reconsider this preserved semantic project seed as a project-genesis request:\n\n${semanticPrompt}\n\n` +
          "Formulate a non-canonical project constitution candidate under the current project-genesis semantic contract. Preserve the seed's meaning; do not create a workspace or grant execution authority.",
        canonical: false,
        countedAsProject: false,
        grantsAuthority: false,
      }];
    });
  const semanticArtifactKernelAvailable =
    input.semanticArtifactKernelAvailable === true;
  const decisionTransitionProjection = (
    transition,
  ) => {
    const request = transition?.request || {};
    const receipt = transition?.receipt || {};
    return {
      schema:
        "direct_decision_transition_projection@1",
      decisionTransitionRequestId:
        request.decisionTransitionRequestId || "",
      decisionId: request.decisionRef?.id || "",
      projectId:
        request.decisionRef?.projectId || "",
      transitionKind:
        request.transitionKind || "",
      state: receipt.state || "failed",
      receiptRevision:
        Number(receipt.receiptRevision || 0),
      summary: boundedString(
        receipt.summary,
        "Decision transition state recorded.",
        1200,
      ),
      selectedOptionLabel:
        request.optionRef?.label || "",
      relayState:
        receipt.relayState || "",
      errorCode:
        receipt.errorCode || "",
      receiptRef: receipt.digest
        ? {
            kind:
              "decision_transition_receipt",
            id:
              receipt
                .decisionTransitionReceiptId,
            digest: receipt.digest,
          }
        : null,
      relayEventRef:
        receipt.relayEventRef || null,
      canonicalDecisionMutation:
        receipt.canonicalDecisionMutation ===
          true,
      downstreamEffectsExecuted: false,
      executionAuthorityGranted: false,
      grantsAuthority: false,
      createdAt: receipt.createdAt || "",
    };
  };
  const semanticDecisionProjection = (decision) => {
    const projectId =
      decision.header?.scope?.projectId || "";
    const project = projects.find((entry) =>
      entry.projectId === projectId);
    const sourceCandidate =
      projectGenesisCandidates.find((candidate) =>
        candidate.proposedProjectId === projectId);
    const provenanceRefs =
      (decision.header?.provenanceRefs || [])
        .map((ref) => ({
          kind: ref.kind,
          id: ref.id,
          digest: ref.digest,
          ...(ref.projectId
            ? { projectId: ref.projectId }
            : {}),
        }));
    const directSourceEventRef =
      provenanceRefs.find((ref) =>
        ref.kind ===
          "world_manager_semantic_event");
    const provenanceCandidateRef =
      provenanceRefs.find((ref) =>
        ref.kind ===
          "project_constitution_candidate");
    const provenanceCandidate =
      provenanceCandidateRef
        ? projectGenesisCandidates.find(
            (candidate) =>
              candidate.candidateId ===
                provenanceCandidateRef.id,
          )
        : null;
    const shelf = semanticShelves.find((entry) =>
      entry.shelfKind ===
        "project_open_decisions" &&
      entry.anchorRefs?.some((ref) =>
        ref.kind === "project" &&
        ref.id === projectId) &&
      entry.semanticObjectRefs?.some((ref) =>
        ref.kind === "open_decision" &&
        ref.id === decision.decisionId));
    const latestTransition =
      latestDecisionTransitionByDecisionId.get(
        decision.decisionId,
      );
    return {
      schema:
        "direct_open_decision_projection@1",
      decisionId: decision.decisionId,
      artifactRef: {
        kind: "open_decision",
        id: decision.decisionId,
        digest: decision.digest,
      },
      semanticIdentity:
        decision.header.semanticIdentity,
      decisionKind: decision.decisionKind,
      projectId,
      projectName:
        project?.name ||
        sourceCandidate?.identity ||
        "",
      candidateId:
        sourceCandidate?.candidateId || "",
      text: boundedString(
        decision.question,
        "Open semantic decision",
        1200,
      ),
      description: boundedString(
        decision.description,
        "",
        2400,
      ),
      state: decision.decisionState,
      lifecycle: decision.header.lifecycle,
      revision: decision.header.revision,
      epistemicPosture:
        decision.header.epistemicPosture,
      resolutionMode:
        decision.resolutionMode,
      options: (decision.options || []).map((option) => ({
        optionId: option.optionId,
        optionKey: option.optionKey,
        optionRef: {
          kind: "decision_option",
          id: option.optionId,
          digest: option.digest,
        },
        label: boundedString(
          option.label,
          option.optionKey,
          180,
        ),
        description: boundedString(
          option.description,
          "",
          800,
        ),
        availability: option.availability,
        effectSummary: boundedString(
          option.effectSummary,
          "",
          800,
        ),
        grantsAuthority: false,
      })),
      dependencies:
        (decision.dependencies || []).map((dependency) => ({
          dependencyId:
            dependency.dependencyId,
          dependencyKind:
            dependency.dependencyKind,
          requirement: boundedString(
            dependency.requirement,
            "",
            800,
          ),
          state: dependency.state,
          blocking: dependency.blocking,
          grantsAuthority: false,
        })),
      consequences:
        (decision.consequences || []).map((consequence) => ({
          consequenceId:
            consequence.consequenceId,
          effectClass:
            consequence.effectClass,
          description: boundedString(
            consequence.description,
            "",
            800,
          ),
          posture: consequence.posture,
          grantsAuthority: false,
        })),
      resolutionContract: {
        schema:
          decision.resolutionContract.schema,
        resolutionContractId:
          decision.resolutionContract
            .resolutionContractId,
        mode:
          decision.resolutionContract.mode,
        inputShape:
          decision.resolutionContract.inputShape,
        expectedRevisionRequired:
          decision.resolutionContract
            .expectedRevisionRequired,
        idempotencyRequired:
          decision.resolutionContract
            .idempotencyRequired,
        transitionAvailability:
          decision.resolutionContract
            .transitionAvailability,
        executionAuthorityGranted: false,
        grantsAuthority: false,
      },
      shelfRef: shelf
        ? {
            kind: "semantic_shelf",
            id: shelf.shelfId,
            digest: shelf.digest,
          }
        : null,
      provenanceRefs,
      sourceSemanticEventId:
        directSourceEventRef?.id ||
        provenanceCandidate
          ?.sourceSemanticEventRef?.id ||
        sourceCandidate
          ?.sourceSemanticEventRef?.id ||
        "",
      sourceKind: decision.sourceKind,
      latestTransition: latestTransition
        ? decisionTransitionProjection(
            latestTransition,
          )
        : null,
      operationalBridge:
        decision.sourceKind ===
          "legacy_wm_decision",
      canonical: true,
      grantsAuthority: false,
    };
  };
  const typedOpenDecisions =
    semanticArtifactKernelAvailable
      ? currentOpenDecisionArtifacts.map(
          semanticDecisionProjection,
        )
      : [];
  const typedStaleDecisions =
    semanticArtifactKernelAvailable
      ? staleDecisionArtifacts.map(
          semanticDecisionProjection,
        )
      : [];
  const fallbackCandidateOpenDecisions =
    projectGenesisCandidates.flatMap((candidate) =>
      (candidate.openDecisions || []).map(
        (decision, index) => ({
          decisionId: stableId(
            "wm_project_open_decision",
            {
              candidateId:
                candidate.candidateId,
              index,
              decision,
            },
          ),
          decisionKind:
            "project_constitution_open_decision",
          projectId:
            candidate.proposedProjectId,
          projectName: candidate.identity,
          candidateId: candidate.candidateId,
          text: boundedString(
            typeof decision === "string"
              ? decision
              : decision?.summary ||
                decision?.question,
            "Open project decision",
            480,
          ),
          state: "open",
          lifecycle: candidate.lifecycle,
          canonical: false,
          grantsAuthority: false,
        }),
      ));
  const fallbackCurrentClarifications =
    latestSettlement &&
    ["clarification_required", "remanded"].includes(
      latestSettlement.state,
    )
      ? [{
          decisionId: stableId(
            "wm_current_clarification",
            {
              semanticEventId:
                latestSettlement.semanticEventId,
              prompt:
                latestSettlement
                  .clarificationPrompt,
            },
          ),
          decisionKind: "clarification",
          projectId:
            latestSettlement.projectId || "",
          projectName: "",
          text: boundedString(
            latestSettlement
              .clarificationPrompt,
            "WorldManager needs clarification.",
            480,
          ),
          state: latestSettlement.state,
          lifecycle: "current",
          canonical: false,
          grantsAuthority: false,
        }]
      : [];
  const candidateOpenDecisions =
    semanticArtifactKernelAvailable
      ? typedOpenDecisions.filter((decision) =>
          decision.sourceKind ===
            "manager_open_decision")
      : fallbackCandidateOpenDecisions;
  const currentClarifications =
    semanticArtifactKernelAvailable
      ? typedOpenDecisions.filter((decision) =>
          decision.decisionKind === "clarification")
      : fallbackCurrentClarifications;
  const operationalGateDecisions =
    semanticArtifactKernelAvailable
      ? typedOpenDecisions.filter((decision) =>
          decision.operationalBridge &&
          decision.decisionKind !==
            "clarification")
      : [];
  const historicalRemands =
    userIngressEvents.flatMap((event) => {
      if (
        event.semanticEventId ===
        latestIngressEventId
      ) {
        return [];
      }
      const settlement =
        settlementByEventId.get(
          event.semanticEventId,
        );
      const result =
        managerResultByEventId.get(
          event.semanticEventId,
        );
      const split =
        splitCoordinationByParentEventId.get(
          event.semanticEventId,
        );
      const state =
        split?.state !== "completed"
          ? split?.state
          : result?.agentResult?.resultState ||
            settlement?.state;
      if (
        ![
          "clarification_required",
          "remanded",
          "partially_remanded",
          "failed",
          "interrupted",
        ].includes(state)
      ) {
        return [];
      }
      return [{
        semanticEventId:
          event.semanticEventId,
        state,
        summary: boundedString(
          split?.summary ||
            settlement?.clarificationPrompt ||
            settlement?.rationale ||
            event.rendererSafeSummary,
          "Historical remand",
          480,
        ),
        countedAsOpenDecision: false,
        canonical: false,
        grantsAuthority: false,
      }];
    });
  const projectedProjectGenesisCandidates =
    projectGenesisCandidates.map((candidate) => ({
      schema: candidate.schema,
      candidateId: candidate.candidateId,
      artifactKind: candidate.artifactKind,
      proposedProjectId:
        candidate.proposedProjectId,
      identity: candidate.identity,
      purpose: candidate.purpose,
      semanticSummary:
        candidate.semanticSummary,
      primaryAgentEnvironmentId:
        candidate.primaryAgentEnvironmentId,
      allowedEnvironmentIds:
        candidate.allowedEnvironmentIds,
      gitAuthorityEnvironmentId:
        candidate.gitAuthorityEnvironmentId,
      rankedRecommendations:
        candidate.rankedRecommendations,
      openDecisions: candidate.openDecisions,
      evidenceReviewState:
        candidate.evidenceReviewState,
      reconciliationState:
        candidate.reconciliationState,
      lifecycle: candidate.lifecycle,
      activationState:
        candidate.activationState,
      sourceSemanticEventRef:
        candidate.sourceSemanticEventRef
          ? {
              kind:
                candidate.sourceSemanticEventRef
                  .kind,
              id:
                candidate.sourceSemanticEventRef
                  .id,
              digest:
                candidate.sourceSemanticEventRef
                  .digest,
            }
          : null,
      revision: candidate.revision,
      createdAt: candidate.createdAt,
      canonical: false,
      grantsAuthority: false,
      digest: candidate.digest,
    }));
  const projectedProjectConstitutions =
    projectConstitutions.map((constitution) => {
      const workspaceBinding = workspaceBindingByProjectId.get(
        constitution.projectId,
      ) || null;
      return ({
      projectId: constitution.projectId,
      identity: constitution.identity,
      purpose: constitution.purpose,
      primaryAgentEnvironmentId:
        constitution.primaryAgentEnvironmentId,
      allowedEnvironmentIds:
        constitution.allowedEnvironmentIds,
      gitAuthorityEnvironmentId:
        constitution.gitAuthorityEnvironmentId,
      constitutionRevision:
        constitution.constitutionRevision,
      authorityEpoch:
        constitution.authorityEpoch,
      activationState:
        constitution.activationState,
      effectiveRuntimeState: workspaceBinding
        ? "workspace_provisioned"
        : constitution.activationState,
      projectWorkspaceBindingRef: workspaceBinding
        ? {
            kind: "project_workspace_binding",
            id: workspaceBinding.workspaceBindingId,
            digest: workspaceBinding.digest,
            projectId: workspaceBinding.projectId,
          }
        : null,
      canonical: true,
      grantsAuthority: false,
      digest: constitution.digest,
    });
    });
  const projectedDecisionTransitions =
    decisionTransitions
      .slice(0, 12)
      .map(
        decisionTransitionProjection,
      );
  const aroCoverageWitnesses = [
    ...abstractReasoningObjects.map((aro) =>
      aro.coverageWitness),
    ...aroReconstructionCandidates.map((candidate) =>
      candidate.candidateAro.coverageWitness),
  ].filter((witness, index, values) =>
    values.findIndex((candidate) =>
      candidate.coverageWitnessId ===
        witness.coverageWitnessId &&
      candidate.digest === witness.digest) === index);
  const projectedRepositorySnapshots =
    repositorySemanticSnapshots.map(
      (snapshot) => ({
        schema:
          "direct_repository_semantic_snapshot_projection@1",
        repositorySnapshotRef: {
          kind:
            "repository_snapshot",
          id: snapshot.snapshotId,
          digest:
            snapshot.snapshotDigest,
          projectId:
            snapshot.projectId,
        },
        projectId:
          snapshot.projectId,
        workspaceKind:
          snapshot.workspaceKind,
        observationState:
          snapshot.observationState,
        observationError:
          snapshot.observationError
            ? {
                code:
                  snapshot.observationError
                    .code,
                message:
                  boundedString(
                    snapshot.observationError
                      .message,
                    "Repository observation unavailable.",
                    500,
                  ),
              }
            : null,
        gitAvailable:
          snapshot.repositoryIdentity
            .gitAvailable,
        headOid:
          boundedString(
            snapshot.repositoryIdentity
              .headOid,
            "",
            160,
          ),
        branch:
          boundedString(
            snapshot.repositoryIdentity
              .branch,
            "",
            240,
          ),
        dirtyPathCount:
          snapshot.repositoryIdentity
            .dirtyPathCount,
        trackedFileCount:
          snapshot.repositoryIdentity
            .trackedFileCount,
        manifestTruncated:
          snapshot.repositoryIdentity
            .manifestTruncated,
        evidenceCount:
          snapshot.evidence.length,
        evidenceCatalogComplete:
          snapshot.evidenceCatalogComplete,
        sourceTextProjected: false,
        relativePathsProjected: false,
        rawWorkspacePathIncluded: false,
        rawSecretIncluded: false,
        canonical: false,
        grantsAuthority: false,
        observedAt:
          snapshot.observedAt,
      }),
    );
  const projectedAroReconstructionRuns =
    aroReconstructionRuns.map((run) => ({
      schema:
        "direct_aro_reconstruction_run_projection@1",
      runRef: {
        kind:
          "aro_reconstruction_run",
        id: run.runId,
        digest: run.digest,
        projectId: run.projectId,
      },
      projectId: run.projectId,
      repositorySnapshotRef:
        run.repositorySnapshotRef,
      attempt: run.attempt,
      state: run.state,
      retryable: run.retryable,
      candidateRefs:
        run.candidateRefs,
      repositorySummary:
        boundedString(
          run.repositorySummary,
          "",
          1_200,
        ),
      selectionRationale:
        boundedString(
          run.selectionRationale,
          "",
          1_200,
        ),
      error: run.error
        ? {
            code: run.error.code,
            message: boundedString(
              run.error.message,
              "Repository semantic reconstruction failed.",
              500,
            ),
          }
        : null,
      model:
        run.telemetry?.model || "",
      reasoningEffort:
        run.telemetry
          ?.reasoningEffort || "",
      semanticTruthValidated: false,
      workspaceMutationEffect: false,
      admissionEffect: false,
      canonical: false,
      grantsAuthority: false,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
  const projectedAroTargetDefinitionRuns =
    aroTargetDefinitionRuns.map(
      (run) => ({
        schema:
          "direct_aro_target_definition_run_projection@1",
        runRef: {
          kind:
            "aro_target_definition_run",
          id: run.runId,
          digest: run.digest,
          projectId: run.projectId,
        },
        projectId: run.projectId,
        currentAroRef:
          run.currentAroRef,
        targetBaselineRef:
          run.targetBaselineRef,
        targetIntent: boundedString(
          run.targetIntent,
          "",
          8_000,
        ),
        targetIntentDigest:
          run.targetIntentDigest,
        definitionKeyDigest:
          run.definitionKeyDigest,
        attempt: run.attempt,
        state: run.state,
        retryable: run.retryable,
        candidateRef:
          run.candidateRef,
        definitionRationale:
          boundedString(
            run.definitionRationale,
            "",
            1_200,
          ),
        assumptions:
          run.assumptions.map(
            (entry) =>
              boundedString(
                entry,
                "",
                800,
              )),
        unresolvedQuestions:
          run.unresolvedQuestions.map(
            (entry) =>
              boundedString(
                entry,
                "",
                800,
              )),
        error: run.error
          ? {
              code: run.error.code,
              message: boundedString(
                run.error.message,
                "ARO target definition failed.",
                500,
              ),
            }
          : null,
        model:
          run.telemetry?.model || "",
        reasoningEffort:
          run.telemetry
            ?.reasoningEffort || "",
        sourceInspectionEffect: false,
        realizationBindingEffect: false,
        canonicalAdmissionEffect: false,
        mutationContractEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }),
    );
  const projectedAroMutationContracts =
    aroMutationContracts.map(
      (contract) => ({
        schema:
          "direct_aro_mutation_contract_projection@1",
        contractRef: {
          kind:
            "aro_mutation_contract",
          id: contract.contractId,
          digest: contract.digest,
          projectId:
            contract.projectId,
        },
        contractRevision:
          contract.contractRevision,
        projectId:
          contract.projectId,
        conceptKey:
          contract.conceptKey,
        comparisonRef:
          contract.comparisonRef,
        currentAroRef:
          contract.currentAroRef,
        targetAroRef:
          contract.targetAroRef,
        repositorySnapshotRef:
          contract.repositorySnapshotRef,
        disposition:
          contract.disposition,
        contractSummary:
          boundedString(
            contract.contractSummary,
            "",
            1_600,
          ),
        changeStrategy:
          boundedString(
            contract.changeStrategy,
            "",
            1_600,
          ),
        delta: {
          digest:
            contract.delta.digest,
          mutationRequired:
            contract.delta
              .mutationRequired,
          targetOnlyBranchRefs:
            contract.delta
              .targetOnlyBranchRefs,
          currentOnlyBranchRefs:
            contract.delta
              .currentOnlyBranchRefs,
          targetGapBranchRefs:
            contract.delta
              .targetGapBranchRefs,
          operativeTargetBranchRefs:
            contract.delta
              .operativeTargetBranchRefs,
          conflictPairs:
            contract.delta
              .conflictPairs,
          semanticTruthValidated:
            false,
          codeMutationAuthorized:
            false,
          grantsAuthority: false,
        },
        implementationObligations:
          contract
            .implementationObligations
            .map((obligation) => ({
              obligationId:
                obligation.obligationId,
              obligationKey:
                obligation.obligationKey,
              obligationKind:
                obligation.obligationKind,
              title: boundedString(
                obligation.title,
                "",
                300,
              ),
              objective: boundedString(
                obligation.objective,
                "",
                1_600,
              ),
              branchRefs:
                obligation.branchRefs,
              preservationConstraintKeys:
                obligation
                  .preservationConstraintKeys,
              verificationRequirementKeys:
                obligation
                  .verificationRequirementKeys,
              priority:
                obligation.priority,
              rationale: boundedString(
                obligation.rationale,
                "",
                1_200,
              ),
              grantsAuthority: false,
            })),
        verificationRequirements:
          contract
            .verificationRequirements
            .map((requirement) => ({
              verificationRequirementId:
                requirement
                  .verificationRequirementId,
              verificationKey:
                requirement.verificationKey,
              verificationKind:
                requirement.verificationKind,
              claim: boundedString(
                requirement.claim,
                "",
                1_200,
              ),
              successCondition:
                boundedString(
                  requirement
                    .successCondition,
                  "",
                  1_200,
                ),
              branchRefs:
                requirement.branchRefs,
              requiredEvidenceKinds:
                requirement
                  .requiredEvidenceKinds,
              grantsAuthority: false,
            })),
        preservationConstraints:
          contract
            .preservationConstraints
            .map((constraint) => ({
              preservationConstraintId:
                constraint
                  .preservationConstraintId,
              constraintKey:
                constraint.constraintKey,
              statement: boundedString(
                constraint.statement,
                "",
                1_200,
              ),
              branchRefs:
                constraint.branchRefs,
              grantsAuthority: false,
            })),
        assumptions:
          contract.assumptions,
        unresolvedQuestions:
          contract.unresolvedQuestions,
        lifecycle:
          contract.lifecycle,
        reviewState:
          contract.reviewState,
        realizationContextState:
          contract
            .realizationContextState,
        workerLaunchState:
          contract.workerLaunchState,
        sourceInspectionEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        canonical: false,
        grantsAuthority: false,
        createdAt:
          contract.createdAt,
      }),
    );
  const projectedAroMutationRuns =
    aroMutationCompilationRuns.map(
      (run) => ({
        schema:
          "direct_aro_mutation_compilation_run_projection@1",
        runRef: {
          kind:
            "aro_mutation_compilation_run",
          id: run.runId,
          digest: run.digest,
          projectId:
            run.projectId,
        },
        projectId: run.projectId,
        comparisonRef:
          run.comparisonRef,
        currentAroRef:
          run.currentAroRef,
        targetAroRef:
          run.targetAroRef,
        attempt: run.attempt,
        state: run.state,
        retryable: run.retryable,
        contractRef:
          run.contractRef,
        error: run.error
          ? {
              code: run.error.code,
              message: boundedString(
                run.error.message,
                "ARO mutation-contract compilation failed.",
                500,
              ),
            }
          : null,
        model:
          run.telemetry?.model || "",
        reasoningEffort:
          run.telemetry
            ?.reasoningEffort || "",
        sourceInspectionEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }),
    );
  const projectedAroRealizationContextImports =
    aroRealizationContextImports.map(
      (contextImport) => ({
        schema:
          "direct_aro_realization_context_import_projection@1",
        contextImportRef: {
          kind:
            "aro_realization_context_import",
          id:
            contextImport.contextImportId,
          digest: contextImport.digest,
          projectId:
            contextImport.projectId,
        },
        projectId:
          contextImport.projectId,
        contractRef:
          contextImport.contractRef,
        comparisonRef:
          contextImport.comparisonRef,
        currentAroRef:
          contextImport.currentAroRef,
        targetAroRef:
          contextImport.targetAroRef,
        repositorySnapshotRef:
          contextImport
            .repositorySnapshotRef,
        workspaceKind:
          contextImport.workspaceKind,
        sourceIdentityDigest:
          contextImport
            .sourceIdentityDigest,
        freshness:
          contextImport.freshness,
        selectionWitness: {
          selectionMode:
            contextImport
              .selectionWitness
              .selectionMode,
          requestedPaths:
            contextImport
              .selectionWitness
              .requestedPaths,
          selectedPaths:
            contextImport
              .selectionWitness
              .selectedPaths,
          rejectedPaths:
            contextImport
              .selectionWitness
              .rejectedPaths,
          omittedPaths:
            contextImport
              .selectionWitness
              .omittedPaths,
          operativeObligationKeys:
            contextImport
              .selectionWitness
              .operativeObligationKeys,
          operativeBranchRefs:
            contextImport
              .selectionWitness
              .operativeBranchRefs,
          maxFiles:
            contextImport
              .selectionWitness
              .maxFiles,
          maxExcerptBytesPerFile:
            contextImport
              .selectionWitness
              .maxExcerptBytesPerFile,
          maxTotalExcerptBytes:
            contextImport
              .selectionWitness
              .maxTotalExcerptBytes,
          grantsAuthority: false,
        },
        evidence:
          contextImport.evidence.map(
            (evidence) => ({
              schema:
                "direct_aro_realization_source_evidence_projection@1",
              evidenceKey:
                evidence.evidenceKey,
              evidenceKind:
                evidence.evidenceKind,
              relativePath:
                evidence.relativePath,
              language:
                evidence.language,
              sizeBytes:
                evidence.sizeBytes,
              lineStart:
                evidence.lineStart,
              lineEnd:
                evidence.lineEnd,
              excerptTruncated:
                evidence
                  .excerptTruncated,
              sourceRef:
                evidence.sourceRef,
              sourceTextProjected:
                false,
              rawWorkspacePathIncluded:
                false,
              rawSecretIncluded: false,
              grantsAuthority: false,
            })),
        sourceTextProjected: false,
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        executionAuthorityGranted:
          false,
        semanticTruthValidated:
          false,
        rawWorkspacePathIncluded:
          false,
        rawSecretIncluded: false,
        canonical: false,
        grantsAuthority: false,
        importedAt:
          contextImport.importedAt,
      }),
    );
  const projectedAroRealizationMappingWitnesses =
    aroRealizationMappingWitnesses.map(
      (witness) => ({
        schema:
          "direct_aro_realization_mapping_witness_projection@1",
        mappingWitnessRef: {
          kind:
            "aro_realization_mapping_witness",
          id:
            witness.mappingWitnessId,
          digest: witness.digest,
          projectId:
            witness.projectId,
        },
        projectId: witness.projectId,
        contractRef: witness.contractRef,
        comparisonRef:
          witness.comparisonRef,
        currentAroRef:
          witness.currentAroRef,
        targetAroRef:
          witness.targetAroRef,
        repositorySnapshotRef:
          witness.repositorySnapshotRef,
        contextImportRef:
          witness.contextImportRef,
        sourceIdentityDigest:
          witness.sourceIdentityDigest,
        freshness: witness.freshness,
        mappingSummary: boundedString(
          witness.mappingSummary,
          "",
          1_600,
        ),
        mappingPosture:
          witness.mappingPosture,
        mappedObligationCount:
          witness.mappedObligationCount,
        partialObligationCount:
          witness.partialObligationCount,
        unmappedObligationCount:
          witness.unmappedObligationCount,
        ambiguousObligationCount:
          witness
            .ambiguousObligationCount,
        obligationMappings:
          witness.obligationMappings.map(
            (mapping) => ({
              schema:
                "direct_aro_obligation_realization_mapping_projection@1",
              mappingEntryId:
                mapping.mappingEntryId,
              obligationRef:
                mapping.obligationRef,
              obligationKey:
                mapping.obligationKey,
              branchRefs:
                mapping.branchRefs,
              coverageState:
                mapping.coverageState,
              sourceBindings:
                mapping.sourceBindings.map(
                  (binding) => ({
                    schema:
                      "direct_aro_source_realization_binding_projection@1",
                    sourceBindingId:
                      binding
                        .sourceBindingId,
                    evidenceKey:
                      binding.evidenceKey,
                    sourceRef:
                      binding.sourceRef,
                    relativePath:
                      binding.relativePath,
                    symbol:
                      boundedString(
                        binding.symbol,
                        "(file scope)",
                        400,
                      ),
                    startLine:
                      binding.startLine,
                    endLine:
                      binding.endLine,
                    bindingKind:
                      boundedString(
                        binding
                          .bindingKind,
                        "implementation",
                        160,
                      ),
                    rationale:
                      boundedString(
                        binding.rationale,
                        "",
                        1_200,
                      ),
                    sourceTextProjected:
                      false,
                    grantsAuthority:
                      false,
                  })),
              rationale: boundedString(
                mapping.rationale,
                "",
                1_200,
              ),
              grantsAuthority: false,
            })),
        ambiguities:
          witness.ambiguities,
        omissions: witness.omissions,
        assumptions:
          witness.assumptions,
        unresolvedQuestions:
          witness.unresolvedQuestions,
        lifecycle: witness.lifecycle,
        reviewState:
          witness.reviewState,
        workerLaunchState:
          witness.workerLaunchState,
        sourceTextProjected: false,
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        executionAuthorityGranted:
          false,
        semanticTruthValidated:
          false,
        canonical: false,
        grantsAuthority: false,
        createdAt: witness.createdAt,
      }),
    );
  const projectedAroRealizationMappingRuns =
    aroRealizationMappingRuns.map(
      (run) => ({
        schema:
          "direct_aro_realization_mapping_run_projection@1",
        runRef: {
          kind:
            "aro_realization_mapping_run",
          id: run.runId,
          digest: run.digest,
          projectId: run.projectId,
        },
        projectId: run.projectId,
        contractRef: run.contractRef,
        comparisonRef:
          run.comparisonRef,
        currentAroRef:
          run.currentAroRef,
        targetAroRef:
          run.targetAroRef,
        repositorySnapshotRef:
          run.repositorySnapshotRef,
        contextImportRef:
          run.contextImportRef,
        sourceIdentityDigest:
          run.sourceIdentityDigest,
        attempt: run.attempt,
        state: run.state,
        retryable: run.retryable,
        mappingWitnessRef:
          run.mappingWitnessRef,
        error: run.error
          ? {
              code: run.error.code,
              message: boundedString(
                run.error.message,
                "ARO realization mapping failed.",
                500,
              ),
            }
          : null,
        model:
          run.telemetry?.model || "",
        reasoningEffort:
          run.telemetry
            ?.reasoningEffort || "",
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        executionAuthorityGranted:
          false,
        semanticTruthValidated:
          false,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }),
    );
  const projectedAroWorkerSourceFreshness =
    aroWorkerSourceFreshness.map(
      (witness) => ({
        schema:
          "direct_aro_worker_source_freshness_projection@1",
        sourceFreshnessRef: {
          kind:
            "aro_worker_source_freshness_witness",
          id:
            witness.sourceFreshnessWitnessId,
          digest: witness.digest,
          projectId: witness.projectId,
        },
        projectId: witness.projectId,
        contextImportRef:
          witness.contextImportRef,
        expectedSourceIdentityDigest:
          witness
            .expectedSourceIdentityDigest,
        requestedPaths:
          witness.requestedPaths,
        checkedSourceCount:
          witness.checkedSourceCount,
        state: witness.state,
        blockerCodes:
          witness.blockerCodes,
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workspaceMutationEffect: false,
        rawWorkspacePathIncluded: false,
        rawSecretIncluded: false,
        grantsAuthority: false,
        observedAt: witness.observedAt,
      }),
    );
  const projectedAroWorkerCapabilities =
    aroWorkerCapabilityObservations.map(
      (observation) => ({
        schema:
          "direct_aro_worker_capability_observation_projection@1",
        capabilityObservationRef: {
          kind:
            "aro_worker_capability_observation",
          id:
            observation
              .capabilityObservationId,
          digest:
            observation.digest,
          projectId:
            observation.projectId,
        },
        projectId:
          observation.projectId,
        runtimePath:
          observation.runtimePath,
        workspaceKind:
          observation.workspaceKind,
        runtimeStatus:
          observation.runtimeStatus,
        turnRunnable:
          observation.turnRunnable,
        workerStartAvailable:
          observation
            .workerStartAvailable,
        toolStates:
          observation.toolStates,
        availableToolNames:
          observation
            .availableToolNames,
        perCallApprovalRequired:
          true,
        workspaceMutationAtHandoff:
          false,
        remoteMutationAvailable:
          false,
        canonicalWriteAvailable:
          false,
        blockerCodes:
          observation.blockerCodes,
        rawWorkspacePathIncluded:
          false,
        rawCredentialIncluded:
          false,
        rawSecretIncluded: false,
        grantsAuthority: false,
        observedAt:
          observation.observedAt,
      }),
    );
  const projectedAroWorkerReviews =
    aroWorkerReviewReceipts.map(
      (receipt) => ({
        schema:
          "direct_aro_worker_review_receipt_projection@1",
        reviewReceiptRef: {
          kind:
            "aro_worker_review_receipt",
          id:
            receipt.reviewReceiptId,
          digest: receipt.digest,
          projectId: receipt.projectId,
        },
        projectId: receipt.projectId,
        contractRef:
          receipt.contractRef,
        contextImportRef:
          receipt.contextImportRef,
        mappingWitnessRef:
          receipt.mappingWitnessRef,
        sourceFreshnessRef:
          receipt.sourceFreshnessRef,
        capabilityObservationRef:
          receipt
            .capabilityObservationRef,
        reviewState:
          receipt.reviewState,
        blockerCodes:
          receipt.blockerCodes,
        exactEvidenceReviewed: true,
        sourceIdentityRefreshed: true,
        capabilityGateObserved: true,
        providerStartAuthorized:
          false,
        workspaceMutationAuthorized:
          false,
        canonicalAdmissionAuthorized:
          false,
        grantsAuthority: false,
        reviewedAt:
          receipt.reviewedAt,
      }),
    );
  const projectedAroWorkerConstitutions =
    aroWorkerConstitutions.map(
      (constitution) => ({
        schema:
          "direct_aro_worker_constitution_projection@1",
        constitutionRef: {
          kind:
            "aro_worker_constitution",
          id:
            constitution
              .workerConstitutionId,
          digest:
            constitution.digest,
          projectId:
            constitution.projectId,
        },
        projectId:
          constitution.projectId,
        contractRef:
          constitution.contractRef,
        comparisonRef:
          constitution.comparisonRef,
        currentAroRef:
          constitution.currentAroRef,
        targetAroRef:
          constitution.targetAroRef,
        contextImportRef:
          constitution.contextImportRef,
        mappingWitnessRef:
          constitution.mappingWitnessRef,
        reviewReceiptRef:
          constitution.reviewReceiptRef,
        sourceFreshnessRef:
          constitution.sourceFreshnessRef,
        capabilityObservationRef:
          constitution
            .capabilityObservationRef,
        constitutionState:
          constitution.constitutionState,
        blockerCodes:
          constitution.blockerCodes,
        role: {
          roleTemplateId:
            constitution.roleTemplate
              .roleTemplateId,
          roleKind:
            constitution.roleTemplate
              .roleKind,
          purpose:
            boundedString(
              constitution.roleTemplate
                .purpose,
              "",
              500,
            ),
          requiredOutputSchema:
            constitution.roleTemplate
              .requiredOutputSchema,
          grantsAuthority: false,
        },
        capability: {
          toolNames:
            constitution
              .capabilityEnvelope
              .toolNames,
          toolCount:
            constitution
              .capabilityEnvelope
              .toolCount,
          perCallApprovalRequired:
            true,
          workspaceMutationAtHandoff:
            false,
          remoteMutationAvailable:
            false,
          canonicalWriteAvailable:
            false,
          grantsAuthority: false,
        },
        authority: {
          providerStartRequiresOperatorAuthorization:
            true,
          mayStartProviderTurnAfterAuthorization:
            true,
          mayProposePerCallEffects:
            true,
          mayExecuteWorkspaceMutation:
            false,
          mayMutateRemoteSystems:
            false,
          mayAdmitCanonicalWorldstate:
            false,
          mayCertifyClosure: false,
          perCallApprovalRequired:
            true,
          grantsAuthority: false,
        },
        budget: {
          turnLimit:
            constitution.budget
              .turnLimit,
          recursiveWorkerLimit:
            constitution.budget
              .recursiveWorkerLimit,
          mappedFileCount:
            constitution.budget
              .mappedFileCount,
          maxMappedFileCount:
            constitution.budget
              .maxMappedFileCount,
          workspaceMutationAtHandoffLimit:
            0,
          remoteMutationLimit: 0,
          canonicalWriteLimit: 0,
          budgetPosture:
            constitution.budget
              .budgetPosture,
          grantsAuthority: false,
        },
        completion: {
          requiredOutputSchema:
            constitution
              .completionContract
              .requiredOutputSchema,
          requiredEvidenceKinds:
            constitution
              .completionContract
              .requiredEvidenceKinds,
          activityCountsAsCompletion:
            false,
          workerMaySelfCertifyClosure:
            false,
          semanticClosureDeferredTo:
            constitution
              .completionContract
              .semanticClosureDeferredTo,
          runtimeVerificationDeferredTo:
            constitution
              .completionContract
              .runtimeVerificationDeferredTo,
          grantsAuthority: false,
        },
        obligationBindings:
          constitution
            .obligationBindings,
        compiledAgentContextRef: {
          kind:
            "compiled_agent_context",
          id:
            constitution
              .compiledAgentContext
              .compiledAgentContextId,
          digest:
            constitution
              .compiledAgentContext
              .digest,
          projectId:
            constitution.projectId,
        },
        compiledInstructionsProjected:
          false,
        sourceTextProjected: false,
        providerStartAuthorized:
          false,
        workspaceMutationAtCompile:
          false,
        remoteMutationAvailable:
          false,
        canonicalWriteAvailable:
          false,
        semanticTruthValidated:
          false,
        closureCertified: false,
        rendererAuthored: false,
        canonical: false,
        grantsAuthority: false,
        compiledAt:
          constitution.compiledAt,
      }),
    );
  const projectedAroWorkerAuthorizations =
    aroWorkerAuthorizations.map(
      (authorization) => ({
        schema:
          "direct_aro_worker_authorization_projection@1",
        authorizationRef: {
          kind:
            "aro_worker_authorization_receipt",
          id:
            authorization
              .authorizationReceiptId,
          digest:
            authorization.digest,
          projectId:
            authorization.projectId,
        },
        projectId:
          authorization.projectId,
        constitutionRef:
          authorization.constitutionRef,
        operatorActionId:
          authorization.operatorActionId,
        authorizationState:
          authorization.authorizationState,
        blockerCodes:
          authorization.blockerCodes,
        workerStartAuthorized:
          authorization
            .workerStartAuthorized,
        providerTurnStartAuthorized:
          authorization
            .providerTurnStartAuthorized,
        toolProposalAuthorized:
          authorization
            .toolProposalAuthorized,
        workspaceMutationAuthorized:
          false,
        remoteMutationAuthorized:
          false,
        canonicalAdmissionAuthorized:
          false,
        semanticClosureAuthorized:
          false,
        perCallEffectApprovalRequired:
          true,
        singleUse: true,
        grantsAuthority: false,
        authorizedAt:
          authorization.authorizedAt,
      }),
    );
  const projectedAroWorkerHandoffRuns =
    aroWorkerHandoffRuns.map(
      (run) => ({
        schema:
          "direct_aro_worker_handoff_run_projection@1",
        runRef: {
          kind:
            "aro_worker_handoff_run",
          id: run.runId,
          digest: run.digest,
          projectId: run.projectId,
        },
        projectId: run.projectId,
        constitutionRef:
          run.constitutionRef,
        authorizationRef:
          run.authorizationRef,
        workThreadRef:
          run.workThreadRef,
        handoffPacketRef:
          run.handoffPacketRef,
        workerStartTransitionRef:
          run.workerStartTransitionRef,
        workerSessionRef:
          run.workerSessionRef,
        workerTurnRef:
          run.workerTurnRef,
        state: run.state,
        blockerCodes:
          run.blockerCodes,
        error: run.error,
        retryable: false,
        authorizationConsumed:
          run.authorizationConsumed,
        workerLaunchEffect:
          run.workerLaunchEffect,
        providerTurnStartEffect:
          run.providerTurnStartEffect,
        toolProposalEffect:
          run.toolProposalEffect,
        workspaceMutationEffect:
          false,
        remoteMutationEffect: false,
        canonicalAdmissionEffect:
          false,
        semanticTruthValidated:
          false,
        closureCertified: false,
        perCallEffectApprovalRequired:
          true,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }),
    );
  const projectedAroExecutionEvidenceBundles =
    aroExecutionEvidenceBundles.map(
      (bundle) => ({
        schema:
          "direct_aro_execution_evidence_bundle_projection@1",
        evidenceBundleRef: {
          kind:
            "aro_execution_evidence_bundle",
          id:
            bundle.evidenceBundleId,
          digest: bundle.digest,
          projectId:
            bundle.projectId,
        },
        projectId:
          bundle.projectId,
        acquisitionRunRef:
          bundle.acquisitionRunRef,
        handoffRunRef:
          bundle.handoffRunRef,
        constitutionRef:
          bundle.constitutionRef,
        contractRef:
          bundle.contractRef,
        contextImportRef:
          bundle.contextImportRef,
        captureState:
          bundle.captureState,
        workerTurn: {
          witnessRef: {
            kind:
              "aro_worker_turn_witness",
            id:
              bundle
                .workerTurnWitness
                .workerTurnWitnessId,
            digest:
              bundle
                .workerTurnWitness
                .digest,
            projectId:
              bundle.projectId,
          },
          workerSessionRef:
            bundle
              .workerTurnWitness
              .workerSessionRef,
          workerTurnRef:
            bundle
              .workerTurnWitness
              .workerTurnRef,
          state:
            bundle
              .workerTurnWitness
              .turnState,
          terminal:
            bundle
              .workerTurnWitness
              .terminal,
          active:
            bundle
              .workerTurnWitness
              .active,
          unresolvedObligationCount:
            bundle
              .workerTurnWitness
              .unresolvedObligationCount,
          toolResultCount:
            bundle
              .workerTurnWitness
              .toolResultCount,
          continuationRequestCount:
            bundle
              .workerTurnWitness
              .continuationRequestCount,
          finalOutputPresent:
            bundle
              .workerTurnWitness
              .finalOutputPresent,
          finalOutputDigest:
            bundle
              .workerTurnWitness
              .finalOutputDigest,
          finalOutputPreview:
            boundedString(
              bundle
                .workerTurnWitness
                .finalOutputPreview,
              "",
              1_200,
            ),
          errorCode:
            bundle
              .workerTurnWitness
              .errorCode,
          observedAt:
            bundle
              .workerTurnWitness
              .observedAt,
        },
        toolResults:
          bundle.toolResultWitnesses
            .map((witness) => ({
              witnessRef: {
                kind:
                  "aro_tool_result_witness",
                id:
                  witness
                    .toolResultWitnessId,
                digest:
                  witness.digest,
                projectId:
                  witness.projectId,
              },
              sourceResultRef:
                witness
                  .sourceResultRef,
              obligationId:
                witness.obligationId,
              tool: witness.tool,
              status:
                witness.status,
              resultClass:
                witness.resultClass,
              sideEffectExecuted:
                witness
                  .sideEffectExecuted,
              approvalWitnessPresent:
                witness
                  .approvalWitnessPresent,
              relativePath:
                witness.relativePath,
              files:
                witness.files,
              command:
                witness.command,
              evidenceKinds:
                witness.evidenceKinds,
              workspaceEffectSummaryId:
                witness
                  .workspaceEffectSummaryId,
              postSideEffectPolicyViolation:
                witness
                  .postSideEffectPolicyViolation,
              recordedAt:
                witness.recordedAt,
            })),
        workspaceEffects:
          bundle
            .workspaceEffectWitnesses
            .map((witness) => ({
              witnessRef: {
                kind:
                  "aro_workspace_effect_witness",
                id:
                  witness
                    .workspaceEffectWitnessId,
                digest:
                  witness.digest,
                projectId:
                  witness.projectId,
              },
              toolResultWitnessRef:
                witness
                  .toolResultWitnessRef,
              sourceEffectSummaryRef:
                witness
                  .sourceEffectSummaryRef,
              tool: witness.tool,
              changedPathCount:
                witness
                  .changedPathCount,
              knownPathCount:
                witness.knownPathCount,
              omittedPathCount:
                witness.omittedPathCount,
              unexpectedPathCount:
                witness
                  .unexpectedPathCount,
              blockedPathCount:
                witness.blockedPathCount,
              sensitivePathCount:
                witness
                  .sensitivePathCount,
              changedPathsPreview:
                witness
                  .changedPathsPreview,
              changedPathsTruncated:
                witness
                  .changedPathsTruncated,
              scan: witness.scan,
              policyDecision:
                witness.policyDecision,
              providerVisibility:
                witness
                  .providerVisibility,
              localEffectExecuted:
                witness
                  .localEffectExecuted,
              workspaceMutationObserved:
                witness
                  .workspaceMutationObserved,
              evidenceAmbiguous:
                witness
                  .evidenceAmbiguous,
              observedAt:
                witness.observedAt,
            })),
        repositoryAfterState: {
          witnessRef: {
            kind:
              "aro_repository_after_state_witness",
            id:
              bundle
                .repositoryAfterStateWitness
                .repositoryAfterStateWitnessId,
            digest:
              bundle
                .repositoryAfterStateWitness
                .digest,
            projectId:
              bundle.projectId,
          },
          beforeRepositoryIdentity:
            bundle
              .repositoryAfterStateWitness
              .beforeRepositoryIdentity,
          afterRepositoryIdentity:
            bundle
              .repositoryAfterStateWitness
              .afterRepositoryIdentity,
          pathComparisons:
            bundle
              .repositoryAfterStateWitness
              .pathComparisons,
          changedSelectedPathCount:
            bundle
              .repositoryAfterStateWitness
              .changedSelectedPathCount,
          unchangedSelectedPathCount:
            bundle
              .repositoryAfterStateWitness
              .unchangedSelectedPathCount,
          missingSelectedPathCount:
            bundle
              .repositoryAfterStateWitness
              .missingSelectedPathCount,
          rejectedPathCount:
            bundle
              .repositoryAfterStateWitness
              .rejectedPathCount,
          omittedPathCount:
            bundle
              .repositoryAfterStateWitness
              .omittedPathCount,
          repositoryChanged:
            bundle
              .repositoryAfterStateWitness
              .repositoryChanged,
          workspaceMutationObserved:
            bundle
              .repositoryAfterStateWitness
              .workspaceMutationObserved,
          unattributedRepositoryDrift:
            bundle
              .repositoryAfterStateWitness
              .unattributedRepositoryDrift,
          evidenceAmbiguous:
            bundle
              .repositoryAfterStateWitness
              .evidenceAmbiguous,
          observedAt:
            bundle
              .repositoryAfterStateWitness
              .observedAt,
        },
        verificationCoverage:
          bundle
            .verificationCoverageWitnesses
            .map((witness) => ({
              witnessRef: {
                kind:
                  "aro_verification_coverage_witness",
                id:
                  witness
                    .verificationCoverageWitnessId,
                digest:
                  witness.digest,
                projectId:
                  witness.projectId,
              },
              verificationRequirementRef:
                witness
                  .verificationRequirementRef,
              verificationKey:
                witness.verificationKey,
              verificationKind:
                witness
                  .verificationKind,
              requiredEvidenceKinds:
                witness
                  .requiredEvidenceKinds,
              observedEvidenceKinds:
                witness
                  .observedEvidenceKinds,
              missingEvidenceKinds:
                witness
                  .missingEvidenceKinds,
              coverageStatus:
                witness.coverageStatus,
              mechanicalPresenceOnly:
                true,
              successConditionEvaluated:
                false,
              semanticTruthValidated:
                false,
              closureCertified: false,
            })),
        workerTurnTerminal:
          bundle.workerTurnTerminal,
        workspaceMutationObserved:
          bundle
            .workspaceMutationObserved,
        repositoryChanged:
          bundle.repositoryChanged,
        ambiguityObserved:
          bundle.ambiguityObserved,
        missingEvidenceKindCount:
          bundle
            .missingEvidenceKindCount,
        workspaceMutationAuthorizedBySc8_4:
          false,
        remoteMutationObserved:
          false,
        canonicalAdmissionObserved:
          false,
        semanticTruthValidated:
          false,
        closureCertified: false,
        rawProviderPayloadIncluded:
          false,
        rawToolResultIncluded: false,
        rawChainOfThoughtIncluded:
          false,
        canonical: false,
        grantsAuthority: false,
        acquiredAt:
          bundle.acquiredAt,
      }),
    );
  const projectedAroExecutionEvidenceRuns =
    aroExecutionEvidenceRuns.map(
      (run) => ({
        schema:
          "direct_aro_execution_evidence_run_projection@1",
        runRef: {
          kind:
            "aro_execution_evidence_run",
          id: run.runId,
          digest: run.digest,
          projectId: run.projectId,
        },
        projectId: run.projectId,
        handoffRunRef:
          run.handoffRunRef,
        observationRequestId:
          run.observationRequestId,
        state: run.state,
        evidenceBundleRef:
          run.evidenceBundleRef,
        error: run.error,
        retryable: run.retryable,
        workspaceMutationObserved:
          run.workspaceMutationObserved,
        repositoryChanged:
          run.repositoryChanged,
        ambiguityObserved:
          run.ambiguityObserved,
        missingEvidenceKindCount:
          run.missingEvidenceKindCount,
        observationEffect: [
          "observing",
          "acquired",
        ].includes(run.state),
        workspaceMutationAuthorized:
          false,
        remoteMutationAuthorized:
          false,
        canonicalAdmissionAuthorized:
          false,
        semanticClosureAuthorized:
          false,
        semanticTruthValidated:
          false,
        closureCertified: false,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }),
    );
  const projectSemanticAssessmentRows =
    (rows, keyField) =>
      rows.map((entry) => ({
        [keyField]: entry[keyField],
        sourceRef: entry.sourceRef,
        status: entry.status,
        rationale: boundedString(
          entry.rationale,
          "",
          1_800,
        ),
        blindspots:
          entry.blindspots,
        continuationPaths:
          entry.continuationPaths,
        evidenceKinds:
          entry.evidenceKinds,
        evidenceRefs:
          entry.evidenceRefs,
        unmappedEvidenceKinds:
          entry.unmappedEvidenceKinds,
        evidenceBindingState:
          entry.evidenceBindingState,
        requiredForGate:
          entry.requiredForGate,
        synthesizedFromOmission:
          entry
            .synthesizedFromOmission,
        canonical: false,
        grantsAuthority: false,
      }));
  const projectedAroSemanticVerificationAssessments =
    aroSemanticVerificationAssessments
      .map((assessment) => ({
        schema:
          "direct_aro_semantic_verification_assessment_projection@1",
        assessmentRef: {
          kind:
            "aro_semantic_verification_assessment",
          id: assessment.assessmentId,
          digest: assessment.digest,
          projectId:
            assessment.projectId,
        },
        projectId:
          assessment.projectId,
        evidenceBundleRef:
          assessment
            .evidenceBundleRef,
        handoffRunRef:
          assessment.handoffRunRef,
        constitutionRef:
          assessment.constitutionRef,
        contractRef:
          assessment.contractRef,
        contextImportRef:
          assessment.contextImportRef,
        mappingWitnessRef:
          assessment.mappingWitnessRef,
        comparisonRef:
          assessment.comparisonRef,
        currentAroRef:
          assessment.currentAroRef,
        targetAroRef:
          assessment.targetAroRef,
        overallPosture:
          assessment.overallPosture,
        assessmentSummary:
          boundedString(
            assessment
              .assessmentSummary,
            "",
            2_400,
          ),
        obligationAssessments:
          projectSemanticAssessmentRows(
            assessment
              .obligationAssessments,
            "obligationKey",
          ),
        verificationAssessments:
          projectSemanticAssessmentRows(
            assessment
              .verificationAssessments,
            "verificationKey",
          ),
        preservationAssessments:
          projectSemanticAssessmentRows(
            assessment
              .preservationAssessments,
            "preservationKey",
          ),
        branchAssessments:
          projectSemanticAssessmentRows(
            assessment
              .branchAssessments,
            "branchKey",
          ),
        driftFindings:
          assessment.driftFindings
            .map((finding) => ({
              findingKey:
                finding.findingKey,
              severity:
                finding.severity,
              category:
                finding.category,
              statement:
                boundedString(
                  finding.statement,
                  "",
                  1_800,
                ),
              affectedBranchKeys:
                finding
                  .affectedBranchKeys,
              recommendedResponse:
                boundedString(
                  finding
                    .recommendedResponse,
                  "",
                  1_200,
                ),
              evidenceKinds:
                finding.evidenceKinds,
              evidenceRefs:
                finding.evidenceRefs,
              evidenceBindingState:
                finding
                  .evidenceBindingState,
              canonical: false,
              grantsAuthority: false,
            })),
        continuationPaths:
          assessment
            .continuationPaths
            .map((path) => ({
              pathKey: path.pathKey,
              label: path.label,
              description:
                boundedString(
                  path.description,
                  "",
                  1_600,
                ),
              priority: path.priority,
              preconditions:
                path.preconditions,
              canonical: false,
              grantsAuthority: false,
            })),
        decisionProposalCount:
          assessment
            .decisionProposals.length,
        closureRecommendation:
          assessment
            .closureRecommendation,
        closureRationale:
          boundedString(
            assessment
              .closureRationale,
            "",
            1_800,
          ),
        synthesizedAssessmentCount:
          assessment
            .synthesizedAssessmentCount,
        unmappedAssessmentCount:
          assessment
            .unmappedAssessmentCount,
        semanticTruthAssessed: true,
        semanticTruthCanonical: false,
        sourceInspectionEffect: false,
        toolExecutionEffect: false,
        workspaceMutationEffect: false,
        remoteMutationEffect: false,
        canonicalAdmissionEffect:
          false,
        closureCertified: false,
        canonical: false,
        grantsAuthority: false,
        assessedAt:
          assessment.assessedAt,
      }));
  const projectedAroClosureCandidates =
    aroClosureCandidates
      .map((candidate) => ({
        schema:
          "direct_aro_closure_candidate_projection@1",
        closureCandidateRef: {
          kind:
            "aro_closure_candidate",
          id:
            candidate
              .closureCandidateId,
          digest: candidate.digest,
          projectId:
            candidate.projectId,
        },
        projectId:
          candidate.projectId,
        assessmentRef:
          candidate.assessmentRef,
        evidenceBundleRef:
          candidate
            .evidenceBundleRef,
        targetAroRef:
          candidate.targetAroRef,
        modelRecommendation:
          candidate
            .modelRecommendation,
        gateDisposition:
          candidate.gateDisposition,
        gateReady:
          candidate.gateReady,
        requiredAssessmentCount:
          candidate
            .requiredAssessmentCount,
        incompleteAssessmentCount:
          candidate
            .incompleteAssessmentCount,
        indeterminateAssessmentCount:
          candidate
            .indeterminateAssessmentCount,
        contradictedAssessmentCount:
          candidate
            .contradictedAssessmentCount,
        blockingFindingCount:
          candidate
            .blockingFindingCount,
        ambiguityObserved:
          candidate.ambiguityObserved,
        missingEvidenceKindCount:
          candidate
            .missingEvidenceKindCount,
        reviewRequired: true,
        canonicalAdmissionAvailable:
          false,
        semanticTruthAssessed: true,
        semanticTruthCanonical: false,
        canonicalAdmissionEffect:
          false,
        workspaceMutationEffect: false,
        remoteMutationEffect: false,
        closureCertified: false,
        canonical: false,
        grantsAuthority: false,
        createdAt: candidate.createdAt,
      }));
  const projectedAroSemanticVerificationRuns =
    aroSemanticVerificationRuns
      .map((run) => ({
        schema:
          "direct_aro_semantic_verification_run_projection@1",
        runRef: {
          kind:
            "aro_semantic_verification_run",
          id: run.runId,
          digest: run.digest,
          projectId: run.projectId,
        },
        projectId: run.projectId,
        evidenceBundleRef:
          run.evidenceBundleRef,
        attempt: run.attempt,
        state: run.state,
        assessmentRef:
          run.assessmentRef,
        closureCandidateRef:
          run.closureCandidateRef,
        openDecisionRefs:
          run.openDecisionRefs,
        error: run.error,
        retryable: run.retryable,
        semanticTruthAssessed:
          run.semanticTruthAssessed,
        semanticTruthCanonical: false,
        sourceInspectionEffect: false,
        toolExecutionEffect: false,
        workspaceMutationEffect: false,
        remoteMutationEffect: false,
        canonicalAdmissionEffect:
          false,
        canonicalAdmissionAvailable:
          false,
        closureCertified: false,
        canonical: false,
        grantsAuthority: false,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }));
  const aroRegistry = {
    schema:
      "direct_aro_registry_projection@1",
    candidates:
      aroReconstructionCandidates,
    canonicalAros:
      abstractReasoningObjects,
    coverageWitnesses:
      aroCoverageWitnesses,
    currentTargetComparisons:
      aroCurrentTargetComparisons,
    reviewReceipts:
      aroReviewReceipts.slice(0, 40),
    admissionReceipts:
      aroAdmissionReceipts.slice(0, 40),
    repositorySnapshots:
      projectedRepositorySnapshots,
    reconstructionRuns:
      projectedAroReconstructionRuns,
    targetDefinitionRuns:
      projectedAroTargetDefinitionRuns,
    targetDefinitionAvailable:
      input
        .aroTargetDefinitionAvailable ===
      true,
    mutationContracts:
      projectedAroMutationContracts,
    mutationCompilationRuns:
      projectedAroMutationRuns,
    mutationCompilationAvailable:
      input
        .aroMutationCompilationAvailable ===
      true,
    realizationContextImports:
      projectedAroRealizationContextImports,
    realizationMappingWitnesses:
      projectedAroRealizationMappingWitnesses,
    realizationMappingRuns:
      projectedAroRealizationMappingRuns,
    realizationMappingAvailable:
      input
        .aroRealizationMappingAvailable ===
      true,
    workerSourceFreshness:
      projectedAroWorkerSourceFreshness,
    workerCapabilityObservations:
      projectedAroWorkerCapabilities,
    workerReviewReceipts:
      projectedAroWorkerReviews,
    workerConstitutions:
      projectedAroWorkerConstitutions,
    workerAuthorizations:
      projectedAroWorkerAuthorizations,
    workerHandoffRuns:
      projectedAroWorkerHandoffRuns,
    workerHandoffAvailable:
      input
        .aroWorkerHandoffAvailable ===
      true,
    executionEvidenceBundles:
      projectedAroExecutionEvidenceBundles,
    executionEvidenceRuns:
      projectedAroExecutionEvidenceRuns,
    executionEvidenceAvailable:
      input
        .aroExecutionEvidenceAvailable ===
      true,
    semanticVerificationAssessments:
      projectedAroSemanticVerificationAssessments,
    closureCandidates:
      projectedAroClosureCandidates,
    semanticVerificationRuns:
      projectedAroSemanticVerificationRuns,
    semanticVerificationAvailable:
      input
        .aroSemanticVerificationAvailable ===
      true,
    mutationExecutionAvailable: false,
    runningReconstructionCount:
      projectedAroReconstructionRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    failedReconstructionCount:
      projectedAroReconstructionRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length,
    runningTargetDefinitionCount:
      projectedAroTargetDefinitionRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    failedTargetDefinitionCount:
      projectedAroTargetDefinitionRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length,
    runningMutationCompilationCount:
      projectedAroMutationRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    failedMutationCompilationCount:
      projectedAroMutationRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length,
    runningRealizationMappingCount:
      projectedAroRealizationMappingRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    failedRealizationMappingCount:
      projectedAroRealizationMappingRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length,
    runningWorkerHandoffCount:
      projectedAroWorkerHandoffRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    failedWorkerHandoffCount:
      projectedAroWorkerHandoffRuns
        .filter((run) =>
          ["blocked", "failed"].includes(
            run.state,
          )).length,
    handedOffWorkerCount:
      projectedAroWorkerHandoffRuns
        .filter((run) =>
          run.state === "handed_off")
        .length,
    runningExecutionEvidenceCount:
      projectedAroExecutionEvidenceRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    observingExecutionEvidenceCount:
      projectedAroExecutionEvidenceRuns
        .filter((run) =>
          run.state === "observing")
        .length,
    acquiredExecutionEvidenceCount:
      projectedAroExecutionEvidenceRuns
        .filter((run) =>
          run.state === "acquired")
        .length,
    failedExecutionEvidenceCount:
      projectedAroExecutionEvidenceRuns
        .filter((run) =>
          run.state === "failed")
        .length,
    runningSemanticVerificationCount:
      projectedAroSemanticVerificationRuns
        .filter((run) =>
          ["scheduled", "running"].includes(
            run.state,
          )).length,
    completedSemanticVerificationCount:
      projectedAroSemanticVerificationRuns
        .filter((run) =>
          run.state === "completed")
        .length,
    failedSemanticVerificationCount:
      projectedAroSemanticVerificationRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length,
    automaticScheduling:
      input
        .aroReconstructionAutomaticSchedulingAvailable ===
      true,
    candidateCount:
      aroReconstructionCandidates.filter((candidate) =>
        candidate.lifecycle === "candidate").length,
    canonicalAroCount:
      abstractReasoningObjects.length,
    actionRequiredCount:
      aroReconstructionCandidates.filter((candidate) =>
        candidate.lifecycle === "candidate").length +
      projectedAroReconstructionRuns.filter(
        (run) =>
          ["failed", "remanded"].includes(
            run.state,
          ),
      ).length +
      projectedAroTargetDefinitionRuns.filter(
        (run) =>
          ["failed", "remanded"].includes(
            run.state,
          ),
      ).length +
      projectedAroMutationRuns.filter(
        (run) =>
          ["failed", "remanded"].includes(
            run.state,
          ),
      ).length +
      projectedAroRealizationMappingRuns
        .filter(
          (run) =>
            ["failed", "remanded"].includes(
              run.state,
            ),
      ).length +
      projectedAroWorkerHandoffRuns
        .filter((run) =>
          ["blocked", "failed"].includes(
            run.state,
          )).length +
      projectedAroExecutionEvidenceRuns
        .filter((run) =>
          run.state === "failed" ||
          run.ambiguityObserved ||
          run.missingEvidenceKindCount >
            0).length +
      projectedAroSemanticVerificationRuns
        .filter((run) =>
          ["failed", "remanded"].includes(
            run.state,
          )).length +
      projectedAroClosureCandidates
        .filter((candidate) =>
          candidate.gateReady !== true)
        .length,
    reconstructionAuthoredByRenderer: false,
    reviewValidatesSemanticTruth: false,
    admissionMutatesCode: false,
    mutationContractLaunchesWorker:
      false,
    mutationContractMutatesCode: false,
    realizationMappingLaunchesWorker:
      false,
    realizationMappingMutatesCode:
      false,
    workerHandoffMayStartProvider:
      input
        .aroWorkerHandoffAvailable ===
      true,
    workerHandoffMutatesCode:
      false,
    executionEvidenceMutatesCode:
      false,
    executionEvidenceValidatesSemanticTruth:
      false,
    executionEvidenceCertifiesClosure:
      false,
    semanticVerificationExecutesTools:
      false,
    semanticVerificationMutatesCode:
      false,
    semanticVerificationAdmitsCanonicalTruth:
      false,
    semanticVerificationCertifiesClosure:
      false,
    canonicalClosureAdmissionAvailable:
      false,
    workspaceEffectsExecuted:
      projectedAroExecutionEvidenceBundles
        .some((bundle) =>
          bundle
            .workspaceMutationObserved),
    workspaceEffectsObserved:
      projectedAroExecutionEvidenceBundles
        .some((bundle) =>
          bundle
            .workspaceMutationObserved),
    downstreamEffectsExecuted: false,
    canonical: false,
    grantsAuthority: false,
  };
  const trustedThoughtBrushRegistry =
    thoughtBrushRegistry();
  const projectedThoughtBrushStrokes =
    thoughtBrushStrokes
      .slice(0, 80)
      .map((stroke) => ({
        schema:
          "direct_thought_brush_stroke_projection@1",
        brushStrokeRef:
          thoughtBrushStrokeRef(
            stroke,
          ),
        projectId:
          stroke.projectId,
        targetProjectId:
          stroke.targetProjectId,
        brush: stroke.brush,
        state: stroke.state,
        summary:
          boundedString(
            stroke.result?.summary ||
              stroke.error?.message,
            stroke.state,
            2_400,
          ),
        altitude:
          stroke.result?.altitude ||
          stroke.request.altitude,
        selectedAnchorCount:
          stroke.result
            ?.selectedAnchorKeys
            ?.length || 0,
        selectedContextCount:
          stroke.result
            ?.selectedContextKeys
            ?.length || 0,
        resultObjectCount:
          stroke.result
            ?.resultObjects
            ?.length || 0,
        candidateInsightCount:
          stroke.result
            ?.candidateInsights
            ?.length || 0,
        omissionCount:
          stroke.result
            ?.omissions
            ?.length || 0,
        preservationSatisfied:
          stroke.validation
            ?.preservationSatisfied ===
          true,
        switchReplacementSatisfied:
          stroke.validation
            ?.switchReplacementSatisfied ===
          true,
        error: stroke.error,
        persistencePosture:
          "temporary_canvas",
        worldEffect: "none",
        toolExecutionEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect:
          false,
        canonical: false,
        grantsAuthority: false,
        createdAt:
          stroke.createdAt,
      }));
  const projectedContextCanvases =
    contextCanvases.map((canvas) => {
      const canvasExactRef =
        contextCanvasRef(canvas);
      return {
        schema:
          "direct_context_canvas_projection@1",
        contextCanvasRef:
          canvasExactRef,
        ownerId: canvas.ownerId,
        projectId: canvas.projectId,
        activeProjectId:
          canvas.activeProjectId,
        revision: canvas.revision,
        predecessorRef:
          canvas.predecessorRef,
        restoredCanvasRef:
          canvas.restoredCanvasRef,
        operationKind:
          canvas.operationKind,
        operationRef:
          canvas.operationRef,
        baseOperationalMetaContextRef:
          canvas
            .baseOperationalMetaContextRef,
        brushStrokeRefs:
          canvas.brushStrokeRefs,
        activeAnchorRefs:
          canvas.activeAnchorRefs,
        importedContextBundleRefs:
          canvas
            .importedContextBundleRefs,
        altitude: canvas.altitude,
        temporarySemanticObjects:
          canvas
            .temporarySemanticObjects
            .map((object) => ({
              schema: object.schema,
              temporaryObjectId:
                object
                  .temporaryObjectId,
              objectKey:
                object.objectKey,
              objectKind:
                object.objectKind,
              label:
                boundedString(
                  object.label,
                  "",
                  300,
                ),
              summary:
                boundedString(
                  object.summary,
                  "",
                  2_400,
                ),
              sourceRefs:
                object.sourceRefs,
              relationHints:
                object
                  .relationHints,
              temporaryPosture:
                object
                  .temporaryPosture,
              brushStrokeRef:
                object
                  .brushStrokeRef,
              digest:
                object.digest,
              canonical: false,
              worldEffect: "none",
              grantsAuthority: false,
            })),
        candidateInsights:
          canvas.candidateInsights
            .map((insight) => {
              const extracted =
                aroReconstructionCandidates
                  .find((candidate) =>
                    candidate
                      .reconstructionMethod ===
                      "thought_brush_candidate_insight" &&
                    candidate.projectId ===
                      canvas
                        .activeProjectId &&
                    candidate.candidateAro
                      .conceptKey ===
                      insight.conceptKey &&
                    candidate.evidenceRefs
                      .some((ref) =>
                        ref.kind ===
                          "context_canvas" &&
                        ref.id ===
                          canvas
                            .contextCanvasId));
              return {
                schema:
                  insight.schema,
                candidateInsightId:
                  insight
                    .candidateInsightId,
                insightKey:
                  insight.insightKey,
                conceptKey:
                  insight.conceptKey,
                semanticIdentity:
                  insight
                    .semanticIdentity,
                purpose:
                  insight.purpose,
                rationale:
                  insight.rationale,
                sourceRefs:
                  insight.sourceRefs,
                branchCount:
                  insight
                    .branches.length,
                edgeCount:
                  insight.edges.length,
                branches:
                  insight.branches,
                edges: insight.edges,
                brushStrokeRef:
                  insight
                    .brushStrokeRef,
                extractionState:
                  extracted
                    ? "extracted"
                    : "available",
                extractedAroCandidateRef:
                  extracted
                    ? {
                        kind:
                          "aro_reconstruction_candidate",
                        id:
                          extracted
                            .candidateId,
                        digest:
                          extracted
                            .digest,
                        projectId:
                          extracted
                            .projectId,
                      }
                    : null,
                digest:
                  insight.digest,
                canonical: false,
                worldEffect: "none",
                grantsAuthority: false,
              };
            }),
        preservationRules:
          canvas.preservationRules,
        estimatedAttentionCost:
          canvas
            .estimatedAttentionCost,
        freshness:
          canvas.freshness,
        undoAvailable:
          canvas.revision > 1,
        persistencePosture:
          "temporary",
        worldEffect: "none",
        canonicalAdmissionEffect:
          false,
        workspaceMutationEffect:
          false,
        canonical: false,
        grantsAuthority: false,
        createdAt:
          canvas.createdAt,
      };
    });
  const activeContextCanvas =
    projectedContextCanvases
      .find((canvas) =>
        canvas.activeProjectId ===
          focusedProjectId) ||
    projectedContextCanvases[0] ||
    null;
  const contextCanvas = {
    schema:
      "direct_context_canvas_workbench_projection@1",
    registry:
      trustedThoughtBrushRegistry,
    canvases:
      projectedContextCanvases,
    activeCanvas:
      activeContextCanvas,
    strokes:
      projectedThoughtBrushStrokes,
    available:
      input.thoughtBrushAvailable ===
        true,
    canvasCount:
      projectedContextCanvases.length,
    activeStrokeCount:
      activeContextCanvas
        ?.brushStrokeRefs
        ?.length || 0,
    temporaryObjectCount:
      projectedContextCanvases
        .reduce(
          (sum, canvas) =>
            sum +
            canvas
              .temporarySemanticObjects
              .length,
          0,
        ),
    candidateInsightCount:
      projectedContextCanvases
        .reduce(
          (sum, canvas) =>
            sum +
            canvas
              .candidateInsights
              .filter((insight) =>
                insight
                  .extractionState ===
                "available")
              .length,
          0,
        ),
    compositionAvailable: true,
    undoAvailable:
      Boolean(
        activeContextCanvas
          ?.undoAvailable,
      ),
    switchReplacesContext: true,
    brushResultsTemporary: true,
    insightExtractionCreatesCandidateOnly:
      true,
    canonicalAdmissionAvailable:
      false,
    workspaceMutationAvailable:
      false,
    persistencePosture:
      "temporary_reversible",
    worldEffect: "none",
    canonical: false,
    grantsAuthority: false,
  };
  const projectSubstrate = {
    schema: "direct_project_substrate_projection@1",
    provisioningAvailable:
      input.projectSubstrateProvisioningAvailable === true,
    bindingCount: projectWorkspaceBindings.length,
    readyBindingCount: projectWorkspaceBindings.filter((binding) =>
      probeById.get(binding.probeRef?.id)?.probeState === "ready").length,
    threadBindingCount: threadEnvironmentBindings.length,
    stepSnapshotCount: stepEnvironmentSnapshots.length,
    childInheritanceCount: childEnvironmentInheritances.length,
    bindings: projectWorkspaceBindings.map((binding) => ({
      projectId: binding.projectId,
      bindingRef: {
        kind: "project_workspace_binding",
        id: binding.workspaceBindingId,
        digest: binding.digest,
        projectId: binding.projectId,
      },
      environmentId: binding.environmentId,
      workspaceKind: binding.workspaceKind,
      workspaceLabel: binding.workspaceLabel,
      adapterKind: binding.adapterKind,
      probeState:
        probeById.get(binding.probeRef?.id)?.probeState || "unknown",
      runtimeDefaultBindingRef: binding.runtimeDefaultBindingRef,
      createdAt: binding.createdAt,
      canonical: true,
      grantsAuthority: false,
    })),
    threadBindings: threadEnvironmentBindings.map((binding) => ({
      bindingRef: {
        kind: "thread_environment_binding",
        id: binding.threadEnvironmentBindingId,
        digest: binding.digest,
        projectId: binding.projectId,
      },
      projectId: binding.projectId,
      threadId: binding.threadId,
      workThreadId: binding.workThreadId,
      primaryEnvironmentId: binding.primaryEnvironmentId,
      selectedEnvironmentIds: binding.selectedEnvironmentIds,
      inheritanceRule: binding.inheritanceRule,
      inheritedFromStepSnapshotRef:
        binding.inheritedFromStepSnapshotRef,
      immutableForThreadLifetime: true,
      canonical: true,
      grantsAuthority: false,
    })),
    stepSnapshots: stepEnvironmentSnapshots.map((snapshot) => ({
      snapshotRef: {
        kind: "step_environment_snapshot",
        id: snapshot.stepEnvironmentSnapshotId,
        digest: snapshot.digest,
        projectId: snapshot.projectId,
      },
      projectId: snapshot.projectId,
      threadId: snapshot.threadId,
      stepId: snapshot.stepId,
      primaryEnvironmentId: snapshot.primaryEnvironmentId,
      selectedEnvironmentIds: snapshot.selectedEnvironmentIds,
      readyEnvironmentIds: snapshot.readyEnvironments.map((entry) =>
        entry.environmentId),
      exactForStep: true,
      canonical: true,
      grantsAuthority: false,
    })),
    childInheritances: childEnvironmentInheritances.map((inheritance) => ({
      inheritanceRef: {
        kind: "child_environment_inheritance",
        id: inheritance.inheritanceId,
        digest: inheritance.digest,
        projectId: inheritance.projectId,
      },
      projectId: inheritance.projectId,
      parentThreadId: inheritance.parentThreadId,
      childThreadId: inheritance.childThreadId,
      inheritedEnvironmentIds: inheritance.inheritedEnvironmentIds,
      sourceStepSnapshotRef:
        inheritance.parentStepEnvironmentSnapshotRef,
      ambientProjectDefaultReevaluated: false,
      canonical: true,
      grantsAuthority: false,
    })),
    latestWorkspaceBindingRef: latestWorkspaceBinding
      ? {
          kind: "project_workspace_binding",
          id: latestWorkspaceBinding.workspaceBindingId,
          digest: latestWorkspaceBinding.digest,
          projectId: latestWorkspaceBinding.projectId,
        }
      : null,
    rawWorkspaceLocatorExposed: false,
    adapterAuthority: "execution_only",
    portOperationRequiredForDefaultChange: true,
    canonical: false,
    grantsAuthority: false,
  };
  const semanticSurface =
    compileSemanticSurfaceProjection({
      projectionRevision:
        Number(input.projectionRevision || 0),
      activeProjectId: focusedProjectId,
      projects,
      openDecisions: typedOpenDecisions,
      staleDecisions:
        typedStaleDecisions,
      projectCandidates:
        projectedProjectGenesisCandidates,
      projectConstitutions:
        projectedProjectConstitutions,
      decisionTransitionReceipts:
        projectedDecisionTransitions,
      aroReconstructionCandidates,
      abstractReasoningObjects,
      aroCoverageWitnesses,
      aroCurrentTargetComparisons,
    });
  const projection = {
    schema: WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA,
    pipelineStage,
    projectionRevision: Number(input.projectionRevision || 0),
    revision: Number(input.projectionRevision || 0),
    ledgerHeadDigest: normalizeString(input.ledgerHeadDigest, ""),
    mode: "production",
    lifecycleState,
    lifecycleLabel,
    busy:
      splitRunning ||
      k4Running ||
      latestReconciliation?.state === "processing",
    activeProjectId: focusedProjectId,
    worldPosture: {
      state: lifecycleState,
      title: clarificationCount
        ? "The WorldManager needs a scope decision"
        : splitAttentionRequired
          ? "A compound turn completed with unresolved child work"
        : splitRunning
          ? "The WorldManager is coordinating one compound turn"
        : pipelineStage === K6_GENESIS_STAGE &&
            latestProjectConstitution
          ? latestWorkspaceBinding
            ? "Project substrate is bound to its native environment"
            : "Project constitution admitted · provisioning remains"
        : pipelineStage === K6_GENESIS_STAGE &&
            latestProjectGenesisCandidate
          ? "Project constitution candidate ready for review"
        : pipelineStage === K5_PLANNING_STAGE &&
            latestImplementationContract &&
            planPostureVisible
          ? "Canonical plan admitted · worker start remains pending"
        : pipelineStage === K5_PLANNING_STAGE &&
            latestPlanProposal &&
            planPostureVisible
          ? "Reconciled plan proposal ready for exact review"
        : roleRuntimeStage &&
            latestReconciliation?.state === "reconciled"
          ? "One coherent response, reconciled at world level"
        : roleRuntimeStage && latestManagerResult
          ? "The manager response is visible and non-canonical"
        : compiledAgentWorldCount
          ? "The bounded agent world is validated"
          : preparedContextCount
            ? "Graph-first manager context is ready"
          : "The keyboard settlement plane is ready",
      summary: clarificationCount
        ? "K3 stopped before policy and role compilation because the current message did not establish an exact lawful target."
        : splitAttentionRequired
          ? `${latestSplitCoordination.summary} The unified response remains visible, while incomplete child outcomes remain inspectable and non-canonical.`
        : splitRunning
          ? latestSplitCoordination.summary
        : pipelineStage === K6_GENESIS_STAGE &&
            latestProjectConstitution
          ? latestWorkspaceBinding
            ? "The admitted runtime default is bound to a native workspace, its resident Direct adapter passed the harmless identity probe, and the environment was frozen into an immutable WorkThread binding and exact step snapshot. Authoritative project-world graph activation is not claimed yet."
            : "The operator admitted the semantic project constitution and immutable runtime default. No workspace or executor activation is claimed yet."
        : pipelineStage === K6_GENESIS_STAGE &&
            latestProjectGenesisCandidate
          ? "The recommendation is advisory and grounded in a harness-observed realization snapshot. Evidence review and explicit admission remain required."
        : pipelineStage === K5_PLANNING_STAGE &&
            latestImplementationContract &&
            planPostureVisible
          ? "The exact plan revision is canonical and its implementation contract is persisted. The WorkThread is contract_received; implementation has not started."
        : pipelineStage === K5_PLANNING_STAGE &&
            latestPlanProposal &&
            planPostureVisible
          ? "The Project Manager response and WorldManager reconciliation are preserved as one candidate lineage. Review and admission remain explicit, and no canonical or execution effect has occurred."
        : roleRuntimeStage &&
            latestReconciliation?.state === "reconciled"
          ? "The same typed AgentResult was rendered immediately, delivered through the semantic inbox, and assessed by a persisted WorldManager Direct turn. No proposal or canonical state was created."
        : roleRuntimeStage && latestManagerResult
          ? selfContainedWorldManagerResponse
            ? selfContainedWorldManagerResponseCompleted
              ? "The terminal natural-language message anchors a typed AgentResult. No recursive WorldManager reconciliation is required for this world-scoped response."
              : "The WorldManager role result remains visible at world scope. Its failure or remand is not sent into a recursive WorldManager reconciliation turn."
            : "The terminal assistant message anchors a typed AgentResult. Deterministic telemetry remains separate, and WorldManager reconciliation is advisory."
        : compiledAgentWorldCount
          ? "K3 has compiled the operative policy closure, trusted role template, capability and authority envelopes, role response contract, and fail-closed agreement witness. This is validated preparation, not agent execution."
          : preparedContextCount
            ? "K2 has settled the task, selected the responsible manager role, and prepared a bounded graph projection. K3 compilation has not completed."
            : "K3 can settle typed intent, compute a task constitution, and compile a non-executing agent world.",
      semanticSettlement: semanticIngressAvailable
        ? "available"
        : "unavailable",
      agentWorldCompilation: "available",
      providerRoleRuntime:
        roleRuntimeStage ? "available" : "not_started",
      worldmodelBindingState: graphBinding?.state || bootstrap.worldmodelBindingState,
      grantsAuthority: false,
    },
    projects,
    projectSubstrate,
    projectEcology: {
      schema:
        "direct_world_manager_project_ecology_projection@1",
      projectCount: projects.length,
      projectIdentityCount: projects.length,
      establishedProjectCount:
        projects.filter((project) =>
          project.inspectionPosture !==
            "semantic_candidate").length,
      candidateProjectCount:
        projects.filter((project) =>
          project.inspectionPosture ===
            "semantic_candidate").length,
      runtimeProjectCount: projects.filter((project) =>
        project.focusEligible).length,
      semanticConstitutionCount: projects.filter((project) =>
        project.inspectionPosture ===
          "semantic_constitution").length,
      provisionedConstitutionCount: projects.filter((project) =>
        project.inspectionPosture ===
          "provisioned_constitution").length,
      preservedProjectSeedCount:
        projectSeedProjections.length,
      projectSeeds: projectSeedProjections,
      canonical: false,
      grantsAuthority: false,
    },
    semanticArtifactKernel: {
      schema:
        "direct_semantic_artifact_kernel_projection@1",
      state: semanticArtifactKernelAvailable
        ? "available"
        : "legacy_fallback",
      currentArtifactCount:
        semanticArtifacts.length,
      currentOpenDecisionCount:
        typedOpenDecisions.length,
      staleDecisionCount:
        typedStaleDecisions.length,
      resolvedDecisionCount:
        semanticArtifacts.filter((artifact) =>
          artifact?.schema ===
            "direct_open_decision@1" &&
          artifact.decisionState ===
            "resolved").length,
      supportedArtifactKinds: [
        "open_decision",
      ],
      supportedResolutionModes: [
        "mechanical",
        "semantic_relay",
        "evidence_request",
        "authority_request",
      ],
      transitionExecution:
        "available_wm_sc5",
      transitionCount:
        decisionTransitions.length,
      canonical: false,
      grantsAuthority: false,
    },
    aroRegistry,
    contextCanvas,
    decisionSummary: {
      schema:
        "direct_world_manager_decision_summary_projection@1",
      actionRequiredCount:
        semanticArtifactKernelAvailable
          ? typedOpenDecisions.length
          : candidateOpenDecisions.length +
            currentClarifications.length,
      openDecisions:
        semanticArtifactKernelAvailable
          ? typedOpenDecisions
          : [
              ...currentClarifications,
              ...candidateOpenDecisions,
            ],
      candidateOpenDecisions,
      currentClarifications,
      operationalGateDecisions,
      staleDecisions:
        typedStaleDecisions,
      recentTransitions:
        projectedDecisionTransitions,
      historicalRemands,
      historicalRemandsCountedAsOpen: false,
      migrationPosture:
        semanticArtifactKernelAvailable
          ? "sc3_canonical_registry"
          : "legacy_projection_fallback",
      kernelSchema:
        "direct_semantic_artifact_decision_kernel@1",
      transitionExecution:
        "available_wm_sc5",
      canonical: false,
      grantsAuthority: false,
    },
    semanticSurface,
    messages: projectedMessages,
    activeLineages: userIngressEvents.map((event) => {
      const semanticIngress =
        semanticIngressByEventId.get(event.semanticEventId);
      const settlement = settlementByEventId.get(event.semanticEventId);
      const routingDecision =
        routingDecisionByEventId.get(
          event.semanticEventId,
        );
      const context = contextByEventId.get(event.semanticEventId);
      const agentWorld = agentWorldByEventId.get(event.semanticEventId);
      const operationalMetaContext =
        operationalMetaContextByEventId.get(
          event.semanticEventId,
        );
      const resultRecord = managerResultByEventId.get(
        event.semanticEventId,
      );
      const reconciliation = reconciliationByEventId.get(
        event.semanticEventId,
      );
      const roleRun = roleRunByEventId.get(event.semanticEventId);
      const splitCoordination =
        splitCoordinationByParentEventId.get(
          event.semanticEventId,
        ) || null;
      const projectCandidate = candidateBySourceEventId.get(
        event.semanticEventId,
      );
      return {
        semanticEventId: event.semanticEventId,
        lineageRootId: event.lineageRootId,
        projectId: settlement?.projectId || event.projectId,
        state:
          splitCoordination &&
          [
            "partially_remanded",
            "remanded",
            "failed",
            "interrupted",
          ].includes(splitCoordination.state)
            ? splitCoordination.state
        : projectCandidate?.lifecycle === "admitted"
          ? "constitution_admitted"
          : projectCandidate?.lifecycle === "candidate"
            ? projectCandidate.evidenceReviewState === "reviewed"
              ? "candidate_reviewed"
              : "candidate_ready"
        : reconciliation?.state === "reconciled"
          ? "reconciled"
          : reconciliation?.state === "processing"
            ? "reconciling"
          : ["failed", "remanded", "interrupted"].includes(
              reconciliation?.state,
            )
            ? reconciliation.state
          : resultRecord
            ? resultRecord.agentResult.resultState
          : roleRun && ["starting", "running"].includes(roleRun.state)
            ? "role_running"
          : roleRun?.state === "interrupted"
            ? "interrupted"
        : splitCoordination
          ? splitCoordination.state === "materialized"
            ? "split_materialized"
            : splitCoordination.state === "executing"
              ? "split_executing"
              : splitCoordination.state === "joining"
                ? "split_joining"
                : splitCoordination.state
        : agentWorld
          ? "agent_world_ready"
          : context
            ? "context_ready"
          : settlement?.state || "awaiting_settlement",
        taskType: settlement?.taskType || "",
        responsibleRole: settlement?.responsibleRole || "",
        semanticIngressRunId:
          semanticIngress?.semanticIngressRunId || "",
        semanticLane:
          semanticIngress?.semanticSettlement
            ?.laneAssignments?.find((entry) =>
              entry.posture === "primary")?.laneId || "",
        operationalMetaContextRef:
          operationalMetaContext
            ?.operationalMetaContextRef || null,
        operationalMetaContextFreshness:
          operationalMetaContext?.freshness || "",
          contextRequestManifestLinkState:
          operationalMetaContext
            ?.requestManifestLinkState || "",
        anatomyFacts: {
          settlementState:
            settlement?.state || "",
          routingDecision:
            routingDecision
              ?.decision || "",
          selectedRole:
            routingDecision
              ?.selectedRole || "",
          sourceShelfCount:
            Number(
              operationalMetaContext
                ?.sourceShelfCount || 0,
            ),
          selectedEventCount:
            Number(
              operationalMetaContext
                ?.selectedEventCount || 0,
            ),
          selectedSemanticObjectCount:
            Number(
              operationalMetaContext
                ?.selectedSemanticObjectCount ||
                0,
            ),
          estimatedInputTokens:
            Number(
              operationalMetaContext
                ?.estimatedInputTokens || 0,
            ),
          contextTruncated:
            operationalMetaContext
              ?.truncated === true,
          roleTemplateId:
            agentWorld
              ?.roleTemplateId || "",
          policyClosureState:
            agentWorld
              ?.policyClosureState || "",
          requiredActionClasses:
            agentWorld
              ?.requiredActionClasses ||
            [],
          permittedActionClasses:
            agentWorld
              ?.permittedActionClasses ||
            [],
          prohibitedActionClasses:
            agentWorld
              ?.prohibitedActionClasses ||
            [],
          toolCount:
            Number(
              agentWorld?.toolCount || 0,
            ),
          launchBoundary:
            agentWorld
              ?.launchBoundary || "",
          projectionAgreementState:
            agentWorld
              ?.projectionAgreementState ||
            "",
          roleRunState:
            roleRun?.state || "",
          directSessionId:
            roleRun
              ?.directSessionId || "",
          directTurnId:
            roleRun
              ?.directTurnId || "",
          requestManifestId:
            roleRun
              ?.requestManifestId || "",
          agentResultState:
            resultRecord
              ?.agentResult
              ?.resultState || "",
          outputContractState:
            resultRecord
              ?.agentResult
              ?.outputContractState ||
            "",
          runtimeEnvironment:
            resultRecord
              ?.telemetry
              ?.environment || "",
          runtimeModel:
            resultRecord
              ?.telemetry?.model || "",
          toolCallCount:
            Number(
              resultRecord
                ?.telemetry
                ?.toolCallCount || 0,
            ),
          effectCount:
            Number(
              resultRecord
                ?.telemetry
                ?.effectCount || 0,
            ),
          filesTouched:
            resultRecord
              ?.telemetry
              ?.filesTouched || [],
          reconciliationState:
            reconciliation?.state || "",
          candidateLifecycle:
            projectCandidate
              ?.lifecycle || "",
          candidateEvidenceReviewState:
            projectCandidate
              ?.evidenceReviewState || "",
          constitutionState:
            projectCandidate?.lifecycle ===
              "admitted"
              ? "canonical"
              : projectCandidate
                ? "candidate"
                : "",
          activationState:
            projectCandidate
              ?.activationState || "",
          workspaceProvisioned:
            false,
          workerExecutionAvailable:
            false,
        },
        anatomyRefs: {
          semanticIngressRef:
            optionalProjectionRef(
              "semantic_ingress_run",
              semanticIngress
                ?.semanticIngressRunId,
              semanticIngress?.digest,
              "Native semantic ingress run",
            ),
          taskSettlementRef:
            optionalProjectionRef(
              "task_settlement",
              settlement
                ?.taskSettlementId,
              settlement?.digest,
              "Typed task settlement",
            ),
          routingDecisionRef:
            optionalProjectionRef(
              "routing_decision",
              settlement
                ? routingDecision
                    ?.routingDecisionId
                : "",
              settlement
                ? routingDecision
                    ?.digest
                : "",
              "WorldManager routing decision",
            ),
          managerContextRef:
            optionalProjectionRef(
              "world_manager_context_bundle",
              context?.contextBundleId,
              context?.digest,
              "Graph-first manager context",
            ),
          graphRef:
            context?.graphRef || null,
          graphProjectionRef:
            context?.projectionRef ||
            agentWorld
              ?.graphProjectionRef ||
            null,
          managerBootPacketRef:
            context?.bootPacketRef ||
            agentWorld?.bootPacketRef ||
            null,
          contextRequirementSetRef:
            operationalMetaContext
              ?.contextRequirementSetRef ||
            null,
          contextImportRef:
            operationalMetaContext
              ?.contextImportRef ||
            null,
          contextBundleRef:
            operationalMetaContext
              ?.contextBundleRef ||
            null,
          operationalMetaContextRef:
            operationalMetaContext
              ?.operationalMetaContextRef ||
            null,
          selectionWitnessRef:
            operationalMetaContext
              ?.selectionWitnessRef ||
            null,
          agentWorldCompilationRef:
            optionalProjectionRef(
              "agent_world_compilation",
              agentWorld
                ?.agentWorldCompilationId,
              agentWorld
                ?.agentWorldCompilationDigest,
              "Compiled bounded agent world",
            ),
          agentInstantiationRef:
            optionalProjectionRef(
              "agent_instantiation",
              agentWorld
                ?.agentInstantiationId,
              agentWorld
                ?.agentInstantiationDigest,
              "Agent instantiation",
            ),
          taskConstitutionRef:
            optionalProjectionRef(
              "task_constitution",
              agentWorld
                ?.taskConstitutionId,
              agentWorld
                ?.taskConstitutionDigest,
              "Resolved task constitution",
            ),
          roleRunRef:
            optionalProjectionRef(
              "direct_role_run",
              roleRun?.runId,
              roleRun?.digest,
              "Persisted Direct role run",
            ),
          agentResultRef:
            optionalProjectionRef(
              "agent_result",
              resultRecord
                ?.agentResult
                ?.agentResultId,
              resultRecord
                ?.agentResult
                ?.digest,
              "Terminal typed AgentResult",
            ),
          reconciliationRef:
            optionalProjectionRef(
              "world_manager_reconciliation",
              reconciliation
                ?.reconciliationId,
              reconciliation?.digest,
              "WorldManager reconciliation",
            ),
          splitCoordinationRef:
            optionalProjectionRef(
              "semantic_split_coordination",
              splitCoordination
                ?.coordinationId,
              splitCoordination?.digest,
              "Semantic child coordination",
            ),
          projectCandidateRef:
            optionalProjectionRef(
              "project_constitution_candidate",
              projectCandidate
                ?.candidateId,
              projectCandidate?.digest,
              "Project constitution candidate",
            ),
        },
        rendererSafeSummary: event.rendererSafeSummary,
        eventDigest: event.eventDigest,
      };
    }),
    candidateArtifacts: projectGenesisCandidates.map((candidate) => ({
      schema: candidate.schema,
      candidateId: candidate.candidateId,
      artifactKind: candidate.artifactKind,
      proposedProjectId: candidate.proposedProjectId,
      identity: candidate.identity,
      purpose: candidate.purpose,
      semanticSummary: candidate.semanticSummary,
      primaryAgentEnvironmentId:
        candidate.primaryAgentEnvironmentId,
      allowedEnvironmentIds: candidate.allowedEnvironmentIds,
      gitAuthorityEnvironmentId:
        candidate.gitAuthorityEnvironmentId,
      rankedRecommendations: candidate.rankedRecommendations,
      openDecisions: candidate.openDecisions,
      evidenceReviewState: candidate.evidenceReviewState,
      reconciliationState: candidate.reconciliationState,
      lifecycle: candidate.lifecycle,
      activationState: candidate.activationState,
      revision: candidate.revision,
      createdAt: candidate.createdAt,
      canonical: false,
      grantsAuthority: false,
      digest: candidate.digest,
    })),
    pendingDecisions: pendingDecisions.map((decision) => ({
      decisionRequestId: decision.decisionRequestId,
      semanticEventId: decision.semanticEventId,
      decisionKind: decision.decisionKind,
      state: decision.state,
      targetArtifactRef: decision.targetArtifactRef,
      authorityRequirements: decision.authorityRequirements,
      grantsAuthority: false,
    })),
    semanticHistory: {
      schema:
        "direct_semantic_history_projection@1",
      state: "available",
      currentSettlementRevisionCount:
        semanticSettlementRevisions.length,
      activeRelationCount:
        semanticHistoryRelationRecords.length,
      currentShelfCount: semanticShelves.length,
      latestSettlementRevision:
        semanticSettlementRevisions.length
          ? {
              settlementRevisionId:
                semanticSettlementRevisions.at(-1)
                  .settlementRevisionId,
              semanticEventId:
                semanticSettlementRevisions.at(-1)
                  .semanticEventId,
              settlementRevision:
                semanticSettlementRevisions.at(-1)
                  .settlementRevision,
              provenancePosture:
                semanticSettlementRevisions.at(-1)
                  .provenancePosture,
              confidence:
                semanticSettlementRevisions.at(-1)
                  .confidence,
              digest:
                semanticSettlementRevisions.at(-1)
                  .digest,
            }
          : null,
      shelves: semanticShelves.map((shelf) => ({
        shelfId: shelf.shelfId,
        shelfKind: shelf.shelfKind,
        anchorRefs: shelf.anchorRefs,
        shelfRevision: shelf.shelfRevision,
        freshness: shelf.freshness,
        relationCount:
          shelf.relationRefs?.length || 0,
        sourceEventCount:
          shelf.sourceEventRefs?.length || 0,
        semanticObjectCount:
          shelf.semanticObjectRefs?.length || 0,
        omissions: shelf.omissions,
        sourceDigest: shelf.sourceDigest,
        digest: shelf.digest,
        grantsAuthority: false,
      })),
      grantsAuthority: false,
      rawTranscriptIncluded: false,
    },
    operationalMetaContext: {
      schema:
        "direct_operational_meta_context_projection@1",
      state: latestOperationalMetaContext
        ? latestOperationalMetaContext.freshness
        : "not_prepared",
      currentManifestCount:
        operationalMetaContexts.length,
      latest: latestOperationalMetaContext,
      contexts: operationalMetaContexts,
      importOperation: "IMPORT_CONTEXT",
      importAuthority:
        "harness_or_agent_requested_read_only",
      requestManifestLinkage:
        latestOperationalMetaContext
          ?.requestManifestLinkState ||
        "not_available",
      rawEvidenceIncluded: false,
      canonicalWorldstateMutation: false,
      grantsAuthority: false,
    },
    semanticSplit: latestSplitCoordination
      ? {
          schema:
            "direct_semantic_split_projection@1",
          coordinationId:
            latestSplitCoordination.coordinationId,
          parentSemanticEventId:
            latestSplitCoordination.parentEventRef.id,
          state: latestSplitCoordination.state,
          revision:
            latestSplitCoordination.revision,
          childCount:
            latestSplitCoordination.childEventRefs
              .length,
          childOutcomes:
            latestSplitCoordination.childOutcomes.map(
              (outcome) => ({
                childIndex: outcome.childIndex,
                childEventRef:
                  outcome.childEventRef,
                childContractRef:
                  outcome.childContractRef,
                state: outcome.state,
                summary: boundedString(
                  outcome.summary,
                  "",
                  640,
                ),
                semanticPrompt: boundedString(
                  semanticChildContractByEventId
                    .get(outcome.childEventRef.id)
                    ?.contract?.semanticPrompt,
                  "",
                  1_200,
                ),
                semanticTypeExpression:
                  semanticChildContractByEventId
                    .get(outcome.childEventRef.id)
                    ?.contract
                    ?.semanticTypeExpression ||
                  null,
                taskSettlementRef:
                  outcome.taskSettlementRef,
                agentResultRef:
                  outcome.agentResultRef,
                candidateArtifactRefs:
                  outcome.candidateArtifactRefs,
                recoveryPosture:
                  outcome.state === "remanded"
                    ? "retry_available"
                    : outcome.state === "completed"
                      ? "closed"
                      : "inspection_required",
              }),
            ),
          parentAgentResultRef:
            latestSplitCoordination
              .parentAgentResultRef,
          summary:
            latestSplitCoordination.summary,
          canonical: false,
          grantsAuthority: false,
          digest: latestSplitCoordination.digest,
        }
      : null,
    workThreads,
    selectedSemanticObject: latestManagerResult
      ? {
          kind: "agent_result",
          agentResultId:
            latestManagerResult.agentResult.agentResultId,
          semanticEventId:
            latestManagerResult.agentResult.semanticEventId,
          sourceSemanticEventId:
            latestManagerResult.agentResult.sourceSemanticEventId,
          resultState:
            latestManagerResult.agentResult.resultState,
          outputContractState:
            latestManagerResult.agentResult.outputContractState,
          digest: latestManagerResult.agentResult.digest,
        }
      : latestAgentWorldCompilation
      ? {
          kind: "agent_instantiation",
          agentInstantiationId:
            latestAgentWorldCompilation.agentInstantiationId,
          semanticEventId:
            latestAgentWorldCompilation.semanticEventId,
          roleTemplateId:
            latestAgentWorldCompilation.roleTemplateId,
          taskConstitutionId:
            latestAgentWorldCompilation.taskConstitutionId,
          projectionAgreementState:
            latestAgentWorldCompilation.projectionAgreementState,
          digest:
            latestAgentWorldCompilation.agentInstantiationDigest,
        }
      : latestSettlement
        ? {
            kind: "task_settlement",
          taskSettlementId: latestSettlement.taskSettlementId,
          semanticEventId: latestSettlement.semanticEventId,
          state: latestSettlement.state,
          projectId: latestSettlement.projectId,
          taskType: latestSettlement.taskType,
          responsibleRole: latestSettlement.responsibleRole,
          settlementTier: latestSettlement.settlementTier,
          digest: latestSettlement.digest,
          }
        : null,
    latestProposal: latestPlanProposal
      ? {
          proposalId: latestPlanProposal.proposalRevisionId,
          proposalRevisionId: latestPlanProposal.proposalRevisionId,
          proposalLineageId: latestPlanProposal.proposalLineageId,
          projectId: latestPlanProposal.projectId,
          revision: latestPlanProposal.revision,
          title: latestPlanProposal.title,
          summary: latestPlanProposal.summary,
          features: latestPlanProposal.features || [],
          state: latestPlanProposal.state === "candidate_reconciled"
            ? "candidate"
            : latestPlanProposal.state,
          reconciliationState: latestPlanProposal.reconciliationState,
          evidenceReviewState: latestPlanProposal.evidenceReviewState,
          supersededById: latestPlanProposal.supersededById || "",
          admissionState: latestPlanAdmission?.state || "not_requested",
          canonical: latestPlanProposal.state === "canonical",
          grantsAuthority: false,
          digest: latestPlanProposal.digest,
        }
      : null,
    latestProjectConstitutionCandidate:
      latestProjectGenesisCandidate
        ? {
            candidateId:
              latestProjectGenesisCandidate.candidateId,
            proposedProjectId:
              latestProjectGenesisCandidate.proposedProjectId,
            identity: latestProjectGenesisCandidate.identity,
            purpose: latestProjectGenesisCandidate.purpose,
            semanticSummary:
              latestProjectGenesisCandidate.semanticSummary,
            primaryAgentEnvironmentId:
              latestProjectGenesisCandidate
                .primaryAgentEnvironmentId,
            allowedEnvironmentIds:
              latestProjectGenesisCandidate.allowedEnvironmentIds,
            gitAuthorityEnvironmentId:
              latestProjectGenesisCandidate
                .gitAuthorityEnvironmentId,
            rankedRecommendations:
              latestProjectGenesisCandidate
                .rankedRecommendations,
            openDecisions:
              latestProjectGenesisCandidate.openDecisions,
            evidenceReviewState:
              latestProjectGenesisCandidate
                .evidenceReviewState,
            reconciliationState:
              latestProjectGenesisCandidate
                .reconciliationState,
            lifecycle:
              latestProjectGenesisCandidate.lifecycle,
            activationState:
              latestProjectGenesisCandidate.activationState,
            canonical: false,
            grantsAuthority: false,
            digest: latestProjectGenesisCandidate.digest,
          }
        : null,
    latestProjectConstitution: latestProjectConstitution
      ? {
          projectId: latestProjectConstitution.projectId,
          identity: latestProjectConstitution.identity,
          purpose: latestProjectConstitution.purpose,
          primaryAgentEnvironmentId:
            latestProjectConstitution
              .primaryAgentEnvironmentId,
          allowedEnvironmentIds:
            latestProjectConstitution.allowedEnvironmentIds,
          gitAuthorityEnvironmentId:
            latestProjectConstitution
              .gitAuthorityEnvironmentId,
          constitutionRevision:
            latestProjectConstitution.constitutionRevision,
          authorityEpoch:
            latestProjectConstitution.authorityEpoch,
          activationState:
            latestProjectConstitution.activationState,
          effectiveRuntimeState: latestWorkspaceBinding
            ? "workspace_provisioned"
            : latestProjectConstitution.activationState,
          projectWorkspaceBindingRef: latestWorkspaceBinding
            ? {
                kind: "project_workspace_binding",
                id: latestWorkspaceBinding.workspaceBindingId,
                digest: latestWorkspaceBinding.digest,
                projectId: latestWorkspaceBinding.projectId,
              }
            : null,
          canonical: true,
          grantsAuthority: false,
          digest: latestProjectConstitution.digest,
        }
      : null,
    latestContract: latestImplementationContract
      ? {
          implementationContractId:
            latestImplementationContract.implementationContractId,
          projectId: latestImplementationContract.projectId,
          workThreadId: latestImplementationContract.workThreadId,
          state: latestImplementationContract.state,
          objective: latestImplementationContract.objective,
          deliverables: latestImplementationContract.deliverables,
          workerStartAuthorized:
            latestImplementationContract.authority?.workerStartAuthorized === true,
          canonical: true,
          grantsAuthority: false,
          digest: latestImplementationContract.digest,
        }
      : null,
    latestWorkThread: latestContractWorkThread,
    reconciliation: roleRuntimeStage
      ? {
          state: latestReconciliation?.state ||
            (selfContainedWorldManagerResponse
              ? "not_required"
              : latestManagerResult
                ? "pending"
                : "awaiting_agent_result"),
          proposalId:
            latestProjectGenesisCandidate?.candidateId || "",
          summary: latestReconciliation?.semanticSummary ||
            (selfContainedWorldManagerResponse
              ? selfContainedWorldManagerResponseCompleted
                ? "This response was formulated by the WorldManager at world scope; routing it back to another WorldManager reconciliation turn would be recursive."
                : "The WorldManager result did not complete, and no recursive reconciliation turn is scheduled."
              : latestManagerResult
              ? "The manager AgentResult is entering WorldManager reconciliation."
              : "Reconciliation begins after a terminal manager AgentResult."),
          blindspots: latestReconciliation?.blindspots || [],
          continuationPaths:
            latestReconciliation?.continuationPaths || [],
          recommendation: latestReconciliation?.recommendation || "",
          resultId:
            latestReconciliation?.reconciliationAgentResultRef?.id || "",
          sourceAgentResultId:
            latestReconciliation?.sourceAgentResultRef?.id ||
            latestManagerResult?.agentResult?.agentResultId || "",
          canonicalWorldstateMutation: false,
        }
      : {
          state: "unavailable_k3",
          proposalId: "",
          summary: "No proposal exists yet. Reconciliation begins only after a manager role turn produces a candidate.",
          blindspots: [],
          continuationPaths: [],
          recommendation: "",
          resultId: "",
        },
    semanticInbox: roleRuntimeStage
      ? inboxEntries.map((entry) => ({
          inboxEntryId: entry.inboxEntryId,
          semanticEventId: entry.semanticEventId,
          agentResultRef: entry.agentResultRef,
          deliveryState: entry.deliveryState,
          attempts: entry.attempts,
          leaseOwnerPresent: Boolean(entry.leaseOwner),
          lastError: boundedString(entry.lastError, "", 240),
        }))
      : [],
    semanticLineage,
    evidence: latestSettlement
      ? {
          schema: roleRuntimeStage
            ? "direct_world_manager_k4_runtime_evidence@1"
            : "direct_world_manager_k3_compilation_evidence@1",
          latestSettlement: {
            taskSettlementId: latestSettlement.taskSettlementId,
            state: latestSettlement.state,
            projectId: latestSettlement.projectId,
            taskType: latestSettlement.taskType,
            phase: latestSettlement.phase,
            responsibleRole: latestSettlement.responsibleRole,
            settlementTier: latestSettlement.settlementTier,
            ambiguityReasons: latestSettlement.ambiguityReasons,
            clarificationPrompt: latestSettlement.clarificationPrompt,
            rationale: latestSettlement.rationale,
            digest: latestSettlement.digest,
          },
          latestSemanticIngress: latestSemanticIngress
            ? {
                semanticIngressRunId:
                  latestSemanticIngress
                    .semanticIngressRunId,
                runState:
                  latestSemanticIngress.runState,
                outputValidationState:
                  latestSemanticIngress.outputValidation
                    ?.state || "unknown",
                semanticSettlementId:
                  latestSemanticIngress.semanticSettlement
                    ?.semanticSettlementId || "",
                semanticDischargeId:
                  latestSemanticIngress.semanticDischarge
                    ?.semanticDischargeId || "",
                semanticActionName:
                  latestSemanticIngress.semanticDischarge
                    ?.actionName || "",
                semanticDecisionDisposition:
                  latestSemanticIngress.semanticDischarge
                    ?.actionName ===
                      "wm_discharge_decision_concern"
                    ? boundedString(
                        latestSemanticIngress
                          .semanticDischarge
                          ?.arguments?.disposition,
                        "",
                        80,
                      )
                    : "",
                semanticDecisionId:
                  latestSemanticIngress.semanticDischarge
                    ?.actionName ===
                      "wm_discharge_decision_concern"
                    ? boundedString(
                        latestSemanticIngress
                          .semanticDischarge
                          ?.arguments?.decisionId,
                        "",
                        180,
                      )
                    : "",
                semanticDecisionTargetRef:
                  latestSemanticIngress.semanticDischarge
                    ?.actionName ===
                      "wm_discharge_decision_concern"
                    ? latestSemanticIngress
                        .semanticDischarge
                        ?.arguments
                        ?.targetArtifactRef || null
                    : null,
                semanticContentPosture:
                  latestSemanticIngress.semanticDischarge
                    ?.semanticContentPosture || "",
                semanticTypeExpressions:
                  (latestSemanticIngress.semanticDischarge
                    ?.typeExpressions || [])
                    .slice(0, 24)
                    .map((entry) => ({
                      path: boundedString(
                        entry.path,
                        "",
                        180,
                      ),
                      mode: boundedString(
                        entry.expression?.mode,
                        "",
                        48,
                      ),
                      existingTypeRef: boundedString(
                        entry.expression?.existingTypeRef,
                        "",
                        240,
                      ),
                      proposedLabel: boundedString(
                        entry.expression?.proposedLabel,
                        "",
                        240,
                      ),
                      parentTypeRef: boundedString(
                        entry.expression?.parentTypeRef,
                        "",
                        240,
                      ),
                      differentia: boundedString(
                        entry.expression?.differentia,
                        "",
                        480,
                      ),
                      components:
                        (entry.expression?.components || [])
                          .slice(0, 12)
                          .map((component) =>
                            boundedString(
                              component,
                              "",
                              240,
                            )),
                      freeformCharacterization: boundedString(
                        entry.expression
                          ?.freeformCharacterization,
                        "",
                        480,
                      ),
                    })),
                settlementState:
                  latestSemanticIngress.semanticSettlement
                    ?.settlementState || "unknown",
                primaryLane:
                  latestSemanticIngress.semanticSettlement
                    ?.laneAssignments?.find((entry) =>
                      entry.posture === "primary")
                    ?.laneId || "",
                formulationDisposition:
                  latestSemanticIngress.semanticSettlement
                    ?.formulationDisposition || "",
                taskTypes:
                  latestSemanticIngress.semanticSettlement
                    ?.taskTypes || [],
                projectSeedJudgment:
                  latestSemanticIngress.semanticSettlement
                    ?.projectSeedJudgment || "not_applicable",
                runtimeMode:
                  latestSemanticIngress.telemetry
                    ?.runtimeMode || "",
                model:
                  latestSemanticIngress.telemetry?.model ||
                  "",
                toolCallCount: Number(
                  latestSemanticIngress.telemetry
                    ?.toolCallCount || 0,
                ),
                grantsAuthority: false,
                digest: latestSemanticIngress.digest,
              }
            : null,
          latestRoutingDecision: latestRoutingDecision
            ? {
                routingDecisionId: latestRoutingDecision.routingDecisionId,
                decision: latestRoutingDecision.decision,
                selectedRole: latestRoutingDecision.selectedRole,
                digest: latestRoutingDecision.digest,
              }
            : null,
          latestManagerContext: latestSettlement
            ? contextByEventId.get(latestSettlement.semanticEventId) || null
            : null,
          latestAgentWorld: latestSettlement
            ? agentWorldByEventId.get(latestSettlement.semanticEventId) ||
              null
            : null,
          latestRoleRun,
          latestAgentResult: latestManagerResult
            ? {
                agentResult: latestManagerResult.agentResult,
                finalAssistantMessage:
                  latestManagerResult.finalAssistantMessage,
                userFacingResponse:
                  latestManagerResult.userFacingResponse,
                outputValidationState:
                  latestManagerResult.agentResult.outputContractState,
                telemetry: latestManagerResult.telemetry,
                inboxEntry: inboxEntries.find((entry) =>
                  entry.agentResultRef?.id ===
                    latestManagerResult.agentResult.agentResultId) ||
                  null,
              }
            : null,
          latestReconciliation,
          graphBinding: graphBinding
            ? {
                graphRef: graphBinding.graphRef,
                state: graphBinding.state,
                projectCount: Object.keys(
                  graphBinding.projectRootNodeIds || {},
                ).length,
                digest: graphBinding.digest,
              }
            : null,
          grantsAuthority: false,
        }
      : null,
    connectionPosture: {
      controlPlane: "ready",
      semanticRouter: "ready",
      semanticIngress:
        !semanticIngressAvailable
          ? "unavailable"
        : semanticIngressRuns.length
          ? latestSemanticIngress?.runState || "ready"
          : "ready",
      agentWorldCompiler: "ready",
      directRoleRuntime:
        roleRuntimeStage ? "ready" : "not_started",
      voiceTransport: "deferred",
      rawProviderPayloadIncluded: false,
    },
    omissionWitness: {
      schema: pipelineStage === K6_GENESIS_STAGE
        ? "direct_world_manager_k6_genesis_omission_witness@1"
        : pipelineStage === K4_STAGE
        ? "direct_world_manager_k4_omission_witness@1"
        : "direct_world_manager_k3_omission_witness@1",
      unsettledIngressCount,
      omittedCandidateCount: 0,
      omittedDecisionCount: 0,
      unavailableCapabilities: [
        ...(roleRuntimeStage ? [] : [
          "provider_role_turn",
          "agent_result",
        ]),
        ...(pipelineStage === K6_GENESIS_STAGE
          ? latestWorkspaceBinding
            ? ["authoritative_project_worldmodel_activation"]
            : ["workspace_provisioning", "worker_execution"]
          : ["candidate_registration", "canonical_admission"]),
      ],
      reason: pipelineStage === K6_GENESIS_STAGE
        ? latestWorkspaceBinding
          ? "wm_env1_binds_native_project_substrate_but_stops_before_authoritative_project_worldmodel_activation"
          : "wm_k6_genesis_admits_semantic_constitution_but_stops_before_workspace_provisioning"
        : pipelineStage === K4_STAGE
        ? "wm_k4_stops_before_candidate_registration_and_admission"
        : "wm_k3_stops_before_role_runtime",
      omissionIsSuccess: false,
    },
    store: {
      schema: WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA,
      persistence: "sqlite_wal",
      counts: {
        bootstrapCount: Number(input.store?.counts?.bootstrapCount || 0),
        eventCount: Number(input.store?.counts?.eventCount || events.length),
        messageCount: Number(input.store?.counts?.messageCount || 0),
        candidateCount: Number(
          input.store?.counts?.candidateCount ||
            candidateArtifacts.length,
        ),
        projectConstitutionCount: Number(
          input.store?.counts?.projectConstitutionCount ||
            projectConstitutions.length,
        ),
        projectRuntimeDefaultCount: Number(
          input.store?.counts?.projectRuntimeDefaultCount ||
            projectRuntimeDefaults.length,
        ),
        projectWorkspaceBindingCount: Number(
          input.store?.counts?.projectWorkspaceBindingCount ||
            projectWorkspaceBindings.length,
        ),
        environmentProbeReceiptCount: Number(
          input.store?.counts?.environmentProbeReceiptCount ||
            environmentProbeReceipts.length,
        ),
        threadEnvironmentBindingCount: Number(
          input.store?.counts?.threadEnvironmentBindingCount ||
            threadEnvironmentBindings.length,
        ),
        stepEnvironmentSnapshotCount: Number(
          input.store?.counts?.stepEnvironmentSnapshotCount ||
            stepEnvironmentSnapshots.length,
        ),
        childEnvironmentInheritanceCount: Number(
          input.store?.counts?.childEnvironmentInheritanceCount ||
            childEnvironmentInheritances.length,
        ),
        realizationSnapshotCount: Number(
          input.store?.counts?.realizationSnapshotCount || 0,
        ),
        inboxCount: Number(input.store?.counts?.inboxCount || 0),
        decisionCount: Number(input.store?.counts?.decisionCount || 0),
        runtimeBindingCount: Number(input.store?.counts?.runtimeBindingCount || 0),
        settlementCount: Number(input.store?.counts?.settlementCount || 0),
        semanticIngressRunCount: Number(
          input.store?.counts?.semanticIngressRunCount ||
            semanticIngressRuns.length,
        ),
        semanticSettlementRevisionCount: Number(
          input.store?.counts
            ?.semanticSettlementRevisionCount ||
            semanticSettlementRevisions.length,
        ),
        semanticHistoryRelationCount: Number(
          input.store?.counts
            ?.semanticHistoryRelationCount ||
            semanticHistoryRelationRecords.length,
        ),
        semanticShelfCount: Number(
          input.store?.counts?.semanticShelfCount ||
            semanticShelves.length,
        ),
        semanticChildContractCount: Number(
          input.store?.counts
            ?.semanticChildContractCount ||
            semanticChildContractRecords.length,
        ),
        semanticSplitCoordinationCount: Number(
          input.store?.counts
            ?.semanticSplitCoordinationCount ||
            semanticSplitCoordinations.length,
        ),
        routingDecisionCount: Number(input.store?.counts?.routingDecisionCount || 0),
        managerContextCount: Number(input.store?.counts?.managerContextCount || 0),
        agentWorldCompilationCount: Number(input.store?.counts?.agentWorldCompilationCount || 0),
        roleRunCount: Number(input.store?.counts?.roleRunCount || 0),
        agentResultCount: Number(input.store?.counts?.agentResultCount || 0),
        reconciliationCount: Number(input.store?.counts?.reconciliationCount || 0),
        graphBindingCount: Number(input.store?.counts?.graphBindingCount || 0),
      },
      rendererPathExposed: false,
      rawProviderPayloadStored: false,
      rawChainOfThoughtStored: false,
    },
    truthPosture: {
      candidateRenderedAsCanonical: false,
      activityRenderedAsCompletion: false,
      uiMintsAuthority: false,
      rawChainOfThoughtExposed: false,
      candidateIsCanonical: false,
      activityIsCompletion: false,
    },
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  };
  projection.unifiedProjection =
    compileUnifiedWorldManagerProjection(
      projection,
    );
  projection.projectionDigest = digestFor(
    WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA,
    projection,
    ["projectionDigest"],
  );
  assertWorldManagerWorkbenchProjectionSafe(projection);
  return projection;
}

function assertWorldManagerWorkbenchProjectionSafe(projection) {
  if (!isPlainObject(projection) || projection.schema !== WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA) {
    fail("world_manager_projection_schema_mismatch");
  }
  if (
    ![K3_STAGE, K4_STAGE, K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(
      projection.pipelineStage,
    ) ||
    projection.mode !== "production"
  ) {
    fail("world_manager_projection_stage_mismatch");
  }
  const truth = projection.truthPosture || {};
  if (
    truth.candidateRenderedAsCanonical !== false ||
    truth.activityRenderedAsCompletion !== false ||
    truth.uiMintsAuthority !== false ||
    truth.rawChainOfThoughtExposed !== false ||
    truth.candidateIsCanonical !== false ||
    truth.activityIsCompletion !== false
  ) {
    fail("world_manager_projection_authority_inflation");
  }
  try {
    validateUnifiedWorldManagerProjection(
      projection.unifiedProjection,
    );
  } catch (error) {
    fail(
      "world_manager_unified_projection_boundary",
      error?.code || error?.message || "invalid",
    );
  }
  if (
    projection.unifiedProjection
      .projectionRevision !==
        projection.projectionRevision ||
    projection.unifiedProjection
      .sameSemanticIdentityAcrossViews !==
        true ||
    projection.unifiedProjection
      .evidenceBeforeAdmission !== true ||
    projection.unifiedProjection
      .inspectionIsReadOnly !== true ||
    projection.unifiedProjection
      .canonicalWorldstateMutation !==
        false ||
    projection.unifiedProjection
      .grantsAuthority !== false
  ) {
    fail(
      "world_manager_unified_projection_truth_boundary",
    );
  }
  if (
    ![K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(projection.pipelineStage) &&
    (projection.candidateArtifacts?.length ||
      projection.latestProposal !== null ||
      projection.latestContract !== null ||
      projection.latestWorkThread !== null)
  ) {
    fail("world_manager_projection_k1_future_state_forbidden");
  }
  if (
    projection.pipelineStage !== K6_GENESIS_STAGE &&
    (projection.latestProjectConstitutionCandidate !== null ||
      projection.latestProjectConstitution !== null)
  ) {
    fail("world_manager_projection_genesis_state_outside_k6");
  }
  if (
    !Array.isArray(projection.messages) ||
    projection.messages.some((message) =>
      !["user", "agent", "harness"].includes(message.authorKind) ||
      (message.authorKind === "user" &&
        (message.authorRole !== "operator" ||
          message.state !== "received")) ||
      (message.authorKind === "agent" &&
        (!["project_manager", "world_manager"].includes(
          message.authorRole,
        ) ||
          message.canonical !== false ||
          !message.agentResultRef?.id ||
          !message.agentResultRef?.digest)) ||
      (message.authorKind === "harness" &&
        (![
          "semantic_router",
          "world_manager_service",
        ].includes(message.authorRole) ||
          message.canonical !== false ||
          message.grantsAuthority !== false ||
          !message.noticeRef?.id ||
          !message.noticeRef?.digest))) ||
    !Array.isArray(projection.activeLineages) ||
    projection.activeLineages.some((lineage) =>
      ![
        "awaiting_settlement",
        "settled",
        "clarification_required",
        "remanded",
        "context_ready",
        "agent_world_ready",
        "role_running",
        "completed",
        "failed",
        "reconciling",
        "reconciled",
        "interrupted",
        "candidate_ready",
        "candidate_reviewed",
        "constitution_admitted",
        "split_materialized",
        "split_executing",
        "split_joining",
        "partially_remanded",
        "attention_required",
      ].includes(lineage.state)) ||
    projection.pendingDecisions?.some((decision) =>
      !(
        decision.decisionKind === "clarification" ||
        ([K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(projection.pipelineStage) &&
          [
            "project_constitution_admission",
            "plan_proposal_admission",
          ].includes(decision.decisionKind))
      ) ||
      decision.grantsAuthority !== false) ||
    projection.projects?.some((project) =>
      (![K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(projection.pipelineStage) &&
        project.candidateCount !== 0) ||
      (![K5_PLANNING_STAGE, K6_GENESIS_STAGE].includes(projection.pipelineStage) &&
        project.canonicalContractCount !== 0) ||
      project.grantsAuthority !== false)
  ) {
    fail("world_manager_projection_k1_presentation_inflation");
  }
  const substrate = projection.projectSubstrate;
  if (
    substrate?.schema !== "direct_project_substrate_projection@1" ||
    typeof substrate.provisioningAvailable !== "boolean" ||
    !Array.isArray(substrate.bindings) ||
    !Array.isArray(substrate.threadBindings) ||
    !Array.isArray(substrate.stepSnapshots) ||
    !Array.isArray(substrate.childInheritances) ||
    substrate.bindingCount !== substrate.bindings.length ||
    substrate.threadBindingCount !== substrate.threadBindings.length ||
    substrate.stepSnapshotCount !== substrate.stepSnapshots.length ||
    substrate.childInheritanceCount !== substrate.childInheritances.length ||
    substrate.rawWorkspaceLocatorExposed !== false ||
    substrate.adapterAuthority !== "execution_only" ||
    substrate.portOperationRequiredForDefaultChange !== true ||
    substrate.canonical !== false ||
    substrate.grantsAuthority !== false ||
    substrate.bindings.some((binding) =>
      binding.bindingRef?.kind !== "project_workspace_binding" ||
      binding.canonical !== true ||
      binding.grantsAuthority !== false) ||
    substrate.threadBindings.some((binding) =>
      binding.bindingRef?.kind !== "thread_environment_binding" ||
      binding.immutableForThreadLifetime !== true ||
      binding.grantsAuthority !== false) ||
    substrate.stepSnapshots.some((snapshot) =>
      snapshot.snapshotRef?.kind !== "step_environment_snapshot" ||
      snapshot.exactForStep !== true ||
      snapshot.grantsAuthority !== false) ||
    substrate.childInheritances.some((inheritance) =>
      inheritance.inheritanceRef?.kind !== "child_environment_inheritance" ||
      inheritance.ambientProjectDefaultReevaluated !== false ||
      inheritance.grantsAuthority !== false) ||
    /nativeWorkspacePath|windowsNodePath|backendSessionId/.test(
      JSON.stringify(substrate),
    )
  ) {
    fail("world_manager_projection_project_substrate_boundary");
  }
  if (
    projection.projectEcology?.schema !==
      "direct_world_manager_project_ecology_projection@1" ||
    projection.projectEcology?.projectCount !==
      projection.projects.length ||
    projection.projectEcology
      ?.projectIdentityCount !==
      projection.projects.length ||
    projection.projectEcology
      ?.establishedProjectCount +
      projection.projectEcology
        ?.candidateProjectCount !==
      projection.projects.length ||
    projection.projectEcology
      ?.candidateProjectCount !==
      projection.projects.filter((project) =>
        project.inspectionPosture ===
          "semantic_candidate").length ||
    projection.projectEcology?.canonical !== false ||
    projection.projectEcology?.grantsAuthority !== false ||
    !Array.isArray(
      projection.projectEcology?.projectSeeds,
    ) ||
    projection.projectEcology.projectSeeds.some((seed) =>
      seed.canonical !== false ||
      seed.countedAsProject !== false ||
      seed.grantsAuthority !== false) ||
    projection.decisionSummary?.schema !==
      "direct_world_manager_decision_summary_projection@1" ||
    projection.decisionSummary?.canonical !== false ||
    projection.decisionSummary?.grantsAuthority !== false ||
    projection.decisionSummary
      ?.historicalRemandsCountedAsOpen !== false ||
    projection.decisionSummary?.actionRequiredCount !==
      (
        Array.isArray(
          projection.decisionSummary?.openDecisions,
        )
          ? projection.decisionSummary
              .openDecisions.length
          : projection.decisionSummary
              ?.candidateOpenDecisions?.length +
            projection.decisionSummary
              ?.currentClarifications?.length
      ) ||
    projection.decisionSummary
      ?.candidateOpenDecisions?.some((decision) =>
        (
          projection.decisionSummary
            ?.migrationPosture ===
              "sc3_canonical_registry"
            ? decision.canonical !== true
            : decision.canonical !== false
        ) ||
        decision.grantsAuthority !== false) ||
    projection.decisionSummary
      ?.currentClarifications?.some((decision) =>
        (
          projection.decisionSummary
            ?.migrationPosture ===
              "sc3_canonical_registry"
            ? decision.canonical !== true
            : decision.canonical !== false
        ) ||
        decision.grantsAuthority !== false) ||
    projection.decisionSummary
      ?.operationalGateDecisions?.some((decision) =>
        decision.canonical !== true ||
        decision.grantsAuthority !== false) ||
    projection.decisionSummary
      ?.staleDecisions?.some((decision) =>
        decision.schema !==
          "direct_open_decision_projection@1" ||
        decision.state !== "stale" ||
        decision.lifecycle !== "stale" ||
        decision.canonical !== true ||
        decision.grantsAuthority !== false) ||
    projection.decisionSummary
      ?.openDecisions?.some((decision) =>
        decision.grantsAuthority !== false ||
        (
          projection.decisionSummary
            ?.migrationPosture ===
              "sc3_canonical_registry" &&
          (
            decision.schema !==
              "direct_open_decision_projection@1" ||
            decision.canonical !== true ||
            decision.resolutionContract
              ?.executionAuthorityGranted !== false ||
            decision.resolutionContract
              ?.grantsAuthority !== false ||
            decision.options?.some((option) =>
              option.grantsAuthority !== false) ||
            decision.dependencies?.some((dependency) =>
              dependency.grantsAuthority !== false) ||
            decision.consequences?.some((consequence) =>
              consequence.grantsAuthority !== false)
          )
        )) ||
    projection.decisionSummary
      ?.historicalRemands?.some((remand) =>
        remand.countedAsOpenDecision !== false ||
        remand.canonical !== false ||
        remand.grantsAuthority !== false) ||
    !Array.isArray(
      projection.decisionSummary
        ?.recentTransitions,
    ) ||
    projection.decisionSummary
      .recentTransitions.some((transition) =>
        transition.schema !==
          "direct_decision_transition_projection@1" ||
        transition.downstreamEffectsExecuted !==
          false ||
        transition.executionAuthorityGranted !==
          false ||
        transition.grantsAuthority !== false)
  ) {
    fail(
      "world_manager_projection_semantic_inspector_boundary",
    );
  }
  if (
    projection.semanticArtifactKernel?.schema !==
      "direct_semantic_artifact_kernel_projection@1" ||
    !["available", "legacy_fallback"].includes(
      projection.semanticArtifactKernel?.state,
    ) ||
    projection.semanticArtifactKernel
      ?.transitionExecution !==
        "available_wm_sc5" ||
    projection.semanticArtifactKernel
      ?.canonical !== false ||
    projection.semanticArtifactKernel
      ?.grantsAuthority !== false
  ) {
    fail(
      "world_manager_projection_semantic_artifact_kernel_boundary",
    );
  }
  if (
    projection.contextCanvas?.schema !==
      "direct_context_canvas_workbench_projection@1" ||
    projection.contextCanvas
      .registry?.schema !==
        "direct_thought_brush_registry@1" ||
    !Array.isArray(
      projection.contextCanvas.canvases,
    ) ||
    !Array.isArray(
      projection.contextCanvas.strokes,
    ) ||
    typeof projection.contextCanvas
      .available !== "boolean" ||
    projection.contextCanvas
      .compositionAvailable !== true ||
    projection.contextCanvas
      .switchReplacesContext !== true ||
    projection.contextCanvas
      .brushResultsTemporary !== true ||
    projection.contextCanvas
      .insightExtractionCreatesCandidateOnly !==
        true ||
    projection.contextCanvas
      .canonicalAdmissionAvailable !==
        false ||
    projection.contextCanvas
      .workspaceMutationAvailable !==
        false ||
    projection.contextCanvas
      .persistencePosture !==
        "temporary_reversible" ||
    projection.contextCanvas
      .worldEffect !== "none" ||
    projection.contextCanvas
      .canonical !== false ||
    projection.contextCanvas
      .grantsAuthority !== false ||
    projection.contextCanvas
      .canvases.some((canvas) =>
        canvas.schema !==
          "direct_context_canvas_projection@1" ||
        !Number.isInteger(
          Number(canvas.revision),
        ) ||
        !Array.isArray(
          canvas.brushStrokeRefs,
        ) ||
        !Array.isArray(
          canvas.activeAnchorRefs,
        ) ||
        !Array.isArray(
          canvas
            .importedContextBundleRefs,
        ) ||
        !Array.isArray(
          canvas
            .temporarySemanticObjects,
        ) ||
        !Array.isArray(
          canvas.candidateInsights,
        ) ||
        canvas.persistencePosture !==
          "temporary" ||
        canvas.worldEffect !== "none" ||
        canvas
          .canonicalAdmissionEffect !==
            false ||
        canvas.workspaceMutationEffect !==
          false ||
        canvas.canonical !== false ||
        canvas.grantsAuthority !==
          false ||
        canvas
          .temporarySemanticObjects
          .some((object) =>
            object.worldEffect !==
              "none" ||
            object.canonical !== false ||
            object.grantsAuthority !==
              false) ||
        canvas.candidateInsights
          .some((insight) =>
            ![
              "available",
              "extracted",
            ].includes(
              insight
                .extractionState,
            ) ||
            insight.worldEffect !==
              "none" ||
            insight.canonical !==
              false ||
            insight.grantsAuthority !==
              false)) ||
    projection.contextCanvas
      .strokes.some((stroke) =>
        stroke.schema !==
          "direct_thought_brush_stroke_projection@1" ||
        ![
          "completed",
          "remanded",
          "failed",
        ].includes(stroke.state) ||
        stroke.persistencePosture !==
          "temporary_canvas" ||
        stroke.worldEffect !== "none" ||
        stroke.toolExecutionEffect !==
          false ||
        stroke.workspaceMutationEffect !==
          false ||
        stroke
          .canonicalAdmissionEffect !==
            false ||
        stroke.canonical !== false ||
        stroke.grantsAuthority !==
          false)
  ) {
    fail(
      "world_manager_projection_context_canvas_boundary",
    );
  }
  if (
    projection.aroRegistry?.schema !==
      "direct_aro_registry_projection@1" ||
    !Array.isArray(
      projection.aroRegistry.candidates,
    ) ||
    !Array.isArray(
      projection.aroRegistry.canonicalAros,
    ) ||
    !Array.isArray(
      projection.aroRegistry.coverageWitnesses,
    ) ||
    !Array.isArray(
      projection.aroRegistry.currentTargetComparisons,
    ) ||
    !Array.isArray(
      projection.aroRegistry.repositorySnapshots,
    ) ||
    !Array.isArray(
      projection.aroRegistry.reconstructionRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry.targetDefinitionRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry.mutationContracts,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .mutationCompilationRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .realizationContextImports,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .realizationMappingWitnesses,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .realizationMappingRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerSourceFreshness,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerCapabilityObservations,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerReviewReceipts,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerConstitutions,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerAuthorizations,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .workerHandoffRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .executionEvidenceBundles,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .executionEvidenceRuns,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .semanticVerificationAssessments,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .closureCandidates,
    ) ||
    !Array.isArray(
      projection.aroRegistry
        .semanticVerificationRuns,
    ) ||
    typeof projection.aroRegistry
      .workerHandoffAvailable !==
        "boolean" ||
    typeof projection.aroRegistry
      .executionEvidenceAvailable !==
        "boolean" ||
    typeof projection.aroRegistry
      .semanticVerificationAvailable !==
        "boolean" ||
    projection.aroRegistry
      .mutationExecutionAvailable !== false ||
    projection.aroRegistry
      .reconstructionAuthoredByRenderer !== false ||
    projection.aroRegistry
      .reviewValidatesSemanticTruth !== false ||
    projection.aroRegistry
      .admissionMutatesCode !== false ||
    projection.aroRegistry
      .mutationContractLaunchesWorker !==
        false ||
    projection.aroRegistry
      .mutationContractMutatesCode !==
        false ||
    projection.aroRegistry
      .realizationMappingLaunchesWorker !==
        false ||
    projection.aroRegistry
      .realizationMappingMutatesCode !==
        false ||
    projection.aroRegistry
      .workerHandoffMutatesCode !==
        false ||
    projection.aroRegistry
      .executionEvidenceMutatesCode !==
        false ||
    projection.aroRegistry
      .executionEvidenceValidatesSemanticTruth !==
        false ||
    projection.aroRegistry
      .executionEvidenceCertifiesClosure !==
        false ||
    projection.aroRegistry
      .semanticVerificationExecutesTools !==
        false ||
    projection.aroRegistry
      .semanticVerificationMutatesCode !==
        false ||
    projection.aroRegistry
      .semanticVerificationAdmitsCanonicalTruth !==
        false ||
    projection.aroRegistry
      .semanticVerificationCertifiesClosure !==
        false ||
    projection.aroRegistry
      .canonicalClosureAdmissionAvailable !==
        false ||
    projection.aroRegistry
      .semanticVerificationAssessments
      .some((assessment) =>
        assessment.semanticTruthAssessed !==
          true ||
        assessment.semanticTruthCanonical !==
          false ||
        assessment.sourceInspectionEffect !==
          false ||
        assessment.toolExecutionEffect !==
          false ||
        assessment.workspaceMutationEffect !==
          false ||
        assessment.canonicalAdmissionEffect !==
          false ||
        assessment.closureCertified !==
          false ||
        assessment.canonical !== false ||
        assessment.grantsAuthority !==
          false) ||
    projection.aroRegistry
      .closureCandidates
      .some((candidate) =>
        candidate.reviewRequired !==
          true ||
        candidate
          .canonicalAdmissionAvailable !==
          false ||
        candidate.closureCertified !==
          false ||
        candidate.canonical !== false ||
        candidate.grantsAuthority !==
          false) ||
    projection.aroRegistry
      .semanticVerificationRuns
      .some((run) =>
        run.semanticTruthCanonical !==
          false ||
        run.sourceInspectionEffect !==
          false ||
        run.toolExecutionEffect !==
          false ||
        run.workspaceMutationEffect !==
          false ||
        run.canonicalAdmissionEffect !==
          false ||
        run.canonicalAdmissionAvailable !==
          false ||
        run.closureCertified !== false ||
        run.canonical !== false ||
        run.grantsAuthority !== false) ||
    projection.aroRegistry
      .workspaceEffectsExecuted !==
        projection.aroRegistry
          .workspaceEffectsObserved ||
    typeof projection.aroRegistry
      .workspaceEffectsObserved !==
        "boolean" ||
    projection.aroRegistry
      .downstreamEffectsExecuted !== false ||
    projection.aroRegistry
      .canonical !== false ||
    projection.aroRegistry
      .grantsAuthority !== false
  ) {
    fail(
      "world_manager_projection_aro_registry_boundary",
    );
  }
  try {
    projection.aroRegistry.candidates.forEach(
      validateAroReconstructionCandidate,
    );
    projection.aroRegistry.canonicalAros.forEach(
      validateAbstractReasoningObject,
    );
    projection.aroRegistry.currentTargetComparisons
      .forEach(
        validateAroCurrentTargetComparison,
      );
    projection.aroRegistry.reviewReceipts.forEach(
      validateAroReviewReceipt,
    );
    projection.aroRegistry.admissionReceipts.forEach(
      validateAroAdmissionReceipt,
    );
    projection.aroRegistry.repositorySnapshots
      .forEach((snapshot) => {
        if (
          snapshot?.schema !==
            "direct_repository_semantic_snapshot_projection@1" ||
          !["observed", "unavailable"].includes(
            snapshot.observationState,
          ) ||
          snapshot.sourceTextProjected !== false ||
          snapshot.relativePathsProjected !== false ||
          snapshot.rawWorkspacePathIncluded !== false ||
          snapshot.rawSecretIncluded !== false ||
          snapshot.canonical !== false ||
          snapshot.grantsAuthority !== false
        ) {
          fail(
            "world_manager_repository_snapshot_projection_invalid",
          );
        }
      });
    projection.aroRegistry.reconstructionRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_reconstruction_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "completed",
            "remanded",
            "failed",
          ].includes(run.state) ||
          run.semanticTruthValidated !== false ||
          run.workspaceMutationEffect !== false ||
          run.admissionEffect !== false ||
          run.canonical !== false ||
          run.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_reconstruction_run_projection_invalid",
          );
        }
      });
    projection.aroRegistry.targetDefinitionRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_target_definition_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "completed",
            "remanded",
            "failed",
          ].includes(run.state) ||
          run.sourceInspectionEffect !==
            false ||
          run.realizationBindingEffect !==
            false ||
          run.canonicalAdmissionEffect !==
            false ||
          run.mutationContractEffect !==
            false ||
          run.workerLaunchEffect !== false ||
          run.workspaceMutationEffect !==
            false ||
          run.canonical !== false ||
          run.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_target_definition_run_projection_invalid",
          );
        }
      });
    projection.aroRegistry.mutationContracts
      .forEach((contract) => {
        if (
          contract?.schema !==
            "direct_aro_mutation_contract_projection@1" ||
          contract.lifecycle !==
            "candidate" ||
          contract.reviewState !==
            "pending" ||
          contract.realizationContextState !==
            "not_imported_sc8_1" ||
          contract.workerLaunchState !==
            "unavailable_sc8_1" ||
          contract.sourceInspectionEffect !==
            false ||
          contract.workerLaunchEffect !==
            false ||
          contract.workspaceMutationEffect !==
            false ||
          contract.canonicalAdmissionEffect !==
            false ||
          contract.canonical !== false ||
          contract.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_mutation_contract_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .mutationCompilationRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_mutation_compilation_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "completed",
            "remanded",
            "failed",
          ].includes(run.state) ||
          run.sourceInspectionEffect !==
            false ||
          run.workerLaunchEffect !==
            false ||
          run.workspaceMutationEffect !==
            false ||
          run.canonicalAdmissionEffect !==
            false ||
          run.canonical !== false ||
          run.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_mutation_run_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .realizationContextImports
      .forEach((contextImport) => {
        if (
          contextImport?.schema !==
            "direct_aro_realization_context_import_projection@1" ||
          !["fresh", "changed", "stale"].includes(
            contextImport.freshness,
          ) ||
          !Array.isArray(
            contextImport.evidence,
          ) ||
          contextImport.evidence.some(
            (evidence) =>
              evidence?.schema !==
                "direct_aro_realization_source_evidence_projection@1" ||
              Object.hasOwn(
                evidence,
                "excerpt",
              ) ||
              Object.hasOwn(
                evidence,
                "sourceText",
              ) ||
              evidence.sourceTextProjected !==
                false ||
              evidence.rawWorkspacePathIncluded !==
                false ||
              evidence.rawSecretIncluded !==
                false ||
              evidence.grantsAuthority !==
                false,
          ) ||
          contextImport.sourceTextProjected !==
            false ||
          contextImport.sourceInspectionEffect !==
            true ||
          contextImport.readOnlyEffect !==
            true ||
          contextImport.workerLaunchEffect !==
            false ||
          contextImport.workspaceMutationEffect !==
            false ||
          contextImport.canonicalAdmissionEffect !==
            false ||
          contextImport.executionAuthorityGranted !==
            false ||
          contextImport.semanticTruthValidated !==
            false ||
          contextImport.rawWorkspacePathIncluded !==
            false ||
          contextImport.rawSecretIncluded !==
            false ||
          contextImport.canonical !== false ||
          contextImport.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_realization_context_import_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .realizationMappingWitnesses
      .forEach((witness) => {
        if (
          witness?.schema !==
            "direct_aro_realization_mapping_witness_projection@1" ||
          ![
            "complete",
            "partial",
            "ambiguous",
            "blocked",
          ].includes(
            witness.mappingPosture,
          ) ||
          !Array.isArray(
            witness.obligationMappings,
          ) ||
          witness.lifecycle !==
            "candidate" ||
          witness.reviewState !==
            "pending" ||
          witness.workerLaunchState !==
            "unavailable_sc8_2" ||
          witness.sourceTextProjected !==
            false ||
          witness.sourceInspectionEffect !==
            true ||
          witness.readOnlyEffect !== true ||
          witness.workerLaunchEffect !==
            false ||
          witness.workspaceMutationEffect !==
            false ||
          witness.canonicalAdmissionEffect !==
            false ||
          witness.executionAuthorityGranted !==
            false ||
          witness.semanticTruthValidated !==
            false ||
          witness.canonical !== false ||
          witness.grantsAuthority !== false ||
          witness.obligationMappings.some(
            (mapping) =>
              mapping?.schema !==
                "direct_aro_obligation_realization_mapping_projection@1" ||
              mapping.grantsAuthority !==
                false ||
              !Array.isArray(
                mapping.sourceBindings,
              ) ||
              mapping.sourceBindings.some(
                (binding) =>
                  binding?.schema !==
                    "direct_aro_source_realization_binding_projection@1" ||
                  Object.hasOwn(
                    binding,
                    "excerpt",
                  ) ||
                  Object.hasOwn(
                    binding,
                    "sourceText",
                  ) ||
                  binding.sourceTextProjected !==
                    false ||
                  binding.grantsAuthority !==
                    false,
              ),
          )
        ) {
          fail(
            "world_manager_aro_realization_mapping_witness_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .realizationMappingRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_realization_mapping_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "completed",
            "remanded",
            "failed",
          ].includes(run.state) ||
          run.sourceInspectionEffect !==
            true ||
          run.readOnlyEffect !== true ||
          run.workerLaunchEffect !== false ||
          run.workspaceMutationEffect !==
            false ||
          run.canonicalAdmissionEffect !==
            false ||
          run.executionAuthorityGranted !==
            false ||
          run.semanticTruthValidated !==
            false ||
          run.canonical !== false ||
          run.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_realization_mapping_run_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerSourceFreshness
      .forEach((witness) => {
        if (
          witness?.schema !==
            "direct_aro_worker_source_freshness_projection@1" ||
          !["fresh", "blocked"].includes(
            witness.state,
          ) ||
          !Array.isArray(
            witness.requestedPaths,
          ) ||
          !Array.isArray(
            witness.blockerCodes,
          ) ||
          witness.sourceInspectionEffect !==
            true ||
          witness.readOnlyEffect !== true ||
          witness.workspaceMutationEffect !==
            false ||
          witness.rawWorkspacePathIncluded !==
            false ||
          witness.rawSecretIncluded !==
            false ||
          witness.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_worker_source_freshness_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerCapabilityObservations
      .forEach((observation) => {
        if (
          observation?.schema !==
            "direct_aro_worker_capability_observation_projection@1" ||
          !Array.isArray(
            observation.availableToolNames,
          ) ||
          !Array.isArray(
            observation.blockerCodes,
          ) ||
          observation
            .perCallApprovalRequired !==
              true ||
          observation
            .workspaceMutationAtHandoff !==
              false ||
          observation
            .remoteMutationAvailable !==
              false ||
          observation
            .canonicalWriteAvailable !==
              false ||
          observation
            .rawWorkspacePathIncluded !==
              false ||
          observation
            .rawCredentialIncluded !==
              false ||
          observation
            .rawSecretIncluded !== false ||
          observation.grantsAuthority !==
            false
        ) {
          fail(
            "world_manager_aro_worker_capability_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerReviewReceipts
      .forEach((receipt) => {
        if (
          receipt?.schema !==
            "direct_aro_worker_review_receipt_projection@1" ||
          !["reviewed", "blocked"].includes(
            receipt.reviewState,
          ) ||
          !Array.isArray(
            receipt.blockerCodes,
          ) ||
          receipt.exactEvidenceReviewed !==
            true ||
          receipt.sourceIdentityRefreshed !==
            true ||
          receipt.capabilityGateObserved !==
            true ||
          receipt.providerStartAuthorized !==
            false ||
          receipt.workspaceMutationAuthorized !==
            false ||
          receipt
            .canonicalAdmissionAuthorized !==
              false ||
          receipt.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_worker_review_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerConstitutions
      .forEach((constitution) => {
        if (
          constitution?.schema !==
            "direct_aro_worker_constitution_projection@1" ||
          ![
            "ready_for_authorization",
            "blocked",
          ].includes(
            constitution.constitutionState,
          ) ||
          !Array.isArray(
            constitution.blockerCodes,
          ) ||
          !Array.isArray(
            constitution.obligationBindings,
          ) ||
          constitution
            .compiledInstructionsProjected !==
              false ||
          constitution.sourceTextProjected !==
            false ||
          constitution
            .providerStartAuthorized !==
              false ||
          constitution
            .workspaceMutationAtCompile !==
              false ||
          constitution
            .remoteMutationAvailable !==
              false ||
          constitution
            .canonicalWriteAvailable !==
              false ||
          constitution
            .semanticTruthValidated !==
              false ||
          constitution.closureCertified !==
            false ||
          constitution.rendererAuthored !==
            false ||
          constitution.canonical !== false ||
          constitution.grantsAuthority !==
            false ||
          constitution.capability
            ?.perCallApprovalRequired !==
              true ||
          constitution.authority
            ?.providerStartRequiresOperatorAuthorization !==
              true ||
          constitution.authority
            ?.mayExecuteWorkspaceMutation !==
              false ||
          constitution.completion
            ?.activityCountsAsCompletion !==
              false ||
          constitution.completion
            ?.workerMaySelfCertifyClosure !==
              false
        ) {
          fail(
            "world_manager_aro_worker_constitution_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerAuthorizations
      .forEach((authorization) => {
        if (
          authorization?.schema !==
            "direct_aro_worker_authorization_projection@1" ||
          ![
            "authorized",
            "blocked",
          ].includes(
            authorization
              .authorizationState,
          ) ||
          !Array.isArray(
            authorization.blockerCodes,
          ) ||
          authorization.singleUse !== true ||
          authorization
            .perCallEffectApprovalRequired !==
              true ||
          authorization
            .workspaceMutationAuthorized !==
              false ||
          authorization
            .remoteMutationAuthorized !==
              false ||
          authorization
            .canonicalAdmissionAuthorized !==
              false ||
          authorization
            .semanticClosureAuthorized !==
              false ||
          authorization.grantsAuthority !==
            false
        ) {
          fail(
            "world_manager_aro_worker_authorization_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .workerHandoffRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_worker_handoff_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "handed_off",
            "blocked",
            "failed",
          ].includes(run.state) ||
          run.retryable !== false ||
          run
            .perCallEffectApprovalRequired !==
              true ||
          run.workspaceMutationEffect !==
            false ||
          run.remoteMutationEffect !== false ||
          run.canonicalAdmissionEffect !==
            false ||
          run.semanticTruthValidated !==
            false ||
          run.closureCertified !== false ||
          run.canonical !== false ||
          run.grantsAuthority !== false ||
          (
            run.state === "handed_off" &&
            (
              run.workerLaunchEffect !==
                true ||
              run.providerTurnStartEffect !==
                true ||
              !run.workerSessionRef ||
              !run.workerTurnRef
            )
          )
        ) {
          fail(
            "world_manager_aro_worker_handoff_run_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .executionEvidenceBundles
      .forEach((bundle) => {
        if (
          bundle?.schema !==
            "direct_aro_execution_evidence_bundle_projection@1" ||
          ![
            "observing",
            "acquired",
          ].includes(
            bundle.captureState,
          ) ||
          !Array.isArray(
            bundle.toolResults,
          ) ||
          !Array.isArray(
            bundle.workspaceEffects,
          ) ||
          !Array.isArray(
            bundle.verificationCoverage,
          ) ||
          bundle.verificationCoverage
            .some((coverage) =>
              ![
                "observed",
                "missing",
                "ambiguous",
              ].includes(
                coverage.coverageStatus,
              ) ||
              coverage
                .mechanicalPresenceOnly !==
                  true ||
              coverage
                .successConditionEvaluated !==
                  false ||
              coverage
                .semanticTruthValidated !==
                  false ||
              coverage
                .closureCertified !==
                  false) ||
          bundle.workspaceEffects
            .some((effect) =>
              typeof effect
                .workspaceMutationObserved !==
                  "boolean" ||
              typeof effect
                .localEffectExecuted !==
                  "boolean") ||
          bundle
            .workspaceMutationAuthorizedBySc8_4 !==
              false ||
          bundle.remoteMutationObserved !==
            false ||
          bundle
            .canonicalAdmissionObserved !==
              false ||
          bundle.semanticTruthValidated !==
            false ||
          bundle.closureCertified !== false ||
          bundle
            .rawProviderPayloadIncluded !==
              false ||
          bundle.rawToolResultIncluded !==
            false ||
          bundle
            .rawChainOfThoughtIncluded !==
              false ||
          bundle.canonical !== false ||
          bundle.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_execution_evidence_bundle_projection_invalid",
          );
        }
      });
    projection.aroRegistry
      .executionEvidenceRuns
      .forEach((run) => {
        if (
          run?.schema !==
            "direct_aro_execution_evidence_run_projection@1" ||
          ![
            "scheduled",
            "running",
            "observing",
            "acquired",
            "failed",
          ].includes(run.state) ||
          run.retryable !==
            (run.state === "failed") ||
          (
            [
              "observing",
              "acquired",
            ].includes(run.state) &&
            !run.evidenceBundleRef
          ) ||
          run.workspaceMutationAuthorized !==
            false ||
          run.remoteMutationAuthorized !==
            false ||
          run
            .canonicalAdmissionAuthorized !==
              false ||
          run.semanticClosureAuthorized !==
            false ||
          run.semanticTruthValidated !==
            false ||
          run.closureCertified !== false ||
          run.canonical !== false ||
          run.grantsAuthority !== false
        ) {
          fail(
            "world_manager_aro_execution_evidence_run_projection_invalid",
          );
        }
      });
  } catch (error) {
    fail(
      "world_manager_projection_aro_registry_invalid",
      error?.code ||
        error?.message ||
        "invalid",
    );
  }
  try {
    validateSemanticSurfaceProjection(
      projection.semanticSurface,
    );
  } catch (error) {
    fail(
      "world_manager_projection_semantic_surface_boundary",
      error?.code || error?.message || "invalid",
    );
  }
  if (
    projection.semanticSurface
      ?.sourceProjectionRevision !==
      projection.projectionRevision ||
    (
      projection.decisionSummary
        ?.migrationPosture ===
          "sc3_canonical_registry" &&
      projection.semanticSurface
        ?.decisionDock
        ?.actionRequiredCount !==
        projection.decisionSummary
          ?.actionRequiredCount
    ) ||
    projection.semanticSurface
      ?.objectSurfaces
      ?.filter((surface) =>
        surface.objectClass ===
          "decision_transition_receipt")
      .length !==
      (
        projection.decisionSummary
          ?.recentTransitions?.length ||
        0
      ) ||
    projection.semanticSurface
      ?.uiMintsAuthority !== false ||
    projection.semanticSurface
      ?.canonicalWorldstateMutation !== false ||
    projection.semanticSurface
      ?.grantsAuthority !== false
  ) {
    fail(
      "world_manager_projection_semantic_surface_truth_boundary",
    );
  }
  if (
    projection.projects.some((project) =>
      project.inspectionPosture ===
        "semantic_candidate" &&
      (
        projection.pipelineStage !==
          K6_GENESIS_STAGE ||
        project.sourceKind !==
          "project_constitution_candidate" ||
        project.focusEligible !== false ||
        project.constitutionState !==
          "not_admitted" ||
        project.candidateCount !== 1 ||
        project.canonical !== false ||
        project.grantsAuthority !== false
      ))
  ) {
    fail(
      "world_manager_projection_candidate_project_boundary",
    );
  }
  if (
    !["available", "unavailable"].includes(
      projection.worldPosture?.semanticSettlement,
    ) ||
    projection.worldPosture?.agentWorldCompilation !== "available" ||
    !["not_started", "available"].includes(
      projection.worldPosture?.providerRoleRuntime,
    ) ||
    projection.worldPosture?.grantsAuthority !== false ||
    projection.omissionWitness?.omissionIsSuccess !== false
  ) {
    fail("world_manager_projection_k1_truth_violation");
  }
  if (
    projection.connectionPosture?.semanticRouter !== "ready" ||
    ![
      "ready",
      "completed",
      "remanded",
      "failed",
      "unavailable",
    ].includes(
      projection.connectionPosture?.semanticIngress,
    ) ||
    projection.connectionPosture?.agentWorldCompiler !== "ready" ||
    !["not_started", "ready"].includes(
      projection.connectionPosture?.directRoleRuntime,
    )
  ) {
    fail("world_manager_projection_k1_capability_inflation");
  }
  if (
    projection.semanticHistory?.state !== "available" ||
    projection.semanticHistory?.grantsAuthority !== false ||
    projection.semanticHistory?.rawTranscriptIncluded !== false ||
    !Array.isArray(projection.semanticHistory?.shelves) ||
    projection.semanticHistory.shelves.some((shelf) =>
      shelf.grantsAuthority !== false ||
      !["fresh", "stale", "rebuilding", "blocked"].includes(
        shelf.freshness,
      ))
  ) {
    fail("world_manager_projection_semantic_history_boundary");
  }
  if (
    projection.operationalMetaContext?.schema !==
      "direct_operational_meta_context_projection@1" ||
    !["fresh", "stale", "blocked", "not_prepared"].includes(
      projection.operationalMetaContext?.state,
    ) ||
    !Array.isArray(
      projection.operationalMetaContext?.contexts,
    ) ||
    projection.operationalMetaContext.contexts.some(
      (context) =>
        !["fresh", "stale", "blocked"].includes(
          context.freshness,
        ) ||
        context.rawEvidenceIncluded !== false ||
        context.worldEffect !== "none" ||
        context.grantsAuthority !== false,
    ) ||
    projection.operationalMetaContext
      ?.rawEvidenceIncluded !== false ||
    projection.operationalMetaContext
      ?.canonicalWorldstateMutation !== false ||
    projection.operationalMetaContext
      ?.grantsAuthority !== false
  ) {
    fail(
      "world_manager_projection_operational_meta_context_boundary",
    );
  }
  if (
    projection.semanticSplit &&
    (
      projection.semanticSplit.canonical !== false ||
      projection.semanticSplit.grantsAuthority !== false ||
      !Array.isArray(
        projection.semanticSplit.childOutcomes,
      ) ||
      ![
        "materialized",
        "executing",
        "joining",
        "completed",
        "partially_remanded",
        "remanded",
        "failed",
        "interrupted",
      ].includes(projection.semanticSplit.state)
    )
  ) {
    fail("world_manager_projection_semantic_split_boundary");
  }
  if (
    projection.evidence?.latestSettlement?.settlementTier ===
      "semantic" &&
    (!projection.evidence.latestSemanticIngress ||
      !projection.activeLineages.some((lineage) =>
        lineage.semanticIngressRunId ===
          projection.evidence.latestSemanticIngress
            .semanticIngressRunId))
  ) {
    fail("world_manager_projection_semantic_ingress_lineage_missing");
  }
  if (
    projection.pipelineStage === K3_STAGE &&
    (projection.busy !== false ||
      projection.worldPosture?.providerRoleRuntime !== "not_started" ||
      projection.reconciliation?.state !== "unavailable_k3" ||
      projection.connectionPosture?.directRoleRuntime !== "not_started" ||
      projection.messages.some((message) =>
        message.authorKind === "agent") ||
      projection.activeLineages.some((lineage) =>
        ![
          "awaiting_settlement",
          "settled",
          "clarification_required",
          "remanded",
          "context_ready",
          "agent_world_ready",
          "split_materialized",
        ].includes(lineage.state)))
  ) {
    fail("world_manager_projection_k3_runtime_inflation");
  }
  if (projection.pipelineStage === K4_STAGE) {
    const agentMessages = projection.messages.filter((message) =>
      message.authorKind === "agent");
    const inboxRefIds = new Set(
      (projection.semanticInbox || [])
        .map((entry) => entry.agentResultRef?.id)
        .filter(Boolean),
    );
    if (
      projection.worldPosture?.providerRoleRuntime !== "available" ||
      projection.connectionPosture?.directRoleRuntime !== "ready" ||
      projection.latestProposal !== null ||
      projection.latestContract !== null ||
      projection.truthPosture?.candidateIsCanonical !== false ||
      agentMessages.some((message) =>
        message.authorRole !== "world_manager" &&
        !inboxRefIds.has(message.agentResultRef.id)) ||
      projection.reconciliation?.canonicalWorldstateMutation === true
    ) {
      fail("world_manager_projection_k4_runtime_boundary");
    }
  }
  if (projection.pipelineStage === K5_PLANNING_STAGE) {
    if (
      projection.worldPosture?.providerRoleRuntime !== "available" ||
      projection.connectionPosture?.directRoleRuntime !== "ready" ||
      !projection.latestProposal ||
      projection.latestProposal.grantsAuthority !== false ||
      (projection.latestContract &&
        (projection.latestContract.canonical !== true ||
          projection.latestContract.state !== "contract_received" ||
          projection.latestContract.workerStartAuthorized !== false)) ||
      (projection.latestWorkThread &&
        projection.latestWorkThread.lifecycleState !== "contract_received")
    ) {
      fail("world_manager_projection_k5_planning_boundary");
    }
  }
  if (projection.pipelineStage === K6_GENESIS_STAGE) {
    const candidate = projection.latestProjectConstitutionCandidate;
    const constitution = projection.latestProjectConstitution;
    const substrateBound = Boolean(
      projection.projectSubstrate?.latestWorkspaceBindingRef,
    );
    if (
      projection.worldPosture?.providerRoleRuntime !== "available" ||
      projection.connectionPosture?.directRoleRuntime !== "ready" ||
      (projection.latestProposal &&
        (projection.latestProposal.grantsAuthority !== false ||
          !["candidate", "candidate_reconciled", "superseded", "canonical"]
            .includes(projection.latestProposal.state))) ||
      (projection.latestContract &&
        (projection.latestContract.canonical !== true ||
          projection.latestContract.grantsAuthority !== false ||
          projection.latestContract.state !== "contract_received" ||
          projection.latestContract.workerStartAuthorized !== false)) ||
      (projection.latestWorkThread &&
        projection.latestWorkThread.lifecycleState !== "contract_received") ||
      projection.truthPosture?.candidateIsCanonical !== false ||
      projection.candidateArtifacts.some((artifact) =>
        artifact.canonical !== false ||
        artifact.grantsAuthority !== false ||
        artifact.lifecycle === "admitted" &&
          artifact.activationState !==
            "awaiting_workspace_provisioning") ||
      (candidate &&
        (candidate.canonical !== false ||
          candidate.grantsAuthority !== false)) ||
      (constitution &&
        (constitution.canonical !== true ||
          constitution.grantsAuthority !== false ||
          constitution.activationState !==
            "awaiting_workspace_provisioning")) ||
      projection.omissionWitness?.unavailableCapabilities?.includes(
        "workspace_provisioning",
      ) !== !substrateBound ||
      projection.omissionWitness?.unavailableCapabilities?.includes(
        "worker_execution",
      ) !== !substrateBound ||
      projection.omissionWitness?.unavailableCapabilities?.includes(
        "authoritative_project_worldmodel_activation",
      ) !== substrateBound
    ) {
      fail("world_manager_projection_k6_genesis_boundary");
    }
  }
  const latestAgentWorld = projection.evidence?.latestAgentWorld;
  if (
    latestAgentWorld &&
    (latestAgentWorld.projectionAgreementState !== "validated" ||
      latestAgentWorld.launchEligible !== true ||
      latestAgentWorld.launchBoundary !==
        "ready_for_k4_runtime_only" ||
      latestAgentWorld.toolCount !== 0 ||
      latestAgentWorld.toolNames?.length ||
      latestAgentWorld.workspaceMutationAvailable !== false ||
      latestAgentWorld.remoteMutationAvailable !== false ||
      latestAgentWorld.canonicalWriteAvailable !== false ||
      latestAgentWorld.rendererInstructionInputAccepted !== false ||
      latestAgentWorld.providerRoleTurnState !== "not_started" ||
      latestAgentWorld.providerRequestCreated !== false ||
      latestAgentWorld.canonicalWorldstateMutation !== false ||
      latestAgentWorld.grantsAuthority !== false)
  ) {
    fail("world_manager_projection_k3_agent_world_inflation");
  }
  if (
    projection.store?.rendererPathExposed !== false ||
    projection.store?.rawProviderPayloadStored !== false ||
    projection.store?.rawChainOfThoughtStored !== false
  ) {
    fail("world_manager_projection_store_exposure");
  }
  const expected = digestFor(
    WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA,
    projection,
    ["projectionDigest"],
  );
  if (projection.projectionDigest !== expected) {
    fail("world_manager_projection_digest_mismatch");
  }
  return true;
}

module.exports = {
  K1_STAGE,
  K2_STAGE,
  K3_STAGE,
  K4_STAGE,
  K5_PLANNING_STAGE,
  K6_GENESIS_STAGE,
  MAX_MESSAGE_CHARS,
  WORLD_MANAGER_BOOTSTRAP_MANIFEST_SCHEMA,
  WORLD_MANAGER_CONTROL_PLANE_STORE_SCHEMA,
  WORLD_MANAGER_MESSAGE_SCHEMA,
  WORLD_MANAGER_SEMANTIC_EVENT_SCHEMA,
  WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
  WORLD_MANAGER_WORKBENCH_PROJECTION_SCHEMA,
  assertWorldManagerWorkbenchProjectionSafe,
  bootstrapConfigurationDigest,
  buildWorldManagerBootstrapManifest,
  buildWorldManagerMessage,
  buildWorldManagerSemanticEvent,
  buildWorldManagerWorkbenchProjection,
  digestFor,
  normalizeWorldManagerSubmitRequest,
  projectWorldId,
  semanticEventDigest,
  stableId,
  validateWorldManagerBootstrapManifest,
  validateWorldManagerMessage,
  validateWorldManagerSemanticEvent,
  validateWorldManagerSubmitRequest,
};
