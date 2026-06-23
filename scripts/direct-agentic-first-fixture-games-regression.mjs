#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_REPORT_SCHEMA,
  DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA,
  buildFirstAgenticFixtureGameSuite,
  runFirstAgenticFixtureGameSuite,
  validateFirstAgenticFixtureGameReport,
} = require("../src/main/direct/headless/agentic-fixture-games.js");

const suite = buildFirstAgenticFixtureGameSuite({ nowMs: 0 });
assert.equal(suite.schema, DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA);
assert.equal(suite.fixtureOnly, true);
assert.equal(suite.providerTransportExpected, false);
assert.equal(suite.workspaceMutationExpected, false);
assert.deepEqual(suite.gameIds.sort(), ["G1", "G10", "G2", "G3", "G5"].sort());
assert.equal(suite.scenarios.length, 7);

const scenarioIds = suite.scenarios.map((scenario) => scenario.scenarioId).sort();
assert.deepEqual(scenarioIds, [
  "g10_direct_restricted_permission",
  "g10_disabled_visible_permission",
  "g10_operator_gated_permission",
  "g1_resident_tool_truth_baseline",
  "g2_implementation_worker_minimal_loop",
  "g3_auditor_cannot_patch",
  "g5_sub_agent_observe_only_contract",
]);

const report = runFirstAgenticFixtureGameSuite(suite);
assert.equal(report.schema, DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_REPORT_SCHEMA);
assert.deepEqual(validateFirstAgenticFixtureGameReport(report), []);
assert.equal(report.summary.total, 7);
assert.equal(report.summary.passed, 7);
assert.equal(report.summary.failed, 0);
assert.equal(report.summary.blocked, 0);
assert.equal(report.summary.remand, 0);
assert.equal(report.summary.valid, true);
assert.equal(report.providerTransportStarted, false);
assert.equal(report.workspaceMutationStarted, false);
assert.equal(report.rawPayloadIncluded, false);

const byScenario = new Map(report.oracleReports.map((oracleReport) => [oracleReport.scenarioId, oracleReport]));
const g1 = byScenario.get("g1_resident_tool_truth_baseline");
assert.equal(g1.runReport.declaredToolBundle.declaredTools.includes("read_file"), true);
assert.equal(g1.claimExtractionReport.claims.find((claim) => claim.name === "read_file")?.evidenceComparison, "matches_evidence");
assert.equal(g1.claimExtractionReport.claims.find((claim) => claim.name === "apply_patch")?.evidenceComparison, "matches_evidence");

const g10Disabled = byScenario.get("g10_disabled_visible_permission");
assert.equal(g10Disabled.runReport.declaredToolBundle.declaredTools.length, 0);
assert.equal(g10Disabled.runReport.declaredToolBundle.visibleOnlyTools.includes("apply_patch"), true);
assert.equal(g10Disabled.claimExtractionReport.claims.find((claim) => claim.name === "apply_patch")?.claimedState, "visible");

const g10Operator = byScenario.get("g10_operator_gated_permission");
assert.equal(g10Operator.runReport.declaredToolBundle.operatorGatedTools.includes("run_command"), true);
assert.equal(g10Operator.evidenceOracle.authorityEventCount, 1);
assert.equal(g10Operator.remands.length, 0);

const g10Restricted = byScenario.get("g10_direct_restricted_permission");
assert.equal(g10Restricted.runReport.declaredToolBundle.declaredTools.includes("apply_patch"), true);
assert.equal(g10Restricted.runReport.roleBehaviorEvents[0].usedTools.includes("apply_patch"), true);
assert.equal(g10Restricted.runReport.mutationEvents.length, 1);

const g3 = byScenario.get("g3_auditor_cannot_patch");
assert.equal(g3.runReport.declaredToolBundle.visibleOnlyTools.includes("apply_patch"), true);
assert.equal(g3.runReport.roleBehaviorEvents[0].usedTools.includes("apply_patch"), false);
assert.equal(g3.claimExtractionReport.claims.find((claim) => claim.name === "apply_patch")?.evidenceComparison, "matches_evidence");

const g2 = byScenario.get("g2_implementation_worker_minimal_loop");
assert.deepEqual(g2.runReport.declaredToolBundle.declaredTools, ["apply_patch", "read_file", "run_command"]);
assert.equal(g2.runReport.behaviorAssertions.some((row) => row.assertionId === "behavior_must_use_tool_order" && row.passed), true);
assert.equal(g2.evidenceOracle.contextAdmissionEventCount, 1);
assert.equal(g2.runReport.mutationEvents.length, 1);

const g5 = byScenario.get("g5_sub_agent_observe_only_contract");
assert.equal(g5.runReport.declaredToolBundle.operatorGatedTools.includes("inspect_agent"), true);
assert.equal(g5.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_no_interference_respected" && row.passed), true);
assert.equal(g5.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_child_transcript_flattened" && row.passed), true);
assert.equal(g5.runReport.roleBehaviorEvents[0].usedTools.includes("send_message"), false);

const malformedErrors = validateFirstAgenticFixtureGameReport({
  ...report,
  gameIds: ["G1"],
  oracleReports: [null],
});
assert.equal(malformedErrors.includes("first_fixture_report_missing_game:G10"), true);
assert.equal(malformedErrors.some((error) => error.includes("oracle_report_not_object")), true);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-first-fixture-games",
  suiteDigest: suite.suiteDigest,
  reportDigest: report.reportDigest,
  summary: report.summary,
}, null, 2));
