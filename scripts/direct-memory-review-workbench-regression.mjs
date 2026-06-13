#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  buildContextMaintenanceExecutionPacket,
  buildContextMaintenanceExecutionResult,
  buildContextLossWitness,
  buildDurableThreadMemory,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildThreadMemoryRefreshProposal,
  buildThreadMemoryResetConfirmation,
  buildThreadMemoryResetPolicy,
  buildThreadMemoryReviewPacket,
  buildTrimPlan,
  selectMaintenanceRoute,
} from "../src/main/direct/context/maintenance.js";
import {
  assertDirectMemoryReviewWorkbenchSafe,
  buildDirectMemoryReviewWorkbench,
} from "../src/main/direct/context/memory-workbench.js";
import {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} from "../src/main/direct/ui/settings-surface.js";
import {
  buildDirectInformationBridgeAudit,
} from "../src/main/direct/bridge/information-registry.js";

const projectId = "project_memory_workbench";
const threadId = "thread_memory_workbench";
const workThreadId = "work_thread_memory_workbench";

const pressure = buildPressureEstimate({
  projectId,
  threadId,
  modelId: "fixture-model",
  visibleCharCount: 96_000,
  hiddenRequiredTokens: 800,
  reservedOutputTokens: 2_000,
  modelContextWindowEstimate: 24_000,
});
const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
const trimPlan = buildTrimPlan({
  route,
  sourceContextProjectionId: "context_projection_memory_workbench",
  sourceContextProjectionDigest: "context_projection_memory_workbench_digest",
  trimPolicy: buildRawWindowTrimPolicy(),
  candidateOmissions: [
    {
      sourceArtifactKind: "context_recent_dialogue",
      sourceArtifactId: "context_projection_memory_workbench",
      sourceDigest: "context_projection_memory_workbench_digest",
      sourceStableKeys: ["turn_old_a", "turn_old_b"],
      omittedItemCount: 2,
      omittedTurnCount: 2,
      omittedCharCount: 7_200,
      omittedTokenEstimate: 1_800,
      reason: "over_budget",
      rendererSafeSummary: "Older optional dialogue omitted with source witnesses.",
    },
  ],
});
const omissionLedger = buildOmissionLedger({ trimPlan });
const contextLossWitness = buildContextLossWitness({ route, pressureEstimate: pressure, trimPlan, omissionLedger });
const currentMemory = buildDurableThreadMemory({
  projectId,
  threadId,
  entries: [
    {
      kind: "decision",
      authority: "decision_record",
      contextUse: "quoted_context_only",
      rendererSafeSummary: "Prior memory is stale and needs local refresh.",
      staleness: "stale",
      conflictState: "superseded",
      sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_memory_workbench", artifactDigest: "context_projection_memory_workbench_digest" }],
    },
  ],
});
const reviewPacket = buildThreadMemoryReviewPacket({
  workThreadId,
  memory: currentMemory,
  omissionLedger,
  sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_memory_workbench", artifactDigest: "context_projection_memory_workbench_digest" }],
});
const proposedMemory = buildDurableThreadMemory({
  projectId,
  threadId,
  previousMemoryDigest: currentMemory.integrity.artifactDigest,
  entries: [
    {
      kind: "decision",
      authority: "decision_record",
      contextUse: "quoted_context_only",
      rendererSafeSummary: "Refreshed memory is current and source-backed.",
      staleness: "current",
      conflictState: "none",
      sourceRefs: [{ artifactKind: "thread_memory_review_packet", artifactId: reviewPacket.memoryReviewPacketId, artifactDigest: reviewPacket.integrity.artifactDigest }],
    },
  ],
});
const acceptedRefreshProposal = buildThreadMemoryRefreshProposal({
  reviewPacket,
  currentMemory,
  proposedMemory,
  proposalState: "accepted",
  sourceRefs: [{ artifactKind: "thread_memory_review_packet", artifactId: reviewPacket.memoryReviewPacketId, artifactDigest: reviewPacket.integrity.artifactDigest }],
});
const resetPolicy = buildThreadMemoryResetPolicy({
  projectId,
  threadId,
  workThreadId,
  enabled: true,
  sourceRefs: [{ artifactKind: "thread_memory_review_packet", artifactId: reviewPacket.memoryReviewPacketId, artifactDigest: reviewPacket.integrity.artifactDigest }],
});
const resetConfirmation = buildThreadMemoryResetConfirmation({
  resetPolicy,
  confirmedByOperator: true,
});
const executionPacket = buildContextMaintenanceExecutionPacket({
  projectId,
  threadId,
  workThreadId,
  actionKind: "memory_refresh_materialize",
  operatorDecision: "accepted",
  currentMemoryId: currentMemory.memoryId,
  proposedMemoryId: proposedMemory.memoryId,
  sourceArtifactRefs: [
    {
      artifactKind: "thread_memory_refresh_proposal",
      artifactId: acceptedRefreshProposal.memoryRefreshProposalId,
      artifactDigest: acceptedRefreshProposal.integrity.artifactDigest,
      rendererSafeLabel: "Accepted memory refresh proposal",
    },
  ],
  expectedSourceDigest: "memory_workbench_source_digest_v1",
  expectedUiProjectionGeneration: 9,
  retentionLaw: "source_refs_and_previous_pointer_retained",
  omissionRisk: "visible_operator_acknowledged",
  rollbackPosture: "previous_pointer_retained",
});
const executionResult = buildContextMaintenanceExecutionResult({
  packet: executionPacket,
  memoryRefreshProposal: acceptedRefreshProposal,
  currentMemory,
  proposedMemory,
  currentSourceDigest: "memory_workbench_source_digest_v1",
  currentUiProjectionGeneration: 9,
});

const workbench = buildDirectMemoryReviewWorkbench({
  projectId,
  threadId,
  workThreadId,
  nowMs: 0,
  memoryReviewPacket: reviewPacket,
  memoryRefreshProposal: acceptedRefreshProposal,
  memoryResetPolicy: resetPolicy,
  memoryResetConfirmation: resetConfirmation,
  executionPacket,
  executionResult,
  contextLossWitness,
  omissionLedger,
});

assert.equal(workbench.schema, "direct_memory_review_workbench@1");
assert.equal(workbench.generatedAt, "1970-01-01T00:00:00.000Z");
assert.equal(workbench.workbenchState, "ready");
assert.equal(workbench.counts.reviewRowCount, 1);
assert.equal(workbench.counts.refreshProposalRowCount, 1);
assert.equal(workbench.counts.resetRowCount, 2);
assert.equal(workbench.counts.executionTransitionRowCount, 1);
assert.equal(workbench.counts.contextLossRowCount, 1);
assert.equal(workbench.counts.omissionImpactRowCount, 1);
assert(workbench.counts.omittedItemCount >= 4);
assert.equal(workbench.transitions.acceptedRefreshVisible, true);
assert.equal(workbench.transitions.localMaterializationWitnessVisible, true);
assert.equal(workbench.transitions.rollbackPostureVisible, true);
assert.equal(workbench.transitions.resetWorkflowVisible, true);
assert.equal(workbench.transitions.resetExecutionAllowed, false);
assert.equal(workbench.transitions.memoryMutationAuthorityGranted, false);
assert.equal(workbench.transitions.providerMemoryClaimAccepted, false);
assert.equal(workbench.transitions.providerCompactionAllowed, false);
assert.equal(workbench.transitions.automaticRefreshAllowed, false);
assert.equal(workbench.authority.providerTransportAllowed, false);
assertDirectMemoryReviewWorkbenchSafe(workbench);

const unsafeWorkbench = buildDirectMemoryReviewWorkbench({
  memoryReviewPacket: {
    ...reviewPacket,
    rawPathExposed: true,
  },
});
assert.equal(unsafeWorkbench.workbenchState, "blocked_raw_exposure");
assert.equal(unsafeWorkbench.counts.rawExposureUnsafeCount, 1);
assertDirectMemoryReviewWorkbenchSafe(unsafeWorkbench);

const deterministicWorkbenchA = buildDirectMemoryReviewWorkbench({ nowMs: 0, memoryReviewPacket: reviewPacket });
const deterministicWorkbenchB = buildDirectMemoryReviewWorkbench({ nowMs: 0, memoryReviewPacket: reviewPacket });
assert.equal(deterministicWorkbenchA.workbenchDigest, deterministicWorkbenchB.workbenchDigest);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  memoryWorkbench: workbench,
  registryAudit: buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" }),
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("memory_review_workbench"));
assert.equal(settingsProjection.sections.memoryWorkbench.available, true);
assert.equal(settingsProjection.sections.memoryWorkbench.acceptedRefreshVisible, true);
assert.equal(settingsProjection.sections.memoryWorkbench.localMaterializationWitnessVisible, true);
assert.equal(settingsProjection.sections.memoryWorkbench.memoryMutationAllowed, false);
assert.equal(settingsProjection.sections.memoryWorkbench.providerCompactionAllowed, false);
assert.equal(settingsProjection.rows.memoryWorkbench.some((row) => row.label === "Authority" && row.value === "display only"), true);
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "memory_review_workbench" && ref.digest));

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" });
const registryRow = audit.rows.find((row) => row.id === "ic3.memory-review-workbench");
assert(registryRow, "memory workbench registry row should exist");
assert.equal(registryRow.role, "memory_continuity");
assert.equal(registryRow.implementationState, "partial");
assert.equal(registryRow.directPathPosture, "keep_guarded");
assert.equal(audit.summary.valid, true);

console.log(JSON.stringify({
  ok: true,
  workbenchState: workbench.workbenchState,
  rowCount: workbench.counts.rowCount,
  registryRows: audit.summary.totalRows,
  settingsRows: settingsProjection.rows.memoryWorkbench.length,
}, null, 2));
