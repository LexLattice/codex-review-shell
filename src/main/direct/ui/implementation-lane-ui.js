"use strict";

const crypto = require("node:crypto");

const DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA = "direct_implementation_lane_ui_status@1";
const DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA = "direct_operation_history_projection@1";
const DIRECT_POLICY_READONLY_VIEW_SCHEMA = "direct_policy_readonly_view@1";
const DIRECT_UI_PARITY_REPORT_SCHEMA = "direct_ui_parity_report@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(value) {
  return value === true;
}

function stableValue(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => stableValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key], seen);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestValue(value) {
  return `sha256:${sha256(stableJson(value))}`;
}

function nowIso(input) {
  return normalizeString(input, "") || new Date().toISOString();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function projectionGeneration(seed) {
  return Number.parseInt(sha256(stableJson(seed)).slice(0, 10), 16);
}

function projectionMeta(input = {}) {
  const generatedAt = nowIso(input.generatedAt);
  const source = {
    projectId: normalizeString(input.projectId, ""),
    schemaVersion: normalizeString(input.schemaVersion, "direct_ui_projection@1"),
    sourceDigest: normalizeString(input.sourceDigest, ""),
    operationLedgerHeadDigest: normalizeString(input.operationLedgerHeadDigest, ""),
    runtimeStatusDigest: normalizeString(input.runtimeStatusDigest, ""),
    recoveryReportDigest: normalizeString(input.recoveryReportDigest, ""),
    workspaceEffectDigest: normalizeString(input.workspaceEffectDigest, ""),
    generatedAt,
  };
  return {
    projectId: source.projectId,
    generatedAt,
    uiProjectionGeneration: projectionGeneration(source),
    sourceDigest: source.sourceDigest,
    operationLedgerHeadDigest: source.operationLedgerHeadDigest,
    runtimeStatusDigest: source.runtimeStatusDigest,
    recoveryReportDigest: source.recoveryReportDigest,
    workspaceEffectDigest: source.workspaceEffectDigest,
    schemaVersion: source.schemaVersion,
  };
}

function blockerCodes(values) {
  return safeArray(values).map((value) => normalizeString(value, "")).filter(Boolean);
}

function facet(input = {}) {
  const blockers = blockerCodes(input.blockerCodes);
  const warnings = blockerCodes(input.warningCodes);
  const canUse = bool(input.canUse) && blockers.length === 0;
  const state = normalizeString(input.state, canUse ? "ready" : blockers.length ? "blocked" : "unknown");
  return {
    state,
    canUse,
    blockerCodes: blockers,
    warningCodes: warnings,
    evidenceKeys: blockerCodes(input.evidenceKeys),
  };
}

function tierStatus(input = {}) {
  const blockers = blockerCodes(input.blockerCodes);
  const selected = bool(input.selected);
  const available = input.available !== false;
  const readiness = normalizeString(input.readiness, blockers.length ? "blocked" : selected || bool(input.canStartTurn) ? "ready" : "unknown");
  return {
    tier: normalizeString(input.tier, "unknown"),
    available,
    selected,
    selectable: bool(input.selectable),
    canStartTurn: bool(input.canStartTurn),
    canRollbackToAppServer: bool(input.canRollbackToAppServer),
    readiness,
    blockerCodes: blockers,
    warningCodes: blockerCodes(input.warningCodes),
    evidenceSummary: {
      evidenceKeys: blockerCodes(input.evidenceKeys),
      freshness: normalizeString(input.freshness, "unknown"),
      diagnosticOnly: bool(input.diagnosticOnly),
    },
  };
}

function implementationReadiness(runtimeStatus = {}) {
  const lane = isPlainObject(runtimeStatus.directImplementationLane) ? runtimeStatus.directImplementationLane : {};
  const blockers = blockerCodes(lane.blockers || lane.missingImplementationOnlyGates);
  const selected = bool(lane.selected);
  const canStart = bool(lane.canStartFirstTurn || lane.canStartTextTurn || lane.canStartFollowupTurn);
  const canApproveRead = bool(lane.canApproveReadFile);
  const canApprovePatch = bool(lane.canApprovePatchApply || lane.canApprovePatch || lane.patchApply?.canApprove);
  const canApproveCommand = bool(lane.canApproveRunCommand || lane.canApproveCommand || lane.commandExecution?.canApprove);
  const canContinue = bool(lane.canSendContinuation || canApproveRead || canApprovePatch || canApproveCommand);
  const degradedToReadOnly = bool(lane.degradedToReadOnly || (lane.status === "degraded" && canApproveRead && !canApprovePatch && !canApproveCommand));
  const activeRecoveryState = normalizeString(lane.activeRecoveryState, "");
  const activeRepairLoopState = normalizeString(lane.activeRepairLoopState, "");
  const base = tierStatus({
    tier: "direct-implementation-lane",
    available: true,
    selected,
    selectable: bool(lane.canSelect || lane.canEnable),
    canStartTurn: canStart,
    canRollbackToAppServer: !activeRecoveryState && !activeRepairLoopState,
    readiness: selected ? (lane.status === "degraded" ? "degraded" : "ready") : blockers.length ? "blocked" : "unknown",
    blockerCodes: blockers,
    evidenceKeys: ["direct_implementation_lane_status"],
    freshness: "fresh",
  });
  return {
    ...base,
    canStartFirstTurn: canStart,
    canStartFollowupTurn: bool(lane.canStartFollowupTurn || canStart),
    canApproveReadFile: canApproveRead,
    canApprovePatchApply: canApprovePatch,
    canApproveRunCommand: canApproveCommand,
    canSendContinuation: canContinue,
    canRunRepairLoop: canApproveRead && (canApprovePatch || canApproveCommand) && canContinue,
    canShowApprovalCards: bool(lane.canShowApprovalCards || lane.canShowObligations || selected),
    canShowOperationHistory: true,
    canShowPolicySnapshot: true,
    degradedToReadOnly,
    activeRecoveryState,
    activeRepairLoopState,
    activeWorkspaceEffectState: normalizeString(lane.activeWorkspaceEffectState, ""),
    facets: {
      canStartTurn: facet({ canUse: canStart, blockerCodes: canStart ? [] : blockers, evidenceKeys: ["direct_text_turn_empty_context@1"] }),
      canShowApprovalCards: facet({ canUse: bool(lane.canShowApprovalCards || lane.canShowObligations || selected), blockerCodes: selected || bool(lane.canShowObligations) ? [] : blockers, evidenceKeys: ["direct_obligations@1"] }),
      canApproveRead: facet({ canUse: canApproveRead, blockerCodes: canApproveRead ? [] : blockers, evidenceKeys: ["direct_readonly_tool_continuation@1"] }),
      canApprovePatch: facet({ canUse: canApprovePatch, blockerCodes: canApprovePatch ? [] : blockers.concat(["patch_apply_continuation_evidence_missing"]), evidenceKeys: ["direct_patch_apply_continuation@1"] }),
      canApproveCommand: facet({ canUse: canApproveCommand, blockerCodes: canApproveCommand ? [] : blockers.concat(["command_execution_continuation_evidence_missing"]), evidenceKeys: ["direct_command_execution_continuation@1"] }),
      canContinueAfterResult: facet({ canUse: canContinue, blockerCodes: canContinue ? [] : blockers, evidenceKeys: ["direct_request_manifest@1"] }),
      canRecoverSafely: facet({ canUse: true, evidenceKeys: ["direct_recovery_report@1"] }),
      workspaceMutationTruth: facet({ canUse: true, evidenceKeys: ["direct_workspace_effect_summary@1"] }),
      policyUsable: facet({ canUse: true, evidenceKeys: ["direct_policy_snapshot@1"] }),
    },
  };
}

function activeRuntimeTier(runtimeStatus = {}) {
  if (runtimeStatus.directImplementationLane?.selected) return "direct-implementation-lane";
  if (runtimeStatus.directTextOnly?.selected) return "direct-text-only";
  const mode = normalizeString(runtimeStatus.activation?.runtimeMode || runtimeStatus.runtimeMode, "");
  if (mode.includes("direct")) return "unknown";
  return "app-server";
}

function chip(input = {}) {
  return {
    chipId: normalizeString(input.chipId, "chip"),
    kind: normalizeString(input.kind, "runtime-tier"),
    label: normalizeString(input.label, "unknown"),
    state: normalizeString(input.state, "unknown"),
    summary: normalizeString(input.summary, ""),
    evidenceKey: normalizeString(input.evidenceKey, ""),
    detailRef: normalizeString(input.detailRef, ""),
    expiresAt: normalizeString(input.expiresAt, ""),
    freshness: normalizeString(input.freshness, "unknown"),
    handoff: input.kind === "handoff-boundary"
      ? {
          rawChatGptUrlIncluded: false,
          handoffStateUsedForReadiness: false,
        }
      : undefined,
    rawValueIncluded: false,
  };
}

function witnessChips(runtimeStatus = {}) {
  const direct = runtimeStatus.direct || {};
  const auth = direct.auth || {};
  const lane = runtimeStatus.directImplementationLane || {};
  const text = runtimeStatus.directTextOnly || {};
  const active = activeRuntimeTier(runtimeStatus);
  const contextMaintenance = contextMaintenanceStatus(runtimeStatus);
  return [
    chip({
      chipId: "runtime-tier",
      kind: "runtime-tier",
      label: active === "direct-implementation-lane" ? "Direct implementation" : active === "direct-text-only" ? "Direct text" : "App Server",
      state: lane.selected || text.selected ? "ok" : "unknown",
      summary: "Selection is project binding, not turn authority.",
      evidenceKey: "direct_runtime_status",
      freshness: "fresh",
    }),
    chip({
      chipId: "model-evidence",
      kind: "model",
      label: direct.model || runtimeStatus.models?.entries?.[0]?.id || "model unknown",
      state: direct.liveProbeEvidence?.usable ? "ok" : direct.status === "ready" ? "warning" : "unknown",
      summary: direct.modelEvidenceState || direct.reason || "model evidence scoped by runtime status",
      evidenceKey: direct.evidenceId || "model_evidence",
      freshness: direct.liveProbeEvidence?.usable ? "fresh" : "unknown",
    }),
    chip({
      chipId: "auth-source",
      kind: "auth-source",
      label: auth.source || "codex-cli-auth",
      state: auth.status === "authenticated" ? "ok" : "blocked",
      summary: auth.status || "auth status unknown",
      evidenceKey: "direct_auth_status",
      freshness: auth.status === "authenticated" ? "fresh" : "unknown",
    }),
    chip({
      chipId: "workspace",
      kind: "workspace",
      label: runtimeStatus.directThreadStore?.available ? "Workspace evidence" : "Workspace unknown",
      state: runtimeStatus.directThreadStore?.available ? "ok" : "unknown",
      summary: "Renderer receives evidence keys only; local paths stay private.",
      evidenceKey: "workspace_binding",
      freshness: "fresh",
    }),
    chip({
      chipId: "policy",
      kind: "policy",
      label: "Policy snapshot",
      state: "ok",
      summary: "Read-only defaults for read, patch, command, caps, and network risk.",
      evidenceKey: "direct_policy_snapshot@1",
      freshness: "fresh",
    }),
    chip({
      chipId: "network",
      kind: "network",
      label: "Network sandbox unproved",
      state: "warning",
      summary: "Known helper commands are blocked; project code is not proven network-sandboxed.",
      evidenceKey: "direct_command_policy@1",
      freshness: "fresh",
    }),
    chip({
      chipId: "context-maintenance",
      kind: "context-maintenance",
      label: "Context maintenance",
      state: contextMaintenance.blockers.length ? "blocked" : contextMaintenance.pressureState === "unknown" ? "unknown" : "diagnostic",
      summary: "Status only; compact and memory actions stay disabled.",
      evidenceKey: contextMaintenance.evidenceKeys[0] || "direct_context_maintenance_status_projection@1",
      freshness: contextMaintenance.pressureState === "unknown" ? "unknown" : "fresh",
    }),
    chip({
      chipId: "handoff-boundary",
      kind: "handoff-boundary",
      label: "Handoff separate",
      state: "diagnostic",
      summary: "Handoff and right-pane ChatGPT state are not Direct readiness evidence.",
      evidenceKey: "handoff_boundary",
      freshness: "fresh",
    }),
  ];
}

function contextMaintenanceInput(runtimeStatus = {}) {
  if (isPlainObject(runtimeStatus.directContextMaintenance)) return runtimeStatus.directContextMaintenance;
  if (isPlainObject(runtimeStatus.contextMaintenance)) return runtimeStatus.contextMaintenance;
  if (isPlainObject(runtimeStatus.directThreadStore?.contextMaintenance)) return runtimeStatus.directThreadStore.contextMaintenance;
  return {};
}

function contextMaintenanceStatus(runtimeStatus = {}) {
  const input = contextMaintenanceInput(runtimeStatus);
  const statusProjection = isPlainObject(input.statusProjection) ? input.statusProjection : {};
  const sibling = isPlainObject(input.appServerSibling)
    ? input.appServerSibling
    : isPlainObject(input.vanillaSiblingContextEvidence)
      ? input.vanillaSiblingContextEvidence
      : isPlainObject(input.vanillaSibling)
        ? input.vanillaSibling
        : {};
  const providerCompact = isPlainObject(input.providerCompact) ? input.providerCompact : {};
  const memoryControls = safeArray(sibling.memoryControls);
  const compactControls = safeArray(sibling.compactControls);
  const blockers = blockerCodes(input.blockers || input.blockerCodes || statusProjection.blockers);
  const warnings = blockerCodes(input.warnings || input.warningCodes || statusProjection.warnings);
  const evidenceKeys = blockerCodes(input.evidenceKeys || statusProjection.evidenceKeys || [
    statusProjection.projectionDigest ? "direct_context_maintenance_status_projection@1" : "",
    sibling.evidenceId ? "vanilla_sibling_context_evidence@1" : "",
  ]);
  const contextCompactionCount = Number(input.contextCompactionCount ?? sibling.contextCompactionCount ?? safeArray(sibling.contextCompaction).length);
  const memoryCitationCount = Number(input.memoryCitationCount ?? sibling.memoryCitationCount ?? safeArray(sibling.memoryCitations).length);
  const memoryModeObserved = input.memoryModeObserved === true ||
    sibling.memoryModeObserved === true ||
    memoryControls.some((control) => normalizeString(control.method, "") === "thread/memoryMode/set");
  const memoryResetObserved = input.memoryResetObserved === true ||
    sibling.memoryResetObserved === true ||
    memoryControls.some((control) => normalizeString(control.method, "") === "memory/reset");
  const compactControlObserved = input.compactControlObserved === true ||
    sibling.compactControlObserved === true ||
    compactControls.length > 0;
  return {
    schema: "direct_context_maintenance_status_summary@1",
    source: "runtime-status-resolver",
    statusDigest: digestValue({ input, statusProjection, sibling }),
    displayOnly: true,
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "context_maintenance_status_only",
    },
    pressureState: normalizeString(input.pressureState || statusProjection.pressureState, "unknown"),
    route: {
      routeKind: normalizeString(input.routeKind || input.currentRouteKind || statusProjection.routeKind, "none"),
      routeClass: normalizeString(input.routeClass || statusProjection.routeClass, "no_change"),
      reasonCode: normalizeString(input.routeReasonCode || input.reasonCode || statusProjection.routeReasonCode, ""),
      blocked: input.routeBlocked === true || blockers.length > 0,
    },
    memory: {
      state: normalizeString(input.memoryState || statusProjection.memoryState, "none"),
      pointerState: normalizeString(input.memoryPointerState || statusProjection.memoryPointerState, "none"),
      citationCount: Number.isFinite(memoryCitationCount) ? memoryCitationCount : 0,
    },
    baton: {
      state: normalizeString(input.batonState || statusProjection.batonState, "not_required"),
      requirement: normalizeString(input.batonRequirement || statusProjection.batonRequirement, "not_required"),
    },
    omission: {
      state: normalizeString(input.omissionState || statusProjection.omissionState, "none"),
    },
    providerCompact: {
      state: normalizeString(providerCompact.state || input.providerCompactState || input.providerCompactionState, "not_proven"),
      evidenceState: normalizeString(providerCompact.evidenceState || input.providerCompactionEvidenceState, "missing"),
      promotionCandidate: false,
      providerTransportAllowed: false,
      requestAllowed: false,
    },
    appServerSibling: {
      sourceClass: normalizeString(sibling.sourceClass, "vanilla_app_server_sibling"),
      displayOnly: true,
      contextCompactionObserved: contextCompactionCount > 0 || input.contextCompactionObserved === true,
      contextCompactionCount: Number.isFinite(contextCompactionCount) ? contextCompactionCount : 0,
      memoryCitationCount: Number.isFinite(memoryCitationCount) ? memoryCitationCount : 0,
      memoryModeObserved,
      memoryResetObserved,
      compactControlObserved,
      directArtifactPromotionAllowed: false,
      directContextPackUsable: false,
    },
    blockers,
    warnings,
    evidenceKeys,
    rawTextIncluded: false,
    rawPayloadIncluded: false,
    providerTransportAllowed: false,
    maintenanceExecutionAllowed: false,
    memoryEditorAllowed: false,
    memoryResetAllowed: false,
    compactActionAllowed: false,
  };
}

function latestToolResultStatus(runtimeStatus = {}) {
  const result = isPlainObject(runtimeStatus.sessionStore?.latestToolResult)
    ? runtimeStatus.sessionStore.latestToolResult
    : {};
  const changedPathCount = numberValue(result.changedPathCount);
  const workspaceEffectSummaryId = normalizeString(result.workspaceEffectSummaryId, "");
  const providerVisibility = normalizeString(result.providerVisibility, changedPathCount > 0 ? "summary_only" : "none");
  return {
    schema: "direct_tool_result_status_projection@1",
    tool: normalizeString(result.tool, ""),
    status: normalizeString(result.status, "none"),
    resultClass: normalizeString(result.resultClass, ""),
    sideEffectExecuted: bool(result.sideEffectExecuted),
    workspaceEffectSummaryId,
    workspaceEffectScanRan: bool(result.workspaceEffectScanRan),
    workspaceEffectScanSupported: bool(result.workspaceEffectScanSupported),
    workspaceChangesDetected: bool(result.workspaceChangesDetected) || changedPathCount > 0,
    changedPathCount,
    providerVisibility,
    providerSawChangedFileContents: bool(result.providerSawChangedFileContents),
    providerSawAllChangedFileContents: bool(result.providerSawAllChangedFileContents),
    visibleMessageCode: changedPathCount > 0
      ? providerVisibility === "summary_only"
        ? "workspace_changed_provider_saw_summary_only"
        : providerVisibility === "partial_content"
          ? "workspace_changed_provider_saw_partial_content"
          : providerVisibility === "unknown"
            ? "workspace_changed_provider_visibility_unknown"
            : "workspace_changed_provider_visibility_recorded"
      : workspaceEffectSummaryId
        ? "workspace_effect_scan_recorded_no_changes"
        : "tool_result_recorded_no_workspace_effect",
    postSideEffectPolicyViolation: normalizeString(result.postSideEffectPolicyViolation, ""),
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "tool_result_status_is_read_only",
    },
    rawProviderPayloadIncluded: false,
    rawWorkspacePathIncluded: false,
    rawToolOutputIncluded: false,
  };
}

function buildDirectImplementationLaneUiStatus({ project = {}, runtimeStatus = {}, generatedAt = "" } = {}) {
  const projectId = normalizeString(project.id || runtimeStatus.projectId, "");
  const runtimeStatusDigest = digestValue(runtimeStatus);
  const operationLedgerHeadDigest = digestValue({
    operationCount: runtimeStatus.directThreadStore?.operationCount || 0,
    activeTurnCount: runtimeStatus.sessionStore?.activeTurnCount || 0,
    unresolvedObligationCount: runtimeStatus.sessionStore?.unresolvedObligationCount || 0,
  });
  const implementationLane = implementationReadiness(runtimeStatus);
  const activeTier = activeRuntimeTier(runtimeStatus);
  const sourceDigest = digestValue({ projectId, runtimeStatusDigest, operationLedgerHeadDigest, activeTier });
  const meta = projectionMeta({
    projectId,
    generatedAt,
    sourceDigest,
    operationLedgerHeadDigest,
    runtimeStatusDigest,
    schemaVersion: DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA,
  });
  const textOnly = runtimeStatus.directTextOnly || {};
  const appServerSelected = activeTier === "app-server";
  const contextMaintenance = contextMaintenanceStatus(runtimeStatus);
  const latestToolResult = latestToolResultStatus(runtimeStatus);
  const status = {
    schema: DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA,
    meta,
    projectId,
    generatedAt: meta.generatedAt,
    source: "runtime-status-resolver",
    activeRuntimeTier: activeTier,
    appServer: tierStatus({
      tier: "app-server",
      available: runtimeStatus.diagnostics?.legacyAppServerAvailable !== false,
      selected: appServerSelected,
      selectable: true,
      canStartTurn: appServerSelected,
      canRollbackToAppServer: true,
      readiness: appServerSelected ? "ready" : "unknown",
      evidenceKeys: ["app_server_baseline"],
      freshness: "fresh",
    }),
    textOnly: tierStatus({
      tier: "direct-text-only",
      available: true,
      selected: bool(textOnly.selected),
      selectable: bool(textOnly.canSelect || textOnly.canEnable),
      canStartTurn: bool(textOnly.canStartFirstTurn || textOnly.canStartTextTurn),
      canRollbackToAppServer: true,
      readiness: textOnly.selected ? "ready" : blockerCodes(textOnly.blockers).length ? "blocked" : "unknown",
      blockerCodes: textOnly.blockers,
      evidenceKeys: ["direct_text_turn_empty_context@1"],
      freshness: "fresh",
    }),
    implementationLane,
    currentSession: {
      sessionStoreAvailable: bool(runtimeStatus.sessionStore?.available),
      activeTurnCount: numberValue(runtimeStatus.sessionStore?.activeTurnCount),
      unresolvedObligationCount: numberValue(runtimeStatus.sessionStore?.unresolvedObligationCount),
    },
    activeTurn: {
      state: normalizeString(runtimeStatus.sessionStore?.lastTurnState, ""),
      composerAllowed: numberValue(runtimeStatus.sessionStore?.activeTurnCount) === 0,
      composerAllowedReason: numberValue(runtimeStatus.sessionStore?.activeTurnCount) === 0 ? "safe_terminal" : "disabled_side_effect_incomplete",
    },
    recovery: {
      state: normalizeString(runtimeStatus.directThreadStore?.recovery?.state || runtimeStatus.sessionStore?.recovery?.state, "healthy"),
      confidence: normalizeString(runtimeStatus.directThreadStore?.recovery?.confidence || runtimeStatus.sessionStore?.recovery?.confidence, "unknown"),
    },
    policy: {
      editable: false,
      effectiveSource: "default",
      policySnapshotDigest: digestValue({ implementationLane: "default-policy", projectId }),
    },
    contextMaintenance,
    latestToolResult,
    witnesses: witnessChips(runtimeStatus),
    blockers: implementationLane.blockerCodes.map((code) => ({ code, source: "runtime-status", rendererSafe: true })),
    warnings: [],
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
  assertRendererSafeProjection(status);
  return status;
}

function operationFamily(operationType) {
  const text = normalizeString(operationType, "operation").toLowerCase();
  if (text.includes("runtime")) return "runtime-tier";
  if (text.includes("turn")) return "turn";
  if (text.includes("obligation")) return "obligation";
  if (text.includes("read")) return "read";
  if (text.includes("patch")) return "patch";
  if (text.includes("command")) return "command";
  if (text.includes("repair")) return "repair-loop";
  if (text.includes("workspace") || text.includes("effect")) return "workspace-effect";
  if (text.includes("recover")) return "recovery";
  if (text.includes("handoff")) return "handoff-boundary";
  return "turn";
}

function projectOperationHistoryPage({ projectId = "", operationHistory = {}, request = {}, generatedAt = "" } = {}) {
  const history = isPlainObject(operationHistory.history) ? operationHistory.history : operationHistory;
  const entries = safeArray(history.entries);
  const sourceLedgerHeadDigest = digestValue({
    projectId,
    page: history.page || {},
    operationIds: entries.map((entry) => entry.operationId),
  });
  const rows = entries.map((entry) => ({
    rowId: normalizeString(entry.operationId, `operation_${sha256(stableJson(entry)).slice(0, 12)}`),
    family: operationFamily(entry.operationType),
    eventKind: normalizeString(entry.operationType, "operation"),
    status: normalizeString(entry.status, "unknown"),
    requestedAt: normalizeString(entry.requestedAt, ""),
    rendererSafeSummary: normalizeString(entry.rendererSafeSummary || entry.blockerCode || entry.operationType, "operation"),
    artifactRefs: safeArray(entry.effects).slice(0, 12).map((effect, index) => ({
      refId: normalizeString(effect.targetId, `effect_${index}`),
      kind: normalizeString(effect.targetKind, "effect"),
      label: normalizeString(effect.rendererSafeSummary, effect.effectKind || "effect"),
    })),
    evidenceKeys: safeArray(entry.effects).map((effect) => normalizeString(effect.targetId, "")).filter(Boolean),
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "history_is_read_only",
    },
  }));
  const page = isPlainObject(history.page) ? history.page : {};
  const limit = Math.max(1, Math.min(100, numberValue(request.limit, numberValue(page.limit, 40))));
  const offset = numberValue(page.offset, numberValue(request.offset, 0));
  const total = numberValue(page.total, rows.length);
  const hasMore = offset + rows.length < total;
  const pageDigest = digestValue({ rows, offset, limit, total, sourceLedgerHeadDigest });
  const meta = projectionMeta({
    projectId,
    generatedAt,
    sourceDigest: pageDigest,
    operationLedgerHeadDigest: sourceLedgerHeadDigest,
    runtimeStatusDigest: normalizeString(request.runtimeStatusDigest, ""),
    schemaVersion: DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA,
  });
  const projection = {
    schema: DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA,
    meta,
    scope: normalizeString(request.scope, "active-turn"),
    rows,
    nextCursor: hasMore ? String(offset + limit) : "",
    hasMore,
    sourceLedgerHeadDigest,
    pageDigest,
    page: {
      offset,
      limit,
      returned: rows.length,
      total,
    },
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
  assertRendererSafeProjection(projection);
  return projection;
}

function buildDirectPolicyReadOnlyView({ project = {}, runtimeStatus = {}, generatedAt = "" } = {}) {
  const projectId = normalizeString(project.id || runtimeStatus.projectId, "");
  const policySnapshot = {
    commandClasses: "package scripts only unless evidence enables more",
    sensitivePathPolicy: "secret-like, app-private, and VCS paths blocked",
    generatedVendorLockPolicy: "generated/vendor/lockfile paths blocked or degraded by policy",
    caps: "bounded read, patch, command, output, and workspace-effect caps",
    networkRisk: "network helper commands blocked; sandbox unproved",
  };
  const policySnapshotDigest = digestValue({ projectId, policySnapshot });
  const meta = projectionMeta({
    projectId,
    generatedAt,
    sourceDigest: policySnapshotDigest,
    operationLedgerHeadDigest: digestValue({ operationCount: runtimeStatus.directThreadStore?.operationCount || 0 }),
    runtimeStatusDigest: digestValue(runtimeStatus),
    schemaVersion: DIRECT_POLICY_READONLY_VIEW_SCHEMA,
  });
  const section = (label, summary) => ({
    label,
    summary,
    editable: false,
    privateConfigIncluded: false,
  });
  const view = {
    schema: DIRECT_POLICY_READONLY_VIEW_SCHEMA,
    meta,
    editable: false,
    source: "policy-snapshot",
    effectiveSource: "default",
    policySnapshotDigest,
    commandClasses: section("Command classes", policySnapshot.commandClasses),
    sensitivePathPolicy: section("Sensitive paths", policySnapshot.sensitivePathPolicy),
    generatedVendorLockPolicy: section("Generated/vendor/lockfile", policySnapshot.generatedVendorLockPolicy),
    caps: section("Caps", policySnapshot.caps),
    networkRisk: section("Network risk", policySnapshot.networkRisk),
    privateConfigIncluded: false,
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
  assertRendererSafeProjection(view);
  return view;
}

function collectStrings(value, output = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of value) collectStrings(item, output, seen);
    return output;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of Object.values(value)) collectStrings(item, output, seen);
  }
  return output;
}

function assertRendererSafeProjection(value) {
  const text = collectStrings(value).join("\n");
  const forbidden = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/i,
    /https:\/\/chatgpt\.com\/[^\s)]+/i,
    /\\\\wsl\.localhost\\/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      const error = new Error("direct_ui_projection_raw_exposure");
      error.code = "direct_ui_projection_raw_exposure";
      throw error;
    }
  }
  return true;
}

function validateDirectUiProjection(value, schema) {
  if (!isPlainObject(value)) return false;
  if (schema && value.schema !== schema) return false;
  return value.rendererSafe === true &&
    value.rawProviderPayloadIncluded === false &&
    value.rawLocalPathIncluded === false &&
    value.rawToolOutputIncluded === false &&
    isPlainObject(value.meta) &&
    Number.isFinite(Number(value.meta.uiProjectionGeneration)) &&
    Boolean(value.meta.sourceDigest);
}

module.exports = {
  DIRECT_IMPLEMENTATION_LANE_UI_STATUS_SCHEMA,
  DIRECT_OPERATION_HISTORY_PROJECTION_SCHEMA,
  DIRECT_POLICY_READONLY_VIEW_SCHEMA,
  DIRECT_UI_PARITY_REPORT_SCHEMA,
  assertRendererSafeProjection,
  buildDirectImplementationLaneUiStatus,
  buildDirectPolicyReadOnlyView,
  projectOperationHistoryPage,
  validateDirectUiProjection,
};
