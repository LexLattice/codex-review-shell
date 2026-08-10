#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA,
  buildHumanControlWave17UsabilityGate,
  validateHumanControlWave17UsabilityGate,
} = require("../src/main/direct/tools/human-control-wave17-usability-gate");

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

const nowMs = Date.UTC(2026, 5, 20, 18, 40, 0);
const proof = buildHumanControlWave17UsabilityGate({
  projectId: "project_wave17_gate_fixture",
  workThreadId: "work_thread_wave17_gate_fixture",
  threadId: "thread_wave17_gate_fixture",
  turnId: "turn_wave17_gate_fixture",
}, { nowMs });

assert.equal(proof.schema, HUMAN_CONTROL_WAVE17_USABILITY_PROOF_SCHEMA, "proof schema mismatch");
validateHumanControlWave17UsabilityGate(proof);
assert.equal(proof.status, "pass", "Wave 17 proof should pass");

const declared = new Set(proof.firstToolSlice.summary.declaredToolNames);
for (const required of ["get_context_remaining", "update_plan", "request_user_input", "request_permissions", "view_image"]) {
  assert(declared.has(required), `missing first-slice declaration: ${required}`);
}
assert(!declared.has("new_context"), "new_context must not be declared");

assert.equal(proof.contextEnvelope.providerOutput.usableFor, "display_only", "context should be display-only");
assert.equal(proof.contextEnvelope.providerOutput.permissionToContinue, false, "context must not authorize continuation");
assert.equal(proof.contextEnvelope.providerOutput.compactionAuthority, false, "context must not authorize compaction");

assert.equal(proof.planEnvelope.providerOutput.provesCompletion, false, "plan update must not prove completion");
assert.equal(proof.planEnvelope.providerOutput.mutatesWorkThreadTruth, false, "plan update must not mutate WorkThread truth");
assert.equal(proof.planEnvelope.providerOutput.mutatesProjectTruth, false, "plan update must not mutate project truth");

assert.equal(proof.userInputEnvelope.providerOutput.authorityGranted, false, "request_user_input must not grant authority");
assert.equal(proof.userInputAnswerEnvelope.providerOutput.authorityGranted, false, "user answer must not grant authority");
assert.equal(proof.userInputAnswerEnvelope.providerOutput.freeTextAdmittedAs, "context_only", "free text should remain context-only");

assert.equal(proof.permissionEnvelope.status, "operator_confirmation_required", "single action request should require operator confirmation");
assert.equal(proof.permissionEnvelope.providerOutput.permissionGranted, false, "request_permissions must not grant permission");
assert.equal(proof.permissionEnvelope.permissionDecision.grantApplied, false, "permission decision scaffold must not apply grant");
assert.equal(proof.broadPermissionEnvelope.status, "blocked", "broad permission should be blocked");
assert(proof.broadPermissionEnvelope.blockerCodes.some((code) => code.includes("permission_widening_scope_blocked:project")), "broad permission blocker missing");

assert.equal(proof.viewImageEnvelope.status, "ready_for_provider_continuation", "metadata-only image projection should be continuation-ready");
assert.equal(proof.viewImageEnvelope.providerOutput.modelSawPixels, false, "view_image must not claim model saw pixels");
assert.equal(proof.viewImageEnvelope.providerOutput.imagePayloadSent, false, "view_image must not send image payload");
assert.equal(proof.imagePayloadEnvelope.status, "blocked", "provider image payload request should be blocked");
assert(proof.imagePayloadEnvelope.blockerCodes.includes("image:provider_image_payload_unsupported"), "image payload blocker missing");
assert.equal(proof.spoofedSvgEnvelope.status, "blocked", "spoofed SVG should be blocked");
assert(proof.spoofedSvgEnvelope.blockerCodes.includes("image:image_active_content_blocked"), "spoofed SVG blocker missing");

assert.equal(proof.newContextGate.status, "blocked", "new_context should be undeclared and blocked");
assert(proof.newContextGate.blockerCodes.includes("tool_not_declared:new_context"), "new_context undeclared blocker missing");

const scenarioIds = new Set(proof.scenarioSuite.scenarios.map((row) => row.scenarioId));
for (const required of [
  "context_unknown_safe_display",
  "plan_projection_completion_non_authoritative",
  "bounded_human_decision_non_authoritative",
  "permission_single_action_request_only",
  "image_metadata_projection_only",
  "new_context_known_disabled_visible",
]) {
  assert(scenarioIds.has(required), `missing scenario: ${required}`);
}
assert.equal(proof.scenarioSuite.failCount, 0, "scenario suite should pass");

const negativeIds = new Set(proof.negativeScenarioMatrix.rows.map((row) => row.rowId));
for (const required of [
  "unknown_context_not_request_blocking",
  "plan_completion_claim_not_truth",
  "free_text_authority_blocked",
  "broad_permission_blocked",
  "unsupported_image_payload_blocked",
  "spoofed_svg_blocked",
  "undeclared_new_context_blocked",
]) {
  assert(negativeIds.has(required), `missing negative row: ${required}`);
}
for (const row of proof.negativeScenarioMatrix.rows) {
  assert.equal(row.status, "pass", `negative row should pass: ${row.rowId}`);
  assert.equal(row.providerTransportStarted, false, `negative row started provider transport: ${row.rowId}`);
  assert.equal(row.providerDeclarationStarted, false, `negative row started provider declaration: ${row.rowId}`);
  assert.equal(row.permissionGrantStarted, false, `negative row granted permission: ${row.rowId}`);
}

const witnessByTool = new Map(proof.capabilityWitnessRows.map((row) => [row.toolName, row]));
assert.equal(witnessByTool.get("get_context_remaining").capabilityState, "callable_now");
assert.equal(witnessByTool.get("update_plan").capabilityState, "callable_now");
assert.equal(witnessByTool.get("request_user_input").capabilityState, "callable_now");
assert.equal(witnessByTool.get("request_permissions").capabilityState, "guarded_request");
assert.equal(witnessByTool.get("view_image").capabilityState, "guarded_request");
assert.equal(witnessByTool.get("new_context").capabilityState, "known_disabled");
assert.equal(witnessByTool.get("new_context").residentCallable, false, "known-disabled tool must not be callable");
for (const toolName of ["get_context_remaining", "update_plan", "request_user_input", "request_permissions", "view_image"]) {
  const witness = witnessByTool.get(toolName);
  assert.equal(witness.providerDeclared, true, `${toolName} witness should cite provider declaration posture`);
  assert.equal(witness.modelCallable, true, `${toolName} witness should cite model-callable posture`);
  assert(witness.evidenceRefs.some((ref) => ref.kind === "direct_first_tool_slice"), `${toolName} witness should cite first tool slice`);
  assert(witness.evidenceRefs.some((ref) => ref.kind === "direct_first_tool_declaration_row"), `${toolName} witness should cite declaration row`);
}

for (const row of proof.manualGateRows) {
  assert.equal(row.status, "pass", `manual gate row failed: ${row.gateId}`);
}
assert.equal(proof.operatorProjection.readsProofArtifacts, true, "operator projection should read proof");
assert.equal(proof.operatorProjection.mintsProof, false, "operator projection must not mint proof");
assert.equal(proof.operatorProjection.grantsAuthority, false, "operator projection must not grant authority");

const serialized = JSON.stringify(proof);
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt leak");
assert(!serialized.includes("\"rawImageBytesIncluded\":true"), "raw image bytes leak");
assert(!serialized.includes("\"rawPathIncluded\":true"), "raw path leak");
assert(!serialized.includes("\"providerDeclarationOutsideFirstSlice\":true"), "provider declaration boundary leak");
assert(!serialized.includes("\"permissionGrantStarted\":true"), "permission grant leak");
assert(!serialized.includes("\"wave18ExternalDiscoveryToolsStarted\":true"), "Wave 18 scope leak");
assert(!serialized.includes("\"wave19ProviderHostedToolsStarted\":true"), "Wave 19 scope leak");
assert(!serialized.includes("\"wave20NewContextExecutionStarted\":true"), "Wave 20 scope leak");

{
  const malformed = clone(proof);
  malformed.operatorProjection.mintsProof = true;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "operator_projection_authority_leak");
}
{
  const malformed = clone(proof);
  malformed.wave = "18";
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "wave_mismatch");
}
{
  const malformed = clone(proof);
  malformed.status = "partial";
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "proof_status_not_pass");
}
{
  const malformed = clone(proof);
  delete malformed.scenarioSuite;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "missing_scenario_suite");
}
{
  const malformed = clone(proof);
  delete malformed.negativeScenarioMatrix;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "missing_negative_scenario_matrix");
}
{
  const malformed = clone(proof);
  malformed.firstToolSlice.summary.declaredToolNames.push("new_context");
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "known_disabled_tool_declared:new_context");
}
{
  const malformed = clone(proof);
  malformed.contextEnvelope.providerOutput.usableFor = "request_blocking";
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "context_envelope_not_display_only");
}
{
  const malformed = clone(proof);
  malformed.planEnvelope.providerOutput.provesCompletion = true;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "plan_completion_proof_leak");
}
{
  const malformed = clone(proof);
  malformed.viewImageEnvelope.providerOutput.modelSawPixels = true;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "image_metadata_visibility_leak");
}
{
  const malformed = clone(proof);
  malformed.capabilityWitnessRows = malformed.capabilityWitnessRows.filter((row) => row.capabilityState !== "known_disabled");
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "capability_witness_state_missing:known_disabled");
}
{
  const malformed = clone(proof);
  delete malformed.capabilityWitnessRows;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "missing_capability_witness_rows");
}
{
  const malformed = clone(proof);
  malformed.capabilityWitnessRows.find((row) => row.toolName === "view_image").evidenceRefs =
    malformed.capabilityWitnessRows.find((row) => row.toolName === "view_image").evidenceRefs.filter((ref) => ref.kind !== "direct_first_tool_declaration_row");
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "capability_witness_declaration_evidence_missing:view_image");
}
{
  const malformed = clone(proof);
  malformed.firstToolSlice.declarations = malformed.firstToolSlice.declarations.filter((row) => row.toolName !== "request_permissions");
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "capability_witness_declaration_missing:request_permissions");
}
{
  const malformed = clone(proof);
  delete malformed.userInputEnvelope;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "missing_user_input_envelope");
}
{
  const malformed = clone(proof);
  delete malformed.contextEnvelope;
  expectThrows(() => validateHumanControlWave17UsabilityGate(malformed), "missing_context_envelope");
}

console.log(JSON.stringify({
  ok: true,
  proofId: proof.proofId,
  scenarios: proof.scenarioSuite.passCount,
  negativeRows: proof.negativeScenarioMatrix.rows.length,
  witnessRows: proof.capabilityWitnessRows.length,
  manualGateRows: proof.manualGateRows.length,
}, null, 2));
