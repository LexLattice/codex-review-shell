"use strict";

/*
 * DSS-0.1's registry is intentionally a small in-memory authority.  It is a
 * harness for proving the identity and admission laws before the durable
 * service exists; it is not a cache, path resolver, compiler adapter, or
 * scheduler.  The only way to obtain an admitted record is through the
 * opaque authority returned by createRegistryAuthority().
 */

const {
  fail,
  canonicalJson,
  digestFor,
  deepFreeze,
  isPlainObject,
  assertExactObject,
  requiredId,
  requiredDigest,
  requiredString,
  sortedUniqueStrings,
  requiredBoundedInteger,
} = require("./canonical");
const { validateContract } = require("./contract-schemas");
const pinVerification = require("./pin-verification");

const COMPILER_BUILD_PIN_SCHEMA = pinVerification.COMPILER_BUILD_PIN_SCHEMA;
const PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA = pinVerification.PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA;
const TARGET_SNAPSHOT_RECEIPT_SCHEMA = pinVerification.TARGET_SNAPSHOT_RECEIPT_SCHEMA;
const WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA = pinVerification.WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA;
const EXECUTION_PROFILE_REVISION_SCHEMA = "direct_semantic_execution_profile_revision@1";
const ATTEMPT_POLICY_SCHEMA = "direct_semantic_attempt_policy@1";
const PROJECT_REGISTRY_REVISION_SCHEMA = "direct_semantic_project_registry_revision@1";
const REGISTRY_AUTHORITY_SCHEMA = "direct_semantic_registry_authority@1";
const REGISTRY_JOB_BINDING_SCHEMA = "direct_semantic_registry_job_binding@1";

const COMPILER_PIN_FIELDS = Object.freeze([
  "schema",
  "compilerPinRef",
  "repositoryIdentity",
  "gitCommit",
  "gitTree",
  "sourceArtifactDigest",
  "executableArtifactDigest",
  "interpreterToolchainDigest",
  "dependencyLockDigest",
  "installedDependencyEnvironmentDigest",
  "invocationContractDigest",
  "canonicalSchemaDigests",
  "patternLibraryDigests",
  "evidenceCatalogDigests",
  "compilerGateReceiptDigest",
  "adapterRevision",
  "admittedAt",
]);

const PROJECT_REGISTRY_FIELDS = Object.freeze([
  "schema",
  "registryRevisionRef",
  "projectRef",
  "priorRevisionRef",
  "substrateBinding",
  "repositoryIdentity",
  "privateRepositoryLocatorRef",
  "targetRevisionPolicy",
  "projectEvidenceRuntimeRevisionRef",
  "evidenceCartographyRevisionRef",
  "authorityPolicyRef",
  "admittedByCapabilityRef",
  "admittedAt",
]);

const PROJECT_RUNTIME_FIELDS = Object.freeze([
  "schema",
  "projectEvidenceRuntimeRevisionRef",
  "projectRef",
  "substrateBinding",
  "operatingSystemRevision",
  "interpreterExecutableDigest",
  "toolchainArtifactDigests",
  "installedDependencyEnvironmentDigest",
  "deterministicCheckRegistryDigest",
  "admittedEnvironmentInputDigest",
  "runtimePolicyDigest",
]);

const TARGET_SNAPSHOT_FIELDS = Object.freeze([
  "schema",
  "targetSnapshotReceiptRef",
  "projectRegistryRevisionRef",
  "repositoryIdentity",
  "targetORevision",
  "gitCommit",
  "gitTree",
  "submoduleClosureDigest",
  "lfsObjectClosureDigest",
  "admittedGeneratedInputDigest",
  "evidenceCartographyRevisionRef",
  "projectEvidenceRuntimeRevisionRef",
  "projectRuntimeInputDigest",
  "sourceStatusDigest",
  "snapshotArtifactRef",
  "snapshotMaterializationMode",
  "preObservationReceiptRef",
  "postObservationReceiptRef",
  "snapshotDigest",
  "capturedAt",
]);

const WORKER_RUNTIME_FIELDS = Object.freeze([
  "schema",
  "workerExecutionRuntimeRevisionRef",
  "substrateBinding",
  "backendAdapterRevision",
  "processLauncherDigest",
  "sandboxPolicyDigest",
  "scratchPolicyDigest",
  "environmentAllowlistDigest",
  "credentialExclusionPolicyDigest",
  "outputCapturePolicyDigest",
  "runtimeArtifactDigest",
]);

const EXECUTION_PROFILE_FIELDS = Object.freeze([
  "schema",
  "executionProfileRevisionRef",
  "providerProfileRevisionRef",
  "allowedModels",
  "allowedReasoningEfforts",
  "workerExecutionRuntimeRevisionRef",
  "attemptPolicyRevisionRefs",
  "maximumConcurrentAttempts",
  "maximumInputTokensPerAttempt",
  "maximumOutputTokensPerAttempt",
  "maximumCostMicrounitsPerAttempt",
  "executionPolicyDigest",
]);

const ATTEMPT_POLICY_FIELDS = Object.freeze([
  "schema",
  "attemptPolicyRef",
  "retryableFailureClasses",
  "maximumAttemptsPerReplicateSlot",
  "replicateCountPerCell",
  "selectionRule",
  "timeoutMs",
  "outputByteLimit",
  "fixedBeforeExecution",
]);

const KIND = Object.freeze({
  compilerBuildPin: "compilerBuildPin",
  compilerPin: "compilerBuildPin",
  projectRegistryRevision: "projectRegistryRevision",
  projectEvidenceRuntimeRevision: "projectEvidenceRuntimeRevision",
  projectRuntime: "projectEvidenceRuntimeRevision",
  targetSnapshotReceipt: "targetSnapshotReceipt",
  workerExecutionRuntimeRevision: "workerExecutionRuntimeRevision",
  workerRuntime: "workerExecutionRuntimeRevision",
  executionProfileRevision: "executionProfileRevision",
  attemptPolicy: "attemptPolicy",
});

const SCHEMA_TO_KIND = Object.freeze({
  [COMPILER_BUILD_PIN_SCHEMA]: KIND.compilerBuildPin,
  [PROJECT_REGISTRY_REVISION_SCHEMA]: KIND.projectRegistryRevision,
  [PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA]: KIND.projectEvidenceRuntimeRevision,
  [TARGET_SNAPSHOT_RECEIPT_SCHEMA]: KIND.targetSnapshotReceipt,
  [WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA]: KIND.workerExecutionRuntimeRevision,
  [EXECUTION_PROFILE_REVISION_SCHEMA]: KIND.executionProfileRevision,
  [ATTEMPT_POLICY_SCHEMA]: KIND.attemptPolicy,
});

const KIND_TO_SCHEMA = Object.freeze(Object.fromEntries(
  Object.entries(SCHEMA_TO_KIND).map(([schema, kind]) => [kind, schema]),
));

const REF_FIELDS = Object.freeze({
  [KIND.compilerBuildPin]: "compilerPinRef",
  [KIND.projectRegistryRevision]: "registryRevisionRef",
  [KIND.projectEvidenceRuntimeRevision]: "projectEvidenceRuntimeRevisionRef",
  [KIND.targetSnapshotReceipt]: "targetSnapshotReceiptRef",
  [KIND.workerExecutionRuntimeRevision]: "workerExecutionRuntimeRevisionRef",
  [KIND.executionProfileRevision]: "executionProfileRevisionRef",
  [KIND.attemptPolicy]: "attemptPolicyRef",
});

const SUBSTRATE_BINDINGS = new Set(["wsl", "windows"]);
const WORKER_SUBSTRATE_BINDINGS = new Set(["wsl", "windows", "remote_api"]);
const RETRYABLE_FAILURE_CLASSES = new Set([
  "transport_unavailable_before_dispatch",
  "transport_interrupted_before_raw_capture",
  "runtime_failed_before_raw_capture",
  "raw_result_structural_rejection",
]);
const SELECTION_RULES = new Set([
  "all_results_independent",
  "unanimity_reports_agreement_only",
  "fixed_majority_reports_agreement_only",
]);

const AUTHORITY_TOKEN = Symbol("direct-semantic-registry-authority");
const AUTHORITY_STATE = new WeakMap();
const RECORD_STATE = new WeakMap();
const REGISTRY_ADMISSION_PURPOSE = "semantic_registry_admit";
const VERIFICATION_REQUIRED_KINDS = new Set([
  KIND.compilerBuildPin,
  KIND.projectEvidenceRuntimeRevision,
  KIND.targetSnapshotReceipt,
  KIND.workerExecutionRuntimeRevision,
]);

function reject(code, detail = "") {
  return fail(code, detail);
}

function exact(value, fields, code) {
  if (!isPlainObject(value)) reject(code);
  try {
    assertExactObject(value, fields, code);
  } catch (error) {
    throw error;
  }
  const expected = new Set(fields);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) reject(code);
  return value;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) reject("direct_semantic_registry_object_invalid", label);
  return value;
}

function aliasFreeId(value, label) {
  const id = requiredId(value, label);
  const lowered = id.trim().toLowerCase();
  const pieces = lowered.split(/[/:@#]/u);
  const mutableSelectors = new Set([
    "current", "latest", "alias", "head", "tip", "default", "main", "master",
    "develop", "development", "working", "workspace", "mutable", "branch",
  ]);
  if (mutableSelectors.has(lowered) || pieces.some((piece) => mutableSelectors.has(piece))) {
    reject("direct_semantic_mutable_alias_forbidden", label);
  }
  return id;
}

function immutableId(value, label) {
  return aliasFreeId(value, label);
}

function plainString(value, label) {
  return requiredString(value, label);
}

function digest(value, label) {
  return requiredDigest(value, label);
}

function digestArray(value, label) {
  const values = sortedUniqueStrings(value, label, { allowEmpty: true });
  return values.map((entry) => digest(entry, label));
}

function stringArray(value, label, { nonEmpty = false } = {}) {
  const values = sortedUniqueStrings(value, label, { allowEmpty: !nonEmpty }).map((entry) => plainString(entry, label));
  if (nonEmpty && values.length === 0) reject("direct_semantic_registry_array_empty", label);
  return values;
}

function boundedInteger(value, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) {
    reject("direct_semantic_registry_bounded_integer_invalid", label);
  }
  // The shared helper is the canonical validator.  The local check above
  // keeps this slice explicit about its field-specific bounds.
  requiredBoundedInteger(value, label, min, max);
  return value;
}

function bool(value, label) {
  if (typeof value !== "boolean") reject("direct_semantic_registry_boolean_invalid", label);
  return value;
}

function schemaRecord(input, schema, fields, code) {
  exact(input, fields, code);
  if (input.schema !== schema) reject("direct_semantic_registry_schema_invalid", schema);
  return input;
}

function validate(schema, value) {
  try {
    validateContract(schema, value);
  } catch (error) {
    throw error;
  }
  return value;
}

function normalizeCompilerBuildPin(input) {
  schemaRecord(input, COMPILER_BUILD_PIN_SCHEMA, COMPILER_PIN_FIELDS, "direct_semantic_compiler_build_pin_shape_invalid");
  const value = {
    schema: COMPILER_BUILD_PIN_SCHEMA,
    compilerPinRef: immutableId(input.compilerPinRef, "compilerPinRef"),
    repositoryIdentity: plainString(input.repositoryIdentity, "repositoryIdentity"),
    gitCommit: plainString(input.gitCommit, "gitCommit"),
    gitTree: plainString(input.gitTree, "gitTree"),
    sourceArtifactDigest: digest(input.sourceArtifactDigest, "sourceArtifactDigest"),
    executableArtifactDigest: digest(input.executableArtifactDigest, "executableArtifactDigest"),
    interpreterToolchainDigest: digest(input.interpreterToolchainDigest, "interpreterToolchainDigest"),
    dependencyLockDigest: digest(input.dependencyLockDigest, "dependencyLockDigest"),
    installedDependencyEnvironmentDigest: digest(input.installedDependencyEnvironmentDigest, "installedDependencyEnvironmentDigest"),
    invocationContractDigest: digest(input.invocationContractDigest, "invocationContractDigest"),
    canonicalSchemaDigests: digestArray(input.canonicalSchemaDigests, "canonicalSchemaDigests"),
    patternLibraryDigests: digestArray(input.patternLibraryDigests, "patternLibraryDigests"),
    evidenceCatalogDigests: digestArray(input.evidenceCatalogDigests, "evidenceCatalogDigests"),
    compilerGateReceiptDigest: digest(input.compilerGateReceiptDigest, "compilerGateReceiptDigest"),
    adapterRevision: immutableId(input.adapterRevision, "adapterRevision"),
    admittedAt: plainString(input.admittedAt, "admittedAt"),
  };
  return validate(COMPILER_BUILD_PIN_SCHEMA, value);
}

function normalizeProjectEvidenceRuntimeRevision(input) {
  schemaRecord(input, PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA, PROJECT_RUNTIME_FIELDS, "direct_semantic_project_runtime_shape_invalid");
  const substrateBinding = plainString(input.substrateBinding, "substrateBinding");
  if (!SUBSTRATE_BINDINGS.has(substrateBinding)) reject("direct_semantic_project_runtime_substrate_invalid");
  const value = {
    schema: PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
    projectEvidenceRuntimeRevisionRef: immutableId(input.projectEvidenceRuntimeRevisionRef, "projectEvidenceRuntimeRevisionRef"),
    projectRef: immutableId(input.projectRef, "projectRef"),
    substrateBinding,
    operatingSystemRevision: plainString(input.operatingSystemRevision, "operatingSystemRevision"),
    interpreterExecutableDigest: digest(input.interpreterExecutableDigest, "interpreterExecutableDigest"),
    toolchainArtifactDigests: digestArray(input.toolchainArtifactDigests, "toolchainArtifactDigests"),
    installedDependencyEnvironmentDigest: digest(input.installedDependencyEnvironmentDigest, "installedDependencyEnvironmentDigest"),
    deterministicCheckRegistryDigest: digest(input.deterministicCheckRegistryDigest, "deterministicCheckRegistryDigest"),
    admittedEnvironmentInputDigest: digest(input.admittedEnvironmentInputDigest, "admittedEnvironmentInputDigest"),
    runtimePolicyDigest: digest(input.runtimePolicyDigest, "runtimePolicyDigest"),
  };
  return validate(PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA, value);
}

function normalizeProjectRegistryRevision(input) {
  const projectFields = input && Object.prototype.hasOwnProperty.call(input, "priorRevisionRef")
    ? PROJECT_REGISTRY_FIELDS
    : PROJECT_REGISTRY_FIELDS.filter((field) => field !== "priorRevisionRef");
  schemaRecord(input, PROJECT_REGISTRY_REVISION_SCHEMA, projectFields, "direct_semantic_project_registry_shape_invalid");
  const targetRevisionPolicy = requireObject(input.targetRevisionPolicy, "targetRevisionPolicy");
  exact(targetRevisionPolicy, ["kind", "allowedCommits", "cleanTreeRequired"], "direct_semantic_target_revision_policy_shape_invalid");
  if (targetRevisionPolicy.kind !== "exact_git_commit_allowlist") reject("direct_semantic_target_revision_policy_kind_invalid");
  const value = {
    schema: PROJECT_REGISTRY_REVISION_SCHEMA,
    registryRevisionRef: immutableId(input.registryRevisionRef, "registryRevisionRef"),
    projectRef: immutableId(input.projectRef, "projectRef"),
    substrateBinding: plainString(input.substrateBinding, "substrateBinding"),
    repositoryIdentity: plainString(input.repositoryIdentity, "repositoryIdentity"),
    privateRepositoryLocatorRef: immutableId(input.privateRepositoryLocatorRef, "privateRepositoryLocatorRef"),
    targetRevisionPolicy: {
      kind: "exact_git_commit_allowlist",
      allowedCommits: stringArray(targetRevisionPolicy.allowedCommits, "targetRevisionPolicy.allowedCommits", { nonEmpty: true }),
      cleanTreeRequired: bool(targetRevisionPolicy.cleanTreeRequired, "targetRevisionPolicy.cleanTreeRequired"),
    },
    projectEvidenceRuntimeRevisionRef: immutableId(input.projectEvidenceRuntimeRevisionRef, "projectEvidenceRuntimeRevisionRef"),
    evidenceCartographyRevisionRef: immutableId(input.evidenceCartographyRevisionRef, "evidenceCartographyRevisionRef"),
    authorityPolicyRef: immutableId(input.authorityPolicyRef, "authorityPolicyRef"),
    admittedByCapabilityRef: immutableId(input.admittedByCapabilityRef, "admittedByCapabilityRef"),
    admittedAt: plainString(input.admittedAt, "admittedAt"),
  };
  if (input.priorRevisionRef !== undefined) {
    value.priorRevisionRef = immutableId(input.priorRevisionRef, "priorRevisionRef");
  }
  if (!SUBSTRATE_BINDINGS.has(value.substrateBinding)) reject("direct_semantic_project_registry_substrate_invalid");
  return validate(PROJECT_REGISTRY_REVISION_SCHEMA, value);
}

function normalizeTargetSnapshotReceipt(input) {
  schemaRecord(input, TARGET_SNAPSHOT_RECEIPT_SCHEMA, TARGET_SNAPSHOT_FIELDS, "direct_semantic_target_snapshot_shape_invalid");
  const mode = plainString(input.snapshotMaterializationMode, "snapshotMaterializationMode");
  if (mode !== "isolated_read_only_snapshot") reject("direct_semantic_target_snapshot_materialization_mode_invalid");
  const value = {
    schema: TARGET_SNAPSHOT_RECEIPT_SCHEMA,
    targetSnapshotReceiptRef: immutableId(input.targetSnapshotReceiptRef, "targetSnapshotReceiptRef"),
    projectRegistryRevisionRef: immutableId(input.projectRegistryRevisionRef, "projectRegistryRevisionRef"),
    repositoryIdentity: plainString(input.repositoryIdentity, "repositoryIdentity"),
    targetORevision: immutableId(input.targetORevision, "targetORevision"),
    gitCommit: plainString(input.gitCommit, "gitCommit"),
    gitTree: plainString(input.gitTree, "gitTree"),
    submoduleClosureDigest: digest(input.submoduleClosureDigest, "submoduleClosureDigest"),
    lfsObjectClosureDigest: digest(input.lfsObjectClosureDigest, "lfsObjectClosureDigest"),
    admittedGeneratedInputDigest: digest(input.admittedGeneratedInputDigest, "admittedGeneratedInputDigest"),
    evidenceCartographyRevisionRef: immutableId(input.evidenceCartographyRevisionRef, "evidenceCartographyRevisionRef"),
    projectEvidenceRuntimeRevisionRef: immutableId(input.projectEvidenceRuntimeRevisionRef, "projectEvidenceRuntimeRevisionRef"),
    projectRuntimeInputDigest: digest(input.projectRuntimeInputDigest, "projectRuntimeInputDigest"),
    sourceStatusDigest: digest(input.sourceStatusDigest, "sourceStatusDigest"),
    snapshotArtifactRef: immutableId(input.snapshotArtifactRef, "snapshotArtifactRef"),
    snapshotMaterializationMode: mode,
    preObservationReceiptRef: immutableId(input.preObservationReceiptRef, "preObservationReceiptRef"),
    postObservationReceiptRef: immutableId(input.postObservationReceiptRef, "postObservationReceiptRef"),
    snapshotDigest: digest(input.snapshotDigest, "snapshotDigest"),
    capturedAt: plainString(input.capturedAt, "capturedAt"),
  };
  return validate(TARGET_SNAPSHOT_RECEIPT_SCHEMA, value);
}

function normalizeWorkerExecutionRuntimeRevision(input) {
  schemaRecord(input, WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA, WORKER_RUNTIME_FIELDS, "direct_semantic_worker_runtime_shape_invalid");
  const substrateBinding = plainString(input.substrateBinding, "substrateBinding");
  if (!WORKER_SUBSTRATE_BINDINGS.has(substrateBinding)) reject("direct_semantic_worker_runtime_substrate_invalid");
  const value = {
    schema: WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
    workerExecutionRuntimeRevisionRef: immutableId(input.workerExecutionRuntimeRevisionRef, "workerExecutionRuntimeRevisionRef"),
    substrateBinding,
    backendAdapterRevision: immutableId(input.backendAdapterRevision, "backendAdapterRevision"),
    processLauncherDigest: digest(input.processLauncherDigest, "processLauncherDigest"),
    sandboxPolicyDigest: digest(input.sandboxPolicyDigest, "sandboxPolicyDigest"),
    scratchPolicyDigest: digest(input.scratchPolicyDigest, "scratchPolicyDigest"),
    environmentAllowlistDigest: digest(input.environmentAllowlistDigest, "environmentAllowlistDigest"),
    credentialExclusionPolicyDigest: digest(input.credentialExclusionPolicyDigest, "credentialExclusionPolicyDigest"),
    outputCapturePolicyDigest: digest(input.outputCapturePolicyDigest, "outputCapturePolicyDigest"),
    runtimeArtifactDigest: digest(input.runtimeArtifactDigest, "runtimeArtifactDigest"),
  };
  return validate(WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA, value);
}

function normalizeExecutionProfileRevision(input) {
  schemaRecord(input, EXECUTION_PROFILE_REVISION_SCHEMA, EXECUTION_PROFILE_FIELDS, "direct_semantic_execution_profile_shape_invalid");
  let maximumCostMicrounitsPerAttempt = input.maximumCostMicrounitsPerAttempt;
  if (maximumCostMicrounitsPerAttempt !== null) {
    maximumCostMicrounitsPerAttempt = boundedInteger(maximumCostMicrounitsPerAttempt, "maximumCostMicrounitsPerAttempt", 0);
  }
  const value = {
    schema: EXECUTION_PROFILE_REVISION_SCHEMA,
    executionProfileRevisionRef: immutableId(input.executionProfileRevisionRef, "executionProfileRevisionRef"),
    providerProfileRevisionRef: immutableId(input.providerProfileRevisionRef, "providerProfileRevisionRef"),
    allowedModels: stringArray(input.allowedModels, "allowedModels", { nonEmpty: true }),
    allowedReasoningEfforts: stringArray(input.allowedReasoningEfforts, "allowedReasoningEfforts", { nonEmpty: true }),
    workerExecutionRuntimeRevisionRef: immutableId(input.workerExecutionRuntimeRevisionRef, "workerExecutionRuntimeRevisionRef"),
    attemptPolicyRevisionRefs: stringArray(input.attemptPolicyRevisionRefs, "attemptPolicyRevisionRefs", { nonEmpty: true }).map((entry) => immutableId(entry, "attemptPolicyRevisionRefs")),
    maximumConcurrentAttempts: boundedInteger(input.maximumConcurrentAttempts, "maximumConcurrentAttempts"),
    maximumInputTokensPerAttempt: boundedInteger(input.maximumInputTokensPerAttempt, "maximumInputTokensPerAttempt"),
    maximumOutputTokensPerAttempt: boundedInteger(input.maximumOutputTokensPerAttempt, "maximumOutputTokensPerAttempt"),
    maximumCostMicrounitsPerAttempt,
    executionPolicyDigest: digest(input.executionPolicyDigest, "executionPolicyDigest"),
  };
  return validate(EXECUTION_PROFILE_REVISION_SCHEMA, value);
}

function normalizeAttemptPolicy(input) {
  schemaRecord(input, ATTEMPT_POLICY_SCHEMA, ATTEMPT_POLICY_FIELDS, "direct_semantic_attempt_policy_shape_invalid");
  const retryableFailureClasses = stringArray(input.retryableFailureClasses, "retryableFailureClasses");
  if (retryableFailureClasses.some((entry) => !RETRYABLE_FAILURE_CLASSES.has(entry))) reject("direct_semantic_attempt_policy_failure_class_invalid");
  const selectionRule = plainString(input.selectionRule, "selectionRule");
  if (!SELECTION_RULES.has(selectionRule)) reject("direct_semantic_attempt_policy_selection_rule_invalid");
  if (input.fixedBeforeExecution !== true) reject("direct_semantic_attempt_policy_not_frozen");
  const value = {
    schema: ATTEMPT_POLICY_SCHEMA,
    attemptPolicyRef: immutableId(input.attemptPolicyRef, "attemptPolicyRef"),
    retryableFailureClasses,
    maximumAttemptsPerReplicateSlot: boundedInteger(input.maximumAttemptsPerReplicateSlot, "maximumAttemptsPerReplicateSlot"),
    replicateCountPerCell: boundedInteger(input.replicateCountPerCell, "replicateCountPerCell"),
    selectionRule,
    timeoutMs: boundedInteger(input.timeoutMs, "timeoutMs"),
    outputByteLimit: boundedInteger(input.outputByteLimit, "outputByteLimit"),
    fixedBeforeExecution: true,
  };
  return validate(ATTEMPT_POLICY_SCHEMA, value);
}

const NORMALIZERS = Object.freeze({
  [KIND.compilerBuildPin]: normalizeCompilerBuildPin,
  [KIND.projectRegistryRevision]: normalizeProjectRegistryRevision,
  [KIND.projectEvidenceRuntimeRevision]: normalizeProjectEvidenceRuntimeRevision,
  [KIND.targetSnapshotReceipt]: normalizeTargetSnapshotReceipt,
  [KIND.workerExecutionRuntimeRevision]: normalizeWorkerExecutionRuntimeRevision,
  [KIND.executionProfileRevision]: normalizeExecutionProfileRevision,
  [KIND.attemptPolicy]: normalizeAttemptPolicy,
});

function recordDigest(kind, record) {
  return digestFor(`direct_semantic_registry_${kind}@1`, record);
}

function createRegistryAuthority(options = {}) {
  if (!isPlainObject(options)) reject("direct_semantic_registry_options_invalid");
  const authorityRef = immutableId(options.authorityRef || "direct-semantic-registry-authority", "authorityRef");
  const capabilityAuthority = options.capabilityAuthority;
  if (!capabilityAuthority || typeof capabilityAuthority.assertBoundToPrincipal !== "function") {
    reject("direct_semantic_registry_capability_authority_required");
  }
  const state = {
    authorityRef,
    capabilityAuthority,
    records: new Map(Object.values(KIND).map((kind) => [kind, new Map()])),
    globalRefs: new Map(),
    sequence: 0,
  };
  const authority = {
    schema: REGISTRY_AUTHORITY_SCHEMA,
    authorityRef,
    admitCompilerBuildPin(input, observed, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      if (observed === undefined) reject("direct_semantic_registry_verification_observation_required", KIND.compilerBuildPin);
      const verificationReceipt = pinVerification.verifyCompilerBuildPin(input, observed);
      return admit(state, KIND.compilerBuildPin, input, { admission, verificationReceipt });
    },
    admitProjectEvidenceRuntimeRevision(input, observed, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      if (observed === undefined) reject("direct_semantic_registry_verification_observation_required", KIND.projectEvidenceRuntimeRevision);
      const verificationReceipt = pinVerification.verifyProjectEvidenceRuntimeRevision(input, observed);
      return admit(state, KIND.projectEvidenceRuntimeRevision, input, { admission, verificationReceipt });
    },
    admitProjectRegistryRevision(input, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      return admit(state, KIND.projectRegistryRevision, input, { admission });
    },
    admitTargetSnapshotReceipt(input, observed, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      if (observed === undefined) reject("direct_semantic_registry_verification_observation_required", KIND.targetSnapshotReceipt);
      const verificationReceipt = pinVerification.verifyTargetSnapshotReceipt(input, observed);
      return admit(state, KIND.targetSnapshotReceipt, input, { admission, verificationReceipt });
    },
    admitWorkerExecutionRuntimeRevision(input, observed, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      if (observed === undefined) reject("direct_semantic_registry_verification_observation_required", KIND.workerExecutionRuntimeRevision);
      const verificationReceipt = pinVerification.verifyWorkerExecutionRuntimeRevision(input, observed);
      return admit(state, KIND.workerExecutionRuntimeRevision, input, { admission, verificationReceipt });
    },
    admitExecutionProfileRevision(input, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      return admit(state, KIND.executionProfileRevision, input, { admission });
    },
    admitAttemptPolicy(input, admissionAuthority) {
      const admission = assertAdmissionAuthority(state, admissionAuthority);
      return admit(state, KIND.attemptPolicy, input, { admission });
    },
    resolve(kind, ref) { return resolveRecord(state, normalizeKind(kind), ref); },
    get(kind, ref) { return resolveRecord(state, normalizeKind(kind), ref); },
    resolveRecord(kind, ref) { return resolveRecord(state, normalizeKind(kind), ref); },
    getRecord(kind, ref) { return resolveRecord(state, normalizeKind(kind), ref); },
    has(kind, ref) {
      try {
        resolveRecord(state, normalizeKind(kind), ref);
        return true;
      } catch (_error) {
        return false;
      }
    },
    list(kind) {
      const normalizedKind = normalizeKind(kind);
      return Object.freeze([...state.records.get(normalizedKind).values()]);
    },
    recordDigest(record) {
      const meta = assertTrustedRecord(state, record);
      return meta.digest;
    },
    assertRecord(kind, record) {
      if (record === undefined) {
        record = kind;
        kind = RECORD_STATE.get(record)?.kind;
      }
      return assertTrustedRecord(state, record, kind === undefined ? undefined : normalizeKind(kind)) && record;
    },
    isTrustedRecord(kind, record) {
      if (record === undefined) {
        record = kind;
        kind = RECORD_STATE.get(record)?.kind;
      }
      try {
        assertTrustedRecord(state, record, kind === undefined ? undefined : normalizeKind(kind));
        return true;
      } catch (_error) {
        return false;
      }
    },
    isRecord(kind, record) {
      return this.isTrustedRecord(kind, record);
    },
    assertAdmitted(kind, valueOrRef) {
      return assertRevision(state, normalizeKind(kind), valueOrRef);
    },
    assertExecutionEligible(kind, valueOrRef) {
      const normalizedKind = normalizeKind(kind);
      const record = assertRevision(state, normalizedKind, valueOrRef);
      assertExecutionEligible(state, normalizedKind, record);
      return record;
    },
    verificationReceipt(kind, valueOrRef) {
      const normalizedKind = normalizeKind(kind);
      const record = assertRevision(state, normalizedKind, valueOrRef);
      return assertExecutionEligible(state, normalizedKind, record).verificationReceipt;
    },
    verifyCompilerBuildPin(pin, observed) {
      assertTrustedRecord(state, pin, KIND.compilerBuildPin);
      return pinVerification.verifyCompilerBuildPin(pin, observed);
    },
    verifyCompilerPin(pin, observed) {
      return this.verifyCompilerBuildPin(pin, observed);
    },
    verifyProjectEvidenceRuntimeRevision(pin, observed) {
      assertTrustedRecord(state, pin, KIND.projectEvidenceRuntimeRevision);
      return pinVerification.verifyProjectEvidenceRuntimeRevision(pin, observed);
    },
    verifyProjectRuntime(pin, observed) {
      return this.verifyProjectEvidenceRuntimeRevision(pin, observed);
    },
    verifyTargetSnapshotReceipt(receipt, observed) {
      assertTrustedRecord(state, receipt, KIND.targetSnapshotReceipt);
      return pinVerification.verifyTargetSnapshotReceipt(receipt, observed);
    },
    verifyWorkerExecutionRuntimeRevision(runtime, observed) {
      assertTrustedRecord(state, runtime, KIND.workerExecutionRuntimeRevision);
      return pinVerification.verifyWorkerExecutionRuntimeRevision(runtime, observed);
    },
    verifyWorkerRuntime(runtime, observed) {
      return this.verifyWorkerExecutionRuntimeRevision(runtime, observed);
    },
    assertRuntimeSeparation(projectRuntime, workerRuntime) {
      return assertRuntimeSeparation(state, projectRuntime, workerRuntime);
    },
    bindJob(lineage) {
      return bindJob(state, lineage);
    },
    assertJobLineage(lineage) {
      return bindJob(state, lineage);
    },
    snapshot() {
      return snapshotState(state);
    },
  };
  AUTHORITY_STATE.set(authority, state);
  // Methods are receiver-guarded as well as the records.  A shallow object
  // copy can retain function values, but it cannot retain the authority
  // receiver token; only the factory-owned object may exercise these methods.
  for (const key of Object.keys(authority)) {
    if (typeof authority[key] !== "function") continue;
    const implementation = authority[key];
    authority[key] = function guardedRegistryMethod(...args) {
      if (AUTHORITY_STATE.get(this) !== state) reject("direct_semantic_registry_authority_untrusted");
      return implementation.apply(this, args);
    };
  }
  return Object.freeze(authority);
}

function normalizeKind(kind) {
  if (Object.values(KIND).includes(kind)) return kind;
  if (SCHEMA_TO_KIND[kind]) return SCHEMA_TO_KIND[kind];
  const normalized = String(kind || "");
  const aliases = {
    CompilerBuildPin: KIND.compilerBuildPin,
    compilerPin: KIND.compilerBuildPin,
    ProjectRegistryRevision: KIND.projectRegistryRevision,
    ProjectEvidenceRuntimeRevision: KIND.projectEvidenceRuntimeRevision,
    projectRuntime: KIND.projectEvidenceRuntimeRevision,
    TargetSnapshotReceipt: KIND.targetSnapshotReceipt,
    WorkerExecutionRuntimeRevision: KIND.workerExecutionRuntimeRevision,
    workerRuntime: KIND.workerExecutionRuntimeRevision,
    ExecutionProfileRevision: KIND.executionProfileRevision,
    AttemptPolicy: KIND.attemptPolicy,
  };
  if (aliases[normalized]) return aliases[normalized];
  reject("direct_semantic_registry_kind_invalid", normalized);
}

function assertAuthority(authority) {
  const state = AUTHORITY_STATE.get(authority);
  if (!state) reject("direct_semantic_registry_authority_untrusted");
  return state;
}

function assertAdmissionAuthority(state, value) {
  requireObject(value, "admissionAuthority");
  exact(value, ["capability", "semanticPrincipal"], "direct_semantic_registry_admission_authority_shape_invalid");
  const capabilityRecord = state.capabilityAuthority.assertBoundToPrincipal(value.capability, value.semanticPrincipal);
  const capability = capabilityRecord.capability;
  const principal = capabilityRecord.principal;
  if (capability.operation !== "administer_service") {
    reject("direct_semantic_registry_admission_operation_denied");
  }
  if (!capability.purposeScopes.includes(REGISTRY_ADMISSION_PURPOSE)) {
    reject("direct_semantic_registry_admission_purpose_denied");
  }
  if (!principal?.purposeScopes?.includes(REGISTRY_ADMISSION_PURPOSE)) {
    reject("direct_semantic_registry_admission_principal_purpose_denied");
  }
  if (!principal || !["operator", "direct_service"].includes(principal.principalClass)) {
    reject("direct_semantic_registry_admission_principal_denied");
  }
  return deepFreeze({
    capabilityRef: capability.capabilityId,
    principalRef: principal.principalId,
    purpose: REGISTRY_ADMISSION_PURPOSE,
  });
}

function assertTrustedRecord(state, record, expectedKind = undefined) {
  if (!isPlainObject(record)) reject("direct_semantic_registry_record_untrusted");
  const meta = RECORD_STATE.get(record);
  if (!meta || meta.state !== state) reject("direct_semantic_registry_record_untrusted");
  if (expectedKind !== undefined && meta.kind !== expectedKind) {
    reject("direct_semantic_registry_record_kind_mismatch", expectedKind);
  }
  return meta;
}

function assertExecutionEligible(state, kind, record) {
  const meta = assertTrustedRecord(state, record, kind);
  if (VERIFICATION_REQUIRED_KINDS.has(kind) && !meta.verificationReceipt?.verified) {
    reject("direct_semantic_registry_record_unverified", `${kind}:${meta.ref}`);
  }
  return meta;
}

function resolveRecord(state, kind, ref) {
  const refField = REF_FIELDS[kind];
  const normalizedRef = immutableId(ref, refField);
  const record = state.records.get(kind).get(normalizedRef);
  if (!record) reject("direct_semantic_registry_revision_unknown", `${kind}:${normalizedRef}`);
  return record;
}

function assertRevision(state, kind, valueOrRef) {
  if (isPlainObject(valueOrRef)) return (assertTrustedRecord(state, valueOrRef, kind), valueOrRef);
  return resolveRecord(state, kind, valueOrRef);
}

function ensureUniqueRef(state, kind, ref, digestValue) {
  const existingKind = state.globalRefs.get(ref);
  if (existingKind) {
    const existing = state.records.get(existingKind).get(ref);
    if (existingKind === kind && existing && RECORD_STATE.get(existing)?.digest === digestValue) {
      reject("direct_semantic_registry_duplicate_revision", ref);
    }
    reject("direct_semantic_registry_revision_ref_collision", ref);
  }
}

function assertProjectRuntimeMatches(project, runtime) {
  if (project.projectRef !== runtime.projectRef) reject("direct_semantic_registry_project_runtime_ref_mismatch", "projectRef");
  if (project.substrateBinding !== runtime.substrateBinding) reject("direct_semantic_registry_project_runtime_ref_mismatch", "substrateBinding");
}

function assertCrossReferences(state, kind, record) {
  if (kind === KIND.projectRegistryRevision) {
    const runtime = resolveRecord(state, KIND.projectEvidenceRuntimeRevision, record.projectEvidenceRuntimeRevisionRef);
    assertProjectRuntimeMatches(record, runtime);
    if (record.priorRevisionRef !== undefined) {
      const prior = resolveRecord(state, KIND.projectRegistryRevision, record.priorRevisionRef);
      if (prior.projectRef !== record.projectRef) reject("direct_semantic_registry_prior_revision_project_mismatch");
      if (prior.registryRevisionRef === record.registryRevisionRef) reject("direct_semantic_registry_prior_revision_self_reference");
    }
    return;
  }
  if (kind === KIND.targetSnapshotReceipt) {
    const project = resolveRecord(state, KIND.projectRegistryRevision, record.projectRegistryRevisionRef);
    const runtime = resolveRecord(state, KIND.projectEvidenceRuntimeRevision, record.projectEvidenceRuntimeRevisionRef);
    assertProjectRuntimeMatches(project, runtime);
    if (record.repositoryIdentity !== project.repositoryIdentity) reject("direct_semantic_registry_target_repository_mismatch");
    if (record.evidenceCartographyRevisionRef !== project.evidenceCartographyRevisionRef) reject("direct_semantic_registry_target_cartography_mismatch");
    if (!project.targetRevisionPolicy.allowedCommits.includes(record.gitCommit)) {
      reject("direct_semantic_registry_target_commit_not_allowed");
    }
    return;
  }
  if (kind === KIND.executionProfileRevision) {
    resolveRecord(state, KIND.workerExecutionRuntimeRevision, record.workerExecutionRuntimeRevisionRef);
    for (const attemptPolicyRef of record.attemptPolicyRevisionRefs) {
      resolveRecord(state, KIND.attemptPolicy, attemptPolicyRef);
    }
  }
}

function admit(state, kind, input, { admission, verificationReceipt = null } = {}) {
  if (!NORMALIZERS[kind]) reject("direct_semantic_registry_kind_invalid", kind);
  if (!admission) reject("direct_semantic_registry_admission_authority_required", kind);
  if (VERIFICATION_REQUIRED_KINDS.has(kind) && !verificationReceipt?.verified) {
    reject("direct_semantic_registry_verification_receipt_required", kind);
  }
  const existingMeta = isPlainObject(input) ? RECORD_STATE.get(input) : undefined;
  if (existingMeta) {
    if (existingMeta.state !== state || existingMeta.kind !== kind) reject("direct_semantic_registry_record_untrusted");
    return input;
  }
  const record = NORMALIZERS[kind](input);
  if (kind === KIND.projectRegistryRevision &&
      record.admittedByCapabilityRef !== admission.capabilityRef) {
    reject("direct_semantic_registry_admission_capability_mismatch");
  }
  const refField = REF_FIELDS[kind];
  const ref = record[refField];
  const digestValue = recordDigest(kind, record);
  ensureUniqueRef(state, kind, ref, digestValue);
  assertCrossReferences(state, kind, record);
  const admitted = deepFreeze({ ...record });
  const meta = Object.freeze({
    state,
    authorityRef: state.authorityRef,
    kind,
    ref,
    digest: digestValue,
    sequence: ++state.sequence,
    admission,
    verificationReceipt,
  });
  RECORD_STATE.set(admitted, meta);
  state.records.get(kind).set(ref, admitted);
  state.globalRefs.set(ref, kind);
  return admitted;
}

function assertRuntimeSeparation(state, projectRuntimeValue, workerRuntimeValue) {
  const projectRuntime = assertRevision(state, KIND.projectEvidenceRuntimeRevision, projectRuntimeValue);
  const workerRuntime = assertRevision(state, KIND.workerExecutionRuntimeRevision, workerRuntimeValue);
  if (projectRuntime.projectEvidenceRuntimeRevisionRef === workerRuntime.workerExecutionRuntimeRevisionRef) {
    reject("direct_semantic_registry_runtime_role_substitution");
  }
  if (projectRuntime.schema === workerRuntime.schema ||
      projectRuntime.projectEvidenceRuntimeRevisionRef === workerRuntime.workerExecutionRuntimeRevisionRef) {
    reject("direct_semantic_registry_runtime_role_substitution");
  }
  return deepFreeze({
    projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
    workerExecutionRuntimeRevisionRef: workerRuntime.workerExecutionRuntimeRevisionRef,
    distinct: true,
  });
}

function bindJob(state, lineage) {
  requireObject(lineage, "lineage");
  const allowed = new Set([
    "jobRef",
    "compilerPinRef",
    "projectRegistryRevisionRef",
    "targetSnapshotReceiptRef",
    "projectEvidenceRuntimeRevisionRef",
    "workerExecutionRuntimeRevisionRef",
    "executionProfileRevisionRef",
    "attemptPolicyRef",
  ]);
  const keys = Object.keys(lineage);
  if (keys.some((key) => !allowed.has(key))) reject("direct_semantic_registry_job_binding_shape_invalid");
  const compilerPin = assertRevision(state, KIND.compilerBuildPin, lineage.compilerPinRef);
  const project = assertRevision(state, KIND.projectRegistryRevision, lineage.projectRegistryRevisionRef);
  const target = assertRevision(state, KIND.targetSnapshotReceipt, lineage.targetSnapshotReceiptRef);
  const projectRuntime = assertRevision(
    state,
    KIND.projectEvidenceRuntimeRevision,
    lineage.projectEvidenceRuntimeRevisionRef || target.projectEvidenceRuntimeRevisionRef,
  );
  const profile = assertRevision(state, KIND.executionProfileRevision, lineage.executionProfileRevisionRef);
  const workerRuntime = assertRevision(state, KIND.workerExecutionRuntimeRevision, lineage.workerExecutionRuntimeRevisionRef || profile.workerExecutionRuntimeRevisionRef);
  const attemptPolicy = assertRevision(
    state,
    KIND.attemptPolicy,
    lineage.attemptPolicyRef || profile.attemptPolicyRevisionRefs[0],
  );
  const compilerVerification = assertExecutionEligible(state, KIND.compilerBuildPin, compilerPin);
  const targetVerification = assertExecutionEligible(state, KIND.targetSnapshotReceipt, target);
  const projectRuntimeVerification = assertExecutionEligible(state, KIND.projectEvidenceRuntimeRevision, projectRuntime);
  const workerRuntimeVerification = assertExecutionEligible(state, KIND.workerExecutionRuntimeRevision, workerRuntime);
  if (target.projectRegistryRevisionRef !== project.registryRevisionRef) reject("direct_semantic_registry_job_target_project_mismatch");
  if (target.projectEvidenceRuntimeRevisionRef !== projectRuntime.projectEvidenceRuntimeRevisionRef) reject("direct_semantic_registry_job_target_runtime_mismatch");
  if (!profile.attemptPolicyRevisionRefs.includes(attemptPolicy.attemptPolicyRef)) reject("direct_semantic_registry_job_attempt_policy_not_allowed");
  if (profile.workerExecutionRuntimeRevisionRef !== workerRuntime.workerExecutionRuntimeRevisionRef) reject("direct_semantic_registry_job_worker_runtime_not_allowed");
  assertRuntimeSeparation(state, projectRuntime, workerRuntime);
  const result = {
    schema: REGISTRY_JOB_BINDING_SCHEMA,
    ...(lineage.jobRef === undefined ? {} : { jobRef: immutableId(lineage.jobRef, "jobRef") }),
    compilerPinRef: compilerPin.compilerPinRef,
    projectRegistryRevisionRef: project.registryRevisionRef,
    targetSnapshotReceiptRef: target.targetSnapshotReceiptRef,
    projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
    workerExecutionRuntimeRevisionRef: workerRuntime.workerExecutionRuntimeRevisionRef,
    executionProfileRevisionRef: profile.executionProfileRevisionRef,
    attemptPolicyRef: attemptPolicy.attemptPolicyRef,
    verificationReceiptDigests: {
      compilerBuildPin: digestFor("direct-semantic-verification-receipt", compilerVerification.verificationReceipt),
      targetSnapshotReceipt: digestFor("direct-semantic-verification-receipt", targetVerification.verificationReceipt),
      projectEvidenceRuntimeRevision: digestFor("direct-semantic-verification-receipt", projectRuntimeVerification.verificationReceipt),
      workerExecutionRuntimeRevision: digestFor("direct-semantic-verification-receipt", workerRuntimeVerification.verificationReceipt),
    },
  };
  return deepFreeze(result);
}

function snapshotState(state) {
  const records = {};
  for (const [kind, table] of state.records.entries()) {
    records[kind] = Object.freeze([...table.keys()].sort());
  }
  return deepFreeze({
    schema: REGISTRY_AUTHORITY_SCHEMA,
    authorityRef: state.authorityRef,
    sequence: state.sequence,
    records,
  });
}

function isRegistryAuthority(value) {
  return Boolean(AUTHORITY_STATE.get(value));
}

function authorityFrom(value) {
  return assertAuthority(value);
}

function DirectSemanticRegistry(options) {
  return createRegistryAuthority(options);
}

function admitCompilerBuildPin(authority, input, observed, admissionAuthority) {
  return authorityFrom(authority) && authority.admitCompilerBuildPin(input, observed, admissionAuthority);
}
function admitProjectEvidenceRuntimeRevision(authority, input, observed, admissionAuthority) {
  return authorityFrom(authority) && authority.admitProjectEvidenceRuntimeRevision(input, observed, admissionAuthority);
}
function admitProjectRegistryRevision(authority, input, admissionAuthority) {
  return authorityFrom(authority) && authority.admitProjectRegistryRevision(input, admissionAuthority);
}
function admitTargetSnapshotReceipt(authority, input, observed, admissionAuthority) {
  return authorityFrom(authority) && authority.admitTargetSnapshotReceipt(input, observed, admissionAuthority);
}
function admitWorkerExecutionRuntimeRevision(authority, input, observed, admissionAuthority) {
  return authorityFrom(authority) && authority.admitWorkerExecutionRuntimeRevision(input, observed, admissionAuthority);
}
function admitExecutionProfileRevision(authority, input, admissionAuthority) {
  return authorityFrom(authority) && authority.admitExecutionProfileRevision(input, admissionAuthority);
}
function admitAttemptPolicy(authority, input, admissionAuthority) {
  return authorityFrom(authority) && authority.admitAttemptPolicy(input, admissionAuthority);
}

function resolveRegistryRecord(authority, kind, ref) {
  authorityFrom(authority);
  return authority.resolve(kind, ref);
}

function assertRegistryRecord(authority, kind, record) {
  authorityFrom(authority);
  return authority.assertRecord(kind, record);
}

function isTrustedRegistryRecord(authority, kind, record) {
  const state = AUTHORITY_STATE.get(authority);
  if (!state) return false;
  try {
    assertTrustedRecord(state, record, normalizeKind(kind));
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  REGISTRY_AUTHORITY_SCHEMA,
  REGISTRY_JOB_BINDING_SCHEMA,
  COMPILER_BUILD_PIN_SCHEMA,
  PROJECT_REGISTRY_REVISION_SCHEMA,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  EXECUTION_PROFILE_REVISION_SCHEMA,
  ATTEMPT_POLICY_SCHEMA,
  KIND,
  createRegistryAuthority,
  createSemanticRegistryAuthority: createRegistryAuthority,
  createImmutableRegistry: createRegistryAuthority,
  createInMemoryRegistryAuthority: createRegistryAuthority,
  DirectSemanticRegistry,
  RegistryAuthority: DirectSemanticRegistry,
  ImmutableRegistryAuthority: DirectSemanticRegistry,
  InMemoryRegistryAuthority: DirectSemanticRegistry,
  isRegistryAuthority,
  resolveRegistryRecord,
  assertRegistryRecord,
  isTrustedRegistryRecord,
  admitCompilerBuildPin,
  admitProjectEvidenceRuntimeRevision,
  admitProjectRegistryRevision,
  admitTargetSnapshotReceipt,
  admitWorkerExecutionRuntimeRevision,
  admitExecutionProfileRevision,
  admitAttemptPolicy,
  ...pinVerification,
};
