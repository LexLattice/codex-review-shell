#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
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
} = require("../src/main/direct/external/external-discovery-tools");
const {
  buildExternalCapabilityProfile,
} = require("../src/main/direct/external/external-capability-profile");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error?.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error?.message || error}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const profile = buildExternalCapabilityProfile({
  projectId: "project_wave18_pr110_fixture",
  workThreadId: "work_thread_wave18_pr110_fixture",
  generatedAt: "2026-06-20T11:00:00.000Z",
});

const searchInput = buildExternalToolSearchInput({
  query: "MCP",
  families: ["mcp_resource", "mcp_tool", "plugin_candidate", "hosted_provider_tool", "bogus_family"],
  includeBlocked: true,
  maxResults: 1000,
});
assert.equal(searchInput.schema, EXTERNAL_TOOL_SEARCH_INPUT_SCHEMA, "search input schema mismatch");
assert(searchInput.families.includes("mcp_resource"), "mcp_resource family should be preserved");
assert(!searchInput.families.includes("bogus_family"), "unknown families should be dropped");
assert.equal(searchInput.maxResults, 50, "maxResults should clamp to policy cap");
assert.equal(searchInput.rawSecretIncluded, false, "search input must not expose secrets");

const declaration = buildExternalToolResidentDeclaration({
  profile,
  generatedAt: "2026-06-20T11:00:00.000Z",
});
assert.equal(declaration.schema, EXTERNAL_TOOL_RESIDENT_DECLARATION_SCHEMA, "declaration schema mismatch");
assert.deepEqual(declaration.declaredTools, ["tool_search", "list_mcp_resources", "list_mcp_resource_templates"], "PR110 should declare only safe discovery tools");
assert(declaration.blockedTools.includes("read_mcp_resource"), "read_mcp_resource should stay blocked until PR111");
assert(declaration.blockedTools.includes("request_plugin_install"), "plugin install should be blocked");
assert.equal(declaration.providerDeclarationEnabled, true, "safe discovery tools should be provider-visible in PR110");
assert.equal(declaration.modelVisibleToolEnabled, true, "safe discovery tools should be model-visible in PR110");
assert.equal(declaration.providerRequestPatch.parallel_tool_calls, false, "parallel tool calls should stay disabled");
assert.equal(declaration.resourceReadDeclared, false, "PR110 must not declare resource reads");
assert.equal(declaration.dynamicMcpActionDeclared, false, "PR110 must not declare dynamic MCP action");
assert.equal(declaration.pluginInstallDeclared, false, "PR110 must not declare plugin install");
assert.equal(declaration.providerHostedToolDeclared, false, "PR110 must not declare provider hosted tools");
assert(declaration.serverScope.includes("mcp_server_project_fixture"), "declaration should cite selectable MCP server scope");
validateExternalToolResidentDeclaration(declaration);

const searchGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "tool_search",
    callId: "call_tool_search_fixture",
    arguments: JSON.stringify({
      families: ["mcp_resource", "mcp_tool", "plugin_candidate"],
      includeBlocked: true,
      maxResults: 10,
    }),
  },
});
assert.equal(searchGate.schema, EXTERNAL_DISCOVERY_TOOL_CALL_GATE_SCHEMA, "gate schema mismatch");
assert.equal(searchGate.status, "accepted", "tool_search gate should be accepted");
assert.equal(searchGate.resourceReadAllowed, false, "gate cannot allow resource reads");
assert.equal(searchGate.dynamicMcpActionAllowed, false, "gate cannot allow dynamic actions");
assert.equal(searchGate.pluginInstallAllowed, false, "gate cannot allow plugin install");
validateExternalDiscoveryToolCallGate(searchGate);

const searchResult = buildExternalDiscoveryResultEnvelope({
  profile,
  declaration,
  gate: searchGate,
});
assert.equal(searchResult.schema, EXTERNAL_DISCOVERY_RESULT_ENVELOPE_SCHEMA, "search result schema mismatch");
assert.equal(searchResult.status, "completed", "tool_search should complete with descriptor evidence");
assert(searchResult.descriptorCount >= 3, "tool_search should return capability descriptors");
assert(searchResult.descriptors.some((row) => row.sourceKind === "mcp_tool"), "tool_search should include blocked MCP tool descriptor when requested");
assert(searchResult.descriptors.some((row) => row.sourceKind === "plugin_catalog" || row.sourceKind === "plugin"), "tool_search should include plugin candidate descriptors");
assert.equal(searchResult.executionAuthorityGranted, false, "search result must not grant execution");
assert.equal(searchResult.providerDeclarationGranted, false, "search result must not grant declaration");
assert.equal(searchResult.discoveredToolAutoPromotionAllowed, false, "discovered tools must not auto-promote");
validateExternalDiscoveryResultEnvelope(searchResult);

const noBlockedGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "tool_search",
    callId: "call_tool_search_no_blocked_fixture",
    arguments: JSON.stringify({
      families: ["mcp_tool", "plugin_candidate"],
      includeBlocked: false,
      maxResults: 20,
    }),
  },
});
const noBlockedResult = buildExternalDiscoveryResultEnvelope({ profile, declaration, gate: noBlockedGate });
assert.equal(noBlockedResult.status, "completed", "filtered search should complete");
assert(!noBlockedResult.descriptors.some((row) => row.enabledState === "blocked"), "includeBlocked=false should omit blocked descriptors");

const cappedGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "list_mcp_resources",
    callId: "call_mcp_resources_capped_fixture",
    arguments: JSON.stringify({
      serverIdentityId: "mcp_server_project_fixture",
      maxResults: 2,
    }),
  },
});
const resourceResult = buildExternalDiscoveryResultEnvelope({
  profile,
  declaration,
  gate: cappedGate,
  resourceDescriptors: [
    { uri: "mcp://user:secret@fixture/resource/alpha?token=secret" },
    { name: "beta", uri: "mcp://fixture/resource/beta" },
    { name: "gamma", uri: "mcp://fixture/resource/gamma" },
  ],
});
assert.equal(resourceResult.status, "degraded", "capped resource listing should be degraded");
assert.equal(resourceResult.descriptorCount, 2, "resource list should respect maxResults");
assert.equal(resourceResult.totalAvailableDescriptorCount, 3, "resource list should preserve total available count");
assert.equal(resourceResult.truncated, true, "resource list should mark truncation");
assert.equal(resourceResult.serverSelector.serverIdentityId, "mcp_server_project_fixture", "resource list should cite exact server");
assert.equal(resourceResult.rawResourceUriIncluded, false, "resource result must not include raw URI");
assert(resourceResult.descriptors.every((row) => row.resourceReadAllowed === false), "resource descriptors must not imply read authority");
assert(!JSON.stringify(resourceResult.descriptors).includes("secret"), "resource descriptors must not expose URI credentials");
assert(!JSON.stringify(resourceResult.descriptors).includes("token=secret"), "resource descriptors must not expose raw URI query tokens");
validateExternalDiscoveryResultEnvelope(resourceResult);

const templateGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "list_mcp_resource_templates",
    callId: "call_mcp_templates_fixture",
    arguments: JSON.stringify({
      serverIdentityId: "mcp_server_project_fixture",
      maxResults: 10,
    }),
  },
});
const templateResult = buildExternalDiscoveryResultEnvelope({
  profile,
  declaration,
  gate: templateGate,
  resourceTemplateDescriptors: [
    { name: "repo file", uriTemplate: "mcp://fixture/files/{path}" },
  ],
});
assert.equal(templateResult.status, "completed", "template listing should complete");
assert.equal(templateResult.descriptors[0].sourceKind, "mcp_resource_template", "template result should use resource template source kind");
validateExternalDiscoveryResultEnvelope(templateResult);

const missingServerGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "list_mcp_resources",
    callId: "call_mcp_resources_missing_server_fixture",
    arguments: JSON.stringify({ maxResults: 5 }),
  },
});
const missingServerResult = buildExternalDiscoveryResultEnvelope({ profile, declaration, gate: missingServerGate });
assert.equal(missingServerResult.status, "blocked", "missing server should block MCP listing");
assert(missingServerResult.blockerCodes.includes("mcp_server_missing"), "missing server blocker should be explicit");
validateExternalDiscoveryResultEnvelope(missingServerResult);

const unavailableGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "tool_search",
    callId: "call_tool_search_unavailable_fixture",
    arguments: JSON.stringify({ maxResults: 10 }),
  },
});
const unavailableResult = buildExternalDiscoveryResultEnvelope({
  profile,
  declaration,
  gate: unavailableGate,
  discoveryBackendAvailable: false,
});
assert.equal(unavailableResult.status, "unavailable", "missing backend should be unavailable");
assert.equal(unavailableResult.descriptorCount, 0, "unavailable should not masquerade as successful empty result");
assert(unavailableResult.unavailableReason, "unavailable result should cite reason");
validateExternalDiscoveryResultEnvelope(unavailableResult);

const invalidArgumentsGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "tool_search",
    callId: "call_tool_search_bad_arguments_fixture",
    arguments: "{not-json",
  },
});
assert.equal(invalidArgumentsGate.status, "blocked", "invalid JSON arguments should block gate");
const invalidArgumentsResult = buildExternalDiscoveryResultEnvelope({
  profile,
  declaration,
  gate: invalidArgumentsGate,
});
assert.equal(invalidArgumentsResult.status, "blocked", "blocked gate should produce blocked envelope");
assert.equal(invalidArgumentsResult.descriptorCount, 0, "blocked gate must not return discovery descriptors");
validateExternalDiscoveryResultEnvelope(invalidArgumentsResult);

const blockedReadGate = buildExternalDiscoveryToolCallGate({
  declaration,
  toolCall: {
    name: "read_mcp_resource",
    callId: "call_read_blocked_fixture",
    arguments: JSON.stringify({
      serverIdentityId: "mcp_server_project_fixture",
      uri: "mcp://fixture/resource/alpha",
    }),
  },
});
assert.equal(blockedReadGate.status, "blocked", "read_mcp_resource must not be declared in PR110");
assert(blockedReadGate.blockerCodes.some((code) => code.includes("blocked_undeclared_external_tool_call")), "read tool should be blocked as undeclared");

const malformedDeclaration = clone(declaration);
malformedDeclaration.declaredTools.push("read_mcp_resource");
expectThrows(() => validateExternalToolResidentDeclaration(malformedDeclaration), "external_tool_declaration_forbidden:read_mcp_resource");

const malformedGate = clone(searchGate);
malformedGate.resourceReadAllowed = true;
expectThrows(() => validateExternalDiscoveryToolCallGate(malformedGate), "external_discovery_call_gate_authority_leak:resourceReadAllowed");

const malformedEnvelope = clone(searchResult);
malformedEnvelope.providerDeclarationGranted = true;
expectThrows(() => validateExternalDiscoveryResultEnvelope(malformedEnvelope), "external_discovery_result_authority_leak:providerDeclarationGranted");

const malformedMissingSelector = clone(resourceResult);
malformedMissingSelector.serverSelector = null;
expectThrows(() => validateExternalDiscoveryResultEnvelope(malformedMissingSelector), "external_discovery_mcp_result_missing_server_selector");

const rawDescriptorEnvelope = clone(searchResult);
rawDescriptorEnvelope.descriptors[0].rawPayloadIncluded = true;
expectThrows(() => validateExternalDiscoveryResultEnvelope(rawDescriptorEnvelope), "external_discovery_descriptor_authority_leak");

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-20T11:00:00.000Z" });
assert(audit.rows.some((row) => row.id === "ic56.external-discovery-tools"), "information registry should include external discovery tools row");

const serialized = JSON.stringify({ declaration, searchGate, searchResult, resourceResult, templateResult });
for (const forbidden of [
  "\"resourceReadDeclared\":true",
  "\"dynamicMcpActionDeclared\":true",
  "\"pluginInstallDeclared\":true",
  "\"resourceReadAllowed\":true",
  "\"dynamicMcpActionAllowed\":true",
  "\"pluginInstallAllowed\":true",
  "\"executionAuthorityGranted\":true",
  "\"providerDeclarationGranted\":true",
  "\"resourceReadPerformed\":true",
  "\"dynamicMcpActionPerformed\":true",
  "\"pluginInstallPerformed\":true",
  "\"discoveredToolAutoPromotionAllowed\":true",
  "\"rawExternalPayloadIncluded\":true",
  "\"rawResourceUriIncluded\":true",
  "\"rawSecretIncluded\":true",
]) {
  assert(!serialized.includes(forbidden), `serialized discovery surface leaked ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  declarationId: declaration.declarationId,
  declaredTools: declaration.declaredTools,
  searchDescriptorCount: searchResult.descriptorCount,
  resourceStatus: resourceResult.status,
  templateStatus: templateResult.status,
}));
