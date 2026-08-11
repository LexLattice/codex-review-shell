#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_WORKBENCH_PROJECT_DIRECTORY_SCHEMA,
  assertDirectWorkbenchProjectDirectoryRendererSafe,
  buildDirectWorkbenchProjectActivationReceipt,
  buildDirectWorkbenchProjectDirectory,
  resolveDirectWorkbenchProjectActivationReplay,
  validateDirectWorkbenchProjectActivation,
} = require("../src/main/direct/project/project-directory.js");

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

console.log("Direct Workbench project directory regression passed.");
