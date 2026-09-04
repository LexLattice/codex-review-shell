#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  DirectThreadHarnessGrantStore,
  capabilityNames,
} = require("../src/main/direct/authority/direct-thread-harness-grant");
const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
} = require("../src/main/direct/controller/live-text-controller");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-thread-turn-parity-"));
const projectId = "project_thread_turn_parity";
const project = {
  id: projectId,
  name: "Direct thread-turn parity fixture",
  workspace: { kind: "local", localPath: root },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
      model: "gpt-5.4",
    },
  },
};

const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads") });
const grantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
sessionStore.ensure();

const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore: threadStore,
  harnessGrantStore: grantStore,
});
const status = {
  status: "ready",
  model: "gpt-5.4",
  evidenceId: "parity-runtime-evidence",
  readOnlyToolContinuation: { status: "ready" },
  patchApplyContinuation: { status: "ready" },
  commandExecutionContinuation: { status: "ready" },
};
controller.statusForProject = () => status;
controller.assertReady = () => status;

function context(forProject = project) {
  return { project: forProject, ownerControlled: true };
}

function appendCompletedTurn(sessionId, turnId, text) {
  const turn = sessionStore.createTurn(sessionId, {
    turnId,
    input: [{ role: "user", text }],
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
    clientTurnRequestId: `${turnId}-request`,
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1" },
  });
  sessionStore.appendNormalizedEvents(sessionId, turnId, [
    { type: "message_delta", text: `response for ${turnId}` },
    { type: "response_completed", responseId: `${turnId}-response` },
  ]);
  const completed = sessionStore.updateTurnState(sessionId, turnId, "completed", {
    responseId: `${turnId}-response`,
  });
  controller.appendSessionTurn(sessionId, turnId, [
    { id: `${turnId}-user`, type: "userMessage", turnId, content: [{ type: "text", text }] },
    { id: `${turnId}-assistant`, type: "agentMessage", turnId, text: `response for ${turnId}` },
  ], completed.model, "completed");
  controller.indexDirectThreadStoreSession(sessionId);
  return completed;
}

try {
  const started = await controller.handleRequest("thread/start", {
    title: "Parity source",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
  }, context());
  const sourceId = started.thread.id;
  const selected = await controller.handleRequest("thread/selectAccessProfile", {
    sessionId: sourceId,
    accessProfile: "full_access",
  }, context());
  assert.equal(selected.capabilities.threads.canResume, true);
  assert.equal(selected.capabilities.threads.canFork, true);
  assert.equal(selected.capabilities.threads.canRollback, true);
  assert.equal(selected.capabilities.turns.canSteer, true);
  assert.deepEqual(selected.capabilities.serviceTier.availableTiers, ["fast", "flex"]);
  assert.equal(selected.capabilities.authority.fullAccessTaskProfile, true);

  appendCompletedTurn(sourceId, "parity_turn_1", "first source message");
  appendCompletedTurn(sourceId, "parity_turn_2", "second source message");
  const sourceRead = await controller.handleRequest("thread/read", { threadId: sourceId }, context());
  assert.equal(sourceRead.thread.turns.length, 2);

  const forked = await controller.handleRequest("thread/fork", {
    threadId: sourceId,
    clientForkId: "parity-fork-1",
  }, context());
  const childId = forked.thread.id;
  assert.equal(forked.forked, true);
  assert.equal(forked.thread.parentThreadId, sourceId);
  assert.equal(forked.thread.turns.length, sourceRead.thread.turns.length);
  assert.equal(forked.authorityInheritance.mode, "bounded_parent_inheritance");
  assert.equal(forked.authorityInheritance.parentGrantId, selected.grantId);
  assert.ok(forked.authorityInheritance.capabilities.includes("exec_command"));
  assert.equal(forked.capabilities.authority.fullAccessTaskProfile, true);
  const forkRetry = await controller.handleRequest("thread/fork", {
    threadId: sourceId,
    clientForkId: "parity-fork-1",
  }, context());
  assert.equal(forkRetry.reused, true);
  assert.equal(forkRetry.thread.id, childId);
  const childGrant = grantStore.currentForScope({ taskId: childId, threadId: childId, projectId });
  assert.equal(childGrant.parentGrantId, selected.grantId);
  assert.deepEqual(capabilityNames(childGrant), capabilityNames(grantStore.read(selected.grantId)));

  await assert.rejects(
    controller.handleRequest("thread/fork", { threadId: sourceId, expectedHistoryHeadDigest: "stale" }, context()),
    /stale source history head/,
  );
  await assert.rejects(
    controller.handleRequest("thread/read", { threadId: sourceId }, context({ ...project, id: "foreign-project" })),
    /active project/,
  );

  const rolledBack = await controller.handleRequest("thread/rollback", {
    threadId: sourceId,
    numTurns: 1,
    clientRollbackId: "parity-rollback-1",
    expectedHistoryHeadDigest: sourceRead.thread.historyHeadDigest,
  }, context());
  assert.equal(rolledBack.rollback.removedTurnIds.length, 1);
  assert.equal(rolledBack.thread.turns.length, 1);
  assert.equal(rolledBack.thread.historyHeadTurnId, "parity_turn_1");
  const rollbackRetry = await controller.handleRequest("thread/rollback", {
    threadId: sourceId,
    numTurns: 1,
    clientRollbackId: "parity-rollback-1",
  }, context());
  assert.equal(rollbackRetry.reused, true);
  assert.equal(rollbackRetry.thread.turns.length, 1);
  await assert.rejects(
    controller.handleRequest("thread/rollback", {
      threadId: sourceId,
      numTurns: 1,
      clientRollbackId: "parity-rollback-stale",
      expectedHistoryHeadDigest: sourceRead.thread.historyHeadDigest,
    }, context()),
    /stale history head/,
  );
  const resumed = await controller.handleRequest("thread/resume", {
    threadId: sourceId,
    expectedHistoryHeadDigest: rolledBack.rollback.afterHistoryHeadDigest,
  }, context());
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.thread.turns.length, 1);
  assert.equal(resumed.thread.historyHeadTurnId, "parity_turn_1");

  const steerSession = sessionStore.createSession({
    sessionId: "parity_steer_thread",
    projectId,
    workspace: project.workspace,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    nativeDirectSession: true,
  });
  sessionStore.createTurn(steerSession.sessionId, {
    turnId: "parity_active_turn",
    input: [{ role: "user", text: "initial" }],
    state: "request_built",
    model: "gpt-5.4",
    clientTurnRequestId: "parity-active-request",
  });
  controller.indexDirectThreadStoreSession(steerSession.sessionId);
  const steered = await controller.handleRequest("turn/steer", {
    threadId: steerSession.sessionId,
    expectedTurnId: "parity_active_turn",
    clientSteerRequestId: "parity-steer-1",
    input: [{ type: "text", text: "change direction" }],
  }, context());
  assert.equal(steered.status, "accepted");
  assert.equal(steered.controlState, "queued_for_active_turn");
  assert.equal(sessionStore.readTurn(steerSession.sessionId, "parity_active_turn").steeringRequests.length, 1);
  await assert.rejects(
    controller.handleRequest("turn/steer", {
      threadId: steerSession.sessionId,
      expectedTurnId: "other-turn",
      input: [{ type: "text", text: "wrong turn" }],
    }, context()),
    /turn not found/,
  );
  const interrupted = controller.interruptTurn({ sessionId: steerSession.sessionId, turnId: "parity_active_turn" });
  assert.equal(interrupted.status, "aborted");

  const overrideSession = sessionStore.createSession({
    sessionId: "parity_owner_turn_thread",
    projectId,
    workspace: project.workspace,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    nativeDirectSession: true,
  });
  const originalRunTurn = controller.runTurn;
  controller.runTurn = async () => ({ ok: true, normalizedEvents: [], terminal: { state: "completed" } });
  const ownerTurn = await controller.handleRequest("turn/start", {
    threadId: overrideSession.sessionId,
    clientTurnRequestId: "parity-owner-turn-1",
    promptText: "owner selected turn",
    model: "gpt-5.6-sol",
    effort: "high",
    serviceTier: "flex",
  }, context());
  controller.runTurn = originalRunTurn;
  const durableOwnerTurn = sessionStore.readTurn(overrideSession.sessionId, ownerTurn.turn.id);
  assert.equal(durableOwnerTurn.model, "gpt-5.6-sol");
  assert.equal(durableOwnerTurn.reasoningEffort, "high");
  assert.equal(durableOwnerTurn.serviceTier, "flex");
  assert.equal(durableOwnerTurn.requestShape.directTurnOwnerControlled, true);
  assert.equal(durableOwnerTurn.requestShape.serviceTier, "flex");

  const imported = sessionStore.createSession({
    sessionId: "parity_imported_thread",
    projectId,
    workspace: project.workspace,
    model: "gpt-5.4",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    sourceClass: "direct-import-checkpoint-continuation",
    importedSessionReadOnly: true,
    continuityState: "checkpoint-validated",
  });
  const importedRead = await controller.handleRequest("thread/resume", { threadId: imported.sessionId }, context());
  assert.equal(importedRead.readOnly, true);
  assert.equal(importedRead.capabilities.authority.fullAccessTaskProfile, false);
  assert.equal(importedRead.taskBinding.current, false);
  await assert.rejects(
    controller.handleRequest("turn/start", {
      threadId: imported.sessionId,
      clientTurnRequestId: "parity-imported-turn",
      promptText: "must remain read-only",
    }, context()),
    /read-only/,
  );

  const surface = new DirectLiveTextSurfaceSession({ send: () => {}, isDestroyed: () => false }, { controller, project });
  await surface.connect();
  const surfaceForkRead = await surface.request("thread/read", { threadId: childId });
  assert.equal(surfaceForkRead.capabilities.authority.fullAccessTaskProfile, true);
  assert.equal(surface.connection.taskBinding.taskId, childId);
  assert.equal(surface.connection.taskBinding.projectId, projectId);

  console.log(JSON.stringify({
    schema: "direct_thread_turn_parity_regression_report@1",
    status: "passed",
    sourceThreadId: sourceId,
    forkThreadId: childId,
    sourceGrantId: selected.grantId,
    childGrantId: childGrant.grantId,
    rollbackId: rolledBack.rollback.rollbackId,
    steerRequestId: steered.steerRequestId,
    ownerTurnId: ownerTurn.turn.id,
  }));
} finally {
  controller.close("parity regression cleanup");
  threadStore.close?.();
  fs.rmSync(root, { recursive: true, force: true });
}
