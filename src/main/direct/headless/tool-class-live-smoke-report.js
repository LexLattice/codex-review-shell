"use strict";

const crypto = require("node:crypto");
const {
  buildDirectHeadlessToolClassLiveCandidateGate,
  validateDirectHeadlessToolClassLiveCandidateGate,
} = require("./tool-class-live-candidate-gate");

const DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_REPORT_SCHEMA = "direct_headless_tool_class_live_smoke_report@1";
const DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_ROW_SCHEMA = "direct_headless_tool_class_live_smoke_row@1";

const EXECUTION_MODES = new Set(["plan_only", "execute_live_smoke"]);
const SMOKE_STATUSES = new Set([
  "live_smoke_passed",
  "live_smoke_failed",
  "live_smoke_missing",
  "live_smoke_not_requested",
  "blocked_by_candidate_gate",
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

function safeGateRow(row) {
  return isPlainObject(row) ? row : {};
}

function smokeResultKeyForCandidate(row = {}) {
  const safeRow = safeGateRow(row);
  return [
    normalizeString(safeRow.exampleId, ""),
    normalizeString(safeRow.toolClassId, ""),
    normalizeString(safeRow.liveSmokeRoute, ""),
  ].join("|");
}

function smokeResultMap(smokeExecution = {}) {
  const results = Array.isArray(smokeExecution.results) ? smokeExecution.results : [];
  const byKey = new Map();
  for (const result of results) {
    if (!isPlainObject(result)) continue;
    const key = [
      normalizeString(result.exampleId, ""),
      normalizeString(result.toolClassId, ""),
      normalizeString(result.liveSmokeRoute, ""),
    ].join("|");
    if (key !== "||") byKey.set(key, result);
  }
  return byKey;
}

function resultForCandidate(row = {}, resultsByKey = new Map()) {
  return resultsByKey.get(smokeResultKeyForCandidate(row)) || null;
}

function missingConditions(row = {}, result = {}) {
  const required = normalizeStringList(row.requiredConditions);
  const satisfied = new Set(normalizeStringList(result?.satisfiedConditions));
  return required.filter((condition) => !satisfied.has(condition));
}

function hasEvidenceRefs(result = {}) {
  return Array.isArray(result?.evidenceRefs) && result.evidenceRefs.some((ref) => isPlainObject(ref));
}

function smokeStatusFor(row = {}, result = null, executionMode = "plan_only") {
  const safeRow = safeGateRow(row);
  if (safeRow.eligibleForLiveSmoke !== true) return "blocked_by_candidate_gate";
  if (executionMode !== "execute_live_smoke") return "live_smoke_not_requested";
  if (!isPlainObject(result)) return "live_smoke_missing";
  const missing = missingConditions(safeRow, result);
  return normalizeString(result.status, "failed") === "passed" && missing.length === 0 && hasEvidenceRefs(result)
    ? "live_smoke_passed"
    : "live_smoke_failed";
}

function smokeBlockersFor(status = "", row = {}, result = null) {
  if (status === "blocked_by_candidate_gate") return normalizeStringList(row.gateReasons, ["candidate_gate_blocked"]);
  if (status === "live_smoke_not_requested") return ["live_smoke_execution_not_requested"];
  if (status === "live_smoke_missing") return ["live_smoke_result_missing"];
  if (status === "live_smoke_failed") {
    const missing = missingConditions(row, result);
    return normalizeStringList([
      ...missing.map((condition) => `required_condition_missing:${condition}`),
      ...(hasEvidenceRefs(result) ? [] : ["live_smoke_evidence_missing"]),
      normalizeString(result?.reasonCode, ""),
    ], ["live_smoke_failed"]);
  }
  return [];
}

function evidenceRefsFor(result = {}) {
  return Array.isArray(result?.evidenceRefs)
    ? result.evidenceRefs
      .filter((ref) => isPlainObject(ref))
      .map((ref) => ({
        kind: normalizeString(ref.kind, "live_smoke_evidence"),
        refId: normalizeString(ref.refId || ref.evidenceKey || ref.artifactId, "unknown"),
        state: normalizeString(ref.state || ref.status, "present"),
        rendererSafe: ref.rendererSafe !== false,
        rawPayloadIncluded: false,
        rawPathIncluded: false,
      }))
    : [];
}

function buildSmokeRow(candidateRow = {}, result = null, executionMode = "plan_only") {
  const safeRow = safeGateRow(candidateRow);
  const smokeStatus = smokeStatusFor(safeRow, result, executionMode);
  const row = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_ROW_SCHEMA,
    rowId: `live_smoke_${digestFor("direct-headless-tool-live-smoke-row-id@1", {
      candidateRowDigest: safeRow.rowDigest,
      exampleId: safeRow.exampleId,
      smokeStatus,
      resultDigest: isPlainObject(result) ? digestFor("direct-headless-tool-live-smoke-result@1", result) : "",
    }).slice(0, 24)}`,
    sourceCandidateRowDigest: normalizeString(safeRow.rowDigest, ""),
    exampleId: normalizeString(safeRow.exampleId, ""),
    toolClassId: normalizeString(safeRow.toolClassId, ""),
    toolIdsCovered: normalizeStringList(safeRow.toolIdsCovered),
    gateStatus: normalizeString(safeRow.gateStatus, "unknown"),
    eligibleForLiveSmoke: safeRow.eligibleForLiveSmoke === true,
    liveSmokeRoute: normalizeString(safeRow.liveSmokeRoute, ""),
    smokeStatus,
    smokeBlockers: smokeBlockersFor(smokeStatus, safeRow, result),
    requiredConditions: normalizeStringList(safeRow.requiredConditions),
    satisfiedConditions: normalizeStringList(result?.satisfiedConditions),
    missingConditions: missingConditions(safeRow, result),
    evidenceRefs: evidenceRefsFor(result),
    resultDigest: isPlainObject(result) ? digestFor("direct-headless-tool-live-smoke-result@1", result) : "",
    durationMs: Number(result?.durationMs || 0),
    providerTransportStarted: result?.providerTransportStarted === true,
    workspaceMutationStartedBySmoke: result?.workspaceMutationStartedBySmoke === true,
    rendererAuthorityGranted: false,
    liveSmokeStartedByRunner: isPlainObject(result),
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-headless-tool-class-live-smoke-row@1", row);
  return row;
}

function buildDirectHeadlessToolClassLiveSmokeReport(options = {}) {
  const candidateGate = isPlainObject(options.candidateGate)
    ? options.candidateGate
    : buildDirectHeadlessToolClassLiveCandidateGate(options);
  const gateValidationErrors = validateDirectHeadlessToolClassLiveCandidateGate(candidateGate);
  const smokeExecution = isPlainObject(options.smokeExecution) ? options.smokeExecution : { mode: "not_requested", results: [] };
  const smokeExecutionMode = normalizeString(smokeExecution.mode, "not_requested");
  const requestedExecutionMode = normalizeString(
    options.executionMode,
    smokeExecutionMode === "execute_live_smoke" ? "execute_live_smoke" : "plan_only",
  );
  const executionMode = requestedExecutionMode === "execute_live_smoke" && smokeExecutionMode === "execute_live_smoke" ? "execute_live_smoke" : "plan_only";
  const resultsByKey = smokeResultMap(smokeExecution);
  const rows = (Array.isArray(candidateGate.rows) ? candidateGate.rows : [])
    .map((row) => buildSmokeRow(row, resultForCandidate(row, resultsByKey), executionMode));
  const failedRows = rows.filter((row) => ["live_smoke_failed", "live_smoke_missing"].includes(row.smokeStatus));
  const validationErrors = [
    ...gateValidationErrors,
    ...(candidateGate.status !== "passed" ? [`candidate_gate_not_passed:${normalizeString(candidateGate.status, "unknown")}`] : []),
    ...(requestedExecutionMode === "execute_live_smoke" && smokeExecutionMode !== "execute_live_smoke"
      ? [`execution_mode_smoke_execution_mismatch:${requestedExecutionMode}:${smokeExecutionMode}`]
      : []),
    ...(executionMode === "execute_live_smoke" && smokeExecution.allowLiveProviderCall !== true
      ? ["live_provider_opt_in_missing"]
      : []),
    ...rows
      .filter((row) => !SMOKE_STATUSES.has(row.smokeStatus))
      .map((row) => `invalid_smoke_status:${row.exampleId}:${row.smokeStatus}`),
    ...failedRows.map((row) => `live_smoke_row_not_passed:${row.exampleId}:${row.smokeStatus}`),
  ];
  const passedRows = rows.filter((row) => row.smokeStatus === "live_smoke_passed");
  const report = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_REPORT_SCHEMA,
    reportId: normalizeString(options.reportId, `direct_headless_tool_live_smoke_${digestFor("direct-headless-tool-live-smoke-report-source@1", {
      candidateGateDigest: candidateGate.gateDigest,
      smokeExecution,
      rowDigests: rows.map((row) => row.rowDigest),
    }).slice(0, 24)}`),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    sourceCandidateGateId: normalizeString(candidateGate.gateId, ""),
    sourceCandidateGateDigest: normalizeString(candidateGate.gateDigest, ""),
    requestedExecutionMode: EXECUTION_MODES.has(requestedExecutionMode) ? requestedExecutionMode : "plan_only",
    executionMode: EXECUTION_MODES.has(executionMode) ? executionMode : "plan_only",
    smokeExecutionMode,
    status: validationErrors.length ? "failed" : "passed",
    validationErrors,
    rowCount: rows.length,
    liveSmokePassedCount: passedRows.length,
    rows,
    summary: {
      bySmokeStatus: countBy(rows, "smokeStatus"),
      byGateStatus: countBy(rows, "gateStatus"),
      passedToolClasses: passedRows.map((row) => row.toolClassId),
      failedToolClasses: failedRows.map((row) => row.toolClassId),
      blockedToolClasses: rows.filter((row) => row.smokeStatus === "blocked_by_candidate_gate").map((row) => row.toolClassId),
    },
    providerTransportStarted: rows.some((row) => row.providerTransportStarted),
    workspaceMutationStartedBySmoke: rows.some((row) => row.workspaceMutationStartedBySmoke),
    rendererAuthorityGranted: false,
    liveSmokeStartedByRunner: rows.some((row) => row.liveSmokeStartedByRunner),
    promotionGranted: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor("direct-headless-tool-class-live-smoke-report@1", report);
  return report;
}

function validateDirectHeadlessToolClassLiveSmokeReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report) || report.schema !== DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_REPORT_SCHEMA) {
    return ["direct_headless_tool_class_live_smoke_report_schema_mismatch"];
  }
  if (!Array.isArray(report.rows) || !report.rows.length) errors.push("live_smoke_rows_missing");
  for (const row of Array.isArray(report.rows) ? report.rows : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_ROW_SCHEMA) {
      errors.push("live_smoke_row_schema_mismatch");
      continue;
    }
    if (!SMOKE_STATUSES.has(row.smokeStatus)) errors.push(`invalid_smoke_status:${row.exampleId}:${row.smokeStatus || ""}`);
    if (row.smokeStatus === "live_smoke_passed" && row.eligibleForLiveSmoke !== true) {
      errors.push(`ineligible_row_passed_live_smoke:${row.exampleId}`);
    }
    if (row.smokeStatus === "live_smoke_passed" && (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length === 0)) {
      errors.push(`passed_live_smoke_missing_evidence_refs:${row.exampleId}`);
    }
    for (const flag of ["rendererAuthorityGranted", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`live_smoke_row_authority_or_raw_leak:${row.exampleId}:${flag}`);
    }
  }
  for (const flag of ["rendererAuthorityGranted", "promotionGranted", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (report[flag] !== false) errors.push(`live_smoke_report_authority_or_raw_leak:${flag}`);
  }
  if (report.requestedExecutionMode === "execute_live_smoke" && report.smokeExecutionMode !== "execute_live_smoke" && report.status !== "failed") {
    errors.push("smoke_execution_mismatch_without_failed_status");
  }
  if (report.executionMode === "execute_live_smoke" && report.status === "passed" && report.liveSmokePassedCount === 0) {
    errors.push("executed_live_smoke_without_passed_rows");
  }
  if (Array.isArray(report.validationErrors) && report.validationErrors.length && report.status !== "failed") {
    errors.push("validation_errors_without_failed_status");
  }
  return errors;
}

module.exports = {
  DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_REPORT_SCHEMA,
  DIRECT_HEADLESS_TOOL_CLASS_LIVE_SMOKE_ROW_SCHEMA,
  buildDirectHeadlessToolClassLiveSmokeReport,
  validateDirectHeadlessToolClassLiveSmokeReport,
};
