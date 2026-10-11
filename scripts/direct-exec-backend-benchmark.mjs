#!/usr/bin/env node

// Runs the same suite of agent commands and file tools through Direct's own
// executor and through Codex exec-server, and prints them side by side:
// latency, throughput, terminal and input behavior, and what each sandbox
// lets a Workspace / Read only command reach.
//
//   node scripts/direct-exec-backend-benchmark.mjs                 a workspace on this host
//   node scripts/direct-exec-backend-benchmark.mjs --target wsl    from Windows, a WSL workspace
//   node scripts/direct-exec-backend-benchmark.mjs --target windows  from WSL, a Windows workspace
//   options: --iterations N (default 15)  --out report.json  --backends direct,codex-exec-server
//
// Needs the Codex CLI (codex exec-server) in the target environment. Nothing
// secret is printed: credential and environment probes report only whether a
// file was readable and how many variable names look secret.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session");
const { EnvironmentExecutorProcessBackend } = require("../src/main/direct/tools/executor-process-backend");
const { ExecutorFilePort } = require("../src/main/direct/tools/executor-file-port");
const { CodexExecServerManager } = require("../src/main/direct/tools/codex-exec-server");
const { CodexExecServerFilePort, CodexExecServerProcessBackend } = require("../src/main/direct/tools/codex-exec-server-backend");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const target = argValue("--target", "local");
const iterations = Math.max(3, Number(argValue("--iterations", "15")) || 15);
const outFile = argValue("--out", "");
const backendIds = argValue("--backends", "direct,codex-exec-server").split(",").map((value) => value.trim()).filter(Boolean);
const onWindows = process.platform === "win32";
if (target === "wsl" && !onWindows) {
  console.error("--target wsl runs from a Windows host; inside WSL the workspace is local (omit --target).");
  process.exit(2);
}
if (target === "windows" && !(process.platform === "linux" && process.env.WSL_DISTRO_NAME)) {
  console.error("--target windows runs from WSL; on Windows the workspace is local (omit --target).");
  process.exit(2);
}
const remote = target === "wsl" || target === "windows";
const distro = target === "wsl" ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : "";
const targetPlatform = target === "wsl" ? "linux" : target === "windows" || process.platform === "win32" ? "win32" : "linux";
const linux = targetPlatform !== "win32";
// Windows' own folders, asked of Windows (from WSL).
const windowsFolders = target === "windows"
  ? (() => {
    const output = spawnSync("/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "echo %TEMP%^|%USERPROFILE%"], { cwd: "/mnt/c", encoding: "utf8" }).stdout.trim();
    const [temp, profile] = output.split("|");
    return { temp, profile };
  })()
  : null;
const wslMount = (windowsPath) => `/mnt/${windowsPath[0].toLowerCase()}${windowsPath.slice(2).replace(/\\/g, "/")}`;

// Fixture folders in the target environment, reachable from this host.
const suffix = crypto.randomBytes(5).toString("hex");
const nativeTemp = target === "wsl" ? "/tmp" : windowsFolders ? windowsFolders.temp : os.tmpdir();
const api = linux ? path.posix : path.win32;
const workspaceRoot = api.join(nativeTemp, `direct-bench-${suffix}`);
// Not under a temp folder: Workspace access may write those.
const outsideRoot = linux ? `/var/tmp/direct-bench-outside-${suffix}` : api.join(windowsFolders ? windowsFolders.profile : os.homedir(), `.direct-bench-outside-${suffix}`);
const hostPath = (nativePath) => (target === "wsl"
  ? `\\\\wsl.localhost\\${distro}${nativePath.replace(/\//g, "\\")}`
  : target === "windows" ? wslMount(nativePath) : nativePath);
const project = target === "wsl"
  ? { id: "bench_project", name: "exec backend benchmark", workspace: { kind: "wsl", distro, linuxPath: workspaceRoot } }
  : target === "windows"
    ? { id: "bench_project", name: "exec backend benchmark", workspace: { kind: "windows", windowsPath: workspaceRoot } }
    : { id: "bench_project", name: "exec backend benchmark", workspace: { kind: "local", localPath: workspaceRoot } };
const executionEnvironment = {
  environmentId: target === "wsl" ? `wsl_${distro}` : target === "windows" ? "windows" : "local",
  kind: target === "wsl" ? "wsl" : target === "windows" ? "windows" : "local",
  bindingDigest: `sha256:bench-${suffix}`,
};

function binding(profile, label) {
  const threadId = `bench_${label}_${profile}`;
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId, threadId, projectId: project.id, executionEnvironment,
    capabilities: ["exec_command", "write_stdin", "read_file", "apply_patch"],
    accessProfile: profile,
  });
  return { taskId: threadId, threadId, projectId: project.id, project, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
}

const q = (text) => (linux ? `'${text.replace(/'/g, `'"'"'`)}'` : `'${text.replace(/'/g, "''")}'`);
const commands = linux ? {
  echo: "echo hi",
  bulk: "head -c 2000000 /dev/zero | tr '\\0' a",
  stdin: "read line; echo got:$line",
  eof: "cat",
  sleep: "sleep 30",
  ttySize: "stty size",
  writeInside: "echo x > inside.txt && echo WROTE || echo BLOCKED",
  writeOutside: `(echo x > ${q(api.join(outsideRoot, "w.txt"))}) 2>/dev/null && echo WROTE || echo BLOCKED`,
  writeTemp: "(f=${TMPDIR:-/tmp}/direct-bench-$$; echo x > $f && rm -f $f) 2>/dev/null && echo WROTE || echo BLOCKED",
  network: "(curl -sS -m 5 -o /dev/null https://example.com 2>/dev/null && echo OPEN) || (getent hosts example.com >/dev/null 2>&1 && echo DNS-ONLY) || echo BLOCKED",
  credential: "if [ -e ~/.codex/auth.json ]; then cat ~/.codex/auth.json >/dev/null 2>&1 && echo READABLE || echo BLOCKED; else echo ABSENT; fi",
  secretNames: "env | cut -d= -f1 | grep -Eic 'key|token|secret|password' || true",
  envCount: "env | wc -l",
  windowsDrives: "ls -A /mnt 2>/dev/null | wc -l",
  interop: "(/mnt/c/Windows/System32/cmd.exe /c echo ESCAPED) 2>&1 | grep -c ESCAPED || true",
  home: "echo $HOME",
  symlink: `ln -sfn ${q(outsideRoot)} escape && echo LINKED`,
} : {
  echo: "Write-Output hi",
  bulk: "[Console]::Out.Write('a' * 2000000)",
  stdin: "$l = [Console]::In.ReadLine(); Write-Output \"got:$l\"",
  eof: "[Console]::In.ReadToEnd()",
  sleep: "Start-Sleep 30",
  ttySize: "\"$($Host.UI.RawUI.WindowSize.Height) $($Host.UI.RawUI.WindowSize.Width)\"",
  writeInside: "try { Set-Content inside.txt x -ErrorAction Stop; 'WROTE' } catch { 'BLOCKED' }",
  writeOutside: `try { Set-Content -LiteralPath ${q(api.join(outsideRoot, "w.txt"))} x -ErrorAction Stop; 'WROTE' } catch { 'BLOCKED' }`,
  writeTemp: "try { $f = Join-Path $env:TEMP ('direct-bench-' + $PID); Set-Content -LiteralPath $f x -ErrorAction Stop; Remove-Item $f; 'WROTE' } catch { 'BLOCKED' }",
  network: "try { $null = Invoke-WebRequest https://example.com -UseBasicParsing -TimeoutSec 5; 'OPEN' } catch { 'BLOCKED' }",
  credential: "$p = Join-Path $HOME '.codex\\auth.json'; if (Test-Path $p) { try { $null = Get-Content $p -ErrorAction Stop; 'READABLE' } catch { 'BLOCKED' } } else { 'ABSENT' }",
  secretNames: "@(Get-ChildItem env: | Where-Object { $_.Name -match 'key|token|secret|password' }).Count",
  envCount: "@(Get-ChildItem env:).Count",
  home: "Write-Output $HOME",
};

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;
}
const ms = (start) => Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
const now = () => process.hrtime.bigint();

async function setupBackend(id) {
  if (id === "direct") {
    if (remote) {
      const workspaceBackends = new WorkspaceBackendManager({ agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"), fallbackRoot: repoRoot });
      const backend = new EnvironmentExecutorProcessBackend({ workspaceBackends });
      return {
        exec: new DirectStatefulExecSessionManager({ backendResolver: () => backend }),
        files: new DirectFullAccessLocalEnvironmentExecutor({ executorFilePort: new ExecutorFilePort({ workspaceBackends }) }),
        dispose: () => workspaceBackends.disposeAll(),
      };
    }
    return {
      exec: new DirectStatefulExecSessionManager({ workspaceRootResolver: () => workspaceRoot }),
      files: new DirectFullAccessLocalEnvironmentExecutor({ workspaceRootResolver: () => workspaceRoot }),
      dispose: () => {},
    };
  }
  const manager = new CodexExecServerManager({ fallbackRoot: repoRoot });
  const backend = new CodexExecServerProcessBackend({ manager });
  const port = new CodexExecServerFilePort({ manager });
  return {
    exec: new DirectStatefulExecSessionManager({ backendResolver: () => backend }),
    files: new DirectFullAccessLocalEnvironmentExecutor({ filePortOverride: () => port }),
    manager,
    dispose: () => manager.disposeAll(),
  };
}

async function run(context, bind, cmd, options = {}) {
  const start = now();
  const started = context.exec.start({ ...bind, cmd, stdinPolicy: options.stdin ? "line_input" : "disabled", ...(options.tty ? { tty: true, rows: options.tty.rows, cols: options.tty.cols } : {}) });
  if (options.afterStart) await options.afterStart(started);
  const result = await context.exec.wait({ ...bind, sessionId: started.sessionId });
  return { ms: ms(start), result, text: `${result.stdoutPreview || ""}`.trim(), error: result.spawnError || result.errorCode || "" };
}

async function timed(fn) {
  const start = now();
  try {
    const value = await fn();
    return { ms: ms(start), value };
  } catch (error) {
    return { ms: ms(start), error: error?.code || error?.message || String(error) };
  }
}

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function suite(id) {
  const context = await setupBackend(id);
  const full = binding("full_access", id);
  const workspace = binding("workspace", id);
  const readOnly = binding("read_only", id);
  const rows = {};
  const put = (metric, value) => { rows[metric] = value; };
  try {
    const cold = await run(context, full, commands.echo);
    put("cold start: first command (ms)", cold.text === "hi" ? cold.ms : `failed: ${cold.error || cold.text}`);
    if (context.manager) {
      const status = context.manager.status().connections[0];
      put("exec-server version", status ? `${status.executorVersion} (${status.platformOs})` : "n/a");
      put("exec-server startup (ms)", status?.startupMs ?? "n/a");
    } else {
      put("exec-server version", "n/a");
      put("exec-server startup (ms)", "n/a");
    }
    for (const [label, bind] of [["Full access", full], ["Workspace", workspace]]) {
      const samples = [];
      let failure = "";
      for (let index = 0; index < iterations; index += 1) {
        const sample = await run(context, bind, commands.echo);
        if (sample.text !== "hi") failure ||= sample.error || sample.text || sample.result.status;
        samples.push(sample.ms);
      }
      put(`echo, ${label}: p50 / p95 (ms)`, failure ? `failed: ${failure}` : `${percentile(samples, 50)} / ${percentile(samples, 95)}`);
    }
    const bulk = await run(context, full, commands.bulk);
    put("2 MB of output (ms)", bulk.result.status === "completed" ? bulk.ms : `failed: ${bulk.error || bulk.result.status}`);

    const stdin = await run(context, full, commands.stdin, {
      stdin: true,
      afterStart: async (started) => {
        await sleep(150);
        context.exec.writeStdin({ ...full, sessionId: started.sessionId, chars: "hello\n" });
      },
    });
    put("stdin line round trip", stdin.text.includes("got:hello") ? `ok (${stdin.ms} ms)` : `failed: ${stdin.error || stdin.text}`);
    const eof = await run(context, full, commands.eof, {
      stdin: true,
      afterStart: async (started) => {
        await sleep(150);
        try {
          context.exec.writeStdin({ ...full, sessionId: started.sessionId, chars: "data\n", eof: true });
        } catch {}
        setTimeout(() => { try { context.exec.cancel({ ...full, sessionId: started.sessionId }); } catch {} }, 5_000).unref();
      },
    });
    put("stdin EOF (read to end)", eof.text.includes("data") && eof.result.status === "completed" ? `ok (${eof.ms} ms)` : `${eof.result.status}: ${eof.result.stdinErrorCode || eof.error || "no output"}`);
    const cancel = await run(context, full, commands.sleep, {
      afterStart: async (started) => {
        await sleep(300);
        context.exec.cancel({ ...full, sessionId: started.sessionId });
      },
    });
    put("cancel a running command (ms after request)", cancel.result.status === "cancelled" ? Math.round(cancel.ms - 300) : `failed: ${cancel.result.status}`);
    const tty = await run(context, full, commands.ttySize, { tty: { rows: 30, cols: 100 } });
    const size = tty.text.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z]/g, "").match(/(\d+)\s+(\d+)/);
    put("terminal asked for 30x100 reports", size ? `${size[1]}x${size[2]}` : `failed: ${tty.error || tty.result.status}`);

    const home = (await run(context, full, commands.home)).text;
    for (const [label, bind] of [["Workspace", workspace], ["Read only", readOnly]]) {
      put(`${label}: write inside project`, (await run(context, bind, commands.writeInside)).text || "error");
      put(`${label}: write outside project`, (await run(context, bind, commands.writeOutside)).text || "error");
      put(`${label}: write temp folder`, (await run(context, bind, commands.writeTemp)).text || "error");
      put(`${label}: network`, (await run(context, bind, commands.network)).text || "error");
      put(`${label}: read ~/.codex/auth.json`, (await run(context, bind, commands.credential)).text || "error");
      put(`${label}: secret-looking variable names`, (await run(context, bind, commands.secretNames)).text || "error");
      put(`${label}: environment variables`, (await run(context, bind, commands.envCount)).text || "error");
      if (target === "wsl" || (linux && process.env.WSL_DISTRO_NAME)) {
        put(`${label}: /mnt entries visible`, (await run(context, bind, commands.windowsDrives)).text || "error");
        put(`${label}: Windows process via interop`, (await run(context, bind, commands.interop)).text === "0" ? "BLOCKED" : "STARTED");
      }
    }
    put("Full access: read ~/.codex/auth.json", (await run(context, full, commands.credential)).text || "error");

    // File tools.
    for (const [label, bind] of [["Full access", full], ["Workspace", workspace]]) {
      const readSamples = [];
      let readFailure = "";
      for (let index = 0; index < iterations; index += 1) {
        const sample = await timed(() => context.files.request(bind, "readFile", { relPath: "src/a.txt" }));
        if (sample.error || sample.value.text !== "alpha\n") readFailure ||= sample.error || "wrong text";
        readSamples.push(sample.ms);
      }
      put(`read_file small, ${label}: p50 / p95 (ms)`, readFailure ? `failed: ${readFailure}` : `${percentile(readSamples, 50)} / ${percentile(readSamples, 95)}`);
    }
    const big = await timed(() => context.files.request(workspace, "readFile", { relPath: "src/big.txt" }));
    put("read_file 300 KB (ms)", big.error ? `failed: ${big.error}` : big.ms);
    const image = await timed(() => context.files.request(workspace, "readImage", { relPath: "src/pixel.png" }));
    put("view_image (ms)", image.error ? `failed: ${image.error}` : `${image.ms} (${image.value.mimeType})`);
    const patchSamples = [];
    let patchFailure = "";
    let current = "v0";
    for (let index = 0; index < iterations; index += 1) {
      const next = `v${index + 1}`;
      const sample = await timed(() => context.files.request(workspace, "applyPatch", {
        mode: "apply",
        patch: ["*** Begin Patch", "*** Update File: src/p.txt", "@@", `-${current}`, `+${next}`, "*** End Patch"].join("\n"),
      }));
      if (sample.error) patchFailure ||= sample.error;
      else current = next;
      patchSamples.push(sample.ms);
    }
    put("apply_patch update: p50 / p95 (ms)", patchFailure ? `failed: ${patchFailure}` : `${percentile(patchSamples, 50)} / ${percentile(patchSamples, 95)}`);
    const add = await timed(() => context.files.request(workspace, "applyPatch", { mode: "apply", patch: ["*** Begin Patch", "*** Add File: src/new/deep/n.txt", "+n", "*** End Patch"].join("\n") }));
    const remove = await timed(() => context.files.request(workspace, "applyPatch", { mode: "apply", patch: ["*** Begin Patch", "*** Delete File: src/new/deep/n.txt", "@@", "-n", "*** End Patch"].join("\n") }));
    put("apply_patch add + delete (ms)", add.error || remove.error ? `failed: ${add.error || remove.error}` : `${add.ms} + ${remove.ms}`);
    const outsidePatch = await timed(() => context.files.request(workspace, "applyPatch", {
      mode: "apply",
      patch: ["*** Begin Patch", `*** Update File: ${api.join(outsideRoot, "b.txt")}`, "@@", "-beta", "+hacked", "*** End Patch"].join("\n"),
    }));
    put("Workspace: patch outside project", outsidePatch.error ? `BLOCKED (${outsidePatch.error})` : "APPLIED");
    if (linux) {
      await run(context, full, commands.symlink);
      const escape = await timed(() => context.files.request(workspace, "applyPatch", {
        mode: "apply",
        patch: ["*** Begin Patch", "*** Update File: escape/b.txt", "@@", "-beta", "+hacked", "*** End Patch"].join("\n"),
      }));
      put("Workspace: patch through a symlink out", escape.error ? `BLOCKED (${escape.error})` : "APPLIED");
      await run(context, full, "rm -f escape");
    }
    const credentialRead = home ? await timed(() => context.files.request(workspace, "readFile", { relPath: api.join(home, ".codex", "auth.json") })) : { error: "no home" };
    put("Workspace: read_file ~/.codex/auth.json", credentialRead.error ? `BLOCKED (${credentialRead.error})` : "READABLE");
    const readOnlyPatch = await timed(() => context.files.request(readOnly, "applyPatch", { mode: "apply", patch: ["*** Begin Patch", "*** Add File: src/ro.txt", "+x", "*** End Patch"].join("\n") }));
    put("Read only: apply_patch", readOnlyPatch.error ? `BLOCKED (${readOnlyPatch.error})` : "APPLIED");
  } finally {
    await context.exec.dispose("benchmark").catch(() => {});
    context.dispose();
  }
  return rows;
}

const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await fs.mkdir(hostPath(api.join(workspaceRoot, "src")), { recursive: true });
await fs.mkdir(hostPath(outsideRoot), { recursive: true });
const writeFixtures = async () => {
  await fs.writeFile(hostPath(api.join(workspaceRoot, "src", "a.txt")), "alpha\n");
  await fs.writeFile(hostPath(api.join(workspaceRoot, "src", "big.txt")), "x".repeat(300 * 1024));
  await fs.writeFile(hostPath(api.join(workspaceRoot, "src", "pixel.png")), PIXEL_PNG);
  await fs.writeFile(hostPath(api.join(workspaceRoot, "src", "p.txt")), "v0\n");
  await fs.writeFile(hostPath(api.join(outsideRoot, "b.txt")), "beta\n");
  await fs.rm(hostPath(api.join(workspaceRoot, "inside.txt")), { force: true });
  await fs.rm(hostPath(api.join(outsideRoot, "w.txt")), { force: true });
};

const report = {
  schema: "direct_exec_backend_benchmark@1",
  hostPlatform: process.platform,
  target: target === "wsl" ? `wsl:${distro}` : target === "windows" ? "windows (from WSL)" : "local",
  targetPlatform,
  iterations,
  codexVersion: (() => {
    const probe = target === "wsl"
      ? spawnSync("wsl.exe", ["-d", distro, "--", "bash", "-lc", "codex --version"], { encoding: "utf8" })
      : target === "windows"
        ? spawnSync("/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "codex --version"], { cwd: "/mnt/c", encoding: "utf8" })
        : spawnSync(onWindows ? "codex.cmd" : "codex", ["--version"], { encoding: "utf8", shell: onWindows });
    return (probe.stdout || "").trim() || "unknown";
  })(),
  backends: {},
};
try {
  for (const id of backendIds) {
    await writeFixtures();
    console.error(`running ${id}…`);
    report.backends[id] = await suite(id);
  }
} finally {
  await fs.rm(hostPath(workspaceRoot), { recursive: true, force: true }).catch(() => {});
  await fs.rm(hostPath(outsideRoot), { recursive: true, force: true }).catch(() => {});
}

const metrics = [...new Set(Object.values(report.backends).flatMap((rows) => Object.keys(rows)))];
const header = `| metric | ${backendIds.join(" | ")} |`;
const lines = [
  `exec backend benchmark — host ${report.hostPlatform}, workspace ${report.target}, ${report.codexVersion}, ${iterations} iterations`,
  "",
  header,
  `|${"---|".repeat(backendIds.length + 1)}`,
  ...metrics.map((metric) => `| ${metric} | ${backendIds.map((id) => String(report.backends[id]?.[metric] ?? "—")).join(" | ")} |`),
];
console.log(lines.join("\n"));
if (outFile) await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
