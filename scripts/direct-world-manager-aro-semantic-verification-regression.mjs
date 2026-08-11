#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "scripts/direct-world-manager-aro-worker-handoff-regression.mjs",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC84_ASSERT:
        "1",
      CODEX_WORLD_MANAGER_SC85_ASSERT:
        "1",
    },
    encoding: "utf8",
  },
);

assert.equal(
  result.status,
  0,
  result.stderr ||
    result.stdout ||
    "SC8.5 semantic-verification regression failed.",
);
const lines = result.stdout
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const summary = JSON.parse(
  lines[lines.length - 1],
);
assert.equal(summary.ok, true);
assert.equal(
  summary.slice,
  "WM-SC8.5",
);
assert.equal(
  summary.semanticVerificationCompleted,
  true,
);
assert.equal(
  summary.closureCandidateOnly,
  true,
);
assert.equal(
  summary.omittedObjectsMaterialized,
  true,
);
assert.equal(
  summary.optimisticRecommendationCannotOverrideGate,
  true,
);
assert.equal(
  summary.semanticVerificationRestartRecovered,
  true,
);
assert.equal(
  summary.generatedDecisionCount,
  1,
);
assert.equal(
  summary.canonicalAdmissionEffect,
  false,
);
assert.equal(
  summary.semanticClosureCertified,
  false,
);

console.log(JSON.stringify(summary));
