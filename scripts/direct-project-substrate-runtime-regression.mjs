#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
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
} = require(
  "../src/main/direct/worldmanager/project-substrate-runtime",
);
const {
  buildDirectWorkerContextPacket,
  validateDirectWorkerContextPacket,
} = require("../src/main/direct/bridge/worker-start");

const digest = (character) => `sha256:${character.repeat(64)}`;
const createdAt = "2026-07-31T15:00:00.000Z";
const projectId = "project_env1_contract";
const environmentId = "env_wsl_native";
const runtimeDefaultRef = {
  kind: "project_runtime_default_binding",
  id: "runtime_default_env1",
  digest: digest("1"),
};

const locator = buildProjectWorkspaceLocator({
  projectId,
  environmentId,
  workspaceKind: "wsl",
  nativeWorkspacePath: "/home/rose/work/env1-contract",
  distro: "Ubuntu",
  createdAt,
});
assert.equal(validateProjectWorkspaceLocator(locator), true);
assert.equal(locator.visibility, "backend_private");
assert.equal(locator.rendererProjectionAllowed, false);

const probe = buildEnvironmentProbeReceipt({
  projectId,
  environmentId,
  workspaceKind: "wsl",
  adapterKind: "direct_resident",
  probeState: "ready",
  nativePlatform: "linux",
  backendSessionId: "resident_env1_contract",
  processContinuityObserved: true,
  workspaceIdentityMatched: true,
  capabilityClasses: [
    "native_process",
    "resident_workspace_executor",
    "worker_runtime_binding",
  ],
  blockerCodes: [],
  observedAt: createdAt,
});
assert.equal(validateEnvironmentProbeReceipt(probe), true);
assert.equal(probe.workspaceMutationEffect, false);
assert.equal(probe.remoteMutationEffect, false);

const workspaceBinding = buildProjectWorkspaceBinding({
  projectId,
  runtimeDefaultBindingRef: runtimeDefaultRef,
  environmentId,
  workspaceKind: "wsl",
  workspaceLabel: "WSL Ubuntu project workspace",
  workspaceIdentityDigest: digest("2"),
  locatorRef: {
    kind: "project_workspace_locator",
    id: locator.locatorId,
    digest: locator.digest,
  },
  probeRef: environmentProbeRef(probe),
  adapterKind: "direct_resident",
  createdAt,
});
assert.equal(validateProjectWorkspaceBinding(workspaceBinding), true);
assert.equal(workspaceBinding.portOperationRequiredToChange, true);
assert.throws(
  () => buildProjectWorkspaceBinding({
    projectId,
    runtimeDefaultBindingRef: runtimeDefaultRef,
    environmentId,
    workspaceKind: "wsl",
    workspaceLabel: "/home/rose/work/env1-contract",
    workspaceIdentityDigest: digest("2"),
    locatorRef: {
      kind: "project_workspace_locator",
      id: locator.locatorId,
      digest: locator.digest,
    },
    probeRef: environmentProbeRef(probe),
    adapterKind: "direct_resident",
    createdAt,
  }),
  /world_manager_project_workspace_label_contains_raw_path/,
);

const parentBinding = buildThreadEnvironmentBinding({
  projectId,
  threadId: "manager_thread_env1",
  workThreadId: "work_thread_env1",
  projectRuntimeDefaultRef: runtimeDefaultRef,
  workspaceBindingRef: workspaceBindingRef(workspaceBinding),
  primaryEnvironmentId: environmentId,
  selectedEnvironmentIds: [environmentId],
  allowedEnvironmentIds: [
    environmentId,
    "env_windows_native",
  ],
  createdAt,
});
assert.equal(validateThreadEnvironmentBinding(parentBinding), true);
assert.equal(parentBinding.immutableForThreadLifetime, true);

const parentStep = buildStepEnvironmentSnapshot({
  threadEnvironmentBinding: parentBinding,
  stepId: "manager_step_env1",
  environmentObservations: [{
    environmentId,
    readiness: "ready",
    adapterKind: "direct_resident",
    capabilityClasses: probe.capabilityClasses,
    capabilityRootRefs: [],
    probeRef: environmentProbeRef(probe),
  }],
  observedAt: createdAt,
});
assert.equal(validateStepEnvironmentSnapshot(parentStep), true);
assert.deepEqual(parentStep.selectedEnvironmentIds, [environmentId]);

const inheritance = buildChildEnvironmentInheritance({
  parentStepEnvironmentSnapshot: parentStep,
  childThreadId: "worker_session_env1",
  createdAt: "2026-07-31T15:01:00.000Z",
});
assert.equal(validateChildEnvironmentInheritance(inheritance), true);
assert.deepEqual(
  inheritance.inheritedEnvironmentIds,
  parentStep.selectedEnvironmentIds,
);
assert.equal(inheritance.ambientProjectDefaultReevaluated, false);

const childBinding = buildThreadEnvironmentBinding({
  projectId,
  threadId: inheritance.childThreadId,
  workThreadId: "work_thread_env1",
  projectRuntimeDefaultRef: runtimeDefaultRef,
  workspaceBindingRef: workspaceBindingRef(workspaceBinding),
  primaryEnvironmentId: inheritance.primaryEnvironmentId,
  selectedEnvironmentIds: inheritance.inheritedEnvironmentIds,
  allowedEnvironmentIds: [
    environmentId,
    "env_windows_native",
  ],
  inheritedFromStepSnapshotRef:
    inheritance.parentStepEnvironmentSnapshotRef,
  createdAt: inheritance.createdAt,
});
assert.equal(validateThreadEnvironmentBinding(childBinding), true);
assert.deepEqual(
  childBinding.selectedEnvironmentIds,
  parentBinding.selectedEnvironmentIds,
);
assert.deepEqual(
  childBinding.inheritedFromStepSnapshotRef,
  stepEnvironmentSnapshotRef(parentStep),
);

const workerContext = buildDirectWorkerContextPacket({
  handoffPacket: {
    handoffPacketId: "handoff_env1",
    packetDigest: digest("3"),
    projectId,
    threadId: parentBinding.threadId,
    workThreadRef: {
      workThreadId: parentBinding.workThreadId,
    },
    selectedAgentClass: {
      agentClassId: "worker_env1",
      agentClassKind: "bounded_worker",
    },
    expectedOutputArtifactFamily: "implementation_result",
    contextRefs: [],
    requestRefs: [],
  },
  workerPrompt: "Implement the bounded ENV1 fixture.",
  threadEnvironmentBindingRef:
    threadEnvironmentBindingRef(parentBinding),
  stepEnvironmentSnapshotRef:
    stepEnvironmentSnapshotRef(parentStep),
  environmentSelection: {
    primaryEnvironmentId: parentStep.primaryEnvironmentId,
    selectedEnvironmentIds: parentStep.selectedEnvironmentIds,
  },
  createdAt,
});
assert.equal(validateDirectWorkerContextPacket(workerContext), true);
assert.equal(
  workerContext.environmentSelection.inheritancePosture,
  "exact_parent_step_snapshot",
);
assert.equal(workerContext.rawPathIncluded, false);
assert.throws(
  () => buildDirectWorkerContextPacket({
    handoffPacket: {
      handoffPacketId: "handoff_env1_invalid",
      packetDigest: digest("4"),
      projectId,
      threadId: parentBinding.threadId,
      workThreadRef: { workThreadId: parentBinding.workThreadId },
      selectedAgentClass: {
        agentClassId: "worker_env1",
        agentClassKind: "bounded_worker",
      },
    },
    workerPrompt: "Invalid environment order.",
    threadEnvironmentBindingRef:
      threadEnvironmentBindingRef(parentBinding),
    stepEnvironmentSnapshotRef:
      stepEnvironmentSnapshotRef(parentStep),
    environmentSelection: {
      primaryEnvironmentId: environmentId,
      selectedEnvironmentIds: [
        "env_windows_native",
        environmentId,
      ],
    },
    createdAt,
  }),
  /direct_worker_environment_binding_invalid/,
);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-project-substrate-runtime",
  proofs: {
    rawWorkspaceLocatorBackendPrivate: true,
    harmlessReadinessReceipt: true,
    projectBindingRequiresPortToChange: true,
    threadBindingImmutableForLifetime: true,
    stepSnapshotCapturesExactReadyEnvironments: true,
    childInheritsExactParentStepSnapshot: true,
    ambientProjectDefaultNotReevaluated: true,
    workerProviderContextCarriesOnlyTypedEnvironmentRefs: true,
    primaryEnvironmentOrderingFailsClosed: true,
  },
}, null, 2));
