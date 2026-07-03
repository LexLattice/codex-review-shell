"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const {
  validateActiveInteractionWorldmodel,
} = require("./kernel");

const ODEU_WORLDMODEL_MANAGER_PROFILE_SCHEMA = "odeu_worldmodel_manager_profile@1";
const WORLDMODEL_MANAGER_LEDGER_SCHEMA = "worldmodel_manager_ledger@1";
const WORLDMODEL_MANAGER_LEDGER_ROW_SCHEMA = "worldmodel_manager_ledger_row@1";
const WORLDMODEL_ACTIVE_POINTER_SCHEMA = "worldmodel_active_pointer@1";
const WORLDMODEL_MANAGER_CHAT_MARKER_SCHEMA = "worldmodel_manager_chat_session_marker@1";
const WORLDMODEL_MANAGER_STATUS_PROJECTION_SCHEMA = "worldmodel_manager_status_projection@1";
const WORLDMODEL_CONTROL_PLANE_ACTION_SCHEMA = "worldmodel_manager_control_plane_action@1";
const USER_ROLE_STATE_SCHEMA = "user_role_state@1";

const MANAGER_SCOPE_KINDS = Object.freeze(["global_user", "project", "work_thread"]);
const MANAGER_LEDGER_ROW_KINDS = Object.freeze([
  "manager_profile_created",
  "active_worldmodel_pointer_set",
  "manager_chat_session_marked",
  "user_role_state_recorded",
  "control_plane_action_recorded",
  "worldmodel_status_inspected",
]);
const CONTROL_PLANE_ACTION_KINDS = Object.freeze([
  "inspect_worldmodel_status",
  "set_active_worldmodel_pointer",
  "mark_manager_chat_session",
  "record_user_role_state",
  "create_thread_manager_delegation",
  "request_authorization_resolution",
]);
const WORKER_TASK_ACTION_KINDS = Object.freeze([
  "edit_file",
  "apply_patch",
  "run_command",
  "spawn_worker",
  "send_worker_message",
  "execute_provider_turn",
]);
const USER_ROLE_MODES = Object.freeze(["user_mode", "manager_mode", "admin_mode"]);
const USER_ROLE_POSTURES = Object.freeze(["declared", "inferred", "unknown"]);

const DIGEST_FIELDS = new Set([
  "profileDigest",
  "ledgerDigest",
  "rowDigest",
  "ledgerHeadDigest",
  "pointerDigest",
  "markerDigest",
  "projectionDigest",
  "actionDigest",
  "roleStateDigest",
  "scopeDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_worldmodel_manager_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_worldmodel_manager_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_worldmodel_manager_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_worldmodel_manager_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function refFromDigest(kind, id, digest, label = "") {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function validateArtifactRef(ref, label) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  requireString(ref.id, `${label}.id`);
  requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded !== false || ref.rawPathIncluded !== false || ref.rawSecretIncluded !== false) {
    throw validationError("direct_worldmodel_manager_raw_ref_exposure", label);
  }
  return true;
}

function validateControlPlaneActions(actions, label) {
  requireArray(actions, label);
  for (const action of actions) {
    if (!CONTROL_PLANE_ACTION_KINDS.includes(action)) {
      throw validationError("direct_worldmodel_manager_invalid_control_action", action);
    }
  }
  return true;
}

function validateWorkerTaskActions(actions, label) {
  requireArray(actions, label);
  for (const action of actions) {
    if (!WORKER_TASK_ACTION_KINDS.includes(action)) {
      throw validationError("direct_worldmodel_manager_invalid_worker_action", action);
    }
  }
  return true;
}

function normalizeManagerScope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const scopeKind = pickEnum(source.scopeKind, MANAGER_SCOPE_KINDS, "global_user");
  const scope = {
    schema: "worldmodel_manager_scope@1",
    scopeKind,
    userProfileId: normalizeId(source.userProfileId, "user_profile"),
  };
  if (scopeKind === "project" || scopeKind === "work_thread") {
    scope.projectId = normalizeId(source.projectId, "project");
  }
  if (scopeKind === "work_thread") {
    scope.workThreadId = normalizeId(source.workThreadId, "work_thread");
  }
  scope.scopeDigest = digestFor("worldmodel-manager-scope@1", scope);
  return scope;
}

function validateManagerScope(scope, label = "scope") {
  requirePlainObject(scope, label);
  if (scope.schema !== "worldmodel_manager_scope@1") {
    throw validationError("direct_worldmodel_manager_schema_mismatch", label);
  }
  if (!MANAGER_SCOPE_KINDS.includes(scope.scopeKind)) {
    throw validationError("direct_worldmodel_manager_invalid_scope_kind", label);
  }
  requireString(scope.userProfileId, `${label}.userProfileId`);
  if (scope.scopeKind === "project" || scope.scopeKind === "work_thread") {
    requireString(scope.projectId, `${label}.projectId`);
  }
  if (scope.scopeKind === "work_thread") {
    requireString(scope.workThreadId, `${label}.workThreadId`);
  }
  validateDigest(scope, "scopeDigest", "worldmodel-manager-scope@1", label);
  return true;
}

function profileIdFor(scope, managerAgentId) {
  return `worldmodel_manager_${digestFor("worldmodel-manager-profile-id@1", {
    scope,
    managerAgentId,
  }).slice(7, 31)}`;
}

function buildWorldmodelManagerProfile(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const scope = normalizeManagerScope(source.scope || source);
  const managerAgentId = normalizeId(source.managerAgentId, "agent_worldmodel_manager");
  const createdAt = normalizeString(source.createdAt, nowIso(options.now || Date.now));
  const profile = {
    schema: ODEU_WORLDMODEL_MANAGER_PROFILE_SCHEMA,
    managerProfileId: normalizeString(source.managerProfileId, profileIdFor(scope, managerAgentId)),
    managerAgentId,
    scope,
    roleKind: "worldmodel_manager",
    lifecycleState: normalizeString(source.lifecycleState, "active"),
    controlPlaneOnly: true,
    canExecuteWorkerTasks: false,
    allowedControlPlaneActions: CONTROL_PLANE_ACTION_KINDS.slice(),
    blockedWorkerTaskActions: WORKER_TASK_ACTION_KINDS.slice(),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt,
    updatedAt: normalizeString(source.updatedAt, createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  profile.profileDigest = digestFor("odeu-worldmodel-manager-profile@1", profile);
  return profile;
}

function validateWorldmodelManagerProfile(profile) {
  requirePlainObject(profile, "managerProfile");
  if (profile.schema !== ODEU_WORLDMODEL_MANAGER_PROFILE_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "managerProfile");
  }
  requireString(profile.managerProfileId, "managerProfile.managerProfileId");
  requireString(profile.managerAgentId, "managerProfile.managerAgentId");
  validateManagerScope(profile.scope, "managerProfile.scope");
  if (profile.roleKind !== "worldmodel_manager") {
    throw validationError("direct_worldmodel_manager_invalid_role_kind", "managerProfile.roleKind");
  }
  if (profile.controlPlaneOnly !== true || profile.canExecuteWorkerTasks !== false) {
    throw validationError("direct_worldmodel_manager_worker_boundary_violation", "managerProfile");
  }
  validateControlPlaneActions(profile.allowedControlPlaneActions, "managerProfile.allowedControlPlaneActions");
  validateWorkerTaskActions(profile.blockedWorkerTaskActions, "managerProfile.blockedWorkerTaskActions");
  validateDigest(profile, "profileDigest", "odeu-worldmodel-manager-profile@1", "managerProfile");
  return true;
}

function buildActiveWorldmodelPointer(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const worldmodel = source.worldmodel;
  if (worldmodel) validateActiveInteractionWorldmodel(worldmodel);
  const worldmodelId = normalizeString(source.worldmodelId || worldmodel?.worldmodelId, "");
  const worldmodelDigest = normalizeString(source.worldmodelDigest || worldmodel?.digest, "");
  const pointer = {
    schema: WORLDMODEL_ACTIVE_POINTER_SCHEMA,
    pointerId: normalizeId(source.pointerId, "worldmodel_pointer"),
    managerProfileId: requireString(source.managerProfileId, "activePointer.managerProfileId"),
    worldmodelId: requireString(worldmodelId, "activePointer.worldmodelId"),
    worldmodelRevision: Number.isInteger(source.worldmodelRevision)
      ? source.worldmodelRevision
      : Number(worldmodel?.revision || 0),
    worldmodelDigest: requireString(worldmodelDigest, "activePointer.worldmodelDigest"),
    ledgerRowId: normalizeString(source.ledgerRowId, ""),
    ledgerHeadDigest: normalizeString(source.ledgerHeadDigest, ""),
    setAt: normalizeString(source.setAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!Number.isInteger(pointer.worldmodelRevision) || pointer.worldmodelRevision < 1) {
    throw validationError("direct_worldmodel_manager_invalid_revision", "activePointer.worldmodelRevision");
  }
  pointer.pointerDigest = digestFor("worldmodel-active-pointer@1", pointer);
  return pointer;
}

function validateActiveWorldmodelPointer(pointer) {
  requirePlainObject(pointer, "activePointer");
  if (pointer.schema !== WORLDMODEL_ACTIVE_POINTER_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "activePointer");
  }
  requireString(pointer.pointerId, "activePointer.pointerId");
  requireString(pointer.managerProfileId, "activePointer.managerProfileId");
  requireString(pointer.worldmodelId, "activePointer.worldmodelId");
  requireString(pointer.worldmodelDigest, "activePointer.worldmodelDigest");
  if (!Number.isInteger(pointer.worldmodelRevision) || pointer.worldmodelRevision < 1) {
    throw validationError("direct_worldmodel_manager_invalid_revision", "activePointer.worldmodelRevision");
  }
  validateDigest(pointer, "pointerDigest", "worldmodel-active-pointer@1", "activePointer");
  return true;
}

function buildManagerChatSessionMarker(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const marker = {
    schema: WORLDMODEL_MANAGER_CHAT_MARKER_SCHEMA,
    markerId: normalizeId(source.markerId, "worldmodel_manager_chat"),
    managerProfileId: requireString(source.managerProfileId, "managerChatMarker.managerProfileId"),
    managerAgentId: requireString(source.managerAgentId, "managerChatMarker.managerAgentId"),
    sessionId: requireString(source.sessionId || source.threadId, "managerChatMarker.sessionId"),
    sessionKind: normalizeString(source.sessionKind, "direct_manager_chat"),
    identityMarker: "worldmodel_manager_direct_chat",
    canExecuteWorkerTasks: false,
    markedAt: normalizeString(source.markedAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  marker.markerDigest = digestFor("worldmodel-manager-chat-marker@1", marker);
  return marker;
}

function validateManagerChatSessionMarker(marker) {
  requirePlainObject(marker, "managerChatMarker");
  if (marker.schema !== WORLDMODEL_MANAGER_CHAT_MARKER_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "managerChatMarker");
  }
  requireString(marker.markerId, "managerChatMarker.markerId");
  requireString(marker.managerProfileId, "managerChatMarker.managerProfileId");
  requireString(marker.managerAgentId, "managerChatMarker.managerAgentId");
  requireString(marker.sessionId, "managerChatMarker.sessionId");
  if (marker.identityMarker !== "worldmodel_manager_direct_chat" || marker.canExecuteWorkerTasks !== false) {
    throw validationError("direct_worldmodel_manager_invalid_chat_marker", "managerChatMarker");
  }
  validateDigest(marker, "markerDigest", "worldmodel-manager-chat-marker@1", "managerChatMarker");
  return true;
}

function buildUserRoleState(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const roleState = {
    schema: USER_ROLE_STATE_SCHEMA,
    roleStateId: normalizeId(source.roleStateId, "user_role_state"),
    userProfileId: normalizeId(source.userProfileId, "user_profile"),
    activeMode: pickEnum(source.activeMode, USER_ROLE_MODES, "user_mode"),
    posture: pickEnum(source.posture, USER_ROLE_POSTURES, "declared"),
    managerProfileId: normalizeString(source.managerProfileId, ""),
    adminPolicyUpdateEnabled: false,
    maySelfGrantAuthority: false,
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  roleState.roleStateDigest = digestFor("user-role-state@1", roleState);
  return roleState;
}

function validateUserRoleState(roleState) {
  requirePlainObject(roleState, "userRoleState");
  if (roleState.schema !== USER_ROLE_STATE_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "userRoleState");
  }
  requireString(roleState.roleStateId, "userRoleState.roleStateId");
  requireString(roleState.userProfileId, "userRoleState.userProfileId");
  if (!USER_ROLE_MODES.includes(roleState.activeMode)) {
    throw validationError("direct_worldmodel_manager_invalid_user_role_mode", "userRoleState.activeMode");
  }
  if (!USER_ROLE_POSTURES.includes(roleState.posture)) {
    throw validationError("direct_worldmodel_manager_invalid_user_role_posture", "userRoleState.posture");
  }
  if (roleState.adminPolicyUpdateEnabled !== false || roleState.maySelfGrantAuthority !== false) {
    throw validationError("direct_worldmodel_manager_user_role_boundary_violation", "userRoleState");
  }
  validateDigest(roleState, "roleStateDigest", "user-role-state@1", "userRoleState");
  return true;
}

function buildWorldmodelManagerControlPlaneAction(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const requestedActionKind = normalizeString(source.actionKind || source.requestedActionKind, "inspect_worldmodel_status");
  const isControlPlaneAction = CONTROL_PLANE_ACTION_KINDS.includes(requestedActionKind);
  const isWorkerTaskAction = WORKER_TASK_ACTION_KINDS.includes(requestedActionKind);
  const action = {
    schema: WORLDMODEL_CONTROL_PLANE_ACTION_SCHEMA,
    actionId: normalizeId(source.actionId, "worldmodel_manager_action"),
    managerProfileId: requireString(source.managerProfileId, "managerAction.managerProfileId"),
    requestedActionKind,
    actionClass: isControlPlaneAction ? "control_plane" : isWorkerTaskAction ? "worker_task" : "unknown",
    status: isControlPlaneAction ? "allowed" : "blocked",
    blockerCode: isControlPlaneAction ? "" : isWorkerTaskAction ? "manager_cannot_execute_worker_tasks" : "unsupported_manager_action",
    targetWorldmodelId: normalizeString(source.targetWorldmodelId, ""),
    targetThreadId: normalizeString(source.targetThreadId, ""),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  action.actionDigest = digestFor("worldmodel-manager-control-plane-action@1", action);
  return action;
}

function validateWorldmodelManagerControlPlaneAction(action) {
  requirePlainObject(action, "managerAction");
  if (action.schema !== WORLDMODEL_CONTROL_PLANE_ACTION_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "managerAction");
  }
  requireString(action.actionId, "managerAction.actionId");
  requireString(action.managerProfileId, "managerAction.managerProfileId");
  requireString(action.requestedActionKind, "managerAction.requestedActionKind");
  if (action.actionClass === "worker_task" && action.status !== "blocked") {
    throw validationError("direct_worldmodel_manager_worker_boundary_violation", "managerAction");
  }
  validateDigest(action, "actionDigest", "worldmodel-manager-control-plane-action@1", "managerAction");
  return true;
}

function normalizeLedgerArtifactRefs(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const refs = [];
  if (source.managerProfile) {
    refs.push(refFromDigest(
      "worldmodel_manager_profile",
      source.managerProfile.managerProfileId,
      source.managerProfile.profileDigest,
      "Worldmodel manager profile",
    ));
  }
  if (source.worldmodel) {
    refs.push(refFromDigest(
      "active_interaction_worldmodel",
      source.worldmodel.worldmodelId,
      source.worldmodel.digest,
      "Active interaction worldmodel",
    ));
  }
  if (source.activePointer) {
    refs.push(refFromDigest(
      "active_worldmodel_pointer",
      source.activePointer.pointerId,
      source.activePointer.pointerDigest,
      "Active worldmodel pointer",
    ));
  }
  if (source.chatMarker) {
    refs.push(refFromDigest(
      "manager_chat_marker",
      source.chatMarker.markerId,
      source.chatMarker.markerDigest,
      "Manager chat marker",
    ));
  }
  if (source.userRoleState) {
    refs.push(refFromDigest(
      "user_role_state",
      source.userRoleState.roleStateId,
      source.userRoleState.roleStateDigest,
      "User role state",
    ));
  }
  if (source.action) {
    refs.push(refFromDigest(
      "worldmodel_manager_action",
      source.action.actionId,
      source.action.actionDigest,
      "Worldmodel manager action",
    ));
  }
  return refs;
}

function buildWorldmodelManagerLedgerRow(input = {}, previousRow = null, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const sequence = Number(previousRow?.sequence || 0) + 1;
  const row = {
    schema: WORLDMODEL_MANAGER_LEDGER_ROW_SCHEMA,
    rowId: normalizeId(source.rowId, "worldmodel_manager_row"),
    sequence,
    rowKind: pickEnum(source.rowKind || source.eventKind, MANAGER_LEDGER_ROW_KINDS, "worldmodel_status_inspected"),
    managerProfileId: requireString(source.managerProfileId || source.managerProfile?.managerProfileId, "ledgerRow.managerProfileId"),
    artifactRefs: Array.isArray(source.artifactRefs) ? source.artifactRefs : normalizeLedgerArtifactRefs(source),
    previousRowDigest: normalizeString(previousRow?.rowDigest, ""),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("worldmodel-manager-ledger-row@1", row);
  row.ledgerHeadDigest = row.rowDigest;
  return row;
}

function validateWorldmodelManagerLedgerRow(row, previousRow = null) {
  requirePlainObject(row, "ledgerRow");
  if (row.schema !== WORLDMODEL_MANAGER_LEDGER_ROW_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "ledgerRow");
  }
  requireString(row.rowId, "ledgerRow.rowId");
  requireString(row.managerProfileId, "ledgerRow.managerProfileId");
  if (!MANAGER_LEDGER_ROW_KINDS.includes(row.rowKind)) {
    throw validationError("direct_worldmodel_manager_invalid_ledger_row_kind", "ledgerRow.rowKind");
  }
  if (row.sequence !== Number(previousRow?.sequence || 0) + 1) {
    throw validationError("direct_worldmodel_manager_ledger_sequence_mismatch", "ledgerRow.sequence");
  }
  if (row.previousRowDigest !== normalizeString(previousRow?.rowDigest, "")) {
    throw validationError("direct_worldmodel_manager_ledger_previous_mismatch", "ledgerRow.previousRowDigest");
  }
  requireArray(row.artifactRefs, "ledgerRow.artifactRefs");
  row.artifactRefs.forEach((ref, index) => validateArtifactRef(ref, `ledgerRow.artifactRefs.${index}`));
  validateDigest(row, "rowDigest", "worldmodel-manager-ledger-row@1", "ledgerRow");
  if (row.ledgerHeadDigest !== row.rowDigest) {
    throw validationError("direct_worldmodel_manager_ledger_head_mismatch", "ledgerRow.ledgerHeadDigest");
  }
  return true;
}

function buildWorldmodelManagerLedger(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const managerProfileId = requireString(source.managerProfileId || source.managerProfile?.managerProfileId, "managerLedger.managerProfileId");
  const rows = [];
  let previousRow = null;
  for (const rowInput of Array.isArray(source.rows) ? source.rows : []) {
    const row = rowInput?.schema === WORLDMODEL_MANAGER_LEDGER_ROW_SCHEMA
      ? rowInput
      : buildWorldmodelManagerLedgerRow({ ...rowInput, managerProfileId }, previousRow, options);
    validateWorldmodelManagerLedgerRow(row, previousRow);
    rows.push(row);
    previousRow = row;
  }
  const ledger = {
    schema: WORLDMODEL_MANAGER_LEDGER_SCHEMA,
    ledgerId: normalizeId(source.ledgerId, "worldmodel_manager_ledger"),
    managerProfileId,
    rowCount: rows.length,
    rows,
    ledgerHeadDigest: normalizeString(rows[rows.length - 1]?.ledgerHeadDigest, ""),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ledger.ledgerDigest = digestFor("worldmodel-manager-ledger@1", ledger);
  return ledger;
}

function appendWorldmodelManagerLedgerRow(ledger, input = {}, options = {}) {
  requirePlainObject(ledger, "managerLedger");
  const previousRow = Array.isArray(ledger.rows) ? ledger.rows[ledger.rows.length - 1] : null;
  const row = buildWorldmodelManagerLedgerRow({
    ...input,
    managerProfileId: ledger.managerProfileId,
  }, previousRow, options);
  const next = buildWorldmodelManagerLedger({
    ledgerId: ledger.ledgerId,
    managerProfileId: ledger.managerProfileId,
    rows: [...(Array.isArray(ledger.rows) ? ledger.rows : []), row],
    createdAt: ledger.createdAt,
  }, options);
  return { ledger: next, row };
}

function validateWorldmodelManagerLedger(ledger) {
  requirePlainObject(ledger, "managerLedger");
  if (ledger.schema !== WORLDMODEL_MANAGER_LEDGER_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "managerLedger");
  }
  requireString(ledger.ledgerId, "managerLedger.ledgerId");
  requireString(ledger.managerProfileId, "managerLedger.managerProfileId");
  requireArray(ledger.rows, "managerLedger.rows");
  let previousRow = null;
  for (const row of ledger.rows) {
    validateWorldmodelManagerLedgerRow(row, previousRow);
    if (row.managerProfileId !== ledger.managerProfileId) {
      throw validationError("direct_worldmodel_manager_ledger_manager_mismatch", "managerLedger.rows.managerProfileId");
    }
    previousRow = row;
  }
  if (ledger.rowCount !== ledger.rows.length) {
    throw validationError("direct_worldmodel_manager_ledger_count_mismatch", "managerLedger.rowCount");
  }
  if (ledger.ledgerHeadDigest !== normalizeString(previousRow?.ledgerHeadDigest, "")) {
    throw validationError("direct_worldmodel_manager_ledger_head_mismatch", "managerLedger.ledgerHeadDigest");
  }
  validateDigest(ledger, "ledgerDigest", "worldmodel-manager-ledger@1", "managerLedger");
  return true;
}

function buildWorldmodelManagerStatusProjection(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.managerProfile || {};
  const ledger = source.ledger || {};
  const pointer = source.activePointer || {};
  const marker = source.chatMarker || {};
  const allowedControlPlaneActions = profile.allowedControlPlaneActions || source.allowedControlPlaneActions;
  const blockedWorkerTaskActions = profile.blockedWorkerTaskActions || source.blockedWorkerTaskActions;
  const projection = {
    schema: WORLDMODEL_MANAGER_STATUS_PROJECTION_SCHEMA,
    managerProfileId: normalizeString(profile.managerProfileId || source.managerProfileId, ""),
    managerAgentId: normalizeString(profile.managerAgentId || source.managerAgentId, ""),
    scopeKind: normalizeString(profile.scope?.scopeKind || source.scopeKind, "unknown"),
    activeWorldmodelId: normalizeString(pointer.worldmodelId, ""),
    activeWorldmodelRevision: Number(pointer.worldmodelRevision || 0),
    activePointerPresent: Boolean(pointer.pointerDigest),
    ledgerRowCount: Number(ledger.rowCount || 0),
    ledgerHeadDigest: normalizeString(ledger.ledgerHeadDigest, ""),
    managerChatSessionId: normalizeString(marker.sessionId, ""),
    canInspectWorldmodelStatus: true,
    canExecuteWorkerTasks: false,
    allowedControlPlaneActions: Array.isArray(allowedControlPlaneActions)
      ? allowedControlPlaneActions.filter((action) => CONTROL_PLANE_ACTION_KINDS.includes(action))
      : [],
    blockedWorkerTaskActions: Array.isArray(blockedWorkerTaskActions)
      ? blockedWorkerTaskActions.filter((action) => WORKER_TASK_ACTION_KINDS.includes(action))
      : WORKER_TASK_ACTION_KINDS.slice(),
    warnings: Array.isArray(source.warnings) ? source.warnings.map((warning) => normalizeString(warning, "")).filter(Boolean) : [],
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("worldmodel-manager-status-projection@1", projection);
  return projection;
}

function validateWorldmodelManagerStatusProjection(projection) {
  requirePlainObject(projection, "managerStatusProjection");
  if (projection.schema !== WORLDMODEL_MANAGER_STATUS_PROJECTION_SCHEMA) {
    throw validationError("direct_worldmodel_manager_schema_mismatch", "managerStatusProjection");
  }
  requireString(projection.managerProfileId, "managerStatusProjection.managerProfileId");
  if (projection.canExecuteWorkerTasks !== false) {
    throw validationError("direct_worldmodel_manager_worker_boundary_violation", "managerStatusProjection");
  }
  validateControlPlaneActions(
    projection.allowedControlPlaneActions,
    "managerStatusProjection.allowedControlPlaneActions",
  );
  validateWorkerTaskActions(
    projection.blockedWorkerTaskActions,
    "managerStatusProjection.blockedWorkerTaskActions",
  );
  validateDigest(
    projection,
    "projectionDigest",
    "worldmodel-manager-status-projection@1",
    "managerStatusProjection",
  );
  return true;
}

module.exports = {
  CONTROL_PLANE_ACTION_KINDS,
  MANAGER_LEDGER_ROW_KINDS,
  MANAGER_SCOPE_KINDS,
  ODEU_WORLDMODEL_MANAGER_PROFILE_SCHEMA,
  USER_ROLE_MODES,
  USER_ROLE_STATE_SCHEMA,
  WORKER_TASK_ACTION_KINDS,
  WORLDMODEL_ACTIVE_POINTER_SCHEMA,
  WORLDMODEL_CONTROL_PLANE_ACTION_SCHEMA,
  WORLDMODEL_MANAGER_CHAT_MARKER_SCHEMA,
  WORLDMODEL_MANAGER_LEDGER_ROW_SCHEMA,
  WORLDMODEL_MANAGER_LEDGER_SCHEMA,
  WORLDMODEL_MANAGER_STATUS_PROJECTION_SCHEMA,
  appendWorldmodelManagerLedgerRow,
  buildActiveWorldmodelPointer,
  buildManagerChatSessionMarker,
  buildUserRoleState,
  buildWorldmodelManagerControlPlaneAction,
  buildWorldmodelManagerLedger,
  buildWorldmodelManagerLedgerRow,
  buildWorldmodelManagerProfile,
  buildWorldmodelManagerStatusProjection,
  validateActiveWorldmodelPointer,
  validateManagerChatSessionMarker,
  validateManagerScope,
  validateUserRoleState,
  validateWorldmodelManagerControlPlaneAction,
  validateWorldmodelManagerLedger,
  validateWorldmodelManagerLedgerRow,
  validateWorldmodelManagerProfile,
  validateWorldmodelManagerStatusProjection,
};
