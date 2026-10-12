#!/usr/bin/env node
// The app control channel (src/main/app-control.js) and the launcher's
// client (scripts/app-control.mjs): a relaunch with nothing new keeps the
// running app; anything new, or another experience, makes it quit.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const control = require("../src/main/app-control.js");
const { appControlChannel, readSyncGeneration, requestAppControl, startAppControlServer } = control;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "direct-app-control-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  // Channel names: per folder and profile; the default profile has its own.
  const a = appControlChannel({ appRoot: "/apps/one" });
  assert.equal(a, appControlChannel({ appRoot: "/apps/one/" }));
  assert.notEqual(a, appControlChannel({ appRoot: "/apps/two" }));
  assert.notEqual(a, appControlChannel({ appRoot: "/apps/one", userData: "/profiles/test" }));
  assert.match(a, /codex-review-shell-[0-9a-f]{16}-default/);

  // Server: hello, quit, anything else; one instance per channel.
  const appRoot = path.join(temp, "app");
  fs.mkdirSync(appRoot);
  assert.equal(readSyncGeneration(appRoot), "");
  fs.writeFileSync(path.join(appRoot, control.SYNC_GENERATION_FILE), "gen-1\r\n");
  assert.equal(readSyncGeneration(appRoot), "gen-1");
  const channel = appControlChannel({ appRoot, userData: path.join(temp, "profile") });
  const calls = [];
  const server = startAppControlServer(channel, {
    hello: () => ({ pid: process.pid, experience: "direct-workbench", generation: "gen-1" }),
    quit: () => calls.push("quit"),
  });
  assert.equal(await server.started, true);
  assert.deepEqual(await requestAppControl(channel, { op: "hello" }), { ok: true, pid: process.pid, experience: "direct-workbench", generation: "gen-1" });
  assert.deepEqual(await requestAppControl(channel, { op: "focus" }), { ok: false, error: "unknown_request" });
  assert.deepEqual(calls, [], "only hello and quit are understood");
  assert.deepEqual(await requestAppControl(channel, { op: "quit" }), { ok: true });
  await delay(20);
  assert.deepEqual(calls, ["quit"]);
  const second = startAppControlServer(channel, { hello: () => ({}), quit: () => {} });
  assert.equal(await second.started, false, "a second instance leaves the first one's channel alone");
  server.close();
  await delay(50);
  const missing = await requestAppControl(channel, { op: "hello" }, { timeoutMs: 1000 });
  assert.equal(missing.ok, false, "nothing answers once the app is gone");

  if (process.platform !== "win32") {
    // A socket file left by a crashed app doesn't keep the next one out.
    const stale = appControlChannel({ appRoot, userData: path.join(temp, "stale") });
    fs.writeFileSync(stale, "");
    const recovered = startAppControlServer(stale, { hello: () => ({ pid: 1 }), quit: () => {} });
    assert.equal(await recovered.started, true);
    assert.equal((await requestAppControl(stale, { op: "hello" })).pid, 1);
    assert.equal(fs.statSync(stale).mode & 0o077, 0, "only this user can connect");
    recovered.close();
  }

  // The launcher's client against a stand-in app process (this repo's
  // folder, an isolated profile).
  const profile = path.join(temp, "client-profile");
  const fakeApp = path.join(temp, "fake-app.cjs");
  fs.writeFileSync(fakeApp, `
const control = require(${JSON.stringify(path.join(repo, "src", "main", "app-control.js"))});
const channel = control.appControlChannel({ appRoot: process.env.FAKE_ROOT || ${JSON.stringify(repo)}, userData: ${JSON.stringify(profile)} });
const server = control.startAppControlServer(channel, {
  hello: () => ({ pid: process.pid, experience: process.env.FAKE_EXPERIENCE, generation: process.env.FAKE_GENERATION }),
  quit: () => { console.log("quitting"); server.close(); setTimeout(() => process.exit(0), 200); },
});
server.started.then(() => console.log("listening"));
setTimeout(() => process.exit(3), 30000);
`);
  const clientEnv = {
    ...process.env,
    CODEX_REVIEW_SHELL_USER_DATA_DIR: profile,
    CODEX_EXPERIENCE: "direct-workbench",
  };
  const generation = readSyncGeneration(repo);
  const startFake = async (experience = "direct-workbench", fakeGeneration = generation, fakeRoot = "") => {
    const child = spawn(process.execPath, [fakeApp], { env: { ...process.env, FAKE_EXPERIENCE: experience, FAKE_GENERATION: fakeGeneration, FAKE_ROOT: fakeRoot }, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    for (let i = 0; i < 100 && !output.includes("listening"); i += 1) await delay(20);
    assert.ok(output.includes("listening"), "the stand-in app listens");
    return { child, exited, output: () => output };
  };
  const client = (...args) => spawnSync(process.execPath, [path.join(repo, "scripts", "app-control.mjs"), ...args], { env: clientEnv, encoding: "utf8", timeout: 30000 });

  const none = client("reuse");
  // 20 on Windows when other Electron apps happen to run.
  const freshCodes = process.platform === "win32" ? [10, 20] : [10];
  assert.ok(freshCodes.includes(none.status), `nothing running: start fresh (${none.status}) ${none.stdout}${none.stderr}`);

  const same = await startFake();
  const hello = client("hello");
  assert.equal(hello.status, 0);
  assert.equal(JSON.parse(hello.stdout).pid, same.child.pid);
  const reuse = client("reuse");
  assert.equal(reuse.status, 0, reuse.stdout + reuse.stderr);
  assert.match(reuse.stdout, /is current; keeping it/);
  await delay(50);
  assert.doesNotMatch(same.output(), /quitting/);

  const changed = client("reuse", "--changed");
  assert.equal(changed.status, 10, changed.stdout + changed.stderr);
  assert.match(changed.stdout, /the WSL worktree changed/);
  assert.equal(await same.exited, 0, "it quits the ordinary way");

  const other = await startFake("legacy-shell");
  const otherRun = client("reuse");
  assert.equal(otherRun.status, 10);
  assert.match(otherRun.stdout, /runs legacy-shell, not direct-workbench/);
  assert.equal(await other.exited, 0);

  const older = await startFake("direct-workbench", "an older generation");
  const olderRun = client("reuse");
  assert.equal(olderRun.status, 10);
  assert.match(olderRun.stdout, /runs other code/);
  assert.equal(await older.exited, 0);

  // Installed versions share their release root's channel
  // (CODEX_REVIEW_SHELL_CONTROL_ROOT), whichever version folder runs.
  const releaseRoot = path.join(temp, "Release-Root");
  assert.equal(control.appControlRoot(repo, {}), repo);
  assert.equal(control.appControlRoot(repo, { [control.CONTROL_ROOT_ENV_VAR]: ` ${releaseRoot} ` }), releaseRoot);
  const released = await startFake("direct-workbench", generation, releaseRoot);
  const releaseClient = spawnSync(process.execPath, [path.join(repo, "scripts", "app-control.mjs"), "reuse"], {
    env: { ...clientEnv, [control.CONTROL_ROOT_ENV_VAR]: releaseRoot },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(releaseClient.status, 0, releaseClient.stdout + releaseClient.stderr);
  assert.match(releaseClient.stdout, /is current; keeping it/);

  // The mirror's launcher retires the installed app on the same profile
  // (and the release launcher the mirror's); a root that runs nothing is skipped.
  const retired = client("reuse", "--retire-root", path.join(temp, "nothing-here"), "--retire-root", process.platform === "win32" ? releaseRoot.toUpperCase() : releaseRoot);
  assert.ok(freshCodes.includes(retired.status), retired.stdout + retired.stderr);
  assert.match(retired.stdout, new RegExp(`the app from .*Release-Root.* \\(pid ${released.child.pid}\\) is running on this profile; asking it to quit`, "i"));
  assert.equal(await released.exited, 0);
  const self = await startFake();
  const selfRetire = client("reuse", "--retire-root", repo);
  assert.equal(selfRetire.status, 0, "its own root is never retired");
  self.child.kill();
  await self.exited;

  console.log("direct app control regression passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
