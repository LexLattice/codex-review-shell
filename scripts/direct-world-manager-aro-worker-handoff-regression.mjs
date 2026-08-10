#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  abstractReasoningObjectRef,
  buildAbstractReasoningObject,
  buildAroCurrentTargetComparison,
} = require(
  "../src/main/direct/worldmanager/aro-kernel",
);
const {
  buildAroMutationContract,
  buildAroMutationDelta,
  comparisonRef,
} = require(
  "../src/main/direct/worldmanager/aro-mutation-contract",
);
const {
  buildAroRealizationContextImport,
  buildAroRealizationMappingWitness,
  realizationMappingWitnessRef,
  reviseAroRealizationMappingRun,
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
  buildAroWorkerAuthorizationReceipt,
  buildAroWorkerCapabilityObservation,
  buildAroWorkerSourceFreshnessWitness,
  validateAroWorkerHandoffRun,
} = require(
  "../src/main/direct/worldmanager/aro-worker-handoff",
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
  ARO_SEMANTIC_VERIFICATION_ACTION,
  DirectAroSemanticVerificationRuntime,
} = require(
  "../src/main/direct/worldmanager/aro-semantic-verification",
);
const {
  DirectWorkThreadRegistryStore,
} = require(
  "../src/main/direct/bridge/work-thread-registry",
);

let tick = Date.parse(
  "2026-07-31T12:00:00.000Z",
);
const now = () => {
  tick += 1_000;
  return tick;
};
const iso = () =>
  new Date(now()).toISOString();

const project = {
  id: "project_sc83",
  name: "SC8.3 Worker Studio",
  summary:
    "Compile and authorize one bounded ARO implementation worker.",
  runtimePath: "direct",
  workspace: {
    kind: "wsl",
  },
};
const sourceText = [
  "export function renderEvidenceLane(state) {",
  "  return state.mapping;",
  "}",
].join("\n");
const sourceDigest =
  "sha256:fixture-sc83-source";

const repositorySnapshot =
  buildRepositorySemanticSnapshot({
    projectId: project.id,
    observation: {
      projectId: project.id,
      workspaceKind: "wsl",
      gitAvailable: true,
      headOid: "fixture-head-sc83",
      branch: "main",
      dirtyPathCount: 0,
      statusDigest:
        "sha256:fixture-status-sc83",
      diffDigest:
        "sha256:fixture-diff-sc83",
      untrackedStateDigest:
        "sha256:fixture-untracked-sc83",
      manifestDigest:
        "sha256:fixture-manifest-sc83",
      trackedFileCount: 1,
      manifestPaths: [
        "src/evidence-lane.js",
      ],
      evidenceCatalogComplete: true,
      evidence: [{
        evidenceKey:
          "snapshot_evidence_lane",
        evidenceKind: "source_file",
        relativePath:
          "src/evidence-lane.js",
        sizeBytes:
          Buffer.byteLength(sourceText),
        excerpt: sourceText,
        excerptTruncated: false,
        digest: sourceDigest,
      }],
      observedAt: iso(),
    },
    now,
  });

function aro(posture) {
  const target = posture === "target";
  return buildAbstractReasoningObject({
    projectId: project.id,
    conceptKey:
      "bounded_worker_handoff",
    semanticIdentity:
      "Bounded worker handoff",
    purpose: target
      ? "Start one implementation worker only after exact evidence review and explicit authorization."
      : "Keep ARO realization mappings inspectable without an execution handoff.",
    posture,
    lifecycle: "active",
    canonical: true,
    branches: [
      {
        branchKey:
          "preserve_effect_gates",
        branchKind:
          "semantic_invariant",
        modality: "required",
        statement:
          "Every workspace effect remains separately approved.",
        semanticState: "supported",
        provenanceRefs: [
          repositorySnapshot
            .evidence[0].sourceRef,
        ],
      },
      ...(target
        ? [{
            branchKey:
              "authorize_one_worker",
            parentBranchKey:
              "preserve_effect_gates",
            branchKind:
              "execution_requirement",
            modality: "required",
            statement:
              "Compile and explicitly authorize one bounded Direct worker turn.",
            semanticState: "missing",
            provenanceRefs: [
              repositorySnapshot
                .evidence[0]
                .sourceRef,
            ],
          }]
        : []),
    ],
    edges: [],
    realizationBindings: target
      ? [{
          branchKey:
            "authorize_one_worker",
          realizationKind: "source",
          locator:
            "src/evidence-lane.js",
          sourceRef:
            repositorySnapshot
              .evidence[0].sourceRef,
          coverageState: "partial",
          evidenceRefs: [
            repositorySnapshot
              .evidence[0].sourceRef,
          ],
          observedRevisionRef:
            repositorySnapshot
              .evidence[0].sourceRef,
        }]
      : [],
    provenanceRefs: [
      repositorySnapshot
        .evidence[0].sourceRef,
    ],
    createdAt: iso(),
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
const delta =
  buildAroMutationDelta(
    currentAro,
    targetAro,
    comparison,
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
      "Implement one reviewed, explicitly authorized worker-handoff lane.",
    changeStrategy:
      "Begin from the exact realization mapping and preserve every per-call effect gate.",
    implementationObligations: [{
      obligationKey:
        "implement_worker_handoff",
      obligationKind:
        "bounded_execution_handoff",
      title:
        "Implement the worker handoff",
      objective:
        "Start one compiled Direct worker without granting workspace effects.",
      preservationConstraintKeys: [
        "preserve_effect_gates",
      ],
      verificationRequirementKeys: [
        "verify_handoff_lineage",
      ],
      priority: "required",
      rationale:
        "The provider start needs exact semantic and source lineage.",
      branchRefs:
        delta
          .operativeTargetBranchRefs,
    }],
    verificationRequirements: [{
      verificationKey:
        "verify_handoff_lineage",
      verificationKind:
        "runtime_witness",
      claim:
        "The worker start is exactly bound and workspace effects remain gated.",
      successCondition:
        "A worker-start transition and per-call approval witnesses exist.",
      branchRefs:
        delta
          .operativeTargetBranchRefs,
      requiredEvidenceKinds: [
        "worker_start_transition",
        "tool_approval_witness",
      ],
    }],
    preservationConstraints: [{
      constraintKey:
        "preserve_effect_gates",
      statement:
        "Do not turn worker-start authorization into workspace mutation authority.",
      branchRefs:
        delta
          .operativeTargetBranchRefs,
      rationale:
        "Authority must stay attenuated.",
    }],
    assumptions: [],
    unresolvedQuestions: [],
    createdAt: iso(),
    now,
  });

function contextObservation(
  digest = sourceDigest,
) {
  return {
    schema:
      "workspace_aro_realization_context_observation@1",
    projectId: project.id,
    workspaceKind: "wsl",
    repositoryIdentity: {
      headOid:
        repositorySnapshot
          .repositoryIdentity.headOid,
      branch: "main",
      statusDigest:
        repositorySnapshot
          .repositoryIdentity
          .statusDigest,
      diffDigest:
        repositorySnapshot
          .repositoryIdentity.diffDigest,
    },
    evidence: [{
      evidenceKey:
        "worker_lane_source",
      evidenceKind: "source_file",
      relativePath:
        "src/evidence-lane.js",
      language: "javascript",
      sizeBytes:
        Buffer.byteLength(sourceText),
      lineStart: 1,
      lineEnd: 3,
      excerpt: sourceText,
      excerptTruncated: false,
      digest,
    }],
    rejectedPaths: [],
    sourceInspectionEffect: true,
    workspaceMutationEffect: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
    observedAt: iso(),
  };
}

const contextImport =
  buildAroRealizationContextImport({
    contract,
    currentAro,
    targetAro,
    repositorySnapshot,
    pathRequest: {
      requestedPaths: [
        "src/evidence-lane.js",
      ],
      selectionMode:
        "exact_aro_realization_bindings",
      operativeObligationKeys: [
        "implement_worker_handoff",
      ],
      operativeBranchRefs:
        delta
          .operativeTargetBranchRefs,
      maxFiles: 12,
      maxExcerptBytesPerFile:
        12_000,
      maxTotalExcerptBytes:
        96_000,
    },
    observation:
      contextObservation(),
    now,
  });
const mappingWitness =
  buildAroRealizationMappingWitness({
    contract,
    contextImport,
    mappingSummary:
      "The worker-handoff obligation maps exactly to the evidence-lane implementation surface.",
    obligationMappings: [{
      obligation:
        contract
          .implementationObligations[0],
      coverageState: "mapped",
      sourceBindings: [{
        evidence:
          contextImport.evidence[0],
        symbol:
          "renderEvidenceLane",
        startLine: 1,
        endLine: 3,
        bindingKind:
          "implementation_surface",
        rationale:
          "The function is the exact realization surface governed by the contract.",
      }],
      rationale:
        "The supplied source fully covers the bounded handoff surface.",
    }],
    ambiguities: [],
    omissions: [],
    assumptions: [],
    unresolvedQuestions: [],
    createdAt: iso(),
    now,
  });

function seedStore(rootDir) {
  const store =
    new DirectWorldManagerControlPlaneStore({
      rootDir,
      now,
    });
  store.ensureBootstrap({
    userWorldId:
      "user_world_sc83",
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
  store
    .registerAroRealizationContextImport({
      contextImport,
    });
  store
    .registerAroRealizationMappingWitness({
      mappingWitness,
    });
  const scheduled =
    store
      .scheduleAroRealizationMappingRun({
        contract,
        contextImport,
        createdAt: iso(),
      });
  const running =
    reviseAroRealizationMappingRun(
      scheduled.run,
      {
        state: "running",
        updatedAt: iso(),
        now,
      },
    );
  store.registerAroRealizationMappingRun({
    run: running,
  });
  store.registerAroRealizationMappingRun({
    run:
      reviseAroRealizationMappingRun(
        running,
        {
          state: "completed",
          mappingWitnessRef:
            realizationMappingWitnessRef(
              mappingWitness,
            ),
          updatedAt: iso(),
          now,
        },
      ),
  });
  return store;
}

function regionBinding(projection) {
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

function capabilityInput() {
  return {
    runtimePath:
      "direct-implementation",
    workspaceKind: "wsl",
    runtimeStatus: "ready",
    turnRunnable: true,
    toolStates: {
      read_file: "ready",
      apply_patch: "ready",
      run_command: "ready",
    },
    blockerCodes: [],
  };
}

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc83-",
  ),
);
const store = seedStore(rootDir);
const workThreadStore =
  new DirectWorkThreadRegistryStore({
    rootDir: path.join(
      rootDir,
      "direct-sessions",
    ),
    now,
  });
const registeredContexts =
  new Map();
const roleRuntime = {
  registerCompilation(
    compilation,
  ) {
    const context =
      compilation
        .compiledAgentContext;
    registeredContexts.set(
      context.compiledAgentContextId,
      context,
    );
    return context;
  },
  resolveCompiledAgentContext(
    input = {},
  ) {
    const ref =
      input.compiledAgentContextRef ||
      input;
    const context =
      registeredContexts.get(ref.id);
    return context?.digest ===
      ref.digest
      ? context
      : null;
  },
};
let sourceChanged = false;
let executionEvidenceSourceDigest =
  "";
let runtimeObservation = null;
let executionEvidenceProjection =
  null;
let semanticVerificationProjection =
  null;
let interruptedEvidenceRunId = "";
let interruptedVerificationRunId =
  "";
let runtimeStartCount = 0;
let runtimeStartInput = null;
const service =
  new DirectWorldManagerService({
    store,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc83",
    workThreadStore,
    roleRuntime,
    aroRealizationContextProvider:
      async () =>
        contextObservation(
          executionEvidenceSourceDigest ||
          (
            sourceChanged
              ? "sha256:changed-source"
              : sourceDigest
          ),
        ),
    aroWorkerCapabilityProvider:
      async () => capabilityInput(),
    aroWorkerRuntime: {
      available: () => true,
      start: async (input) => {
        runtimeStartCount += 1;
        runtimeStartInput = input;
        return {
          schema:
            "direct_worker_start_response@1",
          transition: {
            workerStartTransitionId:
              "worker_start_sc83",
            transitionDigest:
              "sha256:worker-start-sc83",
          },
          result: {
            status: "started",
            workerSessionId:
              "direct_worker_session_sc83",
            workerTurnId:
              "direct_worker_turn_sc83",
            resultDigest:
              "sha256:worker-result-sc83",
          },
          thread: {
            id:
              "direct_worker_session_sc83",
          },
          turn: {
            id:
              "direct_worker_turn_sc83",
          },
        };
      },
    },
    ...(
      process.env
        .CODEX_WORLD_MANAGER_SC84_ASSERT ===
      "1"
        ? {
            aroWorkerEvidenceProvider:
              async () =>
                runtimeObservation,
          }
        : {}
    ),
    ...(
      process.env
        .CODEX_WORLD_MANAGER_SC85_ASSERT ===
      "1"
        ? {
            aroSemanticVerificationRuntime:
              new DirectAroSemanticVerificationRuntime({
                runner: async (request) => ({
                  actionCalls: [{
                    callId:
                      "call_sc85_semantic_verification",
                    name:
                      ARO_SEMANTIC_VERIFICATION_ACTION,
                    argumentsJson:
                      JSON.stringify({
                        overallPosture:
                          "partially_verified",
                        assessmentSummary:
                          "The bounded worker handoff was implemented with exact lineage and preserved per-call gates. One product-level decision remains about how prominently to expose the retained gate evidence.",
                        obligationAssessments:
                          contract
                            .implementationObligations
                            .map((entry) => ({
                              obligationKey:
                                entry.obligationKey,
                              status:
                                "satisfied",
                              rationale:
                                "The exact worker lineage, patch witness, repository after-state, and focused verification command jointly support this obligation.",
                              evidenceKinds: [
                                "worker_start_transition",
                                "workspace_effect",
                                "repository_after_state",
                              ],
                              blindspots: [],
                              continuationPaths: [],
                            })),
                        verificationAssessments:
                          contract
                            .verificationRequirements
                            .map((entry) => ({
                              verificationKey:
                                entry.verificationKey,
                              status:
                                "supported",
                              rationale:
                                "Required evidence kinds are present and the recorded result supports the bounded-lineage claim.",
                              evidenceKinds:
                                entry
                                  .requiredEvidenceKinds,
                              blindspots: [],
                              continuationPaths: [],
                            })),
                        preservationAssessments:
                          contract
                            .preservationConstraints
                            .map((entry) => ({
                              constraintKey:
                                entry.constraintKey,
                              status:
                                "preserved",
                              rationale:
                                "Workspace effects remained separately represented and no remote or canonical effect was observed.",
                              evidenceKinds: [
                                "workspace_effect",
                                "repository_after_state",
                              ],
                              blindspots: [],
                              continuationPaths: [],
                            })),
                        branchAssessments:
                          targetAro.branches
                            .map((entry) => ({
                              branchKey:
                                entry.branchKey,
                              status: "realized",
                              rationale:
                                "The acquired evidence supports this target distinction at the realization level.",
                              evidenceKinds: [
                                "repository_after_state",
                                "workspace_effect",
                              ],
                              blindspots: [],
                              continuationPaths: [],
                            })),
                        driftFindings: [{
                          findingKey:
                            "presentation_posture_unsettled",
                          severity: "low",
                          category:
                            "product_presentation",
                          statement:
                            "The implementation evidence does not settle how prominently the preserved gate lineage should appear in the default UX.",
                          evidenceKinds: [
                            "worker_final_output",
                          ],
                          affectedBranchKeys: [
                            "preserve_effect_gates",
                          ],
                          recommendedResponse:
                            "Ask the operator whether the gate evidence should remain expanded by default.",
                        }],
                        continuationPaths: [{
                          pathKey:
                            "review_current_realization",
                          label:
                            "Review current realization",
                          description:
                            "Inspect the semantic assessment and decide the presentation posture before any future canonical admission.",
                          priority: "normal",
                          preconditions: [
                            "Semantic assessment remains non-canonical.",
                          ],
                        }],
                        openDecisions: [{
                          decisionKey:
                            "gate_evidence_default_visibility",
                          question:
                            "Should preserved gate evidence be expanded by default in this project?",
                          description:
                            "This is a product-presentation choice, not an execution or admission authorization.",
                          options: [{
                            optionKey:
                              "expanded",
                            label:
                              "Expanded",
                            description:
                              "Keep gate lineage visible in the default lens.",
                            semanticValue:
                              "Prefer expanded gate evidence by default.",
                          }, {
                            optionKey:
                              "compact",
                            label:
                              "Compact",
                            description:
                              "Keep the default calm and reveal gate lineage on demand.",
                            semanticValue:
                              "Prefer compact gate evidence by default.",
                          }],
                        }],
                        closureRecommendation:
                          "ready_for_review",
                        closureRationale:
                          "The exact evidence supports review candidacy, while canonical admission remains separate.",
                      }),
                  }],
                  telemetry: {
                    runtimeMode:
                      "fixture",
                    model:
                      "fixture-model",
                    reasoningEffort:
                      request
                        .reasoningEffort,
                    inputTokens: 900,
                    outputTokens: 650,
                    toolCallCount: 1,
                    toolNames: [
                      ARO_SEMANTIC_VERIFICATION_ACTION,
                    ],
                  },
                }),
                now,
              }),
          }
        : {}
    ),
    now,
  });
service.bootstrap();
const initial = service.snapshot();
assert.equal(
  initial.aroRegistry
    .workerHandoffAvailable,
  true,
);
const binding =
  regionBinding(initial);
const prepared =
  await service
    .prepareAroWorkerHandoff({
      projectId: project.id,
      contractId:
        contract.contractId,
      contractDigest:
        contract.digest,
      contextImportId:
        contextImport.contextImportId,
      contextImportDigest:
        contextImport.digest,
      mappingWitnessId:
        mappingWitness.mappingWitnessId,
      mappingWitnessDigest:
        mappingWitness.digest,
      semanticRegionBindingRef:
        binding,
      actorId: "operator",
    });
assert.equal(
  prepared.receipt.state,
  "ready_for_authorization",
);
assert.equal(
  runtimeStartCount,
  0,
);
assert.equal(
  prepared.projection.aroRegistry
    .workerConstitutions.length,
  1,
);
const constitution =
  store.listAroWorkerConstitutions({
    limit: 10,
  })[0];
assert.equal(
  constitution.constitutionState,
  "ready_for_authorization",
);
assert.equal(
  constitution.authorityEnvelope
    .mayExecuteWorkspaceMutation,
  false,
);
assert.equal(
  constitution.completionContract
    .activityCountsAsCompletion,
  false,
);
assert.equal(
  prepared.projection.aroRegistry
    .workerConstitutions[0]
    .compiledInstructionsProjected,
  false,
);
assert.doesNotMatch(
  JSON.stringify(
    prepared.projection,
  ),
  /HARNESS-COMPILED DATA/,
);

const changedWitness =
  buildAroWorkerSourceFreshnessWitness({
    contextImport,
    observation:
      contextObservation(
        "sha256:changed-source",
      ),
    now,
  });
assert.equal(
  changedWitness.state,
  "blocked",
);
assert.match(
  changedWitness.blockerCodes[0],
  /mapped_source_changed/,
);

const authorized =
  await service
    .authorizeAroWorkerHandoff({
      projectId: project.id,
      constitutionId:
        constitution
          .workerConstitutionId,
      constitutionDigest:
        constitution.digest,
      semanticRegionBindingRef:
        binding,
      operatorActionId:
        "operator_action_sc83",
      actorId: "operator",
    });
assert.equal(
  authorized.receipt.state,
  "handed_off",
);
assert.equal(
  runtimeStartCount,
  1,
);
assert.equal(
  authorized.receipt
    .workerLaunchEffect,
  true,
);
assert.equal(
  authorized.receipt
    .workspaceMutationEffect,
  false,
);
assert.equal(
  runtimeStartInput
    .compiledAgentContextRef.id,
  constitution
    .compiledAgentContext
    .compiledAgentContextId,
);
assert.equal(
  workThreadStore
    .listWorkThreads({
      projectId: project.id,
    }).length,
  1,
);

const reused =
  await service
    .authorizeAroWorkerHandoff({
      projectId: project.id,
      constitutionId:
        constitution
          .workerConstitutionId,
      constitutionDigest:
        constitution.digest,
      semanticRegionBindingRef:
        binding,
      operatorActionId:
        "operator_action_sc83",
      actorId: "operator",
    });
assert.equal(
  reused.receipt.reused,
  true,
);
assert.equal(
  runtimeStartCount,
  1,
);

if (
  process.env
    .CODEX_WORLD_MANAGER_SC84_ASSERT ===
  "1"
) {
  const handoffRun =
    store
      .listAroWorkerHandoffRuns({
        projectId: project.id,
        currentOnly: true,
      })
      .find((run) =>
        run.state === "handed_off");
  assert.ok(handoffRun);
  const observedSession = {
    schema:
      "direct_codex_session@1",
    sessionId:
      handoffRun.workerSessionRef.id,
    projectId: project.id,
    messages: [],
  };
  runtimeObservation = {
    schema:
      "direct_aro_worker_execution_observation@1",
    projectId: project.id,
    workerSessionId:
      handoffRun.workerSessionRef.id,
    workerTurnId:
      handoffRun.workerTurnRef.id,
    session: observedSession,
    turn: {
      schema:
        "direct_codex_turn@1",
      sessionId:
        handoffRun.workerSessionRef.id,
      turnId:
        handoffRun.workerTurnRef.id,
      state: "tool_waiting",
      createdAt: iso(),
      updatedAt: iso(),
      unresolvedObligations: [{
        obligationId:
          "obligation_sc84_patch",
        status: "pending",
      }],
      toolResults: [{
        schema:
          "direct_codex_readonly_tool_result@1",
        resultId:
          "result_sc84_read",
        obligationId:
          "obligation_sc84_read",
        tool: "read_file",
        status: "completed",
        resultClass:
          "read_completed",
        relPath:
          "src/evidence-lane.js",
        sideEffectExecuted: false,
        authorityTransition: {
          transitionKind:
            "read_file",
        },
        recordedAt: iso(),
      }],
      continuationRequests: [],
      error: null,
    },
    finalAssistantText: "",
    observedAt: iso(),
    readOnlyObservation: true,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  const observing =
    await service
      .captureAroExecutionEvidence({
        projectId: project.id,
        handoffRunId:
          handoffRun.runId,
        handoffRunDigest:
          handoffRun.digest,
        observationRequestId:
          "sc84_observation_active",
        semanticRegionBindingRef:
          binding,
        actorId: "operator",
      });
  assert.equal(
    observing.receipt.state,
    "observing",
  );
  assert.equal(
    observing.receipt
      .workspaceMutationEffect,
    false,
  );
  const finalText =
    "Implemented the reviewed evidence lane and ran its focused regression. Semantic closure remains for the WorldManager.";
  observedSession.messages = [{
    id:
      handoffRun.workerTurnRef.id,
    status: "completed",
    items: [{
      id:
        "assistant_sc84",
      type: "agentMessage",
      turnId:
        handoffRun.workerTurnRef.id,
      text: finalText,
    }],
  }];
  runtimeObservation = {
    ...runtimeObservation,
    session: observedSession,
    turn: {
      ...runtimeObservation.turn,
      state: "completed",
      updatedAt: iso(),
      unresolvedObligations: [],
      toolResults: [
        ...runtimeObservation
          .turn.toolResults,
        {
          schema:
            "direct_patch_apply_result@1",
          resultId:
            "result_sc84_patch",
          obligationId:
            "obligation_sc84_patch",
          tool: "apply_patch",
          status: "applied",
          resultClass:
            "patch_applied",
          files: [{
            path:
              "src/evidence-lane.js",
            operation: "update",
            beforeEvidenceKey:
              sourceDigest,
            afterEvidenceKey:
              "sha256:fixture-sc84-after",
            addedLineCount: 4,
            removedLineCount: 1,
          }],
          workspaceEffectSummaryId:
            "effect_sc84_patch",
          workspaceEffectSummary: {
            effectSummaryId:
              "effect_sc84_patch",
            changedPathCount: 1,
            knownPathCount: 1,
            omittedPathCount: 0,
            unexpectedPathCount: 0,
            blockedPathCount: 0,
            sensitivePathCount: 0,
            changedPathsPreview: [
              "src/evidence-lane.js",
            ],
            changedPathsTruncated:
              false,
            scan: {
              ran: true,
              supported: true,
              scanFailed: false,
              scanScope:
                "bounded_project_workspace",
            },
            policyEvaluation: {
              strictestDecision:
                "allowed",
            },
            providerVisibility: {
              providerVisibilityCompleteness:
                "summary_only",
            },
          },
          sideEffectExecuted: true,
          authorityTransition: {
            transitionKind:
              "apply_patch",
          },
          appliedAt: iso(),
        },
        {
          schema:
            "direct_command_execution_result@1",
          resultId:
            "result_sc84_test",
          obligationId:
            "obligation_sc84_test",
          tool: "run_command",
          status: "completed",
          resultClass:
            "command_completed",
          displayCommand:
            "npm test -- evidence-lane",
          cwdRelPath: ".",
          exitCode: 0,
          durationMs: 620,
          stdout: {
            textPreview:
              "1 test passed",
            truncated: false,
          },
          stderr: {
            textPreview: "",
            truncated: false,
          },
          commandOutputRedaction: {
            providerOutputAllowed:
              true,
          },
          workspaceEffectSummaryId:
            "effect_sc84_test",
          workspaceEffectSummary: {
            effectSummaryId:
              "effect_sc84_test",
            changedPathCount: 0,
            knownPathCount: 0,
            omittedPathCount: 0,
            unexpectedPathCount: 0,
            blockedPathCount: 0,
            sensitivePathCount: 0,
            changedPathsPreview: [],
            changedPathsTruncated:
              false,
            scan: {
              ran: true,
              supported: true,
              scanFailed: false,
              scanScope:
                "bounded_project_workspace",
            },
            policyEvaluation: {
              strictestDecision:
                "allowed",
            },
            providerVisibility: {
              providerVisibilityCompleteness:
                "none",
            },
          },
          sideEffectExecuted: true,
          authorityTransition: {
            transitionKind:
              "run_command",
          },
          recordedAt: iso(),
        },
      ],
      continuationRequests: [{
        continuationId:
          "continuation_sc84",
      }],
    },
    finalAssistantText: finalText,
    observedAt: iso(),
  };
  executionEvidenceSourceDigest =
    "sha256:fixture-sc84-after";
  const acquired =
    await service
      .captureAroExecutionEvidence({
        projectId: project.id,
        handoffRunId:
          handoffRun.runId,
        handoffRunDigest:
          handoffRun.digest,
        observationRequestId:
          "sc84_observation_terminal",
        semanticRegionBindingRef:
          binding,
        actorId: "operator",
      });
  assert.equal(
    acquired.receipt.state,
    "acquired",
  );
  assert.equal(
    acquired.receipt
      .workspaceMutationObserved,
    true,
  );
  assert.equal(
    acquired.receipt
      .workspaceMutationEffect,
    false,
  );
  const evidenceBundle =
    acquired.projection
      .aroRegistry
      .executionEvidenceBundles[0];
  assert.equal(
    evidenceBundle.captureState,
    "acquired",
  );
  assert.equal(
    evidenceBundle.workerTurn
      .finalOutputPresent,
    true,
  );
  assert.equal(
    evidenceBundle.toolResults
      .length,
    3,
  );
  assert.equal(
    evidenceBundle
      .workspaceMutationObserved,
    true,
  );
  assert.equal(
    evidenceBundle
      .repositoryAfterState
      .changedSelectedPathCount,
    1,
  );
  assert.equal(
    evidenceBundle
      .verificationCoverage[0]
      .coverageStatus,
    "observed",
  );
  assert.equal(
    evidenceBundle
      .semanticTruthValidated,
    false,
  );
  assert.equal(
    evidenceBundle
      .closureCertified,
    false,
  );
  assert.equal(
    acquired.projection
      .aroRegistry
      .workspaceEffectsExecuted,
    true,
  );
  assert.equal(
    acquired.projection
      .aroRegistry
      .executionEvidenceValidatesSemanticTruth,
    false,
  );
  const reusedEvidence =
    await service
      .captureAroExecutionEvidence({
        projectId: project.id,
        handoffRunId:
          handoffRun.runId,
        handoffRunDigest:
          handoffRun.digest,
        observationRequestId:
          "sc84_observation_terminal",
        semanticRegionBindingRef:
          binding,
        actorId: "operator",
      });
  assert.equal(
    reusedEvidence.receipt.reused,
    true,
  );
  assert.equal(
    store
      .listAroExecutionEvidenceBundles({
        handoffRunId:
          handoffRun.runId,
      }).length,
    2,
  );
  executionEvidenceProjection =
    acquired.projection;
  if (
    process.env
      .CODEX_WORLD_MANAGER_SC85_ASSERT ===
    "1"
  ) {
    const verified =
      await service
        .verifyAroRealization({
          projectId: project.id,
          evidenceBundleId:
            evidenceBundle
              .evidenceBundleRef.id,
          evidenceBundleDigest:
            evidenceBundle
              .evidenceBundleRef.digest,
          semanticRegionBindingRef:
            binding,
          actorId: "operator",
        });
    assert.equal(
      verified.receipt.state,
      "completed",
    );
    assert.equal(
      verified.receipt
        .canonicalAdmissionEffect,
      false,
    );
    assert.equal(
      verified.receipt
        .canonicalAdmissionAvailable,
      false,
    );
    const assessment =
      verified.projection
        .aroRegistry
        .semanticVerificationAssessments[0];
    const closureCandidate =
      verified.projection
        .aroRegistry
        .closureCandidates[0];
    const verificationRun =
      verified.projection
        .aroRegistry
        .semanticVerificationRuns[0];
    assert.ok(assessment);
    assert.ok(closureCandidate);
    assert.equal(
      assessment
        .semanticTruthCanonical,
      false,
    );
    assert.equal(
      closureCandidate
        .canonicalAdmissionAvailable,
      false,
    );
    assert.equal(
      closureCandidate
        .closureCertified,
      false,
    );
    assert.equal(
      verificationRun
        .openDecisionRefs.length,
      1,
    );
    assert.equal(
      verified.projection
        .decisionSummary
        .openDecisions
        .some((decision) =>
          decision.decisionId ===
            verificationRun
              .openDecisionRefs[0].id),
      true,
    );
    const omissionRuntime =
      new DirectAroSemanticVerificationRuntime({
        runner: async () => ({
          actionCalls: [{
            callId:
              "call_sc85_omission",
            name:
              ARO_SEMANTIC_VERIFICATION_ACTION,
            argumentsJson:
              JSON.stringify({
                overallPosture:
                  "inconclusive",
                assessmentSummary:
                  "The discharge intentionally omitted exact contract objects.",
                obligationAssessments: [],
                verificationAssessments: [],
                preservationAssessments: [],
                branchAssessments: [],
                driftFindings: [],
                continuationPaths: [],
                openDecisions: [],
                closureRecommendation:
                  "ready_for_review",
                closureRationale:
                  "This optimistic recommendation must not override harness coverage.",
              }),
          }],
        }),
        now,
      });
    const omissionResult =
      await omissionRuntime.run({
        projectId: project.id,
        project,
        bundle:
          store
            .aroExecutionEvidenceBundleById(
              evidenceBundle
                .evidenceBundleRef.id,
            ),
        contract,
        mappingWitnessRef:
          mappingWitness
            .mappingWitnessId
            ? {
                kind:
                  "aro_realization_mapping_witness",
                id:
                  mappingWitness
                    .mappingWitnessId,
                digest:
                  mappingWitness.digest,
                projectId:
                  project.id,
              }
            : null,
        comparison,
        currentAro,
        targetAro,
        attempt: 99,
      });
    assert.equal(
      omissionResult.state,
      "completed",
    );
    assert.equal(
      omissionResult.assessment
        .synthesizedAssessmentCount,
      contract
        .implementationObligations
        .length +
        contract
          .verificationRequirements
          .length +
        contract
          .preservationConstraints
          .length +
        targetAro.branches.length,
    );
    assert.equal(
      omissionResult.closureCandidate
        .gateReady,
      false,
    );
    assert.notEqual(
      omissionResult.closureCandidate
        .gateDisposition,
      "ready_for_review",
    );
    const runtimeInput = {
      projectId: project.id,
      project,
      bundle:
        store
          .aroExecutionEvidenceBundleById(
            evidenceBundle
              .evidenceBundleRef.id,
          ),
      contract,
      mappingWitnessRef: {
        kind:
          "aro_realization_mapping_witness",
        id:
          mappingWitness
            .mappingWitnessId,
        digest:
          mappingWitness.digest,
        projectId: project.id,
      },
      comparison,
      currentAro,
      targetAro,
      attempt: 100,
    };
    const malformed =
      await new DirectAroSemanticVerificationRuntime({
        runner: async () => ({
          actionCalls: [],
        }),
        now,
      }).run(runtimeInput);
    assert.equal(
      malformed.state,
      "remanded",
    );
    const providerFailure =
      await new DirectAroSemanticVerificationRuntime({
        runner: async () => {
          const error = new Error(
            "fixture semantic verifier unavailable",
          );
          error.code =
            "fixture_semantic_verifier_unavailable";
          throw error;
        },
        now,
      }).run({
        ...runtimeInput,
        attempt: 101,
      });
    assert.equal(
      providerFailure.state,
      "failed",
    );
    assert.equal(
      providerFailure.error.code,
      "fixture_semantic_verifier_unavailable",
    );
    semanticVerificationProjection =
      verified.projection;
  }
  executionEvidenceSourceDigest =
    "";
}

sourceChanged = true;
await assert.rejects(
  service.authorizeAroWorkerHandoff({
    projectId: project.id,
    constitutionId:
      constitution
        .workerConstitutionId,
    constitutionDigest:
      constitution.digest,
    semanticRegionBindingRef:
      binding,
    operatorActionId:
      "operator_action_changed_source",
    actorId: "operator",
  }),
  (error) =>
    error.code ===
    "world_manager_aro_worker_constitution_stale",
);
assert.equal(
  runtimeStartCount,
  1,
);
sourceChanged = false;

const restartAuthorization =
  buildAroWorkerAuthorizationReceipt({
    constitution,
    actorId: "operator",
    operatorActionId:
      "operator_action_restart",
    now,
  });
store.registerAroWorkerAuthorization({
  authorization:
    restartAuthorization,
});
const interrupted =
  store.scheduleAroWorkerHandoffRun({
    constitution,
    authorization:
      restartAuthorization,
    createdAt: iso(),
  });
assert.equal(
  interrupted.run.state,
  "scheduled",
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC84_ASSERT ===
  "1"
) {
  const handedOffRun =
    store
      .listAroWorkerHandoffRuns({
        projectId: project.id,
        currentOnly: true,
      })
      .find((run) =>
        run.state === "handed_off");
  assert.ok(handedOffRun);
  const interruptedEvidence =
    store
      .scheduleAroExecutionEvidenceRun({
        handoffRun:
          handedOffRun,
        observationRequestId:
          "sc84_restart_observation",
        createdAt: iso(),
      });
  assert.equal(
    interruptedEvidence.run.state,
    "scheduled",
  );
  interruptedEvidenceRunId =
    interruptedEvidence.run.runId;
  if (
    process.env
      .CODEX_WORLD_MANAGER_SC85_ASSERT ===
    "1"
  ) {
    const acquiredBundle =
      store
        .listAroExecutionEvidenceBundles({
          projectId: project.id,
          limit: 20,
        })
        .find((bundle) =>
          bundle.captureState ===
            "acquired");
    assert.ok(acquiredBundle);
    const interruptedVerification =
      store
        .scheduleAroSemanticVerificationRun({
          bundle: acquiredBundle,
          attempt: 2,
          createdAt: iso(),
        });
    assert.equal(
      interruptedVerification
        .run.state,
      "scheduled",
    );
    interruptedVerificationRunId =
      interruptedVerification.run.runId;
  }
}
store.close();

const restartedStore =
  new DirectWorldManagerControlPlaneStore({
    rootDir,
    now,
  });
const restartedService =
  new DirectWorldManagerService({
    store: restartedStore,
    projects: [project],
    activeProjectId: project.id,
    userWorldId:
      "user_world_sc83",
    workThreadStore,
    roleRuntime,
    aroRealizationContextProvider:
      async () =>
        contextObservation(),
    aroWorkerCapabilityProvider:
      async () => capabilityInput(),
    aroWorkerRuntime: {
      available: () => true,
      start: async () => {
        throw new Error(
          "restart must not replay",
        );
      },
    },
    ...(
      process.env
        .CODEX_WORLD_MANAGER_SC84_ASSERT ===
      "1"
        ? {
            aroWorkerEvidenceProvider:
              async () => {
                throw new Error(
                  "restart must not replay evidence acquisition",
                );
              },
          }
        : {}
    ),
    ...(
      process.env
        .CODEX_WORLD_MANAGER_SC85_ASSERT ===
      "1"
        ? {
            aroSemanticVerificationRuntime:
              new DirectAroSemanticVerificationRuntime({
                runner: async () => {
                  throw new Error(
                    "restart must not replay semantic verification",
                  );
                },
                now,
              }),
          }
        : {}
    ),
    now,
  });
restartedService.bootstrap();
const recovered =
  restartedStore
    .listAroWorkerHandoffRuns({
      currentOnly: true,
    })
    .find((run) =>
      run.runId ===
        interrupted.run.runId);
validateAroWorkerHandoffRun(
  recovered,
);
assert.equal(
  recovered.state,
  "failed",
);
assert.equal(
  recovered.error.code,
  "world_manager_aro_worker_handoff_runtime_restart",
);
assert.equal(
  recovered.retryable,
  false,
);
if (interruptedEvidenceRunId) {
  const recoveredEvidence =
    restartedStore
      .listAroExecutionEvidenceRuns({
        currentOnly: true,
      })
      .find((run) =>
        run.runId ===
          interruptedEvidenceRunId);
  assert.ok(recoveredEvidence);
  assert.equal(
    recoveredEvidence.state,
    "failed",
  );
  assert.equal(
    recoveredEvidence.error.code,
    "world_manager_aro_execution_evidence_runtime_restart",
  );
  assert.equal(
    recoveredEvidence.retryable,
    true,
  );
}
if (interruptedVerificationRunId) {
  const recoveredVerification =
    restartedStore
      .listAroSemanticVerificationRuns({
        currentOnly: true,
      })
      .find((run) =>
        run.runId ===
          interruptedVerificationRunId);
  assert.ok(recoveredVerification);
  assert.equal(
    recoveredVerification.state,
    "failed",
  );
  assert.equal(
    recoveredVerification.error.code,
    "world_manager_aro_semantic_verification_runtime_restart",
  );
  assert.equal(
    recoveredVerification.retryable,
    true,
  );
}

if (
  process.env
    .CODEX_WORLD_MANAGER_SC83_READY_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC83_READY_PROJECTION_PATH,
    `${JSON.stringify(
      prepared.projection,
      null,
      2,
    )}\n`,
  );
}
if (
  process.env
    .CODEX_WORLD_MANAGER_SC83_HANDED_OFF_PROJECTION_PATH
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC83_HANDED_OFF_PROJECTION_PATH,
    `${JSON.stringify(
      authorized.projection,
      null,
      2,
    )}\n`,
  );
}
if (
  process.env
    .CODEX_WORLD_MANAGER_SC84_EVIDENCE_PROJECTION_PATH &&
  executionEvidenceProjection
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC84_EVIDENCE_PROJECTION_PATH,
    `${JSON.stringify(
      executionEvidenceProjection,
      null,
      2,
    )}\n`,
  );
}
if (
  process.env
    .CODEX_WORLD_MANAGER_SC85_VERIFICATION_PROJECTION_PATH &&
  semanticVerificationProjection
) {
  fs.writeFileSync(
    process.env
      .CODEX_WORLD_MANAGER_SC85_VERIFICATION_PROJECTION_PATH,
    `${JSON.stringify(
      semanticVerificationProjection,
      null,
      2,
    )}\n`,
  );
}

restartedStore.close();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify({
    ok: true,
    slice:
      process.env
        .CODEX_WORLD_MANAGER_SC85_ASSERT ===
      "1"
        ? "WM-SC8.5"
        : process.env
        .CODEX_WORLD_MANAGER_SC84_ASSERT ===
      "1"
        ? "WM-SC8.4"
        : "WM-SC8.3",
    workerConstitutionState:
      constitution.constitutionState,
    singleUseAuthorization: true,
    workerStartCount:
      runtimeStartCount,
    nativeWorkerStartBound: true,
    sourceChangeBlocked: true,
    restartReplayPrevented: true,
    compiledInstructionsProjected:
      false,
    workspaceMutationEffect: false,
    remoteMutationEffect: false,
    canonicalAdmissionEffect: false,
    semanticClosureCertified: false,
    ...(
      executionEvidenceProjection
        ? {
            executionEvidenceAcquired:
              true,
            workspaceMutationObserved:
              true,
            evidenceCoverageMechanicalOnly:
              true,
          }
        : {}
    ),
    ...(
      semanticVerificationProjection
        ? {
            semanticVerificationCompleted:
              true,
            closureCandidateOnly:
              true,
            omittedObjectsMaterialized:
              true,
            optimisticRecommendationCannotOverrideGate:
              true,
            semanticVerificationRestartRecovered:
              true,
            generatedDecisionCount:
              semanticVerificationProjection
                .aroRegistry
                .semanticVerificationRuns[0]
                .openDecisionRefs
                .length,
          }
        : {}
    ),
  }),
);
