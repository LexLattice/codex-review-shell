#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDirectSemanticServiceFoundation,
  COMPILER_BUILD_PIN_SCHEMA,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  PROJECT_REGISTRY_REVISION_SCHEMA,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  EXECUTION_PROFILE_REVISION_SCHEMA,
  ATTEMPT_POLICY_SCHEMA,
  SOURCE_OBSERVATION_RECEIPT_SCHEMA,
  sourceObservationBodyFromTargetReceipt,
  sourceObservationDigest,
} = require("../src/main/direct/semantic-service");

const NOW = "2026-08-24T10:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;
const ref = (prefix, value) => `${prefix}-${value}`;

function expectCode(code, action) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

const {
  principalAuthority,
  capabilityAuthority,
  registryAuthority: registry,
  authorizationAuthority: authorization,
} = createDirectSemanticServiceFoundation({
  now: NOW,
  principalAuthorityId: "principal-authority-1",
  capabilityAuthorityId: "capability-authority-1",
  registryAuthorityRef: "registry-authority-1",
  authorizationAuthorityId: "authorization-authority-1",
});

const registryTransport = principalAuthority.deriveTransportPrincipal({
  transport: "internal", hostUserId: "registry-service-1", observedAt: NOW,
});
const registryPrincipal = principalAuthority.issueSemanticPrincipal({
  principalId: "registry-operator-1", issuerRevision: "registry-issuer-1",
  principalClass: "operator", subjectRef: "registry-service-1", projectScopes: [],
  purposeScopes: ["semantic_registry_admit"], transportPrincipal: registryTransport,
});
const registryCapability = capabilityAuthority.issue({
  capabilityId: "admin-capability-1", principal: registryPrincipal, operation: "administer_service",
  jobRefs: [], projectRegistryRevisionRefs: [], allowedTargetORevisions: [], targetSnapshotReceiptRefs: [],
  compilerPinRefs: [], kernelRevisionRefs: [], executionProfileRevisionRefs: [], providerProfileRevisionRefs: [],
  allowedModels: [], allowedReasoningEfforts: [], attemptPolicyRevisionRefs: [],
  purposeScopes: ["semantic_registry_admit"], returnProjectionRefs: [], maximumJobs: 0,
  maximumCellsPerJob: 0, maximumReplicatesPerCell: 0, maximumInputTokensPerJob: 0,
  maximumOutputTokensPerJob: 0, maximumCostMicrounitsPerJob: null, issuedAt: NOW,
  nonce: "admin-capability-nonce-1",
});
const admissionAuthority = { capability: registryCapability, semanticPrincipal: registryPrincipal };

const transport = principalAuthority.deriveTransportPrincipal({
  transport: "unix_socket",
  peerCredentials: { uid: 1000, gid: 1000, pid: 4201 },
  observedAt: NOW,
});
const principal = principalAuthority.issueSemanticPrincipal({
  principalId: "principal-project-1",
  issuerRevision: "issuer-revision-1",
  principalClass: "local_user_experimental",
  subjectRef: "workthread-1",
  projectScopes: ["project-1"],
  purposeScopes: ["semantic_submit", "semantic_read"],
  transportPrincipal: transport,
});

const projectRuntimeInput = {
  schema: PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  projectEvidenceRuntimeRevisionRef: "project-runtime-1",
  projectRef: "project-1",
  substrateBinding: "wsl",
  operatingSystemRevision: "linux-1",
  interpreterExecutableDigest: DIGEST,
  toolchainArtifactDigests: [DIGEST],
  installedDependencyEnvironmentDigest: DIGEST,
  deterministicCheckRegistryDigest: DIGEST,
  admittedEnvironmentInputDigest: DIGEST,
  runtimePolicyDigest: DIGEST,
};
const projectRuntime = registry.admitProjectEvidenceRuntimeRevision(
  projectRuntimeInput,
  { ...projectRuntimeInput },
  admissionAuthority,
);
const project = registry.admitProjectRegistryRevision({
  schema: PROJECT_REGISTRY_REVISION_SCHEMA,
  registryRevisionRef: "registry-revision-1",
  projectRef: "project-1",
  substrateBinding: "wsl",
  repositoryIdentity: "repo-1",
  privateRepositoryLocatorRef: "private-locator-1",
  targetRevisionPolicy: { kind: "exact_git_commit_allowlist", allowedCommits: ["target-o-1"], cleanTreeRequired: true },
  projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
  evidenceCartographyRevisionRef: "cartography-1",
  authorityPolicyRef: "authority-policy-1",
  admittedByCapabilityRef: registryCapability.capabilityId,
  admittedAt: NOW,
}, admissionAuthority);
const snapshotInput = {
  schema: TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  targetSnapshotReceiptRef: "snapshot-1",
  projectRegistryRevisionRef: project.registryRevisionRef,
  repositoryIdentity: "repo-1",
  targetORevision: "target-o-1",
  gitCommit: "target-o-1",
  gitTree: "tree-1",
  submoduleClosureDigest: DIGEST,
  lfsObjectClosureDigest: DIGEST,
  admittedGeneratedInputDigest: DIGEST,
  evidenceCartographyRevisionRef: project.evidenceCartographyRevisionRef,
  projectEvidenceRuntimeRevisionRef: projectRuntime.projectEvidenceRuntimeRevisionRef,
  projectRuntimeInputDigest: DIGEST,
  sourceStatusDigest: DIGEST,
  snapshotArtifactRef: "snapshot-artifact-1",
  snapshotMaterializationMode: "isolated_read_only_snapshot",
  preObservationReceiptRef: "snapshot-pre-1",
  postObservationReceiptRef: "snapshot-post-1",
  snapshotDigest: DIGEST,
  capturedAt: NOW,
};
const snapshotSourceObservation = sourceObservationBodyFromTargetReceipt(snapshotInput);
const snapshotSourceObservationDigest = sourceObservationDigest(snapshotSourceObservation);
const snapshot = registry.admitTargetSnapshotReceipt(snapshotInput, {
  ...snapshotInput,
  preObservation: {
    schema: SOURCE_OBSERVATION_RECEIPT_SCHEMA,
    receiptRef: snapshotInput.preObservationReceiptRef,
    targetSnapshotReceiptRef: snapshotInput.targetSnapshotReceiptRef,
    phase: "pre_capture",
    observedAt: "2026-08-24T09:59:59.000Z",
    sourceObservation: snapshotSourceObservation,
    sourceObservationDigest: snapshotSourceObservationDigest,
  },
  postObservation: {
    schema: SOURCE_OBSERVATION_RECEIPT_SCHEMA,
    receiptRef: snapshotInput.postObservationReceiptRef,
    targetSnapshotReceiptRef: snapshotInput.targetSnapshotReceiptRef,
    phase: "post_capture",
    observedAt: NOW,
    sourceObservation: snapshotSourceObservation,
    sourceObservationDigest: snapshotSourceObservationDigest,
  },
  immutableArtifact: {
    artifactRef: snapshotInput.snapshotArtifactRef,
    digest: snapshotInput.snapshotDigest,
    materializationMode: snapshotInput.snapshotMaterializationMode,
  },
}, admissionAuthority);
const compilerInput = {
  schema: COMPILER_BUILD_PIN_SCHEMA,
  compilerPinRef: "compiler-pin-1",
  repositoryIdentity: "semantic-compiler",
  gitCommit: "compiler-commit-1",
  gitTree: "compiler-tree-1",
  sourceArtifactDigest: DIGEST,
  executableArtifactDigest: DIGEST,
  interpreterToolchainDigest: DIGEST,
  dependencyLockDigest: DIGEST,
  installedDependencyEnvironmentDigest: DIGEST,
  invocationContractDigest: DIGEST,
  canonicalSchemaDigests: [DIGEST],
  patternLibraryDigests: [DIGEST],
  evidenceCatalogDigests: [DIGEST],
  compilerGateReceiptDigest: DIGEST,
  adapterRevision: "adapter-1",
  admittedAt: NOW,
};
const compiler = registry.admitCompilerBuildPin(compilerInput, { ...compilerInput }, admissionAuthority);
const kernel = authorization.registerKernelRevision({
  schema: "semantic_kernel_revision@1",
  kernelRef: "kernel-1",
  semanticIsaRevision: "isa-1",
  edgeFamily: "contract-conformance",
  transformationLawDigest: DIGEST,
  evidenceSemanticsDigest: DIGEST,
  remandLawDigest: DIGEST,
  authorityPosture: "advisory_only",
  outputSchemaDigest: DIGEST,
  ratificationEvidenceRefs: ["ratification-1"],
});
const provider = authorization.registerProviderProfileRevision({
  schema: "direct_semantic_provider_profile_revision@1",
  providerProfileRevisionRef: "provider-profile-1",
  provider: "fake",
  admittedAt: NOW,
});
const attemptPolicy = registry.admitAttemptPolicy({
  schema: ATTEMPT_POLICY_SCHEMA,
  attemptPolicyRef: "attempt-policy-1",
  retryableFailureClasses: ["transport_unavailable_before_dispatch"],
  maximumAttemptsPerReplicateSlot: 2,
  replicateCountPerCell: 1,
  selectionRule: "all_results_independent",
  timeoutMs: 1000,
  outputByteLimit: 10000,
  fixedBeforeExecution: true,
}, admissionAuthority);
const workerRuntimeInput = {
  schema: WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  workerExecutionRuntimeRevisionRef: "worker-runtime-1",
  substrateBinding: "remote_api",
  backendAdapterRevision: "fake-backend-1",
  processLauncherDigest: DIGEST,
  sandboxPolicyDigest: DIGEST,
  scratchPolicyDigest: DIGEST,
  environmentAllowlistDigest: DIGEST,
  credentialExclusionPolicyDigest: DIGEST,
  outputCapturePolicyDigest: DIGEST,
  runtimeArtifactDigest: DIGEST,
};
const workerRuntime = registry.admitWorkerExecutionRuntimeRevision(
  workerRuntimeInput,
  { ...workerRuntimeInput },
  admissionAuthority,
);
const execution = registry.admitExecutionProfileRevision({
  schema: EXECUTION_PROFILE_REVISION_SCHEMA,
  executionProfileRevisionRef: "execution-profile-1",
  providerProfileRevisionRef: provider.providerProfileRevisionRef,
  allowedModels: ["fake-model"],
  allowedReasoningEfforts: ["minimal"],
  workerExecutionRuntimeRevisionRef: workerRuntime.workerExecutionRuntimeRevisionRef,
  attemptPolicyRevisionRefs: [attemptPolicy.attemptPolicyRef],
  maximumConcurrentAttempts: 1,
  maximumInputTokensPerAttempt: 1000,
  maximumOutputTokensPerAttempt: 1000,
  maximumCostMicrounitsPerAttempt: 100,
  executionPolicyDigest: DIGEST,
}, admissionAuthority);
const projection = authorization.registerProjectionRevision({
  schema: "direct_semantic_return_projection_revision@1",
  projectionRef: "projection-1",
  returnProjectionRef: "projection-1",
  projectionKind: "advisory-summary",
  admittedAt: NOW,
});

function submitCapability(overrides = {}) {
  return capabilityAuthority.issue({
    capabilityId: overrides.capabilityId || `submit-cap-${Math.random().toString(36).slice(2)}`,
    principal,
    operation: "submit_job",
    jobRefs: [],
    projectRegistryRevisionRefs: [project.registryRevisionRef],
    allowedTargetORevisions: [snapshot.targetORevision],
    targetSnapshotReceiptRefs: [snapshot.targetSnapshotReceiptRef],
    compilerPinRefs: [compiler.compilerPinRef],
    kernelRevisionRefs: [kernel.kernelRef],
    executionProfileRevisionRefs: [execution.executionProfileRevisionRef],
    providerProfileRevisionRefs: [provider.providerProfileRevisionRef],
    allowedModels: ["fake-model"],
    allowedReasoningEfforts: ["minimal"],
    attemptPolicyRevisionRefs: [attemptPolicy.attemptPolicyRef],
    purposeScopes: ["semantic_submit"],
    returnProjectionRefs: [projection.returnProjectionRef],
    maximumJobs: overrides.maximumJobs ?? 2,
    maximumCellsPerJob: overrides.maximumCellsPerJob ?? 2,
    maximumReplicatesPerCell: overrides.maximumReplicatesPerCell ?? 1,
    maximumInputTokensPerJob: overrides.maximumInputTokensPerJob ?? 4_000,
    maximumOutputTokensPerJob: overrides.maximumOutputTokensPerJob ?? 4_000,
    maximumCostMicrounitsPerJob: overrides.maximumCostMicrounitsPerJob ?? 400,
    issuedAt: overrides.issuedAt || NOW,
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
    nonce: overrides.nonce || `nonce-${Math.random().toString(36).slice(2)}`,
  });
}

function submissionEstimate(cells = 1, overrides = {}) {
  return {
    cells,
    replicatesPerCell: 1,
    inputTokens: cells * 2_000,
    outputTokens: cells * 2_000,
    costMicrounits: cells * 200,
    model: "fake-model",
    reasoningEffort: "minimal",
    ...overrides,
  };
}

function submitRequest(idempotencyKey = "submit-1", overrides = {}) {
  return {
    schema: "direct_semantic_job_request@1",
    requestId: `request-${idempotencyKey}`,
    ...(overrides.requesterRef === undefined ? {} : { requesterRef: overrides.requesterRef }),
    projectRef: "project-1",
    projectRegistryRevisionRef: project.registryRevisionRef,
    targetORevision: overrides.targetORevision || snapshot.targetORevision,
    targetSnapshotReceiptRef: overrides.targetSnapshotReceiptRef || snapshot.targetSnapshotReceiptRef,
    compilerPinRef: compiler.compilerPinRef,
    requestedCompilationRef: "compilation-1",
    selectionMode: "partial_selection",
    edgeOccurrenceRefs: overrides.edgeOccurrenceRefs || ["edge-1"],
    attemptPolicyRef: attemptPolicy.attemptPolicyRef,
    executionProfileRevisionRef: execution.executionProfileRevisionRef,
    deliveryProjectionRef: projection.returnProjectionRef,
    idempotencyKey,
  };
}

const submit = submitCapability({ capabilityId: "submit-cap-1" });
const accepted = authorization.authorize({
  operation: "submit_job",
  transportPrincipal: transport,
  semanticPrincipal: principal,
  capability: submit,
  request: submitRequest("submit-1"),
  resourceEstimate: submissionEstimate(),
});
assert.equal(accepted.decision, "authorized");
assert.equal(authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("submit-1"), resourceEstimate: submissionEstimate(),
}), accepted, "same idempotency key/request returns original receipt");
expectCode("direct_semantic_resource_estimate_mismatch", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("zero-variable-budget"),
  resourceEstimate: submissionEstimate(1, { inputTokens: 0, outputTokens: 0, costMicrounits: 0 }),
}));

// Copied requester metadata is not identity, and SO_PEERCRED-derived transport
// alone is not a semantic capability.
expectCode("direct_semantic_principal_untrusted", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, capability: submit,
  request: submitRequest("forged-requester", { requesterRef: principal.principalId }),
}));
expectCode("direct_semantic_principal_untrusted", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: structuredClone(principal), capability: submit,
  request: submitRequest("forged-semantic"),
}));

// Submit and observation are separate capabilities.
const readJob = authorization.registerJob({
  schema: "direct_semantic_job@1",
  jobRef: "job-1",
  projectRef: "project-1",
  admittedPrincipalRef: principal.principalId,
  resultsReadable: true,
  cancelable: true,
});
const readCapability = capabilityAuthority.issue({
  capabilityId: "read-cap-1", principal, operation: "read_results",
  jobRefs: [readJob.jobRef], projectRegistryRevisionRefs: [], allowedTargetORevisions: [], targetSnapshotReceiptRefs: [],
  compilerPinRefs: [], kernelRevisionRefs: [], executionProfileRevisionRefs: [], providerProfileRevisionRefs: [],
  allowedModels: [], allowedReasoningEfforts: [], attemptPolicyRevisionRefs: [], purposeScopes: ["semantic_read"],
  returnProjectionRefs: [projection.returnProjectionRef], maximumJobs: 0, maximumCellsPerJob: 0,
  maximumReplicatesPerCell: 0, maximumInputTokensPerJob: 0, maximumOutputTokensPerJob: 0,
  maximumCostMicrounitsPerJob: null, issuedAt: NOW, nonce: "read-nonce-1",
});
const readRequest = {
  schema: "direct_semantic_results_request@1", requestId: "read-request-1", jobRef: readJob.jobRef,
  returnProjectionRef: projection.returnProjectionRef, idempotencyKey: "read-1",
};
const readReceipt = authorization.authorize({ operation: "read_results", transportPrincipal: transport, semanticPrincipal: principal, capability: readCapability, request: readRequest });
assert.equal(readReceipt.decision, "authorized");
expectCode("direct_semantic_capability_operation_mismatch", () => authorization.authorize({ operation: "read_results", transportPrincipal: transport, semanticPrincipal: principal, capability: submit, request: readRequest }));
expectCode("direct_semantic_capability_operation_mismatch", () => authorization.authorize({ operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: readCapability, request: submitRequest("wrong-cap") }));

// Future revision expansion and exact resource/model bounds fail closed.
expectCode("direct_semantic_scope_denied", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("future-revision", { targetORevision: "target-o-2" }),
  resourceEstimate: submissionEstimate(),
}));
expectCode("direct_semantic_cells_quota_exceeded", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("bounds-cells", { edgeOccurrenceRefs: ["edge-1", "edge-2", "edge-3"] }), resourceEstimate: submissionEstimate(3),
}));
expectCode("direct_semantic_scope_denied", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("bounds-model"), resourceEstimate: submissionEstimate(1, { model: "not-allowed" }),
}));

const expiring = submitCapability({ capabilityId: "submit-expiring", issuedAt: "2026-08-24T08:00:00.000Z", expiresAt: "2026-08-24T09:00:00.000Z" });
expectCode("direct_semantic_capability_expired", () => authorization.authorize({ operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: expiring, request: submitRequest("expired") }));
const revoked = submitCapability({ capabilityId: "submit-revoked" });
capabilityAuthority.revoke(revoked, { reason: "test" });
expectCode("direct_semantic_capability_revoked", () => authorization.authorize({ operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: revoked, request: submitRequest("revoked") }));
expectCode("direct_semantic_capability_untrusted", () => authorization.authorize({ operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: structuredClone(submit), request: submitRequest("copied-cap") }));

// Atomic maximumJobs/budget consumption: two distinct keys race for one slot;
// at most one can reserve it.  Promise scheduling cannot split the synchronous
// compare-and-swap section in consumeBudget.
const oneShot = submitCapability({ capabilityId: "submit-one-shot", maximumJobs: 1 });
const raced = await Promise.allSettled(["race-a", "race-b"].map((key) => Promise.resolve().then(() => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: oneShot,
  request: submitRequest(key), resourceEstimate: submissionEstimate(),
}))));
assert.equal(raced.filter((entry) => entry.status === "fulfilled").length, 1, "one budget slot has one winner");
assert.equal(raced.filter((entry) => entry.status === "rejected").length, 1, "second concurrent spend is rejected");

console.log(JSON.stringify({
  schema: "direct_semantic_service_authorization_regression@1",
  status: "passed",
  acceptedAuthorizationRef: accepted.authorizationRef,
  readAuthorizationRef: readReceipt.authorizationRef,
  raced: raced.map((entry) => entry.status),
}, null, 2));
