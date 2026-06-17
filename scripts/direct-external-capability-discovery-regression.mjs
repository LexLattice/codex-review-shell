#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA,
  EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA,
  EXTERNAL_CAPABILITY_DISCOVERY_STATUS_SCHEMA,
  buildExternalCapabilityDescriptor,
  buildExternalCapabilityDiscoveryRegistry,
  buildExternalCapabilityDiscoveryStatusProjection,
  assertExternalCapabilityDiscoveryRegistrySafe,
} = require("../src/main/direct/external/capability-discovery");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");

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

const descriptor = buildExternalCapabilityDescriptor({
  descriptorId: "fixture.mcp.tool",
  sourceKind: "mcp_tool",
  displayName: "fixture MCP tool",
  serverIdentity: "fixture-server",
  serverTrustState: "configured",
  toolSchemaDigest: "schema_digest_fixture",
  permissionClass: "external_action",
  externalSideEffectClass: "external_action",
  authScope: "connector_account",
  networkScope: "connector_host",
  resultTrustLevel: "untrusted_external",
  enabledState: "blocked",
});

assert(descriptor.schema === EXTERNAL_CAPABILITY_DESCRIPTOR_SCHEMA, "descriptor schema mismatch");
assert(descriptor.discoveryIsExecution === false, "discovery must not be execution");
assert(descriptor.externalToolExecutionAllowed === false, "descriptor must not allow external execution");
assert(descriptor.providerDeclarationAllowed === false, "descriptor must not allow provider declaration");
assert(descriptor.descriptorDigest, "descriptor digest should exist");

const registry = buildExternalCapabilityDiscoveryRegistry({
  projectId: "project_external_capability_fixture",
  workThreadId: "work_thread_external_capability_fixture",
  nowMs: 0,
});
assert(registry.schema === EXTERNAL_CAPABILITY_DISCOVERY_REGISTRY_SCHEMA, "registry schema mismatch");
assert(registry.descriptorCount >= 6, "default registry should cover tool_search, MCP, and plugin discovery posture");
assert(registry.bySourceKind.tool_search === 1, "tool_search descriptor should exist");
assert(registry.bySourceKind.mcp_resource === 1, "MCP resource descriptor should exist");
assert(registry.bySourceKind.mcp_resource_template === 1, "MCP resource template descriptor should exist");
assert(registry.bySourceKind.mcp_tool === 1, "MCP dynamic tool descriptor should exist");
assert(registry.bySourceKind.plugin_catalog === 1, "plugin catalog descriptor should exist");
assert(registry.bySourceKind.plugin === 1, "plugin install descriptor should exist");
assert(registry.byEnabledState.blocked >= 2, "externally mutating descriptors should be blocked");
assert(registry.providerDeclarationAllowed === false, "registry must not allow provider declaration");
assert(registry.externalToolExecutionAllowed === false, "registry must not allow external execution");
assert(registry.resourceReadAllowed === false, "registry must not allow resource read in PR60");
assert(registry.pluginInstallAllowed === false, "registry must not allow plugin install");
assertExternalCapabilityDiscoveryRegistrySafe(registry);

const status = buildExternalCapabilityDiscoveryStatusProjection(registry);
assert(status.schema === EXTERNAL_CAPABILITY_DISCOVERY_STATUS_SCHEMA, "status schema mismatch");
assert(status.descriptorCount === registry.descriptorCount, "status descriptor count should match registry");
assert(status.blockedCount === registry.byEnabledState.blocked, "status blocked count should match registry");
assert(status.providerDeclarationAllowed === false, "status must not allow provider declaration");
assert(status.externalToolExecutionAllowed === false, "status must not allow execution");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: registry.projectId,
  externalDiscoveryStatus: status,
});
assert(settingsProjection.sections.externalDiscovery.available === true, "settings should expose external discovery");
assert(settingsProjection.sections.externalDiscovery.descriptorCount === registry.descriptorCount, "settings descriptor count should match");
assert(settingsProjection.authority.externalDiscoveryProviderDeclarationAllowed === false, "settings must block provider declaration");
assert(settingsProjection.authority.externalDiscoveryToolExecutionAllowed === false, "settings must block tool execution");
assert(settingsProjection.authority.externalDiscoveryResourceReadAllowed === false, "settings must block resource read");
assert(Array.isArray(settingsProjection.rows.externalDiscovery) && settingsProjection.rows.externalDiscovery.length >= 6, "settings should render discovery rows");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const toolRegistry = buildToolCapabilityRegistry({
  projectId: registry.projectId,
  nowMs: 0,
});
validateToolCapabilityRegistry(toolRegistry);
const toolRows = byToolId(toolRegistry);
for (const toolId of [
  "vanilla.tool_search",
  "vanilla.list_mcp_resources",
  "vanilla.list_mcp_resource_templates",
  "vanilla.list_available_plugins_to_install",
]) {
  const row = toolRows.get(toolId);
  assert(row, `missing discovery row ${toolId}`);
  assert(row.odeuFamily === "external_capability_discovery", `${toolId} should be discovery family`);
  assert(row.implementationState === "projection_only", `${toolId} should cite projection substrate`);
  assert(row.localExecutorState === "scaffolded", `${toolId} should cite scaffolded discovery module`);
  assert(row.localExecutor === "src/main/direct/external/capability-discovery.js", `${toolId} should cite discovery module`);
  assert(row.providerDeclarationState === "not_declared", `${toolId} must not be provider-declared`);
  assert(row.promotionState === "diagnostic_only", `${toolId} should remain diagnostic-only`);
}

const hostile = buildExternalCapabilityDiscoveryRegistry({
  descriptors: [{
    sourceKind: "mcp_tool",
    externalToolExecutionAllowed: true,
  }],
});
hostile.descriptors[0].externalToolExecutionAllowed = true;
expectThrows(() => assertExternalCapabilityDiscoveryRegistrySafe(hostile), "external_capability_descriptor_authority_leak");

const serialized = JSON.stringify({ descriptor, registry, status, settingsProjection });
for (const forbidden of [
  "\"providerDeclarationAllowed\":true",
  "\"externalToolExecutionAllowed\":true",
  "\"resourceReadAllowed\":true",
  "\"dynamicToolCallAllowed\":true",
  "\"pluginInstallAllowed\":true",
  "\"rawSchemaIncluded\":true",
  "\"rawPayloadIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized discovery registry leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  registryId: registry.registryId,
  descriptorCount: registry.descriptorCount,
  projectionDigest: status.projectionDigest,
}));
