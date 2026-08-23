#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
} = require("../src/main/direct/agents/sub-agent-capability-profile");
const {
  RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA,
  buildResidentSubAgentToolDeclaration,
  validateResidentSubAgentToolDeclaration,
} = require("../src/main/direct/agents/sub-agent-resident-declaration");

const fixedNow = () => Date.UTC(2026, 5, 20, 9, 0, 0);

const declaration = await buildResidentSubAgentToolDeclaration({
  projectId: "project_wave15_pr95_fixture",
  workThreadId: "work_thread_wave15_pr95_fixture",
  primaryThreadId: "primary_thread_wave15_pr95_fixture",
  declarationId: "resident_sub_agent_tool_declaration_wave15_pr95_fixture",
}, { now: fixedNow, nowMs: fixedNow() });

assert.equal(declaration.schema, RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA, "resident declaration schema mismatch");
assert.deepEqual(declaration.firstSliceTools, [...RESIDENT_FIRST_SLICE_TOOLS], "first slice tools mismatch");
assert.deepEqual(declaration.blockedControls, [...DEFERRED_SUB_AGENT_CONTROLS], "blocked controls mismatch");
validateResidentSubAgentToolDeclaration(declaration);

assert.equal(declaration.declarationSlice.status, "passed", "declaration slice should pass");
assert.equal(declaration.declarationSlice.declarationCount, RESIDENT_FIRST_SLICE_TOOLS.length, "only first-slice tools should be declared");
assert.deepEqual(declaration.declarationSlice.summary.declaredToolNames, [...RESIDENT_FIRST_SLICE_TOOLS], "declared tool names mismatch");
assert.equal(declaration.declarationSlice.providerRequestPatch.parallel_tool_calls, false, "sub-agent declarations must disable parallel tool calls");
assert.equal(declaration.declarationSlice.providerRequestPatch.tools.length, RESIDENT_FIRST_SLICE_TOOLS.length, "provider tool count mismatch");

const declaredNames = new Set(declaration.declarationSlice.declarations.map((row) => row.toolName));
for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
  assert(declaredNames.has(toolName), `first-slice tool should be declared: ${toolName}`);
  const snapshot = declaration.declarationSnapshots.find((row) => row.familyExtension?.toolName === toolName);
  assert(snapshot, `declaration snapshot missing: ${toolName}`);
  assert.equal(snapshot.providerDeclared, true, `snapshot should be provider-declared: ${toolName}`);
  assert.equal(snapshot.modelCallable, true, `snapshot should be model-callable: ${toolName}`);
  assert.equal(snapshot.familyExtension.childToolsAllowed, false, `child tools must remain disabled: ${toolName}`);
  assert.equal(snapshot.familyExtension.recursiveSpawnAllowed, false, `recursive spawn must remain disabled: ${toolName}`);
}
const spawnDeclaration = declaration.declarationSlice.declarations.find((row) => row.toolName === "spawn_agent");
const spawnParameters = spawnDeclaration.providerToolSchema.parameters;
assert.deepEqual(spawnParameters.required, ["task"], "spawn_agent schema should require task, not model-supplied child identity");
assert(spawnParameters.properties.task, "spawn_agent schema should expose task");
assert(spawnParameters.properties.agentRole, "spawn_agent schema should expose agentRole");
assert.deepEqual(spawnParameters.properties.provider.enum, ["chatgpt-direct", "openrouter-oxalpha", "opencode-oxalpha"], "spawn_agent schema should expose governed provider choices");
assert(spawnParameters.properties.model, "spawn_agent schema should expose model");
assert(spawnParameters.properties.reasoningEffort, "spawn_agent schema should expose reasoningEffort");
assert(spawnParameters.properties.idempotencyKey, "spawn_agent schema should expose idempotencyKey");
assert(!spawnParameters.properties.childAgentId, "spawn_agent schema must not require model-supplied childAgentId");
assert(!spawnParameters.properties.prompt, "spawn_agent schema should use task instead of prompt");
for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
  assert(!declaredNames.has(toolName), `deferred control must not be declared: ${toolName}`);
}

const catalogRowsByTool = new Map(declaration.catalog.rows.map((row) => [row.extensions?.toolName || row.subjectId, row]));
for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
  const row = catalogRowsByTool.get(toolName);
  assert(row, `resident epistemic row missing: ${toolName}`);
  assert.equal(row.status, "callable_now", `first-slice tool should be callable now: ${toolName}`);
  assert.equal(row.declaredAsProviderTool, true, `first-slice row should cite provider declaration: ${toolName}`);
  assert.equal(row.callableInCurrentRequest, true, `first-slice row should be callable in current request: ${toolName}`);
  assert.equal(row.perCallAuthorityRequired, true, `first-slice row should require per-call authority: ${toolName}`);
}
for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
  const row = catalogRowsByTool.get(toolName);
  assert(row, `blocked resident row missing: ${toolName}`);
  assert(row.status === "known_disabled" || row.status.startsWith("blocked_"), `deferred control should be disabled or blocked: ${toolName}`);
  assert.equal(row.declaredAsProviderTool, false, `deferred control must not be provider-declared: ${toolName}`);
  assert.equal(row.callableInCurrentRequest, false, `deferred control must not be callable: ${toolName}`);
}

assert.equal(declaration.usabilityProof.usableFor, "resident_callable", "proof should be resident-callable");
assert.equal(declaration.usabilityProof.proofEvidence.deterministicChecksPassed, true, "deterministic proof should pass");
assert.equal(declaration.usabilityProof.proofEvidence.modelSelfReportSmokePassed, true, "self-report smoke should be recorded");
assert.equal(declaration.usabilityProof.proofEvidence.selfReportIsSupplemental, true, "self-report must be supplemental");
assert.equal(declaration.usabilityProof.resultEnvelopeId, declaration.routeSmoke.resultEnvelopeId, "proof should cite route result envelope");
assert.equal(declaration.usabilityProof.contextAdmissionId, declaration.routeSmoke.contextAdmissionId, "proof should cite context admission");
assert.equal(declaration.witnessRows.length, RESIDENT_FIRST_SLICE_TOOLS.length, "witness row count mismatch");
for (const row of declaration.witnessRows) {
  assert.equal(row.residentCallable, true, "witness should be resident-callable");
  assert.equal(row.operatorCallable, false, "operator controls are not expanded in PR95");
  assert.equal(row.status, "callable_now", "witness status should be callable_now");
  assert.equal(row.usabilityProofId, declaration.usabilityProof.proofId, "witness should cite usability proof");
}

assert.equal(declaration.routeSmoke.status, "completed", "positive smoke should complete");
assert.equal(declaration.routeSmoke.requestShape.toolCount, 0, "child request must receive no tools");
assert.equal(declaration.routeSmoke.requestShape.parallelToolCalls, false, "child request must disable parallel tool calls");
assert.equal(declaration.routeSmoke.childOutputPromotedToPrimaryTranscript, false, "child output must not become primary transcript output");
assert.equal(declaration.routeSmoke.primaryTranscriptMutationStarted, false, "route must not mutate primary transcript");
assert.equal(declaration.routeSmoke.rawChildPromptIncluded, false, "raw child prompt must not be admitted");
assert.equal(declaration.routeSmoke.rawChildTranscriptIncluded, false, "raw child transcript must not be admitted");
assert.equal(declaration.routeSmoke.rawProviderPayloadIncluded, false, "raw provider payload must not be admitted");
assert.equal(declaration.negativeSmoke.recursiveSpawnBlockedByChildToolsDisabled, true, "recursive spawn should block because child tools are disabled");
assert.equal(declaration.negativeSmoke.sendFollowupCloseInterruptResumeBlocked, true, "interference and lifecycle controls should block");
assert.equal(declaration.negativeSmoke.selfReportIsSupplementalOnly, true, "self-report negative smoke should remain supplemental");
assert(declaration.negativeSmoke.undeclaredControls.every((row) => row.blocked && !row.declaredAsProviderTool && !row.callableInCurrentRequest), "all undeclared controls must stay blocked");

const serialized = JSON.stringify(declaration);
assert(!serialized.includes("PR95 fixture prompt"), "declaration must not contain raw fixture prompt");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt flag leak");
assert(!serialized.includes("\"rawResultIncluded\":true"), "raw result flag leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload flag leak");
assert(!serialized.includes("\"rawSecretIncluded\":true"), "raw secret flag leak");
assert(!serialized.includes("\"childOutputPromotedToPrimaryTranscript\":true"), "child output promotion leak");
assert(!serialized.includes("\"primaryTranscriptMutationStarted\":true"), "primary transcript mutation leak");

console.log(JSON.stringify({
  ok: true,
  declarationId: declaration.declarationId,
  declarationDigest: declaration.declarationDigest,
  callableTools: declaration.catalog.preview.callableToolIds,
  blockedControls: declaration.negativeSmoke.undeclaredControls.map((row) => row.toolName),
  proofId: declaration.usabilityProof.proofId,
}, null, 2));
