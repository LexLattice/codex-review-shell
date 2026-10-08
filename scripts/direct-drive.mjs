#!/usr/bin/env node
// Drives the real Direct app headlessly for testing: starts it hidden with an
// isolated test profile and its test control port, then runs turns in test
// threads and prints what happened (requests, tokens, tool calls, reply).
//
//   node scripts/direct-drive.mjs start                # launch (Windows: synced test mirror; Linux/WSL: xvfb)
//   node scripts/direct-drive.mjs project-add --name T --env windows --path C:\DirectTests\t
//   node scripts/direct-drive.mjs chat --project <id> "prompt"      # new thread, gpt-6-luna, low
//   node scripts/direct-drive.mjs chat --project <id> --thread last "follow-up"
//   node scripts/direct-drive.mjs report --thread last
//   node scripts/direct-drive.mjs stop
//
// Runs on the host whose app it drives: Windows Node for the Windows app,
// WSL Node for the Linux app. Every command prints `--help`-free usage on error.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL_FILE_NAME = "direct-test-control.json";
const STATE_FILE_NAME = "direct-drive-state.json";
const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_EFFORT = "low";
const DEFAULT_ACCESS = "full_access";
const isWindows = process.platform === "win32";

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) options[raw.slice(0, equals)] = raw.slice(equals + 1);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) options[raw] = argv[++index];
    else options[raw] = true;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const command = options._.shift() || "help";

function fail(message, code = 1) {
  console.error(`direct-drive: ${message}`);
  process.exit(code);
}

function profileDir() {
  if (options.profile) return path.resolve(String(options.profile));
  if (process.env.DIRECT_TEST_PROFILE) return path.resolve(process.env.DIRECT_TEST_PROFILE);
  return isWindows
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "direct-test", "profile")
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "direct-test", "profile");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readState() {
  return readJson(path.join(profileDir(), STATE_FILE_NAME), {}) || {};
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.mkdirSync(profileDir(), { recursive: true });
  fs.writeFileSync(path.join(profileDir(), STATE_FILE_NAME), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function controlInfo() {
  const info = readJson(path.join(profileDir(), CONTROL_FILE_NAME));
  return info && pidAlive(info.pid) ? info : null;
}

async function call(method, route, body, info = controlInfo()) {
  if (!info) fail("the test app isn't running; run `start` first.");
  const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });
  const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }));
  if (!result.ok) fail(`${route}: ${result.error?.code || response.status} ${result.error?.message || ""}`.trim());
  return result;
}

const get = (route) => call("GET", route);
const post = (route, body) => call("POST", route, body);

function print(value) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

// \\wsl.localhost\<distro>\<path> → { distro, linuxPath }
function wslSourceOfRepo() {
  const match = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)$/i.exec(repoRoot);
  return match ? { distro: match[1], linuxPath: match[2].replace(/\\/g, "/") } : null;
}

function windowsTestMirror() {
  return path.resolve(String(options.mirror || process.env.DIRECT_TEST_MIRROR || "C:\\LexLattice\\direct-test-mirror"));
}

// The Windows app runs from its own mirror of the WSL checkout (Windows
// node_modules), separate from the owner's app and its launcher.
function syncWindowsMirror() {
  const source = wslSourceOfRepo();
  if (!source) return repoRoot;
  const mirror = windowsTestMirror();
  fs.mkdirSync(mirror, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "sync-from-wsl.cmd"), path.join(mirror, "sync-from-wsl.cmd"));
  console.error(`direct-drive: syncing ${mirror} from WSL (npm install runs when dependencies changed)…`);
  const synced = spawnSync("cmd.exe", ["/d", "/c", path.join(mirror, "sync-from-wsl.cmd")], {
    cwd: mirror,
    env: { ...process.env, CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO: source.distro, CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: source.linuxPath },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  if (synced.status !== 0) fail(`syncing the Windows test mirror failed (exit ${synced.status}).`);
  return mirror;
}

// A process started from a tool runner or terminal belongs to its job object
// and dies with it, detached or not. WMI's Win32_Process.Create starts the app
// outside any caller's job, hidden, as a normal launch would be.
function launchOutsideCallerJob(appRoot, env, logPath) {
  const keys = ["CODEX_EXPERIENCE", "CODEX_REVIEW_SHELL_USER_DATA_DIR", "CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH", "DIRECT_TEST_CONTROL", "DIRECT_TEST_CONTROL_SHOW"];
  const launcher = path.join(profileDir(), "launch-test-app.cmd");
  fs.writeFileSync(launcher, [
    "@echo off",
    "set \"ELECTRON_RUN_AS_NODE=\"",
    ...keys.filter((key) => env[key] !== undefined).map((key) => `set "${key}=${env[key]}"`),
    `cd /d "${appRoot}"`,
    `"${process.execPath}" scripts\\run-electron.mjs . >> "${logPath}" 2>&1`,
    "",
  ].join("\r\n"));
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const script = [
    "$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
    `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quote(`cmd.exe /d /c "${launcher}"`)}; CurrentDirectory = ${quote(appRoot)}; ProcessStartupInformation = $startup }`,
    "if ($result.ReturnValue -ne 0) { Write-Error \"Win32_Process.Create returned $($result.ReturnValue)\"; exit 1 }",
  ].join("; ");
  const launched = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (launched.status !== 0) fail(`launching the app failed: ${launched.stderr || launched.stdout}`);
}

async function start() {
  const running = controlInfo();
  if (running && !options.restart) {
    print({ running: true, pid: running.pid, port: running.port, profile: profileDir() });
    return;
  }
  if (running) await stop();
  const profile = profileDir();
  if (options.fresh) fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.rmSync(path.join(profile, CONTROL_FILE_NAME), { force: true });
  const appRoot = isWindows ? syncWindowsMirror() : repoRoot;
  const env = {
    ...process.env,
    CODEX_EXPERIENCE: "direct-workbench",
    CODEX_REVIEW_SHELL_USER_DATA_DIR: profile,
    CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
    DIRECT_TEST_CONTROL: "1",
    ...(options.show ? { DIRECT_TEST_CONTROL_SHOW: "1" } : {}),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CODEX_WORLD_MANAGER;
  delete env.CODEX_WORLD_MANAGER_MOCKUP;
  delete env.CODEX_DIRECT_T3_GUI;
  const logPath = path.join(profile, "app.log");
  const log = fs.openSync(logPath, "a");
  let child = null;
  if (isWindows) {
    fs.closeSync(log);
    launchOutsideCallerJob(appRoot, env, logPath);
  } else {
    env.LIBGL_ALWAYS_SOFTWARE = "1";
    const electronArgs = ["scripts/run-electron.mjs", ".", "--disable-gpu"];
    child = !env.DISPLAY || options.xvfb
      ? spawn("xvfb-run", ["-a", process.execPath, ...electronArgs], { cwd: appRoot, env, detached: true, stdio: ["ignore", log, log] })
      : spawn(process.execPath, electronArgs, { cwd: appRoot, env, detached: true, stdio: ["ignore", log, log] });
  }
  child?.unref();
  const deadline = Date.now() + (Number(options["start-timeout-ms"]) || 120_000);
  while (Date.now() < deadline) {
    const info = controlInfo();
    if (info) {
      const status = await call("GET", "/v1/status", null, info).catch(() => null);
      if (status) {
        writeState({ launcherPid: child?.pid || 0 });
        print({ running: true, pid: info.pid, port: info.port, profile, appRoot, auth: status.auth, log: logPath });
        if (status.auth?.status !== "authenticated") console.error("direct-drive: not signed in; the test profile uses the Codex CLI login (~/.codex/auth.json).");
        return;
      }
    }
    if (child && child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").split("\n").slice(-25).join("\n") : "";
  fail(`the app didn't open its test control port. Last log lines (${logPath}):\n${tail}`);
}

async function stop() {
  const info = controlInfo();
  if (!info) {
    print({ running: false });
    return;
  }
  await call("POST", "/v1/shutdown", {}, info).catch(() => {});
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && pidAlive(info.pid)) await new Promise((resolve) => setTimeout(resolve, 300));
  if (pidAlive(info.pid)) {
    try {
      process.kill(info.pid);
    } catch {}
  }
  fs.rmSync(path.join(profileDir(), CONTROL_FILE_NAME), { force: true });
  print({ running: false, stopped: info.pid });
}

function resolveProjectId() {
  const value = String(options.project || "");
  if (value && value !== "last") return value;
  const last = readState().lastProjectId;
  if (!last) fail("pass --project <id> (see `projects`).");
  return last;
}

function resolveThreadId() {
  const value = String(options.thread || "");
  if (value && value !== "last") return value;
  const last = readState().lastThreadId;
  if (!last) fail("no earlier thread; pass --thread <id>.");
  return last;
}

async function projectAdd() {
  const env = String(options.env || (isWindows ? "windows" : "local"));
  const folder = String(options.path || "");
  if (!folder) fail("project-add needs --path <folder> (created if missing).");
  const workspace = env === "wsl"
    ? { kind: "wsl", distro: String(options.distro || "Ubuntu"), linuxPath: folder }
    : env === "windows"
      ? { kind: "windows", windowsPath: folder }
      : { kind: "local", localPath: folder };
  const result = await post("/v1/projects", { name: options.name || path.basename(folder), workspace });
  writeState({ lastProjectId: result.project.id });
  print(result.project);
}

async function newThread(projectId) {
  const result = await post("/v1/threads", {
    projectId,
    title: options.title,
    model: options.model || DEFAULT_MODEL,
    reasoningEffort: options.effort || DEFAULT_EFFORT,
    accessProfile: options.access || DEFAULT_ACCESS,
  });
  writeState({ lastProjectId: projectId, lastThreadId: result.threadId });
  return result;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatReport(report, extra = {}) {
  const lines = [];
  const seconds = report.durationMs ? `${(report.durationMs / 1000).toFixed(1)}s` : "?";
  lines.push(`turn ${report.turnId} · thread ${report.threadId}`);
  lines.push(`${report.model || "?"}/${report.reasoningEffort || "default"} · ${report.state} in ${seconds}${extra.stopPressed ? " · Stop pressed" : ""}`);
  if (report.error) lines.push(`error: ${report.error.code} ${report.error.message}`);
  if (report.user) lines.push(`user: ${report.user}`);
  const t = report.totals || {};
  lines.push(`requests ${t.requests} · tool calls ${t.toolCalls} · in ${formatNumber(t.inputTokens)} (cached ${formatNumber(t.cachedInputTokens)}) · out ${formatNumber(t.outputTokens)}`);
  const ms = (value) => `${(Number(value || 0) / 1000).toFixed(1)}s`;
  for (const request of report.requests || []) {
    const shape = request.toolsDeclared === undefined ? "" : ` · tools ${request.toolsDeclared} · input items ${request.inputItems} · call outputs ${request.callOutputs}`;
    const timing = request.timing
      ? ` · wait ${ms(request.timing.waitMs)} · model ${request.timing.modelMs === undefined ? "?" : ms(request.timing.modelMs)}`
      : "";
    lines.push(`  #${request.n}${shape} · in ${formatNumber(request.inputTokens)} · out ${formatNumber(request.outputTokens)}${timing}`);
  }
  if ((report.timeline || []).length) {
    lines.push(`timeline: ${report.timeline.map((entry) => `${entry.phase} ${ms(entry.ms)}`).join(" · ")}`);
  }
  for (const call of report.toolCalls || []) {
    const exec = call.execMs !== undefined ? ` [exec ${call.execMs === null ? `still ${call.execState || "running"}` : ms(call.execMs)}]` : "";
    lines.push(`  ${call.n}. [step ${call.step ?? "?"}] ${call.tool} ${call.args || ""} → ${call.status}${call.failure ? ` (${call.failure})` : ""}${exec}`);
    if (call.output) lines.push(`     ${call.output.replace(/\n/g, "\n     ")}`);
  }
  for (const decision of extra.ownerDecisions || []) lines.push(`  owner: ${decision.decision} ${decision.method} ${decision.summary || ""}`);
  for (const warning of extra.warnings || []) lines.push(`  warning: ${warning}`);
  for (const pending of extra.pendingOwnerRequests || []) lines.push(`  PENDING ${pending.key} ${pending.method} ${pending.summary || ""}`);
  lines.push("assistant:");
  lines.push(report.assistant ? `  ${report.assistant.replace(/\n/g, "\n  ")}` : "  (no reply)");
  return lines.join("\n");
}

function textLimit() {
  if (options.full) return 0;
  return options["text-limit"] !== undefined ? Number(options["text-limit"]) : undefined;
}

async function chat() {
  // A prompt file avoids shell quoting (PowerShell → wsl.exe → bash mangles $, quotes).
  const text = options["prompt-file"]
    ? fs.readFileSync(String(options["prompt-file"]), "utf8").trim()
    : options._.join(" ").trim() || (typeof options.prompt === "string" ? options.prompt : "");
  if (!text) fail('chat needs a prompt: chat --project <id> "text"');
  const projectId = resolveProjectId();
  const threadId = options.thread ? resolveThreadId() : (await newThread(projectId)).threadId;
  writeState({ lastProjectId: projectId, lastThreadId: threadId });
  const started = await post("/v1/turns", {
    projectId,
    threadId,
    text,
    model: options.model || DEFAULT_MODEL,
    reasoningEffort: options.effort || DEFAULT_EFFORT,
  });
  writeState({ lastTurnId: started.turnId });
  const waited = await post("/v1/turns/wait", {
    projectId,
    threadId,
    turnId: started.turnId,
    approvals: options.approvals || "approve",
    answer: options.answer,
    stopAfterMs: Number(options["stop-after-ms"]) || 0,
    stopAfterToolCalls: Number(options["stop-after-calls"]) || 0,
    timeoutMs: Number(options["timeout-ms"]) || undefined,
    textLimit: textLimit(),
    rawOutputs: options.raw === true,
  });
  const events = await get(`/v1/events?projectId=${encodeURIComponent(projectId)}&since=${started.eventSeq}`);
  const warnings = events.events
    .filter((event) => event.method === "warning" && (!event.turnId || event.turnId === started.turnId))
    .map((event) => event.message);
  if (options.json) print({ ...waited, warnings });
  else print(formatReport(waited.report, { ...waited, warnings }));
  if (waited.outcome === "timeout") process.exitCode = 3;
}

async function report() {
  const projectId = options.project ? resolveProjectId() : readState().lastProjectId;
  const threadId = resolveThreadId();
  const limit = textLimit();
  const query = `threadId=${encodeURIComponent(threadId)}${limit !== undefined ? `&textLimit=${limit}` : ""}${options.raw ? "&raw=1" : ""}`;
  if (options.turn) {
    const turnId = options.turn === "last" ? readState().lastTurnId : String(options.turn);
    const result = await get(`/v1/turns/report?${query}&turnId=${encodeURIComponent(turnId)}`);
    print(options.json ? result.report : formatReport(result.report));
    return;
  }
  const result = await get(`/v1/threads/report?${query}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`);
  if (options.json) print(result);
  else print([`thread ${result.thread.threadId} · ${result.thread.model}/${result.thread.reasoningEffort} · ${result.thread.accessProfile || "default access"}`, ...result.turns.map((turn) => formatReport(turn))].join("\n\n"));
}

const usage = `usage: node scripts/direct-drive.mjs <command> [options]
  start [--show] [--fresh] [--restart]     launch the app hidden with the test profile
  stop | status
  projects                                 list test projects
  project-add --path P [--env windows|wsl|local] [--distro Ubuntu] [--name N]
  thread --project ID [--model M] [--effort E] [--access full_access|workspace|read_only]
  chat --project ID [--thread ID|last] "prompt" | --prompt-file FILE
       [--model ${DEFAULT_MODEL}] [--effort ${DEFAULT_EFFORT}] [--access ${DEFAULT_ACCESS}]
       [--approvals approve|decline|pending] [--answer TEXT]
       [--stop-after-ms N] [--stop-after-calls N] [--timeout-ms N]
       [--json] [--full | --text-limit N] [--raw (tool outputs as sent to the model)]
  stop-turn --thread ID|last --turn ID|last
  respond --key KEY [--decision approve|decline] [--answer TEXT]
  report --thread ID|last [--turn ID|last] [--json] [--full]
  events [--since N]
  request --method M [--params JSON]       any runtime request (escape hatch)
  options: --project last|ID, --profile DIR (default ${profileDir()})`;

const commands = {
  help: async () => print(usage),
  start,
  stop,
  status: async () => print(controlInfo() ? await get("/v1/status") : { running: false, profile: profileDir() }),
  projects: async () => print((await get("/v1/projects")).projects),
  "project-add": projectAdd,
  thread: async () => print(await newThread(resolveProjectId())),
  chat,
  "stop-turn": async () => {
    const turnId = !options.turn || options.turn === "last" ? readState().lastTurnId : String(options.turn);
    print(await post("/v1/turns/interrupt", { projectId: resolveProjectId(), threadId: resolveThreadId(), turnId }));
  },
  respond: async () => print(await post("/v1/respond", {
    projectId: resolveProjectId(),
    key: options.key,
    decision: options.decision || "approve",
    answer: options.answer,
  })),
  report,
  events: async () => print(await get(`/v1/events?projectId=${encodeURIComponent(resolveProjectId())}&since=${Number(options.since) || 0}`)),
  request: async () => print(await post("/v1/request", {
    projectId: resolveProjectId(),
    method: options.method,
    params: options.params ? JSON.parse(String(options.params)) : {},
  })),
};

const handler = commands[command];
if (!handler) fail(`unknown command "${command}".\n${usage}`, 2);
await handler();
