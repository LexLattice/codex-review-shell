#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA,
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");
const {
  buildDirectAgentUsageLedger,
  buildDirectAgentUsageSummaryProjection,
} = require("../src/main/direct/usage/agent-ledger");
const {
  buildRuntimeWitnessProjection,
} = require("../src/main/direct/readiness/usage-readiness");
const {
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
  buildWorkThreadProjection,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildBridgeModuleAuthorityReport,
  buildBridgeContextContribution,
  buildBridgeEvidenceImportRow,
  buildBridgeExecutionGate,
  buildBridgeHookProposal,
  buildBridgeModuleRegistry,
  buildBridgeModuleStatusProjection,
} = require("../src/main/direct/bridge/skills-hooks-apps");
const {
  buildContextContinuityStatusProjection,
  buildContextContinuityTransition,
  buildContextLossWitness,
  buildCompactionWorkflowGate,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildLocalCompactionPlan,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildThreadMemoryRefreshProposal,
  buildThreadMemoryResetPolicy,
  buildThreadMemoryReviewPacket,
  buildTrimPlan,
  selectMaintenanceRoute,
} = require("../src/main/direct/context/maintenance");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildContinuityFixture(projectId, workThreadId) {
  const pressure = buildPressureEstimate({
    projectId,
    threadId: "thread_settings_surface_fixture",
    modelId: "gpt-5.4",
    visibleCharCount: 64_000,
    hiddenRequiredTokens: 400,
    reservedOutputTokens: 2_000,
    modelContextWindowEstimate: 128_000,
    nowMs: 0,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure, nowMs: 0 });
  const trimPlan = buildTrimPlan({
    route,
    trimPolicy: buildRawWindowTrimPolicy(),
    sourceContextProjectionId: "context_projection_settings_surface",
    sourceContextProjectionDigest: "context_projection_settings_surface_digest",
    candidateOmissions: [],
    nowMs: 0,
  });
  const omissionLedger = buildOmissionLedger({ trimPlan, nowMs: 0 });
  const memory = buildDurableThreadMemory({
    projectId,
    threadId: pressure.threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "Settings surface sees memory as evidence only.",
        sourceRefs: [{ artifactKind: "fixture", artifactId: "settings_surface", artifactDigest: "digest" }],
      },
    ],
    nowMs: 0,
  });
  const baton = buildFrontierBaton({
    projectId,
    threadId: pressure.threadId,
    batonRequirement: "not_required",
    frontier: {
      rendererSafeGoalSummary: "No baton action is exposed from settings.",
      nextExpectedAction: "inspect_status",
      openObligationRefs: [],
    },
    nowMs: 0,
  });
  const memoryReviewPacket = buildThreadMemoryReviewPacket({
    workThreadId,
    memory,
    omissionLedger,
    nowMs: 0,
  });
  const memoryRefreshProposal = buildThreadMemoryRefreshProposal({
    reviewPacket: memoryReviewPacket,
    currentMemory: memory,
    proposedMemory: memory,
    proposalState: "proposed",
    nowMs: 0,
  });
  const memoryResetPolicy = buildThreadMemoryResetPolicy({
    projectId,
    threadId: pressure.threadId,
    workThreadId,
    enabled: false,
    nowMs: 0,
  });
  const lossWitness = buildContextLossWitness({
    route,
    pressureEstimate: pressure,
    trimPlan,
    omissionLedger,
    nowMs: 0,
  });
  const localCompactionPlan = buildLocalCompactionPlan({
    contextLossWitness: lossWitness,
    workThreadId,
    nowMs: 0,
  });
  const compactionWorkflowGate = buildCompactionWorkflowGate({
    localCompactionPlan,
    contextLossWitness: lossWitness,
    manualCompactRequested: true,
    nowMs: 0,
  });
  const transition = buildContextContinuityTransition({
    workThreadId,
    route,
    omissionLedger,
    memory,
    baton,
    contextLossWitness: lossWitness,
    nowMs: 0,
  });
  return buildContextContinuityStatusProjection({
    projectId,
    threadId: pressure.threadId,
    workThreadId,
    transition,
    contextLossWitness: lossWitness,
    localCompactionPlan,
    compactionWorkflowGate,
    memoryReviewPacket,
    memoryRefreshProposal,
    memoryResetPolicy,
    nowMs: 0,
  });
}

function buildModuleStatusFixture(projectId, workThreadId) {
  const registry = buildBridgeModuleRegistry({
    projectId,
    workThreadId,
    nowMs: 0,
    modules: [
      {
        moduleId: "skill_settings_surface_fixture",
        moduleKind: "skill",
        displayName: "Settings Surface Fixture Skill",
        authorityPosture: "context_only",
        capabilities: [{ capabilityId: "cap_settings_context", capabilityKind: "procedural_context" }],
      },
      {
        moduleId: "connector_review_fixture",
        moduleKind: "connector",
        displayName: "Review Connector Fixture",
        authorityPosture: "evidence_import",
        capabilities: [{ capabilityId: "cap_review_import", capabilityKind: "external_evidence_import" }],
      },
      {
        moduleId: "hook_settings_fixture",
        moduleKind: "hook",
        displayName: "Settings Fixture Hook",
        authorityPosture: "execution_requires_gate",
        capabilities: [{ capabilityId: "cap_settings_hook", capabilityKind: "hook_action", authorityPosture: "execution_requires_gate" }],
      },
    ],
  });
  const report = buildBridgeModuleAuthorityReport({ registry });
  const skill = registry.modules.find((module) => module.moduleId === "skill_settings_surface_fixture");
  const connector = registry.modules.find((module) => module.moduleId === "connector_review_fixture");
  const hook = registry.modules.find((module) => module.moduleId === "hook_settings_fixture");
  const contextContribution = buildBridgeContextContribution({
    projectId,
    workThreadId,
    module: skill,
    contextRefs: [{ kind: "skill_context_ref", artifactId: "settings_skill_context", artifactDigest: "digest_settings_skill_context" }],
    nowMs: 0,
  });
  const evidenceImportRow = buildBridgeEvidenceImportRow({
    projectId,
    workThreadId,
    module: connector,
    sourceRefs: [{ kind: "review_comment", artifactId: "settings_review_comment", artifactDigest: "digest_settings_review" }],
    nowMs: 0,
  });
  const hookProposal = buildBridgeHookProposal({
    projectId,
    workThreadId,
    module: hook,
    sourceRefs: [{ kind: "settings_surface", artifactId: "settings_surface_fixture", artifactDigest: "digest_settings_surface" }],
    nowMs: 0,
  });
  const executionGate = buildBridgeExecutionGate({
    projectId,
    workThreadId,
    module: hook,
    hookProposal,
    executionRequested: true,
    nowMs: 0,
  });
  return buildBridgeModuleStatusProjection({
    registry,
    report,
    status: "shadow_only",
    contextContributions: [contextContribution],
    evidenceImportRows: [evidenceImportRow],
    hookProposals: [hookProposal],
    executionGates: [executionGate],
  });
}

function main() {
  const projectId = "project_direct_settings_surface";
  const workThread = buildWorkThread({
    workThreadId: "work_thread_direct_settings_surface",
    projectId,
    title: "Direct settings bridge status fixture",
    objective: "Inspect bridge state without granting authority.",
    activeRuntimePath: "direct-implementation",
    openObligations: [{ id: "obligation_settings_surface", kind: "inspection", status: "open", summary: "Keep settings display-only." }],
    nowMs: 0,
  });
  const workThreadProjection = buildWorkThreadProjection([workThread], { projectId, nowMs: 0 });
  const workTargetResolution = buildWorkTargetResolution({
    projectId,
    userRequest: "inspect settings bridge surface",
    activeRuntimePath: "direct-implementation",
  }, [workThread], { nowMs: 0 });
  const workTargetResolutionReport = buildWorkTargetResolutionReport({
    projectId,
    resolution: workTargetResolution,
  }, { nowMs: 0 });
  const moduleStatus = buildModuleStatusFixture(projectId, workThread.workThreadId);
  const continuityStatus = buildContinuityFixture(projectId, workThread.workThreadId);
  const agentUsageStatus = buildDirectAgentUsageSummaryProjection(buildDirectAgentUsageLedger({
    projectId,
    rows: [
      {
        rowId: "settings_usage_fixture",
        projectId,
        sessionId: "thread_settings_surface_fixture",
        threadId: "thread_settings_surface_fixture",
        turnId: "turn_settings_surface_fixture",
        workThreadId: workThread.workThreadId,
        routeScope: { routeId: "controlled_route_settings", routed: true },
        agentScope: { agentKind: "primary_agent", agentThreadId: "thread_settings_surface_fixture" },
        model: "gpt-5.4",
        reasoningEffort: "high",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        inputTokens: 9,
        outputTokens: 6,
        totalTokens: 15,
        timing: { durationMs: 2500 },
        rawPromptIncluded: false,
        rawResponseIncluded: false,
        rawProviderFrameIncluded: false,
        rawTokenDetailsIncluded: false,
        billingGrade: false,
      },
    ],
  }));
  const runtimeWitnessProjection = buildRuntimeWitnessProjection({
    projectId,
    generatedAt: "1970-01-01T00:00:00.000Z",
    chips: [
      { kind: "model", label: "Model gpt-5.4 (runtime-probed)", state: "fresh" },
      { kind: "reasoning", label: "Reasoning high (configured)", state: "diagnostic" },
      { kind: "quota", label: "Quota/rate unknown (no direct read authority)", state: "unknown" },
      { kind: "usage", label: "Usage rows 1 · known tokens 15", state: "fresh" },
      { kind: "drift", label: "Drift unknown (not run)", state: "unknown" },
    ],
  });
  const runtimeStatus = {
    projectId,
    status: "available",
    currentCodexLane: "direct implementation lane",
    selection: { runtimePath: "direct-implementation" },
    directImplementationLane: { status: "eligible" },
    activation: { status: "eligible", eligible: true },
    directContextMaintenance: {
      pressureState: "within_budget",
      routeKind: "no_op",
      memoryState: "present",
      memoryPointerState: "present",
      batonState: "present",
      omissionState: "represented",
      providerCompactState: "not_requested",
      providerTransportAllowed: false,
      maintenanceExecutionAllowed: false,
      memoryEditorAllowed: false,
      memoryResetAllowed: false,
      compactActionAllowed: false,
    },
  };
  const projection = buildDirectSettingsSurfaceProjection({
    projectId,
    runtimeStatus,
    registryAudit: buildDirectInformationBridgeAudit({ branch: "codex/direct-settings-bridge-status-surface", generatedAt: "1970-01-01T00:00:00.000Z" }),
    workThreads: {
      status: { available: true, workThreadCount: 1, activeCount: 1, projectionDigest: workThreadProjection.projectionDigest },
      projection: workThreadProjection,
      resolution: workTargetResolution,
      resolutionReport: workTargetResolutionReport,
    },
    governanceStatus: {
      schema: "governance_packet@1",
      mode: "shadow_only",
      enforced: false,
    },
    brokerStatus: {
      schema: "semantic_broker_packet@1",
      selectedRoute: "none",
      enforced: false,
      routingEnforced: false,
    },
    moduleStatus,
    runtimeWitnessProjection,
    agentUsageStatus,
    continuityStatus,
    nowMs: 0,
  });
  assert(projection.schema === DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA, "settings surface projection schema mismatch");
  assertDirectSettingsSurfaceRendererSafe(projection);
  assert(projection.projectId === projectId, "project id should be preserved");
  assert(projection.mode === "status_only", "settings surface should be status-only");
  assert(projection.sections.registry.settingsSurfaceState === "partial", "registry should classify ic15 as partial");
  assert(projection.sections.workThreads.available === true, "fixture WorkThread projection should be available");
  assert(projection.sections.workThreads.routingEnforced === false, "WorkThread routing must remain shadow-only");
  assert(projection.sections.workThreads.routingGateState === "selected_ready", "selected WorkThread report should be visible");
  assert(projection.sections.workThreads.mutationAllowed === false, "settings surface must not grant WorkThread mutation");
  assert(projection.sections.workThreads.mutationBlocked === false, "selected target should not be target-blocked");
  assert(projection.sections.workThreads.resolutionReportDigest === workTargetResolutionReport.reportDigest, "settings should cite resolver report digest");
  assert(projection.sections.governance.governanceEnforced === false, "governance must not be enforced");
  assert(projection.sections.governance.semanticBrokerEnforced === false, "semantic broker must not be enforced");
  assert(projection.sections.modules.executionAllowedInThisPr === false, "module execution must be disabled");
  assert(projection.sections.modules.contextContributionCount === 1, "module context contribution count should be visible");
  assert(projection.sections.modules.evidenceImportRowCount === 1, "module evidence import row count should be visible");
  assert(projection.sections.modules.hookProposalCount === 1, "module hook proposal count should be visible");
  assert(projection.sections.modules.executionGateCount === 1, "module execution gate count should be visible");
  assert(projection.sections.continuity.providerTransportAllowed === false, "provider transport must be disabled");
  assert(projection.sections.continuity.manualCompactActionAllowed === false, "manual compact action must be disabled");
  assert(projection.sections.continuity.memoryEditorAllowed === false, "memory editing must be disabled");
  assert(projection.sections.continuity.memoryResetAllowed === false, "memory reset must be disabled");
  assert(projection.sections.continuity.memoryReviewState === "current", "memory review state should be visible");
  assert(projection.sections.continuity.memoryRefreshProposalState === "proposed", "memory refresh proposal state should be visible");
  assert(projection.sections.continuity.memoryResetPolicyState === "disabled", "memory reset policy state should be visible");
  assert(projection.sections.continuity.memoryResetConfirmationState === "not_requested", "memory reset confirmation state should be visible");
  assert(projection.sections.continuity.localCompactionPlanState === "preview_ready", "local compaction plan state should be visible");
  assert(projection.sections.continuity.manualCompactGateState === "manual_ready", "manual compact gate state should be visible");
  assert(projection.sections.continuity.compactionSourceSpanCount === 0, "compaction source span count should be visible");
  assert(projection.sections.continuity.compactionResidualRiskCount === 0, "compaction residual risk count should be visible");
  assert(projection.sections.agentUsage.available === true, "agent usage summary should be visible");
  assert(projection.sections.agentUsage.totalTokensKnown === 15, "agent usage known tokens should be visible");
  assert(projection.sections.agentUsage.costComputed === false, "settings surface must not compute cost");
  assert(projection.sections.runtimeWitness.available === true, "runtime witness projection should be visible");
  assert(projection.sections.runtimeWitness.modelState === "fresh", "runtime witness should expose model state");
  assert(projection.sections.runtimeWitness.quotaState === "unknown", "quota witness should remain unknown when not read");
  assert(projection.sections.runtimeWitness.driftState === "unknown", "drift witness should remain unknown when not run");
  assert(projection.sections.runtimeWitness.costComputed === false, "runtime witness must not compute cost");
  assert(projection.rows.runtime.length >= 4, "runtime rows should render");
  assert(projection.rows.registry.length >= 4, "registry rows should render");
  assert(projection.rows.workThreads.length >= 4, "WorkThread rows should render");
  assert(projection.rows.workThreads.some((row) => row.label === "Target gate" && row.value === "selected_ready"), "WorkThread rows should include target gate");
  assert(projection.rows.workThreads.some((row) => row.label === "Mutation" && row.value === "not granted"), "WorkThread rows should keep mutation not granted");
  assert(projection.rows.modules.length >= 4, "module rows should render");
  assert(projection.rows.modules.some((row) => row.label === "Context refs" && row.value === "1"), "module rows should include context refs");
  assert(projection.rows.modules.some((row) => row.label === "Evidence rows" && row.value === "1"), "module rows should include evidence rows");
  assert(projection.rows.agentUsage.some((row) => row.label === "Cost" && row.value === "not computed"), "agent usage rows should show no cost computation");
  assert(projection.rows.runtimeWitness.some((row) => row.label === "Quota/rate" && row.value.includes("unknown")), "runtime witness rows should show unknown quota");
  assert(projection.rows.runtimeWitness.some((row) => row.label === "Authority" && row.value === "display only"), "runtime witness rows should stay display-only");
  assert(projection.rows.modules.some((row) => row.label === "Hook proposals" && row.value === "1"), "module rows should include hook proposals");
  assert(projection.rows.modules.some((row) => row.label === "Execution gates" && row.value === "1"), "module rows should include execution gates");
  assert(projection.rows.continuity.some((row) => row.label === "Memory review" && row.value === "current"), "continuity rows should include memory review");
  assert(projection.rows.continuity.some((row) => row.label === "Memory refresh" && row.value === "proposed"), "continuity rows should include memory refresh");
  assert(projection.rows.continuity.some((row) => row.label === "Memory reset" && row.value === "disabled"), "continuity rows should include memory reset");
  assert(projection.rows.continuity.some((row) => row.label === "Memory reset confirmation" && row.value === "not_requested"), "continuity rows should include memory reset confirmation");
  assert(projection.rows.continuity.some((row) => row.label === "Local compact plan" && row.value === "preview_ready"), "continuity rows should include local compact plan");
  assert(projection.rows.continuity.some((row) => row.label === "Manual compact gate" && row.value === "manual_ready"), "continuity rows should include manual compact gate");
  assert(projection.rows.continuity.some((row) => row.label === "Compact spans/risks" && row.value === "0/0"), "continuity rows should include compact spans and risks");
  assert(projection.rawTextIncluded === false, "raw text must be excluded");
  assert(projection.rawPathIncluded === false, "raw paths must be excluded");
  assert(projection.rawSecretIncluded === false, "raw secrets must be excluded");

  const staleWorkTargetResolutionReport = buildWorkTargetResolutionReport({
    projectId,
    resolution: workTargetResolution,
    expectedResolutionDigest: "sha256:stale",
  }, { nowMs: 0 });
  const staleProjection = buildDirectSettingsSurfaceProjection({
    projectId,
    workThreads: {
      status: { available: true, workThreadCount: 1, activeCount: 1, projectionDigest: workThreadProjection.projectionDigest },
      projection: workThreadProjection,
      resolution: workTargetResolution,
      resolutionReport: staleWorkTargetResolutionReport,
    },
    nowMs: 0,
  });
  assert(staleProjection.sections.workThreads.routingGateState === "stale_blocked", "stale report should own the settings gate state");
  assert(staleProjection.sections.workThreads.selectedWorkThreadId === "", "stale report must not fall back to raw selected target");
  assert(staleProjection.sections.workThreads.mutationBlocked === true, "stale report should keep mutation blocked");
  assert(staleProjection.sections.workThreads.ambiguityBlockers.includes("resolution_digest_mismatch"), "stale report blockers should be visible");

  const zeroCandidateProjection = buildDirectSettingsSurfaceProjection({
    projectId,
    workThreads: {
      projection: workThreadProjection,
      resolution: {
        ...workTargetResolution,
        candidates: [{ workThreadId: "raw_candidate_should_not_win" }],
      },
      resolutionReport: {
        ...workTargetResolutionReport,
        candidateCount: 0,
        candidates: [],
        selectedWorkThreadId: "",
      },
    },
    nowMs: 0,
  });
  assert(zeroCandidateProjection.sections.workThreads.candidateCount === 0, "explicit report candidate count should be preserved");
  assert(zeroCandidateProjection.sections.workThreads.selectedWorkThreadId === "", "explicit report selected target should be preserved");

  const nullProjection = buildDirectSettingsSurfaceProjection(null);
  assert(nullProjection.schema === DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA, "null input should produce a safe empty projection");
  assertDirectSettingsSurfaceRendererSafe(nullProjection);

  const memoryFallbackProjection = buildDirectSettingsSurfaceProjection({
    projectId,
    runtimeStatus: {
      directContextMaintenance: {
        memoryState: "present",
      },
    },
  });
  assert(memoryFallbackProjection.sections.runtime.memoryState === "present", "memoryState should be preserved when memoryPointerState is absent");
  console.log(JSON.stringify({
    ok: true,
    schema: projection.schema,
    projectionDigest: projection.projectionDigest,
    rowGroups: Object.keys(projection.rows),
  }, null, 2));
}

main();
