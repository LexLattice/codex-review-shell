"use strict";

const crypto = require("node:crypto");

const PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA = "provider_hosted_tool_capability@1";
const PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA = "provider_web_search_evidence_contract@1";
const PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA = "provider_image_generation_artifact_contract@1";
const PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA = "provider_hosted_tools_status@1";
const PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA = "provider_hosted_request_shape_proof@1";
const PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA = "provider_hosted_declaration_policy@1";
const PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA = "provider_hosted_tool_activation_snapshot@1";

const TOOL_KINDS = new Set(["web_search", "image_generation"]);
const EVIDENCE_STATES = new Set(["accepted", "runtime_probed", "profile_declared", "known_available_unprobed", "unknown", "unsupported"]);
const PROVIDER_DECLARATION_STATES = new Set(["not_declared", "metadata_declared", "activation_ready", "declared_to_resident", "operator_ui_live", "runtime_accepted", "unsupported", "unknown", "blocked"]);
const RESULT_POSTURES = new Set(["external_epistemic_evidence", "generated_artifact", "not_available", "unknown"]);
const REQUEST_SOURCES = new Set(["provider_metadata_profile", "runtime_probe", "fixture", "unknown"]);
const INVOCATION_MODES = new Set(["model_mediated_provider_tool", "harness_requested_provider_operation", "operator_triggered_provider_operation", "headless_route_provider_operation"]);
const DECLARATION_DECISIONS = new Set([
  "resident_callable",
  "operator_callable",
  "headless_callable",
  "activation_ready_only",
  "blocked_unknown_capability",
  "blocked_unsupported",
  "blocked_missing_request_shape_proof",
  "blocked_stale_request_shape_proof",
  "blocked_result_shape_unobserved",
  "blocked_operator_gate_required",
]);

const CALLABLE_EVIDENCE_STATES = new Set(["accepted", "runtime_probed"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength <= 3) return ".".repeat(maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
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
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "provider_hosted_tool") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("provider-hosted-tool-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "provider_hosted_tool") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeModelRef(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    model: boundedString(source.model || source.modelId || "unknown", 160),
    serviceTier: boundedString(source.serviceTier || source.speed || "", 80),
    reasoningEffort: boundedString(source.reasoningEffort || source.reasoning || "", 80),
  };
}

function normalizeInvocationModes(value) {
  const modes = arrayOrEmpty(value)
    .map((mode) => normalizeEnum(mode, INVOCATION_MODES, ""))
    .filter(Boolean);
  return [...new Set(modes)];
}

function requestShapeProofIsFresh(proof = {}, nowMs) {
  if (!proof.expiresAt) return true;
  const expiresAtMs = Date.parse(proof.expiresAt);
  const currentMs = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return Number.isFinite(expiresAtMs) && expiresAtMs > currentMs;
}

function requestShapeProofIsCallable(proof = {}, nowMs) {
  return proof.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA
    && proof.runtimeAccepted === true
    && proof.resultShapeObserved === true
    && requestShapeProofIsFresh(proof, nowMs);
}

function capabilityValueIsSupported(value) {
  if (value === true) return true;
  if (typeof value === "string") return ["true", "available", "enabled", "supported", "declared"].includes(value.trim().toLowerCase());
  if (!isPlainObject(value)) return false;
  if (value.supported === true || value.enabled === true || value.available === true || value.accepted === true) return true;
  const status = normalizeString(value.status || value.state || value.availabilityState, "").toLowerCase();
  return ["available", "enabled", "supported", "declared", "accepted"].includes(status);
}

function profileToolListHas(profile = {}, toolKind) {
  const aliases = toolKind === "web_search"
    ? new Set(["web_search", "web_search_preview", "webSearch"])
    : new Set(["image_generation", "image_generation_call", "imageGeneration"]);
  return arrayOrEmpty(profile?.capabilities?.tools).some((tool) => {
    if (typeof tool === "string") return aliases.has(tool);
    if (!isPlainObject(tool)) return false;
    return aliases.has(normalizeString(tool.id || tool.name || tool.type || tool.tool, ""));
  });
}

function providerCapabilityValue(profile = {}, toolKind) {
  if (toolKind === "web_search") return profile?.capabilities?.provider?.webSearch;
  if (toolKind === "image_generation") return profile?.capabilities?.provider?.imageGeneration;
  return undefined;
}

function hasOwn(object, key) {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function hostedToolEvidenceIsPresent(profile = {}, toolKind) {
  const provider = profile?.capabilities?.provider;
  const providerKey = toolKind === "web_search" ? "webSearch" : "imageGeneration";
  if (hasOwn(provider, providerKey)) return true;
  const aliases = toolKind === "web_search"
    ? new Set(["web_search", "web_search_preview", "webSearch"])
    : new Set(["image_generation", "image_generation_call", "imageGeneration"]);
  return arrayOrEmpty(profile?.capabilities?.tools).some((tool) => {
    if (typeof tool === "string") return aliases.has(tool);
    if (!isPlainObject(tool)) return false;
    return aliases.has(normalizeString(tool.id || tool.name || tool.type || tool.tool, ""));
  });
}

function hostedToolCapabilityFromProfile(profile = {}, toolKind) {
  const providerValue = providerCapabilityValue(profile, toolKind);
  const supported = capabilityValueIsSupported(providerValue) || profileToolListHas(profile, toolKind);
  const hasProfile = normalizeString(profile?.schema, "") === "direct_provider_metadata_profile@1";
  const hasHostedToolEvidence = hostedToolEvidenceIsPresent(profile, toolKind);
  const absentEvidenceState = hasProfile && hasHostedToolEvidence ? "unsupported" : "unknown";
  return {
    supported,
    evidenceState: supported ? "profile_declared" : absentEvidenceState,
    providerDeclarationState: supported ? "metadata_declared" : absentEvidenceState,
    sourceDigest: normalizeString(profile?.profileDigest, ""),
    generatedAt: normalizeString(profile?.generatedAt, ""),
  };
}

function buildProviderHostedToolCapability(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const profileDerived = isPlainObject(source.providerMetadataProfile)
    ? hostedToolCapabilityFromProfile(source.providerMetadataProfile, toolKind)
    : {};
  const evidenceState = normalizeEnum(source.evidenceState, EVIDENCE_STATES, profileDerived.evidenceState || "unknown");
  const providerDeclarationState = normalizeEnum(
    source.providerDeclarationState,
    PROVIDER_DECLARATION_STATES,
    profileDerived.providerDeclarationState || "unknown",
  );
  const resultPosture = normalizeEnum(
    source.resultPosture,
    RESULT_POSTURES,
    toolKind === "web_search" ? "external_epistemic_evidence" : "generated_artifact",
  );
  const capability = {
    schema: PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
    capabilityId: boundedString(source.capabilityId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    toolKind,
    displayName: toolKind === "web_search" ? "Provider-hosted web search" : "Provider-hosted image generation",
    evidenceState,
    providerDeclarationState,
    requestSource: normalizeEnum(source.requestSource, REQUEST_SOURCES, profileDerived.sourceDigest ? "provider_metadata_profile" : "unknown"),
    providerMetadataDigest: boundedString(source.providerMetadataDigest || profileDerived.sourceDigest, 180),
    providerMetadataObservedAt: boundedString(source.providerMetadataObservedAt || profileDerived.generatedAt, 80),
    resultPosture,
    contextVisibility: toolKind === "web_search" ? "provider_artifact_ref" : "provider_artifact_ref",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_hosted_tool_capability"),
    requiredFutureGates: toolKind === "web_search"
      ? ["provider_capability_evidence", "retrieval_time", "source_url_policy", "citation_policy", "staleness_policy"]
      : ["provider_capability_evidence", "prompt_evidence", "asset_storage_policy", "metadata_redaction_policy", "safety_metadata_policy"],
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  capability.capabilityId = capability.capabilityId || `provider_hosted_${toolKind}_${digestFor("provider-hosted-capability-source@1", capability).slice(0, 24)}`;
  capability.capabilityDigest = digestFor("provider-hosted-tool-capability@1", capability);
  return capability;
}

function buildProviderHostedRequestShapeProof(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const toolKind = normalizeEnum(source.toolKind || source.kind, TOOL_KINDS, "web_search");
  const invocationMode = normalizeEnum(source.invocationMode, INVOCATION_MODES, toolKind === "web_search" ? "model_mediated_provider_tool" : "operator_triggered_provider_operation");
  const observedAt = normalizeString(source.observedAt, nowIso(source.nowMs));
  const proof = {
    schema: PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA,
    proofId: boundedString(source.proofId || "", 180),
    toolKind,
    invocationMode,
    providerProfileDigest: boundedString(source.providerProfileDigest || source.providerMetadataDigest, 180),
    modelRef: normalizeModelRef(source.modelRef),
    requestShapeDigest: boundedString(source.requestShapeDigest, 180),
    requestBuilderVersion: boundedString(source.requestBuilderVersion || "unknown", 120),
    runtimeAccepted: normalizeBoolean(source.runtimeAccepted, false),
    resultShapeObserved: normalizeBoolean(source.resultShapeObserved, false),
    observedAt,
    expiresAt: boundedString(source.expiresAt, 80),
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
  };
  proof.proofId = proof.proofId || `provider_hosted_request_shape_${toolKind}_${digestFor("provider-hosted-request-shape-proof-source@1", proof).slice(0, 24)}`;
  proof.proofDigest = digestFor("provider-hosted-request-shape-proof@1", proof);
  return proof;
}

function bestRequestShapeProof({ proofs = [], toolKind, invocationMode, nowMs }) {
  const candidates = arrayOrEmpty(proofs)
    .filter((proof) => proof?.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA)
    .filter((proof) => proof.toolKind === toolKind)
    .filter((proof) => !invocationMode || proof.invocationMode === invocationMode);
  return candidates.find((proof) => requestShapeProofIsCallable(proof, nowMs)) || candidates[0] || null;
}

function providerHostedDeclarationDecision({ capability = {}, proof = null, invocationMode, nowMs }) {
  const toolKind = normalizeEnum(capability.toolKind, TOOL_KINDS, "web_search");
  const evidenceState = normalizeEnum(capability.evidenceState, EVIDENCE_STATES, "unknown");
  if (evidenceState === "unsupported") return { decision: "blocked_unsupported", blocker: "unsupported_capability", callable: false };
  if (evidenceState === "unknown") return { decision: "blocked_unknown_capability", blocker: "unknown_capability", callable: false };
  if (!CALLABLE_EVIDENCE_STATES.has(evidenceState)) return { decision: "activation_ready_only", blocker: "known_available_unprobed", callable: false };
  if (toolKind === "image_generation" && invocationMode === "model_mediated_provider_tool") {
    return { decision: "blocked_operator_gate_required", blocker: "image_generation_operator_gate_required", callable: false };
  }
  if (!proof) return { decision: "blocked_missing_request_shape_proof", blocker: "missing_request_shape_proof", callable: false };
  if (!requestShapeProofIsFresh(proof, nowMs)) return { decision: "blocked_stale_request_shape_proof", blocker: "stale_request_shape_proof", callable: false };
  if (proof.runtimeAccepted !== true) return { decision: "blocked_missing_request_shape_proof", blocker: "runtime_not_accepted", callable: false };
  if (proof.resultShapeObserved !== true) return { decision: "blocked_result_shape_unobserved", blocker: "result_shape_unobserved", callable: false };
  if (invocationMode === "operator_triggered_provider_operation") return { decision: "operator_callable", blocker: "", callable: true };
  if (invocationMode === "headless_route_provider_operation") return { decision: "headless_callable", blocker: "", callable: true };
  return { decision: "resident_callable", blocker: "", callable: true };
}

function buildProviderHostedDeclarationPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const policy = {
    schema: PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA,
    policyId: boundedString(source.policyId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    allowedInvocationModes: normalizeInvocationModes(source.allowedInvocationModes).length
      ? normalizeInvocationModes(source.allowedInvocationModes)
      : ["model_mediated_provider_tool", "operator_triggered_provider_operation", "headless_route_provider_operation"],
    callableEvidenceStates: ["accepted", "runtime_probed"],
    profileDeclaredCallable: false,
    knownAvailableUnprobedCallable: false,
    imageGenerationResidentCallableByDefault: false,
    webSearchResidentCallableWhenProved: true,
    requestShapeProofRequired: true,
    resultShapeObservedRequired: true,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    generatedAt,
  };
  policy.policyId = policy.policyId || `provider_hosted_declaration_policy_${digestFor("provider-hosted-declaration-policy-source@1", policy).slice(0, 24)}`;
  policy.policyDigest = digestFor("provider-hosted-declaration-policy@1", policy);
  return policy;
}

function buildProviderHostedActivationSnapshot(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId || source.providerMetadataProfile?.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const providerProfileDigest = boundedString(source.providerMetadataProfile?.profileDigest || source.providerProfileDigest || source.providerMetadataDigest, 180);
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : [
    { toolKind: "web_search", providerMetadataProfile: source.providerMetadataProfile },
    { toolKind: "image_generation", providerMetadataProfile: source.providerMetadataProfile },
  ]).map((capability) => capability?.schema === PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA
    ? capability
    : buildProviderHostedToolCapability({
      projectId,
      workThreadId,
      generatedAt,
      ...capability,
    }));
  const requestShapeProofs = arrayOrEmpty(source.requestShapeProofs)
    .map((proof) => proof?.schema === PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA ? proof : buildProviderHostedRequestShapeProof({
      providerProfileDigest,
      ...proof,
    }));
  const declarationPolicy = source.declarationPolicy?.schema === PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA
    ? source.declarationPolicy
    : buildProviderHostedDeclarationPolicy({
      projectId,
      workThreadId,
      generatedAt,
      ...source.declarationPolicy,
    });
  const invocationModes = normalizeInvocationModes(source.invocationModes).length
    ? normalizeInvocationModes(source.invocationModes)
    : declarationPolicy.allowedInvocationModes;
  const declarationDecisions = [];
  const blockedTools = [];
  const activationReadyTools = [];
  for (const capability of capabilities) {
    for (const invocationMode of invocationModes) {
      const proof = bestRequestShapeProof({ proofs: requestShapeProofs, toolKind: capability.toolKind, invocationMode, nowMs: source.nowMs });
      const decision = providerHostedDeclarationDecision({ capability, proof, invocationMode, nowMs: source.nowMs });
      const row = {
        toolKind: capability.toolKind,
        invocationMode,
        decision: normalizeEnum(decision.decision, DECLARATION_DECISIONS, "blocked_unknown_capability"),
        blocker: boundedString(decision.blocker, 160),
        proofId: boundedString(proof?.proofId, 180),
        proofDigest: boundedString(proof?.proofDigest, 180),
        callable: decision.callable === true,
      };
      declarationDecisions.push(row);
      if (row.callable) activationReadyTools.push({ toolKind: row.toolKind, invocationMode: row.invocationMode });
      if (!row.callable) blockedTools.push({ toolKind: row.toolKind, invocationMode: row.invocationMode, blocker: row.blocker || row.decision });
    }
  }
  const snapshot = {
    schema: PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
    activationId: boundedString(source.activationId || "", 180),
    workThreadId,
    projectId,
    providerRuntimeRef: boundedString(source.providerRuntimeRef || "unknown", 180),
    providerProfileDigest,
    accountEvidenceRef: isPlainObject(source.accountEvidenceRef) ? normalizeEvidenceRef(source.accountEvidenceRef, "provider_hosted_account_evidence") : undefined,
    modelRef: normalizeModelRef(source.modelRef),
    invocationModes,
    requestShapeProofRefs: requestShapeProofs.map((proof) => normalizeEvidenceRef({
      kind: "provider_hosted_request_shape_proof",
      id: proof.proofId,
      digest: proof.proofDigest,
      label: `${proof.toolKind}:${proof.invocationMode}`,
      confidence: requestShapeProofIsCallable(proof, source.nowMs) ? "runtime_probed" : "diagnostic",
    }, "provider_hosted_request_shape_proof")),
    capabilities,
    requestShapeProofs,
    declarationPolicy,
    activationReadyTools,
    declaredTools: [],
    blockedTools,
    declarationDecisions,
    declarationDigest: "",
    resultAdmissionPolicyId: boundedString(source.resultAdmissionPolicyId || "provider_hosted_result_context_admission@pending", 180),
    webSearchQueryPolicyId: boundedString(source.webSearchQueryPolicyId || "provider_hosted_web_search_query_policy@pending", 180),
    imagePromptPolicyId: boundedString(source.imagePromptPolicyId || "provider_hosted_image_prompt_policy@pending", 180),
    usageAttributionPolicyId: boundedString(source.usageAttributionPolicyId || "provider_hosted_usage_attribution@pending", 180),
    rawExposureScannerId: boundedString(source.rawExposureScannerId || "provider_hosted_raw_exposure_scanner@pending", 180),
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    createdAt: generatedAt,
    expiresAt: boundedString(source.expiresAt, 80),
  };
  snapshot.activationId = snapshot.activationId || `provider_hosted_activation_${digestFor("provider-hosted-activation-source@1", snapshot).slice(0, 24)}`;
  snapshot.declarationDigest = digestFor("provider-hosted-activation-declaration@1", {
    activationId: snapshot.activationId,
    activationReadyTools: snapshot.activationReadyTools,
    declarationDecisions: snapshot.declarationDecisions,
    declarationPolicyDigest: snapshot.declarationPolicy.policyDigest,
  });
  snapshot.activationDigest = digestFor("provider-hosted-activation-snapshot@1", snapshot);
  return snapshot;
}

function buildWebSearchEvidenceContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = {
    schema: PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
    contractId: boundedString(source.contractId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    resultPosture: "external_epistemic_evidence",
    requiredFields: ["query_digest", "retrieved_at", "source_refs", "citation_policy", "staleness_policy", "provider_result_ref"],
    sourcePolicy: {
      sourceUrlsRequired: true,
      retrievalTimeRequired: true,
      titleSnippetAllowed: true,
      rawPageContentAllowed: false,
      credentialedUrlAllowed: false,
      citationRequiredForContextUse: true,
    },
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_web_search_evidence_contract"),
    providerHostedToolCallAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawQueryIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawPageContentIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  contract.contractId = contract.contractId || `web_search_contract_${digestFor("web-search-contract-source@1", contract).slice(0, 24)}`;
  contract.contractDigest = digestFor("provider-web-search-evidence-contract@1", contract);
  return contract;
}

function buildImageGenerationArtifactContract(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const contract = {
    schema: PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
    contractId: boundedString(source.contractId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    resultPosture: "generated_artifact",
    requiredFields: ["prompt_digest", "asset_ref", "created_at", "model_ref", "storage_policy", "safety_metadata_ref"],
    artifactPolicy: {
      assetStorageRequired: true,
      promptEvidenceRequired: true,
      metadataRedactionRequired: true,
      rawPromptStorageAllowed: false,
      rawImageBytesInRendererAllowed: false,
      workspaceMutationRequiresSeparateStaging: true,
    },
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "provider_image_generation_artifact_contract"),
    providerHostedToolCallAllowed: false,
    workspaceMutationAllowed: false,
    contextInjectionAllowed: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawImageBytesIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  contract.contractId = contract.contractId || `image_generation_contract_${digestFor("image-generation-contract-source@1", contract).slice(0, 24)}`;
  contract.contractDigest = digestFor("provider-image-generation-artifact-contract@1", contract);
  return contract;
}

function buildProviderHostedToolsStatus(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId || source.providerMetadataProfile?.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : [
    { toolKind: "web_search", providerMetadataProfile: source.providerMetadataProfile },
    { toolKind: "image_generation", providerMetadataProfile: source.providerMetadataProfile },
  ]).map((capability) => buildProviderHostedToolCapability({
    projectId,
    workThreadId,
    generatedAt,
    ...capability,
  }));
  const webSearchContract = source.webSearchContract?.schema === PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA
    ? source.webSearchContract
    : buildWebSearchEvidenceContract({ projectId, workThreadId, generatedAt });
  const imageGenerationContract = source.imageGenerationContract?.schema === PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA
    ? source.imageGenerationContract
    : buildImageGenerationArtifactContract({ projectId, workThreadId, generatedAt });
  const activationSnapshot = source.activationSnapshot?.schema === PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA
    ? source.activationSnapshot
    : buildProviderHostedActivationSnapshot({
      projectId,
      workThreadId,
      generatedAt,
      providerMetadataProfile: source.providerMetadataProfile,
      providerProfileDigest: source.providerMetadataProfile?.profileDigest || source.providerMetadataDigest,
      providerRuntimeRef: source.providerRuntimeRef,
      modelRef: source.modelRef,
      requestShapeProofs: source.requestShapeProofs,
      capabilities,
      declarationPolicy: source.declarationPolicy,
      nowMs: source.nowMs,
      expiresAt: source.expiresAt,
    });
  const supportedCount = capabilities.filter((capability) => ["accepted", "runtime_probed", "profile_declared", "known_available_unprobed"].includes(capability.evidenceState)).length;
  const status = {
    schema: PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
    statusId: boundedString(source.statusId || "", 180),
    projectId,
    workThreadId,
    status: boundedString(source.status || "provider_hosted_boundary_only", 120),
    capabilityCount: capabilities.length,
    supportedCount,
    unsupportedCount: capabilities.filter((capability) => capability.evidenceState === "unsupported").length,
    unknownCount: capabilities.filter((capability) => capability.evidenceState === "unknown").length,
    capabilities,
    webSearchContract,
    imageGenerationContract,
    declarationPolicy: activationSnapshot.declarationPolicy,
    activationSnapshot,
    activationSnapshotDigest: boundedString(activationSnapshot.activationDigest, 180),
    activationReadyCount: activationSnapshot.activationReadyTools.length,
    declarationDecisionCount: activationSnapshot.declarationDecisions.length,
    blockedDecisionCount: activationSnapshot.declarationDecisions.filter((decision) => decision.callable !== true).length,
    providerMetadataDigest: boundedString(source.providerMetadataProfile?.profileDigest || source.providerMetadataDigest, 180),
    providerToolDeclarationAllowed: false,
    providerHostedToolCallAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    contextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: "Provider-hosted web search and image generation are activation-gated; request-shape proof is required before any future hosted tool declaration.",
    generatedAt,
  };
  status.statusId = status.statusId || `provider_hosted_tools_${digestFor("provider-hosted-tools-status-source@1", status).slice(0, 24)}`;
  status.statusDigest = digestFor("provider-hosted-tools-status@1", status);
  return status;
}

function assertProviderHostedToolsStatusSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA) {
    throw new Error("provider_hosted_tools_status_schema_mismatch");
  }
  for (const flag of [
    "providerToolDeclarationAllowed",
    "providerHostedToolCallAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "contextInjectionAllowed",
    "workspaceMutationAllowed",
    "rawProviderPayloadIncluded",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawSecretIncluded",
  ]) {
    if (status[flag] !== false) throw new Error(`provider_hosted_tools_authority_leak:${flag}`);
  }
  for (const capability of arrayOrEmpty(status.capabilities)) {
    if (capability.schema !== PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA) throw new Error("provider_hosted_tool_capability_schema_mismatch");
    for (const flag of [
      "providerToolDeclarationAllowed",
      "providerHostedToolCallAllowed",
      "providerTransportAllowed",
      "requestShapeMutationAllowed",
      "contextInjectionAllowed",
      "workspaceMutationAllowed",
      "rawProviderPayloadIncluded",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawSecretIncluded",
    ]) {
      if (capability[flag] !== false) throw new Error(`provider_hosted_tool_capability_authority_leak:${capability.toolKind}:${flag}`);
    }
  }
  const activationSnapshot = status.activationSnapshot;
  if (!isPlainObject(activationSnapshot) || activationSnapshot.schema !== PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA) {
    throw new Error("provider_hosted_activation_snapshot_schema_mismatch");
  }
  for (const flag of [
    "providerToolDeclarationAllowed",
    "providerHostedToolCallAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "contextInjectionAllowed",
    "workspaceMutationAllowed",
    "rawProviderPayloadIncluded",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawSecretIncluded",
  ]) {
    if (activationSnapshot[flag] !== false) throw new Error(`provider_hosted_activation_authority_leak:${flag}`);
  }
  for (const proof of arrayOrEmpty(activationSnapshot.requestShapeProofs)) {
    if (proof.schema !== PROVIDER_HOSTED_REQUEST_SHAPE_PROOF_SCHEMA) throw new Error("provider_hosted_request_shape_proof_schema_mismatch");
    for (const flag of ["rawProviderPayloadIncluded", "rawPromptIncluded", "rawResultIncluded", "rawSecretIncluded"]) {
      if (proof[flag] !== false) throw new Error(`provider_hosted_request_shape_authority_leak:${flag}`);
    }
  }
  const policy = activationSnapshot.declarationPolicy;
  if (!isPlainObject(policy) || policy.schema !== PROVIDER_HOSTED_DECLARATION_POLICY_SCHEMA) {
    throw new Error("provider_hosted_declaration_policy_schema_mismatch");
  }
  if (policy.profileDeclaredCallable !== false || policy.knownAvailableUnprobedCallable !== false || policy.requestShapeProofRequired !== true) {
    throw new Error("provider_hosted_declaration_policy_unsafe");
  }
  for (const contract of [status.webSearchContract, status.imageGenerationContract]) {
    if (!isPlainObject(contract)) throw new Error("provider_hosted_contract_missing");
    if (![PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA, PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA].includes(contract.schema)) {
      throw new Error(`provider_hosted_contract_schema_mismatch:${contract.schema || "missing"}`);
    }
    for (const flag of [
      "providerHostedToolCallAllowed",
      "contextInjectionAllowed",
      "workspaceMutationAllowed",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawProviderPayloadIncluded",
      "rawSecretIncluded",
    ]) {
      if (contract[flag] !== false) throw new Error(`provider_hosted_contract_authority_leak:${contract.schema}:${flag}`);
    }
    const contractSpecificFlags = contract.schema === PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA
      ? ["rawQueryIncluded", "rawPageContentIncluded"]
      : ["rawImageBytesIncluded"];
    for (const flag of contractSpecificFlags) {
      if (contract[flag] !== false) throw new Error(`provider_hosted_contract_authority_leak:${contract.schema}:${flag}`);
    }
  }
  return true;
}

module.exports = {
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
};
