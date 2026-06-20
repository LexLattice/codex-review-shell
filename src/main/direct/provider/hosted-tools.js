"use strict";

const crypto = require("node:crypto");

const PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA = "provider_hosted_tool_capability@1";
const PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA = "provider_web_search_evidence_contract@1";
const PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA = "provider_image_generation_artifact_contract@1";
const PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA = "provider_hosted_tools_status@1";
const PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA = "provider_hosted_request_shape_proof@1";
const PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA = "provider_hosted_declaration_policy@1";
const PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA = "provider_hosted_tool_activation_snapshot@1";
const PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA = "provider_hosted_tool_call_envelope@1";
const PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA = "provider_hosted_web_search_query_policy@1";
const PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA = "provider_hosted_web_search_query_envelope@1";
const PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA = "provider_hosted_web_search_result_envelope@1";
const PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA = "provider_hosted_result_context_admission@1";
const PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA = "provider_hosted_image_prompt_policy@1";
const PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA = "provider_hosted_image_prompt_envelope@1";
const PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA = "provider_hosted_raw_exposure_scan@1";

const TOOL_KINDS = new Set(["web_search", "image_generation"]);
const EVIDENCE_STATES = new Set(["accepted", "runtime_probed", "profile_declared", "known_available_unprobed", "unknown", "unsupported"]);
const PROVIDER_DECLARATION_STATES = new Set(["not_declared", "metadata_declared", "activation_ready", "declared_to_resident", "operator_ui_live", "runtime_accepted", "unsupported", "unknown", "blocked"]);
const RESULT_POSTURES = new Set(["external_epistemic_evidence", "generated_artifact", "not_available", "unknown"]);
const REQUEST_SOURCES = new Set(["provider_metadata_profile", "runtime_probe", "fixture", "unknown"]);
const INVOCATION_MODES = new Set(["model_mediated_provider_tool", "harness_requested_provider_operation", "operator_triggered_provider_operation", "headless_route_provider_operation"]);
const CALL_SURFACES = new Set(["resident_tool", "operator_ui", "headless_route", "system"]);
const DECLARATION_DECISIONS = new Set([
  "resident_callable",
  "operator_callable",
  "headless_callable",
  "activation_ready_only",
  "blocked_unknown_capability",
  "blocked_unsupported",
  "blocked_missing_request_shape_proof",
  "blocked_stale_request_shape_proof",
  "blocked_result_shape_unobserved",
  "blocked_operator_gate_required",
]);
const AUTHORITY_DECISIONS = new Set([
  "allowed",
  "blocked_unknown_capability",
  "blocked_unsupported",
  "blocked_missing_declaration",
  "blocked_stale_declaration",
  "blocked_missing_result_policy",
  "blocked_raw_exposure_risk",
  "blocked_operator_gate_required",
]);
const HOSTED_SIDE_EFFECT_CLASSES = new Set(["external_epistemic_read", "generated_artifact_production"]);
const REDACTION_STATES = new Set(["passed", "redacted", "blocked"]);
const RESULT_REDACTION_STATES = new Set(["not_needed", "redacted", "blocked"]);
const WEB_SEARCH_QUERY_KINDS = new Set(["single_query", "followup_query", "site_scoped_query"]);
const WEB_SEARCH_SOURCE_TYPES = new Set(["web_page", "news", "documentation", "forum", "pdf", "unknown"]);
const WEB_SEARCH_RETRIEVAL_CONFIDENCES = new Set(["provider_reported", "provider_cited", "harness_verified", "unknown"]);
const WEB_SEARCH_CONTENT_ACCESSES = new Set(["snippet_only", "summary_only", "provider_citation_only", "fetched_content", "unknown"]);
const WEB_SEARCH_TRUST_POSTURES = new Set(["provider_reported", "operator_known", "unknown"]);
const WEB_SEARCH_FRESHNESS_POSTURES = new Set(["current_at_retrieval", "stale_possible", "unknown"]);
const WEB_SEARCH_SUMMARY_KINDS = new Set(["provider_reported_summary", "harness_reduced_summary", "resident_generated_after_admission", "none"]);
const WEB_SEARCH_SUMMARY_AUTHORITIES = new Set(["external_evidence_summary", "assistant_answer", "diagnostic"]);
const CONTEXT_ADMISSION_KINDS = new Set(["summary", "source_refs", "bounded_excerpt", "artifact_ref", "blocked"]);
const CONTEXT_ADMISSION_DECISIONS = new Set(["admit", "admit_degraded", "block_source_unknown", "block_raw_exposure", "block_policy", "not_requested"]);
const RESIDENT_CONTEXT_VISIBILITIES = new Set(["none", "summary", "source_refs", "bounded_excerpt", "artifact_ref"]);
const OPERATOR_PROJECTION_VISIBILITIES = new Set(["none", "summary", "source_refs", "artifact_preview", "artifact_ref"]);
const PROVIDER_CONTINUATION_VISIBILITIES = new Set(["not_sent", "summary_only", "source_refs", "artifact_ref"]);
const RAW_EXPOSURE_FINDINGS = new Set(["credentialed_url", "raw_secret", "private_file_path", "raw_provider_payload", "unbounded_personal_data", "oversized_input"]);

const CALLABLE_EVIDENCE_STATES = new Set(["accepted", "runtime_probed"]);
const CREDENTIAL_URL_PATTERN = /\bhttps?:\/\/[^\s/:@]+:[^@\s]+@[^\s]+/i;
const SECRET_PATTERN = /\b(?:bearer\s+[a-z0-9._~+/=-]{12,}|sk-[a-z0-9_-]{12,}|api[_-]?key\s*[:=]\s*[a-z0-9._~+/=-]{8,}|password\s*[:=]\s*\S+)/i;
const PRIVATE_PATH_PATTERN = /(?:^|\s)(?:\/home\/[^/\s]+|\/mnt\/[a-z]\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)/i;
const PROVIDER_PAYLOAD_PATTERN = /(?:\"rawProviderPayload\"|\"messages\"\s*:\s*\[|\"authorization\"\s*:|\"cookie\"\s*:)/i;
const PERSONAL_DATA_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\d .()-]{7,}\d)\b/i;
const URL_QUERY_SECRET_PATTERN = /(?:^|[?&;])(?:token|api[_-]?key|password|secret|signature|sig|access[_-]?token)=/i;
const UNSAFE_URL_SCHEMES = new Set(["javascript:", "data:", "blob:", "file:"]);

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

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function normalizePositiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeStringList(value, fallback = []) {
  const list = arrayOrEmpty(value)
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  return list.length ? [...new Set(list)] : fallback;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "provider_hosted_tool") {
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
  ref.refDigest = digestFor("provider-hosted-tool-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "provider_hosted_tool") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeModelRef(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    model: boundedString(source.model || source.modelId || "unknown", 160),
    serviceTier: boundedString(source.serviceTier || source.speed || "", 80),
    reasoningEffort: boundedString(source.reasoningEffort || source.reasoning || "", 80),
  };
}

function modelRefsMatch(proofModelRef = {}, expectedModelRef = {}) {
  const proof = normalizeModelRef(proofModelRef);
  const expected = normalizeModelRef(expectedModelRef);
  if (expected.model && expected.model !== "unknown" && proof.model !== expected.model) return false;
  if (expected.serviceTier && proof.serviceTier !== expected.serviceTier) return false;
  if (expected.reasoningEffort && proof.reasoningEffort !== expected.reasoningEffort) return false;
  return true;
}

function normalizeInvocationModes(value) {
  const modes = arrayOrEmpty(value)
    .map((mode) => normalizeEnum(mode, INVOCATION_MODES, ""))
    .filter(Boolean);
  return [...new Set(modes)];
}

function requestShapeProofIsFresh(proof = {}, nowMs) {
  if (!proof.expiresAt) return true;
  const expiresAtMs = Date.parse(proof.expiresAt);
  const currentMs = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return Number.isFinite(expiresAtMs) && expiresAtMs > currentMs;
}

function timestampIsFresh(expiresAt, nowMs) {
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  const currentMs = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return Number.isFinite(expiresAtMs) && expiresAtMs > currentMs;
}

function inputDigestFor(text) {
  return digestFor("provider-hosted-input-text@1", normalizeString(text, ""));
}

function normalizeIsoTimestamp(value, fallback) {
  const text = normalizeString(value, "");
  if (text && Number.isFinite(Date.parse(text))) return new Date(Date.parse(text)).toISOString();
  return fallback;
}

function normalizeWebSearchLimits(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    maxSources: normalizePositiveInteger(source.maxSources, 8),
    maxSummaryChars: normalizePositiveInteger(source.maxSummaryChars, 1200),
    maxExcerptChars: normalizePositiveInteger(source.maxExcerptChars, 480),
    maxFollowupSearchesPerTurn: normalizePositiveInteger(source.maxFollowupSearchesPerTurn, 2),
  };
}

function safeWebUrlParts(rawUrl) {
  const text = normalizeString(rawUrl, "");
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (UNSAFE_URL_SCHEMES.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    if (URL_QUERY_SECRET_PATTERN.test(parsed.search)) return null;
    return {
      display: boundedString(parsed.toString(), 360),
      evidenceKey: `web_url_${digestFor("provider-hosted-web-url@1", parsed.toString()).slice(0, 32)}`,
    };
  } catch {
    return null;
  }
}

function normalizeWebSearchSourceRef(input = {}, index = 0, fallbackRetrievedAt = "") {
  const source = isPlainObject(input) ? input : {};
  const url = safeWebUrlParts(source.url || source.urlDisplay || source.href);
  if (!url) return null;
  const sourceRef = {
    sourceId: boundedString(source.sourceId || `source_${index + 1}`, 120),
    urlDisplay: url.display,
    urlEvidenceKey: boundedString(source.urlEvidenceKey || url.evidenceKey, 180),
    title: boundedString(source.title, 220),
    retrievedAt: normalizeIsoTimestamp(source.retrievedAt, fallbackRetrievedAt),
    citationLabel: boundedString(source.citationLabel || `[${index + 1}]`, 80),
    sourceType: normalizeEnum(source.sourceType, WEB_SEARCH_SOURCE_TYPES, "unknown"),
    retrievalConfidence: normalizeEnum(source.retrievalConfidence, WEB_SEARCH_RETRIEVAL_CONFIDENCES, "provider_cited"),
    contentAccess: normalizeEnum(source.contentAccess, WEB_SEARCH_CONTENT_ACCESSES, "provider_citation_only"),
    trustPosture: normalizeEnum(source.trustPosture, WEB_SEARCH_TRUST_POSTURES, "provider_reported"),
  };
  sourceRef.sourceDigest = digestFor("provider-hosted-web-source-ref@1", sourceRef);
  return sourceRef;
}

function resultAdmissionRef(admission = {}) {
  return normalizeEvidenceRef({
    kind: "provider_hosted_result_context_admission",
    id: admission.admissionId,
    digest: admission.admissionDigest,
    label: "provider-hosted result context admission",
    confidence: admission.admissionDecision,
  }, "provider_hosted_result_context_admission");
}

function requestShapeProofIsCallable(proof = {}, nowMs) {
  return proof.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA
    && proof.runtimeAccepted === true
    && proof.resultShapeObserved === true
    && Boolean(normalizeString(proof.requestShapeDigest, ""))
    && requestShapeProofIsFresh(proof, nowMs);
}

function requestShapeProofMatchesScope(proof = {}, scope = {}) {
  const providerProfileDigest = normalizeString(scope.providerProfileDigest, "");
  if (!providerProfileDigest || proof.providerProfileDigest !== providerProfileDigest) return false;
  return modelRefsMatch(proof.modelRef, scope.modelRef);
}

function capabilityValueIsSupported(value) {
  if (value === true) return true;
  if (typeof value === "string") return ["true", "available", "enabled", "supported", "declared"].includes(value.trim().toLowerCase());
  if (!isPlainObject(value)) return false;
  if (value.supported === true || value.enabled === true || value.available === true || value.accepted === true) return true;
  const status = normalizeString(value.status || value.state || value.availabilityState, "").toLowerCase();
  return ["available", "enabled", "supported", "declared", "accepted"].includes(status);
}

function profileToolListHas(profile = {}, toolKind) {
  const aliases = toolKind === "web_search"
    ? new Set(["web_search", "web_search_preview", "webSearch"])
    : new Set(["image_generation", "image_generation_call", "imageGeneration"]);
  return arrayOrEmpty(profile?.capabilities?.tools).some((tool) => {
    if (typeof tool === "string") return aliases.has(tool);
    if (!isPlainObject(tool)) return false;
    return aliases.has(normalizeString(tool.id || tool.name || tool.type || tool.tool, ""));
  });
}

function providerCapabilityValue(profile = {}, toolKind) {
  if (toolKind === "web_search") return profile?.capabilities?.provider?.webSearch;
  if (toolKind === "image_generation") return profile?.capabilities?.provider?.imageGeneration;
  return undefined;
}

function hasOwn(object, key) {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function hostedToolEvidenceIsPresent(profile = {}, toolKind) {
  const provider = profile?.capabilities?.provider;
  const providerKey = toolKind === "web_search" ? "webSearch" : "imageGeneration";
  if (hasOwn(provider, providerKey)) return true;
  const aliases = toolKind === "web_search"
    ? new Set(["web_search", "web_search_preview", "webSearch"])
    : new Set(["image_generation", "image_generation_call", "imageGeneration"]);
  return arrayOrEmpty(profile?.capabilities?.tools).some((tool) => {
    if (typeof tool === "string") return aliases.has(tool);
    if (!isPlainObject(tool)) return false;
    return aliases.has(normalizeString(tool.id || tool.name || tool.type || tool.tool, ""));
  });
}

function hostedToolCapabilityFromProfile(profile = {}, toolKind) {
  const providerValue = providerCapabilityValue(profile, toolKind);
  const supported = capabilityValueIsSupported(providerValue) || profileToolListHas(profile, toolKind);
  const hasProfile = normalizeString(profile?.schema, "") === "direct_provider_metadata_profile@1";
  const hasHostedToolEvidence = hostedToolEvidenceIsPresent(profile, toolKind);
  const absentEvidenceState = hasProfile && hasHostedToolEvidence ? "unsupported" : "unknown";
  return {
    supported,
    evidenceState: supported ? "profile_declared" : absentEvidenceState,
    providerDeclarationState: supported ? "metadata_declared" : absentEvidenceState,
    sourceDigest: normalizeString(profile?.profileDigest, ""),
    generatedAt: normalizeString(profile?.generatedAt, ""),
  };
}

function buildProviderHostedToolCapability(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const profileDerived = isPlainObject(source.providerMetadataProfile)
    ? hostedToolCapabilityFromProfile(source.providerMetadataProfile, toolKind)
    : {};
  const evidenceState = normalizeEnum(source.evidenceState, EVIDENCE_STATES, profileDerived.evidenceState || "unknown");
  const providerDeclarationState = normalizeEnum(
    source.providerDeclarationState,
    PROVIDER_DECLARATION_STATES,
    profileDerived.providerDeclarationState || "unknown",
  );
  const resultPosture = normalizeEnum(
    source.resultPosture,
    RESULT_POSTURES,
    toolKind === "web_search" ? "external_epistemic_evidence" : "generated_artifact",
  );
  const capability = {
    schema: PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
    capabilityId: boundedString(source.capabilityId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    toolKind,
    displayName: toolKind === "web_search" ? "Provider-hosted web search" : "Provider-hosted image generation",
    evidenceState,
    providerDeclarationState,
    requestSource: normalizeEnum(source.requestSource, REQUEST_SOURCES, profileDerived.sourceDigest ? "provider_metadata_profile" : "unknown"),
    providerMetadataDigest: boundedString(source.providerMetadataDigest || profileDerived.sourceDigest, 180),
    providerMetadataObservedAt: boundedString(source.providerMetadataObservedAt || profileDerived.generatedAt, 80),
    resultPosture,
    contextVisibility: toolKind === "web_search" ? "provider_artifact_ref" : "provider_artifact_ref",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_hosted_tool_capability"),
    requiredFutureGates: toolKind === "web_search"
      ? ["provider_capability_evidence", "retrieval_time", "source_url_policy", "citation_policy", "staleness_policy"]
      : ["provider_capability_evidence", "prompt_evidence", "asset_storage_policy", "metadata_redaction_policy", "safety_metadata_policy"],
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  capability.capabilityId = capability.capabilityId || `provider_hosted_${toolKind}_${digestFor("provider-hosted-capability-source@1", capability).slice(0, 24)}`;
  capability.capabilityDigest = digestFor("provider-hosted-tool-capability@1", capability);
  return capability;
}

function buildProviderHostedRequestShapeProof(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const invocationMode = normalizeEnum(source.invocationMode, INVOCATION_MODES, toolKind === "web_search" ? "model_mediated_provider_tool" : "operator_triggered_provider_operation");
  const observedAt = normalizeString(source.observedAt, nowIso(source.nowMs));
  const proof = {
    schema: PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA,
    proofId: boundedString(source.proofId || "", 180),
    toolKind,
    invocationMode,
    providerProfileDigest: boundedString(source.providerProfileDigest || source.providerMetadataDigest, 180),
    modelRef: normalizeModelRef(source.modelRef),
    requestShapeDigest: boundedString(source.requestShapeDigest, 180),
    requestBuilderVersion: boundedString(source.requestBuilderVersion || "unknown", 120),
    runtimeAccepted: normalizeBoolean(source.runtimeAccepted, false),
    resultShapeObserved: normalizeBoolean(source.resultShapeObserved, false),
    observedAt,
    expiresAt: boundedString(source.expiresAt, 80),
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
  };
  proof.proofId = proof.proofId || `provider_hosted_request_shape_${toolKind}_${digestFor("provider-hosted-request-shape-proof-source@1", proof).slice(0, 24)}`;
  proof.proofDigest = digestFor("provider-hosted-request-shape-proof@1", proof);
  return proof;
}

function bestRequestShapeProof({ proofs = [], toolKind, invocationMode, providerProfileDigest, modelRef, nowMs }) {
  const candidates = arrayOrEmpty(proofs)
    .filter((proof) => proof?.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA)
    .filter((proof) => proof.toolKind === toolKind)
    .filter((proof) => !invocationMode || proof.invocationMode === invocationMode)
    .filter((proof) => requestShapeProofMatchesScope(proof, { providerProfileDigest, modelRef }));
  return candidates.find((proof) => requestShapeProofIsCallable(proof, nowMs)) || candidates[0] || null;
}

function providerHostedDeclarationDecision({ capability = {}, proof = null, invocationMode, nowMs }) {
  const toolKind = normalizeEnum(capability.toolKind, TOOL_KINDS, "web_search");
  const evidenceState = normalizeEnum(capability.evidenceState, EVIDENCE_STATES, "unknown");
  if (evidenceState === "unsupported") return { decision: "blocked_unsupported", blocker: "unsupported_capability", callable: false };
  if (evidenceState === "unknown") return { decision: "blocked_unknown_capability", blocker: "unknown_capability", callable: false };
  if (!CALLABLE_EVIDENCE_STATES.has(evidenceState)) return { decision: "activation_ready_only", blocker: "known_available_unprobed", callable: false };
  if (toolKind === "image_generation" && invocationMode === "model_mediated_provider_tool") {
    return { decision: "blocked_operator_gate_required", blocker: "image_generation_operator_gate_required", callable: false };
  }
  if (!proof) return { decision: "blocked_missing_request_shape_proof", blocker: "missing_request_shape_proof", callable: false };
  if (!requestShapeProofIsFresh(proof, nowMs)) return { decision: "blocked_stale_request_shape_proof", blocker: "stale_request_shape_proof", callable: false };
  if (!normalizeString(proof.requestShapeDigest, "")) return { decision: "blocked_missing_request_shape_proof", blocker: "missing_request_shape_digest", callable: false };
  if (proof.runtimeAccepted !== true) return { decision: "blocked_missing_request_shape_proof", blocker: "runtime_not_accepted", callable: false };
  if (proof.resultShapeObserved !== true) return { decision: "blocked_result_shape_unobserved", blocker: "result_shape_unobserved", callable: false };
  if (invocationMode === "operator_triggered_provider_operation") return { decision: "operator_callable", blocker: "", callable: true };
  if (invocationMode === "headless_route_provider_operation") return { decision: "headless_callable", blocker: "", callable: true };
  return { decision: "resident_callable", blocker: "", callable: true };
}

function buildProviderHostedDeclarationPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const policy = {
    schema: PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA,
    policyId: boundedString(source.policyId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    allowedInvocationModes: normalizeInvocationModes(source.allowedInvocationModes).length
      ? normalizeInvocationModes(source.allowedInvocationModes)
      : ["model_mediated_provider_tool", "operator_triggered_provider_operation", "headless_route_provider_operation"],
    callableEvidenceStates: ["accepted", "runtime_probed"],
    profileDeclaredCallable: false,
    knownAvailableUnprobedCallable: false,
    imageGenerationResidentCallableByDefault: false,
    webSearchResidentCallableWhenProved: true,
    requestShapeProofRequired: true,
    resultShapeObservedRequired: true,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    generatedAt,
  };
  policy.policyId = policy.policyId || `provider_hosted_declaration_policy_${digestFor("provider-hosted-declaration-policy-source@1", policy).slice(0, 24)}`;
  policy.policyDigest = digestFor("provider-hosted-declaration-policy@1", policy);
  return policy;
}

function buildProviderHostedActivationSnapshot(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId || source.providerMetadataProfile?.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const providerProfileDigest = boundedString(source.providerMetadataProfile?.profileDigest || source.providerProfileDigest || source.providerMetadataDigest, 180);
  const modelRef = normalizeModelRef(source.modelRef);
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : [
    { toolKind: "web_search", providerMetadataProfile: source.providerMetadataProfile },
    { toolKind: "image_generation", providerMetadataProfile: source.providerMetadataProfile },
  ]).map((capability) => capability?.schema === PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA
    ? capability
    : buildProviderHostedToolCapability({
      projectId,
      workThreadId,
      generatedAt,
      ...capability,
    }));
  const requestShapeProofs = arrayOrEmpty(source.requestShapeProofs)
    .map((proof) => proof?.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA ? proof : buildProviderHostedRequestShapeProof({
      ...proof,
      providerProfileDigest: proof?.providerProfileDigest || providerProfileDigest,
      modelRef: isPlainObject(proof?.modelRef) ? proof.modelRef : modelRef,
      nowMs: typeof proof?.nowMs === "number" && Number.isFinite(proof.nowMs) ? proof.nowMs : source.nowMs,
    }));
  const declarationPolicy = source.declarationPolicy?.schema === PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA
    ? source.declarationPolicy
    : buildProviderHostedDeclarationPolicy({
      projectId,
      workThreadId,
      generatedAt,
      ...source.declarationPolicy,
    });
  const invocationModes = normalizeInvocationModes(source.invocationModes).length
    ? normalizeInvocationModes(source.invocationModes)
    : declarationPolicy.allowedInvocationModes;
  const declarationDecisions = [];
  const blockedTools = [];
  const activationReadyTools = [];
  for (const capability of capabilities) {
    for (const invocationMode of invocationModes) {
      const proof = bestRequestShapeProof({ proofs: requestShapeProofs, toolKind: capability.toolKind, invocationMode, providerProfileDigest, modelRef, nowMs: source.nowMs });
      const decision = providerHostedDeclarationDecision({ capability, proof, invocationMode, nowMs: source.nowMs });
      const row = {
        toolKind: capability.toolKind,
        invocationMode,
        decision: normalizeEnum(decision.decision, DECLARATION_DECISIONS, "blocked_unknown_capability"),
        blocker: boundedString(decision.blocker, 160),
        proofId: boundedString(proof?.proofId, 180),
        proofDigest: boundedString(proof?.proofDigest, 180),
        callable: decision.callable === true,
      };
      declarationDecisions.push(row);
      if (row.callable) activationReadyTools.push({ toolKind: row.toolKind, invocationMode: row.invocationMode });
      if (!row.callable) blockedTools.push({ toolKind: row.toolKind, invocationMode: row.invocationMode, blocker: row.blocker || row.decision });
    }
  }
  const snapshot = {
    schema: PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
    activationId: boundedString(source.activationId || "", 180),
    workThreadId,
    projectId,
    providerRuntimeRef: boundedString(source.providerRuntimeRef || "unknown", 180),
    providerProfileDigest,
    accountEvidenceRef: isPlainObject(source.accountEvidenceRef) ? normalizeEvidenceRef(source.accountEvidenceRef, "provider_hosted_account_evidence") : undefined,
    modelRef,
    invocationModes,
    requestShapeProofRefs: requestShapeProofs.map((proof) => normalizeEvidenceRef({
      kind: "provider_hosted_request_shape_proof",
      id: proof.proofId,
      digest: proof.proofDigest,
      label: `${proof.toolKind}:${proof.invocationMode}`,
      confidence: requestShapeProofIsCallable(proof, source.nowMs) ? "runtime_probed" : "diagnostic",
    }, "provider_hosted_request_shape_proof")),
    capabilities,
    requestShapeProofs,
    declarationPolicy,
    activationReadyTools,
    declaredTools: [],
    blockedTools,
    declarationDecisions,
    declarationDigest: "",
    resultAdmissionPolicyId: boundedString(source.resultAdmissionPolicyId || "provider_hosted_result_context_admission@pending", 180),
    webSearchQueryPolicyId: boundedString(source.webSearchQueryPolicyId || "provider_hosted_web_search_query_policy@pending", 180),
    imagePromptPolicyId: boundedString(source.imagePromptPolicyId || "provider_hosted_image_prompt_policy@pending", 180),
    usageAttributionPolicyId: boundedString(source.usageAttributionPolicyId || "provider_hosted_usage_attribution@pending", 180),
    rawExposureScannerId: boundedString(source.rawExposureScannerId || "provider_hosted_raw_exposure_scanner@pending", 180),
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    createdAt: generatedAt,
    expiresAt: boundedString(source.expiresAt, 80),
  };
  snapshot.activationId = snapshot.activationId || `provider_hosted_activation_${digestFor("provider-hosted-activation-source@1", snapshot).slice(0, 24)}`;
  snapshot.declarationDigest = digestFor("provider-hosted-activation-declaration@1", {
    activationId: snapshot.activationId,
    activationReadyTools: snapshot.activationReadyTools,
    declarationDecisions: snapshot.declarationDecisions,
    declarationPolicyDigest: snapshot.declarationPolicy.policyDigest,
  });
  snapshot.activationDigest = digestFor("provider-hosted-activation-snapshot@1", snapshot);
  return snapshot;
}

function buildProviderHostedWebSearchQueryPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA,
    policyId: boundedString(source.policyId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    maxQueryChars: normalizePositiveInteger(source.maxQueryChars, 512),
    maxQueriesPerTurn: normalizePositiveInteger(source.maxQueriesPerTurn, 3),
    allowedQueryKinds: normalizeStringList(source.allowedQueryKinds, ["single_query", "followup_query", "site_scoped_query"])
      .filter((kind) => WEB_SEARCH_QUERY_KINDS.has(kind)),
    disallowedQueryClasses: normalizeStringList(source.disallowedQueryClasses, ["credentialed_url", "raw_secret", "private_file_path", "raw_provider_payload", "unbounded_personal_data"])
      .filter((kind) => RAW_EXPOSURE_FINDINGS.has(kind)),
    operatorConfirmationRequired: normalizeBoolean(source.operatorConfirmationRequired, false),
    rawQueryStored: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  if (!policy.allowedQueryKinds.length) policy.allowedQueryKinds = ["single_query"];
  policy.policyId = policy.policyId || `provider_hosted_web_query_policy_${digestFor("provider-hosted-web-query-policy-source@1", policy).slice(0, 24)}`;
  policy.policyDigest = digestFor("provider-hosted-web-query-policy@1", policy);
  return policy;
}

function buildProviderHostedImagePromptPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const retention = normalizeEnum(source.rawPromptRetention, new Set(["digest_only", "redacted_preview", "private_artifact", "not_stored"]), "digest_only");
  const policy = {
    schema: PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA,
    policyId: boundedString(source.policyId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    maxPromptChars: normalizePositiveInteger(source.maxPromptChars, 1200),
    allowProjectContext: normalizeBoolean(source.allowProjectContext, false),
    allowFileContentInPrompt: normalizeBoolean(source.allowFileContentInPrompt, false),
    allowPersonalData: normalizeBoolean(source.allowPersonalData, false),
    operatorGateRequired: normalizeBoolean(source.operatorGateRequired, true),
    rawPromptRetention: retention,
    rawPromptStored: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  policy.policyId = policy.policyId || `provider_hosted_image_prompt_policy_${digestFor("provider-hosted-image-prompt-policy-source@1", policy).slice(0, 24)}`;
  policy.policyDigest = digestFor("provider-hosted-image-prompt-policy@1", policy);
  return policy;
}

function detectRawExposureFindings(text, { maxChars = 1000, disallowed = [] } = {}) {
  const value = normalizeString(text, "");
  const disallowedSet = new Set(disallowed);
  const findings = [];
  function maybeAdd(kind, condition) {
    if (condition && (kind === "oversized_input" || !disallowedSet.size || disallowedSet.has(kind))) findings.push(kind);
  }
  maybeAdd("credentialed_url", CREDENTIAL_URL_PATTERN.test(value));
  maybeAdd("raw_secret", SECRET_PATTERN.test(value));
  maybeAdd("private_file_path", PRIVATE_PATH_PATTERN.test(value));
  maybeAdd("raw_provider_payload", PROVIDER_PAYLOAD_PATTERN.test(value));
  maybeAdd("unbounded_personal_data", PERSONAL_DATA_PATTERN.test(value));
  maybeAdd("oversized_input", value.length > maxChars);
  return [...new Set(findings)];
}

function trustedRawExposureScan(scan, { toolKind, inputText }) {
  if (scan?.schema !== PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA) return null;
  if (scan.toolKind !== toolKind) return null;
  if (scan.inputDigest !== inputDigestFor(inputText)) return null;
  return scan;
}

function buildProviderHostedRawExposureScan(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const policy = isPlainObject(source.policy) ? source.policy : {};
  const maxChars = toolKind === "web_search"
    ? normalizePositiveInteger(policy.maxQueryChars, 512)
    : normalizePositiveInteger(policy.maxPromptChars, 1200);
  const disallowed = toolKind === "web_search"
    ? normalizeStringList(policy.disallowedQueryClasses, ["credentialed_url", "raw_secret", "private_file_path", "raw_provider_payload", "unbounded_personal_data"])
    : ["credentialed_url", "raw_secret", "private_file_path", "raw_provider_payload"];
  const findings = detectRawExposureFindings(source.inputText, { maxChars, disallowed });
  const scan = {
    schema: PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA,
    scanId: boundedString(source.scanId || "", 180),
    toolKind,
    inputDigest: inputDigestFor(source.inputText),
    findingClasses: findings,
    blockerClasses: findings,
    redactionState: findings.length ? "blocked" : "passed",
    rawInputIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    scannedAt: normalizeString(source.scannedAt, nowIso(source.nowMs)),
  };
  scan.scanId = scan.scanId || `provider_hosted_raw_scan_${toolKind}_${digestFor("provider-hosted-raw-scan-source@1", scan).slice(0, 24)}`;
  scan.scanDigest = digestFor("provider-hosted-raw-exposure-scan@1", scan);
  return scan;
}

function buildProviderHostedWebSearchQueryEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = source.queryPolicy?.schema === PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA
    ? source.queryPolicy
    : buildProviderHostedWebSearchQueryPolicy({
      projectId: source.projectId,
      workThreadId: source.workThreadId,
      nowMs: source.nowMs,
      ...source.queryPolicy,
    });
  const queryText = normalizeString(source.queryText || source.inputText, "");
  const suppliedScan = trustedRawExposureScan(source.rawExposureScan, { toolKind: "web_search", inputText: queryText });
  const scan = suppliedScan
    ? suppliedScan
    : buildProviderHostedRawExposureScan({ toolKind: "web_search", inputText: queryText, policy, nowMs: source.nowMs });
  const redactionState = normalizeEnum(scan.redactionState, REDACTION_STATES, "blocked");
  const envelope = {
    schema: PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA,
    queryEnvelopeId: boundedString(source.queryEnvelopeId || "", 180),
    callId: boundedString(source.callId, 180),
    queryDigest: scan.inputDigest,
    queryPreview: redactionState === "passed" ? boundedString(queryText, Math.min(160, policy.maxQueryChars)) : "",
    queryKind: normalizeEnum(source.queryKind, WEB_SEARCH_QUERY_KINDS, "single_query"),
    queryPolicyId: policy.policyId,
    queryPolicyDigest: policy.policyDigest,
    rawExposureScanRef: normalizeEvidenceRef({
      kind: "provider_hosted_raw_exposure_scan",
      id: scan.scanId,
      digest: scan.scanDigest,
      label: "web_search query scan",
      confidence: scan.redactionState,
    }, "provider_hosted_raw_exposure_scan"),
    rawQueryStored: false,
    rawSecretsDetected: arrayOrEmpty(scan.findingClasses).includes("raw_secret"),
    redactionState,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  envelope.queryEnvelopeId = envelope.queryEnvelopeId || `provider_hosted_web_query_${digestFor("provider-hosted-web-query-envelope-source@1", envelope).slice(0, 24)}`;
  envelope.envelopeDigest = digestFor("provider-hosted-web-search-query-envelope@1", envelope);
  return { envelope, policy, scan };
}

function buildProviderHostedImagePromptEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = source.promptPolicy?.schema === PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA
    ? source.promptPolicy
    : buildProviderHostedImagePromptPolicy({
      projectId: source.projectId,
      workThreadId: source.workThreadId,
      nowMs: source.nowMs,
      ...source.promptPolicy,
    });
  const promptText = normalizeString(source.promptText || source.inputText, "");
  const suppliedScan = trustedRawExposureScan(source.rawExposureScan, { toolKind: "image_generation", inputText: promptText });
  const scan = suppliedScan
    ? suppliedScan
    : buildProviderHostedRawExposureScan({ toolKind: "image_generation", inputText: promptText, policy, nowMs: source.nowMs });
  const redactionState = normalizeEnum(scan.redactionState, REDACTION_STATES, "blocked");
  const envelope = {
    schema: PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA,
    promptEnvelopeId: boundedString(source.promptEnvelopeId || "", 180),
    callId: boundedString(source.callId, 180),
    promptDigest: scan.inputDigest,
    promptPreview: policy.rawPromptRetention === "redacted_preview" && redactionState === "passed" ? boundedString(promptText, Math.min(160, policy.maxPromptChars)) : "",
    promptPolicyId: policy.policyId,
    promptPolicyDigest: policy.policyDigest,
    rawExposureScanRef: normalizeEvidenceRef({
      kind: "provider_hosted_raw_exposure_scan",
      id: scan.scanId,
      digest: scan.scanDigest,
      label: "image_generation prompt scan",
      confidence: scan.redactionState,
    }, "provider_hosted_raw_exposure_scan"),
    rawPromptStored: false,
    rawSecretsDetected: arrayOrEmpty(scan.findingClasses).includes("raw_secret"),
    redactionState,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  envelope.promptEnvelopeId = envelope.promptEnvelopeId || `provider_hosted_image_prompt_${digestFor("provider-hosted-image-prompt-envelope-source@1", envelope).slice(0, 24)}`;
  envelope.envelopeDigest = digestFor("provider-hosted-image-prompt-envelope@1", envelope);
  return { envelope, policy, scan };
}

function findActivationDecision(snapshot = {}, toolKind, invocationMode) {
  return arrayOrEmpty(snapshot.declarationDecisions)
    .find((decision) => decision?.toolKind === toolKind && decision?.invocationMode === invocationMode) || null;
}

function authorityDecisionFromActivation({ activationSnapshot = {}, toolKind, invocationMode, callSurface, caller, scan, inputPolicy, nowMs }) {
  if (invocationMode === "operator_triggered_provider_operation" && (callSurface !== "operator_ui" || caller !== "operator")) {
    return { authorityDecision: "blocked_operator_gate_required", blocker: "operator_invocation_requires_operator_surface" };
  }
  if (!isPlainObject(activationSnapshot) || activationSnapshot.schema !== PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA) {
    return { authorityDecision: "blocked_missing_declaration", blocker: "missing_activation_snapshot" };
  }
  if (!timestampIsFresh(activationSnapshot.expiresAt, nowMs)) {
    return { authorityDecision: "blocked_stale_declaration", blocker: "stale_activation_snapshot" };
  }
  if (!activationSnapshot.resultAdmissionPolicyId) {
    return { authorityDecision: "blocked_missing_result_policy", blocker: "missing_result_admission_policy" };
  }
  if (scan?.redactionState === "blocked") {
    const blockerClasses = arrayOrEmpty(scan.blockerClasses).filter(Boolean);
    return { authorityDecision: "blocked_raw_exposure_risk", blocker: blockerClasses.join(",") || "raw_exposure_risk" };
  }
  if (toolKind === "web_search" && !inputPolicy?.policyId) {
    return { authorityDecision: "blocked_missing_result_policy", blocker: "missing_query_policy" };
  }
  if (toolKind === "image_generation" && !inputPolicy?.policyId) {
    return { authorityDecision: "blocked_missing_result_policy", blocker: "missing_prompt_policy" };
  }
  const decision = findActivationDecision(activationSnapshot, toolKind, invocationMode);
  if (!decision) return { authorityDecision: "blocked_missing_declaration", blocker: "missing_declaration_decision" };
  if (decision.callable === true) return { authorityDecision: "allowed", blocker: "" };
  if (decision.decision === "blocked_unknown_capability") return { authorityDecision: "blocked_unknown_capability", blocker: decision.blocker || decision.decision };
  if (decision.decision === "blocked_unsupported") return { authorityDecision: "blocked_unsupported", blocker: decision.blocker || decision.decision };
  if (decision.decision === "blocked_stale_request_shape_proof") return { authorityDecision: "blocked_stale_declaration", blocker: decision.blocker || decision.decision };
  if (decision.decision === "blocked_operator_gate_required") return { authorityDecision: "blocked_operator_gate_required", blocker: decision.blocker || decision.decision };
  return { authorityDecision: "blocked_missing_declaration", blocker: decision.blocker || decision.decision };
}

function buildProviderHostedToolCallEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const callSurface = normalizeEnum(source.callSurface, CALL_SURFACES, toolKind === "image_generation" ? "operator_ui" : "resident_tool");
  const invocationMode = normalizeEnum(
    source.invocationMode,
    INVOCATION_MODES,
    callSurface === "operator_ui"
      ? "operator_triggered_provider_operation"
      : callSurface === "headless_route"
        ? "headless_route_provider_operation"
        : "model_mediated_provider_tool",
  );
  const callId = boundedString(source.callId || "", 180) || `provider_hosted_call_${toolKind}_${digestFor("provider-hosted-call-source@1", {
    toolKind,
    invocationMode,
    callSurface,
    turnId: source.turnId,
    inputText: source.inputText || source.queryText || source.promptText,
  }).slice(0, 24)}`;
  const inputBundle = toolKind === "web_search"
    ? buildProviderHostedWebSearchQueryEnvelope({ ...source, callId })
    : buildProviderHostedImagePromptEnvelope({ ...source, callId });
  const sideEffectClass = toolKind === "web_search" ? "external_epistemic_read" : "generated_artifact_production";
  const inputPolicy = inputBundle.policy;
  const scan = inputBundle.scan;
  const activation = isPlainObject(source.activationSnapshot) ? source.activationSnapshot : {};
  const caller = normalizeEnum(source.caller, new Set(["resident", "operator", "headless", "system"]), callSurface === "operator_ui" ? "operator" : "resident");
  const authority = authorityDecisionFromActivation({
    activationSnapshot: activation,
    toolKind,
    invocationMode,
    callSurface,
    caller,
    scan,
    inputPolicy,
    nowMs: source.nowMs,
  });
  const decision = findActivationDecision(activation, toolKind, invocationMode);
  const envelope = {
    schema: PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA,
    callId,
    toolKind,
    invocationMode,
    callSurface,
    workThreadId: boundedString(source.workThreadId || activation.workThreadId, 160),
    turnId: boundedString(source.turnId, 180),
    agentId: boundedString(source.agentId, 180),
    activationId: boundedString(activation.activationId, 180),
    activationDigest: boundedString(activation.activationDigest, 180),
    declarationDigest: boundedString(activation.declarationDigest, 180),
    caller,
    sideEffectClass: normalizeEnum(sideEffectClass, HOSTED_SIDE_EFFECT_CLASSES, "external_epistemic_read"),
    authorityDecision: normalizeEnum(authority.authorityDecision, AUTHORITY_DECISIONS, "blocked_missing_declaration"),
    blocker: boundedString(authority.blocker, 220),
    replayPolicy: {
      mayAutoRetry: false,
      requiresFreshOperatorIntent: toolKind === "image_generation" || callSurface === "operator_ui",
      idempotencyKey: boundedString(source.idempotencyKey || digestFor("provider-hosted-call-idempotency@1", { toolKind, invocationMode, callSurface, turnId: source.turnId, inputDigest: scan.inputDigest }).slice(0, 40), 80),
    },
    inputEvidenceRef: normalizeEvidenceRef({
      kind: toolKind === "web_search" ? "provider_hosted_web_search_query_envelope" : "provider_hosted_image_prompt_envelope",
      id: inputBundle.envelope.queryEnvelopeId || inputBundle.envelope.promptEnvelopeId,
      digest: inputBundle.envelope.envelopeDigest,
      label: toolKind === "web_search" ? "web_search query envelope" : "image_generation prompt envelope",
      confidence: inputBundle.envelope.redactionState,
    }, "provider_hosted_input_envelope"),
    requestShapeProofId: boundedString(decision?.proofId, 180),
    requestShapeProofDigest: boundedString(decision?.proofDigest, 180),
    inputPolicyId: boundedString(inputPolicy.policyId, 180),
    inputPolicyDigest: boundedString(inputPolicy.policyDigest, 180),
    outboundDisclosureScanRef: normalizeEvidenceRef({
      kind: "provider_hosted_raw_exposure_scan",
      id: scan.scanId,
      digest: scan.scanDigest,
      label: "hosted outbound disclosure scan",
      confidence: scan.redactionState,
    }, "provider_hosted_raw_exposure_scan"),
    inputEnvelope: inputBundle.envelope,
    rawPromptIncluded: false,
    rawQueryIncluded: false,
    rawProviderPayloadIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    providerTransportAllowed: false,
    providerHostedToolCallAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  envelope.callDigest = digestFor("provider-hosted-tool-call-envelope@1", envelope);
  return envelope;
}

function buildProviderHostedWebSearchResultEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const callEnvelope = source.callEnvelope?.schema === PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA ? source.callEnvelope : {};
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const retrievedAt = normalizeIsoTimestamp(source.retrievedAt, generatedAt);
  const limits = normalizeWebSearchLimits(source.webSearchLimits || source.limits);
  const sourceRefs = arrayOrEmpty(source.sourceRefs || source.sources)
    .map((entry, index) => normalizeWebSearchSourceRef(entry, index, retrievedAt))
    .filter(Boolean)
    .slice(0, limits.maxSources);
  const droppedSourceCount = Math.max(0, arrayOrEmpty(source.sourceRefs || source.sources).length - sourceRefs.length);
  const callAllowed = callEnvelope.toolKind === "web_search" && callEnvelope.authorityDecision === "allowed";
  const providerResultRef = boundedString(source.providerResultRef || "", 180);
  const requestedSourceIds = Array.isArray(source.admittedSourceIds)
    ? normalizeStringList(source.admittedSourceIds, [])
    : sourceRefs.map((ref) => ref.sourceId);
  const sourceIds = new Set(sourceRefs.map((ref) => ref.sourceId));
  const admittedSourceIds = requestedSourceIds.filter((id) => sourceIds.has(id));
  const missingSourceIds = requestedSourceIds.filter((id) => !sourceIds.has(id));
  const redactionState = callAllowed && sourceRefs.length && admittedSourceIds.length && providerResultRef && !missingSourceIds.length ? "not_needed" : "blocked";
  const summaryKind = normalizeEnum(
    source.resultSummary || source.summary ? source.summaryKind : "none",
    WEB_SEARCH_SUMMARY_KINDS,
    source.resultSummary || source.summary ? "provider_reported_summary" : "none",
  );
  const summaryAuthority = summaryKind === "none"
    ? "diagnostic"
    : normalizeEnum(source.summaryAuthority, WEB_SEARCH_SUMMARY_AUTHORITIES, "external_evidence_summary");
  const envelope = {
    schema: PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA,
    resultId: boundedString(source.resultId || "", 180),
    toolKind: "web_search",
    callId: boundedString(source.callId || callEnvelope.callId, 180),
    workThreadId: boundedString(source.workThreadId || callEnvelope.workThreadId, 160),
    turnId: boundedString(source.turnId || callEnvelope.turnId, 180),
    providerResultRef,
    queryDigest: boundedString(source.queryDigest || callEnvelope.inputEnvelope?.queryDigest, 180),
    queryPreview: redactionState === "not_needed" ? boundedString(source.queryPreview || callEnvelope.inputEnvelope?.queryPreview, 160) : "",
    retrievedAt,
    freshnessPosture: normalizeEnum(source.freshnessPosture, WEB_SEARCH_FRESHNESS_POSTURES, "current_at_retrieval"),
    sourceRefs,
    droppedSourceCount,
    resultSummary: summaryKind === "none" || redactionState === "blocked" ? "" : boundedString(source.resultSummary || source.summary, limits.maxSummaryChars),
    summaryKind,
    summaryAuthority,
    webSearchLimits: limits,
    citationParity: {
      admittedSourceIds,
      missingSourceIds,
      inventedCitationDetected: missingSourceIds.length > 0,
    },
    quotePolicy: {
      verbatimLimitApplied: true,
      maxExcerptChars: limits.maxExcerptChars,
      rawPageContentIncluded: false,
    },
    blockerCodes: [
      ...(callAllowed ? [] : ["call_not_allowed"]),
      ...(providerResultRef ? [] : ["provider_result_ref_missing"]),
      ...(sourceRefs.length ? [] : ["source_refs_missing"]),
      ...(admittedSourceIds.length ? [] : ["admitted_source_refs_missing"]),
      ...(missingSourceIds.length ? ["citation_parity_missing_source"] : []),
    ],
    redactionState,
    rawProviderPayloadIncluded: false,
    rawPageContentIncluded: false,
    rawQueryIncluded: false,
    rawSecretIncluded: false,
    contextAdmission: source.contextAdmission?.schema === PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA
      ? resultAdmissionRef(source.contextAdmission)
      : undefined,
    createdAt: generatedAt,
  };
  envelope.resultId = envelope.resultId || `provider_hosted_web_result_${digestFor("provider-hosted-web-result-source@1", envelope).slice(0, 24)}`;
  envelope.resultDigest = digestFor("provider-hosted-web-search-result-envelope@1", envelope);
  return envelope;
}

function buildProviderHostedResultContextAdmission(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = source.resultEnvelope?.schema === PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA ? source.resultEnvelope : {};
  const requestedKind = normalizeEnum(source.admissionKind, CONTEXT_ADMISSION_KINDS, "summary");
  const hasSources = arrayOrEmpty(result.sourceRefs).length > 0;
  const resultBlocked = result.redactionState === "blocked" || arrayOrEmpty(result.blockerCodes).length > 0;
  let admissionKind = requestedKind;
  let admissionDecision = "admit";
  if (!result?.schema) {
    admissionKind = "blocked";
    admissionDecision = "block_policy";
  } else if (result.redactionState === "blocked") {
    admissionKind = "blocked";
    admissionDecision = "block_raw_exposure";
  } else if (!hasSources) {
    admissionKind = "blocked";
    admissionDecision = "block_source_unknown";
  } else if (requestedKind === "bounded_excerpt" && result.quotePolicy?.rawPageContentIncluded !== false) {
    admissionKind = "blocked";
    admissionDecision = "block_policy";
  } else if (requestedKind === "artifact_ref") {
    admissionKind = "blocked";
    admissionDecision = "block_policy";
  } else if (requestedKind === "blocked") {
    admissionDecision = "block_policy";
  } else if (resultBlocked) {
    admissionKind = "blocked";
    admissionDecision = "block_policy";
  } else if (requestedKind === "bounded_excerpt") {
    admissionDecision = "admit_degraded";
  }
  if (normalizeEnum(source.admissionDecision, CONTEXT_ADMISSION_DECISIONS, admissionDecision) === "not_requested") {
    admissionKind = "blocked";
    admissionDecision = "not_requested";
  }
  const residentContext = admissionDecision === "admit" || admissionDecision === "admit_degraded"
    ? admissionKind === "source_refs"
      ? "source_refs"
      : admissionKind === "bounded_excerpt"
        ? "bounded_excerpt"
        : "summary"
    : "none";
  const operatorProjection = admissionDecision === "admit" || admissionDecision === "admit_degraded"
    ? admissionKind === "source_refs" ? "source_refs" : "summary"
    : "none";
  const providerContinuation = admissionDecision === "admit" || admissionDecision === "admit_degraded"
    ? admissionKind === "source_refs" ? "source_refs" : "summary_only"
    : "not_sent";
  const admission = {
    schema: PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA,
    admissionId: boundedString(source.admissionId || "", 180),
    resultId: boundedString(source.resultId || result.resultId, 180),
    toolKind: normalizeEnum(source.toolKind || result.toolKind, TOOL_KINDS, "web_search"),
    workThreadId: boundedString(source.workThreadId || result.workThreadId, 160),
    turnId: boundedString(source.turnId || result.turnId, 180),
    admissionKind,
    admissionDecision,
    visibility: {
      residentContext: normalizeEnum(residentContext, RESIDENT_CONTEXT_VISIBILITIES, "none"),
      operatorProjection: normalizeEnum(operatorProjection, OPERATOR_PROJECTION_VISIBILITIES, "none"),
      providerContinuation: normalizeEnum(providerContinuation, PROVIDER_CONTINUATION_VISIBILITIES, "not_sent"),
      usageLedger: true,
    },
    admittedSourceIds: admissionDecision === "admit" || admissionDecision === "admit_degraded"
      ? arrayOrEmpty(result.citationParity?.admittedSourceIds)
      : [],
    trustWarning: boundedString(source.trustWarning || "Provider-hosted web-search result is external evidence, not project truth or durable memory.", 320),
    freshnessWarning: result.freshnessPosture === "current_at_retrieval"
      ? ""
      : boundedString(source.freshnessWarning || "Web-search result freshness is uncertain; re-query before relying on time-sensitive claims.", 320),
    rawPayloadIncluded: false,
    rawPageContentIncluded: false,
    rawProviderPayloadIncluded: false,
    memoryCandidateCreated: false,
    durableMemoryAdmission: false,
    projectTruthGranted: false,
    workspaceMutationAllowed: false,
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  admission.admissionId = admission.admissionId || `provider_hosted_context_admission_${digestFor("provider-hosted-result-context-admission-source@1", admission).slice(0, 24)}`;
  admission.admissionDigest = digestFor("provider-hosted-result-context-admission@1", admission);
  return admission;
}

function buildWebSearchEvidenceContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = {
    schema: PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
    contractId: boundedString(source.contractId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    resultPosture: "external_epistemic_evidence",
    requiredFields: ["query_digest", "retrieved_at", "source_refs", "citation_policy", "staleness_policy", "provider_result_ref"],
    sourcePolicy: {
      sourceUrlsRequired: true,
      retrievalTimeRequired: true,
      titleSnippetAllowed: true,
      rawPageContentAllowed: false,
      credentialedUrlAllowed: false,
      citationRequiredForContextUse: true,
    },
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_web_search_evidence_contract"),
    providerHostedToolCallAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawQueryIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawPageContentIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  contract.contractId = contract.contractId || `web_search_contract_${digestFor("web-search-contract-source@1", contract).slice(0, 24)}`;
  contract.contractDigest = digestFor("provider-web-search-evidence-contract@1", contract);
  return contract;
}

function buildImageGenerationArtifactContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = {
    schema: PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
    contractId: boundedString(source.contractId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    resultPosture: "generated_artifact",
    requiredFields: ["prompt_digest", "asset_ref", "created_at", "model_ref", "storage_policy", "safety_metadata_ref"],
    artifactPolicy: {
      assetStorageRequired: true,
      promptEvidenceRequired: true,
      metadataRedactionRequired: true,
      rawPromptStorageAllowed: false,
      rawImageBytesInRendererAllowed: false,
      workspaceMutationRequiresSeparateStaging: true,
    },
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_image_generation_artifact_contract"),
    providerHostedToolCallAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawImageBytesIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  contract.contractId = contract.contractId || `image_generation_contract_${digestFor("image-generation-contract-source@1", contract).slice(0, 24)}`;
  contract.contractDigest = digestFor("provider-image-generation-artifact-contract@1", contract);
  return contract;
}

function buildProviderHostedToolsStatus(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId || source.providerMetadataProfile?.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : [
    { toolKind: "web_search", providerMetadataProfile: source.providerMetadataProfile },
    { toolKind: "image_generation", providerMetadataProfile: source.providerMetadataProfile },
  ]).map((capability) => buildProviderHostedToolCapability({
    projectId,
    workThreadId,
    generatedAt,
    ...capability,
  }));
  const webSearchContract = source.webSearchContract?.schema === PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA
    ? source.webSearchContract
    : buildWebSearchEvidenceContract({ projectId, workThreadId, generatedAt });
  const imageGenerationContract = source.imageGenerationContract?.schema === PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA
    ? source.imageGenerationContract
    : buildImageGenerationArtifactContract({ projectId, workThreadId, generatedAt });
  const activationSnapshot = source.activationSnapshot?.schema === PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA
    ? source.activationSnapshot
    : buildProviderHostedActivationSnapshot({
      projectId,
      workThreadId,
      generatedAt,
      providerMetadataProfile: source.providerMetadataProfile,
      providerProfileDigest: source.providerMetadataProfile?.profileDigest || source.providerMetadataDigest,
      providerRuntimeRef: source.providerRuntimeRef,
      modelRef: source.modelRef,
      requestShapeProofs: source.requestShapeProofs,
      capabilities,
      declarationPolicy: source.declarationPolicy,
      nowMs: source.nowMs,
      expiresAt: source.expiresAt,
    });
  const supportedCount = capabilities.filter((capability) => ["accepted", "runtime_probed", "profile_declared", "known_available_unprobed"].includes(capability.evidenceState)).length;
  const status = {
    schema: PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
    statusId: boundedString(source.statusId || "", 180),
    projectId,
    workThreadId,
    status: boundedString(source.status || "provider_hosted_boundary_only", 120),
    capabilityCount: capabilities.length,
    supportedCount,
    unsupportedCount: capabilities.filter((capability) => capability.evidenceState === "unsupported").length,
    unknownCount: capabilities.filter((capability) => capability.evidenceState === "unknown").length,
    capabilities,
    webSearchContract,
    imageGenerationContract,
    declarationPolicy: activationSnapshot.declarationPolicy,
    activationSnapshot,
    activationSnapshotDigest: boundedString(activationSnapshot.activationDigest, 180),
    activationReadyCount: activationSnapshot.activationReadyTools.length,
    declarationDecisionCount: activationSnapshot.declarationDecisions.length,
    blockedDecisionCount: activationSnapshot.declarationDecisions.filter((decision) => decision.callable !== true).length,
    providerMetadataDigest: boundedString(source.providerMetadataProfile?.profileDigest || source.providerMetadataDigest, 180),
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: "Provider-hosted web search and image generation are activation-gated; request-shape proof is required before any future hosted tool declaration.",
    generatedAt,
  };
  status.statusId = status.statusId || `provider_hosted_tools_${digestFor("provider-hosted-tools-status-source@1", status).slice(0, 24)}`;
  status.statusDigest = digestFor("provider-hosted-tools-status@1", status);
  return status;
}

function assertProviderHostedToolsStatusSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA) {
    throw new Error("provider_hosted_tools_status_schema_mismatch");
  }
  for (const flag of [
    "providerToolDeclarationAllowed",
    "providerHostedToolCallAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "contextInjectionAllowed",
    "workspaceMutationAllowed",
    "rawProviderPayloadIncluded",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawSecretIncluded",
  ]) {
    if (status[flag] !== false) throw new Error(`provider_hosted_tools_authority_leak:${flag}`);
  }
  for (const capability of arrayOrEmpty(status.capabilities)) {
    if (capability.schema !== PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA) throw new Error("provider_hosted_tool_capability_schema_mismatch");
    for (const flag of [
      "providerToolDeclarationAllowed",
      "providerHostedToolCallAllowed",
      "providerTransportAllowed",
      "requestShapeMutationAllowed",
      "contextInjectionAllowed",
      "workspaceMutationAllowed",
      "rawProviderPayloadIncluded",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawSecretIncluded",
    ]) {
      if (capability[flag] !== false) throw new Error(`provider_hosted_tool_capability_authority_leak:${capability.toolKind}:${flag}`);
    }
  }
  const activationSnapshot = status.activationSnapshot;
  if (!isPlainObject(activationSnapshot) || activationSnapshot.schema !== PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA) {
    throw new Error("provider_hosted_activation_snapshot_schema_mismatch");
  }
  for (const flag of [
    "providerToolDeclarationAllowed",
    "providerHostedToolCallAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "contextInjectionAllowed",
    "workspaceMutationAllowed",
    "rawProviderPayloadIncluded",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawSecretIncluded",
  ]) {
    if (activationSnapshot[flag] !== false) throw new Error(`provider_hosted_activation_authority_leak:${flag}`);
  }
  for (const proof of arrayOrEmpty(activationSnapshot.requestShapeProofs)) {
    if (proof.schema !== PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA) throw new Error("provider_hosted_request_shape_proof_schema_mismatch");
    for (const flag of ["rawProviderPayloadIncluded", "rawPromptIncluded", "rawResultIncluded", "rawSecretIncluded"]) {
      if (proof[flag] !== false) throw new Error(`provider_hosted_request_shape_authority_leak:${flag}`);
    }
  }
  const policy = activationSnapshot.declarationPolicy;
  if (!isPlainObject(policy) || policy.schema !== PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA) {
    throw new Error("provider_hosted_declaration_policy_schema_mismatch");
  }
  if (policy.profileDeclaredCallable !== false || policy.knownAvailableUnprobedCallable !== false || policy.requestShapeProofRequired !== true) {
    throw new Error("provider_hosted_declaration_policy_unsafe");
  }
  for (const contract of [status.webSearchContract, status.imageGenerationContract]) {
    if (!isPlainObject(contract)) throw new Error("provider_hosted_contract_missing");
    if (![PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA, PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA].includes(contract.schema)) {
      throw new Error(`provider_hosted_contract_schema_mismatch:${contract.schema || "missing"}`);
    }
    for (const flag of [
      "providerHostedToolCallAllowed",
      "contextInjectionAllowed",
      "workspaceMutationAllowed",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawProviderPayloadIncluded",
      "rawSecretIncluded",
    ]) {
      if (contract[flag] !== false) throw new Error(`provider_hosted_contract_authority_leak:${contract.schema}:${flag}`);
    }
    const contractSpecificFlags = contract.schema === PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA
      ? ["rawQueryIncluded", "rawPageContentIncluded"]
      : ["rawImageBytesIncluded"];
    for (const flag of contractSpecificFlags) {
      if (contract[flag] !== false) throw new Error(`provider_hosted_contract_authority_leak:${contract.schema}:${flag}`);
    }
  }
  return true;
}

function assertProviderHostedToolCallEnvelopeSafe(envelope = {}) {
  if (!isPlainObject(envelope) || envelope.schema !== PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA) {
    throw new Error("provider_hosted_tool_call_envelope_schema_mismatch");
  }
  for (const flag of [
    "rawPromptIncluded",
    "rawQueryIncluded",
    "rawProviderPayloadIncluded",
    "rawResultIncluded",
    "rawSecretIncluded",
    "providerTransportAllowed",
    "providerHostedToolCallAllowed",
    "contextInjectionAllowed",
    "workspaceMutationAllowed",
  ]) {
    if (envelope[flag] !== false) throw new Error(`provider_hosted_call_envelope_authority_leak:${flag}`);
  }
  if (!isPlainObject(envelope.replayPolicy) || envelope.replayPolicy.mayAutoRetry !== false) {
    throw new Error("provider_hosted_call_replay_policy_unsafe");
  }
  if (!isPlainObject(envelope.inputEnvelope)) throw new Error("provider_hosted_call_input_envelope_missing");
  const expectedInputSchema = envelope.toolKind === "web_search"
    ? PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA
    : PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA;
  if (envelope.inputEnvelope.schema !== expectedInputSchema) {
    throw new Error(`provider_hosted_call_input_envelope_schema_mismatch:${envelope.inputEnvelope.schema || "missing"}`);
  }
  if (envelope.inputEnvelope.redactionState === "blocked" && envelope.authorityDecision !== "blocked_raw_exposure_risk") {
    throw new Error("provider_hosted_call_raw_block_not_reflected");
  }
  if (envelope.inputEnvelope.redactionState !== "passed") {
    if (envelope.inputEnvelope.queryPreview) throw new Error("provider_hosted_call_blocked_query_preview_leak");
    if (envelope.inputEnvelope.promptPreview) throw new Error("provider_hosted_call_blocked_prompt_preview_leak");
  }
  return true;
}

function assertProviderHostedWebSearchResultEnvelopeSafe(envelope = {}) {
  if (!isPlainObject(envelope) || envelope.schema !== PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA) {
    throw new Error("provider_hosted_web_search_result_envelope_schema_mismatch");
  }
  for (const flag of ["rawProviderPayloadIncluded", "rawPageContentIncluded", "rawQueryIncluded", "rawSecretIncluded"]) {
    if (envelope[flag] !== false) throw new Error(`provider_hosted_web_result_authority_leak:${flag}`);
  }
  if (envelope.toolKind !== "web_search") throw new Error("provider_hosted_web_result_tool_kind_mismatch");
  if (envelope.redactionState === "not_needed") {
    if (!envelope.providerResultRef) throw new Error("provider_hosted_web_result_provider_ref_missing");
    if (!arrayOrEmpty(envelope.sourceRefs).length) throw new Error("provider_hosted_web_result_source_refs_missing");
  }
  for (const sourceRef of arrayOrEmpty(envelope.sourceRefs)) {
    if (!sourceRef.urlEvidenceKey || !sourceRef.urlDisplay) throw new Error("provider_hosted_web_result_source_ref_incomplete");
    if (!safeWebUrlParts(sourceRef.urlDisplay)) throw new Error("provider_hosted_web_result_unsafe_source_url");
  }
  if (envelope.citationParity?.inventedCitationDetected === true && envelope.redactionState === "not_needed") {
    throw new Error("provider_hosted_web_result_invented_citation_admitted");
  }
  if (envelope.quotePolicy?.rawPageContentIncluded !== false) {
    throw new Error("provider_hosted_web_result_raw_page_content_leak");
  }
  return true;
}

function assertProviderHostedResultContextAdmissionSafe(admission = {}) {
  if (!isPlainObject(admission) || admission.schema !== PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA) {
    throw new Error("provider_hosted_result_context_admission_schema_mismatch");
  }
  for (const flag of [
    "rawPayloadIncluded",
    "rawPageContentIncluded",
    "rawProviderPayloadIncluded",
    "memoryCandidateCreated",
    "durableMemoryAdmission",
    "projectTruthGranted",
    "workspaceMutationAllowed",
  ]) {
    if (admission[flag] !== false) throw new Error(`provider_hosted_context_admission_authority_leak:${flag}`);
  }
  if (admission.admissionDecision.startsWith("block") && admission.visibility?.residentContext !== "none") {
    throw new Error("provider_hosted_context_admission_block_visibility_leak");
  }
  if ((admission.admissionDecision === "admit" || admission.admissionDecision === "admit_degraded") && !arrayOrEmpty(admission.admittedSourceIds).length) {
    throw new Error("provider_hosted_context_admission_source_refs_missing");
  }
  return true;
}

module.exports = {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA,
  PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA,
  PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA,
  PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA,
  PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA,
  PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA,
  PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
  PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
  buildProviderHostedActivationSnapshot,
  buildProviderHostedDeclarationPolicy,
  buildProviderHostedImagePromptEnvelope,
  buildProviderHostedImagePromptPolicy,
  buildProviderHostedRawExposureScan,
  buildProviderHostedResultContextAdmission,
  buildProviderHostedRequestShapeProof,
  buildProviderHostedToolCallEnvelope,
  buildImageGenerationArtifactContract,
  buildProviderHostedToolCapability,
  buildProviderHostedToolsStatus,
  buildProviderHostedWebSearchQueryEnvelope,
  buildProviderHostedWebSearchQueryPolicy,
  buildProviderHostedWebSearchResultEnvelope,
  buildWebSearchEvidenceContract,
  assertProviderHostedResultContextAdmissionSafe,
  assertProviderHostedToolCallEnvelopeSafe,
  assertProviderHostedWebSearchResultEnvelopeSafe,
  assertProviderHostedToolsStatusSafe,
};
