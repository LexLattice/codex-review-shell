#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
} = require("../src/main/direct/agents/sub-agent-capability-profile");
const {
  buildResidentSubAgentToolDeclaration,
} = require("../src/main/direct/agents/sub-agent-resident-declaration");
const {
  RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA,
  buildResidentSubAgentOperatorProjection,
  validateResidentSubAgentOperatorProjection,
} = require("../src/main/direct/agents/sub-agent-operator-projection");

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const fixedNow = () => Date.UTC(2026, 5, 20, 10, 0, 0);

expectThrows(() => buildResidentSubAgentOperatorProjection({}, { now: fixedNow }), "requires_pr95_declaration");

const declaration = await buildResidentSubAgentToolDeclaration({
  projectId: "project_wave15_pr96_fixture",
  workThreadId: "work_thread_wave15_pr96_fixture",
  primaryThreadId: "primary_thread_wave15_pr96_fixture",
  declarationId: "resident_sub_agent_tool_declaration_wave15_pr96_fixture",
}, { now: fixedNow, nowMs: fixedNow() });

const projection = buildResidentSubAgentOperatorProjection({
  projectionId: "resident_sub_agent_operator_projection_wave15_pr96_fixture",
  declaration,
}, { now: fixedNow, nowMs: fixedNow() });

assert.equal(projection.schema, RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA, "operator projection schema mismatch");
assert.equal(projection.sourceDeclarationId, declaration.declarationId, "projection should cite source declaration");
assert.equal(projection.sourceDeclarationDigest, declaration.declarationDigest, "projection should cite declaration digest");
assert.equal(projection.sourceUsabilityProofId, declaration.usabilityProof.proofId, "projection should cite usability proof");
assert.equal(projection.proofPosture.readsProofArtifacts, true, "operator projection should read proof artifacts");
assert.equal(projection.proofPosture.mintsProof, false, "operator projection must not mint proof");
validateResidentSubAgentOperatorProjection(projection);

assert.equal(projection.primaryTranscriptActivitySummary.rowCount, 2, "primary transcript summary row count mismatch");
assert.equal(projection.primaryTranscriptActivitySummary.childTranscriptFlattened, false, "summary must not flatten child transcript");
assert.equal(projection.primaryTranscriptActivitySummary.childOutputPromotedToPrimaryTranscript, false, "summary must not promote child output");
assert(projection.primaryTranscriptActivitySummary.rows.every((row) => row.primaryTranscriptBubbleKind === "sub_agent_activity_summary"), "summary rows should be activity summaries");
assert(projection.primaryTranscriptActivitySummary.rows.some((row) => row.eventKind === "sub_agent_result_admitted"), "summary should include result admission row");

assert.equal(projection.operatorWitnessRows.length, RESIDENT_FIRST_SLICE_TOOLS.length, "operator witness row count mismatch");
for (const row of projection.operatorWitnessRows) {
  assert.equal(row.operatorVisible, true, "operator witness should be visible");
  assert.equal(row.operatorCallable, false, "operator witness must not be callable");
  assert.equal(row.residentCallable, true, "resident callable witness should remain visible");
  assert.equal(row.usabilityProofId, declaration.usabilityProof.proofId, "operator witness should cite proof");
}

const statusRows = new Map(projection.operatorStatusRows.map((row) => [row.toolName, row]));
for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
  const row = statusRows.get(toolName);
  assert(row, `status row missing for ${toolName}`);
  assert.equal(row.operatorCallable, false, `operator must not call ${toolName}`);
  assert.equal(row.residentCallable, true, `resident should see ${toolName} callable`);
  assert.equal(row.proofId, declaration.usabilityProof.proofId, `status row should cite proof for ${toolName}`);
}
for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
  const row = statusRows.get(toolName);
  assert(row, `blocked status row missing for ${toolName}`);
  assert.equal(row.operatorCallable, false, `operator must not call blocked control ${toolName}`);
  assert.equal(row.residentCallable, false, `resident must not call blocked control ${toolName}`);
  assert.equal(row.proofId, "", `blocked control should not cite callable proof ${toolName}`);
}

assert.equal(projection.manualUsabilityGate.gateState, "passed", "manual gate should pass");
assert.equal(projection.manualUsabilityGate.counts.requiredBlockedCount, 0, "manual gate should have no required blockers");
assert.equal(projection.manualUsabilityGate.rows.length, 6, "manual gate row count mismatch");
assert(projection.manualUsabilityGate.rows.some((row) => row.checkKind === "result_admission" && row.state === "passed"), "manual gate should cover result admission");
const resultAdmissionGateRow = projection.manualUsabilityGate.rows.find((row) => row.checkKind === "result_admission");
assert(resultAdmissionGateRow.evidenceRefs.some((ref) => ref.kind === "result_admission_envelope" && ref.id), "manual gate should cite result admission envelope");
for (const value of Object.values(projection.manualUsabilityGate.sentinelCounters)) {
  assert.equal(value, 0, "manual gate sentinel counters should remain zero");
}

assert.equal(projection.analyticsHook.usageAttributionAvailable, true, "analytics hook should expose child usage attribution availability");
assert.equal(projection.analyticsHook.usageAttribution, "agent_thread", "analytics hook should keep child usage attribution");
assert.equal(projection.analyticsHook.parentUsageMerged, false, "child usage must not merge into parent usage");
assert.equal(projection.analyticsHook.tokenUsage.totalTokens, 42, "analytics hook should preserve provider token usage summary");
assert.equal(projection.subAgentsPanelCompatibility.fullChildTranscriptViewIntroduced, false, "PR96 must not introduce full child transcript UX");

for (const flag of Object.values(projection.operatorProjectionAuthority)) {
  assert.equal(flag, false, "operator projection authority flags should all be false");
}
const serialized = JSON.stringify(projection);
assert(!serialized.includes("\"operatorCallable\":true"), "operator projection must not expose callable operator controls");
assert(!serialized.includes("\"childTranscriptFlattened\":true"), "operator projection must not flatten child transcript");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt flag leak");
assert(!serialized.includes("\"rawResultIncluded\":true"), "raw result flag leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload flag leak");
assert(!serialized.includes("PR95 fixture prompt"), "raw child prompt text must not leak through projection");

expectThrows(() => validateResidentSubAgentOperatorProjection({
  ...projection,
  proofPosture: { ...projection.proofPosture, mintsProof: true },
}), "operator_projection_must_read_not_mint_proof");
expectThrows(() => validateResidentSubAgentOperatorProjection({
  ...projection,
  operatorProjectionAuthority: { ...projection.operatorProjectionAuthority, sendsFollowup: true },
}), "operator_projection_authority_leak:sendsFollowup");
expectThrows(() => validateResidentSubAgentOperatorProjection({
  ...projection,
  primaryThreadId: "",
}), "missing_required_string:primaryThreadId");
expectThrows(() => validateResidentSubAgentOperatorProjection({
  ...projection,
  sourceCatalogDigest: "",
}), "missing_required_string:sourceCatalogDigest");
{
  const malformed = clone(projection);
  malformed.manualUsabilityGate.rows[0].state = "blocked";
  expectThrows(() => validateResidentSubAgentOperatorProjection(malformed), "manual_gate_required_check_not_passed:spawn_agent");
}
{
  const malformed = clone(projection);
  malformed.manualUsabilityGate.counts.rowCount = 0;
  expectThrows(() => validateResidentSubAgentOperatorProjection(malformed), "manual_gate_row_count_mismatch");
}
{
  const malformed = clone(projection);
  malformed.primaryTranscriptActivitySummary.rawChildPromptIncluded = true;
  expectThrows(() => validateResidentSubAgentOperatorProjection(malformed), "primary_transcript_summary_raw_exposure_flag:rawChildPromptIncluded");
}
{
  const malformed = clone(projection);
  malformed.analyticsHook.rawProviderPayloadIncluded = true;
  expectThrows(() => validateResidentSubAgentOperatorProjection(malformed), "analytics_hook_raw_exposure_flag:rawProviderPayloadIncluded");
}

console.log(JSON.stringify({
  ok: true,
  projectionId: projection.projectionId,
  projectionDigest: projection.projectionDigest,
  manualGateState: projection.manualUsabilityGate.gateState,
  activityRows: projection.primaryTranscriptActivitySummary.rowCount,
  analyticsUsageAttributionId: projection.analyticsHook.usageAttributionId,
}, null, 2));
