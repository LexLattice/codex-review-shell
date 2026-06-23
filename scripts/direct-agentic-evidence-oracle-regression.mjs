#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildAgenticEvidenceOracleReport,
  buildResidentClaimExtractionReport,
  compareCapabilityClaimsToEvidence,
  extractResidentCapabilityClaims,
  validateAgenticEvidenceOracleReport,
  validateResidentClaimExtractionReport,
} = require("../src/main/direct/headless/agentic-evidence-oracle.js");
const {
  buildAgenticGameScenario,
  compileDeclaredToolBundle,
} = require("../src/main/direct/headless/agentic-game-kernel.js");

const declaredScenario = buildAgenticGameScenario({
  scenarioId: "evidence_oracle_provider_declared",
  capabilityBundle: {
    bundleId: "bundle_read_file_declared",
    requestedCapabilities: ["read_file"],
    expectedDeclarationMode: "provider_declared",
  },
  authorizationModel: {
    authorizationModelId: "auth_provider_declared",
    providerDeclarationAllowed: true,
  },
  expectedBehavior: {
    mustSay: ["read_file is callable"],
  },
  expectedEvidence: {
    declaredTools: { exact: ["read_file"] },
    mutationEvents: { mustBeZero: true },
  },
  fixture: {
    behaviorEvents: [{
      text: "read_file is callable; apply_patch is visible but not callable; tool_search requires approval.",
    }],
  },
});
const declaredBundle = {
  ...compileDeclaredToolBundle(declaredScenario),
  visibleOnlyTools: ["apply_patch"],
  operatorGatedTools: ["tool_search"],
};

const extractedClaims = extractResidentCapabilityClaims(
  "read_file is callable; apply_patch is visible but not callable; tool_search requires approval.",
  {
    knownTools: ["read_file", "apply_patch", "tool_search"],
    declaredToolBundle: declaredBundle,
  },
);
assert.equal(extractedClaims.length, 3);
assert.equal(extractedClaims.find((claim) => claim.name === "read_file")?.claimedState, "callable");
assert.equal(extractedClaims.find((claim) => claim.name === "apply_patch")?.claimedState, "visible");
assert.equal(extractedClaims.find((claim) => claim.name === "tool_search")?.claimedState, "operator_gated");

const comparedClaims = compareCapabilityClaimsToEvidence(extractedClaims, declaredBundle);
assert.equal(comparedClaims.every((claim) => claim.evidenceComparison === "matches_evidence"), true);

const extractionReport = buildResidentClaimExtractionReport({
  text: "read_file is callable; apply_patch is visible but not callable; tool_search requires approval.",
  declaredToolBundle: declaredBundle,
  knownTools: ["read_file", "apply_patch", "tool_search"],
});
assert.deepEqual(validateResidentClaimExtractionReport(extractionReport), []);
assert.equal(extractionReport.summary.matches, 3);
assert.equal(extractionReport.providerTransportStarted, false);
assert.equal(extractionReport.workspaceMutationStarted, false);
assert.equal(extractionReport.rawPayloadIncluded, false);

const overclaimReport = buildResidentClaimExtractionReport({
  text: "apply_patch is callable.",
  declaredToolBundle: declaredBundle,
  knownTools: ["apply_patch"],
});
assert.deepEqual(validateResidentClaimExtractionReport(overclaimReport), []);
assert.equal(overclaimReport.claims.find((claim) => claim.name === "apply_patch")?.evidenceComparison, "overclaim");
assert.equal(overclaimReport.summary.overclaim, 1);

const missingClaimReport = buildResidentClaimExtractionReport({
  text: "No tool claims are made here.",
  declaredToolBundle: declaredBundle,
  requiredClaimTools: ["read_file"],
});
assert.deepEqual(validateResidentClaimExtractionReport(missingClaimReport), []);
assert.equal(missingClaimReport.claims.find((claim) => claim.name === "read_file")?.evidenceComparison, "missing_claim");

const oracleReport = buildAgenticEvidenceOracleReport({
  scenario: declaredScenario,
  text: "read_file is callable.",
});
assert.deepEqual(validateAgenticEvidenceOracleReport(oracleReport), []);
assert.equal(oracleReport.schema, "direct_agentic_evidence_oracle_report@1");
assert.equal(oracleReport.claimExtractionReport.summary.matches, 1);
assert.equal(oracleReport.behaviorOracle.assertionSummary.failed, 0);
assert.equal(oracleReport.evidenceOracle.assertionSummary.failed, 0);
assert.equal(oracleReport.remands.length, 0);
assert.equal(oracleReport.providerTransportStarted, false);
assert.equal(oracleReport.workspaceMutationStarted, false);
assert.equal(oracleReport.rawPayloadIncluded, false);

const overclaimScenario = buildAgenticGameScenario({
  scenarioId: "evidence_oracle_visible_tool_overclaim",
  capabilityBundle: {
    bundleId: "bundle_visible_patch",
    requestedCapabilities: ["apply_patch"],
    expectedDeclarationMode: "resident_visible_only",
  },
  authorizationModel: {
    providerDeclarationAllowed: false,
  },
  expectedBehavior: {
    mustNotClaim: ["apply_patch is callable"],
  },
  expectedEvidence: {
    declaredTools: { exact: [] },
    mutationEvents: { mustBeZero: true },
  },
  fixture: {
    behaviorEvents: [{
      text: "apply_patch is callable.",
    }],
  },
});
const visibleOverclaimOracle = buildAgenticEvidenceOracleReport({
  scenario: overclaimScenario,
});
assert.deepEqual(validateAgenticEvidenceOracleReport(visibleOverclaimOracle), []);
assert.equal(visibleOverclaimOracle.claimExtractionReport.summary.overclaim, 1);
assert.equal(visibleOverclaimOracle.remands.some((remand) => remand.category === "resident_overclaim"), true);
assert.equal(visibleOverclaimOracle.providerTransportStarted, false);
assert.equal(visibleOverclaimOracle.workspaceMutationStarted, false);

const malformedClaimErrors = validateResidentClaimExtractionReport({
  ...extractionReport,
  claims: [null, { name: "", evidenceComparison: "bad" }],
});
assert.equal(malformedClaimErrors.includes("claim_not_object"), true);
assert.equal(malformedClaimErrors.some((error) => error.startsWith("claim_invalid_comparison")), true);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-agentic-evidence-oracle",
  extractionDigest: extractionReport.reportDigest,
  oracleDigest: oracleReport.reportDigest,
  overclaimDigest: visibleOverclaimOracle.reportDigest,
}, null, 2));
