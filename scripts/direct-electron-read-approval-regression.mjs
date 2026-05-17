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
const REPORT_SCHEMA = "direct_electron_read_approval_regression@1";
const PROFILE_NAME = "electron-read-approval";
const PROJECT_ID = "project_electron_read_approval";
const DEFAULT_MODEL = "gpt-5.5";
const SCENARIOS = {
  read: {
    toolName: "read_file",
    riskCategory: "readOnly",
    approvalMethod: "direct/tool/readOnly/requestApproval",
    approveButtonText: "Approve read",
    prompt: "Use the read_file tool to read src/alpha.txt. After the tool result, answer with one sentence starting READ-PROOF:",
    assistantPattern: /alpha/i,
  },
  patch: {
    toolName: "apply_patch",
    riskCategory: "write",
    approvalMethod: "direct/tool/patchApply/requestApproval",
    approveButtonText: "Approve patch",
    prompt: [
      "First use read_file to inspect src/alpha.txt.",
      "Then use apply_patch to update src/alpha.txt by changing the line 'alpha two' to 'alpha two patched'.",
      "Use a git-style unified diff with a/ and b/ prefixes.",
      "After the patch result, answer with one sentence starting PATCH-PROOF:",
    ].join(" "),
    assistantPattern: /patch|alpha/i,
  },
  command: {
    toolName: "run_command",
    riskCategory: "command",
    approvalMethod: "direct/tool/command/requestApproval",
    approveButtonText: "Approve command",
    prompt: "Use run_command to run npm test in the disposable workspace. Use command npm and args [\"test\"]. After the command result, answer with one sentence starting COMMAND-PROOF:",
    assistantPattern: /command|test|pass|ok/i,
  },
};

function isLinuxWithoutDisplay() {
  return process.platform === "linux" && !process.env.DISPLAY && process.env.CODEX_ELECTRON_READ_APPROVAL_UNDER_XVFB !== "1";
}

function relaunchUnderXvfb() {
  const child = spawn("xvfb-run", ["-a", process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_ELECTRON_READ_APPROVAL_UNDER_XVFB: "1" },
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

function normalizeEnvPath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

function implementationProofRunsRoot(tempRoot) {
  return path.join(profileRoot(tempRoot), "direct-implementation-proof-runs");
}

function seedWorkspace(workspaceRoot) {
  ensureDirectory(path.join(workspaceRoot, "src"));
  fs.writeFileSync(path.join(workspaceRoot, "src", "alpha.txt"), "alpha one\nalpha two\n", { mode: 0o600 });
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), `${JSON.stringify({
    scripts: {
      test: "node -e \"console.log('direct command probe ok')\"",
    },
  }, null, 2)}\n`, { mode: 0o600 });
  const git = (args) => spawnSync("git", args, {
    cwd: workspaceRoot,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (
    git(["init"]).status !== 0 ||
    git(["config", "user.email", "direct-probe@example.invalid"]).status !== 0 ||
    git(["config", "user.name", "Direct Probe"]).status !== 0 ||
    git(["add", "."]).status !== 0 ||
    git(["commit", "-m", "seed direct electron approval fixture"]).status !== 0
  ) {
    throw new Error("failed_to_seed_git_workspace_for_electron_approval_probe");
  }
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

function seedConfig(tempRoot, workspaceRoot, options = {}) {
  const model = optionString(options, "model", DEFAULT_MODEL);
  const initialRuntimePath = optionString(options, "initial-runtime-path", "app-server");
  const runtimeFields = bindingFieldsForRuntimePath(initialRuntimePath);
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
        name: "Electron Read Approval Fixture",
        repoPath: workspaceRoot,
        workspace: {
          kind: "local",
          localPath: workspaceRoot,
          label: "Disposable read approval workspace",
        },
        surfaceBinding: {
          codex: {
            mode: "url",
            ...runtimeFields,
            runtime: "auto",
            profileId: "profile-electron-read-approval",
            target: "",
            binaryPath: "codex",
            model,
            reasoningEffort: "high",
            label: initialRuntimePath === "app-server" ? "App Server read approval fixture" : "Direct Tools read approval fixture",
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

function implementationProofRootCandidates(options = {}) {
  const configured = optionString(options, "implementation-proof-root", "") ||
    normalizeEnvPath(process.env.CODEX_DIRECT_IMPLEMENTATION_PROOF_RUNS_ROOT || "");
  return [
    configured,
    path.join(os.homedir(), ".config", "codex-review-shell", "direct-implementation-proof-runs"),
    path.join(os.homedir(), ".config", "Codex Review Shell", "direct-implementation-proof-runs"),
  ].filter(Boolean);
}

function scopedProofSummary(root) {
  let reportCount = 0;
  let usableScopedRows = 0;
  const capabilityIds = new Set();
  let entries = [];
  try {
    if (!fs.statSync(root).isDirectory()) return { reportCount, usableScopedRows, capabilityIds: [] };
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const report = readJson(path.join(root, entry.name, "implementation-proof-report.json"));
    if (report?.schema !== "direct_implementation_lane_real_provider_proof_report@1") continue;
    reportCount += 1;
    const rows = Array.isArray(report.scopedImplementationLaneProof?.evidence)
      ? report.scopedImplementationLaneProof.evidence
      : [];
    for (const row of rows) {
      if (row?.usable !== true || row?.status !== "runtime_probed") continue;
      usableScopedRows += 1;
      if (row.scope?.capabilityId) capabilityIds.add(row.scope.capabilityId);
    }
  }
  return {
    reportCount,
    usableScopedRows,
    capabilityIds: [...capabilityIds].sort(),
  };
}

function implementationProofRootLooksUsable(root) {
  if (!root || !fs.existsSync(root)) return false;
  const summary = scopedProofSummary(root);
  return summary.capabilityIds.includes("read_file") && summary.capabilityIds.includes("read_file_loop");
}

function copyImplementationProofRuns(tempRoot, options = {}) {
  const sourceRoot = implementationProofRootCandidates(options).find(implementationProofRootLooksUsable) || "";
  if (!sourceRoot) {
    return {
      copied: false,
      reason: "implementation_proof_root_missing",
      proofSourceKey: "",
      reportCount: 0,
      usableScopedRows: 0,
      capabilityIds: [],
    };
  }
  const targetRoot = implementationProofRunsRoot(tempRoot);
  ensureDirectory(path.dirname(targetRoot));
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
  return {
    copied: true,
    reason: "",
    proofSourceKey: sha256(sourceRoot),
    ...scopedProofSummary(targetRoot),
  };
}

function assertCase(cases, caseId, condition, details = {}) {
  cases.push({
    caseId,
    status: condition ? "passed" : "failed",
    details,
  });
  if (!condition) {
    const error = new Error(`direct_electron_read_approval_case_failed:${caseId}`);
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
  await window.waitForSelector("#directRuntimePathSelect", { timeout: 20_000 });
  return { app, window };
}

async function selectedRuntimePath(window) {
  return window.$eval("#directRuntimePathSelect", (select) => select.value);
}

async function optionState(window, value) {
  return window.$$eval("#directRuntimePathSelect option", (options, targetValue) => {
    const option = options.find((entry) => entry.value === targetValue);
    return option
      ? { value: option.value, text: option.textContent || "", disabled: option.disabled }
      : null;
  }, value);
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
  }, runtimePath, { timeout: 20_000 });
  await window.click("#directRuntimePathApplyButton");
  await window.waitForFunction((nextPath) => {
    const select = document.querySelector("#directRuntimePathSelect");
    return select && select.value === nextPath;
  }, runtimePath, { timeout: 60_000 });
}

async function switchToDirectImplementation(window, cases) {
  assertCase(cases, "app_server_runtime_initially_selected", await selectedRuntimePath(window) === "app-server", {
    selectedRuntimePath: await selectedRuntimePath(window),
  });
  const directText = await optionState(window, "direct-text");
  assertCase(cases, "direct_text_option_available_for_approval_probe", directText && !directText.disabled, directText || {});
  await selectRuntimePathViaUi(window, "direct-text");
  assertCase(cases, "direct_text_selection_applied_before_tools", await selectedRuntimePath(window) === "direct-text", {
    selectedRuntimePath: await selectedRuntimePath(window),
  });
  const directTools = await optionState(window, "direct-implementation");
  assertCase(cases, "direct_tools_option_available_for_approval_probe", directTools && !directTools.disabled, directTools || {});
  await selectRuntimePathViaUi(window, "direct-implementation");
  assertCase(cases, "direct_tools_selection_applied_for_approval_probe", await selectedRuntimePath(window) === "direct-implementation", {
    selectedRuntimePath: await selectedRuntimePath(window),
  });
}

async function waitForCodexSurfacePage(app) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const pages = app.context().pages();
    const page = pages.find((candidate) => candidate.url().includes("codex-surface.html"));
    if (page) {
      await page.waitForSelector("#composerInput", { timeout: 20_000 });
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Codex surface page did not become available.");
}

async function waitForComposerReady(page) {
  try {
    await page.waitForFunction(() => {
      const input = document.querySelector("#composerInput");
      const button = document.querySelector("#sendButton");
      return input && button && !input.disabled && !button.disabled;
    }, null, { timeout: 90_000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const input = document.querySelector("#composerInput");
      const button = document.querySelector("#sendButton");
      const connection = document.querySelector("#connectionBadge");
      const messages = [...document.querySelectorAll("#transcript .message.system .bubble")]
        .slice(-5)
        .map((node) => node.textContent || "");
      return {
        inputPresent: Boolean(input),
        inputDisabled: input ? input.disabled : null,
        inputPlaceholder: input?.placeholder || "",
        buttonPresent: Boolean(button),
        buttonDisabled: button ? button.disabled : null,
        connectionText: connection?.textContent || "",
        recentSystemMessageSignals: messages.map((text) => ({
          charCount: text.length,
          sanitizedPreview: text
            .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, "[path]")
            .replace(/[A-Za-z]:\\[^\s]*/g, "[path]")
            .slice(0, 160),
          mentionsCapability: /capability/i.test(text),
          mentionsInitialization: /initialization/i.test(text),
          mentionsFailed: /failed/i.test(text),
        })),
      };
    });
    const wrapped = new Error(`composer_not_ready:${error?.message || "timeout"}`);
    wrapped.details = state;
    throw wrapped;
  }
}

async function runtimeStatus(window) {
  return window.evaluate(async (projectId) => {
    const status = await window.workspaceShell.getDirectRuntimeStatus(projectId);
    return {
      runtimeMode: status.runtimeMode || "",
      directTier: status.directTier || "",
      implementationSelected: status.directImplementationLane?.selected === true,
      implementationStatus: status.directImplementationLane?.status || "",
      canApproveReadFile: status.directImplementationLane?.canApproveReadFile === true,
      canShowApprovalCards: status.directImplementationLane?.canShowApprovalCards === true,
      blockers: status.directImplementationLane?.blockers || [],
      proofStatus: status.directImplementationLane?.implementationProof?.status || "",
      proofEvidenceState: status.directImplementationLane?.implementationProof?.evidenceState || "",
      proofMissingCapabilityIds: status.directImplementationLane?.implementationProof?.missingCapabilityIds || [],
      authStatus: status.auth?.operationalStatus || status.direct?.auth?.status || "",
      liveProbeStatus: status.liveTextRuntime?.liveProbeEvidence?.status || status.direct?.liveProbeEvidence?.status || "",
    };
  }, PROJECT_ID);
}

async function readImplementationProjection(page) {
  return page.evaluate(async (projectId) => {
    const status = await window.codexSurfaceBridge.getDirectImplementationLaneUiStatus(projectId);
    const history = await window.codexSurfaceBridge.readDirectImplementationOperationHistory(projectId, { scope: "active-turn", limit: 24 });
    const latestToolResult = status?.latestToolResult || {};
    return {
      statusSchema: status?.schema || "",
      historySchema: history?.schema || "",
      activeRuntimeTier: status?.activeRuntimeTier || "",
      canApproveRead: status?.implementationLane?.facets?.canApproveRead?.canUse === true,
      canShowApprovalCards: status?.implementationLane?.canShowApprovalCards === true,
      activeTurnState: status?.activeTurn?.state || "",
      unresolvedObligationCount: status?.currentSession?.unresolvedObligationCount ?? null,
      historyRows: Array.isArray(history?.rows) ? history.rows.length : 0,
      historyActionableRows: Array.isArray(history?.rows)
        ? history.rows.filter((row) => row?.actionability?.actionable === true).length
        : 0,
      historyFamilies: Array.isArray(history?.rows) ? [...new Set(history.rows.map((row) => row.family).filter(Boolean))].sort() : [],
      historyEventKinds: Array.isArray(history?.rows) ? [...new Set(history.rows.map((row) => row.eventKind).filter(Boolean))].sort() : [],
      historyArtifactKinds: Array.isArray(history?.rows)
        ? [...new Set(history.rows.flatMap((row) => Array.isArray(row.artifactRefs)
          ? row.artifactRefs.map((ref) => ref.kind).filter(Boolean)
          : []))].sort()
        : [],
      historyArtifactLabels: Array.isArray(history?.rows)
        ? [...new Set(history.rows.flatMap((row) => Array.isArray(row.artifactRefs)
          ? row.artifactRefs.map((ref) => ref.label).filter(Boolean)
          : []))].sort()
        : [],
      historyEvidenceKeyCount: Array.isArray(history?.rows)
        ? history.rows.reduce((count, row) => count + (Array.isArray(row.evidenceKeys) ? row.evidenceKeys.length : 0), 0)
        : 0,
      latestToolResult: {
        schema: latestToolResult.schema || "",
        tool: latestToolResult.tool || "",
        status: latestToolResult.status || "",
        resultClass: latestToolResult.resultClass || "",
        sideEffectExecuted: latestToolResult.sideEffectExecuted === true,
        workspaceEffectSummaryId: latestToolResult.workspaceEffectSummaryId || "",
        workspaceEffectScanRan: latestToolResult.workspaceEffectScanRan === true,
        workspaceEffectScanSupported: latestToolResult.workspaceEffectScanSupported === true,
        workspaceChangesDetected: latestToolResult.workspaceChangesDetected === true,
        changedPathCount: Number(latestToolResult.changedPathCount || 0),
        providerVisibility: latestToolResult.providerVisibility || "",
        providerSawChangedFileContents: latestToolResult.providerSawChangedFileContents === true,
        providerSawAllChangedFileContents: latestToolResult.providerSawAllChangedFileContents === true,
        visibleMessageCode: latestToolResult.visibleMessageCode || "",
        actionabilityActionable: latestToolResult.actionability?.actionable === true,
        rawProviderPayloadIncluded: latestToolResult.rawProviderPayloadIncluded === true,
        rawWorkspacePathIncluded: latestToolResult.rawWorkspacePathIncluded === true,
        rawToolOutputIncluded: latestToolResult.rawToolOutputIncluded === true,
      },
      rawProviderPayloadIncluded: status?.rawProviderPayloadIncluded === true ||
        status?.latestToolResult?.rawProviderPayloadIncluded === true ||
        history?.rawProviderPayloadIncluded === true,
      rawLocalPathIncluded: status?.rawLocalPathIncluded === true ||
        status?.latestToolResult?.rawWorkspacePathIncluded === true ||
        history?.rawLocalPathIncluded === true,
      rawToolOutputIncluded: status?.rawToolOutputIncluded === true ||
        status?.latestToolResult?.rawToolOutputIncluded === true ||
        history?.rawToolOutputIncluded === true,
    };
  }, PROJECT_ID);
}

function assertPostToolStatus(cases, scenarioName, projection) {
  const latest = projection.latestToolResult || {};
  const baseSafe = latest.schema === "direct_tool_result_status_projection@1" &&
    latest.tool === SCENARIOS[scenarioName].toolName &&
    latest.actionabilityActionable === false &&
    latest.rawProviderPayloadIncluded === false &&
    latest.rawWorkspacePathIncluded === false &&
    latest.rawToolOutputIncluded === false;
  if (scenarioName === "read") {
    assertCase(cases, "read_result_status_recorded_without_workspace_effect", baseSafe &&
      latest.status === "completed" &&
      latest.sideEffectExecuted === false &&
      latest.workspaceEffectSummaryId === "" &&
      latest.workspaceChangesDetected === false &&
      latest.providerVisibility === "none", latest);
    assertCase(cases, "read_operation_history_records_read_result", projection.historyRows > 0 &&
      projection.historyFamilies.includes("read") &&
      projection.historyArtifactKinds.includes("tool_result") &&
      projection.historyActionableRows === 0 &&
      projection.historyEvidenceKeyCount > 0, projection);
    return;
  }
  if (scenarioName === "patch") {
    assertCase(cases, "patch_result_status_records_workspace_summary_only_visibility", baseSafe &&
      latest.status === "applied" &&
      latest.resultClass === "patch_applied" &&
      latest.sideEffectExecuted === true &&
      latest.workspaceEffectSummaryId.length > 0 &&
      latest.workspaceEffectScanRan === true &&
      latest.workspaceChangesDetected === true &&
      latest.changedPathCount > 0 &&
      latest.providerVisibility === "summary_only" &&
      latest.providerSawChangedFileContents === false &&
      latest.visibleMessageCode === "workspace_changed_provider_saw_summary_only", latest);
    assertCase(cases, "patch_operation_history_records_patch_and_workspace_effect", projection.historyRows >= 2 &&
      projection.historyFamilies.includes("patch") &&
      projection.historyFamilies.includes("workspace-effect") &&
      projection.historyArtifactKinds.includes("tool_result") &&
      projection.historyArtifactKinds.includes("workspace_effect_summary") &&
      projection.historyActionableRows === 0 &&
      projection.historyEvidenceKeyCount >= 2, projection);
    return;
  }
  if (scenarioName === "command") {
    assertCase(cases, "command_result_status_records_scan_and_clean_workspace", baseSafe &&
      latest.status === "completed_exit_zero" &&
      latest.sideEffectExecuted === true &&
      latest.workspaceEffectSummaryId.length > 0 &&
      latest.workspaceEffectScanRan === true &&
      latest.workspaceChangesDetected === false &&
      latest.changedPathCount === 0 &&
      latest.providerVisibility === "none" &&
      latest.visibleMessageCode === "workspace_effect_scan_recorded_no_changes", latest);
    assertCase(cases, "command_operation_history_records_command_and_workspace_effect", projection.historyRows >= 2 &&
      projection.historyFamilies.includes("command") &&
      projection.historyFamilies.includes("workspace-effect") &&
      projection.historyArtifactKinds.includes("tool_result") &&
      projection.historyArtifactKinds.includes("workspace_effect_summary") &&
      projection.historyActionableRows === 0 &&
      projection.historyEvidenceKeyCount >= 2, projection);
  }
}

async function submitPrompt(page, scenario) {
  await waitForComposerReady(page);
  await page.fill("#composerInput", scenario.prompt);
  await page.$eval("#composerForm", (form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function approvalCardSnapshot(page, scenario) {
  return page.evaluate((input) => {
    const card = document.querySelector(`.codex-request-card.${input.riskCategory}`);
    const text = card?.textContent || "";
    return {
      visible: Boolean(card),
      pending: Boolean(card?.classList.contains("pending")),
      completed: Boolean(card?.classList.contains("completed")),
      status: card?.querySelector(".codex-request-status")?.textContent || "",
      hasApproveButton: Boolean([...document.querySelectorAll(`.codex-request-card.${input.riskCategory} button`)]
        .some((button) => (button.textContent || "").trim() === input.approveButtonText)),
      mentionsTool: text.includes(input.toolName),
      mentionsExpectedTarget: input.name === "command" ? /npm test|npm/.test(text) : /src\/alpha\.txt/.test(text),
      mentionsProviderCallType: /call type/i.test(text),
    };
  }, scenario);
}

async function approveVisibleRequest(page, scenario) {
  const selector = `.codex-request-card.${scenario.riskCategory}.pending`;
  await page.waitForSelector(selector, { timeout: 180_000 });
  await page.locator(`${selector} button`, { hasText: scenario.approveButtonText }).click();
}

async function waitForTargetApprovalCard(page, scenario) {
  const readScenario = { ...SCENARIOS.read, name: "read" };
  const targetSelector = `.codex-request-card.${scenario.riskCategory}.pending`;
  const preludeApprovals = [];
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await page.locator(targetSelector).count()) return preludeApprovals;
    if (scenario.name !== "read" && await page.locator(".codex-request-card.readOnly.pending").count()) {
      const snapshot = await approvalCardSnapshot(page, readScenario);
      await approveVisibleRequest(page, readScenario);
      await waitForCompletedCard(page, readScenario);
      preludeApprovals.push({
        toolName: "read_file",
        status: "approved",
        mentionsExpectedTarget: snapshot.mentionsExpectedTarget,
      });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const visibleCards = await page.evaluate(() => [...document.querySelectorAll(".codex-request-card")].map((card) => ({
    className: card.className,
    status: card.querySelector(".codex-request-status")?.textContent || "",
    textSignals: {
      mentionsRead: /read_file/i.test(card.textContent || ""),
      mentionsPatch: /apply_patch/i.test(card.textContent || ""),
      mentionsCommand: /run_command/i.test(card.textContent || ""),
      hasApprove: /approve/i.test(card.textContent || ""),
    },
  })));
  const pageSignals = await page.evaluate((input) => {
    const safePreview = (value) => String(value || "")
      .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, "[path]")
      .replace(/[A-Za-z]:\\[^\s]*/g, "[path]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [token]")
      .slice(0, 180);
    const assistantTexts = [...document.querySelectorAll(".message.assistant .bubble")]
      .map((bubble) => bubble.dataset.rawText || bubble.textContent || "");
    const systemTexts = [...document.querySelectorAll(".message.system .bubble")]
      .map((bubble) => bubble.textContent || "");
    const requestRows = [...document.querySelectorAll(".request-row, .codex-request-card, [data-request-id]")]
      .map((node) => node.textContent || "");
    return {
      assistantMessageCount: assistantTexts.length,
      assistantCharCounts: assistantTexts.map((text) => text.length),
      assistantMentionsScenarioTool: assistantTexts.some((text) => text.includes(input.toolName)),
      assistantMentionsProofPrefix: assistantTexts.some((text) => new RegExp(`${input.name.toUpperCase()}-PROOF:`, "i").test(text)),
      systemMessageSignals: systemTexts.slice(-8).map((text) => ({
        charCount: text.length,
        sanitizedPreview: safePreview(text),
        mentionsError: /error|failed|failure/i.test(text),
        mentionsTool: /tool|function/i.test(text),
        mentionsUnsupported: /unsupported/i.test(text),
        mentionsTransport: /transport|provider|response/i.test(text),
      })),
      requestRowSignals: requestRows.slice(-8).map((text) => ({
        charCount: text.length,
        sanitizedPreview: safePreview(text),
        mentionsRead: /read_file/i.test(text),
        mentionsPatch: /apply_patch/i.test(text),
        mentionsCommand: /run_command/i.test(text),
        mentionsApprove: /approve/i.test(text),
      })),
      composerDisabled: document.querySelector("#composerInput")?.disabled === true,
      sendDisabled: document.querySelector("#sendButton")?.disabled === true,
    };
  }, scenario);
  let projectionSignals = {};
  try {
    projectionSignals = await readImplementationProjection(page);
  } catch (projectionError) {
    projectionSignals = {
      projectionReadFailed: true,
      projectionErrorCode: String(projectionError?.message || projectionError).slice(0, 120),
    };
  }
  const error = new Error(`target_approval_card_not_visible:${scenario.name}`);
  error.details = { targetRiskCategory: scenario.riskCategory, preludeApprovals, visibleCards, pageSignals, projectionSignals };
  throw error;
}

async function waitForCompletedCard(page, scenario) {
  await page.waitForFunction((input) => {
    const card = document.querySelector(`.codex-request-card.${input.riskCategory}`);
    return card && card.classList.contains("completed") && /approve|completed/i.test(card.textContent || "");
  }, scenario, { timeout: 240_000 });
}

async function waitForAssistantProof(page, scenario) {
  try {
    await page.waitForFunction((input) => {
      const pattern = new RegExp(input.assistantPatternSource, input.assistantPatternFlags);
      return [...document.querySelectorAll(".message.assistant .bubble")]
        .some((bubble) => {
          const text = bubble.dataset.rawText || bubble.textContent || "";
          return text.length >= 20 && pattern.test(text);
        });
    }, {
      assistantPatternSource: scenario.assistantPattern.source,
      assistantPatternFlags: scenario.assistantPattern.flags,
    }, { timeout: 240_000 });
  } catch (error) {
    const state = await page.evaluate((input) => {
      const assistantTexts = [...document.querySelectorAll(".message.assistant .bubble")]
        .map((bubble) => bubble.dataset.rawText || bubble.textContent || "");
      const systemTexts = [...document.querySelectorAll(".message.system .bubble")]
        .map((bubble) => bubble.textContent || "");
      const cards = [...document.querySelectorAll(".codex-request-card")].map((card) => ({
        className: card.className,
        status: card.querySelector(".codex-request-status")?.textContent || "",
        hasApproveText: /approve/i.test(card.textContent || ""),
        hasScenarioToolText: card.textContent?.includes(input.toolName) === true,
      }));
      const pattern = new RegExp(input.assistantPatternSource, input.assistantPatternFlags);
      return {
        assistantMessageCount: assistantTexts.length,
        assistantCharCounts: assistantTexts.map((text) => text.length),
        assistantProofPrefixObserved: assistantTexts.some((text) => new RegExp(`${input.name.toUpperCase()}-PROOF:`, "i").test(text)),
        assistantMentionsExpectedEvidence: assistantTexts.some((text) => pattern.test(text)),
        systemMessageSignals: systemTexts.slice(-8).map((text) => ({
          charCount: text.length,
          mentionsError: /error/i.test(text),
          mentionsWarning: /warning/i.test(text),
          mentionsTool: /tool/i.test(text),
          mentionsContinuation: /continuation/i.test(text),
        })),
        cards,
      };
    }, {
      name: scenario.name,
      toolName: scenario.toolName,
      assistantPatternSource: scenario.assistantPattern.source,
      assistantPatternFlags: scenario.assistantPattern.flags,
    });
    const wrapped = new Error(`assistant_continuation_not_observed:${error?.message || "timeout"}`);
    wrapped.details = state;
    throw wrapped;
  }
  return page.evaluate((input) => {
    const pattern = new RegExp(input.assistantPatternSource, input.assistantPatternFlags);
    const texts = [...document.querySelectorAll(".message.assistant .bubble")]
      .map((bubble) => bubble.dataset.rawText || bubble.textContent || "")
      .filter((text) => text.length >= 20 && pattern.test(text));
    const latest = texts.at(-1) || "";
    return {
      proofObserved: Boolean(latest),
      proofPrefixObserved: new RegExp(`${input.name.toUpperCase()}-PROOF:`, "i").test(latest),
      assistantMentionsExpectedEvidence: pattern.test(latest),
      assistantMessageCount: texts.length,
      latestAssistantCharCount: latest.length,
    };
  }, {
    name: scenario.name,
    assistantPatternSource: scenario.assistantPattern.source,
    assistantPatternFlags: scenario.assistantPattern.flags,
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

function cleanupTempRoot(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

function pathLeakVariants(value) {
  const text = String(value || "");
  if (!text) return [];
  return [
    text,
    text.replace(/\\/g, "\\\\"),
    text.replace(/\\/g, "/"),
  ].filter(Boolean);
}

function containsPathLeak(serialized, paths = []) {
  return paths
    .flatMap(pathLeakVariants)
    .some((variant) => variant && serialized.includes(variant));
}

function rawExposureScan(report, leakRoots = []) {
  const serialized = JSON.stringify(report);
  const blockers = [];
  if (containsPathLeak(serialized, [os.homedir(), repoRoot, ...leakRoots])) blockers.push("raw_host_path");
  if (/[A-Za-z]:\\/.test(serialized)) blockers.push("raw_windows_path");
  if (/\/mnt\/[a-z]\//.test(serialized)) blockers.push("raw_wsl_path");
  if (/(Bearer\s+[A-Za-z0-9._-]+|accessToken|refreshToken|session_token|sk-[A-Za-z0-9_-]{16,})/i.test(serialized)) blockers.push("raw_token");
  if (/https?:\/\/chatgpt\.com/i.test(serialized)) blockers.push("raw_chatgpt_url");
  return {
    passed: blockers.length === 0,
    blockerCodes: blockers,
    rawConfigPathIncluded: false,
    rawWorkspacePathIncluded: false,
    rawCredentialsIncluded: false,
    rawProviderPayloadIncluded: false,
    rawToolOutputIncluded: false,
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
  const scenarioName = optionString(options, "scenario", "read");
  const scenario = { ...(SCENARIOS[scenarioName] || {}), name: scenarioName };
  if (!SCENARIOS[scenarioName]) {
    throw new Error(`Unsupported Electron approval scenario: ${scenarioName}`);
  }
  const allowLive = options["allow-live-provider-call"] === true || process.env.CODEX_DIRECT_ELECTRON_READ_APPROVAL_LIVE === "1";
  if (!allowLive) {
    throw new Error("This regression starts one live Direct provider turn. Pass --allow-live-provider-call or set CODEX_DIRECT_ELECTRON_READ_APPROVAL_LIVE=1.");
  }
  const runId = optionString(options, "run-id", `electron_${scenarioName}_approval_${Date.now()}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-electron-read-approval-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const reportRoot = path.join(os.homedir(), ".config", "codex-review-shell", "direct-electron-read-approval-runs", runId);
  const cases = [];
  const consoleEvents = [];
  const pageErrors = [];
  const liveEvidence = copyLiveProbeEvidence(tempRoot, options);
  const implementationProof = copyImplementationProofRuns(tempRoot, options);
  let app = null;
  let finalRuntimeStatus = {};
  let projectionAfterApproval = {};
  let cardBeforeApproval = {};
  let cardAfterApproval = {};
  let assistantProof = {};
  let preludeApprovals = [];
  let caughtError = null;
  try {
    seedWorkspace(workspaceRoot);
    seedConfig(tempRoot, workspaceRoot, { ...options, "initial-runtime-path": "app-server" });
    assertCase(cases, "live_provider_opt_in_present", allowLive);
    assertCase(cases, "live_probe_evidence_copied", liveEvidence.copied === true, {
      evidenceCount: liveEvidence.evidenceCount,
      usableIndexCount: liveEvidence.usableIndexCount,
    });
    assertCase(cases, "scoped_tool_proof_evidence_copied", implementationProof.copied === true &&
      implementationProof.capabilityIds.includes("read_file") &&
      implementationProof.capabilityIds.includes("read_file_loop") &&
      implementationProof.capabilityIds.includes(scenario.toolName), {
      reportCount: implementationProof.reportCount,
      usableScopedRows: implementationProof.usableScopedRows,
      capabilityIds: implementationProof.capabilityIds,
      scenario: scenarioName,
      requiredCapabilityId: scenario.toolName,
    });

    const launched = await launchApp(tempRoot);
    app = launched.app;
    const window = launched.window;
    window.on("dialog", (dialog) => dialog.accept());
    await switchToDirectImplementation(window, cases);
    const page = await waitForCodexSurfacePage(app);
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleEvents.push({ type: message.type(), textHash: sha256(message.text()).slice(0, 16) });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ messageHash: sha256(error?.message || String(error)).slice(0, 16) });
    });

    const initialRuntimeStatus = await runtimeStatus(window);
    assertCase(cases, "direct_tools_runtime_selected_and_tool_ready", initialRuntimeStatus.implementationSelected === true &&
      ["enabled", "degraded"].includes(initialRuntimeStatus.implementationStatus) &&
      initialRuntimeStatus.canApproveReadFile === true, initialRuntimeStatus);

    await submitPrompt(page, scenario);
    preludeApprovals = await waitForTargetApprovalCard(page, scenario);
    cardBeforeApproval = await approvalCardSnapshot(page, scenario);
    assertCase(cases, `${scenarioName}_approval_card_visible_with_renderer_safe_details`, cardBeforeApproval.visible &&
      cardBeforeApproval.pending &&
      cardBeforeApproval.hasApproveButton &&
      cardBeforeApproval.mentionsTool &&
      cardBeforeApproval.mentionsExpectedTarget &&
      cardBeforeApproval.mentionsProviderCallType, cardBeforeApproval);

    await approveVisibleRequest(page, scenario);
    await waitForCompletedCard(page, scenario);
    cardAfterApproval = await approvalCardSnapshot(page, scenario);
    assertCase(cases, `${scenarioName}_approval_card_status_completed_after_click`, cardAfterApproval.completed && /completed/i.test(cardAfterApproval.status), cardAfterApproval);

    assistantProof = await waitForAssistantProof(page, scenario);
    assertCase(cases, "provider_continuation_completed_with_assistant_output", assistantProof.proofObserved && assistantProof.assistantMentionsExpectedEvidence, assistantProof);

    projectionAfterApproval = await readImplementationProjection(page);
    assertCase(cases, "implementation_projection_status_and_history_safe_after_approval", projectionAfterApproval.statusSchema === "direct_implementation_lane_ui_status@1" &&
      projectionAfterApproval.historySchema === "direct_operation_history_projection@1" &&
      projectionAfterApproval.activeRuntimeTier === "direct-implementation-lane" &&
      projectionAfterApproval.canApproveRead === true &&
      projectionAfterApproval.historyRows > 0 &&
      projectionAfterApproval.historyActionableRows === 0 &&
      projectionAfterApproval.rawProviderPayloadIncluded === false &&
      projectionAfterApproval.rawLocalPathIncluded === false &&
      projectionAfterApproval.rawToolOutputIncluded === false, projectionAfterApproval);
    assertPostToolStatus(cases, scenarioName, projectionAfterApproval);

    finalRuntimeStatus = await runtimeStatus(window);
    assertCase(cases, "direct_tools_runtime_still_selected_after_live_tool", finalRuntimeStatus.implementationSelected === true && finalRuntimeStatus.canApproveReadFile === true, finalRuntimeStatus);
  } catch (error) {
    caughtError = error;
    if (error?.caseId && !cases.some((item) => item.caseId === error.caseId)) {
      cases.push({
        caseId: error.caseId,
        status: "failed",
        details: error.details || { message: error.message || "case failed" },
      });
    } else if (!error?.caseId) {
      cases.push({
        caseId: `electron_${scenarioName}_approval_unhandled_error`,
        status: "failed",
        details: error?.details || {
          messageHash: sha256(error?.message || String(error)).slice(0, 16),
          code: error?.code || "",
        },
      });
    }
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
      scenario: scenarioName,
      liveProviderTurnExercised: true,
      visibleApprovalCardExercised: Boolean(cardBeforeApproval.visible && cardAfterApproval.completed),
      finalAssistantProofObserved: Boolean(assistantProof.proofObserved),
      failureKind: caughtError ? (caughtError.caseId || caughtError.code || "unhandled_error") : "",
    },
    liveProbeEvidence: {
      copied: liveEvidence.copied,
      reason: liveEvidence.reason,
      evidenceSourceKey: liveEvidence.evidenceSourceKey,
      evidenceCount: liveEvidence.evidenceCount,
      usableIndexCount: liveEvidence.usableIndexCount,
      rawEvidenceRootIncluded: false,
    },
    implementationProofEvidence: {
      copied: implementationProof.copied,
      reason: implementationProof.reason,
      proofSourceKey: implementationProof.proofSourceKey,
      reportCount: implementationProof.reportCount,
      usableScopedRows: implementationProof.usableScopedRows,
      capabilityIds: implementationProof.capabilityIds,
      rawProofRootIncluded: false,
    },
    uiEvidence: {
      promptClass: `${scenarioName}_visible_approval`,
      promptDigest: sha256(scenario.prompt),
      relPath: scenarioName === "command" ? "" : "src/alpha.txt",
      toolName: scenario.toolName,
      cardBeforeApproval,
      cardAfterApproval,
      preludeApprovals,
      assistantProof,
      projectionAfterApproval,
      finalRuntimeStatus,
      consoleWarningOrErrorCount: consoleEvents.length,
      pageErrorCount: pageErrors.length,
      consoleEventHashes: consoleEvents.slice(0, 12),
      pageErrorHashes: pageErrors.slice(0, 12),
    },
    cases,
    sourceDigest: sha256(stableStringify({ cases, cardBeforeApproval, cardAfterApproval, preludeApprovals, assistantProof, projectionAfterApproval })),
    rawExposure: {
      rawConfigPathIncluded: false,
      rawWorkspacePathIncluded: false,
      rawCredentialsIncluded: false,
      rawProviderPayloadIncluded: false,
      rawToolOutputIncluded: false,
    },
    sentinelCounters: {
      providerTransportCallsExpected: true,
      providerTransportCallsMinimum: 1,
      patchApplyCallsExpected: scenario.toolName === "apply_patch",
      commandRunCallsExpected: scenario.toolName === "run_command",
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
  };
  report.rawExposure = { ...report.rawExposure, ...rawExposureScan(report, [tempRoot, workspaceRoot]) };
  if (!report.rawExposure.passed) report.summary.status = "raw_exposure_blocked";

  const reportPath = path.join(reportRoot, "direct-electron-read-approval-report.json");
  writeJson(reportPath, report);
  cleanupFixtureWorkspaceAgents();
  cleanupTempRoot(tempRoot);
  console.log(JSON.stringify({
    ok: report.summary.status === "passed",
    reportPath,
    status: report.summary.status,
    passedCases: report.summary.passedCases,
    totalCases: report.summary.totalCases,
  }, null, 2));
  process.exit(report.summary.status === "passed" ? 0 : 1);
}

if (!relaunchingUnderXvfb) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    if (error?.details) console.error(JSON.stringify(error.details, null, 2));
    process.exit(1);
  });
}
