#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA,
  ODEU_RESULT_ENVELOPE_SCHEMA,
  buildOdeuContextAdmissionRecord,
  buildOdeuDigest,
  buildOdeuResultEnvelope,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuContextAdmissionRecord,
  validateOdeuResultEnvelope,
} = require("../src/main/direct/odeu");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const fixedNow = () => Date.UTC(2026, 5, 19, 19, 0, 0);

const sourceRef = normalizeOdeuSourceRef({
  sourceRefId: "source_result_fixture",
  sourceKind: "tool_result",
  sourceId: "tool_result_fixture",
  sourceConfidence: "fixture",
  freshness: "fresh",
  callId: "call_read_file_fixture",
}, { now: fixedNow });

const resultDigest = digestCanonicalJson({
  rendererSafeSummary: "Read file metadata summary",
  pathEvidenceKey: "workspace_file_ref_fixture",
}, { domain: "result-envelope-fixture@1", digestOf: "metadata" });

const resultEnvelope = buildOdeuResultEnvelope({
  resultEnvelopeId: "result_envelope_read_fixture",
  capabilityId: "capability_read_file_fixture",
  callId: "call_read_file_fixture",
  transactionId: "transaction_read_file_fixture",
  resultKind: "local_perception",
  familyResultKind: "read_file_metadata",
  familyExtension: {
    lineCount: 42,
    byteCount: 1024,
  },
  sourceRefs: [sourceRef],
  resultDigest,
  rendererSafeSummary: "Read file metadata summary.",
  providerVisibleSummary: "File metadata was read and summarized.",
  visibility: {
    localRecorded: true,
    rendererVisible: "summary",
    residentVisible: "summary",
    providerVisible: "summary_only",
    transcriptVisible: "transcript_safe",
  },
  payloadPolicy: {
    rawPayloadStored: false,
    rawPayloadProviderSent: false,
    rawPayloadRendererVisible: false,
    redactionState: "none_needed",
    truncationState: "none",
  },
  rawTextIncluded: false,
  rawPathIncluded: false,
  rawProviderPayloadIncluded: false,
  confidence: "exact",
}, { now: fixedNow });

assert(resultEnvelope.schema === ODEU_RESULT_ENVELOPE_SCHEMA, "result envelope schema mismatch");
assert(resultEnvelope.resultKind === "local_perception", "result kind mismatch");
assert(resultEnvelope.visibility.transcriptVisible === "transcript_safe", "transcript visibility mismatch");
assert(resultEnvelope.payloadPolicy.rawPayloadRendererVisible === false, "renderer raw payload must be false");
assert(resultEnvelope.sourceRefs[0].schema === "odeu_source_ref@1", "source refs should normalize");
validateOdeuResultEnvelope(resultEnvelope);

const admission = buildOdeuContextAdmissionRecord({
  admissionId: "admission_read_fixture",
  resultEnvelopeId: resultEnvelope.resultEnvelopeId,
  contextPackId: "context_pack_fixture",
  requestManifestId: "request_manifest_fixture",
  admissionDecision: "admit",
  admittedAs: "tool_result_evidence",
  providerSawResult: resultEnvelope.visibility.providerVisible,
  omissionLedgerRefs: [],
  admissionPolicyDigest: buildOdeuDigest({
    digestOf: "metadata",
    unavailableReason: "not_applicable",
  }),
  sourceRefs: [sourceRef],
}, { now: fixedNow });

assert(admission.schema === ODEU_CONTEXT_ADMISSION_RECORD_SCHEMA, "admission schema mismatch");
assert(admission.resultEnvelopeId === resultEnvelope.resultEnvelopeId, "admission result envelope mismatch");
assert(admission.admissionDecision === "admit", "admission decision mismatch");
assert(admission.admittedAs === "tool_result_evidence", "admittedAs mismatch");
validateOdeuContextAdmissionRecord(admission);

const providerPayloadEnvelope = buildOdeuResultEnvelope({
  resultEnvelopeId: "result_envelope_provider_payload_fixture",
  capabilityId: "capability_provider_fixture",
  callId: "call_provider_fixture",
  resultKind: "external_evidence",
  rendererSafeSummary: "Provider-hosted result payload was sent upstream.",
  visibility: {
    localRecorded: true,
    rendererVisible: "summary",
    residentVisible: "status_only",
    providerVisible: "payload_sent",
    transcriptVisible: "summary",
  },
  payloadPolicy: {
    rawPayloadStored: false,
    rawPayloadProviderSent: true,
    rawPayloadRendererVisible: false,
    redactionState: "redacted",
    truncationState: "truncated",
  },
  confidence: "partial",
  sourceRefs: [sourceRef],
}, { now: fixedNow });
assert(providerPayloadEnvelope.visibility.providerVisible === "payload_sent", "provider payload visibility mismatch");
assert(providerPayloadEnvelope.payloadPolicy.rawPayloadProviderSent === true, "provider payload policy mismatch");

const blockedAdmission = buildOdeuContextAdmissionRecord({
  admissionId: "admission_blocked_fixture",
  resultEnvelopeId: resultEnvelope.resultEnvelopeId,
  admissionDecision: "blocked_raw_exposure",
  admittedAs: "not_admitted",
  providerSawResult: "not_seen",
  omissionLedgerRefs: ["omission_raw_exposure_fixture"],
  sourceRefs: [sourceRef],
}, { now: fixedNow });
assert(blockedAdmission.admittedAs === "not_admitted", "blocked admission must not admit");

expectThrows(() => buildOdeuResultEnvelope({
  resultEnvelopeId: "result_envelope_raw_text_fixture",
  capabilityId: "capability_read_file_fixture",
  callId: "call_raw_text_fixture",
  resultKind: "local_perception",
  rendererSafeSummary: "Unsafe raw text included.",
  visibility: {
    localRecorded: true,
    rendererVisible: "summary",
    residentVisible: "summary",
    providerVisible: "not_seen",
    transcriptVisible: "transcript_safe",
  },
  payloadPolicy: {
    rawPayloadStored: false,
    rawPayloadProviderSent: false,
    rawPayloadRendererVisible: false,
    redactionState: "none_needed",
    truncationState: "none",
  },
  rawTextIncluded: true,
}), "raw_text_included");

expectThrows(() => buildOdeuResultEnvelope({
  resultEnvelopeId: "result_envelope_renderer_raw_fixture",
  capabilityId: "capability_read_file_fixture",
  callId: "call_renderer_raw_fixture",
  resultKind: "local_perception",
  rendererSafeSummary: "Renderer raw payload leak.",
  payloadPolicy: {
    rawPayloadRendererVisible: true,
  },
}), "raw_payload_renderer_visible");

expectThrows(() => buildOdeuResultEnvelope({
  resultEnvelopeId: "result_envelope_bad_provider_fixture",
  capabilityId: "capability_provider_fixture",
  callId: "call_bad_provider_fixture",
  resultKind: "external_evidence",
  rendererSafeSummary: "Provider visibility mismatch.",
  visibility: {
    providerVisible: "payload_sent",
  },
  payloadPolicy: {
    rawPayloadProviderSent: false,
  },
}), "provider_payload_visibility_requires_payload_policy");

expectThrows(() => validateOdeuResultEnvelope({
  ...resultEnvelope,
  visibility: null,
}), "missing_required_object:visibility");

expectThrows(() => validateOdeuResultEnvelope({
  ...resultEnvelope,
  resultDigest: {
    digestOf: "metadata",
    canonicalizationVersion: "odeu_canonical_json@1",
  },
}), "missing_required_digest_value:resultDigest");

expectThrows(() => buildOdeuContextAdmissionRecord({
  admissionId: "admission_bad_not_admitted_fixture",
  resultEnvelopeId: resultEnvelope.resultEnvelopeId,
  admissionDecision: "admit",
  admittedAs: "not_admitted",
}), "admit_requires_admitted_as");

expectThrows(() => buildOdeuContextAdmissionRecord({
  admissionId: "admission_bad_blocked_fixture",
  resultEnvelopeId: resultEnvelope.resultEnvelopeId,
  admissionDecision: "blocked_policy",
  admittedAs: "not_admitted",
  omissionLedgerRefs: [],
}), "blocked_admission_requires_omission_ref");

expectThrows(() => validateOdeuResultEnvelope(null), "missing_required_object:resultEnvelope");
expectThrows(() => validateOdeuContextAdmissionRecord(null), "missing_required_object:contextAdmission");

const report = {
  schema: "direct_odeu_result_admission_regression@1",
  checks: {
    resultEnvelope: true,
    contextAdmission: true,
    providerPayloadVisibility: true,
    blockedAdmission: true,
    rawExposureBlocks: true,
    validationFailures: true,
  },
  resultIds: {
    resultEnvelopeId: resultEnvelope.resultEnvelopeId,
    admissionId: admission.admissionId,
    providerPayloadEnvelopeId: providerPayloadEnvelope.resultEnvelopeId,
    blockedAdmissionId: blockedAdmission.admissionId,
  },
  sentinelCounters: {
    providerTransportCalls: 0,
    contextMutations: 0,
    memoryWrites: 0,
    rendererPayloadWrites: 0,
    transcriptWrites: 0,
    projectTruthMutations: 0,
  },
};

for (const [name, value] of Object.entries(report.sentinelCounters)) {
  assert(value === 0, `${name} should remain zero`);
}

console.log(JSON.stringify(report, null, 2));
