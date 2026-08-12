"use strict";

const {
  DIRECT_CAPTURED_TOOL_RESULT_SCHEMA,
  DIRECT_TURN_CAPTURE_SCHEMA,
  capturedToolResultDigest,
} = require("../session/session-store");
const { digestFor, text } = require("./kernel");

const DIRECT_TURN_CAPTURE_RECEIPT_SCHEMA = "direct_turn_capture_receipt@1";
const CAPTURED_TOOL_RESULT_SOURCE_FIELDS = new Set([
  "schema",
  "stepOrdinal",
  "tool",
  "callId",
  "obligationId",
  "status",
  "outcome",
  "summary",
  "sideEffectExecuted",
  "workspaceBindingId",
  "workspaceBindingDigest",
  "exitCode",
  "resultClass",
  "resultDigest",
  "providerOutputText",
  "providerOutputDigest",
  "providerOutputCharacterCount",
  "rawOutputPersisted",
  "rawArgumentsPersisted",
  "rawWorkspacePathIncluded",
  "rawProviderPayloadIncluded",
]);
const CAPTURED_TOOL_RESULT_FORBIDDEN_KEYS = new Set([
  "arguments",
  "argumentsjson",
  "argumentsdelta",
  "command",
  "context",
  "contextbody",
  "content",
  "linuxpath",
  "localpath",
  "nativeroot",
  "outputtext",
  "patch",
  "prompt",
  "providerpayload",
  "repositorypath",
  "stderr",
  "stdout",
  "text",
  "windowspath",
  "worktreepath",
]);

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sourceEvent(event = {}) {
  const { persistedIndex, persistedAt, sourceEnvelopeDigest, ...source } = event || {};
  return source;
}

function sourceEvents(events = []) {
  return (Array.isArray(events) ? events : []).map(sourceEvent);
}

function eventPrefixDigest(events = []) {
  return digestFor({ kind: "direct_normalized_event_prefix", events: sourceEvents(events) });
}

function normalizedFieldName(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isAbsolutePathShaped(value) {
  const candidate = String(value || "");
  return /(?:^|[\s"'`(=])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/.test(candidate) ||
    /(?:^|[\s"'`(=])[A-Za-z]:[\\/][^\s"']+/.test(candidate) ||
    /(?:^|[\s"'`(=])\\\\[^\\\s]+\\[^\s"']+/.test(candidate) ||
    /file:\/\//i.test(candidate);
}

function assertCapturedValueSafe(value, path = []) {
  if (typeof value === "string") {
    if (isAbsolutePathShaped(value)) fail("direct_turn_capture_tool_result_path_forbidden");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCapturedValueSafe(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedFieldName(key);
    if (CAPTURED_TOOL_RESULT_FORBIDDEN_KEYS.has(normalized)) {
      fail("direct_turn_capture_tool_result_raw_field_forbidden");
    }
    assertCapturedValueSafe(child, [...path, key]);
  }
}

function nonnegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function safeCapturedToolResult(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("direct_turn_capture_tool_result_invalid");
  }
  if (result.schema === DIRECT_CAPTURED_TOOL_RESULT_SCHEMA) {
    assertCapturedValueSafe(result);
    if (capturedToolResultDigest(result) !== text(result.resultDigest)) {
      fail("direct_turn_capture_tool_result_digest_invalid");
    }
    return { ...result };
  }
  for (const key of Object.keys(result)) {
    if (!CAPTURED_TOOL_RESULT_SOURCE_FIELDS.has(key)) {
      fail("direct_turn_capture_tool_result_field_unsupported");
    }
  }
  if (
    result.rawOutputPersisted === true ||
    result.rawArgumentsPersisted === true ||
    result.rawWorkspacePathIncluded === true ||
    result.rawProviderPayloadIncluded === true
  ) fail("direct_turn_capture_tool_result_raw_flag_forbidden");
  const providerOutputText = typeof result?.providerOutputText === "string"
    ? result.providerOutputText
    : "";
  const sourceResultDigest = text(result.resultDigest);
  if (!sourceResultDigest) fail("direct_turn_capture_tool_result_source_digest_required");
  const providerOutputDigest = providerOutputText
    ? digestFor(providerOutputText)
    : text(result.providerOutputDigest);
  const core = {
    schema: DIRECT_CAPTURED_TOOL_RESULT_SCHEMA,
    sourceSchema: text(result.schema),
    stepOrdinal: nonnegativeNumber(result.stepOrdinal),
    tool: text(result.tool),
    callId: text(result.callId),
    obligationId: text(result.obligationId),
    status: text(result.status || result.outcome, "recorded"),
    summary: text(result.summary),
    sideEffectExecuted: result.sideEffectExecuted === true,
    workspaceBindingId: text(result.workspaceBindingId),
    workspaceBindingDigest: text(result.workspaceBindingDigest),
    exitCode: result.exitCode !== null && result.exitCode !== undefined && Number.isFinite(Number(result.exitCode))
      ? Number(result.exitCode)
      : null,
    resultClass: text(result.resultClass),
    sourceResultDigest,
    providerOutputDigest,
    providerOutputCharacterCount: providerOutputText
      ? providerOutputText.length
      : nonnegativeNumber(result.providerOutputCharacterCount),
    rawOutputPersisted: false,
    rawArgumentsPersisted: false,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  assertCapturedValueSafe(core);
  return {
    ...core,
    resultDigest: capturedToolResultDigest(core),
  };
}

function toolResultDigest(results = []) {
  return digestFor((Array.isArray(results) ? results : []).map((result) => ({
    schema: text(result?.schema),
    obligationId: text(result?.obligationId),
    callId: text(result?.callId),
    resultDigest: text(result?.resultDigest),
  })));
}

function terminalTurnState(result = {}) {
  const state = text(result.terminal?.state || result.terminalState || result.state);
  if ([
    "completed",
    "failed",
    "aborted",
    "response_incomplete",
    "content_filter_terminal",
    "max_output_terminal",
    "empty_output_terminal",
    "tool_waiting",
  ].includes(state)) return state;
  if ((Array.isArray(result.normalizedEvents) ? result.normalizedEvents : [])
    .some((event) => event?.type === "response_completed")) return "completed";
  return result.error || result.terminal?.error ? "failed" : "response_incomplete";
}

function terminalEvidence(result = {}) {
  const sourceError = result.terminal?.error || result.error;
  return {
    responseStatus: Number(result.http?.status || result.response?.status || 0),
    responseContentType: text(result.http?.contentType || result.response?.contentType),
    error: sourceError && typeof sourceError === "object"
      ? {
          code: text(sourceError.code),
          messageDigest: sourceError.message ? digestFor(sourceError.message) : "",
          rawMessagePersisted: false,
        }
      : null,
  };
}

function terminalStateReset(state) {
  if (state === "completed") return { failedAt: "", abortedAt: "" };
  if (state === "failed") return { completedAt: "", abortedAt: "" };
  if (state === "aborted") return { completedAt: "", failedAt: "" };
  return {};
}

function captureIdentity(input = {}) {
  const identity = {
    sessionId: text(input.sessionId),
    turnId: text(input.turnId),
    attemptId: text(input.attemptId || input.callId),
    promptDigest: text(input.promptDigest),
    contextDigest: text(input.contextDigest),
    sourceClass: text(input.sourceClass),
  };
  return {
    ...identity,
    captureIdentityDigest: digestFor({ kind: "direct_turn_capture_identity", ...identity }),
  };
}

function finalCaptureDigest(input = {}, result = {}) {
  const tools = (Array.isArray(result.workspaceWorkerToolResults)
    ? result.workspaceWorkerToolResults
    : Array.isArray(result.toolResults) ? result.toolResults : [])
    .map(safeCapturedToolResult);
  return digestFor({
    kind: "direct_turn_capture_final",
    captureIdentity: captureIdentity(input),
    responseId: text(result.responseId),
    terminalState: terminalTurnState(result),
    terminalEvidence: terminalEvidence(result),
    events: sourceEvents(result.normalizedEvents),
    toolResultDigest: toolResultDigest(tools),
    workspaceWorkerContractDigest: text(result.workspaceWorkerContract?.contractDigest),
  });
}

function initialCapture(input = {}, turn = {}, now = new Date().toISOString()) {
  const identity = captureIdentity(input);
  return {
    schema: DIRECT_TURN_CAPTURE_SCHEMA,
    ...identity,
    status: "capturing",
    eventCount: Number(turn.normalizedEventCount || 0),
    eventPrefixDigest: "",
    toolResultCount: Array.isArray(turn.toolResults) ? turn.toolResults.length : 0,
    toolResultDigest: toolResultDigest(turn.toolResults),
    terminalState: "",
    finalCaptureDigest: "",
    complete: false,
    gapReceipts: [],
    openedAt: now,
    updatedAt: now,
    finalizedAt: "",
    rawPromptIncluded: false,
    rawContextIncluded: false,
    rawProviderFrameIncluded: false,
    rawWorkspacePathIncluded: false,
    grantsAuthority: false,
  };
}

class DirectTurnCaptureWriter {
  constructor(sessionStore, input = {}) {
    if (!sessionStore) fail("direct_turn_capture_session_store_required");
    this.sessionStore = sessionStore;
    this.input = {
      ...input,
      sessionId: text(input.sessionId),
      turnId: text(input.turnId),
      attemptId: text(input.attemptId || input.callId),
      promptDigest: text(input.promptDigest),
      contextDigest: text(input.contextDigest),
      sourceClass: text(input.sourceClass),
    };
    if (!this.input.sessionId || !this.input.turnId) {
      fail("direct_turn_capture_identity_required");
    }
    this.open();
  }

  turn() {
    const turn = this.sessionStore.readTurn(this.input.sessionId, this.input.turnId);
    if (!turn) fail("direct_turn_capture_turn_missing");
    return turn;
  }

  persistedEvents() {
    return this.sessionStore.readNormalizedEvents(this.input.sessionId, this.input.turnId);
  }

  open() {
    const turn = this.turn();
    const identity = captureIdentity(this.input);
    if (turn.capture) {
      if (
        turn.capture.schema !== DIRECT_TURN_CAPTURE_SCHEMA ||
        turn.capture.captureIdentityDigest !== identity.captureIdentityDigest
      ) fail("direct_turn_capture_identity_conflict");
      return turn.capture;
    }
    const events = this.persistedEvents();
    const capture = {
      ...initialCapture(this.input, turn),
      eventCount: events.length,
      eventPrefixDigest: eventPrefixDigest(events),
    };
    return this.sessionStore.updateTurnCapture(
      this.input.sessionId,
      this.input.turnId,
      capture,
    ).capture;
  }

  recordGap(code, details = {}) {
    return this.sessionStore.appendTurnCaptureGap(
      this.input.sessionId,
      this.input.turnId,
      { code, ...details },
    ).receipt;
  }

  captureWithCurrentEvidence(patch = {}) {
    const turn = this.turn();
    const events = this.persistedEvents();
    return {
      ...turn.capture,
      ...patch,
      eventCount: events.length,
      eventPrefixDigest: eventPrefixDigest(events),
      toolResultCount: Array.isArray(turn.toolResults) ? turn.toolResults.length : 0,
      toolResultDigest: toolResultDigest(turn.toolResults),
      updatedAt: new Date().toISOString(),
    };
  }

  refreshCapture(patch = {}) {
    const capture = this.captureWithCurrentEvidence(patch);
    return this.sessionStore.updateTurnCapture(
      this.input.sessionId,
      this.input.turnId,
      capture,
    ).capture;
  }

  appendEventPrefix(events = [], options = {}) {
    const incoming = sourceEvents(events);
    const turn = this.turn();
    if (!incoming.length) {
      return turn.capture?.complete === true ? turn.capture : this.refreshCapture();
    }
    const persisted = sourceEvents(this.persistedEvents());
    const sourceOffset = Number.isFinite(Number(options.sourceOffset))
      ? Math.max(0, Number(options.sourceOffset))
      : persisted.length;
    if (sourceOffset > persisted.length) {
      const code = turn.capture?.complete === true
        ? "direct_turn_capture_terminal_prefix_conflict"
        : "direct_turn_capture_prefix_gap";
      this.recordGap(code, {
        expectedEventCount: sourceOffset,
        observedEventCount: persisted.length,
        sourceOffset,
        expectedPrefixDigest: eventPrefixDigest(incoming.slice(0, sourceOffset)),
        observedPrefixDigest: eventPrefixDigest(persisted),
        preserveComplete: turn.capture?.complete === true,
      });
      fail(code);
    }
    const overlap = Math.min(incoming.length, Math.max(0, persisted.length - sourceOffset));
    for (let index = 0; index < overlap; index += 1) {
      if (digestFor(incoming[index]) !== digestFor(persisted[sourceOffset + index])) {
        const code = turn.capture?.complete === true
          ? "direct_turn_capture_terminal_prefix_conflict"
          : "direct_turn_capture_prefix_conflict";
        this.recordGap(code, {
          expectedEventCount: sourceOffset + incoming.length,
          observedEventCount: persisted.length,
          sourceOffset,
          expectedPrefixDigest: eventPrefixDigest(incoming.slice(0, index + 1)),
          observedPrefixDigest: eventPrefixDigest(persisted.slice(sourceOffset, sourceOffset + index + 1)),
          preserveComplete: turn.capture?.complete === true,
        });
        fail(code);
      }
    }
    const suffix = incoming.slice(overlap);
    if (turn.capture?.complete === true) {
      if (!suffix.length) return turn.capture;
      this.recordGap("direct_turn_capture_terminal_prefix_conflict", {
        expectedEventCount: persisted.length,
        observedEventCount: sourceOffset + incoming.length,
        sourceOffset,
        expectedPrefixDigest: eventPrefixDigest(persisted),
        observedPrefixDigest: eventPrefixDigest([...persisted.slice(0, sourceOffset), ...incoming]),
        preserveComplete: true,
      });
      fail("direct_turn_capture_terminal_prefix_conflict");
    }
    if (suffix.length) {
      this.sessionStore.appendNormalizedEvents(this.input.sessionId, this.input.turnId, suffix);
    }
    return this.refreshCapture({ status: "capturing", complete: false });
  }

  appendToolResult(result = {}) {
    const safe = safeCapturedToolResult(result);
    const turn = this.turn();
    if (turn.capture?.complete === true) {
      const key = text(safe.obligationId || safe.callId, safe.resultDigest);
      const existing = (Array.isArray(turn.toolResults) ? turn.toolResults : []).find((entry) =>
        text(entry?.obligationId || entry?.callId, entry?.resultDigest) === key);
      if (existing && text(existing.resultDigest) === safe.resultDigest) return turn.capture;
      this.recordGap("direct_turn_capture_terminal_tool_result_conflict", {
        expectedEventCount: Number(turn.normalizedEventCount || 0),
        observedEventCount: Number(turn.normalizedEventCount || 0),
        expectedPrefixDigest: eventPrefixDigest(this.persistedEvents()),
        observedPrefixDigest: eventPrefixDigest(this.persistedEvents()),
        sourceOffset: Number(turn.normalizedEventCount || 0),
        preserveComplete: true,
      });
      fail("direct_turn_capture_terminal_tool_result_conflict");
    }
    this.sessionStore.appendCapturedToolResult(
      this.input.sessionId,
      this.input.turnId,
      safe,
    );
    return this.refreshCapture({ status: "capturing", complete: false });
  }

  strictCommitCallback() {
    return (events, details = {}) => this.appendEventPrefix(events, {
      sourceOffset: Number(details.normalizedOffset || 0),
    });
  }

  finalize(result = {}, options = {}) {
    const expectedDigest = finalCaptureDigest(this.input, result);
    let turn = this.turn();
    if (turn.capture?.complete === true) {
      if (turn.capture.finalCaptureDigest !== expectedDigest) {
        this.recordGap("direct_turn_capture_terminal_conflict", {
          expectedEventCount: Array.isArray(result.normalizedEvents) ? result.normalizedEvents.length : 0,
          observedEventCount: Number(turn.normalizedEventCount || 0),
          expectedPrefixDigest: eventPrefixDigest(result.normalizedEvents),
          observedPrefixDigest: eventPrefixDigest(this.persistedEvents()),
          preserveComplete: true,
        });
        fail(text(options.duplicateConflictCode, "direct_turn_capture_terminal_conflict"));
      }
      const terminalState = terminalTurnState(result);
      const repaired = turn.state !== terminalState;
      if (repaired) {
        turn = this.sessionStore.updateTurnState(
          this.input.sessionId,
          this.input.turnId,
          terminalState,
          {
            ...terminalEvidence(result),
            ...terminalStateReset(terminalState),
            captureDigest: expectedDigest,
            captureRecovered: true,
          },
        );
      }
      return this.receipt({ duplicate: true, repaired, turn });
    }

    const expectedEvents = sourceEvents(result.normalizedEvents);
    try {
      this.appendEventPrefix(expectedEvents, { sourceOffset: 0 });
    } catch (error) {
      if (options.prefixConflictCode && [
        "direct_turn_capture_prefix_gap",
        "direct_turn_capture_prefix_conflict",
      ].includes(error?.code)) fail(options.prefixConflictCode);
      throw error;
    }
    for (const toolResult of (Array.isArray(result.workspaceWorkerToolResults)
      ? result.workspaceWorkerToolResults
      : Array.isArray(result.toolResults) ? result.toolResults : [])) {
      this.appendToolResult(toolResult);
    }
    const persisted = sourceEvents(this.persistedEvents());
    turn = this.turn();
    const exact = persisted.length === expectedEvents.length && persisted.every((event, index) =>
      digestFor(event) === digestFor(expectedEvents[index]));
    if (!exact) {
      this.recordGap("direct_turn_capture_terminal_prefix_incomplete", {
        expectedEventCount: expectedEvents.length,
        observedEventCount: persisted.length,
        expectedPrefixDigest: eventPrefixDigest(expectedEvents),
        observedPrefixDigest: eventPrefixDigest(persisted),
      });
      fail(text(options.prefixConflictCode, "direct_turn_capture_terminal_prefix_incomplete"));
    }
    const terminalState = terminalTurnState(result);
    const finalizedAt = new Date().toISOString();
    const capture = this.captureWithCurrentEvidence({
      status: "complete",
      terminalState,
      finalCaptureDigest: expectedDigest,
      complete: true,
      finalizedAt,
    });
    turn = this.sessionStore.finalizeTurnCapture(
      this.input.sessionId,
      this.input.turnId,
      capture,
      terminalState,
      {
        ...terminalEvidence(result),
        ...terminalStateReset(terminalState),
        captureDigest: expectedDigest,
        captureRecovered: Boolean(this.turn().capture?.gapReceipts?.length),
      },
    );
    return this.receipt({ duplicate: false, repaired: false, turn });
  }

  recover() {
    const turn = this.turn();
    const events = this.persistedEvents();
    const capture = this.refreshCapture({
      status: turn.capture?.complete === true ? "complete" : text(turn.capture?.status, "capturing"),
      complete: turn.capture?.complete === true,
    });
    return {
      sessionId: this.input.sessionId,
      turnId: this.input.turnId,
      state: turn.state,
      capture,
      eventCount: events.length,
      restartCatchUpRequired: capture.complete !== true,
    };
  }

  receipt(input = {}) {
    const turn = input.turn || this.turn();
    const capture = turn.capture || this.turn().capture;
    return {
      schema: DIRECT_TURN_CAPTURE_RECEIPT_SCHEMA,
      sessionId: this.input.sessionId,
      turnId: this.input.turnId,
      state: turn.state,
      eventCount: Number(capture?.eventCount || turn.normalizedEventCount || 0),
      toolResultCount: Number(capture?.toolResultCount || turn.toolResults?.length || 0),
      captureDigest: text(capture?.finalCaptureDigest),
      captureIdentityDigest: text(capture?.captureIdentityDigest),
      captureComplete: capture?.complete === true,
      gapReceiptRefs: (Array.isArray(capture?.gapReceipts) ? capture.gapReceipts : []).map((gap) => ({
        kind: "direct_turn_capture_gap",
        id: gap.gapReceiptId,
        digest: gap.receiptDigest,
      })),
      duplicate: input.duplicate === true,
      repaired: input.repaired === true,
      rawPromptPersisted: false,
      rawContextPersisted: false,
      rawProviderFramePersisted: false,
      rawWorkspacePathIncluded: false,
      grantsAuthority: false,
    };
  }
}

module.exports = {
  DIRECT_TURN_CAPTURE_RECEIPT_SCHEMA,
  DirectTurnCaptureWriter,
  captureIdentity,
  eventPrefixDigest,
  finalCaptureDigest,
  safeCapturedToolResult,
  sourceEvent,
  terminalEvidence,
  terminalTurnState,
  toolResultDigest,
};
