#!/usr/bin/env node
// The job runner's receipt: proof that a command and everything it started
// are gone, the Windows counterpart of a Linux PID namespace. With a control
// channel, a finished command's receipt says the job is empty; a cancel
// stops a running command and the descendants it left behind (even
// detached ones, which `taskkill /T` can miss) before the receipt is
// written; and request finalization in the workspace backend accepts only
// such a receipt. Windows only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "win32") {
  console.log("SKIPPED: Windows-only (run with Windows Node).");
  process.exit(77);
}
const require = createRequire(import.meta.url);
const { WindowsJobSandbox, windowsJobReceipt } = require("../src/main/direct/tools/windows-job-runner.js");
const { terminateWorkspaceProcessTree } = require("../src/backend/workspace-process-tree.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-job-receipt-"));
const sandbox = new WindowsJobSandbox();
const beat = path.join(root, "beat.txt");
// Keeps writing its pid to beat.txt until it is killed.
const beater = path.join(root, "beater.js");
fs.writeFileSync(beater, `setInterval(() => require("fs").writeFileSync(${JSON.stringify(beat)}, String(process.pid)), 50);`);
const spawnBeater = (detached) => `const c=require("child_process").spawn(process.execPath,[${JSON.stringify(beater)}],{detached:${detached},stdio:"ignore"});c.unref();`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(args) {
  const plan = sandbox.wrap({ sandboxMode: "danger-full-access", command: process.execPath, args, control: true });
  const child = spawn(plan.command, plan.args, { cwd: root, env: { ...process.env, ...plan.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.workspaceProcessContainment = { guaranteed: true, kind: "windows_job_object", controlPath: plan.controlPath };
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  child.output = () => `${stdout}${stderr}`;
  return { child, plan };
}

try {
  // A command that finishes: the receipt says the job is empty.
  const quick = run(["-e", "console.log(`done`)"]);
  assert.equal(await quick.child.closed, 0, quick.child.output());
  const quickReceipt = await windowsJobReceipt(quick.plan.controlPath, { timeoutMs: 5_000 });
  assert.deepEqual([quickReceipt.quiesced, quickReceipt.jobClosed, quickReceipt.activeProcesses, quickReceipt.exitCode], [true, true, 0, 0]);

  // A command that leaves a detached grandchild running: the grandchild
  // dies with the job when the command exits, and the receipt says so.
  const leaver = run(["-e", `${spawnBeater(true)}setTimeout(()=>process.exit(0),600)`]);
  assert.equal(await leaver.child.closed, 0, leaver.child.output());
  const leftPid = Number(fs.readFileSync(beat, "utf8"));
  const leaverReceipt = await windowsJobReceipt(leaver.plan.controlPath, { timeoutMs: 5_000 });
  assert.equal(leaverReceipt.quiesced, true);
  await sleep(200);
  assert.equal(alive(leftPid), false, "the detached grandchild is gone");

  // Cancelling a running command (with a child) through the workspace
  // process-tree helper: the receipt proves both are gone.
  fs.rmSync(beat, { force: true });
  const runner = run(["-e", `${spawnBeater(false)}setInterval(()=>{},1000)`]);
  for (let index = 0; index < 100 && !fs.existsSync(beat); index += 1) await sleep(50);
  const runningPid = Number(fs.readFileSync(beat, "utf8"));
  const cancelled = await terminateWorkspaceProcessTree(runner.child, { timeoutMs: 5_000 });
  assert.deepEqual([cancelled.quiesced, cancelled.method], [true, "windows_job_object_closed"], JSON.stringify(cancelled));
  await runner.child.closed;
  assert.equal(alive(runningPid), false, "the running command's child is gone");

  // Without a control channel there is no proof: the helper reports
  // unverified, as before.
  const plain = spawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { windowsHide: true, stdio: "ignore" });
  const unverified = await terminateWorkspaceProcessTree(plain, { timeoutMs: 2_000 });
  assert.equal(unverified.quiesced, false);
  console.log(JSON.stringify({ ok: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
