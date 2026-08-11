#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  conversationFixtureResult,
  createSemanticIngressFixture,
  projectFixtureResult,
  semanticIngressFixtureResult,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const {
  digestFor,
  stableId,
} = require("../src/main/direct/worldmanager/control-plane");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
} = require("../src/main/direct/worldmanager/semantic-history");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");

const projects = [
  {
    id: "project_alpha",
    name: "Project Alpha",
    summary: "Semantic-history regression project.",
  },
  {
    id: "project_beta",
    name: "Project Beta",
    summary: "Unrelated project scope witness.",
  },
];
let tick = Date.parse("2026-07-29T12:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};

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
  path.join(
    os.tmpdir(),
    "direct-world-manager-semantic-history-",
  ),
);
const semanticIngressRunner = createSemanticIngressFixture({
  overrides: {
    history_conversation: conversationFixtureResult({
      rationaleSummary:
        "This event belongs to world conversational continuity.",
    }),
    history_project: (input) =>
      projectFixtureResult(input, {
        projectId: "project_alpha",
        taskType: "project_planning",
        laneId: "project_deliberation",
        actionClasses: ["plan"],
        effectClasses: ["candidate_plan"],
        rationaleSummary:
          "This event belongs to Project Alpha planning.",
      }),
    history_introspection: semanticIngressFixtureResult({
      taskType: "world_conversation",
      laneAssignments: [{
        laneId: "system_introspection",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "Inspect the system through semantic-history evidence.",
      }],
      roleAssignments: [{
        role: "world_manager",
        scopeKind: "user_world",
      }],
      actionClasses: ["inspect_system_semantics"],
      effectClasses: ["none"],
      formulationDisposition:
        "answer_in_world_manager_turn",
      rationaleSummary:
        "Inspect the system through semantic-history evidence.",
      speechAct: "inspect",
    }),
  },
});
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const service = new DirectWorldManagerService({
  store,
  userWorldId:
    "user_world_semantic_history_regression",
  projects,
  activeProjectId: "project_beta",
  semanticIngressRunner,
  now,
});
service.bootstrap();

const conversation = submit(
  service,
  "history_conversation",
  "How are you today?",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);
const conversationEventId =
  conversation.receipt.semanticEventRef.id;
const originalConversationEvent =
  store.eventBySemanticEventId(conversationEventId);

const project = submit(
  service,
  "history_project",
  "Prepare a planning direction for Project Alpha.",
  {
    projectId: "project_alpha",
    bindingPosture: "explicit_constraint",
  },
);
const projectEventId =
  project.receipt.semanticEventRef.id;

const introspection = submit(
  service,
  "history_introspection",
  "Explain how the earlier interactions were classified.",
  {
    projectId: "project_beta",
    bindingPosture: "ambient_focus",
  },
);

assert.equal(
  introspection.projection.semanticHistory.state,
  "available",
);
assert.ok(
  introspection.projection.semanticHistory
    .currentSettlementRevisionCount >= 3,
);
assert.ok(
  introspection.projection.semanticHistory
    .activeRelationCount >= 7,
);
assert.ok(
  introspection.projection.semanticHistory
    .currentShelfCount >= 10,
);

const conversationRelations =
  store.listActiveSemanticHistoryRelations({
    semanticEventId: conversationEventId,
  });
assert.ok(conversationRelations.some((relation) =>
  relation.relationKind ===
    "conversational_continuity"));
assert.ok(conversationRelations.some((relation) =>
  relation.relationKind === "belongs_to_lane" &&
  relation.targetRef.id === "conversation"));
assert.ok(!conversationRelations.some((relation) =>
  relation.relationKind === "concerns_project"));

const projectRelations =
  store.listActiveSemanticHistoryRelations({
    semanticEventId: projectEventId,
  });
assert.ok(projectRelations.some((relation) =>
  relation.relationKind === "concerns_project" &&
  relation.targetRef.id === "project_alpha"));
assert.ok(projectRelations.some((relation) =>
  relation.relationKind === "continues_task" &&
  relation.targetRef.taskType === "project_planning"));

const continuityShelf = store.semanticShelf(
  "user_world_conversational_continuity",
  "user_world",
  "user_world_semantic_history_regression",
);
assert.ok(continuityShelf);
assert.ok(continuityShelf.sourceEventRefs.some((ref) =>
  ref.id === conversationEventId));
assert.ok(!continuityShelf.sourceEventRefs.some((ref) =>
  ref.id === projectEventId));

const projectShelf = store.semanticShelf(
  "project_durable_history",
  "project",
  "project_alpha",
);
assert.ok(projectShelf);
assert.ok(projectShelf.sourceEventRefs.some((ref) =>
  ref.id === projectEventId));
assert.ok(!projectShelf.sourceEventRefs.some((ref) =>
  ref.id === conversationEventId));

const introspectionWorld =
  store.agentWorldForSemanticEvent(
    introspection.receipt.semanticEventRef.id,
    { full: true },
  );
const historyEvidence =
  introspectionWorld.compilation.trustedEvidenceArtifacts
    .find((entry) =>
      entry.schema ===
        "direct_trusted_semantic_history_evidence@1");
assert.ok(historyEvidence);
assert.equal(
  historyEvidence.selectionMode,
  "semantic_shelf_horizon",
);
assert.equal(
  historyEvidence.rawChatHistoryImportedBlindly,
  false,
);
assert.ok(historyEvidence.payload.turns.some((turn) =>
  turn.semanticEventId === conversationEventId));
assert.ok(historyEvidence.payload.turns.some((turn) =>
  turn.semanticEventId === projectEventId));
assert.ok(historyEvidence.payload.turns.every((turn) =>
  Array.isArray(turn.relations) &&
  turn.relations.length > 0));

const currentProjectRevision =
  store.semanticSettlementRevisionForEvent(
    projectEventId,
  );
const correctedSettlement = {
  ...currentProjectRevision.semanticSettlement,
  semanticSettlementId: stableId(
    "wm_semantic_settlement",
    {
      semanticEventId: projectEventId,
      correction: "implementation_reclassification",
    },
  ),
  laneAssignments:
    currentProjectRevision.semanticSettlement
      .laneAssignments.map((assignment) => ({
        ...assignment,
        laneId: "project_execution_request",
      })),
  taskTypes: ["implementation_request"],
  actionClasses: ["implement"],
  effectClasses: ["workspace_mutation_candidate"],
  rationaleSummary:
    "Corrected after an audited semantic reclassification.",
  compilerVersion: "semantic_history_test_correction@1",
  createdAt: new Date(now()).toISOString(),
};
correctedSettlement.digest = digestFor(
  correctedSettlement.schema,
  correctedSettlement,
  ["digest"],
);
const correctionReasonRef = {
  kind: "semantic_history_correction_reason",
  id: "history_test_correction",
  digest: digestFor(
    "semantic-history-test-correction@1",
    { semanticEventId: projectEventId },
  ),
  label: "Regression correction",
  rawTextIncluded: false,
  rawPathIncluded: false,
  rawSecretIncluded: false,
};
const revisionResult =
  store.reviseSemanticHistorySettlement({
    semanticEventId: projectEventId,
    semanticSettlement: correctedSettlement,
    correctionReasonRefs: [correctionReasonRef],
    compilerVersion:
      "semantic_history_test_correction@1",
    createdAt: correctedSettlement.createdAt,
  });
assert.equal(revisionResult.reused, false);
assert.equal(
  revisionResult.revision.settlementRevision,
  2,
);
assert.equal(
  store.semanticSettlementRevisionForEvent(
    projectEventId,
  ).semanticSettlement.taskTypes[0],
  "implementation_request",
);
const relationHistory =
  store.listSemanticHistoryRelations({
    semanticEventId: projectEventId,
  });
assert.ok(relationHistory.some((record) =>
  record.currentState.lifecycle === "superseded"));
assert.ok(relationHistory.some((record) =>
  record.currentState.lifecycle === "active" &&
  record.relation.targetRef.taskType ===
    "implementation_request"));
assert.deepEqual(
  store.eventBySemanticEventId(conversationEventId),
  originalConversationEvent,
);
const shelfHistory = store.listSemanticShelves({
  shelfKind: "project_durable_history",
  currentOnly: false,
});
assert.ok(shelfHistory.some((shelf) =>
  shelf.shelfId === projectShelf.shelfId &&
  shelf.shelfRevision === projectShelf.shelfRevision &&
  shelf.currentState === "superseded"));
assert.ok(shelfHistory.some((shelf) =>
  shelf.shelfId === projectShelf.shelfId &&
  shelf.shelfRevision ===
    projectShelf.shelfRevision + 1 &&
  shelf.currentState === "current"));

const beforeRestartCounts = store.descriptor().counts;
service.close();
const reopenedStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
const reopenedService = new DirectWorldManagerService({
  store: reopenedStore,
  userWorldId:
    "user_world_semantic_history_regression",
  projects,
  activeProjectId: "project_beta",
  semanticIngressRunner,
  now,
});
reopenedService.bootstrap();
assert.equal(
  reopenedService.semanticHistoryReconstruction.changed,
  false,
);
assert.equal(
  reopenedStore.descriptor().counts
    .semanticSettlementRevisionCount,
  beforeRestartCounts.semanticSettlementRevisionCount,
);
assert.equal(
  reopenedStore.verifyLedger().ok,
  true,
);

// Remove only the derived semantic catalog and one contemporary ingress
// witness to simulate a pre-SC1/K2-only row. Reconstruction must remain
// explicitly provisional.
reopenedStore.db.exec(`
  delete from wm_semantic_shelves;
  delete from wm_semantic_history_relation_states;
  delete from wm_semantic_history_relations;
  delete from wm_semantic_settlement_revisions;
  delete from wm_semantic_ingress_runs
    where semantic_event_id = '${conversationEventId}';
`);
const legacyReconstruction =
  reopenedStore.reconstructSemanticHistory();
assert.ok(legacyReconstruction.changed);
const reconstructed =
  reopenedStore.semanticSettlementRevisionForEvent(
    conversationEventId,
  );
assert.equal(
  reconstructed.provenancePosture,
  "reconstructed",
);
assert.equal(reconstructed.confidence, "derived");
assert.equal(
  reconstructed.semanticSettlement.schema,
  RECONSTRUCTED_SEMANTIC_SETTLEMENT_SCHEMA,
);
assert.equal(
  reconstructed.semanticSettlement
    .reconstructionPosture,
  "provisional",
);
assert.equal(
  reconstructed.semanticSettlement.grantsAuthority,
  false,
);

reopenedService.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-semantic-history",
  proofs: {
    oneEventCanOccupySeveralSemanticHistories: true,
    worldAndProjectShelvesRemainDistinct: true,
    semanticShelfHorizonReplacesBlindPriorRowImport: true,
    correctionSupersedesRelationsWithoutMutatingRawEvent: true,
    affectedShelvesRebuildWithImmutableHistory: true,
    restartPreservesCurrentCatalog: true,
    legacyK2HistoryIsExplicitlyProvisional: true,
    semanticHistoryGrantsNoAuthority: true,
  },
}, null, 2));
