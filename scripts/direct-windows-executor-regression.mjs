#!/usr/bin/env node

// Turn 7 of the dual-environment track: native Windows agents. Commands for
// a Windows workspace run in PowerShell under the Direct job runner (Job
// Object for every profile, Low integrity for Workspace and Read only), and
// files keep their line endings. Runs on either host:
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-windows-executor-regression.mjs
//               (checks both the in-process local backend and the Windows executor)
//   Linux/WSL:  node scripts/direct-windows-executor-regression.mjs
//               (launches the Windows executor with Windows node.exe, as a
//               WSL-hosted Direct does)

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
  EnvironmentExecutorProcessBackend,
  createEnvironmentExecBackendResolver,
} = require("../src/main/direct/tools/executor-process-backend");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment");
const { ExecutorFilePort } = require("../src/main/direct/tools/executor-file-port");
const { WindowsJobRunner, WindowsJobSandbox, quoteWindowsArgument, windowsCommandLine } = require("../src/main/direct/tools/windows-job-runner");
const { resolveExecutionEnvironmentFacts } = require("../src/main/direct/runtime/execution-environment-contract");
const { EXECUTOR_METHODS } = require("../src/shared/executor-protocol");
const { WorkspaceBackendManager, workspaceRoot } = require("../src/main/workspace-backend");

const onWindows = process.platform === "win32";
const CMD = "/mnt/c/Windows/System32/cmd.exe";

function windowsTemp() {
  if (onWindows) return os.tmpdir();
  const result = spawnSync(CMD, ["/d", "/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8", timeout: 20_000 });
  const value = String(result.stdout || "").trim();
  assert.match(value, /^[A-Za-z]:\\/, `could not read the Windows %TEMP% (${result.stderr || result.error?.message || "no output"})`);
  return value;
}

function hostPath(windowsPath) {
  if (onWindows) return windowsPath;
  const result = spawnSync("wslpath", ["-u", windowsPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = (await fs.readFile(file, "utf8")).trim();
      if (text) return text;
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

const report = { schema: "direct_windows_executor_regression_report@1", hostPlatform: process.platform, checks: [] };
const suffix = crypto.randomBytes(6).toString("hex");
const winTemp = windowsTemp();
const winWorkspace = path.win32.join(winTemp, `direct-win-exec-${suffix}`);
const winOutside = path.win32.join(winTemp, `direct-win-exec-outside-${suffix}`);
const workspaceHost = hostPath(winWorkspace);
const outsideHost = hostPath(winOutside);
await fs.mkdir(path.join(workspaceHost, "sub"), { recursive: true });
await fs.mkdir(outsideHost, { recursive: true });
// A credential-store stand-in for the in-process backend, so the regression
// never relabels this machine's real stores from that path.
const winCredentials = path.win32.join(winOutside, "fixture-auth", "auth.json");
await fs.mkdir(path.dirname(hostPath(winCredentials)), { recursive: true });
await fs.writeFile(hostPath(winCredentials), "{\"token\":\"fixture\"}\n");

const project = {
  id: "project_windows_executor_regression",
  name: "Windows executor regression",
  workspace: { kind: "windows", windowsPath: winWorkspace },
};
const executionEnvironment = { environmentId: "windows_native", kind: "windows", bindingDigest: `sha256:windows-executor-${suffix}` };
const workspaceBackends = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
const executorBackend = new EnvironmentExecutorProcessBackend({ workspaceBackends });

function bindingFor(accessProfile, tag) {
  const threadId = `win_exec_${tag}_${accessProfile}`;
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironment,
    capabilities: ["exec_command", "write_stdin", "read_file", "apply_patch"],
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

const targets = [
  {
    name: "executor",
    manager: new DirectStatefulExecSessionManager({ backendResolver: () => executorBackend }),
    checksCredentialFixture: false,
  },
];
if (onWindows) {
  targets.unshift({
    name: "local",
    manager: new DirectStatefulExecSessionManager({
      workspaceRootResolver: (input) => workspaceRoot(input?.project || input),
      sandbox: new WindowsJobSandbox({ credentialStoreFiles: () => [winCredentials] }),
    }),
    checksCredentialFixture: true,
  });
}

async function run(manager, binding, input) {
  const started = manager.start({ ...binding, stdinPolicy: "disabled", ...input });
  return { started, result: await manager.wait({ ...binding, sessionId: started.sessionId }) };
}

async function alive(manager, binding, pid) {
  const probe = await run(manager, binding, { cmd: `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }` });
  return probe.result.stdoutPreview.trim();
}

const grandchild = (pidFile) => `$p = Start-Process -FilePath node -ArgumentList @('-e','setInterval(()=>{},1000)') -PassThru -NoNewWindow; Set-Content -Path ${pidFile} -Value $p.Id`;

try {
  // 0. Command-line quoting round-trips through CommandLineToArgvW rules.
  assert.equal(quoteWindowsArgument("plain"), "plain");
  assert.equal(quoteWindowsArgument("two words"), "\"two words\"");
  assert.equal(quoteWindowsArgument("say \"hi\""), "\"say \\\"hi\\\"\"");
  assert.equal(quoteWindowsArgument("C:\\dir with space\\"), "\"C:\\dir with space\\\\\"");
  assert.equal(quoteWindowsArgument(""), "\"\"");
  assert.equal(windowsCommandLine("C:\\Program Files\\x.exe", ["-c", "a \"b\""]), "\"C:\\Program Files\\x.exe\" -c \"a \\\"b\\\"\"");
  report.checks.push("windows_quoting");

  // 1. Routing: a Windows workspace runs locally on a Windows host and in
  // the Windows executor from anywhere else, for commands and files.
  const resolver = createEnvironmentExecBackendResolver({ localBackend: targets[0].manager.localBackend, executorBackend });
  const routed = resolver({ project }, bindingFor("full_access", "route").harnessGrant);
  assert.equal(routed === executorBackend, !onWindows);
  // Wired as src/main.js wires it.
  const defaultFiles = new DirectFullAccessLocalEnvironmentExecutor({
    workspaceRootResolver: (input) => workspaceRoot(input?.project || input),
    executorFilePort: new ExecutorFilePort({ workspaceBackends }),
  });
  assert.equal(defaultFiles.portFor({ executionEnvironment }, project).kind, onWindows ? "local" : "executor");
  const facts = resolveExecutionEnvironmentFacts({ grant: bindingFor("workspace", "facts").harnessGrant, project });
  assert.equal(facts.environmentKind, "windows");
  assert.equal(facts.shell.name, "powershell");
  assert.equal(facts.executesVia, onWindows ? "host" : "environment_executor");
  assert.equal(facts.networkEnforced, false);
  report.checks.push(onWindows ? "routing_windows_local" : "routing_windows_to_executor");

  // 2. The executor describes its containment without spawning anything.
  const executorSession = await workspaceBackends.ensureForProject(project);
  const described = await executorSession.transport.request(EXECUTOR_METHODS.environmentDescribe, {});
  assert.equal(described.environmentKind, "windows");
  assert.equal(described.shell.name, "powershell");
  assert.equal(described.capabilities.sandbox.kind, "windows_job_object");
  assert.equal(described.capabilities.sandbox.available, true);
  assert.equal(described.capabilities.processContainment.kind, "windows_job_object");
  report.checks.push("executor_describes_job_containment");

  // 3. Building the runner from source (Windows host: into a fresh cache).
  if (onWindows) {
    const freshRoot = await fs.mkdtemp(path.join(os.tmpdir(), "direct-job-runner-build-"));
    try {
      const runner = new WindowsJobRunner({ rootDir: freshRoot });
      assert.deepEqual(
        { available: runner.status().available, built: runner.status().built },
        { available: true, built: false },
      );
      const built = runner.executable();
      assert.equal(path.basename(built), "direct-job-runner.exe");
      assert.equal(runner.status().built, true);
      assert.equal(new WindowsJobRunner({ rootDir: freshRoot }).executable(), built, "the cache is keyed by source digest");
    } finally {
      await fs.rm(freshRoot, { recursive: true, force: true });
    }
    report.checks.push("runner_builds_from_source");
  }

  for (const target of targets) {
    const { manager } = target;
    const full = bindingFor("full_access", target.name);
    const workspaceMode = bindingFor("workspace", target.name);
    const readOnly = bindingFor("read_only", target.name);

    // 4. Native PowerShell: cwd, exit code, UTF-8 output.
    const shell = await run(manager, full, { cmd: "$PSVersionTable.PSEdition; (Get-Location).Path; Write-Output 'h\u00e9llo \u2713'; exit 7" });
    assert.equal(shell.result.status, "failed", shell.result.stderrPreview);
    assert.equal(shell.result.exitCode, 7);
    const lines = shell.result.stdoutPreview.trim().split(/\r?\n/);
    assert.match(lines[0], /^(Core|Desktop)$/);
    assert.equal(lines[1].toLowerCase(), winWorkspace.toLowerCase());
    assert.equal(lines[2], "h\u00e9llo \u2713", "PowerShell output arrives as UTF-8");
    const sub = await run(manager, full, { cmd: "(Get-Location).Path", cwd: "sub" });
    assert.equal(sub.result.stdoutPreview.trim().toLowerCase(), path.win32.join(winWorkspace, "sub").toLowerCase());
    if (target.name === "local") assert.equal(manager.sessions.get(shell.started.sessionId).sandboxLauncher, "windows_job_object");
    report.checks.push(`${target.name}_powershell_cwd_exit_utf8`);

    // 5. Interactive stdin.
    const interactive = manager.start({ ...full, cmd: "$line = [Console]::In.ReadLine(); \"got:$line\"", stdinPolicy: "line_input" });
    manager.writeStdin({ ...full, sessionId: interactive.sessionId, chars: "hello\n" });
    const interactiveResult = await manager.wait({ ...full, sessionId: interactive.sessionId });
    assert.equal(interactiveResult.status, "completed", interactiveResult.stderrPreview);
    assert.equal(interactiveResult.stdoutPreview.trim(), "got:hello");
    report.checks.push(`${target.name}_interactive_stdin`);

    // 6. Containment: cancelling a command stops everything it started, and
    // so does the command exiting.
    const cancelPid = `cancel-${target.name}.pid`;
    const long = manager.start({ ...full, cmd: `${grandchild(cancelPid)}; Start-Sleep -Seconds 600`, stdinPolicy: "disabled" });
    const cancelledPid = await waitForFile(path.join(workspaceHost, cancelPid));
    manager.cancel({ ...full, sessionId: long.sessionId });
    const cancelled = await manager.wait({ ...full, sessionId: long.sessionId });
    assert.notEqual(cancelled.status, "completed");
    await sleep(500);
    assert.equal(await alive(manager, full, cancelledPid), "gone", "cancel kills the grandchild");
    const exitPid = `exit-${target.name}.pid`;
    const exited = await run(manager, full, { cmd: `${grandchild(exitPid)}; exit 0` });
    assert.equal(exited.result.status, "completed", exited.result.stderrPreview);
    const exitedPid = await waitForFile(path.join(workspaceHost, exitPid));
    await sleep(500);
    assert.equal(await alive(manager, full, exitedPid), "gone", "leftovers die when the command exits");
    report.checks.push(`${target.name}_job_containment`);

    // 7. Workspace: Low integrity confines writes to the project and TEMP;
    // WSL is unreachable; the network is reported open.
    const probe = (extra = {}) => [
      "$r = [ordered]@{}",
      `try { Set-Content -Path inside-${target.name}.txt -Value x -ErrorAction Stop; $r.inside = 'ok' } catch { $r.inside = 'denied' }`,
      `try { Set-Content -Path '${path.win32.join(winOutside, `o-${target.name}.txt`)}' -Value x -ErrorAction Stop; $r.outside = 'ok' } catch { $r.outside = 'denied' }`,
      "try { Set-Content -Path (Join-Path $env:TEMP 'scratch.txt') -Value x -ErrorAction Stop; $r.temp = 'ok' } catch { $r.temp = 'denied' }",
      "$r.tempPath = $env:TEMP",
      "$r.language = [string]$ExecutionContext.SessionState.LanguageMode",
      "$null = wsl.exe -l -q 2>&1; $r.wsl = if ($LASTEXITCODE -eq 0) { 'ok' } else { 'denied' }",
      ...(extra.credentials ? [`try { Get-Content -Path '${extra.credentials}' -ErrorAction Stop | Out-Null; $r.credentials = 'ok' } catch { $r.credentials = 'denied' }`] : []),
      "$r | ConvertTo-Json -Compress",
    ].join("; ");
    const credentialCheck = target.checksCredentialFixture ? { credentials: winCredentials } : {};
    const sandboxed = await run(manager, workspaceMode, { cmd: probe(credentialCheck) });
    assert.equal(sandboxed.result.status, "completed", sandboxed.result.stderrPreview);
    const ws = JSON.parse(sandboxed.result.stdoutPreview.trim().split(/\r?\n/).pop());
    assert.equal(ws.inside, "ok");
    assert.equal(ws.outside, "denied");
    assert.equal(ws.temp, "ok");
    assert.equal(ws.language, "FullLanguage");
    assert.equal(ws.wsl, "denied");
    if (target.checksCredentialFixture) assert.equal(ws.credentials, "denied");
    assert.equal(sandboxed.result.networkAccess, true, "Windows reports the network as open");
    assert.equal(await exists(path.join(outsideHost, `o-${target.name}.txt`)), false);
    await sleep(500);
    assert.equal(await exists(hostPath(ws.tempPath)), false, "the scratch TEMP is removed after the command");
    report.checks.push(`${target.name}_workspace_low_integrity`);

    // 8. Read only: the same Low-labeled folder is not writable.
    const readOnlyRun = await run(manager, readOnly, { cmd: probe(credentialCheck) });
    assert.equal(readOnlyRun.result.status, "completed", readOnlyRun.result.stderrPreview);
    const ro = JSON.parse(readOnlyRun.result.stdoutPreview.trim().split(/\r?\n/).pop());
    assert.equal(ro.inside, "denied");
    assert.equal(ro.outside, "denied");
    assert.equal(ro.temp, "ok");
    assert.equal(ro.language, "FullLanguage");
    assert.equal(ro.wsl, "denied");
    if (target.checksCredentialFixture) assert.equal(ro.credentials, "denied");
    report.checks.push(`${target.name}_read_only_write_restricted`);
    await manager.dispose("windows-executor-regression");
  }

  // 9. Files: CRLF preserved on update, CRLF for new files, Workspace
  // boundary, through every port this host uses.
  const filePorts = [
    { name: onWindows ? "local" : "executor", files: defaultFiles },
    ...(onWindows ? [{
      name: "executor",
      files: new DirectFullAccessLocalEnvironmentExecutor({
        executorFilePort: new ExecutorFilePort({ workspaceBackends }),
        workspaceLocalityResolver: () => false,
      }),
    }] : []),
  ];
  for (const { name, files } of filePorts) {
    const full = bindingFor("full_access", `files_${name}`);
    const workspaceMode = bindingFor("workspace", `files_${name}`);
    const crlfFile = `crlf-${name}.txt`;
    const lfFile = `lf-${name}.txt`;
    await fs.writeFile(path.join(workspaceHost, crlfFile), "one\r\ntwo\r\nthree\r\n");
    await fs.writeFile(path.join(workspaceHost, lfFile), "one\ntwo\n");
    const update = (target, before, after) => ["*** Begin Patch", `*** Update File: ${target}`, "@@ -1,2 +1,2 @@", " one", `-${before}`, `+${after}`, "*** End Patch"].join("\n");
    const readBack = await files.request(full, "readFile", { relPath: crlfFile });
    assert.equal(readBack.text, "one\r\ntwo\r\nthree\r\n");
    assert.equal((await files.request(workspaceMode, "applyPatch", { mode: "apply", patch: update(crlfFile, "two", "TWO") })).status, "applied");
    assert.equal(await fs.readFile(path.join(workspaceHost, crlfFile), "utf8"), "one\r\nTWO\r\nthree\r\n", "CRLF is preserved");
    assert.equal((await files.request(full, "applyPatch", { mode: "apply", patch: update(lfFile, "two", "TWO") })).status, "applied");
    assert.equal(await fs.readFile(path.join(workspaceHost, lfFile), "utf8"), "one\nTWO\n", "LF stays LF");
    const created = `new-${name}.txt`;
    assert.equal((await files.request(workspaceMode, "applyPatch", {
      mode: "apply",
      patch: ["*** Begin Patch", `*** Add File: dir/${created}`, "+a", "+b", "*** End Patch"].join("\n"),
    })).status, "applied");
    assert.equal(await fs.readFile(path.join(workspaceHost, "dir", created), "utf8"), "a\r\nb\r\n", "new files use CRLF on Windows");
    await assert.rejects(
      () => files.request(workspaceMode, "applyPatch", { mode: "apply", patch: ["*** Begin Patch", `*** Add File: ${path.win32.join(winOutside, `x-${name}.txt`)}`, "+x", "*** End Patch"].join("\n") }),
      (error) => error.code === "direct_access_profile_path_outside_workspace",
    );
    report.checks.push(`${name}_files_line_endings_and_boundary`);
  }

  report.status = "passed";
  console.log(JSON.stringify(report));
} finally {
  for (const target of targets) await target.manager.dispose("windows-executor-regression").catch?.(() => {});
  workspaceBackends.disposeAll();
  await sleep(300);
  await fs.rm(workspaceHost, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outsideHost, { recursive: true, force: true }).catch(() => {});
}
