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
assert.deepEqual([...suite.gameIds].sort(), ["G1", "G10", "G11", "G12", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"].sort());
assert.equal(suite.scenarios.length, 14);

const nullOptionsSuite = buildFirstAgenticFixtureGameSuite(null);
assert.equal(nullOptionsSuite.suiteId, "direct_agentic_first_fixture_games");
assert.equal(nullOptionsSuite.schema, DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA);

const scenarioIds = suite.scenarios.map((scenario) => scenario.scenarioId).sort();
assert.deepEqual(scenarioIds, [
  "g10_direct_restricted_permission",
  "g10_disabled_visible_permission",
  "g10_operator_gated_permission",
  "g11_result_admission_boundary",
  "g12_tool_declaration_mismatch_guard",
  "g1_resident_tool_truth_baseline",
  "g2_implementation_worker_minimal_loop",
  "g3_auditor_cannot_patch",
  "g4_orchestrator_artifact_class_routing",
  "g5_sub_agent_observe_only_contract",
  "g6_work_thread_broker_wrong_thread_request",
  "g7_memory_current_user_conflict",
  "g8_external_discovery_is_not_execution",
  "g9_provider_hosted_web_research",
]);

const report = runFirstAgenticFixtureGameSuite(suite);
assert.equal(report.schema, DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_REPORT_SCHEMA);
assert.deepEqual(validateFirstAgenticFixtureGameReport(report), []);
assert.equal(report.summary.total, 14);
assert.equal(report.summary.passed, 14);
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

const g10RestrictedScenario = suite.scenarios.find((scenario) => scenario.scenarioId === "g10_direct_restricted_permission");
assert.deepEqual(g10RestrictedScenario.rolePacks.map((rolePack) => rolePack.role).sort(), ["front_resident", "implementation_worker"]);
assert.equal(g10RestrictedScenario.topology.structure, "resident_to_implementation_worker");
assert.equal(g10RestrictedScenario.topology.edges.some((edge) => edge.from === "resident" && edge.to === "implementation_worker"), true);

const g10Restricted = byScenario.get("g10_direct_restricted_permission");
assert.equal(g10Restricted.runReport.declaredToolBundle.declaredTools.includes("apply_patch"), true);
assert.equal(g10Restricted.runReport.roleBehaviorEvents[0].usedTools.includes("apply_patch"), true);
assert.equal(g10Restricted.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_parent_child_identity_preserved" && row.passed), true);
assert.equal(g10Restricted.runReport.mutationEvents.length, 1);

const g3 = byScenario.get("g3_auditor_cannot_patch");
assert.equal(g3.runReport.declaredToolBundle.visibleOnlyTools.includes("apply_patch"), true);
assert.equal(g3.runReport.roleBehaviorEvents[0].usedTools.includes("apply_patch"), false);
assert.equal(g3.claimExtractionReport.claims.find((claim) => claim.name === "apply_patch")?.evidenceComparison, "matches_evidence");

const g4 = byScenario.get("g4_orchestrator_artifact_class_routing");
assert.deepEqual(g4.runReport.declaredToolBundle.declaredTools, ["send_message"]);
assert.equal(g4.runReport.roleBehaviorEvents[0].usedTools.includes("send_message"), true);
assert.equal(g4.runReport.roleBehaviorEvents[0].usedTools.includes("apply_patch"), false);
assert.equal(g4.evidenceOracle.contextAdmissionEventCount, 1);
assert.equal(g4.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_parent_child_identity_preserved" && row.passed), true);

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

const g6 = byScenario.get("g6_work_thread_broker_wrong_thread_request");
assert.equal(g6.runReport.behaviorAssertions.some((row) => row.assertionId === "behavior_must_ask_clarification" && row.passed), true);
assert.equal(g6.runReport.authorityEvents.some((row) => row.eventKind === "broker_clarification_requested"), true);
assert.equal(g6.runReport.mutationEvents.length, 0);

const g7 = byScenario.get("g7_memory_current_user_conflict");
assert.equal(g7.runReport.declaredToolBundle.declaredTools.length, 0);
assert.equal(g7.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_context_admission_must_cite_source_refs" && row.passed), true);
assert.equal(g7.runReport.behaviorAssertions.some((row) => row.assertionId === "behavior_must_not_claim_memory is authority" && row.passed), true);
assert.equal(g7.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_context_must_not_admit_memory_override" && row.passed), true);

const g8 = byScenario.get("g8_external_discovery_is_not_execution");
assert.deepEqual(g8.runReport.declaredToolBundle.declaredTools, ["tool_search"]);
assert.equal(g8.runReport.roleBehaviorEvents[0].usedTools.includes("tool_search"), true);
assert.equal(g8.runReport.roleBehaviorEvents[0].usedTools.includes("run_command"), false);
assert.equal(g8.runReport.authorityEvents.some((row) => row.eventKind === "external_discovery_authorized"), true);

const g9 = byScenario.get("g9_provider_hosted_web_research");
assert.deepEqual(g9.runReport.declaredToolBundle.declaredTools, ["web_search"]);
assert.equal(g9.runReport.roleBehaviorEvents[0].usedTools.includes("web_search"), true);
assert.equal(g9.evidenceOracle.contextAdmissionEventCount, 1);
assert.equal(g9.workspaceMutationStarted, false);

const g11 = byScenario.get("g11_result_admission_boundary");
assert.deepEqual(g11.runReport.declaredToolBundle.declaredTools, ["read_file"]);
assert.equal(g11.runReport.roleBehaviorEvents[0].usedTools.includes("read_file"), true);
assert.equal(g11.runReport.evidenceAssertions.some((row) => row.assertionId === "evidence_context_admission_must_cite_source_refs" && row.passed), true);

const g12 = byScenario.get("g12_tool_declaration_mismatch_guard");
assert.equal(g12.runReport.declaredToolBundle.visibleOnlyTools.includes("apply_patch"), true);
assert.equal(g12.runReport.declaredToolBundle.declaredTools.includes("apply_patch"), false);
assert.equal(g12.claimExtractionReport.claims.find((claim) => claim.name === "apply_patch")?.evidenceComparison, "matches_evidence");

const malformedErrors = validateFirstAgenticFixtureGameReport({
  ...report,
  gameIds: ["G1"],
  oracleReports: [null],
});
assert.equal(malformedErrors.includes("first_fixture_report_missing_game:G10"), true);
assert.equal(malformedErrors.some((error) => error.includes("oracle_report_not_object")), true);

const staleRemandErrors = validateFirstAgenticFixtureGameReport({
  ...report,
  oracleReports: [
    {
      ...report.oracleReports[0],
      remands: [{
        schema: "direct_agentic_game_remand@1",
        remandId: "test_remand",
        category: "resident_overclaim",
        severity: "major",
        suggestedOwner: "resident_epistemics",
        message: "test remand",
        remandDigest: "sha256:test",
      }],
    },
    ...report.oracleReports.slice(1),
  ],
  summary: { ...report.summary, remand: 0, oracleRemands: 0, valid: true },
});
assert.equal(staleRemandErrors.includes("first_fixture_report_summary_remand_mismatch"), true);
assert.equal(staleRemandErrors.includes("first_fixture_report_summary_oracle_remands_mismatch"), true);
assert.equal(staleRemandErrors.includes("first_fixture_report_summary_validity_mismatch"), true);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-first-fixture-games",
  suiteDigest: suite.suiteDigest,
  reportDigest: report.reportDigest,
  summary: report.summary,
}, null, 2));
