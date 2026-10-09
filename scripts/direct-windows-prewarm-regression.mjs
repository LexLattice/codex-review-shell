#!/usr/bin/env node
// Windows commands start in an already-running PowerShell (one idle shell per
// launch shape, inside the job runner), so they skip PowerShell's ~0.4 s
// startup. The command must behave exactly as `pwsh -Command <script>` did:
// same output, same exit codes (a failing last statement exits 1), UTF-8,
// and stdin after the command belongs to the command. Windows only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "win32") {
  console.log("SKIPPED: Windows-only (run with Windows Node).");
  process.exit(77);
}
const require = createRequire(import.meta.url);
const { LocalChildProcessBackend, BASE_COMMAND_ENVIRONMENT_KEYS } = require("../src/main/direct/tools/exec-process-backends.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-prewarm-"));
const env = Object.fromEntries(BASE_COMMAND_ENVIRONMENT_KEYS.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
const backend = new LocalChildProcessBackend({ workspaceRootResolver: () => root });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(shellCommand, { sandboxMode = "danger-full-access", stdin = null, stdinDelayMs = 800 } = {}) {
  const plan = backend.planLaunch({ shellCommand, sandboxMode, workspace: { root, cwd: root } });
  assert.ok(plan.prewarmScriptLine, "command strings take the prewarm path");
  const started = Date.now();
  const handle = backend.launch(plan, { cwd: root, env });
  let out = "";
  let err = "";
  handle.onStdout((chunk) => { out += chunk; });
  handle.onStderr((chunk) => { err += chunk; });
  const feed = () => { handle.writeStdin(stdin); handle.endStdin(); };
  if (stdin && stdinDelayMs === 0) feed();
  else if (stdin) setTimeout(feed, stdinDelayMs);
  return new Promise((resolve) => handle.onClose((code) => resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - started })));
}
async function warmUp() {
  const deadline = Date.now() + 15_000;
  while (backend.prewarmed.size === 0 && Date.now() < deadline) await sleep(50);
  await sleep(1500); // let the idle shell finish starting
}

try {
  const first = await run("Write-Output hi");
  assert.deepEqual([first.code, first.out], [0, "hi"]);
  assert.equal(backend.prewarmStats.cold, 1);
  const cases = [
    ["exit 3", 3, ""],
    ["cmd /c exit 5", 1, ""],
    ["cmd /c exit 5; Write-Output after", 0, "after"],
    ["Write-Error 'soft'", 1, ""],
    ["throw 'boom'", 1, ""],
    ["$x = 2; $x * 21", 0, "42"],
    ["Write-Output 'héllo ✓'", 0, "héllo ✓"],
    ["(Get-Location).Path", 0, fs.realpathSync(root)],
  ];
  const warmTimes = [];
  for (const [script, code, out] of cases) {
    await warmUp();
    const result = await run(script);
    assert.deepEqual([result.code, result.out], [code, out], `${script}: ${JSON.stringify(result)}`);
    warmTimes.push(result.ms);
  }
  assert.equal(backend.prewarmStats.warm, cases.length, "every later command used an idle shell");

  // stdin written after the command reaches it (here a PowerShell read; a
  // native child reads the same handle).
  await warmUp();
  const piped = await run("$l = [Console]::In.ReadLine(); \"got $l\"", { stdin: "abc\n" });
  assert.equal(piped.out, "got abc");

  // Input sent right away, before the shell has read its command line, still
  // belongs to the command, also to a native program it starts (the shell
  // must not read ahead of its command line).
  const nativeReader = `& '${process.execPath}' -e 'let s=\`\`;process.stdin.on(\`data\`,(d)=>s+=d).on(\`end\`,()=>console.log(\`native:\`+s.trim()))'`;
  await warmUp();
  const warmEarly = await run(nativeReader, { stdin: "early-warm\n", stdinDelayMs: 0 });
  assert.equal(warmEarly.out, "native:early-warm", JSON.stringify(warmEarly));
  backend.disposePrewarmed();
  const coldEarly = await run(nativeReader, { stdin: "early-cold\n", stdinDelayMs: 0 });
  assert.equal(coldEarly.out, "native:early-cold", JSON.stringify(coldEarly));

  // A sandboxed profile gets its own idle shell (a different launch shape).
  const sandboxed = await run("Write-Output low", { sandboxMode: "workspace-write" });
  assert.deepEqual([sandboxed.code, sandboxed.out], [0, "low"]);
  await warmUp();
  const sandboxedWarm = await run("Write-Output low-again", { sandboxMode: "workspace-write" });
  assert.equal(sandboxedWarm.out, "low-again");

  backend.disposePrewarmed();
  assert.equal(backend.prewarmed.size, 0);

  // Opening a thread warms its default shape, so even the first command
  // starts warm.
  assert.equal(backend.prewarmShape(backend.planLaunch({ shellCommand: "prewarm", sandboxMode: "danger-full-access", workspace: { root, cwd: root } }), { cwd: root, env }), true);
  const before = { ...backend.prewarmStats };
  await warmUp();
  const firstAfterOpen = await run("Write-Output opened");
  assert.equal(firstAfterOpen.out, "opened");
  assert.equal(backend.prewarmStats.warm, before.warm + 1, "the first command after opening used the warmed shell");
  assert.equal(backend.prewarmStats.cold, before.cold);
  backend.disposePrewarmed();
  console.log(JSON.stringify({ ok: true, coldMs: first.ms, warmMs: warmTimes, firstAfterOpenMs: firstAfterOpen.ms, stats: backend.prewarmStats }));
} finally {
  backend.disposePrewarmed();
  // Idle shells exit once their stdin closes; until then they hold the folder.
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {}
}
