#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_AGENTIC_GAME_RUN_REPORT_SCHEMA,
  DIRECT_AGENTIC_GAME_SCENARIO_SCHEMA,
  DIRECT_AGENTIC_GAME_SUITE_REPORT_SCHEMA,
  DIRECT_AGENTIC_GAME_SUITE_SCHEMA,
  buildDefaultAgenticGameKernelFixtureSuite,
  compileDeclaredToolBundle,
  runAgenticGameFixtureScenario,
  runAgenticGameFixtureSuite,
  validateAgenticGameRunReport,
  validateAgenticGameScenario,
  validateAgenticGameSuiteReport,
} = require("../src/main/direct/headless/agentic-game-kernel.js");

const suite = buildDefaultAgenticGameKernelFixtureSuite({ nowMs: 0 });
assert.equal(suite.schema, DIRECT_AGENTIC_GAME_SUITE_SCHEMA);
assert.equal(suite.fixtureOnly, true);
assert.equal(suite.providerTransportExpected, false);
assert.equal(suite.workspaceMutationExpected, false);
assert.equal(suite.scenarios.length, 3);
assert.equal(suite.scenarios.every((scenario) => scenario.schema === DIRECT_AGENTIC_GAME_SCENARIO_SCHEMA), true);

for (const scenario of suite.scenarios) {
  assert.deepEqual(validateAgenticGameScenario(scenario), [], `scenario validation failed: ${scenario.scenarioId}`);
}

const readScenario = suite.scenarios.find((scenario) => scenario.scenarioId === "kernel_fixture_provider_declared_read");
const readBundle = compileDeclaredToolBundle(readScenario);
assert.deepEqual(readBundle.declaredTools, ["read_file"]);
assert.deepEqual(readBundle.visibleOnlyTools, []);
assert.equal(readBundle.providerTransportStarted, false);

const visibleScenario = suite.scenarios.find((scenario) => scenario.scenarioId === "kernel_fixture_visible_not_callable");
const visibleBundle = compileDeclaredToolBundle(visibleScenario);
assert.deepEqual(visibleBundle.declaredTools, []);
assert.deepEqual(visibleBundle.visibleOnlyTools, ["apply_patch"]);

const readReport = runAgenticGameFixtureScenario(readScenario);
assert.equal(readReport.schema, DIRECT_AGENTIC_GAME_RUN_REPORT_SCHEMA);
assert.deepEqual(validateAgenticGameRunReport(readReport), []);
assert.equal(readReport.behaviorVerdict, "passed");
assert.equal(readReport.evidenceVerdict, "passed");
assert.equal(readReport.overallVerdict, "passed");
assert.equal(readReport.providerTransportStarted, false);
assert.equal(readReport.workspaceMutationStarted, false);
assert.equal(readReport.rawPayloadIncluded, false);

const visibleReport = runAgenticGameFixtureScenario(visibleScenario);
assert.deepEqual(validateAgenticGameRunReport(visibleReport), []);
assert.equal(visibleReport.overallVerdict, "passed");
assert.equal(visibleReport.declaredToolBundle.declaredTools.includes("apply_patch"), false);
assert.equal(visibleReport.declaredToolBundle.visibleOnlyTools.includes("apply_patch"), true);

const remandScenario = suite.scenarios.find((scenario) => scenario.scenarioId === "kernel_fixture_missing_declaration_remand");
const remandReport = runAgenticGameFixtureScenario(remandScenario);
assert.deepEqual(validateAgenticGameRunReport(remandReport), []);
assert.equal(remandReport.behaviorVerdict, "passed");
assert.equal(remandReport.evidenceVerdict, "failed");
assert.equal(remandReport.overallVerdict, "remand");
assert.equal(remandReport.remands.some((remand) => remand.category === "missing_provider_declaration"), true);
assert.equal(remandReport.providerTransportStarted, false);
assert.equal(remandReport.workspaceMutationStarted, false);

const suiteReport = runAgenticGameFixtureSuite(suite);
assert.equal(suiteReport.schema, DIRECT_AGENTIC_GAME_SUITE_REPORT_SCHEMA);
assert.deepEqual(validateAgenticGameSuiteReport(suiteReport), []);
assert.equal(suiteReport.summary.total, 3);
assert.equal(suiteReport.summary.passed, 2);
assert.equal(suiteReport.summary.remand, 1);
assert.equal(suiteReport.summary.failed, 0);
assert.equal(suiteReport.summary.blocked, 0);
assert.equal(suiteReport.summary.valid, true);
assert.equal(suiteReport.providerTransportStarted, false);
assert.equal(suiteReport.workspaceMutationStarted, false);
assert.equal(suiteReport.rawPayloadIncluded, false);

const blockedLiveReport = runAgenticGameFixtureScenario({
  ...readScenario,
  mode: "live_headless",
});
assert.deepEqual(validateAgenticGameRunReport(blockedLiveReport), []);
assert.equal(blockedLiveReport.overallVerdict, "blocked");
assert.equal(blockedLiveReport.remands[0].message, "live_headless_requires_later_runner");

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-game-kernel",
  suiteDigest: suite.suiteDigest,
  reportDigest: suiteReport.reportDigest,
  summary: suiteReport.summary,
}, null, 2));
