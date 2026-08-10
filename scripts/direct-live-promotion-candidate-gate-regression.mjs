#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA,
  DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA,
  assertLivePromotionCandidateQueueSafe,
  buildLivePromotionAttemptRecord,
  buildLivePromotionCandidateQueue,
} = require("../src/main/direct/readiness/live-promotion-candidate-gate");
const {
  buildDirectImplementationLaneUiStatus,
} = require("../src/main/direct/ui/implementation-lane-ui");

const projectId = "project_live_promotion_gate_fixture";

const defaultQueue = buildLivePromotionCandidateQueue({
  projectId,
  generatedAt: "2026-06-14T00:00:00.000Z",
});

assert.equal(defaultQueue.schema, DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA);
assert.equal(defaultQueue.candidateCount, 8);
assert.equal(defaultQueue.readyCount, 0);
assert.equal(defaultQueue.blockedCount, 8);
assert(defaultQueue.blockerCodes.includes("operator_opt_in_missing"));
assert(defaultQueue.blockerCodes.some((code) => code.endsWith("_missing")));
assert.equal(defaultQueue.authority.promotionExecutionAuthorityGranted, false);
assert.equal(defaultQueue.authority.providerTransportAuthorityGranted, false);
assert.equal(defaultQueue.authority.workspaceMutationAuthorityGranted, false);
assert.equal(defaultQueue.authority.recursiveWorkerAuthorityGranted, false);
assert.equal(defaultQueue.authority.appServerFallbackAuthorityGranted, false);
assert.equal(defaultQueue.authority.matrixRowMutationAuthorityGranted, false);
assert.equal(defaultQueue.reportEffects.changesDefaults, false);
assert.equal(defaultQueue.reportEffects.changesMatrixRows, false);
assertLivePromotionCandidateQueueSafe(defaultQueue);

for (const candidate of defaultQueue.candidates) {
  assert.equal(candidate.allowedNextPromotionRun.canRunFromRenderer, false);
  assert.equal(candidate.allowedNextPromotionRun.transitionExposed, false);
  assert.equal(candidate.authority.defaultMutationAuthorityGranted, false);
  assert(candidate.fixtureEvidenceRefs.length > 0, `${candidate.candidateId} should cite fixture/local evidence`);
  assert(candidate.requiredLiveEvidence.length > 0, `${candidate.candidateId} should cite live evidence requirements`);
}

const attempt = buildLivePromotionAttemptRecord({
  candidateId: "direct_text_turn_live_promotion",
  status: "passed",
  attemptedAt: "2026-06-14T00:01:00.000Z",
  reasonCode: "manual_smoke_passed",
  evidenceRefs: ["manual_text_smoke_row_1"],
});

assert.equal(attempt.schema, DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA);
assert.equal(attempt.status, "passed");
assert.equal(attempt.reportOnly, true);
assert.equal(attempt.changedDefaults, false);
assert.equal(attempt.changedMatrixRows, false);
assert.equal(attempt.providerTransportAuthorityGranted, false);
assert.equal(attempt.workspaceMutationAuthorityGranted, false);

const readyQueue = buildLivePromotionCandidateQueue({
  projectId,
  generatedAt: "2026-06-14T00:02:00.000Z",
  operatorOptIn: true,
  liveEvidenceByCapability: {
    direct_text_turn: {
      live_provider_turn_completed: {
        status: "runtime_probed",
        expiresAt: "2026-06-14T01:02:00.000Z",
        evidenceRefs: ["live_text_turn_row_1", null, 42],
      },
      usage_or_missing_usage_witness: {
        state: "accepted",
        expiresAt: new Date("2026-06-14T01:02:00.000Z"),
        evidenceRefs: ["live_usage_witness_row_1"],
      },
    },
  },
  attempts: [attempt],
});

assert.equal(readyQueue.readyCount, 1);
const readyCandidate = readyQueue.candidates.find((candidate) => candidate.candidateId === "direct_text_turn_live_promotion");
assert.equal(readyCandidate.gateState, "ready");
assert.equal(readyCandidate.promotionState, "passed");
assert.deepEqual(readyCandidate.blockerCodes, []);
assert.equal(readyCandidate.requiredLiveEvidence[0].state, "runtime_probed");
assert.equal(readyCandidate.requiredLiveEvidence[0].evidenceRefs.length, 3);
assert.equal(readyCandidate.requiredLiveEvidence[1].state, "accepted");
assert.equal(readyCandidate.allowedNextPromotionRun.canRunFromRenderer, false);
assert.equal(readyCandidate.authority.providerTransportAuthorityGranted, false);
assert.equal(readyQueue.reportEffects.changesDefaults, false);
assert.equal(readyQueue.reportEffects.changesMatrixRows, false);
assertLivePromotionCandidateQueueSafe(readyQueue);

const staleQueue = buildLivePromotionCandidateQueue({
  projectId,
  generatedAt: "2026-06-14T00:02:00.000Z",
  operatorOptIn: true,
  liveEvidenceByCapability: {
    direct_text_turn: {
      live_provider_turn_completed: { state: "stale", evidenceRefs: ["stale_text_turn_row"] },
      usage_or_missing_usage_witness: { state: "fresh", evidenceRefs: ["usage_row"] },
    },
  },
});
const staleCandidate = staleQueue.candidates.find((candidate) => candidate.candidateId === "direct_text_turn_live_promotion");
assert.equal(staleCandidate.gateState, "blocked");
assert(staleCandidate.blockerCodes.includes("live_provider_turn_completed_stale"));
assertLivePromotionCandidateQueueSafe(staleQueue);

const expiredQueue = buildLivePromotionCandidateQueue({
  projectId,
  generatedAt: "2026-06-14T00:02:00.000Z",
  operatorOptIn: true,
  liveEvidenceByCapability: {
    direct_text_turn: {
      live_provider_turn_completed: {
        status: "runtime_probed",
        expiresAt: "2026-06-14T00:01:00.000Z",
        evidenceRefs: ["expired_text_turn_row"],
      },
      usage_or_missing_usage_witness: {
        status: "accepted",
        expiresAt: "2026-06-14T01:02:00.000Z",
        evidenceRefs: ["usage_row"],
      },
    },
  },
});
const expiredCandidate = expiredQueue.candidates.find((candidate) => candidate.candidateId === "direct_text_turn_live_promotion");
assert.equal(expiredCandidate.gateState, "blocked");
assert.equal(expiredCandidate.requiredLiveEvidence[0].state, "stale");
assert(expiredCandidate.blockerCodes.includes("live_provider_turn_completed_stale"));
assertLivePromotionCandidateQueueSafe(expiredQueue);

const missingFixtureQueue = buildLivePromotionCandidateQueue({
  projectId,
  fixtureEvidenceByCapability: {
    direct_patch: {
      state: "missing",
      evidenceRefs: ["missing_patch_fixture_marker"],
    },
  },
});
const missingFixtureCandidate = missingFixtureQueue.candidates.find((candidate) => candidate.candidateId === "direct_patch_live_promotion");
assert.equal(missingFixtureCandidate.fixtureEvidenceState, "missing");
assert(missingFixtureCandidate.blockerCodes.includes("fixture_or_local_evidence_missing"));
assertLivePromotionCandidateQueueSafe(missingFixtureQueue);

const uiStatus = buildDirectImplementationLaneUiStatus({
  project: { id: projectId },
  generatedAt: "2026-06-14T00:03:00.000Z",
  runtimeStatus: {
    projectId,
    directImplementationLane: {
      selected: true,
      canStartTextTurn: true,
      canApproveReadFile: true,
      canApprovePatchApply: true,
      canApproveRunCommand: true,
    },
    livePromotion: {
      operatorOptIn: true,
      liveEvidenceByCapability: {
        direct_text_turn: {
          live_provider_turn_completed: { state: "fresh", evidenceRefs: ["live_text_turn_row_1"] },
          usage_or_missing_usage_witness: { state: "fresh", evidenceRefs: ["live_usage_witness_row_1"] },
        },
      },
      attempts: [attempt],
    },
  },
});

assert.equal(uiStatus.livePromotionCandidateQueue.schema, DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA);
assert.equal(uiStatus.livePromotionCandidateQueue.readyCount, 1);
assert.equal(uiStatus.livePromotionCandidateQueue.authority.providerTransportAuthorityGranted, false);
assert.equal(uiStatus.livePromotionCandidateQueue.reportEffects.changesRuntimeSelection, false);

console.log(JSON.stringify({
  ok: true,
  schema: defaultQueue.schema,
  candidates: defaultQueue.candidateCount,
  readyCandidate: readyCandidate.candidateId,
  uiProjectionDigest: uiStatus.meta.sourceDigest,
}, null, 2));
