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
  artifactRevisionRefFor,
  digestFor,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-lifecycle-ingestion-"),
);
const dbPath = path.join(rootDir, "world-manager.sqlite");
const projectId = "project_lifecycle_ingestion_fixture";
let tick = Date.parse("2026-08-01T21:00:00.000Z");
const now = () => (tick += 10);

function exactRef(kind, id) {
  return {
    kind,
    id,
    digest: digestFor(`fixture_${kind}@1`, { id, projectId }),
    projectId,
  };
}

function toolSse(name, args, sequence) {
  const itemId = `tool_lifecycle_${sequence}`;
  const callId = `call_lifecycle_${sequence}`;
  const responseId = `resp_lifecycle_tool_${sequence}`;
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

function textSse(sequence) {
  const responseId = `resp_lifecycle_done_${sequence}`;
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.4" } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `msg_lifecycle_${sequence}`, delta: "Typed lifecycle act recorded." })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

function response(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
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

const sessionStore = new DirectSessionStore({
  rootDir: path.join(rootDir, "sessions"),
});
const directThreadStore = new DirectThreadStore({
  rootDir: path.join(rootDir, "threads"),
});
const project = {
  id: projectId,
  name: "Lifecycle ingestion fixture",
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
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

let fabric = null;
let roleRuntime = null;
let providerSequence = 0;
const lifecycleModes = new Map();
const invocationRecords = [];
const providerRequests = [];

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
    const session = sessionStore.readSession(input.sessionId);
    return {
      bundle: fabric.compileRoleTools({
        roleLane,
        actorRef: compiled.agentInstantiationRef,
        agentWorldRef: {
          kind: "compiled_agent_context",
          id: compiled.compiledAgentContextId,
          digest: compiled.digest,
        },
        authorityBoundaryRef: exactRef(
          "authority_boundary",
          `${roleLane}_lifecycle_ingestion_boundary`,
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
        authorizationId:
          session?.artifactWorkThreadAuthorizationId,
        authorizationDigest:
          session?.artifactWorkThreadAuthorizationDigest,
        actorRef: compiled.agentInstantiationRef,
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
    invocationRecords.push({ input, result, lifecycleIngestion, lifecycleAutomation });
    return { result, lifecycleIngestion, lifecycleAutomation };
  },
  authStore: {
    readStatus: () => ({
      status: "authenticated",
      accountId: "acct_lifecycle_ingestion_fixture",
      hasAccessToken: true,
      rawTokensExposed: false,
    }),
    readCredentials: () => ({
      accessToken: "lifecycle_ingestion_fixture_token_secret_123456",
    }),
  },
  fetchImpl: async (_url, init) => {
    providerSequence += 1;
    const body = JSON.parse(init.body);
    const serialized = JSON.stringify(body);
    providerRequests.push(body);
    if (serialized.includes("epistemic_ledger_result")) {
      return response(textSse(providerSequence));
    }
    const prompt = body.input?.[0]?.content?.[0]?.text || "";
    const lifecycleId = prompt.match(/^Lifecycle:\s*(\S+)/m)?.[1] || "";
    const assignmentId = prompt.match(/^Assignment:\s*(\S+)/m)?.[1] || "";
    const lifecycle = fabric.artifactState.lifecycles.find((entry) =>
      entry.lifecycleInstanceRevisionId === lifecycleId);
    assert(lifecycle, `lifecycle revision ${lifecycleId} must exist`);
    const stableLifecycleId = lifecycle.lifecycleId;
    const mode = lifecycleModes.get(stableLifecycleId) || "converge";
    const subjectScope = {
      kind: "work_thread",
      userWorldId: "user_world_local",
      projectId,
      workThreadId: lifecycle.subjectScope.workThreadId,
    };
    if ((body.tools || []).some((tool) =>
      (tool.name || tool.function?.name) === "ledger_submit_audit_verdict")) {
      const assignment = fabric.artifactState.auditAssignments.find(
        (entry) => entry.auditAssignmentId === assignmentId,
      );
      assert(assignment, `audit assignment ${assignmentId} must exist`);
      const revision = fabric.artifactState.artifactRevisions.find(
        (entry) => entry.artifactRevisionId ===
          assignment.artifactRevisionRef.id,
      );
      assert(revision, "assigned exact revision must exist");
      const shouldRemand = mode === "escalate" ||
        (mode === "converge" &&
          revision.revision === 1 &&
          assignment.auditType === "semantic_contract_conformance");
      if (
        mode === "converge" &&
        revision.revision === 1 &&
        assignment.auditType === "regression_preservation"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return response(toolSse("ledger_submit_audit_verdict", {
        subjectScope,
        objectRefs: [],
        evidenceRefs: [],
        affectsRefs: [],
        expectedRevisionVector: [],
        semanticPayload: {
          verdict: shouldRemand ? "requires_revision" : "supported",
          remandObligations: shouldRemand
            ? [`Revise ${assignment.auditType} before resubmission.`]
            : [],
          findingRefs: [],
        },
        rendererSafeSummary: shouldRemand
          ? `${assignment.auditType} requires a new exact revision.`
          : `${assignment.auditType} supports the exact revision.`,
        idempotencyKey:
          `${stableLifecycleId}:${assignmentId}:${revision.revision}:${shouldRemand ? "remand" : "support"}`,
      }, providerSequence));
    }
    const nextRevision = Number(
      fabric.artifactState.artifactRevisions
        .filter((entry) => entry.lifecycleId === stableLifecycleId)
        .at(-1)?.revision || 0,
    ) + 1;
    return response(toolSse("ledger_submit_closure", {
      subjectScope,
      objectRefs: [],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: {
        closureKind: "artifact_candidate",
        artifactId: `implementation_patch_${stableLifecycleId}`,
        artifactContentRef: exactRef(
          "implementation_patch_body",
          `${stableLifecycleId}_revision_${nextRevision}`,
        ),
        settledProperties: {
          governedActionClasses: ["source_mutation"],
        },
      },
      rendererSafeSummary:
        `Producer submitted candidate revision ${nextRevision}.`,
      idempotencyKey:
        `${stableLifecycleId}:producer-candidate:${nextRevision}`,
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
    authorityAdapter: async () => {
      throw new Error("authority_adapter_must_not_be_called_automatically");
    },
    artifactWorkThreadDispatchAdapter: (input) =>
      roleRuntime.dispatchArtifactWorkThread(input),
  });
}

function producerCandidate(id) {
  return {
    agentRef: exactRef("agent", `implementation_worker_${id}`),
    agentRunRef: exactRef("agent_run", `implementation_run_${id}`),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: exactRef(
      "eligibility_receipt",
      `producer_eligible_${id}`,
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

fabric = makeFabric();
fabric.bootstrap({ projectIds: [projectId] });

const converging = fabric.activateImplementationPatch({
  projectId,
  workThreadId: "workthread_lifecycle_converging",
  requestRef: exactRef("artifact_request", "converging_request"),
  producerCandidates: [producerCandidate("converging")],
  auditorCandidates: [auditorCandidate("converging", [
    "semantic_contract_conformance",
    "regression_preservation",
  ])],
});
lifecycleModes.set(converging.lifecycle.lifecycleId, "converge");
await fabric.dispatchProducerAssignment(converging.lifecycle.lifecycleId);

await waitFor(() => {
  const lifecycle = fabric.lifecycle(converging.lifecycle.lifecycleId);
  const current = lifecycle.currentArtifactRevisionRef
    ? fabric.currentArtifactRevision(lifecycle)
    : null;
  const assessments = current
    ? fabric.artifactState.auditAssessments.filter((entry) =>
        entry.artifactRevisionRef.id === current.artifactRevisionId)
    : [];
  return current?.revision === 2 && assessments.length === 2;
}, "converging lifecycle revision two audits");
await waitFor(() => controller.activeRuns.size === 0, "all converging turns");

const convergingLifecycle = fabric.lifecycle(converging.lifecycle.lifecycleId);
const convergingRevision = fabric.currentArtifactRevision(convergingLifecycle);
assert.equal(convergingRevision.revision, 2);
assert.equal(convergingLifecycle.remandCount, 1);
assert.equal(
  fabric.artifactState.remandObligations.length,
  1,
);
assert.ok(
  fabric.artifactState.lifecycleIngestionReceipts.some((entry) =>
    entry.transitionKind === "artifact_revision_remanded"),
);
assert.ok(
  fabric.artifactState.lifecycleIngestionReceipts.some((entry) =>
    entry.ingestionState === "rejected" &&
    entry.blockerCodes.includes("artifact_lifecycle_binding_stale")),
  "the delayed revision-one auditor must fail closed after remand",
);

for (const requirementId of ["source_digest_current", "focused_test_exit"]) {
  fabric.joinMechanicalWitness({
    lifecycleId: converging.lifecycle.lifecycleId,
    requirementId,
    state: "supported",
    evidenceRefs: [exactRef(
      "mechanical_witness",
      `${requirementId}_revision_2_green`,
    )],
    freshnessWitnessRef: exactRef(
      "freshness_witness",
      `${requirementId}_revision_2_fresh`,
    ),
  });
}
const gate = fabric.evaluateArtifactAssurance({
  lifecycleId: converging.lifecycle.lifecycleId,
});
assert.equal(gate.lifecycle.state, "gate_ready");
assert.equal(gate.join.gateReady, true);
assert.equal(fabric.artifactState.admissionReceipts.length, 0);

const appliedRecord = invocationRecords.find((entry) =>
  entry.lifecycleIngestion?.receipt?.transitionKind ===
    "artifact_revision_registered");
assert(appliedRecord);
const replay = fabric.ingestLifecycleLedgerAct({
  ledgerToolResult: appliedRecord.result,
  operationName: appliedRecord.input.operationName,
  artifactLifecycleBinding:
    appliedRecord.input.artifactLifecycleBinding,
});
assert.equal(replay.reused, true);
assert.equal(
  replay.receipt.receiptDigest,
  appliedRecord.lifecycleIngestion.receipt.receiptDigest,
);

const escalating = fabric.activateImplementationPatch({
  projectId,
  workThreadId: "workthread_lifecycle_escalating",
  requestRef: exactRef("artifact_request", "escalating_request"),
  producerCandidates: [producerCandidate("escalating")],
  auditorCandidates: [auditorCandidate("escalating", [
    "semantic_contract_conformance",
  ])],
});
lifecycleModes.set(escalating.lifecycle.lifecycleId, "escalate");
await fabric.dispatchProducerAssignment(escalating.lifecycle.lifecycleId);
await waitFor(() => {
  const lifecycle = fabric.lifecycle(escalating.lifecycle.lifecycleId);
  return lifecycle.remandCount === 3 &&
    fabric.artifactState.escalationCandidates.some((entry) =>
      entry.lifecycleRef.id === lifecycle.lifecycleInstanceRevisionId);
}, "automatic repeated-remand escalation");
await waitFor(() => controller.activeRuns.size === 0, "all escalating turns");

const providerCountBeforeRestart = providerRequests.length;
const ingestionCountBeforeRestart =
  fabric.artifactState.lifecycleIngestionReceipts.length;
const escalationCountBeforeRestart =
  fabric.artifactState.escalationCandidates.length;
fabric.close();
fabric = makeFabric();
fabric.bootstrap({ projectIds: [projectId] });
assert.equal(
  fabric.artifactState.lifecycleIngestionReceipts.length,
  ingestionCountBeforeRestart,
);
assert.equal(
  fabric.artifactState.escalationCandidates.length,
  escalationCountBeforeRestart,
);
assert.equal(providerRequests.length, providerCountBeforeRestart);
assert.equal(fabric.artifactState.admissionReceipts.length, 0);
assert.ok(fabric.artifactState.workThreadDispatchReceipts.every((entry) =>
  entry.workspaceMutationAuthorized === false &&
  entry.canonicalEffect === false));
const restartProjection = fabric.projection();
assert.equal(
  restartProjection.lifecycleDischarges.length,
  ingestionCountBeforeRestart,
);
assert.ok(
  restartProjection.summary.appliedLifecycleDischargeCount > 0 &&
  restartProjection.summary.rejectedLifecycleDischargeCount > 0,
);

console.log(JSON.stringify({
  schema: "direct_world_manager_lifecycle_ingestion_regression@1",
  status: "passed",
  providerTypedProducerClosureIngested: true,
  producerClosureRegisteredExactRevision: true,
  registeredAuditorsAutomaticallyDispatched: true,
  providerTypedAuditVerdictsIngested: true,
  remandAutomaticallyRedispatchedProducer: true,
  staleRevisionAuditRejected: true,
  repeatedRemandEscalationRaised: true,
  assuranceProgressedToGateReady: true,
  canonicalAdmissionAutomatic: false,
  workspaceMutationAuthorized: false,
  ingestionReplayIdempotent: true,
  restartPreservedIngestionLineage: true,
  lifecycleDischargesProjected: true,
  lifecycleIngestionReceiptCount: ingestionCountBeforeRestart,
  providerRequestCount: providerRequests.length,
}, null, 2));
