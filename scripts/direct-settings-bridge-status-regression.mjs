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
  buildWorkTargetResolution,
  buildWorkThread,
  buildWorkThreadProjection,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildBridgeModuleAuthorityReport,
  buildBridgeModuleRegistry,
  buildBridgeModuleStatusProjection,
} = require("../src/main/direct/bridge/skills-hooks-apps");
const {
  buildContextContinuityStatusProjection,
  buildContextContinuityTransition,
  buildContextLossWitness,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
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
  const lossWitness = buildContextLossWitness({
    route,
    pressureEstimate: pressure,
    trimPlan,
    omissionLedger,
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
    ],
  });
  const report = buildBridgeModuleAuthorityReport({ registry });
  return buildBridgeModuleStatusProjection({ registry, report, status: "shadow_only" });
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
  const moduleStatus = buildModuleStatusFixture(projectId, workThread.workThreadId);
  const continuityStatus = buildContinuityFixture(projectId, workThread.workThreadId);
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
  assert(projection.sections.governance.governanceEnforced === false, "governance must not be enforced");
  assert(projection.sections.governance.semanticBrokerEnforced === false, "semantic broker must not be enforced");
  assert(projection.sections.modules.executionAllowedInThisPr === false, "module execution must be disabled");
  assert(projection.sections.continuity.providerTransportAllowed === false, "provider transport must be disabled");
  assert(projection.sections.continuity.memoryEditorAllowed === false, "memory editing must be disabled");
  assert(projection.sections.continuity.memoryResetAllowed === false, "memory reset must be disabled");
  assert(projection.rows.runtime.length >= 4, "runtime rows should render");
  assert(projection.rows.registry.length >= 4, "registry rows should render");
  assert(projection.rows.workThreads.length >= 4, "WorkThread rows should render");
  assert(projection.rows.modules.length >= 4, "module rows should render");
  assert(projection.rawTextIncluded === false, "raw text must be excluded");
  assert(projection.rawPathIncluded === false, "raw paths must be excluded");
  assert(projection.rawSecretIncluded === false, "raw secrets must be excluded");

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
