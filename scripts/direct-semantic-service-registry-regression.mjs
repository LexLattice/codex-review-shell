#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ATTEMPT_POLICY_SCHEMA,
  COMPILER_BUILD_PIN_SCHEMA,
  EXECUTION_PROFILE_REVISION_SCHEMA,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  PROJECT_REGISTRY_REVISION_SCHEMA,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  KIND,
  createRegistryAuthority,
  isRegistryAuthority,
} from "../src/main/direct/semantic-service/registry.js";
import {
  COMPILER_FIELDS,
  TARGET_FIELDS,
  verifyCompilerBuildPin,
  verifyTargetSnapshotReceipt,
} from "../src/main/direct/semantic-service/pin-verification.js";
import { createPrincipalAuthority } from "../src/main/direct/semantic-service/principal-authority.js";
import { createCapabilityAuthority } from "../src/main/direct/semantic-service/capability-authority.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

function expectFailure(fn, label) {
  assert.throws(fn, undefined, label);
}

function compilerPin(overrides = {}) {
  return {
    schema: COMPILER_BUILD_PIN_SCHEMA,
    compilerPinRef: "compiler-pin-1",
    repositoryIdentity: "semantic-compiler-repository",
    gitCommit: "compiler-commit-1",
    gitTree: "compiler-tree-1",
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
    adapterRevision: "compiler-adapter-1",
    admittedAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

function projectRuntime(overrides = {}) {
  return {
    schema: PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
    projectEvidenceRuntimeRevisionRef: "project-runtime-1",
    projectRef: "project-1",
    substrateBinding: "wsl",
    operatingSystemRevision: "linux-6.8-1",
    interpreterExecutableDigest: DIGEST_A,
    toolchainArtifactDigests: [DIGEST_A],
    installedDependencyEnvironmentDigest: DIGEST_A,
    deterministicCheckRegistryDigest: DIGEST_A,
    admittedEnvironmentInputDigest: DIGEST_A,
    runtimePolicyDigest: DIGEST_A,
    ...overrides,
  };
}

function projectRegistry(overrides = {}) {
  return {
    schema: PROJECT_REGISTRY_REVISION_SCHEMA,
    registryRevisionRef: "project-registry-1",
    projectRef: "project-1",
    substrateBinding: "wsl",
    repositoryIdentity: "project-repository-1",
    privateRepositoryLocatorRef: "private-locator-1",
    targetRevisionPolicy: {
      kind: "exact_git_commit_allowlist",
      allowedCommits: ["project-commit-1"],
      cleanTreeRequired: true,
    },
    projectEvidenceRuntimeRevisionRef: "project-runtime-1",
    evidenceCartographyRevisionRef: "cartography-1",
    authorityPolicyRef: "authority-policy-1",
    admittedByCapabilityRef: "registry-capability-1",
    admittedAt: "2026-08-24T10:01:00.000Z",
    ...overrides,
  };
}

function targetSnapshot(overrides = {}) {
  return {
    schema: TARGET_SNAPSHOT_RECEIPT_SCHEMA,
    targetSnapshotReceiptRef: "target-snapshot-1",
    projectRegistryRevisionRef: "project-registry-1",
    repositoryIdentity: "project-repository-1",
    targetORevision: "project-o-revision-1",
    gitCommit: "project-commit-1",
    gitTree: "project-tree-1",
    submoduleClosureDigest: DIGEST_A,
    lfsObjectClosureDigest: DIGEST_A,
    admittedGeneratedInputDigest: DIGEST_A,
    evidenceCartographyRevisionRef: "cartography-1",
    projectEvidenceRuntimeRevisionRef: "project-runtime-1",
    projectRuntimeInputDigest: DIGEST_A,
    sourceStatusDigest: DIGEST_A,
    snapshotArtifactRef: "snapshot-artifact-1",
    snapshotMaterializationMode: "isolated_read_only_snapshot",
    preObservationReceiptRef: "pre-observation-1",
    postObservationReceiptRef: "post-observation-1",
    snapshotDigest: DIGEST_A,
    capturedAt: "2026-08-24T10:02:00.000Z",
    ...overrides,
  };
}

function workerRuntime(overrides = {}) {
  return {
    schema: WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
    workerExecutionRuntimeRevisionRef: "worker-runtime-1",
    substrateBinding: "remote_api",
    backendAdapterRevision: "fake-backend-1",
    processLauncherDigest: DIGEST_A,
    sandboxPolicyDigest: DIGEST_A,
    scratchPolicyDigest: DIGEST_A,
    environmentAllowlistDigest: DIGEST_A,
    credentialExclusionPolicyDigest: DIGEST_A,
    outputCapturePolicyDigest: DIGEST_A,
    runtimeArtifactDigest: DIGEST_A,
    ...overrides,
  };
}

function attemptPolicy(overrides = {}) {
  return {
    schema: ATTEMPT_POLICY_SCHEMA,
    attemptPolicyRef: "attempt-policy-1",
    retryableFailureClasses: ["runtime_failed_before_raw_capture"],
    maximumAttemptsPerReplicateSlot: 2,
    replicateCountPerCell: 2,
    selectionRule: "all_results_independent",
    timeoutMs: 30_000,
    outputByteLimit: 10_000,
    fixedBeforeExecution: true,
    ...overrides,
  };
}

function executionProfile(overrides = {}) {
  return {
    schema: EXECUTION_PROFILE_REVISION_SCHEMA,
    executionProfileRevisionRef: "execution-profile-1",
    providerProfileRevisionRef: "provider-profile-1",
    allowedModels: ["deterministic-fake"],
    allowedReasoningEfforts: ["medium"],
    workerExecutionRuntimeRevisionRef: "worker-runtime-1",
    attemptPolicyRevisionRefs: ["attempt-policy-1"],
    maximumConcurrentAttempts: 2,
    maximumInputTokensPerAttempt: 1000,
    maximumOutputTokensPerAttempt: 1000,
    maximumCostMicrounitsPerAttempt: null,
    executionPolicyDigest: DIGEST_A,
    ...overrides,
  };
}

function compilerObservation(pin) {
  return Object.fromEntries(COMPILER_FIELDS.map((field) => [field, pin[field]]));
}

function targetObservation(receipt) {
  return {
    ...Object.fromEntries(TARGET_FIELDS.map((field) => [field, receipt[field]])),
    preObservation: { receiptRef: receipt.preObservationReceiptRef, observationDigest: DIGEST_A },
    postObservation: { receiptRef: receipt.postObservationReceiptRef, observationDigest: DIGEST_A },
    immutableArtifact: {
      artifactRef: receipt.snapshotArtifactRef,
      digest: receipt.snapshotDigest,
      materializationMode: receipt.snapshotMaterializationMode,
    },
  };
}

function runtimeObservation(runtime) {
  return {
    projectRef: runtime.projectRef,
    substrateBinding: runtime.substrateBinding,
    operatingSystemRevision: runtime.operatingSystemRevision,
    interpreterExecutableDigest: runtime.interpreterExecutableDigest,
    toolchainArtifactDigests: runtime.toolchainArtifactDigests,
    installedDependencyEnvironmentDigest: runtime.installedDependencyEnvironmentDigest,
    deterministicCheckRegistryDigest: runtime.deterministicCheckRegistryDigest,
    admittedEnvironmentInputDigest: runtime.admittedEnvironmentInputDigest,
    runtimePolicyDigest: runtime.runtimePolicyDigest,
  };
}

function workerObservation(runtime) {
  const result = { ...runtime };
  delete result.schema;
  delete result.workerExecutionRuntimeRevisionRef;
  return result;
}

function main() {
  const principalAuthority = createPrincipalAuthority({ authorityId: "registry-principal-authority", now: "2026-08-24T10:00:00.000Z" });
  const capabilityAuthority = createCapabilityAuthority({ authorityId: "registry-capability-authority", principalAuthority, now: "2026-08-24T10:00:00.000Z" });
  const transport = principalAuthority.deriveTransportPrincipal({
    transport: "internal", hostUserId: "registry-service", observedAt: "2026-08-24T10:00:00.000Z",
  });
  const semanticPrincipal = principalAuthority.issueSemanticPrincipal({
    principalId: "registry-operator", issuerRevision: "registry-issuer-1", principalClass: "operator",
    subjectRef: "registry-service", projectScopes: [], purposeScopes: ["semantic_registry_admit"], transportPrincipal: transport,
  });
  const admissionCapability = capabilityAuthority.issue({
    capabilityId: "registry-capability-1", principal: semanticPrincipal, operation: "administer_service",
    jobRefs: [], projectRegistryRevisionRefs: [], allowedTargetORevisions: [], targetSnapshotReceiptRefs: [],
    compilerPinRefs: [], kernelRevisionRefs: [], executionProfileRevisionRefs: [], providerProfileRevisionRefs: [],
    allowedModels: [], allowedReasoningEfforts: [], attemptPolicyRevisionRefs: [],
    purposeScopes: ["semantic_registry_admit"], returnProjectionRefs: [], maximumJobs: 0,
    maximumCellsPerJob: 0, maximumReplicatesPerCell: 0, maximumInputTokensPerJob: 0,
    maximumOutputTokensPerJob: 0, maximumCostMicrounitsPerJob: null,
    issuedAt: "2026-08-24T10:00:00.000Z", nonce: "registry-capability-nonce-1",
  });
  const admissionAuthority = { capability: admissionCapability, semanticPrincipal };
  const registry = createRegistryAuthority({
    authorityRef: "registry-authority-1",
    capabilityAuthority,
  });

  const projectRuntimeInput = projectRuntime();
  const projectInput = projectRegistry();
  const targetInput = targetSnapshot();
  const compilerInput = compilerPin();
  const workerInput = workerRuntime();
  const admittedProjectRuntime = registry.admitProjectEvidenceRuntimeRevision(projectRuntimeInput, runtimeObservation(projectRuntimeInput), admissionAuthority);
  const admittedProject = registry.admitProjectRegistryRevision(projectInput, admissionAuthority);
  const admittedTarget = registry.admitTargetSnapshotReceipt(targetInput, targetObservation(targetInput), admissionAuthority);
  const admittedCompiler = registry.admitCompilerBuildPin(compilerInput, compilerObservation(compilerInput), admissionAuthority);
  const admittedWorker = registry.admitWorkerExecutionRuntimeRevision(workerInput, workerObservation(workerInput), admissionAuthority);
  const admittedPolicy = registry.admitAttemptPolicy(attemptPolicy(), admissionAuthority);
  const admittedProfile = registry.admitExecutionProfileRevision(executionProfile(), admissionAuthority);

  // Positive lineage: every record is frozen, exact-ref lookup returns the
  // authority-owned identity, and a worker runtime never replaces the project
  // evidence runtime.
  assert(Object.isFrozen(admittedCompiler), "compiler pin must be immutable");
  assert(Object.isFrozen(admittedTarget), "target receipt must be immutable");
  assert.equal(registry.resolve(KIND.compilerBuildPin, admittedCompiler.compilerPinRef), admittedCompiler);
  assert.equal(registry.resolve(KIND.targetSnapshotReceipt, admittedTarget.targetSnapshotReceiptRef), admittedTarget);
  const binding = registry.bindJob({
    jobRef: "job-1",
    compilerPinRef: admittedCompiler.compilerPinRef,
    projectRegistryRevisionRef: admittedProject.registryRevisionRef,
    targetSnapshotReceiptRef: admittedTarget.targetSnapshotReceiptRef,
    executionProfileRevisionRef: admittedProfile.executionProfileRevisionRef,
  });
  assert.equal(binding.projectEvidenceRuntimeRevisionRef, admittedProjectRuntime.projectEvidenceRuntimeRevisionRef);
  assert.equal(binding.workerExecutionRuntimeRevisionRef, admittedWorker.workerExecutionRuntimeRevisionRef);
  assert.equal(Object.keys(binding.verificationReceiptDigests).length, 4);
  const bindingLineage = { ...binding };
  delete bindingLineage.schema;
  delete bindingLineage.verificationReceiptDigests;

  registry.verifyCompilerBuildPin(admittedCompiler, compilerObservation(admittedCompiler));
  registry.verifyProjectEvidenceRuntimeRevision(admittedProjectRuntime, runtimeObservation(admittedProjectRuntime));
  registry.verifyWorkerExecutionRuntimeRevision(admittedWorker, workerObservation(admittedWorker));
  registry.verifyTargetSnapshotReceipt(admittedTarget, targetObservation(admittedTarget));
  registry.verifyTargetSnapshotReceipt(admittedTarget, {
    ...targetObservation(admittedTarget),
    immutableArtifact: {
      artifactRef: admittedTarget.snapshotArtifactRef,
      digest: admittedTarget.snapshotDigest,
      materializationMode: admittedTarget.snapshotMaterializationMode,
    },
  });
  const storedVerification = registry.verificationReceipt(KIND.targetSnapshotReceipt, admittedTarget);
  assert.equal(storedVerification.verified, true);
  const missingCapturePair = targetObservation(admittedTarget);
  delete missingCapturePair.preObservation;
  delete missingCapturePair.postObservation;
  expectFailure(() => registry.verifyTargetSnapshotReceipt(admittedTarget, missingCapturePair), "capture pair is mandatory");
  const missingArtifact = targetObservation(admittedTarget);
  delete missingArtifact.immutableArtifact;
  expectFailure(() => registry.verifyTargetSnapshotReceipt(admittedTarget, missingArtifact), "immutable artifact evidence is mandatory");
  const aliasedCaptureReceipts = targetSnapshot({
    targetSnapshotReceiptRef: "target-snapshot-aliased-capture",
    postObservationReceiptRef: "pre-observation-1",
  });
  expectFailure(
    () => registry.admitTargetSnapshotReceipt(aliasedCaptureReceipts, targetObservation(aliasedCaptureReceipts), admissionAuthority),
    "before and after capture receipts must be distinct",
  );

  // Every compiler identity dimension is independently checked.  A changed
  // executable is no safer than a changed source tree or lockfile.
  for (const field of COMPILER_FIELDS) {
    const observation = compilerObservation(admittedCompiler);
    if (Array.isArray(observation[field])) observation[field] = [...observation[field], DIGEST_B];
    else if (field.endsWith("Digest")) observation[field] = DIGEST_B;
    else observation[field] = `${observation[field]}-drift`;
    expectFailure(() => verifyCompilerBuildPin(admittedCompiler, observation), `compiler drift: ${field}`);
  }

  // A complete target observation includes all source/runtime/artifact
  // closure dimensions.  Each drift must reject before materialization.
  for (const field of TARGET_FIELDS) {
    const observation = targetObservation(admittedTarget);
    if (field === "snapshotMaterializationMode") observation[field] = "mutable_worktree";
    else if (field.endsWith("Digest")) observation[field] = DIGEST_B;
    else observation[field] = `${observation[field]}-drift`;
    expectFailure(() => verifyTargetSnapshotReceipt(admittedTarget, observation), `target drift: ${field}`);
  }
  const captureDrift = targetObservation(admittedTarget);
  captureDrift.postObservation.observationDigest = DIGEST_B;
  expectFailure(() => verifyTargetSnapshotReceipt(admittedTarget, captureDrift), "mutable capture drift");

  // JSON copies, unknown refs, and copied authority-shaped objects carry no
  // admission authority.
  const copiedCompiler = JSON.parse(JSON.stringify(admittedCompiler));
  expectFailure(() => registry.verifyCompilerBuildPin(copiedCompiler, compilerObservation(admittedCompiler)), "copied compiler pin");
  expectFailure(() => registry.resolve(KIND.compilerBuildPin, "unknown-compiler-pin"), "unknown compiler pin");
  assert.equal(registry.has(KIND.compilerBuildPin, "unknown-compiler-pin"), false);
  assert.equal(registry.has(KIND.compilerBuildPin, "latest"), false);
  expectFailure(() => registry.bindJob({
    ...bindingLineage,
    compilerPinRef: "latest",
  }), "mutable compiler alias");
  expectFailure(() => registry.bindJob({
    ...bindingLineage,
    targetSnapshotReceiptRef: "current",
  }), "mutable target alias");
  assert.equal(registry.schema, "direct_semantic_registry_authority@1");
  assert.equal(isRegistryAuthority(JSON.parse(JSON.stringify(registry))), false);
  const copiedAuthority = { ...registry };
  expectFailure(() => copiedAuthority.resolve(KIND.compilerBuildPin, admittedCompiler.compilerPinRef), "copied authority object");

  // Re-admission cannot rewrite a prior revision.  A later revision has to be
  // named explicitly and does not make the old target or capability lineage
  // point to the new project record.
  const runtime2Input = projectRuntime({
    projectEvidenceRuntimeRevisionRef: "project-runtime-2",
    runtimePolicyDigest: DIGEST_B,
  });
  const runtime2 = registry.admitProjectEvidenceRuntimeRevision(runtime2Input, runtimeObservation(runtime2Input), admissionAuthority);
  const project2 = registry.admitProjectRegistryRevision(projectRegistry({
    registryRevisionRef: "project-registry-2",
    priorRevisionRef: admittedProject.registryRevisionRef,
    projectEvidenceRuntimeRevisionRef: runtime2.projectEvidenceRuntimeRevisionRef,
    evidenceCartographyRevisionRef: "cartography-2",
    targetRevisionPolicy: {
      kind: "exact_git_commit_allowlist",
      allowedCommits: ["project-commit-2"],
      cleanTreeRequired: true,
    },
  }), admissionAuthority);
  assert.equal(registry.resolve(KIND.projectRegistryRevision, admittedProject.registryRevisionRef), admittedProject);
  assert.equal(admittedProject.evidenceCartographyRevisionRef, "cartography-1");
  expectFailure(() => registry.admitProjectRegistryRevision(projectRegistry({
    registryRevisionRef: "project-registry-forged-authority",
    admittedByCapabilityRef: "attacker-capability",
  }), admissionAuthority), "self-declared admission capability");
  expectFailure(() => registry.bindJob({
    ...bindingLineage,
    projectRegistryRevisionRef: project2.registryRevisionRef,
  }), "later project revision cannot inherit old target");
  expectFailure(() => registry.admitProjectRegistryRevision(projectRegistry({
    registryRevisionRef: admittedProject.registryRevisionRef,
    projectEvidenceRuntimeRevisionRef: runtime2.projectEvidenceRuntimeRevisionRef,
  }), admissionAuthority), "duplicate revision cannot rewrite prior record");

  // Project/runtime role substitution fails in both directions.  Execution
  // profiles can only point at admitted worker runtime revisions.
  expectFailure(() => registry.assertRuntimeSeparation(admittedProjectRuntime, admittedProjectRuntime), "project runtime as worker runtime");
  expectFailure(() => registry.bindJob({
    ...bindingLineage,
    projectEvidenceRuntimeRevisionRef: admittedWorker.workerExecutionRuntimeRevisionRef,
  }), "worker runtime as project runtime");
  expectFailure(() => registry.admitExecutionProfileRevision(executionProfile({
    executionProfileRevisionRef: "execution-profile-forged",
    workerExecutionRuntimeRevisionRef: admittedProjectRuntime.projectEvidenceRuntimeRevisionRef,
  }), admissionAuthority), "project runtime in worker profile");

  // No declaration gains admission or execution standing without both a real
  // administrative capability and required verification evidence. Generic
  // registration aliases are intentionally absent.
  expectFailure(() => registry.admitCompilerBuildPin(compilerPin({ compilerPinRef: "compiler-pin-unverified" }), undefined, admissionAuthority), "unverified compiler cannot be admitted");
  expectFailure(() => registry.admitAttemptPolicy(attemptPolicy({ attemptPolicyRef: "policy-no-authority" })), "registry admission requires opaque authority");
  assert.equal(typeof registry.register, "undefined");
  assert.equal(typeof registry.registerCompilerPin, "undefined");

  // Pure verification remains usable by an adapter, but no pure result grants
  // registry membership or job-binding authority.
  verifyCompilerBuildPin(admittedCompiler, compilerObservation(admittedCompiler));
  verifyTargetSnapshotReceipt(admittedTarget, targetObservation(admittedTarget));
  expectFailure(() => registry.assertAdmitted(KIND.compilerBuildPin, copiedCompiler), "copied record cannot be asserted as admitted");

  const snapshot = registry.snapshot();
  assert.equal(snapshot.sequence, 9);
  assert.deepEqual(snapshot.records.compilerBuildPin, ["compiler-pin-1"]);
  assert.deepEqual(snapshot.records.projectRegistryRevision, ["project-registry-1", "project-registry-2"]);
  assert(Object.isFrozen(snapshot), "registry snapshot must be immutable");

  console.log(JSON.stringify({
    schema: "direct_semantic_registry_regression_report@1",
    status: "passed",
    positiveLineage: true,
    compilerDimensionsChecked: COMPILER_FIELDS.length,
    targetDimensionsChecked: TARGET_FIELDS.length,
    laterRevisionNoninheritance: true,
    runtimeRoleSeparation: true,
    authorityCopiesRejected: true,
    registrySequence: snapshot.sequence,
  }, null, 2));
}

main();
