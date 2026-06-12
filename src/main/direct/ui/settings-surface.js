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
  return {
    available: status.available === true || projection.schema === "direct_work_thread_projection@1",
    availabilityReason: normalizeString(status.reason || input.availabilityReason, status.available === false ? "not_wired" : ""),
    workThreadCount: Number(status.workThreadCount || projection.rowCount || 0),
    activeCount: Number(status.activeCount || projection.activeCount || 0),
    projectionDigest: normalizeString(status.projectionDigest || projection.projectionDigest, ""),
    resolutionState: normalizeString(resolution.resolutionState, "unavailable"),
    selectedWorkThreadId: normalizeString(resolution.selectedWorkThreadId, ""),
    candidateCount: arrayOrEmpty(resolution.candidates).length,
    ambiguityBlockers: arrayOrEmpty(resolution.ambiguityBlockers).map((item) => normalizeString(item, "")).filter(Boolean),
    routingEnforced: resolution.transitionLaw?.routingEnforced === true,
    mutationAllowed: resolution.transitionLaw?.mutationAllowed === true,
    providerCallAllowed: resolution.transitionLaw?.providerCallAllowed === true,
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
    executionAllowedInThisPr: status.executionAllowedInThisPr === true,
    actionable: status.actionable === true,
    rendererSafeSummary: boundedString(status.rendererSafeSummary || "Skills, hooks, and apps are classified but not executable.", 320),
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
    memoryState: normalizeString(continuity.memoryState, runtimeContext.memoryState || "none"),
    batonState: normalizeString(continuity.batonState, runtimeContext.batonState || "not_required"),
    omissionState: normalizeString(continuity.omissionState, runtimeContext.omissionState || "none"),
    providerCompactionState: normalizeString(continuity.providerCompactionState, runtimeContext.providerCompactState || "not_requested"),
    displayOnly: continuity.displayOnly !== false,
    compactActionAllowed: continuity.compactActionAllowed === true || runtimeContext.compactActionAllowed === true,
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
  const governance = sections.governance;
  const modules = sections.modules;
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
      statusRow("Routing", workThreads.routingEnforced ? "unexpected enforce" : "shadow only", workThreads.routingEnforced ? "blocked" : "ok"),
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
      statusRow("Execution", modules.executionAllowedInThisPr ? "unexpected enabled" : "disabled", modules.executionAllowedInThisPr ? "blocked" : "ok"),
    ],
    continuity: [
      statusRow("Transition", continuity.transitionStatus),
      statusRow("Context loss", continuity.contextLossState),
      statusRow("Memory", continuity.memoryState),
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
  const governance = summarizeGovernance(input);
  const modules = summarizeModules(input.moduleStatus);
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
    providerCompactionAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const sections = { runtime, registry, workThreads, governance, modules, continuity };
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
      "governance",
      "skills_hooks_apps",
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
      { kind: "module_status", digest: normalizeString(input.moduleStatus?.projectionDigest, ""), label: "Bridge module status" },
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
