#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const realTurnScript = path.join(__dirname, "codex-real-turn.mjs");
const liveProbeScript = path.join(__dirname, "direct-codex-live-probe.mjs");
const smokeScript = path.join(__dirname, "direct-codex-smoke.mjs");
const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const REAL_USAGE_SCENARIOS = [
  {
    scenarioId: "RU-PRE-001",
    title: "Preflight disposable workspace",
    runner: "direct-real-usage-regression",
    mode: "preflight",
    providerCallExpected: false,
    proofGoal: "Creates an isolated workspace and proves the live suite can run without provider transport.",
  },
  {
    scenarioId: "RU-LIVE-001",
    title: "Direct live probe evidence",
    runner: "direct-real-usage-regression --run-live-probe",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Records exact-scope direct text evidence before strict direct turns use it.",
  },
  {
    scenarioId: "RU-APP-001",
    title: "App-server baseline first turn",
    runner: "direct-real-usage-regression",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves the app-server baseline still answers a simple headless prompt.",
  },
  {
    scenarioId: "RU-DIR-001",
    title: "Direct empty-context first turn",
    runner: "direct-real-usage-regression",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves strict direct text can complete a first turn from empty context.",
  },
  {
    scenarioId: "RU-DIR-002",
    title: "Direct recent-dialogue follow-up",
    runner: "direct-real-usage-regression",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves direct follow-up uses durable recent-dialogue context without provider continuity.",
  },
  {
    scenarioId: "RU-GUARD-001",
    title: "Direct live opt-in guard",
    runner: "direct-real-usage-regression",
    mode: "live",
    providerCallExpected: false,
    proofGoal: "Proves direct live transport refuses to start without explicit opt-in.",
  },
  {
    scenarioId: "RU-IDEM-001",
    title: "Client run id idempotency",
    runner: "direct-real-usage-regression",
    mode: "live",
    providerCallExpected: false,
    proofGoal: "Proves repeating an already completed client run id returns the existing report rather than resending.",
  },
  {
    scenarioId: "RU-IMP-001",
    title: "Implementation lane read_file",
    runner: "direct-implementation-proof-regression --scenarios=read",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves provider emits read_file, local authority executes it, and continuation completes.",
  },
  {
    scenarioId: "RU-IMP-002",
    title: "Implementation lane sequential read loop",
    runner: "direct-implementation-proof-regression --scenarios=read_loop",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves bounded iterative read repair can continue through a second read if requested.",
  },
  {
    scenarioId: "RU-IMP-003",
    title: "Implementation lane apply_patch",
    runner: "direct-implementation-proof-regression --scenarios=patch",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves provider patch intent can be planned, applied in a disposable workspace, and summarized.",
  },
  {
    scenarioId: "RU-IMP-004",
    title: "Implementation lane run_command",
    runner: "direct-implementation-proof-regression --scenarios=command",
    mode: "live",
    providerCallExpected: true,
    proofGoal: "Proves provider command intent can run through local authority and workspace-effect scan.",
  },
  {
    scenarioId: "RU-NEG-001",
    title: "Patch delete blocked",
    runner: "direct-implementation-proof-regression --include-negative-safety",
    mode: "preflight",
    providerCallExpected: false,
    proofGoal: "Proves destructive patch delete remains blocked by local authority.",
  },
  {
    scenarioId: "RU-NEG-002",
    title: "Network/helper command blocked",
    runner: "direct-implementation-proof-regression --include-negative-safety",
    mode: "preflight",
    providerCallExpected: false,
    proofGoal: "Proves broad/network command helpers remain blocked by local authority.",
  },
  {
    scenarioId: "RU-PATH-001",
    title: "Persisted runtime path switch",
    runner: "direct-runtime-path-switch-regression",
    mode: "fixture",
    providerCallExpected: false,
    proofGoal: "Proves app-server/direct-text/direct-implementation selection is persisted and guarded.",
  },
];

const CASE_SCENARIO_IDS = new Map([
  ["preflight_workspace", "RU-PRE-001"],
  ["appserver_baseline", "RU-APP-001"],
  ["direct_strict_first_turn", "RU-DIR-001"],
  ["direct_strict_followup", "RU-DIR-002"],
  ["direct_opt_in_guard", "RU-GUARD-001"],
  ["direct_client_run_id_idempotency", "RU-IDEM-001"],
]);

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
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function envFlag(key) {
  return ["1", "true", "yes", "on"].includes(String(process.env[key] || "").trim().toLowerCase());
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
  const canonicalMtime = existingFileMtimeMs(path.join(canonical, CONFIG_FILE_NAME));
  const legacyMtime = existingFileMtimeMs(path.join(legacy, CONFIG_FILE_NAME));
  return legacyMtime > canonicalMtime ? legacy : canonical;
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function safeIdPart(value, fallback = "run") {
  const text = String(value || "").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return text || `${fallback}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeText(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, value, { mode: 0o600 });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function createWorkspace(root) {
  const workspace = path.join(root, "workspace");
  ensureDirectory(path.join(workspace, "src"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# Direct runtime regression fixture\n\nSafe fixture workspace.\n");
  fs.writeFileSync(path.join(workspace, "src", "example.txt"), "alpha\nbeta\n");
  fs.writeFileSync(path.join(workspace, "package.json"), `${JSON.stringify({
    scripts: {
      test: "node -e \"console.log('fixture test ok')\"",
      check: "node -e \"console.log('fixture check ok')\"",
    },
  }, null, 2)}\n`);
  return workspace;
}

function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      delete env[key];
    } else {
      env[key] = String(value);
    }
  }
  return env;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: childEnv(options.env || {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on("error", (error) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({ exitCode: code ?? 1, signal: signal || "", stdout, stderr });
    });
  });
}

function parseReportPath(output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => line.endsWith("/report.json") || line.endsWith("\\report.json")) || "";
}

function caseFromReport(caseId, runtime, reportPath, commandResult, notes = []) {
  const report = reportPath ? readJson(reportPath) : null;
  const status = report?.status === "completed" || report?.status === "diagnostic"
    ? "passed"
    : report?.status === "blocked" ? "blocked" : commandResult.exitCode === 0 ? "passed" : "failed";
  return {
    caseId,
    scenarioId: CASE_SCENARIO_IDS.get(caseId) || "",
    runtime,
    status,
    reportId: report?.artifacts?.reportId || report?.runId || "",
    requestLifecycle: report?.requestLifecycle || "",
    providerRequestStarted: report?.providerRequestStarted === true,
    providerBytesObserved: report?.providerBytesObserved === true,
    failureCode: report?.failure?.code || "",
    terminalState: report?.stream?.terminalState || "",
    assistantPreview: report?.assistant?.textPreview || "",
    notes,
    _reportPath: reportPath,
  };
}

function checkedPatterns() {
  return [
    "accessToken",
    "refreshToken",
    "Bearer ",
    "sk-",
    "session_token",
    "\"rawBackendFramesExposed\": true",
    "\"rawRequestBodyStored\": true",
    "ChatGPT URL",
    "/mnt/c/",
    "C:\\\\",
    "SQLITE_",
    "FOREIGN KEY constraint failed",
  ];
}

function scanFiles(files, extraRoots = []) {
  const roots = extraRoots.filter(Boolean);
  const patterns = checkedPatterns();
  const findings = [];
  for (const filePath of files.filter(Boolean)) {
    let text = "";
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    text = text.replace(/"checkedPatterns"\s*:\s*\[[\s\S]*?\]/g, '"checkedPatterns":[]');
    for (const pattern of patterns) {
      if (text.includes(pattern)) findings.push({ file: path.basename(filePath), pattern });
    }
    for (const root of roots) {
      if (root && text.includes(root)) findings.push({ file: path.basename(filePath), pattern: "absolute_workspace_path" });
    }
  }
  return findings;
}

function validateRegressionReport(report) {
  if (report.schema !== "direct_real_usage_regression_report@1") throw new Error("Invalid regression report schema.");
  if (!Array.isArray(report.cases)) throw new Error("Regression report cases must be an array.");
  if (!Array.isArray(report.futureGaps)) throw new Error("Regression report futureGaps must be an array.");
  return true;
}

function readJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runRealTurn(args, options = {}) {
  return runCommand(process.execPath, [realTurnScript, ...args], options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = optionString(options, "mode", optionFlag(options, "live") ? "live" : "preflight");
  if (!["preflight", "live"].includes(mode)) throw new Error("--mode must be preflight or live.");
  const liveProviderCallOptIn = optionFlag(options, "allow-live-provider-call") || envFlag("CODEX_DIRECT_REAL_TURN");
  if (mode === "live" && !liveProviderCallOptIn) throw new Error("Live regression requires --allow-live-provider-call or CODEX_DIRECT_REAL_TURN=1.");
  if (mode === "live" && process.env.CI === "true" && !envFlag("CODEX_DIRECT_REAL_TURN_ALLOW_CI")) {
    throw new Error("Live regression in CI requires CODEX_DIRECT_REAL_TURN_ALLOW_CI=1.");
  }

  const runId = safeIdPart(optionString(options, "run-id", `direct_real_usage_${nowStamp()}`), "run");
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-real-usage-regressions")));
  const runRoot = path.join(outputRoot, runId);
  const workspace = createWorkspace(runRoot);
  const projectId = optionString(options, "project-id", `real-usage-${runId}`);
  const reportPath = path.join(runRoot, "regression-summary.json");
  const markdownPath = path.join(runRoot, "regression-summary.md");
  const cases = [];

  let liveProbe = { ran: false, status: "skipped", unknownRawEventTypeCount: 0 };
  if (mode === "live" && optionFlag(options, "run-live-probe")) {
    const probeEnv = {
      [USER_DATA_ROOT_ENV_VAR]: appUserDataRoot,
      CODEX_DIRECT_APP_USER_DATA_ROOT: appUserDataRoot,
      CODEX_DIRECT_AUTH_ROOT: path.join(appUserDataRoot, "direct-auth"),
      CODEX_DIRECT_PROBE_EVIDENCE_ROOT: path.join(appUserDataRoot, "direct-probe-evidence"),
      CODEX_DIRECT_LIVE_PROBE: "1",
    };
    if (envFlag("CODEX_DIRECT_LIVE_PROBE_ALLOW_CI")) probeEnv.CODEX_DIRECT_LIVE_PROBE_ALLOW_CI = "1";
    const probe = await runCommand(process.execPath, [liveProbeScript], { env: probeEnv });
    const jsonStart = probe.stdout.indexOf("{");
    const parsed = jsonStart >= 0 ? readJsonFromText(probe.stdout.slice(jsonStart)) : null;
    liveProbe = {
      ran: true,
      status: parsed?.evidence?.status || (probe.exitCode === 0 ? "runtime_probed" : "failed"),
      evidenceId: parsed?.evidence?.evidenceId || "",
      expiresAt: parsed?.evidence?.expiresAt || "",
      unknownRawEventTypeCount: Array.isArray(parsed?.unknownRawTypes) ? parsed.unknownRawTypes.length : 0,
    };
  }

  if (mode === "preflight") {
    cases.push({
      caseId: "preflight_workspace",
      scenarioId: CASE_SCENARIO_IDS.get("preflight_workspace"),
      runtime: "local",
      status: fs.existsSync(path.join(workspace, "README.md")) ? "passed" : "failed",
      providerRequestStarted: false,
      providerBytesObserved: false,
      notes: ["Disposable workspace created; provider not called."],
    });
  } else {
    const common = [
      "--project-id", projectId,
      "--workspace-kind", "local",
      "--workspace-path", workspace,
      "--allow-workspace-override",
      "--timeout-ms", optionString(options, "timeout-ms", "120000"),
      "--app-user-data-root", appUserDataRoot,
    ];

    const appRunId = `${runId}_appserver`;
    const appserver = await runRealTurn([
      "--runtime=appserver",
      ...common,
      "--prompt", "Headless regression app-server baseline. Reply with exactly one short sentence starting with APP-SERVER-REGRESSION:",
      "--client-run-id", appRunId,
    ]);
    const appPath = parseReportPath(appserver.stdout);
    cases.push(caseFromReport("appserver_baseline", "appserver", appPath, appserver));

    const directRunId = `${runId}_direct_first`;
    const direct = await runRealTurn([
      "--runtime=direct",
      ...common,
      "--new-thread",
      "--context-policy=direct_text_turn_empty_context@1",
      "--prompt", "Headless regression strict direct first turn. Reply with exactly one short sentence starting with DIRECT-REGRESSION-ONE:",
      "--client-run-id", directRunId,
      "--allow-live-provider-call",
    ]);
    const directPath = parseReportPath(direct.stdout);
    const directCase = caseFromReport("direct_strict_first_turn", "direct", directPath, direct);
    cases.push(directCase);

    if (directCase.status === "passed") {
      const followRunId = `${runId}_direct_followup`;
      const followup = await runRealTurn([
        "--runtime=direct",
        ...common,
        "--from-report", directPath,
        "--context-policy=direct_text_turn_recent_dialogue@1",
        "--prompt", "Headless regression strict direct follow-up. Reply with exactly one short sentence starting with DIRECT-REGRESSION-TWO: and mention the previous prefix.",
        "--client-run-id", followRunId,
        "--allow-live-provider-call",
      ]);
      cases.push(caseFromReport("direct_strict_followup", "direct", parseReportPath(followup.stdout), followup));
    } else {
      cases.push({
        caseId: "direct_strict_followup",
        scenarioId: CASE_SCENARIO_IDS.get("direct_strict_followup"),
        runtime: "direct",
        status: "skipped",
        providerRequestStarted: false,
        providerBytesObserved: false,
        notes: ["skipped_dependency_failed"],
      });
    }

    const guardRunId = `${runId}_direct_no_optin`;
    const guard = await runRealTurn([
      "--runtime=direct",
      ...common,
      "--new-thread",
      "--context-policy=direct_text_turn_empty_context@1",
      "--prompt", "This prompt must not be sent because live opt-in is missing.",
      "--client-run-id", guardRunId,
    ], {
      env: {
        CODEX_DIRECT_REAL_TURN: undefined,
        CODEX_DIRECT_REAL_TURN_ALLOW_CI: undefined,
      },
    });
    const guardCase = caseFromReport("direct_opt_in_guard", "direct", parseReportPath(guard.stdout), guard);
    guardCase.status = guardCase.failureCode === "live_provider_call_opt_in_missing" &&
      guardCase.providerRequestStarted === false
      ? "passed"
      : "failed";
    cases.push(guardCase);

    if (directPath) {
      const before = fs.statSync(directPath).mtimeMs;
      const idem = await runRealTurn([
        "--runtime=direct",
        ...common,
        "--new-thread",
        "--context-policy=direct_text_turn_empty_context@1",
        "--prompt", "Headless regression strict direct first turn. Reply with exactly one short sentence starting with DIRECT-REGRESSION-ONE:",
        "--client-run-id", directRunId,
        "--allow-live-provider-call",
      ]);
      const after = fs.statSync(directPath).mtimeMs;
      const idemCase = caseFromReport("direct_client_run_id_idempotency", "direct", parseReportPath(idem.stdout), idem, [
        before === after ? "existing report returned without rewrite" : "report mtime changed",
      ]);
      idemCase.status = before === after && idem.exitCode === 0 ? "passed" : "failed";
      idemCase.originalReportProviderRequestStarted = idemCase.providerRequestStarted;
      idemCase.originalReportProviderBytesObserved = idemCase.providerBytesObserved;
      idemCase.providerRequestStarted = false;
      idemCase.providerBytesObserved = false;
      idemCase.requestLifecycle = before === after ? "existing_report_returned" : idemCase.requestLifecycle;
      cases.push(idemCase);
    }
  }

  let fixtureSmoke = { ran: false, status: "skipped", coverageClass: "fixture-backed-not-real-provider" };
  if (optionFlag(options, "run-fixture-smoke")) {
    const smoke = await runCommand(process.execPath, [smokeScript]);
    fixtureSmoke = {
      ran: true,
      exitCode: smoke.exitCode,
      status: smoke.exitCode === 0 ? "passed" : "failed",
      coverageClass: "fixture-backed-not-real-provider",
    };
  }

  const futureGaps = [
    ["real_read_file_approval_loop", "RU-IMP-001"],
    ["real_sequential_read_loop", "RU-IMP-002"],
    ["real_apply_patch_approval_loop", "RU-IMP-003"],
    ["real_run_command_approval_loop", "RU-IMP-004"],
    ["real_command_workspace_effect_scan", "RU-IMP-004"],
  ].map(([gapId, scenarioId]) => ({ gapId, scenarioId, status: "not_covered_by_direct_real_usage_runner" }));

  const linkedReportPaths = cases.map((item) => item._reportPath).filter(Boolean);
  const publicCases = cases.map(({ _reportPath, ...item }) => item);
  const report = {
    schema: "direct_real_usage_regression_report@1",
    runId,
    branch: (await runCommand("git", ["branch", "--show-current"])).stdout.trim(),
    commit: (await runCommand("git", ["rev-parse", "HEAD"])).stdout.trim(),
    createdAt: new Date().toISOString(),
    mode,
    liveProviderCallOptIn,
    liveProbe,
    scenarioMatrix: REAL_USAGE_SCENARIOS,
    cases: publicCases,
    rawExposureScan: {
      scanned: true,
      status: "passed",
      checkedPatterns: checkedPatterns(),
      findingCount: 0,
    },
    fixtureSmoke,
    futureGaps,
  };
  validateRegressionReport(report);

  const markdown = markdownSummary(report);
  const preWriteFindings = scanFiles(linkedReportPaths, [workspace, runRoot]);
  report.rawExposureScan.findingCount = preWriteFindings.length;
  report.rawExposureScan.status = preWriteFindings.length ? "failed" : "passed";
  validateRegressionReport(report);
  if (preWriteFindings.length) {
    const minimal = {
      schema: "direct_real_usage_regression_report@1",
      runId,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
    };
    writeJson(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  writeJson(reportPath, report);
  writeText(markdownPath, markdown);
  const postWriteFindings = scanFiles([reportPath, markdownPath, ...linkedReportPaths], [workspace, runRoot]);
  if (postWriteFindings.length) {
    const minimal = {
      schema: "direct_real_usage_regression_report@1",
      runId,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
    };
    writeJson(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }
  validateRegressionReport(readJson(reportPath));
  console.log(reportPath);
  const failed = publicCases.some((item) => item.status === "failed" || item.status === "blocked");
  process.exit(failed ? 1 : 0);
}

function markdownSummary(report) {
  const rows = report.cases.map((item) =>
    `| ${item.scenarioId || ""} | ${item.caseId} | ${item.runtime} | ${item.status} | ${item.requestLifecycle || ""} | ${item.failureCode || ""} |`,
  ).join("\n");
  const matrixRows = report.scenarioMatrix.map((item) =>
    `| ${item.scenarioId} | ${item.title} | ${item.mode} | ${item.providerCallExpected} | ${item.runner} |`,
  ).join("\n");
  return `# Direct Real Usage Regression ${report.runId}

- Mode: \`${report.mode}\`
- Branch: \`${report.branch}\`
- Commit: \`${report.commit}\`
- Fixture smoke: \`${report.fixtureSmoke.status}\` (${report.fixtureSmoke.coverageClass})

## Scenario Matrix

| Scenario | Title | Mode | Provider Call | Runner |
| --- | --- | --- | --- | --- |
${matrixRows}

## Results

| Scenario | Case | Runtime | Status | Lifecycle | Failure |
| --- | --- | --- | --- | --- | --- |
${rows}

Future implementation-lane real-provider gaps remain not covered:

${report.futureGaps.map((gap) => `- \`${gap.gapId}\`: ${gap.status}`).join("\n")}
`;
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
