"use strict";

const { isPlainObject } = require("./ids");

const SAFE_PLACEHOLDER_PATTERN = /^\[(?:REDACTED:[A-Za-z0-9_-]+|source-ref:[A-Za-z0-9_-]+|artifact-ref:[A-Za-z0-9_-]+)\]$/;
const HOST_PATH_PATTERN = /(?:^|[\s"'(])(?:\/home\/|\/Users\/|\/mnt\/[a-z]\/|[A-Za-z]:\\|\\\\wsl(?:\.localhost)?\\|\\\\wsl\$\\)/;
const CHATGPT_URL_PATTERN = /https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;
const TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|ghp_[A-Za-z0-9_]{20,})\b/;
const SECRET_LIKE_KEY_PATTERN = /(?:token|secret|cookie|authorization|api[_-]?key|private[_-]?key)/i;
const RAW_PROVIDER_KEY_PATTERN = /(?:raw.*(?:provider|request|response|frame)|provider.*payload|requestBody|responseBody)/i;
const RAW_TEXT_KEY_PATTERN = /(?:raw.*text|compiledPrompt|transcriptText|toolOutput)/i;

function pointerFor(pathParts = []) {
  if (!pathParts.length) return "";
  return `/${pathParts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function finding(findingKind, pathParts, evidenceClass, rendererSafeSummary) {
  return {
    findingKind,
    jsonPointer: pointerFor(pathParts),
    evidenceClass,
    rendererSafeSummary,
  };
}

function scanMetaSessionRawExposure(value) {
  const findings = [];
  const visit = (entry, pathParts = []) => {
    const key = String(pathParts[pathParts.length - 1] || "");
    if (typeof entry === "string") {
      if (SAFE_PLACEHOLDER_PATTERN.test(entry)) return;
      if (HOST_PATH_PATTERN.test(entry)) {
        findings.push(finding(entry.includes("\\\\wsl") || entry.includes("/mnt/") ? "wsl_path" : "host_path", pathParts, "value_pattern", "Raw host path-like value is not renderer safe."));
      }
      if (CHATGPT_URL_PATTERN.test(entry)) findings.push(finding("chatgpt_url", pathParts, "value_pattern", "Raw ChatGPT URL is not renderer safe."));
      if (TOKEN_PATTERN.test(entry)) findings.push(finding("token", pathParts, "value_pattern", "Token-like value is not renderer safe."));
      if (SECRET_LIKE_KEY_PATTERN.test(key) && entry.length > 8) findings.push(finding("secret_like", pathParts, "key_name", "Secret-like keyed value is not renderer safe."));
      if (RAW_PROVIDER_KEY_PATTERN.test(key) && entry) findings.push(finding("provider_payload", pathParts, "key_name", "Raw provider payload field is not renderer safe."));
      if (RAW_TEXT_KEY_PATTERN.test(key) && entry) findings.push(finding("compiled_prompt", pathParts, "key_name", "Raw text field is not renderer safe."));
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    if (isPlainObject(entry)) {
      for (const [childKey, item] of Object.entries(entry)) {
        if (/^raw.*Included$/.test(childKey) && item === true) {
          const kind = childKey.toLowerCase().includes("provider") ? "provider_payload"
            : childKey.toLowerCase().includes("transcript") ? "transcript_text"
              : childKey.toLowerCase().includes("tool") ? "tool_output"
                : childKey.toLowerCase().includes("path") ? "host_path"
                  : "secret_like";
          findings.push(finding(kind, [...pathParts, childKey], "schema_flag", "Raw exposure schema flag is true."));
        }
        visit(item, [...pathParts, childKey]);
      }
    }
  };
  visit(value);
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.findingKind}:${item.jsonPointer}:${item.evidenceClass}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertMetaSessionRendererSafe(value) {
  const findings = scanMetaSessionRawExposure(value);
  if (!findings.length) return true;
  const error = new Error(`raw_exposure_blocked:${findings.map((item) => item.findingKind).join(",")}`);
  error.code = "raw_exposure_blocked";
  error.findings = findings;
  throw error;
}

module.exports = {
  assertMetaSessionRendererSafe,
  scanMetaSessionRawExposure,
};
