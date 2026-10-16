#!/usr/bin/env node

// The Codex exec-server backend for Direct commands and file tools, against a
// scripted exec-server connection: the requests it sends (paths, sandbox,
// environment), how it maps exec-server's events and gaps onto the process
// handle contract, and the file port's profile checks. The live comparison
// with Direct's executor is scripts/direct-exec-backend-benchmark.mjs.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CodexExecServerManager,
  execServerEnvironmentFor,
  execServerLaunchSpec,
  execServerSandboxFor,
  execServerSandboxForSession,
  execUriToPath,
  pathToExecUri,
  posixExecServerScript,
  versionAtLeast,
  wslMountPathFor,
} = require("../src/main/direct/tools/codex-exec-server.js");
const {
  CodexExecServerFilePort,
  CodexExecServerProcessBackend,
  CodexExecServerProcessHandle,
  commandEnvironmentAdditions,
} = require("../src/main/direct/tools/codex-exec-server-backend.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment.js");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant.js");

const tick = () => new Promise((resolve) => setImmediate(resolve));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const missing = () => Object.assign(new Error("No such file or directory (os error 2)"), { rpcCode: -32004 });
const denied = () => Object.assign(new Error("Permission denied (os error 13)"), { rpcCode: -32600 });

const ROOT = "/synthetic/ws";
const project = { id: "exec_server_fixture", workspace: { kind: "local", localPath: ROOT } };
const INFO = { executorVersion: "0.160.0", platformOs: "linux", userHomeDir: "file:///home/u", shell: { name: "bash", path: "/bin/bash" } };

// A handler returning TIMEOUT makes the request time out; the late answer
// can then be delivered through `late[method]`.
const TIMEOUT = Symbol("timeout");

class FakeConnection extends EventEmitter {
  constructor(handlers = {}) {
    super();
    this.calls = [];
    this.handlers = handlers;
    this.state = "ready";
    this.environmentInfo = INFO;
    this.late = {};
    this.closeCalls = 0;
  }

  async request(method, params, _timeoutMs, options = {}) {
    this.calls.push({ method, params: clone(params) });
    const handler = this.handlers[method];
    if (!handler) return {};
    const result = await handler(params, this);
    if (result === TIMEOUT) {
      if (options.onLate) this.late[method] = options.onLate;
      throw Object.assign(new Error(`timed out: ${method}`), { code: "direct_codex_exec_server_timeout" });
    }
    return result;
  }

  close() {
    this.closeCalls += 1;
  }
}

function fakeManager(connection) {
  const environment = execServerEnvironmentFor(project, { hostPlatform: "linux", env: {} });
  const queuedScratch = [];
  return {
    environment,
    queuedScratch,
    environmentFor: () => environment,
    connectionFor: async () => ({ connection, environment, info: INFO }),
    queueScratchCleanup: (key, dir) => queuedScratch.push([key, dir]),
  };
}

await check("paths become exec-server file URIs and back", async () => {
  assert.equal(pathToExecUri("/tmp/a b/c#d", "linux"), "file:///tmp/a%20b/c%23d");
  assert.equal(execUriToPath("file:///tmp/a%20b/c%23d", "linux"), "/tmp/a b/c#d");
  assert.equal(pathToExecUri("C:\\Users\\u\\My Project", "win32"), "file:///C:/Users/u/My%20Project");
  assert.equal(execUriToPath("file:///C:/Users/u/My%20Project", "win32"), "C:\\Users\\u\\My Project");
  assert.equal(execUriToPath("file:///home/u", "linux"), "/home/u");
});

await check("environments: local, WSL from Windows, and the unsupported directions", async () => {
  assert.deepEqual(execServerEnvironmentFor(project, { hostPlatform: "linux", env: {} }), {
    key: "local", kind: "local", platform: "linux", distro: "", root: ROOT, local: true,
  });
  const wsl = { id: "p", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/u/p" } };
  assert.deepEqual(execServerEnvironmentFor(wsl, { hostPlatform: "win32", env: {} }), {
    key: "wsl:Ubuntu", kind: "wsl", platform: "linux", distro: "Ubuntu", root: "/home/u/p", local: false,
  });
  assert.equal(execServerEnvironmentFor(wsl, { hostPlatform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }).key, "local");
  assert.throws(
    () => execServerEnvironmentFor({ workspace: { kind: "windows", windowsPath: "C:\\p" } }, { hostPlatform: "linux", env: {} }),
    (error) => error.code === "direct_codex_exec_server_environment_unsupported",
  );
  assert.deepEqual(execServerEnvironmentFor({ workspace: { kind: "windows", windowsPath: "C:\\p" } }, { hostPlatform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), {
    key: "windows", kind: "windows", platform: "win32", distro: "", root: "C:\\p", local: false,
  });
});

await check("from WSL, Windows' native codex.exe runs through interop with only what interop needs", async () => {
  const npm = "C:\\Users\\u\\AppData\\Roaming\\npm";
  const exe = `${npm}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  assert.equal(wslMountPathFor(exe).startsWith("/mnt/c/Users/u/AppData/Roaming/npm/node_modules/"), true);
  assert.equal(wslMountPathFor("relative\\x"), "");
  const options = {
    hostPlatform: "linux",
    env: { PATH: "/usr/bin", HOME: "/home/u", WSL_INTEROP: "/run/WSL/1_interop", WSL_DISTRO_NAME: "Ubuntu", WSLENV: "SECRET/u", OPENAI_API_KEY: "x" },
    whereCodex: () => `${npm}\\codex\r\n${npm}\\codex.cmd\r\n`,
    fileExists: (target) => target === wslMountPathFor(exe),
  };
  const spec = execServerLaunchSpec({ key: "windows", platform: "win32" }, options);
  assert.equal(spec.command, wslMountPathFor(exe));
  assert.deepEqual(spec.args.slice(0, 3), ["exec-server", "--listen", "stdio"]);
  assert.deepEqual(Object.keys(spec.env).sort(), ["HOME", "PATH", "WSL_DISTRO_NAME", "WSL_INTEROP"], "no WSLENV, so no WSL variable is shared into Windows");
  assert.equal(spec.cwd, "/mnt/c");
  assert.throws(
    () => execServerLaunchSpec({ key: "windows", platform: "win32" }, { ...options, fileExists: () => false }),
    (error) => error.code === "direct_codex_exec_server_unavailable",
  );
});

await check("exec-server starts with only the command variables, from a login shell or wsl.exe", async () => {
  const script = posixExecServerScript("codex");
  assert.match(script, /exec env -i /);
  assert.match(script, /\$\{PATH:\+"PATH=\$PATH"\}/);
  assert.match(script, /command -v 'codex'/);
  assert.match(script, /"\$codex_bin" exec-server --listen stdio --concurrent-requests 4/);
  assert.doesNotMatch(script, /KEY|TOKEN|SECRET/);
  const spec = execServerLaunchSpec({ key: "wsl:Ubuntu", distro: "Ubuntu" }, { hostPlatform: "win32", env: { PATH: "C:\\Windows", OPENAI_API_KEY: "x", SystemRoot: "C:\\Windows" } });
  assert.equal(spec.command, "wsl.exe");
  assert.deepEqual(spec.args.slice(0, 7), ["-d", "Ubuntu", "--cd", "~", "--exec", "bash", "-lc"]);
  assert.deepEqual(Object.keys(spec.env).sort(), ["PATH", "SystemRoot"]);
  assert.equal(versionAtLeast("0.162.1", "0.160.0"), true);
  assert.equal(versionAtLeast("0.159.9", "0.160.0"), false);
  assert.equal(versionAtLeast("0.0.0", "0.160.0"), false);
});

await check("sandbox: none for Full access; profiles map to read/write entries and denials", async () => {
  const environment = execServerEnvironmentFor(project, { hostPlatform: "linux", env: {} });
  const options = { discoverCredentials: () => ["/home/u/.config/app/direct-auth/auth.json"] };
  assert.equal(execServerSandboxFor("danger-full-access", environment, INFO, options), null);
  const readOnly = execServerSandboxFor("read-only", environment, INFO, options);
  const workspace = execServerSandboxFor("workspace-write", environment, INFO, options);
  const access = (sandbox) => sandbox.permissions.file_system.entries.map((entry) => `${entry.access}:${entry.path.value?.kind || entry.path.path}`);
  assert.deepEqual(access(readOnly), [
    "read:root",
    "deny:file:///home/u/.codex/auth.json",
    "deny:file:///home/u/.codex-review-shell/direct-auth/auth.json",
    "deny:file:///home/u/.config/app/direct-auth/auth.json",
    "deny:file:///run/WSL",
    "deny:file:///mnt",
  ]);
  assert.deepEqual(access(workspace).slice(0, 4), ["read:root", "write:project_roots", "write:tmpdir", "write:slash_tmp"]);
  assert.equal(workspace.permissions.network, "restricted");
  assert.deepEqual([workspace.cwd, workspace.workspaceRoots, workspace.windowsSandboxLevel], ["file:///synthetic/ws", ["file:///synthetic/ws"], "disabled"]);
  const onDrive = execServerSandboxFor("workspace-write", { ...environment, root: "/mnt/c/work/p" }, INFO, options);
  assert.equal(access(onDrive).includes("deny:file:///mnt"), false, "a project on a Windows drive keeps its drive");
  assert.equal(access(onDrive).includes("deny:file:///run/WSL"), true, "interop stays closed either way");
  const windowsEnvironment = { key: "local", platform: "win32", root: "C:\\p", local: false };
  const windows = execServerSandboxFor("workspace-write", windowsEnvironment, { userHomeDir: "file:///C:/Users/u" }, { windowsSandboxLevel: "mxc", credentialFiles: [] });
  assert.equal(windows.windowsSandboxLevel, "mxc");
  assert.equal(access(windows).includes("deny:file:///C:/Users/u/.codex/auth.json"), true);
  const restrictedToken = execServerSandboxFor("workspace-write", windowsEnvironment, { userHomeDir: "file:///C:/Users/u" }, { credentialFiles: [] });
  assert.equal(restrictedToken.windowsSandboxLevel, "restricted-token");
  assert.deepEqual(access(restrictedToken), ["read:root", "write:project_roots", "write:tmpdir"], "restricted-token refuses denied paths");
  const windowsReadOnly = execServerSandboxFor("read-only", windowsEnvironment, { userHomeDir: "file:///C:/Users/u" }, { credentialFiles: [] });
  assert.deepEqual(access(windowsReadOnly), ["read:root"], "restricted-token refuses a read-only profile with any writable folder");
});

function remoteCredentialFixture(overrides = {}) {
  const directory = (fileName) => ({ fileName, isDirectory: true, isFile: false });
  const config = "/home/u/.config";
  const dirs = new Map([
    [config, [directory("app"), directory("linked-app"), { fileName: "ordinary.conf", isDirectory: false, isFile: true }]],
    [`${config}/app`, [directory("direct-auth"), directory("profile")]],
    [`${config}/linked-app`, []],
  ]);
  const stores = [
    `${config}/app/direct-auth/auth.json`,
    `${config}/app/profile/direct-auth/auth.json`,
    `${config}/linked-app/direct-auth/auth.json`,
  ];
  const canonicalStore = "/credential-data/direct-token.json";
  const connection = new FakeConnection({
    "fs/readDirectory": ({ path: uri }) => {
      const entries = dirs.get(execUriToPath(uri, "linux"));
      if (!entries) throw missing();
      return { entries };
    },
    "fs/getMetadata": ({ path: uri }) => {
      const target = execUriToPath(uri, "linux");
      if (!stores.includes(target)) throw missing();
      return { isFile: true, isDirectory: false, isSymlink: target === stores[2] };
    },
    "fs/canonicalize": ({ path: uri }) => ({ path: execUriToPath(uri, "linux") === stores[2] ? pathToExecUri(canonicalStore, "linux") : uri }),
    "process/start": () => ({ sandboxType: "linuxSeccomp" }),
    ...overrides,
  });
  const environment = { key: "wsl:fixture", platform: "linux", root: ROOT, local: false };
  const session = { connection, environment, info: INFO };
  const manager = { environmentFor: () => environment, connectionFor: async () => session };
  return { connection, session, manager, stores: [...stores, canonicalStore] };
}

await check("remote sandbox discovery denies native app/profile stores and canonical aliases without reading content", async () => {
  const f = remoteCredentialFixture();
  for (const sandboxMode of ["workspace-write", "read-only"]) {
    const profile = await execServerSandboxForSession(sandboxMode, f.session);
    const deniedUris = profile.permissions.file_system.entries.filter((entry) => entry.access === "deny").map((entry) => entry.path.path);
    for (const store of f.stores) assert(deniedUris.includes(pathToExecUri(store, "linux")), `${sandboxMode}: ${store}`);
  }
  assert(f.connection.calls.every((call) => ["fs/readDirectory", "fs/getMetadata", "fs/canonicalize"].includes(call.method)), "discovery must never read credential contents");
  const handle = new CodexExecServerProcessHandle({ manager: f.manager, project, sessionId: "remote_stores", plan: { sandboxMode: "workspace-write", argv: ["/bin/true"], cwd: ROOT } });
  await new Promise((resolve, reject) => { handle.onStarted(resolve); handle.onError(reject); });
  const start = f.connection.calls.find((call) => call.method === "process/start");
  for (const store of f.stores) assert(start.params.sandbox.permissions.file_system.entries.some((entry) => entry.access === "deny" && entry.path.path === pathToExecUri(store, "linux")));
  f.connection.emit("notification", "process/closed", { processId: "remote_stores" });
  const metadata = f.connection.handlers["fs/getMetadata"];
  f.connection.handlers["fs/getMetadata"] = (params) => execUriToPath(params.path, "linux") === `${ROOT}/ordinary.txt`
    ? { isFile: true, isDirectory: false, isSymlink: false, size: 4 }
    : metadata(params);
  f.connection.handlers["fs/readBlock"] = () => ({ chunk: Buffer.from("safe").toString("base64"), eof: true });
  const port = new CodexExecServerFilePort({ manager: f.manager });
  const resolved = port.resolveTarget({ project }, { sandboxMode: "read-only" }, "ordinary.txt");
  assert.equal((await port.readFile(resolved, undefined, { project }, { sandboxMode: "read-only" })).bytes.toString(), "safe");
  const open = f.connection.calls.find((call) => call.method === "fs/open");
  for (const store of f.stores) assert(open.params.sandbox.permissions.file_system.entries.some((entry) => entry.access === "deny" && entry.path.path === pathToExecUri(store, "linux")));
});

await check("incomplete remote credential policy refuses sandboxed commands, while Full access needs no discovery", async () => {
  for (const override of [
    () => { throw denied(); },
    () => ({}),
    () => ({ entries: Array.from({ length: 201 }, (_, index) => ({ fileName: `app${index}`, isDirectory: true, isFile: false })) }),
  ]) {
    const f = remoteCredentialFixture({ "fs/readDirectory": override });
    const handle = new CodexExecServerProcessHandle({ manager: f.manager, project, sessionId: "policy_failure", plan: { sandboxMode: "workspace-write", argv: ["/bin/true"], cwd: ROOT } });
    const errors = [];
    handle.onError((error) => errors.push(error.code));
    await new Promise((resolve) => handle.onClose(resolve));
    assert.deepEqual(errors, ["direct_codex_exec_server_credential_policy_unavailable"]);
    assert(!f.connection.calls.some((call) => call.method === "process/start"));
    const callCount = f.connection.calls.length;
    assert.equal(await execServerSandboxForSession("danger-full-access", f.session), null);
    assert.equal(f.connection.calls.length, callCount);
  }
  const f = remoteCredentialFixture();
  assert.throws(() => execServerSandboxFor("read-only", f.session.environment, INFO), (error) => error.code === "direct_codex_exec_server_credential_policy_unavailable");
});

await check("cancellation during remote credential discovery never dispatches a process", async () => {
  let releaseListing;
  const listing = new Promise((resolve) => { releaseListing = resolve; });
  const f = remoteCredentialFixture({ "fs/readDirectory": () => listing });
  const handle = new CodexExecServerProcessHandle({ manager: f.manager, project, sessionId: "cancel_policy", plan: { sandboxMode: "workspace-write", argv: ["/bin/true"], cwd: ROOT } });
  await tick();
  assert(f.connection.calls.some((call) => call.method === "fs/readDirectory"));
  const closed = new Promise((resolve) => handle.onClose(resolve));
  assert.equal(handle.kill("SIGTERM"), true);
  await closed;
  releaseListing({ entries: [] });
  await tick();
  await tick();
  assert(!f.connection.calls.some((call) => call.method === "process/start"));
});

await check("commands get the host's additions; base variables come from exec-server's own environment", async () => {
  assert.deepEqual(
    commandEnvironmentAdditions({ PATH: "/host/bin", HOME: "/host", CI: "1", NO_COLOR: "1", FOO: "bar" }, { FOO: "bar" }),
    { CI: "1", NO_COLOR: "1", FOO: "bar" },
  );
  assert.deepEqual(commandEnvironmentAdditions({ PATH: "/mine", CI: "1" }, { PATH: "/mine" }), { PATH: "/mine", CI: "1" });
});

function processFixture(handlers = {}, backendOptions = {}) {
  const connection = new FakeConnection({
    "process/start": () => ({ processId: "s", sandboxType: "linuxSeccomp" }),
    "process/write": () => ({ status: "accepted" }),
    ...handlers,
  });
  const manager = fakeManager(connection);
  const backend = new CodexExecServerProcessBackend({ manager, env: {}, ...backendOptions });
  return { connection, manager, backend };
}

await check("process start: argv, cwd URI, env policy, stdin pipe, sandbox", async () => {
  const f = processFixture();
  const workspace = f.backend.resolveWorkspace({ project, cwd: "src" }, { sandboxMode: "workspace-write" });
  assert.deepEqual(workspace, { root: ROOT, remote: true, platform: "linux", local: true, cwd: `${ROOT}/src`, cwdRelPath: "src" });
  assert.throws(() => f.backend.resolveWorkspace({ project, cwd: "../x" }, { sandboxMode: "workspace-write" }), (error) => error.code === "direct_stateful_exec_cwd_invalid");
  const plan = f.backend.planLaunch({ sandboxMode: "workspace-write", workspace, shellCommand: "echo hi" });
  // bash where this host has it (it plans for itself here), sh otherwise.
  assert.deepEqual(plan.argv.slice(1), /bash$/.test(plan.argv[0]) ? ["--norc", "-c", "echo hi"] : ["-c", "echo hi"]);
  const handle = f.backend.launch(plan, { project, sessionId: "s", env: { PATH: "/host", CI: "1" }, requestedEnv: undefined });
  const out = [];
  const exits = [];
  const activity = [];
  handle.onStdout((chunk) => out.push(`out:${chunk}`));
  handle.onStderr((chunk) => out.push(`err:${chunk}`));
  handle.onClose((code, signal) => exits.push({ code, signal }));
  handle.onActivity(() => activity.push(handle.state));
  await tick();
  await tick();
  assert.deepEqual(activity, ["running"], "the idle timer restarts once the process has actually started");
  const start = f.connection.calls[0];
  assert.equal(start.method, "process/start");
  assert.equal(start.params.processId, "s");
  assert.equal(start.params.cwd, "file:///synthetic/ws/src");
  assert.deepEqual(start.params.env, { CI: "1" });
  assert.equal(start.params.envPolicy.inherit, "all");
  assert(start.params.envPolicy.includeOnly.includes("PATH"));
  assert.equal(start.params.pipeStdin, true);
  assert.equal(start.params.tty, false);
  assert.equal(start.params.sandbox.permissions.network, "restricted");
  assert.equal(handle.launcher, "codex_exec_server:linuxSeccomp");
  assert.equal(handle.networkAccess, false);
  const b64 = (text) => Buffer.from(text).toString("base64");
  f.connection.emit("notification", "process/output", { processId: "s", stream: "stdout", chunk: b64("hi\n") });
  f.connection.emit("notification", "process/output", { processId: "other", stream: "stdout", chunk: b64("not mine") });
  f.connection.emit("notification", "process/output", { processId: "s", stream: "stderr", chunk: b64("warn") });
  f.connection.emit("notification", "process/exited", { processId: "s", exitCode: 3 });
  assert.deepEqual(exits, [], "exit waits for the streams to close");
  f.connection.emit("notification", "process/closed", { processId: "s" });
  assert.deepEqual(out, ["out:hi\n", "err:warn"]);
  assert.deepEqual(exits, [{ code: 3, signal: null }]);
  assert.equal(f.connection.listenerCount("notification"), 0);
});

await check("kill, interrupt, stdin, and EOF map onto exec-server's requests and gaps", async () => {
  const f = processFixture();
  const workspace = f.backend.resolveWorkspace({ project }, { sandboxMode: "danger-full-access" });
  const plan = f.backend.planLaunch({ sandboxMode: "danger-full-access", workspace, shellCommand: "cat" });
  const handle = f.backend.launch(plan, { project, sessionId: "s", env: {} });
  const exits = [];
  const callbacks = [];
  handle.onClose((code, signal) => exits.push({ code, signal }));
  handle.writeStdin("queued\n", (error) => callbacks.push(error?.code || null));
  await tick();
  await tick();
  assert.equal(f.connection.calls[0].params.sandbox, undefined, "Full access sends no sandbox");
  assert.deepEqual(f.connection.calls.map((call) => call.method), ["process/start", "process/write"]);
  assert.equal(Buffer.from(f.connection.calls[1].params.chunk, "base64").toString(), "queued\n");
  handle.endStdin((error) => callbacks.push(error?.code || null));
  await tick();
  handle.kill("SIGINT");
  handle.kill("SIGTERM");
  await tick();
  assert.deepEqual(f.connection.calls.slice(2).map((call) => [call.method, call.params.signal || ""]), [["process/signal", "interrupt"], ["process/terminate", ""]]);
  assert.deepEqual(callbacks, [null, "direct_stateful_exec_stdin_eof_unsupported"]);
  f.connection.emit("notification", "process/exited", { processId: "s", exitCode: 137 });
  f.connection.emit("notification", "process/closed", { processId: "s" });
  assert.deepEqual(exits, [{ code: null, signal: "SIGTERM" }], "a requested kill reads as a signal, like a local child");

  const g = processFixture({ "process/write": () => ({ status: "stdinClosed" }) });
  const ttyPlan = g.backend.planLaunch({ sandboxMode: "danger-full-access", workspace, shellCommand: "read x", tty: { rows: 30, cols: 100 } });
  const ttyHandle = g.backend.launch(ttyPlan, { project, sessionId: "t", env: {} });
  await tick();
  await tick();
  assert.equal(g.connection.calls[0].params.tty, true);
  assert.equal(g.connection.calls[0].params.pipeStdin, false);
  const ttyCallbacks = [];
  ttyHandle.endStdin((error) => ttyCallbacks.push(error?.code || null));
  await tick();
  await tick();
  assert.equal(Buffer.from(g.connection.calls[1].params.chunk, "base64").toString(), "\x04", "a terminal's EOF is ^D");
  assert.deepEqual(ttyCallbacks, ["EPIPE"], "a refused write fails like a closed pipe");
});

await check("Read only gets its own writable temp folder, removed when the command ends", async () => {
  const f = processFixture();
  const workspace = f.backend.resolveWorkspace({ project }, { sandboxMode: "read-only" });
  const plan = f.backend.planLaunch({ sandboxMode: "read-only", workspace, shellCommand: "mktemp" });
  const handle = f.backend.launch(plan, { project, sessionId: "ro", env: {} });
  await tick();
  await tick();
  await tick();
  const [create, start] = f.connection.calls;
  assert.equal(create.method, "fs/createDirectory");
  assert.equal(create.params.path, "file:///tmp/codex-direct-ro-ro");
  assert.equal(create.params.sandbox, undefined);
  assert.equal(start.method, "process/start");
  assert.equal(start.params.env.TMPDIR, "/tmp/codex-direct-ro-ro");
  const writes = start.params.sandbox.permissions.file_system.entries.filter((entry) => entry.access === "write");
  assert.deepEqual(writes.map((entry) => entry.path.path), ["file:///tmp/codex-direct-ro-ro"], "the scratch folder is the only writable path");
  f.connection.emit("notification", "process/exited", { processId: "ro", exitCode: 0 });
  f.connection.emit("notification", "process/closed", { processId: "ro" });
  const remove = f.connection.calls.at(-1);
  assert.equal(remove.method, "fs/remove");
  assert.equal(remove.params.path, "file:///tmp/codex-direct-ro-ro");
  assert.equal(remove.params.recursive, true);
  void handle;

  const g = processFixture();
  const wsPlan = g.backend.planLaunch({ sandboxMode: "workspace-write", workspace, shellCommand: "true" });
  g.backend.launch(wsPlan, { project, sessionId: "ws", env: {} });
  await tick();
  await tick();
  assert.deepEqual(g.connection.calls.map((call) => call.method), ["process/start"], "Workspace already has the temp folders");
});

await check("a start that times out is stopped, even if it finishes later; a stuck exec-server is closed", async () => {
  const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
  const timing = { startTimeoutMs: 5, startAbandonGraceMs: 30 };
  const f = processFixture({ "process/start": () => TIMEOUT }, { timing });
  const workspace = f.backend.resolveWorkspace({ project }, { sandboxMode: "danger-full-access" });
  const plan = f.backend.planLaunch({ sandboxMode: "danger-full-access", workspace, shellCommand: "touch x" });
  const handle = f.backend.launch(plan, { project, sessionId: "slow", env: {} });
  const exits = [];
  const errors = [];
  handle.onClose((code, signal) => exits.push({ code, signal }));
  handle.onError((error) => errors.push(error.code));
  await sleep(5);
  assert.deepEqual(errors, ["direct_codex_exec_server_timeout"]);
  assert.deepEqual(exits, [{ code: null, signal: "" }]);
  const terminates = () => f.connection.calls.filter((call) => call.method === "process/terminate" && call.params.processId === "slow").length;
  assert.equal(terminates(), 1, "a timed-out start is told to stop right away");
  f.connection.late["process/start"](null, { processId: "slow" });
  await tick();
  assert.equal(terminates(), 2, "a start that succeeds late is stopped");
  await sleep(50);
  assert.equal(f.connection.closeCalls, 0, "an exec-server that answered stays up");

  const g = processFixture({ "process/start": () => TIMEOUT }, { timing });
  g.backend.launch(plan, { project, sessionId: "stuck", env: {} });
  await sleep(60);
  assert.equal(g.connection.closeCalls, 1, "an exec-server that never answers the start is closed, which stops what it started");
});

await check("a lost exec-server's Read only scratch folder is queued for removal", async () => {
  const f = processFixture();
  const workspace = f.backend.resolveWorkspace({ project }, { sandboxMode: "read-only" });
  const plan = f.backend.planLaunch({ sandboxMode: "read-only", workspace, shellCommand: "sleep 9" });
  f.backend.launch(plan, { project, sessionId: "gone", env: {} });
  await tick();
  await tick();
  await tick();
  f.connection.state = "closed";
  f.connection.emit("closed", {});
  assert.deepEqual(f.manager.queuedScratch, [["local", "/tmp/codex-direct-ro-gone"]]);
  assert.equal(f.connection.calls.some((call) => call.method === "fs/remove"), false, "nothing is sent to a closed connection");
});

await check("a new connection removes queued scratch folders and ones older than an hour", async () => {
  const NOW = 10 * 60 * 60_000;
  const ages = { "codex-direct-ro-old": 2 * 60 * 60_000, "codex-direct-ro-new": 5 * 60_000, "codex-direct-ro-link": 3 * 60 * 60_000 };
  const connection = new FakeConnection({
    "fs/readDirectory": () => ({
      entries: [
        ...Object.keys(ages).map((fileName) => ({ fileName, isDirectory: true, isFile: false })),
        { fileName: "codex-direct-ro-queued", isDirectory: true, isFile: false },
        { fileName: "codex-direct-ro-file", isDirectory: false, isFile: true },
        { fileName: "someone-else", isDirectory: true, isFile: false },
      ],
    }),
    "fs/getMetadata": ({ path: uri }) => {
      const name = uri.split("/").pop();
      return { isDirectory: true, isFile: false, isSymlink: name === "codex-direct-ro-link", size: 0, createdAtMs: 0, modifiedAtMs: NOW - ages[name] };
    },
  });
  const manager = new CodexExecServerManager({ now: () => NOW });
  manager.queueScratchCleanup("local", "/tmp/codex-direct-ro-queued");
  await manager.reclaimScratch(connection, { key: "local", platform: "linux" });
  const removed = connection.calls.filter((call) => call.method === "fs/remove").map((call) => call.params.path);
  assert.deepEqual(removed, ["file:///tmp/codex-direct-ro-queued", "file:///tmp/codex-direct-ro-old"]);
  assert.equal(manager.pendingScratch.size, 0);
  const windows = new FakeConnection({});
  await manager.reclaimScratch(windows, { key: "local", platform: "win32" });
  assert.deepEqual(windows.calls, [], "Windows has no scratch folders");
});

await check("Windows Read only and Workspace commands need a sandbox that hides credential stores", async () => {
  const windowsWorkspace = { root: "C:\\p", remote: true, platform: "win32", local: true, cwd: "C:\\p", cwdRelPath: "." };
  const restricted = new CodexExecServerProcessBackend({ manager: fakeManager(new FakeConnection()), env: {} });
  for (const sandboxMode of ["read-only", "workspace-write"]) {
    assert.throws(
      () => restricted.planLaunch({ sandboxMode, workspace: windowsWorkspace, shellCommand: "Get-Content $HOME\\.codex\\auth.json" }),
      (error) => error.code === "direct_stateful_exec_sandbox_unavailable" && /can't hide credential stores/.test(error.message),
    );
  }
  assert.equal(restricted.planLaunch({ sandboxMode: "danger-full-access", workspace: windowsWorkspace, shellCommand: "hi" }).sandboxMode, "danger-full-access");
  const elevated = new CodexExecServerProcessBackend({ manager: fakeManager(new FakeConnection()), env: { CODEX_DIRECT_EXEC_SERVER_WINDOWS_SANDBOX: "elevated" } });
  const plan = elevated.planLaunch({ sandboxMode: "workspace-write", workspace: windowsWorkspace, shellCommand: "hi" });
  assert.equal(plan.windowsSandboxLevel, "elevated");
  const linuxPlan = restricted.planLaunch({ sandboxMode: "read-only", workspace: { ...windowsWorkspace, platform: "linux", root: ROOT, cwd: ROOT }, shellCommand: "true" });
  assert.equal(linuxPlan.sandboxMode, "read-only", "Linux sandboxes keep their denials");
});

await check("a kill before dispatch sends nothing; a lost exec-server reports the session lost", async () => {
  const f = processFixture();
  const workspace = f.backend.resolveWorkspace({ project }, { sandboxMode: "danger-full-access" });
  const plan = f.backend.planLaunch({ sandboxMode: "danger-full-access", workspace, shellCommand: "sleep 9" });
  const early = new CodexExecServerProcessHandle({ manager: f.manager, project, sessionId: "e", plan });
  const exits = [];
  early.onClose((code, signal) => exits.push({ code, signal }));
  assert.equal(early.kill("SIGKILL"), true);
  await tick();
  await tick();
  assert.deepEqual(f.connection.calls, []);
  assert.deepEqual(exits, [{ code: null, signal: "SIGKILL" }]);
  const live = f.backend.launch(plan, { project, sessionId: "l", env: {} });
  const lost = [];
  live.onLost((error) => lost.push(error.code));
  await tick();
  await tick();
  f.connection.emit("closed", {});
  assert.deepEqual(lost, ["direct_stateful_exec_executor_lost"]);
});

await check("sandboxed Windows standalone file ports refuse mutable-path reads; Full access remains on exec-server", async () => {
  const connection = new FakeConnection({
    "fs/getMetadata": () => ({ isFile: true, size: 4 }),
    "fs/readBlock": () => ({ chunk: Buffer.from("safe").toString("base64"), eof: true }),
  });
  const environment = { key: "windows", platform: "win32", root: "C:\\fixture", local: false };
  const manager = { environmentFor: () => environment, connectionFor: async () => ({ connection, environment, info: { userHomeDir: "file:///C:/Users/fixture" } }) };
  const port = new CodexExecServerFilePort({ manager });
  const resolved = { root: environment.root, target: "C:\\fixture\\junction\\auth.json", platform: "win32" };
  for (const sandboxMode of ["read-only", "workspace-write"]) {
    const grant = { sandboxMode };
    assert.equal(port.canServe(grant, project), false);
    assert.throws(() => port.resolveTarget({ project }, grant, "junction/auth.json"), (error) => error.code === "direct_codex_exec_server_file_sandbox_unavailable");
    await assert.rejects(() => port.readFile(resolved, undefined, { project }, grant), (error) => error.code === "direct_codex_exec_server_file_sandbox_unavailable");
    await assert.rejects(() => port.readPatchTarget(resolved, "update", { project }, grant), (error) => error.code === "direct_codex_exec_server_file_sandbox_unavailable");
  }
  assert.deepEqual(connection.calls, [], "a bypassed host precheck must never reach fs/open or readFile");
  const full = { sandboxMode: "danger-full-access" };
  assert.equal(port.canServe(full, project), true);
  assert.equal((await port.readFile(resolved, undefined, { project }, full)).bytes.toString(), "safe");
  assert.equal(connection.calls.find((call) => call.method === "fs/open").params.sandbox, null);
});

await check("Windows sandboxed read, image, and patch tools retain Direct local/remote routing", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  for (const local of [true, false]) {
    const connection = new FakeConnection();
    const environment = { key: local ? "local" : "windows", platform: "win32", root: "C:\\fixture", local };
    const port = new CodexExecServerFilePort({ manager: { environmentFor: () => environment, connectionFor: async () => ({ connection, environment, info: INFO }) } });
    let commits = 0;
    const directPort = {
      kind: local ? "local" : "executor",
      resolveTarget: () => ({ root: "C:\\fixture", target: "C:\\fixture\\a.txt", canonicalTarget: "a.txt", pathEvidenceKey: "fixture" }),
      assertReadable: async () => {}, assertWritable: async () => {},
      readFile: async (_resolved, _maxBytes, _input, _grant, capBytes) => {
        const bytes = capBytes ? png : Buffer.from("alpha\n");
        return { bytes, size: bytes.length };
      },
      readPatchTarget: async () => ({ exists: true, bytes: Buffer.from("alpha\n") }),
      commit: async () => { commits += 1; },
    };
    const executor = new DirectFullAccessLocalEnvironmentExecutor({
      workspaceLocalityResolver: () => local,
      executorFilePort: directPort,
      filePortOverride: (grant, selectedProject) => port.canServe(grant, selectedProject) ? port : null,
    });
    executor.localPort = directPort;
    for (const accessProfile of ["workspace", "read_only", "full_access"]) {
      const grant = DirectThreadHarnessGrant.issue({
        taskId: "routing", threadId: "routing", projectId: project.id,
        executionEnvironment: { kind: "windows", environmentId: "fixture", bindingDigest: "sha256:fixture" },
        capabilities: ["read_file", "apply_patch"], accessProfile,
      });
      const input = { project, taskId: grant.taskId, threadId: grant.threadId, projectId: grant.projectId, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
      assert.equal(executor.portFor(grant, project), accessProfile === "full_access" ? port : directPort);
      if (accessProfile === "full_access") continue;
      assert.equal((await executor.request(input, "readFile", { relPath: "a.txt" })).text, "alpha\n");
      assert.equal((await executor.request(input, "readImage", { relPath: "a.png" })).mimeType, "image/png");
      if (accessProfile === "workspace") {
        const result = await executor.request(input, "applyPatch", { mode: "apply", patch: "*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+beta\n*** End Patch" });
        assert.equal(result.status, "applied");
      }
    }
    assert.equal(commits, 1);
    assert.deepEqual(connection.calls, [], "sandboxed Windows content must use the Direct port");
  }
});

const issueBinding = (accessProfile, capabilities) => {
  const grant = DirectThreadHarnessGrant.issue({
    taskId: `t_${accessProfile}`, threadId: `t_${accessProfile}`, projectId: project.id,
    executionEnvironment: { kind: "local", environmentId: "fixture_env", bindingDigest: "sha256:fixture" },
    capabilities, accessProfile,
  });
  return { taskId: grant.taskId, threadId: grant.threadId, projectId: project.id, project, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
};

await check("exec results name the backend and the sandbox exec-server reported", async () => {
  const f = processFixture({
    "process/start": (params, connection) => {
      setImmediate(() => {
        connection.emit("notification", "process/output", { processId: params.processId, stream: "stdout", chunk: Buffer.from("ok\n").toString("base64") });
        connection.emit("notification", "process/exited", { processId: params.processId, exitCode: 0 });
        connection.emit("notification", "process/closed", { processId: params.processId });
      });
      return { processId: params.processId, sandboxType: "linuxSeccomp" };
    },
  });
  const manager = new DirectStatefulExecSessionManager({ backendResolver: () => f.backend });
  const binding = issueBinding("workspace", ["exec_command", "write_stdin"]);
  try {
    const started = manager.start({ ...binding, cmd: "echo ok", stdinPolicy: "disabled" });
    const result = await manager.wait({ ...binding, sessionId: started.sessionId });
    assert.equal(result.status, "completed");
    assert.equal(result.stdoutPreview.trim(), "ok");
    assert.equal(result.executionBackend, "codex-exec-server");
    assert.equal(result.sandboxLauncher, "codex_exec_server:linuxSeccomp");
    assert.equal(result.networkAccess, false);
  } finally {
    await manager.dispose("fixture");
  }
});

// An in-memory filesystem behind the fake connection's fs requests.
function fileFixture() {
  const files = new Map([
    [`${ROOT}/src/a.txt`, Buffer.from("alpha\n")],
    ["/outside/b.txt", Buffer.from("beta\n")],
    ["/home/u/.codex/auth.json", Buffer.from("{\"secret\":true}\n")],
  ]);
  const dirs = new Set(["/", "/synthetic", ROOT, `${ROOT}/src`, "/outside", "/home", "/home/u", "/home/u/.codex"]);
  const links = new Map([[`${ROOT}/escape`, "/outside"]]);
  const real = (target) => {
    for (const [link, to] of links) {
      if (target === link || target.startsWith(`${link}/`)) return `${to}${target.slice(link.length)}`;
    }
    return target;
  };
  const native = (uri) => real(execUriToPath(uri, "linux"));
  const handles = new Map();
  const writable = (sandbox, target) => {
    if (!sandbox) return true;
    const entries = sandbox.permissions.file_system.entries;
    return entries.some((entry) => entry.access === "write" && entry.path.value?.kind === "project_roots") && (target === ROOT || target.startsWith(`${ROOT}/`));
  };
  const connection = new FakeConnection({
    "fs/canonicalize": ({ path: uri }) => {
      const target = native(uri);
      if (!files.has(target) && !dirs.has(target)) throw missing();
      return { path: pathToExecUri(target, "linux") };
    },
    "fs/getMetadata": ({ path: uri }) => {
      const target = native(uri);
      if (files.has(target)) return { isFile: true, isDirectory: false, isSymlink: false, size: files.get(target).length };
      if (dirs.has(target)) return { isFile: false, isDirectory: true, isSymlink: false, size: 0 };
      throw missing();
    },
    "fs/open": ({ handleId, path: uri }) => {
      const target = native(uri);
      if (!files.has(target)) throw missing();
      handles.set(handleId, files.get(target));
      return { handleId };
    },
    "fs/readBlock": ({ handleId, offset, len }) => {
      const bytes = handles.get(handleId).subarray(offset, offset + len);
      return { chunk: bytes.toString("base64"), eof: offset + bytes.length >= handles.get(handleId).length };
    },
    "fs/close": ({ handleId }) => { handles.delete(handleId); return {}; },
    "fs/readFile": ({ path: uri }) => {
      const target = native(uri);
      if (!files.has(target)) throw missing();
      return { dataBase64: files.get(target).toString("base64") };
    },
    "fs/createDirectory": ({ path: uri, sandbox }) => {
      const target = native(uri);
      if (!writable(sandbox, target)) throw denied();
      for (let dir = target; dir !== "/"; dir = path.posix.dirname(dir)) dirs.add(dir);
      return {};
    },
    "fs/writeFile": ({ path: uri, dataBase64, sandbox }) => {
      const target = native(uri);
      if (!writable(sandbox, target)) throw denied();
      files.set(target, Buffer.from(dataBase64, "base64"));
      return {};
    },
    "fs/remove": ({ path: uri, sandbox }) => {
      const target = native(uri);
      if (!writable(sandbox, target)) throw denied();
      if (!files.delete(target)) throw missing();
      return {};
    },
  });
  const port = new CodexExecServerFilePort({ manager: fakeManager(connection) });
  const executor = new DirectFullAccessLocalEnvironmentExecutor({ filePortOverride: () => port });
  return { files, connection, port, executor };
}

const updatePatch = (target, before, after) => ["*** Begin Patch", `*** Update File: ${target}`, "@@ -1 +1 @@", `-${before}`, `+${after}`, "*** End Patch"].join("\n");

await check("file tools: reads, patches, and profile boundaries through exec-server", async () => {
  const f = fileFixture();
  const full = issueBinding("full_access", ["read_file", "apply_patch"]);
  const workspace = issueBinding("workspace", ["read_file", "apply_patch"]);
  const readOnly = issueBinding("read_only", ["read_file", "apply_patch"]);
  assert.equal(f.executor.portFor(full.harnessGrant, project), f.port, "the override wins over local routing");

  const read = await f.executor.request(workspace, "readFile", { relPath: "src/a.txt" });
  assert.deepEqual([read.text, read.size, read.source], ["alpha\n", 6, "codex_exec_server"]);
  const partial = await f.executor.request(full, "readFile", { relPath: "src/a.txt", maxBytes: 3 });
  assert.deepEqual([partial.text, partial.truncated], ["alp", true]);
  await assert.rejects(() => f.executor.request(full, "readFile", { relPath: "src/missing.txt" }), (error) => error.code === "direct_full_access_file_unavailable");
  await assert.rejects(
    () => f.executor.request(workspace, "readFile", { relPath: "/home/u/.codex/auth.json" }),
    (error) => error.code === "direct_access_profile_credential_store_hidden",
  );
  assert.match((await f.executor.request(full, "readFile", { relPath: "/home/u/.codex/auth.json" })).text, /secret/);

  const applied = await f.executor.request(workspace, "applyPatch", { mode: "apply", patch: updatePatch("src/a.txt", "alpha", "alpha2") });
  assert.equal(applied.status, "applied");
  assert.equal(f.files.get(`${ROOT}/src/a.txt`).toString(), "alpha2\n");
  const created = await f.executor.request(workspace, "applyPatch", {
    mode: "apply",
    patch: ["*** Begin Patch", "*** Add File: src/new/deep/c.txt", "+created", "*** End Patch"].join("\n"),
  });
  assert.equal(created.status, "applied");
  assert.equal(f.files.get(`${ROOT}/src/new/deep/c.txt`).toString(), "created\n");
  const writes = f.connection.calls.filter((call) => call.method === "fs/writeFile");
  assert(writes.every((call) => call.params.sandbox?.permissions?.network === "restricted"), "workspace writes carry the sandbox");

  for (const target of ["/outside/b.txt", "../../outside/b.txt", "escape/b.txt"]) {
    await assert.rejects(
      () => f.executor.request(workspace, "applyPatch", { mode: "apply", patch: updatePatch(target, "beta", "hacked") }),
      (error) => error.code === "direct_access_profile_path_outside_workspace",
      `workspace patch must reject ${target}`,
    );
  }
  assert.equal(f.files.get("/outside/b.txt").toString(), "beta\n");
  await assert.rejects(
    () => f.executor.request(readOnly, "applyPatch", { mode: "dryRun", patch: updatePatch("src/a.txt", "alpha2", "alpha3") }),
    (error) => ["direct_access_profile_write_blocked", "capability_not_in_grant_population"].includes(error.code),
  );
  const fullOutside = await f.executor.request(full, "applyPatch", { mode: "apply", patch: updatePatch("/outside/b.txt", "beta", "beta2") });
  assert.equal(fullOutside.status, "applied");
  assert.equal(f.files.get("/outside/b.txt").toString(), "beta2\n");

  const stale = [{
    operation: "update", beforeExists: true, beforeDigest: "0".repeat(64),
    _resolved: f.port.resolveTarget(full, full.harnessGrant, "src/a.txt", "patch target"), _afterText: "overwritten\n",
  }];
  await assert.rejects(() => f.port.commit(full.harnessGrant, stale, full), (error) => error.code === "direct_full_access_patch_conflict");
  assert.equal(f.files.get(`${ROOT}/src/a.txt`).toString(), "alpha2\n");

  const deleted = await f.executor.request(full, "applyPatch", {
    mode: "apply",
    patch: ["*** Begin Patch", "*** Delete File: src/new/deep/c.txt", "@@", "-created", "*** End Patch"].join("\n"),
  });
  assert.equal(deleted.status, "applied");
  assert.equal(f.files.has(`${ROOT}/src/new/deep/c.txt`), false);
});

console.log(JSON.stringify({ schema: "direct_codex_exec_server_backend_regression@1", status: "passed", hostPlatform: process.platform, checks }));
