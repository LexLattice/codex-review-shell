#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
} = require("../src/main/direct/controller/live-text-controller");
const { createDirectLiveSubAgentToolSurface } = require("../src/main/direct/agents/live-tool-surface");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_sub_agent_status_done\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_sub_agent_status_done\",\"delta\":\"Sub-agent status received.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_sub_agent_status_done\",\"status\":\"completed\"}}",
  "",
].join("\n");

function toolEvent(name, args, index = 1) {
  return {
    type: "tool_call_completed",
    sequence: index,
    itemId: `tool_${name}_${index}`,
    callId: `call_${name}_${index}`,
    name,
    toolType: "function_call",
    argumentsJson: JSON.stringify(args || {}),
    responseId: "resp_initial",
  };
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-sub-agent-status-routing-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir });
  sessionStore.createSession({
    sessionId: "direct_session_sub_agent_status",
    projectId: "project_sub_agent_status",
    title: "Sub-agent status routing fixture",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messages: [{
      id: "turn_list",
      status: "tool_waiting",
      items: [{ id: "turn_list_user", type: "userMessage", text: "List agents." }],
    }],
  });
  sessionStore.createTurn("direct_session_sub_agent_status", {
    turnId: "turn_list",
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "List agents." }],
    responseId: "resp_initial",
  });

  const subAgentSurface = createDirectLiveSubAgentToolSurface({
    projectId: "project_sub_agent_status",
    workThreadId: "work_thread_sub_agent_status",
    primaryThreadId: "direct_session_sub_agent_status",
    agents: [{
      agentThreadId: "agent_carver",
      displayLabel: "Carver",
      role: "worker",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      lifecycleState: "running",
      activityState: "active",
    }],
  });

  let fetchCalls = 0;
  const providerBodies = [];
  const controller = new DirectLiveTextController({
    sessionStore,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } } },
    authStore: {
      readStatus: () => ({ status: "authenticated", hasAccessToken: true, hasRefreshToken: false }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      providerBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => continuationSse,
      };
    },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.4" }),
    subAgentStatusSurfaceResolver: () => subAgentSurface,
  });
  const project = {
    id: "project_sub_agent_status",
    name: "Sub-agent status fixture",
    workThreadId: "work_thread_sub_agent_status",
  };
  const surface = new DirectLiveTextSurfaceSession({ send: () => {}, isDestroyed: () => false }, { controller, project });
  await surface.connect({});

  const listObligations = sessionStore.addToolObligations(
    "direct_session_sub_agent_status",
    "turn_list",
    [toolEvent("list_agents", {})],
  ).obligations;
  const createdList = await controller.emitToolApprovalRequests(
    surface,
    "direct_session_sub_agent_status",
    "turn_list",
    listObligations,
    project,
  );
  assert.equal(createdList, 1, "list_agents should be handled as read-only status");
  assert.equal(surface.hasServerRequest(), false, "list_agents must not create approval or user-input requests");
  assert.equal(fetchCalls, 1, "list_agents should continue provider once");
  assert.match(JSON.stringify(providerBodies[0]), /list_agents_result/);
  assert.match(JSON.stringify(providerBodies[0]), /agent_carver/);
  const listTurn = sessionStore.readTurn("direct_session_sub_agent_status", "turn_list");
  assert.equal(listTurn.state, "completed");
  assert.equal(listTurn.unresolvedObligations[0].authorityState, "continuation_sent");
  assert.equal(listTurn.unresolvedObligations[0].result.resultKind, "sub_agent_list_status");
  assert.equal(listTurn.unresolvedObligations[0].result.providerOutputText.includes("Carver"), true);

  sessionStore.createTurn("direct_session_sub_agent_status", {
    turnId: "turn_inspect",
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "Inspect agent." }],
    responseId: "resp_initial_inspect",
  });
  const inspectObligations = sessionStore.addToolObligations(
    "direct_session_sub_agent_status",
    "turn_inspect",
    [toolEvent("inspect_agent", { childAgentId: "agent_carver" }, 2)],
  ).obligations;
  const createdInspect = await controller.emitToolApprovalRequests(
    surface,
    "direct_session_sub_agent_status",
    "turn_inspect",
    inspectObligations,
    project,
  );
  assert.equal(createdInspect, 1, "inspect_agent should be handled as read-only status");
  assert.equal(fetchCalls, 2, "inspect_agent should continue provider once");
  assert.match(JSON.stringify(providerBodies[1]), /inspect_agent_result/);
  assert.match(JSON.stringify(providerBodies[1]), /gpt-5.4-mini/);
  const inspectTurn = sessionStore.readTurn("direct_session_sub_agent_status", "turn_inspect");
  assert.equal(inspectTurn.state, "completed");
  assert.equal(inspectTurn.unresolvedObligations[0].authorityState, "continuation_sent");
  assert.equal(inspectTurn.unresolvedObligations[0].result.resultKind, "sub_agent_inspect_status");
  assert.equal(inspectTurn.unresolvedObligations[0].result.providerOutputText.includes("canInterfere"), true);

  sessionStore.createTurn("direct_session_sub_agent_status", {
    turnId: "turn_unavailable",
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "List agents without graph." }],
    responseId: "resp_initial_unavailable",
  });
  const unavailableController = new DirectLiveTextController({
    sessionStore,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } } },
    authStore: {
      readStatus: () => ({ status: "authenticated", hasAccessToken: true, hasRefreshToken: false }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      providerBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => continuationSse,
      };
    },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.4" }),
  });
  const unavailableSurface = new DirectLiveTextSurfaceSession({ send: () => {}, isDestroyed: () => false }, { controller: unavailableController, project });
  await unavailableSurface.connect({});
  const unavailableObligations = sessionStore.addToolObligations(
    "direct_session_sub_agent_status",
    "turn_unavailable",
    [toolEvent("list_agents", {}, 3)],
  ).obligations;
  await unavailableController.emitToolApprovalRequests(
    unavailableSurface,
    "direct_session_sub_agent_status",
    "turn_unavailable",
    unavailableObligations,
    project,
  );
  const unavailableTurn = sessionStore.readTurn("direct_session_sub_agent_status", "turn_unavailable");
  assert.equal(unavailableTurn.state, "completed");
  assert.equal(unavailableTurn.unresolvedObligations[0].result.resultKind, "sub_agent_list_status");
  assert.equal(unavailableTurn.unresolvedObligations[0].result.providerOutputText.includes("sub_agent_graph_evidence_unavailable"), true);

  console.log(JSON.stringify({
    ok: true,
    fetchCalls,
    listResultKind: listTurn.unresolvedObligations[0].result.resultKind,
    inspectResultKind: inspectTurn.unresolvedObligations[0].result.resultKind,
    serverRequestCount: surface.serverRequests.size,
  }, null, 2));
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
