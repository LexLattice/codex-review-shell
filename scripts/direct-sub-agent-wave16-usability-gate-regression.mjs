#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA,
  buildSubAgentWave16UsabilityGate,
  validateSubAgentWave16UsabilityGate,
} = require("../src/main/direct/agents/sub-agent-wave16-usability-gate");

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

const nowMs = Date.UTC(2026, 5, 20, 18, 15, 0);
const proof = buildSubAgentWave16UsabilityGate({
  projectId: "project_wave16_gate_fixture",
  workThreadId: "work_thread_wave16_gate_fixture",
  primaryThreadId: "primary_thread_wave16_gate_fixture",
  childAgentId: "agent_wave16_carver",
  childAgentLabel: "Carver",
}, { nowMs });

assert.equal(proof.schema, SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA);
validateSubAgentWave16UsabilityGate(proof);
assert.equal(proof.status, "pass");
assert.equal(proof.scenarioSuite.failCount, 0, "scenario suite should pass");
assert.equal(proof.scenarioSuite.passCount, proof.scenarioSuite.scenarios.length, "all scenario rows should pass");
assert(proof.scenarioSuite.scenarios.length >= 10, "scenario coverage should be broad");

const scenarioIds = new Set(proof.scenarioSuite.scenarios.map((row) => row.scenarioId));
for (const required of [
  "lifecycle_read_available",
  "compatibility_mapping_no_authority",
  "turn_activity_projection_available",
  "full_child_history_projection_excluded_from_context",
  "no_interference_blocks_mutation",
  "followup_send_allowed",
  "followup_duplicate_idempotency",
  "followup_stale_target_blocked",
  "lifecycle_allowed_interrupt",
  "lifecycle_unsupported_resume",
  "terminal_close_idempotent",
]) {
  assert(scenarioIds.has(required), `missing scenario: ${required}`);
}

assert.equal(proof.operatorProjection.readsProofArtifacts, true, "operator projection should read proof");
assert.equal(proof.operatorProjection.mintsProof, false, "operator projection must not mint proof");
assert.equal(proof.operatorProjection.grantsAuthority, false, "operator projection must not grant authority");
assert.equal(proof.operatorProjection.childTranscriptFlattened, false, "operator projection must not flatten child transcript");

assert.equal(proof.turnActivityProjection.visibility.primaryTranscriptVisible, "activity_summary_only");
assert.equal(proof.turnActivityProjection.primaryTranscriptSummary.rawChildTranscriptIncluded, false);
assert.equal(proof.fullHistoryProjection.visibility.residentContextVisible, "none");
assert.equal(proof.fullHistoryProjection.visibility.primaryTranscriptVisible, "none");
assert.equal(proof.fullHistoryProjection.contextAdmissionWritten, false);

assert.equal(proof.followupAllowed.authorityDecision.finalDecision, "allow");
assert.equal(proof.followupAllowed.resultEnvelope.providerTransportStarted, true);
assert.equal(proof.followupAllowed.resultEnvelope.contextAdmission.mode, "summary_only");
assert.equal(proof.followupAllowed.resultEnvelope.contextAdmission.childTranscriptAdmitted, false);
assert.equal(proof.followupAllowed.resultEnvelope.fallbackSpawnStarted, false);
assert.equal(proof.followupAllowed.resultEnvelope.childToolInheritanceStarted, false);

assert.equal(proof.followupDuplicate.authorityDecision.duplicateSuppressed, true);
assert.equal(proof.followupDuplicate.resultEnvelope.providerTransportStarted, false);
assert.equal(proof.staleFollowup.authorityDecision.finalDecision, "block");
assert(proof.staleFollowup.authorityDecision.blockerCodes.includes("target_stale_or_terminal"));

assert.equal(proof.lifecycleInterrupt.authorityDecision.finalDecision, "allow");
assert.equal(proof.lifecycleInterrupt.transitionLedger.providerTransportStarted, true);
assert.equal(proof.lifecycleInterrupt.transitionLedger.lifecycleMutationStarted, true);
assert.equal(proof.lifecycleUnsupportedResume.authorityDecision.finalDecision, "block");
assert(proof.lifecycleUnsupportedResume.authorityDecision.blockerCodes.includes("provider_lifecycle_control_unsupported"));
assert.equal(proof.lifecycleUnsupportedResume.transitionLedger.simulatedSuccessStarted, false);
assert.equal(proof.lifecycleTerminalClose.authorityDecision.finalDecision, "idempotent_noop");
assert.equal(proof.lifecycleTerminalClose.transitionLedger.providerTransportStarted, false);
assert.equal(proof.lifecycleNoInterferenceBlocked.authorityDecision.finalDecision, "block");
assert(proof.lifecycleNoInterferenceBlocked.authorityDecision.blockerCodes.includes("policy_blocks_lifecycle_action"));

const residentStates = new Set(proof.residentCapabilityWitnessRows.map((row) => row.capabilityState));
for (const state of ["available", "disabled", "blocked", "unsupported"]) {
  assert(residentStates.has(state), `missing resident capability state: ${state}`);
}
for (const row of proof.residentCapabilityWitnessRows) {
  assert.equal(row.grantsAuthority, false, `resident witness grants authority: ${row.rowId}`);
  if (row.capabilityState !== "available") {
    assert.equal(row.blockerVisible, true, `blocked/disabled row should expose reason: ${row.rowId}`);
  }
}

const negativeIds = new Set(proof.negativeScenarioMatrix.rows.map((row) => row.rowId));
for (const required of [
  "legacy_alias_bypass",
  "observe_only_declaration_removal",
  "duplicate_followup_idempotency",
  "stale_child_target",
  "unsupported_resume",
  "interrupt_requested_vs_interrupted",
  "full_history_context_exclusion",
  "terminal_close_idempotency",
]) {
  assert(negativeIds.has(required), `missing negative scenario: ${required}`);
}
for (const row of proof.negativeScenarioMatrix.rows) {
  assert.equal(row.status, "pass", `negative row did not pass: ${row.rowId}`);
  assert.equal(row.providerTransportStarted, false, `negative row started provider transport: ${row.rowId}`);
  assert.equal(row.lifecycleMutationStarted, false, `negative row started lifecycle mutation: ${row.rowId}`);
  assert.equal(row.grantsAuthority, false, `negative row granted authority: ${row.rowId}`);
}

for (const row of proof.analyticsHookRows) {
  assert.equal(row.exportedToAnalytics, true, `analytics hook not exported: ${row.rowId}`);
  assert.equal(row.childUsageFoldedIntoParentOnly, false, `analytics hook folds child usage into parent: ${row.rowId}`);
}

for (const row of proof.manualGateRows) {
  assert.equal(row.status, "pass", `manual gate row failed: ${row.gateId}`);
}

const serialized = JSON.stringify(proof);
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");
assert(!serialized.includes("\"rawChildTranscriptIncluded\":true"), "raw child transcript leak");
assert(!serialized.includes("\"rawPromptPayloadIncluded\":true"), "raw prompt payload leak");
assert(!serialized.includes("\"childTranscriptFlattenedIntoPrimary\":true"), "child transcript flattening leak");
assert(!serialized.includes("\"workspaceMutationStarted\":true"), "workspace mutation leak");
assert(!serialized.includes("\"wave17HumanControlToolsStarted\":true"), "Wave 17 scope leak");
assert(!serialized.includes("\"wave18ExternalDiscoveryToolsStarted\":true"), "Wave 18 scope leak");

{
  const malformed = clone(proof);
  malformed.operatorProjection.mintsProof = true;
  expectThrows(() => validateSubAgentWave16UsabilityGate(malformed), "operator_projection_authority_leak");
}
{
  const malformed = clone(proof);
  malformed.fullHistoryProjection.visibility.residentContextVisible = "summary_only";
  expectThrows(() => validateSubAgentWave16UsabilityGate(malformed), "full_history_context_admission_leak");
}
{
  const malformed = clone(proof);
  malformed.residentCapabilityWitnessRows = malformed.residentCapabilityWitnessRows.filter((row) => row.capabilityState !== "unsupported");
  expectThrows(() => validateSubAgentWave16UsabilityGate(malformed), "resident_capability_state_missing:unsupported");
}
{
  const malformed = clone(proof);
  malformed.negativeScenarioMatrix.rows[0].grantsAuthority = true;
  expectThrows(() => validateSubAgentWave16UsabilityGate(malformed), "negative_row_boundary_leak");
}
{
  const malformed = clone(proof);
  malformed.wave17HumanControlToolsStarted = true;
  expectThrows(() => validateSubAgentWave16UsabilityGate(malformed), "proof_boundary_leak:wave17HumanControlToolsStarted");
}

console.log(JSON.stringify({
  ok: true,
  proofId: proof.proofId,
  scenarios: proof.scenarioSuite.passCount,
  negativeRows: proof.negativeScenarioMatrix.rows.length,
  residentCapabilityRows: proof.residentCapabilityWitnessRows.length,
  manualGateRows: proof.manualGateRows.length,
}, null, 2));
