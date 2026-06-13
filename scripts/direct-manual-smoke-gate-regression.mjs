#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectManualSmokeGateSafe,
  buildDirectManualSmokeGate,
} = require("../src/main/direct/readiness/manual-smoke-gate");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");
const {
  buildDirectInformationBridgeAudit,
} = require("../src/main/direct/bridge/information-registry");

const projectId = "project_direct_manual_smoke";
const workThreadId = "work_thread_manual_smoke";
const threadId = "thread_manual_smoke";

function settingsFixture() {
  return {
    schema: "direct_settings_surface_projection@1",
    projectId,
    sections: {
      runtime: {
        currentPath: "direct-implementation",
        lane: "Direct implementation",
        status: "ready",
        statusDigest: "digest_runtime_status",
      },
      workThreadControl: {
        available: true,
        selectedWorkThreadId: workThreadId,
        pointerState: "selected",
        controlDeckDigest: "digest_workthread_control",
      },
      clarificationTargetPicker: {
        available: true,
        pickerState: "ready",
        targetPickerDigest: "digest_target_picker",
        blockerCodes: [],
      },
      contextPreview: {
        available: true,
        schema: "direct_context_packet_preview@1",
        previewState: "ready",
        previewDigest: "digest_context_preview",
        blockerCodes: [],
      },
      memoryWorkbench: {
        available: true,
        schema: "direct_memory_review_workbench@1",
        workbenchState: "ready",
        workbenchDigest: "digest_memory_workbench",
        rawExposureUnsafeCount: 0,
      },
      moduleContextIntake: {
        available: true,
        schema: "direct_module_context_intake@1",
        intakeState: "ready",
        intakeDigest: "digest_module_context_intake",
        rawExposureUnsafeCount: 0,
      },
      agentUsage: {
        available: true,
        schema: "direct_agent_usage_summary_projection@1",
        rowCount: 2,
        projectionDigest: "digest_agent_usage",
        missingUsageRowCount: 0,
      },
    },
  };
}

function implementationUiFixture() {
  return {
    schema: "direct_implementation_lane_ui_status@1",
    meta: {
      sourceDigest: "digest_implementation_lane_ui",
    },
    implementationLane: {
      canStartFirstTurn: true,
      canStartFollowupTurn: true,
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
    recovery: {
      state: "healthy_terminal",
      recoveryReportDigest: "digest_recovery",
      blockerCodes: [],
    },
  };
}

const passingGate = buildDirectManualSmokeGate({
  projectId,
  workThreadId,
  threadId,
  nowMs: 0,
  settingsProjection: settingsFixture(),
  implementationLaneUiStatus: implementationUiFixture(),
  appServerFallbackAvailable: true,
  subAgentProjection: {
    schema: "direct_sub_agent_contained_tab_projection@1",
    counts: { total: 1 },
    projectionDigest: "digest_sub_agent_projection",
  },
  electronProjectionStatus: {
    available: true,
    digest: "digest_electron_projection",
  },
});

assert.equal(passingGate.schema, "direct_manual_smoke_gate@1");
assert.equal(passingGate.generatedAt, "1970-01-01T00:00:00.000Z");
assert.equal(passingGate.gateState, "passed");
assert.equal(passingGate.counts.rowCount, 15);
assert.equal(passingGate.counts.passedCount, 15);
assert.equal(passingGate.counts.requiredBlockedCount, 0);
assert.equal(passingGate.matrixPromotionCandidate, false);
assert.equal(passingGate.electronRunner.liveProviderCallsAllowed, false);
assert.equal(passingGate.authority.manualSmokeExecutionAllowed, false);
assert.equal(passingGate.authority.providerTransportAllowed, false);
assert.equal(passingGate.authority.workspaceMutationAllowed, false);
assert.equal(passingGate.authority.appServerReplacementAllowed, false);
assert.equal(passingGate.authority.matrixPromotionAllowed, false);
assertDirectManualSmokeGateSafe(passingGate);

const rowKinds = passingGate.rows.map((row) => row.checkKind).sort();
assert.deepEqual(rowKinds, [
  "app_server_fallback",
  "context_preview",
  "direct_text_turn",
  "electron_projection",
  "lane_selection",
  "memory_review",
  "module_context_intake",
  "readiness_command",
  "readiness_patch",
  "readiness_read",
  "recovery_posture",
  "sub_agent_inspect",
  "target_clarification",
  "usage_readiness",
  "workthread_selection",
]);

const blockedGate = buildDirectManualSmokeGate({
  projectId,
  nowMs: 0,
  settingsProjection: {
    schema: "direct_settings_surface_projection@1",
    sections: {
      runtime: { currentPath: "", status: "unknown" },
      workThreadControl: { available: true, pointerState: "missing" },
      contextPreview: { available: true, previewState: "blocked_from_request", blockerCodes: ["required_source_missing"] },
    },
  },
  implementationLaneUiStatus: {
    implementationLane: {
      facets: {},
    },
  },
  appServerFallbackAvailable: false,
});

assertDirectManualSmokeGateSafe(blockedGate);
assert.equal(blockedGate.gateState, "blocked");
assert(blockedGate.counts.requiredBlockedCount > 0);
assert(blockedGate.blockerCodes.includes("workthread_current_pointer_missing"));
assert(blockedGate.blockerCodes.includes("direct_text_turn_not_ready"));
assert(blockedGate.rows.every((row) => row.state !== "blocked" || row.blockerCodes.length > 0), "blocked rows must carry explicit blocker evidence");

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  manualSmokeGate: passingGate,
  registryAudit: buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" }),
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert(settingsProjection.bridgeOrgans.includes("manual_smoke_gate"));
assert.equal(settingsProjection.sections.manualSmokeGate.available, true);
assert.equal(settingsProjection.sections.manualSmokeGate.gateState, "passed");
assert.equal(settingsProjection.sections.manualSmokeGate.rowCount, 15);
assert.equal(settingsProjection.sections.manualSmokeGate.providerTransportAllowed, false);
assert.equal(settingsProjection.sections.manualSmokeGate.matrixPromotionAllowed, false);
assert.equal(settingsProjection.rows.manualSmokeGate.some((row) => row.label === "Authority" && row.value === "display only"), true);
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "manual_smoke_gate" && ref.digest));

const audit = buildDirectInformationBridgeAudit({ generatedAt: "2026-06-14T00:00:00.000Z" });
const smokeGateRegistryRow = audit.rows.find((row) => row.id === "ic21.direct-manual-smoke-gate");
assert(smokeGateRegistryRow, "manual smoke gate registry row should exist");
assert.equal(smokeGateRegistryRow.role, "observability_surface");
assert.equal(smokeGateRegistryRow.implementationState, "partial");
assert.equal(smokeGateRegistryRow.directPathPosture, "keep_readonly");
assert.equal(audit.summary.totalRows, 38);
assert.equal(audit.summary.byImplementationState.partial, 26);
assert.equal(audit.summary.valid, true);

console.log(JSON.stringify({
  ok: true,
  passingGate: passingGate.gateState,
  blockedGate: blockedGate.gateState,
  registryRows: audit.summary.totalRows,
  settingsRows: settingsProjection.rows.manualSmokeGate.length,
}, null, 2));
