#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  openNativeChildProviderTurnCapture,
  nativeChildTurnId,
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
    captureGapDurable: true,
    restartCatchUp: true,
    safePassiveProjection: true,
    lunaAutomaticInvocation: false,
  }));
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
