#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectNativeAgentPool,
  safeEpistemicProgress,
} = require("../src/main/direct/agents/native-agent-pool");
const { runDirectWorkspaceWorker } = require("../src/main/direct/agents/workspace-worker-runtime");
const { createNativeChildLiveTurnCapture } = require("../src/main/direct/epistemic/live-turn-capture-adapter");
const { DirectEpistemicService } = require("../src/main/direct/epistemic/service");
const { DirectEpistemicStore } = require("../src/main/direct/epistemic/store");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function nativeEvents(responseId) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    {
      type: "message_delta",
      sequence: 1,
      responseId,
      itemId: `${responseId}_message`,
      text: "NATIVE_PARTIAL_PROSE_MUST_NOT_ENTER_POOL_/private/native",
    },
    { type: "response_completed", sequence: 2, responseId, stopReason: "completed" },
  ];
}

function toolEvents(responseId) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    {
      type: "tool_call_started",
      sequence: 1,
      responseId,
      itemId: `${responseId}_read`,
      callId: `${responseId}_call`,
      name: "read_file",
      toolType: "function_call",
    },
    {
      type: "tool_call_completed",
      sequence: 2,
      responseId,
      itemId: `${responseId}_read`,
      callId: `${responseId}_call`,
      name: "read_file",
      toolType: "function_call",
      argumentsJson: JSON.stringify({ path: "fixture.txt" }),
    },
    { type: "response_completed", sequence: 3, responseId, stopReason: "tool_waiting" },
  ];
}

function completedEvents(responseId) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    {
      type: "message_delta",
      sequence: 1,
      responseId,
      itemId: `${responseId}_message`,
      text: "Workspace observation complete.",
    },
    { type: "response_completed", sequence: 2, responseId, stopReason: "completed" },
  ];
}

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-live-child-observation-"));
const sessionStore = new DirectSessionStore({ rootDir: path.join(rootDir, "sessions") });
let epistemicStore = new DirectEpistemicStore({ rootDir: path.join(rootDir, "epistemic") });
let lunaInvocations = 0;
let service = new DirectEpistemicService({
  store: epistemicStore,
  sessionStore,
  transcriber: async () => {
    lunaInvocations += 1;
    return { descriptions: [] };
  },
});

const nativeMidStream = deferred();
const releaseNativeTerminal = deferred();
let nativeCaptureInput;
let nativeAggregateResult;
let nativeAdapter;
const pool = new DirectNativeAgentPool({
  maxActiveChildren: 2,
  providerTurnRunner: async (input) => {
    nativeCaptureInput = input;
    nativeAdapter = createNativeChildLiveTurnCapture({
      sessionStore,
      epistemicService: service,
      captureInput: input,
      onProgress: input.onEpistemicProgress,
    });
    const events = nativeEvents("response_native_observation");
    const commit = nativeAdapter.strictCommitCallback();
    await commit(events.slice(0, 1), { normalizedOffset: 0 });
    nativeMidStream.resolve();
    await releaseNativeTerminal.promise;
    await commit(events.slice(1), { normalizedOffset: 1 });
    nativeAggregateResult = {
      responseId: "response_native_observation",
      normalizedEvents: events,
      terminal: { state: "completed", error: null },
    };
    nativeAdapter.reconcileEventPrefix(events, { sourceOffset: 0 });
    nativeAdapter.finalize(nativeAggregateResult);
    return {
      ok: true,
      terminalState: "completed",
      outputText: "Native child completed.",
      responseId: nativeAggregateResult.responseId,
      epistemicCapture: nativeAdapter.epistemicCapture(),
    };
  },
  workspaceWorkerRunner: null,
});

let changedCount = 0;
pool.on("changed", () => { changedCount += 1; });

try {
  const nativeLaunch = pool.launch({
    childAgentId: "child_live_native",
    taskName: "live_native",
    projectId: "project_live_children",
    workThreadId: "work_live_children",
    primaryThreadId: "primary_live_children",
    message: "Observe the native child without promoting its transcript.",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "none",
  });
  const passiveNativeWait = pool.wait({ target: nativeLaunch.childAgentId, timeoutMs: 60 });
  await nativeMidStream.promise;
  const nativeMid = pool.inspect({ target: nativeLaunch.childAgentId });
  assert.equal(nativeMid.state, "running");
  assert.equal(nativeMid.epistemicCapture.status, "capturing");
  assert.equal(nativeMid.epistemicCaptureProgress.liveActivityProjection.eventCursor.persistedEventCount, 1);
  assert.equal(nativeMid.epistemicCaptureProgress.liveActivityProjection.deterministicProjection.status, "current");
  assert.equal(changedCount, 1, "passive progress must not emit a pool change notification");
  const nativeProgressJson = JSON.stringify(nativeMid.epistemicCaptureProgress);
  assert.equal(nativeProgressJson.includes("NATIVE_PARTIAL_PROSE"), false);
  assert.equal(nativeProgressJson.includes("/private/native"), false);
  assert.throws(
    () => safeEpistemicProgress({
      ...nativeMid.epistemicCaptureProgress,
      prompt: "forbidden progress prose",
    }),
    (error) => error?.code === "direct_agent_capture_progress_field_unsupported",
  );
  const {
    schema: _nativeProgressSchema,
    ...nativeProgressInput
  } = nativeMid.epistemicCaptureProgress;
  assert.throws(
    () => safeEpistemicProgress({
      ...nativeProgressInput,
      liveActivityProjection: {
        ...nativeMid.epistemicCaptureProgress.liveActivityProjection,
        privateNote: "PROVIDER SECRET PROSE",
      },
    }),
    (error) => error?.code === "direct_live_activity_projection_fields_invalid",
  );
  assert.throws(
    () => safeEpistemicProgress({
      ...nativeProgressInput,
      liveActivityProjection: {
        ...nativeMid.epistemicCaptureProgress.liveActivityProjection,
        latestTypedClass: "secrets/key.txt",
      },
    }),
    (error) => error?.code === "direct_live_activity_projection_identity_invalid",
  );
  assert.throws(
    () => safeEpistemicProgress({
      ...nativeProgressInput,
      liveActivityProjection: {
        ...nativeMid.epistemicCaptureProgress.liveActivityProjection,
        state: "failed",
      },
    }),
    (error) => error?.code === "direct_live_activity_projection_digest_invalid",
  );
  assert.equal((await passiveNativeWait).status, "timeout", "capture progress must not wake pool waiters");

  const nativeSessionId = nativeMid.epistemicCapture.sessionId;
  const nativeTurnId = nativeMid.epistemicCapture.turnId;
  assert.equal(sessionStore.readNormalizedEvents(nativeSessionId, nativeTurnId).length, 1);
  assert.equal(epistemicStore.readThreadProjectionCursor(nativeSessionId).eventCount, 1);

  service.close();
  epistemicStore.close();
  epistemicStore = new DirectEpistemicStore({ rootDir: path.join(rootDir, "epistemic") });
  service = new DirectEpistemicService({
    store: epistemicStore,
    sessionStore,
    transcriber: async () => {
      lunaInvocations += 1;
      return { descriptions: [] };
    },
  });
  nativeAdapter.epistemicService = service;
  assert.equal(
    epistemicStore.readThreadProjectionCursor(nativeSessionId).eventCount,
    1,
    "service restart must catch up the durable live O prefix",
  );

  releaseNativeTerminal.resolve();
  const nativeTerminal = await pool.wait({ target: nativeLaunch.childAgentId, timeoutMs: 5_000 });
  const nativeRecord = nativeTerminal.updates[0];
  assert.equal(nativeRecord.state, "completed");
  assert.equal(nativeRecord.epistemicCaptureComplete, true);
  assert.equal(nativeRecord.epistemicCaptureProgress.liveActivityProjection.terminal, true);
  assert.equal(sessionStore.readNormalizedEvents(nativeSessionId, nativeTurnId).length, 3);
  assert.equal(sessionStore.readSession(nativeSessionId).messages.length, 0);
  nativeCaptureInput.onEpistemicProgress({
    status: "failed",
    receiptDigest: "",
    sessionId: nativeSessionId,
    turnId: nativeTurnId,
  });
  const immutableNativeTerminal = pool.inspect({ target: nativeLaunch.childAgentId });
  assert.equal(immutableNativeTerminal.epistemicCapture.status, "captured");
  assert.equal(immutableNativeTerminal.epistemicCaptureComplete, true);

  const replayAdapter = createNativeChildLiveTurnCapture({
    sessionStore,
    epistemicService: service,
    captureInput: nativeCaptureInput,
  });
  replayAdapter.reconcileEventPrefix(nativeAggregateResult.normalizedEvents, { sourceOffset: 0 });
  const replayReceipt = replayAdapter.finalize(nativeAggregateResult);
  assert.equal(replayReceipt.duplicate, true);
  assert.equal(sessionStore.readNormalizedEvents(nativeSessionId, nativeTurnId).length, 3);

  const workspaceMidStream = deferred();
  const releaseWorkspaceStep = deferred();
  const workspaceToolDurable = deferred();
  const releaseWorkspaceTerminal = deferred();
  let workspaceRuntimeResult;
  let workspaceAdapter;
  const workspacePool = new DirectNativeAgentPool({
    maxActiveChildren: 2,
    providerTurnRunner: async () => ({ terminalState: "completed", outputText: "unused" }),
    workspaceWorkerRunner: async (input) => {
      workspaceRuntimeResult = await runDirectWorkspaceWorker({
        ...input,
        workspaceProvisioner: async () => ({
          binding: {
            bindingId: "binding_live_workspace",
            bindingDigest: "sha256:binding_live_workspace",
            projectId: input.projectId,
            workerKey: "child-live-workspace",
            workspaceKind: "local_git_worktree",
            branch: "codex/worker/child-live-workspace",
            baseCommit: "0123456789abcdef",
            rootEvidenceDigest: "sha256:root_live_workspace",
            retainedAfterCompletion: true,
          },
          testProfile: null,
          nativeRoot: "/private/live-workspace",
          workspaceRequest: async (method) => {
            assert.equal(method, "readFile");
            return { relPath: "fixture.txt", text: "bounded fixture evidence", size: 24 };
          },
          release: async () => {},
        }),
        captureAdapterFactory: ({ contract }) => {
          workspaceAdapter = createNativeChildLiveTurnCapture({
            sessionStore,
            epistemicService: service,
            captureInput: {
              ...input,
              agent: {
                agentThreadId: input.childAgentId,
                displayLabel: input.displayLabel,
                role: input.role,
                model: input.model,
                reasoningEffort: input.reasoningEffort,
              },
              attemptId: `workspace_worker_${contract.contractId}`,
              promptDigest: "sha256:workspace_prompt",
              contextDigest: contract.contextAdmission.admittedContextDigest,
              contextMessageCount: contract.contextAdmission.admittedMessageCount,
              requestBody: { model: input.model, reasoning: { effort: input.reasoningEffort } },
              workspaceWorkerContract: contract,
            },
            onProgress: input.onEpistemicProgress,
          });
          return workspaceAdapter;
        },
        providerRequestRunner: async ({ stepOrdinal, onNormalizedEventsCommitted }) => {
          if (stepOrdinal === 1) {
            const events = toolEvents("response_workspace_tool");
            await onNormalizedEventsCommitted(events.slice(0, 1), { normalizedOffset: 0 });
            workspaceMidStream.resolve();
            await releaseWorkspaceStep.promise;
            await onNormalizedEventsCommitted(events.slice(1), { normalizedOffset: 1 });
            return {
              responseId: "response_workspace_tool",
              normalizedEvents: events,
              terminal: { state: "tool_waiting", error: null },
            };
          }
          workspaceToolDurable.resolve();
          await releaseWorkspaceTerminal.promise;
          const events = completedEvents("response_workspace_terminal");
          await onNormalizedEventsCommitted(events, { normalizedOffset: 0 });
          return {
            responseId: "response_workspace_terminal",
            normalizedEvents: events,
            terminal: { state: "completed", error: null },
          };
        },
      });
      return {
        ...workspaceRuntimeResult,
        resultEnvelope: {
          confidence: workspaceRuntimeResult.epistemicCapture?.status === "captured" ? "exact" : "partial",
        },
        reducedSummary: { summaryText: workspaceRuntimeResult.outputText },
        captureResult: undefined,
      };
    },
  });
  let workspaceChangedCount = 0;
  workspacePool.on("changed", () => { workspaceChangedCount += 1; });
  const workspaceLaunch = workspacePool.launch({
    childAgentId: "child_live_workspace",
    taskName: "live_workspace",
    projectId: "project_live_children",
    workThreadId: "work_live_children",
    primaryThreadId: "primary_live_children",
    message: "Read the bounded fixture and report completion.",
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    project: { id: "project_live_children" },
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "none",
  });
  const passiveWorkspaceWait = workspacePool.wait({ target: workspaceLaunch.childAgentId, timeoutMs: 60 });
  await workspaceMidStream.promise;
  const workspaceMid = workspacePool.inspect({ target: workspaceLaunch.childAgentId });
  assert.equal(workspaceMid.epistemicCaptureProgress.liveActivityProjection.eventCursor.persistedEventCount, 1);
  assert.equal(workspaceChangedCount, 1, "workspace stream progress must remain passive");
  assert.equal((await passiveWorkspaceWait).status, "timeout");

  releaseWorkspaceStep.resolve();
  await workspaceToolDurable.promise;
  const workspaceToolPhase = workspacePool.inspect({ target: workspaceLaunch.childAgentId });
  const workspaceProjection = workspaceToolPhase.epistemicCaptureProgress.liveActivityProjection;
  assert.equal(workspaceProjection.eventCursor.persistedEventCount, 4);
  assert.equal(workspaceProjection.capture.toolResultCount, 1);
  assert.equal(workspaceProjection.typedRecordCounts.ToolResult, 1);
  assert.equal(workspaceProjection.terminal, false);
  assert.equal(workspaceChangedCount, 1, "tool-result progress must not notify or wake the parent");
  assert.equal(JSON.stringify(workspaceToolPhase.epistemicCaptureProgress).includes("fixture.txt"), false);
  assert.equal(JSON.stringify(workspaceToolPhase).includes("/private/live-workspace"), false);

  releaseWorkspaceTerminal.resolve();
  const workspaceTerminal = await workspacePool.wait({ target: workspaceLaunch.childAgentId, timeoutMs: 5_000 });
  const workspaceRecord = workspaceTerminal.updates[0];
  assert.equal(workspaceRecord.state, "completed");
  assert.equal(workspaceRecord.epistemicCaptureComplete, true);
  assert.equal(workspaceRuntimeResult.childTranscriptPromotionStarted, false);
  assert.equal(workspaceRuntimeResult.bottomUpMessagingStarted, false);
  assert.equal(workspaceRuntimeResult.captureResult.workspaceWorkerToolResults.length, 1);
  assert.equal(workspaceRuntimeResult.epistemicCapture.status, "captured");
  const workspaceSessionId = workspaceRecord.epistemicCapture.sessionId;
  const workspaceTurnId = workspaceRecord.epistemicCapture.turnId;
  const persistedWorkspaceEvents = sessionStore.readNormalizedEvents(workspaceSessionId, workspaceTurnId);
  assert.deepEqual(persistedWorkspaceEvents.map((event) => event.sequence), [0, 1, 2, 3, 4, 5, 6]);
  const workspaceTurn = sessionStore.readTurn(workspaceSessionId, workspaceTurnId);
  assert.equal(workspaceTurn.toolResults.length, 1);
  assert.equal(workspaceTurn.requestShape.workspaceWorkerToolResultCount, 1);
  assert.equal(sessionStore.readSession(workspaceSessionId).messages.length, 0);
  assert.equal(lunaInvocations, 0);

  const statusJson = JSON.stringify(workspacePool.statusSurface({
    projectId: "project_live_children",
    primaryThreadId: "primary_live_children",
  }).listAgents());
  assert.equal(statusJson.includes("bounded fixture evidence"), false);
  assert.equal(statusJson.includes("/private/live-workspace"), false);

  const cancellationStarted = deferred();
  let cancellationProgressCallback;
  const cancellationPool = new DirectNativeAgentPool({
    providerTurnRunner: async (input) => {
      cancellationProgressCallback = input.onEpistemicProgress;
      const adapter = createNativeChildLiveTurnCapture({
        sessionStore,
        epistemicService: service,
        captureInput: input,
        onProgress: input.onEpistemicProgress,
      });
      input.registerEpistemicCaptureController({
        sessionId: adapter.writer.input.sessionId,
        turnId: adapter.writer.input.turnId,
        cancel: () => adapter.cancel(),
      });
      const events = [
        { type: "session_started", sequence: 0, responseId: "response_cancelled" },
        { type: "aborted", sequence: 1, responseId: "response_cancelled" },
      ];
      await adapter.strictCommitCallback()(events.slice(0, 1), { normalizedOffset: 0 });
      cancellationStarted.resolve();
      if (!input.signal.aborted) {
        await new Promise((resolve) => input.signal.addEventListener("abort", resolve, { once: true }));
      }
      return {
        terminalState: "cancelled",
        errorCode: "provider_child_turn_aborted",
        epistemicCapture: adapter.epistemicCapture(),
      };
    },
  });
  const cancellationLaunch = cancellationPool.launch({
    childAgentId: "child_live_cancelled",
    taskName: "live_cancelled",
    projectId: "project_live_children",
    primaryThreadId: "primary_live_children",
    message: "Exercise cancellation capture.",
    forkTurns: "none",
  });
  await cancellationStarted.promise;
  cancellationPool.close({ reasonCode: "fixture_cancel" });
  const cancelledRecord = cancellationPool.inspect({ target: cancellationLaunch.childAgentId });
  assert.equal(cancelledRecord.state, "cancelled");
  assert.equal(cancelledRecord.epistemicCapture.status, "failed");
  assert.equal(cancelledRecord.epistemicCaptureComplete, false);
  assert.equal(cancelledRecord.epistemicCaptureProgress.liveActivityProjection.state, "streaming");
  const cancelledTurn = sessionStore.readTurn(
    cancelledRecord.epistemicCapture.sessionId,
    cancelledRecord.epistemicCapture.turnId,
  );
  assert.equal(cancelledTurn.capture.complete, false);
  assert.equal(cancelledTurn.capture.status, "failed");
  assert.equal(cancelledTurn.normalizedEventCount, 1);
  assert(cancelledTurn.capture.gapReceipts.some((receipt) =>
    receipt.code === "direct_turn_capture_cancelled"));
  cancellationProgressCallback({
    status: "captured",
    receiptDigest: `sha256:${"a".repeat(64)}`,
    sessionId: cancelledRecord.epistemicCapture.sessionId,
    turnId: cancelledRecord.epistemicCapture.turnId,
  });
  const immutableCancelledCapture = cancellationPool.inspect({ target: cancellationLaunch.childAgentId });
  assert.equal(immutableCancelledCapture.epistemicCapture.status, "failed");
  assert.equal(immutableCancelledCapture.epistemicCaptureComplete, false);

  const failedInput = {
    projectId: "project_live_children",
    primaryThreadId: "primary_live_children",
    workThreadId: "work_live_children",
    childAgentId: "child_live_capture_failure",
    displayLabel: "Capture failure fixture",
    role: "sub_agent_worker",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    requestBody: { model: "gpt-5.6-sol", reasoning: { effort: "xhigh" } },
    attemptId: "attempt_capture_failure",
    promptDigest: "sha256:prompt_capture_failure",
    contextDigest: "sha256:context_capture_failure",
  };
  const failedAdapter = createNativeChildLiveTurnCapture({
    sessionStore,
    epistemicService: service,
    captureInput: failedInput,
  });
  await assert.rejects(
    () => failedAdapter.strictCommitCallback()([{
      type: "response_completed",
      sequence: 1,
      responseId: "response_capture_failure",
    }], { normalizedOffset: 1 }),
    (error) => error?.code === "direct_turn_capture_prefix_gap",
  );
  assert.throws(
    () => failedAdapter.reconcileEventPrefix([{
      type: "response_completed",
      sequence: 0,
      responseId: "response_capture_failure",
    }], { sourceOffset: 0 }),
    (error) => error?.code === "direct_turn_capture_prefix_gap",
    "terminal evidence must not recapture a poisoned live adapter",
  );
  const failedTurn = sessionStore.readTurn(
    failedAdapter.writer.input.sessionId,
    failedAdapter.writer.input.turnId,
  );
  assert.equal(failedTurn.capture.status, "failed");
  assert.equal(failedTurn.capture.complete, false);
  assert.equal(failedTurn.normalizedEventCount, 0);
  assert(failedTurn.capture.gapReceipts.some((receipt) => receipt.code === "direct_turn_capture_prefix_gap"));
  assert.equal(lunaInvocations, 0);

  console.log(JSON.stringify({
    ok: true,
    nativeMidStreamODurable: true,
    workspaceMidToolODurable: true,
    deterministicEProjectedBeforeTerminal: true,
    restartCatchUp: true,
    cancellationGapDurableBeforeSettlement: true,
    captureFailureStayedPartial: true,
    terminalReplayIdempotent: true,
    globalWorkspaceOffsets: persistedWorkspaceEvents.length,
    passivePoolProgress: true,
    exactProgressSchema: true,
    terminalCaptureProgressImmutable: true,
    parentWakeupsFromProgress: 0,
    childTranscriptPromotions: 0,
    bottomUpMessages: 0,
    lunaInvocations,
  }, null, 2));
} finally {
  service.close();
  epistemicStore.close();
  fs.rmSync(rootDir, { recursive: true, force: true });
}
