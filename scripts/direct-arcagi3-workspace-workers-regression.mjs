#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const {
  executeWorkspaceTool,
  runDirectWorkspaceWorker,
} = require("../src/main/direct/agents/workspace-worker-runtime");
const {
  assertWorkspaceWorkerContractSafe,
  compileWorkspaceWorkerContract,
  workspaceWorkerToolSchemas,
} = require("../src/main/direct/agents/workspace-worker-contract");
const {
  nativeChildSessionId,
  persistNativeChildProviderTurn,
} = require("../src/main/direct/epistemic/native-child-capture");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

const shellRoot = path.resolve(import.meta.dirname, "..");
const arcagi3Root = path.resolve(
  process.env.ARCAGI3_REPOSITORY_ROOT || "/home/rose/work/arcagi3-odeu-local",
);

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: options.encoding === null ? null : "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${String(result.stderr || "")}`);
  return result;
}

function gitStatus(root) {
  return Buffer.from(run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], root, {
    encoding: null,
  }).stdout);
}

function toolEvents(responseId, tool, args) {
  return [
    {
      type: "session_started",
      sequence: 0,
      responseId,
      model: "gpt-5.6-sol",
    },
    {
      type: "tool_call_started",
      sequence: 1,
      itemId: `${responseId}_${tool}`,
      callId: `call_${responseId}_${tool}`,
      name: tool,
      toolType: "function_call",
      responseId,
    },
    {
      type: "tool_call_completed",
      sequence: 2,
      itemId: `${responseId}_${tool}`,
      callId: `call_${responseId}_${tool}`,
      name: tool,
      toolType: "function_call",
      argumentsJson: JSON.stringify(args),
      responseId,
    },
    {
      type: "usage_delta",
      sequence: 3,
      responseId,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 3,
        reasoningTokens: 1,
        totalTokens: 13,
      },
    },
    {
      type: "response_completed",
      sequence: 4,
      responseId,
      stopReason: "completed",
    },
  ];
}

function completedEvents(responseId, text) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    { type: "message_delta", sequence: 1, responseId, itemId: `${responseId}_message`, text },
    {
      type: "usage_delta",
      sequence: 2,
      responseId,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 3,
        reasoningTokens: 1,
        totalTokens: 13,
      },
    },
    { type: "response_completed", sequence: 3, responseId, stopReason: "completed" },
  ];
}

function childProject(parentProject, nativeRoot, childAgentId) {
  return {
    ...parentProject,
    id: `${parentProject.id}__${childAgentId}`,
    name: `${parentProject.name} · ${childAgentId}`,
    repoPath: nativeRoot,
    workspace: {
      kind: "local",
      localPath: nativeRoot,
      label: childAgentId,
    },
  };
}

assert.ok(fs.existsSync(path.join(arcagi3Root, "AGENTS.md")), `ArcAGI3 repository is unavailable at ${arcagi3Root}`);
const sourceStatusBefore = gitStatus(arcagi3Root);
const sourceHead = run("git", ["rev-parse", "HEAD"], arcagi3Root).stdout.trim();
const nativeTempRoot = process.platform === "linux" ? "/tmp" : os.tmpdir();
const tempRoot = fs.mkdtempSync(path.join(nativeTempRoot, "direct-arcagi3-workspace-workers-"));
const seedRoot = path.join(tempRoot, "arcagi3-seed");
const sessionRoot = path.join(tempRoot, "sessions");
let manager;

try {
  run("git", ["clone", "--local", "--no-hardlinks", arcagi3Root, seedRoot], tempRoot);
  fs.writeFileSync(path.join(seedRoot, "worker_fixture.py"), 'WORKER_VALUE = "seed"\n', "utf8");
  fs.writeFileSync(path.join(seedRoot, "test_worker_fixture.py"), [
    "from worker_fixture import WORKER_VALUE",
    "",
    "def test_worker_value():",
    '    assert WORKER_VALUE.startswith("worker-")',
    "",
  ].join("\n"), "utf8");
  fs.appendFileSync(path.join(seedRoot, "tests", "current_robot_tests.txt"), "\ntests/test_worker_fixture.py\n", "utf8");
  fs.renameSync(path.join(seedRoot, "test_worker_fixture.py"), path.join(seedRoot, "tests", "test_worker_fixture.py"));
  fs.mkdirSync(path.join(seedRoot, ".venv", "bin"), { recursive: true });
  const fixturePython = path.join(seedRoot, ".venv", "bin", "python");
  fs.writeFileSync(fixturePython, "#!/bin/sh\nexec python3 \"$@\"\n", "utf8");
  fs.chmodSync(fixturePython, 0o755);
  run("git", ["add", "worker_fixture.py", "tests/test_worker_fixture.py", "tests/current_robot_tests.txt"], seedRoot);
  run("git", ["add", "-f", ".venv/bin/python"], seedRoot);
  run("git", [
    "-c", "user.name=Direct Workspace Worker Fixture",
    "-c", "user.email=workspace-worker@invalid.example",
    "commit", "-m", "test: seed workspace worker fixture",
  ], seedRoot);
  const seedHead = run("git", ["rev-parse", "HEAD"], seedRoot).stdout.trim();
  const seedStatusBefore = gitStatus(seedRoot);

  const parentProject = {
    id: "project_arcagi3_workspace_worker_fixture",
    name: "ArcAGI3 workspace worker fixture",
    repoPath: seedRoot,
    workspace: { kind: "local", localPath: seedRoot, label: "ArcAGI3 seed clone" },
  };
  manager = new WorkspaceBackendManager({
    agentPath: path.join(shellRoot, "src/backend/wsl-agent.js"),
    fallbackRoot: shellRoot,
  });
  const parentSession = await manager.ensureForProject(parentProject, { workspaceHygiene: false });
  const dirtyProbePath = path.join(seedRoot, "workspace_worker_dirty_probe.txt");
  fs.writeFileSync(dirtyProbePath, "dirty parent state must not be omitted\n", "utf8");
  await assert.rejects(
    () => parentSession.request("provisionGitWorktree", {
      workerKey: "dirty-parent-probe",
      branch: "codex/worker/dirty-parent-probe",
      baseRef: seedHead,
    }, 45_000),
    (error) => error?.code === "workspace_worker_parent_worktree_dirty",
    "EXEC1 must fail closed instead of silently excluding uncommitted parent work",
  );
  fs.unlinkSync(dirtyProbePath);
  assert.deepEqual(gitStatus(seedRoot), seedStatusBefore);
  const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  sessionStore.ensure();
  const privateRealizations = new Map();
  const contracts = new Map();
  const providerBodies = [];
  const providerSteps = new Map();
  const workerTokenUsage = new Map();
  let firstProviderEntrants = 0;
  let releaseFirstProviderEntrants;
  const firstProviderBarrier = new Promise((resolve) => { releaseFirstProviderEntrants = resolve; });

  async function provision(input) {
    const workerKey = input.childAgentId.replace(/_/g, "-");
    const branch = `codex/worker/${workerKey}`;
    const provisioned = await parentSession.request("provisionGitWorktree", {
      workerKey,
      branch,
      baseRef: seedHead,
    }, 45_000);
    const nativeRoot = provisioned.worktreePath;
    const project = childProject(parentProject, nativeRoot, input.childAgentId);
    const session = await manager.ensureForProject(project, { workspaceHygiene: false });
    const testProfile = await session.request("directTestProfile", {}, 10_000);
    const binding = { ...provisioned };
    delete binding.worktreePath;
    const realization = {
      binding,
      testProfile,
      nativeRoot,
      workspaceRequest: (method, params = {}, timeoutMs) => session.request(method, params, timeoutMs),
    };
    privateRealizations.set(input.childAgentId, realization);
    return realization;
  }

  async function providerRequest(childAgentId, request) {
    providerBodies.push({ childAgentId, body: request.requestBody });
    const step = (providerSteps.get(childAgentId) || 0) + 1;
    providerSteps.set(childAgentId, step);
    if (step === 1) {
      firstProviderEntrants += 1;
      if (firstProviderEntrants === 2) releaseFirstProviderEntrants();
      await firstProviderBarrier;
    }
    const label = childAgentId.endsWith("a") ? "worker-a" : "worker-b";
    const responseId = `resp_${childAgentId}_${step}`;
    if (step === 1) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "inspect_repository", {}),
      };
    }
    if (step === 2) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "list_files", { path: "tests", limit: 20 }),
      };
    }
    if (step === 3) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "search_text", {
          query: "WORKER_VALUE",
          path: "worker_fixture.py",
          case_sensitive: true,
          max_results: 10,
        }),
      };
    }
    if (step === 4) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "read_file", { path: "worker_fixture.py" }),
      };
    }
    if (step === 5) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "apply_patch", {
          patch: [
            "--- a/worker_fixture.py",
            "+++ b/worker_fixture.py",
            "@@ -1 +1 @@",
            '-WORKER_VALUE = "seed"',
            `+WORKER_VALUE = "${label}"`,
            "",
          ].join("\n"),
          summary: `Set the isolated fixture to ${label}.`,
        }),
      };
    }
    if (step === 6) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: toolEvents(responseId, "run_test", {
          action: "test_focus",
          targets: ["tests/test_worker_fixture.py"],
          timeout_ms: 30_000,
        }),
      };
    }
    return {
      terminal: { state: "completed", error: null },
      responseId,
      normalizedEvents: completedEvents(responseId, `${label} completed its isolated patch and test.`),
    };
  }

  const pool = new DirectNativeAgentPool({
    maxActiveChildren: 8,
    providerTurnRunner: async () => ({ terminalState: "completed", outputText: "reasoning-only fixture" }),
    workspaceWorkerRunner: async (input) => {
      const result = await runDirectWorkspaceWorker({
        ...input,
        workspaceProvisioner: provision,
        providerRequestRunner: (request) => providerRequest(input.childAgentId, request),
      });
      assert.ok(result.captureResult, "workspace worker must return a typed terminal capture payload");
      contracts.set(input.childAgentId, result.captureResult.workspaceWorkerContract);
      workerTokenUsage.set(input.childAgentId, result.tokenUsage);
      const receipt = persistNativeChildProviderTurn(sessionStore, {
        ...input,
        agent: {
          agentThreadId: input.childAgentId,
          displayLabel: input.displayLabel,
          role: input.role,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
        },
        attemptId: `fixture_${input.childAgentId}`,
        promptDigest: `sha256:prompt_${input.childAgentId}`,
        contextDigest: result.captureResult.workspaceWorkerContract.contextAdmission.admittedContextDigest,
        contextMessageCount: result.captureResult.workspaceWorkerContract.contextAdmission.admittedMessageCount,
        requestBody: { model: input.model, reasoning: { effort: input.reasoningEffort } },
      }, result.captureResult);
      return {
        ...result,
        epistemicCapture: {
          status: "captured",
          errorCode: "",
          receiptDigest: receipt.captureDigest,
          sessionId: receipt.sessionId,
          turnId: receipt.turnId,
        },
        resultEnvelope: { confidence: "exact" },
        reducedSummary: { summaryText: result.outputText },
        captureResult: undefined,
      };
    },
  });

  const parentContextMessages = [
    { turnId: "turn_1", role: "user", text: "The worker fixture must remain isolated." },
    { turnId: "turn_1", role: "assistant", text: "Use one branch and worktree per child." },
  ];
  const launchA = pool.launch({
    childAgentId: "arcagi3-worker-a",
    taskName: "arcagi3_worker_a",
    projectId: parentProject.id,
    workThreadId: "work_thread_arcagi3_workspace_workers",
    primaryThreadId: "primary_arcagi3_workspace_workers",
    message: "Set the fixture value to worker-a and run its focused test.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    project: parentProject,
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "all",
    parentContextMessages,
  });
  const launchB = pool.launch({
    childAgentId: "arcagi3-worker-b",
    taskName: "arcagi3_worker_b",
    projectId: parentProject.id,
    workThreadId: "work_thread_arcagi3_workspace_workers",
    primaryThreadId: "primary_arcagi3_workspace_workers",
    message: "Set the fixture value to worker-b and run its focused test.",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    project: parentProject,
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    forkTurns: "all",
    parentContextMessages,
  });
  assert.equal(pool.descriptor().activeChildren, 2, "both isolated workers must hold active pool leases concurrently");
  const [waitA, waitB] = await Promise.all([
    pool.wait({
      projectId: parentProject.id,
      primaryThreadId: "primary_arcagi3_workspace_workers",
      target: launchA.childAgentId,
      timeoutMs: 120_000,
    }),
    pool.wait({
      projectId: parentProject.id,
      primaryThreadId: "primary_arcagi3_workspace_workers",
      target: launchB.childAgentId,
      timeoutMs: 120_000,
    }),
  ]);
  const recordA = waitA.updates[0];
  const recordB = waitB.updates[0];
  assert.equal(recordA.state, "completed");
  assert.equal(recordB.state, "completed");
  assert.equal(recordA.workspaceMode, "isolated_worktree");
  assert.equal(recordA.toolProfile, "implementation_worker");
  assert.equal(recordA.workspaceExecution.toolResultCount, 6);
  assert.equal(recordB.workspaceExecution.toolResultCount, 6);
  assert.notEqual(recordA.workspaceExecution.binding.bindingId, recordB.workspaceExecution.binding.bindingId);
  assert.notEqual(recordA.workspaceExecution.binding.branch, recordB.workspaceExecution.binding.branch);
  assert.equal(recordA.epistemicCaptureComplete, true);
  assert.equal(recordB.epistemicCaptureComplete, true);
  assert.equal(recordA.evidenceConfidence, "exact");
  assert.equal(recordB.evidenceConfidence, "exact");
  assert.deepEqual(workerTokenUsage.get(launchA.childAgentId), {
    inputTokens: 70,
    cachedInputTokens: 14,
    outputTokens: 21,
    reasoningOutputTokens: 7,
    totalTokens: 91,
  });

  const realizationA = privateRealizations.get(launchA.childAgentId);
  const realizationB = privateRealizations.get(launchB.childAgentId);
  assert.notEqual(realizationA.nativeRoot, realizationB.nativeRoot);
  assert.equal(
    path.relative(tempRoot, realizationA.nativeRoot).startsWith(".."),
    false,
    "worker A's mutable root must be realized only inside the disposable clone boundary",
  );
  assert.equal(
    path.relative(tempRoot, realizationB.nativeRoot).startsWith(".."),
    false,
    "worker B's mutable root must be realized only inside the disposable clone boundary",
  );
  assert.equal(path.relative(arcagi3Root, realizationA.nativeRoot).startsWith(".."), true);
  assert.equal(path.relative(arcagi3Root, realizationB.nativeRoot).startsWith(".."), true);
  assert.equal(fs.readFileSync(path.join(seedRoot, "worker_fixture.py"), "utf8"), 'WORKER_VALUE = "seed"\n');
  assert.equal(fs.readFileSync(path.join(realizationA.nativeRoot, "worker_fixture.py"), "utf8"), 'WORKER_VALUE = "worker-a"\n');
  assert.equal(fs.readFileSync(path.join(realizationB.nativeRoot, "worker_fixture.py"), "utf8"), 'WORKER_VALUE = "worker-b"\n');
  assert.deepEqual(gitStatus(seedRoot), seedStatusBefore, "the seed checkout must remain unchanged");

  const contractA = contracts.get(launchA.childAgentId);
  const contractB = contracts.get(launchB.childAgentId);
  assertWorkspaceWorkerContractSafe(contractA);
  assertWorkspaceWorkerContractSafe(contractB);
  assert.deepEqual(contractA.authority.declaredTools, [
    "inspect_repository",
    "list_files",
    "match_files",
    "search_text",
    "read_file",
    "apply_patch",
    "run_test",
  ]);
  assert.equal(contractA.authority.recursiveSpawnAllowed, false);
  assert.equal(contractA.authority.remoteMutationAllowed, false);
  assert.equal(contractA.authority.bottomUpMessagingAllowed, false);
  assert.equal(contractA.contextAdmission.admittedMessageCount, 2);
  assert.equal(contractA.testProfile.profileId, "arcagi3_pinned_make_actions");
  assert.deepEqual(contractA.testProfile.actionsAllowed, ["test_focus", "check", "test"]);
  assert.equal(contractA.repositoryPolicy.profileId, "arcagi3-odeu-local");
  assert.equal(contractA.repositoryPolicy.validationPosture, "exact");
  assert.equal(contractA.authority.requestedToolProfileAdvisory, true);
  assert.equal(contractA.authority.testProcessIsolationGuaranteed, false);
  assert.equal(contractA.authority.testNetworkIsolationGuaranteed, false);

  const readOnlyContract = compileWorkspaceWorkerContract({
    projectId: parentProject.id,
    workThreadId: "work_thread_arcagi3_workspace_workers",
    primaryThreadId: "primary_arcagi3_workspace_workers",
    childAgentId: launchA.childAgentId,
    workspaceMode: "isolated_worktree",
    toolProfile: "read_only_worker",
    binding: realizationA.binding,
    testProfile: realizationA.testProfile,
    contextMessages: parentContextMessages,
    contextHandoffMode: "full",
  }).contract;
  assert.deepEqual(readOnlyContract.authority.declaredTools, [
    "inspect_repository",
    "list_files",
    "match_files",
    "search_text",
    "read_file",
  ]);
  assert.deepEqual(workspaceWorkerToolSchemas(readOnlyContract).map((tool) => tool.name), [
    "inspect_repository",
    "list_files",
    "match_files",
    "search_text",
    "read_file",
  ]);
  await assert.rejects(
    () => executeWorkspaceTool({
      obligation: {
        name: "apply_patch",
        callId: "call_read_only_patch",
        argumentsText: JSON.stringify({ patch: "not admitted" }),
      },
      contract: readOnlyContract,
      provisioned: realizationA,
      stepOrdinal: 1,
    }),
    (error) => error?.code === "direct_workspace_worker_tool_not_declared",
    "a read-only constitution must reject patch execution",
  );
  const invalidProfileLaunch = pool.launch({
    childAgentId: "arcagi3-worker-invalid",
    taskName: "arcagi3_worker_invalid",
    projectId: parentProject.id,
    primaryThreadId: "primary_arcagi3_workspace_workers",
    message: "This must not launch.",
    workspaceMode: "isolated_worktree",
    toolProfile: "unbounded_worker",
    project: parentProject,
  });
  assert.equal(invalidProfileLaunch.status, "blocked");
  assert.equal(invalidProfileLaunch.blockerCode, "direct_workspace_worker_tool_profile_invalid");

  await assert.rejects(
    () => executeWorkspaceTool({
      obligation: {
        name: "read_file",
        callId: "call_cross_workspace_read",
        argumentsText: JSON.stringify({ path: realizationB.nativeRoot }),
      },
      contract: contractA,
      provisioned: realizationA,
      stepOrdinal: 4,
    }),
    (error) => error?.code === "direct_workspace_worker_path_invalid",
    "worker A must not address worker B through a native path",
  );
  await assert.rejects(
    () => executeWorkspaceTool({
      obligation: {
        name: "read_file",
        callId: "call_private_git_metadata_read",
        argumentsText: JSON.stringify({ path: ".git" }),
      },
      contract: contractA,
      provisioned: realizationA,
      stepOrdinal: 4,
    }),
    (error) => error?.code === "direct_workspace_worker_git_metadata_forbidden",
    "a workspace worker must not read the linked worktree's native Git-dir pointer",
  );

  for (const entry of providerBodies) {
    const names = (entry.body.tools || []).map((tool) => tool.name);
    assert.deepEqual(names, [
      "inspect_repository",
      "list_files",
      "match_files",
      "search_text",
      "read_file",
      "apply_patch",
      "run_test",
    ]);
    assert.equal(names.includes("run_command"), false);
    assert.equal(names.includes("spawn_agent"), false);
    assert.equal(names.includes("send_message"), false);
    assert.equal(entry.body.parallel_tool_calls, false);
  }
  const publicJson = JSON.stringify([recordA, recordB, pool.statusSurface({
    projectId: parentProject.id,
    workThreadId: "work_thread_arcagi3_workspace_workers",
    primaryThreadId: "primary_arcagi3_workspace_workers",
  }).listAgents()]);
  assert.equal(publicJson.includes(realizationA.nativeRoot), false);
  assert.equal(publicJson.includes(realizationB.nativeRoot), false);
  assert.equal(publicJson.includes(seedRoot), false);

  for (const [childAgentId, contract] of contracts.entries()) {
    const captureSessionId = nativeChildSessionId({
      projectId: parentProject.id,
      primaryThreadId: "primary_arcagi3_workspace_workers",
      childAgentId,
    });
    const captureSession = sessionStore.readSession(captureSessionId);
    assert.ok(captureSession, `missing Direct capture session for ${childAgentId}`);
    const captureTurn = sessionStore.readTurn(captureSessionId, captureSession.turns[0].turnId);
    assert.equal(captureTurn.requestShape.workspaceWorkerContractDigest, contract.contractDigest);
    assert.equal(captureTurn.requestShape.workspaceBindingDigest, contract.binding.bindingDigest);
    assert.equal(captureTurn.requestShape.workspaceWorkerToolResultCount, 6);
    assert.equal(captureTurn.toolResults.length, 6);
    assert.deepEqual(captureTurn.toolResults.map((result) => result.tool), [
      "inspect_repository",
      "list_files",
      "search_text",
      "read_file",
      "apply_patch",
      "run_test",
    ]);
  }

  for (const [childAgentId, contract] of contracts.entries()) {
    for (const [key, session] of [...manager.sessions.entries()]) {
      if (session.project.id.endsWith(`__${childAgentId}`)) {
        session.dispose();
        manager.sessions.delete(key);
      }
    }
    const cleanup = await parentSession.request("removeGitWorktree", {
      workerKey: contract.binding.workerKey,
      branch: contract.binding.branch,
      deleteBranch: true,
    }, 45_000);
    assert.equal(cleanup.worktreeRemoved, true);
    assert.equal(cleanup.branchRemoved, true);
  }
  assert.deepEqual(gitStatus(seedRoot), seedStatusBefore);
  const sourceStatusAfter = gitStatus(arcagi3Root);
  const sourceHeadAfter = run("git", ["rev-parse", "HEAD"], arcagi3Root).stdout.trim();
  const sourceRepositoryChangedDuringWitness =
    sourceHeadAfter !== sourceHead || !sourceStatusAfter.equals(sourceStatusBefore);

  console.log(JSON.stringify({
    ok: true,
    sourceHead,
    seedHead,
    parallelWorkspaceWorkers: 2,
    providerStepsPerWorker: Object.fromEntries(providerSteps),
    declaredTools: contractA.authority.declaredTools,
    distinctBindings: true,
    dirtyParentRejected: true,
    isolatedMutations: true,
    focusedTestsPassed: true,
    typedTerminalCaptures: 2,
    sourceRepositoryMutatedByHarness: false,
    sourceRepositoryChangedDuringWitness,
    rawWorkspacePathsExposed: false,
  }, null, 2));
} finally {
  manager?.disposeAll();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
