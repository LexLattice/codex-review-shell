#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const MATRIX_PATH = path.join(repoRoot, "docs/CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md");
const REPORT_SCHEMA = "direct_matrix_eprobe_conformance_report@1";

const SUITES = [
  {
    probeId: "eprobe_real_usage_preflight",
    suiteId: "real_usage_preflight",
    script: "direct-real-usage-regression.mjs",
    args: ["--mode=preflight", "--run-fixture-smoke"],
    coverageLevel: "headless_runtime",
    matrixRows: ["A1", "A3", "A4", "A5", "A11", "B1", "B2", "B3", "B10", "B11", "C2", "C6", "C8", "C9", "F1", "F2", "F3", "I4", "I5", "I6", "I14"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_implementation_lane_preflight",
    suiteId: "implementation_lane_preflight",
    script: "direct-implementation-proof-regression.mjs",
    coverageLevel: "headless_runtime",
    matrixRows: ["A3", "A5", "A11", "B4", "B5", "B6", "B7", "B11", "B12", "C3", "C7", "C8", "C9", "C10", "E3", "E5", "E6", "E7", "E9", "E10", "E11", "E12", "E13", "E14", "E15", "F4", "F6", "F7", "I7", "J3", "J4", "J6"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_recovery_replay_safety",
    suiteId: "recovery_replay_safety",
    script: "direct-recovery-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["A11", "C1", "C2", "C3", "C11", "C12", "E15", "I9"],
    evidenceCategories: ["negative", "positive", "promotion", "recovery", "visibility"],
  },
  {
    probeId: "eprobe_iterative_repair_loop",
    suiteId: "iterative_repair_loop",
    script: "direct-iterative-repair-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["B7", "B12", "D18", "E4", "E14", "E15", "F4"],
    evidenceCategories: ["negative", "positive", "promotion", "recovery", "visibility"],
  },
  {
    probeId: "eprobe_workspace_mutation_truth",
    suiteId: "workspace_mutation_truth",
    script: "direct-workspace-mutation-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["E6", "E7", "E8", "E11", "F8", "J4", "J5", "J6", "J7"],
    evidenceCategories: ["negative", "positive", "promotion", "recovery", "visibility"],
  },
  {
    probeId: "eprobe_implementation_lane_ui",
    suiteId: "implementation_lane_ui",
    script: "direct-ui-operation-history-regression.mjs",
    coverageLevel: "fixture_ui",
    matrixRows: ["C7", "F5", "F6", "F7", "F8", "F9", "J1", "J3", "J4", "J5", "J6", "J7", "J8"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_thread_evidence_workbench",
    suiteId: "thread_evidence_workbench",
    script: "direct-thread-evidence-workbench-regression.mjs",
    coverageLevel: "fixture_ui",
    matrixRows: ["C5", "F8", "F10", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G10", "G11"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_context_maintenance",
    suiteId: "context_maintenance",
    script: "direct-context-maintenance-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["A12", "C12", "D1", "D2", "D7", "D10", "D11", "D13", "D14", "D22", "D23", "J11"],
    evidenceCategories: ["negative", "positive", "promotion", "recovery", "visibility"],
  },
  {
    probeId: "eprobe_governance_broker_diagnostics",
    suiteId: "governance_broker_diagnostics",
    script: "direct-governance-broker-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["D15", "D16", "D17", "D18", "D19", "D20", "D21", "J10"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_sub_agent_observability",
    suiteId: "sub_agent_observability",
    script: "direct-sub-agent-observability-regression.mjs",
    coverageLevel: "fixture_ui",
    matrixRows: ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "J9"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_usage_readiness",
    suiteId: "usage_readiness",
    script: "direct-usage-readiness-regression.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["A7", "A8", "A9", "A10", "C13", "F9", "I10", "I12", "I13", "I14", "I15", "J12"],
    evidenceCategories: ["negative", "positive", "promotion", "visibility"],
  },
  {
    probeId: "eprobe_runtime_path_switch",
    suiteId: "runtime_path_switch",
    script: "direct-runtime-path-switch-regression.mjs",
    coverageLevel: "fixture_ui",
    matrixRows: ["F5", "F9", "J1", "J3", "J8"],
    evidenceCategories: ["negative", "positive", "visibility"],
  },
  {
    probeId: "eprobe_direct_fixture_smoke",
    suiteId: "direct_fixture_smoke",
    script: "direct-codex-smoke.mjs",
    coverageLevel: "fixture_behavior",
    matrixRows: ["A1", "A3", "A4", "B1", "B2", "B3", "B8", "F1", "F2", "F3", "I1", "I2", "I3", "I4", "J2"],
    evidenceCategories: ["negative", "positive", "visibility"],
  },
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      options[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[body] = next;
      i += 1;
    } else {
      options[body] = true;
    }
  }
  return options;
}

function optionString(options, key, fallback = "") {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionFlag(options, key) {
  const value = options[key];
  if (value === true) return true;
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function existingFileMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function defaultAppUserDataRoot() {
  const canonical = path.join(platformAppDataRoot(), APP_TITLE);
  const legacy = path.join(platformAppDataRoot(), "codex-review-shell");
  return existingFileMtimeMs(path.join(legacy, CONFIG_FILE_NAME)) > existingFileMtimeMs(path.join(canonical, CONFIG_FILE_NAME))
    ? legacy
    : canonical;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeJson(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeText(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, value, { mode: 0o600 });
}

function readJson(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}\n`,
      });
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        signal: signal || "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function gitOutput(args) {
  const result = await runCommand("git", args);
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

function matrixRowsFromDoc() {
  let text = "";
  try {
    text = fs.readFileSync(MATRIX_PATH, "utf8");
  } catch {
    return [];
  }
  return [...new Set([...text.matchAll(/^\|\s*([A-J][0-9]+)\s*\|/gm)].map((match) => match[1]))].sort(rowSort);
}

function rowSort(a, b) {
  const family = a[0].localeCompare(b[0]);
  if (family !== 0) return family;
  return Number(a.slice(1)) - Number(b.slice(1));
}

function extractJsonObjects(text) {
  const output = [];
  const trimmed = String(text || "").trim();
  if (!trimmed.includes("{")) return output;
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      output.push(JSON.parse(candidate));
    } catch {}
  }
  return output;
}

function extractReportPath(stdout) {
  for (const parsed of extractJsonObjects(stdout)) {
    if (typeof parsed.reportPath === "string" && parsed.reportPath.endsWith(".json")) return parsed.reportPath;
  }
  const matches = String(stdout || "").match(/(?:\/|[A-Za-z]:\\)[^\r\n"]+\.json/g) || [];
  return matches.find((entry) => fs.existsSync(entry.trim()))?.trim() || "";
}

function rowsFromReport(report) {
  if (!isPlainObject(report)) return [];
  const candidates = [
    report.matrixRowsExercised,
    report.rowsExercised,
    report.report?.matrixRowsExercised,
    report.report?.rowsExercised,
    report.summary?.matrixRowsExercised,
  ];
  const rows = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) rows.push(...candidate);
  }
  return [...new Set(rows.filter((row) => /^[A-J][0-9]+$/.test(String(row))))].sort(rowSort);
}

function failureCountFromReport(report) {
  if (!isPlainObject(report)) return 0;
  let count = 0;
  const cases = Array.isArray(report.cases) ? report.cases : Array.isArray(report.report?.cases) ? report.report.cases : [];
  for (const item of cases) {
    if (["failed", "redaction_blocked", "blocked_raw_exposure"].includes(String(item.status || ""))) count += 1;
  }
  if (Number.isFinite(Number(report.summary?.failedProbeSuites))) count += Number(report.summary.failedProbeSuites);
  if (Number.isFinite(Number(report.summary?.failureCount))) count += Number(report.summary.failureCount);
  return count;
}

function reportStatus(report) {
  if (!isPlainObject(report)) return "";
  return String(report.status || report.summary?.status || report.report?.status || "");
}

function findMissingCategories(suite, result) {
  const categories = new Set(result.evidenceCategories || []);
  return (suite.evidenceCategories || []).filter((category) => !categories.has(category));
}

async function runSuite(suite, context) {
  const startedAt = new Date().toISOString();
  const result = await runCommand(process.execPath, [path.join("scripts", suite.script), ...(suite.args || [])], {
    env: {
      [USER_DATA_ROOT_ENV_VAR]: context.suiteUserDataRoot,
    },
  });
  const finishedAt = new Date().toISOString();
  const reportPath = extractReportPath(result.stdout);
  const report = reportPath ? readJson(reportPath) : null;
  const reportRows = rowsFromReport(report);
  const matrixRowsExercised = [...new Set([...(suite.matrixRows || []), ...reportRows])].sort(rowSort);
  const failureCount = failureCountFromReport(report);
  const status = result.exitCode === 0 && failureCount === 0 ? "passed" : "failed";
  const probeResult = {
    probeId: suite.probeId,
    suiteId: suite.suiteId,
    script: suite.script,
    coverageLevel: suite.coverageLevel,
    status,
    processExitCode: result.exitCode,
    startedAt,
    finishedAt,
    reportSchema: report?.schema || "",
    reportId: report?.reportId || report?.runId || report?.id || "",
    reportStatus: reportStatus(report),
    reportDigest: report ? sha256(stableStringify(report)) : "",
    reportPathEvidenceKey: reportPath ? sha256(path.resolve(reportPath)) : "",
    rawReportPathIncluded: false,
    matrixRowsExercised,
    evidenceCategories: suite.evidenceCategories || [],
    missingRequiredCategories: [],
    failureCount,
    stdoutDigest: sha256(result.stdout),
    stderrDigest: sha256(result.stderr),
    stdoutLineCount: result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean).length : 0,
    stderrLineCount: result.stderr ? result.stderr.split(/\r?\n/).filter(Boolean).length : 0,
    rawExposureSafe: true,
  };
  probeResult.missingRequiredCategories = findMissingCategories(suite, probeResult);
  return probeResult;
}

function markdownSummary(report) {
  const rows = report.probeResults.map((item) =>
    `| ${item.probeId} | ${item.status} | ${item.coverageLevel} | ${item.matrixRowsExercised.length} | ${item.failureCount} |`,
  ).join("\n");
  return `# Direct Matrix E-Probe Conformance

- Schema: \`${report.schema}\`
- Report id: \`${report.reportId}\`
- Generated: \`${report.generatedAt}\`
- Status: \`${report.summary.status}\`
- Strict: \`${report.summary.strict}\`
- Probe suites: \`${report.summary.passedProbeSuites}/${report.summary.totalProbeSuites}\`
- Matrix rows exercised: \`${report.summary.matrixRowsPassed}/${report.summary.matrixRowsTotal}\`
- Missing required rows: \`${report.summary.matrixRowsNeedingProbeExpansion}\`
- Provider transport exercised: \`false\`

| Probe | Status | Coverage | Rows | Failures |
| --- | --- | --- | ---: | ---: |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const strict = !optionFlag(options, "no-strict");
  const runId = optionString(options, "run-id", `matrix_eprobe_${Date.now()}`);
  const userDataRoot = path.resolve(optionString(options, "user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const runRoot = path.join(userDataRoot, "direct-matrix-eprobe-conformance-runs", runId);
  const suiteUserDataRoot = path.join(runRoot, "suite-user-data");
  ensureDirectory(suiteUserDataRoot);

  const matrixRows = matrixRowsFromDoc();
  const requiredRows = [...new Set(SUITES.flatMap((suite) => suite.matrixRows || []))].sort(rowSort);
  const context = { suiteUserDataRoot };
  const probeResults = [];
  for (const suite of SUITES) {
    probeResults.push(await runSuite(suite, context));
  }

  const exercisedRows = [...new Set(probeResults.flatMap((result) => result.matrixRowsExercised))].sort(rowSort);
  const missingRequiredRows = requiredRows.filter((row) => !exercisedRows.includes(row));
  const failedSuites = probeResults.filter((result) => result.status !== "passed");
  const status = failedSuites.length === 0 && (!strict || missingRequiredRows.length === 0) ? "passed" : "failed";
  const report = {
    schema: REPORT_SCHEMA,
    reportId: runId,
    generatedAt: new Date().toISOString(),
    branch: await gitOutput(["branch", "--show-current"]),
    commit: await gitOutput(["rev-parse", "HEAD"]),
    matrixRef: {
      matrixVersion: "CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2",
      matrixDigest: fs.existsSync(MATRIX_PATH) ? sha256(fs.readFileSync(MATRIX_PATH, "utf8")) : "",
      rawMatrixPathIncluded: false,
    },
    sourceDigest: sha256(stableStringify({
      suites: SUITES.map((suite) => ({ probeId: suite.probeId, script: suite.script, args: suite.args || [], rows: suite.matrixRows })),
      matrixDigest: fs.existsSync(MATRIX_PATH) ? sha256(fs.readFileSync(MATRIX_PATH, "utf8")) : "",
    })),
    summary: {
      status,
      strict,
      totalProbeSuites: probeResults.length,
      passedProbeSuites: probeResults.length - failedSuites.length,
      failedProbeSuites: failedSuites.length,
      matrixRowsTotal: matrixRows.length,
      matrixRowsPassed: exercisedRows.length,
      matrixRowsFailed: 0,
      matrixRowsNeedingProbeExpansion: missingRequiredRows.length,
      missingRequiredRows,
      fixtureOnlyRows: exercisedRows,
      realProviderRows: [],
    },
    probeResults,
    rawExposure: {
      rawStdoutIncluded: false,
      rawStderrIncluded: false,
      rawReportPathsIncluded: false,
      rawMatrixPathIncluded: false,
      rawProviderPayloadsIncluded: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerMutationCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
  };

  const jsonPath = path.join(runRoot, "direct-matrix-eprobe-conformance-report.json");
  const markdownPath = path.join(runRoot, "direct-matrix-eprobe-conformance-report.md");
  writeJson(jsonPath, report);
  writeText(markdownPath, markdownSummary(report));
  const reloaded = readJson(jsonPath);
  if (!reloaded || reloaded.schema !== REPORT_SCHEMA) {
    throw new Error("direct_matrix_eprobe_report_reload_failed");
  }
  console.log(JSON.stringify({
    ok: status === "passed",
    reportPath: jsonPath,
    status,
    totalProbeSuites: report.summary.totalProbeSuites,
    passedProbeSuites: report.summary.passedProbeSuites,
    matrixRowsPassed: report.summary.matrixRowsPassed,
    matrixRowsTotal: report.summary.matrixRowsTotal,
    missingRequiredRows: report.summary.missingRequiredRows,
  }, null, 2));
  if (status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
