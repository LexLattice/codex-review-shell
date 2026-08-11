"use strict";

const { digestFor, text } = require("./kernel");

function nativeChildSessionId(input = {}) {
  return `direct_child_session_${digestFor({
    projectId: text(input.projectId),
    primaryThreadId: text(input.primaryThreadId),
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
  }).slice(0, 24)}`;
}

function nativeChildTurnId(input = {}, result = {}) {
  return `direct_child_turn_${digestFor({
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
    attemptId: text(input.attemptId || input.callId),
    promptDigest: text(input.promptDigest),
    responseId: text(result.responseId),
  }).slice(0, 24)}`;
}

function sourceEvent(event = {}) {
  const { persistedIndex, persistedAt, sourceEnvelopeDigest, ...source } = event || {};
  return source;
}

function terminalEvidence(result = {}) {
  const sourceError = result.terminal?.error || result.error;
  return {
    responseStatus: Number(result.http?.status || 0),
    responseContentType: text(result.http?.contentType),
    error: sourceError && typeof sourceError === "object"
      ? {
          code: text(sourceError.code),
          messageDigest: sourceError.message ? digestFor(sourceError.message) : "",
          rawMessagePersisted: false,
        }
      : null,
  };
}

function terminalMetadata(result = {}, expectedCaptureDigest = "", recovered = false) {
  const state = terminalTurnState(result);
  return {
    ...terminalEvidence(result),
    ...(state === "completed" ? { failedAt: "", abortedAt: "" } : {}),
    ...(state === "failed" ? { completedAt: "", abortedAt: "" } : {}),
    ...(state === "aborted" ? { completedAt: "", failedAt: "" } : {}),
    captureDigest: text(expectedCaptureDigest),
    captureRecovered: recovered === true,
  };
}

function captureDigest(input = {}, result = {}) {
  return digestFor({
    childAgentId: text(input.agent?.agentThreadId || input.childAgentId),
    attemptId: text(input.attemptId || input.callId),
    promptDigest: text(input.promptDigest),
    contextDigest: text(input.contextDigest),
    responseId: text(result.responseId),
    terminalState: terminalTurnState(result),
    terminalEvidence: terminalEvidence(result),
    events: (Array.isArray(result.normalizedEvents) ? result.normalizedEvents : []).map(sourceEvent),
  });
}

function terminalTurnState(result = {}) {
  const state = text(result.terminal?.state);
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
  if ((Array.isArray(result.normalizedEvents) ? result.normalizedEvents : []).some((event) => event?.type === "response_completed")) {
    return "completed";
  }
  return result.error || result.terminal?.error ? "failed" : "response_incomplete";
}

function persistNativeChildProviderTurn(sessionStore, input = {}, result = {}) {
  if (!sessionStore) throw new Error("Native child capture requires a Direct session store.");
  const projectId = text(input.projectId, "project_direct_agents");
  const childAgentId = text(input.agent?.agentThreadId || input.childAgentId);
  if (!childAgentId) throw new Error("Native child capture requires a child agent identity.");
  const sessionId = nativeChildSessionId(input);
  const expectedCaptureDigest = captureDigest(input, result);
  let session = sessionStore.readSession(sessionId);
  if (!session) {
    session = sessionStore.createSession({
      sessionId,
      projectId,
      title: text(input.agent?.displayLabel, `Native child ${childAgentId.slice(0, 12)}`),
      model: text(input.requestBody?.model || input.agent?.model),
      reasoningEffort: text(input.requestBody?.reasoning?.effort || input.agent?.reasoningEffort),
      agentId: childAgentId,
      agentKind: "native_sub_agent",
      agentThreadId: childAgentId,
      parentThreadId: text(input.primaryThreadId),
      primaryThreadId: text(input.primaryThreadId),
      agentLabel: text(input.agent?.displayLabel),
      agentRole: text(input.agent?.role, "sub_agent_worker"),
      workThreadId: text(input.workThreadId),
      sourceClass: "native_child_provider_turn",
      nativeDirectSession: true,
    });
  }
  const turnId = nativeChildTurnId(input, result);
  const existingTurn = sessionStore.readTurn(sessionId, turnId);
  if (existingTurn) {
    if (text(existingTurn.requestShape?.captureDigest) !== expectedCaptureDigest) {
      const error = new Error("direct_epistemic_native_child_duplicate_conflict");
      error.code = "direct_epistemic_native_child_duplicate_conflict";
      throw error;
    }
    const expectedEvents = (Array.isArray(result.normalizedEvents) ? result.normalizedEvents : []).map(sourceEvent);
    const persistedEvents = sessionStore.readNormalizedEvents(sessionId, turnId).map(sourceEvent);
    const prefixMatches = persistedEvents.length <= expectedEvents.length && persistedEvents.every((event, index) =>
      digestFor(event) === digestFor(expectedEvents[index]));
    if (!prefixMatches) {
      const error = new Error("direct_epistemic_native_child_partial_capture_conflict");
      error.code = "direct_epistemic_native_child_partial_capture_conflict";
      throw error;
    }
    if (persistedEvents.length < expectedEvents.length) {
      sessionStore.appendNormalizedEvents(sessionId, turnId, expectedEvents.slice(persistedEvents.length));
    }
    const state = terminalTurnState(result);
    const repaired = existingTurn.state !== state || persistedEvents.length < expectedEvents.length;
    if (repaired) sessionStore.updateTurnState(
      sessionId,
      turnId,
      state,
      terminalMetadata(result, expectedCaptureDigest, true),
    );
    return {
      sessionId,
      turnId,
      state,
      duplicate: true,
      repaired,
      captureDigest: expectedCaptureDigest,
      rawPromptPersisted: false,
    };
  }
  const turn = sessionStore.createTurn(sessionId, {
    turnId,
    state: "streaming",
    model: text(input.requestBody?.model || input.agent?.model),
    reasoningEffort: text(input.requestBody?.reasoning?.effort || input.agent?.reasoningEffort),
    agentId: childAgentId,
    agentKind: "native_sub_agent",
    agentThreadId: childAgentId,
    parentThreadId: text(input.primaryThreadId),
    agentLabel: text(input.agent?.displayLabel),
    agentRole: text(input.agent?.role, "sub_agent_worker"),
    sourceClass: "native_child_provider_turn",
    nativeDirectSession: true,
    requestShape: {
      model: text(input.requestBody?.model),
      reasoningEffort: text(input.requestBody?.reasoning?.effort),
      promptDigest: text(input.promptDigest),
      contextDigest: text(input.contextDigest),
      contextMessageCount: Number(input.contextMessageCount || 0),
      attemptId: text(input.attemptId || input.callId),
      captureDigest: expectedCaptureDigest,
      rawPromptIncluded: false,
      rawContextIncluded: false,
    },
  });
  const events = Array.isArray(result.normalizedEvents) ? result.normalizedEvents : [];
  if (events.length) sessionStore.appendNormalizedEvents(sessionId, turn.turnId, events);
  const state = terminalTurnState(result);
  sessionStore.updateTurnState(
    sessionId,
    turn.turnId,
    state,
    terminalMetadata(result, expectedCaptureDigest, false),
  );
  sessionStore.notifyEpistemicObservers?.({
    kind: "native_child_turn_persisted",
    sessionId,
    turnId: turn.turnId,
    eventCount: events.length,
  });
  return {
    sessionId,
    turnId,
    state,
    eventCount: events.length,
    duplicate: false,
    captureDigest: expectedCaptureDigest,
    rawPromptPersisted: false,
    rawContextPersisted: false,
  };
}

module.exports = {
  nativeChildSessionId,
  nativeChildTurnId,
  captureDigest,
  persistNativeChildProviderTurn,
  terminalEvidence,
  terminalTurnState,
};
