"use strict";

// The app's entry point. For the Direct Workbench it opens the window and
// its launch animation as soon as the app is ready, then loads the main
// process (main.js). Its ~400 modules take 0.15 s on a warm start, and
// seconds while Windows Defender scans freshly synced files; with main.js as
// the entry, nothing was on screen until they had all loaded.

// Compiled code of the main process's modules, kept between launches
// (Node's compile cache, in the temp folder; checked against each file's
// contents).
require("node:module").enableCompileCache?.();
const { app, protocol } = require("electron");
const { configureAppProfile } = require("./main/app-profile");
const { registerSurfaceScheme } = require("./main/local-surface-server");
const {
  directTestControlFromEnv,
  directWorkbenchExperience,
  openEarlyWorkbenchWindow,
} = require("./main/workbench-launch");

configureAppProfile(app);
// The surfaces' scheme (codex-surface://); privileges can only be granted
// before the app is ready, which main.js may load after.
registerSurfaceScheme(protocol);

function loadMainProcess() {
  require("./main.js");
}

const testControl = directTestControlFromEnv(process.env);
const workbench = directWorkbenchExperience(process.env);
// One app per profile. A second launch hands the running app its right to
// take the foreground (Chromium's process singleton calls
// AllowSetForegroundWindow) and quits; the running app then comes to the
// front ("second-instance" in main.js). That is how the launcher brings back
// an app it didn't need to restart. Test-control runs manage their own
// instances.
if (!testControl.enabled && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (!workbench) {
  loadMainProcess();
} else {
  app.whenReady().then(async () => {
    const launch = await openEarlyWorkbenchWindow({
      title: workbench.label,
      hidden: testControl.hidden,
    });
    // Closed before the app loaded: Electron quits with its last window.
    if (launch.window.isDestroyed()) return;
    loadMainProcess();
  }).catch((error) => {
    // Thrown outside the promise so Electron reports it as it would a
    // failure in the entry script.
    process.nextTick(() => { throw error; });
  });
}
