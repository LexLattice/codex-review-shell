#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectLiveTextController,
  buildDirectLiveTextCapabilities,
} = require("../src/main/direct/controller/live-text-controller");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { buildDirectProviderMetadataProfile } = require("../src/main/direct/provider/metadata-adapter");
const {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
} = require("../src/main/direct/provider/hosted-tools");
const { buildExternalCapabilityProfile, mcpServerIdentityFor } = require("../src/main/direct/external/external-capability-profile");

const project = {
  id: "project_provider_external_parity",
  name: "Provider/external parity fixture",
  environmentId: "env_provider_fixture",
  workThreadId: "work_thread_provider_fixture",
  workspace: { kind: "local" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
    },
  },
};
const foreignProject = { ...project, id: "project_foreign" };

const sse = [
  "event: response.created",
  'data: {"response":{"id":"response_provider_fixture","model":"gpt-provider-fixture"}}',
  "",
  "event: response.output_text.delta",
  'data: {"item_id":"message_provider_fixture","delta":"Provider attachment accepted."}',
  "",
  "event: response.completed",
  'data: {"response":{"id":"response_provider_fixture","status":"completed"}}',
  "",
].join("\n");

const metadataProfile = buildDirectProviderMetadataProfile({
  projectId: project.id,
  authStatus: { status: "authenticated", planType: "plus" },
  rawModelsResponse: [{
    id: "gpt-provider-fixture",
    isDefault: true,
    inputModalities: ["text", "image", "file"],
    supportedReasoningEfforts: ["medium", "high"],
    serviceTiers: ["fast"],
  }],
  rawRateLimits: {
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 12, resetAt: 1_900_000_000 } },
    },
  },
  rawAccountTokenProfile: { summary: { lifetimeTokens: 42, peakDailyTokens: 12 } },
  tokenUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
  modelSource: "server_model_list",
  generatedAt: "2026-08-30T12:00:00.000Z",
  capabilities: { webSearch: true, imageGeneration: true },
});

const externalProfile = buildExternalCapabilityProfile({
  projectId: project.id,
  workThreadId: "work_thread_provider_fixture",
  serverIdentities: [mcpServerIdentityFor({
    serverIdentityId: "mcp_server_project_fixture",
    displayName: "Fixture MCP server",
    selectorKey: "provider-fixture",
    transportKind: "stdio",
    authPosture: "local_config",
    trustState: "configured",
    enabledState: "enabled",
    freshness: "fresh",
  })],
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-provider-external-parity-"));
const sessionStore = new DirectSessionStore({ rootDir: root });
sessionStore.createSession({
  sessionId: "task_provider_fixture",
  projectId: project.id,
  title: "Provider parity task",
  model: "gpt-provider-fixture",
  reasoningEffort: "medium",
  messages: [],
});

let providerBody = null;
let providerCalls = 0;
let attachmentResolverCalls = 0;
let attachmentResolverMode = "valid";
let externalResolverMode = "valid";
let externalResolverCalls = 0;
const controller = new DirectLiveTextController({
  sessionStore,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-provider-fixture", status: "accepted" }] } } },
  authStore: {
    readStatus: () => ({ status: "authenticated", accountId: "fixture-account", hasAccessToken: true }),
    readCredentials: () => ({ accessToken: "fixture-token" }),
  },
  providerMetadataResolver: ({ project: requestedProject }) => requestedProject.id === project.id
    ? { profile: metadataProfile, cacheState: "fresh" }
    : { profile: { ...metadataProfile, projectId: project.id }, cacheState: "fresh" },
  providerHostedToolsStatusResolver: () => ({
    schema: PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
    activationSnapshot: {
      schema: PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
      projectId: project.id,
      providerProfileDigest: metadataProfile.profileDigest,
      activationReadyTools: [{ toolKind: "web_search", invocationMode: "model_mediated_provider_tool" }],
    },
  }),
  externalCapabilityProfileResolver: () => externalProfile,
  attachmentPayloadResolver: async ({ draftId, projectId, taskId, kind, mimeType }) => {
    attachmentResolverCalls += 1;
    if (attachmentResolverMode === "unavailable") {
      const error = new Error("fixture attachment resolver unavailable");
      error.code = "fixture_attachment_resolver_unavailable";
      throw error;
    }
    const resolved = {
      status: "completed",
      custody: "exact",
      draftId,
      projectId,
      taskId,
      kind,
      mimeType,
      base64: Buffer.from(`synthetic-${draftId}`).toString("base64"),
      modelVisibility: "provider_input",
    };
    if (attachmentResolverMode === "digest-mismatch") resolved.payloadDigest = "not-the-payload-digest";
    return resolved;
  },
  accountLoginResolver: () => ({ ok: true, status: "started", loginId: "fixture-login" }),
  environmentStatusResolver: ({ environmentId }) => ({ environmentId, status: "ready", kind: "local" }),
  externalDiscoveryResolver: async ({ toolName, projectId, workThreadId, threadId }) => {
    externalResolverCalls += 1;
    return {
      projectId,
      workThreadId,
      threadId,
      profileDigest: externalResolverMode === "foreign" ? "foreign-profile-digest" : externalProfile.profileDigest,
      discoveryBackendAvailable: true,
      resourceDescriptors: toolName === "list_mcp_resources" ? [{ uri: "mcp://fixture/resource", name: "Fixture resource" }] : [],
      resourceTemplateDescriptors: [],
    };
  },
  mcpResourceReadResolver: async ({ projectId, workThreadId, threadId }) => ({
    projectId,
    workThreadId,
    threadId,
    profileDigest: externalResolverMode === "foreign" ? "foreign-profile-digest" : externalProfile.profileDigest,
    mimeType: "text/plain",
    payload: "Synthetic MCP evidence, no real secret.",
    readFreshness: "fresh_external_read",
  }),
  activationStatusResolver: () => ({ state: "enabled" }),
  endpoint: "https://chatgpt.fixture/backend-api/codex/responses",
  fetchImpl: async (_url, init) => {
    providerCalls += 1;
    providerBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      text: async () => sse,
    };
  },
});

const status = controller.statusForProject(project);
assert.equal(status.providerMetadataProfile.profileDigest, metadataProfile.profileDigest);
const capabilities = buildDirectLiveTextCapabilities(status);
assert.equal(capabilities.model.canList, true);
assert.equal(capabilities.usage.canReadRateLimits, true);
assert.equal(capabilities.usage.canReadTokenUsage, true);
assert.equal(capabilities.environment.canReadStatus, true);
assert(capabilities.requests.supportedServerMethods.includes("model/list"));
assert(capabilities.requests.supportedServerMethods.includes("web_search"));
assert(!capabilities.requests.supportedServerMethods.includes("mcp_dynamic_tool_call"));
assert(!capabilities.requests.supportedServerMethods.includes("request_plugin_install"));
const unauthenticatedCapabilities = buildDirectLiveTextCapabilities({
  ...status,
  status: "auth_required",
  accountLoginAvailable: true,
});
assert.equal(unauthenticatedCapabilities.account.canStartLogin, true);
assert(unauthenticatedCapabilities.requests.supportedServerMethods.includes("account/login/start"));

const account = await controller.handleRequest("account/read", {}, { project });
assert.equal(account.account.planType, "plus");
assert.equal(account.account.accountId, "fixture-account");
const models = await controller.handleRequest("model/list", { limit: 1 }, { project });
assert.equal(models.data[0].id, "gpt-provider-fixture");
assert.equal(models.nextCursor, null);
assert.equal((await controller.handleRequest("account/rateLimits/read", {}, { project })).status, "available");
assert.equal((await controller.handleRequest("account/usage/read", {}, { project })).tokenUsage.totalTokens, 13);
assert.equal((await controller.handleRequest("configRequirements/read", {}, { project })).requirements, null);
assert.equal((await controller.handleRequest("environment/status", { environmentId: project.environmentId }, { project })).status, "ready");
await assert.rejects(
  controller.handleRequest("account/login/start", {}, { project, ownerControlled: false }),
  (error) => error.code === "direct_account_login_owner_control_required",
);
assert.equal((await controller.handleRequest("account/login/start", {}, { project, ownerControlled: true })).loginId, "fixture-login");

const attachmentDrafts = [
  {
    id: "att_fixture_image",
    status: "ready",
    kind: "image",
    displayName: "fixture.png",
    mimeType: "image/png",
    stagedRelPath: ".codex/review-shell/attachments/att_fixture_image/fixture.png",
    provider: { disposition: "staged_file_reference" },
  },
  {
    id: "att_fixture_file",
    status: "ready",
    kind: "file",
    displayName: "fixture.txt",
    mimeType: "text/plain",
    stagedRelPath: ".codex/review-shell/attachments/att_fixture_file/fixture.txt",
    provider: { disposition: "staged_file_reference" },
  },
];
await controller.startTurn({
  sessionId: "task_provider_fixture",
  clientTurnRequestId: "client_provider_fixture",
  promptText: "Review these provider attachments.",
  attachmentDrafts,
  attachmentDraftSetDigest: "attachment-drafts-fixture-v1",
}, { project, ownerControlled: true });
for (let attempt = 0; attempt < 50; attempt += 1) {
  const turn = sessionStore.readSession("task_provider_fixture")?.turns?.at(-1);
  const stored = turn?.turnId ? sessionStore.readTurn("task_provider_fixture", turn.turnId) : null;
  if (["completed", "failed", "aborted"].includes(stored?.state)) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(attachmentResolverCalls, 2);
assert.equal(providerBody.input[0].content.filter((item) => item.type === "input_image").length, 1);
assert.equal(providerBody.input[0].content.filter((item) => item.type === "input_file").length, 1);
assert.match(providerBody.input[0].content.find((item) => item.type === "input_image").image_url, /^data:image\/png;base64,/);
const persistedTurn = sessionStore.readSession("task_provider_fixture")?.turns?.at(-1);
const persistedAttachmentPacket = persistedTurn?.turnId
  ? sessionStore.readTurn("task_provider_fixture", persistedTurn.turnId)?.directAttachmentSubmitPacket
  : null;
assert(persistedAttachmentPacket?.transcriptWitnesses.every((witness) => witness.providerAccepted === true));

const retryResolverCalls = attachmentResolverCalls;
const retryProviderCalls = providerCalls;
attachmentResolverMode = "unavailable";
const duplicateRetry = await controller.startTurn({
  sessionId: "task_provider_fixture",
  clientTurnRequestId: "client_provider_fixture",
  promptText: "Review these provider attachments.",
  attachmentDrafts,
  attachmentDraftSetDigest: "attachment-drafts-fixture-v1",
}, { project, ownerControlled: true });
assert.equal(duplicateRetry.reused, true, "attachment-bearing retry should reuse the existing turn before payload resolution");
assert.equal(duplicateRetry.turn.id, persistedTurn.turnId);
assert.equal(attachmentResolverCalls, retryResolverCalls, "duplicate retry must not resolve attachment payloads");
assert.equal(providerCalls, retryProviderCalls, "duplicate retry must not call the provider");
await assert.rejects(
  controller.startTurn({
    sessionId: "task_provider_fixture",
    clientTurnRequestId: "client_provider_fixture",
    promptText: "Changed prompt must conflict.",
    attachmentDrafts,
    attachmentDraftSetDigest: "attachment-drafts-fixture-v1",
  }, { project, ownerControlled: true }),
  (error) => error.code === "client_turn_request_id_conflict",
);
await assert.rejects(
  controller.startTurn({
    sessionId: "task_provider_fixture",
    clientTurnRequestId: "client_provider_fixture",
    promptText: "Review these provider attachments.",
    attachmentDrafts,
    attachmentDraftSetDigest: "attachment-drafts-fixture-v2",
  }, { project, ownerControlled: true }),
  (error) => error.code === "client_turn_request_id_conflict",
);
attachmentResolverMode = "valid";

sessionStore.createSession({
  sessionId: "task_provider_attachment_mismatch",
  projectId: project.id,
  title: "Provider attachment mismatch fixture",
  model: "gpt-provider-fixture",
  reasoningEffort: "medium",
  messages: [],
});
attachmentResolverMode = "digest-mismatch";
await assert.rejects(
  controller.startTurn({
    sessionId: "task_provider_attachment_mismatch",
    clientTurnRequestId: "client_provider_attachment_mismatch",
    promptText: "Reject this mismatched attachment payload.",
    attachmentDrafts: [attachmentDrafts[0]],
  }, { project, ownerControlled: true }),
  (error) => error.code === "direct_attachment_payload_digest_mismatch",
);
attachmentResolverMode = "valid";

const searchEnvelope = await controller.buildExternalPromotedEnvelope(
  "task_provider_fixture",
  "turn_external_search",
  { name: "tool_search", callId: "call_search", argumentsText: '{"families":["mcp_resource"]}' },
  project,
);
assert.equal(searchEnvelope.providerOutput.status, "completed");
assert.equal(searchEnvelope.providerOutput.dynamicMcpActionPerformed, false);
const readEnvelope = await controller.buildExternalPromotedEnvelope(
  "task_provider_fixture",
  "turn_external_read",
  { name: "read_mcp_resource", callId: "call_read", argumentsText: '{"serverIdentityId":"mcp_server_project_fixture","resourceUri":"mcp://fixture/resource","mimeType":"text/plain"}' },
  project,
);
assert.equal(readEnvelope.providerOutput.status, "completed");
assert.match(readEnvelope.providerOutput.excerpt, /Synthetic MCP evidence/);
assert.equal(readEnvelope.providerOutput.rawResourcePayloadIncluded, false);
externalResolverMode = "foreign";
const substitutedRead = await controller.buildExternalPromotedEnvelope(
  "task_provider_fixture",
  "turn_external_substituted",
  { name: "read_mcp_resource", callId: "call_substituted", argumentsText: '{"serverIdentityId":"mcp_server_project_fixture","resourceUri":"mcp://fixture/resource"}' },
  project,
);
assert.equal(substitutedRead.status, "blocked");
assert(substitutedRead.blockerCodes.includes("external_backend_scope_mismatch"));
externalResolverMode = "valid";
const callsBeforeDynamic = externalResolverCalls;
const dynamicEnvelope = await controller.buildExternalPromotedEnvelope(
  "task_provider_fixture",
  "turn_external_dynamic",
  { name: "mcp_dynamic_tool_call", callId: "call_dynamic", argumentsText: '{"toolName":"fixture_mutation"}' },
  project,
);
assert.equal(dynamicEnvelope.status, "blocked");
assert(dynamicEnvelope.blockerCodes.includes("external_tool_not_admitted"));
assert.equal(externalResolverCalls, callsBeforeDynamic, "unadvertised external mutation must not reach the adapter");
const foreignRead = await controller.buildExternalPromotedEnvelope(
  "task_provider_fixture",
  "turn_external_foreign",
  { name: "read_mcp_resource", callId: "call_foreign", argumentsText: '{"serverIdentityId":"mcp_server_project_fixture","resourceUri":"mcp://fixture/resource"}' },
  foreignProject,
);
assert.equal(foreignRead.status, "blocked");
assert(foreignRead.blockerCodes.length > 0, "foreign external scope must fail closed");

const staleCapabilities = buildDirectLiveTextCapabilities({
  ...status,
  providerMetadataCacheState: "stale",
});
assert.equal(staleCapabilities.model.canList, false, "stale provider metadata must not advertise model/list");
assert(!staleCapabilities.requests.supportedServerMethods.includes("web_search"));
const unsupportedCapabilities = buildDirectLiveTextCapabilities({
  ...status,
  providerHostedToolsStatus: { activationSnapshot: { activationReadyTools: [] } },
});
assert(!unsupportedCapabilities.requests.supportedServerMethods.includes("image_generation"));

const foreignModels = await controller.handleRequest("model/list", {}, { project: foreignProject });
assert.equal(foreignModels.data.length, 0, "foreign provider metadata must not be projected");

console.log(JSON.stringify({
  ok: true,
  modelCount: models.data.length,
  attachmentResolverCalls,
  providerInputKinds: providerBody.input[0].content.map((item) => item.type),
  externalSearchStatus: searchEnvelope.providerOutput.status,
  externalReadStatus: readEnvelope.providerOutput.status,
  foreignReadBlocker: foreignRead.blockerCodes[0],
}));

await fs.rm(root, { recursive: true, force: true });
