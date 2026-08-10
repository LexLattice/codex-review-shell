#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_PROVIDER_BACKED_SUB_AGENT_RESULT_SCHEMA,
  DIRECT_PROVIDER_BACKED_SUB_AGENT_ROUTE_SCHEMA,
  SUB_AGENT_RESULT_ADMISSION_ENVELOPE_SCHEMA,
  SUB_AGENT_RESULT_REDUCER_POLICY_SCHEMA,
  SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA,
  SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA,
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
assert.equal(completed.reducerPolicy.schema, SUB_AGENT_RESULT_REDUCER_POLICY_SCHEMA, "reducer policy schema mismatch");
assert.equal(completed.reducerPolicy.includeRawPrompt, false, "reducer policy must not include raw prompt");
assert.equal(completed.reducerPolicy.includeRawProviderPayload, false, "reducer policy must not include raw provider payload");
assert.equal(completed.resultEnvelope.schema, "odeu_result_envelope@1", "ODEU result envelope missing");
assert.equal(completed.resultEnvelope.resultKind, "agent_result", "completed child should emit agent result envelope");
assert.equal(completed.resultEnvelope.visibility.providerVisible, "summary_only", "completed result should be admissible as summary");
assert.equal(completed.contextAdmission.schema, "odeu_context_admission_record@1", "context admission missing");
assert.equal(completed.contextAdmission.admissionDecision, "admit", "completed child summary should be admitted");
assert.equal(completed.contextAdmission.admittedAs, "agent_result_summary", "completed child should admit as agent result summary");
assert.equal(completed.resultAdmissionEnvelope.schema, SUB_AGENT_RESULT_ADMISSION_ENVELOPE_SCHEMA, "sub-agent result admission envelope missing");
assert.equal(completed.resultAdmissionEnvelope.terminalState, "completed", "terminal state mismatch");
assert.equal(completed.resultAdmissionEnvelope.terminalExact, true, "completed terminal state should be exact");
assert.equal(completed.resultAdmissionEnvelope.admittedToParentContext, true, "completed summary should be admitted to parent context");
assert.equal(completed.resultAdmissionEnvelope.admittedToPrimaryTranscript, "activity_summary_only", "primary transcript admission must remain summary-only");
assert.equal(completed.resultAdmissionEnvelope.childTranscriptFlattened, false, "child transcript must not be flattened");
assert.equal(completed.resultAdmissionEnvelope.rawChildPromptIncluded, false, "raw child prompt must not be included");
assert.equal(completed.resultAdmissionEnvelope.rawChildTranscriptIncluded, false, "raw child transcript must not be included");
assert.equal(completed.resultAdmissionEnvelope.rawProviderPayloadIncluded, false, "raw provider payload must not be included");
assert.equal(completed.usageAttributionRow.schema, SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA, "usage attribution row missing");
assert.equal(completed.usageAttributionRow.childAgentId, "provider_child", "usage attribution should target child agent");
assert.equal(completed.usageAttributionRow.tokenUsage.totalTokens, 51, "usage attribution should preserve provider total tokens");
assert.equal(completed.usageUnavailableRow, null, "usage unavailable should be absent when provider usage exists");
assert.equal(completed.childOutputPromotedToPrimaryTranscript, false, "child output must not be promoted as primary answer");
assert.equal(completed.primaryTranscriptMutationStarted, false, "route must not mutate primary transcript");
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
assert.equal(defaulted.usageAttributionRow.schema, SUB_AGENT_USAGE_ATTRIBUTION_ROW_SCHEMA, "numeric-string usage should produce attribution row");
assertNoRawPrompt(defaulted, defaultPrompt);

const unavailableUsageRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  nowMs: 0,
  providerTurnRunner: async () => ({
    ok: true,
    outputText: "Usage is intentionally unavailable for this child.",
  }),
});
const unavailableUsage = await unavailableUsageRoute.spawnAndRun({
  childAgentId: "usage_unavailable_child",
  prompt: "UNIQUE_USAGE_UNAVAILABLE_CHILD_PROMPT_34ad",
});
assert.equal(unavailableUsage.status, "completed", "usage-unavailable child should still complete");
assert.equal(unavailableUsage.usageAttributionRow, null, "missing token usage must not produce attribution row");
assert.equal(unavailableUsage.usageUnavailableRow.schema, SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA, "missing token usage should produce unavailable row");
assert.equal(unavailableUsage.usageUnavailableRow.reason, "provider_usage_not_exposed", "usage unavailable reason mismatch");

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
assert.equal(failed.resultEnvelope.resultKind, "agent_result", "failed exact terminal should still produce agent result envelope");
assert.equal(failed.contextAdmission.admissionDecision, "admit", "failed exact terminal summary should be admissible");
assert.equal(failed.usageUnavailableRow.schema, SUB_AGENT_USAGE_UNAVAILABLE_ROW_SCHEMA, "provider exception should record usage unavailable");
assertNoRawPrompt(failed, failedPrompt);

const timeoutRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  nowMs: 0,
  providerTurnRunner: async () => ({
    ok: false,
    terminalState: "timeout",
    errorCode: "provider_child_timeout",
  }),
});
const timeout = await timeoutRoute.spawnAndRun({
  childAgentId: "timeout_child",
  prompt: "UNIQUE_TIMEOUT_CHILD_PROMPT_e87d",
});
assert.equal(timeout.status, "timeout", "timeout terminal status should be preserved");
assert.equal(timeout.resultAdmissionEnvelope.terminalExact, true, "timeout should be an exact terminal state");
assert.equal(timeout.contextAdmission.admissionDecision, "admit", "timeout summary should be admitted as terminal evidence");
assert(timeout.eChannelSnapshot.residentSnapshot.rows.some((row) => row.subjectId === "timeout_child" && row.compactText.includes("timeout/blocked")), "timeout child should be visible in E-channel as timeout/blocked");
assertNoRawPrompt(timeout, "UNIQUE_TIMEOUT_CHILD_PROMPT_e87d");

const handoffRoute = createDirectProviderBackedSubAgentRoute({
  projectId: "project_provider_child_fixture",
  workThreadId: "work_thread_provider_child_fixture",
  primaryThreadId: "primary_provider_child_fixture",
  nowMs: 0,
  providerTurnRunner: async () => ({
    ok: false,
    terminalState: "handoff_unknown",
    outputText: "UNIQUE_HANDOFF_RAW_OUTPUT_SHOULD_NOT_APPEAR_55ac",
  }),
});
const handoff = await handoffRoute.spawnAndRun({
  childAgentId: "handoff_unknown_child",
  prompt: "UNIQUE_HANDOFF_CHILD_PROMPT_55ac",
});
assert.equal(handoff.status, "handoff_unknown", "handoff_unknown status should be preserved");
assert.equal(handoff.resultEnvelope.resultKind, "status", "handoff_unknown should emit status envelope only");
assert.equal(handoff.resultEnvelope.visibility.providerVisible, "not_seen", "handoff_unknown must not admit provider-visible result");
assert.equal(handoff.contextAdmission.admissionDecision, "do_not_admit", "handoff_unknown must not be context-admitted");
assert.equal(handoff.resultAdmissionEnvelope.terminalExact, false, "handoff_unknown terminal is not exact");
assert.equal(handoff.resultAdmissionEnvelope.admittedToParentContext, false, "handoff_unknown must not enter parent context");
assert(handoff.childResultDigest, "handoff_unknown should record a status-only child update");
assert(handoff.eChannelSnapshot.residentSnapshot.rows.some((row) => row.subjectId === "handoff_unknown_child" && row.compactText.includes("handoff_unknown/attention_required")), "handoff_unknown child should be visible in E-channel as status-only handoff");
assert(!JSON.stringify(handoff).includes("UNIQUE_HANDOFF_RAW_OUTPUT_SHOULD_NOT_APPEAR_55ac"), "handoff_unknown must not expose raw child output");
assertNoRawPrompt(handoff, "UNIQUE_HANDOFF_CHILD_PROMPT_55ac");

const serialized = JSON.stringify({ descriptor, blocked, liveDescriptor, completed, defaulted, unavailableUsage, duplicate, failed, timeout, handoff });
assert(!serialized.includes("UNIQUE_PROVIDER_CHILD_PROMPT_c6b7"), "serialized fixture must not contain successful raw prompt");
assert(!serialized.includes("UNIQUE_BLOCKED_CHILD_PROMPT_8f5a"), "serialized fixture must not contain blocked raw prompt");
assert(!serialized.includes("UNIQUE_FAILING_CHILD_PROMPT_ea22"), "serialized fixture must not contain failed raw prompt");
assert(!serialized.includes("UNIQUE_DEFAULTED_CHILD_PROMPT_916b"), "serialized fixture must not contain defaulted raw prompt");
assert(!serialized.includes("UNIQUE_USAGE_UNAVAILABLE_CHILD_PROMPT_34ad"), "serialized fixture must not contain usage-unavailable raw prompt");
assert(!serialized.includes("UNIQUE_TIMEOUT_CHILD_PROMPT_e87d"), "serialized fixture must not contain timeout raw prompt");
assert(!serialized.includes("UNIQUE_HANDOFF_CHILD_PROMPT_55ac"), "serialized fixture must not contain handoff raw prompt");
assert(!serialized.includes("\"providerDeclarationAllowed\":true"), "provider declaration must never be enabled");
assert(!serialized.includes("\"workspaceMutationStarted\":true"), "workspace mutation must never start");
assert(!serialized.includes("\"childTranscriptPromotionStarted\":true"), "child transcript promotion must never start");
assert(!serialized.includes("\"childOutputPromotedToPrimaryTranscript\":true"), "child output must not become primary transcript output");
assert(!serialized.includes("\"primaryTranscriptMutationStarted\":true"), "primary transcript mutation must not start");

console.log(JSON.stringify({
  ok: true,
  routeDigest: liveDescriptor.routeDigest,
  completedDigest: completed.resultDigest,
  failedDigest: failed.resultDigest,
  handoffDigest: handoff.resultDigest,
  runnerCalls: runnerCalls.length,
}, null, 2));
