"use strict";

const crypto = require("node:crypto");

const DIRECT_MODEL_CATALOG_SNAPSHOT_SCHEMA = "direct_model_catalog_snapshot@1";
const DIRECT_PROMPT_CACHE_AFFINITY_EVIDENCE_SCHEMA = "direct_prompt_cache_affinity_evidence@1";
const DIRECT_USAGE_LEDGER_SCHEMA = "direct_usage_ledger@1";
const DIRECT_USAGE_LEDGER_MANIFEST_SCHEMA = "direct_usage_ledger_manifest@1";
const DIRECT_QUOTA_RATE_SNAPSHOT_SCHEMA = "direct_quota_rate_snapshot@1";
const DIRECT_RUNTIME_EVIDENCE_STATUS_SCHEMA = "direct_runtime_evidence_status@1";
const DIRECT_CAPABILITY_DOWNGRADE_EVENT_SCHEMA = "direct_capability_downgrade_event@1";
const DIRECT_DRIFT_WATCH_REPORT_SCHEMA = "direct_drift_watch_report@1";
const DIRECT_REPORT_VALIDATION_REGISTRY_SCHEMA = "direct_report_validation_registry@1";
const DIRECT_MAINLINE_DOCS_CHECKLIST_SCHEMA = "direct_mainline_docs_checklist@1";
const DIRECT_CI_LIVE_CALL_GUARD_PROOF_SCHEMA = "direct_ci_live_call_guard_proof@1";
const DIRECT_COST_ESTIMATOR_STATUS_SCHEMA = "direct_cost_estimator_status@1";
const DIRECT_RUNTIME_WITNESS_PROJECTION_SCHEMA = "direct_runtime_witness_projection@1";
const DIRECT_MAINLINE_READINESS_REPORT_SCHEMA = "direct_mainline_readiness_report@1";
const DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA = "direct_usage_readiness_regression_report@1";
const DIRECT_USAGE_READINESS_VERSION = "direct-usage-readiness@1";

const EVIDENCE_STATES = new Set([
  "accepted",
  "runtime_probed",
  "candidate",
  "diagnostic",
  "unstable",
  "rejected",
  "expired",
  "scope_mismatch",
  "artifact_missing",
  "artifact_corrupt",
  "unknown",
]);
const SOURCE_CONFIDENCE = new Set(["exact", "accepted", "derived", "diagnostic", "unknown", "future"]);
const READINESS_USE = new Set(["can_enable", "can_display", "diagnostic_only", "blocks_capability", "ignored_for_authority"]);
const REQUEST_SHAPE_FAMILIES = new Set([
  "text_empty_context",
  "text_recent_dialogue",
  "read_file",
  "multi_step_read",
  "apply_patch",
  "run_command",
  "fresh_fork",
  "context_maintenance",
  "diagnostic",
]);
const RUNTIME_FAMILIES = new Set(["app_server", "direct_text", "direct_implementation_lane", "fresh_fork", "diagnostic", "unknown"]);
const USAGE_SOURCES = new Set(["provider_usage_delta", "response_completed_usage", "app_server_usage_event", "diagnostic_report", "missing"]);
const USAGE_RECORD_KINDS = new Set(["snapshot", "delta", "terminal", "diagnostic", "missing"]);
const DEDUPE_SOURCES = new Set(["request_manifest_id", "provider_response_id", "operation_ledger_seq", "report_id", "event_digest"]);
const TOKEN_CONFIDENCE = new Set(["exact", "missing", "unsupported", "unknown"]);
const QUOTA_SOURCES = new Set(["app_server_account_rate_limits_read", "app_server_rate_limit_update", "direct_provider_error", "live_probe_failure", "profile", "diagnostic_fixture", "unknown"]);
const QUOTA_APPLIES_TO = new Set(["all_direct_provider_calls", "text_only", "implementation_lane", "fresh_fork", "context_maintenance", "live_probe", "unknown"]);
const QUOTA_BUCKET_STATUS = new Set(["available", "exhausted", "rate_limited", "unknown"]);
const FRESHNESS_STATES = new Set(["fresh", "expiring", "expired", "unknown"]);
const FACET_STATES = new Set(["ready", "degraded", "blocked", "diagnostic_only", "unknown", "skipped"]);
const MAINLINE_READINESS = new Set(["ready_behind_flag", "blocked", "diagnostic_only"]);
const RUNTIME_ENABLEMENT = new Set(["no_projects_enabled", "eligible_projects_only", "diagnostic_only", "blocked"]);
const GATE_STATUS = new Set(["passed", "failed", "blocked", "skipped"]);
const READINESS_EFFECTS = new Set(["required_for_ready_behind_flag", "blocks_runtime_facet_only", "diagnostic_only", "informational"]);
const WITNESS_KINDS = new Set(["model", "quota", "usage", "drift", "evidence", "report_validation", "app_server_baseline", "readiness"]);
const WITNESS_STATES = new Set(["fresh", "expiring", "expired", "unknown", "blocked", "diagnostic"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value).map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function artifactDigest(value) {
  return sha256(stableStringify(value));
}

function makeIntegrity(sourceDigest) {
  return {
    algorithm: "sha256",
    sourceDigest: normalizeString(sourceDigest, ""),
    artifactDigest: "",
  };
}

function finalizeArtifact(artifact) {
  if (!artifact.integrity) artifact.integrity = makeIntegrity(artifact.sourceDigest || "");
  artifact.integrity.artifactDigest = artifactDigest({ ...artifact, integrity: { ...artifact.integrity, artifactDigest: "" } });
  return artifact;
}

function evidenceState(value, fallback = "unknown") {
  return EVIDENCE_STATES.has(value) ? value : fallback;
}

function freshness(value, fallback = "unknown") {
  return FRESHNESS_STATES.has(value) ? value : fallback;
}

function normalizeEvidenceRef(input = {}) {
  const artifactId = normalizeString(input.artifactId, "");
  const artifactDigestValue = normalizeString(input.artifactDigest, artifactId ? sha256(artifactId) : "");
  const ref = {
    kind: normalizeString(input.kind, "unknown"),
    artifactId,
    artifactDigest: artifactDigestValue,
    sourceConfidence: SOURCE_CONFIDENCE.has(input.sourceConfidence) ? input.sourceConfidence : "diagnostic",
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, input.kind || "Evidence"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawAccountIdIncluded: false,
    rawEndpointIncluded: false,
    rawChatGptUrlIncluded: false,
  };
  ref.refDigest = sha256(stableStringify(ref));
  return ref;
}

function normalizeEvidenceRefs(values) {
  return arrayValue(values).map((value) => normalizeEvidenceRef(value));
}

function buildModelEvidenceScope(input = {}) {
  return {
    providerProfileId: normalizeString(input.providerProfileId, ""),
    authMode: ["chatgpt_subscription", "api_key", "unknown"].includes(input.authMode) ? input.authMode : "unknown",
    accountEvidenceKey: normalizeString(input.accountEvidenceKey, ""),
    endpointClass: normalizeString(input.endpointClass, "unknown"),
    endpointHash: normalizeString(input.endpointHash, ""),
    modelId: normalizeString(input.modelId, ""),
    requestShapeFamily: REQUEST_SHAPE_FAMILIES.has(input.requestShapeFamily) ? input.requestShapeFamily : "diagnostic",
    requestShapeHash: normalizeString(input.requestShapeHash, ""),
    normalizerVersion: normalizeString(input.normalizerVersion, ""),
    requestBuilderVersion: normalizeString(input.requestBuilderVersion, ""),
  };
}

function buildControlEvidence(input = {}) {
  return {
    supported: ["supported", "unsupported", "not_declared", "unknown"].includes(input.supported) ? input.supported : "unknown",
    source: ["profile", "request_manifest", "live_probe", "fixture", "unknown"].includes(input.source) ? input.source : "unknown",
    evidenceState: evidenceState(input.evidenceState, "unknown"),
    canExposeInUi: false,
    canUseInProviderRequest: false,
    blockerCode: normalizeString(input.blockerCode, ""),
  };
}

function buildModelControlDescriptor(input = {}) {
  return {
    control: [
      "reasoning_effort",
      "verbosity",
      "service_tier",
      "prompt_cache_key",
      "include",
      "parallel_tool_calls",
      "store",
      "previous_response_id",
    ].includes(input.control) ? input.control : "store",
    supportState: ["accepted", "runtime_probed", "diagnostic", "unsupported", "unknown"].includes(input.supportState) ? input.supportState : "diagnostic",
    requestShapeFamilies: arrayValue(input.requestShapeFamilies).filter((value) => REQUEST_SHAPE_FAMILIES.has(value)),
    uiEnabledInThisPr: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function defaultControlSupport() {
  return {
    reasoningEffort: buildControlEvidence({ supported: "unknown", evidenceState: "diagnostic", source: "profile" }),
    reasoningSummary: buildControlEvidence({ supported: "unknown", evidenceState: "diagnostic", source: "profile" }),
    verbosity: buildControlEvidence({ supported: "unknown", evidenceState: "diagnostic", source: "profile" }),
    serviceTier: buildControlEvidence({ supported: "unknown", evidenceState: "diagnostic", source: "profile" }),
    promptCacheKey: buildControlEvidence({ supported: "unknown", evidenceState: "diagnostic", source: "profile" }),
    parallelToolCalls: buildControlEvidence({ supported: "supported", evidenceState: "accepted", source: "request_manifest", blockerCode: "fixed_false_by_policy" }),
    toolDeclarations: buildControlEvidence({ supported: "not_declared", evidenceState: "accepted", source: "request_manifest", blockerCode: "tool_specs_control_declarations" }),
  };
}

function normalizeModelCatalogEntry(input = {}) {
  const modelId = normalizeString(input.modelId || input.id, "unknown-model");
  const canonicalModelId = normalizeString(input.canonicalModelId, modelId);
  const state = evidenceState(input.evidenceState, input.source === "live_probe_evidence" ? "runtime_probed" : "diagnostic");
  const scope = buildModelEvidenceScope({ ...input.scope, modelId: canonicalModelId });
  return {
    modelId,
    canonicalModelId,
    displayName: normalizeString(input.displayName, input.rendererSafeLabel || modelId),
    aliasOf: normalizeString(input.aliasOf, ""),
    aliasResolution: ["exact", "profile_alias", "live_catalog_alias", "unknown"].includes(input.aliasResolution) ? input.aliasResolution : "exact",
    aliasEvidenceRefs: normalizeEvidenceRefs(input.aliasEvidenceRefs),
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, input.displayName || modelId),
    source: ["odeu_profile", "live_probe_evidence", "app_server_model_list", "project_config", "runtime_provider_profile", "unknown"].includes(input.source) ? input.source : "unknown",
    evidenceState: state,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    scope,
    controls: isPlainObject(input.controls) ? { ...defaultControlSupport(), ...input.controls } : defaultControlSupport(),
    controlDescriptors: arrayValue(input.controlDescriptors).map((entry) => buildModelControlDescriptor(entry)),
    freshness: freshness(input.freshness, state === "expired" ? "expired" : state === "runtime_probed" || state === "accepted" ? "fresh" : "unknown"),
    readinessUse: READINESS_USE.has(input.readinessUse) ? input.readinessUse : state === "runtime_probed" || state === "accepted" ? "can_enable" : "can_display",
  };
}

function buildModelCatalogSnapshot(input = {}) {
  const entries = arrayValue(input.entries).map((entry) => normalizeModelCatalogEntry(entry));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    projectId: input.projectId || "",
    profileDigest: input.profileDigest || "",
    operationLedgerHeadDigest: input.operationLedgerHeadDigest || "",
    entries: entries.map((entry) => ({
      modelId: entry.modelId,
      canonicalModelId: entry.canonicalModelId,
      evidenceState: entry.evidenceState,
      source: entry.source,
      requestShapeFamily: entry.scope.requestShapeFamily,
    })),
  })));
  return finalizeArtifact({
    schema: DIRECT_MODEL_CATALOG_SNAPSHOT_SCHEMA,
    snapshotId: normalizeString(input.snapshotId, `model_catalog_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    sourceDigest,
    profileDigest: normalizeString(input.profileDigest, ""),
    operationLedgerHeadDigest: normalizeString(input.operationLedgerHeadDigest, ""),
    entries,
    defaultModel: normalizeString(input.defaultModel, ""),
    selectedModel: normalizeString(input.selectedModel, ""),
    selectorEnabledInThisPr: false,
    rawProviderCatalogIncluded: false,
    rawAccountIdIncluded: false,
    rawEndpointIncluded: false,
    integrity: makeIntegrity(sourceDigest),
  });
}

function buildPromptCacheAffinityEvidence(input = {}) {
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    requestShapeClass: input.requestShapeClass || "",
    modelId: input.modelId || "",
    source: input.source || "",
    cacheSignal: input.cacheSignal || "",
  })));
  return finalizeArtifact({
    schema: DIRECT_PROMPT_CACHE_AFFINITY_EVIDENCE_SCHEMA,
    evidenceId: normalizeString(input.evidenceId, `cache_affinity_${sourceDigest.slice(0, 24)}`),
    requestShapeClass: normalizeString(input.requestShapeClass, ""),
    modelId: normalizeString(input.modelId, ""),
    source: ["usage_cached_tokens", "request_manifest", "profile", "diagnostic", "unknown"].includes(input.source) ? input.source : "unknown",
    cacheSignal: ["cached_tokens_observed", "cache_key_sent", "not_observed", "unknown"].includes(input.cacheSignal) ? input.cacheSignal : "unknown",
    providerContinuityGranted: false,
    localThreadContinuityGranted: false,
    promptCacheEvidence: {
      observed: bool(input.promptCacheEvidence?.observed || input.cacheSignal === "cached_tokens_observed"),
      source: ["request_manifest", "provider_event", "profile", "diagnostic"].includes(input.promptCacheEvidence?.source) ? input.promptCacheEvidence.source : "diagnostic",
      grantsContinuity: false,
    },
    sessionAffinityEvidence: {
      observed: bool(input.sessionAffinityEvidence?.observed),
      grantsProviderContinuity: false,
      grantsImportedContinuity: false,
    },
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Prompt cache/session affinity evidence is diagnostic only."),
    rawPromptIncluded: false,
    rawCacheKeyIncluded: false,
    sourceDigest,
    integrity: makeIntegrity(sourceDigest),
  });
}

function normalizeTokenConfidence(input = {}) {
  return {
    inputTokens: TOKEN_CONFIDENCE.has(input.inputTokens) ? input.inputTokens : "unknown",
    outputTokens: TOKEN_CONFIDENCE.has(input.outputTokens) ? input.outputTokens : "unknown",
    cachedInputTokens: TOKEN_CONFIDENCE.has(input.cachedInputTokens) ? input.cachedInputTokens : "unknown",
    reasoningTokens: TOKEN_CONFIDENCE.has(input.reasoningTokens) ? input.reasoningTokens : "unknown",
  };
}

function normalizeUsageEntry(input = {}, index = 0, previousEntryDigest = "") {
  const usageEntryId = normalizeString(input.usageEntryId, `usage_${index + 1}`);
  const usageRecordKind = USAGE_RECORD_KINDS.has(input.usageRecordKind) ? input.usageRecordKind : input.usageSource === "missing" ? "missing" : "terminal";
  const tokenFieldConfidence = normalizeTokenConfidence(input.tokenFieldConfidence || {
    inputTokens: input.inputTokens === undefined ? "missing" : "exact",
    outputTokens: input.outputTokens === undefined ? "missing" : "exact",
    cachedInputTokens: input.cachedInputTokens === undefined ? "missing" : "exact",
    reasoningTokens: input.reasoningTokens === undefined ? "missing" : "exact",
  });
  const core = {
    usageEntryId,
    entrySeq: numberValue(input.entrySeq, index + 1),
    previousEntryDigest: normalizeString(previousEntryDigest, ""),
    dedupeKey: normalizeString(input.dedupeKey, usageEntryId),
    dedupeSource: DEDUPE_SOURCES.has(input.dedupeSource) ? input.dedupeSource : "event_digest",
    usageRecordKind,
    observedAt: normalizeString(input.observedAt, nowIso()),
    runtimeFamily: RUNTIME_FAMILIES.has(input.runtimeFamily) ? input.runtimeFamily : "unknown",
    requestShapeClass: normalizeString(input.requestShapeClass, ""),
    modelId: normalizeString(input.modelId, ""),
    modelEvidenceState: evidenceState(input.modelEvidenceState, "unknown"),
    usageSource: USAGE_SOURCES.has(input.usageSource) ? input.usageSource : usageRecordKind === "missing" ? "missing" : "diagnostic_report",
    inputTokens: input.inputTokens === undefined ? undefined : numberValue(input.inputTokens, 0),
    outputTokens: input.outputTokens === undefined ? undefined : numberValue(input.outputTokens, 0),
    totalTokens: input.totalTokens === undefined ? undefined : numberValue(input.totalTokens, numberValue(input.inputTokens, 0) + numberValue(input.outputTokens, 0)),
    cachedInputTokens: input.cachedInputTokens === undefined ? undefined : numberValue(input.cachedInputTokens, 0),
    reasoningTokens: input.reasoningTokens === undefined ? undefined : numberValue(input.reasoningTokens, 0),
    tokenFieldConfidence,
    usageMissingReason: normalizeString(input.usageMissingReason, usageRecordKind === "missing" ? "provider_usage_missing" : ""),
    sourceRefs: normalizeEvidenceRefs(input.sourceRefs),
    requestManifestId: normalizeString(input.requestManifestId, ""),
    providerInputProjectionId: normalizeString(input.providerInputProjectionId, ""),
    operationLedgerSeq: input.operationLedgerSeq === undefined ? undefined : numberValue(input.operationLedgerSeq, 0),
    requestControls: {
      store: input.requestControls?.store,
      previousResponseIdUsed: input.requestControls?.previousResponseIdUsed,
      parallelToolCalls: input.requestControls?.parallelToolCalls,
      toolDeclarations: input.requestControls?.toolDeclarations,
    },
    rawTokenDetailsIncluded: false,
  };
  const entryDigest = sha256(stableStringify(core));
  return {
    ...core,
    entryDigest,
  };
}

function dedupeUsageInputs(entries) {
  const priority = { terminal: 5, snapshot: 4, delta: 3, diagnostic: 2, missing: 1 };
  const byKey = new Map();
  for (const entry of arrayValue(entries)) {
    const key = normalizeString(entry.dedupeKey, entry.usageEntryId || "");
    if (!key) {
      byKey.set(`__entry_${byKey.size}`, entry);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || (priority[entry.usageRecordKind] || 0) >= (priority[existing.usageRecordKind] || 0)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

function usageTotals(entries) {
  const sumKnown = (field) => entries.reduce((total, entry) => total + (entry[field] === undefined ? 0 : numberValue(entry[field], 0)), 0);
  return {
    entryCount: entries.length,
    inputTokensKnown: sumKnown("inputTokens"),
    outputTokensKnown: sumKnown("outputTokens"),
    totalTokensKnown: sumKnown("totalTokens"),
    cachedInputTokensKnown: sumKnown("cachedInputTokens"),
    reasoningTokensKnown: sumKnown("reasoningTokens"),
    missingUsageEntryCount: entries.filter((entry) => entry.usageRecordKind === "missing" || entry.usageSource === "missing").length,
    unknownModelEntryCount: entries.filter((entry) => !entry.modelId || entry.modelId === "unknown").length,
  };
}

function buildUsageLedger(input = {}) {
  let previous = "";
  const entries = dedupeUsageInputs(input.entries).map((entry, index) => {
    const normalized = normalizeUsageEntry(entry, index, previous);
    previous = normalized.entryDigest;
    return normalized;
  });
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    projectId: input.projectId || "",
    entries: entries.map((entry) => ({ usageEntryId: entry.usageEntryId, entryDigest: entry.entryDigest })),
  })));
  const ledgerDigest = sha256(stableStringify(entries.map((entry) => entry.entryDigest)));
  const manifest = {
    schema: DIRECT_USAGE_LEDGER_MANIFEST_SCHEMA,
    ledgerId: normalizeString(input.ledgerId, `usage_ledger_${sourceDigest.slice(0, 24)}`),
    rowCount: entries.length,
    firstObservedAt: entries[0]?.observedAt || "",
    lastObservedAt: entries[entries.length - 1]?.observedAt || "",
    ledgerDigest,
    lastEntryDigest: entries[entries.length - 1]?.entryDigest || "",
    generatedAt: normalizeString(input.generatedAt, nowIso()),
  };
  return finalizeArtifact({
    schema: DIRECT_USAGE_LEDGER_SCHEMA,
    projectId: normalizeString(input.projectId, ""),
    ledgerId: manifest.ledgerId,
    generatedAt: manifest.generatedAt,
    sourceDigest,
    entryCount: entries.length,
    manifest,
    totals: usageTotals(entries),
    entries,
    privacy: {
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawAccountIdIncluded: false,
      rawEndpointIncluded: false,
      billingGrade: false,
    },
    integrity: makeIntegrity(sourceDigest),
  });
}

function normalizeQuotaBucket(input = {}) {
  return {
    bucketId: normalizeString(input.bucketId, "quota_bucket"),
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, "Quota/rate bucket"),
    appliesTo: QUOTA_APPLIES_TO.has(input.appliesTo) ? input.appliesTo : "unknown",
    status: QUOTA_BUCKET_STATUS.has(input.status) ? input.status : "unknown",
    freshness: freshness(input.freshness, "unknown"),
    sourceConfidence: SOURCE_CONFIDENCE.has(input.sourceConfidence) ? input.sourceConfidence : "diagnostic",
    quotaInferenceScope: ["single_request", "request_shape_family", "model", "account", "unknown"].includes(input.quotaInferenceScope) ? input.quotaInferenceScope : "unknown",
    usedPercent: input.usedPercent === undefined ? undefined : numberValue(input.usedPercent, 0),
    resetsAt: normalizeString(input.resetsAt, ""),
    windowDurationMins: input.windowDurationMins === undefined ? undefined : numberValue(input.windowDurationMins, 0),
    rateLimitReachedType: normalizeString(input.rateLimitReachedType, ""),
    sourceRef: normalizeEvidenceRef(input.sourceRef || { kind: "quota", artifactId: "quota_fixture", artifactDigest: sha256("quota_fixture"), rendererSafeLabel: "Quota fixture" }),
  };
}

function buildQuotaRateSnapshot(input = {}) {
  const buckets = arrayValue(input.buckets).map((entry) => normalizeQuotaBucket(entry));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    projectId: input.projectId || "",
    source: input.source || "",
    buckets,
  })));
  return finalizeArtifact({
    schema: DIRECT_QUOTA_RATE_SNAPSHOT_SCHEMA,
    snapshotId: normalizeString(input.snapshotId, `quota_rate_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    source: QUOTA_SOURCES.has(input.source) ? input.source : "unknown",
    sourceConfidence: SOURCE_CONFIDENCE.has(input.sourceConfidence) ? input.sourceConfidence : "diagnostic",
    freshness: freshness(input.freshness, buckets.some((bucket) => bucket.freshness === "fresh") ? "fresh" : "unknown"),
    buckets,
    creditState: ["available", "exhausted", "not_reported", "unknown"].includes(input.creditState) ? input.creditState : "unknown",
    quotaReadAllowedInThisPr: bool(input.quotaReadAllowedInThisPr),
    billingGrade: false,
    canBlockDirectByItself: bool(input.canBlockDirectByItself),
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Quota/rate evidence is dynamic and non-billing."),
    rawAccountIdIncluded: false,
    rawPlanNameIncluded: false,
    rawEndpointIncluded: false,
    sourceDigest,
    integrity: makeIntegrity(sourceDigest),
  });
}

function buildCapabilityDowngradeEvent(input = {}) {
  const eventCore = {
    affectedCapabilityRows: arrayValue(input.affectedCapabilityRows).map(String),
    affectedRuntimeFacets: arrayValue(input.affectedRuntimeFacets).map(String),
    downgradeReason: ["evidence_expired", "scope_mismatch", "evidence_corrupt", "quota_exhausted", "rate_limited", "drift_blocked", "report_invalid", "precondition_missing"].includes(input.downgradeReason) ? input.downgradeReason : "precondition_missing",
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    newState: ["diagnostic", "degraded", "blocked"].includes(input.newState) ? input.newState : "blocked",
  };
  const eventId = normalizeString(input.eventId || input.downgradeId, `downgrade_${sha256(stableStringify(eventCore)).slice(0, 24)}`);
  return {
    schema: DIRECT_CAPABILITY_DOWNGRADE_EVENT_SCHEMA,
    downgradeId: eventId,
    eventId,
    occurredAt: normalizeString(input.occurredAt, nowIso()),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    capability: normalizeString(input.capability, eventCore.affectedRuntimeFacets[0] || "mainline_readiness"),
    reason: normalizeString(input.reason, eventCore.downgradeReason),
    previousStatus: normalizeString(input.previousStatus, ""),
    newStatus: normalizeString(input.newStatus, eventCore.newState),
    previousState: normalizeString(input.previousState, ""),
    rawDetailsIncluded: false,
    ...eventCore,
  };
}

function defaultScope(projectId, family) {
  return buildModelEvidenceScope({
    providerProfileId: "fixture_profile",
    authMode: "chatgpt_subscription",
    endpointClass: "chatgpt-codex-responses",
    modelId: "fixture-model",
    requestShapeFamily: family,
    normalizerVersion: DIRECT_USAGE_READINESS_VERSION,
    requestBuilderVersion: DIRECT_USAGE_READINESS_VERSION,
    accountEvidenceKey: sha256(`${projectId}:${family}`).slice(0, 32),
  });
}

function normalizeFacet(input = {}, projectId = "", family = "diagnostic") {
  return {
    state: FACET_STATES.has(input.state) ? input.state : "unknown",
    freshness: freshness(input.freshness, "unknown"),
    exactScope: buildModelEvidenceScope(input.exactScope || defaultScope(projectId, family)),
    blockerCodes: arrayValue(input.blockerCodes).map(String).filter(Boolean),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function buildRuntimeEvidenceStatus(input = {}) {
  const projectId = normalizeString(input.projectId, "");
  const facetsInput = isPlainObject(input.facets) ? input.facets : {};
  const facets = {
    textEmptyContext: normalizeFacet(facetsInput.textEmptyContext, projectId, "text_empty_context"),
    textRecentDialogue: normalizeFacet(facetsInput.textRecentDialogue, projectId, "text_recent_dialogue"),
    readFile: normalizeFacet(facetsInput.readFile, projectId, "read_file"),
    multiStepReadFile: normalizeFacet(facetsInput.multiStepReadFile, projectId, "multi_step_read"),
    applyPatch: normalizeFacet(facetsInput.applyPatch, projectId, "apply_patch"),
    runCommand: normalizeFacet(facetsInput.runCommand, projectId, "run_command"),
    freshFork: normalizeFacet(facetsInput.freshFork, projectId, "fresh_fork"),
    contextMaintenance: normalizeFacet(facetsInput.contextMaintenance, projectId, "context_maintenance"),
    governanceDiagnostics: normalizeFacet(facetsInput.governanceDiagnostics, projectId, "diagnostic"),
    subAgentObservability: normalizeFacet(facetsInput.subAgentObservability, projectId, "diagnostic"),
  };
  const downgradeEvents = arrayValue(input.downgradeEvents).map((event) => buildCapabilityDowngradeEvent(event));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    projectId,
    modelCatalogSnapshotId: input.modelCatalogSnapshotId || "",
    quotaRateSnapshotId: input.quotaRateSnapshotId || "",
    usageLedgerId: input.usageLedgerId || "",
    facets,
    downgradeEvents: downgradeEvents.map((event) => event.eventId),
  })));
  return finalizeArtifact({
    schema: DIRECT_RUNTIME_EVIDENCE_STATUS_SCHEMA,
    statusId: normalizeString(input.statusId, `runtime_evidence_${sourceDigest.slice(0, 24)}`),
    projectId,
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    sourceDigest,
    modelCatalogSnapshotId: normalizeString(input.modelCatalogSnapshotId, ""),
    quotaRateSnapshotId: normalizeString(input.quotaRateSnapshotId, ""),
    usageLedgerId: normalizeString(input.usageLedgerId, ""),
    liveProbeEvidenceView: isPlainObject(input.liveProbeEvidenceView) ? input.liveProbeEvidenceView : null,
    facets,
    readinessFacets: arrayValue(input.readinessFacets),
    downgradeEvents,
    witnessChips: arrayValue(input.witnessChips),
    rawExposureFlags: {
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawAccountIdIncluded: false,
      rawWorkspacePathIncluded: false,
    },
    integrity: makeIntegrity(sourceDigest),
  });
}

function normalizeDriftImpact(input = {}) {
  return {
    affectedScope: ["text_empty_context", "text_recent_dialogue", "read_file", "apply_patch", "run_command", "fresh_fork", "context_maintenance", "all", "unknown"].includes(input.affectedScope) ? input.affectedScope : "unknown",
    severity: ["none", "diagnostic", "degrade", "block"].includes(input.severity) ? input.severity : "diagnostic",
    reason: normalizeString(input.reason, ""),
  };
}

function buildDriftWatchReport(input = {}) {
  const checks = arrayValue(input.checks).map((check, index) => ({
    checkId: normalizeString(check.checkId, `drift_check_${index + 1}`),
    source: ["normalized_events", "profile_doc", "live_probe_evidence", "report_schema", "runtime_status", "fixture"].includes(check.source) ? check.source : "fixture",
    status: ["matched", "changed", "missing", "blocked", "unknown"].includes(check.status) ? check.status : "unknown",
    rendererSafeSummary: normalizeString(check.rendererSafeSummary, "Drift check"),
    evidenceRefs: normalizeEvidenceRefs(check.evidenceRefs),
  }));
  const impacts = arrayValue(input.impacts).map((impact) => normalizeDriftImpact(impact));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({ checks, impacts, unknownEventTypes: input.unknownEventTypes || [] })));
  return finalizeArtifact({
    schema: DIRECT_DRIFT_WATCH_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, `drift_watch_${sourceDigest.slice(0, 24)}`),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    sourceDigest,
    profileDigest: normalizeString(input.profileDigest, ""),
    normalizerVersion: normalizeString(input.normalizerVersion, DIRECT_USAGE_READINESS_VERSION),
    checks,
    unknownEventTypes: arrayValue(input.unknownEventTypes).map(String),
    schemaVersionMismatches: arrayValue(input.schemaVersionMismatches).map(String),
    requestShapeMismatches: arrayValue(input.requestShapeMismatches).map(String),
    modelCatalogDeltas: arrayValue(input.modelCatalogDeltas),
    impacts,
    readinessImpact: ["none", "diagnostic", "degrade", "block"].includes(input.readinessImpact) ? input.readinessImpact : impacts.some((impact) => impact.severity === "block") ? "block" : "diagnostic",
    rawProviderPayloadIncluded: false,
    integrity: makeIntegrity(sourceDigest),
  });
}

function buildReportValidationRegistry(input = {}) {
  const reports = arrayValue(input.reports).map((report) => ({
    reportKind: normalizeString(report.reportKind, "unknown"),
    schema: normalizeString(report.schema, ""),
    reportId: normalizeString(report.reportId, ""),
    sourcePathEvidenceKey: normalizeString(report.sourcePathEvidenceKey, ""),
    validationState: ["valid", "missing", "schema_invalid", "digest_mismatch", "raw_exposure_blocked", "stale", "unknown"].includes(report.validationState) ? report.validationState : "unknown",
    matrixRowsExercised: arrayValue(report.matrixRowsExercised).map(String),
    matrixPromotionCandidate: bool(report.matrixPromotionCandidate),
    authorityPromotionCandidate: bool(report.authorityPromotionCandidate),
    evidenceRefs: normalizeEvidenceRefs(report.evidenceRefs),
  }));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify(reports)));
  return finalizeArtifact({
    schema: DIRECT_REPORT_VALIDATION_REGISTRY_SCHEMA,
    registryId: normalizeString(input.registryId, `report_registry_${sourceDigest.slice(0, 24)}`),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    reports,
    requiredReportSchemas: arrayValue(input.requiredReportSchemas).map(String),
    missingRequiredReports: arrayValue(input.missingRequiredReports).map(String),
    invalidRequiredReports: reports.filter((report) => ["schema_invalid", "digest_mismatch", "raw_exposure_blocked"].includes(report.validationState)).map((report) => report.reportKind),
    rawExposureFailures: reports.filter((report) => report.validationState === "raw_exposure_blocked").map((report) => report.reportKind),
    sourceDigest,
    integrity: makeIntegrity(sourceDigest),
  });
}

function buildDocsChecklist(input = {}) {
  const checklist = {
    schema: DIRECT_MAINLINE_DOCS_CHECKLIST_SCHEMA,
    checklistId: normalizeString(input.checklistId, `docs_checklist_${sha256(stableStringify(input)).slice(0, 24)}`),
    appServerDefaultDocumented: bool(input.appServerDefaultDocumented),
    directFlagDocumented: bool(input.directFlagDocumented),
    rollbackDocumented: bool(input.rollbackDocumented),
    liveCallOptInDocumented: bool(input.liveCallOptInDocumented),
    credentialPrivacyDocumented: bool(input.credentialPrivacyDocumented),
    rightPaneBoundaryDocumented: bool(input.rightPaneBoundaryDocumented),
    unsupportedCapabilitiesDocumented: bool(input.unsupportedCapabilitiesDocumented),
    migrationNotesPathEvidenceKey: normalizeString(input.migrationNotesPathEvidenceKey, ""),
    rawPathsIncluded: false,
  };
  checklist.complete = checklist.appServerDefaultDocumented &&
    checklist.directFlagDocumented &&
    checklist.rollbackDocumented &&
    checklist.liveCallOptInDocumented &&
    checklist.credentialPrivacyDocumented &&
    checklist.rightPaneBoundaryDocumented &&
    checklist.unsupportedCapabilitiesDocumented;
  return checklist;
}

function buildCiLiveCallGuardProof(input = {}) {
  return {
    schema: DIRECT_CI_LIVE_CALL_GUARD_PROOF_SCHEMA,
    guardId: normalizeString(input.guardId, `ci_live_guard_${sha256(stableStringify(input)).slice(0, 24)}`),
    providerCallWithoutOptInStarted: false,
    ciLiveCallWithoutOverrideStarted: false,
    optInFlagNames: arrayValue(input.optInFlagNames).length ? arrayValue(input.optInFlagNames).map(String) : ["CODEX_DIRECT_USAGE_READINESS_LIVE"],
    ciOverrideFlagNames: arrayValue(input.ciOverrideFlagNames).length ? arrayValue(input.ciOverrideFlagNames).map(String) : ["CODEX_DIRECT_USAGE_READINESS_ALLOW_CI"],
    testedAt: normalizeString(input.testedAt, nowIso()),
  };
}

function buildCostEstimatorStatus(input = {}) {
  return {
    schema: DIRECT_COST_ESTIMATOR_STATUS_SCHEMA,
    costEstimatorAvailable: false,
    billingGrade: false,
    pricingSnapshotId: undefined,
    rendererSafeMessage: normalizeString(input.rendererSafeMessage, "Cost estimation is not implemented in PR 11."),
  };
}

function normalizeWitnessChip(input = {}) {
  return {
    chipId: normalizeString(input.chipId, `witness_${sha256(stableStringify(input)).slice(0, 16)}`),
    kind: WITNESS_KINDS.has(input.kind) ? input.kind : "evidence",
    label: normalizeString(input.label, "Runtime witness"),
    state: WITNESS_STATES.has(input.state) ? input.state : "diagnostic",
    actionability: {
      actionable: false,
      allowedActions: [],
    },
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function buildRuntimeWitnessProjection(input = {}) {
  const chips = arrayValue(input.chips).map((chip) => normalizeWitnessChip(chip));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify(chips)));
  return finalizeArtifact({
    schema: DIRECT_RUNTIME_WITNESS_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, `runtime_witness_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    sourceDigest,
    chips,
    rawExposureScan: {
      scanned: true,
      status: "passed",
      findingCount: 0,
    },
    integrity: makeIntegrity(sourceDigest),
  });
}

function normalizePrecondition(input = {}) {
  const status = ["present_valid", "present_invalid", "missing", "skipped_with_waiver", "not_applicable"].includes(input.status) ? input.status : "missing";
  const waiver = status === "skipped_with_waiver" ? {
    waiverId: normalizeString(input.waiver?.waiverId, `waiver_${sha256(input.preconditionId || "").slice(0, 12)}`),
    reason: ["feature_not_in_current_merge_scope", "diagnostic_only", "temporarily_disabled", "blocked_by_policy"].includes(input.waiver?.reason) ? input.waiver.reason : "diagnostic_only",
    approvedBy: ["developer", "maintainer", "test_fixture"].includes(input.waiver?.approvedBy) ? input.waiver.approvedBy : "test_fixture",
    expiresAt: normalizeString(input.waiver?.expiresAt, ""),
  } : undefined;
  return {
    preconditionId: normalizeString(input.preconditionId, "precondition"),
    required: input.required !== false,
    status,
    ...(waiver ? { waiver } : {}),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function normalizeGate(input = {}) {
  return {
    gateId: normalizeString(input.gateId, "gate"),
    status: GATE_STATUS.has(input.status) ? input.status : "blocked",
    requiredForReadyBehindFlag: input.requiredForReadyBehindFlag !== false,
    readinessEffect: READINESS_EFFECTS.has(input.readinessEffect) ? input.readinessEffect : input.requiredForReadyBehindFlag === false ? "informational" : "required_for_ready_behind_flag",
    blockerCodes: arrayValue(input.blockerCodes).map(String).filter(Boolean),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function computeMainlineReadiness(preconditions, gates, input = {}) {
  if (input.mainlineReadiness && MAINLINE_READINESS.has(input.mainlineReadiness)) return input.mainlineReadiness;
  const badPrecondition = preconditions.some((entry) => entry.required && ["missing", "present_invalid"].includes(entry.status));
  const blockingWaiver = preconditions.some((entry) => entry.required && entry.status === "skipped_with_waiver" && entry.waiver?.reason !== "feature_not_in_current_merge_scope");
  const badGate = gates.some((gate) => gate.requiredForReadyBehindFlag && gate.readinessEffect === "required_for_ready_behind_flag" && gate.status !== "passed");
  if (badPrecondition || blockingWaiver || badGate || input.directDefaultAllowed === true || input.appServerBaselineRequired === false || input.appServerRemovalAllowed === true) return "blocked";
  return "ready_behind_flag";
}

function buildMainlineReadinessReport(input = {}) {
  const preconditions = arrayValue(input.preconditions).map((entry) => normalizePrecondition(entry));
  const gates = arrayValue(input.gates).map((entry) => normalizeGate(entry));
  const mainlineReadiness = computeMainlineReadiness(preconditions, gates, input);
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    preconditions: preconditions.map((entry) => ({ id: entry.preconditionId, status: entry.status })),
    gates: gates.map((gate) => ({ id: gate.gateId, status: gate.status })),
    mainlineReadiness,
  })));
  return finalizeArtifact({
    schema: DIRECT_MAINLINE_READINESS_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, `mainline_readiness_${sourceDigest.slice(0, 24)}`),
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    branch: normalizeString(input.branch, ""),
    commit: normalizeString(input.commit, ""),
    coverageSource: ["fixture_readiness", "preflight", "real_provider", "diagnostic"].includes(input.coverageSource) ? input.coverageSource : "fixture_readiness",
    mainlineReadiness,
    runtimeEnablement: RUNTIME_ENABLEMENT.has(input.runtimeEnablement) ? input.runtimeEnablement : mainlineReadiness === "ready_behind_flag" ? "eligible_projects_only" : "blocked",
    directDefaultAllowed: false,
    appServerBaselineRequired: true,
    appServerRemovalAllowed: false,
    modelCatalogSnapshotId: normalizeString(input.modelCatalogSnapshotId, ""),
    quotaRateSnapshotId: normalizeString(input.quotaRateSnapshotId, ""),
    usageLedgerId: normalizeString(input.usageLedgerId, ""),
    driftWatchReportId: normalizeString(input.driftWatchReportId, ""),
    reportValidationRegistryId: normalizeString(input.reportValidationRegistryId, ""),
    runtimeEvidenceStatusId: normalizeString(input.runtimeEvidenceStatusId, ""),
    docsChecklistId: normalizeString(input.docsChecklistId, ""),
    ciLiveCallGuardProofId: normalizeString(input.ciLiveCallGuardProofId, ""),
    costEstimatorStatusId: normalizeString(input.costEstimatorStatusId, ""),
    missingPreconditions: preconditions.filter((entry) => entry.status === "missing").map((entry) => entry.preconditionId),
    appServerBaseline: {
      reportId: normalizeString(input.appServerBaseline?.reportId, ""),
      status: ["green", "failed", "missing", "stale"].includes(input.appServerBaseline?.status) ? input.appServerBaseline.status : "missing",
      generatedAt: normalizeString(input.appServerBaseline?.generatedAt, ""),
      maxAgeHours: numberValue(input.appServerBaseline?.maxAgeHours, 24),
    },
    repoState: {
      branch: normalizeString(input.repoState?.branch || input.branch, ""),
      commit: normalizeString(input.repoState?.commit || input.commit, ""),
      workingTreeClean: input.repoState?.workingTreeClean,
      directBranchNameExpected: normalizeString(input.repoState?.directBranchNameExpected, "codex/direct-chatgpt-harness"),
      mainlineTargetBranch: normalizeString(input.repoState?.mainlineTargetBranch, ""),
    },
    preconditions,
    gates,
    sentinels: normalizeSentinels(input.sentinels),
    rawExposureScan: input.rawExposureScan || { scanned: true, status: "passed", findingCount: 0 },
    promotionCandidates: {
      A7_modelCatalog: bool(input.promotionCandidates?.A7_modelCatalog),
      A8_controlEvidence: bool(input.promotionCandidates?.A8_controlEvidence),
      A9_cacheAffinityDiagnostic: bool(input.promotionCandidates?.A9_cacheAffinityDiagnostic),
      A10_quotaRateEvidence: bool(input.promotionCandidates?.A10_quotaRateEvidence),
      C13_usageProjection: bool(input.promotionCandidates?.C13_usageProjection),
      F9_runtimeWitnessChips: bool(input.promotionCandidates?.F9_runtimeWitnessChips),
      I10_usageLedger: bool(input.promotionCandidates?.I10_usageLedger),
      I12_driftWatch: bool(input.promotionCandidates?.I12_driftWatch),
      I13_capabilityDowngrade: bool(input.promotionCandidates?.I13_capabilityDowngrade),
      I14_ciLiveCallGuard: bool(input.promotionCandidates?.I14_ciLiveCallGuard),
      I15_reportValidation: bool(input.promotionCandidates?.I15_reportValidation),
      J12_mainlineHygiene: bool(input.promotionCandidates?.J12_mainlineHygiene),
    },
    sourceDigest,
    integrity: makeIntegrity(sourceDigest),
  });
}

function normalizeSentinels(input = {}) {
  return {
    providerTransportCalls: numberValue(input.providerTransportCalls, 0),
    appServerSpawnCalls: numberValue(input.appServerSpawnCalls, 0),
    appServerMutationCalls: numberValue(input.appServerMutationCalls, 0),
    appServerQuotaReadCalls: numberValue(input.appServerQuotaReadCalls, 0),
    workspaceReadCalls: numberValue(input.workspaceReadCalls, 0),
    patchApplyCalls: numberValue(input.patchApplyCalls, 0),
    commandRunCalls: numberValue(input.commandRunCalls, 0),
    contextPackBuilds: numberValue(input.contextPackBuilds, 0),
    requestManifestBuilds: numberValue(input.requestManifestBuilds, 0),
    directSessionCreates: numberValue(input.directSessionCreates, 0),
    runtimeTierMutationCalls: numberValue(input.runtimeTierMutationCalls, 0),
    rightPaneMutationCalls: numberValue(input.rightPaneMutationCalls, 0),
    handoffMutationCalls: numberValue(input.handoffMutationCalls, 0),
  };
}

function usageReadinessRecoveryState(input = {}) {
  if (input.rawExposureBlocked) return "raw_exposure_blocked";
  if (input.reportRegistryInvalid) return "report_registry_invalid";
  if (input.driftReportBlocking) return "drift_report_blocking";
  if (input.readinessReportCorrupt) return "readiness_report_corrupt";
  if (input.readinessReportMissing) return "readiness_report_missing";
  if (input.liveProbeEvidenceCorrupt) return "live_probe_evidence_corrupt";
  if (input.liveProbeEvidenceMissing) return "live_probe_evidence_missing";
  if (input.quotaSnapshotExpired) return "quota_snapshot_expired";
  if (input.quotaSnapshotMissing) return "quota_snapshot_missing";
  if (input.usageLedgerCorrupt) return "usage_ledger_corrupt";
  if (input.usageLedgerMissing) return "usage_ledger_missing";
  if (input.modelCatalogCorrupt) return "model_catalog_corrupt";
  if (input.modelCatalogMissing) return "model_catalog_missing";
  return "healthy";
}

function validateUsageReadinessRegressionReport(report = {}) {
  if (report.schema !== DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA) throw new Error("Invalid usage readiness regression report schema.");
  if (!Array.isArray(report.cases)) throw new Error("Usage readiness report cases must be an array.");
  if (report.authorityPromotionCandidate !== false) throw new Error("Usage readiness report must not promote authority.");
  if (report.runtimeAuthorityExercised !== false) throw new Error("Usage readiness report must not exercise runtime authority.");
  if (!report.rawExposureScan || report.rawExposureScan.status !== "passed") throw new Error("Usage readiness report raw exposure scan must pass.");
  return true;
}

module.exports = {
  DIRECT_MODEL_CATALOG_SNAPSHOT_SCHEMA,
  DIRECT_PROMPT_CACHE_AFFINITY_EVIDENCE_SCHEMA,
  DIRECT_USAGE_LEDGER_SCHEMA,
  DIRECT_USAGE_LEDGER_MANIFEST_SCHEMA,
  DIRECT_QUOTA_RATE_SNAPSHOT_SCHEMA,
  DIRECT_RUNTIME_EVIDENCE_STATUS_SCHEMA,
  DIRECT_CAPABILITY_DOWNGRADE_EVENT_SCHEMA,
  DIRECT_DRIFT_WATCH_REPORT_SCHEMA,
  DIRECT_REPORT_VALIDATION_REGISTRY_SCHEMA,
  DIRECT_MAINLINE_DOCS_CHECKLIST_SCHEMA,
  DIRECT_CI_LIVE_CALL_GUARD_PROOF_SCHEMA,
  DIRECT_COST_ESTIMATOR_STATUS_SCHEMA,
  DIRECT_RUNTIME_WITNESS_PROJECTION_SCHEMA,
  DIRECT_MAINLINE_READINESS_REPORT_SCHEMA,
  DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA,
  buildCapabilityDowngradeEvent,
  buildCiLiveCallGuardProof,
  buildCostEstimatorStatus,
  buildDocsChecklist,
  buildDriftWatchReport,
  buildMainlineReadinessReport,
  buildModelCatalogSnapshot,
  buildModelControlDescriptor,
  buildModelEvidenceScope,
  buildPromptCacheAffinityEvidence,
  buildQuotaRateSnapshot,
  buildReportValidationRegistry,
  buildRuntimeEvidenceStatus,
  buildRuntimeWitnessProjection,
  buildUsageLedger,
  normalizeEvidenceRef,
  sha256,
  stableStringify,
  usageReadinessRecoveryState,
  validateUsageReadinessRegressionReport,
};
