"use strict";

const crypto = require("node:crypto");
const {
  buildDirectHeadlessToolClassExamplePack,
  validateDirectHeadlessToolClassExamplePack,
} = require("./tool-class-examples");

const DIRECT_HEADLESS_TOOL_CLASS_REALISM_REPORT_SCHEMA = "direct_headless_tool_class_realism_report@1";
const DIRECT_HEADLESS_TOOL_CLASS_REALISM_ROW_SCHEMA = "direct_headless_tool_class_realism_row@1";

const EXECUTION_MODES = new Set(["validate_only", "execute_fixtures"]);
const REALISM_STATUSES = new Set([
  "real_provider_unassigned",
  "headless_fixture_passed",
  "headless_fixture_failed",
  "headless_fixture_available_not_executed",
  "projection_blocked",
  "unsupported_blocked",
  "invalid_example",
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

function resultMapForFixtureExecution(fixtureExecution = {}) {
  const results = Array.isArray(fixtureExecution.results) ? fixtureExecution.results : [];
  return new Map(results.map((result) => [normalizeString(result.scriptPath, ""), result]).filter(([scriptPath]) => scriptPath));
}

function fixtureStatusForExample(example = {}, fixtureExecution = {}) {
  const mode = normalizeString(fixtureExecution.mode, "not_requested");
  if (mode !== "execute_fixtures") {
    return {
      realismStatus: "headless_fixture_available_not_executed",
      fixtureScriptsPassed: 0,
      fixtureScriptsFailed: 0,
      fixtureScriptsMissing: normalizeStringList(example.runnerScripts).length,
      blockingReasons: ["fixture_execution_not_requested"],
      fixtureResultRefs: [],
    };
  }
  const byScriptPath = resultMapForFixtureExecution(fixtureExecution);
  const runnerScripts = normalizeStringList(example.runnerScripts);
  const fixtureResultRefs = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;
  for (const scriptPath of runnerScripts) {
    const result = byScriptPath.get(scriptPath);
    if (!result) {
      missing += 1;
      continue;
    }
    const status = normalizeString(result.status, "unknown");
    if (status === "passed") passed += 1;
    else failed += 1;
    fixtureResultRefs.push({
      scriptPath,
      status,
      durationMs: Number(result.durationMs || 0),
      errorDigest: result.error ? digestFor("direct-headless-fixture-error@1", result.error) : "",
    });
  }
  const blockingReasons = [];
  if (failed) blockingReasons.push("fixture_script_failed");
  if (missing) blockingReasons.push("fixture_result_missing");
  return {
    realismStatus: failed || missing ? "headless_fixture_failed" : "headless_fixture_passed",
    fixtureScriptsPassed: passed,
    fixtureScriptsFailed: failed,
    fixtureScriptsMissing: missing,
    blockingReasons,
    fixtureResultRefs,
  };
}

function statusForExample(example = {}, fixtureExecution = {}) {
  const testMode = normalizeString(example.testMode, "projection_blocked");
  if (testMode === "headless_fixture") return fixtureStatusForExample(example, fixtureExecution);
  if (testMode === "projection_blocked") {
    return {
      realismStatus: "projection_blocked",
      fixtureScriptsPassed: 0,
      fixtureScriptsFailed: 0,
      fixtureScriptsMissing: 0,
      blockingReasons: ["projection_only_by_design"],
      fixtureResultRefs: [],
    };
  }
  if (testMode === "unsupported_blocked") {
    return {
      realismStatus: "unsupported_blocked",
      fixtureScriptsPassed: 0,
      fixtureScriptsFailed: 0,
      fixtureScriptsMissing: 0,
      blockingReasons: ["unsupported_by_direct_tool_constitution"],
      fixtureResultRefs: [],
    };
  }
  if (testMode === "real_provider") {
    return {
      realismStatus: "real_provider_unassigned",
      fixtureScriptsPassed: 0,
      fixtureScriptsFailed: 0,
      fixtureScriptsMissing: 0,
      blockingReasons: ["real_provider_runner_not_in_this_pr"],
      fixtureResultRefs: [],
    };
  }
  return {
    realismStatus: "invalid_example",
    fixtureScriptsPassed: 0,
    fixtureScriptsFailed: 0,
    fixtureScriptsMissing: 0,
    blockingReasons: [`invalid_test_mode:${testMode}`],
    fixtureResultRefs: [],
  };
}

function promotionReadinessFor(realismStatus = "") {
  switch (realismStatus) {
    case "headless_fixture_passed":
      return "fixture_proven_ready_for_live_candidate_review";
    case "headless_fixture_available_not_executed":
      return "fixture_runner_available_not_executed";
    case "projection_blocked":
      return "blocked_until_execution_authority_exists";
    case "unsupported_blocked":
      return "blocked_by_tool_constitution";
    case "real_provider_unassigned":
      return "needs_real_provider_runner";
    case "headless_fixture_failed":
      return "blocked_by_fixture_failure";
    default:
      return "invalid_or_unknown";
  }
}

function buildRealismRow(example = {}, fixtureExecution = {}) {
  const status = statusForExample(example, fixtureExecution);
  const row = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_REALISM_ROW_SCHEMA,
    rowId: `realism_${digestFor("direct-headless-tool-class-realism-row-id@1", {
      exampleId: example.exampleId,
      exampleDigest: example.exampleDigest,
      fixtureResultRefs: status.fixtureResultRefs,
    }).slice(0, 24)}`,
    exampleId: normalizeString(example.exampleId, ""),
    exampleDigest: normalizeString(example.exampleDigest, ""),
    toolClassId: normalizeString(example.toolClassId, ""),
    toolIdsCovered: normalizeStringList(example.toolIdsCovered),
    testMode: normalizeString(example.testMode, "projection_blocked"),
    realismTier: normalizeString(example.realismTier, "projection"),
    realismStatus: status.realismStatus,
    promotionReadiness: promotionReadinessFor(status.realismStatus),
    fixtureScripts: normalizeStringList(example.runnerScripts),
    fixtureScriptsPassed: status.fixtureScriptsPassed,
    fixtureScriptsFailed: status.fixtureScriptsFailed,
    fixtureScriptsMissing: status.fixtureScriptsMissing,
    fixtureResultRefs: status.fixtureResultRefs,
    expectedEvidenceSchemas: normalizeStringList(example.expectedEvidenceSchemas),
    forbiddenSideEffects: normalizeStringList(example.forbiddenSideEffects),
    blockingReasons: normalizeStringList(status.blockingReasons),
    providerTransportStarted: false,
    workspaceMutationStartedByReport: false,
    rendererAuthorityGranted: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-headless-tool-class-realism-row@1", row);
  return row;
}

function buildDirectHeadlessToolClassRealismReport(options = {}) {
  const pack = isPlainObject(options.pack) ? options.pack : buildDirectHeadlessToolClassExamplePack(options);
  const packValidationErrors = validateDirectHeadlessToolClassExamplePack(pack);
  const fixtureExecution = isPlainObject(options.fixtureExecution) ? options.fixtureExecution : { mode: "not_requested", results: [] };
  const executionMode = normalizeString(options.executionMode, normalizeString(fixtureExecution.mode, "validate_only"));
  const rows = (Array.isArray(pack.examples) ? pack.examples : []).map((example) => buildRealismRow(example, fixtureExecution));
  const validationErrors = [
    ...packValidationErrors,
    ...rows
      .filter((row) => !REALISM_STATUSES.has(row.realismStatus))
      .map((row) => `invalid_realism_status:${row.exampleId}:${row.realismStatus}`),
  ];
  const failedFixtureRows = rows.filter((row) => row.realismStatus === "headless_fixture_failed");
  const report = {
    schema: DIRECT_HEADLESS_TOOL_CLASS_REALISM_REPORT_SCHEMA,
    reportId: normalizeString(options.reportId, `direct_headless_tool_realism_${digestFor("direct-headless-tool-realism-report-source@1", {
      packDigest: pack.packDigest,
      fixtureExecution,
    }).slice(0, 24)}`),
    packId: normalizeString(pack.packId, ""),
    packDigest: normalizeString(pack.packDigest, ""),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    executionMode: EXECUTION_MODES.has(executionMode) ? executionMode : "validate_only",
    status: validationErrors.length || failedFixtureRows.length ? "failed" : "passed",
    validationErrors,
    rowCount: rows.length,
    rows,
    summary: {
      byRealismStatus: countBy(rows, "realismStatus"),
      byTestMode: countBy(rows, "testMode"),
      byPromotionReadiness: countBy(rows, "promotionReadiness"),
      fixtureScriptResultCount: Array.isArray(fixtureExecution.results) ? fixtureExecution.results.length : 0,
      fixtureRowsPassed: rows.filter((row) => row.realismStatus === "headless_fixture_passed").length,
      fixtureRowsAvailableNotExecuted: rows.filter((row) => row.realismStatus === "headless_fixture_available_not_executed").length,
      fixtureRowsFailed: failedFixtureRows.length,
      projectionBlockedRows: rows.filter((row) => row.realismStatus === "projection_blocked").length,
      unsupportedBlockedRows: rows.filter((row) => row.realismStatus === "unsupported_blocked").length,
      realProviderUnassignedRows: rows.filter((row) => row.realismStatus === "real_provider_unassigned").length,
    },
    noProviderTransportByDefault: true,
    providerTransportStarted: false,
    workspaceMutationStartedByReport: false,
    rendererAuthorityGranted: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor("direct-headless-tool-class-realism-report@1", report);
  return report;
}

function validateDirectHeadlessToolClassRealismReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report) || report.schema !== DIRECT_HEADLESS_TOOL_CLASS_REALISM_REPORT_SCHEMA) {
    return ["direct_headless_tool_class_realism_report_schema_mismatch"];
  }
  if (!Array.isArray(report.rows) || !report.rows.length) errors.push("realism_rows_missing");
  for (const row of Array.isArray(report.rows) ? report.rows : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_HEADLESS_TOOL_CLASS_REALISM_ROW_SCHEMA) {
      errors.push("realism_row_schema_mismatch");
      continue;
    }
    if (!REALISM_STATUSES.has(row.realismStatus)) errors.push(`invalid_realism_status:${row.exampleId}:${row.realismStatus || ""}`);
    for (const flag of ["providerTransportStarted", "workspaceMutationStartedByReport", "rendererAuthorityGranted", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`realism_row_authority_or_raw_leak:${row.exampleId}:${flag}`);
    }
  }
  for (const flag of ["noProviderTransportByDefault", "providerTransportStarted", "workspaceMutationStartedByReport", "rendererAuthorityGranted", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    const expected = flag === "noProviderTransportByDefault";
    if (report[flag] !== expected) errors.push(`realism_report_authority_or_raw_leak:${flag}`);
  }
  if (Array.isArray(report.validationErrors) && report.validationErrors.length && report.status !== "failed") {
    errors.push("validation_errors_without_failed_status");
  }
  return errors;
}

module.exports = {
  DIRECT_HEADLESS_TOOL_CLASS_REALISM_REPORT_SCHEMA,
  DIRECT_HEADLESS_TOOL_CLASS_REALISM_ROW_SCHEMA,
  buildDirectHeadlessToolClassRealismReport,
  validateDirectHeadlessToolClassRealismReport,
};
