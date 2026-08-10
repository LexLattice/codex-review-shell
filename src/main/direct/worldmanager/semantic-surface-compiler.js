"use strict";

const crypto = require("node:crypto");

const SEMANTIC_SURFACE_PROJECTION_SCHEMA =
  "direct_semantic_surface_projection@1";
const SEMANTIC_OBJECT_SURFACE_SCHEMA =
  "direct_semantic_object_surface@1";
const SEMANTIC_LENS_PROJECTION_SCHEMA =
  "direct_semantic_lens_projection@1";
const SEMANTIC_PROJECTION_WITNESS_SCHEMA =
  "direct_semantic_projection_witness@1";
const SEMANTIC_REGION_BINDING_SCHEMA =
  "direct_semantic_region_binding@1";
const MORPH_RESOLVER_REGISTRY_SCHEMA =
  "direct_morph_resolver_registry@1";
const MORPH_RESOLVER_REVISION =
  "world_manager_sc7_morph_resolver@1";
const SEMANTIC_SURFACE_COMPILER_REVISION =
  "world_manager_sc7_semantic_surface_compiler@1";

const ODEU_LENSES = Object.freeze([
  "O",
  "E",
  "D",
  "U",
]);
const MORPH_FAMILIES = new Set([
  "binary",
  "choice_card",
  "comparison",
  "tree",
  "graph",
  "scoped_composer",
  "status_card",
]);
const SURFACE_STATES = new Set([
  "provisional",
  "ready",
  "blocked",
  "conflicted",
  "stale",
  "submitting",
  "resolved",
  "canonical",
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
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : fallback;
}

function bounded(value, fallback = "", max = 1_200) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source
        .slice(0, Math.max(0, max - 1))
        .trimEnd()}…`
    : source;
}

function stableValue(
  value,
  omitted = new Set(),
) {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stableValue(entry, omitted));
  }
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (
        omitted.has(key) ||
        typeof value[key] === "undefined"
      ) {
        return output;
      }
      output[key] = stableValue(
        value[key],
        omitted,
      );
      return output;
    }, {});
}

function digestFor(
  domain,
  value,
  omittedFields = [],
) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      `${domain}\0${JSON.stringify(
        stableValue(
          value,
          new Set(omittedFields),
        ),
      )}`,
    )
    .digest("hex")}`;
}

function stableId(prefix, value) {
  return `${prefix}_${digestFor(
    `${prefix}@1`,
    value,
  ).slice(7, 31)}`;
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(
      value.id ||
        value.semanticArtifactId ||
        value.candidateId ||
        value.projectId,
      "",
    ),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail(
      "semantic_surface_exact_ref_invalid",
      label,
    );
  }
  const refLabel = text(value.label, "");
  if (refLabel) ref.label = bounded(refLabel, "", 240);
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  return ref;
}

function uniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => text(value, ""))
      .filter(Boolean),
  )].sort((left, right) =>
    left.localeCompare(right));
}

function uniqueRefs(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value, index) =>
      exactRef(value, `refs.${index}`))
    .filter((ref) => {
      const key =
        `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function refFor(kind, value, idField) {
  return exactRef({
    kind,
    id: value?.[idField],
    digest: value?.digest,
  });
}

function morphResolverRegistry() {
  const entries = [
    {
      resolverId: "open_decision.mechanical.binary",
      objectClass: "open_decision",
      statePosture: "actionable",
      resolutionMode: "mechanical",
      optionCardinality: "two",
      morphFamily: "binary",
      actionPosture: "safe_buffered_commit",
    },
    {
      resolverId: "open_decision.mechanical.choice",
      objectClass: "open_decision",
      statePosture: "actionable",
      resolutionMode: "mechanical",
      optionCardinality: "many",
      morphFamily: "choice_card",
      actionPosture: "safe_buffered_commit",
    },
    {
      resolverId:
        "open_decision.semantic_relay.composer",
      objectClass: "open_decision",
      statePosture: "actionable",
      resolutionMode: "semantic_relay",
      optionCardinality: "any",
      morphFamily: "scoped_composer",
      actionPosture: "advisory_request",
    },
    {
      resolverId:
        "open_decision.evidence_request.composer",
      objectClass: "open_decision",
      statePosture: "actionable",
      resolutionMode: "evidence_request",
      optionCardinality: "any",
      morphFamily: "scoped_composer",
      actionPosture: "evidence_request",
    },
    {
      resolverId:
        "open_decision.authority_request.composer",
      objectClass: "open_decision",
      statePosture: "actionable",
      resolutionMode: "authority_request",
      optionCardinality: "any",
      morphFamily: "scoped_composer",
      actionPosture: "authority_request",
    },
    {
      resolverId: "open_decision.read_only.status",
      objectClass: "open_decision",
      statePosture: "non_actionable",
      resolutionMode: "*",
      optionCardinality: "any",
      morphFamily: "status_card",
      actionPosture: "read_only",
    },
    {
      resolverId:
        "project_constitution_candidate.comparison",
      objectClass:
        "project_constitution_candidate",
      statePosture: "provisional",
      resolutionMode: "operator_admission",
      optionCardinality: "many",
      morphFamily: "comparison",
      actionPosture: "safe_buffered_commit",
    },
    {
      resolverId:
        "project_constitution.status",
      objectClass: "project_constitution",
      statePosture: "canonical",
      resolutionMode: "none",
      optionCardinality: "none",
      morphFamily: "status_card",
      actionPosture: "read_only",
    },
    {
      resolverId:
        "decision_transition_receipt.status",
      objectClass:
        "decision_transition_receipt",
      statePosture: "historical",
      resolutionMode: "none",
      optionCardinality: "none",
      morphFamily: "status_card",
      actionPosture: "read_only",
    },
    {
      resolverId:
        "aro_reconstruction_candidate.comparison",
      objectClass:
        "aro_reconstruction_candidate",
      statePosture: "provisional",
      resolutionMode:
        "operator_review_and_admission",
      optionCardinality: "many",
      morphFamily: "comparison",
      actionPosture:
        "safe_buffered_commit",
    },
    {
      resolverId:
        "abstract_reasoning_object.tree",
      objectClass:
        "abstract_reasoning_object",
      statePosture: "canonical",
      resolutionMode: "none",
      optionCardinality: "none",
      morphFamily: "tree",
      actionPosture: "read_only",
    },
    {
      resolverId:
        "aro_coverage_witness.graph",
      objectClass:
        "aro_coverage_witness",
      statePosture: "descriptive",
      resolutionMode: "none",
      optionCardinality: "none",
      morphFamily: "graph",
      actionPosture: "read_only",
    },
    {
      resolverId:
        "aro_current_target_comparison.comparison",
      objectClass:
        "aro_current_target_comparison",
      statePosture: "descriptive",
      resolutionMode: "none",
      optionCardinality: "many",
      morphFamily: "comparison",
      actionPosture: "read_only",
    },
  ];
  const registry = {
    schema: MORPH_RESOLVER_REGISTRY_SCHEMA,
    registryId: "world_manager_sc7_morph_resolvers",
    registryRevision:
      MORPH_RESOLVER_REVISION,
    entries,
    uiMintsAuthority: false,
    grantsAuthority: false,
  };
  registry.digest = digestFor(
    MORPH_RESOLVER_REGISTRY_SCHEMA,
    registry,
    ["digest"],
  );
  validateMorphResolverRegistry(registry);
  return registry;
}

function validateMorphResolverRegistry(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      MORPH_RESOLVER_REGISTRY_SCHEMA ||
    !text(value.registryId, "") ||
    !text(value.registryRevision, "") ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.some((entry) =>
      !text(entry.resolverId, "") ||
      !text(entry.objectClass, "") ||
      !MORPH_FAMILIES.has(
        entry.morphFamily,
      )) ||
    value.uiMintsAuthority !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        MORPH_RESOLVER_REGISTRY_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_surface_morph_registry_invalid",
    );
  }
  return true;
}

function decisionSurfaceState(decision = {}) {
  if (decision.state === "resolved") {
    return "resolved";
  }
  if (decision.state === "stale") return "stale";
  if (decision.state === "conflicted") {
    return "conflicted";
  }
  if (
    decision.state === "blocked" ||
    (decision.dependencies || []).some(
      (dependency) =>
        dependency.blocking &&
        dependency.state !== "satisfied",
    )
  ) {
    return "blocked";
  }
  if (
    decision.latestTransition?.state ===
      "accepted" ||
    decision.latestTransition?.state ===
      "pending"
  ) {
    return "submitting";
  }
  return "ready";
}

function decisionDefaultLens(decision = {}) {
  return {
    evidence_request: "E",
    authority_request: "D",
    mechanical: "U",
    semantic_relay: "U",
  }[decision.resolutionMode] || "O";
}

function decisionMorph(
  decision,
  registry,
) {
  const state = decisionSurfaceState(decision);
  const actionable = [
    "ready",
    "blocked",
    "conflicted",
    "submitting",
  ].includes(state);
  let resolverId =
    "open_decision.read_only.status";
  if (actionable) {
    if (decision.resolutionMode === "mechanical") {
      resolverId =
        (decision.options || []).length === 2
          ? "open_decision.mechanical.binary"
          : "open_decision.mechanical.choice";
    } else {
      resolverId =
        `open_decision.${decision.resolutionMode}.composer`;
    }
  }
  const resolver = registry.entries.find(
    (entry) => entry.resolverId === resolverId,
  );
  if (!resolver) {
    fail(
      "semantic_surface_morph_resolver_missing",
      resolverId,
    );
  }
  return {
    resolverRef: {
      kind: "morph_resolver",
      id: resolver.resolverId,
      digest: digestFor(
        "direct_morph_resolver_entry@1",
        resolver,
      ),
    },
    family: resolver.morphFamily,
    actionPosture: resolver.actionPosture,
    density: "compact_with_semantic_zoom",
    navigationMode:
      "bounded_landscape_focus",
  };
}

function decisionInteraction(decision = {}) {
  const state = decisionSurfaceState(decision);
  const actionable = [
    "ready",
    "blocked",
    "conflicted",
    "submitting",
  ].includes(state);
  const blockedDependencies =
    (decision.dependencies || []).filter(
      (dependency) =>
        dependency.blocking &&
        dependency.state !== "satisfied",
    );
  const transitionKind = {
    mechanical: "resolve_option",
    semantic_relay: "semantic_relay",
    evidence_request: "request_evidence",
    authority_request: "request_authority",
  }[decision.resolutionMode] || "";
  const composer = {
    semantic_relay: {
      label:
        "Revision or guidance for the WorldManager",
      placeholder:
        "Describe how this decision should be revised or settled…",
      submitLabel: "Relay to WorldManager",
      boundary:
        "The exact text re-enters WorldManager semantic ingress. The decision remains open.",
    },
    evidence_request: {
      label: "Evidence request",
      placeholder:
        "What evidence is needed before this can be decided?",
      submitLabel: "Request evidence",
      boundary:
        "This opens an evidence path; it does not resolve the decision.",
    },
    authority_request: {
      label: "Authority request",
      placeholder:
        "Describe the exact authority or exception being requested…",
      submitLabel: "Request authority",
      boundary:
        "This requests authority; it does not grant it.",
    },
  }[decision.resolutionMode] || null;
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        subjectRef: decision.artifactRef,
        revision: decision.revision,
        resolutionContractId:
          decision.resolutionContract
            ?.resolutionContractId,
      },
    ),
    actionCluster:
      decision.resolutionMode === "mechanical"
        ? "safe_buffered_commit"
        : "advisory_request",
    transitionKind,
    resolutionMode:
      decision.resolutionMode,
    inputShape:
      decision.resolutionContract?.inputShape ||
      "scoped_free_form",
    options: (decision.options || []).map(
      (option) => ({
        optionId: option.optionId,
        optionRef: exactRef(
          option.optionRef,
          "decision.optionRef",
        ),
        label: bounded(
          option.label,
          option.optionId,
          240,
        ),
        description: bounded(
          option.description,
          "",
          800,
        ),
        effectSummary: bounded(
          option.effectSummary,
          "",
          800,
        ),
        availability:
          text(
            option.availability,
            "blocked",
          ),
        grantsAuthority: false,
      }),
    ),
    dependencies:
      (decision.dependencies || []).map(
        (dependency) => ({
          dependencyId:
            dependency.dependencyId,
          dependencyKind:
            dependency.dependencyKind,
          requirement: bounded(
            dependency.requirement,
            "",
            800,
          ),
          state: dependency.state,
          blocking:
            dependency.blocking === true,
          grantsAuthority: false,
        }),
      ),
    blockedDependencyCount:
      blockedDependencies.length,
    composer,
    latestTransition:
      decision.latestTransition || null,
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: true,
    canonicalMutationPossible:
      actionable &&
      decision.resolutionMode ===
        "mechanical",
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: actionable,
    grantsAuthority: false,
  };
}

const DECISION_RELATIONS = Object.freeze({
  O: [
    "belongs_to_project",
    "has_state",
    "depends_on",
    "anticipates_consequence",
  ],
  E: [
    "has_epistemic_posture",
    "supported_by_provenance",
    "bound_to_semantic_shelf",
    "depends_on_evidence",
  ],
  D: [
    "governed_by_resolution_contract",
    "requires_actor_role",
    "gated_by_dependency",
    "permits_transition",
  ],
  U: [
    "offers_option",
    "anticipates_effect",
    "expresses_tradeoff",
    "changes_trajectory",
  ],
});

const GENESIS_RELATIONS = Object.freeze({
  O: [
    "proposes_project_identity",
    "binds_runtime_environment",
    "permits_environment",
    "assigns_git_authority_environment",
  ],
  E: [
    "grounded_in_realization_snapshot",
    "has_evidence_review_state",
    "has_reconciliation_state",
  ],
  D: [
    "requires_operator_admission",
    "requires_evidence_review",
    "requires_reconciliation",
    "separates_provisioning_authority",
  ],
  U: [
    "ranks_realization_option",
    "expresses_tradeoff",
    "serves_project_purpose",
    "selects_preferred_trajectory",
  ],
});

const RECEIPT_RELATIONS = Object.freeze({
  O: [
    "records_transition",
    "concerns_decision",
    "has_receipt_state",
    "has_revision",
  ],
  E: [
    "reports_transition_outcome",
    "cites_relay_event",
    "records_error",
    "has_append_only_provenance",
  ],
  D: [
    "records_authority_posture",
    "records_canonical_mutation",
    "records_effect_boundary",
    "satisfies_transition_contract",
  ],
  U: [
    "records_selected_trajectory",
    "reports_transition_consequence",
    "preserves_open_horizon",
  ],
});

const ARO_RELATIONS = Object.freeze({
  O: [
    "has_intensional_branch",
    "refines_branch",
    "connects_counterfactual",
    "realized_by_binding",
  ],
  E: [
    "supported_by_provenance",
    "has_coverage_witness",
    "contains_contradiction",
    "observed_at_revision",
  ],
  D: [
    "has_canonical_standing",
    "requires_candidate_admission",
    "separates_code_mutation",
    "preserves_exact_revision",
  ],
  U: [
    "expresses_current_posture",
    "expresses_target_posture",
    "opens_counterfactual",
    "defines_semantic_trajectory",
  ],
});

const ARO_CANDIDATE_RELATIONS =
  Object.freeze({
    O: [
      "reconstructs_aro",
      "contains_intensional_branch",
      "maps_realization_binding",
      "belongs_to_project",
    ],
    E: [
      "cites_repository_snapshot",
      "cites_exact_evidence",
      "records_contradiction",
      "requires_separate_reviews",
    ],
    D: [
      "requires_evidence_review",
      "requires_contradiction_review",
      "requires_operator_admission",
      "cannot_mutate_code",
    ],
    U: [
      "proposes_semantic_identity",
      "proposes_current_or_target_posture",
      "exposes_coverage_gap",
      "prepares_canonical_admission",
    ],
  });

const ARO_COVERAGE_RELATIONS =
  Object.freeze({
    O: [
      "covers_branch",
      "maps_binding",
      "maps_source",
      "has_coverage_state",
    ],
    E: [
      "cites_source_revision",
      "identifies_absence",
      "identifies_staleness",
      "identifies_contradiction",
    ],
    D: [
      "is_descriptive_witness",
      "does_not_validate_semantic_truth",
      "does_not_authorize_mutation",
    ],
    U: [
      "measures_realization_posture",
      "exposes_gap",
      "supports_reconstruction_review",
    ],
  });

const ARO_COMPARISON_RELATIONS =
  Object.freeze({
    O: [
      "compares_current_aro",
      "compares_target_aro",
      "shares_branch",
    ],
    E: [
      "compares_coverage_witness",
      "identifies_conflict",
      "identifies_missing_branch",
    ],
    D: [
      "is_descriptive_comparison",
      "does_not_create_obligation",
      "does_not_authorize_code_mutation",
    ],
    U: [
      "identifies_target_only_branch",
      "identifies_current_only_branch",
      "expresses_semantic_delta",
    ],
  });

function decisionLensSections(
  decision,
  lens,
) {
  if (lens === "O") {
    return [
      {
        sectionKind: "identity",
        title: "Object and realization",
        items: [
          {
            label: "decision kind",
            value: decision.decisionKind,
          },
          {
            label: "project",
            value:
              decision.projectName ||
              decision.projectId ||
              "world scope",
          },
          {
            label: "lifecycle",
            value: decision.lifecycle,
          },
          {
            label: "revision",
            value: String(decision.revision),
          },
        ],
      },
      {
        sectionKind: "relations",
        title: "Dependencies and consequences",
        items: [
          ...(decision.dependencies || []).map(
            (dependency) => ({
              label:
                `dependency · ${dependency.state}`,
              value: dependency.requirement,
            }),
          ),
          ...(decision.consequences || []).map(
            (consequence) => ({
              label:
                `consequence · ${consequence.posture}`,
              value: consequence.description,
            }),
          ),
        ],
      },
    ];
  }
  if (lens === "E") {
    return [{
      sectionKind: "evidence",
      title: "Warrant and uncertainty",
      items: [
        {
          label: "epistemic posture",
          value:
            decision.epistemicPosture ||
            "observed",
        },
        {
          label: "semantic shelf",
          value: decision.shelfRef
            ? "exact project shelf bound"
            : "no project shelf binding",
        },
        {
          label: "provenance",
          value: `${(
            decision.provenanceRefs || []
          ).length} exact reference${
            (decision.provenanceRefs || [])
              .length === 1
              ? ""
              : "s"
          }`,
        },
        ...(decision.dependencies || []).map(
          (dependency) => ({
            label:
              `dependency · ${dependency.state}`,
            value: dependency.requirement,
          }),
        ),
      ],
    }];
  }
  if (lens === "D") {
    return [{
      sectionKind: "governance",
      title: "Rules and authority",
      items: [
        {
          label: "resolution mode",
          value: decision.resolutionMode,
        },
        {
          label: "input contract",
          value:
            decision.resolutionContract
              ?.inputShape ||
            "scoped_free_form",
        },
        {
          label: "transition",
          value:
            decision.resolutionContract
              ?.transitionAvailability ||
            "unavailable",
        },
        {
          label: "authority",
          value:
            "descriptive only · no execution authority",
        },
        ...(decision.dependencies || []).map(
          (dependency) => ({
            label:
              `${dependency.blocking ? "gate" : "dependency"} · ${dependency.state}`,
            value: dependency.requirement,
          }),
        ),
      ],
    }];
  }
  return [
    {
      sectionKind: "trajectory",
      title: "Goals and trajectories",
      items: (decision.options || []).map(
        (option) => ({
          label:
            `${option.label} · ${option.availability}`,
          value:
            option.effectSummary ||
            option.description ||
            "No effect summary supplied.",
          optionRef: option.optionRef,
        }),
      ),
    },
    {
      sectionKind: "effects",
      title: "Consequences and trade-offs",
      items: (decision.consequences || []).map(
        (consequence) => ({
          label:
            `${consequence.effectClass} · ${consequence.posture}`,
          value: consequence.description,
        }),
      ),
    },
  ];
}

function candidateLensSections(
  candidate,
  lens,
) {
  if (lens === "O") {
    return [{
      sectionKind: "realization",
      title: "Object and realization",
      items: [
        {
          label: "project identity",
          value: candidate.identity,
        },
        {
          label: "recommended default",
          value:
            candidate.primaryAgentEnvironmentId,
        },
        {
          label: "allowed environments",
          value:
            (candidate.allowedEnvironmentIds || [])
              .join(", "),
        },
        {
          label: "git authority environment",
          value:
            candidate.gitAuthorityEnvironmentId,
        },
      ],
    }];
  }
  if (lens === "E") {
    return [{
      sectionKind: "evidence",
      title: "Warrant and uncertainty",
      items: [
        {
          label: "evidence review",
          value: candidate.evidenceReviewState,
        },
        {
          label: "reconciliation",
          value: candidate.reconciliationState,
        },
        {
          label: "realization evidence",
          value:
            `${(
              candidate.rankedRecommendations ||
              []
            ).length} harness-observed option${
              (
                candidate
                  .rankedRecommendations || []
              ).length === 1
                ? ""
                : "s"
            }`,
        },
      ],
    }];
  }
  if (lens === "D") {
    return [{
      sectionKind: "governance",
      title: "Rules and authority",
      items: [
        {
          label: "candidate standing",
          value: "non-canonical",
        },
        {
          label: "evidence gate",
          value:
            candidate.evidenceReviewState,
        },
        {
          label: "reconciliation gate",
          value:
            candidate.reconciliationState,
        },
        {
          label: "admission authority",
          value:
            "explicit operator action required",
        },
        {
          label: "workspace provisioning",
          value:
            "separate and unavailable in this slice",
        },
      ],
    }];
  }
  return [{
    sectionKind: "comparison",
    title: "Goals and trajectories",
    items:
      (candidate.rankedRecommendations || [])
        .map((recommendation) => ({
          label:
            `${recommendation.rank}. ${recommendation.displayLabel}`,
          value: [
            ...(recommendation.rationale || []),
            ...(recommendation.tradeoffs || [])
              .map((value) =>
                `Trade-off: ${value}`),
          ].join(" "),
          environmentId:
            recommendation.environmentId,
          availability:
            recommendation.availability,
          admissionState:
            recommendation.admissionState,
          recommended:
            recommendation.environmentId ===
              candidate
                .primaryAgentEnvironmentId,
        })),
  }];
}

function constitutionLensSections(
  constitution,
  lens,
) {
  const items = {
    O: [
      ["project identity", constitution.identity],
      [
        "primary environment",
        constitution.primaryAgentEnvironmentId,
      ],
      [
        "allowed environments",
        (constitution.allowedEnvironmentIds || [])
          .join(", "),
      ],
    ],
    E: [
      [
        "canonical revision",
        String(
          constitution.constitutionRevision,
        ),
      ],
      [
        "realization posture",
        "admitted semantic constitution",
      ],
    ],
    D: [
      [
        "authority epoch",
        String(constitution.authorityEpoch),
      ],
      [
        "activation",
        constitution.activationState,
      ],
      [
        "workspace provisioning",
        "not implied by admission",
      ],
    ],
    U: [
      ["purpose", constitution.purpose],
      [
        "trajectory",
        "awaiting workspace provisioning",
      ],
    ],
  }[lens];
  return [{
    sectionKind: {
      O: "realization",
      E: "evidence",
      D: "governance",
      U: "trajectory",
    }[lens],
    title: {
      O: "Object and realization",
      E: "Warrant and standing",
      D: "Rules and authority",
      U: "Goals and trajectory",
    }[lens],
    items: items.map(([label, value]) => ({
      label,
      value,
    })),
  }];
}

function receiptLensSections(
  receipt,
  lens,
) {
  const items = {
    O: [
      [
        "transition kind",
        receipt.transitionKind,
      ],
      ["state", receipt.state],
      [
        "decision",
        receipt.decisionId,
      ],
      [
        "receipt revision",
        String(receipt.receiptRevision),
      ],
    ],
    E: [
      ["outcome", receipt.summary],
      [
        "relay state",
        receipt.relayState ||
          "not applicable",
      ],
      [
        "relay event",
        receipt.relayEventRef?.id ||
          "none",
      ],
      [
        "error",
        receipt.errorCode || "none",
      ],
    ],
    D: [
      [
        "canonical decision mutation",
        receipt.canonicalDecisionMutation
          ? "recorded"
          : "not recorded",
      ],
      [
        "execution authority",
        receipt.executionAuthorityGranted
          ? "granted"
          : "not granted",
      ],
      [
        "downstream effects",
        receipt.downstreamEffectsExecuted
          ? "executed"
          : "not executed",
      ],
    ],
    U: [
      [
        "selected trajectory",
        receipt.selectedOptionLabel ||
          "no mechanical option",
      ],
      [
        "transition outcome",
        receipt.summary,
      ],
      [
        "remaining horizon",
        receipt.state === "resolved"
          ? "decision closed"
          : "decision remains governed",
      ],
    ],
  }[lens];
  return [{
    sectionKind: {
      O: "identity",
      E: "evidence",
      D: "governance",
      U: "trajectory",
    }[lens],
    title: {
      O: "Transition and realization",
      E: "Outcome and provenance",
      D: "Authority and effect boundary",
      U: "Trajectory and consequence",
    }[lens],
    items: items.map(([label, value]) => ({
      label,
      value,
    })),
  }];
}

function boundarySignals(
  primaryLens,
  objectClass,
  content = {},
) {
  return ODEU_LENSES
    .filter((lens) => lens !== primaryLens)
    .map((lens) => ({
      lens,
      label: {
        O: "object and realization",
        E: "warrant and uncertainty",
        D: "rules and authority",
        U: "goals and trajectory",
      }[lens],
      summary: objectClass ===
          "decision_transition_receipt"
        ? {
            O:
              `${content.transitionKind} · revision ${content.receiptRevision}`,
            E:
              content.relayState ||
              content.state,
            D:
              "append-only receipt · no authority minted",
            U:
              content.selectedOptionLabel ||
              content.state,
          }[lens]
        : objectClass === "open_decision"
        ? {
            O:
              `${content.dependencies?.length || 0} dependencies · ${content.consequences?.length || 0} consequences`,
            E:
              content.epistemicPosture ||
              "observed",
            D:
              content.resolutionMode ||
              "descriptive only",
            U:
              `${content.options?.length || 0} option${content.options?.length === 1 ? "" : "s"}`,
          }[lens]
        : objectClass ===
            "project_constitution_candidate"
          ? {
              O:
                `${content.allowedEnvironmentIds?.length || 0} allowed environments`,
              E:
                content.evidenceReviewState ||
                "not reviewed",
              D:
                "operator admission required",
              U:
                `${content.rankedRecommendations?.length || 0} ranked options`,
            }[lens]
          : objectClass ===
              "aro_reconstruction_candidate"
            ? {
                O:
                  `${content.candidateAro?.branches?.length || 0} intensional branches`,
                E:
                  `${content.evidenceRefs?.length || 0} evidence · ${content.contradictionRefs?.length || 0} contradiction refs`,
                D:
                  `${content.evidenceReviewState}/${content.contradictionReviewState} · admission separate`,
                U:
                  `${content.candidateAro?.posture || "unknown"} semantic posture`,
              }[lens]
          : objectClass ===
              "abstract_reasoning_object"
            ? {
                O:
                  `${content.branches?.length || 0} branches · ${content.edges?.length || 0} edges`,
                E:
                  content.coverageWitness?.coveragePosture ||
                  "coverage unavailable",
                D:
                  content.canonical
                    ? "canonical semantic object · no code authority"
                    : "non-canonical semantic object",
                U:
                  `${content.posture || "unknown"} · ${content.conceptKey || ""}`,
              }[lens]
          : objectClass ===
              "aro_coverage_witness"
            ? {
                O:
                  `${content.branchCount || 0} branches · ${content.realizedBranchCount || 0} realized`,
                E:
                  content.coveragePosture ||
                  "unknown coverage",
                D:
                  "descriptive witness · no semantic validation",
                U:
                  `${content.absentBranchRefs?.length || 0} absent · ${content.partialBranchRefs?.length || 0} partial`,
              }[lens]
          : objectClass ===
              "aro_current_target_comparison"
            ? {
                O:
                  `${content.sharedBranchKeys?.length || 0} shared branches`,
                E:
                  `${content.conflictPairs?.length || 0} conflicts`,
                D:
                  "comparison only · no implementation authority",
                U:
                  `${content.targetOnlyBranchRefs?.length || 0} target-only branches`,
              }[lens]
          : {
              O: "canonical project identity",
              E: "admitted standing",
              D:
                "provisioning authority remains separate",
              U:
                content.purpose ||
                "project trajectory",
            }[lens],
      grantsAuthority: false,
    }));
}

function buildLensProjection(input = {}) {
  const subjectRef = exactRef(
    input.subjectRef,
    "lens.subjectRef",
  );
  const promotedObjectRefs = uniqueRefs([
    subjectRef,
    ...(input.promotedObjectRefs || []),
  ]);
  const projection = {
    schema:
      SEMANTIC_LENS_PROJECTION_SCHEMA,
    semanticLensProjectionId: stableId(
      "wm_semantic_lens_projection",
      {
        subjectRef,
        lens: input.lens,
        sourceRevision:
          input.sourceProjectionRevision,
      },
    ),
    subjectRef,
    taskRef: input.taskRef
      ? exactRef(
          input.taskRef,
          "lens.taskRef",
        )
      : null,
    lens: input.lens,
    promotedRelationKinds: uniqueStrings(
      input.promotedRelationKinds,
    ),
    promotedObjectRefs,
    boundarySignals: input.boundarySignals,
    suppressedRelationKinds:
      uniqueStrings(
        input.suppressedRelationKinds,
      ),
    abstractionDepth: "semantic_objects",
    breadth: "bounded_primary_landscape",
    sections: input.sections,
    sourceRevisionRefs: uniqueRefs(
      input.sourceRevisionRefs,
    ),
    grantsAuthority: false,
  };
  projection.digest = digestFor(
    SEMANTIC_LENS_PROJECTION_SCHEMA,
    projection,
    ["digest"],
  );
  validateSemanticLensProjection(projection);
  return projection;
}

function buildProjectionWitness(input = {}) {
  const witness = {
    schema:
      SEMANTIC_PROJECTION_WITNESS_SCHEMA,
    semanticProjectionWitnessId:
      stableId(
        "wm_semantic_projection_witness",
        {
          subjectRef: input.subjectRef,
          lens: input.lens,
          lensProjectionDigest:
            input.lensProjection.digest,
        },
      ),
    subjectRef: exactRef(
      input.subjectRef,
      "witness.subjectRef",
    ),
    lens: input.lens,
    promotedRefs:
      input.lensProjection
        .promotedObjectRefs,
    boundarySignalLenses:
      input.lensProjection
        .boundarySignals.map(
          (signal) => signal.lens,
        ),
    suppressedRelationKinds:
      input.lensProjection
        .suppressedRelationKinds,
    selectionReasons: [
      "The selected lens determines perceptual foreground.",
      "The active task and exact semantic object constrain the visible neighborhood.",
      "Suppressed relations remain available through another lens or semantic zoom.",
    ],
    taskBindingRef: input.taskRef
      ? exactRef(
          input.taskRef,
          "witness.taskRef",
        )
      : null,
    profileBindingRef: {
      kind: "morphic_profile",
      id:
        "world_manager_sc7_aro_reconstruction",
      digest: digestFor(
        "direct_morphic_profile_binding@1",
        {
          profileId:
            "world_manager_sc7_aro_reconstruction",
          baseProfile:
            "artifact_inspector_alternate",
        },
      ),
    },
    viewportClass: "responsive_bounded",
    sourceRevisionRefs:
      input.lensProjection
        .sourceRevisionRefs,
    grantsAuthority: false,
  };
  witness.digest = digestFor(
    SEMANTIC_PROJECTION_WITNESS_SCHEMA,
    witness,
    ["digest"],
  );
  return witness;
}

function buildRegionBinding(input = {}) {
  const binding = {
    schema: SEMANTIC_REGION_BINDING_SCHEMA,
    semanticRegionBindingId: stableId(
      "wm_semantic_region_binding",
      {
        surfaceProjectionId:
          input.surfaceProjectionId,
        subjectRef: input.subjectRef,
        lens: input.lens,
        interactionContractId:
          input.interaction
            .interactionContractId,
      },
    ),
    surfaceProjectionRef: {
      kind:
        "semantic_object_surface_identity",
      id: input.surfaceProjectionId,
      digest:
        input.surfaceProjectionDigest,
    },
    regionId:
      `semantic-object:${input.subjectRef.kind}:${input.subjectRef.id}`,
    subjectRef: exactRef(
      input.subjectRef,
      "region.subjectRef",
    ),
    selectedLens: input.lens,
    taskRef: input.taskRef
      ? exactRef(
          input.taskRef,
          "region.taskRef",
        )
      : null,
    promotedObjectRefs:
      input.lensProjection
        .promotedObjectRefs,
    promotedRelationKinds:
      input.lensProjection
        .promotedRelationKinds,
    interactionContractRef: {
      kind:
        "semantic_surface_interaction_contract",
      id:
        input.interaction
          .interactionContractId,
      digest: digestFor(
        input.interaction.schema,
        input.interaction,
      ),
    },
    expectedSubjectRevision:
      Number(input.expectedSubjectRevision || 1),
    bindingPosture:
      "exact_region_binding",
    staleBinding:
      input.state === "stale",
    grantsAuthority: false,
  };
  binding.digest = digestFor(
    SEMANTIC_REGION_BINDING_SCHEMA,
    binding,
    ["digest"],
  );
  validateSemanticRegionBinding(binding);
  return binding;
}

function lensFamilyForObject(
  objectClass,
) {
  if (objectClass === "open_decision") {
    return DECISION_RELATIONS;
  }
  if (
    objectClass ===
      "decision_transition_receipt"
  ) {
    return RECEIPT_RELATIONS;
  }
  if (
    objectClass ===
      "aro_reconstruction_candidate"
  ) {
    return ARO_CANDIDATE_RELATIONS;
  }
  if (
    objectClass ===
      "abstract_reasoning_object"
  ) {
    return ARO_RELATIONS;
  }
  if (
    objectClass ===
      "aro_coverage_witness"
  ) {
    return ARO_COVERAGE_RELATIONS;
  }
  if (
    objectClass ===
      "aro_current_target_comparison"
  ) {
    return ARO_COMPARISON_RELATIONS;
  }
  return GENESIS_RELATIONS;
}

function buildObjectSurface(input = {}) {
  const subjectRef = exactRef(
    input.subjectRef,
    "surface.subjectRef",
  );
  const surfaceProjectionId = stableId(
    "wm_semantic_object_surface",
    {
      objectClass: input.objectClass,
      subjectRef,
      compilerRevision:
        SEMANTIC_SURFACE_COMPILER_REVISION,
    },
  );
  const sourceRevisionRefs = uniqueRefs([
    subjectRef,
    ...(input.sourceRevisionRefs || []),
  ]);
  const surfaceIdentityDigest = digestFor(
    "direct_semantic_object_surface_identity@1",
    {
      semanticObjectSurfaceId:
        surfaceProjectionId,
      objectClass: input.objectClass,
      subjectRef,
      compilerRevision:
        SEMANTIC_SURFACE_COMPILER_REVISION,
    },
  );
  const relationFamily =
    lensFamilyForObject(
      input.objectClass,
    );
  const lensProjections = ODEU_LENSES.map(
    (lens) => {
      const promotedRelationKinds =
        relationFamily[lens];
      const suppressedRelationKinds =
        ODEU_LENSES
          .filter((other) => other !== lens)
          .flatMap((other) =>
            relationFamily[other]);
      return buildLensProjection({
        subjectRef,
        taskRef: input.taskRef,
        lens,
        promotedRelationKinds,
        promotedObjectRefs:
          input.promotedObjectRefs,
        boundarySignals:
          boundarySignals(
            lens,
            input.objectClass,
            input.content,
          ),
        suppressedRelationKinds,
        sections:
          input.sectionsForLens(lens),
        sourceRevisionRefs,
        sourceProjectionRevision:
          input.sourceProjectionRevision,
      });
    },
  );
  const projectionWitnesses =
    lensProjections.map((lensProjection) =>
      buildProjectionWitness({
        subjectRef,
        taskRef: input.taskRef,
        lens: lensProjection.lens,
        lensProjection,
      }));
  const draftSurface = {
    schema: SEMANTIC_OBJECT_SURFACE_SCHEMA,
    semanticObjectSurfaceId:
      surfaceProjectionId,
    surfaceIdentityDigest,
    compilerRevision:
      SEMANTIC_SURFACE_COMPILER_REVISION,
    objectClass: input.objectClass,
    subjectRef,
    semanticIdentity: bounded(
      input.semanticIdentity,
      subjectRef.id,
      300,
    ),
    summary: bounded(
      input.summary,
      "",
      1_200,
    ),
    projectId: text(input.projectId, ""),
    sourceSemanticEventId: text(
      input.sourceSemanticEventId,
      "",
    ),
    surfaceState: input.state,
    defaultLens: input.defaultLens,
    availableLenses: [...ODEU_LENSES],
    lensProjections,
    projectionWitnesses:
      projectionWitnesses.map((witness) => ({
        lens: witness.lens,
        witnessRef: refFor(
          "semantic_projection_witness",
          witness,
          "semanticProjectionWitnessId",
        ),
      })),
    morph: input.morph,
    interaction: input.interaction,
    compactProjection: input.compactProjection,
    canonicalObject:
      input.canonicalObject === true,
    uiMintsAuthority: false,
    grantsAuthority: false,
  };
  draftSurface.digest = digestFor(
    SEMANTIC_OBJECT_SURFACE_SCHEMA,
    draftSurface,
    ["digest"],
  );
  const regionBindings =
    lensProjections.map((lensProjection) =>
      buildRegionBinding({
        surfaceProjectionId,
        surfaceProjectionDigest:
          surfaceIdentityDigest,
        subjectRef,
        taskRef: input.taskRef,
        lens: lensProjection.lens,
        lensProjection,
        interaction: input.interaction,
        expectedSubjectRevision:
          input.expectedSubjectRevision,
        state: input.state,
      }));
  const surface = {
    ...draftSurface,
    regionBindings:
      regionBindings.map((binding) => ({
        lens: binding.selectedLens,
        bindingRef: refFor(
          "semantic_region_binding",
          binding,
          "semanticRegionBindingId",
        ),
      })),
  };
  surface.digest = digestFor(
    SEMANTIC_OBJECT_SURFACE_SCHEMA,
    surface,
    ["digest"],
  );
  validateSemanticObjectSurface(surface);
  return {
    surface,
    witnesses: projectionWitnesses,
    regionBindings,
  };
}

function decisionSourceEventId(
  decision,
  candidateById,
) {
  const direct = (
    decision.provenanceRefs || []
  ).find((ref) =>
    ref.kind ===
      "world_manager_semantic_event");
  if (direct) return direct.id;
  const candidateRef = (
    decision.provenanceRefs || []
  ).find((ref) =>
    ref.kind ===
      "project_constitution_candidate");
  return candidateRef
    ? candidateById.get(candidateRef.id)
        ?.sourceSemanticEventRef?.id || ""
    : text(
        decision.sourceSemanticEventId,
        "",
      );
}

function compileDecisionSurface(
  decision,
  input,
) {
  const registry = input.registry;
  const state = decisionSurfaceState(decision);
  const interaction =
    decisionInteraction(decision);
  const promotedRefs = uniqueRefs([
    ...(decision.provenanceRefs || []),
    ...(decision.shelfRef
      ? [decision.shelfRef]
      : []),
  ]);
  return buildObjectSurface({
    objectClass: "open_decision",
    subjectRef: decision.artifactRef,
    semanticIdentity:
      decision.semanticIdentity ||
      decision.text,
    summary:
      decision.description ||
      decision.text,
    projectId: decision.projectId,
    sourceSemanticEventId:
      decisionSourceEventId(
        decision,
        input.candidateById,
      ),
    state,
    defaultLens:
      decisionDefaultLens(decision),
    morph:
      decisionMorph(decision, registry),
    interaction,
    content: decision,
    sectionsForLens: (lens) =>
      decisionLensSections(
        decision,
        lens,
      ),
    promotedObjectRefs: promotedRefs,
    sourceRevisionRefs: promotedRefs,
    expectedSubjectRevision:
      decision.revision,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject:
      decision.canonical === true,
    compactProjection: {
      eyebrow:
        decision.projectName ||
        decision.projectId ||
        "world scope",
      title:
        decision.text ||
        decision.semanticIdentity,
      state,
      indicator:
        decision.resolutionMode,
      actionLabel:
        interaction.composer
          ?.submitLabel ||
        (
          interaction.available
            ? "Review exact options"
            : "Inspect"
        ),
    },
  });
}

function candidateSurfaceState(candidate = {}) {
  if (candidate.lifecycle === "admitted") {
    return "canonical";
  }
  if (
    candidate.reconciliationState !==
      "reconciled"
  ) {
    return "blocked";
  }
  if (
    candidate.evidenceReviewState ===
      "reviewed"
  ) {
    return "ready";
  }
  return "provisional";
}

function candidateInteraction(candidate = {}) {
  const reviewed =
    candidate.evidenceReviewState ===
      "reviewed";
  const reconciled =
    candidate.reconciliationState ===
      "reconciled";
  const admitted =
    candidate.lifecycle === "admitted";
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        candidateId:
          candidate.candidateId,
        digest: candidate.digest,
      },
    ),
    actionCluster:
      "safe_buffered_commit",
    transitionKind:
      "project_constitution_admission",
    resolutionMode:
      "operator_admission",
    inputShape:
      "exact_candidate_ref",
    options: [],
    dependencies: [
      {
        dependencyId:
          `${candidate.candidateId}:evidence`,
        dependencyKind:
          "evidence_review",
        requirement:
          "Inspect the realization recommendation and substrate evidence.",
        state: reviewed
          ? "satisfied"
          : "unsatisfied",
        blocking: true,
        grantsAuthority: false,
      },
      {
        dependencyId:
          `${candidate.candidateId}:reconciliation`,
        dependencyKind:
          "world_manager_reconciliation",
        requirement:
          "WorldManager reconciliation must complete.",
        state: reconciled
          ? "satisfied"
          : "unsatisfied",
        blocking: true,
        grantsAuthority: false,
      },
    ],
    blockedDependencyCount:
      Number(!reviewed) +
      Number(!reconciled),
    composer: null,
    reviewAction: {
      actionKind:
        "inspect_project_genesis_evidence",
      label: reviewed
        ? "Reopen substrate evidence"
        : "Inspect substrate evidence",
      available: !admitted,
      grantsAuthority: false,
    },
    commitAction: {
      actionKind:
        "admit_project_constitution",
      label:
        "Admit project constitution",
      available:
        !admitted &&
        reviewed &&
        reconciled,
      canonicalMutationPossible:
        !admitted,
      downstreamEffectsExecuted: false,
      grantsAuthority: false,
    },
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: false,
    canonicalMutationPossible:
      !admitted,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: !admitted,
    grantsAuthority: false,
  };
}

function compileCandidateSurface(
  candidate,
  input,
) {
  const state =
    candidateSurfaceState(candidate);
  const interaction =
    candidateInteraction(candidate);
  const morphResolver =
    input.registry.entries.find(
      (entry) =>
        entry.resolverId ===
          "project_constitution_candidate.comparison",
    );
  const primaryRecommendation =
    (candidate.rankedRecommendations || [])
      .find((recommendation) =>
        recommendation.environmentId ===
          candidate
            .primaryAgentEnvironmentId);
  return buildObjectSurface({
    objectClass:
      "project_constitution_candidate",
    subjectRef: {
      kind:
        "project_constitution_candidate",
      id: candidate.candidateId,
      digest: candidate.digest,
      projectId:
        candidate.proposedProjectId,
    },
    semanticIdentity: candidate.identity,
    summary:
      candidate.purpose ||
      candidate.semanticSummary,
    projectId:
      candidate.proposedProjectId,
    sourceSemanticEventId:
      candidate.sourceSemanticEventRef?.id ||
      "",
    state,
    defaultLens: "U",
    morph: {
      resolverRef: {
        kind: "morph_resolver",
        id: morphResolver.resolverId,
        digest: digestFor(
          "direct_morph_resolver_entry@1",
          morphResolver,
        ),
      },
      family:
        morphResolver.morphFamily,
      actionPosture:
        morphResolver.actionPosture,
      density:
        "compact_with_semantic_zoom",
      navigationMode:
        "bounded_landscape_focus",
    },
    interaction,
    content: candidate,
    sectionsForLens: (lens) =>
      candidateLensSections(
        candidate,
        lens,
      ),
    promotedObjectRefs: [
      ...(candidate.sourceSemanticEventRef
        ? [
            candidate
              .sourceSemanticEventRef,
          ]
        : []),
    ],
    sourceRevisionRefs: [
      ...(candidate.sourceSemanticEventRef
        ? [
            candidate
              .sourceSemanticEventRef,
          ]
        : []),
    ],
    expectedSubjectRevision:
      candidate.revision || 1,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: false,
    compactProjection: {
      eyebrow: "Project constitution",
      title: candidate.identity,
      state,
      indicator:
        primaryRecommendation
          ?.displayLabel ||
        candidate.primaryAgentEnvironmentId,
      actionLabel:
        interaction.commitAction.available
          ? interaction.commitAction.label
          : interaction.reviewAction.label,
    },
  });
}

function constitutionInteraction(
  constitution = {},
) {
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        projectId: constitution.projectId,
        digest: constitution.digest,
      },
    ),
    actionCluster: "read_only",
    transitionKind: "",
    resolutionMode: "none",
    inputShape: "none",
    options: [],
    dependencies: [],
    blockedDependencyCount: 0,
    composer: null,
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: false,
    canonicalMutationPossible: false,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: false,
    grantsAuthority: false,
  };
}

function compileConstitutionSurface(
  constitution,
  input,
) {
  const interaction =
    constitutionInteraction(
      constitution,
    );
  const morphResolver =
    input.registry.entries.find(
      (entry) =>
        entry.resolverId ===
          "project_constitution.status",
    );
  return buildObjectSurface({
    objectClass: "project_constitution",
    subjectRef: {
      kind: "project_constitution",
      id: constitution.projectId,
      digest: constitution.digest,
      projectId: constitution.projectId,
    },
    semanticIdentity:
      constitution.identity,
    summary: constitution.purpose,
    projectId: constitution.projectId,
    sourceSemanticEventId: "",
    state: "canonical",
    defaultLens: "O",
    morph: {
      resolverRef: {
        kind: "morph_resolver",
        id: morphResolver.resolverId,
        digest: digestFor(
          "direct_morph_resolver_entry@1",
          morphResolver,
        ),
      },
      family:
        morphResolver.morphFamily,
      actionPosture:
        morphResolver.actionPosture,
      density:
        "compact_with_semantic_zoom",
      navigationMode:
        "bounded_landscape_focus",
    },
    interaction,
    content: constitution,
    sectionsForLens: (lens) =>
      constitutionLensSections(
        constitution,
        lens,
      ),
    promotedObjectRefs: [],
    sourceRevisionRefs: [],
    expectedSubjectRevision:
      constitution.constitutionRevision || 1,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: true,
    compactProjection: {
      eyebrow: "Project constitution",
      title: constitution.identity,
      state: "canonical",
      indicator:
        constitution.primaryAgentEnvironmentId,
      actionLabel: "Inspect",
    },
  });
}

function receiptSurfaceState(
  receipt = {},
) {
  return {
    resolved: "resolved",
    blocked: "blocked",
    failed: "conflicted",
    accepted: "submitting",
    pending: "submitting",
    relayed: "ready",
  }[receipt.state] || "ready";
}

function receiptDefaultLens(
  receipt = {},
) {
  return {
    request_evidence: "E",
    request_authority: "D",
    resolve_option: "U",
    semantic_relay: "U",
  }[receipt.transitionKind] || "O";
}

function receiptInteraction(
  receipt = {},
) {
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        receiptRef: receipt.receiptRef,
        receiptRevision:
          receipt.receiptRevision,
      },
    ),
    actionCluster: "read_only",
    transitionKind: "",
    resolutionMode: "none",
    inputShape: "none",
    options: [],
    dependencies: [],
    blockedDependencyCount: 0,
    composer: null,
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: false,
    canonicalMutationPossible: false,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: false,
    grantsAuthority: false,
  };
}

function compileReceiptSurface(
  receipt,
  input,
) {
  if (
    receipt.downstreamEffectsExecuted !==
      false ||
    receipt.executionAuthorityGranted !==
      false ||
    receipt.grantsAuthority !== false
  ) {
    fail(
      "semantic_surface_receipt_authority_inflation",
      receipt.receiptRef?.id,
    );
  }
  const interaction =
    receiptInteraction(receipt);
  const morphResolver =
    input.registry.entries.find(
      (entry) =>
        entry.resolverId ===
          "decision_transition_receipt.status",
    );
  const promotedObjectRefs = [
    ...(receipt.relayEventRef
      ? [receipt.relayEventRef]
      : []),
  ];
  return buildObjectSurface({
    objectClass:
      "decision_transition_receipt",
    subjectRef: receipt.receiptRef,
    semanticIdentity:
      `${receipt.transitionKind} · ${receipt.state}`,
    summary: receipt.summary,
    projectId: receipt.projectId,
    sourceSemanticEventId:
      receipt.relayEventRef?.id || "",
    state: receiptSurfaceState(receipt),
    defaultLens:
      receiptDefaultLens(receipt),
    morph: {
      resolverRef: {
        kind: "morph_resolver",
        id: morphResolver.resolverId,
        digest: digestFor(
          "direct_morph_resolver_entry@1",
          morphResolver,
        ),
      },
      family:
        morphResolver.morphFamily,
      actionPosture:
        morphResolver.actionPosture,
      density:
        "compact_with_semantic_zoom",
      navigationMode:
        "bounded_landscape_focus",
    },
    interaction,
    content: receipt,
    sectionsForLens: (lens) =>
      receiptLensSections(
        receipt,
        lens,
      ),
    promotedObjectRefs,
    sourceRevisionRefs:
      promotedObjectRefs,
    expectedSubjectRevision:
      receipt.receiptRevision || 1,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: false,
    compactProjection: {
      eyebrow:
        `${String(
          receipt.transitionKind,
        ).replace(/_/g, " ")} · receipt`,
      title:
        receipt.selectedOptionLabel ||
        String(receipt.state)
          .replace(/_/g, " "),
      state:
        receiptSurfaceState(receipt),
      indicator:
        receipt.relayState ||
        receipt.state,
      actionLabel: "Inspect receipt",
    },
  });
}

function morphForResolver(
  registry,
  resolverId,
) {
  const resolver =
    registry.entries.find((entry) =>
      entry.resolverId === resolverId);
  if (!resolver) {
    fail(
      "semantic_surface_morph_resolver_missing",
      resolverId,
    );
  }
  return {
    resolverRef: {
      kind: "morph_resolver",
      id: resolver.resolverId,
      digest: digestFor(
        "direct_morph_resolver_entry@1",
        resolver,
      ),
    },
    family: resolver.morphFamily,
    actionPosture:
      resolver.actionPosture,
    density:
      "compact_with_semantic_zoom",
    navigationMode:
      "bounded_landscape_focus",
  };
}

function aroReadOnlyInteraction(
  subjectRef,
) {
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        subjectRef,
        posture: "read_only",
      },
    ),
    actionCluster: "read_only",
    transitionKind: "",
    resolutionMode: "none",
    inputShape: "none",
    options: [],
    dependencies: [],
    blockedDependencyCount: 0,
    composer: null,
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: false,
    canonicalMutationPossible: false,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: false,
    grantsAuthority: false,
  };
}

function aroCandidateSurfaceState(
  candidate,
) {
  if (candidate.lifecycle === "admitted") {
    return "resolved";
  }
  const reviewed =
    candidate.evidenceReviewState ===
      "reviewed" &&
    candidate.contradictionReviewState ===
      "reviewed";
  if (reviewed) return "ready";
  if (
    candidate.contradictionRefs?.length
  ) {
    return "conflicted";
  }
  return "provisional";
}

function aroCandidateInteraction(
  candidate,
) {
  const reviewed =
    candidate.evidenceReviewState ===
      "reviewed" &&
    candidate.contradictionReviewState ===
      "reviewed";
  const admitted =
    candidate.lifecycle === "admitted";
  return {
    schema:
      "direct_semantic_surface_interaction_contract@1",
    interactionContractId: stableId(
      "wm_surface_interaction",
      {
        candidateId:
          candidate.candidateId,
        candidateRevision:
          candidate.candidateRevision,
        digest: candidate.digest,
      },
    ),
    actionCluster:
      "safe_buffered_commit",
    transitionKind:
      "aro_reconstruction_admission",
    resolutionMode:
      "operator_review_and_admission",
    inputShape:
      "exact_candidate_ref",
    options: [],
    dependencies: [
      {
        dependencyId:
          `${candidate.candidateId}:evidence-review`,
        dependencyKind:
          "evidence_review",
        requirement:
          "Review the exact reconstruction evidence without treating review as semantic validation.",
        state:
          candidate.evidenceReviewState ===
            "reviewed"
            ? "satisfied"
            : "unsatisfied",
        blocking: true,
        grantsAuthority: false,
      },
      {
        dependencyId:
          `${candidate.candidateId}:contradiction-review`,
        dependencyKind:
          "contradiction_review",
        requirement:
          "Review the contradiction set, including the empty set, before admission.",
        state:
          candidate
            .contradictionReviewState ===
              "reviewed"
            ? "satisfied"
            : "unsatisfied",
        blocking: true,
        grantsAuthority: false,
      },
    ],
    blockedDependencyCount:
      Number(
        candidate.evidenceReviewState !==
          "reviewed",
      ) +
      Number(
        candidate
          .contradictionReviewState !==
          "reviewed",
      ),
    composer: null,
    reviewAction: {
      actionKind:
        "record_aro_reconstruction_review",
      label: reviewed
        ? "Evidence and contradictions reviewed"
        : "Record reconstruction review",
      available: !reviewed && !admitted,
      semanticTruthValidated: false,
      grantsAuthority: false,
    },
    commitAction: {
      actionKind:
        "admit_reconstructed_aro",
      label: "Admit reconstructed ARO",
      available: reviewed && !admitted,
      canonicalMutationPossible:
        reviewed && !admitted,
      codeMutationPossible: false,
      downstreamEffectsExecuted: false,
      grantsAuthority: false,
    },
    exactSubjectRequired: true,
    expectedRevisionRequired: true,
    idempotencyRequired: true,
    canonicalMutationPossible:
      reviewed && !admitted,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    available: !admitted,
    grantsAuthority: false,
  };
}

function aroCandidateLensSections(
  candidate,
  lens,
) {
  const aro = candidate.candidateAro;
  if (lens === "O") {
    return [{
      sectionKind: "identity",
      title: "Reconstructed object",
      items: [
        {
          label: "semantic identity",
          value: aro.semanticIdentity,
        },
        {
          label: "concept",
          value: aro.conceptKey,
        },
        {
          label: "posture",
          value: aro.posture,
        },
        {
          label: "intensional topology",
          value:
            `${aro.branches.length} branches · ${aro.edges.length} edges · ${aro.realizationBindings.length} realization bindings`,
        },
      ],
    }];
  }
  if (lens === "E") {
    return [{
      sectionKind: "evidence",
      title: "Evidence and contradiction review",
      items: [
        {
          label: "repository snapshot",
          value:
            candidate.repositorySnapshotRef.id,
        },
        {
          label: "evidence",
          value:
            `${candidate.evidenceRefs.length} exact references · ${candidate.evidenceReviewState}`,
        },
        {
          label: "contradictions",
          value:
            `${candidate.contradictionRefs.length} exact references · ${candidate.contradictionReviewState}`,
        },
        {
          label: "coverage",
          value:
            aro.coverageWitness.coveragePosture,
        },
      ],
    }];
  }
  if (lens === "D") {
    return [{
      sectionKind: "governance",
      title: "Admission boundary",
      items: [
        {
          label: "standing",
          value:
            `${candidate.lifecycle} · non-canonical`,
        },
        {
          label: "review meaning",
          value:
            "records operator inspection; does not validate semantic truth",
        },
        {
          label: "admission",
          value:
            "requires both exact review gates",
        },
        {
          label: "code effects",
          value:
            "unavailable in this slice",
        },
      ],
    }];
  }
  return [{
    sectionKind: "trajectory",
    title: "Semantic posture and gaps",
    items: [
      {
        label: "purpose",
        value:
          aro.purpose ||
          aro.semanticIdentity,
      },
      {
        label: "posture",
        value: aro.posture,
      },
      {
        label: "absent branches",
        value: String(
          aro.coverageWitness
            .absentBranchRefs.length,
        ),
      },
      {
        label: "counterfactual branches",
        value: String(
          aro.branches.filter((branch) =>
            branch.modality ===
              "counterfactual").length,
        ),
      },
    ],
  }];
}

function compileAroCandidateSurface(
  candidate,
  input,
) {
  const state =
    aroCandidateSurfaceState(candidate);
  const interaction =
    aroCandidateInteraction(candidate);
  const aro = candidate.candidateAro;
  const targetDefinition =
    candidate.reconstructionMethod ===
      "semantic_target_definition";
  const subjectRef = {
    kind:
      "aro_reconstruction_candidate",
    id: candidate.candidateId,
    digest: candidate.digest,
    projectId: candidate.projectId,
  };
  const promotedRefs = uniqueRefs([
    candidate.repositorySnapshotRef,
    ...candidate.evidenceRefs,
    ...candidate.contradictionRefs,
    aro.coverageWitnessRef,
  ]);
  return buildObjectSurface({
    objectClass:
      "aro_reconstruction_candidate",
    subjectRef,
    semanticIdentity:
      aro.semanticIdentity,
    summary:
      aro.purpose ||
      (
        targetDefinition
          ? `Provisional target definition for ${aro.conceptKey}.`
          : `Reconstructed ${aro.posture} model for ${aro.conceptKey}.`
      ),
    projectId: candidate.projectId,
    sourceSemanticEventId:
      candidate.sourceSemanticEventRef?.id ||
      "",
    state,
    defaultLens:
      candidate.contradictionRefs.length
        ? "E"
        : "O",
    morph: morphForResolver(
      input.registry,
      "aro_reconstruction_candidate.comparison",
    ),
    interaction,
    content: candidate,
    sectionsForLens: (lens) =>
      aroCandidateLensSections(
        candidate,
        lens,
      ),
    promotedObjectRefs: promotedRefs,
    sourceRevisionRefs: promotedRefs,
    expectedSubjectRevision:
      candidate.candidateRevision,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: false,
    compactProjection: {
      eyebrow:
        targetDefinition
          ? "ARO target definition · provisional"
          : `ARO reconstruction · ${aro.posture}`,
      title: aro.semanticIdentity,
      state,
      indicator:
        aro.coverageWitness
          .coveragePosture,
      actionLabel:
        interaction.commitAction.available
          ? interaction.commitAction.label
          : interaction.reviewAction.label,
    },
  });
}

function aroLensSections(aro, lens) {
  if (lens === "O") {
    return [
      {
        sectionKind: "identity",
        title: "Abstract reasoning object",
        items: [
          {
            label: "identity",
            value: aro.semanticIdentity,
          },
          {
            label: "concept / posture",
            value:
              `${aro.conceptKey} · ${aro.posture}`,
          },
          {
            label: "revision / lifecycle",
            value:
              `${aro.revision} · ${aro.lifecycle}`,
          },
        ],
      },
      {
        sectionKind: "tree",
        title: "Intensional branches",
        items: aro.branches.map((branch) => ({
          label:
            `${branch.modality} · ${branch.branchKey}`,
          value:
            `${branch.statement} [${branch.semanticState}]`,
          branchRef: {
            kind: "aro_branch",
            id: branch.branchId,
            digest: branch.digest,
          },
          parentBranchRef:
            branch.parentBranchRef,
        })),
      },
    ];
  }
  if (lens === "E") {
    return [{
      sectionKind: "evidence",
      title: "Coverage and provenance",
      items: [
        {
          label: "coverage posture",
          value:
            aro.coverageWitness
              .coveragePosture,
        },
        {
          label: "realization bindings",
          value: String(
            aro.realizationBindings.length,
          ),
        },
        {
          label: "provenance",
          value:
            `${aro.provenanceRefs.length} exact references`,
        },
        {
          label: "contradictions",
          value: String(
            aro.coverageWitness
              .contradictionRefs.length,
          ),
        },
      ],
    }];
  }
  if (lens === "D") {
    return [{
      sectionKind: "governance",
      title: "Standing and authority",
      items: [
        {
          label: "canonical standing",
          value:
            aro.canonical
              ? "admitted semantic object"
              : "non-canonical object",
        },
        {
          label: "lifecycle",
          value: aro.lifecycle,
        },
        {
          label: "authority",
          value:
            "does not authorize code or downstream effects",
        },
      ],
    }];
  }
  return [{
    sectionKind: "trajectory",
    title: "Posture and counterfactual horizon",
    items: [
      {
        label: "purpose",
        value:
          aro.purpose ||
          aro.semanticIdentity,
      },
      {
        label: "posture",
        value: aro.posture,
      },
      ...aro.branches
        .filter((branch) =>
          branch.modality ===
            "counterfactual")
        .map((branch) => ({
          label:
            `counterfactual · ${branch.branchKey}`,
          value: [
            branch.condition,
            branch.expectedOutcome,
          ].filter(Boolean).join(" → ") ||
            branch.statement,
        })),
    ],
  }];
}

function compileAroSurface(aro, input) {
  const subjectRef = {
    kind:
      "abstract_reasoning_object",
    id: aro.aroId,
    digest: aro.digest,
    projectId: aro.projectId,
  };
  const interaction =
    aroReadOnlyInteraction(subjectRef);
  const state = {
    active: "canonical",
    stale: "stale",
    conflicted: "conflicted",
    superseded: "resolved",
  }[aro.lifecycle] ||
    (aro.canonical
      ? "canonical"
      : "provisional");
  const promotedRefs = uniqueRefs([
    aro.coverageWitnessRef,
    ...aro.provenanceRefs,
    ...aro.realizationBindings.map(
      (binding) => ({
        kind:
          "aro_realization_binding",
        id:
          binding.realizationBindingId,
        digest: binding.digest,
      })),
  ]);
  return buildObjectSurface({
    objectClass:
      "abstract_reasoning_object",
    subjectRef,
    semanticIdentity:
      aro.semanticIdentity,
    summary:
      aro.purpose ||
      `${aro.posture} semantic model for ${aro.conceptKey}.`,
    projectId: aro.projectId,
    sourceSemanticEventId: "",
    state,
    defaultLens: "O",
    morph: morphForResolver(
      input.registry,
      "abstract_reasoning_object.tree",
    ),
    interaction,
    content: aro,
    sectionsForLens: (lens) =>
      aroLensSections(aro, lens),
    promotedObjectRefs: promotedRefs,
    sourceRevisionRefs: promotedRefs,
    expectedSubjectRevision:
      aro.revision,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject:
      aro.canonical === true,
    compactProjection: {
      eyebrow:
        `ARO · ${aro.posture}`,
      title: aro.semanticIdentity,
      state,
      indicator:
        aro.coverageWitness
          .coveragePosture,
      actionLabel: "Inspect branches",
    },
  });
}

function coverageLensSections(
  witness,
  lens,
) {
  if (lens === "O") {
    return [{
      sectionKind: "graph",
      title: "Branch-to-realization graph",
      items:
        witness.branchCoverage.map((entry) => ({
          label:
            `${entry.coverageState} · ${entry.branchRef.id}`,
          value:
            `${entry.realizationBindingRefs.length} realization binding${entry.realizationBindingRefs.length === 1 ? "" : "s"}`,
          branchRef: entry.branchRef,
          realizationBindingRefs:
            entry.realizationBindingRefs,
        })),
    }];
  }
  if (lens === "E") {
    return [{
      sectionKind: "evidence",
      title: "Gaps, staleness, and contradiction",
      items: [
        {
          label: "coverage posture",
          value: witness.coveragePosture,
        },
        {
          label: "absent branches",
          value: String(
            witness.absentBranchRefs.length,
          ),
        },
        {
          label: "partial branches",
          value: String(
            witness.partialBranchRefs.length,
          ),
        },
        {
          label: "stale bindings",
          value: String(
            witness.staleBindingRefs.length,
          ),
        },
        {
          label: "contradictions",
          value: String(
            witness.contradictionRefs.length,
          ),
        },
      ],
    }];
  }
  if (lens === "D") {
    return [{
      sectionKind: "governance",
      title: "Witness boundary",
      items: [
        {
          label: "standing",
          value:
            "derived descriptive witness",
        },
        {
          label: "semantic validation",
          value: "not performed",
        },
        {
          label: "mutation authority",
          value: "none",
        },
      ],
    }];
  }
  return [{
    sectionKind: "trajectory",
    title: "Realization horizon",
    items: [
      {
        label: "realized branches",
        value:
          `${witness.realizedBranchCount}/${witness.branchCount}`,
      },
      {
        label: "required branches",
        value: String(
          witness.requiredBranchCount,
        ),
      },
      {
        label: "next semantic concern",
        value:
          witness.contradictionRefs.length
            ? "inspect contradictions"
            : witness.staleBindingRefs.length
              ? "refresh stale realization evidence"
              : witness.absentBranchRefs.length
                ? "assess uncovered branches"
                : "coverage is complete",
      },
    ],
  }];
}

function compileCoverageSurface(
  witness,
  input,
) {
  const projectId =
    witness.aroIdentityRef.projectId ||
    "";
  const subjectRef = {
    kind: "aro_coverage_witness",
    id: witness.coverageWitnessId,
    digest: witness.digest,
    ...(projectId ? { projectId } : {}),
  };
  const state = {
    complete: "ready",
    partial: "provisional",
    gapped: "blocked",
    stale: "stale",
    contradicted: "conflicted",
  }[witness.coveragePosture];
  return buildObjectSurface({
    objectClass:
      "aro_coverage_witness",
    subjectRef,
    semanticIdentity:
      `Realization coverage · ${witness.aroIdentityRef.id}`,
    summary:
      `${witness.realizedBranchCount} of ${witness.branchCount} branches are realized.`,
    projectId,
    sourceSemanticEventId: "",
    state,
    defaultLens:
      witness.coveragePosture ===
        "complete"
        ? "O"
        : "E",
    morph: morphForResolver(
      input.registry,
      "aro_coverage_witness.graph",
    ),
    interaction:
      aroReadOnlyInteraction(
        subjectRef,
      ),
    content: witness,
    sectionsForLens: (lens) =>
      coverageLensSections(
        witness,
        lens,
      ),
    promotedObjectRefs: [
      witness.aroIdentityRef,
      ...witness.sourceRevisionRefs,
      ...witness.absentBranchRefs,
      ...witness.partialBranchRefs,
      ...witness.staleBindingRefs,
      ...witness.contradictionRefs,
    ],
    sourceRevisionRefs:
      witness.sourceRevisionRefs,
    expectedSubjectRevision: 1,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: false,
    compactProjection: {
      eyebrow: "ARO coverage",
      title:
        `${witness.coveragePosture} realization`,
      state,
      indicator:
        `${witness.realizedBranchCount}/${witness.branchCount}`,
      actionLabel: "Inspect graph",
    },
  });
}

function comparisonLensSections(
  comparison,
  lens,
) {
  const items = {
    O: [
      [
        "current ARO",
        comparison.currentAroRef.id,
      ],
      [
        "target ARO",
        comparison.targetAroRef.id,
      ],
      [
        "shared branches",
        String(
          comparison.sharedBranchKeys
            .length,
        ),
      ],
    ],
    E: [
      [
        "current coverage",
        comparison.currentCoveragePosture,
      ],
      [
        "target coverage",
        comparison.targetCoveragePosture,
      ],
      [
        "conflicts",
        String(
          comparison.conflictPairs.length,
        ),
      ],
    ],
    D: [
      [
        "standing",
        "descriptive comparison",
      ],
      [
        "implementation obligation",
        "not created",
      ],
      [
        "code mutation",
        "not authorized",
      ],
    ],
    U: [
      [
        "target-only branches",
        String(
          comparison
            .targetOnlyBranchRefs.length,
        ),
      ],
      [
        "current-only branches",
        String(
          comparison
            .currentOnlyBranchRefs.length,
        ),
      ],
      [
        "semantic delta",
        comparison.conflictPairs.length
          ? `${comparison.conflictPairs.length} shared branches differ`
          : "shared branches agree",
      ],
    ],
  }[lens];
  return [{
    sectionKind: {
      O: "comparison",
      E: "evidence",
      D: "governance",
      U: "trajectory",
    }[lens],
    title: {
      O: "Current and target objects",
      E: "Coverage and conflict",
      D: "Comparison boundary",
      U: "Semantic delta",
    }[lens],
    items: items.map(([label, value]) => ({
      label,
      value,
    })),
  }];
}

function compileAroComparisonSurface(
  comparison,
  input,
) {
  const subjectRef = {
    kind:
      "aro_current_target_comparison",
    id: comparison.comparisonId,
    digest: comparison.digest,
    projectId: comparison.projectId,
  };
  const state =
    comparison.conflictPairs.length
      ? "conflicted"
      : comparison
          .targetOnlyBranchRefs.length
        ? "provisional"
        : "ready";
  return buildObjectSurface({
    objectClass:
      "aro_current_target_comparison",
    subjectRef,
    semanticIdentity:
      `${comparison.conceptKey} · current / target`,
    summary:
      `${comparison.sharedBranchKeys.length} shared · ${comparison.targetOnlyBranchRefs.length} target-only · ${comparison.conflictPairs.length} conflicts.`,
    projectId: comparison.projectId,
    sourceSemanticEventId: "",
    state,
    defaultLens: "U",
    morph: morphForResolver(
      input.registry,
      "aro_current_target_comparison.comparison",
    ),
    interaction:
      aroReadOnlyInteraction(
        subjectRef,
      ),
    content: comparison,
    sectionsForLens: (lens) =>
      comparisonLensSections(
        comparison,
        lens,
      ),
    promotedObjectRefs: [
      comparison.currentAroRef,
      comparison.targetAroRef,
      comparison
        .currentCoverageWitnessRef,
      comparison
        .targetCoverageWitnessRef,
      ...comparison
        .currentOnlyBranchRefs,
      ...comparison
        .targetOnlyBranchRefs,
      ...comparison.conflictPairs
        .flatMap((pair) => [
          pair.currentBranchRef,
          pair.targetBranchRef,
        ]),
    ],
    sourceRevisionRefs: [
      comparison.currentAroRef,
      comparison.targetAroRef,
      comparison
        .currentCoverageWitnessRef,
      comparison
        .targetCoverageWitnessRef,
    ],
    expectedSubjectRevision: 1,
    sourceProjectionRevision:
      input.sourceProjectionRevision,
    canonicalObject: false,
    compactProjection: {
      eyebrow: "ARO current / target",
      title: comparison.conceptKey,
      state,
      indicator:
        `${comparison.targetOnlyBranchRefs.length} target-only`,
      actionLabel: "Inspect semantic delta",
    },
  });
}

function surfaceRef(surface) {
  return {
    kind: "semantic_object_surface",
    id:
      surface.semanticObjectSurfaceId,
    digest: surface.digest,
  };
}

function compileSemanticSurfaceProjection(
  input = {},
) {
  const registry = morphResolverRegistry();
  const openDecisions = Array.isArray(
    input.openDecisions,
  )
    ? input.openDecisions
    : [];
  const staleDecisions = Array.isArray(
    input.staleDecisions,
  )
    ? input.staleDecisions
    : [];
  const candidates = Array.isArray(
    input.projectCandidates,
  )
    ? input.projectCandidates
    : [];
  const constitutions = Array.isArray(
    input.projectConstitutions,
  )
    ? input.projectConstitutions
    : [];
  const transitionReceipts =
    Array.isArray(
      input.decisionTransitionReceipts,
    )
      ? input.decisionTransitionReceipts
      : [];
  const aroCandidates = Array.isArray(
    input.aroReconstructionCandidates,
  )
    ? input.aroReconstructionCandidates
    : [];
  const aros = Array.isArray(
    input.abstractReasoningObjects,
  )
    ? input.abstractReasoningObjects
    : [];
  const coverageWitnesses =
    Array.isArray(
      input.aroCoverageWitnesses,
    )
      ? input.aroCoverageWitnesses
      : [];
  const aroComparisons =
    Array.isArray(
      input.aroCurrentTargetComparisons,
    )
      ? input.aroCurrentTargetComparisons
      : [];
  const candidateById = new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const compilerInput = {
    registry,
    candidateById,
    sourceProjectionRevision:
      Number(input.projectionRevision || 0),
  };
  const compiled = [
    ...openDecisions.map((decision) =>
      compileDecisionSurface(
        decision,
        compilerInput,
      )),
    ...staleDecisions.map((decision) =>
      compileDecisionSurface(
        decision,
        compilerInput,
      )),
    ...candidates.map((candidate) =>
      compileCandidateSurface(
        candidate,
        compilerInput,
      )),
    ...constitutions.map((constitution) =>
      compileConstitutionSurface(
        constitution,
        compilerInput,
      )),
    ...transitionReceipts.map((receipt) =>
      compileReceiptSurface(
        receipt,
        compilerInput,
      )),
    ...aroCandidates.map((candidate) =>
      compileAroCandidateSurface(
        candidate,
        compilerInput,
      )),
    ...aros.map((aro) =>
      compileAroSurface(
        aro,
        compilerInput,
      )),
    ...coverageWitnesses.map((witness) =>
      compileCoverageSurface(
        witness,
        compilerInput,
      )),
    ...aroComparisons.map((comparison) =>
      compileAroComparisonSurface(
        comparison,
        compilerInput,
      )),
  ];
  const objectSurfaces = compiled.map(
    (entry) => entry.surface,
  );
  const projectionWitnesses =
    compiled.flatMap(
      (entry) => entry.witnesses,
    );
  const regionBindings =
    compiled.flatMap(
      (entry) => entry.regionBindings,
    );
  const actionableDecisionSurfaces =
    objectSurfaces.filter((surface) =>
      surface.objectClass ===
        "open_decision" &&
      [
        "ready",
        "blocked",
        "conflicted",
        "submitting",
      ].includes(surface.surfaceState));
  const decisionDock = {
    schema:
      "direct_semantic_decision_dock@1",
    decisionDockId: stableId(
      "wm_decision_dock",
      {
        projectionRevision:
          input.projectionRevision,
        decisionSurfaceDigests:
          actionableDecisionSurfaces.map(
            (surface) => surface.digest,
          ),
      },
    ),
    surfaceRefs:
      actionableDecisionSurfaces.map(
        surfaceRef,
      ),
    entries:
      actionableDecisionSurfaces.map(
        (surface) => ({
          surfaceRef:
            surfaceRef(surface),
          subjectRef:
            surface.subjectRef,
          projectId:
            surface.projectId,
          compactProjection:
            surface.compactProjection,
          defaultLens:
            surface.defaultLens,
          grantsAuthority: false,
        }),
      ),
    actionRequiredCount:
      actionableDecisionSurfaces.length,
    canonical: false,
    grantsAuthority: false,
  };
  decisionDock.digest = digestFor(
    decisionDock.schema,
    decisionDock,
    ["digest"],
  );
  const projectIndicators = (
    Array.isArray(input.projects)
      ? input.projects
      : []
  ).map((project) => {
    const surfaces =
      actionableDecisionSurfaces.filter(
        (surface) =>
          surface.projectId ===
            project.projectId,
      );
    const aroSurfaces =
      objectSurfaces.filter((surface) =>
        surface.projectId ===
          project.projectId &&
        [
          "aro_reconstruction_candidate",
          "abstract_reasoning_object",
          "aro_coverage_witness",
          "aro_current_target_comparison",
        ].includes(
          surface.objectClass,
        ));
    const actionableAroSurfaces =
      aroSurfaces.filter((surface) =>
        surface.objectClass ===
          "aro_reconstruction_candidate" &&
        surface.interaction.available);
    const indicator = {
      schema:
        "direct_semantic_project_indicator@1",
      projectId: project.projectId,
      decisionCount: surfaces.length,
      aroSurfaceCount:
        aroSurfaces.length,
      aroActionRequiredCount:
        actionableAroSurfaces.length,
      subjectRefs: surfaces.map(
        (surface) => surface.subjectRef,
      ),
      surfaceRefs: surfaces.map(
        surfaceRef,
      ),
      attentionPosture: surfaces.length
        || actionableAroSurfaces.length
          ? "action_required"
          : aroSurfaces.length
            ? "semantic_model_available"
            : "calm",
      aroSubjectRefs:
        aroSurfaces.map((surface) =>
          surface.subjectRef),
      aroSurfaceRefs:
        aroSurfaces.map(surfaceRef),
      grantsAuthority: false,
    };
    indicator.digest = digestFor(
      indicator.schema,
      indicator,
      ["digest"],
    );
    return indicator;
  });
  const inlineArtifacts = objectSurfaces
    .filter((surface) =>
      Boolean(
        surface.sourceSemanticEventId,
      ))
    .map((surface) => {
      const artifact = {
        schema:
          "direct_inline_semantic_artifact@1",
        inlineSemanticArtifactId:
          stableId(
            "wm_inline_semantic_artifact",
            {
              surfaceRef:
                surfaceRef(surface),
              sourceSemanticEventId:
                surface
                  .sourceSemanticEventId,
            },
          ),
        anchorSemanticEventId:
          surface.sourceSemanticEventId,
        surfaceRef: surfaceRef(surface),
        subjectRef: surface.subjectRef,
        compactProjection:
          surface.compactProjection,
        defaultLens:
          surface.defaultLens,
        canonicalObject:
          surface.canonicalObject,
        grantsAuthority: false,
      };
      artifact.digest = digestFor(
        artifact.schema,
        artifact,
        ["digest"],
      );
      return artifact;
    });
  const projection = {
    schema:
      SEMANTIC_SURFACE_PROJECTION_SCHEMA,
    semanticSurfaceProjectionId: stableId(
      "wm_semantic_surface_projection",
      {
        projectionRevision:
          input.projectionRevision,
        surfaceDigests:
          objectSurfaces.map(
            (surface) => surface.digest,
          ),
        registryDigest: registry.digest,
      },
    ),
    compilerRevision:
      SEMANTIC_SURFACE_COMPILER_REVISION,
    sourceProjectionRevision:
      Number(input.projectionRevision || 0),
    activeProjectId:
      text(input.activeProjectId, ""),
    lensRegistry: {
      schema:
        "direct_semantic_lens_registry@1",
      lenses: ODEU_LENSES.map(
        (lens) => ({
          lens,
          label: {
            O: "Objects",
            E: "Evidence",
            D: "Authority",
            U: "Goals",
          }[lens],
          description: {
            O:
              "Identity, realization, state, and causal structure",
            E:
              "Warrant, provenance, uncertainty, and contradiction",
            D:
              "Rules, obligations, gates, and authority",
            U:
              "Goals, priorities, trade-offs, and trajectories",
          }[lens],
        }),
      ),
      grantsAuthority: false,
    },
    morphResolverRegistryRef: refFor(
      "morph_resolver_registry",
      registry,
      "registryId",
    ),
    morphResolverRegistry: registry,
    objectSurfaces,
    projectionWitnesses,
    regionBindings,
    inlineArtifacts,
    decisionDock,
    projectIndicators,
    sameObjectIdentityPreserved: true,
    suppressedMeansAbsent: false,
    responsiveIdentityInvariant: true,
    uiMintsAuthority: false,
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
  projection.digest = digestFor(
    SEMANTIC_SURFACE_PROJECTION_SCHEMA,
    projection,
    ["digest"],
  );
  validateSemanticSurfaceProjection(
    projection,
  );
  return projection;
}

function validateSemanticLensProjection(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_LENS_PROJECTION_SCHEMA ||
    !text(
      value.semanticLensProjectionId,
      "",
    ) ||
    !ODEU_LENSES.includes(value.lens) ||
    !Array.isArray(
      value.promotedRelationKinds,
    ) ||
    !Array.isArray(
      value.promotedObjectRefs,
    ) ||
    !Array.isArray(
      value.boundarySignals,
    ) ||
    !Array.isArray(
      value.suppressedRelationKinds,
    ) ||
    !Array.isArray(value.sections) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        SEMANTIC_LENS_PROJECTION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_lens_projection_invalid",
    );
  }
  exactRef(
    value.subjectRef,
    "lens.subjectRef",
  );
  return true;
}

function validateSemanticProjectionWitness(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_PROJECTION_WITNESS_SCHEMA ||
    !text(
      value.semanticProjectionWitnessId,
      "",
    ) ||
    !ODEU_LENSES.includes(value.lens) ||
    !Array.isArray(value.promotedRefs) ||
    !Array.isArray(
      value.boundarySignalLenses,
    ) ||
    !Array.isArray(
      value.suppressedRelationKinds,
    ) ||
    !Array.isArray(
      value.selectionReasons,
    ) ||
    !Array.isArray(
      value.sourceRevisionRefs,
    ) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        SEMANTIC_PROJECTION_WITNESS_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_projection_witness_invalid",
    );
  }
  exactRef(
    value.subjectRef,
    "witness.subjectRef",
  );
  exactRef(
    value.profileBindingRef,
    "witness.profileBindingRef",
  );
  value.promotedRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `witness.promotedRefs.${index}`,
      ),
  );
  value.sourceRevisionRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `witness.sourceRevisionRefs.${index}`,
      ),
  );
  return true;
}

function validateSemanticRegionBinding(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_REGION_BINDING_SCHEMA ||
    !text(
      value.semanticRegionBindingId,
      "",
    ) ||
    !text(value.regionId, "") ||
    !ODEU_LENSES.includes(
      value.selectedLens,
    ) ||
    !Array.isArray(
      value.promotedObjectRefs,
    ) ||
    !Array.isArray(
      value.promotedRelationKinds,
    ) ||
    value.bindingPosture !==
      "exact_region_binding" ||
    !Number.isInteger(
      Number(
        value.expectedSubjectRevision,
      ),
    ) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        SEMANTIC_REGION_BINDING_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_region_binding_invalid",
    );
  }
  exactRef(
    value.subjectRef,
    "region.subjectRef",
  );
  exactRef(
    value.surfaceProjectionRef,
    "region.surfaceProjectionRef",
  );
  exactRef(
    value.interactionContractRef,
    "region.interactionContractRef",
  );
  return true;
}

function validateSemanticObjectSurface(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_OBJECT_SURFACE_SCHEMA ||
    !text(
      value.semanticObjectSurfaceId,
      "",
    ) ||
    !text(value.objectClass, "") ||
    !text(value.semanticIdentity, "") ||
    !SURFACE_STATES.has(
      value.surfaceState,
    ) ||
    !ODEU_LENSES.includes(
      value.defaultLens,
    ) ||
    JSON.stringify(
      value.availableLenses,
    ) !== JSON.stringify(
      ODEU_LENSES,
    ) ||
    !Array.isArray(
      value.lensProjections,
    ) ||
    value.lensProjections.length !== 4 ||
    !Array.isArray(
      value.regionBindings,
    ) ||
    value.regionBindings.length !== 4 ||
    !MORPH_FAMILIES.has(
      value.morph?.family,
    ) ||
    !isPlainObject(
      value.interaction,
    ) ||
    value.uiMintsAuthority !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        SEMANTIC_OBJECT_SURFACE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_object_surface_invalid",
      value?.semanticObjectSurfaceId,
    );
  }
  exactRef(
    value.subjectRef,
    "surface.subjectRef",
  );
  value.lensProjections.forEach(
    validateSemanticLensProjection,
  );
  if (
    value.interaction
      .executionAuthorityGranted !==
        false ||
    value.interaction
      .downstreamEffectsExecuted !==
        false ||
    value.interaction.grantsAuthority !==
      false
  ) {
    fail(
      "semantic_object_surface_authority_inflation",
    );
  }
  return true;
}

function validateSemanticSurfaceProjection(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      SEMANTIC_SURFACE_PROJECTION_SCHEMA ||
    !text(
      value.semanticSurfaceProjectionId,
      "",
    ) ||
    value.compilerRevision !==
      SEMANTIC_SURFACE_COMPILER_REVISION ||
    !Array.isArray(
      value.objectSurfaces,
    ) ||
    !Array.isArray(
      value.projectionWitnesses,
    ) ||
    !Array.isArray(
      value.regionBindings,
    ) ||
    !Array.isArray(
      value.inlineArtifacts,
    ) ||
    !Array.isArray(
      value.projectIndicators,
    ) ||
    value.decisionDock
      ?.actionRequiredCount !==
      value.decisionDock
        ?.entries?.length ||
    value.sameObjectIdentityPreserved !==
      true ||
    value.suppressedMeansAbsent !== false ||
    value.responsiveIdentityInvariant !==
      true ||
    value.uiMintsAuthority !== false ||
    value.canonicalWorldstateMutation !==
      false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        SEMANTIC_SURFACE_PROJECTION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "semantic_surface_projection_invalid",
    );
  }
  validateMorphResolverRegistry(
    value.morphResolverRegistry,
  );
  value.objectSurfaces.forEach(
    validateSemanticObjectSurface,
  );
  value.projectionWitnesses.forEach(
    validateSemanticProjectionWitness,
  );
  value.regionBindings.forEach(
    validateSemanticRegionBinding,
  );
  const surfaceByRef = new Map(
    value.objectSurfaces.map((surface) => [
      `${surface.semanticObjectSurfaceId}:${surface.digest}`,
      surface,
    ]),
  );
  const witnessByRef = new Map(
    value.projectionWitnesses.map(
      (witness) => [
        `${witness.semanticProjectionWitnessId}:${witness.digest}`,
        witness,
      ],
    ),
  );
  const bindingByRef = new Map(
    value.regionBindings.map(
      (binding) => [
        `${binding.semanticRegionBindingId}:${binding.digest}`,
        binding,
      ],
    ),
  );
  if (
    value.projectionWitnesses.length !==
      value.objectSurfaces.length * 4 ||
    value.regionBindings.length !==
      value.objectSurfaces.length * 4
  ) {
    fail(
      "semantic_surface_compiled_lineage_count_mismatch",
    );
  }
  for (
    const surface of value.objectSurfaces
  ) {
    for (
      const entry of
        surface.projectionWitnesses
    ) {
      const witness = witnessByRef.get(
        `${entry.witnessRef.id}:${entry.witnessRef.digest}`,
      );
      if (
        !witness ||
        witness.lens !== entry.lens ||
        witness.subjectRef.id !==
          surface.subjectRef.id ||
        witness.subjectRef.digest !==
          surface.subjectRef.digest
      ) {
        fail(
          "semantic_surface_witness_identity_mismatch",
        );
      }
    }
    for (
      const entry of
        surface.regionBindings
    ) {
      const binding = bindingByRef.get(
        `${entry.bindingRef.id}:${entry.bindingRef.digest}`,
      );
      if (
        !binding ||
        binding.selectedLens !==
          entry.lens ||
        binding.subjectRef.id !==
          surface.subjectRef.id ||
        binding.subjectRef.digest !==
          surface.subjectRef.digest ||
        binding.surfaceProjectionRef.id !==
          surface.semanticObjectSurfaceId ||
        binding.surfaceProjectionRef.digest !==
          surface.surfaceIdentityDigest
      ) {
        fail(
          "semantic_surface_region_identity_mismatch",
        );
      }
    }
  }
  for (const entry of [
    ...value.decisionDock.entries,
    ...value.inlineArtifacts,
  ]) {
    if (
      !surfaceByRef.has(
        `${entry.surfaceRef.id}:${entry.surfaceRef.digest}`,
      )
    ) {
      fail(
        "semantic_surface_cross_projection_identity_mismatch",
      );
    }
  }
  for (
    const artifact of
      value.inlineArtifacts
  ) {
    const surface = surfaceByRef.get(
      `${artifact.surfaceRef.id}:${artifact.surfaceRef.digest}`,
    );
    if (
      artifact.schema !==
        "direct_inline_semantic_artifact@1" ||
      !text(
        artifact
          .inlineSemanticArtifactId,
        "",
      ) ||
      !text(
        artifact.anchorSemanticEventId,
        "",
      ) ||
      artifact.grantsAuthority !==
        false ||
      artifact.digest !==
        digestFor(
          artifact.schema,
          artifact,
          ["digest"],
        ) ||
      !surface ||
      artifact.subjectRef.id !==
        surface.subjectRef.id ||
      artifact.subjectRef.digest !==
        surface.subjectRef.digest
    ) {
      fail(
        "semantic_inline_artifact_invalid",
      );
    }
  }
  if (
    value.decisionDock.schema !==
      "direct_semantic_decision_dock@1" ||
    value.decisionDock.grantsAuthority !==
      false ||
    value.decisionDock.digest !==
      digestFor(
        value.decisionDock.schema,
        value.decisionDock,
        ["digest"],
      )
  ) {
    fail("semantic_decision_dock_invalid");
  }
  for (
    const indicator of
      value.projectIndicators
  ) {
    if (
      indicator.schema !==
        "direct_semantic_project_indicator@1" ||
      indicator.grantsAuthority !== false ||
      indicator.decisionCount !==
        indicator.subjectRefs.length ||
      indicator.decisionCount !==
        indicator.surfaceRefs.length ||
      !Array.isArray(
        indicator.aroSubjectRefs,
      ) ||
      !Array.isArray(
        indicator.aroSurfaceRefs,
      ) ||
      indicator.aroSurfaceCount !==
        indicator.aroSubjectRefs.length ||
      indicator.aroSurfaceCount !==
        indicator.aroSurfaceRefs.length ||
      indicator.aroActionRequiredCount >
        indicator.aroSurfaceCount ||
      indicator.digest !==
        digestFor(
          indicator.schema,
          indicator,
          ["digest"],
        )
    ) {
      fail(
        "semantic_project_indicator_invalid",
      );
    }
    indicator.surfaceRefs.forEach(
      (ref) => {
        if (
          !surfaceByRef.has(
            `${ref.id}:${ref.digest}`,
          )
        ) {
          fail(
            "semantic_project_indicator_surface_missing",
          );
        }
      },
    );
    indicator.aroSurfaceRefs.forEach(
      (ref) => {
        if (
          !surfaceByRef.has(
            `${ref.id}:${ref.digest}`,
          )
        ) {
          fail(
            "semantic_project_indicator_aro_surface_missing",
          );
        }
      },
    );
  }
  return true;
}

module.exports = {
  MORPH_RESOLVER_REGISTRY_SCHEMA,
  SEMANTIC_LENS_PROJECTION_SCHEMA,
  SEMANTIC_OBJECT_SURFACE_SCHEMA,
  SEMANTIC_PROJECTION_WITNESS_SCHEMA,
  SEMANTIC_REGION_BINDING_SCHEMA,
  SEMANTIC_SURFACE_COMPILER_REVISION,
  SEMANTIC_SURFACE_PROJECTION_SCHEMA,
  compileSemanticSurfaceProjection,
  morphResolverRegistry,
  validateMorphResolverRegistry,
  validateSemanticLensProjection,
  validateSemanticObjectSurface,
  validateSemanticProjectionWitness,
  validateSemanticRegionBinding,
  validateSemanticSurfaceProjection,
};
