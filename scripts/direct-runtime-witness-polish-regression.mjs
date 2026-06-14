#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildRuntimeWitnessProjection,
} = require("../src/main/direct/readiness/usage-readiness");
const {
  assertDirectManualSmokeGateSafe,
  buildDirectManualSmokeGate,
} = require("../src/main/direct/readiness/manual-smoke-gate");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

const projectId = "project_direct_runtime_witness_polish";

const witness = buildRuntimeWitnessProjection({
  projectId,
  generatedAt: "2026-06-14T00:00:00.000Z",
  chips: [
    { kind: "model", label: "Model gpt-5.5 (runtime-probed)", state: "fresh" },
    { kind: "reasoning", label: "Reasoning xhigh (configured)", state: "diagnostic" },
    { kind: "quota", label: "Quota/rate unknown (no direct read authority)", state: "unknown" },
    { kind: "usage", label: "Usage rows 3 · known tokens 144", state: "fresh" },
    { kind: "drift", label: "Drift unknown (no direct drift report)", state: "unknown" },
  ],
});

const settingsProjection = buildDirectSettingsSurfaceProjection({
  projectId,
  runtimeWitnessProjection: witness,
  agentUsageStatus: {
    schema: "direct_agent_usage_summary_projection@1",
    rowCount: 3,
    totals: {
      turnCount: 2,
      totalTokensKnown: 144,
      inputTokensKnown: 100,
      outputTokensKnown: 44,
      missingUsageRowCount: 0,
    },
    evidencePosture: {
      costComputed: false,
      billingGrade: false,
    },
    projectionDigest: "digest_agent_usage_witness_fixture",
  },
  nowMs: 0,
});

assertDirectSettingsSurfaceRendererSafe(settingsProjection);
assert.equal(settingsProjection.sections.runtimeWitness.available, true);
assert.equal(settingsProjection.sections.runtimeWitness.modelState, "fresh");
assert.equal(settingsProjection.sections.runtimeWitness.reasoningState, "diagnostic");
assert.equal(settingsProjection.sections.runtimeWitness.quotaState, "unknown");
assert.equal(settingsProjection.sections.runtimeWitness.driftState, "unknown");
assert.equal(settingsProjection.sections.runtimeWitness.costComputed, false);
assert(settingsProjection.bridgeOrgans.includes("runtime_witness"));
assert(settingsProjection.rows.runtimeWitness.some((row) => row.label === "Quota/rate" && row.value.includes("unknown")));
assert(settingsProjection.rows.runtimeWitness.some((row) => row.label === "Cost" && row.value === "not computed"));
assert(settingsProjection.rows.runtimeWitness.some((row) => row.label === "Authority" && row.value === "display only"));
assert(settingsProjection.evidenceRefs.some((ref) => ref.kind === "runtime_witness" && ref.digest));

const manualSmoke = buildDirectManualSmokeGate({
  projectId,
  settingsProjection: {
    schema: settingsProjection.schema,
    projectId,
    sections: {
      runtime: { currentPath: "direct-implementation", lane: "Direct implementation" },
      workThreadControl: { available: true, selectedWorkThreadId: "work_thread_witness", pointerState: "selected" },
      clarificationTargetPicker: { available: true, pickerState: "ready", blockerCodes: [] },
      contextPreview: { available: true, schema: "direct_context_packet_preview@1", previewState: "ready", blockerCodes: [] },
      memoryWorkbench: { available: true, schema: "direct_memory_review_workbench@1", rawExposureUnsafeCount: 0 },
      moduleContextIntake: { available: true, schema: "direct_module_context_intake@1", rawExposureUnsafeCount: 0 },
      agentUsage: settingsProjection.sections.agentUsage,
      runtimeWitness: settingsProjection.sections.runtimeWitness,
    },
  },
  appServerFallbackAvailable: true,
  implementationLaneUiStatus: {
    meta: { sourceDigest: "digest_implementation_lane_ui" },
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
    recovery: { state: "healthy_terminal" },
  },
  subAgentProjection: {
    schema: "direct_sub_agent_contained_tab_projection@1",
    counts: { total: 1 },
  },
  electronProjectionStatus: { available: true, digest: "digest_electron" },
  nowMs: 0,
});

assertDirectManualSmokeGateSafe(manualSmoke);
const runtimeWitnessRow = manualSmoke.rows.find((row) => row.checkKind === "runtime_witnesses");
assert(runtimeWitnessRow);
assert.equal(runtimeWitnessRow.state, "warning");
assert.equal(runtimeWitnessRow.blockerCodes.length, 0);
assert(runtimeWitnessRow.warningCodes.includes("quota_unknown"));
assert(runtimeWitnessRow.warningCodes.includes("drift_unknown"));
assert(runtimeWitnessRow.evidenceRefs.some((ref) => ref.kind === "runtime_witness"));

const missingWitnessGate = buildDirectManualSmokeGate({
  projectId,
  settingsProjection: {
    schema: "direct_settings_surface_projection@1",
    sections: {
      runtime: { currentPath: "direct-implementation" },
      workThreadControl: { selectedWorkThreadId: "work_thread_witness" },
    },
  },
});
assert(missingWitnessGate.blockerCodes.includes("runtime_witness_projection_not_visible"));

console.log(JSON.stringify({
  ok: true,
  witnessSchema: witness.schema,
  settingsDigest: settingsProjection.projectionDigest,
  manualSmokeGate: manualSmoke.gateState,
  runtimeWitnessRow: runtimeWitnessRow.state,
}, null, 2));
