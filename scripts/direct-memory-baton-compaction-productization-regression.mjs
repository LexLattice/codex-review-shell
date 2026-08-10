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
  buildThreadMemoryRefreshProposal,
  buildThreadMemoryResetConfirmation,
  buildThreadMemoryResetPolicy,
  buildThreadMemoryReviewPacket,
  buildTrimPlan,
  selectMaintenanceRoute,
  validateContextContinuityProductization,
  validateThreadMemoryWorkflow,
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
        staleness: "stale",
        conflictState: "superseded",
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
  const memoryReviewPacket = buildThreadMemoryReviewPacket({
    workThreadId: workThread.workThreadId,
    memory,
    omissionLedger,
    sourceRefs: [
      {
        artifactKind: "context_projection",
        artifactId: "context_projection_memory_baton_fixture",
        artifactDigest: "context_projection_memory_baton_digest",
      },
    ],
  });
  const proposedMemory = buildDurableThreadMemory({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    previousMemoryDigest: memory.integrity.artifactDigest,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Direct memory refresh proposal resolves stale context evidence.",
        staleness: "current",
        conflictState: "none",
        sourceRefs: [
          {
            artifactKind: "thread_memory_review_packet",
            artifactId: memoryReviewPacket.memoryReviewPacketId,
            artifactDigest: memoryReviewPacket.integrity.artifactDigest,
          },
        ],
      },
    ],
  });
  const acceptedRefreshProposal = buildThreadMemoryRefreshProposal({
    reviewPacket: memoryReviewPacket,
    currentMemory: memory,
    proposedMemory,
    proposalState: "accepted",
    sourceRefs: [
      {
        artifactKind: "thread_memory_review_packet",
        artifactId: memoryReviewPacket.memoryReviewPacketId,
        artifactDigest: memoryReviewPacket.integrity.artifactDigest,
      },
    ],
  });
  const rejectedRefreshProposal = buildThreadMemoryRefreshProposal({
    reviewPacket: memoryReviewPacket,
    currentMemory: memory,
    proposedMemory,
    proposalState: "rejected",
  });
  const resetPolicy = buildThreadMemoryResetPolicy({
    projectId: workThread.projectId,
    threadId: pressure.threadId,
    workThreadId: workThread.workThreadId,
    enabled: true,
    sourceRefs: [
      {
        artifactKind: "thread_memory_review_packet",
        artifactId: memoryReviewPacket.memoryReviewPacketId,
        artifactDigest: memoryReviewPacket.integrity.artifactDigest,
      },
    ],
  });
  const resetConfirmation = buildThreadMemoryResetConfirmation({
    resetPolicy,
    confirmedByOperator: true,
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
    memoryReviewPacket,
    memoryRefreshProposal: acceptedRefreshProposal,
    memoryResetPolicy: resetPolicy,
    memoryResetConfirmation: resetConfirmation,
  });
  return {
    workThread,
    pressure,
    route,
    trimPlan,
    omissionLedger,
    memory,
    memoryRefresh,
    memoryReviewPacket,
    proposedMemory,
    acceptedRefreshProposal,
    rejectedRefreshProposal,
    resetPolicy,
    resetConfirmation,
    baton,
    manifest,
    lossWitness,
    transition,
    projection,
  };
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
  assert(fixture.projection.memoryReviewState === "conflicted", "projection should expose memory review state");
  assert(fixture.projection.memoryRefreshProposalState === "accepted", "projection should expose refresh proposal state");
  assert(fixture.projection.memoryResetPolicyState === "available_with_confirmation", "projection should expose reset policy state");
  assert(fixture.projection.memoryResetConfirmationState === "confirmed_noop", "projection should expose reset confirmation state");
  assert(fixture.projection.staleMemoryEntryCount === 1, "projection should expose stale memory count");
  assert(fixture.projection.conflictedMemoryEntryCount === 1, "projection should expose conflicted memory count");
  assert(fixture.projection.batonState === "present", "projection should expose baton presence");
  assert(fixture.projection.compactActionAllowed === false, "projection must not expose compact action");
  assert(fixture.projection.memoryEditorAllowed === false, "projection must not expose memory editor");
  assert(fixture.projection.providerTransportAllowed === false, "projection must not expose provider transport");
  validateContextContinuityProductization({
    transition: fixture.transition,
    projection: fixture.projection,
  });
  validateThreadMemoryWorkflow({
    reviewPacket: fixture.memoryReviewPacket,
    refreshProposal: fixture.acceptedRefreshProposal,
    resetPolicy: fixture.resetPolicy,
    resetConfirmation: fixture.resetConfirmation,
  });
  validateThreadMemoryWorkflow({
    refreshProposal: fixture.rejectedRefreshProposal,
  });
  assert(fixture.memoryReviewPacket.memoryAsPolicyAuthority === false, "memory review must not become policy authority");
  assert(fixture.memoryReviewPacket.providerMemoryClaimAccepted === false, "provider memory claims must not be accepted");
  assert(fixture.acceptedRefreshProposal.acceptedByOperator === true, "accepted proposal should record operator acceptance");
  assert(fixture.acceptedRefreshProposal.materializedInThisPr === false, "accepted proposal must not materialize memory");
  assert(fixture.acceptedRefreshProposal.currentMemoryRetained === true, "current memory must be retained");
  assert(fixture.rejectedRefreshProposal.rejectedByOperator === true, "rejected proposal should record rejection");
  assert(fixture.resetPolicy.resetAllowedInThisPr === false, "reset policy must not enable reset");
  assert(fixture.resetPolicy.resetWorkflowVisible === true, "enabled reset policy should be visible from policy state");
  assert(fixture.resetConfirmation.resetExecuted === false, "reset confirmation must be a no-op");
  assert(fixture.resetConfirmation.confirmedByOperator === true, "available reset confirmation should record operator confirmation");

  const blockedRefreshProposal = buildThreadMemoryRefreshProposal({
    reviewPacket: fixture.memoryReviewPacket,
    currentMemory: fixture.memory,
    proposalState: "accepted",
  });
  assert(blockedRefreshProposal.proposalState === "blocked", "accepted refresh must require a concrete proposed memory");
  assert(blockedRefreshProposal.acceptedByOperator === false, "blocked refresh must not record operator acceptance");

  const disabledResetPolicy = buildThreadMemoryResetPolicy({
    projectId: fixture.workThread.projectId,
    threadId: fixture.pressure.threadId,
    enabled: false,
  });
  const blockedResetConfirmation = buildThreadMemoryResetConfirmation({
    resetPolicy: disabledResetPolicy,
    confirmedByOperator: true,
  });
  assert(disabledResetPolicy.resetWorkflowVisible === false, "disabled reset policy should not show reset workflow");
  assert(blockedResetConfirmation.confirmationState === "blocked", "disabled reset policy should block confirmation");
  assert(blockedResetConfirmation.confirmedByOperator === false, "blocked reset confirmation must not record operator confirmation");
  validateThreadMemoryWorkflow({
    resetPolicy: disabledResetPolicy,
    resetConfirmation: blockedResetConfirmation,
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
    memoryReviewPacket: fixture.memoryReviewPacket,
    acceptedRefreshProposal: fixture.acceptedRefreshProposal,
    resetPolicy: fixture.resetPolicy,
    resetConfirmation: fixture.resetConfirmation,
  });
  assert(!serialized.includes("\"rawTextIncluded\":true"), "raw text flags must remain false");
  assert(!serialized.includes("\"providerTransportUsed\":true"), "provider transport must remain false");
  assert(!serialized.includes("\"memoryMutationAllowedInThisPr\":true"), "memory mutation must remain disabled");

  console.log(JSON.stringify({
    ok: true,
    workThreadId: fixture.workThread.workThreadId,
    transitionId: fixture.transition.transitionId,
    contextLossWitnessId: fixture.lossWitness.contextLossWitnessId,
    projectionDigest: fixture.projection.projectionDigest,
    memoryReviewState: fixture.projection.memoryReviewState,
    memoryRefreshProposalState: fixture.projection.memoryRefreshProposalState,
    memoryResetPolicyState: fixture.projection.memoryResetPolicyState,
    providerCompactionGate: providerGateTransition.providerCompactionGate.state,
    omittedItemCount: fixture.projection.omittedItemCount,
  }, null, 2));
}

main();
