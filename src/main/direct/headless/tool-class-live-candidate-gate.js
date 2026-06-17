"use strict";

const crypto = require("node:crypto");
const {
  buildDirectHeadlessToolClassRealismReport,
  validateDirectHeadlessToolClassRealismReport,
} = require("./tool-class-realism-report");

const DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_GATE_SCHEMA = "direct_headless_tool_class_live_candidate_gate@1";
const DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_ROW_SCHEMA = "direct_headless_tool_class_live_candidate_row@1";

const GATE_STATUSES = new Set([
  "eligible_live_candidate",
  "blocked_fixture_not_executed",
  "blocked_fixture_failed",
  "blocked_projection_only",
  "blocked_unsupported",
  "blocked_real_provider_unassigned",
  "blocked_invalid_realism",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function gateStatusForRealism(realismStatus = "") {
  switch (realismStatus) {
    case "headless_fixture_passed":
      return "eligible_live_candidate";
    case "headless_fixture_available_not_executed":
      return "blocked_fixture_not_executed";
    case "headless_fixture_failed":
      return "blocked_fixture_failed";
    case "projection_blocked":
      return "blocked_projection_only";
    case "unsupported_blocked":
      return "blocked_unsupported";
    case "real_provider_unassigned":
      return "blocked_real_provider_unassigned";
    default:
      return "blocked_invalid_realism";
  }
}

function gateReasonsFor(gateStatus = "", row = {}) {
  switch (gateStatus) {
    case "eligible_live_candidate":
      return ["fixture_proven", "live_smoke_not_run_in_this_gate"];
    case "blocked_fixture_not_executed":
      return ["fixture_execution_required_before_live_candidate"];
    case "blocked_fixture_failed":
      return normalizeStringList(row.blockingReasons, ["fixture_failure_blocks_live_candidate"]);
    case "blocked_projection_only":
      return ["projection_only_class_has_no_execution_authority"];
    case "blocked_unsupported":
      return ["unsupported_by_direct_tool_constitution"];
    case "blocked_real_provider_unassigned":
      return ["real_provider_runner_not_assigned"];
    default:
      return ["invalid_or_unknown_realism_status"];
  }
}

function requiredConditionsFor(gateStatus = "", row = {}) {
  if (gateStatus !== "eligible_live_candidate") {
    return [];
  }
  const conditions = [
    "explicit_live_smoke_mode_required",
    "operator_or_ci_authority_required",
    "provider_transport_opt_in_required",
    "bounded_timeout_required",
    "raw_exposure_scan_required",
    "route_authority_review_required",
  ];
  const forbidden = normalizeStringList(row.forbiddenSideEffects);
  if (forbidden.includes("silent_workspace_write") || forbidden.includes("workspace_write") || forbidden.includes("path_escape")) {
    conditions.push("disposable_workspace_required");
  }
  if (forbidden.includes("process_spawn") || forbidden.includes("unbounded_output") || forbidden.includes("shell_true_default")) {
    conditions.push("process_spawn_policy_required");
  }
  if (normalizeStringList(row.toolIdsCovered).some((toolId) => toolId.includes("agent"))) {
    conditions.push("agent_containment_profile_required");
  }
  return normalizeStringList(conditions);
}

function liveSmokeRouteFor(row = {}) {
  const gateStatus = gateStatusForRealism(row.realismStatus);
  if (gateStatus !== "eligible_live_candidate") return "";
  const primaryScript = normalizeStringList(row.fixtureScripts)[0] || "";
  return primaryScript ? `headless-live-smoke:${primaryScript}` : `headless-live-smoke:${normalizeString(row.toolClassId, "unknown")}`;
}

function buildGateRow(row = {}) {
  const gateStatus = gateStatusForRealism(row.realismStatus);
  const gateRow = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_ROW_SCHEMA,
    rowId: `live_candidate_${digestFor("direct-headless-tool-live-candidate-row-id@1", {
      realismRowDigest: row.rowDigest,
      exampleId: row.exampleId,
      gateStatus,
    }).slice(0, 24)}`,
    sourceRealismRowDigest: normalizeString(row.rowDigest, ""),
    exampleId: normalizeString(row.exampleId, ""),
    exampleDigest: normalizeString(row.exampleDigest, ""),
    toolClassId: normalizeString(row.toolClassId, ""),
    toolIdsCovered: normalizeStringList(row.toolIdsCovered),
    realismStatus: normalizeString(row.realismStatus, "unknown"),
    realismPromotionReadiness: normalizeString(row.promotionReadiness, "unknown"),
    gateStatus,
    eligibleForLiveSmoke: gateStatus === "eligible_live_candidate",
    gateReasons: gateReasonsFor(gateStatus, row),
    requiredConditions: requiredConditionsFor(gateStatus, row),
    liveSmokeRoute: liveSmokeRouteFor(row),
    fixtureScripts: normalizeStringList(row.fixtureScripts),
    expectedEvidenceSchemas: normalizeStringList(row.expectedEvidenceSchemas),
    forbiddenSideEffects: normalizeStringList(row.forbiddenSideEffects),
    providerTransportStarted: false,
    workspaceMutationStartedByGate: false,
    rendererAuthorityGranted: false,
    liveSmokeStartedByGate: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  gateRow.rowDigest = digestFor("direct-headless-tool-class-live-candidate-row@1", gateRow);
  return gateRow;
}

function buildDirectHeadlessToolClassLiveCandidateGate(options = {}) {
  const realismReport = isPlainObject(options.realismReport)
    ? options.realismReport
    : buildDirectHeadlessToolClassRealismReport(options);
  const realismValidationErrors = validateDirectHeadlessToolClassRealismReport(realismReport);
  const rows = (Array.isArray(realismReport.rows) ? realismReport.rows : []).map((row) => buildGateRow(row));
  const validationErrors = [
    ...realismValidationErrors,
    ...(realismReport.status !== "passed" ? [`realism_report_not_passed:${normalizeString(realismReport.status, "unknown")}`] : []),
    ...rows
      .filter((row) => !GATE_STATUSES.has(row.gateStatus))
      .map((row) => `invalid_gate_status:${row.exampleId}:${row.gateStatus}`),
  ];
  const eligibleRows = rows.filter((row) => row.eligibleForLiveSmoke);
  const gate = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_GATE_SCHEMA,
    gateId: normalizeString(options.gateId, `direct_headless_tool_live_candidate_gate_${digestFor("direct-headless-tool-live-candidate-gate-source@1", {
      realismReportDigest: realismReport.reportDigest,
      rowDigests: rows.map((row) => row.rowDigest),
    }).slice(0, 24)}`),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    sourceRealismReportId: normalizeString(realismReport.reportId, ""),
    sourceRealismReportDigest: normalizeString(realismReport.reportDigest, ""),
    sourceRealismExecutionMode: normalizeString(realismReport.executionMode, "unknown"),
    status: validationErrors.length ? "failed" : "passed",
    validationErrors,
    rowCount: rows.length,
    eligibleCandidateCount: eligibleRows.length,
    rows,
    summary: {
      byGateStatus: countBy(rows, "gateStatus"),
      byRealismStatus: countBy(rows, "realismStatus"),
      eligibleToolClasses: eligibleRows.map((row) => row.toolClassId),
      eligibleToolIds: normalizeStringList(eligibleRows.flatMap((row) => row.toolIdsCovered)),
      blockedToolClasses: rows.filter((row) => !row.eligibleForLiveSmoke).map((row) => row.toolClassId),
    },
    providerTransportStarted: false,
    workspaceMutationStartedByGate: false,
    rendererAuthorityGranted: false,
    liveSmokeStartedByGate: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  gate.gateDigest = digestFor("direct-headless-tool-class-live-candidate-gate@1", gate);
  return gate;
}

function validateDirectHeadlessToolClassLiveCandidateGate(gate = {}) {
  const errors = [];
  if (!isPlainObject(gate) || gate.schema !== DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_GATE_SCHEMA) {
    return ["direct_headless_tool_class_live_candidate_gate_schema_mismatch"];
  }
  if (!Array.isArray(gate.rows) || !gate.rows.length) errors.push("live_candidate_rows_missing");
  for (const row of Array.isArray(gate.rows) ? gate.rows : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_ROW_SCHEMA) {
      errors.push("live_candidate_row_schema_mismatch");
      continue;
    }
    if (!GATE_STATUSES.has(row.gateStatus)) errors.push(`invalid_gate_status:${row.exampleId}:${row.gateStatus || ""}`);
    if (row.eligibleForLiveSmoke !== (row.gateStatus === "eligible_live_candidate")) {
      errors.push(`live_candidate_eligibility_mismatch:${row.exampleId}`);
    }
    if (row.eligibleForLiveSmoke && !normalizeString(row.liveSmokeRoute, "")) {
      errors.push(`live_candidate_route_missing:${row.exampleId}`);
    }
    for (const flag of ["providerTransportStarted", "workspaceMutationStartedByGate", "rendererAuthorityGranted", "liveSmokeStartedByGate", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`live_candidate_row_authority_or_raw_leak:${row.exampleId}:${flag}`);
    }
  }
  for (const flag of ["providerTransportStarted", "workspaceMutationStartedByGate", "rendererAuthorityGranted", "liveSmokeStartedByGate", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (gate[flag] !== false) errors.push(`live_candidate_gate_authority_or_raw_leak:${flag}`);
  }
  if (Array.isArray(gate.validationErrors) && gate.validationErrors.length && gate.status !== "failed") {
    errors.push("validation_errors_without_failed_status");
  }
  return errors;
}

module.exports = {
  DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_GATE_SCHEMA,
  DIRECT_HEADLESS_TOOL_CLASS_LIVE_CANDIDATE_ROW_SCHEMA,
  buildDirectHeadlessToolClassLiveCandidateGate,
  validateDirectHeadlessToolClassLiveCandidateGate,
};
