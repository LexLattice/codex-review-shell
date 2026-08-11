"use strict";

const { digestFor, stableId } = require("./control-plane");

const REALIZATION_OPTION_SNAPSHOT_SCHEMA =
  "direct_realization_option_snapshot@1";
const PROJECT_GENESIS_RESULT_SCHEMA =
  "direct_world_manager_project_genesis_result@1";
const PROJECT_CONSTITUTION_CANDIDATE_SCHEMA =
  "direct_project_constitution_candidate@1";
const PROJECT_CONSTITUTION_SCHEMA =
  "direct_project_constitution@1";
const PROJECT_RUNTIME_DEFAULT_BINDING_SCHEMA =
  "direct_project_runtime_default_binding@1";
const PROJECT_CONSTITUTION_ADMISSION_SCHEMA =
  "direct_project_constitution_admission@1";

const AVAILABILITY = new Set([
  "ready",
  "degraded",
  "unavailable",
  "unknown",
]);
const ADMISSION_STATES = new Set(["eligible", "blocked"]);
const ENVIRONMENT_KINDS = new Set([
  "wsl",
  "windows",
  "macos",
  "linux",
  "remote",
  "unknown",
]);

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
  if (!result) fail("world_manager_project_genesis_missing_string", label);
  return result;
}

function bounded(value, fallback, limit) {
  return text(value, fallback).slice(0, limit);
}

function stringList(values, limit = 16) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))]
    .slice(0, limit);
}

function exactRef(input, label) {
  if (!isPlainObject(input)) {
    fail("world_manager_project_genesis_invalid_ref", label);
  }
  const result = {
    kind: required(input.kind, `${label}.kind`),
    id: required(input.id, `${label}.id`),
    digest: required(input.digest, `${label}.digest`),
  };
  if (!/^sha256:[a-f0-9]{64}$/i.test(result.digest)) {
    fail("world_manager_project_genesis_invalid_ref_digest", label);
  }
  return result;
}

function normalizeProjectId(value, fallbackSeed = "project") {
  const normalized = text(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  if (normalized && /^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    return normalized.startsWith("project_")
      ? normalized
      : `project_${normalized}`;
  }
  return stableId("project", { seed: fallbackSeed }).slice(0, 80);
}

function normalizeRealizationOption(input = {}, index = 0) {
  const environmentId = required(
    input.environmentId,
    `realizationOptions.${index}.environmentId`,
  );
  const availability = AVAILABILITY.has(input.availability)
    ? input.availability
    : "unknown";
  const admissionState = ADMISSION_STATES.has(input.admissionState)
    ? input.admissionState
    : availability === "ready"
      ? "eligible"
      : "blocked";
  if (admissionState === "eligible" && availability !== "ready") {
    fail(
      "world_manager_project_genesis_ineligible_availability",
      environmentId,
    );
  }
  const option = {
    environmentId,
    environmentKind: ENVIRONMENT_KINDS.has(input.environmentKind)
      ? input.environmentKind
      : "unknown",
    displayLabel: bounded(input.displayLabel, environmentId, 120),
    availability,
    admissionState,
    nativeProcess: input.nativeProcess === true,
    residentExecutorSupport: input.residentExecutorSupport === true,
    defaultShell: bounded(input.defaultShell, "unknown", 40),
    capabilityClasses: stringList(input.capabilityClasses, 32).sort(),
    blockerCodes: stringList(input.blockerCodes, 16).sort(),
    evidenceRefs: (Array.isArray(input.evidenceRefs)
      ? input.evidenceRefs
      : []).map((entry, evidenceIndex) =>
      exactRef(entry, `realizationOptions.${index}.evidenceRefs.${evidenceIndex}`)),
    grantsAuthority: false,
  };
  option.digest = digestFor("direct_realization_option@1", option, ["digest"]);
  return option;
}

function buildRealizationOptionSnapshot(input = {}, options = {}) {
  const realizationOptions = (Array.isArray(input.options)
    ? input.options
    : []).map(normalizeRealizationOption);
  if (!realizationOptions.length) {
    fail("world_manager_project_genesis_realization_options_required");
  }
  const ids = new Set();
  for (const option of realizationOptions) {
    if (ids.has(option.environmentId)) {
      fail(
        "world_manager_project_genesis_duplicate_environment",
        option.environmentId,
      );
    }
    ids.add(option.environmentId);
  }
  const observedAt = text(
    input.observedAt,
    new Date(
      typeof options.now === "function" ? options.now() : Date.now(),
    ).toISOString(),
  );
  const snapshot = {
    schema: REALIZATION_OPTION_SNAPSHOT_SCHEMA,
    snapshotId: text(
      input.snapshotId,
      stableId("realization_snapshot", {
        controlPlaneEnvironmentId: input.controlPlaneEnvironmentId,
        observedAt,
        optionDigests: realizationOptions.map((entry) => entry.digest),
      }),
    ),
    controlPlaneEnvironmentId: required(
      input.controlPlaneEnvironmentId,
      "realizationSnapshot.controlPlaneEnvironmentId",
    ),
    options: realizationOptions,
    observedAt,
    discoveryPosture: text(
      input.discoveryPosture,
      "harness_observed_runtime_capabilities",
    ),
    grantsAuthority: false,
    rawCredentialIncluded: false,
  };
  snapshot.digest = digestFor(
    REALIZATION_OPTION_SNAPSHOT_SCHEMA,
    snapshot,
    ["digest"],
  );
  validateRealizationOptionSnapshot(snapshot);
  return snapshot;
}

function validateRealizationOptionSnapshot(snapshot) {
  if (
    !isPlainObject(snapshot) ||
    snapshot.schema !== REALIZATION_OPTION_SNAPSHOT_SCHEMA ||
    !Array.isArray(snapshot.options) ||
    !snapshot.options.length ||
    snapshot.grantsAuthority !== false ||
    snapshot.rawCredentialIncluded !== false
  ) {
    fail("world_manager_project_genesis_realization_snapshot_invalid");
  }
  required(snapshot.snapshotId, "realizationSnapshot.snapshotId");
  required(
    snapshot.controlPlaneEnvironmentId,
    "realizationSnapshot.controlPlaneEnvironmentId",
  );
  const ids = new Set();
  for (const [index, option] of snapshot.options.entries()) {
    const normalized = normalizeRealizationOption(option, index);
    if (normalized.digest !== option.digest) {
      fail(
        "world_manager_project_genesis_realization_option_digest_mismatch",
        option.environmentId,
      );
    }
    if (ids.has(option.environmentId)) {
      fail(
        "world_manager_project_genesis_duplicate_environment",
        option.environmentId,
      );
    }
    ids.add(option.environmentId);
  }
  if (
    snapshot.digest !==
    digestFor(REALIZATION_OPTION_SNAPSHOT_SCHEMA, snapshot, ["digest"])
  ) {
    fail(
      "world_manager_project_genesis_realization_snapshot_digest_mismatch",
    );
  }
  return true;
}

function realizationSnapshotRef(snapshot) {
  validateRealizationOptionSnapshot(snapshot);
  return {
    kind: "realization_option_snapshot",
    id: snapshot.snapshotId,
    digest: snapshot.digest,
  };
}

function trustedRealizationEvidence(snapshot) {
  validateRealizationOptionSnapshot(snapshot);
  const evidence = {
    schema: "direct_trusted_realization_evidence@1",
    evidenceId: stableId("trusted_realization_evidence", {
      snapshotDigest: snapshot.digest,
    }),
    realizationSnapshotRef: realizationSnapshotRef(snapshot),
    controlPlaneEnvironmentId:
      snapshot.controlPlaneEnvironmentId,
    options: snapshot.options.map((option) => ({
      environmentId: option.environmentId,
      environmentKind: option.environmentKind,
      displayLabel: option.displayLabel,
      availability: option.availability,
      admissionState: option.admissionState,
      nativeProcess: option.nativeProcess,
      residentExecutorSupport: option.residentExecutorSupport,
      defaultShell: option.defaultShell,
      capabilityClasses: option.capabilityClasses,
      blockerCodes: option.blockerCodes,
    })),
    instruction:
      "Rank only these harness-observed realization options. Never represent a blocked option as eligible.",
    grantsAuthority: false,
  };
  evidence.digest = digestFor(
    "direct_trusted_realization_evidence@1",
    evidence,
    ["digest"],
  );
  return evidence;
}

function validateProjectGenesisResult(payload) {
  if (
    !isPlainObject(payload) ||
    payload.schema !== PROJECT_GENESIS_RESULT_SCHEMA ||
    !isPlainObject(payload.projectConstitution) ||
    !Array.isArray(payload.realizationRecommendations) ||
    !Array.isArray(payload.openDecisions)
  ) {
    fail("world_manager_project_genesis_typed_result_invalid");
  }
  required(payload.semanticSummary, "projectGenesisResult.semanticSummary");
  required(
    payload.projectConstitution.name,
    "projectGenesisResult.projectConstitution.name",
  );
  required(
    payload.projectConstitution.summary,
    "projectGenesisResult.projectConstitution.summary",
  );
  required(
    payload.projectConstitution.primaryAgentEnvironmentId,
    "projectGenesisResult.projectConstitution.primaryAgentEnvironmentId",
  );
  if (
    !Array.isArray(
      payload.projectConstitution.allowedEnvironmentIds,
    ) ||
    !payload.projectConstitution.allowedEnvironmentIds.length
  ) {
    fail("world_manager_project_genesis_allowed_environments_required");
  }
  return true;
}

function normalizeRecommendation(input = {}, option, index = 0) {
  return {
    rank: Number.isInteger(Number(input.rank)) && Number(input.rank) > 0
      ? Number(input.rank)
      : index + 1,
    environmentId: option.environmentId,
    displayLabel: option.displayLabel,
    availability: option.availability,
    admissionState: option.admissionState,
    rationale: stringList(input.rationale, 8).map((entry) =>
      entry.slice(0, 320)),
    tradeoffs: stringList(input.tradeoffs, 8).map((entry) =>
      entry.slice(0, 320)),
    realizationOptionRef: {
      kind: "realization_option",
      id: option.environmentId,
      digest: option.digest,
    },
  };
}

function buildProjectConstitutionCandidate(input = {}) {
  const payload = input.typedPayload;
  const snapshot = input.realizationSnapshot;
  validateProjectGenesisResult(payload);
  validateRealizationOptionSnapshot(snapshot);
  const project = payload.projectConstitution;
  const primaryEnvironmentId = required(
    project.primaryAgentEnvironmentId,
    "projectConstitution.primaryAgentEnvironmentId",
  );
  const optionById = new Map(
    snapshot.options.map((option) => [option.environmentId, option]),
  );
  const primaryOption = optionById.get(primaryEnvironmentId);
  if (!primaryOption || primaryOption.admissionState !== "eligible") {
    fail(
      "world_manager_project_genesis_primary_environment_ineligible",
      primaryEnvironmentId,
    );
  }
  const allowedEnvironmentIds = stringList(
    project.allowedEnvironmentIds,
    16,
  );
  if (!allowedEnvironmentIds.includes(primaryEnvironmentId)) {
    allowedEnvironmentIds.unshift(primaryEnvironmentId);
  }
  for (const environmentId of allowedEnvironmentIds) {
    if (!optionById.has(environmentId)) {
      fail(
        "world_manager_project_genesis_unknown_allowed_environment",
        environmentId,
      );
    }
  }
  const gitAuthorityEnvironmentId = text(
    project.gitAuthorityEnvironmentId,
    primaryEnvironmentId,
  );
  if (!allowedEnvironmentIds.includes(gitAuthorityEnvironmentId)) {
    fail(
      "world_manager_project_genesis_git_environment_not_allowed",
      gitAuthorityEnvironmentId,
    );
  }
  const recommendations = payload.realizationRecommendations
    .map((recommendation, index) => {
      const environmentId = required(
        recommendation?.environmentId,
        `realizationRecommendations.${index}.environmentId`,
      );
      const option = optionById.get(environmentId);
      if (!option) {
        fail(
          "world_manager_project_genesis_unknown_recommendation",
          environmentId,
        );
      }
      return normalizeRecommendation(recommendation, option, index);
    })
    .sort((left, right) =>
      left.rank - right.rank ||
      left.environmentId.localeCompare(right.environmentId));
  if (!recommendations.some((entry) =>
    entry.environmentId === primaryEnvironmentId)) {
    recommendations.unshift(normalizeRecommendation(
      {
        rank: 1,
        environmentId: primaryEnvironmentId,
        rationale: [
          "The typed project constitution selected this as its primary agent environment.",
        ],
        tradeoffs: [],
      },
      primaryOption,
      0,
    ));
  }
  const sourceAgentResultRef = exactRef(
    input.sourceAgentResultRef,
    "projectConstitutionCandidate.sourceAgentResultRef",
  );
  const sourceSemanticEventRef = exactRef(
    input.sourceSemanticEventRef,
    "projectConstitutionCandidate.sourceSemanticEventRef",
  );
  const createdAt = required(
    input.createdAt,
    "projectConstitutionCandidate.createdAt",
  );
  const proposedProjectId = normalizeProjectId(
    project.proposedProjectId || project.name,
    `${project.name}:${sourceSemanticEventRef.id}`,
  );
  const candidate = {
    schema: PROJECT_CONSTITUTION_CANDIDATE_SCHEMA,
    candidateId: stableId("project_constitution_candidate", {
      sourceSemanticEventId: sourceSemanticEventRef.id,
      sourceAgentResultDigest: sourceAgentResultRef.digest,
      realizationSnapshotDigest: snapshot.digest,
      proposedProjectId,
    }),
    artifactKind: "project_constitution",
    lineageRootId: required(
      input.lineageRootId,
      "projectConstitutionCandidate.lineageRootId",
    ),
    sourceSemanticEventRef,
    sourceAgentResultRef,
    realizationSnapshotRef: realizationSnapshotRef(snapshot),
    proposedProjectId,
    identity: bounded(project.name, proposedProjectId, 180),
    purpose: bounded(project.summary, payload.semanticSummary, 1200),
    semanticSummary: bounded(payload.semanticSummary, project.summary, 1200),
    primaryAgentEnvironmentId: primaryEnvironmentId,
    allowedEnvironmentIds,
    gitAuthorityEnvironmentId,
    rankedRecommendations: recommendations,
    openDecisions: (Array.isArray(payload.openDecisions)
      ? payload.openDecisions
      : []).slice(0, 16),
    evidenceReviewState: "not_reviewed",
    reconciliationState: text(
      input.reconciliationState,
      "reconciled",
    ),
    lifecycle: "candidate",
    activationState: "not_admitted",
    revision: 1,
    createdAt,
    grantsAuthority: false,
    canonical: false,
  };
  candidate.digest = digestFor(
    PROJECT_CONSTITUTION_CANDIDATE_SCHEMA,
    candidate,
    ["digest"],
  );
  validateProjectConstitutionCandidate(candidate);
  return candidate;
}

function validateProjectConstitutionCandidate(candidate) {
  if (
    !isPlainObject(candidate) ||
    candidate.schema !== PROJECT_CONSTITUTION_CANDIDATE_SCHEMA ||
    candidate.artifactKind !== "project_constitution" ||
    !Array.isArray(candidate.allowedEnvironmentIds) ||
    !candidate.allowedEnvironmentIds.includes(
      candidate.primaryAgentEnvironmentId,
    ) ||
    !Array.isArray(candidate.rankedRecommendations) ||
    candidate.grantsAuthority !== false ||
    candidate.canonical !== false
  ) {
    fail("world_manager_project_genesis_candidate_invalid");
  }
  required(candidate.candidateId, "projectConstitutionCandidate.candidateId");
  required(
    candidate.proposedProjectId,
    "projectConstitutionCandidate.proposedProjectId",
  );
  exactRef(
    candidate.sourceSemanticEventRef,
    "projectConstitutionCandidate.sourceSemanticEventRef",
  );
  exactRef(
    candidate.sourceAgentResultRef,
    "projectConstitutionCandidate.sourceAgentResultRef",
  );
  exactRef(
    candidate.realizationSnapshotRef,
    "projectConstitutionCandidate.realizationSnapshotRef",
  );
  if (
    candidate.digest !==
    digestFor(PROJECT_CONSTITUTION_CANDIDATE_SCHEMA, candidate, ["digest"])
  ) {
    fail("world_manager_project_genesis_candidate_digest_mismatch");
  }
  return true;
}

function reviewedProjectConstitutionCandidate(candidate, reviewedAt) {
  validateProjectConstitutionCandidate(candidate);
  if (candidate.lifecycle !== "candidate") {
    fail("world_manager_project_genesis_candidate_not_reviewable");
  }
  const next = {
    ...candidate,
    evidenceReviewState: "reviewed",
    evidenceReviewedAt: required(
      reviewedAt,
      "projectConstitutionCandidate.evidenceReviewedAt",
    ),
  };
  next.digest = digestFor(
    PROJECT_CONSTITUTION_CANDIDATE_SCHEMA,
    next,
    ["digest"],
  );
  validateProjectConstitutionCandidate(next);
  return next;
}

function admitProjectConstitution(input = {}) {
  const candidate = input.candidate;
  const snapshot = input.realizationSnapshot;
  validateProjectConstitutionCandidate(candidate);
  validateRealizationOptionSnapshot(snapshot);
  if (
    candidate.lifecycle !== "candidate" ||
    candidate.evidenceReviewState !== "reviewed" ||
    candidate.reconciliationState !== "reconciled"
  ) {
    fail("world_manager_project_genesis_admission_gate_closed");
  }
  if (
    candidate.realizationSnapshotRef.id !== snapshot.snapshotId ||
    candidate.realizationSnapshotRef.digest !== snapshot.digest
  ) {
    fail("world_manager_project_genesis_realization_snapshot_stale");
  }
  const selected = snapshot.options.find((option) =>
    option.environmentId === candidate.primaryAgentEnvironmentId);
  if (!selected || selected.admissionState !== "eligible") {
    fail(
      "world_manager_project_genesis_primary_environment_ineligible",
      candidate.primaryAgentEnvironmentId,
    );
  }
  const admittedAt = required(
    input.admittedAt,
    "projectConstitutionAdmission.admittedAt",
  );
  const actorId = required(
    input.actorId,
    "projectConstitutionAdmission.actorId",
  );
  const decision = {
    schema: PROJECT_CONSTITUTION_ADMISSION_SCHEMA,
    admissionDecisionId: stableId("project_constitution_admission", {
      candidateDigest: candidate.digest,
      actorId,
    }),
    candidateRef: {
      kind: "project_constitution_candidate",
      id: candidate.candidateId,
      digest: candidate.digest,
    },
    actorId,
    actorRole: "operator",
    decision: "admit",
    admittedAt,
    explicitOperatorAction: true,
    grantsAuthority: false,
  };
  decision.digest = digestFor(
    PROJECT_CONSTITUTION_ADMISSION_SCHEMA,
    decision,
    ["digest"],
  );
  const constitution = {
    schema: PROJECT_CONSTITUTION_SCHEMA,
    projectId: candidate.proposedProjectId,
    identity: candidate.identity,
    purpose: candidate.purpose,
    primaryAgentEnvironmentId:
      candidate.primaryAgentEnvironmentId,
    allowedEnvironmentIds: candidate.allowedEnvironmentIds,
    gitAuthorityEnvironmentId:
      candidate.gitAuthorityEnvironmentId,
    constitutionRevision: 1,
    authorityEpoch: 1,
    activationState: "awaiting_workspace_provisioning",
    admittedFromCandidateRef: decision.candidateRef,
    admissionDecisionRef: {
      kind: "project_constitution_admission",
      id: decision.admissionDecisionId,
      digest: decision.digest,
    },
    realizationSnapshotRef: candidate.realizationSnapshotRef,
    admittedAt,
    canonical: true,
    grantsAuthority: false,
  };
  constitution.digest = digestFor(
    PROJECT_CONSTITUTION_SCHEMA,
    constitution,
    ["digest"],
  );
  const runtimeBinding = {
    schema: PROJECT_RUNTIME_DEFAULT_BINDING_SCHEMA,
    bindingId: stableId("project_runtime_default", {
      projectId: constitution.projectId,
      constitutionDigest: constitution.digest,
    }),
    projectId: constitution.projectId,
    constitutionRef: {
      kind: "project_constitution",
      id: constitution.projectId,
      digest: constitution.digest,
    },
    defaultEnvironmentId:
      constitution.primaryAgentEnvironmentId,
    allowedEnvironmentIds: constitution.allowedEnvironmentIds,
    gitAuthorityEnvironmentId:
      constitution.gitAuthorityEnvironmentId,
    bindingRevision: 1,
    threadInheritanceRule:
      "new_threads_inherit_default_environment_and_existing_thread_bindings_remain_immutable",
    activationState: constitution.activationState,
    canonical: true,
    grantsAuthority: false,
  };
  runtimeBinding.digest = digestFor(
    PROJECT_RUNTIME_DEFAULT_BINDING_SCHEMA,
    runtimeBinding,
    ["digest"],
  );
  return {
    decision,
    constitution,
    runtimeBinding,
  };
}

module.exports = {
  PROJECT_CONSTITUTION_ADMISSION_SCHEMA,
  PROJECT_CONSTITUTION_CANDIDATE_SCHEMA,
  PROJECT_CONSTITUTION_SCHEMA,
  PROJECT_GENESIS_RESULT_SCHEMA,
  PROJECT_RUNTIME_DEFAULT_BINDING_SCHEMA,
  REALIZATION_OPTION_SNAPSHOT_SCHEMA,
  admitProjectConstitution,
  buildProjectConstitutionCandidate,
  buildRealizationOptionSnapshot,
  normalizeProjectId,
  realizationSnapshotRef,
  reviewedProjectConstitutionCandidate,
  trustedRealizationEvidence,
  validateProjectConstitutionCandidate,
  validateProjectGenesisResult,
  validateRealizationOptionSnapshot,
};
