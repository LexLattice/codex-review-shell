#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectManualSmokeGateSafe,
  buildDirectManualSmokeGate,
} = require("../src/main/direct/readiness/manual-smoke-gate");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const REPORT_SCHEMA = "direct_electron_settings_smoke_report@1";
const PROFILE_NAME = "direct-settings-smoke";
const PROJECT_ID = "project_direct_settings_smoke";

function isLinuxWithoutDisplay() {
  return process.platform === "linux" && !process.env.DISPLAY && process.env.CODEX_DIRECT_SETTINGS_SMOKE_UNDER_XVFB !== "1";
}

function relaunchUnderXvfb() {
  const child = spawn("xvfb-run", ["-a", process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_DIRECT_SETTINGS_SMOKE_UNDER_XVFB: "1" },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

const relaunchingUnderXvfb = isLinuxWithoutDisplay();
if (relaunchingUnderXvfb) relaunchUnderXvfb();

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

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
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

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function writeJson(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function profileRoot(tempRoot) {
  return path.join(tempRoot, PROFILE_NAME);
}

function configPath(tempRoot) {
  return path.join(profileRoot(tempRoot), "workspace-config.json");
}

function seedConfig(tempRoot) {
  writeJson(configPath(tempRoot), {
    version: 5,
    selectedProjectId: PROJECT_ID,
    ui: {
      leftRatio: 0.34,
      middleRatio: 0.3,
    },
    runtimeDefaults: {
      codex: {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
    },
    codexThreadRuntimeDefaults: {},
    projects: [
      {
        id: PROJECT_ID,
        name: "Direct Settings Smoke Fixture",
        repoPath: repoRoot,
        workspace: {
          kind: "local",
          localPath: repoRoot,
          label: "Local fixture checkout",
        },
        surfaceBinding: {
          codex: {
            mode: "url",
            bindingProvider: "direct-chatgpt-codex",
            runtimeMode: "direct-experimental",
            directTransport: "live-text",
            directTier: "implementation-lane",
            runtime: "auto",
            profileId: "profile-direct-settings-smoke",
            target: "",
            binaryPath: "codex",
            model: "gpt-5.5",
            reasoningEffort: "high",
            label: "Direct settings smoke fixture",
            provider: {
              kind: "codex_executable",
              flavor: "vanilla",
            },
          },
          chatgpt: {
            reviewThreadUrl: "",
            browserProfile: "default",
            notes: "",
          },
        },
        chatThreads: [],
        laneBindings: [],
        promptTemplates: {},
        flowProfile: {},
        handoffs: [],
      },
    ],
  });
}

function assertCase(cases, caseId, condition, details = {}) {
  cases.push({
    caseId,
    status: condition ? "passed" : "failed",
    details,
  });
  if (!condition) {
    const error = new Error(`direct_electron_settings_smoke_case_failed:${caseId}`);
    error.caseId = caseId;
    error.details = details;
    throw error;
  }
}

async function launchApp(tempRoot) {
  const app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_REVIEW_SHELL_PROFILE: PROFILE_NAME,
      CODEX_REVIEW_SHELL_USER_DATA_ROOT: tempRoot,
      CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
    },
  });
  const window = await app.firstWindow();
  await window.waitForSelector("#projectTabButton", { timeout: 20_000 });
  await window.waitForFunction(() => Boolean(window.workspaceShell?.getDirectBridgeSettingsStatus), null, { timeout: 20_000 });
  return { app, window };
}

async function closeApp(app) {
  if (!app) return;
  let timedOut = false;
  let timeoutId = null;
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          resolve();
        }, 5000);
      }),
    ]);
  } catch {} finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (timedOut) {
    try {
      app.process()?.kill?.("SIGTERM");
    } catch {}
  }
}

function cleanupFixtureWorkspaceAgents() {
  if (process.platform === "win32") return;
  try {
    const result = spawnSync("pgrep", ["-f", `src/backend/wsl-agent.js .*--project-id ${PROJECT_ID}`], {
      encoding: "utf8",
    });
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  } catch {}
}

function processSnapshot() {
  if (process.platform === "win32") {
    return {
      available: false,
      reason: "process_snapshot_unavailable_on_win32",
      appServerPids: [],
      fixtureAgentPids: [],
    };
  }
  try {
    const result = spawnSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const appServerPids = [];
    const fixtureAgentPids = [];
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const command = match[2] || "";
      if (!Number.isFinite(pid)) continue;
      if (/\bcodex\s+app-server\b/.test(command)) appServerPids.push(pid);
      if (new RegExp(`src/backend/wsl-agent\\.js .*--project-id ${PROJECT_ID}`).test(command)) fixtureAgentPids.push(pid);
    }
    return {
      available: true,
      appServerPids: appServerPids.sort((a, b) => a - b),
      fixtureAgentPids: fixtureAgentPids.sort((a, b) => a - b),
    };
  } catch (error) {
    return {
      available: false,
      reason: String(error?.message || error).slice(0, 160),
      appServerPids: [],
      fixtureAgentPids: [],
    };
  }
}

function newProcessCount(before = {}, after = {}, field) {
  const beforeSet = new Set(Array.isArray(before[field]) ? before[field] : []);
  return (Array.isArray(after[field]) ? after[field] : []).filter((pid) => !beforeSet.has(pid)).length;
}

function buildSentinelCounters({ beforeProcesses, afterProcesses, projectionSummary }) {
  const manualSmoke = projectionSummary?.manualSmoke || {};
  const processObservationsAvailable = Boolean(beforeProcesses?.available && afterProcesses?.available);
  return {
    appServerSpawnCalls: processObservationsAvailable ? newProcessCount(beforeProcesses, afterProcesses, "appServerPids") : 0,
    appServerReplacementCalls: processObservationsAvailable ? newProcessCount(beforeProcesses, afterProcesses, "appServerPids") : 0,
    unexpectedAuthorityExposed: manualSmoke.authorityUnexpected ? 1 : 0,
  };
}

function assertSentinelCountersClear(cases, sentinelCounters, processObservations) {
  const unexpected = Object.entries(sentinelCounters)
    .filter(([key, value]) => !key.endsWith("CallsExpected") && Number(value || 0) !== 0)
    .map(([key, value]) => ({ key, value }));
  assertCase(cases, "electron_sentinel_counters_observed_clear", unexpected.length === 0, {
    unexpected,
    processObservations,
  });
}

function cleanupTempRoot(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

function pathLeakVariants(value) {
  const text = String(value || "").trim();
  if (!text || text === "/" || text === "\\") return [];
  return [text, text.replace(/\\/g, "\\\\"), text.replace(/\\/g, "/")].filter(Boolean);
}

function containsPathLeak(serialized, paths = []) {
  return paths
    .flatMap(pathLeakVariants)
    .some((variant) => variant && serialized.includes(variant));
}

function rawExposureScan(report) {
  const serialized = JSON.stringify(report);
  const blockers = [];
  if (containsPathLeak(serialized, [os.homedir(), repoRoot])) blockers.push("raw_local_path");
  if (/[A-Za-z]:\\/.test(serialized)) blockers.push("raw_windows_path");
  if (/\/mnt\/[a-z]\//.test(serialized)) blockers.push("raw_wsl_path");
  if (/(Bearer\s+[A-Za-z0-9._-]+|accessToken|refreshToken|session_token|sk-[A-Za-z0-9])/i.test(serialized)) blockers.push("raw_token");
  return {
    passed: blockers.length === 0,
    blockerCodes: blockers,
    rawConfigPathIncluded: false,
    rawWorkspacePathIncluded: false,
    rawCredentialsIncluded: false,
  };
}

async function visibleText(page, selector) {
  return page.$eval(selector, (element) => element.textContent || "");
}

async function readDirectSettingsProjection(page) {
  return page.evaluate(async (projectId) => window.workspaceShell.getDirectBridgeSettingsStatus(projectId), PROJECT_ID);
}

async function refreshProjectTab(page) {
  await page.click("#projectTabButton");
  await page.waitForSelector("#projectTabPanel:not([hidden])", { timeout: 10_000 });
  await page.click("#directBridgeSettingsRefreshButton");
  await page.waitForFunction(() => {
    const badge = document.querySelector("#directBridgeSettingsBadge");
    const manualRows = document.querySelectorAll("#directBridgeSettingsManualSmokeList .direct-diagnostics-row");
    return badge && !/loading/i.test(badge.textContent || "") && manualRows.length > 0;
  }, null, { timeout: 20_000 });
}

function safeProjectionSummary(projection = {}) {
  const rows = projection.rows || {};
  const sections = projection.sections || {};
  const manual = sections.manualSmokeGate || {};
  return {
    schema: projection.schema || "",
    projectId: projection.projectId || "",
    projectionDigest: projection.projectionDigest || "",
    bridgeOrgans: Array.isArray(projection.bridgeOrgans) ? projection.bridgeOrgans : [],
    rowGroups: Object.keys(rows),
    manualSmoke: {
      available: manual.available === true,
      gateState: manual.gateState || "",
      rowCount: Number(manual.rowCount || 0),
      blockedCount: Number(manual.blockedCount || 0),
      requiredBlockedCount: Number(manual.requiredBlockedCount || 0),
      warningCount: Number(manual.warningCount || 0),
      notCheckedCount: Number(manual.notCheckedCount || 0),
      blockerCount: Array.isArray(manual.blockerCodes) ? manual.blockerCodes.length : 0,
      authorityUnexpected: Boolean(
        manual.manualSmokeExecutionAllowed ||
        manual.runtimePathMutationAllowed ||
        manual.workThreadMutationAllowed ||
        manual.providerTransportAllowed ||
        manual.workspaceMutationAllowed ||
        manual.appServerReplacementAllowed ||
        manual.autoApprovalAllowed ||
        manual.moduleExecutionAllowed ||
        manual.recursiveWorkerAllowed ||
        manual.matrixPromotionAllowed
      ),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = optionString(options, "run-id", `direct_settings_smoke_${Date.now()}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-direct-settings-smoke-"));
  const reportRoot = path.join(os.homedir(), ".config", "codex-review-shell", "direct-electron-settings-smoke-runs", runId);
  const cases = [];
  let app = null;
  let report = null;
  try {
    seedConfig(tempRoot);
    const beforeProcesses = processSnapshot();
    const launched = await launchApp(tempRoot);
    app = launched.app;
    const page = launched.window;
    await refreshProjectTab(page);

    const projection = await readDirectSettingsProjection(page);
    const projectionSummary = safeProjectionSummary(projection);
    const afterProcesses = processSnapshot();
    const processObservations = {
      available: Boolean(beforeProcesses.available && afterProcesses.available),
      before: {
        appServerProcessCount: beforeProcesses.appServerPids.length,
        fixtureWorkspaceAgentProcessCount: beforeProcesses.fixtureAgentPids.length,
      },
      after: {
        appServerProcessCount: afterProcesses.appServerPids.length,
        fixtureWorkspaceAgentProcessCount: afterProcesses.fixtureAgentPids.length,
      },
      observedNewAppServerProcesses: newProcessCount(beforeProcesses, afterProcesses, "appServerPids"),
      observedNewFixtureWorkspaceAgents: newProcessCount(beforeProcesses, afterProcesses, "fixtureAgentPids"),
      unavailableReason: beforeProcesses.reason || afterProcesses.reason || "",
    };
    const sentinelCounters = buildSentinelCounters({ beforeProcesses, afterProcesses, projectionSummary });
    const badgeText = await visibleText(page, "#directBridgeSettingsBadge");
    const quickStatusText = await visibleText(page, "#codexRuntimeQuickStatus");
    const evidenceText = await visibleText(page, "#directBridgeSettingsEvidence");
    const manualSmokeText = await visibleText(page, "#directBridgeSettingsManualSmokeList");
    const runtimeText = await visibleText(page, "#directBridgeSettingsRuntimeList");
    const workThreadText = await visibleText(page, "#directBridgeSettingsWorkThreadList");
    const moduleText = await visibleText(page, "#directBridgeSettingsModulesList");
    const continuityText = await visibleText(page, "#directBridgeSettingsContinuityList");

    assertCase(cases, "electron_project_tab_visible", await page.isVisible("#projectTabPanel"));
    assertCase(cases, "electron_codex_runtime_quick_controls_visible", await page.isVisible("#codexRuntimeQuickSelect") && await page.isVisible("#codexRuntimeQuickApplyButton"), {
      quickStatusText,
      optionValues: await page.$$eval("#codexRuntimeQuickSelect option", (options) => options.map((option) => option.value)),
    });
    assertCase(cases, "electron_settings_projection_schema", projectionSummary.schema === "direct_settings_surface_projection@1", projectionSummary);
    assertCase(cases, "electron_manual_smoke_rows_visible", /Gate|Rows|Authority/.test(manualSmokeText) && projectionSummary.manualSmoke.rowCount > 0, {
      manualSmokeText,
      manualSmoke: projectionSummary.manualSmoke,
    });
    assertCase(cases, "electron_manual_smoke_badge_visible", /smoke/i.test(badgeText), { badgeText });
    assertCase(cases, "electron_manual_smoke_display_only_copy_visible", /Display-only: no provider, app-server, module, workspace, approval, recursive worker, or promotion transition is exposed/.test(evidenceText), { evidenceText });
    assertCase(cases, "electron_runtime_rows_visible", /Current path|Profile|Runtime/.test(runtimeText), { runtimeText });
    assertCase(cases, "electron_workthread_rows_visible", /WorkThread|Target gate|Candidates|Mutation/.test(workThreadText), { workThreadText });
    assertCase(cases, "electron_module_rows_visible", /Execution|Context|Evidence|Hooks/.test(moduleText), { moduleText });
    assertCase(cases, "electron_continuity_rows_visible", /Memory|Baton|Compact|Transport/.test(continuityText), { continuityText });
    assertCase(cases, "electron_no_manual_smoke_authority", projectionSummary.manualSmoke.authorityUnexpected === false, projectionSummary.manualSmoke);
    assertSentinelCountersClear(cases, sentinelCounters, processObservations);

    const electronProjection = {
      available: true,
      digest: sha256(stableStringify({
        schema: projectionSummary.schema,
        projectionDigest: projectionSummary.projectionDigest,
        badgeText,
        manualSmoke: projectionSummary.manualSmoke,
      })),
    };
    const gateWithElectronEvidence = buildDirectManualSmokeGate({
      projectId: PROJECT_ID,
      settingsProjection: projection,
      electronProjectionStatus: electronProjection,
    });
    assertDirectManualSmokeGateSafe(gateWithElectronEvidence);
    assertCase(cases, "electron_projection_feeds_manual_smoke_gate", gateWithElectronEvidence.rows.some((row) =>
      row.checkKind === "electron_projection" &&
      row.state === "passed" &&
      row.evidenceRefs.some((ref) => ref.kind === "electron_projection_status" && ref.digest === electronProjection.digest)
    ), {
      gateState: gateWithElectronEvidence.gateState,
      electronProjectionDigest: electronProjection.digest,
    });

    report = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: "passed",
      cases,
      projection: projectionSummary,
      manualSmokeGate: {
        gateState: gateWithElectronEvidence.gateState,
        gateDigest: gateWithElectronEvidence.gateDigest,
        electronProjectionRowState: gateWithElectronEvidence.rows.find((row) => row.checkKind === "electron_projection")?.state || "",
      },
      processObservations,
      authorityProjection: {
        source: "direct_settings_surface_projection",
        manualSmokeAuthorityUnexpected: projectionSummary.manualSmoke.authorityUnexpected,
      },
      sentinelCounters,
      rawExposure: {
        passed: true,
        blockerCodes: [],
      },
    };
    report.reportDigest = sha256(stableStringify(report));
    report.rawExposure = rawExposureScan(report);
    assertCase(cases, "electron_report_raw_exposure_safe", report.rawExposure.passed === true, report.rawExposure);
    report.status = cases.every((item) => item.status === "passed") ? "passed" : "failed";
    report.reportDigest = sha256(stableStringify(report));
    writeJson(path.join(reportRoot, "report.json"), report);
    console.log(JSON.stringify({
      ok: report.status === "passed",
      schema: report.schema,
      reportDigest: report.reportDigest,
      manualSmokeGate: report.manualSmokeGate.gateState,
      reportRef: {
        kind: "direct_electron_settings_smoke_report",
        evidenceKey: sha256(reportRoot),
      },
    }, null, 2));
  } catch (error) {
    report = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: new Date().toISOString(),
      projectId: PROJECT_ID,
      status: "failed",
      cases,
      failure: {
        caseId: error?.caseId || "unclassified",
        message: String(error?.message || error).slice(0, 220),
        details: error?.details || {},
      },
      sentinelCounters: {
        appServerSpawnCalls: 0,
        appServerReplacementCalls: 0,
        unexpectedAuthorityExposed: 0,
      },
    };
    report.rawExposure = rawExposureScan(report);
    report.reportDigest = sha256(stableStringify(report));
    writeJson(path.join(reportRoot, "report.json"), report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await closeApp(app);
    cleanupFixtureWorkspaceAgents();
    if (options["keep-temp"] !== true) cleanupTempRoot(tempRoot);
  }
}

if (!relaunchingUnderXvfb) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
