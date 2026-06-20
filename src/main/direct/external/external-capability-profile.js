"use strict";

const crypto = require("node:crypto");

const {
  buildExternalCapabilityDiscoveryRegistry,
  assertExternalCapabilityDiscoveryRegistrySafe,
} = require("./capability-discovery");
const {
  buildMcpResourceToolBoundaryStatus,
  assertMcpResourceToolBoundarySafe,
} = require("./mcp-boundary");
const {
  buildPluginGovernanceStatus,
  assertPluginGovernanceStatusSafe,
} = require("./plugin-governance");

const EXTERNAL_CAPABILITY_PROFILE_SCHEMA = "external_capability_profile@1";
const EXTERNAL_SOURCE_IDENTITY_WITNESS_SCHEMA = "external_source_identity_witness@1";
const MCP_SERVER_IDENTITY_WITNESS_SCHEMA = "mcp_server_identity_witness@1";
const MCP_SERVER_SELECTOR_BLOCKER_SCHEMA = "mcp_server_selector_blocker@1";
const EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA = "external_capability_witness_row@1";
const EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA = "external_capability_compact_witness@1";

const DESCRIPTOR_KINDS = new Set([
  "discovery_only",
  "external_resource",
  "external_action_tool",
  "plugin_candidate",
  "provider_hosted_tool",
]);

const EXECUTION_STATES = new Set([
  "not_executable_in_pr109",
  "eligible_pending_declaration",
  "readable_with_gate",
  "not_executable_in_wave18",
  "operator_only",
  "future_wave",
  "blocked_deferred",
]);

const CAPABILITY_STATES = new Set([
  "profiled_not_declared",
  "eligible_pending_declaration",
  "guarded_pending_read_envelope",
  "blocked_deferred",
  "future_wave",
]);

const BLOCKER_CODES = new Set([
  "mcp_server_missing",
  "mcp_server_ambiguous",
  "mcp_server_disabled",
  "mcp_server_identity_stale",
  "mcp_server_auth_unavailable",
  "mcp_server_trust_unknown",
]);

const REQUIRED_BLOCKER_CODES = [...BLOCKER_CODES];

const FALSE_PROFILE_FLAGS = [
  "providerDeclarationStarted",
  "externalReadStarted",
  "dynamicExternalActionStarted",
  "pluginInstallStarted",
  "contextAdmissionStarted",
  "externalPayloadPersisted",
  "durableMemoryAdmissionStarted",
  "rawEndpointIncluded",
  "rawCredentialIncluded",
  "rawResourceUriIncluded",
  "rawExternalPayloadIncluded",
  "rawSecretIncluded",
];

const FALSE_CAPABILITY_FLAGS = [
  "providerDeclared",
  "residentCallable",
  "modelCallable",
  "externalReadAllowed",
  "dynamicExternalActionAllowed",
  "pluginInstallAllowed",
  "contextAdmissionAllowed",
  "autoPromotionAllowed",
  "rawDescriptorIncluded",
  "rawSchemaIncluded",
  "rawResourceUriIncluded",
  "rawPayloadIncluded",
  "rawSecretIncluded",
];

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

function countBy(rows = [], field) {
  const counts = Object.create(null);
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "external_capability_profile") {
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
  ref.refDigest = digestFor("external-capability-profile-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "external_capability_profile") {
  return arrayOrEmpty(values).filter(isPlainObject).map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function sourceIdentityFor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const witness = {
    schema: EXTERNAL_SOURCE_IDENTITY_WITNESS_SCHEMA,
    sourceIdentityId: boundedString(source.sourceIdentityId || source.id, 180),
    sourceKind: boundedString(source.sourceKind || "mcp_server", 80),
    displayName: boundedString(source.displayName || "External source", 180),
    sourceFamily: boundedString(source.sourceFamily || "mcp", 80),
    trustState: boundedString(source.trustState || "configured", 80),
    freshness: boundedString(source.freshness || "fresh", 80),
    authPosture: boundedString(source.authPosture || "account_or_local_config", 120),
    endpointEvidenceKey: boundedString(source.endpointEvidenceKey || "endpoint_evidence_key_not_raw", 180),
    credentialEvidenceKey: boundedString(source.credentialEvidenceKey || "credential_evidence_key_not_raw", 180),
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "external_source_identity"),
  };
  witness.sourceIdentityId = witness.sourceIdentityId || `external_source_${digestFor("external-source-identity-source@1", witness).slice(0, 24)}`;
  witness.identityDigest = digestFor("external-source-identity-witness@1", witness);
  return witness;
}

function mcpServerIdentityFor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceIdentity = sourceIdentityFor({
    sourceIdentityId: source.sourceIdentityId || source.serverIdentityId,
    displayName: source.displayName || source.serverName || "MCP server",
    sourceKind: "mcp_server",
    sourceFamily: "mcp",
    trustState: source.trustState || "configured",
    freshness: source.freshness || "fresh",
    authPosture: source.authPosture || "account_or_local_config",
    endpointEvidenceKey: source.endpointEvidenceKey,
    credentialEvidenceKey: source.credentialEvidenceKey,
    evidenceRefs: source.evidenceRefs,
  });
  const witness = {
    schema: MCP_SERVER_IDENTITY_WITNESS_SCHEMA,
    serverIdentityId: boundedString(source.serverIdentityId || source.id, 180),
    displayName: boundedString(source.displayName || source.serverName || "MCP server", 180),
    selectorKey: boundedString(source.selectorKey || source.serverIdentityId || source.id, 180),
    sourceIdentity,
    transportKind: boundedString(source.transportKind || "stdio", 80),
    authPosture: boundedString(source.authPosture || "account_or_local_config", 120),
    trustState: boundedString(source.trustState || "configured", 80),
    enabledState: boundedString(source.enabledState || "enabled", 80),
    freshness: boundedString(source.freshness || "fresh", 80),
    endpointEvidenceKey: boundedString(source.endpointEvidenceKey || "mcp_endpoint_evidence_key_not_raw", 180),
    credentialEvidenceKey: boundedString(source.credentialEvidenceKey || "mcp_credential_evidence_key_not_raw", 180),
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "mcp_server_identity"),
  };
  witness.serverIdentityId = witness.serverIdentityId || `mcp_server_${digestFor("mcp-server-identity-source@1", witness).slice(0, 24)}`;
  witness.identityDigest = digestFor("mcp-server-identity-witness@1", witness);
  return witness;
}

function defaultMcpServerIdentities() {
  return [
    mcpServerIdentityFor({
      serverIdentityId: "mcp_server_project_fixture",
      displayName: "Project MCP server",
      selectorKey: "project_fixture",
      transportKind: "stdio",
      authPosture: "local_config",
      trustState: "configured",
      enabledState: "enabled",
      freshness: "fresh",
    }),
    mcpServerIdentityFor({
      serverIdentityId: "mcp_server_disabled_fixture",
      displayName: "Disabled MCP server",
      selectorKey: "disabled_fixture",
      transportKind: "stdio",
      authPosture: "unavailable",
      trustState: "unknown",
      enabledState: "disabled",
      freshness: "stale",
    }),
  ];
}

function selectorBlockerFor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const blockerCode = normalizeEnum(source.blockerCode || source.code, BLOCKER_CODES, "mcp_server_missing");
  const row = {
    schema: MCP_SERVER_SELECTOR_BLOCKER_SCHEMA,
    blockerId: boundedString(source.blockerId || "", 180),
    blockerCode,
    selectorState: boundedString(source.selectorState || "blocked", 80),
    blocksDiscovery: source.blocksDiscovery === true,
    blocksRead: source.blocksRead !== false,
    blocksDynamicAction: source.blocksDynamicAction !== false,
    residentVisible: source.residentVisible !== false,
    operatorVisible: source.operatorVisible !== false,
    reason: boundedString(source.reason || blockerCode, 240),
    requiredResolution: boundedString(source.requiredResolution || "select_exact_enabled_trusted_fresh_server_identity", 240),
  };
  row.blockerId = row.blockerId || `mcp_selector_blocker_${blockerCode}`;
  row.blockerDigest = digestFor("mcp-server-selector-blocker@1", row);
  return row;
}

function defaultSelectorBlockers() {
  return REQUIRED_BLOCKER_CODES.map((blockerCode) => selectorBlockerFor({ blockerCode }));
}

function capabilityWitnessFor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const descriptorKind = normalizeEnum(source.descriptorKind, DESCRIPTOR_KINDS, "discovery_only");
  const executionState = normalizeEnum(source.executionState, EXECUTION_STATES, "not_executable_in_pr109");
  const capabilityState = normalizeEnum(source.capabilityState, CAPABILITY_STATES, "profiled_not_declared");
  const row = {
    schema: EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA,
    rowId: boundedString(source.rowId || "", 180),
    capabilityId: boundedString(source.capabilityId || source.toolName || source.displayName, 180),
    toolName: boundedString(source.toolName || source.capabilityId || "unknown", 160),
    displayName: boundedString(source.displayName || source.toolName || "External capability", 180),
    family: boundedString(source.family || "external_discovery", 100),
    descriptorKind,
    executionState,
    capabilityState,
    lifecycleStage: boundedString(source.lifecycleStage || "profile_only", 100),
    declarationEligibility: boundedString(source.declarationEligibility || "blocked_in_pr109", 120),
    serverIdentityId: boundedString(source.serverIdentityId, 180),
    sourceIdentityId: boundedString(source.sourceIdentityId, 180),
    nextOwner: boundedString(source.nextOwner || "future_wave", 80),
    blockerCodes: [...new Set(arrayOrEmpty(source.blockerCodes).map((code) => normalizeEnum(code, BLOCKER_CODES, "")).filter(Boolean))],
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "external_capability_witness"),
    providerDeclared: false,
    residentCallable: false,
    modelCallable: false,
    externalReadAllowed: false,
    dynamicExternalActionAllowed: false,
    pluginInstallAllowed: false,
    contextAdmissionAllowed: false,
    autoPromotionAllowed: false,
    rawDescriptorIncluded: false,
    rawSchemaIncluded: false,
    rawResourceUriIncluded: false,
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowId = row.rowId || `external_capability_witness_${digestFor("external-capability-witness-row-source@1", row).slice(0, 24)}`;
  row.rowDigest = digestFor("external-capability-witness-row@1", row);
  return row;
}

function defaultCapabilityWitnessRows() {
  return [
    capabilityWitnessFor({
      capabilityId: "external.tool_search",
      toolName: "tool_search",
      displayName: "Tool search discovery",
      family: "external_discovery",
      descriptorKind: "discovery_only",
      executionState: "eligible_pending_declaration",
      capabilityState: "eligible_pending_declaration",
      declarationEligibility: "eligible_for_pr110_declaration",
      nextOwner: "PR110",
    }),
    capabilityWitnessFor({
      capabilityId: "external.list_mcp_resources",
      toolName: "list_mcp_resources",
      displayName: "List MCP resources",
      family: "external_discovery",
      descriptorKind: "external_resource",
      executionState: "eligible_pending_declaration",
      capabilityState: "eligible_pending_declaration",
      declarationEligibility: "eligible_for_pr110_declaration_with_server_identity",
      serverIdentityId: "mcp_server_project_fixture",
      nextOwner: "PR110",
    }),
    capabilityWitnessFor({
      capabilityId: "external.list_mcp_resource_templates",
      toolName: "list_mcp_resource_templates",
      displayName: "List MCP resource templates",
      family: "external_discovery",
      descriptorKind: "external_resource",
      executionState: "eligible_pending_declaration",
      capabilityState: "eligible_pending_declaration",
      declarationEligibility: "eligible_for_pr110_declaration_with_server_identity",
      serverIdentityId: "mcp_server_project_fixture",
      nextOwner: "PR110",
    }),
    capabilityWitnessFor({
      capabilityId: "external.read_mcp_resource",
      toolName: "read_mcp_resource",
      displayName: "Read MCP resource",
      family: "external_resource_read",
      descriptorKind: "external_resource",
      executionState: "readable_with_gate",
      capabilityState: "guarded_pending_read_envelope",
      declarationEligibility: "blocked_until_pr111_read_envelope",
      serverIdentityId: "mcp_server_project_fixture",
      nextOwner: "PR111",
      blockerCodes: ["mcp_server_ambiguous", "mcp_server_disabled", "mcp_server_identity_stale", "mcp_server_auth_unavailable", "mcp_server_trust_unknown"],
    }),
    capabilityWitnessFor({
      capabilityId: "external.mcp_dynamic_tool_call",
      toolName: "mcp_dynamic_tool_call",
      displayName: "MCP dynamic tool call",
      family: "external_action",
      descriptorKind: "external_action_tool",
      executionState: "not_executable_in_wave18",
      capabilityState: "blocked_deferred",
      declarationEligibility: "blocked_deferred_dynamic_action",
      serverIdentityId: "mcp_server_project_fixture",
      nextOwner: "future_wave",
      blockerCodes: ["mcp_server_ambiguous", "mcp_server_auth_unavailable", "mcp_server_trust_unknown"],
    }),
    capabilityWitnessFor({
      capabilityId: "external.list_available_plugins_to_install",
      toolName: "list_available_plugins_to_install",
      displayName: "List plugin install candidates",
      family: "plugin_discovery",
      descriptorKind: "plugin_candidate",
      executionState: "operator_only",
      capabilityState: "blocked_deferred",
      declarationEligibility: "operator_visible_discovery_only",
      nextOwner: "future_plugin_wave",
    }),
    capabilityWitnessFor({
      capabilityId: "external.request_plugin_install",
      toolName: "request_plugin_install",
      displayName: "Request plugin install",
      family: "plugin_mutation",
      descriptorKind: "plugin_candidate",
      executionState: "blocked_deferred",
      capabilityState: "blocked_deferred",
      declarationEligibility: "install_authority_not_granted",
      nextOwner: "future_plugin_wave",
    }),
    capabilityWitnessFor({
      capabilityId: "external.web_search",
      toolName: "web_search",
      displayName: "Provider hosted web search",
      family: "provider_hosted_tool",
      descriptorKind: "provider_hosted_tool",
      executionState: "future_wave",
      capabilityState: "future_wave",
      declarationEligibility: "wave19_provider_hosted_tool",
      nextOwner: "Wave19",
    }),
    capabilityWitnessFor({
      capabilityId: "external.image_generation",
      toolName: "image_generation",
      displayName: "Provider hosted image generation",
      family: "provider_hosted_tool",
      descriptorKind: "provider_hosted_tool",
      executionState: "future_wave",
      capabilityState: "future_wave",
      declarationEligibility: "wave19_provider_hosted_tool",
      nextOwner: "Wave19",
    }),
  ];
}

function compactWitnessFor(profile) {
  const rowCount = profile.capabilityRows.length;
  const blockedCount = profile.capabilityRows.filter((row) => row.capabilityState === "blocked_deferred").length;
  const futureCount = profile.capabilityRows.filter((row) => row.capabilityState === "future_wave").length;
  const eligibleCount = profile.capabilityRows.filter((row) => row.capabilityState === "eligible_pending_declaration").length;
  const witness = {
    schema: EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA,
    profileId: profile.profileId,
    rowCount,
    eligibleCount,
    blockedCount,
    futureCount,
    descriptorKinds: countBy(profile.capabilityRows, "descriptorKind"),
    executionStates: countBy(profile.capabilityRows, "executionState"),
    selectorBlockerCodes: profile.selectorBlockers.map((blocker) => blocker.blockerCode).sort(),
    residentSummary: `${eligibleCount} discovery capabilities are profiled for later declaration; ${blockedCount} external action/plugin capabilities are blocked or deferred; ${futureCount} provider-hosted capabilities belong to later waves.`,
    operatorSummary: "PR109 is profile-only: no provider declarations, resource reads, dynamic MCP actions, plugin installs, context admission, or raw external payload exposure.",
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  witness.witnessDigest = digestFor("external-capability-compact-witness@1", witness);
  return witness;
}

function buildExternalCapabilityProfile(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const discoveryRegistry = source.discoveryRegistry || buildExternalCapabilityDiscoveryRegistry({
    projectId: source.projectId,
    workThreadId: source.workThreadId,
    generatedAt,
  });
  const mcpBoundaryStatus = source.mcpBoundaryStatus || buildMcpResourceToolBoundaryStatus({
    projectId: source.projectId,
    workThreadId: source.workThreadId,
    generatedAt,
  });
  const pluginGovernanceStatus = source.pluginGovernanceStatus || buildPluginGovernanceStatus({
    projectId: source.projectId,
    workThreadId: source.workThreadId,
    generatedAt,
  });
  const serverIdentities = (Array.isArray(source.serverIdentities) ? source.serverIdentities : defaultMcpServerIdentities())
    .map((witness) => witness?.schema === MCP_SERVER_IDENTITY_WITNESS_SCHEMA ? witness : mcpServerIdentityFor(witness));
  const selectorBlockers = (Array.isArray(source.selectorBlockers) ? source.selectorBlockers : defaultSelectorBlockers())
    .map((blocker) => blocker?.schema === MCP_SERVER_SELECTOR_BLOCKER_SCHEMA ? blocker : selectorBlockerFor(blocker));
  const capabilityRows = (Array.isArray(source.capabilityRows) ? source.capabilityRows : defaultCapabilityWitnessRows())
    .map((row) => row?.schema === EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA ? row : capabilityWitnessFor(row));
  const profile = {
    schema: EXTERNAL_CAPABILITY_PROFILE_SCHEMA,
    profileId: boundedString(source.profileId || "", 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    generatedAt,
    discoveryRegistry,
    mcpBoundaryStatus,
    pluginGovernanceStatus,
    serverIdentities,
    selectorBlockers,
    capabilityRows,
    byDescriptorKind: countBy(capabilityRows, "descriptorKind"),
    byExecutionState: countBy(capabilityRows, "executionState"),
    byCapabilityState: countBy(capabilityRows, "capabilityState"),
    providerDeclarationStarted: false,
    externalReadStarted: false,
    dynamicExternalActionStarted: false,
    pluginInstallStarted: false,
    contextAdmissionStarted: false,
    externalPayloadPersisted: false,
    durableMemoryAdmissionStarted: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawResourceUriIncluded: false,
    rawExternalPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  profile.profileId = profile.profileId || `external_capability_profile_${digestFor("external-capability-profile-source@1", {
    generatedAt,
    registryDigest: discoveryRegistry.registryDigest,
    boundaryDigest: mcpBoundaryStatus.statusDigest,
    pluginDigest: pluginGovernanceStatus.statusDigest,
    capabilityRows: capabilityRows.map((row) => row.rowDigest),
  }).slice(0, 24)}`;
  profile.compactWitness = compactWitnessFor(profile);
  profile.profileDigest = digestFor("external-capability-profile@1", {
    profileId: profile.profileId,
    generatedAt,
    registryDigest: discoveryRegistry.registryDigest,
    boundaryDigest: mcpBoundaryStatus.statusDigest,
    pluginDigest: pluginGovernanceStatus.statusDigest,
    serverIdentityDigests: serverIdentities.map((row) => row.identityDigest),
    selectorBlockerDigests: selectorBlockers.map((row) => row.blockerDigest),
    capabilityRowDigests: capabilityRows.map((row) => row.rowDigest),
    compactWitnessDigest: profile.compactWitness.witnessDigest,
  });
  validateExternalCapabilityProfile(profile);
  return profile;
}

function assertFalseFlags(target = {}, flags = [], label = "external_capability_profile") {
  for (const flag of flags) {
    if (target[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
}

function assertNestedMcpBoundaryRawUriSafe(status = {}) {
  for (const boundary of arrayOrEmpty(status.resourceReadBoundaries)) {
    if (boundary.rawUriIncluded !== false) {
      throw new Error(`external_capability_profile_nested_raw_uri:${boundary.boundaryId || "unknown"}`);
    }
  }
}

function validateExternalCapabilityProfile(profile = {}) {
  if (!isPlainObject(profile) || profile.schema !== EXTERNAL_CAPABILITY_PROFILE_SCHEMA) {
    throw new Error("external_capability_profile_schema_mismatch");
  }
  assertFalseFlags(profile, FALSE_PROFILE_FLAGS, "external_capability_profile");
  assertExternalCapabilityDiscoveryRegistrySafe(profile.discoveryRegistry);
  assertMcpResourceToolBoundarySafe(profile.mcpBoundaryStatus);
  assertNestedMcpBoundaryRawUriSafe(profile.mcpBoundaryStatus);
  assertPluginGovernanceStatusSafe(profile.pluginGovernanceStatus);

  const servers = arrayOrEmpty(profile.serverIdentities);
  if (!servers.length) throw new Error("external_capability_profile_missing_server_identity");
  const serverIdentityIds = new Set(servers.map((server) => server.serverIdentityId).filter(Boolean));
  const selectableServers = servers.filter((server) => server.enabledState === "enabled" && server.freshness === "fresh" && !["unknown", "untrusted"].includes(server.trustState));
  if (!selectableServers.length) throw new Error("external_capability_profile_no_selectable_mcp_server");
  for (const server of servers) {
    if (server.schema !== MCP_SERVER_IDENTITY_WITNESS_SCHEMA) throw new Error("mcp_server_identity_schema_mismatch");
    assertFalseFlags(server, ["rawEndpointIncluded", "rawCredentialIncluded", "rawSecretIncluded"], "mcp_server_identity");
    if (server.sourceIdentity?.schema !== EXTERNAL_SOURCE_IDENTITY_WITNESS_SCHEMA) throw new Error("external_source_identity_schema_mismatch");
    assertFalseFlags(server.sourceIdentity, ["rawEndpointIncluded", "rawCredentialIncluded", "rawSecretIncluded"], "external_source_identity");
  }

  const blockerCodes = new Set(arrayOrEmpty(profile.selectorBlockers).map((blocker) => blocker.blockerCode));
  for (const code of REQUIRED_BLOCKER_CODES) {
    if (!blockerCodes.has(code)) throw new Error(`external_capability_profile_missing_selector_blocker:${code}`);
  }
  for (const blocker of arrayOrEmpty(profile.selectorBlockers)) {
    if (blocker.schema !== MCP_SERVER_SELECTOR_BLOCKER_SCHEMA) throw new Error("mcp_server_selector_blocker_schema_mismatch");
    if (!BLOCKER_CODES.has(blocker.blockerCode)) throw new Error(`mcp_server_selector_blocker_unknown:${blocker.blockerCode}`);
  }

  const rows = arrayOrEmpty(profile.capabilityRows);
  if (!rows.length) throw new Error("external_capability_profile_missing_capability_rows");
  const requiredTools = [
    "tool_search",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
    "mcp_dynamic_tool_call",
    "list_available_plugins_to_install",
    "request_plugin_install",
    "web_search",
    "image_generation",
  ];
  const toolNames = new Set(rows.map((row) => row.toolName));
  for (const toolName of requiredTools) {
    if (!toolNames.has(toolName)) throw new Error(`external_capability_profile_missing_tool:${toolName}`);
  }
  for (const descriptorKind of DESCRIPTOR_KINDS) {
    if (!rows.some((row) => row.descriptorKind === descriptorKind)) throw new Error(`external_capability_profile_missing_descriptor_kind:${descriptorKind}`);
  }
  for (const row of rows) {
    if (row.schema !== EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA) throw new Error("external_capability_witness_row_schema_mismatch");
    assertFalseFlags(row, FALSE_CAPABILITY_FLAGS, `external_capability_witness_row:${row.toolName}`);
    if (!DESCRIPTOR_KINDS.has(row.descriptorKind)) throw new Error(`external_capability_witness_bad_descriptor_kind:${row.toolName}`);
    if (!EXECUTION_STATES.has(row.executionState)) throw new Error(`external_capability_witness_bad_execution_state:${row.toolName}`);
    if (!CAPABILITY_STATES.has(row.capabilityState)) throw new Error(`external_capability_witness_bad_capability_state:${row.toolName}`);
    if (row.serverIdentityId && !serverIdentityIds.has(row.serverIdentityId)) {
      throw new Error(`external_capability_witness_unknown_server_identity:${row.toolName}:${row.serverIdentityId}`);
    }
    if (row.toolName === "mcp_dynamic_tool_call" && row.executionState !== "not_executable_in_wave18") {
      throw new Error("external_capability_dynamic_action_not_blocked");
    }
    if (row.toolName === "request_plugin_install" && row.pluginInstallAllowed !== false) {
      throw new Error("external_capability_plugin_install_allowed");
    }
  }

  if (!isPlainObject(profile.compactWitness) || profile.compactWitness.schema !== EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA) {
    throw new Error("external_capability_compact_witness_schema_mismatch");
  }
  assertFalseFlags(profile.compactWitness, ["rawPayloadIncluded", "rawSecretIncluded"], "external_capability_compact_witness");
  return true;
}

module.exports = {
  EXTERNAL_CAPABILITY_COMPACT_WITNESS_SCHEMA,
  EXTERNAL_CAPABILITY_PROFILE_SCHEMA,
  EXTERNAL_CAPABILITY_WITNESS_ROW_SCHEMA,
  EXTERNAL_SOURCE_IDENTITY_WITNESS_SCHEMA,
  MCP_SERVER_IDENTITY_WITNESS_SCHEMA,
  MCP_SERVER_SELECTOR_BLOCKER_SCHEMA,
  buildExternalCapabilityProfile,
  capabilityWitnessFor,
  mcpServerIdentityFor,
  selectorBlockerFor,
  sourceIdentityFor,
  validateExternalCapabilityProfile,
};
