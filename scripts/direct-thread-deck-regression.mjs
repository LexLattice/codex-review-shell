#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  DIRECT_THREAD_DECK_PROJECTION_SCHEMA,
} = require("../src/main/direct/thread/thread-deck");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-thread-deck-"));

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

async function waitFor(condition, label) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(label);
}

const profileDoc = {
  profile: {
    ontology: {
      models: [{ id: "gpt-5.4", status: "accepted" }, { id: "gpt-5.5", status: "accepted" }],
    },
  },
};
const project = {
  id: "project-thread-deck",
  name: "Thread deck fixture",
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
    },
  },
};
const authStore = {
  readStatus: () => ({
    status: "authenticated",
    accountId: "acct_thread_deck_fixture",
    hasAccessToken: true,
    rawTokensExposed: false,
  }),
  readCredentials: () => ({ accessToken: "thread_deck_fixture_secret" }),
};

try {
  const sessionStore = new DirectSessionStore({ rootDir: tempRoot });
  sessionStore.ensure();
  const workThreadStore = new DirectWorkThreadRegistryStore({ rootDir: tempRoot });
  workThreadStore.upsertWorkThread({
    workThreadId: "work_thread_pr15",
    projectId: project.id,
    title: "WorkThread scoped direct work",
    lifecycleState: "active",
    objective: "Keep direct-native sessions scoped to work-world identity.",
    activeRuntimePath: "direct-implementation",
    linkedCodexThreads: [{ threadId: "pending_runtime", source: "direct", title: "Pending runtime" }],
  });
  workThreadStore.upsertWorkThread({
    workThreadId: "work_thread_stale_deck",
    projectId: project.id,
    title: "Stale WorkThread fixture",
    lifecycleState: "stale",
    objective: "Should render stale without selecting or mutating.",
    activeRuntimePath: "direct-implementation",
  });
  workThreadStore.upsertWorkThread({
    workThreadId: "work_thread_archived_deck",
    projectId: project.id,
    title: "Archived WorkThread fixture",
    lifecycleState: "archived",
    objective: "Should render archived only when included.",
    activeRuntimePath: "direct-implementation",
  });
  const controller = new DirectLiveTextController({
    sessionStore,
    profileDoc,
    authStore,
    fetchImpl: async () => textResponse([
      "event: response.output_text.delta",
      "data: {\"delta\":\"direct deck ok\"}",
      "",
      "event: response.completed",
      "data: {\"response\":{\"id\":\"resp_direct_thread_deck\",\"status\":\"completed\"}}",
      "",
    ].join("\n"), 200, { "content-type": "text/event-stream" }),
  });
  const { DirectThreadWorkbenchController } = require("../src/main/direct/thread/thread-workbench-controller");
  const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
  const threadStore = new DirectThreadStore({ rootDir: tempRoot, mode: "index_only" });
  const workbenchController = new DirectThreadWorkbenchController({
    threadStore,
    sessionStore,
    workThreadStore,
    projectResolver: () => project,
    liveTextController: controller,
    now: () => Date.parse("2026-06-13T14:00:00.000Z"),
  });

  const scoped = sessionStore.createSession({
    projectId: project.id,
    title: "WorkThread scoped direct session",
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    workThreadId: "work_thread_pr15",
    workThreadBindingDigest: "sha256:work_thread_pr15_binding",
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });
  sessionStore.createTurn(scoped.sessionId, {
    turnId: "direct_turn_completed",
    state: "completed",
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    createdAt: "2026-06-13T10:01:00.000Z",
    updatedAt: "2026-06-13T10:02:00.000Z",
  });

  const interrupted = sessionStore.createSession({
    projectId: project.id,
    title: "Interrupted direct session",
    model: "gpt-5.4",
    createdAt: "2026-06-13T12:00:00.000Z",
    updatedAt: "2026-06-13T12:00:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });
  sessionStore.createTurn(interrupted.sessionId, {
    turnId: "direct_turn_interrupted",
    state: "request_built",
    model: "gpt-5.4",
    createdAt: "2026-06-13T12:01:00.000Z",
    updatedAt: "2026-06-13T12:02:00.000Z",
  });
  sessionStore.recoverInterruptedTurns({ nowMs: Date.parse("2026-06-13T12:03:00.000Z") });

  const running = sessionStore.createSession({
    projectId: project.id,
    title: "Running direct session",
    model: "gpt-5.5",
    reasoningEffort: "high",
    createdAt: "2026-06-13T11:00:00.000Z",
    updatedAt: "2026-06-13T11:00:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });
  sessionStore.createTurn(running.sessionId, {
    turnId: "direct_turn_running",
    state: "streaming",
    model: "gpt-5.5",
    reasoningEffort: "high",
    createdAt: "2026-06-13T11:01:00.000Z",
    updatedAt: "2026-06-13T11:02:00.000Z",
  });

  sessionStore.createSession({
    projectId: "other-project",
    title: "Other project direct session",
    model: "gpt-5.3",
    createdAt: "2026-06-13T13:00:00.000Z",
    updatedAt: "2026-06-13T13:00:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });

  const snapshot = await workbenchController.getSnapshot(project, {
    refresh: true,
    filters: { includeArchived: true },
    page: { threads: { offset: 0, limit: 20 }, operations: { offset: 0, limit: 10 } },
  });
  assert.equal(snapshot.workThreadOperatorDeck.schema, "direct_work_thread_operator_deck@1");
  assert.equal(snapshot.workThreadOperatorDeck.identityLaw.controlPlaneIdentity, "workThreadId");
  assert.equal(snapshot.workThreadOperatorDeck.identityLaw.providerThreadIdRole, "secondary_runtime_identity");
  assert.equal(snapshot.workThreadOperatorDeck.providerCallAuthorityGranted, false);
  assert.equal(snapshot.workThreadOperatorDeck.workspaceMutationAuthorityGranted, false);
  assert(snapshot.workThreadOperatorDeck.counts.active >= 1, "operator deck should expose active WorkThreads");
  assert(snapshot.workThreadOperatorDeck.counts.candidate >= 1, "operator deck should expose unscoped sessions as candidates");
  assert(snapshot.workThreadOperatorDeck.counts.stale >= 1, "operator deck should expose stale WorkThreads");
  assert(snapshot.workThreadOperatorDeck.counts.archived >= 1, "operator deck should expose archived WorkThreads when requested");
  const operatorScopedRow = snapshot.workThreadOperatorDeck.rows.find((row) => row.workThreadId === "work_thread_pr15");
  assert(operatorScopedRow, "operator WorkThread row should be present");
  assert.equal(operatorScopedRow.runtimeProviderThreadIdsAreSecondary, true);
  assert(operatorScopedRow.runtimeThreadIds.includes(scoped.sessionId), "operator row should cite runtime session as secondary identity");
  const candidateRows = snapshot.workThreadOperatorDeck.rows.filter((row) => row.operatorState === "candidate");
  assert(candidateRows.some((row) => row.primaryRuntimeThreadId), "candidate rows should keep runtime session openable without selection authority");

  const blockedDraft = await workbenchController.createWorkThreadDraftSession(project, {
    title: "",
    objectiveSummary: "",
    contextPosture: "unknown",
  });
  assert.equal(blockedDraft.status, "blocked");
  assert.equal(blockedDraft.providerTurnStarted, false);
  assert.equal(blockedDraft.appServerMutated, false);
  assert(blockedDraft.draft.blockerCodes.includes("work_thread_title_missing"));
  assert(blockedDraft.draft.blockerCodes.includes("context_posture_not_explicit"));

  const acceptedDraft = await workbenchController.createWorkThreadDraftSession(project, {
    title: "Drafted local WorkThread thread",
    objectiveSummary: "Create local evidence before provider work starts.",
    contextPosture: "explicit_operator_draft",
    workThreadId: "work_thread_drafted_local",
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
  assert.equal(acceptedDraft.status, "created");
  assert.equal(acceptedDraft.providerTurnStarted, false);
  assert.equal(acceptedDraft.appServerMutated, false);
  assert.equal(acceptedDraft.providerCallAuthorityGranted, false);
  assert.equal(acceptedDraft.thread.workThreadId, "work_thread_drafted_local");
  const acceptedSession = sessionStore.readSession(acceptedDraft.thread.threadId);
  assert.equal(acceptedSession.turns.length, 0, "local draft must not start a provider turn");
  assert.equal(acceptedSession.workThreadId, "work_thread_drafted_local");
  const acceptedWorkThread = workThreadStore.readWorkThread("work_thread_drafted_local");
  assert.equal(acceptedWorkThread.lifecycleState, "candidate");
  assert.equal(acceptedSession.workThreadBindingDigest, acceptedWorkThread.digest, "session binding digest should match final linked WorkThread digest");

  workThreadStore.upsertWorkThread({
    workThreadId: "work_thread_existing_active",
    projectId: project.id,
    title: "Existing active WorkThread",
    lifecycleState: "active",
    objective: "Existing metadata must not be overwritten by a draft collision.",
    activeRuntimePath: "direct-implementation",
  });
  const reusedDraft = await workbenchController.createWorkThreadDraftSession(project, {
    title: "Attempted overwrite title",
    objectiveSummary: "Attempted overwrite objective.",
    contextPosture: "explicit_operator_draft",
    workThreadId: "work_thread_existing_active",
    model: "gpt-5.5",
  });
  assert.equal(reusedDraft.status, "created");
  const reusedWorkThread = workThreadStore.readWorkThread("work_thread_existing_active");
  assert.equal(reusedWorkThread.lifecycleState, "active", "draft reuse must preserve existing WorkThread lifecycle");
  assert.equal(reusedWorkThread.title, "Existing active WorkThread", "draft reuse must preserve existing WorkThread title");
  assert.equal(sessionStore.readSession(reusedDraft.thread.threadId).workThreadBindingDigest, reusedWorkThread.digest);

  const corruptSession = sessionStore.createSession({
    projectId: project.id,
    title: "Corrupt stored session",
    model: "gpt-5.4",
    createdAt: "2026-06-13T12:10:00.000Z",
    updatedAt: "2026-06-13T12:10:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });
  await workbenchController.getSnapshot(project, {
    refresh: true,
    filters: { includeArchived: true },
    page: { threads: { offset: 0, limit: 20 }, operations: { offset: 0, limit: 10 } },
  });
  fs.writeFileSync(sessionStore.sessionPath(corruptSession.sessionId), "{not valid json", "utf8");

  const corruptTurnSession = sessionStore.createSession({
    projectId: project.id,
    title: "Corrupt stored turn",
    model: "gpt-5.4",
    createdAt: "2026-06-13T12:20:00.000Z",
    updatedAt: "2026-06-13T12:20:00.000Z",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
  });
  sessionStore.createTurn(corruptTurnSession.sessionId, {
    turnId: "direct_turn_corrupt_file",
    state: "completed",
    model: "gpt-5.4",
    createdAt: "2026-06-13T12:21:00.000Z",
    updatedAt: "2026-06-13T12:22:00.000Z",
  });
  fs.writeFileSync(sessionStore.turnPath(corruptTurnSession.sessionId, "direct_turn_corrupt_file"), "{not valid json", "utf8");

  const degradedSnapshot = await workbenchController.getSnapshot(project, {
    refresh: false,
    filters: { includeArchived: true },
    page: { threads: { offset: 0, limit: 20 }, operations: { offset: 0, limit: 10 } },
  });
  const degradedRow = degradedSnapshot.threads.find((thread) => thread.threadId === corruptSession.sessionId);
  assert(degradedRow, "previously indexed corrupt session row should remain visible");
  assert.equal(degradedRow.storageState, "session_unreadable");
  const refreshedAfterCorruption = await workbenchController.getSnapshot(project, {
    refresh: true,
    filters: { includeArchived: true },
    page: { threads: { offset: 0, limit: 20 }, operations: { offset: 0, limit: 10 } },
  });
  assert.equal(refreshedAfterCorruption.schema, "renderer_safe_direct_thread_workbench_snapshot@1", "refresh snapshot should degrade corrupt sessions instead of throwing");

  const result = controller.listThreads({
    limit: 10,
    defaultModel: "gpt-5.5",
    defaultReasoningEffort: "high",
  }, { project });

  assert.equal(result.schema, "direct_thread_list@1");
  assert.equal(result.deck.schema, DIRECT_THREAD_DECK_PROJECTION_SCHEMA);
  assert.equal(result.deck.projectId, project.id);
  assert.equal(result.deck.groupingLaw.primaryGrouping, "work_thread");
  assert.equal(result.deck.groupingLaw.providerThreadIdRole, "secondary_runtime_identity");
  assert.equal(result.deck.defaults.model, "gpt-5.5");
  assert.equal(result.deck.defaults.reasoningEffort, "high");
  assert.equal(result.deck.actions.start.enabled, true);
  assert.equal(result.deck.actions.start.mutationAuthorityGranted, false);
  assert.equal(result.deck.rawPathExposed, false);
  assert.equal(result.deck.rawPromptTextExposed, false);
  assert.equal(result.deck.rows.length, 7);

  const scopedRow = result.deck.rows.find((row) => row.threadId === scoped.sessionId);
  assert(scopedRow, "WorkThread scoped row should be present");
  assert.equal(scopedRow.workThreadId, "work_thread_pr15");
  assert.equal(scopedRow.workThreadGroupingKey, "work_thread:work_thread_pr15");
  assert.equal(scopedRow.model, "gpt-5.4");
  assert.equal(scopedRow.reasoningEffort, "xhigh");
  assert.equal(scopedRow.actions.focus.enabled, true);
  assert.equal(scopedRow.actions.resume.enabled, true);

  const runningRow = result.deck.rows.find((row) => row.threadId === running.sessionId);
  assert.equal(runningRow.displayState, "running");
  assert.equal(runningRow.actions.resume.enabled, false);
  assert.equal(runningRow.actions.resume.disabledReason, "thread_already_running");

  const interruptedRow = result.deck.rows.find((row) => row.threadId === interrupted.sessionId);
  assert.equal(interruptedRow.displayState, "recoverable_interrupted");
  assert.equal(interruptedRow.recoverableInterruptedTurnCount, 1);
  assert.equal(interruptedRow.actions.focus.enabled, true);
  assert.equal(interruptedRow.actions.resume.enabled, false);

  const corruptSessionRow = result.deck.rows.find((row) => row.threadId === corruptSession.sessionId);
  assert(corruptSessionRow, "Corrupt session index row should degrade without failing the deck");
  assert.equal(corruptSessionRow.storageState, "session_unreadable");
  assert.equal(corruptSessionRow.actions.focus.enabled, false);
  assert.equal(corruptSessionRow.actions.focus.disabledReason, "session_unreadable");

  const corruptTurnRow = result.deck.rows.find((row) => row.threadId === corruptTurnSession.sessionId);
  assert(corruptTurnRow, "Corrupt turn row should degrade without failing the deck");
  assert.equal(corruptTurnRow.displayState, "completed");

  const started = controller.startThread({
    model: "gpt-5.5",
    reasoningEffort: "medium",
    title: "Operator started direct session",
    workThreadId: "work_thread_started",
  }, { project });
  const startedSession = sessionStore.readSession(started.thread.id);
  assert.equal(startedSession.model, "gpt-5.5");
  assert.equal(startedSession.reasoningEffort, "medium");
  assert.equal(startedSession.workThreadId, "work_thread_started");
  assert.equal(started.thread.reasoningEffort, "medium");
  assert.equal(started.thread.workThreadId, "work_thread_started");

  const ack = await controller.startTurn({
    threadId: started.thread.id,
    promptText: "persist current effort for this direct turn",
    clientTurnRequestId: "client_req_direct_thread_deck_effort",
    model: "gpt-5.5",
    effort: "high",
  }, { project, surfaceSession: { sendEvent: () => {} } });
  const turn = sessionStore.readTurn(started.thread.id, ack.turn.id);
  assert.equal(turn.reasoningEffort, "high");
  await waitFor(
    () => sessionStore.readTurn(started.thread.id, ack.turn.id)?.state === "completed",
    "direct thread deck effort turn should complete",
  );

  console.log("direct thread deck regression passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
