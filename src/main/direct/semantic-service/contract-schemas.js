"use strict";

/*
 * Frozen JSON-schema dialect declarations for Direct Semantic Service v0.
 * schema-validator.js intentionally implements only the closed keywords used
 * here; no external JSON-schema package is required at the daemon boundary.
 */

const { deepFreeze } = require("./canonical");

const DSS = "direct_semantic_";

function objectSchema(schema, required, properties, extras = {}) {
  return {
    $id: schema,
    type: "object",
    additionalProperties: false,
    required: [...required],
    properties: { ...properties },
    ...extras,
  };
}

function string(format, extras = {}) {
  return { type: "string", ...(format ? { format } : {}), ...extras };
}

function id(extras = {}) {
  return string("id", extras);
}

function ref(extras = {}) {
  return string("immutable-ref", extras);
}

function digest(extras = {}) {
  return string("digest", extras);
}

function timestamp(extras = {}) {
  return string("timestamp", extras);
}

function enumOf(values, extras = {}) {
  return { enum: [...values], ...extras };
}

function setOf(items, extras = {}) {
  return { type: "array", items, uniqueItems: true, "x-canonical-set": true, ...extras };
}

function nonEmptySetOf(items, extras = {}) {
  return setOf(items, { minItems: 1, ...extras });
}

function integer(minimum, maximum, extras = {}) {
  return {
    type: "integer",
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...extras,
  };
}

const bool = { type: "boolean" };
const positiveInteger = integer(1, Number.MAX_SAFE_INTEGER);
const nonNegativeInteger = integer(0, Number.MAX_SAFE_INTEGER);
const nullableNonNegativeInteger = { anyOf: [nonNegativeInteger, { type: "null" }] };

const SCHEMAS = {
  TransportPrincipal: objectSchema(
    `${DSS}transport_principal@1`,
    ["schema", "transport", "hostUserId", "observedAt"],
    {
      schema: { const: `${DSS}transport_principal@1` },
      transport: enumOf(["unix_socket", "windows_wsl_stdio", "internal"]),
      hostUserId: id(),
      hostGroupId: id(),
      processId: nonNegativeInteger,
      observedAt: timestamp(),
    },
  ),

  SemanticPrincipal: objectSchema(
    `${DSS}principal@1`,
    ["schema", "principalId", "issuerRevision", "principalClass", "subjectRef", "projectScopes", "purposeScopes"],
    {
      schema: { const: `${DSS}principal@1` },
      principalId: id(),
      issuerRevision: ref(),
      principalClass: enumOf([
        "local_user_experimental",
        "direct_workthread",
        "direct_service",
        "operator",
      ]),
      subjectRef: id(),
      projectScopes: setOf(ref()),
      purposeScopes: setOf(id()),
    },
  ),

  DirectSemanticCapability: objectSchema(
    `${DSS}capability@1`,
    [
      "schema", "capabilityId", "principalId", "operation", "jobRefs",
      "projectRegistryRevisionRefs", "allowedTargetORevisions",
      "targetSnapshotReceiptRefs", "compilerPinRefs", "kernelRevisionRefs",
      "executionProfileRevisionRefs", "providerProfileRevisionRefs",
      "allowedModels", "allowedReasoningEfforts", "attemptPolicyRevisionRefs",
      "purposeScopes", "returnProjectionRefs", "maximumJobs",
      "maximumCellsPerJob", "maximumReplicatesPerCell", "maximumInputTokensPerJob",
      "maximumOutputTokensPerJob", "maximumCostMicrounitsPerJob", "issuedAt", "nonce",
    ],
    {
      schema: { const: `${DSS}capability@1` },
      capabilityId: id(),
      principalId: id(),
      operation: enumOf([
        "prepare_snapshot", "submit_job", "inspect_job", "read_results",
        "subscribe_results", "request_cancel", "administer_service",
      ]),
      jobRefs: setOf(ref()),
      projectRegistryRevisionRefs: setOf(ref()),
      allowedTargetORevisions: setOf(ref()),
      targetSnapshotReceiptRefs: setOf(ref()),
      compilerPinRefs: setOf(ref()),
      kernelRevisionRefs: setOf(ref()),
      executionProfileRevisionRefs: setOf(ref()),
      providerProfileRevisionRefs: setOf(ref()),
      allowedModels: setOf(string("safe-token")),
      allowedReasoningEfforts: setOf(string("safe-token")),
      attemptPolicyRevisionRefs: setOf(ref()),
      purposeScopes: setOf(id()),
      returnProjectionRefs: setOf(ref()),
      // Non-submit capabilities may carry zero resource budgets; operation
      // authority applies the positive submit bound separately.
      maximumJobs: nonNegativeInteger,
      maximumCellsPerJob: nonNegativeInteger,
      maximumReplicatesPerCell: nonNegativeInteger,
      maximumInputTokensPerJob: nonNegativeInteger,
      maximumOutputTokensPerJob: nonNegativeInteger,
      maximumCostMicrounitsPerJob: nullableNonNegativeInteger,
      issuedAt: timestamp(),
      expiresAt: timestamp(),
      nonce: id(),
    },
  ),

  CompilerBuildPin: objectSchema(
    `${DSS}compiler_build_pin@1`,
    [
      "schema", "compilerPinRef", "repositoryIdentity", "gitCommit", "gitTree",
      "sourceArtifactDigest", "executableArtifactDigest", "interpreterToolchainDigest",
      "dependencyLockDigest", "installedDependencyEnvironmentDigest",
      "invocationContractDigest", "canonicalSchemaDigests", "patternLibraryDigests",
      "evidenceCatalogDigests", "compilerGateReceiptDigest", "adapterRevision", "admittedAt",
    ],
    {
      schema: { const: `${DSS}compiler_build_pin@1` },
      compilerPinRef: ref(),
      repositoryIdentity: string("safe-token"),
      gitCommit: ref(),
      gitTree: ref(),
      sourceArtifactDigest: digest(),
      executableArtifactDigest: digest(),
      interpreterToolchainDigest: digest(),
      dependencyLockDigest: digest(),
      installedDependencyEnvironmentDigest: digest(),
      invocationContractDigest: digest(),
      canonicalSchemaDigests: setOf(digest()),
      patternLibraryDigests: setOf(digest()),
      evidenceCatalogDigests: setOf(digest()),
      compilerGateReceiptDigest: digest(),
      adapterRevision: ref(),
      admittedAt: timestamp(),
    },
  ),

  ProjectEvidenceRuntimeRevision: objectSchema(
    `${DSS}project_evidence_runtime_revision@1`,
    [
      "schema", "projectEvidenceRuntimeRevisionRef", "projectRef", "substrateBinding",
      "operatingSystemRevision", "interpreterExecutableDigest", "toolchainArtifactDigests",
      "installedDependencyEnvironmentDigest", "deterministicCheckRegistryDigest",
      "admittedEnvironmentInputDigest", "runtimePolicyDigest",
    ],
    {
      schema: { const: `${DSS}project_evidence_runtime_revision@1` },
      projectEvidenceRuntimeRevisionRef: ref(),
      projectRef: ref(),
      substrateBinding: enumOf(["wsl", "windows"]),
      operatingSystemRevision: ref(),
      interpreterExecutableDigest: digest(),
      toolchainArtifactDigests: setOf(digest()),
      installedDependencyEnvironmentDigest: digest(),
      deterministicCheckRegistryDigest: digest(),
      admittedEnvironmentInputDigest: digest(),
      runtimePolicyDigest: digest(),
    },
  ),

  ProjectRegistryRevision: objectSchema(
    `${DSS}project_registry_revision@1`,
    [
      "schema", "registryRevisionRef", "projectRef", "substrateBinding", "repositoryIdentity",
      "privateRepositoryLocatorRef", "targetRevisionPolicy", "projectEvidenceRuntimeRevisionRef",
      "evidenceCartographyRevisionRef", "authorityPolicyRef", "admittedByCapabilityRef", "admittedAt",
    ],
    {
      schema: { const: `${DSS}project_registry_revision@1` },
      registryRevisionRef: ref(),
      projectRef: ref(),
      priorRevisionRef: ref(),
      substrateBinding: enumOf(["wsl", "windows"]),
      repositoryIdentity: string("safe-token"),
      privateRepositoryLocatorRef: ref(),
      targetRevisionPolicy: objectSchema(
        "direct_semantic_target_revision_policy@1",
        ["kind", "allowedCommits", "cleanTreeRequired"],
        {
          kind: { const: "exact_git_commit_allowlist" },
          allowedCommits: nonEmptySetOf(ref()),
          cleanTreeRequired: bool,
        },
      ),
      projectEvidenceRuntimeRevisionRef: ref(),
      evidenceCartographyRevisionRef: ref(),
      authorityPolicyRef: ref(),
      admittedByCapabilityRef: ref(),
      admittedAt: timestamp(),
    },
  ),

  TargetSnapshotReceipt: objectSchema(
    `${DSS}target_snapshot_receipt@1`,
    [
      "schema", "targetSnapshotReceiptRef", "projectRegistryRevisionRef", "repositoryIdentity",
      "targetORevision", "gitCommit", "gitTree", "submoduleClosureDigest", "lfsObjectClosureDigest",
      "admittedGeneratedInputDigest", "evidenceCartographyRevisionRef",
      "projectEvidenceRuntimeRevisionRef", "projectRuntimeInputDigest", "sourceStatusDigest",
      "snapshotArtifactRef", "snapshotMaterializationMode", "preObservationReceiptRef",
      "postObservationReceiptRef", "snapshotDigest", "capturedAt",
    ],
    {
      schema: { const: `${DSS}target_snapshot_receipt@1` },
      targetSnapshotReceiptRef: ref(),
      projectRegistryRevisionRef: ref(),
      repositoryIdentity: string("safe-token"),
      targetORevision: ref(),
      gitCommit: ref(),
      gitTree: ref(),
      submoduleClosureDigest: digest(),
      lfsObjectClosureDigest: digest(),
      admittedGeneratedInputDigest: digest(),
      evidenceCartographyRevisionRef: ref(),
      projectEvidenceRuntimeRevisionRef: ref(),
      projectRuntimeInputDigest: digest(),
      sourceStatusDigest: digest(),
      snapshotArtifactRef: ref(),
      snapshotMaterializationMode: { const: "isolated_read_only_snapshot" },
      preObservationReceiptRef: ref(),
      postObservationReceiptRef: ref(),
      snapshotDigest: digest(),
      capturedAt: timestamp(),
    },
  ),

  WorkerExecutionRuntimeRevision: objectSchema(
    `${DSS}worker_execution_runtime_revision@1`,
    [
      "schema", "workerExecutionRuntimeRevisionRef", "substrateBinding", "backendAdapterRevision",
      "processLauncherDigest", "sandboxPolicyDigest", "scratchPolicyDigest",
      "environmentAllowlistDigest", "credentialExclusionPolicyDigest", "outputCapturePolicyDigest",
      "runtimeArtifactDigest",
    ],
    {
      schema: { const: `${DSS}worker_execution_runtime_revision@1` },
      workerExecutionRuntimeRevisionRef: ref(),
      substrateBinding: enumOf(["wsl", "windows", "remote_api"]),
      backendAdapterRevision: ref(),
      processLauncherDigest: digest(),
      sandboxPolicyDigest: digest(),
      scratchPolicyDigest: digest(),
      environmentAllowlistDigest: digest(),
      credentialExclusionPolicyDigest: digest(),
      outputCapturePolicyDigest: digest(),
      runtimeArtifactDigest: digest(),
    },
  ),

  ExecutionProfileRevision: objectSchema(
    `${DSS}execution_profile_revision@1`,
    [
      "schema", "executionProfileRevisionRef", "providerProfileRevisionRef", "allowedModels",
      "allowedReasoningEfforts", "workerExecutionRuntimeRevisionRef", "attemptPolicyRevisionRefs",
      "maximumConcurrentAttempts", "maximumInputTokensPerAttempt", "maximumOutputTokensPerAttempt",
      "maximumCostMicrounitsPerAttempt", "executionPolicyDigest",
    ],
    {
      schema: { const: `${DSS}execution_profile_revision@1` },
      executionProfileRevisionRef: ref(),
      providerProfileRevisionRef: ref(),
      allowedModels: nonEmptySetOf(string("safe-token")),
      allowedReasoningEfforts: nonEmptySetOf(string("safe-token")),
      workerExecutionRuntimeRevisionRef: ref(),
      attemptPolicyRevisionRefs: nonEmptySetOf(ref()),
      maximumConcurrentAttempts: positiveInteger,
      maximumInputTokensPerAttempt: positiveInteger,
      maximumOutputTokensPerAttempt: positiveInteger,
      maximumCostMicrounitsPerAttempt: nullableNonNegativeInteger,
      executionPolicyDigest: digest(),
    },
  ),

  AttemptPolicy: objectSchema(
    `${DSS}attempt_policy@1`,
    [
      "schema", "attemptPolicyRef", "retryableFailureClasses", "maximumAttemptsPerReplicateSlot",
      "replicateCountPerCell", "selectionRule", "timeoutMs", "outputByteLimit", "fixedBeforeExecution",
    ],
    {
      schema: { const: `${DSS}attempt_policy@1` },
      attemptPolicyRef: ref(),
      retryableFailureClasses: setOf(enumOf([
        "transport_unavailable_before_dispatch",
        "transport_interrupted_before_raw_capture",
        "runtime_failed_before_raw_capture",
        "raw_result_structural_rejection",
      ])),
      maximumAttemptsPerReplicateSlot: integer(1, 100),
      replicateCountPerCell: integer(1, 100),
      selectionRule: enumOf([
        "all_results_independent",
        "unanimity_reports_agreement_only",
        "fixed_majority_reports_agreement_only",
      ]),
      timeoutMs: integer(1, 86400000),
      outputByteLimit: integer(1, 104857600),
      fixedBeforeExecution: { const: true },
    },
  ),

  SemanticJobRequest: objectSchema(
    `${DSS}job_request@1`,
    [
      "schema", "requestId", "projectRef", "projectRegistryRevisionRef", "targetORevision",
      "targetSnapshotReceiptRef", "compilerPinRef", "requestedCompilationRef", "selectionMode",
      "edgeOccurrenceRefs", "attemptPolicyRef", "executionProfileRevisionRef",
      "deliveryProjectionRef", "idempotencyKey",
    ],
    {
      schema: { const: `${DSS}job_request@1` },
      requestId: id(),
      requesterRef: id(),
      projectRef: ref(),
      projectRegistryRevisionRef: ref(),
      targetORevision: ref(),
      targetSnapshotReceiptRef: ref(),
      compilerPinRef: ref(),
      requestedCompilationRef: ref(),
      selectionMode: enumOf(["partial_selection", "exhaustive_compilation"]),
      edgeOccurrenceRefs: nonEmptySetOf(ref()),
      attemptPolicyRef: ref(),
      executionProfileRevisionRef: ref(),
      deliveryProjectionRef: ref(),
      idempotencyKey: id(),
    },
  ),

  SemanticJobReceipt: objectSchema(
    `${DSS}job_receipt@1`,
    [
      "schema", "jobRef", "requestDigest", "admittedPrincipalRef", "admittedCapabilityRef",
      "projectRegistryRevisionRef", "targetSnapshotReceiptRef", "compilerPinRef", "acceptedAt", "eventCursor",
    ],
    {
      schema: { const: `${DSS}job_receipt@1` },
      jobRef: ref(),
      requestDigest: digest(),
      admittedPrincipalRef: ref(),
      admittedCapabilityRef: ref(),
      projectRegistryRevisionRef: ref(),
      targetSnapshotReceiptRef: ref(),
      compilerPinRef: ref(),
      acceptedAt: timestamp(),
      eventCursor: nonNegativeInteger,
    },
  ),
};

// These names are part of the ABI even when a later stage does not yet use a
// particular object. Keeping them in one registry prevents each subsystem from
// quietly inventing an incompatible open schema.
const ADDITIONAL_SCHEMAS = {
  KernelRevision: objectSchema("semantic_kernel_revision@1", [
    "schema", "kernelRef", "semanticIsaRevision", "edgeFamily", "transformationLawDigest",
    "evidenceSemanticsDigest", "remandLawDigest", "authorityPosture", "outputSchemaDigest", "ratificationEvidenceRefs",
  ], {
    schema: { const: "semantic_kernel_revision@1" }, kernelRef: ref(), semanticIsaRevision: ref(), edgeFamily: string("safe-token"),
    transformationLawDigest: digest(), evidenceSemanticsDigest: digest(), remandLawDigest: digest(),
    authorityPosture: { const: "advisory_only" }, outputSchemaDigest: digest(), ratificationEvidenceRefs: setOf(ref()),
  }),
  ExecutionPlan: objectSchema(`${DSS}execution_plan@1`, [
    "schema", "executionPlanRef", "jobRef", "compilerPinRef", "projectRegistryRevisionRef", "targetSnapshotReceiptRef",
    "requestedCompilationRef", "executionProfileRevisionRef", "selectionMode", "compiledObligationSetDigest",
    "compiledEdgeOccurrenceRefs", "selectedEdgeOccurrenceRefs", "excludedEdgeOccurrenceRefs", "expectedCells", "attemptPolicyRef", "planDigest",
  ], {
    schema: { const: `${DSS}execution_plan@1` }, executionPlanRef: ref(), jobRef: ref(), compilerPinRef: ref(),
    projectRegistryRevisionRef: ref(), targetSnapshotReceiptRef: ref(), requestedCompilationRef: ref(),
    executionProfileRevisionRef: ref(), selectionMode: enumOf(["partial_selection", "exhaustive_compilation"]),
    compiledObligationSetDigest: digest(), compiledEdgeOccurrenceRefs: nonEmptySetOf(ref()), selectedEdgeOccurrenceRefs: nonEmptySetOf(ref()),
    excludedEdgeOccurrenceRefs: setOf(ref()), expectedCells: nonEmptySetOf({ type: "object", additionalProperties: false, "x-canonical-set": true, required: ["cellRef", "edgeOccurrenceRef", "kernelRevisionRef", "replicateSlot"], properties: {
      cellRef: ref(), edgeOccurrenceRef: ref(), kernelRevisionRef: ref(), replicateSlot: integer(0, 99),
    } }), attemptPolicyRef: ref(), planDigest: digest(),
  }),
  TerminalCoverageReceipt: objectSchema(`${DSS}terminal_coverage_receipt@1`, [
    "schema", "terminalCoverageReceiptRef", "executionPlanRef", "expectedCellRefs", "admittedResultCellRefs", "explicitRemandCellRefs",
    "terminalFailureCellRefs", "authorizedCancellationCellRefs", "unclassifiedCellRefs", "duplicateTerminalCellRefs",
    "exhaustiveCompilationReconciliation", "verdict", "receiptDigest",
  ], {
    schema: { const: `${DSS}terminal_coverage_receipt@1` }, terminalCoverageReceiptRef: ref(), executionPlanRef: ref(),
    expectedCellRefs: nonEmptySetOf(ref()), admittedResultCellRefs: setOf(ref()), explicitRemandCellRefs: setOf(ref()),
    terminalFailureCellRefs: setOf(ref()), authorizedCancellationCellRefs: setOf(ref()), unclassifiedCellRefs: setOf(ref()),
    duplicateTerminalCellRefs: setOf(ref()), exhaustiveCompilationReconciliation: enumOf(["not_claimed", "exact_compiled_obligation_set"]),
    verdict: enumOf(["closed", "open", "invalid"]), receiptDigest: digest(),
  }),
  ExecutionCapsule: objectSchema(`${DSS}execution_capsule@1`, [
    "schema", "capsuleRef", "semanticIsaRevision", "kernelRef", "edgeOccurrenceRef", "evidenceRouteRef", "evidenceMaterializationRef",
    "executionProfileRevisionRef", "backendAdapterRevision", "providerProfileRevisionRef", "model", "reasoningEffort",
    "workerExecutionRuntimeRevisionRef", "executionPolicyRef", "outputSchemaDigest", "compilerPinRef", "capsuleDigest",
  ], {
    schema: { const: `${DSS}execution_capsule@1` }, capsuleRef: ref(), semanticIsaRevision: ref(), kernelRef: ref(), edgeOccurrenceRef: ref(),
    evidenceRouteRef: ref(), evidenceMaterializationRef: ref(), executionProfileRevisionRef: ref(), backendAdapterRevision: ref(),
    providerProfileRevisionRef: ref(), model: string("safe-token"), reasoningEffort: string("safe-token"), workerExecutionRuntimeRevisionRef: ref(),
    executionPolicyRef: ref(), outputSchemaDigest: digest(), compilerPinRef: ref(), capsuleDigest: digest(),
  }),
  ExecutionAttempt: objectSchema(`${DSS}execution_attempt@1`, ["schema", "attemptRef", "jobRef", "capsuleRef", "ordinal", "allocatedAt"], {
    schema: { const: `${DSS}execution_attempt@1` }, attemptRef: ref(), jobRef: ref(), capsuleRef: ref(), ordinal: integer(1, Number.MAX_SAFE_INTEGER),
    backendProcessRef: ref(), allocatedAt: timestamp(),
  }),
  RawResult: objectSchema(`${DSS}raw_result@1`, ["schema", "rawResultRef", "capsuleRef", "attemptRef", "backendProcessRef", "providerTerminalKind", "mediaType", "rawResultDigest", "rawByteCount", "quarantineObjectRef", "capturedAt"], {
    schema: { const: `${DSS}raw_result@1` }, rawResultRef: ref(), capsuleRef: ref(), attemptRef: ref(), backendProcessRef: ref(),
    providerTerminalKind: enumOf(["completed", "failed", "interrupted", "timeout", "unknown"]), mediaType: string("safe-token"), rawResultDigest: digest(),
    rawByteCount: nonNegativeInteger, quarantineObjectRef: ref(), capturedAt: timestamp(),
  }),
  MicroResultAdmissionRecord: objectSchema(`${DSS}microresult_admission@1`, ["schema", "capsuleRef", "attemptRef", "rawResultDigest", "structuralValidationReceiptRefs", "bindingValidationReceiptRefs", "admissionStatus", "rejectionCodes", "admittedMicroResultRef", "authorityEffect"], {
    schema: { const: `${DSS}microresult_admission@1` }, capsuleRef: ref(), attemptRef: ref(), rawResultDigest: digest(), structuralValidationReceiptRefs: setOf(ref()), bindingValidationReceiptRefs: setOf(ref()),
    admissionStatus: enumOf(["admitted", "rejected"]), rejectionCodes: setOf(string("safe-token")), admittedMicroResultRef: { anyOf: [ref(), { type: "null" }] }, authorityEffect: { const: "none" },
  }),
  MicroResult: objectSchema(`${DSS}microresult@1`, ["schema", "microResultRef", "kernelRef", "capsuleRef", "attemptRef", "edgeOccurrenceRef", "evidenceMaterializationRef", "evidenceMaterializationDigest", "resultStatus", "typedClaims", "evidenceRefs", "evidencePageFaultCandidateRefs", "novelEdgeCandidateRefs", "authorityEffect"], {
    schema: { const: `${DSS}microresult@1` }, microResultRef: ref(), kernelRef: ref(), capsuleRef: ref(), attemptRef: ref(), edgeOccurrenceRef: ref(), evidenceMaterializationRef: ref(), evidenceMaterializationDigest: digest(),
    resultStatus: enumOf(["supports", "refutes", "inconclusive", "remands"]), typedClaims: setOf({ type: "object", additionalProperties: false }), evidenceRefs: setOf(ref()), evidencePageFaultCandidateRefs: setOf(ref()), novelEdgeCandidateRefs: setOf(ref()), authorityEffect: { const: "none" },
  }),
  SemanticJobCancellationRequest: objectSchema(`${DSS}job_cancellation_request@1`, ["schema", "cancellationRequestRef", "jobRef", "requestedCellRefs", "boundedReason", "idempotencyKey"], {
    schema: { const: `${DSS}job_cancellation_request@1` }, cancellationRequestRef: ref(), jobRef: ref(), requestedCellRefs: nonEmptySetOf(ref()), boundedReason: string("bounded-text", { minLength: 1, maxLength: 2000 }), idempotencyKey: id(),
  }),
  SemanticJobCancellationDecision: objectSchema(`${DSS}job_cancellation_decision@1`, ["schema", "cancellationDecisionRef", "cancellationRequestRef", "cancelCapabilityRef", "authorizedPendingCellRefs", "signalRequestedRunningAttemptRefs", "ineligibleTerminalCellRefs", "decision"], {
    schema: { const: `${DSS}job_cancellation_decision@1` }, cancellationDecisionRef: ref(), cancellationRequestRef: ref(), cancelCapabilityRef: ref(), authorizedPendingCellRefs: setOf(ref()), signalRequestedRunningAttemptRefs: setOf(ref()), ineligibleTerminalCellRefs: setOf(ref()), decision: enumOf(["authorized", "partially_authorized", "rejected"]),
  }),
  AdvisoryDisposition: objectSchema(`${DSS}advisory_disposition@1`, ["schema", "advisoryDispositionRef", "jobRef", "executionPlanRef", "terminalCoverageReceiptRef", "evaluationRefs", "selectionMode", "coveragePosture", "disposition", "openCellRefs", "authorityEffect"], {
    schema: { const: `${DSS}advisory_disposition@1` }, advisoryDispositionRef: ref(), jobRef: ref(), executionPlanRef: ref(), terminalCoverageReceiptRef: ref(), evaluationRefs: setOf(ref()), selectionMode: enumOf(["partial_selection", "exhaustive_compilation"]), coveragePosture: enumOf(["partial", "exhaustive"]), disposition: enumOf(["advisory_results", "advisory_remands", "advisory_terminal_failures", "advisory_cancelled"]), openCellRefs: setOf(ref()), authorityEffect: { const: "none" },
  }),
};

// The constitution names several nested/terminal objects without introducing
// separate TypeScript schema constants for them. They still receive closed
// declarations here so a caller cannot smuggle an open object through a
// seemingly typed parent contract.
const EVIDENCE_CELL_REQUIREMENT_SCHEMA = objectSchema(
  "direct_semantic_evidence_cell_requirement@1",
  ["cellRef", "evidenceClass"],
  {
    cellRef: ref(),
    evidenceClass: string("safe-token"),
    requirementRef: ref(),
    targetSelector: string("safe-token"),
    required: bool,
    negativeSearchUniverseRef: ref(),
    boundedDescription: string("bounded-text", { maxLength: 2000 }),
  },
);

const MATERIALIZED_EVIDENCE_CELL_SCHEMA = objectSchema(
  "direct_semantic_materialized_evidence_cell@1",
  ["cellRef", "evidenceClass"],
  {
    cellRef: ref(),
    evidenceClass: string("safe-token"),
    sourceRef: ref(),
    sourceDigest: digest(),
    contentDigest: digest(),
    sliceDigest: digest(),
    byteCount: nonNegativeInteger,
    provenanceRefs: setOf(ref()),
    completenessReceiptRef: ref(),
    value: {},
  },
);

const UNAVAILABLE_EVIDENCE_CELL_SCHEMA = objectSchema(
  "direct_semantic_unavailable_evidence_cell@1",
  ["cellRef", "reason"],
  {
    cellRef: ref(),
    reason: string("safe-token"),
    boundedRationale: string("bounded-text", { maxLength: 2000 }),
    authorityEffect: { const: "none" },
  },
);

const TYPED_ADVISORY_CLAIM_SCHEMA = objectSchema(
  "direct_semantic_typed_advisory_claim@1",
  ["claimRef", "claimKind"],
  {
    claimRef: ref(),
    claimKind: string("safe-token"),
    subjectRef: ref(),
    predicate: string("safe-token"),
    objectRef: ref(),
    value: {},
    boundedRationale: string("bounded-text", { maxLength: 4000 }),
    evidenceRefs: setOf(ref()),
    authorityEffect: { const: "none" },
  },
);

const EXPECTED_EXECUTION_CELL_SCHEMA = {
  $id: `${DSS}expected_execution_cell@1`,
  type: "object",
  additionalProperties: false,
  required: ["cellRef", "edgeOccurrenceRef", "kernelRevisionRef", "replicateSlot"],
  properties: {
    cellRef: ref(),
    edgeOccurrenceRef: ref(),
    kernelRevisionRef: ref(),
    replicateSlot: integer(0, 99),
  },
};

Object.assign(ADDITIONAL_SCHEMAS, {
  ExpectedExecutionCell: EXPECTED_EXECUTION_CELL_SCHEMA,
  EvidenceRoute: objectSchema("semantic_evidence_route@1", [
    "schema", "routeRef", "edgeOccurrenceRef", "targetORevision", "evidenceProfileRef", "requiredCells",
    "forbiddenEvidenceClasses", "negativeSearchUniverses", "routeCompilerRevision",
  ], {
    schema: { const: "semantic_evidence_route@1" }, routeRef: ref(), edgeOccurrenceRef: ref(), targetORevision: ref(), evidenceProfileRef: ref(),
    requiredCells: nonEmptySetOf(EVIDENCE_CELL_REQUIREMENT_SCHEMA), forbiddenEvidenceClasses: setOf(string("safe-token")), negativeSearchUniverses: setOf(string("safe-token")), routeCompilerRevision: ref(),
  }),
  EvidenceMaterialization: objectSchema(`${DSS}evidence_materialization@1`, [
    "schema", "materializationRef", "routeRef", "projectRegistryRevisionRef", "targetSnapshotReceiptRef", "targetORevision",
    "projectEvidenceRuntimeRevisionRef", "materializerRevision", "includedCells", "explicitlyUnavailableCells", "requiredCellSetDigest",
    "coverageClosure", "evidenceSufficiency", "sufficiencyEligibilityReceiptRef", "artifactDigest", "materializedAt",
  ], {
    schema: { const: `${DSS}evidence_materialization@1` }, materializationRef: ref(), routeRef: ref(), projectRegistryRevisionRef: ref(), targetSnapshotReceiptRef: ref(), targetORevision: ref(), projectEvidenceRuntimeRevisionRef: ref(), materializerRevision: ref(),
    includedCells: setOf(MATERIALIZED_EVIDENCE_CELL_SCHEMA), explicitlyUnavailableCells: setOf(UNAVAILABLE_EVIDENCE_CELL_SCHEMA), requiredCellSetDigest: digest(), coverageClosure: { const: "closed" }, evidenceSufficiency: enumOf(["unknown", "candidate_sufficient", "insufficient"]), sufficiencyEligibilityReceiptRef: ref(), artifactDigest: digest(), materializedAt: timestamp(),
  }),
  SufficiencyEligibilityReceipt: objectSchema(`${DSS}sufficiency_eligibility_receipt@1`, [
    "schema", "sufficiencyEligibilityReceiptRef", "materializationRef", "kernelRevisionRef", "evidenceSufficiency", "kernelSufficiencyPolicyRef", "executable", "deterministicDisposition", "receiptDigest",
  ], {
    schema: { const: `${DSS}sufficiency_eligibility_receipt@1` }, sufficiencyEligibilityReceiptRef: ref(), materializationRef: ref(), kernelRevisionRef: ref(), evidenceSufficiency: enumOf(["unknown", "candidate_sufficient", "insufficient"]), kernelSufficiencyPolicyRef: ref(), executable: bool, deterministicDisposition: enumOf(["eligible_for_preflight", "remand_known_insufficient", "reject_policy_mismatch"]), receiptDigest: digest(),
  }),
  EvidencePageFaultCandidate: objectSchema(`${DSS}evidence_page_fault_candidate@1`, ["schema", "candidateRef", "materializationRef", "attemptRef", "candidateKind", "boundedRationale", "authorityEffect"], {
    schema: { const: `${DSS}evidence_page_fault_candidate@1` }, candidateRef: ref(), materializationRef: ref(), attemptRef: ref(), candidateKind: enumOf(["route_scope_insufficient", "relevant_evidence_may_be_omitted", "counterexample_may_exist_outside_route"]), boundedRationale: string("bounded-text", { maxLength: 4000 }), authorityEffect: { const: "none" },
  }),
  EvidencePageFaultRecord: objectSchema(`${DSS}evidence_page_fault_record@1`, ["schema", "faultRecordRef", "materializationRef", "faultClass", "faultCode", "validationReceiptRefs", "validatingAuthorityRef", "disposition"], {
    schema: { const: `${DSS}evidence_page_fault_record@1` }, faultRecordRef: ref(), materializationRef: ref(), faultClass: enumOf(["mechanical", "semantic_validated"]), faultCode: string("safe-token"), validationReceiptRefs: nonEmptySetOf(ref()), validatingAuthorityRef: ref(), disposition: enumOf(["rematerialize", "recompile_route", "frontier_review"]),
  }),
  PreExecutionAssuranceRecord: objectSchema(`${DSS}preexecution_assurance@1`, ["schema", "assuranceRef", "capsuleRef", "attemptRef", "compilerPinValid", "targetRevisionValid", "pageClosureValid", "pageDigestValid", "sufficiencyEligibilityReceiptValid", "evidenceSufficiencyEligible", "runtimeIsolationRealized", "credentialsExcluded", "outputBoundaryRealized", "verdict", "rejectionCodes"], {
    schema: { const: `${DSS}preexecution_assurance@1` }, assuranceRef: ref(), capsuleRef: ref(), attemptRef: ref(), compilerPinValid: bool, targetRevisionValid: bool, pageClosureValid: bool, pageDigestValid: bool, sufficiencyEligibilityReceiptValid: bool, evidenceSufficiencyEligible: bool, runtimeIsolationRealized: bool, credentialsExcluded: bool, outputBoundaryRealized: bool, verdict: enumOf(["eligible", "preflight_rejected"]), rejectionCodes: setOf(string("safe-token")),
  }),
  Attestation: objectSchema(`${DSS}attestation@1`, ["schema", "attestationRef", "microResultRefs", "attestationClass", "attestorPrincipalRef", "attestorConstitutionDigest", "evidenceRefs", "independenceAssessmentRef", "verdict", "authorityEffect"], {
    schema: { const: `${DSS}attestation@1` }, attestationRef: ref(), microResultRefs: nonEmptySetOf(ref()), attestationClass: enumOf(["evidence_binding", "independent_execution", "independent_materialization", "counterkernel", "frontier_closure_challenge"]), attestorPrincipalRef: ref(), attestorConstitutionDigest: digest(), evidenceRefs: setOf(ref()), independenceAssessmentRef: { anyOf: [ref(), { type: "null" }] }, verdict: enumOf(["supported", "contradicted", "inconclusive", "remand"]), authorityEffect: { const: "none" },
  }),
  Evaluation: objectSchema(`${DSS}evaluation@1`, ["schema", "evaluationRef", "executionPlanRef", "cellRef", "microResultRefs", "attestationRefs", "evaluationPolicyRef", "disposition", "dissentRefs", "unmetAssuranceRefs", "authorityEffect"], {
    schema: { const: `${DSS}evaluation@1` }, evaluationRef: ref(), executionPlanRef: ref(), cellRef: ref(), microResultRefs: setOf(ref()), attestationRefs: setOf(ref()), evaluationPolicyRef: ref(), disposition: enumOf(["advisory_support", "advisory_refutation", "advisory_inconclusive", "advisory_remand"]), dissentRefs: setOf(ref()), unmetAssuranceRefs: setOf(ref()), authorityEffect: { const: "none" },
  }),
  IndependenceAssessment: objectSchema(`${DSS}independence_assessment@1`, ["schema", "assessmentRef", "comparedResultRefs", "requiredDifferentDimensions", "observedDifferentDimensions", "sharedLineageDimensions", "verdict", "lineageGraphDigest"], {
    schema: { const: `${DSS}independence_assessment@1` }, assessmentRef: ref(), comparedResultRefs: nonEmptySetOf(ref()), requiredDifferentDimensions: nonEmptySetOf(string("safe-token")), observedDifferentDimensions: setOf(string("safe-token")), sharedLineageDimensions: setOf(string("safe-token")), verdict: enumOf(["satisfies", "does_not_satisfy", "unknown"]), lineageGraphDigest: digest(),
  }),
  CustodyKeyRevision: objectSchema(`${DSS}custody_key_revision@1`, ["schema", "custodyKeyRevisionRef", "keyFingerprint", "predecessorRevisionRef", "effectiveAfterGlobalSequence", "admittedByCapabilityRef", "admittedAt"], {
    schema: { const: `${DSS}custody_key_revision@1` }, custodyKeyRevisionRef: ref(), keyFingerprint: digest(), predecessorRevisionRef: { anyOf: [ref(), { type: "null" }] }, effectiveAfterGlobalSequence: nonNegativeInteger, admittedByCapabilityRef: ref(), admittedAt: timestamp(),
  }),
  CustodyKeyRotationRecord: objectSchema(`${DSS}custody_key_rotation@1`, ["schema", "rotationRef", "priorKeyRevisionRef", "nextKeyRevisionRef", "lastPriorKeyGlobalCustodyDigest", "priorKeyCustodyTag", "nextKeyCustodyTag", "effectiveAfterGlobalSequence"], {
    schema: { const: `${DSS}custody_key_rotation@1` }, rotationRef: ref(), priorKeyRevisionRef: ref(), nextKeyRevisionRef: ref(), lastPriorKeyGlobalCustodyDigest: digest(), priorKeyCustodyTag: digest(), nextKeyCustodyTag: digest(), effectiveAfterGlobalSequence: nonNegativeInteger,
  }),
  DeliverySubscription: objectSchema(`${DSS}delivery_subscription@1`, ["schema", "subscriptionRef", "jobRef", "subscriberPrincipalRef", "readCapabilityRef", "eventTypeFilter", "returnProjectionRef", "startingCursor", "deliveryAdapterRef", "createdAt"], {
    schema: { const: `${DSS}delivery_subscription@1` }, subscriptionRef: ref(), jobRef: ref(), subscriberPrincipalRef: ref(), readCapabilityRef: ref(), eventTypeFilter: setOf(string("safe-token")), returnProjectionRef: ref(), startingCursor: nonNegativeInteger, deliveryAdapterRef: enumOf(["cli_poll", "electron", "direct_task_wakeup"]), createdAt: timestamp(),
  }),
  DeliveryAttempt: objectSchema(`${DSS}delivery_attempt@1`, ["schema", "deliveryAttemptRef", "subscriptionRef", "capabilityValidationReceiptRef", "firstEventSequence", "lastEventSequence", "projectionDigest", "offeredAt", "acknowledgmentDeadline"], {
    schema: { const: `${DSS}delivery_attempt@1` }, deliveryAttemptRef: ref(), subscriptionRef: ref(), capabilityValidationReceiptRef: ref(), firstEventSequence: nonNegativeInteger, lastEventSequence: nonNegativeInteger, projectionDigest: digest(), offeredAt: timestamp(), acknowledgmentDeadline: timestamp(),
  }),
  DeliveryAcknowledgment: objectSchema(`${DSS}delivery_acknowledgment@1`, ["schema", "acknowledgmentRef", "deliveryAttemptRef", "subscriberPrincipalRef", "projectionDigest", "acknowledgedAt"], {
    schema: { const: `${DSS}delivery_acknowledgment@1` }, acknowledgmentRef: ref(), deliveryAttemptRef: ref(), subscriberPrincipalRef: ref(), projectionDigest: digest(), acknowledgedAt: timestamp(),
  }),
});

// Replace the intentionally minimal typed-claim placeholder with the closed
// declaration above after all additional schemas have been assembled.
ADDITIONAL_SCHEMAS.MicroResult.properties.typedClaims = setOf(TYPED_ADVISORY_CLAIM_SCHEMA);

Object.assign(SCHEMAS, ADDITIONAL_SCHEMAS);

const ALIASES = {
  TransportPrincipal: "TransportPrincipal",
  SemanticPrincipal: "SemanticPrincipal",
  DirectSemanticCapability: "DirectSemanticCapability",
  CompilerBuildPin: "CompilerBuildPin",
  ProjectEvidenceRuntimeRevision: "ProjectEvidenceRuntimeRevision",
  ProjectRegistryRevision: "ProjectRegistryRevision",
  TargetSnapshotReceipt: "TargetSnapshotReceipt",
  WorkerExecutionRuntimeRevision: "WorkerExecutionRuntimeRevision",
  ExecutionProfileRevision: "ExecutionProfileRevision",
  AttemptPolicy: "AttemptPolicy",
  SemanticJobRequest: "SemanticJobRequest",
  SemanticJobReceipt: "SemanticJobReceipt",
};

for (const [name, schema] of Object.entries(SCHEMAS)) {
  ALIASES[schema.$id] = name;
  ALIASES[schema.$id.replace(/^direct_semantic_/, "direct_")] = name;
}

deepFreeze(SCHEMAS);
deepFreeze(ADDITIONAL_SCHEMAS);
deepFreeze(ALIASES);

function getContractSchema(name) {
  const key = typeof name === "string" ? ALIASES[name] || name : "";
  const schema = SCHEMAS[key];
  if (!schema) return null;
  return schema;
}

// Kept here as a convenience for registry/auth callers that already import
// the frozen schema registry. The require is lazy so schema-validator.js can
// resolve this module without a circular initialization hazard.
function validateContract(schemaName, value) {
  return require("./schema-validator").validateContract(schemaName, value);
}

function assertValidContract(schemaName, value) {
  return require("./schema-validator").assertValidContract(schemaName, value);
}

const SCHEMA_EXPORT_ALIASES = {
  TRANSPORT_PRINCIPAL_SCHEMA: SCHEMAS.TransportPrincipal,
  SEMANTIC_PRINCIPAL_SCHEMA: SCHEMAS.SemanticPrincipal,
  DIRECT_SEMANTIC_CAPABILITY_CONTRACT_SCHEMA: SCHEMAS.DirectSemanticCapability,
  COMPILER_BUILD_PIN_SCHEMA: SCHEMAS.CompilerBuildPin,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA: SCHEMAS.ProjectEvidenceRuntimeRevision,
  PROJECT_REGISTRY_REVISION_SCHEMA: SCHEMAS.ProjectRegistryRevision,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA: SCHEMAS.TargetSnapshotReceipt,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA: SCHEMAS.WorkerExecutionRuntimeRevision,
  EXECUTION_PROFILE_REVISION_SCHEMA: SCHEMAS.ExecutionProfileRevision,
  ATTEMPT_POLICY_SCHEMA: SCHEMAS.AttemptPolicy,
  SEMANTIC_JOB_REQUEST_SCHEMA: SCHEMAS.SemanticJobRequest,
  SEMANTIC_JOB_RECEIPT_SCHEMA: SCHEMAS.SemanticJobReceipt,
  DIRECT_SEMANTIC_TRANSPORT_PRINCIPAL_SCHEMA: SCHEMAS.TransportPrincipal,
  DIRECT_SEMANTIC_PRINCIPAL_SCHEMA: SCHEMAS.SemanticPrincipal,
  DIRECT_SEMANTIC_CAPABILITY_SCHEMA: SCHEMAS.DirectSemanticCapability,
  DIRECT_SEMANTIC_COMPILER_BUILD_PIN_SCHEMA: SCHEMAS.CompilerBuildPin,
  DIRECT_SEMANTIC_PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA: SCHEMAS.ProjectEvidenceRuntimeRevision,
  DIRECT_SEMANTIC_PROJECT_REGISTRY_REVISION_SCHEMA: SCHEMAS.ProjectRegistryRevision,
  DIRECT_SEMANTIC_TARGET_SNAPSHOT_RECEIPT_SCHEMA: SCHEMAS.TargetSnapshotReceipt,
  DIRECT_SEMANTIC_WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA: SCHEMAS.WorkerExecutionRuntimeRevision,
  DIRECT_SEMANTIC_EXECUTION_PROFILE_REVISION_SCHEMA: SCHEMAS.ExecutionProfileRevision,
  DIRECT_SEMANTIC_ATTEMPT_POLICY_SCHEMA: SCHEMAS.AttemptPolicy,
  DIRECT_SEMANTIC_JOB_REQUEST_SCHEMA: SCHEMAS.SemanticJobRequest,
  DIRECT_SEMANTIC_JOB_RECEIPT_SCHEMA: SCHEMAS.SemanticJobReceipt,
};

module.exports = {
  ...SCHEMAS,
  ...SCHEMA_EXPORT_ALIASES,
  ADDITIONAL_SCHEMAS,
  ALIASES,
  CONTRACT_SCHEMAS: SCHEMAS,
  SCHEMAS,
  assertValidContract,
  getContractSchema,
  validateContract,
};
