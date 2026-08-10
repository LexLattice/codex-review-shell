"use strict";

const {
  artifactDigest: metaArtifactDigest,
  canonicalJson,
  genericDigest,
  sha256,
  stableClone,
} = require("../meta-session/digest");
const { normalizeString } = require("../meta-session/ids");

const ODEU_DIGEST_OF_VALUES = Object.freeze([
  "canonical_json",
  "content",
  "metadata",
  "redacted_payload",
]);

const ODEU_DIGEST_ABSENCE_REASONS = Object.freeze([
  "not_computed",
  "sensitive_withheld",
  "source_unavailable",
  "legacy_missing",
  "not_applicable",
]);

function normalizeDigestOf(value) {
  return ODEU_DIGEST_OF_VALUES.includes(value) ? value : "canonical_json";
}

function buildOdeuDigest(input = {}) {
  const digestOf = normalizeDigestOf(input.digestOf);
  const algorithm = input.algorithm === "hmac_sha256" ? "hmac_sha256"
    : input.algorithm === "sha256" ? "sha256"
      : "";
  const value = normalizeString(input.value, "");
  const unavailableReason = ODEU_DIGEST_ABSENCE_REASONS.includes(input.unavailableReason)
    ? input.unavailableReason
    : "";
  const digest = {
    digestOf,
    canonicalizationVersion: normalizeString(input.canonicalizationVersion, "odeu_canonical_json@1"),
  };
  if (algorithm && value) {
    digest.algorithm = algorithm;
    digest.value = value;
  } else {
    digest.unavailableReason = unavailableReason || "not_computed";
  }
  return digest;
}

function digestCanonicalJson(value, options = {}) {
  return buildOdeuDigest({
    algorithm: "sha256",
    value: sha256(`${normalizeString(options.domain, "odeu-canonical-json@1")}\0${canonicalJson(value)}`),
    digestOf: options.digestOf || "canonical_json",
    canonicalizationVersion: options.canonicalizationVersion || "odeu_canonical_json@1",
  });
}

function artifactDigest({ schema, artifactKind, value }) {
  return buildOdeuDigest({
    algorithm: "sha256",
    value: metaArtifactDigest({
      schemaVersion: schema,
      artifactKind,
      value,
    }),
    digestOf: "canonical_json",
  });
}

module.exports = {
  ODEU_DIGEST_ABSENCE_REASONS,
  ODEU_DIGEST_OF_VALUES,
  artifactDigest,
  buildOdeuDigest,
  canonicalJson,
  digestCanonicalJson,
  genericDigest,
  sha256,
  stableClone,
};
