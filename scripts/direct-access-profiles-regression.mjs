#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DIRECT_ACCESS_PROFILES,
  DirectThreadHarnessGrant,
  DirectThreadHarnessGrantStore,
  authorizeDirectThreadHarnessCapability,
  capabilityNames,
  grantAccessProfile,
  validateDirectThreadHarnessGrant,
} = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session");
const { BubblewrapExecSandbox, workspaceExecutesLocally } = require("../src/main/direct/tools/exec-sandbox");

const projectId = "project_access_profiles";
const executionEnvironment = {
  environmentId: "environment_access_profiles",
  kind: "local",
  bindingDigest: "sha256:environment-access-profiles",
};
const baseCapabilities = ["apply_patch", "exec_command", "read_file", "run_command", "update_plan", "write_stdin"];
const readyStatus = () => ({
  status: "ready",
  model: "gpt-5.6-sol",
  readOnlyToolContinuation: { status: "ready" },
  patchApplyContinuation: { status: "ready" },
  commandExecutionContinuation: { status: "ready" },
});

function issue(profile, threadId, extra = {}) {
  return DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId,
    executionEnvironment,
    capabilities: baseCapabilities,
    accessProfile: profile,
    nowMs: Date.UTC(2026, 9, 6, 12, 0, 0),
    ...extra,
  });
}

function bwrapUsable() {
  const sandbox = new BubblewrapExecSandbox();
  if (!sandbox.available()) return false;
  const probe = spawnSync(sandbox.resolveExecutable(), ["--ro-bind", "/", "/", "--unshare-net", "--", "/bin/true"], { timeout: 5000 });
  return probe.status === 0;
}

async function runToCompletion(manager, started, binding) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await manager.wait({ ...binding, sessionId: started.sessionId, timeoutMs: 2000 });
    if (["completed", "failed", "cancelled", "timeout"].includes(result.status)) return result;
  }
  throw new Error("exec did not settle");
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-access-profiles-"));
  const report = { schema: "direct_access_profiles_regression_report@1", checks: [] };
  try {
    // 1. Grants: each profile carries its own sandbox mode and validates.
    for (const profile of Object.keys(DIRECT_ACCESS_PROFILES)) {
      const grant = issue(profile, `thread_${profile}`);
      assert.deepEqual(validateDirectThreadHarnessGrant(grant, { requireCurrent: true }), []);
      assert.equal(grant.accessProfile, profile);
      assert.equal(grant.sandboxMode, DIRECT_ACCESS_PROFILES[profile].sandboxMode);
      assert.equal(grant.networkAccess, DIRECT_ACCESS_PROFILES[profile].networkAccess);
      assert.equal(grant.approvalPolicy, "never");
      assert.equal(grantAccessProfile(grant), profile);
      const authorization = authorizeDirectThreadHarnessCapability(grant, "read_file", { runtimeAdmittedCapabilityNames: ["read_file"] });
      assert.equal(authorization.authorized, true);
      assert.equal(authorization.accessProfile, profile);
    }
    assert.throws(() => issue("root", "thread_bad_profile"), /access profile/i);

    // A pre-profile grant (no accessProfile field) is still a valid full-access grant.
    const legacy = { ...issue("full_access", "thread_legacy") };
    delete legacy.accessProfile;
    delete legacy.networkAccess;
    const legacyDigestInput = { ...legacy };
    delete legacyDigestInput.grantDigest;
    const crypto = await import("node:crypto");
    const stable = (value) => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== "object") return value;
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (["grantDigest", "actDigest", "populationDigest", "scopeDigest", "inheritanceDigest"].includes(key)) continue;
        if (value[key] !== undefined) out[key] = stable(value[key]);
      }
      return out;
    };
    legacy.grantDigest = `sha256:${crypto.createHash("sha256").update(`direct-thread-harness-grant@1\0${JSON.stringify(stable(legacyDigestInput))}`).digest("hex")}`;
    assert.deepEqual(validateDirectThreadHarnessGrant(legacy, { requireCurrent: true }), []);
    assert.equal(grantAccessProfile(legacy), "full_access");

    // A profile that disagrees with its sandbox mode is rejected.
    const workspaceGrant = issue("workspace", "thread_tamper");
    const tampered = { ...workspaceGrant, sandboxMode: "danger-full-access" };
    assert(validateDirectThreadHarnessGrant(tampered).includes("sandbox_mode_profile_mismatch"));
    const relabeled = { ...workspaceGrant, accessProfile: "full_access" };
    assert(validateDirectThreadHarnessGrant(relabeled).includes("sandbox_mode_profile_mismatch"));

    // Children inherit the parent's profile and cannot widen it.
    const child = DirectThreadHarnessGrant.inherit(workspaceGrant, {
      taskId: "thread_tamper_child",
      threadId: "thread_tamper_child",
      projectId,
      executionEnvironment,
      capabilities: ["read_file"],
    });
    assert.equal(child.accessProfile, "workspace");
    assert.equal(child.sandboxMode, "workspace-write");
    report.checks.push("grant_profiles");

    // 2. Store: switching profiles reissues and supersedes within one scope.
    const store = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
    const scope = { taskId: "thread_switch", threadId: "thread_switch", projectId, executionEnvironment, capabilities: baseCapabilities };
    const first = store.issueAccessProfile({ ...scope, accessProfile: "workspace", nowMs: 1_000 });
    const second = store.issueAccessProfile({ ...scope, accessProfile: "full_access", nowMs: 2_000 });
    assert.equal(second.grantRevision, first.grantRevision + 1);
    assert.equal(store.read(first.grantId).currentness.state, "superseded");
    assert.equal(store.authorize(first.grantId, "read_file", scope).authorized, false);
    assert.equal(store.authorize(second.grantId, "read_file", scope).authorized, true);
    assert.equal(store.issueFullAccess({ ...scope, nowMs: 3_000 }).accessProfile, "full_access");
    report.checks.push("store_profile_switch");

    // 3. Controller selection: per-profile capability populations and projection.
    const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
    const project = { id: projectId, workspace: { kind: "local" } };
    const controller = new DirectLiveTextController({
      sessionStore,
      harnessGrantStore: new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "selected") }),
    });
    controller.statusForProject = readyStatus;
    const newSession = (sessionId) => sessionStore.createSession({
      sessionId,
      projectId,
      workspace: { kind: "local" },
      model: "gpt-5.6-sol",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    newSession("select_thread");
    const workspaceSelected = controller.selectTaskAccessProfile({ sessionId: "select_thread", accessProfile: "workspace" }, { project });
    assert.equal(workspaceSelected.profile, "workspace");
    assert.equal(workspaceSelected.sandboxMode, "workspace-write");
    assert.equal(workspaceSelected.networkAccess, false);
    assert.equal(workspaceSelected.taskBinding.current, true);
    assert.equal(workspaceSelected.taskBinding.accessProfile, "workspace");
    assert.equal(workspaceSelected.capabilities.authority.fullAccessTaskProfile, false);
    assert.equal(workspaceSelected.capabilities.authority.taskGrantCurrent, true);
    assert.equal(workspaceSelected.capabilities.authority.taskAccessProfile, "workspace");
    assert.equal(workspaceSelected.capabilities.authority.readOnlyToolApproval, false, "a current grant suppresses per-call approvals");
    const workspaceNames = workspaceSelected.capabilities.runtimeCapabilityProjection.declaredToolNames;
    assert(workspaceNames.includes("apply_patch"));
    assert(workspaceNames.includes("exec_command"));
    assert.equal(workspaceNames.includes("run_command"), false, "workspace commands must go through the sandboxed exec path");
    assert.equal(sessionStore.readSession("select_thread").harnessAccessProfile, "workspace");

    const readOnlySelected = controller.selectTaskAccessProfile({ sessionId: "select_thread", accessProfile: "read_only" }, { project });
    const readOnlyNames = readOnlySelected.capabilities.runtimeCapabilityProjection.declaredToolNames;
    assert.equal(readOnlyNames.includes("apply_patch"), false);
    assert.equal(readOnlyNames.includes("run_command"), false);
    assert(readOnlyNames.includes("read_file"));

    const fullSelected = controller.selectFullAccessTaskProfile({ sessionId: "select_thread", accessProfile: "full_access" }, { project });
    assert.equal(fullSelected.capabilities.authority.fullAccessTaskProfile, true);
    assert(fullSelected.capabilities.runtimeCapabilityProjection.declaredToolNames.includes("run_command"));
    assert.throws(
      () => controller.selectTaskAccessProfile({ sessionId: "select_thread", accessProfile: "everything" }, { project }),
      (error) => error.code === "direct_thread_harness_profile_invalid",
    );

    // A running turn cannot have its profile switched underneath it.
    newSession("busy_thread");
    controller.selectTaskAccessProfile({ sessionId: "busy_thread", accessProfile: "workspace" }, { project });
    const busyTurn = sessionStore.createTurn("busy_thread", { input: [{ role: "user", text: "work" }], model: "gpt-5.6-sol" });
    sessionStore.updateTurnState("busy_thread", busyTurn.turnId, "streaming", {});
    assert.throws(
      () => controller.selectTaskAccessProfile({ sessionId: "busy_thread", accessProfile: "full_access" }, { project }),
      (error) => error.code === "direct_thread_access_profile_turn_active",
    );
    report.checks.push("controller_profile_selection");

    // 4. Local file executor: Workspace writes stay inside the project folder.
    const workspaceRoot = path.join(root, "workspace");
    const outsideRoot = path.join(root, "outside");
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "a.txt"), "alpha\n", "utf8");
    await fs.writeFile(path.join(outsideRoot, "b.txt"), "beta\n", "utf8");
    await fs.symlink(outsideRoot, path.join(workspaceRoot, "escape"));
    const executor = new DirectFullAccessLocalEnvironmentExecutor({ workspaceRootResolver: () => workspaceRoot });
    const executorInput = (grant) => ({
      taskId: grant.taskId,
      threadId: grant.threadId,
      projectId,
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
      harnessGrant: grant,
      project,
    });
    const updatePatch = (target, before, after) => ["*** Begin Patch", `*** Update File: ${target}`, "@@ -1 +1 @@", `-${before}`, `+${after}`, "*** End Patch"].join("\n");
    const wsGrant = issue("workspace", "exec_ws");
    const applied = await executor.request(executorInput(wsGrant), "applyPatch", { mode: "apply", patch: updatePatch("src/a.txt", "alpha", "alpha2") });
    assert.equal(applied.status, "applied");
    assert.equal(await fs.readFile(path.join(workspaceRoot, "src", "a.txt"), "utf8"), "alpha2\n");
    for (const target of [path.join(outsideRoot, "b.txt"), "../outside/b.txt", "escape/b.txt"]) {
      await assert.rejects(
        () => executor.request(executorInput(wsGrant), "applyPatch", { mode: "apply", patch: updatePatch(target, "beta", "hacked") }),
        (error) => error.code === "direct_access_profile_path_outside_workspace",
        `workspace patch must reject ${target}`,
      );
    }
    assert.equal(await fs.readFile(path.join(outsideRoot, "b.txt"), "utf8"), "beta\n");
    const createPatch = ["*** Begin Patch", "*** Add File: src/new/created.txt", "+created", "*** End Patch"].join("\n");
    assert.equal((await executor.request(executorInput(wsGrant), "applyPatch", { mode: "apply", patch: createPatch })).status, "applied");
    const roGrant = issue("read_only", "exec_ro");
    await assert.rejects(
      () => executor.request(executorInput(roGrant), "applyPatch", { mode: "dryRun", patch: updatePatch("src/a.txt", "alpha2", "alpha3") }),
      (error) => ["direct_access_profile_write_blocked", "capability_not_in_grant_population"].includes(error.code),
    );
    const roRead = await executor.request(executorInput(roGrant), "readFile", { relPath: path.join(outsideRoot, "b.txt") });
    assert.equal(roRead.text, "beta\n", "sandboxed profiles keep vanilla full-disk read semantics");
    const fullGrant = issue("full_access", "exec_full");
    assert.equal((await executor.request(executorInput(fullGrant), "applyPatch", { mode: "apply", patch: updatePatch(path.join(outsideRoot, "b.txt"), "beta", "beta2") })).status, "applied");
    report.checks.push("local_executor_workspace_boundary");

    // 5. Locality: a WSL workspace is local only inside the same distro.
    assert.equal(workspaceExecutesLocally("local", {}), true);
    assert.equal(workspaceExecutesLocally("wsl", { workspace: { distro: "Ubuntu" } }, { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), true);
    assert.equal(workspaceExecutesLocally("wsl", { workspace: { distro: "Debian" } }, { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), false);
    assert.equal(workspaceExecutesLocally("wsl", { workspace: { distro: "Ubuntu" } }, { platform: "win32", env: {} }), false);
    assert.equal(workspaceExecutesLocally("windows", {}), false);
    report.checks.push("workspace_locality");

    // 6. Stateful exec: sandboxed profiles always go through the launcher.
    const spawned = [];
    const fakeManager = new DirectStatefulExecSessionManager({
      workspaceRootResolver: () => workspaceRoot,
      sandbox: { wrap: (spec) => ({ command: "/fake/bwrap", args: ["--fake", spec.sandboxMode, "--", "/bin/sh", "-c", spec.shellCommand], launcher: "fake", networkAccess: false }) },
      spawnImpl: (command, args) => {
        spawned.push({ command, args });
        throw new Error("fixture spawn stops here");
      },
    });
    const wsExecBinding = executorInput(wsGrant);
    const fakeResult = fakeManager.start({ ...wsExecBinding, cmd: "echo hi" });
    assert.equal(spawned[0].command, "/fake/bwrap");
    assert.deepEqual(spawned[0].args.slice(0, 2), ["--fake", "workspace-write"]);
    assert.equal(fakeResult.sandboxMode, "workspace-write");
    assert.equal(fakeResult.networkAccess, false);
    fakeManager.start({ ...executorInput(fullGrant), cmd: "echo hi" });
    assert.match(spawned[1].command, /\/bash$/, "full access runs cmd in the native shell without a sandbox");
    assert.deepEqual(spawned[1].args, ["-c", "echo hi"]);
    const noSandboxManager = new DirectStatefulExecSessionManager({
      workspaceRootResolver: () => workspaceRoot,
      sandbox: new BubblewrapExecSandbox({ platform: "win32" }),
    });
    assert.throws(
      () => noSandboxManager.start({ ...wsExecBinding, cmd: "echo hi" }),
      (error) => error.code === "direct_stateful_exec_sandbox_unavailable" && /Full access/.test(error.message),
    );
    report.checks.push("exec_sandbox_routing");

    // 7. Real bubblewrap enforcement, when this host supports it.
    if (process.platform === "linux" && bwrapUsable()) {
      const realManager = new DirectStatefulExecSessionManager({ workspaceRootResolver: () => workspaceRoot });
      // /tmp stays writable in Workspace mode by design, so the outside probe
      // targets the home directory, which the sandbox mounts read-only.
      const homeProbe = path.join(os.homedir(), `.direct-access-profiles-probe-${process.pid}-${Date.now()}`);
      const script = [
        "echo inside > sandbox-inside.txt",
        `(echo outside > ${JSON.stringify(homeProbe)}) 2>/dev/null && echo OUTSIDE_WRITE_OK || echo OUTSIDE_WRITE_BLOCKED`,
        "grep -c : /proc/net/dev",
      ].join("; ");
      let settled;
      try {
        const started = realManager.start({ ...wsExecBinding, cmd: script });
        settled = await runToCompletion(realManager, started, wsExecBinding);
      } finally {
        await fs.rm(homeProbe, { force: true });
      }
      assert.equal(settled.status, "completed", settled.stderrPreview);
      assert.match(settled.stdoutPreview, /OUTSIDE_WRITE_BLOCKED/);
      assert.equal(settled.stdoutPreview.trim().split("\n").pop(), "1", "only the loopback interface exists without network access");
      assert.equal(await fs.readFile(path.join(workspaceRoot, "sandbox-inside.txt"), "utf8"), "inside\n");
      const roStarted = realManager.start({ ...executorInput(roGrant), cmd: "(echo x > ro-blocked.txt) 2>/dev/null && echo RO_WRITE_OK || echo RO_WRITE_BLOCKED" });
      const roSettled = await runToCompletion(realManager, roStarted, executorInput(roGrant));
      assert.match(roSettled.stdoutPreview, /RO_WRITE_BLOCKED/);
      await realManager.dispose("regression_done");
      report.checks.push("bubblewrap_enforced");
    } else {
      report.checks.push("bubblewrap_skipped_unavailable");
    }

    // 8. Actionable exec errors return to the model instead of failing the turn.
    const execSession = newSession("rejected_exec_thread");
    const execGrant = issue("workspace", execSession.sessionId);
    const execTurn = sessionStore.createTurn(execSession.sessionId, {
      input: [{ role: "user", text: "run it" }],
      model: "gpt-5.6-sol",
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["exec_command"],
        directThreadHarnessGrantId: execGrant.grantId,
      },
    });
    sessionStore.updateTurnState(execSession.sessionId, execTurn.turnId, "streaming", { responseId: "resp_rejected_exec" });
    const execObligation = sessionStore.addToolObligations(execSession.sessionId, execTurn.turnId, [{
      type: "tool_call_completed",
      itemId: "item_rejected_exec",
      callId: "call_rejected_exec",
      name: "exec_command",
      toolType: "function_call",
      argumentsJson: JSON.stringify({ cmd: "echo hi" }),
      responseId: "resp_rejected_exec",
    }], { parentResponseId: "resp_rejected_exec", parentResponseSource: "native_direct_initial_stream", stepOrdinal: 1 }).obligations[0];
    const rejectingController = new DirectLiveTextController({
      sessionStore,
      harnessGrantResolver: () => execGrant,
      statefulExecSessionManager: noSandboxManager,
    });
    let continuedEnvelope = null;
    rejectingController.continueAfterSafeResidentUtilityResult = async (_surface, _sid, _tid, _obligation, envelope) => {
      continuedEnvelope = envelope;
    };
    const emitted = await rejectingController.emitStatefulExecRequest(null, execSession.sessionId, execTurn.turnId, execObligation, project);
    assert.equal(emitted, 1);
    assert.equal(continuedEnvelope?.resultKind, "stateful_exec");
    assert.equal(continuedEnvelope.providerOutput.status, "rejected");
    assert.equal(continuedEnvelope.providerOutput.errorCode, "direct_stateful_exec_sandbox_unavailable");
    assert.equal(continuedEnvelope.providerOutput.commandStarted, false);
    assert.notEqual(sessionStore.readTurn(execSession.sessionId, execTurn.turnId).state, "failed");
    report.checks.push("actionable_exec_error_returned_to_model");

    // 9. A failing sub-agent policy preflight no longer fails the turn.
    const preflightSession = sessionStore.createSession({
      sessionId: "preflight_thread",
      projectId,
      title: "Preflight fail-open",
      model: "gpt-5.4",
      reasoningEffort: "high",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const preflightProject = {
      id: projectId,
      workspace: { kind: "local", localPath: workspaceRoot },
      surfaceBinding: { codex: { runtimeMode: "direct-experimental", directTransport: "live-text", directTier: "implementation-lane", model: "gpt-5.4", profileId: "access-profiles-profile" } },
    };
    const notifications = [];
    const preflightController = new DirectLiveTextController({
      sessionStore,
      profileDoc: {
        profile: {
          profileId: "access-profiles-profile",
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
      activeSubAgentPolicySemanticPreflight: async () => {
        const error = new Error("router offline");
        error.code = "direct_active_sub_agent_policy_semantic_router_unavailable";
        throw error;
      },
      fetchImpl: async () => new Response([
        "event: response.created",
        "data: {\"response\":{\"id\":\"resp_preflight\",\"model\":\"gpt-5.4\"}}",
        "",
        "event: response.output_text.delta",
        "data: {\"item_id\":\"msg_preflight\",\"delta\":\"Done.\"}",
        "",
        "event: response.completed",
        "data: {\"response\":{\"id\":\"resp_preflight\",\"status\":\"completed\"}}",
        "",
      ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const started = await preflightController.startTurn({
      sessionId: preflightSession.sessionId,
      clientTurnRequestId: "client_preflight_fail_open",
      promptText: "Do the task.",
      model: "gpt-5.4",
      effort: "high",
    }, { project: preflightProject, surfaceSession: { sendEvent: (event) => notifications.push(event) } });
    await preflightController.waitForTurnCompletion({ sessionId: preflightSession.sessionId, turnId: started.turn.id });
    const preflightTurn = sessionStore.readTurn(preflightSession.sessionId, started.turn.id);
    assert.equal(preflightTurn.requestShape.activeSubAgentPolicySemanticSettlementState, "preflight_unavailable");
    assert.equal(preflightTurn.requestShape.activeSubAgentPolicySemanticFailureCode, "direct_active_sub_agent_policy_semantic_router_unavailable");
    assert.notEqual(preflightTurn.state, "failed");
    assert(notifications.some((event) => event.method === "warning" && /sub-agent policy/i.test(event.params?.message || "")));
    report.checks.push("preflight_fail_open");

    // 10. Workbench turns do not require controlled routing.
    const rendererSource = await fs.readFile(new URL("../src/renderer/codex-surface.js", import.meta.url), "utf8");
    assert.match(rendererSource, /if \(!isDirectWorkbenchExperience\(\)\) params\.requireControlledRouting = true;/);
    assert.match(rendererSource, /accessProfile: preferredDirectAccessProfile\(\)/);
    report.checks.push("workbench_routing_not_required");

    report.status = "passed";
    console.log(JSON.stringify(report));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await main();
