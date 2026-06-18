#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  HEADLESS_LIVE_RESIDENT_CASE_REPORT_SCHEMA,
  HEADLESS_LIVE_RESIDENT_SUITE_REPORT_SCHEMA,
  buildDefaultResidentSmokeBundle,
  buildLiveResidentSelfReportCaseReport,
  buildLiveResidentSelfReportPrompt,
  buildLiveResidentSelfReportSuiteReport,
  defaultLiveResidentSuiteSelection,
  parseResidentSelfReportText,
} = require("../src/main/direct/headless/live-resident-self-report.js");

function caseByClass(suite, caseClass) {
  const found = suite.cases.find((entry) => entry.caseClass === caseClass);
  assert(found, `Expected case ${caseClass}`);
  return found;
}

function claim(subjectKind, subjectId, field, value) {
  return { subjectKind, subjectId, field, value };
}

const bundle = buildDefaultResidentSmokeBundle();
const suite = defaultLiveResidentSuiteSelection(["tool_visibility_self_report"]);
const toolCase = caseByClass(suite, "tool_visibility_self_report");
const prompt = buildLiveResidentSelfReportPrompt({ bundle, smokeCase: toolCase });
assert(prompt.includes("required subject key"), "live prompt should require selected subjects");
assert(prompt.includes("tool:direct.read_file"), "live prompt should include exact subject keys");

const parsed = parseResidentSelfReportText("```json\n{\"claims\":[{\"subjectKind\":\"tool\",\"subjectId\":\"direct.read_file\",\"field\":\"callableInCurrentRequest\",\"value\":true}]}\n```");
assert.equal(parsed.ok, true, "fenced JSON should parse");
assert.equal(parsed.selfReport.claims.length, 1, "parsed claims should be preserved");

const transportReport = {
  status: "completed",
  providerStarted: true,
  providerCompleted: true,
  terminalPacketState: "provider_completed",
  terminalTurnState: "completed",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  assistantCharCount: 200,
  rawPromptIncluded: false,
  rawResponseIncluded: false,
  rawProviderPayloadIncluded: false,
  rawAuthTokensIncluded: false,
};

const matchingAssistant = JSON.stringify({
  claims: [
    claim("tool", "direct.read_file", "callableInCurrentRequest", true),
    claim("tool", "direct.patch_apply", "status", "known_disabled"),
  ],
});
const passingCase = buildLiveResidentSelfReportCaseReport({
  smokeCase: toolCase,
  bundle,
  assistantText: matchingAssistant,
  transportReport,
  promptText: prompt,
});
assert.equal(passingCase.schema, HEADLESS_LIVE_RESIDENT_CASE_REPORT_SCHEMA);
assert.equal(passingCase.status, "pass", "matching live self-report should pass");
assert.equal(passingCase.diagnostic.mismatchCount, 0);
assert.equal(passingCase.diagnostic.unknownSubjectCount, 0);
assert.equal(passingCase.rawPromptIncluded, false);
assert.equal(passingCase.rawResponseIncluded, false);
assert.equal(passingCase.grantsAuthority, false);

const missingRequiredClaim = buildLiveResidentSelfReportCaseReport({
  smokeCase: toolCase,
  bundle,
  assistantText: JSON.stringify({
    claims: [claim("tool", "direct.read_file", "callableInCurrentRequest", true)],
  }),
  transportReport,
  promptText: prompt,
});
assert.equal(missingRequiredClaim.status, "fail", "omitting a required subject claim should fail");
assert(missingRequiredClaim.assertions.some((entry) => entry.assertionId === "required_claim_present:tool:direct.patch_apply" && entry.passed === false));

const unsupportedFieldRequiredClaim = buildLiveResidentSelfReportCaseReport({
  smokeCase: toolCase,
  bundle,
  assistantText: JSON.stringify({
    claims: [
      claim("tool", "direct.read_file", "unsupportedField", true),
      claim("tool", "direct.patch_apply", "status", "known_disabled"),
    ],
  }),
  transportReport,
  promptText: prompt,
});
assert.equal(unsupportedFieldRequiredClaim.status, "fail", "unsupported fields must not satisfy required claim coverage");
assert(unsupportedFieldRequiredClaim.assertions.some((entry) => entry.assertionId === "required_claim_present:tool:direct.read_file" && entry.passed === true));
assert(unsupportedFieldRequiredClaim.assertions.some((entry) => entry.assertionId === "required_claim_evaluated:tool:direct.read_file" && entry.passed === false));

const invalidJson = buildLiveResidentSelfReportCaseReport({
  smokeCase: toolCase,
  bundle,
  assistantText: "not json",
  transportReport,
  promptText: prompt,
});
assert.equal(invalidJson.status, "fail", "invalid live JSON should fail");
assert.equal(invalidJson.parseStatus, "failed");

const suiteReport = buildLiveResidentSelfReportSuiteReport({
  runId: "live_resident_fixture",
  suite,
  bundle,
  caseReports: [passingCase],
  outputEvidenceKey: "sha256:fixture",
});
assert.equal(suiteReport.schema, HEADLESS_LIVE_RESIDENT_SUITE_REPORT_SCHEMA);
assert.equal(suiteReport.summary.valid, true);
assert.equal(suiteReport.rawPromptIncluded, false);
assert.equal(suiteReport.rawProviderPayloadIncluded, false);
assert.equal(suiteReport.grantsAuthority, false);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-headless-live-resident-self-report",
  passingCaseDigest: passingCase.reportDigest,
  suiteDigest: suiteReport.reportDigest,
}, null, 2));
