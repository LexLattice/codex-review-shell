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

const MANUAL_EXPOSURE_FLAG_BLOCKERS = Object.freeze({
  rawPromptIncluded: "raw_prompt_included",
  rawAssistantOutputIncluded: "raw_assistant_output_included",
  rawProviderPayloadIncluded: "raw_provider_payload_included",
  rawAuthIncluded: "raw_auth_included",
  rawAccountIdentifierIncluded: "raw_account_identifier_included",
  rawPathIncluded: "raw_path_included",
  rawUrlIncluded: "raw_url_included",
  rawToolOutputIncluded: "raw_tool_output_included",
  rawWorkspaceContentIncluded: "raw_workspace_content_included",
  rawExternalResourceIncluded: "raw_external_resource_included",
  rawImagePayloadIncluded: "raw_image_payload_included",
  rawSecretLikeIncluded: "raw_secret_like_included",
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
  for (const flag of Object.keys(MANUAL_EXPOSURE_FLAG_BLOCKERS)) {
    if (options[flag] === true) flags[flag] = true;
  }
  const manualBlockers = Object.entries(MANUAL_EXPOSURE_FLAG_BLOCKERS)
    .filter(([flag]) => options[flag] === true)
    .map(([, blocker]) => blocker);
  const blockers = Array.from(new Set([
    ...findings.map((finding) => finding.findingKind),
    ...manualBlockers,
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
