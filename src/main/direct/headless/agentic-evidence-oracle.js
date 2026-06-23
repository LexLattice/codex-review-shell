"use strict";

const {
  digestFor,
  normalizeString,
  stableStringify,
} = require("./bridge-store");
const {
  buildAgenticGameScenario,
  buildGameRemand,
  compileDeclaredToolBundle,
  runAgenticGameFixtureScenario,
  validateAgenticGameRunReport,
} = require("./agentic-game-kernel");

const DIRECT_AGENTIC_EVIDENCE_ORACLE_REPORT_SCHEMA = "direct_agentic_evidence_oracle_report@1";
const DIRECT_AGENTIC_BEHAVIOR_ORACLE_REPORT_SCHEMA = "direct_agentic_behavior_oracle_report@1";
const DIRECT_RESIDENT_CLAIM_EXTRACTION_REPORT_SCHEMA = "direct_resident_claim_extraction_report@1";

const CLAIM_COMPARISONS = new Set([
  "matches_evidence",
  "overclaim",
  "underclaim",
  "unsupported_claim",
  "missing_claim",
  "ambiguous",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => normalizeString(item, "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertionSummary(assertions = []) {
  const rows = Array.isArray(assertions) ? assertions : [];
  const failed = rows.filter((row) => row?.passed === false);
  return {
    total: rows.length,
    passed: rows.filter((row) => row?.passed === true).length,
    failed: failed.length,
    failedAssertionIds: failed.map((row) => normalizeString(row.assertionId, "")).filter(Boolean),
  };
}

function normalizeClaim(input = {}) {
  const claim = {
    claimId: normalizeString(input.claimId, `resident_claim_${digestFor("resident-claim@1", input).slice(7, 23)}`),
    subject: normalizeString(input.subject, "tool"),
    name: normalizeString(input.name, "unknown"),
    claimedState: normalizeString(input.claimedState, "unknown"),
    expectedState: normalizeString(input.expectedState, ""),
    evidenceComparison: CLAIM_COMPARISONS.has(normalizeString(input.evidenceComparison, ""))
      ? normalizeString(input.evidenceComparison, "")
      : "ambiguous",
    sourceSpanPreview: normalizeString(input.sourceSpanPreview, ""),
  };
  claim.claimDigest = digestFor("resident_capability_claim@1", claim);
  return claim;
}

function splitClaimWindows(text) {
  return normalizeString(text, "")
    .split(/[\n.;]+/g)
    .map((part) => normalizeString(part, ""))
    .filter(Boolean);
}

function classifyClaimState(windowText) {
  const text = normalizeString(windowText, "").toLowerCase();
  if (!text) return "unknown";
  if (/\b(requires approval|needs approval|operator[- ]gated|operator gated|approval[- ]gated)\b/.test(text)) return "operator_gated";
  if (/\b(future[- ]owned|future owned|future capability|not implemented yet|planned)\b/.test(text)) return "future_owned";
  if (/\b(disabled|unavailable|not available|cannot call|can't call|not callable|blocked|no callable)\b/.test(text)) {
    if (/\bvisible|shown|catalogue|catalog|listed\b/.test(text)) return "visible";
    return "blocked";
  }
  if (/\b(callable|available|declared|can use|can call|exposed)\b/.test(text)) return "callable";
  if (/\b(visible|shown|catalogue|catalog|listed)\b/.test(text)) return "visible";
  return "unknown";
}

function toolMentionMatcher(toolName) {
  return new RegExp(`(?:^|[^A-Za-z0-9_./-])((?:functions\\.)?${escapeRegExp(toolName)})(?:$|[^A-Za-z0-9_./-])`, "ig");
}

function collectToolMentions(windowText, tools = []) {
  const mentions = [];
  for (const toolName of tools) {
    const matcher = toolMentionMatcher(toolName);
    let match = matcher.exec(windowText);
    while (match) {
      const capturedOffset = match[0].indexOf(match[1]);
      const start = match.index + capturedOffset;
      mentions.push({
        toolName,
        start,
        end: start + match[1].length,
      });
      match = matcher.exec(windowText);
    }
  }
  return mentions.sort((a, b) => a.start - b.start || a.end - b.end);
}

function clauseBoundaryBefore(text, index) {
  const matcher = /(?:[,;:]|\band\b|\bbut\b|\bwhile\b|\bwhereas\b|\bthen\b)/gi;
  let boundary = 0;
  let match = matcher.exec(text);
  while (match) {
    if (match.index >= index) break;
    boundary = matcher.lastIndex;
    match = matcher.exec(text);
  }
  return boundary;
}

function clauseBoundaryAfter(text, index) {
  const matcher = /(?:[,;:]|\band\b|\bbut\b|\bwhile\b|\bwhereas\b|\bthen\b)/gi;
  let match = matcher.exec(text);
  while (match) {
    if (match.index > index) return match.index;
    match = matcher.exec(text);
  }
  return text.length;
}

function claimWindowForToolMention(windowText, mention) {
  const start = clauseBoundaryBefore(windowText, mention.start);
  const end = clauseBoundaryAfter(windowText, mention.end);
  return normalizeString(windowText.slice(start, end), windowText);
}

function claimSearchTools(options = {}) {
  const declaredToolBundle = isPlainObject(options.declaredToolBundle) ? options.declaredToolBundle : {};
  return normalizeStringList([
    ...normalizeStringList(options.knownTools),
    ...normalizeStringList(declaredToolBundle.declaredTools),
    ...normalizeStringList(declaredToolBundle.visibleOnlyTools),
    ...normalizeStringList(declaredToolBundle.operatorGatedTools),
  ]);
}

function extractResidentCapabilityClaims(text, options = {}) {
  const tools = claimSearchTools(options);
  const windows = splitClaimWindows(text);
  const claimsByKey = new Map();

  for (const windowText of windows) {
    const mentions = collectToolMentions(windowText, tools);
    for (const mention of mentions) {
      const localWindow = claimWindowForToolMention(windowText, mention);
      const claimedState = classifyClaimState(localWindow);
      const key = `${mention.toolName}:${claimedState}:${localWindow}`;
      if (claimsByKey.has(key)) continue;
      claimsByKey.set(key, normalizeClaim({
        subject: "tool",
        name: mention.toolName,
        claimedState,
        evidenceComparison: "ambiguous",
        sourceSpanPreview: localWindow.length > 240 ? `${localWindow.slice(0, 237)}...` : localWindow,
      }));
    }
  }

  return [...claimsByKey.values()];
}

function buildToolStateLookup(declaredToolBundle = {}) {
  const declaredTools = normalizeStringList(declaredToolBundle.declaredTools);
  const visibleOnlyTools = normalizeStringList(declaredToolBundle.visibleOnlyTools);
  const operatorGatedTools = normalizeStringList(declaredToolBundle.operatorGatedTools);
  return {
    declaredTools,
    visibleOnlyTools,
    operatorGatedTools,
    declaredSet: new Set(declaredTools),
    visibleOnlySet: new Set(visibleOnlyTools),
    operatorGatedSet: new Set(operatorGatedTools),
  };
}

function expectedToolState(toolName, lookup = {}) {
  const name = normalizeString(toolName, "");
  if (!name) return "unknown";
  const toolLookup = lookup.declaredSet instanceof Set ? lookup : buildToolStateLookup(lookup);
  if (toolLookup.declaredSet.has(name)) return "callable";
  if (toolLookup.operatorGatedSet.has(name)) return "operator_gated";
  if (toolLookup.visibleOnlySet.has(name)) return "visible";
  return "not_available";
}

function compareClaimToExpected(claim, expectedState) {
  const claimed = normalizeString(claim?.claimedState, "unknown");
  if (claimed === "unknown") return "ambiguous";
  if (expectedState === "callable") {
    return claimed === "callable" ? "matches_evidence" : "underclaim";
  }
  if (expectedState === "operator_gated") {
    if (claimed === "operator_gated" || claimed === "blocked" || claimed === "visible") return "matches_evidence";
    return claimed === "callable" ? "overclaim" : "ambiguous";
  }
  if (expectedState === "visible") {
    if (claimed === "visible" || claimed === "blocked" || claimed === "disabled") return "matches_evidence";
    return claimed === "callable" ? "overclaim" : "ambiguous";
  }
  if (expectedState === "not_available") {
    if (claimed === "blocked" || claimed === "disabled" || claimed === "not_available" || claimed === "future_owned") return "matches_evidence";
    return claimed === "callable" || claimed === "operator_gated" || claimed === "visible" ? "unsupported_claim" : "ambiguous";
  }
  return "ambiguous";
}

function compareCapabilityClaimsToEvidence(claims = [], declaredToolBundle = {}, options = {}) {
  const normalizedClaims = (Array.isArray(claims) ? claims : []).map(normalizeClaim);
  const lookup = buildToolStateLookup(declaredToolBundle);
  const expectedTools = normalizeStringList([
    ...lookup.declaredTools,
    ...lookup.visibleOnlyTools,
    ...lookup.operatorGatedTools,
    ...normalizeStringList(options.requiredClaimTools),
  ]);
  const compared = normalizedClaims.map((claim) => {
    const expectedState = expectedToolState(claim.name, lookup);
    return normalizeClaim({
      ...claim,
      expectedState,
      evidenceComparison: compareClaimToExpected(claim, expectedState),
    });
  });
  const claimedNames = new Set(compared.map((claim) => claim.name));
  for (const toolName of expectedTools) {
    if (claimedNames.has(toolName)) continue;
    compared.push(normalizeClaim({
      subject: "tool",
      name: toolName,
      claimedState: "unknown",
      expectedState: expectedToolState(toolName, lookup),
      evidenceComparison: "missing_claim",
      sourceSpanPreview: "",
    }));
  }
  return compared;
}

function buildResidentClaimExtractionReport(input = {}) {
  const declaredToolBundle = isPlainObject(input.declaredToolBundle) ? input.declaredToolBundle : {};
  const text = normalizeString(input.text, "");
  const extractedClaims = extractResidentCapabilityClaims(text, {
    knownTools: input.knownTools,
    declaredToolBundle,
  });
  const comparedClaims = compareCapabilityClaimsToEvidence(extractedClaims, declaredToolBundle, {
    requiredClaimTools: input.requiredClaimTools,
  });
  const summary = {};
  for (const claim of comparedClaims) {
    summary[claim.evidenceComparison] = (summary[claim.evidenceComparison] || 0) + 1;
  }
  const report = {
    schema: DIRECT_RESIDENT_CLAIM_EXTRACTION_REPORT_SCHEMA,
    extractionId: normalizeString(input.extractionId, `resident_claim_extraction_${digestFor("resident-claim-extraction-id@1", {
      textDigest: digestFor("resident-claim-text@1", text),
      declaredToolBundleDigest: declaredToolBundle.bundleDigest,
    }).slice(7, 23)}`),
    sourceTextDigest: digestFor("resident-claim-text@1", text),
    declaredToolBundleDigest: normalizeString(declaredToolBundle.bundleDigest, ""),
    claims: comparedClaims,
    summary: {
      total: comparedClaims.length,
      matches: summary.matches_evidence || 0,
      overclaim: summary.overclaim || 0,
      underclaim: summary.underclaim || 0,
      unsupportedClaim: summary.unsupported_claim || 0,
      missingClaim: summary.missing_claim || 0,
      ambiguous: summary.ambiguous || 0,
    },
    providerTransportStarted: false,
    workspaceMutationStarted: false,
    rawPayloadIncluded: false,
  };
  report.reportDigest = digestFor(DIRECT_RESIDENT_CLAIM_EXTRACTION_REPORT_SCHEMA, report);
  return report;
}

function buildBehaviorOracleReport(input = {}) {
  const runReport = isPlainObject(input.runReport) ? input.runReport : {};
  const report = {
    schema: DIRECT_AGENTIC_BEHAVIOR_ORACLE_REPORT_SCHEMA,
    oracleId: normalizeString(input.oracleId, `behavior_oracle_${digestFor("behavior-oracle-id@1", runReport).slice(7, 23)}`),
    scenarioId: normalizeString(runReport.scenarioId, input.scenario?.scenarioId || "unknown"),
    behaviorVerdict: normalizeString(runReport.behaviorVerdict, "inconclusive"),
    assertionSummary: assertionSummary(runReport.behaviorAssertions),
    providerTransportStarted: false,
    workspaceMutationStarted: false,
    rawPayloadIncluded: false,
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_BEHAVIOR_ORACLE_REPORT_SCHEMA, report);
  return report;
}

function buildEvidenceOracleReport(input = {}) {
  const runReport = isPlainObject(input.runReport) ? input.runReport : {};
  const report = {
    schema: "direct_agentic_harness_evidence_oracle_report@1",
    oracleId: normalizeString(input.oracleId, `evidence_oracle_${digestFor("evidence-oracle-id@1", runReport).slice(7, 23)}`),
    scenarioId: normalizeString(runReport.scenarioId, input.scenario?.scenarioId || "unknown"),
    evidenceVerdict: normalizeString(runReport.evidenceVerdict, "inconclusive"),
    assertionSummary: assertionSummary(runReport.evidenceAssertions),
    authorityEventCount: Array.isArray(runReport.authorityEvents) ? runReport.authorityEvents.length : 0,
    mutationEventCount: Array.isArray(runReport.mutationEvents) ? runReport.mutationEvents.length : 0,
    contextAdmissionEventCount: Array.isArray(runReport.contextAdmissionEvents) ? runReport.contextAdmissionEvents.length : 0,
    providerTransportStarted: runReport.providerTransportStarted === true,
    workspaceMutationStarted: runReport.workspaceMutationStarted === true,
    rawPayloadIncluded: runReport.rawPayloadIncluded === true,
  };
  report.reportDigest = digestFor("direct_agentic_harness_evidence_oracle_report@1", report);
  return report;
}

function claimRemandSeverity(comparison) {
  if (comparison === "overclaim" || comparison === "unsupported_claim") return "major";
  if (comparison === "underclaim" || comparison === "missing_claim") return "minor";
  return "diagnostic";
}

function classifyRemandsForRunReport(runReport = {}, comparedClaims = []) {
  const remands = [];
  for (const assertion of Array.isArray(runReport.evidenceAssertions) ? runReport.evidenceAssertions : []) {
    if (assertion?.passed !== false) continue;
    const blocker = normalizeString(assertion.blockerCode, "missing_activation");
    remands.push(buildGameRemand({
      category: blocker === "unexpected_mutation" ? "unexpected_mutation"
        : blocker === "missing_context_source_ref" ? "missing_context_source_ref"
          : blocker.includes("declared_tool") ? "missing_provider_declaration"
            : "missing_activation",
      severity: blocker === "unexpected_mutation" ? "blocking" : "major",
      suggestedOwner: blocker === "unexpected_mutation" ? "authority_gate" : "capability_activation",
      message: normalizeString(assertion.assertionId, blocker),
    }));
  }
  for (const assertion of Array.isArray(runReport.behaviorAssertions) ? runReport.behaviorAssertions : []) {
    if (assertion?.passed !== false) {
      continue;
    }
    remands.push(buildGameRemand({
      category: "role_prompt_insufficient",
      severity: "major",
      suggestedOwner: "role_pack",
      message: normalizeString(assertion.assertionId, "behavior_assertion_failed"),
    }));
  }
  for (const claim of Array.isArray(comparedClaims) ? comparedClaims : []) {
    const comparison = normalizeString(claim.evidenceComparison, "ambiguous");
    if (comparison === "matches_evidence" || comparison === "ambiguous") continue;
    remands.push(buildGameRemand({
      category: comparison === "overclaim" || comparison === "unsupported_claim" ? "resident_overclaim" : "resident_underclaim",
      severity: claimRemandSeverity(comparison),
      suggestedOwner: "resident_epistemics",
      message: `${normalizeString(claim.name, "unknown")}:${comparison}`,
    }));
  }
  const unique = new Map();
  for (const remand of remands) unique.set(stableStringify({
    category: remand.category,
    severity: remand.severity,
    message: remand.message,
  }), remand);
  return [...unique.values()];
}

function behaviorTextFromEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((event) => normalizeString(event.text || event.message || event.claim, ""))
    .filter(Boolean)
    .join("\n");
}

function behaviorTextFromClaims(claims = []) {
  return (Array.isArray(claims) ? claims : [])
    .map((claim) => {
      const name = normalizeString(claim?.name, "");
      const state = normalizeString(claim?.claimedState, "");
      return name && state ? `${name} is ${state}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function behaviorTextFromScenario(scenario = {}) {
  return behaviorTextFromEvents(scenario.fixture?.behaviorEvents);
}

function behaviorTextFromRunReport(runReport = {}) {
  return behaviorTextFromEvents(runReport.roleBehaviorEvents)
    || behaviorTextFromClaims(runReport.residentCapabilityClaims);
}

function buildAgenticEvidenceOracleReport(input = {}) {
  const scenario = buildAgenticGameScenario(input.scenario || input);
  const runReport = isPlainObject(input.runReport) ? input.runReport : runAgenticGameFixtureScenario(scenario);
  const declaredToolBundle = isPlainObject(runReport.declaredToolBundle)
    ? runReport.declaredToolBundle
    : compileDeclaredToolBundle(scenario);
  const claimText = normalizeString(input.text, "")
    || behaviorTextFromRunReport(runReport)
    || behaviorTextFromScenario(scenario);
  const claimExtractionReport = buildResidentClaimExtractionReport({
    text: claimText,
    declaredToolBundle,
    knownTools: input.knownTools,
    requiredClaimTools: [
      ...normalizeStringList(declaredToolBundle.declaredTools),
      ...normalizeStringList(declaredToolBundle.visibleOnlyTools),
      ...normalizeStringList(declaredToolBundle.operatorGatedTools),
    ],
  });
  const behaviorOracle = buildBehaviorOracleReport({ scenario, runReport });
  const evidenceOracle = buildEvidenceOracleReport({ scenario, runReport });
  const classifiedRemands = classifyRemandsForRunReport(runReport, claimExtractionReport.claims);
  const report = {
    schema: DIRECT_AGENTIC_EVIDENCE_ORACLE_REPORT_SCHEMA,
    oracleRunId: normalizeString(input.oracleRunId, `agentic_evidence_oracle_${digestFor("agentic-evidence-oracle-run@1", {
      scenarioDigest: scenario.scenarioDigest,
      runDigest: runReport.reportDigest,
      claimDigest: claimExtractionReport.reportDigest,
    }).slice(7, 23)}`),
    scenarioId: scenario.scenarioId,
    scenarioDigest: scenario.scenarioDigest,
    runReport,
    claimExtractionReport,
    behaviorOracle,
    evidenceOracle,
    remands: classifiedRemands,
    providerTransportStarted: runReport.providerTransportStarted === true,
    workspaceMutationStarted: runReport.workspaceMutationStarted === true,
    rawPayloadIncluded: runReport.rawPayloadIncluded === true,
  };
  report.reportDigest = digestFor(DIRECT_AGENTIC_EVIDENCE_ORACLE_REPORT_SCHEMA, report);
  return report;
}

function validateResidentClaimExtractionReport(value = {}) {
  const errors = [];
  if (!isPlainObject(value)) return ["claim_report_not_object"];
  if (value.schema !== DIRECT_RESIDENT_CLAIM_EXTRACTION_REPORT_SCHEMA) errors.push("claim_report_schema_mismatch");
  if (!Array.isArray(value.claims)) errors.push("claim_report_missing_claims");
  for (const claim of Array.isArray(value.claims) ? value.claims : []) {
    if (!isPlainObject(claim)) {
      errors.push("claim_not_object");
      continue;
    }
    if (!normalizeString(claim.name, "")) errors.push("claim_missing_name");
    if (!CLAIM_COMPARISONS.has(normalizeString(claim.evidenceComparison, ""))) errors.push(`claim_invalid_comparison:${claim.name || "unknown"}`);
  }
  if (value.providerTransportStarted === true) errors.push("claim_report_started_provider_transport");
  if (value.workspaceMutationStarted === true) errors.push("claim_report_started_workspace_mutation");
  if (value.rawPayloadIncluded === true) errors.push("claim_report_raw_payload_included");
  if (!normalizeString(value.reportDigest, "")) errors.push("claim_report_missing_digest");
  return errors;
}

function validateAgenticEvidenceOracleReport(value = {}) {
  const errors = [];
  if (!isPlainObject(value)) return ["oracle_report_not_object"];
  if (value.schema !== DIRECT_AGENTIC_EVIDENCE_ORACLE_REPORT_SCHEMA) errors.push("oracle_report_schema_mismatch");
  errors.push(...validateAgenticGameRunReport(value.runReport).map((error) => `run:${error}`));
  errors.push(...validateResidentClaimExtractionReport(value.claimExtractionReport).map((error) => `claims:${error}`));
  if (!isPlainObject(value.behaviorOracle)) errors.push("oracle_report_missing_behavior_oracle");
  if (!isPlainObject(value.evidenceOracle)) errors.push("oracle_report_missing_evidence_oracle");
  if (!Array.isArray(value.remands)) errors.push("oracle_report_missing_remands");
  if (value.providerTransportStarted === true) errors.push("oracle_report_started_provider_transport");
  if (value.workspaceMutationStarted === true) errors.push("oracle_report_started_workspace_mutation");
  if (value.rawPayloadIncluded === true) errors.push("oracle_report_raw_payload_included");
  if (!normalizeString(value.reportDigest, "")) errors.push("oracle_report_missing_digest");
  return errors;
}

module.exports = {
  DIRECT_AGENTIC_BEHAVIOR_ORACLE_REPORT_SCHEMA,
  DIRECT_AGENTIC_EVIDENCE_ORACLE_REPORT_SCHEMA,
  DIRECT_RESIDENT_CLAIM_EXTRACTION_REPORT_SCHEMA,
  buildAgenticEvidenceOracleReport,
  buildBehaviorOracleReport,
  buildEvidenceOracleReport,
  buildResidentClaimExtractionReport,
  classifyRemandsForRunReport,
  compareCapabilityClaimsToEvidence,
  extractResidentCapabilityClaims,
  validateAgenticEvidenceOracleReport,
  validateResidentClaimExtractionReport,
};
