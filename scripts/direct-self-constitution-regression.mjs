#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSelfConstitutionResultEnvelope,
  compileDirectSelfConstitutionSnapshot,
  renderDirectSelfConstitutionInstructions,
  validateDirectSelfConstitutionSnapshot,
} = require("../src/main/direct/bridge/self-constitution");
const {
  composeDirectToolBundle,
} = require("../src/main/direct/bridge/role-lane-tool-bundle-composer");
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");

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

const observedAt = "2026-08-23T09:00:00.000Z";
const project = {
  id: "project_self_constitution",
  workspace: {
    kind: "wsl",
    linuxPath: "/home/fixture/private-project-path",
  },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
    },
  },
};

const composition = composeDirectToolBundle({
  projectId: project.id,
  workThreadId: "work_thread_self_constitution",
  threadId: "direct_session_self_constitution",
  laneKind: "implementation_worker",
  toolNames: ["read_file", "apply_patch", "inspect_self_constitution"],
  useLaneDefaultTools: false,
  providerProfileRef: ref("provider_profile", "provider_profile_fixture"),
  runtimeFactsRef: ref("runtime_facts", "runtime_facts_fixture"),
  activationSnapshotRefs: [ref("activation_snapshot", "activation_fixture")],
  sourceMessageRef: ref("source_message", "source_message_fixture"),
  normalizedLaneRequestRef: ref("normalized_lane_request", "normalized_request_fixture"),
  observedAt,
});

assert.equal(composition.status, "passed");
assert(composition.providerDeclaredToolBundle.declaredToolNames.includes("inspect_self_constitution"));
const inspectDeclaration = composition.providerDeclaredToolBundle.toolDeclarations
  .find((row) => row.name === "inspect_self_constitution");
assert(inspectDeclaration, "inspect_self_constitution should have a provider declaration");
assert.equal(inspectDeclaration.parameters.additionalProperties, false);

const poolDescriptor = {
  maxActiveChildren: 8,
  maxQueuedChildren: 64,
  activeChildren: 2,
  queuedChildren: 1,
  acceptingNewChildren: true,
  capacityScope: "direct_runtime_process_shared_across_agent_tree",
  contextHandoffIndependentOfModel: true,
  contextHandoffIndependentOfReasoningEffort: true,
  providerProfiles: [
    {
      providerId: "chatgpt-direct",
      status: "ready",
      model: "gpt-5.6-sol",
      transport: "chatgpt_subscription_responses_sse",
      credentials: "must-not-project",
      rawSecretIncluded: false,
    },
    {
      providerId: "opencode-oxalpha",
      status: "blocked",
      blockerCode: "direct_opencode_executable_missing",
      model: "opencode/x-preview-f-free",
      transport: "opencode_cli",
      rawSecretIncluded: false,
    },
  ],
};

const session = {
  sessionId: "direct_session_self_constitution",
  projectId: project.id,
  workspace: project.workspace,
  workThreadId: "work_thread_self_constitution",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
};
const snapshot = compileDirectSelfConstitutionSnapshot({
  project,
  session,
  turnId: "turn_self_constitution",
  status: { status: "ready", evidenceId: "model_evidence_fixture" },
  toolComposition: composition,
  subAgentPoolDescriptor: poolDescriptor,
  observedAt,
});

assert.deepEqual(validateDirectSelfConstitutionSnapshot(snapshot), []);
assert.equal(snapshot.projectBinding.substrateKind, "wsl");
assert.equal(snapshot.projectBinding.bindingKind, "persistent_project_checkout");
assert.equal(snapshot.projectBinding.persistence, "persistent_across_turns_and_app_restarts");
assert(snapshot.capabilities.potentialToolNames.length > snapshot.capabilities.declaredThisTurn.length);
assert.deepEqual(
  snapshot.capabilities.declaredThisTurn,
  ["apply_patch", "inspect_self_constitution", "read_file"],
);
assert.equal(
  snapshot.capabilities.rows.find((row) => row.toolName === "apply_patch")?.authority.state,
  "not_requested",
);
assert.equal(
  snapshot.capabilities.rows.find((row) => row.toolName === "apply_patch")?.enactment.state,
  "unrequested",
);
assert.equal(snapshot.delegationCapacity.maxActiveChildren, 8);
assert.equal(snapshot.providerReadiness.childProviders[1].status, "blocked");
assert.equal("credentials" in snapshot.providerReadiness.childProviders[0], false);
assert.equal(JSON.stringify(snapshot).includes("/home/fixture/private-project-path"), false);
assert.equal(JSON.stringify(snapshot).includes("must-not-project"), false);

const instructions = renderDirectSelfConstitutionInstructions(snapshot);
assert(instructions.includes("persistent_project_checkout"));
assert(instructions.includes("inspect_self_constitution"));
assert.equal(instructions.includes("disposable workspace"), false);

const isolated = compileDirectSelfConstitutionSnapshot({
  project,
  session: {
    ...session,
    workspaceMode: "isolated_worktree",
  },
  turnId: "turn_isolated",
  declaredToolNames: ["read_file"],
  potentialToolNames: ["read_file", "apply_patch"],
  status: { status: "ready" },
  observedAt,
});
assert.equal(isolated.projectBinding.bindingKind, "isolated_worktree");
assert.equal(isolated.projectBinding.isolation, "child_specific_git_worktree");
assert.notEqual(isolated.digest, snapshot.digest);

const executedSnapshot = compileDirectSelfConstitutionSnapshot({
  project,
  session,
  turnId: "turn_self_constitution",
  declaredToolNames: snapshot.capabilities.declaredThisTurn,
  potentialToolNames: snapshot.capabilities.potentialToolNames,
  status: { status: "ready" },
  subAgentPoolDescriptor: poolDescriptor,
  supersedesDigest: snapshot.digest,
  enactmentUpdates: {
    inspect_self_constitution: {
      state: "executed",
      evidenceRef: "obligation_self_inspect",
    },
  },
  observedAt: "2026-08-23T09:00:01.000Z",
});
const envelope = buildSelfConstitutionResultEnvelope(executedSnapshot, {
  callId: "call_self_inspect",
});
assert.equal(envelope.resultKind, "self_constitution_snapshot");
assert.equal(envelope.sideEffectExecuted, false);
assert.equal(envelope.providerOutput.snapshot.currentness.supersedesDigest, snapshot.digest);
assert.equal(
  envelope.providerOutput.snapshot.capabilities.rows
    .find((row) => row.toolName === "inspect_self_constitution")?.enactment.state,
  "executed",
);

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-self-constitution-"));
try {
  const store = new DirectSessionStore({ rootDir });
  store.createSession({
    ...session,
    title: "Self constitution fixture",
  });
  store.createTurn(session.sessionId, {
    turnId: "turn_runtime_self_constitution",
    state: "tool_waiting",
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    input: [{ role: "user", text: "What environment are you in?" }],
    requestShape: {
      declaredToolNames: snapshot.capabilities.declaredThisTurn,
    },
  });
  store.updateTurnState(session.sessionId, "turn_runtime_self_constitution", "tool_waiting", {
    selfConstitutionSnapshot: snapshot,
    unresolvedObligations: [{
      obligationId: "obligation_prior_patch",
      callId: "call_prior_patch",
      name: "apply_patch",
      status: "continuation_sent",
      authorityState: "continuation_sent",
      sideEffectExecuted: true,
      result: {
        resultId: "result_prior_patch",
        sideEffectExecuted: true,
      },
    }],
  });
  const providerRequests = [];
  const controller = new DirectLiveTextController({
    sessionStore: store,
    profileDoc: {
      profile: {
        ontology: {
          models: [{ id: "gpt-5.6-sol", status: "accepted" }],
        },
      },
    },
    authStore: {
      readStatus: () => ({
        status: "authenticated",
        hasAccessToken: true,
        hasRefreshToken: false,
      }),
      readCredentials: () => ({ accessToken: "fixture-token" }),
    },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    fetchImpl: async (_url, init) => {
      providerRequests.push(JSON.parse(init.body));
      if (providerRequests.length === 2) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          text: async () => [
            "event: response.created",
            'data: {"response":{"id":"resp_self_inspect_call","model":"gpt-5.6-sol"}}',
            "",
            "event: response.output_item.added",
            'data: {"item":{"id":"item_self_inspect","type":"function_call","call_id":"call_self_inspect_live","name":"inspect_self_constitution"}}',
            "",
            "event: response.function_call_arguments.delta",
            'data: {"item_id":"item_self_inspect","call_id":"call_self_inspect_live","delta":"{}"}',
            "",
            "event: response.output_item.done",
            'data: {"item":{"id":"item_self_inspect","type":"function_call","call_id":"call_self_inspect_live","name":"inspect_self_constitution","arguments":"{}"}}',
            "",
            "event: response.completed",
            'data: {"response":{"id":"resp_self_inspect_call","status":"completed"}}',
            "",
          ].join("\n"),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        text: async () => [
          "event: response.created",
          `data: {"response":{"id":"resp_self_constitution_${providerRequests.length}","model":"gpt-5.6-sol"}}`,
          "",
          "event: response.output_text.delta",
          'data: {"item_id":"message_self_constitution","delta":"Constitution received."}',
          "",
          "event: response.completed",
          'data: {"response":{"id":"resp_self_constitution","status":"completed"}}',
          "",
        ].join("\n"),
      };
    },
    activationStatusResolver: () => ({ state: "enabled" }),
    subAgentPool: {
      launch: () => ({ status: "blocked" }),
      descriptor: () => poolDescriptor,
    },
  });
  const runtimeEnvelope = controller.buildSafeResidentUtilityEnvelope({
    name: "inspect_self_constitution",
    callId: "call_runtime_self_constitution",
    obligationId: "obligation_runtime_self_constitution",
  }, {
    project,
    sessionId: session.sessionId,
    turnId: "turn_runtime_self_constitution",
  });
  assert.equal(runtimeEnvelope.resultKind, "self_constitution_snapshot");
  assert.equal(runtimeEnvelope.providerOutput.snapshot.projectBinding.bindingKind, "persistent_project_checkout");
  assert.equal(runtimeEnvelope.providerOutput.snapshot.currentness.supersedesDigest, snapshot.digest);
  assert.equal(runtimeEnvelope.providerOutput.snapshot.safety.grantsAuthority, false);
  const priorPatchState = runtimeEnvelope.providerOutput.snapshot.capabilities.rows
    .find((row) => row.toolName === "apply_patch");
  assert.equal(priorPatchState.authority.state, "authorized");
  assert.equal(priorPatchState.enactment.state, "executed");
  assert.equal(priorPatchState.enactment.evidenceRef, "result_prior_patch");

  const liveSession = store.createSession({
    sessionId: "direct_session_live_self_constitution",
    projectId: project.id,
    workspace: project.workspace,
    workspaceDisplayPath: project.workspace.linuxPath,
    title: "Live self constitution fixture",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    nativeDirectSession: true,
  });
  const start = await controller.startTurn({
    sessionId: liveSession.sessionId,
    clientTurnRequestId: "client_turn_self_constitution",
    promptText: "Describe your current runtime constitution.",
  }, {
    project,
    surfaceSession: { sendEvent: () => {} },
  });
  await controller.activeRuns.get(start.turn.id).promise;
  assert.equal(providerRequests.length, 1);
  const providerRequest = providerRequests[0];
  assert(providerRequest.instructions.includes("Authoritative Direct self constitution"));
  assert(providerRequest.instructions.includes("persistent_project_checkout"));
  assert.equal(providerRequest.instructions.includes("disposable workspace"), false);
  assert(providerRequest.tools.some((tool) => tool.name === "inspect_self_constitution"));
  const persistedLiveTurn = store.readTurn(liveSession.sessionId, start.turn.id);
  assert.equal(persistedLiveTurn.state, "completed");
  assert.equal(
    persistedLiveTurn.selfConstitutionSnapshot.digest,
    persistedLiveTurn.requestShape.selfConstitutionSnapshotDigest,
  );
  assert(providerRequest.instructions.includes(persistedLiveTurn.selfConstitutionSnapshot.digest));
  assert.equal(persistedLiveTurn.requestShape.selfConstitutionRawWorkspacePathIncluded, false);
  assert.equal(persistedLiveTurn.requestShape.selfConstitutionRawSecretIncluded, false);

  const inspectSession = store.createSession({
    sessionId: "direct_session_live_self_inspect",
    projectId: project.id,
    workspace: project.workspace,
    workspaceDisplayPath: project.workspace.linuxPath,
    title: "Live self inspection fixture",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    nativeDirectSession: true,
  });
  const inspectStart = await controller.startTurn({
    sessionId: inspectSession.sessionId,
    clientTurnRequestId: "client_turn_live_self_inspect",
    promptText: "Inspect your current constitution and report it.",
  }, {
    project,
    surfaceSession: { sendEvent: () => {} },
  });
  await controller.activeRuns.get(inspectStart.turn.id).promise;
  assert.equal(providerRequests.length, 3);
  assert(providerRequests[2].instructions.includes("owner-issued inspect_self_constitution result"));
  const continuationOutput = providerRequests[2].input?.[0]?.content?.[0]?.text || "";
  assert(continuationOutput, "self-inspection should continue with typed quoted evidence");
  assert(continuationOutput.includes("direct_self_constitution_snapshot@1"));
  assert(continuationOutput.includes("persistent_project_checkout"));
  const persistedInspectTurn = store.readTurn(inspectSession.sessionId, inspectStart.turn.id);
  assert.equal(persistedInspectTurn.state, "completed");
  assert.equal(persistedInspectTurn.unresolvedObligations[0].result.resultKind, "self_constitution_snapshot");
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log("direct self constitution regression: ok");
