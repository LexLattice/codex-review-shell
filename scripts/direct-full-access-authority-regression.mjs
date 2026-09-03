#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DirectThreadHarnessGrant,
  DirectThreadHarnessGrantStore,
  authorizeDirectThreadHarnessCapability,
  capabilityNames,
  validateDirectThreadHarnessGrant,
} = require("../src/main/direct/authority/direct-thread-harness-grant");
const {
  composeDirectToolBundle,
} = require("../src/main/direct/bridge/role-lane-tool-bundle-composer");
const {
  compileDirectSelfConstitutionSnapshot,
  validateDirectSelfConstitutionSnapshot,
} = require("../src/main/direct/bridge/self-constitution");
const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
} = require("../src/main/direct/controller/live-text-controller");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

const projectId = "project_full_access_authority";
const threadId = "thread_full_access_authority";
const workThreadId = "work_thread_full_access_authority";
const executionEnvironment = {
  environmentId: "environment_full_access_authority",
  kind: "local",
  bindingDigest: "sha256:environment-full-access-authority",
};
const capabilities = [
  "apply_patch",
  "get_context_remaining",
  "inspect_agent",
  "inspect_self_constitution",
  "list_agents",
  "read_file",
  "request_user_input",
  "run_command",
  "spawn_agent",
  "tool_search",
  "update_plan",
  "wait_agent",
];

function ref(kind, id) {
  return {
    kind,
    id,
    label: id,
    digest: `sha256:${"a".repeat(64)}`,
    rendererSafe: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-full-access-authority-"));
  try {
    const rendererSource = await fs.readFile(new URL("../src/renderer/codex-surface.js", import.meta.url), "utf8");
    assert.match(rendererSource, /rpc\("thread\/selectAccessProfile",\s*\{\s*sessionId:\s*result\.thread\.(?:id\s*\|\|\s*result\.thread\.threadId|threadId)/s);
    assert.match(rendererSource, /accessProfile:\s*"full_access"/);
    assert.match(rendererSource, /isDirectFullAccessSurface\(\)\)\s*params\.accessProfile\s*=\s*"full_access"/);
    assert.match(rendererSource, /isDirectFullAccessSurface\(\)\s*&&\s*result\?\.taskBinding\?\.current\s*!==\s*true[\s\S]*thread\/selectAccessProfile/);

    const grant = DirectThreadHarnessGrant.issue({
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironment,
      capabilities,
      grantRevision: 4,
      nowMs: Date.UTC(2026, 8, 2, 12, 0, 0),
    });
    assert.deepEqual(validateDirectThreadHarnessGrant(grant, {
      taskId: threadId,
      threadId,
      projectId,
      requireCurrent: true,
    }), []);
    assert.equal(grant.approvalPolicy, "never");
    assert.equal(grant.sandboxMode, "danger-full-access");
    assert.equal(grant.rendererMayMint, false);
    assert.equal(grant.modelMayMint, false);
    assert.equal(grant.promptMayMint, false);
    assert.equal(grant.requestMayReplace, false);
    assert.deepEqual(capabilityNames(grant), [...capabilities].sort());

    const store = new DirectThreadHarnessGrantStore({ rootDir: root });
    store.write(grant);
    const restartedStore = new DirectThreadHarnessGrantStore({ rootDir: root });
    const reconstructed = restartedStore.reconstruct(grant.grantId, {
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
      requireCurrent: true,
    });
    assert.equal(reconstructed.grantDigest, grant.grantDigest);
    assert.equal(authorizeDirectThreadHarnessCapability(reconstructed, "read_file", {
      taskId: threadId,
      threadId,
      projectId,
      runtimeAdmittedCapabilityNames: ["read_file"],
    }).authorized, true);
    assert.equal(authorizeDirectThreadHarnessCapability(reconstructed, "read_file", {
      taskId: "foreign_thread",
      threadId: "foreign_thread",
      projectId,
    }).authorized, false);
    assert.equal(authorizeDirectThreadHarnessCapability(reconstructed, "read_file", {
      taskId: threadId,
      threadId,
      projectId: "foreign_project",
    }).authorized, false);
    assert.equal(authorizeDirectThreadHarnessCapability(reconstructed, "read_file", {
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironmentDigest: "sha256:foreign-environment",
    }).authorized, false);
    assert.equal(store.authorize(grant.grantId, "read_file", {
      taskId: threadId,
      threadId,
      projectId,
      requireCurrent: true,
    }).authorized, true);
    assert(validateDirectThreadHarnessGrant(grant, {
      grantRevision: grant.grantRevision + 1,
    }).includes("grant_revision_stale"));

    assert.throws(() => store.issue({
      ownerAct: { schema: "direct_owner_full_access_act@1" },
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironment,
      capabilities: ["read_file"],
    }), /owner-process owner act|owner act/i);
    assert.notDeepEqual(validateDirectThreadHarnessGrant({
      ...grant,
      projectId: "foreign_project",
    }), []);
    assert.throws(() => DirectThreadHarnessGrant.inherit(grant, {
      taskId: "child_escalated",
      threadId: "child_escalated",
      projectId,
      executionEnvironment,
      capabilities: [...capabilities, "send_message"],
    }), /subset/i);
    const child = DirectThreadHarnessGrant.inherit(grant, {
      taskId: "child_bounded",
      threadId: "child_bounded",
      projectId,
      executionEnvironment,
      capabilities: ["read_file"],
    });
    assert.deepEqual(capabilityNames(child), ["read_file"]);
    assert.equal(child.inheritancePolicy.childMayWiden, false);
    assert.throws(() => DirectThreadHarnessGrant.inherit(grant, {
      taskId: "child_foreign_environment",
      threadId: "child_foreign_environment",
      projectId,
      executionEnvironment: {
        ...executionEnvironment,
        bindingDigest: "sha256:foreign-environment",
      },
      capabilities: ["read_file"],
    }), /environment/i);
    store.revoke(grant.grantId, "fixture_revoked");
    assert.equal(store.authorize(grant.grantId, "read_file", {
      taskId: threadId,
      threadId,
      projectId,
    }).authorized, false);

    const currentGrant = DirectThreadHarnessGrant.issue({
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironment,
      capabilities,
      nowMs: Date.UTC(2026, 8, 2, 12, 0, 1),
    });
    const composition = composeDirectToolBundle({
      projectId,
      workThreadId,
      threadId,
      laneKind: "implementation_worker",
      toolNames: ["read_file"],
      harnessGrant: currentGrant,
      providerProfileRef: ref("provider_profile", "full_access_provider"),
      runtimeFactsRef: ref("runtime_facts", "full_access_runtime"),
      activationSnapshotRefs: [ref("activation_snapshot", "full_access_activation")],
      sourceMessageRef: ref("source_message", "full_access_message"),
      normalizedLaneRequestRef: ref("normalized_lane_request", "full_access_request"),
      observedAt: "2026-09-02T12:00:01.000Z",
    });
    assert.equal(composition.status, "passed");
    assert.deepEqual(composition.providerDeclaredToolBundle.declaredToolNames, [
      "apply_patch",
      "get_context_remaining",
      "inspect_agent",
      "inspect_self_constitution",
      "list_agents",
      "read_file",
      "request_user_input",
      "run_command",
      "spawn_agent",
      "update_plan",
      "wait_agent",
    ]);
    assert(composition.witness.declaredTools.every((row) => row.perCallAuthorityRequired === false));
    assert(composition.witness.declaredTools.every((row) => row.authorityMode === "durable_task_grant"));
    assert.equal(composition.residentCapabilityCatalogue.grantedNow.length, composition.witness.declaredTools.length);
    assert.equal(composition.composerInput.harnessGrant.grantId, currentGrant.grantId);

    const restricted = composeDirectToolBundle({
      projectId,
      workThreadId,
      threadId,
      laneKind: "implementation_worker",
      toolNames: ["read_file"],
      providerProfileRef: ref("provider_profile", "restricted_provider"),
      runtimeFactsRef: ref("runtime_facts", "restricted_runtime"),
      activationSnapshotRefs: [ref("activation_snapshot", "restricted_activation")],
      sourceMessageRef: ref("source_message", "restricted_message"),
      normalizedLaneRequestRef: ref("normalized_lane_request", "restricted_request"),
    });
    assert.equal(restricted.witness.declaredTools[0].perCallAuthorityRequired, true);

    const project = {
      id: projectId,
      workspace: { kind: "local" },
    };
    const snapshot = compileDirectSelfConstitutionSnapshot({
      project,
      session: {
        sessionId: threadId,
        projectId,
        workThreadId,
        model: "gpt-5.6-sol",
      },
      turnId: "turn_full_access",
      status: { status: "ready", evidenceId: "full_access_model" },
      toolComposition: composition,
      harnessGrant: currentGrant,
      observedAt: "2026-09-02T12:00:01.000Z",
    });
    assert.deepEqual(validateDirectSelfConstitutionSnapshot(snapshot), []);
    assert.deepEqual(snapshot.capabilities.grantedThisTurn, [...capabilities].sort());
    assert.equal(snapshot.capabilities.rows.find((row) => row.toolName === "read_file")?.authority.state, "authorized");
    assert.equal(snapshot.capabilities.rows.find((row) => row.toolName === "read_file")?.authority.requirement, "durable_task_grant");
    assert.equal(snapshot.capabilities.rows.find((row) => row.toolName === "read_file")?.callableState, "callable");

    const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
    const session = sessionStore.createSession({
      sessionId: threadId,
      projectId,
      model: "gpt-5.6-sol",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const selectionSession = sessionStore.createSession({
      sessionId: "selection_profile_thread",
      projectId,
      model: "gpt-5.6-sol",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "turn_auto_read",
      input: [{ role: "user", text: "Read the fixture." }],
      model: session.model,
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["read_file"],
        directThreadHarnessGrantId: currentGrant.grantId,
        directThreadHarnessGrantRevision: currentGrant.grantRevision,
      },
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
      responseId: "response_auto_read",
    });
    const obligation = sessionStore.addToolObligations(session.sessionId, turn.turnId, [{
      type: "tool_call_completed",
      itemId: "item_auto_read",
      callId: "call_auto_read",
      name: "read_file",
      toolType: "function_call",
      argumentsJson: JSON.stringify({ path: "fixture.txt" }),
      responseId: "response_auto_read",
    }], {
      parentResponseId: "response_auto_read",
      parentResponseSource: "native_direct_initial_stream",
      stepOrdinal: 1,
    }).obligations[0];
    const controller = new DirectLiveTextController({
      sessionStore,
      harnessGrantResolver: () => currentGrant,
    });
    assert.equal(controller.resolveHarnessGrant({ id: projectId }, {
      sessionId: threadId,
      projectId,
      harnessGrantId: "request_forged_grant",
    }), null);
    const selectionController = new DirectLiveTextController({
      sessionStore,
      harnessGrantStore: new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "selected-profile") }),
    });
    selectionController.statusForProject = () => ({
      status: "ready",
      model: "gpt-5.6-sol",
      readOnlyToolContinuation: { status: "ready" },
      patchApplyContinuation: { status: "ready" },
      commandExecutionContinuation: { status: "ready" },
    });
    const selectedProfile = selectionController.selectFullAccessTaskProfile({
      sessionId: selectionSession.sessionId,
      accessProfile: "full_access",
    }, { project: { id: projectId, workspace: { kind: "local" } } });
    assert.equal(selectedProfile.profile, "full_access");
    assert.equal(selectedProfile.rawGrantIncluded, false);

    const projectionSession = sessionStore.createSession({
      sessionId: "projection_thread",
      projectId,
      workspace: { kind: "local" },
      model: "gpt-5.6-sol",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });

    const reissueRoot = path.join(root, "reissue");
    const reissueStore = new DirectThreadHarnessGrantStore({ rootDir: reissueRoot });
    const reissueInput = {
      taskId: "reissue_thread",
      threadId: "reissue_thread",
      projectId,
      executionEnvironment,
      capabilities: ["read_file"],
    };
    const firstReissueGrant = reissueStore.issueFullAccess({ ...reissueInput, nowMs: 1_000 });
    const secondReissueGrant = reissueStore.issueFullAccess({ ...reissueInput, nowMs: 2_000 });
    assert.equal(secondReissueGrant.grantRevision, firstReissueGrant.grantRevision + 1);
    assert.equal(secondReissueGrant.currentness.supersedesGrantId, firstReissueGrant.grantId);
    assert.equal(reissueStore.read(firstReissueGrant.grantId).currentness.state, "superseded");
    assert.equal(reissueStore.currentForScope({
      ...reissueInput,
      executionEnvironmentDigest: secondReissueGrant.executionEnvironmentDigest,
    }).grantId, secondReissueGrant.grantId);
    assert.equal(reissueStore.authorize(firstReissueGrant.grantId, "read_file", reissueInput).authorized, false);
    assert.equal(reissueStore.authorize(firstReissueGrant.grantId, "read_file", reissueInput).reason, "direct_thread_harness_grant_superseded");
    assert.equal(reissueStore.authorize(secondReissueGrant.grantId, "read_file", reissueInput).authorized, true);
    const restartedReissueStore = new DirectThreadHarnessGrantStore({ rootDir: reissueRoot });
    assert.equal(restartedReissueStore.currentForScope({
      ...reissueInput,
      executionEnvironmentDigest: secondReissueGrant.executionEnvironmentDigest,
    }).grantId, secondReissueGrant.grantId);
    assert.equal(restartedReissueStore.authorize(firstReissueGrant.grantId, "read_file", reissueInput).authorized, false);

    class HeadCommitOnlyStore extends DirectThreadHarnessGrantStore {
      write(grant, options = {}) {
        if (options.head === false) throw new Error("simulated stale-marker interruption");
        return super.write(grant, options);
      }
    }
    const crashRoot = path.join(root, "crash-safe-reissue");
    const crashStore = new HeadCommitOnlyStore({ rootDir: crashRoot });
    const crashScopeInput = { ...reissueInput, taskId: "crash_safe_thread", threadId: "crash_safe_thread" };
    const crashFirst = crashStore.issueFullAccess({ ...crashScopeInput, nowMs: 3_000 });
    assert.throws(() => crashStore.issueFullAccess({ ...crashScopeInput, nowMs: 4_000 }), /stale-marker interruption/);
    const crashIndex = JSON.parse(await fs.readFile(path.join(crashRoot, "authority", "index.json"), "utf8"));
    const crashHeadId = crashIndex.heads[crashFirst.scopeDigest].grantId;
    assert.notEqual(crashHeadId, crashFirst.grantId);
    assert.equal(crashStore.authorize(crashFirst.grantId, "read_file", crashScopeInput).authorized, false);
    assert.equal(crashStore.authorize(crashHeadId, "read_file", crashScopeInput).authorized, true);

    const surface = new DirectLiveTextSurfaceSession(
      { send: () => {}, isDestroyed: () => false },
      { controller: selectionController, project: { id: projectId, workspace: { kind: "local" } } },
    );
    const restrictedConnection = await surface.connect();
    assert.equal(restrictedConnection.connection.capabilities.authority.fullAccessTaskProfile, false);
    assert.equal(restrictedConnection.connection.taskBinding, null);
    const restrictedInit = await surface.request("initialize", { sessionId: projectionSession.sessionId });
    assert.equal(restrictedInit.capabilities.authority.fullAccessTaskProfile, false);
    assert.equal(restrictedInit.taskBinding.current, false);
    const selectedSurface = await surface.request("thread/selectAccessProfile", {
      sessionId: projectionSession.sessionId,
      accessProfile: "full_access",
    });
    assert.equal(selectedSurface.capabilities.authority.fullAccessTaskProfile, true);
    assert.equal(selectedSurface.capabilities.taskBinding.taskId, projectionSession.sessionId);
    assert.equal(selectedSurface.taskBinding.current, true);
    assert.equal(selectedSurface.taskBinding.grantRevision, 1);
    assert.notEqual(selectedSurface.taskBinding.grantId, selectedProfile.grantId);
    assert.equal(Object.prototype.hasOwnProperty.call(selectedSurface, "harnessGrant"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(surface.connection, "harnessGrant"), false);
    const restrictedNeighbor = sessionStore.createSession({
      sessionId: "restricted_neighbor_thread",
      projectId,
      workspace: { kind: "local" },
      model: "gpt-5.6-sol",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const restrictedRead = await surface.request("thread/read", { sessionId: restrictedNeighbor.sessionId });
    assert.equal(restrictedRead.capabilities.authority.fullAccessTaskProfile, false);
    assert.equal(surface.connection.taskBinding.taskId, restrictedNeighbor.sessionId);
    assert.equal(surface.connection.taskBinding.grantId, "");
    assert.equal(selectionController.capabilitiesForTask({ id: "foreign_project", workspace: { kind: "local" } }, selectionSession.sessionId).capabilities.authority.fullAccessTaskProfile, false);
    controller.statusForProject = () => ({
      readOnlyToolContinuation: { status: "ready" },
    });
    let approvalContinuation = null;
    controller.approveExecuteAndContinueReadOnlyTool = async (options) => {
      approvalContinuation = options;
    };
    let approvalCards = 0;
    await controller.emitToolApprovalRequests({
      createReadOnlyToolRequest: () => { approvalCards += 1; },
    }, session.sessionId, turn.turnId, [obligation], { id: projectId });
    assert.equal(approvalCards, 0);
    assert.equal(approvalContinuation?.approvedBy, "direct-thread-harness-grant");
    assert.equal(approvalContinuation?.obligationId, obligation.obligationId);
    const autoObligation = sessionStore.findToolObligation(session.sessionId, turn.turnId, obligation.obligationId).obligation;
    assert.equal(autoObligation.authorityMode, "durable_task_grant");
    assert.equal(autoObligation.harnessGrantId, currentGrant.grantId);

    console.log(JSON.stringify({
      schema: "direct_full_access_authority_regression_report@1",
      status: "passed",
      grantId: currentGrant.grantId,
      declaredToolCount: composition.witness.declaredTools.length,
      autoApprovalCards: approvalCards,
      childGrantId: child.grantId,
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await main();
