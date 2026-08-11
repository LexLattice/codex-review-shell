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

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-t3-gui-electron-"));
const userDataRoot = path.join(testRoot, "profile");
const screenshotPath = process.env.CODEX_T3_GUI_SCREENSHOT || path.join(testRoot, "t3-direct-gui.png");
const intakeScreenshotPath = screenshotPath.replace(/\.png$/i, "-thread-intake.png");
const projectDirectoryScreenshotPath = screenshotPath.replace(/\.png$/i, "-project-directory.png");
fs.mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });

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

  const worldManagerAuthorityExposed = await page.evaluate(
    () => typeof window.codexSurfaceBridge.getWorldManagerSnapshot === "function",
  );
  assert.equal(worldManagerAuthorityExposed, false);

  await page.locator('.t3-utility-rail [data-runtime-tab="runtime"]').click();
  await page.locator("#runtimeDrawer:not([hidden])").waitFor({ state: "visible" });
  assert.equal(
    await page.locator('.t3-utility-rail [data-runtime-tab="runtime"]').getAttribute("aria-pressed"),
    "true",
  );

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

  const sourcePageUrl = page.url();
  await page.locator('.direct-project-row[data-project-id="project_t3_windows_fixture"] button').click();
  await page.waitForFunction((url) => window.location.href !== url, sourcePageUrl, { timeout: 30_000 });
  await page.waitForSelector('body[data-direct-gui="direct-workbench"][data-experience-state="verified"]', { timeout: 30_000 });
  await page.waitForFunction(() => document.getElementById("projectName")?.textContent?.includes("Windows Direct GUI Fixture"));
  assert.match(page.url(), /\/t3-direct-surface\.html/);
  const switchedBootstrapPayload = JSON.parse(Buffer.from(new URL(page.url()).hash.slice(1), "base64url").toString("utf8"));
  assert.equal(switchedBootstrapPayload.project.id, "project_t3_windows_fixture");
  assert.equal(switchedBootstrapPayload.initialThreadId, "thread_direct_workbench_windows");
  assert.equal(switchedBootstrapPayload.initialThreadTitle, "Windows bound thread");

  await page.locator('.t3-utility-rail [data-t3-action="projects"]').click();
  await page.locator("#directProjectDirectory:not([hidden])").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".direct-project-row").length === 2);
  assert.equal(await page.locator('.direct-project-row[data-project-id="project_t3_windows_fixture"]').getAttribute("data-state"), "active");
  assert.match(await page.locator("#directProjectDirectoryStatus").innerText(), /authoritative active selection/);
  await page.screenshot({ path: projectDirectoryScreenshotPath, fullPage: true });
  await page.locator("#directProjectDirectoryClose").click();

  const switchedConfig = JSON.parse(fs.readFileSync(path.join(userDataRoot, "workspace-config.json"), "utf8"));
  assert.equal(switchedConfig.selectedProjectId, "project_t3_windows_fixture");
  assert.match(switchedConfig.projects[1].laneBindings[0].lastActivatedAt, /^\d{4}-\d{2}-\d{2}T/);

  await page.locator("#t3SidebarToggle").click();
  assert.equal(await page.locator("#codexShell").getAttribute("data-t3-sidebar"), "collapsed");
  await page.locator('.t3-utility-rail [data-t3-action="threads"]').click();
  assert.equal(await page.locator("#codexShell").getAttribute("data-t3-sidebar"), "expanded");

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
    screenshotPath,
    intakeScreenshotPath,
    projectDirectoryScreenshotPath,
  }, null, 2));
} finally {
  await app.close().catch(() => {});
}
