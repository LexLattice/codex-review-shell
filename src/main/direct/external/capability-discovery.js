"use strict";

const crypto = require("node:crypto");

const EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA = "external_capability_descriptor@1";
const EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA = "external_capability_discovery_registry@1";
const EXTERNAL_CAPABILITY_DISCOVERY_STATUS_SCHEMA = "external_capability_discovery_status_projection@1";

const SOURCE_KINDS = new Set([
  "tool_search",
  "mcp_server",
  "mcp_resource",
  "mcp_resource_template",
  "mcp_tool",
  "plugin_catalog",
  "plugin",
  "unknown",
]);
const SERVER_TRUST_STATES = new Set(["trusted_local", "configured", "untrusted", "unknown"]);
const PERMISSION_CLASSES = new Set(["none", "read_only", "external_read", "external_action", "capability_mutation", "unknown"]);
const SIDE_EFFECT_CLASSES = new Set(["none", "external_discovery", "external_read", "external_action", "capability_mutation", "unknown"]);
const RESULT_TRUST_LEVELS = new Set(["descriptor_only", "untrusted_external", "staged_evidence_required", "unknown"]);
const ENABLED_STATES = new Set(["discovered", "deferred", "blocked", "not_declared", "unknown"]);

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "external_capability_discovery") {
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
  ref.refDigest = digestFor("external-capability-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "external_capability_discovery") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function descriptorIdFor(input = {}) {
  const existing = normalizeString(input.descriptorId || input.id, "");
  if (existing) return boundedString(existing, 180);
  return `external_capability_${digestFor("external-capability-descriptor-source@1", input).slice(0, 24)}`;
}

function buildExternalCapabilityDescriptor(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceKind = normalizeEnum(source.sourceKind || source.kind, SOURCE_KINDS, "unknown");
  const permissionClass = normalizeEnum(source.permissionClass, PERMISSION_CLASSES, sourceKind === "plugin" ? "capability_mutation" : "unknown");
  const descriptor = {
    schema: EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA,
    descriptorId: descriptorIdFor(source),
    sourceKind,
    displayName: boundedString(source.displayName || source.name || source.toolName || source.resourceName || sourceKind, 160),
    serverIdentity: boundedString(source.serverIdentity || source.serverName || source.pluginName, 180),
    serverTrustState: normalizeEnum(source.serverTrustState, SERVER_TRUST_STATES, "unknown"),
    toolSchemaDigest: boundedString(source.toolSchemaDigest || source.schemaDigest, 180),
    resourceTemplateDigest: boundedString(source.resourceTemplateDigest || source.templateDigest, 180),
    permissionClass,
    externalSideEffectClass: normalizeEnum(source.externalSideEffectClass || source.sideEffectClass, SIDE_EFFECT_CLASSES, permissionClass === "read_only" ? "external_read" : "external_discovery"),
    authScope: boundedString(source.authScope || "unknown", 120),
    networkScope: boundedString(source.networkScope || "unknown", 120),
    resultTrustLevel: normalizeEnum(source.resultTrustLevel, RESULT_TRUST_LEVELS, "descriptor_only"),
    enabledState: normalizeEnum(source.enabledState, ENABLED_STATES, "deferred"),
    deferredToolExposureStatus: boundedString(source.deferredToolExposureStatus || "not_provider_declared", 160),
    sourceDigest: boundedString(source.sourceDigest || digestFor("external-capability-source@1", {
      sourceKind,
      name: source.displayName || source.name || source.toolName || source.resourceName || "",
      serverIdentity: source.serverIdentity || source.serverName || source.pluginName || "",
      toolSchemaDigest: source.toolSchemaDigest || source.schemaDigest || "",
      resourceTemplateDigest: source.resourceTemplateDigest || source.templateDigest || "",
    }), 180),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "external_capability_descriptor"),
    discoveryIsExecution: false,
    providerDeclarationAllowed: false,
    externalToolExecutionAllowed: false,
    pluginInstallAllowed: false,
    resourceReadAllowed: false,
    dynamicToolCallAllowed: false,
    rawSchemaIncluded: false,
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  descriptor.descriptorDigest = digestFor("external-capability-descriptor@1", descriptor);
  return descriptor;
}

function defaultExternalCapabilityDescriptors() {
  return [
    {
      descriptorId: "external.tool_search.discovery",
      sourceKind: "tool_search",
      displayName: "tool_search discovery",
      permissionClass: "none",
      externalSideEffectClass: "external_discovery",
      enabledState: "deferred",
      resultTrustLevel: "descriptor_only",
      deferredToolExposureStatus: "discovery_only_not_execution",
    },
    {
      descriptorId: "external.mcp.resources.discovery",
      sourceKind: "mcp_resource",
      displayName: "MCP resource listing",
      permissionClass: "external_read",
      externalSideEffectClass: "external_discovery",
      enabledState: "deferred",
      resultTrustLevel: "staged_evidence_required",
      deferredToolExposureStatus: "resource_read_boundary_pending",
    },
    {
      descriptorId: "external.mcp.templates.discovery",
      sourceKind: "mcp_resource_template",
      displayName: "MCP resource template listing",
      permissionClass: "external_read",
      externalSideEffectClass: "external_discovery",
      enabledState: "deferred",
      resultTrustLevel: "descriptor_only",
      deferredToolExposureStatus: "resource_template_boundary_pending",
    },
    {
      descriptorId: "external.mcp.dynamic_tool.discovery",
      sourceKind: "mcp_tool",
      displayName: "MCP dynamic tool descriptor",
      permissionClass: "external_action",
      externalSideEffectClass: "external_action",
      enabledState: "blocked",
      resultTrustLevel: "untrusted_external",
      deferredToolExposureStatus: "dynamic_tool_execution_blocked",
    },
    {
      descriptorId: "external.plugin.catalog.discovery",
      sourceKind: "plugin_catalog",
      displayName: "Plugin catalog listing",
      permissionClass: "none",
      externalSideEffectClass: "external_discovery",
      enabledState: "deferred",
      resultTrustLevel: "descriptor_only",
      deferredToolExposureStatus: "plugin_catalog_only",
    },
    {
      descriptorId: "external.plugin.install.mutation",
      sourceKind: "plugin",
      displayName: "Plugin install request",
      permissionClass: "capability_mutation",
      externalSideEffectClass: "capability_mutation",
      enabledState: "blocked",
      resultTrustLevel: "untrusted_external",
      deferredToolExposureStatus: "install_blocked_until_plugin_governance",
    },
  ];
}

function buildExternalCapabilityDiscoveryRegistry(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const descriptors = (Array.isArray(source.descriptors) ? source.descriptors : defaultExternalCapabilityDescriptors())
    .map((descriptor) => buildExternalCapabilityDescriptor(descriptor));
  const registry = {
    schema: EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA,
    registryId: boundedString(source.registryId || `external_capability_discovery_registry_${digestFor("external-capability-registry-source@1", { descriptors }).slice(0, 24)}`, 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    status: boundedString(source.status || "discovery_registry_only", 120),
    descriptors,
    descriptorCount: descriptors.length,
    bySourceKind: countBy(descriptors, "sourceKind"),
    byEnabledState: countBy(descriptors, "enabledState"),
    byPermissionClass: countBy(descriptors, "permissionClass"),
    providerDeclarationAllowed: false,
    externalToolExecutionAllowed: false,
    resourceReadAllowed: false,
    dynamicToolCallAllowed: false,
    pluginInstallAllowed: false,
    autoEnableDiscoveredToolsAllowed: false,
    rawSchemaIncluded: false,
    rawPayloadIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  registry.registryDigest = digestFor("external-capability-discovery-registry@1", registry);
  return registry;
}

function buildExternalCapabilityDiscoveryStatusProjection(input = {}) {
  const registry = normalizeString(input?.schema, "") === EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA
    ? input
    : buildExternalCapabilityDiscoveryRegistry(input);
  const status = {
    schema: EXTERNAL_CAPABILITY_DISCOVERY_STATUS_SCHEMA,
    registryId: registry.registryId,
    projectId: registry.projectId,
    status: registry.status,
    descriptorCount: registry.descriptorCount,
    bySourceKind: registry.bySourceKind,
    byEnabledState: registry.byEnabledState,
    byPermissionClass: registry.byPermissionClass,
    blockedCount: Number(registry.byEnabledState?.blocked || 0),
    deferredCount: Number(registry.byEnabledState?.deferred || 0),
    discoveredCount: Number(registry.byEnabledState?.discovered || 0),
    providerDeclarationAllowed: registry.providerDeclarationAllowed === true,
    externalToolExecutionAllowed: registry.externalToolExecutionAllowed === true,
    resourceReadAllowed: registry.resourceReadAllowed === true,
    dynamicToolCallAllowed: registry.dynamicToolCallAllowed === true,
    pluginInstallAllowed: registry.pluginInstallAllowed === true,
    autoEnableDiscoveredToolsAllowed: registry.autoEnableDiscoveredToolsAllowed === true,
    rawSchemaIncluded: registry.rawSchemaIncluded === true,
    rawPayloadIncluded: registry.rawPayloadIncluded === true,
    rawSecretIncluded: registry.rawSecretIncluded === true,
    registryDigest: registry.registryDigest,
    rendererSafeSummary: "External capability discovery is descriptor-only; discovered tools/resources/plugins are not provider-declared, approved, executed, or trusted as project evidence.",
  };
  status.projectionDigest = digestFor("external-capability-discovery-status@1", status);
  return status;
}

function assertExternalCapabilityDiscoveryRegistrySafe(registry = {}) {
  if (!isPlainObject(registry) || registry.schema !== EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA) {
    throw new Error("external_capability_discovery_registry_schema_mismatch");
  }
  for (const flag of [
    "providerDeclarationAllowed",
    "externalToolExecutionAllowed",
    "resourceReadAllowed",
    "dynamicToolCallAllowed",
    "pluginInstallAllowed",
    "autoEnableDiscoveredToolsAllowed",
    "rawSchemaIncluded",
    "rawPayloadIncluded",
    "rawSecretIncluded",
  ]) {
    if (registry[flag] !== false) throw new Error(`external_capability_discovery_authority_leak:${flag}`);
  }
  for (const descriptor of arrayOrEmpty(registry.descriptors)) {
    if (descriptor.schema !== EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA) throw new Error("external_capability_descriptor_schema_mismatch");
    for (const flag of [
      "discoveryIsExecution",
      "providerDeclarationAllowed",
      "externalToolExecutionAllowed",
      "pluginInstallAllowed",
      "resourceReadAllowed",
      "dynamicToolCallAllowed",
      "rawSchemaIncluded",
      "rawPayloadIncluded",
      "rawSecretIncluded",
    ]) {
      if (descriptor[flag] !== false) throw new Error(`external_capability_descriptor_authority_leak:${flag}`);
    }
  }
  return true;
}

module.exports = {
  EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA,
  EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA,
  EXTERNAL_CAPABILITY_DISCOVERY_STATUS_SCHEMA,
  buildExternalCapabilityDescriptor,
  buildExternalCapabilityDiscoveryRegistry,
  buildExternalCapabilityDiscoveryStatusProjection,
  assertExternalCapabilityDiscoveryRegistrySafe,
};
