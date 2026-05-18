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
const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const LIVE_ENV = "CODEX_DIRECT_RUG011_LIVE";
const LIVE_CI_ENV = "CODEX_DIRECT_RUG011_LIVE_ALLOW_CI";

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

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function createWorkspace(root) {
  const workspace = path.join(root, "workspace");
  ensureDirectory(workspace);
  fs.writeFileSync(path.join(workspace, "README.md"), "# Governance live non-authority fixture\n\nSafe text-only workspace.\n", { mode: 0o600 });
  return workspace;
}

function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) delete env[key];
    else env[key] = String(value);
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
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: `${Buffer.concat(stderrChunks).toString("utf8")}${error.message}\n`,
      });
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        signal: signal || "",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function parseReportPath(output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => line.endsWith("/report.json") || line.endsWith("\\report.json")) || "";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function passedCase(caseId, details = {}) {
  return { caseId, status: "passed", details };
}

function failedCase(caseId, details = {}) {
  return { caseId, status: "failed", details };
}

function rawExposureFindings(value) {
  const text = JSON.stringify(value);
  return [
    "accessToken",
    "refreshToken",
    "Bearer ",
    "sk-",
    "session_token",
    "\"rawRequestBodyStored\":true",
    "\"rawBackendFramesExposed\":true",
    "ChatGPT URL",
    "/mnt/c/",
    "C:\\\\",
  ].filter((pattern) => text.includes(pattern));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allowLive = optionFlag(options, "allow-live-provider-call") || envFlag(LIVE_ENV) || envFlag("CODEX_DIRECT_REAL_TURN");
  if (!allowLive) throw new Error(`Live governance non-authority probe requires --allow-live-provider-call, ${LIVE_ENV}=1, or CODEX_DIRECT_REAL_TURN=1.`);
  if (process.env.CI === "true" && !envFlag(LIVE_CI_ENV) && !envFlag("CODEX_DIRECT_REAL_TURN_ALLOW_CI")) {
    throw new Error(`Live governance non-authority probe in CI requires ${LIVE_CI_ENV}=1.`);
  }

  const runId = safeIdPart(optionString(options, "run-id", `rug011_governance_live_${nowStamp()}`), "run");
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const runRoot = path.join(appUserDataRoot, "direct-governance-live-non-authority-runs", runId);
  const workspace = createWorkspace(runRoot);
  const projectId = optionString(options, "project-id", `rug011-governance-${runId}`);
  const clientRunId = `${runId}_direct_governance_shadow`;
  const turn = await runCommand(process.execPath, [
    realTurnScript,
    "--runtime=direct",
    "--project-id", projectId,
    "--workspace-kind", "local",
    "--workspace-path", workspace,
    "--allow-workspace-override",
    "--new-thread",
    "--context-policy=direct_text_turn_empty_context@1",
    "--prompt", "RUG-011 live governance shadow non-authority probe. Reply with exactly one short sentence starting with GOVERNANCE-SHADOW-LIVE:",
    "--client-run-id", clientRunId,
    "--app-user-data-root", appUserDataRoot,
    "--timeout-ms", optionString(options, "timeout-ms", "120000"),
    "--include-governance-shadow-refs",
    "--allow-live-provider-call",
  ]);
  const turnReportPath = parseReportPath(turn.stdout);
  const turnReport = readJson(turnReportPath);
  const governance = turnReport?.governance || {};
  const cases = [];
  cases.push((turn.exitCode === 0 && turnReport?.status === "completed" && turnReport?.providerRequestStarted === true && turnReport?.providerBytesObserved === true)
    ? passedCase("governance_shadow_live_turn_completed", {
        reportId: turnReport?.runId || "",
        terminalState: turnReport?.stream?.terminalState || "",
      })
    : failedCase("governance_shadow_live_turn_completed", {
        exitCode: turn.exitCode,
        reportPath: turnReportPath,
        status: turnReport?.status || "",
        failureCode: turnReport?.failure?.code || "",
        stderr: turn.stderr.slice(0, 1000),
      }));
  cases.push((governance.shadowDiagnosticsPresent === true && governance.wouldBlockInFutureEnforceMode === true && governance.blockedInThisPr === false)
    ? passedCase("shadow_report_future_block_does_not_block_runtime", {
        shadowReportId: governance.shadowReportId || "",
      })
    : failedCase("shadow_report_future_block_does_not_block_runtime", governance));
  cases.push((governance.providerInputTextUnchangedByGovernanceRefs === true &&
    governance.providerInputShapeUnchangedByGovernanceRefs === true &&
    governance.providerInputPromptUnchangedByGovernanceRefs === true &&
    governance.providerInputInstructionsUnchangedByGovernanceRefs === true)
    ? passedCase("governance_refs_do_not_mutate_provider_input", {
        governanceRefsDigest: governance.governanceRefsDigest || "",
      })
    : failedCase("governance_refs_do_not_mutate_provider_input", governance));
  cases.push((governance.autoRouteApplied === false && turnReport?.request?.tools === false && turnReport?.request?.store === false && turnReport?.continuity?.previousResponseIdUsed === false)
    ? passedCase("broker_diagnostics_do_not_route_or_enable_controls", {
        tools: turnReport?.request?.tools,
        store: turnReport?.request?.store,
        previousResponseIdUsed: turnReport?.continuity?.previousResponseIdUsed,
      })
    : failedCase("broker_diagnostics_do_not_route_or_enable_controls", {
        autoRouteApplied: governance.autoRouteApplied,
        request: turnReport?.request || null,
        continuity: turnReport?.continuity || null,
      }));
  cases.push((governance.contextPackGovernanceRefsPresent === true && governance.requestManifestGovernanceRefsPresent === true)
    ? passedCase("context_and_request_cite_governance_refs", {
        governancePacketId: governance.governancePacketId || "",
        semanticBrokerPacketId: governance.semanticBrokerPacketId || "",
      })
    : failedCase("context_and_request_cite_governance_refs", governance));

  const failed = cases.some((entry) => entry.status !== "passed");
  const report = {
    schema: "direct_governance_live_non_authority_report@1",
    runId,
    generatedAt: new Date().toISOString(),
    coverageSource: "real_provider",
    matrixRowsExercised: ["D16", "D17", "D20", "D21", "J10"],
    matrixPromotionCandidate: !failed,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: true,
    rug011Closed: !failed,
    turnReportPath,
    turnReportId: turnReport?.runId || "",
    governanceRefsDigest: governance.governanceRefsDigest || "",
    sentinelCounters: {
      providerTransportCalls: turnReport?.providerRequestStarted ? 1 : 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      runtimeTierMutationCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    cases,
  };
  const findings = rawExposureFindings(report);
  report.rawExposureScan = {
    status: findings.length ? "failed" : "passed",
    findingCount: findings.length,
  };
  const reportPath = path.join(runRoot, "direct-governance-live-non-authority-report.json");
  if (findings.length) {
    writeJson(reportPath, {
      schema: report.schema,
      runId,
      generatedAt: report.generatedAt,
      coverageSource: "real_provider",
      matrixPromotionCandidate: false,
      rug011Closed: false,
      rawExposureScan: report.rawExposureScan,
      cases: [failedCase("raw_exposure_scan", { findingCount: findings.length })],
    });
    console.log(JSON.stringify({ ok: false, reportPath, status: "failed", failureKind: "raw_exposure_scan_failed" }, null, 2));
    process.exit(1);
  }
  writeJson(reportPath, report);
  console.log(JSON.stringify({
    ok: !failed,
    reportPath,
    status: failed ? "failed" : "passed",
    coverageSource: report.coverageSource,
    matrixPromotionCandidate: report.matrixPromotionCandidate,
    rug011Closed: report.rug011Closed,
    passedCases: cases.filter((entry) => entry.status === "passed").length,
    totalCases: cases.length,
  }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
