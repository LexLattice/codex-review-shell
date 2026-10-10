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
  await page.locator("#wbNewThread").click();
  await sleep(800);
  await page.locator("#composerInput").fill(text);
  await page.locator("#sendButton").click();
}

async function shot(page, name) {
  const file = path.join(testRoot, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

const group = (projectId) => `.wb-project[data-project-id="${projectId}"]`;
const threadRowSelector = (projectId, threadId) => `${group(projectId)} .wb-thread[data-thread-id="${threadId}"]`;
const transcriptText = (page) => page.evaluate(() => document.getElementById("transcript")?.innerText || document.body.innerText);
const threadIn = async (page, projectId, predicate) => ((await rowFor(page, projectId))?.threads || []).find(predicate);
// Brings a project forward from a sidebar: one of its threads, or "Start one".
async function goToProject(page, projectId, threadId = "") {
  const row = threadId
    ? page.locator(threadRowSelector(projectId, threadId))
    : page.locator(`${group(projectId)} .wb-thread, ${group(projectId)} .wb-empty-start`).first();
  await row.click();
}

try {
  const pageWsl = await app.firstWindow();
  await verified(pageWsl);
  // Thread A: a slow command, for switching threads inside the project.
  // Long enough that thread B's turn (slower under load) ends first.
  const slowCommand = "sleep 30; echo done-in-wsl";
  const slowPrompt = (command) => `Run this shell command once with exec_command: \`${command}\`. While it is still running, wait for it with write_stdin (empty input). Then reply with only its output.`;
  const turnEnd = (text) => ((text.match(/done-in-wsl/g) || []).length >= 2 ? "reply" : /Codex error|Stopped:/.test(text) ? "error" : "");
  await send(pageWsl, slowPrompt(slowCommand));
  const threadA = await waitFor("the WSL turn to run", () => threadIn(pageWsl, wslProject.id, (thread) => thread.running), 60_000);
  report.checks.push("wsl_turn_running");

  // Thread B in the same project while A runs (it used to be locked out).
  await send(pageWsl, "Reply with only the word pong.");
  await waitFor("thread B's reply", async () => ((await transcriptText(pageWsl)).match(/\bpong\b/gi) || []).length >= 2, 120_000);
  assert.equal((await transcriptText(pageWsl)).includes("done-in-wsl"), false, "A's output doesn't land in B");
  assert.equal((await threadIn(pageWsl, wslProject.id, (thread) => thread.threadId === threadA.threadId))?.running, true, "A still runs");
  report.checks.push("second_thread_while_first_runs");

  // Back to A while it still runs: its turn so far is replayed (thread/read
  // has finished turns only), then it goes on live on screen.
  await pageWsl.locator(threadRowSelector(wslProject.id, threadA.threadId)).click();
  await waitFor("thread A on screen", () => pageWsl.evaluate((id) => window.DirectWorkbenchSurface.currentThreadId() === id, threadA.threadId), 15_000);
  assert.equal((await threadIn(pageWsl, wslProject.id, (thread) => thread.threadId === threadA.threadId))?.running, true, "A was still running when shown again");
  await waitFor("A's running turn replayed", async () => (await transcriptText(pageWsl)).includes("sleep 30"), 10_000);
  await sleep(1500);
  report.returnedState = await pageWsl.evaluate(() => ({
    turnActive: window.DirectWorkbenchSurface.turnActive(),
    chip: document.getElementById("morphicTurnChip")?.textContent || "",
  }));
  assert.equal(report.returnedState.turnActive, true, `A shows as running after the replay: ${JSON.stringify(report.returnedState)}`);
  assert.match(report.returnedState.chip, /Working/);
  assert.doesNotMatch(await transcriptText(pageWsl), /\bpong\b/i, "B's turn isn't in A");
  report.checks.push("running_turn_replayed_on_return");
  const endOnScreen = await waitFor("A's turn to end on screen", async () => turnEnd(await transcriptText(pageWsl)), 120_000);
  report.replayedTurnEnd = endOnScreen;
  report.checks.push("replayed_turn_continued_live");

  // Thread D, then straight to the other project while D runs: its own
  // surface opens; the WSL one stays alive behind it, D shown running.
  await send(pageWsl, slowPrompt("sleep 20; echo done-in-wsl"));
  const threadD = await waitFor("D to run", () => threadIn(pageWsl, wslProject.id, (thread) => thread.running), 60_000);
  const opened = app.waitForEvent("window", { timeout: 60_000 });
  await goToProject(pageWsl, otherProject.id);
  const pageOther = await opened;
  await verified(pageOther);
  assert.equal(pageWsl.isClosed(), false, "the WSL surface stays open");
  await pageOther.waitForSelector(`${threadRowSelector(wslProject.id, threadD.threadId)}.running`, { timeout: 15_000 });
  await shot(pageOther, "other-project-in-front-wsl-running");
  report.checks.push("switched_project_while_running");

  await send(pageOther, "Reply with only the word pong.");
  await waitFor("the reply in the other project", async () => ((await transcriptText(pageOther)).match(/\bpong\b/gi) || []).length >= 2, 120_000);
  report.checks.push("other_project_turn");

  await waitFor("D to finish in the background", async () => (await threadIn(pageOther, wslProject.id, (thread) => thread.threadId === threadD.threadId))?.running === false, 180_000);
  await waitFor("D marked unread", async () => (await threadIn(pageOther, wslProject.id, (thread) => thread.threadId === threadD.threadId))?.unread === true, 15_000);
  report.checks.push("finished_in_background_marked_unread");
  const named = await waitFor("the model's title for A", async () => {
    const thread = await threadIn(pageOther, wslProject.id, (entry) => entry.threadId === threadA.threadId);
    return thread && !/direct session$/i.test(thread.title) ? thread.title : null;
  }, 60_000);
  report.modelTitle = named;
  report.checks.push("model_named_thread");

  // Back to D: no new surface, the end of its turn is there, and it isn't
  // unread any more.
  let reopened = false;
  app.once("window", () => { reopened = true; });
  await goToProject(pageOther, wslProject.id, threadD.threadId);
  await waitFor("the WSL surface in front", async () => (await overview(pageWsl)).selectedProjectId === wslProject.id, 30_000);
  await sleep(1000);
  assert.equal(reopened, false, "switching back reuses the live surface");
  report.backgroundTurnEnd = turnEnd(await transcriptText(pageWsl));
  assert(report.backgroundTurnEnd, "the end of D's turn is in its transcript");
  await waitFor("D no longer unread", async () => (await threadIn(pageWsl, wslProject.id, (thread) => thread.threadId === threadD.threadId))?.unread === false, 10_000);
  await shot(pageWsl, "wsl-project-back-in-front");
  report.checks.push("switched_back_without_reload");

  // A question while the project is in the background: "needs you" in the
  // other project's sidebar; answered after switching back.
  await send(pageWsl, "Use request_user_input to ask me whether to proceed (yes or no). Then reply with only my answer, in upper case.");
  const asking = await waitFor("the question to reach the owner", () => threadIn(pageWsl, wslProject.id, (thread) => thread.state === "needs_you"), 120_000);
  await pageWsl.waitForSelector(`${threadRowSelector(wslProject.id, asking.threadId)}.needs-you`, { timeout: 10_000 });
  const otherThread = (await rowFor(pageWsl, otherProject.id)).threads[0];
  await goToProject(pageWsl, otherProject.id, otherThread.threadId);
  await waitFor("the other project in front", async () => (await overview(pageOther)).selectedProjectId === otherProject.id, 30_000);
  await pageOther.waitForSelector(`${threadRowSelector(wslProject.id, asking.threadId)}.needs-you`, { timeout: 10_000 });
  await shot(pageOther, "wsl-question-waiting-in-background");
  report.checks.push("needs_you_badge_in_background");
  await goToProject(pageOther, wslProject.id, asking.threadId);
  await waitFor("the WSL surface in front again", async () => (await overview(pageWsl)).selectedProjectId === wslProject.id, 30_000);
  const field = pageWsl.locator(".codex-request-form [data-question-id]").last();
  await field.waitFor({ timeout: 10_000 });
  if (await field.evaluate((node) => node.tagName) === "SELECT") {
    await field.selectOption(await field.evaluate((node) => [...node.options].find((option) => /yes/i.test(option.textContent))?.value || node.options[0].value));
  } else {
    await field.fill("yes");
  }
  await pageWsl.getByRole("button", { name: "Submit answers" }).last().click();
  await waitFor("the answered turn's reply", async () => /\bYES\b/.test(await transcriptText(pageWsl)), 120_000);
  await waitFor("the badge to clear", async () => (await rowFor(pageWsl, wslProject.id))?.needsYouCount === 0, 30_000);
  report.checks.push("answered_after_switching_back");

  // Rename A from the sidebar.
  await pageWsl.locator(`${threadRowSelector(wslProject.id, threadA.threadId)} .wb-thread-title`).dblclick();
  const rename = pageWsl.locator(`${threadRowSelector(wslProject.id, threadA.threadId)} .wb-rename`);
  await rename.fill("Renamed by the live check");
  await rename.press("Enter");
  await waitFor("the new name", async () => (await threadIn(pageWsl, wslProject.id, (thread) => thread.threadId === threadA.threadId))?.title === "Renamed by the live check", 10_000);
  await waitFor("the new name in the sidebar", async () => (await pageWsl.locator(`${threadRowSelector(wslProject.id, threadA.threadId)} .wb-thread-title`).innerText()) === "Renamed by the live check", 10_000);
  await shot(pageWsl, "sidebar-after-rename");
  report.checks.push("renamed_from_sidebar");

  // The project menu, search, the collapsed tiles, the narrow drawer.
  await pageWsl.locator(`${group(wslProject.id)} .wb-project-header`).hover();
  await pageWsl.locator(`${group(wslProject.id)} .wb-project-more`).click();
  await pageWsl.waitForSelector(".wb-menu .wb-menu-item", { timeout: 5_000 });
  assert.deepEqual(await pageWsl.locator(".wb-menu .wb-menu-item").allInnerTexts(), ["New thread here", "Open folder", "Edit project…", "Hide threads", "Archive project…"]);
  assert.equal(await pageWsl.locator(".wb-menu .wb-menu-item", { hasText: "Archive project…" }).isDisabled(), true, "the project in front can't be archived from here");
  await shot(pageWsl, "project-menu");
  await pageWsl.keyboard.press("Escape");
  await pageWsl.locator("#wbThreadSearch").fill("pong");
  const matches = await pageWsl.locator(".wb-thread .wb-thread-title").allInnerTexts();
  assert(matches.length >= 2 && matches.every((title) => /pong/i.test(title)), `search keeps only matching threads: ${matches.join(" | ")}`);
  await shot(pageWsl, "search");
  await pageWsl.locator("#wbThreadSearch").press("Escape");
  await pageWsl.locator("#t3SidebarToggle").click();
  await pageWsl.waitForSelector(".wb-tree.tiles .wb-tile", { timeout: 5_000 });
  assert.equal(await pageWsl.locator(".wb-tree.tiles .wb-tile").count(), 2);
  await pageWsl.locator(`.wb-tile[data-project-id="${otherProject.id}"]`).hover();
  await pageWsl.waitForSelector(".wb-flyout .wb-thread", { timeout: 5_000 });
  await shot(pageWsl, "collapsed-flyout");
  await pageWsl.locator("#t3SidebarToggle").click();
  await pageWsl.waitForSelector(".wb-project", { timeout: 5_000 });
  const fullSize = await pageWsl.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await pageWsl.setViewportSize({ width: 700, height: 900 });
  await pageWsl.locator("#wbDrawerToggle").click();
  await pageWsl.waitForFunction(() => document.getElementById("codexShell")?.dataset.wbDrawer === "open");
  await sleep(300);
  await shot(pageWsl, "narrow-drawer");
  await pageWsl.evaluate(() => { document.getElementById("codexShell").dataset.wbDrawer = "closed"; });
  await pageWsl.setViewportSize(fullSize);
  await pageWsl.waitForFunction((width) => window.innerWidth >= width - 1, fullSize.width);
  report.checks.push("menu_search_collapsed_drawer");

  // A runtime transition for the WSL project that finishes while the
  // project is in the background (here a switch to Appserver, run from its
  // own background surface) must not land in the surface in front: the WSL
  // project's idle surface is retired instead and reopens with the new
  // binding when shown.
  const surfaceProjectId = (page) => JSON.parse(Buffer.from(new URL(page.url()).hash.slice(1), "base64url").toString("utf8")).project.id;
  await goToProject(pageWsl, otherProject.id, otherThread.threadId);
  await waitFor("the other project in front", async () => (await overview(pageOther)).selectedProjectId === otherProject.id, 30_000);
  const otherUrl = pageOther.url();
  pageWsl.evaluate((projectId) => {
    window.codexSurfaceBridge.setDirectWorkbenchRuntimePath(projectId, "app-server").catch(() => {});
  }, wslProject.id).catch(() => {});
  // Until the background surface closes, or the transition lands somewhere.
  await waitFor("the transition to settle", async () => pageWsl.isClosed() || pageOther.url() !== otherUrl, 15_000).catch(() => {});
  await sleep(1000);
  assert.equal(pageOther.url(), otherUrl, "the surface in front wasn't reloaded with the WSL project");
  assert.equal(surfaceProjectId(pageOther), otherProject.id, "the surface in front still shows its own project");
  assert.equal((await overview(pageOther)).selectedProjectId, otherProject.id, "the transition didn't take the front");
  assert.equal(pageWsl.isClosed(), true, "the background WSL surface is retired");
  const savedConfig = JSON.parse(fs.readFileSync(path.join(profile, "workspace-config.json"), "utf8"));
  assert.equal(savedConfig.selectedProjectId, otherProject.id);
  assert.equal(savedConfig.projects.find((entry) => entry.id === wslProject.id)?.surfaceBinding?.codex?.runtimeMode, "legacy-app-server", "the transition itself was saved");
  report.checks.push("background_transition_kept_apart");

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
