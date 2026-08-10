#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildDirectManualSmokeGate,
} = require("../src/main/direct/readiness/manual-smoke-gate");
const {
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

assert(html.includes('id="directBridgeSettingsManualSmokeList"'), "manual smoke list must be present in the project tab markup");
assert(html.includes("Manual smoke gate"), "manual smoke panel heading must be visible");
assert(app.includes("directBridgeSettingsManualSmokeList: document.getElementById(\"directBridgeSettingsManualSmokeList\")"), "manual smoke list must be bound in renderer elements");
assert(app.includes('directBridgeSettingsRows("manualSmokeGate")'), "renderer must render manualSmokeGate rows");
assert(app.includes("function directBridgeManualSmokeSummary"), "renderer must summarize manual smoke status");
assert(app.includes("Manual smoke gate is not exposed by the current projection."), "renderer must fail visible when smoke gate is absent");
assert(app.includes('manualSmoke.blockerCodes.length > 5 ? "…" : ""'), "renderer must mark truncated blocker-code lists");
assert(app.includes("Display-only: no provider, app-server, module, workspace, approval, recursive worker, or promotion transition is exposed."), "renderer copy must preserve display-only authority boundary");

const passingGate = buildDirectManualSmokeGate({
  projectId: "project_manual_surface",
  workThreadId: "work_thread_manual_surface",
  appServerFallbackAvailable: true,
  settingsProjection: {
    schema: "direct_settings_surface_projection@1",
    projectId: "project_manual_surface",
    sections: {
      runtime: { currentPath: "direct-implementation", lane: "Direct implementation" },
      workThreadControl: {
        available: true,
        selectedWorkThreadId: "work_thread_manual_surface",
        controlDeckDigest: "digest_workthread",
      },
      clarificationTargetPicker: {
        available: true,
        pickerState: "ready",
      },
      contextPreview: {
        available: true,
        schema: "direct_context_packet_preview@1",
        previewState: "ready",
      },
      memoryWorkbench: {
        available: true,
        schema: "direct_memory_review_workbench@1",
      },
      moduleContextIntake: {
        available: true,
        schema: "direct_module_context_intake@1",
      },
      agentUsage: {
        available: true,
        schema: "direct_agent_usage_summary_projection@1",
        rowCount: 1,
      },
    },
  },
  implementationLaneUiStatus: {
    implementationLane: {
      canStartFirstTurn: true,
      canApproveReadFile: true,
      canApprovePatchApply: true,
      canApproveRunCommand: true,
    },
    recovery: {
      state: "healthy_terminal",
    },
  },
  subAgentProjection: {
    schema: "direct_sub_agent_contained_tab_projection@1",
    counts: { total: 1 },
  },
  electronProjectionStatus: {
    available: true,
  },
  nowMs: 0,
});

const projection = buildDirectSettingsSurfaceProjection({
  projectId: "project_manual_surface",
  manualSmokeGate: passingGate,
  nowMs: 0,
});

assert.equal(projection.sections.manualSmokeGate.available, true, "manual smoke gate must be summarized as available");
assert.equal(projection.sections.manualSmokeGate.gateState, "passed", "manual smoke gate state should be visible");
assert(projection.rows.manualSmokeGate.some((row) => row.label === "Gate" && row.value === "passed"), "manual smoke rows must include gate state");
assert(projection.rows.manualSmokeGate.some((row) => row.label === "Authority" && row.value === "display only"), "manual smoke rows must include display-only authority");
assert(projection.evidenceRefs.some((ref) => ref.kind === "manual_smoke_gate" && ref.digest), "settings projection must cite manual smoke evidence");

console.log(JSON.stringify({
  ok: true,
  manualSmokeRows: projection.rows.manualSmokeGate.length,
  gateState: projection.sections.manualSmokeGate.gateState,
}, null, 2));
