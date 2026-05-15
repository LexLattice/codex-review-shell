"use strict";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function defaultUsageLedgerConfig() {
  return {
    enabled: true,
    mode: "metadata_only",
    outputDir: ".codex/usage-ledgers",
    strict: false,
    includePayloadRefs: false,
    includePromptText: false,
    includeToolOutputText: false,
    includeRequestPayloadHashes: false,
    includeResponsePayloadHashes: false,
    payloadHashMode: "none",
    rawPathPolicy: "excluded",
  };
}

function normalizeUsageLedgerConfig(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  const defaults = defaultUsageLedgerConfig();
  const envEnabled = /^(1|true|yes)$/i.test(String(process.env.CODEX_USAGE_LEDGER_ENABLED || "").trim());
  const rawPathPolicy = cleanString(raw.rawPathPolicy || raw.raw_path_policy, defaults.rawPathPolicy);
  const payloadHashMode = cleanString(raw.payloadHashMode || raw.payload_hash_mode, defaults.payloadHashMode);
  return {
    enabled: raw.enabled !== false || envEnabled,
    mode: cleanString(raw.mode, defaults.mode),
    outputDir: cleanString(raw.outputDir || raw.output_dir, defaults.outputDir),
    strict: raw.strict === true,
    includePayloadRefs: raw.includePayloadRefs === true || raw.include_payload_refs === true,
    includePromptText: raw.includePromptText === true || raw.include_prompt_text === true,
    includeToolOutputText: raw.includeToolOutputText === true || raw.include_tool_output_text === true,
    includeRequestPayloadHashes: raw.includeRequestPayloadHashes === true || raw.include_request_payload_hashes === true,
    includeResponsePayloadHashes: raw.includeResponsePayloadHashes === true || raw.include_response_payload_hashes === true,
    payloadHashMode: ["none", "sha256", "hmac_sha256"].includes(payloadHashMode) ? payloadHashMode : defaults.payloadHashMode,
    rawPathPolicy: ["excluded", "private_diagnostic_only", "included_explicit"].includes(rawPathPolicy) ? rawPathPolicy : defaults.rawPathPolicy,
  };
}

module.exports = {
  defaultUsageLedgerConfig,
  normalizeUsageLedgerConfig,
};
