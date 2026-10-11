#!/usr/bin/env node

// Syntax-checks named groups of files from scripts/syntax-check-groups.json:
// `node --check` per file, each file once, several at a time. An entry
// starting with @ includes another group.
//
//   node scripts/check-syntax.mjs <group>...    (check:syntax is group all)
//   node scripts/check-syntax.mjs --list <group>

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "scripts", "syntax-check-groups.json");
const { groups } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const args = process.argv.slice(2);
const list = args[0] === "--list";
const names = list ? args.slice(1) : args;
if (!names.length) {
  console.error(`usage: node scripts/check-syntax.mjs [--list] <group>...\ngroups: ${Object.keys(groups).join(", ")}`);
  process.exit(2);
}

function collect(name, files, seen) {
  if (seen.has(name)) return;
  seen.add(name);
  const entries = groups[name];
  if (!Array.isArray(entries)) {
    console.error(`unknown syntax group: ${name} (in ${path.relative(repoRoot, manifestPath)})`);
    process.exit(2);
  }
  for (const entry of entries) {
    if (entry.startsWith("@")) collect(entry.slice(1), files, seen);
    else files.add(entry);
  }
}

const files = new Set();
const seen = new Set();
for (const name of names) collect(name, files, seen);
if (list) {
  for (const file of files) console.log(file);
  process.exit(0);
}

function check(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ file, ok: false, stderr: error.message }));
    child.on("close", (code) => resolve({ file, ok: code === 0, stderr }));
  });
}

const queue = [...files];
const failures = [];
const workers = Array.from({ length: Math.min(queue.length, Math.max(2, os.availableParallelism?.() ?? os.cpus().length)) }, async () => {
  while (queue.length) {
    const result = await check(queue.shift());
    if (!result.ok) failures.push(result);
  }
});
await Promise.all(workers);

for (const failure of failures) {
  console.error(`FAILED ${failure.file}\n${failure.stderr.trim()}\n`);
}
const label = names.join(", ");
if (failures.length) {
  console.error(`syntax: ${failures.length} of ${files.size} files failed (${label})`);
  process.exit(1);
}
console.log(`syntax: ${files.size} files ok (${label})`);
