#!/usr/bin/env node
// The launcher's side of the app control channel (src/main/app-control.js),
// for the app in this folder with the profile the environment names.
//
//   node scripts/app-control.mjs reuse [--changed]
//     Exit 0: the running app has the requested experience and current code
//       (and --changed wasn't given): keep it. The launcher then launches
//       once more, which brings it to the front (src/boot.js).
//     Exit 10: no app is running now (one running other code was asked to
//       quit, and force-stopped if it didn't within the grace period).
//     Exit 20: nothing answered but Electron processes are running (an app
//       from before the channel, or a hung one): the launcher stops them.
//   node scripts/app-control.mjs hello
//     Prints the running app's reply; exit 1 when none answers.
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { appControlChannel, readSyncGeneration, requestAppControl } = require("../src/main/app-control.js");
const { isolatedProfileFromEnv } = require("../src/main/app-profile.js");
const { resolveAppExperience } = require("../src/main/app-experience.js");

const QUIT_GRACE_MS = Number(process.env.APP_CONTROL_QUIT_GRACE_MS || 20000);

function appDataPath() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

const log = (message) => console.log(`[app-control] ${message}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitForExit(pid, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!processAlive(pid)) return true;
    await delay(100);
  }
  return !processAlive(pid);
}

function forceStop(pid) {
  if (process.platform === "win32") {
    spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

function electronProcessesRunning() {
  if (process.platform !== "win32") return false;
  const run = spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe"), ["/FI", "IMAGENAME eq electron.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
  return /electron\.exe/i.test(run.stdout || "");
}

const profile = isolatedProfileFromEnv(process.env, appDataPath());
const channel = appControlChannel({ appRoot, userData: profile?.userData || "" });
const [command = "reuse", ...flags] = process.argv.slice(2);
const hello = await requestAppControl(channel, { op: "hello" });

if (command === "hello") {
  console.log(JSON.stringify(hello));
  process.exit(hello.ok ? 0 : 1);
}
if (command !== "reuse") {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}

if (!hello.ok) {
  if (electronProcessesRunning()) {
    log(`no app answered (${hello.error}); Electron processes are running`);
    process.exit(20);
  }
  log("no app is running");
  process.exit(10);
}

let wanted = "";
try {
  wanted = resolveAppExperience(process.env).id;
} catch {}
const generation = readSyncGeneration(appRoot);
const reasons = [];
if (flags.includes("--changed")) reasons.push("the WSL worktree changed");
if (hello.experience !== wanted) reasons.push(`it runs ${hello.experience}, not ${wanted || "an unknown experience"}`);
if (hello.generation !== generation) reasons.push("it runs older synced code");

if (!reasons.length) {
  log(`the running app (pid ${hello.pid}) is current; keeping it`);
  process.exit(0);
}

log(`restarting the running app (pid ${hello.pid}): ${reasons.join("; ")}`);
const started = Date.now();
await requestAppControl(channel, { op: "quit" });
if (await waitForExit(hello.pid, QUIT_GRACE_MS)) {
  log(`it quit in ${Date.now() - started} ms`);
} else {
  log(`it didn't quit within ${QUIT_GRACE_MS} ms; stopping it`);
  forceStop(hello.pid);
  await waitForExit(hello.pid, 5000);
}
process.exit(10);
