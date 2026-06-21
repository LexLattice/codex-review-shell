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
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const {
  buildExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");

const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_external_done\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_external_done\",\"delta\":\"External evidence received.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_external_done\",\"status\":\"completed\"}}",
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

async function runExternalObligation({ sessionStore, controller, surface, project, turnId, event }) {
  sessionStore.createTurn("direct_session_external_tools", {
    turnId,
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: `Run ${event.name}.` }],
    responseId: `resp_initial_${turnId}`,
  });
  const obligations = sessionStore.addToolObligations(
    "direct_session_external_tools",
    turnId,
    [event],
  ).obligations;
  const created = await controller.emitToolApprovalRequests(
    surface,
    "direct_session_external_tools",
    turnId,
    obligations,
    project,
  );
  assert.equal(created, 1, `${event.name} should be handled as a read-only external promoted tool`);
  const turn = sessionStore.readTurn("direct_session_external_tools", turnId);
  assert.equal(turn.state, "completed", `${event.name} continuation should complete`);
  assert.equal(turn.unresolvedObligations[0].authorityState, "continuation_sent");
  return turn;
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-external-promoted-routing-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir });
  sessionStore.createSession({
    sessionId: "direct_session_external_tools",
    projectId: "project_external_tools",
    title: "External promoted tools routing fixture",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messages: [],
  });

  const externalProfile = buildExternalCapabilityProfile({
    projectId: "project_external_tools",
    workThreadId: "work_thread_external_tools",
    generatedAt: "2026-06-21T13:00:00.000Z",
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
    externalCapabilityProfileResolver: () => externalProfile,
  });
  const project = {
    id: "project_external_tools",
    name: "External tools fixture",
    workThreadId: "work_thread_external_tools",
  };
  const surface = new DirectLiveTextSurfaceSession({ send: () => {}, isDestroyed: () => false }, { controller, project });
  await surface.connect({});

  const searchTurn = await runExternalObligation({
    sessionStore,
    controller,
    surface,
    project,
    turnId: "turn_tool_search",
    event: toolEvent("tool_search", { families: ["mcp_resource", "mcp_tool"], includeBlocked: true, maxResults: 5 }, 1),
  });
  assert.equal(surface.hasServerRequest(), false, "tool_search must not create approval or user-input requests");
  assert.match(searchTurn.unresolvedObligations[0].result.providerOutputText, /tool_search_result/);
  assert.match(searchTurn.unresolvedObligations[0].result.providerOutputText, /descriptorCount/);

  const listTurn = await runExternalObligation({
    sessionStore,
    controller,
    surface,
    project,
    turnId: "turn_list_resources",
    event: toolEvent("list_mcp_resources", { serverIdentityId: "mcp_server_project_fixture", maxResults: 3 }, 2),
  });
  assert.match(listTurn.unresolvedObligations[0].result.providerOutputText, /list_mcp_resources_result/);
  assert.match(listTurn.unresolvedObligations[0].result.providerOutputText, /exactServerIdentityRequired/);

  const readTurn = await runExternalObligation({
    sessionStore,
    controller,
    surface,
    project,
    turnId: "turn_read_resource",
    event: toolEvent("read_mcp_resource", {
      serverIdentityId: "mcp_server_project_fixture",
      resourceUri: "mcp://fixture/resource/alpha",
      mimeType: "text/plain",
    }, 3),
  });
  assert.match(readTurn.unresolvedObligations[0].result.providerOutputText, /read_mcp_resource_result/);
  assert.match(readTurn.unresolvedObligations[0].result.providerOutputText, /mcp_resource_payload_backend_unavailable/);
  assert.equal(fetchCalls, 3, "each promoted external tool should continue provider once");
  assert.equal(providerBodies.length, 3);
  assert(!JSON.stringify(providerBodies).includes("rawResourcePayloadIncluded\":true"), "raw resource payload must not be exposed");
  assert(!JSON.stringify(providerBodies).includes("pluginInstallPerformed\":true"), "plugin install must not be performed");
  assert(!JSON.stringify(providerBodies).includes("dynamicMcpActionPerformed\":true"), "dynamic MCP action must not be performed");

  console.log(JSON.stringify({
    ok: true,
    fetchCalls,
    searchResultKind: searchTurn.unresolvedObligations[0].result.resultKind,
    listResultKind: listTurn.unresolvedObligations[0].result.resultKind,
    readResultKind: readTurn.unresolvedObligations[0].result.resultKind,
    serverRequestCount: surface.serverRequests.size,
  }, null, 2));
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
