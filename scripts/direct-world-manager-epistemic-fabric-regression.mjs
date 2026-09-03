#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
  artifactRevisionRefFor,
  digestFor,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");
const {
  buildAgentSuspensionState,
} = require("../src/main/direct/worldmodel/wakeup-continuation");
const {
  buildNotificationStanding,
} = require("../src/main/direct/worldmanager/ledger-subscription-broker");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-epistemic-fabric-"),
);
const dbPath = path.join(rootDir, "world-manager-control-plane.sqlite");
let tick = Date.parse("2026-08-01T15:00:00.000Z");
const now = () => (tick += 10);
const projectId = "project_epistemic_fabric_fixture";
const workThreadId = "workthread_epistemic_fabric_fixture";

function ref(kind, id, project = projectId) {
  return {
    kind,
    id,
    digest: digestFor(kind, { id, project }),
    ...(project ? { projectId: project } : {}),
  };
}

const authorityCalls = [];
let scopeMismatchLifecycleId = "";
const authorityAdapter = async (request) => {
  authorityCalls.push(request);
  return {
    admitted: true,
    trustStoreReceiptRef: ref(
      "worldmodel_graph_transition",
      `transition_${request.lifecycle.lifecycleId}`,
    ),
    targetAdmissionScope:
      request.lifecycle.lifecycleId === scopeMismatchLifecycleId
        ? { kind: "user_world", userWorldId: "unauthorized_widening" }
        : request.gateDecision.targetAdmissionScope,
  };
};

let runtime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath,
  now,
  authorityAdapter,
});
runtime.bootstrap({ projectIds: [projectId] });

const workerBundle = runtime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "implementation_worker_1"),
  agentWorldRef: ref("agent_world", "implementation_worker_world"),
  authorityBoundaryRef: ref("authority_boundary", "worker_project_boundary"),
});
assert.ok(workerBundle.operationNames.includes("ledger_propose_claim"));
assert.ok(!workerBundle.operationNames.includes("ledger_admit_canonical"));

const workerAppend = runtime.invokeLedgerTool({
  bundle: workerBundle,
  operationName: "ledger_propose_claim",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    objectRefs: [ref("abstract_reasoning_object", "context_menu_aro")],
    evidenceRefs: [ref("repository_snapshot", "repository_before")],
    affectsRefs: [],
    expectedRevisionVector: [],
    semanticPayload: {
      claimType: "implementation_direction",
      candidate: "native context-menu command adapter",
    },
    rendererSafeSummary:
      "Worker proposed one implementation direction from exact repository evidence.",
    idempotencyKey: "worker-proposal-1",
  },
  visibleEvidenceRefs: [ref("repository_snapshot", "repository_before")],
});
assert.equal(workerAppend.decision.allowed, true);
assert.equal(workerAppend.append.receipt.canonicalEffect, false);

const blockerArguments = {
  subjectScope: {
    kind: "project",
    userWorldId: "user_world_local",
    projectId,
  },
  objectRefs: [ref("project_obligation", "topology_replay_fixture")],
  evidenceRefs: [],
  affectsRefs: [],
  expectedRevisionVector: [],
  semanticPayload: {
    blocker: "Subscriber topology must not alter semantic idempotency.",
  },
  rendererSafeSummary: "Worker raised the topology replay fixture blocker.",
  idempotencyKey: "worker-topology-replay-blocker-1",
};
const blockerAppend = runtime.invokeLedgerTool({
  bundle: workerBundle,
  operationName: "ledger_raise_blocker",
  arguments: blockerArguments,
  visibleEvidenceRefs: [],
});
assert.equal(blockerAppend.append.receipt.appendState, "appended");
assert.equal(blockerAppend.append.outboxSeeds.length, 1);
const primaryStanding = runtime.ensureProjectStanding(projectId);
const secondaryStanding = buildNotificationStanding({
  ...primaryStanding,
  standingId: `project_manager_secondary:${projectId}`,
  subscriberRoleRef: ref("role_instance", "project_manager_secondary"),
  revision: 1,
}, { now });
runtime.broker.registerStanding(secondaryStanding);
runtime.persistBroker();
const blockerReplayAfterTopologyChange = runtime.invokeLedgerTool({
  bundle: workerBundle,
  operationName: "ledger_raise_blocker",
  arguments: blockerArguments,
  visibleEvidenceRefs: [],
});
assert.equal(
  blockerReplayAfterTopologyChange.append.receipt.appendState,
  "idempotent_replay",
);
assert.equal(
  blockerReplayAfterTopologyChange.append.event.ledgerEventId,
  blockerAppend.append.event.ledgerEventId,
);
assert.equal(
  blockerReplayAfterTopologyChange.append.outboxSeeds.length,
  1,
  "a newly added standing must not rewrite an existing event's outbox",
);

const activated = runtime.activateImplementationPatch({
  projectId,
  workThreadId,
  requestRef: ref("artifact_request", "implementation_patch_request"),
  producerCandidates: [{
    agentRef: ref("agent", "implementation_worker_1"),
    agentRunRef: ref("agent_run", "implementation_run_1"),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: ref("eligibility_receipt", "producer_eligible"),
  }],
});
assert.equal(activated.lifecycle.state, "under_production");

const published = runtime.publishArtifactRevision({
  lifecycleId: activated.lifecycle.lifecycleId,
  artifactId: "implementation_patch_context_menu",
  artifactContentRef: ref("implementation_patch_body", "patch_revision_1"),
  evidenceRefs: [ref("repository_after_digest", "repository_after_1")],
  settledProperties: {
    governedActionClasses: ["source_mutation"],
  },
});
assert.equal(published.lifecycle.state, "under_audit");

const auditor = {
  agentRef: ref("agent", "review_auditor_1"),
  agentRunRef: ref("agent_run", "review_auditor_run_1"),
  role: "review_auditor",
  active: true,
  substrateAvailable: true,
  budgetAvailable: true,
  visibleProjectIds: [projectId],
  auditTypes: [
    "semantic_contract_conformance",
    "regression_preservation",
  ],
  independenceReceiptRef: ref(
    "independence_receipt",
    "reviewer_distinct_from_producer",
  ),
  boundedCapabilityNames: [
    "ledger.submit_audit_verdict",
    "ledger.request_evidence",
    "apply_patch",
  ],
};
const routing = runtime.routeArtifactAudits({
  lifecycleId: activated.lifecycle.lifecycleId,
  auditorCandidates: [auditor],
});
assert.equal(routing.assignments.length, 2);
assert.ok(routing.assignments.every((assignment) =>
  !assignment.boundedCapabilityNames.includes("apply_patch")));

for (const requirementId of [
  "source_digest_current",
  "focused_test_exit",
]) {
  runtime.joinMechanicalWitness({
    lifecycleId: activated.lifecycle.lifecycleId,
    requirementId,
    state: "supported",
    evidenceRefs: [ref("mechanical_witness", `${requirementId}_green`)],
    freshnessWitnessRef: ref(
      "freshness_witness",
      `${requirementId}_fresh`,
    ),
  });
}
for (const assignment of routing.assignments) {
  runtime.submitAuditVerdict({
    lifecycleId: activated.lifecycle.lifecycleId,
    auditAssignmentId: assignment.auditAssignmentId,
    verdict: "supported",
    evidenceRefs: [ref("audit_evidence", `${assignment.requirementId}_green`)],
    rendererSafeSummary: `${assignment.auditType} supported`,
  });
}

const evaluated = runtime.evaluateArtifactAssurance({
  lifecycleId: activated.lifecycle.lifecycleId,
  targetAdmissionScope: {
    kind: "workthread",
    projectId,
    workThreadId,
    taskType: "implementation",
  },
  expectedCanonicalRevisionRefs: [
    ref("workthread_revision", "before_admission"),
  ],
});
assert.equal(evaluated.lifecycle.state, "gate_ready");
assert.equal(evaluated.join.admitted, false);

const preAdmissionProjection = runtime.projection();
assert.equal(preAdmissionProjection.summary.gateReadyCount, 1);
assert.equal(preAdmissionProjection.summary.admittedArtifactCount, 0);
assert.equal(preAdmissionProjection.lifecycleCards[0].assurancePosture, "supported");
assert.equal(preAdmissionProjection.lifecycleCards[0].requiredAuditCount, 2);
assert.equal(preAdmissionProjection.lifecycleCards[0].satisfiedAuditCount, 2);
assert.ok(preAdmissionProjection.lifecycleCards[0].evidenceRefs.length >= 4);
if (process.env.CODEX_WORLD_MANAGER_SC11_GATE_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_SC11_GATE_PROJECTION_PATH,
    ),
    JSON.stringify(preAdmissionProjection, null, 2),
  );
}

const admitted = await runtime.requestArtifactAdmission({
  lifecycleId: activated.lifecycle.lifecycleId,
  actorRef: ref("agent", "project_manager_1"),
  expectedCanonicalRevisionRefs: [
    ref("workthread_revision", "before_admission"),
  ],
});
assert.equal(authorityCalls.length, 1);
assert.equal(admitted.receipt.admitted, true);
assert.equal(admitted.lifecycle.state, "admitted");

const finalProjection = runtime.projection();
assert.equal(finalProjection.summary.gateReadyCount, 0);
assert.equal(finalProjection.summary.admittedArtifactCount, 1);
assert.equal(finalProjection.lifecycleCards[0].canonical, true);
assert.equal(finalProjection.lifecycleCards[0].receiptBackedCanonical, true);
assert.ok(finalProjection.lifecycleCards[0].admissionReceiptRef);
assert.ok(finalProjection.lifecycleCards[0].trustStoreReceiptRef);
assert.ok(finalProjection.deliveries.length >= 1);
if (process.env.CODEX_WORLD_MANAGER_SC11_ADMITTED_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_SC11_ADMITTED_PROJECTION_PATH,
    ),
    JSON.stringify(finalProjection, null, 2),
  );
}
const lifecycleId = admitted.lifecycle.lifecycleId;
const revisionRef = artifactRevisionRefFor(published.revision);

// A later contradiction must revoke gate-ready standing before authority can
// be invoked, and an assignment for revision one cannot certify revision two.
const negativeActivated = runtime.activateImplementationPatch({
  projectId,
  workThreadId: `${workThreadId}_negative`,
  requestRef: ref("artifact_request", "negative_patch_request"),
  producerCandidates: [{
    agentRef: ref("agent", "implementation_worker_2"),
    agentRunRef: ref("agent_run", "implementation_run_2"),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: ref("eligibility_receipt", "producer_2_eligible"),
  }],
});
const negativePublished = runtime.publishArtifactRevision({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  artifactId: "implementation_patch_negative",
  artifactContentRef: ref("implementation_patch_body", "negative_revision_1"),
  evidenceRefs: [ref("repository_after_digest", "negative_repository_after_1")],
  settledProperties: { governedActionClasses: ["source_mutation"] },
});
const negativeRouting = runtime.routeArtifactAudits({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  auditorCandidates: [{
    ...auditor,
    agentRef: ref("agent", "review_auditor_2"),
    agentRunRef: ref("agent_run", "review_auditor_run_2"),
    independenceReceiptRef: ref(
      "independence_receipt",
      "reviewer_2_distinct_from_producer",
    ),
  }],
});
for (const requirementId of ["source_digest_current", "focused_test_exit"]) {
  runtime.joinMechanicalWitness({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    requirementId,
    state: "supported",
    evidenceRefs: [ref("mechanical_witness", `negative_${requirementId}_green`)],
    freshnessWitnessRef: ref(
      "freshness_witness",
      `negative_${requirementId}_fresh`,
    ),
  });
}
for (const assignment of negativeRouting.assignments) {
  runtime.submitAuditVerdict({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    auditAssignmentId: assignment.auditAssignmentId,
    verdict: "supported",
    evidenceRefs: [ref("audit_evidence", `negative_${assignment.requirementId}_green`)],
  });
}
const negativeGateReady = runtime.evaluateArtifactAssurance({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  targetAdmissionScope: {
    kind: "workthread",
    projectId,
    workThreadId: `${workThreadId}_negative`,
    taskType: "implementation",
  },
  expectedCanonicalRevisionRefs: [
    ref("workthread_revision", "negative_gate_revision"),
  ],
});
assert.equal(negativeGateReady.lifecycle.state, "gate_ready");

await assert.rejects(
  runtime.requestArtifactAdmission({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    actorRef: ref("agent", "project_manager_1"),
    expectedCanonicalRevisionRefs: [
      ref("workthread_revision", "substituted_revision"),
    ],
  }),
  /epistemic_fabric_admission_revision_vector_mismatch/,
);
assert.equal(authorityCalls.length, 1);

runtime.joinMechanicalWitness({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  requirementId: "focused_test_exit",
  state: "blocked",
  evidenceRefs: [ref("mechanical_witness", "late_test_failure")],
  freshnessWitnessRef: ref("freshness_witness", "late_test_failure_fresh"),
});
assert.notEqual(
  runtime.lifecycle(negativeActivated.lifecycle.lifecycleId).state,
  "gate_ready",
);
await assert.rejects(
  runtime.requestArtifactAdmission({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    actorRef: ref("agent", "project_manager_1"),
  }),
  /epistemic_fabric_artifact_not_gate_ready/,
);
runtime.joinMechanicalWitness({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  requirementId: "focused_test_exit",
  state: "supported",
  evidenceRefs: [ref("mechanical_witness", "late_test_recovered")],
  freshnessWitnessRef: ref("freshness_witness", "late_test_recovered_fresh"),
});
const restoredGate = runtime.evaluateArtifactAssurance({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  targetAdmissionScope: negativeGateReady.gateDecision.targetAdmissionScope,
  expectedCanonicalRevisionRefs: [
    ref("workthread_revision", "negative_gate_revision"),
  ],
});
assert.equal(restoredGate.lifecycle.state, "gate_ready");
runtime.submitAuditVerdict({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  auditAssignmentId: negativeRouting.assignments[0].auditAssignmentId,
  verdict: "contradicted",
  evidenceRefs: [ref("audit_evidence", "negative_late_contradiction")],
});
assert.notEqual(
  runtime.lifecycle(negativeActivated.lifecycle.lifecycleId).state,
  "gate_ready",
);
await assert.rejects(
  runtime.requestArtifactAdmission({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    actorRef: ref("agent", "project_manager_1"),
  }),
  /epistemic_fabric_artifact_not_gate_ready/,
);
assert.equal(authorityCalls.length, 1);
const negativeRevisionTwo = runtime.publishArtifactRevision({
  lifecycleId: negativeActivated.lifecycle.lifecycleId,
  artifactId: "implementation_patch_negative",
  artifactContentRef: ref("implementation_patch_body", "negative_revision_2"),
  evidenceRefs: [ref("repository_after_digest", "negative_repository_after_2")],
  settledProperties: { governedActionClasses: ["source_mutation"] },
});
assert.equal(negativeRevisionTwo.revision.revision, 2);
assert.throws(
  () => runtime.submitAuditVerdict({
    lifecycleId: negativeActivated.lifecycle.lifecycleId,
    auditAssignmentId: negativeRouting.assignments[0].auditAssignmentId,
    verdict: "supported",
    evidenceRefs: [ref("audit_evidence", "stale_assignment_attempt")],
  }),
  /epistemic_fabric_audit_assignment_stale_or_foreign/,
);

const scopeActivated = runtime.activateImplementationPatch({
  projectId,
  workThreadId: `${workThreadId}_scope_mismatch`,
  requestRef: ref("artifact_request", "scope_mismatch_patch_request"),
  producerCandidates: [{
    agentRef: ref("agent", "implementation_worker_scope"),
    agentRunRef: ref("agent_run", "implementation_run_scope"),
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: [`ImplementationPatch:${projectId}`],
    eligibilityReceiptRef: ref("eligibility_receipt", "producer_scope_eligible"),
  }],
});
runtime.publishArtifactRevision({
  lifecycleId: scopeActivated.lifecycle.lifecycleId,
  artifactId: "implementation_patch_scope_mismatch",
  artifactContentRef: ref("implementation_patch_body", "scope_revision_1"),
  evidenceRefs: [ref("repository_after_digest", "scope_repository_after_1")],
  settledProperties: { governedActionClasses: ["source_mutation"] },
});
const scopeRouting = runtime.routeArtifactAudits({
  lifecycleId: scopeActivated.lifecycle.lifecycleId,
  auditorCandidates: [{
    ...auditor,
    agentRef: ref("agent", "review_auditor_scope"),
    agentRunRef: ref("agent_run", "review_auditor_run_scope"),
    independenceReceiptRef: ref(
      "independence_receipt",
      "reviewer_scope_distinct_from_producer",
    ),
  }],
});
for (const requirementId of ["source_digest_current", "focused_test_exit"]) {
  runtime.joinMechanicalWitness({
    lifecycleId: scopeActivated.lifecycle.lifecycleId,
    requirementId,
    state: "supported",
    evidenceRefs: [ref("mechanical_witness", `scope_${requirementId}_green`)],
    freshnessWitnessRef: ref(
      "freshness_witness",
      `scope_${requirementId}_fresh`,
    ),
  });
}
for (const assignment of scopeRouting.assignments) {
  runtime.submitAuditVerdict({
    lifecycleId: scopeActivated.lifecycle.lifecycleId,
    auditAssignmentId: assignment.auditAssignmentId,
    verdict: "supported",
    evidenceRefs: [ref("audit_evidence", `scope_${assignment.requirementId}_green`)],
  });
}
const scopeExpectedRevision = ref(
  "workthread_revision",
  "scope_before_admission",
);
runtime.evaluateArtifactAssurance({
  lifecycleId: scopeActivated.lifecycle.lifecycleId,
  targetAdmissionScope: {
    kind: "workthread",
    projectId,
    workThreadId: `${workThreadId}_scope_mismatch`,
    taskType: "implementation",
  },
  expectedCanonicalRevisionRefs: [scopeExpectedRevision],
});
scopeMismatchLifecycleId = scopeActivated.lifecycle.lifecycleId;
const scopeMismatch = await runtime.requestArtifactAdmission({
  lifecycleId: scopeActivated.lifecycle.lifecycleId,
  actorRef: ref("agent", "project_manager_1"),
  expectedCanonicalRevisionRefs: [scopeExpectedRevision],
});
assert.equal(scopeMismatch.lifecycle.state, "admission_pending");
assert.equal(scopeMismatch.receipt.admitted, false);
assert.equal(
  scopeMismatch.receipt.failureCode,
  "canonical_admission_scope_mismatch",
);
assert.equal(authorityCalls.length, 2);

const sequenceBeforeRestart =
  runtime.projection().ledgerDescriptor.globalSequence;
runtime.close();

runtime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath,
  now,
  authorityAdapter,
});
runtime.bootstrap({ projectIds: [projectId] });
const restarted = runtime.projection();
assert.equal(restarted.ledgerDescriptor.verified, true);
assert.equal(restarted.ledgerDescriptor.globalSequence, sequenceBeforeRestart);
const restartedAdmitted = restarted.lifecycleCards.find((card) =>
  card.lifecycleRef.id === lifecycleId);
assert.equal(restartedAdmitted.currentArtifactRevisionRef.id, revisionRef.id);
assert.equal(restartedAdmitted.state, "admitted");
assert.equal(restartedAdmitted.receiptBackedCanonical, true);
assert.equal(runtime.status().broker.pollingRequired, false);
runtime.close();

const controlStore = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const integratedFabric =
  new DirectWorldManagerEpistemicFabricRuntime({
    dbPath: controlStore.dbPath,
    now,
    authorityAdapter,
  });
const service = new DirectWorldManagerService({
  store: controlStore,
  epistemicFabric: integratedFabric,
  userWorldId: "user_world_local",
  projects: [{
    id: projectId,
    name: "Epistemic Fabric Fixture",
    summary: "Direct service integration fixture.",
    runtimePath: "direct",
  }],
  activeProjectId: projectId,
  now,
});
const integratedProjection = service.bootstrap().projection;
assert.equal(
  integratedProjection.epistemicFabric.schema,
  "direct_epistemic_fabric_projection@1",
);
assert.ok(
  integratedProjection.epistemicFabric.lifecycleCards.some((card) =>
    card.lifecycleRef.id === lifecycleId &&
    card.state === "admitted" &&
    card.receiptBackedCanonical === true),
);
assert.equal(service.status().epistemicFabricAvailable, true);
service.close();

// SC11.4 live seam: a challenge invalidates only contexts that depend on the
// affected ref, and a delivery advances only after its bounded context has
// been admitted to a durable semantic inbox.
const contextDependencyRef = ref(
  "worldstate_revision",
  "project_epistemic_context_revision",
);
const contextAgentRef = ref("agent", "context_project_manager");
const contextAgentRunRef = ref(
  "agent_run",
  "context_project_manager_run",
);
const contextManifest = {
  operationalMetaContextId: "operational_context_epistemic_fixture",
  digest: digestFor("operational_context", { projectId }),
  sourceRevisionRefs: [contextDependencyRef],
  pinnedPremiseRefs: [],
  dependencyRefs: [],
  agentInstantiationRef: contextAgentRef,
  agentRunRef: contextAgentRunRef,
  governedActionClasses: ["source_mutation"],
};
let contextImportCallCount = 0;
let deliveryDispatchCallCount = 0;
const contextRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: path.join(rootDir, "context-delivery.sqlite"),
  now,
  contextManifestProvider: () => [contextManifest],
  recipientResolver: () => ({
    agentRef: contextAgentRef,
    agentRunRef: contextAgentRunRef,
  }),
  visibilityResolver: ({ match }) => ({
    semanticSummary: match.rendererSafeSummary,
    visibleObjectRefs: match.affectedRefs,
    visibleEvidenceRefs: [],
    withheldEvidenceCount: 0,
  }),
  contextImporter: async ({ hydrationRequest }) => {
    contextImportCallCount += 1;
    return {
      bundleRef: ref("semantic_context_bundle", "ledger_delta_bundle"),
      operationalManifestRef: ref(
        "operational_meta_context_manifest",
        "ledger_delta_manifest",
      ),
      selectionWitnessRef: ref(
        "semantic_context_selection_witness",
        "ledger_delta_selection",
      ),
      selectedObjectRefs: hydrationRequest.requestedObjectRefs,
      selectedEvidenceRefs: hydrationRequest.requestedEvidenceRefs,
      omittedRefs: [],
      freshness: "fresh",
    };
  },
  deliveryDispatchAdapter: async () => {
    deliveryDispatchCallCount += 1;
    return { accepted: true };
  },
});
contextRuntime.bootstrap({ projectIds: [projectId] });
const contextWorkerBundle = contextRuntime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "context_worker"),
  agentWorldRef: ref("agent_world", "context_worker_world"),
  authorityBoundaryRef: ref(
    "authority_boundary",
    "context_worker_boundary",
  ),
});
const contradiction = contextRuntime.invokeLedgerTool({
  bundle: contextWorkerBundle,
  operationName: "ledger_raise_contradiction",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    objectRefs: [contextDependencyRef],
    evidenceRefs: [],
    affectsRefs: [contextDependencyRef],
    expectedRevisionVector: [],
    semanticPayload: {
      contradictionType: "source_revision_superseded",
    },
    rendererSafeSummary:
      "A dependency of an admitted operational context changed.",
    idempotencyKey: "context-contradiction-1",
  },
  visibleEvidenceRefs: [],
});
assert.equal(contradiction.append.invalidations.length, 1);
assert.equal(contextRuntime.projection().summary.staleContextCount, 1);
const contextDelivery = contextRuntime
  .projection()
  .deliveries.find((entry) => entry.deliveryPosture === "queued");
assert.ok(contextDelivery);
const contextImport = await contextRuntime.importDeliveryContext(
  contextDelivery.deliveryRef.id,
  {
    runPosture: "idle_role_resident",
    targetAgentRef: contextAgentRef,
    targetAgentRunRef: contextAgentRunRef,
  },
);
assert.equal(contextImport.admission.hydrationPosture, "imported");
assert.equal(contextImport.deliveryTransition, "delivered_to_semantic_inbox");
assert.equal(contextImport.runtimeDispatchStarted, false);
assert.equal(contextImport.wakeStarted, false);
assert.equal(contextImport.delivery.deliveryPosture, "delivered");
assert.equal(
  contextRuntime.acknowledgeDelivery(
    contextImport.delivery.deliveryId,
    { acknowledgedByRef: contextAgentRunRef },
  ).state,
  "acknowledged",
);
const replayedContextImport = await contextRuntime.importDeliveryContext(
  contextImport.delivery.deliveryId,
  {
    runPosture: "idle_role_resident",
    targetAgentRef: contextAgentRef,
    targetAgentRunRef: contextAgentRunRef,
  },
);
assert.equal(replayedContextImport.deliveryTransition, "already_delivered");
assert.equal(contextImportCallCount, 1);
assert.equal(deliveryDispatchCallCount, 0);

tick += 3_000;
contextRuntime.broker.materialityResolver = () => true;
const wakeCandidateAppend = contextRuntime.invokeLedgerTool({
  bundle: contextWorkerBundle,
  operationName: "ledger_raise_contradiction",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    objectRefs: [contextDependencyRef],
    evidenceRefs: [],
    affectsRefs: [contextDependencyRef],
    expectedRevisionVector: [],
    semanticPayload: { contradictionType: "second_revision_change" },
    rendererSafeSummary: "A second context dependency change arrived.",
    idempotencyKey: "context-contradiction-2",
  },
  visibleEvidenceRefs: [],
});
const wakeCandidateDelivery =
  wakeCandidateAppend.append.routing.deliveries[0];
const suspension = buildAgentSuspensionState({
  suspensionId: "context_project_manager_suspension",
  agentId: contextAgentRef.id,
  agentRunId: contextAgentRunRef.id,
  reason: "awaiting_external_event",
  awaitingWorkIds: [],
  continuationContractRef: ref(
    "continuation_contract",
    "context_delivery_continuation",
  ),
  status: "active",
}, { now });
const acceptedDispatch = await contextRuntime.importDeliveryContext(
  wakeCandidateDelivery.deliveryId,
  {
    runPosture: "suspended",
    targetAgentRef: contextAgentRef,
    targetAgentRunRef: contextAgentRunRef,
    suspension,
  },
);
assert.equal(acceptedDispatch.dispatch.disposition, "continuation_ready");
assert.equal(acceptedDispatch.runtimeDispatchStarted, true);
assert.equal(acceptedDispatch.wakeStarted, false);
assert.equal(contextImportCallCount, 2);
assert.equal(deliveryDispatchCallCount, 1);
const replayedAcceptedDispatch = await contextRuntime.importDeliveryContext(
  wakeCandidateDelivery.deliveryId,
  {
    runPosture: "suspended",
    targetAgentRef: contextAgentRef,
    targetAgentRunRef: contextAgentRunRef,
    suspension,
  },
);
assert.equal(replayedAcceptedDispatch.deliveryTransition, "already_delivered");
assert.equal(contextImportCallCount, 2);
assert.equal(deliveryDispatchCallCount, 1);

// Simulate the append/invalidation persistence crash window. The immutable
// ledger remains; bootstrap must deterministically reconstruct both notices.
contextRuntime.artifactState.contextInvalidations = [];
contextRuntime.persistArtifacts();
contextRuntime.close();
const reconciledContextRuntime =
  new DirectWorldManagerEpistemicFabricRuntime({
    dbPath: path.join(rootDir, "context-delivery.sqlite"),
    now,
    contextManifestProvider: () => [contextManifest],
  });
reconciledContextRuntime.bootstrap({ projectIds: [projectId] });
assert.equal(
  reconciledContextRuntime.projection().summary.staleContextCount,
  2,
);
reconciledContextRuntime.close();

// Without a main-owned IMPORT_CONTEXT adapter the same operation remains
// retryable and cannot be acknowledged as though delivery had occurred.
const pendingRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: path.join(rootDir, "pending-context-delivery.sqlite"),
  now,
  recipientResolver: () => ({
    agentRef: contextAgentRef,
    agentRunRef: contextAgentRunRef,
  }),
});
pendingRuntime.bootstrap({ projectIds: [projectId] });
const pendingBundle = pendingRuntime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "pending_context_worker"),
  agentWorldRef: ref("agent_world", "pending_context_worker_world"),
  authorityBoundaryRef: ref(
    "authority_boundary",
    "pending_context_worker_boundary",
  ),
});
const pendingAppend = pendingRuntime.invokeLedgerTool({
  bundle: pendingBundle,
  operationName: "ledger_raise_contradiction",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    objectRefs: [contextDependencyRef],
    evidenceRefs: [],
    affectsRefs: [contextDependencyRef],
    expectedRevisionVector: [],
    semanticPayload: {},
    rendererSafeSummary: "Pending context delivery fixture.",
    idempotencyKey: "pending-context-contradiction-1",
  },
  visibleEvidenceRefs: [],
});
const pendingDelivery = pendingAppend.append.routing.deliveries[0];
const pendingImport = await pendingRuntime.importDeliveryContext(
  pendingDelivery.deliveryId,
  {
    runPosture: "idle_role_resident",
    targetAgentRef: contextAgentRef,
    targetAgentRunRef: contextAgentRunRef,
  },
);
assert.equal(pendingImport.admission.hydrationPosture, "pending");
assert.equal(pendingImport.delivery.deliveryPosture, "queued");
assert.equal(pendingImport.deliveryTransition, "queued_awaiting_context");
assert.throws(
  () => pendingRuntime.acknowledgeDelivery(pendingDelivery.deliveryId),
  /epistemic_fabric_delivery_not_delivered/,
);
pendingRuntime.close();

// SC11.3 production seam: ordinary matching events remain durably pending
// during one bounded debounce window, then coalesce into one exact delivery.
const debounceRootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-epistemic-debounce-"),
);
const debounceDbPath = path.join(
  debounceRootDir,
  "world-manager-epistemic-ledger.sqlite",
);
const scheduledFlushes = [];
const cancelledFlushes = [];
const debounceScheduler = {
  schedule(callback, delayMs) {
    const task = { callback, delayMs, cancelled: false };
    scheduledFlushes.push(task);
    return task;
  },
  cancel(task) {
    task.cancelled = true;
    cancelledFlushes.push(task);
  },
};
const debounceRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: debounceDbPath,
  now,
  scheduler: debounceScheduler,
});
debounceRuntime.bootstrap({ projectIds: [projectId] });
const debounceStanding = buildNotificationStanding({
  standingId: `project_manager_debounce:${projectId}`,
  subscriberRoleRef: ref("role_instance", "project_manager_debounce"),
  subscriberScope: {
    kind: "project",
    userWorldId: "user_world_local",
    projectId,
  },
  sourceStreamPatterns: [`project:${projectId}`],
  eventActTypeRefs: [],
  epistemicPostures: ["observed", "challenged"],
  objectScopeRefs: [],
  materialityPredicateRef: ref(
    "materiality_policy",
    "project_manager_debounce",
  ),
  deliveryPolicy: "safe_boundary",
  wakePolicy: "never",
  coalescingPolicyRef: ref("coalescing_policy", "semantic_scope"),
  evidenceVisibilityPolicyRef: ref(
    "evidence_visibility_policy",
    "project_bounded",
  ),
  operationalPolicy: {
    debounceWindowMs: 250,
    maximumEventsPerDelivery: 24,
    maximumPendingEvents: 256,
    maximumQueuedDeliveries: 64,
    maximumWakeFrequencyMs: 2_000,
    priorityThreshold: "normal",
    coalescingKey: "semantic_scope",
    supersessionBehavior: "latest_per_object",
  },
  revision: 1,
}, { now });
debounceRuntime.broker.registerStanding(debounceStanding);
debounceRuntime.persistBroker();
const debounceBundle = debounceRuntime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "debounce_worker"),
  agentWorldRef: ref("agent_world", "debounce_worker_world"),
  authorityBoundaryRef: ref(
    "authority_boundary",
    "debounce_worker_boundary",
  ),
});
function debounceAppend(idempotencyKey, objectId) {
  return debounceRuntime.invokeLedgerTool({
    bundle: debounceBundle,
    operationName: "ledger_publish_observation",
    arguments: {
      subjectScope: {
        kind: "project",
        userWorldId: "user_world_local",
        projectId,
      },
      objectRefs: [ref("debounce_object", objectId)],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: { observation: objectId },
      rendererSafeSummary: `Debounce observation ${objectId}.`,
      idempotencyKey,
    },
    visibleEvidenceRefs: [],
  });
}
const firstDebounceAppend = debounceAppend("debounce-observation-1", "one");
assert.equal(firstDebounceAppend.append.routing.deliveries.length, 0);
assert.equal(scheduledFlushes.length, 1);
assert.equal(debounceRuntime.status().pendingFlushScheduled, true);
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries().length,
  1,
);
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries()[0].dispatchState,
  "pending",
);
const secondDebounceAppend = debounceAppend("debounce-observation-2", "two");
assert.equal(secondDebounceAppend.append.routing.deliveries.length, 0);
assert.equal(scheduledFlushes.length, 1, "only one runtime timer is pending");
assert.equal(debounceRuntime.broker.pending.size, 1);
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries().length,
  2,
);
tick += 300;
scheduledFlushes[0].callback();
const debounceDeliveries = [
  ...debounceRuntime.broker.deliveries.values(),
].filter((delivery) =>
  delivery.subscriptionRef.id === debounceStanding.standingId);
assert.equal(debounceDeliveries.length, 1);
assert.deepEqual(
  debounceDeliveries[0].eventRefs.map((eventRef) => eventRef.id),
  [
    firstDebounceAppend.append.event.ledgerEventId,
    secondDebounceAppend.append.event.ledgerEventId,
  ],
);
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries().length,
  0,
);
const dispatchedDebounceSeeds = debounceRuntime.ledgerStore.listOutboxEntries({
  dispatchState: "dispatched",
}).filter((entry) => entry.seed.subscriptionRef.id === debounceStanding.standingId);
assert.equal(dispatchedDebounceSeeds.length, 2);
for (const entry of dispatchedDebounceSeeds) {
  assert.deepEqual(entry.deliveryRef, {
    kind: "ledger_delivery",
    id: debounceDeliveries[0].deliveryId,
    digest: debounceDeliveries[0].deliveryDigest,
  });
}
// The production standing uses latest-per-object supersession for the bounded
// projection, while the delivery retains both exact event refs so neither
// durable outbox seed is stranded.
const sameObjectFirst = debounceAppend("debounce-same-object-1", "same");
const sameObjectSecond = debounceAppend("debounce-same-object-2", "same");
assert.equal(scheduledFlushes.length, 2);
tick += 300;
scheduledFlushes.at(-1).callback();
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries()
    .filter((entry) => entry.seed.subscriptionRef.id === debounceStanding.standingId)
    .length,
  0,
);
const sameObjectDeliveries = [...debounceRuntime.broker.deliveries.values()]
  .filter((delivery) => delivery.subscriptionRef.id === debounceStanding.standingId)
  .filter((delivery) => delivery.eventRefs.some((eventRef) =>
    eventRef.id === sameObjectFirst.append.event.ledgerEventId ||
    eventRef.id === sameObjectSecond.append.event.ledgerEventId));
assert.equal(sameObjectDeliveries.length, 1);
assert.deepEqual(
  sameObjectDeliveries[0].eventRefs.map((eventRef) => eventRef.id)
    .sort((left, right) => left.localeCompare(right)),
  [
    sameObjectFirst.append.event.ledgerEventId,
    sameObjectSecond.append.event.ledgerEventId,
  ].sort((left, right) => left.localeCompare(right)),
);
assert.equal(sameObjectDeliveries[0].boundedProjection.eventCount, 1);
const pendingBeforeBypass = debounceAppend("debounce-before-bypass", "queued");
assert.equal(scheduledFlushes.length, 3);
const immediateDebounceAppend = debounceRuntime.invokeLedgerTool({
  bundle: debounceBundle,
  operationName: "ledger_raise_contradiction",
  arguments: {
    subjectScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    objectRefs: [ref("debounce_object", "urgent")],
    evidenceRefs: [],
    affectsRefs: [],
    expectedRevisionVector: [],
    semanticPayload: { contradictionType: "urgent_fixture" },
    rendererSafeSummary: "Urgent debounce bypass fixture.",
    idempotencyKey: "debounce-urgent-1",
  },
  visibleEvidenceRefs: [],
});
const immediateDebounceDeliveries =
  immediateDebounceAppend.append.routing.deliveries.filter((delivery) =>
    delivery.subscriptionRef.id === debounceStanding.standingId);
assert.equal(immediateDebounceDeliveries.length, 1);
assert.deepEqual(
  immediateDebounceDeliveries[0].eventRefs.map((eventRef) => eventRef.id)
    .sort((left, right) => left.localeCompare(right)),
  [
    pendingBeforeBypass.append.event.ledgerEventId,
    immediateDebounceAppend.append.event.ledgerEventId,
  ].sort((left, right) => left.localeCompare(right)),
);
assert.equal(
  debounceRuntime.ledgerStore.listPendingOutboxEntries().length,
  0,
  "an immediate flush also reconciles earlier buffered seeds",
);
assert.equal(debounceRuntime.status().pendingFlushScheduled, false);
const cancelledAppend = debounceAppend("debounce-observation-3", "three");
assert.equal(cancelledAppend.append.routing.deliveries.length, 0);
assert.equal(scheduledFlushes.length, 4);
const cancelledTask = scheduledFlushes.at(-1);
debounceRuntime.close();
assert.equal(cancelledTask.cancelled, true);
assert.equal(cancelledFlushes.length, 2);
assert.equal(scheduledFlushes[2].cancelled, true);
// A callback already queued by the host after close is harmless and cannot
// flush or reopen the closed runtime.
cancelledTask.callback();
const restartedDebounceRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: debounceDbPath,
  now,
  scheduler: debounceScheduler,
});
restartedDebounceRuntime.bootstrap({ projectIds: [projectId] });
assert.equal(
  restartedDebounceRuntime.ledgerStore.listPendingOutboxEntries().length,
  0,
);
assert.ok([...restartedDebounceRuntime.broker.deliveries.values()].some((delivery) =>
  delivery.eventRefs.some((eventRef) =>
    eventRef.id === cancelledAppend.append.event.ledgerEventId)));
restartedDebounceRuntime.close();
fs.rmSync(debounceRootDir, { recursive: true, force: true });

// A newly created pending group can have an earlier deadline than the timer
// installed for an older group. The runtime keeps one timer, cancels the
// later timer, and delivers the earlier group without waiting past its own
// debounce window.
const deadlineRootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-epistemic-deadline-")
);
const deadlineDbPath = path.join(
  deadlineRootDir,
  "world-manager-epistemic-ledger.sqlite",
);
const deadlineScheduled = [];
const deadlineCancelled = [];
const deadlineScheduler = {
  schedule(callback, delayMs) {
    const task = { callback, delayMs, cancelled: false };
    deadlineScheduled.push(task);
    return task;
  },
  cancel(task) {
    task.cancelled = true;
    deadlineCancelled.push(task);
  },
};
const deadlineRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: deadlineDbPath,
  now,
  scheduler: deadlineScheduler,
});
deadlineRuntime.bootstrap({ projectIds: [] });
function deadlineStanding(standingId, objectId, debounceWindowMs) {
  return buildNotificationStanding({
    standingId,
    subscriberRoleRef: ref("role_instance", standingId),
    subscriberScope: {
      kind: "project",
      userWorldId: "user_world_local",
      projectId,
    },
    sourceStreamPatterns: [`project:${projectId}`],
    eventActTypeRefs: [],
    epistemicPostures: ["observed"],
    objectScopeRefs: [ref("deadline_object", objectId)],
    materialityPredicateRef: ref("materiality_policy", standingId),
    deliveryPolicy: "safe_boundary",
    wakePolicy: "never",
    coalescingPolicyRef: ref("coalescing_policy", standingId),
    evidenceVisibilityPolicyRef: ref(
      "evidence_visibility_policy",
      "project_bounded",
    ),
    operationalPolicy: {
      debounceWindowMs,
      maximumEventsPerDelivery: 24,
      maximumPendingEvents: 256,
      maximumQueuedDeliveries: 64,
      maximumWakeFrequencyMs: 2_000,
      priorityThreshold: "normal",
      coalescingKey: "subscription",
      supersessionBehavior: "retain_all",
    },
    revision: 1,
  }, { now });
}
const longDeadlineStanding = deadlineStanding(
  "deadline_long",
  "long",
  1_000,
);
const earlyDeadlineStanding = deadlineStanding(
  "deadline_early",
  "early",
  100,
);
deadlineRuntime.broker.registerStanding(longDeadlineStanding);
deadlineRuntime.broker.registerStanding(earlyDeadlineStanding);
deadlineRuntime.persistBroker();
const deadlineBundle = deadlineRuntime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "deadline_worker"),
  agentWorldRef: ref("agent_world", "deadline_worker_world"),
  authorityBoundaryRef: ref(
    "authority_boundary",
    "deadline_worker_boundary",
  ),
});
function deadlineAppend(idempotencyKey, objectId) {
  return deadlineRuntime.invokeLedgerTool({
    bundle: deadlineBundle,
    operationName: "ledger_publish_observation",
    arguments: {
      subjectScope: {
        kind: "project",
        userWorldId: "user_world_local",
        projectId,
      },
      objectRefs: [ref("deadline_object", objectId)],
      evidenceRefs: [],
      affectsRefs: [],
      expectedRevisionVector: [],
      semanticPayload: { observation: objectId },
      rendererSafeSummary: `Deadline observation ${objectId}.`,
      idempotencyKey,
    },
    visibleEvidenceRefs: [],
  });
}
const longDeadlineAppend = deadlineAppend("deadline-long-1", "long");
assert.equal(longDeadlineAppend.append.routing.deliveries.length, 0);
assert.equal(deadlineRuntime.broker.pending.size, 1);
assert.equal(deadlineScheduled.length, 1);
const firstDeadlineTask = deadlineScheduled[0];
const earlyDeadlineAppend = deadlineAppend("deadline-early-1", "early");
assert.equal(earlyDeadlineAppend.append.routing.deliveries.length, 0);
assert.equal(deadlineRuntime.broker.pending.size, 2);
assert.equal(deadlineScheduled.length, 2);
assert.equal(deadlineCancelled.length, 1);
assert.equal(deadlineCancelled[0], firstDeadlineTask);
assert.equal(firstDeadlineTask.cancelled, true);
assert.ok(
  deadlineScheduled[1].delayMs < firstDeadlineTask.delayMs,
  "an earlier pending deadline must reschedule the sole runtime timer",
);
assert.equal(
  deadlineRuntime.ledgerStore.listPendingOutboxEntries().length,
  2,
);
tick += 200;
deadlineScheduled[1].callback();
const earlyDeadlineDeliveries = [
  ...deadlineRuntime.broker.deliveries.values(),
].filter((delivery) =>
  delivery.subscriptionRef.id === earlyDeadlineStanding.standingId);
const longDeadlineDeliveries = [
  ...deadlineRuntime.broker.deliveries.values(),
].filter((delivery) =>
  delivery.subscriptionRef.id === longDeadlineStanding.standingId);
assert.equal(earlyDeadlineDeliveries.length, 1);
assert.equal(longDeadlineDeliveries.length, 0);
assert.deepEqual(
  earlyDeadlineDeliveries[0].eventRefs.map((eventRef) => eventRef.id),
  [earlyDeadlineAppend.append.event.ledgerEventId],
);
assert.equal(
  deadlineRuntime.ledgerStore.listPendingOutboxEntries().length,
  1,
  "the long-window seed remains pending until its exact delivery exists",
);
assert.equal(deadlineScheduled.length, 3);
assert.equal(deadlineScheduled[2].cancelled, false);
tick += 1_000;
deadlineScheduled[2].callback();
const completedLongDeadlineDeliveries = [
  ...deadlineRuntime.broker.deliveries.values(),
].filter((delivery) =>
  delivery.subscriptionRef.id === longDeadlineStanding.standingId);
assert.equal(completedLongDeadlineDeliveries.length, 1);
assert.deepEqual(
  completedLongDeadlineDeliveries[0].eventRefs.map((eventRef) => eventRef.id),
  [longDeadlineAppend.append.event.ledgerEventId],
);
assert.equal(deadlineRuntime.ledgerStore.listPendingOutboxEntries().length, 0);
deadlineRuntime.close();
assert.equal(deadlineRuntime.pendingFlushTimer, null);
fs.rmSync(deadlineRootDir, { recursive: true, force: true });

// SC11.5 backpressure seam: an expired pending debounce group must not spin
// zero-delay timers while a subscription queue is full.  Releasing capacity
// through the real delivery transition wakes the group exactly once.
const pressureRootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-epistemic-backpressure-"),
);
const pressureDbPath = path.join(
  pressureRootDir,
  "world-manager-epistemic-ledger.sqlite",
);
let pressureTick = Date.parse("2026-08-01T16:00:00.000Z");
const pressureNow = () => pressureTick;
const pressureScheduled = [];
const pressureCancelled = [];
const pressureScheduler = {
  schedule(callback, delayMs) {
    const task = { callback, delayMs, cancelled: false };
    pressureScheduled.push(task);
    return task;
  },
  cancel(task) {
    task.cancelled = true;
    pressureCancelled.push(task);
  },
};
const pressureAgentRef = ref("agent", "pressure_project_manager");
const pressureRuntime = new DirectWorldManagerEpistemicFabricRuntime({
  dbPath: pressureDbPath,
  now: pressureNow,
  scheduler: pressureScheduler,
  contextImporter: async ({ hydrationRequest }) => ({
    bundleRef: ref("semantic_context_bundle", "pressure_bundle"),
    operationalManifestRef: ref("operational_meta_context_manifest", "pressure_manifest"),
    selectionWitnessRef: ref("semantic_context_selection_witness", "pressure_selection"),
    selectedObjectRefs: hydrationRequest.requestedObjectRefs,
    selectedEvidenceRefs: hydrationRequest.requestedEvidenceRefs,
    omittedRefs: [],
    freshness: "fresh",
  }),
});
pressureRuntime.bootstrap({ projectIds: [] });
const pressureStanding = buildNotificationStanding({
  standingId: `project_manager_pressure:${projectId}`,
  subscriberRoleRef: ref("role_instance", "pressure_project_manager"),
  subscriberScope: { kind: "project", userWorldId: "user_world_local", projectId },
  sourceStreamPatterns: [`project:${projectId}`],
  eventActTypeRefs: [],
  epistemicPostures: ["observed", "challenged"],
  objectScopeRefs: [],
  materialityPredicateRef: ref("materiality_policy", "pressure_materiality"),
  deliveryPolicy: "safe_boundary",
  wakePolicy: "never",
  coalescingPolicyRef: ref("coalescing_policy", "pressure_scope"),
  evidenceVisibilityPolicyRef: ref("evidence_visibility_policy", "project_bounded"),
  operationalPolicy: {
    debounceWindowMs: 250,
    maximumEventsPerDelivery: 24,
    maximumPendingEvents: 256,
    maximumQueuedDeliveries: 1,
    maximumWakeFrequencyMs: 2_000,
    priorityThreshold: "normal",
    coalescingKey: "subscription",
    supersessionBehavior: "retain_all",
  },
  revision: 1,
}, { now: pressureNow });
pressureRuntime.broker.registerStanding(pressureStanding);
pressureRuntime.persistBroker();
const pressureBundle = pressureRuntime.compileRoleTools({
  roleLane: "implementation_worker",
  projectId,
  actorRef: ref("agent", "pressure_worker"),
  agentWorldRef: ref("agent_world", "pressure_worker_world"),
  authorityBoundaryRef: ref("authority_boundary", "pressure_worker_boundary"),
});
const pressureAppend = (operationName, idempotencyKey, objectId) => pressureRuntime.invokeLedgerTool({
  bundle: pressureBundle,
  operationName,
  arguments: {
    subjectScope: { kind: "project", userWorldId: "user_world_local", projectId },
    objectRefs: [ref("pressure_object", objectId)],
    evidenceRefs: [],
    affectsRefs: [],
    expectedRevisionVector: [],
    semanticPayload: { observation: objectId },
    rendererSafeSummary: `Pressure observation ${objectId}.`,
    idempotencyKey,
  },
  visibleEvidenceRefs: [],
});
const occupied = pressureAppend("ledger_raise_contradiction", "pressure-occupied", "occupied");
const occupiedDelivery = occupied.append.routing.deliveries.find((delivery) =>
  delivery.subscriptionRef.id === pressureStanding.standingId);
assert.ok(occupiedDelivery, "first pressure event should occupy the delivery queue");
const blocked = pressureAppend("ledger_publish_observation", "pressure-blocked", "blocked");
assert.equal(blocked.append.routing.deliveries.length, 0);
assert.equal(pressureScheduled.length, 1);
pressureTick += 300;
const blockedTimer = pressureScheduled[0];
blockedTimer.callback();
assert.equal(pressureScheduled.length, 2, "backpressure retry should use one bounded timer");
assert(pressureScheduled[1].delayMs > 0, "backpressure retry must not reschedule at zero delay");
assert.equal(pressureRuntime.broker.pending.size, 1, "pending match must survive queue backpressure");
await pressureRuntime.importDeliveryContext(occupiedDelivery.deliveryId);
assert.equal(pressureRuntime.broker.deliveries.get(occupiedDelivery.deliveryId).deliveryPosture, "delivered");
assert.equal(pressureScheduled.length, 3, "delivery transition should wake the pending group");
assert.equal(pressureScheduled[2].delayMs, 0, "capacity release should be event-driven");
pressureScheduled[2].callback();
const pressureDeliveries = [...pressureRuntime.broker.deliveries.values()].filter((delivery) =>
  delivery.subscriptionRef.id === pressureStanding.standingId);
assert.equal(pressureDeliveries.length, 2, "pending group should flush exactly once after release");
assert.equal(pressureRuntime.broker.pending.size, 0);
pressureRuntime.close();
fs.rmSync(pressureRootDir, { recursive: true, force: true });

fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  schema: "direct_world_manager_epistemic_fabric_regression@1",
  status: "passed",
  roleCompiledLedgerTools: true,
  durableAppendAndDelivery: true,
  implementationPatchLifecycle: true,
  independentAuditRouting: true,
  mechanicalAndSemanticAssuranceJoin: true,
  gateReadyDistinctFromAdmission: true,
  externalAuthorityReceiptRequired: true,
  gateInvalidationRevokesAdmissionEligibility: true,
  postGateEvidenceRevokesEligibilitySynchronously: true,
  gateTimeCanonicalRevisionVectorPinned: true,
  authorityResultScopeMustMatchGate: true,
  staleAuditAssignmentRejected: true,
  admittedProjectionReceiptBacked: true,
  restartPreservesExactLineage: true,
  worldManagerServiceProjectionIntegrated: true,
  dependencyInvalidationProjected: true,
  exactDeliveryContextImported: true,
  durableSemanticInboxTruthful: true,
  unavailableContextImporterFailsClosed: true,
  queuedDeliveryCannotBeAcknowledged: true,
  completedDeliveryImportIdempotent: true,
  wakeRequiresAdapterConfirmation: true,
  restartRebuildsDerivedInvalidations: true,
  productionDebounceScheduling: true,
  productionEligibleEventsCoalesced: true,
  productionOutboxSeedsReconciled: true,
  productionImmediateBypass: true,
  productionCloseRestartRecovery: true,
  pollingRequired: false,
}, null, 2));
