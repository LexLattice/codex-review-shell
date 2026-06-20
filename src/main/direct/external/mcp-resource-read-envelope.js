"use strict";

const crypto = require("node:crypto");

const {
  EXTERNAL_CAPABILITY_PROFILE_SCHEMA,
  buildExternalCapabilityProfile,
  validateExternalCapabilityProfile,
} = require("./external-capability-profile");

const MCP_RESOURCE_IDENTITY_SCHEMA = "mcp_resource_identity@1";
const MCP_RESOURCE_READ_ENVELOPE_SCHEMA = "mcp_resource_read_envelope@1";

const READ_STATUSES = new Set(["completed", "blocked", "unavailable", "unsupported", "failed"]);
const MIME_KINDS = new Set(["text", "json", "markdown", "binary", "unknown"]);
const CONTENT_HANDLINGS = new Set([
  "text_excerpt_allowed",
  "json_summary_allowed",
  "markdown_excerpt_allowed",
  "binary_ref_only",
  "unknown_blocked",
  "oversize_blocked",
]);
const TRUNCATION_STATES = new Set(["none", "truncated", "omitted"]);
const REDACTION_STATES = new Set(["passed", "redacted", "blocked", "not_scanned"]);
const PAYLOAD_RETENTIONS = new Set(["not_stored", "stored_redacted", "stored_digest_only", "stored_private_artifact"]);
const READ_FRESHNESS = new Set(["fresh_external_read", "cached_fresh", "cached_stale", "unknown"]);
const CONTEXT_ADMISSIONS = new Set(["summary_admitted", "excerpt_admitted", "ref_only", "blocked"]);
const RESULT_TRUST_LEVELS = new Set(["external_untrusted", "external_authenticated", "local_connector_reported", "unknown"]);
const URI_SCHEME_CLASSES = new Set(["mcp_resource", "file_like", "http_like", "custom", "unknown"]);

const MAX_EXCERPT_BYTES = 4096;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 96 * 1024;
const BLOCKED_URI_SCHEMES = new Set(["javascript:", "data:", "blob:", "about:"]);

const FALSE_ENVELOPE_FLAGS = [
  "rawResourcePayloadIncluded",
  "rawResourceUriIncluded",
  "rawSecretIncluded",
  "executionAuthorityGranted",
  "workspaceMutationStarted",
  "projectTruthGranted",
  "durableMemoryAdmissionStarted",
  "autoReplayAllowed",
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

function normalizeEvidenceRef(input = {}, fallbackKind = "mcp_resource_read") {
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
  ref.refDigest = digestFor("mcp-resource-read-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "mcp_resource_read") {
  return arrayOrEmpty(values).filter(isPlainObject).map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function assertFalseFlags(target = {}, flags = [], label = "mcp_resource_read") {
  for (const flag of flags) {
    if (target[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
}

function serverById(profile = {}, serverIdentityId = "") {
  return arrayOrEmpty(profile.serverIdentities).find((server) => server.serverIdentityId === serverIdentityId);
}

function serverSelectable(server = null) {
  return Boolean(server && server.enabledState === "enabled" && server.freshness === "fresh" && !["unknown", "untrusted"].includes(server.trustState));
}

function classifyUriScheme(uri = "") {
  const text = normalizeString(uri, "");
  if (!text) return "unknown";
  try {
    const parsed = new URL(text);
    if (parsed.protocol === "mcp:") return "mcp_resource";
    if (parsed.protocol === "file:") return "file_like";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "http_like";
    if (BLOCKED_URI_SCHEMES.has(parsed.protocol)) return "unknown";
    return "custom";
  } catch {
    if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) return "file_like";
    return "custom";
  }
}

function uriHasBlockedScheme(uri = "") {
  try {
    return BLOCKED_URI_SCHEMES.has(new URL(uri).protocol);
  } catch {
    return false;
  }
}

function sanitizeResourceDisplay(uri = "", fallback = "") {
  const text = normalizeString(uri, "");
  if (!text) return boundedString(fallback || "MCP resource", 220);
  try {
    const parsed = new URL(text);
    const host = parsed.host ? `//${parsed.host}` : "";
    return boundedString(`${parsed.protocol}${host}${parsed.pathname}${parsed.search ? "?..." : ""}${parsed.hash ? "#..." : ""}`.replace(/\/\/([^/@\s]+)@/g, "//...@"), 220);
  } catch {
    const [beforeHash, hash = ""] = text.split("#");
    const [beforeQuery, query = ""] = beforeHash.split("?");
    return boundedString(`${beforeQuery}${query ? "?..." : ""}${hash ? "#..." : ""}`.replace(/\/\/([^/@\s]+)@/g, "//...@"), 220);
  }
}

function inferMimeKind(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const explicit = normalizeString(source.mimeKind, "");
  if (MIME_KINDS.has(explicit)) return explicit;
  const mime = normalizeString(source.mimeType || source.contentType, "").toLowerCase();
  if (mime.includes("json")) return "json";
  if (mime.includes("markdown") || mime.includes("md")) return "markdown";
  if (mime.startsWith("text/")) return "text";
  if (mime) return "binary";
  return "unknown";
}

function byteLengthFor(value = "") {
  return Buffer.byteLength(String(value), "utf8");
}

function redactionScan(text = "") {
  const source = String(text);
  if (!source) return { state: "not_scanned", text: "", secretDetected: false };
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    /\b(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  ];
  let redacted = source;
  let secretDetected = false;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, () => {
      secretDetected = true;
      return "[REDACTED]";
    });
  }
  return { state: secretDetected ? "redacted" : "passed", text: redacted, secretDetected };
}

function contentPolicyFor({ mimeKind, byteCount, requestedContextAdmission }) {
  if (mimeKind === "binary") {
    return {
      status: "unsupported",
      contentHandling: "binary_ref_only",
      contextAdmission: "ref_only",
      truncationState: "omitted",
      payloadRetention: "stored_digest_only",
    };
  }
  if (mimeKind === "unknown") {
    return {
      status: "unsupported",
      contentHandling: "unknown_blocked",
      contextAdmission: "blocked",
      truncationState: "omitted",
      payloadRetention: "stored_digest_only",
    };
  }
  const cap = mimeKind === "json" ? MAX_JSON_BYTES : MAX_TEXT_BYTES;
  if (byteCount > cap) {
    return {
      status: "unsupported",
      contentHandling: "oversize_blocked",
      contextAdmission: "ref_only",
      truncationState: "omitted",
      payloadRetention: "stored_digest_only",
    };
  }
  const contentHandling = mimeKind === "json"
    ? "json_summary_allowed"
    : mimeKind === "markdown"
      ? "markdown_excerpt_allowed"
      : "text_excerpt_allowed";
  const contextAdmission = CONTEXT_ADMISSIONS.has(requestedContextAdmission) && requestedContextAdmission !== "summary_admitted"
    ? requestedContextAdmission
    : "excerpt_admitted";
  return {
    status: "completed",
    contentHandling,
    contextAdmission,
    truncationState: byteCount > MAX_EXCERPT_BYTES ? "truncated" : "none",
    payloadRetention: "stored_redacted",
  };
}

function buildMcpResourceIdentity(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const serverIdentityId = boundedString(source.serverIdentityId || source.serverId, 180);
  const uri = normalizeString(source.resourceUri || source.uri, "");
  const uriDigest = uri ? digestFor("mcp-resource-uri@1", uri) : "";
  const identity = {
    schema: MCP_RESOURCE_IDENTITY_SCHEMA,
    resourceIdentityId: boundedString(source.resourceIdentityId, 180),
    serverIdentityId,
    resourceUriEvidenceKey: uriDigest ? `mcp_resource_uri_${uriDigest.slice(0, 24)}` : "",
    resourceDisplay: sanitizeResourceDisplay(uri, source.resourceDisplay || source.displayName),
    resourceUriDigest: uriDigest,
    uriSchemeClass: normalizeEnum(source.uriSchemeClass || classifyUriScheme(uri), URI_SCHEME_CLASSES, "unknown"),
    templateRef: source.templateRef ? normalizeEvidenceRef(source.templateRef, "mcp_resource_template") : undefined,
    templateParamDigest: source.templateParamDigest || (isPlainObject(source.templateParams) ? digestFor("mcp-resource-template-params@1", source.templateParams) : ""),
    normalizedBy: "direct_mcp_resource_identity@1",
    rawResourceUriIncluded: false,
  };
  identity.resourceIdentityId = identity.resourceIdentityId || `mcp_resource_${digestFor("mcp-resource-identity-source@1", {
    serverIdentityId,
    resourceUriDigest: uriDigest,
    templateParamDigest: identity.templateParamDigest,
  }).slice(0, 24)}`;
  identity.identityDigest = digestFor("mcp-resource-identity@1", identity);
  validateMcpResourceIdentity(identity);
  return identity;
}

function validateMcpResourceIdentity(identity = {}) {
  const errors = [];
  if (!isPlainObject(identity) || identity.schema !== MCP_RESOURCE_IDENTITY_SCHEMA) errors.push("mcp_resource_identity_schema_mismatch");
  if (!identity.serverIdentityId) errors.push("mcp_resource_identity_missing_server_identity");
  if (!identity.resourceUriDigest) errors.push("mcp_resource_identity_missing_uri_digest");
  if (!URI_SCHEME_CLASSES.has(identity.uriSchemeClass)) errors.push(`mcp_resource_identity_bad_uri_scheme_class:${identity.uriSchemeClass || ""}`);
  if (identity.rawResourceUriIncluded !== false) errors.push("mcp_resource_identity_raw_uri_leak");
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function buildServerSelector(profile = {}, serverIdentityId = "") {
  const server = serverById(profile, serverIdentityId);
  return {
    serverIdentityId,
    selectorState: serverSelectable(server) ? "selected" : "blocked",
    exactServerIdentityRequired: true,
    serverIdentityDigest: boundedString(server?.identityDigest, 180),
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
  };
}

function buildMcpResourceReadEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.profile?.schema === EXTERNAL_CAPABILITY_PROFILE_SCHEMA
    ? source.profile
    : buildExternalCapabilityProfile(source.profile || source);
  validateExternalCapabilityProfile(profile);

  const serverIdentityId = normalizeString(source.serverIdentityId || source.serverId || source.resourceIdentity?.serverIdentityId, "");
  const server = serverById(profile, serverIdentityId);
  const uri = normalizeString(source.resourceUri || source.uri || source.resourceIdentity?.resourceUri, "");
  const identity = source.resourceIdentity?.schema === MCP_RESOURCE_IDENTITY_SCHEMA
    ? source.resourceIdentity
    : buildMcpResourceIdentity({
      ...source.resourceIdentity,
      serverIdentityId,
      resourceUri: uri,
      resourceDisplay: source.resourceDisplay || source.displayName,
      templateRef: source.templateRef,
      templateParams: source.templateParams,
    });
  validateMcpResourceIdentity(identity);

  const blockerCodes = [];
  if (!serverIdentityId) blockerCodes.push("mcp_server_missing");
  if (serverIdentityId && !server) blockerCodes.push("mcp_server_unknown");
  if (server && !serverSelectable(server)) blockerCodes.push(`mcp_server_not_selectable:${server.enabledState}:${server.freshness}:${server.trustState}`);
  if (identity.serverIdentityId !== serverIdentityId) blockerCodes.push("resource_uri_server_mismatch");
  if (!uri) blockerCodes.push("resource_uri_missing");
  if (uriHasBlockedScheme(uri)) blockerCodes.push("resource_uri_scheme_blocked");
  if (source.resourceUriDigest && source.resourceUriDigest !== identity.resourceUriDigest) blockerCodes.push("resource_uri_digest_mismatch");

  const suppliedPayload = source.payload ?? source.content ?? source.text ?? "";
  const payloadText = typeof suppliedPayload === "string" ? suppliedPayload : "";
  const byteCount = Number.isFinite(Number(source.byteCount)) ? Number(source.byteCount) : byteLengthFor(payloadText);
  const mimeKind = inferMimeKind(source);
  const policy = contentPolicyFor({
    mimeKind,
    byteCount,
    requestedContextAdmission: source.contextAdmission,
  });
  const redaction = policy.status === "completed" ? redactionScan(payloadText) : { state: payloadText ? "not_scanned" : "not_scanned", text: "", secretDetected: false };
  const payloadDigest = payloadText ? digestFor("mcp-resource-read-payload@1", payloadText) : "";
  const canAdmitExcerpt = policy.status === "completed" && !blockerCodes.length && redaction.state !== "blocked";
  const payloadExcerpt = canAdmitExcerpt
    ? boundedString(redaction.text.slice(0, MAX_EXCERPT_BYTES), MAX_EXCERPT_BYTES)
    : "";
  const status = blockerCodes.length
    ? "blocked"
    : normalizeEnum(source.status, READ_STATUSES, policy.status);
  const contextAdmission = status === "completed"
    ? policy.contextAdmission
    : status === "unsupported"
      ? policy.contextAdmission
      : "blocked";
  const retention = status === "completed" ? policy.payloadRetention : policy.status === "unsupported" ? policy.payloadRetention : "not_stored";

  const envelope = {
    schema: MCP_RESOURCE_READ_ENVELOPE_SCHEMA,
    envelopeId: boundedString(source.envelopeId, 180),
    projectId: boundedString(source.projectId || profile.projectId, 160),
    workThreadId: boundedString(source.workThreadId || profile.workThreadId, 160),
    threadId: boundedString(source.threadId, 160),
    turnId: boundedString(source.turnId, 160),
    callId: boundedString(source.callId || source.toolCallId, 180),
    serverSelector: buildServerSelector(profile, serverIdentityId),
    serverIdentityRef: normalizeEvidenceRef({
      kind: "mcp_server_identity_witness",
      id: serverIdentityId,
      digest: server?.identityDigest || "",
      label: server?.displayName || serverIdentityId || "MCP server",
      confidence: server?.freshness || "unknown",
    }, "mcp_server_identity_witness"),
    resourceDescriptorRef: normalizeEvidenceRef(source.resourceDescriptorRef || {
      kind: "mcp_resource_descriptor",
      id: source.resourceDescriptorId || identity.resourceIdentityId,
      digest: source.resourceDescriptorDigest || identity.identityDigest,
      label: identity.resourceDisplay,
      confidence: "descriptor_only",
    }, "mcp_resource_descriptor"),
    resourceIdentity: identity,
    resourceUriEvidenceKey: identity.resourceUriEvidenceKey,
    resourceDisplay: identity.resourceDisplay,
    status,
    blockerCodes: [...new Set(blockerCodes)].sort(),
    sideEffectClass: "external_read",
    mimeKind,
    contentHandling: policy.contentHandling,
    byteCount,
    truncationState: status === "completed" ? policy.truncationState : policy.truncationState === "none" ? "omitted" : policy.truncationState,
    redactionState: status === "completed" ? redaction.state : "not_scanned",
    payloadRetention: retention,
    payloadArtifactRef: source.payloadArtifactRef ? normalizeEvidenceRef(source.payloadArtifactRef, "mcp_resource_payload_artifact") : undefined,
    payloadDigest,
    payloadExcerpt,
    readFreshness: normalizeEnum(source.readFreshness, READ_FRESHNESS, status === "completed" ? "fresh_external_read" : "unknown"),
    sourceObservedAt: normalizeString(source.sourceObservedAt, status === "completed" ? nowIso(source.nowMs) : ""),
    cacheEntryId: boundedString(source.cacheEntryId, 180),
    cachePolicyDigest: boundedString(source.cachePolicyDigest || digestFor("mcp-resource-read-cache-policy@1", {
      serverIdentityId,
      resourceUriDigest: identity.resourceUriDigest,
      cacheMaySatisfyRepeatRead: source.cacheMaySatisfyRepeatRead === true,
    }), 180),
    readReplayPolicy: {
      idempotencyKey: boundedString(source.idempotencyKey || `mcp_read_${digestFor("mcp-resource-read-idempotency@1", {
        serverIdentityId,
        resourceUriDigest: identity.resourceUriDigest,
        callId: source.callId || source.toolCallId || "",
      }).slice(0, 24)}`, 180),
      mayAutoRetry: false,
      mayReplayAfterHandoffUnknown: false,
      cacheMaySatisfyRepeatRead: source.cacheMaySatisfyRepeatRead === true,
    },
    contextAdmission,
    resultTrustLevel: normalizeEnum(source.resultTrustLevel || server?.trustState, RESULT_TRUST_LEVELS, server?.trustState === "trusted_local" ? "local_connector_reported" : "external_untrusted"),
    rawResourcePayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawSecretIncluded: false,
    executionAuthorityGranted: false,
    workspaceMutationStarted: false,
    projectTruthGranted: false,
    durableMemoryAdmissionStarted: false,
    autoReplayAllowed: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "mcp_resource_read_envelope"),
  };
  envelope.envelopeId = envelope.envelopeId || `mcp_resource_read_envelope_${digestFor("mcp-resource-read-envelope-id@1", {
    serverIdentityId,
    resourceIdentityDigest: identity.identityDigest,
    payloadDigest,
    status,
  }).slice(0, 24)}`;
  envelope.envelopeDigest = digestFor("mcp-resource-read-envelope@1", envelope);
  validateMcpResourceReadEnvelope(envelope);
  return envelope;
}

function validateMcpResourceReadEnvelope(envelope = {}) {
  const errors = [];
  if (!isPlainObject(envelope) || envelope.schema !== MCP_RESOURCE_READ_ENVELOPE_SCHEMA) errors.push("mcp_resource_read_envelope_schema_mismatch");
  if (!READ_STATUSES.has(envelope.status)) errors.push(`mcp_resource_read_bad_status:${envelope.status || ""}`);
  if (!isPlainObject(envelope.serverSelector)) {
    errors.push("mcp_resource_read_missing_server_selector");
  } else if (envelope.serverSelector.rawEndpointIncluded !== false || envelope.serverSelector.rawCredentialIncluded !== false) {
    errors.push("mcp_resource_read_server_selector_raw_leak");
  }
  if (!isPlainObject(envelope.resourceIdentity) || envelope.resourceIdentity.schema !== MCP_RESOURCE_IDENTITY_SCHEMA) errors.push("mcp_resource_read_missing_resource_identity");
  if (!MIME_KINDS.has(envelope.mimeKind)) errors.push(`mcp_resource_read_bad_mime_kind:${envelope.mimeKind || ""}`);
  if (!CONTENT_HANDLINGS.has(envelope.contentHandling)) errors.push(`mcp_resource_read_bad_content_handling:${envelope.contentHandling || ""}`);
  if (!TRUNCATION_STATES.has(envelope.truncationState)) errors.push(`mcp_resource_read_bad_truncation:${envelope.truncationState || ""}`);
  if (!REDACTION_STATES.has(envelope.redactionState)) errors.push(`mcp_resource_read_bad_redaction:${envelope.redactionState || ""}`);
  if (!PAYLOAD_RETENTIONS.has(envelope.payloadRetention)) errors.push(`mcp_resource_read_bad_payload_retention:${envelope.payloadRetention || ""}`);
  if (!READ_FRESHNESS.has(envelope.readFreshness)) errors.push(`mcp_resource_read_bad_freshness:${envelope.readFreshness || ""}`);
  if (!CONTEXT_ADMISSIONS.has(envelope.contextAdmission)) errors.push(`mcp_resource_read_bad_context_admission:${envelope.contextAdmission || ""}`);
  if (!RESULT_TRUST_LEVELS.has(envelope.resultTrustLevel)) errors.push(`mcp_resource_read_bad_trust_level:${envelope.resultTrustLevel || ""}`);
  if (envelope.sideEffectClass !== "external_read") errors.push("mcp_resource_read_bad_side_effect_class");
  if (envelope.status === "blocked" && !arrayOrEmpty(envelope.blockerCodes).length) errors.push("mcp_resource_read_blocked_missing_blocker");
  if (envelope.contentHandling === "binary_ref_only" && envelope.contextAdmission !== "ref_only") errors.push("mcp_resource_read_binary_not_ref_only");
  if (envelope.contentHandling === "unknown_blocked" && envelope.contextAdmission !== "blocked") errors.push("mcp_resource_read_unknown_not_blocked");
  if (envelope.status !== "completed" && envelope.contextAdmission !== "blocked" && envelope.contextAdmission !== "ref_only") errors.push("mcp_resource_read_noncompleted_context_overadmission");
  if (String(envelope.payloadExcerpt || "").length > MAX_EXCERPT_BYTES) errors.push("mcp_resource_read_excerpt_over_cap");
  if (!isPlainObject(envelope.readReplayPolicy)) {
    errors.push("mcp_resource_read_missing_replay_policy");
  } else {
    if (envelope.readReplayPolicy.mayAutoRetry !== false) errors.push("mcp_resource_read_auto_retry_allowed");
    if (envelope.readReplayPolicy.mayReplayAfterHandoffUnknown !== false) errors.push("mcp_resource_read_handoff_replay_allowed");
  }
  if (String(envelope.resourceDisplay || "").includes("secret") || String(envelope.resourceDisplay || "").includes("token=")) errors.push("mcp_resource_read_resource_display_raw_secret");
  try {
    assertFalseFlags(envelope, FALSE_ENVELOPE_FLAGS, "mcp_resource_read_envelope");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  validateMcpResourceIdentity(envelope.resourceIdentity);
  return true;
}

module.exports = {
  MCP_RESOURCE_IDENTITY_SCHEMA,
  MCP_RESOURCE_READ_ENVELOPE_SCHEMA,
  buildMcpResourceIdentity,
  buildMcpResourceReadEnvelope,
  validateMcpResourceIdentity,
  validateMcpResourceReadEnvelope,
};
