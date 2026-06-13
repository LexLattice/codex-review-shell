#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const {
  buildAgentClassRegistry,
} = require("../src/main/direct/bridge/agent-class-spec");
const {
  buildDirectRoleHandoffPacket,
  validateDirectRoleHandoffPacket,
} = require("../src/main/direct/bridge/role-handoff-packet");
const {
  validateDirectWorkerStartResult,
  validateDirectWorkerStartTransition,
} = require("../src/main/direct/bridge/worker-start");
const {
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  DirectLiveTextController,
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
} = require("../src/main/direct/controller/live-text-controller");
const {
  buildSemanticBrokerInputSnapshot,
  buildSemanticBrokerPacket,
  buildSemanticBrokerPreflight,
  buildSemanticBrokerRegistrySnapshot,
  candidateFromRoute,
  sha256,
  validateSemanticBrokerPreflight,
} = require("../src/main/direct/governance/broker");
const {
  buildOperatorBrokerResolution,
} = require("../src/main/direct/governance/operator-broker-resolution");
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

const nowMs = Date.parse("2026-06-13T13:00:00.000Z");
const projectId = "project_worker_start_fixture";
const parentThreadId = "thread_primary_worker_parent";
const project = {
  id: projectId,
  name: "Worker start fixture",
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
const profileDoc = {
  profile: {
    ontology: {
      models: [{ id: "gpt-5.4", status: "accepted" }],
    },
  },
};

const workThread = buildWorkThread({
  projectId,
  workThreadId: "work_thread_worker_start_fixture",
  title: "Explicit worker start fixture",
  currentObjective: "Start one bounded worker from an accepted role handoff.",
  activeRuntimePath: "direct-implementation",
}, { nowMs });
const workTargetResolution = buildWorkTargetResolution({
  projectId,
  userRequest: "send this to an implementation worker",
  activeRuntimePath: "direct-implementation",
}, [workThread], { nowMs });
const workTargetResolutionReport = buildWorkTargetResolutionReport({
  projectId,
  resolution: workTargetResolution,
}, { nowMs });
const operatorBrokerResolution = buildOperatorBrokerResolution({
  projectId,
  userRequest: "send this to an implementation worker",
  workTargetResolutionReport,
  workThreads: [workThread],
}, { nowMs });
const agentRegistry = buildAgentClassRegistry({ projectId, workThreadId: workThread.workThreadId, nowMs });
const implementationWorker = agentRegistry.specs.find((spec) => spec.agentClassKind === "implementation_worker");
assert(implementationWorker, "implementation worker spec must exist");

const semanticRegistry = buildSemanticBrokerRegistrySnapshot({ projectId });
const brokerInput = buildSemanticBrokerInputSnapshot({
  projectId,
  threadId: parentThreadId,
  turnId: "turn_parent_worker_start",
  currentUserIntentRef: {
    kind: "current_user_intent",
    artifactId: "intent_worker_start_fixture",
    artifactDigest: sha256("intent_worker_start_fixture"),
    sourceConfidence: "diagnostic",
    rendererSafeLabel: "Current user intent",
  },
});
const textRoute = semanticRegistry.routes.find((route) => route.routeKind === "text_only");
const brokerPacket = buildSemanticBrokerPacket({
  projectId,
  threadId: parentThreadId,
  turnId: "turn_parent_worker_start",
  registrySnapshot: semanticRegistry,
  inputSnapshot: brokerInput,
  candidates: [
    candidateFromRoute(textRoute, {
      confidence: "high",
      reasonCodes: ["operator_requested_role_worker"],
    }),
  ],
});
const semanticPreflight = buildSemanticBrokerPreflight({
  projectId,
  threadId: parentThreadId,
  turnId: "turn_parent_worker_start",
  semanticBrokerPacket: brokerPacket,
  workTargetResolutionReport,
  agentClassSpec: implementationWorker,
});
validateSemanticBrokerPreflight(semanticPreflight);
assert.equal(semanticPreflight.recommendationClass, "route_to_role");

const handoffPacket = buildDirectRoleHandoffPacket({
  projectId,
  threadId: parentThreadId,
  turnId: "turn_parent_worker_start",
  semanticPreflight,
  operatorBrokerResolution,
  workTargetResolutionReport,
  workThread,
  agentClassSpec: implementationWorker,
}, { nowMs });
validateDirectRoleHandoffPacket(handoffPacket);
assert.equal(handoffPacket.status, "operator_review_required");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-start-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions") });
  const directThreadStore = new DirectThreadStore({ rootDir: path.join(tempRoot, "threads") });
  const events = [];
  let providerRequestCount = 0;
  let capturedProviderPrompt = "";
  const controller = new DirectLiveTextController({
    sessionStore,
    directThreadStore,
    profileDoc,
    authStore: {
      readStatus: () => ({
        status: "authenticated",
        accountId: "acct_worker_start",
        hasAccessToken: true,
        rawTokensExposed: false,
      }),
      readCredentials: () => ({ accessToken: "worker_start_access_token_secret_1234567890" }),
    },
    fetchImpl: async (_url, init) => {
      providerRequestCount += 1;
      const body = JSON.parse(init.body);
      capturedProviderPrompt = body.input?.[0]?.content?.[0]?.text || "";
      return textResponse([
        "event: response.output_text.delta",
        "data: {\"delta\":\"worker finished bounded task\"}",
        "",
        "event: response.completed",
        "data: {\"response\":{\"id\":\"resp_worker_start\",\"status\":\"completed\"}}",
        "",
      ].join("\n"), 200, { "content-type": "text/event-stream" });
    },
  });
  const surfaceSession = { sendEvent: (event) => events.push(event) };
  const response = await controller.handleRequest("worker/start", {
    handoffPacket,
    operatorAcceptance: {
      decision: "accept",
      operatorActionId: "operator_accept_worker_start",
      acceptedAt: "2026-06-13T13:00:01.000Z",
    },
    workerPrompt: "Produce the implementation evidence artifact only.",
    clientTurnRequestId: "client_worker_start_1",
    agentLabel: "Implementation worker",
    model: "gpt-5.4",
    reasoningEffort: "high",
  }, { project, surfaceSession });

  validateDirectWorkerStartTransition(response.transition);
  validateDirectWorkerStartResult(response.result);
  assert.equal(response.transition.startState, "ready_to_start");
  assert.equal(response.transition.providerCallAllowed, true);
  assert.equal(response.transition.providerCallScope, "single_direct_worker_text_turn");
  assert.doesNotThrow(() => validateDirectWorkerStartTransition(response.transition));
  assert.equal(response.transition.recursiveWorkerSpawnAllowed, false);
  assert.equal(response.transition.workspaceMutationAllowed, false);
  assert.equal(response.transition.objectAuditAllowed, false);
  assert.equal(response.result.status, "started");
  assert.equal(response.result.childDialogueFlattenedIntoPrimary, false);
  assert.equal(providerRequestCount, 1);
  assert(capturedProviderPrompt.includes("Produce the implementation evidence artifact only."));
  assert(response.thread.threadId);
  assert.equal(response.thread.agentKind, "direct_worker");
  assert.equal(response.thread.parentThreadId, parentThreadId);
  assert.equal(response.thread.agentRole, "implementation_worker");
  assert.equal(response.thread.transcriptLane, "worker");
  assert.equal(response.thread.primaryTranscriptSeparated, true);
  assert.equal(response.thread.workerStartTransitionId, response.transition.workerStartTransitionId);
  assert.equal(response.thread.workerGraphAlignmentId, response.workerGraphAlignment.alignmentId);
  assert.equal(response.workerGraphAlignment.workerCount, 1);
  assert.equal(response.workerGraphAlignment.nodes[0].agentClassKind, "implementation_worker");
  assert.equal(response.workerGraphAlignment.nodes[0].childDialogueFlattenedIntoPrimary, false);
  assert.equal(response.workerGraphAlignment.providerTransportEnabledInThisPr, false);
  assert(events.some((event) => event.method === "turn/started" && event.params?.threadId === response.thread.threadId));
  await waitFor(() => sessionStore.readTurn(response.thread.threadId, response.turn.id)?.state === "completed", "worker turn should complete");
  const workerSession = sessionStore.readSession(response.thread.threadId);
  assert.equal(workerSession.agentKind, "direct_worker");
  assert.equal(workerSession.roleHandoffPacketId, handoffPacket.handoffPacketId);
  assert.equal(workerSession.workerStartTransitionId, response.transition.workerStartTransitionId);
  assert.equal(workerSession.workerGraphAlignmentId, response.workerGraphAlignment.alignmentId);
  const workerTurn = sessionStore.readTurn(response.thread.threadId, response.turn.id);
  assert.equal(workerTurn.agentKind, "direct_worker");
  assert.equal(workerTurn.parentThreadId, parentThreadId);
  const list = controller.listThreads({ limit: 10 }, { project });
  const deckRow = list.deck.rows.find((row) => row.threadId === response.thread.threadId);
  assert(deckRow, "worker thread must appear in deck");
  assert.equal(deckRow.transcriptLane, "worker");
  assert.equal(deckRow.primaryTranscriptSeparated, true);
  assert.equal(deckRow.agentRole, "implementation_worker");
  assert.equal(deckRow.workerStartTransitionId, response.transition.workerStartTransitionId);
  assert.equal(deckRow.workerGraphAlignmentId, response.workerGraphAlignment.alignmentId);
  assert.equal(list.runtime, DIRECT_LIVE_TEXT_SURFACE_TRANSPORT);

  const retryResponse = await controller.handleRequest("worker/start", {
    handoffPacket,
    operatorAcceptance: {
      decision: "accept",
      operatorActionId: "operator_accept_worker_start",
      acceptedAt: "2026-06-13T13:00:01.000Z",
    },
    workerPrompt: "Produce the implementation evidence artifact only.",
    clientTurnRequestId: "client_worker_start_1",
    agentLabel: "Implementation worker",
    model: "gpt-5.4",
    reasoningEffort: "high",
  }, { project, surfaceSession });
  assert.equal(retryResponse.reused, true);
  assert.equal(retryResponse.thread.threadId, response.thread.threadId);
  assert.equal(retryResponse.turn.id, response.turn.id);
  assert.equal(providerRequestCount, 1, "retried worker start must reuse the existing worker turn");

  await assert.rejects(
    () => controller.handleRequest("worker/start", {
      handoffPacket,
      operatorAcceptance: { decision: "reject", operatorActionId: "operator_reject_worker_start" },
      workerPrompt: "Should not start.",
      clientTurnRequestId: "client_worker_start_rejected",
    }, { project, surfaceSession }),
    (error) => error?.code === "direct_worker_start_blocked" &&
      Array.isArray(error.blockerCodes) &&
      error.blockerCodes.includes("operator_rejected_handoff"),
  );
  assert.equal(providerRequestCount, 1, "blocked worker start must not call provider");

  await assert.rejects(
    () => controller.handleRequest("worker/start", {
      handoffPacket,
      operatorAcceptance: { decision: "accept", operatorActionId: "operator_accept_cross_project" },
      workerPrompt: "Should not cross project.",
      clientTurnRequestId: "client_worker_start_cross_project",
    }, { project: { ...project, id: "different_project" }, surfaceSession }),
    (error) => error?.code === "direct_worker_start_blocked" &&
      Array.isArray(error.blockerCodes) &&
      error.blockerCodes.includes("handoff_project_id_mismatch"),
  );
  assert.equal(providerRequestCount, 1, "cross-project handoff must not call provider");

  const rawSerialized = JSON.stringify({ response, workerSession, workerTurn, list });
  assert(!rawSerialized.includes("rawPromptIncluded\":true"), "worker start must not expose raw prompt flags");
  assert(!rawSerialized.includes("rawPathIncluded\":true"), "worker start must not expose raw path flags");
  assert(!rawSerialized.includes("rawSecretIncluded\":true"), "worker start must not expose raw secret flags");

  console.log(JSON.stringify({
    ok: true,
    workerSessionId: response.thread.threadId,
    workerTurnId: response.turn.id,
    workerStartTransitionId: response.transition.workerStartTransitionId,
    workerGraphAlignmentId: response.workerGraphAlignment.alignmentId,
    providerRequestCount,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
