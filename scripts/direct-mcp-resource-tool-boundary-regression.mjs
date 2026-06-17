#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA,
  MCP_EXTERNAL_SOURCE_PROVENANCE_SCHEMA,
  MCP_RESOURCE_READ_BOUNDARY_SCHEMA,
  MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA,
  buildMcpDynamicToolCallBoundary,
  buildMcpExternalSourceProvenance,
  buildMcpResourceReadBoundary,
  buildMcpResourceToolBoundaryStatus,
  assertMcpResourceToolBoundarySafe,
} = require("../src/main/direct/external/mcp-boundary");
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

const provenance = buildMcpExternalSourceProvenance({
  serverIdentity: "fixture-mcp-server",
  serverTrustState: "configured",
  descriptorDigest: "descriptor_digest_fixture",
  schemaDigest: "schema_digest_fixture",
  authScope: "connector_account",
  networkScope: "connector_host",
});
assert(provenance.schema === MCP_EXTERNAL_SOURCE_PROVENANCE_SCHEMA, "provenance schema mismatch");
assert(provenance.rawSchemaIncluded === false, "provenance must not expose raw schema");
assert(provenance.rawSecretIncluded === false, "provenance must not expose secrets");

const resourceRead = buildMcpResourceReadBoundary({
  boundaryId: "mcp-read-request-123",
  projectId: "project_mcp_boundary_fixture",
  workThreadId: "work_thread_mcp_boundary_fixture",
  requestSource: "model_tool_call",
  uri: "mcp://user:secret@fixture-server/resource/path?token=secret#frag",
  provenance,
  nowMs: 0,
});
assert(resourceRead.schema === MCP_RESOURCE_READ_BOUNDARY_SCHEMA, "resource read schema mismatch");
assert(resourceRead.boundaryId === "mcp-read-request-123", "resource boundary should preserve supplied id");
assert(resourceRead.resourceUriDigest, "resource URI digest should exist");
assert(resourceRead.resourceUriDisplay.includes("?..."), "resource display should sanitize query");
assert(!resourceRead.resourceUriDisplay.includes("secret"), "resource display should strip credentials");
assert(resourceRead.resourceReadAllowed === false, "resource read must not be allowed");
assert(resourceRead.requestAcceptedForExecution === false, "resource read must not be executable");
assert(resourceRead.rawUriIncluded === false, "raw URI must not be exposed");
assert(resourceRead.rawResourcePayloadIncluded === false, "resource payload must not be exposed");

const dynamicCall = buildMcpDynamicToolCallBoundary({
  requestId: "mcp-dynamic-request-456",
  projectId: "project_mcp_boundary_fixture",
  workThreadId: "work_thread_mcp_boundary_fixture",
  requestSource: "model_tool_call",
  toolName: "fixture.search",
  toolSchemaDigest: "schema_digest_fixture",
  inputShape: { query: "string", limit: "number" },
  externalSideEffectClass: "external_action",
  provenance,
  nowMs: 0,
});
assert(dynamicCall.schema === MCP_DYNAMIC_TOOL_CALL_BOUNDARY_SCHEMA, "dynamic call schema mismatch");
assert(dynamicCall.boundaryId === "mcp-dynamic-request-456", "dynamic boundary should preserve supplied id");
assert(dynamicCall.toolNameDigest, "tool name digest should exist");
assert(dynamicCall.inputShapeDigest, "input shape digest should exist");
assert(dynamicCall.externalActionAllowed === false, "dynamic external action must not be allowed");
assert(dynamicCall.rawInputIncluded === false, "raw tool input must not be exposed");
assert(dynamicCall.rawOutputIncluded === false, "raw tool output must not be exposed");

const status = buildMcpResourceToolBoundaryStatus({
  projectId: "project_mcp_boundary_fixture",
  workThreadId: "work_thread_mcp_boundary_fixture",
  resourceReadBoundaries: [resourceRead],
  dynamicToolCallBoundaries: [dynamicCall],
  nowMs: 0,
});
assert(status.schema === MCP_RESOURCE_TOOL_BOUNDARY_STATUS_SCHEMA, "status schema mismatch");
assert(status.resourceReadBoundaryCount === 1, "resource boundary count mismatch");
assert(status.dynamicToolCallBoundaryCount === 1, "dynamic boundary count mismatch");
assert(status.sourceServerCount === 1, "source server count mismatch");
assert(status.resourceReadAllowed === false, "status must not allow resource read");
assert(status.dynamicToolCallAllowed === false, "status must not allow dynamic tool call");
assert(status.externalActionAllowed === false, "status must not allow external action");
assert(status.contextInjectionAllowed === false, "status must not allow context injection");
assertMcpResourceToolBoundarySafe(status);

const emptyStatus = buildMcpResourceToolBoundaryStatus({
  projectId: "project_mcp_boundary_fixture",
  workThreadId: "work_thread_mcp_boundary_fixture",
  nowMs: 0,
});
assert(emptyStatus.resourceReadBoundaryCount === 0, "default status should not create dummy resource boundaries");
assert(emptyStatus.dynamicToolCallBoundaryCount === 0, "default status should not create dummy dynamic boundaries");
assertMcpResourceToolBoundarySafe(emptyStatus);

const malformedResourceRead = buildMcpResourceReadBoundary({
  uri: "not a valid uri?api_key=secret#token=secret",
  nowMs: 0,
});
assert(malformedResourceRead.resourceUriDisplay.includes("?..."), "malformed fallback should sanitize query");
assert(malformedResourceRead.resourceUriDisplay.includes("#..."), "malformed fallback should sanitize hash");
assert(!malformedResourceRead.resourceUriDisplay.includes("api_key=secret"), "malformed fallback should not expose query value");
assert(!malformedResourceRead.resourceUriDisplay.includes("token=secret"), "malformed fallback should not expose hash value");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId: status.projectId,
  mcpBoundaryStatus: status,
});
assert(settingsProjection.sections.mcpBoundary.available === true, "settings should expose MCP boundary");
assert(settingsProjection.sections.mcpBoundary.resourceReadBoundaryCount === 1, "settings resource boundary count mismatch");
assert(settingsProjection.sections.mcpBoundary.dynamicToolCallBoundaryCount === 1, "settings dynamic boundary count mismatch");
assert(settingsProjection.authority.mcpBoundaryResourceReadAllowed === false, "settings must block resource read");
assert(settingsProjection.authority.mcpBoundaryDynamicToolCallAllowed === false, "settings must block dynamic tool call");
assert(Array.isArray(settingsProjection.rows.mcpBoundary) && settingsProjection.rows.mcpBoundary.length >= 8, "settings should render MCP boundary rows");
assert(settingsProjection.bridgeOrgans.includes("mcp_resource_tool_boundary"), "settings should cite MCP boundary bridge organ");
assertDirectSettingsSurfaceRendererSafe(settingsProjection);

const toolRegistry = buildToolCapabilityRegistry({
  projectId: status.projectId,
  nowMs: 0,
});
validateToolCapabilityRegistry(toolRegistry);
const toolRows = byToolId(toolRegistry);
for (const toolId of ["vanilla.read_mcp_resource", "vanilla.mcp_dynamic_tool"]) {
  const row = toolRows.get(toolId);
  assert(row, `missing MCP boundary row ${toolId}`);
  assert(row.odeuFamily === "external_resource_action_authority", `${toolId} should be resource/action family`);
  assert(row.implementationState === "projection_only", `${toolId} should be projection-only`);
  assert(row.promotionState === "deferred_external_authority", `${toolId} should remain deferred`);
  assert(row.localExecutorState === "scaffolded", `${toolId} should cite scaffolded boundary module`);
  assert(row.localExecutor === "src/main/direct/external/mcp-boundary.js", `${toolId} should cite MCP boundary module`);
  assert(row.providerDeclarationState === "not_declared", `${toolId} must not be provider-declared`);
}

const audit = buildDirectInformationBridgeAudit({ generatedAt: "1970-01-01T00:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic28.mcp-resource-tool-boundary"), "information registry should include MCP boundary row");

const hostile = buildMcpResourceToolBoundaryStatus({ projectId: "hostile" });
hostile.resourceReadAllowed = true;
expectThrows(() => assertMcpResourceToolBoundarySafe(hostile), "mcp_resource_tool_boundary_authority_leak");

const serialized = JSON.stringify({ provenance, resourceRead, dynamicCall, status, settingsProjection });
for (const forbidden of [
  "\"requestAcceptedForExecution\":true",
  "\"resourceReadAllowed\":true",
  "\"dynamicToolCallAllowed\":true",
  "\"externalActionAllowed\":true",
  "\"providerDeclarationAllowed\":true",
  "\"providerTransportAllowed\":true",
  "\"contextInjectionAllowed\":true",
  "\"rawUriIncluded\":true",
  "\"rawPayloadIncluded\":true",
  "\"rawResourcePayloadIncluded\":true",
  "\"rawInputIncluded\":true",
  "\"rawOutputIncluded\":true",
  "\"rawSchemaIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized MCP boundary leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  statusId: status.statusId,
  resourceReadBoundaryCount: status.resourceReadBoundaryCount,
  dynamicToolCallBoundaryCount: status.dynamicToolCallBoundaryCount,
  statusDigest: status.statusDigest,
}));
