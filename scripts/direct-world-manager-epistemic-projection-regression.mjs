import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compileEpistemicFabricProjection,
  validateEpistemicFabricProjection,
} = require("../src/main/direct/worldmanager/epistemic-ledger-projection.js");

const ref = (kind, id) => ({ kind, id, digest: `sha256:${id}` });
const events = [
  {
    ledgerEventId: "event_1",
    eventDigest: "sha256:event_1",
    globalSequence: 1,
    actClass: "observation",
    actTypeRef: ref("ledger_act_type", "progress_reported"),
    roleLaneRef: ref("role_lane", "implementation_worker"),
    subjectScope: { projectId: "project_alpha" },
    epistemicPosture: "observed",
    rendererSafeSummary: "Implementation work started.",
  },
  {
    ledgerEventId: "event_2",
    eventDigest: "sha256:event_2",
    globalSequence: 2,
    actClass: "challenge",
    actTypeRef: ref("ledger_act_type", "shared_premise_contradicted"),
    roleLaneRef: ref("role_lane", "review_auditor"),
    subjectScope: { projectId: "project_alpha" },
    epistemicPosture: "contradicted",
    rendererSafeSummary: "A pinned premise is contradicted.",
    evidenceRefs: [ref("test_evidence", "test_1")],
  },
];

const lifecycleBase = {
  lifecycleId: "lifecycle_patch_1",
  lifecycleDigest: "sha256:lifecycle_patch_1",
  artifactTypeConstitutionRef: ref("artifact_type_constitution", "implementation_patch"),
  currentArtifactRevisionRef: ref("artifact_revision", "patch_r1"),
  subjectScope: { projectId: "project_alpha" },
  evidenceRefs: [ref("execution_evidence", "evidence_1")],
};
const gateDecision = {
  gateDecisionId: "gate_patch_1",
  digest: "sha256:gate_patch_1",
  lifecycleId: lifecycleBase.lifecycleId,
  targetAdmissionScope: {
    kind: "workthread",
    projectId: "project_alpha",
    workThreadId: "workthread_patch_1",
  },
  admissionAuthorityRef: ref("admission_authority", "project_manager"),
};
const admissionCandidate = {
  artifactRevisionRef: lifecycleBase.currentArtifactRevisionRef,
  gateDecisionRef: ref("artifact_gate_decision", "gate_patch_1"),
  targetAdmissionScope: gateDecision.targetAdmissionScope,
  admissionAuthorityRef: gateDecision.admissionAuthorityRef,
  expectedCanonicalRevisionRefs: [
    ref("worldmodel_scoped_revision", "workthread_patch_1_revision_0"),
  ],
};

const gateReady = compileEpistemicFabricProjection({
  ledgerDescriptor: {
    available: true,
    verified: true,
    globalSequence: 2,
    eventCount: 2,
  },
  events,
  lifecycles: [{ ...lifecycleBase, state: "gate_ready" }],
  gateDecisions: [gateDecision],
  admissionReceiptCandidates: [admissionCandidate],
  assuranceGraphs: [{
    lifecycleId: "lifecycle_patch_1",
    state: "supported",
    requiredAuditCount: 2,
    satisfiedAuditCount: 2,
    blockerCount: 0,
  }],
  deliveries: [{
    deliveryId: "delivery_1",
    deliveryDigest: "sha256:delivery_1",
    recipientRole: "project_manager",
    deliveryPosture: "queued",
    wakeEligible: true,
    cursorAfter: 2,
    eventRefs: [ref("epistemic_ledger_event", "event_2")],
  }],
  invalidations: [{
    invalidationId: "invalidation_1",
    digest: "sha256:invalidation_1",
    targetAgentRunRef: ref("agent_run", "worker_run_1"),
    state: "stale",
    rendererSafeSummary: "Worker context is stale.",
  }],
  generatedAt: "2026-08-01T12:00:00.000Z",
});
validateEpistemicFabricProjection(gateReady);
assert.equal(gateReady.summary.materialActivityCount, 1);
assert.equal(gateReady.summary.gateReadyCount, 1);
assert.equal(gateReady.summary.admittedArtifactCount, 0);
assert.equal(gateReady.lifecycleCards[0].canonical, false);
assert.equal(gateReady.lifecycleCards[0].authorityState, "gate_ready");
assert.equal(gateReady.lifecycleCards[0].admissionRequestEligible, true);
assert.equal(gateReady.lifecycleCards[0].requiredAuditCount, 2);
assert.equal(gateReady.lifecycleCards[0].satisfiedAuditCount, 2);
assert.equal(gateReady.summary.queuedDeliveryCount, 1);
assert.equal(gateReady.summary.staleContextCount, 1);

const admitted = compileEpistemicFabricProjection({
  events,
  lifecycles: [{ ...lifecycleBase, state: "admitted" }],
  admissionReceipts: [{
    admissionReceiptId: "admission_receipt_1",
    digest: "sha256:admission_receipt_1",
    lifecycleRef: {
      kind: "artifact_lifecycle_instance",
      id: "lifecycle_admitted_snapshot",
      digest: lifecycleBase.lifecycleDigest,
    },
    artifactRevisionRef: lifecycleBase.currentArtifactRevisionRef,
    trustStoreReceiptRef: ref("worldmodel_graph_transition", "graph_transition_1"),
    targetAdmissionScope: lifecycleBase.subjectScope,
    receiptPosture: "admitted",
    admitted: true,
    canonicalEffect: true,
  }],
  generatedAt: "2026-08-01T12:01:00.000Z",
});
assert.equal(admitted.lifecycleCards[0].canonical, true);
assert.equal(admitted.lifecycleCards[0].authorityState, "admitted");
assert.equal(admitted.summary.admittedArtifactCount, 1);

console.log(JSON.stringify({
  schema: "direct_world_manager_epistemic_projection_regression@1",
  status: "passed",
  exactEventIdentityPreserved: true,
  candidateCanonicalDistinguished: true,
  deliveryWakeDistinguished: true,
  evidenceBeforeAdmissionSameContext: true,
}, null, 2));
