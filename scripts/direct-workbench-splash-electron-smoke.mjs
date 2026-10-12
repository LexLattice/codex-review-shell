#!/usr/bin/env node
// The Workbench launch animation (src/main/workbench-splash.js) loads, puts
// a frame up, draws the layout, and on finish dissolves and removes itself.
// Playwright runs skip the animation, so this drives it in plain Electron.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = require("electron");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "direct-workbench-splash-"));
const mainFile = path.join(temp, "main.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reportFile = path.join(temp, "report.json");

fs.writeFileSync(mainFile, `
const fs = require("node:fs");
const { app, BaseWindow } = require("electron");
const { createWorkbenchSplash } = require(${JSON.stringify(path.join(repo, "src", "main", "workbench-splash.js"))});
app.whenReady().then(async () => {
  const report = {};
  try {
    const window = new BaseWindow({ width: 1200, height: 800, show: false, backgroundColor: "#090a0c" });
    const splash = createWorkbenchSplash(window);
    report.ready = await splash.ready;
    window.show();
    splash.shown();
    report.presented = await splash.presented(2000);
    const contents = window.contentView.children[0].webContents;
    report.drawing = await contents.executeJavaScript(\`({
      lines: document.querySelectorAll("path.line").length,
      rows: document.querySelectorAll("rect.ghost").length,
      status: document.getElementById("status").textContent,
      finish: typeof window.workbenchSplashFinish,
    })\`);
    report.childrenBefore = window.contentView.children.length;
    const started = Date.now();
    await splash.finish();
    report.finishMs = Date.now() - started;
    report.childrenAfter = window.contentView.children.length;
    report.activeAfter = splash.active;
  } catch (error) {
    report.error = String(error && error.stack || error);
  }
  fs.writeFileSync(${JSON.stringify(reportFile)}, JSON.stringify(report));
  app.quit();
});
`);

try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron, [mainFile], { env, timeout: 60000, encoding: "utf8" });
  assert.ok(fs.existsSync(reportFile), `no report (exit ${run.status}): ${run.stderr}`);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.ready, true, "the animation's page loads");
  assert.equal(report.presented, true, "it puts a frame up");
  assert.ok(report.drawing.lines >= 8, "the layout is drawn");
  assert.equal(report.drawing.rows, 6);
  assert.equal(report.drawing.status, "Getting the Workbench ready");
  assert.equal(report.drawing.finish, "function");
  assert.equal(report.childrenBefore, 1);
  // At least the minimum on-screen time, then the dissolve, then removal.
  assert.ok(report.finishMs >= 500 && report.finishMs < 2500, `finish took ${report.finishMs} ms`);
  assert.equal(report.childrenAfter, 0, "the animation removes itself");
  assert.equal(report.activeAfter, false);

  // The app's entry (src/boot.js) has the window and animation up before
  // main.js loads, and main.js adopts that window rather than opening one.
  // A second launch on the same profile quits and hands over to the first
  // ("second-instance"), which is how the launcher brings an unchanged app
  // to the front.
  const probeFile = path.join(temp, "boot-probe.cjs");
  const bootReportFile = path.join(temp, "boot-report.json");
  const mainLoadedFile = path.join(temp, "main-loaded");
  fs.writeFileSync(probeFile, `
if (process.type === "browser") {
  const fs = require("node:fs");
  const Module = require("node:module");
  const report = {};
  const finish = () => {
    const { app, BaseWindow } = require("electron");
    report.later = { windows: BaseWindow.getAllWindows().length };
    fs.writeFileSync(${JSON.stringify(bootReportFile)}, JSON.stringify(report));
    app.quit();
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent) {
    if (!report.atMainLoad && request === "./main.js" && /boot\\.js$/.test(parent?.filename || "")) {
      const { app, BaseWindow } = require("electron");
      const windows = BaseWindow.getAllWindows();
      report.atMainLoad = {
        windows: windows.length,
        visible: windows[0]?.isVisible() ?? false,
        views: windows[0]?.contentView.children.length ?? 0,
      };
      app.on("second-instance", () => {
        report.secondInstance = true;
        setTimeout(finish, 500);
      });
      setTimeout(finish, 20000);
      setTimeout(() => fs.writeFileSync(${JSON.stringify(mainLoadedFile)}, ""), 1000);
    }
    return originalLoad.apply(this, arguments);
  };
}
`);
  const bootEnv = { ...process.env };
  for (const name of ["ELECTRON_RUN_AS_NODE", "CODEX_WORLD_MANAGER", "CODEX_WORLD_MANAGER_MOCKUP", "CODEX_DIRECT_T3_GUI", "DIRECT_TEST_CONTROL", "CODEX_REVIEW_SHELL_PROFILE"]) delete bootEnv[name];
  bootEnv.CODEX_EXPERIENCE = "direct-workbench";
  bootEnv.CODEX_REVIEW_SHELL_USER_DATA_DIR = path.join(temp, "profile");
  const first = spawn(electron, [repo], { env: { ...bootEnv, NODE_OPTIONS: `--require ${JSON.stringify(probeFile)}` }, stdio: ["ignore", "ignore", "pipe"] });
  let firstStderr = "";
  first.stderr.on("data", (chunk) => { firstStderr += chunk; });
  const firstExit = new Promise((resolve) => first.on("exit", (code) => resolve(code)));
  for (let i = 0; i < 300 && !fs.existsSync(mainLoadedFile) && first.exitCode === null; i += 1) await delay(100);
  assert.ok(fs.existsSync(mainLoadedFile), `the app didn't load: ${firstStderr}`);
  const secondStarted = Date.now();
  const second = spawnSync(electron, [repo], { env: bootEnv, timeout: 20000, encoding: "utf8" });
  const secondMs = Date.now() - secondStarted;
  assert.equal(second.status, 0, `the second launch quits: ${second.stderr}`);
  assert.ok(secondMs < 10000, `the second launch took ${secondMs} ms`);
  await firstExit;
  assert.ok(fs.existsSync(bootReportFile), `no boot report: ${firstStderr}`);
  const bootReport = JSON.parse(fs.readFileSync(bootReportFile, "utf8"));
  assert.deepEqual(bootReport.atMainLoad, { windows: 1, visible: true, views: 1 }, "the window shows the animation before main.js loads");
  assert.equal(bootReport.secondInstance, true, "the running app hears of the second launch");
  assert.deepEqual(bootReport.later, { windows: 1 }, "main.js adopts the window, and the second launch opens none");
  console.log("direct workbench splash electron smoke passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
