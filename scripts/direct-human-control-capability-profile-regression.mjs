#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  GUARDED_PROFILE_TOOLS,
  HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA,
  KNOWN_DISABLED_PROFILE_TOOLS,
  RESIDENT_PROFILE_TOOLS,
  buildHumanControlCapabilityProfile,
  validateHumanControlCapabilityProfile,
} = require("../src/main/direct/tools/human-control-capability-profile");
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

const fixedNow = () => Date.UTC(2026, 5, 20, 12, 0, 0);

const profile = buildHumanControlCapabilityProfile({
  projectId: "project_wave17_pr103_fixture",
  workThreadId: "work_thread_wave17_pr103_fixture",
  profileId: "human_control_capability_profile_wave17_pr103_fixture",
}, { now: fixedNow });
const nullArgProfile = buildHumanControlCapabilityProfile(null, null);
assert(nullArgProfile.schema === HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA, "null args should be safely normalized");

assert(profile.schema === HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA, "profile schema mismatch");
assert(profile.residentProfileTools.length === RESIDENT_PROFILE_TOOLS.length, "resident profile tool count mismatch");
assert(profile.guardedTools.length === GUARDED_PROFILE_TOOLS.length, "guarded tool count mismatch");
assert(profile.knownDisabledTools.length === KNOWN_DISABLED_PROFILE_TOOLS.length, "known-disabled tool count mismatch");
assert(profile.capabilityRows.length === RESIDENT_PROFILE_TOOLS.length + GUARDED_PROFILE_TOOLS.length + KNOWN_DISABLED_PROFILE_TOOLS.length, "capability row count mismatch");
assert(profile.promotionDecisions.length === profile.capabilityRows.length, "promotion count mismatch");
assert(profile.activationRows.length === profile.capabilityRows.length, "activation count mismatch");
assert(profile.declarationSnapshots.length === profile.capabilityRows.length, "declaration count mismatch");
assert(profile.declarationEligibilityRows.length === profile.capabilityRows.length, "eligibility count mismatch");

validateHumanControlCapabilityProfile(profile);
for (const row of profile.capabilityRows) validateOdeuCapabilityRow(row);
for (const row of profile.promotionDecisions) validateOdeuPromotionDecision(row);
for (const row of profile.activationRows) validateOdeuActivationRow(row);
for (const row of profile.declarationSnapshots) validateOdeuDeclarationSnapshot(row);

const capabilityByKind = new Map(profile.capabilityRows.map((row) => [row.capabilityKind, row]));
const promotionByCapability = new Map(profile.promotionDecisions.map((row) => [row.capabilityId, row]));
const activationByCapability = new Map(profile.activationRows.map((row) => [row.capabilityId, row]));
const declarationByActivation = new Map(profile.declarationSnapshots.map((row) => [row.activationId, row]));
const eligibilityByTool = new Map(profile.declarationEligibilityRows.map((row) => [row.toolName, row]));

for (const toolName of RESIDENT_PROFILE_TOOLS) {
  const capability = capabilityByKind.get(toolName);
  assert(capability, `missing resident profile capability ${toolName}`);
  assert(capability.family === "human_control_local_perception", "resident profile family mismatch");
  assert(capability.capabilityState === "profile_declared", "resident profile capability should be profile declared");
  assert(capability.promotionState === "direct_restricted", "resident profile capability should be direct restricted");
  assert(capability.providerDeclarationState === "not_declared", "resident profile provider declaration should be absent");
  assert(capability.familyExtension.profileStatus === "profile_promoted_shadow", "resident profile status mismatch");
  assert(capability.familyExtension.residentCallableAllowedInPr103 === false, "resident callable must not be allowed");

  const promotion = promotionByCapability.get(capability.capabilityId);
  assert(promotion?.decision === "promotable_restricted", "resident profile promotion should be restricted");
  assert(promotion.evidenceClass === "fixture_only", "PR103 evidence class should be fixture_only");
  assert(promotion.blockers.length === 0, "resident profile promotion should not have blockers");
  assert(promotion.negativeEvidence.noOutOfContractProviderTransport === true, "negative provider transport evidence missing");

  const activation = activationByCapability.get(capability.capabilityId);
  assert(activation?.state === "shadow_only", "resident profile activation must remain shadow_only");
  assert(activation.effect === "shadow", "resident profile activation effect must remain shadow");
  assert(activation.familyExtension.residentCallableAllowedInPr103 === false, "activation cannot allow resident calls");

  const declaration = declarationByActivation.get(activation.activationId);
  assert(declaration, "resident profile declaration missing");
  assert(declaration.residentVisible === true, "resident profile should be resident visible");
  assert(declaration.operatorVisible === true, "resident profile should be operator visible");
  assert(declaration.providerDeclared === false, "resident profile must not be provider declared");
  assert(declaration.modelCallable === false, "resident profile must not be model callable");
  assert(declaration.familyExtension.declarationPosture === "resident_visible_shadow_only", "declaration posture mismatch");

  const eligibility = eligibilityByTool.get(toolName);
  assert(eligibility.residentVisibleState === "visible_shadow", "resident profile eligibility should be visible shadow");
  assert(eligibility.providerDeclared === false, "eligibility cannot provider-declare");
  assert(eligibility.modelCallable === false, "eligibility cannot model-callable");
  assert(eligibility.residentCallable === false, "eligibility cannot resident-callable");
}

for (const toolName of GUARDED_PROFILE_TOOLS) {
  const capability = capabilityByKind.get(toolName);
  assert(capability, `missing guarded capability ${toolName}`);
  assert(capability.promotionState === "diagnostic_only", "guarded tool should stay diagnostic");
  assert(capability.providerDeclarationState === "not_declared", "guarded provider declaration should be absent");

  const promotion = promotionByCapability.get(capability.capabilityId);
  assert(promotion?.decision === "blocked", "guarded promotion should block");
  assert(promotion.blockers.length >= 1, "guarded promotion should include blocker");
  assert(
    promotion.restrictions.some((row) => row.reason.includes("owner=PR") || row.reason.includes("owner=Future provider image payload wave")),
    "guarded restriction should cite future owner",
  );

  const activation = activationByCapability.get(capability.capabilityId);
  assert(activation.state === "suspended", "guarded activation should be suspended");
  assert(activation.effect === "deny", "guarded activation should deny");
  assert(activation.familyExtension.blockedActivation === true, "guarded activation should carry blockedActivation");

  const declaration = declarationByActivation.get(activation.activationId);
  assert(declaration.familyExtension.declarationPosture === "resident_visible_guarded_blocked", "guarded declaration posture mismatch");

  const eligibility = eligibilityByTool.get(toolName);
  assert(eligibility.residentVisibleState === "visible_guarded", "guarded eligibility should be visible guarded");
  assert(eligibility.permissionGrantAllowedInPr103 === false, "guarded request cannot grant permission");
}

for (const toolName of KNOWN_DISABLED_PROFILE_TOOLS) {
  const capability = capabilityByKind.get(toolName);
  assert(capability, `missing known-disabled capability ${toolName}`);
  assert(capability.promotionState === "unsupported", "known-disabled tool should be unsupported");
  assert(capability.sideEffectClass === "context_world", "new_context should be context-world class");

  const promotion = promotionByCapability.get(capability.capabilityId);
  assert(promotion?.decision === "blocked", "known-disabled promotion should block");
  assert(promotion.blockers.includes("context_transition_law_missing"), "new_context should cite missing transition law");

  const activation = activationByCapability.get(capability.capabilityId);
  assert(activation.state === "suspended", "known-disabled activation should be suspended");
  assert(activation.effect === "deny", "known-disabled activation should deny");
  assert(activation.familyExtension.blockedActivation === true, "known-disabled activation should carry blockedActivation");

  const declaration = declarationByActivation.get(activation.activationId);
  assert(declaration.providerDeclared === false, "known-disabled declaration must not provider-declare");
  assert(declaration.modelCallable === false, "known-disabled declaration must not be callable");

  const eligibility = eligibilityByTool.get(toolName);
  assert(eligibility.residentVisibleState === "known_disabled", "new_context should be known disabled");
  assert(eligibility.profileStatus === "known_disabled", "new_context profile status should be known disabled");
}

assert(profile.providerTransportStarted === false, "profile must not start provider transport");
assert(profile.providerDeclarationEnabled === false, "profile must not enable provider declaration");
assert(profile.residentCallableEnabled === false, "profile must not enable resident-callable tools");
assert(profile.executorCallsStarted === false, "profile must not call executor");
assert(profile.permissionGrantEnabled === false, "profile must not grant permissions");
assert(profile.workspaceMutationStarted === false, "profile must not mutate workspace");
assert(profile.contextWorldMutationStarted === false, "profile must not mutate context world");
assert(profile.requestShapeMutationStarted === false, "profile must not mutate provider request shape");
assert(profile.rawPromptIncluded === false, "profile must not expose raw prompt");
assert(profile.rawTranscriptIncluded === false, "profile must not expose raw transcript");
assert(profile.rawProviderPayloadIncluded === false, "profile must not expose raw provider payload");
assert(profile.rawImageBytesIncluded === false, "profile must not expose raw image bytes");
assert(profile.rawPathIncluded === false, "profile must not expose raw paths");

const serialized = JSON.stringify(profile);
assert(!serialized.includes("\"providerTransportStarted\":true"), "provider transport leak");
assert(!serialized.includes("\"providerDeclared\":true"), "provider declaration leak");
assert(!serialized.includes("\"modelCallable\":true"), "model callable leak");
assert(!serialized.includes("\"residentCallableEnabled\":true"), "resident callable leak");
assert(!serialized.includes("\"permissionGrantEnabled\":true"), "permission grant leak");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt leak");
assert(!serialized.includes("\"rawTranscriptIncluded\":true"), "raw transcript leak");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload leak");
assert(!serialized.includes("\"rawImageBytesIncluded\":true"), "raw image bytes leak");
assert(!serialized.includes("\"rawPathIncluded\":true"), "raw path leak");

expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  providerTransportStarted: true,
}), "human_control_capability_profile_authority_or_raw_leak:providerTransportStarted");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  providerDeclarationEnabled: true,
}), "human_control_capability_profile_authority_or_raw_leak:providerDeclarationEnabled");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  residentCallableEnabled: true,
}), "human_control_capability_profile_authority_or_raw_leak:residentCallableEnabled");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  permissionGrantEnabled: true,
}), "human_control_capability_profile_authority_or_raw_leak:permissionGrantEnabled");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  capabilityRows: [],
}), "human_control_capability_profile_incomplete_array:capabilityRows");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  knownDisabledTools: [],
}), "human_control_capability_profile_known_disabled_missing:new_context");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  guardedTools: profile.guardedTools.filter((row) => row.toolName !== "view_image"),
}), "human_control_capability_profile_guarded_tool_missing:view_image");
expectThrows(() => validateHumanControlCapabilityProfile({
  ...profile,
  declarationEligibilityRows: profile.declarationEligibilityRows.map((row) => (
    row.toolName === "request_permissions" ? { ...row, permissionGrantAllowedInPr103: true } : row
  )),
}), "human_control_capability_profile_eligibility_authority_leak:request_permissions");

console.log(JSON.stringify({
  ok: true,
  profileId: profile.profileId,
  residentProfileTools: profile.residentProfileTools,
  guardedTools: profile.guardedTools.map((row) => row.toolName),
  knownDisabledTools: profile.knownDisabledTools,
  capabilityRows: profile.capabilityRows.length,
  profileDigest: profile.profileDigest.value,
}, null, 2));
