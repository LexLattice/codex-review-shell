"use strict";

const {
  ARTIFACT_AUDIT_ASSESSMENT_SCHEMA,
  ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
  artifactGateDecisionRef,
  artifactLifecycleInstanceRef,
  artifactRevisionRefFor,
  artifactTypeConstitutionRef,
  assuranceGraphRef,
  auditAssessmentRef,
  buildAdmissionReceiptCandidate,
  buildArtifactGateDecision,
  buildArtifactLifecycleInstance,
  buildArtifactRevision,
  buildAssuranceGraph,
  buildAuditAssignment,
  buildAuditInvalidation,
  buildCompatibilityAdapterReceipt,
  buildProducerAssignment,
  buildRemandObligation,
  digestFor,
  exactRef,
  exactRefMatches,
  producerAssignmentRef,
  reviseArtifactLifecycleInstance,
  reviseAssuranceGraph,
  stableId,
  validateArtifactLifecycleInstance,
  validateArtifactRevision,
  validateArtifactTypeConstitution,
  validateAssuranceGraph,
  validateAuditAssessment,
  validateMechanicalWitnessJoin,
  validateProducerAssignment,
} = require("./artifact-lifecycle-kernel");

const ARTIFACT_PRODUCER_RESOLUTION_SCHEMA =
  "direct_artifact_producer_resolution@1";
const ARTIFACT_AUDIT_ROUTING_PLAN_SCHEMA =
  "direct_artifact_audit_routing_plan@1";
const ARTIFACT_ASSURANCE_JOIN_SCHEMA =
  "direct_artifact_assurance_join@1";
const ARTIFACT_REMAND_ROUTING_SCHEMA =
  "direct_artifact_remand_routing@1";
const ARTIFACT_ESCALATION_CANDIDATE_SCHEMA =
  "direct_artifact_escalation_candidate@1";
const META_ORCHESTRATOR_ADAPTER_SCHEMA =
  "direct_meta_orchestrator_lifecycle_adapter@1";
const SC8_ARTIFACT_ADAPTER_SCHEMA =
  "direct_sc8_artifact_lifecycle_adapter@1";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function stableValue(value, omitted = new Set()) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry, omitted));
  }
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (omitted.has(key) || typeof value[key] === "undefined") {
        return output;
      }
      output[key] = stableValue(value[key], omitted);
      return output;
    }, {});
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function runtimeArtifact(schema, idField, id, body) {
  const value = { schema, [idField]: id, ...body };
  value.digest = digestFor(schema, value, ["digest"]);
  return deepFreeze(value);
}

function stringList(value, max = 64) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => text(entry, ""))
        .filter(Boolean),
    ),
  ].slice(0, max);
}

function refIdentity(ref) {
  return `${ref?.kind || ""}:${ref?.id || ""}`;
}

function candidateAgentRef(candidate, label = "candidate.agentRef") {
  return exactRef(
    candidate.agentRef || candidate.actorRef || candidate.roleInstanceRef,
    label,
  );
}

function candidateIsInScope(candidate, scope) {
  const visibleProjects = stringList(candidate.visibleProjectIds);
  return (
    !scope.projectId ||
    visibleProjects.includes("*") ||
    visibleProjects.includes(scope.projectId)
  );
}

function sortedCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const loadDelta =
      Math.max(0, Number(left.currentLoad || 0) || 0) -
      Math.max(0, Number(right.currentLoad || 0) || 0);
    if (loadDelta) return loadDelta;
    return refIdentity(candidateAgentRef(left)).localeCompare(
      refIdentity(candidateAgentRef(right)),
    );
  });
}

function resolveProducer(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  if (
    !exactRefMatches(
      lifecycle.artifactTypeConstitutionRef,
      artifactTypeConstitutionRef(constitution),
    )
  ) {
    fail("world_manager_artifact_producer_constitution_mismatch");
  }
  const requestedRole = text(input.producerRole, "implementation_worker");
  const rejected = [];
  const eligible = [];
  for (const candidate of Array.isArray(input.candidates)
    ? input.candidates
    : []) {
    const reasons = [];
    let agentRef = null;
    try {
      agentRef = candidateAgentRef(candidate);
    } catch {
      reasons.push("agent_ref_invalid");
    }
    if (text(candidate.role, "") !== requestedRole) reasons.push("role_mismatch");
    if (candidate.active === false) reasons.push("inactive");
    if (candidate.substrateAvailable === false) reasons.push("substrate_unavailable");
    if (candidate.budgetAvailable === false) reasons.push("budget_unavailable");
    if (!candidateIsInScope(candidate, lifecycle.subjectScope)) {
      reasons.push("scope_not_visible");
    }
    if (
      Array.isArray(candidate.eligibleArtifactTypeIds) &&
      !candidate.eligibleArtifactTypeIds.includes(constitution.artifactTypeId)
    ) {
      reasons.push("artifact_type_ineligible");
    }
    if (!candidate.eligibilityReceiptRef) reasons.push("eligibility_receipt_missing");
    if (reasons.length) {
      rejected.push({ agentRef, reasons });
    } else {
      eligible.push(candidate);
    }
  }
  const selected = sortedCandidates(eligible)[0] || null;
  const resolution = runtimeArtifact(
    ARTIFACT_PRODUCER_RESOLUTION_SCHEMA,
    "producerResolutionId",
    stableId("wm_artifact_producer_resolution", {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      requestedRole,
      eligible: eligible.map((candidate) => candidateAgentRef(candidate)),
      rejected,
    }),
    {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      producerEligibilityRef: constitution.producerEligibilityRef,
      requestedRole,
      eligibleAgentRefs: eligible.map((candidate) => candidateAgentRef(candidate)),
      rejected,
      selectedAgentRef: selected ? candidateAgentRef(selected) : null,
      resolutionState: selected ? "resolved" : "unresolved",
      deterministicSelection: true,
      providerLaunchAuthorized: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  const assignment = selected
    ? buildProducerAssignment({
        lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
        lifecycleId: lifecycle.lifecycleId,
        producerRole: requestedRole,
        producerAgentRef: candidateAgentRef(selected),
        producerRunRef: selected.agentRunRef,
        eligibilityRef: selected.eligibilityReceiptRef,
        now: input.now,
        createdAt: input.createdAt,
      })
    : null;
  return { resolution, assignment };
}

function applyProducerAssignment(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  const assignment = input.assignment;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  validateProducerAssignment(assignment);
  if (assignment.lifecycleId !== lifecycle.lifecycleId) {
    fail("world_manager_artifact_producer_assignment_lifecycle_mismatch");
  }
  return reviseArtifactLifecycleInstance(lifecycle, {
    constitution,
    producerAssignmentRef: producerAssignmentRef(
      assignment,
      lifecycle.subjectScope.projectId,
    ),
    state: "under_production",
    budgetUsage: {
      ...lifecycle.budgetUsage,
      attempts: lifecycle.budgetUsage.attempts + 1,
    },
    now: input.now,
    createdAt: input.createdAt,
  });
}

function publishArtifactRevision(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  const producerAssignment = input.producerAssignment;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  validateProducerAssignment(producerAssignment);
  if (
    !exactRefMatches(
      lifecycle.producerAssignmentRef,
      producerAssignmentRef(
        producerAssignment,
        lifecycle.subjectScope.projectId,
      ),
    ) || producerAssignment.lifecycleId !== lifecycle.lifecycleId
  ) {
    fail("world_manager_artifact_revision_producer_assignment_mismatch");
  }
  const previousRevision = input.previousRevision || null;
  if (previousRevision) {
    validateArtifactRevision(previousRevision);
    if (previousRevision.lifecycleId !== lifecycle.lifecycleId) {
      fail("world_manager_artifact_revision_previous_lifecycle_mismatch");
    }
  }
  const revision = buildArtifactRevision({
    lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
    artifactTypeConstitutionRef: artifactTypeConstitutionRef(constitution),
    lifecycleId: lifecycle.lifecycleId,
    artifactId: text(input.artifactId, lifecycle.lifecycleId),
    revision: previousRevision ? previousRevision.revision + 1 : 1,
    predecessorRef: previousRevision
      ? artifactRevisionRefFor(previousRevision)
      : null,
    artifactContentRef: input.artifactContentRef,
    producerAssignmentRef: producerAssignmentRef(
      producerAssignment,
      lifecycle.subjectScope.projectId,
    ),
    producerRunRef: producerAssignment.producerRunRef,
    evidenceRefs: input.evidenceRefs,
    settledProperties: input.settledProperties,
    now: input.now,
    createdAt: input.createdAt,
  });
  const graph = buildAssuranceGraph({
    constitution,
    lifecycleId: lifecycle.lifecycleId,
    artifactRevision: revision,
    settledProperties: revision.settledProperties,
    now: input.now,
    createdAt: input.createdAt,
  });
  const revisedLifecycle = reviseArtifactLifecycleInstance(lifecycle, {
    constitution,
    currentArtifactRevisionRef: artifactRevisionRefFor(revision),
    assuranceGraphRef: assuranceGraphRef(
      graph,
      lifecycle.subjectScope.projectId,
    ),
    gateDecisionRef: null,
    state: graph.nodes.some(
      (node) => node.active && node.requirementKind === "semantic_audit",
    )
      ? "under_audit"
      : "candidate",
    now: input.now,
    createdAt: input.createdAt,
  });
  const invalidations = previousRevision
    ? (Array.isArray(input.priorAuditAssessments)
        ? input.priorAuditAssessments
        : []
      )
        .filter((assessment) => {
          validateAuditAssessment(assessment);
          return exactRefMatches(
            assessment.artifactRevisionRef,
            artifactRevisionRefFor(previousRevision),
          );
        })
        .map((assessment) =>
          buildAuditInvalidation({
            auditAssessmentRef: auditAssessmentRef(
              assessment,
              lifecycle.subjectScope.projectId,
            ),
            previousArtifactRevisionRef: artifactRevisionRefFor(previousRevision),
            currentArtifactRevisionRef: artifactRevisionRefFor(revision),
            now: input.now,
            createdAt: input.createdAt,
          }),
        )
    : [];
  return { revision, graph, lifecycle: revisedLifecycle, invalidations };
}

function candidateConflictsWithProducer(candidate, producerAssignment) {
  const auditorRef = candidateAgentRef(candidate);
  if (exactRefMatches(auditorRef, producerAssignment.producerAgentRef)) return true;
  if (
    candidate.agentRunRef &&
    producerAssignment.producerRunRef &&
    exactRefMatches(candidate.agentRunRef, producerAssignment.producerRunRef)
  ) {
    return true;
  }
  const conflictRefs = (Array.isArray(candidate.conflictRefs)
    ? candidate.conflictRefs
    : []
  ).map((ref) => exactRef(ref, "auditor.conflictRef"));
  return conflictRefs.some(
    (ref) =>
      refIdentity(ref) === refIdentity(producerAssignment.producerAgentRef) ||
      (producerAssignment.producerRunRef &&
        refIdentity(ref) === refIdentity(producerAssignment.producerRunRef)),
  );
}

function resolveAuditRouting(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  const revision = input.artifactRevision;
  const graph = input.assuranceGraph;
  const producerAssignment = input.producerAssignment;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  validateArtifactRevision(revision);
  validateAssuranceGraph(graph);
  validateProducerAssignment(producerAssignment);
  const revisionRef = artifactRevisionRefFor(revision);
  if (!exactRefMatches(graph.artifactRevisionRef, revisionRef)) {
    fail("world_manager_artifact_audit_graph_revision_mismatch");
  }
  const assignments = [];
  const unresolved = [];
  const rejected = [];
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  for (const node of graph.nodes.filter(
    (candidateNode) =>
      candidateNode.active &&
      candidateNode.requirementKind === "semantic_audit" &&
      candidateNode.state === "pending",
  )) {
    const requirement = node.requirement;
    const eligible = [];
    for (const candidate of candidates) {
      const reasons = [];
      let agentRef = null;
      try {
        agentRef = candidateAgentRef(candidate, "auditor.agentRef");
      } catch {
        reasons.push("agent_ref_invalid");
      }
      if (text(candidate.role, "") !== "review_auditor" &&
          text(candidate.role, "") !== "audit_worker") {
        reasons.push("role_mismatch");
      }
      if (candidate.active === false) reasons.push("inactive");
      if (candidate.substrateAvailable === false) reasons.push("substrate_unavailable");
      if (candidate.budgetAvailable === false) reasons.push("budget_unavailable");
      if (!candidateIsInScope(candidate, lifecycle.subjectScope)) {
        reasons.push("scope_not_visible");
      }
      if (
        Array.isArray(candidate.auditTypes) &&
        !candidate.auditTypes.includes(requirement.auditType)
      ) {
        reasons.push("audit_type_ineligible");
      }
      if (!candidate.independenceReceiptRef) {
        reasons.push("independence_receipt_missing");
      }
      if (agentRef && candidateConflictsWithProducer(candidate, producerAssignment)) {
        reasons.push("producer_auditor_independence_violation");
      }
      if (reasons.length) {
        rejected.push({
          requirementId: requirement.requirementId,
          agentRef,
          reasons,
        });
      } else {
        eligible.push(candidate);
      }
    }
    const selected = sortedCandidates(eligible)[0] || null;
    if (!selected) {
      unresolved.push({
        requirementId: requirement.requirementId,
        auditType: requirement.auditType,
        reason: "eligible_independent_auditor_unavailable",
      });
      continue;
    }
    assignments.push(
      buildAuditAssignment({
        lifecycleId: lifecycle.lifecycleId,
        lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
        artifactRevisionRef: revisionRef,
        requirementId: requirement.requirementId,
        auditType: requirement.auditType,
        auditorRole: text(selected.role, "review_auditor"),
        auditorAgentRef: candidateAgentRef(selected),
        auditorRunRef: selected.agentRunRef,
        independenceReceiptRef: selected.independenceReceiptRef,
        independenceRuleRef: constitution.auditorIndependenceRuleRef,
        boundedCapabilityNames: stringList(
          selected.boundedCapabilityNames,
        ).filter((name) =>
          [
            "ledger.challenge_claim",
            "ledger.request_evidence",
            "ledger.submit_audit_verdict",
            "ledger.validate_closure_candidate",
          ].includes(name),
        ),
        now: input.now,
        createdAt: input.createdAt,
      }),
    );
  }
  const plan = runtimeArtifact(
    ARTIFACT_AUDIT_ROUTING_PLAN_SCHEMA,
    "auditRoutingPlanId",
    stableId("wm_artifact_audit_routing", {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      revisionRef,
      assignmentIds: assignments.map((assignment) => assignment.auditAssignmentId),
      unresolved,
    }),
    {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: revisionRef,
      assuranceGraphRef: assuranceGraphRef(
        graph,
        lifecycle.subjectScope.projectId,
      ),
      assignmentRefs: assignments.map((assignment) => exactRef({
        kind: "artifact_audit_assignment",
        id: assignment.auditAssignmentId,
        digest: assignment.digest,
        projectId: lifecycle.subjectScope.projectId,
      })),
      unresolved,
      rejected,
      producerSelectedAuditor: false,
      providerLaunchAuthorized: false,
      workThreadRegistrationRequired: assignments.length > 0,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  return { plan, assignments };
}

function latestByRequirement(values, revisionRef, validator) {
  const byRequirement = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    validator(value);
    if (!exactRefMatches(value.artifactRevisionRef, revisionRef)) continue;
    byRequirement.set(value.requirementId, value);
  }
  return byRequirement;
}

function conflictingAuditRequirementIds(values, revisionRef) {
  const verdictsByRequirement = new Map();
  for (const assessment of Array.isArray(values) ? values : []) {
    validateAuditAssessment(assessment);
    if (!exactRefMatches(assessment.artifactRevisionRef, revisionRef)) continue;
    const verdicts = verdictsByRequirement.get(assessment.requirementId) || new Set();
    verdicts.add(assessment.verdict);
    verdictsByRequirement.set(assessment.requirementId, verdicts);
  }
  return [...verdictsByRequirement.entries()]
    .filter(([, verdicts]) => verdicts.size > 1)
    .map(([requirementId]) => requirementId);
}

function evaluateAssurance(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  const revision = input.artifactRevision;
  const graph = input.assuranceGraph;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  validateArtifactRevision(revision);
  validateAssuranceGraph(graph);
  const revisionRef = artifactRevisionRefFor(revision);
  if (!exactRefMatches(graph.artifactRevisionRef, revisionRef)) {
    fail("world_manager_artifact_assurance_exact_revision_required");
  }
  const mechanicalByRequirement = latestByRequirement(
    input.mechanicalWitnesses,
    revisionRef,
    validateMechanicalWitnessJoin,
  );
  const auditByRequirement = latestByRequirement(
    input.auditAssessments,
    revisionRef,
    validateAuditAssessment,
  );
  const disagreementRequirementIds = conflictingAuditRequirementIds(
    input.auditAssessments,
    revisionRef,
  );
  const nodeStates = {};
  const blockerCodes = [];
  const remandAssessmentRefs = [];
  for (const node of graph.nodes) {
    if (!node.active) {
      nodeStates[node.nodeId] = "inactive";
      continue;
    }
    if (node.requirementKind === "mechanical_witness") {
      const witness = mechanicalByRequirement.get(node.nodeId);
      nodeStates[node.nodeId] = witness?.state || "pending";
      if (!witness && node.required) {
        blockerCodes.push(`mechanical_witness_missing:${node.nodeId}`);
      } else if (witness && witness.state !== "supported" && node.required) {
        blockerCodes.push(`mechanical_witness_${witness.state}:${node.nodeId}`);
      }
    } else {
      const assessment = auditByRequirement.get(node.nodeId);
      nodeStates[node.nodeId] = assessment?.verdict || "pending";
      if (!assessment && node.required) {
        blockerCodes.push(`semantic_audit_missing:${node.nodeId}`);
      } else if (assessment && assessment.verdict !== "supported" && node.required) {
        blockerCodes.push(`semantic_audit_${assessment.verdict}:${node.nodeId}`);
        if (assessment.verdict === "requires_revision") {
          remandAssessmentRefs.push(
            auditAssessmentRef(
              assessment,
              lifecycle.subjectScope.projectId,
            ),
          );
        }
      }
    }
  }
  for (const evaluation of graph.conditionalEvaluations) {
    if (evaluation.evaluationState !== "evaluated") {
      blockerCodes.push(`conditional_audit_indeterminate:${evaluation.ruleId}`);
    }
  }
  for (const node of graph.nodes.filter((candidate) => candidate.active)) {
    for (const dependencyId of node.dependencyNodeIds) {
      if (nodeStates[dependencyId] !== "supported") {
        blockerCodes.push(
          `assurance_dependency_unsatisfied:${node.nodeId}:${dependencyId}`,
        );
      }
    }
  }
  const activeBlockingRemands = (Array.isArray(input.remandObligations)
    ? input.remandObligations
    : []
  ).filter((obligation) => obligation.state === "open" && obligation.blocking !== false);
  if (activeBlockingRemands.length) blockerCodes.push("open_remand_obligations");
  const repeatedRemandThreshold = Math.max(
    1,
    Number(input.escalationThresholds?.remandCount || 3) || 3,
  );
  const budgetAttemptLimit = Math.max(
    1,
    Number(input.escalationThresholds?.attemptCount || 6) || 6,
  );
  const escalationReasons = [];
  if (lifecycle.remandCount >= repeatedRemandThreshold) {
    escalationReasons.push("repeated_remand_threshold_reached");
  }
  if (lifecycle.budgetUsage.attempts >= budgetAttemptLimit) {
    escalationReasons.push("attempt_budget_exhausted");
  }
  if (input.auditDisagreement === true || disagreementRequirementIds.length) {
    escalationReasons.push("auditor_disagreement");
  }
  if (input.authorityResolvable !== true) {
    escalationReasons.push("admission_authority_unresolved");
  }
  const uniqueBlockers = [...new Set(blockerCodes)];
  const assuranceSupported =
    uniqueBlockers.length === 0 &&
    escalationReasons.length === 0 &&
    graph.nodes
      .filter((node) => node.active && node.required)
      .every((node) => nodeStates[node.nodeId] === "supported");
  const joinState = assuranceSupported
    ? "supported"
    : remandAssessmentRefs.length
      ? "remanded"
      : "blocked";
  const revisedGraph = reviseAssuranceGraph(graph, {
    nodeStates,
    joinState,
    now: input.now,
    createdAt: input.createdAt,
  });
  const decisionState = escalationReasons.length
    ? "escalation_required"
    : assuranceSupported
      ? "gate_ready"
      : "blocked";
  const gateDecision = buildArtifactGateDecision({
    lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
    artifactRevisionRef: revisionRef,
    assuranceGraphRef: assuranceGraphRef(
      revisedGraph,
      lifecycle.subjectScope.projectId,
    ),
    decisionState,
    assuranceSupported,
    blockerCodes: [...uniqueBlockers, ...escalationReasons],
    targetAdmissionScope: input.targetAdmissionScope || lifecycle.subjectScope,
    admissionAuthorityRef: constitution.admissionAuthorityRef,
    authorityResolvable: input.authorityResolvable === true,
    now: input.now,
    createdAt: input.createdAt,
  });
  const join = runtimeArtifact(
    ARTIFACT_ASSURANCE_JOIN_SCHEMA,
    "assuranceJoinId",
    stableId("wm_artifact_assurance_join", {
      revisionRef,
      graphRef: assuranceGraphRef(
        revisedGraph,
        lifecycle.subjectScope.projectId,
      ),
      decisionState,
      blockerCodes: uniqueBlockers,
      escalationReasons,
      disagreementRequirementIds,
    }),
    {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: revisionRef,
      assuranceGraphRef: assuranceGraphRef(
        revisedGraph,
        lifecycle.subjectScope.projectId,
      ),
      mechanicalWitnessRefs: [...mechanicalByRequirement.values()].map((witness) =>
        exactRef({
          kind: "artifact_mechanical_witness_join",
          id: witness.mechanicalWitnessJoinId,
          digest: witness.digest,
          projectId: lifecycle.subjectScope.projectId,
        }),
      ),
      auditAssessmentRefs: [...auditByRequirement.values()].map((assessment) =>
        auditAssessmentRef(assessment, lifecycle.subjectScope.projectId),
      ),
      remandAssessmentRefs,
      blockerCodes: uniqueBlockers,
      escalationReasons,
      disagreementRequirementIds,
      joinState,
      gateReady: assuranceSupported,
      admitted: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  const revisedLifecycle = reviseArtifactLifecycleInstance(lifecycle, {
    constitution,
    assuranceGraphRef: assuranceGraphRef(
      revisedGraph,
      lifecycle.subjectScope.projectId,
    ),
    gateDecisionRef: artifactGateDecisionRef(
      gateDecision,
      lifecycle.subjectScope.projectId,
    ),
    state: assuranceSupported
      ? "gate_ready"
      : remandAssessmentRefs.length
        ? "remanded"
        : revisedGraph.nodes.some(
            (node) =>
              node.active &&
              node.requirementKind === "semantic_audit",
          )
          ? "under_audit"
          : "candidate",
    now: input.now,
    createdAt: input.createdAt,
  });
  const admissionReceiptCandidate = assuranceSupported
    ? buildAdmissionReceiptCandidate({
        gateDecision,
        expectedCanonicalRevisionRefs: input.expectedCanonicalRevisionRefs,
        now: input.now,
        createdAt: input.createdAt,
      })
    : null;
  return {
    join,
    graph: revisedGraph,
    gateDecision,
    lifecycle: revisedLifecycle,
    admissionReceiptCandidate,
  };
}

function createRemandRouting(input = {}) {
  const constitution = input.constitution;
  const lifecycle = input.lifecycle;
  const revision = input.artifactRevision;
  const assessments = Array.isArray(input.auditAssessments)
    ? input.auditAssessments
    : [];
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  validateArtifactRevision(revision);
  const revisionRef = artifactRevisionRefFor(revision);
  const remanding = assessments.filter((assessment) => {
    validateAuditAssessment(assessment);
    return (
      exactRefMatches(assessment.artifactRevisionRef, revisionRef) &&
      assessment.verdict === "requires_revision"
    );
  });
  const obligations = remanding.flatMap((assessment) =>
    assessment.remandObligations.map((obligation) =>
      buildRemandObligation({
        lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
        artifactRevisionRef: revisionRef,
        sourceAssessmentRef: auditAssessmentRef(
          assessment,
          lifecycle.subjectScope.projectId,
        ),
        obligation,
        now: input.now,
        createdAt: input.createdAt,
      }),
    ),
  );
  const nextRemandCount = lifecycle.remandCount + 1;
  const threshold = Math.max(1, Number(input.remandThreshold || 3) || 3);
  const escalationRequired = nextRemandCount >= threshold;
  const routing = runtimeArtifact(
    ARTIFACT_REMAND_ROUTING_SCHEMA,
    "remandRoutingId",
    stableId("wm_artifact_remand_routing", {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      revisionRef,
      obligations: obligations.map((obligation) => obligation.digest),
      nextRemandCount,
    }),
    {
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: revisionRef,
      producerAssignmentRef: lifecycle.producerAssignmentRef,
      obligationRefs: obligations.map((obligation) =>
        exactRef({
          kind: "artifact_remand_obligation",
          id: obligation.remandObligationId,
          digest: obligation.digest,
          projectId: lifecycle.subjectScope.projectId,
        }),
      ),
      nextRemandCount,
      escalationRequired,
      routeToProducer: !escalationRequired,
      managerWakeRequired: escalationRequired,
      providerLaunchAuthorized: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  const revisedLifecycle = reviseArtifactLifecycleInstance(lifecycle, {
    constitution,
    state: "remanded",
    remandCount: nextRemandCount,
    budgetUsage: {
      ...lifecycle.budgetUsage,
      remands: lifecycle.budgetUsage.remands + 1,
    },
    now: input.now,
    createdAt: input.createdAt,
  });
  const escalation = escalationRequired
    ? runtimeArtifact(
        ARTIFACT_ESCALATION_CANDIDATE_SCHEMA,
        "escalationCandidateId",
        stableId("wm_artifact_escalation_candidate", {
          lifecycleRef: artifactLifecycleInstanceRef(revisedLifecycle),
          reason: "repeated_remand_threshold_reached",
        }),
        {
          lifecycleRef: artifactLifecycleInstanceRef(revisedLifecycle),
          artifactRevisionRef: revisionRef,
          reasonCodes: ["repeated_remand_threshold_reached"],
          notificationStandingRefs: constitution.notificationStandingRefs,
          authorityActRequired: true,
          canonicalEffect: false,
          createdAt: text(input.createdAt, nowIso(input.now)),
        },
      )
    : null;
  return { routing, obligations, lifecycle: revisedLifecycle, escalation };
}

function legacyArtifactRef(artifact, fallbackKind) {
  return exactRef({
    kind: text(artifact?.artifactClass || artifact?.schema, fallbackKind),
    id: artifact?.artifactId ||
      artifact?.closureCandidateId ||
      artifact?.evidenceBundleId ||
      artifact?.workerConstitutionId,
    digest: artifact?.artifactDigest || artifact?.digest,
    projectId: artifact?.projectId,
  }, fallbackKind);
}

function adaptMetaOrchestratorShadow(input = {}) {
  const constitution = input.constitution;
  const planPointer = input.planPointer;
  const legacyArtifact = input.artifact || null;
  validateArtifactTypeConstitution(constitution);
  if (
    !isPlainObject(planPointer) ||
    planPointer.schema !== "direct_meta_orchestrator_plan_pointer@1" ||
    !text(planPointer.pointerDigest, "")
  ) {
    fail("world_manager_artifact_meta_orchestrator_pointer_invalid");
  }
  const requestRef = exactRef({
    kind: "direct_meta_orchestrator_plan_pointer",
    id: planPointer.planPointerId,
    digest: planPointer.pointerDigest,
    projectId: planPointer.projectId,
  });
  const initialGraph = buildAssuranceGraph({
    constitution,
    lifecycleId: text(
      input.lifecycleId,
      stableId("wm_meta_orchestrator_artifact_lifecycle", requestRef),
    ),
    settledProperties: {},
    now: input.now,
  });
  const requestedLifecycle = buildArtifactLifecycleInstance({
    constitution,
    lifecycleId: initialGraph.lifecycleId,
    requestRef,
    subjectScope: {
      kind: "workthread",
      projectId: planPointer.projectId,
      workThreadId: planPointer.workThreadId,
      taskType: "implementation",
    },
    assuranceGraphRef: assuranceGraphRef(initialGraph, planPointer.projectId),
    state: "requested",
    now: input.now,
  });
  const sourceRefs = [requestRef];
  if (legacyArtifact) sourceRefs.push(legacyArtifactRef(legacyArtifact, "legacy_artifact"));
  let lifecycle = requestedLifecycle;
  let assuranceGraph = initialGraph;
  let artifactRevision = null;
  let producerAssignment = null;
  if (legacyArtifact) {
    const contentRef = legacyArtifactRef(legacyArtifact, "legacy_artifact");
    producerAssignment = buildProducerAssignment({
      lifecycleRef: artifactLifecycleInstanceRef(requestedLifecycle),
      lifecycleId: requestedLifecycle.lifecycleId,
      producerRole: text(legacyArtifact.producerRole, "implementation_worker"),
      producerAgentRef: exactRef({
        kind: "legacy_role_instance",
        id: text(
          legacyArtifact.workerThreadId || legacyArtifact.auditorThreadId,
          `${text(legacyArtifact.producerRole, "implementation_worker")}_legacy`,
        ),
        digest: digestFor("legacy_role_instance", {
          requestRef,
          producerRole: legacyArtifact.producerRole,
        }),
        projectId: planPointer.projectId,
      }),
      eligibilityRef: exactRef({
        kind: "compatibility_eligibility_receipt",
        id: `meta_orchestrator_${planPointer.currentStepId}`,
        digest: digestFor("compatibility_eligibility_receipt", {
          requestRef,
          contentRef,
        }),
        projectId: planPointer.projectId,
      }),
      now: input.now,
    });
    lifecycle = applyProducerAssignment({
      constitution,
      lifecycle: requestedLifecycle,
      assignment: producerAssignment,
      now: input.now,
    });
    const publication = publishArtifactRevision({
      constitution,
      lifecycle,
      producerAssignment,
      artifactId: legacyArtifact.artifactId,
      artifactContentRef: contentRef,
      evidenceRefs: sourceRefs,
      settledProperties: {
        compatibilitySource: "direct_meta_orchestrator_shadow",
        legacyArtifactClass: text(legacyArtifact.artifactClass, "unknown"),
      },
      now: input.now,
    });
    lifecycle = publication.lifecycle;
    assuranceGraph = publication.graph;
    artifactRevision = publication.revision;
  }
  const adapterReceipt = buildCompatibilityAdapterReceipt({
    sourceKind: "direct_meta_orchestrator_shadow",
    sourceRefs,
    lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
    artifactRevisionRef: artifactRevision
      ? artifactRevisionRefFor(artifactRevision)
      : null,
    rendererSafeSummary:
      "Meta-orchestrator shadow objects registered by exact digest; shallow transition state was not upgraded into semantic assurance.",
    now: input.now,
  });
  return deepFreeze({
    schema: META_ORCHESTRATOR_ADAPTER_SCHEMA,
    requestRef,
    lifecycle,
    assuranceGraph,
    producerAssignment,
    artifactRevision,
    sourceArtifactRef: legacyArtifact
      ? legacyArtifactRef(legacyArtifact, "legacy_artifact")
      : null,
    compatibilityAdapterReceipt: adapterReceipt,
    sourceBodyCopied: false,
    sourceClaimUpgraded: false,
    canonicalEffect: false,
  });
}

function adaptSc8Artifacts(input = {}) {
  const constitution = input.constitution;
  const workerConstitution = input.workerConstitution;
  const evidenceBundle = input.evidenceBundle;
  const closureCandidate = input.closureCandidate || null;
  validateArtifactTypeConstitution(constitution);
  if (
    !isPlainObject(workerConstitution) ||
    workerConstitution.schema !== "direct_aro_worker_constitution@1" ||
    !text(workerConstitution.digest, "") ||
    !isPlainObject(evidenceBundle) ||
    evidenceBundle.schema !== "direct_aro_execution_evidence_bundle@1" ||
    !text(evidenceBundle.digest, "")
  ) {
    fail("world_manager_artifact_sc8_source_invalid");
  }
  if (
    closureCandidate &&
    (closureCandidate.schema !== "direct_aro_closure_candidate@1" ||
      !text(closureCandidate.digest, ""))
  ) {
    fail("world_manager_artifact_sc8_closure_candidate_invalid");
  }
  const projectId = text(
    workerConstitution.projectId || evidenceBundle.projectId,
    "",
  );
  const workerRef = legacyArtifactRef(workerConstitution, "aro_worker_constitution");
  const evidenceRef = legacyArtifactRef(evidenceBundle, "aro_execution_evidence_bundle");
  const closureRef = closureCandidate
    ? legacyArtifactRef(closureCandidate, "aro_closure_candidate")
    : null;
  const requestRef = exactRef(
    input.requestRef || workerRef,
    "sc8.requestRef",
  );
  const lifecycleId = text(
    input.lifecycleId,
    stableId("wm_sc8_artifact_lifecycle", { workerRef, evidenceRef }),
  );
  const initialGraph = buildAssuranceGraph({
    constitution,
    lifecycleId,
    settledProperties: {},
    now: input.now,
  });
  const requestedLifecycle = buildArtifactLifecycleInstance({
    constitution,
    lifecycleId,
    requestRef,
    subjectScope: {
      kind: text(workerConstitution.workThreadId, "") ? "workthread" : "project",
      projectId,
      workThreadId: text(workerConstitution.workThreadId, ""),
      taskType: "implementation",
    },
    assuranceGraphRef: assuranceGraphRef(initialGraph, projectId),
    state: "requested",
    now: input.now,
  });
  const sourceRefs = [workerRef, evidenceRef, ...(closureRef ? [closureRef] : [])];
  const producerAssignment = buildProducerAssignment({
    lifecycleRef: artifactLifecycleInstanceRef(requestedLifecycle),
    lifecycleId: requestedLifecycle.lifecycleId,
    producerRole: "implementation_worker",
    producerAgentRef: workerRef,
    eligibilityRef: exactRef({
      kind: "compatibility_eligibility_receipt",
      id: `${workerConstitution.workerConstitutionId}_eligible`,
      digest: digestFor("compatibility_eligibility_receipt", {
        workerRef,
        evidenceRef,
      }),
      projectId,
    }),
    now: input.now,
  });
  const underProductionLifecycle = applyProducerAssignment({
    constitution,
    lifecycle: requestedLifecycle,
    assignment: producerAssignment,
    now: input.now,
  });
  const publication = publishArtifactRevision({
    constitution,
    lifecycle: underProductionLifecycle,
    producerAssignment,
    artifactId: text(
      closureCandidate?.closureCandidateId,
      evidenceBundle.evidenceBundleId,
    ),
    artifactContentRef: evidenceRef,
    evidenceRefs: sourceRefs,
    settledProperties: {
      compatibilitySource: "world_manager_sc8",
      sc8GateDisposition: text(closureCandidate?.gateDisposition, "unsettled"),
    },
    now: input.now,
  });
  const lifecycle = publication.lifecycle;
  const adapterReceipt = buildCompatibilityAdapterReceipt({
    sourceKind: "world_manager_sc8",
    sourceRefs,
    lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
    artifactRevisionRef: artifactRevisionRefFor(publication.revision),
    rendererSafeSummary:
      "SC8 worker, evidence, and closure candidates registered by exact refs; ready_for_review remains non-canonical and unaudited in SC11.",
    now: input.now,
  });
  return deepFreeze({
    schema: SC8_ARTIFACT_ADAPTER_SCHEMA,
    lifecycle,
    assuranceGraph: publication.graph,
    producerAssignment,
    artifactRevision: publication.revision,
    sourceRefs,
    compatibilityAdapterReceipt: adapterReceipt,
    sc8ReadyForReviewObserved:
      closureCandidate?.gateDisposition === "ready_for_review",
    sc8ReadyForReviewUpgradedToGateReady: false,
    sourceBodyCopied: false,
    canonicalEffect: false,
  });
}

class DirectArtifactLifecycleRuntime {
  constructor(options = {}) {
    this.now = options.now || Date.now;
  }

  initialize(input = {}) {
    const constitution = input.constitution;
    validateArtifactTypeConstitution(constitution);
    const lifecycleId = text(
      input.lifecycleId,
      stableId("wm_artifact_lifecycle", {
        constitutionRef: artifactTypeConstitutionRef(constitution),
        requestRef: input.requestRef,
      }),
    );
    const graph = buildAssuranceGraph({
      constitution,
      lifecycleId,
      settledProperties: {},
      now: this.now,
    });
    const lifecycle = buildArtifactLifecycleInstance({
      constitution,
      lifecycleId,
      requestRef: input.requestRef,
      subjectScope: input.subjectScope,
      assuranceGraphRef: assuranceGraphRef(
        graph,
        constitution.semanticScope.projectId,
      ),
      state: "requested",
      now: this.now,
    });
    return { lifecycle, graph };
  }

  resolveProducer(input = {}) {
    return resolveProducer({ ...input, now: this.now });
  }

  applyProducerAssignment(input = {}) {
    return applyProducerAssignment({ ...input, now: this.now });
  }

  publishRevision(input = {}) {
    return publishArtifactRevision({ ...input, now: this.now });
  }

  routeAudits(input = {}) {
    return resolveAuditRouting({ ...input, now: this.now });
  }

  evaluateAssurance(input = {}) {
    return evaluateAssurance({ ...input, now: this.now });
  }

  createRemand(input = {}) {
    return createRemandRouting({ ...input, now: this.now });
  }
}

module.exports = {
  ARTIFACT_ASSURANCE_JOIN_SCHEMA,
  ARTIFACT_AUDIT_ROUTING_PLAN_SCHEMA,
  ARTIFACT_ESCALATION_CANDIDATE_SCHEMA,
  ARTIFACT_PRODUCER_RESOLUTION_SCHEMA,
  ARTIFACT_REMAND_ROUTING_SCHEMA,
  DirectArtifactLifecycleRuntime,
  META_ORCHESTRATOR_ADAPTER_SCHEMA,
  SC8_ARTIFACT_ADAPTER_SCHEMA,
  adaptMetaOrchestratorShadow,
  adaptSc8Artifacts,
  applyProducerAssignment,
  createRemandRouting,
  evaluateAssurance,
  publishArtifactRevision,
  resolveAuditRouting,
  resolveProducer,
};
