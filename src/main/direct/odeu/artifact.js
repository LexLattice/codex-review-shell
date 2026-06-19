"use strict";

const { normalizeId, normalizeString, nowIso } = require("../meta-session/ids");
const { artifactDigest, buildOdeuDigest } = require("./digest");
const { buildOdeuRawExposureScan } = require("./raw-exposure");
const { normalizeOdeuSourceRefs } = require("./source-ref");
const {
  ODEU_LIVE_CAPABILITY_KERNEL_VERSION,
  ODEU_OBJECT_STATUSES,
  pickEnum,
} = require("./status");
const {
  ODEU_ARTIFACT_BASE_SCHEMA,
  ODEU_ARTIFACT_REF_SCHEMA,
  validateOdeuArtifactBase,
} = require("./schema");

function normalizeScope(input = {}) {
  const scope = {};
  for (const field of [
    "projectId",
    "workThreadId",
    "threadId",
    "turnId",
    "routeId",
    "providerProfileId",
    "modelId",
  ]) {
    const value = normalizeString(input[field], "");
    if (value) scope[field] = value;
  }
  if (["direct_text", "direct_implementation", "headless_direct", "operator_ui"].includes(input.runtimeTier)) {
    scope.runtimeTier = input.runtimeTier;
  }
  if (["fixture", "headless_live", "operator_live", "resident_live"].includes(input.environment)) {
    scope.environment = input.environment;
  }
  return scope;
}

function buildOdeuArtifactBase(input = {}, options = {}) {
  const artifactKind = normalizeString(input.artifactKind, "unknown");
  const artifactId = normalizeId(input.artifactId, `odeu_${artifactKind}`);
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const rawExposureScan = input.rawExposureScan || buildOdeuRawExposureScan(input.rawExposureValue || {
    artifactKind,
    artifactId,
    sourceRefs,
  }, {
    scanScope: input.rawExposureScanScope || "artifact",
    now: options.now,
  });
  const artifact = {
    schema: normalizeString(input.schema, ODEU_ARTIFACT_BASE_SCHEMA),
    kernelVersion: ODEU_LIVE_CAPABILITY_KERNEL_VERSION,
    artifactId,
    artifactKind,
    createdAt: normalizeString(input.createdAt, nowIso(options.now || Date.now)),
    createdBy: ["harness", "fixture", "migration", "operator", "provider_event"].includes(input.createdBy)
      ? input.createdBy
      : "harness",
    sourceRefs,
    rawExposureScan,
    status: pickEnum(input.status, ODEU_OBJECT_STATUSES, "valid"),
  };
  const scope = normalizeScope(input.scope || input);
  if (Object.keys(scope).length) artifact.scope = scope;
  const statusReason = normalizeString(input.statusReason, "");
  if (statusReason) artifact.statusReason = statusReason;
  if (Array.isArray(input.blockers)) artifact.blockers = input.blockers.map((entry) => normalizeString(entry, "")).filter(Boolean);
  if (input.familyExtension && typeof input.familyExtension === "object" && !Array.isArray(input.familyExtension)) {
    artifact.familyExtension = { ...input.familyExtension };
  }
  artifact.artifactDigest = input.artifactDigest && typeof input.artifactDigest === "object"
    ? buildOdeuDigest(input.artifactDigest)
    : artifactDigest({
      schema: artifact.schema,
      artifactKind,
      value: artifact,
    });
  validateOdeuArtifactBase(artifact);
  return artifact;
}

function buildOdeuArtifactRef(input = {}, options = {}) {
  const artifactKind = normalizeString(input.artifactKind, "unknown");
  const artifactId = normalizeString(input.artifactId, "");
  const ref = {
    schema: ODEU_ARTIFACT_REF_SCHEMA,
    artifactKind,
    artifactId,
    artifactDigest: input.artifactDigest && typeof input.artifactDigest === "object"
      ? buildOdeuDigest(input.artifactDigest)
      : buildOdeuDigest({ unavailableReason: "not_computed", digestOf: "metadata" }),
  };
  const label = normalizeString(input.rendererSafeLabel, "");
  if (label) ref.rendererSafeLabel = label;
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  if (sourceRefs.length) ref.sourceRefs = sourceRefs;
  return ref;
}

module.exports = {
  buildOdeuArtifactBase,
  buildOdeuArtifactRef,
  normalizeScope,
};
