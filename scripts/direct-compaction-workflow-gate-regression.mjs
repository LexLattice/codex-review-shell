#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA,
  DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA,
  buildCompactionWorkflowGate,
  buildContextContinuityStatusProjection,
  buildContextContinuityTransition,
  buildContextLossWitness,
  buildLocalCompactionPlan,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildTrimPlan,
  selectMaintenanceRoute,
  validateCompactionWorkflow,
  validateContextContinuityProductization,
} = require("../src/main/direct/context/maintenance");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const projectId = "project_compaction_gate_fixture";
  const threadId = "thread_compaction_gate_fixture";
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount: 120_000,
    hiddenRequiredTokens: 500,
    reservedOutputTokens: 2_000,
    modelContextWindowEstimate: 24_000,
    nowMs: 0,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure, nowMs: 0 });
  const trimPlan = buildTrimPlan({
    route,
    trimPolicy: buildRawWindowTrimPolicy(),
    sourceContextProjectionId: "context_projection_compaction_gate",
    sourceContextProjectionDigest: "context_projection_compaction_gate_digest",
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_compaction_gate",
        sourceDigest: "context_projection_compaction_gate_digest",
        sourceStableKeys: ["turn_old_a", "turn_old_b"],
        omittedItemCount: 2,
        omittedTurnCount: 2,
        omittedCharCount: 7200,
        omittedTokenEstimate: 1800,
        reason: "over_budget",
        rendererSafeSummary: "Two old optional turns are represented before local compaction preview.",
      },
    ],
    nowMs: 0,
  });
  const omissionLedger = buildOmissionLedger({ trimPlan, nowMs: 0 });
  const contextLossWitness = buildContextLossWitness({
    route,
    trimPlan,
    omissionLedger,
    pressureEstimate: pressure,
    nowMs: 0,
  });
  const localCompactionPlan = buildLocalCompactionPlan({
    contextLossWitness,
    workThreadId: "work_thread_compaction_gate_fixture",
    residualRiskWitnesses: [
      {
        riskKind: "summary_loss",
        severity: "medium",
        sourceSpanId: "context_loss_entry_1",
        rendererSafeSummary: "Compacted preview may compress local sequence details.",
      },
    ],
    nowMs: 0,
  });
  const compactionWorkflowGate = buildCompactionWorkflowGate({
    localCompactionPlan,
    contextLossWitness,
    manualCompactRequested: true,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: false,
    nowMs: 0,
  });
  const transition = buildContextContinuityTransition({
    route,
    omissionLedger,
    contextLossWitness,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: false,
    nowMs: 0,
  });
  const projection = buildContextContinuityStatusProjection({
    transition,
    contextLossWitness,
    localCompactionPlan,
    compactionWorkflowGate,
    nowMs: 0,
  });

  assert(localCompactionPlan.schema === DIRECT_CONTEXT_COMPACTION_PLAN_SCHEMA, "compaction plan schema mismatch");
  assert(localCompactionPlan.planState === "preview_ready", "source-span-backed plan should be preview-ready");
  assert(localCompactionPlan.compactedContextEligible === true, "context should be eligible only after context-loss witness exists");
  assert(localCompactionPlan.sourceSpanCount === 1, "plan should derive one source span from omission witness");
  assert(localCompactionPlan.residualRiskCount === 1, "plan should expose residual risk witnesses");
  assert(localCompactionPlan.materializedInThisPr === false, "plan must not materialize compacted context");
  assert(localCompactionPlan.contextMutationAllowedInThisPr === false, "plan must not mutate context");
  assert(localCompactionPlan.providerCompactionUsed === false, "local plan must not use provider compaction");
  assert(localCompactionPlan.hiddenOmissionAllowed === false, "plan must not hide omissions");

  assert(compactionWorkflowGate.schema === DIRECT_CONTEXT_COMPACTION_GATE_SCHEMA, "compaction gate schema mismatch");
  assert(compactionWorkflowGate.manualCompactGateState === "manual_ready", "manual gate should be ready only as display state");
  assert(compactionWorkflowGate.manualCompactActionAllowed === false, "manual compact action must stay disabled in this PR");
  assert(compactionWorkflowGate.automaticSchedulerAllowed === false, "scheduler must stay disabled");
  assert(compactionWorkflowGate.providerCompactionAllowed === false, "provider compaction must stay blocked");
  assert(compactionWorkflowGate.providerTransportAllowed === false, "provider transport must stay blocked");
  assert(compactionWorkflowGate.providerCompactionGate.state === "blocked_missing_evidence", "provider compaction should fail closed without evidence");

  assert(projection.localCompactionPlanState === "preview_ready", "projection should expose local plan state");
  assert(projection.manualCompactGateState === "manual_ready", "projection should expose manual gate state");
  assert(projection.compactionSourceSpanCount === 1, "projection should expose source span count");
  assert(projection.compactionResidualRiskCount === 1, "projection should expose residual risk count");
  assert(projection.compactActionAllowed === false, "projection must not allow compact action");
  assert(projection.manualCompactActionAllowed === false, "projection must not allow manual compact action");
  assert(projection.providerTransportAllowed === false, "projection must not allow provider transport");

  validateCompactionWorkflow({ localCompactionPlan, compactionWorkflowGate });
  validateContextContinuityProductization({
    transition,
    projection,
    localCompactionPlan,
    compactionWorkflowGate,
  });

  const blockedPlan = buildLocalCompactionPlan({ nowMs: 0 });
  const blockedGate = buildCompactionWorkflowGate({
    localCompactionPlan: blockedPlan,
    manualCompactRequested: true,
    nowMs: 0,
  });
  assert(blockedPlan.planState === "blocked_missing_context_loss_witness", "plan should require context-loss witness");
  assert(blockedGate.manualCompactGateState === "blocked_missing_context_loss_witness", "gate should inherit missing-witness block");
  validateCompactionWorkflow({ localCompactionPlan: blockedPlan, compactionWorkflowGate: blockedGate });

  const defensivePlan = buildLocalCompactionPlan({
    contextLossWitness,
    sourceSpanWitnesses: [null, "not an object"],
    residualRiskWitnesses: [null, "not an object"],
    nowMs: 0,
  });
  assert(defensivePlan.sourceSpanCount === 2, "source span normalization should preserve sparse entries as inert witnesses");
  assert(defensivePlan.sourceSpanWitnesses.every((span) => span.rawTextIncluded === false), "sparse source spans should remain renderer safe");
  assert(defensivePlan.residualRiskCount === 2, "residual risk normalization should preserve sparse entries as inert witnesses");
  validateCompactionWorkflow({ localCompactionPlan: defensivePlan });

  let invalidReadyGateBlocked = false;
  try {
    validateCompactionWorkflow({
      compactionWorkflowGate: {
        ...compactionWorkflowGate,
        compactionGateId: "invalid_manual_ready_without_plan",
        compactionPlanId: "",
        manualCompactGateState: "manual_ready",
      },
    });
  } catch (error) {
    invalidReadyGateBlocked = error.message === "context_compaction_gate_ready_without_plan";
  }
  assert(invalidReadyGateBlocked === true, "manual-ready gate without a plan should be rejected");

  let invalidSpanArrayBlocked = false;
  try {
    validateCompactionWorkflow({
      localCompactionPlan: {
        ...localCompactionPlan,
        sourceSpanWitnesses: null,
      },
    });
  } catch (error) {
    invalidSpanArrayBlocked = error.message === "context_compaction_plan_source_span_count_mismatch";
  }
  assert(invalidSpanArrayBlocked === true, "preview-ready plan should require a source-span array");

  const serialized = JSON.stringify({ localCompactionPlan, compactionWorkflowGate, projection });
  assert(!serialized.includes("\"rawTextIncluded\":true"), "compaction workflow must not include raw text");
  assert(!serialized.includes("\"manualCompactActionAllowed\":true"), "compaction gate must not enable manual compact");
  assert(!serialized.includes("\"providerTransportAllowed\":true"), "compaction gate must not enable provider transport");

  console.log(JSON.stringify({
    ok: true,
    compactionPlanId: localCompactionPlan.compactionPlanId,
    compactionGateId: compactionWorkflowGate.compactionGateId,
    localCompactionPlanState: projection.localCompactionPlanState,
    manualCompactGateState: projection.manualCompactGateState,
    providerCompactionState: projection.providerCompactionState,
    sourceSpanCount: projection.compactionSourceSpanCount,
    residualRiskCount: projection.compactionResidualRiskCount,
  }, null, 2));
}

main();
