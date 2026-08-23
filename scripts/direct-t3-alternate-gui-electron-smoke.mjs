#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");

if (process.platform === "linux" && !process.env.DISPLAY && process.env.CODEX_T3_GUI_UNDER_XVFB !== "1") {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("xvfb-run", ["-a", process.execPath, scriptPath], {
      cwd: repoRoot,
      env: { ...process.env, CODEX_T3_GUI_UNDER_XVFB: "1" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Direct Workbench smoke exited by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  process.exit(exitCode);
}

const testRoot = fs.mkdtempSync(path.join(process.platform === "linux" ? "/tmp" : os.tmpdir(), "direct-t3-gui-electron-"));
const userDataRoot = path.join(testRoot, "profile");
const screenshotPath = process.env.CODEX_T3_GUI_SCREENSHOT || path.join(testRoot, "t3-direct-gui.png");
const intakeScreenshotPath = screenshotPath.replace(/\.png$/i, "-thread-intake.png");
const projectDirectoryScreenshotPath = screenshotPath.replace(/\.png$/i, "-project-directory.png");
const projectBindingEditorScreenshotPath = screenshotPath.replace(/\.png$/i, "-project-binding-editor.png");
const projectLifecycleScreenshotPath = screenshotPath.replace(/\.png$/i, "-project-lifecycle.png");
const threadDirectoryScreenshotPath = screenshotPath.replace(/\.png$/i, "-thread-directory.png");
const narrowThreadDirectoryScreenshotPath = screenshotPath.replace(/\.png$/i, "-thread-directory-narrow.png");
const epistemicScreenshotPath = screenshotPath.replace(/\.png$/i, "-epistemic.png");
const usageScreenshotPath = screenshotPath.replace(/\.png$/i, "-usage.png");
const localProjectRoot = path.join(testRoot, "local-fixture");
const usageHome = path.join(testRoot, "usage-home");
const localProjectSentinel = path.join(localProjectRoot, "workspace-preserved.txt");
fs.mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });
fs.mkdirSync(localProjectRoot, { recursive: true });
fs.writeFileSync(localProjectSentinel, "project binding lifecycle must not delete workspace files\n");
const usageSessionPath = path.join(usageHome, ".codex", "sessions", "2026", "08", "usage-fixture.jsonl");
fs.mkdirSync(path.dirname(usageSessionPath), { recursive: true });
fs.writeFileSync(usageSessionPath, [
  JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: "usage-fixture", cwd: localProjectRoot, model: "gpt-5.6-sol" } }),
  JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 100_000, output_tokens: 200_000, reasoning_output_tokens: 20_000 } }, rate_limits: { plan_type: "fixture", primary: { used_percent: 37, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 } } } }),
].join("\n") + "\n");

fs.writeFileSync(path.join(userDataRoot, "workspace-config.json"), `${JSON.stringify({
  version: 5,
  selectedProjectId: "project_t3_gui_fixture",
  runtimeDefaults: {
    codex: {
      approvalPolicy: "never",
      sandboxMode: "read-only",
    },
  },
  projects: [{
    id: "project_t3_gui_fixture",
    name: "WSL Direct GUI Fixture",
    repoPath: "wsl:Ubuntu:/home/rose/work/direct-gui-fixture",
    workspace: {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/rose/work/direct-gui-fixture",
      label: "WSL native workspace",
    },
    surfaceBinding: {
      codex: {
        mode: "managed",
        bindingProvider: "codex-compatible",
        runtimeMode: "direct-experimental",
        directTransport: "fixture",
        directTier: "implementation-lane",
        runtime: "host",
        target: "codex://t3-alternate-gui-fixture",
        binaryPath: "codex",
        label: "Fixture-only Direct runtime",
      },
      chatgpt: {
        reviewThreadUrl: "",
        reduceChrome: true,
      },
    },
    chatThreads: [],
    laneBindings: [{
      id: "binding_direct_workbench_startup",
      lane: "implementation",
      label: "Bound Direct thread",
      codexThreadRef: {
        threadId: "thread_direct_workbench_bound",
        originator: "codex",
        titleSnapshot: "Bound startup thread",
        cwdSnapshot: repoRoot,
        sourceHome: "/tmp/direct-workbench-bound-home",
        sessionFilePath: path.join(testRoot, "sessions", "bound-thread.jsonl"),
      },
      chatThreadId: "",
      isDefaultForLane: true,
      openOnProjectActivate: true,
      status: "resolved",
    }],
    promptTemplates: {},
    flowProfile: {},
  }, {
    id: "project_t3_windows_fixture",
    name: "Windows Direct GUI Fixture",
    repoPath: "C:\\Fixtures\\direct-gui",
    workspace: {
      kind: "windows",
      windowsPath: "C:\\Fixtures\\direct-gui",
      label: "Windows native workspace",
    },
    surfaceBinding: {
      codex: {
        mode: "managed",
        bindingProvider: "codex-compatible",
        runtimeMode: "direct-experimental",
        directTransport: "fixture",
        directTier: "implementation-lane",
        runtime: "host",
        target: "codex://t3-windows-gui-fixture",
        binaryPath: "codex",
        label: "Windows fixture-only Direct runtime",
      },
      chatgpt: {
        reviewThreadUrl: "",
        reduceChrome: true,
      },
    },
    chatThreads: [],
    laneBindings: [{
      id: "binding_direct_workbench_windows",
      lane: "implementation",
      label: "Bound Windows Direct thread",
      codexThreadRef: {
        threadId: "thread_direct_workbench_windows",
        originator: "codex",
        titleSnapshot: "Windows bound thread",
        cwdSnapshot: "C:\\Fixtures\\direct-gui",
      },
      chatThreadId: "",
      isDefaultForLane: true,
      openOnProjectActivate: true,
      status: "resolved",
    }],
    promptTemplates: {},
    flowProfile: {},
  }],
}, null, 2)}\n`, { mode: 0o600 });

const launchEnvironment = { ...process.env };
delete launchEnvironment.CODEX_WORLD_MANAGER;
delete launchEnvironment.CODEX_WORLD_MANAGER_MOCKUP;
delete launchEnvironment.CODEX_DIRECT_T3_GUI;
launchEnvironment.CODEX_EXPERIENCE = "direct-workbench";
launchEnvironment.CODEX_REVIEW_SHELL_USER_DATA_DIR = userDataRoot;
launchEnvironment.CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH = "";
launchEnvironment.CODEX_DIRECT_USAGE_HOME = usageHome;
launchEnvironment.LIBGL_ALWAYS_SOFTWARE = "1";

const rendererErrors = [];
const app = await electron.launch({
  args: [repoRoot, "--disable-gpu"],
  cwd: repoRoot,
  env: launchEnvironment,
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(`page:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(`console:${message.text()}`);
  });

  await page.waitForSelector('body[data-direct-gui="direct-workbench"][data-experience-state="verified"]', { timeout: 30_000 });
  assert.equal(await page.title(), "Direct Workbench");
  assert.match(page.url(), /\/t3-direct-surface\.html/);
  assert.equal(await page.locator(".t3-utility-rail button:disabled").count(), 4);
  assert.match(await page.locator(".t3-sidebar-footer").innerText(), /Direct thread control plane/);

  const bootstrapPayload = JSON.parse(Buffer.from(new URL(page.url()).hash.slice(1), "base64url").toString("utf8"));
  assert.equal(bootstrapPayload.initialThreadId, "thread_direct_workbench_bound");
  assert.equal(bootstrapPayload.initialThreadSourceHome, "/tmp/direct-workbench-bound-home");
  assert.equal(
    bootstrapPayload.initialThreadSessionFilePath,
    path.join(testRoot, "sessions", "bound-thread.jsonl"),
  );
  assert.equal(bootstrapPayload.initialThreadTitle, "Bound startup thread");
  const persistedConfig = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  assert.equal(persistedConfig.projects[0].lastActiveBindingId, "binding_direct_workbench_startup");
  assert.match(persistedConfig.projects[0].laneBindings[0].lastActivatedAt, /^\d{4}-\d{2}-\d{2}T/);

  await page.waitForFunction(() => document.querySelectorAll("#morphicThreadRailList .morphic-thread-tab").length === 1);
  assert.equal(await page.locator("#morphicThreadRail").isVisible(), true);
  assert.match(await page.locator("#morphicThreadDirectoryStatus").innerText(), /1 thread/);
  const firstProjectThreadId = await page.locator("#morphicThreadRailList .morphic-thread-tab").getAttribute("data-thread-id");
  assert.ok(firstProjectThreadId);
  assert.equal(
    await page.locator("#morphicThreadRailList .morphic-thread-tab").getAttribute("data-runtime-path"),
    "direct-fixture",
  );
  assert.equal(
    await page.locator("#morphicThreadRailList .morphic-thread-tab").getAttribute("data-source-kind"),
    "direct",
  );
  assert.equal(await page.locator("#morphicThreadRailList .morphic-thread-tab.active").count(), 1);
  const initialThreadGeometry = await page.evaluate(() => {
    const label = document.querySelector(".t3-sidebar-section-label")?.getBoundingClientRect();
    const row = document.querySelector("#morphicThreadRailList .morphic-thread-tab")?.getBoundingClientRect();
    return {
      labelBottom: label?.bottom || 0,
      rowTop: row?.top || 0,
    };
  });
  const initialThreadGap = initialThreadGeometry.rowTop - initialThreadGeometry.labelBottom;
  assert.ok(
    initialThreadGap >= 0 && initialThreadGap < 24,
    `Thread directory rows drifted away from their heading: ${JSON.stringify(initialThreadGeometry)}`,
  );
  await page.locator("#t3SidebarNewThread").click();
  await page.waitForFunction(() => document.querySelectorAll("#morphicThreadRailList .morphic-thread-tab").length === 2);
  const secondProjectThreadId = await page.locator("#morphicThreadRailList .morphic-thread-tab.active").getAttribute("data-thread-id");
  assert.ok(secondProjectThreadId);
  assert.notEqual(secondProjectThreadId, firstProjectThreadId);
  const taskRuntimeBindingResult = await page.evaluate(async ({ projectId, threadId }) =>
    window.codexSurfaceBridge.updateRuntimePreferences({
      scope: "thread-model",
      projectId,
      threadId,
      sourceHome: "",
      sessionFilePath: "",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    }), {
    projectId: "project_t3_gui_fixture",
    threadId: secondProjectThreadId,
  });
  assert.equal(taskRuntimeBindingResult.binding.schema, "direct_thread_runtime_binding@1");
  assert.equal(taskRuntimeBindingResult.binding.threadId, secondProjectThreadId);
  assert.equal(taskRuntimeBindingResult.binding.model, "gpt-5.6-sol");
  assert.equal(taskRuntimeBindingResult.binding.reasoningEffort, "xhigh");
  const taskRuntimePreferenceRead = await page.evaluate(async ({ projectId, threadId }) =>
    window.codexSurfaceBridge.getRuntimePreferences({
      projectId,
      threadId,
      sourceHome: "",
      sessionFilePath: "",
    }), {
    projectId: "project_t3_gui_fixture",
    threadId: secondProjectThreadId,
  });
  assert.equal(taskRuntimePreferenceRead.threadMatch, "direct-session");
  assert.equal(taskRuntimePreferenceRead.threadDefaults.model, "gpt-5.6-sol");
  assert.equal(taskRuntimePreferenceRead.threadDefaults.reasoningEffort, "xhigh");
  await page.locator(`#morphicThreadRailList .morphic-thread-tab[data-thread-id="${firstProjectThreadId}"]`).click();
  await page.waitForFunction(
    (threadId) => document.querySelector("#morphicThreadRailList .morphic-thread-tab.active")?.dataset?.threadId === threadId,
    firstProjectThreadId,
  );
  await page.screenshot({ path: threadDirectoryScreenshotPath, fullPage: true });

  const worldManagerAuthorityExposed = await page.evaluate(
    () => typeof window.codexSurfaceBridge.getWorldManagerSnapshot === "function",
  );
  assert.equal(worldManagerAuthorityExposed, false);

  await page.locator('.t3-utility-rail [data-t3-action="usage"]').click();
  await page.locator("#directUsagePage:not([hidden])").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#directUsageStatus")?.dataset?.state === "ready");
  const usageText = await page.locator("#directUsagePage").innerText();
  assert.match(usageText, /Estimated spend/);
  assert.match(usageText, /gpt-5\.6-sol/);
  assert.match(usageText, /not billing-grade/);
  assert.match(usageText, /missing usage as unknown, not zero/);
  assert.match(usageText, /Historical projects/);
  assert.equal(await page.locator('[data-t3-action="usage"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-usage-window="7"]').click();
  await page.waitForFunction(() => document.querySelector('[data-usage-window="7"]')?.getAttribute("aria-pressed") === "true");
  await page.waitForFunction(() => document.querySelector("#directUsageStatus")?.dataset?.state === "ready");
  await page.screenshot({ path: usageScreenshotPath, fullPage: true });
  await page.locator("#directUsageClose").click();
  assert.equal(await page.locator("#directUsagePage").isHidden(), true);

  await page.locator('.t3-utility-rail [data-runtime-tab="runtime"]').click();
  await page.locator("#runtimeDrawer:not([hidden])").waitFor({ state: "visible" });
  assert.equal(
    await page.locator('.t3-utility-rail [data-runtime-tab="runtime"]').getAttribute("aria-pressed"),
    "true",
  );
  const embeddedBackendSelect = page.getByLabel("Backend");
  await embeddedBackendSelect.waitFor({ state: "visible" });
  assert.equal(await embeddedBackendSelect.inputValue(), "direct");
  assert.deepEqual(
    await embeddedBackendSelect.locator("option").evaluateAll((options) => options.map((option) => option.textContent)),
    ["Direct", "Appserver"],
  );
  assert.equal(await page.getByRole("button", { name: "Apply backend" }).isDisabled(), true);

  await page.getByRole("button", { name: "Policy", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#runtimeDrawerTitle")?.textContent === "Policy"
  );
  await page.waitForFunction(() =>
    /Active Sub-Agent Policy Editor/.test(
      document.querySelector("#runtimeDrawerBody")?.textContent || "",
    )
  );
  const policyBody = await page.locator("#runtimeDrawerBody").innerText();
  assert.match(policyBody, /Active Sub-Agent Policy/);
  assert.match(policyBody, /Worker Role Bindings/);
  assert.match(policyBody, /operator semantic admission/);
  assert.match(policyBody, /silent launch override/i);
  assert.equal(
    await page.getByRole("button", { name: "Settle active policy" }).isDisabled(),
    true,
    "an empty semantic policy statement must not be submitted",
  );
  const policyStatement = page.getByLabel("Standing policy");
  await policyStatement.fill("Use Sol high workers for implementation.");
  assert.equal(
    await page.getByRole("button", { name: "Settle active policy" }).isEnabled(),
    true,
  );
  await policyStatement.fill("");

  await page.locator('.t3-utility-rail [data-runtime-tab="epistemic"]').click();
  await page.waitForFunction(() => document.querySelector("#runtimeDrawerTitle")?.textContent === "Epistemic");
  await page.waitForFunction(() => /Information plane|not loaded|failed/.test(document.querySelector("#runtimeDrawerBody")?.textContent || ""));
  const epistemicBody = page.locator("#runtimeDrawerBody");
  assert.match(await epistemicBody.innerText(), /Information plane/);
  assert.match(await epistemicBody.innerText(), /top_down_only/);
  assert.match(await epistemicBody.innerText(), /Materializing it does not add context to a Direct turn, and no provider receives it\./);
  assert.equal(await page.getByRole("button", { name: "Import selected context" }).count(), 0);
  const localPreviewButton = page.locator('[data-epistemic-action^="context-preview:thread:"]').first();
  await localPreviewButton.waitFor({ state: "visible" });
  assert.equal(await localPreviewButton.innerText(), "Materialize local preview");
  const duplicateActionDisabled = await page.evaluate(() => {
    const button = document.querySelector('[data-epistemic-action^="context-preview:thread:"]');
    button?.click();
    return document.querySelector('[data-epistemic-action^="context-preview:thread:"]')?.disabled === true;
  });
  assert.equal(duplicateActionDisabled, true);
  await page.waitForFunction(() => /Latest materialized context preview/.test(document.querySelector("#runtimeDrawerBody")?.textContent || ""));
  assert.match(await epistemicBody.innerText(), /subject\s+thread\s+·/i);
  assert.match(await epistemicBody.innerText(), /port\s+thread\./i);
  assert.match(await epistemicBody.innerText(), /provider transport\s+none/i);
  assert.match(await epistemicBody.innerText(), /Direct turn admission\s+none/i);
  assert.equal(await localPreviewButton.isDisabled(), false);
  assert.match(await epistemicBody.innerText(), /Next-turn context handoff/);
  assert.match(await epistemicBody.innerText(), /quoted evidence only · no capability grant/);
  const contextDeliveryButton = page.locator('[data-epistemic-action^="context-delivery:"]').first();
  await contextDeliveryButton.waitFor({ state: "visible" });
  assert.equal(
    await contextDeliveryButton.innerText(),
    "Admit this preview for next Direct turn",
  );
  await contextDeliveryButton.click();
  await page.waitForFunction(() =>
    /status\s+admitted/i.test(
      document.querySelector("#runtimeDrawerBody")?.innerText || "",
    ));
  assert.equal(await contextDeliveryButton.isDisabled(), true);
  assert.match(await epistemicBody.innerText(), /transport witness\s+not yet witnessed/i);
  assert.match(await epistemicBody.innerText(), /provider transport\s+none/i);
  assert.equal(
    await page.locator('.t3-utility-rail [data-runtime-tab="epistemic"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: epistemicScreenshotPath, fullPage: true });

  await page.locator('.t3-utility-rail [data-t3-action="analytics"]').click();
  await page.locator("#threadAnalyticsPanel:not([hidden])").waitFor({ state: "visible" });
  assert.equal(await page.locator("#runtimeDrawer").isHidden(), true);
  assert.equal(
    await page.locator('.t3-utility-rail [data-t3-action="analytics"]').getAttribute("aria-pressed"),
    "true",
  );

  await page.locator('.t3-utility-rail [data-t3-action="intake"]').click();
  await page.locator("#directThreadIntakePanel:not([hidden])").waitFor({ state: "visible" });
  assert.equal(await page.locator("#threadAnalyticsPanel").isHidden(), true);
  assert.equal(
    await page.locator('.t3-utility-rail [data-t3-action="intake"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match(await page.locator("#directThreadIntakeBinding").innerText(), /Direct thread control plane/);
  assert.match(await page.locator("#directThreadIntakeBinding").innerText(), /env_wsl_native/);
  assert.equal(await page.locator(".direct-intake-mode-card").count(), 2);
  assert.match(await page.locator("#directThreadIntakeModes").innerText(), /Resume original thread/);
  assert.match(await page.locator("#directThreadIntakeModes").innerText(), /Continue as a new Direct thread/);
  assert.match(await page.locator("#directThreadIntakeEvidence").innerText(), /Raw paths, raw records/);
  await page.screenshot({ path: intakeScreenshotPath, fullPage: true });
  await page.locator("#directThreadIntakeClose").click();
  assert.equal(await page.locator("#directThreadIntakePanel").isHidden(), true);

  await page.locator('.t3-utility-rail [data-t3-action="projects"]').click();
  await page.locator("#directProjectDirectory:not([hidden])").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".direct-project-row").length === 2);
  assert.equal(await page.locator('.direct-project-row[data-project-id="project_t3_gui_fixture"]').getAttribute("data-state"), "active");
  assert.match(
    await page.locator('.direct-project-row[data-project-id="project_t3_gui_fixture"]').innerText(),
    /WSL native workspace/,
  );
  assert.match(
    await page.locator('.direct-project-row[data-project-id="project_t3_windows_fixture"]').innerText(),
    /Windows native workspace/,
  );
  const safeDirectory = await page.evaluate(() => window.codexSurfaceBridge.readDirectWorkbenchProjectDirectory());
  assert.equal(safeDirectory.schema, "direct_workbench_project_directory@1");
  assert.equal(safeDirectory.authorityBoundary.rendererMayMutateConfig, false);
  assert.equal(JSON.stringify(safeDirectory).includes("/home/rose/work/direct-gui-fixture"), false);
  assert.equal(JSON.stringify(safeDirectory).includes("C:\\Fixtures\\direct-gui"), false);

  await page.locator('[data-project-lifecycle-target="project_t3_gui_fixture"]').click();
  await page.locator("#directProjectLifecyclePanel:not([hidden])").waitFor({ state: "visible" });
  assert.equal(await page.locator("#directProjectLifecycleArchive").isDisabled(), true);
  assert.match(await page.locator("#directProjectLifecycleStatus").innerText(), /Switch away/);
  await page.locator("#directProjectLifecycleClose").click();
  await page.locator("#directProjectLifecyclePanel").waitFor({ state: "hidden" });

  await page.locator("#directProjectBindingNew").click();
  await page.locator("#directProjectBindingEditor:not([hidden])").waitFor({ state: "visible" });
  assert.equal(await page.locator("#runtimeDrawer").isHidden(), true);
  assert.equal(await page.locator("#threadAnalyticsPanel").isHidden(), true);
  assert.equal(await page.locator("#directThreadIntakePanel").isHidden(), true);
  assert.match(await page.locator("#directProjectBindingEditorTitle").innerText(), /New project binding/);
  assert.match(await page.locator("#directProjectBindingEvidence").innerText(), /Main assigns project identity/);
  await page.locator("#directProjectBindingName").fill("Local Direct GUI Fixture");
  await page.locator("#directProjectBindingWorkspaceKind").selectOption("local");
  await page.locator("#directProjectBindingWorkspaceLabel").fill("Local fixture workspace");
  await page.locator("#directProjectBindingLocalPath").fill(localProjectRoot);
  await page.locator("#directProjectBindingRuntimePath").selectOption("app-server");
  await page.screenshot({ path: projectBindingEditorScreenshotPath, fullPage: true });
  await page.locator("#directProjectBindingCommit").click();
  await page.locator("#directProjectBindingEditor").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelectorAll(".direct-project-row").length === 3);
  assert.match(await page.locator("#directProjectDirectoryList").innerText(), /Local Direct GUI Fixture/);
  const configAfterCreate = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  const createdProject = configAfterCreate.projects.find((project) => project.name === "Local Direct GUI Fixture");
  assert.ok(createdProject?.id?.startsWith("project_"));
  assert.notEqual(createdProject.id, "");
  assert.equal(configAfterCreate.selectedProjectId, "project_t3_gui_fixture");

  await page.locator(`[data-project-lifecycle-target="${createdProject.id}"]`).click();
  await page.locator("#directProjectLifecyclePanel:not([hidden])").waitFor({ state: "visible" });
  assert.match(await page.locator("#directProjectLifecycleTitle").innerText(), /Local Direct GUI Fixture lifecycle/);
  assert.equal(await page.locator("#directProjectLifecycleArchive").isEnabled(), true);
  assert.equal(await page.locator("#directProjectLifecycleRestore").isDisabled(), true);
  assert.equal(await page.locator("#directProjectLifecycleDelete").isDisabled(), true);
  await page.screenshot({ path: projectLifecycleScreenshotPath, fullPage: true });
  const configPath = path.join(userDataRoot, "workspace-config.json");
  const configFailureBackupPath = path.join(userDataRoot, "workspace-config.failure-backup.json");
  fs.renameSync(configPath, configFailureBackupPath);
  fs.mkdirSync(configPath);
  try {
    await page.locator("#directProjectLifecycleArchive").click();
    await page.waitForFunction(() => document.querySelector("#directProjectLifecycleStatus")?.dataset?.state === "failed");
    const directoryAfterFailedArchive = await page.evaluate(
      () => window.codexSurfaceBridge.readDirectWorkbenchProjectDirectory(),
    );
    assert.equal(
      directoryAfterFailedArchive.projects.find((project) => project.displayName === "Local Direct GUI Fixture")?.lifecycle?.state,
      "active",
    );
    const persistedAfterFailedArchive = JSON.parse(fs.readFileSync(configFailureBackupPath, "utf8"));
    assert.equal(
      persistedAfterFailedArchive.projects.find((project) => project.id === createdProject.id)?.lifecycle?.state,
      "active",
    );
  } finally {
    fs.rmdirSync(configPath);
    fs.renameSync(configFailureBackupPath, configPath);
  }
  await page.locator("#directProjectLifecycleArchive").click();
  await page.locator("#directProjectLifecyclePanel").waitFor({ state: "hidden" });
  await page.waitForFunction(
    (projectId) => !document.querySelector(`.direct-project-row[data-project-id="${projectId}"]`),
    createdProject.id,
  );
  assert.match(await page.locator("#directProjectArchivedToggle").innerText(), /Archived 1/);

  await page.locator("#directProjectArchivedToggle").click();
  await page.waitForFunction(
    (projectId) => document.querySelector(`.direct-project-row[data-project-id="${projectId}"]`)?.dataset?.state === "archived",
    createdProject.id,
  );
  await page.locator(`[data-project-lifecycle-target="${createdProject.id}"]`).click();
  await page.locator("#directProjectLifecyclePanel:not([hidden])").waitFor({ state: "visible" });
  assert.equal(await page.locator("#directProjectLifecycleRestore").isEnabled(), true);
  assert.equal(await page.locator("#directProjectLifecycleDelete").isDisabled(), true);
  await page.locator("#directProjectLifecycleRestore").click();
  await page.locator("#directProjectLifecyclePanel").waitFor({ state: "hidden" });
  await page.waitForFunction(
    (projectId) => document.querySelector(`.direct-project-row[data-project-id="${projectId}"]`)?.dataset?.state === "available",
    createdProject.id,
  );
  const restoredConfig = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  assert.equal(restoredConfig.projects.find((project) => project.id === createdProject.id)?.id, createdProject.id);
  assert.equal(restoredConfig.projects.find((project) => project.id === createdProject.id)?.lifecycle?.state, "active");

  await page.locator(`[data-project-lifecycle-target="${createdProject.id}"]`).click();
  await page.locator("#directProjectLifecyclePanel:not([hidden])").waitFor({ state: "visible" });
  await page.locator("#directProjectLifecycleArchive").click();
  await page.locator("#directProjectLifecyclePanel").waitFor({ state: "hidden" });
  await page.waitForFunction(
    (projectId) => document.querySelector(`.direct-project-row[data-project-id="${projectId}"]`)?.dataset?.state === "archived",
    createdProject.id,
  );
  await page.locator(`[data-project-lifecycle-target="${createdProject.id}"]`).click();
  await page.locator("#directProjectLifecyclePanel:not([hidden])").waitFor({ state: "visible" });
  const requiredDeletePhrase = await page.locator("#directProjectLifecycleConfirmationLabel").innerText();
  await page.locator("#directProjectLifecycleConfirmation").fill("DELETE something else");
  assert.equal(await page.locator("#directProjectLifecycleDelete").isDisabled(), true);
  await page.locator("#directProjectLifecycleConfirmation").fill(requiredDeletePhrase);
  assert.equal(await page.locator("#directProjectLifecycleDelete").isEnabled(), true);
  await page.locator("#directProjectLifecycleDelete").click();
  await page.locator("#directProjectLifecyclePanel").waitFor({ state: "hidden" });
  await page.waitForFunction(
    (projectId) => !document.querySelector(`.direct-project-row[data-project-id="${projectId}"]`),
    createdProject.id,
  );
  const configAfterDelete = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  assert.equal(configAfterDelete.projects.some((project) => project.id === createdProject.id), false);
  assert.equal(configAfterDelete.projects.length, 2);
  assert.equal(fs.readFileSync(localProjectSentinel, "utf8"), "project binding lifecycle must not delete workspace files\n");

  await page.locator('[data-project-binding-target="project_t3_windows_fixture"]').click();
  await page.locator("#directProjectBindingEditor:not([hidden])").waitFor({ state: "visible" });
  assert.match(await page.locator("#directProjectBindingEditorTitle").innerText(), /Edit project binding/);
  assert.equal(await page.locator("#directProjectBindingWorkspaceKind").inputValue(), "windows");
  assert.equal(await page.locator("#directProjectBindingWindowsPath").inputValue(), "C:\\Fixtures\\direct-gui");
  await page.locator("#directProjectBindingName").fill("Windows Direct GUI Fixture Edited");
  await page.locator("#directProjectBindingWorkspaceLabel").fill("Windows edited workspace");
  await page.locator("#directProjectBindingCommit").click();
  await page.locator("#directProjectBindingEditor").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector('[data-project-id="project_t3_windows_fixture"]')?.textContent?.includes("Edited"));
  assert.match(
    await page.locator('.direct-project-row[data-project-id="project_t3_windows_fixture"]').innerText(),
    /Windows edited workspace/,
  );

  const sourcePageUrl = page.url();
  await page.locator('[data-project-activation-target="project_t3_windows_fixture"]').click();
  await page.waitForFunction((url) => window.location.href !== url, sourcePageUrl, { timeout: 30_000 });
  await page.waitForSelector('body[data-direct-gui="direct-workbench"][data-experience-state="verified"]', { timeout: 30_000 });
  await page.waitForFunction(() => document.getElementById("projectName")?.textContent?.includes("Windows Direct GUI Fixture Edited"));
  assert.match(page.url(), /\/t3-direct-surface\.html/);
  const switchedBootstrapPayload = JSON.parse(Buffer.from(new URL(page.url()).hash.slice(1), "base64url").toString("utf8"));
  assert.equal(switchedBootstrapPayload.project.id, "project_t3_windows_fixture");
  assert.equal(switchedBootstrapPayload.initialThreadId, "thread_direct_workbench_windows");
  assert.equal(switchedBootstrapPayload.initialThreadTitle, "Windows bound thread");
  await page.waitForFunction(() => document.querySelectorAll("#morphicThreadRailList .morphic-thread-tab").length === 1);
  const windowsThreadId = await page.locator("#morphicThreadRailList .morphic-thread-tab").getAttribute("data-thread-id");
  assert.ok(windowsThreadId);
  assert.notEqual(windowsThreadId, firstProjectThreadId);
  assert.notEqual(windowsThreadId, secondProjectThreadId);
  assert.equal(await page.locator(`#morphicThreadRailList .morphic-thread-tab[data-thread-id="${firstProjectThreadId}"]`).count(), 0);

  await page.locator('.t3-utility-rail [data-t3-action="projects"]').click();
  await page.locator("#directProjectDirectory:not([hidden])").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".direct-project-row").length === 2);
  assert.equal(await page.locator('.direct-project-row[data-project-id="project_t3_windows_fixture"]').getAttribute("data-state"), "active");
  assert.match(await page.locator("#directProjectDirectoryStatus").innerText(), /authoritative active selection/);
  await page.screenshot({ path: projectDirectoryScreenshotPath, fullPage: true });

  await page.locator('[data-project-binding-target="project_t3_windows_fixture"]').click();
  await page.locator("#directProjectBindingEditor:not([hidden])").waitFor({ state: "visible" });
  assert.match(await page.locator("#directProjectBindingEvidence").innerText(), /active project/);
  await page.locator("#directProjectBindingName").fill("Windows Direct GUI Fixture Active");
  const preEditPageUrl = page.url();
  await page.locator("#directProjectBindingCommit").click();
  await page.waitForFunction((url) => window.location.href !== url, preEditPageUrl, { timeout: 30_000 });
  await page.waitForSelector('body[data-direct-gui="direct-workbench"][data-experience-state="verified"]', { timeout: 30_000 });
  const activeEditBootstrapPayload = JSON.parse(Buffer.from(new URL(page.url()).hash.slice(1), "base64url").toString("utf8"));
  assert.equal(activeEditBootstrapPayload.project.name, "Windows Direct GUI Fixture Active");
  await page.waitForFunction(() => document.querySelectorAll("#morphicThreadRailList .morphic-thread-tab").length === 1);

  const switchedConfig = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  assert.equal(switchedConfig.selectedProjectId, "project_t3_windows_fixture");
  assert.equal(switchedConfig.projects.find((project) => project.id === "project_t3_windows_fixture")?.name, "Windows Direct GUI Fixture Active");
  assert.match(switchedConfig.projects[1].laneBindings[0].lastActivatedAt, /^\d{4}-\d{2}-\d{2}T/);

  await page.locator("#t3SidebarToggle").click();
  assert.equal(await page.locator("#codexShell").getAttribute("data-t3-sidebar"), "collapsed");
  await page.locator('.t3-utility-rail [data-t3-action="threads"]').click();
  assert.equal(await page.locator("#codexShell").getAttribute("data-t3-sidebar"), "expanded");

  const originalViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForFunction(() => window.innerWidth <= 720);
  assert.equal(await page.locator("#morphicThreadRail").isVisible(), true);
  assert.equal(
    await page.locator("#morphicThreadRailList").evaluate((element) => getComputedStyle(element).flexDirection),
    "row",
  );
  assert.equal(await page.locator("#morphicThreadRailList .morphic-thread-tab").count(), 1);
  const narrowHeaderGeometry = await page.evaluate(() => {
    const header = document.querySelector("#morphicCockpitBar")?.getBoundingClientRect();
    const actions = document.querySelector("#morphicCockpitBar .compact-thread-actions")?.getBoundingClientRect();
    return { headerBottom: header?.bottom || 0, actionsBottom: actions?.bottom || 0 };
  });
  assert.ok(
    narrowHeaderGeometry.actionsBottom <= narrowHeaderGeometry.headerBottom + 1,
    `Narrow header actions escaped into the thread directory: ${JSON.stringify(narrowHeaderGeometry)}`,
  );
  await page.screenshot({ path: narrowThreadDirectoryScreenshotPath, fullPage: true });
  await page.setViewportSize(originalViewport);
  await page.waitForFunction(() => window.innerWidth > 720);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(rendererErrors, [], rendererErrors.join("\n"));

  console.log(JSON.stringify({
    schema: "direct_workbench_electron_smoke@1",
    status: "passed",
    document: "t3-direct-surface.html",
    backendOwner: "direct",
    controlPlane: "direct-thread",
    worldManagerAuthorityExposed: false,
    projectSwitchObserved: true,
    runtimeNeutralThreadDirectoryObserved: true,
    screenshotPath,
    threadDirectoryScreenshotPath,
    narrowThreadDirectoryScreenshotPath,
    epistemicScreenshotPath,
    usageScreenshotPath,
    intakeScreenshotPath,
    projectDirectoryScreenshotPath,
    projectBindingEditorScreenshotPath,
    projectLifecycleScreenshotPath,
  }, null, 2));
} finally {
  await app.close().catch(() => {});
}
