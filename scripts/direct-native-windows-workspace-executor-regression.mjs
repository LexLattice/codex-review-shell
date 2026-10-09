#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// This covers a WSL/Linux host reaching Windows through the Windows Node
// executor and WSL in-process. On a Windows host a Windows workspace runs
// in-process instead (local-child, by design), which the Windows live suite
// covers.
if (process.platform === "win32") {
  console.log("SKIPPED: covers a WSL/Linux host (run with WSL Node).");
  process.exit(77);
}
const require = createRequire(import.meta.url);
const {
  WorkspaceBackendManager,
  workspaceLabel,
  workspaceRoot,
  workspaceRootIsAbsolute,
  workspaceSessionKey,
} = require("../src/main/workspace-backend");
const {
  discoverRealizationOptions,
} = require("../src/main/direct/worldmanager/realization-discovery");

const discovery = discoverRealizationOptions({
  platform: process.platform,
  env: process.env,
});
assert.equal(workspaceRootIsAbsolute("C:\\Users\\Rose\\project", "local", "win32"), true);
assert.equal(workspaceRootIsAbsolute("home\\rose\\project", "local", "win32"), false);
assert.equal(workspaceRootIsAbsolute("/home/rose/project", "local", "linux"), true);
assert.equal(workspaceRootIsAbsolute("C:\\Users\\Rose\\project", "local", "linux"), false);
assert.equal(workspaceRootIsAbsolute("C:\\Users\\Rose\\project", "windows", "linux"), true);
assert.equal(workspaceRootIsAbsolute("/home/rose/project", "wsl", "win32"), true);
const windowsOption = discovery.snapshot.options.find((entry) =>
  entry.environmentId === "env_windows_native");
assert.ok(windowsOption, "Windows realization option is missing.");
assert.equal(
  windowsOption.availability,
  "ready",
  `Native Windows runtime is not ready: ${
    windowsOption.blockerCodes.join(", ") || "unknown"
  }`,
);
assert.equal(windowsOption.admissionState, "eligible");
assert.equal(windowsOption.nativeProcess, true);
assert.equal(windowsOption.residentExecutorSupport, true);

// Process-backed work grants the project's isolation SID Modify on the root,
// so the workspace is a throwaway directory, not the shared Temp folder.
const windowsTempMount = "/mnt/c/Users/Rose/AppData/Local/Temp";
const windowsRootMount = fs.mkdtempSync(path.join(windowsTempMount, "direct-native-ws-"));
const windowsRoot = `C:\\Users\\Rose\\AppData\\Local\\Temp\\${path.basename(windowsRootMount)}`;
const project = {
  id: "project_windows_native_regression",
  name: "Windows native regression",
  workspace: {
    kind: "windows",
    windowsPath: windowsRoot,
    windowsNodePath:
      discovery.privateBindings.windowsNodePath,
  },
};
assert.equal(
  workspaceRoot(project, process.cwd()),
  project.workspace.windowsPath,
);
assert.match(workspaceLabel(project, process.cwd()), /^Windows /);
// One executor per environment (turn 11b); a dedicated worker keeps its own.
assert.equal(workspaceSessionKey(project, process.cwd()), "windows");
assert.match(
  workspaceSessionKey({ ...project, executorPlacement: "dedicated" }, process.cwd()),
  /^windows:/,
);

const manager = new WorkspaceBackendManager({
  fallbackRoot: process.cwd(),
  agentPath: path.resolve("src/backend/wsl-agent.js"),
  windowsNodePath:
    discovery.privateBindings.windowsNodePath,
  wslDistro: process.env.WSL_DISTRO_NAME || "Ubuntu",
});
const wslRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-env1-wsl-"),
);
const wslProject = {
  id: "project_wsl_native_regression",
  name: "WSL native regression",
  workspace: {
    kind: "wsl",
    distro: process.env.WSL_DISTRO_NAME || "Ubuntu",
    linuxPath: wslRoot,
  },
};

try {
  const session = await manager.ensureForProject(project, {
    workspaceHygiene: false,
  });
  const status = session.snapshot();
  assert.equal(status.status, "attached");
  assert.equal(status.transport, "windows-native-resident");
  assert.equal(status.workspace.kind, "windows");
  assert.equal(status.hello.platform, "win32");
  assert.equal(status.hello.workspaceKind, "windows");
  assert.equal(status.hello.projectId, project.id);
  assert.equal(status.hello.root, project.workspace.windowsPath);
  // Process-backed work is advertised because the Job Object runner proves
  // containment on this host.
  assert.equal(status.hello.capabilities.runCommand, true);
  assert.equal(status.hello.capabilities.runDirectCommand, true);
  assert.equal(status.hello.capabilities.provisionGitWorktree, true);
  assert.equal(status.hello.capabilities.repositorySemanticSnapshot, true);
  assert.equal(status.hello.capabilities.readFilePreview, true);
  assert.equal(status.hygiene.skipped, true);
  assert.equal(status.hygiene.changed, false);

  const helloAgain = await manager.requestForProject(
    project,
    "hello",
  );
  assert.equal(helloAgain.sessionId, status.hello.sessionId);
  assert.equal(helloAgain.pid, status.hello.pid);
  const testProfile = await manager.requestForProject(
    project,
    "directTestProfile",
  );
  assert.notEqual(testProfile.unavailableReason, "workspace_windows_job_object_containment_unavailable");
  const contained = await manager.requestForProject(project, "runCommand", {
    command: "cmd.exe",
    args: ["/c", "echo", "contained"],
  });
  assert.equal(contained.exitCode, 0);
  assert.match(contained.stdout, /contained/);

  const wslSession = await manager.ensureForProject(wslProject, {
    workspaceHygiene: false,
  });
  const wslStatus = wslSession.snapshot();
  assert.equal(wslStatus.status, "attached");
  assert.equal(wslStatus.hello.platform, "linux");
  assert.equal(wslStatus.hello.workspaceKind, "wsl");
  assert.equal(wslStatus.hello.projectId, wslProject.id);
  assert.equal(wslStatus.hello.root, wslRoot);
  assert.equal(wslStatus.hello.capabilities.runDirectCommand, true);
  assert.equal(wslStatus.hygiene.skipped, true);
  assert.equal(wslStatus.hygiene.changed, false);
  const wslHelloAgain = await manager.requestForProject(
    wslProject,
    "hello",
  );
  assert.equal(
    wslHelloAgain.sessionId,
    wslStatus.hello.sessionId,
  );
  assert.equal(wslHelloAgain.pid, wslStatus.hello.pid);

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-native-project-substrate-executors",
    discovery: {
      environmentId: windowsOption.environmentId,
      availability: windowsOption.availability,
      nativeProcess: windowsOption.nativeProcess,
      residentExecutorSupport:
        windowsOption.residentExecutorSupport,
    },
    attachment: {
      transport: status.transport,
      platform: status.hello.platform,
      workspaceKind: status.hello.workspaceKind,
      residentPidObserved: Number.isInteger(status.hello.pid),
      repeatedRequestUsedSameSession:
        helloAgain.sessionId === status.hello.sessionId,
    },
    wslAttachment: {
      transport: wslStatus.transport,
      platform: wslStatus.hello.platform,
      workspaceKind: wslStatus.hello.workspaceKind,
      residentPidObserved: Number.isInteger(wslStatus.hello.pid),
      repeatedRequestUsedSameSession:
        wslHelloAgain.sessionId === wslStatus.hello.sessionId,
    },
    authorityBoundary: {
      windowsProbeWorkspaceMutation: status.hygiene.changed,
      wslProbeWorkspaceMutation: wslStatus.hygiene.changed,
      windowsProcessBackedCapabilitiesAdvertised: status.hello.capabilities.runDirectCommand,
      windowsContainedCommandExitCode: contained.exitCode,
    },
  }, null, 2));
} finally {
  manager.disposeAll();
  fs.rmSync(wslRoot, { recursive: true, force: true });
  fs.rmSync(windowsRootMount, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
