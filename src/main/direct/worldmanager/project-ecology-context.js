"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const PROJECT_STATUS_CONTEXT_SCHEMA =
  "direct_project_status_context_object@1";

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

function bounded(value, fallback = "", max = 640) {
  const result = text(value, fallback);
  return result.length > max
    ? `${result.slice(0, Math.max(0, max - 1)).trimEnd()}…`
    : result;
}

function exactSourceRef(kind, id, digest, label = "") {
  if (!text(kind, "") || !text(id, "") || !text(digest, "")) {
    fail("project_status_context_source_ref_invalid");
  }
  return {
    kind: text(kind, ""),
    id: text(id, ""),
    digest: text(digest, ""),
    ...(text(label, "")
      ? { label: bounded(label, "", 160) }
      : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function uniqueRefs(refs = []) {
  const seen = new Set();
  return refs.filter(Boolean).filter((ref) => {
    const exact = exactSourceRef(
      ref.kind,
      ref.id,
      ref.digest,
      ref.label,
    );
    const key = `${exact.kind}:${exact.id}:${exact.digest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) =>
    exactSourceRef(
      ref.kind,
      ref.id,
      ref.digest,
      ref.label,
    )).sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(
      `${right.kind}:${right.id}`,
    ));
}

function latestCandidatesByProject(candidateArtifacts = []) {
  const candidates = new Map();
  for (const candidate of candidateArtifacts) {
    if (
      candidate?.schema !==
        "direct_project_constitution_candidate@1" ||
      !text(candidate.proposedProjectId, "")
    ) {
      continue;
    }
    candidates.set(candidate.proposedProjectId, candidate);
  }
  return candidates;
}

function statusSummary(fields = {}) {
  const posture =
    fields.statusClass === "semantic_constitution"
      ? `Canonical project constitution; activation is ${fields.activationState.replace(/_/g, " ")}.`
      : fields.statusClass === "semantic_candidate"
        ? `Project constitution candidate; evidence is ${fields.evidenceReviewState.replace(/_/g, " ")} and reconciliation is ${fields.reconciliationState.replace(/_/g, " ")}.`
        : `Configured runtime project; activation is ${fields.activationState.replace(/_/g, " ")}.`;
  const decisions = fields.openDecisionCount
    ? ` ${fields.openDecisionCount} open decision${
        fields.openDecisionCount === 1 ? "" : "s"
      }.`
    : " No open decisions.";
  return bounded(`${posture}${decisions}`, posture, 640);
}

function buildProjectStatusContextObject(input = {}) {
  const projectId = text(input.projectId, "");
  const userWorldId = text(
    input.userWorldId,
    "user_world_local",
  );
  if (!projectId) {
    fail("project_status_context_project_required");
  }
  const openDecisionRefs = uniqueRefs(
    input.openDecisionRefs || [],
  );
  const sourceRefs = uniqueRefs(input.sourceRefs || []);
  if (!sourceRefs.length) {
    fail(
      "project_status_context_source_required",
      projectId,
    );
  }
  const fields = {
    statusClass: text(
      input.statusClass,
      "runtime_project",
    ),
    activationState: text(
      input.activationState,
      "configured_legacy_project",
    ),
    evidenceReviewState: text(
      input.evidenceReviewState,
      "not_applicable",
    ),
    reconciliationState: text(
      input.reconciliationState,
      "not_applicable",
    ),
    openDecisionCount: openDecisionRefs.length,
  };
  const result = {
    schema: PROJECT_STATUS_CONTEXT_SCHEMA,
    projectStatusId: stableId(
      "wm_project_status_context",
      { userWorldId, projectId },
    ),
    userWorldId,
    projectId,
    identity: bounded(
      input.identity,
      projectId,
      180,
    ),
    summary: bounded(
      input.summary,
      "No project summary has been admitted.",
      640,
    ),
    statusClass: fields.statusClass,
    constitutionState: text(
      input.constitutionState,
      "not_admitted",
    ),
    activationState: fields.activationState,
    sourceKind: text(
      input.sourceKind,
      "configured_project",
    ),
    primaryAgentEnvironmentId: text(
      input.primaryAgentEnvironmentId,
      "",
    ),
    candidateLifecycle: text(
      input.candidateLifecycle,
      "",
    ),
    evidenceReviewState:
      fields.evidenceReviewState,
    reconciliationState:
      fields.reconciliationState,
    openDecisionCount: fields.openDecisionCount,
    openDecisionRefs,
    attentionRequired:
      input.attentionRequired === true ||
      fields.openDecisionCount > 0,
    statusSummary: statusSummary(fields),
    sourceRefs,
    canonical: input.canonical === true,
    freshness: "fresh",
    grantsAuthority: false,
  };
  result.digest = digestFor(
    PROJECT_STATUS_CONTEXT_SCHEMA,
    result,
    ["digest"],
  );
  validateProjectStatusContextObject(result);
  return result;
}

function validateProjectStatusContextObject(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PROJECT_STATUS_CONTEXT_SCHEMA ||
    !text(value.projectStatusId, "") ||
    !text(value.userWorldId, "") ||
    !text(value.projectId, "") ||
    !text(value.identity, "") ||
    !text(value.statusClass, "") ||
    !text(value.constitutionState, "") ||
    !text(value.activationState, "") ||
    !Array.isArray(value.openDecisionRefs) ||
    Number(value.openDecisionCount) !==
      value.openDecisionRefs.length ||
    !Array.isArray(value.sourceRefs) ||
    !value.sourceRefs.length ||
    !["fresh", "stale"].includes(value.freshness) ||
    typeof value.canonical !== "boolean" ||
    value.grantsAuthority !== false
  ) {
    fail("project_status_context_object_invalid");
  }
  value.openDecisionRefs.forEach((ref) =>
    exactSourceRef(ref.kind, ref.id, ref.digest));
  value.sourceRefs.forEach((ref) =>
    exactSourceRef(ref.kind, ref.id, ref.digest));
  if (
    value.digest !==
      digestFor(
        PROJECT_STATUS_CONTEXT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("project_status_context_digest_mismatch");
  }
  return true;
}

function buildProjectEcologyStatusObjects(input = {}) {
  const bootstrap = input.bootstrap || {};
  const userWorldId = text(
    input.userWorldId ||
      bootstrap.userWorld?.userWorldId,
    "user_world_local",
  );
  const configured = new Map(
    (bootstrap.projects || []).map((project) => [
      project.projectId,
      project,
    ]),
  );
  const constitutions = new Map(
    (input.projectConstitutions || []).map(
      (constitution) => [
        constitution.projectId,
        constitution,
      ],
    ),
  );
  const candidates = latestCandidatesByProject(
    input.candidateArtifacts,
  );
  const runtimeDefaults = new Map(
    (input.projectRuntimeDefaults || []).map(
      (binding) => [binding.projectId, binding],
    ),
  );
  const openDecisions = (
    input.openDecisions || []
  ).filter((decision) =>
    decision?.schema === "direct_open_decision@1" &&
    ["open", "blocked", "conflicted"].includes(
      decision.decisionState,
    ));
  const projectIds = new Set([
    ...configured.keys(),
    ...constitutions.keys(),
    ...candidates.keys(),
    ...openDecisions
      .map((decision) =>
        text(decision.header?.scope?.projectId, ""))
      .filter(Boolean),
  ]);
  return [...projectIds].sort().map((projectId) => {
    const configuredProject = configured.get(projectId);
    const constitution = constitutions.get(projectId);
    const candidate = candidates.get(projectId);
    const runtimeDefault = runtimeDefaults.get(projectId);
    const decisions = openDecisions.filter((decision) =>
      decision.header?.scope?.projectId === projectId);
    const sourceRefs = [];
    if (configuredProject?.configurationDigest) {
      sourceRefs.push(exactSourceRef(
        "configured_project",
        projectId,
        configuredProject.configurationDigest,
        configuredProject.name,
      ));
    }
    if (candidate?.candidateId && candidate?.digest) {
      sourceRefs.push(exactSourceRef(
        "project_constitution_candidate",
        candidate.candidateId,
        candidate.digest,
        candidate.identity,
      ));
    }
    if (constitution?.digest) {
      sourceRefs.push(exactSourceRef(
        "project_constitution",
        projectId,
        constitution.digest,
        constitution.identity,
      ));
    }
    if (runtimeDefault?.bindingId && runtimeDefault?.digest) {
      sourceRefs.push(exactSourceRef(
        "project_runtime_default_binding",
        runtimeDefault.bindingId,
        runtimeDefault.digest,
        projectId,
      ));
    }
    for (const decision of decisions) {
      sourceRefs.push(exactSourceRef(
        "open_decision",
        decision.decisionId,
        decision.digest,
        decision.question,
      ));
    }
    const statusClass = constitution
      ? (
          constitution.activationState === "active"
            ? "runtime_project"
            : "semantic_constitution"
        )
      : candidate
        ? "semantic_candidate"
        : "runtime_project";
    const activationState = constitution
      ? text(
          constitution.activationState,
          "awaiting_workspace_provisioning",
        )
      : candidate
        ? text(
            candidate.activationState,
            "not_admitted",
          )
        : "configured_legacy_project";
    return buildProjectStatusContextObject({
      userWorldId,
      projectId,
      identity:
        constitution?.identity ||
        candidate?.identity ||
        configuredProject?.name ||
        projectId,
      summary:
        constitution?.purpose ||
        candidate?.purpose ||
        candidate?.semanticSummary ||
        configuredProject?.summary,
      statusClass,
      constitutionState:
        constitution ? "canonical" : "not_admitted",
      activationState,
      sourceKind: constitution
        ? "canonical_project_constitution"
        : candidate
          ? "project_constitution_candidate"
          : "configured_project",
      primaryAgentEnvironmentId:
        constitution?.primaryAgentEnvironmentId ||
        candidate?.primaryAgentEnvironmentId ||
        "",
      candidateLifecycle:
        candidate?.lifecycle || "",
      evidenceReviewState:
        candidate?.evidenceReviewState ||
        "not_applicable",
      reconciliationState:
        candidate?.reconciliationState ||
        "not_applicable",
      openDecisionRefs: decisions.map((decision) =>
        exactSourceRef(
          "open_decision",
          decision.decisionId,
          decision.digest,
          decision.question,
        )),
      attentionRequired:
        statusClass !== "runtime_project" ||
        decisions.length > 0,
      sourceRefs,
      canonical: Boolean(constitution || configuredProject),
    });
  });
}

function projectStatusContextRef(value) {
  validateProjectStatusContextObject(value);
  return exactSourceRef(
    "project_status",
    value.projectStatusId,
    value.digest,
    value.identity,
  );
}

function projectStatusSemanticProjection(value) {
  validateProjectStatusContextObject(value);
  return {
    objectRef: projectStatusContextRef(value),
    objectClass: "project_status",
    authorityPosture:
      value.canonical === true ? "canonical" : "candidate",
    boundedProjection: {
      projectId: value.projectId,
      identity: value.identity,
      summary: value.summary,
      statusClass: value.statusClass,
      constitutionState: value.constitutionState,
      activationState: value.activationState,
      sourceKind: value.sourceKind,
      primaryAgentEnvironmentId:
        value.primaryAgentEnvironmentId,
      candidateLifecycle: value.candidateLifecycle,
      evidenceReviewState:
        value.evidenceReviewState,
      reconciliationState:
        value.reconciliationState,
      openDecisionCount: value.openDecisionCount,
      attentionRequired: value.attentionRequired,
      statusSummary: value.statusSummary,
      freshness: value.freshness,
    },
  };
}

function semanticProjectIndex(statusObjects = []) {
  return statusObjects.map((status) => {
    validateProjectStatusContextObject(status);
    return {
      projectId: status.projectId,
      id: status.projectId,
      name: status.identity,
      summary: status.summary,
      statusClass: status.statusClass,
      activationState: status.activationState,
      roleRuntimeAddressable:
        status.sourceRefs.some((ref) =>
          ref.kind ===
            "configured_project"),
      canonical: status.canonical,
    };
  });
}

module.exports = {
  PROJECT_STATUS_CONTEXT_SCHEMA,
  buildProjectEcologyStatusObjects,
  buildProjectStatusContextObject,
  projectStatusContextRef,
  projectStatusSemanticProjection,
  semanticProjectIndex,
  validateProjectStatusContextObject,
};
