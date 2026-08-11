"use strict";

const crypto = require("node:crypto");

const ARTIFACT_TYPE_CONSTITUTION_SCHEMA =
  "direct_artifact_type_constitution@1";
const ARTIFACT_LIFECYCLE_INSTANCE_SCHEMA =
  "direct_artifact_lifecycle_instance@1";
const ARTIFACT_REVISION_SCHEMA =
  "direct_artifact_revision@1";
const ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA =
  "direct_artifact_producer_assignment@1";
const ARTIFACT_AUDIT_REQUIREMENT_SCHEMA =
  "direct_artifact_audit_requirement@1";
const ARTIFACT_CONDITIONAL_AUDIT_RULE_SCHEMA =
  "direct_artifact_conditional_audit_rule@1";
const ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA =
  "direct_artifact_audit_assignment@1";
const ARTIFACT_AUDIT_ASSESSMENT_SCHEMA =
  "direct_artifact_audit_assessment@1";
const ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA =
  "direct_artifact_mechanical_witness_join@1";
const ARTIFACT_ASSURANCE_GRAPH_SCHEMA =
  "direct_artifact_assurance_graph@1";
const ARTIFACT_AUDIT_INVALIDATION_SCHEMA =
  "direct_artifact_audit_invalidation@1";
const ARTIFACT_REMAND_OBLIGATION_SCHEMA =
  "direct_artifact_remand_obligation@1";
const ARTIFACT_GATE_DECISION_SCHEMA =
  "direct_artifact_gate_decision@1";
const ARTIFACT_ADMISSION_RECEIPT_CANDIDATE_SCHEMA =
  "direct_artifact_admission_receipt_candidate@1";
const ARTIFACT_LIFECYCLE_COMPATIBILITY_ADAPTER_SCHEMA =
  "direct_artifact_lifecycle_compatibility_adapter@1";

const LIFECYCLE_STATES = new Set([
  "requested",
  "under_production",
  "candidate",
  "under_audit",
  "remanded",
  "gate_ready",
  "admission_pending",
  "admitted",
  "rejected",
  "superseded",
  "stale",
]);
const TERMINAL_LIFECYCLE_STATES = new Set([
  "admitted",
  "rejected",
  "superseded",
]);
const REQUIREMENT_KINDS = new Set([
  "mechanical_witness",
  "semantic_audit",
]);
const REQUIREMENT_STATES = new Set([
  "inactive",
  "pending",
  "supported",
  "contradicted",
  "requires_revision",
  "blocked",
  "stale",
]);
const AUDIT_VERDICTS = new Set([
  "supported",
  "contradicted",
  "requires_revision",
  "blocked",
]);
const GATE_DECISION_STATES = new Set([
  "blocked",
  "gate_ready",
  "escalation_required",
]);
const ASSURANCE_ROOT_KINDS = new Set([
  "deterministic_validator",
  "authorized_human",
  "trusted_auditor",
]);
const PREDICATE_OPERATORS = new Set([
  "equals",
  "not_equals",
  "includes",
  "not_includes",
  "in",
  "exists",
]);
const COMPATIBILITY_SOURCE_KINDS = new Set([
  "direct_meta_orchestrator_shadow",
  "world_manager_sc8",
]);

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

function bounded(value, fallback = "", max = 1_200) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source.slice(0, max - 1).trimEnd()}…`
    : source;
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

function digestFor(domain, value, omittedFields = []) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      `${domain}\0${JSON.stringify(
        stableValue(value, new Set(omittedFields)),
      )}`,
    )
    .digest("hex")}`;
}

function stableId(prefix, value, length = 24) {
  return `${prefix}_${digestFor(`${prefix}@1`, value).slice(
    7,
    7 + length,
  )}`;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id || value.refId || value.artifactId, ""),
    digest: text(
      value.digest || value.artifactDigest || value.sourceDigest,
      "",
    ),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail("world_manager_artifact_lifecycle_ref_invalid", label);
  }
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  const labelText = bounded(value.label || value.rendererSafeLabel, "", 160);
  if (labelText) ref.label = labelText;
  return ref;
}

function uniqueRefs(value = [], label = "refs") {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => exactRef(entry, `${label}.${index}`))
    .filter((ref) => {
      const key = exactRefKey(ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function exactRefKey(ref) {
  return `${ref.kind}:${ref.id}:${ref.digest}`;
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
      right &&
      left.kind === right.kind &&
      left.id === right.id &&
      left.digest === right.digest,
  );
}

function normalizeScope(value = {}) {
  const projectId = text(value.projectId, "");
  const workThreadId = text(value.workThreadId, "");
  const kind = text(
    value.kind,
    workThreadId ? "workthread" : projectId ? "project" : "user_world",
  );
  if (
    ![
      "user_world",
      "project",
      "task",
      "workthread",
      "artifact",
    ].includes(kind)
  ) {
    fail("world_manager_artifact_lifecycle_scope_invalid", kind);
  }
  if (["project", "task", "workthread", "artifact"].includes(kind) && !projectId) {
    fail("world_manager_artifact_lifecycle_scope_project_required", kind);
  }
  if (kind === "workthread" && !workThreadId) {
    fail("world_manager_artifact_lifecycle_scope_workthread_required");
  }
  return {
    kind,
    userWorldId: text(value.userWorldId, "user_world_local"),
    projectId,
    taskType: text(value.taskType, ""),
    workThreadId,
    artifactLifecycleId: text(value.artifactLifecycleId, ""),
  };
}

function sameScope(left = {}, right = {}) {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  return (
    a.userWorldId === b.userWorldId &&
    a.projectId === b.projectId &&
    (!a.workThreadId || !b.workThreadId || a.workThreadId === b.workThreadId)
  );
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

function artifact(schema, idField, id, body) {
  const value = {
    schema,
    [idField]: id,
    ...body,
  };
  value.digest = digestFor(schema, value, ["digest"]);
  return deepFreeze(value);
}

function validateArtifact(value, schema, idField, code) {
  if (
    !isPlainObject(value) ||
    value.schema !== schema ||
    !text(value[idField], "") ||
    value.digest !== digestFor(schema, value, ["digest"])
  ) {
    fail(code, text(value?.[idField], schema));
  }
  return true;
}

function artifactExactRef(kind, value, idField, projectId = "") {
  return exactRef({
    kind,
    id: value[idField],
    digest: value.digest,
    ...(projectId ? { projectId } : {}),
  });
}

function normalizeAssuranceRoot(input = {}) {
  const root = {
    rootKind: text(input.rootKind, ""),
    rootRef: exactRef(input.rootRef, "assuranceRoot.rootRef"),
    permitsRecursiveAudit: input.permitsRecursiveAudit === true,
    maximumAuditDepth: Math.max(0, Number(input.maximumAuditDepth || 0) || 0),
  };
  if (!ASSURANCE_ROOT_KINDS.has(root.rootKind)) {
    fail("world_manager_artifact_assurance_root_kind_invalid", root.rootKind);
  }
  if (root.permitsRecursiveAudit && root.maximumAuditDepth < 1) {
    fail("world_manager_artifact_assurance_root_depth_invalid");
  }
  return root;
}

function buildMechanicalWitnessRequirement(input = {}, index = 0) {
  const requirementId = text(
    input.requirementId,
    `mechanical_witness_${index + 1}`,
  );
  if (!text(input.witnessKind, "")) {
    fail("world_manager_artifact_mechanical_witness_kind_required", requirementId);
  }
  return {
    schema: ARTIFACT_AUDIT_REQUIREMENT_SCHEMA,
    requirementId,
    requirementKind: "mechanical_witness",
    witnessKind: text(input.witnessKind, ""),
    required: input.required !== false,
    dependencyRequirementIds: stringList(input.dependencyRequirementIds),
    freshnessPolicyRef: exactRef(
      input.freshnessPolicyRef,
      `${requirementId}.freshnessPolicyRef`,
    ),
    rendererSafeSummary: bounded(
      input.rendererSafeSummary,
      input.witnessKind,
      320,
    ),
  };
}

function buildAuditRequirement(input = {}, index = 0) {
  const requirementId = text(
    input.requirementId,
    `semantic_audit_${index + 1}`,
  );
  const auditType = text(input.auditType, "");
  if (!auditType) {
    fail("world_manager_artifact_semantic_audit_type_required", requirementId);
  }
  return {
    schema: ARTIFACT_AUDIT_REQUIREMENT_SCHEMA,
    requirementId,
    requirementKind: "semantic_audit",
    auditType,
    required: input.required !== false,
    dependencyRequirementIds: stringList(input.dependencyRequirementIds),
    auditorEligibilityRef: exactRef(
      input.auditorEligibilityRef,
      `${requirementId}.auditorEligibilityRef`,
    ),
    verdictPolicyRef: exactRef(
      input.verdictPolicyRef,
      `${requirementId}.verdictPolicyRef`,
    ),
    reusableInvariantEvidence: input.reusableInvariantEvidence === true,
    rendererSafeSummary: bounded(
      input.rendererSafeSummary,
      auditType,
      320,
    ),
  };
}

function normalizePredicateClause(input = {}, label = "predicate") {
  const operator = text(input.operator, "equals");
  const path = text(input.path, "");
  if (!path || !PREDICATE_OPERATORS.has(operator)) {
    fail("world_manager_artifact_conditional_predicate_invalid", label);
  }
  return {
    path,
    operator,
    ...(operator === "exists" ? {} : { expected: input.expected }),
  };
}

function buildConditionalAuditRule(input = {}, index = 0) {
  const ruleId = text(input.ruleId, `conditional_audit_${index + 1}`);
  const clauses = (Array.isArray(input.allOf) ? input.allOf : [])
    .map((entry, clauseIndex) =>
      normalizePredicateClause(entry, `${ruleId}.allOf.${clauseIndex}`),
    );
  if (!clauses.length) {
    fail("world_manager_artifact_conditional_rule_empty", ruleId);
  }
  return {
    schema: ARTIFACT_CONDITIONAL_AUDIT_RULE_SCHEMA,
    ruleId,
    allOf: clauses,
    auditRequirement: buildAuditRequirement(
      input.auditRequirement,
      index,
    ),
    settledPropertySourceRef: exactRef(
      input.settledPropertySourceRef,
      `${ruleId}.settledPropertySourceRef`,
    ),
  };
}

function allRequirements(constitution) {
  return [
    ...constitution.requiredMechanicalWitnesses,
    ...constitution.requiredSemanticAudits,
    ...constitution.conditionalAuditRules.map((rule) => rule.auditRequirement),
  ];
}

function assertUniqueRequirementIds(requirements) {
  const seen = new Set();
  for (const requirement of requirements) {
    if (
      requirement.schema !== ARTIFACT_AUDIT_REQUIREMENT_SCHEMA ||
      !REQUIREMENT_KINDS.has(requirement.requirementKind) ||
      requirement.required !== true && requirement.required !== false
    ) {
      fail(
        "world_manager_artifact_requirement_invalid",
        text(requirement.requirementId, "missing"),
      );
    }
    if (seen.has(requirement.requirementId)) {
      fail(
        "world_manager_artifact_requirement_id_duplicate",
        requirement.requirementId,
      );
    }
    seen.add(requirement.requirementId);
  }
}

function assertAcyclicRequirements(requirements) {
  assertUniqueRequirementIds(requirements);
  const byId = new Map(
    requirements.map((requirement) => [requirement.requirementId, requirement]),
  );
  for (const requirement of requirements) {
    for (const dependencyId of requirement.dependencyRequirementIds) {
      if (!byId.has(dependencyId)) {
        fail(
          "world_manager_artifact_assurance_dependency_unknown",
          `${requirement.requirementId}->${dependencyId}`,
        );
      }
      if (dependencyId === requirement.requirementId) {
        fail(
          "world_manager_artifact_assurance_cycle",
          requirement.requirementId,
        );
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(requirementId, path = []) {
    if (visiting.has(requirementId)) {
      fail(
        "world_manager_artifact_assurance_cycle",
        [...path, requirementId].join("->"),
      );
    }
    if (visited.has(requirementId)) return;
    visiting.add(requirementId);
    const requirement = byId.get(requirementId);
    for (const dependencyId of requirement.dependencyRequirementIds) {
      visit(dependencyId, [...path, requirementId]);
    }
    visiting.delete(requirementId);
    visited.add(requirementId);
  }
  for (const requirementId of byId.keys()) visit(requirementId);
  return true;
}

function buildArtifactTypeConstitution(input = {}) {
  const artifactTypeId = text(input.artifactTypeId, "");
  const revision = Number(input.revision || 1);
  if (!artifactTypeId || !Number.isInteger(revision) || revision < 1) {
    fail("world_manager_artifact_type_constitution_identity_invalid");
  }
  const requiredMechanicalWitnesses = (
    Array.isArray(input.requiredMechanicalWitnesses)
      ? input.requiredMechanicalWitnesses
      : []
  ).map(buildMechanicalWitnessRequirement);
  const requiredSemanticAudits = (
    Array.isArray(input.requiredSemanticAudits)
      ? input.requiredSemanticAudits
      : []
  ).map(buildAuditRequirement);
  const conditionalAuditRules = (
    Array.isArray(input.conditionalAuditRules)
      ? input.conditionalAuditRules
      : []
  ).map(buildConditionalAuditRule);
  const requirements = [
    ...requiredMechanicalWitnesses,
    ...requiredSemanticAudits,
    ...conditionalAuditRules.map((rule) => rule.auditRequirement),
  ];
  assertAcyclicRequirements(requirements);
  const admissionReceiptRef = exactRef(
    input.constitutionAdmissionReceiptRef,
    "constitutionAdmissionReceiptRef",
  );
  const value = artifact(
    ARTIFACT_TYPE_CONSTITUTION_SCHEMA,
    "artifactTypeConstitutionId",
    text(
      input.artifactTypeConstitutionId,
      stableId("wm_artifact_type_constitution", {
        artifactTypeId,
        revision,
        admissionReceiptRef,
      }),
    ),
    {
      artifactTypeId,
      semanticScope: normalizeScope(input.semanticScope),
      producedObjectKindRefs: uniqueRefs(
        input.producedObjectKindRefs,
        "producedObjectKindRefs",
      ),
      producerEligibilityRef: exactRef(
        input.producerEligibilityRef,
        "producerEligibilityRef",
      ),
      requiredMechanicalWitnesses,
      requiredSemanticAudits,
      conditionalAuditRules,
      auditorIndependenceRuleRef: exactRef(
        input.auditorIndependenceRuleRef,
        "auditorIndependenceRuleRef",
      ),
      lifecycleGatePolicyRef: exactRef(
        input.lifecycleGatePolicyRef,
        "lifecycleGatePolicyRef",
      ),
      admissionAuthorityRef: exactRef(
        input.admissionAuthorityRef,
        "admissionAuthorityRef",
      ),
      remandPolicyRef: exactRef(input.remandPolicyRef, "remandPolicyRef"),
      escalationPolicyRef: exactRef(
        input.escalationPolicyRef,
        "escalationPolicyRef",
      ),
      notificationStandingRefs: uniqueRefs(
        input.notificationStandingRefs,
        "notificationStandingRefs",
      ),
      budgetPolicyRef: exactRef(input.budgetPolicyRef, "budgetPolicyRef"),
      assuranceRootPolicyRef: exactRef(
        input.assuranceRootPolicyRef,
        "assuranceRootPolicyRef",
      ),
      assuranceRoots: (Array.isArray(input.assuranceRoots)
        ? input.assuranceRoots
        : []
      ).map(normalizeAssuranceRoot),
      constitutionAdmissionReceiptRef: admissionReceiptRef,
      revision,
      canonical: true,
      activationEligible: true,
      grantsAuthority: false,
      rawChainOfThoughtIncluded: false,
      rawSecretIncluded: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateArtifactTypeConstitution(value);
  return value;
}

function validateArtifactTypeConstitution(value) {
  validateArtifact(
    value,
    ARTIFACT_TYPE_CONSTITUTION_SCHEMA,
    "artifactTypeConstitutionId",
    "world_manager_artifact_type_constitution_invalid",
  );
  if (
    !text(value.artifactTypeId, "") ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.canonical !== true ||
    value.activationEligible !== true ||
    value.grantsAuthority !== false ||
    value.rawChainOfThoughtIncluded !== false ||
    value.rawSecretIncluded !== false
  ) {
    fail("world_manager_artifact_type_constitution_boundary_invalid");
  }
  if (!Array.isArray(value.assuranceRoots) || !value.assuranceRoots.length) {
    fail("world_manager_artifact_assurance_root_required");
  }
  value.assuranceRoots.forEach(normalizeAssuranceRoot);
  normalizeScope(value.semanticScope);
  exactRef(value.constitutionAdmissionReceiptRef, "constitutionAdmissionReceiptRef");
  exactRef(value.admissionAuthorityRef, "admissionAuthorityRef");
  exactRef(value.assuranceRootPolicyRef, "assuranceRootPolicyRef");
  assertAcyclicRequirements(allRequirements(value));
  return true;
}

function artifactTypeConstitutionRef(value) {
  validateArtifactTypeConstitution(value);
  return artifactExactRef(
    "artifact_type_constitution",
    value,
    "artifactTypeConstitutionId",
    value.semanticScope.projectId,
  );
}

function getPath(source, path) {
  let current = source;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return { present: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { present: false, value: undefined };
    }
    current = current[segment];
  }
  return { present: true, value: current };
}

function evaluatePredicateClause(clause, settledProperties) {
  const actual = getPath(settledProperties, clause.path);
  if (clause.operator === "exists") {
    return {
      state: "evaluated",
      matched: actual.present === Boolean(clause.expected ?? true),
    };
  }
  if (!actual.present) return { state: "indeterminate", matched: false };
  let matched = false;
  if (clause.operator === "equals") matched = actual.value === clause.expected;
  if (clause.operator === "not_equals") matched = actual.value !== clause.expected;
  if (clause.operator === "includes") {
    matched = Array.isArray(actual.value)
      ? actual.value.includes(clause.expected)
      : typeof actual.value === "string" &&
        actual.value.includes(String(clause.expected));
  }
  if (clause.operator === "not_includes") {
    matched = Array.isArray(actual.value)
      ? !actual.value.includes(clause.expected)
      : typeof actual.value === "string" &&
        !actual.value.includes(String(clause.expected));
  }
  if (clause.operator === "in") {
    matched = Array.isArray(clause.expected) &&
      clause.expected.includes(actual.value);
  }
  return { state: "evaluated", matched };
}

function evaluateConditionalAuditRule(rule, settledProperties = {}) {
  const clauseResults = rule.allOf.map((clause) => ({
    clause,
    ...evaluatePredicateClause(clause, settledProperties),
  }));
  const evaluationState = clauseResults.some(
    (result) => result.state === "indeterminate",
  )
    ? "indeterminate"
    : "evaluated";
  return {
    ruleId: rule.ruleId,
    evaluationState,
    activated:
      evaluationState === "evaluated" &&
      clauseResults.every((result) => result.matched),
    clauseResults,
  };
}

function buildAssuranceGraph(input = {}) {
  const constitution = input.constitution;
  validateArtifactTypeConstitution(constitution);
  const lifecycleId = text(input.lifecycleId, "");
  if (!lifecycleId) {
    fail("world_manager_artifact_assurance_graph_lifecycle_required");
  }
  const artifactRevisionRef = input.artifactRevision
    ? artifactRevisionRefFor(input.artifactRevision)
    : input.artifactRevisionRef
      ? exactRef(input.artifactRevisionRef, "artifactRevisionRef")
      : null;
  const conditionalEvaluations = constitution.conditionalAuditRules.map(
    (rule) => evaluateConditionalAuditRule(rule, input.settledProperties || {}),
  );
  const activeConditionalIds = new Set(
    conditionalEvaluations
      .filter((evaluation) => evaluation.activated)
      .map((evaluation) => evaluation.ruleId),
  );
  const conditionalByRequirement = new Map(
    constitution.conditionalAuditRules.map((rule) => [
      rule.auditRequirement.requirementId,
      rule,
    ]),
  );
  const nodes = allRequirements(constitution).map((requirement) => {
    const conditionalRule = conditionalByRequirement.get(
      requirement.requirementId,
    );
    const active = !conditionalRule || activeConditionalIds.has(conditionalRule.ruleId);
    return {
      nodeId: requirement.requirementId,
      requirementKind: requirement.requirementKind,
      required: requirement.required,
      active,
      state: active ? "pending" : "inactive",
      dependencyNodeIds: requirement.dependencyRequirementIds,
      artifactRevisionRef,
      requirement,
    };
  });
  assertAcyclicRequirements(nodes.map((node) => node.requirement));
  const graphId = text(
    input.assuranceGraphId,
    stableId("wm_artifact_assurance_graph", {
      lifecycleId,
      graphRevision: Number(input.graphRevision || 1),
      constitutionRef: artifactTypeConstitutionRef(constitution),
      artifactRevisionRef,
      conditionalEvaluations,
    }),
  );
  const graph = artifact(
    ARTIFACT_ASSURANCE_GRAPH_SCHEMA,
    "assuranceGraphId",
    graphId,
    {
      lifecycleId,
      graphRevision: Number(input.graphRevision || 1),
      predecessorRef: input.predecessorRef
        ? exactRef(input.predecessorRef, "assuranceGraph.predecessorRef")
        : null,
      artifactTypeConstitutionRef: artifactTypeConstitutionRef(constitution),
      artifactRevisionRef,
      nodes,
      edges: nodes.flatMap((node) =>
        node.dependencyNodeIds.map((dependencyNodeId) => ({
          fromNodeId: dependencyNodeId,
          toNodeId: node.nodeId,
        })),
      ),
      conditionalEvaluations,
      assuranceRootPolicyRef: constitution.assuranceRootPolicyRef,
      assuranceRoots: constitution.assuranceRoots,
      rootPolicyApplied: true,
      cycleFree: true,
      joinState: artifactRevisionRef ? "pending" : "awaiting_revision",
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateAssuranceGraph(graph);
  return graph;
}

function validateAssuranceGraph(value) {
  validateArtifact(
    value,
    ARTIFACT_ASSURANCE_GRAPH_SCHEMA,
    "assuranceGraphId",
    "world_manager_artifact_assurance_graph_invalid",
  );
  if (
    !text(value.lifecycleId, "") ||
    !Number.isInteger(value.graphRevision) ||
    value.graphRevision < 1 ||
    (value.graphRevision === 1) === Boolean(value.predecessorRef) ||
    value.rootPolicyApplied !== true ||
    value.cycleFree !== true ||
    value.canonicalEffect !== false ||
    !["awaiting_revision", "pending", "supported", "blocked", "remanded"].includes(
      value.joinState,
    )
  ) {
    fail("world_manager_artifact_assurance_graph_boundary_invalid");
  }
  for (const node of value.nodes) {
    if (
      !text(node.nodeId, "") ||
      !REQUIREMENT_KINDS.has(node.requirementKind) ||
      !REQUIREMENT_STATES.has(node.state) ||
      node.active !== (node.state !== "inactive")
    ) {
      fail("world_manager_artifact_assurance_node_invalid", node.nodeId);
    }
    if (
      value.artifactRevisionRef &&
      !exactRefMatches(node.artifactRevisionRef, value.artifactRevisionRef)
    ) {
      fail("world_manager_artifact_assurance_node_revision_mismatch", node.nodeId);
    }
  }
  const requirements = value.nodes.map((node) => node.requirement);
  assertAcyclicRequirements(requirements);
  return true;
}

function reviseAssuranceGraph(previous, input = {}) {
  validateAssuranceGraph(previous);
  const {
    assuranceGraphId: _previousGraphId,
    digest: _previousDigest,
    ...previousBody
  } = previous;
  const allowedNodeStates = new Map(
    Object.entries(input.nodeStates || {}),
  );
  const nodes = previous.nodes.map((node) => {
    const state = allowedNodeStates.has(node.nodeId)
      ? text(allowedNodeStates.get(node.nodeId), "")
      : node.state;
    if (!REQUIREMENT_STATES.has(state)) {
      fail(
        "world_manager_artifact_assurance_node_state_invalid",
        `${node.nodeId}:${state}`,
      );
    }
    if (!node.active && state !== "inactive") {
      fail(
        "world_manager_artifact_assurance_inactive_node_transition",
        node.nodeId,
      );
    }
    return { ...node, state };
  });
  for (const nodeId of allowedNodeStates.keys()) {
    if (!nodes.some((node) => node.nodeId === nodeId)) {
      fail("world_manager_artifact_assurance_node_unknown", nodeId);
    }
  }
  const joinState = text(input.joinState, previous.joinState);
  if (!["awaiting_revision", "pending", "supported", "blocked", "remanded"].includes(joinState)) {
    fail("world_manager_artifact_assurance_join_state_invalid", joinState);
  }
  const graph = artifact(
    ARTIFACT_ASSURANCE_GRAPH_SCHEMA,
    "assuranceGraphId",
    text(
      input.assuranceGraphId,
      stableId("wm_artifact_assurance_graph", {
        lifecycleId: previous.lifecycleId,
        graphRevision: previous.graphRevision + 1,
        predecessorRef: assuranceGraphRef(previous),
        nodeStates: Object.fromEntries(nodes.map((node) => [node.nodeId, node.state])),
        joinState,
      }),
    ),
    {
      ...previousBody,
      graphRevision: previous.graphRevision + 1,
      predecessorRef: assuranceGraphRef(previous),
      nodes,
      joinState,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateAssuranceGraph(graph);
  return graph;
}

function assuranceGraphRef(value, projectId = "") {
  validateAssuranceGraph(value);
  return artifactExactRef(
    "artifact_assurance_graph",
    value,
    "assuranceGraphId",
    projectId,
  );
}

function buildArtifactLifecycleInstance(input = {}) {
  const constitution = input.constitution;
  validateArtifactTypeConstitution(constitution);
  const requestRef = exactRef(input.requestRef, "requestRef");
  const subjectScope = normalizeScope(input.subjectScope);
  if (!sameScope(constitution.semanticScope, subjectScope)) {
    fail("world_manager_artifact_lifecycle_scope_mismatch");
  }
  const lifecycleRevision = Number(input.lifecycleRevision || 1);
  if (!Number.isInteger(lifecycleRevision) || lifecycleRevision < 1) {
    fail("world_manager_artifact_lifecycle_revision_invalid");
  }
  const predecessorRef = input.predecessorRef
    ? exactRef(input.predecessorRef, "lifecycle.predecessorRef")
    : null;
  if ((lifecycleRevision === 1) === Boolean(predecessorRef)) {
    fail("world_manager_artifact_lifecycle_lineage_invalid");
  }
  const lifecycleId = text(
    input.lifecycleId,
    stableId("wm_artifact_lifecycle", {
      constitutionRef: artifactTypeConstitutionRef(constitution),
      requestRef,
      subjectScope,
    }),
  );
  const state = text(input.state, "requested");
  if (!LIFECYCLE_STATES.has(state)) {
    fail("world_manager_artifact_lifecycle_state_invalid", state);
  }
  const value = artifact(
    ARTIFACT_LIFECYCLE_INSTANCE_SCHEMA,
    "lifecycleInstanceRevisionId",
    text(
      input.lifecycleInstanceRevisionId,
      stableId("wm_artifact_lifecycle_revision", {
        lifecycleId,
        lifecycleRevision,
        state,
        predecessorRef,
      }),
    ),
    {
      lifecycleId,
      lifecycleRevision,
      predecessorRef,
      artifactTypeConstitutionRef: artifactTypeConstitutionRef(constitution),
      pinnedConstitutionRevision: constitution.revision,
      requestRef,
      subjectScope,
      producerAssignmentRef: input.producerAssignmentRef
        ? exactRef(input.producerAssignmentRef, "producerAssignmentRef")
        : null,
      currentArtifactRevisionRef: input.currentArtifactRevisionRef
        ? exactRef(input.currentArtifactRevisionRef, "currentArtifactRevisionRef")
        : null,
      assuranceGraphRef: exactRef(input.assuranceGraphRef, "assuranceGraphRef"),
      gateDecisionRef: input.gateDecisionRef
        ? exactRef(input.gateDecisionRef, "gateDecisionRef")
        : null,
      state,
      remandCount: Math.max(0, Number(input.remandCount || 0) || 0),
      budgetUsage: {
        attempts: Math.max(0, Number(input.budgetUsage?.attempts || 0) || 0),
        remands: Math.max(0, Number(input.budgetUsage?.remands || 0) || 0),
        audits: Math.max(0, Number(input.budgetUsage?.audits || 0) || 0),
      },
      terminal: TERMINAL_LIFECYCLE_STATES.has(state),
      canonicalAdmissionEffect: state === "admitted",
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateArtifactLifecycleInstance(value);
  return value;
}

function validateArtifactLifecycleInstance(value) {
  validateArtifact(
    value,
    ARTIFACT_LIFECYCLE_INSTANCE_SCHEMA,
    "lifecycleInstanceRevisionId",
    "world_manager_artifact_lifecycle_instance_invalid",
  );
  if (
    !text(value.lifecycleId, "") ||
    !Number.isInteger(value.lifecycleRevision) ||
    value.lifecycleRevision < 1 ||
    !LIFECYCLE_STATES.has(value.state) ||
    value.terminal !== TERMINAL_LIFECYCLE_STATES.has(value.state) ||
    value.canonicalAdmissionEffect !== (value.state === "admitted")
  ) {
    fail("world_manager_artifact_lifecycle_instance_boundary_invalid");
  }
  if ((value.lifecycleRevision === 1) === Boolean(value.predecessorRef)) {
    fail("world_manager_artifact_lifecycle_lineage_invalid");
  }
  if (
    value.state === "under_production" &&
    !value.producerAssignmentRef
  ) {
    fail("world_manager_artifact_lifecycle_producer_assignment_required");
  }
  if (
    [
      "candidate",
      "under_audit",
      "remanded",
      "gate_ready",
      "admission_pending",
      "admitted",
      "rejected",
      "superseded",
      "stale",
    ].includes(value.state) &&
    (!value.producerAssignmentRef || !value.currentArtifactRevisionRef)
  ) {
    fail("world_manager_artifact_lifecycle_current_revision_required", value.state);
  }
  if (value.state === "gate_ready" && !value.gateDecisionRef) {
    fail("world_manager_artifact_lifecycle_gate_decision_required");
  }
  exactRef(value.artifactTypeConstitutionRef, "artifactTypeConstitutionRef");
  exactRef(value.assuranceGraphRef, "assuranceGraphRef");
  normalizeScope(value.subjectScope);
  return true;
}

function artifactLifecycleInstanceRef(value) {
  validateArtifactLifecycleInstance(value);
  return artifactExactRef(
    "artifact_lifecycle_instance",
    value,
    "lifecycleInstanceRevisionId",
    value.subjectScope.projectId,
  );
}

function reviseArtifactLifecycleInstance(previous, input = {}) {
  validateArtifactLifecycleInstance(previous);
  if (TERMINAL_LIFECYCLE_STATES.has(previous.state)) {
    fail("world_manager_artifact_lifecycle_terminal_revision_forbidden", previous.state);
  }
  const constitution = input.constitution;
  validateArtifactTypeConstitution(constitution);
  const pinned = artifactTypeConstitutionRef(constitution);
  if (!exactRefMatches(previous.artifactTypeConstitutionRef, pinned)) {
    fail("world_manager_artifact_lifecycle_constitution_migration_required");
  }
  return buildArtifactLifecycleInstance({
    constitution,
    lifecycleId: previous.lifecycleId,
    lifecycleRevision: previous.lifecycleRevision + 1,
    predecessorRef: artifactLifecycleInstanceRef(previous),
    requestRef: previous.requestRef,
    subjectScope: previous.subjectScope,
    producerAssignmentRef:
      Object.prototype.hasOwnProperty.call(input, "producerAssignmentRef")
        ? input.producerAssignmentRef
        : previous.producerAssignmentRef,
    currentArtifactRevisionRef:
      Object.prototype.hasOwnProperty.call(input, "currentArtifactRevisionRef")
        ? input.currentArtifactRevisionRef
        : previous.currentArtifactRevisionRef,
    assuranceGraphRef: Object.prototype.hasOwnProperty.call(input, "assuranceGraphRef")
      ? input.assuranceGraphRef
      : previous.assuranceGraphRef,
    gateDecisionRef: Object.prototype.hasOwnProperty.call(input, "gateDecisionRef")
      ? input.gateDecisionRef
      : previous.gateDecisionRef,
    state: input.state ?? previous.state,
    remandCount: input.remandCount ?? previous.remandCount,
    budgetUsage: input.budgetUsage ?? previous.budgetUsage,
    createdAt: input.createdAt,
    now: input.now,
  });
}

function buildProducerAssignment(input = {}) {
  const lifecycleRef = exactRef(input.lifecycleRef, "producer.lifecycleRef");
  const lifecycleId = text(input.lifecycleId, "");
  const producerRole = text(input.producerRole, "");
  const producerAgentRef = exactRef(input.producerAgentRef, "producerAgentRef");
  const producerRunRef = input.producerRunRef
    ? exactRef(input.producerRunRef, "producerRunRef")
    : null;
  if (!producerRole || !lifecycleId) {
    fail("world_manager_artifact_producer_role_required");
  }
  const assignmentId = text(
    input.assignmentId,
    stableId("wm_artifact_producer_assignment", {
      lifecycleRef,
      producerRole,
      producerAgentRef,
    }),
  );
  const value = artifact(
    ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA,
    "assignmentId",
    assignmentId,
    {
      lifecycleRef,
      lifecycleId,
      producerRole,
      producerAgentRef,
      producerRunRef,
      eligibilityRef: exactRef(input.eligibilityRef, "producer.eligibilityRef"),
      assignmentPosture: "candidate",
      providerLaunchAuthorized: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateProducerAssignment(value);
  return value;
}

function validateProducerAssignment(value) {
  validateArtifact(
    value,
    ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA,
    "assignmentId",
    "world_manager_artifact_producer_assignment_invalid",
  );
  if (
    !text(value.producerRole, "") ||
    !text(value.lifecycleId, "") ||
    value.assignmentPosture !== "candidate" ||
    value.providerLaunchAuthorized !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_producer_assignment_boundary_invalid");
  }
  exactRef(value.lifecycleRef, "producer.lifecycleRef");
  exactRef(value.producerAgentRef, "producer.producerAgentRef");
  return true;
}

function producerAssignmentRef(value, projectId = "") {
  validateProducerAssignment(value);
  return artifactExactRef(
    "artifact_producer_assignment",
    value,
    "assignmentId",
    projectId,
  );
}

function buildArtifactRevision(input = {}) {
  const lifecycleRef = exactRef(input.lifecycleRef, "revision.lifecycleRef");
  const constitutionRef = exactRef(
    input.artifactTypeConstitutionRef,
    "revision.artifactTypeConstitutionRef",
  );
  const contentRef = exactRef(input.artifactContentRef, "artifactContentRef");
  const assignmentRef = exactRef(
    input.producerAssignmentRef,
    "revision.producerAssignmentRef",
  );
  const revision = Number(input.revision || 1);
  const predecessorRef = input.predecessorRef
    ? exactRef(input.predecessorRef, "revision.predecessorRef")
    : null;
  if (
    !Number.isInteger(revision) ||
    revision < 1 ||
    (revision === 1) === Boolean(predecessorRef)
  ) {
    fail("world_manager_artifact_revision_lineage_invalid");
  }
  const artifactId = text(input.artifactId, "");
  const lifecycleId = text(input.lifecycleId, "");
  if (!artifactId || !lifecycleId) {
    fail("world_manager_artifact_revision_identity_required");
  }
  const value = artifact(
    ARTIFACT_REVISION_SCHEMA,
    "artifactRevisionId",
    text(
      input.artifactRevisionId,
      stableId("wm_artifact_revision", {
        lifecycleRef,
        artifactId,
        revision,
        contentRef,
      }),
    ),
    {
      lifecycleRef,
      artifactTypeConstitutionRef: constitutionRef,
      lifecycleId,
      artifactId,
      revision,
      predecessorRef,
      artifactContentRef: contentRef,
      artifactDigest: contentRef.digest,
      producerAssignmentRef: assignmentRef,
      producerRunRef: input.producerRunRef
        ? exactRef(input.producerRunRef, "producerRunRef")
        : null,
      evidenceRefs: uniqueRefs(input.evidenceRefs, "revision.evidenceRefs"),
      settledProperties: isPlainObject(input.settledProperties)
        ? stableValue(input.settledProperties)
        : {},
      immutable: true,
      canonical: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateArtifactRevision(value);
  return value;
}

function validateArtifactRevision(value) {
  validateArtifact(
    value,
    ARTIFACT_REVISION_SCHEMA,
    "artifactRevisionId",
    "world_manager_artifact_revision_invalid",
  );
  if (
    !text(value.artifactId, "") ||
    !text(value.lifecycleId, "") ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    (value.revision === 1) === Boolean(value.predecessorRef) ||
    value.artifactDigest !== value.artifactContentRef?.digest ||
    value.immutable !== true ||
    value.canonical !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_revision_boundary_invalid");
  }
  exactRef(value.lifecycleRef, "revision.lifecycleRef");
  exactRef(value.artifactTypeConstitutionRef, "revision.constitutionRef");
  exactRef(value.artifactContentRef, "revision.contentRef");
  exactRef(value.producerAssignmentRef, "revision.producerAssignmentRef");
  return true;
}

function artifactRevisionRefFor(value) {
  validateArtifactRevision(value);
  return artifactExactRef(
    "artifact_revision",
    value,
    "artifactRevisionId",
    value.artifactContentRef.projectId,
  );
}

function buildAuditAssignment(input = {}) {
  const lifecycleId = text(input.lifecycleId, "");
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "auditAssignment.artifactRevisionRef",
  );
  const requirementId = text(input.requirementId, "");
  const auditorRole = text(input.auditorRole, "");
  if (!lifecycleId || !requirementId || !auditorRole) {
    fail("world_manager_artifact_audit_assignment_identity_invalid");
  }
  const value = artifact(
    ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA,
    "auditAssignmentId",
    text(
      input.auditAssignmentId,
      stableId("wm_artifact_audit_assignment", {
        artifactRevisionRef,
        requirementId,
        auditorAgentRef: input.auditorAgentRef,
      }),
    ),
    {
      lifecycleId,
      lifecycleRef: exactRef(input.lifecycleRef, "auditAssignment.lifecycleRef"),
      artifactRevisionRef,
      requirementId,
      auditType: text(input.auditType, ""),
      auditorRole,
      auditorAgentRef: exactRef(input.auditorAgentRef, "auditorAgentRef"),
      auditorRunRef: input.auditorRunRef
        ? exactRef(input.auditorRunRef, "auditorRunRef")
        : null,
      independenceReceiptRef: exactRef(
        input.independenceReceiptRef,
        "independenceReceiptRef",
      ),
      independenceRuleRef: exactRef(
        input.independenceRuleRef,
        "independenceRuleRef",
      ),
      boundedCapabilityNames: stringList(input.boundedCapabilityNames),
      assignmentPosture: "candidate",
      providerLaunchAuthorized: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateAuditAssignment(value);
  return value;
}

function validateAuditAssignment(value) {
  validateArtifact(
    value,
    ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA,
    "auditAssignmentId",
    "world_manager_artifact_audit_assignment_invalid",
  );
  if (
    !text(value.lifecycleId, "") ||
    !text(value.requirementId, "") ||
    !text(value.auditType, "") ||
    !text(value.auditorRole, "") ||
    value.assignmentPosture !== "candidate" ||
    value.providerLaunchAuthorized !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_audit_assignment_boundary_invalid");
  }
  exactRef(value.artifactRevisionRef, "auditAssignment.artifactRevisionRef");
  exactRef(value.independenceReceiptRef, "independenceReceiptRef");
  exactRef(value.independenceRuleRef, "independenceRuleRef");
  return true;
}

function auditAssignmentRef(value, projectId = "") {
  validateAuditAssignment(value);
  return artifactExactRef(
    "artifact_audit_assignment",
    value,
    "auditAssignmentId",
    projectId,
  );
}

function buildAuditAssessment(input = {}) {
  const verdict = text(input.verdict, "");
  if (!AUDIT_VERDICTS.has(verdict)) {
    fail("world_manager_artifact_audit_verdict_invalid", verdict);
  }
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "assessment.artifactRevisionRef",
  );
  const assignmentRef = exactRef(
    input.auditAssignmentRef,
    "assessment.auditAssignmentRef",
  );
  const requirementId = text(input.requirementId, "");
  if (!requirementId) {
    fail("world_manager_artifact_audit_assessment_requirement_required");
  }
  const value = artifact(
    ARTIFACT_AUDIT_ASSESSMENT_SCHEMA,
    "auditAssessmentId",
    text(
      input.auditAssessmentId,
      stableId("wm_artifact_audit_assessment", {
        assignmentRef,
        artifactRevisionRef,
        requirementId,
        verdict,
        evidenceRefs: input.evidenceRefs,
      }),
    ),
    {
      lifecycleRef: exactRef(input.lifecycleRef, "assessment.lifecycleRef"),
      artifactRevisionRef,
      auditAssignmentRef: assignmentRef,
      requirementId,
      verdict,
      findingRefs: uniqueRefs(input.findingRefs, "assessment.findingRefs"),
      evidenceRefs: uniqueRefs(input.evidenceRefs, "assessment.evidenceRefs"),
      remandObligations: stringList(input.remandObligations),
      rendererSafeSummary: bounded(
        input.rendererSafeSummary,
        `Audit ${verdict}`,
        600,
      ),
      exactRevisionAssessed: true,
      canonical: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateAuditAssessment(value);
  return value;
}

function validateAuditAssessment(value) {
  validateArtifact(
    value,
    ARTIFACT_AUDIT_ASSESSMENT_SCHEMA,
    "auditAssessmentId",
    "world_manager_artifact_audit_assessment_invalid",
  );
  if (
    !text(value.requirementId, "") ||
    !AUDIT_VERDICTS.has(value.verdict) ||
    value.exactRevisionAssessed !== true ||
    value.canonical !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_audit_assessment_boundary_invalid");
  }
  if (value.verdict === "requires_revision" && !value.remandObligations.length) {
    fail("world_manager_artifact_audit_remand_obligation_required");
  }
  exactRef(value.artifactRevisionRef, "assessment.artifactRevisionRef");
  exactRef(value.auditAssignmentRef, "assessment.auditAssignmentRef");
  return true;
}

function auditAssessmentRef(value, projectId = "") {
  validateAuditAssessment(value);
  return artifactExactRef(
    "artifact_audit_assessment",
    value,
    "auditAssessmentId",
    projectId,
  );
}

function buildMechanicalWitnessJoin(input = {}) {
  const state = text(input.state, "pending");
  if (!REQUIREMENT_STATES.has(state) || state === "inactive") {
    fail("world_manager_artifact_mechanical_witness_state_invalid", state);
  }
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "mechanicalWitness.artifactRevisionRef",
  );
  const requirementId = text(input.requirementId, "");
  if (!requirementId) {
    fail("world_manager_artifact_mechanical_witness_requirement_required");
  }
  const value = artifact(
    ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
    "mechanicalWitnessJoinId",
    text(
      input.mechanicalWitnessJoinId,
      stableId("wm_artifact_mechanical_join", {
        artifactRevisionRef,
        requirementId,
        state,
        evidenceRefs: input.evidenceRefs,
      }),
    ),
    {
      lifecycleRef: exactRef(input.lifecycleRef, "mechanicalWitness.lifecycleRef"),
      artifactRevisionRef,
      requirementId,
      state,
      evidenceRefs: uniqueRefs(input.evidenceRefs, "mechanicalWitness.evidenceRefs"),
      freshnessWitnessRef: input.freshnessWitnessRef
        ? exactRef(input.freshnessWitnessRef, "freshnessWitnessRef")
        : null,
      mechanicallyAuthored: true,
      semanticTruthClaimed: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateMechanicalWitnessJoin(value);
  return value;
}

function validateMechanicalWitnessJoin(value) {
  validateArtifact(
    value,
    ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
    "mechanicalWitnessJoinId",
    "world_manager_artifact_mechanical_witness_join_invalid",
  );
  if (
    !text(value.requirementId, "") ||
    !REQUIREMENT_STATES.has(value.state) ||
    value.state === "inactive" ||
    value.mechanicallyAuthored !== true ||
    value.semanticTruthClaimed !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_mechanical_witness_boundary_invalid");
  }
  if (value.state === "supported" && !value.evidenceRefs.length) {
    fail("world_manager_artifact_mechanical_witness_evidence_required");
  }
  exactRef(value.artifactRevisionRef, "mechanicalWitness.artifactRevisionRef");
  return true;
}

function mechanicalWitnessJoinRef(value, projectId = "") {
  validateMechanicalWitnessJoin(value);
  return artifactExactRef(
    "artifact_mechanical_witness_join",
    value,
    "mechanicalWitnessJoinId",
    projectId,
  );
}

function buildAuditInvalidation(input = {}) {
  const assessmentRef = exactRef(input.auditAssessmentRef, "auditAssessmentRef");
  const previousRevisionRef = exactRef(
    input.previousArtifactRevisionRef,
    "previousArtifactRevisionRef",
  );
  const currentRevisionRef = exactRef(
    input.currentArtifactRevisionRef,
    "currentArtifactRevisionRef",
  );
  if (exactRefMatches(previousRevisionRef, currentRevisionRef)) {
    fail("world_manager_artifact_audit_invalidation_same_revision");
  }
  return artifact(
    ARTIFACT_AUDIT_INVALIDATION_SCHEMA,
    "auditInvalidationId",
    text(
      input.auditInvalidationId,
      stableId("wm_artifact_audit_invalidation", {
        assessmentRef,
        previousRevisionRef,
        currentRevisionRef,
      }),
    ),
    {
      auditAssessmentRef: assessmentRef,
      previousArtifactRevisionRef: previousRevisionRef,
      currentArtifactRevisionRef: currentRevisionRef,
      reason: "artifact_revision_changed",
      priorAssessmentStanding: "stale",
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
}

function buildRemandObligation(input = {}) {
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "remand.artifactRevisionRef",
  );
  const obligationText = bounded(input.obligation, "", 800);
  if (!obligationText) {
    fail("world_manager_artifact_remand_obligation_required");
  }
  const value = artifact(
    ARTIFACT_REMAND_OBLIGATION_SCHEMA,
    "remandObligationId",
    text(
      input.remandObligationId,
      stableId("wm_artifact_remand_obligation", {
        artifactRevisionRef,
        sourceAssessmentRef: input.sourceAssessmentRef,
        obligationText,
      }),
    ),
    {
      lifecycleRef: exactRef(input.lifecycleRef, "remand.lifecycleRef"),
      artifactRevisionRef,
      sourceAssessmentRef: exactRef(
        input.sourceAssessmentRef,
        "remand.sourceAssessmentRef",
      ),
      obligation: obligationText,
      obligationClass: text(input.obligationClass, "revision_required"),
      blocking: input.blocking !== false,
      state: "open",
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  return value;
}

function buildArtifactGateDecision(input = {}) {
  const decisionState = text(input.decisionState, "blocked");
  if (!GATE_DECISION_STATES.has(decisionState)) {
    fail("world_manager_artifact_gate_decision_state_invalid", decisionState);
  }
  const artifactRevisionRef = exactRef(
    input.artifactRevisionRef,
    "gate.artifactRevisionRef",
  );
  const targetAdmissionScope = normalizeScope(input.targetAdmissionScope);
  const blockerCodes = stringList(input.blockerCodes);
  if (
    decisionState === "gate_ready" &&
    (blockerCodes.length ||
      input.assuranceSupported !== true ||
      input.authorityResolvable !== true)
  ) {
    fail("world_manager_artifact_gate_ready_with_blockers");
  }
  const value = artifact(
    ARTIFACT_GATE_DECISION_SCHEMA,
    "gateDecisionId",
    text(
      input.gateDecisionId,
      stableId("wm_artifact_gate_decision", {
        artifactRevisionRef,
        decisionState,
        targetAdmissionScope,
        blockerCodes,
      }),
    ),
    {
      lifecycleRef: exactRef(input.lifecycleRef, "gate.lifecycleRef"),
      artifactRevisionRef,
      assuranceGraphRef: exactRef(input.assuranceGraphRef, "gate.assuranceGraphRef"),
      decisionState,
      assuranceSupported: input.assuranceSupported === true,
      blockerCodes,
      targetAdmissionScope,
      admissionAuthorityRef: exactRef(
        input.admissionAuthorityRef,
        "gate.admissionAuthorityRef",
      ),
      authorityResolvable: input.authorityResolvable === true,
      authorityActRequired: true,
      admissionAuthorized: false,
      canonicalEffect: false,
      rendererSafeSummary: bounded(
        input.rendererSafeSummary,
        decisionState === "gate_ready"
          ? "Assurance supported; authority admission remains pending."
          : "Artifact assurance gate remains blocked.",
        500,
      ),
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateArtifactGateDecision(value);
  return value;
}

function validateArtifactGateDecision(value) {
  validateArtifact(
    value,
    ARTIFACT_GATE_DECISION_SCHEMA,
    "gateDecisionId",
    "world_manager_artifact_gate_decision_invalid",
  );
  if (
    !GATE_DECISION_STATES.has(value.decisionState) ||
    value.authorityActRequired !== true ||
    value.admissionAuthorized !== false ||
    value.canonicalEffect !== false ||
    (value.decisionState === "gate_ready" &&
      (value.blockerCodes.length ||
        value.assuranceSupported !== true ||
        value.authorityResolvable !== true))
  ) {
    fail("world_manager_artifact_gate_decision_boundary_invalid");
  }
  exactRef(value.artifactRevisionRef, "gate.artifactRevisionRef");
  normalizeScope(value.targetAdmissionScope);
  return true;
}

function artifactGateDecisionRef(value, projectId = "") {
  validateArtifactGateDecision(value);
  return artifactExactRef(
    "artifact_gate_decision",
    value,
    "gateDecisionId",
    projectId,
  );
}

function buildAdmissionReceiptCandidate(input = {}) {
  const gateDecision = input.gateDecision;
  validateArtifactGateDecision(gateDecision);
  if (gateDecision.decisionState !== "gate_ready") {
    fail("world_manager_artifact_admission_candidate_gate_not_ready");
  }
  const value = artifact(
    ARTIFACT_ADMISSION_RECEIPT_CANDIDATE_SCHEMA,
    "admissionReceiptCandidateId",
    text(
      input.admissionReceiptCandidateId,
      stableId("wm_artifact_admission_candidate", {
        gateDecisionRef: artifactGateDecisionRef(
          gateDecision,
          gateDecision.targetAdmissionScope.projectId,
        ),
        expectedCanonicalRevisionRefs: input.expectedCanonicalRevisionRefs,
      }),
    ),
    {
      lifecycleRef: gateDecision.lifecycleRef,
      artifactRevisionRef: gateDecision.artifactRevisionRef,
      gateDecisionRef: artifactGateDecisionRef(
        gateDecision,
        gateDecision.targetAdmissionScope.projectId,
      ),
      targetAdmissionScope: gateDecision.targetAdmissionScope,
      admissionAuthorityRef: gateDecision.admissionAuthorityRef,
      expectedCanonicalRevisionRefs: uniqueRefs(
        input.expectedCanonicalRevisionRefs,
        "expectedCanonicalRevisionRefs",
      ),
      receiptPosture: "candidate",
      authorityActRequired: true,
      trustStoreReceiptRef: null,
      admitted: false,
      canonicalEffect: false,
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  validateAdmissionReceiptCandidate(value);
  return value;
}

function validateAdmissionReceiptCandidate(value) {
  validateArtifact(
    value,
    ARTIFACT_ADMISSION_RECEIPT_CANDIDATE_SCHEMA,
    "admissionReceiptCandidateId",
    "world_manager_artifact_admission_candidate_invalid",
  );
  if (
    value.receiptPosture !== "candidate" ||
    value.authorityActRequired !== true ||
    value.trustStoreReceiptRef !== null ||
    value.admitted !== false ||
    value.canonicalEffect !== false
  ) {
    fail("world_manager_artifact_admission_candidate_boundary_invalid");
  }
  normalizeScope(value.targetAdmissionScope);
  return true;
}

function buildCompatibilityAdapterReceipt(input = {}) {
  const sourceKind = text(input.sourceKind, "");
  if (!COMPATIBILITY_SOURCE_KINDS.has(sourceKind)) {
    fail("world_manager_artifact_compatibility_source_invalid", sourceKind);
  }
  const sourceRefs = uniqueRefs(input.sourceRefs, "compatibility.sourceRefs");
  if (!sourceRefs.length) {
    fail("world_manager_artifact_compatibility_source_required");
  }
  const value = artifact(
    ARTIFACT_LIFECYCLE_COMPATIBILITY_ADAPTER_SCHEMA,
    "compatibilityAdapterId",
    text(
      input.compatibilityAdapterId,
      stableId("wm_artifact_compatibility_adapter", {
        sourceKind,
        sourceRefs,
        lifecycleRef: input.lifecycleRef,
        artifactRevisionRef: input.artifactRevisionRef,
      }),
    ),
    {
      sourceKind,
      sourceRefs,
      lifecycleRef: exactRef(input.lifecycleRef, "compatibility.lifecycleRef"),
      artifactRevisionRef: input.artifactRevisionRef
        ? exactRef(input.artifactRevisionRef, "compatibility.artifactRevisionRef")
        : null,
      sourceBodyCopied: false,
      sourceClaimUpgraded: false,
      canonicalEffect: false,
      rendererSafeSummary: bounded(
        input.rendererSafeSummary,
        "Registered legacy artifact by exact reference.",
        420,
      ),
      createdAt: text(input.createdAt, nowIso(input.now)),
    },
  );
  return value;
}

module.exports = {
  ARTIFACT_ADMISSION_RECEIPT_CANDIDATE_SCHEMA,
  ARTIFACT_ASSURANCE_GRAPH_SCHEMA,
  ARTIFACT_AUDIT_ASSESSMENT_SCHEMA,
  ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA,
  ARTIFACT_AUDIT_INVALIDATION_SCHEMA,
  ARTIFACT_AUDIT_REQUIREMENT_SCHEMA,
  ARTIFACT_CONDITIONAL_AUDIT_RULE_SCHEMA,
  ARTIFACT_GATE_DECISION_SCHEMA,
  ARTIFACT_LIFECYCLE_COMPATIBILITY_ADAPTER_SCHEMA,
  ARTIFACT_LIFECYCLE_INSTANCE_SCHEMA,
  ARTIFACT_MECHANICAL_WITNESS_JOIN_SCHEMA,
  ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA,
  ARTIFACT_REMAND_OBLIGATION_SCHEMA,
  ARTIFACT_REVISION_SCHEMA,
  ARTIFACT_TYPE_CONSTITUTION_SCHEMA,
  ASSURANCE_ROOT_KINDS,
  AUDIT_VERDICTS,
  COMPATIBILITY_SOURCE_KINDS,
  GATE_DECISION_STATES,
  LIFECYCLE_STATES,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATES,
  artifactGateDecisionRef,
  artifactLifecycleInstanceRef,
  artifactRevisionRefFor,
  artifactTypeConstitutionRef,
  assuranceGraphRef,
  assertAcyclicRequirements,
  auditAssessmentRef,
  auditAssignmentRef,
  buildAdmissionReceiptCandidate,
  buildArtifactGateDecision,
  buildArtifactLifecycleInstance,
  buildArtifactRevision,
  buildArtifactTypeConstitution,
  buildAssuranceGraph,
  buildAuditAssessment,
  buildAuditAssignment,
  buildAuditInvalidation,
  buildAuditRequirement,
  buildCompatibilityAdapterReceipt,
  buildConditionalAuditRule,
  buildMechanicalWitnessJoin,
  buildMechanicalWitnessRequirement,
  buildProducerAssignment,
  buildRemandObligation,
  digestFor,
  evaluateConditionalAuditRule,
  exactRef,
  exactRefMatches,
  mechanicalWitnessJoinRef,
  normalizeScope,
  producerAssignmentRef,
  reviseAssuranceGraph,
  reviseArtifactLifecycleInstance,
  stableId,
  validateAdmissionReceiptCandidate,
  validateArtifactGateDecision,
  validateArtifactLifecycleInstance,
  validateArtifactRevision,
  validateArtifactTypeConstitution,
  validateAssuranceGraph,
  validateAuditAssessment,
  validateAuditAssignment,
  validateMechanicalWitnessJoin,
  validateProducerAssignment,
};
