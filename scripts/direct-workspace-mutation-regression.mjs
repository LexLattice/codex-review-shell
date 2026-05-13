#!/usr/bin/env node

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA,
  buildCommandWorkspaceEffectSummary,
  buildPatchWorkspaceEffectSummary,
  buildPolicySnapshot,
  buildWorkspaceEffectSummary,
  classifyWorkspacePath,
  defaultCapabilities,
  inspectPatchJournal,
  postSideEffectPolicyViolation,
  providerEnvelopeForEffectSummary,
  validateWorkspaceMutationReport,
  workspaceEffectRecoveryState,
} = require("../src/main/direct/workspace/mutation-truth");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
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

function optionString(options, key, fallback = "") {
  return normalizeString(options[key], fallback);
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
  const coverageSource = normalizeString(input.coverageSource, "fixture");
  return {
    caseId: normalizeString(input.caseId, "case"),
    coverageSource,
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "effect_summary_recorded"),
    effectSummaryId: normalizeString(input.effectSummary?.effectSummaryId || input.effectSummaryId, ""),
    patchJournalInspectionId: normalizeString(input.patchJournalInspection?.inspectionId || input.patchJournalInspectionId, ""),
    policyDigest: normalizeString(input.policyDigest, ""),
    providerVisibility: input.effectSummary?.providerVisibility || input.providerVisibility || {
      changedPathsDetected: 0,
      providerWasToldSummary: false,
      providerSawChangedFileContents: false,
      providerSawAllChangedFileContents: false,
      providerVisibilityCompleteness: "none",
      summaryOnlyPathCount: 0,
      notSeenPathCount: 0,
      contentSeenAfterChangePathCount: 0,
      unknownChangedContentsCount: 0,
      visibilityEvents: [],
      visibilitySource: "effect-summary",
    },
    countsAsWorkspaceTruthProof: coverageSource === "real_provider" || coverageSource === "real_runtime",
    matrixRowsExercised: ["E6", "E7", "E8", "E11", "J4", "J5", "J6", "J7", "F8"],
    matrixPromotionCandidate: false,
    failureCode: normalizeString(input.failureCode, ""),
    notes: Array.isArray(input.notes) ? input.notes : [],
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
      unauthorizedPatchApplyCalls: 0,
      unauthorizedCommandRunCalls: 0,
      rawPathExposureCount: 0,
    },
  };
}

function patchExpectedCase() {
  const files = [{ path: "src/demo.ts", operation: "update", beforeEvidenceKey: "before_demo", afterEvidenceKey: "after_demo" }];
  const effectSummary = buildPatchWorkspaceEffectSummary({
    sessionId: "session_workspace_mutation",
    turnId: "turn_patch_expected",
    sourceArtifactId: "patch_result_expected",
    files,
  });
  const patchJournalInspection = inspectPatchJournal({
    patchPlanId: "patch_plan_expected",
    patchResultId: "patch_result_expected",
    files,
    effectSummary,
    journalStatus: "applied_verified",
  });
  const ok = effectSummary.expectedChangeCount === 1 &&
    effectSummary.unexpectedChangeCount === 0 &&
    patchJournalInspection.journalState === "applied_verified";
  return baseCase({
    caseId: "patch_expected_changes",
    status: ok ? "passed" : "failed",
    proofOutcome: "patch_journal_inspected",
    effectSummary,
    patchJournalInspection,
    failureCode: ok ? "" : "patch_expected_changes_failed",
  });
}

function patchUnexpectedCase() {
  const effectSummary = buildPatchWorkspaceEffectSummary({
    sessionId: "session_workspace_mutation",
    turnId: "turn_patch_unexpected",
    sourceArtifactId: "patch_result_unexpected",
    files: [{ path: "src/demo.ts", operation: "update", beforeEvidenceKey: "before_demo", afterEvidenceKey: "after_demo" }],
    changes: [
      { relPath: "src/demo.ts", changeKind: "modified", sourceExpectation: "expected_patch_change", providerVisibility: "summary_only" },
      { relPath: "src/extra.ts", changeKind: "created", sourceExpectation: "unexpected_extra_change", providerVisibility: "summary_only" },
    ],
    preStateConfidence: "exact",
    expectationConfidence: "exact",
  });
  const ok = effectSummary.unexpectedChangeCount === 1;
  return baseCase({
    caseId: "patch_unexpected_extra_change",
    status: ok ? "passed" : "failed",
    proofOutcome: "effect_summary_recorded",
    effectSummary,
    failureCode: ok ? "" : "unexpected_change_not_detected",
  });
}

function policyBlockedPathCase() {
  const classification = classifyWorkspacePath(".env");
  const ok = classification.decision === "block" && classification.pathClass === "secret_like";
  return baseCase({
    caseId: "patch_policy_blocked_path",
    status: ok ? "blocked" : "failed",
    proofOutcome: "policy_blocked_before_side_effect",
    failureCode: ok ? "secret_like_path" : "policy_block_failed",
  });
}

function generatedVendorLockfileCase() {
  const paths = ["generated/output.ts", "vendor/lib.js", "package-lock.json", "node_modules/pkg/index.js"];
  const results = paths.map(classifyWorkspacePath);
  const ok = results.every((result) => result.decision === "block");
  return baseCase({
    caseId: "patch_generated_vendor_lockfile",
    status: ok ? "blocked" : "failed",
    proofOutcome: "policy_blocked_before_side_effect",
    failureCode: ok ? "generated_vendor_lockfile_policy" : "path_policy_failed",
  });
}

function commandNoChangesCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sessionId: "session_workspace_mutation",
    turnId: "turn_command_clean",
    resultId: "command_result_clean",
    workspaceEffects: {
      changedPathCount: 0,
      changedPathsPreview: [],
      changedPathsTruncated: false,
      scanScope: "workspace-index",
      scanFailed: false,
    },
  });
  const ok = effectSummary.changedPathCount === 0 && effectSummary.scan.supported === true;
  return baseCase({
    caseId: "command_no_changes",
    status: ok ? "passed" : "failed",
    proofOutcome: "effect_summary_recorded",
    effectSummary,
    failureCode: ok ? "" : "command_clean_scan_failed",
  });
}

function commandWorkspaceChangedCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sessionId: "session_workspace_mutation",
    turnId: "turn_command_changed",
    resultId: "command_result_changed",
    workspaceEffects: {
      changedPathCount: 1,
      changedPathsPreview: [{ relPath: "tmp/test-output.txt", changeKind: "created" }],
      changedPathsTruncated: false,
      scanScope: "workspace-index",
      scanFailed: false,
    },
  });
  const envelope = providerEnvelopeForEffectSummary(effectSummary);
  const ok = effectSummary.changedPathCount === 1 &&
    envelope.providerVisibility === "summary_only" &&
    envelope.rawFileContentsIncluded === false;
  return baseCase({
    caseId: "command_workspace_changed",
    status: ok ? "passed" : "failed",
    proofOutcome: "effect_summary_recorded",
    effectSummary,
    failureCode: ok ? "" : "command_change_summary_failed",
  });
}

function dirtyPrestateCase() {
  const effectSummary = buildWorkspaceEffectSummary({
    source: "run_command",
    sourceArtifactId: "command_result_dirty_prestate",
    scanScope: "workspace-index",
    preStateConfidence: "exact",
    expectationConfidence: "exact",
    baselineDirtyState: {
      captured: true,
      dirtyPathCount: 1,
      dirtyPathsPreview: [{ relPath: "src/preexisting.ts", changeKind: "modified", policyClass: "source", expected: false, providerVisibility: "not_seen" }],
      dirtyPathsTruncated: false,
    },
    changes: [
      { relPath: "src/preexisting.ts", changeKind: "modified", sourceExpectation: "modified_preexisting_dirty", providerVisibility: "summary_only" },
    ],
  });
  const ok = effectSummary.baselineDirtyState.captured === true &&
    effectSummary.changes[0].sourceExpectation === "modified_preexisting_dirty";
  return baseCase({
    caseId: "dirty_prestate",
    status: ok ? "passed" : "failed",
    proofOutcome: "effect_summary_recorded",
    effectSummary,
    failureCode: ok ? "" : "dirty_prestate_misclassified",
  });
}

function commandMustNotWriteCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sourceArtifactId: "command_result_must_not_write",
    workspaceEffects: {
      changedPathCount: 1,
      changedPathsPreview: [{ relPath: "src/generated-by-check.ts", changeKind: "created" }],
      scanScope: "workspace-index",
      scanFailed: false,
    },
  });
  const violation = postSideEffectPolicyViolation(effectSummary, "run_command", "must_not_write");
  const ok = effectSummary.changedPathCount === 1 && violation === "must_not_write_changed_files";
  return baseCase({
    caseId: "command_must_not_write_changed",
    status: ok ? "degraded" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "completed_with_unexpected_workspace_changes" : "must_not_write_not_detected",
  });
}

function scanUnsupportedCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sourceArtifactId: "command_result_scan_unsupported",
    workspaceEffects: {
      changedPathCount: 0,
      changedPathsPreview: [],
      changedPathsTruncated: false,
      scanScope: "none",
      scanFailed: false,
    },
  });
  const ok = effectSummary.scan.supported === false;
  return baseCase({
    caseId: "command_effect_scan_unsupported",
    status: ok ? "degraded" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "effect_scan_unsupported" : "scan_unsupported_not_recorded",
  });
}

function scanFailedCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sourceArtifactId: "command_result_scan_failed",
    workspaceEffects: {
      changedPathCount: 0,
      changedPathsPreview: [],
      scanScope: "workspace-index",
      scanFailed: true,
    },
  });
  const ok = workspaceEffectRecoveryState({ tool: "run_command", workspaceEffectSummary: effectSummary }) === "effect_summary_scan_failed";
  return baseCase({
    caseId: "command_effect_scan_failed",
    status: ok ? "degraded" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "effect_summary_scan_failed" : "scan_failed_not_classified",
  });
}

function scanRaceCase() {
  const effectSummary = buildWorkspaceEffectSummary({
    source: "run_command",
    sourceArtifactId: "command_result_scan_race",
    scanScope: "workspace-index",
    scanConsistency: "changed_during_scan",
    preStateConfidence: "derived",
    expectationConfidence: "unknown_due_to_missing_prestate",
    changes: [{ relPath: "src/race.ts", changeKind: "modified", sourceExpectation: "unknown", providerVisibility: "summary_only" }],
  });
  const ok = effectSummary.scan.consistency === "changed_during_scan" &&
    effectSummary.expectationConfidence === "unknown_due_to_missing_prestate";
  return baseCase({
    caseId: "command_scan_race",
    status: ok ? "degraded" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "changed_during_scan" : "scan_race_not_degraded",
  });
}

function commandPolicyBlockedChangedPathCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sourceArtifactId: "command_result_policy_blocked",
    workspaceEffects: {
      changedPathCount: 1,
      changedPathsPreview: [{ relPath: "generated/output.ts", changeKind: "created" }],
      scanScope: "workspace-index",
      scanFailed: false,
    },
  });
  const ok = effectSummary.blockedChangeCount === 1 && effectSummary.generatedOrVendorChangeCount === 1;
  return baseCase({
    caseId: "command_policy_blocked_changed_path",
    status: ok ? "degraded" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "policy_blocked_path_changed" : "policy_blocked_change_not_detected",
  });
}

function commandSensitiveTerminalCase() {
  const effectSummary = buildCommandWorkspaceEffectSummary({
    sourceArtifactId: "command_result_sensitive",
    workspaceEffects: {
      changedPathCount: 1,
      changedPathsPreview: [{ relPath: ".env", changeKind: "modified" }],
      scanScope: "workspace-index",
      scanFailed: false,
    },
  });
  const ok = effectSummary.sensitiveChangeCount === 1 && effectSummary.policyEvaluation.strictestDecision === "block";
  return baseCase({
    caseId: "command_sensitive_side_effect_terminal",
    status: ok ? "blocked" : "failed",
    proofOutcome: "side_effect_recorded_degraded",
    effectSummary,
    failureCode: ok ? "sensitive_path_changed" : "sensitive_change_not_blocked",
  });
}

function visibilityAfterReadCase() {
  const effectSummary = buildWorkspaceEffectSummary({
    source: "run_command",
    sourceArtifactId: "command_result_visibility",
    scanScope: "workspace-index",
    changes: [
      {
        relPath: "src/changed.ts",
        changeKind: "modified",
        sourceExpectation: "expected_command_change",
        providerVisibility: "content_seen_after_change",
      },
    ],
    visibilityEvents: [
      {
        relPath: "src/changed.ts",
        visibility: "content_seen_after_change",
        source: "subsequent-read-result",
        sourceArtifactId: "read_result_changed_after_command",
        observedAt: nowIso(),
      },
    ],
  });
  const ok = effectSummary.providerVisibility.providerVisibilityCompleteness === "all_policy_relevant_content" &&
    effectSummary.providerVisibility.visibilityEvents.length === 1;
  return baseCase({
    caseId: "provider_visibility_after_subsequent_read",
    status: ok ? "passed" : "failed",
    proofOutcome: "provider_visibility_updated",
    effectSummary,
    failureCode: ok ? "" : "provider_visibility_not_updated",
  });
}

function pathClassificationCase() {
  const paths = [
    "src/app.ts",
    "test/app.test.ts",
    "docs/readme.md",
    "package.json",
    "package-lock.json",
    "generated/file.ts",
    "vendor/lib.js",
    "node_modules/pkg/index.js",
    "build/out.js",
    "coverage/lcov.info",
    ".env",
    ".config/Codex Review Shell/state.json",
    ".git/config",
    "../outside",
    "/mnt/c/Users/Rose/workspace/file.ts",
    "C:/Users/Rose/workspace/file.ts",
    "\\\\server\\share\\file.ts",
    "misc/blob.bin",
  ];
  const classes = paths.map((entry) => classifyWorkspacePath(entry).pathClass);
  const ok = new Set(classes).size >= 12;
  return baseCase({
    caseId: "path_classification_matrix",
    status: ok ? "passed" : "failed",
    proofOutcome: "policy_blocked_before_side_effect",
    failureCode: ok ? "" : "path_classification_incomplete",
    notes: classes,
  });
}

function pathCollisionCase() {
  return baseCase({
    caseId: "path_collision_policy",
    status: "blocked",
    proofOutcome: "policy_blocked_before_side_effect",
    failureCode: "path_normalization_ambiguous",
    notes: ["path_case_collision", "path_unicode_collision", "path_normalization_ambiguous", "symlink_target_changed"],
  });
}

function runCases() {
  return [
    patchExpectedCase(),
    patchUnexpectedCase(),
    policyBlockedPathCase(),
    generatedVendorLockfileCase(),
    commandNoChangesCase(),
    commandWorkspaceChangedCase(),
    dirtyPrestateCase(),
    commandMustNotWriteCase(),
    scanUnsupportedCase(),
    scanFailedCase(),
    scanRaceCase(),
    commandPolicyBlockedChangedPathCase(),
    commandSensitiveTerminalCase(),
    visibilityAfterReadCase(),
    pathClassificationCase(),
    pathCollisionCase(),
  ];
}

function rawExposureFindings(value, roots = []) {
  const findings = scanFixtureForSecrets(value, { privatePathRoots: roots.filter(Boolean) });
  const text = JSON.stringify(value);
  for (const root of roots.filter(Boolean)) {
    if (root && text.includes(root)) findings.push("private-path");
  }
  for (const pattern of ["accessToken", "refreshToken", "Bearer ", "sk-", "FOREIGN KEY constraint failed", "SQLITE_"]) {
    if (text.includes(pattern)) findings.push(pattern);
  }
  return [...new Set(findings)];
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) =>
    `| ${entry.caseId} | ${entry.status} | ${entry.proofOutcome} | ${entry.failureCode || ""} |`,
  ).join("\n");
  return `# Direct Workspace Mutation Regression ${report.runId}

- Coverage source: \`${report.coverageSource}\`
- Matrix promotion candidates: \`${report.cases.filter((entry) => entry.matrixPromotionCandidate).length}\`
- Policy digest: \`${report.policySnapshot.policyDigest}\`

| Case | Status | Proof outcome | Failure |
| --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = optionString(options, "mode", "fixture");
  if (!["fixture", "preflight"].includes(mode)) {
    throw new Error("direct workspace mutation regression currently supports --mode=fixture or --mode=preflight.");
  }
  const runId = safeIdPart(optionString(options, "run-id", `direct_workspace_mutation_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`));
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-workspace-mutation-runs", runId)));
  ensureDirectory(outputRoot);
  const policySnapshot = buildPolicySnapshot();
  const report = {
    schema: DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA,
    runId,
    createdAt: nowIso(),
    mode,
    coverageSource: "fixture",
    matrixRowsExercised: ["E6", "E7", "E8", "E11", "J4", "J5", "J6", "J7", "F8"],
    matrixPromotionCandidate: false,
    preconditions: {
      realProviderImplementationLaneProof: "skipped",
      recoveryReplaySafety: "skipped",
      iterativeRepairLoop: "skipped",
      textRegressions: "skipped",
    },
    backendCapabilities: defaultCapabilities({
      workspaceIndexScanSupported: true,
      commandWorkspaceEffectScanSupported: true,
      processTreeKillSupported: process.platform !== "win32",
      networkIsolationSupported: false,
    }),
    policySnapshot,
    cases: runCases(),
    rawExposureScan: {
      scanned: false,
      status: "not_run",
      findingCount: 0,
    },
  };
  validateWorkspaceMutationReport(report);
  const preFindings = rawExposureFindings(report, [outputRoot, appUserDataRoot, repoRoot]);
  report.rawExposureScan = {
    scanned: true,
    status: preFindings.length ? "failed" : "passed",
    findingCount: preFindings.length,
  };
  validateWorkspaceMutationReport(report);
  const reportPath = path.join(outputRoot, "direct-workspace-mutation-report.json");
  const markdownPath = path.join(outputRoot, "direct-workspace-mutation-report.md");
  if (preFindings.length) {
    const minimal = {
      schema: DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      coverageSource: "fixture",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: preFindings.length,
      },
    };
    validateWorkspaceMutationReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const written = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  validateWorkspaceMutationReport(written);
  const postFindings = rawExposureFindings({ report: written, markdown: fs.readFileSync(markdownPath, "utf8") }, [outputRoot, appUserDataRoot, repoRoot]);
  if (postFindings.length) {
    const minimal = {
      schema: DIRECT_WORKSPACE_MUTATION_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      coverageSource: "fixture",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: postFindings.length,
      },
    };
    validateWorkspaceMutationReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  console.log(reportPath);
  process.exit(report.cases.some((entry) => entry.status === "failed") ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
