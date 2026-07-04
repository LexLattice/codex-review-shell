"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");

const DIRECT_ENVIRONMENT_REF_SCHEMA = "direct_environment_ref@1";
const DIRECT_ENVIRONMENT_PATH_MAPPING_SCHEMA = "direct_environment_path_mapping@1";
const DIRECT_ENVIRONMENT_CONSTRAINT_SCHEMA = "direct_environment_constraint@1";
const DIRECT_ENVIRONMENT_TOPOLOGY_SCHEMA = "direct_environment_topology@1";
const DIRECT_ENVIRONMENT_TOPOLOGY_COMPATIBILITY_SCHEMA = "direct_environment_topology_compatibility@1";
const DIRECT_TURN_EXECUTION_ENVIRONMENT_SCHEMA = "direct_turn_execution_environment@1";
const DIRECT_ENVIRONMENT_EXECUTION_PROJECTION_SCHEMA = "direct_environment_execution_projection@1";

const DIRECT_ENVIRONMENT_KINDS = Object.freeze(["wsl", "windows", "local", "remote", "unknown"]);
const DIRECT_ENVIRONMENT_SHELLS = Object.freeze(["bash", "powershell", "cmd", "none", "unknown"]);
const ENVIRONMENT_MAPPING_DIRECTIONS = Object.freeze(["one_way", "two_way"]);
const ENVIRONMENT_MAPPING_KINDS = Object.freeze(["wsl_windows_path", "mounted_workspace", "remote_mount", "manual"]);
const ENVIRONMENT_CONSTRAINT_KINDS = Object.freeze([
  "read_only",
  "no_workspace_mutation",
  "no_network",
  "plugin_only",
  "manual_confirmation_required",
  "unknown",
]);
const TURN_ENVIRONMENT_SELECTION_KINDS = Object.freeze([
  "thread_default",
  "explicit_turn_override",
  "tool_scoped_transition",
  "specialist_worker_delegation",
]);
const TURN_ENVIRONMENT_REASONS = Object.freeze([
  "default_work",
  "tool_requires_environment",
  "human_selected",
  "manager_selected",
  "authorization_route",
  "unknown",
]);
const TOPOLOGY_COMPATIBILITY_VALUES = Object.freeze([
  "same",
  "stale",
  "future",
  "different_topology",
  "unknown",
]);
const TOPOLOGY_COMPATIBILITY_WITNESS_KINDS = Object.freeze([
  "not_needed",
  "changed_fields_irrelevant",
  "missing",
]);

const DIGEST_FIELDS = new Set([
  "environmentDigest",
  "mappingDigest",
  "constraintDigest",
  "topologyDigest",
  "compatibilityDigest",
  "turnEnvironmentDigest",
  "executionProjectionDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_environment_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_environment_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_environment_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function integerAtLeast(value, fallback, min = 1) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= min) return number;
  return fallback;
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
    throw validationError("direct_environment_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "environment_evidence") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const source = isPlainObject(value) ? value : {};
      const id = normalizeString(source.id || source.refId || source.artifactId || source.sourceRefId, "");
      const digest = normalizeString(source.digest || source.refDigest || source.artifactDigest || source.sourceDigest, "");
      if (!id && !digest) return null;
      return {
        kind: normalizeString(source.kind || source.refKind || source.sourceKind, fallbackKind),
        id,
        digest,
        label: normalizeString(source.label || source.rendererSafeLabel, fallbackKind),
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
    })
    .filter(Boolean);
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded === true || ref.rawPathIncluded === true || ref.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_ref_exposure", label);
  }
  return true;
}

function validateRefs(refs, label, options = {}) {
  requireArray(refs, label);
  refs.forEach((ref, index) => validateRef(ref, `${label}.${index}`, options));
  return true;
}

function environmentRef(topology, environmentId) {
  const environment = (Array.isArray(topology?.environments) ? topology.environments : [])
    .find((entry) => entry.environmentId === environmentId);
  if (!environment) return null;
  return {
    kind: "direct_environment",
    id: environment.environmentId,
    digest: environment.environmentDigest,
    label: environment.displayLabel,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function topologyRef(topology) {
  const source = isPlainObject(topology) ? topology : {};
  return {
    kind: "direct_environment_topology",
    id: normalizeString(source.topologyId || source.id, ""),
    digest: normalizeString(source.topologyDigest || source.digest, ""),
    revision: Number(source.revision || 0),
    label: normalizeString(source.label, "Direct environment topology"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildDirectEnvironmentRef(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const environmentId = normalizeId(source.environmentId || source.id, "environment");
  const environmentKind = pickEnum(source.environmentKind || source.kind, DIRECT_ENVIRONMENT_KINDS, "unknown");
  const environment = {
    schema: DIRECT_ENVIRONMENT_REF_SCHEMA,
    environmentId,
    environmentKind,
    displayLabel: normalizeString(source.displayLabel || source.label, environmentKind),
    defaultShell: pickEnum(source.defaultShell, DIRECT_ENVIRONMENT_SHELLS, "unknown"),
    availableToolFamilyRefs: normalizeRefs(source.availableToolFamilyRefs || source.toolFamilyRefs, "tool_family"),
    sourceRefs: normalizeRefs(source.sourceRefs, "environment_source"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const workspaceEvidenceKey = normalizeString(source.workspaceEvidenceKey, "");
  if (workspaceEvidenceKey) environment.workspaceEvidenceKey = workspaceEvidenceKey;
  const pathMappingRef = normalizeString(source.pathMappingRef, "");
  if (pathMappingRef) environment.pathMappingRef = pathMappingRef;
  environment.environmentDigest = digestFor("direct-environment-ref@1", environment);
  return environment;
}

function validateDirectEnvironmentRef(environment) {
  requirePlainObject(environment, "environment");
  if (environment.schema !== DIRECT_ENVIRONMENT_REF_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "environment");
  }
  requireString(environment.environmentId, "environment.environmentId");
  if (!DIRECT_ENVIRONMENT_KINDS.includes(environment.environmentKind)) {
    throw validationError("direct_environment_invalid_kind", "environment.environmentKind");
  }
  requireString(environment.displayLabel, "environment.displayLabel");
  if (!DIRECT_ENVIRONMENT_SHELLS.includes(environment.defaultShell)) {
    throw validationError("direct_environment_invalid_shell", "environment.defaultShell");
  }
  validateRefs(environment.availableToolFamilyRefs, "environment.availableToolFamilyRefs", { requireDigest: false });
  validateRefs(environment.sourceRefs, "environment.sourceRefs", { requireDigest: false });
  if (environment.rawTextIncluded === true || environment.rawPathIncluded === true || environment.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "environment");
  }
  validateDigest(environment, "environmentDigest", "direct-environment-ref@1", "environment");
  return true;
}

function buildEnvironmentPathMapping(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const mapping = {
    schema: DIRECT_ENVIRONMENT_PATH_MAPPING_SCHEMA,
    mappingId: normalizeId(source.mappingId || source.id, "environment_path_mapping"),
    fromEnvironmentId: normalizeId(source.fromEnvironmentId, "from_environment"),
    toEnvironmentId: normalizeId(source.toEnvironmentId, "to_environment"),
    fromRootEvidenceKey: requireString(source.fromRootEvidenceKey, "pathMapping.fromRootEvidenceKey"),
    toRootEvidenceKey: requireString(source.toRootEvidenceKey, "pathMapping.toRootEvidenceKey"),
    direction: pickEnum(source.direction, ENVIRONMENT_MAPPING_DIRECTIONS, "one_way"),
    mappingKind: pickEnum(source.mappingKind || source.kind, ENVIRONMENT_MAPPING_KINDS, "manual"),
    readAllowed: source.readAllowed !== false,
    writeAllowed: source.writeAllowed === true,
    destructiveWriteAllowed: false,
    evidenceRefs: normalizeRefs(source.evidenceRefs || source.sourceRefs, "environment_path_mapping_evidence"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  mapping.mappingDigest = digestFor("direct-environment-path-mapping@1", mapping);
  return mapping;
}

function validateEnvironmentPathMapping(mapping) {
  requirePlainObject(mapping, "pathMapping");
  if (mapping.schema !== DIRECT_ENVIRONMENT_PATH_MAPPING_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "pathMapping");
  }
  requireString(mapping.mappingId, "pathMapping.mappingId");
  requireString(mapping.fromEnvironmentId, "pathMapping.fromEnvironmentId");
  requireString(mapping.toEnvironmentId, "pathMapping.toEnvironmentId");
  requireString(mapping.fromRootEvidenceKey, "pathMapping.fromRootEvidenceKey");
  requireString(mapping.toRootEvidenceKey, "pathMapping.toRootEvidenceKey");
  if (!ENVIRONMENT_MAPPING_DIRECTIONS.includes(mapping.direction)) {
    throw validationError("direct_environment_invalid_mapping_direction", "pathMapping.direction");
  }
  if (!ENVIRONMENT_MAPPING_KINDS.includes(mapping.mappingKind)) {
    throw validationError("direct_environment_invalid_mapping_kind", "pathMapping.mappingKind");
  }
  if (mapping.destructiveWriteAllowed !== false) {
    throw validationError("direct_environment_destructive_mapping_write", "pathMapping.destructiveWriteAllowed");
  }
  validateRefs(mapping.evidenceRefs, "pathMapping.evidenceRefs", { requireDigest: false });
  if (mapping.rawTextIncluded === true || mapping.rawPathIncluded === true || mapping.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "pathMapping");
  }
  validateDigest(mapping, "mappingDigest", "direct-environment-path-mapping@1", "pathMapping");
  return true;
}

function buildEnvironmentConstraint(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const constraint = {
    schema: DIRECT_ENVIRONMENT_CONSTRAINT_SCHEMA,
    constraintId: normalizeId(source.constraintId || source.id, "environment_constraint"),
    environmentId: normalizeId(source.environmentId, "environment"),
    constraintKind: pickEnum(source.constraintKind || source.kind, ENVIRONMENT_CONSTRAINT_KINDS, "unknown"),
    rationale: normalizeString(source.rationale || source.summary, "environment constraint"),
    evidenceRefs: normalizeRefs(source.evidenceRefs || source.sourceRefs, "environment_constraint_evidence"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  constraint.constraintDigest = digestFor("direct-environment-constraint@1", constraint);
  return constraint;
}

function validateEnvironmentConstraint(constraint) {
  requirePlainObject(constraint, "environmentConstraint");
  if (constraint.schema !== DIRECT_ENVIRONMENT_CONSTRAINT_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "environmentConstraint");
  }
  requireString(constraint.constraintId, "environmentConstraint.constraintId");
  requireString(constraint.environmentId, "environmentConstraint.environmentId");
  if (!ENVIRONMENT_CONSTRAINT_KINDS.includes(constraint.constraintKind)) {
    throw validationError("direct_environment_invalid_constraint_kind", "environmentConstraint.constraintKind");
  }
  requireString(constraint.rationale, "environmentConstraint.rationale");
  validateRefs(constraint.evidenceRefs, "environmentConstraint.evidenceRefs", { requireDigest: false });
  if (constraint.rawTextIncluded === true || constraint.rawPathIncluded === true || constraint.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "environmentConstraint");
  }
  validateDigest(constraint, "constraintDigest", "direct-environment-constraint@1", "environmentConstraint");
  return true;
}

function buildDirectEnvironmentTopology(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const environments = (Array.isArray(source.environments) ? source.environments : [])
    .map((environment) => buildDirectEnvironmentRef(environment));
  if (!environments.length) {
    environments.push(buildDirectEnvironmentRef({
      environmentId: "environment_default_unknown",
      environmentKind: "unknown",
      displayLabel: "Unknown environment",
      defaultShell: "unknown",
    }));
  }
  const defaultEnvironmentId = normalizeString(source.defaultEnvironmentId, environments[0].environmentId);
  const topology = {
    schema: DIRECT_ENVIRONMENT_TOPOLOGY_SCHEMA,
    topologyId: normalizeId(source.topologyId || source.id, "environment_topology"),
    projectId: normalizeId(source.projectId, "project"),
    defaultEnvironmentId,
    environments,
    mappings: (Array.isArray(source.mappings) ? source.mappings : []).map((mapping) => buildEnvironmentPathMapping(mapping)),
    constraints: (Array.isArray(source.constraints) ? source.constraints : []).map((constraint) => buildEnvironmentConstraint(constraint)),
    revision: integerAtLeast(source.revision, 1, 1),
    observedAt: normalizeString(source.observedAt, nowIso(options.now || Date.now)),
    sourceRefs: normalizeRefs(source.sourceRefs, "environment_topology_source"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const previousDigest = normalizeString(source.previousDigest, "");
  if (previousDigest) topology.previousDigest = previousDigest;
  const expiresAt = normalizeString(source.expiresAt, "");
  if (expiresAt) topology.expiresAt = expiresAt;
  topology.topologyDigest = digestFor("direct-environment-topology@1", topology);
  return topology;
}

function validateDirectEnvironmentTopology(topology) {
  requirePlainObject(topology, "environmentTopology");
  if (topology.schema !== DIRECT_ENVIRONMENT_TOPOLOGY_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "environmentTopology");
  }
  requireString(topology.topologyId, "environmentTopology.topologyId");
  requireString(topology.projectId, "environmentTopology.projectId");
  requireString(topology.defaultEnvironmentId, "environmentTopology.defaultEnvironmentId");
  if (!Number.isInteger(topology.revision) || topology.revision < 1) {
    throw validationError("direct_environment_invalid_revision", "environmentTopology.revision");
  }
  requireString(topology.observedAt, "environmentTopology.observedAt");
  requireArray(topology.environments, "environmentTopology.environments");
  requireArray(topology.mappings, "environmentTopology.mappings");
  requireArray(topology.constraints, "environmentTopology.constraints");
  validateRefs(topology.sourceRefs, "environmentTopology.sourceRefs", { requireDigest: false });
  const environmentIds = new Set();
  for (const [index, environment] of topology.environments.entries()) {
    validateDirectEnvironmentRef(environment);
    if (environmentIds.has(environment.environmentId)) {
      throw validationError("direct_environment_duplicate_environment", `environmentTopology.environments.${index}`);
    }
    environmentIds.add(environment.environmentId);
  }
  if (!environmentIds.has(topology.defaultEnvironmentId)) {
    throw validationError("direct_environment_default_missing", "environmentTopology.defaultEnvironmentId");
  }
  for (const [index, mapping] of topology.mappings.entries()) {
    validateEnvironmentPathMapping(mapping);
    if (!environmentIds.has(mapping.fromEnvironmentId) || !environmentIds.has(mapping.toEnvironmentId)) {
      throw validationError("direct_environment_mapping_unknown_environment", `environmentTopology.mappings.${index}`);
    }
  }
  for (const [index, constraint] of topology.constraints.entries()) {
    validateEnvironmentConstraint(constraint);
    if (!environmentIds.has(constraint.environmentId)) {
      throw validationError("direct_environment_constraint_unknown_environment", `environmentTopology.constraints.${index}`);
    }
  }
  if (topology.previousDigest && !String(topology.previousDigest).startsWith("sha256:")) {
    throw validationError("direct_environment_invalid_previous_digest", "environmentTopology.previousDigest");
  }
  if (topology.rawTextIncluded === true || topology.rawPathIncluded === true || topology.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "environmentTopology");
  }
  validateDigest(topology, "topologyDigest", "direct-environment-topology@1", "environmentTopology");
  return true;
}

function buildTopologyCompatibility(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const expectedTopologyId = normalizeString(source.expectedTopologyId || source.topologyId, "");
  const currentTopologyId = normalizeString(source.currentTopologyId || source.currentTopology?.topologyId, "");
  const expectedRevision = integerAtLeast(source.expectedRevision ?? source.topologyRevision, 0, 0);
  const currentRevision = integerAtLeast(source.currentRevision ?? source.currentTopology?.revision, 0, 0);
  const currentTopologyDigest = normalizeString(source.currentTopologyDigest || source.currentTopology?.topologyDigest, "");
  let compatibility = "unknown";
  if (expectedTopologyId && currentTopologyId && expectedTopologyId !== currentTopologyId) {
    compatibility = "different_topology";
  } else if (expectedRevision && currentRevision) {
    compatibility = expectedRevision === currentRevision ? "same" : expectedRevision < currentRevision ? "stale" : "future";
  }
  compatibility = pickEnum(source.compatibility, TOPOLOGY_COMPATIBILITY_VALUES, compatibility);
  const relevantEnvironmentIds = [...new Set((Array.isArray(source.relevantEnvironmentIds) ? source.relevantEnvironmentIds : [])
    .map((id) => normalizeString(id, ""))
    .filter(Boolean))];
  const relevantMappingIds = [...new Set((Array.isArray(source.relevantMappingIds) ? source.relevantMappingIds : [])
    .map((id) => normalizeString(id, ""))
    .filter(Boolean))];
  const changedEnvironmentIds = [...new Set((Array.isArray(source.changedEnvironmentIds) ? source.changedEnvironmentIds : [])
    .map((id) => normalizeString(id, ""))
    .filter(Boolean))];
  const changedMappingIds = [...new Set((Array.isArray(source.changedMappingIds) ? source.changedMappingIds : [])
    .map((id) => normalizeString(id, ""))
    .filter(Boolean))];
  const changedFieldsRelevant = changedEnvironmentIds.some((id) => relevantEnvironmentIds.includes(id))
    || changedMappingIds.some((id) => relevantMappingIds.includes(id));
  const compatibilityWitnessKind = pickEnum(source.compatibilityWitnessKind, TOPOLOGY_COMPATIBILITY_WITNESS_KINDS, compatibility === "same" ? "not_needed" : "missing");
  const routeMayProceed = compatibility === "same"
    || (compatibility === "stale" && changedFieldsRelevant === false && compatibilityWitnessKind === "changed_fields_irrelevant");
  const compatibilityResult = {
    schema: DIRECT_ENVIRONMENT_TOPOLOGY_COMPATIBILITY_SCHEMA,
    expectedTopologyId,
    expectedRevision,
    currentTopologyId,
    currentRevision,
    currentTopologyDigest,
    compatibility,
    relevantEnvironmentIds,
    relevantMappingIds,
    changedEnvironmentIds,
    changedMappingIds,
    changedFieldsRelevant,
    compatibilityWitnessKind,
    routeMayProceed,
    requiresRemand: !routeMayProceed,
    checkedAt: normalizeString(source.checkedAt, nowIso(source.now || Date.now)),
  };
  compatibilityResult.compatibilityDigest = digestFor("direct-environment-topology-compatibility@1", compatibilityResult);
  return compatibilityResult;
}

function validateTopologyCompatibility(value) {
  requirePlainObject(value, "topologyCompatibility");
  if (value.schema !== DIRECT_ENVIRONMENT_TOPOLOGY_COMPATIBILITY_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "topologyCompatibility");
  }
  if (!TOPOLOGY_COMPATIBILITY_VALUES.includes(value.compatibility)) {
    throw validationError("direct_environment_invalid_topology_compatibility", "topologyCompatibility.compatibility");
  }
  if (!TOPOLOGY_COMPATIBILITY_WITNESS_KINDS.includes(value.compatibilityWitnessKind)) {
    throw validationError("direct_environment_invalid_topology_witness", "topologyCompatibility.compatibilityWitnessKind");
  }
  requireArray(value.relevantEnvironmentIds, "topologyCompatibility.relevantEnvironmentIds");
  requireArray(value.relevantMappingIds, "topologyCompatibility.relevantMappingIds");
  requireArray(value.changedEnvironmentIds, "topologyCompatibility.changedEnvironmentIds");
  requireArray(value.changedMappingIds, "topologyCompatibility.changedMappingIds");
  if (value.routeMayProceed === true && value.requiresRemand === true) {
    throw validationError("direct_environment_invalid_topology_route_state", "topologyCompatibility");
  }
  validateDigest(value, "compatibilityDigest", "direct-environment-topology-compatibility@1", "topologyCompatibility");
  return true;
}

function buildTurnExecutionEnvironment(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const topology = source.topology;
  if (topology) validateDirectEnvironmentTopology(topology);
  const defaultEnvironmentId = normalizeString(source.defaultEnvironmentId || topology?.defaultEnvironmentId, "");
  const residentEnvironmentId = normalizeString(source.residentEnvironmentId || source.selectedEnvironmentId || defaultEnvironmentId, "");
  const turnEnvironment = {
    schema: DIRECT_TURN_EXECUTION_ENVIRONMENT_SCHEMA,
    turnId: normalizeId(source.turnId, "direct_turn"),
    threadId: normalizeId(source.threadId, "direct_thread"),
    defaultEnvironmentId: requireString(defaultEnvironmentId, "turnEnvironment.defaultEnvironmentId"),
    residentEnvironmentId: requireString(residentEnvironmentId, "turnEnvironment.residentEnvironmentId"),
    selectionKind: pickEnum(source.selectionKind, TURN_ENVIRONMENT_SELECTION_KINDS, "thread_default"),
    reason: pickEnum(source.reason, TURN_ENVIRONMENT_REASONS, "default_work"),
    topologyRef: source.topologyRef || topologyRef(topology || source),
    sourceRefs: normalizeRefs(source.sourceRefs, "turn_environment_source"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const workThreadId = normalizeString(source.workThreadId, "");
  if (workThreadId) turnEnvironment.workThreadId = workThreadId;
  const selectedToolEnvironmentId = normalizeString(source.selectedToolEnvironmentId, "");
  if (selectedToolEnvironmentId) turnEnvironment.selectedToolEnvironmentId = selectedToolEnvironmentId;
  const delegatedSpecialistEnvironmentId = normalizeString(source.delegatedSpecialistEnvironmentId, "");
  if (delegatedSpecialistEnvironmentId) turnEnvironment.delegatedSpecialistEnvironmentId = delegatedSpecialistEnvironmentId;
  if (source.authorityDecisionRef) turnEnvironment.authorityDecisionRef = source.authorityDecisionRef;
  turnEnvironment.turnEnvironmentDigest = digestFor("direct-turn-execution-environment@1", turnEnvironment);
  return turnEnvironment;
}

function validateTurnExecutionEnvironment(turnEnvironment) {
  requirePlainObject(turnEnvironment, "turnEnvironment");
  if (turnEnvironment.schema !== DIRECT_TURN_EXECUTION_ENVIRONMENT_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "turnEnvironment");
  }
  requireString(turnEnvironment.turnId, "turnEnvironment.turnId");
  requireString(turnEnvironment.threadId, "turnEnvironment.threadId");
  requireString(turnEnvironment.defaultEnvironmentId, "turnEnvironment.defaultEnvironmentId");
  requireString(turnEnvironment.residentEnvironmentId, "turnEnvironment.residentEnvironmentId");
  if (!TURN_ENVIRONMENT_SELECTION_KINDS.includes(turnEnvironment.selectionKind)) {
    throw validationError("direct_environment_invalid_selection_kind", "turnEnvironment.selectionKind");
  }
  if (!TURN_ENVIRONMENT_REASONS.includes(turnEnvironment.reason)) {
    throw validationError("direct_environment_invalid_selection_reason", "turnEnvironment.reason");
  }
  if (turnEnvironment.selectionKind === "tool_scoped_transition") {
    requireString(turnEnvironment.selectedToolEnvironmentId, "turnEnvironment.selectedToolEnvironmentId");
  }
  if (turnEnvironment.selectionKind === "specialist_worker_delegation") {
    requireString(turnEnvironment.delegatedSpecialistEnvironmentId, "turnEnvironment.delegatedSpecialistEnvironmentId");
  }
  validateRef(turnEnvironment.topologyRef, "turnEnvironment.topologyRef", { requireDigest: false });
  if (turnEnvironment.authorityDecisionRef) {
    validateRef(turnEnvironment.authorityDecisionRef, "turnEnvironment.authorityDecisionRef", { requireDigest: false });
  }
  validateRefs(turnEnvironment.sourceRefs, "turnEnvironment.sourceRefs", { requireDigest: false });
  if (turnEnvironment.rawTextIncluded === true || turnEnvironment.rawPathIncluded === true || turnEnvironment.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "turnEnvironment");
  }
  validateDigest(turnEnvironment, "turnEnvironmentDigest", "direct-turn-execution-environment@1", "turnEnvironment");
  return true;
}

function buildEnvironmentExecutionProjection(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const topology = source.topology || source.environmentTopology;
  const turnEnvironment = source.turnEnvironment || source.turnExecutionEnvironment;
  if (topology) validateDirectEnvironmentTopology(topology);
  if (turnEnvironment) validateTurnExecutionEnvironment(turnEnvironment);
  const residentEnvironmentId = normalizeString(turnEnvironment?.residentEnvironmentId || topology?.defaultEnvironmentId, "");
  const selectedToolEnvironmentId = normalizeString(turnEnvironment?.selectedToolEnvironmentId, "");
  const delegatedSpecialistEnvironmentId = normalizeString(turnEnvironment?.delegatedSpecialistEnvironmentId, "");
  const projection = {
    schema: DIRECT_ENVIRONMENT_EXECUTION_PROJECTION_SCHEMA,
    projectionId: normalizeId(source.projectionId, "environment_execution_projection"),
    bootPacketId: normalizeString(source.bootPacketId, ""),
    topologyRef: topologyRef(topology || turnEnvironment?.topologyRef || source.topologyRef),
    turnEnvironmentRef: {
      kind: "turn_execution_environment",
      id: normalizeString(turnEnvironment?.turnId || source.turnId, ""),
      digest: normalizeString(turnEnvironment?.turnEnvironmentDigest || source.turnEnvironmentDigest, ""),
      label: "Turn execution environment",
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    defaultEnvironmentRef: environmentRef(topology, turnEnvironment?.defaultEnvironmentId || topology?.defaultEnvironmentId),
    residentEnvironmentRef: environmentRef(topology, residentEnvironmentId),
    workspaceMutationDefault: "forbidden_cross_env_without_authority",
    routeSummary: normalizeString(source.routeSummary, "resident environment uses thread default"),
    sourceRefs: normalizeRefs(source.sourceRefs, "environment_execution_projection_source"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (selectedToolEnvironmentId) projection.selectedToolEnvironmentRef = environmentRef(topology, selectedToolEnvironmentId);
  if (delegatedSpecialistEnvironmentId) projection.delegatedSpecialistEnvironmentRef = environmentRef(topology, delegatedSpecialistEnvironmentId);
  if (source.topologyCompatibility) {
    validateTopologyCompatibility(source.topologyCompatibility);
    projection.topologyCompatibilityRef = {
      kind: "environment_topology_compatibility",
      id: normalizeString(source.topologyCompatibility.expectedTopologyId, ""),
      digest: source.topologyCompatibility.compatibilityDigest,
      label: `Topology compatibility: ${source.topologyCompatibility.compatibility}`,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }
  projection.executionProjectionDigest = digestFor("direct-environment-execution-projection@1", projection);
  return projection;
}

function validateEnvironmentExecutionProjection(projection) {
  requirePlainObject(projection, "environmentExecutionProjection");
  if (projection.schema !== DIRECT_ENVIRONMENT_EXECUTION_PROJECTION_SCHEMA) {
    throw validationError("direct_environment_schema_mismatch", "environmentExecutionProjection");
  }
  requireString(projection.projectionId, "environmentExecutionProjection.projectionId");
  validateRef(projection.topologyRef, "environmentExecutionProjection.topologyRef", { requireDigest: false });
  validateRef(projection.turnEnvironmentRef, "environmentExecutionProjection.turnEnvironmentRef", { requireId: false, requireDigest: false });
  validateRef(projection.defaultEnvironmentRef, "environmentExecutionProjection.defaultEnvironmentRef", { requireDigest: false });
  validateRef(projection.residentEnvironmentRef, "environmentExecutionProjection.residentEnvironmentRef", { requireDigest: false });
  if (projection.selectedToolEnvironmentRef) {
    validateRef(projection.selectedToolEnvironmentRef, "environmentExecutionProjection.selectedToolEnvironmentRef", { requireDigest: false });
  }
  if (projection.delegatedSpecialistEnvironmentRef) {
    validateRef(projection.delegatedSpecialistEnvironmentRef, "environmentExecutionProjection.delegatedSpecialistEnvironmentRef", { requireDigest: false });
  }
  if (projection.topologyCompatibilityRef) {
    validateRef(projection.topologyCompatibilityRef, "environmentExecutionProjection.topologyCompatibilityRef", { requireId: false });
  }
  if (projection.workspaceMutationDefault !== "forbidden_cross_env_without_authority") {
    throw validationError("direct_environment_invalid_workspace_mutation_default", "environmentExecutionProjection.workspaceMutationDefault");
  }
  if (projection.rawTextIncluded === true || projection.rawPathIncluded === true || projection.rawSecretIncluded === true) {
    throw validationError("direct_environment_raw_exposure", "environmentExecutionProjection");
  }
  validateDigest(projection, "executionProjectionDigest", "direct-environment-execution-projection@1", "environmentExecutionProjection");
  return true;
}

module.exports = {
  DIRECT_ENVIRONMENT_CONSTRAINT_SCHEMA,
  DIRECT_ENVIRONMENT_EXECUTION_PROJECTION_SCHEMA,
  DIRECT_ENVIRONMENT_KINDS,
  DIRECT_ENVIRONMENT_PATH_MAPPING_SCHEMA,
  DIRECT_ENVIRONMENT_REF_SCHEMA,
  DIRECT_ENVIRONMENT_TOPOLOGY_COMPATIBILITY_SCHEMA,
  DIRECT_ENVIRONMENT_TOPOLOGY_SCHEMA,
  DIRECT_TURN_EXECUTION_ENVIRONMENT_SCHEMA,
  buildDirectEnvironmentRef,
  buildDirectEnvironmentTopology,
  buildEnvironmentConstraint,
  buildEnvironmentExecutionProjection,
  buildEnvironmentPathMapping,
  buildTopologyCompatibility,
  buildTurnExecutionEnvironment,
  validateDirectEnvironmentRef,
  validateDirectEnvironmentTopology,
  validateEnvironmentConstraint,
  validateEnvironmentExecutionProjection,
  validateEnvironmentPathMapping,
  validateTopologyCompatibility,
  validateTurnExecutionEnvironment,
};
