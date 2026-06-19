"use strict";

const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const { buildOdeuArtifactBase } = require("./artifact");
const { artifactDigest, buildOdeuDigest } = require("./digest");
const { normalizeOdeuSourceRefs } = require("./source-ref");
const { validateOdeuArtifactBase, validateOdeuDigest } = require("./schema");
const { pickEnum } = require("./status");

const ODEU_RESULT_ENVELOPE_SCHEMA = "odeu_result_envelope@1";
const ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA = "odeu_context_admission_record@1";

const ODEU_RESULT_KINDS = Object.freeze([
  "status",
  "local_perception",
  "agent_result",
  "external_evidence",
  "generated_artifact",
  "context_transition",
  "code_result",
  "account_mutation_result",
  "module_result",
  "human_decision_result",
  "mcp_resource",
  "web_search_result",
  "image_generation_result",
  "batch_job_result",
  "quota_reset_result",
  "hook_result",
  "browser_result",
  "plan_update_result",
]);

const ODEU_RENDERER_VISIBILITY = Object.freeze(["none", "summary", "detail", "artifact_ref"]);
const ODEU_RESIDENT_VISIBILITY = Object.freeze(["none", "summary", "detail", "status_only"]);
const ODEU_PROVIDER_VISIBILITY = Object.freeze(["not_seen", "summary_only", "payload_sent", "unknown", "not_applicable"]);
const ODEU_TRANSCRIPT_VISIBILITY = Object.freeze(["none", "summary", "transcript_safe"]);
const ODEU_REDACTION_STATES = Object.freeze(["none_needed", "redacted", "blocked", "unknown"]);
const ODEU_TRUNCATION_STATES = Object.freeze(["none", "truncated", "omitted", "unknown"]);
const ODEU_RESULT_CONFIDENCE = Object.freeze(["exact", "derived", "partial", "unknown"]);

const ODEU_ADMISSION_DECISIONS = Object.freeze([
  "admit",
  "do_not_admit",
  "blocked_raw_exposure",
  "blocked_policy",
  "blocked_stale",
  "pending",
]);

const ODEU_ADMITTED_AS_VALUES = Object.freeze([
  "tool_result_evidence",
  "external_source_evidence",
  "generated_artifact_ref",
  "agent_result_summary",
  "context_status",
  "memory_candidate",
  "operator_decision",
  "plan_evidence",
  "not_admitted",
]);

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
}

function normalizeVisibility(input = {}) {
  const value = isPlainObject(input) ? input : {};
  return {
    localRecorded: value.localRecorded !== false,
    rendererVisible: pickEnum(value.rendererVisible, ODEU_RENDERER_VISIBILITY, "none"),
    residentVisible: pickEnum(value.residentVisible, ODEU_RESIDENT_VISIBILITY, "none"),
    providerVisible: pickEnum(value.providerVisible, ODEU_PROVIDER_VISIBILITY, "not_applicable"),
    transcriptVisible: pickEnum(value.transcriptVisible, ODEU_TRANSCRIPT_VISIBILITY, "none"),
  };
}

function normalizePayloadPolicy(input = {}) {
  const value = isPlainObject(input) ? input : {};
  return {
    rawPayloadStored: value.rawPayloadStored === true,
    rawPayloadProviderSent: value.rawPayloadProviderSent === true,
    rawPayloadRendererVisible: value.rawPayloadRendererVisible === true,
    redactionState: pickEnum(value.redactionState, ODEU_REDACTION_STATES, "unknown"),
    truncationState: pickEnum(value.truncationState, ODEU_TRUNCATION_STATES, "unknown"),
  };
}

function buildResultArtifactBase(input = {}, options = {}, artifactKind) {
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
      callId: input.callId,
      transactionId: input.transactionId,
      rendererSafeSummary: input.rendererSafeSummary,
    },
  }, options);
}

function buildOdeuResultEnvelope(input = {}, options = {}) {
  input = isPlainObject(input) ? input : {};
  options = isPlainObject(options) ? options : {};
  const resultEnvelopeId = normalizeId(input.resultEnvelopeId, "odeu_result_envelope");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const familyExtension = isPlainObject(input.familyExtension) ? { ...input.familyExtension } : undefined;
  const envelope = {
    ...buildResultArtifactBase({
      ...input,
      schema: ODEU_RESULT_ENVELOPE_SCHEMA,
      artifactId: input.artifactId || resultEnvelopeId,
      sourceRefs,
      familyExtension,
    }, options, "odeu_result_envelope"),
    schema: ODEU_RESULT_ENVELOPE_SCHEMA,
    resultEnvelopeId,
    capabilityId: normalizeId(input.capabilityId, "odeu_capability"),
    callId: normalizeId(input.callId, "odeu_capability_call"),
    resultKind: pickEnum(input.resultKind, ODEU_RESULT_KINDS, "status"),
    sourceRefs,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Result recorded."),
    visibility: normalizeVisibility(input.visibility),
    payloadPolicy: normalizePayloadPolicy(input.payloadPolicy),
    rawTextIncluded: input.rawTextIncluded === true,
    rawPathIncluded: input.rawPathIncluded === true,
    rawProviderPayloadIncluded: input.rawProviderPayloadIncluded === true,
    confidence: pickEnum(input.confidence, ODEU_RESULT_CONFIDENCE, "unknown"),
  };
  const transactionId = normalizeString(input.transactionId, "");
  if (transactionId) envelope.transactionId = transactionId;
  const familyResultKind = normalizeString(input.familyResultKind, "");
  if (familyResultKind) envelope.familyResultKind = familyResultKind;
  if (familyExtension) envelope.familyExtension = familyExtension;
  if (input.resultDigest && isPlainObject(input.resultDigest)) {
    envelope.resultDigest = buildOdeuDigest(input.resultDigest);
  }
  const providerVisibleSummary = normalizeString(input.providerVisibleSummary, "");
  if (providerVisibleSummary) envelope.providerVisibleSummary = providerVisibleSummary;
  envelope.artifactDigest = artifactDigest({
    schema: envelope.schema,
    artifactKind: "odeu_result_envelope",
    value: envelope,
  });
  validateOdeuResultEnvelope(envelope);
  return envelope;
}

function buildOdeuContextAdmissionRecord(input = {}, options = {}) {
  input = isPlainObject(input) ? input : {};
  options = isPlainObject(options) ? options : {};
  const admissionId = normalizeId(input.admissionId, "odeu_context_admission");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const admission = {
    ...buildResultArtifactBase({
      ...input,
      schema: ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA,
      artifactId: input.artifactId || admissionId,
      sourceRefs,
    }, options, "odeu_context_admission_record"),
    schema: ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA,
    admissionId,
    resultEnvelopeId: normalizeId(input.resultEnvelopeId, "odeu_result_envelope"),
    admissionDecision: pickEnum(input.admissionDecision, ODEU_ADMISSION_DECISIONS, "pending"),
    admittedAs: pickEnum(input.admittedAs, ODEU_ADMITTED_AS_VALUES, "not_admitted"),
    providerSawResult: pickEnum(input.providerSawResult, ODEU_PROVIDER_VISIBILITY, "unknown"),
    omissionLedgerRefs: normalizeStringList(input.omissionLedgerRefs),
    admittedAt: normalizeString(input.admittedAt, nowIso(options.now || Date.now)),
  };
  for (const field of ["contextPackId", "requestManifestId"]) {
    const value = normalizeString(input[field], "");
    if (value) admission[field] = value;
  }
  if (input.admissionPolicyDigest && isPlainObject(input.admissionPolicyDigest)) {
    admission.admissionPolicyDigest = buildOdeuDigest(input.admissionPolicyDigest);
  }
  admission.artifactDigest = artifactDigest({
    schema: admission.schema,
    artifactKind: "odeu_context_admission_record",
    value: admission,
  });
  validateOdeuContextAdmissionRecord(admission);
  return admission;
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

function validateVisibility(value = {}, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:visibility");
    return;
  }
  validateBoolean(value.localRecorded, "visibility.localRecorded", errors);
  validateEnum(value.rendererVisible, ODEU_RENDERER_VISIBILITY, "visibility.rendererVisible", errors);
  validateEnum(value.residentVisible, ODEU_RESIDENT_VISIBILITY, "visibility.residentVisible", errors);
  validateEnum(value.providerVisible, ODEU_PROVIDER_VISIBILITY, "visibility.providerVisible", errors);
  validateEnum(value.transcriptVisible, ODEU_TRANSCRIPT_VISIBILITY, "visibility.transcriptVisible", errors);
}

function validatePayloadPolicy(value = {}, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:payloadPolicy");
    return;
  }
  for (const field of ["rawPayloadStored", "rawPayloadProviderSent", "rawPayloadRendererVisible"]) {
    validateBoolean(value[field], `payloadPolicy.${field}`, errors);
  }
  validateEnum(value.redactionState, ODEU_REDACTION_STATES, "payloadPolicy.redactionState", errors);
  validateEnum(value.truncationState, ODEU_TRUNCATION_STATES, "payloadPolicy.truncationState", errors);
  if (value.rawPayloadRendererVisible) errors.push("raw_payload_renderer_visible");
}

function validateOdeuResultEnvelope(value = {}) {
  const errors = [];
  validateBase(value, errors);
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:resultEnvelope");
    throw new Error(`odeu_result_envelope_validation_failed:${errors.join(",")}`);
  }
  validateRequiredString(value.resultEnvelopeId, "resultEnvelopeId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateRequiredString(value.callId, "callId", errors);
  validateEnum(value.resultKind, ODEU_RESULT_KINDS, "resultKind", errors);
  validateArray(value.sourceRefs, "sourceRefs", errors);
  validateRequiredString(value.rendererSafeSummary, "rendererSafeSummary", errors);
  validateVisibility(value.visibility, errors);
  validatePayloadPolicy(value.payloadPolicy, errors);
  validateBoolean(value.rawTextIncluded, "rawTextIncluded", errors);
  validateBoolean(value.rawPathIncluded, "rawPathIncluded", errors);
  validateBoolean(value.rawProviderPayloadIncluded, "rawProviderPayloadIncluded", errors);
  validateEnum(value.confidence, ODEU_RESULT_CONFIDENCE, "confidence", errors);
  const visibility = isPlainObject(value.visibility) ? value.visibility : {};
  const payloadPolicy = isPlainObject(value.payloadPolicy) ? value.payloadPolicy : {};
  try {
    if (value.resultDigest) validateOdeuDigest(value.resultDigest, "resultDigest");
  } catch (error) {
    errors.push(error.message || String(error));
  }
  if (value.rawTextIncluded) errors.push("raw_text_included");
  if (value.rawPathIncluded) errors.push("raw_path_included");
  if (value.rawProviderPayloadIncluded) errors.push("raw_provider_payload_included");
  if (visibility.transcriptVisible === "transcript_safe" && (value.rawTextIncluded || value.rawPathIncluded || value.rawProviderPayloadIncluded)) {
    errors.push("transcript_safe_requires_no_raw_payload");
  }
  if (visibility.providerVisible === "payload_sent" && payloadPolicy.rawPayloadProviderSent !== true) {
    errors.push("provider_payload_visibility_requires_payload_policy");
  }
  if (payloadPolicy.rawPayloadProviderSent === true && visibility.providerVisible !== "payload_sent") {
    errors.push("provider_payload_policy_requires_payload_visibility");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_result_envelope_validation_failed:${errors.join(",")}`);
}

function validateOdeuContextAdmissionRecord(value = {}) {
  const errors = [];
  validateBase(value, errors);
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:contextAdmission");
    throw new Error(`odeu_context_admission_validation_failed:${errors.join(",")}`);
  }
  validateRequiredString(value.admissionId, "admissionId", errors);
  validateRequiredString(value.resultEnvelopeId, "resultEnvelopeId", errors);
  validateEnum(value.admissionDecision, ODEU_ADMISSION_DECISIONS, "admissionDecision", errors);
  validateEnum(value.admittedAs, ODEU_ADMITTED_AS_VALUES, "admittedAs", errors);
  validateEnum(value.providerSawResult, ODEU_PROVIDER_VISIBILITY, "providerSawResult", errors);
  validateArray(value.omissionLedgerRefs, "omissionLedgerRefs", errors);
  validateRequiredString(value.admittedAt, "admittedAt", errors);
  try {
    if (value.admissionPolicyDigest) validateOdeuDigest(value.admissionPolicyDigest, "admissionPolicyDigest");
  } catch (error) {
    errors.push(error.message || String(error));
  }
  if (value.admissionDecision === "admit" && value.admittedAs === "not_admitted") {
    errors.push("admit_requires_admitted_as");
  }
  if (value.admissionDecision !== "admit" && value.admittedAs !== "not_admitted") {
    errors.push("non_admit_requires_not_admitted");
  }
  if (["blocked_raw_exposure", "blocked_policy", "blocked_stale"].includes(value.admissionDecision) && value.omissionLedgerRefs.length === 0) {
    errors.push("blocked_admission_requires_omission_ref");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_context_admission_validation_failed:${errors.join(",")}`);
}

module.exports = {
  ODEU_ADMISSION_DECISIONS,
  ODEU_ADMITTED_AS_VALUES,
  ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA,
  ODEU_PROVIDER_VISIBILITY,
  ODEU_RENDERER_VISIBILITY,
  ODEU_RESIDENT_VISIBILITY,
  ODEU_RESULT_CONFIDENCE,
  ODEU_RESULT_ENVELOPE_SCHEMA,
  ODEU_RESULT_KINDS,
  ODEU_TRANSCRIPT_VISIBILITY,
  buildOdeuContextAdmissionRecord,
  buildOdeuResultEnvelope,
  validateOdeuContextAdmissionRecord,
  validateOdeuResultEnvelope,
};
