"use strict";

const {
  DIRECT_TURN_CAPTURE_SCHEMA,
} = require("../session/session-store");
const { digestFor, text } = require("./kernel");

const DIRECT_TURN_CAPTURE_RECEIPT_SCHEMA = "direct_turn_capture_receipt@1";

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

function safeCapturedToolResult(result = {}) {
  const providerOutputText = typeof result?.providerOutputText === "string"
    ? result.providerOutputText
    : "";
  const {
    providerOutputText: _providerOutputText,
    nativeRoot: _nativeRoot,
    worktreePath: _worktreePath,
    repositoryPath: _repositoryPath,
    localPath: _localPath,
    linuxPath: _linuxPath,
    windowsPath: _windowsPath,
    command: _command,
    ...typed
  } = result || {};
  return {
    ...typed,
    providerOutputDigest: providerOutputText ? digestFor(providerOutputText) : "",
    providerOutputCharacterCount: providerOutputText.length,
    rawOutputPersisted: false,
    rawArgumentsPersisted: false,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
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

  refreshCapture(patch = {}) {
    const turn = this.turn();
    const events = this.persistedEvents();
    const capture = {
      ...turn.capture,
      ...patch,
      eventCount: events.length,
      eventPrefixDigest: eventPrefixDigest(events),
      toolResultCount: Array.isArray(turn.toolResults) ? turn.toolResults.length : 0,
      toolResultDigest: toolResultDigest(turn.toolResults),
      updatedAt: new Date().toISOString(),
    };
    return this.sessionStore.updateTurnCapture(
      this.input.sessionId,
      this.input.turnId,
      capture,
    ).capture;
  }

  appendEventPrefix(events = [], options = {}) {
    const incoming = sourceEvents(events);
    if (!incoming.length) return this.refreshCapture();
    const persisted = sourceEvents(this.persistedEvents());
    const sourceOffset = Number.isFinite(Number(options.sourceOffset))
      ? Math.max(0, Number(options.sourceOffset))
      : persisted.length;
    if (sourceOffset > persisted.length) {
      this.recordGap("direct_turn_capture_prefix_gap", {
        expectedEventCount: sourceOffset,
        observedEventCount: persisted.length,
        sourceOffset,
        expectedPrefixDigest: eventPrefixDigest(incoming.slice(0, sourceOffset)),
        observedPrefixDigest: eventPrefixDigest(persisted),
      });
      fail("direct_turn_capture_prefix_gap");
    }
    const overlap = Math.min(incoming.length, Math.max(0, persisted.length - sourceOffset));
    for (let index = 0; index < overlap; index += 1) {
      if (digestFor(incoming[index]) !== digestFor(persisted[sourceOffset + index])) {
        this.recordGap("direct_turn_capture_prefix_conflict", {
          expectedEventCount: sourceOffset + incoming.length,
          observedEventCount: persisted.length,
          sourceOffset,
          expectedPrefixDigest: eventPrefixDigest(incoming.slice(0, index + 1)),
          observedPrefixDigest: eventPrefixDigest(persisted.slice(sourceOffset, sourceOffset + index + 1)),
        });
        fail("direct_turn_capture_prefix_conflict");
      }
    }
    const suffix = incoming.slice(overlap);
    if (suffix.length) {
      this.sessionStore.appendNormalizedEvents(this.input.sessionId, this.input.turnId, suffix);
    }
    return this.refreshCapture({ status: "capturing", complete: false });
  }

  appendToolResult(result = {}) {
    const safe = safeCapturedToolResult(result);
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
    this.refreshCapture({
      status: "complete",
      terminalState,
      finalCaptureDigest: expectedDigest,
      complete: true,
      finalizedAt,
    });
    turn = this.sessionStore.updateTurnState(
      this.input.sessionId,
      this.input.turnId,
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
