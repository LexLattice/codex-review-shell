#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const { runDirectWorkspaceWorker } = require("../src/main/direct/agents/workspace-worker-runtime");
const {
  WORKSPACE_WORKER_TOOLS,
} = require("../src/main/direct/agents/workspace-worker-policy-profile");
const {
  WorkspaceWorkerDelegationPolicyRegistry,
} = require("../src/main/direct/agents/workspace-worker-delegation-policy");
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime");
const { persistNativeChildProviderTurn } = require("../src/main/direct/epistemic/native-child-capture");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");

const shellRoot = path.resolve(import.meta.dirname, "..");
const TOKEN = "provider-workspace-fixture-token";
const projectId = "project_headless_provider_workspace";
const workThreadId = "work_thread_headless_provider_workspace";
const parentSessionId = "direct_session_headless_provider_workspace";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function profileDoc() {
  return {
    profile: {
      profileId: "headless-provider-workspace-profile",
      ontology: {
        models: [{ id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", status: "accepted" }],
        continuationShapes: [{ id: "continuation.tool_result", field: "tool-result continuation", status: "accepted" }],
      },
    },
  };
}

function implementationProof() {
  return {
    status: "ready",
    evidenceState: "runtime_probed",
    canSelectImplementationLane: true,
    requiredCapabilities: ["read_file", "read_file_loop", "apply_patch", "run_command"].map((capabilityId) => ({
      capabilityId,
      status: "ready",
      evidenceState: "runtime_probed",
      evidenceId: `proof_${capabilityId}`,
      sourceCaseId: `fixture_${capabilityId}`,
      rawProviderPayloadIncluded: false,
      rawToolArgsIncluded: false,
      rawWorkspacePathIncluded: false,
      rawAccountIncluded: false,
    })),
    missingCapabilityIds: [],
    rawProviderPayloadIncluded: false,
    rawToolArgsIncluded: false,
    rawWorkspacePathIncluded: false,
    rawAccountIncluded: false,
  };
}

function config(rootDir) {
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId: "provider_workspace_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_provider_workspace"],
    }],
    workThreads: [{ workThreadId, status: "active", projectId }],
    routes: [{
      routeId: "route_provider_workspace",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId,
      targetThreadRef: {
        runtimePath: "direct-implementation",
        threadId: parentSessionId,
      },
      contextPolicyRef: "direct_implementation_headless_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-provider-workspace-fixture",
      toolAuthorityMode: "read_only",
      headlessImplementationPolicy: {
        autoDecisionMode: "approve",
        disposableWorkspace: true,
        allowedMethods: ["direct/tool/readOnly/requestApproval"],
        maxAutoDecisions: 1,
      },
    }],
  };
}

function event() {
  return {
    clientId: "provider_workspace_client",
    idempotencyKey: "provider-workspace-turn-1",
    eventSchema: "headless_text_event@1",
    eventClass: "operator_message",
    eventKind: "direct_implementation",
    sourceSystem: "fixture",
    requestedRouteId: "route_provider_workspace",
    text: "Delegate one isolated worker to read, patch, and test the bounded fixture, wait for it, then report completion.",
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

async function waitForPacket(baseUrl, packetId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await requestJson(baseUrl, `/v1/bridge/turn-packets/${encodeURIComponent(packetId)}`);
    assert.equal(result.response.status, 200);
    if (["provider_completed", "failed"].includes(result.body.packet.state)) return result.body.packet;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the provider workspace-worker headless turn");
}

function toolCallSse(responseId, name, args) {
  const itemId = `${responseId}_${name}`;
  const callId = `call_${responseId}_${name}`;
  const argumentsJson = JSON.stringify(args);
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.6-sol" } })}`,
    "",
    "event: response.output_item.added",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name } })}`,
    "",
    "event: response.function_call_arguments.delta",
    `data: ${JSON.stringify({ item_id: itemId, call_id: callId, delta: argumentsJson })}`,
    "",
    "event: response.output_item.done",
    `data: ${JSON.stringify({ item: { id: itemId, type: "function_call", call_id: callId, name, arguments: argumentsJson } })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

function completedSse(responseId, text) {
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id: responseId, model: "gpt-5.6-sol" } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `${responseId}_message`, delta: text })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ response: { id: responseId, status: "completed" } })}`,
    "",
  ].join("\n");
}

function normalizedToolEvents(responseId, tool, args) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    {
      type: "tool_call_started",
      sequence: 1,
      responseId,
      itemId: `${responseId}_${tool}`,
      callId: `call_${responseId}_${tool}`,
      name: tool,
      toolType: "function_call",
    },
    {
      type: "tool_call_completed",
      sequence: 2,
      responseId,
      itemId: `${responseId}_${tool}`,
      callId: `call_${responseId}_${tool}`,
      name: tool,
      toolType: "function_call",
      argumentsJson: JSON.stringify(args),
    },
    { type: "response_completed", sequence: 3, responseId, stopReason: "completed" },
  ];
}

function normalizedCompletedEvents(responseId, text) {
  return [
    { type: "session_started", sequence: 0, responseId, model: "gpt-5.6-sol" },
    { type: "message_delta", sequence: 1, responseId, itemId: `${responseId}_message`, text },
    { type: "response_completed", sequence: 2, responseId, stopReason: "completed" },
  ];
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-headless-provider-workspace-"));
const repositoryRoot = path.join(tempRoot, "fixture-repository");
fs.mkdirSync(path.join(repositoryRoot, "src"), { recursive: true });
fs.mkdirSync(path.join(repositoryRoot, "test"), { recursive: true });
fs.writeFileSync(path.join(repositoryRoot, "package.json"), JSON.stringify({
  name: "direct-provider-workspace-fixture",
  version: "1.0.0",
  private: true,
  scripts: { test: "node --test" },
}, null, 2) + "\n");
fs.writeFileSync(path.join(repositoryRoot, "src/value.js"), 'module.exports = "before";\n');
fs.writeFileSync(path.join(repositoryRoot, "test/value.test.js"), [
  'const test = require("node:test");',
  'const assert = require("node:assert/strict");',
  'const value = require("../src/value");',
  'test("value", () => assert.equal(value, "after"));',
  "",
].join("\n"));
run("git", ["init"], repositoryRoot);
run("git", ["config", "user.name", "Direct Provider Workspace Fixture"], repositoryRoot);
run("git", ["config", "user.email", "provider-workspace@invalid.example"], repositoryRoot);
run("git", ["add", "."], repositoryRoot);
run("git", ["commit", "-m", "test: seed provider workspace fixture"], repositoryRoot);
const parentHead = run("git", ["rev-parse", "HEAD"], repositoryRoot);

const sessionStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions") });
const threadStore = new DirectThreadStore({ rootDir: path.join(tempRoot, "threads"), mode: "index_only" });
const profile = profileDoc();
const project = {
  id: projectId,
  name: "Headless provider workspace fixture",
  repoPath: repositoryRoot,
  workThreadId,
  workspace: { kind: "local", localPath: repositoryRoot, label: "Provider workspace fixture" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      model: "gpt-5.6-sol",
      profileId: profile.profile.profileId,
    },
  },
};

let manager;
let daemon;
let parentSession;
let privateWorkerRoot = "";
let privateWorkerProject = null;
let privateBinding = null;
let childContract = null;
const childProviderBodies = [];
const parentProviderBodies = [];
let childStep = 0;

try {
  manager = new WorkspaceBackendManager({
    agentPath: path.join(shellRoot, "src/backend/wsl-agent.js"),
    fallbackRoot: shellRoot,
  });
  parentSession = await manager.ensureForProject(project, { workspaceHygiene: false });

  async function provision(input) {
    const workerKey = input.childAgentId.replace(/_/g, "-").slice(0, 72);
    const branch = `codex/worker/${workerKey}`;
    const provisioned = await parentSession.request("provisionGitWorktree", {
      workerKey,
      branch,
      baseRef: parentHead,
    }, 45_000);
    privateWorkerRoot = provisioned.worktreePath;
    privateBinding = { ...provisioned };
    delete privateBinding.worktreePath;
    privateWorkerProject = {
      ...project,
      id: `${project.id}__${workerKey}`.slice(0, 180),
      name: `${project.name} · ${workerKey}`,
      repoPath: privateWorkerRoot,
      workspace: { kind: "local", localPath: privateWorkerRoot, label: workerKey },
    };
    const workerSession = await manager.ensureForProject(privateWorkerProject, {
      workspaceHygiene: false,
      workspaceWorkerBinding: privateBinding,
    });
    const testProfile = await workerSession.request("directTestProfile", {}, 10_000);
    return {
      binding: privateBinding,
      testProfile,
      nativeRoot: privateWorkerRoot,
      workspaceRequest: (method, params = {}, timeoutMs) => workerSession.request(method, params, timeoutMs),
      release: () => manager.disposeForProject(privateWorkerProject),
    };
  }

  async function childProviderRequest(request) {
    childStep += 1;
    childProviderBodies.push(request.requestBody);
    const responseId = `resp_provider_workspace_child_${childStep}`;
    if (childStep === 1) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: normalizedToolEvents(responseId, "read_file", { path: "src/value.js" }),
      };
    }
    if (childStep === 2) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: normalizedToolEvents(responseId, "apply_patch", {
          patch: [
            "--- a/src/value.js",
            "+++ b/src/value.js",
            "@@ -1 +1 @@",
            '-module.exports = "before";',
            '+module.exports = "after";',
            "",
          ].join("\n"),
          summary: "Update the bounded fixture and its assertion.",
        }),
      };
    }
    if (childStep === 3) {
      return {
        terminal: { state: "tool_waiting", error: null },
        responseId,
        normalizedEvents: normalizedToolEvents(responseId, "run_test", {
          action: "test",
          targets: [],
          timeout_ms: 30_000,
        }),
      };
    }
    return {
      terminal: { state: "completed", error: null },
      responseId,
      normalizedEvents: normalizedCompletedEvents(responseId, "Bounded workspace patch and test completed."),
    };
  }

  const pool = new DirectNativeAgentPool({
    maxActiveChildren: 2,
    providerTurnRunner: async () => ({ terminalState: "completed", outputText: "reasoning child completed" }),
    workspaceWorkerRunner: async (input) => {
      const result = await runDirectWorkspaceWorker({
        ...input,
        workspaceProvisioner: provision,
        providerRequestRunner: childProviderRequest,
      });
      assert.ok(result.captureResult, JSON.stringify(result, null, 2));
      childContract = result.captureResult.workspaceWorkerContract;
      const receipt = persistNativeChildProviderTurn(sessionStore, {
        ...input,
        agent: {
          agentThreadId: input.childAgentId,
          displayLabel: input.displayLabel,
          role: input.role,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
        },
        attemptId: `headless_provider_workspace_${input.childAgentId}`,
        promptDigest: `sha256:${crypto.createHash("sha256").update(input.prompt).digest("hex")}`,
        contextDigest: childContract.contextAdmission.admittedContextDigest,
        contextMessageCount: childContract.contextAdmission.admittedMessageCount,
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

  const delegationSourceNow = Date.now();
  const delegationRegistry = new WorkspaceWorkerDelegationPolicyRegistry({
    sources: [{
      schema: "direct_workspace_worker_delegation_source@1",
      sourceId: "headless_provider_workspace_source",
      sourceRevision: 1,
      policyId: "headless_provider_workspace_delegation",
      policyRevision: 1,
      projectId,
      workThreadId,
      status: "admitted",
      roleLane: "implementation_worker",
      allowedToolProfiles: ["implementation_worker"],
      allowedTools: [...WORKSPACE_WORKER_TOOLS],
      forbiddenTools: [],
      validFrom: new Date(delegationSourceNow - 1_000).toISOString(),
      validUntil: new Date(delegationSourceNow + 10 * 60_000).toISOString(),
      remoteMutationAllowed: false,
      arbitraryCommandAllowed: false,
      childMessagingAllowed: false,
      recursiveSpawnAllowed: false,
      providerMaySupplyAuthority: false,
      rawWorkspacePathAllowed: false,
    }],
  });

  const controller = new DirectLiveTextController({
    sessionStore,
    directThreadStore: threadStore,
    profileDoc: profile,
    authStore: {
      readStatus: () => ({ status: "authenticated", accountId: "fixture-account", hasAccessToken: true, hasRefreshToken: false }),
      readCredentials: () => ({ accessToken: "fixture-access-token", accountId: "fixture-account" }),
    },
    implementationProofEvidenceResolver: () => implementationProof(),
    subAgentPool: pool,
    subAgentStatusSurfaceResolver: ({ sessionId }) => pool.statusSurface({
      projectId,
      workThreadId,
      primaryThreadId: sessionId,
    }),
    workspaceWorkerDelegationPolicyResolver: (context) => delegationRegistry.resolve(context),
    fetchImpl: async (_url, init = {}) => {
      const body = JSON.parse(init.body || "{}");
      parentProviderBodies.push(body);
      const call = parentProviderBodies.length;
      const text = JSON.stringify(body.input || "");
      if (call === 1) {
        return new Response(toolCallSse("resp_parent_workspace_spawn", "spawn_agent", {
          task_name: "bounded_workspace_implementation",
          message: "Read src/value.js, update the bounded fixture and its test, then run the compiled test action.",
          fork_turns: "none",
          model: "gpt-5.6-sol",
          reasoning_effort: "high",
          workspace_mode: "isolated_worktree",
          tool_profile: "implementation_worker",
        }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (call === 2) {
        assert.match(text, /spawn_agent_result/);
        assert.match(text, /headless_provider_workspace_delegation/);
        return new Response(toolCallSse("resp_parent_workspace_wait", "wait_agent", {
          targets: ["bounded_workspace_implementation"],
          timeout_ms: 20_000,
        }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      assert.match(text, /wait_agent_result/);
      assert.match(text, /epistemicCaptureComplete/);
      assert.match(text, /Bounded workspace patch and test completed/);
      return new Response(completedSse("resp_parent_workspace_done", "The isolated workspace worker completed with captured test evidence."), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  daemon = new DirectHeadlessBridgeDaemon(config(path.join(tempRoot, "headless")));
  const runtime = new DirectHeadlessTextRuntime({
    store: daemon.store,
    controller,
    project,
    implementationSettleTimeoutMs: 25_000,
  });
  daemon.turnRuntime = runtime;
  daemon.textRuntime = runtime;

  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;
  const submitted = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event()),
  });
  assert.equal(submitted.response.status, 202);
  const terminal = await waitForPacket(baseUrl, submitted.body.turnPacket.packetId);
  assert.equal(terminal.state, "provider_completed", JSON.stringify(terminal, null, 2));
  assert.equal(parentProviderBodies.length, 3);
  assert.equal(childProviderBodies.length, 4);

  const rootToolNames = parentProviderBodies[0].tools.map((tool) => tool.name);
  assert(rootToolNames.includes("spawn_agent"));
  assert(rootToolNames.includes("wait_agent"));
  const childToolNames = childProviderBodies[0].tools.map((tool) => tool.name);
  assert.deepEqual(childToolNames, WORKSPACE_WORKER_TOOLS);
  for (const forbiddenTool of ["run_command", "send_message", "spawn_agent", "apply_git", "git_push"]) {
    assert.equal(childToolNames.includes(forbiddenTool), false);
  }

  assert.equal(childContract.workspaceWorkerDelegationPolicyRef.policyId, "headless_provider_workspace_delegation");
  assert.equal(childContract.workspaceWorkerDelegationPolicyRef.projectId, projectId);
  assert.equal(childContract.workspaceWorkerDelegationPolicyRef.workThreadId, workThreadId);
  assert.equal(childContract.authority.arbitraryCommandAllowed, false);
  assert.equal(childContract.authority.remoteMutationAllowed, false);
  assert.equal(childContract.authority.recursiveSpawnAllowed, false);
  assert.equal(childContract.authority.bottomUpMessagingAllowed, false);
  assert.equal(childContract.policyCompilation.wideningPerformed, false);

  assert.equal(fs.readFileSync(path.join(repositoryRoot, "src/value.js"), "utf8"), 'module.exports = "before";\n');
  assert.equal(fs.readFileSync(path.join(privateWorkerRoot, "src/value.js"), "utf8"), 'module.exports = "after";\n');
  assert.equal(run("git", ["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot), "");

  const parentTurn = sessionStore.readTurn(parentSessionId, terminal.turnId);
  assert.equal(parentTurn.state, "completed");
  const obligationText = JSON.stringify(parentTurn.unresolvedObligations || []);
  assert.match(obligationText, /spawn_agent_result/);
  assert.match(obligationText, /wait_agent_result/);
  assert.match(obligationText, /epistemicCaptureComplete/);
  assert.match(obligationText, /sha256:/);

  const publicPayloadText = JSON.stringify({
    terminal,
    parentProviderBodies,
    pool: pool.statusSurface({ projectId, workThreadId, primaryThreadId: parentSessionId }),
  });
  for (const privatePath of [repositoryRoot, privateWorkerRoot, repositoryRoot.replaceAll("/", "\\"), privateWorkerRoot.replaceAll("/", "\\")]) {
    assert.equal(publicPayloadText.includes(privatePath), false, `public provider/status payload leaked ${privatePath}`);
  }
  assert.equal(publicPayloadText.includes("worktreePath"), false);

  const retainedWorkerKey = privateBinding.workerKey;
  const retainedBranch = privateBinding.branch;
  manager.disposeForProject(privateWorkerProject);
  await parentSession.request("removeGitWorktree", {
    workerKey: retainedWorkerKey,
    branch: retainedBranch,
    deleteBranch: true,
  }, 45_000);
  privateWorkerRoot = "";
} finally {
  if (daemon) await daemon.close();
  if (manager) manager.disposeAll();
  threadStore.close();
  await fsp.rm(tempRoot, { recursive: true, force: true });
}

console.log("direct-headless-provider-workspace-worker regression passed");
