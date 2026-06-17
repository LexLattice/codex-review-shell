#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const {
  buildControlledRoutingSlice,
  validateControlledRoutingSlice,
} = require("../src/main/direct/bridge/controlled-routing");
const {
  buildWorkThread,
  DirectWorkThreadRegistryStore,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  DirectLiveTextController,
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
} = require("../src/main/direct/controller/live-text-controller");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectThreadStore,
} = require("../src/main/direct/thread/thread-store");

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

async function waitFor(condition, label) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(label);
}

const nowMs = Date.parse("2026-06-12T19:00:00.000Z");
const projectId = "project_controlled_route";
const profileDoc = {
  profile: {
    ontology: {
      models: [{ id: "gpt-5.4", status: "accepted" }],
    },
  },
};
const project = {
  id: projectId,
  name: "Controlled route fixture",
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
      model: "gpt-5.4",
    },
  },
  workspace: { kind: "wsl" },
};
const workThread = buildWorkThread({
  workThreadId: "work_thread_controlled_route",
  projectId,
  title: "Controlled routing fixture",
  currentObjective: "Route operator request through WorkTargetResolution before direct text turn.",
  activeRuntimePath: "direct-implementation",
  authorityBoundary: {
    summary: "Allow only the existing direct text turn path after routing evidence.",
    forbiddenActions: ["workspace_mutation_before_target_resolution", "tool_execution_before_gate"],
  },
  openObligations: [
    { obligationId: "obl_controlled_route", kind: "routing", status: "open", summary: "Cite route evidence before provider request." },
  ],
}, { nowMs });

const pureRoute = buildControlledRoutingSlice({
  projectId,
  threadId: "thread_controlled_route",
  turnId: "turn_controlled_route",
  requestPreview: "continue controlled routing fixture",
  workThread,
}, { nowMs });
validateControlledRoutingSlice(pureRoute.route);
assert.equal(pureRoute.route.gateState, "ready_for_direct_text_turn");
assert.equal(pureRoute.route.controlledProviderCallAllowed, true);
assert.equal(pureRoute.route.providerCallScope, "existing_direct_text_turn_start_only");
assert.equal(pureRoute.route.workspaceMutationAllowed, false);
assert.equal(pureRoute.route.toolExecutionAllowed, false);
assert.equal(pureRoute.route.selectedAgentClass.agentClassKind, "primary_agent");
assert.equal(pureRoute.semanticBrokerPreflight.recommendationClass, "allow");

const blockedRoute = buildControlledRoutingSlice({
  projectId,
  threadId: "thread_controlled_route",
  turnId: "turn_blocked_route",
  requestPreview: "continue controlled routing fixture",
  workThread,
  semanticBrokerPreflight: {
    ...pureRoute.semanticBrokerPreflight,
    recommendationClass: "route_to_role",
    selectedWorkThreadId: workThread.workThreadId,
    recommendedAgentClass: {
      agentClassId: "implementation_worker",
      agentClassKind: "implementation_worker",
      displayName: "Implementation worker",
      specDigest: "sha256:worker",
      rawTextIncluded: false,
      rawSecretIncluded: false,
    },
  },
}, { nowMs });
validateControlledRoutingSlice(blockedRoute.route);
assert.equal(blockedRoute.route.gateState, "blocked");
assert.equal(blockedRoute.route.controlledProviderCallAllowed, false);
assert(blockedRoute.route.blockerCodes.includes("preflight_route_to_role"));
assert(blockedRoute.route.blockerCodes.includes("non_primary_agent_route_not_enabled"));

const missingPrimaryAgentRoute = buildControlledRoutingSlice({
  projectId,
  threadId: "thread_controlled_route",
  turnId: "turn_missing_primary_agent",
  requestPreview: "continue controlled routing fixture",
  workThread,
  agentClassRegistry: {
    schema: "direct_agent_class_registry@1",
    specs: [],
    registryDigest: "sha256:empty_registry",
  },
}, { nowMs });
validateControlledRoutingSlice(missingPrimaryAgentRoute.route);
assert.equal(missingPrimaryAgentRoute.route.gateState, "blocked");
assert.equal(missingPrimaryAgentRoute.route.controlledProviderCallAllowed, false);
assert(missingPrimaryAgentRoute.route.blockerCodes.includes("missing_primary_agent_spec"));
assert(!missingPrimaryAgentRoute.route.evidenceRefs.some((ref) => ref.rendererSafeLabel === "Agent class spec"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-controlled-route-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions") });
  const directThreadStore = new DirectThreadStore({ rootDir: path.join(tempRoot, "threads") });
  const workThreadStore = new DirectWorkThreadRegistryStore({ rootDir: path.join(tempRoot, "work-threads") });
  workThreadStore.upsertWorkThread(workThread);
  const events = [];
  let providerRequestCount = 0;
  let capturedProviderBody = null;
  const controller = new DirectLiveTextController({
    sessionStore,
    directThreadStore,
    workThreadStore,
    profileDoc,
    authStore: {
      readStatus: () => ({
        status: "authenticated",
        accountId: "acct_controlled_route",
        hasAccessToken: true,
        rawTokensExposed: false,
      }),
      readCredentials: () => ({ accessToken: "controlled_route_access_token_secret_1234567890" }),
    },
    fetchImpl: async (_url, init) => {
      providerRequestCount += 1;
      capturedProviderBody = JSON.parse(init.body);
      return textResponse([
        "event: response.output_text.delta",
        "data: {\"delta\":\"controlled route ok\"}",
        "",
        "event: response.completed",
        "data: {\"response\":{\"id\":\"resp_controlled_route\",\"status\":\"completed\"}}",
        "",
      ].join("\n"), 200, { "content-type": "text/event-stream" });
    },
  });
  const surfaceSession = { sendEvent: (event) => events.push(event) };
  const thread = controller.startThread({ model: "gpt-5.4" }, { project, surfaceSession });
  const ack = await controller.startTurn({
    threadId: thread.thread.id,
    promptText: "continue controlled routing fixture",
    clientTurnRequestId: "client_req_controlled_route_1",
    model: "gpt-5.4",
    requireControlledRouting: true,
    workThread,
  }, { project, surfaceSession });
  assert.equal(ack.turn.status, "inProgress");
  await waitFor(() => sessionStore.readTurn(thread.thread.id, ack.turn.id)?.state === "completed", "controlled routed turn should complete");
  assert.equal(providerRequestCount, 1);
  assert.equal(capturedProviderBody.stream, true);
  assert.equal(capturedProviderBody.store, false);
  assert.equal(capturedProviderBody.tools, undefined);
  const turn = sessionStore.readTurn(thread.thread.id, ack.turn.id);
  assert.equal(turn.controlledRoutingGateState, "ready_for_direct_text_turn");
  assert.match(turn.controlledRoutingSliceId, /^controlled_route_/);
  assert.equal(turn.requestShape.controlledRoutingGateState, "ready_for_direct_text_turn");
  assert.equal(turn.requestShape.controlledRoutingProviderScope, "existing_direct_text_turn_start_only");
  const contextPack = directThreadStore.readContextPack(turn.contextBuildId);
  assert.equal(contextPack.workThreadId, workThread.workThreadId);
  assert.equal(contextPack.governanceRefs.controlledRoutingSliceId, turn.controlledRoutingSliceId);
  assert(contextPack.sourceArtifacts.some((artifact) => artifact.artifactKind === "controlled_routing_slice"));
  const requestManifest = directThreadStore.readRequestManifest(turn.requestManifestId);
  assert.equal(requestManifest.providerInputProjectionGovernanceRefs.controlledRoutingSliceDigest, contextPack.governanceRefs.controlledRoutingSliceDigest);
  assert.equal(requestManifest.workThreadId, workThread.workThreadId);
  assert(events.some((event) => event.method === "turn/completed" && event.params?.turnId === ack.turn.id));
  assert.equal(sessionStore.readSession(thread.thread.id).directTransport, DIRECT_LIVE_TEXT_SURFACE_TRANSPORT);

  const idOnlyThread = controller.startThread({
    model: "gpt-5.4",
    workThreadId: workThread.workThreadId,
  }, { project, surfaceSession });
  const idOnlyAck = await controller.startTurn({
    threadId: idOnlyThread.thread.id,
    promptText: "continue id-only controlled routing fixture",
    clientTurnRequestId: "client_req_controlled_route_id_only",
    model: "gpt-5.4",
    requireControlledRouting: true,
  }, { project, surfaceSession });
  assert.equal(idOnlyAck.turn.status, "inProgress");
  await waitFor(() => sessionStore.readTurn(idOnlyThread.thread.id, idOnlyAck.turn.id)?.state === "completed", "id-only work thread routed turn should complete");
  const idOnlyTurn = sessionStore.readTurn(idOnlyThread.thread.id, idOnlyAck.turn.id);
  assert.equal(idOnlyTurn.controlledRoutingGateState, "ready_for_direct_text_turn");
  assert.match(idOnlyTurn.controlledRoutingSliceId, /^controlled_route_/);
  const idOnlyContextPack = directThreadStore.readContextPack(idOnlyTurn.contextBuildId);
  assert.equal(idOnlyContextPack.workThreadId, workThread.workThreadId);
  assert.equal(providerRequestCount, 2);

  const unsupportedStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "unsupported-sessions") });
  const unsupportedController = new DirectLiveTextController({
    sessionStore: unsupportedStore,
    profileDoc,
    authStore: {
      readStatus: () => ({
        status: "authenticated",
        accountId: "acct_controlled_route",
        hasAccessToken: true,
        rawTokensExposed: false,
      }),
      readCredentials: () => ({ accessToken: "controlled_route_access_token_secret_1234567890" }),
    },
  });
  const unsupportedThread = unsupportedController.startThread({ model: "gpt-5.4" }, { project, surfaceSession: { sendEvent: () => {} } });
  await assert.rejects(
    () => unsupportedController.startTurn({
      threadId: unsupportedThread.thread.id,
      promptText: "continue controlled routing fixture",
      clientTurnRequestId: "client_req_controlled_route_unsupported",
      model: "gpt-5.4",
      requireControlledRouting: true,
      workThread,
    }, { project, surfaceSession: { sendEvent: () => {} } }),
    (error) => error.code === "controlled_routing_unsupported",
  );
  assert.equal(unsupportedStore.readSession(unsupportedThread.thread.id).turns.length, 0, "unsupported required routing must fail before creating a turn");

  const implementationLaneProject = {
    ...project,
    surfaceBinding: {
      codex: {
        ...project.surfaceBinding.codex,
        directTier: "implementation-lane",
      },
    },
  };
  const implementationLaneThread = controller.startThread({ model: "gpt-5.4" }, { project: implementationLaneProject, surfaceSession });
  await assert.rejects(
    () => controller.startTurn({
      threadId: implementationLaneThread.thread.id,
      promptText: "continue controlled routing fixture",
      clientTurnRequestId: "client_req_controlled_route_implementation_lane",
      model: "gpt-5.4",
      requireControlledRouting: true,
      workThread,
    }, { project: implementationLaneProject, surfaceSession }),
    (error) => error.code === "controlled_routing_text_only_required",
  );
  console.log(JSON.stringify({
    ok: true,
    routeId: turn.controlledRoutingSliceId,
    workThreadId: contextPack.workThreadId,
    contextBuildId: turn.contextBuildId,
    requestManifestId: turn.requestManifestId,
    providerRequestCount,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
