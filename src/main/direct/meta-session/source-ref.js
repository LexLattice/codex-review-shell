"use strict";

const {
  DIRECT_META_ARTIFACT_REF_SCHEMA,
  DIRECT_META_AUTHORITY_VALUES,
  DIRECT_META_SOURCE_KINDS,
  DIRECT_META_SOURCE_REF_SCHEMA,
} = require("./constants");
const { artifactDigest } = require("./digest");
const { normalizeId, normalizeString } = require("./ids");

function buildSourceRef(input = {}, options = {}) {
  const sourceKind = DIRECT_META_SOURCE_KINDS.includes(input.sourceKind) ? input.sourceKind : "unknown";
  const authority = DIRECT_META_AUTHORITY_VALUES.includes(input.authority) ? input.authority : "diagnostic";
  const ref = {
    schemaVersion: DIRECT_META_SOURCE_REF_SCHEMA,
    sourceRefId: normalizeId(input.sourceRefId, "source_ref"),
    sourceKind,
    authority,
    sourceDigest: normalizeString(input.sourceDigest, options.sourceDigest || "sha256:fixture"),
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, `${sourceKind} evidence`),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  ref.digest = artifactDigest({
    schemaVersion: ref.schemaVersion,
    artifactKind: "source_ref",
    value: ref,
  });
  return ref;
}

function symbolicStorageSlot(value = "") {
  return normalizeString(value, "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function buildArtifactRef(input = {}) {
  const ref = {
    schemaVersion: DIRECT_META_ARTIFACT_REF_SCHEMA,
    artifactKind: normalizeString(input.artifactKind, "unknown"),
    artifactId: normalizeString(input.artifactId, ""),
    artifactDigest: normalizeString(input.artifactDigest, ""),
  };
  const storageSlot = symbolicStorageSlot(input.storageSlot);
  if (storageSlot) ref.storageSlot = storageSlot;
  const label = normalizeString(input.rendererSafeLabel, "");
  if (label) ref.rendererSafeLabel = label;
  return ref;
}

function artifactRefFromArtifact(artifactKind, artifact, storageSlot = "") {
  const artifactId = artifact?.metaSessionId
    || artifact?.registryId
    || artifact?.contractId
    || artifact?.id
    || artifact?.rowId
    || artifact?.transitionClaimId
    || artifact?.lockId
    || artifact?.attemptId
    || artifact?.projectionId
    || artifact?.pointerSetId
    || artifact?.eventId
    || artifact?.sourceRefId
    || "unknown";
  return buildArtifactRef({
    artifactKind,
    artifactId,
    artifactDigest: artifact?.digest || artifact?.pointerSetDigest || artifact?.eventDigest || "",
    storageSlot,
    rendererSafeLabel: `${artifactKind}:${artifactId}`,
  });
}

module.exports = {
  artifactRefFromArtifact,
  buildArtifactRef,
  buildSourceRef,
  symbolicStorageSlot,
};
