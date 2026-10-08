#!/usr/bin/env node

// Turn 6 proof script (spike, not a regression). Run under Windows Node:
//   & 'C:\Program Files\nodejs\node.exe' \\wsl.localhost\Ubuntu\home\rose\work\LexLattice\codex-review-shell-direct\scripts\spikes\windows-containment\windows-containment-spike.mjs
//
// Measures what happens to a command's process tree on Windows today, and
// what a per-command Job Object (job-runner.cs) and a Low-integrity token
// change. Prints one JSON report and exits non-zero if a containment claim
// the decision relies on does not hold on this machine.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { nativeShellCommand } = require("../../../src/main/direct/runtime/execution-environment-contract");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(file, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = (await fs.readFile(file, "utf8")).trim();
      if (text) return text;
    } catch {}
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function settleDead(pids, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(alive)) await sleep(100);
  return Object.fromEntries(pids.map((pid) => [pid, alive(pid)]));
}

function forceKill(pids) {
  for (const pid of pids) {
    try { process.kill(pid); } catch {}
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ schema: "direct_windows_containment_spike@1", status: "skipped", reason: "windows_only" }));
    return;
  }
  const report = { schema: "direct_windows_containment_spike@1", host: `${os.version()} ${os.release()}`, node: process.version, probes: {} };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-containment-"));
  const leaked = [];
  try {
    // Build the runner with the compiler every Windows install ships.
    const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const runner = path.join(root, "job-runner.exe");
    const build = spawnSync(csc, ["/nologo", "/platform:x64", `/out:${runner}`, path.join(here, "job-runner.cs")], { encoding: "utf8" });
    assert.equal(build.status, 0, build.stdout + build.stderr);

    const shell = nativeShellCommand("", { platform: "win32" });
    report.shell = { flavor: shell.flavor, command: shell.command };
    const node = process.execPath;
    const grandchild = path.join(root, "grandchild.cjs");
    await fs.writeFile(grandchild, [
      "const fs = require('fs'), path = require('path'), { spawn } = require('child_process');",
      "const dir = process.argv[2];",
      "if (process.argv[3] === 'detach') {",
      "  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
      "  c.unref();",
      "  fs.writeFileSync(path.join(dir, 'detached.pid'), String(c.pid));",
      "}",
      "fs.writeFileSync(path.join(dir, 'grandchild.pid'), String(process.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    // The host stand-in: a Node process that starts the command the way the
    // Direct host would, so killing it simulates a host crash.
    const host = path.join(root, "host.cjs");
    await fs.writeFile(host, [
      "const fs = require('fs'), path = require('path'), { spawn } = require('child_process');",
      "const [dir, command, ...args] = process.argv.slice(2);",
      "const child = spawn(command, args, { stdio: 'ignore' });",
      "fs.writeFileSync(path.join(dir, 'child.pid'), String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n"));

    const shellCommand = (dir, { detach = false, exitAfterStart = false } = {}) => [
      `Start-Process -FilePath '${node}' -ArgumentList @('${grandchild}','${dir}'${detach ? ",'detach'" : ""}) -NoNewWindow`,
      `while (-not (Test-Path '${path.join(dir, "grandchild.pid")}')) { Start-Sleep -Milliseconds 50 }`,
      exitAfterStart ? "exit 3" : "Start-Sleep -Seconds 600",
    ].join("; ");
    const direct = (command) => nativeShellCommand(command, { platform: "win32" });
    const viaRunner = (command, integrity = "medium") => {
      const native = direct(command);
      const cmdline = [native.command, ...native.args].map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
      return { command: runner, args: ["--integrity", integrity, "--cmdline-b64", Buffer.from(cmdline, "utf8").toString("base64")] };
    };
    const probeDir = async (name) => {
      const dir = path.join(root, name);
      await fs.mkdir(dir);
      return dir;
    };
    const pidsIn = async (dir, names) => {
      const out = {};
      for (const name of names) out[name] = Number(await waitForFile(path.join(dir, `${name}.pid`)));
      leaked.push(...Object.values(out));
      return out;
    };

    // 1. Today: killing the shell leaves its children running.
    {
      const dir = await probeDir("baseline-kill");
      const plan = direct(shellCommand(dir));
      const child = spawn(plan.command, plan.args, { stdio: "ignore" });
      leaked.push(child.pid);
      const { grandchild: gc } = await pidsIn(dir, ["grandchild"]);
      child.kill();
      const after = await settleDead([child.pid, gc], 1500);
      report.probes.baseline_kill_shell = { shellAlive: after[child.pid], grandchildAlive: after[gc] };
      assert.equal(after[child.pid], false);
    }

    // 2. Today: a host crash kills its direct child (libuv's job) but not the
    // grandchildren, because libuv's job allows silent breakaway.
    {
      const dir = await probeDir("baseline-host-death");
      const plan = direct(shellCommand(dir));
      const hostProcess = spawn(node, [host, dir, plan.command, ...plan.args], { stdio: "ignore" });
      leaked.push(hostProcess.pid);
      const { child: shellPid, grandchild: gc } = await pidsIn(dir, ["child", "grandchild"]);
      hostProcess.kill();
      const after = await settleDead([shellPid, gc], 3000);
      report.probes.baseline_host_death = { shellAlive: after[shellPid], grandchildAlive: after[gc] };
    }

    // 3. Job runner: killing the runner kills the whole tree, including a
    // detached great-grandchild.
    {
      const dir = await probeDir("job-kill");
      const plan = viaRunner(shellCommand(dir, { detach: true }));
      const child = spawn(plan.command, plan.args, { stdio: "ignore" });
      leaked.push(child.pid);
      const { grandchild: gc, detached } = await pidsIn(dir, ["grandchild", "detached"]);
      child.kill();
      const after = await settleDead([child.pid, gc, detached]);
      report.probes.job_kill_runner = { runnerAlive: after[child.pid], grandchildAlive: after[gc], detachedAlive: after[detached] };
      assert.deepEqual(Object.values(after), [false, false, false], "killing the runner kills the tree");
    }

    // 4. Job runner: a host crash kills the whole tree.
    {
      const dir = await probeDir("job-host-death");
      const plan = viaRunner(shellCommand(dir, { detach: true }));
      const hostProcess = spawn(node, [host, dir, plan.command, ...plan.args], { stdio: "ignore" });
      leaked.push(hostProcess.pid);
      const { child: runnerPid, grandchild: gc, detached } = await pidsIn(dir, ["child", "grandchild", "detached"]);
      hostProcess.kill();
      const after = await settleDead([runnerPid, gc, detached]);
      report.probes.job_host_death = { runnerAlive: after[runnerPid], grandchildAlive: after[gc], detachedAlive: after[detached] };
      assert.deepEqual(Object.values(after), [false, false, false], "a host crash kills the tree");
    }

    // 5. Job runner: when the command exits, leftovers die and the exit code
    // comes through (PID-namespace semantics).
    {
      const dir = await probeDir("job-main-exit");
      const plan = viaRunner(shellCommand(dir, { exitAfterStart: true }));
      const child = spawn(plan.command, plan.args, { stdio: "ignore" });
      const exitCode = await new Promise((resolve) => child.on("exit", resolve));
      const gc = Number(await waitForFile(path.join(dir, "grandchild.pid")));
      leaked.push(gc);
      const after = await settleDead([gc]);
      report.probes.job_main_exit = { exitCode, grandchildAlive: after[gc] };
      assert.equal(exitCode, 3);
      assert.equal(after[gc], false, "leftovers die with the command");
    }

    // 6. Job runner: piped stdin/stdout/stderr pass straight through.
    {
      const plan = viaRunner("$line = [Console]::In.ReadLine(); [Console]::Out.WriteLine('echo:' + $line); [Console]::Error.WriteLine('err:' + $line); exit 7");
      const child = spawn(plan.command, plan.args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.stdin.end("ping\n");
      const exitCode = await new Promise((resolve) => child.on("exit", resolve));
      await sleep(100);
      report.probes.job_stdio = { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
      assert.equal(exitCode, 7);
      assert.equal(stdout.trim(), "echo:ping");
      assert.equal(stderr.trim(), "err:ping");
    }

    // 7. Low integrity: writes land only where the folder is labeled Low.
    {
      const workspace = await probeDir("low-workspace");
      const outside = await probeDir("low-outside");
      await fs.writeFile(path.join(outside, "secret.txt"), "medium-integrity file\n");
      const label = spawnSync("icacls", [workspace, "/setintegritylevel", "(OI)(CI)low"], { encoding: "utf8" });
      assert.equal(label.status, 0, label.stdout + label.stderr);
      // A credential-store stand-in: Medium label with no-read-up, set before
      // the file exists so the file inherits it.
      const credentials = await probeDir("low-credentials");
      const hide = spawnSync(runner, ["--label-no-read-up", credentials], { encoding: "utf8" });
      assert.equal(hide.status, 0, hide.stdout + hide.stderr);
      await fs.writeFile(path.join(credentials, "auth.json"), "{\"token\":\"fixture\"}\n");
      const server = net.createServer((socket) => socket.end());
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      const tries = {
        writeWorkspace: "Set-Content -Path inside.txt -Value x -ErrorAction Stop",
        writeOutside: `Set-Content -Path '${path.join(outside, "written.txt")}' -Value x -ErrorAction Stop`,
        writeUserTemp: `Set-Content -Path '${path.join(os.tmpdir(), `direct-low-probe-${process.pid}.txt`)}' -Value x -ErrorAction Stop`,
        writeScratchTemp: "Set-Content -Path (Join-Path $env:TEMP 'scratch-probe.txt') -Value x -ErrorAction Stop",
        languageMode: "if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw [string]$ExecutionContext.SessionState.LanguageMode }",
        readOutside: `Get-Content -Path '${path.join(outside, "secret.txt")}' -ErrorAction Stop | Out-Null`,
        readCredentials: `Get-Content -Path '${path.join(credentials, "auth.json")}' -ErrorAction Stop | Out-Null`,
        listCredentials: `Get-ChildItem -Path '${credentials}' -ErrorAction Stop | Out-Null`,
        loopbackConnect: `$c = [Net.Sockets.TcpClient]::new('127.0.0.1', ${port}); $c.Close()`,
        runNode: `& '${node}' -e 'process.exit(0)'; if ($LASTEXITCODE) { throw 'node failed' }`,
        runGit: "git --version | Out-Null; if ($LASTEXITCODE) { throw 'git failed' }",
        writeTempLow: "$f = Join-Path $env:LOCALAPPDATA 'Temp\\Low\\direct-low-probe.txt'; Set-Content -Path $f -Value x -ErrorAction Stop; Remove-Item $f",
        runWslExe: "$o = wsl.exe -l -q 2>&1; if ($LASTEXITCODE) { throw (($o -join ' ') -replace '\\x00', '') }",
      };
      const script = [
        "$r = [ordered]@{}",
        ...Object.entries(tries).map(([name, body]) => `try { ${body}; $r['${name}'] = 'ok' } catch { $r['${name}'] = 'denied: ' + $_.Exception.Message.Split([Environment]::NewLine)[0] }`),
        "$r['integrity'] = if (((whoami /groups) -join ' ') -match 'Mandatory Label\\\\(\\w+)') { $Matches[1] } else { 'unknown' }",
        "$r | ConvertTo-Json -Compress",
      ].join("\n");
      // PowerShell drops to ConstrainedLanguage when it cannot write its
      // AppLocker probe file to %TEMP%, so every contained command gets a
      // private scratch TEMP it may write (Low label, plus an Everyone ACE so
      // a write-restricted token passes too).
      const scratch = await probeDir("low-scratch");
      const grant = spawnSync("icacls", [scratch, "/grant", "*S-1-1-0:(OI)(CI)M", "/setintegritylevel", "(OI)(CI)low"], { encoding: "utf8" });
      assert.equal(grant.status, 0, grant.stdout + grant.stderr);
      const runAt = async (integrity) => {
        const plan = viaRunner(script, integrity);
        const result = spawnSync(plan.command, plan.args, {
          cwd: workspace,
          encoding: "utf8",
          timeout: 60000,
          env: { ...process.env, TEMP: scratch, TMP: scratch },
        });
        await fs.rm(path.join(workspace, "inside.txt"), { force: true });
        await fs.rm(path.join(os.tmpdir(), `direct-low-probe-${process.pid}.txt`), { force: true });
        const line = result.stdout.trim().split(/\r?\n/).pop() || "";
        assert(line.startsWith("{"), `${integrity}: ${result.stdout}${result.stderr}`);
        return JSON.parse(line);
      };
      const shared = (observed) => {
        assert.equal(observed.integrity, "Low");
        assert.equal(observed.languageMode, "ok", "PowerShell keeps FullLanguage with a writable scratch TEMP");
        assert.equal(observed.writeScratchTemp, "ok");
        assert.equal(observed.loopbackConnect, "ok", "neither token restricts the network");
        assert.match(observed.writeOutside, /^denied/);
        assert.match(observed.writeUserTemp, /^denied/);
        assert.equal(observed.readOutside, "ok", "Low integrity does not restrict reads");
        assert.match(observed.readCredentials, /^denied/, "a no-read-up label hides a file from Low integrity");
        assert.match(observed.listCredentials, /^denied/);
        assert.match(observed.runWslExe, /^denied/, "a Low-integrity command cannot start WSL");
        assert.equal(observed.runNode, "ok");
        assert.equal(observed.runGit, "ok");
      };

      // Workspace: Low integrity; the workspace folder carries a Low label.
      const workspaceObserved = await runAt("low");
      report.probes.low_integrity_workspace = workspaceObserved;
      shared(workspaceObserved);
      assert.equal(workspaceObserved.writeWorkspace, "ok");
      assert.equal(workspaceObserved.writeTempLow, "ok");

      // Read only: Low integrity plus a write-restricted token. The same
      // Low-labeled folder is no longer writable, so a label left by a
      // Workspace thread cannot widen a Read-only thread.
      const readOnlyObserved = await runAt("low-read-only");
      report.probes.low_integrity_read_only = readOnlyObserved;
      shared(readOnlyObserved);
      assert.match(readOnlyObserved.writeWorkspace, /^denied/);
      assert.match(readOnlyObserved.writeTempLow, /^denied/);
      server.close();
      assert.equal(await fs.readFile(path.join(credentials, "auth.json"), "utf8"), "{\"token\":\"fixture\"}\n", "the host still reads it");
    }

    // 8. Overhead of the runner on a trivial command.
    {
      const time = (plan) => {
        const samples = [];
        for (let i = 0; i < 5; i += 1) {
          const started = process.hrtime.bigint();
          spawnSync(plan.command, plan.args, { stdio: "ignore" });
          samples.push(Number(process.hrtime.bigint() - started) / 1e6);
        }
        return Math.round(samples.sort((a, b) => a - b)[2]);
      };
      report.probes.overhead_ms = {
        directMedian: time(direct("exit 0")),
        runnerMedian: time(viaRunner("exit 0")),
        runnerLowMedian: time(viaRunner("exit 0", "low")),
      };
    }

    report.status = "passed";
    console.log(JSON.stringify(report, null, 2));
  } finally {
    forceKill(leaked.filter(alive));
    await sleep(200);
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
