#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectThreadStore,
} = require("../src/main/direct/thread/thread-store");
const {
  DirectRoleRuntime,
} = require("../src/main/direct/worldmanager/role-runtime");
const {
  DirectWorldManagerEpistemicFabricRuntime,
} = require("../src/main/direct/worldmanager/epistemic-fabric-runtime");
const {
  buildNotificationStanding,
} = require("../src/main/direct/worldmanager/ledger-subscription-broker");
const {
  digestFor,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-runtime-dispatch-"),
);
const dbPath = path.join(rootDir, "world-manager.sqlite");
const sessionStore = new DirectSessionStore({
  rootDir: path.join(rootDir, "sessions"),
});
const directThreadStore = new DirectThreadStore({
  rootDir: path.join(rootDir, "threads"),
});
const projectId = "project_runtime_dispatch_fixture";
const workThreadId = "workthread_runtime_dispatch_fixture";
let tick = Date.parse("2026-08-01T18:00:00.000Z");
const now = () => (tick += 10);

function exactRef(kind, id) {
  return {
    kind,
    id,
    digest: digestFor(`fixture_${kind}@1`, { id, projectId }),
    projectId,
  };
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

const project = {
  id: projectId,
  name: "Runtime dispatch fixture",
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
let roleRuntime = null;
let fabric = null;
let providerRequestCount = 0;
const providerPrompts = [];
const providerToolNames = [];
const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore,
  profileDoc,
  compiledAgentContextResolver: (input) =>
    roleRuntime?.resolveCompiledAgentContext(input) || null,
  epistemicLedgerToolBundleResolver: (input = {}) => {
    if (!fabric || !input.compiledAgentContext) return null;
    const roleLane = input.roleLane || "implementation_worker";
    const compiled = input.compiledAgentContext;
    return {
      bundle: fabric.compileRoleTools({
        roleLane,
        projectId,
        actorRef: compiled.agentInstantiationRef,
        agentWorldRef: {
          kind: "compiled_agent_context",
          id: compiled.compiledAgentContextId,
          digest: compiled.digest,
        },
        authorityBoundaryRef: exactRef(
          "authority_boundary",
          `${roleLane}_runtime_dispatch_boundary`,
        ),
        scope: {
          kind: "work_thread",
          userWorldId: "user_world_local",
          projectId,
          workThreadId: input.workThreadId,
        },
        allowedRights: roleLane === "review_auditor"
          ? ["observe", "propose", "challenge", "assess"]
          : ["observe", "propose", "challenge"],
        disabledOperations: [
          "ledger_submit_candidate_artifact",
          "ledger_ack_delivery",
          "ledger_import_delivery_context",
          "ledger_create_watch",
          "ledger_revise_watch",
          "ledger_remove_watch",
        ],
      }),
      visibleEvidenceRefs: [
        compiled.agentInstantiationRef,
        compiled.manifestRef,
        compiled.taskConstitutionRef,
        compiled.projectionAgreementRef,
      ],
      currentRevisionByScope: {},
    };
  },
  epistemicLedgerToolInvoker: async (input) => ({
    result: fabric.invokeLedgerTool(input),
    projection: null,
  }),
  authStore: {
    readStatus: () => ({
      status: "authenticated",
      accountId: "acct_runtime_dispatch_fixture",
      hasAccessToken: true,
      rawTokensExposed: false,
    }),
    readCredentials: () => ({
      accessToken: "runtime_dispatch_fixture_access_token_secret_123456",
    }),
  },
  fetchImpl: async (_url, init) => {
    providerRequestCount += 1;
    const body = JSON.parse(init.body);
    providerPrompts.push(
      body.input?.[0]?.content?.[0]?.text || "",
    );
    providerToolNames.push((body.tools || []).map((tool) =>
      tool.name || tool.function?.name || ""));
    const responseId = `resp_runtime_dispatch_${providerRequestCount}`;
    return textResponse([
      "event: response.output_text.delta",
      `data: {"delta":"bounded role result ${providerRequestCount}"}`,
      "",
      "event: response.completed",
      `data: {"response":{"id":"${responseId}","status":"completed"}}`,
      "",
    ].join("\n"), 200, { "content-type": "text/event-stream" });
  },
});
const originalControllerStartThread = controller.startThread.bind(controller);
controller.startThread = (params = {}, context = {}) => originalControllerStartThread({
  ...params,
  reasoningEffort: params.reasoningEffort || "medium",
}, context);
roleRuntime = new DirectRoleRuntime({
  controller,
  sessionStore,
  resolveProject: async (candidateProjectId) =>
    candidateProjectId === projectId ? project : null,
  now,
});

const projectManagerAgentRef = exactRef(
  "agent_instantiation",
  "project_manager_runtime_dispatch_fixture",
);
roleRuntime.rememberResident({
  projectId,
  roleKind: "project_manager",
  managerAgentId: projectManagerAgentRef.id,
  agentInstantiationRef: projectManagerAgentRef,
  compiledAgentContextRef: null,
  directSessionId: "",
  activeAgentRunRef: null,
  runPosture: "idle_role_resident",
  lastRunState: "completed",
});

function makeFabric({ dbPath: fabricDbPath = dbPath, scheduler = undefined } = {}) {
  return new DirectWorldManagerEpistemicFabricRuntime({
    dbPath: fabricDbPath,
    now,
    ...(scheduler ? { scheduler } : {}),
    nativeContextImporterEnabled: true,
    recipientResolver: (input) =>
      roleRuntime.resolveLedgerRecipient(input),
    deliveryTargetResolver: (input) =>
      roleRuntime.resolveLedgerDeliveryTarget(input),
    deliveryDispatchAdapter: (input) =>
      roleRuntime.dispatchLedgerDelivery(input),
    artifactWorkThreadDispatchAdapter: (input) =>
      roleRuntime.dispatchArtifactWorkThread(input),
  });
}

const inertScheduler = {
  schedule: () => ({ inert: true }),
  cancel: () => {},
};
fabric = makeFabric({ scheduler: inertScheduler });
fabric.bootstrap({ projectIds: [projectId] });
const standing = fabric.ensureProjectStanding(projectId);
fabric.broker.registerStanding(buildNotificationStanding({
  ...standing,
  operationalPolicy: {
    ...standing.operationalPolicy,
    priorityThreshold: "normal",
  },
  revision: standing.revision + 1,
}, { now }));
fabric.persistBroker();
roleRuntime.setResidentIdleCallback(() =>
  fabric.dispatchQueuedDeliveries());

const workerBundle = fabric.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: exactRef("agent", "implementation_worker_ledger_fixture"),
  agentWorldRef: exactRef("agent_world", "implementation_worker_world_fixture"),
  authorityBoundaryRef: exactRef("authority_boundary", "project_boundary_fixture"),
});

function appendBlocker(runtime = fabric, bundle = workerBundle, idempotencyKey, suffix) {
  return runtime.invokeLedgerTool({
    bundle,
    operationName: "ledger_raise_blocker",
    arguments: {
      subjectScope: {
        kind: "project",
        userWorldId: "user_world_local",
        projectId,
      },
      objectRefs: [exactRef("project_obligation", `obligation_${suffix}`)],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: {
        blocker: `Material blocker ${suffix}`,
      },
      rendererSafeSummary: `Material blocker ${suffix} requires Project Manager attention.`,
      idempotencyKey,
    },
    visibleEvidenceRefs: [],
  });
}

function appendProposal(runtime, bundle, idempotencyKey, suffix) {
  return runtime.invokeLedgerTool({
    bundle,
    operationName: "ledger_propose_claim",
    arguments: {
      subjectScope: {
        kind: "project",
        userWorldId: "user_world_local",
        projectId,
      },
      objectRefs: [exactRef("project_observation", `observation_${suffix}`)],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: { claim: `Routine proposal ${suffix}` },
      rendererSafeSummary: `Routine proposal ${suffix}.`,
      idempotencyKey,
    },
    visibleEvidenceRefs: [],
  });
}

appendBlocker(fabric, workerBundle, "runtime-dispatch-blocker-1", "one");
fabric.flushPendingOutbox();
const firstDrain = await fabric.dispatchQueuedDeliveries();
assert.equal(firstDrain.delivered, 1);
assert.equal(providerRequestCount, 1);
assert.equal(fabric.artifactState.contextDispatchReceipts.length, 1);
assert.equal(
  fabric.artifactState.contextDispatchReceipts[0].accepted,
  true,
);
assert.equal(
  fabric.artifactState.contextDispatchReceipts[0].canonicalEffect,
  false,
);
const replayDrain = await fabric.dispatchQueuedDeliveries();
assert.equal(replayDrain.attempted, 0);
assert.equal(providerRequestCount, 1);
if (fabric.deliveryDrainPromise) await fabric.deliveryDrainPromise;

// A delivery arriving while the first context import is in flight must be
// picked up by the same drain when that import completes.
const originalDeliveryDispatchAdapter = fabric.deliveryDispatchAdapter;
let firstDispatchEntered;
const firstDispatchEnteredPromise = new Promise((resolve) => {
  firstDispatchEntered = resolve;
});
let releaseFirstDispatch;
const firstDispatchRelease = new Promise((resolve) => {
  releaseFirstDispatch = resolve;
});
let stalledDispatchCount = 0;
fabric.deliveryDispatchAdapter = async (input) => {
  stalledDispatchCount += 1;
  if (stalledDispatchCount === 1) {
    firstDispatchEntered();
    await firstDispatchRelease;
  }
  return originalDeliveryDispatchAdapter(input);
};
tick += 3_000;
appendBlocker(fabric, workerBundle, "runtime-dispatch-stalled-first", "stalled-first");
const stalledFirstFlush = fabric.flushPendingOutbox();
assert.equal(stalledFirstFlush.flushed, 0);
assert.equal([...fabric.broker.deliveries.values()].filter((delivery) => delivery.deliveryPosture === "queued").length, 1);
const stalledDrainPromise = fabric.dispatchQueuedDeliveries();
await firstDispatchEnteredPromise;
tick += 3_000;
appendBlocker(fabric, workerBundle, "runtime-dispatch-queued-during-drain", "queued-during-drain");
fabric.flushPendingOutbox();
releaseFirstDispatch();
const stalledDrain = await stalledDrainPromise;
assert.equal(stalledDrain.delivered, 2);
assert.equal(stalledDispatchCount, 2);
assert.equal(
  [...fabric.broker.deliveries.values()].filter((delivery) => delivery.deliveryPosture === "queued").length,
  0,
);
fabric.deliveryDispatchAdapter = originalDeliveryDispatchAdapter;

const controlledTimerEntries = [];
const controlledScheduler = {
  schedule: (callback, delayMs) => {
    const entry = { callback, delayMs, cancelled: false };
    controlledTimerEntries.push(entry);
    return entry;
  },
  cancel: (entry) => { if (entry) entry.cancelled = true; },
};
const timerFabric = makeFabric({
  dbPath: path.join(rootDir, "world-manager-idle-debounce.sqlite"),
  scheduler: controlledScheduler,
});
timerFabric.bootstrap({ projectIds: [projectId] });
const timerStanding = timerFabric.ensureProjectStanding(projectId);
timerFabric.broker.registerStanding(buildNotificationStanding({
  ...timerStanding,
  epistemicPostures: [...timerStanding.epistemicPostures, "candidate"],
  wakePolicy: "always_new_run",
  operationalPolicy: {
    ...timerStanding.operationalPolicy,
    priorityThreshold: "routine",
  },
  revision: timerStanding.revision + 1,
}, { now }));
timerFabric.persistBroker();
const timerWorkerBundle = timerFabric.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: exactRef("agent", "implementation_worker_idle_timer_fixture"),
  agentWorldRef: exactRef("agent_world", "implementation_worker_idle_timer_world_fixture"),
  authorityBoundaryRef: exactRef("authority_boundary", "project_idle_timer_boundary_fixture"),
});
const providerCountBeforeTimer = providerRequestCount;
appendProposal(timerFabric, timerWorkerBundle, "runtime-dispatch-idle-timer-1", "idle-timer");
const timerEntry = controlledTimerEntries.at(-1);
assert(timerEntry && timerEntry.delayMs >= 0, "A due non-immediate event must install a controlled debounce timer.");
tick = timerFabric.pendingFlushDueTime();
timerEntry.callback();
await timerFabric.deliveryDrainPromise;
assert.equal(providerRequestCount, providerCountBeforeTimer + 1, "The due debounce timer must initiate exactly one downstream dispatch.");
assert.equal([...timerFabric.broker.deliveries.values()].filter((delivery) => delivery.deliveryPosture === "queued").length, 0, "The timer-initiated drain must consume its queued delivery.");
assert.equal(timerFabric.artifactState.contextDispatchReceipts.length, 1);

const providerCountBeforeClosedTimer = providerRequestCount;
appendProposal(timerFabric, timerWorkerBundle, "runtime-dispatch-idle-timer-closed", "idle-timer-closed");
const closedTimerEntry = controlledTimerEntries.at(-1);
timerFabric.close();
closedTimerEntry.callback();
await Promise.resolve();
assert.equal(providerRequestCount, providerCountBeforeClosedTimer, "Closing before a debounce deadline must prevent a new adapter effect.");

const activeRunRef = exactRef("direct_role_run", "project_manager_active_run");
roleRuntime.rememberResident({
  projectId,
  roleKind: "project_manager",
  managerAgentId: projectManagerAgentRef.id,
  agentInstantiationRef: projectManagerAgentRef,
  compiledAgentContextRef: null,
  directSessionId: "project_manager_active_session",
  activeAgentRunRef: activeRunRef,
  runPosture: "active_generating",
  lastRunState: "running",
});
appendBlocker(fabric, workerBundle, "runtime-dispatch-blocker-2", "two");
const activeDrain = await fabric.dispatchQueuedDeliveries();
assert.equal(activeDrain.delivered, 0);
assert.equal(activeDrain.deferred, 1);
assert.equal(providerRequestCount, providerCountBeforeTimer + 1);
const deferredDelivery = [...fabric.broker.deliveries.values()].find(
  (delivery) => delivery.deliveryPosture === "queued",
);
assert(deferredDelivery);
const deferredDispatch = fabric.artifactState.contextDispatches.find(
  (dispatch) => dispatch.deliveryRef.id === deferredDelivery.deliveryId,
);
assert.equal(deferredDispatch.disposition, "safe_boundary_queued");
assert.equal(deferredDispatch.midTokenPreemptionAttempted, false);

roleRuntime.rememberResident({
  projectId,
  roleKind: "project_manager",
  managerAgentId: projectManagerAgentRef.id,
  agentInstantiationRef: projectManagerAgentRef,
  compiledAgentContextRef: null,
  directSessionId: "",
  activeAgentRunRef: null,
  runPosture: "idle_role_resident",
  lastRunState: "completed",
});
const boundaryDrain = await fabric.dispatchQueuedDeliveries();
assert.equal(boundaryDrain.delivered, 1);
assert.equal(providerRequestCount, providerCountBeforeTimer + 2);

const activated = fabric.activateImplementationPatch({
  projectId,
  workThreadId,
  requestRef: exactRef("artifact_request", "implementation_patch_request"),
  producerCandidates: [{
    agentRef: exactRef("agent", "implementation_worker_artifact_fixture"),
    agentRunRef: exactRef("agent_run", "implementation_worker_artifact_run"),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: exactRef("eligibility_receipt", "producer_eligible"),
  }],
});
const producerDispatch = await fabric.dispatchProducerAssignment(
  activated.lifecycle.lifecycleId,
);
assert.equal(producerDispatch.receipt.accepted, true);
assert.equal(producerDispatch.receipt.authorityMode, "artifact_constitution");
assert.equal(
  producerDispatch.authorization.grantsCanonicalAuthority,
  false,
);
assert.equal(
  producerDispatch.authorization.workspaceMutationAllowed,
  false,
);
assert.equal(providerRequestCount, providerCountBeforeTimer + 3);
assert.ok(providerToolNames[5].includes("ledger_publish_observation"));
assert.ok(!providerToolNames[5].includes("ledger_submit_audit_verdict"));
await controller.waitForTurnCompletion({
  sessionId: producerDispatch.receipt.workerSessionId,
  turnId: producerDispatch.receipt.workerTurnId,
});
const producerReplay = await fabric.dispatchProducerAssignment(
  activated.lifecycle.lifecycleId,
);
assert.equal(producerReplay.reused, true);
assert.equal(providerRequestCount, providerCountBeforeTimer + 3);

const published = fabric.publishArtifactRevision({
  lifecycleId: activated.lifecycle.lifecycleId,
  artifactId: "implementation_patch_runtime_dispatch",
  artifactContentRef: exactRef("implementation_patch_body", "patch_revision_1"),
  evidenceRefs: [exactRef("repository_snapshot", "repository_after_patch")],
  settledProperties: { governedActionClasses: ["source_mutation"] },
});
assert.equal(published.lifecycle.state, "under_audit");
const routed = fabric.routeArtifactAudits({
  lifecycleId: activated.lifecycle.lifecycleId,
  auditorCandidates: [{
    agentRef: exactRef("agent", "review_auditor_runtime_dispatch"),
    agentRunRef: exactRef("agent_run", "review_auditor_runtime_dispatch_run"),
    role: "review_auditor",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    auditTypes: ["semantic_contract_conformance", "regression_preservation"],
    independenceReceiptRef: exactRef("independence_receipt", "producer_distinct"),
    boundedCapabilityNames: [
      "ledger.submit_audit_verdict",
      "ledger.request_evidence",
      "apply_patch",
    ],
  }],
});
assert.equal(routed.assignments.length, 2);
const auditDispatches = await fabric.dispatchAuditAssignments(
  activated.lifecycle.lifecycleId,
);
assert.equal(auditDispatches.length, 2);
assert.ok(auditDispatches.every((entry) => entry.receipt.accepted));
assert.ok(auditDispatches.every((entry) =>
  entry.receipt.authorityMode === "artifact_constitution"));
assert.ok(auditDispatches.every((entry) =>
  !entry.authorization.boundedCapabilityNames.includes("apply_patch")));
assert.equal(providerRequestCount, providerCountBeforeTimer + 5);
assert.ok(providerToolNames[6].includes("ledger_submit_audit_verdict"));
assert.ok(providerToolNames[7].includes("ledger_submit_audit_verdict"));
for (const entry of auditDispatches) {
  await controller.waitForTurnCompletion({
    sessionId: entry.receipt.workerSessionId,
    turnId: entry.receipt.workerTurnId,
  });
}

const authenticAuthorization = auditDispatches[0].authorization;
const forgedAuthorization = {
  ...authenticAuthorization,
  projectId: "project_foreign",
};
const authenticReceipt = auditDispatches[0].receipt;
const authenticSession = sessionStore.readSession(
  authenticReceipt.workerSessionId,
);
assert(authenticSession);
assert.throws(
  () => require("../src/main/direct/bridge/worker-start")
    .validateArtifactWorkThreadStartAuthorization(forgedAuthorization),
  /digest_mismatch|authorization_invalid/,
);

const receiptCountBeforeRestart =
  fabric.artifactState.contextDispatchReceipts.length;
fabric.close();
fabric = makeFabric();
fabric.bootstrap({ projectIds: [projectId] });
const restartDrain = await fabric.dispatchQueuedDeliveries();
assert.equal(restartDrain.attempted, 0);
assert.equal(
  fabric.artifactState.contextDispatchReceipts.length,
  receiptCountBeforeRestart,
);
assert.equal(providerRequestCount, providerCountBeforeTimer + 5);

console.log(JSON.stringify({
  schema: "direct_world_manager_runtime_dispatch_regression@1",
  status: "passed",
  nativeBoundedContextImported: true,
  idleResidentRoleWakeStarted: true,
  activeGenerationDeferredWithoutPreemption: true,
  safeBoundaryDrainedAfterIdle: true,
  deliveryReplayProviderCallCountStable: true,
  dispatchReceiptRestartStable: true,
  artifactConstitutionProducerStarted: true,
  independentArtifactAuditorsStarted: 2,
  operatorAcceptanceFabricated: false,
  forgedAuthorizationRejected: true,
  workspaceMutationAuthorizedByThisSlice: false,
  canonicalAuthorityGrantedByThisSlice: false,
  providerRequestCount,
}, null, 2));
