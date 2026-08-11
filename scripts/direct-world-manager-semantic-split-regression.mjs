#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createSemanticIngressFixture,
  semanticDischargeFixtureAction,
  semanticIngressFixtureResult,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
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
  buildRealizationOptionSnapshot,
} = require("../src/main/direct/worldmanager/project-genesis");
const {
  DirectRoleRuntime,
} = require("../src/main/direct/worldmanager/role-runtime");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");

function typeExpression(characterization) {
  return {
    mode: "freeform",
    existingTypeRef: "",
    proposedLabel: "",
    parentTypeRef: "",
    differentia: "",
    components: [],
    freeformCharacterization: characterization,
  };
}

function sseFor(id, payload) {
  const text = typeof payload === "string"
    ? payload
    : JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name) =>
        String(name || "").toLowerCase() === "content-type"
          ? "text/event-stream"
          : "",
    },
    text: async () => [
      "event: response.created",
      `data: ${JSON.stringify({
        response: { id, model: "gpt-5.4" },
      })}`,
      "",
      "event: response.output_text.delta",
      `data: ${JSON.stringify({
        item_id: `${id}_message`,
        delta: text,
      })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({
        response: {
          id,
          status: "completed",
          usage: {
            input_tokens: 20,
            output_tokens: 30,
            total_tokens: 50,
          },
        },
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"),
  };
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-semantic-split-",
  ),
);
const sessionRoot = path.join(rootDir, "direct-sessions");
const profileDoc = JSON.parse(
  JSON.stringify(loadDirectCodexProfile()),
);
const models = Array.isArray(profileDoc.profile?.ontology?.models)
  ? profileDoc.profile.ontology.models
  : [];
const acceptedModel = models.find(
  (entry) => entry?.id === "gpt-5.4",
);
if (acceptedModel) acceptedModel.status = "accepted";
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
  accessToken:
    "semantic_split_access_token_secret_1234567890",
  refreshToken:
    "semantic_split_refresh_token_secret_1234567890",
  expiresAt: Date.now() + 3_600_000,
  accountId: "[REDACTED:account-id]",
});
const runtimeProject = {
  id: "project_control_plane",
  name: "Control Plane",
  workspace: {
    kind: "local",
    localPath: "[REDACTED:private-path]",
  },
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
const unifiedResponse =
  "I registered the Windows clipboard utility as a non-canonical project candidate and also treated the broader idea as a world-level design direction. The project still needs explicit review and admission before it becomes canonical.";
function splitResponses(prefix) {
  return [
  sseFor(`resp_${prefix}_child_genesis`, {
    semanticSummary:
      "A Windows-native clipboard utility is a durable project seed.",
    projectConstitution: {
      proposedProjectId: "project_clipboard_utility",
      name: "Clipboard Utility",
      summary:
        "Build a native Windows clipboard utility.",
      primaryAgentEnvironmentId:
        "env_windows_native",
      allowedEnvironmentIds: [
        "env_windows_native",
        "env_wsl_native",
      ],
      gitAuthorityEnvironmentId:
        "env_windows_native",
    },
    realizationRecommendations: [{
      rank: 1,
      environmentId: "env_windows_native",
      rationale: [
        "The utility targets native Windows clipboard behavior.",
      ],
      tradeoffs: [
        "WSL remains useful for secondary source inspection.",
      ],
    }],
    openDecisions: [
      "Choose a workspace path during provisioning.",
    ],
  }),
  sseFor(`resp_${prefix}_child_reconciliation`, {
    schema:
      "direct_world_manager_reconciliation_result@1",
    semanticSummary:
      "The candidate is coherent and remains non-canonical.",
    blindspots: [
      "The workspace path is still open.",
    ],
    continuationPaths: [
      "Inspect and admit the candidate if appropriate.",
    ],
    recommendation:
      "Keep the candidate pending explicit admission.",
  }),
  sseFor(
    `resp_${prefix}_child_world`,
    "The second idea is a world-level design direction rather than a change to an existing project.",
  ),
  sseFor(`resp_${prefix}_parent_join`, unifiedResponse),
  ];
}
function partialSplitResponses(prefix) {
  return [
    sseFor(`resp_${prefix}_child_genesis`, {
      semanticSummary:
        "A second Windows project seed was preserved, but its discharge form is incomplete.",
      projectConstitution: {
        proposedProjectId:
          "project_partial_clipboard_seed",
        name: "Partial Clipboard Seed",
        summary:
          "A preserved Windows clipboard project seed.",
        primaryAgentEnvironmentId:
          "env_windows_native",
        allowedEnvironmentIds: [
          "env_windows_native",
        ],
        gitAuthorityEnvironmentId:
          "env_windows_native",
      },
      realizationRecommendations: [],
    }),
    sseFor(
      `resp_${prefix}_child_world`,
      "The second semantic child completed at world scope.",
    ),
    sseFor(
      `resp_${prefix}_parent_join`,
      "I preserved both semantic children, but the project seed still needs a valid project-genesis discharge before it can become a candidate.",
    ),
  ];
}
const responses = splitResponses("initial");
const capturedBodies = [];
const sessionStore = new DirectSessionStore({
  rootDir: sessionRoot,
});
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
    assert.ok(response, "unexpected provider request");
    return response;
  },
});
roleRuntime = new DirectRoleRuntime({
  controller,
  sessionStore,
  resolveProject: async (projectId) =>
    projectId === runtimeProject.id
      ? runtimeProject
      : null,
});

let tick = Date.parse("2026-07-29T10:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const realizationSnapshot =
  buildRealizationOptionSnapshot({
    controlPlaneEnvironmentId: "env_wsl_native",
    observedAt: "2026-07-29T10:00:00.000Z",
    options: [
      {
        environmentId: "env_wsl_native",
        environmentKind: "wsl",
        displayLabel: "WSL · Ubuntu",
        availability: "ready",
        admissionState: "eligible",
        nativeProcess: true,
        residentExecutorSupport: true,
        defaultShell: "bash",
        capabilityClasses: [
          "native_process",
          "resident_workspace_executor",
        ],
        evidenceRefs: [{
          kind: "runtime_realization_probe",
          id: "probe_wsl",
          digest: `sha256:${"1".repeat(64)}`,
        }],
      },
      {
        environmentId: "env_windows_native",
        environmentKind: "windows",
        displayLabel: "Windows · native",
        availability: "ready",
        admissionState: "eligible",
        nativeProcess: true,
        residentExecutorSupport: true,
        defaultShell: "powershell",
        capabilityClasses: [
          "native_process",
          "resident_workspace_executor",
          "windows_shell_integration",
        ],
        evidenceRefs: [{
          kind: "runtime_realization_probe",
          id: "probe_windows",
          digest: `sha256:${"2".repeat(64)}`,
        }],
      },
    ],
  });
const splitAction = semanticDischargeFixtureAction(
  "wm_discharge_split",
  {
    childContracts: [
      typeExpression(
        "A durable project seed for a native Windows clipboard utility.",
      ),
      typeExpression(
        "A world-level design direction concerning a broader interaction idea.",
      ),
    ],
    coordinationObjective:
      "Settle both ideas independently and return one coherent response.",
    rationaleSummary:
      "The utterance contains two independently actionable meanings.",
  },
);
const semanticIngressRunner =
  createSemanticIngressFixture({
    overrides: {
      split_two_ideas: splitAction,
      resume_split: splitAction,
      partial_split: splitAction,
      "split_two_ideas:sc2b:child:1":
        semanticDischargeFixtureAction(
          "wm_discharge_project_genesis",
          {
            seedType: typeExpression(
              "durable Windows clipboard utility project seed",
            ),
            objective:
              "Formulate a candidate project constitution.",
            constitutionDimensions: [
              typeExpression("project purpose"),
              typeExpression("realization substrate"),
            ],
            ambiguities: [],
            rationaleSummary:
              "The first semantic child is a durable project seed.",
          },
        ),
      "resume_split:sc2b:child:1":
        semanticDischargeFixtureAction(
          "wm_discharge_project_genesis",
          {
            seedType: typeExpression(
              "durable Windows clipboard utility project seed",
            ),
            objective:
              "Formulate a candidate project constitution.",
            constitutionDimensions: [
              typeExpression("project purpose"),
              typeExpression("realization substrate"),
            ],
            ambiguities: [],
            rationaleSummary:
              "The first semantic child is a durable project seed.",
          },
        ),
      "split_two_ideas:sc2b:child:2":
        semanticDischargeFixtureAction(
          "wm_discharge_world_conversation",
          {
            conversationKind: typeExpression(
              "world-level design reflection",
            ),
            responseIntent:
              "Respond to the broader design direction.",
            contextNeeds: [],
            rationaleSummary:
              "The second semantic child belongs at world scope.",
          },
        ),
      "partial_split:sc2b:child:1":
        semanticDischargeFixtureAction(
          "wm_discharge_project_genesis",
          {
            seedType: typeExpression(
              "second durable Windows clipboard project seed",
            ),
            objective:
              "Formulate a candidate project constitution.",
            constitutionDimensions: [
              typeExpression("project purpose"),
              typeExpression("realization substrate"),
            ],
            ambiguities: [],
            rationaleSummary:
              "The first semantic child is a preserved project seed.",
          },
        ),
      "partial_split:sc2b:child:2":
        semanticDischargeFixtureAction(
          "wm_discharge_world_conversation",
          {
            conversationKind: typeExpression(
              "world-level design discussion",
            ),
            responseIntent:
              "Respond naturally at world scope.",
            contextNeeds: [],
            rationaleSummary:
              "The second semantic child belongs at world scope.",
          },
        ),
      "resume_split:sc2b:child:2":
        semanticDischargeFixtureAction(
          "wm_discharge_world_conversation",
          {
            conversationKind: typeExpression(
              "world-level design reflection",
            ),
            responseIntent:
              "Respond to the broader design direction.",
            contextNeeds: [],
            rationaleSummary:
              "The second semantic child belongs at world scope.",
          },
        ),
      visible_terminal_remand:
        semanticIngressFixtureResult({
          taskType: "project_discussion",
          laneAssignments: [{
            laneId: "semantic_settlement",
            posture: "primary",
            scopeKind: "user_world",
            rationaleSummary:
              "A material scope choice is required.",
          }],
          roleAssignments: [{
            role: "world_manager",
            scopeKind: "user_world",
          }],
          actionClasses: [],
          effectClasses: [],
          formulationDisposition: "clarify",
          ambiguityReasons: [
            "target project is materially ambiguous",
          ],
          clarificationPrompt:
            "Which project should receive this idea?",
          rationaleSummary:
            "The target project must be selected before routing.",
        }),
    },
  });
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const service = new DirectWorldManagerService({
  store,
  roleRuntime,
  realizationSnapshotProvider: () =>
    realizationSnapshot,
  semanticIngressRunner,
  userWorldId: "user_world_semantic_split_regression",
  projects: [{
    id: runtimeProject.id,
    name: runtimeProject.name,
    summary: "Direct control-plane runtime project.",
    runtimePath: "direct",
  }],
  activeProjectId: runtimeProject.id,
  now,
});
service.bootstrap();

const split = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "split_two_ideas",
  text:
    "I have two ideas: a Windows clipboard utility project, and a broader design direction for our interaction model.",
  scopeHint: {
    projectId: runtimeProject.id,
    bindingPosture: "ambient_focus",
  },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(split.receipt.settlementState, "completed");
assert.equal(split.projection.semanticSplit.state, "completed");
assert.equal(split.projection.semanticSplit.childCount, 2);
assert.deepEqual(
  split.projection.semanticSplit.childOutcomes.map(
    (outcome) => outcome.state,
  ),
  ["completed", "completed"],
);
assert.equal(split.projection.messages.length, 2);
assert.equal(
  split.projection.messages.at(-1).authorRole,
  "world_manager",
);
assert.equal(
  split.projection.messages.at(-1).text,
  unifiedResponse,
);
assert.equal(
  split.projection.messages.some(
    (message) => message.authorKind === "harness",
  ),
  false,
);
assert.equal(
  store.descriptor().counts.semanticChildContractCount,
  2,
);
assert.equal(
  store.listSemanticHistoryRelations({
    semanticEventId:
      split.receipt.semanticEventRef.id,
  }).filter((record) =>
    record.relation.relationKind ===
      "has_semantic_child").length,
  2,
);
const childContracts =
  store.listSemanticChildContracts({
    parentSemanticEventId:
      split.receipt.semanticEventRef.id,
  });
assert.deepEqual(
  childContracts.map((record) =>
    store.settlementForSemanticEvent(
      record.contract.childSemanticEventId,
    ).taskSettlement.taskType),
  ["project_initialization", "world_conversation"],
);
assert.equal(
  childContracts.every((record) =>
    store.semanticIngressForSemanticEvent(
      record.contract.childSemanticEventId,
    ).requestManifest.outputContractRef.id ===
      "world_manager.semantic_child_discharge@1"),
  true,
);
assert.equal(
  store.listCandidateArtifacts().length,
  1,
);
assert.equal(
  store.listCandidateArtifacts()[0]
    .sourceSemanticEventRef.id,
  childContracts[0].contract.childSemanticEventId,
);
assert.equal(
  store.listAgentResults().find((record) =>
    record.agentResult.sourceSemanticEventId ===
      childContracts[0].contract.childSemanticEventId)
    ?.typedPayload?.schema,
  "direct_world_manager_project_genesis_result@1",
);
assert.equal(
  store.descriptor().counts.roleRunCount,
  4,
);
assert.equal(
  store.descriptor().counts.agentResultCount,
  4,
);
assert.equal(capturedBodies.length, 4);
assert.match(
  capturedBodies.at(-1).input[0].content[0].text,
  /SEMANTIC SPLIT COORDINATION - TRUSTED HARNESS EVIDENCE/,
);
assert.match(
  capturedBodies.at(-1).input[0].content[0].text,
  /The second idea is a world-level design direction/,
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PROJECTION_PATH,
    ),
    JSON.stringify(split.projection),
    "utf8",
  );
}

responses.push(...partialSplitResponses("partial"));
const partial = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "partial_split",
  text:
    "I have two more ideas: preserve a second Windows clipboard project seed, and note a world-level design observation.",
  scopeHint: {
    projectId: runtimeProject.id,
    bindingPosture: "ambient_focus",
  },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(
  partial.projection.semanticSplit.state,
  "partially_remanded",
);
assert.equal(
  partial.projection.lifecycleState,
  "attention_required",
);
assert.deepEqual(
  partial.projection.semanticSplit.childOutcomes.map(
    (outcome) => outcome.state,
  ),
  ["remanded", "completed"],
);
assert.equal(
  partial.projection.messages.at(-1).authorKind,
  "harness",
);
assert.match(
  partial.projection.messages.at(-1).text,
  /did not complete/i,
);
assert.equal(
  partial.projection.projectEcology.projectSeeds.length,
  1,
);
assert.equal(
  partial.projection.projectEcology.projectSeeds[0]
    .countedAsProject,
  false,
);
assert.equal(
  partial.projection.projectEcology.projectSeeds[0]
    .recoveryPosture,
  "retry_available",
);
assert.equal(
  partial.projection.decisionSummary
    .historicalRemandsCountedAsOpen,
  false,
);
assert.equal(
  partial.projection.activeLineages.at(-1).state,
  "partially_remanded",
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PARTIAL_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PARTIAL_PROJECTION_PATH,
    ),
    JSON.stringify(partial.projection),
    "utf8",
  );
}

const remanded = await service.submit({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "visible_terminal_remand",
  text: "Apply this new idea to the right project.",
  scopeHint: {
    projectId: "",
    bindingPosture: "ambient_focus",
  },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [],
});
assert.equal(
  remanded.receipt.settlementState,
  "clarification_required",
);
assert.equal(
  remanded.projection.messages.at(-1).authorKind,
  "harness",
);
assert.equal(
  remanded.projection.messages.at(-1).canonical,
  false,
);
assert.match(
  remanded.projection.messages.at(-1).text,
  /Which project should receive this idea\?/,
);
assert.ok(
  remanded.projection.messages.at(-1).noticeRef,
);
assert.equal(
  remanded.projection.decisionSummary
    .actionRequiredCount,
  3,
);
assert.equal(
  remanded.projection.decisionSummary
    .operationalGateDecisions.length,
  1,
);
assert.equal(
  remanded.projection.decisionSummary
    .migrationPosture,
  "sc3_canonical_registry",
);
assert.equal(
  remanded.projection.decisionSummary
    .historicalRemands.length,
  1,
);
assert.equal(
  remanded.projection.decisionSummary
    .historicalRemands[0]
    .countedAsOpenDecision,
  false,
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_REMAND_PROJECTION_PATH
) {
  fs.writeFileSync(
    path.resolve(
      process.env
        .CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_REMAND_PROJECTION_PATH,
    ),
    JSON.stringify(remanded.projection),
    "utf8",
  );
}
assert.equal(store.verifyLedger().ok, true);

service.close();

// A split that was materialized before a role runtime became available is
// continued idempotently from its durable child contracts on the next ready
// cycle.
const restartRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-semantic-split-restart-",
  ),
);
const materializationStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: restartRoot,
    now,
  });
const materializationService =
  new DirectWorldManagerService({
    store: materializationStore,
    semanticIngressRunner,
    userWorldId:
      "user_world_semantic_split_restart",
    projects: [{
      id: runtimeProject.id,
      name: runtimeProject.name,
      summary: "Direct control-plane runtime project.",
      runtimePath: "direct",
    }],
    activeProjectId: runtimeProject.id,
    now,
  });
materializationService.bootstrap();
const materializedBeforeRestart =
  await materializationService.submit({
    schema:
      "direct_world_manager_submit_request@1",
    clientRequestId: "resume_split",
    text:
      "Treat these two ideas independently, then return one answer.",
    scopeHint: {
      projectId: runtimeProject.id,
      bindingPosture: "ambient_focus",
    },
    expectedProjectionRevision:
      materializationService.snapshot()
        .projectionRevision,
    attachmentDraftRefs: [],
  });
assert.equal(
  materializedBeforeRestart.receipt
    .settlementState,
  "split_materialized",
);
materializationService.close();

responses.push(
  ...splitResponses("restart"),
);
const restartStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: restartRoot,
    now,
  });
const restartService =
  new DirectWorldManagerService({
    store: restartStore,
    roleRuntime,
    realizationSnapshotProvider: () =>
      realizationSnapshot,
    semanticIngressRunner,
    userWorldId:
      "user_world_semantic_split_restart",
    projects: [{
      id: runtimeProject.id,
      name: runtimeProject.name,
      summary: "Direct control-plane runtime project.",
      runtimePath: "direct",
    }],
    activeProjectId: runtimeProject.id,
    now,
  });
restartService.bootstrap();
await restartService.ready();
const resumed = restartService.snapshot();
assert.equal(resumed.semanticSplit.state, "completed");
assert.equal(resumed.messages.length, 2);
assert.equal(
  resumed.messages.at(-1).authorRole,
  "world_manager",
);
assert.equal(restartStore.verifyLedger().ok, true);
restartService.close();

threadStore.close();
fs.rmSync(rootDir, { recursive: true, force: true });
fs.rmSync(restartRoot, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-semantic-split",
  proofs: {
    splitChildrenPersistWithSemanticLineage: true,
    childrenSettleUnderIndependentConstitutions: true,
    recursiveSplitUnavailableInsideChildContract: true,
    childResultsJoinIntoOneWorldManagerReply: true,
    childCandidateRemainsNonCanonical: true,
    compiledSchemaDiscriminatorCanBeInjected:
      true,
    partialSplitRemainsVisibleAndInspectable:
      true,
    remandedProjectSeedRemainsRecoverable:
      true,
    materializedSplitContinuesAfterRestart: true,
    terminalRemandAlwaysHasHarnessNotice: true,
  },
  providerRequestCount: capturedBodies.length,
  canonicalWriteGranted: false,
}, null, 2));
