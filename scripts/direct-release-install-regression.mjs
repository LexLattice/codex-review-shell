#!/usr/bin/env node
// The daily app's installer (scripts/release-install.mjs) against a fixture
// checkout: tag choice, side-by-side versions, switching back, pruning; and
// the release launchers it copies into the release root.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireInstallLock,
  compareReleaseTags,
  gitInvocation,
  latestReleaseTag,
  parseArgs,
  parseReleaseTag,
  processStartIdentity,
  versionsToPrune,
} from "./release-install.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repo, relativePath), "utf8");

// Process identity is independent of PID liveness, and failed inspection is
// unknown rather than permission to take over another installer's lock.
const selfIdentity = processStartIdentity(process.pid);
assert.ok(selfIdentity?.startsWith(`${process.platform}:`));
assert.equal(processStartIdentity(-1), null);
const bootId = "12345678-1234-1234-1234-123456789abc";
const linuxIdentity = (boot, start) => processStartIdentity(42, {
  platform: "linux",
  readFile: (file) => file.endsWith("boot_id") ? `${boot}\n` : `42 (worker ) with spaces) ${["S", ...Array(18).fill("0"), start, "0"].join(" ")}\n`,
});
assert.equal(linuxIdentity(bootId, "98765"), `linux:${bootId}:98765`, "stat starttime is field 22 even with parentheses in comm");
assert.notEqual(linuxIdentity(bootId, "98765"), linuxIdentity(bootId, "98766"), "PID reuse within a boot changes identity");
assert.notEqual(linuxIdentity(bootId, "98765"), linuxIdentity("abcdefab-1234-1234-1234-123456789abc", "98765"), "identical PID/start ticks after reboot remain distinct");
assert.equal(linuxIdentity("not-a-boot-id", "98765"), null);
assert.equal(linuxIdentity(bootId, "bad-start"), null);
assert.equal(processStartIdentity(42, { platform: "linux", readFile: () => { throw new Error("access denied"); } }), null);
const windowsIdentity = (result) => processStartIdentity(42, { platform: "win32", run: (command, args, options) => {
  assert.match(command, /WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.ok(args.includes("-NoProfile"));
  assert.match(args.at(-1), /GetProcessById\(42\).*StartTime\.ToUniversalTime\(\)\.Ticks/);
  assert.equal(options.timeout, 5000, "process inspection is bounded");
  assert.equal(options.windowsHide, true);
  return result;
} });
assert.equal(windowsIdentity({ status: 0, stdout: "638962500000000000\r\n" }), "win32:638962500000000000");
assert.equal(windowsIdentity({ status: 1, stdout: "" }), null);
assert.equal(windowsIdentity({ status: 0, stdout: "Access denied" }), null);
assert.equal(windowsIdentity({ status: null, error: { code: "ETIMEDOUT" } }), null);
assert.equal(processStartIdentity(42, { platform: "darwin", run: (_command, _args, options) => {
  assert.equal(options.env.TZ, "UTC", "timezone changes cannot alter a live process identity");
  assert.equal(options.env.LC_ALL, "C");
  return { status: 0, stdout: "Fri Oct 16 21:30:00 2026\n" };
} }), "darwin:Fri Oct 16 21:30:00 2026");

// Tags.
assert.deepEqual(parseReleaseTag("v0.5.0"), { tag: "v0.5.0", numbers: [0, 5, 0], prerelease: "" });
assert.equal(parseReleaseTag("v0.5.0-rc.2").prerelease, "rc.2");
assert.equal(parseReleaseTag("0.5.0"), null);
assert.equal(parseReleaseTag("v0.5"), null);
assert.ok(compareReleaseTags("v0.10.0", "v0.9.9") > 0, "numeric, not text, order");
assert.ok(compareReleaseTags("v0.5.0-rc.1", "v0.5.0") < 0, "a prerelease sorts before its release");
assert.ok(compareReleaseTags("v0.5.0-rc.10", "v0.5.0-rc.9") > 0);
assert.equal(compareReleaseTags("v1.2.3", "v1.2.3"), 0);
assert.equal(latestReleaseTag(["v0.4.0", "v0.10.0", "v0.9.0", "v0.11.0-rc.1", "nightly"]), "v0.10.0");
assert.equal(latestReleaseTag(["v0.4.0", "v0.5.0-rc.1"], { prereleases: true }), "v0.5.0-rc.1");
assert.equal(latestReleaseTag(["nightly"]), "");

// Arguments.
assert.deepEqual(parseArgs([]), { tag: "", ref: "", name: "", previous: false, list: false, force: false, offline: false, start: true });
assert.deepEqual(
  parseArgs(["--ref", "main", "--name", "main-test", "--force", "--offline", "--no-start"]),
  { tag: "", ref: "main", name: "main-test", previous: false, list: false, force: true, offline: true, start: false },
);
assert.equal(parseArgs(["v0.5.1"]).tag, "v0.5.1");
assert.equal(parseArgs(["--previous"]).previous, true);
assert.throws(() => parseArgs(["--latest"]), /Unknown option --latest/);

// The WSL checkout is read without a Linux shell in between: through `--`,
// wsl.exe let the shell expand "v*" against the current folder's files.
const viaWsl = gitInvocation(["tag", "--list", "v*"], { CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO: "Ubuntu", CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "/src/app" }, "win32");
assert.match(viaWsl.command, /wsl\.exe$/i);
assert.deepEqual(viaWsl.args, ["-d", "Ubuntu", "--exec", "git", "-C", "/src/app", "tag", "--list", "v*"]);
assert.deepEqual(gitInvocation(["status"], { CODEX_REVIEW_SHELL_RELEASE_SOURCE: "/src/local" }, "win32"), { command: "git", args: ["-C", "/src/local", "status"] });
if (process.platform === "win32") {
  // The real thing, from a folder with a file the pattern would match.
  const globDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-release-glob-"));
  try {
    fs.writeFileSync(path.join(globDir, "v-not-a-tag.txt"), "");
    const echoed = spawnSync(viaWsl.command, ["-d", process.env.CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO || "Ubuntu", "--exec", "echo", "v*"], { cwd: globDir, encoding: "utf8", timeout: 60000 });
    assert.equal(echoed.status, 0, echoed.stderr);
    assert.equal(echoed.stdout.trim(), "v*", "no shell expands the pattern");
  } finally {
    // WSL may hold the folder for a moment after it exits.
    fs.rmSync(globDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

// Pruning keeps current, previous and the newest others, three in all.
const installed = [
  { name: "v0.1.0", installedAt: "2026-01-01T00:00:00.000Z" },
  { name: "v0.2.0", installedAt: "2026-01-02T00:00:00.000Z" },
  { name: "v0.3.0", installedAt: "2026-01-03T00:00:00.000Z" },
  { name: "v0.4.0", installedAt: "2026-01-04T00:00:00.000Z" },
];
assert.deepEqual(versionsToPrune(installed, { current: "v0.4.0", previous: "v0.3.0" }), ["v0.1.0"]);
assert.deepEqual(versionsToPrune(installed, { current: "v0.1.0", previous: "v0.2.0" }), ["v0.3.0"]);
assert.deepEqual(versionsToPrune(installed.slice(0, 2), { current: "v0.2.0" }), []);
assert.deepEqual(
  versionsToPrune([...installed.slice(0, 3), { ...installed[3], lastCurrentAt: "2026-01-01T12:00:00.000Z" }], { current: "v0.1.0", previous: "v0.2.0" }),
  ["v0.4.0"],
  "by when a version was last current, then when it was installed",
);

// Launchers: the release one starts only what is installed; the mirror's
// and the release one retire each other's app on the shared profile.
const releaseLauncher = read("release/start-direct-workbench.cmd");
assert.match(releaseLauncher, /set \/p CURRENT=<"%ROOT_DIR%\\current\.txt"/);
assert.match(releaseLauncher, /set "CODEX_REVIEW_SHELL_CONTROL_ROOT=%ROOT_DIR%"/);
assert.match(releaseLauncher, /set "ELECTRON_EXE=%VERSION_DIR%\\node_modules\\electron\\dist\\electron\.exe"/);
assert.match(releaseLauncher, /app-control\.mjs" reuse --retire-root "%MIRROR_ROOT%"/);
assert.match(releaseLauncher, /copy \/y "%~f0" "!LAUNCH_COPY!"/, "an update may rewrite it while it waits on the app");
assert.doesNotMatch(releaseLauncher, /sync-from-wsl|npm(?:\.cmd"?)? (?:install|ci)|release-install\.mjs"/i, "starting never changes the installed code");
assert.doesNotMatch(releaseLauncher, /Stop-Process|taskkill|stop_unanswering_versions/i, "an unanswered profile never authorizes killing other profiles");
const updater = read("release/update-direct-workbench.cmd");
assert.match(updater, /versions\\%CURRENT%\\scripts\\release-install\.mjs/);
assert.match(updater, /copy \/y "%~f0" "!UPDATE_COPY!"/, "the installer rewrites it while it runs");
assert.match(read("release/rollback-direct-workbench.cmd"), /update-direct-workbench\.cmd" --previous %\* & exit \/b/);
assert.match(read("release/start-direct-workbench.vbs"), /start-direct-workbench\.cmd/);
const mirrorLauncher = read("start-codex-review-shell.cmd");
assert.match(mirrorLauncher, /if exist "!RELEASE_ROOT!\\current\.txt" set "REUSE_FLAGS=!REUSE_FLAGS! --retire-root "!RELEASE_ROOT!""/);

// End to end against a fixture checkout (no dependencies, so npm ci runs offline).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "direct-release-install-"));
try {
  const lockRoot = path.join(temp, "lock ownership");
  const unlock = acquireInstallLock(lockRoot);
  const ownerPath = path.join(lockRoot, ".release-install.lock", "owner.json");
  const liveOwner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  assert.equal(liveOwner.startIdentity, selfIdentity, "the published owner records its process start identity");
  assert.throws(() => acquireInstallLock(lockRoot), /Another release install owns/);
  assert.equal(fs.readFileSync(ownerPath, "utf8").includes(liveOwner.token), true, "a matching live owner remains protected");
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: liveOwner.pid, token: liveOwner.token }));
  assert.throws(() => acquireInstallLock(lockRoot), /Another release install owns/, "legacy live-PID locks without identity remain protected");
  fs.writeFileSync(ownerPath, JSON.stringify(liveOwner));
  unlock();
  // A stale record names a PID which is demonstrably still alive, but now
  // belongs to a different process incarnation. Recovery must not kill it.
  process.kill(process.pid, 0);
  fs.mkdirSync(path.dirname(ownerPath));
  const staleIdentity = process.platform === "linux" ? `linux:00000000-0000-0000-0000-000000000000:${selfIdentity.split(":").at(-1)}`
    : process.platform === "win32" ? `win32:${BigInt(selfIdentity.split(":")[1]) - 1n}`
      : "darwin:Thu Jan  1 00:00:00 1970";
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token: "reused-pid", startIdentity: staleIdentity }));
  const unlockReusedPid = acquireInstallLock(lockRoot);
  assert.notEqual(JSON.parse(fs.readFileSync(ownerPath, "utf8")).token, "reused-pid", "a reused live PID does not strand updates or rollback");
  assert.equal(JSON.parse(fs.readFileSync(path.join(lockRoot, ".release-install-locks", "recovered-reused-pid", "owner.json"), "utf8")).startIdentity, staleIdentity);
  process.kill(process.pid, 0);
  unlockReusedPid();
  if (process.platform === "linux") {
    fs.mkdirSync(path.dirname(ownerPath));
    const earlierStart = `${selfIdentity.slice(0, selfIdentity.lastIndexOf(":"))}:${BigInt(selfIdentity.split(":").at(-1)) - 1n}`;
    fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token: "same-boot-reused-pid", startIdentity: earlierStart }));
    acquireInstallLock(lockRoot)();
    assert.equal(fs.existsSync(path.join(lockRoot, ".release-install-locks", "recovered-same-boot-reused-pid")), true, "a reused PID from the same boot is also recovered");
  }
  const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
  assert.equal(exited.status, 0);
  fs.mkdirSync(path.join(lockRoot, ".release-install.lock"));
  fs.writeFileSync(path.join(lockRoot, ".release-install.lock", "owner.json"), JSON.stringify({ pid: exited.pid, token: "dead-owner" }));
  const unlockRecovered = acquireInstallLock(lockRoot);
  const recoveredOwner = JSON.parse(fs.readFileSync(path.join(lockRoot, ".release-install.lock", "owner.json"), "utf8"));
  assert.equal(recoveredOwner.pid, process.pid);
  const tombstone = path.join(lockRoot, ".release-install-locks", "recovered-dead-owner");
  assert.throws(() => fs.renameSync(path.join(lockRoot, ".release-install.lock"), tombstone), "a paused stale observer cannot replace its predecessor's nonempty tombstone with a live owner's lock");
  assert.equal(JSON.parse(fs.readFileSync(path.join(lockRoot, ".release-install.lock", "owner.json"), "utf8")).token, recoveredOwner.token);
  unlockRecovered();
  assert.equal(fs.existsSync(path.join(lockRoot, ".release-install.lock")), false, "locks are released after ownership ends");
  // A recovery interrupted after retiring the dead lock leaves only its
  // tombstone. There is no second lock to strand, and retry can acquire.
  fs.mkdirSync(path.join(lockRoot, ".release-install.lock"));
  fs.writeFileSync(path.join(lockRoot, ".release-install.lock", "owner.json"), JSON.stringify({ pid: exited.pid, token: "interrupted-recovery" }));
  fs.renameSync(path.join(lockRoot, ".release-install.lock"), path.join(lockRoot, ".release-install-locks", "recovered-interrupted-recovery"));
  acquireInstallLock(lockRoot)();

  const source = path.join(temp, "source");
  const root = path.join(temp, "release root");
  fs.mkdirSync(path.join(source, "release"), { recursive: true });
  const git = (...args) => {
    const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  // Local packages, so npm ci needs no network: one runtime, one dev-only.
  for (const name of ["runtime-dep", "dev-dep"]) {
    fs.mkdirSync(path.join(source, "vendor", name), { recursive: true });
    fs.writeFileSync(path.join(source, "vendor", name, "package.json"), `${JSON.stringify({ name, version: "1.0.0" })}\n`);
  }
  const commitVersion = (version, tag) => {
    fs.writeFileSync(path.join(source, "package.json"), `${JSON.stringify({
      name: "release-fixture",
      version,
      private: true,
      dependencies: { "runtime-dep": "file:vendor/runtime-dep" },
      devDependencies: { "dev-dep": "file:vendor/dev-dep" },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(source, "package-lock.json"), `${JSON.stringify({
      name: "release-fixture",
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "release-fixture",
          version,
          dependencies: { "runtime-dep": "file:vendor/runtime-dep" },
          devDependencies: { "dev-dep": "file:vendor/dev-dep" },
        },
        "node_modules/dev-dep": { resolved: "vendor/dev-dep", link: true },
        "node_modules/runtime-dep": { resolved: "vendor/runtime-dep", link: true },
        "vendor/dev-dep": { version: "1.0.0", dev: true },
        "vendor/runtime-dep": { version: "1.0.0" },
      },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(source, "release", "start-direct-workbench.cmd"), `rem launcher of ${version}\n`);
    fs.writeFileSync(path.join(source, "release", "notes.txt"), "not a launcher\n");
    git("add", "-A");
    git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", version);
    if (tag) git("tag", tag);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet");
  const v1 = commitVersion("0.1.0", "v0.1.0");
  const v2 = commitVersion("0.2.0", "v0.2.0");
  const rc = commitVersion("0.3.0", "v0.3.0-rc.1");
  const head = commitVersion("0.3.1", "");
  // A commit npm ci refuses (package.json and the lock disagree), on a side branch.
  git("checkout", "--quiet", "-b", "broken");
  const brokenPackage = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  brokenPackage.dependencies["missing-dep"] = "file:vendor/missing-dep";
  fs.writeFileSync(path.join(source, "package.json"), `${JSON.stringify(brokenPackage, null, 2)}\n`);
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-am", "broken");
  git("checkout", "--quiet", "-");

  const env = { ...process.env, CODEX_REVIEW_SHELL_RELEASE_ROOT: root, CODEX_REVIEW_SHELL_RELEASE_SOURCE: source };
  const install = (...args) => spawnSync(process.execPath, [path.join(repo, "scripts", "release-install.mjs"), "--offline", "--no-start", ...args], { env, encoding: "utf8", timeout: 120000 });
  const ok = (...args) => {
    const result = install(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  const current = () => fs.readFileSync(path.join(root, "current.txt"), "utf8").trim();
  const previous = () => fs.readFileSync(path.join(root, "previous.txt"), "utf8").trim();
  const versions = () => fs.readdirSync(path.join(root, "versions")).sort();

  ok();
  assert.equal(current(), "v0.2.0", "the newest release tag, not the prerelease");
  assert.ok(!fs.existsSync(path.join(root, "previous.txt")));
  const v2Dir = path.join(root, "versions", "v0.2.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(v2Dir, "package.json"), "utf8")).version, "0.2.0");
  assert.equal(fs.readFileSync(path.join(v2Dir, ".sync-generation.txt"), "utf8").trim(), `release v0.2.0 ${v2}`);
  const release = JSON.parse(fs.readFileSync(path.join(v2Dir, ".release.json"), "utf8"));
  assert.equal(release.commit, v2);
  assert.equal(release.packageVersion, "0.2.0");
  // lstat: npm links local packages, by an absolute junction on Windows that
  // the rename from the .partial folder leaves dangling (registry packages,
  // like the app's, are copies).
  const present = (target) => {
    try {
      fs.lstatSync(target);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(present(path.join(v2Dir, "node_modules", "runtime-dep")), "npm ci installed the dependencies");
  assert.ok(!present(path.join(v2Dir, "node_modules", "dev-dep")), "but not the development ones");
  // Git for Windows may check out CRLF; the WSL source the installer uses doesn't.
  const rootLauncher = () => fs.readFileSync(path.join(root, "start-direct-workbench.cmd"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(rootLauncher(), "rem launcher of 0.2.0\n");
  assert.ok(!fs.existsSync(path.join(root, "notes.txt")), "only launchers are copied");

  assert.match(ok("v0.2.0"), /v0\.2\.0 is already installed[\s\S]*unchanged/);
  ok("v0.1.0");
  assert.equal(current(), "v0.1.0");
  assert.equal(previous(), "v0.2.0");
  assert.equal(rootLauncher(), "rem launcher of 0.1.0\n");

  ok("--previous");
  assert.equal(current(), "v0.2.0", "back to the version before");
  assert.equal(previous(), "v0.1.0", "and once more returns");

  ok("v0.3.0-rc.1");
  assert.equal(current(), "v0.3.0-rc.1");
  assert.equal(fs.readFileSync(path.join(root, "versions", "v0.3.0-rc.1", ".release.json"), "utf8").includes(rc), true);
  assert.deepEqual(versions(), ["v0.1.0", "v0.2.0", "v0.3.0-rc.1"]);

  ok("--ref", "HEAD", "--name", "main-test");
  assert.equal(current(), "main-test");
  assert.equal(previous(), "v0.3.0-rc.1");
  assert.deepEqual(versions(), ["main-test", "v0.2.0", "v0.3.0-rc.1"], "the least recently used version goes (v0.1.0, though installed after v0.2.0)");

  const moved = install("--ref", "v0.1.0", "--name", "main-test");
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, new RegExp(`main-test is installed from ${head.slice(0, 12)}, not ${v1.slice(0, 12)}; pass --force`));
  const reinstallCurrent = install("--ref", "v0.1.0", "--name", "main-test", "--force");
  assert.equal(reinstallCurrent.status, 1);
  assert.match(reinstallCurrent.stderr, /is the current version; switch to another before reinstalling it/);
  assert.equal(install("no-such-tag").status, 1);
  assert.match(install("--ref", "HEAD", "--name", "../escape").stderr, /can't name a version folder/);

  // A forced reinstall of the rollback version that fails leaves it as it was.
  const releaseOf = (name) => JSON.parse(fs.readFileSync(path.join(root, "versions", name, ".release.json"), "utf8"));
  const failedForce = install("--ref", "broken", "--name", "v0.3.0-rc.1", "--force");
  assert.equal(failedForce.status, 1, failedForce.stdout + failedForce.stderr);
  assert.equal(releaseOf("v0.3.0-rc.1").commit, rc, "the previous version survives a failed reinstall");
  assert.equal(current(), "main-test");
  assert.equal(previous(), "v0.3.0-rc.1");

  // The fixture has no origin: without --offline an update stops rather than
  // take the newest local tag for the newest release; --list only warns.
  const script = path.join(repo, "scripts", "release-install.mjs");
  const unfetched = spawnSync(process.execPath, [script, "--no-start"], { env, encoding: "utf8", timeout: 120000 });
  assert.equal(unfetched.status, 1);
  assert.match(unfetched.stderr, /Couldn't fetch tags from origin [\s\S]*--offline uses the tags the checkout already has/);
  assert.equal(current(), "main-test");
  const listed = spawnSync(process.execPath, [script, "--list"], { env, encoding: "utf8", timeout: 120000 });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /warning: couldn't fetch tags/);

  const list = ok("--list");
  assert.match(list, /installed main-test [0-9a-f]{12} .* \(current\)/);
  assert.match(list, /installed v0\.3\.0-rc\.1 [0-9a-f]{12} .* \(previous\)/);
  assert.match(list, /tags: v0\.1\.0 v0\.2\.0 v0\.3\.0-rc\.1/);

  // One that succeeds replaces it, and leaves no staging folders behind.
  ok("--ref", "v0.1.0", "--name", "v0.3.0-rc.1", "--force");
  assert.equal(releaseOf("v0.3.0-rc.1").commit, v1);
  assert.equal(current(), "v0.3.0-rc.1");
  assert.equal(previous(), "main-test");
  assert.ok(!versions().some((name) => name.endsWith(".partial") || name.endsWith(".replaced")), versions().join(" "));

  // Hold the first real installer inside npm's lifecycle hook. A second
  // installer must refuse before touching its staging directory or pointers.
  const waitingPackage = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  waitingPackage.scripts = { install: "node install-wait.cjs" };
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify(waitingPackage));
  fs.writeFileSync(path.join(source, "install-wait.cjs"), `
const fs = require("node:fs");
fs.writeFileSync(process.env.RELEASE_TEST_READY, "ready");
const timer = setInterval(() => {
  if (fs.existsSync(process.env.RELEASE_TEST_CONTINUE)) clearInterval(timer);
}, 20);
setTimeout(() => process.exit(2), 30000).unref();
`);
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "waiting install fixture");
  const concurrentRoot = path.join(temp, "concurrent releases");
  const ready = path.join(temp, "install-ready");
  const proceed = path.join(temp, "install-continue");
  const concurrentEnv = { ...env, CODEX_REVIEW_SHELL_RELEASE_ROOT: concurrentRoot, RELEASE_TEST_READY: ready, RELEASE_TEST_CONTINUE: proceed };
  const first = spawn(process.execPath, [script, "--offline", "--no-start", "--ref", "HEAD", "--name", "slow"], { env: concurrentEnv, stdio: ["ignore", "pipe", "pipe"] });
  let firstOutput = "";
  first.stdout.on("data", (chunk) => { firstOutput += chunk; });
  first.stderr.on("data", (chunk) => { firstOutput += chunk; });
  const firstDone = new Promise((resolve, reject) => {
    first.on("error", reject);
    first.on("close", resolve);
  });
  try {
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(ready), `the first installer entered npm: ${firstOutput}`);
    const second = spawnSync(process.execPath, [script, "--offline", "--no-start", "v0.1.0"], { env: concurrentEnv, encoding: "utf8", timeout: 15000 });
    assert.equal(second.status, 1, second.stdout + second.stderr);
    assert.match(second.stderr, /Another release install owns/);
    assert.ok(fs.existsSync(path.join(concurrentRoot, "versions", "slow.partial", "package.json")), "the active staging folder survives");
    assert.equal(fs.existsSync(path.join(concurrentRoot, "current.txt")), false, "the refused installer changes no pointers");
    fs.writeFileSync(proceed, "continue");
    assert.equal(await firstDone, 0, firstOutput);
    assert.equal(fs.readFileSync(path.join(concurrentRoot, "current.txt"), "utf8").trim(), "slow");
    const after = spawnSync(process.execPath, [script, "--offline", "--no-start", "v0.1.0"], { env: concurrentEnv, encoding: "utf8", timeout: 15000 });
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.equal(fs.existsSync(path.join(concurrentRoot, ".release-install.lock")), false);
  } finally {
    fs.writeFileSync(proceed, "continue");
    await firstDone;
  }

  console.log("direct release install regression passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
