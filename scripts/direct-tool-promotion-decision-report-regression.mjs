#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");
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
  buildDirectToolPromotionDecisionReport,
  validateDirectToolPromotionDecisionReport,
} = require("../src/main/direct/headless/tool-promotion-decision-report");

function parseArgs(argv) {
  const options = Object.create(null);
  options.flags = new Set();
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

function fixtureExecutionForPack(pack) {
  return {
    mode: "execute_fixtures",
    results: [...new Set(pack.examples.flatMap((example) => example.runnerScripts || []))]
      .map((scriptPath) => ({ scriptPath, status: "passed", durationMs: 1 })),
  };
}

function smokeResultsForGate(gate, evidenceKind = "headless_live_smoke_fixture_evidence") {
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
        kind: evidenceKind,
        refId: `${evidenceKind}_${row.exampleId}`,
        state: "passed",
        rendererSafe: true,
      }],
    }));
}

function buildCandidateGate(nowMs = 0) {
  const registry = buildToolCapabilityRegistry({
    projectId: "project_tool_promotion_decision_fixture",
    nowMs,
  });
  assert.equal(validateToolCapabilityRegistry(registry), true, "tool capability registry should validate");
  const pack = buildDirectHeadlessToolClassExamplePack({
    registry,
    projectId: "project_tool_promotion_decision_fixture",
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassExamplePack(pack), [], "example pack should validate");
  const realismReport = buildDirectHeadlessToolClassRealismReport({
    pack,
    executionMode: "execute_fixtures",
    fixtureExecution: fixtureExecutionForPack(pack),
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassRealismReport(realismReport), [], "realism report should validate");
  const candidateGate = buildDirectHeadlessToolClassLiveCandidateGate({
    realismReport,
    nowMs,
  });
  assert.deepEqual(validateDirectHeadlessToolClassLiveCandidateGate(candidateGate), [], "candidate gate should validate");
  assert.equal(candidateGate.eligibleCandidateCount, 5, "candidate gate should expose five live-smoke candidates");
  return candidateGate;
}

const options = parseArgs(process.argv.slice(2));
const candidateGate = buildCandidateGate(0);

const planOnlySmokeReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: "plan_only",
  smokeExecution: { mode: "not_requested", results: [] },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(planOnlySmokeReport), [], "plan-only smoke report should validate");
const planOnlyDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: planOnlySmokeReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(planOnlyDecisionReport), [], "plan-only promotion report should validate");
assert.equal(planOnlyDecisionReport.status, "passed", "plan-only promotion report should pass structurally");
assert.equal(planOnlyDecisionReport.summary.byState.needs_more_evidence, 5, "unexecuted candidate rows should need more evidence");
assert.equal(planOnlyDecisionReport.summary.byState.not_applicable, 13, "blocked rows should remain not applicable");
assert.equal(planOnlyDecisionReport.activationGranted, false, "promotion decision must not activate tools");
assert.equal(planOnlyDecisionReport.matrixPromotionCandidate, false, "plan-only evidence must not become a matrix promotion candidate");
assert(
  planOnlyDecisionReport.decisions
    .filter((row) => row.state === "needs_more_evidence")
    .every((row) => row.blockerCodes.includes("live_smoke_execution_not_requested")),
  "needs-more-evidence rows should expose explicit live-smoke blockers",
);

const restrictedSmokeReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: "execute_live_smoke",
  smokeExecution: {
    mode: "execute_live_smoke",
    allowLiveProviderCall: true,
    results: smokeResultsForGate(candidateGate),
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(restrictedSmokeReport), [], "restricted smoke report should validate");
const restrictedDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: restrictedSmokeReport,
  nowMs: 0,
  providerProfileId: "fixture_provider_profile",
  modelId: "fixture-model",
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(restrictedDecisionReport), [], "restricted promotion report should validate");
assert.equal(restrictedDecisionReport.status, "passed", "restricted promotion report should pass");
assert.equal(restrictedDecisionReport.summary.byState.promotable_restricted, 5, "fixture live smoke should be restricted promotion evidence");
assert.equal(
  restrictedDecisionReport.decisions.filter((row) => row.state === "promotable_restricted" && row.evidenceClass === "fixture_only").length,
  5,
  "fixture evidence class should be preserved on restricted promotion rows",
);
assert.equal(restrictedDecisionReport.summary.byState.not_applicable, 13, "blocked rows should remain not applicable");
assert.equal(restrictedDecisionReport.matrixPromotionCandidate, false, "fixture-only restricted decisions must not be matrix candidates");
assert(
  restrictedDecisionReport.decisions
    .filter((row) => row.state === "promotable_restricted")
    .every((row) => row.restrictions.some((restriction) => restriction.kind === "headless_only")),
  "restricted fixture promotions should carry headless-only restrictions",
);

const realProviderSmokeReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: "execute_live_smoke",
  smokeExecution: {
    mode: "execute_live_smoke",
    allowLiveProviderCall: true,
    results: smokeResultsForGate(candidateGate, "real_provider_full_loop_evidence"),
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(realProviderSmokeReport), [], "real-provider smoke report should validate");
const realProviderDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: realProviderSmokeReport,
  nowMs: 0,
  providerProfileId: "real_provider_profile",
  providerProfileDigest: "provider_profile_digest_fixture",
  toolConstitutionDigest: "tool_constitution_digest_fixture",
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(realProviderDecisionReport), [], "real-provider promotion report should validate");
assert.equal(realProviderDecisionReport.summary.byState.promotable, 5, "real-provider full-loop evidence should be promotable");
assert.equal(realProviderDecisionReport.summary.byEvidenceClass.real_provider_full_loop, 5, "real provider evidence class should be preserved");
assert.equal(realProviderDecisionReport.matrixPromotionCandidate, true, "real-provider full-loop evidence may become matrix candidate evidence");
assert.equal(realProviderDecisionReport.activationGranted, false, "promotable does not activate tools");

const fullLoopEffectSmokeReport = buildDirectHeadlessToolClassLiveSmokeReport({
  candidateGate,
  executionMode: "execute_live_smoke",
  smokeExecution: {
    mode: "execute_live_smoke",
    allowLiveProviderCall: true,
    results: smokeResultsForGate(candidateGate, "real_provider_full_loop_evidence")
      .map((result) => ({
        ...result,
        providerTransportStarted: true,
        workspaceMutationStartedBySmoke: result.toolClassId === "workspace_process.patch_apply",
      })),
  },
  nowMs: 0,
});
assert.deepEqual(validateDirectHeadlessToolClassLiveSmokeReport(fullLoopEffectSmokeReport), [], "full-loop effect smoke report should validate");
const fullLoopEffectDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: fullLoopEffectSmokeReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(fullLoopEffectDecisionReport), [], "full-loop effect promotion report should validate");
assert.equal(fullLoopEffectDecisionReport.summary.byState.promotable, 5, "declared full-loop effects should not block promotion decisions");
const patchDecision = fullLoopEffectDecisionReport.decisions.find((row) => row.scope.toolClassId === "workspace_process.patch_apply");
assert.equal(patchDecision.negativeEvidence.noOutOfContractProviderTransport, true, "declared full-loop provider transport should be in contract");
assert.equal(patchDecision.negativeEvidence.noOutOfContractWorkspaceEffect, true, "declared patch workspace effect should be in contract");

const leakySmokeReport = structuredClone(realProviderSmokeReport);
leakySmokeReport.rows = leakySmokeReport.rows.map((row, index) => index === 0
  ? { ...row, rawResultIncluded: true }
  : row);
const leakyDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: leakySmokeReport,
  nowMs: 0,
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(leakyDecisionReport), [], "leaky promotion report should remain structurally valid");
assert.equal(leakyDecisionReport.status, "failed", "raw exposure should fail the report");
assert.equal(leakyDecisionReport.rawExposureScan.passed, false, "raw exposure scan should fail");
assert.equal(leakyDecisionReport.decisions.find((row) => row.negativeEvidence.noRawExposure === false).state, "blocked", "raw exposure row should be blocked");

const staleDecisionReport = buildDirectToolPromotionDecisionReport({
  liveSmokeReport: realProviderSmokeReport,
  generatedAt: "2026-06-17T00:00:00.000Z",
  expiresAt: "2026-06-17T00:00:00.000Z",
  referenceAt: "2026-06-17T00:00:01.000Z",
});
assert.deepEqual(validateDirectToolPromotionDecisionReport(staleDecisionReport), [], "stale promotion report should remain structurally valid");
assert.equal(staleDecisionReport.status, "passed", "stale decisions are blocked rows, not schema failure");
assert.equal(staleDecisionReport.summary.byState.blocked, 5, "stale promotion evidence should block eligible rows");
assert(
  staleDecisionReport.decisions
    .filter((row) => row.sourceSmokeStatus === "live_smoke_passed")
    .every((row) => row.blockerCodes.includes("promotion_evidence_stale")),
  "stale blocker should be explicit on passed smoke rows",
);

const report = options.flags.has("real-provider")
  ? realProviderDecisionReport
  : restrictedDecisionReport;
const outputPath = writeReportIfRequested(report, options.output);
console.log(JSON.stringify({
  ok: true,
  reportId: report.reportId,
  reportDigest: report.reportDigest,
  status: report.status,
  decisionCount: report.decisionCount,
  matrixPromotionCandidate: report.matrixPromotionCandidate,
  outputPath,
  summary: report.summary,
}, null, 2));
