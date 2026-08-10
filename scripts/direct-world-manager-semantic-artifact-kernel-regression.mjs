#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildWorldManagerWorkbenchProjection,
  digestFor,
} = require(
  "../src/main/direct/worldmanager/control-plane",
);
const {
  DirectWorldManagerControlPlaneStore,
} = require(
  "../src/main/direct/worldmanager/control-plane-store",
);
const {
  DECISION_RESOLUTION_MODES,
  buildOpenDecision,
  reviseOpenDecision,
  semanticArtifactRef,
  validateOpenDecision,
  validateOpenDecisionRevision,
} = require(
  "../src/main/direct/worldmanager/semantic-artifact-kernel",
);

let tick = Date.parse("2026-07-29T16:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};

for (const mode of DECISION_RESOLUTION_MODES) {
  const decision = buildOpenDecision({
    sourceKind: "fixture",
    sourceKey: `mode:${mode}`,
    question: `Exercise ${mode}.`,
    resolutionMode: mode,
    options:
      mode === "mechanical"
        ? [{
            optionKey: "accept",
            label: "Accept",
          }]
        : [],
    dependencies: [{
      dependencyKind: "fixture_evidence",
      requirement: "Fixture evidence must remain visible.",
      state: "satisfied",
    }],
    consequences: [{
      effectClass: "fixture_state",
      description: "The fixture state may change later.",
      posture: "possible",
    }],
    now,
  });
  validateOpenDecision(decision);
  assert.equal(decision.resolutionMode, mode);
  assert.equal(
    decision.resolutionContract.executionAuthorityGranted,
    false,
  );
  assert.equal(decision.grantsAuthority, false);
}

const active = buildOpenDecision({
  sourceKind: "fixture",
  sourceKey: "revision_lineage",
  question: "Which lifecycle applies?",
  resolutionMode: "semantic_relay",
  now,
});
const stale = reviseOpenDecision(active, {
  decisionState: "stale",
  sourceStateDigest: digestFor(
    "fixture-source-state@1",
    { state: "stale" },
  ),
  now,
});
validateOpenDecisionRevision(active, stale);
assert.equal(stale.header.revision, 2);
assert.equal(stale.header.lifecycle, "stale");
assert.equal(
  stale.header.predecessorRef.digest,
  active.digest,
);
const conflicted = reviseOpenDecision(stale, {
  decisionState: "conflicted",
  sourceStateDigest: digestFor(
    "fixture-source-state@1",
    { state: "conflicted" },
  ),
  now,
});
validateOpenDecisionRevision(stale, conflicted);
assert.equal(conflicted.header.lifecycle, "conflicted");
const resolved = reviseOpenDecision(conflicted, {
  decisionState: "resolved",
  resolutionRef: {
    kind: "fixture_resolution",
    id: "fixture_resolution_1",
    digest: digestFor(
      "fixture-resolution@1",
      { selected: true },
    ),
  },
  sourceStateDigest: digestFor(
    "fixture-source-state@1",
    { state: "resolved" },
  ),
  now,
});
validateOpenDecisionRevision(conflicted, resolved);
assert.equal(resolved.header.lifecycle, "resolved");
const replacement = buildOpenDecision({
  sourceKind: "fixture",
  sourceKey: "replacement_lineage",
  question: "Replacement decision",
  resolutionMode: "semantic_relay",
  now,
});
const superseded = reviseOpenDecision(resolved, {
  decisionState: "superseded",
  supersededByRef:
    semanticArtifactRef(replacement),
  sourceStateDigest: digestFor(
    "fixture-source-state@1",
    { state: "superseded" },
  ),
  now,
});
validateOpenDecisionRevision(resolved, superseded);
assert.equal(
  superseded.header.lifecycle,
  "superseded",
);
assert.equal(
  superseded.header.supersededByRef.id,
  replacement.decisionId,
);

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc3-",
  ),
);
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
store.ensureBootstrap({
  userWorldId: "user_world_sc3",
  projects: [{
    id: "project_sc3",
    name: "SC3 Project",
    summary: "Typed semantic decision fixture.",
    runtimePath: "direct",
  }],
});
const ingress = store.appendUserIngress({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "sc3_ingress_1",
  text: "Initialize the SC3 project.",
  scopeHint: {
    projectId: "project_sc3",
  },
  expectedProjectionRevision: null,
  attachmentDraftRefs: [],
});
const latestIngress = store.appendUserIngress({
  schema: "direct_world_manager_submit_request@1",
  clientRequestId: "sc3_ingress_2",
  text: "A newer clarification boundary.",
  scopeHint: {
    projectId: "",
  },
  expectedProjectionRevision: null,
  attachmentDraftRefs: [],
});
const candidate = {
  schema: "direct_project_constitution_candidate@1",
  candidateId: "candidate_sc3",
  artifactKind: "project_constitution",
  lineageRootId: ingress.event.lineageRootId,
  proposedProjectId: "project_sc3",
  identity: "SC3 Project",
  purpose: "Exercise typed decisions.",
  openDecisions: [
    "Choose the workspace root.",
    {
      decisionId: "testing_policy",
      question: "Which test posture applies?",
      resolutionMode: "mechanical",
      options: [
        {
          optionKey: "focused",
          label: "Focused tests",
        },
        {
          optionKey: "full",
          label: "Full suite",
        },
      ],
      dependencies: [{
        dependencyKind: "repository_shape",
        requirement: "Repository shape is known.",
        state: "unknown",
      }],
      consequences: [{
        effectClass: "verification_budget",
        description: "The selected test posture changes verification cost.",
      }],
    },
  ],
  lifecycle: "candidate",
  createdAt: new Date(now()).toISOString(),
  digest: digestFor(
    "direct_project_constitution_candidate@1",
    { candidateId: "candidate_sc3", revision: 1 },
  ),
};
store.db.prepare(`
  insert into wm_candidate_artifacts (
    artifact_id, artifact_kind, lineage_root_id, project_id,
    revision, lifecycle, artifact_json, artifact_digest,
    created_at, superseded_by_id
  ) values (?, ?, ?, ?, 1, 'candidate', ?, ?, ?, '')
`).run(
  candidate.candidateId,
  candidate.artifactKind,
  candidate.lineageRootId,
  candidate.proposedProjectId,
  JSON.stringify(candidate),
  candidate.digest,
  candidate.createdAt,
);
store.db.prepare(`
  insert into wm_decisions (
    decision_request_id, semantic_event_id,
    target_artifact_ref_json, decision_kind, state,
    authority_requirements_json, decision_ref_json
  ) values (?, ?, ?, ?, ?, ?, '{}')
`).run(
  "decision_admit_sc3",
  ingress.event.semanticEventId,
  JSON.stringify({
    kind: "project_constitution_candidate",
    id: candidate.candidateId,
    digest: candidate.digest,
    projectId: candidate.proposedProjectId,
  }),
  "project_constitution_admission",
  "pending",
  JSON.stringify({
    requiredActorRole: "operator",
    evidenceReviewRequired: true,
    reconciliationRequired: true,
    exactCandidateRefRequired: true,
  }),
);
const insertClarification = store.db.prepare(`
  insert into wm_decisions (
    decision_request_id, semantic_event_id,
    target_artifact_ref_json, decision_kind, state,
    authority_requirements_json, decision_ref_json
  ) values (?, ?, ?, 'clarification', 'clarification_required', ?, ?)
`);
for (const [id, event] of [
  ["clarification_stale_sc3", ingress.event],
  ["clarification_current_sc3", latestIngress.event],
]) {
  insertClarification.run(
    id,
    event.semanticEventId,
    JSON.stringify({
      kind: "world_manager_task_settlement",
      id: `settlement_${id}`,
      digest: digestFor(
        "fixture-settlement@1",
        { id },
      ),
    }),
    JSON.stringify({
      responseAuthority: "user_only",
      grantsAuthority: false,
    }),
    JSON.stringify({
      kind: "world_manager_clarification",
      id,
      digest: digestFor(
        "fixture-clarification@1",
        { id },
      ),
    }),
  );
}

const firstSync =
  store.synchronizeSemanticDecisionKernel();
assert.equal(firstSync.changed, 5);
assert.equal(firstSync.artifactCount, 5);
const current = store.listSemanticArtifacts({
  artifactKind: "open_decision",
});
assert.equal(current.length, 5);
assert.deepEqual(
  new Set(current.map((decision) =>
    decision.resolutionMode)),
  new Set([
    "semantic_relay",
    "mechanical",
    "authority_request",
  ]),
);
assert.equal(
  current.filter((decision) =>
    decision.decisionState === "stale").length,
  1,
);
assert.equal(
  current.find((decision) =>
    decision.sourceKey ===
      "clarification_current_sc3")
    .decisionState,
  "open",
);
assert.ok(current.every((decision) =>
  decision.canonical === true &&
  decision.grantsAuthority === false));
const shelf = store.semanticShelf(
  "project_open_decisions",
  "project",
  "project_sc3",
);
assert.ok(shelf);
assert.equal(shelf.semanticObjectRefs.length, 3);
assert.ok(shelf.semanticObjectRefs.every((ref) =>
  ref.kind === "open_decision"));
const projection =
  buildWorldManagerWorkbenchProjection({
    ...store.snapshotData(),
    pipelineStage: "wm_k6_genesis",
    semanticIngressAvailable: true,
    workThreads: [],
  });
assert.equal(
  projection.decisionSummary
    .migrationPosture,
  "sc3_canonical_registry",
);
assert.equal(
  projection.decisionSummary
    .actionRequiredCount,
  4,
);
assert.equal(
  projection.decisionSummary
    .staleDecisions.length,
  1,
);
assert.equal(
  projection.semanticArtifactKernel
    .staleDecisionCount,
  1,
);
assert.ok(
  projection.decisionSummary
    .openDecisions.every((decision) =>
      decision.canonical === true &&
      decision.grantsAuthority === false),
);

const secondSync =
  store.synchronizeSemanticDecisionKernel();
assert.equal(secondSync.changed, 0);
assert.equal(secondSync.reused, 5);

store.db.prepare(`
  update wm_decisions
  set state = 'admitted',
      decision_ref_json = ?
  where decision_request_id = ?
`).run(
  JSON.stringify({
    kind: "project_constitution_admission",
    id: "admission_sc3",
    digest: digestFor(
      "project-constitution-admission@1",
      { candidateId: candidate.candidateId },
    ),
  }),
  "decision_admit_sc3",
);
const resolutionSync =
  store.synchronizeSemanticDecisionKernel();
assert.equal(resolutionSync.changed, 1);
const admissionHistory =
  store.listSemanticArtifacts({
    currentOnly: false,
    artifactKind: "open_decision",
  }).filter((decision) =>
    decision.sourceKey === "decision_admit_sc3");
assert.equal(admissionHistory.length, 2);
assert.equal(
  admissionHistory.at(-1).decisionState,
  "resolved",
);
assert.equal(
  admissionHistory.at(-1).header.revision,
  2,
);
assert.equal(
  store.semanticShelf(
    "project_open_decisions",
    "project",
    "project_sc3",
  ).semanticObjectRefs.length,
  2,
);
assert.equal(
  store.descriptor().counts.openDecisionArtifactCount,
  3,
);

store.close();
const restarted =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
const restartSync =
  restarted.synchronizeSemanticDecisionKernel();
assert.equal(restartSync.changed, 0);
assert.equal(
  restarted.listSemanticArtifacts().length,
  5,
);
restarted.close();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  regression:
    "direct-world-manager-semantic-artifact-kernel",
  proofs: {
    fourResolutionModesTyped: true,
    appendOnlyDecisionRevisions: true,
    staleConflictResolutionStates: true,
    supersessionReferencesExactReplacement: true,
    managerOpenDecisionsMigrated: true,
    legacyWmDecisionsMigrated: true,
    projectOpenDecisionShelfBound: true,
    typedDecisionProjectionIsCanonicalAndNonAuthoritative: true,
    resolvedDecisionsLeaveOpenShelf: true,
    historicalClarificationsBecomeStale: true,
    restartMigrationIdempotent: true,
    semanticObjectsGrantNoAuthority: true,
  },
}, null, 2));
