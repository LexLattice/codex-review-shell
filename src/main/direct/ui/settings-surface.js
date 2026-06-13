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

function buildRows(sections) {
  const runtime = sections.runtime;
  const registry = sections.registry;
  const workThreads = sections.workThreads;
  const operatorBroker = sections.operatorBroker;
  const governance = sections.governance;
  const modules = sections.modules;
  const agentClasses = sections.agentClasses;
  const continuity = sections.continuity;
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
  };
}

function buildDirectSettingsSurfaceProjection(input = {}) {
  if (!isPlainObject(input)) input = {};
  const runtime = summarizeRuntime(input.runtimeStatus);
  const registry = summarizeRegistry(input.registryAudit);
  const workThreads = summarizeWorkThreads(input.workThreads || input);
  const operatorBroker = summarizeOperatorBroker(input.operatorBroker || input.operatorBrokerResolution || input.operatorBrokerProjection || input);
  const governance = summarizeGovernance(input);
  const modules = summarizeModules(input.moduleStatus);
  const agentClasses = summarizeAgentClasses(input.agentClassStatus);
  const continuity = summarizeContinuity(input);
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
    workspaceMutationAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const sections = { runtime, registry, workThreads, operatorBroker, governance, modules, agentClasses, continuity };
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
      "operator_broker",
      "governance",
      "skills_hooks_apps",
      "agent_class_specs",
      "memory_baton_omission_compaction",
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
      { kind: "operator_broker_resolution", digest: normalizeString(operatorBroker.brokerResolutionDigest, ""), label: "Operator broker resolution" },
      { kind: "module_status", digest: normalizeString(input.moduleStatus?.projectionDigest, ""), label: "Bridge module status" },
      { kind: "agent_class_status", digest: normalizeString(input.agentClassStatus?.projectionDigest, ""), label: "Agent class status" },
      { kind: "continuity_status", digest: normalizeString(input.continuityStatus?.projectionDigest, ""), label: "Continuity status" },
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
