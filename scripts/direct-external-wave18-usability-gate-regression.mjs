#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA,
  buildExternalWave18UsabilityGate,
  validateExternalWave18UsabilityGate,
} = require("../src/main/direct/external/external-wave18-usability-gate");
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

const nowMs = Date.UTC(2026, 5, 20, 19, 5, 0);
const proof = buildExternalWave18UsabilityGate({
  projectId: "project_wave18_gate_fixture",
  workThreadId: "work_thread_wave18_gate_fixture",
  threadId: "thread_wave18_gate_fixture",
  turnId: "turn_wave18_gate_fixture",
}, { nowMs });

assert.equal(proof.schema, EXTERNAL_WAVE18_USABILITY_PROOF_SCHEMA, "proof schema mismatch");
validateExternalWave18UsabilityGate(proof);
assert.equal(proof.status, "pass", "Wave 18 proof should pass");
assert.equal(proof.wave, "18", "wave mismatch");

const declaredTools = new Set(proof.residentDeclaration.declaredTools);
for (const required of ["tool_search", "list_mcp_resources", "list_mcp_resource_templates"]) {
  assert(declaredTools.has(required), `missing declared discovery tool: ${required}`);
}
for (const forbidden of ["read_mcp_resource", "mcp_dynamic_tool_call", "request_plugin_install", "web_search", "image_generation"]) {
  assert(!declaredTools.has(forbidden), `forbidden tool declared: ${forbidden}`);
}

assert.equal(proof.discoveryAdmission.admissionState, "summary_admitted", "discovery should be summary admitted");
assert.equal(proof.discoveryAdmission.visibility.providerContinuation, "summary_only", "discovery provider projection should be summary-only");
assert.equal(proof.readAdmission.admissionState, "excerpt_admitted", "read should be excerpt admitted");
assert.equal(proof.readAdmission.visibility.residentContext, "bounded_excerpt", "read resident projection should be bounded excerpt");
assert.equal(proof.readAdmission.projectTruthGranted, false, "read admission must not grant project truth");
assert.equal(proof.readAdmission.durableMemoryAdmissionStarted, false, "read admission must not start memory");
assert.equal(proof.binaryAdmission.admissionState, "ref_only", "binary read should be ref-only");
assert.equal(proof.blockedAdmission.admissionState, "blocked", "blocked read should remain blocked");
assert.equal(proof.dynamicActionGate.status, "blocked", "dynamic MCP action should be blocked");
assert.equal(proof.pluginInstallGate.status, "blocked", "plugin install should be blocked");

const scenarioIds = new Set(proof.scenarioSuite.scenarios.map((row) => row.scenarioId));
for (const required of [
  "tool_search_summary_admitted",
  "mcp_resources_exact_server_selector",
  "mcp_templates_exact_server_selector",
  "mcp_read_excerpt_admitted",
  "binary_resource_ref_only",
  "provider_continuation_suppressed",
]) {
  assert(scenarioIds.has(required), `missing scenario: ${required}`);
}
assert.equal(proof.scenarioSuite.failCount, 0, "scenario suite should pass");
for (const row of proof.scenarioSuite.scenarios) {
  assert.equal(row.status, "pass", `scenario failed: ${row.scenarioId}`);
  assert.equal(row.dynamicMcpActionStarted, false, `scenario started dynamic action: ${row.scenarioId}`);
  assert.equal(row.pluginInstallStarted, false, `scenario started plugin install: ${row.scenarioId}`);
  assert.equal(row.projectTruthGranted, false, `scenario granted project truth: ${row.scenarioId}`);
}

const negativeIds = new Set(proof.negativeScenarioMatrix.rows.map((row) => row.rowId));
for (const required of [
  "discovered_as_declared_collapse_blocked",
  "multiple_mcp_servers_without_selector_blocked",
  "stale_or_unknown_server_identity_blocked",
  "raw_endpoint_token_leak_blocked",
  "raw_resource_uri_payload_leak_blocked",
  "binary_or_oversize_resource_ref_or_blocked",
  "dynamic_mcp_action_blocked",
  "plugin_install_blocked",
  "memory_smuggling_blocked",
  "project_truth_laundering_blocked",
]) {
  assert(negativeIds.has(required), `missing negative row: ${required}`);
}
for (const row of proof.negativeScenarioMatrix.rows) {
  assert.equal(row.status, "pass", `negative row failed: ${row.rowId}`);
  assert.equal(row.providerTransportStarted, false, `negative row started provider transport: ${row.rowId}`);
  assert.equal(row.dynamicMcpActionStarted, false, `negative row started dynamic MCP action: ${row.rowId}`);
  assert.equal(row.pluginInstallStarted, false, `negative row started plugin install: ${row.rowId}`);
  assert.equal(row.rawExternalPayloadIncluded, false, `negative row included raw payload: ${row.rowId}`);
}

const witnessByTool = new Map(proof.residentWitnessRows.map((row) => [row.toolName, row]));
assert.equal(witnessByTool.get("tool_search").capabilityState, "callable_now");
assert.equal(witnessByTool.get("list_mcp_resources").capabilityState, "callable_now");
assert.equal(witnessByTool.get("list_mcp_resource_templates").capabilityState, "callable_now");
assert.equal(witnessByTool.get("read_mcp_resource").capabilityState, "guarded_read");
assert.equal(witnessByTool.get("mcp_dynamic_tool_call").capabilityState, "blocked_deferred");
assert.equal(witnessByTool.get("request_plugin_install").capabilityState, "blocked_deferred");
assert.equal(witnessByTool.get("web_search").capabilityState, "future_wave");
for (const row of proof.residentWitnessRows) {
  assert.equal(row.grantsAuthority, false, `resident witness granted authority: ${row.rowId}`);
  if (row.capabilityState === "callable_now") {
    assert.equal(row.providerDeclared, true, `callable witness should be declared: ${row.toolName}`);
    assert(row.evidenceRefs.some((ref) => ref.kind === "external_tool_declaration"), `callable witness missing declaration evidence: ${row.toolName}`);
  } else {
    assert.equal(row.providerDeclared, false, `non-callable witness should not be declared: ${row.toolName}`);
  }
}

for (const row of proof.manualGateRows) {
  assert.equal(row.status, "pass", `manual gate row failed: ${row.gateId}`);
}
assert.equal(proof.operatorProjection.readsProofArtifacts, true, "operator projection should read proof");
assert.equal(proof.operatorProjection.mintsProof, false, "operator projection must not mint proof");
assert.equal(proof.operatorProjection.grantsAuthority, false, "operator projection must not grant authority");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T19:05:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic59.external-wave18-usability-gate"), "information registry should include Wave 18 gate row");

const serialized = JSON.stringify(proof);
for (const forbidden of [
  "token=secret",
  "Bearer abcdefghijklmnopqrstuvwxyz",
  "\"rawExternalPayloadIncluded\":true",
  "\"rawResourceUriIncluded\":true",
  "\"rawEndpointIncluded\":true",
  "\"rawCredentialIncluded\":true",
  "\"rawSecretIncluded\":true",
  "\"dynamicMcpActionStarted\":true",
  "\"pluginInstallStarted\":true",
  "\"durableMemoryAdmissionStarted\":true",
  "\"projectTruthGranted\":true",
  "\"workspaceEvidenceGranted\":true",
  "\"wave19ProviderHostedToolsStarted\":true",
  "\"wave20NewContextExecutionStarted\":true",
  "\"wave21CodeModeExecutionStarted\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized proof leaked ${forbidden}`);
}

{
  const malformed = clone(proof);
  malformed.wave = "19";
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "wave_mismatch");
}
{
  const malformed = clone(proof);
  malformed.operatorProjection.mintsProof = true;
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "operator_projection_authority_leak");
}
{
  const malformed = clone(proof);
  malformed.residentDeclaration.declaredTools.push("read_mcp_resource");
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "external_tool_declaration_forbidden:read_mcp_resource");
}
{
  const malformed = clone(proof);
  malformed.readAdmission.projectTruthGranted = true;
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "external_context_admission_authority_leak:projectTruthGranted");
}
{
  const malformed = clone(proof);
  malformed.scenarioSuite.scenarios[0].projectTruthGranted = true;
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "scenario_boundary_leak:tool_search_summary_admitted:projectTruthGranted");
}
{
  const malformed = clone(proof);
  malformed.negativeScenarioMatrix.rows = malformed.negativeScenarioMatrix.rows.filter((row) => row.rowId !== "plugin_install_blocked");
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "negative_row_missing:plugin_install_blocked");
}
{
  const malformed = clone(proof);
  malformed.residentWitnessRows = malformed.residentWitnessRows.filter((row) => row.capabilityState !== "future_wave");
  expectThrows(() => validateExternalWave18UsabilityGate(malformed), "resident_witness_state_missing:future_wave");
}

console.log(JSON.stringify({
  ok: true,
  proofId: proof.proofId,
  scenarios: proof.scenarioSuite.passCount,
  negativeRows: proof.negativeScenarioMatrix.rows.length,
  residentWitnessRows: proof.residentWitnessRows.length,
  manualGateRows: proof.manualGateRows.length,
}, null, 2));
