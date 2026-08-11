#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller.js");
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");

const TOKEN = "fixture-token";

function textResponse(text, status = 200, headers = {}) {
  return new Response(text, { status, headers });
}

function profileDoc() {
  return {
    profile: {
      profileId: "headless-implementation-profile",
      ontology: {
        models: [{
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          status: "accepted",
        }],
        continuationShapes: [{
          id: "continuation.tool_result",
          field: "tool-result continuation",
          status: "accepted",
        }],
      },
    },
  };
}

function implementationProof() {
  return {
    status: "ready",
    evidenceState: "runtime_probed",
    canSelectImplementationLane: true,
    requiredCapabilities: ["read_file", "read_file_loop", "apply_patch", "run_command"].map((capabilityId) => ({
      capabilityId,
      status: "ready",
      evidenceState: "runtime_probed",
      evidenceId: `proof_${capabilityId}`,
      sourceCaseId: `fixture_${capabilityId}`,
      rawProviderPayloadIncluded: false,
      rawToolArgsIncluded: false,
      rawWorkspacePathIncluded: false,
      rawAccountIncluded: false,
    })),
    missingCapabilityIds: [],
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  };
}

function fixtureConfig(rootDir, options = {}) {
  const unsafeAutoApprove = options.unsafeAutoApprove === true || options === true;
  const omitAllowedMethods = options.omitAllowedMethods === true;
  const routeId = unsafeAutoApprove
    ? "route_impl_unsafe"
    : omitAllowedMethods
      ? "route_impl_no_allowed_methods"
      : "route_impl";
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId: "implementation_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: [routeId],
    }],
    workThreads: [{
      workThreadId: "wt_headless_impl",
      status: "active",
      projectId: "project_headless_impl",
    }],
    routes: [{
      routeId,
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_headless_impl",
      targetThreadRef: {
        runtimePath: "direct-implementation",
        threadId: unsafeAutoApprove
          ? "direct_session_headless_impl_unsafe"
          : omitAllowedMethods
            ? "direct_session_headless_impl_no_allowed_methods"
            : "direct_session_headless_impl",
      },
      contextPolicyRef: "direct_implementation_headless_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-implementation-fixture",
      toolAuthorityMode: "read_only",
      headlessImplementationPolicy: {
        autoDecisionMode: "approve",
        disposableWorkspace: unsafeAutoApprove ? false : true,
        ...(omitAllowedMethods ? {} : { allowedMethods: ["direct/tool/readOnly/requestApproval"] }),
        maxAutoDecisions: 1,
      },
    }],
  };
}

function event(idempotencyKey, routeId) {
  return {
    clientId: "implementation_client",
    idempotencyKey,
    eventSchema: "headless_text_event@1",
    eventClass: "operator_message",
    eventKind: "direct_implementation",
    sourceSystem: "fixture",
    requestedRouteId: routeId,
    text: "Use read_file on README.md, then summarize the result.",
  };
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

async function waitForPacket(baseUrl, packetId, predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await requestJson(baseUrl, `/v1/bridge/turn-packets/${encodeURIComponent(packetId)}`);
    assert.equal(result.response.status, 200);
    if (predicate(result.body.packet)) return result.body.packet;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-implementation-runtime-"));
const sessionStore = new DirectSessionStore({ rootDir: path.join(rootDir, "sessions") });
const threadStore = new DirectThreadStore({ rootDir: path.join(rootDir, "thread-store"), mode: "index_only" });
const profile = profileDoc();
const project = {
  id: "project_headless_impl",
  name: "Headless implementation fixture",
  workspace: { kind: "local", localPath: "[REDACTED:disposable-workspace]" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      model: "gpt-5.4",
      profileId: profile.profile.profileId,
    },
  },
};

const initialToolSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_headless_impl_read\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_item.added",
  "data: {\"item\":{\"id\":\"tool_headless_impl_read\",\"type\":\"function_call\",\"call_id\":\"call_headless_impl_read\",\"name\":\"read_file\"}}",
  "",
  "event: response.function_call_arguments.delta",
  "data: {\"item_id\":\"tool_headless_impl_read\",\"call_id\":\"call_headless_impl_read\",\"delta\":\"{\\\"path\\\":\\\"README.md\\\"}\"}",
  "",
  "event: response.output_item.done",
  "data: {\"item\":{\"id\":\"tool_headless_impl_read\",\"type\":\"function_call\",\"call_id\":\"call_headless_impl_read\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_headless_impl_read\",\"status\":\"completed\"}}",
  "",
].join("\n");
const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_headless_impl_done\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_headless_impl_done\",\"delta\":\"README says hello.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_headless_impl_done\",\"status\":\"completed\"}}",
  "",
].join("\n");

let fetchCalls = 0;
let workspaceReads = 0;
const capturedProviderBodies = [];
const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore: threadStore,
  profileDoc: profile,
  authStore: {
    readStatus: () => ({
      status: "authenticated",
      accountId: "fixture-account",
      hasAccessToken: true,
      hasRefreshToken: true,
      storageMode: "memory",
    }),
    readCredentials: () => ({ accessToken: "fixture-access-token", accountId: "fixture-account" }),
  },
  implementationProofEvidenceResolver: () => implementationProof(),
  workspaceRequest: async (_project, method, params) => {
    workspaceReads += 1;
    assert.equal(method, "readFile");
    assert.equal(params.relPath, "README.md");
    return {
      relPath: "README.md",
      size: 11,
      truncated: false,
      binary: false,
      text: "hello world",
      source: "fixture_workspace_backend",
      absolutePath: "/private/disposable/README.md",
    };
  },
  fetchImpl: async (_url, init = {}) => {
    fetchCalls += 1;
    const body = JSON.parse(init.body || "{}");
    capturedProviderBodies.push(body);
    const isContinuation = JSON.stringify(body.input || "").includes("read_file_result");
    if (isContinuation) {
      assert.equal(body.store, false);
      assert.equal(body.parallel_tool_calls, false);
      assert(!("previous_response_id" in body));
      assert(body.input?.[0]?.content?.[0]?.text?.includes("read_file_result"));
    }
    return textResponse(isContinuation ? continuationSse : initialToolSse, 200, { "content-type": "text/event-stream" });
  },
});

const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
const runtime = new DirectHeadlessTextRuntime({
  store: daemon.store,
  controller,
  project,
  implementationSettleTimeoutMs: 3000,
});
daemon.turnRuntime = runtime;
daemon.textRuntime = runtime;

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;
  const submitted = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("impl-turn-1", "route_impl")),
  });
  assert.equal(submitted.response.status, 202);
  assert.equal(submitted.body.ok, true);
  assert.equal(submitted.body.turnPacket.runtimePath, "direct-implementation");
  assert.equal(submitted.body.turnPacket.headlessImplementationPolicy.disposableWorkspace, true);

  const terminal = await waitForPacket(
    baseUrl,
    submitted.body.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "headless implementation completion",
  );
  assert.equal(fetchCalls, 2);
  assert.equal(workspaceReads, 1);
  assert.equal(terminal.providerCompleted, true);
  assert.equal(terminal.headlessImplementationDecisions.length, 1);
  assert.equal(terminal.headlessImplementationDecisions[0].decision, "approve");
  assert.equal(terminal.headlessImplementationDecisions[0].method, "direct/tool/readOnly/requestApproval");

  const persistedTurn = sessionStore.readTurn("direct_session_headless_impl", terminal.turnId);
  assert.equal(persistedTurn.state, "completed");
  const expectedInitialToolNames = [
    "get_context_remaining",
    "inspect_agent",
    "list_agents",
    "read_file",
    "request_user_input",
    "spawn_agent",
    "update_plan",
    "wait_agent",
  ];
  assert.deepEqual(capturedProviderBodies[0].tools.map((tool) => tool.name), expectedInitialToolNames);
  assert.equal(capturedProviderBodies[0].parallel_tool_calls, false);
  assert.equal(capturedProviderBodies[0].tool_choice, "auto");
  assert.equal(persistedTurn.requestShape.declaredToolNames.join(","), expectedInitialToolNames.join(","));
  assert.equal(persistedTurn.requestShape.toolBundleCompositionWitnessAttached, true);
  assert(persistedTurn.requestShape.directToolBundleCompositionId, "missing direct tool bundle composition id");
  assert(persistedTurn.requestShape.providerDeclaredToolBundleDigest, "missing provider tool bundle digest");
  assert(persistedTurn.requestShape.residentCapabilityCatalogueDigest, "missing resident catalogue digest");
  assert(persistedTurn.requestShape.toolBundleCompositionWitnessDigest, "missing composition witness digest");
  assert.equal(persistedTurn.unresolvedObligations[0].status, "continuation_sent");
  assert.equal(JSON.parse(persistedTurn.unresolvedObligations[0].result.providerOutputText).kind, "read_file_result");

  const status = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.turnRuntime.turnPackets.byState.provider_completed, 1);
  assert.equal(status.body.providerRequestsStarted, 0);
  assert.equal(status.body.rawPayloadsExposed, false);

  const unsafeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-implementation-unsafe-"));
  const unsafeDaemon = new DirectHeadlessBridgeDaemon(fixtureConfig(unsafeRoot, { unsafeAutoApprove: true }));
  unsafeDaemon.turnRuntime = new DirectHeadlessTextRuntime({
    store: unsafeDaemon.store,
    controller,
    project,
  });
  unsafeDaemon.textRuntime = unsafeDaemon.turnRuntime;
  try {
    const unsafeAddress = await unsafeDaemon.listen();
    const unsafeBaseUrl = `http://${unsafeAddress.host}:${unsafeAddress.port}`;
    const unsafe = await requestJson(unsafeBaseUrl, "/v1/bridge/events", {
      method: "POST",
      body: JSON.stringify(event("impl-turn-unsafe", "route_impl_unsafe")),
    });
    assert.equal(unsafe.response.status, 202);
    assert.equal(unsafe.body.turnPacket.state, "failed");
    assert.equal(unsafe.body.turnPacket.blockerCode, "headless_implementation_auto_approval_requires_disposable_workspace");
  } finally {
    await unsafeDaemon.close();
    await fs.rm(unsafeRoot, { recursive: true, force: true });
  }

  const omittedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-implementation-omitted-"));
  const omittedDaemon = new DirectHeadlessBridgeDaemon(fixtureConfig(omittedRoot, { omitAllowedMethods: true }));
  omittedDaemon.turnRuntime = new DirectHeadlessTextRuntime({
    store: omittedDaemon.store,
    controller,
    project,
    implementationSettleTimeoutMs: 3000,
  });
  omittedDaemon.textRuntime = omittedDaemon.turnRuntime;
  try {
    const omittedAddress = await omittedDaemon.listen();
    const omittedBaseUrl = `http://${omittedAddress.host}:${omittedAddress.port}`;
    const omitted = await requestJson(omittedBaseUrl, "/v1/bridge/events", {
      method: "POST",
      body: JSON.stringify(event("impl-turn-no-allowed-methods", "route_impl_no_allowed_methods")),
    });
    assert.equal(omitted.response.status, 202);
    const declined = await waitForPacket(
      omittedBaseUrl,
      omitted.body.turnPacket.packetId,
      (packet) => packet.state === "failed",
      "headless implementation decline without explicit methods",
    );
    assert.equal(declined.headlessImplementationDecisions.length, 1);
    assert.equal(declined.headlessImplementationDecisions[0].decision, "decline");
    assert.equal(declined.headlessImplementationDecisions[0].reason, "headless_auto_approval_not_available");
    assert.equal(workspaceReads, 1);
  } finally {
    await omittedDaemon.close();
    await fs.rm(omittedRoot, { recursive: true, force: true });
  }
} finally {
  await daemon.close();
  threadStore.close();
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log("direct-headless-implementation-runtime regression passed");
