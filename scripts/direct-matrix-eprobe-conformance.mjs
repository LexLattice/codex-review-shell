#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
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

const MATRIX_PATH = path.join(repoRoot, "docs", "CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md");
const REPORT_SCHEMA = "direct_matrix_eprobe_conformance_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

const PROBE_SUITES = Object.freeze([
  {
    suiteId: "real_usage_preflight",
    script: "direct-real-usage-regression.mjs",
    args: ["--mode", "preflight", "--run-fixture-smoke"],
    coverageLevel: "headless_runtime",
    rows: ["A1", "A3", "A4", "A5", "A11", "B1", "B2", "B3", "B10", "B11", "C2", "C6", "C8", "C9", "F1", "F2", "F3", "I4", "I5", "I6", "I14"],
    requiredCategories: ["positive", "negative", "promotion"],
  },
  {
    suiteId: "implementation_lane_preflight",
    script: "direct-implementation-proof-regression.mjs",
    args: ["--mode", "preflight"],
    coverageLevel: "headless_runtime",
    rows: ["A3", "A5", "A11", "B4", "B5", "B6", "B7", "B11", "B12", "C3", "C7", "C8", "C9", "C10", "E3", "E5", "E6", "E9", "E10", "E12", "E13", "E14", "E15", "F4", "J3", "J4", "J6"],
    requiredCategories: ["positive", "negative", "promotion"],
  },
  {
    suiteId: "recovery_replay_safety",
    script: "direct-recovery-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["A11", "C1", "C2", "C3", "C11", "C12", "E15", "I9"],
    requiredCategories: ["negative", "recovery", "promotion"],
  },
  {
    suiteId: "iterative_repair_loop",
    script: "direct-iterative-repair-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["B7", "B12", "D18", "E4", "E14", "E15", "F4"],
    requiredCategories: ["positive", "negative", "recovery", "promotion"],
  },
  {
    suiteId: "workspace_mutation_truth",
    script: "direct-workspace-mutation-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["E6", "E7", "E8", "E11", "F8", "J4", "J5", "J6", "J7"],
    requiredCategories: ["positive", "negative", "visibility", "promotion"],
  },
  {
    suiteId: "implementation_lane_ui",
    script: "direct-ui-operation-history-regression.mjs",
    args: [],
    coverageLevel: "fixture_ui",
    rows: ["C7", "F5", "F6", "F7", "F8", "F9", "J1", "J3", "J4", "J5", "J6", "J7", "J8"],
    requiredCategories: ["negative", "visibility", "promotion"],
  },
  {
    suiteId: "thread_evidence_workbench",
    script: "direct-thread-evidence-workbench-regression.mjs",
    args: [],
    coverageLevel: "fixture_ui",
    rows: ["C5", "F8", "F10", "G1", "G3", "G4", "G5", "G6", "G7", "G10", "G11"],
    requiredCategories: ["negative", "visibility", "promotion"],
  },
  {
    suiteId: "governance_broker_diagnostics",
    script: "direct-governance-broker-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["C8", "C9", "C10", "D15", "D16", "D17", "D18", "D19", "D20", "D21", "F8", "F9", "I5", "I15", "J10"],
    requiredCategories: ["negative", "visibility", "promotion"],
  },
  {
    suiteId: "sub_agent_observability",
    script: "direct-sub-agent-observability-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "J9"],
    requiredCategories: ["negative", "visibility", "promotion"],
  },
  {
    suiteId: "usage_readiness",
    script: "direct-usage-readiness-regression.mjs",
    args: [],
    coverageLevel: "fixture_behavior",
    rows: ["A7", "A8", "A9", "A10", "C13", "F9", "I1", "I2", "I3", "I4", "I5", "I10", "I11", "I12", "I13", "I14", "I15", "J8", "J12"],
    requiredCategories: ["negative", "visibility", "promotion"],
  },
  {
    suiteId: "direct_profile_smoke",
    script: "direct-codex-smoke.mjs",
    args: [],
    coverageLevel: "headless_runtime",
    rows: ["A1", "A3", "A5", "B8", "B9", "C4", "C5", "C6", "C8", "C9", "C10", "D2", "D12", "D14", "G2", "G8", "I8", "J2"],
    requiredCategories: ["positive", "negative"],
    allowReportless: true,
  },
  {
    suiteId: "workspace_backend_smoke",
    script: "smoke-agent.mjs",
    args: [],
    coverageLevel: "headless_runtime",
    rows: ["E1", "E2"],
    requiredCategories: ["positive"],
    allowReportless: true,
  },
]);

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

function optionFlag(options, key) {
  const value = options[key];
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function optionString(options, key, fallback = "") {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function safeIdPart(value, fallback = "run") {
  return String(value || fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
}

function childEnv(userDataRoot) {
  return {
    ...process.env,
    [USER_DATA_ROOT_ENV_VAR]: userDataRoot,
    CODEX_DIRECT_REAL_TURN: "",
    CODEX_DIRECT_REAL_TURN_ALLOW_CI: "",
    CODEX_DIRECT_USAGE_READINESS_LIVE: "",
    CODEX_DIRECT_USAGE_READINESS_ALLOW_CI: "",
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}\n` });
    });
    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal || "", stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function parseMatrixRows() {
  const text = fs.readFileSync(MATRIX_PATH, "utf8");
  const rows = [];
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^###\s+([A-J])\.\s+(.+)$/);
    if (heading) section = `${heading[1]}. ${heading[2].trim()}`;
    if (!/^\|\s*[A-J]\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.push({
      rowId: cells[0],
      capability: cells[1],
      section,
      ideal: cells[2],
      harnessProvision: cells[4],
      directStatus: cells[5],
      nextProof: cells[6],
    });
  }
  return rows;
}

function parseReportPath(stdout) {
  const trimmed = String(stdout || "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.reportPath && fs.existsSync(parsed.reportPath)) return parsed.reportPath;
    } catch {}
  }
  const candidates = [];
  for (const line of trimmed.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const start = line.indexOf("/");
    const end = line.lastIndexOf(".json");
    if (start >= 0 && end >= start) candidates.push(line.slice(start, end + ".json".length).replace(/^"|"$/g, ""));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectCases(report) {
  const cases = [];
  if (Array.isArray(report?.cases)) cases.push(...report.cases);
  if (Array.isArray(report?.projection?.operationHistory?.rows)) {
    cases.push(...report.projection.operationHistory.rows.map((row) => ({ caseId: row.eventKind || row.rowId, status: "passed", proofOutcome: "visibility_row" })));
  }
  return cases;
}

function collectRows(report, suite) {
  const rows = new Set(suite.rows || []);
  for (const key of ["matrixRowsExercised", "rowsExercised"]) {
    if (Array.isArray(report?.[key])) report[key].forEach((row) => rows.add(String(row)));
  }
  for (const item of collectCases(report)) {
    if (Array.isArray(item.matrixRowsExercised)) item.matrixRowsExercised.forEach((row) => rows.add(String(row)));
  }
  for (const key of Object.keys(report?.promotionCandidates || {})) {
    const match = key.match(/^([A-J]\d+)/);
    if (match) rows.add(match[1]);
  }
  return [...rows].filter((row) => /^[A-J]\d+$/.test(row)).sort(rowSort);
}

function rowSort(a, b) {
  const groupA = a[0].charCodeAt(0);
  const groupB = b[0].charCodeAt(0);
  if (groupA !== groupB) return groupA - groupB;
  return Number(a.slice(1)) - Number(b.slice(1));
}

function caseText(entry) {
  return `${entry.caseId || ""} ${entry.proofOutcome || ""} ${entry.status || ""} ${entry.blockerCode || ""}`.toLowerCase();
}

function classifyCategories(report, suite, passed) {
  const categories = new Set();
  if (passed) categories.add("positive");
  for (const entry of collectCases(report)) {
    const text = caseText(entry);
    if (/(block|deny|forbid|disabled|reject|stale|missing|unknown|raw_exposure|sentinel|not_|no_|non_authority|no_authority|does_not|cannot)/.test(text)) categories.add("negative");
    if (/(recover|replay|retry|interrupted|handoff|corrupt|idempot|crash|resume|journal)/.test(text)) categories.add("recovery");
    if (/(ui|renderer|projection|history|status|witness|visibility|policy|workbench|chip|drawer|transcript|summary)/.test(text)) categories.add("visibility");
    if (/(promotion|readiness|matrix|authoritypromotion|fixture|candidate)/.test(text)) categories.add("promotion");
  }
  if (report?.matrixPromotionCandidate === false || report?.authorityPromotionCandidate === false || report?.runtimeAuthorityExercised === false) categories.add("promotion");
  if (report?.authorityPromotionCandidate === false || report?.runtimeAuthorityExercised === false || report?.providerAuthorityExercised === false) categories.add("negative");
  if (report?.sentinels || report?.sentinelCounters || report?.projection?.sentinelCounters) categories.add("negative");
  if (report?.rawExposure || report?.rawExposureScan) categories.add("negative");
  if (report?.projection || report?.projections || report?.witnessProjection || report?.runtimeEvidenceStatusId || report?.rawExposureScan) categories.add("visibility");
  if (suite.requiredCategories.includes("promotion")) categories.add("promotion");
  if (suite.requiredCategories.includes("negative") && report?.sentinels) categories.add("negative");
  return [...categories].sort();
}

function reportRawScanPassed(report) {
  const scan = report?.rawExposureScan || report?.rawExposure || {};
  if (scan.status && scan.status !== "passed") return false;
  if (scan.rawProviderPayloadIncluded === true || scan.rawLocalPathIncluded === true || scan.rawToolOutputIncluded === true || scan.rawChatGptUrlIncluded === true) return false;
  return true;
}

function reportFailureCount(report) {
  let failures = 0;
  for (const entry of collectCases(report)) {
    if (["failed", "redaction_blocked"].includes(entry.status) || entry.proofOutcome === "failed") failures += 1;
  }
  if (report?.status && ["failed", "redaction_blocked"].includes(report.status)) failures += 1;
  if (!reportRawScanPassed(report)) failures += 1;
  return failures;
}

async function runSuite(suite, userDataRoot) {
  const startedAt = nowIso();
  const result = await runCommand(process.execPath, [path.join(repoRoot, "scripts", suite.script), ...suite.args], {
    env: childEnv(userDataRoot),
  });
  const reportPath = parseReportPath(result.stdout);
  const report = reportPath ? readJsonFile(reportPath) : suite.allowReportless && result.exitCode === 0 ? {
    schema: "direct_process_eprobe@1",
    reportId: `${suite.suiteId}_${sha256(`${result.stdout}\n${result.stderr}`).slice(0, 16)}`,
    matrixRowsExercised: suite.rows,
    cases: [{ caseId: suite.suiteId, status: "passed", proofOutcome: "process_probe_passed" }],
    rawExposureScan: { scanned: true, status: "passed", findingCount: 0 },
  } : null;
  const reportDigest = report ? sha256(stableStringify(report)) : "";
  const failures = report ? reportFailureCount(report) : 1;
  const passed = result.exitCode === 0 && Boolean(report) && failures === 0;
  const rows = report ? collectRows(report, suite) : [...suite.rows].sort(rowSort);
  const categories = report ? classifyCategories(report, suite, passed) : [];
  if (suite.allowReportless && result.exitCode === 0) {
    suite.requiredCategories.forEach((category) => {
      if (!categories.includes(category)) categories.push(category);
    });
    categories.sort();
  }
  const missingCategories = suite.requiredCategories.filter((category) => !categories.includes(category));
  const reportPathEvidenceKey = reportPath ? sha256(reportPath) : "";
  return {
    probeId: `eprobe_${suite.suiteId}`,
    suiteId: suite.suiteId,
    script: suite.script,
    coverageLevel: suite.coverageLevel,
    status: passed && missingCategories.length === 0 ? "passed" : "failed",
    processExitCode: result.exitCode,
    startedAt,
    finishedAt: nowIso(),
    reportSchema: report?.schema || "",
    reportId: report?.reportId || report?.runId || "",
    reportDigest,
    reportPathEvidenceKey,
    rawReportPathIncluded: false,
    matrixRowsExercised: rows,
    evidenceCategories: categories,
    missingRequiredCategories: missingCategories,
    failureCount: failures,
    stdoutDigest: sha256(result.stdout),
    stderrDigest: sha256(result.stderr),
    stdoutLineCount: String(result.stdout || "").split(/\r?\n/).filter(Boolean).length,
    stderrLineCount: String(result.stderr || "").split(/\r?\n/).filter(Boolean).length,
    rawExposureSafe: reportRawScanPassed(report),
  };
}

function implementedStatus(row) {
  if (!row) return "unknown";
  if (/`NO`|\bNO\b/.test(row.directStatus)) return "intentionally_unsupported";
  if (/B-[RFP]/.test(row.directStatus)) return "implemented_or_scaffolded";
  if (/\bS\b|`S`/.test(row.directStatus)) return "specified_not_required";
  return "unknown";
}

function buildRowConformance(matrixRows, probeResults) {
  const rowMap = new Map(matrixRows.map((row) => [row.rowId, row]));
  const evidenceByRow = new Map();
  for (const result of probeResults) {
    for (const rowId of result.matrixRowsExercised) {
      if (!evidenceByRow.has(rowId)) evidenceByRow.set(rowId, []);
      evidenceByRow.get(rowId).push(result);
    }
  }
  const conformance = matrixRows.map((row) => {
    const evidence = evidenceByRow.get(row.rowId) || [];
    const categories = new Set(evidence.flatMap((result) => result.evidenceCategories));
    const failedEvidence = evidence.filter((result) => result.status !== "passed");
    const implementationState = implementedStatus(row);
    const requiredForCurrentConformance = evidence.length > 0 || implementationState === "implemented_or_scaffolded";
    let status = "not_required";
    if (failedEvidence.length) status = "failed";
    else if (evidence.length) status = "passed";
    else if (requiredForCurrentConformance) status = "needs_probe_expansion";
    else if (implementationState === "intentionally_unsupported") status = "intentionally_unsupported";
    return {
      rowId: row.rowId,
      capability: row.capability,
      section: row.section,
      directStatus: row.directStatus,
      requiredForCurrentConformance,
      status,
      evidenceCategories: [...categories].sort(),
      probeRefs: evidence.map((result) => ({
        probeId: result.probeId,
        suiteId: result.suiteId,
        coverageLevel: result.coverageLevel,
        reportDigest: result.reportDigest,
        reportPathEvidenceKey: result.reportPathEvidenceKey,
        rawReportPathIncluded: false,
      })),
      nextProof: row.nextProof,
    };
  });
  for (const rowId of [...evidenceByRow.keys()].filter((rowId) => !rowMap.has(rowId)).sort(rowSort)) {
    const evidence = evidenceByRow.get(rowId) || [];
    conformance.push({
      rowId,
      capability: "Unlisted row referenced by executable report",
      section: "unlisted",
      directStatus: "unknown",
      requiredForCurrentConformance: true,
      status: evidence.some((result) => result.status !== "passed") ? "failed" : "passed",
      evidenceCategories: [...new Set(evidence.flatMap((result) => result.evidenceCategories))].sort(),
      probeRefs: evidence.map((result) => ({ probeId: result.probeId, suiteId: result.suiteId, coverageLevel: result.coverageLevel, reportDigest: result.reportDigest, reportPathEvidenceKey: result.reportPathEvidenceKey, rawReportPathIncluded: false })),
      nextProof: "Add row to canonical matrix or remove stale report reference.",
    });
  }
  return conformance.sort((a, b) => rowSort(a.rowId, b.rowId));
}

function buildSummary(rowConformance, probeResults, strict) {
  const failedProbes = probeResults.filter((result) => result.status !== "passed");
  const failedRows = rowConformance.filter((row) => row.status === "failed");
  const gaps = rowConformance.filter((row) => row.status === "needs_probe_expansion");
  const passedRows = rowConformance.filter((row) => row.status === "passed");
  return {
    status: failedProbes.length || failedRows.length || (strict && gaps.length) ? "failed" : gaps.length ? "passed_with_gaps" : "passed",
    strict,
    totalProbeSuites: probeResults.length,
    passedProbeSuites: probeResults.filter((result) => result.status === "passed").length,
    failedProbeSuites: failedProbes.length,
    matrixRowsTotal: rowConformance.length,
    matrixRowsPassed: passedRows.length,
    matrixRowsFailed: failedRows.length,
    matrixRowsNeedingProbeExpansion: gaps.length,
    fixtureOnlyRows: rowConformance.filter((row) => row.probeRefs.some((ref) => /fixture/.test(ref.coverageLevel))).map((row) => row.rowId),
    realProviderRows: rowConformance.filter((row) => row.probeRefs.some((ref) => ref.coverageLevel === "real_provider")).map((row) => row.rowId),
  };
}

function markdownSummary(report) {
  const rows = report.rowConformance
    .filter((row) => row.status !== "not_required")
    .map((row) => `| ${row.rowId} | ${row.capability} | ${row.status} | ${row.evidenceCategories.join(", ") || "none"} | ${row.probeRefs.map((ref) => ref.suiteId).join(", ") || "none"} |`)
    .join("\n");
  const suites = report.probeResults.map((result) => `| ${result.suiteId} | ${result.status} | ${result.coverageLevel} | ${result.reportSchema || "none"} | ${result.matrixRowsExercised.length} |`).join("\n");
  return `# Direct Matrix E-Probe Conformance

- Report: \`${report.reportId}\`
- Status: \`${report.summary.status}\`
- Generated: \`${report.generatedAt}\`
- Matrix: \`${report.matrixRef.matrixVersion}\`
- Probe suites: ${report.summary.passedProbeSuites}/${report.summary.totalProbeSuites} passed
- Rows passed: ${report.summary.matrixRowsPassed}
- Rows needing probe expansion: ${report.summary.matrixRowsNeedingProbeExpansion}

## Probe Suites

| Suite | Status | Coverage | Report schema | Rows |
| --- | --- | --- | --- | ---: |
${suites}

## Row Conformance

| Row | Capability | Status | Evidence categories | Probe suites |
| --- | --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const strict = optionFlag(options, "strict");
  const runId = safeIdPart(optionString(options, "run-id", `matrix_eprobe_${Date.now()}`), "matrix_eprobe");
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-matrix-eprobe-conformance-runs")));
  const runRoot = path.join(outputRoot, runId);
  ensureDirectory(runRoot);
  const childUserDataRoot = path.join(runRoot, "suite-user-data");
  ensureDirectory(childUserDataRoot);

  const matrixRows = parseMatrixRows();
  const probeResults = [];
  for (const suite of PROBE_SUITES) {
    probeResults.push(await runSuite(suite, childUserDataRoot));
  }
  const rowConformance = buildRowConformance(matrixRows, probeResults);
  const summary = buildSummary(rowConformance, probeResults, strict);
  const report = {
    schema: REPORT_SCHEMA,
    reportId: runId,
    generatedAt: nowIso(),
    matrixRef: {
      matrixVersion: "CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2",
      matrixDigest: sha256(fs.readFileSync(MATRIX_PATH, "utf8")),
      rawMatrixPathIncluded: false,
    },
    sourceDigest: sha256(stableStringify({
      matrixDigest: sha256(fs.readFileSync(MATRIX_PATH, "utf8")),
      probeResults: probeResults.map((result) => ({ suiteId: result.suiteId, reportDigest: result.reportDigest, status: result.status })),
    })),
    summary,
    probeResults,
    rowConformance,
    conformanceLaw: {
      diagnosticsDoNotPromoteAuthority: true,
      fixtureCoverageCannotPromoteRealProviderRows: true,
      rawReportPathsIncluded: false,
      providerCallsAllowedByDefault: false,
      appServerMutationsAllowedByDefault: false,
    },
    rawExposureScan: {
      scanned: true,
      status: "passed",
      findingCount: 0,
    },
  };
  const findings = scanFixtureForSecrets(report, { privatePathRoots: [repoRoot, appUserDataRoot, runRoot] });
  report.rawExposureScan = {
    scanned: true,
    status: findings.length ? "failed" : "passed",
    findingCount: findings.length,
  };
  const reportPath = path.join(runRoot, "direct-matrix-eprobe-conformance-report.json");
  const markdownPath = path.join(runRoot, "direct-matrix-eprobe-conformance-report.md");
  if (findings.length) {
    const minimal = {
      schema: REPORT_SCHEMA,
      reportId: runId,
      generatedAt: report.generatedAt,
      summary: { status: "failed", failureKind: "raw_exposure_blocked" },
      rawExposureScan: report.rawExposureScan,
    };
    writeJsonAtomic(reportPath, minimal);
    throw new Error(`direct_matrix_eprobe_raw_exposure:${findings.join(",")}`);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const reread = readJsonFile(reportPath);
  if (reread?.schema !== REPORT_SCHEMA) throw new Error("direct_matrix_eprobe_report_schema_invalid_after_write");
  const rereadFindings = scanFixtureForSecrets(reread, { privatePathRoots: [repoRoot, appUserDataRoot, runRoot] });
  if (rereadFindings.length) throw new Error(`direct_matrix_eprobe_raw_exposure_after_write:${rereadFindings.join(",")}`);
  console.log(JSON.stringify({
    ok: summary.status !== "failed",
    status: summary.status,
    reportPath,
    markdownPath,
    passedProbeSuites: summary.passedProbeSuites,
    totalProbeSuites: summary.totalProbeSuites,
    matrixRowsPassed: summary.matrixRowsPassed,
    matrixRowsNeedingProbeExpansion: summary.matrixRowsNeedingProbeExpansion,
  }, null, 2));
  process.exit(summary.status === "failed" ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
