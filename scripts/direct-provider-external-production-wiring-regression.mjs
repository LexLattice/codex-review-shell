#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const {
  buildExternalCapabilityProfile,
  mcpServerIdentityFor,
} = require("../src/main/direct/external/external-capability-profile");
const {
  createDirectConfiguredMcpResolvers,
  normalizeConfiguredMcpServer,
} = require("../src/main/direct/external/configured-mcp-adapter");

const mainSource = await fs.readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(mainSource, /externalDiscoveryResolver:\s*\(context\)\s*=>\s*ensureDirectConfiguredMcpResolvers\(\)\.externalDiscoveryResolver\(context\)/);
assert.match(mainSource, /mcpResourceReadResolver:\s*\(context\)\s*=>\s*ensureDirectConfiguredMcpResolvers\(\)\.mcpResourceReadResolver\(context\)/);

const projectId = "project_provider_external_production_fixture";
const workThreadId = "work_thread_provider_external_production_fixture";
const serverIdentityId = "mcp_server_project_fixture";
const resourceUri = "mcp://fixture/alpha";
const splitFrameResourceUri = "mcp://fixture/split-frame";
const environmentResourceUri = "mcp://fixture/environment";
const ownerResourceUri = "mcp://fixture/owner-required";
const launderingResourceUri = "mcp://fixture/launder";
const mixedResourceUri = "mcp://fixture/mixed";
const reapedResourceUri = "mcp://fixture/reaped";
const allowedEnvironmentKey = "DIRECT_MCP_ALLOWED_FIXTURE";
const forbiddenEnvironmentKey = "DIRECT_MCP_FORBIDDEN_FIXTURE";
const previousAllowedEnvironment = process.env[allowedEnvironmentKey];
const previousForbiddenEnvironment = process.env[forbiddenEnvironmentKey];
process.env[allowedEnvironmentKey] = "allowlisted-value";
process.env[forbiddenEnvironmentKey] = "must-not-cross-boundary";

const fixtureServerCode = [
  "const readline=require('node:readline');",
  "const rl=readline.createInterface({input:process.stdin});",
  "rl.on('line',line=>{",
  "const q=JSON.parse(line);",
  "if(q.id===undefined||q.id===null)return;",
  `if(q.method==='resources/read'&&q.params?.uri==='${ownerResourceUri}') { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:99,method:'elicitation/create',params:{message:'Owner approval required'}})+'\\n'); return; }`,
  `const result=q.method==='initialize'?{}:q.method==='resources/list'?{resources:[{uri:'${resourceUri}',name:'Alpha resource'},{uri:'${environmentResourceUri}',name:'Environment boundary'},{uri:'${launderingResourceUri}',name:'Launder fixture'}]}:q.method==='resources/templates/list'?{resourceTemplates:[{uriTemplate:'mcp://fixture/{id}',name:'Fixture template'}]}:q.method==='tools/list'?{tools:[{name:'read_only_status',description:'Read-only status',inputSchema:{type:'object'}}]}:q.method==='resources/read'&&q.params?.uri==='${launderingResourceUri}'?{contents:[{type:'text',uri:'mcp://foreign/resource',text:'laundered payload',mimeType:'text/plain'}]}:q.method==='resources/read'&&q.params?.uri==='${mixedResourceUri}'?{contents:[{type:'text',uri:'${mixedResourceUri}',text:'safe first content',mimeType:'text/plain'},{type:'text',uri:'mcp://foreign/resource',text:'foreign later content',mimeType:'text/plain'}]}:q.method==='resources/read'&&q.params?.uri==='${environmentResourceUri}'?{contents:[{type:'text',uri:'${environmentResourceUri}',text:JSON.stringify({allowed:process.env.${allowedEnvironmentKey}||'',forbidden:process.env.${forbiddenEnvironmentKey}||''}),mimeType:'application/json'}]}:q.method==='resources/read'&&q.params?.uri==='${splitFrameResourceUri}'?{contents:[{type:'text',uri:'${splitFrameResourceUri}',text:'Synthetic split Content-Length evidence.',mimeType:'text/plain'}]}:q.method==='resources/read'&&q.params?.uri==='${reapedResourceUri}'?{contents:[{type:'text',uri:'${reapedResourceUri}',text:'fixture-child-pid:'+process.pid,mimeType:'text/plain'}]}:q.method==='resources/read'?{contents:[{type:'text',uri:'${resourceUri}',text:'Synthetic configured MCP evidence.',mimeType:'text/plain'}]}:{};`,
  `const reaped=q.method==='resources/read'&&q.params?.uri==='${reapedResourceUri}'; if(reaped) { process.on('SIGTERM',()=>{}); setInterval(()=>{},10000); }`,
  "const payload=JSON.stringify({jsonrpc:'2.0',id:q.id,result});",
  `if(q.method==='resources/read'&&q.params?.uri==='${splitFrameResourceUri}') { process.stdout.write('Content-Length: '+Buffer.byteLength(payload)+'\\r\\n'); setTimeout(()=>process.stdout.write('\\r\\n'+payload), 30); } else process.stdout.write(payload+'\\n');`,
  "});",
].join("");

const configuredServer = normalizeConfiguredMcpServer({
  serverIdentityId,
  displayName: "Production fixture MCP server",
  transport: "stdio",
  command: process.execPath,
  args: ["-e", fixtureServerCode],
  projectId,
  workThreadId,
  trustState: "configured",
  enabledState: "enabled",
  freshness: "fresh",
  authPosture: "local_config",
  processEnv: [allowedEnvironmentKey],
});
assert(configuredServer, "configured MCP server should normalize");

const project = {
  id: projectId,
  name: "Production configured MCP fixture",
  workThreadId,
  workspace: { kind: "local" },
  mcpServers: [configuredServer],
};
const profile = buildExternalCapabilityProfile({
  projectId,
  workThreadId,
  serverIdentities: [mcpServerIdentityFor({
    serverIdentityId,
    displayName: configuredServer.displayName,
    selectorKey: configuredServer.selectorKey,
    transportKind: configuredServer.transportKind,
    authPosture: configuredServer.authPosture,
    trustState: configuredServer.trustState,
    enabledState: configuredServer.enabledState,
    freshness: configuredServer.freshness,
  })],
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-provider-external-production-wiring-"));
const sessionStore = new DirectSessionStore({ rootDir: root });
sessionStore.createSession({
  sessionId: "task_provider_external_production_fixture",
  projectId,
  model: "gpt-5.4",
  messages: [],
});

const productionResolvers = createDirectConfiguredMcpResolvers();
let discoveryCalls = 0;
let readCalls = 0;
const controller = new DirectLiveTextController({
  sessionStore,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } } },
  authStore: {
    readStatus: () => ({ status: "authenticated", hasAccessToken: true }),
    readCredentials: () => ({ accessToken: "fixture-token" }),
  },
  activationStatusResolver: () => ({ state: "enabled" }),
  externalCapabilityProfileResolver: () => profile,
  externalDiscoveryResolver: (input) => {
    discoveryCalls += 1;
    return productionResolvers.externalDiscoveryResolver(input);
  },
  mcpResourceReadResolver: (input) => {
    readCalls += 1;
    return productionResolvers.mcpResourceReadResolver(input);
  },
});

async function envelope(name, argumentsObject = {}, turnId = name) {
  return controller.buildExternalPromotedEnvelope(
    "task_provider_external_production_fixture",
    turnId,
    { name, callId: `call_${turnId}`, argumentsText: JSON.stringify(argumentsObject) },
    project,
  );
}

try {
  const status = controller.statusForProject(project);
  assert.deepEqual(status.externalDiscovery.tools, ["tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);

  const search = await envelope("tool_search", { families: ["mcp_resource", "mcp_tool"], maxResults: 10 }, "search");
  assert.equal(search.providerOutput.status, "completed");
  assert(search.providerOutput.descriptorCount >= 3);

  const resources = await envelope("list_mcp_resources", { serverIdentityId }, "resources");
  assert.equal(resources.providerOutput.status, "completed");
  assert.equal(resources.providerOutput.descriptorCount, 3);

  const templates = await envelope("list_mcp_resource_templates", { serverIdentityId }, "templates");
  assert.equal(templates.providerOutput.status, "completed");
  assert.equal(templates.providerOutput.descriptorCount, 1);

  const read = await envelope("read_mcp_resource", { serverIdentityId, resourceUri }, "read");
  assert.equal(read.providerOutput.status, "completed");
  assert.match(read.providerOutput.excerpt, /Synthetic configured MCP evidence/);
  assert.equal(read.providerOutput.rawResourcePayloadIncluded, false);

  const splitFrameRead = await envelope("read_mcp_resource", {
    serverIdentityId,
    resourceUri: splitFrameResourceUri,
  }, "split-frame");
  assert.equal(splitFrameRead.providerOutput.status, "completed");
  assert.match(splitFrameRead.providerOutput.excerpt, /Synthetic split Content-Length evidence/);

  const environmentRead = await envelope("read_mcp_resource", {
    serverIdentityId,
    resourceUri: environmentResourceUri,
  }, "environment");
  assert.equal(environmentRead.providerOutput.status, "completed");
  assert.match(environmentRead.providerOutput.excerpt, /allowlisted-value/);
  assert.doesNotMatch(environmentRead.providerOutput.excerpt, /must-not-cross-boundary/);

  const laundered = await envelope("read_mcp_resource", { serverIdentityId, resourceUri: launderingResourceUri }, "laundered");
  assert.equal(laundered.status, "blocked");
  assert(laundered.blockerCodes.includes("direct_mcp_resource_result_scope_mismatch"));

  const mixed = await envelope("read_mcp_resource", { serverIdentityId, resourceUri: mixedResourceUri }, "mixed");
  assert.equal(mixed.status, "blocked");
  assert(mixed.blockerCodes.includes("direct_mcp_resource_result_scope_mismatch"));
  assert.doesNotMatch(JSON.stringify(mixed), /foreign later content/);

  const ownerRequired = await envelope("read_mcp_resource", { serverIdentityId, resourceUri: ownerResourceUri }, "owner-required");
  assert.equal(ownerRequired.status, "blocked");
  assert(ownerRequired.blockerCodes.includes("mcp_elicitation_owner_required"));

  const reapingStartedAt = Date.now();
  const reaped = await envelope("read_mcp_resource", { serverIdentityId, resourceUri: reapedResourceUri }, "reaped");
  const reapingElapsedMs = Date.now() - reapingStartedAt;
  assert.equal(reaped.providerOutput.status, "completed");
  const childPid = Number(reaped.providerOutput.excerpt.match(/fixture-child-pid:(\d+)/)?.[1]);
  assert(Number.isInteger(childPid) && childPid > 0, "the reaping fixture must expose its child pid only in bounded test output");
  assert.match(reaped.providerOutput.excerpt, new RegExp(`fixture-child-pid:${childPid}`));
  assert.ok(reapingElapsedMs >= 150 && reapingElapsedMs < 2_000, `MCP completion must await bounded SIGKILL cleanup: ${reapingElapsedMs}ms`);
  assert.throws(() => process.kill(childPid, 0), (error) => error?.code === "ESRCH", "the MCP child must be reaped before request completion");

  const callsBeforeDynamic = discoveryCalls + readCalls;
  const dynamic = await envelope("mcp_dynamic_tool_call", { serverIdentityId, toolName: "read_only_status" }, "dynamic");
  assert.equal(dynamic.status, "blocked");
  assert(dynamic.blockerCodes.includes("external_tool_not_admitted"));
  assert.equal(discoveryCalls + readCalls, callsBeforeDynamic);

  const staleProject = {
    ...project,
    mcpServers: [{ ...configuredServer, freshness: "stale" }],
  };
  const staleProfile = buildExternalCapabilityProfile({
    projectId,
    workThreadId,
    serverIdentities: [
      mcpServerIdentityFor({ serverIdentityId, transportKind: "stdio", authPosture: "local_config", trustState: "configured", enabledState: "enabled", freshness: "stale" }),
      mcpServerIdentityFor({ serverIdentityId: "mcp_server_current_neighbor", transportKind: "stdio", authPosture: "local_config", trustState: "configured", enabledState: "enabled", freshness: "fresh" }),
    ],
  });
  const staleController = new DirectLiveTextController({
    sessionStore,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } } },
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }) },
    activationStatusResolver: () => ({ state: "enabled" }),
    externalCapabilityProfileResolver: () => staleProfile,
    ...productionResolvers,
  });
  const staleEnvelope = await staleController.buildExternalPromotedEnvelope(
    "task_provider_external_production_fixture",
    "stale",
    { name: "list_mcp_resources", callId: "call_stale", argumentsText: JSON.stringify({ serverIdentityId }) },
    staleProject,
  );
  assert.equal(staleEnvelope.status, "blocked");
  assert(staleEnvelope.blockerCodes.some((code) => code.startsWith("mcp_server_not_selectable:")));

  const unsupportedProject = {
    ...project,
    mcpServers: [{ ...configuredServer, transportKind: "http", command: "" }],
  };
  const unsupportedController = new DirectLiveTextController({
    sessionStore,
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } } },
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }) },
    activationStatusResolver: () => ({ state: "enabled" }),
    externalCapabilityProfileResolver: () => profile,
    ...productionResolvers,
  });
  const unsupportedEnvelope = await unsupportedController.buildExternalPromotedEnvelope(
    "task_provider_external_production_fixture",
    "unsupported",
    { name: "list_mcp_resources", callId: "call_unsupported", argumentsText: JSON.stringify({ serverIdentityId }) },
    unsupportedProject,
  );
  assert.equal(unsupportedEnvelope.status, "blocked");
  assert(unsupportedEnvelope.blockerCodes.includes("direct_mcp_transport_unsupported"));

  const foreignProject = { ...project, id: "project_foreign_mcp_source" };
  const foreignEnvelope = await controller.buildExternalPromotedEnvelope(
    "task_provider_external_production_fixture",
    "foreign",
    { name: "list_mcp_resources", callId: "call_foreign", argumentsText: JSON.stringify({ serverIdentityId }) },
    foreignProject,
  );
  assert.equal(foreignEnvelope.status, "blocked");
  assert(foreignEnvelope.blockerCodes.length > 0);

  console.log(JSON.stringify({
    ok: true,
    discoveryCalls,
    readCalls,
    searchDescriptors: search.providerOutput.descriptorCount,
    readStatus: read.providerOutput.status,
    dynamicStatus: dynamic.status,
    ownerRequiredBlocker: ownerRequired.blockerCodes[0],
  }));
} finally {
  if (previousAllowedEnvironment === undefined) delete process.env[allowedEnvironmentKey];
  else process.env[allowedEnvironmentKey] = previousAllowedEnvironment;
  if (previousForbiddenEnvironment === undefined) delete process.env[forbiddenEnvironmentKey];
  else process.env[forbiddenEnvironmentKey] = previousForbiddenEnvironment;
  await fs.rm(root, { recursive: true, force: true });
}
