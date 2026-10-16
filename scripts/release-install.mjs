#!/usr/bin/env node
// Installs a tagged version of the app for daily use. Versions sit side by
// side under the release root, each a full copy of its tag with its own
// production dependencies; current.txt names the one the launcher starts.
// The daily app changes only here, never on launch (the WSL mirror launcher
// stays for development).
//
//   node scripts/release-install.mjs [TAG]     install TAG (default: the newest v* tag) and switch to it
//   node scripts/release-install.mjs --previous   switch back to the version before
//   node scripts/release-install.mjs --list       installed versions and tags
//   options: --ref REF --name NAME (install any commit under a name, for testing),
//            --force (reinstall), --offline (don't fetch tags), --no-start
//
// Release root: CODEX_REVIEW_SHELL_RELEASE_ROOT, default C:\LexLattice\direct-workbench.
// Source: the WSL checkout (CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO, _WSL_PATH)
// through wsl.exe; elsewhere CODEX_REVIEW_SHELL_RELEASE_SOURCE, a local checkout.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const RELEASE_FILE = ".release.json";
const GENERATION_FILE = ".sync-generation.txt";
const KEEP_VERSIONS = 3;
const PARTIAL_SUFFIX = ".partial";
const REPLACED_SUFFIX = ".replaced";
const VERSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const INSTALL_LOCK_FILE = ".release-install.lock";

// A PID can outlive its original owner through reuse. Linux start ticks are
// relative to a boot, while Windows/macOS expose a dated process start time.
// Unknown identity is never evidence that another installer has exited.
function processStartIdentity(pid, { platform = process.platform, readFile = fs.readFileSync, run = spawnSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (platform === "linux") {
      const boot = readFile("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFile(`/proc/${pid}/stat`, "utf8");
      // comm (field 2) can contain spaces and closing parentheses.
      const start = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boot) && /^\d+$/.test(start || "") ? `linux:${boot}:${start}` : null;
    }
    let command;
    let args;
    if (platform === "win32") {
      command = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ([System.Diagnostics.Process]::GetProcessById(${pid})).StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)`];
    } else if (platform === "darwin") {
      command = "/bin/ps";
      args = ["-p", String(pid), "-o", "lstart="];
    } else return null;
    const result = run(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: 65536, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
    if (result.error || result.status !== 0) return null;
    const start = String(result.stdout || "").trim();
    const valid = platform === "win32" ? /^[1-9]\d*$/.test(start) : /^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/.test(start);
    return valid ? `${platform}:${start}` : null;
  } catch {
    return null;
  }
}

// Publish a populated directory atomically: rename cannot replace another
// owner's nonempty lock directory. Recovery renames a dead claim into a
// permanent, nonempty tombstone keyed by its token. Two stale observers
// target the same tombstone, so the second cannot move a newly acquired
// lock after the first has recovered it. No separate recovery lock can be
// stranded by a crash. Ordinary release also renames before deleting.
function acquireInstallLock(root) {
  const startIdentity = processStartIdentity(process.pid);
  if (!startIdentity) throw new Error("Cannot determine installer process identity; release root was not locked. Retry when process metadata is available.");
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, INSTALL_LOCK_FILE);
  const claimsDir = path.join(root, ".release-install-locks");
  fs.mkdirSync(claimsDir, { recursive: true });
  const token = randomUUID();
  const claimPath = path.join(claimsDir, token);
  const ownerFile = "owner.json";
  const busy = () => new Error(`Another release install owns ${lockPath}. Wait for it to finish and retry.`);
  const readOwner = () => {
    try { return JSON.parse(fs.readFileSync(path.join(lockPath, ownerFile), "utf8")); } catch { return null; }
  };
  const ownerIsDead = (owner) => {
    if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || !/^[A-Za-z0-9_-]{1,100}$/.test(owner.token || "")) return false;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      return error.code === "ESRCH";
    }
    if (typeof owner.startIdentity !== "string" || !owner.startIdentity.startsWith(`${process.platform}:`)) return false;
    const currentIdentity = processStartIdentity(owner.pid);
    return currentIdentity !== null && currentIdentity !== owner.startIdentity;
  };
  fs.mkdirSync(claimPath);
  try {
    fs.writeFileSync(path.join(claimPath, ownerFile), `${JSON.stringify({ pid: process.pid, token, startIdentity })}\n`, { mode: 0o600 });
    if (fs.existsSync(lockPath)) {
      const owner = readOwner();
      if (!ownerIsDead(owner)) throw busy();
      try {
        fs.renameSync(lockPath, path.join(claimsDir, `recovered-${owner.token}`));
      } catch (error) {
        if (error.code !== "ENOENT") throw busy();
      }
    }
    try {
      fs.renameSync(claimPath, lockPath);
    } catch (error) {
      if (fs.existsSync(lockPath)) throw busy();
      throw error;
    }
  } finally {
    fs.rmSync(claimPath, { recursive: true, force: true });
  }
  return () => {
    if (readOwner()?.token !== token) return;
    fs.renameSync(lockPath, claimPath);
    fs.rmSync(claimPath, { recursive: true, force: true });
  };
}

// "v0.5.0" -> [0, 5, 0]; prereleases ("v0.5.0-rc.1") sort before the release.
function parseReleaseTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(tag || ""));
  return match ? { tag, numbers: match.slice(1, 4).map(Number), prerelease: match[4] || "" } : null;
}

function compareReleaseTags(left, right) {
  const a = parseReleaseTag(left);
  const b = parseReleaseTag(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function latestReleaseTag(tags, { prereleases = false } = {}) {
  const candidates = tags.filter((tag) => {
    const parsed = parseReleaseTag(tag);
    return parsed && (prereleases || !parsed.prerelease);
  });
  return candidates.sort(compareReleaseTags).at(-1) || "";
}

const lastUsed = (release) => String(release.lastCurrentAt || release.installedAt || "");

// installed: [{ name, installedAt, lastCurrentAt }]. Keeps the current and
// previous versions and the most recently used others, KEEP_VERSIONS in all.
function versionsToPrune(installed, { current = "", previous = "", keep = KEEP_VERSIONS } = {}) {
  const kept = new Set([current, previous].filter(Boolean));
  const newestFirst = [...installed].sort((a, b) => lastUsed(b).localeCompare(lastUsed(a)));
  for (const version of newestFirst) {
    if (kept.size >= keep) break;
    kept.add(version.name);
  }
  return installed.map((version) => version.name).filter((name) => !kept.has(name));
}

function parseArgs(argv) {
  const options = { tag: "", ref: "", name: "", previous: false, list: false, force: false, offline: false, start: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--previous") options.previous = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--no-start") options.start = false;
    else if (arg === "--ref") options.ref = argv[++index] || "";
    else if (arg === "--name") options.name = argv[++index] || "";
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else options.tag = arg;
  }
  return options;
}

const log = (message) => console.log(`[release] ${message}`);

function releaseRoot(env = process.env) {
  const configured = String(env.CODEX_REVIEW_SHELL_RELEASE_ROOT || "").trim();
  return path.resolve(configured || "C:\\LexLattice\\direct-workbench");
}

function gitInvocation(args, env = process.env, platform = process.platform) {
  if (platform === "win32" && !env.CODEX_REVIEW_SHELL_RELEASE_SOURCE) {
    const distro = String(env.CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO || "Ubuntu").trim();
    const wslPath = String(env.CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH || "/home/rose/work/LexLattice/codex-review-shell-direct").trim();
    const wsl = path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "wsl.exe");
    // --exec, not --: after -- wsl.exe hands the command line to the Linux
    // shell, which expanded "v*" (git tag --list) against the files in the
    // current folder.
    return { command: fs.existsSync(wsl) ? wsl : "wsl.exe", args: ["-d", distro, "--exec", "git", "-C", wslPath, ...args] };
  }
  const source = String(env.CODEX_REVIEW_SHELL_RELEASE_SOURCE || "").trim();
  if (!source) throw new Error("Set CODEX_REVIEW_SHELL_RELEASE_SOURCE to the checkout to install from.");
  return { command: "git", args: ["-C", source, ...args] };
}

// stdin closed and a time limit: a fetch that wants a password fails
// instead of waiting for input nobody sees.
function git(args, { allowFailure = false, timeoutMs = 120000 } = {}) {
  const { command, args: fullArgs } = gitInvocation(args);
  const run = spawnSync(command, fullArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  if (run.error?.code === "ETIMEDOUT") throw new Error(`git ${args.join(" ")} didn't finish within ${timeoutMs / 1000} s.`);
  if (run.error) throw new Error(`Couldn't run ${command}: ${run.error.message}`);
  if (run.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${(run.stderr || run.error?.message || "").trim()}`);
  }
  return run.status === 0 ? String(run.stdout || "").trim() : "";
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function installedVersions(versionsDir) {
  if (!fs.existsSync(versionsDir)) return [];
  return fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL_SUFFIX) && !entry.name.endsWith(REPLACED_SUFFIX))
    .map((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(versionsDir, entry.name, RELEASE_FILE), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((release) => release && VERSION_NAME.test(release.name || ""));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args[0] || ""} exited with ${code}.`))));
  });
}

// git archive COMMIT | tar -x, into dir.
function extractCommit(commit, dir) {
  const { command, args } = gitInvocation(["archive", "--format=tar", commit]);
  const tarCommand = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  return new Promise((resolve, reject) => {
    const archive = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn(tarCommand, ["-x", "-f", "-", "-C", dir], { stdio: ["pipe", "inherit", "pipe"] });
    let errors = "";
    archive.stderr.on("data", (chunk) => { errors += chunk; });
    tar.stderr.on("data", (chunk) => { errors += chunk; });
    archive.stdout.pipe(tar.stdin);
    let pending = 2;
    let failed = false;
    const done = (name) => (code) => {
      if (code !== 0 && !failed) {
        failed = true;
        reject(new Error(`${name} exited with ${code}: ${errors.trim()}`));
      }
      pending -= 1;
      if (!pending && !failed) resolve();
    };
    archive.on("error", reject);
    tar.on("error", reject);
    archive.on("exit", done("git archive"));
    tar.on("exit", done("tar"));
  });
}

function npmInvocation(args) {
  // npm.cmd can't be spawned without a shell on Windows; its CLI script can.
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(cli)) return { command: process.execPath, args: [cli, ...args] };
  return { command: "npm", args };
}

// Windows may hold fresh files open for a moment (virus scanning, indexing).
function removeDir(dir, { required = true } = {}) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch (error) {
    if (required) throw error;
    log(`couldn't remove ${dir} (${error.code || error.message}); the next update tries again`);
    return false;
  }
}

async function renameDir(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= 20 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function installVersion({ versionsDir, name, commit, label }) {
  const finalDir = path.join(versionsDir, name);
  const partialDir = path.join(versionsDir, `${name}${PARTIAL_SUFFIX}`);
  removeDir(partialDir);
  fs.mkdirSync(partialDir, { recursive: true });
  log(`extracting ${label} (${commit.slice(0, 12)})`);
  await extractCommit(commit, partialDir);
  log("installing production dependencies (npm ci --omit=dev)");
  const npm = npmInvocation(["ci", "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline"]);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Install scripts (electron's) run "node" through cmd.exe, which finds
  // nothing on a PATH over its 8191-character limit: put Node first and
  // drop repeated entries.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  const seen = new Set();
  env[pathKey] = [path.dirname(process.execPath), ...String(env[pathKey] || "").split(path.delimiter)]
    .filter((entry) => {
      const key = process.platform === "win32" ? entry.replace(/[\\/]+$/, "").toLowerCase() : entry;
      if (!entry || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(path.delimiter);
  await run(npm.command, npm.args, { cwd: partialDir, env });
  const packageVersion = JSON.parse(fs.readFileSync(path.join(partialDir, "package.json"), "utf8")).version || "";
  const tagVersion = parseReleaseTag(name)?.numbers.join(".");
  if (tagVersion && packageVersion !== tagVersion && !name.includes("-")) {
    log(`note: package.json says ${packageVersion}, the tag ${name}`);
  }
  // What a running app reports over the control channel: the launcher
  // restarts an app whose version isn't current.
  fs.writeFileSync(path.join(partialDir, GENERATION_FILE), `release ${name} ${commit}\n`);
  fs.writeFileSync(path.join(partialDir, RELEASE_FILE), `${JSON.stringify({
    schema: "codex_review_shell_release@1",
    name,
    commit,
    packageVersion,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  // A forced reinstall keeps the old copy until the new one is complete
  // and in place: it may be the version a rollback returns to.
  const replacedDir = path.join(versionsDir, `${name}${REPLACED_SUFFIX}`);
  const replacing = fs.existsSync(finalDir);
  if (replacing) {
    removeDir(replacedDir);
    await renameDir(finalDir, replacedDir);
  }
  try {
    await renameDir(partialDir, finalDir);
  } catch (error) {
    if (replacing) await renameDir(replacedDir, finalDir);
    throw error;
  }
  if (replacing) removeDir(replacedDir, { required: false });
}

function copyLaunchers(versionDir, root) {
  const templates = path.join(versionDir, "release");
  if (!fs.existsSync(templates)) return [];
  const copied = [];
  for (const name of fs.readdirSync(templates)) {
    if (!/\.(cmd|vbs)$/i.test(name)) continue;
    fs.copyFileSync(path.join(templates, name), path.join(root, name));
    copied.push(name);
  }
  return copied;
}

function startApp(root) {
  if (process.platform !== "win32") return;
  const launcher = path.join(root, "start-direct-workbench.vbs");
  if (!fs.existsSync(launcher)) return;
  const child = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe"), [launcher], { detached: true, stdio: "ignore" });
  child.unref();
}

async function main(argv) {
  const options = parseArgs(argv);
  const root = releaseRoot();
  const unlock = options.list ? () => {} : acquireInstallLock(root);
  try {
    await install(options, root);
  } finally {
    unlock();
  }
}

async function install(options, root) {
  const versionsDir = path.join(root, "versions");
  const currentFile = path.join(root, "current.txt");
  const previousFile = path.join(root, "previous.txt");
  const current = readText(currentFile);
  const previous = readText(previousFile);
  fs.mkdirSync(versionsDir, { recursive: true });

  // Without the fetch, "newest tag" means newest known here, which may be
  // an older release: an update stops; --list only warns.
  if (!options.offline && !options.previous) {
    try {
      git(["fetch", "--tags", "--quiet", "origin"], { timeoutMs: 60000 });
    } catch (error) {
      const message = `couldn't fetch tags from origin (${error.message}); --offline uses the tags the checkout already has`;
      if (!options.list) throw new Error(message.replace(/^c/, "C"));
      log(`warning: ${message}`);
    }
  }

  if (options.list) {
    for (const release of installedVersions(versionsDir).sort((a, b) => String(a.installedAt).localeCompare(String(b.installedAt)))) {
      const mark = release.name === current ? " (current)" : release.name === previous ? " (previous)" : "";
      console.log(`installed ${release.name} ${String(release.commit).slice(0, 12)} ${release.installedAt}${mark}`);
    }
    const tags = git(["tag", "--list", "v*"], { allowFailure: true }).split(/\r?\n/).filter(Boolean);
    console.log(`tags: ${tags.sort((a, b) => (parseReleaseTag(a) && parseReleaseTag(b) ? compareReleaseTags(a, b) : a.localeCompare(b))).join(" ") || "none"}`);
    return;
  }

  let name;
  if (options.previous) {
    name = previous;
    if (!name || !fs.existsSync(path.join(versionsDir, name, RELEASE_FILE))) throw new Error("There is no previous version to go back to.");
    log(`switching back to ${name}`);
  } else {
    let ref = options.ref || options.tag;
    if (!ref) {
      ref = latestReleaseTag(git(["tag", "--list", "v*"]).split(/\r?\n/).filter(Boolean));
      if (!ref) throw new Error("No release tag (v*) found. Tag a commit on main, or pass --ref.");
    }
    name = options.name || ref;
    if (!VERSION_NAME.test(name) || name.endsWith(PARTIAL_SUFFIX) || name.endsWith(REPLACED_SUFFIX)) throw new Error(`"${name}" can't name a version folder; pass --name.`);
    const commit = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true });
    if (!commit) throw new Error(`${ref} isn't a tag or commit in the source checkout.`);
    const existing = installedVersions(versionsDir).find((release) => release.name === name);
    if (existing && existing.commit !== commit && !options.force) {
      throw new Error(`${name} is installed from ${existing.commit.slice(0, 12)}, not ${commit.slice(0, 12)}; pass --force to replace it.`);
    }
    if (!existing || options.force) {
      if (existing) {
        if (name === current) throw new Error(`${name} is the current version; switch to another before reinstalling it.`);
      }
      await installVersion({ versionsDir, name, commit, label: ref });
    } else {
      log(`${name} is already installed`);
    }
  }

  const versionDir = path.join(versionsDir, name);
  const launchers = copyLaunchers(versionDir, root);
  if (launchers.length) log(`launchers: ${launchers.join(", ")}`);
  if (name !== current) {
    const releaseFile = path.join(versionDir, RELEASE_FILE);
    const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
    fs.writeFileSync(releaseFile, `${JSON.stringify({ ...release, lastCurrentAt: new Date().toISOString() }, null, 2)}\n`);
    if (current) fs.writeFileSync(previousFile, `${current}\n`);
    fs.writeFileSync(currentFile, `${name}\n`);
    log(`current version: ${name}${current ? ` (was ${current})` : ""}`);
  } else {
    log(`current version: ${name} (unchanged)`);
  }

  const nowPrevious = readText(previousFile);
  for (const stale of versionsToPrune(installedVersions(versionsDir), { current: name, previous: nowPrevious })) {
    log(`removing ${stale}`);
    removeDir(path.join(versionsDir, stale), { required: false });
  }
  for (const entry of fs.readdirSync(versionsDir)) {
    if (entry.endsWith(PARTIAL_SUFFIX) || entry.endsWith(REPLACED_SUFFIX)) removeDir(path.join(versionsDir, entry), { required: false });
  }

  if (options.start) {
    // The launcher restarts a running app on another version and starts one
    // if none runs.
    log("starting it");
    startApp(root);
  }
}

export { acquireInstallLock, compareReleaseTags, gitInvocation, latestReleaseTag, parseArgs, parseReleaseTag, processStartIdentity, versionsToPrune };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[release] ${error.message}`);
    process.exit(1);
  });
}
