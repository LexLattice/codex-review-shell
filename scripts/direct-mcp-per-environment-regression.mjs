#!/usr/bin/env node

// Turn 8 of the dual-environment track: configured MCP stdio servers run in
// their own environment. The host keeps trust, freshness, scope, and the
// result envelope; the environment's executor only runs the server. Runs on
// either host:
//   Windows:    node \\wsl.localhost\<distro>\<repo>\scripts\direct-mcp-per-environment-regression.mjs
//   Linux/WSL:  node scripts/direct-mcp-per-environment-regression.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildExternalCapabilityProfile,
  mcpServerIdentityFor,
} = require("../src/main/direct/external/external-capability-profile");
const {
  createDirectConfiguredMcpResolvers,
  disposeHostMcpSessions,
  hostMcpSessions,
  mcpPlacementFor,
  normalizeConfiguredMcpServer,
} = require("../src/main/direct/external/configured-mcp-adapter");
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");
const { EXECUTOR_METHODS } = require("../src/shared/executor-protocol");

const onWindows = process.platform === "win32";
const distro = onWindows ? (process.env.DIRECT_WSL_DISTRO || "Ubuntu") : process.env.WSL_DISTRO_NAME;
assert(distro, "this regression needs WSL (run inside WSL or on a Windows host with WSL)");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function windowsTemp() {
  if (onWindows) return os.tmpdir();
  const result = spawnSync("/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8", timeout: 20_000 });
  const value = String(result.stdout || "").trim();
  assert.match(value, /^[A-Za-z]:\\/, "could not read the Windows %TEMP%");
  return value;
}
const fromWindowsPath = (windowsPath) => (onWindows ? windowsPath : spawnSync("wslpath", ["-u", windowsPath], { encoding: "utf8" }).stdout.trim());
const fromLinuxPath = (linuxPath) => (onWindows ? `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, "\\")}` : linuxPath);

// Both variables cross into the other environment through WSLENV; only the
// allowlisted one may reach a server.
const ALLOWED = "DIRECT_MCP_ENV_ALLOWED";
const FORBIDDEN = "DIRECT_MCP_ENV_FORBIDDEN";
const savedEnv = { [ALLOWED]: process.env[ALLOWED], [FORBIDDEN]: process.env[FORBIDDEN], WSLENV: process.env.WSLENV };
process.env[ALLOWED] = "allowed-value";
process.env[FORBIDDEN] = "forbidden-value";
process.env.WSLENV = [process.env.WSLENV, ALLOWED, FORBIDDEN].filter(Boolean).join(":");

const serverScript = [
  "const readline = require('node:readline'), fs = require('node:fs'), os = require('node:os'), { spawn } = require('node:child_process');",
  "const beat = process.argv[2];",
  "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
  "  const q = JSON.parse(line);",
  "  if (q.id === undefined || q.id === null) return;",
  // The owner's answer to the form below: the read returns it, or fails
  // when declined.
  "  if (!q.method && q.id === 99) {",
  "    const reply = q.result && q.result.action === 'accept'",
  "      ? { result: { contents: [{ type: 'text', uri: 'mcp://env/owner', text: JSON.stringify(q.result.content || {}) }] } }",
  "      : { error: { code: -32000, message: 'owner answered ' + (q.result && q.result.action) } };",
  "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: globalThis.ownerReadId, ...reply }) + '\\n');",
  "    return;",
  "  }",
  "  let result = {};",
  "  if (q.method === 'resources/list') result = { resources: [{ uri: 'mcp://env/where', name: 'Where' }] };",
  "  if (q.method === 'resources/read') {",
  "    const uri = q.params.uri;",
  "    if (uri === 'mcp://env/owner') { globalThis.ownerReadId = q.id; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'elicitation/create', params: { mode: 'form', message: 'Which name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } } }) + '\\n'); return; }",
  "    if (uri === 'mcp://env/slow') return;",
  "    let text = '';",
  "    if (uri === 'mcp://env/where') text = JSON.stringify({ platform: process.platform, release: os.release(), cwd: process.cwd(), allowed: process.env." + ALLOWED + " || '', forbidden: process.env." + FORBIDDEN + " || '' });",
  "    if (uri === 'mcp://env/grandchild') {",
  "      const child = spawn(process.execPath, ['-e', 'const w = () => require(\"fs\").writeFileSync(' + JSON.stringify(beat) + ', String(Date.now())); w(); setInterval(w, 100)'], { detached: true, stdio: 'ignore' });",
  "      child.unref();",
  "      const reply = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: { contents: [{ type: 'text', uri, text: 'started' }] } }) + '\\n');",
  "      const waitForBeat = () => (fs.existsSync(beat) ? reply() : setTimeout(waitForBeat, 50));",
  "      waitForBeat();",
  "      return;",
  "    }",
  "    result = uri === 'mcp://env/launder'",
  "      ? { contents: [{ type: 'text', uri: 'mcp://foreign/resource', text: 'laundered' }] }",
  "      : { contents: [{ type: 'text', uri, text, mimeType: 'application/json' }] };",
  "  }",
  "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\\n');",
  "});",
].join("\n");

const report = { schema: "direct_mcp_per_environment_regression_report@1", hostPlatform: process.platform, distro, checks: [] };
const suffix = crypto.randomBytes(6).toString("hex");
const linuxDir = `/tmp/direct-mcp-env-${suffix}`;
const windowsDir = `${windowsTemp()}\\direct-mcp-env-${suffix}`;
const linuxDirHost = fromLinuxPath(linuxDir);
const windowsDirHost = fromWindowsPath(windowsDir);
await fs.mkdir(linuxDirHost, { recursive: true });
await fs.mkdir(windowsDirHost, { recursive: true });
await fs.writeFile(path.join(linuxDirHost, "server.js"), serverScript);
await fs.writeFile(path.join(windowsDirHost, "server.js"), serverScript);

const projectId = "project_mcp_per_environment";
const workThreadId = "work_thread_mcp_per_environment";
const threadId = "task_mcp_per_environment";
const workspaceBackends = new WorkspaceBackendManager({
  agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"),
  fallbackRoot: repoRoot,
});
const resolvers = createDirectConfiguredMcpResolvers({ executors: workspaceBackends });

// Each host places one server on itself, one in its project's other
// environment, and one in an explicitly named other environment.
const linuxSide = { dir: linuxDir, dirHost: linuxDirHost, script: `${linuxDir}/server.js`, beat: (name) => `${linuxDir}/${name}.beat`, platform: "linux" };
const windowsSide = { dir: windowsDir, dirHost: windowsDirHost, script: `${windowsDir}\\server.js`, beat: (name) => `${windowsDir}\\${name}.beat`, platform: "win32" };
const hostSide = onWindows ? windowsSide : linuxSide;
const otherSide = onWindows ? linuxSide : windowsSide;
const otherKind = onWindows ? "wsl" : "windows";
const otherWorkspace = onWindows ? { kind: "wsl", distro, linuxPath: linuxDir } : { kind: "windows", windowsPath: windowsDir };

function serverConfig(serverIdentityId, side, extra = {}) {
  return normalizeConfiguredMcpServer({
    serverIdentityId,
    displayName: serverIdentityId,
    transport: "stdio",
    command: side === hostSide ? process.execPath : "node",
    args: [side.script, side.beat(serverIdentityId)],
    projectId,
    workThreadId,
    trustState: "configured",
    enabledState: "enabled",
    freshness: "fresh",
    authPosture: "local_config",
    processEnv: [ALLOWED],
    ...extra,
  });
}

function projectWith(workspace, servers) {
  return { id: projectId, name: "MCP per environment", workThreadId, workspace, mcpServers: servers };
}

// The profile's default capability witnesses name this identity.
const witnessFixture = normalizeConfiguredMcpServer({
  serverIdentityId: "mcp_server_project_fixture",
  transport: "stdio",
  trustState: "configured",
  enabledState: "enabled",
  freshness: "fresh",
  authPosture: "local_config",
});

function profileFor(servers) {
  return buildExternalCapabilityProfile({
    projectId,
    workThreadId,
    serverIdentities: [...servers, witnessFixture].map((server) => mcpServerIdentityFor({
      serverIdentityId: server.serverIdentityId,
      displayName: server.displayName,
      selectorKey: server.selectorKey,
      transportKind: server.transportKind,
      authPosture: server.authPosture,
      trustState: server.trustState,
      enabledState: server.enabledState,
      freshness: server.freshness,
    })),
  });
}

async function read(project, server, resourceUri, extra = {}) {
  return resolvers.mcpResourceReadResolver({
    project,
    profile: profileFor(project.mcpServers),
    projectId,
    workThreadId,
    threadId,
    arguments: { serverIdentityId: server.serverIdentityId, resourceUri },
    ...extra,
  });
}

async function where(project, server) {
  return JSON.parse((await read(project, server, "mcp://env/where")).payload);
}

// The server only answers once its child has written a first heartbeat, so
// a heartbeat that stops changing means the child was killed.
async function heartbeatStopped(side, name) {
  const file = path.join(side.dirHost, `${name}.beat`);
  await sleep(1_500);
  const first = await fs.readFile(file, "utf8");
  await sleep(800);
  return (await fs.readFile(file, "utf8")) === first;
}

try {
  // 1. Config: where a server runs.
  assert.deepEqual({ ...serverConfig("defaults", hostSide).runsIn }, { kind: "project", distro: "" });
  assert.equal(serverConfig("host", hostSide, { runsIn: "local" }).runsIn.kind, "host");
  assert.deepEqual({ ...serverConfig("flat", hostSide, { environmentKind: "wsl", distro: "Ubuntu" }).runsIn }, { kind: "wsl", distro: "Ubuntu" });
  assert.equal(serverConfig("bogus", hostSide, { runsIn: { kind: "mars" } }).runsIn.kind, "project");
  const neverLocal = { workspaceLocalityResolver: () => false };
  const wslProject = { id: "p", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/w" } };
  assert.equal(mcpPlacementFor(serverConfig("a", hostSide), wslProject, neverLocal).executorProject, wslProject);
  assert.equal(mcpPlacementFor(serverConfig("b", hostSide, { runsIn: "host" }), wslProject, neverLocal).local, true);
  assert.throws(
    () => mcpPlacementFor(serverConfig("c", hostSide, { runsIn: { kind: "windows" } }), wslProject, neverLocal),
    (error) => error.code === "direct_mcp_environment_root_required",
  );
  const named = mcpPlacementFor(serverConfig("d", hostSide, { runsIn: { kind: "windows" }, cwd: "C:\\w" }), wslProject, neverLocal);
  assert.deepEqual(named.executorProject.workspace, { kind: "windows", windowsPath: "C:\\w" });
  report.checks.push("placement_rules");

  // 2. A server on this host runs here, with only allowlisted variables.
  const local = serverConfig("mcp_local", hostSide, { runsIn: "host" });
  const localProject = projectWith({ kind: "local", localPath: hostSide.dirHost }, [local]);
  const localWhere = await where(localProject, local);
  assert.equal(localWhere.platform, process.platform);
  assert.equal(localWhere.allowed, "allowed-value");
  assert.equal(localWhere.forbidden, "");
  report.checks.push("host_server_runs_on_host");

  // 3. A server in the project's environment runs in that environment's
  // executor (WSL from Windows, Windows from WSL), cwd defaulting to the
  // project folder there.
  const inProject = serverConfig("mcp_project_env", otherSide);
  const otherProject = projectWith(otherWorkspace, [inProject]);
  const projectWhere = await where(otherProject, inProject);
  assert.equal(projectWhere.platform, otherSide.platform);
  assert.equal(projectWhere.cwd.toLowerCase(), otherSide.dir.toLowerCase());
  assert.equal(projectWhere.allowed, "allowed-value", "allowlisted values come from the server's environment");
  assert.equal(projectWhere.forbidden, "", "nothing else crosses");
  if (otherSide.platform === "linux") assert.match(projectWhere.release, /microsoft|wsl/i);
  report.checks.push(`project_server_runs_in_${otherKind}`);

  // 4. A server in an explicitly named other environment, from a local
  // project, runs in an executor anchored at its cwd.
  const namedServer = serverConfig("mcp_named_env", otherSide, {
    runsIn: onWindows ? { kind: "wsl", distro } : { kind: "windows" },
    cwd: otherSide.dir,
  });
  const namedProject = projectWith({ kind: "local", localPath: hostSide.dirHost }, [namedServer]);
  const namedWhere = await where(namedProject, namedServer);
  assert.equal(namedWhere.platform, otherSide.platform);
  assert.equal(namedWhere.cwd.toLowerCase(), otherSide.dir.toLowerCase());
  const rootless = serverConfig("mcp_named_rootless", otherSide, { runsIn: onWindows ? { kind: "wsl", distro } : { kind: "windows" } });
  await assert.rejects(
    () => read(projectWith({ kind: "local", localPath: hostSide.dirHost }, [rootless]), rootless, "mcp://env/where"),
    (error) => error.code === "direct_mcp_environment_root_required",
  );
  report.checks.push(`named_server_runs_in_${otherKind}`);

  // 5. The host still owns the envelope for remote servers. A server's form
  // reaches the host's owner through the executor and the answer goes back
  // (the host's clock stops while the owner answers, longer than the
  // request's timeout here); with nobody to ask, the form is declined.
  await assert.rejects(
    () => read(otherProject, inProject, "mcp://env/launder"),
    (error) => error.code === "direct_mcp_resource_result_scope_mismatch",
  );
  await assert.rejects(
    () => read(otherProject, inProject, "mcp://env/owner"),
    (error) => error.code === "direct_mcp_rpc_error" && /decline/.test(error.message),
  );
  const forms = [];
  const answeredRemote = await read(otherProject, inProject, "mcp://env/owner", {
    timeoutMs: 1_000,
    onElicitation: async (params) => {
      forms.push(params);
      await new Promise((resolve) => setTimeout(resolve, 7_000));
      return { action: "accept", content: { name: "Ada" } };
    },
  });
  assert.equal(forms[0]?.message, "Which name?");
  assert.deepEqual(JSON.parse(answeredRemote.payload), { name: "Ada" });
  report.checks.push("remote_server_form_reaches_owner");

  // The other environment's Codex context and hooks come from its executor
  // (codex/context, hook/run): read there, run there.
  const remoteContext = await workspaceBackends.requestForProject(otherProject, EXECUTOR_METHODS.codexContext, {}, 20_000);
  assert.equal(remoteContext.schema, "direct_codex_environment_context@1");
  assert.equal(remoteContext.platform, otherSide.platform);
  const hookCommand = otherSide.platform === "win32"
    ? "$in = [Console]::In.ReadToEnd(); Write-Output (\"hook:\" + ($in | ConvertFrom-Json).probe + \":\" + (Get-Location).Path)"
    : "read -r line; echo \"hook:$(printf '%s' \"$line\" | sed 's/.*\"probe\":\"\\([^\"]*\\)\".*/\\1/'):$(pwd)\"";
  const hookResult = await workspaceBackends.requestForProject(otherProject, EXECUTOR_METHODS.hookRun, {
    hook: { command: hookCommand, commandWindows: hookCommand },
    stdin: JSON.stringify({ probe: "p1" }),
    timeoutMs: 20_000,
  }, 30_000);
  assert.equal(hookResult.exitCode, 0, JSON.stringify(hookResult));
  assert.equal(hookResult.stdout.trim().toLowerCase(), `hook:p1:${otherSide.dir}`.toLowerCase(), "the hook ran in the other environment, in the project folder");
  report.checks.push("remote_codex_context_and_hooks");
  const listed = await resolvers.externalDiscoveryResolver({
    project: otherProject,
    profile: profileFor(otherProject.mcpServers),
    projectId,
    workThreadId,
    threadId,
    toolName: "list_mcp_resources",
    arguments: { serverIdentityId: inProject.serverIdentityId },
  });
  assert.deepEqual(listed.resourceDescriptors.map((row) => row.uri), ["mcp://env/where"]);
  report.checks.push("host_keeps_envelope_for_remote_servers");

  // 6. Containment: servers are long-lived (one per environment and config,
  // reused), and whatever a server starts dies with its session (job runner
  // on Windows, PID namespace on Linux): for the host's own servers when the
  // host's sessions end, and for an executor's servers when the executor
  // stops.
  const hostStarted = hostMcpSessions.started;
  await read(localProject, local, "mcp://env/where");
  await read(localProject, local, "mcp://env/where");
  assert(hostMcpSessions.started - hostStarted <= 1, "repeated requests reuse one host server");
  const contained = [
    [otherSide, otherProject, inProject, () => workspaceBackends.disposeForProject(otherProject)],
    [hostSide, localProject, local, () => disposeHostMcpSessions()],
  ];
  for (const [side, project, server, endSessions] of contained) {
    const result = await read(project, server, "mcp://env/grandchild");
    assert.equal(result.payload, "started");
    assert.equal(await heartbeatStopped(side, server.serverIdentityId), false, `${side.platform}: the server and its child stay up between requests`);
    await endSessions();
    assert.equal(await heartbeatStopped(side, server.serverIdentityId), true, `${side.platform}: the server's child is reaped with its session`);
  }
  report.checks.push("long_lived_servers_children_reaped_with_session");

  // 7. Cancelling a remote request returns promptly.
  const controller = new AbortController();
  const startedAt = Date.now();
  const slow = read(otherProject, inProject, "mcp://env/slow", { signal: controller.signal, timeoutMs: 30_000 });
  setTimeout(() => controller.abort(), 1_500);
  await assert.rejects(slow, (error) => error.code === "direct_mcp_request_aborted");
  assert(Date.now() - startedAt < 10_000, "cancel does not wait for the server's timeout");
  report.checks.push("remote_request_cancel");

  report.status = "passed";
  console.log(JSON.stringify(report));
} finally {
  await disposeHostMcpSessions().catch(() => {});
  workspaceBackends.disposeAll();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await sleep(500);
  await fs.rm(linuxDirHost, { recursive: true, force: true }).catch(() => {});
  await fs.rm(windowsDirHost, { recursive: true, force: true }).catch(() => {});
}
