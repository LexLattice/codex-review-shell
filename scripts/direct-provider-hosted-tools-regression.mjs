#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA,
  PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA,
  PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
  PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
  buildProviderHostedActivationSnapshot,
  buildProviderHostedDeclarationPolicy,
  buildProviderHostedRequestShapeProof,
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
assert(webContract.workspaceMutationAllowed === false, "web contract must not mutate workspace");
assert(webContract.rawPromptIncluded === false, "web contract must not include raw prompt");
assert(webContract.rawProviderPayloadIncluded === false, "web contract must not include raw provider payload");

const imageContract = buildImageGenerationArtifactContract({
  projectId: providerMetadataProfile.projectId,
  nowMs: 0,
});
assert(imageContract.schema === PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA, "image contract schema mismatch");
assert(imageContract.artifactPolicy.assetStorageRequired === true, "image contract should require asset storage policy");
assert(imageContract.artifactPolicy.rawPromptStorageAllowed === false, "image contract must not allow raw prompt storage");
assert(imageContract.rawResultIncluded === false, "image contract must not include raw result");
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
assert(status.activationSnapshot.schema === PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA, "status should include activation snapshot");
assert(status.declarationPolicy.schema === PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA, "status should include declaration policy");
assert(status.activationReadyCount === 0, "metadata-only status should not be activation-ready");
assert(status.declarationDecisionCount >= 4, "status should include per-mode declaration decisions");
assert(status.activationSnapshot.declarationDecisions.some((decision) => decision.toolKind === "web_search" && decision.decision === "activation_ready_only"), "profile-declared web search should be activation-ready only");
assert(status.activationSnapshot.declarationDecisions.some((decision) => decision.toolKind === "image_generation" && decision.decision === "activation_ready_only"), "profile-declared image generation should be activation-ready only");
assertProviderHostedToolsStatusSafe(status);

const webRequestShapeProof = buildProviderHostedRequestShapeProof({
  toolKind: "web_search",
  invocationMode: "model_mediated_provider_tool",
  providerProfileDigest: providerMetadataProfile.profileDigest,
  modelRef: { model: "gpt-5.5", reasoningEffort: "medium", serviceTier: "standard" },
  requestShapeDigest: "web_search_request_shape_digest_fixture",
  requestBuilderVersion: "fixture-web-search-builder@1",
  runtimeAccepted: true,
  resultShapeObserved: true,
  nowMs: 0,
});
assert(webRequestShapeProof.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA, "request-shape proof schema mismatch");
assert(webRequestShapeProof.runtimeAccepted === true, "request-shape proof should record runtime acceptance");
assert(webRequestShapeProof.resultShapeObserved === true, "request-shape proof should record observed result shape");
assert(webRequestShapeProof.rawProviderPayloadIncluded === false, "request-shape proof must not include raw provider payload");

const imageRequestShapeProof = buildProviderHostedRequestShapeProof({
  toolKind: "image_generation",
  invocationMode: "operator_triggered_provider_operation",
  providerProfileDigest: providerMetadataProfile.profileDigest,
  modelRef: { model: "gpt-5.5", reasoningEffort: "medium", serviceTier: "standard" },
  requestShapeDigest: "image_generation_request_shape_digest_fixture",
  requestBuilderVersion: "fixture-image-generation-builder@1",
  runtimeAccepted: true,
  resultShapeObserved: true,
  nowMs: 0,
});

const runtimeActivationSnapshot = buildProviderHostedActivationSnapshot({
  projectId: providerMetadataProfile.projectId,
  providerMetadataProfile,
  modelRef: { model: "gpt-5.5", reasoningEffort: "medium", serviceTier: "standard" },
  capabilities: [
    buildProviderHostedToolCapability({
      projectId: providerMetadataProfile.projectId,
      toolKind: "web_search",
      evidenceState: "runtime_probed",
      providerDeclarationState: "activation_ready",
      providerMetadataProfile,
      nowMs: 0,
    }),
    buildProviderHostedToolCapability({
      projectId: providerMetadataProfile.projectId,
      toolKind: "image_generation",
      evidenceState: "runtime_probed",
      providerDeclarationState: "activation_ready",
      providerMetadataProfile,
      nowMs: 0,
    }),
  ],
  requestShapeProofs: [webRequestShapeProof, imageRequestShapeProof],
  nowMs: 0,
});
assert(runtimeActivationSnapshot.schema === PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA, "activation snapshot schema mismatch");
assert(runtimeActivationSnapshot.activationReadyTools.some((tool) => tool.toolKind === "web_search" && tool.invocationMode === "model_mediated_provider_tool"), "runtime-probed web search should become resident activation-ready");
assert(runtimeActivationSnapshot.activationReadyTools.some((tool) => tool.toolKind === "image_generation" && tool.invocationMode === "operator_triggered_provider_operation"), "runtime-probed image generation should become operator activation-ready");
assert(!runtimeActivationSnapshot.activationReadyTools.some((tool) => tool.toolKind === "image_generation" && tool.invocationMode === "model_mediated_provider_tool"), "image generation must not be resident-callable by default");
assert(runtimeActivationSnapshot.declarationDecisions.some((decision) => decision.toolKind === "image_generation" && decision.invocationMode === "model_mediated_provider_tool" && decision.decision === "blocked_operator_gate_required"), "image generation resident mode should be operator-gated");

const runtimeStatus = buildProviderHostedToolsStatus({
  projectId: providerMetadataProfile.projectId,
  providerMetadataProfile,
  activationSnapshot: runtimeActivationSnapshot,
  nowMs: 0,
});
assert(runtimeStatus.activationReadyCount === 2, "runtime-probed status should have two activation-ready modes");
assert(runtimeStatus.providerHostedToolCallAllowed === false, "runtime-probed status still must not enable hosted calls in PR114");
assertProviderHostedToolsStatusSafe(runtimeStatus);

const unknownStatus = buildProviderHostedToolsStatus({
  projectId: "project_unknown_provider_hosted_fixture",
  nowMs: 0,
});
assert(unknownStatus.capabilityCount === 2, "unknown status should still expose two capability slots");
assert(unknownStatus.unknownCount === 2, "missing metadata should leave capabilities unknown");
assert(unknownStatus.supportedCount === 0, "missing metadata should not claim support");
assertProviderHostedToolsStatusSafe(unknownStatus);

const syntheticMetadataStatus = buildProviderHostedToolsStatus({
  projectId: "project_synthetic_provider_metadata_fixture",
  providerMetadataProfile: {
    schema: "direct_provider_metadata_profile@1",
    projectId: "project_synthetic_provider_metadata_fixture",
    generatedAt: "1970-01-01T00:00:00.000Z",
    profileDigest: "synthetic_profile_digest_without_hosted_tool_evidence",
    capabilities: {
      provider: {},
      tools: [],
    },
  },
  nowMs: 0,
});
assert(syntheticMetadataStatus.unknownCount === 2, "schema-only metadata should leave hosted tools unknown");
assert(syntheticMetadataStatus.unsupportedCount === 0, "schema-only metadata should not claim unsupported");
assertProviderHostedToolsStatusSafe(syntheticMetadataStatus);

const explicitUnsupportedStatus = buildProviderHostedToolsStatus({
  projectId: "project_explicit_provider_unsupported_fixture",
  providerMetadataProfile: {
    schema: "direct_provider_metadata_profile@1",
    projectId: "project_explicit_provider_unsupported_fixture",
    generatedAt: "1970-01-01T00:00:00.000Z",
    profileDigest: "explicit_profile_digest_without_hosted_tool_support",
    capabilities: {
      provider: {
        webSearch: false,
        imageGeneration: { status: "unsupported" },
      },
      tools: [],
    },
  },
  nowMs: 0,
});
assert(explicitUnsupportedStatus.unsupportedCount === 2, "explicit provider negatives should mark hosted tools unsupported");
assert(explicitUnsupportedStatus.unknownCount === 0, "explicit provider negatives should not remain unknown");
assertProviderHostedToolsStatusSafe(explicitUnsupportedStatus);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: status.projectId,
  providerHostedToolsStatus: status,
});
assert(settingsProjection.sections.providerHostedTools.available === true, "settings should expose provider-hosted tools");
assert(settingsProjection.sections.providerHostedTools.supportedCount === 2, "settings supported count mismatch");
assert(settingsProjection.sections.providerHostedTools.webSearchState === "profile_declared", "settings web state mismatch");
assert(settingsProjection.sections.providerHostedTools.imageGenerationState === "profile_declared", "settings image state mismatch");
assert(settingsProjection.sections.providerHostedTools.activationReadyCount === 0, "settings should show metadata-only activation is not callable");
assert(settingsProjection.sections.providerHostedTools.webSearchActivationDecision === "activation_ready_only", "settings should show web search activation blocker");
assert(settingsProjection.sections.providerHostedTools.imageGenerationResidentDecision === "activation_ready_only", "settings should show image generation resident blocker");
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
  assert(row.promotionState === "activation_gated", `${toolId} should be activation-gated`);
  assert(row.localExecutorState === "scaffolded", `${toolId} should cite scaffolded hosted module`);
  assert(row.localExecutor === "src/main/direct/provider/hosted-tools.js", `${toolId} should cite hosted tools module`);
  assert(row.providerDeclarationState === "not_declared", `${toolId} must not be provider-declared by this PR`);
  assert(row.requestShapeFamilies.includes("provider_hosted_request_shape_proof"), `${toolId} should require request-shape proof`);
  assert(row.requestShapeFamilies.includes("provider_hosted_tool_activation_snapshot"), `${toolId} should require activation snapshot`);
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

const hostileActivationStatus = buildProviderHostedToolsStatus({
  projectId: "hostile_activation",
  providerMetadataProfile,
  activationSnapshot: {
    ...runtimeActivationSnapshot,
    providerHostedToolCallAllowed: true,
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(hostileActivationStatus), "provider_hosted_activation_authority_leak");

const hostileProofStatus = buildProviderHostedToolsStatus({
  projectId: "hostile_proof",
  providerMetadataProfile,
  activationSnapshot: {
    ...runtimeActivationSnapshot,
    requestShapeProofs: [{
      ...webRequestShapeProof,
      rawProviderPayloadIncluded: true,
    }],
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(hostileProofStatus), "provider_hosted_request_shape_authority_leak");

const unsafeDeclarationPolicy = buildProviderHostedDeclarationPolicy({
  projectId: "unsafe_declaration_policy",
  nowMs: 0,
});
const unsafePolicyStatus = buildProviderHostedToolsStatus({
  projectId: "unsafe_declaration_policy",
  providerMetadataProfile,
  activationSnapshot: {
    ...runtimeActivationSnapshot,
    declarationPolicy: {
      ...unsafeDeclarationPolicy,
      profileDeclaredCallable: true,
    },
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(unsafePolicyStatus), "provider_hosted_declaration_policy_unsafe");

const hostileWebContractStatus = buildProviderHostedToolsStatus({
  projectId: "hostile_web_contract",
  providerMetadataProfile,
  webSearchContract: {
    ...buildWebSearchEvidenceContract({ projectId: "hostile_web_contract", nowMs: 0 }),
    rawPageContentIncluded: true,
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(hostileWebContractStatus), "provider_hosted_contract_authority_leak");

const hostileImageContractStatus = buildProviderHostedToolsStatus({
  projectId: "hostile_image_contract",
  providerMetadataProfile,
  imageGenerationContract: {
    ...buildImageGenerationArtifactContract({ projectId: "hostile_image_contract", nowMs: 0 }),
    rawImageBytesIncluded: true,
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(hostileImageContractStatus), "provider_hosted_contract_authority_leak");

const incompleteContractStatus = buildProviderHostedToolsStatus({
  projectId: "incomplete_contract",
  providerMetadataProfile,
  webSearchContract: {
    ...buildWebSearchEvidenceContract({ projectId: "incomplete_contract", nowMs: 0 }),
    rawPromptIncluded: undefined,
  },
  nowMs: 0,
});
expectThrows(() => assertProviderHostedToolsStatusSafe(incompleteContractStatus), "provider_hosted_contract_authority_leak");

const serialized = JSON.stringify({ webCapability, imageCapability, webContract, imageContract, status, runtimeStatus, settingsProjection });
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
