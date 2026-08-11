#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildAroCurrentTargetComparison,
  buildAbstractReasoningObject,
} = require(
  "../src/main/direct/worldmanager/aro-kernel",
);
const {
  ARO_MUTATION_ACTION,
  DirectAroMutationContractRuntime,
  buildAroMutationDelta,
  validateAroMutationCompilationRun,
  validateAroMutationContract,
} = require(
  "../src/main/direct/worldmanager/aro-mutation-contract",
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
  "2026-07-30T18:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const project = {
  id: "project_sc81",
  name: "SC8.1 Mutation Studio",
  summary:
    "Compile semantic change obligations before touching code.",
  runtimePath: "direct",
};

function aro(posture) {
  const target = posture === "target";
  return buildAbstractReasoningObject({
    projectId: project.id,
    conceptKey:
      "semantic_mutation_workbench",
    semanticIdentity:
      "Semantic mutation workbench",
    purpose: target
      ? "Turn exact current/target semantic deltas into inspectable implementation obligations."
      : "Expose current and target semantic anatomy without an implementation contract.",
    posture,
    lifecycle: "active",
    canonical: true,
    branches: [
      {
        branchKey: "stable_identity",
        branchKind:
          "semantic_invariant",
        modality: "required",
        statement: target
          ? "The focused workbench preserves exact object identity through contract compilation."
          : "The focused workbench preserves exact object identity through inspection.",
        semanticState: "supported",
        provenanceRefs: [],
      },
      ...(target
        ? [{
            branchKey:
              "contract_before_mutation",
            parentBranchKey:
              "stable_identity",
            branchKind:
              "trajectory_requirement",
            modality: "required",
            statement:
              "A provisional semantic contract exists before any source or worker effect.",
            semanticState: "missing",
            provenanceRefs: [],
          }]
        : [{
            branchKey:
              "manual_translation",
            parentBranchKey:
              "stable_identity",
            branchKind:
              "current_limitation",
            modality: "possible",
            statement:
              "The operator manually translates the ARO delta into implementation intent.",
            semanticState: "supported",
            provenanceRefs: [],
          }]),
    ],
    edges: [],
    realizationBindings: [],
    provenanceRefs: [],
    createdAt:
      new Date(now()).toISOString(),
    now,
  });
}

const currentAro = aro("current");
const targetAro = aro("target");
const comparison =
  buildAroCurrentTargetComparison(
    currentAro,
    targetAro,
  );
const delta = buildAroMutationDelta(
  currentAro,
  targetAro,
  comparison,
);
assert.equal(delta.mutationRequired, true);
assert.equal(
  delta.operativeTargetBranchRefs
    .length,
  2,
);
assert.equal(
  delta.currentOnlyBranchRefs.length,
  1,
);
assert.equal(
  delta.semanticTruthValidated,
  false,
);
assert.equal(
  delta.codeMutationAuthorized,
  false,
);

function validAction() {
  return {
    actionCalls: [{
      callId: "call_sc81_contract",
      name: ARO_MUTATION_ACTION,
      argumentsJson: JSON.stringify({
        disposition:
          "mutation_required",
        contractSummary:
          "Preserve focused-object identity while adding a bounded contract compiler ahead of all realization effects.",
        changeStrategy:
          "Bind the exact comparison, project its mechanically derived delta, and expose provisional obligations with verification gates in the same focused workbench.",
        implementationObligations: [
          {
            obligationKey:
              "preserve_exact_focus",
            obligationKind:
              "semantic_identity_preservation",
            title:
              "Preserve exact focused identity",
            objective:
              "Keep the current, comparison, and target references visible and immutable through compilation.",
            branchSelectors: [{
              posture: "target",
              branchKey:
                "stable_identity",
            }],
            preservationConstraintKeys: [
              "retire_manual_translation_safely",
            ],
            verificationRequirementKeys: [
              "verify_exact_binding",
            ],
            priority: "constitutional",
            rationale:
              "A contract compiled against a stale or different semantic object is not admissible even as advice.",
          },
          {
            obligationKey:
              "compile_before_effect",
            obligationKind:
              "effect_boundary",
            title:
              "Compile before any effect",
            objective:
              "Persist an inspectable candidate contract while every source, worker, workspace, and canonical effect remains false.",
            branchSelectors: [{
              posture: "target",
              branchKey:
                "contract_before_mutation",
            }],
            preservationConstraintKeys: [],
            verificationRequirementKeys: [
              "verify_zero_effects",
            ],
            priority: "required",
            rationale:
              "SC8.1 creates semantic intent but no realization authority.",
          },
        ],
        verificationRequirements: [
          {
            verificationKey:
              "verify_exact_binding",
            verificationKind:
              "digest_binding_witness",
            claim:
              "The contract binds the exact current ARO, comparison, and target ARO.",
            successCondition:
              "All three ids and digests match the focused comparison at compilation time.",
            branchSelectors: [{
              posture: "target",
              branchKey:
                "stable_identity",
            }],
            requiredEvidenceKinds: [
              "exact_semantic_refs",
              "region_binding",
            ],
          },
          {
            verificationKey:
              "verify_zero_effects",
            verificationKind:
              "authority_boundary_witness",
            claim:
              "Contract compilation performs no realization effect.",
            successCondition:
              "Source inspection, worker launch, workspace mutation, canonical admission, and authority flags remain false.",
            branchSelectors: [{
              posture: "target",
              branchKey:
                "contract_before_mutation",
            }],
            requiredEvidenceKinds: [
              "compilation_run",
              "effect_manifest",
            ],
          },
        ],
        preservationConstraints: [{
          constraintKey:
            "retire_manual_translation_safely",
          statement:
            "Do not erase the current manual-translation limitation until a later slice verifies the replacement path.",
          branchSelectors: [{
            posture: "current",
            branchKey:
              "manual_translation",
          }],
        }],
        assumptions: [
          "Source realization context is intentionally absent in SC8.1.",
        ],
        unresolvedQuestions: [
          "Which realization mapping should SC8.2 import first?",
        ],
      }),
    }],
    telemetry: {
      runtimeMode: "fixture",
      model: "fixture-model",
      reasoningEffort: "medium",
      inputTokens: 900,
      outputTokens: 500,
      toolCallCount: 1,
      toolNames: [
        ARO_MUTATION_ACTION,
      ],
      telemetrySource:
        "fixture_observed",
    },
  };
}

const runtime =
  new DirectAroMutationContractRuntime({
    runner: async (request) => {
      assert.equal(
        request.workerLaunchEffect,
        false,
      );
      assert.equal(
        request.workspaceMutationEffect,
        false,
      );
      assert.equal(
        request.tools.length,
        1,
      );
      assert.match(
        request.prompt,
        /MECHANICALLY DERIVED DELTA/,
      );
      return validAction();
    },
    now,
  });
const runtimeResult =
  await runtime.run({
    projectId: project.id,
    project,
    currentAro,
    targetAro,
    comparison,
    attempt: 1,
  });
assert.equal(
  runtimeResult.state,
  "completed",
);
validateAroMutationContract(
  runtimeResult.contract,
);
assert.equal(
  runtimeResult.contract
    .implementationObligations.length,
  2,
);
assert.equal(
  runtimeResult.contract
    .verificationRequirements.length,
  2,
);
assert.equal(
  runtimeResult.contract
    .workerLaunchState,
  "unavailable_sc8_1",
);
assert.equal(
  runtimeResult.contract
    .workspaceMutationEffect,
  false,
);

const remandRuntime =
  new DirectAroMutationContractRuntime({
    runner: async () => {
      const invalid = validAction();
      const args = JSON.parse(
        invalid.actionCalls[0]
          .argumentsJson,
      );
      args.implementationObligations =
        args.implementationObligations
          .slice(0, 1);
      invalid.actionCalls[0]
        .argumentsJson =
          JSON.stringify(args);
      return invalid;
    },
    now,
  });
const remanded =
  await remandRuntime.run({
    projectId: project.id,
    project,
    currentAro,
    targetAro,
    comparison,
    attempt: 1,
  });
assert.equal(remanded.state, "remanded");
assert.equal(remanded.contract, null);
assert.equal(
  remanded.validation
    .exactDeltaCoverageValidated,
  false,
);

const failed =
  await new DirectAroMutationContractRuntime({
    runner: async () => {
      const error = new Error(
        "fixture provider unavailable",
      );
      error.code =
        "fixture_provider_unavailable";
      throw error;
    },
    now,
  }).run({
    projectId: project.id,
    project,
    currentAro,
    targetAro,
    comparison,
    attempt: 1,
  });
assert.equal(failed.state, "failed");
assert.equal(
  failed.error.code,
  "fixture_provider_unavailable",
);

function realizedAro(posture) {
  const sourceRef = {
    kind: "source_file",
    id:
      "semantic-mutation-workbench",
    digest:
      "sha256:realized-fixture",
    projectId: project.id,
  };
  return buildAbstractReasoningObject({
    projectId: project.id,
    conceptKey:
      "already_realized_semantics",
    semanticIdentity:
      "Already realized semantics",
    purpose:
      "Preserve an already realized semantic identity.",
    posture,
    lifecycle: "active",
    canonical: true,
    branches: [{
      branchKey:
        "already_realized",
      branchKind:
        "semantic_invariant",
      modality: "required",
      statement:
        "The semantic requirement is already realized.",
      semanticState: "supported",
      provenanceRefs: [sourceRef],
    }],
    edges: [],
    realizationBindings: [{
      branchKey:
        "already_realized",
      realizationKind: "source",
      locator:
        "Bounded realized fixture",
      sourceRef,
      coverageState: "realized",
      evidenceRefs: [sourceRef],
      observedRevisionRef:
        sourceRef,
    }],
    provenanceRefs: [sourceRef],
    createdAt:
      new Date(now()).toISOString(),
    now,
  });
}

const noChangeCurrent =
  realizedAro("current");
const noChangeTarget =
  realizedAro("target");
const noChangeComparison =
  buildAroCurrentTargetComparison(
    noChangeCurrent,
    noChangeTarget,
  );
assert.equal(
  buildAroMutationDelta(
    noChangeCurrent,
    noChangeTarget,
    noChangeComparison,
  ).mutationRequired,
  false,
);
const noChangeResult =
  await new DirectAroMutationContractRuntime({
    runner: async () => ({
      actionCalls: [{
        callId:
          "call_sc81_no_change",
        name: ARO_MUTATION_ACTION,
        argumentsJson:
          JSON.stringify({
            disposition:
              "no_change_required",
            contractSummary:
              "The exact current and target semantic postures already agree.",
            changeStrategy:
              "Preserve the existing realization and create no mutation work.",
            implementationObligations:
              [],
            verificationRequirements:
              [],
            preservationConstraints:
              [],
            assumptions: [],
            unresolvedQuestions: [],
          }),
      }],
      telemetry: {
        runtimeMode: "fixture",
        model: "fixture-model",
        reasoningEffort:
          "medium",
        toolCallCount: 1,
        toolNames: [
          ARO_MUTATION_ACTION,
        ],
      },
    }),
    now,
  }).run({
    projectId: project.id,
    project,
    currentAro:
      noChangeCurrent,
    targetAro:
      noChangeTarget,
    comparison:
      noChangeComparison,
    attempt: 1,
  });
assert.equal(
  noChangeResult.state,
  "completed",
);
assert.equal(
  noChangeResult.contract
    .disposition,
  "no_change_required",
);
assert.equal(
  noChangeResult.contract
    .implementationObligations
    .length,
  0,
);

function seedStore(rootDir) {
  const store =
    new DirectWorldManagerControlPlaneStore({
      rootDir,
      now,
    });
  store.ensureBootstrap({
    userWorldId:
      "user_world_sc81",
    projects: [project],
  });
  store.transaction(() => {
    store
      ._appendAroRevisionWithinTransaction(
        currentAro,
      );
    store
      ._appendAroRevisionWithinTransaction(
        targetAro,
      );
    store.incrementRevision();
  });
  return store;
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc81-",
  ),
);
const store = seedStore(rootDir);
const service =
  new DirectWorldManagerService({
    store,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc81",
    aroMutationRuntime: runtime,
    now,
  });
service.bootstrap();
const initialProjection =
  service.snapshot();
const comparisonProjection =
  initialProjection.aroRegistry
    .currentTargetComparisons[0];
assert.equal(
  comparisonProjection.digest,
  comparison.digest,
);
const comparisonSurface =
  initialProjection.semanticSurface
    .objectSurfaces.find(
      (surface) =>
        surface.objectClass ===
          "aro_current_target_comparison" &&
        surface.subjectRef.id ===
          comparison.comparisonId,
    );
assert.ok(comparisonSurface);
const regionBinding =
  initialProjection.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          comparison.comparisonId &&
        binding.subjectRef.digest ===
          comparison.digest,
    );
assert.ok(regionBinding);

const compiled =
  await service
    .compileAroMutationContract({
      projectId: project.id,
      comparisonId:
        comparison.comparisonId,
      comparisonDigest:
        comparison.digest,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          regionBinding
            .semanticRegionBindingId,
        digest:
          regionBinding.digest,
      },
    });
assert.equal(
  compiled.receipt.state,
  "completed",
);
assert.equal(
  compiled.receipt.reused,
  false,
);
assert.equal(
  compiled.receipt.workerLaunchEffect,
  false,
);
const completedProjection =
  compiled.projection;
assert.equal(
  completedProjection.aroRegistry
    .mutationContracts.length,
  1,
);
assert.equal(
  completedProjection.aroRegistry
    .mutationCompilationRuns[0]
    .state,
  "completed",
);
assert.equal(
  completedProjection.aroRegistry
    .mutationExecutionAvailable,
  false,
);

const reused =
  await service
    .compileAroMutationContract({
      projectId: project.id,
      comparisonId:
        comparison.comparisonId,
      comparisonDigest:
        comparison.digest,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          regionBinding
            .semanticRegionBindingId,
        digest:
          regionBinding.digest,
      },
    });
assert.equal(
  reused.receipt.reused,
  true,
);
assert.equal(
  store.descriptor().counts
    .aroMutationContractCount,
  1,
);

await assert.rejects(
  service.compileAroMutationContract({
    projectId: project.id,
    comparisonId:
      comparison.comparisonId,
    comparisonDigest:
      comparison.digest,
    semanticRegionBindingRef: {
      kind:
        "semantic_region_binding",
      id:
        regionBinding
          .semanticRegionBindingId,
      digest: "sha256:stale",
    },
  }),
  (error) =>
    error.code ===
    "world_manager_semantic_region_binding_invalid",
);

const restartRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc81-restart-",
  ),
);
const restartStore =
  seedStore(restartRoot);
const scheduled =
  restartStore
    .scheduleAroMutationCompilationRun({
      comparison,
      now,
    });
assert.equal(
  scheduled.run.state,
  "scheduled",
);
const restartedService =
  new DirectWorldManagerService({
    store: restartStore,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc81",
    aroMutationRuntime: runtime,
    now,
  });
restartedService.bootstrap();
const recovered =
  restartStore
    .latestAroMutationCompilationRun({
      projectId: project.id,
      comparisonDigest:
        comparison.digest,
    });
validateAroMutationCompilationRun(
  recovered,
);
assert.equal(recovered.state, "failed");
assert.equal(recovered.retryable, true);
assert.equal(
  recovered.error.code,
  "world_manager_aro_mutation_runtime_restart",
);

const failedRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc81-failed-",
  ),
);
const failedStore = seedStore(failedRoot);
const failedService =
  new DirectWorldManagerService({
    store: failedStore,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc81",
    aroMutationRuntime:
      remandRuntime,
    now,
  });
failedService.bootstrap();
const failedInitial =
  failedService.snapshot();
const failedBinding =
  failedInitial.semanticSurface
    .regionBindings.find(
      (binding) =>
        binding.subjectRef.id ===
          comparison.comparisonId,
    );
const failedResult =
  await failedService
    .compileAroMutationContract({
      projectId: project.id,
      comparisonId:
        comparison.comparisonId,
      comparisonDigest:
        comparison.digest,
      semanticRegionBindingRef: {
        kind:
          "semantic_region_binding",
        id:
          failedBinding
            .semanticRegionBindingId,
        digest:
          failedBinding.digest,
      },
    });
assert.equal(
  failedResult.receipt.state,
  "remanded",
);
assert.equal(
  failedResult.projection
    .aroRegistry
    .failedMutationCompilationCount,
  1,
);

for (
  const [envName, projection] of [
    [
      "CODEX_WORLD_MANAGER_SC81_INITIAL_PROJECTION_PATH",
      initialProjection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC81_COMPLETED_PROJECTION_PATH",
      completedProjection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC81_FAILED_PROJECTION_PATH",
      failedResult.projection,
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

store.close();
restartStore.close();
failedStore.close();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});
fs.rmSync(restartRoot, {
  recursive: true,
  force: true,
});
fs.rmSync(failedRoot, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify({
    ok: true,
    slice: "WM-SC8.1",
    operativeTargetBranchCount:
      delta
        .operativeTargetBranchRefs
        .length,
    obligationCount:
      runtimeResult.contract
        .implementationObligations
        .length,
    verificationCount:
      runtimeResult.contract
        .verificationRequirements
        .length,
    durableContractCount: 1,
    restartRecoveredState:
      recovered.state,
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
  }),
);
