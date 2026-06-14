"use strict";

const crypto = require("node:crypto");

const DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA = "direct_appserver_fallback_parity_report@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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
    if (typeof value.toJSON === "function") return stableValue(value.toJSON(), seen);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key], seen);
    }
    return output;
  }
  return value;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${JSON.stringify(stableValue(value))}`).digest("hex");
}

function nowIso(input) {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString();
  return normalizeString(input, "") || new Date().toISOString();
}

function normalizeBlockers(values) {
  return safeArray(values).map((value) => normalizeString(value, "")).filter(Boolean);
}

function evidenceRef(kind, refId, state = "present", label = "") {
  return {
    kind: normalizeString(kind, "appserver_fallback_parity"),
    refId: normalizeString(refId, "unknown"),
    state: normalizeString(state, "present"),
    label: normalizeString(label, kind),
    rendererSafe: true,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
  };
}

function normalizedErrorPosture(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return normalizeString(value.code, "") || normalizeString(value.name, "error");
  if (isPlainObject(value)) {
    return normalizeString(value.code, "") ||
      normalizeString(value.name, "") ||
      normalizeString(value.message, "") ||
      "structured_error";
  }
  return "";
}

function fallbackSnapshot(runtimeStatus = {}, input = {}) {
  const explicit = isPlainObject(input.appServerFallback)
    ? input.appServerFallback
    : isPlainObject(input.legacySession)
      ? input.legacySession
      : {};
  const diagnostics = isPlainObject(runtimeStatus.diagnostics) ? runtimeStatus.diagnostics : {};
  const status = normalizeString(
    explicit.status ||
      explicit.state ||
      diagnostics.legacyAppServerStatus,
    diagnostics.legacyAppServerAvailable === true ? "available" : "unknown",
  );
  const readyStatuses = new Set(["ready", "available", "running", "started"]);
  const nonReadyStatuses = new Set(["starting", "exited", "failed", "stopped", "stopping", "closed", "disconnected", "unavailable"]);
  const hasReadyStatus = readyStatuses.has(status);
  const hasNonReadyStatus = nonReadyStatuses.has(status);
  const available = !hasNonReadyStatus && (
    explicit.ready === true ||
    hasReadyStatus ||
    (explicit.available === true && status === "unknown") ||
    (diagnostics.legacyAppServerAvailable === true && status === "unknown")
  );
  return {
    available,
    status: available ? status : status === "unknown" ? "unavailable" : status,
    runtime: normalizeString(explicit.runtime, "unknown"),
    provider: normalizeString(explicit.provider, "unknown"),
    readyUrlAvailable: Boolean(explicit.readyUrl || explicit.wsUrl),
    capabilityProfileAvailable: isPlainObject(explicit.capabilities),
    startupPosture: normalizeString(input.startupPosture || explicit.startupPosture, available ? "observed_available" : "not_observed"),
    failurePosture: normalizeString(input.failurePosture || explicit.failurePosture || normalizedErrorPosture(explicit.error), available ? "none" : "unavailable"),
    reloadPosture: normalizeString(input.reloadPosture || explicit.reloadPosture, "status_only"),
    reconnectPosture: normalizeString(input.reconnectPosture || explicit.reconnectPosture, "status_only"),
  };
}

function selectedLane(runtimeStatus = {}) {
  const path = normalizeString(
    runtimeStatus.selection?.runtimePath ||
      runtimeStatus.directRuntimePath ||
      runtimeStatus.currentRuntimePath ||
      runtimeStatus.runtimeMode,
    "",
  );
  if (path === "legacy-app-server" || path === "app-server") return "app-server";
  if (runtimeStatus.directImplementationLane?.selected === true) return "direct-implementation";
  if (runtimeStatus.directTextOnly?.selected === true) return "direct-text";
  if (normalizeString(runtimeStatus.currentCodexLane, "").toLowerCase().includes("app")) return "app-server";
  if (normalizeString(runtimeStatus.currentCodexLane, "").toLowerCase().includes("direct")) return "direct";
  return path || "unknown";
}

function buildAppServerFallbackParityReport(input = {}) {
  const projectId = normalizeString(input.projectId || input.runtimeStatus?.projectId, "");
  const generatedAt = nowIso(input.generatedAt);
  const runtimeStatus = isPlainObject(input.runtimeStatus) ? input.runtimeStatus : {};
  const lane = selectedLane(runtimeStatus);
  const fallback = fallbackSnapshot(runtimeStatus, input);
  const directBlockers = normalizeBlockers(
    input.directFallbackBlockers ||
      runtimeStatus.directImplementationLane?.blockers ||
      runtimeStatus.directImplementationLane?.missingImplementationOnlyGates,
  );
  const reportBlockers = [];
  if (!fallback.available) reportBlockers.push("app_server_fallback_not_visible");
  if (fallback.status === "failed") reportBlockers.push("app_server_fallback_failed");
  if (fallback.failurePosture && fallback.failurePosture !== "none" && fallback.failurePosture !== "unavailable") reportBlockers.push("app_server_failure_posture_present");
  if (input.directFailureSilentlyRerouted === true) reportBlockers.push("direct_failure_silent_reroute_detected");
  if (input.fallbackHiddenByDirectFailure === true) reportBlockers.push("fallback_hidden_by_direct_failure");
  if (input.stale === true) reportBlockers.push("app_server_fallback_parity_stale");
  const parityState = reportBlockers.length
    ? "blocked"
    : lane === "app-server"
      ? "app_server_selected"
      : "fallback_visible";
  const sourceDigest = digestFor("direct-appserver-fallback-parity-source@1", {
    projectId,
    generatedAt,
    lane,
    fallback,
    directBlockers,
    reportBlockers,
  });
  const report = {
    schema: DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, `direct_appserver_fallback_parity_${sourceDigest.slice(0, 24)}`),
    projectId,
    generatedAt,
    source: "direct-readiness-appserver-fallback-parity",
    selectedLane: lane,
    parityState,
    appServerFallback: fallback,
    directFailurePosture: {
      blockerCodes: directBlockers,
      blocked: directBlockers.length > 0,
      silentRerouteDetected: input.directFailureSilentlyRerouted === true,
      fallbackHidden: input.fallbackHiddenByDirectFailure === true,
    },
    reloadReconnectPosture: {
      reloadPosture: fallback.reloadPosture,
      reconnectPosture: fallback.reconnectPosture,
      canReport: true,
      transitionExposed: false,
      appServerRestartAllowed: false,
      appServerReplacementAllowed: false,
    },
    startupFailurePosture: {
      startupPosture: fallback.startupPosture,
      failurePosture: fallback.failurePosture,
      visible: true,
    },
    blockerCodes: reportBlockers,
    evidenceRefs: [
      evidenceRef("runtime_status", runtimeStatus.statusDigest || runtimeStatus.sourceDigest || "runtime_status", "present", "Runtime status"),
      evidenceRef("app_server_snapshot", fallback.available ? "legacy_app_server_snapshot" : "legacy_app_server_missing", fallback.available ? "present" : "missing", "App-server fallback"),
      ...directBlockers.map((blocker) => evidenceRef("direct_fallback_blocker", blocker, "present", blocker)),
    ],
    authority: {
      displayOnly: true,
      rendererSafe: true,
      providerTransportAllowed: false,
      appServerSpawnAllowed: false,
      appServerReplacementAllowed: false,
      appServerMutationAllowed: false,
      runtimeSelectionMutationAllowed: false,
      workspaceMutationAllowed: false,
      recursiveWorkerAllowed: false,
      matrixPromotionAllowed: false,
    },
    reportEffects: {
      changesRuntimeSelection: false,
      changesDefaults: false,
      changesMatrixRows: false,
      startsAppServer: false,
      replacesAppServer: false,
      reroutesDirectFailure: false,
    },
    reportDigest: sourceDigest,
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
  assertAppServerFallbackParityReportSafe(report);
  return report;
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
    if (value instanceof Error) {
      collectStrings(value.message, output, seen);
      collectStrings(value.stack, output, seen);
    }
    for (const item of Object.values(value)) collectStrings(item, output, seen);
  }
  return output;
}

function assertNoRawExposure(value) {
  const text = collectStrings(value).join("\n");
  const forbidden = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/i,
    /https:\/\/chatgpt\.com\/[^\s)]+/i,
    /\\\\wsl\.localhost\\/i,
    /\/mnt\/[a-z]\//i,
    /\/home\/[^/\s]+\/[^\s]+/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      const error = new Error("direct_appserver_fallback_parity_raw_exposure");
      error.code = "direct_appserver_fallback_parity_raw_exposure";
      throw error;
    }
  }
  return true;
}

function assertAppServerFallbackParityReportSafe(report = {}) {
  if (!isPlainObject(report) || report.schema !== DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA) {
    throw new Error("direct_appserver_fallback_parity_schema_mismatch");
  }
  const authority = isPlainObject(report.authority) ? report.authority : {};
  const reportEffects = isPlainObject(report.reportEffects) ? report.reportEffects : {};
  const forbiddenAuthority = [
    "providerTransportAllowed",
    "appServerSpawnAllowed",
    "appServerReplacementAllowed",
    "appServerMutationAllowed",
    "runtimeSelectionMutationAllowed",
    "workspaceMutationAllowed",
    "recursiveWorkerAllowed",
    "matrixPromotionAllowed",
  ];
  const forbiddenEffects = [
    "changesRuntimeSelection",
    "changesDefaults",
    "changesMatrixRows",
    "startsAppServer",
    "replacesAppServer",
    "reroutesDirectFailure",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_appserver_fallback_parity_not_display_only");
  }
  for (const flag of forbiddenAuthority) {
    if (authority[flag] !== false) throw new Error(`direct_appserver_fallback_parity_authority_leak:${flag}`);
  }
  for (const flag of forbiddenEffects) {
    if (reportEffects[flag] !== false) {
      throw new Error(`direct_appserver_fallback_parity_effect_leak:${flag}`);
    }
  }
  if (report.rendererSafe !== true || report.rawProviderPayloadIncluded !== false || report.rawLocalPathIncluded !== false || report.rawToolOutputIncluded !== false) {
    throw new Error("direct_appserver_fallback_parity_not_renderer_safe");
  }
  if (report.parityState === "blocked" && !safeArray(report.blockerCodes).length) {
    throw new Error("direct_appserver_fallback_parity_silent_blocker");
  }
  assertNoRawExposure(report);
  return true;
}

module.exports = {
  DIRECT_APPSERVER_FALLBACK_PARITY_REPORT_SCHEMA,
  assertAppServerFallbackParityReportSafe,
  buildAppServerFallbackParityReport,
};
