#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-appserver-parity-integration-"));
const projectId = "project_direct_default_parity";
const model = "gpt-5.4";
const project = {
  id: projectId,
  name: "Direct default parity fixture",
  workspace: { kind: "local", localPath: root },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct",
      directTransport: "live-text",
      directTier: "implementation-lane",
      model,
    },
  },
};
const profileDoc = {
  summary: { profileId: "parity-profile", profileHash: "parity-profile-hash" },
  profile: {
    profileId: "parity-profile",
    source: "parity-fixture",
    ontology: {
      models: [{ id: model, status: "accepted", supportsReasoning: true, supportsTools: true }],
      continuationShapes: [
        { id: "continuation.tool_result", status: "accepted" },
        { id: "direct_patch_apply_continuation@1", status: "accepted" },
        { id: "direct_command_execution_continuation@1", status: "accepted" },
      ],
    },
  },
};
const authStore = {
  readStatus: () => ({ status: "authenticated", accountId: "parity-account", source: "fixture-auth" }),
  readCredentials: () => ({ accessToken: "fixture-token" }),
};
const sessionRoot = path.join(root, "sessions");
const threadRoot = path.join(root, "threads");
const grantRoot = path.join(root, "grants");
const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
const threadStore = new DirectThreadStore({ rootDir: threadRoot, mode: "index_only" });
const grantStore = new DirectThreadHarnessGrantStore({ rootDir: grantRoot });
const execManager = new DirectStatefulExecSessionManager({
  grantStore,
  workspaceRootResolver: () => root,
  idleTimeoutMs: 2_000,
  hardTimeoutMs: 5_000,
});
const node = process.execPath;

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

function sse(responseId, text) {
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `${responseId}_message`, delta: text })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

function makePool() {
  return {
    launch(input) {
      return {
        status: "accepted",
        state: "queued",
        childAgentId: "parity-child-agent",
        taskName: input.taskName || "parity delegated task",
        providerId: "direct-local",
        model: input.model || model,
        reasoningEffort: input.reasoningEffort || "medium",
        workspaceMode: input.workspaceMode || "reasoning_only",
        toolProfile: input.toolProfile || "reasoning_only",
        replayed: false,
      };
    },
    descriptor: () => ({ schema: "direct_sub_agent_pool@1", status: "ready", activeCount: 1 }),
  };
}

function makeController(store = sessionStore, grants = grantStore, threads = threadStore) {
  return new DirectLiveTextController({
    sessionStore: store,
    directThreadStore: threads,
    harnessGrantStore: grants,
    statefulExecSessionManager: execManager,
    profileDoc,
    authStore,
    subAgentPool: makePool(),
    fetchImpl: async (_url, _init) => textResponse(sse(`parity-response-${Date.now()}`, "direct continuation"), 200, { "content-type": "text/event-stream" }),
  });
}

const context = { project, ownerControlled: true };
try {
  const controller = makeController();
  const account = await controller.handleRequest("account/read", {}, context);
  assert.equal(account.account.accountId, "parity-account");

  const started = await controller.handleRequest("thread/start", {
    title: "fresh default Direct task",
    model,
    reasoningEffort: "medium",
    serviceTier: "fast",
    accessProfile: "full_access",
  }, context);
  const taskId = started.thread.id;
  assert.equal(started.thread.runtimeMode, "direct");
  assert.equal(started.accessProfile.profile, "full_access");
  assert.equal(started.capabilities.authority.fullAccessTaskProfile, true);
  assert.equal(started.capabilities.authority.commandApproval, false);
  assert.equal(started.capabilities.authority.fileChangeApproval, false);
  assert.equal(started.capabilities.runtimeCapabilityProjection.authoritative, true);
  assert.equal(started.capabilities.runtimeCapabilityProjection.scope, "task");

  const exec = await controller.handleRequest("exec_command", {
    taskId,
    cmd: `${node} -e "process.stdout.write('full-access-harness')"`,
    cwd: root,
    stdinPolicy: "disabled",
  }, context);
  const execResult = await controller.handleRequest("exec_command/wait", { taskId, sessionId: exec.sessionId }, context);
  assert.equal(execResult.status, "completed");
  assert(execResult.stdoutPreview.includes("full-access-harness"));

  const firstTurn = await controller.handleRequest("turn/start", {
    threadId: taskId,
    clientTurnRequestId: "parity-first-turn",
    promptText: "start the ordinary Direct task",
  }, context);
  const firstTurnRecord = sessionStore.readTurn(taskId, firstTurn.turn.id);
  assert(firstTurnRecord.requestShape.declaredToolNames.includes("exec_command"));
  assert(firstTurnRecord.requestShape.declaredToolNames.includes("apply_patch"));
  assert.equal(firstTurnRecord.requestShape.directThreadHarnessGrantId, started.capabilities.authority.fullAccessGrantId);
  const firstComplete = await controller.waitForTurnCompletion({ sessionId: taskId, turnId: firstTurn.turn.id });
  assert.equal(firstComplete.turn.state, "completed");
  const continued = await controller.handleRequest("turn/start", {
    threadId: taskId,
    clientTurnRequestId: "parity-followup-turn",
    promptText: "continue the ordinary Direct task",
  }, context);
  const continuedComplete = await controller.waitForTurnCompletion({ sessionId: taskId, turnId: continued.turn.id });
  assert.equal(continuedComplete.turn.state, "completed");

  const delegated = await controller.buildNativeSubAgentRuntimeEnvelope(taskId, firstTurn.turn.id, {
    name: "spawn_agent",
    callId: "parity-spawn-call",
    argumentsJson: JSON.stringify({ task_name: "bounded child", message: "observe this task" }),
  }, project);
  assert.equal(delegated.status, "ready_for_provider_continuation");
  assert.equal(delegated.providerOutput.childAgentId, "parity-child-agent");
  assert.equal(delegated.runtimeLifecycleMutationExecuted, true);

  const interruptedTurn = sessionStore.createTurn(taskId, {
    turnId: "parity-interrupted-turn",
    input: [{ role: "user", text: "interrupt me" }],
    model,
    reasoningEffort: "medium",
    serviceTier: "fast",
    state: "request_built",
  });
  const interrupted = controller.interruptTurn({ sessionId: taskId, turnId: interruptedTurn.turnId }, context);
  assert.equal(interrupted.status, "aborted");
  const resumed = await controller.handleRequest("thread/resume", { threadId: taskId }, context);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.capabilities.authority.fullAccessTaskProfile, true);

  const usage = await controller.handleRequest("account/usage/read", {}, context);
  assert.equal(usage.source, "direct_provider_metadata");

  const restricted = await controller.handleRequest("thread/start", {
    title: "neighbor restricted Direct task",
    model,
    reasoningEffort: "medium",
    serviceTier: "fast",
  }, context);
  assert.equal(restricted.capabilities.authority.fullAccessTaskProfile, false);
  assert.equal(restricted.capabilities.statefulExec.canStart, false);
  assert.equal(restricted.capabilities.statefulExec.approvalPolicy, "per_session");
  assert.equal(restricted.capabilities.runtimeCapabilityProjection.declaredToolNames.length, 0);
  assert.equal(restricted.capabilities.runtimeCapabilityProjection.current, false);
  assert.notEqual(restricted.capabilities.runtimeCapabilityProjection.taskId, taskId);

  controller.close("integration-restart");
  const restartedSessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  const restartedGrantStore = new DirectThreadHarnessGrantStore({ rootDir: grantRoot });
  const restartedThreadStore = new DirectThreadStore({ rootDir: threadRoot, mode: "index_only" });
  const restartedController = makeController(restartedSessionStore, restartedGrantStore, restartedThreadStore);
  const reopened = restartedController.capabilitiesForTask(project, taskId);
  assert.equal(reopened.taskBinding.taskId, taskId);
  assert.equal(reopened.taskBinding.current, true);
  assert.equal(reopened.capabilities.authority.fullAccessTaskProfile, true);
  assert.equal(reopened.capabilities.authority.commandApproval, false);
  assert.equal(reopened.capabilities.runtimeCapabilityProjection.grantId, reopened.taskBinding.grantId);
  assert.equal(restartedSessionStore.readSession(taskId).runtimeMode, "direct");

  console.log(JSON.stringify({
    schema: "direct_appserver_capability_parity_integration_regression_report@1",
    status: "passed",
    taskId,
    authenticated: true,
    fullAccessHarness: true,
    turnCount: restartedSessionStore.listTurnIdsFromDisk(taskId).length,
    delegatedChildAgentId: delegated.providerOutput.childAgentId,
    interruptedAndResumed: true,
    usageRead: true,
    reopenedAfterRestart: true,
    perCallApprovals: 0,
  }, null, 2));
} finally {
  execManager.dispose("integration-complete");
  try { threadStore.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
