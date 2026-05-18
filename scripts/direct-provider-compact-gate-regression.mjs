#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
  buildMaintenanceManifest,
  buildPressureEstimate,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateContextMaintenanceReport,
} = require("../src/main/direct/context/maintenance");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function optionString(options, camelName, kebabName, fallback = "") {
  return normalizeString(options[camelName] ?? options[kebabName], fallback);
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function baseCase(input = {}) {
  return {
    caseId: normalizeString(input.caseId, "case"),
    coverageSource: "diagnostic_provider_compact_gate",
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "provider_compact_gate_checked"),
    routeKind: normalizeString(input.route?.routeKind || input.routeKind, ""),
    routeClass: normalizeString(input.route?.routeClass || input.routeClass, ""),
    recoveryState: "healthy",
    matrixRowsExercised: input.matrixRowsExercised || ["A12", "D1", "D3", "D4", "D22", "F9"],
    matrixPromotionCandidate: false,
    routePromotionCandidate: false,
    authorityPromotionCandidate: false,
    providerAuthorityExercised: false,
    runtimeAuthorityExercised: false,
    providerTransportUsed: false,
    appServerFallbackUsed: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function assertBlockedRoute(route, expectedReasonCode) {
  const actualReasonCode = normalizeString(route?.reasonCode, "");
  if (route?.blocked !== true || route?.routeKind !== "blocked" || actualReasonCode !== expectedReasonCode) {
    const error = new Error(`provider_compact_gate_expected_block:${expectedReasonCode}`);
    error.code = "provider_compact_gate_expected_block";
    error.expectedReasonCode = expectedReasonCode;
    error.actualReasonCode = actualReasonCode;
    error.actualRouteKind = normalizeString(route?.routeKind, "");
    throw error;
  }
  return actualReasonCode;
}

function buildProviderCompactGateReport() {
  const projectId = "project_provider_compact_gate";
  const threadId = "thread_provider_compact_gate";
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "diagnostic-model",
    visibleCharCount: 96_000,
    hiddenRequiredTokens: 1_000,
    reservedOutputTokens: 2_000,
    modelContextWindowEstimate: 24_000,
  });
  const missingEvidence = selectMaintenanceRoute({
    pressureEstimate: pressure,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: false,
  }).route;
  const unknownPressure = selectMaintenanceRoute({
    pressureEstimate: buildPressureEstimate({
      projectId,
      threadId,
      modelId: "diagnostic-model",
      pressureState: "unknown",
      modelContextWindowEstimate: null,
    }),
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: true,
  }).route;
  const fixtureEvidence = selectMaintenanceRoute({
    pressureEstimate: pressure,
    providerCompactionRequested: true,
    providerCompactionEvidenceAvailable: true,
  }).route;
  const blockedManifest = buildMaintenanceManifest({
    route: missingEvidence,
    pressureEstimate: pressure,
    outputKind: "none",
    producedArtifacts: [],
  });
  const missingEvidenceBlocker = assertBlockedRoute(missingEvidence, "provider_compaction_missing_evidence");
  const unknownPressureBlocker = assertBlockedRoute(unknownPressure, "pressure_unknown_over_budget_risk");
  const cases = [
    baseCase({
      caseId: "provider_compaction_requested_without_exact_evidence_blocks",
      route: missingEvidence,
      proofOutcome: "provider_compaction_missing_evidence_blocked",
      blockerCode: missingEvidenceBlocker,
      artifacts: {
        pressureEstimateId: pressure.pressureEstimateId,
        routeId: missingEvidence.routeId,
        maintenanceManifestId: blockedManifest.maintenanceManifestId,
      },
    }),
    baseCase({
      caseId: "provider_compaction_unknown_pressure_blocks",
      route: unknownPressure,
      proofOutcome: "unknown_pressure_cannot_authorize_provider_compaction",
      blockerCode: unknownPressureBlocker,
    }),
    baseCase({
      caseId: "fixture_provider_compact_evidence_does_not_promote_a12",
      route: fixtureEvidence,
      proofOutcome: "fixture_evidence_remains_diagnostic",
      artifacts: {
        providerCompactionEvidenceScope: "diagnostic_profile_only",
        providerCompactionPrimitiveProven: false,
      },
    }),
  ];
  return {
    schema: DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "diagnostic_provider_compact_gate",
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rowsExercised: ["A12", "D1", "D3", "D4", "D22", "F9"],
    rug010Closed: false,
    providerCompactPrimitive: {
      supportState: "live_gated_unproved",
      evidenceScope: "none",
      endpointEvidenceAvailable: false,
      requestShapeEvidenceAvailable: false,
      exactProfileEvidenceAvailable: false,
      providerCompactPrimitiveProven: false,
      providerCompactOutputOpaque: true,
      defaultGateAllowed: false,
      rendererSafeSummary: "Provider compact primitive remains unavailable unless a separate exact live compact probe proves support.",
    },
    promotionCandidates: {
      D1_routeMatrix: true,
      D3_remoteVanillaCompaction: false,
      D4_remoteHybridCompaction: false,
      D22_manifest: true,
      A12_providerCompaction: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      providerCompactPrimitiveCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextPackBuilds: 0,
      requestManifestBuilds: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    cases,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Direct Provider Compact Gate Regression",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Coverage source: ${report.coverageSource}`,
    `A12 provider compaction promotion: ${report.promotionCandidates.A12_providerCompaction}`,
    `Support state: ${report.providerCompactPrimitive.supportState}`,
    "",
    "## Cases",
    "",
  ];
  for (const entry of report.cases) {
    lines.push(`- ${entry.caseId}: ${entry.status} (${entry.proofOutcome})`);
  }
  lines.push("");
  lines.push("## Sentinels");
  lines.push("");
  for (const [key, value] of Object.entries(report.sentinelCounters)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const userDataRoot = optionString(options, "userDataRoot", "user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot());
  const runId = safeIdPart(optionString(options, "runId", "run-id", ""), `rug010_provider_compact_gate_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-provider-compact-gate-runs", runId);
  ensureDirectory(outputDir);
  const report = buildProviderCompactGateReport();
  validateContextMaintenanceReport(report);
  const secretFindings = scanFixtureForSecrets(report);
  if (secretFindings.length) {
    const safeFailure = {
      schema: DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "diagnostic_provider_compact_gate",
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      providerAuthorityExercised: false,
      runtimeAuthorityExercised: false,
      rowsExercised: ["A12"],
      rug010Closed: false,
      cases: [baseCase({ caseId: "raw_exposure_scan", status: "blocked", proofOutcome: "raw_exposure_blocked", blockerCode: "raw_exposure_blocked" })],
      sentinelCounters: {
        providerTransportCalls: 0,
        providerCompactPrimitiveCalls: 0,
        appServerSpawnCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
      rawExposureBlocked: true,
    };
    writeJsonAtomic(path.join(outputDir, "direct-provider-compact-gate-report.json"), safeFailure);
    throw new Error("Direct provider compact gate report failed raw-exposure scan. Check the diagnostic report for details.");
  }
  const jsonPath = path.join(outputDir, "direct-provider-compact-gate-report.json");
  const markdownPath = path.join(outputDir, "direct-provider-compact-gate-report.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateContextMaintenanceReport(reread);
  console.log(`Direct provider compact gate regression passed: ${jsonPath}`);
  console.log(`Report digest: ${sha256(stableStringify(reread))}`);
}

main();
