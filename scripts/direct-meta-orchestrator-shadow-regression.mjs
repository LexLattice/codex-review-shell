#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAuditArtifact,
  buildImplementationEvidenceArtifact,
  buildMetaOrchestratorPlanPointer,
  buildMetaOrchestratorStepEvent,
  buildMetaOrchestratorTransitionGate,
  validateAuditArtifact,
  validateImplementationEvidenceArtifact,
  validateMetaOrchestratorPlanPointer,
  validateMetaOrchestratorStepEvent,
  validateMetaOrchestratorTransitionGate,
} = require("../src/main/direct/bridge/meta-orchestrator-shadow");
const { sha256 } = require("../src/main/direct/governance/broker");

const nowMs = Date.parse("2026-06-13T14:00:00.000Z");
const projectId = "project_meta_orchestrator_fixture";
const workThreadId = "work_thread_meta_orchestrator_fixture";
const planId = "plan_meta_orchestrator_fixture";
const implementationStepId = "step_implementation_fixture";

const implementationPlanPointer = buildMetaOrchestratorPlanPointer({
  projectId,
  workThreadId,
  planId,
  currentStepId: implementationStepId,
  currentStepOrdinal: 3,
  expectedArtifactClass: "implementation_evidence_artifact",
  expectedProducerRole: "implementation_worker",
  auditorRole: "audit_worker",
  evidenceRefs: [{
    kind: "plan_contract",
    artifactId: "plan_contract_fixture",
    artifactDigest: sha256("plan_contract_fixture"),
    sourceConfidence: "accepted",
    rendererSafeLabel: "Plan contract",
  }],
}, { nowMs });
validateMetaOrchestratorPlanPointer(implementationPlanPointer);
assert.equal(implementationPlanPointer.metaPerformsObjectLevelAudit, false);
assert.equal(implementationPlanPointer.autonomousContinuationAllowed, false);
assert.equal(implementationPlanPointer.providerCallAllowed, false);

const stepStarted = buildMetaOrchestratorStepEvent({
  projectId,
  workThreadId,
  planId,
  stepId: implementationStepId,
  eventKind: "implementation_step_started",
  producerRole: "meta_orchestrator",
  declaredScope: "Start implementation worker step; do not audit object-level validity here.",
}, { nowMs });
validateMetaOrchestratorStepEvent(stepStarted);
assert.equal(stepStarted.metaPerformsObjectLevelAudit, false);

const implementationEvidence = buildImplementationEvidenceArtifact({
  projectId,
  workThreadId,
  planId,
  stepId: implementationStepId,
  workerThreadId: "direct_worker_fixture",
  workerStartTransitionId: "worker_start_fixture",
  statusClaim: "completed",
  intentContractRef: {
    artifactClass: "intent_contract",
    artifactId: "intent_contract_fixture",
    artifactDigest: sha256("intent_contract_fixture"),
    producerRole: "meta_orchestrator",
  },
  changedFileRefs: [{
    kind: "changed_file",
    artifactId: "src/main/direct/example.js",
    artifactDigest: sha256("changed_file_fixture"),
    sourceConfidence: "diagnostic",
    rendererSafeLabel: "Changed file ref",
  }],
  testEvidenceRefs: [{
    kind: "test_evidence",
    artifactId: "direct:meta-orchestrator-shadow",
    artifactDigest: sha256("test_evidence_fixture"),
    sourceConfidence: "accepted",
    rendererSafeLabel: "Regression test",
  }],
  scopeDeclaration: "Implementation evidence artifact for one step.",
  unresolvedIssues: ["Residual manual testing remains out of scope."],
  workerNotesPreview: "Worker claims the implementation step is complete.",
}, { nowMs });
validateImplementationEvidenceArtifact(implementationEvidence);
assert.equal(implementationEvidence.evidenceValidityCertified, false);
assert.equal(implementationEvidence.objectLevelAuditPerformed, false);

const evidenceSubmitted = buildMetaOrchestratorStepEvent({
  projectId,
  workThreadId,
  planId,
  stepId: implementationStepId,
  eventKind: "implementation_evidence_submitted",
  producerRole: "implementation_worker",
  artifactRefs: [{
    artifactClass: implementationEvidence.artifactClass,
    artifactId: implementationEvidence.artifactId,
    artifactDigest: implementationEvidence.artifactDigest,
    producerRole: implementationEvidence.producerRole,
    stepId: implementationEvidence.stepId,
  }],
}, { nowMs });
validateMetaOrchestratorStepEvent(evidenceSubmitted);

const evidenceGate = buildMetaOrchestratorTransitionGate({
  planPointer: implementationPlanPointer,
  artifact: implementationEvidence,
}, { nowMs });
validateMetaOrchestratorTransitionGate(evidenceGate);
assert.equal(evidenceGate.gateState, "routable_accepted");
assert.equal(evidenceGate.transitionAction, "route_to_auditor");
assert.equal(evidenceGate.routeToAuditor, true);
assert.equal(evidenceGate.objectLevelValidityJudgedByMeta, false);
assert.equal(evidenceGate.objectLevelValidityCertifiedByAuditor, false);
assert.equal(evidenceGate.providerCallAllowed, false);
assert.equal(evidenceGate.autonomousContinuationAllowed, false);

const auditPlanPointer = buildMetaOrchestratorPlanPointer({
  projectId,
  workThreadId,
  planId,
  currentStepId: implementationStepId,
  currentStepOrdinal: 4,
  expectedArtifactClass: "audit_artifact",
  expectedProducerRole: "audit_worker",
  auditorRole: "audit_worker",
}, { nowMs });
validateMetaOrchestratorPlanPointer(auditPlanPointer);

const auditArtifact = buildAuditArtifact({
  projectId,
  workThreadId,
  planId,
  stepId: implementationStepId,
  auditorThreadId: "direct_audit_worker_fixture",
  reviewedArtifactRef: {
    artifactClass: implementationEvidence.artifactClass,
    artifactId: implementationEvidence.artifactId,
    artifactDigest: implementationEvidence.artifactDigest,
    producerRole: implementationEvidence.producerRole,
    stepId: implementationEvidence.stepId,
  },
  verdictClass: "green",
  fulfilledIntentContract: "yes",
  evidenceValidity: "valid_for_intent_contract",
  advancementRecommendation: "advance",
  residualRisks: ["Manual UI smoke still optional."],
}, { nowMs });
validateAuditArtifact(auditArtifact);
assert.equal(auditArtifact.objectLevelAuditPerformed, true);
assert.equal(auditArtifact.objectLevelAuthorityRole, "audit_worker");
assert.equal(auditArtifact.metaPerformsObjectLevelAudit, false);

const auditGate = buildMetaOrchestratorTransitionGate({
  planPointer: auditPlanPointer,
  artifact: auditArtifact,
}, { nowMs });
validateMetaOrchestratorTransitionGate(auditGate);
assert.equal(auditGate.gateState, "transition_selected");
assert.equal(auditGate.transitionAction, "advance");
assert.equal(auditGate.transitionSelectedFromAuditArtifact, true);
assert.equal(auditGate.objectLevelValidityCertifiedByAuditor, true);
assert.equal(auditGate.objectLevelValidityJudgedByMeta, false);

const mismatchGate = buildMetaOrchestratorTransitionGate({
  planPointer: implementationPlanPointer,
  artifact: {
    ...implementationEvidence,
    stepId: "step_other",
    artifactDigest: sha256("mismatch"),
  },
}, { nowMs });
validateMetaOrchestratorTransitionGate(mismatchGate);
assert.equal(mismatchGate.gateState, "blocked");
assert(mismatchGate.blockerCodes.includes("step_id_mismatch"));
assert.equal(mismatchGate.providerCallAllowed, false);

const crossWorkThreadGate = buildMetaOrchestratorTransitionGate({
  planPointer: implementationPlanPointer,
  artifact: {
    ...implementationEvidence,
    workThreadId: "work_thread_other",
    planId: "plan_other",
    artifactDigest: sha256("cross_work_thread"),
  },
}, { nowMs });
validateMetaOrchestratorTransitionGate(crossWorkThreadGate);
assert.equal(crossWorkThreadGate.gateState, "blocked");
assert(crossWorkThreadGate.blockerCodes.includes("work_thread_id_mismatch"));
assert(crossWorkThreadGate.blockerCodes.includes("plan_id_mismatch"));

const hostileEvidence = {
  ...implementationEvidence,
  evidenceValidityCertified: true,
};
assert.throws(
  () => validateImplementationEvidenceArtifact(hostileEvidence),
  /direct_implementation_evidence_artifact_certification_leak/,
);

const nestedHostileEvidence = {
  ...implementationEvidence,
  changedFileRefs: [{
    ...implementationEvidence.changedFileRefs[0],
    rawPathIncluded: true,
  }],
};
assert.throws(
  () => validateImplementationEvidenceArtifact(nestedHostileEvidence),
  /direct_implementation_evidence_artifact_authority_leak:rawPathIncluded/,
);

const identitylessAudit = {
  ...auditArtifact,
  artifactId: "",
};
assert.throws(
  () => validateAuditArtifact(identitylessAudit),
  /direct_audit_artifact_missing_id/,
);

const nestedHostileAudit = {
  ...auditArtifact,
  defects: [{
    defectId: "hostile_defect",
    severity: "high",
    rendererSafeSummary: "Hostile nested defect",
    providerCallAllowed: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  }],
};
assert.throws(
  () => validateAuditArtifact(nestedHostileAudit),
  /direct_audit_artifact_authority_leak:providerCallAllowed/,
);

const hostileGate = {
  ...evidenceGate,
  objectLevelValidityJudgedByMeta: true,
};
assert.throws(
  () => validateMetaOrchestratorTransitionGate(hostileGate),
  /direct_meta_orchestrator_transition_gate_meta_audit_leak/,
);

const rawSerialized = JSON.stringify({
  implementationPlanPointer,
  stepStarted,
  implementationEvidence,
  evidenceSubmitted,
  evidenceGate,
  auditArtifact,
  auditGate,
});
assert(!rawSerialized.includes("rawTextIncluded\":true"), "meta-orchestrator shadow artifacts must not include raw text");
assert(!rawSerialized.includes("rawPathIncluded\":true"), "meta-orchestrator shadow artifacts must not include raw paths");
assert(!rawSerialized.includes("rawSecretIncluded\":true"), "meta-orchestrator shadow artifacts must not include raw secrets");
assert(!rawSerialized.includes("autonomousContinuationAllowed\":true"), "shadow gate must not enable autonomous continuation");
assert(!rawSerialized.includes("providerCallAllowed\":true"), "shadow gate must not enable provider calls");

console.log(JSON.stringify({
  ok: true,
  planPointerId: implementationPlanPointer.planPointerId,
  implementationArtifactId: implementationEvidence.artifactId,
  evidenceGateState: evidenceGate.gateState,
  auditArtifactId: auditArtifact.artifactId,
  auditTransitionAction: auditGate.transitionAction,
}, null, 2));
