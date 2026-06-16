"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA = "direct_provider_metadata_profile@1";
const DIRECT_METADATA_DRIFT_REPORT_SCHEMA = "direct_metadata_drift_report@1";
const DEFAULT_CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models";
const DEFAULT_CHATGPT_WHAM_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_CLIENT_VERSION = "0.0.0-codex-review-shell";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_REFRESH_BEFORE_MS = 60_000;
const KNOWN_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function evidenceRef(kind, label, sourceConfidence = "diagnostic", artifactId = "") {
  const safeKind = normalizeString(kind, "direct_metadata");
  const safeLabel = normalizeString(label, safeKind);
  const safeArtifactId = normalizeString(artifactId, `${safeKind}_${sha256(safeLabel).slice(0, 16)}`);
  return {
    kind: safeKind,
    artifactId: safeArtifactId,
    artifactDigest: sha256(`${safeKind}:${safeArtifactId}:${safeLabel}`),
    sourceConfidence,
    rendererSafeLabel: safeLabel,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawAccountIdIncluded: false,
    rawEndpointIncluded: false,
    rawChatGptUrlIncluded: false,
  };
}

function accountEvidenceKey(credentials = {}, authStatus = {}) {
  const accountId = normalizeString(credentials.accountId || credentials.account_id || authStatus.accountId, "");
  return accountId ? sha256(`direct-account:${accountId}`).slice(0, 32) : "";
}

function normalizeReasoningOption(value) {
  if (typeof value === "string") {
    const effort = normalizeString(value, "");
    return effort ? { reasoningEffort: effort, description: "" } : null;
  }
  if (!isPlainObject(value)) return null;
  const effort = normalizeString(value.reasoningEffort || value.reasoning_effort || value.effort || value.id, "");
  if (!effort) return null;
  return {
    reasoningEffort: effort,
    description: normalizeString(value.description || value.name, ""),
  };
}

function normalizeServiceTier(value) {
  if (typeof value === "string") {
    const id = normalizeString(value, "");
    return id ? { id, name: id, description: "" } : null;
  }
  if (!isPlainObject(value)) return null;
  const id = normalizeString(value.id || value.serviceTier || value.service_tier || value.name, "");
  if (!id) return null;
  return {
    id,
    name: normalizeString(value.name || value.displayName || value.display_name, id),
    description: normalizeString(value.description, ""),
  };
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeString(keyFn(item), "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeInputModalities(value) {
  return arrayValue(value).map((entry) => normalizeString(entry, "")).filter(Boolean);
}

function normalizeModelDescriptor(raw = {}, index = 0, validation = {}) {
  if (!isPlainObject(raw)) {
    validation.missingRequiredFields.push(`models[${index}]`);
    return null;
  }
  const modelId = normalizeString(raw.id || raw.model || raw.slug, "");
  const model = normalizeString(raw.model || raw.slug || raw.id, modelId);
  if (!modelId && !model) {
    validation.missingRequiredFields.push(`models[${index}].id`);
    return null;
  }
  const supportedReasoningEfforts = uniqueByKey(
    arrayValue(raw.supportedReasoningEfforts || raw.supported_reasoning_efforts || raw.supported_reasoning_levels)
      .map(normalizeReasoningOption)
      .filter(Boolean),
    (entry) => entry.reasoningEffort,
  );
  const defaultReasoningEffort = normalizeString(raw.defaultReasoningEffort || raw.default_reasoning_effort || raw.default_reasoning_level, "");
  const effortValues = new Set(supportedReasoningEfforts.map((entry) => entry.reasoningEffort));
  if (defaultReasoningEffort && effortValues.size && !effortValues.has(defaultReasoningEffort)) {
    validation.changedFields.push({
      field: `models[${index}].defaultReasoningEffort`,
      status: "inconsistent_default",
      value: defaultReasoningEffort,
    });
  }
  for (const effort of effortValues) {
    if (!KNOWN_REASONING_EFFORTS.has(effort)) {
      validation.unknownValues.push({
        field: `models[${index}].supportedReasoningEfforts`,
        value: effort,
      });
    }
  }
  const serviceTiers = uniqueByKey([
    ...arrayValue(raw.serviceTiers || raw.service_tiers),
    ...arrayValue(raw.additionalSpeedTiers || raw.additional_speed_tiers),
  ].map(normalizeServiceTier).filter(Boolean), (entry) => entry.id);
  const defaultServiceTier = normalizeString(raw.defaultServiceTier || raw.default_service_tier, "");
  const serviceTierIds = new Set(serviceTiers.map((entry) => entry.id));
  if (defaultServiceTier && serviceTierIds.size && !serviceTierIds.has(defaultServiceTier)) {
    validation.changedFields.push({
      field: `models[${index}].defaultServiceTier`,
      status: "inconsistent_default",
      value: defaultServiceTier,
    });
  }
  return {
    id: modelId || model,
    model: model || modelId,
    displayName: normalizeString(raw.displayName || raw.display_name, model || modelId),
    description: normalizeString(raw.description, ""),
    hidden: normalizeBoolean(raw.hidden, normalizeString(raw.visibility, "") === "hidden"),
    isDefault: normalizeBoolean(raw.isDefault || raw.is_default, false),
    upgrade: raw.upgrade === undefined ? null : raw.upgrade,
    upgradeInfo: raw.upgradeInfo || raw.upgrade_info || null,
    availabilityNux: raw.availabilityNux || raw.availability_nux || null,
    availabilityState: normalizeString(
      raw.availabilityState || raw.availability_state || raw.status || "",
      raw.hidden ? "hidden" : raw.availabilityNux || raw.availability_nux ? "available_with_nux" : "available",
    ),
    unavailableReason: normalizeString(raw.unavailableReason || raw.unavailable_reason, ""),
    supportedReasoningEfforts,
    defaultReasoningEffort,
    serviceTiers,
    defaultServiceTier,
    inputModalities: normalizeInputModalities(raw.inputModalities || raw.input_modalities),
    supportsPersonality: raw.supportsPersonality ?? raw.supports_personality,
    contextWindow: numberOrUndefined(raw.contextWindow ?? raw.context_window),
    maxContextWindow: numberOrUndefined(raw.maxContextWindow ?? raw.max_context_window),
    evidenceRefs: [evidenceRef("direct_model_descriptor", `Model descriptor ${model || modelId}`, "exact", model || modelId)],
  };
}

function credentialExpiresInMs(credentials = {}, nowMs = Date.now()) {
  const expiresAt = Number(credentials.expiresAt ?? credentials.expires ?? 0) || 0;
  return expiresAt > 0 ? Math.max(0, expiresAt - nowMs) : Number.POSITIVE_INFINITY;
}

function shouldRefreshCredentials(credentials = {}, options = {}) {
  if (!credentials?.refreshToken && !credentials?.refresh_token && !credentials?.refresh) return false;
  if (options.forceRefresh === true) return true;
  if (!credentials?.accessToken && !credentials?.access_token && !credentials?.access) return true;
  return credentialExpiresInMs(credentials, options.nowMs) <= Number(options.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS);
}

function rawModelsArray(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.models)) return response.models;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function normalizeRateLimitWindow(input = {}) {
  if (!isPlainObject(input)) return null;
  const usedPercent = numberOrUndefined(input.usedPercent ?? input.used_percent);
  const resetEpoch = numberOrUndefined(input.resetAt ?? input.reset_at ?? input.resetsAt ?? input.resets_at);
  const resetsAt = normalizeString(
    input.resetsAt || input.resets_at || "",
    resetEpoch ? new Date(resetEpoch * 1000).toISOString() : "",
  );
  const windowSeconds = numberOrUndefined(input.limitWindowSeconds ?? input.limit_window_seconds);
  const windowDurationMins = numberOrUndefined(input.windowDurationMins ?? input.window_duration_mins ?? input.windowMinutes ?? input.window_minutes) ||
    (windowSeconds ? Math.ceil(windowSeconds / 60) : undefined);
  if (usedPercent === undefined && !resetsAt && windowDurationMins === undefined) return null;
  return {
    usedPercent,
    resetsAt,
    windowDurationMins,
    evidenceRefs: [evidenceRef("direct_quota_window", "Direct quota window", "exact")],
  };
}

function normalizeRateLimitDetails(details = {}, prefix = "limit") {
  const snapshots = [];
  if (!isPlainObject(details)) return snapshots;
  const primary = normalizeRateLimitWindow(details.primary || details.primaryWindow || details.primary_window);
  const secondary = normalizeRateLimitWindow(details.secondary || details.secondaryWindow || details.secondary_window);
  if (primary) snapshots.push({ windowId: `${prefix}:primary`, windowKind: "five_hour", ...primary });
  if (secondary) snapshots.push({ windowId: `${prefix}:secondary`, windowKind: "weekly", ...secondary });
  if (!primary && !secondary) {
    const direct = normalizeRateLimitWindow(details);
    if (direct) snapshots.push({ windowId: prefix, windowKind: "other", ...direct });
  }
  return snapshots;
}

function normalizeRateLimitMap(map = {}) {
  const snapshots = [];
  if (!isPlainObject(map)) return snapshots;
  for (const [key, value] of Object.entries(map)) {
    if (!isPlainObject(value)) continue;
    const id = normalizeString(value.limitId || value.limit_id || key, key || "limit");
    snapshots.push(...normalizeRateLimitDetails(value, id));
  }
  return snapshots;
}

function dedupeQuotaWindows(windows = []) {
  const seen = new Set();
  const deduped = [];
  for (const window of windows) {
    const key = `${normalizeString(window.windowId, "")}:${normalizeString(window.windowKind, "")}:${normalizeString(window.resetsAt, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(window);
  }
  return deduped;
}

function normalizeQuotaSnapshot(raw = null) {
  if (!isPlainObject(raw)) return { status: "unknown", windows: [], evidenceRefs: [] };
  const sourceWindows = [];
  const rateLimitsByLimitId = raw.rateLimitsByLimitId || raw.rate_limits_by_limit_id;
  if (isPlainObject(rateLimitsByLimitId) && Object.keys(rateLimitsByLimitId).length) {
    sourceWindows.push(...normalizeRateLimitMap(rateLimitsByLimitId));
  } else {
    const rateLimits = raw.rateLimits || raw.rate_limits || (raw.rate_limit ? {} : raw);
    if (isPlainObject(rateLimits) && Object.keys(rateLimits).length) {
      sourceWindows.push(...normalizeRateLimitDetails(rateLimits, normalizeString(rateLimits.limitId || rateLimits.limit_id, "codex")));
    }
  }
  if (isPlainObject(raw.rate_limit)) {
    sourceWindows.push(...normalizeRateLimitDetails(raw.rate_limit, "codex"));
  }
  for (const additional of arrayValue(raw.additional_rate_limits || raw.additionalRateLimits)) {
    const id = normalizeString(additional.metered_feature || additional.meteredFeature || additional.limit_name || additional.limitName, "additional");
    if (isPlainObject(additional.rate_limit)) sourceWindows.push(...normalizeRateLimitDetails(additional.rate_limit, id));
  }
  const windows = dedupeQuotaWindows(sourceWindows);
  return {
    status: windows.length ? "available" : "unknown",
    planType: normalizeString(raw.planType || raw.plan_type, ""),
    rateLimitReachedType: raw.rateLimitReachedType || raw.rate_limit_reached_type || null,
    windows,
    evidenceRefs: windows.length ? [evidenceRef("direct_quota", "Direct quota/rate metadata", "exact")] : [],
  };
}

function normalizeAccountTokenProfile(raw = null) {
  if (!isPlainObject(raw)) return { status: "unknown", evidenceRefs: [] };
  const summary = raw.summary || raw;
  const daily = arrayValue(raw.dailyUsageBuckets || raw.daily_usage_buckets);
  const lifetimeTokens = numberOrUndefined(summary.lifetimeTokens ?? summary.lifetime_tokens);
  const peakDailyTokens = numberOrUndefined(summary.peakDailyTokens ?? summary.peak_daily_tokens);
  const longestRunningTurnSec = numberOrUndefined(summary.longestRunningTurnSec ?? summary.longest_running_turn_sec);
  const currentStreakDays = numberOrUndefined(summary.currentStreakDays ?? summary.current_streak_days);
  const longestStreakDays = numberOrUndefined(summary.longestStreakDays ?? summary.longest_streak_days);
  const dailyBuckets = daily.map((entry) => ({
    startDate: normalizeString(entry.startDate || entry.start_date, ""),
    tokens: numberOrUndefined(entry.tokens) || 0,
  })).filter((entry) => entry.startDate);
  const hasProfileEvidence = [
    lifetimeTokens,
    peakDailyTokens,
    longestRunningTurnSec,
    currentStreakDays,
    longestStreakDays,
  ].some((value) => value !== undefined) || dailyBuckets.length > 0;
  if (!hasProfileEvidence) return { status: "unknown", evidenceRefs: [] };
  return {
    status: "available",
    lifetimeTokens,
    peakDailyTokens,
    longestRunningTurnSec,
    currentStreakDays,
    longestStreakDays,
    dailyBuckets,
    evidenceRefs: [evidenceRef("direct_account_usage", "Direct account token usage profile", "exact")],
  };
}

function buildDirectProviderMetadataProfile(input = {}) {
  const validation = {
    changedFields: [],
    unknownValues: [],
    missingRequiredFields: [],
  };
  const projectId = normalizeString(input.projectId, "");
  const authStatus = isPlainObject(input.authStatus) ? input.authStatus : {};
  const credentials = isPlainObject(input.credentials) ? input.credentials : {};
  const hasAccessToken = Boolean(credentials.accessToken || credentials.access_token);
  const rawModels = rawModelsArray(input.rawModelsResponse);
  if (!rawModels.length && input.modelSource === "server_model_list") {
    validation.missingRequiredFields.push("modelCatalog.items");
  }
  const items = rawModels
    .map((entry, index) => normalizeModelDescriptor(entry, index, validation))
    .filter(Boolean);
  const defaultItem = items.find((entry) => entry.isDefault) || items[0] || null;
  const quota = normalizeQuotaSnapshot(input.rawRateLimits);
  const accountTokenProfile = normalizeAccountTokenProfile(input.rawAccountTokenProfile);
  const modelSource = items.length
    ? normalizeString(input.modelSource, "server_model_list")
    : normalizeString(input.modelSource, "unknown");
  const profile = {
    schema: DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA,
    providerKind: "direct_oai",
    profileId: `direct_provider_metadata_${sha256(`${projectId}:${input.generatedAt || ""}:${modelSource}`).slice(0, 24)}`,
    projectId,
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    account: {
      status: normalizeString(authStatus.status, hasAccessToken ? "authenticated" : "unknown"),
      authMode: normalizeString(authStatus.authMode || credentials.authMode, hasAccessToken ? "chatgpt" : "unknown"),
      planType: normalizeString(authStatus.planType || credentials.planType || credentials.chatgptPlanType, ""),
      accountEvidenceKey: accountEvidenceKey(credentials, authStatus),
      evidenceRefs: [evidenceRef("direct_auth_status", "Direct auth/account metadata", hasAccessToken ? "accepted" : "unknown")],
    },
    modelCatalog: {
      status: items.length ? "available" : modelSource === "cache" ? "stale" : "unknown",
      source: modelSource,
      etag: normalizeString(input.etag, ""),
      clientVersion: normalizeString(input.clientVersion, DEFAULT_CLIENT_VERSION),
      endpointHash: normalizeString(input.endpointHash, ""),
      items,
      defaultModel: defaultItem?.model || defaultItem?.id || "",
      evidenceRefs: items.length ? [evidenceRef("direct_model_catalog", "Direct model catalog", modelSource === "server_model_list" ? "exact" : "diagnostic")] : [],
    },
    runtimeSettings: {
      active: {
        model: normalizeString(input.active?.model || defaultItem?.model || defaultItem?.id, ""),
        reasoningEffort: normalizeString(input.active?.reasoningEffort || defaultItem?.defaultReasoningEffort, ""),
        serviceTier: normalizeString(input.active?.serviceTier || defaultItem?.defaultServiceTier, ""),
        approvalPolicy: normalizeString(input.active?.approvalPolicy, ""),
        permissionProfile: normalizeString(input.active?.permissionProfile, ""),
      },
      requestControls: arrayValue(input.requestControls),
    },
    usage: {
      tokenUsage: isPlainObject(input.tokenUsage) ? input.tokenUsage : null,
      context: isPlainObject(input.context) ? input.context : { status: "unknown", evidenceRefs: [] },
      quota,
      accountTokenProfile,
    },
    capabilities: {
      provider: {
        namespaceTools: input.capabilities?.namespaceTools,
        imageGeneration: input.capabilities?.imageGeneration,
        webSearch: input.capabilities?.webSearch,
      },
      tools: arrayValue(input.capabilities?.tools),
      maintenance: arrayValue(input.capabilities?.maintenance),
    },
    transport: {
      streamKind: normalizeString(input.transport?.streamKind, "sse"),
      connectionEvidenceKey: normalizeString(input.transport?.connectionEvidenceKey, ""),
      servedMethods: arrayValue(input.transport?.servedMethods).map(String),
      evidenceRefs: [evidenceRef("direct_transport", "Direct provider metadata transport", "diagnostic")],
    },
    validation,
    rawTokenIncluded: false,
    rawAccountIdIncluded: false,
    rawEmailIncluded: false,
    rawProviderPayloadIncluded: false,
    rawEndpointIncluded: false,
  };
  profile.profileDigest = sha256(stableStringify(profile));
  return profile;
}

function validateDirectProviderMetadataProfile(profile = {}) {
  const findings = [];
  if (!isPlainObject(profile) || profile.schema !== DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA) {
    findings.push({ field: "schema", reason: "schema_mismatch" });
    return findings;
  }
  for (const model of arrayValue(profile.modelCatalog?.items)) {
    const efforts = new Set(arrayValue(model.supportedReasoningEfforts).map((entry) => normalizeString(entry.reasoningEffort, "")).filter(Boolean));
    if (model.defaultReasoningEffort && efforts.size && !efforts.has(model.defaultReasoningEffort)) {
      findings.push({ field: `model:${model.id}:defaultReasoningEffort`, reason: "default_not_supported" });
    }
    const tiers = new Set(arrayValue(model.serviceTiers).map((entry) => normalizeString(entry.id, "")).filter(Boolean));
    if (model.defaultServiceTier && tiers.size && !tiers.has(model.defaultServiceTier)) {
      findings.push({ field: `model:${model.id}:defaultServiceTier`, reason: "default_not_supported" });
    }
  }
  if (profile.rawTokenIncluded || profile.rawAccountIdIncluded || profile.rawEmailIncluded || profile.rawProviderPayloadIncluded || profile.rawEndpointIncluded) {
    findings.push({ field: "privacy", reason: "raw_exposure_flagged" });
  }
  return findings;
}

function compareProfiles(previous = null, next = null) {
  if (!isPlainObject(previous) || !isPlainObject(next)) return [];
  const changes = [];
  const previousModels = new Map(arrayValue(previous.modelCatalog?.items).map((model) => [model.id, model]));
  const nextModels = new Map(arrayValue(next.modelCatalog?.items).map((model) => [model.id, model]));
  for (const id of nextModels.keys()) {
    if (!previousModels.has(id)) changes.push({ field: `modelCatalog.items.${id}`, status: "added" });
  }
  for (const id of previousModels.keys()) {
    if (!nextModels.has(id)) changes.push({ field: `modelCatalog.items.${id}`, status: "removed" });
  }
  for (const [id, model] of nextModels.entries()) {
    const previousModel = previousModels.get(id);
    if (!previousModel) continue;
    for (const field of ["defaultReasoningEffort", "defaultServiceTier", "contextWindow", "maxContextWindow", "hidden", "availabilityState"]) {
      if (String(previousModel[field] ?? "") !== String(model[field] ?? "")) {
        changes.push({ field: `modelCatalog.items.${id}.${field}`, status: "changed" });
      }
    }
    for (const field of ["supportedReasoningEfforts", "serviceTiers", "inputModalities"]) {
      if (stableStringify(previousModel[field] ?? []) !== stableStringify(model[field] ?? [])) {
        changes.push({ field: `modelCatalog.items.${id}.${field}`, status: "changed" });
      }
    }
  }
  return changes;
}

function buildDirectMetadataDriftReport(input = {}) {
  const profile = input.profile || null;
  const validationFindings = validateDirectProviderMetadataProfile(profile);
  const validation = isPlainObject(profile?.validation) ? profile.validation : {};
  const changedFields = [
    ...compareProfiles(input.previousProfile, profile),
    ...arrayValue(validation.changedFields),
  ];
  const unknownValues = arrayValue(validation.unknownValues);
  const missingRequiredFields = [
    ...arrayValue(validation.missingRequiredFields),
    ...validationFindings.map((finding) => finding.field),
  ].filter(Boolean);
  const blockedControls = [];
  const status = input.fetchStatus === "failed" || input.fetchStatus === "unavailable"
    ? "degraded"
    : missingRequiredFields.length
      ? "changed"
      : unknownValues.length || changedFields.length
        ? "changed"
        : "ok";
  const report = {
    schema: DIRECT_METADATA_DRIFT_REPORT_SCHEMA,
    reportId: `direct_metadata_drift_${sha256(stableStringify({ profileId: profile?.profileId || "", changedFields, unknownValues, missingRequiredFields })).slice(0, 24)}`,
    projectId: normalizeString(profile?.projectId || input.projectId, ""),
    observedAt: normalizeString(input.observedAt, nowIso()),
    status,
    source: normalizeString(input.source, profile?.modelCatalog?.source || "unknown"),
    fetchStatus: normalizeString(input.fetchStatus, "unknown"),
    changedFields,
    unknownValues,
    missingRequiredFields,
    blockedControls,
    cacheState: normalizeString(input.cacheState, "unknown"),
    evidenceRefs: [evidenceRef("direct_metadata_drift", "Direct metadata drift report", status === "ok" ? "accepted" : "diagnostic")],
    rawProviderPayloadIncluded: false,
    rawEndpointIncluded: false,
    rawAccountIdIncluded: false,
  };
  report.reportDigest = sha256(stableStringify(report));
  return report;
}

function cacheKeyForProject(projectId = "") {
  return normalizeString(projectId, "global").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 96) || "global";
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const response = await options.fetchImpl(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`metadata_fetch_failed_${response.status}`);
      error.status = response.status;
      error.bodyPreview = text.slice(0, 200);
      throw error;
    }
    return {
      body: text ? JSON.parse(text) : {},
      etag: response.headers?.get ? response.headers.get("etag") || "" : "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

class DirectServerMetadataAdapter {
  constructor(options = {}) {
    this.rootDir = path.resolve(normalizeString(options.rootDir, path.join(process.cwd(), ".direct-provider-metadata")));
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.authStoreFactory = options.authStoreFactory || (() => null);
    this.refreshCredentials = options.refreshCredentials || null;
    this.clientVersion = normalizeString(options.clientVersion, DEFAULT_CLIENT_VERSION);
    this.modelsEndpoint = normalizeString(options.modelsEndpoint || process.env.CODEX_DIRECT_METADATA_MODELS_ENDPOINT, DEFAULT_CODEX_MODELS_ENDPOINT);
    this.usageEndpoint = normalizeString(options.usageEndpoint || process.env.CODEX_DIRECT_METADATA_USAGE_ENDPOINT, DEFAULT_CHATGPT_WHAM_USAGE_ENDPOINT);
    this.ttlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
  }

  cachePath(projectId = "") {
    return path.join(this.rootDir, `${cacheKeyForProject(projectId)}.json`);
  }

  readCached(projectId = "") {
    const cached = readJsonFile(this.cachePath(projectId));
    return isPlainObject(cached) ? cached : null;
  }

  writeCached(projectId = "", payload = {}) {
    writeJsonAtomic(this.cachePath(projectId), payload);
  }

  cachedStatus(projectId = "") {
    const cached = this.readCached(projectId);
    if (!cached?.profile) {
      const profile = buildDirectProviderMetadataProfile({
        projectId,
        modelSource: "unknown",
        generatedAt: nowIso(),
      });
      return {
        profile,
        driftReport: buildDirectMetadataDriftReport({ projectId, profile, fetchStatus: "unavailable", cacheState: "missing" }),
        cacheState: "missing",
      };
    }
    const ageMs = Date.now() - (Date.parse(cached.updatedAt || cached.profile.generatedAt || "") || 0);
    const cacheState = ageMs <= this.ttlMs ? "fresh" : "stale";
    return {
      profile: cached.profile,
      driftReport: cached.driftReport || buildDirectMetadataDriftReport({ projectId, profile: cached.profile, fetchStatus: "cache", cacheState }),
      cacheState,
    };
  }

  async refreshForProject(project = {}, options = {}) {
    const projectId = normalizeString(project.id || options.projectId, "");
    const previous = this.readCached(projectId);
    const authStore = typeof this.authStoreFactory === "function" ? this.authStoreFactory() : null;
    let credentials = null;
    let authStatus = null;
    const readAuthState = () => {
      try {
        return {
          credentials: authStore && typeof authStore.readCredentials === "function" ? authStore.readCredentials() : null,
          authStatus: authStore && typeof authStore.readStatus === "function" ? authStore.readStatus() : null,
        };
      } catch {
        return { credentials: null, authStatus: null };
      }
    };
    try {
      ({ credentials, authStatus } = readAuthState());
      if (shouldRefreshCredentials(credentials, options)) {
        if (typeof this.refreshCredentials !== "function") {
          throw new Error("direct_metadata_refresh_unavailable");
        }
        const refreshResult = await this.refreshCredentials({
          authStore,
          credentials,
          reason: options.forceRefresh === true ? "forced" : "expiring",
        });
        if (refreshResult?.ok === false) {
          const error = new Error(normalizeString(refreshResult.reason || refreshResult.status, "direct_metadata_refresh_failed"));
          error.code = "direct_metadata_refresh_failed";
          throw error;
        }
        ({ credentials, authStatus } = readAuthState());
      }
    } catch {
      ({ credentials, authStatus } = readAuthState());
    }
    if (!credentials?.accessToken && !credentials?.access_token) {
      const profile = buildDirectProviderMetadataProfile({
        projectId,
        authStatus: authStatus || { status: "unauthenticated" },
        modelSource: previous?.profile ? "cache" : "unknown",
        rawModelsResponse: previous?.profile?.modelCatalog?.items || [],
      });
      const driftReport = buildDirectMetadataDriftReport({
        projectId,
        profile,
        previousProfile: previous?.profile || null,
        fetchStatus: "unavailable",
        cacheState: previous?.profile ? "stale" : "missing",
        source: "auth_unavailable",
      });
      return { profile, driftReport, cacheState: previous?.profile ? "stale" : "missing", fetched: false };
    }
    if (typeof this.fetchImpl !== "function") {
      const profile = previous?.profile || buildDirectProviderMetadataProfile({ projectId, authStatus, credentials, modelSource: "unknown" });
      const driftReport = buildDirectMetadataDriftReport({ projectId, profile, previousProfile: previous?.profile || null, fetchStatus: "unavailable", cacheState: previous?.profile ? "stale" : "missing", source: "fetch_unavailable" });
      return { profile, driftReport, cacheState: previous?.profile ? "stale" : "missing", fetched: false };
    }
    const url = new URL(this.modelsEndpoint);
    if (!url.searchParams.has("client_version")) url.searchParams.set("client_version", this.clientVersion);
    const headers = {
      Authorization: `Bearer ${credentials.accessToken || credentials.access_token}`,
      Accept: "application/json",
    };
    const rawAccountId = normalizeString(credentials.accountId || credentials.account_id, "");
    if (rawAccountId) headers["ChatGPT-Account-Id"] = rawAccountId;
    const fetchMetadata = async (requestHeaders) => {
      const models = await fetchJsonWithTimeout(url.toString(), {
        fetchImpl: this.fetchImpl,
        headers: requestHeaders,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      let usage = { body: null, etag: "" };
      try {
        usage = await fetchJsonWithTimeout(this.usageEndpoint, {
          fetchImpl: this.fetchImpl,
          headers: requestHeaders,
          timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        });
      } catch {}
      return { models, usage };
    };
    try {
      let { models, usage } = await fetchMetadata(headers);
      const generatedAt = nowIso();
      const profile = buildDirectProviderMetadataProfile({
        projectId,
        authStatus,
        credentials,
        rawModelsResponse: models.body,
        rawRateLimits: usage.body,
        rawAccountTokenProfile: usage.body,
        modelSource: "server_model_list",
        etag: models.etag,
        clientVersion: this.clientVersion,
        endpointHash: sha256(this.modelsEndpoint),
        generatedAt,
        active: {
          model: project.surfaceBinding?.codex?.model,
          reasoningEffort: project.surfaceBinding?.codex?.reasoningEffort,
          serviceTier: project.surfaceBinding?.codex?.serviceTier,
          approvalPolicy: project.surfaceBinding?.codex?.approvalPolicy,
          permissionProfile: project.surfaceBinding?.codex?.sandboxMode,
        },
        transport: {
          streamKind: "sse",
          servedMethods: ["model/list", "account/read", "account/rateLimits/read", "account/usage/read"],
        },
      });
      const driftReport = buildDirectMetadataDriftReport({
        projectId,
        profile,
        previousProfile: previous?.profile || null,
        fetchStatus: "ok",
        cacheState: "fresh",
        source: "server_model_list",
        observedAt: generatedAt,
      });
      this.writeCached(projectId, {
        schema: "direct_provider_metadata_cache@1",
        projectId,
        updatedAt: generatedAt,
        profile,
        driftReport,
      });
      return { profile, driftReport, cacheState: "fresh", fetched: true };
    } catch (error) {
      if (error?.status === 401 && typeof this.refreshCredentials === "function" && !options._retriedAfterAuth) {
        try {
          const refreshResult = await this.refreshCredentials({
            authStore,
            credentials,
            reason: "metadata_401",
            forceRefresh: true,
          });
          if (refreshResult?.ok !== false) {
            return this.refreshForProject(project, { ...options, forceRefresh: false, _retriedAfterAuth: true });
          }
        } catch {}
      }
      const profile = previous?.profile || buildDirectProviderMetadataProfile({
        projectId,
        authStatus,
        credentials,
        modelSource: "unknown",
        generatedAt: nowIso(),
      });
      const driftReport = buildDirectMetadataDriftReport({
        projectId,
        profile,
        previousProfile: previous?.profile || null,
        fetchStatus: "failed",
        cacheState: previous?.profile ? "stale" : "missing",
        source: normalizeString(error?.code || error?.message, "metadata_fetch_failed"),
      });
      return { profile, driftReport, cacheState: previous?.profile ? "stale" : "missing", fetched: false, error };
    }
  }
}

module.exports = {
  DEFAULT_CODEX_MODELS_ENDPOINT,
  DEFAULT_CHATGPT_WHAM_USAGE_ENDPOINT,
  DIRECT_METADATA_DRIFT_REPORT_SCHEMA,
  DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA,
  DirectServerMetadataAdapter,
  buildDirectMetadataDriftReport,
  buildDirectProviderMetadataProfile,
  normalizeModelDescriptor,
  validateDirectProviderMetadataProfile,
};
