#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA,
  persistLiveAgenticGameSuiteReport,
  runLiveAgenticGameSuite,
  selectLiveGameScenarios,
  validateLiveAgenticGameSuiteReport,
} = require("../src/main/direct/headless/agentic-live-game-runner.js");
const {
  buildFirstAgenticFixtureGameSuite,
} = require("../src/main/direct/headless/agentic-fixture-games.js");

const suite = buildFirstAgenticFixtureGameSuite({ nowMs: 0 });
const selected = selectLiveGameScenarios(suite, { gameIds: ["G1", "G8"], maxGames: 2 });
assert.deepEqual(selected.map((scenario) => scenario.scenarioId), [
  "g1_resident_tool_truth_baseline",
  "g8_external_discovery_is_not_execution",
]);

let defaultRunnerCalls = 0;
const blocked = await runLiveAgenticGameSuite({
  suite,
  gameIds: ["G1", "G8"],
  maxGames: 2,
  maxProviderCalls: 2,
  liveRunner: async () => {
    defaultRunnerCalls += 1;
    throw new Error("should not run without opt-in");
  },
  nowMs: 0,
});
assert.equal(blocked.schema, DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA);
assert.equal(blocked.liveOptIn, false);
assert.equal(blocked.providerTransportStarted, false);
assert.equal(blocked.providerCallCount, 0);
assert.equal(blocked.summary.blocked, 2);
assert.equal(blocked.caseReports.every((row) => row.status === "blocked_live_opt_in_required"), true);
assert.equal(defaultRunnerCalls, 0);
assert.deepEqual(validateLiveAgenticGameSuiteReport(blocked), []);

let fakeRunnerCalls = 0;
const fakeLiveRunner = async ({ scenario }) => {
  fakeRunnerCalls += 1;
  return {
    assistantText: scenario.fixture.behaviorEvents.map((event) => event.text).join("\n"),
    providerTransportStarted: true,
    providerTransportCompleted: true,
    providerCallCount: 1,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
  };
};

const liveReport = await runLiveAgenticGameSuite({
  suite,
  gameIds: ["G1", "G8"],
  maxGames: 2,
  maxProviderCalls: 2,
  liveOptIn: true,
  liveRunner: fakeLiveRunner,
  nowMs: 0,
});
assert.equal(liveReport.liveOptIn, true);
assert.equal(fakeRunnerCalls, 2);
assert.equal(liveReport.providerTransportStarted, true);
assert.equal(liveReport.providerCallCount, 2);
assert.equal(liveReport.summary.passed, 2);
assert.equal(liveReport.summary.remand, 0);
assert.equal(liveReport.summary.failed, 0);
assert.equal(liveReport.rawPromptIncluded, false);
assert.equal(liveReport.rawResponseIncluded, false);
assert.equal(liveReport.rawProviderPayloadIncluded, false);
assert.deepEqual(validateLiveAgenticGameSuiteReport(liveReport), []);

const g8 = liveReport.caseReports.find((row) => row.scenarioId === "g8_external_discovery_is_not_execution");
assert.equal(g8.status, "passed");
assert.equal(g8.comparisonSummary.claimMatches >= 2, true);
assert.equal(g8.claimExtractionReport.claims.some((claim) => claim.name === "tool_search" && claim.evidenceComparison === "matches_evidence"), true);
assert.equal(g8.claimExtractionReport.claims.every((claim) => claim.sourceSpanPreview === "[redacted_live_source_span]" || claim.sourceSpanPreview === ""), true);

fakeRunnerCalls = 0;
const budgetReport = await runLiveAgenticGameSuite({
  suite,
  gameIds: ["G1", "G8"],
  maxGames: 2,
  maxProviderCalls: 1,
  liveOptIn: true,
  liveRunner: fakeLiveRunner,
  nowMs: 0,
});
assert.equal(fakeRunnerCalls, 1);
assert.equal(budgetReport.providerCallCount, 1);
assert.equal(budgetReport.caseReports[0].status, "passed");
assert.equal(budgetReport.caseReports[1].status, "blocked_budget_exhausted");
assert.deepEqual(validateLiveAgenticGameSuiteReport(budgetReport), []);

const missingRunner = await runLiveAgenticGameSuite({
  suite,
  gameIds: ["G1"],
  liveOptIn: true,
  maxProviderCalls: 1,
  nowMs: 0,
});
assert.equal(missingRunner.caseReports[0].status, "blocked_live_runner_missing");
assert.equal(missingRunner.providerTransportStarted, false);
assert.deepEqual(validateLiveAgenticGameSuiteReport(missingRunner), []);

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-agentic-live-game-runner-"));
const outputPath = persistLiveAgenticGameSuiteReport(liveReport, { outputDir });
assert.equal(fs.existsSync(outputPath), true);
const persisted = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(persisted.reportDigest, liveReport.reportDigest);
assert(!JSON.stringify(persisted).includes("Operator request:"), "persisted report must not include raw prompt text");

const malformed = {
  ...liveReport,
  rawPromptIncluded: true,
};
assert(validateLiveAgenticGameSuiteReport(malformed).includes("live_game_suite_raw_prompt_included"));

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-live-game-runner",
  blockedDigest: blocked.reportDigest,
  liveDigest: liveReport.reportDigest,
  budgetDigest: budgetReport.reportDigest,
  outputPath,
}, null, 2));
