"use strict";

const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const { buildOdeuArtifactBase } = require("./artifact");
const { artifactDigest } = require("./digest");
const { normalizeOdeuSourceRefs } = require("./source-ref");
const { validateOdeuArtifactBase } = require("./schema");
const { pickEnum } = require("./status");

const ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA = "odeu_capability_usability_proof@1";
const ODEU_CAPABILITY_WITNESS_ROW_SCHEMA = "odeu_capability_witness_row@1";

const ODEU_USABLE_FOR_VALUES = Object.freeze([
  "operator_ui_live",
  "resident_visible",
  "resident_requestable",
  "resident_callable",
  "provider_declared",
]);

const ODEU_PROOF_CLASSES = Object.freeze([
  "fixture",
  "headless_live",
  "operator_ui_live",
  "resident_live",
]);

const ODEU_CAPABILITY_WITNESS_STATUSES = Object.freeze([
  "callable_now",
  "known_available",
  "known_disabled",
  "operator_only",
  "shadow_only",
  "blocked",
  "stale",
  "unknown",
]);

const ODEU_PROOF_REQUIREMENT_KEYS = Object.freeze([
  "promotionDecisionRequired",
  "activationRequired",
  "declarationRequired",
  "authorityDecisionRequired",
  "transactionRequired",
  "resultEnvelopeRequired",
  "contextAdmissionRequired",
  "residentWitnessRequired",
  "operatorSurfaceRequired",
  "recoveryTestRequired",
]);

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
}

function normalizeProofRequirements(input = {}, usableFor = "resident_visible", proofClass = "fixture") {
  const value = isPlainObject(input) ? input : {};
  const requirements = {};
  for (const key of ODEU_PROOF_REQUIREMENT_KEYS) requirements[key] = value[key] === true;

  requirements.promotionDecisionRequired = true;
  requirements.activationRequired = true;

  if (["resident_visible", "resident_requestable", "resident_callable", "provider_declared"].includes(usableFor)) {
    requirements.declarationRequired = true;
  }
  if (usableFor === "resident_requestable") {
    requirements.residentWitnessRequired = true;
  }
  if (usableFor === "resident_callable") {
    requirements.declarationRequired = true;
    requirements.authorityDecisionRequired = true;
    requirements.transactionRequired = true;
    requirements.resultEnvelopeRequired = true;
    requirements.contextAdmissionRequired = true;
    requirements.residentWitnessRequired = true;
  }
  if (usableFor === "provider_declared") {
    requirements.declarationRequired = true;
  }
  if (usableFor === "operator_ui_live") {
    requirements.operatorSurfaceRequired = true;
  }
  if (proofClass !== "fixture") {
    requirements.recoveryTestRequired = true;
  }

  return requirements;
}

function normalizeFirstUsableSlice(input = {}) {
  const value = isPlainObject(input) ? input : {};
  return {
    sliceId: normalizeId(value.sliceId, "odeu_first_usable_slice"),
    description: normalizeString(value.description, "First usable capability slice."),
    capabilitiesIncluded: normalizeStringList(value.capabilitiesIncluded),
    stillDiagnostic: normalizeStringList(value.stillDiagnostic),
    stillBlocked: normalizeStringList(value.stillBlocked),
  };
}

function normalizeProofEvidence(input = {}) {
  const value = isPlainObject(input) ? input : {};
  return {
    deterministicChecksPassed: value.deterministicChecksPassed === true,
    ...(typeof value.modelSelfReportSmokePassed === "boolean"
      ? { modelSelfReportSmokePassed: value.modelSelfReportSmokePassed }
      : {}),
    selfReportIsSupplemental: true,
  };
}

function buildProofArtifactBase(input = {}, options = {}, artifactKind) {
  input = isPlainObject(input) ? input : {};
  options = isPlainObject(options) ? options : {};
  return buildOdeuArtifactBase({
    ...input,
    artifactKind,
    rawExposureValue: input.rawExposureValue || {
      artifactKind,
      artifactId: input.artifactId,
      sourceRefs: input.sourceRefs,
      capabilityId: input.capabilityId,
      proofId: input.proofId,
      witnessRowId: input.witnessRowId,
      compactText: input.compactText,
      firstUsableSlice: input.firstUsableSlice,
    },
  }, options);
}

function buildOdeuCapabilityUsabilityProof(input = {}, options = {}) {
  input = isPlainObject(input) ? input : {};
  options = isPlainObject(options) ? options : {};
  const proofId = normalizeId(input.proofId, "odeu_capability_usability_proof");
  const capabilityId = normalizeId(input.capabilityId, "odeu_capability");
  const usableFor = pickEnum(input.usableFor, ODEU_USABLE_FOR_VALUES, "resident_visible");
  const proofClass = pickEnum(input.proofClass, ODEU_PROOF_CLASSES, "fixture");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const firstUsableSlice = normalizeFirstUsableSlice(input.firstUsableSlice);
  const proofRequirements = normalizeProofRequirements(input.proofRequirements, usableFor, proofClass);
  const proofEvidence = normalizeProofEvidence(input.proofEvidence);
  const proof = {
    ...buildProofArtifactBase({
      ...input,
      schema: ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA,
      artifactId: input.artifactId || proofId,
      sourceRefs,
      capabilityId,
      proofId,
      firstUsableSlice,
    }, options, "odeu_capability_usability_proof"),
    schema: ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA,
    proofId,
    capabilityId,
    family: normalizeString(input.family, "unknown"),
    firstUsableSlice,
    promotionDecisionId: normalizeId(input.promotionDecisionId, "odeu_promotion_decision"),
    activationSnapshotId: normalizeId(input.activationSnapshotId, "odeu_activation_snapshot"),
    usableFor,
    proofClass,
    proofRequirements,
    proofEvidence,
    recoveryTested: input.recoveryTested === true,
    rawExposurePassed: input.rawExposurePassed !== false,
    provedAt: normalizeString(input.provedAt, nowIso(options.now || Date.now)),
  };

  for (const field of [
    "declarationSnapshotId",
    "authorityDecisionId",
    "transactionId",
    "resultEnvelopeId",
    "contextAdmissionId",
    "residentSnapshotId",
    "operatorSurfaceId",
  ]) {
    const value = normalizeString(input[field], "");
    if (value) proof[field] = value;
  }

  proof.artifactDigest = artifactDigest({
    schema: proof.schema,
    artifactKind: "odeu_capability_usability_proof",
    value: proof,
  });
  validateOdeuCapabilityUsabilityProof(proof);
  return proof;
}

function buildOdeuCapabilityWitnessRow(input = {}, options = {}) {
  input = isPlainObject(input) ? input : {};
  options = isPlainObject(options) ? options : {};
  const witnessRowId = normalizeId(input.witnessRowId, "odeu_capability_witness_row");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const residentCallable = input.residentCallable === true;
  const operatorCallable = input.operatorCallable === true;
  const witness = {
    ...buildProofArtifactBase({
      ...input,
      schema: ODEU_CAPABILITY_WITNESS_ROW_SCHEMA,
      artifactId: input.artifactId || witnessRowId,
      sourceRefs,
      witnessRowId,
    }, options, "odeu_capability_witness_row"),
    schema: ODEU_CAPABILITY_WITNESS_ROW_SCHEMA,
    witnessRowId,
    capabilityId: normalizeId(input.capabilityId, "odeu_capability"),
    residentVisible: input.residentVisible === true,
    residentCallable,
    operatorVisible: input.operatorVisible === true,
    operatorCallable,
    status: pickEnum(input.status, ODEU_CAPABILITY_WITNESS_STATUSES, residentCallable || operatorCallable ? "callable_now" : "unknown"),
    compactText: normalizeString(input.compactText, "Capability status unknown."),
    sourceRefs,
  };
  const usabilityProofId = normalizeString(input.usabilityProofId, "");
  if (usabilityProofId) witness.usabilityProofId = usabilityProofId;
  witness.artifactDigest = artifactDigest({
    schema: witness.schema,
    artifactKind: "odeu_capability_witness_row",
    value: witness,
  });
  validateOdeuCapabilityWitnessRow(witness);
  return witness;
}

function validateRequiredString(value, label, errors) {
  if (typeof value === "string" && value.trim()) return;
  errors.push(`missing_required_string:${label}`);
}

function validateEnum(value, allowed, label, errors) {
  if (allowed.includes(value)) return;
  errors.push(`invalid_enum:${label}:${value || ""}`);
}

function validateBoolean(value, label, errors) {
  if (typeof value === "boolean") return;
  errors.push(`missing_required_boolean:${label}`);
}

function validateArray(value, label, errors) {
  if (Array.isArray(value)) return;
  errors.push(`missing_required_array:${label}`);
}

function validateBase(value, errors) {
  try {
    validateOdeuArtifactBase(value);
  } catch (error) {
    errors.push(error.message || String(error));
  }
}

function validateFirstUsableSlice(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:firstUsableSlice");
    return;
  }
  validateRequiredString(value.sliceId, "firstUsableSlice.sliceId", errors);
  validateRequiredString(value.description, "firstUsableSlice.description", errors);
  validateArray(value.capabilitiesIncluded, "firstUsableSlice.capabilitiesIncluded", errors);
  validateArray(value.stillDiagnostic, "firstUsableSlice.stillDiagnostic", errors);
  validateArray(value.stillBlocked, "firstUsableSlice.stillBlocked", errors);
}

function validateProofRequirements(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:proofRequirements");
    return;
  }
  for (const key of ODEU_PROOF_REQUIREMENT_KEYS) validateBoolean(value[key], `proofRequirements.${key}`, errors);
}

function validateProofEvidence(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:proofEvidence");
    return;
  }
  validateBoolean(value.deterministicChecksPassed, "proofEvidence.deterministicChecksPassed", errors);
  if (typeof value.modelSelfReportSmokePassed !== "undefined") {
    validateBoolean(value.modelSelfReportSmokePassed, "proofEvidence.modelSelfReportSmokePassed", errors);
  }
  if (value.selfReportIsSupplemental !== true) errors.push("self_report_must_be_supplemental");
  if (value.modelSelfReportSmokePassed === true && value.deterministicChecksPassed !== true) {
    errors.push("self_report_cannot_prove_usability");
  }
}

function validateRequirementRefs(value, errors) {
  const requirements = isPlainObject(value.proofRequirements) ? value.proofRequirements : {};
  const requiredRefs = [
    ["promotionDecisionRequired", "promotionDecisionId"],
    ["activationRequired", "activationSnapshotId"],
    ["declarationRequired", "declarationSnapshotId"],
    ["authorityDecisionRequired", "authorityDecisionId"],
    ["transactionRequired", "transactionId"],
    ["resultEnvelopeRequired", "resultEnvelopeId"],
    ["contextAdmissionRequired", "contextAdmissionId"],
    ["residentWitnessRequired", "residentSnapshotId"],
    ["operatorSurfaceRequired", "operatorSurfaceId"],
  ];
  for (const [requirement, refField] of requiredRefs) {
    if (requirements[requirement] === true) validateRequiredString(value[refField], refField, errors);
  }
  if (requirements.recoveryTestRequired === true && value.recoveryTested !== true) {
    errors.push("recovery_test_required");
  }
  if (value.usableFor === "resident_callable") {
    for (const key of [
      "declarationRequired",
      "authorityDecisionRequired",
      "transactionRequired",
      "resultEnvelopeRequired",
      "contextAdmissionRequired",
      "residentWitnessRequired",
    ]) {
      if (requirements[key] !== true) errors.push(`resident_callable_requires:${key}`);
    }
  }
  if (value.usableFor === "provider_declared" && requirements.declarationRequired !== true) {
    errors.push("provider_declared_requires_declaration");
  }
  if (value.usableFor === "operator_ui_live" && requirements.operatorSurfaceRequired !== true) {
    errors.push("operator_ui_live_requires_operator_surface");
  }
}

function validateOdeuCapabilityUsabilityProof(value = {}) {
  const errors = [];
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:capabilityUsabilityProof");
    throw new Error(`odeu_capability_usability_proof_validation_failed:${errors.join(",")}`);
  }
  validateBase(value, errors);
  validateRequiredString(value.proofId, "proofId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateRequiredString(value.family, "family", errors);
  validateFirstUsableSlice(value.firstUsableSlice, errors);
  validateRequiredString(value.promotionDecisionId, "promotionDecisionId", errors);
  validateRequiredString(value.activationSnapshotId, "activationSnapshotId", errors);
  validateEnum(value.usableFor, ODEU_USABLE_FOR_VALUES, "usableFor", errors);
  validateEnum(value.proofClass, ODEU_PROOF_CLASSES, "proofClass", errors);
  validateProofRequirements(value.proofRequirements, errors);
  validateProofEvidence(value.proofEvidence, errors);
  validateBoolean(value.recoveryTested, "recoveryTested", errors);
  validateBoolean(value.rawExposurePassed, "rawExposurePassed", errors);
  validateRequiredString(value.provedAt, "provedAt", errors);
  validateRequirementRefs(value, errors);
  if (value.rawExposurePassed !== true || value.rawExposureScan?.passed !== true) {
    errors.push("raw_exposure_not_passed");
  }
  if (isPlainObject(value.proofEvidence) && value.proofEvidence.deterministicChecksPassed !== true) {
    errors.push("deterministic_proof_required");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_capability_usability_proof_validation_failed:${errors.join(",")}`);
}

function validateOdeuCapabilityWitnessRow(value = {}) {
  const errors = [];
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:capabilityWitnessRow");
    throw new Error(`odeu_capability_witness_row_validation_failed:${errors.join(",")}`);
  }
  validateBase(value, errors);
  validateRequiredString(value.witnessRowId, "witnessRowId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  for (const field of ["residentVisible", "residentCallable", "operatorVisible", "operatorCallable"]) {
    validateBoolean(value[field], field, errors);
  }
  validateEnum(value.status, ODEU_CAPABILITY_WITNESS_STATUSES, "status", errors);
  validateRequiredString(value.compactText, "compactText", errors);
  validateArray(value.sourceRefs, "sourceRefs", errors);
  if ((value.residentVisible || value.operatorVisible || value.residentCallable || value.operatorCallable) && !normalizeString(value.usabilityProofId, "")) {
    errors.push("visible_witness_requires_usability_proof");
  }
  if (value.residentCallable === true && value.status !== "callable_now") {
    errors.push("resident_callable_requires_callable_status");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_capability_witness_row_validation_failed:${errors.join(",")}`);
}

module.exports = {
  ODEU_CAPABILITY_USABILITY_PROOF_SCHEMA,
  ODEU_CAPABILITY_WITNESS_ROW_SCHEMA,
  ODEU_CAPABILITY_WITNESS_STATUSES,
  ODEU_PROOF_CLASSES,
  ODEU_PROOF_REQUIREMENT_KEYS,
  ODEU_USABLE_FOR_VALUES,
  buildOdeuCapabilityUsabilityProof,
  buildOdeuCapabilityWitnessRow,
  normalizeProofRequirements,
  validateOdeuCapabilityUsabilityProof,
  validateOdeuCapabilityWitnessRow,
};
