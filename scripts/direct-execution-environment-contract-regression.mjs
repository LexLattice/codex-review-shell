#!/usr/bin/env node

// Each thread's model contract names the environment its tools run in: the
// OS, the shell exec_command uses, path style, line endings, and what the
// access profile allows. WSL threads see bash and POSIX paths; Windows
// threads see PowerShell and Windows paths. Runs on Linux and Windows hosts.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EXECUTION_ENVIRONMENT_FACTS_SCHEMA,
  applyEnvironmentToToolSchemas,
  nativeShellCommand,
  renderExecutionEnvironmentInstructions,
  resolveExecutionEnvironmentFacts,
  selfConstitutionEnvironmentProjection,
} = require("../src/main/direct/runtime/execution-environment-contract");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { LocalChildProcessBackend } = require("../src/main/direct/tools/exec-process-backends");

const projectId = "project_environment_contract";
const rawWorkspacePath = "/home/fixture/secret-checkout-path";
const rawWindowsPath = "C:\\Users\\fixture\\secret-checkout-path";
const capabilities = ["apply_patch", "exec_command", "read_file", "update_plan", "write_stdin"];

function grantFor(threadId, kind, accessProfile) {
  return DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId,
    executionEnvironment: { environmentId: `env_${threadId}`, kind, bindingDigest: `sha256:${threadId}` },
    capabilities,
    accessProfile,
  });
}

const fixtureTools = [
  { type: "function", name: "exec_command", description: "generic", parameters: { type: "object", properties: { cmd: { type: "string" }, cwd: { type: "string" } } } },
  { type: "function", name: "apply_patch", description: "generic", parameters: { type: "object", properties: { patch: { type: "string" } } } },
  { type: "function", name: "read_file", description: "generic", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { type: "function", name: "update_plan", description: "unchanged", parameters: { type: "object", properties: {} } },
];

function sseResponse(responseId) {
  return new Response([
    "event: response.created",
    `data: {"response":{"id":"${responseId}","model":"gpt-5.4"}}`,
    "",
    "event: response.output_text.delta",
    `data: {"item_id":"msg_${responseId}","delta":"Done."}`,
    "",
    "event: response.completed",
    `data: {"response":{"id":"${responseId}","status":"completed"}}`,
    "",
  ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function runTurn(root, { threadId, workspace, accessProfile }) {
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, threadId) });
  const session = sessionStore.createSession({
    sessionId: threadId,
    projectId,
    title: threadId,
    model: "gpt-5.4",
    reasoningEffort: "high",
    workspace,
    runtimeMode: "direct-experimental",
    directTransport: "live-text",
    directTier: "implementation-lane",
    nativeDirectSession: true,
  });
  const project = {
    id: projectId,
    workspace,
    surfaceBinding: { codex: { runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "implementation-lane", model: "gpt-5.4", profileId: "environment-contract-profile" } },
  };
  const grant = grantFor(threadId, workspace.kind, accessProfile);
  const requests = [];
  const controller = new DirectLiveTextController({
    sessionStore,
    harnessGrantResolver: () => grant,
    profileDoc: {
      profile: {
        profileId: "environment-contract-profile",
        ontology: {
          models: [{ id: "gpt-5.4", displayName: "GPT-5.4", status: "accepted" }],
          continuationShapes: [{ id: "continuation.tool_result", field: "tool-result continuation", status: "accepted" }],
        },
      },
    },
    authStore: {
      readStatus: () => ({ status: "authenticated", accountId: "fixture-account", hasAccessToken: true, hasRefreshToken: true, storageMode: "memory" }),
      readCredentials: () => ({ accessToken: "fixture-access-token", accountId: "fixture-account" }),
    },
    activeSubAgentPolicySemanticPreflight: async () => null,
    fetchImpl: async (_url, init = {}) => {
      requests.push(JSON.parse(String(init.body || "{}")));
      return sseResponse(`resp_${threadId}_${requests.length}`);
    },
  });
  const started = await controller.startTurn({
    sessionId: session.sessionId,
    clientTurnRequestId: `client_${threadId}`,
    promptText: "List the project files.",
    model: "gpt-5.4",
    effort: "high",
  }, { project, surfaceSession: { sendEvent: () => {} } });
  await controller.waitForTurnCompletion({ sessionId: session.sessionId, turnId: started.turn.id });
  const turn = sessionStore.readTurn(session.sessionId, started.turn.id);
  const toolRequest = requests.find((body) => Array.isArray(body.tools) && body.tools.some((tool) => tool.name === "exec_command"));
  assert(toolRequest, `${threadId}: a request declared exec_command`);
  return { turn, toolRequest, snapshot: controller.compileSelfConstitutionSnapshot({ project, session: sessionStore.readSession(threadId), harnessGrant: grant }) };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-environment-contract-"));
  const report = { schema: "direct_execution_environment_contract_regression_report@1", host: process.platform, checks: [] };
  try {
    // 1. Native shell planning, per platform.
    const linuxBash = nativeShellCommand("echo hi", { platform: "linux", env: {}, fileExists: (file) => file === "/bin/bash" });
    assert.deepEqual(linuxBash, { command: "/bin/bash", args: ["-c", "echo hi"], shell: "bash", flavor: "bash" });
    const linuxSh = nativeShellCommand("echo hi", { platform: "linux", env: {}, fileExists: () => false });
    assert.deepEqual(linuxSh, { command: "/bin/sh", args: ["-c", "echo hi"], shell: "sh", flavor: "sh" });
    const pwshPath = "C:\\Tools\\pwsh.exe";
    const winPwsh = nativeShellCommand("Get-Date", {
      platform: "win32",
      env: { PATH: "C:\\Tools", PATHEXT: ".EXE" },
      fileExists: (file) => file.toLowerCase() === pwshPath.toLowerCase(),
    });
    assert.equal(winPwsh.flavor, "pwsh");
    assert.deepEqual(winPwsh.args, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Date"]);
    const winPs51 = nativeShellCommand("Get-Date", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, fileExists: () => false });
    assert.equal(winPs51.flavor, "windows-powershell");
    assert.equal(winPs51.command, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const plan = new LocalChildProcessBackend().planLaunch({ shellCommand: "echo hi", cwd: os.tmpdir() });
    assert.equal(plan.shell, false, "the backend spawns the shell itself, never through Node's shell option");
    assert.equal(plan.shellName, process.platform === "win32" ? "powershell" : "bash");
    report.checks.push("native_shell_planning");

    // 2. Facts per environment and access profile, with no raw paths.
    const wslFacts = resolveExecutionEnvironmentFacts({
      grant: grantFor("facts_wsl", "wsl", "workspace"),
      project: { workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: rawWorkspacePath } },
      hostPlatform: "win32",
      env: {},
      fileExists: () => false,
      workspaceLocalityResolver: () => false,
    });
    assert.equal(wslFacts.schema, EXECUTION_ENVIRONMENT_FACTS_SCHEMA);
    assert.equal(wslFacts.environmentKind, "wsl");
    assert.equal(wslFacts.distro, "Ubuntu");
    assert.equal(wslFacts.os, "linux");
    assert.equal(wslFacts.shell.name, "bash");
    assert.equal(wslFacts.pathStyle, "posix");
    assert.equal(wslFacts.defaultLineEnding, "lf");
    assert.equal(wslFacts.executesVia, "environment_executor");
    assert.equal(wslFacts.accessProfile, "workspace");
    assert.equal(wslFacts.writableScope, "workspace_and_tmp");
    assert.deepEqual(wslFacts.hidden, ["windows_drives", "wsl_interop", "credential_stores"]);

    const windowsFacts = resolveExecutionEnvironmentFacts({
      grant: grantFor("facts_windows", "windows", "full_access"),
      project: { workspace: { kind: "windows", windowsPath: rawWindowsPath } },
      hostPlatform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      fileExists: () => false,
      workspaceLocalityResolver: () => true,
    });
    assert.equal(windowsFacts.environmentKind, "windows");
    assert.equal(windowsFacts.os, "windows");
    assert.equal(windowsFacts.shell.name, "powershell");
    assert.equal(windowsFacts.shell.flavor, "windows-powershell");
    assert.equal(windowsFacts.pathStyle, "windows");
    assert.equal(windowsFacts.defaultLineEnding, "crlf");
    assert.equal(windowsFacts.executesVia, "host");
    assert.equal(windowsFacts.accessProfile, "full_access");
    assert.equal(windowsFacts.networkAccess, true);

    const restrictedFacts = resolveExecutionEnvironmentFacts({ project: { workspace: { kind: "local" } }, hostPlatform: "linux", env: {} });
    assert.equal(restrictedFacts.accessProfile, "restricted");
    assert.equal(restrictedFacts.writableScope, "per_call_approval");
    const readOnlyFacts = resolveExecutionEnvironmentFacts({ grant: grantFor("facts_ro", "windows", "read_only"), project: { workspace: { kind: "windows" } }, hostPlatform: "linux", env: {} });
    assert.equal(readOnlyFacts.writableScope, "none");
    assert.deepEqual(readOnlyFacts.hidden, ["credential_stores"]);
    assert.equal(readOnlyFacts.shell.flavor, "", "a non-Windows host cannot know which PowerShell is installed");

    for (const facts of [wslFacts, windowsFacts]) {
      const serialized = JSON.stringify(facts);
      assert.equal(serialized.includes("secret-checkout-path"), false, "facts never carry raw workspace paths");
      assert.equal(facts.rawPathIncluded, false);
      assert.deepEqual(selfConstitutionEnvironmentProjection(facts), facts);
    }
    assert.equal(selfConstitutionEnvironmentProjection({ schema: "other" }), null);
    report.checks.push("environment_facts");

    // 3. Instructions and tool descriptions specialize per environment.
    const wslText = renderExecutionEnvironmentInstructions(wslFacts);
    assert.match(wslText, /Environment: WSL \(Ubuntu\), Linux/);
    assert.match(wslText, /Shell: bash\. exec_command runs `cmd` as `bash -c <cmd>`/);
    assert.match(wslText, /POSIX paths/);
    assert.match(wslText, /Windows drives \(\/mnt\), WSL interop, and credential stores are not visible/);
    assert.match(wslText, /through this environment's own executor/);
    assert.doesNotMatch(wslText, /PowerShell/);
    const windowsText = renderExecutionEnvironmentInstructions(windowsFacts);
    assert.match(windowsText, /Environment: Windows\./);
    assert.match(windowsText, /Shell: Windows PowerShell 5\.1/);
    assert.match(windowsText, /PowerShell syntax \(for example Get-ChildItem/);
    assert.match(windowsText, /Windows paths with backslashes/);
    assert.match(windowsText, /new files default to CRLF/);
    assert.match(windowsText, /Access: Full access/);
    assert.match(renderExecutionEnvironmentInstructions(restrictedFacts), /each need the user's approval/);
    assert.equal(renderExecutionEnvironmentInstructions(null), "");

    const wslTools = applyEnvironmentToToolSchemas(fixtureTools, wslFacts);
    const windowsTools = applyEnvironmentToToolSchemas(fixtureTools, windowsFacts);
    const byName = (tools, name) => tools.find((tool) => tool.name === name);
    assert.match(byName(wslTools, "exec_command").description, /Run a bash command in WSL \(Ubuntu\), Linux/);
    assert.match(byName(wslTools, "exec_command").parameters.properties.cmd.description, /ls -la/);
    assert.doesNotMatch(byName(wslTools, "exec_command").parameters.properties.cwd.description, /absolute/);
    assert.match(byName(windowsTools, "exec_command").description, /Run a Windows PowerShell 5\.1 command in Windows/);
    assert.match(byName(windowsTools, "exec_command").parameters.properties.cmd.description, /Get-ChildItem/);
    assert.match(byName(windowsTools, "exec_command").parameters.properties.cwd.description, /absolute path/);
    assert.match(byName(windowsTools, "apply_patch").description, /Windows paths.*CRLF/);
    assert.match(byName(wslTools, "read_file").parameters.properties.path.description, /POSIX path/);
    assert.equal(byName(wslTools, "update_plan"), byName(fixtureTools, "update_plan"), "unrelated tools pass through");
    assert.equal(byName(fixtureTools, "exec_command").description, "generic", "the source schemas are not mutated");
    assert.equal(applyEnvironmentToToolSchemas(fixtureTools, null), fixtureTools);
    report.checks.push("instructions_and_tool_descriptions");

    // 4. Live controller turns: instructions, tools, request shape, snapshot.
    const wslTurn = await runTurn(root, {
      threadId: "thread_wsl_contract",
      workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: rawWorkspacePath },
      accessProfile: "workspace",
    });
    assert.match(wslTurn.toolRequest.instructions, /Execution environment \(authoritative for this thread\):/);
    assert.match(wslTurn.toolRequest.instructions, /Shell: bash\./);
    assert.doesNotMatch(wslTurn.toolRequest.instructions, /PowerShell syntax/);
    assert.match(byName(wslTurn.toolRequest.tools, "exec_command").description, /Run a bash command in WSL \(Ubuntu\)/);
    assert.equal(wslTurn.turn.requestShape.executionEnvironmentKind, "wsl");
    assert.equal(wslTurn.turn.requestShape.executionEnvironmentShell, "bash");
    assert.equal(wslTurn.turn.requestShape.executionEnvironmentAccessProfile, "workspace");
    assert.equal(wslTurn.snapshot.executionEnvironment.environmentKind, "wsl");
    assert.equal(wslTurn.snapshot.executionEnvironment.rawPathIncluded, false);

    const windowsTurn = await runTurn(root, {
      threadId: "thread_windows_contract",
      workspace: { kind: "windows", windowsPath: rawWindowsPath },
      accessProfile: "full_access",
    });
    assert.match(windowsTurn.toolRequest.instructions, /Environment: Windows\./);
    assert.match(windowsTurn.toolRequest.instructions, /PowerShell syntax/);
    assert.match(byName(windowsTurn.toolRequest.tools, "exec_command").description, /PowerShell/);
    assert.match(byName(windowsTurn.toolRequest.tools, "exec_command").description, /in Windows\./);
    assert.equal(windowsTurn.turn.requestShape.executionEnvironmentKind, "windows");
    assert.equal(windowsTurn.turn.requestShape.executionEnvironmentShell, "powershell");
    assert.equal(windowsTurn.turn.requestShape.executionEnvironmentAccessProfile, "full_access");
    assert.equal(windowsTurn.snapshot.executionEnvironment.pathStyle, "windows");

    for (const { toolRequest, snapshot } of [wslTurn, windowsTurn]) {
      const sent = JSON.stringify(toolRequest);
      assert.equal(sent.includes("secret-checkout-path"), false, "no raw workspace path reaches the provider");
      assert.equal(JSON.stringify(snapshot.executionEnvironment).includes("secret-checkout-path"), false);
    }
    report.checks.push("controller_request_shape");

    report.status = "passed";
    console.log(JSON.stringify(report));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await main();
