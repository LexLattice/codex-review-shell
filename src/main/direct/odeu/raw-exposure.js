"use strict";

const { scanMetaSessionRawExposure } = require("../meta-session/raw-exposure");
const { normalizeString, nowIso } = require("../meta-session/ids");
const { ODEU_RAW_EXPOSURE_SCAN_SCHEMA, validateOdeuRawExposureScan } = require("./schema");
const { ODEU_SCAN_SCOPES, pickEnum } = require("./status");

const FINDING_TO_FLAG = Object.freeze({
  compiled_prompt: "rawPromptIncluded",
  transcript_text: "rawAssistantOutputIncluded",
  provider_payload: "rawProviderPayloadIncluded",
  token: "rawAuthIncluded",
  secret_like: "rawSecretLikeIncluded",
  host_path: "rawPathIncluded",
  wsl_path: "rawPathIncluded",
  chatgpt_url: "rawUrlIncluded",
  tool_output: "rawToolOutputIncluded",
});

function emptyFlags() {
  return {
    rawPromptIncluded: false,
    rawAssistantOutputIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthIncluded: false,
    rawAccountIdentifierIncluded: false,
    rawPathIncluded: false,
    rawUrlIncluded: false,
    rawToolOutputIncluded: false,
    rawWorkspaceContentIncluded: false,
    rawExternalResourceIncluded: false,
    rawImagePayloadIncluded: false,
    rawSecretLikeIncluded: false,
  };
}

function buildOdeuRawExposureScan(value, options = {}) {
  const findings = scanMetaSessionRawExposure(value);
  const flags = emptyFlags();
  for (const finding of findings) {
    const flag = FINDING_TO_FLAG[finding.findingKind];
    if (flag) flags[flag] = true;
  }
  if (options.rawAccountIdentifierIncluded === true) flags.rawAccountIdentifierIncluded = true;
  if (options.rawWorkspaceContentIncluded === true) flags.rawWorkspaceContentIncluded = true;
  if (options.rawExternalResourceIncluded === true) flags.rawExternalResourceIncluded = true;
  if (options.rawImagePayloadIncluded === true) flags.rawImagePayloadIncluded = true;
  const blockers = Array.from(new Set([
    ...findings.map((finding) => finding.findingKind),
    ...(Array.isArray(options.blockers) ? options.blockers : []),
  ])).sort();
  const warnings = Array.from(new Set(Array.isArray(options.warnings) ? options.warnings : [])).sort();
  const scan = {
    schema: ODEU_RAW_EXPOSURE_SCAN_SCHEMA,
    passed: blockers.length === 0,
    scannerVersion: normalizeString(options.scannerVersion, "odeu_raw_exposure_scan@1"),
    scannedAt: normalizeString(options.scannedAt, nowIso(options.now || Date.now)),
    scanScope: pickEnum(options.scanScope, ODEU_SCAN_SCOPES, "artifact"),
    ...flags,
    blockers,
    warnings,
  };
  validateOdeuRawExposureScan(scan);
  return scan;
}

function assertOdeuRawExposureSafe(value, options = {}) {
  const scan = buildOdeuRawExposureScan(value, options);
  if (scan.passed) return scan;
  const error = new Error(`odeu_raw_exposure_blocked:${scan.blockers.join(",")}`);
  error.code = "odeu_raw_exposure_blocked";
  error.scan = scan;
  throw error;
}

module.exports = {
  assertOdeuRawExposureSafe,
  buildOdeuRawExposureScan,
};
