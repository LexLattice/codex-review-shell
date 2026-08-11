"use strict";

const {
  digestFor,
  stableId,
  validateAbstractReasoningObject,
} = require("./aro-kernel");
const {
  mutationContractRef,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  repositorySnapshotRef,
  validateRepositorySemanticSnapshot,
} = require("./aro-reconstruction-runtime");

const ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA =
  "direct_aro_realization_context_import@1";
const ARO_REALIZATION_MAPPING_WITNESS_SCHEMA =
  "direct_aro_realization_mapping_witness@1";
const ARO_REALIZATION_MAPPING_RUN_SCHEMA =
  "direct_aro_realization_mapping_run@1";
const ARO_REALIZATION_MAPPING_VALIDATION_SCHEMA =
  "direct_aro_realization_mapping_validation@1";
const ARO_REALIZATION_MAPPING_REQUEST_MANIFEST_SCHEMA =
  "direct_aro_realization_mapping_request_manifest@1";
const ARO_REALIZATION_MAPPING_ACTION =
  "wm_discharge_aro_realization_mapping";

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
const COVERAGE_STATES = new Set([
  "mapped",
  "partial",
  "unmapped",
  "ambiguous",
]);
const MAPPING_POSTURES = new Set([
  "complete",
  "partial",
  "ambiguous",
  "blocked",
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
  max = 1_600,
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
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail(
      "world_manager_aro_realization_ref_invalid",
      label,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) ref.projectId = projectId;
  const refLabel = text(value.label, "");
  if (refLabel) {
    ref.label = bounded(
      refLabel,
      "",
      240,
    );
  }
  return ref;
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
    right &&
    left.kind === right.kind &&
    left.id === right.id &&
    left.digest === right.digest,
  );
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

function exactKeys(
  value,
  expected,
  label,
) {
  if (!isPlainObject(value)) {
    fail(
      "world_manager_aro_realization_object_required",
      label,
    );
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index],
    )
  ) {
    fail(
      "world_manager_aro_realization_form_mismatch",
      label,
    );
  }
}

function safeRelativePath(value) {
  const normalized = text(value, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    fail(
      "world_manager_aro_realization_path_invalid",
      normalized || "<empty>",
    );
  }
  return normalized;
}

function implementationObligationRef(
  contract,
  obligation,
) {
  validateAroMutationContract(contract);
  if (
    !obligation ||
    !contract.implementationObligations
      .some((entry) =>
        entry.obligationId ===
          obligation.obligationId &&
        entry.obligationKey ===
          obligation.obligationKey)
  ) {
    fail(
      "world_manager_aro_realization_obligation_unknown",
    );
  }
  return exactRef({
    kind:
      "aro_implementation_obligation",
    id: obligation.obligationId,
    digest: digestFor(
      "direct_aro_implementation_obligation@1",
      obligation,
    ),
    projectId: contract.projectId,
    label: obligation.title,
  });
}

function deriveRealizationContextPathRequest(
  input = {},
) {
  const contract = input.contract;
  const currentAro = input.currentAro;
  const targetAro = input.targetAro;
  const snapshot = input.repositorySnapshot;
  validateAroMutationContract(contract);
  validateAbstractReasoningObject(
    currentAro,
  );
  validateAbstractReasoningObject(
    targetAro,
  );
  validateRepositorySemanticSnapshot(
    snapshot,
  );
  if (
    contract.projectId !==
      currentAro.projectId ||
    contract.projectId !==
      targetAro.projectId ||
    contract.projectId !==
      snapshot.projectId ||
    contract.currentAroRef.id !==
      currentAro.aroId ||
    contract.currentAroRef.digest !==
      currentAro.digest ||
    contract.targetAroRef.id !==
      targetAro.aroId ||
    contract.targetAroRef.digest !==
      targetAro.digest
  ) {
    fail(
      "world_manager_aro_realization_path_request_binding_invalid",
    );
  }
  const operativeBranchIds = new Set(
    contract.implementationObligations
      .flatMap((obligation) =>
        obligation.branchRefs)
      .map((ref) => ref.id),
  );
  const evidenceBySourceIdentity =
    new Map();
  for (const evidence of snapshot.evidence) {
    evidenceBySourceIdentity.set(
      `${evidence.sourceRef.id}:${evidence.sourceRef.digest}`,
      evidence,
    );
  }
  const exactPaths = [];
  for (
    const aro of [
      currentAro,
      targetAro,
    ]
  ) {
    for (
      const binding of
        aro.realizationBindings
    ) {
      if (
        operativeBranchIds.size &&
        !operativeBranchIds.has(
          binding.branchRef.id,
        )
      ) {
        continue;
      }
      const evidence =
        evidenceBySourceIdentity.get(
          `${binding.sourceRef.id}:${binding.sourceRef.digest}`,
        ) ||
        snapshot.evidence.find(
          (entry) =>
            entry.relativePath ===
              binding.locator ||
            entry.sourceRef.id ===
              binding.sourceRef.id,
        );
      if (evidence) {
        exactPaths.push(
          evidence.relativePath,
        );
      }
    }
  }
  const dedupedExact =
    uniqueStrings(exactPaths);
  const selected =
    (
      dedupedExact.length
        ? dedupedExact
        : snapshot.evidence.map(
            (entry) =>
              entry.relativePath)
    )
      .slice(0, 12)
      .map(safeRelativePath);
  if (!selected.length) {
    fail(
      "world_manager_aro_realization_no_source_paths",
    );
  }
  return {
    requestedPaths: selected,
    selectionMode:
      dedupedExact.length
        ? "exact_aro_realization_bindings"
        : "bounded_repository_evidence_fallback",
    operativeObligationKeys:
      contract
        .implementationObligations
        .map((entry) =>
          entry.obligationKey),
    operativeBranchRefs:
      contract
        .implementationObligations
        .flatMap((entry) =>
          entry.branchRefs),
    maxFiles: 12,
    maxExcerptBytesPerFile:
      12_000,
    maxTotalExcerptBytes:
      96_000,
  };
}

function normalizeImportedEvidence(
  input,
  projectId,
  index,
) {
  if (!isPlainObject(input)) {
    fail(
      "world_manager_aro_realization_evidence_invalid",
      String(index),
    );
  }
  const relativePath =
    safeRelativePath(
      input.relativePath,
    );
  const sourceDigest = text(
    input.digest ||
      input.sourceDigest,
    "",
  );
  const excerpt =
    typeof input.excerpt ===
      "string"
      ? input.excerpt
      : "";
  if (
    Buffer.byteLength(
      excerpt,
      "utf8",
    ) > 12_000
  ) {
    fail(
      "world_manager_aro_realization_evidence_excerpt_limit",
      relativePath,
    );
  }
  const lineStart = Math.max(
    1,
    Number(input.lineStart || 1),
  );
  const inferredEnd =
    lineStart +
    Math.max(
      0,
      excerpt.split(/\r?\n/).length - 1,
    );
  const lineEnd = Math.max(
    lineStart,
    Number(
      input.lineEnd || inferredEnd,
    ),
  );
  if (!sourceDigest) {
    fail(
      "world_manager_aro_realization_evidence_digest_missing",
      relativePath,
    );
  }
  const evidenceKind = text(
    input.evidenceKind,
    "source_file",
  );
  const evidenceKey = text(
    input.evidenceKey,
    `realization_evidence_${index + 1}`,
  );
  const sourceRef = exactRef({
    kind: evidenceKind,
    id: stableId(
      "wm_aro_realization_source",
      {
        projectId,
        relativePath,
      },
    ),
    digest: sourceDigest,
    projectId,
    label: relativePath,
  });
  return {
    schema:
      "direct_aro_realization_source_evidence@1",
    evidenceKey,
    evidenceKind,
    relativePath,
    language: bounded(
      input.language,
      "",
      80,
    ),
    sizeBytes: Math.max(
      0,
      Number(input.sizeBytes || 0),
    ),
    lineStart,
    lineEnd,
    excerpt,
    excerptTruncated:
      input.excerptTruncated === true,
    sourceRef,
    sensitivePathRejected: false,
    grantsAuthority: false,
  };
}

function buildAroRealizationContextImport(
  input = {},
) {
  const contract = input.contract;
  const snapshot =
    input.repositorySnapshot;
  validateAroMutationContract(contract);
  validateRepositorySemanticSnapshot(
    snapshot,
  );
  const observation =
    input.observation || {};
  const projectId = contract.projectId;
  if (
    observation.schema !==
      "workspace_aro_realization_context_observation@1" ||
    text(
      observation.projectId,
      projectId,
    ) !== projectId ||
    observation.sourceInspectionEffect !==
      true ||
    observation.workspaceMutationEffect !==
      false ||
    observation.rawWorkspacePathIncluded !==
      false ||
    observation.rawSecretIncluded !==
      false
  ) {
    fail(
      "world_manager_aro_realization_observation_invalid",
    );
  }
  const pathRequest =
    input.pathRequest ||
    deriveRealizationContextPathRequest(
      input,
    );
  const requestedPaths =
    uniqueStrings(
      pathRequest.requestedPaths,
    ).map(safeRelativePath);
  const evidence = (
    Array.isArray(observation.evidence)
      ? observation.evidence
      : []
  ).map((entry, index) =>
    normalizeImportedEvidence(
      entry,
      projectId,
      index,
    ));
  if (
    requestedPaths.length >
      Math.min(
        12,
        Number(
          pathRequest.maxFiles || 12,
        ),
      ) ||
    evidence.length >
      Math.min(
        12,
        Number(
          pathRequest.maxFiles || 12,
        ),
      ) ||
    evidence.reduce(
      (total, entry) =>
        total +
        Buffer.byteLength(
          entry.excerpt,
          "utf8",
        ),
      0,
    ) >
      Math.min(
        96_000,
        Number(
          pathRequest
            .maxTotalExcerptBytes ||
            96_000,
        ),
      )
  ) {
    fail(
      "world_manager_aro_realization_import_budget_exceeded",
    );
  }
  const evidenceKeys = new Set();
  const selectedPaths = [];
  for (const entry of evidence) {
    if (evidenceKeys.has(entry.evidenceKey)) {
      fail(
        "world_manager_aro_realization_evidence_key_duplicate",
        entry.evidenceKey,
      );
    }
    if (
      !requestedPaths.includes(
        entry.relativePath,
      )
    ) {
      fail(
        "world_manager_aro_realization_unrequested_evidence",
        entry.relativePath,
      );
    }
    evidenceKeys.add(entry.evidenceKey);
    selectedPaths.push(
      entry.relativePath,
    );
  }
  const rejectedPaths = (
    Array.isArray(
      observation.rejectedPaths,
    )
      ? observation.rejectedPaths
      : []
  ).map((entry) => ({
    relativePath:
      safeRelativePath(
        entry.relativePath,
      ),
    reason: bounded(
      entry.reason,
      "unavailable",
      240,
    ),
  }));
  const omittedPaths =
    requestedPaths.filter(
      (relativePath) =>
        !selectedPaths.includes(
          relativePath,
        ) &&
        !rejectedPaths.some(
          (entry) =>
            entry.relativePath ===
              relativePath),
    );
  const repositoryIdentity = {
    headOid: bounded(
      observation
        .repositoryIdentity?.headOid,
      "",
      160,
    ),
    branch: bounded(
      observation
        .repositoryIdentity?.branch,
      "",
      240,
    ),
    statusDigest: text(
      observation
        .repositoryIdentity
        ?.statusDigest,
      "",
    ),
    diffDigest: text(
      observation
        .repositoryIdentity
        ?.diffDigest,
      "",
    ),
  };
  const basisIdentity =
    snapshot.repositoryIdentity;
  const freshness =
    repositoryIdentity.headOid &&
    basisIdentity.headOid &&
    repositoryIdentity.headOid !==
      basisIdentity.headOid
      ? "stale"
      : repositoryIdentity
          .statusDigest &&
        basisIdentity.statusDigest &&
        repositoryIdentity
          .statusDigest !==
          basisIdentity.statusDigest
        ? "changed"
        : repositoryIdentity
            .diffDigest &&
          basisIdentity.diffDigest &&
          repositoryIdentity
            .diffDigest !==
            basisIdentity.diffDigest
          ? "changed"
        : "fresh";
  const sourceIdentityDigest =
    digestFor(
      "direct_aro_realization_source_identity@1",
      {
        projectId,
        repositoryIdentity,
        sources: evidence.map(
          (entry) => ({
            relativePath:
              entry.relativePath,
            digest:
              entry.sourceRef.digest,
          })),
      },
    );
  const contextImport = {
    schema:
      ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA,
    contextImportId:
      stableId(
        "wm_aro_realization_context_import",
        {
          contractRef:
            mutationContractRef(
              contract,
            ),
          repositorySnapshotRef:
            repositorySnapshotRef(
              snapshot,
            ),
          sourceIdentityDigest,
        },
      ),
    projectId,
    contractRef:
      mutationContractRef(contract),
    comparisonRef:
      contract.comparisonRef,
    currentAroRef:
      contract.currentAroRef,
    targetAroRef:
      contract.targetAroRef,
    repositorySnapshotRef:
      repositorySnapshotRef(
        snapshot,
      ),
    workspaceKind: text(
      observation.workspaceKind,
      snapshot.workspaceKind,
    ),
    selectionWitness: {
      selectionMode: text(
        pathRequest.selectionMode,
        "bounded_repository_evidence_fallback",
      ),
      requestedPaths,
      selectedPaths:
        uniqueStrings(selectedPaths),
      rejectedPaths,
      omittedPaths,
      operativeObligationKeys:
        uniqueStrings(
          pathRequest
            .operativeObligationKeys,
        ),
      operativeBranchRefs:
        Array.isArray(
          pathRequest
            .operativeBranchRefs,
        )
          ? pathRequest
              .operativeBranchRefs
              .map((ref, index) =>
                exactRef(
                  ref,
                  `contextImport.operativeBranchRefs.${index}`,
                ))
          : [],
      maxFiles: Math.max(
        1,
        Number(
          pathRequest.maxFiles || 12,
        ),
      ),
      maxExcerptBytesPerFile:
        Math.max(
          1,
          Number(
            pathRequest
              .maxExcerptBytesPerFile ||
              12_000,
          ),
        ),
      maxTotalExcerptBytes:
        Math.max(
          1,
          Number(
            pathRequest
              .maxTotalExcerptBytes ||
              96_000,
          ),
        ),
      grantsAuthority: false,
    },
    repositoryIdentity,
    sourceIdentityDigest,
    freshness,
    evidence,
    sourceInspectionEffect: true,
    readOnlyEffect: true,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    executionAuthorityGranted: false,
    semanticTruthValidated: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    canonical: false,
    grantsAuthority: false,
    importedAt: text(
      observation.observedAt,
      nowIso(input.now),
    ),
  };
  contextImport.digest = digestFor(
    ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA,
    contextImport,
    [
      "digest",
      "importedAt",
    ],
  );
  validateAroRealizationContextImport(
    contextImport,
  );
  return contextImport;
}

function validateAroRealizationContextImport(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA ||
    !text(value.contextImportId, "") ||
    !text(value.projectId, "") ||
    !["fresh", "changed", "stale"]
      .includes(value.freshness) ||
    !isPlainObject(
      value.selectionWitness,
    ) ||
    !Array.isArray(
      value.selectionWitness
        .requestedPaths,
    ) ||
    !Array.isArray(
      value.selectionWitness
        .selectedPaths,
    ) ||
    !Array.isArray(
      value.selectionWitness
        .rejectedPaths,
    ) ||
    !Array.isArray(
      value.selectionWitness
        .omittedPaths,
    ) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length >
      value.selectionWitness
        .maxFiles ||
    value.selectionWitness
      .grantsAuthority !== false ||
    !Number.isInteger(
      Number(
        value.selectionWitness
          .maxFiles,
      ),
    ) ||
    Number(
      value.selectionWitness
        .maxFiles,
    ) < 1 ||
    value.selectionWitness
      .requestedPaths.length > 12 ||
    Number(
      value.selectionWitness
        .maxFiles,
    ) > 12 ||
    !Number.isInteger(
      Number(
        value.selectionWitness
          .maxExcerptBytesPerFile,
      ),
    ) ||
    Number(
      value.selectionWitness
        .maxExcerptBytesPerFile,
    ) < 1 ||
    Number(
      value.selectionWitness
        .maxExcerptBytesPerFile,
    ) > 12_000 ||
    !Number.isInteger(
      Number(
        value.selectionWitness
          .maxTotalExcerptBytes,
      ),
    ) ||
    Number(
      value.selectionWitness
        .maxTotalExcerptBytes,
    ) < 1 ||
    Number(
      value.selectionWitness
        .maxTotalExcerptBytes,
    ) > 96_000 ||
    !isPlainObject(
      value.repositoryIdentity,
    ) ||
    !text(
      value.sourceIdentityDigest,
      "",
    ) ||
    value.sourceInspectionEffect !==
      true ||
    value.readOnlyEffect !== true ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.executionAuthorityGranted !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.rawWorkspacePathIncluded !==
      false ||
    value.rawSecretIncluded !== false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA,
        value,
        [
          "digest",
          "importedAt",
        ],
      )
  ) {
    fail(
      "world_manager_aro_realization_context_import_invalid",
    );
  }
  for (
    const relativePath of [
      ...value.selectionWitness
        .requestedPaths,
      ...value.selectionWitness
        .selectedPaths,
      ...value.selectionWitness
        .omittedPaths,
    ]
  ) {
    safeRelativePath(relativePath);
  }
  for (
    const rejected of
      value.selectionWitness
        .rejectedPaths
  ) {
    if (
      !isPlainObject(rejected) ||
      !text(rejected.reason, "")
    ) {
      fail(
        "world_manager_aro_realization_rejected_path_invalid",
      );
    }
    safeRelativePath(
      rejected.relativePath,
    );
  }
  const requestedPathSet =
    new Set(
      value.selectionWitness
        .requestedPaths,
    );
  const selectedPathSet =
    new Set(
      value.selectionWitness
        .selectedPaths,
    );
  const rejectedPathSet =
    new Set(
      value.selectionWitness
        .rejectedPaths.map(
          (entry) =>
            entry.relativePath),
    );
  const omittedPathSet =
    new Set(
      value.selectionWitness
        .omittedPaths,
    );
  if (
    requestedPathSet.size !==
      value.selectionWitness
        .requestedPaths.length ||
    selectedPathSet.size !==
      value.selectionWitness
        .selectedPaths.length ||
    rejectedPathSet.size !==
      value.selectionWitness
        .rejectedPaths.length ||
    omittedPathSet.size !==
      value.selectionWitness
        .omittedPaths.length ||
    [
      ...selectedPathSet,
      ...rejectedPathSet,
      ...omittedPathSet,
    ].some((relativePath) =>
      !requestedPathSet.has(
        relativePath)) ||
    [...requestedPathSet].some(
      (relativePath) =>
        Number(
          selectedPathSet.has(
            relativePath),
        ) +
        Number(
          rejectedPathSet.has(
            relativePath),
        ) +
        Number(
          omittedPathSet.has(
            relativePath),
        ) !==
          1)
  ) {
    fail(
      "world_manager_aro_realization_selection_partition_invalid",
    );
  }
  for (
    const [label, ref] of [
      ["contractRef", value.contractRef],
      [
        "comparisonRef",
        value.comparisonRef,
      ],
      [
        "currentAroRef",
        value.currentAroRef,
      ],
      [
        "targetAroRef",
        value.targetAroRef,
      ],
      [
        "repositorySnapshotRef",
        value.repositorySnapshotRef,
      ],
    ]
  ) {
    exactRef(ref, label);
  }
  const keys = new Set();
  let totalExcerptBytes = 0;
  for (const entry of value.evidence) {
    if (
      !isPlainObject(entry) ||
      entry.schema !==
        "direct_aro_realization_source_evidence@1" ||
      !text(entry.evidenceKey, "") ||
      !text(entry.relativePath, "") ||
      !Number.isInteger(
        Number(entry.lineStart),
      ) ||
      !Number.isInteger(
        Number(entry.lineEnd),
      ) ||
      entry.lineStart < 1 ||
      entry.lineEnd <
        entry.lineStart ||
      entry.sensitivePathRejected !==
        false ||
      entry.grantsAuthority !== false
    ) {
      fail(
        "world_manager_aro_realization_evidence_invalid",
      );
    }
    if (keys.has(entry.evidenceKey)) {
      fail(
        "world_manager_aro_realization_evidence_key_duplicate",
        entry.evidenceKey,
      );
    }
    keys.add(entry.evidenceKey);
    if (
      !selectedPathSet.has(
        entry.relativePath,
      )
    ) {
      fail(
        "world_manager_aro_realization_evidence_selection_invalid",
        entry.relativePath,
      );
    }
    const excerptBytes =
      Buffer.byteLength(
        typeof entry.excerpt ===
          "string"
          ? entry.excerpt
          : "",
        "utf8",
      );
    if (
      excerptBytes >
        value.selectionWitness
          .maxExcerptBytesPerFile
    ) {
      fail(
        "world_manager_aro_realization_evidence_excerpt_limit",
        entry.relativePath,
      );
    }
    totalExcerptBytes +=
      excerptBytes;
    safeRelativePath(
      entry.relativePath,
    );
    exactRef(
      entry.sourceRef,
      entry.evidenceKey,
    );
  }
  if (
    totalExcerptBytes >
      value.selectionWitness
        .maxTotalExcerptBytes
  ) {
    fail(
      "world_manager_aro_realization_import_budget_exceeded",
    );
  }
  if (
    selectedPathSet.size !==
      new Set(
        value.evidence.map(
          (entry) =>
            entry.relativePath),
      ).size
  ) {
    fail(
      "world_manager_aro_realization_selected_evidence_mismatch",
    );
  }
  return true;
}

function realizationContextImportRef(
  contextImport,
) {
  validateAroRealizationContextImport(
    contextImport,
  );
  return exactRef({
    kind:
      "aro_realization_context_import",
    id: contextImport.contextImportId,
    digest: contextImport.digest,
    projectId: contextImport.projectId,
  });
}

function realizationMappingTool() {
  const sourceBinding = {
    type: "object",
    additionalProperties: false,
    properties: {
      evidenceKey: {
        type: "string",
      },
      symbol: { type: "string" },
      startLine: {
        type: "integer",
        minimum: 1,
      },
      endLine: {
        type: "integer",
        minimum: 1,
      },
      bindingKind: {
        type: "string",
      },
      rationale: {
        type: "string",
      },
    },
    required: [
      "evidenceKey",
      "symbol",
      "startLine",
      "endLine",
      "bindingKind",
      "rationale",
    ],
  };
  const obligationMapping = {
    type: "object",
    additionalProperties: false,
    properties: {
      obligationKey: {
        type: "string",
      },
      coverageState: {
        type: "string",
        enum: [
          ...COVERAGE_STATES,
        ],
      },
      sourceBindings: {
        type: "array",
        maxItems: 16,
        items: sourceBinding,
      },
      rationale: {
        type: "string",
      },
    },
    required: [
      "obligationKey",
      "coverageState",
      "sourceBindings",
      "rationale",
    ],
  };
  const ambiguity = {
    type: "object",
    additionalProperties: false,
    properties: {
      ambiguityKey: {
        type: "string",
      },
      statement: {
        type: "string",
      },
      obligationKeys: {
        type: "array",
        items: { type: "string" },
      },
      evidenceKeys: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "ambiguityKey",
      "statement",
      "obligationKeys",
      "evidenceKeys",
    ],
  };
  const omission = {
    type: "object",
    additionalProperties: false,
    properties: {
      omissionKey: {
        type: "string",
      },
      statement: {
        type: "string",
      },
      obligationKeys: {
        type: "array",
        items: { type: "string" },
      },
      requestedPaths: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "omissionKey",
      "statement",
      "obligationKeys",
      "requestedPaths",
    ],
  };
  return {
    type: "function",
    name:
      ARO_REALIZATION_MAPPING_ACTION,
    description:
      "Discharge one read-only mapping from the exact ARO mutation contract to the supplied bounded source evidence. Account for every implementation obligation. The mapping remains provisional and grants no execution or mutation authority.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mappingSummary: {
          type: "string",
        },
        obligationMappings: {
          type: "array",
          items: obligationMapping,
        },
        ambiguities: {
          type: "array",
          maxItems: 24,
          items: ambiguity,
        },
        omissions: {
          type: "array",
          maxItems: 24,
          items: omission,
        },
        assumptions: {
          type: "array",
          items: { type: "string" },
        },
        unresolvedQuestions: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "mappingSummary",
        "obligationMappings",
        "ambiguities",
        "omissions",
        "assumptions",
        "unresolvedQuestions",
      ],
    },
  };
}

function realizationMappingInstructions() {
  return [
    "You are the WorldManager's bounded ARO-to-code mapper.",
    "Treat the mutation contract and ARO branches as the objects that define what must change. Treat source code only as evidence of the current realization.",
    "Map every implementation obligation exactly once. Use mapped, partial, unmapped, or ambiguous honestly.",
    "Use only supplied evidence keys and line ranges. Never invent a file, symbol, path, obligation, or source location.",
    "A source binding identifies where a later worker should inspect or edit; it does not authorize that worker or certify correctness.",
    "Keep bindingKind semantically descriptive rather than forcing a closed taxonomy.",
    "Record meaningful ambiguity, omission, assumptions, and unresolved questions instead of hiding missing evidence.",
    `Call exactly one ${ARO_REALIZATION_MAPPING_ACTION} action. Emit no prose or JSON outside the action.`,
    "This action is read-only. It does not launch a worker, mutate a workspace, admit canonical state, validate semantic truth, or grant authority.",
  ].join("\n");
}

function realizationMappingPrompt(
  input = {},
) {
  const contract = input.contract;
  const contextImport =
    input.contextImport;
  validateAroMutationContract(contract);
  validateAroRealizationContextImport(
    contextImport,
  );
  return [
    "[EXACT MUTATION CONTRACT]",
    JSON.stringify({
      contractRef:
        mutationContractRef(
          contract,
        ),
      comparisonRef:
        contract.comparisonRef,
      currentAroRef:
        contract.currentAroRef,
      targetAroRef:
        contract.targetAroRef,
      contractSummary:
        contract.contractSummary,
      changeStrategy:
        contract.changeStrategy,
      implementationObligations:
        contract
          .implementationObligations
          .map((obligation) => ({
            obligationKey:
              obligation.obligationKey,
            obligationKind:
              obligation.obligationKind,
            title: obligation.title,
            objective:
              obligation.objective,
            branchRefs:
              obligation.branchRefs,
            priority:
              obligation.priority,
            rationale:
              obligation.rationale,
          })),
      preservationConstraints:
        contract
          .preservationConstraints,
      verificationRequirements:
        contract
          .verificationRequirements,
    }),
    "[REALIZATION CONTEXT IDENTITY]",
    JSON.stringify({
      contextImportRef:
        realizationContextImportRef(
          contextImport,
        ),
      repositorySnapshotRef:
        contextImport
          .repositorySnapshotRef,
      sourceIdentityDigest:
        contextImport
          .sourceIdentityDigest,
      freshness:
        contextImport.freshness,
      selectionWitness:
        contextImport
          .selectionWitness,
    }),
    "[BOUNDED SOURCE EVIDENCE]",
    JSON.stringify(
      contextImport.evidence.map(
        (entry) => ({
          evidenceKey:
            entry.evidenceKey,
          evidenceKind:
            entry.evidenceKind,
          relativePath:
            entry.relativePath,
          language: entry.language,
          lineStart:
            entry.lineStart,
          lineEnd: entry.lineEnd,
          excerpt: entry.excerpt,
          excerptTruncated:
            entry.excerptTruncated,
          sourceRef:
            entry.sourceRef,
        })),
    ),
    "[BOUNDARY]",
    JSON.stringify({
      sourceInspectionEffect: true,
      readOnlyEffect: true,
      workerLaunchEffect: false,
      workspaceMutationEffect: false,
      canonicalAdmissionEffect: false,
      executionAuthorityGranted: false,
      semanticTruthValidated: false,
    }),
  ].join("\n");
}

function realizationMappingRequestManifest(
  input = {},
) {
  const contract = input.contract;
  const contextImport =
    input.contextImport;
  const tool =
    realizationMappingTool();
  const instructions =
    realizationMappingInstructions();
  const manifest = {
    schema:
      ARO_REALIZATION_MAPPING_REQUEST_MANIFEST_SCHEMA,
    requestManifestId:
      stableId(
        "wm_aro_realization_mapping_request",
        {
          contractRef:
            mutationContractRef(
              contract,
            ),
          contextImportRef:
            realizationContextImportRef(
              contextImport,
            ),
          attempt:
            Number(input.attempt || 1),
        },
      ),
    projectId: contract.projectId,
    contractRef:
      mutationContractRef(contract),
    contextImportRef:
      realizationContextImportRef(
        contextImport,
      ),
    actionName:
      ARO_REALIZATION_MAPPING_ACTION,
    actionSchemaDigest:
      digestFor(
        "direct_aro_realization_mapping_tool@1",
        tool,
      ),
    instructionsDigest:
      digestFor(
        "direct_aro_realization_mapping_instructions@1",
        { instructions },
      ),
    exactObligationAccountingRequired:
      true,
    exactEvidenceBindingRequired:
      true,
    sourceInspectionEffect: true,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    ARO_REALIZATION_MAPPING_REQUEST_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return {
    instructions,
    outputContract: {
      schema:
        "direct_aro_realization_mapping_output_contract@1",
      requiredActionName:
        ARO_REALIZATION_MAPPING_ACTION,
      tools: [tool],
      exactObligationAccountingRequired:
        true,
      exactEvidenceBindingRequired:
        true,
      grantsAuthority: false,
    },
    manifest,
  };
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function actionCallsFromResult(
  result = {},
) {
  if (Array.isArray(result.actionCalls)) {
    return result.actionCalls;
  }
  if (
    Array.isArray(
      result.normalizedEvents,
    )
  ) {
    return result.normalizedEvents
      .filter((event) =>
        event?.type ===
          "action_call" ||
        event?.type ===
          "tool_call")
      .map((event) => ({
        callId:
          event.callId ||
          event.id ||
          "",
        name:
          event.name ||
          event.toolName ||
          "",
        argumentsJson:
          event.argumentsJson ||
          event.arguments ||
          "",
      }));
  }
  return [];
}

function validationResult(
  input = {},
) {
  const validation = {
    schema:
      ARO_REALIZATION_MAPPING_VALIDATION_SCHEMA,
    state:
      input.errors?.length
        ? "remanded"
        : "validated",
    actionNameValidated:
      input.actionNameValidated === true,
    exactFormValidated:
      input.exactFormValidated === true,
    exactObligationAccountingValidated:
      input
        .exactObligationAccountingValidated ===
      true,
    exactEvidenceBindingValidated:
      input
        .exactEvidenceBindingValidated ===
      true,
    lineBoundsValidated:
      input.lineBoundsValidated === true,
    errors:
      Array.isArray(input.errors)
        ? input.errors
        : [],
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    ARO_REALIZATION_MAPPING_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return validation;
}

function validateRealizationMappingAction(
  runnerResult,
  input = {},
) {
  const contract = input.contract;
  const contextImport =
    input.contextImport;
  validateAroMutationContract(contract);
  validateAroRealizationContextImport(
    contextImport,
  );
  const errors = [];
  const calls =
    actionCallsFromResult(
      runnerResult,
    );
  if (
    calls.length !== 1 ||
    calls[0]?.name !==
      ARO_REALIZATION_MAPPING_ACTION
  ) {
    errors.push({
      code:
        "world_manager_aro_realization_action_invalid",
      detail:
        "Exactly one realization-mapping action is required.",
    });
    return {
      result: null,
      validation:
        validationResult({
          errors,
        }),
    };
  }
  const args = parseArguments(
    calls[0].argumentsJson ??
      calls[0].arguments,
  );
  if (!args) {
    errors.push({
      code:
        "world_manager_aro_realization_arguments_invalid",
      detail:
        "The action arguments were not a JSON object.",
    });
    return {
      result: null,
      validation:
        validationResult({
          actionNameValidated: true,
          errors,
        }),
    };
  }
  let exactFormValidated = false;
  try {
    exactKeys(
      args,
      [
        "mappingSummary",
        "obligationMappings",
        "ambiguities",
        "omissions",
        "assumptions",
        "unresolvedQuestions",
      ],
      "mapping",
    );
    if (
      !Array.isArray(
        args.obligationMappings,
      ) ||
      !Array.isArray(
        args.ambiguities,
      ) ||
      !Array.isArray(args.omissions) ||
      !Array.isArray(
        args.assumptions,
      ) ||
      !Array.isArray(
        args.unresolvedQuestions,
      ) ||
      !text(
        args.mappingSummary,
        "",
      )
    ) {
      fail(
        "world_manager_aro_realization_form_mismatch",
        "mapping",
      );
    }
    args.obligationMappings.forEach(
      (entry, index) => {
        exactKeys(
          entry,
          [
            "obligationKey",
            "coverageState",
            "sourceBindings",
            "rationale",
          ],
          `obligationMappings.${index}`,
        );
        if (
          !COVERAGE_STATES.has(
            entry.coverageState,
          ) ||
          !Array.isArray(
            entry.sourceBindings,
          )
        ) {
          fail(
            "world_manager_aro_realization_mapping_form_invalid",
            String(index),
          );
        }
        entry.sourceBindings
          .forEach(
            (binding, bindingIndex) =>
              exactKeys(
                binding,
                [
                  "evidenceKey",
                  "symbol",
                  "startLine",
                  "endLine",
                  "bindingKind",
                  "rationale",
                ],
                `obligationMappings.${index}.sourceBindings.${bindingIndex}`,
              ));
      },
    );
    args.ambiguities.forEach(
      (entry, index) =>
        exactKeys(
          entry,
          [
            "ambiguityKey",
            "statement",
            "obligationKeys",
            "evidenceKeys",
          ],
          `ambiguities.${index}`,
        ));
    args.omissions.forEach(
      (entry, index) =>
        exactKeys(
          entry,
          [
            "omissionKey",
            "statement",
            "obligationKeys",
            "requestedPaths",
          ],
          `omissions.${index}`,
        ));
    exactFormValidated = true;
  } catch (error) {
    errors.push({
      code:
        error.code ||
        "world_manager_aro_realization_form_invalid",
      detail:
        error.detail ||
        error.message,
    });
  }
  const obligationByKey =
    new Map(
      contract
        .implementationObligations
        .map((entry) => [
          entry.obligationKey,
          entry,
        ]),
    );
  const evidenceByKey =
    new Map(
      contextImport.evidence.map(
        (entry) => [
          entry.evidenceKey,
          entry,
        ]),
    );
  let exactObligationAccountingValidated =
    exactFormValidated;
  let exactEvidenceBindingValidated =
    exactFormValidated;
  let lineBoundsValidated =
    exactFormValidated;
  const normalizedMappings = [];
  const seenObligations = new Set();
  if (exactFormValidated) {
    for (
      const mapping of
        args.obligationMappings
    ) {
      const obligation =
        obligationByKey.get(
          mapping.obligationKey,
        );
      if (
        !obligation ||
        seenObligations.has(
          mapping.obligationKey,
        )
      ) {
        exactObligationAccountingValidated =
          false;
        errors.push({
          code:
            "world_manager_aro_realization_obligation_accounting_invalid",
          detail:
            mapping.obligationKey,
        });
        continue;
      }
      seenObligations.add(
        mapping.obligationKey,
      );
      const sourceBindings = [];
      for (
        const binding of
          mapping.sourceBindings
      ) {
        const evidence =
          evidenceByKey.get(
            binding.evidenceKey,
          );
        if (!evidence) {
          exactEvidenceBindingValidated =
            false;
          errors.push({
            code:
              "world_manager_aro_realization_evidence_selector_invalid",
            detail:
              binding.evidenceKey,
          });
          continue;
        }
        const startLine = Number(
          binding.startLine,
        );
        const endLine = Number(
          binding.endLine,
        );
        if (
          !Number.isInteger(
            startLine,
          ) ||
          !Number.isInteger(endLine) ||
          startLine <
            evidence.lineStart ||
          endLine >
            evidence.lineEnd ||
          endLine < startLine
        ) {
          lineBoundsValidated = false;
          errors.push({
            code:
              "world_manager_aro_realization_line_range_invalid",
            detail:
              `${binding.evidenceKey}:${startLine}-${endLine}`,
          });
          continue;
        }
        sourceBindings.push({
          evidence,
          symbol: bounded(
            binding.symbol,
            "(file scope)",
            400,
          ),
          startLine,
          endLine,
          bindingKind: bounded(
            binding.bindingKind,
            "implementation",
            160,
          ),
          rationale: bounded(
            binding.rationale,
            "",
            1_200,
          ),
        });
      }
      if (
        (
          mapping.coverageState ===
            "mapped" ||
          mapping.coverageState ===
            "partial"
        ) &&
        sourceBindings.length === 0
      ) {
        exactEvidenceBindingValidated =
          false;
        errors.push({
          code:
            "world_manager_aro_realization_mapping_evidence_required",
          detail:
            mapping.obligationKey,
        });
      }
      if (
        mapping.coverageState ===
          "unmapped" &&
        sourceBindings.length
      ) {
        exactEvidenceBindingValidated =
          false;
        errors.push({
          code:
            "world_manager_aro_realization_unmapped_has_binding",
          detail:
            mapping.obligationKey,
        });
      }
      normalizedMappings.push({
        obligation,
        coverageState:
          mapping.coverageState,
        sourceBindings,
        rationale: bounded(
          mapping.rationale,
          "",
          1_200,
        ),
      });
    }
    if (
      seenObligations.size !==
        obligationByKey.size ||
      [
        ...obligationByKey.keys(),
      ].some((key) =>
        !seenObligations.has(key))
    ) {
      exactObligationAccountingValidated =
        false;
      errors.push({
        code:
          "world_manager_aro_realization_obligation_coverage_incomplete",
        detail:
          "Every implementation obligation must appear exactly once.",
      });
    }
  }
  const knownObligations =
    new Set(obligationByKey.keys());
  const knownEvidence =
    new Set(evidenceByKey.keys());
  const requestedPaths =
    new Set(
      contextImport
        .selectionWitness
        .requestedPaths,
    );
  function referencesKnown(
    entries,
    keyName,
    known,
    code,
  ) {
    for (const entry of entries) {
      if (
        !Array.isArray(
          entry[keyName],
        ) ||
        entry[keyName].some(
          (key) => !known.has(key))
      ) {
        errors.push({
          code,
          detail: text(
            entry.ambiguityKey ||
              entry.omissionKey,
            "entry",
          ),
        });
        return false;
      }
    }
    return true;
  }
  if (exactFormValidated) {
    if (
      !referencesKnown(
        args.ambiguities,
        "obligationKeys",
        knownObligations,
        "world_manager_aro_realization_ambiguity_obligation_invalid",
      ) ||
      !referencesKnown(
        args.omissions,
        "obligationKeys",
        knownObligations,
        "world_manager_aro_realization_omission_obligation_invalid",
      )
    ) {
      exactObligationAccountingValidated =
        false;
    }
    if (
      !referencesKnown(
        args.ambiguities,
        "evidenceKeys",
        knownEvidence,
        "world_manager_aro_realization_ambiguity_evidence_invalid",
      )
    ) {
      exactEvidenceBindingValidated =
        false;
    }
    for (const omission of args.omissions) {
      if (
        !Array.isArray(
          omission.requestedPaths,
        ) ||
        omission.requestedPaths.some(
          (relativePath) =>
            !requestedPaths.has(
              relativePath))
      ) {
        exactEvidenceBindingValidated =
          false;
        errors.push({
          code:
            "world_manager_aro_realization_omission_path_invalid",
          detail:
            omission.omissionKey,
        });
      }
    }
  }
  const validated =
    exactFormValidated &&
    exactObligationAccountingValidated &&
    exactEvidenceBindingValidated &&
    lineBoundsValidated &&
    errors.length === 0;
  return {
    result: validated
      ? {
          mappingSummary: bounded(
            args.mappingSummary,
            "",
            1_600,
          ),
          obligationMappings:
            normalizedMappings,
          ambiguities:
            args.ambiguities,
          omissions:
            args.omissions,
          assumptions:
            uniqueStrings(
              args.assumptions,
            ),
          unresolvedQuestions:
            uniqueStrings(
              args.unresolvedQuestions,
            ),
        }
      : null,
    validation:
      validationResult({
        actionNameValidated: true,
        exactFormValidated,
        exactObligationAccountingValidated,
        exactEvidenceBindingValidated,
        lineBoundsValidated,
        errors,
      }),
  };
}

function derivedMappingPosture(
  obligationMappings,
  ambiguities,
) {
  if (
    obligationMappings.some(
      (entry) =>
        entry.coverageState ===
          "ambiguous") ||
    ambiguities.length
  ) {
    return "ambiguous";
  }
  if (
    obligationMappings.length &&
    obligationMappings.every(
      (entry) =>
        entry.coverageState ===
          "mapped")
  ) {
    return "complete";
  }
  if (
    obligationMappings.length &&
    obligationMappings.every(
      (entry) =>
        entry.coverageState ===
          "unmapped")
  ) {
    return "blocked";
  }
  return "partial";
}

function buildAroRealizationMappingWitness(
  input = {},
) {
  const contract = input.contract;
  const contextImport =
    input.contextImport;
  validateAroMutationContract(contract);
  validateAroRealizationContextImport(
    contextImport,
  );
  const contractReference =
    mutationContractRef(contract);
  if (
    !exactRefMatches(
      contextImport.contractRef,
      contractReference,
    )
  ) {
    fail(
      "world_manager_aro_realization_mapping_contract_binding_invalid",
    );
  }
  const mappings =
    input.obligationMappings.map(
      (mapping) => ({
        schema:
          "direct_aro_obligation_realization_mapping@1",
        mappingEntryId:
          stableId(
            "wm_aro_obligation_realization_mapping",
            {
              contractReference,
              obligationKey:
                mapping.obligation
                  .obligationKey,
            },
          ),
        obligationRef:
          implementationObligationRef(
            contract,
            mapping.obligation,
          ),
        obligationKey:
          mapping.obligation
            .obligationKey,
        branchRefs:
          mapping.obligation
            .branchRefs,
        coverageState:
          mapping.coverageState,
        sourceBindings:
          mapping.sourceBindings.map(
            (binding) => ({
              schema:
                "direct_aro_source_realization_binding@1",
              sourceBindingId:
                stableId(
                  "wm_aro_source_realization_binding",
                  {
                    obligationKey:
                      mapping
                        .obligation
                        .obligationKey,
                    evidenceKey:
                      binding
                        .evidence
                        .evidenceKey,
                    symbol:
                      binding.symbol,
                    startLine:
                      binding.startLine,
                    endLine:
                      binding.endLine,
                  },
                ),
              evidenceKey:
                binding.evidence
                  .evidenceKey,
              sourceRef:
                binding.evidence
                  .sourceRef,
              relativePath:
                binding.evidence
                  .relativePath,
              symbol:
                binding.symbol,
              startLine:
                binding.startLine,
              endLine:
                binding.endLine,
              bindingKind:
                binding.bindingKind,
              rationale:
                binding.rationale,
              grantsAuthority: false,
            })),
        rationale: mapping.rationale,
        grantsAuthority: false,
      }));
  const posture =
    derivedMappingPosture(
      mappings,
      input.ambiguities,
    );
  const witness = {
    schema:
      ARO_REALIZATION_MAPPING_WITNESS_SCHEMA,
    mappingWitnessId:
      stableId(
        "wm_aro_realization_mapping_witness",
        {
          contractReference,
          contextImportRef:
            realizationContextImportRef(
              contextImport,
            ),
        },
      ),
    projectId: contract.projectId,
    contractRef:
      contractReference,
    comparisonRef:
      contract.comparisonRef,
    currentAroRef:
      contract.currentAroRef,
    targetAroRef:
      contract.targetAroRef,
    repositorySnapshotRef:
      contextImport
        .repositorySnapshotRef,
    contextImportRef:
      realizationContextImportRef(
        contextImport,
      ),
    sourceIdentityDigest:
      contextImport
        .sourceIdentityDigest,
    freshness:
      contextImport.freshness,
    mappingSummary: bounded(
      input.mappingSummary,
      "",
      1_600,
    ),
    mappingPosture: posture,
    obligationMappings: mappings,
    mappedObligationCount:
      mappings.filter((entry) =>
        entry.coverageState ===
          "mapped").length,
    partialObligationCount:
      mappings.filter((entry) =>
        entry.coverageState ===
          "partial").length,
    unmappedObligationCount:
      mappings.filter((entry) =>
        entry.coverageState ===
          "unmapped").length,
    ambiguousObligationCount:
      mappings.filter((entry) =>
        entry.coverageState ===
          "ambiguous").length,
    ambiguities:
      input.ambiguities.map(
        (entry) => ({
          schema:
            "direct_aro_realization_ambiguity@1",
          ambiguityId:
            stableId(
              "wm_aro_realization_ambiguity",
              {
                contractReference,
                ambiguityKey:
                  entry.ambiguityKey,
              },
            ),
          ambiguityKey:
            text(
              entry.ambiguityKey,
              "",
            ),
          statement: bounded(
            entry.statement,
            "",
            1_200,
          ),
          obligationKeys:
            uniqueStrings(
              entry.obligationKeys,
            ),
          evidenceKeys:
            uniqueStrings(
              entry.evidenceKeys,
            ),
          grantsAuthority: false,
        })),
    omissions:
      input.omissions.map(
        (entry) => ({
          schema:
            "direct_aro_realization_omission@1",
          omissionId:
            stableId(
              "wm_aro_realization_omission",
              {
                contractReference,
                omissionKey:
                  entry.omissionKey,
              },
            ),
          omissionKey: text(
            entry.omissionKey,
            "",
          ),
          statement: bounded(
            entry.statement,
            "",
            1_200,
          ),
          obligationKeys:
            uniqueStrings(
              entry.obligationKeys,
            ),
          requestedPaths:
            uniqueStrings(
              entry.requestedPaths,
            ),
          grantsAuthority: false,
        })),
    assumptions:
      uniqueStrings(
        input.assumptions,
      ),
    unresolvedQuestions:
      uniqueStrings(
        input.unresolvedQuestions,
      ),
    lifecycle: "candidate",
    reviewState: "pending",
    workerLaunchState:
      "unavailable_sc8_2",
    sourceInspectionEffect: true,
    readOnlyEffect: true,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    executionAuthorityGranted: false,
    semanticTruthValidated: false,
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  witness.digest = digestFor(
    ARO_REALIZATION_MAPPING_WITNESS_SCHEMA,
    witness,
    ["digest"],
  );
  validateAroRealizationMappingWitness(
    witness,
  );
  return witness;
}

function validateAroRealizationMappingWitness(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_REALIZATION_MAPPING_WITNESS_SCHEMA ||
    !text(
      value.mappingWitnessId,
      "",
    ) ||
    !text(value.projectId, "") ||
    !MAPPING_POSTURES.has(
      value.mappingPosture,
    ) ||
    !Array.isArray(
      value.obligationMappings,
    ) ||
    !Array.isArray(
      value.ambiguities,
    ) ||
    !Array.isArray(value.omissions) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(
      value.unresolvedQuestions,
    ) ||
    value.lifecycle !== "candidate" ||
    value.reviewState !== "pending" ||
    value.workerLaunchState !==
      "unavailable_sc8_2" ||
    value.sourceInspectionEffect !==
      true ||
    value.readOnlyEffect !== true ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.executionAuthorityGranted !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_REALIZATION_MAPPING_WITNESS_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_realization_mapping_witness_invalid",
    );
  }
  for (
    const [label, ref] of [
      ["contractRef", value.contractRef],
      [
        "comparisonRef",
        value.comparisonRef,
      ],
      [
        "currentAroRef",
        value.currentAroRef,
      ],
      [
        "targetAroRef",
        value.targetAroRef,
      ],
      [
        "repositorySnapshotRef",
        value.repositorySnapshotRef,
      ],
      [
        "contextImportRef",
        value.contextImportRef,
      ],
    ]
  ) {
    exactRef(ref, label);
  }
  const obligationIds = new Set();
  for (
    const mapping of
      value.obligationMappings
  ) {
    if (
      !isPlainObject(mapping) ||
      mapping.schema !==
        "direct_aro_obligation_realization_mapping@1" ||
      !COVERAGE_STATES.has(
        mapping.coverageState,
      ) ||
      !Array.isArray(
        mapping.branchRefs,
      ) ||
      !Array.isArray(
        mapping.sourceBindings,
      ) ||
      mapping.grantsAuthority !== false
    ) {
      fail(
        "world_manager_aro_realization_obligation_mapping_invalid",
      );
    }
    const obligationRef =
      exactRef(
        mapping.obligationRef,
        "mapping.obligationRef",
      );
    if (
      obligationIds.has(
        obligationRef.id,
      )
    ) {
      fail(
        "world_manager_aro_realization_obligation_mapping_duplicate",
        obligationRef.id,
      );
    }
    obligationIds.add(
      obligationRef.id,
    );
    for (
      const binding of
        mapping.sourceBindings
    ) {
      if (
        !isPlainObject(binding) ||
        binding.schema !==
          "direct_aro_source_realization_binding@1" ||
        !text(
          binding.relativePath,
          "",
        ) ||
        !Number.isInteger(
          Number(binding.startLine),
        ) ||
        !Number.isInteger(
          Number(binding.endLine),
        ) ||
        binding.endLine <
          binding.startLine ||
        binding.grantsAuthority !==
          false
      ) {
        fail(
          "world_manager_aro_source_realization_binding_invalid",
        );
      }
      exactRef(
        binding.sourceRef,
        "mapping.sourceRef",
      );
    }
  }
  const counts = {
    mapped:
      value.obligationMappings
        .filter((entry) =>
          entry.coverageState ===
            "mapped").length,
    partial:
      value.obligationMappings
        .filter((entry) =>
          entry.coverageState ===
            "partial").length,
    unmapped:
      value.obligationMappings
        .filter((entry) =>
          entry.coverageState ===
            "unmapped").length,
    ambiguous:
      value.obligationMappings
        .filter((entry) =>
          entry.coverageState ===
            "ambiguous").length,
  };
  if (
    value.mappedObligationCount !==
      counts.mapped ||
    value.partialObligationCount !==
      counts.partial ||
    value.unmappedObligationCount !==
      counts.unmapped ||
    value.ambiguousObligationCount !==
      counts.ambiguous
  ) {
    fail(
      "world_manager_aro_realization_mapping_counts_invalid",
    );
  }
  const derived =
    derivedMappingPosture(
      value.obligationMappings,
      value.ambiguities,
    );
  if (derived !== value.mappingPosture) {
    fail(
      "world_manager_aro_realization_mapping_posture_invalid",
    );
  }
  return true;
}

function realizationMappingWitnessRef(
  witness,
) {
  validateAroRealizationMappingWitness(
    witness,
  );
  return exactRef({
    kind:
      "aro_realization_mapping_witness",
    id: witness.mappingWitnessId,
    digest: witness.digest,
    projectId: witness.projectId,
  });
}

function normalizeTelemetry(
  value = {},
  state = "",
) {
  return {
    runtimeMode: text(
      value.runtimeMode,
      "",
    ),
    model: text(value.model, ""),
    reasoningEffort: text(
      value.reasoningEffort,
      "",
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
      "",
    ),
    terminalState: state,
  };
}

function buildAroRealizationMappingRun(
  input = {},
) {
  const contractRef =
    exactRef(
      input.contractRef,
      "mappingRun.contractRef",
    );
  const contextImportRef =
    exactRef(
      input.contextImportRef,
      "mappingRun.contextImportRef",
    );
  const state = text(
    input.state,
    "scheduled",
  );
  const attempt = Math.max(
    1,
    Number(input.attempt || 1),
  );
  const runRevision = Math.max(
    1,
    Number(input.runRevision || 1),
  );
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_realization_mapping_run",
      {
        contractRef,
        contextImportRef,
      },
    ),
  );
  const run = {
    schema:
      ARO_REALIZATION_MAPPING_RUN_SCHEMA,
    runId,
    runRevision,
    predecessorRef:
      input.predecessorRef
        ? exactRef(
            input.predecessorRef,
            "mappingRun.predecessorRef",
          )
        : null,
    projectId: text(
      input.projectId,
      contractRef.projectId || "",
    ),
    contractRef,
    comparisonRef:
      exactRef(
        input.comparisonRef,
        "mappingRun.comparisonRef",
      ),
    currentAroRef:
      exactRef(
        input.currentAroRef,
        "mappingRun.currentAroRef",
      ),
    targetAroRef:
      exactRef(
        input.targetAroRef,
        "mappingRun.targetAroRef",
      ),
    repositorySnapshotRef:
      exactRef(
        input.repositorySnapshotRef,
        "mappingRun.repositorySnapshotRef",
      ),
    contextImportRef,
    sourceIdentityDigest: text(
      input.sourceIdentityDigest,
      "",
    ),
    attempt,
    state,
    requestManifest:
      input.requestManifest || null,
    validation:
      input.validation || null,
    mappingWitnessRef:
      input.mappingWitnessRef
        ? exactRef(
            input.mappingWitnessRef,
            "mappingRun.mappingWitnessRef",
          )
        : null,
    telemetry:
      input.telemetry
        ? normalizeTelemetry(
            input.telemetry,
            state,
          )
        : null,
    error: input.error
      ? {
          code: text(
            input.error.code,
            "world_manager_aro_realization_mapping_failed",
          ),
          message: bounded(
            input.error.message,
            "ARO realization mapping failed.",
            500,
          ),
        }
      : null,
    retryable:
      RETRYABLE_RUN_STATES.has(
        state,
      ) &&
      attempt < 3,
    sourceInspectionEffect: true,
    readOnlyEffect: true,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    executionAuthorityGranted: false,
    semanticTruthValidated: false,
    canonical: false,
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
    ARO_REALIZATION_MAPPING_RUN_SCHEMA,
    run,
    ["digest"],
  );
  validateAroRealizationMappingRun(run);
  return run;
}

function validateAroRealizationMappingRun(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_REALIZATION_MAPPING_RUN_SCHEMA ||
    !text(value.runId, "") ||
    !Number.isInteger(
      Number(value.runRevision),
    ) ||
    !text(value.projectId, "") ||
    !text(
      value.sourceIdentityDigest,
      "",
    ) ||
    !Number.isInteger(
      Number(value.attempt),
    ) ||
    !RUN_STATES.has(value.state) ||
    value.retryable !==
      (
        RETRYABLE_RUN_STATES.has(
          value.state,
        ) &&
        value.attempt < 3
      ) ||
    value.sourceInspectionEffect !==
      true ||
    value.readOnlyEffect !== true ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.executionAuthorityGranted !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_REALIZATION_MAPPING_RUN_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_realization_mapping_run_invalid",
    );
  }
  for (
    const [label, ref] of [
      ["contractRef", value.contractRef],
      [
        "comparisonRef",
        value.comparisonRef,
      ],
      [
        "currentAroRef",
        value.currentAroRef,
      ],
      [
        "targetAroRef",
        value.targetAroRef,
      ],
      [
        "repositorySnapshotRef",
        value.repositorySnapshotRef,
      ],
      [
        "contextImportRef",
        value.contextImportRef,
      ],
    ]
  ) {
    exactRef(ref, label);
  }
  if (
    (value.runRevision === 1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_realization_mapping_run_lineage_invalid",
    );
  }
  if (
    value.mappingWitnessRef &&
    value.state !== "completed"
  ) {
    fail(
      "world_manager_aro_realization_mapping_run_witness_state_invalid",
    );
  }
  if (
    value.state === "completed" &&
    !value.mappingWitnessRef
  ) {
    fail(
      "world_manager_aro_realization_mapping_run_witness_missing",
    );
  }
  if (
    value.error &&
    !["failed", "remanded"].includes(
      value.state,
    )
  ) {
    fail(
      "world_manager_aro_realization_mapping_run_error_state_invalid",
    );
  }
  return true;
}

function reviseAroRealizationMappingRun(
  previous,
  changes = {},
) {
  validateAroRealizationMappingRun(
    previous,
  );
  if (TERMINAL_RUN_STATES.has(
    previous.state,
  )) {
    fail(
      "world_manager_aro_realization_mapping_run_terminal",
      previous.runId,
    );
  }
  return buildAroRealizationMappingRun({
    ...previous,
    ...changes,
    runRevision:
      previous.runRevision + 1,
    predecessorRef: {
      kind:
        "aro_realization_mapping_run",
      id: previous.runId,
      digest: previous.digest,
      projectId:
        previous.projectId,
    },
    createdAt: previous.createdAt,
    updatedAt: text(
      changes.updatedAt,
      nowIso(changes.now),
    ),
  });
}

class DirectAroRealizationMappingRuntime {
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
    const contract = input.contract;
    const contextImport =
      input.contextImport;
    validateAroMutationContract(contract);
    validateAroRealizationContextImport(
      contextImport,
    );
    const attempt = Math.max(
      1,
      Number(input.attempt || 1),
    );
    const createdAt =
      nowIso(this.now);
    const {
      instructions,
      outputContract,
      manifest,
    } =
      realizationMappingRequestManifest({
        contract,
        contextImport,
        attempt,
      });
    if (!this.runner) {
      fail(
        "world_manager_aro_realization_mapping_runner_unavailable",
      );
    }
    let runnerResult;
    try {
      runnerResult =
        await this.runner({
          schema:
            "direct_aro_realization_mapping_runner_request@1",
          projectId:
            contract.projectId,
          contractRef:
            mutationContractRef(
              contract,
            ),
          contextImportRef:
            realizationContextImportRef(
              contextImport,
            ),
          attempt,
          instructions,
          prompt:
            realizationMappingPrompt({
              contract,
              contextImport,
            }),
          outputContract,
          tools:
            outputContract.tools,
          toolChoicePolicy:
            "required",
          reasoningEffort: text(
            input.reasoningEffort,
            "medium",
          ),
          sourceInspectionEffect: true,
          readOnlyEffect: true,
          workerLaunchEffect: false,
          workspaceMutationEffect: false,
          canonicalAdmissionEffect: false,
          grantsAuthority: false,
        });
    } catch (error) {
      return {
        state: "failed",
        requestManifest: manifest,
        validation: null,
        mappingWitness: null,
        telemetry:
          normalizeTelemetry(
            {},
            "failed",
          ),
        error: {
          code: text(
            error?.code,
            "world_manager_aro_realization_mapping_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct ARO realization mapping failed.",
            500,
          ),
        },
      };
    }
    const validated =
      validateRealizationMappingAction(
        runnerResult,
        {
          contract,
          contextImport,
        },
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
        mappingWitness: null,
        telemetry:
          normalizeTelemetry(
            runnerResult?.telemetry,
            "remanded",
          ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_aro_realization_mapping_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The semantic mapping action did not satisfy its discharge contract.",
        },
      };
    }
    const mappingWitness =
      buildAroRealizationMappingWitness({
        contract,
        contextImport,
        ...validated.result,
        createdAt,
        now: this.now,
      });
    return {
      state: "completed",
      requestManifest: manifest,
      validation:
        validated.validation,
      mappingWitness,
      telemetry:
        normalizeTelemetry(
          runnerResult?.telemetry,
          "completed",
        ),
      error: null,
    };
  }
}

module.exports = {
  ARO_REALIZATION_CONTEXT_IMPORT_SCHEMA,
  ARO_REALIZATION_MAPPING_ACTION,
  ARO_REALIZATION_MAPPING_REQUEST_MANIFEST_SCHEMA,
  ARO_REALIZATION_MAPPING_RUN_SCHEMA,
  ARO_REALIZATION_MAPPING_VALIDATION_SCHEMA,
  ARO_REALIZATION_MAPPING_WITNESS_SCHEMA,
  DirectAroRealizationMappingRuntime,
  buildAroRealizationContextImport,
  buildAroRealizationMappingRun,
  buildAroRealizationMappingWitness,
  deriveRealizationContextPathRequest,
  implementationObligationRef,
  realizationContextImportRef,
  realizationMappingInstructions,
  realizationMappingPrompt,
  realizationMappingRequestManifest,
  realizationMappingTool,
  realizationMappingWitnessRef,
  reviseAroRealizationMappingRun,
  validateAroRealizationContextImport,
  validateAroRealizationMappingRun,
  validateAroRealizationMappingWitness,
  validateRealizationMappingAction,
};
