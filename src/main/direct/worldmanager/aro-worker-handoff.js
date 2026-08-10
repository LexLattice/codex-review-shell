"use strict";

const {
  digestFor,
  stableId,
} = require("./aro-kernel");
const {
  mutationContractRef,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  realizationContextImportRef,
  realizationMappingWitnessRef,
  validateAroRealizationContextImport,
  validateAroRealizationMappingWitness,
} = require("./aro-realization-mapping");
const {
  buildDirectRoleHandoffPacket,
  validateDirectRoleHandoffPacket,
} = require("../bridge/role-handoff-packet");

const ARO_WORKER_SOURCE_FRESHNESS_SCHEMA =
  "direct_aro_worker_source_freshness_witness@1";
const ARO_WORKER_CAPABILITY_OBSERVATION_SCHEMA =
  "direct_aro_worker_capability_observation@1";
const ARO_WORKER_REVIEW_RECEIPT_SCHEMA =
  "direct_aro_worker_review_receipt@1";
const ARO_WORKER_TASK_CONSTITUTION_SCHEMA =
  "direct_aro_worker_task_constitution@1";
const ARO_WORKER_CONSTITUTION_SCHEMA =
  "direct_aro_worker_constitution@1";
const ARO_WORKER_AUTHORIZATION_RECEIPT_SCHEMA =
  "direct_aro_worker_authorization_receipt@1";
const ARO_WORKER_HANDOFF_RUN_SCHEMA =
  "direct_aro_worker_handoff_run@1";

const HANDOFF_RUN_STATES = new Set([
  "scheduled",
  "running",
  "handed_off",
  "blocked",
  "failed",
]);
const TERMINAL_HANDOFF_RUN_STATES = new Set([
  "handed_off",
  "blocked",
  "failed",
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
      "world_manager_aro_worker_ref_invalid",
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

function artifact(
  schema,
  idField,
  id,
  body,
) {
  const value = {
    schema,
    [idField]: id,
    ...body,
    grantsAuthority: false,
  };
  value.digest = digestFor(
    schema,
    value,
    ["digest"],
  );
  return value;
}

function artifactRef(
  kind,
  value,
  idField,
  projectId = "",
) {
  return exactRef({
    kind,
    id: value[idField],
    digest: value.digest,
    ...(projectId
      ? { projectId }
      : {}),
  });
}

function validateDigest(
  value,
  schema,
  idField,
) {
  if (
    !isPlainObject(value) ||
    value.schema !== schema ||
    !text(value[idField], "") ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        schema,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_worker_artifact_invalid",
      schema,
    );
  }
  return true;
}

function validateWorkerInputLineage(
  contract,
  contextImport,
  mappingWitness,
) {
  validateAroMutationContract(contract);
  validateAroRealizationContextImport(
    contextImport,
  );
  validateAroRealizationMappingWitness(
    mappingWitness,
  );
  const contractReference =
    mutationContractRef(contract);
  const contextReference =
    realizationContextImportRef(
      contextImport,
    );
  if (
    contract.projectId !==
      contextImport.projectId ||
    contract.projectId !==
      mappingWitness.projectId ||
    !exactRefMatches(
      contextImport.contractRef,
      contractReference,
    ) ||
    !exactRefMatches(
      mappingWitness.contractRef,
      contractReference,
    ) ||
    !exactRefMatches(
      mappingWitness.contextImportRef,
      contextReference,
    ) ||
    !exactRefMatches(
      mappingWitness.comparisonRef,
      contract.comparisonRef,
    ) ||
    !exactRefMatches(
      mappingWitness.currentAroRef,
      contract.currentAroRef,
    ) ||
    !exactRefMatches(
      mappingWitness.targetAroRef,
      contract.targetAroRef,
    ) ||
    !exactRefMatches(
      mappingWitness.repositorySnapshotRef,
      contextImport.repositorySnapshotRef,
    ) ||
    mappingWitness.sourceIdentityDigest !==
      contextImport.sourceIdentityDigest
  ) {
    fail(
      "world_manager_aro_worker_input_lineage_invalid",
    );
  }
  return true;
}

function buildAroWorkerSourceFreshnessWitness(
  input = {},
) {
  const contextImport =
    input.contextImport;
  validateAroRealizationContextImport(
    contextImport,
  );
  const observation =
    isPlainObject(input.observation)
      ? input.observation
      : {};
  const expectedByPath = new Map(
    contextImport.evidence.map(
      (entry) => [
        entry.relativePath,
        entry,
      ],
    ),
  );
  const observedByPath = new Map(
    (
      Array.isArray(observation.evidence)
        ? observation.evidence
        : []
    ).map((entry) => [
      text(entry.relativePath, ""),
      entry,
    ]),
  );
  const blockerCodes = [];
  if (
    observation.schema !==
      "workspace_aro_realization_context_observation@1" ||
    text(
      observation.projectId,
      contextImport.projectId,
    ) !== contextImport.projectId ||
    observation.sourceInspectionEffect !==
      true ||
    observation.workspaceMutationEffect !==
      false ||
    observation.rawWorkspacePathIncluded !==
      false ||
    observation.rawSecretIncluded !==
      false
  ) {
    blockerCodes.push(
      "source_observation_invalid",
    );
  }
  const requestedPaths =
    contextImport.selectionWitness
      .selectedPaths;
  for (const relativePath of requestedPaths) {
    const expected =
      expectedByPath.get(relativePath);
    const observed =
      observedByPath.get(relativePath);
    if (!expected || !observed) {
      blockerCodes.push(
        `mapped_source_missing:${relativePath}`,
      );
      continue;
    }
    if (
      text(observed.digest, "") !==
        expected.sourceRef.digest
    ) {
      blockerCodes.push(
        `mapped_source_changed:${relativePath}`,
      );
    }
  }
  for (
    const rejected of
      Array.isArray(
        observation.rejectedPaths,
      )
        ? observation.rejectedPaths
        : []
  ) {
    blockerCodes.push(
      `mapped_source_rejected:${text(
        rejected.relativePath,
        "unknown",
      )}`,
    );
  }
  const expectedIdentity =
    contextImport.repositoryIdentity || {};
  const observedIdentity =
    observation.repositoryIdentity || {};
  for (
    const field of [
      "headOid",
      "statusDigest",
      "diffDigest",
    ]
  ) {
    if (
      text(expectedIdentity[field], "") &&
      text(observedIdentity[field], "") !==
        text(expectedIdentity[field], "")
    ) {
      blockerCodes.push(
        `repository_identity_changed:${field}`,
      );
    }
  }
  const uniqueBlockers =
    uniqueStrings(blockerCodes);
  const observedAt = text(
    observation.observedAt,
    nowIso(input.now),
  );
  const witness = {
    schema:
      ARO_WORKER_SOURCE_FRESHNESS_SCHEMA,
    sourceFreshnessWitnessId:
      stableId(
        "wm_aro_worker_source_freshness",
        {
          contextImportRef:
            realizationContextImportRef(
              contextImport,
            ),
          observedSourceDigests:
            [...observedByPath.entries()]
              .map(([relativePath, entry]) => ({
                relativePath,
                digest: text(
                  entry.digest,
                  "",
                ),
              }))
              .sort((left, right) =>
                left.relativePath.localeCompare(
                  right.relativePath,
                )),
          observedIdentity,
          observedAt,
        },
      ),
    projectId:
      contextImport.projectId,
    contextImportRef:
      realizationContextImportRef(
        contextImport,
      ),
    expectedSourceIdentityDigest:
      contextImport
        .sourceIdentityDigest,
    requestedPaths,
    checkedSourceCount:
      observedByPath.size,
    state:
      uniqueBlockers.length
        ? "blocked"
        : "fresh",
    blockerCodes:
      uniqueBlockers,
    sourceInspectionEffect: true,
    readOnlyEffect: true,
    workspaceMutationEffect: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    grantsAuthority: false,
    observedAt,
  };
  witness.digest = digestFor(
    ARO_WORKER_SOURCE_FRESHNESS_SCHEMA,
    witness,
    ["digest"],
  );
  validateAroWorkerSourceFreshnessWitness(
    witness,
  );
  return witness;
}

function validateAroWorkerSourceFreshnessWitness(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_SOURCE_FRESHNESS_SCHEMA,
    "sourceFreshnessWitnessId",
  );
  exactRef(
    value.contextImportRef,
    "sourceFreshness.contextImportRef",
  );
  if (
    !["fresh", "blocked"].includes(
      value.state,
    ) ||
    !Array.isArray(value.blockerCodes) ||
    !Array.isArray(value.requestedPaths) ||
    value.sourceInspectionEffect !==
      true ||
    value.readOnlyEffect !== true ||
    value.workspaceMutationEffect !==
      false ||
    value.rawWorkspacePathIncluded !==
      false ||
    value.rawSecretIncluded !== false ||
    (
      value.state === "fresh" &&
      value.blockerCodes.length
    ) ||
    (
      value.state === "blocked" &&
      !value.blockerCodes.length
    )
  ) {
    fail(
      "world_manager_aro_worker_source_freshness_invalid",
    );
  }
  return true;
}

function buildAroWorkerCapabilityObservation(
  input = {},
) {
  const toolStates =
    isPlainObject(input.toolStates)
      ? input.toolStates
      : {};
  const normalizedToolStates = {};
  for (
    const toolName of [
      "read_file",
      "apply_patch",
      "run_command",
    ]
  ) {
    normalizedToolStates[toolName] =
      text(
        toolStates[toolName],
        "blocked",
      ) === "ready"
        ? "ready"
        : "blocked";
  }
  const availableToolNames =
    Object.entries(normalizedToolStates)
      .filter(([, state]) =>
        state === "ready")
      .map(([toolName]) => toolName);
  const blockerCodes =
    uniqueStrings([
      ...(Array.isArray(input.blockerCodes)
        ? input.blockerCodes
        : []),
      ...(
        input.turnRunnable === true
          ? []
          : ["direct_turn_unavailable"]
      ),
      ...(
        text(
          input.runtimePath,
          "",
        ) === "direct-implementation"
          ? []
          : [
              "direct_implementation_lane_unavailable",
            ]
      ),
      ...(
        normalizedToolStates
          .read_file === "ready"
          ? []
          : ["read_file_capability_unavailable"]
      ),
      ...(
        normalizedToolStates
          .apply_patch === "ready"
          ? []
          : ["apply_patch_capability_unavailable"]
      ),
    ]);
  const observedAt = text(
    input.observedAt,
    nowIso(input.now),
  );
  const observation = {
    schema:
      ARO_WORKER_CAPABILITY_OBSERVATION_SCHEMA,
    capabilityObservationId:
      stableId(
        "wm_aro_worker_capability_observation",
        {
          projectId:
            text(input.projectId, ""),
          runtimePath:
            text(
              input.runtimePath,
              "unknown",
            ),
          workspaceKind:
            text(
              input.workspaceKind,
              "unknown",
            ),
          toolStates:
            normalizedToolStates,
          blockerCodes,
          observedAt,
        },
      ),
    projectId:
      text(input.projectId, ""),
    runtimePath:
      text(
        input.runtimePath,
        "unknown",
      ),
    workspaceKind:
      text(
        input.workspaceKind,
        "unknown",
      ),
    runtimeStatus:
      text(
        input.runtimeStatus,
        input.turnRunnable === true
          ? "ready"
          : "blocked",
      ),
    turnRunnable:
      input.turnRunnable === true,
    workerStartAvailable:
      blockerCodes.length === 0,
    toolStates:
      normalizedToolStates,
    availableToolNames,
    perCallApprovalRequired: true,
    workspaceMutationAtHandoff:
      false,
    remoteMutationAvailable: false,
    canonicalWriteAvailable: false,
    blockerCodes,
    rawWorkspacePathIncluded: false,
    rawCredentialIncluded: false,
    rawSecretIncluded: false,
    observedAt,
    grantsAuthority: false,
  };
  observation.digest = digestFor(
    ARO_WORKER_CAPABILITY_OBSERVATION_SCHEMA,
    observation,
    ["digest"],
  );
  validateAroWorkerCapabilityObservation(
    observation,
  );
  return observation;
}

function validateAroWorkerCapabilityObservation(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_CAPABILITY_OBSERVATION_SCHEMA,
    "capabilityObservationId",
  );
  if (
    !text(value.projectId, "") ||
    !isPlainObject(value.toolStates) ||
    !Array.isArray(
      value.availableToolNames,
    ) ||
    !Array.isArray(value.blockerCodes) ||
    value.perCallApprovalRequired !==
      true ||
    value.workspaceMutationAtHandoff !==
      false ||
    value.remoteMutationAvailable !==
      false ||
    value.canonicalWriteAvailable !==
      false ||
    value.rawWorkspacePathIncluded !==
      false ||
    value.rawCredentialIncluded !==
      false ||
    value.rawSecretIncluded !== false ||
    (
      value.workerStartAvailable ===
        true &&
      value.blockerCodes.length
    ) ||
    (
      value.workerStartAvailable !==
        true &&
      !value.blockerCodes.length
    )
  ) {
    fail(
      "world_manager_aro_worker_capability_observation_invalid",
    );
  }
  return true;
}

function reviewBlockers(
  contract,
  contextImport,
  mappingWitness,
  sourceFreshness,
  capabilityObservation,
) {
  const blockers = [
    ...(
      mappingWitness.mappingPosture ===
        "complete"
        ? []
        : [
            `mapping_posture:${mappingWitness.mappingPosture}`,
          ]
    ),
    ...(
      mappingWitness
        .obligationMappings.every(
          (entry) =>
            entry.coverageState ===
              "mapped" &&
            entry.sourceBindings.length >
              0,
        )
        ? []
        : [
            "obligation_mapping_incomplete",
          ]
    ),
    ...(
      contextImport.freshness ===
        "fresh"
        ? []
        : [
            `import_freshness:${contextImport.freshness}`,
          ]
    ),
    ...sourceFreshness.blockerCodes,
    ...capabilityObservation.blockerCodes,
  ];
  if (
    contract.disposition ===
      "no_mutation_required"
  ) {
    blockers.push(
      "mutation_contract_has_no_work",
    );
  }
  return uniqueStrings(blockers);
}

function buildAroWorkerReviewReceipt(
  input = {},
) {
  const {
    contract,
    contextImport,
    mappingWitness,
    sourceFreshness,
    capabilityObservation,
  } = input;
  validateWorkerInputLineage(
    contract,
    contextImport,
    mappingWitness,
  );
  validateAroWorkerSourceFreshnessWitness(
    sourceFreshness,
  );
  validateAroWorkerCapabilityObservation(
    capabilityObservation,
  );
  if (
    capabilityObservation.projectId !==
      contract.projectId
  ) {
    fail(
      "world_manager_aro_worker_capability_project_mismatch",
    );
  }
  const blockerCodes = reviewBlockers(
    contract,
    contextImport,
    mappingWitness,
    sourceFreshness,
    capabilityObservation,
  );
  const receipt = {
    schema:
      ARO_WORKER_REVIEW_RECEIPT_SCHEMA,
    reviewReceiptId:
      stableId(
        "wm_aro_worker_review_receipt",
        {
          contractRef:
            mutationContractRef(
              contract,
            ),
          contextImportRef:
            realizationContextImportRef(
              contextImport,
            ),
          mappingWitnessRef:
            realizationMappingWitnessRef(
              mappingWitness,
            ),
          sourceFreshnessRef:
            artifactRef(
              "aro_worker_source_freshness_witness",
              sourceFreshness,
              "sourceFreshnessWitnessId",
              contract.projectId,
            ),
          capabilityObservationRef:
            artifactRef(
              "aro_worker_capability_observation",
              capabilityObservation,
              "capabilityObservationId",
              contract.projectId,
            ),
          actorId:
            text(
              input.actorId,
              "operator",
            ),
        },
      ),
    projectId: contract.projectId,
    contractRef:
      mutationContractRef(contract),
    contextImportRef:
      realizationContextImportRef(
        contextImport,
      ),
    mappingWitnessRef:
      realizationMappingWitnessRef(
        mappingWitness,
      ),
    sourceFreshnessRef:
      artifactRef(
        "aro_worker_source_freshness_witness",
        sourceFreshness,
        "sourceFreshnessWitnessId",
        contract.projectId,
      ),
    capabilityObservationRef:
      artifactRef(
        "aro_worker_capability_observation",
        capabilityObservation,
        "capabilityObservationId",
        contract.projectId,
      ),
    actorRef: {
      kind: "operator",
      id: text(
        input.actorId,
        "operator",
      ),
      digest: digestFor(
        "direct_world_manager_operator_ref@1",
        {
          actorId: text(
            input.actorId,
            "operator",
          ),
        },
      ),
    },
    reviewState:
      blockerCodes.length
        ? "blocked"
        : "reviewed",
    blockerCodes,
    exactEvidenceReviewed: true,
    sourceIdentityRefreshed: true,
    capabilityGateObserved: true,
    providerStartAuthorized: false,
    workspaceMutationAuthorized:
      false,
    canonicalAdmissionAuthorized:
      false,
    grantsAuthority: false,
    reviewedAt: text(
      input.reviewedAt,
      nowIso(input.now),
    ),
  };
  receipt.digest = digestFor(
    ARO_WORKER_REVIEW_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateAroWorkerReviewReceipt(
    receipt,
  );
  return receipt;
}

function validateAroWorkerReviewReceipt(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_REVIEW_RECEIPT_SCHEMA,
    "reviewReceiptId",
  );
  for (
    const [label, ref] of [
      ["contractRef", value.contractRef],
      [
        "contextImportRef",
        value.contextImportRef,
      ],
      [
        "mappingWitnessRef",
        value.mappingWitnessRef,
      ],
      [
        "sourceFreshnessRef",
        value.sourceFreshnessRef,
      ],
      [
        "capabilityObservationRef",
        value.capabilityObservationRef,
      ],
      ["actorRef", value.actorRef],
    ]
  ) {
    exactRef(ref, label);
  }
  if (
    !["reviewed", "blocked"].includes(
      value.reviewState,
    ) ||
    !Array.isArray(value.blockerCodes) ||
    value.exactEvidenceReviewed !== true ||
    value.sourceIdentityRefreshed !==
      true ||
    value.capabilityGateObserved !==
      true ||
    value.providerStartAuthorized !==
      false ||
    value.workspaceMutationAuthorized !==
      false ||
    value.canonicalAdmissionAuthorized !==
      false ||
    (
      value.reviewState === "reviewed" &&
      value.blockerCodes.length
    ) ||
    (
      value.reviewState === "blocked" &&
      !value.blockerCodes.length
    )
  ) {
    fail(
      "world_manager_aro_worker_review_receipt_invalid",
    );
  }
  return true;
}

function sourceBindingsForConstitution(
  mappingWitness,
) {
  return mappingWitness
    .obligationMappings.map((mapping) => ({
      obligationRef:
        mapping.obligationRef,
      obligationKey:
        mapping.obligationKey,
      branchRefs:
        mapping.branchRefs,
      coverageState:
        mapping.coverageState,
      sourceBindings:
        mapping.sourceBindings.map(
          (binding) => ({
            sourceRef:
              binding.sourceRef,
            evidenceKey:
              binding.evidenceKey,
            relativePath:
              binding.relativePath,
            symbol: bounded(
              binding.symbol,
              "(file scope)",
              400,
            ),
            startLine:
              binding.startLine,
            endLine:
              binding.endLine,
            bindingKind:
              binding.bindingKind,
          })),
    }));
}

function buildWorkerInstructionPackage(
  input = {},
) {
  const contract = input.contract;
  const mappingWitness =
    input.mappingWitness;
  const taskConstitution =
    input.taskConstitution;
  const roleLines = [
    "You are a bounded Direct implementation worker instantiated for one exact ARO realization contract.",
    "Treat the target ARO and its implementation obligations as the governing abstract object; treat mapped source as realization evidence, not as the source of requirements.",
    "Inspect and modify only the files needed by the bound obligations and source mappings.",
    "Use only the tools declared in the capability envelope. Every read, patch, or command remains subject to the runtime's per-call approval.",
    "Do not push, publish, create remote artifacts, mutate canonical worldstate, spawn workers, certify semantic closure, or claim that activity alone completes the contract.",
    "Preserve every compiled preservation constraint.",
    "Return a concise implementation summary and concrete evidence of files or checks attempted. Verification and semantic closure belong to later SC8.4 and SC8.5 reviewers.",
  ];
  const semanticPacket = {
    contractRef:
      mutationContractRef(contract),
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
      contract.implementationObligations,
    preservationConstraints:
      contract.preservationConstraints,
    verificationRequirements:
      contract.verificationRequirements,
    realizationMappings:
      sourceBindingsForConstitution(
        mappingWitness,
      ),
    availableToolNames:
      taskConstitution
        .availableToolNames,
    forbiddenActionClasses:
      taskConstitution
        .forbiddenActionClasses,
    perCallApprovalRequired: true,
  };
  return artifact(
    "direct_trusted_provider_instruction_package@1",
    "instructionPackageId",
    stableId(
      "wm_aro_worker_instruction_package",
      {
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
        contractRef:
          mutationContractRef(
            contract,
          ),
        mappingWitnessRef:
          realizationMappingWitnessRef(
            mappingWitness,
          ),
      },
    ),
    {
      promptProjectionRef: {
        kind:
          "aro_worker_prompt_projection",
        id: stableId(
          "wm_aro_worker_prompt_projection",
          {
            contractRef:
              mutationContractRef(
                contract,
              ),
            mappingWitnessRef:
              realizationMappingWitnessRef(
                mappingWitness,
              ),
          },
        ),
        digest: digestFor(
          "direct_aro_worker_prompt_projection@1",
          semanticPacket,
        ),
      },
      instructions: [
        ...roleLines,
        "[EXACT ARO WORKER CONSTITUTION - HARNESS-COMPILED DATA]",
        JSON.stringify(semanticPacket),
      ].join("\n"),
      instructionLineCount:
        roleLines.length + 2,
      currentUserTextIncluded: false,
      rendererSuppliedInstructionsAccepted:
        false,
      sourcePosture:
        "compiled_from_reviewed_aro_contract_and_mapping",
      providerRequestState:
        "not_started",
    },
  );
}

function buildAroWorkerConstitution(
  input = {},
) {
  const {
    contract,
    contextImport,
    mappingWitness,
    reviewReceipt,
    sourceFreshness,
    capabilityObservation,
  } = input;
  validateWorkerInputLineage(
    contract,
    contextImport,
    mappingWitness,
  );
  validateAroWorkerReviewReceipt(
    reviewReceipt,
  );
  validateAroWorkerSourceFreshnessWitness(
    sourceFreshness,
  );
  validateAroWorkerCapabilityObservation(
    capabilityObservation,
  );
  if (
    !exactRefMatches(
      reviewReceipt.contractRef,
      mutationContractRef(contract),
    ) ||
    !exactRefMatches(
      reviewReceipt.contextImportRef,
      realizationContextImportRef(
        contextImport,
      ),
    ) ||
    !exactRefMatches(
      reviewReceipt.mappingWitnessRef,
      realizationMappingWitnessRef(
        mappingWitness,
      ),
    )
  ) {
    fail(
      "world_manager_aro_worker_review_lineage_invalid",
    );
  }
  const gateBlockers =
    uniqueStrings(
      reviewReceipt.blockerCodes,
    );
  const availableToolNames =
    capabilityObservation
      .availableToolNames;
  const taskConstitution = artifact(
    ARO_WORKER_TASK_CONSTITUTION_SCHEMA,
    "taskConstitutionId",
    stableId(
      "wm_aro_worker_task_constitution",
      {
        reviewReceiptRef:
          artifactRef(
            "aro_worker_review_receipt",
            reviewReceipt,
            "reviewReceiptId",
            contract.projectId,
          ),
        capabilityObservationRef:
          reviewReceipt
            .capabilityObservationRef,
      },
    ),
    {
      projectId: contract.projectId,
      taskType:
        "aro_realization_implementation",
      phase: "implementation",
      requiredActionClasses: [
        "implement_aro_obligations",
        "preserve_compiled_constraints",
        "return_implementation_evidence",
      ],
      permittedActionClasses: [
        "read_mapped_source",
        "propose_workspace_patch",
        ...(
          availableToolNames.includes(
            "run_command",
          )
            ? [
                "propose_verification_command",
              ]
            : []
        ),
      ],
      approvalGatedActionClasses: [
        "read_workspace_file",
        "apply_workspace_patch",
        "run_workspace_command",
      ],
      forbiddenActionClasses: [
        "mutate_remote_system",
        "push_or_publish",
        "create_remote_artifact",
        "admit_canonical_worldstate",
        "spawn_recursive_worker",
        "self_certify_semantic_closure",
      ],
      availableToolNames,
      perCallApprovalRequired: true,
      policyClosureState:
        gateBlockers.length
          ? "blocked"
          : "resolved",
      blockerCodes:
        gateBlockers,
    },
  );
  const roleTemplate = artifact(
    "direct_trusted_role_template@1",
    "roleTemplateId",
    "worker.aro_realization@1",
    {
      roleKind: "worker",
      roleTemplateRevision: 1,
      purpose:
        "Implement one reviewed ARO realization contract under attenuated Direct authority.",
      templateStatus:
        gateBlockers.length
          ? "blocked"
          : "active_sc8_3",
      requiredOutputSchema:
        "direct_worker_implementation_result@1",
      authorityCeiling: {
        mayReadMappedSource: true,
        mayProposeWorkspaceMutation:
          true,
        mayExecuteWorkspaceMutation:
          false,
        mayMutateRemoteSystems: false,
        mayAdmitCanonicalWorldstate:
          false,
        mayCertifyClosure: false,
      },
    },
  );
  const capabilityEnvelope = artifact(
    "direct_agent_capability_envelope@1",
    "capabilityEnvelopeId",
    stableId(
      "wm_aro_worker_capability",
      {
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
        capabilityObservationRef:
          reviewReceipt
            .capabilityObservationRef,
      },
    ),
    {
      projectId: contract.projectId,
      toolNames:
        availableToolNames,
      toolCount:
        availableToolNames.length,
      readMappedSourceAvailable:
        availableToolNames.includes(
          "read_file",
        ),
      patchProposalAvailable:
        availableToolNames.includes(
          "apply_patch",
        ),
      commandProposalAvailable:
        availableToolNames.includes(
          "run_command",
        ),
      workspaceMutationAtHandoff:
        false,
      remoteMutationAvailable: false,
      canonicalWriteAvailable: false,
      recursiveWorkerSpawnAvailable:
        false,
      perCallApprovalRequired: true,
    },
  );
  const authorityEnvelope = artifact(
    "direct_agent_authority_envelope@1",
    "authorityEnvelopeId",
    stableId(
      "wm_aro_worker_authority",
      {
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
        reviewReceiptRef:
          artifactRef(
            "aro_worker_review_receipt",
            reviewReceipt,
            "reviewReceiptId",
            contract.projectId,
          ),
      },
    ),
    {
      projectId: contract.projectId,
      providerStartRequiresOperatorAuthorization:
        true,
      mayStartProviderTurnAfterAuthorization:
        true,
      mayProposePerCallEffects: true,
      mayExecuteWorkspaceMutation:
        false,
      mayMutateRemoteSystems: false,
      mayAdmitCanonicalWorldstate:
        false,
      mayCertifyClosure: false,
      perCallApprovalRequired: true,
    },
  );
  const budget = artifact(
    "direct_agent_budget@1",
    "budgetId",
    stableId(
      "wm_aro_worker_budget",
      {
        contractRef:
          mutationContractRef(
            contract,
          ),
        mappingWitnessRef:
          realizationMappingWitnessRef(
            mappingWitness,
          ),
      },
    ),
    {
      turnLimit: 1,
      recursiveWorkerLimit: 0,
      mappedFileCount:
        contextImport.evidence.length,
      maxMappedFileCount: 12,
      workspaceMutationAtHandoffLimit:
        0,
      remoteMutationLimit: 0,
      canonicalWriteLimit: 0,
      budgetPosture:
        "single_direct_worker_turn_with_per_call_effect_gates",
    },
  );
  const completionContract = artifact(
    "direct_agent_completion_evaluator@1",
    "completionEvaluatorId",
    stableId(
      "wm_aro_worker_completion",
      {
        contractRef:
          mutationContractRef(
            contract,
          ),
        verificationRequirements:
          contract
            .verificationRequirements
            .map((entry) =>
              entry.verificationRequirementId),
      },
    ),
    {
      requiredOutputSchema:
        "direct_worker_implementation_result@1",
      requiredEvidenceKinds:
        uniqueStrings(
          contract
            .verificationRequirements
            .flatMap((entry) =>
              entry.requiredEvidenceKinds),
        ),
      activityCountsAsCompletion:
        false,
      workerMaySelfCertifyClosure:
        false,
      semanticClosureDeferredTo:
        "wm_sc8_5",
      runtimeVerificationDeferredTo:
        "wm_sc8_4",
    },
  );
  const instructionPackage =
    buildWorkerInstructionPackage({
      contract,
      mappingWitness,
      taskConstitution,
    });
  const projectionAgreement = artifact(
    "direct_agent_world_projection_agreement@1",
    "projectionAgreementId",
    stableId(
      "wm_aro_worker_projection_agreement",
      {
        reviewReceiptRef:
          artifactRef(
            "aro_worker_review_receipt",
            reviewReceipt,
            "reviewReceiptId",
            contract.projectId,
          ),
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
      },
    ),
    {
      state:
        gateBlockers.length
          ? "blocked"
          : "validated",
      launchEligible:
        gateBlockers.length === 0,
      disagreements:
        gateBlockers,
      exactInputAgreement: true,
      sourceFreshnessAgreement:
        sourceFreshness.state ===
          "fresh",
      capabilityAgreement:
        capabilityObservation
          .workerStartAvailable,
      perCallAuthorityAgreement: true,
      workspaceMutationAtHandoff:
        false,
      canonicalWriteAvailable:
        false,
    },
  );
  const agentInstantiationId =
    stableId(
      "wm_aro_worker_instantiation",
      {
        roleTemplateRef:
          artifactRef(
            "trusted_role_template",
            roleTemplate,
            "roleTemplateId",
          ),
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
        mappingWitnessRef:
          realizationMappingWitnessRef(
            mappingWitness,
          ),
      },
    );
  const agentInstantiation =
    artifact(
      "direct_agent_instantiation@1",
      "agentInstantiationId",
      agentInstantiationId,
      {
        projectId:
          contract.projectId,
        roleTemplateRef:
          artifactRef(
            "trusted_role_template",
            roleTemplate,
            "roleTemplateId",
          ),
        taskConstitutionRef:
          artifactRef(
            "aro_worker_task_constitution",
            taskConstitution,
            "taskConstitutionId",
            contract.projectId,
          ),
        authorityEnvelopeRef:
          artifactRef(
            "agent_authority_envelope",
            authorityEnvelope,
            "authorityEnvelopeId",
            contract.projectId,
          ),
        capabilityEnvelopeRef:
          artifactRef(
            "agent_capability_envelope",
            capabilityEnvelope,
            "capabilityEnvelopeId",
            contract.projectId,
          ),
        budgetRef:
          artifactRef(
            "agent_budget",
            budget,
            "budgetId",
            contract.projectId,
          ),
        completionEvaluatorRef:
          artifactRef(
            "agent_completion_evaluator",
            completionContract,
            "completionEvaluatorId",
            contract.projectId,
          ),
        status: gateBlockers.length
          ? "blocked"
          : "compiled",
        runtimeAdmissionState:
          gateBlockers.length
            ? "blocked"
            : "operator_authorization_required",
        rendererInstructionInputAccepted:
          false,
      },
    );
  const manifest = artifact(
    "direct_agent_instantiation_manifest@1",
    "instanceId",
    agentInstantiationId,
    {
      projectId:
        contract.projectId,
      roleTemplateRef:
        agentInstantiation
          .roleTemplateRef,
      taskConstitutionRef:
        agentInstantiation
          .taskConstitutionRef,
      contractRef:
        mutationContractRef(
          contract,
        ),
      contextImportRef:
        realizationContextImportRef(
          contextImport,
        ),
      mappingWitnessRef:
        realizationMappingWitnessRef(
          mappingWitness,
        ),
      reviewReceiptRef:
        artifactRef(
          "aro_worker_review_receipt",
          reviewReceipt,
          "reviewReceiptId",
          contract.projectId,
        ),
      sourceFreshnessRef:
        reviewReceipt
          .sourceFreshnessRef,
      capabilityObservationRef:
        reviewReceipt
          .capabilityObservationRef,
      authorityDigest:
        authorityEnvelope.digest,
      capabilityDigest:
        capabilityEnvelope.digest,
      budgetDigest: budget.digest,
      evaluatorDigest:
        completionContract.digest,
      promptDigest:
        instructionPackage.digest,
      rendererInstructionInputAccepted:
        false,
    },
  );
  const compiledAgentContext = {
    schema:
      "direct_compiled_agent_context@1",
    compiledAgentContextId:
      stableId(
        "wm_aro_worker_compiled_context",
        {
          agentInstantiationRef:
            artifactRef(
              "agent_instantiation",
              agentInstantiation,
              "agentInstantiationId",
              contract.projectId,
            ),
          projectionAgreementRef:
            artifactRef(
              "agent_world_projection_agreement",
              projectionAgreement,
              "projectionAgreementId",
              contract.projectId,
            ),
        },
      ),
    agentInstantiationRef:
      artifactRef(
        "agent_instantiation",
        agentInstantiation,
        "agentInstantiationId",
        contract.projectId,
      ),
    manifestRef:
      artifactRef(
        "agent_instantiation_manifest",
        manifest,
        "instanceId",
        contract.projectId,
      ),
    taskConstitutionRef:
      artifactRef(
        "aro_worker_task_constitution",
        taskConstitution,
        "taskConstitutionId",
        contract.projectId,
      ),
    projectionAgreementRef:
      artifactRef(
        "agent_world_projection_agreement",
        projectionAgreement,
        "projectionAgreementId",
        contract.projectId,
      ),
    trustedInstructionPackage:
      instructionPackage,
    projectionAgreementState:
      projectionAgreement.state,
    rendererSuppliedInstructionsAccepted:
      false,
    providerRoleTurnState:
      "not_started",
    grantsAuthority: false,
  };
  compiledAgentContext.digest =
    digestFor(
      "direct_compiled_agent_context@1",
      compiledAgentContext,
      ["digest"],
    );
  const constitution = {
    schema:
      ARO_WORKER_CONSTITUTION_SCHEMA,
    workerConstitutionId:
      stableId(
        "wm_aro_worker_constitution",
        {
          reviewReceiptRef:
            artifactRef(
              "aro_worker_review_receipt",
              reviewReceipt,
              "reviewReceiptId",
              contract.projectId,
            ),
          taskConstitutionRef:
            artifactRef(
              "aro_worker_task_constitution",
              taskConstitution,
              "taskConstitutionId",
              contract.projectId,
            ),
          projectionAgreementRef:
            artifactRef(
              "agent_world_projection_agreement",
              projectionAgreement,
              "projectionAgreementId",
              contract.projectId,
            ),
        },
      ),
    projectId:
      contract.projectId,
    contractRef:
      mutationContractRef(contract),
    comparisonRef:
      contract.comparisonRef,
    currentAroRef:
      contract.currentAroRef,
    targetAroRef:
      contract.targetAroRef,
    contextImportRef:
      realizationContextImportRef(
        contextImport,
      ),
    mappingWitnessRef:
      realizationMappingWitnessRef(
        mappingWitness,
      ),
    reviewReceiptRef:
      artifactRef(
        "aro_worker_review_receipt",
        reviewReceipt,
        "reviewReceiptId",
        contract.projectId,
      ),
    sourceFreshnessRef:
      reviewReceipt
        .sourceFreshnessRef,
    capabilityObservationRef:
      reviewReceipt
        .capabilityObservationRef,
    taskConstitution,
    roleTemplate,
    capabilityEnvelope,
    authorityEnvelope,
    budget,
    completionContract,
    agentInstantiation,
    manifest,
    projectionAgreement,
    compiledAgentContext,
    obligationBindings:
      sourceBindingsForConstitution(
        mappingWitness,
      ),
    constitutionState:
      gateBlockers.length
        ? "blocked"
        : "ready_for_authorization",
    blockerCodes:
      gateBlockers,
    providerStartAuthorized:
      false,
    workspaceMutationAtCompile:
      false,
    remoteMutationAvailable: false,
    canonicalWriteAvailable: false,
    semanticTruthValidated: false,
    closureCertified: false,
    rendererAuthored: false,
    grantsAuthority: false,
    compiledAt: text(
      input.compiledAt,
      nowIso(input.now),
    ),
  };
  constitution.digest = digestFor(
    ARO_WORKER_CONSTITUTION_SCHEMA,
    constitution,
    ["digest"],
  );
  validateAroWorkerConstitution(
    constitution,
  );
  return constitution;
}

function validateAroWorkerConstitution(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_CONSTITUTION_SCHEMA,
    "workerConstitutionId",
  );
  for (
    const [label, ref] of [
      ["contractRef", value.contractRef],
      ["comparisonRef", value.comparisonRef],
      ["currentAroRef", value.currentAroRef],
      ["targetAroRef", value.targetAroRef],
      [
        "contextImportRef",
        value.contextImportRef,
      ],
      [
        "mappingWitnessRef",
        value.mappingWitnessRef,
      ],
      [
        "reviewReceiptRef",
        value.reviewReceiptRef,
      ],
      [
        "sourceFreshnessRef",
        value.sourceFreshnessRef,
      ],
      [
        "capabilityObservationRef",
        value.capabilityObservationRef,
      ],
    ]
  ) {
    exactRef(ref, label);
  }
  validateDigest(
    value.taskConstitution,
    ARO_WORKER_TASK_CONSTITUTION_SCHEMA,
    "taskConstitutionId",
  );
  validateDigest(
    value.roleTemplate,
    "direct_trusted_role_template@1",
    "roleTemplateId",
  );
  validateDigest(
    value.capabilityEnvelope,
    "direct_agent_capability_envelope@1",
    "capabilityEnvelopeId",
  );
  validateDigest(
    value.authorityEnvelope,
    "direct_agent_authority_envelope@1",
    "authorityEnvelopeId",
  );
  validateDigest(
    value.budget,
    "direct_agent_budget@1",
    "budgetId",
  );
  validateDigest(
    value.completionContract,
    "direct_agent_completion_evaluator@1",
    "completionEvaluatorId",
  );
  validateDigest(
    value.agentInstantiation,
    "direct_agent_instantiation@1",
    "agentInstantiationId",
  );
  validateDigest(
    value.manifest,
    "direct_agent_instantiation_manifest@1",
    "instanceId",
  );
  validateDigest(
    value.projectionAgreement,
    "direct_agent_world_projection_agreement@1",
    "projectionAgreementId",
  );
  const context =
    value.compiledAgentContext;
  if (
    !isPlainObject(context) ||
    context.schema !==
      "direct_compiled_agent_context@1" ||
    !text(
      context.compiledAgentContextId,
      "",
    ) ||
    context.digest !==
      digestFor(
        "direct_compiled_agent_context@1",
        context,
        ["digest"],
      ) ||
    context.rendererSuppliedInstructionsAccepted !==
      false ||
    context.grantsAuthority !== false
  ) {
    fail(
      "world_manager_aro_worker_compiled_context_invalid",
    );
  }
  if (
    ![
      "ready_for_authorization",
      "blocked",
    ].includes(
      value.constitutionState,
    ) ||
    !Array.isArray(value.blockerCodes) ||
    !Array.isArray(
      value.obligationBindings,
    ) ||
    value.providerStartAuthorized !==
      false ||
    value.workspaceMutationAtCompile !==
      false ||
    value.remoteMutationAvailable !==
      false ||
    value.canonicalWriteAvailable !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.closureCertified !== false ||
    value.rendererAuthored !== false ||
    (
      value.constitutionState ===
        "ready_for_authorization" &&
      (
        value.blockerCodes.length ||
        value.projectionAgreement
          .state !== "validated" ||
        context
          .projectionAgreementState !==
          "validated"
      )
    )
  ) {
    fail(
      "world_manager_aro_worker_constitution_invalid",
    );
  }
  return true;
}

function workerConstitutionRef(
  constitution,
) {
  validateAroWorkerConstitution(
    constitution,
  );
  return artifactRef(
    "aro_worker_constitution",
    constitution,
    "workerConstitutionId",
    constitution.projectId,
  );
}

function buildAroWorkerAuthorizationReceipt(
  input = {},
) {
  const constitution =
    input.constitution;
  validateAroWorkerConstitution(
    constitution,
  );
  const actorId = text(
    input.actorId,
    "operator",
  );
  const operatorActionId = text(
    input.operatorActionId,
    "",
  );
  if (!operatorActionId) {
    fail(
      "world_manager_aro_worker_operator_action_required",
    );
  }
  const authorized =
    constitution.constitutionState ===
      "ready_for_authorization";
  const receipt = {
    schema:
      ARO_WORKER_AUTHORIZATION_RECEIPT_SCHEMA,
    authorizationReceiptId:
      stableId(
        "wm_aro_worker_authorization_receipt",
        {
          constitutionRef:
            workerConstitutionRef(
              constitution,
            ),
          actorId,
          operatorActionId,
        },
      ),
    projectId:
      constitution.projectId,
    constitutionRef:
      workerConstitutionRef(
        constitution,
      ),
    actorRef: {
      kind: "operator",
      id: actorId,
      digest: digestFor(
        "direct_world_manager_operator_ref@1",
        { actorId },
      ),
    },
    operatorActionId,
    authorizationState:
      authorized
        ? "authorized"
        : "blocked",
    blockerCodes:
      authorized
        ? []
        : constitution.blockerCodes,
    workerStartAuthorized:
      authorized,
    providerTurnStartAuthorized:
      authorized,
    toolProposalAuthorized:
      authorized,
    workspaceMutationAuthorized:
      false,
    remoteMutationAuthorized:
      false,
    canonicalAdmissionAuthorized:
      false,
    semanticClosureAuthorized:
      false,
    perCallEffectApprovalRequired:
      true,
    singleUse: true,
    consumedByRunRef: null,
    grantsAuthority: false,
    authorizedAt: text(
      input.authorizedAt,
      nowIso(input.now),
    ),
  };
  receipt.digest = digestFor(
    ARO_WORKER_AUTHORIZATION_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateAroWorkerAuthorizationReceipt(
    receipt,
  );
  return receipt;
}

function validateAroWorkerAuthorizationReceipt(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_AUTHORIZATION_RECEIPT_SCHEMA,
    "authorizationReceiptId",
  );
  exactRef(
    value.constitutionRef,
    "authorization.constitutionRef",
  );
  exactRef(
    value.actorRef,
    "authorization.actorRef",
  );
  if (
    ![
      "authorized",
      "blocked",
    ].includes(
      value.authorizationState,
    ) ||
    !text(value.operatorActionId, "") ||
    !Array.isArray(value.blockerCodes) ||
    value.workspaceMutationAuthorized !==
      false ||
    value.remoteMutationAuthorized !==
      false ||
    value.canonicalAdmissionAuthorized !==
      false ||
    value.semanticClosureAuthorized !==
      false ||
    value.perCallEffectApprovalRequired !==
      true ||
    value.singleUse !== true ||
    value.consumedByRunRef !== null ||
    (
      value.authorizationState ===
        "authorized" &&
      (
        value.blockerCodes.length ||
        value.workerStartAuthorized !==
          true ||
        value.providerTurnStartAuthorized !==
          true ||
        value.toolProposalAuthorized !==
          true
      )
    ) ||
    (
      value.authorizationState ===
        "blocked" &&
      (
        !value.blockerCodes.length ||
        value.workerStartAuthorized !==
          false ||
        value.providerTurnStartAuthorized !==
          false
      )
    )
  ) {
    fail(
      "world_manager_aro_worker_authorization_receipt_invalid",
    );
  }
  return true;
}

function buildAroWorkerRoleHandoffPacket(
  input = {},
) {
  const constitution =
    input.constitution;
  const authorization =
    input.authorization;
  const workThread =
    input.workThread;
  validateAroWorkerConstitution(
    constitution,
  );
  validateAroWorkerAuthorizationReceipt(
    authorization,
  );
  if (
    authorization.authorizationState !==
      "authorized" ||
    !exactRefMatches(
      authorization.constitutionRef,
      workerConstitutionRef(
        constitution,
      ),
    ) ||
    text(workThread?.projectId, "") !==
      constitution.projectId ||
    !text(
      workThread?.workThreadId,
      "",
    )
  ) {
    fail(
      "world_manager_aro_worker_handoff_input_invalid",
    );
  }
  const workThreadId =
    workThread.workThreadId;
  const preflightId =
    stableId(
      "wm_aro_worker_preflight",
      {
        constitutionRef:
          workerConstitutionRef(
            constitution,
          ),
        authorizationRef:
          artifactRef(
            "aro_worker_authorization_receipt",
            authorization,
            "authorizationReceiptId",
            constitution.projectId,
          ),
        workThreadId,
      },
    );
  const preflightDigest =
    digestFor(
      "direct_aro_worker_preflight@1",
      {
        preflightId,
        workThreadId,
        constitutionDigest:
          constitution.digest,
        authorizationDigest:
          authorization.digest,
      },
    );
  const targetReportId =
    stableId(
      "wm_aro_worker_target_report",
      {
        workThreadId,
        constitutionDigest:
          constitution.digest,
      },
    );
  const targetReportDigest =
    digestFor(
      "direct_aro_worker_target_report@1",
      {
        targetReportId,
        workThreadId,
        projectId:
          constitution.projectId,
      },
    );
  const brokerResolutionId =
    stableId(
      "wm_aro_worker_broker_resolution",
      {
        workThreadId,
        authorizationDigest:
          authorization.digest,
      },
    );
  const packet =
    buildDirectRoleHandoffPacket({
      projectId:
        constitution.projectId,
      threadId:
        stableId(
          "wm_aro_worker_parent_thread",
          {
            comparisonRef:
              constitution
                .comparisonRef,
          },
        ),
      turnId:
        authorization
          .operatorActionId,
      semanticPreflight: {
        preflightId,
        recommendationClass:
          "route_to_role",
        selectedWorkThreadId:
          workThreadId,
        selectedCandidateId:
          preflightId,
        selectedRouteKind:
          "route_to_role",
        stale: false,
        integrity: {
          artifactDigest:
            preflightDigest,
        },
      },
      workTargetResolutionReport: {
        reportId:
          targetReportId,
        projectId:
          constitution.projectId,
        selectedWorkThreadId:
          workThreadId,
        routingGateState:
          "selected_ready",
        reportDigest:
          targetReportDigest,
        stale: false,
      },
      operatorBrokerResolution: {
        brokerResolutionId,
        selectedWorkThreadId:
          workThreadId,
        routingGateState:
          "selected_ready",
        brokerResolutionDigest:
          digestFor(
            "direct_aro_worker_broker_resolution@1",
            {
              brokerResolutionId,
              workThreadId,
            },
          ),
        stale: false,
      },
      workThread,
      agentClassSpec: {
        agentClassId:
          constitution.roleTemplate
            .roleTemplateId,
        agentClassKind:
          "implementation_worker",
        displayName:
          "ARO implementation worker",
        specDigest:
          constitution.roleTemplate
            .digest,
        consumedContextFamilies: [
          "authority_boundary",
          "context_packet",
          "work_thread_identity",
        ],
        producedArtifactFamilies: [
          "implementation_evidence_artifact",
        ],
      },
      expectedOutputArtifactFamily:
        "implementation_evidence_artifact",
      contextRefs: [
        {
          kind:
            "aro_mutation_contract",
          artifactId:
            constitution.contractRef.id,
          artifactDigest:
            constitution.contractRef.digest,
          sourceConfidence:
            "reviewed",
          rendererSafeLabel:
            "Reviewed ARO mutation contract",
        },
        {
          kind:
            "aro_realization_mapping_witness",
          artifactId:
            constitution.mappingWitnessRef.id,
          artifactDigest:
            constitution.mappingWitnessRef.digest,
          sourceConfidence:
            "reviewed",
          rendererSafeLabel:
            "Reviewed ARO realization mapping",
        },
        {
          kind:
            "compiled_agent_context",
          artifactId:
            constitution
              .compiledAgentContext
              .compiledAgentContextId,
          artifactDigest:
            constitution
              .compiledAgentContext
              .digest,
          sourceConfidence:
            "compiled",
          rendererSafeLabel:
            "Compiled ARO worker context",
        },
      ],
      authorityTransitionRefs: [
        {
          kind:
            "aro_worker_authorization_receipt",
          artifactId:
            authorization
              .authorizationReceiptId,
          artifactDigest:
            authorization.digest,
          sourceConfidence:
            "operator_authorized",
          rendererSafeLabel:
            "Single-use worker start authorization",
        },
      ],
      authorityBoundary: {
        summary:
          "One provider worker start is authorized. Every read, patch, or command still requires its own action-specific approval.",
        forbiddenActions: [
          "workspace_mutation_from_handoff_packet",
          "remote_mutation",
          "canonical_worldstate_admission",
          "semantic_closure_certification",
          "recursive_worker_spawn",
        ],
      },
    });
  validateDirectRoleHandoffPacket(
    packet,
  );
  return packet;
}

function buildAroWorkerHandoffRun(
  input = {},
) {
  const constitutionRef =
    exactRef(
      input.constitutionRef,
      "handoffRun.constitutionRef",
    );
  const authorizationRef =
    exactRef(
      input.authorizationRef,
      "handoffRun.authorizationRef",
    );
  const state = text(
    input.state,
    "scheduled",
  );
  const runRevision = Math.max(
    1,
    Number(input.runRevision || 1),
  );
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_worker_handoff_run",
      {
        constitutionRef,
        authorizationRef,
      },
    ),
  );
  const workerLaunchEffect =
    state === "handed_off";
  const run = {
    schema:
      ARO_WORKER_HANDOFF_RUN_SCHEMA,
    runId,
    runRevision,
    predecessorRef:
      input.predecessorRef
        ? exactRef(
            input.predecessorRef,
            "handoffRun.predecessorRef",
          )
        : null,
    projectId:
      text(
        input.projectId,
        constitutionRef.projectId || "",
      ),
    constitutionRef,
    authorizationRef,
    workThreadRef:
      input.workThreadRef
        ? exactRef(
            input.workThreadRef,
            "handoffRun.workThreadRef",
          )
        : null,
    handoffPacketRef:
      input.handoffPacketRef
        ? exactRef(
            input.handoffPacketRef,
            "handoffRun.handoffPacketRef",
          )
        : null,
    workerStartTransitionRef:
      input.workerStartTransitionRef
        ? exactRef(
            input.workerStartTransitionRef,
            "handoffRun.workerStartTransitionRef",
          )
        : null,
    workerSessionRef:
      input.workerSessionRef
        ? exactRef(
            input.workerSessionRef,
            "handoffRun.workerSessionRef",
          )
        : null,
    workerTurnRef:
      input.workerTurnRef
        ? exactRef(
            input.workerTurnRef,
            "handoffRun.workerTurnRef",
          )
        : null,
    state,
    blockerCodes:
      uniqueStrings(
        input.blockerCodes,
      ),
    error: input.error
      ? {
          code: text(
            input.error.code,
            "world_manager_aro_worker_handoff_failed",
          ),
          message: bounded(
            input.error.message,
            "ARO worker handoff failed.",
            500,
          ),
        }
      : null,
    retryable: false,
    authorizationConsumed:
      ["running", "handed_off", "failed"]
        .includes(state),
    workerLaunchEffect,
    providerTurnStartEffect:
      workerLaunchEffect,
    toolProposalEffect:
      workerLaunchEffect,
    workspaceMutationEffect: false,
    remoteMutationEffect: false,
    canonicalAdmissionEffect: false,
    semanticTruthValidated: false,
    closureCertified: false,
    perCallEffectApprovalRequired:
      true,
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
    ARO_WORKER_HANDOFF_RUN_SCHEMA,
    run,
    ["digest"],
  );
  validateAroWorkerHandoffRun(
    run,
  );
  return run;
}

function validateAroWorkerHandoffRun(
  value,
) {
  validateDigest(
    value,
    ARO_WORKER_HANDOFF_RUN_SCHEMA,
    "runId",
  );
  exactRef(
    value.constitutionRef,
    "handoffRun.constitutionRef",
  );
  exactRef(
    value.authorizationRef,
    "handoffRun.authorizationRef",
  );
  if (
    !HANDOFF_RUN_STATES.has(
      value.state,
    ) ||
    !Number.isInteger(
      Number(value.runRevision),
    ) ||
    Number(value.runRevision) < 1 ||
    !Array.isArray(value.blockerCodes) ||
    value.retryable !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.remoteMutationEffect !== false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.closureCertified !== false ||
    value.perCallEffectApprovalRequired !==
      true ||
    value.canonical !== false ||
    (
      value.state === "handed_off" &&
      (
        value.workerLaunchEffect !==
          true ||
        value.providerTurnStartEffect !==
          true ||
        !value.workThreadRef ||
        !value.handoffPacketRef ||
        !value.workerStartTransitionRef ||
        !value.workerSessionRef ||
        !value.workerTurnRef
      )
    ) ||
    (
      value.state !== "handed_off" &&
      (
        value.workerLaunchEffect !==
          false ||
        value.providerTurnStartEffect !==
          false
      )
    )
  ) {
    fail(
      "world_manager_aro_worker_handoff_run_invalid",
    );
  }
  return true;
}

function reviseAroWorkerHandoffRun(
  current,
  patch = {},
) {
  validateAroWorkerHandoffRun(
    current,
  );
  if (
    TERMINAL_HANDOFF_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_worker_handoff_run_terminal",
      current.state,
    );
  }
  return buildAroWorkerHandoffRun({
    ...current,
    ...patch,
    runId: current.runId,
    runRevision:
      current.runRevision + 1,
    predecessorRef: {
      kind:
        "aro_worker_handoff_run",
      id: current.runId,
      digest: current.digest,
      projectId:
        current.projectId,
    },
    createdAt: current.createdAt,
    updatedAt: text(
      patch.updatedAt,
      nowIso(patch.now),
    ),
  });
}

function aroWorkerPrompt(
  constitution,
) {
  validateAroWorkerConstitution(
    constitution,
  );
  return [
    "Execute the exact ARO realization worker constitution supplied by the harness.",
    "Begin from the mapped source witnesses and implement only the bound obligations.",
    "Request each required read, patch, or command through the declared Direct tools; do not bypass per-call approval.",
    "Return implementation evidence only. Do not certify semantic closure.",
  ].join("\n");
}

module.exports = {
  ARO_WORKER_AUTHORIZATION_RECEIPT_SCHEMA,
  ARO_WORKER_CAPABILITY_OBSERVATION_SCHEMA,
  ARO_WORKER_CONSTITUTION_SCHEMA,
  ARO_WORKER_HANDOFF_RUN_SCHEMA,
  ARO_WORKER_REVIEW_RECEIPT_SCHEMA,
  ARO_WORKER_SOURCE_FRESHNESS_SCHEMA,
  ARO_WORKER_TASK_CONSTITUTION_SCHEMA,
  HANDOFF_RUN_STATES,
  TERMINAL_HANDOFF_RUN_STATES,
  aroWorkerPrompt,
  buildAroWorkerAuthorizationReceipt,
  buildAroWorkerCapabilityObservation,
  buildAroWorkerConstitution,
  buildAroWorkerHandoffRun,
  buildAroWorkerReviewReceipt,
  buildAroWorkerRoleHandoffPacket,
  buildAroWorkerSourceFreshnessWitness,
  reviseAroWorkerHandoffRun,
  validateAroWorkerAuthorizationReceipt,
  validateAroWorkerCapabilityObservation,
  validateAroWorkerConstitution,
  validateAroWorkerHandoffRun,
  validateAroWorkerReviewReceipt,
  validateAroWorkerSourceFreshnessWitness,
  workerConstitutionRef,
};
