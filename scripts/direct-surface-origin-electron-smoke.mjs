#!/usr/bin/env node
// The app serves its surfaces from codex-surface://app (src/main/
// local-surface-server.js): one origin across launches, so what a surface
// saves (the Access choice per project, panel state) is there on the next
// launch, and Chromium keeps compiled code for its scripts. Only the Codex
// partition serves the scheme. Two real launches on one profile.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = require("electron");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "direct-surface-origin-"));
const profile = path.join(temp, "profile");
const probeFile = path.join(temp, "probe.cjs");
const reportFile = (launch) => path.join(temp, `report-${launch}.json`);
const token = `persist-${Date.now().toString(36)}`;

fs.writeFileSync(probeFile, `
if (process.type === "browser") {
  // electron can't be required while preloads run; hook in at the app's
  // first require of it.
  const Module = require("node:module");
  const originalLoad = Module._load;
  let hooked = false;
  Module._load = function load(request) {
    const loaded = originalLoad.apply(this, arguments);
    if (request === "electron" && !hooked && loaded?.app) {
      hooked = true;
      probe(loaded);
    }
    return loaded;
  };
}

function probe({ app, WebContentsView }) {
  const fs = require("node:fs");
  const report = {};
  const finish = () => {
    fs.writeFileSync(process.env.PROBE_REPORT, JSON.stringify(report));
    app.quit();
  };
  setTimeout(() => { report.timedOut = true; finish(); }, 40000);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("dom-ready", async () => {
      const url = contents.getURL();
      if (!/t3-direct-surface\\.html/.test(url) || report.url) return;
      report.url = url.split("?")[0];
      try {
        report.stored = await contents.executeJavaScript(
          "(() => { const before = localStorage.getItem('smoke.persist'); if (process_mode === 'write') localStorage.setItem('smoke.persist', process_token); return { before, origin: location.origin, secure: window.isSecureContext }; })()"
            .replace("process_mode", JSON.stringify(process.env.PROBE_MODE))
            .replace("process_token", JSON.stringify(process.env.PROBE_TOKEN)),
        );
        // A page outside the Codex partition can't load the surfaces.
        const other = new WebContentsView({ webPreferences: { partition: "persist:codex-review-shell-chatgpt", sandbox: true } });
        report.otherPartition = await other.webContents.loadURL("codex-surface://app/t3-direct-surface.html").then(() => "loaded", (error) => error.code || "failed");
        other.webContents.close();
      } catch (error) {
        report.error = String(error?.message || error);
      }
      // Let the scripts' code cache be written.
      setTimeout(finish, 2500);
    });
  });
}
`);

const env = { ...process.env };
for (const name of ["ELECTRON_RUN_AS_NODE", "CODEX_WORLD_MANAGER", "CODEX_WORLD_MANAGER_MOCKUP", "CODEX_DIRECT_T3_GUI", "DIRECT_TEST_CONTROL", "CODEX_REVIEW_SHELL_PROFILE"]) delete env[name];
Object.assign(env, {
  CODEX_EXPERIENCE: "direct-workbench",
  CODEX_REVIEW_SHELL_USER_DATA_DIR: profile,
  CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
  NODE_OPTIONS: `--require ${JSON.stringify(probeFile)}`,
  PROBE_TOKEN: token,
});

const launch = (number, mode) => {
  const run = spawnSync(electron, [repo], { env: { ...env, PROBE_MODE: mode, PROBE_REPORT: reportFile(number) }, timeout: 90000, encoding: "utf8" });
  assert.ok(fs.existsSync(reportFile(number)), `launch ${number} wrote no report (exit ${run.status}): ${run.stderr}`);
  const report = JSON.parse(fs.readFileSync(reportFile(number), "utf8"));
  assert.equal(report.timedOut, undefined, `launch ${number}: the surface never loaded: ${run.stderr}`);
  assert.equal(report.error, undefined, report.error);
  return report;
};

const codeCacheEntries = () => {
  const dir = path.join(profile, "Partitions", "codex-review-shell-codex", "Code Cache", "js");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name !== "index" && name !== "index-dir").length : 0;
};

try {
  const first = launch(1, "write");
  assert.equal(first.url, "codex-surface://app/t3-direct-surface.html", "the surface loads from the app's scheme");
  assert.equal(first.stored.origin, "codex-surface://app");
  assert.equal(first.stored.secure, true, "a secure context, as 127.0.0.1 was");
  assert.equal(first.stored.before, null);
  assert.notEqual(first.otherPartition, "loaded", "the ChatGPT partition can't load the surfaces");

  const second = launch(2, "read");
  assert.equal(second.url, first.url);
  assert.equal(second.stored.before, token, "what the surface saved is there on the next launch");

  launch(3, "read");
  const entries = codeCacheEntries();
  assert.ok(entries > 0, "Chromium keeps compiled code for the surface's scripts");
  console.log(JSON.stringify({ url: first.url, persisted: true, otherPartition: first.otherPartition, codeCacheEntries: entries }));
  console.log("direct surface origin electron smoke passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
