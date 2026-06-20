#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA,
  EXTERNAL_CAPABILITY_PROFILE_SCHEMA,
  EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA,
  MCP_SERVER_IDENTITY_WITNESS_SCHEMA,
  MCP_SERVER_SELECTOR_BLOCKER_SCHEMA,
  buildExternalCapabilityProfile,
  capabilityWitnessFor,
  mcpServerIdentityFor,
  selectorBlockerFor,
  validateExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error?.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error?.message || error}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const profile = buildExternalCapabilityProfile({
  projectId: "project_wave18_pr109_fixture",
  workThreadId: "work_thread_wave18_pr109_fixture",
  generatedAt: "2026-06-20T09:00:00.000Z",
});

assert(profile.schema === EXTERNAL_CAPABILITY_PROFILE_SCHEMA, "profile schema mismatch");
assert(profile.compactWitness.schema === EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA, "compact witness schema mismatch");
assert(profile.serverIdentities.every((row) => row.schema === MCP_SERVER_IDENTITY_WITNESS_SCHEMA), "server identity schema mismatch");
assert(profile.selectorBlockers.every((row) => row.schema === MCP_SERVER_SELECTOR_BLOCKER_SCHEMA), "selector blocker schema mismatch");
assert(profile.capabilityRows.every((row) => row.schema === EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA), "capability witness schema mismatch");
assert(profile.discoveryRegistry.descriptorCount >= 6, "discovery registry fixture should be present");
assert(profile.mcpBoundaryStatus.resourceReadAllowed === false, "MCP boundary must remain non-executable");
assert(profile.pluginGovernanceStatus.pluginInstallAllowed === false, "plugin governance must block install");
assert(profile.byDescriptorKind.discovery_only >= 1, "discovery_only descriptor kind missing");
assert(profile.byDescriptorKind.external_resource >= 1, "external_resource descriptor kind missing");
assert(profile.byDescriptorKind.external_action_tool >= 1, "external_action_tool descriptor kind missing");
assert(profile.byDescriptorKind.plugin_candidate >= 1, "plugin_candidate descriptor kind missing");
assert(profile.byDescriptorKind.provider_hosted_tool >= 1, "provider_hosted_tool descriptor kind missing");
assert(profile.byExecutionState.eligible_pending_declaration >= 1, "eligible discovery state missing");
assert(profile.byExecutionState.readable_with_gate >= 1, "guarded read state missing");
assert(profile.byExecutionState.not_executable_in_wave18 >= 1, "dynamic block state missing");
assert(profile.byExecutionState.operator_only >= 1, "plugin operator-only state missing");
assert(profile.byExecutionState.future_wave >= 1, "future-wave state missing");
assert(profile.compactWitness.residentSummary.includes("discovery capabilities"), "resident summary should mention discovery");
validateExternalCapabilityProfile(profile);

const tools = new Map(profile.capabilityRows.map((row) => [row.toolName, row]));
for (const toolName of [
  "tool_search",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
  "mcp_dynamic_tool_call",
  "list_available_plugins_to_install",
  "request_plugin_install",
  "web_search",
  "image_generation",
]) {
  assert(tools.has(toolName), `missing external profile tool ${toolName}`);
  const row = tools.get(toolName);
  assert(row.providerDeclared === false, `${toolName} must not be provider-declared`);
  assert(row.residentCallable === false, `${toolName} must not be resident-callable in PR109`);
  assert(row.modelCallable === false, `${toolName} must not be model-callable in PR109`);
}

const readRow = tools.get("read_mcp_resource");
assert(readRow.executionState === "readable_with_gate", "read_mcp_resource should be profiled as guarded read");
assert(readRow.externalReadAllowed === false, "read_mcp_resource must not be allowed in PR109");
assert(readRow.blockerCodes.includes("mcp_server_ambiguous"), "read row should cite server ambiguity blocker");

const dynamicRow = tools.get("mcp_dynamic_tool_call");
assert(dynamicRow.executionState === "not_executable_in_wave18", "dynamic MCP row should stay non-executable");
assert(dynamicRow.dynamicExternalActionAllowed === false, "dynamic MCP row must block actions");

const installRow = tools.get("request_plugin_install");
assert(installRow.executionState === "blocked_deferred", "plugin install should be blocked/deferred");
assert(installRow.pluginInstallAllowed === false, "plugin install authority must be false");

for (const blockerCode of [
  "mcp_server_missing",
  "mcp_server_ambiguous",
  "mcp_server_disabled",
  "mcp_server_identity_stale",
  "mcp_server_auth_unavailable",
  "mcp_server_trust_unknown",
]) {
  assert(profile.selectorBlockers.some((row) => row.blockerCode === blockerCode), `missing blocker ${blockerCode}`);
}

const server = mcpServerIdentityFor({
  serverIdentityId: "mcp_server_safe_fixture",
  displayName: "Safe Fixture Server",
  trustState: "configured",
  enabledState: "enabled",
  freshness: "fresh",
});
assert(server.rawEndpointIncluded === false, "server identity must exclude raw endpoint");
assert(server.rawCredentialIncluded === false, "server identity must exclude raw credential");

const selectorBlocker = selectorBlockerFor({ blockerCode: "mcp_server_ambiguous" });
assert(selectorBlocker.blocksRead === true, "ambiguous selector should block reads");

const capability = capabilityWitnessFor({
  toolName: "fixture_external_tool",
  descriptorKind: "external_action_tool",
  executionState: "blocked_deferred",
  capabilityState: "blocked_deferred",
});
assert(capability.rawPayloadIncluded === false, "capability witness must exclude raw payloads");

const providerDeclaredProfile = clone(profile);
providerDeclaredProfile.capabilityRows[0].providerDeclared = true;
expectThrows(() => validateExternalCapabilityProfile(providerDeclaredProfile), "external_capability_witness_row");

const externalReadStartedProfile = clone(profile);
externalReadStartedProfile.externalReadStarted = true;
expectThrows(() => validateExternalCapabilityProfile(externalReadStartedProfile), "external_capability_profile_authority_leak:externalReadStarted");

const missingBlockerProfile = clone(profile);
missingBlockerProfile.selectorBlockers = missingBlockerProfile.selectorBlockers.filter((row) => row.blockerCode !== "mcp_server_ambiguous");
expectThrows(() => validateExternalCapabilityProfile(missingBlockerProfile), "missing_selector_blocker:mcp_server_ambiguous");

const rawEndpointProfile = clone(profile);
rawEndpointProfile.serverIdentities[0].rawEndpointIncluded = true;
expectThrows(() => validateExternalCapabilityProfile(rawEndpointProfile), "mcp_server_identity_authority_leak:rawEndpointIncluded");

const dynamicExecutableProfile = clone(profile);
const dynamicIndex = dynamicExecutableProfile.capabilityRows.findIndex((row) => row.toolName === "mcp_dynamic_tool_call");
dynamicExecutableProfile.capabilityRows[dynamicIndex].executionState = "readable_with_gate";
expectThrows(() => validateExternalCapabilityProfile(dynamicExecutableProfile), "external_capability_dynamic_action_not_blocked");

const pluginInflatedProfile = clone(profile);
const pluginIndex = pluginInflatedProfile.capabilityRows.findIndex((row) => row.toolName === "request_plugin_install");
pluginInflatedProfile.capabilityRows[pluginIndex].pluginInstallAllowed = true;
expectThrows(() => validateExternalCapabilityProfile(pluginInflatedProfile), "external_capability_witness_row");

const profileMissingProviderHosted = clone(profile);
profileMissingProviderHosted.capabilityRows = profileMissingProviderHosted.capabilityRows.filter((row) => row.descriptorKind !== "provider_hosted_tool");
expectThrows(() => validateExternalCapabilityProfile(profileMissingProviderHosted), "missing_tool:web_search");

const serialized = JSON.stringify(profile);
for (const forbidden of [
  "\"providerDeclarationStarted\":true",
  "\"externalReadStarted\":true",
  "\"dynamicExternalActionStarted\":true",
  "\"pluginInstallStarted\":true",
  "\"contextAdmissionStarted\":true",
  "\"providerDeclared\":true",
  "\"residentCallable\":true",
  "\"modelCallable\":true",
  "\"rawEndpointIncluded\":true",
  "\"rawCredentialIncluded\":true",
  "\"rawResourceUriIncluded\":true",
  "\"rawExternalPayloadIncluded\":true",
  "\"rawPayloadIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `profile leaked forbidden flag ${forbidden}`);
}

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T09:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic55.external-capability-profile"), "information registry should include external capability profile row");

console.log(JSON.stringify({
  ok: true,
  profileId: profile.profileId,
  rowCount: profile.capabilityRows.length,
  compactWitnessDigest: profile.compactWitness.witnessDigest,
}));
