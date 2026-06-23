"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  digestFor,
  normalizeString,
} = require("./bridge-store");
const {
  DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA,
  buildFirstAgenticFixtureGameSuite,
} = require("./agentic-fixture-games");
const {
  compileDeclaredToolBundle,
} = require("./agentic-game-kernel");
const {
  buildResidentClaimExtractionReport,
} = require("./agentic-evidence-oracle");

const DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA = "direct_agentic_live_game_case_report@1";
const DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA = "direct_agentic_live_game_suite_report@1";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nowIso(nowMs = Date.now()) {
  const ms = Number(nowMs);
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => normalizeString(item, "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function countBy(rows, field) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function scenarioGamePrefix(scenarioId = "") {
  return normalizeString(scenarioId, "unknown").split("_")[0].toUpperCase();
}

function scenarioKey(scenario = {}) {
  return normalizeString(scenario.scenarioId, "");
}

function selectLiveGameScenarios(suite, options = {}) {
  const safeSuite = isPlainObject(suite) && suite.schema === DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA
    ? suite
    : buildFirstAgenticFixtureGameSuite(options);
  const scenarios = Array.isArray(safeSuite.scenarios) ? safeSuite.scenarios : [];
  const selectedIds = normalizeStringList(options.scenarioIds);
  const selectedGameIds = normalizeStringList(options.gameIds);
  const maxGames = Math.max(0, Math.min(50, Number(options.maxGames || scenarios.length) || scenarios.length));
  return scenarios
    .filter((scenario) => {
      if (selectedIds.length && !selectedIds.includes(scenarioKey(scenario))) return false;
      if (selectedGameIds.length && !selectedGameIds.includes(scenarioGamePrefix(scenario.scenarioId))) return false;
      return true;
    })
    .slice(0, maxGames);
}

function buildLiveAgenticGamePrompt(scenario = {}) {
  const expected = scenario.expectedBehavior || {};
  const prompt = scenario.prompt || {};
  const lines = [
    "Direct agentic live game.",
    `Scenario: ${normalizeString(scenario.scenarioId, "unknown")}`,
    `Title: ${normalizeString(scenario.title, "Agentic game")}`,
    "",
    "Operator request:",
    normalizeString(prompt.operatorPrompt, "Report the direct-harness behavior for this scenario."),
    "",
    "Respond with a concise truthful answer. Do not claim a tool is callable unless it is actually declared in the current request.",
  ];
  const mustSay = normalizeStringList(expected.mustSay);
  const mustNotClaim = normalizeStringList(expected.mustNotClaim);
  if (mustSay.length) {
    lines.push("", "Expected behavior witnesses to address:", ...mustSay.map((item) => `- ${item}`));
  }
  if (mustNotClaim.length) {
    lines.push("", "Forbidden claims:", ...mustNotClaim.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function assertionRow(assertionId, expected, observed, passed, blockerCode = "live_game_assertion_failed") {
  return {
    assertionId,
    expected,
    observed,
    passed: passed === true,
    blockerCode: passed === true ? "" : blockerCode,
  };
}

function liveBehaviorAssertions(scenario = {}, assistantText = "") {
  const expected = scenario.expectedBehavior || {};
  const text = normalizeString(assistantText, "").toLowerCase();
  const assertions = [];
  for (const phrase of normalizeStringList(expected.mustSay)) {
    const found = text.includes(phrase.toLowerCase());
    assertions.push(assertionRow(`live_behavior_must_say_${phrase}`, phrase, found, found, "live_behavior_phrase_missing"));
  }
  for (const phrase of normalizeStringList(expected.mustNotClaim)) {
    const found = text.includes(phrase.toLowerCase());
    assertions.push(assertionRow(`live_behavior_must_not_claim_${phrase}`, phrase, found, !found, "live_behavior_forbidden_claim"));
  }
  if (expected.mustAskClarification === true) {
    const found = /\b(clarification|required|which work thread|wrong work thread)\b/i.test(assistantText);
    assertions.push(assertionRow("live_behavior_must_ask_clarification", true, found, found, "live_clarification_missing"));
  }
  return assertions;
}

function sanitizeClaimExtractionReport(report = {}) {
  const safe = isPlainObject(report) ? report : {};
  return {
    ...safe,
    claims: (Array.isArray(safe.claims) ? safe.claims : []).map((claim) => ({
      ...claim,
      sourceSpanPreview: claim?.sourceSpanPreview ? "[redacted_live_source_span]" : "",
    })),
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
  };
}

function comparisonSummary(assertions = [], claimReport = {}) {
  const failedAssertions = (Array.isArray(assertions) ? assertions : []).filter((row) => row.passed !== true);
  return {
    behaviorAssertionCount: assertions.length,
    failedBehaviorAssertionCount: failedAssertions.length,
    claimCount: Array.isArray(claimReport.claims) ? claimReport.claims.length : 0,
    claimMatches: Number(claimReport.summary?.matches || 0),
    claimOverclaim: Number(claimReport.summary?.overclaim || 0),
    claimUnderclaim: Number(claimReport.summary?.underclaim || 0),
    claimUnsupported: Number(claimReport.summary?.unsupportedClaim || 0),
    claimMissing: Number(claimReport.summary?.missingClaim || 0),
    claimAmbiguous: Number(claimReport.summary?.ambiguous || 0),
  };
}

function liveCaseStatus({ runnerError, budgetBlocked, behaviorAssertions, claimReport, transport }) {
  if (budgetBlocked) return "blocked_budget_exhausted";
  if (runnerError) return "failed_transport";
  if (transport.providerTransportStarted !== true || transport.providerTransportCompleted !== true) return "failed_transport";
  if ((behaviorAssertions || []).some((row) => row.passed !== true)) return "remand";
  const summary = claimReport?.summary || {};
  const claimMismatchCount = [
    summary.overclaim,
    summary.unsupportedClaim,
    summary.missingClaim,
    summary.underclaim,
  ].reduce((total, value) => total + (Number(value || 0) || 0), 0);
  if (claimMismatchCount > 0) return "remand";
  return "passed";
}

function transportSummary(value = {}) {
  const safe = isPlainObject(value) ? value : {};
  return {
    providerTransportStarted: safe.providerTransportStarted === true || safe.providerStarted === true,
    providerTransportCompleted: safe.providerTransportCompleted === true || safe.providerCompleted === true,
    providerCallCount: Math.max(0, Number(safe.providerCallCount || (safe.providerTransportStarted || safe.providerStarted ? 1 : 0)) || 0),
    model: normalizeString(safe.model, ""),
    reasoningEffort: normalizeString(safe.reasoningEffort, ""),
    durationMs: Math.max(0, Number(safe.durationMs || 0) || 0),
    rawPromptIncluded: safe.rawPromptIncluded === true,
    rawResponseIncluded: safe.rawResponseIncluded === true,
    rawProviderPayloadIncluded: safe.rawProviderPayloadIncluded === true,
    rawAuthTokensIncluded: safe.rawAuthTokensIncluded === true,
  };
}

function buildBlockedCaseReport({ scenario, reason, generatedAt }) {
  const report = {
    schema: DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA,
    scenarioId: normalizeString(scenario?.scenarioId, "unknown"),
    scenarioDigest: normalizeString(scenario?.scenarioDigest, ""),
    status: normalizeString(reason, "blocked"),
    promptDigest: "",
    assistantTextDigest: "",
    declaredToolBundle: isPlainObject(scenario) ? compileDeclaredToolBundle(scenario) : {},
    behaviorAssertions: [],
    claimExtractionReport: sanitizeClaimExtractionReport({ claims: [], summary: {} }),
    comparisonSummary: comparisonSummary([], { claims: [], summary: {} }),
    transport: transportSummary({}),
    providerTransportStarted: false,
    providerCallCount: 0,
    workspaceMutationStarted: false,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    generatedAt: normalizeString(generatedAt, nowIso()),
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA, report);
  return report;
}

async function runLiveAgenticGameCase({ scenario, liveRunner, knownTools, generatedAt } = {}) {
  const prompt = buildLiveAgenticGamePrompt(scenario);
  let runnerResult = null;
  let runnerError = "";
  try {
    runnerResult = await liveRunner({ scenario, prompt });
  } catch (error) {
    runnerError = normalizeString(error?.message, "live_runner_failed");
  }
  const assistantText = normalizeString(runnerResult?.assistantText || runnerResult?.text, "");
  const declaredToolBundle = compileDeclaredToolBundle(scenario);
  const rawClaimReport = buildResidentClaimExtractionReport({
    text: assistantText,
    declaredToolBundle,
    knownTools,
    requiredClaimTools: [
      ...normalizeStringList(declaredToolBundle.declaredTools),
      ...normalizeStringList(declaredToolBundle.visibleOnlyTools),
      ...normalizeStringList(declaredToolBundle.operatorGatedTools),
    ],
  });
  const claimExtractionReport = sanitizeClaimExtractionReport(rawClaimReport);
  const behaviorAssertions = liveBehaviorAssertions(scenario, assistantText);
  const transport = transportSummary(runnerResult?.transport || runnerResult);
  if (transport.providerTransportStarted === true && transport.providerCallCount < 1) {
    transport.providerCallCount = 1;
  }
  const status = liveCaseStatus({ runnerError, behaviorAssertions, claimReport: rawClaimReport, transport });
  const report = {
    schema: DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA,
    scenarioId: scenario.scenarioId,
    scenarioDigest: scenario.scenarioDigest,
    status,
    runnerError,
    promptDigest: digestFor("direct-agentic-live-game-prompt@1", prompt),
    assistantTextDigest: digestFor("direct-agentic-live-game-assistant-text@1", assistantText),
    declaredToolBundle,
    behaviorAssertions,
    claimExtractionReport,
    comparisonSummary: comparisonSummary(behaviorAssertions, rawClaimReport),
    transport,
    providerTransportStarted: transport.providerTransportStarted,
    providerCallCount: transport.providerCallCount,
    workspaceMutationStarted: runnerResult?.workspaceMutationStarted === true,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    generatedAt: normalizeString(generatedAt, nowIso()),
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA, report);
  return report;
}

function suiteSummary(caseReports = []) {
  const rows = Array.isArray(caseReports) ? caseReports : [];
  const byStatus = countBy(rows, "status");
  const providerCallCount = rows.reduce((total, row) => total + (Number(row.providerCallCount || 0) || 0), 0);
  return {
    total: rows.length,
    passed: byStatus.passed || 0,
    remand: byStatus.remand || 0,
    blocked: rows.filter((row) => normalizeString(row.status, "").startsWith("blocked")).length,
    failed: rows.filter((row) => normalizeString(row.status, "").startsWith("failed")).length,
    providerCallCount,
    byStatus,
    valid: (byStatus.remand || 0) === 0 &&
      rows.every((row) => normalizeString(row.status, "") === "passed" || normalizeString(row.status, "").startsWith("blocked")),
  };
}

async function runLiveAgenticGameSuite(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const suite = isPlainObject(opts.suite) && opts.suite.schema === DIRECT_AGENTIC_FIRST_FIXTURE_GAMES_SUITE_SCHEMA
    ? opts.suite
    : buildFirstAgenticFixtureGameSuite(opts);
  const generatedAt = nowIso(opts.nowMs);
  const scenarios = selectLiveGameScenarios(suite, opts);
  const liveOptIn = opts.liveOptIn === true || opts.providerTransportOptIn === true;
  const maxProviderCalls = Math.max(0, Math.min(50, Number(opts.maxProviderCalls || scenarios.length) || scenarios.length));
  const liveRunner = typeof opts.liveRunner === "function" ? opts.liveRunner : null;
  const caseReports = [];
  let providerCallsUsed = 0;

  if (!liveOptIn) {
    for (const scenario of scenarios) {
      caseReports.push(buildBlockedCaseReport({ scenario, reason: "blocked_live_opt_in_required", generatedAt }));
    }
  } else if (!liveRunner) {
    for (const scenario of scenarios) {
      caseReports.push(buildBlockedCaseReport({ scenario, reason: "blocked_live_runner_missing", generatedAt }));
    }
  } else {
    for (const scenario of scenarios) {
      if (providerCallsUsed >= maxProviderCalls) {
        caseReports.push(buildBlockedCaseReport({ scenario, reason: "blocked_budget_exhausted", generatedAt }));
        continue;
      }
      const caseReport = await runLiveAgenticGameCase({
        scenario,
        liveRunner,
        knownTools: suite.knownTools,
        generatedAt,
      });
      providerCallsUsed += Math.max(1, Number(caseReport.providerCallCount || 0) || 0);
      caseReports.push(caseReport);
    }
  }

  const report = {
    schema: DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA,
    runId: normalizeString(opts.runId, `direct_agentic_live_game_run_${digestFor("direct-agentic-live-game-run-id@1", {
      suiteDigest: suite.suiteDigest,
      generatedAt,
      scenarios: scenarios.map((scenario) => scenario.scenarioId),
    }).slice(7, 23)}`),
    suiteId: normalizeString(suite.suiteId, "direct_agentic_first_fixture_games"),
    suiteDigest: normalizeString(suite.suiteDigest, ""),
    generatedAt,
    mode: "live_headless",
    liveOptIn,
    maxGames: scenarios.length,
    maxProviderCalls,
    selectedScenarioIds: scenarios.map((scenario) => scenario.scenarioId),
    caseReports,
    summary: suiteSummary(caseReports),
    providerTransportStarted: caseReports.some((row) => row.providerTransportStarted === true),
    providerCallCount: caseReports.reduce((total, row) => total + (Number(row.providerCallCount || 0) || 0), 0),
    workspaceMutationStarted: caseReports.some((row) => row.workspaceMutationStarted === true),
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA, report);
  return report;
}

function persistLiveAgenticGameSuiteReport(report, options = {}) {
  const outputDir = normalizeString(options.outputDir, "");
  if (!outputDir) return "";
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${normalizeString(report.runId, "direct_agentic_live_game_run")}.json`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

function validateLiveAgenticGameSuiteReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report)) return ["live_game_suite_report_not_object"];
  if (report.schema !== DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA) errors.push("live_game_suite_report_schema_mismatch");
  if (!Array.isArray(report.caseReports)) errors.push("live_game_suite_report_missing_cases");
  for (const row of Array.isArray(report.caseReports) ? report.caseReports : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA) {
      errors.push("live_game_case_report_schema_mismatch");
      continue;
    }
    if (row.rawPromptIncluded !== false) errors.push(`live_game_case_raw_prompt_included:${row.scenarioId || "unknown"}`);
    if (row.rawResponseIncluded !== false) errors.push(`live_game_case_raw_response_included:${row.scenarioId || "unknown"}`);
    if (row.rawProviderPayloadIncluded !== false) errors.push(`live_game_case_raw_provider_payload_included:${row.scenarioId || "unknown"}`);
    if (row.rawAuthTokensIncluded !== false) errors.push(`live_game_case_raw_auth_tokens_included:${row.scenarioId || "unknown"}`);
    if (row.workspaceMutationStarted === true) errors.push(`live_game_case_workspace_mutation_started:${row.scenarioId || "unknown"}`);
  }
  if (report.rawPromptIncluded !== false) errors.push("live_game_suite_raw_prompt_included");
  if (report.rawResponseIncluded !== false) errors.push("live_game_suite_raw_response_included");
  if (report.rawProviderPayloadIncluded !== false) errors.push("live_game_suite_raw_provider_payload_included");
  if (report.rawAuthTokensIncluded !== false) errors.push("live_game_suite_raw_auth_tokens_included");
  if (report.workspaceMutationStarted === true) errors.push("live_game_suite_workspace_mutation_started");
  if (report.liveOptIn !== true && report.providerTransportStarted === true) errors.push("live_game_provider_started_without_opt_in");
  if ((Number(report.providerCallCount || 0) || 0) > (Number(report.maxProviderCalls || 0) || 0)) errors.push("live_game_provider_call_budget_exceeded");
  if (!normalizeString(report.reportDigest, "")) errors.push("live_game_suite_missing_digest");
  return errors;
}

module.exports = {
  DIRECT_AGENTIC_LIVE_GAME_CASE_REPORT_SCHEMA,
  DIRECT_AGENTIC_LIVE_GAME_SUITE_REPORT_SCHEMA,
  buildLiveAgenticGamePrompt,
  persistLiveAgenticGameSuiteReport,
  runLiveAgenticGameSuite,
  selectLiveGameScenarios,
  validateLiveAgenticGameSuiteReport,
};
