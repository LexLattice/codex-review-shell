#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectNativeAgentPool } = require("../src/main/direct/agents/native-agent-pool");
const {
  WorkspaceWorkerLifecycleRegistry,
  normalizeBinding,
} = require("../src/main/direct/agents/workspace-worker-lifecycle-registry");
const {
  WORKSPACE_WORKER_TOOLS,
} = require("../src/main/direct/agents/workspace-worker-policy-profile");
const {
  WorkspaceWorkerDelegationPolicyRegistry,
  issueWorkspaceParentAuthorityFromDelegationPolicy,
} = require("../src/main/direct/agents/workspace-worker-delegation-policy");
const {
  buildPolicySnapshot,
  createArtifactAuditEvidenceReceiptAuthority,
  createArtifactAuditPrincipalAuthority,
  digestFor,
} = require("../src/main/direct/artifacts/artifact-audit-kernel");
const {
  createDirectArtifactAuditStore,
} = require("../src/main/direct/artifacts/artifact-audit-store");
const {
  createDirectWorkspaceWorkerArtifactAdapter,
} = require("../src/main/direct/artifacts/workspace-worker-artifact-adapter");

const tempBase = process.platform === "win32" ? os.tmpdir() : "/tmp";
const root = fs.mkdtempSync(path.join(tempBase, "direct-worker-artifact-adapter-"));
const keyFilePath = path.join(root, "artifact-audit.key");
fs.writeFileSync(keyFilePath, crypto.randomBytes(32), { mode: 0o600 });
const sha = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const projectId = "adapter-project";
const workThreadId = "adapter-workthread";
const artifactClassId = "workspace-change-candidate";
const lifecycleRoot = path.join(root, "lifecycle");
const producerActor = { actorId: "producer-actor", roleId: "producer" };
const managerActor = { actorId: "manager-actor", roleId: "manager" };
const subscriberActor = { actorId: "parent-observer", roleId: "observer" };
const adapterActor = { actorId: "capture-adapter", roleId: "trusted-evidence-adapter" };
const auditorA = { actorId: "auditor-a", roleId: "static-auditor" };
const auditorB = { actorId: "auditor-b", roleId: "behavior-auditor" };

const policyInput = {
  artifactClassId,
  projectId,
  managerRoleId: "manager",
  roles: [
    { roleId: "manager", actors: [managerActor.actorId], rights: ["propose", "read"] },
    { roleId: "producer", actors: [producerActor.actorId], rights: ["propose"] },
    { roleId: "static-auditor", actors: [auditorA.actorId], rights: ["challenge"] },
    { roleId: "behavior-auditor", actors: [auditorB.actorId], rights: ["challenge"] },
    { roleId: "admission", actors: ["admission-actor"], rights: ["admit"] },
    { roleId: "observer", actors: [subscriberActor.actorId], rights: ["read", "subscribe"] },
  ],
  producerRoleIds: ["producer"],
  auditRequirements: [
    { requirementId: "behavior", auditorRoleIds: ["behavior-auditor"],
      separationRequired: true, evidenceKinds: ["audit_observation"] },
    { requirementId: "static", auditorRoleIds: ["static-auditor"],
      separationRequired: true, evidenceKinds: ["test_report"] },
  ],
  admissionRoleId: "admission",
  allowedEvidenceKinds: ["workspace_worker_terminal"],
  revision: 1,
};
const policy = buildPolicySnapshot(policyInput);
const authorityBindings = [
  [managerActor, ["declare", "act", "admin_read"]],
  [producerActor, ["act"]],
  [subscriberActor, ["act"]],
  [auditorA, ["act"]],
  [auditorB, ["act"]],
  [adapterActor, ["register_evidence"]],
].map(([actor, purposes]) => ({
  projectId, artifactClassId, policyDigest: policy.policyDigest,
  actorId: actor.actorId, roleId: actor.roleId, purposes,
}));
const artifactAuthority = createArtifactAuditPrincipalAuthority({
  authorityId: "adapter-artifact-harness", bindings: authorityBindings,
});
const evidenceReceiptAuthority = createArtifactAuditEvidenceReceiptAuthority({
  authorityId: "adapter-capture-service", adapter: adapterActor,
});
const principal = (actor, purpose = "act") => artifactAuthority.issue({
  projectId, artifactClassId, policyDigest: policy.policyDigest,
  actorId: actor.actorId, roleId: actor.roleId, purpose,
});
const principals = {
  manager: principal(managerActor), managerAdmin: principal(managerActor, "admin_read"),
  declaration: principal(managerActor, "declare"), producer: principal(producerActor),
  subscriber: principal(subscriberActor), auditorA: principal(auditorA), auditorB: principal(auditorB),
  evidenceRegistrar: principal(adapterActor, "register_evidence"),
};

const project = {
  id: projectId,
  workThreadId,
  surfaceBinding: { codex: { runtimeMode: "direct-experimental", directTransport: "live-text",
    directTier: "implementation-lane" } },
};
const now = Date.now();
const delegationRegistry = new WorkspaceWorkerDelegationPolicyRegistry({
  sources: [{
    schema: "direct_workspace_worker_delegation_source@1",
    sourceId: "adapter-delegation-source", sourceRevision: 1,
    policyId: "adapter-delegation", policyRevision: 1, projectId, workThreadId,
    status: "admitted", roleLane: "implementation_worker",
    allowedToolProfiles: ["implementation_worker"], allowedTools: [...WORKSPACE_WORKER_TOOLS],
    forbiddenTools: [], validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 120_000).toISOString(), remoteMutationAllowed: false,
    arbitraryCommandAllowed: false, childMessagingAllowed: false, recursiveSpawnAllowed: false,
    providerMaySupplyAuthority: false, rawWorkspacePathAllowed: false,
  }],
});
const delegationPolicy = delegationRegistry.resolve({
  projectId, workThreadId, requestedProfileId: "implementation_worker",
});
const parentAuthorityPacket = issueWorkspaceParentAuthorityFromDelegationPolicy(delegationPolicy, {
  projectId, workThreadId, roleLane: "implementation_worker",
  requestedProfileId: "implementation_worker",
});

let store;
let lifecycleRegistry;
let pool;
const launchedInputs = [];
const bindings = new Map();

function scope(artifactId) {
  return { projectId, workThreadId, artifactId, artifactClassId };
}

function launchInput(childAgentId, taskName, message) {
  return {
    childAgentId, taskName, message, projectId, workThreadId,
    primaryThreadId: "adapter-parent-thread", parentAgentId: "adapter-parent",
    workspaceMode: "isolated_worktree", toolProfile: "implementation_worker",
    spawnOperation: {
      parentSessionId: "adapter-parent-thread",
      parentTurnId: `adapter-parent-turn-${childAgentId}`,
      obligationId: `adapter-obligation-${childAgentId}`,
      callId: `adapter-call-${childAgentId}`,
    },
    parentAuthorityPacket, project,
  };
}

async function waitTerminal(childAgentId) {
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const record = pool.inspect({ target: childAgentId, projectId });
    if (record && ["completed", "failed", "cancelled", "cancellation_unacknowledged", "settlement_blocked"]
      .includes(record.state)) return record;
    await pool.wait({ target: childAgentId, projectId, timeoutMs: 1_000 });
  }
  throw new Error(`terminal wait failed:${childAgentId}`);
}

function prepareArtifact(artifactId) {
  const targetScope = scope(artifactId);
  store.requestArtifact({
    scope: targetScope, policyDigest: policy.policyDigest,
    principal: principals.manager, idempotencyKey: `request-${artifactId}`,
  });
  store.beginProduction({
    scope: targetScope, policyDigest: policy.policyDigest,
    principal: principals.producer, idempotencyKey: `produce-${artifactId}`,
    expectedRevision: 1, expectedState: "requested",
  });
  return targetScope;
}

function adapterOptionsFor(auditorSuffix = "live") {
  return {
    artifactStore: store, pool, lifecycleRegistry, evidenceReceiptAuthority,
    principals: {
      manager: principals.manager, producer: principals.producer,
      subscriber: principals.subscriber, evidenceRegistrar: principals.evidenceRegistrar,
    },
    projectId, artifactClassId, policyDigest: policy.policyDigest, producerActor,
    auditorProfiles: [
      { actorId: auditorB.actorId, roleId: auditorB.roleId, principal: principals.auditorB,
        verdict: "supported", evidenceKind: "audit_observation",
        launch: launchInput(`audit-b-${auditorSuffix}`, `audit_b_${auditorSuffix}`,
          "Run the bounded behavior checks selected by the parent harness.") },
      { actorId: auditorA.actorId, roleId: auditorA.roleId, principal: principals.auditorA,
        verdict: "supported", evidenceKind: "test_report",
        launch: launchInput(`audit-a-${auditorSuffix}`, `audit_a_${auditorSuffix}`,
          "Run the bounded static checks selected by the parent harness.") },
    ],
    eventTypes: ["candidate_recorded", "audit_started", "audit_verdict_recorded", "artifact_admitted"],
    waitTimeoutMs: 10_000,
  };
}

function adapterFor(auditorSuffix = "live") {
  return createDirectWorkspaceWorkerArtifactAdapter(adapterOptionsFor(auditorSuffix));
}

function assertNoCandidate(targetScope) {
  const head = store.inspectHeadAdministrative({
    scope: targetScope, policyDigest: policy.policyDigest, principal: principals.managerAdmin,
  });
  assert.equal(head.state, "under_production");
}

try {
  store = createDirectArtifactAuditStore({
    rootDir: root, storeId: "live-adapter", authority: artifactAuthority,
    evidenceReceiptAuthority, keyFilePath,
  });
  store.declareArtifactClass({ policy: policyInput, principal: principals.declaration });
  lifecycleRegistry = new WorkspaceWorkerLifecycleRegistry({ rootDir: lifecycleRoot });
  let blockedSettlementChild = "";
  const settleSession = lifecycleRegistry.settleSession.bind(lifecycleRegistry);
  lifecycleRegistry.settleSession = (sessionId, input) => {
    const session = lifecycleRegistry.session(sessionId);
    if (session?.childAgentId === blockedSettlementChild) {
      const error = new Error("direct_fixture_settlement_blocked");
      error.code = "direct_fixture_settlement_blocked";
      throw error;
    }
    return settleSession(sessionId, input);
  };
  pool = new DirectNativeAgentPool({
    maxActiveChildren: 8,
    workspaceWorkerLifecycleRegistry: lifecycleRegistry,
    workspaceWorkerRunner: async (input) => {
      launchedInputs.push(input);
      const workerKey = input.childAgentId.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 72);
      const binding = normalizeBinding({
        workerKey, branchName: `codex/worker/${workerKey}`,
        baseCommit: "a".repeat(40), headCommit: "b".repeat(40),
        worktreePathDigest: sha(`path:${workerKey}`), sourceRepositoryDigest: sha("repository"),
      });
      bindings.set(input.childAgentId, binding);
      pool.beginWorkspaceProvisioning(input.childAgentId, {
        operationId: `fixture-provision:${input.childAgentId}`,
        workerKey, branchName: binding.branchName,
      });
      pool.bindWorkspaceForChild(input.childAgentId, {
        operationId: `fixture-bind:${input.childAgentId}`, binding,
      });
      if (input.childAgentId === "cancel-unack-producer") {
        if (!input.signal.aborted) {
          await new Promise((resolve) => input.signal.addEventListener("abort", resolve, { once: true }));
        }
        return { status: "cancelled", blockerCode: "fixture_cancelled",
          cancellationAcknowledged: false, backendQuiesced: false };
      }
      const resultDigest = digestFor("adapter-fixture-worker-result@1", { childAgentId: input.childAgentId });
      const captureComplete = input.childAgentId !== "capture-incomplete-producer";
      return {
        status: "completed", blockerCode: "", resultDigest,
        epistemicCapture: captureComplete ? {
          status: "captured", errorCode: "", receiptDigest: sha(`capture:${input.childAgentId}`),
          sessionId: `capture-session-${input.childAgentId}`,
          turnId: `capture-turn-${input.childAgentId}`,
        } : { status: "unavailable", errorCode: "fixture_capture_missing" },
        resultEnvelope: { confidence: captureComplete ? "exact" : "partial" },
        workspaceExecution: {
          schema: "direct_workspace_worker_execution@1", status: "completed",
          workspaceMode: "isolated_worktree", toolProfile: "implementation_worker",
          binding: {
            schema: "direct_workspace_worker_binding@1", bindingId: `binding-${input.childAgentId}`,
            bindingDigest: binding.bindingDigest, projectId, workerKey, workspaceKind: "git_worktree",
            branch: binding.branchName, baseCommit: binding.baseCommit,
            rootEvidenceDigest: binding.worktreePathDigest,
            sourceRepositoryDigest: binding.sourceRepositoryDigest,
            retainedAfterCompletion: true, rawWorkspacePathIncluded: false,
          },
          bottomUpMessagingAllowed: false, rawWorkspacePathIncluded: false,
          rawProviderPayloadIncluded: false,
        },
      };
    },
  });

  const liveScope = prepareArtifact("live-candidate");
  const producerLaunch = pool.launch(launchInput("live-producer", "live_producer",
    "Produce the bounded workspace result selected by the parent harness."));
  assert.notEqual(producerLaunch.status, "blocked", producerLaunch.blockerCode);
  assert.equal((await waitTerminal(producerLaunch.childAgentId)).state, "completed");
  const result = await adapterFor().run({
    scope: liveScope, revision: 1, producerChildAgentId: producerLaunch.childAgentId,
    subscriptionId: "live-parent-subscription", idempotencyKeyPrefix: "live",
    projectionAfterSequence: 0, projectionLimit: 100,
  });
  assert.equal(result.terminalState, "supported");
  assert.equal(result.canonicalProjectTruthChanged, false);
  assert.equal(result.worldManagerWritePerformed, false);
  assert.equal(result.worktreeCleanupPerformed, false);
  assert.equal(result.bottomUpMessageCount, 0);
  assert.equal(result.providerArtifactAuthorityGranted, false);
  assert.deepEqual(result.subscriptionProjection.transitions.map((event) => event.eventType), [
    "candidate_recorded", "audit_started", "audit_verdict_recorded", "audit_verdict_recorded",
  ]);
  assert.equal(result.subscriptionProjection.transitions.some((event) => event.stateTo === "admitted"), false);
  assert.equal(store.inspectHead({
    scope: liveScope, policyDigest: policy.policyDigest, principal: principals.subscriber,
    subscriptionId: "live-parent-subscription",
  }).state, "supported");
  const retriedSubscription = store.subscribe({
    subscriptionId: "live-parent-subscription", projectId, workThreadId,
    artifactId: liveScope.artifactId, artifactClassId, policyDigest: policy.policyDigest,
    principal: principals.subscriber,
    eventTypes: ["artifact_admitted", "audit_verdict_recorded", "audit_started", "candidate_recorded"],
  });
  assert.equal(retriedSubscription.subscriptionId, "live-parent-subscription");
  assert.equal(store.subscribe({
    subscriptionId: "live-parent-subscription", projectId, workThreadId,
    artifactId: liveScope.artifactId, artifactClassId, policyDigest: policy.policyDigest,
    principal: principals.subscriber,
    eventTypes: ["candidate_recorded", "audit_started", "audit_verdict_recorded", "artifact_admitted"],
  }).subscriptionDigest, retriedSubscription.subscriptionDigest);
  for (const childAgentId of ["live-producer", "audit-a-live", "audit-b-live"]) {
    const receipt = lifecycleRegistry.settlementReceipt(`workspace_worker_session_${childAgentId}`);
    assert.equal(receipt.bindingDigest, bindings.get(childAgentId).bindingDigest);
    assert.equal(lifecycleRegistry.session(receipt.sessionId).state, "completed");
    assert.equal(lifecycleRegistry.session(receipt.sessionId).workspaceCustody.retainedForInspection, true);
  }
  const durableProducerReceiptDigest = lifecycleRegistry.settlementReceipt(
    "workspace_worker_session_live-producer").receiptDigest;
  assert.equal(launchedInputs.every((launch) => !Object.keys(launch).some((key) =>
    /artifact|requirement|verdict|evidence/i.test(key))), true);
  const forgedProfileOptions = adapterOptionsFor("semantic-forgery");
  forgedProfileOptions.auditorProfiles[0] = {
    ...forgedProfileOptions.auditorProfiles[0],
    launch: {
      ...forgedProfileOptions.auditorProfiles[0].launch,
      providerOptions: { artifactId: liveScope.artifactId },
    },
  };
  assert.throws(() => createDirectWorkspaceWorkerArtifactAdapter(forgedProfileOptions),
    (error) => error?.code === "direct_workspace_worker_artifact_provider_semantics_forbidden");

  const evidenceBeforeHostile = store.diagnostics({
    projectId, artifactClassId, policyDigest: policy.policyDigest, principal: principals.manager,
  }).counts.evidence;

  const cancelScope = prepareArtifact("cancel-candidate");
  pool.launch(launchInput("cancel-unack-producer", "cancel_unack_producer", "Run until cancelled."));
  await new Promise((resolve) => setImmediate(resolve));
  pool.interrupt({ target: "cancel-unack-producer", projectId, reasonCode: "fixture_cancel" });
  assert.equal((await waitTerminal("cancel-unack-producer")).state, "cancellation_unacknowledged");
  assert.throws(() => lifecycleRegistry.settlementReceipt(
    "workspace_worker_session_cancel-unack-producer"),
  (error) => error?.code === "direct_workspace_worker_settlement_receipt_unavailable");
  await assert.rejects(() => adapterFor("cancel").run({
    scope: cancelScope, revision: 1, producerChildAgentId: "cancel-unack-producer",
    subscriptionId: "cancel-subscription", idempotencyKeyPrefix: "cancel",
    projectionAfterSequence: 0, projectionLimit: 20,
  }), (error) => error?.code === "direct_workspace_worker_artifact_cancellation_unacknowledged");
  assertNoCandidate(cancelScope);

  const captureScope = prepareArtifact("capture-candidate");
  pool.launch(launchInput("capture-incomplete-producer", "capture_incomplete_producer", "Complete without capture."));
  assert.equal((await waitTerminal("capture-incomplete-producer")).state, "completed");
  assert.equal(lifecycleRegistry.settlementReceipt(
    "workspace_worker_session_capture-incomplete-producer").state, "completed");
  await assert.rejects(() => adapterFor("capture").run({
    scope: captureScope, revision: 1, producerChildAgentId: "capture-incomplete-producer",
    subscriptionId: "capture-subscription", idempotencyKeyPrefix: "capture",
    projectionAfterSequence: 0, projectionLimit: 20,
  }), (error) => error?.code === "direct_workspace_worker_artifact_capture_incomplete");
  assertNoCandidate(captureScope);

  const blockedScope = prepareArtifact("settlement-candidate");
  blockedSettlementChild = "settlement-blocked-producer";
  pool.launch(launchInput(blockedSettlementChild, "settlement_blocked_producer", "Complete into blocked settlement."));
  assert.equal((await waitTerminal(blockedSettlementChild)).state, "settlement_blocked");
  assert.throws(() => lifecycleRegistry.settlementReceipt(
    "workspace_worker_session_settlement-blocked-producer"),
  (error) => error?.code === "direct_workspace_worker_settlement_receipt_unavailable");
  await assert.rejects(() => adapterFor("settlement").run({
    scope: blockedScope, revision: 1, producerChildAgentId: blockedSettlementChild,
    subscriptionId: "settlement-subscription", idempotencyKeyPrefix: "settlement",
    projectionAfterSequence: 0, projectionLimit: 20,
  }), (error) => error?.code === "direct_workspace_worker_artifact_settlement_blocked");
  assertNoCandidate(blockedScope);

  const forgedReceiptScope = prepareArtifact("forged-receipt-candidate");
  pool.launch(launchInput("forged-receipt-producer", "forged_receipt_producer", "Complete for receipt validation."));
  assert.equal((await waitTerminal("forged-receipt-producer")).state, "completed");
  const forgedReceiptOptions = adapterOptionsFor("forged-receipt");
  forgedReceiptOptions.lifecycleRegistry = {
    settlementReceipt(sessionId) {
      return { ...lifecycleRegistry.settlementReceipt(sessionId), bindingDigest: sha("forged-binding") };
    },
  };
  await assert.rejects(() => createDirectWorkspaceWorkerArtifactAdapter(forgedReceiptOptions).run({
    scope: forgedReceiptScope, revision: 1, producerChildAgentId: "forged-receipt-producer",
    subscriptionId: "forged-receipt-subscription", idempotencyKeyPrefix: "forged-receipt",
    projectionAfterSequence: 0, projectionLimit: 20,
  }), (error) => error?.code === "direct_workspace_worker_artifact_settlement_receipt_digest_mismatch");
  assertNoCandidate(forgedReceiptScope);

  const reuseScope = prepareArtifact("reuse-candidate");
  await assert.rejects(() => adapterFor("reuse").run({
    scope: reuseScope, revision: 1, producerChildAgentId: "live-producer",
    subscriptionId: "reuse-subscription", idempotencyKeyPrefix: "reuse",
    projectionAfterSequence: 0, projectionLimit: 20,
  }), (error) => error?.code === "artifact_audit_evidence_conflict");
  assertNoCandidate(reuseScope);

  assert.equal(store.diagnostics({
    projectId, artifactClassId, policyDigest: policy.policyDigest, principal: principals.manager,
  }).counts.evidence, evidenceBeforeHostile);

  await assert.rejects(() => adapterFor("forgery").run({
    scope: scope("forged"), revision: 1, producerChildAgentId: "live-producer",
    subscriptionId: "forged-subscription", idempotencyKeyPrefix: "forged",
    projectionAfterSequence: 0, projectionLimit: 20, verdict: "admitted",
  }), (error) => error?.code === "direct_workspace_worker_artifact_run_input_invalid");

  lifecycleRegistry.close();
  lifecycleRegistry = new WorkspaceWorkerLifecycleRegistry({ rootDir: lifecycleRoot });
  assert.equal(lifecycleRegistry.settlementReceipt(
    "workspace_worker_session_live-producer").receiptDigest,
  durableProducerReceiptDigest);

  console.log(JSON.stringify({
    ok: true, rebasedProviderLifecycleUsed: true, liveCandidateState: result.terminalState,
    sealedTerminalAndSettlementEvidence: true, deterministicAuditorDispatchCount: 2,
    passiveTransitionCount: result.subscriptionProjection.transitions.length,
    canonicalAdmissionPerformed: false, worktreeCleanupPerformed: false,
    cancellationUnacknowledgedRejected: true, settlementBlockedRejected: true,
    captureIncompleteRejected: true, forgedSettlementReceiptRejected: true,
    terminalLineageReuseRejected: true, hostileCandidateCount: 0,
    settlementReceiptRestartVerified: true,
    providerArtifactAuthorityGranted: false, bottomUpMessagingObserved: false,
  }, null, 2));
} finally {
  try { store?.close(); } catch {}
  try { lifecycleRegistry?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
