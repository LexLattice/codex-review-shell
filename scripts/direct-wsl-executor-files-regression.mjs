#!/usr/bin/env node

// Turn 4 of the dual-environment track: read_file and apply_patch for a WSL
// workspace run inside the WSL executor with the same access-profile rules as
// local files, and the sandboxed profiles can't reach Windows drives, WSL
// interop, or credential stores. Runs on either host:
//   Linux/WSL:  node scripts/direct-wsl-executor-files-regression.mjs
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-wsl-executor-files-regression.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment");
const { ExecutorFilePort } = require("../src/main/direct/tools/executor-file-port");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session");
const { EnvironmentExecutorProcessBackend } = require("../src/main/direct/tools/executor-process-backend");
const {
  BubblewrapExecSandbox,
  discoverCredentialStoreFiles,
  isCredentialStorePath,
  sandboxedReadRefusal,
} = require("../src/main/direct/tools/exec-sandbox");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");

const onWindows = process.platform === "win32";
const distro = onWindows ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : process.env.WSL_DISTRO_NAME;
assert(distro, "this regression needs a WSL distro (run inside WSL or on a Windows host with WSL)");
const toHostPath = (linuxPath) => (onWindows ? `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, "\\")}` : linuxPath);
const report = { schema: "direct_wsl_executor_files_regression_report@1", hostPlatform: process.platform, distro, checks: [] };

// 1. Policy units: credential paths, hidden paths, sandbox mounts.
assert.equal(isCredentialStorePath("/home/u/.codex/auth.json"), true);
assert.equal(isCredentialStorePath("C:\\Users\\u\\AppData\\Roaming\\app\\direct-auth\\auth.json"), true);
assert.equal(isCredentialStorePath("/home/u/project/auth.json"), false);
assert.equal(sandboxedReadRefusal("/mnt/c/Users/u/notes.txt", { platform: "linux", workspaceRoot: "/home/u/p" }), "direct_access_profile_path_hidden");
assert.equal(sandboxedReadRefusal("/mnt/c/work/p/src/a.ts", { platform: "linux", workspaceRoot: "/mnt/c/work/p" }), "", "a workspace on /mnt stays readable");
assert.equal(sandboxedReadRefusal("/run/WSL/1_interop", { platform: "linux", workspaceRoot: "/home/u/p" }), "direct_access_profile_path_hidden");
assert.equal(sandboxedReadRefusal("/home/u/.codex/auth.json", { platform: "linux", workspaceRoot: "/home/u/p" }), "direct_access_profile_credential_store_hidden");
assert.equal(sandboxedReadRefusal("/usr/include/stdio.h", { platform: "linux", workspaceRoot: "/home/u/p" }), "");
const fakeFiles = new Set(["/home/u/.codex/auth.json", "/home/u/.config/codex-review-shell/default/direct-auth/auth.json"]);
const fakeDirs = new Map([
  ["/home/u/.config", ["codex-review-shell", "other"]],
  ["/home/u/.config/codex-review-shell", ["default"]],
  ["/home/u/.config/other", []],
]);
const fakeFs = {
  statSync: (target) => {
    if (fakeFiles.has(target)) return { isFile: () => true, isDirectory: () => false };
    if (fakeDirs.has(target) || ["/mnt", "/run/WSL"].includes(target)) return { isFile: () => false, isDirectory: () => true };
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  },
  readdirSync: (target) => {
    if (fakeDirs.has(target)) return fakeDirs.get(target);
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  },
};
assert.deepEqual(discoverCredentialStoreFiles({ platform: "linux", homedir: "/home/u", env: {}, fs: fakeFs }), [...fakeFiles].sort());
const wrapped = new BubblewrapExecSandbox({ platform: "linux", executable: "/usr/bin/bwrap", homedir: "/home/u", env: {}, fs: fakeFs })
  .wrap({ sandboxMode: "workspace-write", root: "/mnt/c/work/p", cwd: "/mnt/c/work/p", shellCommand: "true" });
const argsText = wrapped.args.join(" ");
assert.match(argsText, /--tmpfs \/mnt .*--tmpfs \/run\/WSL/);
assert.match(argsText, /--ro-bind \/dev\/null \/home\/u\/\.codex\/auth\.json/);
assert(argsText.indexOf("--bind /mnt/c/work/p /mnt/c/work/p") > argsText.indexOf("--tmpfs /mnt"), "a workspace on /mnt is bound after /mnt is hidden");
report.checks.push("policy_units");

// Shared fixture inside WSL.
const suffix = crypto.randomBytes(6).toString("hex");
const workspace = `/tmp/direct-wsl-files-${suffix}`;
const outside = `/tmp/direct-wsl-files-outside-${suffix}`;
await fs.mkdir(toHostPath(`${workspace}/src`), { recursive: true });
await fs.mkdir(toHostPath(`${outside}/.codex`), { recursive: true });
await fs.writeFile(toHostPath(`${workspace}/src/a.txt`), "alpha\n", "utf8");
await fs.writeFile(toHostPath(`${outside}/b.txt`), "beta\n", "utf8");
await fs.writeFile(toHostPath(`${outside}/.codex/auth.json`), "{\"fixture\":true}\n", "utf8");

const project = { id: "project_wsl_files", name: "WSL files regression", workspace: { kind: "wsl", distro, linuxPath: workspace } };
const executionEnvironment = { environmentId: `wsl_${distro}`, kind: "wsl", bindingDigest: `sha256:wsl-files-${suffix}` };
const workspaceBackends = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
// On Linux the same-distro workspace is local, so force the executor port to
// exercise it; on Windows the default routing must pick it.
const files = new DirectFullAccessLocalEnvironmentExecutor({
  executorFilePort: new ExecutorFilePort({ workspaceBackends }),
  ...(onWindows ? {} : { workspaceLocalityResolver: () => false }),
});

function inputFor(profile) {
  const threadId = `wsl_files_${profile}`;
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironment,
    capabilities: ["read_file", "apply_patch", "exec_command"],
    accessProfile: profile,
  });
  return { taskId: threadId, threadId, projectId: project.id, executionEnvironmentDigest: grant.executionEnvironmentDigest, harnessGrant: grant, project };
}
const full = inputFor("full_access");
const workspaceMode = inputFor("workspace");
const readOnly = inputFor("read_only");
const updatePatch = (target, before, after) => ["*** Begin Patch", `*** Update File: ${target}`, "@@ -1 +1 @@", `-${before}`, `+${after}`, "*** End Patch"].join("\n");

try {
  // 2. Routing.
  assert.equal(files.portFor(full.harnessGrant, project).kind, "executor");
  if (!onWindows) {
    const defaultRouting = new DirectFullAccessLocalEnvironmentExecutor({ executorFilePort: new ExecutorFilePort({ workspaceBackends }) });
    assert.equal(defaultRouting.portFor(full.harnessGrant, project).kind, "local", "same-distro WSL workspaces stay local");
  }
  report.checks.push("routing");

  // 3. Reads.
  const read = await files.request(workspaceMode, "readFile", { relPath: "src/a.txt" });
  assert.equal(read.text, "alpha\n");
  assert.equal(read.source, "direct_environment_executor");
  assert.equal((await files.request(readOnly, "readFile", { relPath: `${outside}/b.txt` })).text, "beta\n", "reads outside the workspace stay allowed");
  await assert.rejects(() => files.request(full, "readFile", { relPath: "src/missing.txt" }), (error) => error.code === "direct_full_access_file_unavailable");
  report.checks.push("reads");

  // 4. Workspace writes stay inside the project folder.
  const applied = await files.request(workspaceMode, "applyPatch", { mode: "apply", patch: updatePatch("src/a.txt", "alpha", "alpha2") });
  assert.equal(applied.status, "applied");
  assert.equal(await fs.readFile(toHostPath(`${workspace}/src/a.txt`), "utf8"), "alpha2\n");
  if (onWindows) {
    // A symlink created over UNC is not a Linux symlink; make it inside WSL.
    const { spawnSync } = await import("node:child_process");
    const linked = spawnSync("wsl.exe", ["-d", distro, "-e", "ln", "-s", outside, `${workspace}/escape`]);
    assert.equal(linked.status, 0, "fixture symlink must be created inside WSL");
  } else {
    await fs.symlink(outside, `${workspace}/escape`);
  }
  for (const target of [`${outside}/b.txt`, `../direct-wsl-files-outside-${suffix}/b.txt`, "escape/b.txt"]) {
    await assert.rejects(
      () => files.request(workspaceMode, "applyPatch", { mode: "apply", patch: updatePatch(target, "beta", "hacked") }),
      (error) => error.code === "direct_access_profile_path_outside_workspace",
      `workspace patch must reject ${target}`,
    );
  }
  assert.equal(await fs.readFile(toHostPath(`${outside}/b.txt`), "utf8"), "beta\n");
  const created = await files.request(workspaceMode, "applyPatch", {
    mode: "apply",
    patch: ["*** Begin Patch", "*** Add File: src/new/created.txt", "+created", "*** End Patch"].join("\n"),
  });
  assert.equal(created.status, "applied");
  assert.equal(await fs.readFile(toHostPath(`${workspace}/src/new/created.txt`), "utf8"), "created\n");
  await assert.rejects(
    () => files.request(readOnly, "applyPatch", { mode: "dryRun", patch: updatePatch("src/a.txt", "alpha2", "alpha3") }),
    (error) => ["direct_access_profile_write_blocked", "capability_not_in_grant_population"].includes(error.code),
  );
  const fullOutside = await files.request(full, "applyPatch", { mode: "apply", patch: updatePatch(`${outside}/b.txt`, "beta", "beta2") });
  assert.equal(fullOutside.status, "applied");
  report.checks.push("write_boundaries");

  // 5. The executor rechecks before-digests right before writing.
  const port = files.portFor(full.harnessGrant, project);
  const stalePlan = [{
    operation: "update",
    beforeExists: true,
    beforeDigest: "0".repeat(64),
    _resolved: port.resolveTarget(full, full.harnessGrant, "src/a.txt", "patch target"),
    _afterText: "overwritten\n",
  }];
  await assert.rejects(() => port.commit(full.harnessGrant, stalePlan, full), (error) => error.code === "direct_full_access_patch_conflict");
  assert.equal(await fs.readFile(toHostPath(`${workspace}/src/a.txt`), "utf8"), "alpha2\n");
  report.checks.push("commit_revalidation");

  // 6. Sandboxed reads can't reach credential stores or Windows drives; full
  // access can.
  await assert.rejects(
    () => files.request(workspaceMode, "readFile", { relPath: `${outside}/.codex/auth.json` }),
    (error) => error.code === "direct_access_profile_credential_store_hidden",
  );
  await assert.rejects(
    () => files.request(readOnly, "readFile", { relPath: "/mnt/c/Windows/win.ini" }),
    (error) => error.code === "direct_access_profile_path_hidden",
  );
  assert.match((await files.request(full, "readFile", { relPath: `${outside}/.codex/auth.json` })).text, /fixture/);
  report.checks.push("sandboxed_read_policy");

  // 7. Sandboxed commands can't start Windows processes through interop.
  const execManager = new DirectStatefulExecSessionManager({
    backendResolver: () => new EnvironmentExecutorProcessBackend({ workspaceBackends }),
  });
  const execBinding = { ...workspaceMode };
  const probe = execManager.start({
    ...execBinding,
    cmd: "ls -A /mnt | wc -l; ls /run/WSL 2>/dev/null | wc -l; (/mnt/c/Windows/System32/cmd.exe /c echo ESCAPED) 2>&1 | grep -c ESCAPED",
    stdinPolicy: "disabled",
  });
  const probeResult = await execManager.wait({ ...execBinding, sessionId: probe.sessionId });
  assert.deepEqual(probeResult.stdoutPreview.trim().split(/\s+/), ["0", "0", "0"], `sandbox must hide /mnt and interop: ${probeResult.stdoutPreview}`);
  const fullProbe = execManager.start({ ...full, cmd: "ls -A /mnt | wc -l", stdinPolicy: "disabled" });
  const fullProbeResult = await execManager.wait({ ...full, sessionId: fullProbe.sessionId });
  assert.notEqual(fullProbeResult.stdoutPreview.trim(), "0", "full access keeps the Windows drives");
  await execManager.dispose("wsl-files-regression");
  report.checks.push("interop_escape_closed");

  report.status = "passed";
  console.log(JSON.stringify(report));
} finally {
  workspaceBackends.disposeAll();
  await fs.rm(toHostPath(workspace), { recursive: true, force: true });
  await fs.rm(toHostPath(outside), { recursive: true, force: true });
}
