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
  pollingRequired: false,
}, null, 2));
