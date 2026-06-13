"use strict";

const crypto = require("node:crypto");

const DIRECT_SETTINGS_SURFACE_SCHEMA = "direct_settings_surface@1";
const DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA = "direct_settings_surface_projection@1";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function countBy(rows = [], field) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function statusRow(label, value, stateLabel = "diagnostic", details = "") {
  return {
    label: boundedString(label, 80),
    value: boundedString(value === undefined || value === null ? "" : String(value), 220),
    stateLabel: boundedString(stateLabel, 40) || "diagnostic",
    details: boundedString(details, 360),
  };
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function directRuntimePath(runtimeStatus = {}) {
  return normalizeString(
    runtimeStatus?.selection?.runtimePath ||
      runtimeStatus?.directRuntimePath ||
      runtimeStatus?.directRuntime?.runtimePath ||
      runtimeStatus?.codex?.runtimePath ||
      runtimeStatus?.currentRuntimePath,
    "unknown",
  );
}

function runtimeLabel(runtimeStatus = {}) {
  return normalizeString(
    runtimeStatus?.directRuntime?.status ||
      runtimeStatus?.status ||
      runtimeStatus?.currentCodexLane ||
      runtimeStatus?.directImplementationLane?.status,
    "unknown",
  );
}

function summarizeRegistry(registryAudit = {}) {
  const audit = objectOrEmpty(registryAudit);
  const rows = arrayOrEmpty(audit.rows);
  const settingsRow = rows.find((row) => row?.id === "ic15.direct-settings-surface") || {};
  const byState = objectOrEmpty(audit.summary?.byImplementationState || countBy(rows, "implementationState"));
  return {
    schema: normalizeString(audit.schema, ""),
    totalRows: Number(audit.summary?.totalRows || rows.length || 0),
    valid: audit.summary?.valid !== false,
    byImplementationState: byState,
    settingsSurfaceState: normalizeString(settingsRow.implementationState, "missing"),
    settingsSurfacePosture: normalizeString(settingsRow.directPathPosture, "unknown"),
    sourceFileCount: arrayOrEmpty(settingsRow.sourceFiles).length,
    rowErrorCount: Number(audit.summary?.rowErrorCount || arrayOrEmpty(audit.rowErrors).length || 0),
  };
}

function summarizeRuntime(runtimeStatus = {}) {
  const runtime = objectOrEmpty(runtimeStatus);
  const activation = objectOrEmpty(runtime.activation);
  const context = objectOrEmpty(runtime.directContextMaintenance || runtime.contextMaintenance);
  const memoryPointerState = normalizeString(context.memoryPointerState, "none");
  const memoryState = normalizeString(context.memoryState, "none");
  return {
    currentPath: directRuntimePath(runtime),
    lane: normalizeString(runtime.currentCodexLane, runtimeLabel(runtime)),
    status: runtimeLabel(runtime),
    activationStatus: normalizeString(activation.status || activation.gateStatus, activation.enabled === true ? "enabled" : "not_enabled"),
    activationEligible: activation.eligible === true,
    implementationLaneStatus: normalizeString(runtime.directImplementationLane?.status, "unknown"),
    contextPressure: normalizeString(context.pressureState, "unknown"),
    contextRoute: normalizeString(context.routeKind, "unknown"),
    memoryState: memoryPointerState !== "none" ? memoryPointerState : memoryState,
    batonState: normalizeString(context.batonState, "not_required"),
    omissionState: normalizeString(context.omissionState, "none"),
    providerCompactState: normalizeString(context.providerCompactState, "not_proven"),
    providerTransportAllowed: context.providerTransportAllowed === true,
    maintenanceExecutionAllowed: context.maintenanceExecutionAllowed === true,
    memoryEditorAllowed: context.memoryEditorAllowed === true,
    memoryResetAllowed: context.memoryResetAllowed === true,
    compactActionAllowed: context.compactActionAllowed === true,
  };
}

function summarizeWorkThreads(input = {}) {
  const status = objectOrEmpty(input.status || input.workThreadStatus);
  const projection = objectOrEmpty(input.projection || input.workThreadProjection);
  const resolution = objectOrEmpty(input.resolution || input.workTargetResolution);
  const reportInput = input.resolutionReport || input.workTargetResolutionReport;
  const hasResolutionReport = isPlainObject(reportInput);
  const resolutionReport = hasResolutionReport ? objectOrEmpty(reportInput) : {};
  const blockerCodes = hasResolutionReport ? arrayOrEmpty(resolutionReport.blockerCodes) : arrayOrEmpty(resolution.ambiguityBlockers);
  return {
    available: status.available === true || projection.schema === "direct_work_thread_projection@1",
    availabilityReason: normalizeString(status.reason || input.availabilityReason, status.available === false ? "not_wired" : ""),
    workThreadCount: Number(status.workThreadCount || projection.rowCount || 0),
    activeCount: Number(status.activeCount || projection.activeCount || 0),
    projectionDigest: normalizeString(status.projectionDigest || projection.projectionDigest, ""),
    resolutionState: normalizeString(hasResolutionReport ? resolutionReport.resolutionState : resolution.resolutionState, "unavailable"),
    routingGateState: normalizeString(hasResolutionReport ? resolutionReport.routingGateState : "", "unavailable"),
    selectedWorkThreadId: normalizeString(hasResolutionReport ? resolutionReport.selectedWorkThreadId : resolution.selectedWorkThreadId, ""),
    candidateCount: Number(hasResolutionReport ? (resolutionReport.candidateCount ?? 0) : arrayOrEmpty(resolution.candidates).length),
    ambiguityBlockers: blockerCodes.map((item) => normalizeString(item, "")).filter(Boolean),
    stale: resolutionReport.stale === true,
    clarificationRequired: resolutionReport.clarificationRequired === true,
    nonTargetPreservationRequired: resolutionReport.nonTargetPreservationRequired === true,
    routingEnforced: hasResolutionReport ? resolutionReport.routingEnforced === true : resolution.transitionLaw?.routingEnforced === true,
    mutationAllowed: hasResolutionReport ? resolutionReport.mutationAuthorityGranted === true : resolution.transitionLaw?.mutationAllowed === true,
    providerCallAllowed: hasResolutionReport ? resolutionReport.providerCallAuthorityGranted === true : resolution.transitionLaw?.providerCallAllowed === true,
    mutationBlocked: resolutionReport.mutationBlocked === true,
    providerCallBlocked: resolutionReport.providerCallBlocked === true,
    resolutionReportDigest: normalizeString(resolutionReport.reportDigest, ""),
  };
}

function summarizeOperatorBroker(input = {}) {
  const broker = objectOrEmpty(input.operatorBroker || input.operatorBrokerResolution || input.operatorBrokerProjection || input);
  const constraints = arrayOrEmpty(broker.nonTargetPreservationConstraints || broker.downstreamRoutePacketConstraints?.constraintCodes)
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  const blockers = arrayOrEmpty(broker.ambiguityBlockers)
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  const workWorld = objectOrEmpty(broker.workWorld || broker.workWorldSnapshot);
  return {
    available: normalizeString(broker.schema, "") === "operator_broker_resolution@1" || normalizeString(broker.schema, "") === "operator_broker_resolution_projection@1",
    schema: normalizeString(broker.schema, "not_exposed"),
    resolutionState: normalizeString(broker.resolutionState, "unavailable"),
    routingGateState: normalizeString(broker.routingGateState, "unavailable"),
    selectedWorkThreadId: normalizeString(broker.selectedWorkThreadId, ""),
    candidateCount: Number(broker.candidateCount ?? arrayOrEmpty(broker.candidates).length ?? 0),
    confidenceLabel: normalizeString(broker.confidenceLabel, "none"),
    clarificationRequired: broker.clarificationRequired === true,
    nonTargetPreservationRequired: broker.nonTargetPreservationRequired === true,
    ambiguityBlockers: blockers,
    nonTargetPreservationConstraints: constraints,
    linkedCodexThreadCount: Number(workWorld.linkedCodexThreadCount || 0),
    linkedChatGptThreadCount: Number(workWorld.linkedChatGptThreadCount || 0),
    openObligationCount: Number(workWorld.openObligationCount || 0),
    recentContextRefCount: Number(workWorld.recentContextRefCount ?? arrayOrEmpty(workWorld.recentContextRefs).length ?? 0),
    branchName: normalizeString(workWorld.branchName || workWorld.branchIdentity?.branchName, ""),
    workspaceKind: normalizeString(workWorld.workspaceKind || workWorld.workspaceIdentity?.workspaceKind, "unknown"),
    brokerResolutionDigest: normalizeString(broker.brokerResolutionDigest, ""),
    mutationAllowed: broker.authority?.mutationAuthorityGranted === true || broker.authority?.workspaceMutationAllowed === true,
    providerCallAllowed: broker.authority?.providerCallAuthorityGranted === true || broker.authority?.providerTransportAllowed === true,
    routingEnforced: broker.authority?.routingEnforced === true,
  };
}

function summarizeWorkThreadControlDeck(input = {}) {
  const deck = objectOrEmpty(input.workThreadControlDeck || input.controlDeck || input);
  const currentPointer = objectOrEmpty(deck.currentPointer);
  const rows = arrayOrEmpty(deck.rows);
  const pointerState = normalizeString(deck.pointerState, "unavailable");
  return {
    available: normalizeString(deck.schema, "") === "direct_work_thread_control_deck@1",
    schema: normalizeString(deck.schema, "not_exposed"),
    pointerState,
    selectedWorkThreadId: pointerState === "selected"
      ? normalizeString(deck.selectedWorkThreadId || currentPointer.selectedWorkThreadId, "")
      : "",
    selectedProviderLane: normalizeString(currentPointer.selectedProviderLane, "unknown"),
    activeDirectSessionId: normalizeString(currentPointer.activeDirectSessionId, ""),
    activeProviderThreadId: normalizeString(currentPointer.activeProviderThreadId, ""),
    sourceKind: normalizeString(currentPointer.sourceKind, "unknown"),
    rowCount: Number(deck.rowCount ?? rows.length ?? 0),
    activeCount: Number(deck.activeCount ?? 0),
    staleCount: Number(deck.staleCount ?? 0),
    mismatchCount: Number(deck.mismatchCount ?? 0),
    blockedCount: Number(deck.blockedCount ?? 0),
    blockerCodes: arrayOrEmpty(deck.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    nonTargetPreservationConstraints: arrayOrEmpty(deck.nonTargetPreservationConstraints).map((item) => normalizeString(item, "")).filter(Boolean),
    lastContextPackDigest: normalizeString(currentPointer.lastContextPackRef?.digest, ""),
    lastAuthorityTransitionDigest: normalizeString(currentPointer.lastAuthorityTransitionRef?.digest, ""),
    lastControlledRouteDigest: normalizeString(currentPointer.lastControlledRouteRef?.digest, ""),
    selectionTransitionAvailable: deck.selectionTransitionAvailable === true,
    providerCallAuthorityGranted: deck.providerCallAuthorityGranted === true || currentPointer.providerCallAuthorityGranted === true,
    workspaceMutationAuthorityGranted: deck.workspaceMutationAuthorityGranted === true || currentPointer.workspaceMutationAuthorityGranted === true,
    workerSpawnAuthorityGranted: deck.workerSpawnAuthorityGranted === true || currentPointer.workerSpawnAuthorityGranted === true,
    appServerReplacementAuthorityGranted: deck.appServerReplacementAuthorityGranted === true || currentPointer.appServerReplacementAuthorityGranted === true,
    controlDeckDigest: normalizeString(deck.controlDeckDigest, ""),
    pointerDigest: normalizeString(currentPointer.pointerDigest, ""),
  };
}

function summarizeClarificationTargetPicker(input = {}) {
  const picker = objectOrEmpty(input.clarificationTargetPicker || input.targetPicker || input);
  const actions = objectOrEmpty(picker.actions);
  return {
    available: normalizeString(picker.schema, "") === "direct_clarification_target_picker@1",
    schema: normalizeString(picker.schema, "not_exposed"),
    pickerState: normalizeString(picker.pickerState, "unavailable"),
    transitionKind: normalizeString(picker.transitionKind, "unknown"),
    candidateCount: Number(picker.candidateCount ?? arrayOrEmpty(picker.candidates).length ?? 0),
    selectableCandidateCount: Number(picker.selectableCandidateCount ?? 0),
    blockerCodes: arrayOrEmpty(picker.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    chooseCandidateAvailable: actions.chooseCandidateAvailable === true,
    rejectAllAvailable: actions.rejectAllAvailable === true,
    keepBlockedAvailable: actions.keepBlockedAvailable === true,
    providerCallAuthorityGranted: actions.providerCallAuthorityGranted === true,
    workspaceMutationAuthorityGranted: actions.workspaceMutationAuthorityGranted === true,
    workerSpawnAuthorityGranted: actions.workerSpawnAuthorityGranted === true,
    objectAuditAuthorityGranted: actions.objectAuditAuthorityGranted === true,
    appServerReplacementAuthorityGranted: actions.appServerReplacementAuthorityGranted === true,
    nonTargetPreservationRequired: picker.downstreamRoutePacketConstraints?.nonTargetPreservationRequired === true,
    targetPickerDigest: normalizeString(picker.pickerDigest, ""),
    clarificationPacketDigest: normalizeString(picker.clarificationPacketDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(picker.operatorBrokerResolutionDigest, ""),
  };
}

function summarizeGovernance(input = {}) {
  const governance = objectOrEmpty(input.governanceStatus || input.governance || input.metaSessionStatus?.governance);
  const broker = objectOrEmpty(input.brokerStatus || input.broker || input.metaSessionStatus?.routeSummary);
  const routes = objectOrEmpty(input.metaSessionStatus?.details?.routeSummary || input.metaSessionStatus?.routeSummary || broker);
  return {
    governanceSchema: normalizeString(governance.schema || governance.packetSchema, "not_exposed"),
    governanceMode: normalizeString(governance.mode || governance.enforcementMode, "shadow_only"),
    governanceEnforced: governance.enforced === true,
    brokerSchema: normalizeString(broker.schema || broker.packetSchema, "not_exposed"),
    selectedRoute: normalizeString(broker.selectedRoute || broker.selectedRouteId || broker.selected, "none"),
    proposedRoutes: Number(routes.proposed || 0),
    acceptedRoutes: Number(routes.accepted || 0),
    dispatchedRoutes: Number(routes.dispatched || 0),
    blockedDispatches: Number(routes.dispatchBlocked || broker.blocked || 0),
    semanticBrokerEnforced: broker.enforced === true || broker.routingEnforced === true,
  };
}

function summarizeModules(moduleStatus = {}) {
  const status = objectOrEmpty(moduleStatus);
  return {
    schema: normalizeString(status.schema, ""),
    status: normalizeString(status.status, "shadow_only"),
    moduleCount: Number(status.moduleCount || 0),
    contextContributorCount: Number(status.contextContributorCount || 0),
    evidenceImporterCount: Number(status.evidenceImporterCount || 0),
    actionProposalCount: Number(status.actionProposalCount || 0),
    contextContributionCount: Number(status.contextContributionCount || 0),
    evidenceImportRowCount: Number(status.evidenceImportRowCount || 0),
    hookProposalCount: Number(status.hookProposalCount || 0),
    executionGateCount: Number(status.executionGateCount || 0),
    executionGateStates: Array.isArray(status.executionGateStates) ? status.executionGateStates.map((entry) => normalizeString(entry, "")).filter(Boolean) : [],
    executionAllowedInThisPr: status.executionAllowedInThisPr === true,
    actionable: status.actionable === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Skills, hooks, and apps are classified but not executable.", 320),
  };
}

function summarizeAgentClasses(agentClassStatus = {}) {
  const status = objectOrEmpty(agentClassStatus);
  return {
    schema: normalizeString(status.schema, ""),
    status: normalizeString(status.status, "shadow_only"),
    specCount: Number(status.specCount || 0),
    registryId: normalizeString(status.registryId, ""),
    registryDigest: normalizeString(status.registryDigest, ""),
    executionEnabledInThisPr: status.executionEnabledInThisPr === true,
    routingEnabledInThisPr: status.routingEnabledInThisPr === true,
    providerCallEnabledInThisPr: status.providerCallEnabledInThisPr === true,
    workspaceMutationEnabledInThisPr: status.workspaceMutationEnabledInThisPr === true,
    objectAuditAutomationEnabledInThisPr: status.objectAuditAutomationEnabledInThisPr === true,
    subAgentSpawnEnabledInThisPr: status.subAgentSpawnEnabledInThisPr === true,
    memoryMutationEnabledInThisPr: status.memoryMutationEnabledInThisPr === true,
    providerCompactionEnabledInThisPr: status.providerCompactionEnabledInThisPr === true,
    actionable: status.actionable === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Agent classes are declared as role contracts only.", 320),
  };
}

function summarizeContinuity(input = {}) {
  const continuity = objectOrEmpty(input.continuityStatus || input.contextContinuityStatus);
  const runtimeContext = objectOrEmpty(input.runtimeStatus?.directContextMaintenance || input.runtimeStatus?.contextMaintenance);
  return {
    schema: normalizeString(continuity.schema, ""),
    transitionStatus: normalizeString(continuity.transitionStatus, "unknown"),
    contextLossState: normalizeString(continuity.contextLossState, "unknown"),
    omittedItemCount: Number(continuity.omittedItemCount || 0),
    localCompactionPlanState: normalizeString(continuity.localCompactionPlanState, "not_built"),
    manualCompactGateState: normalizeString(continuity.manualCompactGateState, "not_requested"),
    compactionSourceSpanCount: Number(continuity.compactionSourceSpanCount || 0),
    compactionResidualRiskCount: Number(continuity.compactionResidualRiskCount || 0),
    memoryState: normalizeString(continuity.memoryState, runtimeContext.memoryState || "none"),
    memoryReviewState: normalizeString(continuity.memoryReviewState, "not_built"),
    memoryRefreshProposalState: normalizeString(continuity.memoryRefreshProposalState, "not_built"),
    memoryResetPolicyState: normalizeString(continuity.memoryResetPolicyState, "disabled"),
    memoryResetConfirmationState: normalizeString(continuity.memoryResetConfirmationState, "not_requested"),
    staleMemoryEntryCount: Number(continuity.staleMemoryEntryCount || 0),
    conflictedMemoryEntryCount: Number(continuity.conflictedMemoryEntryCount || 0),
    batonState: normalizeString(continuity.batonState, runtimeContext.batonState || "not_required"),
    omissionState: normalizeString(continuity.omissionState, runtimeContext.omissionState || "none"),
    providerCompactionState: normalizeString(continuity.providerCompactionState, runtimeContext.providerCompactState || "not_requested"),
    displayOnly: continuity.displayOnly !== false,
    compactActionAllowed: continuity.compactActionAllowed === true || runtimeContext.compactActionAllowed === true,
    manualCompactActionAllowed: continuity.manualCompactActionAllowed === true,
    memoryEditorAllowed: continuity.memoryEditorAllowed === true || runtimeContext.memoryEditorAllowed === true,
    memoryResetAllowed: continuity.memoryResetAllowed === true || runtimeContext.memoryResetAllowed === true,
    providerTransportAllowed: continuity.providerTransportAllowed === true || runtimeContext.providerTransportAllowed === true,
    hiddenContextLossAllowed: continuity.hiddenContextLossAllowed === true,
  };
}

function summarizeContextPreview(input = {}) {
  const source = objectOrEmpty(input);
  const preview = normalizeString(source.schema, "") === "direct_context_packet_preview@1"
    ? source
    : objectOrEmpty(source.contextPreview || source.contextPacketPreview || source.directContextPreview);
  const counts = objectOrEmpty(preview.counts);
  const constraints = objectOrEmpty(preview.downstreamRequestConstraints);
  const authority = objectOrEmpty(preview.authority);
  const bySourceClass = objectOrEmpty(counts.bySourceClass);
  const sourceClasses = Object.keys(bySourceClass).sort();
  return {
    available: normalizeString(preview.schema, "") === "direct_context_packet_preview@1",
    schema: normalizeString(preview.schema, "not_exposed"),
    previewState: normalizeString(preview.previewState, "unavailable"),
    rowCount: Number(counts.rowCount ?? arrayOrEmpty(preview.sourceRows).length ?? 0),
    includedSourceCount: Number(counts.includedSourceCount ?? 0),
    omittedSourceCount: Number(counts.omittedSourceCount ?? 0),
    requiredSourceCount: Number(counts.requiredSourceCount ?? 0),
    staleSourceCount: Number(counts.staleSourceCount ?? 0),
    missingSourceCount: Number(counts.missingSourceCount ?? 0),
    rawExposureUnsafeCount: Number(counts.rawExposureUnsafeCount ?? 0),
    tokenEstimateTotal: Number(counts.tokenEstimateTotal ?? 0),
    sizeBytesTotal: Number(counts.sizeBytesTotal ?? 0),
    sourceClasses,
    blockerCount: arrayOrEmpty(preview.blockers).length,
    blockerCodes: arrayOrEmpty(constraints.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    requestAssemblyAllowed: constraints.requestAssemblyAllowed === true,
    requestAssemblyBlocked: constraints.requestAssemblyBlocked === true,
    providerCallBlocked: constraints.providerCallBlocked !== false,
    previewEditingAllowed: authority.previewEditingAllowed === true,
    providerTransportAllowed: authority.providerTransportAllowed === true,
    workspaceMutationAllowed: authority.workspaceMutationAllowed === true,
    memoryMutationAllowed: authority.memoryMutationAllowed === true,
    providerCompactionAllowed: authority.providerCompactionAllowed === true,
    previewDigest: normalizeString(preview.previewDigest, ""),
  };
}

function summarizeAgentUsage(input = {}) {
  const source = objectOrEmpty(input);
  const usage = normalizeString(source.schema, "") === "direct_agent_usage_summary_projection@1"
    ? source
    : objectOrEmpty(source.agentUsageStatus || source.agentUsageProjection || source.directAgentUsage);
  const totals = objectOrEmpty(usage.totals);
  return {
    available: normalizeString(usage.schema, "") === "direct_agent_usage_summary_projection@1",
    schema: normalizeString(usage.schema, "not_exposed"),
    rowCount: Number(usage.rowCount ?? 0),
    turnCount: Number(totals.turnCount ?? 0),
    totalTokensKnown: Number(totals.totalTokensKnown ?? 0),
    inputTokensKnown: Number(totals.inputTokensKnown ?? 0),
    outputTokensKnown: Number(totals.outputTokensKnown ?? 0),
    reasoningTokensKnown: Number(totals.reasoningTokensKnown ?? 0),
    cachedInputTokensKnown: Number(totals.cachedInputTokensKnown ?? 0),
    missingUsageRowCount: Number(totals.missingUsageRowCount ?? 0),
    durationMsKnown: Number(totals.durationMsKnown ?? 0),
    agentCount: arrayOrEmpty(usage.byAgent).length,
    workThreadCount: arrayOrEmpty(usage.byWorkThread).length,
    routeCount: arrayOrEmpty(usage.byRoute).length,
    costComputed: usage.evidencePosture?.costComputed === true,
    billingGrade: usage.evidencePosture?.billingGrade === true,
    ledgerDigest: normalizeString(usage.ledgerDigest, ""),
    projectionDigest: normalizeString(usage.projectionDigest, ""),
  };
}

function buildRows(sections) {
  const runtime = sections.runtime;
  const registry = sections.registry;
  const workThreads = sections.workThreads;
  const workThreadControl = sections.workThreadControl;
  const clarificationTargetPicker = sections.clarificationTargetPicker;
  const operatorBroker = sections.operatorBroker;
  const governance = sections.governance;
  const modules = sections.modules;
  const agentClasses = sections.agentClasses;
  const continuity = sections.continuity;
  const contextPreview = sections.contextPreview;
  const agentUsage = sections.agentUsage;
  return {
    runtime: [
      statusRow("Current path", runtime.currentPath),
      statusRow("Lane", runtime.lane),
      statusRow("Runtime status", runtime.status),
      statusRow("Activation", runtime.activationStatus, runtime.activationEligible ? "diagnostic" : "unknown"),
      statusRow("Implementation lane", runtime.implementationLaneStatus),
    ],
    registry: [
      statusRow("Registry rows", registry.totalRows),
      statusRow("Registry valid", registry.valid ? "yes" : "no", registry.valid ? "ok" : "blocked"),
      statusRow("Settings surface", registry.settingsSurfaceState, registry.settingsSurfaceState === "partial" || registry.settingsSurfaceState === "implemented" ? "ok" : "missing"),
      statusRow("Source files", registry.sourceFileCount),
      statusRow("Row errors", registry.rowErrorCount, registry.rowErrorCount ? "blocked" : "ok"),
    ],
    workThreads: [
      statusRow("Store", workThreads.available ? "available" : "not wired", workThreads.available ? "diagnostic" : "missing"),
      statusRow("WorkThreads", workThreads.workThreadCount),
      statusRow("Active", workThreads.activeCount),
      statusRow("Resolution", workThreads.resolutionState, workThreads.resolutionState === "selected" ? "ok" : "unknown"),
      statusRow("Target gate", workThreads.routingGateState, workThreads.routingGateState === "selected_ready" ? "diagnostic" : "blocked"),
      statusRow("Blockers", workThreads.ambiguityBlockers.length ? workThreads.ambiguityBlockers.join(", ") : "none", workThreads.ambiguityBlockers.length ? "blocked" : "ok"),
      statusRow("Mutation", workThreads.mutationBlocked ? "blocked" : "not granted", workThreads.mutationAllowed ? "blocked" : "ok"),
      statusRow("Routing", workThreads.routingEnforced ? "unexpected enforce" : "shadow only", workThreads.routingEnforced ? "blocked" : "ok"),
    ],
    workThreadControl: [
      statusRow("Surface", workThreadControl.available ? "available" : "not exposed", workThreadControl.available ? "diagnostic" : "missing"),
      statusRow("Pointer", workThreadControl.pointerState, workThreadControl.pointerState === "selected" ? "ok" : "blocked"),
      statusRow("Selected", workThreadControl.selectedWorkThreadId || "none", workThreadControl.selectedWorkThreadId ? "diagnostic" : "blocked"),
      statusRow("Provider lane", workThreadControl.selectedProviderLane),
      statusRow("Direct session", workThreadControl.activeDirectSessionId || "none"),
      statusRow("Provider thread", workThreadControl.activeProviderThreadId || "none"),
      statusRow("Rows / active", `${workThreadControl.rowCount}/${workThreadControl.activeCount}`),
      statusRow("Stale / mismatch", `${workThreadControl.staleCount}/${workThreadControl.mismatchCount}`, workThreadControl.staleCount || workThreadControl.mismatchCount ? "blocked" : "ok"),
      statusRow("Blocked", workThreadControl.blockedCount, workThreadControl.blockedCount ? "blocked" : "ok"),
      statusRow("Blockers", workThreadControl.blockerCodes.length ? workThreadControl.blockerCodes.slice(0, 5).join(", ") : "none", workThreadControl.blockerCodes.length ? "blocked" : "ok"),
      statusRow("Non-target preservation", workThreadControl.nonTargetPreservationConstraints.length ? "required" : "standard", workThreadControl.nonTargetPreservationConstraints.length ? "diagnostic" : "ok"),
      statusRow("Selection transition", workThreadControl.selectionTransitionAvailable ? "available" : "not available", workThreadControl.selectionTransitionAvailable ? "diagnostic" : "missing"),
      statusRow("Authority", workThreadControl.providerCallAuthorityGranted || workThreadControl.workspaceMutationAuthorityGranted || workThreadControl.workerSpawnAuthorityGranted || workThreadControl.appServerReplacementAuthorityGranted ? "unexpected grant" : "no grant", workThreadControl.providerCallAuthorityGranted || workThreadControl.workspaceMutationAuthorityGranted || workThreadControl.workerSpawnAuthorityGranted || workThreadControl.appServerReplacementAuthorityGranted ? "blocked" : "ok"),
    ],
    clarificationTargetPicker: [
      statusRow("Surface", clarificationTargetPicker.available ? "available" : "not exposed", clarificationTargetPicker.available ? "diagnostic" : "missing"),
      statusRow("Picker", clarificationTargetPicker.pickerState, clarificationTargetPicker.pickerState === "ready" ? "ok" : "blocked"),
      statusRow("Transition", clarificationTargetPicker.transitionKind),
      statusRow("Candidates", `${clarificationTargetPicker.candidateCount}/${clarificationTargetPicker.selectableCandidateCount}`),
      statusRow("Choose", clarificationTargetPicker.chooseCandidateAvailable ? "available" : "not available", clarificationTargetPicker.chooseCandidateAvailable ? "diagnostic" : "blocked"),
      statusRow("Reject / keep blocked", `${clarificationTargetPicker.rejectAllAvailable ? "reject" : "no reject"} / ${clarificationTargetPicker.keepBlockedAvailable ? "keep" : "no keep"}`),
      statusRow("Blockers", clarificationTargetPicker.blockerCodes.length ? clarificationTargetPicker.blockerCodes.slice(0, 5).join(", ") : "none", clarificationTargetPicker.blockerCodes.length ? "blocked" : "ok"),
      statusRow("Non-target preservation", clarificationTargetPicker.nonTargetPreservationRequired ? "required" : "standard", clarificationTargetPicker.nonTargetPreservationRequired ? "diagnostic" : "ok"),
      statusRow("Authority", clarificationTargetPicker.providerCallAuthorityGranted || clarificationTargetPicker.workspaceMutationAuthorityGranted || clarificationTargetPicker.workerSpawnAuthorityGranted || clarificationTargetPicker.objectAuditAuthorityGranted || clarificationTargetPicker.appServerReplacementAuthorityGranted ? "unexpected grant" : "no grant", clarificationTargetPicker.providerCallAuthorityGranted || clarificationTargetPicker.workspaceMutationAuthorityGranted || clarificationTargetPicker.workerSpawnAuthorityGranted || clarificationTargetPicker.objectAuditAuthorityGranted || clarificationTargetPicker.appServerReplacementAuthorityGranted ? "blocked" : "ok"),
    ],
    operatorBroker: [
      statusRow("Surface", operatorBroker.available ? "available" : "not exposed", operatorBroker.available ? "diagnostic" : "missing"),
      statusRow("Resolution", operatorBroker.resolutionState, operatorBroker.resolutionState === "selected" ? "ok" : "blocked"),
      statusRow("Target gate", operatorBroker.routingGateState, operatorBroker.routingGateState === "selected_ready" ? "diagnostic" : "blocked"),
      statusRow("Confidence", operatorBroker.confidenceLabel),
      statusRow("Candidates", operatorBroker.candidateCount),
      statusRow("Selected", operatorBroker.selectedWorkThreadId || "none", operatorBroker.selectedWorkThreadId ? "diagnostic" : "blocked"),
      statusRow("Clarification", operatorBroker.clarificationRequired ? "required" : "not required", operatorBroker.clarificationRequired ? "blocked" : "ok"),
      statusRow("Non-target preservation", operatorBroker.nonTargetPreservationRequired ? "required" : "standard", operatorBroker.nonTargetPreservationRequired ? "diagnostic" : "ok"),
      statusRow("Blockers", operatorBroker.ambiguityBlockers.length ? operatorBroker.ambiguityBlockers.join(", ") : "none", operatorBroker.ambiguityBlockers.length ? "blocked" : "ok"),
      statusRow("Constraints", operatorBroker.nonTargetPreservationConstraints.length ? operatorBroker.nonTargetPreservationConstraints.slice(0, 5).join(", ") : "none"),
      statusRow("Work-world refs", `codex ${operatorBroker.linkedCodexThreadCount} / gpt ${operatorBroker.linkedChatGptThreadCount} / obligations ${operatorBroker.openObligationCount}`),
      statusRow("Authority", operatorBroker.mutationAllowed || operatorBroker.providerCallAllowed || operatorBroker.routingEnforced ? "unexpected grant" : "no grant", operatorBroker.mutationAllowed || operatorBroker.providerCallAllowed || operatorBroker.routingEnforced ? "blocked" : "ok"),
    ],
    governance: [
      statusRow("Governance", governance.governanceSchema),
      statusRow("Mode", governance.governanceMode),
      statusRow("Authority", governance.governanceEnforced ? "unexpected enforce" : "not enforced", governance.governanceEnforced ? "blocked" : "ok"),
      statusRow("Broker", governance.brokerSchema),
      statusRow("Dispatch blocked", governance.blockedDispatches),
    ],
    modules: [
      statusRow("Status", modules.status),
      statusRow("Modules", modules.moduleCount),
      statusRow("Context", modules.contextContributorCount),
      statusRow("Evidence import", modules.evidenceImporterCount),
      statusRow("Context refs", modules.contextContributionCount),
      statusRow("Evidence rows", modules.evidenceImportRowCount),
      statusRow("Hook proposals", modules.hookProposalCount),
      statusRow("Execution gates", modules.executionGateCount),
      statusRow("Execution", modules.executionAllowedInThisPr ? "unexpected enabled" : "disabled", modules.executionAllowedInThisPr ? "blocked" : "ok"),
    ],
    agentClasses: [
      statusRow("Status", agentClasses.status),
      statusRow("Specs", agentClasses.specCount),
      statusRow("Execution", agentClasses.executionEnabledInThisPr ? "unexpected enabled" : "disabled", agentClasses.executionEnabledInThisPr ? "blocked" : "ok"),
      statusRow("Routing", agentClasses.routingEnabledInThisPr ? "unexpected enabled" : "shadow only", agentClasses.routingEnabledInThisPr ? "blocked" : "ok"),
      statusRow("Audit automation", agentClasses.objectAuditAutomationEnabledInThisPr ? "unexpected enabled" : "disabled", agentClasses.objectAuditAutomationEnabledInThisPr ? "blocked" : "ok"),
    ],
    continuity: [
      statusRow("Transition", continuity.transitionStatus),
      statusRow("Context loss", continuity.contextLossState),
      statusRow("Local compact plan", continuity.localCompactionPlanState, continuity.localCompactionPlanState === "preview_ready" ? "diagnostic" : "ok"),
      statusRow("Manual compact gate", continuity.manualCompactGateState, continuity.manualCompactGateState === "manual_ready" ? "diagnostic" : "ok"),
      statusRow("Compact spans/risks", `${continuity.compactionSourceSpanCount}/${continuity.compactionResidualRiskCount}`),
      statusRow("Memory", continuity.memoryState),
      statusRow("Memory review", continuity.memoryReviewState, continuity.memoryReviewState === "current" ? "ok" : "diagnostic"),
      statusRow("Memory refresh", continuity.memoryRefreshProposalState),
      statusRow("Memory reset", continuity.memoryResetPolicyState, continuity.memoryResetPolicyState === "disabled" ? "ok" : "diagnostic"),
      statusRow("Memory reset confirmation", continuity.memoryResetConfirmationState),
      statusRow("Memory stale/conflict", `${continuity.staleMemoryEntryCount}/${continuity.conflictedMemoryEntryCount}`),
      statusRow("Baton", continuity.batonState),
      statusRow("Provider compact", continuity.providerCompactionState),
    ],
    contextPreview: [
      statusRow("Surface", contextPreview.available ? "available" : "not exposed", contextPreview.available ? "diagnostic" : "missing"),
      statusRow("Preview", contextPreview.previewState, contextPreview.previewState === "ready" ? "ok" : contextPreview.previewState === "blocked_from_request" ? "blocked" : "diagnostic"),
      statusRow("Sources", contextPreview.rowCount),
      statusRow("Included/omitted", `${contextPreview.includedSourceCount}/${contextPreview.omittedSourceCount}`),
      statusRow("Required", contextPreview.requiredSourceCount),
      statusRow("Token estimate", contextPreview.tokenEstimateTotal),
      statusRow("Size", `${contextPreview.sizeBytesTotal} bytes`),
      statusRow("Stale/missing/raw", `${contextPreview.staleSourceCount}/${contextPreview.missingSourceCount}/${contextPreview.rawExposureUnsafeCount}`, contextPreview.staleSourceCount || contextPreview.missingSourceCount || contextPreview.rawExposureUnsafeCount ? "blocked" : "ok"),
      statusRow("Classes", contextPreview.sourceClasses.length ? contextPreview.sourceClasses.join(", ") : "none"),
      statusRow("Blockers", contextPreview.blockerCodes.length ? contextPreview.blockerCodes.slice(0, 5).join(", ") : "none", contextPreview.blockerCodes.length ? "blocked" : "ok"),
      statusRow("Request", contextPreview.requestAssemblyAllowed ? "preview clear" : "blocked/not granted", contextPreview.requestAssemblyAllowed && !contextPreview.requestAssemblyBlocked ? "diagnostic" : "blocked"),
      statusRow("Authority", contextPreview.previewEditingAllowed || contextPreview.providerTransportAllowed || contextPreview.workspaceMutationAllowed || contextPreview.memoryMutationAllowed || contextPreview.providerCompactionAllowed ? "unexpected grant" : "display only", contextPreview.previewEditingAllowed || contextPreview.providerTransportAllowed || contextPreview.workspaceMutationAllowed || contextPreview.memoryMutationAllowed || contextPreview.providerCompactionAllowed ? "blocked" : "ok"),
    ],
    agentUsage: [
      statusRow("Surface", agentUsage.available ? "available" : "not exposed", agentUsage.available ? "diagnostic" : "missing"),
      statusRow("Rows / turns", `${agentUsage.rowCount}/${agentUsage.turnCount}`),
      statusRow("Known tokens", agentUsage.totalTokensKnown),
      statusRow("Input/output", `${agentUsage.inputTokensKnown}/${agentUsage.outputTokensKnown}`),
      statusRow("Reasoning/cached", `${agentUsage.reasoningTokensKnown}/${agentUsage.cachedInputTokensKnown}`),
      statusRow("Missing rows", agentUsage.missingUsageRowCount, agentUsage.missingUsageRowCount ? "diagnostic" : "ok"),
      statusRow("Duration", `${agentUsage.durationMsKnown} ms`),
      statusRow("Agents", agentUsage.agentCount),
      statusRow("WorkThreads", agentUsage.workThreadCount),
      statusRow("Routes", agentUsage.routeCount),
      statusRow("Cost", agentUsage.costComputed || agentUsage.billingGrade ? "unexpected" : "not computed", agentUsage.costComputed || agentUsage.billingGrade ? "blocked" : "ok"),
    ],
  };
}

function buildDirectSettingsSurfaceProjection(input = {}) {
  if (!isPlainObject(input)) input = {};
  const runtime = summarizeRuntime(input.runtimeStatus);
  const registry = summarizeRegistry(input.registryAudit);
  const workThreads = summarizeWorkThreads(input.workThreads || input);
  const workThreadControl = summarizeWorkThreadControlDeck(input.workThreadControlDeck || input.workThreadControl || input);
  const clarificationTargetPicker = summarizeClarificationTargetPicker(input.clarificationTargetPicker || input.targetPicker || input);
  const operatorBroker = summarizeOperatorBroker(input.operatorBroker || input.operatorBrokerResolution || input.operatorBrokerProjection || input);
  const governance = summarizeGovernance(input);
  const modules = summarizeModules(input.moduleStatus);
  const agentClasses = summarizeAgentClasses(input.agentClassStatus);
  const continuity = summarizeContinuity(input);
  const contextPreview = summarizeContextPreview(input.contextPreview || input.contextPacketPreview || input.directContextPreview || input);
  const agentUsage = summarizeAgentUsage(input.agentUsageStatus || input.agentUsageProjection || input.directAgentUsage || input);
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const authority = {
    displayOnly: true,
    rendererSafe: true,
    runtimeMutationAllowed: false,
    routingEnforced: false,
    semanticBrokerEnforced: false,
    moduleExecutionAllowed: false,
    memoryEditingAllowed: false,
    memoryResetAllowed: false,
    manualCompactActionAllowed: false,
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    requestAssemblyAuthorityGranted: false,
    contextPreviewEditingAllowed: false,
    workspaceMutationAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const sections = { runtime, registry, workThreads, workThreadControl, clarificationTargetPicker, operatorBroker, governance, modules, agentClasses, continuity, contextPreview, agentUsage };
  const sourceDigest = digestFor("direct-settings-surface-source@1", sections);
  const projection = {
    schema: DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA,
    surfaceSchema: DIRECT_SETTINGS_SURFACE_SCHEMA,
    projectionId: normalizeString(input.projectionId, `direct_settings_surface_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, input.runtimeStatus?.projectId || ""),
    generatedAt,
    mode: "status_only",
    bridgeOrgans: [
      "runtime",
      "registry",
      "work_thread",
      "work_thread_control",
      "clarification_target_picker",
      "operator_broker",
      "governance",
      "skills_hooks_apps",
      "agent_class_specs",
      "memory_baton_omission_compaction",
      "context_packet_preview",
      "direct_agent_usage",
    ],
    sections,
    rows: buildRows(sections),
    authority,
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "direct_settings_surface_is_read_only",
    },
    evidenceRefs: [
      { kind: "registry_audit", digest: normalizeString(input.registryAudit?.summary?.valid === false ? "" : input.registryAudit?.generatedAt, ""), label: "Direct information bridge registry" },
      { kind: "runtime_status", digest: normalizeString(input.runtimeStatus?.sourceDigest || input.runtimeStatus?.statusDigest, ""), label: "Direct runtime status" },
      { kind: "work_thread_projection", digest: normalizeString(workThreads.projectionDigest, ""), label: "WorkThread projection" },
      { kind: "work_thread_control_deck", digest: normalizeString(workThreadControl.controlDeckDigest, ""), label: "WorkThread control deck" },
      { kind: "clarification_target_picker", digest: normalizeString(clarificationTargetPicker.targetPickerDigest, ""), label: "Clarification target picker" },
      { kind: "operator_broker_resolution", digest: normalizeString(operatorBroker.brokerResolutionDigest, ""), label: "Operator broker resolution" },
      { kind: "module_status", digest: normalizeString(input.moduleStatus?.projectionDigest, ""), label: "Bridge module status" },
      { kind: "agent_class_status", digest: normalizeString(input.agentClassStatus?.projectionDigest, ""), label: "Agent class status" },
      { kind: "continuity_status", digest: normalizeString(input.continuityStatus?.projectionDigest, ""), label: "Continuity status" },
      { kind: "context_packet_preview", digest: normalizeString(contextPreview.previewDigest, ""), label: "Context packet preview" },
      { kind: "direct_agent_usage", digest: normalizeString(agentUsage.projectionDigest || agentUsage.ledgerDigest, ""), label: "Direct agent usage summary" },
    ].filter((ref) => ref.digest || ref.kind === "registry_audit"),
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-settings-surface-projection@1", projection);
  return projection;
}

function assertDirectSettingsSurfaceRendererSafe(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA) {
    throw new Error("direct_settings_surface_projection_schema_mismatch");
  }
  const authority = objectOrEmpty(projection.authority);
  const forbiddenTrueFlags = [
    "runtimeMutationAllowed",
    "routingEnforced",
    "semanticBrokerEnforced",
    "moduleExecutionAllowed",
    "memoryEditingAllowed",
    "memoryResetAllowed",
    "manualCompactActionAllowed",
    "providerCompactionAllowed",
    "providerTransportAllowed",
    "requestAssemblyAuthorityGranted",
    "contextPreviewEditingAllowed",
    "workspaceMutationAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_settings_surface_not_display_only");
  }
  for (const flag of forbiddenTrueFlags) {
    if (authority[flag] !== false) throw new Error(`direct_settings_surface_authority_leak:${flag}`);
  }
  if (projection.rawTextIncluded !== false || projection.rawPathIncluded !== false || projection.rawSecretIncluded !== false) {
    throw new Error("direct_settings_surface_raw_exposure");
  }
  if (projection.actionability?.actionable !== false) {
    throw new Error("direct_settings_surface_actionable");
  }
  return true;
}

module.exports = {
  DIRECT_SETTINGS_SURFACE_PROJECTION_SCHEMA,
  DIRECT_SETTINGS_SURFACE_SCHEMA,
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
  stableStringify,
};
