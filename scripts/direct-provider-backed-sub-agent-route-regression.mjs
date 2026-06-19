#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA,
  DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA,
  assertDirectProviderBackedSubAgentRouteSafe,
  createDirectProviderBackedSubAgentRoute,
} = require("../src/main/direct/agents/provider-backed-route");

function assertNoRawPrompt(value, prompt) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes(prompt), "provider-backed route must not expose raw child prompt");
  assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt inclusion flag must remain false");
  assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload flag must remain false");
  assert(!serialized.includes("\"rawProviderFrameIncluded\":true"), "raw provider frame flag must remain false");
  assert(!serialized.includes("\"rawSecretIncluded\":true"), "raw secret flag must remain false");
}

const route = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  defaultModel: "gpt-5.5",
  defaultReasoningEffort: "medium",
  nowMs: 0,
});

const descriptor = route.descriptor();
assert.equal(descriptor.schema, DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA, "route schema mismatch");
assert.equal(descriptor.providerTransportAllowed, false, "route should report provider transport blocked without runner");
assert.equal(descriptor.providerDeclarationAllowed, false, "route must not declare provider tools");
assert.equal(descriptor.childToolsAllowed, false, "child tools remain disabled in this route");
assert.equal(descriptor.recursiveSpawnAllowed, false, "recursive spawn remains disabled");
assert.equal(descriptor.workspaceMutationAllowed, false, "workspace mutation remains disabled");
assert.equal(descriptor.childTranscriptPromotionAllowed, false, "child transcript promotion remains disabled");
assertDirectProviderBackedSubAgentRouteSafe(descriptor);

const blockedPrompt = "UNIQUE_BLOCKED_CHILD_PROMPT_8f5a";
const blocked = await route.spawnAndRun({
  childAgentId: "blocked_child",
  prompt: blockedPrompt,
});
assert.equal(blocked.schema, DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA, "blocked result schema mismatch");
assert.equal(blocked.status, "blocked", "route without runner should block");
assert.equal(blocked.blockerCode, "provider_runner_missing", "blocked route should cite provider_runner_missing");
assert.equal(blocked.providerRequestStarted, false, "blocked route must not start provider request");
assert.equal(blocked.providerCompleted, false, "blocked route must not complete provider request");
assertNoRawPrompt(blocked, blockedPrompt);
assertDirectProviderBackedSubAgentRouteSafe(descriptor, blocked);

const runnerCalls = [];
const liveRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  defaultModel: "gpt-5.5",
  defaultReasoningEffort: "medium",
  nowMs: 0,
  providerTurnRunner: async (request) => {
    runnerCalls.push(request);
    return {
      ok: true,
      responseId: "resp_child_fixture_1",
      upstreamRequestId: "upstream_child_fixture_1",
      outputText: "Child completed a fixture-safe result.",
      tokenUsage: {
        input_tokens: 42,
        cached_input_tokens: 12,
        output_tokens: 9,
        reasoning_output_tokens: 3,
        total_tokens: 51,
      },
    };
  },
});

const liveDescriptor = liveRoute.descriptor();
assert.equal(liveDescriptor.providerTransportAllowed, true, "route should report provider transport available when runner exists");
assert.equal(liveDescriptor.providerDeclarationAllowed, false, "provider declaration remains disabled with runner");
assertDirectProviderBackedSubAgentRouteSafe(liveDescriptor);

const childPrompt = "UNIQUE_PROVIDER_CHILD_PROMPT_c6b7";
const completed = await liveRoute.spawnAndRun({
  childAgentId: "provider_child",
  displayLabel: "Provider backed worker",
  role: "worker",
  model: "gpt-5.4-mini",
  reasoningEffort: "high",
  noInterferencePolicy: "sealed_audit",
  prompt: childPrompt,
});
assert.equal(completed.status, "completed", "provider-backed child route should complete with fixture runner");
assert.equal(completed.providerRequestStarted, true, "provider request should start");
assert.equal(completed.providerCompleted, true, "provider request should complete");
assert.equal(completed.agentThreadId, "provider_child", "result should include child agent id");
assert.equal(completed.requestShape.model, "gpt-5.4-mini", "request shape should preserve child model");
assert.equal(completed.requestShape.reasoningEffort, "high", "request shape should preserve child effort");
assert.equal(completed.requestShape.stream, true, "provider-backed route should stream");
assert.equal(completed.requestShape.store, false, "provider-backed route should not store provider transcript");
assert.equal(completed.requestShape.toolCount, 0, "child route should not declare tools in this PR");
assert.equal(completed.requestShape.parallelToolCalls, false, "parallel tool calls should remain disabled");
assert.equal(completed.tokenUsage.inputTokens, 42, "provider token usage should preserve input tokens");
assert.equal(completed.tokenUsage.cachedInputTokens, 12, "provider token usage should preserve cached input tokens");
assert.equal(completed.tokenUsage.reasoningOutputTokens, 3, "provider token usage should preserve reasoning output tokens");
assert.equal(completed.usageAttribution, "agent_thread", "usage should be attributed to child agent thread");
assert.equal(runnerCalls.length, 1, "provider runner should be called once");
assert.equal(runnerCalls[0].requestBody.model, "gpt-5.4-mini", "runner should receive model");
assert.equal(runnerCalls[0].requestBody.reasoning.effort, "high", "runner should receive effort");
assert.equal(runnerCalls[0].requestShape.toolCount, 0, "runner should receive no tools");
assert.equal(runnerCalls[0].agent.parentSelfBindingEnforced, true, "runner should receive no-interference child identity");
assert(completed.eChannelSnapshot.residentSnapshot.rows.some((row) => row.subjectId === "provider_child"), "E-channel should include provider child");
assert(completed.liveToolCatalog.blockedToolIds.includes("vanilla.agent.send_message"), "sealed provider child should block send_message");
assert(!completed.liveToolCatalog.callableToolIds.includes("vanilla.agent.send_message"), "sealed child must not list send_message callable");
assertNoRawPrompt(completed, childPrompt);
assertDirectProviderBackedSubAgentRouteSafe(liveDescriptor, completed);

const defaultRunnerCalls = [];
const defaultedRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  defaultModel: "gpt-5.4-mini",
  defaultReasoningEffort: "xhigh",
  nowMs: 0,
  providerTurnRunner: async (request) => {
    defaultRunnerCalls.push(request);
    return {
      ok: true,
      outputText: "Defaulted child completed.",
      tokenUsage: {
        input_tokens: "17",
        cached_input_tokens: "",
        output_tokens: null,
        reasoning_output_tokens: true,
        total_tokens: "23",
      },
    };
  },
});
const defaultPrompt = "UNIQUE_DEFAULTED_CHILD_PROMPT_916b";
const defaulted = await defaultedRoute.spawnAndRun({
  childAgentId: "defaulted_child",
  prompt: defaultPrompt,
});
assert.equal(defaulted.status, "completed", "defaulted route should complete");
assert.equal(defaulted.requestShape.model, "gpt-5.4-mini", "route default model should be used without child override");
assert.equal(defaulted.requestShape.reasoningEffort, "xhigh", "route default effort should be used without child override");
assert.equal(defaultRunnerCalls[0].requestBody.model, "gpt-5.4-mini", "runner should receive route default model");
assert.equal(defaultRunnerCalls[0].requestBody.reasoning.effort, "xhigh", "runner should receive route default effort");
assert.deepEqual(defaulted.tokenUsage, {
  inputTokens: 17,
  totalTokens: 23,
}, "token usage should accept numbers/numeric strings and reject null/boolean/empty values");
assertNoRawPrompt(defaulted, defaultPrompt);

const duplicate = await liveRoute.spawnAndRun({
  childAgentId: "provider_child",
  prompt: "UNIQUE_DUPLICATE_PROMPT_ba29",
});
assert.equal(duplicate.status, "blocked", "duplicate child id should block");
assert.equal(duplicate.blockerCode, "duplicate_child_agent_id", "duplicate child id should cite duplicate blocker");
assert.equal(runnerCalls.length, 1, "duplicate spawn must not call provider runner");
assertNoRawPrompt(duplicate, "UNIQUE_DUPLICATE_PROMPT_ba29");

let failingRunnerCalls = 0;
const failingRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  nowMs: 0,
  providerTurnRunner: async () => {
    failingRunnerCalls += 1;
    const error = new Error("fixture failure");
    error.code = "fixture_provider_failure";
    throw error;
  },
});
const failedPrompt = "UNIQUE_FAILING_CHILD_PROMPT_ea22";
const failed = await failingRoute.spawnAndRun({
  childAgentId: "failing_child",
  prompt: failedPrompt,
});
assert.equal(failed.status, "failed", "provider exception should produce failed route result");
assert.equal(failed.blockerCode, "fixture_provider_failure", "provider exception should preserve sanitized code");
assert.equal(failed.providerRequestStarted, true, "failed route should report provider request started");
assert.equal(failed.providerCompleted, false, "failed route should not report provider completion");
assert.equal(failingRunnerCalls, 1, "failing runner should be called once");
assert(failed.eChannelSnapshot.residentSnapshot.rows.some((row) => row.subjectId === "failing_child" && row.status !== "unknown"), "failed child should remain observable");
assertNoRawPrompt(failed, failedPrompt);

const serialized = JSON.stringify({ descriptor, blocked, liveDescriptor, completed, defaulted, duplicate, failed });
assert(!serialized.includes("UNIQUE_PROVIDER_CHILD_PROMPT_c6b7"), "serialized fixture must not contain successful raw prompt");
assert(!serialized.includes("UNIQUE_BLOCKED_CHILD_PROMPT_8f5a"), "serialized fixture must not contain blocked raw prompt");
assert(!serialized.includes("UNIQUE_FAILING_CHILD_PROMPT_ea22"), "serialized fixture must not contain failed raw prompt");
assert(!serialized.includes("UNIQUE_DEFAULTED_CHILD_PROMPT_916b"), "serialized fixture must not contain defaulted raw prompt");
assert(!serialized.includes("\"providerDeclarationAllowed\":true"), "provider declaration must never be enabled");
assert(!serialized.includes("\"workspaceMutationStarted\":true"), "workspace mutation must never start");
assert(!serialized.includes("\"childTranscriptPromotionStarted\":true"), "child transcript promotion must never start");

console.log(JSON.stringify({
  ok: true,
  routeDigest: liveDescriptor.routeDigest,
  completedDigest: completed.resultDigest,
  failedDigest: failed.resultDigest,
  runnerCalls: runnerCalls.length,
}, null, 2));
