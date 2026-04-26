"use strict";

const os = require("node:os");

const PLACEHOLDERS = Object.freeze({
  accountId: "[REDACTED:account-id]",
  authorizationCode: "[REDACTED:authorization-code]",
  bearerToken: "[REDACTED:bearer-token]",
  cookie: "[REDACTED:cookie]",
  jwt: "[REDACTED:jwt]",
  openAiKey: "[REDACTED:openai-key]",
  privatePath: "[REDACTED:private-path]",
  token: "[REDACTED:token]",
});

const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?code|authorization[_-]?code|code[_-]?verifier|code[_-]?challenge|client[_-]?secret|cookie|set[_-]?cookie|authorization|account[_-]?id|chatgpt[_-]?account[_-]?id)([_-]|$)/i;
const REDACTED_PLACEHOLDER_PATTERN = /\[REDACTED:[^\]]+\]/;

const TEXT_REDACTIONS = [
  {
    label: "bearer-token",
    placeholder: `Bearer ${PLACEHOLDERS.bearerToken}`,
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    label: "openai-key",
    placeholder: PLACEHOLDERS.openAiKey,
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    label: "jwt",
    placeholder: PLACEHOLDERS.jwt,
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    label: "cookie",
    placeholder: `$1${PLACEHOLDERS.cookie}`,
    pattern: /\b(cookie|set-cookie)\s*:\s*[^;\n\r]+(?:;[^\n\r]*)?/gi,
  },
  {
    label: "account-id",
    placeholder: `$1${PLACEHOLDERS.accountId}`,
    pattern: /\b(account[_-]?id|chatgpt-account-id|openai-account-id)(["'\s:=]+)([A-Za-z0-9._:-]{6,})/gi,
  },
  {
    label: "authorization-code",
    placeholder: `$1${PLACEHOLDERS.authorizationCode}`,
    pattern: /\b(code|authorization_code)(["'\s:=]+)([A-Za-z0-9._~/-]{16,})/gi,
  },
];

function uniquePrivatePathRoots(extraRoots = []) {
  const roots = [
    os.homedir(),
    process.env.HOME,
    process.env.USERPROFILE,
    ...extraRoots,
  ];
  return [...new Set(roots.filter((root) => typeof root === "string" && root.length > 4))];
}

function redactionForKey(key) {
  if (!SENSITIVE_KEY_PATTERN.test(String(key || ""))) return "";
  if (/account/i.test(key)) return PLACEHOLDERS.accountId;
  if (/code/i.test(key)) return PLACEHOLDERS.authorizationCode;
  if (/cookie/i.test(key)) return PLACEHOLDERS.cookie;
  if (/authorization/i.test(key)) return PLACEHOLDERS.bearerToken;
  return PLACEHOLDERS.token;
}

function redactText(text, options = {}) {
  let output = String(text);
  for (const redaction of TEXT_REDACTIONS) {
    output = output.replace(redaction.pattern, redaction.placeholder);
  }

  if (options.redactPaths !== false) {
    for (const root of uniquePrivatePathRoots(options.privatePathRoots)) {
      output = output.split(root).join(PLACEHOLDERS.privatePath);
    }
  }
  return output;
}

function redactFixture(value, options = {}, keyPath = []) {
  const key = keyPath[keyPath.length - 1] || "";
  const keyRedaction = redactionForKey(key);

  if (keyRedaction && value !== null && value !== undefined) return keyRedaction;
  if (typeof value === "string") return redactText(value, options);
  if (Array.isArray(value)) {
    return value.map((item, index) => redactFixture(item, options, [...keyPath, String(index)]));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactFixture(entryValue, options, [...keyPath, entryKey]);
    }
    return output;
  }
  return value;
}

function scanSensitiveText(text, options = {}) {
  const findings = [];
  const source = String(text || "");
  for (const redaction of TEXT_REDACTIONS) {
    redaction.pattern.lastIndex = 0;
    if (redaction.pattern.test(source)) findings.push(redaction.label);
  }
  if (options.redactPaths !== false) {
    for (const root of uniquePrivatePathRoots(options.privatePathRoots)) {
      if (source.includes(root)) findings.push("private-path");
    }
  }
  return [...new Set(findings)];
}

function isRedactedSensitiveValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim() || REDACTED_PLACEHOLDER_PATTERN.test(value);
  if (Array.isArray(value)) return value.every(isRedactedSensitiveValue);
  if (value && typeof value === "object") return Object.values(value).every(isRedactedSensitiveValue);
  return false;
}

function scanFixtureForSecrets(value, options = {}, keyPath = []) {
  const findings = [];
  const key = keyPath[keyPath.length - 1] || "";
  const keyRedaction = redactionForKey(key);
  if (keyRedaction && !isRedactedSensitiveValue(value)) {
    findings.push(`sensitive-key:${keyPath.join(".") || key}`);
  }

  if (typeof value === "string") {
    findings.push(...scanSensitiveText(value, options));
  } else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      findings.push(...scanFixtureForSecrets(value[index], options, [...keyPath, String(index)]));
    }
  } else if (value && typeof value === "object") {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      findings.push(...scanFixtureForSecrets(entryValue, options, [...keyPath, entryKey]));
    }
  }

  return [...new Set(findings)];
}

function assertFixtureRedacted(value, options = {}) {
  const findings = scanFixtureForSecrets(value, options);
  if (findings.length) {
    throw new Error(`Fixture still contains sensitive material: ${findings.join(", ")}`);
  }
  return true;
}

module.exports = {
  PLACEHOLDERS,
  REDACTED_PLACEHOLDER_PATTERN,
  SENSITIVE_KEY_PATTERN,
  assertFixtureRedacted,
  redactFixture,
  redactText,
  scanFixtureForSecrets,
  scanSensitiveText,
};
