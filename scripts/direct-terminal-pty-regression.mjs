#!/usr/bin/env node
// Real terminals (turn 11a). Agents get a terminal with exec_command `tty`,
// and the owner gets interactive shells in the Workbench Terminal panel,
// in either environment: ConPTY through the job runner on Windows, the
// Python pty helper on Linux/WSL. Runs on either host:
//   Linux/WSL:  node scripts/direct-terminal-pty-regression.mjs
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-terminal-pty-regression.mjs
// The environment that isn't the host's own is reached through its executor,
// as in the app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  PTY_HELPER_PATH,
  PtyChannel,
  encodePtyFrame,
  encodePtyResize,
  normalizePtySize,
} = require("../src/main/direct/tools/pty-frames.js");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { EnvironmentExecutorProcessBackend, createEnvironmentExecBackendResolver } = require("../src/main/direct/tools/executor-process-backend.js");
const { WindowsJobSandbox } = require("../src/main/direct/tools/windows-job-runner.js");
const { DirectTerminalService, MAX_TERMINALS_PER_PROJECT } = require("../src/main/direct/terminal/terminal-service.js");
const { EXECUTOR_METHODS, describeExecutionEnvironment } = require("../src/shared/executor-protocol.js");
const { LocalSurfaceServer } = require("../src/main/local-surface-server.js");
const { WorkspaceBackendManager, workspaceRoot } = require("../src/main/workspace-backend.js");

const onWindows = process.platform === "win32";
const distro = onWindows ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : (process.env.WSL_DISTRO_NAME || "");
assert(distro, "this regression needs WSL (run inside WSL or on a Windows host with WSL)");
const suffix = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, pattern, label, timeoutMs = 30_000) {
  const started = Date.now();
  for (;;) {
    const text = read();
    if (pattern.test(text)) return text;
    if (Date.now() - started > timeoutMs) assert.fail(`${label}: timed out waiting for ${pattern}\n--- output ---\n${text.slice(-3000)}`);
    await sleep(100);
  }
}

// Folders in both environments, from this host.
const linuxFolder = `/tmp/direct-terminal-${suffix}`;
const linuxOutside = `/tmp/direct-terminal-outside-${suffix}`;
const linuxHostPath = (linuxPath) => (onWindows ? `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll("/", "\\")}` : linuxPath);
if (onWindows) {
  const made = spawnSync("wsl.exe", ["-d", distro, "-e", "mkdir", "-p", linuxFolder], { encoding: "utf8", timeout: 60_000 });
  assert.equal(made.status, 0, made.stderr);
} else {
  fs.mkdirSync(linuxFolder, { recursive: true });
}
const winTemp = onWindows
  ? os.tmpdir()
  : String(spawnSync("/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8", timeout: 20_000 }).stdout || "").trim();
assert.match(winTemp, /^[A-Za-z]:\\/, "the Windows %TEMP% is readable");
const winFolder = path.win32.join(winTemp, `direct-terminal-${suffix}`);
const winHostPath = onWindows ? winFolder : String(spawnSync("wslpath", ["-u", winFolder], { encoding: "utf8" }).stdout || "").trim();
fs.mkdirSync(winHostPath, { recursive: true });

const wslProject = { id: "project_terminal_wsl", name: "Terminal WSL", workspace: { kind: "wsl", distro, linuxPath: linuxFolder } };
const windowsProject = { id: "project_terminal_windows", name: "Terminal Windows", workspace: { kind: "windows", windowsPath: winFolder } };

const workspaceBackends = new WorkspaceBackendManager({ agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"), fallbackRoot: repoRoot });
const executorBackend = new EnvironmentExecutorProcessBackend({ workspaceBackends });
const manager = new DirectStatefulExecSessionManager({
  initialYieldMs: 2000,
  workspaceRootResolver: (input) => workspaceRoot(input?.project || input, repoRoot),
  // Keeps the in-process Windows sandbox off this machine's real credential stores.
  ...(onWindows ? { sandbox: new WindowsJobSandbox({ credentialStoreFiles: () => [path.win32.join(os.tmpdir(), `direct-terminal-fixture-auth-${process.pid}.json`)] }) } : {}),
  backendResolver: (input, grant) => createEnvironmentExecBackendResolver({ localBackend: manager.localBackend, executorBackend })(input, grant),
});
const terminals = new DirectTerminalService({
  backendFor: (project, grant) => createEnvironmentExecBackendResolver({ localBackend: manager.localBackend, executorBackend })({ project }, grant),
});

const terminalOutput = new Map();
const terminalExits = new Map();
terminals.on("data", (event) => terminalOutput.set(event.terminalId, (terminalOutput.get(event.terminalId) || "") + event.data.toString("utf8")));
terminals.on("exit", (event) => terminalExits.set(event.terminalId, event.exitCode));
const terminalShells = new Map();
terminals.on("shell", (event) => terminalShells.set(event.terminalId, event.shell));
// In-process shells are named when planned; an executor names its shell once started.
const shellNameOf = (created) => created.shell || terminalShells.get(created.terminalId) || "";
const agentTerminalData = new Map();
manager.on("terminal-data", (event) => agentTerminalData.set(event.sessionId, (agentTerminalData.get(event.sessionId) || "") + event.data.toString("utf8")));

function bindingFor(project, kind, accessProfile) {
  const threadId = `terminal_${kind}_${accessProfile}`;
  const executionEnvironment = { environmentId: `${kind}_terminal`, kind, bindingDigest: `sha256:terminal-${kind}-${suffix}` };
  const grant = DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId: project.id,
    executionEnvironment,
    capabilities: ["exec_command", "write_stdin"],
    accessProfile,
  });
  return { taskId: threadId, threadId, projectId: project.id, executionEnvironmentDigest: grant.executionEnvironmentDigest, harnessGrant: grant, project };
}

try {
  await check("frames, sizes, and the EOF key", () => {
    assert.deepEqual([...encodePtyFrame("d", "hi")], [0x64, 0, 0, 0, 2, 0x68, 0x69]);
    assert.deepEqual([...encodePtyResize(30, 120)], [0x72, 0, 0, 0, 4, 0, 30, 0, 120]);
    assert.equal(normalizePtySize(null), null);
    assert.deepEqual(normalizePtySize(true), { rows: 24, cols: 80 });
    assert.deepEqual(normalizePtySize({ rows: "0", cols: 99999 }), { rows: 24, cols: 1000 });
    const written = [];
    const stdin = { destroyed: false, writableEnded: false, write: (bytes) => written.push(Buffer.from(bytes)) };
    new PtyChannel(stdin, { platform: "linux" }).eof();
    new PtyChannel(stdin, { platform: "win32" }).eof();
    assert.equal(written[0].subarray(5).toString(), "\x04");
    assert.equal(written[1].subarray(5).toString(), "\x1a\r");
    assert.ok(fs.existsSync(PTY_HELPER_PATH));
    assert.deepEqual(describeExecutionEnvironment({ platform: "win32" }).capabilities.pty, { available: true, kind: "conpty" });
  });

  await check("both executors report a terminal", async () => {
    const executorProject = onWindows ? wslProject : windowsProject;
    const session = await workspaceBackends.ensureForProject(executorProject);
    const described = await session.transport.request(EXECUTOR_METHODS.environmentDescribe, {});
    assert.deepEqual(described.capabilities.pty, onWindows ? { available: true, kind: "python_pty" } : { available: true, kind: "conpty" });
    assert.ok(described.methods.includes(EXECUTOR_METHODS.processResize));
  });

  await check("the owner's WSL shell is a real terminal: size, resize, Ctrl+C, unsandboxed, close", async () => {
    const created = terminals.create({ project: wslProject, rows: 24, cols: 100 });
    assert.equal(created.environment, `WSL · ${distro}`);
    const read = () => terminalOutput.get(created.terminalId) || "";
    // xterm sends a carriage return for Enter.
    const type = (text) => terminals.write({ projectId: wslProject.id, terminalId: created.terminalId, data: text });
    type("stty size; tty; echo \"term=$TERM dir=$(pwd)\"; echo marker_$((6*7))\r");
    const first = await waitFor(read, /marker_42/, "first command");
    assert.match(first, /\b24 100\b/);
    assert.match(first, /\/dev\/pts\/\d+/);
    assert.match(first, new RegExp(`term=xterm-256color dir=${linuxFolder}`));
    assert.match(shellNameOf(created), /^(bash|zsh|sh|fish|dash)$/, "the shell is named");
    terminals.resize({ projectId: wslProject.id, terminalId: created.terminalId, rows: 30, cols: 120 });
    type("echo size_$(stty size | tr ' ' x)\r");
    await waitFor(read, /size_30x120/, "resize");
    type("sleep 30\r");
    await sleep(800);
    const interrupted = Date.now();
    type("\x03");
    type("echo after_int_$((1+1))\r");
    await waitFor(read, /after_int_2/, "Ctrl+C", 10_000);
    assert.ok(Date.now() - interrupted < 10_000);
    // No sandbox: the owner can write outside the project folder.
    type(`echo owner > ${linuxOutside} && echo wrote_outside_ok\r`);
    await waitFor(read, /wrote_outside_ok/, "write outside the folder");
    assert.equal(fs.readFileSync(linuxHostPath(linuxOutside), "utf8"), "owner\n");
    assert.match(terminals.replay({ projectId: wslProject.id, terminalId: created.terminalId }).toString("utf8"), /marker_42/);
    assert.throws(() => terminals.write({ projectId: "other_project", terminalId: created.terminalId, data: "x" }), (error) => error.code === "direct_terminal_missing");
    // Closing ends the shell.
    const second = terminals.create({ project: wslProject, rows: 24, cols: 80 });
    terminals.close({ projectId: wslProject.id, terminalId: second.terminalId });
    assert.equal(terminals.list({ projectId: wslProject.id }).some((row) => row.terminalId === second.terminalId), false);
    type("exit 3\r");
    await waitFor(() => (terminalExits.has(created.terminalId) ? "exited" : ""), /exited/, "shell exit");
    assert.equal(terminalExits.get(created.terminalId), 3);
    assert.equal(terminals.list({ projectId: wslProject.id }).find((row) => row.terminalId === created.terminalId)?.exited, true);
  });

  await check("the owner's Windows shell is a real terminal: PowerShell, size, resize, Enter as CR, Read-Host, close", async () => {
    const created = terminals.create({ project: windowsProject, rows: 24, cols: 100 });
    assert.equal(created.environment, "Windows");
    const read = () => terminalOutput.get(created.terminalId) || "";
    const type = (text) => terminals.write({ projectId: windowsProject.id, terminalId: created.terminalId, data: text });
    type("\"cols=\" + [Console]::WindowWidth + \" dir=\" + (Get-Location).Path + \" ed=\" + $PSVersionTable.PSEdition + \" v=\" + (6*7)\r");
    const first = await waitFor(read, /v=42/, "first command", 45_000);
    assert.match(first, /cols=100 /);
    assert.ok(first.toLowerCase().includes(winFolder.toLowerCase()), `ran in the project folder: ${first.slice(-800)}`);
    assert.match(shellNameOf(created), /powershell|pwsh/i, "the shell is named");
    terminals.resize({ projectId: windowsProject.id, terminalId: created.terminalId, rows: 30, cols: 120 });
    await sleep(300);
    type("\"w2=\" + [Console]::WindowWidth\r");
    await waitFor(read, /w2=120/, "resize");
    type("$answer = Read-Host 'name'; \"hello_\" + $answer\r");
    await waitFor(read, /name: ?$/m, "Read-Host prompt");
    type("rose\r");
    await waitFor(read, /hello_rose/, "Read-Host answer");
    type("exit 4\r");
    await waitFor(() => (terminalExits.has(created.terminalId) ? "exited" : ""), /exited/, "shell exit", 20_000);
    assert.equal(terminalExits.get(created.terminalId), 4);
  });

  await check("a project has at most a few open terminals", () => {
    assert.equal(MAX_TERMINALS_PER_PROJECT, 8);
    assert.throws(() => terminals.create({ project: {} }), (error) => error.code === "direct_terminal_project_required");
  });

  await check("an agent's exec_command tty in WSL: terminal, input, resize, replay, panel listing", async () => {
    const binding = bindingFor(wslProject, "wsl", "workspace");
    const started = manager.start({ ...binding, cmd: "[ -t 0 ] && echo stdin_is_tty; stty size; read -r line; echo got_$line; read -r again; stty size", tty: true, rows: 20, cols: 70 });
    const listed = manager.terminalSessions({ projectId: wslProject.id }).find((row) => row.sessionId === started.sessionId);
    assert.ok(listed, "the panel lists the agent's terminal");
    assert.deepEqual([listed.rows, listed.cols], [20, 70]);
    await waitFor(() => agentTerminalData.get(started.sessionId) || "", /20 70/, "agent terminal output");
    manager.writeStdin({ ...binding, sessionId: started.sessionId, chars: "hi\n" });
    await waitFor(() => agentTerminalData.get(started.sessionId) || "", /got_hi/, "agent input");
    manager.resize({ ...binding, sessionId: started.sessionId, rows: 33, cols: 99 });
    await sleep(300);
    manager.writeStdin({ ...binding, sessionId: started.sessionId, chars: "x\n" });
    const result = await manager.wait({ ...binding, sessionId: started.sessionId });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.transportMode, "pty");
    assert.match(result.stdoutPreview, /stdin_is_tty/);
    assert.match(result.stdoutPreview, /33 99/);
    assert.match(manager.terminalReplay({ sessionId: started.sessionId }).toString("utf8"), /got_hi/);
    const plain = manager.start({ ...binding, cmd: "echo plain" });
    assert.throws(() => manager.resize({ ...binding, sessionId: plain.sessionId, rows: 10, cols: 10 }), (error) => error.code === "direct_pty_not_a_terminal");
    await manager.wait({ ...binding, sessionId: plain.sessionId });
  });

  await check("an agent's exec_command tty in Windows: ConPTY, input, resize", async () => {
    const binding = bindingFor(windowsProject, "windows", "workspace");
    const started = manager.start({
      ...binding,
      cmd: "\"cols=\" + [Console]::WindowWidth; $l = Read-Host; \"got_\" + $l; $null = Read-Host; \"cols2=\" + [Console]::WindowWidth",
      tty: true,
      rows: 20,
      cols: 70,
    });
    await waitFor(() => agentTerminalData.get(started.sessionId) || "", /cols=70/, "agent ConPTY output", 45_000);
    manager.writeStdin({ ...binding, sessionId: started.sessionId, chars: "hi\r\n" });
    await waitFor(() => agentTerminalData.get(started.sessionId) || "", /got_hi/, "agent ConPTY input");
    manager.resize({ ...binding, sessionId: started.sessionId, rows: 33, cols: 99 });
    await sleep(500);
    manager.writeStdin({ ...binding, sessionId: started.sessionId, chars: "\r\n" });
    const result = await manager.wait({ ...binding, sessionId: started.sessionId });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.transportMode, "pty");
    assert.match(result.stdoutPreview, /cols2=99/);
  });

  await check("xterm is served from an allowlist", async () => {
    const server = new LocalSurfaceServer(path.join(repoRoot, "src", "renderer"));
    try {
      const base = await server.ensureStarted();
      for (const file of ["xterm.js", "xterm.css", "addon-fit.js"]) {
        const response = await fetch(`${base}/vendor/xterm/${file}`);
        assert.equal(response.status, 200, file);
        assert.ok((await response.text()).length > 1000, file);
      }
      assert.equal((await fetch(`${base}/vendor/xterm/package.json`)).status, 404);
    } finally {
      await server.dispose();
    }
  });

  await check("main, preload, and the panel are wired", () => {
    const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
    const main = read("src/main.js");
    for (const channel of ["list", "create", "write", "resize", "close", "replay"]) {
      assert.match(main, new RegExp(`ipcMain\\.handle\\("direct-terminal:${channel}"`), channel);
    }
    assert.match(main, /directTerminalService\?\.dispose\(\)/, "shutdown ends the owner's terminals");
    const preload = read("src/preload-codex-surface.js");
    for (const method of ["listDirectTerminals", "createDirectTerminal", "writeDirectTerminal", "resizeDirectTerminal", "closeDirectTerminal", "replayDirectTerminal", "onDirectTerminalEvent"]) {
      assert.match(preload, new RegExp(`${method}[:(]`), method);
    }
    const html = read("src/renderer/t3-direct-surface.html");
    assert.match(html, /<button id="t3TerminalButton" type="button"/);
    assert.doesNotMatch(html, /id="t3TerminalButton"[^>]*disabled/);
    const panel = read("src/renderer/direct-terminal-panel.js");
    assert.match(panel, /disableStdin: kind === "agent"/, "agents' terminals are read-only");
    const schema = read("src/main/direct/transport/codex-responses-transport.js");
    assert.match(schema, /tty: \{/);
  });

  console.log(JSON.stringify({ schema: "direct_terminal_pty_regression@1", status: "passed", hostPlatform: process.platform, checks }));
} finally {
  terminals.dispose();
  await manager.dispose("terminal-regression");
  workspaceBackends.disposeAll();
  // A shell that was just killed may still hold its folder for a moment.
  for (const [target, options] of [[winHostPath, { recursive: true }], [linuxHostPath(linuxFolder), { recursive: true }], [linuxHostPath(linuxOutside), {}]]) {
    try { fs.rmSync(target, { ...options, force: true, maxRetries: 10, retryDelay: 300 }); } catch (error) { console.error(`cleanup: ${error.message}`); }
  }
}
