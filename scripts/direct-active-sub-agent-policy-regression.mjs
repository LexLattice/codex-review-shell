#!/usr/bin/env node

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  POLICY_NO_CHANGE_TOOL,
  POLICY_UPDATE_TOOL,
  DirectActiveSubAgentPolicyService,
} = require("../src/main/direct/agents/active-sub-agent-policy");
const {
  DirectNativeAgentPool,
} = require("../src/main/direct/agents/native-agent-pool");
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  compileDirectSelfConstitutionSnapshot,
  renderDirectSelfConstitutionInstructions,
} = require("../src/main/direct/bridge/self-constitution");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-active-sub-agent-policy-"),
);
const nowMs = Date.parse("2026-08-23T10:00:00.000Z");
const semanticRequests = [];
const rawPolicyStatement =
  "From now on use Sol high implementation workers with no conversation handoff.";

const service = new DirectActiveSubAgentPolicyService({
  rootDir,
  now: () => nowMs,
  semanticRunner: async (request) => {
    semanticRequests.push(request);
    if (request.userText === rawPolicyStatement) {
      return {
        actionCalls: [{
          name: POLICY_UPDATE_TOOL,
          argumentsJson: JSON.stringify({
            scope_kind: "thread",
            role_bindings: [{
              role_id: "implementation_worker",
              provider_id: "chatgpt-direct",
              model: "gpt-5.6-sol",
              reasoning_effort: "high",
              fork_turns: "none",
              workspace_mode: "reasoning_only",
            }],
            summary: "Implementation-worker realization policy updated.",
            rationale: "The operator established standing future behavior.",
          }),
        }],
        telemetry: {
          model: "gpt-5.6-spark",
          reasoningEffort: "high",
        },
      };
    }
    if (request.userText === "Project-wide transcriber policy") {
      return {
        actionCalls: [{
          name: POLICY_UPDATE_TOOL,
          argumentsJson: JSON.stringify({
            scope_kind: "thread",
            role_bindings: [{
              role_id: "thread_transcriber",
              provider_id: "chatgpt-direct",
              model: "gpt-5.6-luna",
              reasoning_effort: "max",
              fork_turns: "none",
              workspace_mode: "reasoning_only",
            }],
            max_active_children: 2,
            summary: "Transcriber realization policy updated.",
            rationale: "The project policy editor fixed project scope.",
          }),
        }],
        telemetry: {
          model: "gpt-5.6-spark",
          reasoningEffort: "high",
        },
      };
    }
    if (request.userText === "Return implementation model and effort to inheritance") {
      return {
        actionCalls: [{
          name: POLICY_UPDATE_TOOL,
          argumentsJson: JSON.stringify({
            scope_kind: "thread",
            role_bindings: [{
              role_id: "implementation_worker",
              clear_dimensions: ["model", "reasoning_effort"],
            }],
            max_active_children: 0,
            summary: "Implementation realization constraints cleared.",
            rationale: "The operator returned these dimensions to inheritance.",
          }),
        }],
        telemetry: {
          model: "gpt-5.6-spark",
          reasoningEffort: "high",
        },
      };
    }
    return {
      actionCalls: [{
        name: POLICY_NO_CHANGE_TOOL,
        argumentsJson: JSON.stringify({
          rationale: "This utterance is ordinary task content.",
        }),
      }],
      telemetry: {
        model: "gpt-5.6-spark",
        reasoningEffort: "high",
      },
    };
  },
});

const projectId = "project_policy_fixture";
const threadId = "direct_session_policy_fixture";

const initial = service.projection({ projectId, threadId });
assert.equal(initial.state, "unsettled");
assert.equal(initial.spawnPosture, "block_and_request_policy_settlement");

const unsettledDecision = service.resolveSpawn({
  projectId,
  threadId,
  args: {
    task_name: "before_settlement",
    message: "Do bounded work.",
    agent_type: "implementation_worker",
  },
  parentModel: "gpt-5.6-terra",
  parentReasoningEffort: "low",
});
assert.equal(unsettledDecision.launchEligible, false);
assert.equal(
  unsettledDecision.blockerCode,
  "direct_active_sub_agent_policy_unsettled",
);

const noChange = await service.semanticPreflight({
  projectId,
  threadId,
  clientRequestId: "client_policy_no_change",
  userText: "Please inspect the current implementation.",
});
assert.equal(noChange.settlement.state, "no_change");
assert.equal(service.projection({ projectId, threadId }).state, "unsettled");

const admitted = await service.semanticPreflight({
  projectId,
  threadId,
  clientRequestId: "client_policy_admit",
  userText: rawPolicyStatement,
});
assert.equal(admitted.settlement.state, "policy_admitted");
assert.equal(admitted.projection.state, "active");
assert.equal(admitted.projection.resolutionSource, "thread_policy");
assert.equal(admitted.admittedPolicy.revision, 1);
assert.equal(
  semanticRequests.at(-1).runtimeRoleClass,
  "constitutional_meta_role",
);
assert.equal(
  semanticRequests.at(-1).metaRoleRealizationPolicy.primaryCandidates[0].model,
  "gpt-5.3-codex-spark",
);
assert.equal(semanticRequests.at(-1).grantsAuthority, false);

const selfSnapshot = compileDirectSelfConstitutionSnapshot({
  project: {
    id: projectId,
    workspace: { kind: "wsl" },
  },
  session: {
    sessionId: threadId,
    projectId,
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
  },
  turnId: "turn_policy_snapshot",
  activeSubAgentPolicy: admitted.projection,
});
assert.equal(selfSnapshot.activeSubAgentPolicy.state, "active");
assert.equal(
  selfSnapshot.activeSubAgentPolicy.activePolicyRef.digest,
  admitted.admittedPolicy.digest,
);
assert.match(
  renderDirectSelfConstitutionInstructions(selfSnapshot),
  /Normally request a child by role and task and omit governed realization knobs/,
);

const inheritedDecision = service.resolveSpawn({
  projectId,
  threadId,
  args: {
    task_name: "policy_inheritance",
    message: "Perform the bounded implementation task.",
    agent_type: "implementation_worker",
  },
  parentModel: "gpt-5.6-terra",
  parentReasoningEffort: "low",
});
assert.equal(inheritedDecision.launchEligible, true);
assert.equal(inheritedDecision.effectiveSpawn.model, "gpt-5.6-sol");
assert.equal(inheritedDecision.effectiveSpawn.reasoningEffort, "high");
assert.equal(inheritedDecision.effectiveSpawn.forkTurns, "none");
assert.equal(inheritedDecision.effectiveSpawn.workspaceMode, "reasoning_only");
assert(inheritedDecision.inheritedFields.includes("model"));
assert(inheritedDecision.inheritedFields.includes("reasoningEffort"));

const blockedDeviation = service.resolveSpawn({
  projectId,
  threadId,
  args: {
    task_name: "silent_deviation",
    message: "Attempt a silent mismatch.",
    agent_type: "implementation_worker",
    model: "gpt-5.6-terra",
  },
  parentModel: "gpt-5.6-sol",
  parentReasoningEffort: "high",
});
assert.equal(blockedDeviation.launchEligible, false);
assert.equal(
  blockedDeviation.blockerCode,
  "direct_active_sub_agent_policy_deviation_reason_required",
);

const updateRequestDecision = service.resolveSpawn({
  projectId,
  threadId,
  args: {
    task_name: "candidate_policy_revision",
    message: "Propose a permanent realization change.",
    agent_type: "implementation_worker",
    model: "gpt-5.6-terra",
    policy_exception_reason:
      "The implementation frontier now requires the alternate model as a standing rule.",
    policy_disposition: "propose_policy_update",
  },
  parentModel: "gpt-5.6-sol",
  parentReasoningEffort: "high",
});
assert.equal(updateRequestDecision.launchEligible, false);
assert.equal(updateRequestDecision.policyUpdateRequested, true);
assert.equal(
  updateRequestDecision.blockerCode,
  "direct_active_sub_agent_policy_update_requires_admission",
);
const updateRequest = service.projection({
  projectId,
  threadId,
}).recentUpdateRequests[0];
assert.equal(updateRequest.state, "candidate_only");
assert.equal(updateRequest.launchAuthorityGranted, false);
assert.equal(updateRequest.policyRevisionChanged, false);

const exceptionDecision = service.resolveSpawn({
  projectId,
  threadId,
  args: {
    task_name: "reasoned_exception",
    message: "Use a one-time alternate model.",
    agent_type: "implementation_worker",
    model: "gpt-5.6-terra",
    policy_exception_reason:
      "This bounded comparison requires a deliberate second model witness.",
    policy_disposition: "one_time_exception",
  },
  parentModel: "gpt-5.6-sol",
  parentReasoningEffort: "high",
});
assert.equal(exceptionDecision.launchEligible, true);
assert.equal(exceptionDecision.exceptionDisposition, "one_time_exception");
assert.equal(
  service.projection({ projectId, threadId }).recentExceptions.length,
  1,
);

const providerCalls = [];
const pool = new DirectNativeAgentPool({
  maxActiveChildren: 4,
  providerTurnRunner: async (request) => {
    providerCalls.push(request);
    return {
      ok: true,
      terminalState: "completed",
      outputText: "policy-backed child complete",
    };
  },
});
const launch = pool.launch({
  projectId,
  primaryThreadId: threadId,
  workThreadId: "work_thread_policy_fixture",
  taskName: "policy_inheritance",
  message: "Perform the bounded implementation task.",
  agentType: "implementation_worker",
  parentModel: "gpt-5.6-terra",
  parentReasoningEffort: "low",
  parentContextMessages: [{
    turnId: "turn_parent",
    role: "user",
    text: "This context must not be inherited.",
  }],
  activeSubAgentPolicyDecision: inheritedDecision,
  requireActiveSubAgentPolicy: true,
});
assert.equal(launch.status, "running");
assert.equal(launch.model, "gpt-5.6-sol");
assert.equal(launch.reasoningEffort, "high");
assert.equal(launch.contextHandoff.forkTurns, "none");
assert.equal(launch.contextMessageCount, 0);
assert.equal(
  launch.activeSubAgentPolicyRef.digest,
  admitted.admittedPolicy.digest,
);
await pool.wait({
  projectId,
  primaryThreadId: threadId,
  targets: [launch.childAgentId],
  timeoutMs: 2_000,
});
assert.equal(providerCalls[0].requestBody.model, "gpt-5.6-sol");
assert.equal(providerCalls[0].requestBody.reasoning.effort, "high");

const sessionStore = new DirectSessionStore({
  rootDir: path.join(rootDir, "controller-sessions"),
});
sessionStore.createSession({
  sessionId: threadId,
  projectId,
  title: "Policy controller fixture",
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
});
sessionStore.createTurn(threadId, {
  turnId: "turn_policy_controller",
  state: "tool_waiting",
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
  input: [{ role: "user", text: "Delegate through active policy." }],
});
const controller = new DirectLiveTextController({
  sessionStore,
  subAgentPool: pool,
  activeSubAgentPolicyResolver: (input) =>
    service.resolveSpawn(input),
});
const controllerEnvelope =
  await controller.buildNativeSubAgentRuntimeEnvelope(
    threadId,
    "turn_policy_controller",
    {
      obligationId: "obligation_policy_controller",
      callId: "call_policy_controller",
      name: "spawn_agent",
      argumentsText: JSON.stringify({
        task_name: "controller_policy_inheritance",
        message: "Exercise policy inheritance through the controller.",
        agent_type: "implementation_worker",
      }),
    },
    {
      id: projectId,
      workThreadId: "work_thread_policy_fixture",
      surfaceBinding: {
        codex: {
          runtimeMode: "direct-experimental",
          directTransport: "live-text",
          directTier: "implementation-lane",
        },
      },
    },
  );
assert.equal(
  controllerEnvelope.providerOutput.status,
  "running",
  JSON.stringify(controllerEnvelope.providerOutput),
);
assert.equal(controllerEnvelope.providerOutput.model, "gpt-5.6-sol");
assert.equal(controllerEnvelope.providerOutput.reasoningEffort, "high");
assert.equal(
  controllerEnvelope.providerOutput.activeSubAgentPolicyRef.digest,
  admitted.admittedPolicy.digest,
);
assert.equal(
  controllerEnvelope.providerOutput.activeSubAgentPolicyDecisionRef.kind,
  "active_sub_agent_spawn_decision",
);
await pool.wait({
  projectId,
  primaryThreadId: threadId,
  targets: ["controller_policy_inheritance"],
  timeoutMs: 2_000,
});

const untrustedLaunch = pool.launch({
  projectId,
  primaryThreadId: threadId,
  taskName: "forged_policy_decision",
  message: "This must remain blocked.",
  activeSubAgentPolicyDecision: JSON.parse(
    JSON.stringify(inheritedDecision),
  ),
  requireActiveSubAgentPolicy: true,
});
assert.equal(untrustedLaunch.status, "blocked");
assert.equal(
  untrustedLaunch.blockerCode,
  "direct_active_sub_agent_policy_decision_untrusted",
);

const projectAdmission = await service.semanticPreflight({
  projectId,
  threadId,
  clientRequestId: "client_project_policy_admit",
  userText: "Project-wide transcriber policy",
  scopeBinding: "project",
});
assert.equal(
  projectAdmission.admittedPolicy.scope.scopeKind,
  "project",
  "the bound UI region must override an inconsistent semantic scope field",
);
const secondThread = service.projection({
  projectId,
  threadId: "direct_session_policy_second",
});
assert.equal(secondThread.state, "active");
assert.equal(secondThread.resolutionSource, "project_policy");
assert.equal(
  secondThread.activePolicy.roleBindings.find(
    (binding) => binding.roleId === "thread_transcriber",
  ).model,
  "gpt-5.6-luna",
);
const projectCapacityDecision = service.resolveSpawn({
  projectId,
  threadId: "direct_session_policy_second",
  args: {
    task_name: "project_capacity",
    message: "Respect the project-wide child limit.",
    agent_type: "thread_transcriber",
  },
  activeChildren: 0,
  projectActiveChildren: 2,
  parentModel: "gpt-5.6-sol",
  parentReasoningEffort: "high",
});
assert.equal(projectCapacityDecision.launchEligible, false);
assert.equal(
  projectCapacityDecision.blockerCode,
  "direct_active_sub_agent_policy_capacity_reached",
  "project policy concurrency must count all active project children, not only the current task",
);

const cleared = await service.semanticPreflight({
  projectId,
  threadId,
  clientRequestId: "client_policy_clear_dimensions",
  userText: "Return implementation model and effort to inheritance",
});
const clearedBinding = cleared.admittedPolicy.roleBindings.find(
  (binding) => binding.roleId === "implementation_worker",
);
assert.equal(clearedBinding.model, "");
assert.equal(clearedBinding.reasoningEffort, "");
assert.equal(cleared.admittedPolicy.maxActiveChildren, 0);

service.admit({
  scope: {
    scopeKind: "thread",
    projectId: "project_external_policy_fixture",
    threadId: "direct_session_external_policy_fixture",
  },
  expectedRevision: 0,
  roleBindings: [{
    roleId: "discovery_research",
    providerId: "opencode-oxalpha",
    reasoningEffort: "high",
    forkTurns: "none",
    workspaceMode: "reasoning_only",
  }],
});
const externalProviderDecision = service.resolveSpawn({
  projectId: "project_external_policy_fixture",
  threadId: "direct_session_external_policy_fixture",
  args: {
    task_name: "external_provider_default",
    message: "Use the policy-selected external provider.",
    agent_type: "discovery_research",
  },
  parentModel: "gpt-5.6-sol",
  parentReasoningEffort: "max",
});
assert.equal(externalProviderDecision.launchEligible, true);
assert.equal(
  externalProviderDecision.effectiveSpawn.model,
  "opencode/x-preview-f-free",
  "an external provider binding without a model must inherit that provider's model rather than the parent's incompatible model",
);

const admissionRaceProjectId = "project_policy_admission_race";
const admissionRaceThreadId = "direct_session_policy_admission_race";
const admissionRaceStore = new DirectSessionStore({
  rootDir: path.join(rootDir, "admission-race-sessions"),
});
admissionRaceStore.createSession({
  sessionId: admissionRaceThreadId,
  projectId: admissionRaceProjectId,
  title: "Policy preflight admission race",
  model: "gpt-5.4",
  reasoningEffort: "high",
  runtimeMode: "direct-experimental",
  directTransport: "live-text",
  directTier: "implementation-lane",
  nativeDirectSession: true,
});
const admissionRaceProject = {
  id: admissionRaceProjectId,
  workspace: { kind: "local", localPath: "[REDACTED:fixture]" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      model: "gpt-5.4",
      profileId: "active-policy-admission-race-profile",
    },
  },
};
let semanticAdmissionCalls = 0;
let releaseSemanticAdmission;
const semanticAdmissionGate = new Promise((resolve) => {
  releaseSemanticAdmission = resolve;
});
let releaseProviderResponse;
const providerResponseGate = new Promise((resolve) => {
  releaseProviderResponse = resolve;
});
const admissionRaceController = new DirectLiveTextController({
  sessionStore: admissionRaceStore,
  profileDoc: {
    profile: {
      profileId: "active-policy-admission-race-profile",
      ontology: {
        models: [{ id: "gpt-5.4", displayName: "GPT-5.4", status: "accepted" }],
        continuationShapes: [{
          id: "continuation.tool_result",
          field: "tool-result continuation",
          status: "accepted",
        }],
      },
    },
  },
  authStore: {
    readStatus: () => ({
      status: "authenticated",
      accountId: "fixture-account",
      hasAccessToken: true,
      hasRefreshToken: true,
      storageMode: "memory",
    }),
    readCredentials: () => ({
      accessToken: "fixture-access-token",
      accountId: "fixture-account",
    }),
  },
  implementationProofEvidenceResolver: () => ({
    status: "ready",
    evidenceState: "runtime_probed",
    canSelectImplementationLane: true,
    requiredCapabilities: ["read_file", "read_file_loop", "apply_patch", "run_command"]
      .map((capabilityId) => ({
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
  }),
  activeSubAgentPolicySemanticPreflight: async () => {
    semanticAdmissionCalls += 1;
    await semanticAdmissionGate;
    return {
      settlement: {
        settlementId: "policy_settlement_admission_race",
        digest: "sha256:policy-settlement-admission-race",
        state: "no_change",
      },
    };
  },
  fetchImpl: async () => providerResponseGate,
});
const firstAdmission = admissionRaceController.startTurn({
  sessionId: admissionRaceThreadId,
  clientTurnRequestId: "client_admission_race_first",
  promptText: "Start the first bounded turn.",
  model: "gpt-5.4",
  effort: "high",
}, { project: admissionRaceProject });
for (let index = 0; index < 20 && semanticAdmissionCalls === 0; index += 1) {
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal(semanticAdmissionCalls, 1);
const secondAdmission = admissionRaceController.startTurn({
  sessionId: admissionRaceThreadId,
  clientTurnRequestId: "client_admission_race_second",
  promptText: "Start a conflicting second turn.",
  model: "gpt-5.4",
  effort: "high",
}, { project: admissionRaceProject });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  semanticAdmissionCalls,
  1,
  "a second turn must wait outside semantic preflight until the first admission is committed",
);
releaseSemanticAdmission();
const firstAdmissionResult = await firstAdmission;
await assert.rejects(
  secondAdmission,
  (error) => error?.code === "active_turn_exists",
  "serialized admission must recheck the active turn before a second semantic preflight",
);
assert.equal(
  semanticAdmissionCalls,
  1,
  "a rejected concurrent turn must not spend a second semantic-settlement invocation",
);
releaseProviderResponse(new Response([
  "event: response.created",
  "data: {\"response\":{\"id\":\"resp_policy_admission_race\",\"model\":\"gpt-5.4\"}}",
  "",
  "event: response.output_text.delta",
  "data: {\"item_id\":\"msg_policy_admission_race\",\"delta\":\"Finished.\"}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"id\":\"resp_policy_admission_race\",\"status\":\"completed\"}}",
  "",
].join("\n"), {
  status: 200,
  headers: { "content-type": "text/event-stream" },
}));
await admissionRaceController.waitForTurnCompletion({
  sessionId: admissionRaceThreadId,
  turnId: firstAdmissionResult.turn.id,
});

const storeText = fs.readFileSync(
  path.join(rootDir, "active-sub-agent-policies.json"),
  "utf8",
);
assert.equal(
  storeText.includes(rawPolicyStatement),
  false,
  "the durable semantic store must not persist raw operator utterances",
);
assert.equal(storeText.includes("rawProviderPayload"), true);

fs.rmSync(rootDir, { recursive: true, force: true });
console.log("direct active sub-agent policy regression: ok");
