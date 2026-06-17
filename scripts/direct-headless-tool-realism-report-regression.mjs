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

function writeReportIfRequested(report, outputPath) {
  const safePath = normalizeString(outputPath, "");
  if (!safePath) return "";
  const absolute = path.isAbsolute(safePath) ? safePath : path.join(repoRoot, safePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

const options = parseArgs(process.argv.slice(2));
const executeFixtures = options.flags.has("execute-fixtures");
const registry = buildToolCapabilityRegistry({
  projectId: "project_headless_tool_realism_report_fixture",
  nowMs: 0,
});
validateToolCapabilityRegistry(registry);

const pack = buildDirectHeadlessToolClassExamplePack({
  registry,
  projectId: "project_headless_tool_realism_report_fixture",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassExamplePack(pack), [], "example pack should validate before realism report");

const validateOnlyReport = buildDirectHeadlessToolClassRealismReport({
  pack,
  executionMode: "validate_only",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassRealismReport(validateOnlyReport), [], "validate-only realism report should validate");
assert.equal(validateOnlyReport.status, "passed", "validate-only realism report should pass");
assert.equal(validateOnlyReport.summary.fixtureRowsAvailableNotExecuted, 5, "validate-only report should keep fixture rows unexecuted");
assert.equal(validateOnlyReport.summary.fixtureRowsPassed, 0, "validate-only report should not claim fixture rows passed");
assert.equal(validateOnlyReport.summary.projectionBlockedRows, 10, "projection-blocked row count should match the pack");
assert.equal(validateOnlyReport.summary.unsupportedBlockedRows, 3, "unsupported-blocked row count should match the pack");
assert.equal(validateOnlyReport.summary.realProviderUnassignedRows, 0, "no real-provider rows should exist yet");
assert.equal(validateOnlyReport.providerTransportStarted, false, "validate-only report must not start provider transport");
assert.equal(validateOnlyReport.workspaceMutationStartedByReport, false, "validate-only report must not mutate workspace");

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

const report = buildDirectHeadlessToolClassRealismReport({
  pack,
  fixtureExecution,
  executionMode: executeFixtures ? "execute_fixtures" : "validate_only",
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassRealismReport(report), [], "final realism report should validate");
assert.equal(report.status, "passed", "final realism report should pass");
if (executeFixtures) {
  assert.equal(report.summary.fixtureRowsPassed, 5, "executed report should mark all headless fixture rows passed");
  assert.equal(report.summary.fixtureRowsAvailableNotExecuted, 0, "executed report should not leave fixture rows unexecuted");
  assert.equal(report.summary.fixtureScriptResultCount, 15, "executed report should include all linked fixture script results");
} else {
  assert.equal(report.summary.fixtureRowsPassed, 0, "default report should not mark fixtures passed");
  assert.equal(report.summary.fixtureRowsAvailableNotExecuted, 5, "default report should leave fixtures available but unexecuted");
}

const outputPath = writeReportIfRequested(report, options.output);
console.log(JSON.stringify({
  ok: true,
  reportId: report.reportId,
  reportDigest: report.reportDigest,
  status: report.status,
  executionMode: report.executionMode,
  outputPath,
  summary: report.summary,
}, null, 2));
