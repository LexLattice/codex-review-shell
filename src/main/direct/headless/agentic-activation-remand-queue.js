"use strict";

const {
  digestFor,
  normalizeString,
  stableStringify,
} = require("./bridge-store");
const {
  buildGameRemand,
} = require("./agentic-game-kernel");
const {
  runFirstAgenticFixtureGameSuite,
} = require("./agentic-fixture-games");
const {
  buildDirectToolPromotionDecisionReport,
} = require("./tool-promotion-decision-report");

const DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA = "direct_agentic_activation_remand_queue@1";
const DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA = "direct_agentic_activation_remand_row@1";
const DIRECT_AGENTIC_PROMOTION_GAP_REPORT_SCHEMA = "direct_agentic_promotion_gap_report@1";
const DIRECT_AGENTIC_FOLLOWUP_PR_CANDIDATE_SCHEMA = "direct_agentic_followup_pr_candidate@1";

const REMAND_CATEGORIES = new Set([
  "missing_activation",
  "missing_provider_declaration",
  "missing_context_source_ref",
  "missing_authority_event",
  "missing_result_envelope",
  "missing_context_admission",
  "role_prompt_insufficient",
  "role_boundary_violation",
  "topology_identity_loss",
  "resident_overclaim",
  "resident_underclaim",
  "unexpected_mutation",
  "wrong_work_thread",
  "memory_authority_laundering",
  "external_truth_laundering",
  "provider_result_laundering",
]);
const REMAND_SEVERITIES = new Set(["blocking", "major", "minor", "diagnostic"]);
const REMAND_OWNERS = new Set([
  "role_pack",
  "context_builder",
  "capability_activation",
  "authority_gate",
  "result_admission",
  "topology_runtime",
  "resident_epistemics",
  "tool_executor",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nowIso(nowMs = Date.now()) {
  const ms = Number(nowMs);
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => normalizeString(item, "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function countBy(rows, getter) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeString(typeof getter === "function" ? getter(row) : row?.[getter], "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function severityRank(value = "") {
  return {
    blocking: 0,
    major: 1,
    minor: 2,
    diagnostic: 3,
  }[normalizeString(value, "diagnostic")] ?? 3;
}

function candidateSlug(value = "") {
  return normalizeString(value, "followup")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "followup";
}

function evidenceRef(kind, label, extra = {}) {
  return {
    evidenceId: normalizeString(extra.evidenceId, `evidence_${digestFor("agentic-activation-remand-evidence@1", { kind, label, extra }).slice(7, 23)}`),
    evidenceKind: normalizeString(kind, "unknown"),
    rendererSafeLabel: normalizeString(label, kind || "Evidence"),
    ...extra,
  };
}

function ownerForCategory(category = "", fallback = "capability_activation") {
  const safe = normalizeEnum(category, REMAND_CATEGORIES, "missing_activation");
  if (safe === "role_prompt_insufficient" || safe === "role_boundary_violation") return "role_pack";
  if (safe === "missing_context_source_ref" || safe === "missing_context_admission") return "context_builder";
  if (safe === "missing_result_envelope" || safe.endsWith("_laundering")) return "result_admission";
  if (safe === "unexpected_mutation" || safe === "missing_authority_event") return "authority_gate";
  if (safe === "topology_identity_loss") return "topology_runtime";
  if (safe === "resident_overclaim" || safe === "resident_underclaim") return "resident_epistemics";
  return normalizeEnum(fallback, REMAND_OWNERS, "capability_activation");
}

function severityForPromotionDecision(decision = {}) {
  const state = normalizeString(decision.state, "");
  if (state === "blocked") return "blocking";
  if (state === "needs_more_evidence") return "major";
  if (state === "promotable_restricted") return "minor";
  return "diagnostic";
}

function categoryForPromotionDecision(decision = {}) {
  const blockers = normalizeStringList(decision.blockerCodes);
  const scope = isPlainObject(decision.scope) ? decision.scope : {};
  const requestShape = normalizeString(scope.requestShapeFamily, "");
  if (blockers.some((blocker) => blocker.includes("raw_exposure") || blocker.includes("workspace_effect") || blocker.includes("provider_transport"))) return "unexpected_mutation";
  if (blockers.some((blocker) => blocker.includes("provider") || blocker.includes("declaration"))) return "missing_provider_declaration";
  if (requestShape.includes("context")) return "missing_context_source_ref";
  if (normalizeString(decision.state, "") === "promotable_restricted") return "missing_authority_event";
  return "missing_activation";
}

function rowFromRemand({ remand, sourceKind, sourceReport, scenarioId = "", liveCase = null } = {}) {
  const safeRemand = isPlainObject(remand) ? remand : buildGameRemand({});
  const category = normalizeEnum(safeRemand.category, REMAND_CATEGORIES, "missing_activation");
  const severity = normalizeEnum(safeRemand.severity, REMAND_SEVERITIES, "major");
  const owner = normalizeEnum(safeRemand.suggestedOwner, REMAND_OWNERS, ownerForCategory(category));
  const row = {
    schema: DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA,
    sourceKind: normalizeString(sourceKind, "fixture_oracle_remand"),
    scenarioId: normalizeString(scenarioId || sourceReport?.scenarioId || liveCase?.scenarioId, ""),
    sourceReportDigest: normalizeString(sourceReport?.reportDigest || liveCase?.reportDigest, ""),
    sourceRemandDigest: normalizeString(safeRemand.remandDigest, ""),
    category,
    severity,
    suggestedOwner: owner,
    message: normalizeString(safeRemand.message, ""),
    toolClassId: "",
    toolName: "",
    promotionDecisionId: "",
    promotionDecisionState: "",
    evidenceRefs: [
      ...Array.isArray(safeRemand.evidenceRefs) ? safeRemand.evidenceRefs : [],
      evidenceRef("agentic_remand_source", normalizeString(sourceKind, "remand source"), {
        artifactDigest: normalizeString(sourceReport?.reportDigest || liveCase?.reportDigest, ""),
      }),
    ],
    activationGranted: false,
    providerCallStartedByQueue: false,
    workspaceMutationStartedByQueue: false,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowId = `agentic_activation_remand_${digestFor("direct-agentic-activation-remand-row@1", row).slice(7, 23)}`;
  row.rowDigest = digestFor(DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA, row);
  return row;
}

function rowFromPromotionDecision(decision = {}, sourceReport = {}) {
  const state = normalizeString(decision.state, "unknown");
  const category = categoryForPromotionDecision(decision);
  const severity = severityForPromotionDecision(decision);
  const owner = ownerForCategory(category, state === "promotable_restricted" ? "authority_gate" : "capability_activation");
  const scope = isPlainObject(decision.scope) ? decision.scope : {};
  const row = {
    schema: DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA,
    sourceKind: "promotion_decision_gap",
    scenarioId: "",
    sourceReportDigest: normalizeString(sourceReport.reportDigest, ""),
    sourceRemandDigest: "",
    category,
    severity,
    suggestedOwner: owner,
    message: normalizeString(normalizeStringList(decision.blockerCodes).join(", "), `${state}:${normalizeString(scope.toolClassId, "unknown")}`),
    toolClassId: normalizeString(scope.toolClassId, "unknown"),
    toolName: normalizeString(scope.toolName, normalizeString(scope.toolClassId, "unknown")),
    promotionDecisionId: normalizeString(decision.decisionId, ""),
    promotionDecisionState: state,
    evidenceRefs: [
      ...Array.isArray(decision.evidenceRefs) ? decision.evidenceRefs : [],
      evidenceRef("promotion_decision_gap", `${state}:${normalizeString(scope.toolClassId, "unknown")}`, {
        artifactDigest: normalizeString(decision.decisionDigest, ""),
      }),
    ],
    activationGranted: false,
    providerCallStartedByQueue: false,
    workspaceMutationStartedByQueue: false,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowId = `agentic_activation_remand_${digestFor("direct-agentic-activation-remand-row@1", row).slice(7, 23)}`;
  row.rowDigest = digestFor(DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA, row);
  return row;
}

function rowsFromFixtureReport(fixtureReport = {}) {
  const safeReport = isPlainObject(fixtureReport) ? fixtureReport : {};
  const rows = [];
  for (const oracle of Array.isArray(safeReport.oracleReports) ? safeReport.oracleReports : []) {
    for (const remand of Array.isArray(oracle.remands) ? oracle.remands : []) {
      rows.push(rowFromRemand({
        remand,
        sourceKind: "fixture_oracle_remand",
        sourceReport: oracle,
        scenarioId: oracle.scenarioId,
      }));
    }
    const runReport = isPlainObject(oracle.runReport) ? oracle.runReport : {};
    for (const remand of Array.isArray(runReport.remands) ? runReport.remands : []) {
      rows.push(rowFromRemand({
        remand,
        sourceKind: "fixture_run_remand",
        sourceReport: runReport,
        scenarioId: runReport.scenarioId || oracle.scenarioId,
      }));
    }
  }
  return rows;
}

function remandsForLiveCase(liveCase = {}) {
  const remands = [];
  const status = normalizeString(liveCase.status, "");
  if (status === "remand") {
    for (const assertion of Array.isArray(liveCase.behaviorAssertions) ? liveCase.behaviorAssertions : []) {
      if (assertion?.passed === false) {
        remands.push(buildGameRemand({
          category: "role_prompt_insufficient",
          severity: "major",
          suggestedOwner: "role_pack",
          message: normalizeString(assertion.assertionId, "live_behavior_assertion_failed"),
          evidenceRefs: [evidenceRef("live_behavior_assertion", normalizeString(assertion.assertionId, "live assertion"))],
        }));
      }
    }
    const summary = liveCase.comparisonSummary || {};
    if ((Number(summary.claimOverclaim || 0) || 0) + (Number(summary.claimUnsupported || 0) || 0) > 0) {
      remands.push(buildGameRemand({
        category: "resident_overclaim",
        severity: "major",
        suggestedOwner: "resident_epistemics",
        message: "live_resident_claim_overclaim_or_unsupported",
        evidenceRefs: [evidenceRef("live_claim_comparison", "Resident overclaim in live game")],
      }));
    }
    if ((Number(summary.claimUnderclaim || 0) || 0) + (Number(summary.claimMissing || 0) || 0) > 0) {
      remands.push(buildGameRemand({
        category: "resident_underclaim",
        severity: "minor",
        suggestedOwner: "resident_epistemics",
        message: "live_resident_claim_underclaim_or_missing",
        evidenceRefs: [evidenceRef("live_claim_comparison", "Resident underclaim in live game")],
      }));
    }
  } else if (status === "failed_transport") {
    remands.push(buildGameRemand({
      category: "missing_activation",
      severity: "major",
      suggestedOwner: "tool_executor",
      message: normalizeString(liveCase.runnerError, "live_transport_failed"),
      evidenceRefs: [evidenceRef("live_transport", "Live game transport failed")],
    }));
  }
  return remands;
}

function rowsFromLiveReport(liveReport = {}) {
  const safeReport = isPlainObject(liveReport) ? liveReport : {};
  const rows = [];
  for (const liveCase of Array.isArray(safeReport.caseReports) ? safeReport.caseReports : []) {
    for (const remand of remandsForLiveCase(liveCase)) {
      rows.push(rowFromRemand({
        remand,
        sourceKind: "live_case_remand",
        sourceReport: safeReport,
        liveCase,
        scenarioId: liveCase.scenarioId,
      }));
    }
  }
  return rows;
}

function rowsFromPromotionReport(promotionReport = {}) {
  const safeReport = isPlainObject(promotionReport) ? promotionReport : {};
  const rows = [];
  for (const decision of Array.isArray(safeReport.decisions) ? safeReport.decisions : []) {
    const state = normalizeString(decision.state, "");
    if (!["needs_more_evidence", "blocked", "promotable_restricted"].includes(state)) continue;
    rows.push(rowFromPromotionDecision(decision, safeReport));
  }
  return rows;
}

function dedupeRows(rows = []) {
  const deduped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = stableStringify({
      sourceKind: row.sourceKind,
      scenarioId: row.scenarioId,
      category: row.category,
      severity: row.severity,
      suggestedOwner: row.suggestedOwner,
      message: row.message,
      toolClassId: row.toolClassId,
      promotionDecisionId: row.promotionDecisionId,
    });
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()].sort((left, right) => (
    severityRank(left.severity) - severityRank(right.severity)
    || left.suggestedOwner.localeCompare(right.suggestedOwner)
    || left.category.localeCompare(right.category)
    || left.rowId.localeCompare(right.rowId)
  ));
}

function candidateTitle(owner = "", category = "") {
  const ownerLabel = normalizeString(owner, "owner").replace(/_/g, " ");
  const categoryLabel = normalizeString(category, "remand").replace(/_/g, " ");
  return `Address ${categoryLabel} remands for ${ownerLabel}`;
}

function buildFollowupCandidates(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = `${row.suggestedOwner}|${row.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const [owner, category] = key.split("|");
    const sortedRows = [...groupRows].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
    const candidate = {
      schema: DIRECT_AGENTIC_FOLLOWUP_PR_CANDIDATE_SCHEMA,
      candidateId: `agentic_followup_${digestFor("direct-agentic-followup-pr-candidate@1", {
        owner,
        category,
        rowDigests: sortedRows.map((row) => row.rowDigest),
      }).slice(7, 23)}`,
      candidateType: owner,
      suggestedOwner: owner,
      category,
      priority: sortedRows[0]?.severity || "diagnostic",
      title: candidateTitle(owner, category),
      branchSuggestion: `codex/direct-${candidateSlug(owner)}-${candidateSlug(category)}`,
      remandRowIds: sortedRows.map((row) => row.rowId),
      scenarioIds: normalizeStringList(sortedRows.map((row) => row.scenarioId)),
      toolClassIds: normalizeStringList(sortedRows.map((row) => row.toolClassId)),
      evidenceRefs: sortedRows.map((row) => evidenceRef("activation_remand_row", row.rowId, { artifactDigest: row.rowDigest })),
      activationGranted: false,
      providerCallStartedByCandidate: false,
      workspaceMutationStartedByCandidate: false,
      rawPromptIncluded: false,
      rawResponseIncluded: false,
      rawProviderPayloadIncluded: false,
      rawSecretIncluded: false,
    };
    candidate.candidateDigest = digestFor(DIRECT_AGENTIC_FOLLOWUP_PR_CANDIDATE_SCHEMA, candidate);
    return candidate;
  }).sort((left, right) => (
    severityRank(left.priority) - severityRank(right.priority)
    || left.suggestedOwner.localeCompare(right.suggestedOwner)
    || left.category.localeCompare(right.category)
  ));
}

function buildPromotionGapReport(rows = [], options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const promotionRows = (Array.isArray(rows) ? rows : []).filter((row) => row.sourceKind === "promotion_decision_gap");
  const report = {
    schema: DIRECT_AGENTIC_PROMOTION_GAP_REPORT_SCHEMA,
    reportId: normalizeString(opts.reportId, `direct_agentic_promotion_gap_${digestFor("direct-agentic-promotion-gap-report-source@1", {
      rowDigests: promotionRows.map((row) => row.rowDigest),
    }).slice(7, 23)}`),
    generatedAt: normalizeString(opts.generatedAt, nowIso(opts.nowMs)),
    sourcePromotionReportDigest: normalizeString(opts.promotionReport?.reportDigest, ""),
    gapCount: promotionRows.length,
    rows: promotionRows,
    summary: {
      byDecisionState: countBy(promotionRows, "promotionDecisionState"),
      byOwner: countBy(promotionRows, "suggestedOwner"),
      byCategory: countBy(promotionRows, "category"),
      toolClassIds: normalizeStringList(promotionRows.map((row) => row.toolClassId)),
    },
    activationGranted: false,
    providerCallStartedByReport: false,
    workspaceMutationStartedByReport: false,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_PROMOTION_GAP_REPORT_SCHEMA, report);
  return report;
}

function buildDirectAgenticActivationRemandQueue(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const fixtureReport = isPlainObject(opts.fixtureReport)
    ? opts.fixtureReport
    : runFirstAgenticFixtureGameSuite(opts);
  const liveReport = isPlainObject(opts.liveReport) ? opts.liveReport : null;
  const promotionReport = isPlainObject(opts.promotionReport)
    ? opts.promotionReport
    : isPlainObject(opts.liveSmokeReport)
      ? buildDirectToolPromotionDecisionReport(opts)
      : null;
  const rows = dedupeRows([
    ...rowsFromFixtureReport(fixtureReport),
    ...rowsFromLiveReport(liveReport),
    ...rowsFromPromotionReport(promotionReport),
  ]);
  const followupCandidates = buildFollowupCandidates(rows);
  const promotionGapReport = buildPromotionGapReport(rows, {
    ...opts,
    promotionReport,
  });
  const queue = {
    schema: DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA,
    queueId: normalizeString(opts.queueId, `direct_agentic_activation_remand_queue_${digestFor("direct-agentic-activation-remand-queue-source@1", {
      fixtureReportDigest: fixtureReport.reportDigest,
      liveReportDigest: liveReport?.reportDigest,
      promotionReportDigest: promotionReport?.reportDigest,
      rowDigests: rows.map((row) => row.rowDigest),
    }).slice(7, 23)}`),
    generatedAt: normalizeString(opts.generatedAt, nowIso(opts.nowMs)),
    sourceEvidence: {
      fixtureReportDigest: normalizeString(fixtureReport.reportDigest, ""),
      liveReportDigest: normalizeString(liveReport?.reportDigest, ""),
      promotionReportDigest: normalizeString(promotionReport?.reportDigest, ""),
    },
    status: "passed",
    rowCount: rows.length,
    rows,
    promotionGapReport,
    followupCandidates,
    summary: {
      bySourceKind: countBy(rows, "sourceKind"),
      byCategory: countBy(rows, "category"),
      bySeverity: countBy(rows, "severity"),
      byOwner: countBy(rows, "suggestedOwner"),
      blockingCount: rows.filter((row) => row.severity === "blocking").length,
      candidateCount: followupCandidates.length,
    },
    activationGranted: false,
    providerCallStartedByQueue: false,
    workspaceMutationStartedByQueue: false,
    runtimeDefaultChanged: false,
    rendererAuthorityGranted: false,
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  queue.queueDigest = digestFor(DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA, queue);
  return queue;
}

function validateDirectAgenticActivationRemandQueue(queue = {}) {
  const errors = [];
  if (!isPlainObject(queue) || queue.schema !== DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA) {
    return ["direct_agentic_activation_remand_queue_schema_mismatch"];
  }
  if (!Array.isArray(queue.rows)) errors.push("activation_remand_rows_missing");
  for (const row of Array.isArray(queue.rows) ? queue.rows : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA) {
      errors.push("activation_remand_row_schema_mismatch");
      continue;
    }
    if (!REMAND_CATEGORIES.has(row.category)) errors.push(`activation_remand_invalid_category:${row.rowId || ""}`);
    if (!REMAND_SEVERITIES.has(row.severity)) errors.push(`activation_remand_invalid_severity:${row.rowId || ""}`);
    if (!REMAND_OWNERS.has(row.suggestedOwner)) errors.push(`activation_remand_invalid_owner:${row.rowId || ""}`);
    if (!normalizeString(row.rowDigest, "")) errors.push(`activation_remand_missing_digest:${row.rowId || ""}`);
    for (const flag of ["activationGranted", "providerCallStartedByQueue", "workspaceMutationStartedByQueue", "rawPromptIncluded", "rawResponseIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`activation_remand_row_authority_or_raw_leak:${row.rowId || ""}:${flag}`);
    }
  }
  if (!isPlainObject(queue.promotionGapReport) || queue.promotionGapReport.schema !== DIRECT_AGENTIC_PROMOTION_GAP_REPORT_SCHEMA) {
    errors.push("promotion_gap_report_missing");
  } else {
    for (const flag of ["activationGranted", "providerCallStartedByReport", "workspaceMutationStartedByReport", "rawPromptIncluded", "rawResponseIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
      if (queue.promotionGapReport[flag] !== false) errors.push(`promotion_gap_report_authority_or_raw_leak:${flag}`);
    }
  }
  if (!Array.isArray(queue.followupCandidates)) errors.push("followup_candidates_missing");
  const rowIds = new Set((Array.isArray(queue.rows) ? queue.rows : []).map((row) => row.rowId));
  for (const candidate of Array.isArray(queue.followupCandidates) ? queue.followupCandidates : []) {
    if (!isPlainObject(candidate) || candidate.schema !== DIRECT_AGENTIC_FOLLOWUP_PR_CANDIDATE_SCHEMA) {
      errors.push("followup_candidate_schema_mismatch");
      continue;
    }
    if (!Array.isArray(candidate.remandRowIds) || !candidate.remandRowIds.length) errors.push(`followup_candidate_missing_rows:${candidate.candidateId || ""}`);
    for (const rowId of Array.isArray(candidate.remandRowIds) ? candidate.remandRowIds : []) {
      if (!rowIds.has(rowId)) errors.push(`followup_candidate_unknown_row:${candidate.candidateId || ""}:${rowId}`);
    }
    for (const flag of ["activationGranted", "providerCallStartedByCandidate", "workspaceMutationStartedByCandidate", "rawPromptIncluded", "rawResponseIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
      if (candidate[flag] !== false) errors.push(`followup_candidate_authority_or_raw_leak:${candidate.candidateId || ""}:${flag}`);
    }
  }
  const recomputedCandidates = buildFollowupCandidates(queue.rows || []);
  if (queue.summary?.candidateCount !== recomputedCandidates.length) errors.push("activation_remand_candidate_count_mismatch");
  for (const flag of ["activationGranted", "providerCallStartedByQueue", "workspaceMutationStartedByQueue", "runtimeDefaultChanged", "rendererAuthorityGranted", "rawPromptIncluded", "rawResponseIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
    if (queue[flag] !== false) errors.push(`activation_remand_queue_authority_or_raw_leak:${flag}`);
  }
  if (!normalizeString(queue.queueDigest, "")) errors.push("activation_remand_queue_missing_digest");
  return errors;
}

module.exports = {
  DIRECT_AGENTIC_ACTIVATION_REMAND_QUEUE_SCHEMA,
  DIRECT_AGENTIC_ACTIVATION_REMAND_ROW_SCHEMA,
  DIRECT_AGENTIC_FOLLOWUP_PR_CANDIDATE_SCHEMA,
  DIRECT_AGENTIC_PROMOTION_GAP_REPORT_SCHEMA,
  buildDirectAgenticActivationRemandQueue,
  buildPromotionGapReport,
  validateDirectAgenticActivationRemandQueue,
};
