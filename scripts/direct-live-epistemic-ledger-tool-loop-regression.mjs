#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  composeImplementationToolBundleForRequest,
} = require("../src/main/direct/controller/live-text-controller");
const {
  composeDirectToolBundle,
} = require("../src/main/direct/bridge/role-lane-tool-bundle-composer");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectWorldManagerEpistemicFabricRuntime,
} = require("../src/main/direct/worldmanager/epistemic-fabric-runtime");

const ref = (kind, id) => ({ kind, id, digest: `sha256:${id}` });
const projectId = "project_native_ledger";
const workThreadId = "work_thread_native_ledger";
const sessionId = "direct_session_native_ledger";
const turnId = "turn_native_ledger";
const headlessSessionId = "direct_session_native_ledger_headless";
const headlessTurnId = "turn_native_ledger_headless";

function toolEvent(name, args) {
  return {
    type: "tool_call_completed",
    sequence: 1,
    itemId: `tool_${name}`,
    callId: `call_${name}`,
    name,
    toolType: "function_call",
    argumentsJson: JSON.stringify(args),
    responseId: "resp_native_ledger_initial",
  };
}

const continuationSse = [
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_native_ledger_done\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_native_ledger_done\",\"delta\":\"Ledger claim recorded.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_native_ledger_done\",\"status\":\"completed\"}}",
  "",
].join("\n");

const rootDir = await fs.mkdtemp(
  path.join(os.tmpdir(), "direct-native-ledger-tool-loop-"),
);
try {
  const dbPath = path.join(rootDir, "world-manager.sqlite");
  const fabric = new DirectWorldManagerEpistemicFabricRuntime({ dbPath });
  fabric.bootstrap({ projectIds: [projectId] });
  const bundle = fabric.compileRoleTools({
    roleLane: "implementation_worker",
    actorRef: ref("agent_instantiation", "worker_native_ledger"),
    agentWorldRef: ref("compiled_agent_context", "agent_world_native_ledger"),
    authorityBoundaryRef: ref("authority_boundary", "authority_native_ledger"),
    scope: {
      kind: "work_thread",
      userWorldId: "user_world_local",
      projectId,
      workThreadId,
    },
    allowedRights: ["observe", "propose", "challenge"],
    disabledOperations: [
      "ledger_submit_candidate_artifact",
      "ledger_ack_delivery",
      "ledger_import_delivery_context",
      "ledger_create_watch",
      "ledger_revise_watch",
      "ledger_remove_watch",
    ],
    canonicalAdmissionEnabled: false,
  });

  const nativeComposition = composeImplementationToolBundleForRequest({
    projectId,
    workThreadId,
    sessionId,
    turnId,
    toolNames: ["read_file"],
    useLaneDefaultTools: false,
    sourceMessageId: "source_native_ledger",
    normalizedLaneRequestId: "lane_request_native_ledger",
    roleLedgerToolBundle: bundle,
  });
  assert.equal(
    nativeComposition.toolNames.includes(
      "ledger_propose_claim",
    ),
    true,
  );
  assert.equal(
    nativeComposition.toolNames.includes(
      "ledger_admit_canonical",
    ),
    false,
  );
  assert.equal(
    nativeComposition.composition.roleLedgerToolBundleRef.digest,
    bundle.digest,
  );
  assert.equal(
    nativeComposition.composition.providerDeclaredToolBundle.declaredToolNames
      .some((name) => name.startsWith("ledger_")),
    false,
    "the generic provider bundle must retain its independent identity",
  );

  const staticComposition = composeDirectToolBundle({
    projectId,
    workThreadId,
    threadId: sessionId,
    laneKind: "implementation_worker",
    toolNames: ["read_file"],
    useLaneDefaultTools: false,
    sourceMessageRef: ref("source_message", "source_static"),
    normalizedLaneRequestRef: ref(
      "normalized_lane_request",
      "lane_request_static",
    ),
  });
  assert.equal(
    staticComposition.providerDeclaredToolBundle.declaredToolNames.some((name) =>
      name.startsWith("ledger_")),
    false,
    "ledger operations must never leak into static lane defaults",
  );

  const sessionStore = new DirectSessionStore({
    rootDir: path.join(rootDir, "sessions"),
  });
  sessionStore.createSession({
    sessionId,
    projectId,
    title: "Native ledger fixture",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messages: [{
      id: turnId,
      status: "tool_waiting",
      items: [{ id: `${turnId}_user`, type: "userMessage", text: "Record the claim." }],
    }],
  });
  sessionStore.createTurn(sessionId, {
    turnId,
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "Record the claim." }],
    responseId: "resp_native_ledger_initial",
  });
  sessionStore.updateTurnState(sessionId, turnId, "tool_waiting", {
    epistemicLedgerToolBinding: {
      bundle,
      visibleEvidenceRefs: [],
      currentRevisionByScope: {},
    },
  });

  const providerBodies = [];
  const controller = new DirectLiveTextController({
    sessionStore,
    profileDoc: {
      profile: { ontology: { models: [{ id: "gpt-5.4", status: "accepted" }] } },
    },
    authStore: {
      readStatus: () => ({
        status: "authenticated",
        hasAccessToken: true,
        hasRefreshToken: false,
      }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      providerBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => continuationSse,
      };
    },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.4" }),
    epistemicLedgerToolInvoker: (input) => fabric.invokeLedgerTool(input),
  });
  const project = { id: projectId, name: "Native ledger fixture" };
  const surface = new DirectLiveTextSurfaceSession(
    { send: () => {}, isDestroyed: () => false },
    { controller, project },
  );
  await surface.connect({});

  const obligations = sessionStore.addToolObligations(
    sessionId,
    turnId,
    [toolEvent("ledger_propose_claim", {
      subjectScope: {
        kind: "work_thread",
        userWorldId: "user_world_local",
        projectId,
        workThreadId,
      },
      objectRefs: [],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: { claim: "The native worker can publish typed reason-state." },
      rendererSafeSummary: "Native worker proposed a typed claim.",
      idempotencyKey: "native-worker-claim-1",
    })],
  ).obligations;
  const handled = await controller.emitToolApprovalRequests(
    surface,
    sessionId,
    turnId,
    obligations,
    project,
  );
  assert.equal(handled, 1);
  assert.equal(surface.hasServerRequest(), false);
  assert.equal(providerBodies.length, 1);
  assert.equal(
    providerBodies[0].tools.some((tool) => tool.name === "ledger_submit_closure"),
    true,
    "ledger tools must survive into the provider continuation",
  );
  assert.equal(
    providerBodies[0].tools.some((tool) => tool.name === "ledger_admit_canonical"),
    false,
  );
  assert.match(JSON.stringify(providerBodies[0]), /epistemic_ledger_result/);

  const completedTurn = sessionStore.readTurn(sessionId, turnId);
  assert.equal(completedTurn.state, "completed");
  assert.equal(
    completedTurn.unresolvedObligations[0].result.schema,
    "direct_epistemic_ledger_tool_result@1",
  );
  assert.equal(
    completedTurn.unresolvedObligations[0].result.semanticEffectRecorded,
    true,
  );
  assert.equal(
    completedTurn.unresolvedObligations[0].result.canonicalEffect,
    false,
  );
  assert.equal(fabric.ledgerStore.listEvents({ limit: 100 }).some((event) =>
    event.actTypeRef.id === "ledger_propose_claim@1"), true);

  sessionStore.createSession({
    sessionId: headlessSessionId,
    projectId,
    title: "Headless native ledger fixture",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messages: [{
      id: headlessTurnId,
      status: "tool_waiting",
      items: [{
        id: `${headlessTurnId}_user`,
        type: "userMessage",
        text: "Record the headless observation.",
      }],
    }],
  });
  sessionStore.createTurn(headlessSessionId, {
    turnId: headlessTurnId,
    state: "tool_waiting",
    model: "gpt-5.4",
    input: [{ role: "user", text: "Record the headless observation." }],
    responseId: "resp_native_ledger_headless_initial",
  });
  sessionStore.updateTurnState(
    headlessSessionId,
    headlessTurnId,
    "tool_waiting",
    {
      epistemicLedgerToolBinding: {
        bundle,
        visibleEvidenceRefs: [],
        currentRevisionByScope: {},
      },
    },
  );
  const headlessObligations = sessionStore.addToolObligations(
    headlessSessionId,
    headlessTurnId,
    [toolEvent("ledger_publish_observation", {
      subjectScope: {
        kind: "work_thread",
        userWorldId: "user_world_local",
        projectId,
        workThreadId,
      },
      objectRefs: [],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: {
        observation: "The native ledger loop executes without a renderer surface.",
      },
      rendererSafeSummary: "Headless native worker recorded an observation.",
      idempotencyKey: "native-worker-headless-observation-1",
    })],
  ).obligations;
  const headlessHandled = await controller.emitToolApprovalRequests(
    null,
    headlessSessionId,
    headlessTurnId,
    headlessObligations,
    project,
  );
  assert.equal(headlessHandled, 1);
  assert.equal(
    sessionStore.readTurn(headlessSessionId, headlessTurnId).state,
    "completed",
  );
  assert.equal(providerBodies.length, 2);

  console.log(JSON.stringify({
    schema: "direct_live_epistemic_ledger_tool_loop_regression@1",
    status: "passed",
    workerLedgerOperationCount: bundle.operationNames.length,
    autoExecuted: true,
    headlessAutoExecuted: true,
    operatorApprovalRequested: surface.serverRequests.size > 0,
    continuationLedgerDeclarationsPreserved: true,
    canonicalEffect: false,
  }, null, 2));
  fabric.close();
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}
