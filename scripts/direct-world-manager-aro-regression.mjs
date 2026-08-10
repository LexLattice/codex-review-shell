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
  DirectWorldManagerService,
} = require(
  "../src/main/direct/worldmanager/service",
);
const {
  buildAroReconstructionCandidate,
  validateAbstractReasoningObject,
  validateAroCurrentTargetComparison,
  validateAroReconstructionCandidate,
} = require(
  "../src/main/direct/worldmanager/aro-kernel",
);

let tick = Date.parse(
  "2026-07-30T09:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const exactRef = (
  kind,
  id,
  revision,
) => ({
  kind,
  id,
  digest: digestFor(
    `fixture-${kind}@1`,
    {
      id,
      revision,
    },
  ),
});

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc7-",
  ),
);
const store =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });

store.ensureBootstrap({
  userWorldId: "user_world_sc7",
  projects: [{
    id: "project_sc7",
    name: "SC7 ARO Studio",
    summary:
      "Semantic implementation anatomy fixture.",
    runtimePath: "direct",
  }],
});
const ingress = store.appendUserIngress({
  schema:
    "direct_world_manager_submit_request@1",
  clientRequestId: "sc7_ingress_1",
  text:
    "Reconstruct the abstract object realized by the semantic workbench.",
  scopeHint: {
    projectId: "project_sc7",
  },
  expectedProjectionRevision: null,
  attachmentDraftRefs: [],
});

const repositorySnapshotRef = exactRef(
  "repository_snapshot",
  "repo_sc7",
  "head-1",
);
const rendererSourceV1 = exactRef(
  "source_file",
  "src/renderer/world-manager-surface.js",
  "v1",
);
const rendererSourceV2 = exactRef(
  "source_file",
  "src/renderer/world-manager-surface.js",
  "v2",
);
const rendererTest = exactRef(
  "test_file",
  "scripts/direct-world-manager-aro-ui-regression.mjs",
  "v1",
);
const designSpec = exactRef(
  "documentation",
  "docs/DIRECT_WORLD_MANAGER_SEMANTIC_CONTEXT_ARO_AND_THOUGHT_TOOLS_DESIGN.md",
  "sc7",
);
const contradiction = exactRef(
  "semantic_contradiction",
  "compact-default-vs-inspection-depth",
  "v1",
);

function candidateFor(posture) {
  const target =
    posture === "target";
  return buildAroReconstructionCandidate({
    projectId: "project_sc7",
    repositorySnapshotRef,
    sourceSemanticEventRef: {
      kind:
        "world_manager_semantic_event",
      id: ingress.event.semanticEventId,
      digest: ingress.event.eventDigest,
    },
    evidenceRefs: [
      rendererSourceV1,
      rendererTest,
      designSpec,
    ],
    contradictionRefs:
      target ? [] : [contradiction],
    createdAt:
      new Date(now()).toISOString(),
    now,
    candidateAro: {
      projectId: "project_sc7",
      conceptKey:
        "semantic_implementation_anatomy",
      semanticIdentity:
        "Semantic implementation anatomy",
      purpose:
        target
          ? "Make the abstract object primary and code a subordinate realization with explicit current/target deltas."
          : "Expose the abstract object currently realized by the semantic workbench.",
      posture,
      branches: [
        {
          branchKey: "coherent_identity",
          branchKind:
            "semantic_invariant",
          modality: "required",
          statement:
            "One semantic object preserves identity across every projection.",
          semanticState: "supported",
          provenanceRefs: [designSpec],
        },
        {
          branchKey:
            "progressive_transparency",
          parentBranchKey:
            "coherent_identity",
          branchKind:
            "experience_requirement",
          modality: "required",
          statement: target
            ? "Progressive transparency exposes ARO branches, realization coverage, and current/target deltas."
            : "Progressive transparency exposes typed semantic surfaces.",
          semanticState: "supported",
          provenanceRefs: [
            designSpec,
            rendererSourceV1,
          ],
        },
        ...(target
          ? [{
              branchKey:
                "current_target_delta",
              parentBranchKey:
                "coherent_identity",
              branchKind:
                "trajectory_requirement",
              modality: "required",
              statement:
                "Current and target AROs expose shared, exclusive, and conflicting branches.",
              semanticState: "missing",
              provenanceRefs: [
                designSpec,
              ],
            }]
          : []),
        {
          branchKey:
            "compact_default_failure",
          parentBranchKey:
            "progressive_transparency",
          branchKind:
            "counterfactual_edge",
          modality: "counterfactual",
          statement:
            "If compact presentation hides a relevant semantic gap, same-context inspection must remain available.",
          condition:
            "A compact projection suppresses a relevant ARO relation.",
          expectedOutcome:
            "The user opens the exact object without reconstructing its reference in chat.",
          semanticState:
            target ? "supported" : "unknown",
          provenanceRefs: [
            contradiction,
          ],
        },
      ],
      edges: [
        {
          fromBranchKey:
            "coherent_identity",
          toBranchKey:
            "progressive_transparency",
          relationKind: "requires",
          rationale:
            "Transparency is useful only when semantic identity is stable.",
        },
        {
          fromBranchKey:
            "compact_default_failure",
          toBranchKey:
            "progressive_transparency",
          relationKind:
            "counterfactual_of",
          rationale:
            "The failure branch defines the required escape hatch.",
        },
      ],
      realizationBindings: [
        {
          branchKey:
            "coherent_identity",
          realizationKind: "source",
          locator:
            "semantic object surface identity and exact region binding",
          sourceRef: rendererSourceV1,
          coverageState: "realized",
          evidenceRefs: [rendererSourceV1],
          observedRevisionRef:
            repositorySnapshotRef,
        },
        {
          branchKey:
            "progressive_transparency",
          realizationKind: "source",
          locator:
            "ODEU lens and morph rendering",
          sourceRef: rendererSourceV1,
          coverageState: "realized",
          evidenceRefs: [rendererSourceV1],
          observedRevisionRef:
            repositorySnapshotRef,
        },
        {
          branchKey:
            "progressive_transparency",
          realizationKind: "test",
          locator:
            "responsive semantic-surface regression",
          sourceRef: rendererTest,
          coverageState: "realized",
          evidenceRefs: [rendererTest],
          observedRevisionRef:
            repositorySnapshotRef,
        },
      ],
      provenanceRefs: [
        designSpec,
        repositorySnapshotRef,
      ],
    },
  });
}

const currentCandidate =
  candidateFor("current");
const targetCandidate =
  candidateFor("target");
validateAroReconstructionCandidate(
  currentCandidate,
);
validateAroReconstructionCandidate(
  targetCandidate,
);

store.registerAroReconstructionCandidate({
  candidate: currentCandidate,
});
store.registerAroReconstructionCandidate({
  candidate: targetCandidate,
});

const project = () =>
  buildWorldManagerWorkbenchProjection({
    ...store.snapshotData(),
    pipelineStage: "wm_k6_genesis",
    semanticIngressAvailable: true,
    workThreads: [],
  });

const candidateProjection = project();
if (
  process.env
    .CODEX_WORLD_MANAGER_SC7_CANDIDATE_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC7_CANDIDATE_PROJECTION_PATH,
    JSON.stringify(
      candidateProjection,
      null,
      2,
    ),
  );
}
assert.equal(
  candidateProjection.aroRegistry
    .candidateCount,
  2,
);
assert.equal(
  candidateProjection.aroRegistry
    .canonicalAroCount,
  0,
);
assert.equal(
  candidateProjection.aroRegistry
    .admissionMutatesCode,
  false,
);
const candidateSurfaces =
  candidateProjection.semanticSurface
    .objectSurfaces.filter((surface) =>
      surface.objectClass ===
        "aro_reconstruction_candidate");
assert.equal(candidateSurfaces.length, 2);
assert.ok(candidateSurfaces.every(
  (surface) =>
    surface.morph.family ===
      "comparison" &&
    surface.interaction.commitAction
      .available === false,
));

assert.throws(
  () =>
    store.admitAroReconstructionCandidate({
      candidateId:
        currentCandidate.candidateId,
      candidateDigest:
        currentCandidate.digest,
      expectedCandidateRevision: 1,
    }),
  (error) =>
    error.code ===
      "aro_candidate_admission_gate_blocked",
);
assert.throws(
  () =>
    store
      .reviewAroReconstructionCandidate({
        candidateId:
          currentCandidate.candidateId,
      }),
  (error) =>
    error.code ===
      "world_manager_aro_candidate_revision_conflict",
);

const service = new DirectWorldManagerService({
  store,
  userWorldId: "user_world_sc7",
  projects: [{
    id: "project_sc7",
    name: "SC7 ARO Studio",
    summary:
      "Semantic implementation anatomy fixture.",
    runtimePath: "direct",
  }],
  activeProjectId: "project_sc7",
  now,
});
service.bootstrap();
assert.throws(
  () =>
    service
      .reviewAroReconstructionCandidate({
        candidateId:
          currentCandidate.candidateId,
        candidateDigest:
          currentCandidate.digest,
        expectedCandidateRevision: 1,
      }),
  (error) =>
    error.code ===
      "world_manager_aro_region_binding_required",
);
const serviceCandidateProjection =
  service.snapshot();
const serviceCandidateSurface =
  serviceCandidateProjection
    .semanticSurface.objectSurfaces
    .find((surface) =>
      surface.objectClass ===
        "aro_reconstruction_candidate" &&
      surface.subjectRef.id ===
        currentCandidate.candidateId);
const serviceCandidateBinding =
  serviceCandidateProjection
    .semanticSurface.regionBindings
    .find((binding) =>
      binding.subjectRef.id ===
        currentCandidate.candidateId &&
      binding.selectedLens ===
        serviceCandidateSurface.defaultLens);
const reviewResult =
  service.reviewAroReconstructionCandidate({
    candidateId:
      currentCandidate.candidateId,
    candidateDigest:
      currentCandidate.digest,
    expectedCandidateRevision: 1,
    actorId: "operator",
    semanticRegionBindingRef: {
      kind: "semantic_region_binding",
      id:
        serviceCandidateBinding
          .semanticRegionBindingId,
      digest:
        serviceCandidateBinding.digest,
    },
  });
assert.equal(
  reviewResult.receipt
    .semanticTruthValidated,
  false,
);
const reviewedCurrent =
  store.aroReconstructionCandidateById(
    currentCandidate.candidateId,
  );
assert.equal(
  reviewedCurrent.candidateRevision,
  2,
);
const reviewedProjection = project();
if (
  process.env
    .CODEX_WORLD_MANAGER_SC7_REVIEWED_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC7_REVIEWED_PROJECTION_PATH,
    JSON.stringify(
      reviewedProjection,
      null,
      2,
    ),
  );
}
const reviewedSurface =
  reviewedProjection.semanticSurface
    .objectSurfaces.find((surface) =>
      surface.subjectRef.id ===
        currentCandidate.candidateId);
assert.equal(
  reviewedSurface.interaction
    .commitAction.available,
  true,
);

const admittedCurrent =
  service.admitAroReconstructionCandidate({
    candidateId:
      currentCandidate.candidateId,
    candidateDigest:
      reviewedCurrent.digest,
    expectedCandidateRevision: 2,
    actorId: "operator",
    semanticRegionBindingRef: (() => {
      const snapshot =
        service.snapshot();
      const surface =
        snapshot.semanticSurface
          .objectSurfaces.find(
            (candidateSurface) =>
              candidateSurface
                .objectClass ===
                  "aro_reconstruction_candidate" &&
              candidateSurface
                .subjectRef.id ===
                  currentCandidate
                    .candidateId,
          );
      const binding =
        snapshot.semanticSurface
          .regionBindings.find(
            (entry) =>
              entry.subjectRef.id ===
                currentCandidate
                  .candidateId &&
              entry.selectedLens ===
                surface.defaultLens,
          );
      return {
        kind:
          "semantic_region_binding",
        id:
          binding
            .semanticRegionBindingId,
        digest: binding.digest,
      };
    })(),
  });
const admittedCurrentAro =
  store.abstractReasoningObjectById(
    admittedCurrent.receipt.aroRef.id,
  );
validateAbstractReasoningObject(
  admittedCurrentAro,
);
assert.equal(
  admittedCurrentAro.canonical,
  true,
);
assert.equal(
  admittedCurrent.receipt
    .codeMutationExecuted,
  false,
);
assert.equal(
  admittedCurrent.receipt
    .downstreamEffectsExecuted,
  false,
);
const reusedAdmission =
  store.admitAroReconstructionCandidate({
    candidateId:
      currentCandidate.candidateId,
    candidateDigest:
      reviewedCurrent.digest,
    expectedCandidateRevision: 2,
    actorId: "operator",
  });
assert.equal(
  reusedAdmission.reused,
  true,
);

const reviewedTarget =
  store.reviewAroReconstructionCandidate({
    candidateId:
      targetCandidate.candidateId,
    candidateDigest:
      targetCandidate.digest,
    expectedCandidateRevision: 1,
    actorId: "operator",
  });
const admittedTarget =
  store.admitAroReconstructionCandidate({
    candidateId:
      targetCandidate.candidateId,
    candidateDigest:
      reviewedTarget.candidate.digest,
    expectedCandidateRevision: 2,
    actorId: "operator",
  });
assert.equal(
  admittedTarget.aro.posture,
  "target",
);

const admittedProjection = project();
if (
  process.env
    .CODEX_WORLD_MANAGER_SC7_ADMITTED_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC7_ADMITTED_PROJECTION_PATH,
    JSON.stringify(
      admittedProjection,
      null,
      2,
    ),
  );
}
assert.equal(
  admittedProjection.aroRegistry
    .canonicalAroCount,
  2,
);
assert.equal(
  admittedProjection.aroRegistry
    .currentTargetComparisons.length,
  1,
);
const comparison =
  admittedProjection.aroRegistry
    .currentTargetComparisons[0];
validateAroCurrentTargetComparison(
  comparison,
);
assert.equal(
  comparison.targetOnlyBranchRefs.length,
  1,
);
assert.equal(
  comparison.conflictPairs.length,
  2,
);
assert.ok(
  admittedProjection.semanticSurface
    .objectSurfaces.some((surface) =>
      surface.objectClass ===
        "abstract_reasoning_object" &&
      surface.morph.family === "tree"),
);
assert.ok(
  admittedProjection.semanticSurface
    .objectSurfaces.some((surface) =>
      surface.objectClass ===
        "aro_coverage_witness" &&
      surface.morph.family === "graph"),
);
assert.ok(
  admittedProjection.semanticSurface
    .objectSurfaces.some((surface) =>
      surface.objectClass ===
        "aro_current_target_comparison" &&
      surface.morph.family ===
        "comparison"),
);

const stale = store.markAroRealizationsStale({
  aroId: admittedCurrentAro.aroId,
  aroDigest: admittedCurrentAro.digest,
  expectedAroRevision:
    admittedCurrentAro.revision,
  changedSourceRefs: [
    rendererSourceV2,
  ],
});
assert.equal(stale.reused, false);
assert.equal(stale.aro.revision, 2);
assert.equal(stale.aro.lifecycle, "stale");
assert.ok(
  stale.aro.realizationBindings
    .filter((binding) =>
      binding.sourceRef.id ===
        rendererSourceV1.id)
    .every((binding) =>
      binding.coverageState ===
        "stale"),
);

const storePath = store.filePath;
store.close();
const restarted =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
assert.equal(
  restarted
    .listAbstractReasoningObjects()
    .length,
  2,
);
assert.equal(
  restarted
    .listAroReconstructionCandidates()
    .filter((candidate) =>
      candidate.lifecycle ===
        "admitted").length,
  2,
);
assert.equal(
  restarted
    .listAroReviewReceipts().length,
  2,
);
assert.equal(
  restarted
    .listAroAdmissionReceipts().length,
  2,
);
assert.equal(
  restarted.verifyLedger().ok,
  true,
);

const outputPath =
  process.env
    .CODEX_WORLD_MANAGER_SC7_PROJECTION_PATH;
if (outputPath) {
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      buildWorldManagerWorkbenchProjection({
        ...restarted.snapshotData(),
        pipelineStage:
          "wm_k6_genesis",
        semanticIngressAvailable: true,
        workThreads: [],
      }),
      null,
      2,
    ),
  );
}
restarted.close();

console.log(
  JSON.stringify({
    ok: true,
    storePath,
    candidates: 2,
    canonicalAros: 2,
    targetOnlyBranches:
      comparison.targetOnlyBranchRefs
        .length,
    conflicts:
      comparison.conflictPairs.length,
    staleRevision:
      stale.aro.revision,
  }),
);
