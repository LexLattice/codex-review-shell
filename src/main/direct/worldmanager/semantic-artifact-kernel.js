"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const SEMANTIC_ARTIFACT_HEADER_SCHEMA =
  "direct_semantic_artifact_header@1";
const OPEN_DECISION_SCHEMA = "direct_open_decision@1";
const DECISION_OPTION_SCHEMA = "direct_decision_option@1";
const DECISION_DEPENDENCY_SCHEMA =
  "direct_decision_dependency@1";
const DECISION_CONSEQUENCE_SCHEMA =
  "direct_decision_consequence@1";
const DECISION_RESOLUTION_CONTRACT_SCHEMA =
  "direct_decision_resolution_contract@1";

const SEMANTIC_ARTIFACT_LIFECYCLES = new Set([
  "active",
  "resolved",
  "superseded",
  "stale",
  "conflicted",
]);
const DECISION_STATES = new Set([
  "open",
  "blocked",
  "resolved",
  "superseded",
  "stale",
  "conflicted",
]);
const DECISION_RESOLUTION_MODES = new Set([
  "mechanical",
  "semantic_relay",
  "evidence_request",
  "authority_request",
]);
const DECISION_OPTION_AVAILABILITY = new Set([
  "available",
  "blocked",
  "stale",
  "conflicted",
]);
const DECISION_DEPENDENCY_STATES = new Set([
  "satisfied",
  "unsatisfied",
  "unknown",
  "stale",
  "conflicted",
]);
const DECISION_CONSEQUENCE_POSTURES = new Set([
  "expected",
  "possible",
  "forbidden",
]);
const SEMANTIC_ARTIFACT_EPISTEMIC_POSTURES = new Set([
  "observed",
  "candidate_source",
  "admitted",
  "migrated",
]);

function fail(code, detail = "") {
  const error = new Error(
    detail ? `${code}:${detail}` : code,
  );
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

function bounded(value, fallback = "", max = 1200) {
  return text(value, fallback).slice(0, max);
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function stringList(value, max = 32) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => text(entry, ""))
    .filter(Boolean)
    .slice(0, max);
}

function validateRef(value, label = "ref") {
  if (
    !isPlainObject(value) ||
    !text(value.kind, "") ||
    !text(value.id, "") ||
    !text(value.digest, "")
  ) {
    fail("semantic_artifact_ref_invalid", label);
  }
  return true;
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  const refLabel = text(value.label, "");
  if (refLabel) ref.label = refLabel;
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  validateRef(ref, label);
  return ref;
}

function uniqueRefs(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry, index) =>
      exactRef(entry, `refs.${index}`))
    .filter((ref) => {
      const key = `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeScope(value = {}) {
  const scope = {
    kind: text(
      value.kind,
      text(value.projectId, "") ? "project" : "user_world",
    ),
    userWorldId: text(value.userWorldId, "user_world_local"),
    projectId: text(value.projectId, ""),
    taskType: text(value.taskType, ""),
    workThreadId: text(value.workThreadId, ""),
  };
  if (
    !["user_world", "project", "task", "artifact"].includes(
      scope.kind,
    ) ||
    (scope.kind === "project" && !scope.projectId)
  ) {
    fail("semantic_artifact_scope_invalid");
  }
  return scope;
}

function lifecycleForDecisionState(state) {
  if (["open", "blocked"].includes(state)) return "active";
  return state;
}

function inputShapeForResolutionMode(mode) {
  return {
    mechanical: "exact_option_ref",
    semantic_relay: "scoped_free_form",
    evidence_request: "evidence_request",
    authority_request: "authority_request",
  }[mode];
}

function buildSemanticArtifactHeader(input = {}) {
  const semanticArtifactId = text(
    input.semanticArtifactId || input.artifactId,
    "",
  );
  const artifactKind = text(input.artifactKind, "");
  const revision = Number(input.revision || 1);
  const lifecycle = text(input.lifecycle, "active");
  if (
    !semanticArtifactId ||
    !artifactKind ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    !SEMANTIC_ARTIFACT_LIFECYCLES.has(lifecycle)
  ) {
    fail("semantic_artifact_header_invalid");
  }
  const predecessorRef = input.predecessorRef
    ? exactRef(
        input.predecessorRef,
        "semanticArtifactHeader.predecessorRef",
      )
    : null;
  if ((revision === 1) === Boolean(predecessorRef)) {
    fail("semantic_artifact_revision_lineage_invalid");
  }
  const header = {
    schema: SEMANTIC_ARTIFACT_HEADER_SCHEMA,
    semanticArtifactId,
    artifactKind,
    semanticIdentity: bounded(
      input.semanticIdentity,
      semanticArtifactId,
      240,
    ),
    scope: normalizeScope(input.scope),
    ownerRole: text(input.ownerRole, "world_manager"),
    semanticAuthorRole: text(
      input.semanticAuthorRole,
      input.ownerRole || "world_manager",
    ),
    revision,
    lifecycle,
    predecessorRef,
    supersededByRef: input.supersededByRef
      ? exactRef(
          input.supersededByRef,
          "semanticArtifactHeader.supersededByRef",
        )
      : null,
    epistemicPosture:
      SEMANTIC_ARTIFACT_EPISTEMIC_POSTURES.has(
        input.epistemicPosture,
      )
        ? input.epistemicPosture
        : "observed",
    provenanceRefs: uniqueRefs(input.provenanceRefs),
    authorityPosture: "descriptive_only",
    canonical: true,
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(input.now)),
  };
  header.digest = digestFor(
    SEMANTIC_ARTIFACT_HEADER_SCHEMA,
    header,
    ["digest"],
  );
  validateSemanticArtifactHeader(header);
  return header;
}

function validateSemanticArtifactHeader(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_ARTIFACT_HEADER_SCHEMA ||
    !text(value.semanticArtifactId, "") ||
    !text(value.artifactKind, "") ||
    !text(value.semanticIdentity, "") ||
    !text(value.ownerRole, "") ||
    !text(value.semanticAuthorRole, "") ||
    !Number.isInteger(Number(value.revision)) ||
    Number(value.revision) < 1 ||
    !SEMANTIC_ARTIFACT_LIFECYCLES.has(value.lifecycle) ||
    !SEMANTIC_ARTIFACT_EPISTEMIC_POSTURES.has(
      value.epistemicPosture,
    ) ||
    !Array.isArray(value.provenanceRefs) ||
    value.authorityPosture !== "descriptive_only" ||
    value.canonical !== true ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_artifact_header_invalid");
  }
  normalizeScope(value.scope);
  value.provenanceRefs.forEach((ref, index) =>
    validateRef(
      ref,
      `semanticArtifactHeader.provenanceRefs.${index}`,
    ));
  if (value.predecessorRef) {
    validateRef(
      value.predecessorRef,
      "semanticArtifactHeader.predecessorRef",
    );
  }
  if (value.supersededByRef) {
    validateRef(
      value.supersededByRef,
      "semanticArtifactHeader.supersededByRef",
    );
  }
  if (
    (Number(value.revision) === 1) ===
      Boolean(value.predecessorRef) ||
    value.digest !==
      digestFor(
        SEMANTIC_ARTIFACT_HEADER_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("semantic_artifact_header_digest_mismatch");
  }
  return true;
}

function buildDecisionOption(input = {}, context = {}) {
  const decisionId = text(context.decisionId, "");
  const optionKey = text(
    input.optionKey || input.optionId || input.value,
    `option_${Number(context.index || 0) + 1}`,
  );
  const option = {
    schema: DECISION_OPTION_SCHEMA,
    optionId: text(
      input.optionId,
      stableId("wm_decision_option", {
        decisionId,
        optionKey,
      }),
    ),
    optionKey,
    label: bounded(input.label, optionKey, 180),
    description: bounded(
      input.description || input.summary,
      "",
      800,
    ),
    semanticValue: isPlainObject(input.semanticValue)
      ? input.semanticValue
      : {
          kind: "selection",
          value: input.value ?? optionKey,
        },
    availability:
      DECISION_OPTION_AVAILABILITY.has(input.availability)
        ? input.availability
        : "available",
    effectSummary: bounded(input.effectSummary, "", 800),
    grantsAuthority: false,
  };
  option.digest = digestFor(
    DECISION_OPTION_SCHEMA,
    option,
    ["digest"],
  );
  validateDecisionOption(option);
  return option;
}

function validateDecisionOption(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== DECISION_OPTION_SCHEMA ||
    !text(value.optionId, "") ||
    !text(value.optionKey, "") ||
    !text(value.label, "") ||
    !isPlainObject(value.semanticValue) ||
    !DECISION_OPTION_AVAILABILITY.has(value.availability) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        DECISION_OPTION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("decision_option_invalid");
  }
  return true;
}

function buildDecisionDependency(input = {}, context = {}) {
  const dependencyKind = text(input.dependencyKind, "semantic");
  const requirement = bounded(
    input.requirement || input.summary,
    dependencyKind,
    800,
  );
  const dependency = {
    schema: DECISION_DEPENDENCY_SCHEMA,
    dependencyId: text(
      input.dependencyId,
      stableId("wm_decision_dependency", {
        decisionId: context.decisionId,
        dependencyKind,
        requirement,
        index: Number(context.index || 0),
      }),
    ),
    dependencyKind,
    requirement,
    targetRef: input.targetRef
      ? exactRef(
          input.targetRef,
          "decisionDependency.targetRef",
        )
      : null,
    state: DECISION_DEPENDENCY_STATES.has(input.state)
      ? input.state
      : "unknown",
    blocking: input.blocking !== false,
    grantsAuthority: false,
  };
  dependency.digest = digestFor(
    DECISION_DEPENDENCY_SCHEMA,
    dependency,
    ["digest"],
  );
  validateDecisionDependency(dependency);
  return dependency;
}

function validateDecisionDependency(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== DECISION_DEPENDENCY_SCHEMA ||
    !text(value.dependencyId, "") ||
    !text(value.dependencyKind, "") ||
    !text(value.requirement, "") ||
    !DECISION_DEPENDENCY_STATES.has(value.state) ||
    typeof value.blocking !== "boolean" ||
    value.grantsAuthority !== false
  ) {
    fail("decision_dependency_invalid");
  }
  if (value.targetRef) {
    validateRef(value.targetRef, "decisionDependency.targetRef");
  }
  if (
    value.digest !==
      digestFor(
        DECISION_DEPENDENCY_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("decision_dependency_digest_mismatch");
  }
  return true;
}

function buildDecisionConsequence(input = {}, context = {}) {
  const effectClass = text(input.effectClass, "semantic_state");
  const description = bounded(
    input.description || input.summary,
    effectClass,
    800,
  );
  const consequence = {
    schema: DECISION_CONSEQUENCE_SCHEMA,
    consequenceId: text(
      input.consequenceId,
      stableId("wm_decision_consequence", {
        decisionId: context.decisionId,
        effectClass,
        description,
        index: Number(context.index || 0),
      }),
    ),
    effectClass,
    description,
    targetRef: input.targetRef
      ? exactRef(
          input.targetRef,
          "decisionConsequence.targetRef",
        )
      : null,
    posture:
      DECISION_CONSEQUENCE_POSTURES.has(input.posture)
        ? input.posture
        : "possible",
    grantsAuthority: false,
  };
  consequence.digest = digestFor(
    DECISION_CONSEQUENCE_SCHEMA,
    consequence,
    ["digest"],
  );
  validateDecisionConsequence(consequence);
  return consequence;
}

function validateDecisionConsequence(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== DECISION_CONSEQUENCE_SCHEMA ||
    !text(value.consequenceId, "") ||
    !text(value.effectClass, "") ||
    !text(value.description, "") ||
    !DECISION_CONSEQUENCE_POSTURES.has(value.posture) ||
    value.grantsAuthority !== false
  ) {
    fail("decision_consequence_invalid");
  }
  if (value.targetRef) {
    validateRef(value.targetRef, "decisionConsequence.targetRef");
  }
  if (
    value.digest !==
      digestFor(
        DECISION_CONSEQUENCE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("decision_consequence_digest_mismatch");
  }
  return true;
}

function buildDecisionResolutionContract(
  input = {},
  context = {},
) {
  const mode = text(
    input.mode || context.resolutionMode,
    "semantic_relay",
  );
  if (!DECISION_RESOLUTION_MODES.has(mode)) {
    fail("decision_resolution_mode_invalid", mode);
  }
  const options = Array.isArray(context.options)
    ? context.options
    : [];
  if (mode === "mechanical" && !options.length) {
    fail("decision_mechanical_options_required");
  }
  const contract = {
    schema: DECISION_RESOLUTION_CONTRACT_SCHEMA,
    resolutionContractId: text(
      input.resolutionContractId,
      stableId("wm_decision_resolution_contract", {
        decisionId: context.decisionId,
        revision: context.revision,
        mode,
      }),
    ),
    decisionId: text(context.decisionId, ""),
    decisionRevision: Number(context.revision || 1),
    mode,
    inputShape: inputShapeForResolutionMode(mode),
    allowedOptionRefs:
      mode === "mechanical" || mode === "authority_request"
        ? options.map((option) => ({
            kind: "decision_option",
            id: option.optionId,
            digest: option.digest,
          }))
        : [],
    requiredDependencyRefs:
      (Array.isArray(context.dependencies)
        ? context.dependencies
        : []).filter((dependency) =>
          dependency.blocking).map((dependency) => ({
            kind: "decision_dependency",
            id: dependency.dependencyId,
            digest: dependency.digest,
          })),
    requiredActorRoles: stringList(
      input.requiredActorRoles,
      16,
    ),
    exactTargetRefRequired:
      input.exactTargetRefRequired === true,
    expectedRevisionRequired: true,
    idempotencyRequired: true,
    transitionAvailability: text(
      input.transitionAvailability,
      "available_wm_sc5",
    ),
    executionAuthorityGranted: false,
    grantsAuthority: false,
  };
  contract.digest = digestFor(
    DECISION_RESOLUTION_CONTRACT_SCHEMA,
    contract,
    ["digest"],
  );
  validateDecisionResolutionContract(contract);
  return contract;
}

function validateDecisionResolutionContract(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_RESOLUTION_CONTRACT_SCHEMA ||
    !text(value.resolutionContractId, "") ||
    !text(value.decisionId, "") ||
    !Number.isInteger(Number(value.decisionRevision)) ||
    Number(value.decisionRevision) < 1 ||
    !DECISION_RESOLUTION_MODES.has(value.mode) ||
    value.inputShape !==
      inputShapeForResolutionMode(value.mode) ||
    !Array.isArray(value.allowedOptionRefs) ||
    !Array.isArray(value.requiredDependencyRefs) ||
    !Array.isArray(value.requiredActorRoles) ||
    value.expectedRevisionRequired !== true ||
    value.idempotencyRequired !== true ||
    value.executionAuthorityGranted !== false ||
    value.grantsAuthority !== false ||
    (value.mode === "mechanical" &&
      !value.allowedOptionRefs.length)
  ) {
    fail("decision_resolution_contract_invalid");
  }
  value.allowedOptionRefs.forEach((ref, index) =>
    validateRef(
      ref,
      `decisionResolutionContract.allowedOptionRefs.${index}`,
    ));
  value.requiredDependencyRefs.forEach((ref, index) =>
    validateRef(
      ref,
      `decisionResolutionContract.requiredDependencyRefs.${index}`,
    ));
  if (
    value.digest !==
      digestFor(
        DECISION_RESOLUTION_CONTRACT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("decision_resolution_contract_digest_mismatch");
  }
  return true;
}

function buildOpenDecision(input = {}) {
  const sourceKind = text(input.sourceKind, "semantic_role");
  const sourceKey = text(
    input.sourceKey,
    text(input.decisionId, ""),
  );
  const scope = normalizeScope(input.scope);
  const decisionId = text(
    input.decisionId,
    stableId("wm_open_decision", {
      sourceKind,
      sourceKey,
      scope,
    }),
  );
  const decisionState =
    DECISION_STATES.has(input.decisionState)
      ? input.decisionState
      : "open";
  const revision = Number(input.revision || 1);
  const resolutionMode =
    DECISION_RESOLUTION_MODES.has(input.resolutionMode)
      ? input.resolutionMode
      : "semantic_relay";
  const options = (Array.isArray(input.options)
    ? input.options
    : []).slice(0, 32).map((option, index) =>
      option?.schema === DECISION_OPTION_SCHEMA
        ? option
        : buildDecisionOption(option, {
            decisionId,
            index,
          }));
  const dependencies = (Array.isArray(input.dependencies)
    ? input.dependencies
    : []).slice(0, 32).map((dependency, index) =>
      dependency?.schema === DECISION_DEPENDENCY_SCHEMA
        ? dependency
        : buildDecisionDependency(dependency, {
            decisionId,
            index,
          }));
  const consequences = (Array.isArray(input.consequences)
    ? input.consequences
    : []).slice(0, 32).map((consequence, index) =>
      consequence?.schema === DECISION_CONSEQUENCE_SCHEMA
        ? consequence
        : buildDecisionConsequence(consequence, {
            decisionId,
            index,
          }));
  options.forEach(validateDecisionOption);
  dependencies.forEach(validateDecisionDependency);
  consequences.forEach(validateDecisionConsequence);
  const header = buildSemanticArtifactHeader({
    semanticArtifactId: decisionId,
    artifactKind: "open_decision",
    semanticIdentity: bounded(
      input.semanticIdentity || input.question,
      decisionId,
      240,
    ),
    scope,
    ownerRole: input.ownerRole,
    semanticAuthorRole: input.semanticAuthorRole,
    revision,
    lifecycle:
      input.lifecycle ||
      lifecycleForDecisionState(decisionState),
    predecessorRef: input.predecessorRef,
    supersededByRef: input.supersededByRef,
    epistemicPosture: input.epistemicPosture,
    provenanceRefs: input.provenanceRefs,
    createdAt: input.createdAt,
    now: input.now,
  });
  const resolutionContract =
    input.resolutionContract?.schema ===
      DECISION_RESOLUTION_CONTRACT_SCHEMA
      ? input.resolutionContract
      : buildDecisionResolutionContract(
          input.resolutionContract || {},
          {
            decisionId,
            revision,
            resolutionMode,
            options,
            dependencies,
          },
        );
  const decision = {
    schema: OPEN_DECISION_SCHEMA,
    header,
    decisionId,
    decisionKind: text(
      input.decisionKind,
      "semantic_open_decision",
    ),
    question: bounded(
      input.question || input.summary,
      "Open decision",
      1200,
    ),
    description: bounded(input.description, "", 2400),
    resolutionMode,
    options,
    dependencies,
    consequences,
    resolutionContract,
    decisionState,
    resolutionRef: input.resolutionRef
      ? exactRef(
          input.resolutionRef,
          "openDecision.resolutionRef",
        )
      : null,
    sourceKind,
    sourceKey,
    sourceStateDigest: text(
      input.sourceStateDigest,
      digestFor("direct_open_decision_source_state@1", {
        sourceKind,
        sourceKey,
        question: input.question || input.summary,
        resolutionMode,
        options,
        dependencies,
        consequences,
        decisionState,
        resolutionRef: input.resolutionRef || null,
        provenanceRefs: input.provenanceRefs || [],
      }),
    ),
    canonical: true,
    grantsAuthority: false,
  };
  decision.digest = digestFor(
    OPEN_DECISION_SCHEMA,
    decision,
    ["digest"],
  );
  validateOpenDecision(decision);
  return decision;
}

function validateOpenDecision(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== OPEN_DECISION_SCHEMA ||
    !text(value.decisionId, "") ||
    !text(value.decisionKind, "") ||
    !text(value.question, "") ||
    !DECISION_RESOLUTION_MODES.has(value.resolutionMode) ||
    !Array.isArray(value.options) ||
    !Array.isArray(value.dependencies) ||
    !Array.isArray(value.consequences) ||
    !DECISION_STATES.has(value.decisionState) ||
    !text(value.sourceKind, "") ||
    !text(value.sourceKey, "") ||
    !text(value.sourceStateDigest, "") ||
    value.canonical !== true ||
    value.grantsAuthority !== false
  ) {
    fail("open_decision_invalid");
  }
  validateSemanticArtifactHeader(value.header);
  if (
    value.header.semanticArtifactId !== value.decisionId ||
    value.header.artifactKind !== "open_decision" ||
    value.header.lifecycle !==
      lifecycleForDecisionState(value.decisionState)
  ) {
    fail("open_decision_header_mismatch");
  }
  value.options.forEach(validateDecisionOption);
  value.dependencies.forEach(validateDecisionDependency);
  value.consequences.forEach(validateDecisionConsequence);
  validateDecisionResolutionContract(
    value.resolutionContract,
  );
  if (
    value.resolutionContract.decisionId !== value.decisionId ||
    value.resolutionContract.decisionRevision !==
      value.header.revision ||
    value.resolutionContract.mode !== value.resolutionMode ||
    (value.decisionState === "resolved" &&
      !value.resolutionRef) ||
    (value.decisionState !== "resolved" &&
      value.resolutionRef)
  ) {
    fail("open_decision_resolution_state_invalid");
  }
  if (value.resolutionRef) {
    validateRef(value.resolutionRef, "openDecision.resolutionRef");
  }
  if (
    value.digest !==
      digestFor(
        OPEN_DECISION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("open_decision_digest_mismatch");
  }
  return true;
}

function semanticArtifactRef(artifact) {
  validateOpenDecision(artifact);
  return {
    kind: "open_decision",
    id: artifact.decisionId,
    digest: artifact.digest,
    projectId: artifact.header.scope.projectId,
  };
}

function reviseOpenDecision(current, changes = {}) {
  validateOpenDecision(current);
  const nextState = DECISION_STATES.has(changes.decisionState)
    ? changes.decisionState
    : current.decisionState;
  const resolutionRef =
    nextState === "resolved"
      ? changes.resolutionRef || current.resolutionRef
      : null;
  return buildOpenDecision({
    decisionId: current.decisionId,
    decisionKind:
      changes.decisionKind || current.decisionKind,
    question: changes.question || current.question,
    description:
      changes.description ?? current.description,
    resolutionMode:
      changes.resolutionMode || current.resolutionMode,
    options: changes.options || current.options,
    dependencies:
      changes.dependencies || current.dependencies,
    consequences:
      changes.consequences || current.consequences,
    resolutionContract:
      changes.resolutionContract,
    decisionState: nextState,
    resolutionRef,
    sourceKind:
      changes.sourceKind || current.sourceKind,
    sourceKey: changes.sourceKey || current.sourceKey,
    sourceStateDigest:
      changes.sourceStateDigest ||
      current.sourceStateDigest,
    semanticIdentity:
      changes.semanticIdentity ||
      current.header.semanticIdentity,
    scope: changes.scope || current.header.scope,
    ownerRole:
      changes.ownerRole || current.header.ownerRole,
    semanticAuthorRole:
      changes.semanticAuthorRole ||
      current.header.semanticAuthorRole,
    revision: current.header.revision + 1,
    predecessorRef: semanticArtifactRef(current),
    supersededByRef: changes.supersededByRef,
    epistemicPosture:
      changes.epistemicPosture ||
      current.header.epistemicPosture,
    provenanceRefs:
      changes.provenanceRefs ||
      current.header.provenanceRefs,
    createdAt: changes.createdAt,
    now: changes.now,
  });
}

function validateOpenDecisionRevision(previous, next) {
  validateOpenDecision(previous);
  validateOpenDecision(next);
  const predecessor = next.header.predecessorRef;
  if (
    previous.decisionId !== next.decisionId ||
    next.header.revision !==
      previous.header.revision + 1 ||
    predecessor?.kind !== "open_decision" ||
    predecessor?.id !== previous.decisionId ||
    predecessor?.digest !== previous.digest
  ) {
    fail("open_decision_revision_lineage_invalid");
  }
  return true;
}

function rendererSafeDecisionText(value, fallback) {
  if (typeof value === "string") {
    return bounded(value, fallback, 1200);
  }
  if (!isPlainObject(value)) return fallback;
  const direct = bounded(
    value.question ||
      value.summary ||
      value.text ||
      value.description,
    "",
    1200,
  );
  if (direct) return direct;
  try {
    return bounded(JSON.stringify(value), fallback, 1200);
  } catch {
    return fallback;
  }
}

function openDecisionInputFromProjectCandidate(
  candidate = {},
  entry,
  index = 0,
) {
  const projectId = text(candidate.proposedProjectId, "");
  const candidateId = text(candidate.candidateId, "");
  const rich = isPlainObject(entry) ? entry : {};
  const question = rendererSafeDecisionText(
    entry,
    "Open project decision",
  );
  const resolutionMode =
    DECISION_RESOLUTION_MODES.has(rich.resolutionMode)
      ? rich.resolutionMode
      : "semantic_relay";
  const provenanceRef = exactRef({
    kind: "project_constitution_candidate",
    id: candidateId,
    digest: candidate.digest,
    projectId,
  });
  const sourceKey = text(
    rich.decisionId,
    `${candidateId}:open_decision:${index}`,
  );
  const sourceStateDigest = digestFor(
    "direct_project_candidate_open_decision_source@1",
    {
      sourceKey,
      entry,
      provenanceRef,
      candidateLifecycle: candidate.lifecycle,
    },
  );
  return {
    decisionId: stableId("wm_open_decision", {
      sourceKind: "manager_open_decision",
      sourceKey,
      projectId,
    }),
    decisionKind: text(
      rich.decisionKind,
      "project_constitution_open_decision",
    ),
    question,
    description: bounded(rich.description, "", 2400),
    resolutionMode,
    options: Array.isArray(rich.options)
      ? rich.options
      : [],
    dependencies: Array.isArray(rich.dependencies)
      ? rich.dependencies
      : [],
    consequences: Array.isArray(rich.consequences)
      ? rich.consequences
      : [],
    resolutionContract: isPlainObject(
      rich.resolutionContract,
    )
      ? rich.resolutionContract
      : {},
    decisionState:
      DECISION_STATES.has(rich.decisionState)
        ? rich.decisionState
        : "open",
    sourceKind: "manager_open_decision",
    sourceKey,
    sourceStateDigest,
    semanticIdentity: question,
    scope: {
      kind: "project",
      userWorldId: text(
        candidate.userWorldId,
        "user_world_local",
      ),
      projectId,
      taskType: "project_initialization",
    },
    ownerRole: "world_manager",
    semanticAuthorRole: text(
      rich.semanticAuthorRole,
      "project_manager",
    ),
    epistemicPosture: "candidate_source",
    provenanceRefs: [provenanceRef],
    createdAt: candidate.createdAt,
  };
}

function openDecisionInputFromLegacyDecision(
  decision = {},
) {
  const decisionRequestId = text(
    decision.decisionRequestId,
    "",
  );
  const projectId = text(
    decision.targetArtifactRef?.projectId ||
      decision.projectId,
    "",
  );
  const admission = [
    "project_constitution_admission",
    "plan_proposal_admission",
  ].includes(decision.decisionKind);
  const planAdmission =
    decision.decisionKind === "plan_proposal_admission";
  const resolved = ["resolved", "admitted"].includes(
    decision.state,
  );
  const staleClarification =
    decision.decisionKind === "clarification" &&
    ["pending", "clarification_required"].includes(
      decision.state,
    ) &&
    decision.isCurrentClarification === false;
  const decisionState = resolved
    ? "resolved"
    : decision.state === "superseded"
      ? "superseded"
    : staleClarification
      ? "stale"
    : ["pending", "clarification_required"].includes(
        decision.state,
      )
      ? "open"
      : "conflicted";
  const resolutionMode = admission
    ? "authority_request"
    : "semantic_relay";
  const provenanceRefs = [];
  if (decision.sourceEventRef) {
    provenanceRefs.push(
      exactRef(
        decision.sourceEventRef,
        "legacyDecision.sourceEventRef",
      ),
    );
  }
  if (
    decision.targetArtifactRef?.kind &&
    decision.targetArtifactRef?.id &&
    decision.targetArtifactRef?.digest
  ) {
    provenanceRefs.push(
      exactRef(
        decision.targetArtifactRef,
        "legacyDecision.targetArtifactRef",
      ),
    );
  }
  const sourceStateDigest = digestFor(
    "direct_legacy_wm_decision_source@1",
    {
      decisionRequestId,
      decisionKind: decision.decisionKind,
      state: decision.state,
      targetArtifactRef: decision.targetArtifactRef,
      authorityRequirements:
        decision.authorityRequirements,
      decisionRef: decision.decisionRef,
      question: decision.question,
      isCurrentClarification:
        decision.isCurrentClarification,
    },
  );
  const resolutionRef = resolved
    ? (
        decision.decisionRef?.kind &&
        decision.decisionRef?.id &&
        decision.decisionRef?.digest
          ? exactRef(decision.decisionRef)
          : {
              kind: "legacy_decision_resolution",
              id: `${decisionRequestId}:${decision.state}`,
              digest: sourceStateDigest,
            }
      )
    : null;
  const targetLabel = text(
    decision.targetArtifactRef?.label ||
      decision.targetArtifactRef?.id,
    planAdmission ? "plan proposal" : "project constitution",
  );
  const question = bounded(
    decision.question,
    admission
      ? planAdmission
        ? `Admit ${targetLabel} as the canonical project plan?`
        : `Admit ${targetLabel} as the project constitution?`
      : "Clarify the current WorldManager settlement.",
    1200,
  );
  const dependencies = admission
    ? [
        {
          dependencyKind: "evidence_review",
          requirement:
            planAdmission
              ? "Review the exact plan-proposal revision evidence."
              : "Review the exact project-constitution candidate evidence.",
          targetRef:
            decision.targetArtifactRef?.digest
              ? decision.targetArtifactRef
              : null,
          state: "unknown",
          blocking: true,
        },
        {
          dependencyKind: "reconciliation",
          requirement:
            "The WorldManager reconciliation must remain satisfied.",
          targetRef:
            decision.targetArtifactRef?.digest
              ? decision.targetArtifactRef
              : null,
          state: "unknown",
          blocking: true,
        },
      ]
    : [];
  return {
    decisionId: stableId("wm_open_decision", {
      sourceKind: "legacy_wm_decision",
      sourceKey: decisionRequestId,
    }),
    decisionKind: text(
      decision.decisionKind,
      "legacy_world_manager_decision",
    ),
    question,
    description: admission
      ? "This typed semantic object mirrors the existing operational admission gate. It does not replace or invoke that gate."
      : "This typed semantic object mirrors an existing WorldManager clarification boundary.",
    resolutionMode,
    options: admission
      ? [{
          optionKey: planAdmission
            ? "admit_exact_plan_revision"
            : "admit_exact_candidate",
          label: planAdmission
            ? "Admit plan"
            : "Admit constitution",
          description:
            "Admit the exact reviewed and reconciled candidate.",
          effectSummary:
            planAdmission
              ? "Canonicalize the exact plan revision and compile its implementation contract; worker start remains separate."
              : "Canonicalize the project constitution and immutable runtime default; workspace provisioning remains separate.",
          semanticValue: {
            kind:
              planAdmission
                ? "plan_proposal_admission"
                : "project_constitution_admission",
            targetArtifactRef:
              decision.targetArtifactRef || {},
          },
        }]
      : [],
    dependencies,
    consequences: admission
      ? [{
          effectClass:
            "canonical_project_constitution",
          description:
            "The selected candidate becomes the canonical project constitution.",
          targetRef:
            decision.targetArtifactRef?.digest
              ? decision.targetArtifactRef
              : null,
          posture: "possible",
        }]
      : [],
    resolutionContract: {
      requiredActorRoles: admission
        ? stringList([
            decision.authorityRequirements
              ?.requiredActorRole,
          ])
        : ["operator"],
      exactTargetRefRequired:
        admission ||
        decision.authorityRequirements
          ?.exactTargetRefRequired === true,
    },
    decisionState,
    resolutionRef,
    sourceKind: "legacy_wm_decision",
    sourceKey: decisionRequestId,
    sourceStateDigest,
    semanticIdentity: question,
    scope: {
      kind: projectId ? "project" : "user_world",
      userWorldId: text(
        decision.userWorldId,
        "user_world_local",
      ),
      projectId,
      taskType: admission
        ? "project_initialization"
        : "semantic_settlement",
    },
    ownerRole: "world_manager",
    semanticAuthorRole: "world_manager",
    epistemicPosture: "migrated",
    provenanceRefs,
    createdAt: decision.createdAt,
  };
}

module.exports = {
  DECISION_CONSEQUENCE_SCHEMA,
  DECISION_DEPENDENCY_SCHEMA,
  DECISION_OPTION_SCHEMA,
  DECISION_RESOLUTION_CONTRACT_SCHEMA,
  DECISION_RESOLUTION_MODES,
  DECISION_STATES,
  OPEN_DECISION_SCHEMA,
  SEMANTIC_ARTIFACT_HEADER_SCHEMA,
  SEMANTIC_ARTIFACT_LIFECYCLES,
  buildDecisionConsequence,
  buildDecisionDependency,
  buildDecisionOption,
  buildDecisionResolutionContract,
  buildOpenDecision,
  buildSemanticArtifactHeader,
  openDecisionInputFromLegacyDecision,
  openDecisionInputFromProjectCandidate,
  reviseOpenDecision,
  semanticArtifactRef,
  validateDecisionConsequence,
  validateDecisionDependency,
  validateDecisionOption,
  validateDecisionResolutionContract,
  validateOpenDecision,
  validateOpenDecisionRevision,
  validateSemanticArtifactHeader,
};
