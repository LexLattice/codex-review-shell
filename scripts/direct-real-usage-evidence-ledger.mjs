#!/usr/bin/env node

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
const REPORT_SCHEMA = "direct_real_usage_evidence_ledger@1";

const ROW_PRIORITY = [
  "live_provider_proved",
  "local_safety_proved",
  "electron_ui_proved",
  "ui_projection_proved",
  "fixture_proved",
  "diagnostic_projection_proved",
  "manual_or_electron_gap",
  "not_represented",
];

const REAL_USAGE_CASE_ROWS = {
  appserver_baseline: ["A4", "F1"],
  direct_strict_first_turn: ["A3", "A5", "B1", "B2", "B11", "F2", "I6"],
  direct_strict_followup: ["B3", "C6", "C8", "C9", "F3"],
  direct_opt_in_guard: ["I4", "I14"],
  direct_client_run_id_idempotency: ["A11", "I4"],
};

const LIVE_PROBE_ROWS = ["A1", "A3", "A5", "I2", "I3", "I14"];

const NEGATIVE_CASE_ROWS = {
  negative_direct_text_only_tool_regression: ["B5", "F2", "I4"],
  negative_read_sensitive_path: ["E3", "J4"],
  negative_patch_delete_deferred: ["E6"],
  negative_command_network_helper_blocked: ["E9", "J7"],
};

const CONTEXT_EPROBE_ROWS = ["A12", "C12", "D1", "D2", "D7", "D10", "D11", "D13", "D14", "D22", "D23", "J11"];
const ELECTRON_RUNTIME_PATH_ROWS = ["F5", "J1", "J2", "J8"];

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

function rowSort(a, b) {
  const family = String(a || "")[0].localeCompare(String(b || "")[0]);
  if (family !== 0) return family;
  return Number(String(a || "").slice(1)) - Number(String(b || "").slice(1));
}

function uniqueRows(rows) {
  return [...new Set((rows || []).filter((row) => /^[A-J][0-9]+$/.test(String(row))))].sort(rowSort);
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
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function splitPaths(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function matrixRowsFromDoc() {
  let text = "";
  try {
    text = fs.readFileSync(MATRIX_PATH, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const match of text.matchAll(/^\|\s*([A-J][0-9]+)\s*\|\s*([^|]+?)\s*\|/gm)) {
    rows.push({
      rowId: match[1],
      title: match[2].replace(/`/g, "").trim(),
    });
  }
  return [...new Map(rows.map((row) => [row.rowId, row])).values()].sort((a, b) => rowSort(a.rowId, b.rowId));
}

function reportStatus(report) {
  return String(report?.status || report?.summary?.status || report?.report?.status || "");
}

function reportId(report) {
  return String(report?.reportId || report?.runId || report?.id || "");
}

function evidenceSourceFromPath(inputPath, report) {
  const resolved = path.resolve(inputPath);
  return {
    sourceId: `src_${sha256(resolved).slice(0, 16)}`,
    schema: String(report?.schema || "unknown"),
    reportId: reportId(report),
    reportStatus: reportStatus(report),
    sourceDigest: report ? sha256(stableStringify(report)) : "",
    pathEvidenceKey: sha256(resolved),
    rawPathIncluded: false,
    loaded: Boolean(report),
  };
}

function pushEvidence(rowMap, rowIds, evidence) {
  for (const rowId of uniqueRows(rowIds)) {
    if (!rowMap.has(rowId)) rowMap.set(rowId, []);
    rowMap.get(rowId).push(evidence);
  }
}

function proofLevelRank(level) {
  const index = ROW_PRIORITY.indexOf(level);
  return index >= 0 ? index : ROW_PRIORITY.length;
}

function strongestLevel(levels) {
  return [...levels].sort((a, b) => proofLevelRank(a) - proofLevelRank(b))[0] || "not_represented";
}

function rowsFromMatrixReport(report) {
  const rows = new Set();
  for (const row of report?.summary?.fixtureOnlyRows || []) rows.add(row);
  for (const result of report?.probeResults || []) {
    for (const row of result.matrixRowsExercised || []) rows.add(row);
  }
  return uniqueRows([...rows]);
}

function rowsFromUiReport(report) {
  return uniqueRows([...(report?.rowsExercised || []), ...(report?.matrixRowsExercised || [])]);
}

function rowsFromImplementationCase(item) {
  if (item?.status === "blocked" && NEGATIVE_CASE_ROWS[item?.caseId]) {
    return uniqueRows(NEGATIVE_CASE_ROWS[item.caseId]);
  }
  return uniqueRows(item?.matrixRowsExercised || []);
}

function ingestMatrixReport(rowMap, source, report) {
  const rows = rowsFromMatrixReport(report);
  if (!rows.length) return;
  pushEvidence(rowMap, rows, {
    sourceId: source.sourceId,
    proofLevel: "fixture_proved",
    evidenceKind: "matrix_fixture_conformance",
    status: report?.summary?.status || reportStatus(report),
    liveProvider: false,
    matrixPromotionCandidate: false,
  });
}

function ingestUiReport(rowMap, source, report) {
  const rows = rowsFromUiReport(report);
  if (!rows.length || reportStatus(report) !== "passed") return;
  pushEvidence(rowMap, rows, {
    sourceId: source.sourceId,
    proofLevel: "ui_projection_proved",
    evidenceKind: "renderer_safe_ui_projection",
    status: "passed",
    liveProvider: false,
    matrixPromotionCandidate: false,
  });
}

function ingestContextEprobeReport(rowMap, source, report) {
  if (report?.schema !== "direct_context_management_eprobe_report@1") return;
  const failed = Object.entries(report.statusCounts || {}).filter(([status]) => status !== "passed").reduce((sum, [, count]) => sum + Number(count || 0), 0);
  if (failed > 0) return;
  pushEvidence(rowMap, CONTEXT_EPROBE_ROWS, {
    sourceId: source.sourceId,
    proofLevel: "diagnostic_projection_proved",
    evidenceKind: "context_management_eprobe_slice",
    status: "passed",
    liveProvider: false,
    matrixPromotionCandidate: false,
  });
}

function ingestRuntimePathElectronReport(rowMap, source, report) {
  if (report?.schema !== "direct_runtime_path_electron_regression@1") return;
  if (report?.summary?.status !== "passed") return;
  pushEvidence(rowMap, ELECTRON_RUNTIME_PATH_ROWS, {
    sourceId: source.sourceId,
    proofLevel: "electron_ui_proved",
    evidenceKind: "electron_runtime_path_persistence",
    status: "passed",
    liveProvider: false,
    matrixPromotionCandidate: false,
  });
}

function ingestRealUsageReport(rowMap, source, report) {
  if (report?.liveProbe?.status === "runtime_probed") {
    pushEvidence(rowMap, LIVE_PROBE_ROWS, {
      sourceId: source.sourceId,
      proofLevel: "live_provider_proved",
      evidenceKind: "direct_live_probe",
      status: "runtime_probed",
      liveProvider: true,
      matrixPromotionCandidate: true,
    });
  }
  for (const item of report?.cases || []) {
    const caseId = String(item.caseId || "");
    const rows = REAL_USAGE_CASE_ROWS[caseId] || [];
    if (!rows.length) continue;
    const providerStarted = item.providerRequestStarted === true;
    const providerBytes = item.providerBytesObserved === true;
    const passed = item.status === "passed";
    const safety = !providerStarted && passed;
    if (passed && (providerBytes || safety)) {
      pushEvidence(rowMap, rows, {
        sourceId: source.sourceId,
        proofLevel: providerBytes ? "live_provider_proved" : "local_safety_proved",
        evidenceKind: `real_usage_case:${caseId}`,
        status: item.status,
        terminalState: item.terminalState || "",
        liveProvider: providerBytes,
        matrixPromotionCandidate: providerBytes,
      });
    }
  }
}

function ingestImplementationReport(rowMap, source, report) {
  for (const item of report?.cases || []) {
    const rows = rowsFromImplementationCase(item);
    if (!rows.length) continue;
    const proved = item.status === "proved" && item.countsAsRealProviderProof === true && item.providerBytesObserved === true;
    const blocked = item.status === "blocked" && item.providerRequestStarted === false;
    if (!proved && !blocked) continue;
    pushEvidence(rowMap, rows, {
      sourceId: source.sourceId,
      proofLevel: proved ? "live_provider_proved" : "local_safety_proved",
      evidenceKind: `implementation_case:${item.caseId || item.scenario || "unknown"}`,
      status: item.status,
      proofOutcome: item.proofOutcome || "",
      liveProvider: proved,
      matrixPromotionCandidate: item.matrixPromotionCandidate === true && proved,
    });
  }
}

function ingestReport(rowMap, source, report, hint = "") {
  if (!report) return;
  const schema = String(report.schema || "");
  const normalizedHint = String(hint || "").toLowerCase();
  if (schema === "direct_matrix_eprobe_conformance_report@1" || normalizedHint === "matrix") ingestMatrixReport(rowMap, source, report);
  if (schema === "direct_ui_parity_report@1" || normalizedHint === "ui") ingestUiReport(rowMap, source, report);
  if (schema === "direct_context_management_eprobe_report@1" || normalizedHint === "context") ingestContextEprobeReport(rowMap, source, report);
  if (schema === "direct_runtime_path_electron_regression@1" || normalizedHint === "electron") ingestRuntimePathElectronReport(rowMap, source, report);
  if (schema === "direct_real_usage_regression_report@1" || Array.isArray(report.cases) && "liveProbe" in report) ingestRealUsageReport(rowMap, source, report);
  if (schema === "direct_implementation_proof_report@1" || Array.isArray(report.cases) && report.cases.some((item) => "countsAsRealProviderProof" in item)) {
    ingestImplementationReport(rowMap, source, report);
  }
}

function rawExposureScan(report) {
  const serialized = JSON.stringify(report);
  const patterns = [
    { code: "raw_home_path", pattern: /\/home\/rose\/work|\/home\/rose\/\.config/ },
    { code: "raw_windows_path", pattern: /[A-Za-z]:\\/ },
    { code: "raw_wsl_path", pattern: /\/mnt\/[a-z]\// },
    { code: "raw_token", pattern: /(Bearer\s+[A-Za-z0-9._-]+|accessToken|refreshToken|session_token|sk-[A-Za-z0-9])/i },
    { code: "raw_chatgpt_url", pattern: /https?:\/\/chatgpt\.com/i },
    { code: "raw_provider_payload", pattern: /"(rawProviderPayload|rawRequestBody|rawResponseBody)"\s*:\s*"(?!false\b)[^"]+"/i },
  ];
  const hits = patterns.filter((entry) => entry.pattern.test(serialized)).map((entry) => entry.code);
  return {
    passed: hits.length === 0,
    blockerCodes: hits,
    rawReportPathsIncluded: false,
    rawProviderPayloadsIncluded: false,
    rawCredentialsIncluded: false,
  };
}

function markdownSummary(report) {
  const rows = report.rowEvidence
    .filter((row) => row.proofLevel !== "not_represented")
    .map((row) => `| ${row.rowId} | ${row.title} | ${row.proofLevel} | ${row.evidenceCount} |`)
    .join("\n");
  return `# Direct Real Usage Evidence Ledger

- Schema: \`${report.schema}\`
- Report id: \`${report.reportId}\`
- Generated: \`${report.generatedAt}\`
- Status: \`${report.summary.status}\`
- Matrix rows: \`${report.summary.representedRows}/${report.summary.matrixRowsTotal}\`
- Live-provider rows: \`${report.summary.liveProviderRows}\`
- Electron UI rows: \`${report.summary.electronUiRows}\`
- UI-projection rows: \`${report.summary.uiProjectionRows}\`
- Fixture-only rows: \`${report.summary.fixtureOnlyRows}\`
- Not represented rows: \`${report.summary.notRepresentedRows}\`

| Row | Capability | Proof level | Evidence count |
| --- | --- | --- | ---: |
${rows}
`;
}

async function gitOutput(args) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.on("close", (code) => resolve(code === 0 ? Buffer.concat(chunks).toString("utf8").trim() : ""));
    child.on("error", () => resolve(""));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = optionString(options, "run-id", `real_usage_evidence_ledger_${Date.now()}`);
  const userDataRoot = path.resolve(optionString(options, "user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const runRoot = path.join(userDataRoot, "direct-real-usage-evidence-ledgers", runId);

  const reportInputs = [
    ...splitPaths(optionString(options, "matrix-report")).map((reportPath) => ({ reportPath, hint: "matrix" })),
    ...splitPaths(optionString(options, "live-text-report")).map((reportPath) => ({ reportPath, hint: "live-text" })),
    ...splitPaths(optionString(options, "implementation-reports")).map((reportPath) => ({ reportPath, hint: "implementation" })),
    ...splitPaths(optionString(options, "ui-report")).map((reportPath) => ({ reportPath, hint: "ui" })),
    ...splitPaths(optionString(options, "electron-report")).map((reportPath) => ({ reportPath, hint: "electron" })),
    ...splitPaths(optionString(options, "context-report")).map((reportPath) => ({ reportPath, hint: "context" })),
    ...splitPaths(optionString(options, "report")).map((reportPath) => ({ reportPath, hint: "" })),
  ];

  if (!reportInputs.length) {
    throw new Error("no_report_inputs");
  }

  const matrixRows = matrixRowsFromDoc();
  const rowMap = new Map();
  const sources = [];
  for (const input of reportInputs) {
    const report = readJson(input.reportPath);
    const source = evidenceSourceFromPath(input.reportPath, report);
    source.inputKind = input.hint || "report";
    sources.push(source);
    ingestReport(rowMap, source, report, input.hint);
  }

  const rowEvidence = matrixRows.map((row) => {
    const evidence = rowMap.get(row.rowId) || [];
    const proofLevel = strongestLevel(evidence.map((item) => item.proofLevel));
    return {
      rowId: row.rowId,
      title: row.title,
      proofLevel,
      evidenceCount: evidence.length,
      sourceIds: [...new Set(evidence.map((item) => item.sourceId))].sort(),
      evidenceKinds: [...new Set(evidence.map((item) => item.evidenceKind))].sort(),
      liveProviderProved: evidence.some((item) => item.proofLevel === "live_provider_proved"),
      localSafetyProved: evidence.some((item) => item.proofLevel === "local_safety_proved"),
      electronUiProved: evidence.some((item) => item.proofLevel === "electron_ui_proved"),
      uiProjectionProved: evidence.some((item) => item.proofLevel === "ui_projection_proved"),
      fixtureProved: evidence.some((item) => item.proofLevel === "fixture_proved"),
      diagnosticProjectionProved: evidence.some((item) => item.proofLevel === "diagnostic_projection_proved"),
    };
  });

  const countBy = (predicate) => rowEvidence.filter(predicate).length;
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
    sourceDigest: sha256(stableStringify({ sources, rowEvidence })),
    sources,
    summary: {
      status: sources.every((source) => source.loaded) ? "passed" : "source_missing",
      matrixRowsTotal: matrixRows.length,
      representedRows: countBy((row) => row.proofLevel !== "not_represented"),
      liveProviderRows: countBy((row) => row.liveProviderProved),
      localSafetyRows: countBy((row) => row.localSafetyProved),
      electronUiRows: countBy((row) => !row.liveProviderProved && row.electronUiProved),
      uiProjectionRows: countBy((row) => !row.liveProviderProved && !row.electronUiProved && row.uiProjectionProved),
      fixtureOnlyRows: countBy((row) => !row.liveProviderProved && !row.electronUiProved && !row.uiProjectionProved && row.fixtureProved),
      diagnosticProjectionRows: countBy((row) => !row.liveProviderProved && !row.electronUiProved && !row.uiProjectionProved && !row.fixtureProved && row.diagnosticProjectionProved),
      notRepresentedRows: countBy((row) => row.proofLevel === "not_represented"),
      notRepresentedRowIds: rowEvidence.filter((row) => row.proofLevel === "not_represented").map((row) => row.rowId),
      rug001Closed: countBy((row) => row.liveProviderProved) > 0 && countBy((row) => row.proofLevel !== "not_represented") > 0,
    },
    rowEvidence,
    rawExposure: {
      rawReportPathsIncluded: false,
      rawProviderPayloadsIncluded: false,
      rawCredentialsIncluded: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      appServerMutationCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextPackBuilds: 0,
      requestManifestBuilds: 0,
      directSessionCreates: 0,
      runtimeTierMutationCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
  };
  report.rawExposure = { ...report.rawExposure, ...rawExposureScan(report) };
  if (!report.rawExposure.passed) report.summary.status = "raw_exposure_blocked";

  const jsonPath = path.join(runRoot, "direct-real-usage-evidence-ledger.json");
  const markdownPath = path.join(runRoot, "direct-real-usage-evidence-ledger.md");
  writeJson(jsonPath, report);
  writeText(markdownPath, markdownSummary(report));
  const reloaded = readJson(jsonPath);
  if (!reloaded || reloaded.schema !== REPORT_SCHEMA) {
    throw new Error("direct_real_usage_evidence_ledger_reload_failed");
  }
  console.log(JSON.stringify({
    ok: report.summary.status === "passed",
    reportPath: jsonPath,
    status: report.summary.status,
    matrixRowsTotal: report.summary.matrixRowsTotal,
    representedRows: report.summary.representedRows,
    liveProviderRows: report.summary.liveProviderRows,
    electronUiRows: report.summary.electronUiRows,
    uiProjectionRows: report.summary.uiProjectionRows,
    fixtureOnlyRows: report.summary.fixtureOnlyRows,
    notRepresentedRows: report.summary.notRepresentedRows,
    rug001Closed: report.summary.rug001Closed,
  }, null, 2));
  if (report.summary.status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
