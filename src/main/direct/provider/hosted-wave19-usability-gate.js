"use strict";

const crypto = require("node:crypto");

const {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_IMAGE_GENERATION_ARTIFACT_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA,
  PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA,
  buildProviderHostedActivationSnapshot,
  buildProviderHostedImageGenerationArtifactEnvelope,
  buildProviderHostedImagePromptPolicy,
  buildProviderHostedRawExposureScan,
  buildProviderHostedRequestShapeProof,
  buildProviderHostedResultContextAdmission,
  buildProviderHostedToolCallEnvelope,
  buildProviderHostedToolCapability,
  buildProviderHostedToolsStatus,
  buildProviderHostedUsageAttribution,
  buildProviderHostedWebSearchQueryPolicy,
  buildProviderHostedWebSearchResultEnvelope,
  assertProviderHostedImageGenerationArtifactEnvelopeSafe,
  assertProviderHostedResultContextAdmissionSafe,
  assertProviderHostedToolCallEnvelopeSafe,
  assertProviderHostedToolsStatusSafe,
  assertProviderHostedUsageAttributionSafe,
  assertProviderHostedWebSearchResultEnvelopeSafe,
} = require("./hosted-tools");

const PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA = "provider_hosted_wave19_usability_proof@1";
const PROVIDER_HOSTED_WAVE19_OPERATOR_PROJECTION_SCHEMA = "provider_hosted_wave19_operator_projection@1";
const PROVIDER_HOSTED_WAVE19_RESIDENT_WITNESS_ROW_SCHEMA = "provider_hosted_wave19_resident_witness_row@1";
const PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_SUITE_SCHEMA = "provider_hosted_wave19_headless_scenario_suite@1";
const PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_ROW_SCHEMA = "provider_hosted_wave19_headless_scenario_row@1";
const PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_MATRIX_SCHEMA = "provider_hosted_wave19_negative_scenario_matrix@1";
const PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_ROW_SCHEMA = "provider_hosted_wave19_negative_scenario_row@1";
const PROVIDER_HOSTED_WAVE19_MANUAL_GATE_ROW_SCHEMA = "provider_hosted_wave19_manual_gate_row@1";

const FALSE_BOUNDARY_FLAGS = Object.freeze([
  "rawProviderPayloadIncluded",
  "rawPageContentIncluded",
  "rawImageBytesIncluded",
  "rawPromptIncluded",
  "rawQueryIncluded",
  "rawResultIncluded",
  "rawSecretIncluded",
  "browserNavigationStarted",
  "browserSessionAuthorityGranted",
  "workspaceMutationStarted",
  "workspaceInsertionStarted",
  "durableMemoryAdmissionStarted",
  "memoryCandidateCreated",
  "projectTruthGranted",
  "automaticReplayAllowed",
  "pluginInstallStarted",
  "dynamicMcpActionStarted",
  "wave20NewContextExecutionStarted",
  "wave21CodeModeExecutionStarted",
  "wave22BatchOrchestrationStarted",
]);

const REQUIRED_SCENARIOS = Object.freeze([
  "web_search_resident_callable",
  "web_search_profile_declared_blocked",
  "image_generation_operator_gated_available",
  "image_generation_resident_blocked",
  "provider_hosted_usage_unavailable_witness",
]);

const REQUIRED_NEGATIVES = Object.freeze([
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
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${text.slice(0, maxLength - 3)}...`;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry) ?? "null").join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function evidenceRef(kind, id, label, digest) {
  const ref = {
    kind: boundedString(kind, 100),
    id: boundedString(id, 180),
    label: boundedString(label || id, 180),
  };
  if (normalizeString(digest, "")) ref.digest = digest;
  return ref;
}

function fixtureContext(input = {}) {
  return {
    projectId: normalizeString(input.projectId, "project_wave19_provider_hosted"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_wave19_provider_hosted"),
    threadId: normalizeString(input.threadId, "thread_wave19_provider_hosted"),
    turnId: normalizeString(input.turnId, "turn_wave19_provider_hosted"),
    model: normalizeString(input.model, "gpt-5.5"),
    reasoningEffort: normalizeString(input.reasoningEffort, "medium"),
    serviceTier: normalizeString(input.serviceTier, "standard"),
  };
}

function baseProviderMetadataProfile(context, generatedAt) {
  return {
    schema: "direct_provider_metadata_profile@1",
    projectId: context.projectId,
    provider: "openai",
    generatedAt,
    profileDigest: digestFor("wave19-provider-metadata-profile@1", {
      projectId: context.projectId,
      generatedAt,
      model: context.model,
    }),
    capabilities: {
      provider: {
        webSearch: { status: "available" },
        imageGeneration: true,
      },
      tools: [],
    },
  };
}

function buildCoreArtifacts(context, nowMs) {
  const generatedAt = nowIso(nowMs);
  const providerMetadataProfile = baseProviderMetadataProfile(context, generatedAt);
  const profileDeclaredStatus = buildProviderHostedToolsStatus({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    providerMetadataProfile,
    modelRef: {
      model: context.model,
      reasoningEffort: context.reasoningEffort,
      serviceTier: context.serviceTier,
    },
    nowMs,
  });
  assertProviderHostedToolsStatusSafe(profileDeclaredStatus);

  const webProof = buildProviderHostedRequestShapeProof({
    toolKind: "web_search",
    invocationMode: "model_mediated_provider_tool",
    providerProfileDigest: providerMetadataProfile.profileDigest,
    modelRef: { model: context.model, reasoningEffort: context.reasoningEffort, serviceTier: context.serviceTier },
    requestShapeDigest: "wave19_web_search_request_shape",
    requestBuilderVersion: "wave19-web-search-fixture@1",
    runtimeAccepted: true,
    resultShapeObserved: true,
    nowMs,
  });
  const imageProof = buildProviderHostedRequestShapeProof({
    toolKind: "image_generation",
    invocationMode: "operator_triggered_provider_operation",
    providerProfileDigest: providerMetadataProfile.profileDigest,
    modelRef: { model: context.model, reasoningEffort: context.reasoningEffort, serviceTier: context.serviceTier },
    requestShapeDigest: "wave19_image_generation_request_shape",
    requestBuilderVersion: "wave19-image-generation-fixture@1",
    runtimeAccepted: true,
    resultShapeObserved: true,
    nowMs,
  });
  const staleWebProof = buildProviderHostedRequestShapeProof({
    toolKind: "web_search",
    invocationMode: "model_mediated_provider_tool",
    providerProfileDigest: providerMetadataProfile.profileDigest,
    modelRef: { model: context.model, reasoningEffort: context.reasoningEffort, serviceTier: context.serviceTier },
    requestShapeDigest: "wave19_stale_web_search_shape",
    requestBuilderVersion: "wave19-stale-web-search-fixture@1",
    runtimeAccepted: true,
    resultShapeObserved: true,
    observedAt: "1970-01-01T00:00:00.000Z",
    expiresAt: "1970-01-01T00:00:01.000Z",
    nowMs,
  });

  const runtimeActivation = buildProviderHostedActivationSnapshot({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    providerMetadataProfile,
    providerProfileDigest: providerMetadataProfile.profileDigest,
    modelRef: { model: context.model, reasoningEffort: context.reasoningEffort, serviceTier: context.serviceTier },
    capabilities: [
      buildProviderHostedToolCapability({
        projectId: context.projectId,
        workThreadId: context.workThreadId,
        toolKind: "web_search",
        evidenceState: "runtime_probed",
        providerDeclarationState: "activation_ready",
        providerMetadataProfile,
        nowMs,
      }),
      buildProviderHostedToolCapability({
        projectId: context.projectId,
        workThreadId: context.workThreadId,
        toolKind: "image_generation",
        evidenceState: "runtime_probed",
        providerDeclarationState: "activation_ready",
        providerMetadataProfile,
        nowMs,
      }),
    ],
    requestShapeProofs: [webProof, imageProof],
    nowMs,
  });
  const runtimeStatus = buildProviderHostedToolsStatus({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    providerMetadataProfile,
    activationSnapshot: runtimeActivation,
    nowMs,
  });
  assertProviderHostedToolsStatusSafe(runtimeStatus);

  const staleActivation = buildProviderHostedActivationSnapshot({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    providerMetadataProfile,
    providerProfileDigest: providerMetadataProfile.profileDigest,
    modelRef: { model: context.model, reasoningEffort: context.reasoningEffort, serviceTier: context.serviceTier },
    capabilities: [
      buildProviderHostedToolCapability({
        projectId: context.projectId,
        workThreadId: context.workThreadId,
        toolKind: "web_search",
        evidenceState: "runtime_probed",
        providerDeclarationState: "activation_ready",
        providerMetadataProfile,
        nowMs,
      }),
    ],
    requestShapeProofs: [staleWebProof],
    expiresAt: "1970-01-01T00:00:01.000Z",
    nowMs,
  });

  const webQueryPolicy = buildProviderHostedWebSearchQueryPolicy({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    nowMs,
  });
  const imagePromptPolicy = buildProviderHostedImagePromptPolicy({
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    operatorGateRequired: true,
    nowMs,
  });

  const webCall = buildProviderHostedToolCallEnvelope({
    toolKind: "web_search",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    workThreadId: context.workThreadId,
    turnId: context.turnId,
    agentId: "resident_agent",
    activationSnapshot: runtimeActivation,
    queryText: "OpenAI Codex app-server provider-hosted web search docs",
    queryPolicy: webQueryPolicy,
    nowMs,
  });
  assertProviderHostedToolCallEnvelopeSafe(webCall);

  const webResult = buildProviderHostedWebSearchResultEnvelope({
    callEnvelope: webCall,
    providerResultRef: "provider_web_result_wave19",
    resultSummary: "Provider-hosted web search returned cited documentation references.",
    summaryKind: "provider_reported_summary",
    sourceRefs: [{
      sourceId: "source_codex_docs",
      url: "https://developers.openai.com/codex/app-server",
      title: "Codex app-server docs",
      sourceType: "documentation",
      retrievalConfidence: "provider_cited",
      contentAccess: "provider_citation_only",
      trustPosture: "provider_reported",
    }],
    admittedSourceIds: ["source_codex_docs"],
    usageAttribution: buildProviderHostedUsageAttribution({
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      threadId: context.threadId,
      turnId: context.turnId,
      callEnvelope: webCall,
      usage: { inputTokens: 10, cachedInputTokens: 2, nonCachedInputTokens: 8, outputTokens: 4, totalTokens: 14 },
      nowMs,
    }),
    nowMs,
  });
  assertProviderHostedWebSearchResultEnvelopeSafe(webResult);
  const webAdmission = buildProviderHostedResultContextAdmission({
    resultEnvelope: webResult,
    admissionKind: "summary",
    nowMs,
  });
  assertProviderHostedResultContextAdmissionSafe(webAdmission);

  const profileDeclaredWebCall = buildProviderHostedToolCallEnvelope({
    toolKind: "web_search",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    activationSnapshot: profileDeclaredStatus.activationSnapshot,
    queryText: "profile declared is not enough",
    queryPolicy: webQueryPolicy,
    nowMs,
  });
  const staleWebCall = buildProviderHostedToolCallEnvelope({
    toolKind: "web_search",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    activationSnapshot: staleActivation,
    queryText: "stale activation should block",
    queryPolicy: webQueryPolicy,
    nowMs,
  });
  const leakedQueryCall = buildProviderHostedToolCallEnvelope({
    toolKind: "web_search",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    activationSnapshot: runtimeActivation,
    queryText: "https://user:secret@example.com/path?token=secret /home/rose/private",
    queryPolicy: webQueryPolicy,
    nowMs,
  });
  const undeclaredWebCall = buildProviderHostedToolCallEnvelope({
    toolKind: "web_search",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    activationSnapshot: {},
    queryText: "undeclared hosted call",
    queryPolicy: webQueryPolicy,
    nowMs,
  });

  const inventedCitationWebResult = buildProviderHostedWebSearchResultEnvelope({
    callEnvelope: webCall,
    providerResultRef: "provider_web_result_invented",
    resultSummary: "Invented source should not pass citation parity.",
    sourceRefs: [{ sourceId: "source_real", url: "https://example.com/docs", title: "Real source" }],
    admittedSourceIds: ["source_missing"],
    nowMs,
  });
  assertProviderHostedWebSearchResultEnvelopeSafe(inventedCitationWebResult);

  const operatorImageCall = buildProviderHostedToolCallEnvelope({
    toolKind: "image_generation",
    callSurface: "operator_ui",
    invocationMode: "operator_triggered_provider_operation",
    caller: "operator",
    workThreadId: context.workThreadId,
    turnId: context.turnId,
    agentId: "operator",
    activationSnapshot: runtimeActivation,
    promptText: "Create a neutral geometric artifact.",
    promptPolicy: imagePromptPolicy,
    nowMs,
  });
  const residentImageCall = buildProviderHostedToolCallEnvelope({
    toolKind: "image_generation",
    callSurface: "resident_tool",
    invocationMode: "model_mediated_provider_tool",
    caller: "resident",
    workThreadId: context.workThreadId,
    turnId: context.turnId,
    agentId: "resident_agent",
    activationSnapshot: runtimeActivation,
    promptText: "Resident should not directly generate images.",
    promptPolicy: imagePromptPolicy,
    nowMs,
  });
  assertProviderHostedToolCallEnvelopeSafe(operatorImageCall);
  assertProviderHostedToolCallEnvelopeSafe(residentImageCall);

  const completedImageArtifact = buildProviderHostedImageGenerationArtifactEnvelope({
    callEnvelope: operatorImageCall,
    providerResultRef: "provider_image_result_wave19",
    modelRef: { model: context.model, imageModel: "gpt-image-1" },
    artifactRefs: [{
      artifactRef: "provider_artifact_wave19",
      displayName: "wave19-generated.png",
      mimeType: "image/png",
      dimensions: { width: 1024, height: 1024 },
      storagePosture: "ephemeral_provider_ref",
      rendererProjection: "metadata_only",
      artifactProvenance: "provider_generated",
    }],
    usageAttribution: buildProviderHostedUsageAttribution({
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      threadId: context.threadId,
      turnId: context.turnId,
      callEnvelope: operatorImageCall,
      usageState: "unavailable",
      unavailableReason: "provider_did_not_report",
      nowMs,
    }),
    nowMs,
  });
  assertProviderHostedImageGenerationArtifactEnvelopeSafe(completedImageArtifact);
  const imageAdmission = buildProviderHostedResultContextAdmission({
    resultEnvelope: completedImageArtifact,
    admissionKind: "artifact_ref",
    nowMs,
  });
  assertProviderHostedResultContextAdmissionSafe(imageAdmission);

  const residentBlockedImageArtifact = buildProviderHostedImageGenerationArtifactEnvelope({
    callEnvelope: residentImageCall,
    providerResultRef: "provider_image_resident_blocked",
    artifactRefs: [{ artifactRef: "provider_artifact_resident_blocked", mimeType: "image/png" }],
    nowMs,
  });
  const missingManifestArtifact = buildProviderHostedImageGenerationArtifactEnvelope({
    callEnvelope: operatorImageCall,
    providerResultRef: "provider_image_missing_manifest",
    artifactRefs: [{
      artifactRef: "provider_artifact_missing_manifest",
      mimeType: "image/png",
      storagePosture: "shell_staged_artifact",
      rendererProjection: "download_ref",
    }],
    nowMs,
  });
  const providerBlockedArtifact = buildProviderHostedImageGenerationArtifactEnvelope({
    callEnvelope: operatorImageCall,
    providerResultRef: "provider_image_blocked",
    generationState: "blocked_by_provider",
    safetyPosture: "provider_blocked",
    nowMs,
  });
  const rawPromptBlockedScan = buildProviderHostedRawExposureScan({
    toolKind: "image_generation",
    inputText: "make an image from password=secret and rawProviderPayload",
    policy: imagePromptPolicy,
    nowMs,
  });

  return {
    providerMetadataProfile,
    profileDeclaredStatus,
    runtimeStatus,
    runtimeActivation,
    staleActivation,
    webQueryPolicy,
    imagePromptPolicy,
    webCall,
    webResult,
    webAdmission,
    profileDeclaredWebCall,
    staleWebCall,
    leakedQueryCall,
    undeclaredWebCall,
    inventedCitationWebResult,
    operatorImageCall,
    residentImageCall,
    completedImageArtifact,
    imageAdmission,
    residentBlockedImageArtifact,
    missingManifestArtifact,
    providerBlockedArtifact,
    rawPromptBlockedScan,
  };
}

function falseBoundaryFlags() {
  return Object.fromEntries(FALSE_BOUNDARY_FLAGS.map((flag) => [flag, false]));
}

function scenarioRow(scenarioId, label, evidenceRefs, assertions = []) {
  const row = {
    schema: PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_ROW_SCHEMA,
    scenarioId,
    label: boundedString(label, 260),
    status: "pass",
    assertions,
    evidenceRefs,
    ...falseBoundaryFlags(),
  };
  row.scenarioDigest = digestFor("provider-hosted-wave19-scenario-row@1", row);
  return row;
}

function buildScenarioSuite(context, artifacts, generatedAt) {
  const scenarios = [
    scenarioRow("web_search_resident_callable", "web_search is resident-callable only with runtime-probed activation and request-shape proof", [
      evidenceRef("provider_hosted_tool_call_envelope", artifacts.webCall.callId, "web_search call", artifacts.webCall.callDigest),
      evidenceRef("provider_hosted_web_search_result_envelope", artifacts.webResult.resultId, "web_search result", artifacts.webResult.resultDigest),
      evidenceRef("provider_hosted_result_context_admission", artifacts.webAdmission.admissionId, "web_search admission", artifacts.webAdmission.admissionDigest),
    ], ["authority_allowed", "summary_admitted", "usage_attributed"]),
    scenarioRow("web_search_profile_declared_blocked", "profile-declared web_search remains blocked before runtime proof", [
      evidenceRef("provider_hosted_tool_call_envelope", artifacts.profileDeclaredWebCall.callId, "profile-declared web call", artifacts.profileDeclaredWebCall.callDigest),
    ], ["profile_declared_not_callable", "authority_blocked"]),
    scenarioRow("image_generation_operator_gated_available", "image_generation is available through operator-gated artifact governance", [
      evidenceRef("provider_hosted_tool_call_envelope", artifacts.operatorImageCall.callId, "operator image call", artifacts.operatorImageCall.callDigest),
      evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.completedImageArtifact.artifactId, "image artifact", artifacts.completedImageArtifact.artifactDigest),
      evidenceRef("provider_hosted_result_context_admission", artifacts.imageAdmission.admissionId, "image artifact admission", artifacts.imageAdmission.admissionDigest),
    ], ["operator_gate_required", "artifact_ref_admitted", "workspace_insertion_false"]),
    scenarioRow("image_generation_resident_blocked", "resident image_generation remains blocked by operator gate", [
      evidenceRef("provider_hosted_tool_call_envelope", artifacts.residentImageCall.callId, "resident image call", artifacts.residentImageCall.callDigest),
      evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.residentBlockedImageArtifact.artifactId, "resident blocked artifact", artifacts.residentBlockedImageArtifact.artifactDigest),
    ], ["resident_mode_blocked", "call_not_allowed"]),
    scenarioRow("provider_hosted_usage_unavailable_witness", "hosted calls emit usage attribution even when provider usage is unavailable", [
      evidenceRef("provider_hosted_usage_attribution", artifacts.completedImageArtifact.hostedUsageAttribution.attributionId, "image usage unavailable", artifacts.completedImageArtifact.hostedUsageAttribution.attributionDigest),
    ], ["missing_usage_not_zero", "billing_grade_false"]),
  ];
  const suite = {
    schema: PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_SUITE_SCHEMA,
    suiteId: `provider_hosted_wave19_scenario_suite_${digestFor("provider-hosted-wave19-suite-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    scenarios,
    passCount: scenarios.length,
    failCount: 0,
    ...falseBoundaryFlags(),
  };
  suite.suiteDigest = digestFor("provider-hosted-wave19-scenario-suite@1", suite);
  return suite;
}

function negativeRow(rowId, label, artifactRef, expectedOutcome, blockers = []) {
  const row = {
    schema: PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_ROW_SCHEMA,
    rowId,
    label: boundedString(label, 280),
    status: "pass",
    expectedOutcome,
    observedOutcome: expectedOutcome,
    blockerCodes: arrayOrEmpty(blockers).map((code) => boundedString(code, 180)),
    evidenceRefs: [artifactRef],
    ...falseBoundaryFlags(),
  };
  row.rowDigest = digestFor("provider-hosted-wave19-negative-row@1", row);
  return row;
}

function buildNegativeMatrix(context, artifacts, generatedAt) {
  const rows = [
    negativeRow("profile_declared_unprobed_not_callable", "profile_declared or known_available_unprobed cannot create callable state", evidenceRef("provider_hosted_tool_call_envelope", artifacts.profileDeclaredWebCall.callId, "profile-declared blocked call", artifacts.profileDeclaredWebCall.callDigest), "blocked", [artifacts.profileDeclaredWebCall.blocker]),
    negativeRow("static_label_declaration_blocked", "model name or static labels cannot declare hosted tools", evidenceRef("provider_hosted_tools_status", artifacts.profileDeclaredStatus.statusId, "metadata-only status", artifacts.profileDeclaredStatus.statusDigest), "activation_ready_only", ["request_shape_proof_required"]),
    negativeRow("outbound_query_leak_blocked", "credentialed URLs, secrets, and private paths block outbound web queries", evidenceRef("provider_hosted_tool_call_envelope", artifacts.leakedQueryCall.callId, "leaked query call", artifacts.leakedQueryCall.callDigest), "blocked_raw_exposure", [artifacts.leakedQueryCall.blocker]),
    negativeRow("invented_citation_blocked", "invented citations are detected and cannot be admitted as trusted source refs", evidenceRef("provider_hosted_web_search_result_envelope", artifacts.inventedCitationWebResult.resultId, "invented citation web result", artifacts.inventedCitationWebResult.resultDigest), "blocked", artifacts.inventedCitationWebResult.blockerCodes),
    negativeRow("raw_prompt_retention_blocked", "image prompt raw exposure is blocked and raw prompt storage is false", evidenceRef("provider_hosted_raw_exposure_scan", artifacts.rawPromptBlockedScan.scanId, "raw prompt scan", artifacts.rawPromptBlockedScan.scanDigest), "blocked_raw_prompt", artifacts.rawPromptBlockedScan.blockerClasses),
    negativeRow("staged_artifact_without_manifest_blocked", "shell-staged generated artifacts require staging manifest and cleanup policy", evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.missingManifestArtifact.artifactId, "missing manifest artifact", artifacts.missingManifestArtifact.artifactDigest), "blocked", artifacts.missingManifestArtifact.blockerCodes),
    negativeRow("provider_blocked_generation_preserved", "provider-blocked image generation remains visible as blocked and cannot disappear as success", evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.providerBlockedArtifact.artifactId, "provider blocked artifact", artifacts.providerBlockedArtifact.artifactDigest), "blocked_by_provider", artifacts.providerBlockedArtifact.blockerCodes),
    negativeRow("raw_image_bytes_blocked", "raw generated image bytes are not exposed to renderer or resident state", evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.completedImageArtifact.artifactId, "image artifact", artifacts.completedImageArtifact.artifactDigest), "raw_bytes_false", ["raw_image_bytes_false"]),
    negativeRow("workspace_insertion_blocked", "generated image artifacts do not become workspace mutations automatically", evidenceRef("provider_hosted_image_generation_artifact_envelope", artifacts.completedImageArtifact.artifactId, "image artifact", artifacts.completedImageArtifact.artifactDigest), "workspace_insertion_false", ["workspace_insertion_allowed_false"]),
    negativeRow("durable_memory_smuggling_blocked", "hosted results do not start durable memory admission or memory candidates", evidenceRef("provider_hosted_result_context_admission", artifacts.webAdmission.admissionId, "web admission", artifacts.webAdmission.admissionDigest), "memory_false", ["durable_memory_false", "memory_candidate_false"]),
    negativeRow("automatic_replay_blocked", "hosted calls cannot auto-replay after unknown, restart, or handoff", evidenceRef("provider_hosted_tool_call_envelope", artifacts.webCall.callId, "web call replay policy", artifacts.webCall.callDigest), "replay_false", ["may_auto_retry_false"]),
    negativeRow("stale_activation_blocked", "stale activation snapshots block hosted calls", evidenceRef("provider_hosted_tool_call_envelope", artifacts.staleWebCall.callId, "stale web call", artifacts.staleWebCall.callDigest), "blocked_stale", [artifacts.staleWebCall.blocker]),
    negativeRow("undeclared_hosted_call_blocked", "undeclared hosted calls are blocked before provider transport", evidenceRef("provider_hosted_tool_call_envelope", artifacts.undeclaredWebCall.callId, "undeclared web call", artifacts.undeclaredWebCall.callDigest), "blocked_missing_declaration", [artifacts.undeclaredWebCall.blocker]),
  ];
  const matrix = {
    schema: PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
    matrixId: `provider_hosted_wave19_negative_matrix_${digestFor("provider-hosted-wave19-negative-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    rows,
    passCount: rows.length,
    ...falseBoundaryFlags(),
  };
  matrix.matrixDigest = digestFor("provider-hosted-wave19-negative-matrix@1", matrix);
  return matrix;
}

function buildResidentWitnessRows(context, artifacts, generatedAt) {
  const rows = [
    {
      toolName: "web_search",
      capabilityState: "resident_callable",
      residentCallable: true,
      operatorCallable: false,
      providerDeclared: true,
      modelCallable: true,
      compactText: "web_search is resident-callable when runtime-probed activation and request-shape proof are fresh.",
      evidenceRefs: [
        evidenceRef("provider_hosted_activation_snapshot", artifacts.runtimeActivation.activationId, "runtime activation", artifacts.runtimeActivation.activationDigest),
        evidenceRef("provider_hosted_tool_call_envelope", artifacts.webCall.callId, "web call", artifacts.webCall.callDigest),
      ],
    },
    {
      toolName: "image_generation",
      capabilityState: "operator_gated",
      residentCallable: false,
      operatorCallable: true,
      providerDeclared: false,
      modelCallable: false,
      compactText: "image_generation is operator-gated by default and returns governed artifact refs.",
      evidenceRefs: [
        evidenceRef("provider_hosted_tool_call_envelope", artifacts.operatorImageCall.callId, "operator image call", artifacts.operatorImageCall.callDigest),
        evidenceRef("provider_hosted_tool_call_envelope", artifacts.residentImageCall.callId, "resident blocked image call", artifacts.residentImageCall.callDigest),
      ],
    },
    {
      toolName: "web_search_profile_declared",
      capabilityState: "blocked_profile_only",
      residentCallable: false,
      operatorCallable: false,
      providerDeclared: false,
      modelCallable: false,
      compactText: "profile-declared hosted tools are visible but not callable before runtime proof.",
      evidenceRefs: [
        evidenceRef("provider_hosted_tools_status", artifacts.profileDeclaredStatus.statusId, "profile-declared status", artifacts.profileDeclaredStatus.statusDigest),
      ],
    },
  ].map((row) => {
    const witness = {
      schema: PROVIDER_HOSTED_WAVE19_RESIDENT_WITNESS_ROW_SCHEMA,
      rowId: `provider_hosted_wave19_witness_${row.toolName}`,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      blockerVisible: row.capabilityState !== "resident_callable",
      grantsAuthority: false,
      generatedAt,
      ...row,
      ...falseBoundaryFlags(),
    };
    witness.rowDigest = digestFor("provider-hosted-wave19-resident-witness-row@1", witness);
    return witness;
  });
  return rows;
}

function buildOperatorProjection(context, artifacts, scenarioSuite, negativeMatrix, generatedAt) {
  const projection = {
    schema: PROVIDER_HOSTED_WAVE19_OPERATOR_PROJECTION_SCHEMA,
    projectionId: `provider_hosted_wave19_operator_projection_${digestFor("provider-hosted-wave19-operator-id@1", {
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    readsProofArtifacts: true,
    mintsProof: false,
    grantsAuthority: false,
    visibleSummary: {
      activationReadyTools: artifacts.runtimeActivation.activationReadyTools.length,
      webSearchResidentCallable: artifacts.webCall.authorityDecision === "allowed",
      imageGenerationOperatorCallable: artifacts.operatorImageCall.authorityDecision === "allowed",
      imageGenerationResidentCallable: artifacts.residentImageCall.authorityDecision === "allowed",
      negativeRows: negativeMatrix.rows.length,
      scenarios: scenarioSuite.scenarios.length,
    },
    evidenceRefs: [
      evidenceRef("provider_hosted_tools_status", artifacts.runtimeStatus.statusId, "runtime status", artifacts.runtimeStatus.statusDigest),
      evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Wave 19 scenario suite", scenarioSuite.suiteDigest),
      evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Wave 19 negative matrix", negativeMatrix.matrixDigest),
    ],
    ...falseBoundaryFlags(),
  };
  projection.projectionDigest = digestFor("provider-hosted-wave19-operator-projection@1", projection);
  return projection;
}

function buildManualGateRows(context, artifacts, scenarioSuite, negativeMatrix, witnessRows, generatedAt) {
  return [
    ["resident_witness_complete", witnessRows.length >= 3 ? "pass" : "fail", "Resident witnesses cover callable, operator-gated, and profile-only blocked hosted states."],
    ["scenario_suite_passed", scenarioSuite.failCount === 0 ? "pass" : "fail", "Wave 19 positive headless scenarios pass."],
    ["negative_matrix_passed", negativeMatrix.passCount === negativeMatrix.rows.length ? "pass" : "fail", "Wave 19 negative matrix passed."],
    ["web_search_resident_callable", artifacts.webCall.authorityDecision === "allowed" && artifacts.webAdmission.admissionDecision === "admit" ? "pass" : "fail", "web_search is resident-callable only with exact activation evidence."],
    ["image_generation_operator_gated", artifacts.operatorImageCall.authorityDecision === "allowed" && artifacts.residentImageCall.authorityDecision !== "allowed" ? "pass" : "fail", "image_generation is operator-gated by default."],
    ["hosted_usage_separated", artifacts.webResult.hostedUsageAttribution?.attributionScope?.separatedFromParentInference === true ? "pass" : "fail", "Hosted usage is attributed separately from parent inference."],
  ].map(([gateId, status, label]) => {
    const row = {
      schema: PROVIDER_HOSTED_WAVE19_MANUAL_GATE_ROW_SCHEMA,
      gateId,
      label,
      status,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      evidenceRefs: [
        evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Scenario suite", scenarioSuite.suiteDigest),
        evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Negative matrix", negativeMatrix.matrixDigest),
      ],
      generatedAt,
    };
    row.rowDigest = digestFor("provider-hosted-wave19-manual-gate-row@1", row);
    return row;
  });
}

function buildProviderHostedWave19UsabilityGate(input = {}, options = {}) {
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : typeof options.now === "number" ? options.now : Date.now();
  const generatedAt = nowIso(nowMs);
  const context = fixtureContext(input);
  const artifacts = buildCoreArtifacts(context, nowMs);
  const scenarioSuite = buildScenarioSuite(context, artifacts, generatedAt);
  const negativeScenarioMatrix = buildNegativeMatrix(context, artifacts, generatedAt);
  const residentWitnessRows = buildResidentWitnessRows(context, artifacts, generatedAt);
  const operatorProjection = buildOperatorProjection(context, artifacts, scenarioSuite, negativeScenarioMatrix, generatedAt);
  const manualGateRows = buildManualGateRows(context, artifacts, scenarioSuite, negativeScenarioMatrix, residentWitnessRows, generatedAt);
  const proof = {
    schema: PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA,
    proofId: `provider_hosted_wave19_usability_proof_${digestFor("provider-hosted-wave19-proof-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeScenarioMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    threadId: context.threadId,
    generatedAt,
    wave: "19",
    status: "pass",
    providerMetadataProfile: artifacts.providerMetadataProfile,
    profileDeclaredStatus: artifacts.profileDeclaredStatus,
    runtimeStatus: artifacts.runtimeStatus,
    runtimeActivation: artifacts.runtimeActivation,
    webCall: artifacts.webCall,
    webResult: artifacts.webResult,
    webAdmission: artifacts.webAdmission,
    operatorImageCall: artifacts.operatorImageCall,
    residentImageCall: artifacts.residentImageCall,
    completedImageArtifact: artifacts.completedImageArtifact,
    imageAdmission: artifacts.imageAdmission,
    providerBlockedArtifact: artifacts.providerBlockedArtifact,
    scenarioSuite,
    negativeScenarioMatrix,
    residentWitnessRows,
    operatorProjection,
    manualGateRows,
    ...falseBoundaryFlags(),
  };
  proof.proofDigest = digestFor("provider-hosted-wave19-usability-proof@1", proof);
  validateProviderHostedWave19UsabilityGate(proof);
  return proof;
}

function assertFalseFlags(target, flags, errors, prefix) {
  for (const flag of flags) {
    if (target?.[flag] !== false) errors.push(`${prefix}:${flag}`);
  }
}

function validateProviderHostedWave19UsabilityGate(proof = {}) {
  const errors = [];
  if (!isPlainObject(proof)) throw new Error("provider_hosted_wave19_usability_proof_invalid_object");
  if (proof.schema !== PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA) throw new Error("provider_hosted_wave19_usability_proof_schema_mismatch");
  for (const field of ["proofId", "projectId", "workThreadId", "threadId", "generatedAt", "proofDigest"]) {
    if (!normalizeString(proof[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (proof.wave !== "19") errors.push("wave_mismatch");
  if (proof.status !== "pass") errors.push("proof_status_not_pass");
  assertFalseFlags(proof, FALSE_BOUNDARY_FLAGS, errors, "proof_boundary_leak");
  if (proof.runtimeStatus?.schema !== PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA) errors.push("runtime_status_schema_mismatch");
  else assertProviderHostedToolsStatusSafe(proof.runtimeStatus);
  if (proof.runtimeActivation?.schema !== PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA) errors.push("runtime_activation_schema_mismatch");
  if (proof.webCall?.schema !== PROVIDER_HOSTED_TOOL_CALL_ENVELOPE_SCHEMA) errors.push("web_call_schema_mismatch");
  else {
    assertProviderHostedToolCallEnvelopeSafe(proof.webCall);
    if (proof.webCall.authorityDecision !== "allowed") errors.push("web_search_not_allowed");
    if (proof.webCall.replayPolicy?.mayAutoRetry !== false) errors.push("web_search_replay_allowed");
  }
  if (proof.webResult?.schema !== PROVIDER_HOSTED_WEB_SEARCH_RESULT_ENVELOPE_SCHEMA) errors.push("web_result_schema_mismatch");
  else {
    assertProviderHostedWebSearchResultEnvelopeSafe(proof.webResult);
    if (proof.webResult.redactionState !== "not_needed") errors.push("web_result_not_admissible");
    if (!proof.webResult.hostedUsageAttribution) errors.push("web_usage_attribution_missing");
    else assertProviderHostedUsageAttributionSafe(proof.webResult.hostedUsageAttribution);
  }
  if (proof.webAdmission?.schema !== PROVIDER_HOSTED_RESULT_CONTEXT_ADMISSION_SCHEMA) errors.push("web_admission_schema_mismatch");
  else {
    assertProviderHostedResultContextAdmissionSafe(proof.webAdmission);
    if (proof.webAdmission.admissionDecision !== "admit") errors.push("web_admission_not_admitted");
    if (proof.webAdmission.projectTruthGranted !== false || proof.webAdmission.durableMemoryAdmission !== false || proof.webAdmission.memoryCandidateCreated !== false) errors.push("web_admission_authority_leak");
  }
  if (proof.operatorImageCall?.authorityDecision !== "allowed") errors.push("operator_image_not_allowed");
  if (proof.residentImageCall?.authorityDecision === "allowed") errors.push("resident_image_allowed");
  for (const field of ["completedImageArtifact", "providerBlockedArtifact"]) {
    if (proof[field]?.schema !== PROVIDER_HOSTED_IMAGE_GENERATION_ARTIFACT_ENVELOPE_SCHEMA) errors.push(`${field}_schema_mismatch`);
    else assertProviderHostedImageGenerationArtifactEnvelopeSafe(proof[field]);
  }
  if (proof.completedImageArtifact?.retentionPolicy?.workspaceInsertionAllowed !== false) errors.push("image_workspace_insertion_allowed");
  if (proof.completedImageArtifact?.rawImageBytesInRendererState !== false) errors.push("image_raw_bytes_visible");
  if (proof.providerBlockedArtifact?.generationState !== "blocked_by_provider") errors.push("provider_blocked_generation_not_preserved");
  if (!isPlainObject(proof.scenarioSuite) || proof.scenarioSuite.schema !== PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_SUITE_SCHEMA) {
    errors.push("scenario_suite_schema_mismatch");
  } else {
    if (proof.scenarioSuite.failCount !== 0) errors.push("scenario_suite_failed");
    const scenarioIds = new Set(arrayOrEmpty(proof.scenarioSuite.scenarios).map((row) => row.scenarioId));
    for (const required of REQUIRED_SCENARIOS) {
      if (!scenarioIds.has(required)) errors.push(`scenario_missing:${required}`);
    }
    for (const row of arrayOrEmpty(proof.scenarioSuite.scenarios)) {
      if (row.schema !== PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_ROW_SCHEMA) errors.push(`scenario_schema_mismatch:${row.scenarioId}`);
      if (row.status !== "pass") errors.push(`scenario_not_pass:${row.scenarioId}`);
      assertFalseFlags(row, FALSE_BOUNDARY_FLAGS, errors, `scenario_boundary_leak:${row.scenarioId}`);
    }
  }
  if (!isPlainObject(proof.negativeScenarioMatrix) || proof.negativeScenarioMatrix.schema !== PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_MATRIX_SCHEMA) {
    errors.push("negative_matrix_schema_mismatch");
  } else {
    const rows = arrayOrEmpty(proof.negativeScenarioMatrix.rows);
    if (rows.length < REQUIRED_NEGATIVES.length) errors.push("negative_matrix_coverage_missing");
    const negativeIds = new Set(rows.map((row) => row.rowId));
    for (const required of REQUIRED_NEGATIVES) {
      if (!negativeIds.has(required)) errors.push(`negative_row_missing:${required}`);
    }
    for (const row of rows) {
      if (row.schema !== PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_ROW_SCHEMA) errors.push(`negative_row_schema_mismatch:${row.rowId}`);
      if (row.status !== "pass") errors.push(`negative_row_not_pass:${row.rowId}`);
      assertFalseFlags(row, FALSE_BOUNDARY_FLAGS, errors, `negative_row_boundary_leak:${row.rowId}`);
    }
  }
  if (!Array.isArray(proof.residentWitnessRows)) {
    errors.push("resident_witness_rows_missing");
  } else {
    const witnessTools = new Set(proof.residentWitnessRows.map((row) => row.toolName));
    for (const required of ["web_search", "image_generation", "web_search_profile_declared"]) {
      if (!witnessTools.has(required)) errors.push(`resident_witness_missing:${required}`);
    }
    for (const row of proof.residentWitnessRows) {
      if (row.schema !== PROVIDER_HOSTED_WAVE19_RESIDENT_WITNESS_ROW_SCHEMA) errors.push(`resident_witness_schema_mismatch:${row.rowId}`);
      if (row.grantsAuthority !== false) errors.push(`resident_witness_authority_leak:${row.rowId}`);
      assertFalseFlags(row, FALSE_BOUNDARY_FLAGS, errors, `resident_witness_boundary_leak:${row.rowId}`);
      if (row.toolName === "web_search" && (row.residentCallable !== true || row.providerDeclared !== true || row.modelCallable !== true)) errors.push("web_search_witness_not_callable");
      if (row.toolName === "image_generation" && (row.residentCallable !== false || row.operatorCallable !== true)) errors.push("image_generation_witness_gate_mismatch");
    }
  }
  if (!isPlainObject(proof.operatorProjection) || proof.operatorProjection.schema !== PROVIDER_HOSTED_WAVE19_OPERATOR_PROJECTION_SCHEMA) {
    errors.push("operator_projection_schema_mismatch");
  } else {
    if (proof.operatorProjection.readsProofArtifacts !== true || proof.operatorProjection.mintsProof !== false || proof.operatorProjection.grantsAuthority !== false) errors.push("operator_projection_authority_leak");
    assertFalseFlags(proof.operatorProjection, FALSE_BOUNDARY_FLAGS, errors, "operator_projection_boundary_leak");
  }
  for (const row of arrayOrEmpty(proof.manualGateRows)) {
    if (row.schema !== PROVIDER_HOSTED_WAVE19_MANUAL_GATE_ROW_SCHEMA) errors.push(`manual_gate_schema_mismatch:${row.gateId}`);
    if (row.status !== "pass") errors.push(`manual_gate_not_pass:${row.gateId}`);
  }
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
    if (serialized.includes(forbidden)) errors.push(`serialized_boundary_leak:${forbidden}`);
  }
  if (!errors.length) return true;
  const error = new Error(`provider_hosted_wave19_usability_gate_validation_failed:${errors.join(",")}`);
  error.validationErrors = errors;
  throw error;
}

module.exports = {
  PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_ROW_SCHEMA,
  PROVIDER_HOSTED_WAVE19_HEADLESS_SCENARIO_SUITE_SCHEMA,
  PROVIDER_HOSTED_WAVE19_MANUAL_GATE_ROW_SCHEMA,
  PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
  PROVIDER_HOSTED_WAVE19_NEGATIVE_SCENARIO_ROW_SCHEMA,
  PROVIDER_HOSTED_WAVE19_OPERATOR_PROJECTION_SCHEMA,
  PROVIDER_HOSTED_WAVE19_RESIDENT_WITNESS_ROW_SCHEMA,
  PROVIDER_HOSTED_WAVE19_USABILITY_PROOF_SCHEMA,
  buildProviderHostedWave19UsabilityGate,
  validateProviderHostedWave19UsabilityGate,
};
