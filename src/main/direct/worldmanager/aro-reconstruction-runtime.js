"use strict";

const {
  digestFor,
  stableId,
  buildAroReconstructionCandidate,
  validateAroReconstructionCandidate,
} = require("./aro-kernel");

const REPOSITORY_SEMANTIC_SNAPSHOT_SCHEMA =
  "direct_repository_semantic_snapshot@1";
const ARO_RECONSTRUCTION_RUN_SCHEMA =
  "direct_aro_reconstruction_run@1";
const ARO_RECONSTRUCTION_VALIDATION_SCHEMA =
  "direct_aro_reconstruction_validation@1";
const ARO_RECONSTRUCTION_REQUEST_MANIFEST_SCHEMA =
  "direct_aro_reconstruction_request_manifest@1";
const ARO_RECONSTRUCTION_ACTION =
  "wm_discharge_aro_reconstruction";

const RUN_STATES = new Set([
  "scheduled",
  "running",
  "completed",
  "remanded",
  "failed",
]);
const TERMINAL_RUN_STATES = new Set([
  "completed",
  "remanded",
  "failed",
]);
const RETRYABLE_RUN_STATES = new Set([
  "remanded",
  "failed",
]);
const BRANCH_MODALITIES = new Set([
  "required",
  "possible",
  "counterfactual",
]);
const BRANCH_STATES = new Set([
  "supported",
  "missing",
  "contradicted",
  "unknown",
]);
const EDGE_RELATIONS = new Set([
  "requires",
  "excludes",
  "causes",
  "refines",
  "alternative_to",
  "counterfactual_of",
]);
const REALIZATION_KINDS = new Set([
  "source",
  "test",
  "documentation",
  "runtime_witness",
]);
const COVERAGE_STATES = new Set([
  "realized",
  "partial",
  "absent",
  "stale",
  "contradicted",
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
    ? `${source.slice(0, max - 1).trimEnd()}…`
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
  const result = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (
    !result.kind ||
    !result.id ||
    !result.digest
  ) {
    fail(
      "world_manager_aro_reconstruction_ref_invalid",
      label,
    );
  }
  const refLabel = text(value.label, "");
  if (refLabel) {
    result.label = bounded(
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
    result.projectId = projectId;
  }
  return result;
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => text(value, ""))
        .filter(Boolean),
    ),
  ];
}

function normalizedConceptKey(value) {
  const result = text(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  if (!result) {
    fail(
      "world_manager_aro_reconstruction_concept_key_invalid",
    );
  }
  return result;
}

function normalizeRepositoryEvidence(
  value,
  projectId,
  index,
) {
  if (!isPlainObject(value)) {
    fail(
      "world_manager_repository_evidence_invalid",
      String(index),
    );
  }
  const evidenceKey = text(
    value.evidenceKey,
    `evidence_${index + 1}`,
  );
  const relativePath = text(
    value.relativePath ||
      value.relPath,
    "",
  ).replace(/\\/g, "/");
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    /^[a-z]:\//i.test(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    fail(
      "world_manager_repository_evidence_path_invalid",
      evidenceKey,
    );
  }
  const sourceDigest = text(
    value.digest ||
      value.sourceDigest,
    "",
  );
  if (!sourceDigest) {
    fail(
      "world_manager_repository_evidence_digest_missing",
      evidenceKey,
    );
  }
  const evidenceKind = [
    "source_file",
    "test_file",
    "documentation",
    "configuration",
  ].includes(value.evidenceKind)
    ? value.evidenceKind
    : "source_file";
  const evidenceRef = exactRef({
    kind: evidenceKind,
    id: stableId(
      "wm_repository_evidence",
      {
        projectId,
        relativePath,
      },
    ),
    digest: sourceDigest,
    label: relativePath,
    projectId,
  });
  return {
    schema:
      "direct_repository_semantic_evidence@1",
    evidenceKey,
    evidenceKind,
    relativePath,
    sizeBytes: Math.max(
      0,
      Number(value.sizeBytes || value.size || 0),
    ),
    excerpt: bounded(
      value.excerpt,
      "",
      8_000,
    ),
    excerptTruncated:
      value.excerptTruncated === true,
    sourceRef: evidenceRef,
    sensitivePathRejected: false,
    grantsAuthority: false,
  };
}

function repositorySnapshotDigest(
  snapshot,
) {
  return digestFor(
    REPOSITORY_SEMANTIC_SNAPSHOT_SCHEMA,
    snapshot,
    [
      "snapshotDigest",
      "observedAt",
    ],
  );
}

function buildRepositorySemanticSnapshot(
  input = {},
) {
  const raw =
    input.observation || input.snapshot || input;
  const projectId = text(
    input.projectId || raw.projectId,
    "",
  );
  if (!projectId) {
    fail(
      "world_manager_repository_snapshot_project_required",
    );
  }
  const evidence = (
    Array.isArray(raw.evidence)
      ? raw.evidence
      : []
  ).map((entry, index) =>
    normalizeRepositoryEvidence(
      entry,
      projectId,
      index,
    ));
  const evidenceKeys =
    new Set();
  for (const entry of evidence) {
    if (evidenceKeys.has(entry.evidenceKey)) {
      fail(
        "world_manager_repository_evidence_key_duplicate",
        entry.evidenceKey,
      );
    }
    evidenceKeys.add(entry.evidenceKey);
  }
  const repositoryIdentity = {
    gitAvailable:
      raw.gitAvailable === true,
    headOid: bounded(
      raw.headOid,
      "",
      160,
    ),
    branch: bounded(
      raw.branch,
      "",
      240,
    ),
    dirtyPathCount: Math.max(
      0,
      Number(raw.dirtyPathCount || 0),
    ),
    statusDigest: text(
      raw.statusDigest,
      digestFor(
        "direct_repository_empty_status@1",
        {},
      ),
    ),
    diffDigest: text(
      raw.diffDigest,
      digestFor(
        "direct_repository_empty_diff@1",
        {},
      ),
    ),
    untrackedStateDigest: text(
      raw.untrackedStateDigest,
      digestFor(
        "direct_repository_empty_untracked_state@1",
        {},
      ),
    ),
    manifestDigest: text(
      raw.manifestDigest,
      "",
    ),
    trackedFileCount: Math.max(
      0,
      Number(raw.trackedFileCount || 0),
    ),
    manifestTruncated:
      raw.manifestTruncated === true,
  };
  if (!repositoryIdentity.manifestDigest) {
    fail(
      "world_manager_repository_snapshot_manifest_digest_missing",
    );
  }
  const manifestPaths = (
    Array.isArray(raw.manifestPaths)
      ? raw.manifestPaths
      : []
  )
    .map((entry) =>
      text(entry, "").replace(/\\/g, "/"))
    .filter(Boolean)
    .slice(0, 2_000);
  const observedAt = text(
    raw.observedAt,
    nowIso(input.now),
  );
  const observationState =
    raw.observationState ===
      "unavailable"
      ? "unavailable"
      : "observed";
  const observationError =
    observationState === "unavailable"
      ? {
          code: text(
            raw.observationError?.code,
            "world_manager_repository_observation_unavailable",
          ),
          message: bounded(
            raw.observationError?.message,
            "Repository evidence could not be observed in the declared project substrate.",
            500,
          ),
        }
      : null;
  const contentIdentity = {
    projectId,
    workspaceKind: text(
      raw.workspaceKind,
      "local",
    ),
    repositoryIdentity,
    manifestPaths,
    evidence: evidence.map((entry) => ({
      evidenceKey: entry.evidenceKey,
      evidenceKind: entry.evidenceKind,
      relativePath: entry.relativePath,
      sourceRef: entry.sourceRef,
      excerptDigest: digestFor(
        "direct_repository_evidence_excerpt@1",
        {
          excerpt: entry.excerpt,
          excerptTruncated:
            entry.excerptTruncated,
        },
      ),
    })),
    observationState,
    observationError,
  };
  const snapshotId = stableId(
    "wm_repository_semantic_snapshot",
    contentIdentity,
  );
  const snapshot = {
    schema:
      REPOSITORY_SEMANTIC_SNAPSHOT_SCHEMA,
    snapshotId,
    projectId,
    workspaceKind:
      contentIdentity.workspaceKind,
    observationState,
    observationError,
    repositoryIdentity,
    manifestPaths,
    evidence,
    evidenceCatalogComplete:
      raw.evidenceCatalogComplete === true,
    sourceTextIncluded: evidence.some(
      (entry) => Boolean(entry.excerpt),
    ),
    relativeRepositoryPathsIncluded:
      true,
    rawWorkspacePathIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
    canonical: false,
    grantsAuthority: false,
    observedAt,
  };
  snapshot.snapshotDigest =
    repositorySnapshotDigest(snapshot);
  validateRepositorySemanticSnapshot(
    snapshot,
  );
  return snapshot;
}

function validateRepositorySemanticSnapshot(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      REPOSITORY_SEMANTIC_SNAPSHOT_SCHEMA ||
    !text(value.snapshotId, "") ||
    !text(value.projectId, "") ||
    !text(value.workspaceKind, "") ||
    !["observed", "unavailable"].includes(
      value.observationState,
    ) ||
    !isPlainObject(
      value.repositoryIdentity,
    ) ||
    !text(
      value.repositoryIdentity
        .manifestDigest,
      "",
    ) ||
    !Array.isArray(value.manifestPaths) ||
    !Array.isArray(value.evidence) ||
    value.rawWorkspacePathIncluded !==
      false ||
    value.rawCredentialIncluded !== false ||
    value.rawSecretIncluded !== false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.snapshotDigest !==
      repositorySnapshotDigest(value)
  ) {
    fail(
      "world_manager_repository_semantic_snapshot_invalid",
    );
  }
  if (
    (value.observationState ===
      "unavailable") !==
      Boolean(value.observationError)
  ) {
    fail(
      "world_manager_repository_semantic_snapshot_observation_state_invalid",
    );
  }
  const keys = new Set();
  for (const entry of value.evidence) {
    if (
      !isPlainObject(entry) ||
      entry.schema !==
        "direct_repository_semantic_evidence@1" ||
      !text(entry.evidenceKey, "") ||
      !text(entry.relativePath, "") ||
      entry.grantsAuthority !== false
    ) {
      fail(
        "world_manager_repository_evidence_invalid",
      );
    }
    if (keys.has(entry.evidenceKey)) {
      fail(
        "world_manager_repository_evidence_key_duplicate",
        entry.evidenceKey,
      );
    }
    keys.add(entry.evidenceKey);
    exactRef(
      entry.sourceRef,
      entry.evidenceKey,
    );
  }
  return true;
}

function repositorySnapshotRef(snapshot) {
  validateRepositorySemanticSnapshot(
    snapshot,
  );
  return exactRef({
    kind: "repository_snapshot",
    id: snapshot.snapshotId,
    digest: snapshot.snapshotDigest,
    label:
      "Bounded repository semantic snapshot",
    projectId: snapshot.projectId,
  });
}

function reconstructionTool() {
  const branch = {
    type: "object",
    additionalProperties: false,
    properties: {
      branchKey: { type: "string" },
      parentBranchKey: {
        type: "string",
      },
      branchKind: { type: "string" },
      modality: {
        type: "string",
        enum: [...BRANCH_MODALITIES],
      },
      statement: { type: "string" },
      condition: { type: "string" },
      expectedOutcome: {
        type: "string",
      },
      semanticState: {
        type: "string",
        enum: [...BRANCH_STATES],
      },
      provenanceEvidenceKeys: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "branchKey",
      "parentBranchKey",
      "branchKind",
      "modality",
      "statement",
      "condition",
      "expectedOutcome",
      "semanticState",
      "provenanceEvidenceKeys",
    ],
  };
  const edge = {
    type: "object",
    additionalProperties: false,
    properties: {
      fromBranchKey: {
        type: "string",
      },
      toBranchKey: { type: "string" },
      relationKind: {
        type: "string",
        enum: [...EDGE_RELATIONS],
      },
      rationale: { type: "string" },
    },
    required: [
      "fromBranchKey",
      "toBranchKey",
      "relationKind",
      "rationale",
    ],
  };
  const realization = {
    type: "object",
    additionalProperties: false,
    properties: {
      branchKey: { type: "string" },
      realizationKind: {
        type: "string",
        enum: [...REALIZATION_KINDS],
      },
      locator: { type: "string" },
      sourceEvidenceKey: {
        type: "string",
      },
      coverageState: {
        type: "string",
        enum: [...COVERAGE_STATES],
      },
      evidenceKeys: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "branchKey",
      "realizationKind",
      "locator",
      "sourceEvidenceKey",
      "coverageState",
      "evidenceKeys",
    ],
  };
  const reconstruction = {
    type: "object",
    additionalProperties: false,
    properties: {
      conceptKey: { type: "string" },
      semanticIdentity: {
        type: "string",
      },
      purpose: { type: "string" },
      posture: {
        type: "string",
        enum: ["current", "target"],
      },
      branches: {
        type: "array",
        minItems: 1,
        maxItems: 18,
        items: branch,
      },
      edges: {
        type: "array",
        maxItems: 30,
        items: edge,
      },
      realizationBindings: {
        type: "array",
        maxItems: 36,
        items: realization,
      },
      contradictionEvidenceKeys: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "conceptKey",
      "semanticIdentity",
      "purpose",
      "posture",
      "branches",
      "edges",
      "realizationBindings",
      "contradictionEvidenceKeys",
    ],
  };
  return {
    type: "function",
    name: ARO_RECONSTRUCTION_ACTION,
    description:
      "Discharge one bounded semantic reconstruction result from the supplied repository evidence. Describe one to three abstract reasoning objects and their implementation bindings. The result is provisional and cannot admit worldstate or mutate code.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        repositorySummary: {
          type: "string",
        },
        selectionRationale: {
          type: "string",
        },
        reconstructions: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: reconstruction,
        },
      },
      required: [
        "repositorySummary",
        "selectionRationale",
        "reconstructions",
      ],
    },
  };
}

function reconstructionInstructions() {
  return [
    "You are a bounded semantic reconstructor operating under the WorldManager.",
    "Reason from the supplied repository snapshot as evidence of an implementation, not as the definition of its intended meaning.",
    "Reconstruct one to three dominant abstract reasoning objects (AROs) that the repository appears to realize.",
    "An ARO is intensional: include required, possible, and relevant counterfactual branches when evidence supports distinguishing them. Use edges to express requirements, exclusions, causation, refinements, alternatives, and counterfactual relations.",
    "Keep code, tests, documents, and runtime witnesses subordinate as realization bindings to semantic branches.",
    "Use only evidence keys present in the trusted evidence catalog. An evidence key is a pointer to exact harness evidence, not prose authority.",
    "Represent uncertainty honestly with unknown, missing, partial, absent, contradicted, or counterfactual states. Do not infer implementation coverage from filenames alone when the excerpt does not support it.",
    "Prefer a coherent high-level ARO over a catalogue of files or features. Do not create one ARO per file.",
    "The schema constrains discharge form, not semantic vocabulary. Introduce concept keys and branch kinds that fit the actual repository.",
    "Call exactly one wm_discharge_aro_reconstruction action. Do not emit prose or JSON outside the action.",
    "This action creates only non-canonical reconstruction candidates. It does not validate semantic truth, admit worldstate, mutate code, start work, or grant authority.",
  ].join("\n");
}

function reconstructionPrompt(
  input = {},
) {
  const snapshot = input.snapshot;
  validateRepositorySemanticSnapshot(
    snapshot,
  );
  return [
    "[PROJECT]",
    JSON.stringify({
      projectId: snapshot.projectId,
      name: text(
        input.project?.name,
        snapshot.projectId,
      ),
      summary: text(
        input.project?.summary,
        "",
      ),
      workspaceKind:
        snapshot.workspaceKind,
    }),
    "[REPOSITORY SNAPSHOT IDENTITY]",
    JSON.stringify({
      repositorySnapshotRef:
        repositorySnapshotRef(snapshot),
      repositoryIdentity:
        snapshot.repositoryIdentity,
      manifestPaths:
        snapshot.manifestPaths,
      manifestTruncated:
        snapshot.repositoryIdentity
          .manifestTruncated,
    }),
    "[TRUSTED EVIDENCE CATALOG]",
    JSON.stringify(
      snapshot.evidence.map((entry) => ({
        evidenceKey: entry.evidenceKey,
        evidenceKind:
          entry.evidenceKind,
        relativePath:
          entry.relativePath,
        sizeBytes: entry.sizeBytes,
        excerpt: entry.excerpt,
        excerptTruncated:
          entry.excerptTruncated,
        sourceRef: entry.sourceRef,
      })),
    ),
    "[RECONSTRUCTION TASK]",
    "Reconstruct the repository's dominant current semantic anatomy. Add a target ARO only when repository evidence itself contains an explicit target design or specification distinct from current implementation.",
  ].join("\n");
}

function outputContract() {
  const tool = reconstructionTool();
  const contract = {
    schema:
      "direct_aro_reconstruction_action_contract@1",
    outputContractId:
      "world_manager.aro_reconstruction@1",
    selectionMechanism:
      "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: [
      ARO_RECONSTRUCTION_ACTION,
    ],
    semanticContentPosture: "open",
    canonicalAdmissionEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
    tools: [tool],
  };
  contract.digest = digestFor(
    contract.schema,
    contract,
    ["digest"],
  );
  return contract;
}

function requestManifest(input = {}) {
  const instructions =
    reconstructionInstructions();
  const contract = outputContract();
  const snapshotRef =
    repositorySnapshotRef(input.snapshot);
  const manifest = {
    schema:
      ARO_RECONSTRUCTION_REQUEST_MANIFEST_SCHEMA,
    requestManifestId: stableId(
      "wm_aro_reconstruction_manifest",
      {
        projectId: input.projectId,
        snapshotRef,
        attempt: input.attempt,
        instructionDigest: digestFor(
          "direct_aro_reconstruction_instructions@1",
          { instructions },
        ),
        outputContractDigest:
          contract.digest,
      },
    ),
    projectId: input.projectId,
    repositorySnapshotRef:
      snapshotRef,
    attempt: Number(input.attempt),
    instructionPackageRef: exactRef({
      kind:
        "trusted_aro_reconstruction_instruction_package",
      id:
        "world_manager.aro_reconstruction@1",
      digest: digestFor(
        "direct_aro_reconstruction_instructions@1",
        { instructions },
      ),
    }),
    outputContractRef: exactRef({
      kind:
        "aro_reconstruction_action_contract",
      id: contract.outputContractId,
      digest: contract.digest,
    }),
    rendererInstructionsAccepted: false,
    canonicalAdmissionEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    ARO_RECONSTRUCTION_REQUEST_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return {
    instructions,
    outputContract: contract,
    manifest,
  };
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(
      String(value || ""),
    );
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch {}
  fail(
    "world_manager_aro_reconstruction_arguments_invalid",
  );
}

function exactKeys(
  value,
  expected,
  label,
) {
  if (!isPlainObject(value)) {
    fail(
      "world_manager_aro_reconstruction_object_required",
      label,
    );
  }
  const actual =
    Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index],
    )
  ) {
    fail(
      "world_manager_aro_reconstruction_form_mismatch",
      label,
    );
  }
}

function evidenceRefMap(snapshot) {
  const map = new Map([
    [
      "repository_snapshot",
      repositorySnapshotRef(snapshot),
    ],
  ]);
  for (const entry of snapshot.evidence) {
    map.set(
      entry.evidenceKey,
      entry.sourceRef,
    );
  }
  return map;
}

function refsForKeys(
  keys,
  evidence,
  label,
) {
  return uniqueStrings(keys).map((key) => {
    const ref = evidence.get(key);
    if (!ref) {
      fail(
        "world_manager_aro_reconstruction_evidence_key_unresolved",
        `${label}:${key}`,
      );
    }
    return ref;
  });
}

function orderBranches(
  branches,
) {
  const byKey = new Map();
  for (const branch of branches) {
    const key = text(
      branch.branchKey,
      "",
    );
    if (!key || byKey.has(key)) {
      fail(
        "world_manager_aro_reconstruction_branch_key_invalid",
        key,
      );
    }
    byKey.set(key, branch);
  }
  const ordered = [];
  const active = new Set();
  const complete = new Set();
  const visit = (key) => {
    if (complete.has(key)) return;
    if (active.has(key)) {
      fail(
        "world_manager_aro_reconstruction_branch_cycle",
        key,
      );
    }
    const branch = byKey.get(key);
    if (!branch) {
      fail(
        "world_manager_aro_reconstruction_branch_missing",
        key,
      );
    }
    active.add(key);
    const parentKey = text(
      branch.parentBranchKey,
      "",
    );
    if (parentKey) visit(parentKey);
    active.delete(key);
    complete.add(key);
    ordered.push(branch);
  };
  for (const key of byKey.keys()) {
    visit(key);
  }
  return ordered;
}

function normalizeReconstruction(
  value,
  context,
) {
  exactKeys(value, [
    "conceptKey",
    "semanticIdentity",
    "purpose",
    "posture",
    "branches",
    "edges",
    "realizationBindings",
    "contradictionEvidenceKeys",
  ], "reconstruction");
  const posture = text(
    value.posture,
    "",
  );
  if (
    !["current", "target"].includes(
      posture,
    )
  ) {
    fail(
      "world_manager_aro_reconstruction_posture_invalid",
    );
  }
  const rawBranches =
    Array.isArray(value.branches)
      ? value.branches
      : [];
  if (
    rawBranches.length < 1 ||
    rawBranches.length > 18
  ) {
    fail(
      "world_manager_aro_reconstruction_branch_count_invalid",
    );
  }
  const branches = orderBranches(
    rawBranches.map((branch) => {
      exactKeys(branch, [
        "branchKey",
        "parentBranchKey",
        "branchKind",
        "modality",
        "statement",
        "condition",
        "expectedOutcome",
        "semanticState",
        "provenanceEvidenceKeys",
      ], "branch");
      if (
        !BRANCH_MODALITIES.has(
          branch.modality,
        ) ||
        !BRANCH_STATES.has(
          branch.semanticState,
        )
      ) {
        fail(
          "world_manager_aro_reconstruction_branch_form_invalid",
          text(branch.branchKey, ""),
        );
      }
      return {
        branchKey: text(
          branch.branchKey,
          "",
        ),
        parentBranchKey: text(
          branch.parentBranchKey,
          "",
        ),
        branchKind: text(
          branch.branchKind,
          "semantic_requirement",
        ),
        modality: branch.modality,
        statement: bounded(
          branch.statement,
          "",
          1_200,
        ),
        condition: bounded(
          branch.condition,
          "",
          800,
        ),
        expectedOutcome: bounded(
          branch.expectedOutcome,
          "",
          800,
        ),
        semanticState:
          branch.semanticState,
        provenanceRefs: refsForKeys(
          branch.provenanceEvidenceKeys,
          context.evidence,
          `branch:${branch.branchKey}`,
        ),
      };
    }),
  );
  const branchKeys = new Set(
    branches.map((branch) =>
      branch.branchKey),
  );
  const edges = (
    Array.isArray(value.edges)
      ? value.edges
      : []
  ).map((edge) => {
    exactKeys(edge, [
      "fromBranchKey",
      "toBranchKey",
      "relationKind",
      "rationale",
    ], "edge");
    if (
      !branchKeys.has(
        edge.fromBranchKey,
      ) ||
      !branchKeys.has(
        edge.toBranchKey,
      ) ||
      !EDGE_RELATIONS.has(
        edge.relationKind,
      )
    ) {
      fail(
        "world_manager_aro_reconstruction_edge_invalid",
      );
    }
    return {
      fromBranchKey:
        edge.fromBranchKey,
      toBranchKey:
        edge.toBranchKey,
      relationKind:
        edge.relationKind,
      rationale: bounded(
        edge.rationale,
        "",
        800,
      ),
    };
  });
  const realizationBindings = (
    Array.isArray(
      value.realizationBindings,
    )
      ? value.realizationBindings
      : []
  ).map((binding) => {
    exactKeys(binding, [
      "branchKey",
      "realizationKind",
      "locator",
      "sourceEvidenceKey",
      "coverageState",
      "evidenceKeys",
    ], "realizationBinding");
    if (
      !branchKeys.has(
        binding.branchKey,
      ) ||
      !REALIZATION_KINDS.has(
        binding.realizationKind,
      ) ||
      !COVERAGE_STATES.has(
        binding.coverageState,
      )
    ) {
      fail(
        "world_manager_aro_reconstruction_binding_invalid",
      );
    }
    const sourceRef =
      context.evidence.get(
        binding.sourceEvidenceKey,
      );
    if (!sourceRef) {
      fail(
        "world_manager_aro_reconstruction_evidence_key_unresolved",
        `binding:${binding.sourceEvidenceKey}`,
      );
    }
    return {
      branchKey:
        binding.branchKey,
      realizationKind:
        binding.realizationKind,
      locator: bounded(
        binding.locator,
        sourceRef.label ||
          sourceRef.id,
        1_000,
      ),
      sourceRef,
      coverageState:
        binding.coverageState,
      evidenceRefs: refsForKeys(
        binding.evidenceKeys,
        context.evidence,
        `binding:${binding.branchKey}`,
      ),
      observedRevisionRef:
        context.snapshotRef,
    };
  });
  return {
    conceptKey: normalizedConceptKey(
      value.conceptKey,
    ),
    semanticIdentity: bounded(
      value.semanticIdentity,
      value.conceptKey,
      300,
    ),
    purpose: bounded(
      value.purpose,
      "",
      1_200,
    ),
    posture,
    branches,
    edges,
    realizationBindings,
    contradictionRefs: refsForKeys(
      value.contradictionEvidenceKeys,
      context.evidence,
      "contradictions",
    ),
  };
}

function actionCallsFromResult(
  value = {},
) {
  if (Array.isArray(value.actionCalls)) {
    return value.actionCalls;
  }
  return (
    Array.isArray(value.normalizedEvents)
      ? value.normalizedEvents
      : []
  )
    .filter((event) =>
      event?.type ===
        "tool_call_completed")
    .map((event) => ({
      callId: event.callId,
      name:
        event.name ||
        event.toolName,
      argumentsJson:
        event.argumentsJson,
    }));
}

function validateReconstructionAction(
  runnerResult,
  snapshot,
) {
  const actionCalls =
    actionCallsFromResult(runnerResult);
  const errors = [];
  let result = null;
  try {
    if (
      actionCalls.length !== 1 ||
      actionCalls[0].name !==
        ARO_RECONSTRUCTION_ACTION
    ) {
      fail(
        "world_manager_aro_reconstruction_exact_action_required",
        String(actionCalls.length),
      );
    }
    const args = parseArguments(
      actionCalls[0].argumentsJson ??
        actionCalls[0].arguments ??
        actionCalls[0].payload,
    );
    exactKeys(args, [
      "repositorySummary",
      "selectionRationale",
      "reconstructions",
    ], "action");
    if (
      !Array.isArray(
        args.reconstructions,
      ) ||
      args.reconstructions.length < 1 ||
      args.reconstructions.length > 3
    ) {
      fail(
        "world_manager_aro_reconstruction_count_invalid",
      );
    }
    const context = {
      snapshotRef:
        repositorySnapshotRef(snapshot),
      evidence:
        evidenceRefMap(snapshot),
    };
    const reconstructions =
      args.reconstructions.map(
        (entry) =>
          normalizeReconstruction(
            entry,
            context,
          ),
      );
    const identities = new Set();
    for (const reconstruction of
      reconstructions) {
      const identity =
        `${reconstruction.conceptKey}:${reconstruction.posture}`;
      if (identities.has(identity)) {
        fail(
          "world_manager_aro_reconstruction_identity_duplicate",
          identity,
        );
      }
      identities.add(identity);
    }
    result = {
      callId: text(
        actionCalls[0].callId,
        "",
      ),
      repositorySummary: bounded(
        args.repositorySummary,
        "",
        1_200,
      ),
      selectionRationale: bounded(
        args.selectionRationale,
        "",
        1_200,
      ),
      reconstructions,
    };
  } catch (error) {
    errors.push({
      code: text(
        error?.code,
        "world_manager_aro_reconstruction_validation_failed",
      ),
      detail: bounded(
        error?.detail ||
          error?.message,
        "",
        500,
      ),
    });
  }
  const validation = {
    schema:
      ARO_RECONSTRUCTION_VALIDATION_SCHEMA,
    state: errors.length
      ? "remanded"
      : "validated",
    requiredContract:
      "exactly_one_native_aro_reconstruction_action",
    observedActionNames:
      actionCalls
        .map((call) =>
          text(call.name, ""))
        .filter(Boolean),
    errors,
    semanticContentValidatedAgainstClosedTaxonomy:
      false,
    semanticTruthValidated: false,
    canonicalAdmissionEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    ARO_RECONSTRUCTION_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return {
    validation,
    result,
  };
}

function candidatesFromResult(
  result,
  input = {},
) {
  const snapshot = input.snapshot;
  const snapshotRef =
    repositorySnapshotRef(snapshot);
  return result.reconstructions.map(
    (reconstruction) => {
      const evidenceRefs = [
        snapshotRef,
        ...reconstruction.branches
          .flatMap((branch) =>
            branch.provenanceRefs),
        ...reconstruction
          .realizationBindings
          .flatMap((binding) => [
            binding.sourceRef,
            ...binding.evidenceRefs,
          ]),
      ];
      const candidate =
        buildAroReconstructionCandidate({
          projectId:
            snapshot.projectId,
          repositorySnapshotRef:
            snapshotRef,
          evidenceRefs,
          contradictionRefs:
            reconstruction
              .contradictionRefs,
          reconstructionMethod:
            "bounded_direct_repository_semantic_reconstruction",
          createdAt:
            input.createdAt,
          now: input.now,
          candidateAro: {
            projectId:
              snapshot.projectId,
            conceptKey:
              reconstruction
                .conceptKey,
            semanticIdentity:
              reconstruction
                .semanticIdentity,
            purpose:
              reconstruction.purpose,
            posture:
              reconstruction.posture,
            branches:
              reconstruction.branches,
            edges:
              reconstruction.edges,
            realizationBindings:
              reconstruction
                .realizationBindings,
            provenanceRefs:
              evidenceRefs,
          },
        });
      validateAroReconstructionCandidate(
        candidate,
      );
      return candidate;
    },
  );
}

function normalizeTelemetry(
  value = {},
  state,
) {
  return {
    runtimeMode: text(
      value.runtimeMode,
      "direct_live",
    ),
    model: text(value.model, ""),
    reasoningEffort: text(
      value.reasoningEffort,
      "medium",
    ),
    inputTokens: Math.max(
      0,
      Number(value.inputTokens || 0),
    ),
    outputTokens: Math.max(
      0,
      Number(value.outputTokens || 0),
    ),
    toolCallCount: Math.max(
      0,
      Number(value.toolCallCount || 0),
    ),
    toolNames: uniqueStrings(
      value.toolNames,
    ),
    telemetrySource: text(
      value.telemetrySource,
      "harness_observed",
    ),
    terminalState: state,
    effectCount: 0,
    rawProviderPayloadStored: false,
    rawChainOfThoughtStored: false,
  };
}

function buildAroReconstructionRun(
  input = {},
) {
  const state = text(
    input.state,
    "scheduled",
  );
  if (!RUN_STATES.has(state)) {
    fail(
      "world_manager_aro_reconstruction_run_state_invalid",
      state,
    );
  }
  const projectId = text(
    input.projectId,
    "",
  );
  const snapshotRef = exactRef(
    input.repositorySnapshotRef,
    "aroRun.repositorySnapshotRef",
  );
  const attempt = Number(
    input.attempt || 1,
  );
  const runRevision = Number(
    input.runRevision || 1,
  );
  if (
    !projectId ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !Number.isInteger(runRevision) ||
    runRevision < 1
  ) {
    fail(
      "world_manager_aro_reconstruction_run_identity_invalid",
    );
  }
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_reconstruction_run",
      {
        projectId,
        snapshotRef,
        attempt,
      },
    ),
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "aroRun.predecessorRef",
        )
      : null;
  if (
    (runRevision === 1) ===
      Boolean(predecessorRef)
  ) {
    fail(
      "world_manager_aro_reconstruction_run_lineage_invalid",
    );
  }
  const candidateRefs = (
    Array.isArray(input.candidateRefs)
      ? input.candidateRefs
      : []
  ).map((ref, index) =>
    exactRef(
      ref,
      `aroRun.candidateRefs.${index}`,
    ));
  const error = input.error
    ? {
        code: text(
          input.error.code,
          "world_manager_aro_reconstruction_failed",
        ),
        message: bounded(
          input.error.message,
          "Repository semantic reconstruction failed.",
          500,
        ),
      }
    : null;
  const run = {
    schema:
      ARO_RECONSTRUCTION_RUN_SCHEMA,
    runId,
    runRevision,
    predecessorRef,
    projectId,
    repositorySnapshotRef:
      snapshotRef,
    attempt,
    state,
    requestManifest:
      input.requestManifest || null,
    validation:
      input.validation || null,
    candidateRefs,
    repositorySummary: bounded(
      input.repositorySummary,
      "",
      1_200,
    ),
    selectionRationale: bounded(
      input.selectionRationale,
      "",
      1_200,
    ),
    error,
    telemetry:
      input.telemetry || null,
    retryable:
      RETRYABLE_RUN_STATES.has(
        state,
      ),
    canonical: false,
    semanticTruthValidated: false,
    workspaceMutationEffect: false,
    admissionEffect: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
    updatedAt: text(
      input.updatedAt,
      input.createdAt ||
        nowIso(input.now),
    ),
  };
  run.digest = digestFor(
    ARO_RECONSTRUCTION_RUN_SCHEMA,
    run,
    ["digest"],
  );
  validateAroReconstructionRun(run);
  return run;
}

function validateAroReconstructionRun(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_RECONSTRUCTION_RUN_SCHEMA ||
    !text(value.runId, "") ||
    !Number.isInteger(
      Number(value.runRevision),
    ) ||
    !text(value.projectId, "") ||
    !Number.isInteger(
      Number(value.attempt),
    ) ||
    !RUN_STATES.has(value.state) ||
    !Array.isArray(value.candidateRefs) ||
    value.retryable !==
      RETRYABLE_RUN_STATES.has(
        value.state,
      ) ||
    value.canonical !== false ||
    value.semanticTruthValidated !==
      false ||
    value.workspaceMutationEffect !==
      false ||
    value.admissionEffect !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_RECONSTRUCTION_RUN_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_reconstruction_run_invalid",
    );
  }
  if (
    (Number(value.runRevision) === 1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_reconstruction_run_lineage_invalid",
    );
  }
  exactRef(
    value.repositorySnapshotRef,
    "aroRun.repositorySnapshotRef",
  );
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "aroRun.predecessorRef",
    );
  }
  value.candidateRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `aroRun.candidateRefs.${index}`,
      ),
  );
  if (
    value.state === "completed" &&
    !value.candidateRefs.length
  ) {
    fail(
      "world_manager_aro_reconstruction_completed_without_candidate",
    );
  }
  return true;
}

function reviseAroReconstructionRun(
  current,
  input = {},
) {
  validateAroReconstructionRun(
    current,
  );
  if (
    TERMINAL_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_reconstruction_terminal_run_immutable",
      current.runId,
    );
  }
  return buildAroReconstructionRun({
    ...current,
    ...input,
    runRevision:
      current.runRevision + 1,
    predecessorRef: exactRef({
      kind:
        "aro_reconstruction_run",
      id: current.runId,
      digest: current.digest,
      projectId:
        current.projectId,
    }),
    updatedAt: text(
      input.updatedAt,
      nowIso(input.now),
    ),
    digest: undefined,
  });
}

class DirectAroReconstructionRuntime {
  constructor(options = {}) {
    this.runner =
      typeof options.runner === "function"
        ? options.runner
        : null;
    this.now =
      typeof options.now === "function"
        ? options.now
        : Date.now;
  }

  available() {
    return Boolean(this.runner);
  }

  async run(input = {}) {
    const snapshot = input.snapshot;
    validateRepositorySemanticSnapshot(
      snapshot,
    );
    if (
      snapshot.observationState !==
        "observed"
    ) {
      return {
        state: "failed",
        requestManifest: null,
        validation: null,
        candidates: [],
        repositorySummary: "",
        selectionRationale: "",
        telemetry: normalizeTelemetry(
          {},
          "failed",
        ),
        error: {
          code:
            snapshot.observationError
              ?.code ||
            "world_manager_repository_observation_unavailable",
          message:
            snapshot.observationError
              ?.message ||
            "Repository evidence is unavailable.",
        },
      };
    }
    const projectId = text(
      input.projectId ||
        snapshot.projectId,
      "",
    );
    const attempt = Math.max(
      1,
      Number(input.attempt || 1),
    );
    const createdAt = nowIso(this.now);
    const {
      instructions,
      outputContract: contract,
      manifest,
    } = requestManifest({
      projectId,
      snapshot,
      attempt,
    });
    if (!this.runner) {
      const error = new Error(
        "world_manager_aro_reconstruction_runner_unavailable",
      );
      error.code =
        "world_manager_aro_reconstruction_runner_unavailable";
      throw error;
    }
    let runnerResult;
    try {
      runnerResult = await this.runner({
        schema:
          "direct_aro_reconstruction_runner_request@1",
        projectId,
        repositorySnapshotRef:
          repositorySnapshotRef(snapshot),
        attempt,
        instructions,
        prompt: reconstructionPrompt({
          project: input.project,
          snapshot,
        }),
        outputContract: contract,
        tools: contract.tools,
        toolChoicePolicy: "required",
        reasoningEffort:
          text(
            input.reasoningEffort,
            "medium",
          ),
        canonicalAdmissionEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      });
    } catch (error) {
      return {
        state: "failed",
        requestManifest: manifest,
        validation: null,
        candidates: [],
        repositorySummary: "",
        selectionRationale: "",
        telemetry: normalizeTelemetry(
          {},
          "failed",
        ),
        error: {
          code: text(
            error?.code,
            "world_manager_aro_reconstruction_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct semantic reconstruction failed.",
            500,
          ),
        },
      };
    }
    const validated =
      validateReconstructionAction(
        runnerResult,
        snapshot,
      );
    if (
      validated.validation.state !==
        "validated"
    ) {
      return {
        state: "remanded",
        requestManifest: manifest,
        validation:
          validated.validation,
        candidates: [],
        repositorySummary: "",
        selectionRationale: "",
        telemetry: normalizeTelemetry(
          runnerResult?.telemetry,
          "remanded",
        ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_aro_reconstruction_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The semantic reconstruction action did not satisfy its discharge form.",
        },
      };
    }
    const candidates =
      candidatesFromResult(
        validated.result,
        {
          snapshot,
          createdAt,
          now: this.now,
        },
      );
    return {
      state: "completed",
      requestManifest: manifest,
      validation:
        validated.validation,
      candidates,
      repositorySummary:
        validated.result
          .repositorySummary,
      selectionRationale:
        validated.result
          .selectionRationale,
      telemetry: normalizeTelemetry(
        runnerResult?.telemetry,
        "completed",
      ),
      error: null,
    };
  }
}

module.exports = {
  ARO_RECONSTRUCTION_ACTION,
  ARO_RECONSTRUCTION_REQUEST_MANIFEST_SCHEMA,
  ARO_RECONSTRUCTION_RUN_SCHEMA,
  ARO_RECONSTRUCTION_VALIDATION_SCHEMA,
  REPOSITORY_SEMANTIC_SNAPSHOT_SCHEMA,
  DirectAroReconstructionRuntime,
  buildAroReconstructionRun,
  buildRepositorySemanticSnapshot,
  reconstructionInstructions,
  reconstructionPrompt,
  reconstructionTool,
  repositorySnapshotRef,
  reviseAroReconstructionRun,
  validateAroReconstructionRun,
  validateRepositorySemanticSnapshot,
};
