"use strict";

const {
  canonicalJson,
  sha256,
} = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const {
  normalizeOdeuSourceRefs,
} = require("../odeu/source-ref");
const {
  DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA,
  DIRECT_ODEU_LANE_SECTION_SCHEMA,
  DIRECT_WORLDMODEL_REMAND_SCHEMA,
  DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA,
  DIRECT_WORLDMODEL_UNKNOWN_SCHEMA,
  DIRECT_WORLD_SCOPE_REF_SCHEMA,
  ODEU_LANE_KEYS,
  ODEU_LANE_SCHEMAS,
  ODEU_SECTION_KEYS,
  ODEU_SECTION_LABELS,
  REVISION_COMPATIBILITY_VALUES,
  WORLDMODEL_REMAND_KINDS,
  WORLDMODEL_STATUSES,
  WORLDMODEL_UNKNOWN_KINDS,
  WORLD_SCOPE_KINDS,
} = require("./constants");

const LANE_KEY_TO_KIND = Object.freeze({
  task: "task",
  environment: "artifact_environment",
  modelSelf: "model_self",
  governance: "interaction_governance",
});

const WORLDMODEL_DIGEST_FIELDS = new Set([
  "digest",
  "scopeDigest",
  "sectionDigest",
  "laneDigest",
  "unknownDigest",
  "remandDigest",
  "compatibilityDigest",
  "projectionRefDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_worldmodel_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_worldmodel_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_worldmodel_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function integerAtLeast(value, fallback, min = 1) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= min) return number;
  return fallback;
}

function normalizeEntry(input = {}, index = 0, fallbackPrefix = "entry", options = {}) {
  const source = typeof input === "string" ? { statement: input } : isPlainObject(input) ? input : {};
  const statement = normalizeString(source.statement || source.summary || source.label, "");
  return {
    entryId: normalizeId(source.entryId || source.id, `${fallbackPrefix}_${index + 1}`),
    statement,
    posture: normalizeString(source.posture || source.status, "accepted"),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
  };
}

function validateOptionalLaneKey(laneKey, label) {
  const normalized = normalizeString(laneKey, "");
  if (normalized && !ODEU_LANE_KEYS.includes(normalized)) {
    throw validationError("direct_worldmodel_invalid_lane_key", label);
  }
  return true;
}

function normalizeLaneSection(sectionKey, input = {}, options = {}) {
  const source = typeof input === "string" || Array.isArray(input)
    ? { entries: Array.isArray(input) ? input : [input] }
    : isPlainObject(input) ? input : {};
  const entries = (Array.isArray(source.entries) ? source.entries : [])
    .map((entry, index) => normalizeEntry(entry, index, `${sectionKey.toLowerCase()}_${options.laneKind || "lane"}`, options));
  const summary = normalizeString(source.summary, entries.map((entry) => entry.statement).filter(Boolean).join("; "));
  const section = {
    schema: DIRECT_ODEU_LANE_SECTION_SCHEMA,
    sectionKey,
    sectionLabel: ODEU_SECTION_LABELS[sectionKey] || "unknown",
    summary,
    entries,
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs || options.sourceRefs, options),
  };
  section.sectionDigest = worldmodelDigestFor("direct-odeu-lane-section@1", section);
  return section;
}

function normalizeOdeuLane(laneKey, input = {}, options = {}) {
  const laneKind = LANE_KEY_TO_KIND[laneKey] || normalizeString(input.laneKind, laneKey);
  const source = isPlainObject(input) ? input : {};
  const lane = {
    schema: ODEU_LANE_SCHEMAS[laneKind],
    laneId: normalizeId(source.laneId || source.id, `${laneKind}_lane`),
    laneKind,
    status: pickEnum(source.status, WORLDMODEL_STATUSES, "partial"),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs || options.sourceRefs, options),
  };
  for (const sectionKey of ODEU_SECTION_KEYS) {
    lane[sectionKey] = normalizeLaneSection(sectionKey, source[sectionKey], {
      ...options,
      laneKind,
      sourceRefs: lane.sourceRefs,
    });
  }
  lane.laneDigest = worldmodelDigestFor("direct-odeu-lane@1", lane);
  return lane;
}

function normalizeWorldScopeRef(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const scopeKind = pickEnum(source.scopeKind, WORLD_SCOPE_KINDS, "session");
  const scope = {
    schema: DIRECT_WORLD_SCOPE_REF_SCHEMA,
    scopeKind,
    userProfileId: normalizeId(source.userProfileId, "user_profile"),
  };
  if (scopeKind === "project" || scopeKind === "work_thread" || (scopeKind === "session" && source.projectId)) {
    scope.projectId = normalizeId(source.projectId, "project");
  }
  if (scopeKind === "work_thread" || (scopeKind === "session" && source.workThreadId)) {
    scope.workThreadId = normalizeId(source.workThreadId, "work_thread");
  }
  if (scopeKind === "session") {
    scope.sessionId = normalizeId(source.sessionId, "direct_session");
  }
  scope.scopeDigest = worldmodelDigestFor("direct-world-scope-ref@1", scope);
  return scope;
}

function validateWorldScopeRef(scope) {
  requirePlainObject(scope, "scope");
  if (scope.schema !== DIRECT_WORLD_SCOPE_REF_SCHEMA) {
    throw validationError("direct_worldmodel_schema_mismatch", "scope");
  }
  if (!WORLD_SCOPE_KINDS.includes(scope.scopeKind)) {
    throw validationError("direct_worldmodel_invalid_scope_kind", String(scope.scopeKind || ""));
  }
  requireString(scope.userProfileId, "scope.userProfileId");
  if (scope.scopeKind === "project") requireString(scope.projectId, "scope.projectId");
  if (scope.scopeKind === "work_thread") {
    requireString(scope.projectId, "scope.projectId");
    requireString(scope.workThreadId, "scope.workThreadId");
  }
  if (scope.scopeKind === "session") requireString(scope.sessionId, "scope.sessionId");
  validateComputedDigest(scope, "scopeDigest", "direct-world-scope-ref@1", "scope");
  return true;
}

function validateOdeuDigestObject(value, label) {
  requirePlainObject(value, label);
  const hasValue = normalizeString(value.algorithm, "") && normalizeString(value.value, "");
  const hasUnavailableReason = normalizeString(value.unavailableReason, "");
  if (!hasValue && !hasUnavailableReason) {
    throw validationError("direct_worldmodel_invalid_digest", label);
  }
  return true;
}

function validateSourceRef(sourceRef, label) {
  requirePlainObject(sourceRef, label);
  if (sourceRef.schema !== "odeu_source_ref@1") {
    throw validationError("direct_worldmodel_invalid_source_ref", label);
  }
  requireString(sourceRef.sourceRefId, `${label}.sourceRefId`);
  requireString(sourceRef.sourceKind, `${label}.sourceKind`);
  validateOdeuDigestObject(sourceRef.sourceDigest, `${label}.sourceDigest`);
  return true;
}

function validateSourceRefs(sourceRefs, label) {
  requireArray(sourceRefs, label);
  sourceRefs.forEach((sourceRef, index) => validateSourceRef(sourceRef, `${label}.${index}`));
  return true;
}

function normalizeWorldmodelUnknown(input = {}, index = 0, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const unknown = {
    schema: DIRECT_WORLDMODEL_UNKNOWN_SCHEMA,
    unknownId: normalizeId(source.unknownId || source.id, `worldmodel_unknown_${index + 1}`),
    unknownKind: pickEnum(source.unknownKind || source.kind, WORLDMODEL_UNKNOWN_KINDS, "other"),
    laneKey: normalizeString(source.laneKey, ""),
    summary: normalizeString(source.summary || source.reason, "unknown worldmodel fact"),
    severity: normalizeString(source.severity, "medium"),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
  };
  unknown.unknownDigest = worldmodelDigestFor("direct-worldmodel-unknown@1", unknown);
  return unknown;
}

function normalizeWorldmodelRemand(input = {}, index = 0, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const remand = {
    schema: DIRECT_WORLDMODEL_REMAND_SCHEMA,
    remandId: normalizeId(source.remandId || source.id, `worldmodel_remand_${index + 1}`),
    remandKind: pickEnum(source.remandKind || source.kind, WORLDMODEL_REMAND_KINDS, "other"),
    laneKey: normalizeString(source.laneKey, ""),
    summary: normalizeString(source.summary || source.reason, "worldmodel remand"),
    requiredBy: normalizeString(source.requiredBy, "manager"),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  remand.remandDigest = worldmodelDigestFor("direct-worldmodel-remand@1", remand);
  return remand;
}

function stableWorldmodelValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableWorldmodelValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (WORLDMODEL_DIGEST_FIELDS.has(key)) continue;
    const nextValue = value[key];
    if (typeof nextValue !== "undefined") output[key] = stableWorldmodelValue(nextValue);
  }
  return output;
}

function worldmodelDigestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableWorldmodelValue(value))}`);
}

function validateComputedDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== worldmodelDigestFor(domain, value)) {
    throw validationError("direct_worldmodel_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function directWorldmodelDigest(worldmodel) {
  return worldmodelDigestFor("direct-active-interaction-worldmodel@1", worldmodel);
}

// ActiveInteractionWorldmodel remains a role/run projection.  This optional
// witness lets newer callers say exactly which Wave 26 graph revision it was
// compiled from without changing historical rows or making the graph required.
function normalizeHierarchicalGraphProjectionRef(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    schema: "direct_hierarchical_worldmodel_projection_ref@1",
    graphId: normalizeId(source.graphId, "hierarchical_worldmodel_graph"),
    graphDigest: normalizeString(source.graphDigest, "sha256:unavailable"),
    scopeKind: normalizeString(source.scopeKind, "user_world"),
    scopeRevision: integerAtLeast(source.scopeRevision, 0, 0),
    scopeRevisionDigest: normalizeString(source.scopeRevisionDigest, "sha256:unavailable"),
  };
  ref.projectionRefDigest = worldmodelDigestFor("direct-hierarchical-worldmodel-projection-ref@1", ref);
  return ref;
}

function validateHierarchicalGraphProjectionRef(ref, label = "hierarchicalGraphProjectionRef") {
  requirePlainObject(ref, label);
  if (ref.schema !== "direct_hierarchical_worldmodel_projection_ref@1") {
    throw validationError("direct_worldmodel_schema_mismatch", label);
  }
  requireString(ref.graphId, `${label}.graphId`);
  requireString(ref.graphDigest, `${label}.graphDigest`);
  requireString(ref.scopeKind, `${label}.scopeKind`);
  if (!Number.isInteger(ref.scopeRevision) || ref.scopeRevision < 0) {
    throw validationError("direct_worldmodel_invalid_revision", `${label}.scopeRevision`);
  }
  requireString(ref.scopeRevisionDigest, `${label}.scopeRevisionDigest`);
  validateComputedDigest(ref, "projectionRefDigest", "direct-hierarchical-worldmodel-projection-ref@1", label);
  return true;
}

function buildActiveInteractionWorldmodel(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const createdAt = normalizeString(source.createdAt, nowIso(options.now || Date.now));
  const updatedAt = normalizeString(source.updatedAt, createdAt);
  const worldmodelId = normalizeId(source.worldmodelId, "worldmodel");
  const sourceRefs = normalizeOdeuSourceRefs(source.sourceRefs, options);
  const worldmodel = {
    schema: DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA,
    worldmodelId,
    rootWorldmodelId: normalizeId(source.rootWorldmodelId || worldmodelId, "worldmodel_root"),
    scope: normalizeWorldScopeRef(source.scope),
    managerAgentId: normalizeId(source.managerAgentId, "worldmodel_manager"),
    createdAt,
    updatedAt,
    revision: integerAtLeast(source.revision, 1, 1),
    task: normalizeOdeuLane("task", source.task, { sourceRefs }),
    environment: normalizeOdeuLane("environment", source.environment, { sourceRefs }),
    modelSelf: normalizeOdeuLane("modelSelf", source.modelSelf, { sourceRefs }),
    governance: normalizeOdeuLane("governance", source.governance, { sourceRefs }),
    sourceRefs,
    staleRefs: normalizeOdeuSourceRefs(source.staleRefs, options),
    unknowns: (Array.isArray(source.unknowns) ? source.unknowns : []).map((entry, index) => normalizeWorldmodelUnknown(entry, index, options)),
    openRemands: (Array.isArray(source.openRemands) ? source.openRemands : []).map((entry, index) => normalizeWorldmodelRemand(entry, index, options)),
  };
  const parentWorldmodelId = normalizeString(source.parentWorldmodelId, "");
  if (parentWorldmodelId) worldmodel.parentWorldmodelId = normalizeId(parentWorldmodelId, "worldmodel_parent");
  const subjectAgentId = normalizeString(source.subjectAgentId, "");
  if (subjectAgentId) worldmodel.subjectAgentId = normalizeId(subjectAgentId, "subject_agent");
  const activeThreadId = normalizeString(source.activeThreadId, "");
  if (activeThreadId) worldmodel.activeThreadId = normalizeId(activeThreadId, "direct_thread");
  const previousDigest = normalizeString(source.previousDigest, "");
  if (previousDigest) worldmodel.previousDigest = previousDigest;
  if (isPlainObject(source.hierarchicalGraphProjectionRef)) {
    worldmodel.hierarchicalGraphProjectionRef = normalizeHierarchicalGraphProjectionRef(source.hierarchicalGraphProjectionRef);
  }
  worldmodel.digest = directWorldmodelDigest(worldmodel);
  return worldmodel;
}

function validateLaneSection(section, label) {
  requirePlainObject(section, label);
  if (section.schema !== DIRECT_ODEU_LANE_SECTION_SCHEMA) {
    throw validationError("direct_worldmodel_schema_mismatch", label);
  }
  if (!ODEU_SECTION_KEYS.includes(section.sectionKey)) {
    throw validationError("direct_worldmodel_invalid_section", label);
  }
  requireArray(section.entries, `${label}.entries`);
  validateSourceRefs(section.sourceRefs, `${label}.sourceRefs`);
  section.entries.forEach((entry, index) => validateSourceRefs(entry.sourceRefs, `${label}.entries.${index}.sourceRefs`));
  validateComputedDigest(section, "sectionDigest", "direct-odeu-lane-section@1", label);
  return true;
}

function validateOdeuLane(lane, laneKey) {
  const laneKind = LANE_KEY_TO_KIND[laneKey] || laneKey;
  requirePlainObject(lane, laneKey);
  if (lane.schema !== ODEU_LANE_SCHEMAS[laneKind]) {
    throw validationError("direct_worldmodel_schema_mismatch", laneKey);
  }
  requireString(lane.laneId, `${laneKey}.laneId`);
  if (lane.laneKind !== laneKind) throw validationError("direct_worldmodel_invalid_lane_kind", laneKey);
  if (!WORLDMODEL_STATUSES.includes(lane.status)) throw validationError("direct_worldmodel_invalid_lane_status", laneKey);
  validateSourceRefs(lane.sourceRefs, `${laneKey}.sourceRefs`);
  for (const sectionKey of ODEU_SECTION_KEYS) validateLaneSection(lane[sectionKey], `${laneKey}.${sectionKey}`);
  validateComputedDigest(lane, "laneDigest", "direct-odeu-lane@1", laneKey);
  return true;
}

function validateUnknown(unknown, label) {
  requirePlainObject(unknown, label);
  if (unknown.schema !== DIRECT_WORLDMODEL_UNKNOWN_SCHEMA) throw validationError("direct_worldmodel_schema_mismatch", label);
  requireString(unknown.unknownId, `${label}.unknownId`);
  if (!WORLDMODEL_UNKNOWN_KINDS.includes(unknown.unknownKind)) throw validationError("direct_worldmodel_invalid_unknown_kind", label);
  validateOptionalLaneKey(unknown.laneKey, `${label}.laneKey`);
  requireString(unknown.summary, `${label}.summary`);
  validateSourceRefs(unknown.sourceRefs, `${label}.sourceRefs`);
  validateComputedDigest(unknown, "unknownDigest", "direct-worldmodel-unknown@1", label);
  return true;
}

function validateRemand(remand, label) {
  requirePlainObject(remand, label);
  if (remand.schema !== DIRECT_WORLDMODEL_REMAND_SCHEMA) throw validationError("direct_worldmodel_schema_mismatch", label);
  requireString(remand.remandId, `${label}.remandId`);
  if (!WORLDMODEL_REMAND_KINDS.includes(remand.remandKind)) throw validationError("direct_worldmodel_invalid_remand_kind", label);
  validateOptionalLaneKey(remand.laneKey, `${label}.laneKey`);
  requireString(remand.summary, `${label}.summary`);
  validateSourceRefs(remand.sourceRefs, `${label}.sourceRefs`);
  validateComputedDigest(remand, "remandDigest", "direct-worldmodel-remand@1", label);
  return true;
}

function validateActiveInteractionWorldmodel(worldmodel, options = {}) {
  requirePlainObject(worldmodel, "worldmodel");
  if (worldmodel.schema !== DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA) {
    throw validationError("direct_worldmodel_schema_mismatch", "worldmodel");
  }
  requireString(worldmodel.worldmodelId, "worldmodel.worldmodelId");
  requireString(worldmodel.rootWorldmodelId, "worldmodel.rootWorldmodelId");
  validateWorldScopeRef(worldmodel.scope);
  requireString(worldmodel.managerAgentId, "worldmodel.managerAgentId");
  requireString(worldmodel.createdAt, "worldmodel.createdAt");
  requireString(worldmodel.updatedAt, "worldmodel.updatedAt");
  for (const optionalField of ["parentWorldmodelId", "subjectAgentId", "activeThreadId"]) {
    if (Object.prototype.hasOwnProperty.call(worldmodel, optionalField)) {
      requireString(worldmodel[optionalField], `worldmodel.${optionalField}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(worldmodel, "previousDigest")) {
    const previousDigest = requireString(worldmodel.previousDigest, "worldmodel.previousDigest");
    if (!previousDigest.startsWith("sha256:")) {
      throw validationError("direct_worldmodel_invalid_previous_digest", "worldmodel.previousDigest");
    }
  }
  if (Object.prototype.hasOwnProperty.call(worldmodel, "hierarchicalGraphProjectionRef")) {
    validateHierarchicalGraphProjectionRef(worldmodel.hierarchicalGraphProjectionRef);
  }
  if (!Number.isInteger(worldmodel.revision) || worldmodel.revision < 1) {
    throw validationError("direct_worldmodel_invalid_revision", "worldmodel.revision");
  }
  for (const laneKey of ODEU_LANE_KEYS) validateOdeuLane(worldmodel[laneKey], laneKey);
  validateSourceRefs(worldmodel.sourceRefs, "worldmodel.sourceRefs");
  validateSourceRefs(worldmodel.staleRefs, "worldmodel.staleRefs");
  requireArray(worldmodel.unknowns, "worldmodel.unknowns");
  requireArray(worldmodel.openRemands, "worldmodel.openRemands");
  worldmodel.unknowns.forEach((unknown, index) => validateUnknown(unknown, `worldmodel.unknowns.${index}`));
  worldmodel.openRemands.forEach((remand, index) => validateRemand(remand, `worldmodel.openRemands.${index}`));
  const digest = requireString(worldmodel.digest, "worldmodel.digest");
  if (options.verifyDigest !== false && digest !== directWorldmodelDigest(worldmodel)) {
    throw validationError("direct_worldmodel_digest_mismatch", worldmodel.worldmodelId);
  }
  return true;
}

function buildRevisionCompatibility(input = {}) {
  const expectedWorldmodelId = normalizeString(input.expectedWorldmodelId || input.worldmodelId, "");
  const currentWorldmodelId = normalizeString(input.currentWorldmodelId || input.currentWorldmodel?.worldmodelId, "");
  const expectedRevision = integerAtLeast(input.expectedRevision ?? input.worldmodelRevision, 0, 0);
  const currentRevision = integerAtLeast(input.currentRevision ?? input.currentWorldmodel?.revision, 0, 0);
  const currentWorldmodelDigest = normalizeString(input.currentWorldmodelDigest || input.currentWorldmodel?.digest, "");
  let compatibility = "unknown";
  if (expectedWorldmodelId && currentWorldmodelId && expectedWorldmodelId !== currentWorldmodelId) {
    compatibility = "different_worldmodel";
  } else if (expectedRevision && currentRevision) {
    compatibility = expectedRevision === currentRevision ? "same" : expectedRevision < currentRevision ? "stale" : "future";
  }
  const result = {
    schema: DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA,
    expectedWorldmodelId,
    expectedRevision,
    currentWorldmodelId,
    currentRevision,
    currentWorldmodelDigest,
    compatibility: pickEnum(compatibility, REVISION_COMPATIBILITY_VALUES, "unknown"),
    requiresRemand: compatibility !== "same",
    checkedAt: normalizeString(input.checkedAt, nowIso(input.now || Date.now)),
  };
  result.compatibilityDigest = worldmodelDigestFor("direct-worldmodel-revision-compatibility@1", result);
  return result;
}

function validateRevisionCompatibility(value) {
  requirePlainObject(value, "revisionCompatibility");
  if (value.schema !== DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA) {
    throw validationError("direct_worldmodel_schema_mismatch", "revisionCompatibility");
  }
  if (!REVISION_COMPATIBILITY_VALUES.includes(value.compatibility)) {
    throw validationError("direct_worldmodel_invalid_revision_compatibility", String(value.compatibility || ""));
  }
  validateComputedDigest(
    value,
    "compatibilityDigest",
    "direct-worldmodel-revision-compatibility@1",
    "revisionCompatibility",
  );
  return true;
}

module.exports = {
  buildActiveInteractionWorldmodel,
  buildRevisionCompatibility,
  directWorldmodelDigest,
  normalizeHierarchicalGraphProjectionRef,
  normalizeLaneSection,
  normalizeOdeuLane,
  normalizeWorldScopeRef,
  normalizeWorldmodelRemand,
  normalizeWorldmodelUnknown,
  validateActiveInteractionWorldmodel,
  validateHierarchicalGraphProjectionRef,
  validateOdeuLane,
  validateRevisionCompatibility,
  validateSourceRef,
  validateSourceRefs,
  validateWorldScopeRef,
  worldmodelDigestFor,
};
