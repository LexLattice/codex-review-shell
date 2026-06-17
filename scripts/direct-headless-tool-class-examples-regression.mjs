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
  buildDirectHeadlessToolClassExampleReport,
  validateDirectHeadlessToolClassExamplePack,
} = require("../src/main/direct/headless/tool-class-examples");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

function parseArgs(argv) {
  return new Set(argv.filter((arg) => arg.startsWith("--")));
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

assert(processFailureMessage({ message: "fixture failed", stderr: "details" }).includes("Stderr:\ndetails"), "fixture failure messages should include stderr");

const args = parseArgs(process.argv.slice(2));
const executeFixtures = args.has("--execute-fixtures");
const registry = buildToolCapabilityRegistry({
  projectId: "project_headless_tool_class_examples_fixture",
  nowMs: 0,
});
validateToolCapabilityRegistry(registry);

const pack = buildDirectHeadlessToolClassExamplePack({
  registry,
  projectId: "project_headless_tool_class_examples_fixture",
  nowMs: 0,
});
const validationErrors = validateDirectHeadlessToolClassExamplePack(pack);
assert.deepEqual(validationErrors, [], `tool class example pack validation failed: ${validationErrors.join(", ")}`);
assert.equal(pack.coverage.registryToolCount, registry.rows.length, "coverage registry count should match registry rows");
assert.equal(pack.coverage.coveredToolCount, registry.rows.length, "all registry tools should be covered by examples");
assert.equal(pack.coverage.uncoveredToolIds.length, 0, "no registry tools should be uncovered");
assert.equal(pack.coverage.duplicateCoverageToolIds.length, 0, "no tool should be covered by multiple examples");
assert.equal(pack.coverage.headlessFixtureExampleCount >= 4, true, "headless fixture examples should cover executable families");
assert.equal(pack.coverage.projectionBlockedExampleCount >= 6, true, "projection examples should cover deferred families");
assert.equal(pack.coverage.unsupportedBlockedExampleCount >= 2, true, "unsupported examples should cover blocked families");

const executableRows = registry.rows.filter((row) => row.implementationState === "restricted_executor");
for (const row of executableRows) {
  const example = pack.examples.find((entry) => entry.toolIdsCovered.includes(row.toolId));
  assert(example, `missing example for executable tool: ${row.toolId}`);
  assert.equal(example.testMode, "headless_fixture", `${row.toolId} should have a headless fixture example`);
}

const projectionOrBlockedRows = registry.rows.filter((row) => row.implementationState !== "restricted_executor");
for (const row of projectionOrBlockedRows) {
  const example = pack.examples.find((entry) => entry.toolIdsCovered.includes(row.toolId));
  assert(example, `missing example for projection/blocked tool: ${row.toolId}`);
  assert.notEqual(example.testMode, "real_provider", `${row.toolId} must not be marked real-provider tested`);
}

const report = buildDirectHeadlessToolClassExampleReport({
  pack,
  nowMs: 0,
});
assert.equal(report.status, "passed", "tool class example report should pass");
assert.equal(report.providerTransportStarted, false, "default report must not start provider transport");
assert.equal(report.workspaceMutationStarted, false, "default report must not mutate workspace");
assert.equal(report.rendererAuthorityGranted, false, "default report must not grant renderer authority");

const malformedReport = buildDirectHeadlessToolClassExampleReport({
  pack: {
    schema: "direct_headless_tool_class_example_pack@1",
    packId: "malformed_pack",
    examples: [{
      schema: "direct_headless_tool_class_example@1",
      exampleId: "malformed_example",
      toolClassId: "malformed.class",
      testMode: "projection_blocked",
      realismTier: "projection",
    }],
  },
  nowMs: 0,
});
assert.equal(malformedReport.status, "failed", "malformed custom pack should produce a failed report");
assert.deepEqual(malformedReport.exampleRows[0].toolIdsCovered, [], "malformed example rows should not throw on missing arrays");

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

const output = {
  ...report,
  fixtureExecution,
};

console.log(JSON.stringify({
  ok: true,
  packId: pack.packId,
  packDigest: pack.packDigest,
  reportDigest: output.reportDigest,
  coverage: output.coverage,
  fixtureExecution: {
    mode: fixtureExecution.mode,
    resultCount: fixtureExecution.results.length,
  },
}, null, 2));
