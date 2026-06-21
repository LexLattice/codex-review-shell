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

const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_safe_utility_done\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_safe_utility_done\",\"delta\":\"Utility result received.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_safe_utility_done\",\"status\":\"completed\"}}",
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

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-safe-resident-utility-routing-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir });
  sessionStore.createSession({
    sessionId: "direct_session_safe_utility",
    projectId: "project_safe_utility",
    title: "Safe utility routing fixture",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messages: [{
      id: "turn_context",
      status: "tool_waiting",
      items: [{ id: "turn_context_user", type: "userMessage", text: "Use utility." }],
    }],
  });
  sessionStore.createTurn("direct_session_safe_utility", {
    turnId: "turn_context",
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "Use utility." }],
    responseId: "resp_initial",
  });

  let fetchCalls = 0;
  const capturedProviderBodies = [];
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
      capturedProviderBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => continuationSse,
      };
    },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.4", context: { contextWindow: 100000, usedTokens: 25000, remainingTokens: 75000 } }),
  });
  const project = { id: "project_safe_utility", name: "Safe utility fixture" };
  const surface = new DirectLiveTextSurfaceSession({ send: () => {}, isDestroyed: () => false }, { controller, project });
  await surface.connect({});

  const contextObligations = sessionStore.addToolObligations(
    "direct_session_safe_utility",
    "turn_context",
    [toolEvent("get_context_remaining", { detail: "compact" })],
  ).obligations;
  assert.equal(contextObligations.length, 1);
  const createdContext = await controller.emitToolApprovalRequests(
    surface,
    "direct_session_safe_utility",
    "turn_context",
    contextObligations,
    project,
  );
  assert.equal(createdContext, 1, "context utility should be handled without read_file approval");
  assert.equal(fetchCalls, 1, "context utility should continue provider once with function output");
  assert.equal(capturedProviderBodies[0].input[0].role, "user", "fresh-context continuation should use quoted utility evidence");
  assert.equal(surface.hasServerRequest(), false, "context utility must not create a pending approval request");
  const contextTurn = sessionStore.readTurn("direct_session_safe_utility", "turn_context");
  assert.equal(contextTurn.state, "completed", "context utility continuation should complete");
  assert.equal(contextTurn.unresolvedObligations[0].authorityState, "continuation_sent");
  assert.equal(contextTurn.unresolvedObligations[0].result.resultKind, "context_remaining_status");

  sessionStore.createTurn("direct_session_safe_utility", {
    turnId: "turn_input",
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "Ask me." }],
    responseId: "resp_input",
  });
  const inputObligations = sessionStore.addToolObligations(
    "direct_session_safe_utility",
    "turn_input",
    [toolEvent("request_user_input", {
      prompt: "Continue?",
      choices: [{ choiceId: "yes", label: "Yes" }],
      freeTextAllowed: true,
    }, 2)],
  ).obligations;
  const createdInput = await controller.emitToolApprovalRequests(
    surface,
    "direct_session_safe_utility",
    "turn_input",
    inputObligations,
    project,
  );
  assert.equal(createdInput, 1, "request_user_input should create a user-input server request");
  assert.equal(fetchCalls, 1, "request_user_input should wait for human before provider continuation");
  const pendingRequest = [...surface.serverRequests.values()].find((request) => request.method === "item/tool/requestUserInput");
  assert(pendingRequest, "missing user-input request");
  assert.equal(pendingRequest.riskCategory, "user-input");
  assert.equal(pendingRequest.params.questions[0].question, "Continue?");
  const inputTurn = sessionStore.readTurn("direct_session_safe_utility", "turn_input");
  assert.equal(inputTurn.state, "authority_waiting", "request_user_input should wait for human input");
  assert.equal(inputTurn.unresolvedObligations[0].authorityState, "human_decision_waiting");
  assert.equal(inputTurn.unresolvedObligations[0].result.resultKind, "human_decision_packet");
  const inputResponse = await surface.respond(pendingRequest.key, {
    answers: {
      [pendingRequest.params.questions[0].id]: { answers: ["yes"] },
    },
  });
  assert.equal(inputResponse.response.decision, "utility_continued", "human answer should resume provider continuation");
  assert.equal(fetchCalls, 2, "human answer should trigger one additional provider continuation");
  const answeredInputTurn = sessionStore.readTurn("direct_session_safe_utility", "turn_input");
  assert.equal(answeredInputTurn.state, "completed", "answered request_user_input turn should complete");
  assert.equal(answeredInputTurn.unresolvedObligations[0].authorityState, "continuation_sent");
  assert.equal(answeredInputTurn.unresolvedObligations[0].result.resultKind, "human_decision_result");
  assert.equal(surface.serverRequests.get(pendingRequest.key).status, "completed");

  console.log(JSON.stringify({
    ok: true,
    fetchCalls,
    contextAuthorityState: contextTurn.unresolvedObligations[0].authorityState,
    inputAuthorityState: answeredInputTurn.unresolvedObligations[0].authorityState,
    pendingRequestMethod: pendingRequest.method,
  }, null, 2));
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
