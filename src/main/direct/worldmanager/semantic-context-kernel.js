"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");
const {
  semanticTargetRef,
} = require("./semantic-history");
const {
  PROJECT_STATUS_CONTEXT_SCHEMA,
  projectStatusSemanticProjection,
} = require("./project-ecology-context");

const CONTEXT_REQUIREMENT_SET_SCHEMA =
  "direct_context_requirement_set@1";
const SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA =
  "direct_semantic_context_import_request@1";
const SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA =
  "direct_semantic_context_selection_witness@1";
const SEMANTIC_CONTEXT_BUNDLE_SCHEMA =
  "direct_semantic_context_bundle@1";
const OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA =
  "direct_operational_meta_context_manifest@1";
const OPERATIONAL_META_CONTEXT_BINDING_SCHEMA =
  "direct_operational_meta_context_binding@1";
const CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA =
  "direct_context_request_manifest_link@1";
const CONTEXT_IMPORTER_REVISION =
  "world-manager-semantic-context-importer@2";

const PURPOSES = new Set([
  "conversation",
  "planning",
  "execution",
  "review",
  "aro_reconstruction",
  "thought_brush",
  "verification",
]);
const FRESHNESS_POSTURES = new Set([
  "canonical_only",
  "fresh_candidate_allowed",
  "historical_exact",
]);
const RAW_EVIDENCE_POLICIES = new Set([
  "refs_only",
  "bounded_on_demand",
  "explicit_raw_selection",
]);
const EVIDENCE_DEPTHS = new Set([
  "summary",
  "semantic_objects",
  "supporting_evidence",
]);
const BUNDLE_FRESHNESS = new Set([
  "fresh",
  "stale",
  "blocked",
]);
const AUTHORITY_POSTURES = new Set([
  "canonical",
  "candidate",
  "historical_evidence",
  "reconstructed",
]);
const RELATION_KINDS = Object.freeze([
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
const PROJECT_ECOLOGY_TASK_TYPES = Object.freeze([
  "project_ecology_status",
  "cross_project_comparison",
  "portfolio_planning",
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

function bounded(value, fallback = "", max = 960) {
  const result = text(value, fallback);
  return result.length > max
    ? `${result.slice(0, Math.max(0, max - 1)).trimEnd()}…`
    : result;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function sortedUnique(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => text(value, ""))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function exactRef(value, label = "semanticContext.ref") {
  if (
    !isPlainObject(value) ||
    !text(value.kind, "") ||
    !text(value.id, "") ||
    !text(value.digest, "")
  ) {
    fail("semantic_context_ref_invalid", label);
  }
  return {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
    ...(text(value.label, "")
      ? { label: bounded(value.label, "", 160) }
      : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function refFor(kind, value, idField, digestField = "digest", label = "") {
  return exactRef({
    kind,
    id: value?.[idField],
    digest: value?.[digestField],
    label: label || kind.replace(/_/g, " "),
  });
}

function uniqueRefs(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => exactRef(value))
    .filter((value) => {
      const key = `${value.kind}:${value.id}:${value.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(
        `${right.kind}:${right.id}`,
      ));
}

function digestValid(value, schema) {
  return value?.digest ===
    digestFor(schema, value, ["digest"]);
}

function isProjectEcologyTask(taskType = "") {
  return PROJECT_ECOLOGY_TASK_TYPES.includes(
    text(taskType, ""),
  );
}

function purposeForTask(taskType = "") {
  const value = text(taskType, "");
  if (value === "world_conversation") return "conversation";
  if (
    value === "project_review" ||
    value === "project_ecology_status" ||
    value === "cross_project_comparison"
  ) {
    return "review";
  }
  if (
    value === "project_execution_request" ||
    value === "implementation"
  ) {
    return "execution";
  }
  if (
    value === "system_introspection" ||
    value === "world_introspection"
  ) {
    return "verification";
  }
  return "planning";
}

function shelfPostureForTask(taskSettlement = {}) {
  if (isProjectEcologyTask(taskSettlement.taskType)) {
    return {
      requiredShelfKinds: [
        "user_world_project_ecology",
      ],
      optionalShelfKinds: [
        "user_world_governance",
        "user_world_conversational_continuity",
        "task_local_history",
      ],
    };
  }
  if (text(taskSettlement.projectId, "")) {
    return {
      requiredShelfKinds: [
        "project_active_horizon",
        "project_open_decisions",
        "project_accepted_policies",
      ],
      optionalShelfKinds: [
        "project_durable_history",
        "project_execution_lineages",
        "task_local_history",
      ],
    };
  }
  return {
    requiredShelfKinds: [
      "user_world_conversational_continuity",
    ],
    optionalShelfKinds: [
      "user_world_governance",
      "task_local_history",
    ],
  };
}

function buildContextRequirementSet(input = {}) {
  const taskSettlement = input.taskSettlement || {};
  const compilation = input.compilation || {};
  const semanticEventId = text(
    taskSettlement.semanticEventId,
    "",
  );
  const agentInstantiationRef =
    compilation.compiledAgentContext
      ?.agentInstantiationRef
      ? exactRef(
          compilation.compiledAgentContext
            .agentInstantiationRef,
          "requirementSet.agentInstantiationRef",
        )
      : refFor(
          "agent_instantiation",
          compilation.agentInstantiation,
          "agentInstantiationId",
        );
  const userWorldId = text(
    input.userWorldId,
    "user_world_local",
  );
  const projectId = text(taskSettlement.projectId, "");
  const semanticSettlement =
    input.semanticSettlement || {};
  const requiredSemanticObjectRefs =
    uniqueRefs(
      input.requiredSemanticObjectRefs || [],
    );
  const subjectProjectIds = sortedUnique([
    ...(projectId ? [projectId] : []),
    ...(semanticSettlement.laneAssignments || [])
      .filter((assignment) =>
        assignment?.scopeKind === "project")
      .map((assignment) =>
        text(assignment?.projectId, "")),
  ]);
  const ecologyTask = isProjectEcologyTask(
    taskSettlement.taskType,
  );
  if (
    taskSettlement.state !== "settled" ||
    !semanticEventId
  ) {
    fail("semantic_context_requires_settled_task");
  }
  const anchors = [];
  const userWorldRef = semanticTargetRef(
    "user_world",
    userWorldId,
    { userWorldId },
  );
  anchors.push({
    kind: "user_world",
    ref: exactRef(userWorldRef),
  });
  if (projectId) {
    anchors.push({
      kind: "project",
      ref: exactRef(semanticTargetRef(
        "project",
        projectId,
        { projectId },
      )),
    });
  }
  const taskHistoryId = stableId("wm_task_history", {
    userWorldId,
    projectId,
    taskType: taskSettlement.taskType,
  });
  anchors.push({
    kind: "task",
    ref: exactRef(semanticTargetRef(
      "semantic_task_history",
      taskHistoryId,
      {
        userWorldId,
        projectId,
        taskType: taskSettlement.taskType,
      },
    )),
  });
  const shelfPosture = shelfPostureForTask(taskSettlement);
  const maxInputTokens = Number(
    input.maxInputTokens || 4_800,
  );
  const maxObjects = Number(input.maxObjects || 24);
  const reserveForCurrentTurn = Number(
    input.reserveForCurrentTurn || 4_096,
  );
  const result = {
    schema: CONTEXT_REQUIREMENT_SET_SCHEMA,
    contextRequirementSetId: stableId(
      "wm_context_requirement_set",
      {
        semanticEventId,
        agentInstantiationDigest:
          agentInstantiationRef.digest,
        taskSettlementDigest: taskSettlement.digest,
        semanticSettlementDigest:
          text(semanticSettlement.digest, ""),
        subjectProjectIds,
        requiredSemanticObjectRefs,
        importerRevision: CONTEXT_IMPORTER_REVISION,
      },
    ),
    semanticEventId,
    agentInstantiationRef,
    taskSettlementRef: {
      kind: "world_manager_task_settlement",
      id: taskSettlement.taskSettlementId,
      digest: taskSettlement.digest,
    },
    purpose: text(
      input.purpose,
      purposeForTask(taskSettlement.taskType),
    ),
    scope: {
      kind: projectId ? "project" : "user_world",
      userWorldId,
      projectId,
      taskType: text(taskSettlement.taskType, ""),
      subjectKind: ecologyTask
        ? "project_ecology"
        : projectId
          ? "project"
          : "user_world",
      subjectProjectIds,
    },
    anchors,
    requiredSemanticObjectRefs,
    requiredShelfKinds:
      shelfPosture.requiredShelfKinds,
    optionalShelfKinds:
      shelfPosture.optionalShelfKinds,
    relationKinds: [...RELATION_KINDS],
    horizon: {
      latestTurns: Number(input.latestTurns || 8),
      since: "",
      until: "",
      abstractionAltitude: text(
        input.abstractionAltitude,
        "semantic_outcomes",
      ),
      evidenceDepth: text(
        input.evidenceDepth,
        "semantic_objects",
      ),
    },
    budget: {
      maxInputTokens,
      maxObjects,
      reserveForCurrentTurn,
    },
    freshness: text(
      input.freshness,
      "canonical_only",
    ),
    rawEvidencePolicy: text(
      input.rawEvidencePolicy,
      "refs_only",
    ),
    crossScopePolicy:
      requiredSemanticObjectRefs.length
        ? "exact_settled_scope_or_explicit_artifact_binding"
        : "exact_settled_scope_only",
    importerRevision: CONTEXT_IMPORTER_REVISION,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  result.digest = digestFor(
    CONTEXT_REQUIREMENT_SET_SCHEMA,
    result,
    ["digest"],
  );
  validateContextRequirementSet(result);
  return result;
}

function validateContextRequirementSet(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== CONTEXT_REQUIREMENT_SET_SCHEMA ||
    !text(value.contextRequirementSetId, "") ||
    !text(value.semanticEventId, "") ||
    !PURPOSES.has(value.purpose) ||
    !isPlainObject(value.scope) ||
    !["project", "user_world"].includes(value.scope.kind) ||
    (
      value.scope.subjectKind &&
      !["project", "project_ecology", "user_world"].includes(
        value.scope.subjectKind,
      )
    ) ||
    (
      value.scope.subjectProjectIds &&
      !Array.isArray(value.scope.subjectProjectIds)
    ) ||
    (value.scope.kind === "project" &&
      !text(value.scope.projectId, "")) ||
    !Array.isArray(value.anchors) ||
    !value.anchors.length ||
    !Array.isArray(
      value.requiredSemanticObjectRefs,
    ) ||
    !Array.isArray(value.requiredShelfKinds) ||
    !Array.isArray(value.optionalShelfKinds) ||
    !Array.isArray(value.relationKinds) ||
    !isPlainObject(value.horizon) ||
    !EVIDENCE_DEPTHS.has(value.horizon.evidenceDepth) ||
    !isPlainObject(value.budget) ||
    !Number.isInteger(Number(value.budget.maxInputTokens)) ||
    Number(value.budget.maxInputTokens) < 256 ||
    !Number.isInteger(Number(value.budget.maxObjects)) ||
    Number(value.budget.maxObjects) < 1 ||
    !FRESHNESS_POSTURES.has(value.freshness) ||
    !RAW_EVIDENCE_POLICIES.has(value.rawEvidencePolicy) ||
    ![
      "exact_settled_scope_only",
      "exact_settled_scope_or_explicit_artifact_binding",
    ].includes(value.crossScopePolicy) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_context_requirement_set_invalid");
  }
  exactRef(
    value.agentInstantiationRef,
    "requirementSet.agentInstantiationRef",
  );
  exactRef(
    value.taskSettlementRef,
    "requirementSet.taskSettlementRef",
  );
  for (const [index, anchor] of value.anchors.entries()) {
    if (
      !isPlainObject(anchor) ||
      !["user_world", "project", "task", "aro", "artifact"]
        .includes(anchor.kind)
    ) {
      fail(
        "semantic_context_anchor_invalid",
        String(index),
      );
    }
    exactRef(anchor.ref, `requirementSet.anchors.${index}`);
  }
  value.requiredSemanticObjectRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `requirementSet.requiredSemanticObjectRefs.${index}`,
      ),
  );
  if (
    (
      value.crossScopePolicy ===
        "exact_settled_scope_or_explicit_artifact_binding"
    ) !==
      (value.requiredSemanticObjectRefs.length > 0)
  ) {
    fail(
      "semantic_context_requirement_explicit_binding_mismatch",
    );
  }
  const userWorldAnchor = value.anchors.find((anchor) =>
    anchor.kind === "user_world");
  const projectAnchor = value.anchors.find((anchor) =>
    anchor.kind === "project");
  if (
    userWorldAnchor?.ref?.id !==
      value.scope.userWorldId ||
    (
      value.scope.kind === "project" &&
      projectAnchor?.ref?.id !==
        value.scope.projectId
    ) ||
    (
      value.scope.kind === "user_world" &&
      projectAnchor
    )
  ) {
    fail("semantic_context_requirement_scope_mismatch");
  }
  const subjectKind = text(
    value.scope.subjectKind,
    value.scope.kind === "project"
      ? "project"
      : "user_world",
  );
  const declaredSubjectProjectIds =
    Array.isArray(value.scope.subjectProjectIds)
      ? value.scope.subjectProjectIds
      : value.scope.kind === "project"
        ? [value.scope.projectId]
        : [];
  const subjectProjectIds = sortedUnique(
    declaredSubjectProjectIds,
  );
  if (
    JSON.stringify(subjectProjectIds) !==
      JSON.stringify(declaredSubjectProjectIds) ||
    (
      subjectKind === "project" &&
      (
        value.scope.kind !== "project" ||
        subjectProjectIds.length !== 1 ||
        subjectProjectIds[0] !== value.scope.projectId
      )
    ) ||
    (
      subjectKind === "project_ecology" &&
      (
        value.scope.kind !== "user_world" ||
        !subjectProjectIds.length ||
        !isProjectEcologyTask(value.scope.taskType)
      )
    ) ||
    (
      subjectKind === "user_world" &&
      (
        value.scope.kind !== "user_world" ||
        subjectProjectIds.length > 0
      )
    )
  ) {
    fail("semantic_context_requirement_subject_scope_mismatch");
  }
  if (!digestValid(value, CONTEXT_REQUIREMENT_SET_SCHEMA)) {
    fail("semantic_context_requirement_set_digest_mismatch");
  }
  return true;
}

function buildSemanticContextImportRequest(input = {}) {
  const requirementSet = input.requirementSet;
  validateContextRequirementSet(requirementSet);
  const shelfKinds = sortedUnique([
    ...requirementSet.requiredShelfKinds,
    ...requirementSet.optionalShelfKinds,
  ]);
  const result = {
    schema: SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA,
    contextImportId: stableId(
      "wm_semantic_context_import",
      {
        contextRequirementSetDigest:
          requirementSet.digest,
        importerRevision: CONTEXT_IMPORTER_REVISION,
      },
    ),
    contextRequirementSetRef: refFor(
      "context_requirement_set",
      requirementSet,
      "contextRequirementSetId",
    ),
    semanticEventId:
      requirementSet.semanticEventId,
    agentInstantiationRef:
      requirementSet.agentInstantiationRef,
    purpose: requirementSet.purpose,
    anchors: requirementSet.anchors,
    requiredSemanticObjectRefs:
      requirementSet.requiredSemanticObjectRefs,
    shelfKinds,
    relationKinds:
      requirementSet.relationKinds,
    horizon: requirementSet.horizon,
    budget: requirementSet.budget,
    freshness: requirementSet.freshness,
    rawEvidencePolicy:
      requirementSet.rawEvidencePolicy,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  result.digest = digestFor(
    SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticContextImportRequest(result);
  return result;
}

function validateSemanticContextImportRequest(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA ||
    !text(value.contextImportId, "") ||
    !text(value.semanticEventId, "") ||
    !PURPOSES.has(value.purpose) ||
    !Array.isArray(value.anchors) ||
    !Array.isArray(
      value.requiredSemanticObjectRefs,
    ) ||
    !Array.isArray(value.shelfKinds) ||
    !Array.isArray(value.relationKinds) ||
    !isPlainObject(value.horizon) ||
    !isPlainObject(value.budget) ||
    !FRESHNESS_POSTURES.has(value.freshness) ||
    !RAW_EVIDENCE_POLICIES.has(
      value.rawEvidencePolicy,
    ) ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_context_import_request_invalid");
  }
  exactRef(
    value.contextRequirementSetRef,
    "contextImport.contextRequirementSetRef",
  );
  exactRef(
    value.agentInstantiationRef,
    "contextImport.agentInstantiationRef",
  );
  value.requiredSemanticObjectRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `contextImport.requiredSemanticObjectRefs.${index}`,
      ),
  );
  if (
    !digestValid(
      value,
      SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA,
    )
  ) {
    fail("semantic_context_import_request_digest_mismatch");
  }
  return true;
}

function anchorForShelf(requirementSet, shelfKind) {
  const anchorKind = shelfKind.startsWith("user_world_")
    ? "user_world"
    : shelfKind.startsWith("project_")
      ? "project"
      : shelfKind === "task_local_history"
        ? "task"
        : shelfKind.startsWith("aro_")
          ? "aro"
          : "artifact";
  return requirementSet.anchors.find((entry) =>
    entry.kind === anchorKind) || null;
}

function shelfRef(shelf) {
  return refFor(
    "semantic_shelf",
    shelf,
    "shelfId",
    "digest",
    shelf.shelfKind,
  );
}

function worldRevisionRef(value = {}) {
  if (
    text(value.kind, "") &&
    text(value.id, "") &&
    text(value.digest, "")
  ) {
    return exactRef(value);
  }
  const scopeKind = text(
    value.scopeKind,
    "user_world",
  );
  const projectId = text(value.projectId, "");
  const workThreadId = text(value.workThreadId, "");
  const revision = Number(value.revision || 0);
  return exactRef({
    kind: "worldmodel_scope_revision",
    id: [
      scopeKind,
      projectId || "world",
      workThreadId || "root",
      `r${revision}`,
    ].join(":"),
    digest: value.digest,
    label: `${scopeKind} revision ${revision}`,
  });
}

function semanticObjectProjection(artifact) {
  if (
    artifact?.schema === PROJECT_STATUS_CONTEXT_SCHEMA
  ) {
    return projectStatusSemanticProjection(artifact);
  }
  if (
    artifact?.schema === "direct_open_decision@1"
  ) {
    return {
      objectRef: {
        kind: "open_decision",
        id: artifact.decisionId,
        digest: artifact.digest,
      },
      objectClass: "open_decision",
      authorityPosture:
        artifact.canonical === true
          ? "canonical"
          : "candidate",
      boundedProjection: {
        semanticIdentity:
          artifact.header?.semanticIdentity || "",
        question: bounded(artifact.question, "", 480),
        description: bounded(
          artifact.description,
          "",
          640,
        ),
        decisionState: artifact.decisionState,
        resolutionMode: artifact.resolutionMode,
        options: (artifact.options || []).map((option) => ({
          optionKey: option.optionKey,
          label: bounded(option.label, "", 160),
        })),
        dependencies: (artifact.dependencies || []).map(
          (dependency) => ({
            dependencyKind: dependency.dependencyKind,
            requirement: bounded(
              dependency.requirement,
              "",
              240,
            ),
            state: dependency.state,
          }),
        ),
        consequences: (artifact.consequences || []).map(
          (consequence) => ({
            effectClass: consequence.effectClass,
            description: bounded(
              consequence.description,
              "",
              240,
            ),
            posture: consequence.posture,
          }),
        ),
      },
    };
  }
  return null;
}

function semanticSummaryForEntry(entry, resultByEventId) {
  const revision = entry.settlementRevision || {};
  const settlement =
    revision.semanticSettlement ||
    entry.taskSettlement ||
    {};
  const resultRecord = resultByEventId.get(
    entry.event.semanticEventId,
  );
  const outcome = bounded(
    resultRecord?.userFacingResponse?.text ||
      resultRecord?.typedPayload?.semanticSummary,
    "",
    1_200,
  );
  const rationale = bounded(
    settlement.rationaleSummary ||
      entry.taskSettlement?.rationale ||
      entry.taskSettlement?.semanticSummary,
    "",
    720,
  );
  const parts = [
    `Task: ${text(
      entry.taskSettlement?.taskType,
      settlement.taskTypes?.[0] || "semantic event",
    )}.`,
    rationale ? `Settlement: ${rationale}` : "",
    outcome ? `Outcome: ${outcome}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function eventProjection(entry, resultByEventId) {
  const relationRefs = (entry.relations || []).map(
    (relation) => ({
      kind: "semantic_history_relation",
      id: relation.relationId,
      digest: relation.digest,
    }),
  );
  return {
    eventRef: {
      kind: "world_manager_semantic_event",
      id: entry.event.semanticEventId,
      digest: entry.event.eventDigest,
    },
    semanticSummary:
      semanticSummaryForEntry(entry, resultByEventId),
    relationRefs: uniqueRefs(relationRefs),
  };
}

function estimatedTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function providerProjectionText(input = {}) {
  const bundle = input.bundle;
  const manifest = input.manifest;
  const lines = [
    "[IMPORTED OPERATIONAL META-CONTEXT - QUOTED SEMANTIC EVIDENCE]",
    `Purpose: ${bundle.purpose}.`,
    `Scope: ${bundle.scope.kind}${
      bundle.scope.projectId
        ? ` ${bundle.scope.projectId}`
        : ` ${bundle.scope.userWorldId}`
    }.`,
    `Subject scope: ${text(
      bundle.scope.subjectKind,
      bundle.scope.projectId ? "project" : "user_world",
    )}${
      (bundle.scope.subjectProjectIds || []).length
        ? ` [${bundle.scope.subjectProjectIds.join(", ")}]`
        : ""
    }.`,
    `Freshness: ${bundle.freshness}.`,
    `Source shelves: ${bundle.sourceShelfRefs
      .map((ref) => ref.label || ref.id)
      .join(", ") || "none"}.`,
  ];
  if (bundle.content.relevantEvents.length) {
    lines.push("Relevant semantic outcomes:");
    for (const event of bundle.content.relevantEvents) {
      lines.push(
        `- ${bounded(
          event.semanticSummary,
          event.eventRef.id,
          1_600,
        )}`,
      );
    }
  }
  const openDecisions = bundle.content.semanticObjects
    .filter((object) =>
      object.objectClass === "open_decision");
  const projectStatuses = bundle.content.semanticObjects
    .filter((object) =>
      object.objectClass === "project_status");
  if (projectStatuses.length) {
    lines.push("Admitted bounded project-ecology status:");
    for (const object of projectStatuses) {
      const projection = object.boundedProjection;
      lines.push(
        `- ${projection.identity} (${projection.projectId}): ` +
        `${projection.statusSummary} ` +
        `Summary: ${bounded(
          projection.summary,
          "No admitted summary.",
          640,
        )}`,
      );
    }
  }
  if (openDecisions.length) {
    lines.push("Operative open decisions:");
    for (const object of openDecisions) {
      const projection = object.boundedProjection;
      const options = (projection.options || [])
        .map((option) =>
          `${option.optionKey}: ${option.label}`)
        .join("; ");
      lines.push(
        `- ${projection.question} [${projection.decisionState}; ${projection.resolutionMode}]${
          options ? ` Options: ${options}.` : ""
        }`,
      );
    }
  }
  if (bundle.content.policyRefs.length) {
    lines.push(
      `Policy refs: ${bundle.content.policyRefs
        .map((ref) => ref.id)
        .join(", ")}.`,
    );
  }
  lines.push(
    `Selection witness: ${bundle.selectionWitness.selectionWitnessId}; ` +
      `${bundle.selectionWitness.estimatedTokens} estimated tokens; ` +
      `${bundle.selectionWitness.truncation ? "truncated" : "complete"}.`,
  );
  lines.push(
    `Operational manifest: ${manifest.operationalMetaContextId}.`,
  );
  return lines.join("\n");
}

function validateSemanticContextSelectionWitness(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA ||
    !text(value.selectionWitnessId, "") ||
    !Array.isArray(value.includedRelationKinds) ||
    !isPlainObject(value.excludedCounts) ||
    !Array.isArray(value.crossScopeExclusions) ||
    typeof value.truncation !== "boolean" ||
    !Number.isInteger(Number(value.estimatedTokens)) ||
    Number(value.estimatedTokens) < 0 ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_context_selection_witness_invalid");
  }
  exactRef(
    value.selectorPolicyRef,
    "selectionWitness.selectorPolicyRef",
  );
  value.crossScopeExclusions.forEach((ref, index) =>
    exactRef(ref, `selectionWitness.crossScope.${index}`));
  if (
    !digestValid(
      value,
      SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA,
    )
  ) {
    fail("semantic_context_selection_witness_digest_mismatch");
  }
  return true;
}

function materializeSemanticContext(input = {}) {
  const requirementSet = input.requirementSet;
  const importRequest = input.importRequest;
  const repository = input.repository;
  const compilation = input.compilation || {};
  validateContextRequirementSet(requirementSet);
  validateSemanticContextImportRequest(importRequest);
  if (
    importRequest.contextRequirementSetRef.id !==
      requirementSet.contextRequirementSetId ||
    importRequest.contextRequirementSetRef.digest !==
      requirementSet.digest ||
    !repository
  ) {
    fail("semantic_context_materialization_lineage_invalid");
  }
  if (
    JSON.stringify(importRequest.anchors) !==
      JSON.stringify(requirementSet.anchors) ||
    JSON.stringify(
      importRequest.requiredSemanticObjectRefs,
    ) !==
      JSON.stringify(
        requirementSet.requiredSemanticObjectRefs,
      ) ||
    JSON.stringify(importRequest.budget) !==
      JSON.stringify(requirementSet.budget) ||
    JSON.stringify(importRequest.horizon) !==
      JSON.stringify(requirementSet.horizon) ||
    JSON.stringify(importRequest.relationKinds) !==
      JSON.stringify(requirementSet.relationKinds) ||
    JSON.stringify(importRequest.shelfKinds) !==
      JSON.stringify(sortedUnique([
        ...requirementSet.requiredShelfKinds,
        ...requirementSet.optionalShelfKinds,
      ]))
  ) {
    fail("semantic_context_import_requirement_mismatch");
  }
  const currentEvent = repository.eventBySemanticEventId(
    requirementSet.semanticEventId,
  );
  if (!currentEvent) {
    fail("semantic_context_source_event_missing");
  }
  const selectedShelves = [];
  const crossScopeExclusions = [];
  const excludedCounts = {
    missingRequiredShelves: 0,
    missingOptionalShelves: 0,
    crossScopeShelves: 0,
    horizonEvents: 0,
    budgetEvents: 0,
    budgetObjects: 0,
    unsupportedObjects: 0,
    missingRequiredObjects: 0,
  };
  for (const shelfKind of importRequest.shelfKinds) {
    const anchor = anchorForShelf(requirementSet, shelfKind);
    if (!anchor) {
      const required =
        requirementSet.requiredShelfKinds.includes(shelfKind);
      excludedCounts[
        required
          ? "missingRequiredShelves"
          : "missingOptionalShelves"
      ] += 1;
      continue;
    }
    const exactShelf = repository.semanticShelf(
      shelfKind,
      anchor.ref.kind,
      anchor.ref.id,
    );
    if (exactShelf) {
      selectedShelves.push({
        shelf: exactShelf,
        anchor,
      });
    } else {
      const required =
        requirementSet.requiredShelfKinds.includes(shelfKind);
      excludedCounts[
        required
          ? "missingRequiredShelves"
          : "missingOptionalShelves"
      ] += 1;
    }
    for (
      const peer of repository.listSemanticShelves({
        shelfKind,
        currentOnly: true,
        limit: 5_000,
      })
    ) {
      if (
        exactShelf &&
        peer.shelfId === exactShelf.shelfId
      ) {
        continue;
      }
      crossScopeExclusions.push(shelfRef(peer));
    }
  }
  const uniqueCrossScope = uniqueRefs(crossScopeExclusions);
  excludedCounts.crossScopeShelves =
    uniqueCrossScope.length;
  const resultByEventId = new Map(
    repository.listAgentResults({ limit: 5_000 })
      .map((record) => [
        record.agentResult?.sourceSemanticEventId,
        record,
      ])
      .filter(([eventId]) => Boolean(eventId)),
  );
  const eventEntries = new Map();
  const semanticObjectRefs = [
    ...requirementSet
      .requiredSemanticObjectRefs,
  ];
  const relationKinds = new Set();
  const selectorPolicyRefs = [];
  for (const selected of selectedShelves) {
    selectorPolicyRefs.push(
      selected.shelf.selectorPolicyRef,
    );
    semanticObjectRefs.push(
      ...selected.shelf.semanticObjectRefs,
    );
    const shelfEvents =
      repository.semanticHistoryEventsForShelf(
        selected.shelf.shelfKind,
        selected.anchor.ref.kind,
        selected.anchor.ref.id,
        {
          limit: Math.max(
            1,
            Number(importRequest.horizon.latestTurns || 8),
          ),
          beforeSequence: currentEvent.sequence,
        },
      );
    excludedCounts.horizonEvents += Math.max(
      0,
      selected.shelf.sourceEventRefs.length -
        shelfEvents.entries.length,
    );
    for (const entry of shelfEvents.entries) {
      eventEntries.set(
        entry.event.semanticEventId,
        entry,
      );
      for (const relation of entry.relations || []) {
        relationKinds.add(relation.relationKind);
      }
    }
  }
  const latestTurns = Math.max(
    1,
    Number(importRequest.horizon.latestTurns || 8),
  );
  let relevantEntries = [...eventEntries.values()]
    .sort((left, right) =>
      left.event.sequence - right.event.sequence);
  if (relevantEntries.length > latestTurns) {
    excludedCounts.horizonEvents +=
      relevantEntries.length - latestTurns;
    relevantEntries = relevantEntries.slice(-latestTurns);
  }
  const requiredSemanticObjectKeys = new Set(
    requirementSet.requiredSemanticObjectRefs
      .map((ref) =>
        `${ref.kind}:${ref.id}:${ref.digest}`),
  );
  let semanticObjects = uniqueRefs(semanticObjectRefs)
    .map((ref) => {
      const artifact =
        typeof repository.semanticContextObject ===
          "function"
          ? repository.semanticContextObject(ref)
          : repository.semanticArtifact(ref.id);
      const projection = semanticObjectProjection(artifact);
      if (!projection) {
        excludedCounts.unsupportedObjects += 1;
      }
      return projection;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const priority = (object) =>
        requiredSemanticObjectKeys.has(
          `${object.objectRef.kind}:${object.objectRef.id}:${object.objectRef.digest}`,
        )
          ? -1
          : object.objectClass === "project_status"
            ? 0
            : object.objectClass === "open_decision"
              ? 1
              : 2;
      return (
        priority(left) - priority(right) ||
        `${left.objectRef.kind}:${left.objectRef.id}`
          .localeCompare(
            `${right.objectRef.kind}:${right.objectRef.id}`,
          )
      );
    });
  const maxObjects = Number(importRequest.budget.maxObjects);
  if (semanticObjects.length > maxObjects) {
    excludedCounts.budgetObjects +=
      semanticObjects.length - maxObjects;
    semanticObjects = semanticObjects.slice(0, maxObjects);
  }
  let relevantEvents = relevantEntries.map((entry) =>
    eventProjection(entry, resultByEventId));
  const sourceShelfRefs = selectedShelves.map((entry) =>
    shelfRef(entry.shelf));
  let sourceSettlementRefs = uniqueRefs(
    relevantEntries.map((entry) => ({
      kind: "semantic_settlement_revision",
      id:
        entry.settlementRevision
          ?.settlementRevisionId ||
        entry.taskSettlement?.taskSettlementId,
      digest:
        entry.settlementRevision?.digest ||
        entry.taskSettlement?.digest,
    })).filter((ref) =>
      text(ref.id, "") && text(ref.digest, "")),
  );
  const policyRefs = uniqueRefs(
    selectedShelves.flatMap((entry) =>
      entry.shelf.semanticObjectRefs.filter((ref) =>
        ref.kind === "policy")),
  );
  const aroRefs = uniqueRefs(
    selectedShelves.flatMap((entry) =>
      entry.shelf.semanticObjectRefs.filter((ref) =>
        ref.kind === "aro")),
  );
  const openDecisionRefs = uniqueRefs(
    semanticObjects
      .filter((object) =>
        object.objectClass === "open_decision")
      .map((object) => object.objectRef),
  );
  const evidenceRefs = uniqueRefs(
    relevantEvents.flatMap((event) =>
      event.relationRefs),
  );
  const selectorPolicyRef = {
    kind: "semantic_context_selector_policy",
    id: stableId("wm_context_selector_policy", {
      selectorPolicyRefs: uniqueRefs(selectorPolicyRefs),
      scope: requirementSet.scope,
      requiredSemanticObjectRefs:
        requirementSet.requiredSemanticObjectRefs,
      relationKinds: importRequest.relationKinds,
      importerRevision: CONTEXT_IMPORTER_REVISION,
    }),
    digest: digestFor(
      "direct_semantic_context_selector_policy@1",
      {
        selectorPolicyRefs: uniqueRefs(selectorPolicyRefs),
        scope: requirementSet.scope,
        requiredSemanticObjectRefs:
          requirementSet.requiredSemanticObjectRefs,
        relationKinds: importRequest.relationKinds,
        crossScopePolicy:
          requirementSet.crossScopePolicy,
        importerRevision: CONTEXT_IMPORTER_REVISION,
        grantsAuthority: false,
      },
    ),
  };
  const content = {
    semanticObjects,
    relevantEvents,
    policyRefs,
    openDecisionRefs,
    aroRefs,
    evidenceRefs,
  };
  let tokens = estimatedTokens(content);
  const maxInputTokens = Number(
    importRequest.budget.maxInputTokens,
  );
  let truncated = false;
  while (
    tokens > maxInputTokens &&
    relevantEvents.length > 0
  ) {
    relevantEvents = relevantEvents.slice(1);
    content.relevantEvents = relevantEvents;
    excludedCounts.budgetEvents += 1;
    truncated = true;
    tokens = estimatedTokens(content);
  }
  const selectedSemanticObjectKeys = new Set(
    content.semanticObjects.map((object) =>
      `${object.objectRef.kind}:${object.objectRef.id}:${object.objectRef.digest}`),
  );
  excludedCounts.missingRequiredObjects =
    [...requiredSemanticObjectKeys]
      .filter((key) =>
        !selectedSemanticObjectKeys.has(key))
      .length;
  const includedEventIds = new Set(
    content.relevantEvents.map((event) =>
      event.eventRef.id),
  );
  sourceSettlementRefs = uniqueRefs(
    relevantEntries
      .filter((entry) =>
        includedEventIds.has(
          entry.event.semanticEventId,
        ))
      .map((entry) => ({
        kind: "semantic_settlement_revision",
        id:
          entry.settlementRevision
            ?.settlementRevisionId ||
          entry.taskSettlement?.taskSettlementId,
        digest:
          entry.settlementRevision?.digest ||
          entry.taskSettlement?.digest,
      }))
      .filter((ref) =>
        text(ref.id, "") && text(ref.digest, "")),
  );
  content.evidenceRefs = uniqueRefs(
    content.relevantEvents.flatMap((event) =>
      event.relationRefs),
  );
  while (
    tokens > maxInputTokens &&
    semanticObjects.length > 0
  ) {
    semanticObjects = semanticObjects.slice(0, -1);
    content.semanticObjects = semanticObjects;
    content.openDecisionRefs = uniqueRefs(
      semanticObjects
        .filter((object) =>
          object.objectClass === "open_decision")
        .map((object) => object.objectRef),
    );
    excludedCounts.budgetObjects += 1;
    truncated = true;
    tokens = estimatedTokens(content);
  }
  if (tokens > maxInputTokens) {
    fail("semantic_context_budget_cannot_be_satisfied");
  }
  const selectionWitness = {
    schema: SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA,
    selectionWitnessId: stableId(
      "wm_context_selection_witness",
      {
        contextImportDigest: importRequest.digest,
        sourceShelfDigests: sourceShelfRefs
          .map((ref) => ref.digest),
        excludedCounts,
        crossScopeDigests: uniqueCrossScope
          .map((ref) => ref.digest),
      },
    ),
    contextImportRef: refFor(
      "semantic_context_import_request",
      importRequest,
      "contextImportId",
    ),
    selectorPolicyRef: exactRef(selectorPolicyRef),
    selectorPolicyRefs: uniqueRefs(selectorPolicyRefs),
    includedRelationKinds: sortedUnique(
      [...relationKinds],
    ),
    excludedCounts,
    crossScopeExclusions: uniqueCrossScope,
    truncation: truncated ||
      excludedCounts.budgetEvents > 0 ||
      excludedCounts.budgetObjects > 0 ||
      excludedCounts.horizonEvents > 0,
    estimatedTokens: tokens,
    rawEvidenceIncluded: false,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  selectionWitness.digest = digestFor(
    SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA,
    selectionWitness,
    ["digest"],
  );
  validateSemanticContextSelectionWitness(
    selectionWitness,
  );
  const sourceWorldRevisions = uniqueRefs([
    ...(compilation.manifest?.worldstateRevisionRefs || [])
      .map(worldRevisionRef),
    ...(compilation.manifest?.graphProjectionRef
      ? [compilation.manifest.graphProjectionRef]
      : []),
  ]);
  const freshness =
    excludedCounts.missingRequiredShelves > 0 ||
    excludedCounts.missingRequiredObjects > 0
      ? "blocked"
      : selectedShelves.some((entry) =>
          entry.shelf.freshness !== "fresh")
        ? "stale"
        : "fresh";
  const dependencyDigest = digestFor(
    "direct_semantic_context_dependencies@1",
    {
      sourceWorldRevisions,
      sourceShelfRefs,
      sourceSettlementRefs,
      semanticObjectRefs: content.semanticObjects
        .map((object) => object.objectRef),
      relevantEventContentDigests:
        content.relevantEvents.map((event) =>
          digestFor(
            "direct_semantic_context_event_projection@1",
            event,
          )),
      selectorPolicyRef,
      freshnessPosture: importRequest.freshness,
      budget: importRequest.budget,
      importerRevision: CONTEXT_IMPORTER_REVISION,
    },
  );
  const cacheKey = stableId(
    "wm_semantic_context_cache",
    {
      agentInstantiationRef:
        importRequest.agentInstantiationRef,
      taskSettlementRef:
        requirementSet.taskSettlementRef,
      anchors: importRequest.anchors,
      dependencyDigest,
      selectorPolicyRef,
      freshness: importRequest.freshness,
      budget: importRequest.budget,
      importerRevision: CONTEXT_IMPORTER_REVISION,
    },
  );
  const bundle = {
    schema: SEMANTIC_CONTEXT_BUNDLE_SCHEMA,
    contextBundleId: stableId(
      "wm_semantic_context_bundle",
      {
        contextImportDigest: importRequest.digest,
        dependencyDigest,
      },
    ),
    contextImportRef: refFor(
      "semantic_context_import_request",
      importRequest,
      "contextImportId",
    ),
    semanticEventId:
      importRequest.semanticEventId,
    agentInstantiationRef:
      importRequest.agentInstantiationRef,
    purpose: importRequest.purpose,
    scope: requirementSet.scope,
    sourceWorldRevisions,
    sourceShelfRefs,
    sourceSettlementRefs,
    content,
    selectionWitness,
    epistemicEffect:
      "operational_meta_context_extended",
    worldEffect: "none",
    grantsAuthority: false,
    freshness,
    cacheKey,
    dependencyDigest,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  bundle.digest = digestFor(
    SEMANTIC_CONTEXT_BUNDLE_SCHEMA,
    bundle,
    ["digest"],
  );
  validateSemanticContextBundle(bundle);
  const constitutionRef =
    compilation.compiledAgentContext
      ?.taskConstitutionRef;
  const operationalManifest = {
    schema: OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA,
    operationalMetaContextId: stableId(
      "wm_operational_meta_context",
      {
        agentInstantiationRef:
          importRequest.agentInstantiationRef,
        contextBundleDigest: bundle.digest,
      },
    ),
    semanticEventId:
      importRequest.semanticEventId,
    agentInstantiationRef:
      importRequest.agentInstantiationRef,
    constitutionRef: exactRef(
      constitutionRef,
      "operationalManifest.constitutionRef",
    ),
    currentIntentRef: exactRef(
      compilation.promptProjection
        ?.currentUserDirectiveRef ||
        compilation.manifest
          ?.sourceAgentResultRef ||
        requirementSet.taskSettlementRef,
      "operationalManifest.currentIntentRef",
    ),
    semanticSettlementRef:
      requirementSet.taskSettlementRef,
    taskContractRef: compilation.outputContract
      ? refFor(
          "agent_output_contract",
          compilation.outputContract,
          "outputContractId",
        )
      : null,
    policyClosureRef: {
      kind: "resolved_policy_closure",
      id: `${constitutionRef.id}:policy_closure`,
      digest:
        compilation.policyCompilation
          ?.resolvedTaskConstitution
          ?.policyClosureDigest ||
        constitutionRef.digest,
    },
    contextRequirementSetRef: refFor(
      "context_requirement_set",
      requirementSet,
      "contextRequirementSetId",
    ),
    contextImportRefs: [
      refFor(
        "semantic_context_import_request",
        importRequest,
        "contextImportId",
      ),
    ],
    contextBundleRefs: [
      refFor(
        "semantic_context_bundle",
        bundle,
        "contextBundleId",
      ),
    ],
    selectionWitnessRefs: [
      refFor(
        "semantic_context_selection_witness",
        selectionWitness,
        "selectionWitnessId",
      ),
    ],
    activeAroViewRefs: content.aroRefs,
    evidenceRefs: content.evidenceRefs,
    workingArtifactRefs:
      content.semanticObjects.map((object) =>
        object.objectRef),
    attentionBudget: {
      estimatedInputTokens: tokens,
      reservedReasoningTokens: 2_048,
      reservedOutputTokens: 1_024,
    },
    sourceRevisionRefs: uniqueRefs([
      ...sourceWorldRevisions,
      ...sourceShelfRefs,
      ...sourceSettlementRefs,
    ]),
    stale: freshness !== "fresh",
    cacheKey,
    dependencyDigest,
    requestManifestLinkState: "not_requested",
    rawChainOfThoughtIncluded: false,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  if (operationalManifest.taskContractRef) {
    operationalManifest.taskContractRef = exactRef(
      operationalManifest.taskContractRef,
    );
  }
  operationalManifest.policyClosureRef = exactRef(
    operationalManifest.policyClosureRef,
  );
  operationalManifest.digest = digestFor(
    OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA,
    operationalManifest,
    ["digest"],
  );
  validateOperationalMetaContextManifest(
    operationalManifest,
  );
  return {
    requirementSet,
    importRequest,
    selectionWitness,
    bundle,
    operationalManifest,
    cacheKey,
    dependencyDigest,
  };
}

function IMPORT_CONTEXT(input = {}) {
  return materializeSemanticContext(input);
}

const IMPORT_CONTEXT_TOOL = Object.freeze({
  schema: "direct_semantic_context_tool_definition@1",
  name: "IMPORT_CONTEXT",
  operationClass: "read_only_epistemic_operation",
  requestSchema:
    SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA,
  resultSchema: SEMANTIC_CONTEXT_BUNDLE_SCHEMA,
  worldEffect: "none",
  grantsAuthority: false,
});

function validateSemanticContextBundle(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_CONTEXT_BUNDLE_SCHEMA ||
    !text(value.contextBundleId, "") ||
    !text(value.semanticEventId, "") ||
    !PURPOSES.has(value.purpose) ||
    !isPlainObject(value.scope) ||
    !Array.isArray(value.sourceWorldRevisions) ||
    !Array.isArray(value.sourceShelfRefs) ||
    !Array.isArray(value.sourceSettlementRefs) ||
    !isPlainObject(value.content) ||
    !Array.isArray(value.content.semanticObjects) ||
    !Array.isArray(value.content.relevantEvents) ||
    !Array.isArray(value.content.policyRefs) ||
    !Array.isArray(value.content.openDecisionRefs) ||
    !Array.isArray(value.content.aroRefs) ||
    !Array.isArray(value.content.evidenceRefs) ||
    value.epistemicEffect !==
      "operational_meta_context_extended" ||
    value.worldEffect !== "none" ||
    value.grantsAuthority !== false ||
    !BUNDLE_FRESHNESS.has(value.freshness) ||
    !text(value.cacheKey, "") ||
    !text(value.dependencyDigest, "")
  ) {
    fail("semantic_context_bundle_invalid");
  }
  exactRef(
    value.contextImportRef,
    "semanticContextBundle.contextImportRef",
  );
  exactRef(
    value.agentInstantiationRef,
    "semanticContextBundle.agentInstantiationRef",
  );
  for (
    const [label, refs] of [
      ["sourceWorldRevisions", value.sourceWorldRevisions],
      ["sourceShelfRefs", value.sourceShelfRefs],
      ["sourceSettlementRefs", value.sourceSettlementRefs],
      ["policyRefs", value.content.policyRefs],
      ["openDecisionRefs", value.content.openDecisionRefs],
      ["aroRefs", value.content.aroRefs],
      ["evidenceRefs", value.content.evidenceRefs],
    ]
  ) {
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `semanticContextBundle.${label}.${index}`,
      ));
  }
  validateSemanticContextSelectionWitness(
    value.selectionWitness,
  );
  for (const object of value.content.semanticObjects) {
    if (
      !isPlainObject(object) ||
      !text(object.objectClass, "") ||
      !AUTHORITY_POSTURES.has(
        object.authorityPosture,
      ) ||
      !isPlainObject(object.boundedProjection)
    ) {
      fail("semantic_context_object_projection_invalid");
    }
    exactRef(object.objectRef);
  }
  for (
    const [index, event] of
      value.content.relevantEvents.entries()
  ) {
    if (
      !isPlainObject(event) ||
      !text(event.semanticSummary, "") ||
      !Array.isArray(event.relationRefs)
    ) {
      fail(
        "semantic_context_event_projection_invalid",
        String(index),
      );
    }
    exactRef(
      event.eventRef,
      `semanticContextBundle.events.${index}.eventRef`,
    );
    event.relationRefs.forEach((ref, refIndex) =>
      exactRef(
        ref,
        `semanticContextBundle.events.${index}.relations.${refIndex}`,
      ));
  }
  const projectedOpenDecisionKeys =
    value.content.semanticObjects
      .filter((object) =>
        object.objectClass === "open_decision")
      .map((object) =>
        `${object.objectRef.id}:${object.objectRef.digest}`)
      .sort();
  const declaredOpenDecisionKeys =
    value.content.openDecisionRefs
      .map((ref) => `${ref.id}:${ref.digest}`)
      .sort();
  if (
    JSON.stringify(projectedOpenDecisionKeys) !==
      JSON.stringify(declaredOpenDecisionKeys)
  ) {
    fail(
      "semantic_context_open_decision_projection_mismatch",
    );
  }
  if (!digestValid(value, SEMANTIC_CONTEXT_BUNDLE_SCHEMA)) {
    fail("semantic_context_bundle_digest_mismatch");
  }
  return true;
}

function validateOperationalMetaContextManifest(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA ||
    !text(value.operationalMetaContextId, "") ||
    !text(value.semanticEventId, "") ||
    !Array.isArray(value.contextImportRefs) ||
    !Array.isArray(value.contextBundleRefs) ||
    !Array.isArray(value.selectionWitnessRefs) ||
    !Array.isArray(value.activeAroViewRefs) ||
    !Array.isArray(value.evidenceRefs) ||
    !Array.isArray(value.workingArtifactRefs) ||
    !isPlainObject(value.attentionBudget) ||
    !Array.isArray(value.sourceRevisionRefs) ||
    typeof value.stale !== "boolean" ||
    value.rawChainOfThoughtIncluded !== false ||
    value.grantsAuthority !== false
  ) {
    fail("operational_meta_context_manifest_invalid");
  }
  for (
    const [label, ref] of [
      ["agentInstantiationRef", value.agentInstantiationRef],
      ["constitutionRef", value.constitutionRef],
      ["currentIntentRef", value.currentIntentRef],
      ["semanticSettlementRef", value.semanticSettlementRef],
      ["policyClosureRef", value.policyClosureRef],
      [
        "contextRequirementSetRef",
        value.contextRequirementSetRef,
      ],
    ]
  ) {
    exactRef(ref, `operationalManifest.${label}`);
  }
  for (
    const [label, refs] of [
      ["contextImportRefs", value.contextImportRefs],
      ["contextBundleRefs", value.contextBundleRefs],
      ["selectionWitnessRefs", value.selectionWitnessRefs],
      ["activeAroViewRefs", value.activeAroViewRefs],
      ["evidenceRefs", value.evidenceRefs],
      ["workingArtifactRefs", value.workingArtifactRefs],
      ["sourceRevisionRefs", value.sourceRevisionRefs],
    ]
  ) {
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `operationalManifest.${label}.${index}`,
      ));
  }
  if (value.taskContractRef) {
    exactRef(
      value.taskContractRef,
      "operationalManifest.taskContractRef",
    );
  }
  if (
    !digestValid(
      value,
      OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA,
    )
  ) {
    fail("operational_meta_context_manifest_digest_mismatch");
  }
  return true;
}

function buildOperationalMetaContextBinding(input = {}) {
  const result = input.result || input;
  validateContextRequirementSet(result.requirementSet);
  validateSemanticContextImportRequest(
    result.importRequest,
  );
  validateSemanticContextBundle(result.bundle);
  validateOperationalMetaContextManifest(
    result.operationalManifest,
  );
  const binding = {
    schema: OPERATIONAL_META_CONTEXT_BINDING_SCHEMA,
    agentInstantiationRef:
      result.operationalManifest.agentInstantiationRef,
    operationalMetaContextRef: refFor(
      "operational_meta_context_manifest",
      result.operationalManifest,
      "operationalMetaContextId",
    ),
    contextRequirementSetRef: refFor(
      "context_requirement_set",
      result.requirementSet,
      "contextRequirementSetId",
    ),
    contextImportRefs: [
      refFor(
        "semantic_context_import_request",
        result.importRequest,
        "contextImportId",
      ),
    ],
    contextBundleRefs: [
      refFor(
        "semantic_context_bundle",
        result.bundle,
        "contextBundleId",
      ),
    ],
    selectionWitnessRefs: [
      refFor(
        "semantic_context_selection_witness",
        result.selectionWitness,
        "selectionWitnessId",
      ),
    ],
    providerProjectionText: providerProjectionText({
      bundle: result.bundle,
      manifest: result.operationalManifest,
    }),
    providerProjectionTextDigest: "",
    sourceShelfRefs: result.bundle.sourceShelfRefs,
    freshness: result.bundle.freshness,
    grantsAuthority: false,
    rawEvidenceIncluded: false,
  };
  binding.providerProjectionTextDigest = digestFor(
    "direct_operational_meta_context_provider_projection@1",
    { text: binding.providerProjectionText },
  );
  binding.digest = digestFor(
    OPERATIONAL_META_CONTEXT_BINDING_SCHEMA,
    binding,
    ["digest"],
  );
  validateOperationalMetaContextBinding(binding);
  return binding;
}

function validateOperationalMetaContextBinding(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      OPERATIONAL_META_CONTEXT_BINDING_SCHEMA ||
    !Array.isArray(value.contextImportRefs) ||
    !Array.isArray(value.contextBundleRefs) ||
    !Array.isArray(value.selectionWitnessRefs) ||
    !Array.isArray(value.sourceShelfRefs) ||
    !text(value.providerProjectionText, "") ||
    !text(value.providerProjectionTextDigest, "") ||
    !BUNDLE_FRESHNESS.has(value.freshness) ||
    value.grantsAuthority !== false ||
    value.rawEvidenceIncluded !== false
  ) {
    fail("operational_meta_context_binding_invalid");
  }
  exactRef(
    value.agentInstantiationRef,
    "operationalBinding.agentInstantiationRef",
  );
  exactRef(
    value.operationalMetaContextRef,
    "operationalBinding.operationalMetaContextRef",
  );
  exactRef(
    value.contextRequirementSetRef,
    "operationalBinding.contextRequirementSetRef",
  );
  for (
    const [label, refs] of [
      ["contextImportRefs", value.contextImportRefs],
      ["contextBundleRefs", value.contextBundleRefs],
      ["selectionWitnessRefs", value.selectionWitnessRefs],
      ["sourceShelfRefs", value.sourceShelfRefs],
    ]
  ) {
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `operationalBinding.${label}.${index}`,
      ));
  }
  if (
    value.providerProjectionTextDigest !==
      digestFor(
        "direct_operational_meta_context_provider_projection@1",
        { text: value.providerProjectionText },
      ) ||
    !digestValid(
      value,
      OPERATIONAL_META_CONTEXT_BINDING_SCHEMA,
    )
  ) {
    fail("operational_meta_context_binding_digest_mismatch");
  }
  return true;
}

function bindOperationalMetaContextToCompiledContext(
  compiledAgentContext,
  binding,
) {
  if (
    !isPlainObject(compiledAgentContext) ||
    compiledAgentContext.schema !==
      "direct_compiled_agent_context@1" ||
    compiledAgentContext.digest !==
      digestFor(
        "direct_compiled_agent_context@1",
        compiledAgentContext,
        ["digest"],
      )
  ) {
    fail("compiled_agent_context_binding_source_invalid");
  }
  validateOperationalMetaContextBinding(binding);
  if (
    compiledAgentContext.agentInstantiationRef?.id !==
      binding.agentInstantiationRef.id ||
    compiledAgentContext.agentInstantiationRef?.digest !==
      binding.agentInstantiationRef.digest
  ) {
    fail("compiled_agent_context_binding_lineage_invalid");
  }
  const result = {
    ...compiledAgentContext,
    compiledAgentContextId: stableId(
      "wm_compiled_agent_context",
      {
        baseCompiledAgentContextId:
          compiledAgentContext.compiledAgentContextId,
        baseDigest: compiledAgentContext.digest,
        operationalMetaContextDigest: binding.digest,
      },
    ),
    baseCompiledAgentContextRef: {
      kind: "compiled_agent_context",
      id:
        compiledAgentContext.compiledAgentContextId,
      digest: compiledAgentContext.digest,
    },
    operationalMetaContextBinding: binding,
    grantsAuthority: false,
  };
  result.digest = digestFor(
    "direct_compiled_agent_context@1",
    result,
    ["digest"],
  );
  return result;
}

function buildContextRequestManifestLink(input = {}) {
  const operationalManifest = input.operationalManifest;
  validateOperationalMetaContextManifest(
    operationalManifest,
  );
  const requestManifestId = text(
    input.requestManifestId,
    "",
  );
  const directSessionId = text(
    input.directSessionId,
    "",
  );
  const directTurnId = text(input.directTurnId, "");
  if (
    !requestManifestId ||
    !directSessionId ||
    !directTurnId
  ) {
    fail("context_request_manifest_link_target_missing");
  }
  const result = {
    schema: CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA,
    contextRequestManifestLinkId: stableId(
      "wm_context_request_manifest_link",
      {
        operationalMetaContextDigest:
          operationalManifest.digest,
        requestManifestId,
        directSessionId,
        directTurnId,
      },
    ),
    semanticEventId:
      operationalManifest.semanticEventId,
    agentInstantiationRef:
      operationalManifest.agentInstantiationRef,
    operationalMetaContextRef: refFor(
      "operational_meta_context_manifest",
      operationalManifest,
      "operationalMetaContextId",
    ),
    directSessionId,
    directTurnId,
    requestManifestId,
    providerInputMutation: false,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  result.digest = digestFor(
    CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA,
    result,
    ["digest"],
  );
  validateContextRequestManifestLink(result);
  return result;
}

function validateContextRequestManifestLink(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA ||
    !text(value.contextRequestManifestLinkId, "") ||
    !text(value.semanticEventId, "") ||
    !text(value.directSessionId, "") ||
    !text(value.directTurnId, "") ||
    !text(value.requestManifestId, "") ||
    value.providerInputMutation !== false ||
    value.grantsAuthority !== false
  ) {
    fail("context_request_manifest_link_invalid");
  }
  exactRef(value.agentInstantiationRef);
  exactRef(value.operationalMetaContextRef);
  if (
    !digestValid(
      value,
      CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA,
    )
  ) {
    fail("context_request_manifest_link_digest_mismatch");
  }
  return true;
}

function rendererSafeOperationalMetaContextSummary(
  result,
  link = null,
) {
  const requirementSet = result.requirementSet;
  const bundle = result.bundle;
  const witness = result.selectionWitness;
  return {
    schema:
      "renderer_safe_operational_meta_context_summary@1",
    semanticEventId: bundle.semanticEventId,
    purpose: bundle.purpose,
    scope: bundle.scope,
    freshness: bundle.freshness,
    contextRequirementSetRef: refFor(
      "context_requirement_set",
      requirementSet,
      "contextRequirementSetId",
    ),
    contextImportRef: refFor(
      "semantic_context_import_request",
      result.importRequest,
      "contextImportId",
    ),
    contextBundleRef: refFor(
      "semantic_context_bundle",
      bundle,
      "contextBundleId",
    ),
    operationalMetaContextRef: refFor(
      "operational_meta_context_manifest",
      result.operationalManifest,
      "operationalMetaContextId",
    ),
    selectionWitnessRef: refFor(
      "semantic_context_selection_witness",
      witness,
      "selectionWitnessId",
    ),
    sourceShelfKinds: bundle.sourceShelfRefs
      .map((ref) => ref.label || ref.id),
    sourceShelfCount: bundle.sourceShelfRefs.length,
    selectedSemanticObjectCount:
      bundle.content.semanticObjects.length,
    selectedEventCount:
      bundle.content.relevantEvents.length,
    openDecisionCount:
      bundle.content.openDecisionRefs.length,
    estimatedInputTokens: witness.estimatedTokens,
    maxInputTokens:
      requirementSet.budget.maxInputTokens,
    excludedCounts: witness.excludedCounts,
    crossScopeExclusionCount:
      witness.crossScopeExclusions.length,
    truncated: witness.truncation,
    rawEvidenceIncluded: false,
    requestManifestLinkState: link
      ? "linked"
      : "pending_role_request",
    requestManifestId:
      link?.requestManifestId || "",
    worldEffect: "none",
    grantsAuthority: false,
  };
}

module.exports = {
  CONTEXT_IMPORTER_REVISION,
  CONTEXT_REQUEST_MANIFEST_LINK_SCHEMA,
  CONTEXT_REQUIREMENT_SET_SCHEMA,
  OPERATIONAL_META_CONTEXT_BINDING_SCHEMA,
  OPERATIONAL_META_CONTEXT_MANIFEST_SCHEMA,
  SEMANTIC_CONTEXT_BUNDLE_SCHEMA,
  SEMANTIC_CONTEXT_IMPORT_REQUEST_SCHEMA,
  SEMANTIC_CONTEXT_SELECTION_WITNESS_SCHEMA,
  IMPORT_CONTEXT,
  IMPORT_CONTEXT_TOOL,
  bindOperationalMetaContextToCompiledContext,
  buildContextRequestManifestLink,
  buildContextRequirementSet,
  buildOperationalMetaContextBinding,
  buildSemanticContextImportRequest,
  materializeSemanticContext,
  purposeForTask,
  rendererSafeOperationalMetaContextSummary,
  validateContextRequestManifestLink,
  validateContextRequirementSet,
  validateOperationalMetaContextBinding,
  validateOperationalMetaContextManifest,
  validateSemanticContextBundle,
  validateSemanticContextImportRequest,
  validateSemanticContextSelectionWitness,
};
