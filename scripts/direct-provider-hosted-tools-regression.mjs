#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA,
  PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA,
  PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA,
  PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA,
  PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA,
  PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA,
  PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
  PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
  buildProviderHostedActivationSnapshot,
  buildProviderHostedDeclarationPolicy,
  buildProviderHostedImagePromptEnvelope,
  buildProviderHostedImagePromptPolicy,
  buildProviderHostedRawExposureScan,
  buildProviderHostedResultContextAdmission,
  buildProviderHostedRequestShapeProof,
  buildProviderHostedToolCallEnvelope,
  buildImageGenerationArtifactContract,
  buildProviderHostedToolCapability,
  buildProviderHostedToolsStatus,
  buildProviderHostedWebSearchQueryEnvelope,
  buildProviderHostedWebSearchQueryPolicy,
  buildProviderHostedWebSearchResultEnvelope,
  buildWebSearchEvidenceContract,
  assertProviderHostedResultContextAdmissionSafe,
  assertProviderHostedToolCallEnvelopeSafe,
  assertProviderHostedWebSearchResultEnvelopeSafe,
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

const inlineProofSnapshot = buildProviderHostedActivationSnapshot({
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
  ],
  requestShapeProofs: [{
    toolKind: "web_search",
    invocationMode: "model_mediated_provider_tool",
    requestShapeDigest: "inline_web_search_shape_digest",
    requestBuilderVersion: "fixture-inline-web-search-builder@1",
    runtimeAccepted: true,
    resultShapeObserved: true,
  }],
  nowMs: 0,
});
assert(inlineProofSnapshot.requestShapeProofs[0].observedAt === "1970-01-01T00:00:00.000Z", "inline proof should inherit snapshot nowMs deterministically");
assert(inlineProofSnapshot.activationReadyTools.some((tool) => tool.toolKind === "web_search" && tool.invocationMode === "model_mediated_provider_tool"), "inline proof should be scoped to snapshot provider/model and become activation-ready");

const mismatchedProofSnapshot = buildProviderHostedActivationSnapshot({
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
  ],
  requestShapeProofs: [
    buildProviderHostedRequestShapeProof({
      toolKind: "web_search",
      invocationMode: "model_mediated_provider_tool",
      providerProfileDigest: "different_provider_profile_digest",
      modelRef: { model: "gpt-5.5", reasoningEffort: "medium", serviceTier: "standard" },
      requestShapeDigest: "foreign_provider_shape_digest",
      requestBuilderVersion: "fixture-foreign-provider-builder@1",
      runtimeAccepted: true,
      resultShapeObserved: true,
      nowMs: 0,
    }),
    buildProviderHostedRequestShapeProof({
      toolKind: "web_search",
      invocationMode: "model_mediated_provider_tool",
      providerProfileDigest: providerMetadataProfile.profileDigest,
      modelRef: { model: "different-model", reasoningEffort: "medium", serviceTier: "standard" },
      requestShapeDigest: "foreign_model_shape_digest",
      requestBuilderVersion: "fixture-foreign-model-builder@1",
      runtimeAccepted: true,
      resultShapeObserved: true,
      nowMs: 0,
    }),
  ],
  nowMs: 0,
});
assert(mismatchedProofSnapshot.activationReadyTools.length === 0, "foreign provider/model proofs must not activate current snapshot");
assert(mismatchedProofSnapshot.declarationDecisions.some((decision) => decision.toolKind === "web_search" && decision.decision === "blocked_missing_request_shape_proof"), "mismatched proofs should behave as missing request-shape proof");

const missingShapeDigestSnapshot = buildProviderHostedActivationSnapshot({
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
  ],
  requestShapeProofs: [{
    ...webRequestShapeProof,
    requestShapeDigest: "",
  }],
  nowMs: 0,
});
assert(missingShapeDigestSnapshot.activationReadyTools.length === 0, "request-shape proof without digest must not be callable");

const runtimeStatus = buildProviderHostedToolsStatus({
  projectId: providerMetadataProfile.projectId,
  providerMetadataProfile,
  activationSnapshot: runtimeActivationSnapshot,
  nowMs: 0,
});
assert(runtimeStatus.activationReadyCount === 2, "runtime-probed status should have two activation-ready modes");
assert(runtimeStatus.providerHostedToolCallAllowed === false, "runtime-probed status still must not enable hosted calls in PR114");
assertProviderHostedToolsStatusSafe(runtimeStatus);

const webQueryPolicy = buildProviderHostedWebSearchQueryPolicy({
  projectId: providerMetadataProfile.projectId,
  maxQueryChars: 120,
  nowMs: 0,
});
assert(webQueryPolicy.schema === PROVIDER_HOSTED_WEB_SEARCH_QUERY_POLICY_SCHEMA, "web query policy schema mismatch");
assert(webQueryPolicy.rawQueryStored === false, "web query policy must not store raw query");

const imagePromptPolicy = buildProviderHostedImagePromptPolicy({
  projectId: providerMetadataProfile.projectId,
  rawPromptRetention: "redacted_preview",
  maxPromptChars: 240,
  nowMs: 0,
});
assert(imagePromptPolicy.schema === PROVIDER_HOSTED_IMAGE_PROMPT_POLICY_SCHEMA, "image prompt policy schema mismatch");
assert(imagePromptPolicy.operatorGateRequired === true, "image prompt policy should be operator-gated by default");
assert(imagePromptPolicy.rawPromptStored === false, "image prompt policy must not store raw prompt");

const rawScan = buildProviderHostedRawExposureScan({
  toolKind: "web_search",
  inputText: "normal public docs search",
  policy: webQueryPolicy,
  nowMs: 0,
});
assert(rawScan.schema === PROVIDER_HOSTED_RAW_EXPOSURE_SCAN_SCHEMA, "raw scan schema mismatch");
assert(rawScan.redactionState === "passed", "normal query should pass raw scan");
assert(rawScan.rawInputIncluded === false, "raw scan must not include input text");

const oversizedScan = buildProviderHostedRawExposureScan({
  toolKind: "web_search",
  inputText: "x".repeat(webQueryPolicy.maxQueryChars + 1),
  policy: webQueryPolicy,
  nowMs: 0,
});
assert(oversizedScan.redactionState === "blocked", "oversized query should block raw scan");
assert(oversizedScan.findingClasses.includes("oversized_input"), "oversized query should report oversized_input");

const personalDataScan = buildProviderHostedRawExposureScan({
  toolKind: "web_search",
  inputText: "find contact for alice@example.com",
  policy: webQueryPolicy,
  nowMs: 0,
});
assert(personalDataScan.redactionState === "blocked", "personal-data query should block raw scan");
assert(personalDataScan.findingClasses.includes("unbounded_personal_data"), "personal-data query should report unbounded_personal_data");

const webQueryEnvelope = buildProviderHostedWebSearchQueryEnvelope({
  callId: "call_query_fixture",
  queryText: "OpenAI Codex app-server docs",
  queryPolicy: webQueryPolicy,
  nowMs: 0,
});
assert(webQueryEnvelope.envelope.schema === PROVIDER_HOSTED_WEB_SEARCH_QUERY_ENVELOPE_SCHEMA, "web query envelope schema mismatch");
assert(webQueryEnvelope.envelope.redactionState === "passed", "safe web query should pass");
assert(webQueryEnvelope.envelope.rawQueryStored === false, "web query envelope must not store raw query");

const imagePromptEnvelope = buildProviderHostedImagePromptEnvelope({
  callId: "call_prompt_fixture",
  promptText: "Create a neutral geometric study image.",
  promptPolicy: imagePromptPolicy,
  nowMs: 0,
});
assert(imagePromptEnvelope.envelope.schema === PROVIDER_HOSTED_IMAGE_PROMPT_ENVELOPE_SCHEMA, "image prompt envelope schema mismatch");
assert(imagePromptEnvelope.envelope.redactionState === "passed", "safe image prompt should pass");
assert(imagePromptEnvelope.envelope.rawPromptStored === false, "image prompt envelope must not store raw prompt");

const webCallEnvelope = buildProviderHostedToolCallEnvelope({
  toolKind: "web_search",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_web_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  queryText: "OpenAI Codex app-server docs",
  queryPolicy: webQueryPolicy,
  nowMs: 0,
});
assert(webCallEnvelope.schema === PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA, "web call envelope schema mismatch");
assert(webCallEnvelope.authorityDecision === "allowed", "runtime-probed web call envelope should be allowed");
assert(webCallEnvelope.sideEffectClass === "external_epistemic_read", "web call side-effect class mismatch");
assert(webCallEnvelope.providerTransportAllowed === false, "PR115 must not enable provider transport");
assert(webCallEnvelope.providerHostedToolCallAllowed === false, "PR115 must not execute hosted call");
assert(webCallEnvelope.replayPolicy.mayAutoRetry === false, "web call must not auto-retry");
assertProviderHostedToolCallEnvelopeSafe(webCallEnvelope);

const webSearchResultEnvelope = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_ref_fixture",
  resultSummary: "OpenAI Codex app-server documentation describes thread and turn event surfaces.",
  summaryKind: "provider_reported_summary",
  sourceRefs: [
    {
      sourceId: "source_docs",
      url: "https://developers.openai.com/codex/app-server",
      title: "Codex app-server docs",
      sourceType: "documentation",
      retrievalConfidence: "provider_cited",
      contentAccess: "provider_citation_only",
      trustPosture: "provider_reported",
    },
  ],
  admittedSourceIds: ["source_docs"],
  nowMs: 0,
});
assert(webSearchResultEnvelope.schema === PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA, "web search result envelope schema mismatch");
assert(webSearchResultEnvelope.redactionState === "not_needed", "safe web result should be admissible");
assert(webSearchResultEnvelope.sourceRefs.length === 1, "safe web result should retain one source ref");
assert(webSearchResultEnvelope.sourceRefs[0].urlEvidenceKey.startsWith("web_url_"), "source URL should be evidence-keyed");
assert(webSearchResultEnvelope.rawPageContentIncluded === false, "web result must not include raw page content");
assert(webSearchResultEnvelope.rawProviderPayloadIncluded === false, "web result must not include raw provider payload");
assertProviderHostedWebSearchResultEnvelopeSafe(webSearchResultEnvelope);

const webSearchAdmission = buildProviderHostedResultContextAdmission({
  resultEnvelope: webSearchResultEnvelope,
  admissionKind: "summary",
  nowMs: 0,
});
assert(webSearchAdmission.schema === PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA, "web search admission schema mismatch");
assert(webSearchAdmission.admissionDecision === "admit", "safe web result summary should be admitted");
assert(webSearchAdmission.visibility.residentContext === "summary", "summary admission should expose resident summary");
assert(webSearchAdmission.durableMemoryAdmission === false, "web result admission must not start durable memory");
assert(webSearchAdmission.projectTruthGranted === false, "web result admission must not grant project truth");
assertProviderHostedResultContextAdmissionSafe(webSearchAdmission);

const webSearchSourceRefAdmission = buildProviderHostedResultContextAdmission({
  resultEnvelope: webSearchResultEnvelope,
  admissionKind: "source_refs",
  nowMs: 0,
});
assert(webSearchSourceRefAdmission.admissionDecision === "admit", "source refs should be admissible when citations exist");
assert(webSearchSourceRefAdmission.visibility.residentContext === "source_refs", "source refs admission should expose resident source refs");
assertProviderHostedResultContextAdmissionSafe(webSearchSourceRefAdmission);

const boundedExcerptAdmission = buildProviderHostedResultContextAdmission({
  resultEnvelope: webSearchResultEnvelope,
  admissionKind: "bounded_excerpt",
  nowMs: 0,
});
assert(boundedExcerptAdmission.admissionDecision === "admit_degraded", "bounded excerpt should degrade without raw page content");
assert(boundedExcerptAdmission.visibility.residentContext === "bounded_excerpt", "bounded excerpt admission should be explicit");
assertProviderHostedResultContextAdmissionSafe(boundedExcerptAdmission);

const unsafeUrlWebResult = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_unsafe_url_fixture",
  resultSummary: "Unsafe source URL should not be admitted.",
  sourceRefs: [{ sourceId: "unsafe", url: "javascript:alert(1)", title: "unsafe" }],
  admittedSourceIds: ["unsafe"],
  nowMs: 0,
});
assert(unsafeUrlWebResult.redactionState === "blocked", "unsafe source URL should block result envelope");
assert(unsafeUrlWebResult.sourceRefs.length === 0, "unsafe source URL should not become a source ref");
assertProviderHostedWebSearchResultEnvelopeSafe(unsafeUrlWebResult);
const unsafeUrlAdmission = buildProviderHostedResultContextAdmission({
  resultEnvelope: unsafeUrlWebResult,
  admissionKind: "summary",
  nowMs: 0,
});
assert(unsafeUrlAdmission.admissionDecision === "block_raw_exposure", "blocked web result should not be admitted");
assertProviderHostedResultContextAdmissionSafe(unsafeUrlAdmission);

const credentialedQueryUrlWebResult = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_secret_query_url_fixture",
  resultSummary: "Credentialed query URL should not be admitted.",
  sourceRefs: [{ sourceId: "secret_query", url: "https://example.com/result?api_key=secret123456789", title: "secret query" }],
  admittedSourceIds: ["secret_query"],
  nowMs: 0,
});
assert(credentialedQueryUrlWebResult.redactionState === "blocked", "credential-bearing query URL should block result envelope");
assert(credentialedQueryUrlWebResult.sourceRefs.length === 0, "credential-bearing query URL should not become a source ref");
assertProviderHostedWebSearchResultEnvelopeSafe(credentialedQueryUrlWebResult);

const filteredBeforeLimitWebResult = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_filter_before_limit_fixture",
  resultSummary: "Valid sources after invalid entries should still be retained.",
  webSearchLimits: { maxSources: 1 },
  sourceRefs: [
    { sourceId: "unsafe_first", url: "javascript:alert(1)", title: "unsafe first" },
    { sourceId: "safe_second", url: "https://example.com/safe", title: "safe second" },
  ],
  admittedSourceIds: ["safe_second"],
  nowMs: 0,
});
assert(filteredBeforeLimitWebResult.redactionState === "not_needed", "valid source after invalid entry should be admitted before limit");
assert(filteredBeforeLimitWebResult.sourceRefs.length === 1, "source limit should apply after filtering invalid sources");
assert(filteredBeforeLimitWebResult.sourceRefs[0].sourceId === "safe_second", "filtered source should retain the valid source");
assertProviderHostedWebSearchResultEnvelopeSafe(filteredBeforeLimitWebResult);

const emptyAdmittedSourcesWebResult = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_empty_admitted_fixture",
  resultSummary: "Explicit empty admitted source list should not fall back to all sources.",
  sourceRefs: [{ sourceId: "source_available", url: "https://example.com/available", title: "available" }],
  admittedSourceIds: [],
  nowMs: 0,
});
assert(emptyAdmittedSourcesWebResult.redactionState === "blocked", "empty admitted source list should block result envelope");
assert(emptyAdmittedSourcesWebResult.citationParity.admittedSourceIds.length === 0, "empty admitted source list should stay empty");
assert(emptyAdmittedSourcesWebResult.blockerCodes.includes("admitted_source_refs_missing"), "empty admitted source list should record blocker");
assertProviderHostedWebSearchResultEnvelopeSafe(emptyAdmittedSourcesWebResult);

const explicitlyBlockedAdmission = buildProviderHostedResultContextAdmission({
  resultEnvelope: webSearchResultEnvelope,
  admissionKind: "blocked",
  nowMs: 0,
});
assert(explicitlyBlockedAdmission.admissionDecision === "block_policy", "explicit blocked admission kind must remain blocked");
assert(explicitlyBlockedAdmission.visibility.residentContext === "none", "explicit blocked admission must not expose resident context");
assertProviderHostedResultContextAdmissionSafe(explicitlyBlockedAdmission);

const inventedCitationWebResult = buildProviderHostedWebSearchResultEnvelope({
  callEnvelope: webCallEnvelope,
  providerResultRef: "provider_web_result_invented_citation_fixture",
  resultSummary: "Invented citation should be blocked.",
  sourceRefs: [{ sourceId: "source_real", url: "https://example.com/real", title: "real" }],
  admittedSourceIds: ["source_real", "source_missing"],
  nowMs: 0,
});
assert(inventedCitationWebResult.redactionState === "blocked", "invented citation parity should block result envelope");
assert(inventedCitationWebResult.citationParity.inventedCitationDetected === true, "invented citation should be detected");
assertProviderHostedWebSearchResultEnvelopeSafe(inventedCitationWebResult);

const blockedSecretWebCall = buildProviderHostedToolCallEnvelope({
  toolKind: "web_search",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_secret_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  queryText: "search https://user:pass@example.com with bearer abcdefghijklmnop",
  queryPolicy: webQueryPolicy,
  nowMs: 0,
});
assert(blockedSecretWebCall.authorityDecision === "blocked_raw_exposure_risk", "secret query should block hosted call envelope");
assert(blockedSecretWebCall.inputEnvelope.redactionState === "blocked", "secret query envelope should be blocked");
assert(blockedSecretWebCall.inputEnvelope.queryPreview === "", "blocked secret query must not expose preview text");
assertProviderHostedToolCallEnvelopeSafe(blockedSecretWebCall);

const stalePassedScanWebCall = buildProviderHostedToolCallEnvelope({
  toolKind: "web_search",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_stale_scan_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  queryText: "search https://user:pass@example.com with bearer abcdefghijklmnop",
  queryPolicy: webQueryPolicy,
  rawExposureScan: rawScan,
  nowMs: 0,
});
assert(stalePassedScanWebCall.authorityDecision === "blocked_raw_exposure_risk", "mismatched passed scan must not authorize secret query");
assert(stalePassedScanWebCall.inputEnvelope.redactionState === "blocked", "mismatched passed scan should be recomputed against current query");
assert(stalePassedScanWebCall.inputEnvelope.queryPreview === "", "recomputed blocked query must not expose preview text");
assertProviderHostedToolCallEnvelopeSafe(stalePassedScanWebCall);

const missingActivationCall = buildProviderHostedToolCallEnvelope({
  toolKind: "web_search",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_missing_activation_fixture",
  queryText: "OpenAI Codex docs",
  queryPolicy: webQueryPolicy,
  nowMs: 0,
});
assert(missingActivationCall.authorityDecision === "blocked_missing_declaration", "missing activation should block hosted call envelope");
assertProviderHostedToolCallEnvelopeSafe(missingActivationCall);

const residentImageCall = buildProviderHostedToolCallEnvelope({
  toolKind: "image_generation",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_resident_image_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  promptText: "Create a neutral geometric study image.",
  promptPolicy: imagePromptPolicy,
  nowMs: 0,
});
assert(residentImageCall.authorityDecision === "blocked_operator_gate_required", "resident image generation should remain operator-gated");
assert(residentImageCall.sideEffectClass === "generated_artifact_production", "image call side-effect class mismatch");
assertProviderHostedToolCallEnvelopeSafe(residentImageCall);

const spoofedResidentOperatorImageCall = buildProviderHostedToolCallEnvelope({
  toolKind: "image_generation",
  callSurface: "resident_tool",
  invocationMode: "operator_triggered_provider_operation",
  caller: "resident",
  turnId: "turn_provider_hosted_spoofed_resident_image_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  promptText: "Create a neutral geometric study image.",
  promptPolicy: imagePromptPolicy,
  nowMs: 0,
});
assert(spoofedResidentOperatorImageCall.authorityDecision === "blocked_operator_gate_required", "resident caller must not select operator invocation mode");
assertProviderHostedToolCallEnvelopeSafe(spoofedResidentOperatorImageCall);

const operatorImageCall = buildProviderHostedToolCallEnvelope({
  toolKind: "image_generation",
  callSurface: "operator_ui",
  invocationMode: "operator_triggered_provider_operation",
  caller: "operator",
  turnId: "turn_provider_hosted_operator_image_fixture",
  activationSnapshot: runtimeActivationSnapshot,
  promptText: "Create a neutral geometric study image.",
  promptPolicy: imagePromptPolicy,
  nowMs: 0,
});
assert(operatorImageCall.authorityDecision === "allowed", "operator-gated image envelope should be allowed with activation proof");
assert(operatorImageCall.replayPolicy.requiresFreshOperatorIntent === true, "operator image call should require fresh operator intent");
assert(operatorImageCall.providerTransportAllowed === false, "operator image envelope still must not enable provider transport");
assertProviderHostedToolCallEnvelopeSafe(operatorImageCall);

const staleActivationWebCall = buildProviderHostedToolCallEnvelope({
  toolKind: "web_search",
  callSurface: "resident_tool",
  invocationMode: "model_mediated_provider_tool",
  caller: "resident",
  turnId: "turn_provider_hosted_stale_activation_fixture",
  activationSnapshot: {
    ...runtimeActivationSnapshot,
    expiresAt: "1970-01-01T00:00:01.000Z",
  },
  queryText: "OpenAI Codex app-server docs",
  queryPolicy: webQueryPolicy,
  nowMs: Date.parse("1970-01-01T00:00:02.000Z"),
});
assert(staleActivationWebCall.authorityDecision === "blocked_stale_declaration", "stale activation snapshot must not authorize hosted call envelope");
assertProviderHostedToolCallEnvelopeSafe(staleActivationWebCall);

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

const hostileCallEnvelope = {
  ...webCallEnvelope,
  providerTransportAllowed: true,
};
expectThrows(() => assertProviderHostedToolCallEnvelopeSafe(hostileCallEnvelope), "provider_hosted_call_envelope_authority_leak");

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
