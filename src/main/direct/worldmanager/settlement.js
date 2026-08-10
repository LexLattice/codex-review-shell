"use strict";

const {
  buildSemanticTargetResolution,
  buildWorldmodelIngressEnvelope,
  validateSemanticTargetResolution,
  validateWorldmodelIngressEnvelope,
} = require("../worldmodel/semantic-ingress");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const { digestFor, stableId } = require("./control-plane");
const {
  validateSemanticIngressRun,
  validateSemanticSettlement,
} = require("./semantic-ingress-runtime");

const WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA =
  "direct_world_manager_task_settlement@1";
const WORLD_MANAGER_ROUTING_DECISION_SCHEMA =
  "direct_world_manager_routing_decision@1";
const WORLD_MANAGER_CLARIFICATION_SCHEMA =
  "direct_world_manager_clarification@1";

const SETTLEMENT_STATES = new Set([
  "settled",
  "clarification_required",
  "remanded",
]);
const SETTLEMENT_TIERS = new Set([
  "exact",
  "smart",
  "reflective",
  "clarification",
  "semantic",
]);
const ROUTING_DECISIONS = new Set(["route", "clarify", "split", "remand"]);
const MANAGER_ROLES = new Set(["world_manager", "project_manager"]);

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

function required(value, label) {
  const result = text(value, "");
  if (!result) fail("world_manager_settlement_missing_string", label);
  return result;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function ref(kind, id, digest) {
  return {
    kind: required(kind, "ref.kind"),
    id: required(id, "ref.id"),
    digest: required(digest, "ref.digest"),
  };
}

function validateExactRef(value, label) {
  if (!isPlainObject(value)) fail("world_manager_settlement_invalid_ref", label);
  required(value.kind, `${label}.kind`);
  required(value.id, `${label}.id`);
  if (!/^sha256:[a-f0-9]{64}$/i.test(required(value.digest, `${label}.digest`))) {
    fail("world_manager_settlement_invalid_ref_digest", label);
  }
  return true;
}

function sourceRefsForMessage(message, options = {}) {
  const semanticChild =
    message.sourceKind === "semantic_child_contract";
  const sourceKind = semanticChild
    ? "semantic_child_contract"
    : "world_manager_message";
  return normalizeOdeuSourceRefs(
    [
      {
        sourceRefId: `${sourceKind}_${message.messageId}`,
        sourceKind: "family_specific",
        sourceId: message.messageId,
        sourceConfidence: "exact",
        freshness: "fresh",
        observedAt: message.createdAt,
        sourceDigest: {
          algorithm: "sha256",
          value: message.messageDigest,
          digestOf: "canonical_json",
        },
      },
    ],
    options,
  );
}

function projectTarget(bootstrap, projectId, confidence, candidateNodeIds = []) {
  const project = bootstrap.projects.find((entry) => entry.projectId === projectId);
  if (!project) fail("world_manager_settlement_unknown_project", projectId);
  return {
    scopeKind: "project",
    userProfileId: bootstrap.userWorld.userWorldId,
    semanticPath: ["projects", project.projectId],
    projectId: project.projectId,
    candidateNodeIds: candidateNodeIds.length
      ? candidateNodeIds
      : [project.projectWorldId],
    confidence,
  };
}

function worldTarget(bootstrap, confidence, candidateNodeIds = []) {
  return {
    scopeKind: "user_world",
    userProfileId: bootstrap.userWorld.userWorldId,
    semanticPath: ["world"],
    candidateNodeIds,
    confidence,
  };
}

function adapterFromSemanticSettlement(input = {}) {
  const bootstrap = input.bootstrap;
  const semanticSettlement =
    input.semanticIngressRun?.semanticSettlement;
  validateSemanticIngressRun(input.semanticIngressRun);
  validateSemanticSettlement(semanticSettlement);
  if (
    semanticSettlement.semanticEventId !==
    input.event.semanticEventId
  ) {
    fail("world_manager_semantic_settlement_event_mismatch");
  }
  const graphBinding = input.graphBinding || {};
  const primaryLane = semanticSettlement.laneAssignments.find(
    (entry) => entry.posture === "primary",
  );
  const primaryRole = semanticSettlement.roleAssignments[0];
  const taskType = semanticSettlement.taskTypes[0];
  const splitPending =
    semanticSettlement.formulationDisposition === "split";
  const pendingProjectClarification =
    Array.isArray(input.pendingClarifications) &&
    input.pendingClarifications.length === 1 &&
    input.pendingClarifications[0].ambiguityReasons?.includes(
      "project_scope_ambiguous",
    )
      ? input.pendingClarifications[0]
      : null;
  const projectId = text(
    primaryRole.projectId || primaryLane.projectId,
    "",
  );
  const target = projectId
    ? projectTarget(
        bootstrap,
        projectId,
        "derived",
        graphBinding.projectRootNodeIds?.[projectId]
          ? [graphBinding.projectRootNodeIds[projectId]]
          : [],
      )
    : worldTarget(
        bootstrap,
        "derived",
        graphBinding.worldRootNodeId
          ? [graphBinding.worldRootNodeId]
          : [],
      );
  const state = semanticSettlement.settlementState;
  const ambiguityReasons = [
    ...semanticSettlement.ambiguityReasons,
  ];
  const clarificationPrompt =
    semanticSettlement.clarificationPrompt;
  return {
    state,
    tier: "semantic",
    decision:
      splitPending && state === "settled"
        ? "split"
        : state === "clarification_required"
        ? "clarify"
        : state === "remanded"
          ? "remand"
          : "route",
    selectedRole: primaryRole.role,
    target,
    task: {
      taskType,
      phase: semanticSettlement.phase,
      actionClasses: semanticSettlement.actionClasses,
      effectClasses: semanticSettlement.effectClasses,
    },
    ambiguityReasons,
    rationale: semanticSettlement.rationaleSummary,
    clarificationPrompt,
    resolvedClarificationId:
      state === "settled" &&
      projectId &&
      pendingProjectClarification
        ? pendingProjectClarification.decisionRequestId
        : "",
  };
}

function buildWorldManagerTaskSettlement(input = {}) {
  const result = {
    schema: WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA,
    taskSettlementId: required(
      input.taskSettlementId,
      "taskSettlement.taskSettlementId",
    ),
    semanticEventId: required(
      input.semanticEventId,
      "taskSettlement.semanticEventId",
    ),
    ingressRef: ref(
      "worldmodel_ingress",
      input.ingressEnvelope.ingressId,
      input.ingressEnvelope.digest,
    ),
    targetResolutionRef: ref(
      "semantic_target_resolution",
      input.targetResolution.resolutionId,
      input.targetResolution.digest,
    ),
    ...(input.semanticSettlement
      ? {
          semanticSettlementRef: ref(
            "world_manager_semantic_settlement",
            input.semanticSettlement.semanticSettlementId,
            input.semanticSettlement.digest,
          ),
        }
      : {}),
    settlementTier: input.settlementTier,
    state: input.state,
    targetScope: input.targetScope || null,
    projectId: text(input.projectId, ""),
    taskType: required(input.taskType, "taskSettlement.taskType"),
    phase: required(input.phase, "taskSettlement.phase"),
    responsibleRole: input.responsibleRole,
    selectedManagerAgentRef: ref(
      "manager_agent",
      input.selectedManagerAgentId,
      digestFor("direct-world-manager-agent-identity@1", {
        selectedManagerAgentId: input.selectedManagerAgentId,
        responsibleRole: input.responsibleRole,
      }),
    ),
    actionClasses: [...new Set(input.actionClasses || [])].sort(),
    effectClasses: [...new Set(input.effectClasses || [])].sort(),
    ambiguityReasons: [...new Set(input.ambiguityReasons || [])].sort(),
    clarificationPrompt: text(input.clarificationPrompt, ""),
    rationale: required(input.rationale, "taskSettlement.rationale"),
    grantsAuthority: false,
    rawTranscriptIncluded: false,
    createdAt: required(input.createdAt, "taskSettlement.createdAt"),
  };
  result.digest = digestFor(
    WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA,
    result,
    ["digest"],
  );
  validateWorldManagerTaskSettlement(result);
  return result;
}

function validateWorldManagerTaskSettlement(value) {
  if (!isPlainObject(value) || value.schema !== WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA) {
    fail("world_manager_task_settlement_schema_mismatch");
  }
  required(value.taskSettlementId, "taskSettlement.taskSettlementId");
  required(value.semanticEventId, "taskSettlement.semanticEventId");
  validateExactRef(value.ingressRef, "taskSettlement.ingressRef");
  validateExactRef(value.targetResolutionRef, "taskSettlement.targetResolutionRef");
  if (value.semanticSettlementRef) {
    validateExactRef(
      value.semanticSettlementRef,
      "taskSettlement.semanticSettlementRef",
    );
  }
  if (!SETTLEMENT_TIERS.has(value.settlementTier)) {
    fail("world_manager_task_settlement_tier_invalid");
  }
  if (!SETTLEMENT_STATES.has(value.state)) {
    fail("world_manager_task_settlement_state_invalid");
  }
  if (!MANAGER_ROLES.has(value.responsibleRole)) {
    fail("world_manager_task_settlement_role_invalid");
  }
  validateExactRef(
    value.selectedManagerAgentRef,
    "taskSettlement.selectedManagerAgentRef",
  );
  if (
    !Array.isArray(value.actionClasses) ||
    !Array.isArray(value.effectClasses) ||
    !Array.isArray(value.ambiguityReasons) ||
    value.grantsAuthority !== false ||
    value.rawTranscriptIncluded !== false
  ) {
    fail("world_manager_task_settlement_boundary_violation");
  }
  if (value.state === "settled" && !isPlainObject(value.targetScope)) {
    fail("world_manager_task_settlement_target_required");
  }
  if (
    value.digest !==
    digestFor(WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_task_settlement_digest_mismatch");
  }
  return true;
}

function buildWorldManagerRoutingDecision(input = {}) {
  const result = {
    schema: WORLD_MANAGER_ROUTING_DECISION_SCHEMA,
    routingDecisionId: required(
      input.routingDecisionId,
      "routingDecision.routingDecisionId",
    ),
    semanticEventId: required(
      input.semanticEventId,
      "routingDecision.semanticEventId",
    ),
    targetResolutionRef: ref(
      "semantic_target_resolution",
      input.targetResolution.resolutionId,
      input.targetResolution.digest,
    ),
    taskSettlementRef: ref(
      "world_manager_task_settlement",
      input.taskSettlement.taskSettlementId,
      input.taskSettlement.digest,
    ),
    selectedRole: input.selectedRole,
    selectedManagerAgentRef: input.taskSettlement.selectedManagerAgentRef,
    deterministicBindings: {
      userWorldId: required(input.userWorldId, "routingDecision.userWorldId"),
      projectId: text(input.projectId, ""),
      taskType: input.taskSettlement.taskType,
      settlementTier: input.taskSettlement.settlementTier,
    },
    semanticClassifierRef:
      input.taskSettlement.semanticSettlementRef
        ? {
            ...input.taskSettlement.semanticSettlementRef,
          }
        : input.taskSettlement.settlementTier === "exact"
          ? null
          : ref(
              "semantic_classifier",
              "world_manager_k2_legacy_bounded_classifier",
              digestFor(
                "direct-world-manager-k2-legacy-bounded-classifier@1",
                {
                  revision: 1,
                  tiers: [
                    "smart",
                    "reflective",
                    "clarification",
                  ],
                },
              ),
            ),
    ambiguityRefs: (input.ambiguityReasons || []).map((reason) =>
      ref(
        "semantic_ambiguity",
        stableId("wm_ambiguity", {
          semanticEventId: input.semanticEventId,
          reason,
        }),
        digestFor("direct-world-manager-semantic-ambiguity@1", {
          semanticEventId: input.semanticEventId,
          reason,
        }),
      ),
    ),
    splitChildEventRefs: [],
    decision: input.decision,
    grantsAuthority: false,
  };
  result.digest = digestFor(
    WORLD_MANAGER_ROUTING_DECISION_SCHEMA,
    result,
    ["digest"],
  );
  validateWorldManagerRoutingDecision(result);
  return result;
}

function validateWorldManagerRoutingDecision(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== WORLD_MANAGER_ROUTING_DECISION_SCHEMA
  ) {
    fail("world_manager_routing_decision_schema_mismatch");
  }
  required(value.routingDecisionId, "routingDecision.routingDecisionId");
  required(value.semanticEventId, "routingDecision.semanticEventId");
  validateExactRef(value.targetResolutionRef, "routingDecision.targetResolutionRef");
  validateExactRef(value.taskSettlementRef, "routingDecision.taskSettlementRef");
  validateExactRef(
    value.selectedManagerAgentRef,
    "routingDecision.selectedManagerAgentRef",
  );
  if (value.semanticClassifierRef) {
    validateExactRef(
      value.semanticClassifierRef,
      "routingDecision.semanticClassifierRef",
    );
  }
  if (
    !MANAGER_ROLES.has(value.selectedRole) ||
    !ROUTING_DECISIONS.has(value.decision) ||
    !Array.isArray(value.ambiguityRefs) ||
    !Array.isArray(value.splitChildEventRefs) ||
    value.grantsAuthority !== false
  ) {
    fail("world_manager_routing_decision_boundary_violation");
  }
  value.ambiguityRefs.forEach((entry, index) =>
    validateExactRef(entry, `routingDecision.ambiguityRefs.${index}`),
  );
  if (
    value.digest !==
    digestFor(WORLD_MANAGER_ROUTING_DECISION_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_routing_decision_digest_mismatch");
  }
  return true;
}

function buildClarification(input = {}) {
  const result = {
    schema: WORLD_MANAGER_CLARIFICATION_SCHEMA,
    clarificationId: stableId("wm_clarification", {
      semanticEventId: input.semanticEventId,
      taskSettlementId: input.taskSettlement.taskSettlementId,
    }),
    semanticEventId: input.semanticEventId,
    taskSettlementRef: ref(
      "world_manager_task_settlement",
      input.taskSettlement.taskSettlementId,
      input.taskSettlement.digest,
    ),
    question: input.taskSettlement.clarificationPrompt,
    ambiguityReasons: input.taskSettlement.ambiguityReasons,
    state: "clarification_required",
    responseAuthority: "user_only",
    grantsAuthority: false,
    createdAt: input.taskSettlement.createdAt,
  };
  result.digest = digestFor(
    WORLD_MANAGER_CLARIFICATION_SCHEMA,
    result,
    ["digest"],
  );
  return result;
}

function settleWorldManagerIngress(input = {}, options = {}) {
  const bootstrap = input.bootstrap;
  const event = input.event;
  const message = input.message;
  if (!bootstrap || !event || !message) {
    fail("world_manager_settlement_ingress_required");
  }
  const createdAt = message.createdAt || nowIso(options.now || Date.now);
  const settlementAdapter =
    adapterFromSemanticSettlement(input);
  const task = settlementAdapter.task;
  const semanticSettlement =
    input.semanticIngressRun.semanticSettlement;
  const selectedRole = settlementAdapter.selectedRole;
  const selectedManagerAgentId =
    selectedRole === "world_manager"
      ? stableId("world_manager_agent", {
          userWorldId: bootstrap.userWorld.userWorldId,
        })
      : stableId("project_manager_agent", {
          userWorldId: bootstrap.userWorld.userWorldId,
          projectId: settlementAdapter.target?.projectId || event.projectId,
        });
  const sourceRefs = sourceRefsForMessage(message, { now: options.now });
  const declaredScopeHints = settlementAdapter.target
    ? [
        {
          scopeKind: settlementAdapter.target.scopeKind,
          userProfileId: settlementAdapter.target.userProfileId,
          semanticPath: settlementAdapter.target.semanticPath,
          ...(settlementAdapter.target.projectId
            ? { projectId: settlementAdapter.target.projectId }
            : {}),
        },
      ]
    : [];
  const ingressEnvelope = buildWorldmodelIngressEnvelope(
    {
      ingressId: stableId("worldmodel_ingress", {
        semanticEventId: event.semanticEventId,
      }),
      inputKind:
        message.sourceKind ===
          "semantic_child_contract"
          ? "system_event"
          : "current_user_message",
      receivedByAgentId: selectedManagerAgentId,
      receivedByRole: selectedRole,
      declaredScopeHints,
      sourceRefs,
      currentInstructionAuthority:
        message.sourceKind !==
          "semantic_child_contract",
      createdAt,
    },
    { now: options.now },
  );
  validateWorldmodelIngressEnvelope(ingressEnvelope);
  const targetResolution = buildSemanticTargetResolution(
    {
      resolutionId: stableId("semantic_target_resolution", {
        semanticEventId: event.semanticEventId,
      }),
      ingressId: ingressEnvelope.ingressId,
      candidateTargets: settlementAdapter.target
        ? [settlementAdapter.target]
        : [],
      route:
        settlementAdapter.state === "settled"
          ? settlementAdapter.decision === "split"
            ? "multi_scope_split"
            : settlementAdapter.target.scopeKind === "user_world"
            ? "commit_current_scope"
            : "world_to_project_descent"
          : "remand",
      rationale: settlementAdapter.rationale,
      sourceRefs,
    },
    { now: options.now },
  );
  validateSemanticTargetResolution(targetResolution);
  const taskSettlement = buildWorldManagerTaskSettlement({
    taskSettlementId: stableId("wm_task_settlement", {
      semanticEventId: event.semanticEventId,
    }),
    semanticEventId: event.semanticEventId,
    ingressEnvelope,
    targetResolution,
    semanticSettlement,
    settlementTier: settlementAdapter.tier,
    state: settlementAdapter.state,
    targetScope: settlementAdapter.target
      ? {
          scopeKind: settlementAdapter.target.scopeKind,
          ...(settlementAdapter.target.projectId
            ? { projectId: settlementAdapter.target.projectId }
            : {}),
        }
      : null,
    projectId: settlementAdapter.target?.projectId || "",
    taskType: task.taskType,
    phase: task.phase,
    responsibleRole: selectedRole,
    selectedManagerAgentId,
    actionClasses: task.actionClasses,
    effectClasses: task.effectClasses,
    ambiguityReasons: settlementAdapter.ambiguityReasons,
    clarificationPrompt: settlementAdapter.clarificationPrompt,
    rationale: settlementAdapter.rationale,
    createdAt,
  });
  const routingDecision = buildWorldManagerRoutingDecision({
    routingDecisionId: stableId("wm_routing_decision", {
      semanticEventId: event.semanticEventId,
    }),
    semanticEventId: event.semanticEventId,
    targetResolution,
    taskSettlement,
    selectedRole,
    userWorldId: bootstrap.userWorld.userWorldId,
    projectId: taskSettlement.projectId,
    ambiguityReasons: taskSettlement.ambiguityReasons,
    decision: settlementAdapter.decision,
  });
  return {
    semanticIngressRun: input.semanticIngressRun,
    semanticSettlement,
    ingressEnvelope,
    targetResolution,
    taskSettlement,
    routingDecision,
    clarification:
      taskSettlement.state === "clarification_required" ||
      taskSettlement.state === "remanded"
        ? buildClarification({
            semanticEventId: event.semanticEventId,
            taskSettlement,
          })
        : null,
    resolvedClarificationId:
      settlementAdapter.resolvedClarificationId || "",
  };
}

module.exports = {
  WORLD_MANAGER_CLARIFICATION_SCHEMA,
  WORLD_MANAGER_ROUTING_DECISION_SCHEMA,
  WORLD_MANAGER_TASK_SETTLEMENT_SCHEMA,
  buildWorldManagerRoutingDecision,
  buildWorldManagerTaskSettlement,
  adapterFromSemanticSettlement,
  settleWorldManagerIngress,
  validateWorldManagerRoutingDecision,
  validateWorldManagerTaskSettlement,
};
