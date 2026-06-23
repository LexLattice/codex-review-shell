#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildGameRemand,
} = require("../src/main/direct/headless/agentic-game-kernel.js");
const {
  runFirstAgenticFixtureGameSuite,
} = require("../src/main/direct/headless/agentic-fixture-games.js");
const {
  DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA,
  buildDirectAgenticActivationRemandQueue,
  validateDirectAgenticActivationRemandQueue,
} = require("../src/main/direct/headless/agentic-activation-remand-queue.js");

const fixtureReport = runFirstAgenticFixtureGameSuite({ nowMs: 0 });
const residentOverclaimRemand = buildGameRemand({
  category: "resident_overclaim",
  severity: "major",
  suggestedOwner: "resident_epistemics",
  message: "fixture resident overclaimed tool authority",
});
const fixtureReportWithRemand = {
  ...fixtureReport,
  oracleReports: fixtureReport.oracleReports.map((oracle, index) => index === 0
    ? { ...oracle, remands: [residentOverclaimRemand] }
    : oracle),
};

const liveReport = {
  schema: "direct_agentic_live_game_suite_report@1",
  reportDigest: "sha256:live_report_fixture",
  caseReports: [{
    schema: "direct_agentic_live_game_case_report@1",
    scenarioId: "g1_resident_tool_truth_baseline",
    reportDigest: "sha256:live_case_fixture",
    status: "remand",
    behaviorAssertions: [{
      assertionId: "live_behavior_must_say_read_file",
      passed: false,
      blockerCode: "live_behavior_phrase_missing",
    }],
    comparisonSummary: {
      claimOverclaim: 1,
      claimUnsupported: 0,
      claimUnderclaim: 0,
      claimMissing: 0,
    },
  }, {
    schema: "direct_agentic_live_game_case_report@1",
    scenarioId: "g8_external_discovery_is_not_execution",
    reportDigest: "sha256:live_case_failed_transport",
    status: "failed_transport",
    runnerError: "transport did not start",
    behaviorAssertions: [],
    comparisonSummary: {},
  }],
};

const promotionReport = {
  schema: "direct_tool_promotion_decision_report@1",
  reportId: "promotion_report_fixture",
  reportDigest: "sha256:promotion_report_fixture",
  decisions: [{
    schema: "direct_tool_promotion_decision_row@1",
    decisionId: "decision_needs_read_evidence",
    decisionDigest: "sha256:decision_needs_read_evidence",
    state: "needs_more_evidence",
    evidenceClass: "fixture_only",
    scope: {
      toolClassId: "local_perception.workspace_read",
      toolName: "read_file",
      requestShapeFamily: "read_file",
      authorityFamily: "local_perception",
    },
    blockerCodes: ["live_smoke_execution_not_requested"],
    evidenceRefs: [],
  }, {
    schema: "direct_tool_promotion_decision_row@1",
    decisionId: "decision_restricted_web",
    decisionDigest: "sha256:decision_restricted_web",
    state: "promotable_restricted",
    evidenceClass: "fixture_only",
    scope: {
      toolClassId: "provider_hosted.web_search",
      toolName: "web_search",
      requestShapeFamily: "provider_hosted_tool",
      authorityFamily: "provider_hosted",
    },
    blockerCodes: ["restricted_promotion_downgraded_to_shadow_only"],
    evidenceRefs: [],
  }, {
    schema: "direct_tool_promotion_decision_row@1",
    decisionId: "decision_promotable_ignored",
    decisionDigest: "sha256:decision_promotable_ignored",
    state: "promotable",
    evidenceClass: "real_provider_full_loop",
    scope: {
      toolClassId: "session_control.context_status",
      toolName: "context_status",
      requestShapeFamily: "context_status_or_control",
      authorityFamily: "session_control",
    },
    blockerCodes: [],
    evidenceRefs: [{ evidenceId: "real_loop", evidenceKind: "fixture", rendererSafeLabel: "real loop" }],
  }],
};

const queue = buildDirectAgenticActivationRemandQueue({
  fixtureReport: fixtureReportWithRemand,
  liveReport,
  promotionReport,
  nowMs: 0,
});

assert.equal(queue.schema, DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA);
assert.deepEqual(validateDirectAgenticActivationRemandQueue(queue), []);
assert.equal(queue.activationGranted, false);
assert.equal(queue.providerCallStartedByQueue, false);
assert.equal(queue.workspaceMutationStartedByQueue, false);
assert.equal(queue.rawPromptIncluded, false);
assert.equal(queue.summary.bySourceKind.fixture_oracle_remand, 1);
assert.equal(queue.summary.bySourceKind.live_case_remand, 3);
assert.equal(queue.summary.bySourceKind.promotion_decision_gap, 2);
assert.equal(queue.promotionGapReport.gapCount, 2);
assert.equal(queue.promotionGapReport.summary.byDecisionState.needs_more_evidence, 1);
assert.equal(queue.promotionGapReport.summary.byDecisionState.promotable_restricted, 1);
assert(!queue.rows.some((row) => row.promotionDecisionId === "decision_promotable_ignored"));

const residentCandidate = queue.followupCandidates.find((candidate) => candidate.suggestedOwner === "resident_epistemics");
assert(residentCandidate, "resident epistemics candidate should be present");
assert.equal(residentCandidate.activationGranted, false);
assert.equal(residentCandidate.branchSuggestion.includes("resident-epistemics"), true);

const authorityCandidate = queue.followupCandidates.find((candidate) => candidate.category === "missing_authority_event");
assert(authorityCandidate, "restricted promotion should create authority follow-up candidate");
assert.equal(authorityCandidate.toolClassIds.includes("provider_hosted.web_search"), true);

const malformed = {
  ...queue,
  rows: [{ ...queue.rows[0], activationGranted: true }, ...queue.rows.slice(1)],
};
assert(validateDirectAgenticActivationRemandQueue(malformed).some((error) => error.includes("activation_remand_row_authority_or_raw_leak")));

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-activation-remand-queue",
  queueDigest: queue.queueDigest,
  rowCount: queue.rowCount,
  candidateCount: queue.summary.candidateCount,
  promotionGapDigest: queue.promotionGapReport.reportDigest,
}, null, 2));
