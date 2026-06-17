#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
  PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
  buildImageGenerationArtifactContract,
  buildProviderHostedToolCapability,
  buildProviderHostedToolsStatus,
  buildWebSearchEvidenceContract,
  assertProviderHostedToolsStatusSafe,
} = require("../src/main/direct/provider/hosted-tools");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    if (expectedMessage && !String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`expected ${expectedMessage}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected throw: ${expectedMessage}`);
}

function byToolId(registry) {
  return new Map(registry.rows.map((row) => [row.toolId, row]));
}

const providerMetadataProfile = {
  schema: "direct_provider_metadata_profile@1",
  projectId: "project_provider_hosted_fixture",
  generatedAt: "1970-01-01T00:00:00.000Z",
  profileDigest: "provider_metadata_digest_fixture",
  capabilities: {
    provider: {
      webSearch: { status: "available" },
      imageGeneration: true,
    },
    tools: [],
  },
};

const webCapability = buildProviderHostedToolCapability({
  projectId: providerMetadataProfile.projectId,
  toolKind: "web_search",
  providerMetadataProfile,
  nowMs: 0,
});
assert(webCapability.schema === PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA, "web capability schema mismatch");
assert(webCapability.toolKind === "web_search", "web capability kind mismatch");
assert(webCapability.evidenceState === "profile_declared", "web capability should be metadata-declared");
assert(webCapability.providerDeclarationState === "metadata_declared", "web provider declaration state mismatch");
assert(webCapability.providerHostedToolCallAllowed === false, "web hosted call must not be allowed");
assert(webCapability.rawResultIncluded === false, "web raw result must not be included");

const imageCapability = buildProviderHostedToolCapability({
  projectId: providerMetadataProfile.projectId,
  toolKind: "image_generation",
  providerMetadataProfile,
  nowMs: 0,
});
assert(imageCapability.schema === PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA, "image capability schema mismatch");
assert(imageCapability.toolKind === "image_generation", "image capability kind mismatch");
assert(imageCapability.evidenceState === "profile_declared", "image capability should be metadata-declared");
assert(imageCapability.rawPromptIncluded === false, "image raw prompt must not be included");

const webContract = buildWebSearchEvidenceContract({
  projectId: providerMetadataProfile.projectId,
  nowMs: 0,
});
assert(webContract.schema === PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA, "web contract schema mismatch");
assert(webContract.sourcePolicy.sourceUrlsRequired === true, "web contract should require source URLs");
assert(webContract.sourcePolicy.rawPageContentAllowed === false, "web contract must not allow raw page content");
assert(webContract.rawQueryIncluded === false, "web contract must not include raw query");

const imageContract = buildImageGenerationArtifactContract({
  projectId: providerMetadataProfile.projectId,
  nowMs: 0,
});
assert(imageContract.schema === PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA, "image contract schema mismatch");
assert(imageContract.artifactPolicy.assetStorageRequired === true, "image contract should require asset storage policy");
assert(imageContract.artifactPolicy.rawPromptStorageAllowed === false, "image contract must not allow raw prompt storage");
assert(imageContract.rawImageBytesIncluded === false, "image contract must not include raw image bytes");

const status = buildProviderHostedToolsStatus({
  projectId: providerMetadataProfile.projectId,
  providerMetadataProfile,
  nowMs: 0,
});
assert(status.schema === PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA, "status schema mismatch");
assert(status.capabilityCount === 2, "status should cover web and image capabilities");
assert(status.supportedCount === 2, "status supported count mismatch");
assert(status.providerMetadataDigest === providerMetadataProfile.profileDigest, "status metadata digest mismatch");
assert(status.providerToolDeclarationAllowed === false, "status must not allow provider declaration");
assert(status.providerHostedToolCallAllowed === false, "status must not allow hosted tool call");
assert(status.requestShapeMutationAllowed === false, "status must not mutate request shape");
assert(status.contextInjectionAllowed === false, "status must not inject context");
assertProviderHostedToolsStatusSafe(status);

const unknownStatus = buildProviderHostedToolsStatus({
  projectId: "project_unknown_provider_hosted_fixture",
  nowMs: 0,
});
assert(unknownStatus.capabilityCount === 2, "unknown status should still expose two capability slots");
assert(unknownStatus.unknownCount === 2, "missing metadata should leave capabilities unknown");
assert(unknownStatus.supportedCount === 0, "missing metadata should not claim support");
assertProviderHostedToolsStatusSafe(unknownStatus);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: status.projectId,
  providerHostedToolsStatus: status,
});
assert(settingsProjection.sections.providerHostedTools.available === true, "settings should expose provider-hosted tools");
assert(settingsProjection.sections.providerHostedTools.supportedCount === 2, "settings supported count mismatch");
assert(settingsProjection.sections.providerHostedTools.webSearchState === "profile_declared", "settings web state mismatch");
assert(settingsProjection.sections.providerHostedTools.imageGenerationState === "profile_declared", "settings image state mismatch");
assert(settingsProjection.authority.providerHostedToolCallAllowed === false, "settings must block provider-hosted calls");
assert(Array.isArray(settingsProjection.rows.providerHostedTools) && settingsProjection.rows.providerHostedTools.length >= 9, "settings should render hosted tool rows");
assert(settingsProjection.bridgeOrgans.includes("provider_hosted_tool_contracts"), "settings should cite hosted tool bridge organ");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const toolRegistry = buildToolCapabilityRegistry({
  projectId: status.projectId,
  nowMs: 0,
});
validateToolCapabilityRegistry(toolRegistry);
const toolRows = byToolId(toolRegistry);
for (const toolId of ["vanilla.hosted.web_search", "vanilla.hosted.image_generation"]) {
  const row = toolRows.get(toolId);
  assert(row, `missing hosted row ${toolId}`);
  assert(row.odeuFamily === "provider_hosted_tools", `${toolId} should be provider-hosted family`);
  assert(row.implementationState === "projection_only", `${toolId} should be projection-only`);
  assert(row.promotionState === "diagnostic_only", `${toolId} should remain diagnostic-only`);
  assert(row.localExecutorState === "scaffolded", `${toolId} should cite scaffolded hosted module`);
  assert(row.localExecutor === "src/main/direct/provider/hosted-tools.js", `${toolId} should cite hosted tools module`);
  assert(row.providerDeclarationState === "not_declared", `${toolId} must not be provider-declared by this PR`);
}

const audit = buildDirectInformationBridgeAudit({ generatedAt: "1970-01-01T00:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic29.provider-hosted-tool-contracts"), "information registry should include hosted tools row");

const hostile = buildProviderHostedToolsStatus({
  projectId: "hostile",
  providerMetadataProfile,
  nowMs: 0,
});
hostile.providerHostedToolCallAllowed = true;
expectThrows(() => assertProviderHostedToolsStatusSafe(hostile), "provider_hosted_tools_authority_leak");

const serialized = JSON.stringify({ webCapability, imageCapability, webContract, imageContract, status, settingsProjection });
for (const forbidden of [
  "\"providerToolDeclarationAllowed\":true",
  "\"providerHostedToolCallAllowed\":true",
  "\"providerTransportAllowed\":true",
  "\"requestShapeMutationAllowed\":true",
  "\"contextInjectionAllowed\":true",
  "\"workspaceMutationAllowed\":true",
  "\"rawProviderPayloadIncluded\":true",
  "\"rawPromptIncluded\":true",
  "\"rawResultIncluded\":true",
  "\"rawPageContentIncluded\":true",
  "\"rawImageBytesIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized hosted tool status leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  statusId: status.statusId,
  capabilityCount: status.capabilityCount,
  supportedCount: status.supportedCount,
  statusDigest: status.statusDigest,
}));
