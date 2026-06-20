"use strict";

const crypto = require("node:crypto");

const {
  buildExternalCapabilityDescriptor,
} = require("./capability-discovery");
const {
  EXTERNAL_CAPABILITY_PROFILE_SCHEMA,
  buildExternalCapabilityProfile,
  validateExternalCapabilityProfile,
} = require("./external-capability-profile");

const EXTERNAL_TOOL_SEARCH_INPUT_SCHEMA = "external_tool_search_input@1";
const EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA = "external_tool_resident_declaration@1";
const EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA = "external_discovery_tool_call_gate@1";
const EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA = "external_discovery_result_envelope@1";

const DECLARED_DISCOVERY_TOOLS = Object.freeze(["tool_search", "list_mcp_resources", "list_mcp_resource_templates"]);
const BLOCKED_EXTERNAL_TOOLS = Object.freeze(["read_mcp_resource", "mcp_dynamic_tool_call", "request_plugin_install", "web_search", "image_generation"]);
const SEARCH_FAMILIES = new Set(["mcp_resource", "mcp_tool", "plugin_candidate", "hosted_provider_tool", "local_direct_tool"]);
const ENVELOPE_STATUSES = new Set(["completed", "unavailable", "blocked", "degraded"]);
const CONTEXT_ADMISSIONS = new Set(["summary_admitted", "ref_only", "blocked", "not_requested"]);
const MAX_DISCOVERY_RESULTS = 50;
const DEFAULT_DISCOVERY_RESULTS = 20;

const FALSE_DECLARATION_FLAGS = [
  "resourceReadDeclared",
  "dynamicMcpActionDeclared",
  "pluginInstallDeclared",
  "providerHostedToolDeclared",
  "discoveredToolAutoPromotionAllowed",
  "rawSchemaIncluded",
  "rawEndpointIncluded",
  "rawCredentialIncluded",
  "rawSecretIncluded",
];

const FALSE_GATE_FLAGS = [
  "resourceReadAllowed",
  "dynamicMcpActionAllowed",
  "pluginInstallAllowed",
  "discoveredToolAutoPromotionAllowed",
  "rawArgumentsIncluded",
  "rawSecretIncluded",
];

const FALSE_ENVELOPE_FLAGS = [
  "executionAuthorityGranted",
  "providerDeclarationGranted",
  "resourceReadPerformed",
  "dynamicMcpActionPerformed",
  "pluginInstallPerformed",
  "discoveredToolAutoPromotionAllowed",
  "workspaceMutationStarted",
  "contextWorldMutationStarted",
  "rawExternalPayloadIncluded",
  "rawResourceUriIncluded",
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

function scalarString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
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

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeEvidenceRef(input = {}, fallbackKind = "external_discovery") {
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
  ref.refDigest = digestFor("external-discovery-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "external_discovery") {
  return arrayOrEmpty(values).filter(isPlainObject).map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function assertFalseFlags(target = {}, flags = [], label = "external_discovery") {
  for (const flag of flags) {
    if (target[flag] !== false) throw new Error(`${label}_authority_leak:${flag}`);
  }
}

function normalizeMaxResults(value, fallback = DEFAULT_DISCOVERY_RESULTS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), MAX_DISCOVERY_RESULTS));
}

function normalizeFamilies(values) {
  const requested = normalizeStringList(values, ["mcp_resource", "mcp_tool", "plugin_candidate"]);
  const families = requested.filter((family) => SEARCH_FAMILIES.has(family));
  return families.length ? families : ["mcp_resource", "mcp_tool", "plugin_candidate"];
}

function buildExternalToolSearchInput(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const search = {
    schema: EXTERNAL_TOOL_SEARCH_INPUT_SCHEMA,
    query: boundedString(source.query, 160),
    families: normalizeFamilies(source.families),
    includeBlocked: source.includeBlocked !== false,
    maxResults: normalizeMaxResults(source.maxResults),
    rawQueryIncluded: false,
    rawExternalPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  search.inputDigest = digestFor("external-tool-search-input@1", search);
  return search;
}

function externalDiscoveryToolSchema(toolName) {
  if (toolName === "tool_search") {
    return {
      type: "function",
      name: "tool_search",
      description: "Discover external capability descriptors only. This cannot execute discovered tools, read resources, install plugins, or promote capabilities.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional bounded descriptor search text." },
          families: {
            type: "array",
            items: {
              type: "string",
              enum: ["mcp_resource", "mcp_tool", "plugin_candidate", "hosted_provider_tool", "local_direct_tool"],
            },
          },
          includeBlocked: { type: "boolean", description: "Whether blocked/deferred descriptors may appear in results." },
          maxResults: { type: "number", description: "Bounded result cap; harness clamps to policy maximum." },
        },
        additionalProperties: false,
      },
    };
  }
  if (toolName === "list_mcp_resources" || toolName === "list_mcp_resource_templates") {
    return {
      type: "function",
      name: toolName,
      description: toolName === "list_mcp_resources"
        ? "List MCP resource descriptors for one exact server identity. This cannot read resource payloads."
        : "List MCP resource template descriptors for one exact server identity. This cannot expand or read resource payloads.",
      parameters: {
        type: "object",
        properties: {
          serverIdentityId: { type: "string", description: "Exact MCP server identity witness id." },
          maxResults: { type: "number", description: "Bounded result cap; harness clamps to policy maximum." },
        },
        required: ["serverIdentityId"],
        additionalProperties: false,
      },
    };
  }
  return null;
}

function buildExternalToolResidentDeclaration(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.profile?.schema === EXTERNAL_CAPABILITY_PROFILE_SCHEMA
    ? source.profile
    : buildExternalCapabilityProfile(source.profile || source);
  validateExternalCapabilityProfile(profile);
  const generatedAt = normalizeString(source.generatedAt, nowIso(source.nowMs));
  const selectableServers = profile.serverIdentities
    .filter((server) => server.enabledState === "enabled" && server.freshness === "fresh" && !["unknown", "untrusted"].includes(server.trustState))
    .map((server) => server.serverIdentityId)
    .sort();
  const providerToolSchemas = DECLARED_DISCOVERY_TOOLS.map((toolName) => externalDiscoveryToolSchema(toolName));
  const declaration = {
    schema: EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA,
    declarationId: boundedString(source.declarationId || "", 180),
    activationSnapshotId: boundedString(source.activationSnapshotId || profile.profileId, 180),
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    generatedAt,
    declaredTools: [...DECLARED_DISCOVERY_TOOLS],
    blockedTools: [...BLOCKED_EXTERNAL_TOOLS],
    serverScope: selectableServers,
    resultEnvelopeSchema: EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA,
    contextAdmissionPolicyId: "external_discovery_summary_ref_only@1",
    providerToolSchemas,
    providerToolSchemaDigests: providerToolSchemas.map((schema) => digestFor("external-discovery-provider-tool-schema@1", schema)),
    providerRequestPatch: {
      tools: providerToolSchemas,
      tool_choice: "auto",
      parallel_tool_calls: false,
    },
    negativeCapabilityBlockers: [
      "discovered_tool_auto_promotion_blocked",
      "mcp_resource_read_blocked_until_pr111",
      "dynamic_mcp_action_blocked",
      "plugin_install_blocked",
      "provider_hosted_tools_deferred",
    ],
    providerDeclarationEnabled: true,
    modelVisibleToolEnabled: true,
    perCallAuthorityRequired: true,
    resourceReadDeclared: false,
    dynamicMcpActionDeclared: false,
    pluginInstallDeclared: false,
    providerHostedToolDeclared: false,
    discoveredToolAutoPromotionAllowed: false,
    rawSchemaIncluded: false,
    rawEndpointIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
  };
  declaration.declarationId = declaration.declarationId || `external_tool_declaration_${digestFor("external-tool-resident-declaration-id@1", {
    profileDigest: profile.profileDigest,
    providerToolSchemaDigests: declaration.providerToolSchemaDigests,
  }).slice(0, 24)}`;
  declaration.declarationDigest = digestFor("external-tool-resident-declaration@1", declaration);
  validateExternalToolResidentDeclaration(declaration);
  return declaration;
}

function validateExternalToolResidentDeclaration(declaration = {}) {
  const errors = [];
  if (!isPlainObject(declaration) || declaration.schema !== EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA) errors.push("external_tool_resident_declaration_schema_mismatch");
  for (const toolName of DECLARED_DISCOVERY_TOOLS) {
    if (!arrayOrEmpty(declaration.declaredTools).includes(toolName)) errors.push(`external_tool_declaration_missing:${toolName}`);
  }
  for (const blocked of BLOCKED_EXTERNAL_TOOLS) {
    if (arrayOrEmpty(declaration.declaredTools).includes(blocked)) errors.push(`external_tool_declaration_forbidden:${blocked}`);
  }
  if (arrayOrEmpty(declaration.declaredTools).includes("read_mcp_resource")) errors.push("external_tool_declaration_read_mcp_resource_not_pr110");
  if (declaration.providerDeclarationEnabled !== true || declaration.modelVisibleToolEnabled !== true) errors.push("external_tool_declaration_not_enabled");
  if (declaration.perCallAuthorityRequired !== true) errors.push("external_tool_declaration_missing_per_call_authority");
  if (!declaration.declarationDigest || !declaration.profileDigest) errors.push("external_tool_declaration_missing_frozen_digest");
  if (!Array.isArray(declaration.serverScope) || declaration.serverScope.length < 1) errors.push("external_tool_declaration_missing_server_scope");
  if (declaration.providerRequestPatch?.parallel_tool_calls !== false) errors.push("external_tool_declaration_parallel_calls_not_disabled");
  for (const schema of arrayOrEmpty(declaration.providerToolSchemas)) {
    if (!isPlainObject(schema) || !arrayOrEmpty(declaration.declaredTools).includes(schema.name)) errors.push(`external_tool_provider_schema_unknown:${schema?.name || ""}`);
  }
  try {
    assertFalseFlags(declaration, FALSE_DECLARATION_FLAGS, "external_tool_declaration");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  const text = normalizeString(value, "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`External discovery tool arguments are not valid JSON: ${error.message}`);
    parseError.code = "invalid_external_discovery_arguments";
    throw parseError;
  }
}

function declaredToolSet(declaration = {}) {
  return new Set(arrayOrEmpty(declaration.declaredTools));
}

function buildExternalDiscoveryToolCallGate(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const declaration = source.declaration?.schema === EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA
    ? source.declaration
    : buildExternalToolResidentDeclaration(source.declaration || source);
  const toolCall = isPlainObject(source.toolCall) ? source.toolCall : {};
  const toolName = normalizeString(toolCall.name || toolCall.toolName, "");
  const callId = boundedString(toolCall.callId || toolCall.call_id || toolCall.id, 180);
  const blockerCodes = [];
  let parsedArguments = {};
  try {
    parsedArguments = parseArguments(toolCall.arguments || toolCall.argumentsJson || toolCall.args);
  } catch (error) {
    blockerCodes.push(error.code || "invalid_external_discovery_arguments");
  }
  if (!declaredToolSet(declaration).has(toolName)) blockerCodes.push(`blocked_undeclared_external_tool_call:${toolName || "unknown"}`);
  if (toolName === "read_mcp_resource") blockerCodes.push("read_mcp_resource_not_declared_in_pr110");
  if (["mcp_dynamic_tool_call", "request_plugin_install", "web_search", "image_generation"].includes(toolName)) blockerCodes.push("external_action_or_hosted_tool_not_declared_in_wave18_pr110");
  const gate = {
    schema: EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA,
    gateId: boundedString(source.gateId || "", 180),
    declarationId: declaration.declarationId,
    declarationDigest: declaration.declarationDigest,
    toolName,
    callId,
    parsedArguments,
    status: blockerCodes.length ? "blocked" : "accepted",
    blockerCodes: normalizeStringList(blockerCodes),
    perCallAuthorityRequired: true,
    resultEnvelopeSchema: EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA,
    resourceReadAllowed: false,
    dynamicMcpActionAllowed: false,
    pluginInstallAllowed: false,
    discoveredToolAutoPromotionAllowed: false,
    rawArgumentsIncluded: false,
    rawSecretIncluded: false,
  };
  gate.gateId = gate.gateId || `external_discovery_call_gate_${digestFor("external-discovery-call-gate-id@1", {
    declarationDigest: declaration.declarationDigest,
    toolName,
    callId,
    parsedArguments,
  }).slice(0, 24)}`;
  gate.gateDigest = digestFor("external-discovery-tool-call-gate@1", gate);
  validateExternalDiscoveryToolCallGate(gate);
  return gate;
}

function validateExternalDiscoveryToolCallGate(gate = {}) {
  const errors = [];
  if (!isPlainObject(gate) || gate.schema !== EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA) errors.push("external_discovery_tool_call_gate_schema_mismatch");
  if (gate.status === "accepted" && !DECLARED_DISCOVERY_TOOLS.includes(gate.toolName)) errors.push(`external_discovery_gate_tool_not_allowed:${gate.toolName || ""}`);
  if (gate.status === "accepted" && (!gate.declarationDigest || !gate.gateDigest)) errors.push("external_discovery_gate_missing_frozen_digest");
  try {
    assertFalseFlags(gate, FALSE_GATE_FLAGS, "external_discovery_call_gate");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function sourceKindsForFamilies(families = []) {
  const kinds = new Set();
  for (const family of families) {
    if (family === "mcp_resource") {
      kinds.add("mcp_resource");
      kinds.add("mcp_resource_template");
    } else if (family === "mcp_tool") {
      kinds.add("mcp_tool");
    } else if (family === "plugin_candidate") {
      kinds.add("plugin_catalog");
      kinds.add("plugin");
    } else if (family === "hosted_provider_tool") {
      kinds.add("provider_hosted_tool");
    } else if (family === "local_direct_tool") {
      kinds.add("local_direct_tool");
    }
  }
  return kinds;
}

function descriptorMatchesQuery(descriptor = {}, query = "") {
  const text = normalizeString(query, "").toLowerCase();
  if (!text) return true;
  return [
    descriptor.displayName,
    descriptor.descriptorId,
    descriptor.sourceKind,
    descriptor.permissionClass,
    descriptor.deferredToolExposureStatus,
  ].some((value) => normalizeString(value, "").toLowerCase().includes(text));
}

function profileDescriptorsForSearch(profile = {}, searchInput = {}) {
  const sourceKinds = sourceKindsForFamilies(searchInput.families);
  const descriptors = arrayOrEmpty(profile.discoveryRegistry?.descriptors)
    .filter((descriptor) => sourceKinds.has(descriptor.sourceKind))
    .filter((descriptor) => searchInput.includeBlocked || descriptor.enabledState !== "blocked")
    .filter((descriptor) => descriptorMatchesQuery(descriptor, searchInput.query));
  const hostedRows = arrayOrEmpty(profile.capabilityRows)
    .filter((row) => searchInput.families.includes("hosted_provider_tool") && row.descriptorKind === "provider_hosted_tool")
    .map((row) => buildExternalCapabilityDescriptor({
      descriptorId: `external.${row.toolName}.descriptor`,
      sourceKind: "unknown",
      displayName: row.displayName,
      permissionClass: "external_action",
      externalSideEffectClass: "external_action",
      enabledState: "blocked",
      resultTrustLevel: "descriptor_only",
      deferredToolExposureStatus: row.declarationEligibility,
      sourceDigest: row.rowDigest,
    }));
  return [...descriptors, ...hostedRows].filter((descriptor) => descriptorMatchesQuery(descriptor, searchInput.query));
}

function sanitizeDisplayUri(value = "") {
  const text = normalizeString(value, "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return boundedString(`${parsed.protocol}${parsed.host ? `//${parsed.host}` : ""}${parsed.pathname}${parsed.search ? "?..." : ""}${parsed.hash ? "#..." : ""}`, 220);
  } catch {
    const [withoutHash, hash = ""] = text.split("#");
    const [withoutQuery, query = ""] = withoutHash.split("?");
    return boundedString(`${withoutQuery}${query ? "?..." : ""}${hash ? "#..." : ""}`.replace(/\/\/([^/@\s]+)@/g, "//...@"), 220);
  }
}

function descriptorFromMcpListEntry(entry = {}, serverIdentityId = "", sourceKind = "mcp_resource") {
  const source = isPlainObject(entry) ? entry : {};
  const uri = normalizeString(source.uri || source.resourceUri || source.templateUri || source.uriTemplate, "");
  const explicitLabel = normalizeString(source.name || source.displayName || source.title, "");
  const fallbackLabel = `${sourceKind} ${digestFor("mcp-list-entry-label@1", { serverIdentityId, sourceKind, uri }).slice(0, 12)}`;
  const name = boundedString(explicitLabel || fallbackLabel, 180);
  return buildExternalCapabilityDescriptor({
    descriptorId: boundedString(source.descriptorId || `${serverIdentityId}.${sourceKind}.${digestFor("mcp-list-entry@1", { uri, name }).slice(0, 16)}`, 180),
    sourceKind,
    displayName: name,
    serverIdentity: serverIdentityId,
    serverTrustState: "configured",
    resourceTemplateDigest: digestFor("mcp-resource-template-or-uri@1", uri || name),
    permissionClass: "external_read",
    externalSideEffectClass: "external_discovery",
    resultTrustLevel: "descriptor_only",
    enabledState: "deferred",
    deferredToolExposureStatus: sourceKind === "mcp_resource" ? "resource_read_requires_pr111_envelope" : "template_expansion_requires_read_gate",
    sourceDigest: digestFor("mcp-list-entry-source@1", {
      serverIdentityId,
      sourceKind,
      name,
      uriDigest: uri ? digestFor("mcp-resource-uri@1", uri) : "",
      displayUri: sanitizeDisplayUri(uri),
    }),
  });
}

function serverById(profile = {}, serverIdentityId = "") {
  return arrayOrEmpty(profile.serverIdentities).find((server) => server.serverIdentityId === serverIdentityId);
}

function serverSelectable(server = null) {
  return Boolean(server && server.enabledState === "enabled" && server.freshness === "fresh" && !["unknown", "untrusted"].includes(server.trustState));
}

function capDescriptors(descriptors = [], maxResults = DEFAULT_DISCOVERY_RESULTS) {
  const limit = normalizeMaxResults(maxResults);
  return {
    descriptors: descriptors.slice(0, limit),
    truncated: descriptors.length > limit,
    totalAvailable: descriptors.length,
  };
}

function envelopeStatus({ blocked = false, unavailable = false, degraded = false } = {}) {
  if (blocked) return "blocked";
  if (unavailable) return "unavailable";
  if (degraded) return "degraded";
  return "completed";
}

function buildExternalDiscoveryResultEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.profile?.schema === EXTERNAL_CAPABILITY_PROFILE_SCHEMA
    ? source.profile
    : buildExternalCapabilityProfile(source.profile || source);
  validateExternalCapabilityProfile(profile);
  const gate = source.gate?.schema === EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA
    ? source.gate
    : buildExternalDiscoveryToolCallGate({
      ...(source.gateInput || {}),
      declaration: source.declaration || buildExternalToolResidentDeclaration({ profile }),
      toolCall: source.toolCall,
    });
  validateExternalDiscoveryToolCallGate(gate);

  const toolName = gate.toolName;
  const parsed = isPlainObject(gate.parsedArguments) ? gate.parsedArguments : {};
  const searchInput = buildExternalToolSearchInput(toolName === "tool_search" ? parsed : {
    families: toolName === "list_mcp_resource_templates" ? ["mcp_resource"] : ["mcp_resource"],
    includeBlocked: true,
    maxResults: parsed.maxResults,
  });
  const blockerCodes = [...gate.blockerCodes];
  let descriptors = [];
  let unavailable = source.discoveryBackendAvailable === false;
  let degraded = false;
  let serverSelector = null;
  if (toolName === "tool_search" && !blockerCodes.length) {
    descriptors = unavailable ? [] : profileDescriptorsForSearch(profile, searchInput);
  } else if (toolName === "list_mcp_resources" || toolName === "list_mcp_resource_templates") {
    const serverIdentityId = normalizeString(parsed.serverIdentityId || source.serverIdentityId, "");
    const server = serverById(profile, serverIdentityId);
    serverSelector = {
      serverIdentityId,
      selectorState: serverSelectable(server) ? "selected" : "blocked",
      exactServerIdentityRequired: true,
      rawEndpointIncluded: false,
      rawCredentialIncluded: false,
    };
    if (!serverIdentityId) blockerCodes.push("mcp_server_missing");
    if (serverIdentityId && !server) blockerCodes.push("mcp_server_unknown");
    if (server && !serverSelectable(server)) blockerCodes.push(`mcp_server_not_selectable:${server.enabledState}:${server.freshness}:${server.trustState}`);
    const listEntries = toolName === "list_mcp_resources"
      ? arrayOrEmpty(source.resourceDescriptors)
      : arrayOrEmpty(source.resourceTemplateDescriptors);
    if (!blockerCodes.length && source.discoveryBackendAvailable === false) unavailable = true;
    if (!blockerCodes.length && !unavailable) {
      descriptors = listEntries.length
        ? listEntries.map((entry) => descriptorFromMcpListEntry(entry, serverIdentityId, toolName === "list_mcp_resources" ? "mcp_resource" : "mcp_resource_template"))
        : profileDescriptorsForSearch(profile, searchInput).filter((descriptor) => descriptor.sourceKind === (toolName === "list_mcp_resources" ? "mcp_resource" : "mcp_resource_template"));
    }
  } else {
    blockerCodes.push(`unsupported_external_discovery_tool:${toolName || "unknown"}`);
  }

  const capped = capDescriptors(descriptors, searchInput.maxResults);
  degraded = degraded || capped.truncated;
  const status = envelopeStatus({ blocked: blockerCodes.length > 0, unavailable, degraded });
  const envelope = {
    schema: EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA,
    envelopeId: boundedString(source.envelopeId || "", 180),
    toolName,
    projectId: boundedString(source.projectId || profile.projectId, 160),
    workThreadId: boundedString(source.workThreadId || profile.workThreadId, 160),
    threadId: boundedString(source.threadId, 160),
    turnId: boundedString(source.turnId, 160),
    callId: gate.callId,
    gateId: gate.gateId,
    gateDigest: gate.gateDigest,
    declarationDigest: gate.declarationDigest,
    searchInput,
    serverSelector,
    status,
    blockerCodes: normalizeStringList(blockerCodes),
    unavailableReason: unavailable ? boundedString(source.unavailableReason || "external_discovery_backend_unavailable", 180) : "",
    descriptorCount: capped.descriptors.length,
    totalAvailableDescriptorCount: capped.totalAvailable,
    truncated: capped.truncated,
    descriptors: capped.descriptors,
    sourceIdentityRefs: profile.serverIdentities.map((server) => normalizeEvidenceRef({
      kind: "mcp_server_identity_witness",
      id: server.serverIdentityId,
      digest: server.identityDigest,
      label: server.displayName,
      confidence: server.freshness,
    }, "external_discovery_source_identity")),
    contextAdmission: status === "completed" || status === "degraded" ? "summary_admitted" : "blocked",
    executionAuthorityGranted: false,
    providerDeclarationGranted: false,
    resourceReadPerformed: false,
    dynamicMcpActionPerformed: false,
    pluginInstallPerformed: false,
    discoveredToolAutoPromotionAllowed: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    rawExternalPayloadIncluded: false,
    rawResourceUriIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "external_discovery_result"),
  };
  envelope.envelopeId = envelope.envelopeId || `external_discovery_result_${digestFor("external-discovery-result-envelope-id@1", {
    gateDigest: gate.gateDigest,
    descriptorDigests: capped.descriptors.map((descriptor) => descriptor.descriptorDigest),
    status,
  }).slice(0, 24)}`;
  envelope.envelopeDigest = digestFor("external-discovery-result-envelope@1", envelope);
  validateExternalDiscoveryResultEnvelope(envelope);
  return envelope;
}

function validateExternalDiscoveryResultEnvelope(envelope = {}) {
  const errors = [];
  if (!isPlainObject(envelope) || envelope.schema !== EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA) errors.push("external_discovery_result_envelope_schema_mismatch");
  if (!DECLARED_DISCOVERY_TOOLS.includes(envelope.toolName)) errors.push(`external_discovery_result_tool_not_declared:${envelope.toolName || ""}`);
  if (!ENVELOPE_STATUSES.has(envelope.status)) errors.push(`external_discovery_result_bad_status:${envelope.status || ""}`);
  if (!CONTEXT_ADMISSIONS.has(envelope.contextAdmission)) errors.push(`external_discovery_result_bad_context_admission:${envelope.contextAdmission || ""}`);
  if (envelope.status === "completed" && envelope.unavailableReason) errors.push("external_discovery_completed_with_unavailable_reason");
  if (envelope.status === "unavailable" && !envelope.unavailableReason) errors.push("external_discovery_unavailable_missing_reason");
  if (envelope.status === "blocked" && !arrayOrEmpty(envelope.blockerCodes).length) errors.push("external_discovery_blocked_missing_blocker");
  if (envelope.toolName !== "tool_search") {
    if (!isPlainObject(envelope.serverSelector)) {
      errors.push("external_discovery_mcp_result_missing_server_selector");
    } else if (envelope.serverSelector.rawEndpointIncluded !== false || envelope.serverSelector.rawCredentialIncluded !== false) {
      errors.push("external_discovery_server_selector_raw_leak");
    }
  }
  if (Number(envelope.descriptorCount) !== arrayOrEmpty(envelope.descriptors).length) errors.push("external_discovery_descriptor_count_mismatch");
  for (const descriptor of arrayOrEmpty(envelope.descriptors)) {
    for (const flag of [
      "providerDeclarationAllowed",
      "externalToolExecutionAllowed",
      "pluginInstallAllowed",
      "resourceReadAllowed",
      "dynamicToolCallAllowed",
      "rawSchemaIncluded",
      "rawPayloadIncluded",
      "rawSecretIncluded",
    ]) {
      if (descriptor[flag] !== false) errors.push(`external_discovery_descriptor_authority_leak:${descriptor.descriptorId || ""}:${flag}`);
    }
  }
  try {
    assertFalseFlags(envelope, FALSE_ENVELOPE_FLAGS, "external_discovery_result");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

module.exports = {
  EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA,
  EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA,
  EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA,
  EXTERNAL_TOOL_SEARCH_INPUT_SCHEMA,
  buildExternalDiscoveryResultEnvelope,
  buildExternalDiscoveryToolCallGate,
  buildExternalToolResidentDeclaration,
  buildExternalToolSearchInput,
  validateExternalDiscoveryResultEnvelope,
  validateExternalDiscoveryToolCallGate,
  validateExternalToolResidentDeclaration,
};
