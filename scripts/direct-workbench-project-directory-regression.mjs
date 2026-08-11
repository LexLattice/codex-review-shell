#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
  assertDirectWorkbenchProjectDirectoryRendererSafe,
  buildDirectWorkbenchProjectActivationReceipt,
  buildDirectWorkbenchProjectBindingDraft,
  buildDirectWorkbenchProjectBindingReceipt,
  buildDirectWorkbenchProjectDirectory,
  resolveDirectWorkbenchProjectBindingReplay,
  resolveDirectWorkbenchProjectActivationReplay,
  validateDirectWorkbenchProjectBindingMutation,
  validateDirectWorkbenchProjectActivation,
} = require("../src/main/direct/project/project-directory.js");
const {
  alignCodexHostRuntimeWithWorkspace,
} = require("../src/main/direct/runtime/runtime-path-selection.js");

function project({ id, name, workspace, codex, laneBindings = [] }) {
  return {
    id,
    name,
    repoPath: workspace.linuxPath || workspace.windowsPath || workspace.localPath,
    workspace,
    surfaceBinding: {
      codex: {
        mode: "managed",
        binaryPath: "/private/bin/codex",
        remoteAuth: { token: "private-token" },
        ...codex,
      },
    },
    laneBindings,
  };
}

const config = {
  selectedProjectId: "project_wsl",
  projects: [
    project({
      id: "project_wsl",
      name: "WSL implementation",
      workspace: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/rose/private/wsl-project",
        label: "/home/rose/private/wsl-project",
      },
      codex: {
        runtimeMode: "legacy-app-server",
        directTransport: "fixture",
        directTier: "none",
      },
      laneBindings: [{
        openOnProjectActivate: true,
        codexThreadRef: {
          threadId: "provider-thread-private",
          sourceHome: "/home/rose/.codex",
          sessionFilePath: "/home/rose/.codex/sessions/private.jsonl",
        },
      }],
    }),
    project({
      id: "project_windows",
      name: "Windows context menu at C:\\Users\\Rose\\private-windows-project",
      workspace: {
        kind: "windows",
        windowsPath: "C:\\Users\\Rose\\private-windows-project",
        windowsNodePath: "C:\\Program Files\\nodejs\\node.exe",
        label: "Windows native workspace",
      },
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "text-only",
      },
      laneBindings: [{
        id: "binding_windows_default",
        openOnProjectActivate: true,
        codexThreadRef: {
          threadId: "windows-provider-thread-private",
          sourceHome: "C:\\Users\\Rose\\.codex",
          sessionFilePath: "C:\\Users\\Rose\\.codex\\sessions\\private.jsonl",
        },
      }],
    }),
    project({
      id: "project_local",
      name: "Local fixture",
      workspace: {
        kind: "local",
        localPath: "/tmp/private-local-project",
        label: "Local test workspace",
      },
      codex: {
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "implementation-lane",
      },
    }),
  ],
};

const directory = buildDirectWorkbenchProjectDirectory(config, {
  generatedAt: "2026-08-11T08:00:00.000Z",
  activeTurnCounts: {},
});
assert.equal(directory.schema, DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA);
assert.equal(directory.activeProjectId, "project_wsl");
assert.equal(directory.projectCount, 3);
assert.equal(directory.projects[0].state, "active");
assert.equal(directory.projects[0].substrate.displayLabel, "WSL workspace");
assert.equal(directory.projects[0].runtime.runtimePath, "app-server");
assert.equal(directory.projects[0].restore.available, true);
assert.equal(directory.projects[1].substrate.workspaceKind, "windows");
assert.equal(directory.projects[1].displayName, "Unnamed project");
assert.equal(directory.projects[1].runtime.runtimePath, "direct-text");
assert.equal(directory.projects[1].restore.available, true);
assert.equal(directory.projects[1].selectable, true);
assert.equal(directory.projects[2].substrate.workspaceKind, "local");
assert.equal(directory.projects[2].runtime.runtimePath, "direct-implementation");
assert.equal(directory.authorityBoundary.rendererMayMutateConfig, false);
assert.equal(directory.authorityBoundary.worldManagerStateAffected, false);
assert.equal(assertDirectWorkbenchProjectDirectoryRendererSafe(directory), true);

const serialized = JSON.stringify(directory);
for (const secret of [
  "/home/rose/private/wsl-project",
  "C:\\Users\\Rose\\private-windows-project",
  "/tmp/private-local-project",
  "provider-thread-private",
  "windows-provider-thread-private",
  "/home/rose/.codex/sessions/private.jsonl",
  "private-token",
  "Windows context menu at C:\\Users\\Rose\\private-windows-project",
]) {
  assert.equal(serialized.includes(secret), false, `renderer projection leaked ${secret}`);
}

const sameDirectoryDifferentTime = buildDirectWorkbenchProjectDirectory(config, {
  generatedAt: "2026-08-11T09:00:00.000Z",
  activeTurnCounts: {},
});
assert.equal(sameDirectoryDifferentTime.catalogRevision, directory.catalogRevision);

for (const mutatePrivateAuthority of [
  (next) => { next.projects[1].workspace.windowsPath = "D:\\private-relocated-workspace"; },
  (next) => { next.projects[1].surfaceBinding.codex.remoteAuth.token = "rotated-private-token"; },
  (next) => { next.projects[1].laneBindings[0].codexThreadRef.threadId = "different-private-thread"; },
]) {
  const changedConfig = structuredClone(config);
  mutatePrivateAuthority(changedConfig);
  const changedDirectory = buildDirectWorkbenchProjectDirectory(changedConfig, {
    generatedAt: "2026-08-11T08:00:00.000Z",
    activeTurnCounts: {},
  });
  assert.deepEqual(changedDirectory.projects, directory.projects);
  assert.notEqual(changedDirectory.catalogRevision, directory.catalogRevision);
  assert.throws(
    () => validateDirectWorkbenchProjectActivation(changedDirectory, {
      clientActivationId: "client_stale_private_authority",
      sourceProjectId: "project_wsl",
      targetProjectId: "project_windows",
      expectedCatalogRevision: directory.catalogRevision,
    }),
    (error) => error?.code === "project_catalog_revision_stale",
  );
}

const accepted = validateDirectWorkbenchProjectActivation(directory, {
  clientActivationId: "client_switch_windows",
  sourceProjectId: "project_wsl",
  targetProjectId: "project_windows",
  expectedCatalogRevision: directory.catalogRevision,
});
assert.match(accepted.activationId, /^project_activation_[a-f0-9]{24}$/);

assert.throws(
  () => validateDirectWorkbenchProjectActivation(directory, {
    ...accepted,
    expectedCatalogRevision: "stale",
  }),
  (error) => error?.code === "project_catalog_revision_stale",
);
assert.throws(
  () => validateDirectWorkbenchProjectActivation(directory, {
    ...accepted,
    targetProjectId: "project_unknown",
  }),
  (error) => error?.code === "project_activation_target_unknown",
);

const busyDirectory = buildDirectWorkbenchProjectDirectory(config, {
  activeTurnCounts: { project_wsl: 1 },
});
assert.equal(busyDirectory.projects[1].selectable, false);
assert(busyDirectory.projects[1].blockerCodes.includes("active_turn_in_current_project"));
assert.throws(
  () => validateDirectWorkbenchProjectActivation(busyDirectory, {
    clientActivationId: "client_busy",
    sourceProjectId: "project_wsl",
    targetProjectId: "project_windows",
    expectedCatalogRevision: busyDirectory.catalogRevision,
  }),
  (error) => error?.code === "active_turn_in_current_project",
);

const transitioningDirectory = buildDirectWorkbenchProjectDirectory(config, {
  transition: {
    state: "activating",
    activationId: "project_activation_fixture",
    sourceProjectId: "project_wsl",
    targetProjectId: "project_windows",
  },
});
assert.equal(transitioningDirectory.projects[1].state, "activating");
assert.equal(transitioningDirectory.projects[1].selectable, false);
assert.throws(
  () => validateDirectWorkbenchProjectActivation(transitioningDirectory, {
    clientActivationId: "client_concurrent",
    sourceProjectId: "project_wsl",
    targetProjectId: "project_local",
    expectedCatalogRevision: transitioningDirectory.catalogRevision,
  }),
  (error) => error?.code === "project_activation_in_progress",
);

const receipt = buildDirectWorkbenchProjectActivationReceipt({
  ...accepted,
  ok: true,
  status: "accepted",
  acceptedAt: "2026-08-11T08:05:00.000Z",
});
assert.equal(receipt.ok, true);
assert.equal(receipt.status, "accepted");
assert.equal(receipt.rawPathExposed, false);
assert.equal(JSON.stringify(receipt).includes("private"), false);

const completedReceipt = buildDirectWorkbenchProjectActivationReceipt({
  ...accepted,
  ok: true,
  status: "completed",
  completedAt: "2026-08-11T08:06:00.000Z",
});
const operations = new Map([[
  accepted.clientActivationId,
  { ...accepted, receipt: completedReceipt },
]]);
const postCompletionReplay = resolveDirectWorkbenchProjectActivationReplay(
  operations,
  accepted.targetProjectId,
  accepted,
);
assert.equal(postCompletionReplay.status, "completed");
assert.equal(postCompletionReplay.duplicate, true);
assert.throws(
  () => resolveDirectWorkbenchProjectActivationReplay(
    operations,
    accepted.targetProjectId,
    { ...accepted, targetProjectId: "project_local" },
  ),
  (error) => error?.code === "client_activation_id_reused",
);
assert.throws(
  () => resolveDirectWorkbenchProjectActivationReplay(
    operations,
    "project_local",
    accepted,
  ),
  (error) => error?.code === "project_activation_source_stale",
);

const editDraft = buildDirectWorkbenchProjectBindingDraft(config, {
  sourceProjectId: "project_wsl",
  projectId: "project_windows",
  catalogRevision: directory.catalogRevision,
});
assert.equal(editDraft.schema, "direct_workbench_project_binding_draft@1");
assert.equal(editDraft.mode, "edit");
assert.equal(editDraft.projectId, "project_windows");
assert.equal(editDraft.fields.workspace.kind, "windows");
assert.equal(editDraft.fields.workspace.windowsPath, "C:\\Users\\Rose\\private-windows-project");
assert.equal(editDraft.fields.runtimePath, "direct-text");
assert.equal(editDraft.authorityBoundary.rendererMayAssignProjectIdentity, false);
assert.equal(editDraft.authorityBoundary.rendererMayPersistConfig, false);
assert.equal(JSON.stringify(editDraft).includes("private-token"), false);
assert.equal(JSON.stringify(editDraft).includes("/private/bin/codex"), false);

const createDraft = buildDirectWorkbenchProjectBindingDraft(config, {
  sourceProjectId: "project_wsl",
  catalogRevision: directory.catalogRevision,
  defaults: {
    displayName: "New bounded project",
    workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/rose/work/new-project", label: "New WSL project" },
    codexBinding: { runtimeMode: "legacy-app-server" },
  },
});
assert.equal(createDraft.mode, "create");
assert.equal(createDraft.projectId, "");
assert.equal(createDraft.evidence.projectIdentityAssignedByMain, true);

const editMutation = validateDirectWorkbenchProjectBindingMutation(directory, config, {
  clientMutationId: "client_edit_windows",
  mode: "edit",
  sourceProjectId: "project_wsl",
  projectId: "project_windows",
  expectedCatalogRevision: directory.catalogRevision,
  expectedProjectRevision: editDraft.expectedProjectRevision,
  fields: {
    displayName: "Windows context menu",
    workspace: {
      kind: "windows",
      windowsPath: "D:\\Work\\windows-context-menu",
      label: "Windows native workspace",
    },
    runtimePath: "direct-implementation",
  },
});
assert.match(editMutation.mutationId, /^project_binding_[a-f0-9]{24}$/);
assert.equal(editMutation.workspace.windowsPath, "D:\\Work\\windows-context-menu");
assert.equal(editMutation.runtimePath, "direct-implementation");

const createMutation = validateDirectWorkbenchProjectBindingMutation(directory, config, {
  clientMutationId: "client_create_project",
  mode: "create",
  sourceProjectId: "project_wsl",
  projectId: "",
  expectedCatalogRevision: directory.catalogRevision,
  expectedProjectRevision: "",
  fields: {
    displayName: "New WSL project",
    workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/rose/work/new-wsl", label: "WSL native" },
    runtimePath: "app-server",
  },
});
assert.equal(createMutation.projectId, "");

assert.throws(
  () => validateDirectWorkbenchProjectBindingMutation(directory, config, {
    ...editMutation,
    fields: { displayName: "Windows", workspace: editMutation.workspace, runtimePath: editMutation.runtimePath },
    expectedProjectRevision: "stale",
  }),
  (error) => error?.code === "project_binding_revision_stale",
);
assert.throws(
  () => validateDirectWorkbenchProjectBindingMutation(busyDirectory, config, {
    clientMutationId: "client_edit_active_busy",
    mode: "edit",
    sourceProjectId: "project_wsl",
    projectId: "project_wsl",
    expectedCatalogRevision: busyDirectory.catalogRevision,
    expectedProjectRevision: buildDirectWorkbenchProjectBindingDraft(config, {
      projectId: "project_wsl",
      catalogRevision: busyDirectory.catalogRevision,
    }).expectedProjectRevision,
    fields: {
      displayName: "Busy WSL",
      workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/rose/work/busy", label: "WSL" },
      runtimePath: "app-server",
    },
  }),
  (error) => error?.code === "active_turn_in_current_project",
);
const busyTargetDirectory = buildDirectWorkbenchProjectDirectory(config, {
  activeTurnCounts: { project_windows: 1 },
});
assert.throws(
  () => validateDirectWorkbenchProjectBindingMutation(busyTargetDirectory, config, {
    clientMutationId: "client_edit_inactive_busy",
    mode: "edit",
    sourceProjectId: "project_wsl",
    projectId: "project_windows",
    expectedCatalogRevision: busyTargetDirectory.catalogRevision,
    expectedProjectRevision: editDraft.expectedProjectRevision,
    fields: {
      displayName: "Busy Windows",
      workspace: { kind: "windows", windowsPath: "D:\\Work\\busy", label: "Windows" },
      runtimePath: "direct-text",
    },
  }),
  (error) => error?.code === "active_turn_in_target_project",
);
assert.throws(
  () => validateDirectWorkbenchProjectBindingMutation(directory, config, {
    clientMutationId: "client_invalid_windows_path",
    mode: "create",
    sourceProjectId: "project_wsl",
    expectedCatalogRevision: directory.catalogRevision,
    fields: {
      displayName: "Invalid",
      workspace: { kind: "windows", windowsPath: "relative\\path" },
      runtimePath: "app-server",
    },
  }),
  (error) => error?.code === "project_binding_windows_path_invalid",
);
assert.throws(
  () => validateDirectWorkbenchProjectBindingMutation(directory, config, {
    clientMutationId: "client_create_supplied_id",
    mode: "create",
    sourceProjectId: "project_wsl",
    projectId: "renderer_assigned_id",
    expectedCatalogRevision: directory.catalogRevision,
    fields: {
      displayName: "Invalid identity",
      workspace: { kind: "local", localPath: "/tmp/project" },
      runtimePath: "app-server",
    },
  }),
  (error) => error?.code === "project_binding_create_identity_forbidden",
);

const bindingReceipt = buildDirectWorkbenchProjectBindingReceipt({
  ...editMutation,
  ok: true,
  status: "completed",
  completedAt: "2026-08-11T08:10:00.000Z",
});
const bindingOperations = new Map([[
  editMutation.clientMutationId,
  { ...editMutation, receipt: bindingReceipt },
]]);
const replayedBindingReceipt = resolveDirectWorkbenchProjectBindingReplay(
  bindingOperations,
  "project_wsl",
  editMutation,
);
assert.equal(replayedBindingReceipt.status, "completed");
assert.equal(replayedBindingReceipt.duplicate, true);
assert.throws(
  () => resolveDirectWorkbenchProjectBindingReplay(
    bindingOperations,
    "project_wsl",
    { ...editMutation, projectId: "project_local" },
  ),
  (error) => error?.code === "client_mutation_id_reused",
);

const preservedHostRuntime = alignCodexHostRuntimeWithWorkspace(
  { runtime: "host", binaryPath: "codex" },
  {
    mode: "edit",
    currentWorkspace: { kind: "windows" },
    nextWorkspace: { kind: "windows" },
    platform: "win32",
  },
);
assert.equal(preservedHostRuntime.runtime, "host");
const windowsToWslRuntime = alignCodexHostRuntimeWithWorkspace(
  { runtime: "host", binaryPath: "codex" },
  {
    mode: "edit",
    currentWorkspace: { kind: "windows" },
    nextWorkspace: { kind: "wsl" },
    platform: "win32",
  },
);
assert.equal(windowsToWslRuntime.runtime, "wsl");
assert.equal(windowsToWslRuntime.binaryPath, "codex");
const wslToWindowsRuntime = alignCodexHostRuntimeWithWorkspace(
  { runtime: "wsl" },
  {
    mode: "edit",
    currentWorkspace: { kind: "wsl" },
    nextWorkspace: { kind: "windows" },
    platform: "win32",
  },
);
assert.equal(wslToWindowsRuntime.runtime, "auto");
const createdWslRuntime = alignCodexHostRuntimeWithWorkspace(
  { runtime: "host" },
  {
    mode: "create",
    currentWorkspace: { kind: "windows" },
    nextWorkspace: { kind: "wsl" },
    platform: "win32",
  },
);
assert.equal(createdWslRuntime.runtime, "wsl");
const nativeWslProcessRuntime = alignCodexHostRuntimeWithWorkspace(
  { runtime: "host" },
  {
    mode: "create",
    currentWorkspace: { kind: "local" },
    nextWorkspace: { kind: "wsl" },
    platform: "linux",
  },
);
assert.equal(nativeWslProcessRuntime.runtime, "auto");

console.log("Direct Workbench project directory regression passed.");
