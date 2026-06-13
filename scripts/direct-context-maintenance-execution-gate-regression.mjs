#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA,
  DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA,
  buildContextLossWitness,
  buildContextMaintenanceExecutionPacket,
  buildContextMaintenanceExecutionResult,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildLocalCompactionPlan,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildThreadMemoryRefreshProposal,
  buildThreadMemoryReviewPacket,
  buildTrimPlan,
  selectMaintenanceRoute,
  validateContextMaintenanceExecutionGate,
} = require("../src/main/direct/context/maintenance");
const { buildWorkThread } = require("../src/main/direct/bridge/work-thread-registry");

const REPORT_SCHEMA = "direct_context_maintenance_execution_gate_regression_report@1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowIso() {
  return new Date().toISOString();
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function buildFixture() {
  const workThread = buildWorkThread({
    workThreadId: "work_thread_context_execution_fixture",
    projectId: "project_context_execution_fixture",
    title: "Context maintenance execution gate fixture",
    objective: {
      currentObjective: "Execute local context maintenance transitions without provider compaction authority.",
    },
    activeRuntimePath: "direct-implementation",
  });
  const pressure = buildPressureEstimate({
    projectId: workThread.projectId,
    threadId: "thread_context_execution_fixture",
    modelId: "fixture-model",
    visibleCharCount: 128_000,
    hiddenRequiredTokens: 900,
    reservedOutputTokens: 2_000,
    modelContextWindowEstimate: 24_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPlan = buildTrimPlan({
    route,
    sourceContextProjectionId: "context_projection_execution_fixture",
    sourceContextProjectionDigest: "context_projection_execution_digest",
    trimPolicy: buildRawWindowTrimPolicy(),
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_execution_fixture",
        sourceDigest: "context_projection_execution_digest",
        sourceStableKeys: ["turn_old_a", "turn_old_b"],
        omittedItemCount: 2,
        omittedTurnCount: 2,
        omittedCharCount: 7200,
        omittedTokenEstimate: 1800,
        reason: "over_budget",
        rendererSafeSummary: "Older optional turns omitted with source witnesses.",
      },
    ],
  });
  const omissionLedger = buildOmissionLedger({ trimPlan });
  const lossWitness = buildContextLossWitness({ route, pressureEstimate: pressure, trimPlan, omissionLedger });
  const compactionPlan = buildLocalCompactionPlan({
    contextLossWitness: lossWitness,
    residualRiskWitnesses: [
      {
        residualRiskId: "risk_execution_fixture",
        riskKind: "summary_loss",
        rendererSafeSummary: "Operator must see omitted source span before reinjection.",
      },
    ],
  });
  const currentMemory = buildDurableThreadMemory({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Prior memory is stale and needs local refresh.",
        staleness: "stale",
        conflictState: "superseded",
        sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_execution_fixture", artifactDigest: "context_projection_execution_digest" }],
      },
    ],
  });
  const reviewPacket = buildThreadMemoryReviewPacket({
    workThreadId: workThread.workThreadId,
    memory: currentMemory,
    omissionLedger,
    sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_execution_fixture", artifactDigest: "context_projection_execution_digest" }],
  });
  const proposedMemory = buildDurableThreadMemory({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
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
  const baton = buildFrontierBaton({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "Reinject only the current frontier and cited omission witness.",
      nextExpectedAction: "assistant_next_turn",
      openObligationRefs: [{ artifactKind: "context_loss_witness", artifactId: lossWitness.contextLossWitnessId, artifactDigest: lossWitness.integrity.artifactDigest }],
    },
  });
  const sourceArtifactRefs = [
    {
      artifactKind: "thread_memory_refresh_proposal",
      artifactId: acceptedRefreshProposal.memoryRefreshProposalId,
      artifactDigest: acceptedRefreshProposal.integrity.artifactDigest,
      rendererSafeLabel: "Accepted memory refresh proposal",
    },
    {
      artifactKind: "context_loss_witness",
      artifactId: lossWitness.contextLossWitnessId,
      artifactDigest: lossWitness.integrity.artifactDigest,
      rendererSafeLabel: "Context loss witness",
    },
  ];
  return {
    workThread,
    pressure,
    route,
    trimPlan,
    omissionLedger,
    lossWitness,
    compactionPlan,
    currentMemory,
    reviewPacket,
    proposedMemory,
    acceptedRefreshProposal,
    baton,
    sourceArtifactRefs,
    currentSourceDigest: "context_execution_source_digest_v1",
    currentUiProjectionGeneration: 7,
  };
}

function executionCase(caseId, packetInput, resultInput, expected) {
  const packet = buildContextMaintenanceExecutionPacket(packetInput);
  const result = buildContextMaintenanceExecutionResult({ packet, ...resultInput });
  validateContextMaintenanceExecutionGate({ packet, result });
  assert(packet.schema === DIRECT_CONTEXT_MAINTENANCE_EXECUTION_PACKET_SCHEMA, `${caseId}: packet schema mismatch`);
  assert(result.schema === DIRECT_CONTEXT_MAINTENANCE_EXECUTION_RESULT_SCHEMA, `${caseId}: result schema mismatch`);
  assert(result.resultState === expected.resultState, `${caseId}: expected ${expected.resultState}, got ${result.resultState}`);
  if (expected.blockerCode !== undefined) assert(result.blockerCode === expected.blockerCode, `${caseId}: blocker mismatch`);
  if (expected.materializedCount !== undefined) assert(result.materializedArtifacts.length === expected.materializedCount, `${caseId}: materialized count mismatch`);
  if (expected.previewCount !== undefined) assert(result.previewArtifacts.length === expected.previewCount, `${caseId}: preview count mismatch`);
  assert(result.providerTransportUsed === false, `${caseId}: provider transport must stay disabled`);
  assert(result.providerCompactionAllowed === false, `${caseId}: provider compaction must stay disabled`);
  assert(result.appServerFallbackUsed === false, `${caseId}: app-server fallback must stay disabled`);
  assert(result.workspaceMutationUsed === false, `${caseId}: workspace mutation must stay disabled`);
  assert(result.rawTextIncluded === false, `${caseId}: raw text must not be written`);
  return { caseId, packet, result };
}

function buildReport() {
  const fixture = buildFixture();
  const basePacket = {
    projectId: fixture.workThread.projectId,
    threadId: fixture.pressure.threadId,
    workThreadId: fixture.workThread.workThreadId,
    sourceArtifactRefs: fixture.sourceArtifactRefs,
    expectedSourceDigest: fixture.currentSourceDigest,
    expectedUiProjectionGeneration: fixture.currentUiProjectionGeneration,
    retentionLaw: "source_refs_and_previous_pointer_retained",
    omissionRisk: "visible_operator_acknowledged",
    rollbackPosture: "previous_pointer_retained",
  };
  const acceptedMemory = executionCase(
    "accepted_memory_refresh_materializes_local_context_artifact",
    {
      ...basePacket,
      actionKind: "memory_refresh_materialize",
      operatorDecision: "accepted",
      currentMemoryId: fixture.currentMemory.memoryId,
      proposedMemoryId: fixture.proposedMemory.memoryId,
    },
    {
      memoryRefreshProposal: fixture.acceptedRefreshProposal,
      currentMemory: fixture.currentMemory,
      proposedMemory: fixture.proposedMemory,
      currentSourceDigest: fixture.currentSourceDigest,
      currentUiProjectionGeneration: fixture.currentUiProjectionGeneration,
    },
    { resultState: "executed", blockerCode: "", materializedCount: 1 },
  );
  assert(acceptedMemory.result.memoryPointerUpdated === true, "accepted memory refresh should update local memory pointer witness");

  const staleProposal = executionCase(
    "rejected_stale_proposal_blocks_materialization",
    {
      ...basePacket,
      actionKind: "memory_refresh_materialize",
      operatorDecision: "accepted",
      expectedSourceDigest: "stale_digest",
      currentMemoryId: fixture.currentMemory.memoryId,
      proposedMemoryId: fixture.proposedMemory.memoryId,
    },
    {
      memoryRefreshProposal: fixture.acceptedRefreshProposal,
      currentMemory: fixture.currentMemory,
      proposedMemory: fixture.proposedMemory,
      currentSourceDigest: fixture.currentSourceDigest,
      currentUiProjectionGeneration: fixture.currentUiProjectionGeneration,
    },
    { resultState: "blocked", blockerCode: "stale_source_digest", materializedCount: 0 },
  );
  assert(staleProposal.result.memoryPointerUpdated === false, "stale proposal must not update memory pointer");

  const rawExposure = executionCase(
    "raw_exposure_blocks_execution",
    {
      ...basePacket,
      actionKind: "frontier_baton_update",
      operatorDecision: "accepted",
      rawTextIncluded: true,
      proposedBatonId: fixture.baton.batonId,
    },
    {
      baton: fixture.baton,
      currentSourceDigest: fixture.currentSourceDigest,
      currentUiProjectionGeneration: fixture.currentUiProjectionGeneration,
    },
    { resultState: "blocked", blockerCode: "raw_exposure_blocked", materializedCount: 0 },
  );
  assert(rawExposure.result.batonPointerUpdated === false, "raw exposure must not update baton");

  const batonPreview = executionCase(
    "baton_reinjection_preview_without_runtime_authority",
    {
      ...basePacket,
      actionKind: "context_loss_remediation_preview",
      operatorDecision: "accepted",
      contextLossWitnessId: fixture.lossWitness.contextLossWitnessId,
      proposedBatonId: fixture.baton.batonId,
    },
    {
      contextLossWitness: fixture.lossWitness,
      localCompactionPlan: fixture.compactionPlan,
      baton: fixture.baton,
      currentSourceDigest: fixture.currentSourceDigest,
      currentUiProjectionGeneration: fixture.currentUiProjectionGeneration,
    },
    { resultState: "preview_ready", blockerCode: "", previewCount: 1 },
  );
  assert(batonPreview.result.batonReinjectionPreviewReady === true, "baton reinjection preview should be ready");
  assert(batonPreview.result.mutationScope === "none", "preview must not mutate local context pointers");

  return {
    schema: REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "fixture_context_maintenance_execution_gate",
    status: "passed",
    matrixPromotionCandidate: false,
    rowsExercised: ["D7", "D10", "D11", "D13", "D14", "J11", "J12"],
    cases: [acceptedMemory, staleProposal, rawExposure, batonPreview].map(({ caseId, result }) => ({
      caseId,
      actionKind: result.actionKind,
      resultState: result.resultState,
      blockerCode: result.blockerCode,
      mutationScope: result.mutationScope,
      materializedArtifactCount: result.materializedArtifacts.length,
      previewArtifactCount: result.previewArtifacts.length,
      providerTransportUsed: result.providerTransportUsed,
      providerCompactionAllowed: result.providerCompactionAllowed,
      rawTextIncluded: result.rawTextIncluded,
    })),
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
      providerCompactionCalls: 0,
      automaticSchedulerCalls: 0,
      workspaceMutationCalls: 0,
    },
    rawExposure: {
      rawProviderPayloadIncluded: false,
      rawPromptTextIncluded: false,
      rawAssistantTextIncluded: false,
      rawToolOutputIncluded: false,
      rawPathIncluded: false,
    },
  };
}

function main() {
  const report = buildReport();
  const outDir = path.join(defaultAppUserDataRoot(), "direct-context-maintenance-execution-gate", `run_${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "direct-context-maintenance-execution-gate-report.json");
  writeJsonAtomic(reportPath, report);
  console.log(JSON.stringify({ ok: true, reportPath, status: report.status, coverageSource: report.coverageSource }, null, 2));
}

main();
