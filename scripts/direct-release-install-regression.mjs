#!/usr/bin/env node
// The daily app's installer (scripts/release-install.mjs) against a fixture
// checkout: tag choice, side-by-side versions, switching back, pruning; and
// the release launchers it copies into the release root.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareReleaseTags,
  latestReleaseTag,
  parseArgs,
  parseReleaseTag,
  versionsToPrune,
} from "./release-install.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repo, relativePath), "utf8");

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
assert.match(releaseLauncher, /\$_\.ExecutablePath -like \(\$env:RELEASE_VERSIONS \+ '\*'\)/, "only this release root's hung apps are stopped");
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

  const list = ok("--list");
  assert.match(list, /installed main-test [0-9a-f]{12} .* \(current\)/);
  assert.match(list, /installed v0\.3\.0-rc\.1 [0-9a-f]{12} .* \(previous\)/);
  assert.match(list, /tags: v0\.1\.0 v0\.2\.0 v0\.3\.0-rc\.1/);
  assert.ok(!versions().some((name) => name.endsWith(".partial")));

  console.log("direct release install regression passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
