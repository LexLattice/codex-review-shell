#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const {
  buildDirectHeadlessToolClassExamplePack,
  validateDirectHeadlessToolClassExamplePack,
} = require("../src/main/direct/headless/tool-class-examples");
const {
  buildDirectHeadlessToolClassRealismReport,
  validateDirectHeadlessToolClassRealismReport,
} = require("../src/main/direct/headless/tool-class-realism-report");
const {
  buildDirectHeadlessToolClassLiveCandidateGate,
  validateDirectHeadlessToolClassLiveCandidateGate,
} = require("../src/main/direct/headless/tool-class-live-candidate-gate");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

function parseArgs(argv) {
  const options = { flags: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
      continue;
    }
    options.flags.add(raw);
  }
  return options;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function processFailureMessage(error) {
  const base = String(error?.message || error);
  const stderr = typeof error?.stderr === "string"
    ? error.stderr
    : error?.stderr
      ? String(error.stderr)
      : "";
  return stderr ? `${base}\nStderr:\n${stderr}` : base;
}

function executeFixtureScripts(pack) {
  const scripts = unique(pack.examples.flatMap((example) => example.runnerScripts || []))
    .filter((scriptPath) => scriptPath.endsWith("-regression.mjs"));
  const results = [];
  for (const scriptPath of scripts) {
    const absolute = path.join(repoRoot, scriptPath);
    assert(fs.existsSync(absolute), `fixture script missing: ${scriptPath}`);
    const startedAt = Date.now();
    try {
      execFileSync(process.execPath, [absolute], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      results.push({
        scriptPath,
        status: "passed",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        scriptPath,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: processFailureMessage(error),
      });
    }
  }
  return results;
}

function writeGateIfRequested(gate, outputPath) {
  const safePath = normalizeString(outputPath, "");
  if (!safePath) return "";
  const absolute = path.isAbsolute(safePath) ? safePath : path.join(repoRoot, safePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(gate, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

const options = parseArgs(process.argv.slice(2));
const executeFixtures = options.flags.has("execute-fixtures");
const registry = buildToolCapabilityRegistry({
  projectId: "project_headless_tool_live_candidate_gate_fixture",
  nowMs: 0,
});
assert.equal(validateToolCapabilityRegistry(registry), true, "tool capability registry should validate");

const pack = buildDirectHeadlessToolClassExamplePack({
  registry,
  projectId: "project_headless_tool_live_candidate_gate_fixture",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassExamplePack(pack), [], "example pack should validate before live candidate gate");

const validateOnlyRealismReport = buildDirectHeadlessToolClassRealismReport({
  pack,
  executionMode: "validate_only",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassRealismReport(validateOnlyRealismReport), [], "validate-only realism report should validate");

const validateOnlyGate = buildDirectHeadlessToolClassLiveCandidateGate({
  realismReport: validateOnlyRealismReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(validateOnlyGate), [], "validate-only live candidate gate should validate");
assert.equal(validateOnlyGate.status, "passed", "validate-only gate should pass");
assert.equal(validateOnlyGate.eligibleCandidateCount, 0, "validate-only gate must not produce live candidates");
assert.equal(validateOnlyGate.summary.byGateStatus.blocked_fixture_not_executed, 5, "validate-only fixture rows should remain blocked");
assert.equal(validateOnlyGate.summary.byGateStatus.blocked_projection_only, 10, "projection rows should remain blocked");
assert.equal(validateOnlyGate.summary.byGateStatus.blocked_unsupported, 3, "unsupported rows should remain blocked");
assert.equal(validateOnlyGate.providerTransportStarted, false, "gate must not start provider transport");
assert.equal(validateOnlyGate.liveSmokeStartedByGate, false, "gate must not start live smoke");

const failedRealismReport = buildDirectHeadlessToolClassRealismReport({
  pack,
  executionMode: "execute_fixtures",
  fixtureExecution: {
    mode: "not_requested",
    results: [],
  },
  nowMs: 0,
});
assert.equal(failedRealismReport.status, "failed", "fixture execution mismatch should fail realism report");
const failedGate = buildDirectHeadlessToolClassLiveCandidateGate({
  realismReport: failedRealismReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(failedGate), [], "failed-source gate should still be structurally valid");
assert.equal(failedGate.status, "failed", "gate should fail when source realism report failed");
assert(failedGate.validationErrors.some((error) => error.startsWith("realism_report_not_passed")), "failed gate should cite source realism failure");

const malformedRowGate = buildDirectHeadlessToolClassLiveCandidateGate({
  realismReport: {
    ...validateOnlyRealismReport,
    rows: [null, ...validateOnlyRealismReport.rows],
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(malformedRowGate), [], "malformed-row gate should remain structurally valid");
assert.equal(malformedRowGate.status, "failed", "malformed-row gate should fail from source validation");
assert.equal(malformedRowGate.rows[0].gateStatus, "blocked_invalid_realism", "null realism rows should become invalid blocked rows");

let fixtureExecution = {
  mode: "not_requested",
  results: [],
};
if (executeFixtures) {
  const results = executeFixtureScripts(pack);
  const failed = results.filter((result) => result.status !== "passed");
  assert.equal(failed.length, 0, `fixture execution failed: ${failed.map((result) => `${result.scriptPath}:${result.error}`).join("; ")}`);
  fixtureExecution = {
    mode: "execute_fixtures",
    results,
  };
}

const realismReport = buildDirectHeadlessToolClassRealismReport({
  pack,
  fixtureExecution,
  executionMode: executeFixtures ? "execute_fixtures" : "validate_only",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassRealismReport(realismReport), [], "final realism report should validate");
const gate = buildDirectHeadlessToolClassLiveCandidateGate({
  realismReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(gate), [], "final live candidate gate should validate");
assert.equal(gate.status, "passed", "final live candidate gate should pass");
if (executeFixtures) {
  assert.equal(gate.eligibleCandidateCount, 5, "executed gate should mark five classes as live-smoke candidates");
  assert.equal(gate.summary.byGateStatus.eligible_live_candidate, 5, "executed gate eligible count should match");
  assert.equal(gate.summary.byGateStatus.blocked_projection_only, 10, "executed gate should preserve projection blocks");
  assert.equal(gate.summary.byGateStatus.blocked_unsupported, 3, "executed gate should preserve unsupported blocks");
  assert(gate.rows.filter((row) => row.eligibleForLiveSmoke).every((row) => row.requiredConditions.includes("explicit_live_smoke_mode_required")), "eligible rows should require explicit live smoke mode");
  const execSessionRow = gate.rows.find((row) => row.toolClassId === "workspace_process.stateful_exec_session");
  assert(execSessionRow?.requiredConditions.includes("process_spawn_policy_required"), "stateful exec candidate should require process policy");
} else {
  assert.equal(gate.eligibleCandidateCount, 0, "default gate should not mark candidates without fixture execution");
  assert.equal(gate.summary.byGateStatus.blocked_fixture_not_executed, 5, "default gate should block unexecuted fixtures");
}

const outputPath = writeGateIfRequested(gate, options.output);
console.log(JSON.stringify({
  ok: true,
  gateId: gate.gateId,
  gateDigest: gate.gateDigest,
  status: gate.status,
  sourceRealismExecutionMode: gate.sourceRealismExecutionMode,
  eligibleCandidateCount: gate.eligibleCandidateCount,
  outputPath,
  summary: gate.summary,
}, null, 2));
