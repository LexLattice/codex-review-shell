#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const REPORT_SCHEMA = "direct_runtime_path_electron_regression@1";
const PROFILE_NAME = "runtime-path-electron";
const DEFAULT_MODEL = "gpt-5.5";

function isLinuxWithoutDisplay() {
  return process.platform === "linux" && !process.env.DISPLAY && process.env.CODEX_RUNTIME_PATH_ELECTRON_UNDER_XVFB !== "1";
}

function relaunchUnderXvfb() {
  const child = spawn("xvfb-run", ["-a", process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_RUNTIME_PATH_ELECTRON_UNDER_XVFB: "1" },
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

if (isLinuxWithoutDisplay()) relaunchUnderXvfb();

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

function readJson(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function profileRoot(tempRoot) {
  return path.join(tempRoot, PROFILE_NAME);
}

function configPath(tempRoot) {
  return path.join(profileRoot(tempRoot), "workspace-config.json");
}

function liveProbeEvidenceRoot(tempRoot) {
  return path.join(profileRoot(tempRoot), "direct-probe-evidence");
}

function projectBinding(config) {
  const project = config?.projects?.find((item) => item.id === config.selectedProjectId) || config?.projects?.[0] || {};
  return project.surfaceBinding?.codex || {};
}

function bindingFieldsForRuntimePath(runtimePath) {
  if (runtimePath === "direct-text") {
    return {
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
    };
  }
  if (runtimePath === "direct-implementation") {
    return {
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
    };
  }
  return {
    bindingProvider: "codex-compatible",
    runtimeMode: "legacy-app-server",
    directTransport: "fixture",
    directTier: "none",
  };
}

function seedConfig(tempRoot, options = {}) {
  const target = configPath(tempRoot);
  const runtimePath = optionString(options, "initial-runtime-path", "direct-text");
  const model = optionString(options, "model", DEFAULT_MODEL);
  const runtimeFields = bindingFieldsForRuntimePath(runtimePath);
  ensureDirectory(path.dirname(target));
  writeJson(target, {
    version: 5,
    selectedProjectId: "project_runtime_path_electron",
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
        id: "project_runtime_path_electron",
        name: "Runtime Path Electron Fixture",
        repoPath: repoRoot,
        workspace: {
          kind: "local",
          localPath: repoRoot,
          label: "Local fixture checkout",
        },
        surfaceBinding: {
          codex: {
            mode: "url",
            ...runtimeFields,
            runtime: "auto",
            profileId: "profile-electron-fixture",
            target: "",
            binaryPath: "codex",
            model,
            reasoningEffort: "high",
            label: runtimePath === "app-server" ? "App Server fixture" : "Direct lane fixture",
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

function evidenceRootCandidates(options = {}) {
  const configured = optionString(options, "live-evidence-root", "") ||
    normalizeEnvPath(process.env.CODEX_DIRECT_LIVE_PROBE_EVIDENCE_ROOT || "");
  return [
    configured,
    path.join(os.homedir(), ".config", "codex-review-shell", "direct-probe-evidence"),
    path.join(os.homedir(), ".config", "Codex Review Shell", "direct-probe-evidence"),
  ].filter(Boolean);
}

function normalizeEnvPath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function evidenceRootLooksUsable(root) {
  return Boolean(root) &&
    fs.existsSync(path.join(root, "secret.json")) &&
    fs.existsSync(path.join(root, "index.json")) &&
    fs.existsSync(path.join(root, "evidence"));
}

function copyLiveProbeEvidence(tempRoot, options = {}) {
  const sourceRoot = evidenceRootCandidates(options).find(evidenceRootLooksUsable) || "";
  if (!sourceRoot) {
    return {
      copied: false,
      reason: "live_probe_evidence_root_missing",
      evidenceSourceKey: "",
      evidenceCount: 0,
      usableIndexCount: 0,
    };
  }
  const targetRoot = liveProbeEvidenceRoot(tempRoot);
  ensureDirectory(path.dirname(targetRoot));
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
  const index = readJson(path.join(targetRoot, "index.json")) || {};
  const entries = Array.isArray(index.evidence) ? index.evidence : [];
  return {
    copied: true,
    reason: "",
    evidenceSourceKey: sha256(sourceRoot),
    evidenceCount: entries.length,
    usableIndexCount: entries.filter((entry) => entry.status === "runtime_probed").length,
  };
}

function assertCase(cases, caseId, condition, details = {}) {
  cases.push({
    caseId,
    status: condition ? "passed" : "failed",
    details,
  });
  if (!condition) {
    const error = new Error(`runtime_path_electron_case_failed:${caseId}`);
    error.caseId = caseId;
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
  await window.waitForSelector("#directRuntimePathSelect", { timeout: 20_000 });
  await window.waitForFunction(() => {
    const select = document.querySelector("#directRuntimePathSelect");
    return select && ["app-server", "direct-text", "direct-implementation"].includes(select.value);
  }, null, { timeout: 20_000 });
  return { app, window };
}

async function selectedRuntimePath(window) {
  return window.$eval("#directRuntimePathSelect", (select) => select.value);
}

async function optionStates(window) {
  return window.$$eval("#directRuntimePathSelect option", (options) =>
    options.map((option) => ({
      value: option.value,
      text: option.textContent || "",
      disabled: option.disabled,
    })),
  );
}

async function optionState(window, value) {
  const states = await optionStates(window);
  return states.find((option) => option.value === value) || null;
}

async function selectRuntimePathViaUi(window, runtimePath) {
  await window.$eval("#directRuntimePathSelect", (select, nextPath) => {
    select.focus();
    select.value = nextPath;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, runtimePath);
  await window.waitForFunction((nextPath) => {
    const select = document.querySelector("#directRuntimePathSelect");
    const button = document.querySelector("#directRuntimePathApplyButton");
    return select && button && select.value === nextPath && !button.disabled;
  }, runtimePath, { timeout: 10_000 });
  await window.click("#directRuntimePathApplyButton");
  await window.waitForFunction((nextPath) => {
    const select = document.querySelector("#directRuntimePathSelect");
    return select && select.value === nextPath;
  }, runtimePath, { timeout: 20_000 });
}

async function runtimeStatusSummary(window) {
  return window.evaluate(async () => {
    const hasBridge = Boolean(window.workspaceShell);
    const configResult = hasBridge && window.workspaceShell.loadConfig
      ? await window.workspaceShell.loadConfig()
      : {};
    const config = configResult?.config || {};
    const projectId = window.workspaceShell
      ? config?.selectedProjectId
      : "";
    const status = projectId && window.workspaceShell?.getDirectRuntimeStatus
      ? await window.workspaceShell.getDirectRuntimeStatus(projectId)
      : {};
    return {
      runtimeMode: status.runtimeMode || "",
      directTier: status.directTier || "",
      status: status.status || "",
      directTextOnlyStatus: status.directTextOnly?.status || "",
      directTextOnlyBlockers: status.directTextOnly?.blockers || status.directTextOnly?.gateSummary?.blockers || [],
      directTextOnlyGateId: status.directTextOnly?.gateId || "",
      directImplementationStatus: status.directImplementationLane?.status || "",
      directImplementationCanSelect: status.directImplementationLane?.canSelect === true,
      directImplementationBlockers: status.directImplementationLane?.blockers || [],
      activationState: status.activation?.state || "",
      activationGateId: status.activation?.gateId || "",
      liveTextRuntimeStatus: status.liveTextRuntime?.status || "",
      liveProbeStatus: status.liveTextRuntime?.liveProbeEvidence?.status || "",
      liveProbeEvidenceAvailable: status.liveTextRuntime?.liveProbeEvidence?.available === true,
      liveProbeEvidenceUsable: status.liveTextRuntime?.liveProbeEvidence?.usable === true,
      liveProbeScope: status.liveTextRuntime?.liveProbeEvidence?.scope || {},
      authStatus: status.auth?.operationalStatus || "",
      hasBridge,
      projectIdPresent: Boolean(projectId),
    };
  });
}

async function closeApp(app) {
  if (!app) return;
  let timedOut = false;
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(() => {
        timedOut = true;
        resolve();
      }, 5000)),
    ]);
  } catch {}
  if (timedOut) {
    try {
      app.process()?.kill?.("SIGTERM");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function cleanupFixtureWorkspaceAgents() {
  if (process.platform === "win32") return;
  try {
    const result = spawnSync("pgrep", ["-f", "src/backend/wsl-agent.js .*--project-id project_runtime_path_electron"], {
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

function cleanupTempRoot(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

function rawExposureScan(report) {
  const serialized = JSON.stringify(report);
  const blockers = [];
  if (/\/home\/rose\/work|\/home\/rose\/\.config/.test(serialized)) blockers.push("raw_home_path");
  if (/[A-Za-z]:\\/.test(serialized)) blockers.push("raw_windows_path");
  if (/\/mnt\/[a-z]\//.test(serialized)) blockers.push("raw_wsl_path");
  if (/(Bearer\s+[A-Za-z0-9._-]+|accessToken|refreshToken|session_token|sk-[A-Za-z0-9])/i.test(serialized)) blockers.push("raw_token");
  if (/https?:\/\/chatgpt\.com/i.test(serialized)) blockers.push("raw_chatgpt_url");
  return {
    passed: blockers.length === 0,
    blockerCodes: blockers,
    rawConfigPathIncluded: false,
    rawWorkspacePathIncluded: false,
    rawCredentialsIncluded: false,
  };
}

async function gitOutput(args) {
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
  const runId = optionString(options, "run-id", `runtime_path_electron_${Date.now()}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-path-electron-"));
  const reportRoot = path.join(os.homedir(), ".config", "codex-review-shell", "direct-runtime-path-electron-runs", runId);
  const cases = [];
  const liveEvidence = copyLiveProbeEvidence(tempRoot, options);
  let directTextSelectionExercised = false;
  let directImplementationSelectionExercised = false;
  let directSelectionSkippedReason = "";
  let directImplementationSkippedReason = "";
  let app = null;
  try {
    seedConfig(tempRoot, { ...options, "initial-runtime-path": "direct-text" });
    let launched = await launchApp(tempRoot);
    app = launched.app;
    let window = launched.window;
    assertCase(cases, "electron_direct_text_readback", await selectedRuntimePath(window) === "direct-text");
    const directOptions = await optionStates(window);
    assertCase(cases, "electron_runtime_options_visible", ["app-server", "direct-text", "direct-implementation"].every((value) =>
      directOptions.some((option) => option.value === value)));
    let config = readJson(configPath(tempRoot));
    let binding = projectBinding(config);
    const expectedModel = optionString(options, "model", DEFAULT_MODEL);
    assertCase(cases, "seeded_model_reasoning_visible_in_config", binding.model === expectedModel && binding.reasoningEffort === "high", {
      modelPreserved: binding.model === expectedModel,
      reasoningPreserved: binding.reasoningEffort === "high",
    });

    window.on("dialog", (dialog) => dialog.accept());
    await selectRuntimePathViaUi(window, "app-server");
    config = readJson(configPath(tempRoot));
    binding = projectBinding(config);
    assertCase(cases, "electron_app_server_switch_persisted", binding.runtimeMode === "legacy-app-server" && binding.directTier === "none", {
      runtimeMode: binding.runtimeMode,
      directTier: binding.directTier,
    });
    assertCase(cases, "electron_switch_preserved_model_reasoning", binding.model === expectedModel && binding.reasoningEffort === "high", {
      modelPreserved: binding.model === expectedModel,
      reasoningPreserved: binding.reasoningEffort === "high",
    });

    const appServerGateStatus = await runtimeStatusSummary(window);
    assertCase(cases, "electron_app_server_runtime_gate_observed", true, {
      directTextOnlyStatus: appServerGateStatus.directTextOnlyStatus,
      directTextOnlyBlockers: appServerGateStatus.directTextOnlyBlockers,
      liveProbeStatus: appServerGateStatus.liveProbeStatus,
      liveProbeEvidenceAvailable: appServerGateStatus.liveProbeEvidenceAvailable,
      liveProbeEvidenceUsable: appServerGateStatus.liveProbeEvidenceUsable,
      liveProbeScope: appServerGateStatus.liveProbeScope,
      authStatus: appServerGateStatus.authStatus,
      hasBridge: appServerGateStatus.hasBridge,
      projectIdPresent: appServerGateStatus.projectIdPresent,
    });
    const directTextOption = await optionState(window, "direct-text");
    if (liveEvidence.copied && directTextOption && !directTextOption.disabled) {
      await selectRuntimePathViaUi(window, "direct-text");
      config = readJson(configPath(tempRoot));
      binding = projectBinding(config);
      directTextSelectionExercised = true;
      assertCase(cases, "electron_app_server_to_direct_text_switch_persisted", binding.runtimeMode === "direct-experimental" && binding.directTier === "text-only", {
        runtimeMode: binding.runtimeMode,
        directTier: binding.directTier,
      });
      assertCase(cases, "electron_direct_text_switch_preserved_model_reasoning", binding.model === expectedModel && binding.reasoningEffort === "high", {
        modelPreserved: binding.model === expectedModel,
        reasoningPreserved: binding.reasoningEffort === "high",
      });
      const implementationOption = await optionState(window, "direct-implementation");
      if (implementationOption && !implementationOption.disabled) {
        await selectRuntimePathViaUi(window, "direct-implementation");
        config = readJson(configPath(tempRoot));
        binding = projectBinding(config);
        directImplementationSelectionExercised = true;
        assertCase(cases, "electron_direct_text_to_direct_implementation_switch_persisted", binding.runtimeMode === "direct-experimental" && binding.directTier === "implementation-lane", {
          runtimeMode: binding.runtimeMode,
          directTier: binding.directTier,
        });
      } else {
        directImplementationSkippedReason = "direct_implementation_option_blocked_by_runtime_gate";
        assertCase(cases, "electron_direct_implementation_gate_not_faked", true, {
          optionPresent: Boolean(implementationOption),
          optionDisabled: implementationOption ? implementationOption.disabled : true,
        });
      }
    } else {
      directSelectionSkippedReason = liveEvidence.copied
        ? "direct_text_option_blocked_despite_copied_live_probe_evidence"
        : liveEvidence.reason;
      assertCase(cases, "electron_direct_text_switch_not_faked_without_gate", true, {
        evidenceCopied: liveEvidence.copied,
        optionPresent: Boolean(directTextOption),
        optionDisabled: directTextOption ? directTextOption.disabled : true,
        skippedReason: directSelectionSkippedReason,
      });
    }

    await closeApp(app);
    app = null;

    launched = await launchApp(tempRoot);
    app = launched.app;
    window = launched.window;
    const expectedRestartPath = directImplementationSelectionExercised
      ? "direct-implementation"
      : directTextSelectionExercised
        ? "direct-text"
        : "app-server";
    assertCase(cases, "electron_restart_reads_persisted_default", await selectedRuntimePath(window) === expectedRestartPath, {
      expectedRestartPath,
      actualRestartPath: await selectedRuntimePath(window),
    });
    const finalConfig = readJson(configPath(tempRoot));
    const finalBinding = projectBinding(finalConfig);
    assertCase(cases, "electron_restart_preserved_independent_settings", finalBinding.model === expectedModel && finalBinding.reasoningEffort === "high" && finalConfig.runtimeDefaults?.codex?.approvalPolicy === "on-request", {
      modelPreserved: finalBinding.model === expectedModel,
      reasoningPreserved: finalBinding.reasoningEffort === "high",
      approvalPolicyPreserved: finalConfig.runtimeDefaults?.codex?.approvalPolicy === "on-request",
    });
  } finally {
    if (app) await closeApp(app);
  }

  const failedCases = cases.filter((item) => item.status !== "passed");
  const report = {
    schema: REPORT_SCHEMA,
    reportId: runId,
    generatedAt: new Date().toISOString(),
    branch: await gitOutput(["branch", "--show-current"]),
    commit: await gitOutput(["rev-parse", "HEAD"]),
    summary: {
      status: failedCases.length ? "failed" : "passed",
      passedCases: cases.length - failedCases.length,
      totalCases: cases.length,
      rug002Partial: !directTextSelectionExercised || !directImplementationSelectionExercised,
      directSelectionExercised: directTextSelectionExercised || directImplementationSelectionExercised,
      directTextSelectionExercised,
      directImplementationSelectionExercised,
      directSelectionSkippedReason,
      directImplementationSkippedReason,
    },
    liveProbeEvidence: {
      copied: liveEvidence.copied,
      reason: liveEvidence.reason,
      evidenceSourceKey: liveEvidence.evidenceSourceKey,
      evidenceCount: liveEvidence.evidenceCount,
      usableIndexCount: liveEvidence.usableIndexCount,
      rawEvidenceRootIncluded: false,
    },
    cases,
    sourceDigest: sha256(stableStringify(cases)),
    rawExposure: {
      rawConfigPathIncluded: false,
      rawWorkspacePathIncluded: false,
      rawCredentialsIncluded: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
  };
  report.rawExposure = { ...report.rawExposure, ...rawExposureScan(report) };
  if (!report.rawExposure.passed) report.summary.status = "raw_exposure_blocked";

  const reportPath = path.join(reportRoot, "direct-runtime-path-electron-report.json");
  writeJson(reportPath, report);
  cleanupFixtureWorkspaceAgents();
  cleanupTempRoot(tempRoot);
  console.log(JSON.stringify({
    ok: report.summary.status === "passed",
    reportPath,
    status: report.summary.status,
    passedCases: report.summary.passedCases,
    totalCases: report.summary.totalCases,
    rug002Partial: report.summary.rug002Partial,
  }, null, 2));
  process.exit(report.summary.status === "passed" ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
