#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

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

const project = {
  id: "project_windows_native_regression",
  name: "Windows native regression",
  workspace: {
    kind: "windows",
    windowsPath:
      "C:\\Users\\Rose\\AppData\\Local\\Temp",
    windowsNodePath:
      discovery.privateBindings.windowsNodePath,
  },
};
assert.equal(
  workspaceRoot(project, process.cwd()),
  project.workspace.windowsPath,
);
assert.match(workspaceLabel(project, process.cwd()), /^Windows /);
assert.match(
  workspaceSessionKey(project, process.cwd()),
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
  assert.equal(status.hello.capabilities.runCommand, false);
  assert.equal(status.hello.capabilities.runDirectCommand, false);
  assert.equal(status.hello.capabilities.provisionGitWorktree, false);
  assert.equal(status.hello.capabilities.repositorySemanticSnapshot, false);
  assert.equal(status.hello.capabilities.readFilePreview, true);
  assert.equal(status.hygiene.skipped, true);
  assert.equal(status.hygiene.changed, false);

  const helloAgain = await manager.requestForProject(
    project,
    "hello",
  );
  assert.equal(helloAgain.sessionId, status.hello.sessionId);
  assert.equal(helloAgain.pid, status.hello.pid);
  const unavailableTestProfile = await manager.requestForProject(
    project,
    "directTestProfile",
  );
  assert.equal(unavailableTestProfile.available, false);
  assert.equal(
    unavailableTestProfile.unavailableReason,
    "workspace_windows_job_object_containment_unavailable",
  );
  assert.equal(
    unavailableTestProfile.substrateCapabilities.processContainmentBlockerCode,
    "workspace_windows_job_object_containment_unavailable",
  );
  await assert.rejects(
    manager.requestForProject(project, "runCommand", { command: "cmd.exe", args: ["/c", "exit", "0"] }),
    (error) => {
      assert.equal(error.code, "workspace_windows_job_object_containment_unavailable");
      assert.equal(error.backendQuiesced, true);
      return true;
    },
    "native Windows process-backed work fails closed until Job Object custody is installed",
  );

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
      windowsProcessContainmentBlocker: unavailableTestProfile.unavailableReason,
    },
  }, null, 2));
} finally {
  manager.disposeAll();
  fs.rmSync(wslRoot, { recursive: true, force: true });
}
