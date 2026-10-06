#!/usr/bin/env node

// Turn 3 of the dual-environment track: process sessions inside the WSL
// executor, driven by the host router. Runs on either host:
//   Linux/WSL:  node scripts/direct-wsl-executor-process-regression.mjs
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-wsl-executor-process-regression.mjs
// On Windows the executor is launched through wsl.exe, which is the path a
// Windows-hosted Direct app uses for WSL projects.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session");
const {
  ENVIRONMENT_EXECUTOR_BACKEND_ID,
  EnvironmentExecutorProcessBackend,
  createEnvironmentExecBackendResolver,
} = require("../src/main/direct/tools/executor-process-backend");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");

const onWindows = process.platform === "win32";
const distro = onWindows ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : process.env.WSL_DISTRO_NAME;
assert(distro, "this regression needs a WSL distro (run inside WSL or on a Windows host with WSL)");
const uncRoot = `\\\\wsl.localhost\\${distro}`;
const toHostPath = (linuxPath) => (onWindows ? `${uncRoot}${linuxPath.replace(/\//g, "\\")}` : linuxPath);

function runInWsl(args) {
  return onWindows
    ? spawnSync("wsl.exe", ["-d", distro, "-e", ...args], { encoding: "utf8", timeout: 20_000 })
    : spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20_000 });
}

const report = { schema: "direct_wsl_executor_process_regression_report@1", hostPlatform: process.platform, distro, checks: [] };
const suffix = crypto.randomBytes(6).toString("hex");
const linuxWorkspace = `/tmp/direct-wsl-exec-${suffix}`;
const linuxProbe = `/var/tmp/direct-wsl-exec-probe-${suffix}`;
await fs.mkdir(path.join(toHostPath(linuxWorkspace), "sub"), { recursive: true });

const project = {
  id: "project_wsl_executor_regression",
  name: "WSL executor regression",
  workspace: { kind: "wsl", distro, linuxPath: linuxWorkspace },
};
const executionEnvironment = { environmentId: `wsl_${distro}`, kind: "wsl", bindingDigest: `sha256:wsl-executor-${suffix}` };
const workspaceBackends = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
const executorBackend = new EnvironmentExecutorProcessBackend({ workspaceBackends });

function bindingFor(accessProfile) {
  const threadId = `wsl_exec_${accessProfile}`;
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironment,
    capabilities: ["exec_command", "write_stdin"],
    accessProfile,
  });
  return {
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironmentDigest: grant.executionEnvironmentDigest,
    harnessGrant: grant,
    project,
  };
}

const manager = new DirectStatefulExecSessionManager({ backendResolver: () => executorBackend });
const full = bindingFor("full_access");
const workspaceMode = bindingFor("workspace");
const readOnly = bindingFor("read_only");

async function run(binding, input) {
  const started = manager.start({ ...binding, ...input });
  return { started, result: await manager.wait({ ...binding, sessionId: started.sessionId }) };
}

try {
  // 0. The production resolver routes WSL to the executor only when the
  // workspace isn't local to this host.
  const resolver = createEnvironmentExecBackendResolver({ localBackend: manager.localBackend, executorBackend });
  const chosen = resolver({ project }, full.harnessGrant);
  assert.equal(chosen === executorBackend, onWindows, "Windows hosts use the WSL executor; same-distro Linux hosts run locally");
  assert.equal(resolver({ project: { workspace: { kind: "local" } } }, { executionEnvironment: { kind: "local" } }), manager.localBackend);
  report.checks.push(onWindows ? "resolver_routes_wsl_to_executor" : "resolver_keeps_same_distro_local");

  // 1. Native bash login shell, cwd, exit code.
  const shell = await run(full, { cmd: "echo \"bash=${BASH_VERSION:+yes} shell=$0\"; pwd; exit 7", stdinPolicy: "disabled" });
  const shellRecord = manager.sessions.get(shell.started.sessionId);
  assert.equal(shellRecord.backendId, ENVIRONMENT_EXECUTOR_BACKEND_ID);
  assert.equal(shellRecord.child, null);
  assert.equal(shell.result.status, "failed");
  assert.equal(shell.result.exitCode, 7);
  assert.match(shell.result.stdoutPreview, /bash=yes shell=(\/usr)?\/bin\/bash/);
  assert.match(shell.result.stdoutPreview, new RegExp(`${linuxWorkspace}\\s*$`));
  const sub = await run(full, { cmd: "pwd", cwd: "sub", stdinPolicy: "disabled" });
  assert.equal(sub.result.status, "completed");
  assert.equal(sub.result.stdoutPreview.trim(), `${linuxWorkspace}/sub`);
  report.checks.push("native_bash_cwd_exit");

  // 2. Interactive stdin, including a write queued before the executor
  // acknowledged the start.
  const interactive = manager.start({ ...full, cmd: "read line; echo \"got:$line\"", stdinPolicy: "line_input" });
  const accepted = manager.writeStdin({ ...full, sessionId: interactive.sessionId, chars: "hello\n" });
  assert.equal(accepted.stdinAccepted, true);
  const interactiveResult = await manager.wait({ ...full, sessionId: interactive.sessionId });
  assert.equal(interactiveResult.status, "completed");
  assert.equal(interactiveResult.stdoutPreview.trim(), "got:hello");
  report.checks.push("interactive_stdin");

  // 3. Cwd refusals: lexical ones throw on the host; filesystem ones come
  // back from the executor as a failed session with its message.
  assert.throws(() => manager.start({ ...workspaceMode, cmd: "pwd", cwd: "../escape" }), (error) => error.code === "direct_stateful_exec_cwd_invalid");
  const missing = await run(full, { cmd: "pwd", cwd: "does-not-exist", stdinPolicy: "disabled" });
  assert.equal(missing.result.status, "failed");
  assert.match(missing.result.spawnError, /cwd is unavailable/i);
  report.checks.push("cwd_refusals");

  // 4. Workspace sandbox inside WSL: writes stay in the workspace, no network.
  const sandboxed = await run(workspaceMode, {
    cmd: `echo in > inside.txt; (echo out > ${linuxProbe}) 2>/dev/null && echo OUT_OK || echo OUT_BLOCKED; grep -c : /proc/net/dev`,
    stdinPolicy: "disabled",
  });
  assert.equal(sandboxed.result.status, "completed", sandboxed.result.stderrPreview);
  assert.equal(sandboxed.result.networkAccess, false);
  assert.match(sandboxed.result.stdoutPreview, /OUT_BLOCKED/);
  assert.equal(sandboxed.result.stdoutPreview.trim().split("\n").pop(), "1");
  assert.equal(await fs.readFile(path.join(toHostPath(linuxWorkspace), "inside.txt"), "utf8"), "in\n");
  await assert.rejects(() => fs.stat(toHostPath(linuxProbe)));
  const readOnlyRun = await run(readOnly, { cmd: "(echo x > ro.txt) 2>/dev/null && echo RO_OK || echo RO_BLOCKED", stdinPolicy: "disabled" });
  assert.match(readOnlyRun.result.stdoutPreview, /RO_BLOCKED/);
  report.checks.push("sandbox_modes");

  // 5. Cancel reaches the remote process tree.
  const sleeper = manager.start({ ...full, cmd: "sleep 30", stdinPolicy: "disabled" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  manager.cancel({ ...full, sessionId: sleeper.sessionId });
  const cancelStarted = Date.now();
  const cancelled = await manager.wait({ ...full, sessionId: sleeper.sessionId });
  assert.equal(cancelled.status, "cancelled");
  assert(Date.now() - cancelStarted < 10_000, "cancel must not wait for the command to finish");
  report.checks.push("cancel");

  // 6. Large output: the executor caps forwarding, the router caps admission,
  // and the session still completes.
  const flood = await run(full, { cmd: "head -c 3000000 /dev/zero | tr '\\0' 'a'", stdinPolicy: "disabled" });
  assert.equal(flood.result.status, "completed");
  assert.equal(flood.result.outputTruncated, true);
  report.checks.push("bounded_output");

  // 7. Losing the executor settles the session as failed and the process is
  // gone; nothing is re-run.
  const marker = `29.${suffix.replace(/[a-f]/g, "1").slice(0, 3)}`;
  const doomed = manager.start({ ...full, cmd: `sleep ${marker}`, stdinPolicy: "disabled" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  workspaceBackends.disposeForProject(project);
  const lost = await manager.wait({ ...full, sessionId: doomed.sessionId });
  assert.equal(lost.status, "failed");
  assert.equal(lost.errorCode, "direct_stateful_exec_executor_lost");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const survivors = runInWsl(["pgrep", "-f", `sleep ${marker}`]);
  assert.equal(survivors.status, 1, `orphaned process survived executor shutdown: ${survivors.stdout}`);
  // The next session starts a fresh executor.
  const after = await run(full, { cmd: "echo again", stdinPolicy: "disabled" });
  assert.equal(after.result.stdoutPreview.trim(), "again");
  report.checks.push("executor_loss");

  // 8. An abruptly killed executor (no graceful shutdown) still takes its
  // sessions with it, in both containment paths. Linux host only: there the
  // executor is a direct child the test can SIGKILL.
  if (!onWindows) {
    const abruptFull = `28.${suffix.replace(/[a-f]/g, "2").slice(0, 3)}`;
    const abruptSandboxed = `27.${suffix.replace(/[a-f]/g, "3").slice(0, 3)}`;
    const fullSession = manager.start({ ...full, cmd: `sleep ${abruptFull}`, stdinPolicy: "disabled" });
    const sandboxSession = manager.start({ ...workspaceMode, cmd: `sleep ${abruptSandboxed}`, stdinPolicy: "disabled" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    process.kill(workspaceBackends.sessionForProject(project).child.pid, "SIGKILL");
    assert.equal((await manager.wait({ ...full, sessionId: fullSession.sessionId })).errorCode, "direct_stateful_exec_executor_lost");
    assert.equal((await manager.wait({ ...workspaceMode, sessionId: sandboxSession.sessionId })).errorCode, "direct_stateful_exec_executor_lost");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    for (const marker of [abruptFull, abruptSandboxed]) {
      const leftover = runInWsl(["pgrep", "-f", `sleep ${marker}`]);
      if (leftover.status === 0) runInWsl(["pkill", "-9", "-f", `sleep ${marker}`]);
      assert.equal(leftover.status, 1, `sleep ${marker} survived an abrupt executor kill`);
    }
    report.checks.push("abrupt_executor_kill");
  }

  report.status = "passed";
  console.log(JSON.stringify(report));
} finally {
  await manager.dispose("wsl-executor-regression");
  workspaceBackends.disposeAll();
  await fs.rm(toHostPath(linuxWorkspace), { recursive: true, force: true });
  await fs.rm(toHostPath(linuxProbe), { force: true }).catch(() => {});
}
