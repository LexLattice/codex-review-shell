"use strict";

const crypto = require("node:crypto");
const {
  buildDirectHeadlessToolClassLiveSmokeReport,
  validateDirectHeadlessToolClassLiveSmokeReport,
} = require("./tool-class-live-smoke-report");

const DIRECT_TOOL_PROMOTION_DECISION_REPORT_SCHEMA = "direct_tool_promotion_decision_report@1";
const DIRECT_TOOL_PROMOTION_DECISION_ROW_SCHEMA = "direct_tool_promotion_decision_row@1";

const DECISION_STATES = new Set([
  "promotable",
  "promotable_restricted",
  "blocked",
  "needs_more_evidence",
  "not_applicable",
]);

const EVIDENCE_CLASSES = new Set([
  "fixture_only",
  "diagnostic_only",
  "real_provider_declaration",
  "real_provider_full_loop",
  "real_runtime_full_loop",
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

function evidenceText(row = {}) {
  const refs = Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [];
  return refs.map((ref) => [
    normalizeString(ref?.kind, ""),
    normalizeString(ref?.refId, ""),
    normalizeString(ref?.state, ""),
  ].join(":").toLowerCase()).join("|");
}

function evidenceClassFor(row = {}) {
  const text = evidenceText(row);
  if (text.includes("real_runtime_full_loop")) return "real_runtime_full_loop";
  if (text.includes("real_provider_full_loop")) return "real_provider_full_loop";
  if (text.includes("real_provider_declaration") || text.includes("provider_declaration")) return "real_provider_declaration";
  if (text.includes("fixture")) return "fixture_only";
  return normalizeString(row.smokeStatus, "") === "live_smoke_passed" ? "diagnostic_only" : "fixture_only";
}

function authorityFamilyFor(toolClassId = "") {
  const id = normalizeString(toolClassId, "").toLowerCase();
  if (id.startsWith("local_perception.")) return "local_perception";
  if (id.includes("patch_apply")) return "workspace_mutation";
  if (id.includes("run_command") || id.includes("exec_session") || id.includes("shell")) return "process_session";
  if (id.startsWith("workspace_process.")) return "process_session";
  if (id.startsWith("session_control.")) return "session_control";
  if (id.startsWith("human_authority.")) return "human_decision";
  if (id.startsWith("agent_runtime.") || id.startsWith("batch_agent.")) return "agent_runtime";
  if (id.startsWith("external.")) return "external_resource";
  if (id.startsWith("provider_hosted.")) return "provider_hosted";
  if (id.startsWith("structured_execution.")) return "code_mode";
  if (id.startsWith("plugin.")) return "external_resource";
  return "session_control";
}

function requestShapeFamilyFor(row = {}) {
  const toolClassId = normalizeString(row.toolClassId, "").toLowerCase();
  const toolIds = normalizeStringList(row.toolIdsCovered).map((toolId) => toolId.toLowerCase());
  if (toolClassId.includes("workspace_read") || toolIds.some((toolId) => toolId.includes("read"))) return "read_file";
  if (toolClassId.includes("image_view")) return "view_image_metadata";
  if (toolClassId.includes("patch_apply")) return "apply_patch";
  if (toolClassId.includes("run_command")) return "run_command";
  if (toolClassId.includes("exec_session")) return "stateful_exec_session";
  if (toolClassId.includes("sub_agent")) return "text_only_sub_agent";
  if (toolClassId.includes("context")) return "context_status_or_control";
  if (toolClassId.includes("provider_hosted")) return "provider_hosted_tool";
  if (toolClassId.includes("external")) return "external_capability_or_resource";
  return "direct_tool_class";
}

function fullLoopEvidence(evidenceClass = "") {
  return ["real_provider_full_loop", "real_runtime_full_loop"].includes(evidenceClass);
}

function providerTransportAllowed(row = {}, evidenceClass = "") {
  return row.providerTransportStarted !== true || fullLoopEvidence(evidenceClass);
}

function workspaceEffectAllowed(row = {}, evidenceClass = "") {
  if (row.workspaceMutationStartedBySmoke !== true) return true;
  const family = authorityFamilyFor(row.toolClassId);
  return fullLoopEvidence(evidenceClass) && ["workspace_mutation", "process_session", "code_mode"].includes(family);
}

function negativeEvidenceFor(row = {}, evidenceClass = "") {
  const rawFields = ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"];
  const noRawExposure = rawFields.every((field) => row[field] === false);
  return {
    noRawExposure,
    noRendererAuthorityGrant: row.rendererAuthorityGranted === false,
    noOutOfContractProviderTransport: providerTransportAllowed(row, evidenceClass),
    noOutOfContractWorkspaceEffect: workspaceEffectAllowed(row, evidenceClass),
    noContextSmuggling: noRawExposure && row.rawResultIncluded === false,
    noReplayUnsafeState: true,
  };
}

function negativeEvidenceBlockers(negativeEvidence = {}) {
  const blockers = [];
  if (negativeEvidence.noRawExposure !== true) blockers.push("raw_exposure_detected");
  if (negativeEvidence.noRendererAuthorityGrant !== true) blockers.push("renderer_authority_grant_detected");
  if (negativeEvidence.noOutOfContractProviderTransport !== true) blockers.push("out_of_contract_provider_transport_detected");
  if (negativeEvidence.noOutOfContractWorkspaceEffect !== true) blockers.push("out_of_contract_workspace_effect_detected");
  if (negativeEvidence.noContextSmuggling !== true) blockers.push("context_smuggling_detected");
  if (negativeEvidence.noReplayUnsafeState !== true) blockers.push("replay_unsafe_state_detected");
  return blockers;
}

function restrictionObjectsFor(row = {}, evidenceClass = "") {
  const restrictions = [];
  const family = authorityFamilyFor(row.toolClassId);
  if (["fixture_only", "diagnostic_only"].includes(evidenceClass)) {
    restrictions.push({ kind: "headless_only", value: "true" });
    restrictions.push({ kind: "single_turn_only", value: "smoke_or_test" });
  }
  if (evidenceClass === "real_provider_declaration") {
    restrictions.push({ kind: "provider_model_specific", value: "provider_declaration_only" });
  }
  if (family === "local_perception") {
    restrictions.push({ kind: "read_only", value: "true" });
    restrictions.push({ kind: "path_allowlist", value: "workspace_contained" });
  }
  if (["workspace_mutation", "process_session", "agent_runtime", "external_resource", "provider_hosted", "code_mode"].includes(family)) {
    restrictions.push({ kind: "human_approval_required", value: "true" });
  }
  return restrictions;
}

function freshnessFor(options = {}) {
  return {
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    expiresAt: normalizeString(options.expiresAt, ""),
    staleIfToolConstitutionDigestChanges: true,
    staleIfExecutorDigestChanges: true,
    staleIfProviderProfileDigestChanges: true,
    staleIfResultEnvelopePolicyChanges: true,
  };
}

function freshnessBlockers(freshness = {}, options = {}) {
  const blockers = [];
  const referenceAt = Date.parse(normalizeString(options.referenceAt || freshness.generatedAt, ""));
  const expiresAt = Date.parse(normalizeString(freshness.expiresAt, ""));
  if (Number.isFinite(expiresAt) && Number.isFinite(referenceAt) && expiresAt <= referenceAt) {
    blockers.push("promotion_evidence_stale");
  }
  for (const flag of ["toolConstitutionChanged", "executorDigestChanged", "providerProfileDigestChanged", "resultEnvelopePolicyChanged"]) {
    if (options[flag] === true) blockers.push(`promotion_scope_stale:${flag}`);
  }
  return blockers;
}

function decisionStateFor(row = {}, evidenceClass = "", blockers = []) {
  const smokeStatus = normalizeString(row.smokeStatus, "");
  if (smokeStatus === "blocked_by_candidate_gate") return "not_applicable";
  if (blockers.length) return "blocked";
  if (smokeStatus !== "live_smoke_passed") return "needs_more_evidence";
  if (["real_provider_full_loop", "real_runtime_full_loop"].includes(evidenceClass)) return "promotable";
  return "promotable_restricted";
}

function missingEvidenceFor(row = {}, evidenceClass = "") {
  const missing = [];
  const smokeStatus = normalizeString(row.smokeStatus, "");
  if (smokeStatus === "live_smoke_missing") missing.push("live_smoke_result_missing");
  if (smokeStatus === "live_smoke_not_requested") missing.push("live_smoke_execution_not_requested");
  if (smokeStatus === "live_smoke_failed") missing.push(...normalizeStringList(row.smokeBlockers, ["live_smoke_failed"]));
  if (smokeStatus === "live_smoke_passed" && ["fixture_only", "diagnostic_only", "real_provider_declaration"].includes(evidenceClass)) {
    missing.push("real_provider_full_loop_evidence_missing");
  }
  return normalizeStringList(missing);
}

function buildScope(row = {}, options = {}) {
  const toolClassId = normalizeString(row.toolClassId, "unknown");
  const toolIds = normalizeStringList(row.toolIdsCovered);
  return {
    toolClassId,
    toolName: normalizeString(toolIds[0], toolClassId),
    toolSchemaVersion: normalizeString(options.toolSchemaVersion, "direct_tool_class@1"),
    authorityFamily: authorityFamilyFor(toolClassId),
    requestShapeFamily: requestShapeFamilyFor(row),
    providerProfileId: normalizeString(options.providerProfileId, "provider_profile_unknown"),
    modelId: normalizeString(options.modelId, ""),
    runtimeTier: normalizeString(options.runtimeTier, "headless_direct"),
    localExecutorVersion: normalizeString(options.localExecutorVersion, "direct_executor_unknown"),
    authorityEnvelopeVersion: normalizeString(options.authorityEnvelopeVersion, "authority_envelope@1"),
    resultEnvelopeVersion: normalizeString(options.resultEnvelopeVersion, "tool_result_envelope@1"),
  };
}

function buildDecisionRow(row = {}, options = {}) {
  const safeRow = isPlainObject(row) ? row : {};
  const evidenceClass = evidenceClassFor(safeRow);
  const freshness = freshnessFor(options);
  const negativeEvidence = negativeEvidenceFor(safeRow, evidenceClass);
  const blockers = normalizeStringList([
    ...negativeEvidenceBlockers(negativeEvidence),
    ...freshnessBlockers(freshness, options),
  ]);
  const state = decisionStateFor(safeRow, evidenceClass, blockers);
  const missingEvidence = missingEvidenceFor(safeRow, evidenceClass);
  const restrictions = restrictionObjectsFor(safeRow, evidenceClass);
  const decision = {
    schema: DIRECT_TOOL_PROMOTION_DECISION_ROW_SCHEMA,
    decisionId: `tool_promotion_decision_${digestFor("direct-tool-promotion-decision-row-id@1", {
      sourceSmokeRowDigest: safeRow.rowDigest,
      toolClassId: safeRow.toolClassId,
      evidenceClass,
      state,
      blockers,
    }).slice(0, 24)}`,
    sourceLiveSmokeRowDigest: normalizeString(safeRow.rowDigest, ""),
    sourceLiveSmokeRowId: normalizeString(safeRow.rowId, ""),
    sourceSmokeStatus: normalizeString(safeRow.smokeStatus, "unknown"),
    scope: buildScope(safeRow, options),
    state,
    evidenceClass,
    restrictions,
    requiredConditionsSatisfied: normalizeStringList(safeRow.missingConditions).length === 0 && normalizeString(safeRow.smokeStatus, "") === "live_smoke_passed",
    missingEvidence,
    blockerCodes: state === "not_applicable"
      ? normalizeStringList(safeRow.smokeBlockers, ["candidate_gate_blocked"])
      : normalizeStringList([...blockers, ...(state === "needs_more_evidence" ? missingEvidence : [])]),
    evidenceRefs: Array.isArray(safeRow.evidenceRefs) ? safeRow.evidenceRefs : [],
    negativeEvidence,
    freshness,
    rendererAuthorityGranted: false,
    activationGranted: false,
    runtimeDefaultChanged: false,
    providerCallStartedByDecision: false,
    workspaceMutationStartedByDecision: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  decision.decisionDigest = digestFor("direct-tool-promotion-decision-row@1", decision);
  return decision;
}

function buildDirectToolPromotionDecisionReport(options = {}) {
  const liveSmokeReport = isPlainObject(options.liveSmokeReport)
    ? options.liveSmokeReport
    : buildDirectHeadlessToolClassLiveSmokeReport(options);
  const smokeValidationErrors = validateDirectHeadlessToolClassLiveSmokeReport(liveSmokeReport);
  const rows = (Array.isArray(liveSmokeReport.rows) ? liveSmokeReport.rows : [])
    .map((row) => buildDecisionRow(row, options));
  const decisionValidationErrors = [
    ...smokeValidationErrors,
    ...(liveSmokeReport.status !== "passed" ? [`live_smoke_report_not_passed:${normalizeString(liveSmokeReport.status, "unknown")}`] : []),
    ...rows
      .filter((row) => !DECISION_STATES.has(row.state))
      .map((row) => `invalid_promotion_decision_state:${row.scope.toolClassId}:${row.state}`),
    ...rows
      .filter((row) => !EVIDENCE_CLASSES.has(row.evidenceClass))
      .map((row) => `invalid_promotion_evidence_class:${row.scope.toolClassId}:${row.evidenceClass}`),
  ];
  const rawExposureScan = {
    passed: rows.every((row) => row.negativeEvidence.noRawExposure === true)
      && liveSmokeReport.rawPromptIncluded === false
      && liveSmokeReport.rawResultIncluded === false
      && liveSmokeReport.rawWorkspacePathIncluded === false
      && liveSmokeReport.rawSecretIncluded === false,
    blockedReasons: normalizeStringList(rows.flatMap((row) => row.negativeEvidence.noRawExposure === true ? [] : [`raw_exposure:${row.scope.toolClassId}`])),
  };
  if (!rawExposureScan.passed) decisionValidationErrors.push("promotion_raw_exposure_scan_failed");
  const report = {
    schema: DIRECT_TOOL_PROMOTION_DECISION_REPORT_SCHEMA,
    reportId: normalizeString(options.reportId, `direct_tool_promotion_decision_${digestFor("direct-tool-promotion-decision-report-source@1", {
      liveSmokeReportDigest: liveSmokeReport.reportDigest,
      rowDigests: rows.map((row) => row.decisionDigest),
    }).slice(0, 24)}`),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    sourceEvidence: {
      liveSmokeReportId: normalizeString(liveSmokeReport.reportId, ""),
      liveSmokeReportDigest: normalizeString(liveSmokeReport.reportDigest, ""),
      toolConstitutionDigest: normalizeString(options.toolConstitutionDigest, "tool_constitution_digest_unknown"),
      implementationDigest: normalizeString(options.implementationDigest, ""),
      providerProfileDigest: normalizeString(options.providerProfileDigest, ""),
    },
    status: decisionValidationErrors.length ? "failed" : "passed",
    validationErrors: decisionValidationErrors,
    decisionCount: rows.length,
    decisions: rows,
    rawExposureScan,
    summary: {
      byState: countBy(rows, "state"),
      byEvidenceClass: countBy(rows, "evidenceClass"),
      promotableToolClasses: rows.filter((row) => row.state === "promotable").map((row) => row.scope.toolClassId),
      restrictedToolClasses: rows.filter((row) => row.state === "promotable_restricted").map((row) => row.scope.toolClassId),
      blockedToolClasses: rows.filter((row) => row.state === "blocked").map((row) => row.scope.toolClassId),
      needsEvidenceToolClasses: rows.filter((row) => row.state === "needs_more_evidence").map((row) => row.scope.toolClassId),
      notApplicableToolClasses: rows.filter((row) => row.state === "not_applicable").map((row) => row.scope.toolClassId),
    },
    matrixPromotionCandidate: rows.some((row) => row.state === "promotable" && ["real_provider_full_loop", "real_runtime_full_loop"].includes(row.evidenceClass)),
    activationGranted: false,
    runtimeDefaultChanged: false,
    rendererAuthorityGranted: false,
    providerCallStartedByDecision: false,
    workspaceMutationStartedByDecision: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  report.reportDigest = digestFor("direct-tool-promotion-decision-report@1", report);
  return report;
}

function validateDirectToolPromotionDecisionReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report) || report.schema !== DIRECT_TOOL_PROMOTION_DECISION_REPORT_SCHEMA) {
    return ["direct_tool_promotion_decision_report_schema_mismatch"];
  }
  if (!Array.isArray(report.decisions) || !report.decisions.length) errors.push("promotion_decisions_missing");
  for (const row of Array.isArray(report.decisions) ? report.decisions : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_TOOL_PROMOTION_DECISION_ROW_SCHEMA) {
      errors.push("promotion_decision_row_schema_mismatch");
      continue;
    }
    if (!DECISION_STATES.has(row.state)) errors.push(`invalid_promotion_decision_state:${row.scope?.toolClassId || ""}:${row.state || ""}`);
    if (!EVIDENCE_CLASSES.has(row.evidenceClass)) errors.push(`invalid_promotion_evidence_class:${row.scope?.toolClassId || ""}:${row.evidenceClass || ""}`);
    if (row.state === "promotable" && ["fixture_only", "diagnostic_only"].includes(row.evidenceClass)) {
      errors.push(`fixture_or_diagnostic_overpromoted:${row.scope?.toolClassId || ""}`);
    }
    if (["promotable", "promotable_restricted"].includes(row.state) && (!Array.isArray(row.evidenceRefs) || !row.evidenceRefs.length)) {
      errors.push(`promoted_decision_missing_evidence_refs:${row.scope?.toolClassId || ""}`);
    }
    if (row.state === "promotable_restricted" && (!Array.isArray(row.restrictions) || !row.restrictions.length)) {
      errors.push(`restricted_promotion_missing_restrictions:${row.scope?.toolClassId || ""}`);
    }
    if (!isPlainObject(row.scope) || !row.scope.toolClassId || !row.scope.toolSchemaVersion || !row.scope.requestShapeFamily || !row.scope.runtimeTier) {
      errors.push(`promotion_scope_incomplete:${row.scope?.toolClassId || row.decisionId || ""}`);
    }
    if (!isPlainObject(row.negativeEvidence) || (Object.values(row.negativeEvidence).some((value) => value !== true) && row.state !== "blocked")) {
      errors.push(`negative_evidence_failure_without_block:${row.scope?.toolClassId || ""}`);
    }
    for (const flag of ["rendererAuthorityGranted", "activationGranted", "runtimeDefaultChanged", "providerCallStartedByDecision", "workspaceMutationStartedByDecision", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`promotion_decision_authority_or_raw_leak:${row.scope?.toolClassId || ""}:${flag}`);
    }
  }
  if (!isPlainObject(report.rawExposureScan) || (report.rawExposureScan.passed !== true && report.status !== "failed")) {
    errors.push("promotion_raw_exposure_scan_not_passed");
  }
  for (const flag of ["activationGranted", "runtimeDefaultChanged", "rendererAuthorityGranted", "providerCallStartedByDecision", "workspaceMutationStartedByDecision", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (report[flag] !== false) errors.push(`promotion_report_authority_or_raw_leak:${flag}`);
  }
  if (Array.isArray(report.validationErrors) && report.validationErrors.length && report.status !== "failed") {
    errors.push("validation_errors_without_failed_status");
  }
  return errors;
}

module.exports = {
  DIRECT_TOOL_PROMOTION_DECISION_REPORT_SCHEMA,
  DIRECT_TOOL_PROMOTION_DECISION_ROW_SCHEMA,
  buildDirectToolPromotionDecisionReport,
  validateDirectToolPromotionDecisionReport,
};
