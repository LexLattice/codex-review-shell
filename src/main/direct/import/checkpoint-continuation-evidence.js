"use strict";

const crypto = require("node:crypto");
const {
  DIRECT_IMPORT_CHECKPOINT_REQUEST_BUILDER_VERSION,
  DIRECT_IMPORT_CHECKPOINT_SEED_BUILDER_VERSION,
  checkpointContinuationRequestShapeHash,
} = require("./checkpoint-continuation");
const { stableStringify } = require("./codex-jsonl-import");

const DEFAULT_CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const RUG008_CHECKPOINT_CONTINUATION_EVIDENCE_ID = "rug008_import_checkpoint_continuation_live_20260518";
const RUG008_PROMOTED_SCOPE = Object.freeze({
  authMode: "chatgpt",
  accountEvidenceHash: "e4e8be5ca5c67ae3c67ad2a3537da5e4c76673f29347a8a0ae5b0cc9a22d96c2",
  endpointClass: "chatgpt-codex-responses",
  endpointHash: "1897faf097db8edfa5c0c6765abb12be180ed7aff633203298e6c0c28fcb16e5",
  model: "gpt-5.4",
  profileId: "chatgpt_codex_subscription_oai_server_baseline_2026_04_25",
  profileScopeHash: "c9954fca4624a46538ed5bb0512d064eea6efe95a0e0324a1c41c32ac4d5d901",
  requestBuilderVersion: "direct-import-checkpoint-request-builder@1",
  requestShapeHash: "b5ca37664b0622ae6e9207aa810363f8f24e05a71e893f88c2dc28d33c55db9b",
  seedBuilderVersion: "direct-import-checkpoint-seed-builder@1",
});

const SCOPE_FIELDS = Object.freeze([
  "authMode",
  "accountEvidenceHash",
  "endpointClass",
  "endpointHash",
  "model",
  "profileId",
  "profileScopeHash",
  "requestBuilderVersion",
  "requestShapeHash",
  "seedBuilderVersion",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function profileScope(profileDoc = {}) {
  const summary = isPlainObject(profileDoc.summary) ? profileDoc.summary : {};
  const profile = isPlainObject(profileDoc.profile) ? profileDoc.profile : {};
  return {
    schema: normalizeString(summary.schema || profile.schema, ""),
    profileId: normalizeString(summary.profileId || profile.profileId || profile.id, ""),
    backendContractVersion: normalizeString(summary.backendContractVersion || profile.backendContractVersion, ""),
  };
}

function endpointClass(endpoint = "") {
  const value = normalizeString(endpoint, DEFAULT_CODEX_RESPONSES_ENDPOINT);
  return value.includes("/backend-api/codex/responses") ? "chatgpt-codex-responses" : "custom";
}

function buildCheckpointContinuationEvidenceScope(input = {}) {
  const credentials = isPlainObject(input.credentials) ? input.credentials : {};
  const endpoint = normalizeString(input.endpoint, DEFAULT_CODEX_RESPONSES_ENDPOINT);
  const profile = profileScope(input.profileDoc);
  const accountEvidenceId = normalizeString(
    input.accountEvidenceId || credentials.accountId || credentials.chatgptAccountId,
    "",
  );
  return {
    authMode: normalizeString(credentials.authMode, "unknown"),
    accountEvidenceHash: accountEvidenceId ? sha256(accountEvidenceId) : "",
    endpointClass: endpointClass(endpoint),
    endpointHash: sha256(endpoint),
    model: normalizeString(input.model, ""),
    profileId: profile.profileId,
    profileScopeHash: sha256(stableStringify(profile)),
    requestBuilderVersion: normalizeString(
      input.requestBuilderVersion,
      DIRECT_IMPORT_CHECKPOINT_REQUEST_BUILDER_VERSION,
    ),
    requestShapeHash: checkpointContinuationRequestShapeHash({
      requestBuilderVersion: input.requestBuilderVersion,
    }),
    seedBuilderVersion: normalizeString(
      input.seedBuilderVersion,
      DIRECT_IMPORT_CHECKPOINT_SEED_BUILDER_VERSION,
    ),
  };
}

function resolvePromotedCheckpointContinuationEvidence(scope = {}, witness = RUG008_PROMOTED_SCOPE) {
  const mismatchedFields = SCOPE_FIELDS.filter((field) =>
    !normalizeString(scope[field], "") || normalizeString(scope[field], "") !== normalizeString(witness[field], "")
  );
  const accepted = mismatchedFields.length === 0;
  return {
    accepted,
    status: accepted ? "real_provider_promoted" : "scope_mismatch",
    evidenceState: accepted ? "runtime_probed" : "unknown",
    evidenceId: RUG008_CHECKPOINT_CONTINUATION_EVIDENCE_ID,
    reason: accepted ? "" : "checkpoint_promotion_scope_mismatch",
    mismatchedFields,
    scopeDigest: sha256(stableStringify(scope)),
    witnessDigest: sha256(stableStringify(witness)),
    rawAccountIdentityExposed: false,
    rawEndpointExposed: false,
  };
}

module.exports = {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  RUG008_CHECKPOINT_CONTINUATION_EVIDENCE_ID,
  RUG008_PROMOTED_SCOPE,
  buildCheckpointContinuationEvidenceScope,
  resolvePromotedCheckpointContinuationEvidence,
};
