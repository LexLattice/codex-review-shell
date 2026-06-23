#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentMemoryContextProjection,
} = require("../src/main/direct/bridge/agent-context-source-refs");
const {
  memoryContextEligible,
} = require("../src/main/direct/bridge/agent-memory-store");
const {
  DIRECT_AGENT_MEMORY_ADMISSION_PROOF_SCHEMA,
  DIRECT_AGENT_MEMORY_ADMISSION_REPORT_SCHEMA,
  DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA,
  DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA,
  buildMemoryAdmissionProof,
  buildMemoryAdmissionTransition,
  buildMemoryCandidateEnvelope,
  buildMemoryRowFromAdmission,
  runMemoryAdmissionWorkflow,
} = require("../src/main/direct/bridge/agent-memory-admission-gate");

const nowMs = Date.parse("2026-06-23T14:00:00.000Z");
const projectId = "project_memory_admission";
const agentId = "agent_project_resident";
const workThreadId = "work_thread_memory_admission";
const roleLane = "implementation";

function baseCandidate(overrides = {}) {
  return {
    projectId,
    agentId,
    workThreadId,
    roleLane,
    sourceKind: "transcript_or_artifact",
    sourceThreadIds: ["direct_session_memory_admission"],
    sourceTurnIds: ["turn_memory_admission"],
    sourceRefs: [
      {
        kind: "thread_turn_summary",
        id: "turn_memory_admission_summary",
        digest: "sha256:turn_summary",
      },
      {
        kind: "artifact_summary",
        id: "artifact_memory_admission_summary",
        digest: "sha256:artifact_summary",
      },
    ],
    proposedMemory: {
      memoryId: "direct_agent_memory_prefer_concise_closers",
      projectId,
      agentId,
      scope: {
        projectId,
        workThreadId,
        roleLane,
        memoryScope: "work_thread",
      },
      kind: "procedure",
      contentSummary: "When closing direct harness implementation PRs, cite the proof checks and avoid broad changelog detail.",
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      conflictResolution: "unknown",
      auditState: "unaudited",
      revision: 1,
    },
    ...overrides,
  };
}

const candidate = buildMemoryCandidateEnvelope(baseCandidate(), { nowMs });
assert.equal(candidate.schema, DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA);
assert.equal(candidate.actionAuthorityGranted, false);
assert.equal(candidate.rawTranscriptIncluded, false);
assert.equal(candidate.rawTextIncluded, false);
assert.equal(candidate.rawPathIncluded, false);
assert.equal(candidate.rawSecretIncluded, false);

const accepted = runMemoryAdmissionWorkflow({
  candidate,
  admission: {
    admissionState: "accepted",
    decisionSource: "operator_curated",
    reviewerId: "operator_fixture",
  },
}, {
  projectId,
  agentId,
  workThreadId,
  roleLane,
  threadId: "direct_session_memory_admission",
  turnId: "turn_memory_admission",
  nowMs,
});

assert.equal(accepted.schema, DIRECT_AGENT_MEMORY_ADMISSION_REPORT_SCHEMA);
assert.equal(accepted.admissionTransition.schema, DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA);
assert.equal(accepted.admissionTransition.admissionState, "accepted");
assert.equal(accepted.extractionTransition.outputMemoryIds.includes(candidate.proposedMemory.memoryId), true);
assert.equal(accepted.memoryRow.auditState, "accepted");
assert.equal(accepted.memoryRow.contextEligibility, "eligible");
assert.equal(accepted.memoryRow.actionAuthorityGranted, false);
assert.equal(memoryContextEligible(accepted.memoryRow, { projectId, workThreadId, roleLane, nowMs }), true);
assert.equal(accepted.memoryContextProjection.selectedCount, 1);
assert.equal(accepted.memoryContextProjection.selectedMemoryRefs[0].memoryId, accepted.memoryRow.memoryId);
assert.equal(accepted.memoryContextProjection.providerInstruction, false);
assert.equal(accepted.admissionProof.schema, DIRECT_AGENT_MEMORY_ADMISSION_PROOF_SCHEMA);
assert.equal(accepted.admissionProof.proofState, "proved");
assert.equal(accepted.admissionProof.contextProjectionRequired, true);
assert.equal(accepted.admissionProof.contextProjectionSatisfied, true);
assert.equal(accepted.admissionProof.memoryCannotOverrideCurrentUser, true);
assert.equal(accepted.admissionProof.memoryGrantsAuthority, false);
assert.equal(accepted.actionAuthorityGranted, false);
assert.doesNotMatch(JSON.stringify(accepted), /actionAuthorityGranted":true/);

const noProjectionProof = buildMemoryAdmissionProof({
  candidate,
  admissionTransition: accepted.admissionTransition,
  extractionTransition: accepted.extractionTransition,
  memoryRow: accepted.memoryRow,
}, { projectId, agentId, workThreadId, roleLane, nowMs });
assert.equal(noProjectionProof.proofState, "blocked");
assert.equal(noProjectionProof.blockers.includes("missing_context_projection"), true);

const manualProjection = buildAgentMemoryContextProjection({
  projectId,
  agentId,
  workThreadId,
  roleLane,
  selectionEnabled: true,
  selectedMemoryIds: [accepted.memoryRow.memoryId],
  memoryRows: [accepted.memoryRow],
}, { projectId, agentId, workThreadId, roleLane, nowMs });
assert.equal(manualProjection.selectedCount, 1);

const superseding = runMemoryAdmissionWorkflow({
  candidate: baseCandidate({
    proposedMemory: {
      ...baseCandidate().proposedMemory,
      memoryId: "direct_agent_memory_concise_closers_v2",
      revision: 2,
      supersedesMemoryId: accepted.memoryRow.memoryId,
      contentSummary: "Prefer proof-oriented PR closeouts; omit file-by-file logs unless review scope requires them.",
    },
  }),
  admission: {
    admissionState: "accepted",
    decisionSource: "operator_curated",
    reviewerId: "operator_fixture",
    supersedesMemoryId: accepted.memoryRow.memoryId,
    conflictResolution: "newer_evidence_wins",
  },
}, { projectId, agentId, workThreadId, roleLane, nowMs });
assert.equal(superseding.memoryRow.supersedesMemoryId, accepted.memoryRow.memoryId);
assert.equal(superseding.memoryRow.conflictResolution, "newer_evidence_wins");
assert.equal(superseding.admissionProof.proofState, "proved");

const rejected = runMemoryAdmissionWorkflow({
  candidate: baseCandidate({
    proposedMemory: {
      ...baseCandidate().proposedMemory,
      memoryId: "direct_agent_memory_rejected",
      confidence: "candidate",
      auditState: "unaudited",
    },
  }),
  admission: {
    admissionState: "rejected",
    decisionSource: "operator_curated",
    reviewerId: "operator_fixture",
  },
}, { projectId, agentId, workThreadId, roleLane, nowMs });
assert.equal(rejected.admissionTransition.admissionState, "rejected");
assert.equal(rejected.memoryRow, null);
assert.equal(rejected.memoryContextProjection, null);
assert.equal(rejected.admissionProof.proofState, "blocked");

const review = runMemoryAdmissionWorkflow({
  candidate: baseCandidate({
    proposedMemory: {
      ...baseCandidate().proposedMemory,
      memoryId: "direct_agent_memory_current_user_conflict",
      conflictState: "conflicts_with_current_user",
    },
  }),
  admission: { admissionState: "accepted", decisionSource: "operator_curated" },
}, { projectId, agentId, workThreadId, roleLane, nowMs });
assert.equal(review.admissionTransition.admissionState, "needs_review");
assert.equal(review.admissionTransition.blockers.some((blocker) => blocker.kind === "current_user_conflict"), true);
assert.equal(review.memoryRow, null);

const negativeCases = [
  {
    label: "newer workspace evidence",
    options: { newerWorkspaceEvidence: true },
    expectedBlocker: "newer_workspace_evidence",
  },
  {
    label: "newer tool evidence",
    options: { newerToolEvidence: true },
    expectedBlocker: "newer_tool_evidence",
  },
  {
    label: "provider hosted source only",
    candidate: { sourceKind: "provider_hosted_result" },
    expectedBlocker: "provider_hosted_source_only",
  },
  {
    label: "mcp source only",
    candidate: { sourceKind: "mcp_result" },
    expectedBlocker: "mcp_source_only",
  },
  {
    label: "automatic durable memory",
    candidate: { sourceKind: "automated_mining" },
    expectedBlocker: "automatic_durable_memory_blocked",
  },
  {
    label: "cross project",
    candidate: {
      proposedMemory: {
        ...baseCandidate().proposedMemory,
        memoryId: "direct_agent_memory_cross_project",
        projectId: "other_project",
        scope: {
          ...baseCandidate().proposedMemory.scope,
          projectId: "other_project",
        },
      },
    },
    expectedBlocker: "cross_project_scope",
  },
  {
    label: "authority escalation",
    candidate: {
      proposedMemory: {
        ...baseCandidate().proposedMemory,
        memoryId: "direct_agent_memory_authority_escalation",
        authorityUse: "constraint_candidate",
      },
    },
    expectedBlocker: "authority_escalation_attempt",
  },
];

for (const testCase of negativeCases) {
  const result = runMemoryAdmissionWorkflow({
    candidate: baseCandidate({
      ...(testCase.candidate || {}),
      proposedMemory: {
        ...baseCandidate().proposedMemory,
        memoryId: `direct_agent_memory_negative_${testCase.expectedBlocker}`,
        ...(testCase.candidate?.proposedMemory || {}),
      },
    }),
    admission: {
      admissionState: "accepted",
      decisionSource: "operator_curated",
    },
    ...(testCase.options || {}),
  }, { projectId, agentId, workThreadId, roleLane, nowMs, ...(testCase.options || {}) });
  assert.equal(result.admissionTransition.admissionState, "needs_review", testCase.label);
  assert.equal(result.memoryRow, null, testCase.label);
  assert.equal(result.admissionTransition.blockers.some((blocker) => blocker.kind === testCase.expectedBlocker), true, testCase.label);
}

const explicitMissingEvidenceCandidate = buildMemoryCandidateEnvelope({
  ...baseCandidate(),
  sourceRefs: [],
  sourceThreadIds: [],
  sourceTurnIds: [],
  proposedMemory: {
    ...baseCandidate().proposedMemory,
    memoryId: "direct_agent_memory_missing_evidence",
  },
}, { nowMs });
const missingEvidenceTransition = buildMemoryAdmissionTransition({
  candidate: explicitMissingEvidenceCandidate,
  admissionState: "accepted",
});
assert.equal(missingEvidenceTransition.admissionState, "needs_review");
assert.equal(missingEvidenceTransition.blockers.some((blocker) => blocker.kind === "missing_source_evidence"), true);
assert.throws(() => buildMemoryRowFromAdmission(candidate, rejected.admissionTransition, accepted.extractionTransition, { nowMs }), /accepted admission transition/);
assert.throws(() => buildMemoryRowFromAdmission(candidate, accepted.admissionTransition, null, { nowMs }), /extraction evidence/);

console.log("direct agent memory admission gate regression passed");
