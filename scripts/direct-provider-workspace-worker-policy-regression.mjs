#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectLiveTextController } = require("../src/main/direct/controller/live-text-controller");
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const {
  compileWorkspaceWorkerContract,
} = require("../src/main/direct/agents/workspace-worker-contract");
const {
  REPOSITORY_READ_TOOLS,
  WORKSPACE_WORKER_TOOLS,
  createWorkspaceParentAuthorityPacket,
  genericWorkspaceRepositoryProfile,
  validateWorkspaceParentAuthorityPacket,
} = require("../src/main/direct/agents/workspace-worker-policy-profile");
const {
  executeWorkspaceTool,
} = require("../src/main/direct/agents/workspace-worker-runtime");
const {
  WorkspaceWorkerLifecycleRegistry,
} = require("../src/main/direct/agents/workspace-worker-lifecycle-registry");
const {
  WorkspaceWorkerDelegationPolicyRegistry,
  issueWorkspaceParentAuthorityFromDelegationPolicy,
  validateWorkspaceWorkerDelegationPolicy,
} = require("../src/main/direct/agents/workspace-worker-delegation-policy");

const projectId = "project_provider_workspace_worker";
const workThreadId = "work_thread_provider_workspace_worker";
const project = {
  id: projectId,
  workThreadId,
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
    },
  },
};

const sourceNow = Date.now();
const registry = new WorkspaceWorkerDelegationPolicyRegistry({
  sources: [{
    schema: "direct_workspace_worker_delegation_source@1",
    sourceId: "provider_workspace_fixture_source",
    sourceRevision: 1,
    policyId: "provider_workspace_fixture_policy",
    policyRevision: 1,
    projectId,
    workThreadId,
    status: "admitted",
    roleLane: "implementation_worker",
    allowedToolProfiles: ["read_only_worker", "implementation_worker"],
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
    forbiddenTools: [],
    validFrom: new Date(sourceNow - 1_000).toISOString(),
    validUntil: new Date(sourceNow + 60_000).toISOString(),
    remoteMutationAllowed: false,
    arbitraryCommandAllowed: false,
    childMessagingAllowed: false,
    recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false,
    rawWorkspacePathAllowed: false,
  }],
});
const activePolicy = registry.resolve({ projectId, workThreadId, requestedProfileId: "implementation_worker" });
assert.equal(registry.descriptor().admittedSourceCount, 1);
assert.throws(
  () => new WorkspaceWorkerDelegationPolicyRegistry({ sources: [] }).resolve({
    projectId,
    workThreadId,
    requestedProfileId: "implementation_worker",
  }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_missing",
);
for (const unsafeScope of [
  { projectId: "/private/repository", workThreadId },
  { projectId, workThreadId: "work_thread\0another_scope" },
]) {
  assert.throws(
    () => new WorkspaceWorkerDelegationPolicyRegistry({
      sources: [{
        schema: "direct_workspace_worker_delegation_source@1",
        sourceId: "unsafe_scope_source",
        sourceRevision: 1,
        policyId: "unsafe_scope_policy",
        policyRevision: 1,
        projectId: unsafeScope.projectId,
        workThreadId: unsafeScope.workThreadId,
        status: "admitted",
        roleLane: "implementation_worker",
        allowedToolProfiles: ["implementation_worker"],
        allowedTools: [...WORKSPACE_WORKER_TOOLS],
        forbiddenTools: [],
        validFrom: new Date(sourceNow - 1_000).toISOString(),
        validUntil: new Date(sourceNow + 60_000).toISOString(),
        remoteMutationAllowed: false,
        arbitraryCommandAllowed: false,
        childMessagingAllowed: false,
        recursiveSpawnAllowed: false,
        providerMaySupplyAuthority: false,
        rawWorkspacePathAllowed: false,
      }],
    }),
    (error) => error?.code === "direct_workspace_worker_delegation_source_invalid",
  );
}
assert.throws(
  () => registry.resolve({ projectId, workThreadId, requestedProfileId: "unbounded_worker" }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_profile_denied",
);
const packet = issueWorkspaceParentAuthorityFromDelegationPolicy(activePolicy, {
  projectId,
  workThreadId,
  roleLane: "implementation_worker",
  requestedProfileId: "implementation_worker",
});
assert.equal(validateWorkspaceParentAuthorityPacket(packet), packet);
assert.equal(packet.delegationPolicyRef.policyDigest, activePolicy.policyDigest);
const registryBypassPacket = createWorkspaceParentAuthorityPacket({
  boundaryId: "forged_delegation_registry_bypass",
  upstreamPolicyId: activePolicy.policyId,
  upstreamAllowedTools: [...WORKSPACE_WORKER_TOOLS],
  allowedTools: [...WORKSPACE_WORKER_TOOLS],
  delegationPolicyRef: {
    ...packet.delegationPolicyRef,
    policyId: "forged_policy_without_registry_issuance",
    policyDigest: `sha256:${"6".repeat(64)}`,
  },
});
const poolLaunchBase = {
  taskName: "policy_scope_probe",
  message: "Inspect the bounded repository slice.",
  projectId,
  workThreadId,
  primaryThreadId: "direct_parent_provider_workspace",
  workspaceMode: "isolated_worktree",
  toolProfile: "implementation_worker",
  parentAuthorityPacket: packet,
  project,
};
const scopePool = new DirectNativeAgentPool({ workspaceWorkerRunner: async () => ({ status: "completed" }) });
assert.equal(
  scopePool.launch({
    ...poolLaunchBase,
    parentAuthorityPacket: registryBypassPacket,
  }).blockerCode,
  "direct_workspace_worker_delegation_policy_untrusted",
  "a generic process-branded authority packet cannot forge registry-issued delegation authority",
);
assert.equal(
  scopePool.launch({
    ...poolLaunchBase,
    parentAuthorityPacket: JSON.parse(JSON.stringify(packet)),
  }).blockerCode,
  "direct_workspace_parent_authority_invalid",
  "a serialized provider-visible policy packet must lose its process-private authority brand",
);
assert.equal(scopePool.launch({
  ...poolLaunchBase,
  workThreadId: "another_work_thread",
}).blockerCode, "direct_workspace_worker_delegation_policy_scope_mismatch");
const stalePool = new DirectNativeAgentPool({
  now: () => Date.parse(packet.delegationPolicyRef.expiresAt) + 1,
  workspaceWorkerRunner: async () => ({ status: "completed" }),
});
assert.equal(stalePool.launch(poolLaunchBase).blockerCode, "direct_workspace_worker_delegation_policy_stale");

const forgedPolicy = JSON.parse(JSON.stringify(activePolicy));
await assert.rejects(
  async () => validateWorkspaceWorkerDelegationPolicy(forgedPolicy, {
    projectId,
    workThreadId,
    requestedProfileId: "implementation_worker",
  }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_untrusted",
);

const staleRegistry = new WorkspaceWorkerDelegationPolicyRegistry({
  sources: [{
    schema: "direct_workspace_worker_delegation_source@1",
    sourceId: "stale_provider_workspace_fixture_source",
    sourceRevision: 1,
    policyId: "stale_provider_workspace_fixture_policy",
    policyRevision: 1,
    projectId,
    workThreadId,
    status: "admitted",
    roleLane: "implementation_worker",
    allowedToolProfiles: ["implementation_worker"],
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
    forbiddenTools: [],
    validFrom: new Date(sourceNow - 120_000).toISOString(),
    validUntil: new Date(sourceNow - 60_000).toISOString(),
    remoteMutationAllowed: false,
    arbitraryCommandAllowed: false,
    childMessagingAllowed: false,
    recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false,
    rawWorkspacePathAllowed: false,
  }],
});
assert.throws(
  () => staleRegistry.resolve({ projectId, workThreadId, requestedProfileId: "implementation_worker" }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_stale",
);
assert.throws(
  () => issueWorkspaceParentAuthorityFromDelegationPolicy(activePolicy, {
    projectId: "another_project",
    workThreadId,
    requestedProfileId: "implementation_worker",
  }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_project_mismatch",
);
assert.throws(
  () => issueWorkspaceParentAuthorityFromDelegationPolicy(activePolicy, {
    projectId,
    workThreadId: "another_work_thread",
    requestedProfileId: "implementation_worker",
  }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_work_thread_mismatch",
);

const readOnlyRegistry = new WorkspaceWorkerDelegationPolicyRegistry({
  sources: [{
    schema: "direct_workspace_worker_delegation_source@1",
    sourceId: "read_only_upstream_source",
    sourceRevision: 1,
    policyId: "read_only_upstream_policy",
    policyRevision: 1,
    projectId,
    workThreadId,
    status: "admitted",
    roleLane: "implementation_worker",
    allowedToolProfiles: ["implementation_worker"],
    allowedTools: [...REPOSITORY_READ_TOOLS],
    forbiddenTools: [],
    validFrom: new Date(sourceNow - 1_000).toISOString(),
    validUntil: new Date(sourceNow + 60_000).toISOString(),
    remoteMutationAllowed: false,
    arbitraryCommandAllowed: false,
    childMessagingAllowed: false,
    recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false,
    rawWorkspacePathAllowed: false,
  }],
});
const readOnlyUpstreamPolicy = readOnlyRegistry.resolve({ projectId, workThreadId, requestedProfileId: "implementation_worker" });
const narrowedPacket = issueWorkspaceParentAuthorityFromDelegationPolicy(readOnlyUpstreamPolicy, {
  projectId,
  workThreadId,
  requestedProfileId: "implementation_worker",
});
const binding = {
  bindingId: "binding_provider_workspace_fixture",
  bindingDigest: `sha256:${"1".repeat(64)}`,
  projectId,
  workerKey: "provider-workspace-fixture",
  workspaceKind: "git_worktree",
  branch: "codex/worker/provider-workspace-fixture",
  baseCommit: "2".repeat(40),
  rootEvidenceDigest: `sha256:${"3".repeat(64)}`,
  sourceRepositoryDigest: `sha256:${"5".repeat(64)}`,
  retainedAfterCompletion: true,
};
const repositoryPolicy = genericWorkspaceRepositoryProfile();
const { contract: narrowedContract } = compileWorkspaceWorkerContract({
  workspaceMode: "isolated_worktree",
  toolProfile: "implementation_worker",
  projectId,
  workThreadId,
  primaryThreadId: "direct_parent_provider_workspace",
  childAgentId: "direct_child_provider_workspace",
  binding,
  parentAuthorityPacket: narrowedPacket,
  repositoryPolicy,
  substrateCapabilities: {
    boundaryId: "fixture_substrate",
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
  },
});
assert.deepEqual(narrowedContract.authority.declaredTools, REPOSITORY_READ_TOOLS);
assert.equal(narrowedContract.authority.workspaceMutationAllowed, false);
assert.equal(narrowedContract.workspaceWorkerDelegationPolicyRef.policyDigest, readOnlyUpstreamPolicy.policyDigest);

let leaseNow = Date.parse(packet.delegationPolicyRef.issuedAt) + 1;
const { contract: mutationContract } = compileWorkspaceWorkerContract({
  workspaceMode: "isolated_worktree",
  toolProfile: "implementation_worker",
  projectId,
  workThreadId,
  primaryThreadId: "direct_parent_provider_workspace",
  childAgentId: "direct_child_expiry_probe",
  binding,
  parentAuthorityPacket: packet,
  repositoryPolicy,
  substrateCapabilities: {
    boundaryId: "fixture_substrate",
    allowedTools: [...WORKSPACE_WORKER_TOOLS],
  },
  now: () => leaseNow,
});
const mutationCalls = [];
await assert.rejects(
  () => executeWorkspaceTool({
    contract: mutationContract,
    parentAuthorityPacket: packet,
    now: () => leaseNow,
    provisioned: {
      workspaceRequest: async (method, params) => {
        mutationCalls.push({ method, mode: params.mode });
        leaseNow = Date.parse(packet.delegationPolicyRef.expiresAt) + 1;
        return { patchPlanId: "expiry_probe_plan" };
      },
    },
    stepOrdinal: 1,
    obligation: {
      name: "apply_patch",
      callId: "expiry_probe_call",
      argumentsText: JSON.stringify({
        patch: "--- a/value.js\n+++ b/value.js\n@@ -1 +1 @@\n-before\n+after\n",
      }),
    },
  }),
  (error) => error?.code === "direct_workspace_worker_delegation_policy_stale",
  "policy expiry between patch planning and apply must prevent the mutating phase",
);
assert.deepEqual(mutationCalls, [{ method: "applyWorkspaceWorkerPatch", mode: "dryRun" }]);
leaseNow = Date.parse(packet.delegationPolicyRef.issuedAt) + 2;
let inactiveLeaseBackendCalls = 0;
await assert.rejects(
  () => executeWorkspaceTool({
    contract: mutationContract,
    parentAuthorityPacket: packet,
    now: () => leaseNow,
    workspaceOperationLeaseValidator: () => {
      const error = new Error("inactive lease fixture");
      error.code = "direct_workspace_worker_operation_lease_inactive";
      throw error;
    },
    provisioned: {
      workspaceRequest: async () => {
        inactiveLeaseBackendCalls += 1;
        return {};
      },
    },
    stepOrdinal: 2,
    obligation: {
      name: "read_file",
      callId: "inactive_lease_probe_call",
      argumentsText: JSON.stringify({ path: "value.js" }),
    },
  }),
  (error) => error?.code === "direct_workspace_worker_operation_lease_inactive",
);
assert.equal(inactiveLeaseBackendCalls, 0);

const sessionStore = {
  readSession: () => ({
    projectId,
    agentThreadId: "direct_parent_provider_workspace",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    workThreadId,
    messages: [],
  }),
  readTurn: () => ({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    workThreadId,
  }),
};
let launchCount = 0;
let launchedPacket = null;
const pool = {
  launch: (input) => {
    launchCount += 1;
    launchedPacket = input.parentAuthorityPacket;
    return {
      status: "accepted",
      state: "accepted",
      childAgentId: "direct_child_provider_workspace",
      taskName: input.taskName,
      workspaceMode: input.workspaceMode,
      toolProfile: input.toolProfile,
      workspaceExecution: input.workspaceMode === "isolated_worktree" ? {
        schema: "direct_workspace_worker_execution@1",
        status: "provisioning_pending",
        workspaceMode: input.workspaceMode,
        toolProfile: input.toolProfile,
        workspaceWorkerDelegationPolicyRef: input.parentAuthorityPacket.delegationPolicyRef,
        rawWorkspacePathIncluded: false,
      } : null,
    };
  },
  wait: async () => ({
    status: "completed",
    updates: [{
      childAgentId: "direct_child_provider_workspace",
      taskName: "provider_workspace_worker",
      state: "completed",
      resultSummary: "Bounded worker completed.",
      workspaceMode: "isolated_worktree",
      toolProfile: "implementation_worker",
      epistemicCapture: {
        status: "captured",
        receiptDigest: `sha256:${"4".repeat(64)}`,
        sessionId: "native_workspace_child_fixture",
        turnId: "native_workspace_turn_fixture",
      },
      epistemicCaptureComplete: true,
      epistemicCaptureOmission: null,
      evidenceConfidence: "exact",
    }],
  }),
  descriptor: () => ({ status: "ready", activeChildren: 1 }),
};

function controller(resolver) {
  return new DirectLiveTextController({
    sessionStore,
    subAgentPool: pool,
    workspaceWorkerDelegationPolicyResolver: resolver,
  });
}

function spawnObligation(message, extra = {}) {
  return {
    name: "spawn_agent",
    callId: "call_provider_workspace_spawn",
    obligationId: "obligation_provider_workspace_spawn",
    argumentsText: JSON.stringify({
      task_name: "provider_workspace_worker",
      message,
      workspace_mode: "isolated_worktree",
      tool_profile: "implementation_worker",
      ...extra,
    }),
  };
}

const liveController = controller(() => activePolicy);
const accepted = await liveController.buildNativeSubAgentRuntimeEnvelope(
  "direct_parent_provider_workspace",
  "turn_provider_workspace",
  spawnObligation("Inspect, patch, and test the bounded repository slice."),
  project,
);
assert.equal(accepted.status, "ready_for_provider_continuation");
assert.equal(launchCount, 1);
assert.equal(launchedPacket.delegationPolicyRef.policyDigest, activePolicy.policyDigest);
assert.notEqual(launchedPacket, forgedPolicy);

const waitEnvelope = await liveController.buildNativeSubAgentRuntimeEnvelope(
  "direct_parent_provider_workspace",
  "turn_provider_workspace_wait",
  {
    name: "wait_agent",
    callId: "call_provider_workspace_wait",
    obligationId: "obligation_provider_workspace_wait",
    argumentsText: JSON.stringify({ targets: ["provider_workspace_worker"], timeout_ms: 0 }),
  },
  project,
);
assert.equal(waitEnvelope.providerOutput.updates[0].epistemicCaptureComplete, true);
assert.equal(waitEnvelope.providerOutput.updates[0].evidenceConfidence, "exact");

const durableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-provider-workspace-replay-"));
const durableDbPath = path.join(durableRoot, "workspace-lifecycle.sqlite");
let durableRegistry = new WorkspaceWorkerLifecycleRegistry({ dbPath: durableDbPath });
let durableRunnerCalls = 0;
const childSecret = "CHILD_SECRET=ultraviolet /home/private/provider-workspace";
try {
  const durablePool = new DirectNativeAgentPool({
    workspaceWorkerLifecycleRegistry: durableRegistry,
    workspaceWorkerRunner: async (input) => {
      durableRunnerCalls += 1;
      return {
        status: "completed",
        outputText: childSecret,
        reducedSummary: { summaryText: childSecret },
        resultDigest: `sha256:${"7".repeat(64)}`,
        workspaceExecution: {
          schema: "direct_workspace_worker_execution@1",
          status: "completed",
          workspaceMode: "isolated_worktree",
          toolProfile: "implementation_worker",
          workspaceWorkerDelegationPolicyRef: input.parentAuthorityPacket.delegationPolicyRef,
          rawWorkspacePathIncluded: false,
        },
        epistemicCapture: {
          status: "captured",
          errorCode: "",
          receiptDigest: `sha256:${"8".repeat(64)}`,
          sessionId: "capture_provider_workspace_replay",
          turnId: "capture_turn_provider_workspace_replay",
        },
        resultEnvelope: { confidence: "exact" },
      };
    },
  });
  const durableController = new DirectLiveTextController({
    sessionStore,
    subAgentPool: durablePool,
    workspaceWorkerDelegationPolicyResolver: () => activePolicy,
  });
  assert.equal(
    durablePool.launch(poolLaunchBase).blockerCode,
    "direct_workspace_worker_spawn_operation_missing",
    "a delegated launch with durable custody cannot omit its provider operation identity",
  );
  const durableSpawn = spawnObligation(
    "Inspect, patch, and test the bounded repository slice exactly once.",
    { agent_type: "manager" },
  );
  const [firstDurableEnvelope, concurrentDurableReplay] = await Promise.all([
    durableController.buildNativeSubAgentRuntimeEnvelope(
      "direct_parent_provider_workspace",
      "turn_provider_workspace_durable_replay",
      durableSpawn,
      project,
    ),
    durableController.buildNativeSubAgentRuntimeEnvelope(
      "direct_parent_provider_workspace",
      "turn_provider_workspace_durable_replay",
      durableSpawn,
      project,
    ),
  ]);
  assert.equal(firstDurableEnvelope.sideEffectExecuted, true);
  assert.equal(concurrentDurableReplay.sideEffectExecuted, false);
  assert.equal(concurrentDurableReplay.providerOutput.replayed, true);
  assert.equal(
    concurrentDurableReplay.providerOutput.childAgentId,
    firstDurableEnvelope.providerOutput.childAgentId,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const firstChildId = firstDurableEnvelope.providerOutput.childAgentId;
  const durableRecord = durablePool.inspect({
    projectId,
    primaryThreadId: "direct_parent_provider_workspace",
    target: firstChildId,
  });
  assert.equal(durableRecord.role, "implementation_worker");
  assert.equal(durableRecord.providerRoleLabelAcceptedAsAuthority, false);
  assert.equal(durableRecord.providerRoleLabelIgnored, true);
  assert.equal(durableRecord.resultSummary, "direct_workspace_worker_completed_captured");
  assert.equal(durableRecord.resultSummaryKind, "typed_status_code");
  assert.equal(JSON.stringify(durableRecord).includes(childSecret), false);

  const durableWait = await durableController.buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    "turn_provider_workspace_durable_wait",
    {
      name: "wait_agent",
      callId: "call_provider_workspace_durable_wait",
      obligationId: "obligation_provider_workspace_durable_wait",
      argumentsText: JSON.stringify({ targets: [firstChildId], timeout_ms: 0 }),
    },
    project,
  );
  assert.equal(durableWait.providerOutput.updates[0].resultSummary, "direct_workspace_worker_completed_captured");
  assert.equal(durableWait.providerOutput.updates[0].resultSummaryKind, "typed_status_code");
  assert.equal(durableWait.providerOutput.updates[0].childOutputIncluded, false);
  assert.equal(JSON.stringify(durableWait.providerOutput).includes(childSecret), false);

  const exactReplay = await durableController.buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    "turn_provider_workspace_durable_replay",
    durableSpawn,
    project,
  );
  assert.equal(exactReplay.providerOutput.replayed, true);
  assert.equal(exactReplay.providerOutput.childAgentId, firstChildId);
  assert.equal(exactReplay.sideEffectExecuted, false);
  assert.equal(exactReplay.runtimeLifecycleMutationExecuted, false);
  assert.equal(durableRunnerCalls, 1);

  const conflictingReplay = await durableController.buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    "turn_provider_workspace_durable_replay",
    spawnObligation("Conflicting replay must not launch another worker.", { agent_type: "manager" }),
    project,
  );
  assert.equal(conflictingReplay.status, "blocked");
  assert.equal(conflictingReplay.providerOutput.blockerCode, "direct_workspace_worker_spawn_operation_conflict");
  assert.equal(durableRunnerCalls, 1);

  const durableSession = durableRegistry.sessionForChild(firstChildId);
  assert.equal(durableSession.launchIdentity.launchOperationId.startsWith("provider_workspace_spawn_"), true);
  assert.match(durableSession.launchIdentity.canonicalInputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(durableSession.delegationAuthority.policyDigest, activePolicy.policyDigest);
  assert.equal(durableSession.delegationAuthority.sourceDigest, activePolicy.sourceDigest);
  assert.equal(durableSession.delegationAuthority.roleLane, "implementation_worker");
  assert.equal(durableSession.launchIdentity.authorityDigest, durableSession.delegationAuthority.authorityDigest);

  durableRegistry.close();
  durableRegistry = new WorkspaceWorkerLifecycleRegistry({ dbPath: durableDbPath });
  let restartedRunnerCalls = 0;
  const restartedPool = new DirectNativeAgentPool({
    workspaceWorkerLifecycleRegistry: durableRegistry,
    workspaceWorkerRunner: async () => {
      restartedRunnerCalls += 1;
      return { status: "completed" };
    },
  });
  const restartedDelegationRegistry = new WorkspaceWorkerDelegationPolicyRegistry({
    now: () => sourceNow + 10,
    sources: [{
      schema: "direct_workspace_worker_delegation_source@1",
      sourceId: "provider_workspace_fixture_source",
      sourceRevision: 1,
      policyId: "provider_workspace_fixture_policy",
      policyRevision: 1,
      projectId,
      workThreadId,
      status: "admitted",
      roleLane: "implementation_worker",
      allowedToolProfiles: ["read_only_worker", "implementation_worker"],
      allowedTools: [...WORKSPACE_WORKER_TOOLS],
      forbiddenTools: [],
      validFrom: new Date(sourceNow - 1_000).toISOString(),
      validUntil: new Date(sourceNow + 60_000).toISOString(),
      remoteMutationAllowed: false,
      arbitraryCommandAllowed: false,
      childMessagingAllowed: false,
      recursiveSpawnAllowed: false,
      providerMaySupplyAuthority: false,
      rawWorkspacePathAllowed: false,
    }],
  });
  const restartedPolicy = restartedDelegationRegistry.resolve({
    projectId,
    workThreadId,
    requestedProfileId: "implementation_worker",
  });
  assert.notEqual(restartedPolicy.policyDigest, activePolicy.policyDigest);
  assert.equal(restartedPolicy.sourceDigest, activePolicy.sourceDigest);
  const restartedController = new DirectLiveTextController({
    sessionStore,
    subAgentPool: restartedPool,
    workspaceWorkerDelegationPolicyResolver: () => restartedPolicy,
  });
  const restartReplay = await restartedController.buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    "turn_provider_workspace_durable_replay",
    durableSpawn,
    project,
  );
  assert.equal(restartReplay.providerOutput.replayed, true);
  assert.equal(restartReplay.providerOutput.childAgentId, firstChildId);
  assert.equal(restartReplay.sideEffectExecuted, false);
  assert.equal(restartedRunnerCalls, 0);
} finally {
  durableRegistry.close();
  fs.rmSync(durableRoot, { recursive: true, force: true });
}

for (const [label, resolver, expectedBlocker, caseProject = project] of [
  ["missing", undefined, "direct_workspace_worker_delegation_policy_missing"],
  ["empty-registry", (context) => new WorkspaceWorkerDelegationPolicyRegistry({ sources: [] }).resolve(context), "direct_workspace_worker_delegation_policy_missing"],
  ["forged", () => forgedPolicy, "direct_workspace_worker_delegation_policy_untrusted"],
  ["stale", () => staleRegistry.resolve({ projectId, workThreadId, requestedProfileId: "implementation_worker" }), "direct_workspace_worker_delegation_policy_stale"],
  ["wrong-project", () => activePolicy, "direct_workspace_worker_delegation_policy_project_mismatch", { ...project, id: "another_project" }],
  ["wrong-lane", () => activePolicy, "direct_workspace_worker_implementation_lane_required", {
    ...project,
    surfaceBinding: {
      codex: {
        ...project.surfaceBinding.codex,
        directTier: "chat-lane",
      },
    },
  }],
]) {
  const envelope = await controller(resolver).buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    `turn_${label}`,
    spawnObligation("Inspect the bounded repository slice."),
    caseProject,
  );
  assert.equal(envelope.providerOutput.blockerCode, expectedBlocker, label);
}

for (const privateFields of [
  { native_root: "/tmp/private/repository" },
  { repo_path: "C:\\Users\\Rose\\private" },
  { parent_authority_packet: forgedPolicy },
  { command: "git push origin HEAD" },
]) {
  const envelope = await liveController.buildNativeSubAgentRuntimeEnvelope(
    "direct_parent_provider_workspace",
    "turn_native_path",
    spawnObligation("Inspect the bounded repository slice.", privateFields),
    project,
  );
  assert.equal(envelope.providerOutput.blockerCode, "direct_workspace_worker_spawn_arguments_unsafe");
}
assert.equal(launchCount, 1, "blocked provider inputs must never reach the resident pool");

const reasoningEnvelope = await controller(undefined).buildNativeSubAgentRuntimeEnvelope(
  "direct_parent_provider_workspace",
  "turn_reasoning_child",
  {
    name: "spawn_agent",
    callId: "call_reasoning_child",
    obligationId: "obligation_reasoning_child",
    argumentsText: JSON.stringify({
      task_name: "reasoning_child",
      message: "Analyze the bounded concern without a workspace.",
      workspace_mode: "reasoning_only",
    }),
  },
  project,
);
assert.equal(reasoningEnvelope.status, "ready_for_provider_continuation");
assert.equal(launchCount, 2, "reasoning-only dispatch must not depend on workspace delegation policy");

console.log("direct-provider-workspace-worker-policy regression passed");
