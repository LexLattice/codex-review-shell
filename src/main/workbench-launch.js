"use strict";

// Opens the Direct Workbench window with its launch animation. The entry
// point (src/boot.js) does this as soon as the app is ready, before the main
// process's modules load, and main.js adopts the window; main.js opens one
// itself when there is none to adopt.
const { BaseWindow, Menu, app, nativeTheme } = require("electron");
const { APP_EXPERIENCES, resolveAppExperience } = require("./app-experience");
const { createWorkbenchSplash } = require("./workbench-splash");

// The surface's own background: the window and each project's view paint it
// before the page does, so loading never flashes white or grey.
const DIRECT_WORKBENCH_BACKGROUND = "#090a0c";
// How long the window waits for the animation's page before showing anyway.
const SPLASH_WAIT_MS = 400;
// On Windows, how long the window stays off screen after it is shown: its
// open fade and first frame take about this long (0.15 s still showed the
// grey; 0.22 s did not).
const OFFSCREEN_SETTLE_MS = 300;
const RESIZE_EVENTS = ["resize", "resized", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Agent-driven testing (scripts/direct-drive.mjs): a local control port into
// the real Direct runtime, with the window hidden unless asked for.
function directTestControlFromEnv(env = process.env) {
  const enabled = /^(1|true|yes)$/i.test(String(env.DIRECT_TEST_CONTROL || "").trim());
  return { enabled, hidden: enabled && env.DIRECT_TEST_CONTROL_SHOW !== "1" };
}

function directWorkbenchExperience(env = process.env) {
  try {
    const experience = resolveAppExperience(env);
    return experience.id === APP_EXPERIENCES.DIRECT_WORKBENCH ? experience : null;
  } catch {
    // main.js resolves the experience again and reports the error.
    return null;
  }
}

async function openWorkbenchWindow({ title, hidden = false }) {
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "dark";
  const window = new BaseWindow({
    width: 1720,
    height: 980,
    minWidth: 720,
    minHeight: 620,
    title,
    backgroundColor: DIRECT_WORKBENCH_BACKGROUND,
    show: false,
  });
  // Not under an automation driver (Playwright attaches over remote
  // debugging): its first page would be the animation, not the Workbench.
  const automated = app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("remote-debugging-pipe");
  const splash = !hidden && !automated ? createWorkbenchSplash(window) : null;
  const launch = { window, splash, showPending: !hidden };
  if (!splash) return launch;

  const fit = () => splash.fit();
  for (const eventName of RESIZE_EVENTS) window.on(eventName, fit);
  // Up before the work that holds the main thread, so the animation plays
  // through it rather than appearing after it.
  const shownAt = Date.now();
  const moveHome = process.platform === "win32" ? splash.showOffscreen() : null;
  const loaded = await Promise.race([splash.ready, delay(SPLASH_WAIT_MS).then(() => false)]);
  if (window.isDestroyed()) return launch;
  if (!moveHome) {
    window.show();
    splash.shown();
  }
  if (loaded) await splash.presented();
  if (moveHome) {
    const settle = OFFSCREEN_SETTLE_MS - (Date.now() - shownAt);
    if (settle > 0) await delay(settle);
    moveHome();
    splash.shown();
  }
  launch.showPending = false;
  return launch;
}

let earlyLaunch = null;

function openEarlyWorkbenchWindow(options) {
  earlyLaunch = openWorkbenchWindow(options);
  return earlyLaunch;
}

async function takeEarlyWorkbenchWindow() {
  const pending = earlyLaunch;
  earlyLaunch = null;
  const launch = pending ? await pending : null;
  return launch && !launch.window.isDestroyed() ? launch : null;
}

module.exports = {
  DIRECT_WORKBENCH_BACKGROUND,
  directTestControlFromEnv,
  directWorkbenchExperience,
  openEarlyWorkbenchWindow,
  openWorkbenchWindow,
  takeEarlyWorkbenchWindow,
};
