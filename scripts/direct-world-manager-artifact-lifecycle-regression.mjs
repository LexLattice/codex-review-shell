#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  ARTIFACT_AUDIT_ASSESSMENT_SCHEMA,
  ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
  artifactRevisionRefFor,
  artifactTypeConstitutionRef,
  buildArtifactTypeConstitution,
  buildAuditAssessment,
  buildMechanicalWitnessJoin,
  digestFor,
  validateAdmissionReceiptCandidate,
  validateArtifactGateDecision,
  validateArtifactLifecycleInstance,
  validateArtifactTypeConstitution,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-kernel");
const {
  DirectArtifactLifecycleRuntime,
  adaptMetaOrchestratorShadow,
  adaptSc8Artifacts,
} = require("../src/main/direct/worldmanager/artifact-lifecycle-runtime");

const nowMs = Date.parse("2026-08-01T12:00:00.000Z");
const now = () => nowMs;
const projectId = "project_artifact_lifecycle_fixture";
const workThreadId = "workthread_artifact_lifecycle_fixture";

function ref(kind, id = kind, project = projectId) {
  return {
    kind,
    id,
    digest: digestFor(kind, { id, project }),
    ...(project ? { projectId: project } : {}),
  };
}

function constitutionInput(overrides = {}) {
  return {
    artifactTypeId: "ImplementationPatch",
    semanticScope: {
      kind: "project",
      projectId,
      taskType: "implementation",
    },
    producedObjectKindRefs: [ref("artifact_kind", "implementation_patch")],
    producerEligibilityRef: ref("eligibility_policy", "implementation_worker"),
    requiredMechanicalWitnesses: [
      {
        requirementId: "source_digest_current",
        witnessKind: "source_digest_current",
        freshnessPolicyRef: ref("freshness_policy", "exact_digest"),
      },
      {
        requirementId: "focused_test_exit",
        witnessKind: "focused_test_exit",
        dependencyRequirementIds: ["source_digest_current"],
        freshnessPolicyRef: ref("freshness_policy", "same_revision")
      },
    ],
    requiredSemanticAudits: [
      {
        requirementId: "semantic_contract_conformance",
        auditType: "semantic_contract_conformance",
        dependencyRequirementIds: ["focused_test_exit"],
        auditorEligibilityRef: ref("auditor_eligibility", "contract_reviewer"),
        verdictPolicyRef: ref("verdict_policy", "supported_only"),
      },
      {
        requirementId: "regression_preservation",
        auditType: "regression_preservation",
        dependencyRequirementIds: ["semantic_contract_conformance"],
        auditorEligibilityRef: ref("auditor_eligibility", "regression_reviewer"),
        verdictPolicyRef: ref("verdict_policy", "supported_only"),
      },
    ],
    conditionalAuditRules: [
      {
        ruleId: "external_effect_specialist",
        allOf: [{
          path: "governedActionClasses",
          operator: "includes",
          expected: "external_effect",
        }],
        settledPropertySourceRef: ref("settlement", "artifact_properties"),
        auditRequirement: {
          requirementId: "external_effect_safety",
          auditType: "external_effect_safety",
          dependencyRequirementIds: ["regression_preservation"],
          auditorEligibilityRef: ref("auditor_eligibility", "external_reviewer"),
          verdictPolicyRef: ref("verdict_policy", "supported_only"),
        },
      },
    ],
    auditorIndependenceRuleRef: ref("independence_policy", "producer_distinct"),
    lifecycleGatePolicyRef: ref("gate_policy", "all_required_supported"),
    admissionAuthorityRef: ref("authority", "project_manager"),
    remandPolicyRef: ref("remand_policy", "typed_obligations"),
    escalationPolicyRef: ref("escalation_policy", "three_remands"),
    notificationStandingRefs: [ref("notification_standing", "project_manager")],
    budgetPolicyRef: ref("budget_policy", "six_attempts"),
    assuranceRootPolicyRef: ref("assurance_root_policy", "bounded_roots"),
    assuranceRoots: [{
      rootKind: "deterministic_validator",
      rootRef: ref("assurance_root", "schema_digest_validator"),
      permitsRecursiveAudit: false,
      maximumAuditDepth: 0,
    }],
    constitutionAdmissionReceiptRef: ref(
      "canonical_admission_receipt",
      "artifact_type_constitution_admitted",
    ),
    revision: 1,
    now,
    ...overrides,
  };
}

const constitution = buildArtifactTypeConstitution(constitutionInput());
validateArtifactTypeConstitution(constitution);
assert.equal(constitution.canonical, true);
assert.equal(constitution.grantsAuthority, false);
assert.equal(constitution.requiredSemanticAudits.length, 2);

assert.throws(
  () => buildArtifactTypeConstitution(constitutionInput({
    artifactTypeId: "CyclicArtifact",
    requiredMechanicalWitnesses: [{
      requirementId: "cycle_a",
      witnessKind: "a",
      dependencyRequirementIds: ["cycle_b"],
      freshnessPolicyRef: ref("freshness_policy", "a"),
    }, {
      requirementId: "cycle_b",
      witnessKind: "b",
      dependencyRequirementIds: ["cycle_a"],
      freshnessPolicyRef: ref("freshness_policy", "b"),
    }],
    requiredSemanticAudits: [],
    conditionalAuditRules: [],
  })),
  /world_manager_artifact_assurance_cycle/,
);

const runtime = new DirectArtifactLifecycleRuntime({ now });
const initialized = runtime.initialize({
  constitution,
  requestRef: ref("artifact_request", "implementation_patch_request"),
  subjectScope: {
    kind: "workthread",
    projectId,
    workThreadId,
    taskType: "implementation",
  },
});
validateArtifactLifecycleInstance(initialized.lifecycle);
assert.equal(initialized.lifecycle.state, "requested");
assert.equal(initialized.lifecycle.pinnedConstitutionRevision, 1);
assert.deepEqual(
  initialized.lifecycle.artifactTypeConstitutionRef,
  artifactTypeConstitutionRef(constitution),
);

const producerAgentRef = ref("agent", "implementation_worker_1");
const producerRunRef = ref("agent_run", "implementation_run_1");
const producerResolution = runtime.resolveProducer({
  constitution,
  lifecycle: initialized.lifecycle,
  producerRole: "implementation_worker",
  candidates: [{
    agentRef: producerAgentRef,
    agentRunRef: producerRunRef,
    role: "implementation_worker",
    active: true,
    substrateAvailable: true,
    budgetAvailable: true,
    visibleProjectIds: [projectId],
    eligibleArtifactTypeIds: ["ImplementationPatch"],
    eligibilityReceiptRef: ref("eligibility_receipt", "producer_eligible"),
    currentLoad: 1,
  }],
});
assert.equal(producerResolution.resolution.resolutionState, "resolved");
assert.equal(producerResolution.assignment.providerLaunchAuthorized, false);

let lifecycle = runtime.applyProducerAssignment({
  constitution,
  lifecycle: initialized.lifecycle,
  assignment: producerResolution.assignment,
});
assert.equal(lifecycle.state, "under_production");

const firstPublication = runtime.publishRevision({
  constitution,
  lifecycle,
  producerAssignment: producerResolution.assignment,
  artifactId: "implementation_patch_context_menu",
  artifactContentRef: ref("implementation_patch_body", "patch_revision_1"),
  evidenceRefs: [ref("repository_after_digest", "repository_after_1")],
  settledProperties: {
    governedActionClasses: ["source_mutation", "external_effect"],
  },
});
lifecycle = firstPublication.lifecycle;
assert.equal(firstPublication.revision.revision, 1);
assert.equal(firstPublication.revision.immutable, true);
assert.equal(Object.isFrozen(firstPublication.revision), true);
assert.equal(
  firstPublication.graph.conditionalEvaluations[0].activated,
  true,
);
assert.equal(lifecycle.state, "under_audit");

const auditor1 = {
  agentRef: ref("agent", "auditor_1"),
  agentRunRef: ref("agent_run", "auditor_run_1"),
  role: "review_auditor",
  active: true,
  substrateAvailable: true,
  budgetAvailable: true,
  visibleProjectIds: [projectId],
  auditTypes: [
    "semantic_contract_conformance",
    "regression_preservation",
    "external_effect_safety",
  ],
  independenceReceiptRef: ref("independence_receipt", "auditor_1_independent"),
  boundedCapabilityNames: [
    "ledger.submit_audit_verdict",
    "ledger.request_evidence",
    "apply_patch",
  ],
  currentLoad: 1,
};
const selfAuditor = {
  ...auditor1,
  agentRef: producerAgentRef,
  agentRunRef: producerRunRef,
  independenceReceiptRef: ref("independence_receipt", "invalid_self_claim"),
  currentLoad: 0,
};
const routing = runtime.routeAudits({
  constitution,
  lifecycle,
  artifactRevision: firstPublication.revision,
  assuranceGraph: firstPublication.graph,
  producerAssignment: producerResolution.assignment,
  candidates: [selfAuditor, auditor1],
});
assert.equal(routing.assignments.length, 3);
assert.equal(routing.plan.producerSelectedAuditor, false);
assert.equal(routing.plan.providerLaunchAuthorized, false);
assert.ok(
  routing.plan.rejected.some((entry) =>
    entry.reasons.includes("producer_auditor_independence_violation"),
  ),
);
assert.deepEqual(
  [...routing.assignments[0].boundedCapabilityNames].sort(),
  ["ledger.request_evidence", "ledger.submit_audit_verdict"],
);

const revisionRef = artifactRevisionRefFor(firstPublication.revision);
const mechanicalWitnesses = [
  buildMechanicalWitnessJoin({
    lifecycleRef: firstPublication.revision.lifecycleRef,
    artifactRevisionRef: revisionRef,
    requirementId: "source_digest_current",
    state: "supported",
    evidenceRefs: [ref("source_digest_witness", "source_digest_current_1")],
    freshnessWitnessRef: ref("freshness_witness", "source_fresh_1"),
    now,
  }),
  buildMechanicalWitnessJoin({
    lifecycleRef: firstPublication.revision.lifecycleRef,
    artifactRevisionRef: revisionRef,
    requirementId: "focused_test_exit",
    state: "supported",
    evidenceRefs: [ref("test_exit_witness", "focused_test_green_1")],
    freshnessWitnessRef: ref("freshness_witness", "test_fresh_1"),
    now,
  }),
];
const auditAssessments = routing.assignments.map((assignment) =>
  buildAuditAssessment({
    lifecycleRef: firstPublication.revision.lifecycleRef,
    artifactRevisionRef: revisionRef,
    auditAssignmentRef: {
      kind: "artifact_audit_assignment",
      id: assignment.auditAssignmentId,
      digest: assignment.digest,
      projectId,
    },
    requirementId: assignment.requirementId,
    verdict: "supported",
    evidenceRefs: [ref("audit_evidence", `${assignment.requirementId}_green`)],
    rendererSafeSummary: `${assignment.auditType} supported`,
    now,
  }),
);

const supported = runtime.evaluateAssurance({
  constitution,
  lifecycle,
  artifactRevision: firstPublication.revision,
  assuranceGraph: firstPublication.graph,
  mechanicalWitnesses,
  auditAssessments,
  authorityResolvable: true,
  targetAdmissionScope: {
    kind: "workthread",
    projectId,
    workThreadId,
    taskType: "implementation",
  },
  expectedCanonicalRevisionRefs: [ref("workthread_revision", "before_admission")],
});
assert.equal(supported.join.gateReady, true);
assert.equal(supported.join.admitted, false);
assert.equal(supported.lifecycle.state, "gate_ready");
assert.equal(supported.lifecycle.canonicalAdmissionEffect, false);
validateArtifactGateDecision(supported.gateDecision);
assert.equal(supported.gateDecision.admissionAuthorized, false);
assert.equal(supported.gateDecision.canonicalEffect, false);
validateAdmissionReceiptCandidate(supported.admissionReceiptCandidate);
assert.equal(supported.admissionReceiptCandidate.receiptPosture, "candidate");
assert.equal(supported.admissionReceiptCandidate.admitted, false);
assert.equal(supported.admissionReceiptCandidate.trustStoreReceiptRef, null);
assert.equal(
  supported.admissionReceiptCandidate.targetAdmissionScope.kind,
  "workthread",
);

const mechanicalOnly = runtime.evaluateAssurance({
  constitution,
  lifecycle,
  artifactRevision: firstPublication.revision,
  assuranceGraph: firstPublication.graph,
  mechanicalWitnesses,
  auditAssessments: [],
  authorityResolvable: true,
  targetAdmissionScope: lifecycle.subjectScope,
});
assert.equal(mechanicalOnly.join.gateReady, false);
assert.equal(mechanicalOnly.admissionReceiptCandidate, null);

const semanticOnly = runtime.evaluateAssurance({
  constitution,
  lifecycle,
  artifactRevision: firstPublication.revision,
  assuranceGraph: firstPublication.graph,
  mechanicalWitnesses: [],
  auditAssessments,
  authorityResolvable: true,
  targetAdmissionScope: lifecycle.subjectScope,
});
assert.equal(semanticOnly.join.gateReady, false);

const secondPublication = runtime.publishRevision({
  constitution,
  lifecycle: supported.lifecycle,
  producerAssignment: producerResolution.assignment,
  previousRevision: firstPublication.revision,
  priorAuditAssessments: auditAssessments,
  artifactId: "implementation_patch_context_menu",
  artifactContentRef: ref("implementation_patch_body", "patch_revision_2"),
  evidenceRefs: [ref("repository_after_digest", "repository_after_2")],
  settledProperties: {
    governedActionClasses: ["source_mutation", "external_effect"],
  },
});
assert.equal(secondPublication.revision.revision, 2);
assert.equal(secondPublication.invalidations.length, 3);
assert.ok(secondPublication.invalidations.every((item) =>
  item.reason === "artifact_revision_changed" &&
  item.priorAssessmentStanding === "stale",
));

const staleAuditsCannotJoin = runtime.evaluateAssurance({
  constitution,
  lifecycle: secondPublication.lifecycle,
  artifactRevision: secondPublication.revision,
  assuranceGraph: secondPublication.graph,
  mechanicalWitnesses,
  auditAssessments,
  authorityResolvable: true,
  targetAdmissionScope: lifecycle.subjectScope,
});
assert.equal(staleAuditsCannotJoin.join.gateReady, false);
assert.ok(staleAuditsCannotJoin.join.blockerCodes.some((code) =>
  code.startsWith("semantic_audit_missing:"),
));

const secondRouting = runtime.routeAudits({
  constitution,
  lifecycle: secondPublication.lifecycle,
  artifactRevision: secondPublication.revision,
  assuranceGraph: secondPublication.graph,
  producerAssignment: producerResolution.assignment,
  candidates: [auditor1],
});
const remandAssessment = buildAuditAssessment({
  lifecycleRef: secondPublication.revision.lifecycleRef,
  artifactRevisionRef: artifactRevisionRefFor(secondPublication.revision),
  auditAssignmentRef: {
    kind: "artifact_audit_assignment",
    id: secondRouting.assignments[0].auditAssignmentId,
    digest: secondRouting.assignments[0].digest,
    projectId,
  },
  requirementId: secondRouting.assignments[0].requirementId,
  verdict: "requires_revision",
  remandObligations: ["Preserve the existing shell verb while adding the new context-menu entry."],
  evidenceRefs: [ref("audit_evidence", "preservation_gap")],
  now,
});
const remand = runtime.createRemand({
  constitution,
  lifecycle: secondPublication.lifecycle,
  artifactRevision: secondPublication.revision,
  auditAssessments: [remandAssessment],
  remandThreshold: 1,
});
assert.equal(remand.obligations.length, 1);
assert.equal(remand.routing.routeToProducer, false);
assert.equal(remand.routing.managerWakeRequired, true);
assert.equal(remand.escalation.canonicalEffect, false);
assert.equal(remand.lifecycle.state, "remanded");

const revisionTwoConstitution = buildArtifactTypeConstitution(
  constitutionInput({
    revision: 2,
    constitutionAdmissionReceiptRef: ref(
      "canonical_admission_receipt",
      "artifact_type_constitution_revision_2_admitted",
    ),
  }),
);
assert.throws(
  () => runtime.applyProducerAssignment({
    constitution: revisionTwoConstitution,
    lifecycle: initialized.lifecycle,
    assignment: producerResolution.assignment,
  }),
  /world_manager_artifact_lifecycle_constitution_migration_required/,
);

const metaPlanPointer = {
  schema: "direct_meta_orchestrator_plan_pointer@1",
  planPointerId: "meta_plan_pointer_fixture",
  pointerDigest: digestFor("meta_plan_pointer", { projectId, workThreadId }),
  projectId,
  workThreadId,
  planId: "plan_fixture",
  currentStepId: "step_fixture",
};
const metaArtifact = {
  schema: "direct_implementation_evidence_artifact@1",
  artifactClass: "implementation_evidence_artifact",
  artifactId: "legacy_implementation_evidence",
  artifactDigest: digestFor("legacy_implementation_evidence", { projectId }),
  projectId,
};
const metaAdapter = adaptMetaOrchestratorShadow({
  constitution,
  planPointer: metaPlanPointer,
  artifact: metaArtifact,
  now,
});
assert.equal(metaAdapter.sourceBodyCopied, false);
assert.equal(metaAdapter.sourceClaimUpgraded, false);
assert.equal(metaAdapter.lifecycle.state, "under_audit");
assert.equal(metaAdapter.artifactRevision.immutable, true);

const sc8Adapter = adaptSc8Artifacts({
  constitution,
  workerConstitution: {
    schema: "direct_aro_worker_constitution@1",
    workerConstitutionId: "sc8_worker_constitution",
    digest: digestFor("sc8_worker_constitution", { projectId }),
    projectId,
    workThreadId,
  },
  evidenceBundle: {
    schema: "direct_aro_execution_evidence_bundle@1",
    evidenceBundleId: "sc8_evidence_bundle",
    digest: digestFor("sc8_evidence_bundle", { projectId }),
    projectId,
  },
  closureCandidate: {
    schema: "direct_aro_closure_candidate@1",
    closureCandidateId: "sc8_closure_candidate",
    digest: digestFor("sc8_closure_candidate", { projectId }),
    projectId,
    gateDisposition: "ready_for_review",
  },
  now,
});
assert.equal(sc8Adapter.sc8ReadyForReviewObserved, true);
assert.equal(sc8Adapter.sc8ReadyForReviewUpgradedToGateReady, false);
assert.equal(sc8Adapter.sourceBodyCopied, false);
assert.equal(sc8Adapter.lifecycle.state, "under_audit");
assert.equal(sc8Adapter.artifactRevision.immutable, true);

assert.equal(
  mechanicalWitnesses[0].schema,
  ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
);
assert.equal(auditAssessments[0].schema, ARTIFACT_AUDIT_ASSESSMENT_SCHEMA);

console.log(JSON.stringify({
  ok: true,
  slice: "WM-SC11.5-SC11.6",
  artifactTypeConstitutionPinned: true,
  artifactRevisionImmutable: true,
  producerResolutionDeterministic: true,
  independentAuditRouting: true,
  conditionalAuditActivated: true,
  assuranceCycleRejected: true,
  exactDigestAuditInvalidation: true,
  mechanicalAndSemanticJoinRequired: true,
  repeatedRemandEscalates: true,
  gateReadyIsNotAdmitted: true,
  scopeRelativeAdmissionCandidateOnly: true,
  metaOrchestratorCompatibilityRefOnly: true,
  sc8ReadyForReviewNotUpgraded: true,
}));
