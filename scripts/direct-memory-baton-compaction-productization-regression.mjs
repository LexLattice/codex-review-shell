#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA,
  DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA,
  DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA,
  buildContextContinuityStatusProjection,
  buildContextContinuityTransition,
  buildContextLossWitness,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildMaintenanceManifest,
  buildMemoryRefreshManifest,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildTrimPlan,
  selectMaintenanceRoute,
  validateContextContinuityProductization,
} = require("../src/main/direct/context/maintenance");
const {
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildFixture() {
  const workThread = buildWorkThread({
    workThreadId: "work_thread_memory_baton_fixture",
    projectId: "project_memory_baton_fixture",
    title: "Memory baton compaction productization fixture",
    objective: {
      currentObjective: "Represent memory, baton, and compaction state without granting runtime authority.",
    },
    activeRuntimePath: "direct-implementation",
  });
  const pressure = buildPressureEstimate({
    projectId: workThread.projectId,
    threadId: "thread_memory_baton_fixture",
    modelId: "fixture-model",
    visibleCharCount: 120_000,
    hiddenRequiredTokens: 800,
    reservedOutputTokens: 2_000,
    modelContextWindowEstimate: 24_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPolicy = buildRawWindowTrimPolicy();
  const trimPlan = buildTrimPlan({
    route,
    sourceContextProjectionId: "context_projection_memory_baton_fixture",
    sourceContextProjectionDigest: "context_projection_memory_baton_digest",
    trimPolicy,
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_memory_baton_fixture",
        sourceDigest: "context_projection_memory_baton_digest",
        sourceStableKeys: ["turn_old_1", "turn_old_2", "turn_old_3"],
        omittedItemCount: 3,
        omittedTurnCount: 3,
        omittedCharCount: 9600,
        omittedTokenEstimate: 2400,
        reason: "over_budget",
        rendererSafeSummary: "Three older optional dialogue turns were omitted under pressure.",
      },
    ],
  });
  const omissionLedger = buildOmissionLedger({ trimPlan });
  const memory = buildDurableThreadMemory({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Direct memory is quoted evidence, not current policy.",
        sourceRefs: [
          {
            artifactKind: "context_projection",
            artifactId: "context_projection_memory_baton_fixture",
            artifactDigest: "context_projection_memory_baton_digest",
          },
        ],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    nextMemory: memory,
    sourceRefs: [
      {
        artifactKind: "context_projection",
        artifactId: "context_projection_memory_baton_fixture",
        artifactDigest: "context_projection_memory_baton_digest",
      },
    ],
  });
  const baton = buildFrontierBaton({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "Continue after context maintenance with explicit omission evidence.",
      nextExpectedAction: "assistant_next_turn",
      openObligationRefs: [
        {
          artifactKind: "open_obligation",
          artifactId: "obligation_context_visibility",
          artifactDigest: "obligation_context_visibility_digest",
        },
      ],
    },
  });
  const manifest = buildMaintenanceManifest({
    route,
    pressureEstimate: pressure,
    outputKind: "trim_only",
    producedArtifacts: [
      { artifactKind: "raw_window_trim_plan", artifactId: trimPlan.trimPlanId, artifactDigest: trimPlan.integrity.artifactDigest },
      { artifactKind: "context_omission_ledger", artifactId: omissionLedger.omissionLedgerId, artifactDigest: omissionLedger.integrity.artifactDigest },
      { artifactKind: "durable_thread_memory", artifactId: memory.memoryId, artifactDigest: memory.integrity.artifactDigest },
      { artifactKind: "frontier_baton", artifactId: baton.batonId, artifactDigest: baton.integrity.artifactDigest },
    ],
  });
  const lossWitness = buildContextLossWitness({
    route,
    pressureEstimate: pressure,
    trimPlan,
    omissionLedger,
  });
  const explicitLossWitness = buildContextLossWitness({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    route,
    pressureEstimate: pressure,
    trimPlan,
    omissionLedger,
  });
  assert(lossWitness.contextLossWitnessId === explicitLossWitness.contextLossWitnessId, "loss witness id should use resolved project/thread fields");
  const transition = buildContextContinuityTransition({
    workThreadId: workThread.workThreadId,
    route,
    maintenanceManifest: manifest,
    omissionLedger,
    memory,
    memoryRefresh,
    baton,
    contextLossWitness: lossWitness,
  });
  const explicitTransition = buildContextContinuityTransition({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    workThreadId: workThread.workThreadId,
    route,
    maintenanceManifest: manifest,
    omissionLedger,
    memory,
    memoryRefresh,
    baton,
    contextLossWitness: lossWitness,
  });
  assert(transition.transitionId === explicitTransition.transitionId, "transition id should use resolved project/thread fields");
  const projection = buildContextContinuityStatusProjection({
    transition,
    contextLossWitness: lossWitness,
  });
  return { workThread, pressure, route, trimPlan, omissionLedger, memory, memoryRefresh, baton, manifest, lossWitness, transition, projection };
}

function main() {
  const fixture = buildFixture();
  assert(fixture.lossWitness.schema === DIRECT_CONTEXT_LOSS_WITNESS_SCHEMA, "loss witness schema mismatch");
  assert(fixture.lossWitness.lossState === "represented", "omitted context should be visibly represented");
  assert(fixture.lossWitness.totals.omittedItemCount === 3, "loss witness should preserve omitted item count");
  assert(fixture.lossWitness.hiddenContextLossAllowed === false, "hidden context loss must not be allowed");
  assert(fixture.lossWitness.rawTextIncluded === false, "loss witness must not include raw text");

  assert(fixture.transition.schema === DIRECT_CONTEXT_CONTINUITY_TRANSITION_SCHEMA, "transition schema mismatch");
  assert(fixture.transition.productizedForOperator === true, "transition should be productized");
  assert(fixture.transition.userVisibleTransition === true, "transition must be visible");
  assert(fixture.transition.memoryEditableInThisPr === false, "memory editing must remain disabled");
  assert(fixture.transition.memoryResetAllowedInThisPr === false, "memory reset must remain disabled");
  assert(fixture.transition.providerTransportUsed === false, "provider transport must not be used");
  assert(fixture.transition.providerCompactionAllowedInThisPr === false, "provider compaction must remain disabled");
  assert(fixture.transition.replayAuthority === false, "baton must not grant replay authority");
  assert(fixture.transition.contextLossWitnessId === fixture.lossWitness.contextLossWitnessId, "transition must cite context loss witness");

  assert(fixture.projection.schema === DIRECT_CONTEXT_CONTINUITY_STATUS_PROJECTION_SCHEMA, "projection schema mismatch");
  assert(fixture.projection.displayOnly === true, "projection must be display-only");
  assert(fixture.projection.contextLossState === "represented", "projection must expose context loss state");
  assert(fixture.projection.omittedItemCount === 3, "projection must expose omitted count");
  assert(fixture.projection.memoryState === "present", "projection should expose memory presence");
  assert(fixture.projection.batonState === "present", "projection should expose baton presence");
  assert(fixture.projection.compactActionAllowed === false, "projection must not expose compact action");
  assert(fixture.projection.memoryEditorAllowed === false, "projection must not expose memory editor");
  assert(fixture.projection.providerTransportAllowed === false, "projection must not expose provider transport");
  validateContextContinuityProductization({
    transition: fixture.transition,
    projection: fixture.projection,
  });

  const providerGateTransition = buildContextContinuityTransition({
    projectId: fixture.workThread.projectId,
    threadId: fixture.pressure.threadId,
    workThreadId: fixture.workThread.workThreadId,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: false,
    contextLossWitness: buildContextLossWitness({
      projectId: fixture.workThread.projectId,
      threadId: fixture.pressure.threadId,
      lossState: "none",
    }),
  });
  assert(providerGateTransition.providerCompactionGate.state === "blocked_missing_evidence", "provider compaction should fail closed without evidence");
  assert(providerGateTransition.providerCompactionGate.providerTransportAllowed === false, "provider gate must not allow transport");
  validateContextContinuityProductization({ transition: providerGateTransition });

  const { route: routeOnlyProviderCompactionBlock } = selectMaintenanceRoute({
    pressureEstimate: fixture.pressure,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: false,
  });
  const routeOnlyProviderGateTransition = buildContextContinuityTransition({
    route: routeOnlyProviderCompactionBlock,
  });
  assert(routeOnlyProviderGateTransition.providerCompactionGate.state === "blocked_missing_evidence", "route-only provider compaction request should stay blocked");

  const hostileTransition = { ...fixture.transition, providerCompactionAllowedInThisPr: true };
  let blocked = false;
  try {
    validateContextContinuityProductization({ transition: hostileTransition });
  } catch (error) {
    blocked = error.message === "context_continuity_provider_authority_leak";
  }
  assert(blocked === true, "validator should reject authority-leaking transitions");

  const serialized = JSON.stringify({
    lossWitness: fixture.lossWitness,
    transition: fixture.transition,
    projection: fixture.projection,
    providerGateTransition,
  });
  assert(!serialized.includes("\"rawTextIncluded\":true"), "raw text flags must remain false");
  assert(!serialized.includes("\"providerTransportUsed\":true"), "provider transport must remain false");

  console.log(JSON.stringify({
    ok: true,
    workThreadId: fixture.workThread.workThreadId,
    transitionId: fixture.transition.transitionId,
    contextLossWitnessId: fixture.lossWitness.contextLossWitnessId,
    projectionDigest: fixture.projection.projectionDigest,
    providerCompactionGate: providerGateTransition.providerCompactionGate.state,
    omittedItemCount: fixture.projection.omittedItemCount,
  }, null, 2));
}

main();
