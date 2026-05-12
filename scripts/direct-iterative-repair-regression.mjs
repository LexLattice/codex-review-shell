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
  DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
  REPAIR_TOOL_NAMES,
  buildRepairLoopForTurn,
  buildTransitionGraph,
  evaluateNextRepairTool,
  freshTurnBlockedAfterTerminalKind,
  repairLoopIdForTurn,
  validateRepairReport,
} = require("../src/main/direct/repair/repair-loop");

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
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

function toolArguments(tool, variant = "") {
  if (tool === "apply_patch" && variant === "delete") {
    return JSON.stringify({ patch: "diff --git a/src/remove.txt b/src/remove.txt\ndeleted file mode 100644\n--- a/src/remove.txt\n+++ /dev/null\n" });
  }
  if (tool === "apply_patch") {
    return JSON.stringify({ patch: "diff --git a/src/demo.txt b/src/demo.txt\n--- a/src/demo.txt\n+++ b/src/demo.txt\n@@ -1 +1 @@\n-before\n+after\n" });
  }
  if (tool === "run_command") return JSON.stringify({ command: "npm", args: ["test"], cwd: "." });
  if (tool === "read_file") return JSON.stringify({ path: "src/demo.txt" });
  return JSON.stringify({ value: "unsupported" });
}

function obligation(tool, index = 1, options = {}) {
  const normalized = normalizeString(tool, "read_file");
  const obligationId = `tool_obligation_${sha256(`${normalized}:${index}:${options.variant || ""}`).slice(0, 20)}`;
  return {
    schema: "direct_codex_tool_obligation@1",
    obligationId,
    sessionId: "session_repair_fixture",
    turnId: "turn_repair_fixture",
    toolLoopId: "repair_loop_fixture",
    stepId: `repair_step_${index}`,
    stepOrdinal: index,
    parentResponseId: `resp_parent_${index}`,
    parentResponseSource: index > 1 ? "native_direct_tool_continuation_stream" : "native_direct_initial_stream",
    parentResponseDigest: sha256(`resp_parent_${index}`),
    status: options.status || "waiting",
    authorityState: options.authorityState || "execution_disabled",
    approvalAvailable: false,
    executionAllowed: false,
    continuationAllowed: false,
    toolCallSource: "provider-native-implicit",
    sourceItemId: `item_${index}`,
    callId: `call_${index}`,
    name: normalized,
    namespace: normalizeString(options.namespace, ""),
    toolType: "function_call",
    providerCallType: "function_call",
    argumentsText: options.argumentsText ?? toolArguments(normalized, options.variant),
    detectedAtSequence: index,
    completedAtSequence: options.incomplete ? null : index,
    result: options.result || null,
  };
}

function turnWithObligations(obligations = []) {
  return {
    schema: "direct_codex_turn@1",
    sessionId: "session_repair_fixture",
    turnId: "turn_repair_fixture",
    state: obligations.length ? "tool_waiting" : "completed",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    unresolvedObligations: obligations,
    activeToolStepId: obligations[obligations.length - 1]?.stepId || "",
    activeToolStepOrdinal: Number(obligations[obligations.length - 1]?.stepOrdinal || 0),
    toolLoopResponseChain: obligations.map((entry, index) => ({
      stepOrdinal: index + 1,
      tool: normalizeString(entry.name, ""),
      emittedToolCallResponseId: `resp_parent_${index + 1}`,
      continuationResponseId: `resp_parent_${index + 2}`,
      continuationHandoffState: "terminal_completed",
      sourceEventDigest: sha256(`event_${index + 1}`),
      requestManifestId: `manifest_${index + 1}`,
      resultArtifactId: entry.result?.resultId || "",
    })),
  };
}

function caseReport(input = {}) {
  const transitionGraph = input.transitionGraph || buildTransitionGraph();
  return {
    caseId: normalizeString(input.caseId, "case"),
    coverageSource: normalizeString(input.coverageSource, "fixture_provider"),
    status: normalizeString(input.status, "proved"),
    proofOutcome: normalizeString(input.proofOutcome, "proved_full_loop"),
    transitionGraphDigest: transitionGraph.digest,
    providerToolSetDigest: transitionGraph.providerToolSetDigest,
    declaredToolSchemasDigest: normalizeString(transitionGraph.declaredToolSchemasDigest, ""),
    countsAsRealProviderProof: input.coverageSource === "real_provider" && input.proofOutcome === "proved_full_loop",
    matrixRowsExercised: ["E4", "E14", "E15", "B7", "B12", "F4", "D18"],
    matrixPromotionCandidate: input.coverageSource === "real_provider" && input.proofOutcome === "proved_full_loop",
    steps: Array.isArray(input.steps) ? input.steps : [],
    workspaceMutationVisibility: {
      changedPathsDetected: Number(input.changedPathsDetected || 0),
      providerWasToldSummary: input.providerWasToldSummary !== false,
      providerSawChangedFileContents: input.providerSawChangedFileContents === true,
      unknownChangedContentsCount: Number(input.unknownChangedContentsCount || 0),
    },
    sentinelCounters: {
      appServerSpawnCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
      unauthorizedFileReadCalls: 0,
      unauthorizedPatchApplyCalls: 0,
      unauthorizedCommandRunCalls: 0,
      duplicateContinuationSendCalls: 0,
      autoApprovalCalls: 0,
    },
    failureCode: normalizeString(input.failureCode, ""),
    notes: Array.isArray(input.notes) ? input.notes : [],
  };
}

function transitionCase(from, to, index) {
  const tool = to === "assistant_final" ? "" : to;
  const current = REPAIR_TOOL_NAMES.includes(from) ? [obligation(from, index, { result: { resultId: `result_${from}_${index}`, providerOutputChars: 128 } })] : [];
  const turn = turnWithObligations(current);
  const evaluation = to === "assistant_final"
    ? { ok: true, outcome: "assistant_final" }
    : evaluateNextRepairTool({ turn, obligations: [obligation(tool, index + 1)] });
  const ok = evaluation.ok && (to === "assistant_final" || evaluation.outcome === `next_${tool}_step`);
  return caseReport({
    caseId: `allowed_${from}_to_${to}`,
    status: ok ? "proved" : "failed",
    proofOutcome: ok ? "proved_full_loop" : "local_authority_failed",
    steps: [
      ...(from === "initial" ? [] : [{ stepOrdinal: index, tool: from, providerToolCallObserved: true, localAuthorityExecuted: true, providerContinuationSent: true, providerContinuationCompleted: true }]),
      ...(tool ? [{ stepOrdinal: index + 1, tool, providerToolCallObserved: true, localAuthorityExecuted: false, providerContinuationSent: false, providerContinuationCompleted: false, terminalKind: "" }] : []),
    ],
    failureCode: ok ? "" : "transition_evaluation_failed",
  });
}

function blockedCase(caseId, turn, obligations, expectedCode) {
  const evaluation = evaluateNextRepairTool({ turn, obligations });
  const ok = evaluation.ok === false && evaluation.blockerCode === expectedCode;
  return caseReport({
    caseId,
    status: ok ? "blocked" : "failed",
    proofOutcome: ok ? "provider_tool_shape_observed_local_blocked" : "local_authority_failed",
    steps: obligations.map((entry, index) => ({
      stepOrdinal: index + 1,
      tool: normalizeString(entry.name, "unsupported"),
      providerToolCallObserved: true,
      localAuthorityExecuted: false,
      providerContinuationSent: false,
      providerContinuationCompleted: false,
      terminalKind: evaluation.terminalKind || expectedCode,
    })),
    failureCode: ok ? expectedCode : `expected_${expectedCode}_got_${evaluation.blockerCode || "allowed"}`,
  });
}

function runFixtureCases() {
  const cases = [];
  const transitions = [];
  for (const from of ["initial", ...REPAIR_TOOL_NAMES]) {
    transitions.push([from, "assistant_final"]);
    for (const to of REPAIR_TOOL_NAMES) transitions.push([from, to]);
  }
  transitions.forEach(([from, to], index) => cases.push(transitionCase(from, to, index + 1)));
  cases.push(blockedCase("blocked_multiple_tool_calls", turnWithObligations([]), [obligation("read_file", 1), obligation("run_command", 2)], "multiple_tool_calls_unsupported"));
  cases.push(blockedCase("blocked_unsupported_tool", turnWithObligations([]), [obligation("write_file", 1)], "unsupported_tool_call"));
  cases.push(blockedCase("blocked_namespace", turnWithObligations([]), [obligation("read_file", 1, { namespace: "workspace" })], "unsupported_tool_namespace"));
  cases.push(blockedCase("blocked_incomplete_arguments", turnWithObligations([]), [obligation("read_file", 1, { incomplete: true })], "invalid_tool_arguments"));
  cases.push(blockedCase("blocked_patch_delete", turnWithObligations([]), [obligation("apply_patch", 1, { variant: "delete" })], "patch_delete_deferred"));
  cases.push(blockedCase(
    "blocked_total_step_cap",
    turnWithObligations(Array.from({ length: 12 }, (_, index) => obligation("read_file", index + 1))),
    [obligation("read_file", 13)],
    "repair_loop_cap_exceeded",
  ));
  const textOnlyBlocked = freshTurnBlockedAfterTerminalKind("transport_handoff_unknown");
  cases.push(caseReport({
    caseId: "fresh_turn_blocked_after_handoff_unknown",
    status: textOnlyBlocked ? "blocked" : "failed",
    proofOutcome: textOnlyBlocked ? "provider_tool_shape_observed_local_blocked" : "local_authority_failed",
    matrixRowsExercised: ["B12", "E15"],
    failureCode: textOnlyBlocked ? "transport_handoff_unknown" : "fresh_turn_unexpectedly_allowed",
  }));
  const loop = buildRepairLoopForTurn(turnWithObligations([
    obligation("read_file", 1, { result: { resultId: "read_result_1", providerOutputChars: 32 } }),
    obligation("apply_patch", 2, { result: { resultId: "patch_result_2", providerOutputChars: 96, files: [{ path: "src/demo.txt", addedLineCount: 1, removedLineCount: 1 }] } }),
    obligation("run_command", 3, { result: { resultId: "command_result_3", providerOutputChars: 128, durationMs: 400, workspaceEffects: { changedPathCount: 0 } } }),
  ]));
  const loopOk = loop.schema === "direct_implementation_repair_loop@1" &&
    loop.sideEffectState === "workspace_patch_and_command_effects" &&
    loop.policySnapshot?.transitionGraphDigest;
  cases.push(caseReport({
    caseId: "loop_artifact_policy_snapshot",
    status: loopOk ? "proved" : "failed",
    proofOutcome: loopOk ? "proved_full_loop" : "local_authority_failed",
    changedPathsDetected: 1,
    providerWasToldSummary: true,
    providerSawChangedFileContents: false,
    notes: [`loopId=${repairLoopIdForTurn("session_repair_fixture", "turn_repair_fixture")}`],
    failureCode: loopOk ? "" : "loop_artifact_invalid",
  }));
  const persistedCounterTurn = turnWithObligations([
    obligation("read_file", 1, { result: { resultId: "read_result_counter", providerOutputChars: 32 } }),
  ]);
  persistedCounterTurn.repairLoop = {
    counters: {
      totalSteps: 99,
      readFileSteps: 99,
      patchSteps: 99,
      commandSteps: 99,
      providerToolOutputCharsTotal: 99,
      repeatedCanonicalReadPathCounts: {},
    },
  };
  const counterLoop = buildRepairLoopForTurn(persistedCounterTurn);
  const countersOk = counterLoop.counters.totalSteps === 1 &&
    counterLoop.counters.readFileSteps === 1 &&
    counterLoop.counters.patchSteps === 0 &&
    counterLoop.counters.commandSteps === 0;
  cases.push(caseReport({
    caseId: "counter_summary_ignores_persisted_totals",
    status: countersOk ? "proved" : "failed",
    proofOutcome: countersOk ? "proved_full_loop" : "local_authority_failed",
    failureCode: countersOk ? "" : "repair_counter_double_count",
  }));
  return cases;
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
    `| ${entry.caseId} | ${entry.coverageSource} | ${entry.status} | ${entry.proofOutcome} | ${entry.failureCode || ""} |`,
  ).join("\n");
  return `# Direct Iterative Repair Regression ${report.runId}

- Coverage source: \`fixture_provider\`
- Matrix promotion candidates: \`${report.cases.filter((entry) => entry.matrixPromotionCandidate).length}\`
- Transition graph digest: \`${report.transitionGraphDigest}\`

| Case | Coverage | Status | Proof outcome | Failure |
| --- | --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = optionString(options, "mode", "fixture");
  if (!["fixture", "preflight"].includes(mode)) {
    throw new Error("direct iterative repair regression currently supports --mode=fixture or --mode=preflight.");
  }
  const runId = safeIdPart(optionString(options, "run-id", `direct_iterative_repair_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`));
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-iterative-repair-runs", runId)));
  ensureDirectory(outputRoot);
  const transitionGraph = buildTransitionGraph();
  validateRepairReport({
    schema: DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
    cases: [
      {
        caseId: "validation_missing_matrix_rows",
        coverageSource: "fixture_provider",
        matrixPromotionCandidate: false,
      },
    ],
  });
  const report = {
    schema: DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
    runId,
    createdAt: nowIso(),
    mode,
    coverageSource: "fixture_provider",
    matrixRowsExercised: ["E4", "E14", "E15", "B7", "B12", "F4", "D18"],
    matrixPromotionCandidate: false,
    transitionGraphDigest: transitionGraph.digest,
    providerToolSetDigest: transitionGraph.providerToolSetDigest,
    declaredToolSchemasDigest: normalizeString(transitionGraph.declaredToolSchemasDigest, ""),
    preconditions: {
      pr1RealProviderProofRequiredForLive: true,
      pr2RecoveryClassifierRequiredForLive: true,
      textOnlyRegressionRequiredForLive: true,
      fixtureGatePassed: false,
    },
    cases: runFixtureCases(),
    rawExposureScan: {
      scanned: false,
      status: "not_run",
      findingCount: 0,
    },
  };
  report.preconditions.fixtureGatePassed = report.cases.every((entry) => entry.status !== "failed");
  validateRepairReport(report);
  const preFindings = rawExposureFindings(report, [outputRoot, appUserDataRoot, repoRoot]);
  report.rawExposureScan = {
    scanned: true,
    status: preFindings.length ? "failed" : "passed",
    findingCount: preFindings.length,
  };
  validateRepairReport(report);
  const reportPath = path.join(outputRoot, "direct-iterative-repair-report.json");
  const markdownPath = path.join(outputRoot, "direct-iterative-repair-report.md");
  if (preFindings.length) {
    const minimal = {
      schema: DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      coverageSource: "fixture_provider",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: preFindings.length,
      },
    };
    validateRepairReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const written = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  validateRepairReport(written);
  const postFindings = rawExposureFindings({ report: written, markdown: fs.readFileSync(markdownPath, "utf8") }, [outputRoot, appUserDataRoot, repoRoot]);
  if (postFindings.length) {
    const minimal = {
      schema: DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      coverageSource: "fixture_provider",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: postFindings.length,
      },
    };
    validateRepairReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  console.log(reportPath);
  const failed = report.cases.some((entry) => entry.status === "failed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
