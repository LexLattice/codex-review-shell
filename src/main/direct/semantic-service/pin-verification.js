"use strict";

/*
 * DSS-0.1 pin and snapshot verification.
 *
 * This module deliberately has no repository, process, archive, or storage
 * access.  The caller supplies the observation made by a service-owned
 * adapter; this code only validates that an admitted contract and the
 * observation describe the same exact identity.  Registry admission is kept
 * in registry.js so these functions remain useful to a later adapter without
 * giving the adapter any registry authority.
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
} = require("./canonical");
const { validateContract } = require("./contract-schemas");

const COMPILER_BUILD_PIN_SCHEMA = "direct_semantic_compiler_build_pin@1";
const PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA = "direct_semantic_project_evidence_runtime_revision@1";
const TARGET_SNAPSHOT_RECEIPT_SCHEMA = "direct_semantic_target_snapshot_receipt@1";
const WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA = "direct_semantic_worker_execution_runtime_revision@1";
const PIN_VERIFICATION_RECEIPT_SCHEMA = "direct_semantic_pin_verification_receipt@1";
const SNAPSHOT_VERIFICATION_RECEIPT_SCHEMA = "direct_semantic_target_snapshot_verification_receipt@1";

const COMPILER_FIELDS = Object.freeze([
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
]);

const PROJECT_RUNTIME_FIELDS = Object.freeze([
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

const WORKER_RUNTIME_FIELDS = Object.freeze([
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

const TARGET_FIELDS = Object.freeze([
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
]);

const DIGEST_ARRAY_FIELDS = new Set([
  "canonicalSchemaDigests",
  "patternLibraryDigests",
  "evidenceCatalogDigests",
  "toolchainArtifactDigests",
]);

const DIGEST_FIELDS = new Set([
  "sourceArtifactDigest",
  "executableArtifactDigest",
  "interpreterToolchainDigest",
  "dependencyLockDigest",
  "installedDependencyEnvironmentDigest",
  "invocationContractDigest",
  "compilerGateReceiptDigest",
  "interpreterExecutableDigest",
  "deterministicCheckRegistryDigest",
  "admittedEnvironmentInputDigest",
  "runtimePolicyDigest",
  "processLauncherDigest",
  "sandboxPolicyDigest",
  "scratchPolicyDigest",
  "environmentAllowlistDigest",
  "credentialExclusionPolicyDigest",
  "outputCapturePolicyDigest",
  "runtimeArtifactDigest",
  "submoduleClosureDigest",
  "lfsObjectClosureDigest",
  "admittedGeneratedInputDigest",
  "projectRuntimeInputDigest",
  "sourceStatusDigest",
  "snapshotDigest",
]);

const ID_FIELDS = new Set([
  "projectRef",
  "adapterRevision",
  "backendAdapterRevision",
  "targetORevision",
  "evidenceCartographyRevisionRef",
  "projectEvidenceRuntimeRevisionRef",
  "projectRegistryRevisionRef",
  "snapshotArtifactRef",
  "preObservationReceiptRef",
  "postObservationReceiptRef",
]);

const SUBSTRATE_BINDINGS = new Set(["wsl", "windows", "remote_api"]);

function reject(code, detail = "") {
  return fail(code, detail);
}

function own(value, key) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function exact(value, keys, code) {
  if (!isPlainObject(value)) reject(code);
  // Keep the call to the shared canonical helper at the boundary.  A small
  // local exact check makes this module tolerant of the helper's optional
  // diagnostic-argument shape while preserving fail-closed behavior.
  try {
    assertExactObject(value, keys, code);
  } catch (error) {
    throw error;
  }
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    reject(code);
  }
  return value;
}

function aliasFreeString(value, label) {
  const result = requiredString(value, label);
  const lowered = result.trim().toLowerCase();
  const pieces = lowered.split(/[/:@#]/u);
  const mutableSelectors = new Set([
    "current", "latest", "alias", "head", "tip", "default", "main", "master",
    "develop", "development", "working", "workspace", "mutable", "branch",
  ]);
  if (mutableSelectors.has(lowered) || pieces.some((piece) => mutableSelectors.has(piece))) {
    reject("direct_semantic_mutable_alias_forbidden", label);
  }
  return result;
}

function normalizeDigest(value, label) {
  return requiredDigest(value, label);
}

function normalizeDigestArray(value, label) {
  let values;
  try {
    values = sortedUniqueStrings(value, label, { allowEmpty: true });
  } catch (error) {
    throw error;
  }
  return values.map((entry) => normalizeDigest(entry, label));
}

function normalizeObservationString(value, label) {
  return requiredString(value, label);
}

function observationValue(observation, field, aliases = []) {
  if (!isPlainObject(observation)) return undefined;
  if (own(observation, field)) return observation[field];
  for (const alias of aliases) {
    if (own(observation, alias)) return observation[alias];
  }
  return undefined;
}

function nestedObservationValue(observation, field, paths = []) {
  const direct = observationValue(observation, field);
  if (direct !== undefined) return direct;
  for (const path of paths) {
    let cursor = observation;
    let present = true;
    for (const segment of path) {
      if (!isPlainObject(cursor) || !own(cursor, segment)) {
        present = false;
        break;
      }
      cursor = cursor[segment];
    }
    if (present) return cursor;
  }
  return undefined;
}

function normalizeComparableArray(value, field) {
  if (!Array.isArray(value)) reject("direct_semantic_observation_dimension_missing", field);
  try {
    const values = sortedUniqueStrings(value, field, { allowEmpty: true });
    return DIGEST_ARRAY_FIELDS.has(field)
      ? values.map((entry) => normalizeDigest(entry, field))
      : values.map((entry) => requiredString(entry, field));
  } catch (error) {
    throw error;
  }
}

function compareDimension(expected, observed, field, { array = false } = {}) {
  if (observed === undefined) reject("direct_semantic_observation_dimension_missing", field);
  if (array) {
    const actual = normalizeComparableArray(observed, field);
    if (canonicalJson(expected) !== canonicalJson(actual)) {
      reject("direct_semantic_pin_dimension_mismatch", field);
    }
    return;
  }
  const expectedValue = DIGEST_FIELDS.has(field)
    ? normalizeDigest(expected, field)
    : ID_FIELDS.has(field)
      ? aliasFreeString(expected, field)
      : normalizeObservationString(expected, field);
  let actualValue = observed;
  if (DIGEST_FIELDS.has(field)) actualValue = normalizeDigest(actualValue, field);
  else if (ID_FIELDS.has(field)) actualValue = aliasFreeString(actualValue, field);
  else actualValue = normalizeObservationString(actualValue, field);
  if (expectedValue !== actualValue) reject("direct_semantic_pin_dimension_mismatch", field);
}

function validatePinShape(schemaName, pin) {
  if (!isPlainObject(pin) || pin.schema !== schemaName) {
    reject("direct_semantic_pin_schema_invalid", schemaName);
  }
  try {
    validateContract(schemaName, pin);
  } catch (error) {
    throw error;
  }
  return pin;
}

function verifyFields(pin, observed, fields, aliases = {}) {
  if (!isPlainObject(observed)) reject("direct_semantic_observation_invalid");
  const verifiedDimensions = [];
  for (const field of fields) {
    const value = nestedObservationValue(observed, field, aliases[field] || []);
    compareDimension(pin[field], value, field, { array: Array.isArray(pin[field]) });
    verifiedDimensions.push(field);
  }
  return verifiedDimensions;
}

function verifyOptionalIdentity(pin, observed, field, aliases = []) {
  const value = nestedObservationValue(observed, field, aliases);
  if (value === undefined) return false;
  compareDimension(pin[field], value, field);
  return true;
}

function verificationReceipt(schema, pin, observed, verifiedDimensions, kind) {
  const observationDigest = digestFor(`direct_semantic_${kind}_observation@1`, observed);
  const receipt = {
    schema,
    pinRef: pin.compilerPinRef || pin.projectEvidenceRuntimeRevisionRef ||
      pin.workerExecutionRuntimeRevisionRef || pin.targetSnapshotReceiptRef,
    verifiedDimensions: [...verifiedDimensions].sort(),
    observationDigest,
    verified: true,
  };
  return deepFreeze(receipt);
}

function verifyCompilerBuildPin(pin, observed) {
  validatePinShape(COMPILER_BUILD_PIN_SCHEMA, pin);
  const dimensions = verifyFields(pin, observed, COMPILER_FIELDS, {
    repositoryIdentity: [["repository", "identity"]],
    gitCommit: [["git", "commit"]],
    gitTree: [["git", "tree"]],
    sourceArtifactDigest: [["source", "artifactDigest"], ["source", "digest"]],
    executableArtifactDigest: [["executable", "artifactDigest"], ["executable", "digest"]],
    interpreterToolchainDigest: [["interpreter", "toolchainDigest"], ["toolchain", "digest"]],
    dependencyLockDigest: [["dependency", "lockDigest"], ["lock", "digest"]],
    installedDependencyEnvironmentDigest: [["installedEnvironment", "digest"], ["environment", "installedDependencyDigest"]],
    invocationContractDigest: [["invocation", "contractDigest"], ["invocationContract", "digest"]],
    canonicalSchemaDigests: [["canonical", "schemaDigests"]],
    patternLibraryDigests: [["patternLibrary", "digests"]],
    evidenceCatalogDigests: [["evidenceCatalog", "digests"]],
    compilerGateReceiptDigest: [["compilerGate", "receiptDigest"]],
    adapterRevision: [["adapter", "revision"]],
  });
  if (verifyOptionalIdentity(pin, observed, "compilerPinRef")) dimensions.push("compilerPinRef");
  return verificationReceipt(PIN_VERIFICATION_RECEIPT_SCHEMA, pin, observed, dimensions, "compiler_build_pin");
}

function verifyProjectEvidenceRuntimeRevision(pin, observed) {
  validatePinShape(PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA, pin);
  if (!SUBSTRATE_BINDINGS.has(pin.substrateBinding)) reject("direct_semantic_runtime_substrate_invalid");
  const dimensions = verifyFields(pin, observed, PROJECT_RUNTIME_FIELDS, {
    projectRef: [["project", "ref"], ["project", "projectRef"]],
    operatingSystemRevision: [["operatingSystem", "revision"], ["os", "revision"]],
    interpreterExecutableDigest: [["interpreter", "executableDigest"], ["interpreter", "digest"]],
    toolchainArtifactDigests: [["toolchain", "artifactDigests"], ["toolchain", "digests"]],
    installedDependencyEnvironmentDigest: [["installedEnvironment", "digest"], ["environment", "digest"]],
    deterministicCheckRegistryDigest: [["deterministicChecks", "registryDigest"]],
    admittedEnvironmentInputDigest: [["environmentInput", "digest"]],
    runtimePolicyDigest: [["runtimePolicy", "digest"]],
  });
  if (verifyOptionalIdentity(pin, observed, "projectEvidenceRuntimeRevisionRef")) {
    dimensions.push("projectEvidenceRuntimeRevisionRef");
  }
  return verificationReceipt(
    PIN_VERIFICATION_RECEIPT_SCHEMA,
    pin,
    observed,
    dimensions,
    "project_evidence_runtime_revision",
  );
}

function verifyWorkerExecutionRuntimeRevision(pin, observed) {
  validatePinShape(WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA, pin);
  if (!SUBSTRATE_BINDINGS.has(pin.substrateBinding)) reject("direct_semantic_runtime_substrate_invalid");
  const dimensions = verifyFields(pin, observed, WORKER_RUNTIME_FIELDS, {
    backendAdapterRevision: [["backend", "adapterRevision"], ["adapter", "revision"]],
    processLauncherDigest: [["processLauncher", "digest"]],
    sandboxPolicyDigest: [["sandbox", "policyDigest"], ["sandbox", "digest"]],
    scratchPolicyDigest: [["scratch", "policyDigest"], ["scratch", "digest"]],
    environmentAllowlistDigest: [["environment", "allowlistDigest"]],
    credentialExclusionPolicyDigest: [["credentials", "exclusionPolicyDigest"]],
    outputCapturePolicyDigest: [["outputCapture", "policyDigest"], ["output", "capturePolicyDigest"]],
    runtimeArtifactDigest: [["runtimeArtifact", "digest"]],
  });
  if (verifyOptionalIdentity(pin, observed, "workerExecutionRuntimeRevisionRef")) {
    dimensions.push("workerExecutionRuntimeRevisionRef");
  }
  return verificationReceipt(
    PIN_VERIFICATION_RECEIPT_SCHEMA,
    pin,
    observed,
    dimensions,
    "worker_execution_runtime_revision",
  );
}

function snapshotObservationValue(observed, field) {
  const aliases = {
    projectRegistryRevisionRef: [["projectRegistry", "revisionRef"]],
    repositoryIdentity: [["repository", "identity"]],
    targetORevision: [["target", "oRevision"], ["target", "revision"]],
    gitCommit: [["git", "commit"]],
    gitTree: [["git", "tree"]],
    submoduleClosureDigest: [["submodules", "closureDigest"], ["submodule", "closureDigest"]],
    lfsObjectClosureDigest: [["lfs", "objectClosureDigest"], ["lfs", "closureDigest"]],
    admittedGeneratedInputDigest: [["generated", "inputDigest"], ["generatedInputs", "digest"]],
    evidenceCartographyRevisionRef: [["cartography", "revisionRef"]],
    projectEvidenceRuntimeRevisionRef: [["projectRuntime", "revisionRef"], ["projectEvidenceRuntime", "revisionRef"]],
    projectRuntimeInputDigest: [["projectRuntime", "inputDigest"], ["runtime", "inputDigest"]],
    sourceStatusDigest: [["sourceStatus", "digest"], ["source", "statusDigest"]],
    snapshotArtifactRef: [["immutableArtifact", "artifactRef"], ["artifact", "ref"], ["snapshotArtifact", "ref"]],
    snapshotMaterializationMode: [["immutableArtifact", "materializationMode"], ["artifact", "materializationMode"]],
    preObservationReceiptRef: [["observations", "preReceiptRef"], ["preObservation", "receiptRef"]],
    postObservationReceiptRef: [["observations", "postReceiptRef"], ["postObservation", "receiptRef"]],
    snapshotDigest: [["immutableArtifact", "digest"], ["artifact", "digest"]],
  };
  return nestedObservationValue(observed, field, aliases[field] || []);
}

function observationDigestOf(value) {
  if (typeof value === "string") return value;
  if (!isPlainObject(value)) return undefined;
  if (own(value, "observationDigest")) return value.observationDigest;
  if (own(value, "digest")) return value.digest;
  return digestFor("direct_semantic_target_observation_component@1", value);
}

function assertCaptureAgreement(observed) {
  const pre = nestedObservationValue(observed, "preObservation", [["observations", "pre"]]);
  const post = nestedObservationValue(observed, "postObservation", [["observations", "post"]]);
  const preDigest = observationValue(observed, "preObservationDigest", ["preCaptureDigest"]);
  const postDigest = observationValue(observed, "postObservationDigest", ["postCaptureDigest"]);
  if (preDigest !== undefined || postDigest !== undefined) {
    if (preDigest === undefined || postDigest === undefined || preDigest !== postDigest) {
      reject("direct_semantic_target_snapshot_observation_drift", "capture_digest");
    }
  }
  if (pre !== undefined || post !== undefined) {
    if (pre === undefined || post === undefined) {
      reject("direct_semantic_target_snapshot_observation_missing", "capture_pair");
    }
    const left = observationDigestOf(pre);
    const right = observationDigestOf(post);
    if (left !== right) reject("direct_semantic_target_snapshot_observation_drift", "capture_pair");
  }
}

function verifyTargetSnapshotReceipt(receipt, observed) {
  validatePinShape(TARGET_SNAPSHOT_RECEIPT_SCHEMA, receipt);
  if (receipt.snapshotMaterializationMode !== "isolated_read_only_snapshot") {
    reject("direct_semantic_target_snapshot_materialization_mode_invalid");
  }
  if (!isPlainObject(observed)) reject("direct_semantic_observation_invalid");
  assertCaptureAgreement(observed);
  const dimensions = [];
  for (const field of TARGET_FIELDS) {
    const value = snapshotObservationValue(observed, field);
    compareDimension(receipt[field], value, field, { array: false });
    dimensions.push(field);
  }
  if (verifyOptionalIdentity(receipt, observed, "targetSnapshotReceiptRef")) {
    dimensions.push("targetSnapshotReceiptRef");
  }

  // The immutable artifact must be represented by both a stable reference and
  // its digest.  If an adapter supplies a richer artifact observation, check
  // the same pair explicitly rather than trusting the receipt's text fields.
  const artifact = nestedObservationValue(observed, "immutableArtifact", [["artifact"]]);
  if (artifact !== undefined) {
    const artifactRef = artifact.ref || artifact.artifactRef;
    const artifactDigest = artifact.digest || artifact.snapshotDigest;
    if (artifactRef !== receipt.snapshotArtifactRef) {
      reject("direct_semantic_target_snapshot_artifact_mismatch", "ref");
    }
    if (artifactDigest !== receipt.snapshotDigest) {
      reject("direct_semantic_target_snapshot_artifact_mismatch", "digest");
    }
    if (artifact.materializationMode !== undefined &&
        artifact.materializationMode !== receipt.snapshotMaterializationMode) {
      reject("direct_semantic_target_snapshot_artifact_mismatch", "mode");
    }
  }
  return verificationReceipt(
    SNAPSHOT_VERIFICATION_RECEIPT_SCHEMA,
    receipt,
    observed,
    dimensions,
    "target_snapshot_receipt",
  );
}

function verifyCompilerPin(pin, observed) {
  return verifyCompilerBuildPin(pin, observed);
}

function verifyProjectRuntime(pin, observed) {
  return verifyProjectEvidenceRuntimeRevision(pin, observed);
}

function verifyWorkerRuntime(pin, observed) {
  return verifyWorkerExecutionRuntimeRevision(pin, observed);
}

function verifyTargetSnapshot(pin, observed) {
  return verifyTargetSnapshotReceipt(pin, observed);
}

const verifyCompilerBuildPinAgainstObservation = verifyCompilerBuildPin;
const verifyProjectEvidenceRuntimeRevisionAgainstObservation = verifyProjectEvidenceRuntimeRevision;
const verifyWorkerExecutionRuntimeRevisionAgainstObservation = verifyWorkerExecutionRuntimeRevision;
const verifyTargetSnapshotReceiptAgainstObservation = verifyTargetSnapshotReceipt;

function isVerificationSuccessful(fn, ...args) {
  try {
    fn(...args);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  COMPILER_BUILD_PIN_SCHEMA,
  PROJECT_EVIDENCE_RUNTIME_REVISION_SCHEMA,
  TARGET_SNAPSHOT_RECEIPT_SCHEMA,
  WORKER_EXECUTION_RUNTIME_REVISION_SCHEMA,
  PIN_VERIFICATION_RECEIPT_SCHEMA,
  SNAPSHOT_VERIFICATION_RECEIPT_SCHEMA,
  COMPILER_FIELDS,
  PROJECT_RUNTIME_FIELDS,
  WORKER_RUNTIME_FIELDS,
  TARGET_FIELDS,
  verifyCompilerBuildPin,
  verifyCompilerBuildPinAgainstObservation,
  verifyCompilerPin,
  verifyProjectEvidenceRuntimeRevision,
  verifyProjectEvidenceRuntimeRevisionAgainstObservation,
  verifyProjectRuntime,
  verifyWorkerExecutionRuntimeRevision,
  verifyWorkerExecutionRuntimeRevisionAgainstObservation,
  verifyWorkerRuntime,
  verifyTargetSnapshotReceipt,
  verifyTargetSnapshotReceiptAgainstObservation,
  verifyTargetSnapshot,
  isCompilerBuildPinValid: (pin, observed) => isVerificationSuccessful(verifyCompilerBuildPin, pin, observed),
  isProjectEvidenceRuntimeRevisionValid: (pin, observed) => isVerificationSuccessful(verifyProjectEvidenceRuntimeRevision, pin, observed),
  isWorkerExecutionRuntimeRevisionValid: (pin, observed) => isVerificationSuccessful(verifyWorkerExecutionRuntimeRevision, pin, observed),
  isTargetSnapshotReceiptValid: (pin, observed) => isVerificationSuccessful(verifyTargetSnapshotReceipt, pin, observed),
};
