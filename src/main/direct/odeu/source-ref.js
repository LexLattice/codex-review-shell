"use strict";

const { normalizeId, normalizeString, nowIso } = require("../meta-session/ids");
const { buildOdeuDigest, digestCanonicalJson } = require("./digest");
const {
  ODEU_FRESHNESS_VALUES,
  ODEU_SOURCE_CONFIDENCE_VALUES,
  ODEU_SOURCE_KINDS,
  pickEnum,
} = require("./status");
const {
  ODEU_EVIDENCE_REF_SCHEMA,
  ODEU_SOURCE_REF_SCHEMA,
} = require("./schema");

function normalizeOdeuSourceRef(input = {}, options = {}) {
  const sourceKind = pickEnum(input.sourceKind, ODEU_SOURCE_KINDS, "family_specific");
  const sourceRef = {
    schema: ODEU_SOURCE_REF_SCHEMA,
    sourceRefId: normalizeId(input.sourceRefId, "odeu_source_ref"),
    sourceKind,
    sourceConfidence: pickEnum(input.sourceConfidence, ODEU_SOURCE_CONFIDENCE_VALUES, "unknown"),
    freshness: pickEnum(input.freshness, ODEU_FRESHNESS_VALUES, "unknown"),
    observedAt: normalizeString(input.observedAt, nowIso(options.now || Date.now)),
  };
  for (const field of [
    "sourceId",
    "sourcePathEvidenceKey",
    "rowId",
    "itemId",
    "callId",
  ]) {
    const value = normalizeString(input[field], "");
    if (value) sourceRef[field] = value;
  }
  sourceRef.sourceDigest = input.sourceDigest && typeof input.sourceDigest === "object"
    ? buildOdeuDigest(input.sourceDigest)
    : digestCanonicalJson({
      sourceKind,
      sourceId: sourceRef.sourceId || "",
      sourcePathEvidenceKey: sourceRef.sourcePathEvidenceKey || "",
      rowId: sourceRef.rowId || "",
      itemId: sourceRef.itemId || "",
      callId: sourceRef.callId || "",
    }, { domain: "odeu-source-ref@1", digestOf: "metadata" });
  return sourceRef;
}

function normalizeOdeuSourceRefs(value, options = {}) {
  return Array.isArray(value) ? value.map((entry) => normalizeOdeuSourceRef(entry, options)) : [];
}

function buildOdeuEvidenceRef(input = {}, options = {}) {
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  return {
    schema: ODEU_EVIDENCE_REF_SCHEMA,
    evidenceId: normalizeId(input.evidenceId, "odeu_evidence"),
    evidenceKind: normalizeString(input.evidenceKind, "unknown"),
    artifactRef: normalizeString(input.artifactRef, ""),
    sourceRefs,
    sourceConfidence: pickEnum(input.sourceConfidence, ODEU_SOURCE_CONFIDENCE_VALUES, sourceRefs[0]?.sourceConfidence || "unknown"),
    freshness: pickEnum(input.freshness, ODEU_FRESHNESS_VALUES, sourceRefs[0]?.freshness || "unknown"),
  };
}

module.exports = {
  buildOdeuEvidenceRef,
  normalizeOdeuSourceRef,
  normalizeOdeuSourceRefs,
};
