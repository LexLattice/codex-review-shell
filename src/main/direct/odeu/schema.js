"use strict";

const ODEU_ARTIFACT_REF_SCHEMA = "odeu_artifact_ref@1";
const ODEU_SOURCE_REF_SCHEMA = "odeu_source_ref@1";
const ODEU_EVIDENCE_REF_SCHEMA = "odeu_evidence_ref@1";
const ODEU_RAW_EXPOSURE_SCAN_SCHEMA = "odeu_raw_exposure_scan@1";
const ODEU_ARTIFACT_BASE_SCHEMA = "odeu_artifact_base@1";

function validateRequiredString(value, label) {
  if (typeof value === "string" && value.trim()) return true;
  throw new Error(`missing_required_string:${label}`);
}

function validateBoolean(value, label) {
  if (typeof value === "boolean") return true;
  throw new Error(`missing_required_boolean:${label}`);
}

function validateArray(value, label) {
  if (Array.isArray(value)) return true;
  throw new Error(`missing_required_array:${label}`);
}

function validateOdeuDigest(value, label = "digest") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`missing_required_object:${label}`);
  }
  validateRequiredString(value.digestOf, `${label}.digestOf`);
  validateRequiredString(value.canonicalizationVersion, `${label}.canonicalizationVersion`);
  const hasComputedDigest = typeof value.algorithm === "string"
    && value.algorithm.trim()
    && typeof value.value === "string"
    && value.value.trim();
  const hasUnavailableReason = typeof value.unavailableReason === "string" && value.unavailableReason.trim();
  if (hasComputedDigest || hasUnavailableReason) return true;
  throw new Error(`missing_required_digest_value:${label}`);
}

function validateOdeuArtifactBase(value) {
  validateRequiredString(value?.schema, "schema");
  validateRequiredString(value?.kernelVersion, "kernelVersion");
  validateRequiredString(value?.artifactId, "artifactId");
  validateRequiredString(value?.artifactKind, "artifactKind");
  validateRequiredString(value?.createdAt, "createdAt");
  validateRequiredString(value?.createdBy, "createdBy");
  validateRequiredString(value?.status, "status");
  validateArray(value?.sourceRefs, "sourceRefs");
  validateOdeuRawExposureScan(value?.rawExposureScan);
  validateOdeuDigest(value?.artifactDigest, "artifactDigest");
  return true;
}

function validateOdeuRawExposureScan(value) {
  validateRequiredString(value?.schema, "schema");
  validateRequiredString(value?.scannerVersion, "scannerVersion");
  validateRequiredString(value?.scannedAt, "scannedAt");
  validateRequiredString(value?.scanScope, "scanScope");
  for (const field of [
    "passed",
    "rawPromptIncluded",
    "rawAssistantOutputIncluded",
    "rawProviderPayloadIncluded",
    "rawAuthIncluded",
    "rawAccountIdentifierIncluded",
    "rawPathIncluded",
    "rawUrlIncluded",
    "rawToolOutputIncluded",
    "rawWorkspaceContentIncluded",
    "rawExternalResourceIncluded",
    "rawImagePayloadIncluded",
    "rawSecretLikeIncluded",
  ]) {
    validateBoolean(value[field], field);
  }
  validateArray(value.blockers, "blockers");
  validateArray(value.warnings, "warnings");
  return true;
}

module.exports = {
  ODEU_ARTIFACT_BASE_SCHEMA,
  ODEU_ARTIFACT_REF_SCHEMA,
  ODEU_EVIDENCE_REF_SCHEMA,
  ODEU_RAW_EXPOSURE_SCAN_SCHEMA,
  ODEU_SOURCE_REF_SCHEMA,
  validateArray,
  validateBoolean,
  validateOdeuArtifactBase,
  validateOdeuDigest,
  validateOdeuRawExposureScan,
  validateRequiredString,
};
