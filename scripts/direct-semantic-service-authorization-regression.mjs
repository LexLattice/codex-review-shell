#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPrincipalAuthority } = require("../src/main/direct/semantic-service/principal-authority.js");
const { createCapabilityAuthority } = require("../src/main/direct/semantic-service/capability-authority.js");
const { createAuthorizationAuthority } = require("../src/main/direct/semantic-service/authorization.js");

const NOW = "2026-08-24T10:00:00.000Z";
const ref = (prefix, value) => `${prefix}-${value}`;

function expectCode(code, action) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

const principalAuthority = createPrincipalAuthority({ authorityId: "principal-authority-1", now: NOW });
const capabilityAuthority = createCapabilityAuthority({
  authorityId: "capability-authority-1",
  principalAuthority,
  now: NOW,
});
const authorization = createAuthorizationAuthority({
  authorityId: "authorization-authority-1",
  principalAuthority,
  capabilityAuthority,
  now: NOW,
});

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

const project = authorization.registerProjectRegistryRevision({
  schema: "direct_semantic_project_registry_revision@1",
  registryRevisionRef: "registry-revision-1",
  projectRef: "project-1",
  substrateBinding: "wsl",
  repositoryIdentity: "repo-1",
  targetRevisionPolicy: { kind: "exact_git_commit_allowlist", allowedCommits: ["target-o-1"], cleanTreeRequired: true },
  projectEvidenceRuntimeRevisionRef: "project-runtime-1",
  evidenceCartographyRevisionRef: "cartography-1",
  authorityPolicyRef: "authority-policy-1",
  admittedByCapabilityRef: "admin-capability-1",
  admittedAt: NOW,
});
const snapshot = authorization.registerTargetSnapshotReceipt({
  schema: "direct_semantic_target_snapshot_receipt@1",
  targetSnapshotReceiptRef: "snapshot-1",
  projectRegistryRevisionRef: project.registryRevisionRef,
  repositoryIdentity: "repo-1",
  targetORevision: "target-o-1",
  gitCommit: "target-o-1",
  gitTree: "tree-1",
  snapshotDigest: "snapshot-digest-1",
  capturedAt: NOW,
});
const compiler = authorization.registerCompilerPin({
  schema: "direct_semantic_compiler_build_pin@1",
  compilerPinRef: "compiler-pin-1",
  repositoryIdentity: "semantic-compiler",
  gitCommit: "compiler-commit-1",
  gitTree: "compiler-tree-1",
  sourceArtifactDigest: "source-1",
  executableArtifactDigest: "exec-1",
  interpreterToolchainDigest: "toolchain-1",
  dependencyLockDigest: "lock-1",
  installedDependencyEnvironmentDigest: "env-1",
  invocationContractDigest: "invoke-1",
  canonicalSchemaDigests: ["schema-1"],
  patternLibraryDigests: ["patterns-1"],
  evidenceCatalogDigests: ["catalog-1"],
  compilerGateReceiptDigest: "gate-1",
  adapterRevision: "adapter-1",
  admittedAt: NOW,
});
const kernel = authorization.registerKernelRevision({
  schema: "semantic_kernel_revision@1",
  kernelRef: "kernel-1",
  semanticIsaRevision: "isa-1",
  transformationLawDigest: "law-1",
  evidenceSemanticsDigest: "evidence-law-1",
  remandLawDigest: "remand-law-1",
  authorityPosture: "advisory_only",
  outputSchemaDigest: "output-1",
  ratificationEvidenceRefs: ["ratification-1"],
});
const provider = authorization.registerProviderProfileRevision({
  schema: "direct_semantic_provider_profile_revision@1",
  providerProfileRevisionRef: "provider-profile-1",
  provider: "fake",
  admittedAt: NOW,
});
const attemptPolicy = authorization.registerAttemptPolicy({
  schema: "direct_semantic_attempt_policy@1",
  attemptPolicyRef: "attempt-policy-1",
  retryableFailureClasses: ["transport_unavailable_before_dispatch"],
  maximumAttemptsPerReplicateSlot: 2,
  replicateCountPerCell: 1,
  selectionRule: "all_results_independent",
  timeoutMs: 1000,
  outputByteLimit: 10000,
  fixedBeforeExecution: true,
});
const execution = authorization.registerExecutionProfileRevision({
  schema: "direct_semantic_execution_profile_revision@1",
  executionProfileRevisionRef: "execution-profile-1",
  providerProfileRevisionRef: provider.providerProfileRevisionRef,
  allowedModels: ["fake-model"],
  allowedReasoningEfforts: ["minimal"],
  workerExecutionRuntimeRevisionRef: "worker-runtime-1",
  attemptPolicyRevisionRefs: [attemptPolicy.attemptPolicyRef],
  maximumConcurrentAttempts: 1,
  maximumInputTokensPerAttempt: 1000,
  maximumOutputTokensPerAttempt: 1000,
  maximumCostMicrounitsPerAttempt: 100,
  kernelRevisionRefs: [kernel.kernelRef],
  executionPolicyDigest: "execution-policy-1",
});
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
    maximumInputTokensPerJob: overrides.maximumInputTokensPerJob ?? 100,
    maximumOutputTokensPerJob: overrides.maximumOutputTokensPerJob ?? 100,
    maximumCostMicrounitsPerJob: overrides.maximumCostMicrounitsPerJob ?? 100,
    issuedAt: overrides.issuedAt || NOW,
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
    nonce: overrides.nonce || `nonce-${Math.random().toString(36).slice(2)}`,
  });
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
  resourceEstimate: { cells: 1, replicatesPerCell: 1, inputTokens: 10, outputTokens: 10, costMicrounits: 5, model: "fake-model", reasoningEffort: "minimal" },
});
assert.equal(accepted.decision, "authorized");
assert.equal(authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("submit-1"), resourceEstimate: { cells: 1, replicatesPerCell: 1, inputTokens: 10, outputTokens: 10, costMicrounits: 5, model: "fake-model", reasoningEffort: "minimal" },
}), accepted, "same idempotency key/request returns original receipt");

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
  resourceEstimate: { cells: 1, replicatesPerCell: 1, inputTokens: 10, outputTokens: 10, costMicrounits: 5 },
}));
expectCode("direct_semantic_cells_quota_exceeded", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("bounds-cells", { edgeOccurrenceRefs: ["edge-1", "edge-2", "edge-3"] }), resourceEstimate: { cells: 3, replicatesPerCell: 1, inputTokens: 10, outputTokens: 10, costMicrounits: 5 },
}));
expectCode("direct_semantic_scope_denied", () => authorization.authorize({
  operation: "submit_job", transportPrincipal: transport, semanticPrincipal: principal, capability: submit,
  request: submitRequest("bounds-model"), resourceEstimate: { cells: 1, replicatesPerCell: 1, inputTokens: 10, outputTokens: 10, costMicrounits: 5, model: "not-allowed", reasoningEffort: "minimal" },
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
  request: submitRequest(key), resourceEstimate: { cells: 1, replicatesPerCell: 1, inputTokens: 1, outputTokens: 1, costMicrounits: 1 },
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
