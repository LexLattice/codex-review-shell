#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  conversationFixtureResult,
  createSemanticIngressFixture,
  genesisFixtureResult,
  projectEcologyFixtureResult,
  semanticDischargeFixtureAction,
  semanticIngressFixtureResult,
  projectFixtureResult,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");
const {
  DirectWorldManagerSemanticIngressRuntime,
  semanticIngressOutputContract,
  validateSemanticIngressRun,
} = require("../src/main/direct/worldmanager/semantic-ingress-runtime");
const {
  digestFor,
} = require("../src/main/direct/worldmanager/control-plane");
const {
  buildOpenDecision,
  semanticArtifactRef,
} = require(
  "../src/main/direct/worldmanager/semantic-artifact-kernel",
);
const {
  buildImplementationToolInitialRequest,
  requestShapeForDiagnostic,
} = require("../src/main/direct/transport/codex-responses-transport");

const projects = [
  {
    id: "project_alpha",
    name: "Project Alpha",
    summary: "Primary Direct runtime project.",
  },
  {
    id: "project_beta",
    name: "Project Beta",
    summary: "Secondary project used to prove scope settlement.",
  },
];
let tick = Date.parse("2026-07-28T10:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const freeformType = (label) => ({
  mode: "freeform",
  existingTypeRef: "",
  proposedLabel: "",
  parentTypeRef: "",
  differentia: "",
  components: [],
  freeformCharacterization: label,
});

const liveOutputContract =
  semanticIngressOutputContract();
const structuredRequest = buildImplementationToolInitialRequest({
  model: "gpt-5.5",
  prompt: "semantic discharge fixture",
  instructions: "select one semantic action",
  tools: liveOutputContract.tools,
  toolChoicePolicy: "required",
});
assert.equal(
  structuredRequest.tool_choice,
  "required",
);
assert.equal(
  structuredRequest.parallel_tool_calls,
  false,
);
assert.deepEqual(
  structuredRequest.tools.map((tool) => tool.name),
  liveOutputContract.availableActionNames,
);
assert.deepEqual(
  requestShapeForDiagnostic(structuredRequest),
  {
    model: "gpt-5.5",
    stream: true,
    store: false,
    hasPreviousResponseId: false,
    hasInstructions: true,
    inputMessageCount: 1,
    textInputCount: 1,
    functionCallOutputCount: 0,
    customToolCallOutputCount: 0,
    toolCount: 8,
    parallelToolCalls: false,
    reasoningEffort: "",
  },
);

const legacySettlement = {
  schema: "direct_world_manager_semantic_settlement@1",
  semanticSettlementId: "wm_semantic_settlement_legacy",
  semanticEventId: "wm_event_legacy",
  settlementState: "settled",
  speechActs: [{ act: "converse", confidence: "high" }],
  laneAssignments: [{
    laneId: "conversation",
    posture: "primary",
    scopeKind: "user_world",
  }],
  taskTypes: ["world_conversation"],
  actionClasses: ["converse"],
  effectClasses: ["none"],
  formulationDisposition: "answer_in_world_manager_turn",
  roleAssignments: [{
    role: "world_manager",
    scopeKind: "user_world",
  }],
  ambiguityReasons: [],
  grantsAuthority: false,
};
legacySettlement.digest = digestFor(
  legacySettlement.schema,
  legacySettlement,
  ["digest"],
);
const legacyRun = {
  schema: "direct_world_manager_semantic_ingress_run@1",
  semanticIngressRunId: "wm_semantic_ingress_run_legacy",
  semanticEventId: "wm_event_legacy",
  semanticSettlement: legacySettlement,
  runState: "completed",
  rawProviderPayloadStored: false,
  rawChainOfThoughtStored: false,
  grantsAuthority: false,
};
legacyRun.digest = digestFor(
  legacyRun.schema,
  legacyRun,
  ["digest"],
);
assert.equal(validateSemanticIngressRun(legacyRun), true);

function submit(service, clientRequestId, text, scopeHint = {}) {
  return service.submit({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId,
    text,
    scopeHint,
    expectedProjectionRevision:
      service.snapshot().projectionRevision,
    attachmentDraftRefs: [],
  });
}

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-semantic-ingress-"),
);
const semanticIngressRunner = createSemanticIngressFixture({
  overrides: {
    opaque_world: conversationFixtureResult(),
    opaque_project: (input) =>
      projectFixtureResult(input, {
        projectId: "project_alpha",
        taskType: "project_planning",
        laneId: "project_deliberation",
        actionClasses: ["plan", "propose"],
        effectClasses: ["candidate_plan"],
        rationaleSummary:
          "The typed fixture assigned this utterance to Project Alpha planning.",
      }),
    explicit_scope_conflict: (input) =>
      projectFixtureResult(input, {
        projectId: "project_beta",
        taskType: "project_review",
        laneId: "epistemic_inquiry",
        actionClasses: ["inspect", "report"],
        effectClasses: ["read_only_evidence"],
      }),
    mixed_split: semanticIngressFixtureResult({
      taskType: "project_discussion",
      laneAssignments: [
        {
          laneId: "mixed",
          posture: "primary",
          scopeKind: "user_world",
          rationaleSummary:
            "The fixture identified separable world and project meanings.",
        },
        {
          laneId: "project_deliberation",
          posture: "secondary",
          scopeKind: "project",
          projectId: "project_alpha",
          rationaleSummary:
            "One child meaning belongs to Project Alpha.",
        },
      ],
      roleAssignments: [
        {
          role: "world_manager",
          scopeKind: "user_world",
        },
        {
          role: "project_manager",
          scopeKind: "project",
          projectId: "project_alpha",
        },
      ],
      actionClasses: ["converse", "discuss"],
      effectClasses: ["none"],
      formulationDisposition: "split",
      rationaleSummary:
        "The fixture identified separable world and project meanings.",
    }),
    world_introspection: semanticIngressFixtureResult({
      taskType: "world_conversation",
      laneAssignments: [
        {
          laneId: "system_introspection",
          posture: "primary",
          scopeKind: "user_world",
          rationaleSummary:
            "The fixture assigned a question about the system to the world-level introspection lane.",
        },
      ],
      roleAssignments: [
        {
          role: "world_manager",
          scopeKind: "user_world",
        },
      ],
      actionClasses: ["inspect_routing_witness"],
      effectClasses: ["read_only_evidence"],
      formulationDisposition:
        "answer_in_world_manager_turn",
      rationaleSummary:
        "The fixture assigned a question about the system to the world-level introspection lane.",
      speechAct: "inspect",
    }),
    project_ecology_status: (input) =>
      projectEcologyFixtureResult(
        input,
        "project_ecology_status",
      ),
    open_novel_subtype: semanticDischargeFixtureAction(
      "wm_discharge_project_concern",
      {
        projectId: "project_alpha",
        concernType: {
          mode: "proposed_type",
          existingTypeRef: "",
          proposedLabel: "counterfactual continuity audit",
          parentTypeRef: "semantic://project/concern",
          differentia:
            "Audits whether intensional branches remain continuous across implementation changes.",
          components: [],
          freeformCharacterization: "",
        },
        concernSubtype: {
          mode: "freeform",
          existingTypeRef: "",
          proposedLabel: "",
          parentTypeRef: "",
          differentia: "",
          components: [],
          freeformCharacterization:
            "A newly encountered ARO-level concern with no predeclared enum member.",
        },
        objective:
          "Inspect the project without collapsing the novel semantic distinction.",
        operationalAdapter: "project_review",
        requestedActions: [],
        anticipatedEffects: [],
        ambiguities: [],
        rationaleSummary:
          "The semantic content is novel but the discharge form and project reference are valid.",
      },
    ),
    decision_concern: (input) => {
      const decision = input.pendingDecisions.find(
        (candidate) =>
          candidate.decisionRequestId ===
            "wm_open_decision_semantic_only",
      );
      return semanticDischargeFixtureAction(
        "wm_discharge_decision_concern",
        {
        decisionId:
          "wm_open_decision_semantic_only",
        targetArtifactRef:
          decision.targetArtifactRef,
        resolutionMode: "semantic_relay",
        disposition: "deliberate",
        concernType: freeformType(
          "project-priority reframing",
        ),
        objective:
          "Reframe the bound decision against the project’s current priorities.",
        requestedActions: [
          freeformType(
            "interpret the user contribution",
          ),
        ],
        anticipatedEffects: [],
        ambiguities: [],
        rationaleSummary:
          "The user contribution is exactly bound to an admitted OpenDecision whose project is not yet runtime-addressable.",
        },
      );
    },
  },
});
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const service = new DirectWorldManagerService({
  store,
  userWorldId: "user_world_semantic_ingress_regression",
  projects,
  activeProjectId: "project_beta",
  semanticIngressRunner,
  now,
});
service.bootstrap();

// Identical surface text produces different lawful settlements solely because
// the injected semantic-role result differs. No production lexical rule gets
// to reinterpret either result.
const worldResult = submit(
  service,
  "opaque_world",
  "violet orbital memory",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(
  worldResult.projection.evidence.latestSemanticIngress.primaryLane,
  "conversation",
);
assert.equal(
  worldResult.projection.evidence.latestSettlement.taskType,
  "world_conversation",
);
assert.equal(
  worldResult.projection.evidence.latestSettlement.projectId,
  "",
);

const projectResult = submit(
  service,
  "opaque_project",
  "violet orbital memory",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(
  projectResult.projection.evidence.latestSemanticIngress.primaryLane,
  "project_deliberation",
);
assert.equal(
  projectResult.projection.evidence.latestSettlement.taskType,
  "project_planning",
);
assert.equal(
  projectResult.projection.evidence.latestSettlement.projectId,
  "project_alpha",
);

// Exact typed scope bindings are validated after semantic interpretation. A
// conflicting model result is remanded and creates no manager context.
const conflict = submit(
  service,
  "explicit_scope_conflict",
  "the wording here is intentionally irrelevant",
  {
    projectId: "project_alpha",
    bindingPosture: "explicit_constraint",
  },
);
assert.equal(conflict.receipt.remanded, true);
assert.equal(
  conflict.projection.evidence.latestSemanticIngress.runState,
  "remanded",
);
assert.equal(
  conflict.projection.evidence.latestSemanticIngress
    .outputValidationState,
  "remanded",
);
assert.equal(
  conflict.projection.evidence.latestSettlement.taskType,
  "semantic_settlement_unavailable",
);
assert.equal(
  conflict.projection.store.counts.managerContextCount,
  2,
);
assert.equal(
  conflict.projection.store.counts.semanticIngressRunCount,
  3,
);

// Split meaning is accepted as a semantic judgment. In the K3-only slice the
// parent is settled and compiled, then durable child contracts are materialized
// without pretending that provider-backed child execution has occurred.
const mixed = submit(
  service,
  "mixed_split",
  "Tell me something playful, then examine Project Alpha.",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(
  mixed.projection.evidence.latestSemanticIngress.runState,
  "completed",
);
assert.equal(
  mixed.projection.evidence.latestSemanticIngress.primaryLane,
  "mixed",
);
assert.equal(mixed.receipt.remanded, false);
assert.equal(
  mixed.receipt.settlementState,
  "split_materialized",
);
assert.equal(
  mixed.projection.store.counts.managerContextCount,
  3,
);
assert.equal(
  mixed.projection.store.counts.semanticChildContractCount,
  2,
);
assert.equal(
  mixed.projection.store.counts.semanticSplitCoordinationCount,
  1,
);
assert.equal(
  mixed.projection.semanticSplit.state,
  "materialized",
);
assert.equal(
  mixed.projection.semanticSplit.childCount,
  2,
);
assert.equal(
  store.listSemanticChildContracts({
    parentSemanticEventId:
      mixed.receipt.semanticEventRef.id,
  }).length,
  2,
);
assert.equal(
  store.listSemanticHistoryRelations({
    semanticEventId:
      mixed.receipt.semanticEventRef.id,
  }).filter((record) =>
    record.relation.relationKind ===
      "has_semantic_child").length,
  2,
);
assert.equal(
  mixed.projection.messages.at(-1).authorKind,
  "harness",
);
assert.equal(
  mixed.projection.messages.at(-1).canonical,
  false,
);

const introspection = submit(
  service,
  "world_introspection",
  "Why did you interpret my previous message that way?",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(
  introspection.projection.evidence.latestSemanticIngress
    .primaryLane,
  "system_introspection",
);
assert.equal(
  introspection.projection.evidence.latestSettlement.taskType,
  "world_conversation",
);
assert.equal(
  introspection.projection.evidence.latestSettlement
    .responsibleRole,
  "world_manager",
);
assert.equal(
  introspection.projection.evidence.latestSettlement.projectId,
  "",
);

const ecologyStatus = submit(
  service,
  "project_ecology_status",
  "What is the current status of our projects?",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(
  ecologyStatus.projection.evidence.latestSemanticIngress
    .primaryLane,
  "project_ecology",
);
assert.equal(
  ecologyStatus.projection.evidence.latestSettlement.taskType,
  "project_ecology_status",
);
assert.equal(
  ecologyStatus.projection.evidence.latestSettlement.projectId,
  "",
);
assert.equal(
  ecologyStatus.projection.evidence.latestSettlement
    .responsibleRole,
  "world_manager",
);
const ecologyRun = store.semanticIngressForSemanticEvent(
  ecologyStatus.receipt.semanticEventRef.id,
);
assert.equal(
  ecologyRun.semanticDischarge.actionName,
  "wm_discharge_project_ecology_concern",
);
assert.deepEqual(
  ecologyRun.semanticSettlement.laneAssignments
    .filter((assignment) =>
      assignment.posture === "secondary")
    .map((assignment) => assignment.projectId)
    .sort(),
  ["project_alpha", "project_beta"],
);

const novelSubtype = submit(
  service,
  "open_novel_subtype",
  "Audit counterfactual continuity in Project Alpha.",
  {
    projectId: "project_alpha",
    bindingPosture: "explicit_constraint",
  },
);
assert.equal(
  novelSubtype.projection.evidence.latestSemanticIngress.runState,
  "completed",
);
assert.equal(
  novelSubtype.projection.evidence.latestSettlement.taskType,
  "project_review",
);
const novelRun = store.semanticIngressForSemanticEvent(
  novelSubtype.receipt.semanticEventRef.id,
);
assert.equal(
  novelRun.semanticDischarge.arguments.concernType.mode,
  "proposed_type",
);
assert.equal(
  novelRun.outputValidation
    .semanticContentValidatedAgainstClosedTaxonomy,
  false,
);
assert.equal(
  novelSubtype.projection.evidence.latestSemanticIngress
    .semanticActionName,
  "wm_discharge_project_concern",
);
assert.equal(
  novelSubtype.projection.evidence.latestSemanticIngress
    .semanticTypeExpressions.some((entry) =>
      entry.proposedLabel ===
        "counterfactual continuity audit"),
  true,
);

const semanticOnlyDecision = buildOpenDecision({
  decisionId:
    "wm_open_decision_semantic_only",
  sourceKind: "semantic_ingress_fixture",
  sourceKey:
    "semantic_only_project_priority",
  semanticIdentity:
    "Unprovisioned project priority decision",
  question:
    "How should this project be reframed around its current priorities?",
  scope: {
    kind: "project",
    userWorldId:
      "user_world_semantic_ingress_regression",
    projectId:
      "project_windows-context-menu-manager",
  },
  resolutionMode: "semantic_relay",
  now,
});
store.transaction(() => {
  store
    ._appendSemanticArtifactRevisionWithinTransaction(
      semanticOnlyDecision,
    );
  store._rebuildSemanticShelvesWithinTransaction();
  store.incrementRevision();
});
const decisionConcern = service.submit({
  schema:
    "direct_world_manager_submit_request@1",
  clientRequestId: "decision_concern",
  text:
    "Reframe this around the project’s current priorities.",
  scopeHint: {
    projectId: "",
    proposalId:
      semanticOnlyDecision.decisionId,
    bindingPosture: "explicit_constraint",
  },
  expectedProjectionRevision:
    service.snapshot().projectionRevision,
  attachmentDraftRefs: [
    semanticArtifactRef(
      semanticOnlyDecision,
    ),
  ],
});
assert.equal(
  decisionConcern.projection.evidence
    .latestSemanticIngress
    .semanticActionName,
  "wm_discharge_decision_concern",
);
assert.equal(
  decisionConcern.projection.evidence
    .latestSettlement.taskType,
  "semantic_decision_deliberation",
);
assert.equal(
  decisionConcern.projection.evidence
    .latestSettlement.projectId,
  "",
);
assert.equal(
  decisionConcern.projection.evidence
    .latestSettlement.responsibleRole,
  "world_manager",
);
assert.equal(
  decisionConcern.projection
    .operationalMetaContext.latest
    .openDecisionCount,
  1,
);
const decisionContext =
  store.listOperationalMetaContexts({
    full: true,
  }).at(-1);
assert.equal(
  decisionContext.bundle.content
    .openDecisionRefs.some((ref) =>
      ref.id ===
        semanticOnlyDecision.decisionId &&
      ref.digest ===
        semanticOnlyDecision.digest),
  true,
);
assert.equal(
  decisionContext.bundle.scope.kind,
  "user_world",
);
assert.equal(
  decisionContext.requirementSet
    .crossScopePolicy,
  "exact_settled_scope_or_explicit_artifact_binding",
);

const persistedRun = store.semanticIngressForSemanticEvent(
  projectResult.receipt.semanticEventRef.id,
);
assert.equal(persistedRun.rawProviderPayloadStored, false);
assert.equal(persistedRun.rawChainOfThoughtStored, false);
assert.equal(
  persistedRun.semanticSettlement.taskTypes[0],
  "project_planning",
);
assert.equal(store.verifyLedger().ok, true);
service.close();

// A durable project seed does not need project-creation vocabulary. The
// semantic contract—not the string—establishes project genesis.
const seedRuntime =
  new DirectWorldManagerSemanticIngressRuntime({
    runner: createSemanticIngressFixture({
      overrides: {
        seed_without_project_words: genesisFixtureResult(),
      },
    }),
    now,
  });
const seedRun = seedRuntime.run({
  userWorldId: "user_world_semantic_ingress_regression",
  projects,
  event: {
    semanticEventId: "wm_event_seed_without_project_words",
    clientRequestId: "seed_without_project_words",
  },
  message: {
    messageId: "wm_message_seed_without_project_words",
    messageDigest: `sha256:${"1".repeat(64)}`,
    text: "My invoices are eating my life.",
  },
  request: {
    scopeHint: {
      projectId: "project_beta",
      bindingPosture: "ambient_focus",
    },
  },
  focusedProjectId: "project_beta",
  graphBinding: {
    bindingId: "wm_binding_semantic_ingress_regression",
    digest: `sha256:${"2".repeat(64)}`,
  },
  pendingDecisions: [],
});
assert.equal(seedRun.runState, "completed");
assert.equal(
  seedRun.semanticSettlement.taskTypes[0],
  "project_initialization",
);
assert.equal(
  seedRun.semanticSettlement.laneAssignments[0].laneId,
  "project_genesis",
);
assert.equal(
  seedRun.semanticSettlement.roleAssignments[0].role,
  "world_manager",
);

// With no semantic runner, the system remands. It does not guess that even a
// familiar greeting belongs to a conversational lane.
const unavailableRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "direct-world-manager-semantic-unavailable-"),
);
const unavailableStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir: unavailableRoot,
    now,
  });
const unavailableService = new DirectWorldManagerService({
  store: unavailableStore,
  userWorldId: "user_world_semantic_unavailable",
  projects,
  activeProjectId: "project_alpha",
  now,
});
unavailableService.bootstrap();
const unavailable = submit(
  unavailableService,
  "semantic_runner_unavailable",
  "hey",
  {
    projectId: "project_alpha",
    bindingPosture: "ambient_focus",
  },
);
assert.equal(unavailable.receipt.remanded, true);
assert.equal(
  unavailable.projection.evidence.latestSettlement.taskType,
  "semantic_settlement_unavailable",
);
assert.equal(
  unavailable.projection.store.counts.managerContextCount,
  0,
);
assert.equal(
  unavailable.projection.store.counts.agentWorldCompilationCount,
  0,
);
assert.equal(
  unavailable.projection.worldPosture.semanticSettlement,
  "unavailable",
);
assert.equal(
  unavailable.projection.connectionPosture.semanticIngress,
  "unavailable",
);
unavailableService.close();

const productionSettlementSource = fs.readFileSync(
  path.resolve(
    "src/main/direct/worldmanager/settlement.js",
  ),
  "utf8",
);
for (const retiredLexicalSymbol of [
  "classifyTask",
  "isCasualConversationMessage",
  "isProjectInitializationMessage",
  "mentionedProjects",
]) {
  assert.equal(
    productionSettlementSource.includes(retiredLexicalSymbol),
    false,
    `${retiredLexicalSymbol} must remain outside production settlement`,
  );
}

fs.rmSync(rootDir, { recursive: true, force: true });
fs.rmSync(unavailableRoot, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      regression: "direct-world-manager-semantic-ingress",
      proofs: {
        semanticDischargeActionControlsSettlement: true,
        nativeActionSelectionRequired: true,
        novelSemanticSubtypePersistsWithoutRemand: true,
        projectSeedNeedsNoCreationVocabulary: true,
        ambientFocusDoesNotForceProjectScope: true,
        explicitScopeConflictRemands: true,
        mixedMeaningMaterializesDurableSemanticChildren: true,
        systemIntrospectionStaysAtWorldScope: true,
        projectEcologyStaysWorldGovernedWithBoundedSubjects:
          true,
        exactDecisionBindingSelectsDecisionMetaContract:
          true,
        semanticOnlyProjectDecisionStaysWorldGoverned:
          true,
        exactDecisionObjectImportedAcrossScope:
          true,
        runnerUnavailableHasNoLexicalFallback: true,
        typedSettlementPersistsWithoutRawPayloadOrReasoning: true,
        legacyStrictSettlementRecordsRemainReadable: true,
        productionLexicalClassifierRetired: true,
      },
      canonicalWriteGranted: false,
    },
    null,
    2,
  ),
);
