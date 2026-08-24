#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canonicalJson,
  deepFreeze,
  digestFor,
  isDigest,
  parseCanonicalJson,
} = require("../src/main/direct/semantic-service/canonical.js");
const {
  assertValidContract,
  checkContract,
  ERROR_CODES,
} = require("../src/main/direct/semantic-service/schema-validator.js");
const {
  CONTRACT_SCHEMAS,
  validateContract,
} = require("../src/main/direct/semantic-service/contract-schemas.js");

const digest = (hex) => `sha256:${hex.repeat(64).slice(0, 64)}`;
const t = "2026-08-24T00:00:00.000Z";
const ref = (name) => `ref:${name}`;

function expectCode(code, action, message = `expected ${code}`) {
  assert.throws(action, (error) => error?.code === code, message);
}

function expectInvalid(schemaName, value, code) {
  const result = checkContract(schemaName, value);
  assert.equal(result.valid, false, `${schemaName} should be rejected`);
  if (code) assert.ok(result.errors.some((error) => error.code === code), `${schemaName} should report ${code}: ${JSON.stringify(result.errors)}`);
}

function positiveFixtures() {
  const compilerPin = {
    schema: "direct_semantic_compiler_build_pin@1",
    compilerPinRef: ref("compiler-pin-1"),
    repositoryIdentity: "semantic-compiler:fixture",
    gitCommit: ref("git-commit-1"),
    gitTree: ref("git-tree-1"),
    sourceArtifactDigest: digest("a"),
    executableArtifactDigest: digest("b"),
    interpreterToolchainDigest: digest("c"),
    dependencyLockDigest: digest("d"),
    installedDependencyEnvironmentDigest: digest("e"),
    invocationContractDigest: digest("f"),
    canonicalSchemaDigests: [digest("1")],
    patternLibraryDigests: [digest("2")],
    evidenceCatalogDigests: [digest("3")],
    compilerGateReceiptDigest: digest("4"),
    adapterRevision: ref("adapter-1"),
    admittedAt: t,
  };
  const projectRuntime = {
    schema: "direct_semantic_project_evidence_runtime_revision@1",
    projectEvidenceRuntimeRevisionRef: ref("project-runtime-1"),
    projectRef: ref("project-1"),
    substrateBinding: "wsl",
    operatingSystemRevision: ref("ubuntu-24-04"),
    interpreterExecutableDigest: digest("5"),
    toolchainArtifactDigests: [digest("6")],
    installedDependencyEnvironmentDigest: digest("7"),
    deterministicCheckRegistryDigest: digest("8"),
    admittedEnvironmentInputDigest: digest("9"),
    runtimePolicyDigest: digest("a"),
  };
  const registry = {
    schema: "direct_semantic_project_registry_revision@1",
    registryRevisionRef: ref("registry-1"),
    projectRef: ref("project-1"),
    substrateBinding: "wsl",
    repositoryIdentity: "project:fixture",
    privateRepositoryLocatorRef: ref("locator-1"),
    targetRevisionPolicy: {
      kind: "exact_git_commit_allowlist",
      allowedCommits: [ref("git-commit-1")],
      cleanTreeRequired: true,
    },
    projectEvidenceRuntimeRevisionRef: ref("project-runtime-1"),
    evidenceCartographyRevisionRef: ref("cartography-1"),
    authorityPolicyRef: ref("authority-policy-1"),
    admittedByCapabilityRef: ref("capability-1"),
    admittedAt: t,
  };
  const snapshot = {
    schema: "direct_semantic_target_snapshot_receipt@1",
    targetSnapshotReceiptRef: ref("snapshot-1"),
    projectRegistryRevisionRef: ref("registry-1"),
    repositoryIdentity: "project:fixture",
    targetORevision: ref("o-revision-1"),
    gitCommit: ref("git-commit-1"),
    gitTree: ref("git-tree-1"),
    submoduleClosureDigest: digest("b"),
    lfsObjectClosureDigest: digest("c"),
    admittedGeneratedInputDigest: digest("d"),
    evidenceCartographyRevisionRef: ref("cartography-1"),
    projectEvidenceRuntimeRevisionRef: ref("project-runtime-1"),
    projectRuntimeInputDigest: digest("e"),
    sourceStatusDigest: digest("f"),
    snapshotArtifactRef: ref("snapshot-artifact-1"),
    snapshotMaterializationMode: "isolated_read_only_snapshot",
    preObservationReceiptRef: ref("pre-observation-1"),
    postObservationReceiptRef: ref("post-observation-1"),
    snapshotDigest: digest("0"),
    capturedAt: t,
  };
  const workerRuntime = {
    schema: "direct_semantic_worker_execution_runtime_revision@1",
    workerExecutionRuntimeRevisionRef: ref("worker-runtime-1"),
    substrateBinding: "remote_api",
    backendAdapterRevision: ref("backend-adapter-1"),
    processLauncherDigest: digest("1"),
    sandboxPolicyDigest: digest("2"),
    scratchPolicyDigest: digest("3"),
    environmentAllowlistDigest: digest("4"),
    credentialExclusionPolicyDigest: digest("5"),
    outputCapturePolicyDigest: digest("6"),
    runtimeArtifactDigest: digest("7"),
  };
  const profile = {
    schema: "direct_semantic_execution_profile_revision@1",
    executionProfileRevisionRef: ref("execution-profile-1"),
    providerProfileRevisionRef: ref("provider-profile-1"),
    allowedModels: ["fixture-model"],
    allowedReasoningEfforts: ["minimal"],
    workerExecutionRuntimeRevisionRef: ref("worker-runtime-1"),
    attemptPolicyRevisionRefs: [ref("attempt-policy-1")],
    maximumConcurrentAttempts: 2,
    maximumInputTokensPerAttempt: 1000,
    maximumOutputTokensPerAttempt: 1000,
    maximumCostMicrounitsPerAttempt: null,
    executionPolicyDigest: digest("8"),
  };
  const attemptPolicy = {
    schema: "direct_semantic_attempt_policy@1",
    attemptPolicyRef: ref("attempt-policy-1"),
    retryableFailureClasses: ["runtime_failed_before_raw_capture"],
    maximumAttemptsPerReplicateSlot: 2,
    replicateCountPerCell: 2,
    selectionRule: "all_results_independent",
    timeoutMs: 5000,
    outputByteLimit: 100000,
    fixedBeforeExecution: true,
  };
  const capability = {
    schema: "direct_semantic_capability@1",
    capabilityId: ref("capability-1"),
    principalId: ref("principal-1"),
    operation: "submit_job",
    jobRefs: [],
    projectRegistryRevisionRefs: [ref("registry-1")],
    allowedTargetORevisions: [ref("o-revision-1")],
    targetSnapshotReceiptRefs: [ref("snapshot-1")],
    compilerPinRefs: [ref("compiler-pin-1")],
    kernelRevisionRefs: [ref("kernel-1")],
    executionProfileRevisionRefs: [ref("execution-profile-1")],
    providerProfileRevisionRefs: [ref("provider-profile-1")],
    allowedModels: ["fixture-model"],
    allowedReasoningEfforts: ["minimal"],
    attemptPolicyRevisionRefs: [ref("attempt-policy-1")],
    purposeScopes: ["semantic-advisory"],
    returnProjectionRefs: [ref("projection-advisory")],
    maximumJobs: 10,
    maximumCellsPerJob: 100,
    maximumReplicatesPerCell: 2,
    maximumInputTokensPerJob: 10000,
    maximumOutputTokensPerJob: 10000,
    maximumCostMicrounitsPerJob: null,
    issuedAt: t,
    nonce: ref("nonce-1"),
  };
  const principal = {
    schema: "direct_semantic_principal@1",
    principalId: ref("principal-1"),
    issuerRevision: ref("issuer-1"),
    principalClass: "local_user_experimental",
    subjectRef: ref("local-user-1000"),
    projectScopes: [ref("registry-1")],
    purposeScopes: ["semantic-advisory"],
  };
  const transport = {
    schema: "direct_semantic_transport_principal@1",
    transport: "unix_socket",
    hostUserId: "uid-1000",
    hostGroupId: "gid-1000",
    processId: 42,
    observedAt: t,
  };
  const request = {
    schema: "direct_semantic_job_request@1",
    requestId: ref("request-1"),
    requesterRef: ref("descriptive-requester"),
    projectRef: ref("project-1"),
    projectRegistryRevisionRef: ref("registry-1"),
    targetORevision: ref("o-revision-1"),
    targetSnapshotReceiptRef: ref("snapshot-1"),
    compilerPinRef: ref("compiler-pin-1"),
    requestedCompilationRef: ref("compilation-1"),
    selectionMode: "partial_selection",
    edgeOccurrenceRefs: [ref("edge-1"), ref("edge-2")],
    attemptPolicyRef: ref("attempt-policy-1"),
    executionProfileRevisionRef: ref("execution-profile-1"),
    deliveryProjectionRef: ref("projection-advisory"),
    idempotencyKey: ref("idempotency-1"),
  };
  const receipt = {
    schema: "direct_semantic_job_receipt@1",
    jobRef: ref("job-1"),
    requestDigest: digest("9"),
    admittedPrincipalRef: ref("principal-1"),
    admittedCapabilityRef: ref("capability-1"),
    projectRegistryRevisionRef: ref("registry-1"),
    targetSnapshotReceiptRef: ref("snapshot-1"),
    compilerPinRef: ref("compiler-pin-1"),
    acceptedAt: t,
    eventCursor: 0,
  };
  return { transport, principal, capability, compilerPin, projectRuntime, registry, snapshot, workerRuntime, profile, attemptPolicy, request, receipt };
}

function main() {
  // Canonical primitives are deterministic, reject non-JSON data, and freeze
  // nested contract objects rather than only their top-level shell.
  assert.equal(canonicalJson({ b: 2, a: [true, null] }), '{"a":[true,null],"b":2}');
  assert.equal(parseCanonicalJson('{"a":[true,null],"b":2}').b, 2);
  expectCode("DSS_CANONICAL_UNDEFINED", () => canonicalJson({ value: undefined }));
  expectCode("DSS_CANONICAL_NEGATIVE_ZERO", () => canonicalJson(-0));
  const frozen = deepFreeze({ nested: { value: 1 } });
  assert.equal(Object.isFrozen(frozen.nested), true);
  assert.ok(isDigest(digestFor("fixture", { b: 2, a: 1 })));

  const fixtures = positiveFixtures();
  const positiveNames = Object.keys(fixtures);
  const schemaNames = {
    transport: "TransportPrincipal",
    principal: "SemanticPrincipal",
    capability: "DirectSemanticCapability",
    compilerPin: "CompilerBuildPin",
    projectRuntime: "ProjectEvidenceRuntimeRevision",
    registry: "ProjectRegistryRevision",
    snapshot: "TargetSnapshotReceipt",
    workerRuntime: "WorkerExecutionRuntimeRevision",
    profile: "ExecutionProfileRevision",
    attemptPolicy: "AttemptPolicy",
    request: "SemanticJobRequest",
    receipt: "SemanticJobReceipt",
  };
  for (const name of positiveNames) {
    const schemaName = schemaNames[name];
    assert.ok(validateContract(schemaName, fixtures[name]), `${name} positive fixture should validate`);
    assertValidContract(schemaName, fixtures[name]);
  }

  // Closed-object and closed-enum rejection.
  expectInvalid("AttemptPolicy", { ...fixtures.attemptPolicy, unknown: true }, ERROR_CODES.UNKNOWN_FIELD);
  expectInvalid("AttemptPolicy", { ...fixtures.attemptPolicy, selectionRule: "pick_the_best" }, ERROR_CODES.ENUM);
  expectInvalid("AttemptPolicy", { ...fixtures.attemptPolicy, retryableFailureClasses: ["runtime_failed_before_raw_capture", "runtime_failed_before_raw_capture"] }, ERROR_CODES.DUPLICATE_SET_ENTRY);

  // Canonical ids/digests and immutable revision selectors.
  expectInvalid("SemanticJobRequest", { ...fixtures.request, requestId: " request-1" }, ERROR_CODES.ID);
  expectInvalid("SemanticJobRequest", { ...fixtures.request, targetORevision: "latest" }, ERROR_CODES.MUTABLE_SELECTOR);
  expectInvalid("CompilerBuildPin", { ...fixtures.compilerPin, sourceArtifactDigest: "sha256:ABC" }, ERROR_CODES.DIGEST);
  expectInvalid("TargetSnapshotReceipt", { ...fixtures.snapshot, snapshotDigest: "sha256:123" }, ERROR_CODES.DIGEST);

  // Numeric resource bounds are closed before any scheduler can consume them.
  expectInvalid("DirectSemanticCapability", { ...fixtures.capability, maximumJobs: -1 }, ERROR_CODES.MINIMUM);
  expectInvalid("DirectSemanticCapability", { ...fixtures.capability, maximumInputTokensPerJob: 1.5 }, ERROR_CODES.TYPE);
  expectInvalid("AttemptPolicy", { ...fixtures.attemptPolicy, maximumAttemptsPerReplicateSlot: 101 }, ERROR_CODES.MAXIMUM);
  expectInvalid("AttemptPolicy", { ...fixtures.attemptPolicy, timeoutMs: 0 }, ERROR_CODES.MINIMUM);
  expectInvalid("SemanticJobRequest", { ...fixtures.request, edgeOccurrenceRefs: [] }, ERROR_CODES.MIN_ITEMS);

  // Every published schema is deeply frozen; callers cannot mutate the ABI at
  // runtime or silently widen an enum in one subsystem.
  for (const schema of Object.values(CONTRACT_SCHEMAS)) assert.equal(Object.isFrozen(schema), true);

  console.log(JSON.stringify({
    ok: true,
    schemaCount: Object.keys(CONTRACT_SCHEMAS).length,
    positiveFixtures: positiveNames.length,
    adversarialCases: 13,
    canonicalDigest: digestFor("regression", { schemaCount: Object.keys(CONTRACT_SCHEMAS).length }),
  }, null, 2));
}

main();
