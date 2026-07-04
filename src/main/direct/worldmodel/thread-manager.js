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
  ODEU_LANE_KEYS,
  ODEU_SECTION_KEYS,
} = require("./constants");
const {
  buildRevisionCompatibility,
  validateActiveInteractionWorldmodel,
  validateRevisionCompatibility,
} = require("./kernel");
const {
  validateWorldmodelManagerProfile,
} = require("./manager");
const {
  buildEnvironmentExecutionProjection,
  validateEnvironmentExecutionProjection,
} = require("./environment-topology");

const THREAD_MANAGER_PROFILE_SCHEMA = "thread_manager_profile@1";
const WORK_THREAD_DELEGATION_PACKET_SCHEMA = "work_thread_delegation_packet@1";
const WORKER_BOOT_PACKET_SCHEMA = "worker_boot_packet@1";
const BOOT_PACKET_OMISSION_SCHEMA = "boot_packet_omission@1";
const BOOT_PACKET_STALE_WARNING_SCHEMA = "boot_packet_stale_warning@1";
const AUTHORITY_BOUNDARY_SCHEMA = "worker_boot_authority_boundary@1";
const AUTHORITY_BOUNDARY_COMPARISON_WITNESS_SCHEMA = "authority_boundary_comparison_witness@1";
const BOOT_PACKET_PROJECTION_WITNESS_SCHEMA = "boot_packet_projection_witness@1";
const SHADOW_CONTEXT_PACK_INTEGRATION_SCHEMA = "shadow_context_pack_integration@1";

const THREAD_MANAGER_LIFECYCLE_STATES = Object.freeze(["active", "idle", "disabled", "unknown"]);
const DELEGATION_STATUSES = Object.freeze(["ready_for_thread_manager", "blocked", "diagnostic_only"]);
const BOOT_PACKET_STATUSES = Object.freeze(["ready_for_worker_boot", "blocked", "diagnostic_only"]);
const OMISSION_REASONS = Object.freeze([
  "irrelevant_to_role_lane",
  "sensitive_governance_detail",
  "stale_source",
  "not_needed_for_boot",
  "unknown_or_remanded",
]);
const STALE_WARNING_KINDS = Object.freeze([
  "worldmodel_revision_stale",
  "worldmodel_revision_future",
  "different_worldmodel",
  "stale_source_ref",
  "unknown_compatibility",
]);
const AUTHORITY_DECISIONS = Object.freeze(["same", "narrower", "broader", "incompatible", "unknown"]);

const DIGEST_FIELDS = new Set([
  "profileDigest",
  "delegationDigest",
  "bootPacketDigest",
  "omissionDigest",
  "warningDigest",
  "authorityBoundaryDigest",
  "comparisonDigest",
  "executionProjectionDigest",
  "projectionWitnessDigest",
  "shadowIntegrationDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_thread_manager_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_thread_manager_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_thread_manager_missing_array", label);
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
    throw validationError("direct_thread_manager_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "unknown") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const source = isPlainObject(value) ? value : {};
      const id = normalizeString(source.id || source.artifactId || source.refId || source.bundleId || source.channelId, "");
      const digest = normalizeString(source.digest || source.artifactDigest || source.bundleDigest || source.channelDigest, "");
      if (!id && !digest) return null;
      return {
        kind: normalizeString(source.kind || source.refKind, fallbackKind),
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
    throw validationError("direct_thread_manager_raw_ref_exposure", label);
  }
  return true;
}

function worldmodelRef(worldmodel) {
  const source = isPlainObject(worldmodel) ? worldmodel : {};
  return {
    kind: "active_interaction_worldmodel",
    id: normalizeString(source.worldmodelId || source.id, ""),
    digest: normalizeString(source.digest, ""),
    revision: Number(source.revision || 0),
    label: normalizeString(source.label, "Active interaction worldmodel"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function managerProfileRef(managerProfile) {
  const source = isPlainObject(managerProfile) ? managerProfile : {};
  return {
    kind: "worldmodel_manager_profile",
    id: normalizeString(source.managerProfileId || source.id, ""),
    digest: normalizeString(source.profileDigest || source.digest, ""),
    label: normalizeString(source.label, "Worldmodel manager profile"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeLaneKeys(value, fallback = ["task", "environment", "modelSelf", "governance"]) {
  const lanes = (Array.isArray(value) ? value : fallback)
    .map((lane) => normalizeString(lane, ""))
    .filter((lane) => ODEU_LANE_KEYS.includes(lane));
  return [...new Set(lanes)];
}

function normalizeSectionKeys(value, fallback = ["O", "E", "D", "U"]) {
  const sections = (Array.isArray(value) ? value : fallback)
    .map((section) => normalizeString(section, ""))
    .filter((section) => ODEU_SECTION_KEYS.includes(section));
  return [...new Set(sections)];
}

function buildThreadManagerProfile(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const managerProfile = source.managerProfile;
  if (managerProfile) validateWorldmodelManagerProfile(managerProfile);
  const createdAt = normalizeString(source.createdAt, nowIso(options.now || Date.now));
  const profile = {
    schema: THREAD_MANAGER_PROFILE_SCHEMA,
    threadManagerProfileId: normalizeId(source.threadManagerProfileId, "thread_manager_profile"),
    threadManagerAgentId: normalizeId(source.threadManagerAgentId, "agent_thread_manager"),
    parentManagerProfileId: normalizeString(source.parentManagerProfileId || managerProfile?.managerProfileId, ""),
    parentManagerAgentId: normalizeString(source.parentManagerAgentId || managerProfile?.managerAgentId, ""),
    scopeKind: normalizeString(source.scopeKind || managerProfile?.scope?.scopeKind, "unknown"),
    projectId: normalizeString(source.projectId || managerProfile?.scope?.projectId, ""),
    workThreadId: normalizeString(source.workThreadId || managerProfile?.scope?.workThreadId, ""),
    lifecycleState: pickEnum(source.lifecycleState, THREAD_MANAGER_LIFECYCLE_STATES, "active"),
    roleKind: "thread_manager",
    canReceiveDelegation: true,
    canBuildWorkerBootPackets: true,
    canExecuteWorkerTasks: false,
    managerProfileRef: managerProfileRef(managerProfile || source.managerProfileRef),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt,
    updatedAt: normalizeString(source.updatedAt, createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  profile.profileDigest = digestFor("thread-manager-profile@1", profile);
  return profile;
}

function validateThreadManagerProfile(profile) {
  requirePlainObject(profile, "threadManagerProfile");
  if (profile.schema !== THREAD_MANAGER_PROFILE_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "threadManagerProfile");
  }
  requireString(profile.threadManagerProfileId, "threadManagerProfile.threadManagerProfileId");
  requireString(profile.threadManagerAgentId, "threadManagerProfile.threadManagerAgentId");
  if (profile.roleKind !== "thread_manager") {
    throw validationError("direct_thread_manager_invalid_role_kind", "threadManagerProfile.roleKind");
  }
  if (profile.canReceiveDelegation !== true || profile.canBuildWorkerBootPackets !== true || profile.canExecuteWorkerTasks !== false) {
    throw validationError("direct_thread_manager_boundary_violation", "threadManagerProfile");
  }
  validateRef(profile.managerProfileRef, "threadManagerProfile.managerProfileRef", { requireDigest: false });
  validateDigest(profile, "profileDigest", "thread-manager-profile@1", "threadManagerProfile");
  return true;
}

function buildAuthorityBoundary(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const allowedActionClasses = (Array.isArray(source.allowedActionClasses) ? source.allowedActionClasses : ["read_context", "summarize", "request_authorization"])
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  const forbiddenActionClasses = (Array.isArray(source.forbiddenActionClasses) ? source.forbiddenActionClasses : ["apply_patch", "run_command", "external_write", "account_mutation"])
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  const boundary = {
    schema: AUTHORITY_BOUNDARY_SCHEMA,
    authorityBoundaryId: normalizeId(source.authorityBoundaryId, "authority_boundary"),
    scopeKind: normalizeString(source.scopeKind, "work_thread"),
    workThreadId: normalizeString(source.workThreadId, ""),
    roleLane: normalizeString(source.roleLane, "implementation_worker"),
    allowedActionClasses: [...new Set(allowedActionClasses)],
    forbiddenActionClasses: [...new Set(forbiddenActionClasses)],
    authorizationChannelRefs: normalizeRefs(source.authorizationChannelRefs, "authorization_channel"),
    capabilityBundleRefs: normalizeRefs(source.capabilityBundleRefs, "capability_bundle"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  boundary.authorityBoundaryDigest = digestFor("worker-boot-authority-boundary@1", boundary);
  return boundary;
}

function validateAuthorityBoundary(boundary) {
  requirePlainObject(boundary, "authorityBoundary");
  if (boundary.schema !== AUTHORITY_BOUNDARY_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "authorityBoundary");
  }
  requireString(boundary.authorityBoundaryId, "authorityBoundary.authorityBoundaryId");
  requireArray(boundary.allowedActionClasses, "authorityBoundary.allowedActionClasses");
  requireArray(boundary.forbiddenActionClasses, "authorityBoundary.forbiddenActionClasses");
  requireArray(boundary.authorizationChannelRefs, "authorityBoundary.authorizationChannelRefs");
  requireArray(boundary.capabilityBundleRefs, "authorityBoundary.capabilityBundleRefs");
  boundary.authorizationChannelRefs.forEach((ref, index) => validateRef(ref, `authorityBoundary.authorizationChannelRefs.${index}`, { requireDigest: false }));
  boundary.capabilityBundleRefs.forEach((ref, index) => validateRef(ref, `authorityBoundary.capabilityBundleRefs.${index}`, { requireDigest: false }));
  validateDigest(boundary, "authorityBoundaryDigest", "worker-boot-authority-boundary@1", "authorityBoundary");
  return true;
}

function compareAuthorityBoundaries(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const parentBoundary = isPlainObject(source.parentBoundary) ? source.parentBoundary : buildAuthorityBoundary(source.parent || {});
  const childBoundary = isPlainObject(source.childBoundary) ? source.childBoundary : buildAuthorityBoundary(source.child || {});
  validateAuthorityBoundary(parentBoundary);
  validateAuthorityBoundary(childBoundary);
  const parentAllowed = new Set(parentBoundary.allowedActionClasses);
  const childAllowed = new Set(childBoundary.allowedActionClasses);
  const parentForbidden = new Set(parentBoundary.forbiddenActionClasses);
  const childForbidden = new Set(childBoundary.forbiddenActionClasses);
  const extraAllowed = [...childAllowed].filter((action) => !parentAllowed.has(action));
  const missingForbidden = [...parentForbidden].filter((action) => !childForbidden.has(action));
  const extraForbidden = [...childForbidden].filter((action) => !parentForbidden.has(action));
  let decision = "same";
  if (extraAllowed.length || missingForbidden.length) decision = "broader";
  else if (extraForbidden.length || [...parentAllowed].some((action) => !childAllowed.has(action))) decision = "narrower";
  const witness = {
    schema: AUTHORITY_BOUNDARY_COMPARISON_WITNESS_SCHEMA,
    comparisonId: normalizeId(source.comparisonId, "authority_comparison"),
    parentBoundaryRef: {
      id: parentBoundary.authorityBoundaryId,
      digest: parentBoundary.authorityBoundaryDigest,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    childBoundaryRef: {
      id: childBoundary.authorityBoundaryId,
      digest: childBoundary.authorityBoundaryDigest,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    decision: pickEnum(decision, AUTHORITY_DECISIONS, "unknown"),
    extraAllowed,
    missingForbidden,
    extraForbidden,
    blocksBoot: decision === "broader",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  witness.comparisonDigest = digestFor("authority-boundary-comparison-witness@1", witness);
  return witness;
}

function validateAuthorityBoundaryComparisonWitness(witness) {
  requirePlainObject(witness, "authorityComparison");
  if (witness.schema !== AUTHORITY_BOUNDARY_COMPARISON_WITNESS_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "authorityComparison");
  }
  requireString(witness.comparisonId, "authorityComparison.comparisonId");
  if (!AUTHORITY_DECISIONS.includes(witness.decision)) {
    throw validationError("direct_thread_manager_invalid_authority_decision", "authorityComparison.decision");
  }
  requireArray(witness.extraAllowed, "authorityComparison.extraAllowed");
  requireArray(witness.missingForbidden, "authorityComparison.missingForbidden");
  validateDigest(witness, "comparisonDigest", "authority-boundary-comparison-witness@1", "authorityComparison");
  return true;
}

function buildBootPacketOmission(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const omission = {
    schema: BOOT_PACKET_OMISSION_SCHEMA,
    omissionId: normalizeId(source.omissionId, "boot_omission"),
    laneKey: normalizeString(source.laneKey, ""),
    sectionKey: normalizeString(source.sectionKey, ""),
    omissionReason: pickEnum(source.omissionReason, OMISSION_REASONS, "not_needed_for_boot"),
    summary: normalizeString(source.summary, "Worldmodel material omitted from worker boot packet."),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  omission.omissionDigest = digestFor("boot-packet-omission@1", omission);
  return omission;
}

function validateBootPacketOmission(omission) {
  requirePlainObject(omission, "bootOmission");
  if (omission.schema !== BOOT_PACKET_OMISSION_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "bootOmission");
  }
  requireString(omission.omissionId, "bootOmission.omissionId");
  if (omission.laneKey && !ODEU_LANE_KEYS.includes(omission.laneKey)) {
    throw validationError("direct_thread_manager_invalid_lane_key", "bootOmission.laneKey");
  }
  if (omission.sectionKey && !ODEU_SECTION_KEYS.includes(omission.sectionKey)) {
    throw validationError("direct_thread_manager_invalid_section_key", "bootOmission.sectionKey");
  }
  if (!OMISSION_REASONS.includes(omission.omissionReason)) {
    throw validationError("direct_thread_manager_invalid_omission_reason", "bootOmission.omissionReason");
  }
  validateDigest(omission, "omissionDigest", "boot-packet-omission@1", "bootOmission");
  return true;
}

function buildBootPacketStaleWarning(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const warning = {
    schema: BOOT_PACKET_STALE_WARNING_SCHEMA,
    warningId: normalizeId(source.warningId, "boot_stale_warning"),
    warningKind: pickEnum(source.warningKind, STALE_WARNING_KINDS, "unknown_compatibility"),
    severity: normalizeString(source.severity, "medium"),
    summary: normalizeString(source.summary, "Worker boot packet has stale or uncertain worldmodel evidence."),
    sourceRef: isPlainObject(source.sourceRef) ? source.sourceRef : null,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  warning.warningDigest = digestFor("boot-packet-stale-warning@1", warning);
  return warning;
}

function validateBootPacketStaleWarning(warning) {
  requirePlainObject(warning, "bootStaleWarning");
  if (warning.schema !== BOOT_PACKET_STALE_WARNING_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "bootStaleWarning");
  }
  requireString(warning.warningId, "bootStaleWarning.warningId");
  if (!STALE_WARNING_KINDS.includes(warning.warningKind)) {
    throw validationError("direct_thread_manager_invalid_warning_kind", "bootStaleWarning.warningKind");
  }
  validateDigest(warning, "warningDigest", "boot-packet-stale-warning@1", "bootStaleWarning");
  return true;
}

function roleLaneProjectionFromWorldmodel(worldmodel, laneKeys, sectionKeys) {
  const projection = {};
  for (const laneKey of laneKeys) {
    const lane = worldmodel[laneKey];
    if (!isPlainObject(lane)) continue;
    projection[laneKey] = {
      laneId: lane.laneId,
      laneKind: lane.laneKind,
      status: lane.status,
      laneDigest: lane.laneDigest,
      sections: {},
    };
    for (const sectionKey of sectionKeys) {
      const section = lane[sectionKey];
      if (!isPlainObject(section)) continue;
      projection[laneKey].sections[sectionKey] = {
        sectionDigest: section.sectionDigest,
        summary: section.summary,
        entryCount: Array.isArray(section.entries) ? section.entries.length : 0,
      };
    }
  }
  return projection;
}

function buildWorkThreadDelegationPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const managerProfile = source.managerProfile;
  const threadManagerProfile = source.threadManagerProfile;
  const worldmodel = source.worldmodel;
  if (managerProfile) validateWorldmodelManagerProfile(managerProfile);
  if (threadManagerProfile) validateThreadManagerProfile(threadManagerProfile);
  validateActiveInteractionWorldmodel(worldmodel);
  const revisionCompatibility = source.revisionCompatibility || buildRevisionCompatibility({
    expectedWorldmodelId: source.expectedWorldmodelId || worldmodel.worldmodelId,
    expectedRevision: source.expectedRevision || worldmodel.revision,
    currentWorldmodel: worldmodel,
    checkedAt: source.checkedAt,
    now: options.now,
  });
  validateRevisionCompatibility(revisionCompatibility);
  const blockerCodes = [];
  if (revisionCompatibility.requiresRemand) blockerCodes.push("worldmodel_revision_not_current");
  const packet = {
    schema: WORK_THREAD_DELEGATION_PACKET_SCHEMA,
    delegationPacketId: normalizeId(source.delegationPacketId, "work_thread_delegation"),
    managerProfileRef: managerProfileRef(managerProfile || source.managerProfileRef),
    threadManagerProfileRef: {
      kind: "thread_manager_profile",
      id: normalizeString(threadManagerProfile?.threadManagerProfileId || source.threadManagerProfileId, ""),
      digest: normalizeString(threadManagerProfile?.profileDigest || source.threadManagerProfileDigest, ""),
      label: "Thread manager profile",
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    worldmodelRef: worldmodelRef(worldmodel),
    revisionCompatibility,
    targetWorkThreadId: normalizeId(source.targetWorkThreadId || threadManagerProfile?.workThreadId, "work_thread"),
    objectiveSummary: normalizeString(source.objectiveSummary, "Delegate work thread from active worldmodel."),
    roleLane: normalizeString(source.roleLane, "implementation_worker"),
    requestedLaneKeys: normalizeLaneKeys(source.requestedLaneKeys),
    requestedSectionKeys: normalizeSectionKeys(source.requestedSectionKeys),
    capabilityBundleRefs: normalizeRefs(source.capabilityBundleRefs, "capability_bundle"),
    authorizationChannelRefs: normalizeRefs(source.authorizationChannelRefs, "authorization_channel"),
    status: blockerCodes.length ? "blocked" : pickEnum(source.status, DELEGATION_STATUSES, "ready_for_thread_manager"),
    blockerCodes,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  packet.delegationDigest = digestFor("work-thread-delegation-packet@1", packet);
  return packet;
}

function validateWorkThreadDelegationPacket(packet) {
  requirePlainObject(packet, "delegationPacket");
  if (packet.schema !== WORK_THREAD_DELEGATION_PACKET_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "delegationPacket");
  }
  requireString(packet.delegationPacketId, "delegationPacket.delegationPacketId");
  validateRef(packet.managerProfileRef, "delegationPacket.managerProfileRef", { requireDigest: false });
  validateRef(packet.threadManagerProfileRef, "delegationPacket.threadManagerProfileRef", { requireDigest: false });
  validateRef(packet.worldmodelRef, "delegationPacket.worldmodelRef");
  validateRevisionCompatibility(packet.revisionCompatibility);
  requireString(packet.targetWorkThreadId, "delegationPacket.targetWorkThreadId");
  requireArray(packet.requestedLaneKeys, "delegationPacket.requestedLaneKeys");
  requireArray(packet.requestedSectionKeys, "delegationPacket.requestedSectionKeys");
  requireArray(packet.capabilityBundleRefs, "delegationPacket.capabilityBundleRefs");
  requireArray(packet.authorizationChannelRefs, "delegationPacket.authorizationChannelRefs");
  requireArray(packet.blockerCodes, "delegationPacket.blockerCodes");
  if (!DELEGATION_STATUSES.includes(packet.status)) {
    throw validationError("direct_thread_manager_invalid_delegation_status", "delegationPacket.status");
  }
  packet.capabilityBundleRefs.forEach((ref, index) => validateRef(ref, `delegationPacket.capabilityBundleRefs.${index}`, { requireDigest: false }));
  packet.authorizationChannelRefs.forEach((ref, index) => validateRef(ref, `delegationPacket.authorizationChannelRefs.${index}`, { requireDigest: false }));
  validateDigest(packet, "delegationDigest", "work-thread-delegation-packet@1", "delegationPacket");
  return true;
}

function staleWarningsFor(worldmodel, revisionCompatibility) {
  const warnings = [];
  if (revisionCompatibility.requiresRemand) {
    warnings.push(buildBootPacketStaleWarning({
      warningKind: revisionCompatibility.compatibility === "stale"
        ? "worldmodel_revision_stale"
        : revisionCompatibility.compatibility === "future"
          ? "worldmodel_revision_future"
          : revisionCompatibility.compatibility === "different_worldmodel"
            ? "different_worldmodel"
            : "unknown_compatibility",
      summary: `Worldmodel revision compatibility is ${revisionCompatibility.compatibility}.`,
    }));
  }
  for (const [index, sourceRef] of (Array.isArray(worldmodel.staleRefs) ? worldmodel.staleRefs : []).entries()) {
    warnings.push(buildBootPacketStaleWarning({
      warningId: `boot_stale_source_${index + 1}`,
      warningKind: "stale_source_ref",
      summary: "Active worldmodel contains stale source references.",
      sourceRef,
    }));
  }
  return warnings;
}

function omittedSectionsFor(worldmodel, laneKeys, sectionKeys) {
  const omissions = [];
  for (const laneKey of ODEU_LANE_KEYS) {
    if (!laneKeys.includes(laneKey)) {
      omissions.push(buildBootPacketOmission({
        laneKey,
        omissionReason: "irrelevant_to_role_lane",
        summary: `${laneKey} lane omitted from this worker boot packet.`,
      }));
      continue;
    }
    for (const sectionKey of ODEU_SECTION_KEYS) {
      if (!sectionKeys.includes(sectionKey)) {
        omissions.push(buildBootPacketOmission({
          laneKey,
          sectionKey,
          omissionReason: sectionKey === "D" ? "sensitive_governance_detail" : "not_needed_for_boot",
          summary: `${laneKey}.${sectionKey} section omitted from this worker boot packet.`,
        }));
      }
    }
  }
  for (const unknown of Array.isArray(worldmodel.unknowns) ? worldmodel.unknowns : []) {
    omissions.push(buildBootPacketOmission({
      laneKey: unknown.laneKey,
      omissionReason: "unknown_or_remanded",
      summary: `Unknown retained as remand evidence: ${unknown.summary}`,
      sourceRefs: unknown.sourceRefs,
    }));
  }
  return omissions;
}

function buildWorkerBootPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const delegationPacket = source.delegationPacket;
  const worldmodel = source.worldmodel;
  validateWorkThreadDelegationPacket(delegationPacket);
  validateActiveInteractionWorldmodel(worldmodel);
  const currentWorldmodelRef = worldmodelRef(worldmodel);
  if (
    delegationPacket.worldmodelRef.id !== currentWorldmodelRef.id
    || delegationPacket.worldmodelRef.digest !== currentWorldmodelRef.digest
  ) {
    throw validationError("direct_thread_manager_worldmodel_mismatch", "workerBootPacket.worldmodelRef");
  }
  const bootPacketId = normalizeId(source.bootPacketId, "worker_boot_packet");
  const laneKeys = normalizeLaneKeys(source.laneKeys || delegationPacket.requestedLaneKeys);
  const sectionKeys = normalizeSectionKeys(source.sectionKeys || delegationPacket.requestedSectionKeys);
  const parentBoundary = isPlainObject(source.parentAuthorityBoundary)
    ? source.parentAuthorityBoundary
    : buildAuthorityBoundary({
      workThreadId: delegationPacket.targetWorkThreadId,
      roleLane: "manager",
      allowedActionClasses: ["read_context", "summarize", "request_authorization"],
      forbiddenActionClasses: ["apply_patch", "run_command", "external_write", "account_mutation"],
      authorizationChannelRefs: delegationPacket.authorizationChannelRefs,
      capabilityBundleRefs: delegationPacket.capabilityBundleRefs,
    });
  const workerBoundary = isPlainObject(source.workerAuthorityBoundary)
    ? source.workerAuthorityBoundary
    : buildAuthorityBoundary({
      workThreadId: delegationPacket.targetWorkThreadId,
      roleLane: delegationPacket.roleLane,
      allowedActionClasses: source.allowedActionClasses || ["read_context", "summarize", "request_authorization"],
      forbiddenActionClasses: source.forbiddenActionClasses || ["apply_patch", "run_command", "external_write", "account_mutation"],
      authorizationChannelRefs: delegationPacket.authorizationChannelRefs,
      capabilityBundleRefs: delegationPacket.capabilityBundleRefs,
    });
  validateAuthorityBoundary(parentBoundary);
  validateAuthorityBoundary(workerBoundary);
  const authorityComparison = compareAuthorityBoundaries({ parentBoundary, childBoundary: workerBoundary });
  const bootOmissions = omittedSectionsFor(worldmodel, laneKeys, sectionKeys);
  const staleWarnings = staleWarningsFor(worldmodel, delegationPacket.revisionCompatibility);
  const blockerCodes = [
    ...(Array.isArray(delegationPacket.blockerCodes) ? delegationPacket.blockerCodes : []),
    ...(authorityComparison.blocksBoot ? ["authority_boundary_broadened"] : []),
  ];
  const packet = {
    schema: WORKER_BOOT_PACKET_SCHEMA,
    bootPacketId,
    delegationPacketRef: {
      id: delegationPacket.delegationPacketId,
      digest: delegationPacket.delegationDigest,
      status: delegationPacket.status,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    worldmodelRef: currentWorldmodelRef,
    targetWorkThreadId: delegationPacket.targetWorkThreadId,
    roleLane: delegationPacket.roleLane,
    objectiveSummary: delegationPacket.objectiveSummary,
    roleLaneProjection: roleLaneProjectionFromWorldmodel(worldmodel, laneKeys, sectionKeys),
    includedLaneKeys: laneKeys,
    includedSectionKeys: sectionKeys,
    bootOmissions,
    staleWarnings,
    authorityBoundary: workerBoundary,
    authorityComparison,
    environmentExecutionProjection: source.environmentExecutionProjection
      || (
        source.environmentTopology || source.topology || source.turnExecutionEnvironment || source.turnEnvironment
          ? buildEnvironmentExecutionProjection({
            bootPacketId,
            topology: source.environmentTopology || source.topology,
            turnEnvironment: source.turnExecutionEnvironment || source.turnEnvironment,
            topologyCompatibility: source.topologyCompatibility,
            routeSummary: source.environmentRouteSummary,
          })
          : undefined
      ),
    capabilityBundleRefs: delegationPacket.capabilityBundleRefs,
    authorizationChannelRefs: delegationPacket.authorizationChannelRefs,
    shadowContextPackIntegration: buildShadowContextPackIntegration({
      bootPacketId,
      targetWorkThreadId: delegationPacket.targetWorkThreadId,
      contextPackRef: source.contextPackRef,
    }),
    status: blockerCodes.length || staleWarnings.length
      ? (blockerCodes.length ? "blocked" : "diagnostic_only")
      : pickEnum(source.status, BOOT_PACKET_STATUSES, "ready_for_worker_boot"),
    blockerCodes,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  packet.projectionWitness = buildBootPacketProjectionWitness({ bootPacket: packet });
  packet.bootPacketDigest = digestFor("worker-boot-packet@1", packet);
  return packet;
}

function validateWorkerBootPacket(packet) {
  requirePlainObject(packet, "workerBootPacket");
  if (packet.schema !== WORKER_BOOT_PACKET_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "workerBootPacket");
  }
  requireString(packet.bootPacketId, "workerBootPacket.bootPacketId");
  validateRef(packet.worldmodelRef, "workerBootPacket.worldmodelRef");
  requireString(packet.targetWorkThreadId, "workerBootPacket.targetWorkThreadId");
  requireArray(packet.includedLaneKeys, "workerBootPacket.includedLaneKeys");
  requireArray(packet.includedSectionKeys, "workerBootPacket.includedSectionKeys");
  requireArray(packet.bootOmissions, "workerBootPacket.bootOmissions");
  requireArray(packet.staleWarnings, "workerBootPacket.staleWarnings");
  requireArray(packet.capabilityBundleRefs, "workerBootPacket.capabilityBundleRefs");
  requireArray(packet.authorizationChannelRefs, "workerBootPacket.authorizationChannelRefs");
  packet.bootOmissions.forEach((omission) => validateBootPacketOmission(omission));
  packet.staleWarnings.forEach((warning) => validateBootPacketStaleWarning(warning));
  packet.capabilityBundleRefs.forEach((ref, index) => validateRef(ref, `workerBootPacket.capabilityBundleRefs.${index}`, { requireDigest: false }));
  packet.authorizationChannelRefs.forEach((ref, index) => validateRef(ref, `workerBootPacket.authorizationChannelRefs.${index}`, { requireDigest: false }));
  validateAuthorityBoundary(packet.authorityBoundary);
  validateAuthorityBoundaryComparisonWitness(packet.authorityComparison);
  if (packet.environmentExecutionProjection) {
    validateEnvironmentExecutionProjection(packet.environmentExecutionProjection);
  }
  validateShadowContextPackIntegration(packet.shadowContextPackIntegration);
  validateBootPacketProjectionWitness(packet.projectionWitness);
  if (packet.rawPromptIncluded === true || packet.rawTextIncluded === true || packet.rawPathIncluded === true || packet.rawSecretIncluded === true) {
    throw validationError("direct_thread_manager_raw_boot_packet_exposure", "workerBootPacket");
  }
  if (!BOOT_PACKET_STATUSES.includes(packet.status)) {
    throw validationError("direct_thread_manager_invalid_boot_status", "workerBootPacket.status");
  }
  validateDigest(packet, "bootPacketDigest", "worker-boot-packet@1", "workerBootPacket");
  return true;
}

function buildBootPacketProjectionWitness(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const packet = source.bootPacket || {};
  const witness = {
    schema: BOOT_PACKET_PROJECTION_WITNESS_SCHEMA,
    witnessId: normalizeId(source.witnessId, "boot_projection_witness"),
    bootPacketId: normalizeString(packet.bootPacketId || source.bootPacketId, ""),
    includedLaneCount: Array.isArray(packet.includedLaneKeys) ? packet.includedLaneKeys.length : 0,
    includedSectionCount: Array.isArray(packet.includedSectionKeys) ? packet.includedSectionKeys.length : 0,
    omissionCount: Array.isArray(packet.bootOmissions) ? packet.bootOmissions.length : 0,
    staleWarningCount: Array.isArray(packet.staleWarnings) ? packet.staleWarnings.length : 0,
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  witness.projectionWitnessDigest = digestFor("boot-packet-projection-witness@1", witness);
  return witness;
}

function validateBootPacketProjectionWitness(witness) {
  requirePlainObject(witness, "bootProjectionWitness");
  if (witness.schema !== BOOT_PACKET_PROJECTION_WITNESS_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "bootProjectionWitness");
  }
  requireString(witness.witnessId, "bootProjectionWitness.witnessId");
  requireString(witness.bootPacketId, "bootProjectionWitness.bootPacketId");
  if (witness.rawPromptIncluded === true || witness.rawTextIncluded === true || witness.rawPathIncluded === true || witness.rawSecretIncluded === true) {
    throw validationError("direct_thread_manager_raw_projection_witness_exposure", "bootProjectionWitness");
  }
  validateDigest(witness, "projectionWitnessDigest", "boot-packet-projection-witness@1", "bootProjectionWitness");
  return true;
}

function buildShadowContextPackIntegration(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contextPackRefs = normalizeRefs(source.contextPackRef ? [source.contextPackRef] : source.contextPackRefs, "context_pack");
  const integration = {
    schema: SHADOW_CONTEXT_PACK_INTEGRATION_SCHEMA,
    integrationId: normalizeId(source.integrationId, "shadow_context_pack_integration"),
    bootPacketId: normalizeString(source.bootPacketId, ""),
    targetWorkThreadId: normalizeString(source.targetWorkThreadId, ""),
    mode: "shadow_only",
    providerInjectionEnabled: false,
    contextPackRefs,
    rawContextTextIncluded: false,
    rawPromptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  integration.shadowIntegrationDigest = digestFor("shadow-context-pack-integration@1", integration);
  return integration;
}

function validateShadowContextPackIntegration(integration) {
  requirePlainObject(integration, "shadowContextPackIntegration");
  if (integration.schema !== SHADOW_CONTEXT_PACK_INTEGRATION_SCHEMA) {
    throw validationError("direct_thread_manager_schema_mismatch", "shadowContextPackIntegration");
  }
  requireString(integration.integrationId, "shadowContextPackIntegration.integrationId");
  if (integration.mode !== "shadow_only" || integration.providerInjectionEnabled !== false) {
    throw validationError("direct_thread_manager_context_integration_not_shadow", "shadowContextPackIntegration");
  }
  requireArray(integration.contextPackRefs, "shadowContextPackIntegration.contextPackRefs");
  integration.contextPackRefs.forEach((ref, index) => validateRef(ref, `shadowContextPackIntegration.contextPackRefs.${index}`, { requireDigest: false }));
  if (integration.rawContextTextIncluded === true || integration.rawPromptIncluded === true || integration.rawPathIncluded === true || integration.rawSecretIncluded === true) {
    throw validationError("direct_thread_manager_raw_context_integration_exposure", "shadowContextPackIntegration");
  }
  validateDigest(integration, "shadowIntegrationDigest", "shadow-context-pack-integration@1", "shadowContextPackIntegration");
  return true;
}

module.exports = {
  AUTHORITY_BOUNDARY_COMPARISON_WITNESS_SCHEMA,
  AUTHORITY_BOUNDARY_SCHEMA,
  BOOT_PACKET_OMISSION_SCHEMA,
  BOOT_PACKET_PROJECTION_WITNESS_SCHEMA,
  BOOT_PACKET_STALE_WARNING_SCHEMA,
  SHADOW_CONTEXT_PACK_INTEGRATION_SCHEMA,
  THREAD_MANAGER_PROFILE_SCHEMA,
  WORKER_BOOT_PACKET_SCHEMA,
  WORK_THREAD_DELEGATION_PACKET_SCHEMA,
  buildAuthorityBoundary,
  buildBootPacketOmission,
  buildBootPacketProjectionWitness,
  buildBootPacketStaleWarning,
  buildShadowContextPackIntegration,
  buildThreadManagerProfile,
  buildWorkThreadDelegationPacket,
  buildWorkerBootPacket,
  compareAuthorityBoundaries,
  validateAuthorityBoundary,
  validateAuthorityBoundaryComparisonWitness,
  validateBootPacketOmission,
  validateBootPacketProjectionWitness,
  validateBootPacketStaleWarning,
  validateShadowContextPackIntegration,
  validateThreadManagerProfile,
  validateWorkThreadDelegationPacket,
  validateWorkerBootPacket,
};
