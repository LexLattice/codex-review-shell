"use strict";

const crypto = require("node:crypto");
const { buildUsageRowsForTurn } = require("../usage/agent-ledger");

const DIRECT_RUNTIME_ANALYTICS_FACTS_SCHEMA = "direct_runtime_analytics_facts@1";
const DIRECT_RUNTIME_ANALYTICS_FACTS_VERSION = "direct-runtime-analytics-facts@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
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

function digestFor(kind, value) {
  return crypto.createHash("sha256").update(`${kind}:${stableStringify(value)}`).digest("hex");
}

function factId(prefix, value) {
  return `${prefix}_${digestFor(prefix, value).slice(0, 24)}`;
}

function agentScope(session = {}, turn = {}, usageRow = {}) {
  const threadId = normalizeString(usageRow.threadId || turn.threadId || turn.sessionId || session.sessionId, "");
  return {
    threadId,
    agentThreadId: normalizeString(usageRow.agentScope?.agentThreadId || turn.agentThreadId || session.agentThreadId || threadId, threadId),
    agentKind: normalizeString(usageRow.agentScope?.agentKind || turn.agentKind || session.agentKind, "unknown_agent"),
    parentThreadId: normalizeString(usageRow.agentScope?.parentThreadId || turn.parentThreadId || session.parentThreadId, ""),
    agentLabel: normalizeString(usageRow.agentScope?.agentLabel || turn.agentLabel || session.agentLabel, ""),
    agentRole: normalizeString(usageRow.agentScope?.agentRole || turn.agentRole || session.agentRole, ""),
  };
}

function timingMark(projectId, session, turn, markKind, at, sourceKind, confidence = "runtime_observed") {
  const threadId = normalizeString(turn.threadId || turn.sessionId || session.sessionId, "");
  const turnId = normalizeString(turn.turnId, "");
  const markAt = normalizeString(at, "");
  if (!projectId || !threadId || !turnId || !markKind || !markAt) return null;
  const scope = agentScope(session, turn);
  const core = {
    projectId,
    threadId,
    turnId,
    agentThreadId: scope.agentThreadId,
    agentKind: scope.agentKind,
    markKind,
    at: markAt,
    sourceKind,
    confidence,
  };
  return {
    ...core,
    timingMarkId: factId("timing_mark", core),
    factDigest: digestFor("direct-runtime-timing-mark@1", core),
  };
}

function timingMarksForTurn(projectId, session, turn) {
  return [
    timingMark(projectId, session, turn, "submitted", turn.submittedAt, "direct_turn.submittedAt"),
    timingMark(projectId, session, turn, "accepted", turn.createdAt, "direct_turn.createdAt"),
    timingMark(projectId, session, turn, "context_build_completed", turn.contextBuildId ? turn.requestBuiltAt || turn.updatedAt || turn.createdAt : "", "direct_turn.contextBuildId", "derived"),
    timingMark(projectId, session, turn, "request_built", turn.requestBuiltAt, "direct_turn.requestBuiltAt"),
    timingMark(projectId, session, turn, "stream_started", turn.streamStartedAt, "direct_turn.streamStartedAt"),
    timingMark(projectId, session, turn, "first_response_byte", turn.firstResponseByteAt, "direct_turn.firstResponseByteAt"),
    timingMark(projectId, session, turn, "first_reasoning_delta", turn.firstReasoningDeltaAt, "direct_turn.firstReasoningDeltaAt"),
    timingMark(projectId, session, turn, "first_visible_delta", turn.firstVisibleDeltaAt, "direct_turn.firstVisibleDeltaAt"),
    timingMark(projectId, session, turn, "first_tool_call", turn.firstToolCallAt, "direct_turn.firstToolCallAt"),
    timingMark(projectId, session, turn, "completed", turn.completedAt, "direct_turn.completedAt"),
    timingMark(projectId, session, turn, "failed", turn.failedAt, "direct_turn.failedAt"),
    timingMark(projectId, session, turn, "aborted", turn.abortedAt, "direct_turn.abortedAt"),
  ].filter(Boolean);
}

function usageFactsForTurn(projectId, session, turn) {
  return buildUsageRowsForTurn({ projectId, session, turn }).map((row) => {
    const scope = agentScope(session, turn, row);
    const core = {
      projectId,
      threadId: normalizeString(row.threadId || scope.threadId, ""),
      turnId: normalizeString(row.turnId || turn.turnId, ""),
      agentThreadId: scope.agentThreadId,
      agentKind: scope.agentKind,
      parentThreadId: scope.parentThreadId,
      model: normalizeString(row.model || turn.model || session.model, ""),
      reasoningEffort: normalizeString(row.reasoningEffort || turn.reasoningEffort || session.reasoningEffort, ""),
      serviceTier: normalizeString(row.serviceTier || turn.serviceTier, ""),
      responseId: normalizeString(row.responseId, ""),
      requestManifestId: normalizeString(row.contextScope?.requestManifestId || row.requestManifestId || turn.requestManifestId, ""),
      contextBuildId: normalizeString(row.contextScope?.contextBuildId || row.contextBuildId || turn.contextBuildId, ""),
      usageSource: normalizeString(row.usageSource, "missing"),
      usageRecordKind: normalizeString(row.usageRecordKind, "missing"),
      usageMissingReason: normalizeString(row.usageMissingReason, ""),
      inputTokens: row.inputTokens === undefined ? null : numberValue(row.inputTokens, 0),
      cachedInputTokens: row.cachedInputTokens === undefined ? null : numberValue(row.cachedInputTokens, 0),
      nonCachedInputTokens: row.nonCachedInputTokens === undefined ? null : numberValue(row.nonCachedInputTokens, 0),
      outputTokens: row.outputTokens === undefined ? null : numberValue(row.outputTokens, 0),
      reasoningTokens: row.reasoningTokens === undefined ? null : numberValue(row.reasoningTokens, 0),
      totalTokens: row.totalTokens === undefined ? null : numberValue(row.totalTokens, 0),
      tokenConfidence: isPlainObject(row.tokenFieldConfidence) ? row.tokenFieldConfidence : {},
      observedAt: normalizeString(row.timing?.completedAt || row.timing?.createdAt || row.observedAt, ""),
      sourceRowDigest: normalizeString(row.rowDigest, ""),
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
      billingGrade: false,
    };
    return {
      ...core,
      usageFactId: normalizeString(row.rowId, factId("usage_fact", core)),
      factDigest: digestFor("direct-turn-usage-fact@1", core),
    };
  });
}

function contextFactForTurn(projectId, session, turn, usageFacts = []) {
  const contextBuildId = normalizeString(turn.contextBuildId, "");
  const requestManifestId = normalizeString(turn.requestManifestId, "");
  const inputTokens = usageFacts
    .filter((row) => row.usageRecordKind !== "missing")
    .reduce((sum, row) => sum + numberValue(row.inputTokens, 0), 0);
  if (!contextBuildId && !requestManifestId && inputTokens <= 0) return null;
  const threadId = normalizeString(turn.threadId || turn.sessionId || session.sessionId, "");
  const modelContextWindow = numberValue(
    turn.modelContextWindow ||
      turn.requestShape?.modelContextWindow ||
      turn.requestShape?.model_context_window,
    0,
  );
  const usedPercent = modelContextWindow > 0 && inputTokens > 0
    ? Math.max(0, Math.min(100, Math.round((inputTokens / modelContextWindow) * 100)))
    : null;
  const sourceMix = isPlainObject(turn.contextSourceMix) ? turn.contextSourceMix : {};
  const omittedSources = isPlainObject(turn.contextOmissions) ? turn.contextOmissions : {};
  const core = {
    projectId,
    threadId,
    turnId: normalizeString(turn.turnId, ""),
    contextBuildId,
    requestManifestId,
    modelContextWindow,
    inputTokens,
    usedPercent,
    sourceMix,
    omittedSources,
    estimateConfidence: modelContextWindow > 0 && inputTokens > 0 ? "provider_usage_and_model_window" : inputTokens > 0 ? "usage_without_window" : "context_artifact_only",
    observedAt: normalizeString(turn.completedAt || turn.updatedAt || turn.createdAt, ""),
  };
  return {
    ...core,
    contextFactId: factId("context_fact", {
      projectId,
      threadId,
      turnId: core.turnId,
      contextBuildId,
      requestManifestId,
    }),
    factDigest: digestFor("direct-context-analytics-fact@1", core),
  };
}

function classifyToolKind(toolName) {
  const name = normalizeString(toolName, "").toLowerCase();
  if (name === "read_file" || name === "readfile") return "read_file";
  if (name === "apply_patch" || name === "applypatch") return "apply_patch";
  if (name === "run_command" || name === "runcommand" || name === "exec_command") return "run_command";
  if (name.includes("agent")) return "sub_agent";
  return name || "unknown";
}

function toolNameFrom(value = {}, fallback = "") {
  return normalizeString(
    value.toolName ||
      value.name ||
      value.tool ||
      value.result?.toolName ||
      value.result?.name ||
      value.continuationRequest?.toolResult?.name,
    fallback,
  );
}

function toolFactsForTurn(projectId, session, turn) {
  const threadId = normalizeString(turn.threadId || turn.sessionId || session.sessionId, "");
  const scope = agentScope(session, turn);
  const results = arrayOrEmpty(turn.toolResults);
  const obligations = arrayOrEmpty(turn.unresolvedObligations);
  const resultObligationIds = new Set(results.map((result) => normalizeString(result.obligationId, "")).filter(Boolean));
  const facts = [];
  results.forEach((result, index) => {
    const toolName = toolNameFrom(result, "");
    const core = {
      projectId,
      threadId,
      turnId: normalizeString(turn.turnId, ""),
      agentThreadId: scope.agentThreadId,
      agentKind: scope.agentKind,
      toolKind: classifyToolKind(toolName),
      toolName,
      status: normalizeString(result.status || result.result?.status, "completed"),
      startedAt: normalizeString(result.startedAt || result.result?.startedAt, ""),
      completedAt: normalizeString(result.completedAt || result.result?.completedAt || turn.updatedAt, ""),
      durationMs: nullableNumber(result.durationMs ?? result.result?.durationMs),
      workspaceEffectSummary: isPlainObject(result.workspaceEffects)
        ? result.workspaceEffects
        : isPlainObject(result.result?.workspaceEffects)
          ? result.result.workspaceEffects
          : {},
      sourceRef: {
        sourceKind: "tool_result",
        resultId: normalizeString(result.resultId || result.id, ""),
        obligationId: normalizeString(result.obligationId, ""),
        ordinal: index + 1,
      },
    };
    facts.push({
      ...core,
      toolFactId: factId("tool_fact", { threadId, turnId: core.turnId, resultId: core.sourceRef.resultId, obligationId: core.sourceRef.obligationId, index }),
      factDigest: digestFor("direct-tool-analytics-fact@1", core),
    });
  });
  obligations
    .filter((obligation) => !resultObligationIds.has(normalizeString(obligation.obligationId, "")))
    .forEach((obligation, index) => {
      const toolName = toolNameFrom(obligation, "");
      const core = {
        projectId,
        threadId,
        turnId: normalizeString(turn.turnId, ""),
        agentThreadId: scope.agentThreadId,
        agentKind: scope.agentKind,
        toolKind: classifyToolKind(toolName),
        toolName,
        status: normalizeString(obligation.status, "pending"),
        startedAt: normalizeString(obligation.createdAt || turn.updatedAt, ""),
        completedAt: "",
        durationMs: null,
        workspaceEffectSummary: {},
        sourceRef: {
          sourceKind: "tool_obligation",
          obligationId: normalizeString(obligation.obligationId, ""),
          ordinal: index + 1,
        },
      };
      facts.push({
        ...core,
        toolFactId: factId("tool_fact", { threadId, turnId: core.turnId, obligationId: core.sourceRef.obligationId, index }),
        factDigest: digestFor("direct-tool-analytics-fact@1", core),
      });
    });
  return facts;
}

function quotaFactsFromProfile(projectId, profile = {}, observedAt = "") {
  const windows = arrayOrEmpty(profile?.usage?.quota?.windows);
  const at = normalizeString(observedAt || profile?.fetchedAt || profile?.updatedAt || profile?.generatedAt, nowIso());
  return windows.map((window, index) => {
    const core = {
      projectId,
      provider: normalizeString(profile?.provider || profile?.providerName, "openai"),
      windowKind: normalizeString(window.windowKind, "unknown"),
      windowId: normalizeString(window.windowId, `window_${index + 1}`),
      usedPercent: nullableNumber(window.usedPercent),
      resetsAt: normalizeString(window.resetsAt, ""),
      windowDurationMins: nullableNumber(window.windowDurationMins),
      planType: normalizeString(profile?.account?.planType || profile?.usage?.quota?.planType, ""),
      source: normalizeString(window.source || profile?.usage?.quota?.source || "direct_provider_metadata", "direct_provider_metadata"),
      accountEvidenceKey: normalizeString(profile?.account?.accountEvidenceKey || profile?.accountEvidenceKey, ""),
      observedAt: at,
    };
    return {
      ...core,
      quotaFactId: factId("quota_fact", {
        projectId,
        provider: core.provider,
        windowKind: core.windowKind,
        windowId: core.windowId,
        usedPercent: core.usedPercent,
        resetsAt: core.resetsAt,
        windowDurationMins: core.windowDurationMins,
        planType: core.planType,
        source: core.source,
        accountEvidenceKey: core.accountEvidenceKey,
      }),
      factDigest: digestFor("direct-quota-snapshot-fact@1", core),
    };
  });
}

function buildDirectRuntimeAnalyticsFacts(input = {}) {
  const projectId = normalizeString(input.projectId, "");
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const timingMarks = [];
  const usageFacts = [];
  const contextFacts = [];
  const toolFacts = [];
  for (const entry of arrayOrEmpty(input.sessionTurns)) {
    const session = isPlainObject(entry?.session) ? entry.session : {};
    for (const turn of arrayOrEmpty(entry?.turns)) {
      timingMarks.push(...timingMarksForTurn(projectId || normalizeString(session.projectId, ""), session, turn));
      const turnUsageFacts = usageFactsForTurn(projectId || normalizeString(session.projectId, ""), session, turn);
      usageFacts.push(...turnUsageFacts);
      const contextFact = contextFactForTurn(projectId || normalizeString(session.projectId, ""), session, turn, turnUsageFacts);
      if (contextFact) contextFacts.push(contextFact);
      toolFacts.push(...toolFactsForTurn(projectId || normalizeString(session.projectId, ""), session, turn));
    }
  }
  const quotaFacts = isPlainObject(input.providerMetadataProfile)
    ? quotaFactsFromProfile(projectId, input.providerMetadataProfile, input.providerMetadataObservedAt || generatedAt)
    : [];
  const facts = {
    schema: DIRECT_RUNTIME_ANALYTICS_FACTS_SCHEMA,
    version: DIRECT_RUNTIME_ANALYTICS_FACTS_VERSION,
    projectId,
    generatedAt,
    timingMarks,
    usageFacts,
    contextFacts,
    toolFacts,
    quotaFacts,
    counts: {
      timingMarks: timingMarks.length,
      usageFacts: usageFacts.length,
      contextFacts: contextFacts.length,
      toolFacts: toolFacts.length,
      quotaFacts: quotaFacts.length,
    },
    privacy: {
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderFrameIncluded: false,
      rawTokenDetailsIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
      billingGrade: false,
    },
  };
  facts.factsDigest = digestFor("direct-runtime-analytics-facts@1", facts);
  return facts;
}

module.exports = {
  DIRECT_RUNTIME_ANALYTICS_FACTS_SCHEMA,
  DIRECT_RUNTIME_ANALYTICS_FACTS_VERSION,
  buildDirectRuntimeAnalyticsFacts,
};
