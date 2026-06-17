#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const checks = [
  {
    id: "diagnostic_event",
    script: "direct-headless-bridge-substrate-regression.mjs",
  },
  {
    id: "direct_text_route",
    script: "direct-headless-text-runtime-regression.mjs",
  },
  {
    id: "implementation_lane_fixture",
    script: "direct-headless-implementation-runtime-regression.mjs",
  },
  {
    id: "reducer_write_artifact_human_decision",
    script: "direct-headless-output-outbox-regression.mjs",
  },
  {
    id: "electron_control_surface",
    script: "direct-headless-control-surface-regression.mjs",
  },
  {
    id: "first_tool_slice",
    script: "direct-first-tool-slice-regression.mjs",
  },
];

const rows = [];

for (const check of checks) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [path.join(scriptDir, check.script)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  });
  const durationMs = Date.now() - startedAt;
  rows.push({
    id: check.id,
    script: check.script,
    status: child.status === 0 ? "passed" : "failed",
    durationMs,
    stderrPreview: child.stderr ? child.stderr.slice(0, 1000) : "",
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
}

const failed = rows.filter((row) => row.status !== "passed");
const report = {
  schema: "direct_headless_promotion_suite_report@1",
  status: failed.length ? "failed" : "passed",
  rowCount: rows.length,
  passedCount: rows.length - failed.length,
  failedCount: failed.length,
  rows,
  providerCallsStartedBySuite: 0,
  rendererAuthorityGranted: false,
  externalDeliveryEnabled: false,
};

console.log(JSON.stringify(report, null, 2));
assert.equal(failed.length, 0, "direct_headless_promotion_suite_failed");
