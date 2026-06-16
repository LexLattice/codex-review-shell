"use strict";

const crypto = require("node:crypto");

const RUNTIME_ANALYTICS_PROJECTION_SCHEMA = "runtime_analytics_projection@1";
const RUNTIME_ANALYTICS_ADAPTER_VERSION = "runtime-analytics-adapter@1";

const RUNTIME_PATHS = new Set([
  "app-server",
  "direct-text",
  "direct-tool",
  "direct-implementation",
  "unknown",
]);
const ADAPTER_KINDS = new Set(["appserver", "direct", "unknown"]);
const ANALYTICS_SOURCES = new Set([
  "appserver_native",
  "direct_native",
  "derived_from_appserver",
  "derived_from_direct",
  "unavailable",
]);
const CONFIDENCE_VALUES = new Set([
  "provider_exact",
  "runtime_exact",
  "derived",
  "estimated",
  "unavailable",
  "unknown",
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampPercent(value) {
  const number = nullableNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function nowIso() {
  return new Date().toISOString();
}

function enumValue(value, allowed, fallback) {
  const text = normalizeString(value, "");
  return allowed.has(text) ? text : fallback;
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function baseProjection(input = {}) {
  const generatedAt = normalizeString(input.generatedAt, nowIso());
  const runtimePath = enumValue(input.runtimePath, RUNTIME_PATHS, "unknown");
  const adapterKind = enumValue(input.adapterKind, ADAPTER_KINDS, "unknown");
  return {
    schema: RUNTIME_ANALYTICS_PROJECTION_SCHEMA,
    adapterVersion: RUNTIME_ANALYTICS_ADAPTER_VERSION,
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    runtimePath,
    status: "unavailable",
    generatedAt,
    sourcePosture: {
      adapterKind,
      primarySource: "unavailable",
      confidence: "unavailable",
      freshness: "unknown",
      observedAt: "",
    },
    tokens: emptyTokens(),
    context: emptyContext(),
    turns: emptyTurns(),
    tools: emptyTools(),
    requests: emptyRequests(),
    quota: emptyQuota(),
    series: {
      token_mix: [],
      tool_kind_mix: [],
      request_kind_mix: [],
      turn_status_mix: [],
    },
    turnUsageRows: [],
    agentUsageRows: [],
    parentTurnAgentEdges: [],
    blockers: [],
    evidenceRefs: [],
    privacy: rendererSafePrivacy(),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function rendererSafePrivacy() {
  return {
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderFrameIncluded: false,
    rawTokenDetailsIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    billingGrade: false,
    costComputed: false,
  };
}

function emptyTokens(blockers = ["token_usage_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    inputTokens: null,
    cachedInputTokens: null,
    nonCachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    usageScope: "",
    billingGrade: false,
    evidenceRefs: [],
    blockers,
  };
}

function emptyContext(blockers = ["context_usage_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    modelContextWindow: null,
    inputTokens: null,
    usedPercent: null,
    evidenceRefs: [],
    blockers,
  };
}

function emptyTurns(blockers = ["turn_timing_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    started: 0,
    completed: 0,
    active: 0,
    durationMs: null,
    timeToFirstTokenMs: null,
    evidenceRefs: [],
    blockers,
  };
}

function emptyTools(blockers = ["tool_activity_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    total: 0,
    completed: 0,
    failed: 0,
    commands: 0,
    patches: 0,
    subagents: 0,
    byKind: [],
    evidenceRefs: [],
    blockers,
  };
}

function emptyRequests(blockers = ["server_request_activity_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    total: 0,
    pending: 0,
    resolved: 0,
    failed: 0,
    byKind: [],
    evidenceRefs: [],
    blockers,
  };
}

function emptyQuota(blockers = ["quota_unavailable"]) {
  return {
    status: "unavailable",
    source: "unavailable",
    confidence: "unavailable",
    observedAt: "",
    planType: "",
    windows: [],
    evidenceRefs: [],
    blockers,
  };
}

function evidenceRef(source, label, observedAt = "") {
  return {
    source,
    label,
    observedAt,
    refDigest: stableDigest([source, label, observedAt]).slice(0, 16),
  };
}

function freshnessFor(observedAt, generatedAt) {
  const observedMs = Date.parse(observedAt || "");
  const generatedMs = Date.parse(generatedAt || "");
  if (!Number.isFinite(observedMs) || !Number.isFinite(generatedMs)) return "unknown";
  return generatedMs - observedMs > 10 * 60 * 1000 ? "stale" : "fresh";
}

function normalizeConfidence(value, fallback = "unknown") {
  return enumValue(value, CONFIDENCE_VALUES, fallback);
}

function firstObservedAt(...values) {
  return values.map((value) => normalizeString(value, "")).find(Boolean) || "";
}

function normalizeSeries(value) {
  return arrayOrEmpty(value)
    .map((point) => ({
      xValue: normalizeString(point?.xValue, "unknown"),
      yValue: numberOrZero(point?.yValue),
    }))
    .filter((point) => point.xValue && point.yValue > 0);
}

function statusFromCount(count, unavailable = "unavailable") {
  return numberOrZero(count) > 0 ? "available" : unavailable;
}

function quotaWindowFromRateLimitWindow(value, windowKind, source, confidence) {
  if (!isPlainObject(value)) return null;
  const usedPercent = clampPercent(value.usedPercent);
  const resetsAt = normalizeString(value.resetsAt || value.resetAt, "");
  const windowDurationMins = nullableNumber(value.windowDurationMins);
  const name = normalizeString(value.name || value.windowName || value.rateLimitReachedType, "");
  return {
    windowKind,
    windowId: normalizeString(value.windowId || name || windowKind, windowKind),
    name,
    usedPercent,
    resetsAt,
    windowDurationMins,
    source,
    confidence,
  };
}

function normalizeQuotaWindows(windows, source, confidence) {
  const seen = new Set();
  const rows = [];
  for (const window of arrayOrEmpty(windows)) {
    if (!isPlainObject(window)) continue;
    const windowKind = normalizeString(window.windowKind || window.kind || window.name, "unknown");
    const windowId = normalizeString(window.windowId || window.id || window.name || windowKind, windowKind);
    const key = `${windowKind}:${windowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      windowKind,
      windowId,
      name: normalizeString(window.name, ""),
      usedPercent: clampPercent(window.usedPercent),
      resetsAt: normalizeString(window.resetsAt || window.resetAt, ""),
      windowDurationMins: nullableNumber(window.windowDurationMins),
      source,
      confidence,
    });
  }
  return rows;
}

function normalizeRateLimitMapWindows(map, source, confidence) {
  const rows = [];
  if (!isPlainObject(map)) return rows;
  for (const [limitId, snapshot] of Object.entries(map)) {
    if (!isPlainObject(snapshot)) continue;
    const prefix = normalizeString(snapshot.limitId || snapshot.limit_id || limitId, limitId || "limit");
    const primary = quotaWindowFromRateLimitWindow(snapshot.primary || snapshot.primaryWindow || snapshot.primary_window, "five_hour", source, confidence);
    const secondary = quotaWindowFromRateLimitWindow(snapshot.secondary || snapshot.secondaryWindow || snapshot.secondary_window, "weekly", source, confidence);
    if (primary) rows.push({ ...primary, windowId: `${prefix}:primary` });
    if (secondary) rows.push({ ...secondary, windowId: `${prefix}:secondary` });
  }
  return rows;
}

function providerMetadataQuotaWindows(profile) {
  if (!isPlainObject(profile)) return [];
  const usage = isPlainObject(profile.usage) ? profile.usage : {};
  const rateLimits = isPlainObject(profile.rateLimits) ? profile.rateLimits : {};
  const quota = isPlainObject(usage.quota) ? usage.quota : {};
  const candidates = [
    usage.quotaWindows,
    usage.windows,
    usage.rateLimitWindows,
    quota.windows,
    quota.quotaWindows,
    rateLimits.windows,
    profile.quotaWindows,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  const windows = [];
  for (const key of ["primary", "secondary", "weekly", "fiveHour", "five_hour"]) {
    const candidate = usage[key] || rateLimits[key] || profile[key];
    if (isPlainObject(candidate)) {
      windows.push({ ...candidate, windowKind: key });
    }
  }
  return windows;
}

function providerMetadataModelContextWindow(profile, modelId = "") {
  if (!isPlainObject(profile)) return null;
  const usage = isPlainObject(profile.usage) ? profile.usage : {};
  const context = isPlainObject(usage.context) ? usage.context : {};
  const usageWindow = nullableNumber(context.modelContextWindow || context.contextWindow || context.maxContextWindow);
  if (usageWindow !== null && usageWindow > 0) return usageWindow;
  const catalog = isPlainObject(profile.modelCatalog) ? profile.modelCatalog : {};
  const activeModel = normalizeString(modelId || profile.runtimeSettings?.active?.model || catalog.defaultModel, "");
  const models = arrayOrEmpty(catalog.items);
  const selected = models.find((model) => (
    normalizeString(model?.id, "") === activeModel ||
    normalizeString(model?.model, "") === activeModel
  )) || models.find((model) => model?.isDefault || model?.is_default) || models[0] || null;
  const modelWindow = nullableNumber(selected?.contextWindow || selected?.maxContextWindow || selected?.modelContextWindow);
  return modelWindow !== null && modelWindow > 0 ? modelWindow : null;
}

function finalizeProjection(projection) {
  const observedAt = firstObservedAt(
    projection.tokens.observedAt,
    projection.context.observedAt,
    projection.quota.observedAt,
    projection.turns.observedAt,
    projection.tools.observedAt,
    projection.requests.observedAt,
  );
  const sources = [
    projection.tokens.source,
    projection.context.source,
    projection.quota.source,
    projection.turns.source,
    projection.tools.source,
    projection.requests.source,
  ].filter((source) => source && source !== "unavailable");
  const confidences = [
    projection.tokens.confidence,
    projection.context.confidence,
    projection.quota.confidence,
    projection.turns.confidence,
    projection.tools.confidence,
    projection.requests.confidence,
  ].filter((confidence) => confidence && confidence !== "unavailable");
  projection.status = sources.length
    ? projection.blockers.length
      ? "partial"
      : "available"
    : "unavailable";
  projection.sourcePosture = {
    ...projection.sourcePosture,
    primarySource: sources[0] || "unavailable",
    confidence: confidences.includes("provider_exact")
      ? "provider_exact"
      : confidences.includes("runtime_exact")
        ? "runtime_exact"
        : confidences.includes("derived")
          ? "derived"
          : confidences[0] || "unavailable",
    freshness: freshnessFor(observedAt, projection.generatedAt),
    observedAt,
  };
  projection.projectionDigest = stableDigest([
    projection.schema,
    projection.projectId,
    projection.threadId,
    projection.runtimePath,
    projection.sourcePosture,
    projection.tokens,
    projection.context,
    projection.quota,
    projection.turns,
    projection.tools,
  ]);
  return projection;
}

function buildAppServerRuntimeAnalyticsProjection(input = {}) {
  const projection = baseProjection({
    ...input,
    adapterKind: "appserver",
    runtimePath: input.runtimePath || "app-server",
  });
  const usage = isPlainObject(input.usageLedgerAnalytics || input.appServerUsageLedgerAnalytics)
    ? (input.usageLedgerAnalytics || input.appServerUsageLedgerAnalytics)
    : null;
  if (!usage || usage.status === "not_configured" || usage.status === "failed") {
    projection.blockers.push(normalizeString(usage?.reason, "appserver_usage_ledger_unavailable"));
    return finalizeProjection(projection);
  }

  const token = isPlainObject(usage.tokens) ? usage.tokens : {};
  const tokenAvailable = token.status === "snapshot_available" || numberOrZero(token.tokenRows) > 0;
  if (tokenAvailable) {
    const confidence = normalizeConfidence(token.confidence, normalizeConfidence(usage.confidence, "runtime_exact"));
    projection.tokens = {
      status: "available",
      source: "appserver_native",
      confidence,
      observedAt: normalizeString(token.latestSnapshotAt || usage.lastObservedAt, ""),
      inputTokens: nullableNumber(token.inputTokens),
      cachedInputTokens: nullableNumber(token.cachedInputTokens),
      nonCachedInputTokens: nullableNumber(token.nonCachedInputTokens),
      outputTokens: nullableNumber(token.outputTokens),
      reasoningTokens: nullableNumber(token.reasoningOutputTokens),
      totalTokens: nullableNumber(token.totalTokens),
      usageScope: normalizeString(token.usageScope, ""),
      billingGrade: false,
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "token_usage", token.latestSnapshotAt || usage.lastObservedAt)],
      blockers: [],
    };
  } else {
    projection.blockers.push("appserver_token_usage_unavailable");
  }

  const modelContextWindow = nullableNumber(token.modelContextWindow);
  const inputTokens = nullableNumber(token.inputTokens);
  if (modelContextWindow && inputTokens !== null) {
    projection.context = {
      status: "available",
      source: "derived_from_appserver",
      confidence: tokenAvailable ? "derived" : "estimated",
      observedAt: normalizeString(token.latestSnapshotAt || usage.lastObservedAt, ""),
      modelContextWindow,
      inputTokens,
      usedPercent: modelContextWindow > 0 ? clampPercent((inputTokens / modelContextWindow) * 100) : null,
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "context_from_token_window", token.latestSnapshotAt || usage.lastObservedAt)],
      blockers: [],
    };
  } else {
    projection.blockers.push("appserver_context_window_unavailable");
  }

  const turns = isPlainObject(usage.turns) ? usage.turns : {};
  if (numberOrZero(turns.started) || numberOrZero(turns.completed)) {
    projection.turns = {
      status: "available",
      source: "derived_from_appserver",
      confidence: "derived",
      observedAt: normalizeString(usage.lastObservedAt, ""),
      started: numberOrZero(turns.started),
      completed: numberOrZero(turns.completed),
      active: numberOrZero(turns.active),
      durationMs: nullableNumber(turns.durationMs),
      timeToFirstTokenMs: nullableNumber(turns.timeToFirstTokenMs),
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "turn_events", usage.lastObservedAt)],
      blockers: [],
    };
  }

  const tools = isPlainObject(usage.tools) ? usage.tools : {};
  if (numberOrZero(tools.total)) {
    projection.tools = {
      status: "available",
      source: "derived_from_appserver",
      confidence: "derived",
      observedAt: normalizeString(usage.lastObservedAt, ""),
      total: numberOrZero(tools.total),
      completed: numberOrZero(tools.completed),
      failed: numberOrZero(tools.failed),
      commands: numberOrZero(tools.commands),
      patches: numberOrZero(tools.patches),
      subagents: numberOrZero(tools.subagents),
      byKind: normalizeSeries(tools.byKind),
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "tool_events", usage.lastObservedAt)],
      blockers: [],
    };
  }

  const requests = isPlainObject(usage.requests) ? usage.requests : {};
  if (numberOrZero(requests.total)) {
    projection.requests = {
      status: "available",
      source: "derived_from_appserver",
      confidence: "derived",
      observedAt: normalizeString(usage.lastObservedAt, ""),
      total: numberOrZero(requests.total),
      pending: numberOrZero(requests.pending),
      resolved: numberOrZero(requests.resolved),
      failed: numberOrZero(requests.failed),
      byKind: normalizeSeries(requests.byKind),
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "server_request_events", usage.lastObservedAt)],
      blockers: [],
    };
  }

  const rateLimits = isPlainObject(usage.rateLimits) ? usage.rateLimits : {};
  const quotaWindows = normalizeRateLimitMapWindows(
    rateLimits.rateLimitsByLimitId || rateLimits.rate_limits_by_limit_id,
    "appserver_native",
    "provider_exact",
  );
  if (!quotaWindows.length) {
    quotaWindows.push(...[
      quotaWindowFromRateLimitWindow(rateLimits.primary, "five_hour", "appserver_native", "provider_exact"),
      quotaWindowFromRateLimitWindow(rateLimits.secondary, "weekly", "appserver_native", "provider_exact"),
    ].filter(Boolean));
  }
  if (rateLimits.status === "available" && quotaWindows.length) {
    projection.quota = {
      status: "available",
      source: "appserver_native",
      confidence: "provider_exact",
      observedAt: normalizeString(rateLimits.observedAt, ""),
      planType: normalizeString(rateLimits.planType, ""),
      windows: quotaWindows,
      evidenceRefs: [evidenceRef("codex_usage_ledger@1", "rate_limit_snapshot", rateLimits.observedAt)],
      blockers: [],
    };
  } else {
    projection.blockers.push("appserver_quota_unavailable");
  }

  projection.series = {
    token_mix: normalizeSeries(usage.series?.token_mix),
    tool_kind_mix: normalizeSeries(usage.series?.tool_kind_mix),
    request_kind_mix: normalizeSeries(usage.series?.request_kind_mix),
    turn_status_mix: normalizeSeries(usage.series?.turn_status_mix),
  };
  projection.evidenceRefs.push(evidenceRef("codex_usage_ledger@1", "usage_ledger_analytics", usage.lastObservedAt));
  return finalizeProjection(projection);
}

function buildDirectRuntimeAnalyticsProjection(input = {}) {
  const projection = baseProjection({
    ...input,
    adapterKind: "direct",
    runtimePath: input.runtimePath || "direct-implementation",
  });
  const snapshot = isPlainObject(input.directFactSnapshot) ? input.directFactSnapshot : {};
  const summary = isPlainObject(input.directFactSummary)
    ? input.directFactSummary
    : isPlainObject(snapshot.summary)
      ? snapshot.summary
      : {};
  const counts = isPlainObject(summary.counts) ? summary.counts : {};
  const tokenTotals = isPlainObject(summary.tokenTotals) ? summary.tokenTotals : {};
  const observedAt = normalizeString(snapshot.lastObservedAt || summary.lastObservedAt, "");
  const nonMissingUsageFacts = numberOrZero(counts.nonMissingUsageFacts);
  const hasKnownTokenTotals = [
    tokenTotals.inputTokens,
    tokenTotals.cachedInputTokens,
    tokenTotals.nonCachedInputTokens,
    tokenTotals.outputTokens,
    tokenTotals.reasoningTokens,
    tokenTotals.totalTokens,
  ].some((value) => nullableNumber(value) !== null && numberOrZero(value) > 0);

  if (nonMissingUsageFacts > 0 || hasKnownTokenTotals) {
    projection.tokens = {
      status: "available",
      source: "direct_native",
      confidence: "runtime_exact",
      observedAt,
      inputTokens: nullableNumber(tokenTotals.inputTokens),
      cachedInputTokens: nullableNumber(tokenTotals.cachedInputTokens),
      nonCachedInputTokens: nullableNumber(tokenTotals.nonCachedInputTokens),
      outputTokens: nullableNumber(tokenTotals.outputTokens),
      reasoningTokens: nullableNumber(tokenTotals.reasoningTokens),
      totalTokens: nullableNumber(tokenTotals.totalTokens),
      usageScope: "direct_fact_summary",
      billingGrade: false,
      evidenceRefs: [evidenceRef("direct_runtime_analytics_facts@1", "turn_usage_facts", observedAt)],
      blockers: [],
    };
  } else {
    projection.blockers.push("direct_token_usage_unavailable");
  }

  const latestContext = isPlainObject(snapshot.latestContext) ? snapshot.latestContext : {};
  if (latestContext.status === "available" || numberOrZero(counts.contextFacts) > 0) {
    const metadataContextWindow = providerMetadataModelContextWindow(input.directProviderMetadataProfile, latestContext.model || input.model);
    const rawContextWindow = nullableNumber(latestContext.modelContextWindow);
    const contextWindow = rawContextWindow || metadataContextWindow;
    const contextInputTokens = nullableNumber(latestContext.inputTokens);
    const rawUsedPercent = clampPercent(latestContext.usedPercent);
    const derivedUsedPercent = contextWindow && contextInputTokens !== null
      ? clampPercent((contextInputTokens / contextWindow) * 100)
      : null;
    const contextBlockers = latestContext.status === "available" ? [] : ["latest_context_fact_unavailable"];
    if (!rawContextWindow && metadataContextWindow) contextBlockers.push("context_window_filled_from_provider_metadata");
    projection.context = {
      status: latestContext.status === "available" ? "available" : "partial",
      source: "derived_from_direct",
      confidence: normalizeConfidence(latestContext.confidence, "derived"),
      observedAt: normalizeString(latestContext.observedAt || observedAt, ""),
      modelContextWindow: contextWindow,
      inputTokens: contextInputTokens,
      usedPercent: rawUsedPercent ?? derivedUsedPercent,
      evidenceRefs: [
        evidenceRef("direct_runtime_analytics_facts@1", "context_analytics_fact", latestContext.observedAt || observedAt),
        ...(metadataContextWindow ? [evidenceRef("direct_provider_metadata_profile@1", "model_context_window", input.directProviderMetadataProfile?.generatedAt)] : []),
      ],
      blockers: contextBlockers,
    };
    if (latestContext.status !== "available") projection.blockers.push("direct_context_latest_unavailable");
  } else {
    projection.blockers.push("direct_context_usage_unavailable");
  }

  const timing = isPlainObject(snapshot.timing) ? snapshot.timing : {};
  if (numberOrZero(counts.timingMarks) > 0) {
    projection.turns = {
      status: "available",
      source: "derived_from_direct",
      confidence: "derived",
      observedAt,
      started: numberOrZero(timing.started),
      completed: numberOrZero(timing.completed),
      active: numberOrZero(timing.active),
      durationMs: nullableNumber(timing.durationMs),
      timeToFirstTokenMs: nullableNumber(timing.timeToFirstTokenMs),
      evidenceRefs: [evidenceRef("direct_runtime_analytics_facts@1", "runtime_timing_marks", observedAt)],
      blockers: [],
    };
  }

  const tools = isPlainObject(snapshot.tools) ? snapshot.tools : {};
  if (numberOrZero(counts.toolFacts) > 0 || numberOrZero(tools.total) > 0) {
    projection.tools = {
      status: "available",
      source: "derived_from_direct",
      confidence: "derived",
      observedAt,
      total: numberOrZero(tools.total || counts.toolFacts),
      completed: numberOrZero(tools.completed),
      failed: numberOrZero(tools.failed),
      commands: numberOrZero(tools.commands),
      patches: numberOrZero(tools.patches),
      subagents: numberOrZero(tools.subagents),
      byKind: normalizeSeries(tools.byKind),
      evidenceRefs: [evidenceRef("direct_runtime_analytics_facts@1", "tool_analytics_facts", observedAt)],
      blockers: [],
    };
  }

  const snapshotQuotaWindows = normalizeQuotaWindows(snapshot.quotaWindows, "direct_native", "provider_exact");
  const metadataQuotaWindows = normalizeQuotaWindows(providerMetadataQuotaWindows(input.directProviderMetadataProfile), "direct_native", "provider_exact");
  const quotaWindows = snapshotQuotaWindows.length ? snapshotQuotaWindows : metadataQuotaWindows;
  if (quotaWindows.length) {
    const quotaObservedAt = normalizeString(snapshot.quotaObservedAt || observedAt, "");
    projection.quota = {
      status: "available",
      source: "direct_native",
      confidence: "provider_exact",
      observedAt: quotaObservedAt,
      planType: normalizeString(snapshot.quotaPlanType || input.directProviderMetadataProfile?.account?.planType || "", ""),
      windows: quotaWindows,
      evidenceRefs: [evidenceRef("direct_runtime_analytics_facts@1", "quota_snapshot_facts", quotaObservedAt)],
      blockers: [],
    };
  } else {
    projection.blockers.push("direct_quota_unavailable");
  }

  projection.series = {
    token_mix: [
      { xValue: "input", yValue: Math.max(0, numberOrZero(tokenTotals.nonCachedInputTokens)) },
      { xValue: "cached", yValue: Math.max(0, numberOrZero(tokenTotals.cachedInputTokens)) },
      { xValue: "output", yValue: Math.max(0, numberOrZero(tokenTotals.outputTokens)) },
      { xValue: "reasoning", yValue: Math.max(0, numberOrZero(tokenTotals.reasoningTokens)) },
    ].filter((point) => point.yValue > 0),
    tool_kind_mix: normalizeSeries(tools.byKind),
    request_kind_mix: [],
    turn_status_mix: [
      { xValue: "completed", yValue: numberOrZero(timing.completed) },
      { xValue: "active", yValue: numberOrZero(timing.active) },
    ].filter((point) => point.yValue > 0),
  };
  projection.turnUsageRows = arrayOrEmpty(snapshot.turnUsageRows).slice(0, 80);
  projection.agentUsageRows = arrayOrEmpty(snapshot.agentUsageRows).slice(0, 40);
  projection.parentTurnAgentEdges = arrayOrEmpty(snapshot.parentTurnAgentEdges).slice(0, 80);
  projection.evidenceRefs.push(evidenceRef("direct_runtime_analytics_facts@1", "direct_fact_snapshot", observedAt));
  return finalizeProjection(projection);
}

function buildRuntimeAnalyticsProjection(input = {}) {
  const adapterKind = normalizeString(input.adapterKind, "");
  const runtimePath = normalizeString(input.runtimePath, "");
  if (adapterKind === "appserver" || runtimePath === "app-server" || input.usageLedgerAnalytics || input.appServerUsageLedgerAnalytics) {
    return buildAppServerRuntimeAnalyticsProjection(input);
  }
  if (adapterKind === "direct" || runtimePath.startsWith("direct-") || input.directFactSnapshot || input.directFactSummary) {
    return buildDirectRuntimeAnalyticsProjection(input);
  }
  return finalizeProjection(baseProjection(input));
}

module.exports = {
  RUNTIME_ANALYTICS_ADAPTER_VERSION,
  RUNTIME_ANALYTICS_PROJECTION_SCHEMA,
  buildAppServerRuntimeAnalyticsProjection,
  buildDirectRuntimeAnalyticsProjection,
  buildRuntimeAnalyticsProjection,
};
