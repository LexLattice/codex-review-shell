"use strict";

const crypto = require("node:crypto");

const DIRECT_AGENT_USAGE_LEDGER_SCHEMA = "direct_agent_usage_ledger@1";
const DIRECT_AGENT_USAGE_SUMMARY_PROJECTION_SCHEMA = "direct_agent_usage_summary_projection@1";
const DIRECT_AGENT_USAGE_LEDGER_VERSION = "direct-agent-usage-ledger@1";

const AGENT_KINDS = new Set(["primary_agent", "sub_worker", "sub_agent_worker", "unknown_agent"]);
const ROW_KINDS = new Set(["terminal", "delta", "missing", "diagnostic"]);
const USAGE_SOURCES = new Set(["response_completed_usage", "provider_usage_delta", "missing", "diagnostic_report"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 220) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["ledgerDigest", "projectionDigest", "rowDigest", "summaryDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function digestFor(domain, value) {
  return `sha256:${sha256(`${domain}\0${stableStringify(value)}`)}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeAgentKind(value) {
  const raw = normalizeString(value, "unknown_agent");
  if (raw === "main_agent") return "primary_agent";
  if (AGENT_KINDS.has(raw)) return raw;
  return "unknown_agent";
}

function normalizeRowKind(value) {
  const raw = normalizeString(value, "diagnostic");
  return ROW_KINDS.has(raw) ? raw : "diagnostic";
}

function normalizeUsageSource(value, rowKind = "diagnostic") {
  const raw = normalizeString(value, rowKind === "missing" ? "missing" : "diagnostic_report");
  return USAGE_SOURCES.has(raw) ? raw : "diagnostic_report";
}

function parseTimeMs(value) {
  const text = normalizeString(value, "");
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationMsForTurn(turn = {}) {
  const started = parseTimeMs(turn.streamStartedAt || turn.requestBuiltAt || turn.createdAt);
  const ended = parseTimeMs(turn.completedAt || turn.failedAt || turn.abortedAt || turn.updatedAt);
  return started && ended && ended >= started ? ended - started : 0;
}

function isTerminalTurn(turn = {}) {
  if (normalizeString(turn.completedAt || turn.failedAt || turn.abortedAt, "")) return true;
  const status = normalizeString(turn.status || turn.lifecycleStatus || turn.state, "").toLowerCase();
  return ["completed", "complete", "failed", "error", "aborted", "cancelled", "canceled"].includes(status);
}

function emptyTotals() {
  return {
    rowCount: 0,
    turnCount: 0,
    inputTokensKnown: 0,
    cachedInputTokensKnown: 0,
    nonCachedInputTokensKnown: 0,
    outputTokensKnown: 0,
    reasoningTokensKnown: 0,
    totalTokensKnown: 0,
    missingUsageRowCount: 0,
    durationMsKnown: 0,
  };
}

function addTokenTotals(totals, row = {}) {
  totals.rowCount += 1;
  if (row.usageRecordKind === "missing" || row.usageSource === "missing") {
    totals.missingUsageRowCount += 1;
    return totals;
  }
  totals.inputTokensKnown += numberValue(row.inputTokens, 0);
  totals.cachedInputTokensKnown += numberValue(row.cachedInputTokens, 0);
  totals.nonCachedInputTokensKnown += numberValue(row.nonCachedInputTokens, 0);
  totals.outputTokensKnown += numberValue(row.outputTokens, 0);
  totals.reasoningTokensKnown += numberValue(row.reasoningTokens, 0);
  totals.totalTokensKnown += numberValue(row.totalTokens, 0);
  return totals;
}

function normalizeUsageAttributionRows(turn = {}) {
  const attribution = isPlainObject(turn.usageAttribution) ? turn.usageAttribution : null;
  const rows = arrayOrEmpty(attribution?.rows);
  if (rows.length) return rows;
  if (!isTerminalTurn(turn)) return [];
  return [{
    rowId: `usage_missing_${sha256(`${turn.sessionId || ""}:${turn.turnId || ""}`).slice(0, 18)}`,
    usageSource: "missing",
    usageRecordKind: "missing",
    usageMissingReason: attribution ? "usage_attribution_without_rows" : "usage_attribution_missing",
    tokenFieldConfidence: {
      inputTokens: "missing",
      cachedInputTokens: "missing",
      nonCachedInputTokens: "missing",
      outputTokens: "missing",
      reasoningTokens: "missing",
      totalTokens: "missing",
    },
  }];
}

function requestShapeValue(turn = {}, field = "") {
  const shape = isPlainObject(turn.requestShape) ? turn.requestShape : {};
  return shape[field];
}

function workThreadIdFor(session = {}, turn = {}) {
  return normalizeString(
    turn.workThreadId ||
      turn.requestShape?.workThreadId ||
      session.workThreadId,
    "",
  );
}

function routeScopeForTurn(turn = {}) {
  const routeId = normalizeString(turn.controlledRoutingSliceId || requestShapeValue(turn, "controlledRoutingSliceId"), "");
  return {
    routeId,
    routeDigest: normalizeString(turn.controlledRoutingSliceDigest || requestShapeValue(turn, "controlledRoutingSliceDigest"), ""),
    gateState: normalizeString(turn.controlledRoutingGateState || requestShapeValue(turn, "controlledRoutingGateState"), ""),
    providerScope: normalizeString(turn.controlledRoutingProviderScope || requestShapeValue(turn, "controlledRoutingProviderScope"), ""),
    routed: Boolean(routeId),
  };
}

function agentScopeForTurn(session = {}, turn = {}, row = {}) {
  const attributionScope = isPlainObject(turn.usageAttribution?.agentScope) ? turn.usageAttribution.agentScope : {};
  const agentKind = normalizeAgentKind(row.agentKind || attributionScope.agentKind || turn.agentKind || session.agentKind);
  const agentThreadId = normalizeString(row.agentThreadId || attributionScope.agentThreadId || turn.agentThreadId || session.agentThreadId || session.sessionId, "");
  return {
    agentKind,
    agentClassKind: agentKind === "primary_agent" ? "primary_agent" : agentKind === "sub_worker" || agentKind === "sub_agent_worker" ? "sub_agent_worker" : "unknown_agent",
    agentThreadId,
    primaryThreadId: normalizeString(row.primaryThreadId || attributionScope.primaryThreadId || session.primaryThreadId || session.sessionId, ""),
    parentThreadId: normalizeString(row.parentThreadId || attributionScope.parentThreadId || turn.parentThreadId || session.parentThreadId, ""),
    agentLabel: boundedString(row.agentLabel || attributionScope.agentLabel || turn.agentLabel || session.agentLabel, 160),
    agentRole: boundedString(row.agentRole || attributionScope.agentRole || turn.agentRole || session.agentRole, 120),
    attributionSource: normalizeString(row.attributionSource || attributionScope.attributionSource, "turn_usage_attribution"),
  };
}

function buildUsageRowsForTurn(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const projectId = normalizeString(input.projectId || session.projectId, "");
  const workThreadId = workThreadIdFor(session, turn);
  const routeScope = routeScopeForTurn(turn);
  const durationMs = durationMsForTurn(turn);
  const usageRows = normalizeUsageAttributionRows(turn);
  return usageRows.map((usageRow, index) => {
    const usageRecordKind = normalizeRowKind(usageRow.usageRecordKind);
    const usageSource = normalizeUsageSource(usageRow.usageSource, usageRecordKind);
    const agentScope = agentScopeForTurn(session, turn, usageRow);
    const rowCore = {
      schema: "direct_agent_usage_row@1",
      rowId: normalizeString(usageRow.rowId, `agent_usage_${sha256(`${session.sessionId || ""}:${turn.turnId || ""}:${index}`).slice(0, 20)}`),
      projectId,
      sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
      threadId: normalizeString(session.sessionId || turn.threadId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      workThreadId,
      routeScope,
      agentScope,
      model: normalizeString(usageRow.model || turn.model || session.model, ""),
      reasoningEffort: normalizeString(usageRow.reasoningEffort || turn.reasoningEffort || session.reasoningEffort, ""),
      serviceTier: normalizeString(turn.serviceTier || requestShapeValue(turn, "serviceTier"), ""),
      serviceTierEvidence: normalizeString(turn.serviceTier || requestShapeValue(turn, "serviceTier"), "") ? "turn_or_request_shape" : "not_exposed",
      contextScope: {
        contextBuildId: normalizeString(turn.contextBuildId || usageRow.contextBuildId, ""),
        requestManifestId: normalizeString(turn.requestManifestId || usageRow.requestManifestId, ""),
        contextPressureState: normalizeString(turn.contextPressureState || requestShapeValue(turn, "contextPressureState"), "unknown"),
        contextTokensKnown: false,
      },
      timing: {
        createdAt: normalizeString(turn.createdAt, ""),
        streamStartedAt: normalizeString(turn.streamStartedAt, ""),
        completedAt: normalizeString(turn.completedAt || turn.failedAt || turn.abortedAt, ""),
        durationMs,
      },
      usageSource,
      usageRecordKind,
      usageMissingReason: normalizeString(usageRow.usageMissingReason, usageRecordKind === "missing" ? "provider_usage_missing" : ""),
      responseId: normalizeString(usageRow.responseId, ""),
      sourceEventSequence: numberValue(usageRow.sourceEventSequence, index + 1),
      inputTokens: usageRow.inputTokens === undefined ? undefined : numberValue(usageRow.inputTokens, 0),
      cachedInputTokens: usageRow.cachedInputTokens === undefined ? undefined : numberValue(usageRow.cachedInputTokens, 0),
      nonCachedInputTokens: usageRow.nonCachedInputTokens === undefined ? undefined : numberValue(usageRow.nonCachedInputTokens, 0),
      outputTokens: usageRow.outputTokens === undefined ? undefined : numberValue(usageRow.outputTokens, 0),
      reasoningTokens: usageRow.reasoningTokens === undefined ? undefined : numberValue(usageRow.reasoningTokens, 0),
      totalTokens: usageRow.totalTokens === undefined ? undefined : numberValue(usageRow.totalTokens, 0),
      tokenFieldConfidence: isPlainObject(usageRow.tokenFieldConfidence) ? usageRow.tokenFieldConfidence : {},
      sourceRowDigest: normalizeString(usageRow.rowDigest, ""),
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
      billingGrade: false,
    };
    return {
      ...rowCore,
      rowDigest: digestFor("direct-agent-usage-row@1", rowCore),
    };
  });
}

function collectInputRows(input = {}) {
  if (Array.isArray(input.rows)) {
    return input.rows.map((row, index) => normalizeProvidedRow(row, input.projectId, index));
  }
  const sessionTurns = arrayOrEmpty(input.sessionTurns);
  const rows = [];
  for (const entry of sessionTurns) {
    const session = isPlainObject(entry?.session) ? entry.session : {};
    for (const turn of arrayOrEmpty(entry?.turns)) {
      rows.push(...buildUsageRowsForTurn({
        projectId: input.projectId,
        session,
        turn,
      }));
    }
  }
  return rows;
}

function normalizeProvidedRow(input = {}, projectId = "", index = 0) {
  const source = isPlainObject(input) ? input : {};
  const usageRecordKind = normalizeRowKind(source.usageRecordKind);
  const usageSource = normalizeUsageSource(source.usageSource, usageRecordKind);
  const rowCore = {
    schema: "direct_agent_usage_row@1",
    rowId: normalizeString(source.rowId, `agent_usage_provided_${index + 1}`),
    projectId: normalizeString(source.projectId, projectId),
    sessionId: normalizeString(source.sessionId, ""),
    threadId: normalizeString(source.threadId || source.sessionId, ""),
    turnId: normalizeString(source.turnId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    routeScope: isPlainObject(source.routeScope) ? source.routeScope : { routeId: "", routed: false },
    agentScope: isPlainObject(source.agentScope) ? source.agentScope : { agentKind: "unknown_agent", agentThreadId: "" },
    model: normalizeString(source.model, ""),
    reasoningEffort: normalizeString(source.reasoningEffort, ""),
    serviceTier: normalizeString(source.serviceTier, ""),
    serviceTierEvidence: normalizeString(source.serviceTierEvidence, source.serviceTier ? "provided_row" : "not_exposed"),
    contextScope: isPlainObject(source.contextScope) ? source.contextScope : {
      contextBuildId: normalizeString(source.contextBuildId, ""),
      requestManifestId: normalizeString(source.requestManifestId, ""),
      contextPressureState: "unknown",
      contextTokensKnown: false,
    },
    timing: isPlainObject(source.timing) ? source.timing : { durationMs: numberValue(source.durationMs, 0) },
    usageSource,
    usageRecordKind,
    usageMissingReason: normalizeString(source.usageMissingReason, usageRecordKind === "missing" ? "provider_usage_missing" : ""),
    responseId: normalizeString(source.responseId, ""),
    sourceEventSequence: numberValue(source.sourceEventSequence, index + 1),
    inputTokens: source.inputTokens === undefined ? undefined : numberValue(source.inputTokens, 0),
    cachedInputTokens: source.cachedInputTokens === undefined ? undefined : numberValue(source.cachedInputTokens, 0),
    nonCachedInputTokens: source.nonCachedInputTokens === undefined ? undefined : numberValue(source.nonCachedInputTokens, 0),
    outputTokens: source.outputTokens === undefined ? undefined : numberValue(source.outputTokens, 0),
    reasoningTokens: source.reasoningTokens === undefined ? undefined : numberValue(source.reasoningTokens, 0),
    totalTokens: source.totalTokens === undefined ? undefined : numberValue(source.totalTokens, 0),
    tokenFieldConfidence: isPlainObject(source.tokenFieldConfidence) ? source.tokenFieldConfidence : {},
    sourceRowDigest: normalizeString(source.sourceRowDigest, ""),
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderFrameIncluded: false,
    rawTokenDetailsIncluded: false,
    billingGrade: false,
  };
  return {
    ...rowCore,
    rowDigest: normalizeString(source.rowDigest, digestFor("direct-agent-usage-row@1", rowCore)),
  };
}

function dedupeRows(rows = []) {
  const priority = { terminal: 5, delta: 3, diagnostic: 2, missing: 1 };
  const byKey = new Map();
  for (const row of arrayOrEmpty(rows)) {
    const sessionId = normalizeString(row.sessionId, "");
    const turnId = normalizeString(row.turnId, "");
    const responseId = normalizeString(row.responseId, "");
    const sourceRowDigest = normalizeString(row.sourceRowDigest, "");
    const key = responseId
      ? `${sessionId}:${turnId}:response:${responseId}`
      : sourceRowDigest
        ? `${sessionId}:${turnId}:source:${sourceRowDigest}`
        : `${sessionId}:${turnId}:row:${normalizeString(row.rowId, "")}`;
    const existing = byKey.get(key);
    const incomingKind = normalizeRowKind(row.usageRecordKind);
    const existingKind = normalizeRowKind(existing?.usageRecordKind);
    if (!existing || (priority[incomingKind] || 0) >= (priority[existingKind] || 0)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    normalizeString(left.sessionId, "").localeCompare(normalizeString(right.sessionId, "")) ||
    normalizeString(left.turnId, "").localeCompare(normalizeString(right.turnId, "")) ||
    numberValue(left.sourceEventSequence, 0) - numberValue(right.sourceEventSequence, 0));
}

function summarizeBy(rows = [], keyFn, labelFn = keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeString(keyFn(row), "unknown");
    const existing = groups.get(key) || {
      key,
      label: boundedString(labelFn(row) || key, 180),
      totals: emptyTotals(),
      turnIds: new Set(),
      routeIds: new Set(),
      workThreadIds: new Set(),
    };
    addTokenTotals(existing.totals, row);
    existing.totals.durationMsKnown += numberValue(row.timing?.durationMs, 0);
    existing.turnIds.add(normalizeString(row.turnId, ""));
    existing.routeIds.add(normalizeString(row.routeScope?.routeId, ""));
    existing.workThreadIds.add(normalizeString(row.workThreadId, ""));
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => {
    const row = {
      key: group.key,
      label: group.label,
      totals: {
        ...group.totals,
        turnCount: [...group.turnIds].filter(Boolean).length,
      },
      routeCount: [...group.routeIds].filter(Boolean).length,
      workThreadCount: [...group.workThreadIds].filter(Boolean).length,
    };
    row.summaryDigest = digestFor("direct-agent-usage-summary-row@1", row);
    return row;
  }).sort((left, right) => right.totals.totalTokensKnown - left.totals.totalTokensKnown || left.key.localeCompare(right.key));
}

function buildDirectAgentUsageLedger(input = {}) {
  const rows = dedupeRows(collectInputRows(input));
  const projectId = normalizeString(input.projectId || rows[0]?.projectId, "");
  const totals = rows.reduce((acc, row) => {
    addTokenTotals(acc, row);
    acc.durationMsKnown += numberValue(row.timing?.durationMs, 0);
    acc.turnIds.add(normalizeString(row.turnId, ""));
    return acc;
  }, { ...emptyTotals(), turnIds: new Set() });
  const normalizedTotals = {
    ...totals,
    turnCount: [...totals.turnIds].filter(Boolean).length,
  };
  delete normalizedTotals.turnIds;
  const sourceDigest = digestFor("direct-agent-usage-ledger-source@1", {
    projectId,
    rowDigests: rows.map((row) => row.rowDigest),
  });
  const ledger = {
    schema: DIRECT_AGENT_USAGE_LEDGER_SCHEMA,
    version: DIRECT_AGENT_USAGE_LEDGER_VERSION,
    ledgerId: normalizeString(input.ledgerId, `direct_agent_usage_${sourceDigest.slice(7, 31)}`),
    projectId,
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
    rowCount: rows.length,
    rows,
    totals: normalizedTotals,
    byAgent: summarizeBy(rows, (row) => row.agentScope?.agentThreadId || row.agentScope?.agentKind, (row) => row.agentScope?.agentLabel || row.agentScope?.agentThreadId || row.agentScope?.agentKind),
    byWorkThread: summarizeBy(rows, (row) => row.workThreadId || "unbound_work_thread"),
    byRoute: summarizeBy(rows, (row) => row.routeScope?.routeId || "unrouted"),
    privacy: {
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
      billingGrade: false,
      costComputed: false,
    },
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ledger.ledgerDigest = digestFor("direct-agent-usage-ledger@1", ledger);
  return ledger;
}

function buildDirectAgentUsageSummaryProjection(ledger = {}) {
  const source = isPlainObject(ledger) ? ledger : {};
  const projection = {
    schema: DIRECT_AGENT_USAGE_SUMMARY_PROJECTION_SCHEMA,
    ledgerId: normalizeString(source.ledgerId, ""),
    projectId: normalizeString(source.projectId, ""),
    generatedAt: normalizeString(source.generatedAt, nowIso()),
    rowCount: Number(source.rowCount ?? arrayOrEmpty(source.rows).length ?? 0),
    totals: isPlainObject(source.totals) ? source.totals : emptyTotals(),
    byAgent: arrayOrEmpty(source.byAgent).slice(0, 12),
    byWorkThread: arrayOrEmpty(source.byWorkThread).slice(0, 12),
    byRoute: arrayOrEmpty(source.byRoute).slice(0, 12),
    evidencePosture: {
      exactWhereProviderReported: true,
      missingUsageIsNotZero: true,
      costComputed: false,
      billingGrade: false,
    },
    privacy: {
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
    },
    ledgerDigest: normalizeString(source.ledgerDigest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-agent-usage-summary-projection@1", projection);
  return projection;
}

function assertDirectAgentUsageLedgerSafe(ledger = {}) {
  if (!isPlainObject(ledger) || ledger.schema !== DIRECT_AGENT_USAGE_LEDGER_SCHEMA) {
    throw new Error("direct_agent_usage_ledger_schema_mismatch");
  }
  if (ledger.rawTextIncluded !== false || ledger.rawPathIncluded !== false || ledger.rawSecretIncluded !== false) {
    throw new Error("direct_agent_usage_ledger_raw_exposure");
  }
  const privacy = isPlainObject(ledger.privacy) ? ledger.privacy : {};
  for (const key of ["rawPromptIncluded", "rawResponseIncluded", "rawProviderFrameIncluded", "rawTokenDetailsIncluded", "billingGrade", "costComputed"]) {
    if (privacy[key] !== false) throw new Error(`direct_agent_usage_ledger_privacy_leak:${key}`);
  }
  for (const row of arrayOrEmpty(ledger.rows)) {
    if (row.rawPromptIncluded !== false || row.rawResponseIncluded !== false || row.rawProviderFrameIncluded !== false || row.rawTokenDetailsIncluded !== false || row.billingGrade !== false) {
      throw new Error(`direct_agent_usage_row_privacy_leak:${row.rowId || ""}`);
    }
  }
  return true;
}

function assertDirectAgentUsageProjectionSafe(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== DIRECT_AGENT_USAGE_SUMMARY_PROJECTION_SCHEMA) {
    throw new Error("direct_agent_usage_projection_schema_mismatch");
  }
  if (projection.rawTextIncluded !== false || projection.rawPathIncluded !== false || projection.rawSecretIncluded !== false) {
    throw new Error("direct_agent_usage_projection_raw_exposure");
  }
  const privacy = isPlainObject(projection.privacy) ? projection.privacy : {};
  for (const key of ["rawPromptIncluded", "rawResponseIncluded", "rawProviderFrameIncluded", "rawTokenDetailsIncluded"]) {
    if (privacy[key] !== false) throw new Error(`direct_agent_usage_projection_privacy_leak:${key}`);
  }
  if (projection.evidencePosture?.costComputed !== false || projection.evidencePosture?.billingGrade !== false) {
    throw new Error("direct_agent_usage_projection_cost_leak");
  }
  return true;
}

module.exports = {
  DIRECT_AGENT_USAGE_LEDGER_SCHEMA,
  DIRECT_AGENT_USAGE_LEDGER_VERSION,
  DIRECT_AGENT_USAGE_SUMMARY_PROJECTION_SCHEMA,
  assertDirectAgentUsageLedgerSafe,
  assertDirectAgentUsageProjectionSafe,
  buildDirectAgentUsageLedger,
  buildDirectAgentUsageSummaryProjection,
  buildUsageRowsForTurn,
};
