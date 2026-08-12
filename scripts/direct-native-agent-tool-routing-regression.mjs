#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

function completedSse(id, text) {
  return [
    "event: response.created",
    `data: {"response":{"id":"${id}","model":"gpt-5.6-sol"}}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `${id}_message`, delta: text })}`,
    "",
    "event: response.completed",
    `data: {"response":{"id":"${id}","status":"completed"}}`,
    "",
  ].join("\n");
}

function toolCallSse(id, name, args) {
  const itemId = `${id}_${name}`;
  const callId = `call_${id}_${name}`;
  const argumentsJson = JSON.stringify(args);
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id, model: "gpt-5.6-sol" } })}`,
    "",
    "event: response.output_item.added",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name } })}`,
    "",
    "event: response.function_call_arguments.delta",
    `data: ${JSON.stringify({ item_id: itemId, call_id: callId, delta: argumentsJson })}`,
    "",
    "event: response.output_item.done",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name, arguments: argumentsJson } })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id, status: "completed" } })}`,
    "",
  ].join("\n");
}

function toolEvent(name, args, index) {
  return {
    type: "tool_call_completed",
    sequence: index,
    itemId: `tool_${name}_${index}`,
    callId: `call_${name}_${index}`,
    name,
    toolType: "function_call",
    argumentsJson: JSON.stringify(args),
    responseId: `resp_parent_${index}`,
  };
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-native-agent-routing-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir });
  sessionStore.createSession({
    sessionId: "direct_parent_native_agents",
    projectId: "project_native_agents",
    title: "Native agent routing fixture",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
    messages: [{
      id: "prior_turn",
      status: "completed",
      items: [
        {
          id: "prior_user",
          type: "userMessage",
          content: [{ type: "text", text: "Prior project constraint." }],
        },
        {
          id: "prior_assistant",
          type: "agentMessage",
          text: "Prior admitted answer.",
        },
      ],
    }],
  });
  const childCalls = [];
  const workspaceChildCalls = [];
  const pool = new DirectNativeAgentPool({
    maxActiveChildren: 8,
    providerTurnRunner: async (request) => {
      childCalls.push(request);
      return {
        ok: true,
        terminalState: "completed",
        outputText: "Child analyzed the delegated slice.",
      };
    },
    workspaceWorkerRunner: async (request) => {
      workspaceChildCalls.push(request);
      return {
        status: "completed",
        outputText: "Workspace child completed its bounded implementation slice.",
        resultDigest: `sha256:${"b".repeat(64)}`,
        workspaceExecution: {
          schema: "direct_workspace_worker_execution@1",
          status: "completed",
          workspaceMode: request.workspaceMode,
          toolProfile: request.toolProfile,
          toolResultCount: 2,
          rawWorkspacePathIncluded: false,
        },
        epistemicCapture: {
          status: "captured",
          receiptDigest: `sha256:${"c".repeat(64)}`,
          sessionId: "native_workspace_child_fixture",
          turnId: "native_workspace_child_turn_fixture",
        },
        resultEnvelope: { confidence: "exact" },
      };
    },
  });
  const waitCalls = [];
  const poolWait = pool.wait.bind(pool);
  pool.wait = async (input) => {
    waitCalls.push(input);
    return poolWait(input);
  };
  const parentBodies = [];
  const controller = new DirectLiveTextController({
    sessionStore,
    subAgentPool: pool,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    authStore: {
      readStatus: () => ({ status: "authenticated", hasAccessToken: true, hasRefreshToken: false }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      parentBodies.push(JSON.parse(init.body));
      if (parentBodies.length === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          text: async () => toolCallSse("resp_spawn_second", "spawn_agent", {
            task_name: "bounded_analysis_two",
            message: "Analyze the second bounded concern.",
            fork_turns: "none",
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
          }),
        };
      }
      if (parentBodies.length === 2) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          text: async () => toolCallSse("resp_poll_second", "wait_agent", {
            targets: ["bounded_analysis_two"],
            timeout_ms: 0,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => completedSse(`resp_parent_continuation_${parentBodies.length}`, "Parent continued."),
      };
    },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol" }),
    subAgentStatusSurfaceResolver: ({ sessionId, project }) => pool.statusSurface({
      projectId: project.id,
      workThreadId: project.workThreadId,
      primaryThreadId: sessionId,
    }),
  });
  const project = {
    id: "project_native_agents",
    workThreadId: "work_thread_native_agents",
    surfaceBinding: {
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "implementation-lane",
      },
    },
  };

  sessionStore.createTurn("direct_parent_native_agents", {
    turnId: "turn_spawn",
    state: "tool_waiting",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
    input: [{ role: "user", text: "Delegate the analysis." }],
    responseId: "resp_parent_spawn",
  });
  const spawnObligation = sessionStore.addToolObligations(
    "direct_parent_native_agents",
    "turn_spawn",
    [toolEvent("spawn_agent", {
      task_name: "bounded_analysis",
      message: "Analyze this bounded concern.",
      fork_turns: "all",
      model: "gpt-5.6-terra",
      reasoning_effort: "low",
    }, 1)],
  ).obligations;
  const spawnHandled = await controller.emitToolApprovalRequests(
    null,
    "direct_parent_native_agents",
    "turn_spawn",
    spawnObligation,
    project,
  );
  assert.equal(spawnHandled, 1, "spawn_agent should execute without a renderer approval surface");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(childCalls.length, 2, "native continuation should be able to spawn another child in the same turn");
  assert.equal(childCalls[0].requestBody.model, "gpt-5.6-terra");
  assert.equal(childCalls[0].requestBody.reasoning.effort, "low");
  assert.equal(childCalls[0].requestShape.contextHandoffMode, "full");
  assert.equal(childCalls[0].requestShape.contextMessageCount, 2);
  assert.equal(parentBodies.length, 3, "spawn, nested spawn, and nested wait should remain in one provider turn");
  assert.match(JSON.stringify(parentBodies[0]), /spawn_agent_result/);
  assert.match(JSON.stringify(parentBodies[0]), /bounded_analysis/);
  assert(parentBodies[0].tools.some((tool) => tool.name === "spawn_agent"));
  assert(parentBodies[0].tools.some((tool) => tool.name === "wait_agent"));
  assert.match(JSON.stringify(parentBodies[1]), /bounded_analysis_two/);
  assert.match(JSON.stringify(parentBodies[2]), /wait_agent_result/);
  assert.equal(waitCalls[0].timeoutMs, 0, "controller must preserve a zero-millisecond wait timeout");
  const spawnTurn = sessionStore.readTurn("direct_parent_native_agents", "turn_spawn");
  assert.equal(
    spawnTurn.unresolvedObligations[0].result.sideEffectExecuted,
    true,
  );
  assert.equal(
    spawnTurn.unresolvedObligations[0].continuationRequest.safety.sideEffectExecuted,
    true,
  );
  const spawned = pool.records({
    projectId: project.id,
    primaryThreadId: "direct_parent_native_agents",
  })[0];
  assert.equal(spawned.state, "completed");
  assert.equal(spawned.runtimeProfileIndependentOfContext, true);
  assert.equal(pool.records({
    projectId: project.id,
    primaryThreadId: "direct_parent_native_agents",
  }).length, 2);

  sessionStore.createTurn("direct_parent_native_agents", {
    turnId: "turn_wait",
    state: "tool_waiting",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
    input: [{ role: "user", text: "Collect the child result." }],
    responseId: "resp_parent_wait",
  });
  const waitObligation = sessionStore.addToolObligations(
    "direct_parent_native_agents",
    "turn_wait",
    [toolEvent("wait_agent", {
      targets: ["bounded_analysis"],
      timeout_ms: 1000,
    }, 2)],
  ).obligations;
  const waitHandled = await controller.emitToolApprovalRequests(
    null,
    "direct_parent_native_agents",
    "turn_wait",
    waitObligation,
    project,
  );
  assert.equal(waitHandled, 1);
  assert.equal(parentBodies.length, 4);
  assert.match(JSON.stringify(parentBodies[3]), /wait_agent_result/);
  assert.match(JSON.stringify(parentBodies[3]), /Child analyzed the delegated slice/);
  const waitTurn = sessionStore.readTurn("direct_parent_native_agents", "turn_wait");
  assert.equal(waitTurn.state, "completed");
  assert.equal(waitTurn.unresolvedObligations[0].result.resultKind, "direct_sub_agent_runtime");

  sessionStore.createTurn("direct_parent_native_agents", {
    turnId: "turn_spawn_workspace",
    state: "tool_waiting",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
    input: [{ role: "user", text: "Delegate one isolated implementation slice." }],
    responseId: "resp_parent_spawn_workspace",
  });
  const workspaceSpawnObligation = sessionStore.addToolObligations(
    "direct_parent_native_agents",
    "turn_spawn_workspace",
    [toolEvent("spawn_agent", {
      task_name: "isolated_implementation",
      message: "Inspect and change only the delegated workspace slice.",
      fork_turns: "none",
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      workspace_mode: "isolated_worktree",
      tool_profile: "implementation_worker",
    }, 3)],
  ).obligations;
  const workspaceSpawnHandled = await controller.emitToolApprovalRequests(
    null,
    "direct_parent_native_agents",
    "turn_spawn_workspace",
    workspaceSpawnObligation,
    project,
  );
  assert.equal(workspaceSpawnHandled, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspaceChildCalls.length, 0, "missing harness policy blocks before workspace launch");
  const workspaceRecord = pool.records({
    projectId: project.id,
    primaryThreadId: "direct_parent_native_agents",
  }).find((record) => record.taskName === "isolated_implementation");
  assert.equal(workspaceRecord, undefined);
  const workspaceSpawnTurn = sessionStore.readTurn(
    "direct_parent_native_agents",
    "turn_spawn_workspace",
  );
  assert.equal(workspaceSpawnTurn.state, "completed");
  assert.match(
    JSON.stringify(workspaceSpawnTurn.unresolvedObligations[0].result),
    /direct_workspace_worker_delegation_policy_missing/,
  );
  assert.equal(
    JSON.stringify(workspaceSpawnTurn.unresolvedObligations[0].result).includes("repoPath"),
    false,
  );

  console.log(JSON.stringify({
    ok: true,
    maxActiveChildren: pool.descriptor().maxActiveChildren,
    childModel: childCalls[0].requestBody.model,
    childReasoningEffort: childCalls[0].requestBody.reasoning.effort,
    contextHandoffMode: childCalls[0].requestShape.contextHandoffMode,
    parentContinuations: parentBodies.length,
    sameTurnNativeTransitions: 3,
    isolatedWorkspaceToolRoute: "missing_delegation_policy_blocked",
  }, null, 2));
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
