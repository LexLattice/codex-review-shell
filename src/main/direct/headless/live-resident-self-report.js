"use strict";

const crypto = require("node:crypto");
const {
  buildResidentSelfReportDiagnostics,
  validateResidentEpistemicContextBundle,
} = require("../bridge/resident-epistemic-context-policy");
const {
  buildDefaultHeadlessResidentSmokeSuite,
  buildDefaultResidentSmokeBundle,
  buildResidentSmokePrompt,
} = require("./resident-smoke-runner");

const HEADLESS_LIVE_RESIDENT_CASE_REPORT_SCHEMA = "headless_live_resident_self_report_case@1";
const HEADLESS_LIVE_RESIDENT_SUITE_REPORT_SCHEMA = "headless_live_resident_self_report_suite@1";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function shortDigest(value) {
  return sha256(value).slice(7, 31);
}

function normalizeStringList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function subjectKey(row = {}) {
  return `${normalizeString(row.subjectKind, "unknown")}:${normalizeString(row.subjectId, "")}`;
}

function claimSubjectKey(claim = {}) {
  return `${normalizeString(claim.subjectKind, "unknown")}:${normalizeString(claim.subjectId || claim.id, "")}`;
}

function stripJsonFence(text = "") {
  const source = normalizeString(text, "");
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : source;
}

function extractJsonObjectText(text = "") {
  const source = stripJsonFence(text);
  if (!source) return "";
  if (source.startsWith("{") && source.endsWith("}")) return source;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) return source.slice(start, end + 1);
  return source;
}

function parseResidentSelfReportText(text = "") {
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    return {
      ok: false,
      error: "resident_self_report_empty",
      selfReport: { source: "live_provider_parse_failed", claims: [] },
    };
  }
  try {
    const parsed = JSON.parse(jsonText);
    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        error: "resident_self_report_not_object",
        selfReport: { source: "live_provider_parse_failed", claims: [] },
      };
    }
    const claims = Array.isArray(parsed.claims) ? parsed.claims.filter(isPlainObject) : [];
    return {
      ok: true,
      error: "",
      parsed,
      selfReport: {
        source: normalizeString(parsed.source, "live_provider"),
        claims,
      },
    };
  } catch {
    return {
      ok: false,
      error: "resident_self_report_invalid_json",
      selfReport: { source: "live_provider_parse_failed", claims: [] },
    };
  }
}

function buildLiveResidentSelfReportPrompt({ bundle, smokeCase } = {}) {
  const safeCase = isPlainObject(smokeCase) ? smokeCase : {};
  const required = normalizeStringList(safeCase.requiredBundleSubjects);
  const basePrompt = buildResidentSmokePrompt({ bundle, smokeCase: safeCase });
  const requiredText = required.length
    ? [
      "",
      "Live audit requirement:",
      "Include at least one claim for each required subject key below.",
      ...required.map((key) => `- ${key}`),
    ].join("\n")
    : "";
  return `${basePrompt}${requiredText}`;
}

function assertionRow(assertionId, expected, observed, passed, blockerCode = "assertion_failed") {
  return {
    assertionId,
    expected,
    observed,
    passed: passed === true,
    blockerCode: passed === true ? "" : blockerCode,
  };
}

function requiredSubjectPresenceAssertions(smokeCase = {}, bundle = {}) {
  const rows = Array.isArray(bundle?.policySnapshot?.rows) ? bundle.policySnapshot.rows : [];
  const present = new Set(rows.map(subjectKey));
  return normalizeStringList(smokeCase.requiredBundleSubjects).map((key) =>
    assertionRow(`required_bundle_subject_present:${key}`, true, present.has(key), present.has(key), "resident_required_subject_missing"));
}

function requiredClaimPresenceAssertions(smokeCase = {}, selfReport = {}) {
  const claims = Array.isArray(selfReport.claims) ? selfReport.claims : [];
  const claimed = new Set(claims.map(claimSubjectKey));
  return normalizeStringList(smokeCase.requiredBundleSubjects).map((key) =>
    assertionRow(`required_claim_present:${key}`, true, claimed.has(key), claimed.has(key), "resident_required_claim_missing"));
}

function requiredEvaluatedClaimAssertions(smokeCase = {}, diagnostic = {}) {
  const findings = Array.isArray(diagnostic.findings) ? diagnostic.findings : [];
  const evaluated = new Set(findings
    .filter((finding) => finding?.status === "matched" || finding?.status === "mismatch")
    .map((finding) => claimSubjectKey(finding.claim)));
  return normalizeStringList(smokeCase.requiredBundleSubjects).map((key) =>
    assertionRow(`required_claim_evaluated:${key}`, true, evaluated.has(key), evaluated.has(key), "resident_required_claim_not_evaluated"));
}

function safeTransportSummary(transportReport = {}) {
  const source = isPlainObject(transportReport) ? transportReport : {};
  return {
    status: normalizeString(source.status, ""),
    providerStarted: source.providerStarted === true,
    providerCompleted: source.providerCompleted === true,
    terminalPacketState: normalizeString(source.terminalPacketState, ""),
    terminalTurnState: normalizeString(source.terminalTurnState, ""),
    model: normalizeString(source.model, ""),
    reasoningEffort: normalizeString(source.reasoningEffort, ""),
    assistantCharCount: Math.max(0, Number(source.assistantCharCount || 0) || 0),
    rawPromptIncluded: source.rawPromptIncluded === true,
    rawResponseIncluded: source.rawResponseIncluded === true,
    rawProviderPayloadIncluded: source.rawProviderPayloadIncluded === true,
    rawAuthTokensIncluded: source.rawAuthTokensIncluded === true,
  };
}

function buildLiveResidentSelfReportCaseReport({
  smokeCase,
  bundle,
  assistantText,
  transportReport,
  promptText,
  observedAt,
} = {}) {
  const safeCase = isPlainObject(smokeCase) ? smokeCase : {};
  const parse = parseResidentSelfReportText(assistantText);
  const diagnostic = buildResidentSelfReportDiagnostics({
    snapshot: bundle?.policySnapshot,
    selfReport: parse.selfReport,
  });
  const assertions = [
    assertionRow("transport_completed", "completed", normalizeString(transportReport?.status, ""), transportReport?.status === "completed", "resident_live_transport_failed"),
    assertionRow("provider_started", true, transportReport?.providerStarted === true, transportReport?.providerStarted === true, "resident_live_provider_not_started"),
    assertionRow("provider_completed", true, transportReport?.providerCompleted === true, transportReport?.providerCompleted === true, "resident_live_provider_not_completed"),
    assertionRow("self_report_parse", true, parse.ok, parse.ok, parse.error || "resident_self_report_parse_failed"),
    assertionRow("expected_mismatch_count", Math.max(0, Number(safeCase.expectedMismatchCount || 0) || 0), diagnostic.mismatchCount, diagnostic.mismatchCount === Math.max(0, Number(safeCase.expectedMismatchCount || 0) || 0), "resident_mismatch_count_unexpected"),
    assertionRow("expected_unknown_subject_count", Math.max(0, Number(safeCase.expectedUnknownSubjectCount || 0) || 0), diagnostic.unknownSubjectCount, diagnostic.unknownSubjectCount === Math.max(0, Number(safeCase.expectedUnknownSubjectCount || 0) || 0), "resident_unknown_subject_count_unexpected"),
    ...requiredSubjectPresenceAssertions(safeCase, bundle),
    ...requiredClaimPresenceAssertions(safeCase, parse.selfReport),
    ...requiredEvaluatedClaimAssertions(safeCase, diagnostic),
  ];
  const rawTransportLeak = transportReport?.rawPromptIncluded === true ||
    transportReport?.rawResponseIncluded === true ||
    transportReport?.rawProviderPayloadIncluded === true ||
    transportReport?.rawAuthTokensIncluded === true;
  assertions.push(assertionRow("transport_raw_exposure_flags", false, rawTransportLeak, rawTransportLeak === false, "resident_live_transport_raw_exposure"));
  const status = assertions.some((entry) => entry.passed !== true) ? "fail" : "pass";
  const report = {
    schema: HEADLESS_LIVE_RESIDENT_CASE_REPORT_SCHEMA,
    caseId: normalizeString(safeCase.caseId, `live_resident_case_${shortDigest(JSON.stringify(safeCase))}`),
    caseClass: normalizeString(safeCase.caseClass, "unknown"),
    status,
    expectedStatus: normalizeString(safeCase.expectedStatus, "pass"),
    promptDigest: promptText ? sha256(promptText) : "",
    promptChars: String(promptText || "").length,
    assistantTextDigest: assistantText ? sha256(assistantText) : "",
    assistantCharCount: String(assistantText || "").length,
    parseStatus: parse.ok ? "parsed" : "failed",
    parseError: parse.error,
    claimCount: Array.isArray(parse.selfReport.claims) ? parse.selfReport.claims.length : 0,
    diagnostic,
    assertions,
    transport: safeTransportSummary(transportReport),
    observedAt: normalizeString(observedAt, nowIso()),
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    grantsAuthority: false,
    workspaceMutationStarted: false,
  };
  report.reportDigest = sha256(JSON.stringify({
    caseId: report.caseId,
    caseClass: report.caseClass,
    status: report.status,
    promptDigest: report.promptDigest,
    assistantTextDigest: report.assistantTextDigest,
    diagnosticDigest: diagnostic.diagnosticDigest,
    assertions: report.assertions,
  }));
  return report;
}

function suiteSummary(caseReports = []) {
  const byStatus = {};
  for (const report of Array.isArray(caseReports) ? caseReports : []) {
    byStatus[report.status] = Number(byStatus[report.status] || 0) + 1;
  }
  return {
    total: caseReports.length,
    pass: byStatus.pass || 0,
    fail: byStatus.fail || 0,
    byStatus,
    valid: (byStatus.fail || 0) === 0,
  };
}

function buildLiveResidentSelfReportSuiteReport({
  runId,
  suite,
  bundle,
  caseReports,
  outputEvidenceKey,
  generatedAt,
} = {}) {
  const validationErrors = validateResidentEpistemicContextBundle(bundle);
  const reports = Array.isArray(caseReports) ? caseReports : [];
  const summary = suiteSummary(reports);
  const report = {
    schema: HEADLESS_LIVE_RESIDENT_SUITE_REPORT_SCHEMA,
    runId: normalizeString(runId, `live_resident_${shortDigest(Date.now())}`),
    suiteId: normalizeString(suite?.suiteId, "headless_resident_smoke_suite_v1"),
    generatedAt: normalizeString(generatedAt, nowIso()),
    bundleDigest: normalizeString(bundle?.bundleDigest, ""),
    bundleValidationErrors: validationErrors,
    outputEvidenceKey: normalizeString(outputEvidenceKey, ""),
    caseCount: reports.length,
    summary: {
      ...summary,
      valid: summary.valid && validationErrors.length === 0,
    },
    cases: reports,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    grantsAuthority: false,
    workspaceMutationStarted: reports.some((entry) => entry.workspaceMutationStarted === true),
  };
  report.reportDigest = sha256(JSON.stringify({
    runId: report.runId,
    suiteId: report.suiteId,
    bundleDigest: report.bundleDigest,
    caseDigests: reports.map((entry) => entry.reportDigest),
    bundleValidationErrors: validationErrors,
  }));
  return report;
}

function defaultLiveResidentSuiteSelection(caseClasses = []) {
  const suite = buildDefaultHeadlessResidentSmokeSuite();
  const wanted = normalizeStringList(caseClasses);
  const cases = wanted.length
    ? suite.cases.filter((entry) => wanted.includes(entry.caseClass))
    : suite.cases.filter((entry) => entry.caseClass === "tool_visibility_self_report");
  return {
    ...suite,
    cases,
    caseCount: cases.length,
    caseClasses: cases.map((entry) => entry.caseClass),
  };
}

module.exports = {
  HEADLESS_LIVE_RESIDENT_CASE_REPORT_SCHEMA,
  HEADLESS_LIVE_RESIDENT_SUITE_REPORT_SCHEMA,
  buildDefaultResidentSmokeBundle,
  buildLiveResidentSelfReportCaseReport,
  buildLiveResidentSelfReportPrompt,
  buildLiveResidentSelfReportSuiteReport,
  defaultLiveResidentSuiteSelection,
  parseResidentSelfReportText,
};
