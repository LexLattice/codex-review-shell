#!/usr/bin/env node
// One executor per environment (turn 11b). Every project folder in an
// environment shares that environment's executor, and each request names its
// project so the executor resolves paths, cwd, and the sandbox against it.
// Workspace workers keep a dedicated executor. Runs on either host:
//   Linux/WSL:  node scripts/direct-environment-executor-regression.mjs
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-environment-executor-regression.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  WorkspaceBackendManager,
  executorProjectContext,
  workspaceSessionKey,
} = require("../src/main/workspace-backend.js");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { EnvironmentExecutorProcessBackend } = require("../src/main/direct/tools/executor-process-backend.js");
const { ExecutorFilePort } = require("../src/main/direct/tools/executor-file-port.js");
const { EXECUTOR_METHODS } = require("../src/shared/executor-protocol.js");

const onWindows = process.platform === "win32";
const distro = onWindows ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : (process.env.WSL_DISTRO_NAME || "");
assert(distro, "this regression needs WSL (run inside WSL or on a Windows host with WSL)");
const suffix = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two project folders in each environment, created from this host.
const linuxHostPath = (linuxPath) => (onWindows ? `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll("/", "\\")}` : linuxPath);
// Not under /tmp: the WSL Workspace sandbox keeps /tmp writable by design.
const linuxBase = `/var/tmp/direct-env-executor-${suffix}`;
const linuxA = `${linuxBase}/alpha`;
const linuxB = `${linuxBase}/beta`;
if (onWindows) {
  const made = spawnSync("wsl.exe", ["-d", distro, "-e", "mkdir", "-p", linuxA, linuxB], { encoding: "utf8", timeout: 60_000 });
  assert.equal(made.status, 0, made.stderr);
} else {
  fs.mkdirSync(linuxA, { recursive: true });
  fs.mkdirSync(linuxB, { recursive: true });
}
const winTemp = onWindows
  ? os.tmpdir()
  : String(spawnSync("/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8", timeout: 20_000 }).stdout || "").trim();
assert.match(winTemp, /^[A-Za-z]:\\/, "the Windows %TEMP% is readable");
const winBase = path.win32.join(winTemp, `direct-env-executor-${suffix}`);
const winA = path.win32.join(winBase, "alpha");
const winB = path.win32.join(winBase, "beta");
const winHostPath = (winPath) => (onWindows ? winPath : String(spawnSync("wslpath", ["-u", winPath], { encoding: "utf8" }).stdout || "").trim());
fs.mkdirSync(winHostPath(winA), { recursive: true });
fs.mkdirSync(winHostPath(winB), { recursive: true });
fs.writeFileSync(path.join(linuxHostPath(linuxA), "who.txt"), "alpha-wsl\n");
fs.writeFileSync(path.join(linuxHostPath(linuxB), "who.txt"), "beta-wsl\n");
fs.writeFileSync(path.join(winHostPath(winA), "who.txt"), "alpha-windows\n");
fs.writeFileSync(path.join(winHostPath(winB), "who.txt"), "beta-windows\n");

const projects = {
  wslA: { id: "project_env_wsl_alpha", name: "WSL alpha", workspace: { kind: "wsl", distro, linuxPath: linuxA } },
  wslB: { id: "project_env_wsl_beta", name: "WSL beta", workspace: { kind: "wsl", distro, linuxPath: linuxB } },
  winA: { id: "project_env_win_alpha", name: "Windows alpha", workspace: { kind: "windows", windowsPath: winA } },
  winB: { id: "project_env_win_beta", name: "Windows beta", workspace: { kind: "windows", windowsPath: winB } },
};

const manager = new WorkspaceBackendManager({ agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"), fallbackRoot: repoRoot });
const executorBackend = new EnvironmentExecutorProcessBackend({ workspaceBackends: manager });
const sessions = new DirectStatefulExecSessionManager({ initialYieldMs: 2000, backendResolver: () => executorBackend });
const files = new ExecutorFilePort({ workspaceBackends: manager });

function bindingFor(project, accessProfile) {
  const kind = project.workspace.kind;
  const threadId = `env_exec_${project.id}_${accessProfile}`;
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironment: { environmentId: `${kind}_env_exec`, kind, bindingDigest: `sha256:env-exec-${kind}-${suffix}` },
    capabilities: ["exec_command", "write_stdin"],
    accessProfile,
  });
  return { taskId: threadId, threadId, projectId: project.id, executionEnvironmentDigest: grant.executionEnvironmentDigest, harnessGrant: grant, project };
}

async function run(project, accessProfile, cmd) {
  const binding = bindingFor(project, accessProfile);
  const started = sessions.start({ ...binding, cmd, stdinPolicy: "disabled" });
  return sessions.wait({ ...binding, sessionId: started.sessionId });
}

try {
  await check("projects in one environment share a key; workers keep their own", () => {
    assert.equal(workspaceSessionKey(projects.wslA), `wsl:${distro}`);
    assert.equal(workspaceSessionKey(projects.wslB), `wsl:${distro}`);
    assert.equal(workspaceSessionKey(projects.winA), "windows");
    assert.equal(workspaceSessionKey({ ...projects.winA, executorPlacement: "dedicated" }), `windows:${winA.toLowerCase()}`);
    assert.deepEqual(executorProjectContext(projects.wslA), { projectId: projects.wslA.id, workspaceKind: "wsl", root: linuxA });
  });

  for (const [label, first, second, expectedPlatform] of [
    ["WSL", projects.wslA, projects.wslB, "linux"],
    ["Windows", projects.winA, projects.winB, "win32"],
  ]) {
    await check(`${label}: two project folders, one executor, each request in its own folder`, async () => {
      const viewA = await manager.ensureForProject(first, { workspaceHygiene: false });
      const viewB = await manager.ensureForProject(second, { workspaceHygiene: false });
      assert.equal(viewA.session, viewB.session, "one session for the environment");
      assert.equal(viewA.child.pid, viewB.child.pid, "one executor process");
      assert.equal([...manager.sessions.keys()].filter((key) => key === workspaceSessionKey(first)).length, 1);
      // Each project's hello is the executor checking that project's folder.
      assert.equal(viewA.hello.platform, expectedPlatform);
      assert.equal(viewA.hello.projectId, first.id);
      assert.equal(viewB.hello.projectId, second.id);
      assert.notEqual(viewA.hello.root, viewB.hello.root);
      assert.equal(viewA.hello.sessionId, viewB.hello.sessionId);
      assert.equal(viewA.session.hello.root, "", "the executor's own hello names no folder");
      // Legacy requests, file port, and processes all resolve per project.
      const listedA = await manager.requestForProject(first, "listTree", { relPath: "" });
      assert.ok(listedA.entries.some((entry) => entry.name === "who.txt"));
      const readA = await files.request({ project: first }, EXECUTOR_METHODS.fsRead, { path: "who.txt", sandboxMode: "workspace-write", purpose: "read" });
      const readB = await files.request({ project: second }, EXECUTOR_METHODS.fsRead, { path: "who.txt", sandboxMode: "workspace-write", purpose: "read" });
      assert.match(Buffer.from(readA.bytesBase64, "base64").toString(), /^alpha-/);
      assert.match(Buffer.from(readB.bytesBase64, "base64").toString(), /^beta-/);
      const where = expectedPlatform === "win32" ? "(Get-Location).Path" : "pwd";
      const inA = await run(first, "workspace", where);
      const inB = await run(second, "workspace", where);
      assert.equal(inA.status, "completed", JSON.stringify(inA));
      assert.ok(inA.stdoutPreview.trim().toLowerCase().endsWith("alpha"), inA.stdoutPreview);
      assert.ok(inB.stdoutPreview.trim().toLowerCase().endsWith("beta"), inB.stdoutPreview);
    });
  }

  await check("WSL Workspace sandbox is per request: a command in alpha can't write beta", async () => {
    const result = await run(projects.wslA, "workspace", `echo mine > mine.txt; (echo x > ${linuxB}/intruder.txt) 2>/dev/null && echo CROSS_OK || echo CROSS_BLOCKED`);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.match(result.stdoutPreview, /CROSS_BLOCKED/);
    assert.equal(fs.readFileSync(path.join(linuxHostPath(linuxA), "mine.txt"), "utf8"), "mine\n");
    assert.equal(fs.existsSync(path.join(linuxHostPath(linuxB), "intruder.txt")), false);
  });

  await check("the executor refuses project work without a valid project", async () => {
    const view = await manager.ensureForProject(projects.wslA, { workspaceHygiene: false });
    const raw = (method, params) => view.transport.request(method, params, 15_000);
    await assert.rejects(raw("listTree", { relPath: "" }), (error) => error.code === "executor_project_context_required");
    await assert.rejects(raw("listTree", { relPath: "", projectContext: { root: "relative/path", workspaceKind: "wsl" } }), (error) => error.code === "executor_project_context_invalid");
    await assert.rejects(raw("listTree", { relPath: "", projectContext: { root: linuxA, workspaceKind: "windows" } }), (error) => error.code === "executor_project_context_environment_mismatch");
    await assert.rejects(raw("listTree", { relPath: "", projectContext: { root: `${linuxBase}/missing`, workspaceKind: "wsl" } }), (error) => error.code === "executor_project_root_unavailable");
    await assert.rejects(manager.ensureForProject({ ...projects.wslA, id: "missing", workspace: { kind: "wsl", distro, linuxPath: `${linuxBase}/missing` } }, { workspaceHygiene: false }));
    // Environment-wide requests need no project.
    const listing = await raw(EXECUTOR_METHODS.fsList, { path: linuxBase });
    assert.ok(listing.entries.some((entry) => entry.name === "alpha"));
  });

  await check("a worker's binding can't land on a shared executor", async () => {
    await assert.rejects(
      manager.ensureForProject(projects.wslA, { workspaceWorkerBinding: { bindingDigest: "sha256:x" } }),
      (error) => error.code === "workspace_worker_binding_requires_dedicated_executor",
    );
    const dedicated = await manager.ensureForProject({ ...projects.wslB, id: "project_env_wsl_beta__worker", executorPlacement: "dedicated" }, { workspaceHygiene: false });
    const shared = await manager.ensureForProject(projects.wslB, { workspaceHygiene: false });
    assert.notEqual(dedicated.child.pid, shared.child.pid, "a dedicated executor is its own process");
    assert.equal(dedicated.hello.root.replace(/\/+$/, ""), linuxB);
    manager.disposeForProject({ ...projects.wslB, id: "project_env_wsl_beta__worker", executorPlacement: "dedicated" });
  });

  await check("releasing a project keeps the executor while others use it", async () => {
    const probe = { id: "environment_probe_fixture", name: "probe", workspace: { kind: "windows", windowsPath: winBase } };
    const before = (await manager.ensureForProject(projects.winA, { workspaceHygiene: false })).child.pid;
    await manager.ensureForProject(probe, { workspaceHygiene: false });
    assert.equal(manager.releaseProject(probe), false, "the probe isn't the executor's last user");
    assert.equal((await manager.ensureForProject(projects.winA, { workspaceHygiene: false })).child.pid, before);
    assert.equal(manager.releaseProject(projects.winA), false);
    assert.equal(manager.releaseProject(projects.winB), true, "the last user stops it");
    assert.equal(manager.sessions.has("windows"), false);
  });

  await check("stopping the environment's executor ends every project's processes there", async () => {
    const binding = bindingFor(projects.wslB, "full_access");
    const started = sessions.start({ ...binding, cmd: "sleep 30", stdinPolicy: "disabled" });
    await sleep(1500);
    manager.disposeForProject(projects.wslA);
    const lost = await sessions.wait({ ...binding, sessionId: started.sessionId });
    assert.equal(lost.status, "failed");
    assert.equal(lost.errorCode, "direct_stateful_exec_executor_lost");
    const again = await run(projects.wslB, "full_access", "echo back");
    assert.equal(again.stdoutPreview.trim(), "back", "the next request starts a fresh executor");
  });

  console.log(JSON.stringify({ schema: "direct_environment_executor_regression@1", status: "passed", hostPlatform: process.platform, checks }));
} finally {
  await sessions.dispose("environment-executor-regression");
  manager.disposeAll();
  await sleep(300);
  for (const target of [winHostPath(winBase), linuxHostPath(linuxBase)]) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (error) { console.error(`cleanup: ${error.message}`); }
  }
}
