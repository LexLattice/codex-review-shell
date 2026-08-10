"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const PROJECT_WORKSPACE_LOCATOR_SCHEMA =
  "direct_project_workspace_locator@1";
const PROJECT_WORKSPACE_BINDING_SCHEMA =
  "direct_project_workspace_binding@1";
const ENVIRONMENT_PROBE_RECEIPT_SCHEMA =
  "direct_environment_probe_receipt@1";
const THREAD_ENVIRONMENT_BINDING_SCHEMA =
  "direct_thread_environment_binding@1";
const STEP_ENVIRONMENT_SNAPSHOT_SCHEMA =
  "direct_step_environment_snapshot@1";
const CHILD_ENVIRONMENT_INHERITANCE_SCHEMA =
  "direct_child_environment_inheritance@1";

const WORKSPACE_KINDS = new Set([
  "wsl",
  "windows",
  "linux",
  "macos",
  "local",
  "remote",
]);
const ADAPTER_KINDS = new Set([
  "direct_resident",
  "direct_in_process",
  "upstream_exec_server",
]);
const PROBE_STATES = new Set([
  "ready",
  "degraded",
  "unavailable",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function required(value, label) {
  const result = text(value, "");
  if (!result) fail("world_manager_project_substrate_missing_string", label);
  return result;
}

function list(values, limit = 64) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))]
    .slice(0, limit);
}

function rendererSafeWorkspaceLabel(value) {
  const label = text(value, "Project workspace").slice(0, 180);
  if (
    /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(label) ||
    /[a-z]:\\/i.test(label)
  ) {
    fail("world_manager_project_workspace_label_contains_raw_path");
  }
  return label;
}

function environmentMatchesWorkspaceKind(environmentId, workspaceKind) {
  const expected = {
    env_wsl_native: ["wsl"],
    env_windows_native: ["windows"],
    env_linux_native: ["linux", "local"],
    env_macos_native: ["macos", "local"],
  }[environmentId];
  return !expected || expected.includes(workspaceKind);
}

function exactRef(input, label) {
  if (!isPlainObject(input)) {
    fail("world_manager_project_substrate_invalid_ref", label);
  }
  const result = {
    kind: required(input.kind, `${label}.kind`),
    id: required(input.id, `${label}.id`),
    digest: required(input.digest, `${label}.digest`),
  };
  if (!/^sha256:[a-f0-9]{64}$/i.test(result.digest)) {
    fail("world_manager_project_substrate_invalid_ref_digest", label);
  }
  return result;
}

function digestMatches(value, schema, field = "digest") {
  if (
    value[field] !==
      digestFor(schema, value, [field])
  ) {
    fail("world_manager_project_substrate_digest_mismatch", schema);
  }
}

function workspaceBindingRef(binding) {
  validateProjectWorkspaceBinding(binding);
  return {
    kind: "project_workspace_binding",
    id: binding.workspaceBindingId,
    digest: binding.digest,
  };
}

function environmentProbeRef(receipt) {
  validateEnvironmentProbeReceipt(receipt);
  return {
    kind: "environment_probe_receipt",
    id: receipt.probeReceiptId,
    digest: receipt.digest,
  };
}

function threadEnvironmentBindingRef(binding) {
  validateThreadEnvironmentBinding(binding);
  return {
    kind: "thread_environment_binding",
    id: binding.threadEnvironmentBindingId,
    digest: binding.digest,
  };
}

function stepEnvironmentSnapshotRef(snapshot) {
  validateStepEnvironmentSnapshot(snapshot);
  return {
    kind: "step_environment_snapshot",
    id: snapshot.stepEnvironmentSnapshotId,
    digest: snapshot.digest,
  };
}

function buildProjectWorkspaceLocator(input = {}) {
  const projectId = required(input.projectId, "projectWorkspaceLocator.projectId");
  const environmentId = required(
    input.environmentId,
    "projectWorkspaceLocator.environmentId",
  );
  const nativeWorkspacePath = required(
    input.nativeWorkspacePath,
    "projectWorkspaceLocator.nativeWorkspacePath",
  );
  const workspaceKind = WORKSPACE_KINDS.has(input.workspaceKind)
    ? input.workspaceKind
    : "local";
  const locator = {
    schema: PROJECT_WORKSPACE_LOCATOR_SCHEMA,
    locatorId: text(
      input.locatorId,
      stableId("project_workspace_locator", {
        projectId,
        environmentId,
        nativeWorkspacePath,
      }),
    ),
    projectId,
    environmentId,
    workspaceKind,
    nativeWorkspacePath,
    distro: text(input.distro, ""),
    windowsNodePath: text(input.windowsNodePath, ""),
    visibility: "backend_private",
    semanticAuthority: "none",
    rendererProjectionAllowed: false,
    createdAt: required(input.createdAt, "projectWorkspaceLocator.createdAt"),
  };
  locator.digest = digestFor(
    PROJECT_WORKSPACE_LOCATOR_SCHEMA,
    locator,
    ["digest"],
  );
  validateProjectWorkspaceLocator(locator);
  return locator;
}

function validateProjectWorkspaceLocator(locator) {
  if (
    !isPlainObject(locator) ||
    locator.schema !== PROJECT_WORKSPACE_LOCATOR_SCHEMA ||
    !WORKSPACE_KINDS.has(locator.workspaceKind) ||
    locator.visibility !== "backend_private" ||
    locator.semanticAuthority !== "none" ||
    locator.rendererProjectionAllowed !== false
  ) {
    fail("world_manager_project_workspace_locator_invalid");
  }
  required(locator.locatorId, "projectWorkspaceLocator.locatorId");
  required(locator.projectId, "projectWorkspaceLocator.projectId");
  required(locator.environmentId, "projectWorkspaceLocator.environmentId");
  required(
    locator.nativeWorkspacePath,
    "projectWorkspaceLocator.nativeWorkspacePath",
  );
  if (!environmentMatchesWorkspaceKind(
    locator.environmentId,
    locator.workspaceKind,
  )) {
    fail("world_manager_project_workspace_environment_kind_mismatch");
  }
  digestMatches(locator, PROJECT_WORKSPACE_LOCATOR_SCHEMA);
  return true;
}

function buildEnvironmentProbeReceipt(input = {}) {
  const projectId = required(input.projectId, "environmentProbe.projectId");
  const environmentId = required(
    input.environmentId,
    "environmentProbe.environmentId",
  );
  const probeState = PROBE_STATES.has(input.probeState)
    ? input.probeState
    : "unavailable";
  const receipt = {
    schema: ENVIRONMENT_PROBE_RECEIPT_SCHEMA,
    probeReceiptId: text(
      input.probeReceiptId,
      stableId("environment_probe", {
        projectId,
        environmentId,
        backendSessionId: input.backendSessionId,
        observedAt: input.observedAt,
      }),
    ),
    projectId,
    environmentId,
    workspaceKind: WORKSPACE_KINDS.has(input.workspaceKind)
      ? input.workspaceKind
      : "local",
    adapterKind: ADAPTER_KINDS.has(input.adapterKind)
      ? input.adapterKind
      : "direct_resident",
    probeState,
    nativePlatform: required(
      input.nativePlatform,
      "environmentProbe.nativePlatform",
    ),
    backendSessionRef: {
      kind: "resident_backend_session",
      id: required(
        input.backendSessionId,
        "environmentProbe.backendSessionId",
      ),
      digest: digestFor("direct-resident-backend-session-ref@1", {
        projectId,
        environmentId,
        backendSessionId: input.backendSessionId,
        nativePlatform: input.nativePlatform,
      }),
    },
    processContinuityObserved: input.processContinuityObserved === true,
    workspaceIdentityMatched: input.workspaceIdentityMatched === true,
    capabilityClasses: list(input.capabilityClasses, 128).sort(),
    blockerCodes: list(input.blockerCodes, 32).sort(),
    observedAt: required(input.observedAt, "environmentProbe.observedAt"),
    executionAuthority: "probe_only",
    workspaceMutationEffect: false,
    remoteMutationEffect: false,
    canonicalAdmissionEffect: false,
    rawPathIncluded: false,
    rawOutputIncluded: false,
    grantsAuthority: false,
  };
  receipt.digest = digestFor(
    ENVIRONMENT_PROBE_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateEnvironmentProbeReceipt(receipt);
  return receipt;
}

function validateEnvironmentProbeReceipt(receipt) {
  if (
    !isPlainObject(receipt) ||
    receipt.schema !== ENVIRONMENT_PROBE_RECEIPT_SCHEMA ||
    !PROBE_STATES.has(receipt.probeState) ||
    !WORKSPACE_KINDS.has(receipt.workspaceKind) ||
    !ADAPTER_KINDS.has(receipt.adapterKind) ||
    !Array.isArray(receipt.capabilityClasses) ||
    !Array.isArray(receipt.blockerCodes) ||
    receipt.executionAuthority !== "probe_only" ||
    receipt.workspaceMutationEffect !== false ||
    receipt.remoteMutationEffect !== false ||
    receipt.canonicalAdmissionEffect !== false ||
    receipt.rawPathIncluded !== false ||
    receipt.rawOutputIncluded !== false ||
    receipt.grantsAuthority !== false ||
    receipt.backendSessionRef?.kind !== "resident_backend_session"
  ) {
    fail("world_manager_environment_probe_receipt_invalid");
  }
  exactRef(receipt.backendSessionRef, "environmentProbe.backendSessionRef");
  if (!environmentMatchesWorkspaceKind(
    receipt.environmentId,
    receipt.workspaceKind,
  )) {
    fail("world_manager_environment_probe_workspace_kind_mismatch");
  }
  if (
    receipt.probeState === "ready" &&
    (
      receipt.workspaceIdentityMatched !== true ||
      !receipt.capabilityClasses.length ||
      receipt.blockerCodes.length
    )
  ) {
    fail("world_manager_environment_probe_ready_without_evidence");
  }
  digestMatches(receipt, ENVIRONMENT_PROBE_RECEIPT_SCHEMA);
  return true;
}

function buildProjectWorkspaceBinding(input = {}) {
  const runtimeDefaultBindingRef = exactRef(
    input.runtimeDefaultBindingRef,
    "projectWorkspaceBinding.runtimeDefaultBindingRef",
  );
  const locatorRef = exactRef(
    input.locatorRef,
    "projectWorkspaceBinding.locatorRef",
  );
  const probeRef = exactRef(
    input.probeRef,
    "projectWorkspaceBinding.probeRef",
  );
  const projectId = required(input.projectId, "projectWorkspaceBinding.projectId");
  const environmentId = required(
    input.environmentId,
    "projectWorkspaceBinding.environmentId",
  );
  const workspaceIdentityDigest = required(
    input.workspaceIdentityDigest,
    "projectWorkspaceBinding.workspaceIdentityDigest",
  );
  if (!/^sha256:[a-f0-9]{64}$/i.test(workspaceIdentityDigest)) {
    fail("world_manager_project_workspace_identity_digest_invalid");
  }
  const binding = {
    schema: PROJECT_WORKSPACE_BINDING_SCHEMA,
    workspaceBindingId: text(
      input.workspaceBindingId,
      stableId("project_workspace_binding", {
        projectId,
        runtimeDefaultBindingRef,
        environmentId,
        workspaceIdentityDigest,
      }),
    ),
    projectId,
    runtimeDefaultBindingRef,
    environmentId,
    workspaceKind: WORKSPACE_KINDS.has(input.workspaceKind)
      ? input.workspaceKind
      : "local",
    workspaceLabel: rendererSafeWorkspaceLabel(input.workspaceLabel),
    workspaceIdentityDigest,
    locatorRef,
    probeRef,
    adapterKind: ADAPTER_KINDS.has(input.adapterKind)
      ? input.adapterKind
      : "direct_resident",
    adapterAuthority: "execution_only",
    provisioningState: "provisioned",
    bindingRevision: 1,
    portOperationRequiredToChange: true,
    canonical: true,
    rawPathIncluded: false,
    grantsAuthority: false,
    createdAt: required(input.createdAt, "projectWorkspaceBinding.createdAt"),
  };
  binding.digest = digestFor(
    PROJECT_WORKSPACE_BINDING_SCHEMA,
    binding,
    ["digest"],
  );
  validateProjectWorkspaceBinding(binding);
  return binding;
}

function validateProjectWorkspaceBinding(binding) {
  if (
    !isPlainObject(binding) ||
    binding.schema !== PROJECT_WORKSPACE_BINDING_SCHEMA ||
    !WORKSPACE_KINDS.has(binding.workspaceKind) ||
    !ADAPTER_KINDS.has(binding.adapterKind) ||
    binding.adapterAuthority !== "execution_only" ||
    binding.provisioningState !== "provisioned" ||
    binding.bindingRevision !== 1 ||
    binding.portOperationRequiredToChange !== true ||
    binding.canonical !== true ||
    binding.rawPathIncluded !== false ||
    binding.grantsAuthority !== false ||
    binding.runtimeDefaultBindingRef?.kind !==
      "project_runtime_default_binding" ||
    binding.locatorRef?.kind !== "project_workspace_locator" ||
    binding.probeRef?.kind !== "environment_probe_receipt"
  ) {
    fail("world_manager_project_workspace_binding_invalid");
  }
  exactRef(
    binding.runtimeDefaultBindingRef,
    "projectWorkspaceBinding.runtimeDefaultBindingRef",
  );
  exactRef(binding.locatorRef, "projectWorkspaceBinding.locatorRef");
  exactRef(binding.probeRef, "projectWorkspaceBinding.probeRef");
  rendererSafeWorkspaceLabel(binding.workspaceLabel);
  if (!environmentMatchesWorkspaceKind(
    binding.environmentId,
    binding.workspaceKind,
  )) {
    fail("world_manager_project_workspace_binding_kind_mismatch");
  }
  digestMatches(binding, PROJECT_WORKSPACE_BINDING_SCHEMA);
  return true;
}

function buildThreadEnvironmentBinding(input = {}) {
  const projectRuntimeDefaultRef = exactRef(
    input.projectRuntimeDefaultRef,
    "threadEnvironmentBinding.projectRuntimeDefaultRef",
  );
  const workspaceRef = exactRef(
    input.workspaceBindingRef,
    "threadEnvironmentBinding.workspaceBindingRef",
  );
  const projectId = required(input.projectId, "threadEnvironmentBinding.projectId");
  const threadId = required(input.threadId, "threadEnvironmentBinding.threadId");
  const primaryEnvironmentId = required(
    input.primaryEnvironmentId,
    "threadEnvironmentBinding.primaryEnvironmentId",
  );
  const allowedEnvironmentIds = list(input.allowedEnvironmentIds, 32);
  if (!allowedEnvironmentIds.includes(primaryEnvironmentId)) {
    allowedEnvironmentIds.unshift(primaryEnvironmentId);
  }
  const selectedEnvironmentIds = list(
    input.selectedEnvironmentIds?.length
      ? input.selectedEnvironmentIds
      : [primaryEnvironmentId],
    32,
  );
  if (selectedEnvironmentIds[0] !== primaryEnvironmentId) {
    selectedEnvironmentIds.splice(
      selectedEnvironmentIds.indexOf(primaryEnvironmentId),
      1,
    );
    selectedEnvironmentIds.unshift(primaryEnvironmentId);
  }
  if (selectedEnvironmentIds.some((id) => !allowedEnvironmentIds.includes(id))) {
    fail("world_manager_thread_environment_not_allowed");
  }
  const binding = {
    schema: THREAD_ENVIRONMENT_BINDING_SCHEMA,
    threadEnvironmentBindingId: text(
      input.threadEnvironmentBindingId,
      stableId("thread_environment_binding", {
        projectId,
        threadId,
        projectRuntimeDefaultRef,
        workspaceRef,
      }),
    ),
    projectId,
    threadId,
    workThreadId: text(input.workThreadId, ""),
    projectRuntimeDefaultRef,
    workspaceBindingRef: workspaceRef,
    primaryEnvironmentId,
    selectedEnvironmentIds,
    allowedEnvironmentIds,
    inheritanceRule:
      "new_child_threads_inherit_exact_parent_step_environments",
    bindingState: "bound",
    immutableForThreadLifetime: true,
    projectPortMutatesExistingThread: false,
    canonical: true,
    rawPathIncluded: false,
    grantsAuthority: false,
    createdAt: required(input.createdAt, "threadEnvironmentBinding.createdAt"),
  };
  if (input.inheritedFromStepSnapshotRef) {
    binding.inheritedFromStepSnapshotRef = exactRef(
      input.inheritedFromStepSnapshotRef,
      "threadEnvironmentBinding.inheritedFromStepSnapshotRef",
    );
  }
  binding.digest = digestFor(
    THREAD_ENVIRONMENT_BINDING_SCHEMA,
    binding,
    ["digest"],
  );
  validateThreadEnvironmentBinding(binding);
  return binding;
}

function validateThreadEnvironmentBinding(binding) {
  if (
    !isPlainObject(binding) ||
    binding.schema !== THREAD_ENVIRONMENT_BINDING_SCHEMA ||
    !Array.isArray(binding.selectedEnvironmentIds) ||
    !binding.selectedEnvironmentIds.length ||
    binding.selectedEnvironmentIds[0] !== binding.primaryEnvironmentId ||
    !Array.isArray(binding.allowedEnvironmentIds) ||
    binding.selectedEnvironmentIds.some((id) =>
      !binding.allowedEnvironmentIds.includes(id)) ||
    binding.inheritanceRule !==
      "new_child_threads_inherit_exact_parent_step_environments" ||
    binding.bindingState !== "bound" ||
    binding.immutableForThreadLifetime !== true ||
    binding.projectPortMutatesExistingThread !== false ||
    binding.canonical !== true ||
    binding.rawPathIncluded !== false ||
    binding.grantsAuthority !== false ||
    binding.projectRuntimeDefaultRef?.kind !==
      "project_runtime_default_binding" ||
    binding.workspaceBindingRef?.kind !==
      "project_workspace_binding" ||
    (binding.inheritedFromStepSnapshotRef &&
      binding.inheritedFromStepSnapshotRef.kind !==
        "step_environment_snapshot")
  ) {
    fail("world_manager_thread_environment_binding_invalid");
  }
  exactRef(
    binding.projectRuntimeDefaultRef,
    "threadEnvironmentBinding.projectRuntimeDefaultRef",
  );
  exactRef(
    binding.workspaceBindingRef,
    "threadEnvironmentBinding.workspaceBindingRef",
  );
  if (binding.inheritedFromStepSnapshotRef) {
    exactRef(
      binding.inheritedFromStepSnapshotRef,
      "threadEnvironmentBinding.inheritedFromStepSnapshotRef",
    );
  }
  digestMatches(binding, THREAD_ENVIRONMENT_BINDING_SCHEMA);
  return true;
}

function buildStepEnvironmentSnapshot(input = {}) {
  const threadBinding = input.threadEnvironmentBinding;
  validateThreadEnvironmentBinding(threadBinding);
  const observations = (Array.isArray(input.environmentObservations)
    ? input.environmentObservations
    : []).map((observation) => ({
      environmentId: required(
        observation.environmentId,
        "stepEnvironmentSnapshot.environmentId",
      ),
      readiness: PROBE_STATES.has(observation.readiness)
        ? observation.readiness
        : "unavailable",
      adapterKind: ADAPTER_KINDS.has(observation.adapterKind)
        ? observation.adapterKind
        : "direct_resident",
      capabilityClasses: list(observation.capabilityClasses, 128).sort(),
      capabilityRootRefs: (Array.isArray(observation.capabilityRootRefs)
        ? observation.capabilityRootRefs
        : []).map((ref, index) =>
        exactRef(ref, `stepEnvironmentSnapshot.capabilityRootRefs.${index}`)),
      probeRef: exactRef(
        observation.probeRef,
        "stepEnvironmentSnapshot.probeRef",
      ),
      primary:
        observation.environmentId === threadBinding.primaryEnvironmentId,
    }));
  const selected = threadBinding.selectedEnvironmentIds.map((environmentId) =>
    observations.find((entry) => entry.environmentId === environmentId) || {
      environmentId,
      readiness: "unavailable",
      adapterKind: "direct_resident",
      capabilityClasses: [],
      capabilityRootRefs: [],
      probeRef: null,
      primary: environmentId === threadBinding.primaryEnvironmentId,
    });
  const primary = selected[0];
  if (
    !primary ||
    primary.environmentId !== threadBinding.primaryEnvironmentId ||
    primary.readiness !== "ready" ||
    !primary.probeRef
  ) {
    fail("world_manager_step_primary_environment_not_ready");
  }
  const readyEnvironments = selected.filter((entry) => entry.readiness === "ready");
  const snapshot = {
    schema: STEP_ENVIRONMENT_SNAPSHOT_SCHEMA,
    stepEnvironmentSnapshotId: text(
      input.stepEnvironmentSnapshotId,
      stableId("step_environment_snapshot", {
        threadEnvironmentBindingDigest: threadBinding.digest,
        stepId: input.stepId,
        observationRefs: readyEnvironments.map((entry) => entry.probeRef),
      }),
    ),
    projectId: threadBinding.projectId,
    threadId: threadBinding.threadId,
    workThreadId: threadBinding.workThreadId,
    stepId: required(input.stepId, "stepEnvironmentSnapshot.stepId"),
    threadEnvironmentBindingRef: threadEnvironmentBindingRef(threadBinding),
    primaryEnvironmentId: threadBinding.primaryEnvironmentId,
    readyEnvironments,
    selectedEnvironmentIds: readyEnvironments.map((entry) => entry.environmentId),
    readinessState:
      readyEnvironments.length === threadBinding.selectedEnvironmentIds.length
        ? "ready"
        : "degraded",
    childInheritanceEligible: true,
    snapshotPosture: "exact_ready_step_environments",
    rawPathIncluded: false,
    grantsAuthority: false,
    observedAt: required(input.observedAt, "stepEnvironmentSnapshot.observedAt"),
  };
  snapshot.digest = digestFor(
    STEP_ENVIRONMENT_SNAPSHOT_SCHEMA,
    snapshot,
    ["digest"],
  );
  validateStepEnvironmentSnapshot(snapshot);
  return snapshot;
}

function validateStepEnvironmentSnapshot(snapshot) {
  if (
    !isPlainObject(snapshot) ||
    snapshot.schema !== STEP_ENVIRONMENT_SNAPSHOT_SCHEMA ||
    !Array.isArray(snapshot.readyEnvironments) ||
    !snapshot.readyEnvironments.length ||
    snapshot.readyEnvironments[0].environmentId !==
      snapshot.primaryEnvironmentId ||
    snapshot.readyEnvironments[0].primary !== true ||
    snapshot.readyEnvironments.some((entry) =>
      entry.readiness !== "ready" || !entry.probeRef) ||
    !Array.isArray(snapshot.selectedEnvironmentIds) ||
    snapshot.selectedEnvironmentIds.join("\0") !==
      snapshot.readyEnvironments.map((entry) => entry.environmentId).join("\0") ||
    !["ready", "degraded"].includes(snapshot.readinessState) ||
    snapshot.childInheritanceEligible !== true ||
    snapshot.snapshotPosture !== "exact_ready_step_environments" ||
    snapshot.rawPathIncluded !== false ||
    snapshot.grantsAuthority !== false ||
    snapshot.threadEnvironmentBindingRef?.kind !==
      "thread_environment_binding" ||
    snapshot.readyEnvironments.some((entry) =>
      entry.probeRef?.kind !== "environment_probe_receipt")
  ) {
    fail("world_manager_step_environment_snapshot_invalid");
  }
  exactRef(
    snapshot.threadEnvironmentBindingRef,
    "stepEnvironmentSnapshot.threadEnvironmentBindingRef",
  );
  snapshot.readyEnvironments.forEach((entry, index) => {
    exactRef(entry.probeRef, `stepEnvironmentSnapshot.readyEnvironments.${index}.probeRef`);
    (entry.capabilityRootRefs || []).forEach((ref, refIndex) =>
      exactRef(
        ref,
        `stepEnvironmentSnapshot.readyEnvironments.${index}.capabilityRootRefs.${refIndex}`,
      ));
  });
  digestMatches(snapshot, STEP_ENVIRONMENT_SNAPSHOT_SCHEMA);
  return true;
}

function buildChildEnvironmentInheritance(input = {}) {
  const parentSnapshot = input.parentStepEnvironmentSnapshot;
  validateStepEnvironmentSnapshot(parentSnapshot);
  const childThreadId = required(
    input.childThreadId,
    "childEnvironmentInheritance.childThreadId",
  );
  const inheritance = {
    schema: CHILD_ENVIRONMENT_INHERITANCE_SCHEMA,
    inheritanceId: text(
      input.inheritanceId,
      stableId("child_environment_inheritance", {
        parentStepEnvironmentSnapshotRef:
          stepEnvironmentSnapshotRef(parentSnapshot),
        childThreadId,
      }),
    ),
    projectId: parentSnapshot.projectId,
    parentThreadId: parentSnapshot.threadId,
    parentStepId: parentSnapshot.stepId,
    parentStepEnvironmentSnapshotRef:
      stepEnvironmentSnapshotRef(parentSnapshot),
    childThreadId,
    primaryEnvironmentId: parentSnapshot.primaryEnvironmentId,
    inheritedEnvironmentIds: [...parentSnapshot.selectedEnvironmentIds],
    inheritanceMode: "exact_parent_step_snapshot",
    ambientProjectDefaultReevaluated: false,
    canonicalWorldstateMutation: false,
    rawPathIncluded: false,
    grantsAuthority: false,
    createdAt: required(input.createdAt, "childEnvironmentInheritance.createdAt"),
  };
  inheritance.digest = digestFor(
    CHILD_ENVIRONMENT_INHERITANCE_SCHEMA,
    inheritance,
    ["digest"],
  );
  validateChildEnvironmentInheritance(inheritance);
  return inheritance;
}

function validateChildEnvironmentInheritance(inheritance) {
  if (
    !isPlainObject(inheritance) ||
    inheritance.schema !== CHILD_ENVIRONMENT_INHERITANCE_SCHEMA ||
    !Array.isArray(inheritance.inheritedEnvironmentIds) ||
    !inheritance.inheritedEnvironmentIds.length ||
    inheritance.inheritedEnvironmentIds[0] !==
      inheritance.primaryEnvironmentId ||
    inheritance.inheritanceMode !== "exact_parent_step_snapshot" ||
    inheritance.ambientProjectDefaultReevaluated !== false ||
    inheritance.canonicalWorldstateMutation !== false ||
    inheritance.rawPathIncluded !== false ||
    inheritance.grantsAuthority !== false ||
    inheritance.parentStepEnvironmentSnapshotRef?.kind !==
      "step_environment_snapshot"
  ) {
    fail("world_manager_child_environment_inheritance_invalid");
  }
  exactRef(
    inheritance.parentStepEnvironmentSnapshotRef,
    "childEnvironmentInheritance.parentStepEnvironmentSnapshotRef",
  );
  digestMatches(inheritance, CHILD_ENVIRONMENT_INHERITANCE_SCHEMA);
  return true;
}

module.exports = {
  CHILD_ENVIRONMENT_INHERITANCE_SCHEMA,
  ENVIRONMENT_PROBE_RECEIPT_SCHEMA,
  PROJECT_WORKSPACE_BINDING_SCHEMA,
  PROJECT_WORKSPACE_LOCATOR_SCHEMA,
  STEP_ENVIRONMENT_SNAPSHOT_SCHEMA,
  THREAD_ENVIRONMENT_BINDING_SCHEMA,
  buildChildEnvironmentInheritance,
  buildEnvironmentProbeReceipt,
  buildProjectWorkspaceBinding,
  buildProjectWorkspaceLocator,
  buildStepEnvironmentSnapshot,
  buildThreadEnvironmentBinding,
  environmentProbeRef,
  stepEnvironmentSnapshotRef,
  threadEnvironmentBindingRef,
  validateChildEnvironmentInheritance,
  validateEnvironmentProbeReceipt,
  validateProjectWorkspaceBinding,
  validateProjectWorkspaceLocator,
  validateStepEnvironmentSnapshot,
  validateThreadEnvironmentBinding,
  workspaceBindingRef,
};
