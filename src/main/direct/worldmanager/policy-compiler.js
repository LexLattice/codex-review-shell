"use strict";

const {
  validateConstitutionalPolicyRule,
  validatePolicyExceptionRule,
} = require("../worldmodel/constitutional-policy");
const { digestFor, stableId } = require("./control-plane");
const {
  validateWorldManagerTaskSettlement,
} = require("./settlement");

const POLICY_OBJECT_SCHEMA = "direct_policy_object@1";
const POLICY_EXCEPTION_SCHEMA = "direct_policy_exception@1";
const POLICY_SELECTOR_MATCH_SCHEMA = "direct_policy_selector_match@1";
const POLICY_PRECEDENCE_DECISION_SCHEMA =
  "direct_policy_precedence_decision@1";
const POLICY_CONFLICT_WITNESS_SCHEMA =
  "direct_policy_conflict_witness@1";
const RESOLVED_TASK_CONSTITUTION_SCHEMA =
  "direct_resolved_task_constitution@1";
const POLICY_PROMPT_PROJECTION_SCHEMA =
  "direct_policy_prompt_projection@1";
const POLICY_ENFORCEMENT_PROJECTION_SCHEMA =
  "direct_policy_enforcement_projection@1";
const POLICY_COMPILATION_BUNDLE_SCHEMA =
  "direct_world_manager_policy_compilation_bundle@1";

const DEONTIC_FORCES = new Set([
  "required",
  "permitted",
  "prohibited",
  "preferred",
  "discouraged",
]);
const POLICY_STRENGTHS = new Set([
  "hard_constraint",
  "default",
  "preference",
  "advisory",
]);
const POLICY_STATUSES = new Set([
  "candidate",
  "active",
  "superseded",
  "revoked",
  "expired",
]);
const EXCEPTION_STATUSES = new Set([
  "candidate",
  "active",
  "consumed",
  "expired",
  "revoked",
]);
const ENFORCEMENT_MODES = new Set([
  "capability_denial",
  "approval_gate",
  "runtime_precondition",
  "postcondition_validation",
  "prompt_instruction",
  "audit_only",
]);
const SCOPE_LIST_FIELDS = Object.freeze([
  "projectIds",
  "workThreadIds",
  "taskTypes",
  "phases",
  "environments",
  "roleKinds",
]);
const REF_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireString(value, label) {
  const result = text(value, "");
  if (!result) fail("world_manager_policy_missing_string", label);
  return result;
}

function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function exactRef(input = {}, fallbackKind = "world_manager_artifact") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: requireString(source.kind, `${fallbackKind}.kind`),
    id: requireString(source.id, `${fallbackKind}.id`),
    digest: requireString(source.digest, `${fallbackKind}.digest`),
  };
  if (!REF_DIGEST_PATTERN.test(ref.digest)) {
    fail("world_manager_policy_invalid_ref_digest", fallbackKind);
  }
  return ref;
}

function codeOwnedRef(kind, id, revision = 1) {
  return {
    kind,
    id,
    digest: digestFor(`direct-world-manager-${kind}@1`, {
      id,
      revision,
      source: "trusted_harness_code",
    }),
  };
}

function normalizeScopeSelector(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const selector = {};
  const userWorldId = text(source.userWorldId, "");
  if (userWorldId) selector.userWorldId = userWorldId;
  for (const field of SCOPE_LIST_FIELDS) {
    const values = sortedUnique(source[field]);
    if (values.length) selector[field] = values;
  }
  return selector;
}

function normalizeScopeRevisions(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => ({
      schema: text(
        entry?.schema,
        "direct_scoped_worldmodel_revision_ref@1",
      ),
      scopeKind: requireString(entry?.scopeKind, "sourceScopeRevision.scopeKind"),
      revision: Number(entry?.revision || 0),
      ...(text(entry?.projectId, "")
        ? { projectId: text(entry.projectId, "") }
        : {}),
      digest: requireString(entry?.digest, "sourceScopeRevision.digest"),
    }))
    .sort((left, right) =>
      `${left.scopeKind}:${left.projectId || ""}`.localeCompare(
        `${right.scopeKind}:${right.projectId || ""}`,
      ));
}

function buildPolicyObject(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: POLICY_OBJECT_SCHEMA,
    policyId: requireString(source.policyId, "policy.policyId"),
    identity: requireString(source.identity, "policy.identity"),
    ownerRef: exactRef(source.ownerRef, "policy.ownerRef"),
    scopeSelector: normalizeScopeSelector(source.scopeSelector),
    governedActionClasses: sortedUnique(source.governedActionClasses),
    deonticForce: source.deonticForce,
    policyStrength: source.policyStrength,
    inheritanceRuleRef: exactRef(
      source.inheritanceRuleRef,
      "policy.inheritanceRuleRef",
    ),
    ...(source.exceptionRuleRef
      ? {
          exceptionRuleRef: exactRef(
            source.exceptionRuleRef,
            "policy.exceptionRuleRef",
          ),
        }
      : {}),
    precedence: Number(source.precedence || 0),
    enforcementModes: sortedUnique(source.enforcementModes),
    provenanceRefs: (Array.isArray(source.provenanceRefs)
      ? source.provenanceRefs
      : []).map((entry) => exactRef(entry, "policy.provenanceRef")),
    authorityDecisionRef: exactRef(
      source.authorityDecisionRef,
      "policy.authorityDecisionRef",
    ),
    ...(source.supersedesPolicyRef
      ? {
          supersedesPolicyRef: exactRef(
            source.supersedesPolicyRef,
            "policy.supersedesPolicyRef",
          ),
        }
      : {}),
    policyRevision: Number(source.policyRevision || 1),
    status: text(source.status, "active"),
    sourcePosture: text(source.sourcePosture, "canonical_worldstate"),
    grantsAuthority: false,
  };
  if (!policy.governedActionClasses.length) {
    fail("world_manager_policy_actions_required", policy.policyId);
  }
  policy.digest = digestFor(POLICY_OBJECT_SCHEMA, policy, ["digest"]);
  validatePolicyObject(policy);
  return policy;
}

function validatePolicyObject(policy) {
  if (!isPlainObject(policy) || policy.schema !== POLICY_OBJECT_SCHEMA) {
    fail("world_manager_policy_object_schema_mismatch");
  }
  requireString(policy.policyId, "policy.policyId");
  requireString(policy.identity, "policy.identity");
  exactRef(policy.ownerRef, "policy.ownerRef");
  exactRef(policy.inheritanceRuleRef, "policy.inheritanceRuleRef");
  exactRef(policy.authorityDecisionRef, "policy.authorityDecisionRef");
  if (policy.exceptionRuleRef) {
    exactRef(policy.exceptionRuleRef, "policy.exceptionRuleRef");
  }
  if (
    !Array.isArray(policy.governedActionClasses) ||
    !policy.governedActionClasses.length ||
    !DEONTIC_FORCES.has(policy.deonticForce) ||
    !POLICY_STRENGTHS.has(policy.policyStrength) ||
    !Number.isInteger(policy.precedence) ||
    policy.precedence < 0 ||
    !Number.isInteger(policy.policyRevision) ||
    policy.policyRevision < 1 ||
    !POLICY_STATUSES.has(policy.status) ||
    !Array.isArray(policy.enforcementModes) ||
    policy.enforcementModes.some((mode) => !ENFORCEMENT_MODES.has(mode)) ||
    !Array.isArray(policy.provenanceRefs) ||
    policy.grantsAuthority !== false
  ) {
    fail("world_manager_policy_object_boundary_violation", policy.policyId);
  }
  policy.provenanceRefs.forEach((entry) =>
    exactRef(entry, "policy.provenanceRef"));
  if (
    policy.digest !==
    digestFor(POLICY_OBJECT_SCHEMA, policy, ["digest"])
  ) {
    fail("world_manager_policy_object_digest_mismatch", policy.policyId);
  }
  return true;
}

function buildPolicyException(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const exception = {
    schema: POLICY_EXCEPTION_SCHEMA,
    policyExceptionId: requireString(
      source.policyExceptionId,
      "policyException.policyExceptionId",
    ),
    parentPolicyRef: exactRef(
      source.parentPolicyRef,
      "policyException.parentPolicyRef",
    ),
    authorizingRoleRef: exactRef(
      source.authorizingRoleRef,
      "policyException.authorizingRoleRef",
    ),
    ...(source.taskRef
      ? { taskRef: exactRef(source.taskRef, "policyException.taskRef") }
      : {}),
    actionClass: requireString(
      source.actionClass,
      "policyException.actionClass",
    ),
    ...(source.targetRef
      ? { targetRef: exactRef(source.targetRef, "policyException.targetRef") }
      : {}),
    permittedEffect: requireString(
      source.permittedEffect,
      "policyException.permittedEffect",
    ),
    exclusions: sortedUnique(source.exclusions),
    effectiveWorldstateRevision: Number(
      source.effectiveWorldstateRevision || 0,
    ),
    ...(text(source.expiresAt, "")
      ? { expiresAt: text(source.expiresAt, "") }
      : {}),
    ...(text(source.expiresWhen, "")
      ? { expiresWhen: text(source.expiresWhen, "") }
      : {}),
    ...(Number.isInteger(Number(source.useLimit))
      ? { useLimit: Number(source.useLimit) }
      : {}),
    usedCount: Number(source.usedCount || 0),
    authorityDecisionRef: exactRef(
      source.authorityDecisionRef,
      "policyException.authorityDecisionRef",
    ),
    provenanceRefs: (Array.isArray(source.provenanceRefs)
      ? source.provenanceRefs
      : []).map((entry) =>
      exactRef(entry, "policyException.provenanceRef")),
    status: text(source.status, "active"),
    grantsAuthority: false,
  };
  exception.digest = digestFor(
    POLICY_EXCEPTION_SCHEMA,
    exception,
    ["digest"],
  );
  validatePolicyException(exception);
  return exception;
}

function validatePolicyException(exception) {
  if (
    !isPlainObject(exception) ||
    exception.schema !== POLICY_EXCEPTION_SCHEMA
  ) {
    fail("world_manager_policy_exception_schema_mismatch");
  }
  requireString(
    exception.policyExceptionId,
    "policyException.policyExceptionId",
  );
  exactRef(exception.parentPolicyRef, "policyException.parentPolicyRef");
  exactRef(exception.authorizingRoleRef, "policyException.authorizingRoleRef");
  exactRef(exception.authorityDecisionRef, "policyException.authorityDecisionRef");
  if (exception.taskRef) exactRef(exception.taskRef, "policyException.taskRef");
  if (exception.targetRef) {
    exactRef(exception.targetRef, "policyException.targetRef");
  }
  if (
    !EXCEPTION_STATUSES.has(exception.status) ||
    !Array.isArray(exception.exclusions) ||
    !Array.isArray(exception.provenanceRefs) ||
    !Number.isInteger(exception.effectiveWorldstateRevision) ||
    exception.effectiveWorldstateRevision < 0 ||
    !Number.isInteger(exception.usedCount) ||
    exception.usedCount < 0 ||
    (typeof exception.useLimit !== "undefined" &&
      (!Number.isInteger(exception.useLimit) ||
        exception.useLimit < 1 ||
        exception.usedCount > exception.useLimit)) ||
    exception.grantsAuthority !== false
  ) {
    fail(
      "world_manager_policy_exception_boundary_violation",
      exception.policyExceptionId,
    );
  }
  if (
    exception.digest !==
    digestFor(POLICY_EXCEPTION_SCHEMA, exception, ["digest"])
  ) {
    fail(
      "world_manager_policy_exception_digest_mismatch",
      exception.policyExceptionId,
    );
  }
  return true;
}

function legacyPostureMapping(posture) {
  if (posture === "deny") {
    return {
      deonticForce: "prohibited",
      policyStrength: "hard_constraint",
      enforcementModes: ["capability_denial", "prompt_instruction"],
    };
  }
  if (
    posture === "admin_mode_required" ||
    posture === "explicit_user_confirmation_required"
  ) {
    return {
      deonticForce: "permitted",
      policyStrength: "default",
      enforcementModes: ["approval_gate", "prompt_instruction"],
    };
  }
  if (posture === "allow") {
    return {
      deonticForce: "permitted",
      policyStrength: "default",
      enforcementModes: ["prompt_instruction"],
    };
  }
  return {
    deonticForce: "preferred",
    policyStrength: "advisory",
    enforcementModes: ["audit_only", "prompt_instruction"],
  };
}

function adaptConstitutionalPolicyRule(rule, input = {}) {
  validateConstitutionalPolicyRule(rule);
  const mapping = legacyPostureMapping(rule.defaultPosture);
  const legacySelector = rule.scopeSelector || {};
  const adaptedLegacySelector = {
    ...(text(input.userWorldId, "")
      ? { userWorldId: text(input.userWorldId, "") }
      : {}),
    ...(text(legacySelector.projectId, "")
      ? { projectIds: [legacySelector.projectId] }
      : {}),
    ...(text(legacySelector.workThreadId, "")
      ? { workThreadIds: [legacySelector.workThreadId] }
      : {}),
    ...(text(legacySelector.agentClass, "")
      ? { roleKinds: [legacySelector.agentClass] }
      : {}),
  };
  return buildPolicyObject({
    policyId: text(input.policyId, `adapted_${rule.ruleId}`),
    identity: text(input.identity, `Adapted ${rule.ruleId}`),
    ownerRef: input.ownerRef,
    scopeSelector: input.scopeSelector || adaptedLegacySelector,
    governedActionClasses: [rule.actionClass],
    ...mapping,
    inheritanceRuleRef:
      input.inheritanceRuleRef ||
      codeOwnedRef("policy_inheritance_rule", "legacy_scope_inheritance@1"),
    exceptionRuleRef: rule.exceptions.length
      ? codeOwnedRef(
          "policy_exception_rule_set",
          `adapted_exceptions_${rule.ruleId}@1`,
        )
      : undefined,
    precedence: Number(input.precedence || 500),
    provenanceRefs: [
      ...(Array.isArray(input.provenanceRefs) ? input.provenanceRefs : []),
      {
        kind: "constitutional_policy_rule",
        id: rule.ruleId,
        digest: rule.ruleDigest,
      },
    ],
    authorityDecisionRef: input.authorityDecisionRef,
    policyRevision: Number(input.policyRevision || 1),
    status: rule.retired ? "superseded" : "active",
    sourcePosture: "adapted_constitutional_policy_substrate",
  });
}

function adaptPolicyExceptionRule(rule, input = {}) {
  validatePolicyExceptionRule(rule);
  return buildPolicyException({
    policyExceptionId: text(
      input.policyExceptionId,
      `adapted_${rule.exceptionId}`,
    ),
    parentPolicyRef: input.parentPolicyRef,
    authorizingRoleRef: input.authorizingRoleRef,
    taskRef: input.taskRef,
    actionClass: rule.actionClass,
    targetRef: input.targetRef,
    permittedEffect: text(
      input.permittedEffect,
      `legacy_posture:${rule.afterPosture}`,
    ),
    exclusions: input.exclusions,
    effectiveWorldstateRevision: input.effectiveWorldstateRevision,
    expiresAt: input.expiresAt,
    expiresWhen: input.expiresWhen,
    useLimit: input.useLimit,
    usedCount: input.usedCount,
    authorityDecisionRef: input.authorityDecisionRef,
    provenanceRefs: [
      ...(Array.isArray(input.provenanceRefs) ? input.provenanceRefs : []),
      {
        kind: "policy_exception_rule",
        id: rule.exceptionId,
        digest: rule.exceptionDigest,
      },
    ],
    status: input.status || "active",
  });
}

function selectorMatch(policy, binding) {
  const selector = policy.scopeSelector || {};
  const mismatches = [];
  if (
    selector.userWorldId &&
    selector.userWorldId !== binding.userWorldId
  ) {
    mismatches.push("user_world");
  }
  const checks = [
    ["projectIds", binding.projectId],
    ["workThreadIds", binding.workThreadId],
    ["taskTypes", binding.taskType],
    ["phases", binding.phase],
    ["environments", binding.environment],
    ["roleKinds", binding.roleKind],
  ];
  for (const [field, value] of checks) {
    if (selector[field]?.length && !selector[field].includes(value)) {
      mismatches.push(field);
    }
  }
  const match = {
    schema: POLICY_SELECTOR_MATCH_SCHEMA,
    selectorMatchId: stableId("wm_policy_match", {
      policyDigest: policy.digest,
      binding,
    }),
    policyRef: {
      kind: "policy_object",
      id: policy.policyId,
      digest: policy.digest,
    },
    taskSettlementRef: binding.taskSettlementRef,
    matched: mismatches.length === 0,
    matchedDimensions: mismatches.length
      ? []
      : [
          ...(selector.userWorldId ? ["userWorldId"] : []),
          ...checks
            .filter(([field]) => selector[field]?.length)
            .map(([field]) => field),
        ],
    mismatchDimensions: mismatches,
    grantsAuthority: false,
  };
  match.digest = digestFor(POLICY_SELECTOR_MATCH_SCHEMA, match, ["digest"]);
  return match;
}

function defaultK3Policies(input = {}) {
  const taskSettlement = input.taskSettlement;
  const planning =
    taskSettlement.taskType === "project_planning" &&
    taskSettlement.responsibleRole === "project_manager";
  const projectGenesis =
    taskSettlement.taskType === "project_initialization" &&
    taskSettlement.responsibleRole === "world_manager";
  const authorityDecisionRef =
    input.authorityDecisionRef ||
    codeOwnedRef(
      "authority_decision",
      "wm_k3_non_executing_agent_world_boundary@1",
    );
  const ownerRef = codeOwnedRef(
    "constitutional_role",
    "world_manager@1",
  );
  const inheritanceRuleRef = codeOwnedRef(
    "policy_inheritance_rule",
    "settled_project_task_role_closure@1",
  );
  const provenanceRefs = [
    exactRef(input.graphRef, "policy.graphRef"),
    codeOwnedRef(
      "specification",
      "direct_world_manager_keyboard_pipeline_wm_k3@1",
    ),
  ];
  const scopeSelector = {
    userWorldId: input.userWorldId,
    ...(taskSettlement.projectId
      ? { projectIds: [taskSettlement.projectId] }
      : {}),
    taskTypes: [taskSettlement.taskType],
    phases: [taskSettlement.phase],
    roleKinds: [taskSettlement.responsibleRole],
  };
  const requiredActionClasses = projectGenesis
    ? [
        "formulate_project_constitution_candidate",
        "rank_realization_options",
        "return_typed_project_genesis_result",
      ]
    : planning
    ? [
        "expose_open_decisions",
        "formulate_project_scoped_proposal",
        "return_typed_planning_result",
      ]
    : [
        "return_typed_manager_result",
        "surface_open_decisions",
      ];
  const common = {
    ownerRef,
    scopeSelector,
    inheritanceRuleRef,
    provenanceRefs,
    authorityDecisionRef,
    policyRevision: 1,
    status: "active",
    sourcePosture: "trusted_harness_constitution",
  };
  return [
    buildPolicyObject({
      ...common,
      policyId: stableId("wm_policy", {
        semanticEventId: taskSettlement.semanticEventId,
        force: "required",
      }),
      identity: planning
        ? "K3 project planning result obligations"
        : projectGenesis
          ? "K5G project genesis result obligations"
        : "K3 bounded manager result obligations",
      governedActionClasses: requiredActionClasses,
      deonticForce: "required",
      policyStrength: "hard_constraint",
      precedence: 900,
      enforcementModes: [
        "postcondition_validation",
        "prompt_instruction",
      ],
    }),
    buildPolicyObject({
      ...common,
      policyId: stableId("wm_policy", {
        semanticEventId: taskSettlement.semanticEventId,
        force: "permitted",
      }),
      identity: "K3 graph reasoning permissions",
      governedActionClasses: [
        "read_admitted_graph_projection",
        "reason_over_supplied_evidence",
      ],
      deonticForce: "permitted",
      policyStrength: "hard_constraint",
      precedence: 800,
      enforcementModes: ["prompt_instruction"],
    }),
    buildPolicyObject({
      ...common,
      policyId: stableId("wm_policy", {
        semanticEventId: taskSettlement.semanticEventId,
        force: "prohibited",
      }),
      identity: "K3 pre-runtime effect prohibitions",
      governedActionClasses: [
        "admit_canonical_worldstate",
        "mutate_remote_systems",
        "mutate_workspace",
        "start_implementation",
      ],
      deonticForce: "prohibited",
      policyStrength: "hard_constraint",
      precedence: 1000,
      enforcementModes: [
        "capability_denial",
        "postcondition_validation",
        "prompt_instruction",
      ],
    }),
  ];
}

function exceptionApplies(
  exception,
  policy,
  taskSettlement,
  targetIdentityRef = null,
) {
  if (
    exception.status !== "active" ||
    exception.parentPolicyRef.id !== policy.policyId ||
    exception.parentPolicyRef.digest !== policy.digest ||
    (exception.taskRef &&
      (exception.taskRef.id !== taskSettlement.taskSettlementId ||
        exception.taskRef.digest !== taskSettlement.digest)) ||
    (exception.targetRef &&
      (!targetIdentityRef ||
        exception.targetRef.id !== targetIdentityRef.id ||
        exception.targetRef.digest !== targetIdentityRef.digest)) ||
    (typeof exception.useLimit === "number" &&
      exception.usedCount >= exception.useLimit)
  ) {
    return false;
  }
  return policy.governedActionClasses.includes(exception.actionClass);
}

function precedenceForAction(actionClass, policies) {
  const ordered = policies
    .filter((policy) => policy.governedActionClasses.includes(actionClass))
    .sort((left, right) =>
      right.precedence - left.precedence ||
      left.policyId.localeCompare(right.policyId));
  const winner = ordered[0] || null;
  const decision = {
    schema: POLICY_PRECEDENCE_DECISION_SCHEMA,
    precedenceDecisionId: stableId("wm_policy_precedence", {
      actionClass,
      policies: ordered.map((policy) => policy.digest),
    }),
    actionClass,
    orderedPolicyRefs: ordered.map((policy) => ({
      kind: "policy_object",
      id: policy.policyId,
      digest: policy.digest,
    })),
    winningPolicyRef: winner
      ? {
          kind: "policy_object",
          id: winner.policyId,
          digest: winner.digest,
        }
      : null,
    winningForce: winner?.deonticForce || "",
    rationale:
      ordered.length > 1
        ? "Explicit precedence selected the operative policy."
        : "Only one applicable policy governed this action class.",
    grantsAuthority: false,
  };
  decision.digest = digestFor(
    POLICY_PRECEDENCE_DECISION_SCHEMA,
    decision,
    ["digest"],
  );
  const tiedHardForces = [...new Set(
    ordered
      .filter((policy) =>
        winner &&
        policy.precedence === winner.precedence &&
        policy.policyStrength === "hard_constraint")
      .map((policy) => policy.deonticForce),
  )];
  const incompatible =
    tiedHardForces.includes("prohibited") &&
    (tiedHardForces.includes("required") ||
      tiedHardForces.includes("permitted"));
  const conflict = incompatible
    ? {
        schema: POLICY_CONFLICT_WITNESS_SCHEMA,
        policyConflictWitnessId: stableId("wm_policy_conflict", {
          actionClass,
          policyRefs: decision.orderedPolicyRefs,
        }),
        actionClass,
        conflictKind: "equal_precedence_hard_deontic_conflict",
        policyRefs: decision.orderedPolicyRefs,
        resolutionState: "remand_required",
        grantsAuthority: false,
      }
    : null;
  if (conflict) {
    conflict.digest = digestFor(
      POLICY_CONFLICT_WITNESS_SCHEMA,
      conflict,
      ["digest"],
    );
  }
  return { decision, winner, conflict };
}

function buildResolvedTaskConstitution(input = {}) {
  const taskSettlement = input.taskSettlement;
  validateWorldManagerTaskSettlement(taskSettlement);
  if (taskSettlement.state !== "settled") {
    fail("world_manager_policy_requires_settled_task");
  }
  const policies = (Array.isArray(input.policies) ? input.policies : [])
    .filter((policy) => {
      validatePolicyObject(policy);
      return policy.status === "active";
    });
  const exceptions = (Array.isArray(input.exceptions) ? input.exceptions : [])
    .filter((exception) => {
      validatePolicyException(exception);
      return exception.status === "active";
    });
  const binding = {
    userWorldId: requireString(input.userWorldId, "constitution.userWorldId"),
    projectId: taskSettlement.projectId,
    workThreadId: text(input.workThreadId, ""),
    taskType: taskSettlement.taskType,
    phase: taskSettlement.phase,
    environment: text(input.environment, "local_repository"),
    roleKind: taskSettlement.responsibleRole,
    taskSettlementRef: {
      kind: "world_manager_task_settlement",
      id: taskSettlement.taskSettlementId,
      digest: taskSettlement.digest,
    },
  };
  const selectorMatches = policies.map((policy) =>
    selectorMatch(policy, binding));
  const applicable = policies.filter((policy, index) =>
    selectorMatches[index].matched);
  const actionClasses = sortedUnique(
    applicable.flatMap((policy) => policy.governedActionClasses),
  );
  const precedenceDecisions = [];
  const conflicts = [];
  const required = [];
  const permitted = [];
  const prohibited = [];
  const approvalGated = [];
  const activeExceptions = [];
  const targetIdentityRef = taskSettlement.projectId
    ? exactRef(input.projectIdentityRef, "constitution.projectIdentityRef")
    : exactRef(input.worldIdentityRef, "constitution.worldIdentityRef");
  for (const actionClass of actionClasses) {
    const resolution = precedenceForAction(actionClass, applicable);
    precedenceDecisions.push(resolution.decision);
    if (resolution.conflict) {
      conflicts.push(resolution.conflict);
      continue;
    }
    const winner = resolution.winner;
    const exception = winner.deonticForce === "prohibited"
      ? exceptions.find((entry) =>
          exceptionApplies(
            entry,
            winner,
            taskSettlement,
            targetIdentityRef,
          ) &&
          entry.actionClass === actionClass)
      : null;
    if (exception) {
      activeExceptions.push(exception);
      permitted.push(actionClass);
      continue;
    }
    if (winner.enforcementModes.includes("approval_gate")) {
      approvalGated.push(actionClass);
      continue;
    }
    if (winner.deonticForce === "required") required.push(actionClass);
    if (winner.deonticForce === "permitted") permitted.push(actionClass);
    if (winner.deonticForce === "prohibited") prohibited.push(actionClass);
  }
  const sourcePolicyRefs = applicable.map((policy) => ({
    kind: "policy_object",
    id: policy.policyId,
    digest: policy.digest,
  }));
  const policyClosureDigest = digestFor(
    "direct-world-manager-policy-closure@1",
    {
      binding,
      selectorMatchDigests: selectorMatches.map((entry) => entry.digest),
      precedenceDigests: precedenceDecisions.map((entry) => entry.digest),
      sourcePolicyRefs,
      activeExceptionRefs: activeExceptions.map((entry) => ({
        id: entry.policyExceptionId,
        digest: entry.digest,
      })),
      conflictRefs: conflicts.map((entry) => ({
        id: entry.policyConflictWitnessId,
        digest: entry.digest,
      })),
    },
  );
  const graphProjectionRef = exactRef(
    input.graphProjectionRef,
    "constitution.graphProjectionRef",
  );
  const bootPacketRef = exactRef(
    input.bootPacketRef,
    "constitution.bootPacketRef",
  );
  const roleRef = exactRef(
    input.roleRef || taskSettlement.selectedManagerAgentRef,
    "constitution.roleRef",
  );
  const projectIdentityRef = targetIdentityRef;
  const taskIdentityRef = {
    kind: "world_manager_task_settlement",
    id: taskSettlement.taskSettlementId,
    digest: taskSettlement.digest,
  };
  const completionConditionRef = codeOwnedRef(
    "completion_condition",
    taskSettlement.taskType === "project_planning"
      ? "typed_project_planning_result_complete@1"
      : "typed_manager_result_complete@1",
  );
  const escalationConditionRef = codeOwnedRef(
    "escalation_condition",
    "policy_conflict_or_scope_change_requires_world_manager@1",
  );
  const constitution = {
    schema: RESOLVED_TASK_CONSTITUTION_SCHEMA,
    taskConstitutionId: stableId("wm_task_constitution", {
      taskSettlementDigest: taskSettlement.digest,
      policyClosureDigest,
    }),
    taskSettlementRef: taskIdentityRef,
    projectIdentityRef,
    taskIdentityRef,
    roleRef,
    goalRefs: [],
    inheritedObligationRefs: sourcePolicyRefs,
    requiredActionClasses: sortedUnique(required),
    permittedActionClasses: sortedUnique(permitted),
    prohibitedActionClasses: sortedUnique(prohibited),
    approvalGatedActionClasses: sortedUnique(approvalGated),
    activeExceptionRefs: activeExceptions.map((entry) => ({
      kind: "policy_exception",
      id: entry.policyExceptionId,
      digest: entry.digest,
    })),
    requiredEvidenceRefs: [graphProjectionRef, bootPacketRef],
    completionConditionRefs: [completionConditionRef],
    escalationConditionRefs: [escalationConditionRef],
    sourcePolicyRefs,
    sourceScopeRevisions: normalizeScopeRevisions(
      input.sourceScopeRevisions,
    ),
    policyConflictWitnessRefs: conflicts.map((entry) => ({
      kind: "policy_conflict_witness",
      id: entry.policyConflictWitnessId,
      digest: entry.digest,
    })),
    policyClosureState:
      conflicts.length > 0 ? "remand_required" : "resolved",
    policyClosureDigest,
    grantsAuthority: false,
  };
  constitution.digest = digestFor(
    RESOLVED_TASK_CONSTITUTION_SCHEMA,
    constitution,
    ["digest"],
  );
  validateResolvedTaskConstitution(constitution);

  const promptProjection = {
    schema: POLICY_PROMPT_PROJECTION_SCHEMA,
    policyPromptProjectionId: stableId("wm_policy_prompt", {
      taskConstitutionDigest: constitution.digest,
    }),
    taskConstitutionRef: {
      kind: "resolved_task_constitution",
      id: constitution.taskConstitutionId,
      digest: constitution.digest,
    },
    requiredActionClasses: constitution.requiredActionClasses,
    permittedActionClasses: constitution.permittedActionClasses,
    prohibitedActionClasses: constitution.prohibitedActionClasses,
    approvalGatedActionClasses: constitution.approvalGatedActionClasses,
    instructionLines: [
      ...constitution.requiredActionClasses.map((action) =>
        `Required: ${action.replace(/_/g, " ")}.`),
      ...constitution.permittedActionClasses.map((action) =>
        `Permitted: ${action.replace(/_/g, " ")}.`),
      ...constitution.prohibitedActionClasses.map((action) =>
        `Prohibited: ${action.replace(/_/g, " ")}.`),
      ...constitution.approvalGatedActionClasses.map((action) =>
        `Approval required before: ${action.replace(/_/g, " ")}.`),
    ],
    rendererSuppliedInstructionsAccepted: false,
    grantsAuthority: false,
  };
  promptProjection.digest = digestFor(
    POLICY_PROMPT_PROJECTION_SCHEMA,
    promptProjection,
    ["digest"],
  );

  const enforcementProjection = {
    schema: POLICY_ENFORCEMENT_PROJECTION_SCHEMA,
    policyEnforcementProjectionId: stableId("wm_policy_enforcement", {
      taskConstitutionDigest: constitution.digest,
    }),
    taskConstitutionRef: promptProjection.taskConstitutionRef,
    capabilityDeniedActionClasses: constitution.prohibitedActionClasses,
    approvalGatedActionClasses: constitution.approvalGatedActionClasses,
    postconditionRequiredActionClasses:
      constitution.requiredActionClasses,
    runtimePreconditions: [],
    enforcementStrength:
      constitution.policyClosureState === "resolved"
        ? "mechanical_and_prompt"
        : "launch_blocked",
    grantsAuthority: false,
  };
  enforcementProjection.digest = digestFor(
    POLICY_ENFORCEMENT_PROJECTION_SCHEMA,
    enforcementProjection,
    ["digest"],
  );

  return {
    selectorMatches,
    precedenceDecisions,
    conflicts,
    activeExceptions,
    constitution,
    promptProjection,
    enforcementProjection,
  };
}

function validateResolvedTaskConstitution(constitution) {
  if (
    !isPlainObject(constitution) ||
    constitution.schema !== RESOLVED_TASK_CONSTITUTION_SCHEMA
  ) {
    fail("world_manager_task_constitution_schema_mismatch");
  }
  requireString(
    constitution.taskConstitutionId,
    "constitution.taskConstitutionId",
  );
  [
    constitution.taskSettlementRef,
    constitution.projectIdentityRef,
    constitution.taskIdentityRef,
    constitution.roleRef,
  ].forEach((entry) => exactRef(entry, "constitution.ref"));
  const arrayFields = [
    "goalRefs",
    "inheritedObligationRefs",
    "requiredActionClasses",
    "permittedActionClasses",
    "prohibitedActionClasses",
    "approvalGatedActionClasses",
    "activeExceptionRefs",
    "requiredEvidenceRefs",
    "completionConditionRefs",
    "escalationConditionRefs",
    "sourcePolicyRefs",
    "sourceScopeRevisions",
    "policyConflictWitnessRefs",
  ];
  if (
    arrayFields.some((field) => !Array.isArray(constitution[field])) ||
    !["resolved", "remand_required"].includes(
      constitution.policyClosureState,
    ) ||
    !REF_DIGEST_PATTERN.test(constitution.policyClosureDigest) ||
    constitution.grantsAuthority !== false
  ) {
    fail("world_manager_task_constitution_boundary_violation");
  }
  if (
    constitution.digest !==
    digestFor(
      RESOLVED_TASK_CONSTITUTION_SCHEMA,
      constitution,
      ["digest"],
    )
  ) {
    fail("world_manager_task_constitution_digest_mismatch");
  }
  return true;
}

function compileWorldManagerTaskConstitution(input = {}) {
  const taskSettlement = input.taskSettlement;
  validateWorldManagerTaskSettlement(taskSettlement);
  const policies = [
    ...defaultK3Policies(input),
    ...(Array.isArray(input.activePolicies) ? input.activePolicies : []),
  ];
  const exceptions = Array.isArray(input.activeExceptions)
    ? input.activeExceptions
    : [];
  const resolved = buildResolvedTaskConstitution({
    ...input,
    policies,
    exceptions,
  });
  const bundle = {
    schema: POLICY_COMPILATION_BUNDLE_SCHEMA,
    policyCompilationId: stableId("wm_policy_compilation", {
      semanticEventId: taskSettlement.semanticEventId,
      taskConstitutionDigest: resolved.constitution.digest,
    }),
    semanticEventId: taskSettlement.semanticEventId,
    policyObjects: policies,
    policyExceptions: exceptions,
    selectorMatches: resolved.selectorMatches,
    precedenceDecisions: resolved.precedenceDecisions,
    conflictWitnesses: resolved.conflicts,
    resolvedTaskConstitution: resolved.constitution,
    policyPromptProjection: resolved.promptProjection,
    policyEnforcementProjection: resolved.enforcementProjection,
    sourcePosture:
      "trusted K3 harness baseline plus admitted policy inputs",
    providerRoleTurnState: "not_started",
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
  bundle.digest = digestFor(
    POLICY_COMPILATION_BUNDLE_SCHEMA,
    bundle,
    ["digest"],
  );
  return bundle;
}

module.exports = {
  POLICY_COMPILATION_BUNDLE_SCHEMA,
  POLICY_CONFLICT_WITNESS_SCHEMA,
  POLICY_ENFORCEMENT_PROJECTION_SCHEMA,
  POLICY_EXCEPTION_SCHEMA,
  POLICY_OBJECT_SCHEMA,
  POLICY_PRECEDENCE_DECISION_SCHEMA,
  POLICY_PROMPT_PROJECTION_SCHEMA,
  POLICY_SELECTOR_MATCH_SCHEMA,
  RESOLVED_TASK_CONSTITUTION_SCHEMA,
  adaptConstitutionalPolicyRule,
  adaptPolicyExceptionRule,
  buildPolicyException,
  buildPolicyObject,
  buildResolvedTaskConstitution,
  codeOwnedRef,
  compileWorldManagerTaskConstitution,
  defaultK3Policies,
  validatePolicyException,
  validatePolicyObject,
  validateResolvedTaskConstitution,
};
