"use strict";

const crypto = require("node:crypto");

const PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA = "provider_hosted_tool_capability@1";
const PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA = "provider_web_search_evidence_contract@1";
const PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA = "provider_image_generation_artifact_contract@1";
const PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA = "provider_hosted_tools_status@1";

const TOOL_KINDS = new Set(["web_search", "image_generation"]);
const EVIDENCE_STATES = new Set(["accepted", "runtime_probed", "profile_declared", "unknown", "unsupported"]);
const PROVIDER_DECLARATION_STATES = new Set(["not_declared", "metadata_declared", "runtime_accepted", "unsupported", "unknown"]);
const RESULT_POSTURES = new Set(["external_epistemic_evidence", "generated_artifact", "not_available", "unknown"]);
const REQUEST_SOURCES = new Set(["provider_metadata_profile", "runtime_probe", "fixture", "unknown"]);

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
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

function hostedToolCapabilityFromProfile(profile = {}, toolKind) {
  const providerValue = providerCapabilityValue(profile, toolKind);
  const supported = capabilityValueIsSupported(providerValue) || profileToolListHas(profile, toolKind);
  const hasProfile = normalizeString(profile?.schema, "") === "direct_provider_metadata_profile@1";
  return {
    supported,
    evidenceState: supported ? "profile_declared" : hasProfile ? "unsupported" : "unknown",
    providerDeclarationState: supported ? "metadata_declared" : hasProfile ? "unsupported" : "unknown",
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
    contextInjectionAllowed: false,
    rawQueryIncluded: false,
    rawResultIncluded: false,
    rawPageContentIncluded: false,
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
  const supportedCount = capabilities.filter((capability) => ["accepted", "runtime_probed", "profile_declared"].includes(capability.evidenceState)).length;
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
    rendererSafeSummary: "Provider-hosted web search and image generation are modeled as capability/result contracts only; no provider-hosted tool call is enabled.",
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
  for (const contract of [status.webSearchContract, status.imageGenerationContract]) {
    if (!isPlainObject(contract)) throw new Error("provider_hosted_contract_missing");
    for (const flag of [
      "providerHostedToolCallAllowed",
      "contextInjectionAllowed",
      "workspaceMutationAllowed",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawProviderPayloadIncluded",
      "rawSecretIncluded",
    ]) {
      if (contract[flag] === true) throw new Error(`provider_hosted_contract_authority_leak:${contract.schema}:${flag}`);
    }
  }
  return true;
}

module.exports = {
  PROVIDER_HOSTED_TOOL_CAPABILITY_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
  PROVIDER_IMAGE_GENERATION_ARTIFACT_CONTRACT_SCHEMA,
  PROVIDER_WEB_SEARCH_EVIDENCE_CONTRACT_SCHEMA,
  buildImageGenerationArtifactContract,
  buildProviderHostedToolCapability,
  buildProviderHostedToolsStatus,
  buildWebSearchEvidenceContract,
  assertProviderHostedToolsStatusSafe,
};
