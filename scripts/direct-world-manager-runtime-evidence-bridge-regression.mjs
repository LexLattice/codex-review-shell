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
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  digestFor,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");
const {
  buildArtifactRuntimeEvidenceReceipt,
} = require(
  "../src/main/direct/worldmanager/artifact-runtime-evidence",
);

const configuredRootDir = String(
  process.env.CODEX_WORLD_MANAGER_SC11_RUNTIME_ROOT || "",
).trim();
const rootDir = configuredRootDir
  ? path.resolve(configuredRootDir)
  : fs.mkdtempSync(
      path.join(os.tmpdir(), "direct-world-manager-runtime-evidence-"),
    );
fs.mkdirSync(rootDir, { recursive: true });
const stopAtGate =
  process.env.CODEX_WORLD_MANAGER_SC11_STOP_AT_GATE === "1";
const projectId = "project_runtime_evidence_fixture";
let tick = Date.parse("2026-08-01T22:00:00.000Z");
const now = () => (tick += 25);
let controlStore = new DirectWorldManagerControlPlaneStore({ rootDir, now });
const dbPath = controlStore.dbPath;

function exactRef(kind, id) {
  return {
    kind,
    id,
    digest: digestFor(`fixture_${kind}@1`, { id, projectId }),
    projectId,
  };
}

function response(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function toolSse(name, args, sequence) {
  const itemId = `tool_runtime_evidence_${sequence}`;
  const callId = `call_runtime_evidence_${sequence}`;
  const responseId = `resp_runtime_evidence_${sequence}`;
  const argumentsJson = JSON.stringify(args);
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.4" } })}`,
    "",
    "event: response.output_item.added",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name } })}`,
    "",
    "event: response.function_call_arguments.delta",
    `data: ${JSON.stringify({ item_id: itemId, call_id: callId, delta: argumentsJson })}`,
    "",
    "event: response.output_item.done",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name, arguments: argumentsJson } })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

function textSse(sequence, value = "Typed runtime transition recorded.") {
  const responseId = `resp_runtime_text_${sequence}`;
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.4" } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `msg_runtime_${sequence}`, delta: value })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout:${label}`);
}

function implementationProof() {
  const requiredCapabilities = [
    "read_file",
    "read_file_loop",
    "apply_patch",
    "run_command",
  ].map((capabilityId) => ({
    capabilityId,
    status: "ready",
    evidenceState: "runtime_probed",
    evidenceId: `proof_${capabilityId}`,
    sourceCaseId: `runtime_${capabilityId}`,
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  }));
  return {
    status: "ready",
    evidenceState: "runtime_probed",
    canSelectImplementationLane: true,
    requiredCapabilities,
    missingCapabilityIds: [],
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  };
}

const profileDoc = {
  profile: {
    profileId: "runtime-evidence-fixture",
    ontology: {
      models: [{ id: "gpt-5.4", status: "accepted" }],
      continuationShapes: [
        { id: "continuation.tool_result", status: "accepted" },
        { id: "direct_patch_apply_continuation@1", status: "accepted" },
        { id: "direct_command_execution_continuation@1", status: "accepted" },
      ],
    },
  },
};
const project = {
  id: projectId,
  name: "Runtime evidence bridge fixture",
  workspace: { kind: "wsl" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      model: "gpt-5.4",
    },
  },
};
const sessionStore = new DirectSessionStore({
  rootDir: path.join(rootDir, "sessions"),
});
const directThreadStore = new DirectThreadStore({
  rootDir: path.join(rootDir, "threads"),
});

let fabric = null;
let roleRuntime = null;
let worldManagerService = null;
let providerSequence = 0;
let repositoryRevision = 0;
const providerRequests = [];
const workspaceCalls = [];
const lifecycleAutomations = [];
const patchText = [
  "diff --git a/src/runtime-evidence.js b/src/runtime-evidence.js",
  "--- a/src/runtime-evidence.js",
  "+++ b/src/runtime-evidence.js",
  "@@ -1 +1 @@",
  "-module.exports = false;",
  "+module.exports = true;",
  "",
].join("\n");

function repositoryObservation() {
  return {
    schema: "workspace_repository_semantic_observation@1",
    projectId,
    workspaceKind: "wsl",
    gitAvailable: true,
    headOid: "0123456789abcdef",
    branch: "main",
    dirtyPathCount: repositoryRevision ? 1 : 0,
    statusDigest: `sha256:status-${repositoryRevision}`,
    diffDigest: `sha256:diff-${repositoryRevision}`,
    untrackedStateDigest: "sha256:untracked-none",
    manifestDigest: "sha256:manifest-runtime-evidence",
    trackedFileCount: 8,
    manifestPaths: [],
    manifestTruncated: false,
    evidence: [],
    evidenceCatalogComplete: true,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    observedAt: new Date(tick + 10_000).toISOString(),
  };
}

const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore,
  profileDoc,
  implementationProofEvidenceResolver: () => implementationProof(),
  compiledAgentContextResolver: (input) =>
    roleRuntime?.resolveCompiledAgentContext(input) || null,
  epistemicLedgerToolBundleResolver: (input = {}) => {
    if (!fabric || !input.compiledAgentContext) return null;
    const roleLane = input.roleLane || "implementation_worker";
    const session = sessionStore.readSession(input.sessionId);
    return {
      bundle: fabric.compileRoleTools({
        roleLane,
        actorRef: input.compiledAgentContext.agentInstantiationRef,
        agentWorldRef: {
          kind: "compiled_agent_context",
          id: input.compiledAgentContext.compiledAgentContextId,
          digest: input.compiledAgentContext.digest,
        },
        authorityBoundaryRef: exactRef(
          "authority_boundary",
          `${roleLane}_runtime_evidence_boundary`,
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
      visibleEvidenceRefs: [],
      currentRevisionByScope: {},
      artifactLifecycleBinding: fabric.resolveArtifactLedgerBinding({
        authorizationId: session?.artifactWorkThreadAuthorizationId,
        authorizationDigest: session?.artifactWorkThreadAuthorizationDigest,
        actorRef: input.compiledAgentContext.agentInstantiationRef,
        roleLane,
      }),
    };
  },
  epistemicLedgerToolInvoker: async (input) => {
    const result = fabric.invokeLedgerTool(input);
    const lifecycleIngestion = fabric.ingestLifecycleLedgerAct({
      ledgerToolResult: result,
      operationName: input.operationName,
      artifactLifecycleBinding: input.artifactLifecycleBinding,
    });
    const lifecycleAutomation =
      await fabric.automateLifecycleIngestion(lifecycleIngestion);
    lifecycleAutomations.push(lifecycleAutomation);
    return { result, lifecycleIngestion, lifecycleAutomation };
  },
  authStore: {
    readStatus: () => ({
      status: "authenticated",
      accountId: "acct_runtime_evidence_fixture",
      hasAccessToken: true,
      rawTokensExposed: false,
    }),
    readCredentials: () => ({
      accessToken: "runtime_evidence_fixture_token_secret_123456",
    }),
  },
  workspaceRequest: async (_project, method, params) => {
    workspaceCalls.push({ method, params });
    if (method === "applyPatch") {
      if (params.mode === "apply") repositoryRevision += 1;
      return {
        schema: "workspace_apply_patch_result@1",
        mode: params.mode,
        status: params.mode === "apply" ? "applied" : "dry_run_passed",
        files: [{
          path: "src/runtime-evidence.js",
          displayPath: "src/runtime-evidence.js",
          operation: "update",
          beforeDigest: "sha256:runtime-evidence-before",
          afterDigest: "sha256:runtime-evidence-after",
          addedLineCount: 1,
          removedLineCount: 1,
          hunkCount: 1,
          previewText: patchText,
          previewTruncated: false,
        }],
        totals: {
          fileCount: 1,
          createCount: 0,
          updateCount: 1,
          deleteCount: 0,
          addedLineCount: 1,
          removedLineCount: 1,
          hunkCount: 1,
        },
        backendCapabilities: {
          workspaceEffectScanSupported: true,
        },
        workspaceBindingEvidenceKey: "workspace-binding-runtime-evidence",
      };
    }
    if (method === "readFile") {
      return {
        relPath: "package.json",
        size: 64,
        truncated: false,
        binary: false,
        text: JSON.stringify({ scripts: { test: "node ./test.js" } }),
        source: "local",
      };
    }
    assert.equal(method, "runDirectCommand");
    return {
      command: "npm",
      args: ["test"],
      cwdRelPath: "",
      exitCode: 0,
      signal: "",
      timedOut: false,
      durationMs: 25,
      stdout: "1 test passed\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      workspaceEffects: {
        preCommandWorkspaceDigest: `repo-${repositoryRevision}`,
        postCommandWorkspaceDigest: `repo-${repositoryRevision}`,
        changedPathCount: 0,
        changedPathsPreview: [],
        changedPathsTruncated: false,
        scanScope: "git-status",
        scanFailed: false,
      },
      workspaceEffectScanCapabilities: {
        gitStatusSupported: true,
      },
      workspaceEffectScanConsistency: "stable",
      workspaceBindingEvidenceKey: "workspace-binding-runtime-evidence",
      backendCapabilities: {
        shellFalseSupported: true,
        cwdContainmentSupported: true,
        timeoutKillSupported: true,
        envSanitizationSupported: true,
        networkIsolationSupported: false,
        processTreeKillSupported: true,
        workspaceEffectScanSupported: true,
      },
      backgroundProcessCheck: {
        supported: true,
        orphanedProcessSuspected: false,
      },
      startedAt: new Date(tick + 100).toISOString(),
      completedAt: new Date(tick + 200).toISOString(),
    };
  },
  fetchImpl: async (_url, init) => {
    providerSequence += 1;
    const body = JSON.parse(init.body);
    const serialized = JSON.stringify(body);
    providerRequests.push(body);
    if (serialized.includes("epistemic_ledger_result")) {
      return response(textSse(providerSequence));
    }
    const tools = (body.tools || []).map((tool) =>
      tool.name || tool.function?.name);
    const prompt = body.input?.[0]?.content?.[0]?.text || "";
    const lifecycleId = prompt.match(/^Lifecycle:\s*(\S+)/m)?.[1] || "";
    const assignmentId = prompt.match(/^Assignment:\s*(\S+)/m)?.[1] || "";
    if (tools.includes("ledger_submit_audit_verdict")) {
      const assignment = fabric.artifactState.auditAssignments.find(
        (entry) => entry.auditAssignmentId === assignmentId,
      );
      assert(assignment);
      return response(toolSse("ledger_submit_audit_verdict", {
        subjectScope: {
          kind: "work_thread",
          userWorldId: "user_world_local",
          projectId,
          workThreadId: "workthread_runtime_evidence",
        },
        objectRefs: [],
        evidenceRefs: [],
        affectsRefs: [],
        expectedRevisionVector: [],
        semanticPayload: {
          verdict: "supported",
          remandObligations: [],
          findingRefs: [],
        },
        rendererSafeSummary:
          `${assignment.auditType} supports the exact revision.`,
        idempotencyKey: `${assignmentId}:supported`,
      }, providerSequence));
    }
    if (serialized.includes("run_command_result")) {
      assert(lifecycleId);
      return response(toolSse("ledger_submit_closure", {
        subjectScope: {
          kind: "work_thread",
          userWorldId: "user_world_local",
          projectId,
          workThreadId: "workthread_runtime_evidence",
        },
        objectRefs: [],
        evidenceRefs: [],
        affectsRefs: [],
        expectedRevisionVector: [],
        semanticPayload: {
          closureKind: "artifact_candidate",
          artifactId: `implementation_patch_${lifecycleId}`,
          artifactContentRef: exactRef(
            "implementation_patch_body",
            `${lifecycleId}_revision_1`,
          ),
          settledProperties: {
            governedActionClasses: ["source_mutation"],
          },
        },
        rendererSafeSummary: "Implementation candidate submitted.",
        idempotencyKey: `${lifecycleId}:candidate:1`,
      }, providerSequence));
    }
    if (serialized.includes("apply_patch_result")) {
      return response(toolSse("run_command", {
        command: "npm",
        args: ["test"],
        cwd: "",
        reason: "Run the focused regression.",
        timeoutMs: 2_000,
      }, providerSequence));
    }
    return response(toolSse("apply_patch", {
      patch: patchText,
      summary: "Implement the runtime evidence bridge fixture.",
    }, providerSequence));
  },
});

roleRuntime = new DirectRoleRuntime({
  controller,
  sessionStore,
  resolveProject: async (candidateProjectId) =>
    candidateProjectId === projectId ? project : null,
  now,
});

function makeFabric() {
  return new DirectWorldManagerEpistemicFabricRuntime({
    dbPath,
    now,
    artifactWorkThreadDispatchAdapter: (input) =>
      roleRuntime.dispatchArtifactWorkThread(input),
    artifactRuntimeEvidenceResolver: async (input) => ({
      schema: "direct_artifact_runtime_evidence_observation@1",
      projectId,
      workerSessionId: input.dispatchReceipt.workerSessionId,
      workerTurnId: input.dispatchReceipt.workerTurnId,
      session: sessionStore.readSession(input.dispatchReceipt.workerSessionId),
      turn: sessionStore.readTurn(
        input.dispatchReceipt.workerSessionId,
        input.dispatchReceipt.workerTurnId,
      ),
      repositoryObservation: repositoryObservation(),
      observationOnly: true,
      workspaceMutationEffect: false,
      canonicalEffect: false,
      grantsAuthority: false,
    }),
    canonicalRevisionResolver: ({ targetAdmissionScope }) =>
      worldManagerService.worldmodel.canonicalArtifactRevisionRefs(
        targetAdmissionScope,
      ),
    authorityAdapter: (input) =>
      worldManagerService.worldmodel.admitArtifactRevision(input),
  });
}

function startWorldManagerStack() {
  fabric = makeFabric();
  worldManagerService = new DirectWorldManagerService({
    store: controlStore,
    epistemicFabric: fabric,
    userWorldId: "user_world_local",
    projects: [{
      id: projectId,
      name: project.name,
      summary: "Selected project is ready for a WorldManager-routed interaction.",
      runtimePath: "app-server",
      workspaceKind: "local",
      roleRuntimeAddressable: true,
    }],
    activeProjectId: projectId,
    automaticAroReconstructionEnabled: false,
    now,
  });
  worldManagerService.bootstrap();
}

function producerCandidate() {
  return {
    agentRef: exactRef("agent", "implementation_worker_runtime_evidence"),
    agentRunRef: exactRef("agent_run", "implementation_run_runtime_evidence"),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: exactRef(
      "eligibility_receipt",
      "producer_runtime_evidence_eligible",
    ),
  };
}

function auditorCandidate(id, auditTypes) {
  return {
    agentRef: exactRef("agent", `review_auditor_${id}`),
    agentRunRef: exactRef("agent_run", `review_run_${id}`),
    role: "review_auditor",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    auditTypes,
    independenceReceiptRef: exactRef(
      "independence_receipt",
      `producer_distinct_${id}`,
    ),
    boundedCapabilityNames: [
      "ledger.submit_audit_verdict",
      "ledger.request_evidence",
    ],
  };
}

startWorldManagerStack();
const activated = fabric.activateImplementationPatch({
  projectId,
  workThreadId: "workthread_runtime_evidence",
  requestRef: exactRef("artifact_request", "runtime_evidence_request"),
  producerCandidates: [producerCandidate()],
  auditorCandidates: [
    auditorCandidate("contract", ["semantic_contract_conformance"]),
    auditorCandidate("regression", ["regression_preservation"]),
  ],
});
const dispatched = await fabric.dispatchProducerAssignment(
  activated.lifecycle.lifecycleId,
);
assert.equal(dispatched.authorization.workspaceMutationAllowed, false);
assert.equal(dispatched.authorization.workspaceEffectRequestAllowed, true);
assert.equal(dispatched.authorization.perToolAuthorizationRequired, true);
assert.equal(dispatched.authorization.mechanicalRuntimeWitnessEligible, true);

const producerSessionId = dispatched.receipt.workerSessionId;
const producerTurnId = dispatched.receipt.workerTurnId;
const patchObligation = await waitFor(() => {
  const turn = sessionStore.readTurn(producerSessionId, producerTurnId);
  return turn?.unresolvedObligations?.find((entry) =>
    entry.name === "apply_patch" &&
    entry.status === "patch_planned" &&
    entry.authorityState === "patch_waiting_for_approval");
}, "headless patch approval request");
await controller.approveExecuteAndContinuePatchApply({
  sessionId: producerSessionId,
  turnId: producerTurnId,
  obligationId: patchObligation.obligationId,
  project,
  surfaceSession: null,
  clientPatchDecisionId: "runtime_evidence_patch_approved",
  workThreadId: "workthread_runtime_evidence",
});

const commandObligation = await waitFor(() => {
  const turn = sessionStore.readTurn(producerSessionId, producerTurnId);
  return turn?.unresolvedObligations?.find((entry) =>
    entry.name === "run_command" &&
    entry.status === "command_planned" &&
    entry.authorityState === "command_waiting_for_approval");
}, "headless command approval request");
await controller.approveExecuteAndContinueCommandExecution({
  sessionId: producerSessionId,
  turnId: producerTurnId,
  obligationId: commandObligation.obligationId,
  project,
  surfaceSession: null,
  clientCommandDecisionId: "runtime_evidence_command_approved",
  workThreadId: "workthread_runtime_evidence",
});

await waitFor(() => {
  const lifecycle = fabric.lifecycle(activated.lifecycle.lifecycleId);
  return lifecycle.state === "gate_ready";
}, "runtime evidence lifecycle gate ready").catch((error) => {
  console.error(JSON.stringify({
    lifecycleState: fabric.lifecycle(activated.lifecycle.lifecycleId).state,
    turnError: sessionStore.readTurn(producerSessionId, producerTurnId)?.error,
    turnState: sessionStore.readTurn(producerSessionId, producerTurnId)?.state,
    obligationStates: sessionStore.readTurn(
      producerSessionId,
      producerTurnId,
    )?.unresolvedObligations?.map((entry) => ({
      name: entry.name,
      status: entry.status,
      authorityState: entry.authorityState,
      failureKind: entry.failureKind,
    })),
    lifecycleAutomations: lifecycleAutomations.filter(Boolean).map((entry) => ({
      action: entry.action,
      runtimeEvidence: entry.runtimeEvidence,
      routingUnresolved: entry.routingPlan?.unresolved || [],
      dispatchCount: Array.isArray(entry.dispatches)
        ? entry.dispatches.length
        : 0,
    })),
    runtimeEvidenceCount:
      fabric.artifactState.artifactRuntimeEvidenceReceipts.length,
    witnessCount: fabric.artifactState.mechanicalWitnesses.length,
    auditAssessmentCount: fabric.artifactState.auditAssessments.length,
  }, null, 2));
  throw error;
});
await waitFor(() => controller.activeRuns.size === 0, "all runtime turns");

const lifecycle = fabric.lifecycle(activated.lifecycle.lifecycleId);
const revision = fabric.currentArtifactRevision(lifecycle);
assert.equal(revision.revision, 1);
const runtimeReceipt = fabric.artifactState.artifactRuntimeEvidenceReceipts[0];
assert(runtimeReceipt);
assert.equal(runtimeReceipt.ingestionState, "applied");
assert.equal(runtimeReceipt.workspaceMutationObserved, true);
assert.equal(runtimeReceipt.workspaceMutationAuthorizedByLifecycle, false);
assert.equal(runtimeReceipt.separatelyAuthorizedToolEffectsObserved, true);
assert.deepEqual(
  runtimeReceipt.requirementDischarges.map((entry) => [
    entry.requirementId,
    entry.state,
  ]),
  [
    ["source_digest_current", "supported"],
    ["focused_test_exit", "supported"],
  ],
);
const exactProducerSession = sessionStore.readSession(producerSessionId);
const exactProducerTurn = sessionStore.readTurn(
  producerSessionId,
  producerTurnId,
);
const staleRuntimeReceipt = buildArtifactRuntimeEvidenceReceipt({
  projectId,
  lifecycleRef: runtimeReceipt.lifecycleRef,
  artifactRevisionRef: runtimeReceipt.artifactRevisionRef,
  authorization: dispatched.authorization,
  dispatchReceipt: dispatched.receipt,
  runtimeObservation: {
    session: exactProducerSession,
    turn: exactProducerTurn,
  },
  repositoryObservation: {
    ...repositoryObservation(),
    observedAt: "2000-01-01T00:00:00.000Z",
  },
  now,
});
assert.equal(staleRuntimeReceipt.ingestionState, "blocked");
assert.ok(staleRuntimeReceipt.blockerCodes.includes(
  "artifact_runtime_repository_state_stale",
));
assert.ok(staleRuntimeReceipt.requirementDischarges.every(
  (entry) => entry.state === "blocked",
));
const selfReportedRuntimeReceipt = buildArtifactRuntimeEvidenceReceipt({
  projectId,
  lifecycleRef: runtimeReceipt.lifecycleRef,
  artifactRevisionRef: runtimeReceipt.artifactRevisionRef,
  authorization: dispatched.authorization,
  dispatchReceipt: dispatched.receipt,
  runtimeObservation: {
    session: exactProducerSession,
    turn: {
      ...exactProducerTurn,
      toolResults: [],
      semanticResult: {
        sourceDigestCurrent: true,
        focusedTestExit: 0,
      },
    },
  },
  repositoryObservation: repositoryObservation(),
  now,
});
assert.equal(selfReportedRuntimeReceipt.ingestionState, "blocked");
assert.ok(selfReportedRuntimeReceipt.blockerCodes.includes(
  "artifact_runtime_patch_witness_missing",
));
assert.ok(selfReportedRuntimeReceipt.blockerCodes.includes(
  "artifact_runtime_focused_test_witness_missing",
));
const currentWitnesses = fabric.artifactState.mechanicalWitnesses.filter(
  (entry) => entry.artifactRevisionRef.id === revision.artifactRevisionId,
);
assert.equal(currentWitnesses.length, 2);
assert.ok(currentWitnesses.every((entry) =>
  entry.state === "supported" &&
  entry.mechanicallyAuthored === true &&
  entry.semanticTruthClaimed === false));
assert.equal(fabric.artifactState.auditAssessments.length, 2);
assert.equal(fabric.artifactState.admissionReceipts.length, 0);
assert.ok(workspaceCalls.some((entry) =>
  entry.method === "applyPatch" && entry.params.mode === "apply"));
assert.ok(workspaceCalls.some((entry) => entry.method === "runDirectCommand"));

const projection = fabric.projection();
assert.equal(projection.summary.appliedRuntimeEvidenceCount, 1);
assert.equal(projection.runtimeEvidenceDischarges.length, 1);
assert.equal(
  projection.runtimeEvidenceDischarges[0].workspaceMutationAuthorizedByLifecycle,
  false,
);

const providerCountBeforeRestart = providerRequests.length;
const workspaceCallCountBeforeRestart = workspaceCalls.length;
worldManagerService.close();
controlStore = new DirectWorldManagerControlPlaneStore({ rootDir, now });
startWorldManagerStack();
assert.equal(fabric.artifactState.artifactRuntimeEvidenceReceipts.length, 1);
assert.equal(providerRequests.length, providerCountBeforeRestart);
assert.equal(workspaceCalls.length, workspaceCallCountBeforeRestart);
assert.equal(fabric.lifecycle(activated.lifecycle.lifecycleId).state, "gate_ready");
assert.equal(fabric.artifactState.admissionReceipts.length, 0);

const gateProjection = worldManagerService.snapshot();
const gateCard = gateProjection.epistemicFabric.lifecycleCards.find((card) =>
  card.lifecycleRef.id === activated.lifecycle.lifecycleId);
assert(gateCard);
assert.equal(gateCard.authorityState, "gate_ready");
assert.equal(gateCard.receiptBackedCanonical, false);
assert.ok(gateCard.evidenceRefs.length >= 4);
assert.equal(gateCard.auditAssignments.length, 2);
assert.ok(gateCard.auditAssignments.every((assignment) =>
  assignment.verdict === "supported" &&
  assignment.exactRevisionAssessed === true &&
  assignment.independenceReceiptRef));
assert.equal(gateCard.expectedCanonicalRevisionRefs.length, 1);
assert.equal(gateCard.targetAdmissionScope.kind, "workthread");
if (process.env.CODEX_WORLD_MANAGER_SC11_FULL_GATE_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_SC11_FULL_GATE_PROJECTION_PATH,
    ),
    JSON.stringify(gateProjection, null, 2),
  );
}

if (stopAtGate) {
  worldManagerService.close();
  console.log(JSON.stringify({
    schema: "direct_world_manager_runtime_evidence_bridge_fixture@1",
    status: "gate_fixture_ready",
    lifecycleGateReady: true,
    canonicalAdmissionAutomatic: false,
    restartPreservedRuntimeEvidence: true,
    providerRequestCount: providerRequests.length,
    workspaceCallCount: workspaceCalls.length,
  }, null, 2));
  process.exit(0);
}

await assert.rejects(
  worldManagerService.requestImplementationPatchAdmissionFromSurface({
    schema: "direct_world_manager_artifact_admission_request@1",
    lifecycleId: gateCard.lifecycleRef.id,
    lifecycleRef: gateCard.lifecycleRef,
    artifactRevisionRef: gateCard.currentArtifactRevisionRef,
    gateDecisionRef: gateCard.gateDecisionRef,
    admissionAuthorityRef: gateCard.admissionAuthorityRef,
    targetAdmissionScope: gateCard.targetAdmissionScope,
    expectedCanonicalRevisionRefs: gateCard.expectedCanonicalRevisionRefs,
    reviewedEvidenceRefs: gateCard.evidenceRefs.slice(1),
    operatorReviewAcknowledged: true,
  }),
  /world_manager_artifact_admission_surface_binding_stale/,
);
assert.equal(fabric.lifecycle(activated.lifecycle.lifecycleId).state, "gate_ready");

const admitted =
  await worldManagerService.requestImplementationPatchAdmissionFromSurface({
    schema: "direct_world_manager_artifact_admission_request@1",
    lifecycleId: gateCard.lifecycleRef.id,
    lifecycleRef: gateCard.lifecycleRef,
    artifactRevisionRef: gateCard.currentArtifactRevisionRef,
    gateDecisionRef: gateCard.gateDecisionRef,
    admissionAuthorityRef: gateCard.admissionAuthorityRef,
    targetAdmissionScope: gateCard.targetAdmissionScope,
    expectedCanonicalRevisionRefs: gateCard.expectedCanonicalRevisionRefs,
    reviewedEvidenceRefs: gateCard.evidenceRefs,
    operatorReviewAcknowledged: true,
  });
assert.equal(admitted.result.lifecycle.state, "admitted");
assert.equal(admitted.result.receipt.receiptPosture, "admitted");
assert.equal(
  admitted.result.receipt.trustStoreReceiptRef.kind,
  "worldmodel_graph_transition",
);
const admittedCard = admitted.projection.epistemicFabric.lifecycleCards.find(
  (card) => card.lifecycleRef.id === activated.lifecycle.lifecycleId,
);
assert.equal(admittedCard.authorityState, "admitted");
assert.equal(admittedCard.receiptBackedCanonical, true);
assert.ok(admittedCard.admissionReceiptRef);
assert.ok(admittedCard.trustStoreReceiptRef);
assert.equal(
  admittedCard.targetAdmissionScope.workThreadId,
  "workthread_runtime_evidence",
);
assert.ok(worldManagerService.worldmodel.graph.nodes.some((node) =>
  node.structuredValue?.artifactRevisionRef?.id ===
    admittedCard.currentArtifactRevisionRef.id &&
  node.structuredValue?.downstreamEffectsExecuted === false));
if (process.env.CODEX_WORLD_MANAGER_SC11_FULL_ADMITTED_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_SC11_FULL_ADMITTED_PROJECTION_PATH,
    ),
    JSON.stringify(admitted.projection, null, 2),
  );
}
worldManagerService.close();

console.log(JSON.stringify({
  schema: "direct_world_manager_runtime_evidence_bridge_regression@1",
  status: "passed",
  headlessPatchRequestDurable: true,
  headlessCommandRequestDurable: true,
  perToolAuthorizationPreserved: true,
  workspaceMutationPerformedThroughSeparateApproval: true,
  exactRepositoryAfterStateObserved: true,
  sourceDigestWitnessHarnessAuthored: true,
  focusedTestWitnessHarnessAuthored: true,
  exactArtifactRevisionBinding: true,
  staleRepositoryObservationRejected: true,
  modelSelfReportRejectedAsMechanicalEvidence: true,
  semanticAuditsAutomaticallyRouted: true,
  lifecycleGateReady: true,
  canonicalAdmissionAutomatic: false,
  exactSurfaceAdmissionBindingRequired: true,
  productionCanonicalAdmissionExplicit: true,
  canonicalReceiptProjected: true,
  admissionDownstreamEffectsExecuted: false,
  restartPreservedRuntimeEvidence: true,
  providerRequestCount: providerRequests.length,
  workspaceCallCount: workspaceCalls.length,
}, null, 2));
