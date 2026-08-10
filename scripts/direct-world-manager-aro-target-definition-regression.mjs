#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ARO_TARGET_DEFINITION_ACTION,
  DirectAroTargetDefinitionRuntime,
  validateAroTargetDefinitionRun,
} = require(
  "../src/main/direct/worldmanager/aro-target-definition",
);
const {
  buildAbstractReasoningObject,
} = require(
  "../src/main/direct/worldmanager/aro-kernel",
);
const {
  buildRepositorySemanticSnapshot,
} = require(
  "../src/main/direct/worldmanager/aro-reconstruction-runtime",
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

let tick = Date.parse(
  "2026-07-30T20:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const project = {
  id: "project_sc72",
  name: "SC7.2 Target Studio",
  summary:
    "Define target semantic posture before compiling implementation intent.",
  runtimePath: "direct",
  workspaceKind: "local",
};

const currentAro =
  buildAbstractReasoningObject({
    projectId: project.id,
    conceptKey:
      "semantic_anatomy_workbench",
    semanticIdentity:
      "Semantic anatomy workbench",
    purpose:
      "Expose reconstructed semantic objects as a static inspection stack.",
    posture: "current",
    lifecycle: "active",
    canonical: true,
    branches: [
      {
        branchKey:
          "stable_semantic_identity",
        branchKind:
          "semantic_invariant",
        modality: "required",
        statement:
          "Each visible region preserves the exact identity of its semantic object.",
        semanticState: "supported",
        provenanceRefs: [],
      },
      {
        branchKey:
          "static_vertical_stack",
        parentBranchKey:
          "stable_semantic_identity",
        branchKind:
          "current_limitation",
        modality: "possible",
        statement:
          "All semantic objects remain visible in one long static vertical stack.",
        semanticState: "supported",
        provenanceRefs: [],
      },
    ],
    edges: [],
    realizationBindings: [],
    provenanceRefs: [],
    createdAt:
      new Date(now()).toISOString(),
    now,
  });

const targetIntent =
  "Turn the semantic anatomy workbench into a focused object navigator. Preserve exact object identity, keep non-focused objects concise, and make the active object’s evidence and lawful actions primary. Include the counterfactual where focus cannot be resolved.";

function validAction() {
  return {
    actionCalls: [{
      callId:
        "call_sc72_target",
      name:
        ARO_TARGET_DEFINITION_ACTION,
      argumentsJson:
        JSON.stringify({
          targetSemanticIdentity:
            "Focused semantic anatomy workbench",
          targetPurpose:
            "Let the operator navigate many semantic objects while concentrating evidence and lawful action on one exact focused object.",
          definitionRationale:
            "The target preserves object identity while replacing a static stack with progressive focus.",
          branches: [
            {
              branchKey:
                "stable_semantic_identity",
              parentBranchKey: "",
              branchKind:
                "semantic_invariant",
              modality: "required",
              statement:
                "Every navigator entry and focused region preserves one exact semantic object identity.",
              condition: "",
              expectedOutcome:
                "Changing presentation depth never changes the referenced semantic object.",
              semanticState:
                "supported",
              currentBranchKeys: [
                "stable_semantic_identity",
              ],
            },
            {
              branchKey:
                "focused_object_navigation",
              parentBranchKey:
                "stable_semantic_identity",
              branchKind:
                "interaction_requirement",
              modality: "required",
              statement:
                "The operator can focus one semantic object from a concise navigator.",
              condition:
                "More than one semantic object is available.",
              expectedOutcome:
                "The focused object receives the primary evidence and action surface.",
              semanticState: "missing",
              currentBranchKeys: [],
            },
            {
              branchKey:
                "unresolved_focus_fallback",
              parentBranchKey:
                "focused_object_navigation",
              branchKind:
                "focus_counterfactual",
              modality:
                "counterfactual",
              statement:
                "If an exact focus cannot be resolved, the workbench exposes the ambiguity instead of guessing.",
              condition:
                "The selected semantic reference is absent or stale.",
              expectedOutcome:
                "No action is bound to a different object.",
              semanticState: "unknown",
              currentBranchKeys: [
                "stable_semantic_identity",
              ],
            },
          ],
          edges: [
            {
              fromBranchKey:
                "focused_object_navigation",
              toBranchKey:
                "stable_semantic_identity",
              relationKind: "requires",
              rationale:
                "Navigation is lawful only when exact identity is preserved.",
            },
            {
              fromBranchKey:
                "unresolved_focus_fallback",
              toBranchKey:
                "focused_object_navigation",
              relationKind:
                "counterfactual_of",
              rationale:
                "The fallback governs the failed-focus branch.",
            },
          ],
          assumptions: [
            "The semantic registry remains the single source of truth.",
          ],
          unresolvedQuestions: [
            "Which navigator ordering should become the default?",
          ],
        }),
    }],
    telemetry: {
      runtimeMode: "fixture",
      model: "fixture-model",
      reasoningEffort: "medium",
      inputTokens: 700,
      outputTokens: 420,
      toolCallCount: 1,
      toolNames: [
        ARO_TARGET_DEFINITION_ACTION,
      ],
      telemetrySource:
        "fixture_observed",
    },
  };
}

let runtimeCalls = 0;
const runtime =
  new DirectAroTargetDefinitionRuntime({
    runner: async (request) => {
      runtimeCalls += 1;
      assert.equal(
        request.sourceInspectionEffect,
        false,
      );
      assert.equal(
        request.realizationBindingEffect,
        false,
      );
      assert.equal(
        request.canonicalAdmissionEffect,
        false,
      );
      assert.equal(
        request.mutationContractEffect,
        false,
      );
      assert.equal(
        request.workerLaunchEffect,
        false,
      );
      assert.equal(
        request.workspaceMutationEffect,
        false,
      );
      assert.equal(request.tools.length, 1);
      assert.match(
        request.prompt,
        /USER-AUTHORED TARGET INTENT/,
      );
      if (runtimeCalls === 3) {
        assert.equal(
          request.targetBaselineRef
            ?.kind,
          "abstract_reasoning_object",
        );
        assert.match(
          request.prompt,
          /EXISTING CANONICAL TARGET BASELINE/,
        );
      }
      return validAction();
    },
    now,
  });

const repositorySnapshot =
  buildRepositorySemanticSnapshot({
    projectId: project.id,
    observation: {
      projectId: project.id,
      workspaceKind: "local",
      gitAvailable: true,
      headOid: "fixture-head",
      branch: "main",
      dirtyPathCount: 0,
      manifestDigest:
        "sha256:fixture-manifest",
      trackedFileCount: 1,
      manifestTruncated: false,
      manifestPaths: ["README.md"],
      evidence: [{
        evidenceKey: "readme",
        evidenceKind:
          "documentation",
        relativePath: "README.md",
        digest:
          "sha256:fixture-readme",
        excerpt:
          "Static semantic anatomy fixture.",
        excerptTruncated: false,
        sizeBytes: 35,
      }],
      evidenceCatalogComplete: true,
      observationState: "observed",
      observedAt:
        new Date(now()).toISOString(),
    },
    now,
  });

const directResult =
  await runtime.run({
    projectId: project.id,
    project,
    currentAro,
    targetIntent,
    repositorySnapshotRef: {
      kind: "repository_snapshot",
      id:
        repositorySnapshot.snapshotId,
      digest:
        repositorySnapshot
          .snapshotDigest,
      projectId: project.id,
    },
    attempt: 1,
  });
assert.equal(directResult.state, "completed");
assert.equal(
  directResult.candidate
    .reconstructionMethod,
  "semantic_target_definition",
);
assert.equal(
  directResult.candidate
    .candidateAro.posture,
  "target",
);
assert.equal(
  directResult.candidate
    .candidateAro.conceptKey,
  currentAro.conceptKey,
);
assert.equal(
  directResult.candidate
    .candidateAro.realizationBindings
    .length,
  0,
);
assert.equal(
  directResult.candidate
    .candidateAro.counterpartRef.id,
  currentAro.aroId,
);
assert.equal(
  directResult.candidate
    .canonical,
  false,
);

const remanded =
  await new DirectAroTargetDefinitionRuntime({
    runner: async () => ({
      actionCalls: [{
        callId: "invalid",
        name:
          ARO_TARGET_DEFINITION_ACTION,
        argumentsJson:
          JSON.stringify({
            ...JSON.parse(
              validAction()
                .actionCalls[0]
                .argumentsJson,
            ),
            branches: [{
              ...JSON.parse(
                validAction()
                  .actionCalls[0]
                  .argumentsJson,
              ).branches[0],
              currentBranchKeys: [
                "invented_current_branch",
              ],
            }],
            edges: [],
          }),
      }],
    }),
    now,
  }).run({
    projectId: project.id,
    project,
    currentAro,
    targetIntent,
    repositorySnapshotRef: {
      kind: "repository_snapshot",
      id:
        repositorySnapshot.snapshotId,
      digest:
        repositorySnapshot
          .snapshotDigest,
      projectId: project.id,
    },
    attempt: 1,
  });
assert.equal(remanded.state, "remanded");
assert.equal(remanded.candidate, null);

function seedStore(rootDir) {
  const store =
    new DirectWorldManagerControlPlaneStore({
      rootDir,
      now,
    });
  store.ensureBootstrap({
    userWorldId: "user_world_sc72",
    projects: [project],
  });
  store
    .registerRepositorySemanticSnapshot({
      snapshot: repositorySnapshot,
    });
  store.transaction(() => {
    store
      ._appendAroRevisionWithinTransaction(
        currentAro,
      );
    store.incrementRevision();
  });
  return store;
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc72-",
  ),
);
const store = seedStore(rootDir);
const service =
  new DirectWorldManagerService({
    store,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc72",
    aroTargetDefinitionRuntime:
      runtime,
    now,
  });
service.bootstrap();
const initialProjection =
  service.snapshot();
assert.equal(
  initialProjection.aroRegistry
    .currentTargetComparisons.length,
  0,
);
assert.equal(
  initialProjection.aroRegistry
    .targetDefinitionAvailable,
  true,
);
const currentBinding =
  initialProjection.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.kind ===
          "abstract_reasoning_object" &&
        binding.subjectRef.id ===
          currentAro.aroId &&
        binding.subjectRef.digest ===
          currentAro.digest,
    );
assert.ok(currentBinding);

const defined =
  await service.defineAroTarget({
    projectId: project.id,
    currentAroId: currentAro.aroId,
    currentAroDigest:
      currentAro.digest,
    targetIntent,
    semanticRegionBindingRef: {
      kind:
        "semantic_region_binding",
      id:
        currentBinding
          .semanticRegionBindingId,
      digest:
        currentBinding.digest,
    },
  });
assert.equal(
  defined.receipt.state,
  "completed",
);
assert.equal(
  defined.receipt
    .canonicalAdmissionEffect,
  false,
);
assert.equal(
  defined.projection.aroRegistry
    .targetDefinitionRuns[0].state,
  "completed",
);
assert.equal(
  defined.projection.aroRegistry
    .currentTargetComparisons.length,
  0,
);
const candidate =
  store
    .aroReconstructionCandidateById(
      defined.receipt.candidateRef.id,
    );
assert.equal(
  candidate.reconstructionMethod,
  "semantic_target_definition",
);
const candidateBinding =
  defined.projection.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          candidate.candidateId &&
        binding.subjectRef.digest ===
          candidate.digest,
    );
assert.ok(candidateBinding);

const reuseCurrentBinding =
  defined.projection.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          currentAro.aroId &&
        binding.subjectRef.digest ===
          currentAro.digest,
    );
const reused =
  await service.defineAroTarget({
    projectId: project.id,
    currentAroId: currentAro.aroId,
    currentAroDigest:
      currentAro.digest,
    targetIntent,
    semanticRegionBindingRef: {
      kind:
        "semantic_region_binding",
      id:
        reuseCurrentBinding
          .semanticRegionBindingId,
      digest:
        reuseCurrentBinding.digest,
    },
  });
assert.equal(reused.receipt.reused, true);
assert.equal(runtimeCalls, 2);

const reviewed =
  service
    .reviewAroReconstructionCandidate({
      candidateId:
        candidate.candidateId,
      candidateDigest:
        candidate.digest,
      expectedCandidateRevision:
        candidate.candidateRevision,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          candidateBinding
            .semanticRegionBindingId,
        digest:
          candidateBinding.digest,
      },
    });
const reviewedCandidate =
  store
    .aroReconstructionCandidateById(
      candidate.candidateId,
    );
assert.equal(
  reviewedCandidate
    .evidenceReviewState,
  "reviewed",
);
const reviewedBinding =
  reviewed.projection.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          reviewedCandidate
            .candidateId &&
        binding.subjectRef.digest ===
          reviewedCandidate.digest,
    );
assert.ok(reviewedBinding);

const admitted =
  service
    .admitAroReconstructionCandidate({
      candidateId:
        reviewedCandidate
          .candidateId,
      candidateDigest:
        reviewedCandidate.digest,
      expectedCandidateRevision:
        reviewedCandidate
          .candidateRevision,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          reviewedBinding
            .semanticRegionBindingId,
        digest:
          reviewedBinding.digest,
      },
    });
assert.equal(
  admitted.receipt.state,
  "admitted",
);
const admittedProjection =
  admitted.projection;
assert.equal(
  admittedProjection.aroRegistry
    .canonicalAros.filter(
      (aro) =>
        aro.posture === "target" &&
        aro.conceptKey ===
          currentAro.conceptKey,
    ).length,
  1,
);
assert.equal(
  admittedProjection.aroRegistry
    .currentTargetComparisons.length,
  1,
);
const comparison =
  admittedProjection.aroRegistry
    .currentTargetComparisons[0];
assert.deepEqual(
  comparison.sharedBranchKeys,
  ["stable_semantic_identity"],
);
assert.equal(
  comparison.currentOnlyBranchRefs
    .length,
  1,
);
assert.equal(
  comparison.targetOnlyBranchRefs
    .length,
  2,
);

const revisedIntent =
  `${targetIntent} Keep the navigator ordering policy explicitly unresolved.`;
const revisedDefinition =
  await service.defineAroTarget({
    projectId: project.id,
    currentAroId: currentAro.aroId,
    currentAroDigest:
      currentAro.digest,
    targetIntent: revisedIntent,
    semanticRegionBindingRef: {
      kind:
        "semantic_region_binding",
      id:
        admittedProjection
          .semanticSurface
          .regionBindings
          .find((binding) =>
            binding.subjectRef.id ===
              currentAro.aroId &&
            binding.subjectRef.digest ===
              currentAro.digest)
          .semanticRegionBindingId,
      digest:
        admittedProjection
          .semanticSurface
          .regionBindings
          .find((binding) =>
            binding.subjectRef.id ===
              currentAro.aroId &&
            binding.subjectRef.digest ===
              currentAro.digest)
          .digest,
    },
  });
assert.equal(
  revisedDefinition.receipt.state,
  "completed",
);
assert.equal(
  revisedDefinition.projection
    .aroRegistry
    .targetDefinitionRuns[0]
    .targetBaselineRef.digest,
  admitted.receipt.aroRef.digest,
);
assert.notEqual(
  revisedDefinition.receipt
    .candidateRef.id,
  defined.receipt.candidateRef.id,
);
const revisedCandidate =
  store
    .aroReconstructionCandidateById(
      revisedDefinition.receipt
        .candidateRef.id,
    );
const revisedCandidateBinding =
  revisedDefinition.projection
    .semanticSurface.regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          revisedCandidate.candidateId &&
        binding.subjectRef.digest ===
          revisedCandidate.digest,
    );
const revisedReview =
  service
    .reviewAroReconstructionCandidate({
      candidateId:
        revisedCandidate.candidateId,
      candidateDigest:
        revisedCandidate.digest,
      expectedCandidateRevision:
        revisedCandidate
          .candidateRevision,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          revisedCandidateBinding
            .semanticRegionBindingId,
        digest:
          revisedCandidateBinding
            .digest,
      },
    });
const reviewedRevision =
  store
    .aroReconstructionCandidateById(
      revisedCandidate.candidateId,
    );
const revisedReviewBinding =
  revisedReview.projection
    .semanticSurface.regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          reviewedRevision.candidateId &&
        binding.subjectRef.digest ===
          reviewedRevision.digest,
    );
const revisedAdmission =
  service
    .admitAroReconstructionCandidate({
      candidateId:
        reviewedRevision.candidateId,
      candidateDigest:
        reviewedRevision.digest,
      expectedCandidateRevision:
        reviewedRevision
          .candidateRevision,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          revisedReviewBinding
            .semanticRegionBindingId,
        digest:
          revisedReviewBinding.digest,
      },
    });
const revisedTarget =
  revisedAdmission.projection
    .aroRegistry.canonicalAros.find(
      (aro) =>
        aro.posture === "target" &&
        aro.conceptKey ===
          currentAro.conceptKey,
    );
assert.equal(revisedTarget.revision, 2);
assert.equal(runtimeCalls, 3);

const restartRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc72-restart-",
  ),
);
const restartStore =
  seedStore(restartRoot);
const scheduled =
  restartStore
    .scheduleAroTargetDefinitionRun({
      currentAro,
      targetIntent:
        `${targetIntent} Restart fixture.`,
    });
assert.equal(scheduled.run.state, "scheduled");
const restartedService =
  new DirectWorldManagerService({
    store: restartStore,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc72_restart",
    aroTargetDefinitionRuntime:
      runtime,
    now,
  });
restartedService.bootstrap();
const recovered =
  restartStore
    .latestAroTargetDefinitionRun({
      projectId: project.id,
    });
validateAroTargetDefinitionRun(recovered);
assert.equal(recovered.state, "failed");
assert.equal(recovered.retryable, true);
assert.equal(
  recovered.error.code,
  "world_manager_aro_target_runtime_restart",
);

for (
  const [envName, projection] of [
    [
      "CODEX_WORLD_MANAGER_SC72_INITIAL_PROJECTION_PATH",
      initialProjection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC72_CANDIDATE_PROJECTION_PATH",
      defined.projection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC72_ADMITTED_PROJECTION_PATH",
      admittedProjection,
    ],
  ]
) {
  if (process.env[envName]) {
    fs.writeFileSync(
      process.env[envName],
      `${JSON.stringify(
        projection,
        null,
        2,
      )}\n`,
    );
  }
}

service.close();
restartStore.close();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});
fs.rmSync(restartRoot, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify({
    ok: true,
    slice: "WM-SC7.2",
    targetCandidateProduced: true,
    comparisonReachableAfterAdmission:
      true,
    targetRevisionReachable: true,
    sharedBranchCount:
      comparison.sharedBranchKeys.length,
    targetOnlyBranchCount:
      comparison
        .targetOnlyBranchRefs.length,
    sourceInspectionEffect: false,
    realizationBindingEffect: false,
    canonicalAdmissionEffect:
      "explicit_operator_gate_only",
    mutationContractEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    restartRecoveredState:
      recovered.state,
  }),
);
