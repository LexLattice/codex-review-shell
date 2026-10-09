#!/usr/bin/env node
// Cross-environment delegation (turn 10): spawn_agent can start a full agent
// in another project, usually in the other environment. The owner decides
// per project whether it accepts delegated work and up to which Access; the
// child is a real Direct thread there, its Access is the lower of the
// parent's and the limit, it can't delegate further, and wait_agent returns
// its final message.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildDelegatedProject,
  composeDelegatedTaskPrompt,
  delegationTargetsDescription,
  listDelegationTargets,
  lowerAccessProfile,
  normalizeProjectDelegation,
  resolveDelegationTarget,
} = require("../src/main/direct/agents/cross-environment-delegation.js");
const { createDelegatedThreadRunner, finalAssistantMessage } = require("../src/main/direct/agents/delegated-thread-runner.js");
const { DirectNativeAgentPool, DELEGATED_FINAL_MESSAGE_MAX_CHARS } = require("../src/main/direct/agents/native-agent-pool.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadHarnessGrantStore, grantAccessProfile } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { EnvironmentExecutorProcessBackend, createEnvironmentExecBackendResolver } = require("../src/main/direct/tools/executor-process-backend.js");
const { WindowsJobSandbox } = require("../src/main/direct/tools/windows-job-runner.js");
const { WorkspaceBackendManager, workspaceRoot } = require("../src/main/workspace-backend.js");

const normalizeDistro = (value) => (typeof value === "string" && value.trim() ? value.trim() : "Ubuntu");
let checks = 0;
let skipped = 0;
async function check(name, fn) {
  if (await fn() === "skipped") {
    skipped += 1;
    process.exitCode = 77;
    return;
  }
  checks += 1;
  console.log(`ok - ${name}`);
}

const directBinding = { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane", model: "gpt-5.4", profileId: "delegation-profile" };
const wslProject = {
  id: "project_wsl",
  name: "WSL repo",
  workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/rose/repo" },
  surfaceBinding: { codex: { ...directBinding } },
};
const windowsTarget = {
  id: "project_windows",
  name: "Windows tools",
  workspace: { kind: "windows", windowsPath: "C:\\Work\\Tools" },
  surfaceBinding: { codex: { ...directBinding } },
  delegation: { acceptAccess: "read_only", includeSubfolders: true },
};
const windowsOff = {
  id: "project_windows_off",
  name: "Windows private",
  workspace: { kind: "windows", windowsPath: "C:\\Work\\Private" },
  surfaceBinding: { codex: { ...directBinding } },
};
const wslTarget = {
  id: "project_wsl_target",
  name: "WSL data",
  workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/srv/data" },
  surfaceBinding: { codex: { ...directBinding } },
  delegation: { acceptAccess: "full_access", includeSubfolders: false },
};
const appServerProject = {
  id: "project_app_server",
  name: "App server",
  workspace: { kind: "windows", windowsPath: "C:\\Work\\Legacy" },
  surfaceBinding: { codex: { runtimeMode: "legacy-app-server" } },
  delegation: { acceptAccess: "workspace" },
};
const projects = [wslProject, windowsTarget, windowsOff, wslTarget, appServerProject];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-delegation-"));
try {
  await check("owner policy: off by default, Access ceilings, subfolders only while accepting", () => {
    assert.equal(normalizeProjectDelegation(undefined), null);
    assert.equal(normalizeProjectDelegation({ acceptAccess: "" }), null);
    assert.deepEqual(normalizeProjectDelegation({ acceptAccess: "Workspace", includeSubfolders: true }), { acceptAccess: "workspace", includeSubfolders: true, createdBy: null });
    assert.equal(normalizeProjectDelegation({ acceptAccess: "", includeSubfolders: true }), null, "subfolders alone accept nothing");
    assert.equal(normalizeProjectDelegation({ acceptAccess: "root" }), null);
    assert.equal(lowerAccessProfile("full_access", "read_only"), "read_only");
    assert.equal(lowerAccessProfile("workspace", "full_access"), "workspace");
    assert.equal(lowerAccessProfile("", "full_access"), "read_only", "no parent Access counts as Read only");
  });

  await check("targets: accepting Direct projects other than the source", () => {
    const targets = listDelegationTargets(projects, wslProject);
    assert.deepEqual(targets.map((target) => target.name), ["Windows tools", "WSL data"]);
    assert.equal(targets[0].environment.label, "Windows");
    assert.equal(targets[1].environment.label, "WSL · Ubuntu");
    assert.deepEqual(listDelegationTargets(projects, windowsTarget).map((target) => target.name), ["WSL data"], "a project never targets itself");
    const description = delegationTargetsDescription(targets);
    assert.match(description, /"Windows tools": Windows, C:\\Work\\Tools, up to Read only, also any subfolder via target_folder/);
    assert.match(description, /"WSL data": WSL · Ubuntu, \/srv\/data, up to Full access/);
  });

  await check("resolution follows each environment's own path rules", () => {
    const ok = (input) => resolveDelegationTarget({ projects, sourceProject: wslProject, hostPlatform: "linux", ...input });
    assert.equal(ok({ targetProject: "windows TOOLS" }).targetProjectId, "project_windows", "names match case-insensitively");
    assert.equal(ok({ targetProject: "project_wsl_target" }).accessCeiling, "full_access");
    assert.equal(ok({ targetProject: "Windows private" }).code, "direct_delegation_target_unknown");
    assert.match(ok({ targetProject: "Windows private" }).message, /Targets: Windows tools, WSL data/);
    assert.equal(ok({ targetProject: "App server" }).code, "direct_delegation_target_unknown", "app-server projects can't run a Direct child");
    const sameFolder = ok({ targetFolder: "c:\\work\\tools\\" });
    assert.equal(sameFolder.targetProjectId, "project_windows", "Windows paths compare case-insensitively");
    assert.equal(sameFolder.needsProject, false);
    const sub = ok({ targetFolder: "C:\\Work\\Tools\\Scripts\\..\\Build" });
    assert.equal(sub.needsProject, true);
    assert.equal(sub.rootProjectId, "project_windows");
    assert.equal(sub.folder, "C:\\Work\\Tools\\Build", "the folder is normalized before it's checked");
    assert.equal(ok({ targetFolder: "C:\\Work\\ToolsExtra" }).code, "direct_delegation_folder_outside_targets", "a shared name prefix isn't containment");
    assert.equal(ok({ targetFolder: "/srv/data/sub" }).code, "direct_delegation_subfolders_not_accepted");
    assert.equal(ok({ targetFolder: "/srv/data/../etc" }).code, "direct_delegation_folder_outside_targets");
    assert.equal(ok({ targetProject: "Windows tools", targetFolder: "/srv/data" }).code, "direct_delegation_folder_outside_targets", "a Linux path can't name a Windows folder");
    assert.equal(ok({}).code, "direct_delegation_target_missing");
    const existingOff = resolveDelegationTarget({
      projects: [...projects, { ...windowsOff, id: "project_sub_off", workspace: { kind: "windows", windowsPath: "C:\\Work\\Tools\\Own" } }],
      sourceProject: wslProject,
      targetFolder: "C:\\Work\\Tools\\Own",
      hostPlatform: "linux",
    });
    assert.equal(existingOff.code, "direct_delegation_target_not_accepting", "an existing project for the folder decides for itself");
  });

  await check("a subfolder project inherits the environment and limit, marked as created by delegation", () => {
    const created = buildDelegatedProject({
      rootProject: windowsTarget,
      folder: "C:\\Work\\Tools\\Build",
      sourceProject: wslProject,
      sourceThreadId: "thread_parent",
      createdAt: "2026-10-07T00:00:00.000Z",
    });
    assert.equal(created.name, "Build");
    assert.deepEqual(created.workspace, { kind: "windows", windowsPath: "C:\\Work\\Tools\\Build", label: "Build (delegated)" });
    assert.equal(created.surfaceBinding.codex.runtimeMode, "direct");
    assert.equal(created.surfaceBinding.codex.model, "", "new threads there use Recommended");
    assert.deepEqual(created.delegation, {
      acceptAccess: "read_only",
      includeSubfolders: false,
      createdBy: { rootProjectId: "project_windows", fromProjectId: "project_wsl", fromProjectName: "WSL repo", fromThreadId: "thread_parent", createdAt: "2026-10-07T00:00:00.000Z" },
    });
    assert.ok(normalizeProjectDelegation(created.delegation).createdBy);
    const prompt = composeDelegatedTaskPrompt({ message: "Build it.", sourceProjectName: "WSL repo", sourceEnvironmentLabel: "WSL · Ubuntu", folder: "C:\\Work\\Tools\\Build" });
    assert.match(prompt, /^\[Delegated task\] An agent working in WSL repo \(WSL · Ubuntu\) delegated this task to you\.\nWork in C:\\Work\\Tools\\Build\.\n.*final message is returned.*\n\nBuild it\.$/s);
  });

  await check("the pool runs delegated children and returns their bounded final message", async () => {
    const missing = new DirectNativeAgentPool({});
    assert.equal(missing.launch({ message: "x", delegation: { targetProjectId: "p" } }).blockerCode, "direct_delegated_thread_runner_missing");
    const long = "x".repeat(DELEGATED_FINAL_MESSAGE_MAX_CHARS + 50);
    const pool = new DirectNativeAgentPool({
      delegatedThreadRunner: async (input) => {
        input.onChildThread({ childThreadId: "child_thread_1" });
        return { status: "completed", outputText: "short", finalMessage: long, delegation: { childTurnId: "turn_1" } };
      },
    });
    const launched = pool.launch({ projectId: "p", primaryThreadId: "parent", taskName: "t1", message: "do it", delegation: { targetProjectId: "project_windows", targetProjectName: "Windows tools", environment: { kind: "windows", label: "Windows" }, accessProfile: "read_only" } });
    assert.equal(launched.workspaceMode, "delegated_thread");
    assert.equal(launched.delegation.targetProjectName, "Windows tools");
    const waited = await pool.wait({ projectId: "p", primaryThreadId: "parent", targets: ["t1"], timeoutMs: 5000 });
    const update = waited.updates[0];
    assert.equal(update.state, "completed");
    assert.equal(update.resultSummaryKind, "child_final_message");
    assert.equal(update.finalMessage.length, DELEGATED_FINAL_MESSAGE_MAX_CHARS);
    assert.equal(update.finalMessageTruncated, true);
    assert.equal(update.delegation.childThreadId, "child_thread_1");
    assert.equal(update.delegation.childTurnId, "turn_1");
  });

  await check("the runner stops a child that asks for a person, times out, or is cancelled", async () => {
    class StubSurface extends EventEmitter {
      constructor() { super(); this.pending = false; }
      async connect() {}
      async request(method) {
        if (method === "thread/start") return { thread: { id: "child" } };
        if (StubSurface.askPerson) {
          this.pending = true;
          setTimeout(() => this.emit("event", { type: "rpc-request", request: { method: "item/tool/requestUserInput" } }), 5);
        }
        return { turn: { id: "turn" } };
      }
      hasServerRequest() { return this.pending; }
      dispose() {}
    }
    let interrupted = 0;
    const stubController = {
      sessionStore: { readTurn: () => ({ state: "streaming" }), readSession: () => ({ messages: [] }) },
      interruptTurn: async () => { interrupted += 1; },
    };
    const resolveTarget = async () => ({ project: windowsTarget, folder: "", accessCeiling: "read_only" });
    const runner = createDelegatedThreadRunner({ controller: stubController, SurfaceSession: StubSurface, resolveTarget, pollMs: 5, timeoutMs: 200 });
    StubSurface.askPerson = true;
    const needsPerson = await runner({ prompt: "x", delegation: { parentAccessProfile: "workspace" } });
    assert.equal(needsPerson.status, "failed");
    assert.equal(needsPerson.blockerCode, "direct_delegated_child_needs_person");
    assert.match(needsPerson.outputText, /can't ask the user/);
    StubSurface.askPerson = false;
    const timedOut = await runner({ prompt: "x", delegation: {} });
    assert.equal(timedOut.status, "timeout");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const cancelled = await runner({ prompt: "x", delegation: {}, signal: controller.signal });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(interrupted, 3, "each stop interrupts the child's turn");
    const refused = await createDelegatedThreadRunner({
      controller: stubController,
      SurfaceSession: StubSurface,
      resolveTarget: async () => { const error = new Error("gone"); error.code = "direct_delegation_target_unknown"; throw error; },
    })({ prompt: "x", delegation: {} });
    assert.equal(refused.blockerCode, "direct_delegation_target_unknown");
    assert.equal(finalAssistantMessage({ messages: [{ id: "t", items: [{ type: "agentMessage", text: "first" }, { type: "agentMessage", text: " last " }] }] }, "t"), "last");
  });

  await check("end to end: a WSL agent delegates to a Windows project and gets the child's final message", async () => {
    const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
    const harnessGrantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
    const requests = [];
    const sse = (id, text) => new Response([
      "event: response.created",
      `data: {"response":{"id":"${id}","model":"gpt-5.4"}}`,
      "",
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ item_id: `msg_${id}`, delta: text })}`,
      "",
      "event: response.completed",
      `data: {"response":{"id":"${id}","status":"completed"}}`,
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
    let runner = null;
    const pool = new DirectNativeAgentPool({ delegatedThreadRunner: (input) => runner(input) });
    const controller = new DirectLiveTextController({
      sessionStore,
      harnessGrantStore,
      subAgentPool: pool,
      delegationProjectsResolver: () => projects,
      profileDoc: {
        profile: {
          profileId: "delegation-profile",
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
        const body = JSON.parse(String(init.body || "{}"));
        requests.push(body);
        return sse(`resp_${requests.length}`, "Windows build checked: 3 scripts, all fine.");
      },
    });
    runner = createDelegatedThreadRunner({
      controller,
      SurfaceSession: DirectLiveTextSurfaceSession,
      resolveTarget: async (delegation) => ({
        project: projects.find((project) => project.id === delegation.targetProjectId),
        folder: delegation.folder,
        projectCreated: false,
        accessCeiling: delegation.accessCeiling,
      }),
      pollMs: 20,
      timeoutMs: 30_000,
    });

    const parent = controller.startThread({ title: "parent", accessProfile: "workspace" }, { project: wslProject, ownerControlled: true });
    const parentId = parent.thread.id;
    const spawnTool = { type: "function", name: "spawn_agent", description: "Spawn a child.", parameters: { type: "object", properties: {} } };
    const listed = controller.withEnvironmentTools({ tools: [spawnTool] }, wslProject, parentId).tools[0];
    assert.match(listed.description, /"Windows tools": Windows, C:\\Work\\Tools, up to Read only/, "the parent is told where it can delegate");

    const call = (name, args, sessionId = parentId, project = wslProject) => controller.buildNativeSubAgentRuntimeEnvelope(sessionId, "turn_parent", {
      name,
      obligationId: `ob_${name}_${Math.random().toString(16).slice(2)}`,
      callId: `call_${name}`,
      arguments: JSON.stringify(args),
      argumentsText: JSON.stringify(args),
    }, project);

    const refused = await call("spawn_agent", { task_name: "nope", message: "x", target_project: "Windows private" });
    assert.equal(refused.providerOutput.status, "blocked");
    assert.equal(refused.providerOutput.blockerCode, "direct_delegation_target_unknown");
    assert.match(refused.providerOutput.blockerDetail, /Targets: Windows tools, WSL data/);

    const spawned = await call("spawn_agent", { task_name: "win_build", message: "Check the Windows build scripts.", target_project: "Windows tools" });
    assert.notEqual(spawned.providerOutput.status, "blocked", JSON.stringify(spawned.providerOutput));
    assert.equal(spawned.providerOutput.workspaceMode, "delegated_thread");
    assert.equal(spawned.providerOutput.delegation.targetProjectName, "Windows tools");
    assert.equal(spawned.providerOutput.delegation.accessProfile, "read_only", "the lower of Workspace (parent) and Read only (limit)");

    const waited = await call("wait_agent", { targets: ["win_build"], timeout_ms: 30_000 });
    const update = waited.providerOutput.updates[0];
    assert.equal(update.state, "completed", JSON.stringify(update));
    assert.equal(update.finalMessage, "Windows build checked: 3 scripts, all fine.");
    assert.equal(update.childOutputIncluded, true);
    const childId = update.delegation.childThreadId;
    assert.ok(childId);

    const child = sessionStore.readSession(childId);
    assert.equal(child.projectId, "project_windows", "the child is a thread of the target project");
    assert.equal(child.delegatedFrom.projectId, "project_wsl");
    assert.equal(child.delegatedFrom.environment.label, "WSL · Ubuntu");
    assert.equal(child.agentKind, "", "it is an ordinary thread there, listed with the project's threads");
    const childGrant = controller.resolveHarnessGrant(windowsTarget, child);
    assert.equal(grantAccessProfile(childGrant), "read_only");
    assert.equal(childGrant.executionEnvironment.kind, "windows", "its grant, which routes exec and files, is for the Windows environment");
    const childRequest = requests.find((body) => JSON.stringify(body.input || "").includes("[Delegated task]"));
    assert.ok(childRequest, "the child got the delegated task");
    assert.match(String(childRequest.instructions || ""), /PowerShell/, "the child is told it runs in PowerShell on Windows");
    const listedThreads = controller.listThreads({}, { project: windowsTarget });
    const row = listedThreads.threads.find((entry) => entry.id === childId);
    assert.equal(row.delegatedFrom.projectName, "WSL repo", "the target's thread list marks it as delegated");
    const deckRow = (listedThreads.deck?.rows || []).find((entry) => entry.threadId === childId);
    assert.equal(deckRow?.delegatedFrom?.projectName, "WSL repo", "so does the rail's deck row");
    assert.equal(deckRow?.transcriptLane, "primary", "and it isn't filed as a hidden worker");

    const again = await call("spawn_agent", { task_name: "nested", message: "x", target_project: "WSL data" }, childId, windowsTarget);
    assert.equal(again.providerOutput.blockerCode, "direct_delegated_child_cannot_delegate");
    const childTools = controller.withEnvironmentTools({ tools: [spawnTool] }, windowsTarget, childId).tools[0];
    assert.doesNotMatch(childTools.description, /Targets:/, "a delegated child isn't offered targets");
  });

  // A delegated child that really runs a command in its target environment,
  // through the same routing main uses: in-process for the host's own
  // environment, the environment's executor otherwise.
  async function runRealDelegatedCommand({ sourceProject, targetProject, hostFolder, command, finalText }) {
    const onWindows = process.platform === "win32";
    const projectsForRun = [sourceProject, targetProject];
    const workspaceBackends = new WorkspaceBackendManager({ agentPath: path.join(repoRoot, "src", "backend", "wsl-agent.js"), fallbackRoot: repoRoot });
    const grantStore = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, `real-grants-${targetProject.id}`) });
    const manager = new DirectStatefulExecSessionManager({
      grantStore,
      initialYieldMs: 2000,
      workspaceRootResolver: (input) => workspaceRoot(input?.project || input, repoRoot),
      // Keeps the in-process Windows sandbox off this machine's real credential stores.
      ...(onWindows ? { sandbox: new WindowsJobSandbox({ credentialStoreFiles: () => [path.win32.join(os.tmpdir(), `direct-delegation-fixture-auth-${process.pid}.json`)] }) } : {}),
      backendResolver: (input, grant) => createEnvironmentExecBackendResolver({
        localBackend: manager.localBackend,
        executorBackend: new EnvironmentExecutorProcessBackend({ workspaceBackends }),
      })(input, grant),
    });
    const sessionStore = new DirectSessionStore({ rootDir: path.join(root, `real-sessions-${targetProject.id}`) });
    const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    const streamed = (text) => ({
      ok: true, status: 200, headers: { get: () => "text/event-stream" },
      body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
    });
    let childRequests = 0;
    const childResults = () => {
      const entry = (sessionStore.ensure()?.sessions || []).find((row) => row.projectId === targetProject.id);
      const session = entry ? sessionStore.readSession(entry.sessionId) : null;
      const turnId = session?.turns?.at(-1)?.turnId;
      const turn = turnId ? sessionStore.readTurn(session.sessionId, turnId) : null;
      return (turn?.toolResults || []).map((result) => JSON.parse(result.providerOutputText || "{}"));
    };
    let runner = null;
    const pool = new DirectNativeAgentPool({ delegatedThreadRunner: (input) => runner(input) });
    const controller = new DirectLiveTextController({
      sessionStore,
      harnessGrantStore: grantStore,
      statefulExecSessionManager: manager,
      subAgentPool: pool,
      delegationProjectsResolver: () => projectsForRun,
      profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
      endpoint: "https://chatgpt.test/backend-api/codex/responses",
      authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
      activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol" }),
      activeSubAgentPolicySemanticPreflight: async () => null,
      // Like a model: run the command, poll it (empty write_stdin) while it
      // is still running, then answer.
      fetchImpl: async () => {
        const id = `resp_real_${++childRequests}`;
        assert(childRequests <= 40, "the child kept polling");
        let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
        const latest = childResults().at(-1) || null;
        const call = (name, args) => {
          const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name, arguments: JSON.stringify(args) };
          return event("response.output_item.added", { item }) + event("response.output_item.done", { item });
        };
        if (!latest) text += call("exec_command", { cmd: command });
        else if (latest.status === "running") {
          // A real model's round trip takes this long; the executor may
          // still be starting.
          await new Promise((resolve) => setTimeout(resolve, 2000));
          text += call("write_stdin", { session_id: latest.sessionId, chars: "" });
        } else text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: finalText });
        return streamed(text + event("response.completed", { response: { id, status: "completed" } }));
      },
    });
    runner = createDelegatedThreadRunner({
      controller,
      SurfaceSession: DirectLiveTextSurfaceSession,
      resolveTarget: async (delegation) => ({ project: targetProject, folder: "", projectCreated: false, accessCeiling: delegation.accessCeiling }),
      pollMs: 25,
      timeoutMs: 90_000,
    });
    try {
      const parent = controller.startThread({ title: "parent", accessProfile: "workspace" }, { project: sourceProject, ownerControlled: true });
      const call = (name, args) => controller.buildNativeSubAgentRuntimeEnvelope(parent.thread.id, "turn_parent", {
        name, obligationId: `ob_${name}`, callId: `call_${name}`, arguments: JSON.stringify(args), argumentsText: JSON.stringify(args),
      }, sourceProject);
      const spawned = await call("spawn_agent", { task_name: "real_run", message: "Report your shell and folder.", target_project: targetProject.name, model: "gpt-5.6-sol" });
      assert.notEqual(spawned.providerOutput.status, "blocked", JSON.stringify(spawned.providerOutput));
      const waited = await call("wait_agent", { targets: ["real_run"], timeout_ms: 120_000 });
      const update = waited.providerOutput.updates[0];
      assert.equal(update.state, "completed", JSON.stringify(update));
      assert.equal(update.finalMessage, finalText);
      const output = childResults().at(-1);
      assert.equal(output.exitCode, 0, JSON.stringify(output));
      return output.stdoutPreview;
    } finally {
      controller.close("regression cleanup");
      await manager.dispose("regression cleanup");
      await workspaceBackends.disposeAll?.();
      await fs.promises.rm(hostFolder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }

  await check("a WSL agent's delegated child really runs PowerShell in a Windows folder", async () => {
    const onWindows = process.platform === "win32";
    // Bare Linux, or WSL with unavailable Windows interop, cannot run this
    // real cross-host fixture. Do not pretend a mocked Windows result covers it.
    const windowsTempProbe = onWindows ? null : spawnSync(
      "/mnt/c/Windows/System32/cmd.exe", ["/d", "/c", "echo %TEMP%"],
      { cwd: "/mnt/c", encoding: "utf8", timeout: 20_000 },
    );
    if (windowsTempProbe && windowsTempProbe.status !== 0) {
      console.log("SKIPPED: real Windows delegation requires working WSL-to-Windows executable interop");
      return "skipped";
    }
    const winTemp = onWindows
      ? os.tmpdir()
      : String(windowsTempProbe.stdout || "").trim();
    assert.match(winTemp, /^[A-Za-z]:\\/, "the Windows %TEMP% is readable");
    const winFolder = path.win32.join(winTemp, `direct-delegation-${process.pid}-${Date.now()}`);
    const hostFolder = onWindows ? winFolder : String(spawnSync("wslpath", ["-u", winFolder], { encoding: "utf8" }).stdout || "").trim();
    fs.mkdirSync(hostFolder, { recursive: true });
    const stdout = await runRealDelegatedCommand({
      sourceProject: wslProject,
      targetProject: { ...windowsTarget, id: "project_windows_real", name: "Windows real", workspace: { kind: "windows", windowsPath: winFolder } },
      hostFolder,
      command: "Write-Output (\"edition=\" + $PSVersionTable.PSEdition + \" dir=\" + (Get-Location).Path)",
      finalText: "Ran it in Windows.",
    });
    assert.match(stdout, /edition=(Desktop|Core) dir=[A-Za-z]:\\/, "PowerShell ran in a Windows folder");
    assert.ok(stdout.toLowerCase().includes(winFolder.toLowerCase()), `it ran in the target folder: ${stdout}`);
  });

  await check("a Windows agent's delegated child really runs bash in a WSL folder", async () => {
    const onWindows = process.platform === "win32";
    const distro = onWindows ? "Ubuntu" : normalizeDistro(process.env.WSL_DISTRO_NAME);
    const linuxFolder = `/tmp/direct-delegation-${process.pid}-${Date.now()}`;
    let hostFolder = linuxFolder;
    if (onWindows) {
      const made = spawnSync("wsl.exe", ["-d", distro, "-e", "mkdir", "-p", linuxFolder], { encoding: "utf8", timeout: 60_000 });
      assert.equal(made.status, 0, made.stderr);
      hostFolder = `\\\\wsl.localhost\\${distro}${linuxFolder.replaceAll("/", "\\")}`;
    } else {
      fs.mkdirSync(linuxFolder, { recursive: true });
    }
    const stdout = await runRealDelegatedCommand({
      sourceProject: { ...windowsOff, id: "project_windows_source", name: "Windows source" },
      targetProject: { ...wslTarget, id: "project_wsl_real", name: "WSL real", workspace: { kind: "wsl", distro, linuxPath: linuxFolder } },
      hostFolder,
      command: "echo \"kernel=$(uname -s) dir=$(pwd)\"",
      finalText: "Ran it in WSL.",
    });
    assert.match(stdout, new RegExp(`kernel=Linux dir=${linuxFolder}`), `bash ran in the WSL folder: ${stdout}`);
  });

  await check("main, editor, and UI are wired", () => {
    const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
    const main = read("src/main.js");
    assert.match(main, /delegatedThreadRunner: \(input\) => ensureDirectDelegatedThreadRunner\(\)\(input\),/);
    assert.match(main, /delegationProjectsResolver: \(\) => configCache\?\.projects \|\| \[\],/);
    // The subfolder is checked and the project created on the resolved
    // (symlink-free) folder, which must be inside the accepting project.
    assert.match(main, /const realFolder = await resolveDirectDelegationFolder\(rootProject, resolution\.folder\);/);
    assert.match(main, /canonicalFolderWithinRoot\(environment\.kind, realRoot, realFolder\)/);
    assert.match(main, /buildDelegatedProject\(\{\s*rootProject,\s*folder: realFolder,/);
    assert.match(main, /const next = directDelegationProjectChain\.then\(run, run\);/);
    assert.match(main, /\.\.\.\(normalizeProjectDelegation\(raw\.delegation\) \? \{ delegation: normalizeProjectDelegation\(raw\.delegation\) \} : \{\}\),/);
    const composer = read("src/main/direct/bridge/role-lane-tool-bundle-composer.js");
    assert.match(composer, /target_project: \{\s*type: "string",/);
    assert.match(composer, /target_folder: \{\s*type: "string",/);
    const html = read("src/renderer/t3-direct-surface.html");
    assert.match(html, /<select id="directProjectBindingDelegationAccess" name="delegationAccess">\s*<option value="">Off<\/option>/);
    assert.match(html, /id="directProjectBindingDelegationSubfolders"/);
    const editor = read("src/renderer/direct-project-directory-surface.js");
    assert.match(editor, /delegationAccess: editorDelegationAccess\.value, delegationSubfolders: editorDelegationSubfolders\?\.checked === true/);
    const surface = read("src/renderer/codex-surface.js");
    assert.match(surface, /recordDelegatedChildActivity\(params\);/);
    assert.match(surface, /delegatedChip\.textContent = "Delegated";/);
    const directoryModel = read("src/renderer/direct-thread-directory-model.js");
    assert.match(directoryModel, /delegatedFromLabel:/);
  });

  console.log(`direct-cross-environment-delegation-regression: ${checks} checks passed, ${skipped} skipped`);
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
