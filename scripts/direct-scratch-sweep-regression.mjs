#!/usr/bin/env node
// Scratch TEMP folders of Windows commands are removed when the command
// closes; after a crash they stayed forever. The sandbox now sweeps scratch
// folders older than a day when it first starts in a process, leaving
// younger ones (another app instance may be using them) and anything that
// isn't a scratch folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sweepStaleScratch, STALE_SCRATCH_MS } = require("../src/main/direct/tools/windows-job-runner.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-scratch-sweep-"));
try {
  const now = Date.now();
  const make = (name, ageMs) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "left-behind.tmp"), "x");
    const when = new Date(now - ageMs);
    fs.utimesSync(dir, when, when);
    return dir;
  };
  const stale = make("0123456789abcdef", STALE_SCRATCH_MS + 60_000);
  const fresh = make("fedcba9876543210", 60_000);
  const notScratch = make("keep-me", STALE_SCRATCH_MS * 3);
  const result = await sweepStaleScratch(root, { now: () => now });
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(stale), false, "a day-old scratch folder is removed");
  assert.equal(fs.existsSync(fresh), true, "a recent one stays (it may be in use)");
  assert.equal(fs.existsSync(notScratch), true, "only scratch folders are touched");
  assert.deepEqual(await sweepStaleScratch(path.join(root, "missing")), { removed: 0, kept: 0 }, "a missing root is fine");
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
