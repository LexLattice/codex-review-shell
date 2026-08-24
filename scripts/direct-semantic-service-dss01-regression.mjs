#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDirectSemanticServiceFoundation,
  KIND,
  COMPILER_BUILD_PIN_SCHEMA,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  PROJECT_REGISTRY_REVISION_SCHEMA,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  EXECUTION_PROFILE_REVISION_SCHEMA,
  ATTEMPT_POLICY_SCHEMA,
} = require("../src/main/direct/semantic-service");

const NOW = "2026-08-24T14:00:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function expectCode(code, action) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

const foundation = createDirectSemanticServiceFoundation({
  now: NOW,
  principalAuthorityId: "dss01-principal-authority",
  capabilityAuthorityId: "dss01-capability-authority",
  registryAuthorityRef: "dss01-registry-authority",
  authorizationAuthorityId: "dss01-authorization-authority",
});
const {
  principalAuthority,
  capabilityAuthority,
  registryAuthority: registry,
  authorizationAuthority: authorization,
} = foundation;

const registryTransport = principalAuthority.deriveTransportPrincipal({
  transport: "internal", hostUserId: "dss01-registry-service", observedAt: NOW,
});
const registryPrincipal = principalAuthority.issueSemanticPrincipal({
  principalId: "dss01-registry-operator", issuerRevision: "dss01-registry-issuer-r1",
  principalClass: "operator", subjectRef: "dss01-registry-service", projectScopes: [],
  purposeScopes: ["semantic_registry_admit"], transportPrincipal: registryTransport,
});
const registryCapability = capabilityAuthority.issue({
  capabilityId: "dss01-registry-admission", principal: registryPrincipal, operation: "administer_service",
  jobRefs: [], projectRegistryRevisionRefs: [], allowedTargetORevisions: [], targetSnapshotReceiptRefs: [],
  compilerPinRefs: [], kernelRevisionRefs: [], executionProfileRevisionRefs: [], providerProfileRevisionRefs: [],
  allowedModels: [], allowedReasoningEfforts: [], attemptPolicyRevisionRefs: [],
  purposeScopes: ["semantic_registry_admit"], returnProjectionRefs: [], maximumJobs: 0,
  maximumCellsPerJob: 0, maximumReplicatesPerCell: 0, maximumInputTokensPerJob: 0,
  maximumOutputTokensPerJob: 0, maximumCostMicrounitsPerJob: null, issuedAt: NOW,
  nonce: "dss01-registry-admission-nonce",
});
const admissionAuthority = { capability: registryCapability, semanticPrincipal: registryPrincipal };

const projectRuntimeInput = {
  schema: PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  projectEvidenceRuntimeRevisionRef: "project-runtime-r1",
  projectRef: "project-arcagi3",
  substrateBinding: "wsl",
  operatingSystemRevision: "linux-6.8-r1",
  interpreterExecutableDigest: DIGEST_A,
  toolchainArtifactDigests: [DIGEST_A],
  installedDependencyEnvironmentDigest: DIGEST_A,
  deterministicCheckRegistryDigest: DIGEST_A,
  admittedEnvironmentInputDigest: DIGEST_A,
  runtimePolicyDigest: DIGEST_A,
};
const projectRuntime = registry.admitProjectEvidenceRuntimeRevision(
  projectRuntimeInput,
  { ...projectRuntimeInput },
  admissionAuthority,
);
const project = registry.admitProjectRegistryRevision({
  schema: PROJECT_REGISTRY_REVISION_SCHEMA,
  registryRevisionRef: "project-registry-r1",
  projectRef: "project-arcagi3",
  substrateBinding: "wsl",
  repositoryIdentity: "arcagi3-repository",
  privateRepositoryLocatorRef: "private-locator-r1",
  targetRevisionPolicy: {
    kind: "exact_git_commit_allowlist",
    allowedCommits: ["git-commit-r1"],
    cleanTreeRequired: true,
  },
  projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
  evidenceCartographyRevisionRef: "cartography-r1",
  authorityPolicyRef: "authority-policy-r1",
  admittedByCapabilityRef: "dss01-registry-admission",
  admittedAt: NOW,
}, admissionAuthority);
const targetInput = {
  schema: TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  targetSnapshotReceiptRef: "target-snapshot-r1",
  projectRegistryRevisionRef: project.registryRevisionRef,
  repositoryIdentity: project.repositoryIdentity,
  targetORevision: "target-o-r1",
  gitCommit: "git-commit-r1",
  gitTree: "git-tree-r1",
  submoduleClosureDigest: DIGEST_A,
  lfsObjectClosureDigest: DIGEST_A,
  admittedGeneratedInputDigest: DIGEST_A,
  evidenceCartographyRevisionRef: project.evidenceCartographyRevisionRef,
  projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
  projectRuntimeInputDigest: DIGEST_A,
  sourceStatusDigest: DIGEST_A,
  snapshotArtifactRef: "snapshot-artifact-r1",
  snapshotMaterializationMode: "isolated_read_only_snapshot",
  preObservationReceiptRef: "pre-observation-r1",
  postObservationReceiptRef: "post-observation-r1",
  snapshotDigest: DIGEST_A,
  capturedAt: NOW,
};
const targetObservation = {
  ...targetInput,
  preObservation: { receiptRef: targetInput.preObservationReceiptRef, observationDigest: DIGEST_A },
  postObservation: { receiptRef: targetInput.postObservationReceiptRef, observationDigest: DIGEST_A },
  immutableArtifact: {
    artifactRef: targetInput.snapshotArtifactRef,
    digest: targetInput.snapshotDigest,
    materializationMode: targetInput.snapshotMaterializationMode,
  },
};
const target = registry.admitTargetSnapshotReceipt(targetInput, targetObservation, admissionAuthority);
const compilerInput = {
  schema: COMPILER_BUILD_PIN_SCHEMA,
  compilerPinRef: "compiler-pin-r1",
  repositoryIdentity: "semantic-compiler-repository",
  gitCommit: "compiler-commit-r1",
  gitTree: "compiler-tree-r1",
  sourceArtifactDigest: DIGEST_A,
  executableArtifactDigest: DIGEST_A,
  interpreterToolchainDigest: DIGEST_A,
  dependencyLockDigest: DIGEST_A,
  installedDependencyEnvironmentDigest: DIGEST_A,
  invocationContractDigest: DIGEST_A,
  canonicalSchemaDigests: [DIGEST_A],
  patternLibraryDigests: [DIGEST_A],
  evidenceCatalogDigests: [DIGEST_A],
  compilerGateReceiptDigest: DIGEST_A,
  adapterRevision: "compiler-adapter-r1",
  admittedAt: NOW,
};
const compiler = registry.admitCompilerBuildPin(compilerInput, { ...compilerInput }, admissionAuthority);
const workerRuntimeInput = {
  schema: WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  workerExecutionRuntimeRevisionRef: "worker-runtime-r1",
  substrateBinding: "remote_api",
  backendAdapterRevision: "fake-backend-r1",
  processLauncherDigest: DIGEST_A,
  sandboxPolicyDigest: DIGEST_A,
  scratchPolicyDigest: DIGEST_A,
  environmentAllowlistDigest: DIGEST_A,
  credentialExclusionPolicyDigest: DIGEST_A,
  outputCapturePolicyDigest: DIGEST_A,
  runtimeArtifactDigest: DIGEST_A,
};
const workerRuntime = registry.admitWorkerExecutionRuntimeRevision(workerRuntimeInput, { ...workerRuntimeInput }, admissionAuthority);
const attemptPolicy = registry.admitAttemptPolicy({
  schema: ATTEMPT_POLICY_SCHEMA,
  attemptPolicyRef: "attempt-policy-r1",
  retryableFailureClasses: ["runtime_failed_before_raw_capture"],
  maximumAttemptsPerReplicateSlot: 2,
  replicateCountPerCell: 2,
  selectionRule: "all_results_independent",
  timeoutMs: 30_000,
  outputByteLimit: 10_000,
  fixedBeforeExecution: true,
}, admissionAuthority);
const execution = registry.admitExecutionProfileRevision({
  schema: EXECUTION_PROFILE_REVISION_SCHEMA,
  executionProfileRevisionRef: "execution-profile-r1",
  providerProfileRevisionRef: "provider-profile-r1",
  allowedModels: ["deterministic-fake"],
  allowedReasoningEfforts: ["medium"],
  workerExecutionRuntimeRevisionRef: workerRuntime.workerExecutionRuntimeRevisionRef,
  attemptPolicyRevisionRefs: [attemptPolicy.attemptPolicyRef],
  maximumConcurrentAttempts: 2,
  maximumInputTokensPerAttempt: 2_000,
  maximumOutputTokensPerAttempt: 1_000,
  maximumCostMicrounitsPerAttempt: 100,
  executionPolicyDigest: DIGEST_A,
}, admissionAuthority);

const kernel = authorization.registerKernelRevision({
  schema: "semantic_kernel_revision@1",
  kernelRef: "kernel-r1",
  semanticIsaRevision: "semantic-isa-r1",
  edgeFamily: "contract-conformance",
  transformationLawDigest: DIGEST_A,
  evidenceSemanticsDigest: DIGEST_A,
  remandLawDigest: DIGEST_A,
  authorityPosture: "advisory_only",
  outputSchemaDigest: DIGEST_A,
  ratificationEvidenceRefs: ["ratification-r1"],
});
const provider = authorization.registerProviderProfileRevision({
  schema: "direct_semantic_provider_profile_revision@1",
  providerProfileRevisionRef: "provider-profile-r1",
  provider: "deterministic-fake",
  admittedAt: NOW,
});
const projection = authorization.registerProjectionRevision({
  schema: "direct_semantic_return_projection_revision@1",
  projectionRef: "projection-r1",
  returnProjectionRef: "projection-r1",
  projectionKind: "advisory-summary",
  admittedAt: NOW,
});

// Registry-owned identities cannot be introduced through the authorization
// surface, so a local attacker record cannot shadow the immutable registry.
assert.equal(authorization.registerCompilerPin, undefined);
assert.equal(authorization.registerRecord, undefined);

// Verification-required pins never become execution-eligible from a bare
// declaration, and registry admission requires custody of a real opaque
// administer_service capability rather than a matching reference string.
expectCode("direct_semantic_registry_verification_observation_required", () => registry.admitCompilerBuildPin({
  ...compilerInput,
  compilerPinRef: "compiler-pin-unverified-r2",
}, undefined, admissionAuthority));
expectCode("direct_semantic_capability_untrusted", () => registry.admitProjectRegistryRevision({
  ...JSON.parse(JSON.stringify(project)),
  registryRevisionRef: "project-registry-forged-authority-r2",
}, {
  capability: JSON.parse(JSON.stringify(registryCapability)),
  semanticPrincipal: registryPrincipal,
}));
expectCode("direct_semantic_target_snapshot_observation_missing", () => registry.admitTargetSnapshotReceipt({
  ...targetInput,
  targetSnapshotReceiptRef: "target-snapshot-no-capture-r2",
}, { ...targetInput, targetSnapshotReceiptRef: "target-snapshot-no-capture-r2" }, admissionAuthority));

const transport = principalAuthority.deriveTransportPrincipal({
  transport: "unix_socket",
  peerCredentials: { uid: 1000, gid: 1000, pid: 4100 },
  observedAt: NOW,
});
const principal = principalAuthority.issueSemanticPrincipal({
  principalId: "principal-workthread-r1",
  issuerRevision: "principal-issuer-r1",
  principalClass: "direct_workthread",
  subjectRef: "workthread-r1",
  projectScopes: [project.projectRef],
  purposeScopes: ["semantic_submit"],
  transportPrincipal: transport,
});
const capability = capabilityAuthority.issue({
  capabilityId: "submit-capability-r1",
  principal,
  operation: "submit_job",
  jobRefs: [],
  projectRegistryRevisionRefs: [project.registryRevisionRef],
  allowedTargetORevisions: [target.targetORevision],
  targetSnapshotReceiptRefs: [target.targetSnapshotReceiptRef],
  compilerPinRefs: [compiler.compilerPinRef],
  kernelRevisionRefs: [kernel.kernelRef],
  executionProfileRevisionRefs: [execution.executionProfileRevisionRef],
  providerProfileRevisionRefs: [provider.providerProfileRevisionRef],
  allowedModels: ["deterministic-fake"],
  allowedReasoningEfforts: ["medium"],
  attemptPolicyRevisionRefs: [attemptPolicy.attemptPolicyRef],
  purposeScopes: ["semantic_submit"],
  returnProjectionRefs: [projection.returnProjectionRef],
  maximumJobs: 1,
  maximumCellsPerJob: 2,
  maximumReplicatesPerCell: 2,
  maximumInputTokensPerJob: 4_000,
  maximumOutputTokensPerJob: 2_000,
  maximumCostMicrounitsPerJob: 200,
  issuedAt: NOW,
  nonce: "submit-capability-nonce-r1",
});
const request = {
  schema: "direct_semantic_job_request@1",
  requestId: "submit-request-r1",
  requesterRef: "descriptive-only-requester",
  projectRef: project.projectRef,
  projectRegistryRevisionRef: project.registryRevisionRef,
  targetORevision: target.targetORevision,
  targetSnapshotReceiptRef: target.targetSnapshotReceiptRef,
  compilerPinRef: compiler.compilerPinRef,
  requestedCompilationRef: "compilation-r1",
  selectionMode: "partial_selection",
  edgeOccurrenceRefs: ["edge-occurrence-r1", "edge-occurrence-r2"],
  attemptPolicyRef: attemptPolicy.attemptPolicyRef,
  executionProfileRevisionRef: execution.executionProfileRevisionRef,
  deliveryProjectionRef: projection.returnProjectionRef,
  idempotencyKey: "submit-idempotency-r1",
};
const resourceEstimate = {
  cells: 2,
  replicatesPerCell: 2,
  inputTokens: 2_000,
  outputTokens: 500,
  costMicrounits: 100,
  model: "deterministic-fake",
  reasoningEffort: "medium",
};

// Exhaustive compilation has no exact compiler-produced cell plan in DSS-0.1,
// so it is rejected before authority or quota can be consumed. In supported
// partial selection, the estimate must exactly match both cells and replicates.
const quotaBeforeExhaustive = capabilityAuthority.quotaSnapshot(capability);
expectCode("direct_semantic_exhaustive_submission_not_implemented", () => authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability,
  request: {
    ...request,
    requestId: "submit-request-exhaustive-r1",
    selectionMode: "exhaustive_compilation",
    idempotencyKey: "submit-exhaustive-r1",
  },
  resourceEstimate: {
    ...resourceEstimate,
    cells: 0,
    replicatesPerCell: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicrounits: 0,
  },
}));
assert.deepEqual(capabilityAuthority.quotaSnapshot(capability), quotaBeforeExhaustive);
expectCode("direct_semantic_resource_estimate_mismatch", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability,
  request: { ...request, requestId: "submit-request-undercounted-r1", idempotencyKey: "submit-undercounted-r1" },
  resourceEstimate: { ...resourceEstimate, cells: 1 },
}));
expectCode("direct_semantic_replicates_estimate_mismatch", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability,
  request: { ...request, requestId: "submit-request-underreplicated-r1", idempotencyKey: "submit-underreplicated-r1" },
  resourceEstimate: { ...resourceEstimate, replicatesPerCell: 1 },
}));

const receipt = authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability,
  request,
  resourceEstimate,
});
assert.equal(receipt.decision, "authorized");
assert.equal(receipt.exactRevisionRefs.projectRegistryRevisionRef, project.registryRevisionRef);
assert.deepEqual(receipt.exactRevisionRefs.kernelRevisionRefs, [kernel.kernelRef]);
assert.equal(capabilityAuthority.quotaSnapshot(capability).usedJobs, 1);
assert.equal(capabilityAuthority.quotaSnapshot(capability).usedReplicates, 4);
assert.equal(registry.resolve(KIND.executionProfileRevision, execution.executionProfileRevisionRef), execution);
const registryBinding = registry.bindJob({
  jobRef: "job-r1",
  compilerPinRef: compiler.compilerPinRef,
  projectRegistryRevisionRef: project.registryRevisionRef,
  targetSnapshotReceiptRef: target.targetSnapshotReceiptRef,
  executionProfileRevisionRef: execution.executionProfileRevisionRef,
});
const { verificationReceiptDigests, ...registryIdentityBinding } = registryBinding;
assert.deepEqual(registryIdentityBinding, {
  schema: "direct_semantic_registry_job_binding@1",
  jobRef: "job-r1",
  compilerPinRef: compiler.compilerPinRef,
  projectRegistryRevisionRef: project.registryRevisionRef,
  targetSnapshotReceiptRef: target.targetSnapshotReceiptRef,
  projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
  workerExecutionRuntimeRevisionRef: workerRuntime.workerExecutionRuntimeRevisionRef,
  executionProfileRevisionRef: execution.executionProfileRevisionRef,
  attemptPolicyRef: attemptPolicy.attemptPolicyRef,
});
assert.deepEqual(Object.keys(verificationReceiptDigests).sort(), [
  "compilerBuildPin",
  "projectEvidenceRuntimeRevision",
  "targetSnapshotReceipt",
  "workerExecutionRuntimeRevision",
]);
for (const digest of Object.values(verificationReceiptDigests)) assert.match(digest, /^sha256:[a-f0-9]{64}$/);

// Idempotent replay returns the same authority-owned receipt without a second
// reservation. A changed request under the same key cannot launder a retry.
assert.equal(authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability,
  request,
  resourceEstimate,
}), receipt);
assert.equal(capabilityAuthority.quotaSnapshot(capability).usedJobs, 1);
expectCode("direct_semantic_idempotency_conflict", () => authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability,
  request: { ...request, edgeOccurrenceRefs: ["edge-occurrence-r1"] },
  resourceEstimate: { ...resourceEstimate, cells: 1 },
}));

// JSON-shaped copies preserve diagnostics but carry no authority.
expectCode("direct_semantic_principal_untrusted", () => authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: JSON.parse(JSON.stringify(principal)),
  capability,
  request: { ...request, idempotencyKey: "copied-principal-r1" },
  resourceEstimate,
}));
expectCode("direct_semantic_capability_untrusted", () => authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability: JSON.parse(JSON.stringify(capability)),
  request: { ...request, idempotencyKey: "copied-capability-r1" },
  resourceEstimate,
}));

// The execution profile is a provider/runtime policy object. Smuggling a
// kernel selector into it is rejected by its frozen schema.
expectCode("direct_semantic_execution_profile_shape_invalid", () => registry.admitExecutionProfileRevision({
  ...JSON.parse(JSON.stringify(execution)),
  executionProfileRevisionRef: "execution-profile-illegal-r2",
  kernelRevisionRefs: [kernel.kernelRef],
}, admissionAuthority));

// Aggregate numeric bounds must remain exactly accountable in JavaScript's
// safe-integer domain; individually valid but unsafe products are rejected.
const unsafeCapabilityInput = JSON.parse(JSON.stringify(capability));
delete unsafeCapabilityInput.schema;
expectCode("direct_semantic_capability_aggregate_bound_unsafe", () => capabilityAuthority.issue({
  ...unsafeCapabilityInput,
  capabilityId: "submit-capability-unsafe",
  principal,
  maximumJobs: Number.MAX_SAFE_INTEGER,
  maximumCellsPerJob: 2,
  nonce: "submit-capability-unsafe-nonce",
}));

// Later immutable revisions do not widen an already-issued capability.
const runtime2Input = {
  ...JSON.parse(JSON.stringify(projectRuntime)),
  projectEvidenceRuntimeRevisionRef: "project-runtime-r2",
  runtimePolicyDigest: DIGEST_B,
};
const runtime2 = registry.admitProjectEvidenceRuntimeRevision(runtime2Input, { ...runtime2Input }, admissionAuthority);
const project2 = registry.admitProjectRegistryRevision({
  ...JSON.parse(JSON.stringify(project)),
  registryRevisionRef: "project-registry-r2",
  priorRevisionRef: project.registryRevisionRef,
  projectEvidenceRuntimeRevisionRef: runtime2.projectEvidenceRuntimeRevisionRef,
  targetRevisionPolicy: {
    kind: "exact_git_commit_allowlist",
    allowedCommits: ["git-commit-r2"],
    cleanTreeRequired: true,
  },
  admittedAt: "2026-08-24T14:01:00.000Z",
}, admissionAuthority);
expectCode("direct_semantic_scope_denied", () => authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability,
  request: {
    ...request,
    requestId: "submit-request-r2",
    projectRegistryRevisionRef: project2.registryRevisionRef,
    idempotencyKey: "later-revision-r2",
  },
  resourceEstimate,
}));

console.log(JSON.stringify({
  schema: "direct_semantic_service_dss01_regression_report@1",
  status: "passed",
  composition: "contracts+principals+capabilities+registry+authorization",
  registrySequence: registry.snapshot().sequence,
  authorizedRevisionCount: Object.keys(receipt.exactRevisionRefs).length,
  idempotentBudgetUse: true,
  exactReplicateSlotAccounting: true,
  executionKernelSeparation: true,
  laterRevisionNoninheritance: true,
  copiedAuthorityRejected: true,
  registryShadowingRejected: true,
  unverifiedPinsRejected: true,
  exhaustiveUnderreservationRejected: true,
  targetCapturePairRequired: true,
  opaqueRegistryAdmissionRequired: true,
}, null, 2));
