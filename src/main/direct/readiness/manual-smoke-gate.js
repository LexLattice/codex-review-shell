"use strict";

const crypto = require("node:crypto");

const DIRECT_MANUAL_SMOKE_GATE_SCHEMA = "direct_manual_smoke_gate@1";
const DIRECT_MANUAL_SMOKE_CHECK_ROW_SCHEMA = "direct_manual_smoke_check_row@1";

const CHECK_KINDS = new Set([
  "lane_selection",
  "app_server_fallback",
  "workthread_selection",
  "target_clarification",
  "context_preview",
  "memory_review",
  "module_context_intake",
  "direct_text_turn",
  "readiness_read",
  "readiness_patch",
  "readiness_command",
  "recovery_posture",
  "sub_agent_inspect",
  "usage_readiness",
  "runtime_witnesses",
  "electron_projection",
]);
const CHECK_STATES = new Set(["passed", "blocked", "warning", "not_checked"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 240) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRefs(values, fallbackKind = "manual_smoke_gate") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((ref) => {
      const digest = boundedString(ref.digest || ref.artifactDigest || ref.sourceDigest || ref.refDigest || "", 120);
      const label = boundedString(ref.label || ref.rendererSafeLabel || ref.name || fallbackKind, 160);
      return {
        kind: boundedString(ref.kind || ref.type || fallbackKind, 80),
        digest,
        label,
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
    });
}

function blockerList(values) {
  return arrayOrEmpty(values).map((value) => normalizeString(value, "")).filter(Boolean);
}

function rowState({ available, blockerCodes = [], warningCodes = [], required = true }) {
  if (blockerCodes.length) return "blocked";
  if (available === true) return warningCodes.length ? "warning" : "passed";
  return required ? "blocked" : "not_checked";
}

function checkRow(input = {}) {
  const checkKind = CHECK_KINDS.has(input.checkKind) ? input.checkKind : "electron_projection";
  const blockers = blockerList(input.blockerCodes);
  const warnings = blockerList(input.warningCodes);
  const required = input.required !== false;
  const state = CHECK_STATES.has(input.state)
    ? input.state
    : rowState({ available: input.available === true, blockerCodes: blockers, warningCodes: warnings, required });
  const row = {
    schema: DIRECT_MANUAL_SMOKE_CHECK_ROW_SCHEMA,
    checkId: normalizeString(input.checkId, `manual_smoke_${checkKind}`),
    checkKind,
    label: boundedString(input.label || checkKind, 160),
    state,
    required,
    blockerCodes: state === "blocked" && !blockers.length ? [`${checkKind}_not_available`] : blockers,
    warningCodes: warnings,
    operatorAction: boundedString(input.operatorAction || "", 260),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, checkKind),
    matrixPromotionCandidate: false,
    liveProviderCallAllowed: false,
    electronMutationAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    appServerReplacementAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-manual-smoke-check-row@1", row);
  return row;
}

function section(input = {}) {
  return objectOrEmpty(input);
}

function settingSection(settings, key) {
  return objectOrEmpty(objectOrEmpty(settings.sections)[key]);
}

function buildRows(input = {}) {
  const settings = objectOrEmpty(input.settingsProjection || input.settingsSurface || input.directSettingsSurface);
  const runtime = section(input.runtimeStatus || settingSection(settings, "runtime"));
  const workThreadControl = section(input.workThreadControl || settingSection(settings, "workThreadControl"));
  const clarificationTargetPicker = section(input.clarificationTargetPicker || settingSection(settings, "clarificationTargetPicker"));
  const contextPreview = section(input.contextPreview || settingSection(settings, "contextPreview"));
  const memoryWorkbench = section(input.memoryWorkbench || settingSection(settings, "memoryWorkbench"));
  const runtimeWitness = section(input.runtimeWitness || input.runtimeWitnessProjection || settingSection(settings, "runtimeWitness"));
  const moduleContextIntake = section(input.moduleContextIntake || settingSection(settings, "moduleContextIntake"));
  const usage = section(input.usageReadiness || input.agentUsage || settingSection(settings, "agentUsage"));
  const implementation = section(input.implementationLaneUiStatus?.implementationLane || input.implementationLane || input.runtimeStatus?.directImplementationLane);
  const recovery = section(input.recoveryStatus || input.implementationLaneUiStatus?.recovery || input.recoveryReport);
  const subAgents = section(input.subAgentInspect || input.subAgentProjection || input.subAgentContainedProjection);
  const electron = section(input.electronProjectionStatus || {});
  const appServerParity = section(
    input.appServerFallbackParityReport ||
      input.appServerFallbackParity ||
      input.runtimeStatus?.appServerFallbackParity ||
      settingSection(settings, "appServerFallbackParity"),
  );
  const runtimePath = normalizeString(runtime.currentPath || runtime.runtimePath || input.runtimeStatus?.selection?.runtimePath || input.runtimeStatus?.currentRuntimePath, "");
  const laneAvailable = Boolean(runtimePath || input.runtimeStatus?.currentCodexLane || runtime.lane);
  const appServerAvailable = appServerParity.appServerFallback?.available === true ||
    appServerParity.parityState === "fallback_visible" ||
    appServerParity.parityState === "app_server_selected" ||
    input.appServerFallbackAvailable === true ||
    runtimePath === "app-server" ||
    input.runtimeStatus?.appServerFallbackAvailable === true ||
    input.runtimeStatus?.diagnostics?.legacyAppServerAvailable === true;
  const appServerParityBlockers = blockerList(appServerParity.blockerCodes);
  const selectedWorkThreadId = normalizeString(workThreadControl.selectedWorkThreadId || input.workThreadId, "");
  const contextPreviewAvailable = contextPreview.available === true || contextPreview.schema === "direct_context_packet_preview@1" || contextPreview.previewState === "ready";
  const implementationFacets = objectOrEmpty(implementation.facets);
  const directTextAvailable = input.directTextTurnReady === true ||
    implementation.canStartFirstTurn === true ||
    implementation.canStartFollowupTurn === true ||
    objectOrEmpty(implementationFacets.canStartTurn).canUse === true;
  const readReady = input.readinessReadReady === true || implementation.canApproveReadFile === true || objectOrEmpty(implementationFacets.canApproveRead).canUse === true;
  const patchReady = input.readinessPatchReady === true || implementation.canApprovePatchApply === true || objectOrEmpty(implementationFacets.canApprovePatch).canUse === true;
  const commandReady = input.readinessCommandReady === true || implementation.canApproveRunCommand === true || objectOrEmpty(implementationFacets.canApproveCommand).canUse === true;
  const recoveryAvailable = input.recoveryPostureAvailable === true || Boolean(recovery.state || recovery.status || recovery.schema);
  const subAgentAvailable = input.subAgentInspectAvailable === true ||
    subAgents.schema === "direct_sub_agent_contained_tab_projection@1" ||
    Number(subAgents.counts?.total || subAgents.agentCount || 0) > 0;
  const usageAvailable = usage.available === true || usage.schema === "direct_agent_usage_summary_projection@1" || Number(usage.rowCount || 0) > 0;
  const runtimeWitnessAvailable = runtimeWitness.available === true || runtimeWitness.schema === "direct_runtime_witness_projection@1" || Number(runtimeWitness.chipCount || 0) >= 5;
  const runtimeWitnessWarnings = [
    runtimeWitness.modelState && runtimeWitness.modelState !== "fresh" ? `model_${runtimeWitness.modelState}` : "",
    runtimeWitness.reasoningState && !["fresh", "diagnostic"].includes(runtimeWitness.reasoningState) ? `reasoning_${runtimeWitness.reasoningState}` : "",
    runtimeWitness.quotaState && runtimeWitness.quotaState !== "fresh" ? `quota_${runtimeWitness.quotaState}` : "",
    runtimeWitness.usageState && runtimeWitness.usageState !== "fresh" ? `usage_${runtimeWitness.usageState}` : "",
    runtimeWitness.driftState && runtimeWitness.driftState !== "fresh" ? `drift_${runtimeWitness.driftState}` : "",
  ].filter(Boolean);
  const electronAvailable = electron.available === true || input.electronProjectionAvailable === true;

  return [
    checkRow({
      checkKind: "lane_selection",
      label: "Lane selection visible",
      available: laneAvailable,
      blockerCodes: laneAvailable ? [] : ["runtime_lane_not_visible"],
      evidenceRefs: [{ kind: "runtime_status", digest: runtime.statusDigest || runtime.sourceDigest || "", label: runtimePath || "runtime lane" }],
      operatorAction: "Confirm the visible runtime lane before starting a turn.",
    }),
    checkRow({
      checkKind: "app_server_fallback",
      label: "App-server fallback visible",
      available: appServerAvailable,
      blockerCodes: appServerParityBlockers.length ? appServerParityBlockers : appServerAvailable ? [] : ["app_server_fallback_not_visible"],
      warningCodes: appServerParity.directFailurePosture?.blocked ? ["direct_path_blocked_fallback_still_visible"] : [],
      evidenceRefs: [{ kind: "appserver_fallback_parity", digest: appServerParity.reportDigest || runtime.statusDigest || runtime.sourceDigest || "", label: appServerParity.parityState || "app-server fallback" }],
      operatorAction: "Confirm app-server remains available as fallback.",
    }),
    checkRow({
      checkKind: "workthread_selection",
      label: "WorkThread selection visible",
      available: Boolean(selectedWorkThreadId),
      blockerCodes: selectedWorkThreadId ? [] : ["workthread_current_pointer_missing"],
      evidenceRefs: [{ kind: "work_thread_control_deck", digest: workThreadControl.controlDeckDigest || "", label: selectedWorkThreadId || "no selected WorkThread" }],
      operatorAction: "Select or confirm the active WorkThread before sending.",
    }),
    checkRow({
      checkKind: "target_clarification",
      label: "Target clarification inspectable",
      available: clarificationTargetPicker.available === true || clarificationTargetPicker.pickerState === "ready",
      blockerCodes: clarificationTargetPicker.blockerCodes || [],
      evidenceRefs: [{ kind: "clarification_target_picker", digest: clarificationTargetPicker.targetPickerDigest || "", label: clarificationTargetPicker.pickerState || "target picker" }],
      operatorAction: "Resolve ambiguity before mutating any workspace.",
    }),
    checkRow({
      checkKind: "context_preview",
      label: "Context preview available",
      available: contextPreviewAvailable,
      blockerCodes: contextPreview.blockerCodes || [],
      evidenceRefs: [{ kind: "context_packet_preview", digest: contextPreview.previewDigest || "", label: contextPreview.previewState || "context preview" }],
      operatorAction: "Inspect included, omitted, stale, missing, and raw-exposure context rows.",
    }),
    checkRow({
      checkKind: "memory_review",
      label: "Memory review visible",
      available: memoryWorkbench.available === true || memoryWorkbench.schema === "direct_memory_review_workbench@1",
      blockerCodes: memoryWorkbench.rawExposureUnsafeCount ? ["memory_review_raw_exposure"] : [],
      evidenceRefs: [{ kind: "memory_review_workbench", digest: memoryWorkbench.workbenchDigest || "", label: memoryWorkbench.workbenchState || "memory workbench" }],
      operatorAction: "Inspect memory review, refresh, reset, rollback, and omission impact.",
    }),
    checkRow({
      checkKind: "module_context_intake",
      label: "Module context intake visible",
      available: moduleContextIntake.available === true || moduleContextIntake.schema === "direct_module_context_intake@1",
      blockerCodes: moduleContextIntake.rawExposureUnsafeCount ? ["module_context_raw_exposure"] : [],
      evidenceRefs: [{ kind: "module_context_intake", digest: moduleContextIntake.intakeDigest || "", label: moduleContextIntake.intakeState || "module context intake" }],
      operatorAction: "Inspect accepted module context, imported evidence, and blocked diagnostics.",
    }),
    checkRow({
      checkKind: "direct_text_turn",
      label: "Direct text turn readiness",
      available: directTextAvailable,
      blockerCodes: directTextAvailable ? [] : ["direct_text_turn_not_ready"],
      evidenceRefs: [{ kind: "implementation_lane_ui", digest: input.implementationLaneUiStatus?.meta?.sourceDigest || "", label: "direct text turn" }],
      operatorAction: "Confirm a direct text turn can be started without hidden request assembly.",
    }),
    checkRow({
      checkKind: "readiness_read",
      label: "Read readiness visible",
      available: readReady,
      blockerCodes: readReady ? [] : ["read_readiness_not_visible"],
      evidenceRefs: [{ kind: "implementation_lane_ui", digest: input.implementationLaneUiStatus?.meta?.sourceDigest || "", label: "read readiness" }],
      operatorAction: "Confirm read-file approval/readiness is represented as guarded evidence.",
    }),
    checkRow({
      checkKind: "readiness_patch",
      label: "Patch readiness visible",
      available: patchReady,
      blockerCodes: patchReady ? [] : ["patch_readiness_not_visible"],
      evidenceRefs: [{ kind: "implementation_lane_ui", digest: input.implementationLaneUiStatus?.meta?.sourceDigest || "", label: "patch readiness" }],
      operatorAction: "Confirm patch readiness remains approval-gated.",
    }),
    checkRow({
      checkKind: "readiness_command",
      label: "Command readiness visible",
      available: commandReady,
      blockerCodes: commandReady ? [] : ["command_readiness_not_visible"],
      evidenceRefs: [{ kind: "implementation_lane_ui", digest: input.implementationLaneUiStatus?.meta?.sourceDigest || "", label: "command readiness" }],
      operatorAction: "Confirm command readiness remains approval-gated.",
    }),
    checkRow({
      checkKind: "recovery_posture",
      label: "Recovery posture visible",
      available: recoveryAvailable,
      blockerCodes: recovery.blockerCodes || [],
      evidenceRefs: [{ kind: "direct_recovery_report", digest: recovery.recoveryReportDigest || recovery.reportDigest || "", label: recovery.state || recovery.status || "recovery posture" }],
      operatorAction: "Confirm interrupted or stale work is not shown as clean success.",
    }),
    checkRow({
      checkKind: "sub_agent_inspect",
      label: "Sub-agent inspect visible",
      available: subAgentAvailable,
      blockerCodes: subAgentAvailable ? [] : ["sub_agent_inspect_not_visible"],
      evidenceRefs: [{ kind: "sub_agent_contained_tab", digest: subAgents.projectionDigest || "", label: "sub-agent inspect" }],
      operatorAction: "Confirm sub-agent inspect/wait is read-only and contained.",
    }),
    checkRow({
      checkKind: "usage_readiness",
      label: "Usage readiness visible",
      available: usageAvailable,
      warningCodes: usage.missingUsageRowCount ? ["usage_rows_missing"] : [],
      evidenceRefs: [{ kind: "direct_agent_usage", digest: usage.projectionDigest || usage.ledgerDigest || "", label: "usage readiness" }],
      operatorAction: "Confirm usage rows are evidence, not cost truth.",
    }),
    checkRow({
      checkKind: "runtime_witnesses",
      label: "Runtime witnesses visible",
      available: runtimeWitnessAvailable,
      blockerCodes: runtimeWitnessAvailable ? [] : ["runtime_witness_projection_not_visible"],
      warningCodes: runtimeWitnessWarnings,
      evidenceRefs: [{ kind: "runtime_witness", digest: runtimeWitness.projectionDigest || "", label: "model/reasoning/quota/usage/drift witnesses" }],
      operatorAction: "Confirm model, reasoning, quota/rate, usage, and drift witnesses are visible without granting provider authority.",
    }),
    checkRow({
      checkKind: "electron_projection",
      label: "Electron projection availability",
      available: electronAvailable,
      required: false,
      warningCodes: electronAvailable ? [] : ["electron_runner_not_invoked"],
      evidenceRefs: [{ kind: "electron_projection_status", digest: electron.digest || "", label: electronAvailable ? "electron projection available" : "fixture only" }],
      operatorAction: "Optional: run Electron projection smoke without live provider calls.",
    }),
  ];
}

function summarizeCounts(rows) {
  return {
    rowCount: rows.length,
    passedCount: rows.filter((row) => row.state === "passed").length,
    blockedCount: rows.filter((row) => row.state === "blocked").length,
    warningCount: rows.filter((row) => row.state === "warning").length,
    notCheckedCount: rows.filter((row) => row.state === "not_checked").length,
    requiredBlockedCount: rows.filter((row) => row.required && row.state === "blocked").length,
  };
}

function buildDirectManualSmokeGate(input = {}) {
  const source = objectOrEmpty(input);
  const rows = buildRows(source);
  const counts = summarizeCounts(rows);
  const blockerCodes = [...new Set(rows.flatMap((row) => row.blockerCodes))].sort();
  const projectId = normalizeString(source.projectId, source.settingsProjection?.projectId || "");
  const workThreadId = normalizeString(source.workThreadId, source.workThreadControl?.selectedWorkThreadId || source.settingsProjection?.sections?.workThreadControl?.selectedWorkThreadId || "");
  const sourceDigest = digestFor("direct-manual-smoke-gate-source@1", {
    projectId,
    workThreadId,
    rows: rows.map((row) => row.rowDigest),
  });
  const gateState = counts.requiredBlockedCount > 0
    ? "blocked"
    : counts.warningCount > 0 || counts.notCheckedCount > 0
      ? "degraded"
      : "passed";
  const gate = {
    schema: DIRECT_MANUAL_SMOKE_GATE_SCHEMA,
    gateId: normalizeString(source.gateId, `direct_manual_smoke_gate_${sourceDigest.slice(0, 24)}`),
    projectId,
    workThreadId,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
    gateState,
    coverageSource: source.coverageSource === "electron_projection" ? "electron_projection" : "fixture_projection",
    matrixPromotionCandidate: false,
    appServerFallbackParity: isPlainObject(source.appServerFallbackParityReport || source.appServerFallbackParity || source.runtimeStatus?.appServerFallbackParity)
      ? source.appServerFallbackParityReport || source.appServerFallbackParity || source.runtimeStatus.appServerFallbackParity
      : null,
    rows,
    counts,
    blockerCodes,
    electronRunner: {
      available: source.electronProjectionAvailable === true || source.electronProjectionStatus?.available === true,
      liveProviderCallsAllowed: false,
      appServerSpawnAllowed: false,
      workspaceMutationAllowed: false,
      rightPaneMutationAllowed: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    authority: {
      displayOnly: true,
      rendererSafe: true,
      manualSmokeExecutionAllowed: false,
      runtimePathMutationAllowed: false,
      workThreadMutationAllowed: false,
      providerTransportAllowed: false,
      workspaceMutationAllowed: false,
      appServerReplacementAllowed: false,
      autoApprovalAllowed: false,
      moduleExecutionAllowed: false,
      recursiveWorkerAllowed: false,
      matrixPromotionAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rendererSafeSummary: {
      state: gateState,
      requiredBlockedCount: counts.requiredBlockedCount,
      warningCount: counts.warningCount,
      blockerCodes,
    },
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  gate.gateDigest = digestFor("direct-manual-smoke-gate@1", gate);
  return gate;
}

function assertDirectManualSmokeGateSafe(gate = {}) {
  if (!isPlainObject(gate) || gate.schema !== DIRECT_MANUAL_SMOKE_GATE_SCHEMA) {
    throw new Error("direct_manual_smoke_gate_schema_mismatch");
  }
  const authority = objectOrEmpty(gate.authority);
  const forbiddenTrueFlags = [
    "manualSmokeExecutionAllowed",
    "runtimePathMutationAllowed",
    "workThreadMutationAllowed",
    "providerTransportAllowed",
    "workspaceMutationAllowed",
    "appServerReplacementAllowed",
    "autoApprovalAllowed",
    "moduleExecutionAllowed",
    "recursiveWorkerAllowed",
    "matrixPromotionAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_manual_smoke_gate_not_display_only");
  }
  for (const flag of forbiddenTrueFlags) {
    if (authority[flag] !== false) throw new Error(`direct_manual_smoke_gate_authority_leak:${flag}`);
  }
  if (gate.matrixPromotionCandidate !== false || gate.rawTextIncluded !== false || gate.rawPathIncluded !== false || gate.rawSecretIncluded !== false) {
    throw new Error("direct_manual_smoke_gate_raw_or_promotion_leak");
  }
  for (const [key, value] of Object.entries(gate.sentinelCounters || {})) {
    if (Number(value || 0) !== 0) throw new Error(`direct_manual_smoke_gate_sentinel_nonzero:${key}`);
  }
  for (const row of arrayOrEmpty(gate.rows)) {
    if (row.schema !== DIRECT_MANUAL_SMOKE_CHECK_ROW_SCHEMA) throw new Error("direct_manual_smoke_check_row_schema_mismatch");
    if (row.matrixPromotionCandidate !== false || row.liveProviderCallAllowed !== false || row.electronMutationAllowed !== false || row.providerTransportAllowed !== false || row.workspaceMutationAllowed !== false || row.appServerReplacementAllowed !== false) {
      throw new Error(`direct_manual_smoke_check_row_authority_leak:${row.checkId || ""}`);
    }
    if (row.rawTextIncluded !== false || row.rawPathIncluded !== false || row.rawSecretIncluded !== false) {
      throw new Error(`direct_manual_smoke_check_row_raw_exposure:${row.checkId || ""}`);
    }
    if (row.required && row.state === "blocked" && !row.blockerCodes.length) {
      throw new Error(`direct_manual_smoke_check_row_silent_blocker:${row.checkId || ""}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_MANUAL_SMOKE_CHECK_ROW_SCHEMA,
  DIRECT_MANUAL_SMOKE_GATE_SCHEMA,
  assertDirectManualSmokeGateSafe,
  buildDirectManualSmokeGate,
  stableStringify,
};
