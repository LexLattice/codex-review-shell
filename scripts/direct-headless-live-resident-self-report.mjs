#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const {
  buildDefaultResidentSmokeBundle,
  buildLiveResidentSelfReportCaseReport,
  buildLiveResidentSelfReportPrompt,
  buildLiveResidentSelfReportSuiteReport,
  defaultLiveResidentSuiteSelection,
} = require("../src/main/direct/headless/live-resident-self-report.js");

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const DIRECT_USER_DATA_ROOT_ENV_VAR = "CODEX_DIRECT_APP_USER_DATA_ROOT";
const LIVE_OPT_IN_ENV_VAR = "CODEX_DIRECT_HEADLESS_LIVE_RESIDENT_SELF_REPORT";
const DEFAULT_TIMEOUT_MS = 180_000;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
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
      continue;
    }
    options[raw] = true;
  }
  return options;
}

function optionString(options, name, fallback = "") {
  return normalizeString(options[name], fallback);
}

function optionFlag(options, name, fallback = false) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function envString(name, fallback = "") {
  return normalizeString(process.env[name], fallback);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  const text = normalizeString(value, fallback).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return text || `${fallback}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function platformAppDataRoot() {
  if (process.platform === "win32") return envString("APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return envString("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
}

function normalizeProfileName(value) {
  const text = normalizeString(value, "");
  if (!text || text === "default") return "";
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function existingFileMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function uniquePaths(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const resolved = path.resolve(value);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(resolved);
  }
  return output;
}

function defaultAppUserDataRoot() {
  const profileName = normalizeProfileName(process.env[PROFILE_ENV_VAR]);
  const configuredRoot = envString(USER_DATA_ROOT_ENV_VAR, "");
  if (profileName) {
    return path.join(configuredRoot || path.join(platformAppDataRoot(), APP_TITLE), profileName);
  }
  const directConfigured = envString(DIRECT_USER_DATA_ROOT_ENV_VAR, "");
  if (directConfigured) return directConfigured;
  const appData = platformAppDataRoot();
  const candidates = uniquePaths([
    path.join(appData, "codex-review-shell-direct"),
    path.join(appData, APP_TITLE),
    path.join(appData, "codex-review-shell"),
  ]);
  let selectedPath = candidates[0];
  let selectedMtime = 0;
  for (const candidate of candidates) {
    const mtime = existingFileMtimeMs(path.join(candidate, CONFIG_FILE_NAME));
    if (mtime > selectedMtime) {
      selectedPath = candidate;
      selectedMtime = mtime;
    }
  }
  return selectedPath;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function tempFilePath(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`);
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tmp = tempFilePath(targetPath);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

function readJsonFile(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function selectedCaseClasses(options = {}) {
  if (optionFlag(options, "all-cases", false)) return [];
  const raw = optionString(options, "case-classes", optionString(options, "case-class", "tool_visibility_self_report"));
  return raw.split(",").map((entry) => normalizeString(entry, "")).filter(Boolean);
}

function assistantTextFromSession(session = {}, turnId = "") {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const message = messages.find((entry) => normalizeString(entry.id, "") === turnId) || messages[messages.length - 1] || null;
  const items = Array.isArray(message?.items) ? message.items : [];
  return items
    .filter((item) => item?.type === "agentMessage")
    .map((item) => normalizeString(item.text, ""))
    .filter(Boolean)
    .join("\n");
}

function spawnNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({
        code: -1,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
      });
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runCase({ options, outputRoot, appUserDataRoot, suite, bundle, smokeCase, index }) {
  const caseClass = normalizeString(smokeCase.caseClass, `case_${index}`);
  const caseId = safeIdPart(smokeCase.caseId || caseClass, `case_${index}`);
  const runId = `${safeIdPart(optionString(options, "run-id", `live_resident_${Date.now()}`), "run")}_${caseId}`;
  const threadId = `${safeIdPart(optionString(options, "thread-prefix", "direct_headless_live_resident"), "thread")}_${caseId}_${sha256(runId).slice(0, 10)}`;
  const sessionRoot = path.join(outputRoot, "sessions");
  const bridgeRoot = path.join(outputRoot, "bridge", caseId);
  const childReportRoot = path.join(outputRoot, "transport-reports");
  const promptText = buildLiveResidentSelfReportPrompt({ bundle, smokeCase });
  const childArgs = [
    path.join("scripts", "direct-headless-real-smoke.mjs"),
    "--allow-live-provider-call",
    "--project-id", optionString(options, "project-id", "project_example"),
    "--app-user-data-root", appUserDataRoot,
    "--session-root", sessionRoot,
    "--bridge-root", bridgeRoot,
    "--report-root", childReportRoot,
    "--thread-id", threadId,
    "--run-id", runId,
    "--model", optionString(options, "model", "gpt-5.5"),
    "--timeout-ms", optionString(options, "timeout-ms", String(DEFAULT_TIMEOUT_MS)),
    "--prompt", promptText,
  ];
  const reasoningEffort = optionString(options, "reasoning-effort", optionString(options, "effort", ""));
  if (reasoningEffort) childArgs.push("--reasoning-effort", reasoningEffort);
  const workspacePath = optionString(options, "workspace-path", "");
  const workspaceKind = optionString(options, "workspace-kind", "");
  if (workspacePath) childArgs.push("--workspace-path", workspacePath);
  if (workspaceKind) childArgs.push("--workspace-kind", workspaceKind);
  const endpoint = optionString(options, "endpoint", "");
  if (endpoint) childArgs.push("--endpoint", endpoint);
  const authRoot = optionString(options, "auth-root", "");
  if (authRoot) childArgs.push("--auth-root", authRoot);
  const codexAuthFile = optionString(options, "codex-auth-file", "");
  if (codexAuthFile) childArgs.push("--codex-auth-file", codexAuthFile);
  const child = await spawnNode(childArgs);
  const transportReport = readJsonFile(path.join(childReportRoot, `${runId}.json`)) || {
    status: "failed",
    providerStarted: false,
    providerCompleted: false,
    failure: {
      code: child.code === 0 ? "transport_report_missing" : "transport_child_failed",
      rendererSafeMessage: child.stderr.slice(0, 500),
    },
  };
  const session = readJsonFile(path.join(sessionRoot, threadId, "session.json")) || {};
  const assistantText = assistantTextFromSession(session, transportReport.turnId);
  return buildLiveResidentSelfReportCaseReport({
    smokeCase,
    bundle,
    assistantText,
    transportReport,
    promptText,
    observedAt: nowIso(),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!optionFlag(options, "allow-live-provider-call", false) && !envFlag(LIVE_OPT_IN_ENV_VAR)) {
    console.error(`Live resident self-report blocked. Pass --allow-live-provider-call or set ${LIVE_OPT_IN_ENV_VAR}=1.`);
    process.exit(2);
    return;
  }
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", defaultAppUserDataRoot()));
  const runId = safeIdPart(optionString(options, "run-id", `live_resident_${Date.now()}`), "run");
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-headless-live-resident-self-report", runId)));
  ensureDirectory(outputRoot);
  const suite = defaultLiveResidentSuiteSelection(selectedCaseClasses(options));
  if (!suite.cases.length) throw new Error("No resident smoke cases selected.");
  const bundle = buildDefaultResidentSmokeBundle({
    projectId: optionString(options, "project-id", "project_example"),
  });
  const caseReports = [];
  for (let index = 0; index < suite.cases.length; index += 1) {
    caseReports.push(await runCase({
      options,
      outputRoot,
      appUserDataRoot,
      suite,
      bundle,
      smokeCase: suite.cases[index],
      index,
    }));
  }
  const report = buildLiveResidentSelfReportSuiteReport({
    runId,
    suite,
    bundle,
    caseReports,
    outputEvidenceKey: `sha256:${sha256(outputRoot)}`,
    generatedAt: nowIso(),
  });
  const reportPath = path.join(outputRoot, "live-resident-self-report.json");
  writeJsonAtomic(reportPath, report);
  if (optionFlag(options, "report-json", false)) console.log(JSON.stringify(report, null, 2));
  else console.log(reportPath);
  process.exitCode = report.summary.valid ? 0 : 1;
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exit(1);
});
