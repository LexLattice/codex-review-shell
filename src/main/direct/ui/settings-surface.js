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

function summarizeAppServerFallbackParity(input = {}) {
  const report = objectOrEmpty(input.appServerFallbackParityReport || input.appServerFallbackParity || input.runtimeStatus?.appServerFallbackParity || input);
  const fallback = objectOrEmpty(report.appServerFallback);
  const direct = objectOrEmpty(report.directFailurePosture);
  const reload = objectOrEmpty(report.reloadReconnectPosture);
  const startup = objectOrEmpty(report.startupFailurePosture);
  const authority = objectOrEmpty(report.authority);
  return {
    available: normalizeString(report.schema, "") === "direct_appserver_fallback_parity_report@1",
    schema: normalizeString(report.schema, "not_exposed"),
    parityState: normalizeString(report.parityState, "unavailable"),
    selectedLane: normalizeString(report.selectedLane, "unknown"),
    fallbackAvailable: fallback.available === true,
    fallbackStatus: normalizeString(fallback.status, "unknown"),
    startupPosture: normalizeString(startup.startupPosture || fallback.startupPosture, "unknown"),
    failurePosture: normalizeString(startup.failurePosture || fallback.failurePosture, "unknown"),
    reloadPosture: normalizeString(reload.reloadPosture || fallback.reloadPosture, "unknown"),
    reconnectPosture: normalizeString(reload.reconnectPosture || fallback.reconnectPosture, "unknown"),
    directBlocked: direct.blocked === true,
    directBlockerCount: arrayOrEmpty(direct.blockerCodes).length,
    silentRerouteDetected: direct.silentRerouteDetected === true,
    fallbackHidden: direct.fallbackHidden === true,
    blockerCodes: arrayOrEmpty(report.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    providerTransportAllowed: authority.providerTransportAllowed === true,
    appServerSpawnAllowed: authority.appServerSpawnAllowed === true,
    appServerReplacementAllowed: authority.appServerReplacementAllowed === true,
    appServerMutationAllowed: authority.appServerMutationAllowed === true,
    runtimeSelectionMutationAllowed: authority.runtimeSelectionMutationAllowed === true,
    workspaceMutationAllowed: authority.workspaceMutationAllowed === true,
    recursiveWorkerAllowed: authority.recursiveWorkerAllowed === true,
    matrixPromotionAllowed: authority.matrixPromotionAllowed === true,
    reportDigest: normalizeString(report.reportDigest, ""),
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

function summarizeModuleContextIntake(input = {}) {
  const source = objectOrEmpty(input);
  const intake = normalizeString(source.schema, "") === "direct_module_context_intake@1"
    ? source
    : objectOrEmpty(source.moduleContextIntake || source.directModuleContextIntake || source.moduleContextIntakeProjection);
  const counts = objectOrEmpty(intake.counts);
  const authority = objectOrEmpty(intake.authority);
  return {
    available: normalizeString(intake.schema, "") === "direct_module_context_intake@1",
    schema: normalizeString(intake.schema, "not_exposed"),
    intakeState: normalizeString(intake.intakeState, "unavailable"),
    rowCount: Number(counts.rowCount ?? arrayOrEmpty(intake.rows).length ?? 0),
    acceptedRowCount: Number(counts.acceptedRowCount ?? 0),
    rejectedRowCount: Number(counts.rejectedRowCount ?? 0),
    blockedRowCount: Number(counts.blockedRowCount ?? 0),
    pendingReviewRowCount: Number(counts.pendingReviewRowCount ?? 0),
    contextEligibleRowCount: Number(counts.contextEligibleRowCount ?? 0),
    importedEvidenceRowCount: Number(counts.importedEvidenceRowCount ?? 0),
    rawExposureUnsafeCount: Number(counts.rawExposureUnsafeCount ?? 0),
    acceptedContextPreviewRowCount: Number(counts.acceptedContextPreviewRowCount ?? arrayOrEmpty(intake.acceptedContextPreviewRows).length ?? 0),
    tokenEstimateTotal: Number(counts.tokenEstimateTotal ?? 0),
    sizeBytesTotal: Number(counts.sizeBytesTotal ?? 0),
    contextPacketMutationAllowed: authority.contextPacketMutationAllowed === true,
    connectorMutationAllowed: authority.connectorMutationAllowed === true,
    hookExecutionAllowed: authority.hookExecutionAllowed === true,
    autoInvocationAllowed: authority.autoInvocationAllowed === true,
    workspaceMutationAllowed: authority.workspaceMutationAllowed === true,
    providerTransportAllowed: authority.providerTransportAllowed === true,
    moduleExecutionAllowed: authority.moduleExecutionAllowed === true,
    intakeDigest: normalizeString(intake.intakeDigest, ""),
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

function summarizeToolCapabilities(toolCapabilityStatus = {}) {
  const source = objectOrEmpty(toolCapabilityStatus);
  const status = normalizeString(source.schema, "") === "direct_tool_capability_status_projection@1"
    ? source
    : objectOrEmpty(source.toolCapabilityStatus || source.toolCapabilityProjection || source.directToolCapabilityStatus);
  return {
    schema: normalizeString(status.schema, ""),
    status: normalizeString(status.status, "not_exposed"),
    rowCount: Number(status.rowCount || 0),
    registryId: normalizeString(status.registryId, ""),
    registryDigest: normalizeString(status.registryDigest, ""),
    upstreamCodexTag: normalizeString(status.upstreamCodexTag, "unknown"),
    byFamily: objectOrEmpty(status.byFamily),
    byPromotionState: objectOrEmpty(status.byPromotionState),
    byImplementationState: objectOrEmpty(status.byImplementationState),
    byProviderDeclarationState: objectOrEmpty(status.byProviderDeclarationState),
    providerDeclaredCount: Number(status.providerDeclaredCount || 0),
    localExecutorCount: Number(status.localExecutorCount || 0),
    directRestrictedCount: Number(status.directRestrictedCount || 0),
    unsupportedCount: Number(status.unsupportedCount || 0),
    deferredExternalAuthorityCount: Number(status.deferredExternalAuthorityCount || 0),
    providerDeclarationsEnabledInThisPr: status.providerDeclarationsEnabledInThisPr === true,
    localExecutionEnabledInThisPr: status.localExecutionEnabledInThisPr === true,
    authorityGateEnabledInThisPr: status.authorityGateEnabledInThisPr === true,
    requestShapeMutationEnabledInThisPr: status.requestShapeMutationEnabledInThisPr === true,
    actionable: status.actionable === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Tool capabilities are mapped as a constitution only.", 360),
  };
}

function summarizeControlToolSubstrate(controlToolStatus = {}) {
  const source = objectOrEmpty(controlToolStatus);
  const status = normalizeString(source.schema, "") === "direct_control_tool_substrate_status@1"
    ? source
    : objectOrEmpty(source.controlToolStatus || source.controlToolSubstrateStatus || source.directControlToolStatus);
  const tools = objectOrEmpty(status.tools);
  return {
    schema: normalizeString(status.schema, ""),
    status: normalizeString(status.status, "not_exposed"),
    rowCount: Number(status.rowCount || 0),
    executableToolCount: Number(status.executableToolCount || 0),
    providerDeclaredToolCount: Number(status.providerDeclaredToolCount || 0),
    localExecutorEnabledInThisPr: status.localExecutorEnabledInThisPr === true,
    providerDeclarationEnabledInThisPr: status.providerDeclarationEnabledInThisPr === true,
    authorityGateEnabledInThisPr: status.authorityGateEnabledInThisPr === true,
    workspaceMutationAllowed: status.workspaceMutationAllowed === true,
    agentSpawnAllowed: status.agentSpawnAllowed === true,
    externalToolExecutionAllowed: status.externalToolExecutionAllowed === true,
    newContextBlocked: status.newContextBlocked === true || tools.newContext?.state === "blocked",
    freeTextCanWidenAuthority: status.freeTextCanWidenAuthority === true,
    planMayAuthorizeAction: status.planMayAuthorizeAction === true,
    imageProviderVisibilityState: normalizeString(status.imageProviderVisibilityState || tools.viewImage?.providerVisibilityState, "unknown"),
    contextEstimateUsableFor: normalizeString(status.contextEstimateUsableFor || tools.getContextRemaining?.usableFor, "unknown"),
    contextTokensLeft: tools.getContextRemaining?.tokensLeft === null || tools.getContextRemaining?.tokensLeft === undefined ? null : Number(tools.getContextRemaining.tokensLeft),
    planStatus: normalizeString(tools.updatePlan?.status, "unknown"),
    humanDecisionChoiceCount: Number(tools.requestUserInput?.boundedChoiceCount || 0),
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Control/perception/human-decision tool substrate is not exposed.", 360),
    statusDigest: normalizeString(status.statusDigest, ""),
  };
}

function summarizeAgentRuntimeSubstrate(agentRuntimeStatus = {}) {
  const source = objectOrEmpty(agentRuntimeStatus);
  const status = normalizeString(source.schema, "") === "direct_agent_runtime_substrate_status@1"
    ? source
    : objectOrEmpty(source.agentRuntimeStatus || source.agentRuntimeSubstrateStatus || source.directAgentRuntimeStatus);
  return {
    available: normalizeString(status.schema, "") === "direct_agent_runtime_substrate_status@1",
    schema: normalizeString(status.schema, "not_exposed"),
    mode: normalizeString(status.mode, "not_exposed"),
    registryId: normalizeString(status.registryId, ""),
    registryDigest: normalizeString(status.registryDigest, ""),
    graphId: normalizeString(status.graphId, ""),
    graphDigest: normalizeString(status.graphDigest, ""),
    mailboxId: normalizeString(status.mailboxId, ""),
    mailboxDigest: normalizeString(status.mailboxDigest, ""),
    lifecycleRegistryId: normalizeString(status.lifecycleRegistryId, ""),
    lifecycleRegistryDigest: normalizeString(status.lifecycleRegistryDigest, ""),
    nodeCount: Number(status.nodeCount || 0),
    edgeCount: Number(status.edgeCount || 0),
    mailboxMessageCount: Number(status.mailboxMessageCount || 0),
    duplicateMailboxMessageCount: Number(status.duplicateMailboxMessageCount || 0),
    mailboxSequenceValid: status.mailboxSequenceValid === true,
    mailboxSequenceViolationCount: Number(status.mailboxSequenceViolationCount || 0),
    lifecycleEntryCount: Number(status.lifecycleEntryCount || 0),
    activeAgentCount: Number(status.activeAgentCount || 0),
    terminalAgentCount: Number(status.terminalAgentCount || 0),
    unknownRecoveryCount: Number(status.unknownRecoveryCount || 0),
    recoveryClasses: arrayOrEmpty(status.recoveryClasses).map((item) => normalizeString(item, "")).filter(Boolean),
    canonicalGraphEvidence: status.canonicalGraphEvidence === true,
    subAgentPanelProjectionOnly: status.subAgentPanelProjectionOnly === true,
    childTranscriptPromotionAllowed: status.childTranscriptPromotionAllowed === true,
    parentSpawnIntentMayClaimChildSuccess: status.parentSpawnIntentMayClaimChildSuccess === true,
    agentSpawnPlanExists: status.agentSpawnPlanExists === true,
    agentSpawnExecutable: status.agentSpawnExecutable === true,
    agentContextPacketFamilyExists: status.agentContextPacketFamilyExists === true,
    agentAuthorityBoundaryExplicit: status.agentAuthorityBoundaryExplicit === true,
    mailboxSequenceLaw: normalizeString(status.mailboxSequenceLaw, "unknown"),
    mailboxIdempotencyLaw: normalizeString(status.mailboxIdempotencyLaw, "unknown"),
    providerSpawnEnabledInThisPr: status.providerSpawnEnabledInThisPr === true,
    localSpawnEnabledInThisPr: status.localSpawnEnabledInThisPr === true,
    providerDeclarationEnabledInThisPr: status.providerDeclarationEnabledInThisPr === true,
    requestShapeMutationEnabledInThisPr: status.requestShapeMutationEnabledInThisPr === true,
    recursiveSpawnEnabledInThisPr: status.recursiveSpawnEnabledInThisPr === true,
    waitToolEnabledInThisPr: status.waitToolEnabledInThisPr === true,
    sendMessageToolEnabledInThisPr: status.sendMessageToolEnabledInThisPr === true,
    interruptToolEnabledInThisPr: status.interruptToolEnabledInThisPr === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Agent runtime substrate is not exposed.", 360),
    statusDigest: normalizeString(status.statusDigest, ""),
  };
}

function summarizeTextSubAgentToolSurface(agentToolSurface = {}) {
  const source = objectOrEmpty(agentToolSurface);
  const status = normalizeString(source.schema, "") === "direct_text_sub_agent_tool_surface@1"
    ? source
    : objectOrEmpty(source.agentToolSurface || source.textSubAgentToolSurface || source.directTextSubAgentToolSurface);
  return {
    available: normalizeString(status.schema, "") === "direct_text_sub_agent_tool_surface@1",
    schema: normalizeString(status.schema, "not_exposed"),
    mode: normalizeString(status.mode, "not_exposed"),
    surfaceId: normalizeString(status.surfaceId, ""),
    surfaceDigest: normalizeString(status.surfaceDigest, ""),
    graphId: normalizeString(status.graphId, ""),
    mailboxId: normalizeString(status.mailboxId, ""),
    listRowCount: Number(status.listProjection?.rowCount || 0),
    activeCount: Number(status.listProjection?.activeCount || 0),
    terminalCount: Number(status.listProjection?.terminalCount || 0),
    spawnAccepted: status.spawnRequest?.acceptedAsTextOnlyIntent === true,
    spawnBlockerCodes: arrayOrEmpty(status.spawnRequest?.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    waitBounded: status.waitPlan?.noDeadlockLawSatisfied === true,
    waitCycleCheck: normalizeString(status.waitPlan?.cycleCheck, "unknown"),
    waitTargetMissingCount: Number(status.waitPlan?.targetMissingCount || 0),
    waitTimeoutMs: Number(status.waitPlan?.timeoutMs || 0),
    sendCanAppend: status.sendMessagePlan?.canAppend === true,
    followupCanAppend: status.followupTaskPlan?.canAppend === true,
    interruptMarkRequestedAllowed: status.interruptRequest?.markRequestedAllowed === true,
    interruptProviderCancelAllowed: status.interruptRequest?.providerCancelAllowed === true,
    listAgentsToolEnabledInThisPr: status.listAgentsToolEnabledInThisPr === true,
    spawnAgentTextOnlyEnabledInThisPr: status.spawnAgentTextOnlyEnabledInThisPr === true,
    waitAgentToolEnabledInThisPr: status.waitAgentToolEnabledInThisPr === true,
    sendMessageToolEnabledInThisPr: status.sendMessageToolEnabledInThisPr === true,
    followupTaskToolEnabledInThisPr: status.followupTaskToolEnabledInThisPr === true,
    interruptAgentMarkRequestedEnabledInThisPr: status.interruptAgentMarkRequestedEnabledInThisPr === true,
    interruptAgentProviderCancelEnabledInThisPr: status.interruptAgentProviderCancelEnabledInThisPr === true,
    childToolsAllowed: status.childToolsAllowed === true,
    recursiveSpawnAllowed: status.recursiveSpawnAllowed === true,
    inheritedParentAuthorityAllowed: status.inheritedParentAuthorityAllowed === true,
    providerDeclarationAllowed: status.providerDeclarationAllowed === true,
    providerTransportAllowed: status.providerTransportAllowed === true,
    requestShapeMutationAllowed: status.requestShapeMutationAllowed === true,
    childTranscriptPromotionAllowed: status.childTranscriptPromotionAllowed === true,
    parentSpawnIntentMayClaimChildSuccess: status.parentSpawnIntentMayClaimChildSuccess === true,
    separateUsageAttributionRequired: status.separateUsageAttributionRequired === true,
    rawPromptIncluded: status.rawPromptIncluded === true,
    rawTranscriptIncluded: status.rawTranscriptIncluded === true,
    rawProviderFrameIncluded: status.rawProviderFrameIncluded === true,
    rawSecretIncluded: status.rawSecretIncluded === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Text-only sub-agent tool surface is not exposed.", 360),
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

function summarizeMemoryWorkbench(input = {}) {
  const source = objectOrEmpty(input);
  const workbench = normalizeString(source.schema, "") === "direct_memory_review_workbench@1"
    ? source
    : objectOrEmpty(source.memoryWorkbench || source.memoryReviewWorkbench || source.directMemoryWorkbench);
  const counts = objectOrEmpty(workbench.counts);
  const transitions = objectOrEmpty(workbench.transitions);
  const authority = objectOrEmpty(workbench.authority);
  return {
    available: normalizeString(workbench.schema, "") === "direct_memory_review_workbench@1",
    schema: normalizeString(workbench.schema, "not_exposed"),
    workbenchState: normalizeString(workbench.workbenchState, "unavailable"),
    rowCount: Number(counts.rowCount ?? arrayOrEmpty(workbench.rows).length ?? 0),
    reviewRowCount: Number(counts.reviewRowCount ?? 0),
    refreshProposalRowCount: Number(counts.refreshProposalRowCount ?? 0),
    resetRowCount: Number(counts.resetRowCount ?? 0),
    executionTransitionRowCount: Number(counts.executionTransitionRowCount ?? 0),
    contextLossRowCount: Number(counts.contextLossRowCount ?? 0),
    omissionImpactRowCount: Number(counts.omissionImpactRowCount ?? 0),
    staleMemoryEntryCount: Number(counts.staleMemoryEntryCount ?? 0),
    conflictedMemoryEntryCount: Number(counts.conflictedMemoryEntryCount ?? 0),
    omittedItemCount: Number(counts.omittedItemCount ?? 0),
    omittedTokenEstimate: Number(counts.omittedTokenEstimate ?? 0),
    blockedRowCount: Number(counts.blockedRowCount ?? 0),
    rawExposureUnsafeCount: Number(counts.rawExposureUnsafeCount ?? 0),
    acceptedRefreshVisible: transitions.acceptedRefreshVisible === true,
    rejectedRefreshVisible: transitions.rejectedRefreshVisible === true,
    localMaterializationWitnessVisible: transitions.localMaterializationWitnessVisible === true,
    rollbackPostureVisible: transitions.rollbackPostureVisible === true,
    resetWorkflowVisible: transitions.resetWorkflowVisible === true,
    resetExecutionAllowed: transitions.resetExecutionAllowed === true,
    memoryMutationAllowed: authority.memoryMutationAllowed === true,
    providerMemoryClaimAccepted: authority.providerMemoryClaimAccepted === true,
    providerCompactionAllowed: authority.providerCompactionAllowed === true,
    automaticRefreshAllowed: authority.automaticRefreshAllowed === true,
    providerTransportAllowed: authority.providerTransportAllowed === true,
    workspaceMutationAllowed: authority.workspaceMutationAllowed === true,
    workbenchDigest: normalizeString(workbench.workbenchDigest, ""),
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

function summarizeRuntimeWitness(input = {}) {
  const source = objectOrEmpty(input);
  const witness = normalizeString(source.schema, "") === "direct_runtime_witness_projection@1"
    ? source
    : objectOrEmpty(source.runtimeWitnessProjection || source.runtimeWitness || source.directRuntimeWitness);
  const chips = arrayOrEmpty(witness.chips);
  const chipByKind = (kind) => chips.find((chip) => normalizeString(chip.kind, "") === kind) || {};
  const stateFor = (kind) => normalizeString(chipByKind(kind).state, witness.schema ? "unknown" : "unavailable");
  const labelFor = (kind, fallback) => normalizeString(chipByKind(kind).label, fallback);
  const countStates = (states) => chips.filter((chip) => states.includes(normalizeString(chip.state, "unknown"))).length;
  return {
    available: normalizeString(witness.schema, "") === "direct_runtime_witness_projection@1",
    schema: normalizeString(witness.schema, "not_exposed"),
    chipCount: chips.length,
    modelState: stateFor("model"),
    modelLabel: labelFor("model", "Model unknown"),
    reasoningState: stateFor("reasoning"),
    reasoningLabel: labelFor("reasoning", "Reasoning unknown"),
    quotaState: stateFor("quota"),
    quotaLabel: labelFor("quota", "Quota/rate unknown"),
    usageState: stateFor("usage"),
    usageLabel: labelFor("usage", "Usage unknown"),
    driftState: stateFor("drift"),
    driftLabel: labelFor("drift", "Drift unknown"),
    unknownCount: countStates(["unknown"]),
    staleCount: countStates(["expired", "expiring"]),
    blockedCount: countStates(["blocked"]),
    diagnosticCount: countStates(["diagnostic"]),
    costComputed: witness.costComputed === true || witness.billingGrade === true,
    providerTransportAllowed: witness.providerTransportAllowed === true,
    quotaReadAllowed: witness.quotaReadAllowed === true,
    modelMutationAllowed: witness.modelMutationAllowed === true,
    costComputationAllowed: witness.costComputationAllowed === true,
    projectionDigest: normalizeString(witness.integrity?.artifactDigest || witness.projectionDigest, ""),
  };
}

function summarizeManualSmokeGate(input = {}) {
  const source = objectOrEmpty(input);
  const gate = normalizeString(source.schema, "") === "direct_manual_smoke_gate@1"
    ? source
    : objectOrEmpty(source.manualSmokeGate || source.directManualSmokeGate || source.manualSmokeGateProjection);
  const counts = objectOrEmpty(gate.counts);
  const authority = objectOrEmpty(gate.authority);
  return {
    available: normalizeString(gate.schema, "") === "direct_manual_smoke_gate@1",
    schema: normalizeString(gate.schema, "not_exposed"),
    gateState: normalizeString(gate.gateState, "unavailable"),
    rowCount: Number(counts.rowCount ?? arrayOrEmpty(gate.rows).length ?? 0),
    passedCount: Number(counts.passedCount ?? 0),
    blockedCount: Number(counts.blockedCount ?? 0),
    warningCount: Number(counts.warningCount ?? 0),
    notCheckedCount: Number(counts.notCheckedCount ?? 0),
    requiredBlockedCount: Number(counts.requiredBlockedCount ?? 0),
    blockerCodes: arrayOrEmpty(gate.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    coverageSource: normalizeString(gate.coverageSource, "unknown"),
    matrixPromotionCandidate: gate.matrixPromotionCandidate === true,
    electronRunnerAvailable: gate.electronRunner?.available === true,
    manualSmokeExecutionAllowed: authority.manualSmokeExecutionAllowed === true,
    runtimePathMutationAllowed: authority.runtimePathMutationAllowed === true,
    workThreadMutationAllowed: authority.workThreadMutationAllowed === true,
    providerTransportAllowed: authority.providerTransportAllowed === true,
    workspaceMutationAllowed: authority.workspaceMutationAllowed === true,
    appServerReplacementAllowed: authority.appServerReplacementAllowed === true,
    autoApprovalAllowed: authority.autoApprovalAllowed === true,
    moduleExecutionAllowed: authority.moduleExecutionAllowed === true,
    recursiveWorkerAllowed: authority.recursiveWorkerAllowed === true,
    matrixPromotionAllowed: authority.matrixPromotionAllowed === true,
    gateDigest: normalizeString(gate.gateDigest, ""),
  };
}

function summarizeHeadlessDaemon(input = {}) {
  const source = objectOrEmpty(input);
  const daemon = normalizeString(source.schema, "") === "bridge_daemon_status_projection@1"
    ? source
    : objectOrEmpty(source.headlessDaemonStatus || source.headlessBridgeStatus || source.bridgeDaemonStatus || source.runtimeStatus?.headlessDaemonStatus || source.runtimeStatus?.headlessBridgeStatus);
  const control = objectOrEmpty(daemon.control);
  const textRuntime = objectOrEmpty(daemon.textRuntime);
  const turnRuntime = objectOrEmpty(daemon.turnRuntime);
  const turnPackets = objectOrEmpty(daemon.turnPackets);
  const reducedResults = objectOrEmpty(daemon.reducedResults);
  return {
    available: normalizeString(daemon.schema, "") === "bridge_daemon_status_projection@1",
    schema: normalizeString(daemon.schema, "not_exposed"),
    daemonState: normalizeString(daemon.daemonState, "unavailable"),
    activeRoutes: Number(daemon.activeRoutes ?? 0),
    registeredClients: Number(daemon.registeredClients ?? 0),
    inboxEvents: Number(daemon.inboxEvents ?? 0),
    queuedInboxEvents: Number(daemon.queuedInboxEvents ?? 0),
    activeTurns: Number(textRuntime.activeTurns ?? turnRuntime.activeTurns ?? daemon.activeTurns ?? 0),
    queuedTurns: Number(textRuntime.queuedTurns ?? turnRuntime.queuedTurns ?? 0),
    queuedEgressActions: Number(daemon.queuedEgressActions ?? 0),
    failedEgressActions: Number(daemon.failedEgressActions ?? 0),
    pendingDecisions: Number(daemon.pendingHumanDecisions ?? daemon.humanDecisionPendingCount ?? 0),
    turnPacketsWritten: Number(turnPackets.total ?? turnPackets.totalPackets ?? turnPackets.packetCount ?? 0),
    reducedResultsWritten: Number(reducedResults.total ?? reducedResults.totalResults ?? reducedResults.resultCount ?? 0),
    intakeState: normalizeString(control.intakeState, "unknown"),
    drainState: normalizeString(control.drainState, "unknown"),
    shutdownState: normalizeString(control.shutdownState, "unknown"),
    safeControls: arrayOrEmpty(control.safeControls).map((item) => normalizeString(item, "")).filter(Boolean),
    recentControlEventCount: arrayOrEmpty(control.recentEvents).length,
    routeAuthorityMutable: control.routeAuthorityMutable === true,
    providerTransportAllowed: control.providerTransportAllowed === true,
    rawPayloadIncluded: control.rawPayloadIncluded === true || daemon.rawPayloadsExposed === true,
    projectionDigest: normalizeString(daemon.projectionDigest || daemon.sourceDigest, ""),
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
  const moduleContextIntake = sections.moduleContextIntake;
  const agentClasses = sections.agentClasses;
  const toolCapabilities = sections.toolCapabilities;
  const controlTools = sections.controlTools;
  const agentRuntime = sections.agentRuntime;
  const agentToolSurface = sections.agentToolSurface;
  const continuity = sections.continuity;
  const contextPreview = sections.contextPreview;
  const memoryWorkbench = sections.memoryWorkbench;
  const runtimeWitness = sections.runtimeWitness;
  const agentUsage = sections.agentUsage;
  const appServerFallbackParity = sections.appServerFallbackParity;
  const manualSmokeGate = sections.manualSmokeGate;
  const headlessDaemon = sections.headlessDaemon;
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
    moduleContextIntake: [
      statusRow("Surface", moduleContextIntake.available ? "available" : "not exposed", moduleContextIntake.available ? "diagnostic" : "missing"),
      statusRow("Intake", moduleContextIntake.intakeState, moduleContextIntake.intakeState === "ready" ? "ok" : moduleContextIntake.intakeState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Rows", moduleContextIntake.rowCount),
      statusRow("Accepted/rejected", `${moduleContextIntake.acceptedRowCount}/${moduleContextIntake.rejectedRowCount}`),
      statusRow("Pending/blocked", `${moduleContextIntake.pendingReviewRowCount}/${moduleContextIntake.blockedRowCount}`, moduleContextIntake.blockedRowCount ? "blocked" : "ok"),
      statusRow("Context eligible", moduleContextIntake.contextEligibleRowCount),
      statusRow("Imported evidence", moduleContextIntake.importedEvidenceRowCount),
      statusRow("Preview rows", moduleContextIntake.acceptedContextPreviewRowCount),
      statusRow("Token estimate", moduleContextIntake.tokenEstimateTotal),
      statusRow("Size", `${moduleContextIntake.sizeBytesTotal} bytes`),
      statusRow("Raw exposure", moduleContextIntake.rawExposureUnsafeCount, moduleContextIntake.rawExposureUnsafeCount ? "blocked" : "ok"),
      statusRow("Authority", moduleContextIntake.contextPacketMutationAllowed || moduleContextIntake.connectorMutationAllowed || moduleContextIntake.hookExecutionAllowed || moduleContextIntake.autoInvocationAllowed || moduleContextIntake.workspaceMutationAllowed || moduleContextIntake.providerTransportAllowed || moduleContextIntake.moduleExecutionAllowed ? "unexpected grant" : "display only", moduleContextIntake.contextPacketMutationAllowed || moduleContextIntake.connectorMutationAllowed || moduleContextIntake.hookExecutionAllowed || moduleContextIntake.autoInvocationAllowed || moduleContextIntake.workspaceMutationAllowed || moduleContextIntake.providerTransportAllowed || moduleContextIntake.moduleExecutionAllowed ? "blocked" : "ok"),
    ],
    agentClasses: [
      statusRow("Status", agentClasses.status),
      statusRow("Specs", agentClasses.specCount),
      statusRow("Execution", agentClasses.executionEnabledInThisPr ? "unexpected enabled" : "disabled", agentClasses.executionEnabledInThisPr ? "blocked" : "ok"),
      statusRow("Routing", agentClasses.routingEnabledInThisPr ? "unexpected enabled" : "shadow only", agentClasses.routingEnabledInThisPr ? "blocked" : "ok"),
      statusRow("Audit automation", agentClasses.objectAuditAutomationEnabledInThisPr ? "unexpected enabled" : "disabled", agentClasses.objectAuditAutomationEnabledInThisPr ? "blocked" : "ok"),
    ],
    toolCapabilities: [
      statusRow("Surface", toolCapabilities.rowCount ? "available" : "not exposed", toolCapabilities.rowCount ? "diagnostic" : "missing"),
      statusRow("Status", toolCapabilities.status),
      statusRow("Upstream map", toolCapabilities.upstreamCodexTag),
      statusRow("Tool rows", toolCapabilities.rowCount),
      statusRow("Restricted/direct", toolCapabilities.directRestrictedCount),
      statusRow("Unsupported/deferred", `${toolCapabilities.unsupportedCount}/${toolCapabilities.deferredExternalAuthorityCount}`),
      statusRow("Provider-declared rows", toolCapabilities.providerDeclaredCount),
      statusRow("Local executors", toolCapabilities.localExecutorCount),
      statusRow("Families", Object.keys(toolCapabilities.byFamily).length),
      statusRow("Promotion states", Object.keys(toolCapabilities.byPromotionState).length),
      statusRow("Authority", toolCapabilities.providerDeclarationsEnabledInThisPr || toolCapabilities.localExecutionEnabledInThisPr || toolCapabilities.authorityGateEnabledInThisPr || toolCapabilities.requestShapeMutationEnabledInThisPr ? "unexpected grant" : "constitution only", toolCapabilities.providerDeclarationsEnabledInThisPr || toolCapabilities.localExecutionEnabledInThisPr || toolCapabilities.authorityGateEnabledInThisPr || toolCapabilities.requestShapeMutationEnabledInThisPr ? "blocked" : "ok"),
    ],
    controlTools: [
      statusRow("Surface", controlTools.rowCount ? "available" : "not exposed", controlTools.rowCount ? "diagnostic" : "missing"),
      statusRow("Status", controlTools.status),
      statusRow("Tool projections", controlTools.rowCount),
      statusRow("Context remaining", controlTools.contextTokensLeft === null ? "unknown" : controlTools.contextTokensLeft, controlTools.contextEstimateUsableFor === "request_blocking" ? "blocked" : "diagnostic", controlTools.contextEstimateUsableFor),
      statusRow("Plan", controlTools.planStatus, controlTools.planMayAuthorizeAction ? "blocked" : "ok"),
      statusRow("Image visibility", controlTools.imageProviderVisibilityState, controlTools.imageProviderVisibilityState === "image_payload_sent" ? "diagnostic" : "ok"),
      statusRow("Human choices", controlTools.humanDecisionChoiceCount),
      statusRow("New context", controlTools.newContextBlocked ? "blocked" : "unexpected available", controlTools.newContextBlocked ? "ok" : "blocked"),
      statusRow("Execution/provider", `${controlTools.executableToolCount}/${controlTools.providerDeclaredToolCount}`, controlTools.executableToolCount || controlTools.providerDeclaredToolCount ? "blocked" : "ok"),
      statusRow("Authority", controlTools.localExecutorEnabledInThisPr || controlTools.providerDeclarationEnabledInThisPr || controlTools.authorityGateEnabledInThisPr || controlTools.workspaceMutationAllowed || controlTools.agentSpawnAllowed || controlTools.externalToolExecutionAllowed || controlTools.freeTextCanWidenAuthority || controlTools.planMayAuthorizeAction ? "unexpected grant" : "substrate only", controlTools.localExecutorEnabledInThisPr || controlTools.providerDeclarationEnabledInThisPr || controlTools.authorityGateEnabledInThisPr || controlTools.workspaceMutationAllowed || controlTools.agentSpawnAllowed || controlTools.externalToolExecutionAllowed || controlTools.freeTextCanWidenAuthority || controlTools.planMayAuthorizeAction ? "blocked" : "ok"),
    ],
    agentRuntime: [
      statusRow("Surface", agentRuntime.available ? "available" : "not exposed", agentRuntime.available ? "diagnostic" : "missing"),
      statusRow("Mode", agentRuntime.mode),
      statusRow("Graph", agentRuntime.canonicalGraphEvidence ? "canonical evidence" : "not canonical", agentRuntime.canonicalGraphEvidence ? "ok" : "blocked"),
      statusRow("Nodes/edges", `${agentRuntime.nodeCount}/${agentRuntime.edgeCount}`),
      statusRow("Mailbox messages", `${agentRuntime.mailboxMessageCount} · dup ${agentRuntime.duplicateMailboxMessageCount} · seq ${agentRuntime.mailboxSequenceViolationCount}`, agentRuntime.duplicateMailboxMessageCount || !agentRuntime.mailboxSequenceValid || agentRuntime.mailboxSequenceViolationCount ? "blocked" : "ok"),
      statusRow("Lifecycle", `${agentRuntime.activeAgentCount} active / ${agentRuntime.terminalAgentCount} terminal / ${agentRuntime.unknownRecoveryCount} unknown`),
      statusRow("Spawn plan", agentRuntime.agentSpawnPlanExists ? "exists" : "missing", agentRuntime.agentSpawnPlanExists ? "diagnostic" : "blocked"),
      statusRow("Context family", agentRuntime.agentContextPacketFamilyExists ? "exists" : "missing", agentRuntime.agentContextPacketFamilyExists ? "ok" : "blocked"),
      statusRow("Authority boundary", agentRuntime.agentAuthorityBoundaryExplicit ? "explicit" : "missing", agentRuntime.agentAuthorityBoundaryExplicit ? "ok" : "blocked"),
      statusRow("Mailbox law", `${agentRuntime.mailboxSequenceLaw} / ${agentRuntime.mailboxIdempotencyLaw}`),
      statusRow("Recovery classes", agentRuntime.recoveryClasses.length ? agentRuntime.recoveryClasses.slice(0, 6).join(", ") : "none", agentRuntime.recoveryClasses.length ? "diagnostic" : "missing"),
      statusRow("Projection law", agentRuntime.subAgentPanelProjectionOnly && !agentRuntime.childTranscriptPromotionAllowed && !agentRuntime.parentSpawnIntentMayClaimChildSuccess ? "panel only, no flattening" : "unsafe", agentRuntime.subAgentPanelProjectionOnly && !agentRuntime.childTranscriptPromotionAllowed && !agentRuntime.parentSpawnIntentMayClaimChildSuccess ? "ok" : "blocked"),
      statusRow("Authority", agentRuntime.agentSpawnExecutable || agentRuntime.providerSpawnEnabledInThisPr || agentRuntime.localSpawnEnabledInThisPr || agentRuntime.providerDeclarationEnabledInThisPr || agentRuntime.requestShapeMutationEnabledInThisPr || agentRuntime.recursiveSpawnEnabledInThisPr || agentRuntime.waitToolEnabledInThisPr || agentRuntime.sendMessageToolEnabledInThisPr || agentRuntime.interruptToolEnabledInThisPr ? "unexpected grant" : "substrate only", agentRuntime.agentSpawnExecutable || agentRuntime.providerSpawnEnabledInThisPr || agentRuntime.localSpawnEnabledInThisPr || agentRuntime.providerDeclarationEnabledInThisPr || agentRuntime.requestShapeMutationEnabledInThisPr || agentRuntime.recursiveSpawnEnabledInThisPr || agentRuntime.waitToolEnabledInThisPr || agentRuntime.sendMessageToolEnabledInThisPr || agentRuntime.interruptToolEnabledInThisPr ? "blocked" : "ok"),
    ],
    agentToolSurface: [
      statusRow("Surface", agentToolSurface.available ? "available" : "not exposed", agentToolSurface.available ? "diagnostic" : "missing"),
      statusRow("Mode", agentToolSurface.mode),
      statusRow("List", `${agentToolSurface.listRowCount} agents · ${agentToolSurface.activeCount} active / ${agentToolSurface.terminalCount} terminal`, agentToolSurface.listAgentsToolEnabledInThisPr ? "ok" : "missing"),
      statusRow("Text spawn", agentToolSurface.spawnAccepted ? "accepted as intent" : `blocked ${agentToolSurface.spawnBlockerCodes.join(", ") || "unknown"}`, agentToolSurface.spawnAccepted ? "ok" : "blocked"),
      statusRow("Wait", `${agentToolSurface.waitCycleCheck} · missing ${agentToolSurface.waitTargetMissingCount} · ${agentToolSurface.waitTimeoutMs}ms`, agentToolSurface.waitBounded ? "ok" : "blocked"),
      statusRow("Mailbox", `send ${agentToolSurface.sendCanAppend ? "append" : "blocked"} / followup ${agentToolSurface.followupCanAppend ? "append" : "blocked"}`, agentToolSurface.sendCanAppend && agentToolSurface.followupCanAppend ? "ok" : "blocked"),
      statusRow("Interrupt", agentToolSurface.interruptMarkRequestedAllowed ? "mark requested only" : "blocked", agentToolSurface.interruptProviderCancelAllowed ? "blocked" : "diagnostic"),
      statusRow("Usage", agentToolSurface.separateUsageAttributionRequired ? "separate child attribution required" : "missing", agentToolSurface.separateUsageAttributionRequired ? "ok" : "blocked"),
      statusRow("Authority", agentToolSurface.providerTransportAllowed || agentToolSurface.providerDeclarationAllowed || agentToolSurface.requestShapeMutationAllowed || agentToolSurface.recursiveSpawnAllowed || agentToolSurface.childToolsAllowed || agentToolSurface.inheritedParentAuthorityAllowed || agentToolSurface.childTranscriptPromotionAllowed || agentToolSurface.parentSpawnIntentMayClaimChildSuccess || agentToolSurface.interruptProviderCancelAllowed ? "unexpected grant" : "text-only gated", agentToolSurface.providerTransportAllowed || agentToolSurface.providerDeclarationAllowed || agentToolSurface.requestShapeMutationAllowed || agentToolSurface.recursiveSpawnAllowed || agentToolSurface.childToolsAllowed || agentToolSurface.inheritedParentAuthorityAllowed || agentToolSurface.childTranscriptPromotionAllowed || agentToolSurface.parentSpawnIntentMayClaimChildSuccess || agentToolSurface.interruptProviderCancelAllowed ? "blocked" : "ok"),
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
    memoryWorkbench: [
      statusRow("Surface", memoryWorkbench.available ? "available" : "not exposed", memoryWorkbench.available ? "diagnostic" : "missing"),
      statusRow("Workbench", memoryWorkbench.workbenchState, memoryWorkbench.workbenchState === "ready" ? "ok" : memoryWorkbench.workbenchState === "blocked_raw_exposure" ? "blocked" : "diagnostic"),
      statusRow("Rows", memoryWorkbench.rowCount),
      statusRow("Review/refresh", `${memoryWorkbench.reviewRowCount}/${memoryWorkbench.refreshProposalRowCount}`),
      statusRow("Reset rows", memoryWorkbench.resetRowCount),
      statusRow("Execution rows", memoryWorkbench.executionTransitionRowCount),
      statusRow("Context loss / omission", `${memoryWorkbench.contextLossRowCount}/${memoryWorkbench.omissionImpactRowCount}`),
      statusRow("Memory stale/conflict", `${memoryWorkbench.staleMemoryEntryCount}/${memoryWorkbench.conflictedMemoryEntryCount}`, memoryWorkbench.staleMemoryEntryCount || memoryWorkbench.conflictedMemoryEntryCount ? "diagnostic" : "ok"),
      statusRow("Omitted items/tokens", `${memoryWorkbench.omittedItemCount}/${memoryWorkbench.omittedTokenEstimate}`),
      statusRow("Refresh", memoryWorkbench.acceptedRefreshVisible ? "accepted visible" : memoryWorkbench.rejectedRefreshVisible ? "rejected visible" : "not accepted"),
      statusRow("Materialization witness", memoryWorkbench.localMaterializationWitnessVisible ? "visible" : "none", memoryWorkbench.localMaterializationWitnessVisible ? "diagnostic" : "ok"),
      statusRow("Rollback", memoryWorkbench.rollbackPostureVisible ? "visible" : "not visible", memoryWorkbench.rollbackPostureVisible ? "diagnostic" : "ok"),
      statusRow("Reset execution", memoryWorkbench.resetExecutionAllowed ? "unexpected enabled" : "disabled", memoryWorkbench.resetExecutionAllowed ? "blocked" : "ok"),
      statusRow("Blocked/raw", `${memoryWorkbench.blockedRowCount}/${memoryWorkbench.rawExposureUnsafeCount}`, memoryWorkbench.rawExposureUnsafeCount ? "blocked" : "ok"),
      statusRow("Authority", memoryWorkbench.memoryMutationAllowed || memoryWorkbench.providerMemoryClaimAccepted || memoryWorkbench.providerCompactionAllowed || memoryWorkbench.automaticRefreshAllowed || memoryWorkbench.providerTransportAllowed || memoryWorkbench.workspaceMutationAllowed ? "unexpected grant" : "display only", memoryWorkbench.memoryMutationAllowed || memoryWorkbench.providerMemoryClaimAccepted || memoryWorkbench.providerCompactionAllowed || memoryWorkbench.automaticRefreshAllowed || memoryWorkbench.providerTransportAllowed || memoryWorkbench.workspaceMutationAllowed ? "blocked" : "ok"),
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
    runtimeWitness: [
      statusRow("Surface", runtimeWitness.available ? "available" : "not exposed", runtimeWitness.available ? "diagnostic" : "missing"),
      statusRow("Model", `${runtimeWitness.modelLabel} · ${runtimeWitness.modelState}`, runtimeWitness.modelState === "fresh" ? "ok" : runtimeWitness.modelState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Reasoning", `${runtimeWitness.reasoningLabel} · ${runtimeWitness.reasoningState}`, runtimeWitness.reasoningState === "fresh" ? "ok" : runtimeWitness.reasoningState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Quota/rate", `${runtimeWitness.quotaLabel} · ${runtimeWitness.quotaState}`, runtimeWitness.quotaState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Usage", `${runtimeWitness.usageLabel} · ${runtimeWitness.usageState}`, runtimeWitness.usageState === "fresh" ? "ok" : runtimeWitness.usageState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Drift", `${runtimeWitness.driftLabel} · ${runtimeWitness.driftState}`, runtimeWitness.driftState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Unknown/stale/blocked", `${runtimeWitness.unknownCount}/${runtimeWitness.staleCount}/${runtimeWitness.blockedCount}`, runtimeWitness.blockedCount ? "blocked" : runtimeWitness.unknownCount || runtimeWitness.staleCount ? "diagnostic" : "ok"),
      statusRow("Cost", runtimeWitness.costComputed ? "unexpected" : "not computed", runtimeWitness.costComputed ? "blocked" : "ok"),
      statusRow("Authority", runtimeWitness.providerTransportAllowed || runtimeWitness.quotaReadAllowed || runtimeWitness.modelMutationAllowed || runtimeWitness.costComputationAllowed ? "unexpected grant" : "display only", runtimeWitness.providerTransportAllowed || runtimeWitness.quotaReadAllowed || runtimeWitness.modelMutationAllowed || runtimeWitness.costComputationAllowed ? "blocked" : "ok"),
    ],
    appServerFallbackParity: [
      statusRow("Surface", appServerFallbackParity.available ? "available" : "not exposed", appServerFallbackParity.available ? "diagnostic" : "missing"),
      statusRow("Parity", appServerFallbackParity.parityState, appServerFallbackParity.parityState === "blocked" ? "blocked" : appServerFallbackParity.available ? "ok" : "missing"),
      statusRow("Selected lane", appServerFallbackParity.selectedLane),
      statusRow("Fallback", `${appServerFallbackParity.fallbackAvailable ? "visible" : "missing"} · ${appServerFallbackParity.fallbackStatus}`, appServerFallbackParity.fallbackAvailable ? "ok" : "blocked"),
      statusRow("Startup/failure", `${appServerFallbackParity.startupPosture}/${appServerFallbackParity.failurePosture}`, appServerFallbackParity.failurePosture && !["none", "unavailable"].includes(appServerFallbackParity.failurePosture) ? "blocked" : "diagnostic"),
      statusRow("Reload/reconnect", `${appServerFallbackParity.reloadPosture}/${appServerFallbackParity.reconnectPosture}`),
      statusRow("Direct blockers", appServerFallbackParity.directBlockerCount, appServerFallbackParity.directBlocked ? "diagnostic" : "ok"),
      statusRow("Silent reroute", appServerFallbackParity.silentRerouteDetected || appServerFallbackParity.fallbackHidden ? "detected" : "none", appServerFallbackParity.silentRerouteDetected || appServerFallbackParity.fallbackHidden ? "blocked" : "ok"),
      statusRow("Blockers", appServerFallbackParity.blockerCodes.length ? appServerFallbackParity.blockerCodes.slice(0, 6).join(", ") : "none", appServerFallbackParity.blockerCodes.length ? "blocked" : "ok"),
      statusRow("Authority", appServerFallbackParity.providerTransportAllowed || appServerFallbackParity.appServerSpawnAllowed || appServerFallbackParity.appServerReplacementAllowed || appServerFallbackParity.appServerMutationAllowed || appServerFallbackParity.runtimeSelectionMutationAllowed || appServerFallbackParity.workspaceMutationAllowed || appServerFallbackParity.recursiveWorkerAllowed || appServerFallbackParity.matrixPromotionAllowed ? "unexpected grant" : "display only", appServerFallbackParity.providerTransportAllowed || appServerFallbackParity.appServerSpawnAllowed || appServerFallbackParity.appServerReplacementAllowed || appServerFallbackParity.appServerMutationAllowed || appServerFallbackParity.runtimeSelectionMutationAllowed || appServerFallbackParity.workspaceMutationAllowed || appServerFallbackParity.recursiveWorkerAllowed || appServerFallbackParity.matrixPromotionAllowed ? "blocked" : "ok"),
    ],
    manualSmokeGate: [
      statusRow("Surface", manualSmokeGate.available ? "available" : "not exposed", manualSmokeGate.available ? "diagnostic" : "missing"),
      statusRow("Gate", manualSmokeGate.gateState, manualSmokeGate.gateState === "passed" ? "ok" : manualSmokeGate.gateState === "blocked" ? "blocked" : "diagnostic"),
      statusRow("Rows", manualSmokeGate.rowCount),
      statusRow("Passed/warn", `${manualSmokeGate.passedCount}/${manualSmokeGate.warningCount}`, manualSmokeGate.warningCount ? "diagnostic" : "ok"),
      statusRow("Blocked/not checked", `${manualSmokeGate.blockedCount}/${manualSmokeGate.notCheckedCount}`, manualSmokeGate.blockedCount ? "blocked" : "ok"),
      statusRow("Required blocked", manualSmokeGate.requiredBlockedCount, manualSmokeGate.requiredBlockedCount ? "blocked" : "ok"),
      statusRow("Coverage", manualSmokeGate.coverageSource),
      statusRow("Electron runner", manualSmokeGate.electronRunnerAvailable ? "available" : "not invoked", manualSmokeGate.electronRunnerAvailable ? "diagnostic" : "ok"),
      statusRow("Blockers", manualSmokeGate.blockerCodes.length ? manualSmokeGate.blockerCodes.slice(0, 6).join(", ") : "none", manualSmokeGate.blockerCodes.length ? "blocked" : "ok"),
      statusRow("Promotion", manualSmokeGate.matrixPromotionCandidate || manualSmokeGate.matrixPromotionAllowed ? "unexpected" : "not promoted", manualSmokeGate.matrixPromotionCandidate || manualSmokeGate.matrixPromotionAllowed ? "blocked" : "ok"),
      statusRow("Authority", manualSmokeGate.manualSmokeExecutionAllowed || manualSmokeGate.runtimePathMutationAllowed || manualSmokeGate.workThreadMutationAllowed || manualSmokeGate.providerTransportAllowed || manualSmokeGate.workspaceMutationAllowed || manualSmokeGate.appServerReplacementAllowed || manualSmokeGate.autoApprovalAllowed || manualSmokeGate.moduleExecutionAllowed || manualSmokeGate.recursiveWorkerAllowed ? "unexpected grant" : "display only", manualSmokeGate.manualSmokeExecutionAllowed || manualSmokeGate.runtimePathMutationAllowed || manualSmokeGate.workThreadMutationAllowed || manualSmokeGate.providerTransportAllowed || manualSmokeGate.workspaceMutationAllowed || manualSmokeGate.appServerReplacementAllowed || manualSmokeGate.autoApprovalAllowed || manualSmokeGate.moduleExecutionAllowed || manualSmokeGate.recursiveWorkerAllowed ? "blocked" : "ok"),
    ],
    headlessDaemon: [
      statusRow("Surface", headlessDaemon.available ? "available" : "not exposed", headlessDaemon.available ? "diagnostic" : "missing"),
      statusRow("Daemon", headlessDaemon.daemonState, headlessDaemon.daemonState === "ready" ? "ok" : "diagnostic"),
      statusRow("Routes / clients", `${headlessDaemon.activeRoutes}/${headlessDaemon.registeredClients}`),
      statusRow("Inbox queued/events", `${headlessDaemon.queuedInboxEvents}/${headlessDaemon.inboxEvents}`),
      statusRow("Turns active/queued", `${headlessDaemon.activeTurns}/${headlessDaemon.queuedTurns}`),
      statusRow("Outbox queued/failed", `${headlessDaemon.queuedEgressActions}/${headlessDaemon.failedEgressActions}`, headlessDaemon.failedEgressActions ? "blocked" : "ok"),
      statusRow("Decisions pending", headlessDaemon.pendingDecisions, headlessDaemon.pendingDecisions ? "diagnostic" : "ok"),
      statusRow("Packets / results", `${headlessDaemon.turnPacketsWritten}/${headlessDaemon.reducedResultsWritten}`),
      statusRow("Intake", `${headlessDaemon.intakeState} · ${headlessDaemon.drainState}`, headlessDaemon.intakeState === "paused" || headlessDaemon.drainState === "draining" ? "diagnostic" : "ok"),
      statusRow("Shutdown", headlessDaemon.shutdownState, headlessDaemon.shutdownState === "requested" ? "diagnostic" : "ok"),
      statusRow("Controls", headlessDaemon.safeControls.length ? headlessDaemon.safeControls.join(", ") : "none", headlessDaemon.safeControls.length ? "diagnostic" : "missing"),
      statusRow("Control events", headlessDaemon.recentControlEventCount),
      statusRow("Authority", headlessDaemon.routeAuthorityMutable || headlessDaemon.providerTransportAllowed || headlessDaemon.rawPayloadIncluded ? "unexpected grant" : "daemon-local only", headlessDaemon.routeAuthorityMutable || headlessDaemon.providerTransportAllowed || headlessDaemon.rawPayloadIncluded ? "blocked" : "ok"),
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
  const moduleContextIntake = summarizeModuleContextIntake(input.moduleContextIntake || input.directModuleContextIntake || input.moduleContextIntakeProjection || input);
  const agentClasses = summarizeAgentClasses(input.agentClassStatus);
  const toolCapabilities = summarizeToolCapabilities(input.toolCapabilityStatus || input.toolCapabilityProjection || input.directToolCapabilityStatus || input);
  const controlTools = summarizeControlToolSubstrate(input.controlToolStatus || input.controlToolSubstrateStatus || input.directControlToolStatus || input);
  const agentRuntime = summarizeAgentRuntimeSubstrate(input.agentRuntimeStatus || input.agentRuntimeSubstrateStatus || input.directAgentRuntimeStatus || input);
  const agentToolSurface = summarizeTextSubAgentToolSurface(input.agentToolSurfaceStatus || input.textSubAgentToolSurface || input.directTextSubAgentToolSurface || input);
  const continuity = summarizeContinuity(input);
  const contextPreview = summarizeContextPreview(input.contextPreview || input.contextPacketPreview || input.directContextPreview || input);
  const memoryWorkbench = summarizeMemoryWorkbench(input.memoryWorkbench || input.memoryReviewWorkbench || input.directMemoryWorkbench || input);
  const runtimeWitness = summarizeRuntimeWitness(input.runtimeWitnessProjection || input.runtimeWitness || input.directRuntimeWitness || input);
  const agentUsage = summarizeAgentUsage(input.agentUsageStatus || input.agentUsageProjection || input.directAgentUsage || input);
  const appServerFallbackParity = summarizeAppServerFallbackParity(input.appServerFallbackParityReport || input.appServerFallbackParity || input);
  const manualSmokeGate = summarizeManualSmokeGate(input.manualSmokeGate || input.directManualSmokeGate || input.manualSmokeGateProjection || input);
  const headlessDaemon = summarizeHeadlessDaemon(input.headlessDaemonStatus || input.headlessBridgeStatus || input.bridgeDaemonStatus || input);
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const authority = {
    displayOnly: true,
    rendererSafe: true,
    runtimeMutationAllowed: false,
    routingEnforced: false,
    semanticBrokerEnforced: false,
    moduleExecutionAllowed: false,
    moduleContextPacketMutationAllowed: false,
    connectorMutationAllowed: false,
    hookExecutionAllowed: false,
    autoInvocationAllowed: false,
    memoryEditingAllowed: false,
    memoryResetAllowed: false,
    manualCompactActionAllowed: false,
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    requestAssemblyAuthorityGranted: false,
    contextPreviewEditingAllowed: false,
    memoryWorkbenchEditingAllowed: false,
    memoryMutationAllowed: false,
    providerMemoryClaimAccepted: false,
    automaticRefreshAllowed: false,
    workspaceMutationAllowed: false,
    manualSmokeExecutionAllowed: false,
    runtimePathMutationAllowed: false,
    workThreadMutationAllowed: false,
    appServerReplacementAllowed: false,
    autoApprovalAllowed: false,
    recursiveWorkerAllowed: false,
    matrixPromotionAllowed: false,
    toolProviderDeclarationAllowed: false,
    toolLocalExecutionAllowed: false,
    toolAuthorityGateAllowed: false,
    toolRequestShapeMutationAllowed: false,
    controlToolLocalExecutionAllowed: false,
    controlToolProviderDeclarationAllowed: false,
    controlToolAuthorityGateAllowed: false,
    controlToolContextWorldMutationAllowed: false,
    controlToolFreeTextAuthorityAllowed: false,
    controlToolPlanAuthorityAllowed: false,
    agentRuntimeSpawnAllowed: false,
    agentRuntimeProviderDeclarationAllowed: false,
    agentRuntimeRequestShapeMutationAllowed: false,
    agentRuntimeRecursiveSpawnAllowed: false,
    agentRuntimeWaitAllowed: false,
    agentRuntimeSendMessageAllowed: false,
    agentRuntimeInterruptAllowed: false,
    agentToolSurfaceProviderTransportAllowed: false,
    agentToolSurfaceRecursiveSpawnAllowed: false,
    agentToolSurfaceChildToolAllowed: false,
    agentToolSurfaceInterruptProviderCancelAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const sections = { runtime, registry, workThreads, workThreadControl, clarificationTargetPicker, operatorBroker, governance, modules, moduleContextIntake, agentClasses, toolCapabilities, controlTools, agentRuntime, agentToolSurface, continuity, contextPreview, memoryWorkbench, runtimeWitness, agentUsage, appServerFallbackParity, manualSmokeGate, headlessDaemon };
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
      "module_context_intake",
      "agent_class_specs",
      "direct_tool_capability_constitution",
      "control_perception_human_decision_tool_substrate",
      "agent_runtime_substrate",
      "text_only_sub_agent_tool_surface",
      "memory_baton_omission_compaction",
      "context_packet_preview",
      "memory_review_workbench",
      "runtime_witness",
      "direct_agent_usage",
      "appserver_fallback_parity",
      "manual_smoke_gate",
      "headless_daemon",
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
      { kind: "module_context_intake", digest: normalizeString(moduleContextIntake.intakeDigest, ""), label: "Module context intake" },
      { kind: "agent_class_status", digest: normalizeString(input.agentClassStatus?.projectionDigest, ""), label: "Agent class status" },
      { kind: "direct_tool_capability_status", digest: normalizeString(toolCapabilities.registryDigest || input.toolCapabilityStatus?.projectionDigest, ""), label: "Direct tool capability constitution" },
      { kind: "direct_control_tool_substrate_status", digest: normalizeString(controlTools.statusDigest, ""), label: "Control/perception/human-decision tool substrate" },
      { kind: "direct_agent_runtime_substrate_status", digest: normalizeString(agentRuntime.statusDigest, ""), label: "Agent runtime substrate" },
      { kind: "direct_text_sub_agent_tool_surface", digest: normalizeString(agentToolSurface.surfaceDigest, ""), label: "Text-only sub-agent tool surface" },
      { kind: "continuity_status", digest: normalizeString(input.continuityStatus?.projectionDigest, ""), label: "Continuity status" },
      { kind: "context_packet_preview", digest: normalizeString(contextPreview.previewDigest, ""), label: "Context packet preview" },
      { kind: "memory_review_workbench", digest: normalizeString(memoryWorkbench.workbenchDigest, ""), label: "Memory review workbench" },
      { kind: "runtime_witness", digest: normalizeString(runtimeWitness.projectionDigest, ""), label: "Runtime witness projection" },
      { kind: "direct_agent_usage", digest: normalizeString(agentUsage.projectionDigest || agentUsage.ledgerDigest, ""), label: "Direct agent usage summary" },
      { kind: "appserver_fallback_parity", digest: normalizeString(appServerFallbackParity.reportDigest, ""), label: "App-server fallback parity" },
      { kind: "manual_smoke_gate", digest: normalizeString(manualSmokeGate.gateDigest, ""), label: "Direct manual smoke gate" },
      { kind: "headless_daemon", digest: normalizeString(headlessDaemon.projectionDigest, ""), label: "Headless daemon control surface" },
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
    "moduleContextPacketMutationAllowed",
    "connectorMutationAllowed",
    "hookExecutionAllowed",
    "autoInvocationAllowed",
    "memoryEditingAllowed",
    "memoryResetAllowed",
    "manualCompactActionAllowed",
    "providerCompactionAllowed",
    "providerTransportAllowed",
    "requestAssemblyAuthorityGranted",
    "contextPreviewEditingAllowed",
    "memoryWorkbenchEditingAllowed",
    "memoryMutationAllowed",
    "providerMemoryClaimAccepted",
    "automaticRefreshAllowed",
    "workspaceMutationAllowed",
    "manualSmokeExecutionAllowed",
    "runtimePathMutationAllowed",
    "workThreadMutationAllowed",
    "appServerReplacementAllowed",
    "autoApprovalAllowed",
    "recursiveWorkerAllowed",
    "matrixPromotionAllowed",
    "toolProviderDeclarationAllowed",
    "toolLocalExecutionAllowed",
    "toolAuthorityGateAllowed",
    "toolRequestShapeMutationAllowed",
    "controlToolLocalExecutionAllowed",
    "controlToolProviderDeclarationAllowed",
    "controlToolAuthorityGateAllowed",
    "controlToolContextWorldMutationAllowed",
    "controlToolFreeTextAuthorityAllowed",
    "controlToolPlanAuthorityAllowed",
    "agentRuntimeSpawnAllowed",
    "agentRuntimeProviderDeclarationAllowed",
    "agentRuntimeRequestShapeMutationAllowed",
    "agentRuntimeRecursiveSpawnAllowed",
    "agentRuntimeWaitAllowed",
    "agentRuntimeSendMessageAllowed",
    "agentRuntimeInterruptAllowed",
    "agentToolSurfaceProviderTransportAllowed",
    "agentToolSurfaceRecursiveSpawnAllowed",
    "agentToolSurfaceChildToolAllowed",
    "agentToolSurfaceInterruptProviderCancelAllowed",
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
