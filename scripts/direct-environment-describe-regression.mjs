#!/usr/bin/env node

// Turn 1 of the dual-environment track: executor `environment/describe` and
// the host environment registry. Runs on either host:
//   Linux/WSL:  node scripts/direct-environment-describe-regression.mjs
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-environment-describe-regression.mjs
// On each host it describes every launchable environment through its real
// executor, so one run per host covers both directions.

import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  EXECUTOR_METHODS,
  describeExecutionEnvironment,
  findExecutableOnPath,
  publicEnvironmentDescription,
  validateEnvironmentDescription,
} = require("../src/shared/executor-protocol");
const {
  DirectEnvironmentRegistry,
  decodeWslListOutput,
  parseWslDistroNames,
} = require("../src/main/environment-registry");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");

const report = { schema: "direct_environment_describe_regression_report@1", hostPlatform: process.platform, checks: [], described: [] };

// 1. `wsl.exe -l -q` output decoding: UTF-16LE with and without BOM, UTF-8.
const utf16 = Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le");
assert.deepEqual(parseWslDistroNames(utf16), ["Ubuntu", "docker-desktop"]);
assert.deepEqual(parseWslDistroNames(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])), ["Ubuntu", "docker-desktop"]);
assert.deepEqual(parseWslDistroNames(Buffer.from("Debian\nUbuntu-24.04\n", "utf8")), ["Debian", "Ubuntu-24.04"]);
assert.deepEqual(parseWslDistroNames(Buffer.alloc(0)), []);
assert.equal(decodeWslListOutput("plain"), "plain");
report.checks.push("wsl_list_decoding");

// 2. Pure describe: Windows facts without spawning anything.
const windowsFiles = new Set([
  "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
]);
const windowsDescription = describeExecutionEnvironment({
  platform: "win32",
  env: { PATH: "C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32", PATHEXT: ".EXE;.CMD", SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files" },
  fileExists: (candidate) => windowsFiles.has(candidate),
  release: "10.0.26100",
  homedir: "C:\\Users\\fixture",
  tmpdir: "C:\\Users\\fixture\\AppData\\Local\\Temp",
  containment: { available: false, kind: "unavailable", blockerCode: "workspace_windows_job_object_containment_unavailable" },
});
assert.deepEqual(validateEnvironmentDescription(windowsDescription), []);
assert.equal(windowsDescription.environmentKind, "windows");
assert.equal(windowsDescription.shell.name, "powershell");
assert.equal(windowsDescription.shell.flavor, "pwsh");
assert.equal(windowsDescription.shell.version, "7");
assert.equal(windowsDescription.pathStyle, "windows");
assert.equal(windowsDescription.defaultLineEnding, "crlf");
assert.equal(windowsDescription.capabilities.sandbox.available, false);

// Without pwsh, Windows PowerShell 5.1 is the shell.
windowsFiles.delete("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
const legacyWindows = describeExecutionEnvironment({
  platform: "win32",
  env: { PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows" },
  fileExists: (candidate) => windowsFiles.has(candidate),
  release: "10.0.19045",
});
assert.equal(legacyWindows.shell.flavor, "windows-powershell");
assert.equal(legacyWindows.shell.version, "5.1");

// 3. Pure describe: WSL facts.
const wslDescription = describeExecutionEnvironment({
  platform: "linux",
  env: { PATH: "/usr/local/bin:/usr/bin:/bin", WSL_DISTRO_NAME: "Ubuntu" },
  fileExists: (candidate) => ["/bin/bash", "/usr/bin/bwrap"].includes(candidate),
  release: "6.6.87.2-microsoft-standard-WSL2",
  homedir: "/home/fixture",
  tmpdir: "/tmp",
  containment: { available: true, kind: "linux_pid_namespace" },
});
assert.deepEqual(validateEnvironmentDescription(wslDescription), []);
assert.equal(wslDescription.environmentKind, "wsl");
assert.equal(wslDescription.distro, "Ubuntu");
assert.equal(wslDescription.shell.name, "bash");
assert.equal(wslDescription.pathStyle, "posix");
assert.equal(wslDescription.capabilities.sandbox.kind, "bubblewrap");
assert.equal(findExecutableOnPath("bwrap", {
  platform: "linux",
  env: { PATH: "/usr/bin" },
  fileExists: (candidate) => candidate === "/usr/bin/bwrap",
}), "/usr/bin/bwrap");

// Public projection carries no raw paths.
const publicWsl = publicEnvironmentDescription(wslDescription);
assert.equal(publicWsl.rawPathIncluded, false);
assert.equal(JSON.stringify(publicWsl).includes("/home/fixture"), false);
assert.equal(publicWsl.shell.executable, "bash");
const publicWindows = publicEnvironmentDescription(windowsDescription);
assert.equal(JSON.stringify(publicWindows).includes("fixture"), false);
assert.equal(publicWindows.shell.executable, "pwsh.exe");

// Validation rejects inconsistent descriptions.
assert(validateEnvironmentDescription({ ...windowsDescription, shell: { name: "bash" } }).includes("environment_description_windows_inconsistent"));
assert(validateEnvironmentDescription({ ...wslDescription, pathStyle: "windows" }).includes("environment_description_posix_inconsistent"));
assert.deepEqual(validateEnvironmentDescription({ schema: "other" }), ["environment_description_schema_mismatch"]);
report.checks.push("pure_describe");

// 4. Registry discovery with injected listings.
const fakeExec = (stdout) => (_command, _args, _options, callback) => callback(null, stdout);
const fromWindows = new DirectEnvironmentRegistry({
  platform: "win32",
  env: {},
  execFileImpl: fakeExec(Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le")),
});
const windowsDiscovery = await fromWindows.discover();
assert.deepEqual(windowsDiscovery.environments.map((environment) => environment.environmentId), ["windows", "wsl:Ubuntu", "wsl:docker-desktop"]);
assert.equal(windowsDiscovery.environments.find((environment) => environment.environmentId === "wsl:Ubuntu").launch.transport, "wsl.exe");
assert.equal(windowsDiscovery.environments.find((environment) => environment.environmentId === "wsl:docker-desktop").system, true);

const fromWsl = new DirectEnvironmentRegistry({
  platform: "linux",
  env: { WSL_DISTRO_NAME: "Ubuntu" },
  fileExists: () => false,
  execFileImpl: (_command, _args, _options, callback) => callback(Object.assign(new Error("missing"), { code: "ENOENT" })),
});
const wslDiscovery = await fromWsl.discover();
assert.equal(wslDiscovery.wslListing.ok, false);
assert.deepEqual(wslDiscovery.environments.map((environment) => environment.environmentId), ["windows", "wsl:Ubuntu"]);
assert.equal(wslDiscovery.environments[0].launch.available, false, "no Windows node means no Windows executor from WSL");
assert.equal(wslDiscovery.environments[1].launch.transport, "local-child");
await assert.rejects(() => fromWsl.describe("wsl:Missing"), (error) => error.code === "direct_environment_registry_backends_unavailable");
report.checks.push("registry_discovery");

// 5. Live: describe every launchable, non-system environment from this host
// through its real executor.
const manager = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
const registry = new DirectEnvironmentRegistry({ workspaceBackends: manager });
try {
  const discovery = await registry.discover();
  const launchable = discovery.environments.filter((environment) => environment.launch.available && !environment.system);
  assert(launchable.length >= 1, "at least the host environment must be launchable");
  for (const environment of launchable) {
    const { description } = await registry.describe(environment.environmentId);
    assert.deepEqual(validateEnvironmentDescription(description), []);
    assert(description.methods.includes(EXECUTOR_METHODS.environmentDescribe));
    if (environment.kind === "windows") {
      assert.equal(description.environmentKind, "windows");
      assert.equal(description.shell.name, "powershell");
      assert.equal(description.pathStyle, "windows");
      assert.equal(description.os.platform, "win32");
    }
    if (environment.kind === "wsl") {
      assert.equal(description.environmentKind, "wsl");
      assert.equal(description.distro, environment.distro);
      assert.equal(description.shell.name, "bash");
      assert.equal(description.pathStyle, "posix");
      assert.equal(description.os.platform, "linux");
    }
    report.described.push({
      environmentId: environment.environmentId,
      transport: environment.launch.transport,
      shell: `${description.shell.flavor}${description.shell.version ? ` ${description.shell.version}` : ""}`,
      containment: description.capabilities.processContainment.kind,
      sandbox: description.capabilities.sandbox.kind,
    });
    // Probe executors are disposed after describing; nothing stays running.
    assert.equal(manager.sessions.size, 0);
  }
  const snapshot = registry.publicSnapshot();
  assert.equal(snapshot.rawPathIncluded, false);
  assert.equal(JSON.stringify(snapshot).includes(repoRoot), false);
  report.checks.push("live_executor_describe");
} finally {
  manager.disposeAll();
}

report.status = "passed";
console.log(JSON.stringify(report));
