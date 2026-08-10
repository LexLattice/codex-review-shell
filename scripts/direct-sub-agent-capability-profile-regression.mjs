#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
  SUB_AGENT_CAPABILITY_PROFILE_SCHEMA,
  buildSubAgentCapabilityProfile,
  validateSubAgentCapabilityProfile,
} = require("../src/main/direct/agents/sub-agent-capability-profile");
const {
  validateOdeuActivationRow,
  validateOdeuCapabilityRow,
  validateOdeuDeclarationSnapshot,
  validateOdeuPromotionDecision,
} = require("../src/main/direct/odeu");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

const fixedNow = () => Date.UTC(2026, 5, 19, 21, 0, 0);

const profile = buildSubAgentCapabilityProfile({
  projectId: "project_wave15_pr92_fixture",
  workThreadId: "work_thread_wave15_pr92_fixture",
  profileId: "sub_agent_capability_profile_wave15_pr92_fixture",
}, { now: fixedNow });

assert(profile.schema === SUB_AGENT_CAPABILITY_PROFILE_SCHEMA, "profile schema mismatch");
assert(profile.firstSliceTools.length === RESIDENT_FIRST_SLICE_TOOLS.length, "first slice tool count mismatch");
assert(profile.blockedControls.length === DEFERRED_SUB_AGENT_CONTROLS.length, "blocked control count mismatch");
assert(profile.capabilityRows.length === RESIDENT_FIRST_SLICE_TOOLS.length + DEFERRED_SUB_AGENT_CONTROLS.length, "capability row count mismatch");
assert(profile.promotionDecisions.length === profile.capabilityRows.length, "promotion count mismatch");
assert(profile.activationRows.length === profile.capabilityRows.length, "activation count mismatch");
assert(profile.declarationSnapshots.length === profile.capabilityRows.length, "declaration count mismatch");

validateSubAgentCapabilityProfile(profile);
for (const row of profile.capabilityRows) validateOdeuCapabilityRow(row);
for (const row of profile.promotionDecisions) validateOdeuPromotionDecision(row);
for (const row of profile.activationRows) validateOdeuActivationRow(row);
for (const row of profile.declarationSnapshots) validateOdeuDeclarationSnapshot(row);

const capabilityByKind = new Map(profile.capabilityRows.map((row) => [row.capabilityKind, row]));
const promotionByCapability = new Map(profile.promotionDecisions.map((row) => [row.capabilityId, row]));
const activationByCapability = new Map(profile.activationRows.map((row) => [row.capabilityId, row]));
const declarationByCapability = new Map(profile.declarationSnapshots.map((row) => [row.activationId, row]));

for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
  const capability = capabilityByKind.get(toolName);
  assert(capability, `missing first-slice capability ${toolName}`);
  assert(capability.family === "sub_agent_runtime", "first-slice family mismatch");
  assert(capability.capabilityState === "profile_declared", "first-slice capability should be profile declared");
  assert(capability.promotionState === "direct_restricted", "first-slice capability should be restricted");
  assert(capability.providerDeclarationState === "not_declared", "first-slice provider declaration should be absent");
  assert(capability.familyExtension.firstSlice === true, "first-slice extension missing");
  assert(capability.familyExtension.providerTransportAllowedInPr92 === false, "provider transport must not be allowed");
  assert(capability.familyExtension.providerDeclarationAllowedInPr92 === false, "provider declaration must not be allowed");
  assert(capability.familyExtension.residentCallableAllowedInPr92 === false, "resident callable must not be allowed");

  const promotion = promotionByCapability.get(capability.capabilityId);
  assert(promotion?.decision === "promotable_restricted", "first-slice promotion should be restricted");
  assert(promotion.evidenceClass === "fixture_only", "PR92 evidence class should be fixture_only");
  assert(promotion.blockers.length === 0, "first-slice promotion should not have blockers");
  assert(promotion.negativeEvidence.noOutOfContractProviderTransport === true, "negative provider transport evidence missing");

  const activation = activationByCapability.get(capability.capabilityId);
  assert(activation?.state === "shadow_only", "first-slice activation must remain shadow_only");
  assert(activation.effect === "shadow", "first-slice activation effect must remain shadow");
  assert(activation.familyExtension.activationPosture === "headless_test_only", "first-slice activation posture should be headless test only");

  const declaration = profile.declarationSnapshots.find((row) => row.activationId === activation.activationId);
  assert(declaration, "first-slice declaration missing");
  assert(declaration.residentVisible === true, "first-slice declaration should be resident visible");
  assert(declaration.operatorVisible === true, "first-slice declaration should be operator visible");
  assert(declaration.providerDeclared === false, "first-slice declaration must not be provider declared");
  assert(declaration.modelCallable === false, "first-slice declaration must not be model callable");
  assert(declaration.familyExtension.declarationPosture === "resident_visible_shadow_only", "declaration posture mismatch");
}

for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
  const capability = capabilityByKind.get(toolName);
  assert(capability, `missing blocked capability ${toolName}`);
  assert(capability.promotionState === "diagnostic_only", "blocked control should stay diagnostic");
  assert(capability.providerDeclarationState === "not_declared", "blocked control provider declaration should be absent");
  assert(capability.familyExtension.firstSlice === false, "blocked control must not be first slice");
  assert(capability.familyExtension.futureWaveOwner, "blocked control should name future wave owner");

  const promotion = promotionByCapability.get(capability.capabilityId);
  assert(promotion?.decision === "blocked", "blocked control promotion should block");
  assert(promotion.blockers.length >= 1, "blocked control should include blocker");
  assert(promotion.restrictions.some((row) => row.reason.includes("owner=")), "blocked control should cite future owner in restrictions");

  const activation = activationByCapability.get(capability.capabilityId);
  assert(activation?.state === "shadow_only", "blocked control activation remains shadow row only");
  assert(activation.familyExtension.activationPosture === "shadow_only", "blocked control activation posture mismatch");
}

assert([...declarationByCapability.values()].every((row) => row.providerDeclared === false), "no declaration may be provider-declared");
assert([...declarationByCapability.values()].every((row) => row.modelCallable === false), "no declaration may be model-callable");
assert(profile.providerTransportStarted === false, "profile must not start provider transport");
assert(profile.providerDeclarationEnabled === false, "profile must not enable provider declaration");
assert(profile.residentCallableEnabled === false, "profile must not enable resident-callable tools");
assert(profile.executorCallsStarted === false, "profile must not call executor");
assert(profile.workspaceMutationStarted === false, "profile must not mutate workspace");
assert(profile.rawPromptIncluded === false, "profile must not expose raw prompt");
assert(profile.rawTranscriptIncluded === false, "profile must not expose raw transcript");
assert(profile.rawProviderPayloadIncluded === false, "profile must not expose raw provider payload");

const serialized = JSON.stringify(profile);
assert(!serialized.includes("\"providerTransportStarted\":true"), "provider transport leak");
assert(!serialized.includes("\"providerDeclared\":true"), "provider declaration leak");
assert(!serialized.includes("\"modelCallable\":true"), "model callable leak");
assert(!serialized.includes("\"residentCallableEnabled\":true"), "resident callable leak");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt leak");
assert(!serialized.includes("\"rawTranscriptIncluded\":true"), "raw transcript leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");

expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  providerTransportStarted: true,
}), "sub_agent_capability_profile_provider_transport_started");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  executorCallsStarted: true,
}), "sub_agent_capability_profile_executor_calls_started");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  workspaceMutationStarted: true,
}), "sub_agent_capability_profile_workspace_mutation_started");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  capabilityRows: [],
}), "sub_agent_capability_profile_incomplete_array:capabilityRows");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  capabilityRows: profile.capabilityRows.filter((row) => row.capabilityKind !== "wait_agent"),
}), "sub_agent_capability_profile_incomplete_array:capabilityRows");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  capabilityRows: [
    ...profile.capabilityRows.filter((row) => row.capabilityKind !== "wait_agent"),
    { ...profile.capabilityRows[0], capabilityKind: "duplicate_spawn_agent" },
  ],
}), "sub_agent_capability_profile_capability_row_missing:wait_agent");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  promotionDecisions: profile.promotionDecisions.filter((row) => row.capabilityId !== "sub_agent_wait_agent"),
}), "sub_agent_capability_profile_incomplete_array:promotionDecisions");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  activationRows: profile.activationRows.filter((row) => row.capabilityId !== "sub_agent_wait_agent"),
}), "sub_agent_capability_profile_incomplete_array:activationRows");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  declarationSnapshots: profile.declarationSnapshots.filter((row) => row.activationId !== "activation_sub_agent_wait_agent"),
}), "sub_agent_capability_profile_incomplete_array:declarationSnapshots");
expectThrows(() => validateSubAgentCapabilityProfile({
  ...profile,
  blockedControls: profile.blockedControls.filter((row) => row.toolName !== "recursive_spawn"),
}), "sub_agent_capability_profile_blocked_control_missing:recursive_spawn");

console.log(JSON.stringify({
  ok: true,
  profileId: profile.profileId,
  firstSliceTools: profile.firstSliceTools,
  blockedControls: profile.blockedControls.map((row) => row.toolName),
  capabilityRows: profile.capabilityRows.length,
  profileDigest: profile.profileDigest.value,
}, null, 2));
