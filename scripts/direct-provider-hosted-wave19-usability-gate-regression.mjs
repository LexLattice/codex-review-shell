#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA,
  buildProviderHostedWave19UsabilityGate,
  validateProviderHostedWave19UsabilityGate,
} = require("../src/main/direct/provider/hosted-wave19-usability-gate");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

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

const nowMs = Date.UTC(2026, 5, 20, 22, 45, 0);
const proof = buildProviderHostedWave19UsabilityGate({
  projectId: "project_wave19_gate_fixture",
  workThreadId: "work_thread_wave19_gate_fixture",
  threadId: "thread_wave19_gate_fixture",
  turnId: "turn_wave19_gate_fixture",
}, { nowMs });
const repeatedProof = buildProviderHostedWave19UsabilityGate({
  projectId: "project_wave19_gate_fixture",
  workThreadId: "work_thread_wave19_gate_fixture",
  threadId: "thread_wave19_gate_fixture",
  turnId: "turn_wave19_gate_fixture",
}, { nowMs });

assert.equal(proof.schema, PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA, "proof schema mismatch");
validateProviderHostedWave19UsabilityGate(proof);
assert.equal(proof.status, "pass", "Wave 19 proof should pass");
assert.equal(proof.wave, "19", "wave mismatch");
assert.equal(proof.proofDigest, repeatedProof.proofDigest, "fixed-time proof digest should be deterministic");

assert.equal(proof.webCall.authorityDecision, "allowed", "web_search should be resident-callable with runtime proof");
assert.equal(proof.webAdmission.admissionDecision, "admit", "web_search summary should be admitted");
assert.equal(proof.webAdmission.projectTruthGranted, false, "web_search must not grant project truth");
assert.equal(proof.webAdmission.durableMemoryAdmission, false, "web_search must not admit durable memory");
assert.equal(proof.webResult.hostedUsageAttribution.usageState, "provider_reported", "web usage should be provider-reported");

assert.equal(proof.operatorImageCall.authorityDecision, "allowed", "operator image_generation should be allowed");
assert.notEqual(proof.residentImageCall.authorityDecision, "allowed", "resident image_generation should be operator-gated");
assert.equal(proof.completedImageArtifact.generationState, "completed", "operator image artifact should complete");
assert.equal(proof.completedImageArtifact.retentionPolicy.workspaceInsertionAllowed, false, "image artifact must not insert into workspace");
assert.equal(proof.completedImageArtifact.rawImageBytesInRendererState, false, "image bytes must not enter renderer state");
assert.equal(proof.completedImageArtifact.hostedUsageAttribution.usageState, "unavailable", "image usage can be unavailable but witnessed");
assert.equal(proof.providerBlockedArtifact.generationState, "blocked_by_provider", "provider-blocked generation must remain visible");

const scenarioIds = new Set(proof.scenarioSuite.scenarios.map((row) => row.scenarioId));
for (const required of [
  "web_search_resident_callable",
  "web_search_profile_declared_blocked",
  "image_generation_operator_gated_available",
  "image_generation_resident_blocked",
  "provider_hosted_usage_unavailable_witness",
]) {
  assert(scenarioIds.has(required), `missing scenario: ${required}`);
}
for (const row of proof.scenarioSuite.scenarios) {
  assert.equal(row.status, "pass", `scenario failed: ${row.scenarioId}`);
  assert.equal(row.browserNavigationStarted, false, `scenario started browser navigation: ${row.scenarioId}`);
  assert.equal(row.workspaceMutationStarted, false, `scenario mutated workspace: ${row.scenarioId}`);
  assert.equal(row.durableMemoryAdmissionStarted, false, `scenario started memory admission: ${row.scenarioId}`);
  assert.equal(row.projectTruthGranted, false, `scenario granted project truth: ${row.scenarioId}`);
}

const negativeIds = new Set(proof.negativeScenarioMatrix.rows.map((row) => row.rowId));
for (const required of [
  "profile_declared_unprobed_not_callable",
  "static_label_declaration_blocked",
  "outbound_query_leak_blocked",
  "invented_citation_blocked",
  "raw_prompt_retention_blocked",
  "staged_artifact_without_manifest_blocked",
  "provider_blocked_generation_preserved",
  "raw_image_bytes_blocked",
  "workspace_insertion_blocked",
  "durable_memory_smuggling_blocked",
  "automatic_replay_blocked",
  "stale_activation_blocked",
  "undeclared_hosted_call_blocked",
]) {
  assert(negativeIds.has(required), `missing negative row: ${required}`);
}
for (const row of proof.negativeScenarioMatrix.rows) {
  assert.equal(row.status, "pass", `negative row failed: ${row.rowId}`);
  assert.equal(row.rawProviderPayloadIncluded, false, `negative row leaked provider payload: ${row.rowId}`);
  assert.equal(row.rawImageBytesIncluded, false, `negative row leaked image bytes: ${row.rowId}`);
  assert.equal(row.workspaceInsertionStarted, false, `negative row inserted workspace artifact: ${row.rowId}`);
  assert.equal(row.automaticReplayAllowed, false, `negative row allowed replay: ${row.rowId}`);
}
assert(
  proof.negativeScenarioMatrix.rows
    .find((row) => row.rowId === "outbound_query_leak_blocked")
    ?.blockerCodes.some((code) => String(code).includes("credentialed_url")),
  "outbound query leak row should cite credentialed_url"
);

const witnessByTool = new Map(proof.residentWitnessRows.map((row) => [row.toolName, row]));
assert.equal(witnessByTool.get("web_search").capabilityState, "resident_callable");
assert.equal(witnessByTool.get("web_search").residentCallable, true);
assert.equal(witnessByTool.get("web_search").providerDeclared, true);
assert.equal(witnessByTool.get("image_generation").capabilityState, "operator_gated");
assert.equal(witnessByTool.get("image_generation").residentCallable, false);
assert.equal(witnessByTool.get("image_generation").operatorCallable, true);
assert.equal(witnessByTool.get("web_search_profile_declared").capabilityState, "blocked_profile_only");
for (const row of proof.residentWitnessRows) {
  assert.equal(row.grantsAuthority, false, `witness granted authority: ${row.rowId}`);
}

assert.equal(proof.operatorProjection.readsProofArtifacts, true, "operator projection should read proof");
assert.equal(proof.operatorProjection.mintsProof, false, "operator projection must not mint proof");
assert.equal(proof.operatorProjection.grantsAuthority, false, "operator projection must not grant authority");
assert.equal(proof.operatorProjection.visibleSummary.webSearchResidentCallable, true);
assert.equal(proof.operatorProjection.visibleSummary.imageGenerationOperatorCallable, true);
assert.equal(proof.operatorProjection.visibleSummary.imageGenerationResidentCallable, false);

for (const row of proof.manualGateRows) {
  assert.equal(row.status, "pass", `manual gate row failed: ${row.gateId}`);
}

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T22:45:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic60.provider-hosted-wave19-usability-gate"), "information registry should include Wave 19 gate row");

const serialized = JSON.stringify(proof);
for (const forbidden of [
  "user:secret",
  "token=secret",
  "password=secret",
  "\"rawProviderPayloadIncluded\":true",
  "\"rawPageContentIncluded\":true",
  "\"rawImageBytesIncluded\":true",
  "\"rawPromptIncluded\":true",
  "\"rawQueryIncluded\":true",
  "\"rawResultIncluded\":true",
  "\"rawSecretIncluded\":true",
  "\"workspaceInsertionStarted\":true",
  "\"durableMemoryAdmissionStarted\":true",
  "\"projectTruthGranted\":true",
  "\"automaticReplayAllowed\":true",
  "\"wave20NewContextExecutionStarted\":true",
  "\"wave21CodeModeExecutionStarted\":true",
  "\"wave22BatchOrchestrationStarted\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized proof leaked ${forbidden}`);
}

{
  const malformed = clone(proof);
  malformed.wave = "18";
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "wave_mismatch");
}
{
  const malformed = clone(proof);
  malformed.webCall.authorityDecision = "blocked_missing_declaration";
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "web_search_not_allowed");
}
{
  const malformed = clone(proof);
  malformed.residentImageCall.authorityDecision = "allowed";
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "resident_image_allowed");
}
{
  const malformed = clone(proof);
  malformed.operatorImageCall = { authorityDecision: "allowed" };
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "operator_image_call_schema_mismatch");
}
{
  const malformed = clone(proof);
  delete malformed.imageAdmission;
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "image_admission_schema_mismatch");
}
{
  const malformed = clone(proof);
  malformed.completedImageArtifact.rawImageBytesInRendererState = true;
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "provider_hosted_image_artifact_authority_leak:rawImageBytesInRendererState");
}
{
  const malformed = clone(proof);
  malformed.scenarioSuite.scenarios.push(null);
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "scenario_invalid_object");
}
{
  const malformed = clone(proof);
  malformed.negativeScenarioMatrix.rows.push("not-a-row");
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "negative_row_invalid_object");
}
{
  const malformed = clone(proof);
  malformed.residentWitnessRows.push(null);
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "resident_witness_invalid_object");
}
{
  const malformed = clone(proof);
  malformed.manualGateRows.push(false);
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "manual_gate_invalid_object");
}
{
  const malformed = clone(proof);
  malformed.negativeScenarioMatrix.rows = malformed.negativeScenarioMatrix.rows.filter((row) => row.rowId !== "undeclared_hosted_call_blocked");
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "negative_row_missing:undeclared_hosted_call_blocked");
}
{
  const malformed = clone(proof);
  malformed.operatorProjection.mintsProof = true;
  expectThrows(() => validateProviderHostedWave19UsabilityGate(malformed), "operator_projection_authority_leak");
}

console.log(JSON.stringify({
  ok: true,
  proofId: proof.proofId,
  scenarios: proof.scenarioSuite.passCount,
  negativeRows: proof.negativeScenarioMatrix.rows.length,
  residentWitnessRows: proof.residentWitnessRows.length,
  manualGateRows: proof.manualGateRows.length,
}, null, 2));
