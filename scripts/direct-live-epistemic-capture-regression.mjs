#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  capturedWorkspaceToolResult,
  legacyNativeChildTurnId,
  nativeChildSessionId,
  openNativeChildProviderTurnCapture,
  nativeChildTurnId,
  persistNativeChildProviderTurn,
} = require("../src/main/direct/epistemic/native-child-capture");
const {
  buildLiveActivityProjection,
} = require("../src/main/direct/epistemic/live-activity-projection");
const {
  DirectEpistemicService,
} = require("../src/main/direct/epistemic/service");
const {
  DirectEpistemicStore,
} = require("../src/main/direct/epistemic/store");
const {
  DIRECT_CAPTURED_TOOL_RESULT_SCHEMA,
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  runTextOnlyDirectProbe,
} = require("../src/main/direct/transport/codex-responses-transport");

function profileDoc() {
  return {
    profile: {
      ontology: {
        models: [{ id: "gpt-5.4", status: "accepted" }],
      },
    },
  };
}

function authStore() {
  return {
    readStatus: () => ({
      status: "authenticated",
      accountId: "capture-fixture",
      hasAccessToken: true,
    }),
    readCredentials: () => ({ accessToken: "capture-fixture-token" }),
  };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(label);
}

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-live-epistemic-capture-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(rootDir, "sessions") });
  const epistemicStore = new DirectEpistemicStore({ rootDir: path.join(rootDir, "epistemic") });
  let lunaInvocations = 0;
  const service = new DirectEpistemicService({
    store: epistemicStore,
    sessionStore,
    transcriber: async () => {
      lunaInvocations += 1;
      return { descriptions: [] };
    },
  });

  const captureInput = {
    projectId: "project_live_capture",
    primaryThreadId: "primary_live_capture",
    workThreadId: "work_live_capture",
    childAgentId: "child_live_capture",
    displayLabel: "Live capture fixture",
    role: "sub_agent_worker",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    requestBody: { model: "gpt-5.4", reasoning: { effort: "medium" } },
    attemptId: "attempt_live_capture_1",
    promptDigest: "sha256:prompt_live_capture",
    contextDigest: "sha256:context_live_capture",
    contextMessageCount: 1,
  };
  assert.equal(
    nativeChildTurnId(captureInput, { responseId: "response_not_known_yet" }),
    nativeChildTurnId(captureInput, { responseId: "response_known_later" }),
    "child turn identity must be fixed before provider completion",
  );
  const writer = openNativeChildProviderTurnCapture(sessionStore, captureInput);
  const openedTurn = sessionStore.readTurn(writer.input.sessionId, writer.input.turnId);
  assert.equal(openedTurn.state, "streaming");
  assert.equal(openedTurn.capture.status, "capturing");
  assert.equal(openedTurn.capture.complete, false);

  const encoder = new TextEncoder();
  let providerResolved = false;
  const providerPromise = runTextOnlyDirectProbe({
    profileDoc: profileDoc(),
    authStore: authStore(),
    model: "gpt-5.4",
    prompt: "live capture fixture",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: response.output_text.delta",
          "data: {\"item_id\":\"capture_message\",\"delta\":\"SECRET_PARTIAL_PROSE_/private/worktree\"}",
          "",
          "",
        ].join("\n")));
        setTimeout(() => {
          controller.enqueue(encoder.encode([
            "event: response.completed",
            "data: {\"response\":{\"id\":\"response_live_capture\",\"status\":\"completed\"}}",
            "",
            "",
          ].join("\n")));
          controller.close();
        }, 300);
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } }),
    onNormalizedEventsCommitted: writer.strictCommitCallback(),
  });
  await waitFor(
    () => sessionStore.readNormalizedEvents(writer.input.sessionId, writer.input.turnId).length === 1,
    "first normalized event should be durable before provider completion",
  );
  assert.equal(providerResolved, false);
  await service.scheduleSessionSync(writer.input.sessionId);
  assert.equal(
    epistemicStore.readThreadProjectionCursor(writer.input.sessionId)?.eventCount,
    1,
    "deterministic E cursor should advance over the live O prefix",
  );
  assert.equal(providerResolved, false);
  const liveProjection = service.liveActivityProjection({
    projectId: captureInput.projectId,
    sessionId: writer.input.sessionId,
    turnId: writer.input.turnId,
  });
  assert.equal(liveProjection.terminal, false);
  assert.equal(liveProjection.typedRecordCounts.AgentUtteranceFragment, 1);
  assert.equal(liveProjection.deterministicProjection.status, "current");
  assert.equal(liveProjection.safety.usableForContextBuild, false);
  assert.equal(liveProjection.authority.grantsControl, false);
  assert.equal(liveProjection.authority.grantsEpistemicPromotion, false);
  assert.equal(JSON.stringify(liveProjection).includes("SECRET_PARTIAL_PROSE"), false);
  assert.equal(JSON.stringify(liveProjection).includes("/private/worktree"), false);

  const providerResult = await providerPromise;
  providerResolved = true;
  assert.equal(providerResult.ok, true);
  assert.equal(providerResult.lifecycle.timing.committedNormalizedEventCount, 2);
  const finalReceipt = writer.finalize(providerResult);
  assert.equal(finalReceipt.captureComplete, true);
  assert.equal(finalReceipt.eventCount, 2);
  assert.equal(sessionStore.readNormalizedEvents(finalReceipt.sessionId, finalReceipt.turnId).length, 2);
  await waitFor(
    () => epistemicStore.readThreadProjectionCursor(finalReceipt.sessionId)?.eventCount === 2,
    "terminal deterministic E cursor should reconcile the full prefix",
  );
  assert.equal(lunaInvocations, 0, "live deterministic transcription must never invoke Luna");

  const unclassifiedInput = {
    ...captureInput,
    childAgentId: "child_unclassified_capture",
    attemptId: "attempt_unclassified_capture",
    promptDigest: "sha256:prompt_unclassified_capture",
  };
  const unclassifiedWriter = openNativeChildProviderTurnCapture(sessionStore, unclassifiedInput);
  unclassifiedWriter.appendEventPrefix([{
    type: "future_normalized_event",
    sequence: 0,
    text: "UNCLASSIFIED_RAW_PROSE_MUST_NOT_COPY_TO_E",
    argumentsJson: "{\"path\":\"/private/native\"}",
  }], { sourceOffset: 0 });
  const unclassifiedProjection = service.syncThread(unclassifiedWriter.input.sessionId);
  const unclassifiedRecords = epistemicStore.recordsForRevision(unclassifiedProjection.eRevision.eRevisionId);
  const omission = unclassifiedRecords.find((record) => record.recordType === "UnclassifiedNormalizedEvent");
  assert(omission, "unclassified normalized events must emit an explicit typed omission");
  assert.equal(omission.standing, "mechanically_observed");
  assert.equal(omission.epistemicPromotion, false);
  assert.equal(omission.payload.sourcePayloadCopiedToE, false);
  assert.equal(JSON.stringify(omission).includes("UNCLASSIFIED_RAW_PROSE"), false);
  assert.equal(JSON.stringify(omission).includes("/private/native"), false);
  const safeUnclassified = buildLiveActivityProjection({
    sessionStore,
    epistemicStore,
    sessionId: unclassifiedWriter.input.sessionId,
    turnId: unclassifiedWriter.input.turnId,
  });
  assert.equal(safeUnclassified.typedRecordCounts.UnclassifiedNormalizedEvent, 1);
  assert.equal(JSON.stringify(safeUnclassified).includes("future_normalized_event"), false);

  const unknownTransportInput = {
    ...captureInput,
    childAgentId: "child_unknown_transport_capture",
    attemptId: "attempt_unknown_transport_capture",
    promptDigest: "sha256:prompt_unknown_transport_capture",
  };
  const unknownTransportWriter = openNativeChildProviderTurnCapture(sessionStore, unknownTransportInput);
  const unknownTransportResult = await runTextOnlyDirectProbe({
    profileDoc: profileDoc(),
    authStore: authStore(),
    model: "gpt-5.4",
    prompt: "unknown transport fixture",
    fetchImpl: async () => new Response([
      "event: response.future",
      "data: {\"text\":\"RAW_UNKNOWN_PROVIDER_SECRET_/private/provider\"}",
      "",
      "event: response.completed",
      "data: {\"response\":{\"id\":\"response_unknown_transport\",\"status\":\"completed\"}}",
      "",
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
    onNormalizedEventsCommitted: unknownTransportWriter.strictCommitCallback(),
  });
  assert.deepEqual(unknownTransportResult.unknownRawTypes, ["response.future"]);
  assert.equal(unknownTransportResult.normalizedEvents[0].type, "unclassified_provider_event");
  assert.equal(unknownTransportResult.normalizedEvents[0].rawPayloadIncluded, false);
  assert.equal(JSON.stringify(unknownTransportResult.normalizedEvents[0]).includes("RAW_UNKNOWN_PROVIDER_SECRET"), false);
  const unknownPersisted = sessionStore.readNormalizedEvents(
    unknownTransportWriter.input.sessionId,
    unknownTransportWriter.input.turnId,
  );
  assert.deepEqual(unknownPersisted.map((event) => event.type), [
    "unclassified_provider_event",
    "response_completed",
  ]);
  unknownTransportWriter.finalize(unknownTransportResult);
  const unknownTransportProjection = service.syncThread(unknownTransportWriter.input.sessionId);
  assert.equal(unknownTransportProjection.recordCounts.UnclassifiedNormalizedEvent, 1);

  for (const lineEnding of ["\n", "\r\n", "\r"]) {
    const fragmentedBody = [
      `event: response.created${lineEnding}`,
      `data: {"response":{"id":"response_fragmented_sse"}}${lineEnding}${lineEnding}`,
      `event: response.completed${lineEnding}`,
      `data: {"response":{"id":"response_fragmented_sse","status":"completed"}}${lineEnding}${lineEnding}`,
    ].join("");
    const bytes = encoder.encode(fragmentedBody);
    const fragmentedResult = await runTextOnlyDirectProbe({
      profileDoc: profileDoc(),
      authStore: authStore(),
      model: "gpt-5.4",
      prompt: "fragmented SSE line-ending fixture",
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          for (const boundary of [1, 7, 19, 31, 47, bytes.length]) {
            const previous = this.previous || 0;
            if (boundary > previous) controller.enqueue(bytes.slice(previous, boundary));
            this.previous = boundary;
          }
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    assert.equal(fragmentedResult.terminal.state, "completed");
    assert.deepEqual(fragmentedResult.normalizedEvents.map((event) => event.type), [
      "session_started",
      "response_completed",
    ]);
  }

  let asyncCommitCalls = 0;
  const unhandledRejections = [];
  const recordUnhandled = (reason) => unhandledRejections.push(reason);
  process.on("unhandledRejection", recordUnhandled);
  const asyncCommitResult = await runTextOnlyDirectProbe({
    profileDoc: profileDoc(),
    authStore: authStore(),
    model: "gpt-5.4",
    prompt: "async durable callback fixture",
    fetchImpl: async () => new Response([
      "event: response.completed",
      "data: {\"response\":{\"id\":\"response_async_commit\",\"status\":\"completed\"}}",
      "",
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
    onNormalizedEventsCommitted: async () => {
      asyncCommitCalls += 1;
      throw new Error("async durable write failed");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener("unhandledRejection", recordUnhandled);
  assert.equal(asyncCommitCalls, 1, "a rejected durable callback must not be reconciled a second time");
  assert.equal(unhandledRejections.length, 0, "the awaited durable callback must not leak an unhandled rejection");
  assert.equal(asyncCommitResult.ok, false);
  assert.equal(asyncCommitResult.error.code, "direct_normalized_event_commit_failed");
  assert.equal(asyncCommitResult.lifecycle.timing.durableCommitFailed, true);

  const sourceToolResult = {
    schema: "direct_workspace_worker_tool_result@1",
    stepOrdinal: 1,
    tool: "run_test",
    callId: "call_safe_tool_result",
    obligationId: "obligation_safe_tool_result",
    status: "completed",
    summary: "focused test passed",
    sideEffectExecuted: true,
    workspaceBindingId: "binding_safe_tool_result",
    workspaceBindingDigest: "sha256:binding_safe_tool_result",
    mutationOutcome: {
      requestId: "workspace_request_safe_tool_result",
      outcomeDigest: `sha256:${"a".repeat(64)}`,
    },
    providerOutputText: "RAW_TOOL_OUTPUT_/private/worktree",
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
    resultDigest: "sha256:source_safe_tool_result",
  };
  const safeToolResult = capturedWorkspaceToolResult(sourceToolResult);
  assert.equal(safeToolResult.schema, DIRECT_CAPTURED_TOOL_RESULT_SCHEMA);
  assert.equal(safeToolResult.sourceResultDigest, sourceToolResult.resultDigest);
  assert.equal(safeToolResult.mutationOutcomeDigest, sourceToolResult.mutationOutcome.outcomeDigest);
  assert.equal(Object.hasOwn(safeToolResult, "mutationOutcome"), false);
  assert.equal(JSON.stringify(safeToolResult).includes("RAW_TOOL_OUTPUT"), false);
  assert.equal(JSON.stringify(safeToolResult).includes("/private/worktree"), false);
  assert.throws(
    () => capturedWorkspaceToolResult({
      ...sourceToolResult,
      mutationOutcome: { outcomeDigest: "sha256:not-canonical" },
    }),
    (error) => error?.code === "direct_turn_capture_tool_result_mutation_outcome_invalid",
  );
  assert.throws(
    () => capturedWorkspaceToolResult({ ...sourceToolResult, argumentsJson: "{\"secret\":true}" }),
    (error) => error?.code === "direct_turn_capture_tool_result_field_unsupported",
  );
  assert.throws(
    () => capturedWorkspaceToolResult({ ...sourceToolResult, summary: "/private/native/result.txt" }),
    (error) => error?.code === "direct_turn_capture_tool_result_path_forbidden",
  );
  assert.throws(
    () => capturedWorkspaceToolResult({
      ...safeToolResult,
      metadata: { providerPayload: { text: "nested raw payload" } },
    }),
    (error) => error?.code === "direct_turn_capture_tool_result_raw_field_forbidden",
  );

  const replayInput = {
    ...captureInput,
    childAgentId: "child_completed_replay",
    attemptId: "attempt_completed_replay",
    promptDigest: "sha256:prompt_completed_replay",
  };
  const replayWriter = openNativeChildProviderTurnCapture(sessionStore, replayInput);
  const replayEvents = [{
    type: "response_completed",
    sequence: 0,
    responseId: "response_completed_replay",
  }];
  replayWriter.finalize({
    responseId: "response_completed_replay",
    terminal: { state: "completed" },
    normalizedEvents: replayEvents,
    workspaceWorkerToolResults: [sourceToolResult],
  });
  const completedBeforeReplay = sessionStore.readTurn(replayWriter.input.sessionId, replayWriter.input.turnId);
  replayWriter.appendEventPrefix(replayEvents, { sourceOffset: 0 });
  replayWriter.appendToolResult(sourceToolResult);
  const completedAfterReplay = sessionStore.readTurn(replayWriter.input.sessionId, replayWriter.input.turnId);
  assert.deepEqual(completedAfterReplay.capture, completedBeforeReplay.capture, "exact completed replay must be a no-op");
  assert.throws(
    () => replayWriter.appendEventPrefix([{
      type: "message_delta",
      sequence: 1,
      text: "late suffix",
    }], { sourceOffset: 1 }),
    (error) => error?.code === "direct_turn_capture_terminal_prefix_conflict",
  );
  assert.throws(
    () => replayWriter.appendToolResult({
      ...sourceToolResult,
      callId: "call_late_tool_result",
      obligationId: "obligation_late_tool_result",
      resultDigest: "sha256:source_late_tool_result",
    }),
    (error) => error?.code === "direct_turn_capture_terminal_tool_result_conflict",
  );
  const conflictedCompletedTurn = sessionStore.readTurn(replayWriter.input.sessionId, replayWriter.input.turnId);
  assert.equal(conflictedCompletedTurn.capture.status, "complete");
  assert.equal(conflictedCompletedTurn.capture.complete, true);
  assert(conflictedCompletedTurn.capture.gapReceipts.some((receipt) =>
    receipt.code === "direct_turn_capture_terminal_prefix_conflict"));
  assert(conflictedCompletedTurn.capture.gapReceipts.some((receipt) =>
    receipt.code === "direct_turn_capture_terminal_tool_result_conflict"));

  const tamperedToolResult = { ...safeToolResult, summary: "tampered after digest" };
  assert.throws(
    () => sessionStore.appendCapturedToolResult(
      replayWriter.input.sessionId,
      replayWriter.input.turnId,
      tamperedToolResult,
    ),
    (error) => error?.code === "direct_turn_capture_tool_result_digest_invalid",
  );

  const gapInput = {
    ...captureInput,
    childAgentId: "child_gap_capture",
    attemptId: "attempt_gap_capture",
    promptDigest: "sha256:prompt_gap_capture",
  };
  const gapWriter = openNativeChildProviderTurnCapture(sessionStore, gapInput);
  assert.throws(
    () => gapWriter.appendEventPrefix([{ type: "message_delta", sequence: 2, text: "gap" }], { sourceOffset: 2 }),
    (error) => error?.code === "direct_turn_capture_prefix_gap",
  );
  const gapTurn = sessionStore.readTurn(gapWriter.input.sessionId, gapWriter.input.turnId);
  assert.equal(gapTurn.capture.status, "gap");
  assert.equal(gapTurn.capture.gapReceipts.length, 1);
  assert.equal(gapTurn.capture.gapReceipts[0].rawTextIncluded, false);

  const contradictionStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "contradiction-sessions"),
  });
  const contradictionInput = {
    ...captureInput,
    childAgentId: "child_complete_active_contradiction",
    attemptId: "attempt_complete_active_contradiction",
    promptDigest: "sha256:prompt_complete_active_contradiction",
  };
  const contradictionWriter = openNativeChildProviderTurnCapture(contradictionStore, contradictionInput);
  contradictionWriter.appendEventPrefix([{
    type: "response_completed",
    sequence: 0,
    responseId: "response_complete_active_contradiction",
  }], { sourceOffset: 0 });
  contradictionWriter.refreshCapture({
    status: "complete",
    terminalState: "completed",
    finalCaptureDigest: "sha256:complete_active_contradiction",
    complete: true,
    finalizedAt: new Date().toISOString(),
  });
  contradictionStore.recoverInterruptedTurns();
  const reconciledContradiction = contradictionStore.readTurn(
    contradictionWriter.input.sessionId,
    contradictionWriter.input.turnId,
  );
  assert.equal(reconciledContradiction.state, "failed");
  assert.equal(reconciledContradiction.capture.status, "gap");
  assert.equal(reconciledContradiction.capture.complete, false);
  assert(reconciledContradiction.capture.gapReceipts.some((receipt) =>
    receipt.code === "direct_turn_capture_restart_verification_failed"));
  assert.equal(
    contradictionStore.readSession(contradictionWriter.input.sessionId).turns[0].state,
    "failed",
    "restart must reject an unverified complete-capture claim",
  );

  const canonicalContradictionStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "canonical-contradiction-sessions"),
  });
  const canonicalContradictionInput = {
    ...captureInput,
    childAgentId: "child_canonical_complete_active_contradiction",
    attemptId: "attempt_canonical_complete_active_contradiction",
    promptDigest: "sha256:prompt_canonical_complete_active_contradiction",
  };
  const canonicalContradictionWriter = openNativeChildProviderTurnCapture(
    canonicalContradictionStore,
    canonicalContradictionInput,
  );
  const canonicalContradictionResult = {
    responseId: "response_canonical_complete_active_contradiction",
    normalizedEvents: [{
      type: "response_completed",
      sequence: 0,
      responseId: "response_canonical_complete_active_contradiction",
    }],
    terminal: { state: "completed", error: null },
  };
  canonicalContradictionWriter.finalize(canonicalContradictionResult);
  const canonicalTerminalTurn = canonicalContradictionStore.readTurn(
    canonicalContradictionWriter.input.sessionId,
    canonicalContradictionWriter.input.turnId,
  );
  canonicalContradictionStore.writeTurn({
    ...canonicalTerminalTurn,
    state: "streaming",
    completedAt: "",
  });
  canonicalContradictionStore.recoverInterruptedTurns();
  const canonicalRecoveredTurn = canonicalContradictionStore.readTurn(
    canonicalContradictionWriter.input.sessionId,
    canonicalContradictionWriter.input.turnId,
  );
  assert.equal(canonicalRecoveredTurn.state, "completed");
  assert.equal(canonicalRecoveredTurn.capture.complete, true);
  assert.equal(canonicalRecoveredTurn.captureRecovered, true);

  const appendWindowStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "append-window-sessions"),
  });
  const appendWindowWriter = openNativeChildProviderTurnCapture(appendWindowStore, {
    ...captureInput,
    childAgentId: "child_append_window",
    attemptId: "attempt_append_window",
    promptDigest: "sha256:prompt_append_window",
  });
  const originalUpdateTurnState = appendWindowStore.updateTurnState.bind(appendWindowStore);
  let failAfterEventAppend = true;
  appendWindowStore.updateTurnState = (...args) => {
    if (failAfterEventAppend) {
      failAfterEventAppend = false;
      const error = new Error("simulated failure after canonical O append");
      error.code = "simulated_event_metadata_crash";
      throw error;
    }
    return originalUpdateTurnState(...args);
  };
  assert.throws(
    () => appendWindowWriter.appendEventPrefix([{
      type: "session_started",
      sequence: 0,
      responseId: "response_append_window",
    }], { sourceOffset: 0 }),
    (error) => error?.code === "simulated_event_metadata_crash",
  );
  appendWindowStore.updateTurnState = originalUpdateTurnState;
  assert.equal(appendWindowStore.readNormalizedEvents(
    appendWindowWriter.input.sessionId,
    appendWindowWriter.input.turnId,
  ).length, 1);
  assert.equal(appendWindowStore.readTurn(
    appendWindowWriter.input.sessionId,
    appendWindowWriter.input.turnId,
  ).normalizedEventCount, 0);
  appendWindowStore.recoverInterruptedTurns();
  const recoveredAppendWindow = appendWindowStore.readTurn(
    appendWindowWriter.input.sessionId,
    appendWindowWriter.input.turnId,
  );
  assert.equal(recoveredAppendWindow.normalizedEventCount, 1);
  assert.equal(recoveredAppendWindow.capture.eventCount, 1);
  const appendWindowGap = recoveredAppendWindow.capture.gapReceipts.find((receipt) =>
    receipt.code === "direct_turn_capture_interrupted");
  assert.equal(appendWindowGap.expectedEventCount, 0);
  assert.equal(appendWindowGap.observedEventCount, 1);
  assert.equal(appendWindowGap.observedPrefixDigest, recoveredAppendWindow.capture.eventPrefixDigest);

  const boundedEventStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "bounded-event-sessions"),
    maxNormalizedEventBytesPerTurn: 180_000,
    maxNormalizedEventCountPerTurn: 2,
  });
  const boundedEventSession = boundedEventStore.createSession({
    sessionId: "session_bounded_events",
    projectId: captureInput.projectId,
    nativeDirectSession: true,
  });
  const boundedEventTurn = boundedEventStore.createTurn(boundedEventSession.sessionId, {
    turnId: "turn_bounded_events",
    state: "streaming",
  });
  const utf8EventText = "😀".repeat(40_000);
  boundedEventStore.appendNormalizedEvent(boundedEventSession.sessionId, boundedEventTurn.turnId, {
    type: "message_delta",
    sequence: 0,
    text: utf8EventText,
  });
  const boundedEventPath = boundedEventStore.eventPath(boundedEventSession.sessionId, boundedEventTurn.turnId);
  const boundedEventBytesBeforeReject = fs.statSync(boundedEventPath).size;
  const originalReadFileSync = fs.readFileSync;
  let eventReadFileSyncCalls = 0;
  fs.readFileSync = (filePath, ...args) => {
    if (filePath === boundedEventPath) eventReadFileSyncCalls += 1;
    return originalReadFileSync(filePath, ...args);
  };
  const boundedEvents = boundedEventStore.readNormalizedEvents(boundedEventSession.sessionId, boundedEventTurn.turnId);
  fs.readFileSync = originalReadFileSync;
  assert.equal(boundedEvents[0].text, utf8EventText, "incremental event reads must preserve UTF-8 across chunks");
  assert.equal(eventReadFileSyncCalls, 0, "normalized event reads must not materialize the event log with readFileSync");
  assert.throws(
    () => boundedEventStore.appendNormalizedEvent(boundedEventSession.sessionId, boundedEventTurn.turnId, {
      type: "message_delta",
      sequence: 1,
      text: "x".repeat(40_000),
    }),
    (error) => error?.code === "direct_normalized_event_bytes_exceeded",
  );
  assert.equal(fs.statSync(boundedEventPath).size, boundedEventBytesBeforeReject, "byte-bound rejection must precede durable append");
  assert.throws(
    () => boundedEventStore.appendNormalizedEvents(boundedEventSession.sessionId, boundedEventTurn.turnId, [
      { type: "response_created", sequence: 1 },
      { type: "response_completed", sequence: 2 },
    ]),
    (error) => error?.code === "direct_normalized_event_count_exceeded",
  );
  assert.equal(fs.statSync(boundedEventPath).size, boundedEventBytesBeforeReject, "event-count rejection must precede durable append");

  const oversizedLogStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "oversized-log-sessions"),
    maxNormalizedEventBytesPerTurn: 1_024,
    maxNormalizedEventCountPerTurn: 2,
  });
  const oversizedLogSession = oversizedLogStore.createSession({
    sessionId: "session_oversized_log",
    projectId: captureInput.projectId,
    nativeDirectSession: true,
  });
  const oversizedLogTurn = oversizedLogStore.createTurn(oversizedLogSession.sessionId, {
    turnId: "turn_oversized_log",
    state: "streaming",
  });
  const oversizedLogPath = oversizedLogStore.eventPath(oversizedLogSession.sessionId, oversizedLogTurn.turnId);
  fs.mkdirSync(path.dirname(oversizedLogPath), { recursive: true });
  fs.writeFileSync(oversizedLogPath, `${JSON.stringify({ at: new Date().toISOString(), event: { type: "message_delta", sequence: 0, text: "legacy oversized 😀".repeat(200) } })}\n`, "utf8");
  const oversizedInspection = oversizedLogStore.inspectNormalizedEventLog(oversizedLogSession.sessionId, oversizedLogTurn.turnId);
  assert.equal(oversizedInspection.complete, false);
  assert.equal(oversizedInspection.errorCode, "direct_normalized_event_bytes_exceeded");
  assert(oversizedInspection.byteCount > 1_024 && oversizedInspection.byteCount <= 1_025, "oversized inspection must stop at the bounded byte probe");
  assert.throws(
    () => oversizedLogStore.readNormalizedEvents(oversizedLogSession.sessionId, oversizedLogTurn.turnId),
    (error) => error?.code === "direct_normalized_event_bytes_exceeded",
  );

  const partialLogStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "partial-log-sessions"),
  });
  const partialLogWriter = openNativeChildProviderTurnCapture(partialLogStore, {
    ...captureInput,
    childAgentId: "child_partial_log",
    attemptId: "attempt_partial_log",
    promptDigest: "sha256:prompt_partial_log",
  });
  partialLogWriter.appendEventPrefix([{
    type: "session_started",
    sequence: 0,
    responseId: "response_partial_log",
  }], { sourceOffset: 0 });
  fs.appendFileSync(
    partialLogStore.eventPath(partialLogWriter.input.sessionId, partialLogWriter.input.turnId),
    "{\"at\":\"partial",
    "utf8",
  );
  partialLogStore.recoverInterruptedTurns();
  const partialLogTurn = partialLogStore.readTurn(
    partialLogWriter.input.sessionId,
    partialLogWriter.input.turnId,
  );
  assert.equal(partialLogTurn.state, "failed");
  assert.equal(partialLogTurn.eventLogIntegrity.status, "invalid");
  assert.equal(partialLogTurn.eventLogIntegrity.observedEventCount, 1);
  assert(partialLogTurn.capture.gapReceipts.some((receipt) =>
    receipt.code === "direct_turn_capture_restart_event_log_invalid" &&
    receipt.observedEventCount === 1));
  assert.throws(
    () => partialLogStore.readNormalizedEvents(
      partialLogWriter.input.sessionId,
      partialLogWriter.input.turnId,
    ),
    (error) => error?.code === "direct_normalized_event_jsonl_invalid",
  );

  const legacyStore = new DirectSessionStore({ rootDir: path.join(rootDir, "legacy-sessions") });
  const legacyInput = {
    ...captureInput,
    childAgentId: "child_legacy_capture",
    attemptId: "attempt_legacy_capture",
    promptDigest: "sha256:prompt_legacy_capture",
    contextDigest: "sha256:context_legacy_capture",
  };
  const legacyResult = {
    responseId: "response_legacy_capture",
    terminal: { state: "completed" },
    normalizedEvents: [{
      type: "response_completed",
      sequence: 0,
      responseId: "response_legacy_capture",
    }],
  };
  const legacySessionId = nativeChildSessionId(legacyInput);
  const legacyTurnId = legacyNativeChildTurnId(legacyInput, legacyResult);
  const stableTurnId = nativeChildTurnId(legacyInput);
  assert.notEqual(legacyTurnId, stableTurnId);
  legacyStore.createSession({
    sessionId: legacySessionId,
    projectId: legacyInput.projectId,
    title: "Legacy native child fixture",
    agentId: legacyInput.childAgentId,
    agentThreadId: legacyInput.childAgentId,
    parentThreadId: legacyInput.primaryThreadId,
    primaryThreadId: legacyInput.primaryThreadId,
    nativeDirectSession: true,
  });
  legacyStore.createTurn(legacySessionId, {
    turnId: legacyTurnId,
    state: "streaming",
    agentId: legacyInput.childAgentId,
    agentThreadId: legacyInput.childAgentId,
    requestShape: {
      attemptId: legacyInput.attemptId,
      promptDigest: legacyInput.promptDigest,
      captureDigest: "sha256:legacy_terminal_capture",
    },
  });
  legacyStore.appendNormalizedEvents(legacySessionId, legacyTurnId, legacyResult.normalizedEvents);
  legacyStore.updateTurnState(legacySessionId, legacyTurnId, "completed", {
    captureDigest: "sha256:legacy_terminal_capture",
  });
  const adoptedLegacy = persistNativeChildProviderTurn(legacyStore, legacyInput, legacyResult);
  assert.equal(adoptedLegacy.turnId, legacyTurnId);
  assert.deepEqual(legacyStore.listTurnIdsFromDisk(legacySessionId), [legacyTurnId]);
  const adoptedLegacyTurn = legacyStore.readTurn(legacySessionId, legacyTurnId);
  assert.equal(adoptedLegacyTurn.requestShape.legacyResponseIdentityAdopted, true);
  assert.equal(adoptedLegacyTurn.requestShape.stableTurnIdentity, stableTurnId);
  assert.equal(adoptedLegacyTurn.capture.complete, true);

  service.close();
  epistemicStore.close();

  const restartInput = {
    ...captureInput,
    childAgentId: "child_restart_capture",
    attemptId: "attempt_restart_capture",
    promptDigest: "sha256:prompt_restart_capture",
  };
  const restartWriter = openNativeChildProviderTurnCapture(sessionStore, restartInput);
  restartWriter.appendEventPrefix([{
    type: "message_delta",
    sequence: 0,
    itemId: "restart_message",
    text: "restart catch-up source",
  }], { sourceOffset: 0 });
  sessionStore.recoverInterruptedTurns();
  const recoveredTurn = sessionStore.readTurn(restartWriter.input.sessionId, restartWriter.input.turnId);
  assert.equal(recoveredTurn.capture.status, "gap");
  assert(recoveredTurn.capture.gapReceipts.some((receipt) => receipt.code === "direct_turn_capture_interrupted"));

  const reopenedStore = new DirectEpistemicStore({ rootDir: path.join(rootDir, "epistemic") });
  const restartedService = new DirectEpistemicService({
    store: reopenedStore,
    sessionStore,
    transcriber: async () => {
      lunaInvocations += 1;
      return { descriptions: [] };
    },
  });
  const restartCursor = reopenedStore.readThreadProjectionCursor(restartWriter.input.sessionId);
  assert.equal(restartCursor.eventCount, 1, "restart must deterministically catch up an unindexed O prefix");
  const restartedSubject = reopenedStore.findSubject("thread", restartWriter.input.sessionId);
  const restartRecords = reopenedStore.recordsForRevision(
    reopenedStore.readHead(restartedSubject.subjectId).eRevision.eRevisionId,
  );
  assert.equal(restartRecords.filter((record) => record.recordType === "AgentUtteranceFragment").length, 1);
  assert.equal(lunaInvocations, 0, "restart catch-up must remain deterministic and local");
  restartedService.close();
  reopenedStore.close();

  console.log(JSON.stringify({
    ok: true,
    stablePreResponseTurnIdentity: true,
    livePrefixDurable: true,
    deterministicCursorAdvanced: true,
    unclassifiedOmissionTyped: true,
    unknownTransportOmissionTyped: true,
    asyncStrictCommitHandledOnce: true,
    toolResultCaptureFailClosed: true,
    completedReplayIdempotent: true,
    completeActiveRecoveryVerified: true,
    forgedCompleteCaptureRejected: true,
    appendMetadataWindowRecoveredFromO: true,
    boundedNormalizedEventAppend: true,
    boundedNormalizedEventRead: true,
    oversizedNormalizedEventLogFailedClosed: true,
    partialEventLogFailedClosed: true,
    fragmentedSseLineEndings: ["LF", "CRLF", "CR"],
    legacyCaptureAdopted: true,
    captureGapDurable: true,
    restartCatchUp: true,
    safePassiveProjection: true,
    lunaAutomaticInvocation: false,
  }));
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
