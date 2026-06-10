"use strict";

const crypto = require("node:crypto");

const DIRECT_TURN_USAGE_ATTRIBUTION_SCHEMA = "direct_turn_usage_attribution@1";
const DIRECT_TURN_USAGE_ATTRIBUTION_VERSION = "direct-turn-usage-attribution@1";
const AGENT_KINDS = new Set(["main_agent", "sub_worker", "unknown_agent"]);
const USAGE_SOURCES = new Set(["response_completed_usage", "provider_usage_delta", "missing"]);
const USAGE_RECORD_KINDS = new Set(["terminal", "delta", "missing"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso(nowMs) {
  return new Date(nowMs !== undefined && nowMs !== null ? nowMs : Date.now()).toISOString();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
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

function normalizeAgentKind(value, fallback = "unknown_agent") {
  const kind = normalizeString(value, fallback);
  return AGENT_KINDS.has(kind) ? kind : fallback;
}

function normalizeUsageSource(value, fallback = "provider_usage_delta") {
  const source = normalizeString(value, fallback);
  return USAGE_SOURCES.has(source) ? source : fallback;
}

function normalizeUsageRecordKind(value, fallback = "delta") {
  const kind = normalizeString(value, fallback);
  return USAGE_RECORD_KINDS.has(kind) ? kind : fallback;
}

function emptyTotals() {
  return {
    rowCount: 0,
    inputTokensKnown: 0,
    cachedInputTokensKnown: 0,
    nonCachedInputTokensKnown: 0,
    outputTokensKnown: 0,
    reasoningTokensKnown: 0,
    totalTokensKnown: 0,
    missingUsageRowCount: 0,
  };
}

function tokenFieldsFromUsage(usage = {}) {
  const inputTokens = numberValue(usage.inputTokens ?? usage.input_tokens, 0);
  const cachedInputTokens = numberValue(usage.cachedInputTokens ?? usage.cached_input_tokens, 0);
  const outputTokens = numberValue(usage.outputTokens ?? usage.output_tokens, 0);
  const reasoningTokens = numberValue(usage.reasoningTokens ?? usage.reasoning_tokens, 0);
  const totalTokens = numberValue(
    usage.totalTokens ?? usage.total_tokens,
    inputTokens + outputTokens,
  );
  return {
    inputTokens,
    cachedInputTokens,
    nonCachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function addTokens(totals, row = {}) {
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

function usageTotals(rows = []) {
  return rows.reduce((totals, row) => addTokens(totals, row), emptyTotals());
}

function graphNodeForAgent(agentGraph = {}, agentThreadId = "", sessionId = "") {
  const candidates = new Set([agentThreadId, sessionId].map((value) => normalizeString(value, "")).filter(Boolean));
  if (!candidates.size) return null;
  return (Array.isArray(agentGraph.nodes) ? agentGraph.nodes : [])
    .find((node) => candidates.has(normalizeString(node?.agentThreadId || node?.threadId, ""))) || null;
}

function agentScopeForTurn(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const agentGraph = isPlainObject(input.agentGraph) ? input.agentGraph : {};
  const sessionId = normalizeString(session.sessionId || session.threadId, "");
  const primaryThreadId = normalizeString(
    input.primaryThreadId ||
    agentGraph.primaryThreadId ||
    session.primaryThreadId ||
    session.rootThreadId ||
    sessionId,
    sessionId,
  );
  const explicitAgentThreadId = normalizeString(input.agentThreadId || turn.agentThreadId || session.agentThreadId || "", "");
  const agentThreadId = explicitAgentThreadId || sessionId;
  const graphNode = graphNodeForAgent(agentGraph, agentThreadId, sessionId);
  const parentThreadId = normalizeString(
    input.parentThreadId ||
    turn.parentThreadId ||
    session.parentThreadId ||
    graphNode?.parentThreadId ||
    "",
    "",
  );
  const explicitKind = normalizeString(input.agentKind || turn.agentKind || session.agentKind, "");
  let agentKind = AGENT_KINDS.has(explicitKind) ? explicitKind : "";
  if (!agentKind && graphNode) {
    agentKind = numberValue(graphNode.depth, 0) > 0 || normalizeString(graphNode.parentThreadId, "")
      ? "sub_worker"
      : "main_agent";
  }
  if (!agentKind) {
    agentKind = parentThreadId && parentThreadId !== sessionId ? "sub_worker" : "main_agent";
  }
  if (primaryThreadId && agentThreadId && primaryThreadId === agentThreadId && !explicitKind) {
    agentKind = "main_agent";
  }
  return {
    agentKind: normalizeAgentKind(agentKind, "unknown_agent"),
    agentThreadId,
    primaryThreadId,
    parentThreadId,
    agentLabel: normalizeString(input.agentLabel || turn.agentLabel || session.agentLabel || graphNode?.displayLabel || graphNode?.nickname || "", ""),
    agentRole: normalizeString(input.agentRole || turn.agentRole || session.agentRole || graphNode?.role || "", ""),
    attributionSource: graphNode ? "agent_graph" : explicitKind || explicitAgentThreadId || parentThreadId ? "turn_or_session_metadata" : "session_default",
  };
}

function completionAfterSequence(events = [], sequence) {
  return events
    .filter((event) => event?.type === "response_completed" && numberValue(event.sequence, -1) >= numberValue(sequence, -1))
    .sort((left, right) => numberValue(left.sequence, 0) - numberValue(right.sequence, 0))[0] || null;
}

function responseTerminalEvents(events = []) {
  return events.filter((event) => ["response_completed", "response_failed", "response_incomplete"].includes(event?.type));
}

function usageRowsFromEvents(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const session = isPlainObject(input.session) ? input.session : {};
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const scope = agentScopeForTurn(input);
  const sessionId = normalizeString(session.sessionId || turn.sessionId, "");
  const turnId = normalizeString(turn.turnId, "");
  const model = normalizeString(input.model || turn.model || session.model, "");
  const reasoningEffort = normalizeString(input.reasoningEffort || turn.reasoningEffort || session.reasoningEffort, "");
  const requestKind = normalizeString(input.requestKind || turn.requestKind || turn.sourceClass, "");
  const requestManifestId = normalizeString(turn.requestManifestId, "");
  const contextBuildId = normalizeString(turn.contextBuildId, "");
  const observedAt = normalizeString(input.observedAt, nowIso());
  const usageEvents = events.filter((event) => event?.type === "usage_delta" && isPlainObject(event.usage));
  const rows = usageEvents.map((event, index) => {
    const completion = completionAfterSequence(events, event.sequence);
    const responseId = normalizeString(completion?.responseId || event.responseId, "");
    const tokens = tokenFieldsFromUsage(event.usage);
    const sourceEventSequence = numberValue(event.sequence, index + 1);
    const dedupeKey = responseId
      ? `${sessionId}:${turnId}:response:${responseId}:usage`
      : `${sessionId}:${turnId}:usage-seq:${sourceEventSequence}`;
    const core = {
      rowId: `turn_usage_${sha256(dedupeKey).slice(0, 20)}`,
      dedupeKey,
      sessionId,
      threadId: sessionId,
      turnId,
      agentKind: scope.agentKind,
      agentThreadId: scope.agentThreadId,
      primaryThreadId: scope.primaryThreadId,
      parentThreadId: scope.parentThreadId,
      agentLabel: scope.agentLabel,
      agentRole: scope.agentRole,
      attributionSource: scope.attributionSource,
      responseId,
      sourceEventSequence,
      observedAt,
      model,
      reasoningEffort,
      requestKind,
      requestManifestId,
      contextBuildId,
      usageSource: "response_completed_usage",
      usageRecordKind: "terminal",
      ...tokens,
      tokenFieldConfidence: {
        inputTokens: "exact",
        cachedInputTokens: "exact",
        nonCachedInputTokens: "derived",
        outputTokens: "exact",
        reasoningTokens: "exact",
        totalTokens: "exact",
      },
      rawTokenDetailsIncluded: false,
      rawPromptIncluded: false,
      rawResponseIncluded: false,
    };
    return {
      ...core,
      rowDigest: artifactDigest(core),
    };
  });
  if (!rows.length && responseTerminalEvents(events).length) {
    const terminal = responseTerminalEvents(events)[0];
    const responseId = normalizeString(terminal.responseId, "");
    const sourceEventSequence = numberValue(terminal.sequence, 0);
    const dedupeKey = responseId
      ? `${sessionId}:${turnId}:response:${responseId}:usage-missing`
      : `${sessionId}:${turnId}:terminal-seq:${sourceEventSequence}:usage-missing`;
    const core = {
      rowId: `turn_usage_${sha256(dedupeKey).slice(0, 20)}`,
      dedupeKey,
      sessionId,
      threadId: sessionId,
      turnId,
      agentKind: scope.agentKind,
      agentThreadId: scope.agentThreadId,
      primaryThreadId: scope.primaryThreadId,
      parentThreadId: scope.parentThreadId,
      agentLabel: scope.agentLabel,
      agentRole: scope.agentRole,
      attributionSource: scope.attributionSource,
      responseId,
      sourceEventSequence,
      observedAt,
      model,
      reasoningEffort,
      requestKind,
      requestManifestId,
      contextBuildId,
      usageSource: "missing",
      usageRecordKind: "missing",
      usageMissingReason: "provider_did_not_emit_usage",
      tokenFieldConfidence: {
        inputTokens: "missing",
        cachedInputTokens: "missing",
        nonCachedInputTokens: "missing",
        outputTokens: "missing",
        reasoningTokens: "missing",
        totalTokens: "missing",
      },
      rawTokenDetailsIncluded: false,
      rawPromptIncluded: false,
      rawResponseIncluded: false,
    };
    rows.push({
      ...core,
      rowDigest: artifactDigest(core),
    });
  }
  return rows;
}

function dedupeRows(rows = []) {
  const priority = { terminal: 3, delta: 2, missing: 1 };
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const dedupeKey = normalizeString(row?.dedupeKey, row?.rowId || "");
    if (!dedupeKey) continue;
    const existing = byKey.get(dedupeKey);
    const incomingKind = normalizeUsageRecordKind(row.usageRecordKind, "missing");
    const existingKind = normalizeUsageRecordKind(existing?.usageRecordKind, "missing");
    if (!existing || (priority[incomingKind] || 0) >= (priority[existingKind] || 0)) {
      byKey.set(dedupeKey, {
        ...row,
        usageSource: normalizeUsageSource(row.usageSource, incomingKind === "missing" ? "missing" : "provider_usage_delta"),
        usageRecordKind: incomingKind,
        agentKind: normalizeAgentKind(row.agentKind, "unknown_agent"),
      });
    }
  }
  return [...byKey.values()].sort((left, right) =>
    numberValue(left.sourceEventSequence, 0) - numberValue(right.sourceEventSequence, 0) ||
    String(left.rowId || "").localeCompare(String(right.rowId || "")));
}

function finalizeAttribution(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const sessionId = normalizeString(session.sessionId || turn.sessionId, "");
  const turnId = normalizeString(turn.turnId, "");
  const scope = agentScopeForTurn(input);
  const rows = dedupeRows(input.rows);
  const totals = usageTotals(rows);
  const sourceDigest = sha256(stableStringify({
    sessionId,
    turnId,
    rows: rows.map((row) => ({ rowId: row.rowId, rowDigest: row.rowDigest })),
    scope,
  }));
  const core = {
    schema: DIRECT_TURN_USAGE_ATTRIBUTION_SCHEMA,
    attributionId: normalizeString(input.attributionId, `turn_usage_attr_${sourceDigest.slice(0, 24)}`),
    version: DIRECT_TURN_USAGE_ATTRIBUTION_VERSION,
    projectId: normalizeString(input.projectId || session.projectId, ""),
    sessionId,
    threadId: sessionId,
    turnId,
    generatedAt: normalizeString(input.generatedAt, nowIso()),
    updatedAt: normalizeString(input.updatedAt, nowIso()),
    model: normalizeString(input.model || turn.model || session.model, ""),
    reasoningEffort: normalizeString(input.reasoningEffort || turn.reasoningEffort || session.reasoningEffort, ""),
    agentScope: scope,
    status: rows.length
      ? totals.missingUsageRowCount === rows.length ? "usage_missing" : "usage_observed"
      : "usage_not_terminal",
    rows,
    totals,
    privacy: {
      billingGrade: false,
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
    },
    sourceDigest,
  };
  return {
    ...core,
    integrity: {
      algorithm: "sha256",
      sourceDigest,
      artifactDigest: artifactDigest(core),
    },
  };
}

function buildDirectTurnUsageAttribution(input = {}) {
  return finalizeAttribution({
    ...input,
    rows: usageRowsFromEvents(input),
  });
}

function updateDirectTurnUsageAttribution(input = {}) {
  const existing = isPlainObject(input.existing) && input.existing.schema === DIRECT_TURN_USAGE_ATTRIBUTION_SCHEMA
    ? input.existing
    : null;
  const rows = [
    ...(Array.isArray(existing?.rows) ? existing.rows : []),
    ...usageRowsFromEvents(input),
  ];
  return finalizeAttribution({
    ...input,
    attributionId: normalizeString(existing?.attributionId, ""),
    generatedAt: normalizeString(existing?.generatedAt, ""),
    rows,
  });
}

module.exports = {
  DIRECT_TURN_USAGE_ATTRIBUTION_SCHEMA,
  DIRECT_TURN_USAGE_ATTRIBUTION_VERSION,
  agentScopeForTurn,
  buildDirectTurnUsageAttribution,
  stableStringify,
  sha256,
  updateDirectTurnUsageAttribution,
  usageRowsFromEvents,
  usageTotals,
};
