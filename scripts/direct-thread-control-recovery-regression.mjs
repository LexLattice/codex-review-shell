#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");

function fixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `direct-thread-control-recovery-${label}-`));
  const project = {
    id: `project_control_recovery_${label}`,
    name: "Direct control recovery fixture",
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
  const controller = new DirectLiveTextController({ sessionStore, directThreadStore: threadStore, harnessGrantStore: grantStore });
  const status = {
    status: "ready",
    model: "gpt-5.4",
    evidenceId: `control-recovery-runtime-${label}`,
    readOnlyToolContinuation: { status: "ready" },
    patchApplyContinuation: { status: "ready" },
    commandExecutionContinuation: { status: "ready" },
  };
  controller.statusForProject = () => status;
  controller.assertReady = () => status;
  return { root, project, sessionStore, threadStore, grantStore, controller };
}

function closeFixture(state) {
  state.controller.close("control recovery regression cleanup");
  state.threadStore.close?.();
  fs.rmSync(state.root, { recursive: true, force: true });
}

function context(project) {
  return { project, ownerControlled: true };
}

function reopen(state) {
  const project = JSON.parse(JSON.stringify(state.project));
  const sessionStore = new DirectSessionStore({ rootDir: path.join(state.root, "sessions") });
  const threadStore = new DirectThreadStore({ rootDir: path.join(state.root, "threads") });
  const grantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(state.root, "grants") });
  const controller = new DirectLiveTextController({ sessionStore, directThreadStore: threadStore, harnessGrantStore: grantStore });
  controller.statusForProject = () => ({ status: "ready", model: "gpt-5.4" });
  controller.assertReady = () => ({ status: "ready", model: "gpt-5.4" });
  return { ...state, project, sessionStore, threadStore, grantStore, controller };
}

function appendCompletedTurn(state, sessionId, turnId, text) {
  const turn = state.sessionStore.createTurn(sessionId, {
    turnId,
    input: [{ role: "user", text }],
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
    clientTurnRequestId: `${turnId}-request`,
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1" },
  });
  state.sessionStore.appendNormalizedEvents(sessionId, turnId, [
    { type: "message_delta", text: `response for ${turnId}` },
    { type: "response_completed", responseId: `${turnId}-response` },
  ]);
  const completed = state.sessionStore.updateTurnState(sessionId, turnId, "completed", {
    responseId: `${turnId}-response`,
  });
  state.sessionStore.writeSession({
    ...state.sessionStore.readSession(sessionId),
    messages: [
      ...(state.sessionStore.readSession(sessionId)?.messages || []),
      { id: turnId, type: "message", turnId, items: [{ id: `${turnId}-user`, type: "userMessage", text }] },
    ],
  });
  return completed;
}

async function makeSource(state, title = "Recovery source") {
  const started = await state.controller.handleRequest("thread/start", {
    title,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    serviceTier: "fast",
  }, context(state.project));
  const selected = await state.controller.handleRequest("thread/selectAccessProfile", {
    sessionId: started.thread.id,
    accessProfile: "full_access",
  }, context(state.project));
  return { sessionId: started.thread.id, grantId: selected.grantId };
}

async function runForkRecovery() {
  const state = fixture("fork");
  try {
    const source = await makeSource(state);
    appendCompletedTurn(state, source.sessionId, "fork_recovery_turn", "fork recovery history");
    let fail = true;
    state.controller.threadControlFaultInjector = ({ operationType }) => {
      if (fail && operationType === "fork_thread") {
        fail = false;
        throw new Error("fault after fork side effect");
      }
    };
    await assert.rejects(
      state.controller.handleRequest("thread/fork", { threadId: source.sessionId, clientForkId: "recover-fork-1" }, context(state.project)),
      /fault after fork side effect/,
    );
    const planned = state.threadStore.operationByClient(state.project.id, "recover-fork-1");
    assert.equal(planned.status, "planned");
    const plannedResult = JSON.parse(planned.result_json);
    const childId = plannedResult.intent.childThreadId;
    assert.ok(state.sessionStore.readSession(childId), "fork side effect must be durable before the fault");
    state.controller.close("restart after fork fault");
    state.threadStore.close?.();
    const restarted = reopen(state);
    try {
      const recovered = await restarted.controller.handleRequest("thread/fork", { threadId: source.sessionId, clientForkId: "recover-fork-1" }, context(restarted.project));
      assert.equal(recovered.reused, true);
      assert.equal(recovered.thread.id, childId);
      assert.equal(restarted.threadStore.operationByClient(restarted.project.id, "recover-fork-1").status, "committed");
      assert.equal(restarted.sessionStore.ensure().sessions.filter((entry) => entry.parentThreadId === source.sessionId).length, 1);
      const childGrant = restarted.grantStore.currentForScope({ taskId: childId, threadId: childId, projectId: state.project.id });
      assert.ok(childGrant, "recovery must preserve the inherited child grant");
      assert.equal(childGrant.parentGrantId, source.grantId);
      await assert.rejects(
        restarted.controller.handleRequest("thread/fork", { threadId: source.sessionId, clientForkId: "recover-fork-1", newThreadId: "different-child" }, context(restarted.project)),
        /conflict|different|mismatch/,
      );
    } finally {
      closeFixture(restarted);
    }
  } finally {
    if (!state.controller.closed) closeFixture(state);
    else fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function runRollbackRecovery() {
  const state = fixture("rollback");
  try {
    const source = await makeSource(state, "Rollback source");
    appendCompletedTurn(state, source.sessionId, "rollback_turn_1", "retain");
    appendCompletedTurn(state, source.sessionId, "rollback_turn_2", "remove");
    let fail = true;
    state.controller.threadControlFaultInjector = ({ operationType }) => {
      if (fail && operationType === "rollback_thread") {
        fail = false;
        throw new Error("fault after rollback side effect");
      }
    };
    await assert.rejects(
      state.controller.handleRequest("thread/rollback", { threadId: source.sessionId, numTurns: 1, clientRollbackId: "recover-rollback-1" }, context(state.project)),
      /fault after rollback side effect/,
    );
    const planned = state.threadStore.operationByClient(state.project.id, "recover-rollback-1");
    assert.equal(planned.status, "planned");
    state.controller.close("restart after rollback fault");
    state.threadStore.close?.();
    const sessionStore = new DirectSessionStore({ rootDir: path.join(state.root, "sessions") });
    const threadStore = new DirectThreadStore({ rootDir: path.join(state.root, "threads") });
    const grantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(state.root, "grants") });
    const controller = new DirectLiveTextController({ sessionStore, directThreadStore: threadStore, harnessGrantStore: grantStore });
    controller.statusForProject = () => ({ status: "ready", model: "gpt-5.4" });
    controller.assertReady = () => ({ status: "ready", model: "gpt-5.4" });
    try {
      const recovered = await controller.handleRequest("thread/rollback", { threadId: source.sessionId, numTurns: 1, clientRollbackId: "recover-rollback-1" }, context(state.project));
      assert.equal(recovered.reused, true);
      assert.equal(recovered.thread.turns.length, 1);
      assert.equal(sessionStore.readSession(source.sessionId).rollbackHistory.filter((entry) => entry.rollbackId === "recover-rollback-1").length, 1);
      assert.equal(threadStore.operationByClient(state.project.id, "recover-rollback-1").status, "committed");
      await assert.rejects(
        controller.handleRequest("thread/rollback", { threadId: source.sessionId, numTurns: 2, clientRollbackId: "recover-rollback-1" }, context(state.project)),
        /different turn count|conflict/,
      );
    } finally {
      controller.close("rollback recovery cleanup");
      threadStore.close?.();
    }
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function runRollbackStaleRecovery() {
  const state = fixture("rollback-stale");
  try {
    const source = await makeSource(state, "Rollback stale source");
    appendCompletedTurn(state, source.sessionId, "rollback_stale_turn_1", "retain");
    appendCompletedTurn(state, source.sessionId, "rollback_stale_turn_2", "remove");
    const originalWriteTurn = state.sessionStore.writeTurn.bind(state.sessionStore);
    let failBeforeMutation = true;
    state.sessionStore.writeTurn = (turn) => {
      if (failBeforeMutation) {
        failBeforeMutation = false;
        throw new Error("fault after rollback plan before session mutation");
      }
      return originalWriteTurn(turn);
    };
    await assert.rejects(
      state.controller.handleRequest("thread/rollback", { threadId: source.sessionId, numTurns: 1, clientRollbackId: "recover-rollback-stale-1" }, context(state.project)),
      /fault after rollback plan before session mutation/,
    );
    state.sessionStore.writeTurn = originalWriteTurn;
    const planned = state.threadStore.operationByClient(state.project.id, "recover-rollback-stale-1");
    assert.equal(planned.status, "planned");
    const beforeInterveningSession = fs.readFileSync(state.sessionStore.sessionPath(source.sessionId), "utf8");
    const beforeInterveningTurn = fs.readFileSync(state.sessionStore.turnPath(source.sessionId, "rollback_stale_turn_2"), "utf8");
    appendCompletedTurn(state, source.sessionId, "rollback_stale_intervening_turn", "intervening completed turn");
    const expectedSession = fs.readFileSync(state.sessionStore.sessionPath(source.sessionId), "utf8");
    const expectedTurns = {
      first: fs.readFileSync(state.sessionStore.turnPath(source.sessionId, "rollback_stale_turn_1"), "utf8"),
      second: fs.readFileSync(state.sessionStore.turnPath(source.sessionId, "rollback_stale_turn_2"), "utf8"),
      intervening: fs.readFileSync(state.sessionStore.turnPath(source.sessionId, "rollback_stale_intervening_turn"), "utf8"),
    };
    assert.equal(beforeInterveningSession.includes("rollback_stale_intervening_turn"), false);
    assert.equal(beforeInterveningTurn.includes("rolledBack"), false);
    state.controller.close("restart after stale rollback plan");
    state.threadStore.close?.();
    const restarted = reopen(state);
    try {
      await assert.rejects(
        restarted.controller.handleRequest("thread/rollback", { threadId: source.sessionId, numTurns: 1, clientRollbackId: "recover-rollback-stale-1" }, context(restarted.project)),
        (error) => error?.code === "direct_thread_control_recovery_ambiguous",
      );
      assert.equal(restarted.threadStore.operationByClient(restarted.project.id, "recover-rollback-stale-1").status, "planned");
      assert.equal(fs.readFileSync(restarted.sessionStore.sessionPath(source.sessionId), "utf8"), expectedSession);
      assert.equal(fs.readFileSync(restarted.sessionStore.turnPath(source.sessionId, "rollback_stale_turn_1"), "utf8"), expectedTurns.first);
      assert.equal(fs.readFileSync(restarted.sessionStore.turnPath(source.sessionId, "rollback_stale_turn_2"), "utf8"), expectedTurns.second);
      assert.equal(fs.readFileSync(restarted.sessionStore.turnPath(source.sessionId, "rollback_stale_intervening_turn"), "utf8"), expectedTurns.intervening);
      assert.equal(JSON.parse(expectedTurns.second).rolledBack, undefined);
      assert.equal(JSON.parse(expectedTurns.intervening).rolledBack, undefined);
    } finally {
      closeFixture(restarted);
    }
  } finally {
    if (!state.controller.closed) closeFixture(state);
    else fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function runSteerRecovery() {
  const state = fixture("steer");
  try {
    const source = await makeSource(state, "Steer source");
    const turn = state.sessionStore.createTurn(source.sessionId, {
      turnId: "steer_recovery_turn",
      input: [{ role: "user", text: "initial" }],
      state: "request_built",
      model: "gpt-5.4",
      clientTurnRequestId: "steer-recovery-turn-request",
    });
    state.controller.indexDirectThreadStoreSession(source.sessionId);
    let fail = true;
    state.controller.threadControlFaultInjector = ({ operationType }) => {
      if (fail && operationType === "steer_turn") {
        fail = false;
        throw new Error("fault after steer side effect");
      }
    };
    const steerParams = {
      threadId: source.sessionId,
      expectedTurnId: turn.turnId,
      clientSteerRequestId: "recover-steer-1",
      input: [{ type: "text", text: "continue elsewhere" }],
    };
    await assert.rejects(state.controller.handleRequest("turn/steer", steerParams, context(state.project)), /fault after steer side effect/);
    const planned = state.threadStore.operationByClient(state.project.id, "recover-steer-1");
    assert.equal(planned.status, "planned");
    assert.equal(state.sessionStore.readTurn(source.sessionId, turn.turnId).steeringRequests.length, 1);
    state.controller.close("restart after steer fault");
    state.threadStore.close?.();
    const sessionStore = new DirectSessionStore({ rootDir: path.join(state.root, "sessions") });
    const threadStore = new DirectThreadStore({ rootDir: path.join(state.root, "threads") });
    const grantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(state.root, "grants") });
    const controller = new DirectLiveTextController({ sessionStore, directThreadStore: threadStore, harnessGrantStore: grantStore });
    controller.statusForProject = () => ({ status: "ready", model: "gpt-5.4" });
    controller.assertReady = () => ({ status: "ready", model: "gpt-5.4" });
    try {
      const recovered = await controller.handleRequest("turn/steer", steerParams, context(state.project));
      assert.equal(recovered.reused, true);
      assert.equal(sessionStore.readTurn(source.sessionId, turn.turnId).steeringRequests.length, 1);
      assert.equal(threadStore.operationByClient(state.project.id, "recover-steer-1").status, "committed");
      await assert.rejects(
        controller.handleRequest("turn/steer", { ...steerParams, input: [{ type: "text", text: "different input" }] }, context(state.project)),
        /different input|conflict/,
      );
      assert.equal(sessionStore.readTurn(source.sessionId, turn.turnId).steeringRequests.length, 1);
    } finally {
      controller.close("steer recovery cleanup");
      threadStore.close?.();
    }
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

try {
  await runForkRecovery();
  await runRollbackRecovery();
  await runRollbackStaleRecovery();
  await runSteerRecovery();
  console.log(JSON.stringify({ schema: "direct_thread_control_recovery_regression_report@1", status: "passed", operations: ["fork_thread", "rollback_thread", "steer_turn"] }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
