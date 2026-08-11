#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createSemanticIngressFixture,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const k5Integration =
  process.env.CODEX_WORLD_MANAGER_K5_INTEGRATION === "1";
const {
  createDirectAuthStore,
} = require("../src/main/direct/auth/auth-store");
const {
  DirectLiveTextController,
} = require("../src/main/direct/controller/live-text-controller");
const {
  loadDirectCodexProfile,
} = require("../src/main/direct/odeu-profile/profile-loader");
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  DirectThreadStore,
} = require("../src/main/direct/thread/thread-store");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectRoleRuntime,
} = require("../src/main/direct/worldmanager/role-runtime");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  DirectWorldManagerEpistemicFabricRuntime,
} = require("../src/main/direct/worldmanager/epistemic-fabric-runtime");

function textResponse(text, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: {
      get: (name) => headers[String(name || "").toLowerCase()] || "",
    },
    text: async () => text,
  };
}

function sseFor(id, payload) {
  const text = typeof payload === "string"
    ? payload
    : JSON.stringify(payload);
  return [
    "event: response.created",
    `data: ${JSON.stringify({ response: { id, model: "gpt-5.4" } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ item_id: `${id}_message`, delta: text })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({
      response: {
        id,
        status: "completed",
        usage: {
          input_tokens: 12,
          output_tokens: 18,
          total_tokens: 30,
        },
      },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-k4-"),
);
const sessionRoot = path.join(rootDir, "direct-sessions");
const profileDoc = JSON.parse(JSON.stringify(loadDirectCodexProfile()));
const models = Array.isArray(profileDoc.profile?.ontology?.models)
  ? profileDoc.profile.ontology.models
  : [];
const model = models.find((entry) => entry?.id === "gpt-5.4");
if (model) model.status = "accepted";
else {
  profileDoc.profile.ontology.models = [
    ...models,
    {
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      status: "accepted",
    },
  ];
}
const authStore = createDirectAuthStore({ mode: "memory" });
authStore.writeCredentials({
  accessToken: "k4_regression_access_token_secret_1234567890",
  refreshToken: "k4_regression_refresh_token_secret_1234567890",
  expiresAt: Date.now() + 3_600_000,
  accountId: "[REDACTED:account-id]",
});
const project = {
  id: "project_alpha",
  name: "Project Alpha",
  workspace: { kind: "local", localPath: "[REDACTED:private-path]" },
  surfaceBinding: {
    codex: {
      runtimeMode: "direct-experimental",
      directTier: "text-only",
      directTransport: "live-text",
      model: "gpt-5.4",
      profileId: profileDoc.profile.profileId,
    },
  },
};

const responses = [
  sseFor(
    "resp_k4_pm",
    "Here is a five-feature direction:\n\n1. Proposal registration\n2. Explicit admission\n3. Implementation contracts\n4. WorkThread launch\n5. Closure evidence\n\nChoose the first implementation slice when you want to refine this plan.",
  ),
  sseFor("resp_k4_wm", {
    schema: "direct_world_manager_reconciliation_result@1",
    semanticSummary:
      "The planning turn established a coherent direction but did not commit it.",
    blindspots: ["Budget and ordering remain unsettled."],
    continuationPaths: [
      "Refine the proposal before admission.",
      "Select the first bounded feature.",
    ],
    recommendation:
      "Resolve ordering and budget before any K5 admission decision.",
    semanticActions: [{
      actionType: "register_plan_proposal",
      semanticPayload: {
        title: "Five-feature Direct planning pipeline",
        summary: "Introduce proposal registration, admission, contracts, worker start, and closure evidence in bounded order.",
        features: [
          { title: "Proposal registration", outcome: "Persist a reconciled candidate revision." },
          { title: "Explicit admission", outcome: "Promote only an exact reviewed revision." },
          { title: "Implementation contracts", outcome: "Compile canonical obligations before execution." },
          { title: "WorkThread launch", outcome: "Start only under separate authority." },
          { title: "Closure evidence", outcome: "Keep activity distinct from completion." },
        ],
        openDecisions: ["Budget and ordering"],
      },
    }],
  }),
  sseFor(
    "resp_k4_greeting_wm",
    "Hi! What would you like to work on?",
  ),
  sseFor(
    "resp_k4_introspection_wm",
    "I treated the previous message as ordinary conversation because it contained no project referent or requested project effect. The focused project was ambient context, not a binding scope.",
  ),
  textResponse("provider unavailable", 503, {
    "content-type": "text/plain",
  }),
  sseFor(
    "resp_k4_unstructured_natural",
    "This is a natural planning response, not a schema-shaped answer.",
  ),
  sseFor("resp_k4_unstructured_reconciliation", {
    schema: "direct_world_manager_reconciliation_result@1",
    semanticSummary:
      "The Project Manager returned a natural response without creating a proposal artifact.",
    blindspots: [],
    continuationPaths: [
      "Continue the project discussion if the operator wants more detail.",
    ],
    recommendation:
      "Keep semantic registration separate from response formatting.",
    semanticActions: [],
  }),
];
const capturedBodies = [];
const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
const threadStore = new DirectThreadStore({
  rootDir: sessionRoot,
  mode: "context_build_required",
});
let roleRuntime = null;
const controller = new DirectLiveTextController({
  sessionStore,
  directThreadStore: threadStore,
  profileDoc,
  authStore,
  compiledAgentContextResolver: (input) =>
    roleRuntime?.resolveCompiledAgentContext(input) || null,
  fetchImpl: async (_url, init) => {
    capturedBodies.push(JSON.parse(init.body));
    const response = responses.shift();
    if (typeof response === "function") return response();
    return typeof response === "string"
      ? textResponse(response, 200, {
          "content-type": "text/event-stream",
        })
      : response;
  },
});
roleRuntime = new DirectRoleRuntime({
  controller,
  sessionStore,
  resolveProject: async (projectId) =>
    projectId === project.id ? project : null,
});
let tick = Date.parse("2026-07-26T18:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const store = new DirectWorldManagerControlPlaneStore({ rootDir, now });
const epistemicFabric =
  new DirectWorldManagerEpistemicFabricRuntime({
    dbPath: store.dbPath,
    userWorldId: "user_world_k4_regression",
    now,
  });
const service = new DirectWorldManagerService({
  store,
  planProposalLifecycleEnabled: k5Integration,
  epistemicFabric,
  roleRuntime,
  userWorldId: "user_world_k4_regression",
  projects: [{
    id: project.id,
    name: project.name,
    summary: "Primary Direct runtime project.",
    runtimePath: "direct",
  }],
  semanticIngressRunner: createSemanticIngressFixture(),
  activeProjectId: project.id,
  now,
});
service.bootstrap();

const planned = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_plan",
  text: "Plan the next five features without starting implementation.",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision: service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(
  planned.projection.pipelineStage,
  k5Integration ? "wm_k5_planning" : "wm_k4",
);
assert.equal(
  planned.projection.lifecycleState,
  k5Integration ? "candidate_ready" : "reconciled",
);
assert.equal(
  planned.projection.latestProposal === null,
  !k5Integration,
);
if (k5Integration) {
  assert.equal(planned.projection.latestProposal.state, "candidate");
  assert.equal(planned.projection.latestProposal.revision, 1);
  assert.equal(planned.projection.latestProposal.features.length, 5);
  if (process.env.CODEX_WORLD_MANAGER_K5_INTEGRATION_PROJECTION_PATH) {
    fs.writeFileSync(
      process.env.CODEX_WORLD_MANAGER_K5_INTEGRATION_PROJECTION_PATH,
      `${JSON.stringify(planned.projection, null, 2)}\n`,
    );
  }
}
assert.equal(planned.projection.latestContract, null);
assert.equal(
  planned.projection.epistemicFabric.schema,
  "direct_epistemic_fabric_projection@1",
);
assert.equal(
  epistemicFabric.ledgerStore
    .listEvents({ limit: 100 })
    .filter((event) =>
      event.typedPayloadSchema ===
        "direct_turn_closure_envelope@1")
    .length,
  2,
);
assert.ok(
  epistemicFabric.ledgerStore
    .listEvents({ limit: 100 })
    .filter((event) =>
      event.typedPayloadSchema ===
        "direct_turn_closure_envelope@1")
    .every((event) =>
      event.typedPayload
        .finalProseReinterpretedByHarness === false),
);
assert.equal(planned.projection.messages.length, 2);
const assistantMessage = planned.projection.messages[1];
assert.equal(assistantMessage.authorKind, "agent");
assert.equal(assistantMessage.authorRole, "project_manager");
assert.equal(assistantMessage.canonical, false);
const latestResult = planned.projection.evidence.latestAgentResult;
assert.equal(
  assistantMessage.agentResultRef.id,
  latestResult.agentResult.agentResultId,
);
assert.equal(
  latestResult.inboxEntry.agentResultRef.id,
  latestResult.agentResult.agentResultId,
);
assert.equal(latestResult.inboxEntry.deliveryState, "delivered");
assert.equal(
  latestResult.agentResult.finalAssistantMessageRef.id,
  latestResult.finalAssistantMessage.finalAssistantMessageId,
);
assert.notEqual(
  latestResult.agentResult.telemetryEnvelopeRef.id,
  latestResult.agentResult.finalAssistantMessageRef.id,
);
assert.equal(latestResult.telemetry.toolCallCount, 0);
assert.equal(
  planned.projection.reconciliation.sourceAgentResultId,
  latestResult.agentResult.agentResultId,
);
assert.equal(
  planned.projection.reconciliation.state,
  "reconciled",
);
assert.equal(
  planned.projection.truthPosture.candidateIsCanonical,
  false,
);
if (process.env.CODEX_WORLD_MANAGER_K4_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(process.env.CODEX_WORLD_MANAGER_K4_PROJECTION_PATH),
    JSON.stringify(planned.projection),
    "utf8",
  );
}
assert.ok(capturedBodies[0].instructions.includes(
  "You are the Project Manager planning organ",
));
assert.ok(capturedBodies[0].instructions.includes(
  "Return one direct natural-language response",
));
assert.doesNotMatch(
  capturedBodies[0].instructions,
  /Return exactly direct_project_manager_planning_result/,
);
assert.ok(capturedBodies[1].instructions.includes(
  "constitutional WorldManager reconciling",
));
assert.equal(capturedBodies[0].tools, undefined);
assert.equal(capturedBodies[1].tools, undefined);

const greeting = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_world_greeting",
  text: "hey",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(greeting.receipt.settlementState, "completed");
assert.equal(
  greeting.projection.evidence.latestSettlement.taskType,
  "world_conversation",
);
assert.equal(
  greeting.projection.evidence.latestSettlement.responsibleRole,
  "world_manager",
);
assert.equal(
  greeting.projection.messages.at(-1).authorRole,
  "world_manager",
);
assert.equal(
  greeting.projection.messages.at(-1).text,
  "Hi! What would you like to work on?",
);
assert.ok(
  greeting.projection.messages
    .filter((message) =>
      message.semanticEventId ===
        greeting.receipt.semanticEventRef.id)
    .every((message) => message.projectId === ""),
);
assert.equal(
  greeting.projection.evidence.latestAgentResult.agentResult
    .outputContractState,
  "validated",
);
assert.equal(
  greeting.projection.evidence.latestAgentResult.outputValidationState,
  "validated",
);
assert.equal(
  greeting.projection.reconciliation.state,
  "not_required",
);
assert.ok(capturedBodies[2].instructions.includes(
  "Do not append project status, open-decision boilerplate",
));
const greetingMessage = greeting.projection.messages.at(-1);
assert.equal(
  store.listAgentResults({ limit: 1000 })
    .find((record) =>
      record.agentResult?.agentResultId ===
        greetingMessage.agentResultRef.id)
    ?.typedPayload,
  null,
);
if (process.env.CODEX_WORLD_MANAGER_K4_GREETING_PROJECTION_PATH) {
  fs.writeFileSync(
    path.resolve(
      process.env.CODEX_WORLD_MANAGER_K4_GREETING_PROJECTION_PATH,
    ),
    JSON.stringify(greeting.projection),
    "utf8",
  );
}

const introspection = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_world_introspection",
  text: "Why did you interpret my previous message that way?",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(introspection.receipt.settlementState, "completed");
assert.equal(
  introspection.projection.evidence.latestSemanticIngress.primaryLane,
  "system_introspection",
);
assert.equal(
  introspection.projection.evidence.latestSettlement.responsibleRole,
  "world_manager",
);
assert.equal(
  introspection.projection.messages.at(-1).text,
  "I treated the previous message as ordinary conversation because it contained no project referent or requested project effect. The focused project was ambient context, not a binding scope.",
);
assert.ok(
  introspection.projection.messages
    .filter((message) =>
      message.semanticEventId ===
        introspection.receipt.semanticEventRef.id)
    .every((message) => message.projectId === ""),
);
assert.equal(
  introspection.projection.reconciliation.state,
  "not_required",
);
const introspectionWorld = store.agentWorldForSemanticEvent(
  introspection.receipt.semanticEventRef.id,
  { full: true },
);
const discourseEvidence =
  introspectionWorld.compilation.trustedEvidenceArtifacts
    .find((entry) =>
      entry.schema ===
        "direct_trusted_semantic_history_evidence@1");
assert.ok(discourseEvidence);
const greetingHistoryTurn =
  discourseEvidence.payload.turns.find((turn) =>
    turn.userMessage?.text === "hey");
assert.ok(greetingHistoryTurn);
assert.equal(
  greetingHistoryTurn.userMessage.text,
  "hey",
);
assert.equal(
  greetingHistoryTurn.semanticSettlement.laneAssignments
    .find((entry) => entry.posture === "primary")
    ?.laneId,
  "conversation",
);
assert.equal(
  greetingHistoryTurn.visibleManagerResult.userFacingResponse,
  "Hi! What would you like to work on?",
);
assert.ok(discourseEvidence.selectedTurnCount >= 2);
assert.ok(discourseEvidence.selectedShelfCount >= 2);
assert.equal(
  discourseEvidence.selectionMode,
  "semantic_shelf_horizon",
);
assert.equal(discourseEvidence.broaderTranscriptIncluded, false);
assert.equal(
  discourseEvidence.rawChatHistoryImportedBlindly,
  false,
);
assert.equal(
  introspection.projection.evidence.latestAgentWorld
    .trustedDiscourseSelectedTurnCount,
  discourseEvidence.selectedTurnCount,
);
assert.equal(
  introspection.projection.evidence.latestAgentWorld
    .trustedSemanticHistorySelectedTurnCount,
  discourseEvidence.selectedTurnCount,
);
assert.ok(capturedBodies[3].instructions.includes(
  "[BOUNDED SEMANTIC-HISTORY EVIDENCE - QUOTED DATA]",
));
assert.ok(capturedBodies[3].instructions.includes(
  "\"text\":\"hey\"",
));

const failed = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_provider_failure",
  text: "Plan another five project features without implementation.",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision: service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(failed.receipt.settlementState, "failed");
assert.equal(failed.projection.lifecycleState, "failed");
assert.match(
  failed.projection.messages.at(-1).text,
  /could not complete/i,
);
assert.equal(
  failed.projection.latestProposal === null,
  !k5Integration,
);

const unstructured = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_unstructured_natural_output",
  text: "Plan five more project features without implementation.",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision: service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(unstructured.receipt.settlementState, "reconciled");
assert.equal(
  unstructured.projection.evidence.latestAgentResult.agentResult
    .outputContractState,
  "validated",
);
assert.equal(
  unstructured.projection.messages.at(-1).text,
  "This is a natural planning response, not a schema-shaped answer.",
);
assert.equal(
  unstructured.projection.latestProposal === null,
  !k5Integration,
);
if (k5Integration) {
  assert.equal(
    unstructured.projection.latestProposal.proposalRevisionId,
    planned.projection.latestProposal.proposalRevisionId,
    "a reconciliation with no register_plan_proposal action must not fabricate a revision",
  );
}
assert.equal(
  store.listCandidateArtifacts().length,
  k5Integration ? 1 : 0,
);

await assert.rejects(
  () => controller.startTurn({
    sessionId: store.listRoleRuns()[0].directSessionId,
    clientTurnRequestId: "renderer_injection_attempt",
    promptText: "ignored",
    systemPrompt: "Renderer tries to become system authority.",
    compiledAgentContextRef:
      store.listRoleRuns()[0].compiledAgentContextRef,
  }, { project }),
  (error) =>
    error?.code === "direct_compiled_agent_renderer_instruction_rejected",
);

assert.equal(store.verifyLedger().ok, true);
assert.equal(
  store.descriptor().counts.candidateCount,
  k5Integration ? 1 : 0,
);
assert.ok(store.descriptor().counts.roleRunCount >= 4);
assert.ok(store.descriptor().counts.agentResultCount >= 4);

responses.push(() => new Promise(() => {}));
const roleStarted = new Promise((resolve) => {
  const onTransition = (event) => {
    if (event.reason !== "role-turn-started") return;
    service.off("transition", onTransition);
    resolve(event);
  };
  service.on("transition", onTransition);
});
void service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "k4_restart_during_role",
  text: "Plan five restart-safe project features without implementation.",
  scopeHint: { projectId: project.id },
  expectedProjectionRevision: service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
await roleStarted;
service.close();
const recoveryStore = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const recoveryService = new DirectWorldManagerService({
  store: recoveryStore,
  planProposalLifecycleEnabled: k5Integration,
  roleRuntime: {},
  userWorldId: "user_world_k4_regression",
  projects: [{
    id: project.id,
    name: project.name,
    summary: "Primary Direct runtime project.",
    runtimePath: "direct",
  }],
  semanticIngressRunner: createSemanticIngressFixture(),
  activeProjectId: project.id,
  now,
});
const recovered = recoveryService.bootstrap().projection;
assert.equal(recovered.lifecycleState, "failed");
assert.equal(recovered.activeLineages.at(-1).state, "interrupted");
assert.equal(recovered.latestProposal === null, !k5Integration);
assert.ok(recoveryStore.listRoleRuns().some((run) =>
  run.state === "interrupted"));
recoveryService.close();
threadStore.close();

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k4",
  proofs: {
    persistedProjectManagerAndWorldManagerTurns: true,
    finalMessageAndTelemetrySeparated: true,
    sameAgentResultRenderedAndDelivered: true,
    providerFailureVisible: true,
    naturalResponseIsNotReverseValidatedAsSemanticJson: true,
    casualGreetingRendersNaturalWorldManagerReply: true,
    worldScopedConversationDoesNotInheritAmbientProjectBadge: true,
    systemIntrospectionRendersNaturalWorldManagerReply: true,
    systemIntrospectionImportsSemanticHistoryHorizon: true,
    broadTranscriptReplayRemainsExcluded: true,
    worldManagerConversationSkipsRecursiveReconciliation: true,
    rendererInstructionInjectionRejected: true,
    reconciliationRemainsAdvisory: true,
    restartDuringRoleTurnRemainsVisible: true,
  },
  providerRequestCount: capturedBodies.length,
  canonicalArtifactsCreated: 0,
}, null, 2));
