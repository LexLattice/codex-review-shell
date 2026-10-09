#!/usr/bin/env node
// Runs every scripts/*-regression.mjs with this Node and reports which ones
// failed: the same sweep as direct-regression-sweep.sh, but it runs on
// Windows too (Windows Node over the UNC path tests the Windows side).
//
//   node scripts/direct-regression-sweep.mjs [--out FILE.tsv] [--only REGEX]
//                                            [--jobs N] [--timeout-s 300]
//
// Exit code 77 from a regression means it skipped itself (something it
// needs isn't on this host); those are SKIPPED, not failures.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const out = path.resolve(option("out", path.join(os.tmpdir(), `direct-regression-sweep-${process.platform}.tsv`)));
const logDir = out.replace(/\.tsv$/i, "") + "-logs";
const only = option("only", "") ? new RegExp(option("only", "")) : null;
const jobs = Math.max(1, Number(option("jobs", 1)) || 1);
const timeoutMs = Math.max(10, Number(option("timeout-s", 300)) || 300) * 1000;

const names = fs.readdirSync(path.join(repoRoot, "scripts"))
  .filter((file) => file.endsWith("-regression.mjs"))
  .map((file) => file.slice(0, -".mjs".length))
  .filter((name) => !only || only.test(name))
  .sort();
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(out, "");

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const log = fs.openSync(path.join(logDir, `${name}.log`), "w");
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", `${name}.mjs`)], {
      cwd: repoRoot,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(log);
      const exit = code ?? (signal ? 124 : 1);
      fs.appendFileSync(out, `${exit}\t${Math.round((Date.now() - started) / 1000)}\t${name}\n`);
      resolve({ name, exit });
    });
  });
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, async () => {
  while (next < names.length) {
    const name = names[next++];
    const result = await runOne(name);
    results.push(result);
    if (result.exit !== 0 && result.exit !== 77) console.log(`FAILED ${name} (exit ${result.exit})`);
  }
}));
const failed = results.filter((result) => result.exit !== 0 && result.exit !== 77);
const skipped = results.filter((result) => result.exit === 77);
console.log(`regressions on ${process.platform}: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped of ${results.length} (logs: ${logDir})`);
for (const result of skipped.sort((a, b) => a.name.localeCompare(b.name))) console.log(`SKIPPED ${result.name}`);
for (const result of failed.sort((a, b) => a.name.localeCompare(b.name))) console.log(`FAILED ${result.name}`);
process.exitCode = failed.length ? 1 : 0;
