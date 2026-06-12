"use strict";

const crypto = require("node:crypto");

const DIRECT_THREAD_DECK_PROJECTION_SCHEMA = "direct_thread_deck_projection@1";
const DIRECT_THREAD_DECK_ROW_SCHEMA = "direct_thread_deck_row@1";
const DIRECT_THREAD_DECK_ACTION_SCHEMA = "direct_thread_deck_action@1";

const ACTIVE_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
]);
const RESUMABLE_PREVIOUS_TURN_STATES = new Set(["completed"]);
const RECOVERABLE_INTERRUPTION_CODES = new Set(["restart_interrupted_turn", "stream_interrupted"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function projectionDigest(value) {
  return `sha256:${sha256(stableStringify(value))}`;
}

function boundedString(value, maxChars = 180, fallback = "") {
  const text = normalizeString(value, fallback);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function activeTurnCountFor(entry = {}) {
  const explicit = Number(entry.activeTurnCount || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const turns = Array.isArray(entry.turns) ? entry.turns : [];
  return turns.filter((turn) => ACTIVE_TURN_STATES.has(normalizeString(turn?.state, ""))).length;
}

function lastTurnStateFor(entry = {}) {
  const explicit = normalizeString(entry.lastTurnState, "");
  if (explicit) return explicit;
  const turns = Array.isArray(entry.turns) ? entry.turns : [];
  return normalizeString(turns[turns.length - 1]?.state, "");
}

function recoverableInterruptedTurnCountFor(entry = {}) {
  const turns = Array.isArray(entry.turns) ? entry.turns : [];
  return turns.filter((turn) => {
    const code = normalizeString(turn?.error?.code || turn?.recoveryCode, "");
    if (RECOVERABLE_INTERRUPTION_CODES.has(code)) return true;
    return normalizeString(turn?.state, "") === "failed" && code === "restart_interrupted_turn";
  }).length;
}

function actionDescriptor({ actionKind, enabled = false, reason = "", label = "", method = "", effect = "" }) {
  const descriptor = {
    schema: DIRECT_THREAD_DECK_ACTION_SCHEMA,
    actionKind: normalizeString(actionKind, "unknown"),
    label: boundedString(label || actionKind, 80),
    enabled: enabled === true,
    disabledReason: enabled === true ? "" : boundedString(reason, 180, "unsupported"),
    method: normalizeString(method, ""),
    effect: boundedString(effect, 140),
    mutationAuthorityGranted: false,
  };
  descriptor.actionDigest = projectionDigest(descriptor);
  return descriptor;
}

function rowStateFor(entry = {}) {
  const activeCount = activeTurnCountFor(entry);
  if (activeCount > 0) return "running";
  if (recoverableInterruptedTurnCountFor(entry) > 0) return "recoverable_interrupted";
  return normalizeString(lastTurnStateFor(entry), normalizeString(entry.status, "created"));
}

function buildThreadDeckRow(entry = {}, options = {}) {
  const threadId = normalizeString(entry.threadId || entry.id || entry.sessionId, "");
  const workThreadId = normalizeString(entry.workThreadId, "");
  const activeCount = activeTurnCountFor(entry);
  const lastTurnState = lastTurnStateFor(entry);
  const recoverableInterruptedTurnCount = recoverableInterruptedTurnCountFor(entry);
  const row = {
    schema: DIRECT_THREAD_DECK_ROW_SCHEMA,
    rowKind: "direct_thread_deck_row",
    sessionId: threadId,
    threadId,
    providerThreadId: threadId,
    providerThreadIdIsSecondary: true,
    projectId: normalizeString(entry.projectId || options.projectId, ""),
    workThreadId,
    workThreadGroupingKey: workThreadId ? `work_thread:${workThreadId}` : `project:${normalizeString(entry.projectId || options.projectId, "unknown")}`,
    title: boundedString(entry.title || entry.preview || threadId, 180, "Direct session"),
    preview: boundedString(entry.preview || entry.title || threadId, 220),
    lifecycleState: normalizeString(entry.status, "created"),
    displayState: rowStateFor(entry),
    lastTurnState,
    createdAt: normalizeString(entry.createdAt, ""),
    updatedAt: normalizeString(entry.updatedAt, ""),
    runtimeMode: normalizeString(entry.runtimeMode, "direct-experimental"),
    directTransport: normalizeString(entry.directTransport, "direct-live-text"),
    model: normalizeString(entry.model, ""),
    reasoningEffort: normalizeString(entry.reasoningEffort, ""),
    turnCount: Number(entry.turnCount || 0),
    activeTurnCount: activeCount,
    activeTurnId: normalizeString(entry.activeTurnId, ""),
    activeToolLoopId: normalizeString(entry.activeToolLoopId, ""),
    activeToolStepOrdinal: Number(entry.activeToolStepOrdinal || 0),
    recoverableInterruptedTurnCount,
    providerContinuityAvailable: entry.providerContinuityAvailable === true,
    resumeMode: "local_context_followup",
    rawPathExposed: false,
    rawPromptTextExposed: false,
    actions: {},
  };
  const canFocus = Boolean(threadId);
  const canResume = canFocus && activeCount === 0 && (row.turnCount === 0 || RESUMABLE_PREVIOUS_TURN_STATES.has(lastTurnState));
  row.actions = {
    focus: actionDescriptor({
      actionKind: "focus_direct_thread",
      label: "Focus",
      enabled: canFocus,
      reason: "missing_thread_id",
      method: "thread/read",
      effect: "Open this direct session in the Codex plane without mutating provider state.",
    }),
    resume: actionDescriptor({
      actionKind: "resume_direct_thread_for_next_turn",
      label: "Resume",
      enabled: canResume,
      reason: activeCount > 0
        ? "thread_already_running"
        : recoverableInterruptedTurnCount > 0
          ? "interrupted_turn_requires_operator_recovery"
          : lastTurnState
            ? "previous_turn_not_safely_completed"
            : "missing_thread_id",
      method: "thread/read",
      effect: "Focus this session so the next direct turn can use local context continuity.",
    }),
  };
  row.rowDigest = projectionDigest(row);
  return row;
}

function buildDirectThreadDeckProjection(input = {}, options = {}) {
  const projectId = normalizeString(input.projectId || options.projectId, "");
  const rows = (Array.isArray(input.threads) ? input.threads : [])
    .filter(Boolean)
    .map((entry) => buildThreadDeckRow(entry, { projectId }));
  const defaultModel = normalizeString(input.defaultModel || options.defaultModel, "");
  const defaultReasoningEffort = normalizeString(input.defaultReasoningEffort || options.defaultReasoningEffort, "");
  const startEnabled = input.canStart !== false;
  const projection = {
    schema: DIRECT_THREAD_DECK_PROJECTION_SCHEMA,
    projectId,
    runtime: normalizeString(input.runtime || options.runtime, "direct-live-text"),
    generatedAt: nowIso(options.nowMs),
    groupingLaw: {
      primaryGrouping: "work_thread",
      fallbackGrouping: "project",
      providerThreadIdRole: "secondary_runtime_identity",
      controlPlaneInvariant: true,
    },
    counts: {
      rows: rows.length,
      running: rows.filter((row) => row.activeTurnCount > 0).length,
      recoverableInterrupted: rows.filter((row) => row.recoverableInterruptedTurnCount > 0).length,
      workThreadScoped: rows.filter((row) => row.workThreadId).length,
    },
    defaults: {
      runtimeMode: "direct-experimental",
      directTransport: "direct-live-text",
      model: defaultModel,
      reasoningEffort: defaultReasoningEffort,
      modelPosture: defaultModel ? "operator_or_runtime_selected" : "runtime_default_unknown",
      reasoningEffortPosture: defaultReasoningEffort ? "operator_or_runtime_selected" : "runtime_default_unknown",
    },
    actions: {
      start: actionDescriptor({
        actionKind: "start_direct_thread",
        label: "New thread",
        enabled: startEnabled,
        reason: normalizeString(input.startDisabledReason, "thread_start_unavailable"),
        method: "thread/start",
        effect: "Create a fresh direct-native session for the active project.",
      }),
    },
    rows,
    rawPathExposed: false,
    rawPromptTextExposed: false,
    mutationAuthorityGranted: false,
  };
  projection.projectionDigest = projectionDigest(projection);
  return projection;
}

module.exports = {
  DIRECT_THREAD_DECK_PROJECTION_SCHEMA,
  DIRECT_THREAD_DECK_ROW_SCHEMA,
  buildDirectThreadDeckProjection,
  buildThreadDeckRow,
};
