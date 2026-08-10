"use strict";

const crypto = require("node:crypto");

const {
  EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA,
} = require("./external-discovery-tools");
const {
  MCP_RESOURCE_READ_ENVELOPE_SCHEMA,
} = require("./mcp-resource-read-envelope");

const EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA = "external_result_context_admission_policy@1";
const EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA = "external_result_context_admission@1";

const RESULT_KINDS = new Set([
  "external_discovery",
  "mcp_resource_read",
  "dynamic_mcp_action_blocked",
  "plugin_install_blocked",
]);
const ADMISSION_STATES = new Set(["summary_admitted", "excerpt_admitted", "ref_only", "blocked"]);
const RESIDENT_VISIBILITIES = new Set(["none", "summary", "bounded_excerpt", "ref_only"]);
const OPERATOR_VISIBILITIES = new Set(["summary", "bounded_excerpt", "ref_only", "blocked"]);
const PROVIDER_VISIBILITIES = new Set(["not_sent", "summary_only", "bounded_excerpt", "ref_only"]);
const TRUNCATION_STATES = new Set(["none", "truncated", "omitted"]);
const REDACTION_STATES = new Set(["passed", "redacted", "blocked", "not_scanned"]);

const DEFAULT_SUMMARY_TOKEN_BUDGET = 512;
const DEFAULT_EXCERPT_BYTE_LIMIT = 2048;
const RAW_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /[?&](?:token|api[_-]?key|password|secret)=/i,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
];

const FALSE_ADMISSION_FLAGS = [
  "projectTruthGranted",
  "workspaceEvidenceGranted",
  "authorityGranted",
  "durableMemoryAdmissionStarted",
  "workspaceMutationStarted",
  "providerRawPayloadSent",
  "rawExternalPayloadIncluded",
  "rawResourceUriIncluded",
  "rawSecretIncluded",
];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength <= 3) return ".".repeat(maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function byteLengthFor(value = "") {
  return Buffer.byteLength(String(value), "utf8");
}

function utf8ByteTruncate(text = "", maxBytes = DEFAULT_EXCERPT_BYTE_LIMIT) {
  const source = String(text || "");
  const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (!limit) return "";
  const buffer = Buffer.from(source, "utf8");
  if (buffer.length <= limit) return source;
  let slice = buffer.subarray(0, limit);
  let boundary = slice.length - 1;
  while (boundary >= 0 && (slice[boundary] & 0xc0) === 0x80) boundary -= 1;
  if (boundary >= 0 && (slice[boundary] & 0xc0) === 0xc0) {
    const lead = slice[boundary];
    let expectedLength = 1;
    if ((lead & 0xe0) === 0xc0) expectedLength = 2;
    else if ((lead & 0xf0) === 0xe0) expectedLength = 3;
    else if ((lead & 0xf8) === 0xf0) expectedLength = 4;
    if (slice.length - boundary < expectedLength) slice = slice.subarray(0, boundary);
  }
  return slice.toString("utf8");
}

function normalizeEvidenceRef(input = {}, fallbackKind = "external_context_admission") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("external-context-admission-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "external_context_admission") {
  return arrayOrEmpty(values).filter(isPlainObject).map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function assertFalseFlags(target = {}, flags = [], label = "external_context_admission") {
  for (const flag of flags) {
    if (target[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
}

function containsRawSecretText(value = "") {
  const text = String(value || "");
  return RAW_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function inferResultKind(envelope = {}) {
  if (envelope.schema === EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA) return "external_discovery";
  if (envelope.schema === MCP_RESOURCE_READ_ENVELOPE_SCHEMA) return "mcp_resource_read";
  return "dynamic_mcp_action_blocked";
}

function sourceEnvelopeId(envelope = {}) {
  return boundedString(envelope.envelopeId || envelope.resultEnvelopeId || envelope.statusId, 180);
}

function trustLevelFor(envelope = {}, resultKind = "") {
  if (resultKind === "external_discovery") return "descriptor_only";
  return boundedString(envelope.resultTrustLevel || "unknown", 120);
}

function freshnessFor(envelope = {}, resultKind = "") {
  if (resultKind === "external_discovery") return envelope.status === "completed" || envelope.status === "degraded" ? "fresh_descriptor" : "unavailable";
  return boundedString(envelope.readFreshness || "unknown", 120);
}

function warningFor(envelope = {}, resultKind = "") {
  const trust = trustLevelFor(envelope, resultKind);
  if (resultKind === "mcp_resource_read") {
    const display = boundedString(envelope.resourceDisplay || "external MCP resource", 180);
    return `External MCP resource from ${display}; trust=${trust}; not project truth.`;
  }
  if (resultKind === "external_discovery") {
    return "External discovery descriptors are capability metadata only; not executable authority and not project truth.";
  }
  return "External action/plugin result is blocked; not authority, project truth, or memory.";
}

function summaryFor(envelope = {}, resultKind = "") {
  if (resultKind === "external_discovery") {
    return boundedString(`${envelope.toolName || "external discovery"} returned ${Number(envelope.descriptorCount || 0)} descriptors; status=${envelope.status || "unknown"}.`, 640);
  }
  if (resultKind === "mcp_resource_read") {
    return boundedString(`${envelope.resourceDisplay || "MCP resource"} read status=${envelope.status || "unknown"}; content=${envelope.contentHandling || "unknown"}; trust=${envelope.resultTrustLevel || "unknown"}.`, 640);
  }
  return boundedString(`External result blocked: ${arrayOrEmpty(envelope.blockerCodes).join(", ") || envelope.status || "blocked"}.`, 640);
}

function excerptFor(envelope = {}, policy = {}) {
  if (envelope.schema !== MCP_RESOURCE_READ_ENVELOPE_SCHEMA) return "";
  if (envelope.status !== "completed") return "";
  if (envelope.contextAdmission !== "excerpt_admitted") return "";
  const limit = Number.isFinite(Number(policy.excerptByteLimit)) ? Number(policy.excerptByteLimit) : DEFAULT_EXCERPT_BYTE_LIMIT;
  return utf8ByteTruncate(envelope.payloadExcerpt || "", Math.max(1, limit));
}

function baseAdmissionState(envelope = {}, resultKind = "") {
  if (resultKind === "external_discovery") {
    return envelope.status === "completed" || envelope.status === "degraded" ? "summary_admitted" : "blocked";
  }
  if (resultKind === "mcp_resource_read") {
    if (envelope.status === "completed" && envelope.contextAdmission === "excerpt_admitted") return "excerpt_admitted";
    if (envelope.contextAdmission === "ref_only") return "ref_only";
    return "blocked";
  }
  return "blocked";
}

function visibilityFor(admissionState = "blocked") {
  if (admissionState === "excerpt_admitted") {
    return {
      residentContext: "bounded_excerpt",
      operatorUi: "bounded_excerpt",
      providerContinuation: "bounded_excerpt",
    };
  }
  if (admissionState === "summary_admitted") {
    return {
      residentContext: "summary",
      operatorUi: "summary",
      providerContinuation: "summary_only",
    };
  }
  if (admissionState === "ref_only") {
    return {
      residentContext: "ref_only",
      operatorUi: "ref_only",
      providerContinuation: "ref_only",
    };
  }
  return {
    residentContext: "none",
    operatorUi: "blocked",
    providerContinuation: "not_sent",
  };
}

function applyProviderContinuationPolicy(visibility = {}, policy = {}) {
  const mode = normalizeEnum(policy.providerContinuationMode, PROVIDER_VISIBILITIES, "bounded_excerpt");
  if (visibility.providerContinuation === "not_sent") return visibility;
  if (mode === "not_sent") visibility.providerContinuation = "not_sent";
  else if (mode === "summary_only" && visibility.providerContinuation === "bounded_excerpt") visibility.providerContinuation = "summary_only";
  else if (mode === "ref_only" && visibility.providerContinuation !== "not_sent") visibility.providerContinuation = "ref_only";
  return visibility;
}

function providerProjectionTextFor({ visibility, admissionState, trustWarning, summary, excerpt, sourceEnvelopeId }) {
  if (visibility.providerContinuation === "not_sent" || admissionState === "blocked") return "";
  if (visibility.providerContinuation === "ref_only") {
    return utf8ByteTruncate(`${trustWarning}\nExternal result available by reference only: ${sourceEnvelopeId || "unknown"}.`, 4096);
  }
  return utf8ByteTruncate(`${trustWarning}\n${summary}${visibility.providerContinuation === "bounded_excerpt" && excerpt ? `\n\n${excerpt}` : ""}`, 4096);
}

function buildExternalResultContextAdmissionPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA,
    policyId: boundedString(source.policyId, 180),
    resultKinds: arrayOrEmpty(source.resultKinds).filter((kind) => RESULT_KINDS.has(kind)).sort(),
    summaryTokenBudget: Number.isFinite(Number(source.summaryTokenBudget)) ? Math.max(1, Number(source.summaryTokenBudget)) : DEFAULT_SUMMARY_TOKEN_BUDGET,
    excerptByteLimit: Number.isFinite(Number(source.excerptByteLimit)) ? Math.max(1, Number(source.excerptByteLimit)) : DEFAULT_EXCERPT_BYTE_LIMIT,
    allowDiscoverySummary: source.allowDiscoverySummary !== false,
    allowReadExcerpt: source.allowReadExcerpt !== false,
    allowRefOnly: source.allowRefOnly !== false,
    providerContinuationMode: normalizeEnum(source.providerContinuationMode, PROVIDER_VISIBILITIES, "bounded_excerpt"),
    rawPayloadAdmissionAllowed: false,
    rawUriAdmissionAllowed: false,
    durableMemoryAdmissionAllowed: false,
    projectTruthAllowed: false,
    workspaceEvidenceAllowed: false,
    authorityGranted: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  if (!policy.resultKinds.length) {
    policy.resultKinds = ["external_discovery", "mcp_resource_read", "dynamic_mcp_action_blocked", "plugin_install_blocked"];
  }
  policy.policyId = policy.policyId || `external_context_policy_${digestFor("external-result-context-admission-policy-id@1", {
    resultKinds: policy.resultKinds,
    summaryTokenBudget: policy.summaryTokenBudget,
    excerptByteLimit: policy.excerptByteLimit,
  }).slice(0, 24)}`;
  policy.policyDigest = digestFor("external-result-context-admission-policy@1", policy);
  validateExternalResultContextAdmissionPolicy(policy);
  return policy;
}

function validateExternalResultContextAdmissionPolicy(policy = {}) {
  const errors = [];
  if (!isPlainObject(policy) || policy.schema !== EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA) errors.push("external_context_policy_schema_mismatch");
  if (!policy.policyDigest || !policy.policyId) errors.push("external_context_policy_missing_digest");
  for (const kind of arrayOrEmpty(policy.resultKinds)) {
    if (!RESULT_KINDS.has(kind)) errors.push(`external_context_policy_bad_result_kind:${kind || ""}`);
  }
  for (const flag of ["rawPayloadAdmissionAllowed", "rawUriAdmissionAllowed", "durableMemoryAdmissionAllowed", "projectTruthAllowed", "workspaceEvidenceAllowed", "authorityGranted"]) {
    if (policy[flag] !== false) errors.push(`external_context_policy_authority_leak:${flag}`);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function buildExternalResultContextAdmission(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const envelope = isPlainObject(source.envelope || source.sourceEnvelope) ? (source.envelope || source.sourceEnvelope) : {};
  const policy = source.policy?.schema === EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA
    ? source.policy
    : buildExternalResultContextAdmissionPolicy(source.policy || source);
  validateExternalResultContextAdmissionPolicy(policy);

  const resultKind = normalizeEnum(source.resultKind || inferResultKind(envelope), RESULT_KINDS, "dynamic_mcp_action_blocked");
  const preliminaryState = baseAdmissionState(envelope, resultKind);
  let admissionState = preliminaryState;
  if (!policy.resultKinds.includes(resultKind)) admissionState = "blocked";
  if (resultKind === "external_discovery" && !policy.allowDiscoverySummary) admissionState = "blocked";
  if (resultKind === "mcp_resource_read" && admissionState === "excerpt_admitted" && !policy.allowReadExcerpt) admissionState = policy.allowRefOnly ? "ref_only" : "blocked";
  if (admissionState === "ref_only" && !policy.allowRefOnly) admissionState = "blocked";
  const visibility = applyProviderContinuationPolicy(visibilityFor(admissionState), policy);
  const excerpt = admissionState === "excerpt_admitted" ? excerptFor(envelope, policy) : "";
  const summary = admissionState === "summary_admitted" || admissionState === "excerpt_admitted" || admissionState === "ref_only"
    ? summaryFor(envelope, resultKind)
    : "";
  const trustWarning = warningFor(envelope, resultKind);
  const envelopeId = sourceEnvelopeId(envelope);
  const admission = {
    schema: EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA,
    admissionId: boundedString(source.admissionId, 180),
    policyId: policy.policyId,
    policyDigest: policy.policyDigest,
    sourceEnvelopeId: envelopeId,
    sourceEnvelopeDigest: boundedString(envelope.envelopeDigest || envelope.statusDigest || envelope.profileDigest, 180),
    resultKind,
    admissionState,
    visibility,
    admittedTokenBudget: policy.summaryTokenBudget,
    excerptByteLimit: policy.excerptByteLimit,
    truncationState: admissionState === "excerpt_admitted" ? normalizeEnum(envelope.truncationState, TRUNCATION_STATES, "none") : admissionState === "blocked" ? "omitted" : "none",
    redactionState: admissionState === "blocked" ? "blocked" : normalizeEnum(envelope.redactionState, REDACTION_STATES, resultKind === "external_discovery" ? "passed" : "not_scanned"),
    trustLevel: trustLevelFor(envelope, resultKind),
    freshness: freshnessFor(envelope, resultKind),
    trustWarning,
    residentVisibleText: admissionState === "blocked"
      ? utf8ByteTruncate(`${trustWarning} Context admission blocked.`, 1000)
      : utf8ByteTruncate(`${trustWarning}\n${summary}${excerpt ? `\n\n${excerpt}` : ""}`, 4096),
    operatorProjection: {
      summary: summary || boundedString(`${resultKind} admission blocked.`, 640),
      sourceEnvelopeId: envelopeId,
      trustLevel: trustLevelFor(envelope, resultKind),
      freshness: freshnessFor(envelope, resultKind),
      admissionState,
      rawPayloadIncluded: false,
      rawUriIncluded: false,
      rawSecretIncluded: false,
    },
    providerProjection: {
      visibility: visibility.providerContinuation,
      text: providerProjectionTextFor({ visibility, admissionState, trustWarning, summary, excerpt, sourceEnvelopeId: envelopeId }),
      rawPayloadIncluded: false,
      rawUriIncluded: false,
      rawSecretIncluded: false,
    },
    projectTruthGranted: false,
    workspaceEvidenceGranted: false,
    authorityGranted: false,
    durableMemoryAdmissionStarted: false,
    workspaceMutationStarted: false,
    providerRawPayloadSent: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "external_result_context_admission"),
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  admission.admissionId = admission.admissionId || `external_context_admission_${digestFor("external-result-context-admission-id@1", {
    sourceEnvelopeId: admission.sourceEnvelopeId,
    resultKind,
    admissionState,
    policyDigest: policy.policyDigest,
  }).slice(0, 24)}`;
  admission.admissionDigest = digestFor("external-result-context-admission@1", admission);
  validateExternalResultContextAdmission(admission);
  return admission;
}

function validateVisibility(visibility = {}, errors = []) {
  if (!isPlainObject(visibility)) {
    errors.push("external_context_admission_missing_visibility");
    return;
  }
  if (!RESIDENT_VISIBILITIES.has(visibility.residentContext)) errors.push(`external_context_admission_bad_resident_visibility:${visibility.residentContext || ""}`);
  if (!OPERATOR_VISIBILITIES.has(visibility.operatorUi)) errors.push(`external_context_admission_bad_operator_visibility:${visibility.operatorUi || ""}`);
  if (!PROVIDER_VISIBILITIES.has(visibility.providerContinuation)) errors.push(`external_context_admission_bad_provider_visibility:${visibility.providerContinuation || ""}`);
}

function validateExternalResultContextAdmission(admission = {}) {
  const errors = [];
  if (!isPlainObject(admission) || admission.schema !== EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA) errors.push("external_context_admission_schema_mismatch");
  if (!admission.admissionDigest || !admission.admissionId) errors.push("external_context_admission_missing_digest");
  if (!RESULT_KINDS.has(admission.resultKind)) errors.push(`external_context_admission_bad_result_kind:${admission.resultKind || ""}`);
  if (!ADMISSION_STATES.has(admission.admissionState)) errors.push(`external_context_admission_bad_state:${admission.admissionState || ""}`);
  validateVisibility(admission.visibility, errors);
  if (!TRUNCATION_STATES.has(admission.truncationState)) errors.push(`external_context_admission_bad_truncation:${admission.truncationState || ""}`);
  if (!REDACTION_STATES.has(admission.redactionState)) errors.push(`external_context_admission_bad_redaction:${admission.redactionState || ""}`);
  if (admission.admissionState === "blocked" && admission.visibility?.providerContinuation !== "not_sent") errors.push("external_context_admission_blocked_provider_visible");
  if (admission.admissionState === "blocked" && admission.visibility?.residentContext !== "none") errors.push("external_context_admission_blocked_resident_visible");
  if (admission.admissionState === "excerpt_admitted" && admission.visibility?.residentContext !== "bounded_excerpt") errors.push("external_context_admission_excerpt_visibility_mismatch");
  if (!String(admission.trustWarning || "").includes("not project truth")) errors.push("external_context_admission_missing_trust_warning");
  if (byteLengthFor(admission.residentVisibleText || "") > Math.max(4096, Number(admission.excerptByteLimit || 0) + 1024)) errors.push("external_context_admission_resident_text_over_cap");
  for (const projection of [admission.operatorProjection, admission.providerProjection]) {
    if (!isPlainObject(projection)) {
      errors.push("external_context_admission_missing_projection");
      continue;
    }
    for (const flag of ["rawPayloadIncluded", "rawUriIncluded", "rawSecretIncluded"]) {
      if (projection[flag] !== false) errors.push(`external_context_admission_projection_raw_leak:${flag}`);
    }
  }
  if (containsRawSecretText(admission.residentVisibleText)) errors.push("external_context_admission_resident_raw_secret");
  if (containsRawSecretText(admission.operatorProjection?.summary)) errors.push("external_context_admission_operator_raw_secret");
  if (containsRawSecretText(admission.providerProjection?.text)) errors.push("external_context_admission_provider_raw_secret");
  try {
    assertFalseFlags(admission, FALSE_ADMISSION_FLAGS, "external_context_admission");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

module.exports = {
  EXTERNAL_RESULT_CONTEXT_ADMISSION_POLICY_SCHEMA,
  EXTERNAL_RESULT_CONTEXT_ADMISSION_SCHEMA,
  buildExternalResultContextAdmission,
  buildExternalResultContextAdmissionPolicy,
  validateExternalResultContextAdmission,
  validateExternalResultContextAdmissionPolicy,
};
