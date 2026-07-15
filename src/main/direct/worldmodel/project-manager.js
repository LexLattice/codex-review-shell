"use strict";

// Wave 26 PR 152 deliberately models custody and delegation only.  It does
// not promote ideas or mutate the graph; that remains the later ingress and
// transition-controller slice.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const {
  buildScopedWorldmodelRevisionRef,
  validateHierarchicalWorldmodelGraph,
  validateScopedWorldmodelRevisionRef,
} = require("./hierarchical-graph");
const { validateWorldmodelManagerProfile } = require("./manager");

const PROJECT_MANAGER_PROFILE_SCHEMA = "direct_project_manager_profile@1";
const PROJECT_WORLD_STATE_SCHEMA = "direct_project_world_state@1";
const WORLD_MANAGER_TARGET_POSTURE_SCHEMA =
  "direct_world_manager_target_posture@1";
const WORLD_TO_PROJECT_DELEGATION_PACKET_SCHEMA =
  "direct_world_to_project_delegation_packet@1";
const PROJECT_MANAGER_CHAT_MARKER_SCHEMA =
  "direct_project_manager_chat_marker@1";
const HIERARCHICAL_WORLDMODEL_MIGRATION_WITNESS_SCHEMA =
  "direct_hierarchical_worldmodel_migration_witness@1";
const HISTORICAL_WORLD_MANAGER_THREAD_PARENT_ADAPTER_SCHEMA =
  "direct_historical_world_manager_thread_parent_adapter@1";
const PROJECT_CUSTODY_WRITE_MATRIX_SCHEMA =
  "direct_project_custody_write_matrix@1";
const PROJECT_CUSTODY_WRITE_WITNESS_SCHEMA =
  "direct_project_custody_write_witness@1";
const PROJECT_MANAGER_CONTEXTUAL_ADMISSION_SCHEMA =
  "direct_project_manager_contextual_admission@1";

const DIGEST_FIELDS = new Set([
  "profileDigest",
  "projectWorldDigest",
  "postureDigest",
  "delegationDigest",
  "markerDigest",
  "witnessDigest",
  "adapterDigest",
  "matrixDigest",
  "writeWitnessDigest",
  "admissionDigest",
]);
const PROJECT_OPERATIONAL_PATHS = Object.freeze([
  "project.progress",
  "project.memory",
  "project.work_threads",
  "project.execution_profile_binding",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function object(value, label) {
  if (!isPlainObject(value))
    fail("direct_project_manager_invalid_object", label);
  return value;
}
function string(value, label) {
  const result = normalizeString(value, "");
  if (!result) fail("direct_project_manager_missing_string", label);
  return result;
}
function array(value, label) {
  if (!Array.isArray(value))
    fail("direct_project_manager_missing_array", label);
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
function checkDigest(value, key, domain, label) {
  if (string(value[key], `${label}.${key}`) !== digest(domain, value))
    fail("direct_project_manager_digest_mismatch", `${label}.${key}`);
}

function safeRef(input = {}, fallbackKind = "worldmodel_artifact") {
  const source = isPlainObject(input) ? input : {};
  return {
    kind: normalizeString(source.kind, fallbackKind),
    id: normalizeString(source.id || source.nodeId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.profileDigest, ""),
    label: normalizeString(source.label, fallbackKind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}
function validateRef(ref, label, options = {}) {
  object(ref, label);
  string(ref.kind, `${label}.kind`);
  if (options.id !== false) string(ref.id, `${label}.id`);
  if (options.digest !== false) string(ref.digest, `${label}.digest`);
  if (
    ref.rawTextIncluded === true ||
    ref.rawPathIncluded === true ||
    ref.rawSecretIncluded === true
  )
    fail("direct_project_manager_raw_ref_exposure", label);
  return true;
}
function refs(values, kind) {
  return (Array.isArray(values) ? values : []).map((value) =>
    safeRef(value, kind),
  );
}
function validateRefs(values, label) {
  array(values, label).forEach((ref, index) =>
    validateRef(ref, `${label}.${index}`),
  );
  return true;
}
function profileRef(profile) {
  const source = isPlainObject(profile) ? profile : {};
  return safeRef(
    {
      kind: "project_manager_profile",
      id: source.projectManagerProfileId || source.id,
      digest: source.profileDigest || source.digest,
      label: source.label || "Project Manager profile",
    },
    "project_manager_profile",
  );
}

function buildProjectManagerProfile(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const createdAt = normalizeString(
    source.createdAt,
    nowIso(options.now || Date.now),
  );
  const profile = {
    schema: PROJECT_MANAGER_PROFILE_SCHEMA,
    projectManagerProfileId: normalizeId(
      source.projectManagerProfileId,
      "project_manager_profile",
    ),
    projectManagerAgentId: normalizeId(
      source.projectManagerAgentId,
      "agent_project_manager",
    ),
    worldManagerAgentId: normalizeId(
      source.worldManagerAgentId,
      "agent_world_manager",
    ),
    projectId: normalizeId(source.projectId, "project"),
    projectRootNodeId: normalizeId(source.projectRootNodeId, "project_root"),
    humanFacingConversation: true,
    ownsProjectMemory: true,
    ownsProjectOperationalProgress: true,
    mayAdmitWorkThreadEvidence: true,
    mayCreateThreadManagerDelegation: true,
    maySubmitStrategicProjectDelta: true,
    mayUpdateGlobalWorldState: false,
    mayRouteGlobalDeltaUpward: true,
    mayReceiveWorldUpdatePackets: true,
    maySelectAuthorizedProjectProfiles: true,
    mayModifyConstitutionalPolicy: false,
    mayExecuteWorkerTasks: false,
    authorityBoundaryRef: safeRef(
      source.authorityBoundaryRef,
      "authority_boundary",
    ),
    graphProjectionPolicyRef: safeRef(
      source.graphProjectionPolicyRef,
      "graph_projection_policy",
    ),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt,
    updatedAt: normalizeString(source.updatedAt, createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  profile.profileDigest = digest("direct-project-manager-profile@1", profile);
  return profile;
}

function validateProjectManagerProfile(profile) {
  object(profile, "projectManagerProfile");
  if (profile.schema !== PROJECT_MANAGER_PROFILE_SCHEMA)
    fail("direct_project_manager_schema_mismatch", "projectManagerProfile");
  [
    "projectManagerProfileId",
    "projectManagerAgentId",
    "worldManagerAgentId",
    "projectId",
    "projectRootNodeId",
  ].forEach((key) => string(profile[key], `projectManagerProfile.${key}`));
  const truths = [
    "humanFacingConversation",
    "ownsProjectMemory",
    "ownsProjectOperationalProgress",
    "mayAdmitWorkThreadEvidence",
    "mayCreateThreadManagerDelegation",
    "maySubmitStrategicProjectDelta",
    "mayRouteGlobalDeltaUpward",
    "mayReceiveWorldUpdatePackets",
    "maySelectAuthorizedProjectProfiles",
  ];
  if (
    truths.some((key) => profile[key] !== true) ||
    profile.mayUpdateGlobalWorldState !== false ||
    profile.mayModifyConstitutionalPolicy !== false ||
    profile.mayExecuteWorkerTasks !== false
  )
    fail(
      "direct_project_manager_control_plane_boundary_violation",
      "projectManagerProfile",
    );
  validateRef(
    profile.authorityBoundaryRef,
    "projectManagerProfile.authorityBoundaryRef",
  );
  validateRef(
    profile.graphProjectionPolicyRef,
    "projectManagerProfile.graphProjectionPolicyRef",
  );
  if (
    profile.rawTextIncluded === true ||
    profile.rawPathIncluded === true ||
    profile.rawSecretIncluded === true
  )
    fail(
      "direct_project_manager_raw_profile_exposure",
      "projectManagerProfile",
    );
  checkDigest(
    profile,
    "profileDigest",
    "direct-project-manager-profile@1",
    "projectManagerProfile",
  );
  return true;
}

function buildProjectWorldState(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.projectManagerProfile;
  if (profile) validateProjectManagerProfile(profile);
  const projectId = normalizeId(
    source.projectId || profile?.projectId,
    "project",
  );
  const projectRootNodeId = normalizeId(
    source.projectRootNodeId || profile?.projectRootNodeId,
    "project_root",
  );
  const projectManagerProjectId = normalizeId(
    source.projectManagerProjectId || profile?.projectId || projectId,
    "project",
  );
  if (
    profile &&
    (profile.projectId !== projectId ||
      profile.projectRootNodeId !== projectRootNodeId)
  )
    fail(
      "direct_project_manager_state_project_identity_mismatch",
      "projectManagerProfile",
    );
  if (projectManagerProjectId !== projectId)
    fail(
      "direct_project_manager_state_project_identity_mismatch",
      "projectManagerProjectId",
    );
  const projectRevisionRef = buildScopedWorldmodelRevisionRef({
    scopeKind: "project",
    projectId,
    revision: Number(
      source.projectRevision ?? source.projectRevisionRef?.revision ?? 0,
    ),
  });
  const state = {
    schema: PROJECT_WORLD_STATE_SCHEMA,
    projectId,
    projectRootNodeId,
    projectManagerProjectId,
    projectManagerProfileRef: profileRef(
      profile || source.projectManagerProfileRef,
    ),
    canonicalGraphRef: safeRef(
      source.canonicalGraphRef,
      "hierarchical_worldmodel_graph",
    ),
    projectRevisionRef,
    charterNodeRefs: refs(source.charterNodeRefs, "worldmodel_semantic_node"),
    terminalGoalNodeRefs: refs(
      source.terminalGoalNodeRefs,
      "worldmodel_semantic_node",
    ),
    conceptualModelNodeRefs: refs(
      source.conceptualModelNodeRefs,
      "worldmodel_semantic_node",
    ),
    projectMemoryNodeRefs: refs(
      source.projectMemoryNodeRefs,
      "worldmodel_semantic_node",
    ),
    acceptedDecisionNodeRefs: refs(
      source.acceptedDecisionNodeRefs,
      "worldmodel_semantic_node",
    ),
    openIdeaNodeRefs: refs(source.openIdeaNodeRefs, "worldmodel_semantic_node"),
    openQuestionNodeRefs: refs(
      source.openQuestionNodeRefs,
      "worldmodel_semantic_node",
    ),
    riskNodeRefs: refs(source.riskNodeRefs, "worldmodel_semantic_node"),
    activeWorkThreadRefs: refs(source.activeWorkThreadRefs, "work_thread"),
    environmentBindingRefs: refs(
      source.environmentBindingRefs,
      "environment_binding",
    ),
    executionProfileBindingRef: source.executionProfileBindingRef
      ? safeRef(
          source.executionProfileBindingRef,
          "project_execution_profile_binding",
        )
      : undefined,
    statusSummaryNodeRef: safeRef(
      source.statusSummaryNodeRef,
      "worldmodel_semantic_node",
    ),
    openRemandRefs: refs(source.openRemandRefs, "worldmodel_remand"),
    projectRevision: projectRevisionRef.revision,
    ancestorRevisionRefs: (Array.isArray(source.ancestorRevisionRefs)
      ? source.ancestorRevisionRefs
      : []
    ).map(buildScopedWorldmodelRevisionRef),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  state.projectWorldDigest = digest("direct-project-world-state@1", state);
  return state;
}

function validateProjectWorldState(state) {
  object(state, "projectWorldState");
  if (state.schema !== PROJECT_WORLD_STATE_SCHEMA)
    fail("direct_project_manager_schema_mismatch", "projectWorldState");
  string(state.projectId, "projectWorldState.projectId");
  string(state.projectRootNodeId, "projectWorldState.projectRootNodeId");
  validateRef(
    state.projectManagerProfileRef,
    "projectWorldState.projectManagerProfileRef",
  );
  validateRef(state.canonicalGraphRef, "projectWorldState.canonicalGraphRef");
  validateScopedWorldmodelRevisionRef(
    state.projectRevisionRef,
    "projectWorldState.projectRevisionRef",
  );
  if (normalizeString(state.projectManagerProjectId, "") !== state.projectId)
    fail(
      "direct_project_manager_state_project_identity_mismatch",
      "projectManagerProjectId",
    );
  if (
    state.projectRevisionRef.scopeKind !== "project" ||
    state.projectRevisionRef.projectId !== state.projectId ||
    Number(state.projectRevision) !== state.projectRevisionRef.revision
  )
    fail(
      "direct_project_manager_project_revision_mismatch",
      "projectWorldState",
    );
  [
    "charterNodeRefs",
    "terminalGoalNodeRefs",
    "conceptualModelNodeRefs",
    "projectMemoryNodeRefs",
    "acceptedDecisionNodeRefs",
    "openIdeaNodeRefs",
    "openQuestionNodeRefs",
    "riskNodeRefs",
    "activeWorkThreadRefs",
    "environmentBindingRefs",
    "openRemandRefs",
  ].forEach((key) => validateRefs(state[key], `projectWorldState.${key}`));
  validateRef(
    state.statusSummaryNodeRef,
    "projectWorldState.statusSummaryNodeRef",
  );
  if (state.executionProfileBindingRef)
    validateRef(
      state.executionProfileBindingRef,
      "projectWorldState.executionProfileBindingRef",
    );
  array(
    state.ancestorRevisionRefs,
    "projectWorldState.ancestorRevisionRefs",
  ).forEach((ref, index) =>
    validateScopedWorldmodelRevisionRef(
      ref,
      `projectWorldState.ancestorRevisionRefs.${index}`,
    ),
  );
  if (
    state.rawTextIncluded === true ||
    state.rawPathIncluded === true ||
    state.rawSecretIncluded === true
  )
    fail("direct_project_manager_raw_state_exposure", "projectWorldState");
  checkDigest(
    state,
    "projectWorldDigest",
    "direct-project-world-state@1",
    "projectWorldState",
  );
  return true;
}

function buildWorldManagerTargetPosture(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const manager = source.worldManagerProfile;
  if (manager) validateWorldmodelManagerProfile(manager);
  if (manager?.scope?.scopeKind !== "global_user")
    fail(
      "direct_project_manager_world_manager_not_global",
      "worldManagerProfile.scope",
    );
  const result = {
    schema: WORLD_MANAGER_TARGET_POSTURE_SCHEMA,
    worldManagerProfileRef: safeRef(
      {
        kind: "worldmodel_manager_profile",
        id: manager?.managerProfileId || source.worldManagerProfileId,
        digest: manager?.profileDigest || source.worldManagerProfileDigest,
        label: "World Manager profile",
      },
      "worldmodel_manager_profile",
    ),
    ownsUserGlobalCrossProjectState: true,
    mayDirectlyMutateProjectOperationalState: false,
    projectDescentMode: "targeted_only",
    projectDetailMode: "compact_semantic_heads",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  result.postureDigest = digest(
    "direct-world-manager-target-posture@1",
    result,
  );
  return result;
}
function validateWorldManagerTargetPosture(posture) {
  object(posture, "worldManagerTargetPosture");
  if (posture.schema !== WORLD_MANAGER_TARGET_POSTURE_SCHEMA)
    fail("direct_project_manager_schema_mismatch", "worldManagerTargetPosture");
  validateRef(
    posture.worldManagerProfileRef,
    "worldManagerTargetPosture.worldManagerProfileRef",
  );
  if (
    posture.ownsUserGlobalCrossProjectState !== true ||
    posture.mayDirectlyMutateProjectOperationalState !== false ||
    posture.projectDescentMode !== "targeted_only" ||
    posture.projectDetailMode !== "compact_semantic_heads"
  )
    fail(
      "direct_project_manager_world_posture_boundary_violation",
      "worldManagerTargetPosture",
    );
  checkDigest(
    posture,
    "postureDigest",
    "direct-world-manager-target-posture@1",
    "worldManagerTargetPosture",
  );
  return true;
}

function buildWorldToProjectDelegationPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const world = source.worldManagerProfile;
  const project = source.projectManagerProfile;
  if (world) validateWorldmodelManagerProfile(world);
  if (world?.scope?.scopeKind !== "global_user")
    fail(
      "direct_project_manager_world_manager_not_global",
      "worldManagerProfile.scope",
    );
  if (project) validateProjectManagerProfile(project);
  const projectId = normalizeId(
    source.projectId || project?.projectId,
    "project",
  );
  const projectRootNodeId = normalizeId(
    source.projectRootNodeId || project?.projectRootNodeId,
    "project_root",
  );
  const projectManagerProjectId = normalizeId(
    source.projectManagerProjectId || project?.projectId || projectId,
    "project",
  );
  if (
    project &&
    (project.projectId !== projectId ||
      project.projectRootNodeId !== projectRootNodeId)
  )
    fail(
      "direct_project_manager_delegation_project_identity_mismatch",
      "projectManagerProfile",
    );
  if (projectManagerProjectId !== projectId)
    fail(
      "direct_project_manager_delegation_project_identity_mismatch",
      "projectManagerProjectId",
    );
  const packet = {
    schema: WORLD_TO_PROJECT_DELEGATION_PACKET_SCHEMA,
    delegationPacketId: normalizeId(
      source.delegationPacketId,
      "world_to_project_delegation",
    ),
    worldManagerProfileRef: safeRef(
      {
        kind: "worldmodel_manager_profile",
        id: world?.managerProfileId || source.worldManagerProfileId,
        digest: world?.profileDigest || source.worldManagerProfileDigest,
        label: "World Manager profile",
      },
      "worldmodel_manager_profile",
    ),
    projectManagerProfileRef: profileRef(
      project || source.projectManagerProfileRef,
    ),
    projectManagerProjectId,
    projectId,
    projectRootNodeId,
    canonicalGraphRef: safeRef(
      source.canonicalGraphRef,
      "hierarchical_worldmodel_graph",
    ),
    expectedProjectRevisionRef: buildScopedWorldmodelRevisionRef({
      scopeKind: "project",
      projectId,
      revision: Number(
        source.expectedProjectRevision ??
          source.expectedProjectRevisionRef?.revision ??
          0,
      ),
    }),
    targetPosture: "project_delta_candidate_only",
    objectiveSummary: normalizeString(
      source.objectiveSummary,
      "Targeted ProjectWorld descent and delegated integration.",
    ),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  packet.delegationDigest = digest(
    "direct-world-to-project-delegation-packet@1",
    packet,
  );
  return packet;
}
function validateWorldToProjectDelegationPacket(packet) {
  object(packet, "worldToProjectDelegationPacket");
  if (packet.schema !== WORLD_TO_PROJECT_DELEGATION_PACKET_SCHEMA)
    fail(
      "direct_project_manager_schema_mismatch",
      "worldToProjectDelegationPacket",
    );
  [
    "worldManagerProfileRef",
    "projectManagerProfileRef",
    "canonicalGraphRef",
  ].forEach((key) =>
    validateRef(packet[key], `worldToProjectDelegationPacket.${key}`),
  );
  string(packet.projectId, "worldToProjectDelegationPacket.projectId");
  string(
    packet.projectRootNodeId,
    "worldToProjectDelegationPacket.projectRootNodeId",
  );
  validateScopedWorldmodelRevisionRef(
    packet.expectedProjectRevisionRef,
    "worldToProjectDelegationPacket.expectedProjectRevisionRef",
  );
  if (normalizeString(packet.projectManagerProjectId, "") !== packet.projectId)
    fail(
      "direct_project_manager_delegation_project_identity_mismatch",
      "projectManagerProjectId",
    );
  if (
    packet.expectedProjectRevisionRef.scopeKind !== "project" ||
    packet.expectedProjectRevisionRef.projectId !== packet.projectId ||
    packet.targetPosture !== "project_delta_candidate_only"
  )
    fail(
      "direct_project_manager_delegation_custody_violation",
      "worldToProjectDelegationPacket",
    );
  checkDigest(
    packet,
    "delegationDigest",
    "direct-world-to-project-delegation-packet@1",
    "worldToProjectDelegationPacket",
  );
  return true;
}

function buildProjectCustodyWriteMatrix(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const matrix = {
    schema: PROJECT_CUSTODY_WRITE_MATRIX_SCHEMA,
    matrixId: normalizeId(source.matrixId, "project_custody_write_matrix"),
    projectId: normalizeId(source.projectId, "project"),
    rows: [
      {
        pathPrefix: "user.",
        custodianRole: "world_manager",
        directWriterRoles: ["world_manager"],
        projectManagerDisposition: "route_upward",
      },
      {
        pathPrefix: "project.charter",
        custodianRole: "project_manager",
        directWriterRoles: ["project_manager"],
        worldManagerDisposition: "targeted_delta_only",
      },
      {
        pathPrefix: "project.architecture",
        custodianRole: "project_manager",
        directWriterRoles: ["project_manager"],
        worldManagerDisposition: "targeted_delta_only",
      },
      ...PROJECT_OPERATIONAL_PATHS.map((pathPrefix) => ({
        pathPrefix,
        custodianRole: "project_manager",
        directWriterRoles: ["project_manager"],
        worldManagerDisposition: "delegation_required",
      })),
      {
        pathPrefix: "project.work_thread.",
        custodianRole: "thread_manager",
        directWriterRoles: ["thread_manager"],
        projectManagerDisposition: "supervise_or_admit_closure",
      },
    ],
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  matrix.matrixDigest = digest("direct-project-custody-write-matrix@1", matrix);
  return matrix;
}
function validateProjectCustodyWriteMatrix(matrix) {
  object(matrix, "projectCustodyWriteMatrix");
  if (matrix.schema !== PROJECT_CUSTODY_WRITE_MATRIX_SCHEMA)
    fail("direct_project_manager_schema_mismatch", "projectCustodyWriteMatrix");
  string(matrix.projectId, "projectCustodyWriteMatrix.projectId");
  array(matrix.rows, "projectCustodyWriteMatrix.rows").forEach((row, index) => {
    object(row, `projectCustodyWriteMatrix.rows.${index}`);
    string(
      row.pathPrefix,
      `projectCustodyWriteMatrix.rows.${index}.pathPrefix`,
    );
    string(
      row.custodianRole,
      `projectCustodyWriteMatrix.rows.${index}.custodianRole`,
    );
    array(
      row.directWriterRoles,
      `projectCustodyWriteMatrix.rows.${index}.directWriterRoles`,
    );
  });
  checkDigest(
    matrix,
    "matrixDigest",
    "direct-project-custody-write-matrix@1",
    "projectCustodyWriteMatrix",
  );
  return true;
}
function buildProjectCustodyWriteWitness(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const matrix = source.matrix || buildProjectCustodyWriteMatrix(source);
  validateProjectCustodyWriteMatrix(matrix);
  const path = normalizeString(source.path, "");
  const actorRole = normalizeString(source.actorRole, "unknown");
  const row = matrix.rows
    .filter((entry) => path.startsWith(entry.pathPrefix))
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
  const custodyRouteSatisfied = Boolean(
    row && row.directWriterRoles.includes(actorRole),
  );
  const witness = {
    schema: PROJECT_CUSTODY_WRITE_WITNESS_SCHEMA,
    matrixRef: safeRef(
      {
        kind: "project_custody_write_matrix",
        id: matrix.matrixId,
        digest: matrix.matrixDigest,
        label: "Project custody/write matrix",
      },
      "project_custody_write_matrix",
    ),
    projectId: matrix.projectId,
    actorRole,
    path,
    action: normalizeString(source.action, "mutate"),
    decision: custodyRouteSatisfied ? "authorized" : "remanded",
    custodyRouteSatisfied,
    actionAuthorityGranted: false,
    requiresGraphCas: true,
    requiresAuthorityTrace: true,
    controllerRole: normalizeString(row?.custodianRole, "unknown"),
    reasonCode: custodyRouteSatisfied
      ? "direct_project_custody_write_allowed"
      : actorRole === "world_manager" && path.startsWith("project.")
        ? "direct_world_manager_project_write_blocked"
        : actorRole === "project_manager" && path.startsWith("user.")
          ? "project_manager_global_write_blocked"
          : "custody_write_route_required",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  witness.writeWitnessDigest = digest(
    "direct-project-custody-write-witness@1",
    witness,
  );
  return witness;
}
function validateProjectCustodyWriteWitness(witness) {
  object(witness, "projectCustodyWriteWitness");
  if (witness.schema !== PROJECT_CUSTODY_WRITE_WITNESS_SCHEMA)
    fail(
      "direct_project_manager_schema_mismatch",
      "projectCustodyWriteWitness",
    );
  validateRef(witness.matrixRef, "projectCustodyWriteWitness.matrixRef");
  if (!["authorized", "remanded"].includes(witness.decision))
    fail(
      "direct_project_manager_invalid_write_decision",
      "projectCustodyWriteWitness",
    );
  if (
    witness.custodyRouteSatisfied !== (witness.decision === "authorized") ||
    witness.actionAuthorityGranted !== false ||
    witness.requiresGraphCas !== true ||
    witness.requiresAuthorityTrace !== true
  )
    fail(
      "direct_project_manager_custody_not_action_authority",
      "projectCustodyWriteWitness",
    );
  checkDigest(
    witness,
    "writeWitnessDigest",
    "direct-project-custody-write-witness@1",
    "projectCustodyWriteWitness",
  );
  return true;
}

function buildProjectManagerChatMarker(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.projectManagerProfile;
  if (profile) validateProjectManagerProfile(profile);
  const marker = {
    schema: PROJECT_MANAGER_CHAT_MARKER_SCHEMA,
    markerId: normalizeId(source.markerId, "project_manager_chat_marker"),
    projectManagerProfileRef: profileRef(
      profile || source.projectManagerProfileRef,
    ),
    projectId: normalizeId(source.projectId || profile?.projectId, "project"),
    sessionId: normalizeId(source.sessionId, "project_manager_chat"),
    humanFacingConversation: true,
    rawTranscriptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(
      source.createdAt,
      nowIso(options.now || Date.now),
    ),
  };
  marker.markerDigest = digest("direct-project-manager-chat-marker@1", marker);
  return marker;
}
function validateProjectManagerChatMarker(marker) {
  object(marker, "projectManagerChatMarker");
  if (marker.schema !== PROJECT_MANAGER_CHAT_MARKER_SCHEMA)
    fail("direct_project_manager_schema_mismatch", "projectManagerChatMarker");
  validateRef(
    marker.projectManagerProfileRef,
    "projectManagerChatMarker.projectManagerProfileRef",
  );
  string(marker.projectId, "projectManagerChatMarker.projectId");
  string(marker.sessionId, "projectManagerChatMarker.sessionId");
  if (
    marker.humanFacingConversation !== true ||
    marker.rawTranscriptIncluded !== false
  )
    fail(
      "direct_project_manager_chat_identity_violation",
      "projectManagerChatMarker",
    );
  checkDigest(
    marker,
    "markerDigest",
    "direct-project-manager-chat-marker@1",
    "projectManagerChatMarker",
  );
  return true;
}

function buildHistoricalWorldManagerThreadParentAdapter(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const adapter = {
    schema: HISTORICAL_WORLD_MANAGER_THREAD_PARENT_ADAPTER_SCHEMA,
    adapterId: normalizeId(
      source.adapterId,
      "historical_world_manager_thread_parent_adapter",
    ),
    historicalWorldManagerProfileRef: safeRef(
      source.historicalWorldManagerProfileRef || source.worldManagerProfileRef,
      "worldmodel_manager_profile",
    ),
    threadManagerProfileRef: safeRef(
      source.threadManagerProfileRef,
      "thread_manager_profile",
    ),
    resolvedParentRole: "world_manager",
    compatibilityState: "historical_direct_parent_readable",
    migrationCandidateParentRole: "project_manager",
    migrationRequiredForNewProfiles: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  adapter.adapterDigest = digest(
    "direct-historical-world-manager-thread-parent-adapter@1",
    adapter,
  );
  return adapter;
}
function validateHistoricalWorldManagerThreadParentAdapter(adapter) {
  object(adapter, "historicalWorldManagerThreadParentAdapter");
  if (adapter.schema !== HISTORICAL_WORLD_MANAGER_THREAD_PARENT_ADAPTER_SCHEMA)
    fail(
      "direct_project_manager_schema_mismatch",
      "historicalWorldManagerThreadParentAdapter",
    );
  validateRef(
    adapter.historicalWorldManagerProfileRef,
    "historicalWorldManagerThreadParentAdapter.historicalWorldManagerProfileRef",
  );
  validateRef(
    adapter.threadManagerProfileRef,
    "historicalWorldManagerThreadParentAdapter.threadManagerProfileRef",
  );
  if (
    adapter.resolvedParentRole !== "world_manager" ||
    adapter.compatibilityState !== "historical_direct_parent_readable" ||
    adapter.migrationRequiredForNewProfiles !== true
  )
    fail(
      "direct_project_manager_invalid_parent_adapter",
      "historicalWorldManagerThreadParentAdapter",
    );
  checkDigest(
    adapter,
    "adapterDigest",
    "direct-historical-world-manager-thread-parent-adapter@1",
    "historicalWorldManagerThreadParentAdapter",
  );
  return true;
}

function buildHierarchicalWorldmodelMigrationWitness(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const witness = {
    schema: HIERARCHICAL_WORLDMODEL_MIGRATION_WITNESS_SCHEMA,
    witnessId: normalizeId(
      source.witnessId,
      "hierarchical_worldmodel_migration_witness",
    ),
    projectId: normalizeString(source.projectId, ""),
    sourceArtifactRefs: refs(source.sourceArtifactRefs, "migration_source"),
    resultingNodeRefs: refs(
      source.resultingNodeRefs,
      "worldmodel_semantic_node",
    ),
    compatibilityBindingRefs: refs(
      source.compatibilityBindingRefs,
      "compatibility_binding",
    ),
    preservedProvenanceCount: Number(source.preservedProvenanceCount || 0),
    skippedCandidateCount: Number(source.skippedCandidateCount || 0),
    conflictCount: Number(source.conflictCount || 0),
    doubleInclusionCount: 0,
    historicalTranscriptMiningPerformed: false,
    destructiveRewritePerformed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  witness.witnessDigest = digest(
    "direct-hierarchical-worldmodel-migration-witness@1",
    witness,
  );
  return witness;
}
function validateHierarchicalWorldmodelMigrationWitness(witness) {
  object(witness, "hierarchicalWorldmodelMigrationWitness");
  if (witness.schema !== HIERARCHICAL_WORLDMODEL_MIGRATION_WITNESS_SCHEMA)
    fail(
      "direct_project_manager_schema_mismatch",
      "hierarchicalWorldmodelMigrationWitness",
    );
  [
    "sourceArtifactRefs",
    "resultingNodeRefs",
    "compatibilityBindingRefs",
  ].forEach((key) =>
    validateRefs(witness[key], `hierarchicalWorldmodelMigrationWitness.${key}`),
  );
  if (witness.managerScopeMigration) {
    const migration = witness.managerScopeMigration;
    object(
      migration,
      "hierarchicalWorldmodelMigrationWitness.managerScopeMigration",
    );
    if (
      !["global_user", "project", "work_thread"].includes(
        migration.legacyScopeKind,
      )
    )
      fail(
        "direct_project_manager_invalid_legacy_scope",
        "managerScopeMigration.legacyScopeKind",
      );
    const expectedRole =
      migration.legacyScopeKind === "global_user"
        ? "world_manager"
        : migration.legacyScopeKind === "work_thread"
          ? "thread_manager"
          : "project_manager";
    if (migration.targetRole !== expectedRole)
      fail(
        "direct_project_manager_invalid_scope_migration_role",
        "managerScopeMigration.targetRole",
      );
    validateRef(
      migration.legacyManagerProfileRef,
      "managerScopeMigration.legacyManagerProfileRef",
    );
    validateRef(
      migration.resultingManagerProfileRef,
      "managerScopeMigration.resultingManagerProfileRef",
    );
  }
  if (
    witness.doubleInclusionCount !== 0 ||
    witness.historicalTranscriptMiningPerformed !== false ||
    witness.destructiveRewritePerformed !== false
  )
    fail(
      "direct_project_manager_migration_boundary_violation",
      "hierarchicalWorldmodelMigrationWitness",
    );
  checkDigest(
    witness,
    "witnessDigest",
    "direct-hierarchical-worldmodel-migration-witness@1",
    "hierarchicalWorldmodelMigrationWitness",
  );
  return true;
}

// A manager-scope witness is intentionally an additive specialization of the
// migration witness: it records classification, not a migration execution.
function buildManagerScopeMigrationWitness(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const legacyScopeKind = normalizeString(source.legacyScopeKind, "project");
  const targetRole = normalizeString(
    source.targetRole,
    legacyScopeKind === "global_user"
      ? "world_manager"
      : legacyScopeKind === "work_thread"
        ? "thread_manager"
        : "project_manager",
  );
  const legacyManagerProfileRef = safeRef(
    source.legacyManagerProfileRef,
    "worldmodel_manager_profile",
  );
  const resultingManagerProfileRef = safeRef(
    source.resultingManagerProfileRef,
    `${targetRole}_profile`,
  );
  const witness = buildHierarchicalWorldmodelMigrationWitness({
    ...source,
    sourceArtifactRefs: source.sourceArtifactRefs || [legacyManagerProfileRef],
    compatibilityBindingRefs: source.compatibilityBindingRefs || [
      resultingManagerProfileRef,
    ],
  });
  witness.managerScopeMigration = {
    legacyScopeKind,
    targetRole,
    legacyManagerProfileRef,
    resultingManagerProfileRef,
  };
  witness.witnessDigest = digest(
    "direct-hierarchical-worldmodel-migration-witness@1",
    witness,
  );
  return witness;
}

function exactSha(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(normalizeString(value, ""))) fail("direct_project_manager_exact_ref_required", label);
  return value;
}

function contextualRequiredArtifacts({ graph, world, profile, custodyMatrix, custodyWitness, authority, parentDelegation }) {
  const root = graph.nodes.find((node) => node.nodeId === profile.projectRootNodeId);
  const required = [
    { kind: "world_manager_profile", id: world.managerProfileId, digest: world.profileDigest },
    { kind: "project_manager_profile", id: profile.projectManagerProfileId, digest: profile.profileDigest },
    { kind: "project_root", id: profile.projectRootNodeId, digest: root?.digest },
    { kind: "custody_matrix", id: custodyMatrix.matrixId, digest: custodyMatrix.matrixDigest },
    { kind: "custody_witness", id: custodyWitness.path, digest: custodyWitness.writeWitnessDigest },
    { kind: "authority_decision", id: authority.authorityDecisionId, digest: authority.digest, oneShot: true },
  ];
  if (parentDelegation) required.push({ kind: "parent_delegation", id: parentDelegation.delegationId, digest: parentDelegation.delegationDigest });
  return required;
}

function requireExactStoreOwnedBody(registry, kind, body, label) {
  const record = registry.records.find((entry) => entry.kind === kind && canonicalJson(entry.body) === canonicalJson(body));
  if (!record) fail("direct_project_manager_context_store_body_mismatch", label || kind);
  return record;
}

// The store owns the active graph and governance snapshot.  Everything passed
// into this module is therefore evidence until it is compared to that snapshot.
// Thread/work-thread bodies are intentionally not portable registry records;
// they are nevertheless exact contextual bodies and are revalidated here at
// each operational use.
function resolveAuthoritativeProjectManagerContext(context = {}, requiredArtifacts) {
  const graph = context.graph;
  const trust = require("./governance-trust-store");
  let store; let authoritative;
  try {
    store = trust.resolveAuthoritativeWorldmodelTrustStore(graph);
    authoritative = trust.readAuthoritativeWorldmodelGraph(store, graph);
  } catch (error) {
    fail(error.code || "direct_project_manager_context_store_authority_invalid");
  }
  if (canonicalJson(authoritative.graph) !== canonicalJson(graph)) fail("direct_project_manager_context_store_graph_substitution");
  if (!context.governanceRegistry || canonicalJson(context.governanceRegistry) !== canonicalJson(authoritative.governanceRegistry)) fail("direct_project_manager_context_store_registry_substitution");
  if (!context.storeAdmission) fail("direct_project_manager_context_store_admission_required");
  const profile = context.projectManagerProfile;
  try {
    trust.validateWorldmodelStoreAdmission(store, graph, context.storeAdmission, {
      agentId: profile.projectManagerAgentId,
      role: "project_manager",
      purpose: "manager_context",
      requiredArtifacts,
    });
  } catch (error) {
    fail(error.code || "direct_project_manager_context_store_admission_invalid");
  }
  return authoritative;
}

function validateExactThreadAndWorkThreadBodies(thread, workThread, profile) {
  // Avoid an eager project-manager <-> thread-manager module cycle.
  const { validateThreadManagerProfile } = require("./thread-manager");
  const { buildWorkThread } = require("../bridge/work-thread-registry");
  validateThreadManagerProfile(thread);
  const rebuilt = buildWorkThread(workThread, { nowMs: Date.parse(workThread?.updatedAt) });
  if (canonicalJson(rebuilt) !== canonicalJson(workThread)
    || thread.parentManagerRole !== "project_manager"
    || thread.parentManagerProfileId !== profile.projectManagerProfileId
    || thread.parentManagerAgentId !== profile.projectManagerAgentId
    || thread.projectId !== profile.projectId
    || thread.workThreadId !== workThread.workThreadId
    || workThread.projectId !== profile.projectId) {
    fail("direct_project_manager_context_thread_delegation_mismatch", "projectManagerContextualAdmission");
  }
}

// Portable profile/state/delegation artifacts are intentionally only shapes.
// This contextual path is the sole admission path for an operational manager
// relationship: it resolves all referenced objects and closes their IDs and
// digests against the live graph rather than trusting caller-provided refs.
function validateProjectManagerProfileAgainstContext(profile, context = {}) {
  validateProjectManagerProfile(profile);
  const graph = context.graph; const world = context.worldManagerProfile;
  validateHierarchicalWorldmodelGraph(graph); validateWorldmodelManagerProfile(world);
  exactSha(profile.profileDigest, "projectManagerProfile.profileDigest"); exactSha(profile.authorityBoundaryRef.digest, "projectManagerProfile.authorityBoundaryRef.digest"); exactSha(profile.graphProjectionPolicyRef.digest, "projectManagerProfile.graphProjectionPolicyRef.digest");
  const root = graph.nodes.find((node) => node.nodeId === profile.projectRootNodeId);
  if (!root || root.nodeKind !== "project_root" || root.scope.scopeKind !== "project" || root.scope.projectId !== profile.projectId || root.scope.userProfileId !== graph.userProfileId || world.scope?.scopeKind !== "global_user" || world.scope?.userProfileId !== graph.userProfileId || world.managerAgentId !== profile.worldManagerAgentId) fail("direct_project_manager_context_profile_mismatch", "projectManagerProfile");
  return { kind: "project_manager_profile", id: profile.projectManagerProfileId, digest: profile.profileDigest, projectRootDigest: root.digest };
}

function validateProjectWorldStateAgainstContext(state, context = {}) {
  validateProjectWorldState(state);
  const profile = context.projectManagerProfile; const graph = context.graph; const world = context.worldManagerProfile;
  const profileRef = validateProjectManagerProfileAgainstContext(profile, { graph, worldManagerProfile: world });
  const revision = graph.scopedRevisionRefs.find((ref) => ref.scopeKind === "project" && ref.projectId === state.projectId);
  if (!revision || state.projectId !== profile.projectId || state.projectRootNodeId !== profile.projectRootNodeId || state.projectManagerProfileRef.id !== profileRef.id || state.projectManagerProfileRef.digest !== profileRef.digest || state.canonicalGraphRef.id !== graph.graphId || state.canonicalGraphRef.digest !== graph.digest || state.projectRevisionRef.digest !== revision.digest) fail("direct_project_manager_context_state_mismatch", "projectWorldState");
  return true;
}

function buildProjectManagerContextualAdmission(input = {}, options = {}) {
  const source = object(input, "projectManagerContextualAdmissionInput"); const graph = source.graph; const world = source.worldManagerProfile; const profile = source.projectManagerProfile; const state = source.projectWorldState;
  validateProjectWorldStateAgainstContext(state, { graph, projectManagerProfile: profile, worldManagerProfile: world });
  const custodyMatrix = source.custodyMatrix; const custodyWitness = source.custodyWriteWitness; validateProjectCustodyWriteMatrix(custodyMatrix); validateProjectCustodyWriteWitness(custodyWitness);
  if (custodyMatrix.projectId !== profile.projectId || custodyWitness.matrixRef.digest !== custodyMatrix.matrixDigest || custodyWitness.projectId !== profile.projectId) fail("direct_project_manager_context_custody_mismatch", "projectManagerContextualAdmission");
  const authority = source.authorityDecision; const { validateWorldmodelContextualAuthorityDecision } = require("./semantic-ingress"); validateWorldmodelContextualAuthorityDecision(authority, { graph });
  if (authority.actorAgentId !== profile.projectManagerAgentId || authority.actorRole !== "project_manager" || authority.targetScope.projectId !== profile.projectId) fail("direct_project_manager_context_authority_mismatch", "projectManagerContextualAdmission");
  const { requireGovernanceProvenanceAdmission, registryRef } = require("./governance-provenance-registry");
  const requiredArtifacts = contextualRequiredArtifacts({ graph, world, profile, custodyMatrix, custodyWitness, authority, parentDelegation: source.parentDelegation });
  const authoritative = resolveAuthoritativeProjectManagerContext({ ...source, projectManagerProfile: profile }, requiredArtifacts);
  const registryContext = { registryRef: authoritative.registryRef, expectedRegistryRevision: authoritative.governanceRegistry.revision, graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: profile.projectId, projectRootNodeId: profile.projectRootNodeId, role: "project_manager", agentId: profile.projectManagerAgentId, purpose: "manager_context", expectedScopeRevisionDigest: state.projectRevisionRef.digest, requiredArtifacts };
  requireGovernanceProvenanceAdmission(authoritative.governanceRegistry, registryContext);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "world_manager_profile", world);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "project_manager_profile", profile);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "project_root", graph.nodes.find((node) => node.nodeId === profile.projectRootNodeId));
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "custody_matrix", custodyMatrix);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "custody_witness", custodyWitness);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "authority_decision", authority);
  if (source.threadManagerProfile || source.workThread) validateExactThreadAndWorkThreadBodies(source.threadManagerProfile, source.workThread, profile);
  const result = { schema: PROJECT_MANAGER_CONTEXTUAL_ADMISSION_SCHEMA, admissionId: normalizeId(source.admissionId || source.id, "project_manager_contextual_admission"), graphRef: { id: graph.graphId, digest: graph.digest }, worldManagerProfileRef: { id: world.managerProfileId, digest: world.profileDigest }, projectManagerProfileRef: { id: profile.projectManagerProfileId, digest: profile.profileDigest }, projectWorldStateRef: { id: state.projectId, digest: state.projectWorldDigest }, projectRootRef: { id: profile.projectRootNodeId, digest: graph.nodes.find((node) => node.nodeId === profile.projectRootNodeId).digest }, projectRevisionRef: state.projectRevisionRef, custodyMatrixRef: { id: custodyMatrix.matrixId, digest: custodyMatrix.matrixDigest }, custodyWriteWitnessRef: { id: custodyWitness.matrixRef.id, digest: custodyWitness.writeWitnessDigest }, authorityDecisionRef: { id: authority.authorityDecisionId, digest: authority.digest }, registryRef: authoritative.registryRef, registryRevision: authoritative.governanceRegistry.revision, registryRequiredArtifacts: requiredArtifacts, storeAdmissionRef: { id: source.storeAdmission.admissionId, digest: source.storeAdmission.digest, storeRevision: source.storeAdmission.storeRevision }, ...(source.threadManagerProfile ? { threadManagerProfileRef: { id: source.threadManagerProfile.threadManagerProfileId, digest: source.threadManagerProfile.profileDigest }, workThreadRef: { id: source.workThread?.workThreadId, digest: source.workThread?.digest } } : {}), oneShot: true, expiresAt: authority.expiresAt, legacyRefOnlyAdmissible: false, rawTextIncluded: false };
  result.admissionDigest = digest("direct-project-manager-contextual-admission@1", result); validateProjectManagerContextualAdmission(result, { ...source, graph, worldManagerProfile: world, projectManagerProfile: profile, projectWorldState: state, custodyMatrix, custodyWriteWitness: custodyWitness, authorityDecision: authority, governanceRegistry: source.governanceRegistry, threadManagerProfile: source.threadManagerProfile, workThread: source.workThread }); return result;
}

function validateProjectManagerContextualAdmission(value, context = {}) {
  object(value, "projectManagerContextualAdmission"); if (value.schema !== PROJECT_MANAGER_CONTEXTUAL_ADMISSION_SCHEMA || value.oneShot !== true || value.legacyRefOnlyAdmissible !== false || value.rawTextIncluded !== false) fail("direct_project_manager_context_admission_invalid", "projectManagerContextualAdmission");
  validateProjectWorldStateAgainstContext(context.projectWorldState, { graph: context.graph, projectManagerProfile: context.projectManagerProfile, worldManagerProfile: context.worldManagerProfile }); validateProjectCustodyWriteMatrix(context.custodyMatrix); validateProjectCustodyWriteWitness(context.custodyWriteWitness); const { validateWorldmodelContextualAuthorityDecision } = require("./semantic-ingress"); validateWorldmodelContextualAuthorityDecision(context.authorityDecision, { graph: context.graph });
  const profile = context.projectManagerProfile; const graph = context.graph; const expectedRoot = graph.nodes.find((node) => node.nodeId === profile.projectRootNodeId); if (value.graphRef.id !== graph.graphId || value.graphRef.digest !== graph.digest || value.worldManagerProfileRef.id !== context.worldManagerProfile.managerProfileId || value.worldManagerProfileRef.digest !== context.worldManagerProfile.profileDigest || value.projectManagerProfileRef.id !== profile.projectManagerProfileId || value.projectManagerProfileRef.digest !== profile.profileDigest || value.projectWorldStateRef.digest !== context.projectWorldState.projectWorldDigest || value.projectRootRef.id !== expectedRoot.nodeId || value.projectRootRef.digest !== expectedRoot.digest || value.projectRevisionRef.digest !== context.projectWorldState.projectRevisionRef.digest || value.custodyMatrixRef.digest !== context.custodyMatrix.matrixDigest || value.authorityDecisionRef.id !== context.authorityDecision.authorityDecisionId || value.authorityDecisionRef.digest !== context.authorityDecision.digest || Date.parse(value.expiresAt) <= Date.now()) fail("direct_project_manager_context_admission_mismatch", "projectManagerContextualAdmission");
  const requiredArtifacts = contextualRequiredArtifacts({ graph, world: context.worldManagerProfile, profile, custodyMatrix: context.custodyMatrix, custodyWitness: context.custodyWriteWitness, authority: context.authorityDecision, parentDelegation: context.parentDelegation });
  const authoritative = resolveAuthoritativeProjectManagerContext(context, requiredArtifacts);
  if (!value.storeAdmissionRef || value.storeAdmissionRef.id !== context.storeAdmission.admissionId || value.storeAdmissionRef.digest !== context.storeAdmission.digest || value.storeAdmissionRef.storeRevision !== context.storeAdmission.storeRevision || canonicalJson(value.registryRequiredArtifacts) !== canonicalJson(requiredArtifacts) || value.registryRef.id !== authoritative.registryRef.id || value.registryRef.digest !== authoritative.registryRef.digest || value.registryRevision !== authoritative.governanceRegistry.revision) fail("direct_project_manager_context_store_admission_mismatch", "projectManagerContextualAdmission");
  const { requireGovernanceProvenanceAdmission } = require("./governance-provenance-registry");
  requireGovernanceProvenanceAdmission(authoritative.governanceRegistry, { registryRef: value.registryRef, expectedRegistryRevision: value.registryRevision, graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: profile.projectId, projectRootNodeId: profile.projectRootNodeId, role: "project_manager", agentId: profile.projectManagerAgentId, purpose: "manager_context", expectedScopeRevisionDigest: context.projectWorldState.projectRevisionRef.digest, requiredArtifacts });
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "world_manager_profile", context.worldManagerProfile);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "project_manager_profile", profile);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "project_root", expectedRoot);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "custody_matrix", context.custodyMatrix);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "custody_witness", context.custodyWriteWitness);
  requireExactStoreOwnedBody(authoritative.governanceRegistry, "authority_decision", context.authorityDecision);
  if (value.threadManagerProfileRef || value.workThreadRef) { const thread = context.threadManagerProfile; const workThread = context.workThread; if (!thread || !workThread || workThread.workThreadId !== value.workThreadRef.id || workThread.digest !== value.workThreadRef.digest || thread.threadManagerProfileId !== value.threadManagerProfileRef.id || thread.profileDigest !== value.threadManagerProfileRef.digest) fail("direct_project_manager_context_thread_delegation_mismatch", "projectManagerContextualAdmission"); validateExactThreadAndWorkThreadBodies(thread, workThread, profile); }
  checkDigest(value, "admissionDigest", "direct-project-manager-contextual-admission@1", "projectManagerContextualAdmission"); return true;
}

module.exports = {
  PROJECT_MANAGER_PROFILE_SCHEMA,
  PROJECT_WORLD_STATE_SCHEMA,
  WORLD_MANAGER_TARGET_POSTURE_SCHEMA,
  WORLD_TO_PROJECT_DELEGATION_PACKET_SCHEMA,
  PROJECT_MANAGER_CHAT_MARKER_SCHEMA,
  HIERARCHICAL_WORLDMODEL_MIGRATION_WITNESS_SCHEMA,
  HISTORICAL_WORLD_MANAGER_THREAD_PARENT_ADAPTER_SCHEMA,
  PROJECT_CUSTODY_WRITE_MATRIX_SCHEMA,
  PROJECT_CUSTODY_WRITE_WITNESS_SCHEMA,
  PROJECT_MANAGER_CONTEXTUAL_ADMISSION_SCHEMA,
  PROJECT_OPERATIONAL_PATHS,
  buildProjectManagerProfile,
  validateProjectManagerProfile,
  validateProjectManagerProfileAgainstContext,
  buildProjectWorldState,
  validateProjectWorldState,
  validateProjectWorldStateAgainstContext,
  buildProjectManagerContextualAdmission,
  validateProjectManagerContextualAdmission,
  buildWorldManagerTargetPosture,
  validateWorldManagerTargetPosture,
  buildWorldToProjectDelegationPacket,
  validateWorldToProjectDelegationPacket,
  buildProjectCustodyWriteMatrix,
  validateProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  validateProjectCustodyWriteWitness,
  buildProjectManagerChatMarker,
  validateProjectManagerChatMarker,
  buildHistoricalWorldManagerThreadParentAdapter,
  validateHistoricalWorldManagerThreadParentAdapter,
  buildHierarchicalWorldmodelMigrationWitness,
  validateHierarchicalWorldmodelMigrationWitness,
  buildManagerScopeMigrationWitness,
};
