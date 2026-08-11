"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");
const {
  validateSemanticSettlement,
} = require("./semantic-discharge-runtime");

const SEMANTIC_HISTORY_RELATION_SCHEMA =
  "direct_semantic_history_relation@1";
const SEMANTIC_HISTORY_RELATION_STATE_SCHEMA =
  "direct_semantic_history_relation_state@1";
const SEMANTIC_SETTLEMENT_REVISION_SCHEMA =
  "direct_semantic_settlement_revision@1";
const RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA =
  "direct_reconstructed_semantic_settlement@1";
const SEMANTIC_SHELF_SCHEMA = "direct_semantic_shelf@1";
const SEMANTIC_SHELF_SELECTOR_SCHEMA =
  "direct_semantic_shelf_selector_policy@1";

const RELATION_KINDS = new Set([
  "belongs_to_lane",
  "continues_task",
  "concerns_project",
  "proposes_object",
  "revises_object",
  "supersedes_object",
  "provides_evidence_for",
  "realizes_aro",
  "verifies_aro",
  "conversational_continuity",
  "has_semantic_child",
]);
const RELATION_POSTURES = new Set(["primary", "secondary"]);
const RELATION_DURABILITIES = new Set([
  "ephemeral",
  "episodic",
  "candidate",
  "canonical_ref",
]);
const RELATION_CONFIDENCES = new Set([
  "high",
  "derived",
  "ambiguous",
]);
const RELATION_LIFECYCLES = new Set([
  "active",
  "superseded",
  "remanded",
]);
const SHELF_FRESHNESS = new Set([
  "fresh",
  "stale",
  "rebuilding",
  "blocked",
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

function stringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => text(entry, ""))
    .filter(Boolean);
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function validateRef(value, label = "ref") {
  if (
    !isPlainObject(value) ||
    !text(value.kind, "") ||
    !text(value.id, "") ||
    !text(value.digest, "")
  ) {
    fail("semantic_history_ref_invalid", label);
  }
  return true;
}

function sourceRef(kind, id, digest, label = "", extra = {}) {
  const result = {
    kind: text(kind, ""),
    id: text(id, ""),
    digest: text(digest, ""),
    label: text(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    ...extra,
  };
  validateRef(result);
  return result;
}

function semanticTargetRef(kind, id, fields = {}) {
  const semanticFields = {
    kind: text(kind, ""),
    id: text(id, ""),
    ...fields,
  };
  return sourceRef(
    semanticFields.kind,
    semanticFields.id,
    digestFor(
      "direct_semantic_history_target@1",
      semanticFields,
    ),
    text(fields.label, semanticFields.id),
    Object.fromEntries(
      Object.entries(fields).filter(([key]) =>
        key !== "label"),
    ),
  );
}

function settlementFields(value = {}) {
  return {
    settlementState: text(
      value.settlementState || value.state,
      "remanded",
    ),
    laneAssignments: Array.isArray(value.laneAssignments)
      ? value.laneAssignments
      : [],
    taskTypes: Array.isArray(value.taskTypes)
      ? value.taskTypes
      : text(value.taskType, "")
        ? [text(value.taskType, "")]
        : [],
    actionClasses: stringList(value.actionClasses),
    effectClasses: stringList(value.effectClasses),
    roleAssignments: Array.isArray(value.roleAssignments)
      ? value.roleAssignments
      : [],
    semanticTypeExpressions: Array.isArray(
      value.semanticTypeExpressions,
    )
      ? value.semanticTypeExpressions
      : [],
    rationaleSummary: text(
      value.rationaleSummary || value.rationale,
      "",
    ),
  };
}

function buildReconstructedSemanticSettlement(input = {}) {
  const taskSettlement = input.taskSettlement || {};
  const projectId = text(taskSettlement.projectId, "");
  const taskType = text(taskSettlement.taskType, "project_discussion");
  const responsibleRole = text(
    taskSettlement.responsibleRole,
    projectId ? "project_manager" : "world_manager",
  );
  const scopeKind = projectId ? "project" : "user_world";
  const laneId = text(
    input.routingDecision?.decision === "clarify"
      ? "system_introspection"
      : taskSettlement.taskLane,
    projectId ? "project_deliberation" : "conversation",
  );
  const createdAt = text(
    taskSettlement.createdAt,
    nowIso(input.now),
  );
  const result = {
    schema: RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
    semanticSettlementId: stableId(
      "wm_reconstructed_semantic_settlement",
      {
        semanticEventId: taskSettlement.semanticEventId,
        taskSettlementDigest: taskSettlement.digest,
      },
    ),
    semanticEventId: text(
      taskSettlement.semanticEventId,
      "",
    ),
    settlementState: text(
      taskSettlement.state,
      "remanded",
    ),
    laneAssignments: [{
      laneId,
      posture: "primary",
      scopeKind,
      projectId,
      workThreadId: "",
      rationaleSummary:
        "Provisional semantic-history reconstruction from a persisted K2 task settlement.",
    }],
    taskTypes: [taskType],
    actionClasses: [],
    effectClasses: [],
    roleAssignments: [{
      role: responsibleRole,
      scopeKind,
      projectId,
      workThreadId: "",
    }],
    semanticTypeExpressions: [],
    ambiguityReasons: [
      "legacy_semantic_meaning_not_settled_contemporaneously",
    ],
    formulationDisposition:
      responsibleRole === "project_manager"
        ? "delegate"
        : "answer_in_world_manager_turn",
    rationaleSummary:
      "This provisional reconstruction preserves the old task scope while making its reduced confidence explicit.",
    sourceTaskSettlementRef: sourceRef(
      "world_manager_task_settlement",
      taskSettlement.taskSettlementId,
      taskSettlement.digest,
      "Legacy K2 task settlement",
    ),
    reconstructionPosture: "provisional",
    compilerVersion: "semantic_history_legacy_reconstruction@1",
    grantsAuthority: false,
    createdAt,
  };
  result.digest = digestFor(
    RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
    result,
    ["digest"],
  );
  validateReconstructedSemanticSettlement(result);
  return result;
}

function validateReconstructedSemanticSettlement(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA ||
    !text(value.semanticSettlementId, "") ||
    !text(value.semanticEventId, "") ||
    !Array.isArray(value.laneAssignments) ||
    !value.laneAssignments.length ||
    !Array.isArray(value.taskTypes) ||
    !value.taskTypes.length ||
    value.reconstructionPosture !== "provisional" ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_history_reconstructed_settlement_invalid");
  }
  return true;
}

function validateSettlementEvidence(value) {
  if (
    value?.schema ===
      RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA
  ) {
    return validateReconstructedSemanticSettlement(value);
  }
  return validateSemanticSettlement(value);
}

function buildSemanticSettlementRevision(input = {}) {
  const semanticSettlement = input.semanticSettlement;
  validateSettlementEvidence(semanticSettlement);
  const settlementRevision = Number(
    input.settlementRevision,
  );
  if (
    !Number.isInteger(settlementRevision) ||
    settlementRevision < 1
  ) {
    fail("semantic_history_settlement_revision_invalid");
  }
  const provenancePosture = text(
    input.provenancePosture,
    semanticSettlement.schema ===
      RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA
      ? "reconstructed"
      : "contemporaneous",
  );
  const confidence = text(
    input.confidence,
    provenancePosture === "reconstructed"
      ? "derived"
      : "high",
  );
  if (!RELATION_CONFIDENCES.has(confidence)) {
    fail("semantic_history_settlement_confidence_invalid");
  }
  const result = {
    schema: SEMANTIC_SETTLEMENT_REVISION_SCHEMA,
    settlementRevisionId: stableId(
      "wm_semantic_settlement_revision",
      {
        semanticEventId:
          semanticSettlement.semanticEventId,
        settlementRevision,
        semanticSettlementDigest:
          semanticSettlement.digest,
      },
    ),
    semanticEventId:
      semanticSettlement.semanticEventId,
    semanticSettlementRef: sourceRef(
      semanticSettlement.schema ===
        RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA
        ? "reconstructed_semantic_settlement"
        : "world_manager_semantic_settlement",
      semanticSettlement.semanticSettlementId,
      semanticSettlement.digest,
      provenancePosture === "reconstructed"
        ? "Provisional reconstructed settlement"
        : "Contemporary semantic settlement",
    ),
    semanticSettlement,
    settlementRevision,
    provenancePosture,
    confidence,
    supersedesRevisionRef:
      input.supersedesRevisionRef || null,
    correctionReasonRefs: Array.isArray(
      input.correctionReasonRefs,
    )
      ? input.correctionReasonRefs
      : [],
    compilerVersion: text(
      input.compilerVersion,
      semanticSettlement.compilerVersion ||
        "semantic_history_catalog@1",
    ),
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  if (result.supersedesRevisionRef) {
    validateRef(
      result.supersedesRevisionRef,
      "settlementRevision.supersedesRevisionRef",
    );
  }
  result.correctionReasonRefs.forEach((ref, index) =>
    validateRef(
      ref,
      `settlementRevision.correctionReasonRefs.${index}`,
    ));
  result.digest = digestFor(
    SEMANTIC_SETTLEMENT_REVISION_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticSettlementRevision(result);
  return result;
}

function validateSemanticSettlementRevision(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_SETTLEMENT_REVISION_SCHEMA ||
    !text(value.settlementRevisionId, "") ||
    !text(value.semanticEventId, "") ||
    !Number.isInteger(Number(value.settlementRevision)) ||
    Number(value.settlementRevision) < 1 ||
    !RELATION_CONFIDENCES.has(value.confidence) ||
    !Array.isArray(value.correctionReasonRefs) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_history_settlement_revision_invalid");
  }
  validateRef(
    value.semanticSettlementRef,
    "settlementRevision.semanticSettlementRef",
  );
  validateSettlementEvidence(value.semanticSettlement);
  if (
    value.semanticSettlement.semanticEventId !==
      value.semanticEventId ||
    value.semanticSettlementRef.id !==
      value.semanticSettlement.semanticSettlementId ||
    value.semanticSettlementRef.digest !==
      value.semanticSettlement.digest ||
    value.digest !==
      digestFor(
        SEMANTIC_SETTLEMENT_REVISION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_history_settlement_revision_lineage_mismatch");
  }
  return true;
}

function eventRef(event) {
  return sourceRef(
    "world_manager_semantic_event",
    event.semanticEventId,
    event.eventDigest,
    event.eventKind ||
      "WorldManager semantic event",
  );
}

function relationFor(input = {}) {
  const sourceEvent = input.sourceEvent;
  const settlementRevision = input.settlementRevision;
  const semanticSettlement =
    settlementRevision.semanticSettlement;
  const relationKind = text(input.relationKind, "");
  const posture = text(input.posture, "secondary");
  const durability = text(input.durability, "episodic");
  const confidence = text(
    input.confidence,
    settlementRevision.confidence,
  );
  const lifecycle = text(
    input.lifecycle,
    semanticSettlement.settlementState === "remanded"
      ? "remanded"
      : "active",
  );
  if (
    !RELATION_KINDS.has(relationKind) ||
    !RELATION_POSTURES.has(posture) ||
    !RELATION_DURABILITIES.has(durability) ||
    !RELATION_CONFIDENCES.has(confidence) ||
    !RELATION_LIFECYCLES.has(lifecycle)
  ) {
    fail("semantic_history_relation_classification_invalid");
  }
  validateRef(input.targetRef, "relation.targetRef");
  const result = {
    schema: SEMANTIC_HISTORY_RELATION_SCHEMA,
    relationId: stableId(
      "wm_semantic_history_relation",
      {
        sourceSemanticEventId:
          sourceEvent.semanticEventId,
        settlementRevision:
          settlementRevision.settlementRevision,
        semanticSettlementDigest:
          semanticSettlement.digest,
        relationKind,
        targetRef: input.targetRef,
      },
    ),
    sourceEventRef: eventRef(sourceEvent),
    semanticSettlementRef:
      settlementRevision.semanticSettlementRef,
    relationKind,
    targetRef: input.targetRef,
    posture,
    durability,
    confidence,
    provenanceRefs: [
      settlementRevision.semanticSettlementRef,
      ...(Array.isArray(input.provenanceRefs)
        ? input.provenanceRefs
        : []),
    ],
    settlementRevision:
      settlementRevision.settlementRevision,
    lifecycle,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      settlementRevision.createdAt,
    ),
  };
  result.digest = digestFor(
    SEMANTIC_HISTORY_RELATION_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticHistoryRelation(result);
  return result;
}

function validateSemanticHistoryRelation(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_HISTORY_RELATION_SCHEMA ||
    !text(value.relationId, "") ||
    !RELATION_KINDS.has(value.relationKind) ||
    !RELATION_POSTURES.has(value.posture) ||
    !RELATION_DURABILITIES.has(value.durability) ||
    !RELATION_CONFIDENCES.has(value.confidence) ||
    !RELATION_LIFECYCLES.has(value.lifecycle) ||
    !Number.isInteger(Number(value.settlementRevision)) ||
    Number(value.settlementRevision) < 1 ||
    !Array.isArray(value.provenanceRefs) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_history_relation_invalid");
  }
  validateRef(value.sourceEventRef, "relation.sourceEventRef");
  validateRef(
    value.semanticSettlementRef,
    "relation.semanticSettlementRef",
  );
  validateRef(value.targetRef, "relation.targetRef");
  value.provenanceRefs.forEach((ref, index) =>
    validateRef(ref, `relation.provenanceRefs.${index}`));
  if (
    value.digest !==
      digestFor(
        SEMANTIC_HISTORY_RELATION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_history_relation_digest_mismatch");
  }
  return true;
}

function relationKey(value) {
  return [
    value.relationKind,
    value.targetRef.kind,
    value.targetRef.id,
  ].join(":");
}

function buildSemanticHistoryRelations(input = {}) {
  const sourceEvent = input.sourceEvent;
  const settlementRevision = input.settlementRevision;
  validateSemanticSettlementRevision(settlementRevision);
  if (
    !sourceEvent?.semanticEventId ||
    !sourceEvent?.eventDigest ||
    sourceEvent.semanticEventId !==
      settlementRevision.semanticEventId
  ) {
    fail("semantic_history_relation_source_mismatch");
  }
  const fields = settlementFields(
    settlementRevision.semanticSettlement,
  );
  const reconstructed =
    settlementRevision.provenancePosture ===
      "reconstructed";
  const baseConfidence = reconstructed
    ? "derived"
    : settlementRevision.confidence;
  const baseDurability = reconstructed
    ? "candidate"
    : "episodic";
  const relations = [];
  const add = (entry) => {
    const relation = relationFor({
      sourceEvent,
      settlementRevision,
      confidence: baseConfidence,
      durability: baseDurability,
      ...entry,
    });
    const existingIndex = relations.findIndex((candidate) =>
      relationKey(candidate) === relationKey(relation));
    if (existingIndex < 0) {
      relations.push(relation);
      return;
    }
    if (
      relation.posture === "primary" &&
      relations[existingIndex].posture !== "primary"
    ) {
      relations[existingIndex] = relation;
    }
  };

  for (const assignment of fields.laneAssignments) {
    const laneId = text(assignment?.laneId, "");
    if (!laneId) continue;
    const posture = RELATION_POSTURES.has(assignment.posture)
      ? assignment.posture
      : "secondary";
    add({
      relationKind: "belongs_to_lane",
      posture,
      targetRef: semanticTargetRef(
        "semantic_lane",
        laneId,
        {
          scopeKind: text(
            assignment.scopeKind,
            "user_world",
          ),
          projectId: text(assignment.projectId, ""),
          workThreadId: text(
            assignment.workThreadId,
            "",
          ),
        },
      ),
    });
  }

  const primaryLane = fields.laneAssignments.find(
    (assignment) => assignment?.posture === "primary",
  );
  const projectIds = new Set([
    ...fields.laneAssignments
      .map((assignment) =>
        text(assignment?.projectId, ""))
      .filter(Boolean),
    ...fields.roleAssignments
      .map((assignment) =>
        text(assignment?.projectId, ""))
      .filter(Boolean),
  ]);
  for (const projectId of projectIds) {
    add({
      relationKind: "concerns_project",
      posture: fields.laneAssignments.some((assignment) =>
        assignment?.posture === "primary" &&
        assignment?.projectId === projectId)
        ? "primary"
        : "secondary",
      targetRef: semanticTargetRef(
        "project",
        projectId,
        { projectId },
      ),
    });
  }

  for (const taskType of fields.taskTypes) {
    const primaryProjectId =
      primaryLane?.scopeKind === "project"
        ? text(primaryLane.projectId, "")
        : "";
    add({
      relationKind: "continues_task",
      posture: "primary",
      targetRef: semanticTargetRef(
        "semantic_task_history",
        stableId("wm_task_history", {
          userWorldId: text(input.userWorldId, ""),
          projectId: primaryProjectId,
          taskType,
        }),
        {
          userWorldId: text(input.userWorldId, ""),
          projectId: primaryProjectId,
          taskType,
        },
      ),
    });
  }

  const worldScoped =
    primaryLane?.scopeKind !== "project";
  if (
    worldScoped &&
    (
      fields.taskTypes.includes("world_conversation") ||
      ["conversation", "system_introspection"].includes(
        primaryLane?.laneId,
      )
    )
  ) {
    add({
      relationKind: "conversational_continuity",
      posture: "primary",
      targetRef: semanticTargetRef(
        "user_world",
        text(input.userWorldId, "user_world_local"),
        {
          userWorldId: text(
            input.userWorldId,
            "user_world_local",
          ),
        },
      ),
    });
  }

  for (const expression of fields.semanticTypeExpressions) {
    const value = expression?.expression || expression;
    const path = text(expression?.path, "semantic_type");
    if (value?.mode === "proposed_type") {
      add({
        relationKind: "proposes_object",
        posture: "secondary",
        durability: "candidate",
        targetRef: semanticTargetRef(
          "semantic_type_candidate",
          stableId("wm_semantic_type_candidate", {
            semanticEventId: sourceEvent.semanticEventId,
            path,
            value,
          }),
          {
            path,
            label: text(
              value.proposedLabel,
              "Proposed semantic type",
            ),
          },
        ),
      });
    } else if (
      value?.mode === "existing_ref" &&
      text(value.existingTypeRef, "")
    ) {
      add({
        relationKind: "provides_evidence_for",
        posture: "secondary",
        targetRef: semanticTargetRef(
          "semantic_type",
          value.existingTypeRef,
          { path },
        ),
      });
    }
  }

  return relations.sort((left, right) =>
    relationKey(left).localeCompare(relationKey(right)));
}

function buildSemanticChildRelation(input = {}) {
  const sourceEvent = input.parentEvent;
  const {
    currentState: _currentState,
    ...settlementRevision
  } = input.parentSettlementRevision || {};
  const childEvent = input.childEvent;
  validateSemanticSettlementRevision(settlementRevision);
  if (
    !sourceEvent?.semanticEventId ||
    !sourceEvent?.eventDigest ||
    sourceEvent.semanticEventId !==
      settlementRevision.semanticEventId ||
    !childEvent?.semanticEventId ||
    !childEvent?.eventDigest ||
    childEvent.lineageRootId !==
      sourceEvent.lineageRootId
  ) {
    fail("semantic_history_child_relation_lineage_invalid");
  }
  const provenanceRefs = input.childContractRef
    ? [input.childContractRef]
    : [];
  return relationFor({
    sourceEvent,
    settlementRevision,
    relationKind: "has_semantic_child",
    posture: "secondary",
    durability: "episodic",
    confidence: settlementRevision.confidence,
    targetRef: semanticTargetRef(
      "semantic_child_event",
      childEvent.semanticEventId,
      {
        parentSemanticEventId:
          sourceEvent.semanticEventId,
        childIndex: Number(input.childIndex || 0),
      },
    ),
    provenanceRefs,
    createdAt:
      childEvent.occurredAt ||
      settlementRevision.createdAt,
  });
}

function buildRelationState(input = {}) {
  const relation = input.relation;
  validateSemanticHistoryRelation(relation);
  const lifecycle = text(input.lifecycle, relation.lifecycle);
  if (!RELATION_LIFECYCLES.has(lifecycle)) {
    fail("semantic_history_relation_state_invalid");
  }
  const result = {
    schema: SEMANTIC_HISTORY_RELATION_STATE_SCHEMA,
    relationStateId: stableId(
      "wm_semantic_history_relation_state",
      {
        relationId: relation.relationId,
        lifecycle,
        transitionRef: input.transitionRef || null,
      },
    ),
    relationRef: sourceRef(
      "semantic_history_relation",
      relation.relationId,
      relation.digest,
      relation.relationKind,
    ),
    lifecycle,
    transitionRef: input.transitionRef || null,
    grantsAuthority: false,
    occurredAt: text(input.occurredAt, nowIso(input.now)),
  };
  if (result.transitionRef) {
    validateRef(
      result.transitionRef,
      "relationState.transitionRef",
    );
  }
  result.digest = digestFor(
    SEMANTIC_HISTORY_RELATION_STATE_SCHEMA,
    result,
    ["digest"],
  );
  validateRelationState(result);
  return result;
}

function validateRelationState(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_HISTORY_RELATION_STATE_SCHEMA ||
    !text(value.relationStateId, "") ||
    !RELATION_LIFECYCLES.has(value.lifecycle) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_history_relation_state_invalid");
  }
  validateRef(value.relationRef, "relationState.relationRef");
  if (
    value.digest !==
      digestFor(
        SEMANTIC_HISTORY_RELATION_STATE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_history_relation_state_digest_mismatch");
  }
  return true;
}

function selectorPolicyRef(shelfKind) {
  const membership =
    shelfKind === "project_open_decisions"
      ? "current non-resolved OpenDecision refs plus active semantic-history relations selected mechanically by exact project anchor"
      : shelfKind === "user_world_project_ecology"
        ? "bounded current ProjectStatus projections and non-resolved OpenDecision refs for the projects registered in the user world, plus their active concerns_project relations; project-private histories are not imported"
        : "active semantic-history relations selected mechanically by relation kind and exact anchor";
  const policy = {
    schema: SEMANTIC_SHELF_SELECTOR_SCHEMA,
    selectorPolicyId: `semantic_shelf_selector:${shelfKind}@1`,
    shelfKind,
    membership,
    rawTranscriptClassificationAllowed: false,
    grantsAuthority: false,
  };
  policy.digest = digestFor(
    SEMANTIC_SHELF_SELECTOR_SCHEMA,
    policy,
    ["digest"],
  );
  return sourceRef(
    "semantic_shelf_selector_policy",
    policy.selectorPolicyId,
    policy.digest,
    shelfKind,
  );
}

function uniqueRefs(refs = []) {
  const seen = new Set();
  return refs.filter((ref) => {
    validateRef(ref);
    const key = `${ref.kind}:${ref.id}:${ref.digest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(
      `${right.kind}:${right.id}`,
    ));
}

function buildSemanticShelf(input = {}) {
  const shelfKind = text(input.shelfKind, "");
  const anchorRefs = uniqueRefs(input.anchorRefs || []);
  const relations = Array.isArray(input.relations)
    ? input.relations
    : [];
  relations.forEach(validateSemanticHistoryRelation);
  if (!shelfKind || !anchorRefs.length) {
    fail("semantic_shelf_anchor_required");
  }
  const shelfRevision = Number(input.shelfRevision);
  if (
    !Number.isInteger(shelfRevision) ||
    shelfRevision < 1
  ) {
    fail("semantic_shelf_revision_invalid");
  }
  const relationRefs = uniqueRefs(relations.map((relation) =>
    sourceRef(
      "semantic_history_relation",
      relation.relationId,
      relation.digest,
      relation.relationKind,
    )));
  const sourceEventRefs = uniqueRefs(relations.map((relation) =>
    relation.sourceEventRef));
  const semanticObjectRefs = uniqueRefs([
    ...relations
      .filter((relation) =>
        [
          "proposes_object",
          "revises_object",
          "supersedes_object",
          "realizes_aro",
          "verifies_aro",
        ].includes(relation.relationKind))
      .map((relation) => relation.targetRef),
    ...(Array.isArray(input.semanticObjectRefs)
      ? input.semanticObjectRefs
      : []),
  ]);
  const sourceDigest = digestFor(
    "direct_semantic_shelf_sources@1",
    {
      shelfKind,
      anchorRefs,
      relationDigests: relations.map((relation) =>
        relation.digest).sort(),
      semanticObjectRefs,
    },
  );
  const result = {
    schema: SEMANTIC_SHELF_SCHEMA,
    shelfId: stableId("wm_semantic_shelf", {
      shelfKind,
      anchorRefs,
    }),
    shelfKind,
    anchorRefs,
    selectorPolicyRef: selectorPolicyRef(shelfKind),
    relationRefs,
    sourceEventRefs,
    semanticObjectRefs,
    shelfRevision,
    freshness: text(input.freshness, "fresh"),
    omissions: {
      supersededRelations: Number(
        input.omissions?.supersededRelations || 0,
      ),
      remandedRelations: Number(
        input.omissions?.remandedRelations || 0,
      ),
    },
    sourceDigest,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  result.digest = digestFor(
    SEMANTIC_SHELF_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticShelf(result);
  return result;
}

function validateSemanticShelf(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_SHELF_SCHEMA ||
    !text(value.shelfId, "") ||
    !text(value.shelfKind, "") ||
    !Array.isArray(value.anchorRefs) ||
    !value.anchorRefs.length ||
    !Array.isArray(value.relationRefs) ||
    !Array.isArray(value.sourceEventRefs) ||
    !Array.isArray(value.semanticObjectRefs) ||
    !Number.isInteger(Number(value.shelfRevision)) ||
    Number(value.shelfRevision) < 1 ||
    !SHELF_FRESHNESS.has(value.freshness) ||
    !isPlainObject(value.omissions) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_shelf_invalid");
  }
  value.anchorRefs.forEach((ref, index) =>
    validateRef(ref, `semanticShelf.anchorRefs.${index}`));
  value.relationRefs.forEach((ref, index) =>
    validateRef(ref, `semanticShelf.relationRefs.${index}`));
  value.sourceEventRefs.forEach((ref, index) =>
    validateRef(ref, `semanticShelf.sourceEventRefs.${index}`));
  value.semanticObjectRefs.forEach((ref, index) =>
    validateRef(
      ref,
      `semanticShelf.semanticObjectRefs.${index}`,
    ));
  validateRef(
    value.selectorPolicyRef,
    "semanticShelf.selectorPolicyRef",
  );
  if (
    value.digest !==
      digestFor(
        SEMANTIC_SHELF_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_shelf_digest_mismatch");
  }
  return true;
}

module.exports = {
  RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
  RELATION_KINDS,
  SEMANTIC_HISTORY_RELATION_SCHEMA,
  SEMANTIC_HISTORY_RELATION_STATE_SCHEMA,
  SEMANTIC_SETTLEMENT_REVISION_SCHEMA,
  SEMANTIC_SHELF_SCHEMA,
  buildReconstructedSemanticSettlement,
  buildRelationState,
  buildSemanticChildRelation,
  buildSemanticHistoryRelations,
  buildSemanticSettlementRevision,
  buildSemanticShelf,
  semanticTargetRef,
  sourceRef,
  validateReconstructedSemanticSettlement,
  validateRelationState,
  validateSemanticHistoryRelation,
  validateSemanticSettlementRevision,
  validateSemanticShelf,
  validateSettlementEvidence,
};
