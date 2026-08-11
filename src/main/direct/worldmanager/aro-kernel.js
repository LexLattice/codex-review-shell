"use strict";

const crypto = require("node:crypto");

function stableValue(value, omittedFields = new Set()) {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stableValue(entry, omittedFields));
  }
  if (
    !value ||
    typeof value !== "object"
  ) {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (
        omittedFields.has(key) ||
        typeof value[key] ===
          "undefined"
      ) {
        return output;
      }
      output[key] = stableValue(
        value[key],
        omittedFields,
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

function stableId(
  prefix,
  value,
  length = 24,
) {
  return `${prefix}_${digestFor(
    `${prefix}@1`,
    value,
  ).slice(7, 7 + length)}`;
}

const ABSTRACT_REASONING_OBJECT_SCHEMA =
  "direct_abstract_reasoning_object@1";
const ARO_BRANCH_SCHEMA =
  "direct_aro_branch@1";
const ARO_EDGE_SCHEMA =
  "direct_aro_edge@1";
const ARO_REALIZATION_BINDING_SCHEMA =
  "direct_aro_realization_binding@1";
const ARO_COVERAGE_WITNESS_SCHEMA =
  "direct_aro_coverage_witness@1";
const ARO_RECONSTRUCTION_CANDIDATE_SCHEMA =
  "direct_aro_reconstruction_candidate@1";
const ARO_REVIEW_RECEIPT_SCHEMA =
  "direct_aro_reconstruction_review_receipt@1";
const ARO_ADMISSION_RECEIPT_SCHEMA =
  "direct_aro_admission_receipt@1";
const ARO_CURRENT_TARGET_COMPARISON_SCHEMA =
  "direct_aro_current_target_comparison@1";

const ARO_POSTURES = new Set([
  "current",
  "target",
]);
const ARO_LIFECYCLES = new Set([
  "candidate",
  "active",
  "stale",
  "conflicted",
  "superseded",
]);
const ARO_BRANCH_MODALITIES = new Set([
  "required",
  "possible",
  "counterfactual",
]);
const ARO_BRANCH_STATES = new Set([
  "supported",
  "missing",
  "contradicted",
  "unknown",
]);
const ARO_EDGE_RELATIONS = new Set([
  "requires",
  "excludes",
  "causes",
  "refines",
  "alternative_to",
  "counterfactual_of",
]);
const ARO_REALIZATION_KINDS = new Set([
  "source",
  "test",
  "documentation",
  "runtime_witness",
]);
const ARO_COVERAGE_STATES = new Set([
  "realized",
  "partial",
  "absent",
  "stale",
  "contradicted",
]);
const ARO_REVIEW_STATES = new Set([
  "pending",
  "reviewed",
]);
const ARO_CANDIDATE_LIFECYCLES =
  new Set([
    "candidate",
    "admitted",
    "rejected",
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

function bounded(
  value,
  fallback = "",
  max = 1_200,
) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source
        .slice(
          0,
          Math.max(0, max - 1),
        )
        .trimEnd()}…`
    : source;
}

function nowIso(now = Date.now) {
  const value =
    typeof now === "function"
      ? now()
      : now;
  return new Date(
    Number(value) || Date.now(),
  ).toISOString();
}

function exactRef(
  value = {},
  label = "ref",
) {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (
    !ref.kind ||
    !ref.id ||
    !ref.digest
  ) {
    fail("aro_exact_ref_invalid", label);
  }
  const refLabel = text(value.label, "");
  if (refLabel) {
    ref.label = bounded(
      refLabel,
      "",
      240,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) {
    ref.projectId = projectId;
  }
  return ref;
}

function uniqueRefs(values = []) {
  const seen = new Set();
  return (
    Array.isArray(values) ? values : []
  )
    .map((value, index) =>
      exactRef(
        value,
        `refs.${index}`,
      ))
    .filter((ref) => {
      const key =
        `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function aroIdentityDigest(input = {}) {
  return digestFor(
    "direct_aro_identity@1",
    {
      aroId: input.aroId,
      projectId: input.projectId,
      conceptKey: input.conceptKey,
      posture: input.posture,
    },
  );
}

function branchRef(branch) {
  return exactRef({
    kind: "aro_branch",
    id: branch.branchId,
    digest: branch.digest,
  });
}

function realizationBindingRef(binding) {
  return exactRef({
    kind: "aro_realization_binding",
    id:
      binding.realizationBindingId,
    digest: binding.digest,
  });
}

function abstractReasoningObjectRef(aro) {
  return exactRef({
    kind:
      "abstract_reasoning_object",
    id: aro.aroId,
    digest: aro.digest,
    projectId: aro.projectId,
  });
}

function aroReconstructionCandidateRef(
  candidate,
) {
  return exactRef({
    kind:
      "aro_reconstruction_candidate",
    id: candidate.candidateId,
    digest: candidate.digest,
    projectId: candidate.projectId,
  });
}

function coverageWitnessRef(witness) {
  return exactRef({
    kind: "aro_coverage_witness",
    id: witness.coverageWitnessId,
    digest: witness.digest,
  });
}

function buildAroBranch(
  input = {},
  context = {},
) {
  const branchKey = text(
    input.branchKey ||
      input.key ||
      input.branchId,
    "",
  );
  const modality = text(
    input.modality,
    "required",
  );
  const semanticState = text(
    input.semanticState ||
      input.state,
    "unknown",
  );
  if (
    !branchKey ||
    !ARO_BRANCH_MODALITIES.has(
      modality,
    ) ||
    !ARO_BRANCH_STATES.has(
      semanticState,
    )
  ) {
    fail("aro_branch_invalid");
  }
  const branchId = text(
    input.branchId,
    stableId("wm_aro_branch", {
      aroId: context.aroId,
      branchKey,
    }),
  );
  const parentBranchKey = text(
    input.parentBranchKey,
    "",
  );
  const parentBranch =
    parentBranchKey
      ? context.branchByKey?.get(
          parentBranchKey,
        )
      : null;
  if (
    parentBranchKey &&
    !parentBranch
  ) {
    fail(
      "aro_branch_parent_unavailable",
      parentBranchKey,
    );
  }
  const branch = {
    schema: ARO_BRANCH_SCHEMA,
    branchId,
    branchKey,
    branchKind: text(
      input.branchKind,
      "semantic_requirement",
    ),
    modality,
    statement: bounded(
      input.statement,
      branchKey,
      1_200,
    ),
    condition: bounded(
      input.condition,
      "",
      800,
    ),
    expectedOutcome: bounded(
      input.expectedOutcome,
      "",
      800,
    ),
    semanticState,
    parentBranchRef: parentBranch
      ? branchRef(parentBranch)
      : null,
    provenanceRefs: uniqueRefs(
      input.provenanceRefs,
    ),
    grantsAuthority: false,
  };
  branch.digest = digestFor(
    ARO_BRANCH_SCHEMA,
    branch,
    ["digest"],
  );
  validateAroBranch(branch);
  return branch;
}

function validateAroBranch(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== ARO_BRANCH_SCHEMA ||
    !text(value.branchId, "") ||
    !text(value.branchKey, "") ||
    !text(value.branchKind, "") ||
    !ARO_BRANCH_MODALITIES.has(
      value.modality,
    ) ||
    !text(value.statement, "") ||
    !ARO_BRANCH_STATES.has(
      value.semanticState,
    ) ||
    !Array.isArray(
      value.provenanceRefs,
    ) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_BRANCH_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("aro_branch_invalid");
  }
  if (value.parentBranchRef) {
    exactRef(
      value.parentBranchRef,
      "aroBranch.parentBranchRef",
    );
  }
  value.provenanceRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aroBranch.provenanceRefs.${index}`,
      ),
  );
  return true;
}

function buildAroEdge(
  input = {},
  context = {},
) {
  const fromBranch =
    context.branchByKey?.get(
      text(
        input.fromBranchKey ||
          input.from,
        "",
      ),
    );
  const toBranch =
    context.branchByKey?.get(
      text(
        input.toBranchKey ||
          input.to,
        "",
      ),
    );
  const relationKind = text(
    input.relationKind,
    "",
  );
  if (
    !fromBranch ||
    !toBranch ||
    !ARO_EDGE_RELATIONS.has(
      relationKind,
    )
  ) {
    fail("aro_edge_invalid");
  }
  const edge = {
    schema: ARO_EDGE_SCHEMA,
    edgeId: text(
      input.edgeId,
      stableId("wm_aro_edge", {
        aroId: context.aroId,
        fromBranchId:
          fromBranch.branchId,
        toBranchId: toBranch.branchId,
        relationKind,
      }),
    ),
    fromBranchRef:
      branchRef(fromBranch),
    toBranchRef: branchRef(toBranch),
    relationKind,
    rationale: bounded(
      input.rationale,
      "",
      800,
    ),
    grantsAuthority: false,
  };
  edge.digest = digestFor(
    ARO_EDGE_SCHEMA,
    edge,
    ["digest"],
  );
  validateAroEdge(edge);
  return edge;
}

function validateAroEdge(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== ARO_EDGE_SCHEMA ||
    !text(value.edgeId, "") ||
    !ARO_EDGE_RELATIONS.has(
      value.relationKind,
    ) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_EDGE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("aro_edge_invalid");
  }
  exactRef(
    value.fromBranchRef,
    "aroEdge.fromBranchRef",
  );
  exactRef(
    value.toBranchRef,
    "aroEdge.toBranchRef",
  );
  return true;
}

function buildAroRealizationBinding(
  input = {},
  context = {},
) {
  const branch =
    context.branchByKey?.get(
      text(input.branchKey, ""),
    );
  const realizationKind = text(
    input.realizationKind,
    "",
  );
  const coverageState = text(
    input.coverageState,
    "absent",
  );
  if (
    !branch ||
    !ARO_REALIZATION_KINDS.has(
      realizationKind,
    ) ||
    !ARO_COVERAGE_STATES.has(
      coverageState,
    )
  ) {
    fail(
      "aro_realization_binding_invalid",
    );
  }
  const sourceRef = exactRef(
    input.sourceRef,
    "aroRealization.sourceRef",
  );
  const binding = {
    schema:
      ARO_REALIZATION_BINDING_SCHEMA,
    realizationBindingId: text(
      input.realizationBindingId,
      stableId(
        "wm_aro_realization_binding",
        {
          aroId: context.aroId,
          branchId: branch.branchId,
          realizationKind,
          locator: input.locator,
          sourceRef,
        },
      ),
    ),
    branchRef: branchRef(branch),
    realizationKind,
    locator: bounded(
      input.locator,
      sourceRef.id,
      1_000,
    ),
    sourceRef,
    coverageState,
    evidenceRefs: uniqueRefs(
      input.evidenceRefs,
    ),
    observedRevisionRef:
      input.observedRevisionRef
        ? exactRef(
            input.observedRevisionRef,
            "aroRealization.observedRevisionRef",
          )
        : null,
    grantsAuthority: false,
  };
  binding.digest = digestFor(
    ARO_REALIZATION_BINDING_SCHEMA,
    binding,
    ["digest"],
  );
  validateAroRealizationBinding(
    binding,
  );
  return binding;
}

function validateAroRealizationBinding(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_REALIZATION_BINDING_SCHEMA ||
    !text(
      value.realizationBindingId,
      "",
    ) ||
    !ARO_REALIZATION_KINDS.has(
      value.realizationKind,
    ) ||
    !text(value.locator, "") ||
    !ARO_COVERAGE_STATES.has(
      value.coverageState,
    ) ||
    !Array.isArray(value.evidenceRefs) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_REALIZATION_BINDING_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "aro_realization_binding_invalid",
    );
  }
  exactRef(
    value.branchRef,
    "aroRealization.branchRef",
  );
  exactRef(
    value.sourceRef,
    "aroRealization.sourceRef",
  );
  value.evidenceRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aroRealization.evidenceRefs.${index}`,
      ),
  );
  if (value.observedRevisionRef) {
    exactRef(
      value.observedRevisionRef,
      "aroRealization.observedRevisionRef",
    );
  }
  return true;
}

function coverageStateForBranch(
  branch,
  bindings,
) {
  const states = new Set(
    bindings.map(
      (binding) =>
        binding.coverageState,
    ),
  );
  if (states.has("contradicted")) {
    return "contradicted";
  }
  if (states.has("realized")) {
    return states.size === 1
      ? "realized"
      : "partial";
  }
  if (states.has("partial")) {
    return "partial";
  }
  if (states.has("stale")) {
    return "stale";
  }
  return branch.semanticState ===
    "supported"
    ? "partial"
    : "absent";
}

function buildAroCoverageWitness(
  input = {},
) {
  const branches = input.branches || [];
  const bindings =
    input.realizationBindings || [];
  const branchCoverage = branches.map(
    (branch) => {
      const branchBindings =
        bindings.filter((binding) =>
          binding.branchRef.id ===
            branch.branchId);
      return {
        branch,
        bindings: branchBindings,
        coverageState:
          coverageStateForBranch(
            branch,
            branchBindings,
          ),
      };
    },
  );
  const absentBranchRefs =
    branchCoverage
      .filter((entry) =>
        entry.coverageState ===
          "absent")
      .map((entry) =>
        branchRef(entry.branch));
  const partialBranchRefs =
    branchCoverage
      .filter((entry) =>
        entry.coverageState ===
          "partial")
      .map((entry) =>
        branchRef(entry.branch));
  const staleBindingRefs =
    bindings
      .filter((binding) =>
        binding.coverageState ===
          "stale")
      .map(realizationBindingRef);
  const contradictionRefs = [
    ...branchCoverage
      .filter((entry) =>
        entry.coverageState ===
          "contradicted" ||
        entry.branch.semanticState ===
          "contradicted")
      .map((entry) =>
        branchRef(entry.branch)),
    ...bindings
      .filter((binding) =>
        binding.coverageState ===
          "contradicted")
      .map(realizationBindingRef),
  ];
  const realizedBranchCount =
    branchCoverage.filter((entry) =>
      entry.coverageState ===
        "realized").length;
  const witness = {
    schema:
      ARO_COVERAGE_WITNESS_SCHEMA,
    coverageWitnessId: stableId(
      "wm_aro_coverage_witness",
      {
        aroId: input.aroId,
        branchDigests: branches.map(
          (branch) => branch.digest,
        ),
        bindingDigests: bindings.map(
          (binding) =>
            binding.digest,
        ),
      },
    ),
    aroIdentityRef: exactRef({
      kind: "aro_identity",
      id: input.aroId,
      digest:
        input.aroIdentityDigest,
      projectId: input.projectId,
    }),
    branchCount: branches.length,
    requiredBranchCount:
      branches.filter((branch) =>
        branch.modality === "required")
        .length,
    realizedBranchCount,
    partialBranchCount:
      partialBranchRefs.length,
    absentBranchRefs,
    partialBranchRefs,
    staleBindingRefs,
    contradictionRefs,
    branchCoverage:
      branchCoverage.map((entry) => ({
        branchRef:
          branchRef(entry.branch),
        coverageState:
          entry.coverageState,
        realizationBindingRefs:
          entry.bindings.map(
            realizationBindingRef,
          ),
        grantsAuthority: false,
      })),
    coveragePosture:
      contradictionRefs.length
        ? "contradicted"
        : staleBindingRefs.length
          ? "stale"
          : absentBranchRefs.length
            ? "gapped"
            : partialBranchRefs.length
              ? "partial"
              : "complete",
    sourceRevisionRefs: uniqueRefs([
      ...(input.provenanceRefs || []),
      ...bindings.map(
        (binding) =>
          binding.sourceRef,
      ),
      ...bindings.flatMap(
        (binding) =>
          binding.evidenceRefs,
      ),
    ]),
    canonical: false,
    grantsAuthority: false,
  };
  witness.digest = digestFor(
    ARO_COVERAGE_WITNESS_SCHEMA,
    witness,
    ["digest"],
  );
  validateAroCoverageWitness(
    witness,
  );
  return witness;
}

function validateAroCoverageWitness(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_COVERAGE_WITNESS_SCHEMA ||
    !text(
      value.coverageWitnessId,
      "",
    ) ||
    !Number.isInteger(
      Number(value.branchCount),
    ) ||
    !Number.isInteger(
      Number(
        value.requiredBranchCount,
      ),
    ) ||
    !Array.isArray(
      value.absentBranchRefs,
    ) ||
    !Array.isArray(
      value.partialBranchRefs,
    ) ||
    !Array.isArray(
      value.staleBindingRefs,
    ) ||
    !Array.isArray(
      value.contradictionRefs,
    ) ||
    !Array.isArray(
      value.branchCoverage,
    ) ||
    ![
      "complete",
      "partial",
      "gapped",
      "stale",
      "contradicted",
    ].includes(value.coveragePosture) ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_COVERAGE_WITNESS_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "aro_coverage_witness_invalid",
    );
  }
  exactRef(
    value.aroIdentityRef,
    "aroCoverage.aroIdentityRef",
  );
  for (
    const refs of [
      value.absentBranchRefs,
      value.partialBranchRefs,
      value.staleBindingRefs,
      value.contradictionRefs,
      value.sourceRevisionRefs,
    ]
  ) {
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `aroCoverage.refs.${index}`,
      ));
  }
  value.branchCoverage.forEach(
    (entry) => {
      exactRef(
        entry.branchRef,
        "aroCoverage.branchRef",
      );
      entry.realizationBindingRefs
        .forEach((ref, index) =>
          exactRef(
            ref,
            `aroCoverage.realizationBindingRefs.${index}`,
          ));
      if (
        !ARO_COVERAGE_STATES.has(
          entry.coverageState,
        ) ||
        entry.grantsAuthority !==
          false
      ) {
        fail(
          "aro_coverage_entry_invalid",
        );
      }
    },
  );
  return true;
}

function buildAbstractReasoningObject(
  input = {},
) {
  const projectId = text(
    input.projectId,
    "",
  );
  const conceptKey = text(
    input.conceptKey,
    "",
  );
  const posture = text(
    input.posture,
    "",
  );
  const revision = Number(
    input.revision || 1,
  );
  const lifecycle = text(
    input.lifecycle,
    input.canonical === true
      ? "active"
      : "candidate",
  );
  if (
    !projectId ||
    !conceptKey ||
    !ARO_POSTURES.has(posture) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    !ARO_LIFECYCLES.has(lifecycle)
  ) {
    fail(
      "abstract_reasoning_object_invalid",
    );
  }
  const aroId = text(
    input.aroId,
    stableId(
      "wm_abstract_reasoning_object",
      {
        projectId,
        conceptKey,
        posture,
      },
    ),
  );
  const identityDigest =
    aroIdentityDigest({
      aroId,
      projectId,
      conceptKey,
      posture,
    });
  const branchByKey = new Map();
  const branches = (
    Array.isArray(input.branches)
      ? input.branches
      : []
  ).map((branchInput) => {
    const branch = buildAroBranch(
      branchInput,
      {
        aroId,
        branchByKey,
      },
    );
    if (
      branchByKey.has(branch.branchKey)
    ) {
      fail(
        "aro_branch_key_duplicate",
        branch.branchKey,
      );
    }
    branchByKey.set(
      branch.branchKey,
      branch,
    );
    return branch;
  });
  if (!branches.length) {
    fail(
      "abstract_reasoning_object_branches_required",
    );
  }
  const edges = (
    Array.isArray(input.edges)
      ? input.edges
      : []
  ).map((edgeInput) =>
    buildAroEdge(edgeInput, {
      aroId,
      branchByKey,
    }));
  const realizationBindings = (
    Array.isArray(
      input.realizationBindings,
    )
      ? input.realizationBindings
      : []
  ).map((bindingInput) =>
    buildAroRealizationBinding(
      bindingInput,
      {
        aroId,
        branchByKey,
      },
    ));
  const provenanceRefs = uniqueRefs(
    input.provenanceRefs,
  );
  const coverageWitness =
    buildAroCoverageWitness({
      aroId,
      aroIdentityDigest:
        identityDigest,
      projectId,
      branches,
      realizationBindings,
      provenanceRefs,
    });
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "aro.predecessorRef",
        )
      : null;
  if (
    (revision === 1) ===
    Boolean(predecessorRef)
  ) {
    fail(
      "aro_revision_lineage_invalid",
    );
  }
  const aro = {
    schema:
      ABSTRACT_REASONING_OBJECT_SCHEMA,
    aroId,
    aroIdentityDigest:
      identityDigest,
    projectId,
    conceptKey,
    semanticIdentity: bounded(
      input.semanticIdentity,
      conceptKey,
      300,
    ),
    purpose: bounded(
      input.purpose,
      "",
      1_200,
    ),
    posture,
    revision,
    lifecycle,
    predecessorRef,
    branches,
    edges,
    realizationBindings,
    coverageWitness,
    coverageWitnessRef:
      coverageWitnessRef(
        coverageWitness,
      ),
    counterpartRef:
      input.counterpartRef
        ? exactRef(
            input.counterpartRef,
            "aro.counterpartRef",
          )
        : null,
    admittedFromCandidateRef:
      input.admittedFromCandidateRef
        ? exactRef(
            input.admittedFromCandidateRef,
            "aro.admittedFromCandidateRef",
          )
        : null,
    provenanceRefs,
    canonical:
      input.canonical === true,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  aro.digest = digestFor(
    ABSTRACT_REASONING_OBJECT_SCHEMA,
    aro,
    ["digest"],
  );
  validateAbstractReasoningObject(
    aro,
  );
  return aro;
}

function validateAbstractReasoningObject(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ABSTRACT_REASONING_OBJECT_SCHEMA ||
    !text(value.aroId, "") ||
    !text(value.aroIdentityDigest, "") ||
    !text(value.projectId, "") ||
    !text(value.conceptKey, "") ||
    !text(value.semanticIdentity, "") ||
    !ARO_POSTURES.has(value.posture) ||
    !Number.isInteger(
      Number(value.revision),
    ) ||
    Number(value.revision) < 1 ||
    !ARO_LIFECYCLES.has(
      value.lifecycle,
    ) ||
    !Array.isArray(value.branches) ||
    !value.branches.length ||
    !Array.isArray(value.edges) ||
    !Array.isArray(
      value.realizationBindings,
    ) ||
    !Array.isArray(
      value.provenanceRefs,
    ) ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ABSTRACT_REASONING_OBJECT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "abstract_reasoning_object_invalid",
    );
  }
  if (
    value.aroIdentityDigest !==
      aroIdentityDigest(value)
  ) {
    fail(
      "aro_identity_digest_mismatch",
    );
  }
  if (
    value.canonical === true &&
    value.lifecycle === "candidate"
  ) {
    fail(
      "aro_candidate_canonical_invalid",
    );
  }
  if (
    (Number(value.revision) === 1) ===
    Boolean(value.predecessorRef)
  ) {
    fail(
      "aro_revision_lineage_invalid",
    );
  }
  value.branches.forEach(
    validateAroBranch,
  );
  value.edges.forEach(
    validateAroEdge,
  );
  value.realizationBindings.forEach(
    validateAroRealizationBinding,
  );
  validateAroCoverageWitness(
    value.coverageWitness,
  );
  const branchRefs = new Set(
    value.branches.map((branch) =>
      `${branch.branchId}:${branch.digest}`),
  );
  for (const edge of value.edges) {
    if (
      !branchRefs.has(
        `${edge.fromBranchRef.id}:${edge.fromBranchRef.digest}`,
      ) ||
      !branchRefs.has(
        `${edge.toBranchRef.id}:${edge.toBranchRef.digest}`,
      )
    ) {
      fail(
        "aro_edge_branch_identity_mismatch",
      );
    }
  }
  for (
    const binding of
      value.realizationBindings
  ) {
    if (
      !branchRefs.has(
        `${binding.branchRef.id}:${binding.branchRef.digest}`,
      )
    ) {
      fail(
        "aro_realization_branch_identity_mismatch",
      );
    }
  }
  exactRef(
    value.coverageWitnessRef,
    "aro.coverageWitnessRef",
  );
  if (
    value.coverageWitnessRef.id !==
      value.coverageWitness
        .coverageWitnessId ||
    value.coverageWitnessRef.digest !==
      value.coverageWitness.digest
  ) {
    fail(
      "aro_coverage_ref_mismatch",
    );
  }
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "aro.predecessorRef",
    );
  }
  if (value.counterpartRef) {
    exactRef(
      value.counterpartRef,
      "aro.counterpartRef",
    );
  }
  if (
    value.admittedFromCandidateRef
  ) {
    exactRef(
      value.admittedFromCandidateRef,
      "aro.admittedFromCandidateRef",
    );
  }
  value.provenanceRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aro.provenanceRefs.${index}`,
      ),
  );
  return true;
}

function aroInputFromExisting(
  aro,
  overrides = {},
) {
  return {
    aroId: aro.aroId,
    projectId: aro.projectId,
    conceptKey: aro.conceptKey,
    semanticIdentity:
      aro.semanticIdentity,
    purpose: aro.purpose,
    posture: aro.posture,
    revision: aro.revision,
    lifecycle: aro.lifecycle,
    predecessorRef:
      aro.predecessorRef,
    branches: aro.branches.map(
      (branch) => ({
        branchId: branch.branchId,
        branchKey: branch.branchKey,
        branchKind: branch.branchKind,
        modality: branch.modality,
        statement: branch.statement,
        condition: branch.condition,
        expectedOutcome:
          branch.expectedOutcome,
        semanticState:
          branch.semanticState,
        parentBranchKey:
          branch.parentBranchRef
            ? aro.branches.find(
                (candidate) =>
                  candidate.branchId ===
                  branch
                    .parentBranchRef.id,
              )?.branchKey || ""
            : "",
        provenanceRefs:
          branch.provenanceRefs,
      }),
    ),
    edges: aro.edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromBranchKey:
        aro.branches.find(
          (branch) =>
            branch.branchId ===
              edge.fromBranchRef.id,
        )?.branchKey,
      toBranchKey:
        aro.branches.find(
          (branch) =>
            branch.branchId ===
              edge.toBranchRef.id,
        )?.branchKey,
      relationKind: edge.relationKind,
      rationale: edge.rationale,
    })),
    realizationBindings:
      aro.realizationBindings.map(
        (binding) => ({
          realizationBindingId:
            binding
              .realizationBindingId,
          branchKey:
            aro.branches.find(
              (branch) =>
                branch.branchId ===
                  binding
                    .branchRef.id,
            )?.branchKey,
          realizationKind:
            binding.realizationKind,
          locator: binding.locator,
          sourceRef:
            binding.sourceRef,
          coverageState:
            binding.coverageState,
          evidenceRefs:
            binding.evidenceRefs,
          observedRevisionRef:
            binding
              .observedRevisionRef,
        }),
      ),
    counterpartRef: aro.counterpartRef,
    admittedFromCandidateRef:
      aro.admittedFromCandidateRef,
    provenanceRefs: aro.provenanceRefs,
    canonical: aro.canonical,
    createdAt: aro.createdAt,
    ...overrides,
  };
}

function buildAroReconstructionCandidate(
  input = {},
) {
  const repositorySnapshotRef =
    exactRef(
      input.repositorySnapshotRef,
      "aroCandidate.repositorySnapshotRef",
    );
  const candidateAro =
    buildAbstractReasoningObject({
      ...(input.candidateAro || input.aro),
      projectId:
        input.projectId ||
        input.candidateAro?.projectId ||
        input.aro?.projectId,
      lifecycle: "candidate",
      canonical: false,
      revision:
        input.candidateAro?.revision ||
        input.aro?.revision ||
        1,
      now: input.now,
    });
  const candidateId = text(
    input.candidateId,
    stableId(
      "wm_aro_reconstruction_candidate",
      {
        projectId:
          candidateAro.projectId,
        aroId: candidateAro.aroId,
        repositorySnapshotRef,
      },
    ),
  );
  const candidateRevision = Number(
    input.candidateRevision || 1,
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "aroCandidate.predecessorRef",
        )
      : null;
  if (
    !Number.isInteger(
      candidateRevision,
    ) ||
    candidateRevision < 1 ||
    (
      candidateRevision === 1
    ) === Boolean(predecessorRef)
  ) {
    fail(
      "aro_candidate_revision_invalid",
    );
  }
  const branchContradictions =
    candidateAro.branches
      .filter((branch) =>
        branch.semanticState ===
          "contradicted")
      .map(branchRef);
  const bindingContradictions =
    candidateAro.realizationBindings
      .filter((binding) =>
        binding.coverageState ===
          "contradicted")
      .map(realizationBindingRef);
  const candidate = {
    schema:
      ARO_RECONSTRUCTION_CANDIDATE_SCHEMA,
    candidateId,
    candidateRevision,
    predecessorRef,
    projectId:
      candidateAro.projectId,
    candidateAro,
    repositorySnapshotRef,
    reconstructionMethod: text(
      input.reconstructionMethod,
      "semantic_repository_reconstruction",
    ),
    evidenceRefs: uniqueRefs([
      repositorySnapshotRef,
      ...(input.evidenceRefs || []),
      ...candidateAro.provenanceRefs,
    ]),
    contradictionRefs: uniqueRefs([
      ...(input.contradictionRefs || []),
      ...branchContradictions,
      ...bindingContradictions,
    ]),
    evidenceReviewState:
      ARO_REVIEW_STATES.has(
        input.evidenceReviewState,
      )
        ? input.evidenceReviewState
        : "pending",
    contradictionReviewState:
      ARO_REVIEW_STATES.has(
        input.contradictionReviewState,
      )
        ? input
            .contradictionReviewState
        : "pending",
    lifecycle:
      ARO_CANDIDATE_LIFECYCLES
        .has(input.lifecycle)
        ? input.lifecycle
        : "candidate",
    sourceSemanticEventRef:
      input.sourceSemanticEventRef
        ? exactRef(
            input.sourceSemanticEventRef,
            "aroCandidate.sourceSemanticEventRef",
          )
        : null,
    reviewedAt: text(
      input.reviewedAt,
      "",
    ),
    admittedAroRef:
      input.admittedAroRef
        ? exactRef(
            input.admittedAroRef,
            "aroCandidate.admittedAroRef",
          )
        : null,
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  candidate.digest = digestFor(
    ARO_RECONSTRUCTION_CANDIDATE_SCHEMA,
    candidate,
    ["digest"],
  );
  validateAroReconstructionCandidate(
    candidate,
  );
  return candidate;
}

function validateAroReconstructionCandidate(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_RECONSTRUCTION_CANDIDATE_SCHEMA ||
    !text(value.candidateId, "") ||
    !Number.isInteger(
      Number(value.candidateRevision),
    ) ||
    !text(value.projectId, "") ||
    !text(
      value.reconstructionMethod,
      "",
    ) ||
    !Array.isArray(value.evidenceRefs) ||
    !Array.isArray(
      value.contradictionRefs,
    ) ||
    !ARO_REVIEW_STATES.has(
      value.evidenceReviewState,
    ) ||
    !ARO_REVIEW_STATES.has(
      value.contradictionReviewState,
    ) ||
    !ARO_CANDIDATE_LIFECYCLES.has(
      value.lifecycle,
    ) ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_RECONSTRUCTION_CANDIDATE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "aro_reconstruction_candidate_invalid",
    );
  }
  validateAbstractReasoningObject(
    value.candidateAro,
  );
  if (
    value.candidateAro.canonical !==
      false ||
    value.candidateAro.lifecycle !==
      "candidate" ||
    value.candidateAro.projectId !==
      value.projectId ||
    (
      Number(value.candidateRevision) ===
        1
    ) === Boolean(value.predecessorRef)
  ) {
    fail(
      "aro_candidate_identity_invalid",
    );
  }
  exactRef(
    value.repositorySnapshotRef,
    "aroCandidate.repositorySnapshotRef",
  );
  value.evidenceRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aroCandidate.evidenceRefs.${index}`,
      ),
  );
  value.contradictionRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aroCandidate.contradictionRefs.${index}`,
      ),
  );
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "aroCandidate.predecessorRef",
    );
  }
  if (
    value.sourceSemanticEventRef
  ) {
    exactRef(
      value.sourceSemanticEventRef,
      "aroCandidate.sourceSemanticEventRef",
    );
  }
  if (value.admittedAroRef) {
    exactRef(
      value.admittedAroRef,
      "aroCandidate.admittedAroRef",
    );
  }
  return true;
}

function reviewAroReconstructionCandidate(
  candidate,
  input = {},
) {
  validateAroReconstructionCandidate(
    candidate,
  );
  if (
    candidate.lifecycle !== "candidate"
  ) {
    fail(
      "aro_candidate_review_lifecycle_invalid",
    );
  }
  if (
    candidate.evidenceReviewState ===
      "reviewed" &&
    candidate.contradictionReviewState ===
      "reviewed"
  ) {
    return {
      candidate,
      receipt: null,
      reused: true,
    };
  }
  const reviewedAt = text(
    input.reviewedAt,
    nowIso(input.now),
  );
  const reviewed =
    buildAroReconstructionCandidate({
      candidateId:
        candidate.candidateId,
      candidateRevision:
        candidate.candidateRevision + 1,
      predecessorRef:
        aroReconstructionCandidateRef(
          candidate,
        ),
      projectId: candidate.projectId,
      candidateAro:
        aroInputFromExisting(
          candidate.candidateAro,
          {
            lifecycle: "candidate",
            canonical: false,
            predecessorRef:
              candidate.candidateAro
                .predecessorRef,
          },
        ),
      repositorySnapshotRef:
        candidate.repositorySnapshotRef,
      reconstructionMethod:
        candidate.reconstructionMethod,
      evidenceRefs:
        candidate.evidenceRefs,
      contradictionRefs:
        candidate.contradictionRefs,
      evidenceReviewState: "reviewed",
      contradictionReviewState:
        "reviewed",
      lifecycle: "candidate",
      sourceSemanticEventRef:
        candidate
          .sourceSemanticEventRef,
      reviewedAt,
      createdAt: candidate.createdAt,
    });
  const receipt = {
    schema: ARO_REVIEW_RECEIPT_SCHEMA,
    reviewReceiptId: stableId(
      "wm_aro_review_receipt",
      {
        candidateRef:
          aroReconstructionCandidateRef(
            reviewed,
          ),
        actorId: text(
          input.actorId,
          "operator",
        ),
      },
    ),
    candidateRef:
      aroReconstructionCandidateRef(
        reviewed,
      ),
    predecessorCandidateRef:
      aroReconstructionCandidateRef(
        candidate,
      ),
    actorId: text(
      input.actorId,
      "operator",
    ),
    actorRole: "operator",
    evidenceInspected: true,
    contradictionsInspected: true,
    semanticValidityGranted: false,
    executionAuthorityGranted: false,
    canonicalMutation: false,
    grantsAuthority: false,
    reviewedAt,
  };
  receipt.digest = digestFor(
    ARO_REVIEW_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateAroReviewReceipt(receipt);
  return {
    candidate: reviewed,
    receipt,
    reused: false,
  };
}

function validateAroReviewReceipt(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_REVIEW_RECEIPT_SCHEMA ||
    !text(value.reviewReceiptId, "") ||
    !text(value.actorId, "") ||
    value.actorRole !== "operator" ||
    value.evidenceInspected !== true ||
    value.contradictionsInspected !==
      true ||
    value.semanticValidityGranted !==
      false ||
    value.executionAuthorityGranted !==
      false ||
    value.canonicalMutation !== false ||
    value.grantsAuthority !== false ||
    !text(value.reviewedAt, "") ||
    value.digest !==
      digestFor(
        ARO_REVIEW_RECEIPT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail("aro_review_receipt_invalid");
  }
  exactRef(
    value.candidateRef,
    "aroReview.candidateRef",
  );
  exactRef(
    value.predecessorCandidateRef,
    "aroReview.predecessorCandidateRef",
  );
  return true;
}

function admitAroReconstructionCandidate(
  candidate,
  input = {},
) {
  validateAroReconstructionCandidate(
    candidate,
  );
  if (
    candidate.lifecycle !==
      "candidate" ||
    candidate.evidenceReviewState !==
      "reviewed" ||
    candidate
      .contradictionReviewState !==
      "reviewed"
  ) {
    fail(
      "aro_candidate_admission_gate_blocked",
    );
  }
  const currentAro =
    input.currentAro || null;
  if (currentAro) {
    validateAbstractReasoningObject(
      currentAro,
    );
    if (
      currentAro.aroId !==
        candidate.candidateAro.aroId
    ) {
      fail(
        "aro_candidate_admission_identity_conflict",
      );
    }
  }
  const admittedAt = text(
    input.admittedAt,
    nowIso(input.now),
  );
  const aro =
    buildAbstractReasoningObject({
      ...aroInputFromExisting(
        candidate.candidateAro,
      ),
      revision:
        currentAro
          ? currentAro.revision + 1
          : 1,
      lifecycle: "active",
      predecessorRef: currentAro
        ? abstractReasoningObjectRef(
            currentAro,
          )
        : null,
      admittedFromCandidateRef:
        aroReconstructionCandidateRef(
          candidate,
        ),
      canonical: true,
      createdAt: admittedAt,
    });
  const receipt = {
    schema:
      ARO_ADMISSION_RECEIPT_SCHEMA,
    admissionReceiptId: stableId(
      "wm_aro_admission_receipt",
      {
        candidateRef:
          aroReconstructionCandidateRef(
            candidate,
          ),
        aroRef:
          abstractReasoningObjectRef(
            aro,
          ),
        actorId: text(
          input.actorId,
          "operator",
        ),
      },
    ),
    candidateRef:
      aroReconstructionCandidateRef(
        candidate,
      ),
    aroRef:
      abstractReasoningObjectRef(aro),
    actorId: text(
      input.actorId,
      "operator",
    ),
    actorRole: "operator",
    semanticRegistryMutation: true,
    codeMutationPerformed: false,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    grantsAuthority: false,
    admittedAt,
  };
  receipt.digest = digestFor(
    ARO_ADMISSION_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateAroAdmissionReceipt(
    receipt,
  );
  const admittedCandidate =
    buildAroReconstructionCandidate({
      candidateId:
        candidate.candidateId,
      candidateRevision:
        candidate.candidateRevision + 1,
      predecessorRef:
        aroReconstructionCandidateRef(
          candidate,
        ),
      projectId: candidate.projectId,
      candidateAro:
        aroInputFromExisting(
          candidate.candidateAro,
          {
            lifecycle: "candidate",
            canonical: false,
          },
        ),
      repositorySnapshotRef:
        candidate.repositorySnapshotRef,
      reconstructionMethod:
        candidate.reconstructionMethod,
      evidenceRefs:
        candidate.evidenceRefs,
      contradictionRefs:
        candidate.contradictionRefs,
      evidenceReviewState: "reviewed",
      contradictionReviewState:
        "reviewed",
      lifecycle: "admitted",
      sourceSemanticEventRef:
        candidate
          .sourceSemanticEventRef,
      reviewedAt: candidate.reviewedAt,
      admittedAroRef:
        abstractReasoningObjectRef(aro),
      createdAt: candidate.createdAt,
    });
  return {
    aro,
    candidate: admittedCandidate,
    receipt,
  };
}

function validateAroAdmissionReceipt(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_ADMISSION_RECEIPT_SCHEMA ||
    !text(
      value.admissionReceiptId,
      "",
    ) ||
    !text(value.actorId, "") ||
    value.actorRole !== "operator" ||
    value.semanticRegistryMutation !==
      true ||
    value.codeMutationPerformed !==
      false ||
    value.downstreamEffectsExecuted !==
      false ||
    value.executionAuthorityGranted !==
      false ||
    value.grantsAuthority !== false ||
    !text(value.admittedAt, "") ||
    value.digest !==
      digestFor(
        ARO_ADMISSION_RECEIPT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "aro_admission_receipt_invalid",
    );
  }
  exactRef(
    value.candidateRef,
    "aroAdmission.candidateRef",
  );
  exactRef(
    value.aroRef,
    "aroAdmission.aroRef",
  );
  return true;
}

function reviseAroRealizationFreshness(
  aro,
  input = {},
) {
  validateAbstractReasoningObject(aro);
  if (aro.canonical !== true) {
    fail(
      "aro_freshness_revision_requires_canonical",
    );
  }
  const changedSourceRefs =
    uniqueRefs(
      input.changedSourceRefs,
    );
  const changedIds = new Set(
    changedSourceRefs.map((ref) =>
      `${ref.kind}:${ref.id}`),
  );
  let changed = false;
  const bindings =
    aro.realizationBindings.map(
      (binding) => {
        const key =
          `${binding.sourceRef.kind}:${binding.sourceRef.id}`;
        const currentSource =
          changedSourceRefs.find(
            (ref) =>
              `${ref.kind}:${ref.id}` ===
                key,
          );
        if (
          !changedIds.has(key) ||
          currentSource?.digest ===
            binding.sourceRef.digest
        ) {
          return {
            realizationBindingId:
              binding
                .realizationBindingId,
            branchKey:
              aro.branches.find(
                (branch) =>
                  branch.branchId ===
                    binding
                      .branchRef.id,
              )?.branchKey,
            realizationKind:
              binding.realizationKind,
            locator: binding.locator,
            sourceRef:
              binding.sourceRef,
            coverageState:
              binding.coverageState,
            evidenceRefs:
              binding.evidenceRefs,
            observedRevisionRef:
              binding
                .observedRevisionRef,
          };
        }
        changed = true;
        return {
          realizationBindingId:
            binding.realizationBindingId,
          branchKey:
            aro.branches.find(
              (branch) =>
                branch.branchId ===
                  binding.branchRef.id,
            )?.branchKey,
          realizationKind:
            binding.realizationKind,
          locator: binding.locator,
          sourceRef: currentSource,
          coverageState: "stale",
          evidenceRefs:
            binding.evidenceRefs,
          observedRevisionRef:
            currentSource,
        };
      },
    );
  if (!changed) {
    return {
      changed: false,
      aro,
    };
  }
  return {
    changed: true,
    aro:
      buildAbstractReasoningObject({
        ...aroInputFromExisting(aro),
        revision: aro.revision + 1,
        lifecycle: "stale",
        predecessorRef:
          abstractReasoningObjectRef(
            aro,
          ),
        realizationBindings:
          bindings,
        createdAt: text(
          input.changedAt,
          nowIso(input.now),
        ),
      }),
  };
}

function buildAroCurrentTargetComparison(
  currentAro,
  targetAro,
) {
  validateAbstractReasoningObject(
    currentAro,
  );
  validateAbstractReasoningObject(
    targetAro,
  );
  if (
    currentAro.posture !== "current" ||
    targetAro.posture !== "target" ||
    currentAro.projectId !==
      targetAro.projectId ||
    currentAro.conceptKey !==
      targetAro.conceptKey
  ) {
    fail(
      "aro_current_target_comparison_scope_invalid",
    );
  }
  const currentByKey = new Map(
    currentAro.branches.map(
      (branch) => [
        branch.branchKey,
        branch,
      ],
    ),
  );
  const targetByKey = new Map(
    targetAro.branches.map(
      (branch) => [
        branch.branchKey,
        branch,
      ],
    ),
  );
  const sharedBranchKeys = [
    ...targetByKey.keys(),
  ].filter((key) =>
    currentByKey.has(key));
  const currentOnlyBranchRefs = [
    ...currentByKey.entries(),
  ]
    .filter(([key]) =>
      !targetByKey.has(key))
    .map(([, branch]) =>
      branchRef(branch));
  const targetOnlyBranchRefs = [
    ...targetByKey.entries(),
  ]
    .filter(([key]) =>
      !currentByKey.has(key))
    .map(([, branch]) =>
      branchRef(branch));
  const conflictPairs =
    sharedBranchKeys
      .map((branchKey) => {
        const current =
          currentByKey.get(branchKey);
        const target =
          targetByKey.get(branchKey);
        if (
          current.statement ===
            target.statement &&
          current.semanticState ===
            target.semanticState &&
          current.modality ===
            target.modality
        ) {
          return null;
        }
        return {
          branchKey,
          currentBranchRef:
            branchRef(current),
          targetBranchRef:
            branchRef(target),
          distinctions: [
            ...(current.statement !==
            target.statement
              ? ["statement"]
              : []),
            ...(current.semanticState !==
            target.semanticState
              ? ["semantic_state"]
              : []),
            ...(current.modality !==
            target.modality
              ? ["modality"]
              : []),
          ],
          grantsAuthority: false,
        };
      })
      .filter(Boolean);
  const comparison = {
    schema:
      ARO_CURRENT_TARGET_COMPARISON_SCHEMA,
    comparisonId: stableId(
      "wm_aro_current_target_comparison",
      {
        currentAroRef:
          abstractReasoningObjectRef(
            currentAro,
          ),
        targetAroRef:
          abstractReasoningObjectRef(
            targetAro,
          ),
      },
    ),
    projectId: currentAro.projectId,
    conceptKey: currentAro.conceptKey,
    currentAroRef:
      abstractReasoningObjectRef(
        currentAro,
      ),
    targetAroRef:
      abstractReasoningObjectRef(
        targetAro,
      ),
    sharedBranchKeys,
    currentOnlyBranchRefs,
    targetOnlyBranchRefs,
    conflictPairs,
    currentCoverageWitnessRef:
      currentAro.coverageWitnessRef,
    targetCoverageWitnessRef:
      targetAro.coverageWitnessRef,
    currentCoveragePosture:
      currentAro.coverageWitness
        .coveragePosture,
    targetCoveragePosture:
      targetAro.coverageWitness
        .coveragePosture,
    candidateImplementationObligation:
      false,
    codeMutationAuthorized: false,
    canonical: false,
    grantsAuthority: false,
  };
  comparison.digest = digestFor(
    ARO_CURRENT_TARGET_COMPARISON_SCHEMA,
    comparison,
    ["digest"],
  );
  validateAroCurrentTargetComparison(
    comparison,
  );
  return comparison;
}

function validateAroCurrentTargetComparison(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_CURRENT_TARGET_COMPARISON_SCHEMA ||
    !text(value.comparisonId, "") ||
    !text(value.projectId, "") ||
    !text(value.conceptKey, "") ||
    !Array.isArray(
      value.sharedBranchKeys,
    ) ||
    !Array.isArray(
      value.currentOnlyBranchRefs,
    ) ||
    !Array.isArray(
      value.targetOnlyBranchRefs,
    ) ||
    !Array.isArray(
      value.conflictPairs,
    ) ||
    value.candidateImplementationObligation !==
      false ||
    value.codeMutationAuthorized !==
      false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_CURRENT_TARGET_COMPARISON_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "aro_current_target_comparison_invalid",
    );
  }
  exactRef(
    value.currentAroRef,
    "aroComparison.currentAroRef",
  );
  exactRef(
    value.targetAroRef,
    "aroComparison.targetAroRef",
  );
  exactRef(
    value.currentCoverageWitnessRef,
    "aroComparison.currentCoverageWitnessRef",
  );
  exactRef(
    value.targetCoverageWitnessRef,
    "aroComparison.targetCoverageWitnessRef",
  );
  value.currentOnlyBranchRefs
    .forEach((ref, index) =>
      exactRef(
        ref,
        `aroComparison.currentOnly.${index}`,
      ));
  value.targetOnlyBranchRefs
    .forEach((ref, index) =>
      exactRef(
        ref,
        `aroComparison.targetOnly.${index}`,
      ));
  value.conflictPairs.forEach(
    (pair) => {
      exactRef(
        pair.currentBranchRef,
        "aroComparison.currentBranchRef",
      );
      exactRef(
        pair.targetBranchRef,
        "aroComparison.targetBranchRef",
      );
      if (
        !Array.isArray(
          pair.distinctions,
        ) ||
        pair.grantsAuthority !== false
      ) {
        fail(
          "aro_comparison_conflict_invalid",
        );
      }
    },
  );
  return true;
}

module.exports = {
  ABSTRACT_REASONING_OBJECT_SCHEMA,
  ARO_ADMISSION_RECEIPT_SCHEMA,
  ARO_BRANCH_SCHEMA,
  ARO_COVERAGE_WITNESS_SCHEMA,
  ARO_CURRENT_TARGET_COMPARISON_SCHEMA,
  ARO_EDGE_SCHEMA,
  ARO_REALIZATION_BINDING_SCHEMA,
  ARO_RECONSTRUCTION_CANDIDATE_SCHEMA,
  ARO_REVIEW_RECEIPT_SCHEMA,
  abstractReasoningObjectRef,
  admitAroReconstructionCandidate,
  aroInputFromExisting,
  aroReconstructionCandidateRef,
  branchRef,
  buildAbstractReasoningObject,
  buildAroCoverageWitness,
  buildAroCurrentTargetComparison,
  buildAroReconstructionCandidate,
  coverageWitnessRef,
  digestFor,
  realizationBindingRef,
  reviseAroRealizationFreshness,
  reviewAroReconstructionCandidate,
  stableId,
  validateAbstractReasoningObject,
  validateAroAdmissionReceipt,
  validateAroBranch,
  validateAroCoverageWitness,
  validateAroCurrentTargetComparison,
  validateAroEdge,
  validateAroRealizationBinding,
  validateAroReconstructionCandidate,
  validateAroReviewReceipt,
};
