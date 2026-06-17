#!/usr/bin/env node

import assert from "node:assert/strict";
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
  buildDirectHeadlessToolClassLiveSmokeReport,
  validateDirectHeadlessToolClassLiveSmokeReport,
} = require("../src/main/direct/headless/tool-class-live-smoke-report");
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

function writeReportIfRequested(report, outputPath) {
  const safePath = normalizeString(outputPath, "");
  if (!safePath) return "";
  const absolute = path.isAbsolute(safePath) ? safePath : path.join(repoRoot, safePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

function smokeResultsForGate(gate) {
  return gate.rows
    .filter((row) => row.eligibleForLiveSmoke)
    .map((row) => ({
      exampleId: row.exampleId,
      toolClassId: row.toolClassId,
      liveSmokeRoute: row.liveSmokeRoute,
      status: "passed",
      durationMs: 10,
      providerTransportStarted: false,
      workspaceMutationStartedBySmoke: false,
      satisfiedConditions: row.requiredConditions,
      evidenceRefs: [{
        kind: "headless_live_smoke_fixture_evidence",
        refId: `fixture_${row.exampleId}`,
        state: "passed",
        rendererSafe: true,
      }],
    }));
}

const options = parseArgs(process.argv.slice(2));
const executeLiveSmoke = options.flags.has("execute-live-smoke");
const registry = buildToolCapabilityRegistry({
  projectId: "project_headless_tool_live_smoke_report_fixture",
  nowMs: 0,
});
assert.equal(validateToolCapabilityRegistry(registry), true, "tool capability registry should validate");

const pack = buildDirectHeadlessToolClassExamplePack({
  registry,
  projectId: "project_headless_tool_live_smoke_report_fixture",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassExamplePack(pack), [], "example pack should validate before live smoke report");

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
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(validateOnlyGate), [], "validate-only candidate gate should validate");

const planOnlyReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate: validateOnlyGate,
  executionMode: "plan_only",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(planOnlyReport), [], "plan-only live smoke report should validate");
assert.equal(planOnlyReport.status, "passed", "plan-only live smoke report should pass");
assert.equal(planOnlyReport.liveSmokePassedCount, 0, "plan-only report must not claim live smoke passed");
assert.equal(planOnlyReport.providerTransportStarted, false, "plan-only report must not start provider transport");
assert.equal(planOnlyReport.liveSmokeStartedByRunner, false, "plan-only report must not start live smoke");
assert.equal(planOnlyReport.summary.bySmokeStatus.blocked_by_candidate_gate, 18, "validate-only gate rows should stay blocked from live smoke");

const executedRealismReport = buildDirectHeadlessToolClassRealismReport({
  pack,
  executionMode: "execute_fixtures",
  fixtureExecution: {
    mode: "execute_fixtures",
    results: [...new Set(pack.examples.flatMap((example) => example.runnerScripts || []))]
      .map((scriptPath) => ({ scriptPath, status: "passed", durationMs: 1 })),
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassRealismReport(executedRealismReport), [], "executed realism report should validate");
const candidateGate = buildDirectHeadlessToolClassLiveCandidateGate({
  realismReport: executedRealismReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(candidateGate), [], "candidate gate should validate");
assert.equal(candidateGate.eligibleCandidateCount, 5, "fixture-proven gate should have five candidates");

const missingOptInReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: "execute_live_smoke",
  smokeExecution: {
    mode: "execute_live_smoke",
    allowLiveProviderCall: false,
    results: smokeResultsForGate(candidateGate),
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(missingOptInReport), [], "missing-opt-in report should remain structurally valid");
assert.equal(missingOptInReport.status, "failed", "execute-live-smoke without opt-in should fail");
assert(missingOptInReport.validationErrors.includes("live_provider_opt_in_missing"), "missing opt-in should be explicit");

let smokeExecution = {
  mode: "not_requested",
  results: [],
};
if (executeLiveSmoke) {
  smokeExecution = {
    mode: "execute_live_smoke",
    allowLiveProviderCall: true,
    results: smokeResultsForGate(candidateGate),
  };
}

const report = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: executeLiveSmoke ? "execute_live_smoke" : "plan_only",
  smokeExecution,
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(report), [], "final live smoke report should validate");
if (executeLiveSmoke) {
  assert.equal(report.status, "passed", "executed live smoke report should pass with supplied passing evidence");
  assert.equal(report.liveSmokePassedCount, 5, "executed live smoke report should pass all five candidates");
  assert.equal(report.summary.bySmokeStatus.live_smoke_passed, 5, "executed live smoke pass count should match");
  assert.equal(report.summary.bySmokeStatus.blocked_by_candidate_gate, 13, "executed live smoke should preserve blocked rows");
  assert.equal(report.providerTransportStarted, false, "fixture-supplied smoke evidence must not start provider transport");
  assert.equal(report.promotionGranted, false, "live smoke success must not grant promotion");
} else {
  assert.equal(report.status, "passed", "default report should pass as a plan-only report");
  assert.equal(report.liveSmokePassedCount, 0, "default report should not pass smoke rows");
  assert.equal(report.summary.bySmokeStatus.live_smoke_not_requested, 5, "default report should leave candidates unexecuted");
  assert.equal(report.summary.bySmokeStatus.blocked_by_candidate_gate, 13, "default report should preserve blocked rows");
}

const outputPath = writeReportIfRequested(report, options.output);
console.log(JSON.stringify({
  ok: true,
  reportId: report.reportId,
  reportDigest: report.reportDigest,
  status: report.status,
  executionMode: report.executionMode,
  liveSmokePassedCount: report.liveSmokePassedCount,
  outputPath,
  summary: report.summary,
}, null, 2));
