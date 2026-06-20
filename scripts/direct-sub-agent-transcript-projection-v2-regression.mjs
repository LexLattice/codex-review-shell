#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA,
  buildSubAgentTranscriptProjectionV2,
  validateSubAgentTranscriptProjectionV2,
} = require("../src/main/direct/agents/sub-agent-transcript-projection-v2");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const fixedNow = () => Date.UTC(2026, 5, 20, 12, 0, 0);

const baseInput = {
  projectId: "project_wave16_pr98_fixture",
  workThreadId: "work_thread_wave16_pr98_fixture",
  parentThreadId: "primary_thread_wave16_pr98_fixture",
  parentAgentId: "primary_agent_wave16_pr98_fixture",
  parentAgentLabel: "Primary Codex",
  childAgentId: "agent_wave16_pr98_child",
  childAgentLabel: "Carver",
  childThreadId: "child_thread_wave16_pr98_fixture",
  sourceRefs: [
    { kind: "fixture", id: "wave16_pr98", label: "Wave 16 PR98 fixture" },
  ],
  items: [
    {
      itemId: "parent_prompt_a",
      parentTurnId: "parent_turn_a",
      childTurnId: "child_turn_a1",
      kind: "parent_prompt",
      role: "user",
      text: "Inspect the candidate source and return a bounded finding.",
      authorConfidence: "collab_tool_call",
      sourceRefs: [{ kind: "collab_tool_call", id: "call_prompt_a" }],
    },
    {
      itemId: "child_answer_a",
      parentTurnId: "parent_turn_a",
      childTurnId: "child_turn_a1",
      kind: "child_answer",
      role: "assistant",
      text: "The candidate source has one missing invariant and no patch was applied.",
      authorConfidence: "thread_metadata",
      sourceRefs: [{ kind: "child_thread_item", id: "item_answer_a" }],
    },
    {
      itemId: "child_tool_a",
      parentTurnId: "parent_turn_a",
      childTurnId: "child_turn_a1",
      kind: "tool",
      toolName: "read_file",
      text: "read_file completed",
      sourceRefs: [{ kind: "child_tool_call", id: "tool_read_a" }],
    },
    {
      itemId: "result_summary_a",
      parentTurnId: "parent_turn_a",
      childTurnId: "child_turn_a1",
      kind: "result_summary",
      resultSummary: true,
      text: "Sanitized child result: missing invariant identified.",
      sourceRefs: [{ kind: "result_admission", id: "result_a" }],
    },
    {
      itemId: "parent_prompt_b",
      parentTurnId: "parent_turn_b",
      childTurnId: "child_turn_b1",
      kind: "parent_prompt",
      role: "user",
      text: "Continue with the next bounded check.",
      authorConfidence: "collab_tool_call",
      sourceRefs: [{ kind: "collab_tool_call", id: "call_prompt_b" }],
    },
    {
      itemId: "child_answer_b",
      parentTurnId: "parent_turn_b",
      childTurnId: "child_turn_b1",
      kind: "child_answer",
      role: "assistant",
      text: "The second check is clean.",
      authorConfidence: "thread_metadata",
      sourceRefs: [{ kind: "child_thread_item", id: "item_answer_b" }],
    },
  ],
};

const turnActivity = buildSubAgentTranscriptProjectionV2({
  ...baseInput,
  mode: "turn_activity",
  parentTurnId: "parent_turn_a",
}, { now: fixedNow });

assert.equal(turnActivity.schema, SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA, "schema mismatch");
validateSubAgentTranscriptProjectionV2(turnActivity);
assert.equal(turnActivity.mode, "turn_activity", "mode mismatch");
assert.equal(turnActivity.rows.length, 4, "turn_activity should include only parent_turn_a rows");
assert(turnActivity.rows.every((row) => row.parentTurnId === "parent_turn_a"), "turn_activity leaked another parent turn");
assert.equal(turnActivity.visibility.primaryTranscriptVisible, "activity_summary_only", "turn activity should expose only primary summary link");
assert.equal(turnActivity.visibility.residentContextVisible, "summary_only", "turn activity should allow summary only");
assert.equal(turnActivity.primaryTranscriptSummary.rawChildTranscriptIncluded, false, "primary summary must not include child transcript");
assert.equal(turnActivity.primaryTranscriptMutationStarted, false, "projection must not mutate primary transcript");
assert.equal(turnActivity.childTranscriptFlattened, false, "child transcript must not flatten");
assert.equal(turnActivity.rows.find((row) => row.rowId === "parent_prompt_a").author.kind, "parent_agent", "parent prompt must not render as operator");
assert.equal(turnActivity.rows.find((row) => row.rowId === "parent_prompt_a").author.displayLabel, "Primary Codex", "parent prompt label mismatch");
assert.equal(turnActivity.rows.find((row) => row.rowId === "child_answer_a").author.kind, "child_agent", "child answer must not render as primary");
assert.equal(turnActivity.rows.find((row) => row.rowId === "child_answer_a").author.displayLabel, "Carver", "child label mismatch");

const fullPageOne = buildSubAgentTranscriptProjectionV2({
  ...baseInput,
  mode: "full_child_history",
  limit: 2,
}, { now: fixedNow });

validateSubAgentTranscriptProjectionV2(fullPageOne);
assert.equal(fullPageOne.mode, "full_child_history", "full history mode mismatch");
assert.equal(fullPageOne.rows.length, 2, "full history page should respect limit");
assert.equal(fullPageOne.hasMore, true, "full history should indicate more rows");
assert.equal(fullPageOne.nextCursor, "offset:2", "full history next cursor mismatch");
assert.equal(fullPageOne.visibility.residentContextVisible, "none", "full history must be projection-only");
assert.equal(fullPageOne.visibility.primaryTranscriptVisible, "none", "full history must not enter primary transcript");
assert.equal(fullPageOne.contextAdmissionWritten, false, "full history must not write context admission");
assert.equal(fullPageOne.primaryTranscriptSummary, undefined, "full history must not create primary transcript summary");

const fullPageTwo = buildSubAgentTranscriptProjectionV2({
  ...baseInput,
  mode: "full_child_history",
  cursor: fullPageOne.nextCursor,
  limit: 2,
}, { now: fixedNow });

validateSubAgentTranscriptProjectionV2(fullPageTwo);
assert.equal(fullPageTwo.cursor, "offset:2", "cursor should be preserved");
assert.equal(fullPageTwo.rows[0].rowId, "child_tool_a", "second page should start at third item");
assert.equal(fullPageTwo.hasMore, true, "second page should still have more rows");

const resultSummary = buildSubAgentTranscriptProjectionV2({
  ...baseInput,
  mode: "result_summary",
}, { now: fixedNow });

validateSubAgentTranscriptProjectionV2(resultSummary);
assert.equal(resultSummary.rows.length, 1, "result summary should include only admitted result summary rows");
assert.equal(resultSummary.rows[0].rowKind, "result_summary", "result row kind mismatch");
assert.equal(resultSummary.visibility.providerVisible, "summary_only", "result summary provider visibility mismatch");
assert.equal(resultSummary.visibility.residentContextVisible, "summary_only", "result summary context posture mismatch");

const humanChildPrompt = buildSubAgentTranscriptProjectionV2({
  ...baseInput,
  mode: "turn_activity",
  parentTurnId: "parent_turn_human",
  items: [
    {
      itemId: "human_child_prompt",
      parentTurnId: "parent_turn_human",
      kind: "parent_prompt",
      role: "user",
      text: "Human-authored direct child message.",
      humanAuthored: true,
    },
  ],
}, { now: fixedNow });
validateSubAgentTranscriptProjectionV2(humanChildPrompt);
assert.equal(humanChildPrompt.rows[0].author.kind, "operator", "human-authored child message may render as operator");

{
  const malformed = clone(fullPageOne);
  malformed.visibility.residentContextVisible = "summary_only";
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "full_history_context_admission_leak");
}
{
  const malformed = clone(fullPageOne);
  malformed.primaryTranscriptSummary = { rawChildTranscriptIncluded: false };
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "full_history_primary_summary_leak");
}
{
  const malformed = clone(turnActivity);
  malformed.rawProviderPayloadIncluded = true;
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "projection_boundary_leak:rawProviderPayloadIncluded");
}
{
  const malformed = clone(turnActivity);
  malformed.rows.find((row) => row.rowId === "parent_prompt_a").author.kind = "operator";
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "child_user_rendered_as_operator:parent_prompt_a");
}
{
  const malformed = clone(turnActivity);
  malformed.rows.find((row) => row.rowId === "child_answer_a").author.kind = "primary_agent";
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "child_agent_rendered_as_primary:child_answer_a");
}
{
  const malformed = clone(turnActivity);
  malformed.rows[0].rawPromptPayloadIncluded = true;
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "row_boundary_leak:rawPromptPayloadIncluded:parent_prompt_a");
}
{
  const malformed = clone(fullPageOne);
  delete malformed.nextCursor;
  expectThrows(() => validateSubAgentTranscriptProjectionV2(malformed), "pagination_missing_next_cursor");
}

const serialized = JSON.stringify({
  turnActivity,
  fullPageOne,
  fullPageTwo,
  resultSummary,
});
assert(!serialized.includes("\"childTranscriptFlattened\":true"), "flattening sentinel leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload sentinel leak");
assert(!serialized.includes("\"rawHiddenPromptIncluded\":true"), "raw hidden prompt sentinel leak");
assert(!serialized.includes("\"rawChildTranscriptIncludedInPrimary\":true"), "raw child transcript primary leak");
assert(!serialized.includes("\"primaryTranscriptMutationStarted\":true"), "primary transcript mutation leak");

console.log(JSON.stringify({
  ok: true,
  projectionIds: [
    turnActivity.projectionId,
    fullPageOne.projectionId,
    resultSummary.projectionId,
  ],
  turnActivityRows: turnActivity.rows.length,
  fullHistoryRowsPageOne: fullPageOne.rows.length,
  fullHistoryNextCursor: fullPageOne.nextCursor,
  resultSummaryRows: resultSummary.rows.length,
}, null, 2));
