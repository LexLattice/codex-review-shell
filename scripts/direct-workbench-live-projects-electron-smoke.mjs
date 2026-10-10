#!/usr/bin/env node

// Live check of two projects open at once in the real Direct Workbench (an
// isolated profile, the real provider at gpt-6-luna): a slow turn starts in
// the WSL project, the owner switches to the other project (Windows on a
// Windows host, a local folder on Linux) while it runs, a turn runs there,
// the first turn finishes in the background, and switching back shows its
// reply without a reload. Writes screenshots and prints a JSON report.
//
//   node scripts/direct-workbench-live-projects-electron-smoke.mjs
//
// Uses the Codex CLI login (~/.codex/auth.json) and a few small turns.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");
const isWindows = process.platform === "win32";

// Always off-screen on Linux: under WSLg DISPLAY is set and the window
// would open on the owner's desktop.
if (process.platform === "linux" && process.env.DIRECT_LIVE_PROJECTS_UNDER_XVFB !== "1") {
  const childEnv = { ...process.env, DIRECT_LIVE_PROJECTS_UNDER_XVFB: "1" };
  delete childEnv.DISPLAY;
  delete childEnv.WAYLAND_DISPLAY;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("xvfb-run", ["-a", process.execPath, scriptPath], {
      cwd: repoRoot,
      env: childEnv,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exit(exitCode);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const testRoot = fs.mkdtempSync(path.join(isWindows ? os.tmpdir() : "/tmp", "direct-live-projects-"));
const profile = path.join(testRoot, "profile");
fs.mkdirSync(profile, { recursive: true });
const distro = isWindows ? "Ubuntu" : (process.env.WSL_DISTRO_NAME || "Ubuntu");
// The WSL project lives in WSL's /tmp; on a Windows host it is made there
// through wsl.exe.
const wslFolder = `/tmp/direct-live-projects-wsl-${process.pid}`;
if (isWindows) {
  const made = spawn("wsl.exe", ["-d", distro, "--", "mkdir", "-p", wslFolder], { stdio: "ignore" });
  await new Promise((resolve) => made.once("exit", resolve));
} else {
  fs.mkdirSync(wslFolder, { recursive: true });
}
const otherFolder = path.join(testRoot, isWindows ? "windows-project" : "local-project");
fs.mkdirSync(otherFolder, { recursive: true });

const binding = {
  // The binding test-control projects use (the old direct-experimental
  // mode needs an activation record first).
  mode: "managed",
  bindingProvider: "direct-chatgpt-codex",
  runtimeMode: "direct",
  directTransport: "live-text",
  directTier: "implementation-lane",
  model: "gpt-6-luna",
  reasoningEffort: "low",
  label: "Direct",
};
const project = (id, name, workspace) => ({
  id,
  name,
  repoPath: workspace.kind === "wsl" ? `wsl:${distro}:${workspace.linuxPath}` : workspace.windowsPath || workspace.localPath,
  workspace,
  surfaceBinding: { codex: { ...binding }, chatgpt: { reviewThreadUrl: "", reduceChrome: true } },
  chatThreads: [],
  laneBindings: [],
  promptTemplates: {},
  flowProfile: {},
});
const wslProject = project("project_live_wsl", "Live WSL project", { kind: "wsl", distro, linuxPath: wslFolder, label: "WSL" });
const otherProject = isWindows
  ? project("project_live_windows", "Live Windows project", { kind: "windows", windowsPath: otherFolder, label: "Windows" })
  : project("project_live_local", "Live local project", { kind: "local", localPath: otherFolder, label: "Local" });
fs.writeFileSync(path.join(profile, "workspace-config.json"), `${JSON.stringify({
  version: 5,
  selectedProjectId: wslProject.id,
  projects: [wslProject, otherProject],
}, null, 2)}\n`);

const env = { ...process.env };
for (const key of ["CODEX_WORLD_MANAGER", "CODEX_WORLD_MANAGER_MOCKUP", "CODEX_DIRECT_T3_GUI", "DIRECT_TEST_CONTROL_SHOW"]) delete env[key];
Object.assign(env, {
  CODEX_EXPERIENCE: "direct-workbench",
  CODEX_REVIEW_SHELL_USER_DATA_DIR: profile,
  CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
  LIBGL_ALWAYS_SOFTWARE: "1",
  // Keeps the window off the owner's desktop on Windows (it needs an
  // isolated profile, which this is).
  ...(isWindows ? { DIRECT_TEST_CONTROL: "1" } : {}),
});

const report = { host: process.platform, checks: [], screenshots: [] };
const app = await electron.launch({ args: [repoRoot, "--disable-gpu"], cwd: repoRoot, env });
const errors = [];
const watch = (page) => page.on("pageerror", (error) => errors.push(error.message));

async function verified(page) {
  watch(page);
  await page.waitForSelector('body[data-direct-gui="direct-workbench"][data-experience-state="verified"]', { timeout: 60_000 });
  await page.waitForFunction(() => !document.getElementById("composerInput")?.disabled, null, { timeout: 60_000 });
}

async function overview(page) {
  return page.evaluate(() => window.codexSurfaceBridge.readDirectWorkbenchThreadOverview());
}

async function rowFor(page, projectId) {
  return (await overview(page)).projects.find((row) => row.projectId === projectId);
}

async function waitFor(label, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function send(page, text) {
  await page.locator("#morphicNewThreadButton").click();
  await sleep(800);
  await page.locator("#composerInput").fill(text);
  await page.locator("#sendButton").click();
}

async function shot(page, name) {
  const file = path.join(testRoot, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

try {
  const pageWsl = await app.firstWindow();
  await verified(pageWsl);
  const slowCommand = "sleep 20; echo done-in-wsl";
  await send(pageWsl, `Run this shell command once with exec_command and wait for it: \`${slowCommand}\`. Then reply with only its output.`);
  await waitFor("the WSL turn to run", async () => (await rowFor(pageWsl, wslProject.id))?.runningCount > 0, 60_000);
  report.checks.push("wsl_turn_running");

  // Switch while it runs: the other project's own surface opens; the WSL
  // one stays alive behind it.
  const opened = app.waitForEvent("window", { timeout: 60_000 });
  await pageWsl.locator(`#workbenchOtherProjects .workbench-project-group[data-project-id="${otherProject.id}"] .workbench-project-header`).click();
  const pageOther = await opened;
  await verified(pageOther);
  assert.equal(pageWsl.isClosed(), false, "the WSL surface stays open");
  const wslWhileAway = await rowFor(pageOther, wslProject.id);
  assert.equal(wslWhileAway.runningCount, 1, "the WSL turn keeps running in the background");
  await pageOther.waitForSelector(`#workbenchOtherProjects .workbench-project-group[data-project-id="${wslProject.id}"] .workbench-state-badge.running`, { timeout: 10_000 });
  await shot(pageOther, "other-project-in-front-wsl-running");
  report.checks.push("switched_while_running");

  await send(pageOther, "Reply with only the word pong.");
  // The prompt has the word once; the reply adds it.
  await waitFor("the reply in the other project", () => pageOther.evaluate(() => (document.body.innerText.match(/\bpong\b/gi) || []).length >= 2), 120_000);
  report.checks.push("other_project_turn");

  await waitFor("the WSL turn to finish in the background", async () => (await rowFor(pageOther, wslProject.id))?.runningCount === 0, 180_000);
  report.checks.push("background_turn_finished");

  // Back to WSL: no new surface, and its reply is already there.
  let reopened = false;
  app.once("window", () => { reopened = true; });
  await pageOther.locator(`#workbenchOtherProjects .workbench-project-group[data-project-id="${wslProject.id}"] .workbench-project-header`).click();
  await waitFor("the WSL surface in front", async () => (await overview(pageWsl)).selectedProjectId === wslProject.id, 30_000);
  await sleep(1000);
  assert.equal(reopened, false, "switching back reuses the live surface");
  assert.equal(await pageWsl.evaluate(() => document.body.innerText.includes("done-in-wsl")), true, "the background turn's reply is in its transcript");
  await shot(pageWsl, "wsl-project-back-in-front");
  report.checks.push("switched_back_without_reload");

  // A question to the owner while the project is in the background: the
  // sidebar says it needs you; answering it back in front finishes the turn.
  const otherHeader = (page) => page.locator(`#workbenchOtherProjects .workbench-project-group[data-project-id="${otherProject.id}"] .workbench-project-header`);
  const wslHeader = (page) => page.locator(`#workbenchOtherProjects .workbench-project-group[data-project-id="${wslProject.id}"] .workbench-project-header`);
  await send(pageWsl, "Use request_user_input to ask me whether to proceed (yes or no). Then reply with only my answer, in upper case.");
  await waitFor("the question to reach the owner", async () => (await rowFor(pageWsl, wslProject.id))?.needsYouCount > 0, 120_000);
  await pageWsl.waitForSelector("#morphicThreadRailList .morphic-thread-tab.needs-you", { timeout: 10_000 });
  await otherHeader(pageWsl).click();
  await waitFor("the other project in front", async () => (await overview(pageOther)).selectedProjectId === otherProject.id, 30_000);
  await pageOther.waitForSelector(`#workbenchOtherProjects .workbench-project-group[data-project-id="${wslProject.id}"] .workbench-state-badge.needs-you`, { timeout: 10_000 });
  await shot(pageOther, "wsl-question-waiting-in-background");
  report.checks.push("needs_you_badge_in_background");
  await wslHeader(pageOther).click();
  await waitFor("the WSL surface in front again", async () => (await overview(pageWsl)).selectedProjectId === wslProject.id, 30_000);
  const field = pageWsl.locator(".codex-request-form [data-question-id]").last();
  await field.waitFor({ timeout: 10_000 });
  if (await field.evaluate((node) => node.tagName) === "SELECT") {
    await field.selectOption(await field.evaluate((node) => [...node.options].find((option) => /yes/i.test(option.textContent))?.value || node.options[0].value));
  } else {
    await field.fill("yes");
  }
  await pageWsl.getByRole("button", { name: "Submit answers" }).last().click();
  await waitFor("the answered turn's reply", () => pageWsl.evaluate(() => /\bYES\b/.test(document.body.innerText)), 120_000);
  await waitFor("the badge to clear", async () => (await rowFor(pageWsl, wslProject.id))?.needsYouCount === 0, 30_000);
  report.checks.push("answered_after_switching_back");

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} catch (error) {
  const pages = [];
  for (const [index, page] of app.windows().entries()) {
    if (page.isClosed()) continue;
    const file = path.join(testRoot, `failure-${index}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    pages.push({
      file,
      text: (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(-1500),
      overview: await overview(page).catch((readError) => readError.message),
    });
  }
  console.error(JSON.stringify({ ok: false, error: error.message, errors, ...report, pages }, null, 2));
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  if (isWindows) {
    const removed = spawn("wsl.exe", ["-d", distro, "--", "rm", "-rf", wslFolder], { stdio: "ignore" });
    await new Promise((resolve) => removed.once("exit", resolve));
  } else {
    fs.rmSync(wslFolder, { recursive: true, force: true });
  }
  console.error(`artifacts: ${testRoot}`);
}
