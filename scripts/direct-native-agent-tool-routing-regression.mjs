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
  });
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
  assert.equal(childCalls.length, 1);
  assert.equal(childCalls[0].requestBody.model, "gpt-5.6-terra");
  assert.equal(childCalls[0].requestBody.reasoning.effort, "low");
  assert.equal(childCalls[0].requestShape.contextHandoffMode, "full");
  assert.equal(childCalls[0].requestShape.contextMessageCount, 2);
  assert.equal(parentBodies.length, 1, "spawn result should continue the parent exactly once");
  assert.match(JSON.stringify(parentBodies[0]), /spawn_agent_result/);
  assert.match(JSON.stringify(parentBodies[0]), /bounded_analysis/);
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
  assert.equal(parentBodies.length, 2);
  assert.match(JSON.stringify(parentBodies[1]), /wait_agent_result/);
  assert.match(JSON.stringify(parentBodies[1]), /Child analyzed the delegated slice/);
  const waitTurn = sessionStore.readTurn("direct_parent_native_agents", "turn_wait");
  assert.equal(waitTurn.state, "completed");
  assert.equal(waitTurn.unresolvedObligations[0].result.resultKind, "direct_sub_agent_runtime");

  console.log(JSON.stringify({
    ok: true,
    maxActiveChildren: pool.descriptor().maxActiveChildren,
    childModel: childCalls[0].requestBody.model,
    childReasoningEffort: childCalls[0].requestBody.reasoning.effort,
    contextHandoffMode: childCalls[0].requestShape.contextHandoffMode,
    parentContinuations: parentBodies.length,
  }, null, 2));
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
