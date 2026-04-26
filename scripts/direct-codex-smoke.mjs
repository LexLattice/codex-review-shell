import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { buildImportCandidate } = require("../src/main/direct/import/codex-jsonl-import");
const { redactFixture, assertFixtureRedacted } = require("../src/main/direct/fixtures/redaction");
const { normalizeDirectCodexEvents, parseSseFixtureText } = require("../src/main/direct/normalizer/codex-event-normalizer");
const { buildFixtureProfileDelta } = require("../src/main/direct/odeu-profile/profile-delta-builder");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader");
const { buildDirectCodexProfileReport } = require("../src/main/direct/odeu-profile/profile-report");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const profileDoc = loadDirectCodexProfile();
assert(profileDoc.profile.source === "imported-baseline", "Expected imported conceptual baseline profile.");
assert(profileDoc.capabilityIndex.get("direct_backend_endpoint")?.status === "observed", "Expected direct endpoint to remain observed.");
assert(profileDoc.capabilityIndex.get("consumer_chatgpt_thread_programmatic_control")?.status === "rejected", "Expected consumer web-thread automation to be rejected.");

const secretFixture = {
  headers: {
    authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhY2N0XzEyMyJ9.signature123456789",
    cookie: "oai-did=private-cookie",
  },
  auth_code: "code_very_private_authorization_code",
  account_id: "acct_private_account",
  cwd: "/home/rose/work/private-project",
};
const redacted = redactFixture(secretFixture);
assertFixtureRedacted(redacted);

const sampleEvents = [
  { event: "response.created", data: { response: { id: "resp_1", model: "gpt-5.4" } } },
  { event: "response.output_text.delta", data: { item_id: "msg_1", delta: "hello" } },
  { event: "response.reasoning_summary_text.delta", data: { item_id: "rs_1", delta: "summary" } },
  {
    event: "response.output_item.added",
    data: { item: { id: "tool_1", type: "function_call", call_id: "call_1", name: "read_file" } },
  },
  {
    event: "response.function_call_arguments.delta",
    data: { item_id: "tool_1", call_id: "call_1", delta: "{\"path\"" },
  },
  {
    event: "response.output_item.done",
    data: {
      item: {
        id: "tool_1",
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: "{\"path\":\"README.md\"}",
      },
    },
  },
  {
    event: "response.completed",
    data: {
      response: {
        id: "resp_1",
        status: "completed",
        usage: {
          input_tokens: 7,
          output_tokens: 11,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      },
    },
  },
];

const normalized = normalizeDirectCodexEvents(sampleEvents, { failOnUnknown: true });
const normalizedTypes = normalized.normalized.map((event) => event.type);
for (const required of [
  "session_started",
  "message_delta",
  "reasoning_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "usage_delta",
  "response_completed",
]) {
  assert(normalizedTypes.includes(required), `Missing normalized event type ${required}.`);
}

const sseEvents = parseSseFixtureText([
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_2\",\"delta\":\"ok\"}",
  "",
  "data: [DONE]",
  "",
].join("\n"));
assert(sseEvents.length === 2, "Expected two parsed SSE frames.");
assert(sseEvents[0].event === "response.output_text.delta", "Expected SSE event type to be retained.");
const strictSseNormalized = normalizeDirectCodexEvents(sseEvents, { failOnUnknown: true });
assert(strictSseNormalized.normalized.length === 1, "Expected strict SSE normalization to ignore [DONE].");

const failedResponse = normalizeDirectCodexEvents([
  { event: "response.failed", data: { response: { id: "resp_failed", error: { code: "server_error", message: "failed" } } } },
]);
assert(failedResponse.normalized[0].type === "response_failed", "Expected response.failed to normalize as response_failed.");

const delta = buildFixtureProfileDelta({
  fixtureId: "inline/plain-tool-turn",
  normalizedEvents: normalized.normalized,
  unknownRawTypes: normalized.unknown.map((event) => event.rawType),
});
assert(delta.acceptance === "candidate", "Expected fixture profile delta to be a candidate.");
assert(delta.normalizedEventCounts.message_delta === 1, "Expected message delta count.");

const importCandidate = buildImportCandidate([
  { timestamp: "2026-04-25T10:00:00Z", thread_id: "thread_1", message: { role: "user", content: "Inspect this." } },
  { timestamp: "2026-04-25T10:00:02Z", type: "tool_call_started", item: { type: "function_call" } },
]);
assert(importCandidate.target.runnable === false, "Imported Codex JSONL must remain non-runnable.");
assert(importCandidate.unresolvedObligations.length === 1, "Expected unpaired tool obligation.");

const report = buildDirectCodexProfileReport({
  profileDoc,
  profileDeltas: [delta],
  fixtureSummaries: [{ id: "inline/plain-tool-turn", recordCount: sampleEvents.length, redactionStatus: "passed" }],
});
assert(report.includes("imported GPTPro conceptual baseline"), "Expected report to identify the conceptual baseline.");
assert(report.includes("inline/plain-tool-turn"), "Expected report to include fixture delta evidence.");

console.log("Direct Codex profile harness smoke passed.");
