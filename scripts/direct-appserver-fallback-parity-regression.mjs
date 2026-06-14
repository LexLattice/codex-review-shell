#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA,
  assertAppServerFallbackParityReportSafe,
  buildAppServerFallbackParityReport,
} = require("../src/main/direct/readiness/appserver-fallback-parity");
const {
  buildDirectManualSmokeGate,
  assertDirectManualSmokeGateSafe,
} = require("../src/main/direct/readiness/manual-smoke-gate");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");

const projectId = "project_appserver_fallback_parity";
const generatedAt = "2026-06-14T00:00:00.000Z";

const visibleFallback = buildAppServerFallbackParityReport({
  projectId,
  generatedAt,
  runtimeStatus: {
    projectId,
    runtimeMode: "direct-experimental",
    currentCodexLane: "Direct implementation",
    directImplementationLane: {
      selected: true,
      blockers: ["implementation_lane_live_evidence_missing"],
    },
    diagnostics: {
      legacyAppServerAvailable: true,
      legacyAppServerStatus: "ready",
    },
  },
  legacySession: {
    key: "appserver_fixture_key",
    status: "ready",
    runtime: "wsl",
    provider: "codex_executable",
    readyUrl: "redacted-ready-url",
    capabilities: { schema: "fixture_capability_profile" },
  },
  directFallbackBlockers: ["implementation_lane_live_evidence_missing"],
});

assert.equal(visibleFallback.schema, DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA);
assert.equal(visibleFallback.parityState, "fallback_visible");
assert.equal(visibleFallback.selectedLane, "direct-implementation");
assert.equal(visibleFallback.appServerFallback.available, true);
assert.equal(visibleFallback.directFailurePosture.blocked, true);
assert.equal(visibleFallback.reloadReconnectPosture.transitionExposed, false);
assert.equal(visibleFallback.authority.appServerReplacementAllowed, false);
assert.equal(visibleFallback.authority.providerTransportAllowed, false);
assert.equal(visibleFallback.reportEffects.changesRuntimeSelection, false);
assertAppServerFallbackParityReportSafe(visibleFallback);

const missingFallback = buildAppServerFallbackParityReport({
  projectId,
  generatedAt,
  runtimeStatus: {
    projectId,
    runtimeMode: "direct-experimental",
    currentCodexLane: "Direct implementation",
    diagnostics: {
      legacyAppServerAvailable: false,
    },
  },
});

assert.equal(missingFallback.parityState, "blocked");
assert(missingFallback.blockerCodes.includes("app_server_fallback_not_visible"));
assertAppServerFallbackParityReportSafe(missingFallback);

const staleReroute = buildAppServerFallbackParityReport({
  projectId,
  generatedAt,
  runtimeStatus: {
    projectId,
    runtimeMode: "direct-experimental",
    currentCodexLane: "Direct implementation",
    diagnostics: {
      legacyAppServerAvailable: true,
      legacyAppServerStatus: "ready",
    },
  },
  legacySession: { key: "appserver_fixture_key", status: "ready" },
  stale: true,
  directFailureSilentlyRerouted: true,
  fallbackHiddenByDirectFailure: true,
});

assert.equal(staleReroute.parityState, "blocked");
assert(staleReroute.blockerCodes.includes("direct_failure_silent_reroute_detected"));
assert(staleReroute.blockerCodes.includes("fallback_hidden_by_direct_failure"));
assert(staleReroute.blockerCodes.includes("app_server_fallback_parity_stale"));
assertAppServerFallbackParityReportSafe(staleReroute);

const manualSmoke = buildDirectManualSmokeGate({
  projectId,
  generatedAt,
  runtimeStatus: {
    currentRuntimePath: "direct-implementation",
    appServerFallbackParity: visibleFallback,
  },
  appServerFallbackParityReport: visibleFallback,
  settingsProjection: {
    schema: "direct_settings_surface_projection@1",
    projectId,
    sections: {
      runtime: {
        currentPath: "direct-implementation",
        lane: "Direct implementation",
      },
      workThreadControl: {
        selectedWorkThreadId: "work_thread_fallback_parity_fixture",
        pointerState: "selected",
      },
      clarificationTargetPicker: { available: true, pickerState: "ready" },
      contextPreview: { available: true, previewState: "ready" },
      memoryWorkbench: { available: true, schema: "direct_memory_review_workbench@1" },
      moduleContextIntake: { available: true, schema: "direct_module_context_intake@1" },
      agentUsage: { available: true, schema: "direct_agent_usage_summary_projection@1", rowCount: 1 },
      appServerFallbackParity: visibleFallback,
    },
  },
  implementationLaneUiStatus: {
    implementationLane: {
      canStartFirstTurn: true,
      canApproveReadFile: true,
      canApprovePatchApply: true,
      canApproveRunCommand: true,
      facets: {
        canStartTurn: { canUse: true },
        canApproveRead: { canUse: true },
        canApprovePatch: { canUse: true },
        canApproveCommand: { canUse: true },
      },
    },
    recovery: { state: "healthy" },
  },
});

assertDirectManualSmokeGateSafe(manualSmoke);
const fallbackRow = manualSmoke.rows.find((row) => row.checkKind === "app_server_fallback");
assert.equal(fallbackRow.state, "warning");
assert.equal(fallbackRow.blockerCodes.length, 0);
assert(fallbackRow.warningCodes.includes("direct_path_blocked_fallback_still_visible"));
assert(fallbackRow.evidenceRefs.some((ref) => ref.kind === "appserver_fallback_parity" && ref.digest === visibleFallback.reportDigest));
assert.equal(manualSmoke.appServerFallbackParity.reportDigest, visibleFallback.reportDigest);
assert.equal(manualSmoke.authority.appServerReplacementAllowed, false);

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  runtimeStatus: {
    projectId,
    currentRuntimePath: "direct-implementation",
    appServerFallbackParity: visibleFallback,
  },
  appServerFallbackParityReport: visibleFallback,
  manualSmokeGate: manualSmoke,
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("appserver_fallback_parity"));
assert.equal(settingsProjection.sections.appServerFallbackParity.available, true);
assert.equal(settingsProjection.sections.appServerFallbackParity.parityState, "fallback_visible");
assert(settingsProjection.rows.appServerFallbackParity.some((row) => row.label === "Authority" && row.value === "display only"));
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "appserver_fallback_parity" && ref.digest === visibleFallback.reportDigest));

console.log(JSON.stringify({
  ok: true,
  schema: visibleFallback.schema,
  visibleState: visibleFallback.parityState,
  missingState: missingFallback.parityState,
  settingsDigest: settingsProjection.projectionDigest,
}, null, 2));
