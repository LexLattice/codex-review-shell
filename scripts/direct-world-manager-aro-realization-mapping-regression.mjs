#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  abstractReasoningObjectRef,
  branchRef,
  buildAbstractReasoningObject,
  buildAroCurrentTargetComparison,
} = require(
  "../src/main/direct/worldmanager/aro-kernel",
);
const {
  buildAroMutationContract,
  buildAroMutationDelta,
  comparisonRef,
  mutationContractRef,
} = require(
  "../src/main/direct/worldmanager/aro-mutation-contract",
);
const {
  ARO_REALIZATION_MAPPING_ACTION,
  DirectAroRealizationMappingRuntime,
  buildAroRealizationContextImport,
  validateAroRealizationContextImport,
  validateAroRealizationMappingRun,
  validateAroRealizationMappingWitness,
} = require(
  "../src/main/direct/worldmanager/aro-realization-mapping",
);
const {
  buildRepositorySemanticSnapshot,
  repositorySnapshotRef,
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
  "2026-07-31T08:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};

const project = {
  id: "project_sc82",
  name: "SC8.2 Realization Studio",
  summary:
    "Relate semantic obligations to bounded source evidence before worker launch.",
  runtimePath: "direct",
};

const sourceText = [
  "export function renderWorkbench(state) {",
  "  return state.current;",
  "}",
  "",
  "export function bindEvidence() {",
  "  return [];",
  "}",
].join("\n");

async function observeNativeWorkspaceContext() {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.resolve(
            "src/backend/wsl-agent.js",
          ),
          "--root",
          process.cwd(),
          "--project-id",
          project.id,
          "--workspace-kind",
          "wsl",
        ],
        {
          cwd: process.cwd(),
          stdio: [
            "pipe",
            "pipe",
            "pipe",
          ],
        },
      );
      let stdout = "";
      let stderr = "";
      let observation = null;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            "SC8.2 native workspace observation timed out.",
          ),
        );
      }, 15_000);
      child.stderr.on(
        "data",
        (chunk) => {
          stderr += chunk.toString(
            "utf8",
          );
        },
      );
      child.stdout.on(
        "data",
        (chunk) => {
          stdout += chunk.toString(
            "utf8",
          );
          const lines =
            stdout.split(/\r?\n/);
          stdout = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const message =
              JSON.parse(line);
            if (
              message.id ===
                "sc82-native" &&
              message.result
            ) {
              observation =
                message.result;
              child.stdin.end();
            }
            if (
              message.id ===
                "sc82-native" &&
              message.error
            ) {
              child.stdin.end();
              reject(
                new Error(
                  message.error.message,
                ),
              );
            }
          }
        },
      );
      child.on("error", reject);
      child.on(
        "close",
        (code) => {
          clearTimeout(timer);
          if (
            code !== 0 ||
            !observation
          ) {
            reject(
              new Error(
                stderr ||
                  `SC8.2 native workspace observation failed with ${code}.`,
              ),
            );
            return;
          }
          resolve(observation);
        },
      );
      child.stdin.write(
        `${JSON.stringify({
          id: "sc82-native",
          method:
            "repositoryRealizationContext",
          params: {
            relativePaths: [
              "src/backend/wsl-agent.js",
              ".env",
            ],
          },
        })}\n`,
      );
    },
  );
}

const nativeWorkspaceObservation =
  await observeNativeWorkspaceContext();
assert.equal(
  nativeWorkspaceObservation.schema,
  "workspace_aro_realization_context_observation@1",
);
assert.equal(
  nativeWorkspaceObservation
    .sourceInspectionEffect,
  true,
);
assert.equal(
  nativeWorkspaceObservation
    .workspaceMutationEffect,
  false,
);
assert.equal(
  nativeWorkspaceObservation
    .rawWorkspacePathIncluded,
  false,
);
assert.equal(
  nativeWorkspaceObservation
    .evidence[0].relativePath,
  "src/backend/wsl-agent.js",
);
assert.equal(
  nativeWorkspaceObservation
    .evidence[0].excerptTruncated,
  true,
);
assert.match(
  nativeWorkspaceObservation
    .rejectedPaths.find(
      (entry) =>
        entry.relativePath ===
          ".env",
    )?.reason || "",
  /sensitive_path/,
);

const repositorySnapshot =
  buildRepositorySemanticSnapshot({
    projectId: project.id,
    observation: {
      projectId: project.id,
      workspaceKind: "wsl",
      gitAvailable: true,
      headOid: "fixture-head-sc82",
      branch: "main",
      dirtyPathCount: 0,
      statusDigest:
        "sha256:fixture-status-sc82",
      diffDigest:
        "sha256:fixture-diff-sc82",
      untrackedStateDigest:
        "sha256:fixture-untracked-sc82",
      manifestDigest:
        "sha256:fixture-manifest-sc82",
      trackedFileCount: 1,
      manifestPaths: [
        "src/workbench.js",
      ],
      evidenceCatalogComplete: true,
      evidence: [{
        evidenceKey:
          "snapshot_workbench",
        evidenceKind: "source_file",
        relativePath:
          "src/workbench.js",
        sizeBytes:
          Buffer.byteLength(
            sourceText,
          ),
        excerpt: sourceText,
        excerptTruncated: false,
        digest:
          "sha256:fixture-workbench-source",
      }],
      observedAt:
        new Date(now()).toISOString(),
    },
    now,
  });
const sourceRef =
  repositorySnapshot
    .evidence[0].sourceRef;

function aro(posture) {
  const target = posture === "target";
  return buildAbstractReasoningObject({
    projectId: project.id,
    conceptKey:
      "realization_evidence_workbench",
    semanticIdentity:
      "Realization evidence workbench",
    purpose: target
      ? "Relate every implementation obligation to inspectable realization witnesses."
      : "Expose semantic obligations without an obligation-to-code witness.",
    posture,
    lifecycle: "active",
    canonical: true,
    branches: [
      {
        branchKey:
          "preserve_semantic_identity",
        branchKind:
          "semantic_invariant",
        modality: "required",
        statement:
          "Preserve the exact focused semantic identity.",
        semanticState: "supported",
        provenanceRefs: [
          sourceRef,
        ],
      },
      ...(target
        ? [{
            branchKey:
              "map_before_worker",
            parentBranchKey:
              "preserve_semantic_identity",
            branchKind:
              "realization_requirement",
            modality: "required",
            statement:
              "Map implementation obligations to bounded source evidence before any worker launch.",
            semanticState: "missing",
            provenanceRefs: [
              sourceRef,
            ],
          }]
        : []),
    ],
    edges: [],
    realizationBindings: target
      ? [{
          branchKey:
            "map_before_worker",
          realizationKind: "source",
          locator:
            "src/workbench.js",
          sourceRef,
          coverageState: "partial",
          evidenceRefs: [
            sourceRef,
          ],
          observedRevisionRef:
            sourceRef,
        }]
      : [],
    provenanceRefs: [
      sourceRef,
    ],
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
const targetBranch =
  targetAro.branches.find(
    (entry) =>
      entry.branchKey ===
        "map_before_worker",
  );
assert.ok(targetBranch);
assert.equal(
  delta.mutationRequired,
  true,
);

const contract =
  buildAroMutationContract({
    projectId: project.id,
    conceptKey:
      comparison.conceptKey,
    comparisonRef:
      comparisonRef(comparison),
    currentAroRef:
      abstractReasoningObjectRef(
        currentAro,
      ),
    targetAroRef:
      abstractReasoningObjectRef(
        targetAro,
      ),
    repositorySnapshotRef:
      repositorySnapshotRef(
        repositorySnapshot,
      ),
    delta,
    disposition:
      "mutation_required",
    contractSummary:
      "Add a bounded, read-only realization evidence lane ahead of worker execution.",
    changeStrategy:
      "Import only source paths bound by the exact target ARO, then map each obligation to file, symbol, and line-range witnesses.",
    implementationObligations: [{
      obligationKey:
        "map_obligation_to_source",
      obligationKind:
        "realization_mapping",
      title:
        "Map obligation to realization",
      objective:
        "Relate the semantic mapping requirement to the exact workbench source region.",
      preservationConstraintKeys:
        [],
      verificationRequirementKeys: [
        "verify_bounded_mapping",
      ],
      priority: "required",
      rationale:
        "A later worker needs an inspectable semantic-to-source handoff.",
      branchRefs:
        delta
          .operativeTargetBranchRefs,
    }],
    verificationRequirements: [{
      verificationKey:
        "verify_bounded_mapping",
      verificationKind:
        "realization_mapping_witness",
      claim:
        "The obligation is bound to supplied source evidence only.",
      successCondition:
        "The witness names an imported evidence key and an in-bounds line range.",
      branchRefs:
        delta
          .operativeTargetBranchRefs,
      requiredEvidenceKinds: [
        "source_identity",
        "line_range",
      ],
    }],
    preservationConstraints: [],
    assumptions: [],
    unresolvedQuestions: [],
    createdAt:
      new Date(now()).toISOString(),
    now,
  });

function contextObservation(
  requestedPaths = [
    "src/workbench.js",
  ],
) {
  return {
    schema:
      "workspace_aro_realization_context_observation@1",
    projectId: project.id,
    workspaceKind: "wsl",
    repositoryIdentity: {
      headOid:
        repositorySnapshot
          .repositoryIdentity
          .headOid,
      branch: "main",
      statusDigest:
        repositorySnapshot
          .repositoryIdentity
          .statusDigest,
      diffDigest:
        repositorySnapshot
          .repositoryIdentity
          .diffDigest,
    },
    evidence: requestedPaths.map(
      (relativePath) => ({
        evidenceKey:
          "workbench_source",
        evidenceKind: "source_file",
        relativePath,
        language: "javascript",
        sizeBytes:
          Buffer.byteLength(
            sourceText,
          ),
        lineStart: 1,
        lineEnd: 7,
        excerpt: sourceText,
        excerptTruncated: false,
        digest:
          "sha256:fixture-workbench-source",
      }),
    ),
    rejectedPaths: [],
    sourceInspectionEffect: true,
    workspaceMutationEffect: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    observedAt:
      new Date(now()).toISOString(),
  };
}

const pathRequest = {
  requestedPaths: [
    "src/workbench.js",
  ],
  selectionMode:
    "exact_aro_realization_bindings",
  operativeObligationKeys: [
    "map_obligation_to_source",
  ],
  operativeBranchRefs: [
    branchRef(targetBranch),
  ],
  maxFiles: 12,
  maxExcerptBytesPerFile: 12_000,
  maxTotalExcerptBytes: 96_000,
};
const contextImport =
  buildAroRealizationContextImport({
    contract,
    currentAro,
    targetAro,
    repositorySnapshot,
    pathRequest,
    observation:
      contextObservation(),
    now,
  });
validateAroRealizationContextImport(
  contextImport,
);
assert.equal(
  contextImport.freshness,
  "fresh",
);
assert.equal(
  contextImport.selectionWitness
    .selectionMode,
  "exact_aro_realization_bindings",
);
assert.equal(
  contextImport.evidence.length,
  1,
);
assert.match(
  contextImport.evidence[0].excerpt,
  /renderWorkbench/,
);

function validMappingAction() {
  return {
    actionCalls: [{
      callId:
        "call_sc82_mapping",
      name:
        ARO_REALIZATION_MAPPING_ACTION,
      argumentsJson:
        JSON.stringify({
          mappingSummary:
            "The realization requirement maps to the workbench renderer and evidence-binding helper.",
          obligationMappings: [{
            obligationKey:
              "map_obligation_to_source",
            coverageState: "mapped",
            sourceBindings: [{
              evidenceKey:
                "workbench_source",
              symbol:
                "renderWorkbench / bindEvidence",
              startLine: 1,
              endLine: 7,
              bindingKind:
                "implementation_surface",
              rationale:
                "These functions render the workbench and establish its evidence binding.",
            }],
            rationale:
              "The supplied file contains the exact realization surface named by the target binding.",
          }],
          ambiguities: [],
          omissions: [],
          assumptions: [],
          unresolvedQuestions: [],
        }),
    }],
    telemetry: {
      runtimeMode: "fixture",
      model: "fixture-model",
      reasoningEffort: "medium",
      inputTokens: 720,
      outputTokens: 310,
      toolCallCount: 1,
      toolNames: [
        ARO_REALIZATION_MAPPING_ACTION,
      ],
      telemetrySource:
        "fixture_observed",
    },
  };
}

const runtime =
  new DirectAroRealizationMappingRuntime({
    runner: async (request) => {
      assert.equal(
        request.sourceInspectionEffect,
        true,
      );
      assert.equal(
        request.readOnlyEffect,
        true,
      );
      assert.equal(
        request.workerLaunchEffect,
        false,
      );
      assert.match(
        request.prompt,
        /renderWorkbench/,
      );
      assert.match(
        request.prompt,
        /map_obligation_to_source/,
      );
      return validMappingAction();
    },
    now,
  });
const runtimeResult =
  await runtime.run({
    contract,
    contextImport,
    attempt: 1,
  });
assert.equal(
  runtimeResult.state,
  "completed",
);
validateAroRealizationMappingWitness(
  runtimeResult.mappingWitness,
);
assert.equal(
  runtimeResult.mappingWitness
    .mappingPosture,
  "complete",
);
assert.equal(
  runtimeResult.mappingWitness
    .workerLaunchEffect,
  false,
);

const remandRuntime =
  new DirectAroRealizationMappingRuntime({
    runner: async () => {
      const invalid =
        validMappingAction();
      const args = JSON.parse(
        invalid.actionCalls[0]
          .argumentsJson,
      );
      args.obligationMappings[0]
        .sourceBindings[0]
        .evidenceKey =
          "invented_source";
      invalid.actionCalls[0]
        .argumentsJson =
          JSON.stringify(args);
      return invalid;
    },
    now,
  });
const remanded =
  await remandRuntime.run({
    contract,
    contextImport,
    attempt: 1,
  });
assert.equal(
  remanded.state,
  "remanded",
);
assert.equal(
  remanded.mappingWitness,
  null,
);
assert.equal(
  remanded.validation
    .exactEvidenceBindingValidated,
  false,
);

function seedStore(rootDir) {
  const store =
    new DirectWorldManagerControlPlaneStore({
      rootDir,
      now,
    });
  store.ensureBootstrap({
    userWorldId:
      "user_world_sc82",
    projects: [project],
  });
  store
    .registerRepositorySemanticSnapshot({
      snapshot:
        repositorySnapshot,
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
  store.registerAroMutationContract({
    contract,
  });
  return store;
}

function contextProvider(
  counter,
) {
  return async (
    requestedProject,
    request,
  ) => {
    counter.count += 1;
    assert.equal(
      requestedProject.id,
      project.id,
    );
    assert.deepEqual(
      request.relativePaths,
      ["src/workbench.js"],
    );
    return contextObservation(
      request.relativePaths,
    );
  };
}

function semanticRegionBinding(
  projection,
) {
  const binding =
    projection.semanticSurface
      .regionBindings.find(
        (entry) =>
          entry.subjectRef.id ===
            comparison.comparisonId &&
          entry.subjectRef.digest ===
            comparison.digest,
      );
  assert.ok(binding);
  return {
    kind:
      "semantic_region_binding",
    id:
      binding.semanticRegionBindingId,
    digest: binding.digest,
  };
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc82-",
  ),
);
const store = seedStore(rootDir);
const providerCounter = {
  count: 0,
};
const service =
  new DirectWorldManagerService({
    store,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc82",
    aroRealizationContextProvider:
      contextProvider(
        providerCounter,
      ),
    aroRealizationMappingRuntime:
      runtime,
    now,
  });
service.bootstrap();
const initialProjection =
  service.snapshot();
assert.equal(
  initialProjection.aroRegistry
    .realizationMappingAvailable,
  true,
);
assert.equal(
  initialProjection.aroRegistry
    .realizationMappingRuns.length,
  0,
);
const binding =
  semanticRegionBinding(
    initialProjection,
  );
const mapped =
  await service
    .mapAroRealizationContext({
      projectId: project.id,
      contractId:
        contract.contractId,
      contractDigest:
        contract.digest,
      semanticRegionBindingRef:
        binding,
    });
assert.equal(
  mapped.receipt.state,
  "completed",
);
assert.equal(
  mapped.receipt
    .sourceInspectionEffect,
  true,
);
assert.equal(
  mapped.receipt
    .workerLaunchEffect,
  false,
);
assert.equal(
  providerCounter.count,
  1,
);
const completedProjection =
  mapped.projection;
assert.equal(
  completedProjection.aroRegistry
    .realizationContextImports
    .length,
  1,
);
assert.equal(
  completedProjection.aroRegistry
    .realizationMappingWitnesses
    .length,
  1,
);
assert.equal(
  completedProjection.aroRegistry
    .realizationMappingRuns[0]
    .state,
  "completed",
);
assert.equal(
  completedProjection.aroRegistry
    .realizationContextImports[0]
    .sourceTextProjected,
  false,
);
assert.equal(
  Object.hasOwn(
    completedProjection.aroRegistry
      .realizationContextImports[0]
      .evidence[0],
    "excerpt",
  ),
  false,
);
assert.equal(
  completedProjection.aroRegistry
    .realizationMappingWitnesses[0]
    .obligationMappings[0]
    .sourceBindings[0]
    .relativePath,
  "src/workbench.js",
);

const reused =
  await service
    .mapAroRealizationContext({
      projectId: project.id,
      contractId:
        contract.contractId,
      contractDigest:
        contract.digest,
      semanticRegionBindingRef:
        binding,
    });
assert.equal(
  reused.receipt.reused,
  true,
);
assert.equal(
  providerCounter.count,
  2,
);
assert.equal(
  store.descriptor().counts
    .aroRealizationContextImportCount,
  1,
);
assert.equal(
  store.descriptor().counts
    .aroRealizationMappingWitnessCount,
  1,
);

await assert.rejects(
  service.mapAroRealizationContext({
    projectId: project.id,
    contractId:
      contract.contractId,
    contractDigest:
      contract.digest,
    semanticRegionBindingRef: {
      ...binding,
      digest: "sha256:stale",
    },
  }),
  (error) =>
    error.code ===
    "world_manager_semantic_region_binding_invalid",
);
assert.equal(
  providerCounter.count,
  2,
);

const failedRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc82-failed-",
  ),
);
const failedStore =
  seedStore(failedRoot);
const failedService =
  new DirectWorldManagerService({
    store: failedStore,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc82",
    aroRealizationContextProvider:
      contextProvider({
        count: 0,
      }),
    aroRealizationMappingRuntime:
      remandRuntime,
    now,
  });
failedService.bootstrap();
const failedInitial =
  failedService.snapshot();
const failedResult =
  await failedService
    .mapAroRealizationContext({
      projectId: project.id,
      contractId:
        contract.contractId,
      contractDigest:
        contract.digest,
      semanticRegionBindingRef:
        semanticRegionBinding(
          failedInitial,
        ),
    });
assert.equal(
  failedResult.receipt.state,
  "remanded",
);
assert.equal(
  failedResult.projection
    .aroRegistry
    .failedRealizationMappingCount,
  1,
);

const restartRoot =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "direct-world-manager-sc82-restart-",
    ),
  );
const restartStore =
  seedStore(restartRoot);
restartStore
  .registerAroRealizationContextImport({
    contextImport,
  });
const scheduled =
  restartStore
    .scheduleAroRealizationMappingRun({
      contract,
      contextImport,
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
      "user_world_sc82",
    aroRealizationContextProvider:
      contextProvider({
        count: 0,
      }),
    aroRealizationMappingRuntime:
      runtime,
    now,
  });
restartedService.bootstrap();
const recovered =
  restartStore
    .latestAroRealizationMappingRun({
      projectId: project.id,
      contractDigest:
        contract.digest,
    });
validateAroRealizationMappingRun(
  recovered,
);
assert.equal(
  recovered.state,
  "failed",
);
assert.equal(
  recovered.retryable,
  true,
);
assert.equal(
  recovered.error.code,
  "world_manager_aro_realization_mapping_runtime_restart",
);

for (
  const [envName, projection] of [
    [
      "CODEX_WORLD_MANAGER_SC82_INITIAL_PROJECTION_PATH",
      initialProjection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC82_COMPLETED_PROJECTION_PATH",
      completedProjection,
    ],
    [
      "CODEX_WORLD_MANAGER_SC82_FAILED_PROJECTION_PATH",
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
failedStore.close();
restartStore.close();
for (
  const directory of [
    rootDir,
    failedRoot,
    restartRoot,
  ]
) {
  fs.rmSync(directory, {
    recursive: true,
    force: true,
  });
}

console.log(
  JSON.stringify({
    ok: true,
    slice: "WM-SC8.2",
    nativeSubstrateObservation:
      true,
    sensitivePathRejected: true,
    contextImportCount: 1,
    mappingPosture:
      runtimeResult.mappingWitness
        .mappingPosture,
    mappedObligationCount:
      runtimeResult.mappingWitness
        .mappedObligationCount,
    retryRecoveredState:
      recovered.state,
    sourceTextProjected: false,
    sourceInspectionEffect: true,
    readOnlyEffect: true,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
  }),
);
