"use strict";

const { EventEmitter } = require("node:events");
const {
  WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
  assertWorldManagerWorkbenchProjectionSafe,
  buildWorldManagerWorkbenchProjection,
  digestFor,
  normalizeWorldManagerSubmitRequest,
  stableId,
} = require("./control-plane");
const {
  settleWorldManagerIngress,
} = require("./settlement");
const {
  DirectWorldManagerWorldmodelBootstrap,
  WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA,
} = require("./worldmodel-bootstrap");
const {
  COMPILER_REVISION,
  compileWorldManagerAgentWorld,
} = require("./agent-world-compiler");
const {
  trustedRoleTemplateRegistry,
} = require("./role-template-registry");
const {
  buildReconciliationCompilation,
  reconciliationPrompt,
} = require("./role-runtime");
const {
  buildProjectConstitutionCandidate,
  trustedRealizationEvidence,
  validateRealizationOptionSnapshot,
} = require("./project-genesis");
const {
  buildChildEnvironmentInheritance,
  buildEnvironmentProbeReceipt,
  buildProjectWorkspaceBinding,
  buildProjectWorkspaceLocator,
  buildStepEnvironmentSnapshot,
  buildThreadEnvironmentBinding,
  environmentProbeRef,
  stepEnvironmentSnapshotRef,
  threadEnvironmentBindingRef,
  workspaceBindingRef,
} = require("./project-substrate-runtime");
const {
  ACTION_NAMES,
  DirectWorldManagerSemanticIngressRuntime,
} = require("./semantic-ingress-runtime");
const {
  buildTrustedDiscourseEvidence,
} = require("./discourse-evidence");
const {
  semanticSplitJoinPrompt,
} = require("./semantic-child-orchestration");
const {
  abstractReasoningObjectRef,
  aroReconstructionCandidateRef,
  buildAroCurrentTargetComparison,
} = require("./aro-kernel");
const {
  buildRepositorySemanticSnapshot,
  reviseAroReconstructionRun,
} = require("./aro-reconstruction-runtime");
const {
  mutationContractRef,
  reviseAroMutationCompilationRun,
} = require("./aro-mutation-contract");
const {
  buildAroRealizationContextImport,
  deriveRealizationContextPathRequest,
  realizationContextImportRef,
  realizationMappingWitnessRef,
  reviseAroRealizationMappingRun,
} = require("./aro-realization-mapping");
const {
  reviseAroTargetDefinitionRun,
} = require("./aro-target-definition");
const {
  aroWorkerPrompt,
  buildAroWorkerAuthorizationReceipt,
  buildAroWorkerCapabilityObservation,
  buildAroWorkerConstitution,
  buildAroWorkerReviewReceipt,
  buildAroWorkerRoleHandoffPacket,
  buildAroWorkerSourceFreshnessWitness,
  reviseAroWorkerHandoffRun,
  workerConstitutionRef,
} = require("./aro-worker-handoff");
const {
  buildAroExecutionEvidenceBundle,
  evidenceBundleRef,
  reviseAroExecutionEvidenceRun,
} = require("./aro-execution-evidence");
const {
  assessmentRef,
  closureCandidateRef,
  reviseAroSemanticVerificationRun,
} = require("./aro-semantic-verification");
const {
  buildAppliedContextCanvas,
  buildThoughtBrushAroCandidate,
  buildThoughtBrushRequest,
  buildUndoContextCanvas,
  contextCanvasRef,
  thoughtBrushRegistry,
  thoughtBrushStrokeRef,
  validateContextCanvasInsightExtractionRequest,
} = require("./thought-brush");
const {
  buildImplementationContract,
  buildPlanAdmissionDecision,
  buildPlanProposalRevision,
  planProposalRef,
} = require("./plan-proposal-lifecycle");
const {
  buildPlanExecutionAuthorization,
  buildPlanExecutionClosureEvaluation,
  buildPlanExecutionConstitution,
  buildPlanExecutionHandoff,
  buildPlanExecutionRecord,
  planExecutionRecordRef,
  planExecutionWorkerPrompt,
  revisePlanExecutionRecord,
  validateImplementationContract,
} = require("./plan-execution-continuation");
const {
  validatePlanExecutionClosureAssessment,
} = require("./plan-execution-closure-runtime");
const {
  buildOdeuResultEnvelope,
} = require("../odeu/result");
const {
  buildProjectMemoryCandidate,
  buildProjectToWorldStatusProjection,
  buildWorkThreadClosureEvidenceWitness,
} = require("../worldmodel/project-memory-propagation");

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function serviceFail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function workspaceRequestMatchesLocator(workspace = {}, locator = {}) {
  if (!workspace || typeof workspace !== "object") return true;
  const requestedKind = normalizeString(workspace.kind, "");
  if (requestedKind && requestedKind !== locator.workspaceKind) return false;
  const requestedPath = normalizeString(
    requestedKind === "windows"
      ? workspace.windowsPath || workspace.localPath
      : requestedKind === "wsl"
        ? workspace.linuxPath
        : workspace.localPath,
    "",
  );
  if (!requestedPath) return true;
  const normalizePath = (value) => String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
  const requested = normalizePath(requestedPath);
  const existing = normalizePath(locator.nativeWorkspacePath);
  if (locator.workspaceKind === "windows") {
    if (requested.toLowerCase() !== existing.toLowerCase()) return false;
  } else if (requested !== existing) {
    return false;
  }
  const requestedDistro = normalizeString(workspace.distro, "");
  return !requestedDistro || requestedDistro === locator.distro;
}

function rendererSafeError(error) {
  return {
    schema: "direct_world_manager_error@1",
    code: normalizeString(error?.code, "world_manager_unknown_error"),
    message: normalizeString(error?.message, "WorldManager request failed."),
    detail: normalizeString(error?.detail, ""),
    grantsAuthority: false,
  };
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
    right &&
    left.id === right.id &&
    left.digest === right.digest,
  );
}

function exactExecutionRef(value = {}, label = "execution_ref") {
  const ref = {
    kind: normalizeString(value.kind, ""),
    id: normalizeString(value.id || value.artifactId, ""),
    digest: normalizeString(value.digest || value.artifactDigest, ""),
    ...(normalizeString(value.projectId, "")
      ? { projectId: normalizeString(value.projectId, "") }
      : {}),
  };
  if (
    !ref.kind ||
    !ref.id ||
    !/^sha256:[a-f0-9]{64}$/i.test(ref.digest)
  ) {
    serviceFail("world_manager_plan_execution_ref_invalid", label);
  }
  return ref;
}

function semanticExecutionSourceRef(ref, observedAt, sourceKind = "family_specific") {
  const exact = exactExecutionRef(ref);
  return {
    sourceRefId: stableId("wm_plan_execution_source_ref", exact),
    sourceKind,
    sourceId: exact.id,
    sourceConfidence: "exact",
    freshness: "fresh",
    observedAt,
    sourceDigest: {
      algorithm: "sha256",
      value: exact.digest,
      digestOf: "canonical_json",
    },
  };
}

function exactRefVectorMatches(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((candidate) =>
    b.some((entry) =>
      candidate?.kind === entry?.kind &&
      exactRefMatches(candidate, entry)));
}

function exactAdmissionScopeMatches(left = {}, right = {}) {
  return (
    normalizeString(left.kind, "") === normalizeString(right.kind, "") &&
    normalizeString(left.projectId, "") ===
      normalizeString(right.projectId, "") &&
    normalizeString(left.workThreadId, "") ===
      normalizeString(right.workThreadId, "") &&
    normalizeString(left.taskType, "") ===
      normalizeString(right.taskType, "")
  );
}

function verifySemanticRegionBinding(
  projection,
  bindingRef,
  subject = {},
) {
  if (!bindingRef) return null;
  const binding =
    projection?.semanticSurface
      ?.regionBindings?.find((entry) =>
        bindingRef.kind ===
          "semantic_region_binding" &&
        entry.semanticRegionBindingId ===
          bindingRef.id &&
        entry.digest ===
          bindingRef.digest);
  if (
    !binding ||
    binding.subjectRef?.kind !==
      subject.kind ||
    binding.subjectRef?.id !== subject.id ||
    binding.subjectRef?.digest !==
      subject.digest ||
    binding.staleBinding === true
  ) {
    const error = new Error(
      "world_manager_semantic_region_binding_invalid",
    );
    error.code =
      "world_manager_semantic_region_binding_invalid";
    throw error;
  }
  return binding;
}

function historicalCompilationBindingMismatches(input = {}) {
  const compilation = input.compilation || {};
  const manifest = compilation.manifest || {};
  const taskSettlement = input.taskSettlement || {};
  const contextBundle = input.contextBundle || {};
  const mismatches = [];
  if (
    compilation.semanticEventId !== taskSettlement.semanticEventId ||
    !exactRefMatches(
      compilation.taskSettlementRef,
      {
        id: taskSettlement.taskSettlementId,
        digest: taskSettlement.digest,
      },
    )
  ) {
    mismatches.push("task_settlement");
  }
  if (
    !exactRefMatches(
      manifest.graphRef,
      contextBundle.graphRef,
    )
  ) {
    mismatches.push("graph");
  }
  if (
    !exactRefMatches(
      manifest.graphProjectionRef,
      contextBundle.projectionRef,
    )
  ) {
    mismatches.push("graph_projection");
  }
  if (
    !exactRefMatches(
      manifest.bootPacketRef,
      contextBundle.bootPacketRef,
    )
  ) {
    mismatches.push("boot_packet");
  }
  if (
    JSON.stringify(manifest.worldstateRevisionRefs || []) !==
      JSON.stringify(
        compilation.agentInstantiation
          ?.sourceScopeRevisions || [],
      )
  ) {
    mismatches.push("worldstate_revisions");
  }
  if (
    compilation.compilationState !== "validated_ready_for_k4" ||
    compilation.projectionAgreement?.state !== "validated" ||
    compilation.projectionAgreement?.launchEligible !== true ||
    compilation.providerRequestCreated !== false ||
    compilation.rendererInstructionInputAccepted !== false ||
    compilation.canonicalWorldstateMutation !== false ||
    compilation.grantsAuthority !== false
  ) {
    mismatches.push("validated_launch_boundary");
  }
  return mismatches;
}

class DirectWorldManagerService extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.store) throw new Error("world_manager_service_store_required");
    this.store = options.store;
    this.workThreadStore = options.workThreadStore || null;
    this.planProposalLifecycleEnabled =
      options.planProposalLifecycleEnabled === true;
    this.roleRuntime = options.roleRuntime || null;
    this.epistemicFabric = options.epistemicFabric || null;
    this.realizationSnapshotProvider =
      typeof options.realizationSnapshotProvider === "function"
        ? options.realizationSnapshotProvider
        : null;
    this.projectSubstrateProvisioner =
      typeof options.projectSubstrateProvisioner === "function"
        ? options.projectSubstrateProvisioner
        : null;
    this.environmentReadinessProvider =
      typeof options.environmentReadinessProvider === "function"
        ? options.environmentReadinessProvider
        : null;
    this.repositorySnapshotProvider =
      typeof options.repositorySnapshotProvider ===
        "function"
        ? options.repositorySnapshotProvider
        : null;
    this.aroReconstructionRuntime =
      options.aroReconstructionRuntime || null;
    this.automaticAroReconstructionEnabled =
      options.automaticAroReconstructionEnabled !== false;
    this.aroReconstructionJobs =
      new Map();
    this.aroAutomaticallyObservedProjects =
      new Set();
    this.aroReconstructionGeneration =
      0;
    this.aroMutationRuntime =
      options.aroMutationRuntime || null;
    this.aroMutationJobs = new Map();
    this.aroRealizationContextProvider =
      typeof options.aroRealizationContextProvider ===
        "function"
        ? options.aroRealizationContextProvider
        : null;
    this.aroRealizationMappingRuntime =
      options.aroRealizationMappingRuntime ||
      null;
    this.aroRealizationMappingJobs =
      new Map();
    this.aroWorkerCapabilityProvider =
      typeof options.aroWorkerCapabilityProvider ===
        "function"
        ? options.aroWorkerCapabilityProvider
        : null;
    this.aroWorkerRuntime =
      options.aroWorkerRuntime || null;
    this.planExecutionRuntime =
      options.planExecutionRuntime || null;
    this.aroWorkerEvidenceProvider =
      typeof options.aroWorkerEvidenceProvider ===
        "function"
        ? options.aroWorkerEvidenceProvider
        : null;
    this.aroSemanticVerificationRuntime =
      options.aroSemanticVerificationRuntime ||
      null;
    this.aroTargetDefinitionRuntime =
      options.aroTargetDefinitionRuntime ||
      null;
    this.thoughtBrushRuntime =
      options.thoughtBrushRuntime ||
      null;
    this.cachedRealizationSnapshot = null;
    this.userWorldId = normalizeString(options.userWorldId, "user_world_local");
    this.projects = Array.isArray(options.projects) ? options.projects : [];
    this.activeProjectId = normalizeString(options.activeProjectId, "");
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.semanticIngress =
      options.semanticIngressRuntime ||
      new DirectWorldManagerSemanticIngressRuntime({
        runner: options.semanticIngressRunner,
        now: this.now,
      });
    this.worldmodel = options.worldmodel || new DirectWorldManagerWorldmodelBootstrap({
      rootDir: options.worldmodelRootDir || this.store.rootDir,
      now: this.now,
    });
    this.worldmodelBinding = null;
    this.restartContextVerification = {
      checked: 0,
      valid: true,
      mismatches: [],
    };
    this.restartAgentWorldVerification = {
      checked: 0,
      valid: true,
      mismatches: [],
      historicalCompilerAccepted: [],
    };
    this.semanticHistoryReconstruction = {
      changed: false,
      reconstructedCount: 0,
      contemporaneousCount: 0,
      shelfCount: 0,
      projectionRevision: 0,
    };
    this.semanticDecisionKernelSynchronization = {
      changed: 0,
      reused: 0,
      artifactCount: 0,
      rebuiltSemanticShelfCount: 0,
      projectionRevision: 0,
    };
    this.semanticContextPreparation = {
      prepared: 0,
      reused: 0,
      fresh: 0,
      stale: 0,
      blocked: 0,
    };
    this.started = false;
    this.readyPromise = null;
  }

  configure(options = {}) {
    if (Array.isArray(options.projects)) this.projects = options.projects;
    if (typeof options.activeProjectId === "string") {
      this.activeProjectId = normalizeString(options.activeProjectId, this.activeProjectId);
    }
    if (typeof options.userWorldId === "string") {
      this.userWorldId = normalizeString(options.userWorldId, this.userWorldId);
    }
    return this.bootstrap();
  }

  realizationSnapshot() {
    if (this.cachedRealizationSnapshot) {
      return this.cachedRealizationSnapshot;
    }
    if (!this.realizationSnapshotProvider) {
      const error = new Error(
        "world_manager_project_genesis_realization_discovery_unavailable",
      );
      error.code =
        "world_manager_project_genesis_realization_discovery_unavailable";
      throw error;
    }
    const provided = this.realizationSnapshotProvider();
    const snapshot = provided?.snapshot || provided;
    validateRealizationOptionSnapshot(snapshot);
    this.cachedRealizationSnapshot = snapshot;
    return snapshot;
  }

  compilationEnvironment(taskSettlement, trustedEvidenceArtifacts = []) {
    if (taskSettlement.taskType !== "project_initialization") {
      return "local_repository";
    }
    return normalizeString(
      trustedEvidenceArtifacts[0]?.controlPlaneEnvironmentId,
      "world_control_plane",
    );
  }

  trustedEvidenceForTask(taskSettlement, persisted) {
    if (Array.isArray(persisted)) return persisted;
    if (taskSettlement.taskType === "project_initialization") {
      return [trustedRealizationEvidence(this.realizationSnapshot())];
    }
    const semanticIngress =
      this.store.semanticIngressForSemanticEvent(
        taskSettlement.semanticEventId,
      );
    if (
      semanticIngress?.semanticDischarge?.actionName ===
        ACTION_NAMES.WORLD_INTROSPECTION
    ) {
      const discourseEvidence = buildTrustedDiscourseEvidence({
        store: this.store,
        currentSemanticEventId:
          taskSettlement.semanticEventId,
      });
      return discourseEvidence ? [discourseEvidence] : [];
    }
    return [];
  }

  prepareOperationalMetaContext(
    taskSettlement,
    compilation,
    options = {},
  ) {
    const prepared =
      this.store.prepareOperationalMetaContext({
        taskSettlement,
        compilation,
        userWorldId: this.userWorldId,
        purpose: options.purpose,
      });
    if (
      prepared.bundle.freshness !== "fresh"
    ) {
      const error = new Error(
        "world_manager_operational_meta_context_not_fresh",
      );
      error.code =
        "world_manager_operational_meta_context_not_fresh";
      error.freshness = prepared.bundle.freshness;
      error.selectionWitness =
        prepared.selectionWitness;
      throw error;
    }
    return prepared;
  }

  bootstrap() {
    const firstStart = !this.started;
    const result = this.store.ensureBootstrap({
      userWorldId: this.userWorldId,
      projects: this.projects,
    });
    const manifest = result.manifest;
    this.epistemicFabric?.bootstrap?.({
      projectIds: manifest.projects.map((project) => project.projectId),
    });
    const requestedFocus = this.activeProjectId;
    const storedFocus = this.store.focusedProjectId();
    const focus = manifest.projects.some((project) => project.projectId === storedFocus)
      ? storedFocus
      : manifest.projects.some((project) => project.projectId === requestedFocus)
        ? requestedFocus
        : manifest.projects[0]?.projectId || "";
    if (focus && this.store.focusedProjectId() !== focus) {
      this.store.setFocusedProject(focus);
    }
    const worldmodelState = this.worldmodel.ensure(manifest);
    this.worldmodelBinding = worldmodelState.binding;
    this.store.recordWorldmodelBinding(worldmodelState.binding);
    if (this.planProposalLifecycleEnabled) {
      this.recoverPlanProposalAdmissions();
    }
    this.semanticHistoryReconstruction =
      this.store.reconstructSemanticHistory();
    this.semanticDecisionKernelSynchronization =
      this.store.synchronizeSemanticDecisionKernel();
    for (const settlement of this.store.listSettlements({ limit: 1000 })) {
      if (
        settlement.state !== "settled" ||
        this.store.agentWorldForSemanticEvent(settlement.semanticEventId)
      ) {
        continue;
      }
      const event = this.store.eventBySemanticEventId(
        settlement.semanticEventId,
      );
      const message = this.store.messageForEvent(
        settlement.semanticEventId,
      ) || this.store.semanticChildMessageForEvent(
        settlement.semanticEventId,
      );
      if (!event || !message) {
        const error = new Error(
          "world_manager_k3_repair_lineage_missing",
        );
        error.code = "world_manager_k3_repair_lineage_missing";
        throw error;
      }
      this.settleIngress({
        event,
        message,
        request: {
          scopeHint: {
            projectId: event.projectId,
            proposalId: "",
            workThreadId: "",
          },
        },
      });
    }
    const contextPreparation = {
      prepared: 0,
      reused: 0,
      fresh: 0,
      stale: 0,
      blocked: 0,
    };
    for (
      const settlement of
        this.store.listSettlements({ limit: 1000 })
    ) {
      if (settlement.state !== "settled") continue;
      const stored =
        this.store.agentWorldForSemanticEvent(
          settlement.semanticEventId,
          { full: true },
        );
      if (!stored?.compilation) continue;
      const prepared =
        this.store.prepareOperationalMetaContext({
          taskSettlement: settlement,
          compilation: stored.compilation,
          userWorldId: this.userWorldId,
        });
      contextPreparation.prepared += 1;
      if (prepared.reused) {
        contextPreparation.reused += 1;
      }
      contextPreparation[
        prepared.bundle.freshness
      ] += 1;
      if (typeof this.roleRuntime?.registerCompilation === "function") {
        this.roleRuntime.registerCompilation(
          stored.compilation,
          prepared.binding,
        );
      }
    }
    this.semanticContextPreparation =
      contextPreparation;
    this.verifyRestartContexts();
    if (firstStart && this.roleRuntime) {
      this.store.recoverInterruptedRoleRuns();
      if (typeof this.roleRuntime.restoreResidents === "function") {
        this.roleRuntime.restoreResidents(
          this.store.listRoleRuns({ limit: 1000 }),
        );
      }
      for (
        const coordination
        of this.store.listSemanticSplitCoordinations()
      ) {
        if (
          !["executing", "joining"].includes(
            coordination.state,
          )
        ) {
          continue;
        }
        const parentEvent =
          this.store.eventBySemanticEventId(
            coordination.parentEventRef.id,
          );
        if (!parentEvent) continue;
        this.store.updateSemanticSplitCoordination({
          parentEvent,
          state: "interrupted",
          childOutcomes: coordination.childOutcomes,
          parentAgentResultRef:
            coordination.parentAgentResultRef,
          summary:
            "The Direct runtime restarted during semantic split orchestration. Persisted child outcomes remain available for idempotent continuation.",
        });
      }
    }
    if (
      firstStart &&
      this.aroReconstructionRuntime
    ) {
      this.store
        .recoverInterruptedAroReconstructionRuns();
    }
    if (
      firstStart &&
      this.aroMutationRuntime
    ) {
      this.store
        .recoverInterruptedAroMutationCompilationRuns();
    }
    if (
      firstStart &&
      this.aroRealizationMappingRuntime
    ) {
      this.store
        .recoverInterruptedAroRealizationMappingRuns();
    }
    if (
      firstStart &&
      this.aroWorkerRuntime
    ) {
      this.store
        .recoverInterruptedAroWorkerHandoffRuns();
    }
    if (
      firstStart &&
      this.aroWorkerEvidenceProvider &&
      this.aroRealizationContextProvider
    ) {
      this.store
        .recoverInterruptedAroExecutionEvidenceRuns();
    }
    if (
      firstStart &&
      this.aroSemanticVerificationRuntime
        ?.available?.()
    ) {
      this.store
        .recoverInterruptedAroSemanticVerificationRuns();
    }
    if (
      firstStart &&
      this.aroTargetDefinitionRuntime
    ) {
      this.store
        .recoverInterruptedAroTargetDefinitionRuns();
    }
    this.started = true;
    if (firstStart && this.planProposalLifecycleEnabled) {
      this.recoverPlanExecutions();
    }
    return {
      ...result,
      projection: this.snapshot(),
    };
  }

  ready() {
    if (this.readyPromise) return this.readyPromise;
    this.ensureStarted();
    this.readyPromise = (async () => {
      for (const pending of this.store.listUnsettledIngresses()) {
        if (
          this.store.semanticChildContractForEvent(
            pending.event.semanticEventId,
          )
        ) {
          continue;
        }
        await this.settleIngress({
          event: pending.event,
          message: pending.message,
          request: {
            scopeHint: {
              projectId: pending.event.projectId,
              proposalId: "",
              workThreadId: "",
              bindingPosture: "ambient_focus",
            },
          },
        });
      }
      if (this.roleRuntime) {
        for (
          const coordination
          of this.store.listSemanticSplitCoordinations()
        ) {
          if (
            !["materialized", "interrupted"].includes(
              coordination.state,
            )
          ) {
            continue;
          }
          const parentEvent =
            this.store.eventBySemanticEventId(
              coordination.parentEventRef.id,
            );
          const parentMessage =
            this.store.messageForEvent(
              coordination.parentEventRef.id,
            );
          const persisted =
            this.store.settlementForSemanticEvent(
              coordination.parentEventRef.id,
            );
          if (
            !parentEvent ||
            !parentMessage ||
            !persisted
          ) {
            continue;
          }
          const children =
            this.store.listSemanticChildContracts({
              parentSemanticEventId:
                parentEvent.semanticEventId,
            }).map((record) => ({
              ...record,
              event:
                this.store.eventBySemanticEventId(
                  record.contract
                    .childSemanticEventId,
                ),
              message:
                this.store
                  .semanticChildMessageForEvent(
                    record.contract
                      .childSemanticEventId,
                  ),
            }));
          if (
            children.length !==
              coordination.childEventRefs.length ||
            children.some((child) =>
              !child.event || !child.message)
          ) {
            this.store.updateSemanticSplitCoordination({
              parentEvent,
              state: "failed",
              childOutcomes:
                coordination.childOutcomes,
              parentAgentResultRef:
                coordination.parentAgentResultRef,
              summary:
                "Semantic split restart continuation failed visibly because persisted child lineage was incomplete.",
            });
            continue;
          }
          const parentSettlement = {
            ...persisted,
            agentWorld:
              this.store.agentWorldForSemanticEvent(
                parentEvent.semanticEventId,
              ),
          };
          await this.runSplitRolePipeline({
            request: {
              schema:
                WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
              clientRequestId:
                parentEvent.clientRequestId,
              text: parentMessage.text,
              scopeHint: {
                projectId: parentEvent.projectId,
                proposalId: "",
                workThreadId: "",
                bindingPosture: "ambient_focus",
              },
              expectedProjectionRevision: null,
              attachmentDraftRefs: [],
            },
            parentEvent,
            parentMessage,
            parentSettlement,
            materialized: {
              reused: true,
              coordination,
              children,
              projectionRevision:
                this.store.revision(),
            },
            initialResponse: {
              receipt: {
                schema:
                  "direct_world_manager_ingress_receipt@1",
                state: "reused",
                accepted: true,
                reused: true,
                remanded: false,
                semanticEventRef: {
                  kind:
                    "world_manager_semantic_event",
                  id:
                    parentEvent.semanticEventId,
                  digest:
                    parentEvent.eventDigest,
                  label:
                    "Durable user ingress",
                },
                settlementState:
                  "split_resuming",
                grantsAuthority: false,
              },
              projection: this.snapshot(),
            },
          });
        }
      }
      if (this.automaticAroReconstructionEnabled) {
        this.queueAutomaticAroReconstructions();
      }
      await this.epistemicFabric?.dispatchQueuedDeliveries?.();
      return this;
    })().finally(() => {
      this.readyPromise = null;
    });
    return this.readyPromise;
  }

  ensureStarted() {
    if (!this.started) this.bootstrap();
  }

  aroReconstructionAvailable() {
    return Boolean(
      this.repositorySnapshotProvider &&
      this.aroReconstructionRuntime
        ?.available?.(),
    );
  }

  aroMutationCompilationAvailable() {
    return Boolean(
      this.aroMutationRuntime
        ?.available?.(),
    );
  }

  aroTargetDefinitionAvailable() {
    return Boolean(
      this.aroTargetDefinitionRuntime
        ?.available?.(),
    );
  }

  aroRealizationMappingAvailable() {
    return Boolean(
      this.aroRealizationContextProvider &&
      this.aroRealizationMappingRuntime
        ?.available?.(),
    );
  }

  aroWorkerHandoffAvailable() {
    return Boolean(
      this.aroRealizationContextProvider &&
      this.aroWorkerCapabilityProvider &&
      this.aroWorkerRuntime
        ?.available?.() === true &&
      this.roleRuntime &&
      this.workThreadStore
        ?.upsertWorkThread,
    );
  }

  aroExecutionEvidenceAvailable() {
    return Boolean(
      this.aroWorkerEvidenceProvider &&
      this.aroRealizationContextProvider,
    );
  }

  aroSemanticVerificationAvailable() {
    return Boolean(
      this.aroSemanticVerificationRuntime
        ?.available?.() === true,
    );
  }

  thoughtBrushAvailable() {
    return Boolean(
      this.thoughtBrushRuntime
        ?.available?.() === true,
    );
  }

  projectSubstrateProvisioningAvailable() {
    return Boolean(
      this.projectSubstrateProvisioner &&
      this.workThreadStore?.upsertWorkThread,
    );
  }

  resolveAroMutationComparison(
    input = {},
  ) {
    const comparisonId =
      normalizeString(
        input.comparisonId,
        "",
      );
    const comparisonDigest =
      normalizeString(
        input.comparisonDigest,
        "",
      );
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    if (
      !comparisonId ||
      !comparisonDigest ||
      !projectId
    ) {
      const error = new Error(
        "world_manager_aro_mutation_comparison_ref_required",
      );
      error.code =
        "world_manager_aro_mutation_comparison_ref_required";
      throw error;
    }
    const aros =
      this.store
        .listAbstractReasoningObjects({
          projectId,
          currentOnly: true,
        });
    const byConcept = new Map();
    for (const aro of aros) {
      const scoped =
        byConcept.get(
          aro.conceptKey,
        ) || {};
      scoped[aro.posture] = aro;
      byConcept.set(
        aro.conceptKey,
        scoped,
      );
    }
    for (const scoped of byConcept.values()) {
      if (
        !scoped.current ||
        !scoped.target
      ) {
        continue;
      }
      const comparison =
        buildAroCurrentTargetComparison(
          scoped.current,
          scoped.target,
        );
      if (
        comparison.comparisonId ===
          comparisonId &&
        comparison.digest ===
          comparisonDigest
      ) {
        return {
          comparison,
          currentAro:
            scoped.current,
          targetAro:
            scoped.target,
        };
      }
    }
    const error = new Error(
      "world_manager_aro_mutation_comparison_stale_or_unknown",
    );
    error.code =
      "world_manager_aro_mutation_comparison_stale_or_unknown";
    throw error;
  }

  queueAroMutationCompilation(
    input = {},
  ) {
    if (
      !this.aroMutationCompilationAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_mutation_compiler_unavailable",
      );
      error.code =
        "world_manager_aro_mutation_compiler_unavailable";
      return Promise.reject(error);
    }
    const resolved =
      this.resolveAroMutationComparison(
        input,
      );
    const key =
      resolved.comparison.digest;
    const active =
      this.aroMutationJobs.get(key);
    if (active) return active;
    const job =
      this.runAroMutationCompilation({
        ...input,
        ...resolved,
      }).finally(() => {
        if (
          this.aroMutationJobs.get(
            key,
          ) === job
        ) {
          this.aroMutationJobs.delete(
            key,
          );
        }
      });
    this.aroMutationJobs.set(
      key,
      job,
    );
    return job;
  }

  async runAroMutationCompilation(
    input = {},
  ) {
    const {
      comparison,
      currentAro,
      targetAro,
    } = input;
    const scheduled =
      this.store
        .scheduleAroMutationCompilationRun({
          comparison,
          retry: input.retry === true,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      return {
        state: scheduled.run.state,
        reused: true,
        run: scheduled.run,
        contract:
          scheduled.run.contractRef
            ? this.store
                .aroMutationContractById(
                  scheduled.run
                    .contractRef.id,
                )
            : null,
      };
    }
    this.emit("transition", {
      reason:
        "aro-mutation-contract-scheduled",
      receipt: {
        schema:
          "direct_aro_mutation_orchestration_receipt@1",
        state: "scheduled",
        projectId:
          comparison.projectId,
        comparisonRef:
          scheduled.run.comparisonRef,
        runRef: {
          kind:
            "aro_mutation_compilation_run",
          id: scheduled.run.runId,
          digest:
            scheduled.run.digest,
          projectId:
            scheduled.run.projectId,
        },
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const running =
      reviseAroMutationCompilationRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroMutationCompilationRun({
        run: running,
      });
    this.emit("transition", {
      reason:
        "aro-mutation-contract-running",
      receipt: {
        schema:
          "direct_aro_mutation_orchestration_receipt@1",
        state: "running",
        projectId:
          comparison.projectId,
        comparisonRef:
          running.comparisonRef,
        runRef: {
          kind:
            "aro_mutation_compilation_run",
          id: running.runId,
          digest: running.digest,
          projectId:
            running.projectId,
        },
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const repositorySnapshot =
      this.store
        .listRepositorySemanticSnapshots({
          projectId:
            comparison.projectId,
          limit: 1,
        })[0] || null;
    let result;
    try {
      result =
        await this.aroMutationRuntime
          .run({
            projectId:
              comparison.projectId,
            project:
              this.projectForAroReconstruction(
                comparison.projectId,
              ) || {
                id:
                  comparison.projectId,
              },
            currentAro,
            targetAro,
            comparison,
            repositorySnapshotRef:
              repositorySnapshot
                ? {
                    kind:
                      "repository_snapshot",
                    id:
                      repositorySnapshot
                        .snapshotId,
                    digest:
                      repositorySnapshot
                        .snapshotDigest,
                    projectId:
                      repositorySnapshot
                        .projectId,
                  }
                : null,
            attempt: running.attempt,
            reasoningEffort:
              "medium",
          });
    } catch (error) {
      result = {
        state: "failed",
        requestManifest: null,
        validation: null,
        contract: null,
        telemetry: null,
        error:
          rendererSafeError(error),
      };
    }
    let contract = null;
    if (
      result.state === "completed" &&
      result.contract
    ) {
      contract =
        this.store
          .registerAroMutationContract({
            contract:
              result.contract,
          }).contract;
    }
    const terminal =
      reviseAroMutationCompilationRun(
        running,
        {
          state: result.state,
          requestManifest:
            result.requestManifest,
          validation:
            result.validation,
          contractRef: contract
            ? mutationContractRef(
                contract,
              )
            : null,
          telemetry: result.telemetry,
          error: result.error,
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroMutationCompilationRun({
        run: terminal,
      });
    this.emit("transition", {
      reason:
        result.state === "completed"
          ? "aro-mutation-contract-completed"
          : result.state === "remanded"
            ? "aro-mutation-contract-remanded"
            : "aro-mutation-contract-failed",
      receipt: {
        schema:
          "direct_aro_mutation_orchestration_receipt@1",
        state: result.state,
        projectId:
          comparison.projectId,
        comparisonRef:
          terminal.comparisonRef,
        runRef: {
          kind:
            "aro_mutation_compilation_run",
          id: terminal.runId,
          digest: terminal.digest,
          projectId:
            terminal.projectId,
        },
        contractRef:
          terminal.contractRef,
        retryable:
          terminal.retryable,
        sourceInspectionEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    return {
      state: terminal.state,
      reused: false,
      run: terminal,
      contract,
    };
  }

  async compileAroMutationContract(
    input = {},
  ) {
    this.ensureStarted();
    const resolved =
      this.resolveAroMutationComparison(
        input,
      );
    if (
      !input.semanticRegionBindingRef
    ) {
      const error = new Error(
        "world_manager_aro_mutation_semantic_region_binding_required",
      );
      error.code =
        "world_manager_aro_mutation_semantic_region_binding_required";
      throw error;
    }
    const projection =
      this.snapshot();
    verifySemanticRegionBinding(
      projection,
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          resolved.comparison
            .comparisonId,
        digest:
          resolved.comparison.digest,
      },
    );
    const latest =
      this.store
        .latestAroMutationCompilationRun({
          projectId:
            resolved.comparison
              .projectId,
          comparisonDigest:
            resolved.comparison.digest,
        });
    if (
      input.retry === true &&
      (
        !latest ||
        latest.retryable !== true ||
        (
          normalizeString(
            input.expectedRunDigest,
            "",
          ) &&
          input.expectedRunDigest !==
            latest.digest
        )
      )
    ) {
      const error = new Error(
        "world_manager_aro_mutation_retry_stale_or_unavailable",
      );
      error.code =
        "world_manager_aro_mutation_retry_stale_or_unavailable";
      throw error;
    }
    const result =
      await this
        .queueAroMutationCompilation({
          ...input,
          ...resolved,
        });
    const currentProjection =
      this.snapshot();
    return {
      receipt: {
        schema:
          "direct_aro_mutation_compilation_receipt@1",
        state: result.state,
        reused: result.reused,
        projectId:
          resolved.comparison
            .projectId,
        comparisonRef: {
          kind:
            "aro_current_target_comparison",
          id:
            resolved.comparison
              .comparisonId,
          digest:
            resolved.comparison.digest,
          projectId:
            resolved.comparison
              .projectId,
        },
        runRef: result.run
          ? {
              kind:
                "aro_mutation_compilation_run",
              id: result.run.runId,
              digest:
                result.run.digest,
              projectId:
                result.run.projectId,
            }
          : null,
        contractRef:
          result.run?.contractRef ||
          null,
        currentProjectionRevision:
          currentProjection
            .projectionRevision,
        sourceInspectionEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        grantsAuthority: false,
      },
      projection:
        currentProjection,
    };
  }

  resolveAroRealizationContract(
    input = {},
  ) {
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const contractId =
      normalizeString(
        input.contractId,
        "",
      );
    const contractDigest =
      normalizeString(
        input.contractDigest,
        "",
      );
    if (
      !projectId ||
      !contractId ||
      !contractDigest
    ) {
      const error = new Error(
        "world_manager_aro_realization_contract_ref_required",
      );
      error.code =
        "world_manager_aro_realization_contract_ref_required";
      throw error;
    }
    const contract =
      this.store
        .aroMutationContractById(
          contractId,
        );
    if (
      !contract ||
      contract.digest !==
        contractDigest ||
      contract.projectId !==
        projectId
    ) {
      const error = new Error(
        "world_manager_aro_realization_contract_stale_or_unknown",
      );
      error.code =
        "world_manager_aro_realization_contract_stale_or_unknown";
      throw error;
    }
    const currentAro =
      this.store
        .abstractReasoningObjectById(
          contract.currentAroRef.id,
        );
    const targetAro =
      this.store
        .abstractReasoningObjectById(
          contract.targetAroRef.id,
        );
    const repositorySnapshot =
      contract.repositorySnapshotRef
        ? this.store
            .repositorySemanticSnapshotById(
              contract
                .repositorySnapshotRef.id,
            )
        : null;
    if (
      !currentAro ||
      currentAro.digest !==
        contract.currentAroRef.digest ||
      !targetAro ||
      targetAro.digest !==
        contract.targetAroRef.digest
    ) {
      const error = new Error(
        "world_manager_aro_realization_aro_binding_stale",
      );
      error.code =
        "world_manager_aro_realization_aro_binding_stale";
      throw error;
    }
    if (
      !repositorySnapshot ||
      repositorySnapshot
        .snapshotDigest !==
        contract
          .repositorySnapshotRef
          ?.digest
    ) {
      const error = new Error(
        "world_manager_aro_realization_snapshot_required",
      );
      error.code =
        "world_manager_aro_realization_snapshot_required";
      throw error;
    }
    return {
      contract,
      currentAro,
      targetAro,
      repositorySnapshot,
    };
  }

  async importAroRealizationContext(
    resolved,
  ) {
    if (
      !this.aroRealizationContextProvider
    ) {
      const error = new Error(
        "world_manager_aro_realization_context_provider_unavailable",
      );
      error.code =
        "world_manager_aro_realization_context_provider_unavailable";
      throw error;
    }
    const pathRequest =
      deriveRealizationContextPathRequest({
        ...resolved,
      });
    const project =
      this.projectForAroReconstruction(
        resolved.contract.projectId,
      ) || {
        id:
          resolved.contract.projectId,
      };
    const observation =
      await this
        .aroRealizationContextProvider(
          project,
          {
            relativePaths:
              pathRequest
                .requestedPaths,
            maxFiles:
              pathRequest.maxFiles,
            maxExcerptBytesPerFile:
              pathRequest
                .maxExcerptBytesPerFile,
            maxTotalExcerptBytes:
              pathRequest
                .maxTotalExcerptBytes,
            contractRef:
              mutationContractRef(
                resolved.contract,
              ),
            repositorySnapshotRef:
              resolved.contract
                .repositorySnapshotRef,
          },
        );
    const contextImport =
      buildAroRealizationContextImport({
        ...resolved,
        pathRequest,
        observation,
        now: this.now,
      });
    return this.store
      .registerAroRealizationContextImport({
        contextImport,
      }).contextImport;
  }

  queueAroRealizationMapping(
    input = {},
  ) {
    if (
      !this.aroRealizationMappingAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_realization_mapping_unavailable",
      );
      error.code =
        "world_manager_aro_realization_mapping_unavailable";
      return Promise.reject(error);
    }
    const key =
      `${input.contract.digest}:${input.contextImport.sourceIdentityDigest}`;
    const active =
      this.aroRealizationMappingJobs
        .get(key);
    if (active) return active;
    const job =
      this.runAroRealizationMapping(
        input,
      ).finally(() => {
        if (
          this.aroRealizationMappingJobs
            .get(key) === job
        ) {
          this.aroRealizationMappingJobs
            .delete(key);
        }
      });
    this.aroRealizationMappingJobs
      .set(key, job);
    return job;
  }

  async runAroRealizationMapping(
    input = {},
  ) {
    const {
      contract,
      contextImport,
    } = input;
    const scheduled =
      this.store
        .scheduleAroRealizationMappingRun({
          contract,
          contextImport,
          retry:
            input.retry === true,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      return {
        state: scheduled.run.state,
        reused: true,
        run: scheduled.run,
        contextImport,
        mappingWitness:
          scheduled.run
            .mappingWitnessRef
            ? this.store
                .aroRealizationMappingWitnessById(
                  scheduled.run
                    .mappingWitnessRef.id,
                )
            : null,
      };
    }
    this.emit("transition", {
      reason:
        "aro-realization-mapping-scheduled",
      receipt: {
        schema:
          "direct_aro_realization_mapping_orchestration_receipt@1",
        state: "scheduled",
        projectId:
          contract.projectId,
        contractRef:
          scheduled.run.contractRef,
        contextImportRef:
          scheduled.run
            .contextImportRef,
        runRef: {
          kind:
            "aro_realization_mapping_run",
          id: scheduled.run.runId,
          digest:
            scheduled.run.digest,
          projectId:
            scheduled.run.projectId,
        },
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const running =
      reviseAroRealizationMappingRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroRealizationMappingRun({
        run: running,
      });
    this.emit("transition", {
      reason:
        "aro-realization-mapping-running",
      receipt: {
        schema:
          "direct_aro_realization_mapping_orchestration_receipt@1",
        state: "running",
        projectId:
          contract.projectId,
        contractRef:
          running.contractRef,
        contextImportRef:
          running.contextImportRef,
        runRef: {
          kind:
            "aro_realization_mapping_run",
          id: running.runId,
          digest: running.digest,
          projectId:
            running.projectId,
        },
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    let result;
    try {
      result =
        await this
          .aroRealizationMappingRuntime
          .run({
            projectId:
              contract.projectId,
            contract,
            contextImport,
            attempt: running.attempt,
            reasoningEffort:
              "medium",
          });
    } catch (error) {
      result = {
        state: "failed",
        requestManifest: null,
        validation: null,
        mappingWitness: null,
        telemetry: null,
        error:
          rendererSafeError(error),
      };
    }
    let mappingWitness = null;
    if (
      result.state === "completed" &&
      result.mappingWitness
    ) {
      mappingWitness =
        this.store
          .registerAroRealizationMappingWitness({
            mappingWitness:
              result.mappingWitness,
          }).mappingWitness;
    }
    const terminal =
      reviseAroRealizationMappingRun(
        running,
        {
          state: result.state,
          requestManifest:
            result.requestManifest,
          validation:
            result.validation,
          mappingWitnessRef:
            mappingWitness
              ? realizationMappingWitnessRef(
                  mappingWitness,
                )
              : null,
          telemetry: result.telemetry,
          error: result.error,
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroRealizationMappingRun({
        run: terminal,
      });
    this.emit("transition", {
      reason:
        result.state === "completed"
          ? "aro-realization-mapping-completed"
          : result.state === "remanded"
            ? "aro-realization-mapping-remanded"
            : "aro-realization-mapping-failed",
      receipt: {
        schema:
          "direct_aro_realization_mapping_orchestration_receipt@1",
        state: result.state,
        projectId:
          contract.projectId,
        contractRef:
          terminal.contractRef,
        contextImportRef:
          terminal.contextImportRef,
        mappingWitnessRef:
          terminal.mappingWitnessRef,
        runRef: {
          kind:
            "aro_realization_mapping_run",
          id: terminal.runId,
          digest: terminal.digest,
          projectId:
            terminal.projectId,
        },
        retryable:
          terminal.retryable,
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        executionAuthorityGranted: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    return {
      state: terminal.state,
      reused: false,
      run: terminal,
      contextImport,
      mappingWitness,
    };
  }

  async mapAroRealizationContext(
    input = {},
  ) {
    this.ensureStarted();
    if (
      !this.aroRealizationMappingAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_realization_mapping_unavailable",
      );
      error.code =
        "world_manager_aro_realization_mapping_unavailable";
      throw error;
    }
    const resolved =
      this.resolveAroRealizationContract(
        input,
      );
    if (
      !input.semanticRegionBindingRef
    ) {
      const error = new Error(
        "world_manager_aro_realization_semantic_region_binding_required",
      );
      error.code =
        "world_manager_aro_realization_semantic_region_binding_required";
      throw error;
    }
    const projection = this.snapshot();
    verifySemanticRegionBinding(
      projection,
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          resolved.contract
            .comparisonRef.id,
        digest:
          resolved.contract
            .comparisonRef.digest,
      },
    );
    let contextImport;
    if (input.retry === true) {
      const expectedRunDigest =
        normalizeString(
          input.expectedRunDigest,
          "",
        );
      const latest =
        this.store
          .listAroRealizationMappingRuns({
            projectId:
              resolved.contract
                .projectId,
            contractDigest:
              resolved.contract.digest,
            currentOnly: true,
          })[0] || null;
      if (
        !latest ||
        latest.retryable !== true ||
        !expectedRunDigest ||
        latest.digest !==
          expectedRunDigest
      ) {
        const error = new Error(
          "world_manager_aro_realization_mapping_retry_stale_or_unavailable",
        );
        error.code =
          "world_manager_aro_realization_mapping_retry_stale_or_unavailable";
        throw error;
      }
      contextImport =
        this.store
          .aroRealizationContextImportById(
            latest.contextImportRef.id,
          );
      if (
        !contextImport ||
        contextImport.digest !==
          latest.contextImportRef.digest
      ) {
        const error = new Error(
          "world_manager_aro_realization_mapping_retry_context_missing",
        );
        error.code =
          "world_manager_aro_realization_mapping_retry_context_missing";
        throw error;
      }
    } else {
      contextImport =
        await this
          .importAroRealizationContext(
            resolved,
          );
    }
    const result =
      await this
        .queueAroRealizationMapping({
          ...resolved,
          contextImport,
          retry:
            input.retry === true,
        });
    const currentProjection =
      this.snapshot();
    return {
      receipt: {
        schema:
          "direct_aro_realization_mapping_receipt@1",
        state: result.state,
        reused: result.reused,
        projectId:
          resolved.contract
            .projectId,
        contractRef:
          mutationContractRef(
            resolved.contract,
          ),
        contextImportRef:
          realizationContextImportRef(
            contextImport,
          ),
        runRef: result.run
          ? {
              kind:
                "aro_realization_mapping_run",
              id: result.run.runId,
              digest:
                result.run.digest,
              projectId:
                result.run.projectId,
            }
          : null,
        mappingWitnessRef:
          result.run
            ?.mappingWitnessRef ||
          null,
        currentProjectionRevision:
          currentProjection
            .projectionRevision,
        sourceInspectionEffect: true,
        readOnlyEffect: true,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        canonicalAdmissionEffect: false,
        executionAuthorityGranted: false,
        grantsAuthority: false,
      },
      projection:
        currentProjection,
    };
  }

  resolveAroWorkerInputs(
    input = {},
  ) {
    const resolved =
      this.resolveAroRealizationContract(
        input,
      );
    if (
      !input.semanticRegionBindingRef
    ) {
      const error = new Error(
        "world_manager_aro_worker_semantic_region_binding_required",
      );
      error.code =
        "world_manager_aro_worker_semantic_region_binding_required";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          resolved.contract
            .comparisonRef.id,
        digest:
          resolved.contract
            .comparisonRef.digest,
      },
    );
    const mappingRun =
      this.store
        .listAroRealizationMappingRuns({
          projectId:
            resolved.contract.projectId,
          contractDigest:
            resolved.contract.digest,
          currentOnly: true,
        })
        .find((run) =>
          run.state === "completed" &&
          run.mappingWitnessRef);
    const contextImport =
      mappingRun
        ? this.store
            .aroRealizationContextImportById(
              mappingRun
                .contextImportRef.id,
            )
        : null;
    const mappingWitness =
      mappingRun
        ? this.store
            .aroRealizationMappingWitnessById(
              mappingRun
                .mappingWitnessRef.id,
            )
        : null;
    const exactInputMatches =
      (
        !normalizeString(
          input.contextImportId,
          "",
        ) ||
        input.contextImportId ===
          contextImport?.contextImportId
      ) &&
      (
        !normalizeString(
          input.contextImportDigest,
          "",
        ) ||
        input.contextImportDigest ===
          contextImport?.digest
      ) &&
      (
        !normalizeString(
          input.mappingWitnessId,
          "",
        ) ||
        input.mappingWitnessId ===
          mappingWitness?.mappingWitnessId
      ) &&
      (
        !normalizeString(
          input.mappingWitnessDigest,
          "",
        ) ||
        input.mappingWitnessDigest ===
          mappingWitness?.digest
      );
    if (
      !mappingRun ||
      !contextImport ||
      contextImport.digest !==
        mappingRun.contextImportRef.digest ||
      !mappingWitness ||
      mappingWitness.digest !==
        mappingRun.mappingWitnessRef.digest ||
      !exactInputMatches
    ) {
      const error = new Error(
        "world_manager_aro_worker_mapping_stale_or_unknown",
      );
      error.code =
        "world_manager_aro_worker_mapping_stale_or_unknown";
      throw error;
    }
    return {
      ...resolved,
      mappingRun,
      contextImport,
      mappingWitness,
    };
  }

  async observeAroWorkerSourceFreshness(
    resolved,
  ) {
    const project =
      this.projectForAroReconstruction(
        resolved.contract.projectId,
      ) || {
        id:
          resolved.contract.projectId,
      };
    const observation =
      await this
        .aroRealizationContextProvider(
          project,
          {
            relativePaths:
              resolved.contextImport
                .selectionWitness
                .selectedPaths,
            maxFiles:
              resolved.contextImport
                .selectionWitness
                .maxFiles,
            maxExcerptBytesPerFile:
              resolved.contextImport
                .selectionWitness
                .maxExcerptBytesPerFile,
            maxTotalExcerptBytes:
              resolved.contextImport
                .selectionWitness
                .maxTotalExcerptBytes,
            contractRef:
              mutationContractRef(
                resolved.contract,
              ),
            repositorySnapshotRef:
              resolved.contract
                .repositorySnapshotRef,
          },
        );
    return buildAroWorkerSourceFreshnessWitness({
      contextImport:
        resolved.contextImport,
      observation,
      now: this.now,
    });
  }

  async observeAroWorkerCapability(
    projectId,
  ) {
    const project =
      this.projectForAroReconstruction(
        projectId,
      ) || {
        id: projectId,
      };
    const observation =
      await this
        .aroWorkerCapabilityProvider(
          project,
        );
    return buildAroWorkerCapabilityObservation({
      ...observation,
      projectId,
      now: this.now,
    });
  }

  async prepareAroWorkerHandoff(
    input = {},
  ) {
    this.ensureStarted();
    if (
      !this.aroWorkerHandoffAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_worker_handoff_unavailable",
      );
      error.code =
        "world_manager_aro_worker_handoff_unavailable";
      throw error;
    }
    const resolved =
      this.resolveAroWorkerInputs(input);
    const [
      sourceFreshness,
      capabilityObservation,
    ] = await Promise.all([
      this.observeAroWorkerSourceFreshness(
        resolved,
      ),
      this.observeAroWorkerCapability(
        resolved.contract.projectId,
      ),
    ]);
    const reviewReceipt =
      buildAroWorkerReviewReceipt({
        ...resolved,
        sourceFreshness,
        capabilityObservation,
        actorId:
          normalizeString(
            input.actorId,
            "operator",
          ),
        now: this.now,
      });
    const constitution =
      buildAroWorkerConstitution({
        ...resolved,
        sourceFreshness,
        capabilityObservation,
        reviewReceipt,
        now: this.now,
      });
    const stored =
      this.store
        .registerAroWorkerReviewBundle({
          sourceFreshness,
          capabilityObservation,
          reviewReceipt,
          constitution,
        });
    const projection =
      this.snapshot();
    const receipt = {
      schema:
        "direct_aro_worker_review_bundle_receipt@1",
      state:
        constitution.constitutionState,
      reused: stored.reused,
      projectId:
        resolved.contract.projectId,
      contractRef:
        mutationContractRef(
          resolved.contract,
        ),
      contextImportRef:
        realizationContextImportRef(
          resolved.contextImport,
        ),
      mappingWitnessRef:
        realizationMappingWitnessRef(
          resolved.mappingWitness,
        ),
      sourceFreshnessRef:
        reviewReceipt
          .sourceFreshnessRef,
      capabilityObservationRef:
        reviewReceipt
          .capabilityObservationRef,
      reviewReceiptRef: {
        kind:
          "aro_worker_review_receipt",
        id:
          reviewReceipt.reviewReceiptId,
        digest:
          reviewReceipt.digest,
        projectId:
          reviewReceipt.projectId,
      },
      constitutionRef:
        workerConstitutionRef(
          constitution,
        ),
      blockerCodes:
        constitution.blockerCodes,
      providerStartAuthorized: false,
      workerLaunchEffect: false,
      providerTurnStartEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      currentProjectionRevision:
        projection.projectionRevision,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason:
        constitution
          .constitutionState ===
          "ready_for_authorization"
          ? "aro-worker-constitution-ready"
          : "aro-worker-constitution-blocked",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  assertAroWorkerAuthorizationFresh(
    constitution,
    sourceFreshness,
    capabilityObservation,
  ) {
    const compiledTools = [
      ...constitution
        .capabilityEnvelope.toolNames,
    ].sort();
    const observedTools = [
      ...capabilityObservation
        .availableToolNames,
    ].sort();
    if (
      sourceFreshness.state !== "fresh" ||
      capabilityObservation
        .workerStartAvailable !== true ||
      JSON.stringify(compiledTools) !==
        JSON.stringify(observedTools)
    ) {
      const error = new Error(
        "world_manager_aro_worker_constitution_stale",
      );
      error.code =
        "world_manager_aro_worker_constitution_stale";
      error.detail = [
        ...sourceFreshness.blockerCodes,
        ...capabilityObservation.blockerCodes,
        ...(
          JSON.stringify(compiledTools) ===
          JSON.stringify(observedTools)
            ? []
            : [
                "capability_envelope_changed",
              ]
        ),
      ].join(",");
      throw error;
    }
  }

  createAroWorkerWorkThread(
    constitution,
  ) {
    const workThreadId =
      stableId(
        "wm_aro_worker_work_thread",
        {
          constitutionRef:
            workerConstitutionRef(
              constitution,
            ),
        },
      );
    return this.workThreadStore
      .upsertWorkThread({
        workThreadId,
        projectId:
          constitution.projectId,
        title:
          "ARO realization implementation",
        objective: {
          summary:
            constitution
              .completionContract
              .activityCountsAsCompletion
              ? "Execute the reviewed ARO realization contract."
              : "Implement the reviewed ARO realization obligations and return evidence without claiming closure.",
          currentObjective:
            "Implement only the exact bound obligations under per-call effect approval.",
          priority: "normal",
        },
        lifecycleState: "active",
        ontologyProfileRef: {
          kind:
            "aro_worker_constitution",
          id:
            constitution
              .workerConstitutionId,
          digest:
            constitution.digest,
          label:
            "Compiled ARO worker constitution",
        },
        workspaceKind:
          "project_default",
        phaseState: {
          phaseId:
            "wm_sc8_3_implementation",
          phaseKind:
            "implementation",
          status: "active",
        },
        activeRuntimePath:
          "direct-implementation",
        authorityBoundary: {
          allowedActions: [
            "start_one_provider_worker_turn",
            "request_per_call_tool_approval",
          ],
          forbiddenActions: [
            "workspace_mutation_without_per_call_approval",
            "remote_mutation",
            "canonical_worldstate_admission",
            "semantic_closure_certification",
            "recursive_worker_spawn",
          ],
          summary:
            "This WorkThread may start one bounded Direct worker. Every read, patch, or command remains separately gated.",
        },
        contextPacketRef: {
          kind:
            "compiled_agent_context",
          id:
            constitution
              .compiledAgentContext
              .compiledAgentContextId,
          digest:
            constitution
              .compiledAgentContext
              .digest,
          label:
            "Compiled worker context",
        },
        openObligations:
          constitution
            .obligationBindings
            .map((binding) => ({
              obligationId:
                binding.obligationRef.id,
              kind:
                "aro_implementation_obligation",
              status: "open",
              summary:
                binding.obligationKey,
              evidenceRefs:
                binding.sourceBindings
                  .map((source) => ({
                    kind:
                      "mapped_source",
                    id:
                      source.sourceRef.id,
                    digest:
                      source.sourceRef.digest,
                    label:
                      source.relativePath,
                  })),
            })),
        evidenceRefs: [
          {
            kind:
              "aro_mutation_contract",
            id:
              constitution.contractRef.id,
            digest:
              constitution.contractRef
                .digest,
            label:
              "Reviewed ARO mutation contract",
          },
          {
            kind:
              "aro_realization_mapping_witness",
            id:
              constitution
                .mappingWitnessRef.id,
            digest:
              constitution
                .mappingWitnessRef.digest,
            label:
              "Reviewed realization mapping",
          },
        ],
      });
  }

  aroWorkerHandoffReceipt(
    run,
    projection,
    reused = false,
  ) {
    return {
      schema:
        "direct_aro_worker_handoff_receipt@1",
      state: run.state,
      reused,
      projectId: run.projectId,
      runRef: {
        kind:
          "aro_worker_handoff_run",
        id: run.runId,
        digest: run.digest,
        projectId: run.projectId,
      },
      constitutionRef:
        run.constitutionRef,
      authorizationRef:
        run.authorizationRef,
      workThreadRef:
        run.workThreadRef,
      workerStartTransitionRef:
        run.workerStartTransitionRef,
      workerSessionRef:
        run.workerSessionRef,
      workerTurnRef:
        run.workerTurnRef,
      workerLaunchEffect:
        run.workerLaunchEffect,
      providerTurnStartEffect:
        run.providerTurnStartEffect,
      toolProposalEffect:
        run.toolProposalEffect,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      perCallEffectApprovalRequired:
        true,
      currentProjectionRevision:
        projection.projectionRevision,
      grantsAuthority: false,
    };
  }

  async authorizeAroWorkerHandoff(
    input = {},
  ) {
    this.ensureStarted();
    if (
      !this.aroWorkerHandoffAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_worker_handoff_unavailable",
      );
      error.code =
        "world_manager_aro_worker_handoff_unavailable";
      throw error;
    }
    const constitutionId =
      normalizeString(
        input.constitutionId,
        "",
      );
    const constitutionDigest =
      normalizeString(
        input.constitutionDigest,
        "",
      );
    const constitution =
      this.store
        .aroWorkerConstitutionById(
          constitutionId,
        );
    if (
      !constitution ||
      constitution.digest !==
        constitutionDigest ||
      constitution.projectId !==
        normalizeString(
          input.projectId,
          "",
        )
    ) {
      const error = new Error(
        "world_manager_aro_worker_constitution_stale_or_unknown",
      );
      error.code =
        "world_manager_aro_worker_constitution_stale_or_unknown";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          constitution.comparisonRef.id,
        digest:
          constitution.comparisonRef
            .digest,
      },
    );
    const resolved =
      this.resolveAroWorkerInputs({
        ...input,
        contractId:
          constitution.contractRef.id,
        contractDigest:
          constitution.contractRef.digest,
        contextImportId:
          constitution.contextImportRef.id,
        contextImportDigest:
          constitution.contextImportRef
            .digest,
        mappingWitnessId:
          constitution.mappingWitnessRef.id,
        mappingWitnessDigest:
          constitution.mappingWitnessRef
            .digest,
      });
    const [
      sourceFreshness,
      capabilityObservation,
    ] = await Promise.all([
      this.observeAroWorkerSourceFreshness(
        resolved,
      ),
      this.observeAroWorkerCapability(
        constitution.projectId,
      ),
    ]);
    this.assertAroWorkerAuthorizationFresh(
      constitution,
      sourceFreshness,
      capabilityObservation,
    );
    const actorId =
      normalizeString(
        input.actorId,
        "operator",
      );
    const operatorActionId =
      normalizeString(
        input.operatorActionId,
        "",
      );
    const authorization =
      this.store
        .listAroWorkerAuthorizations({
          constitutionDigest:
            constitution.digest,
          limit: 1_000,
        })
        .find((entry) =>
          entry.operatorActionId ===
            operatorActionId &&
          entry.actorRef.id ===
            actorId) ||
      buildAroWorkerAuthorizationReceipt({
        constitution,
        actorId,
        operatorActionId,
        now: this.now,
      });
    this.store
      .registerAroWorkerAuthorization({
        authorization,
      });
    const workThread =
      this.createAroWorkerWorkThread(
        constitution,
      );
    const handoffPacket =
      buildAroWorkerRoleHandoffPacket({
        constitution,
        authorization,
        workThread,
      });
    const environmentRuntime =
      await this.ensureWorkThreadEnvironment({
        projectId: constitution.projectId,
        threadId: workThread.workThreadId,
        workThreadId: workThread.workThreadId,
        stepId: `aro_worker_handoff_${authorization.authorizationReceiptId}`,
      });
    const scheduled =
      this.store
        .scheduleAroWorkerHandoffRun({
          constitution,
          authorization,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      const projection =
        this.snapshot();
      return {
        receipt:
          this.aroWorkerHandoffReceipt(
            scheduled.run,
            projection,
            true,
          ),
        projection,
      };
    }
    const running =
      reviseAroWorkerHandoffRun(
        scheduled.run,
        {
          state: "running",
          workThreadRef: {
            kind: "work_thread",
            id:
              workThread.workThreadId,
            digest:
              workThread.digest,
            projectId:
              workThread.projectId,
          },
          handoffPacketRef: {
            kind:
              "direct_role_handoff_packet",
            id:
              handoffPacket
                .handoffPacketId,
            digest:
              handoffPacket.packetDigest,
            projectId:
              constitution.projectId,
          },
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroWorkerHandoffRun({
        run: running,
      });
    this.roleRuntime
      .registerCompilation({
        compiledAgentContext:
          constitution
            .compiledAgentContext,
      });
    let terminal;
    try {
      const response =
        await this.aroWorkerRuntime
          .start({
            projectId:
              constitution.projectId,
            project:
              this.projectForAroReconstruction(
                constitution.projectId,
              ),
            surfaceSession:
              input.surfaceSession || null,
            handoffPacket,
            workerPrompt:
              aroWorkerPrompt(
                constitution,
              ),
            workThread,
            operatorActionId:
              authorization
                .operatorActionId,
            compiledAgentContextRef: {
              id:
                constitution
                  .compiledAgentContext
                  .compiledAgentContextId,
              digest:
                constitution
                  .compiledAgentContext
                  .digest,
            },
            threadEnvironmentBindingRef:
              environmentRuntime
                ? threadEnvironmentBindingRef(
                    environmentRuntime.threadEnvironmentBinding,
                  )
                : null,
            stepEnvironmentSnapshotRef:
              environmentRuntime
                ? stepEnvironmentSnapshotRef(
                    environmentRuntime.stepEnvironmentSnapshot,
                  )
                : null,
            environmentSelection:
              environmentRuntime
                ? {
                    primaryEnvironmentId:
                      environmentRuntime.stepEnvironmentSnapshot
                        .primaryEnvironmentId,
                    selectedEnvironmentIds:
                      environmentRuntime.stepEnvironmentSnapshot
                        .selectedEnvironmentIds,
                  }
                : null,
          });
      const transition =
        response?.transition || {};
      const result =
        response?.result || {};
      const thread =
        response?.thread || {};
      const turn =
        response?.turn || {};
      if (
        result.status !== "started" ||
        !normalizeString(
          transition
            .workerStartTransitionId,
          "",
        ) ||
        !normalizeString(
          transition.transitionDigest,
          "",
        ) ||
        !normalizeString(
          result.workerSessionId ||
            thread.id,
          "",
        ) ||
        !normalizeString(
          result.workerTurnId ||
            turn.id,
          "",
        )
      ) {
        const error = new Error(
          "world_manager_aro_worker_start_result_invalid",
        );
        error.code =
          "world_manager_aro_worker_start_result_invalid";
        throw error;
      }
      const workerSessionId =
        result.workerSessionId ||
        thread.id;
      const workerTurnId =
        result.workerTurnId ||
        turn.id;
      if (environmentRuntime) {
        const inheritance =
          buildChildEnvironmentInheritance({
            parentStepEnvironmentSnapshot:
              environmentRuntime.stepEnvironmentSnapshot,
            childThreadId: workerSessionId,
            createdAt:
              new Date(this.now()).toISOString(),
          });
        this.store.registerChildEnvironmentInheritance({
          inheritance,
        });
        const runtimeDefault =
          this.store.projectRuntimeDefault(
            constitution.projectId,
          );
        const projectWorkspace =
          this.store.projectWorkspaceBinding(
            constitution.projectId,
          );
        const childBinding =
          buildThreadEnvironmentBinding({
            projectId: constitution.projectId,
            threadId: workerSessionId,
            workThreadId: workThread.workThreadId,
            projectRuntimeDefaultRef:
              this.projectRuntimeDefaultRef(runtimeDefault),
            workspaceBindingRef:
              workspaceBindingRef(projectWorkspace),
            primaryEnvironmentId:
              inheritance.primaryEnvironmentId,
            selectedEnvironmentIds:
              inheritance.inheritedEnvironmentIds,
            allowedEnvironmentIds:
              runtimeDefault.allowedEnvironmentIds,
            inheritedFromStepSnapshotRef:
              inheritance.parentStepEnvironmentSnapshotRef,
            createdAt:
              inheritance.createdAt,
          });
        this.store.registerThreadEnvironmentBinding({
          binding: childBinding,
        });
        await this.ensureWorkThreadEnvironment({
          projectId: constitution.projectId,
          threadId: workerSessionId,
          workThreadId: workThread.workThreadId,
          stepId: workerTurnId,
          inheritedFromStepSnapshotRef:
            inheritance.parentStepEnvironmentSnapshotRef,
        });
      }
      terminal =
        reviseAroWorkerHandoffRun(
          running,
          {
            state: "handed_off",
            workerStartTransitionRef: {
              kind:
                "direct_worker_start_transition",
              id:
                transition
                  .workerStartTransitionId,
              digest:
                transition
                  .transitionDigest,
              projectId:
                constitution.projectId,
            },
            workerSessionRef: {
              kind:
                "direct_worker_session",
              id: workerSessionId,
              digest:
                result.resultDigest,
              projectId:
                constitution.projectId,
            },
            workerTurnRef: {
              kind:
                "direct_worker_turn",
              id: workerTurnId,
              digest:
                digestFor(
                  "direct_aro_worker_turn_ref@1",
                  {
                    workerSessionId,
                    workerTurnId,
                    transitionDigest:
                      transition
                        .transitionDigest,
                  },
                ),
              projectId:
                constitution.projectId,
            },
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    } catch (error) {
      terminal =
        reviseAroWorkerHandoffRun(
          running,
          {
            state: "failed",
            error:
              rendererSafeError(error),
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    }
    this.store
      .registerAroWorkerHandoffRun({
        run: terminal,
      });
    const projection =
      this.snapshot();
    const receipt =
      this.aroWorkerHandoffReceipt(
        terminal,
        projection,
        false,
      );
    this.emit("transition", {
      reason:
        terminal.state === "handed_off"
          ? "aro-worker-handed-off"
          : "aro-worker-handoff-failed",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  aroExecutionEvidenceReceipt(
    run,
    projection,
    reused = false,
  ) {
    return {
      schema:
        "direct_aro_execution_evidence_receipt@1",
      state: run.state,
      reused,
      projectId: run.projectId,
      runRef: {
        kind:
          "aro_execution_evidence_run",
        id: run.runId,
        digest: run.digest,
        projectId: run.projectId,
      },
      handoffRunRef:
        run.handoffRunRef,
      evidenceBundleRef:
        run.evidenceBundleRef,
      workspaceMutationObserved:
        run.workspaceMutationObserved,
      repositoryChanged:
        run.repositoryChanged,
      ambiguityObserved:
        run.ambiguityObserved,
      missingEvidenceKindCount:
        run.missingEvidenceKindCount,
      observationEffect: [
        "observing",
        "acquired",
      ].includes(run.state),
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      semanticTruthValidated: false,
      closureCertified: false,
      currentProjectionRevision:
        projection.projectionRevision,
      grantsAuthority: false,
    };
  }

  async captureAroExecutionEvidence(
    input = {},
  ) {
    this.ensureStarted();
    if (
      !this.aroExecutionEvidenceAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_execution_evidence_unavailable",
      );
      error.code =
        "world_manager_aro_execution_evidence_unavailable";
      throw error;
    }
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const handoffRunId =
      normalizeString(
        input.handoffRunId,
        "",
      );
    const handoffRunDigest =
      normalizeString(
        input.handoffRunDigest,
        "",
      );
    const handoffRun =
      this.store
        .listAroWorkerHandoffRuns({
          projectId,
          currentOnly: true,
        })
        .find((entry) =>
          entry.runId ===
            handoffRunId &&
          entry.digest ===
            handoffRunDigest) ||
      null;
    if (
      !handoffRun ||
      handoffRun.state !==
        "handed_off" ||
      !handoffRun.workerSessionRef ||
      !handoffRun.workerTurnRef
    ) {
      const error = new Error(
        "world_manager_aro_execution_handoff_stale_or_unknown",
      );
      error.code =
        "world_manager_aro_execution_handoff_stale_or_unknown";
      throw error;
    }
    const constitution =
      this.store
        .aroWorkerConstitutionById(
          handoffRun
            .constitutionRef.id,
        );
    const contract =
      constitution
        ? this.store
            .aroMutationContractById(
              constitution
                .contractRef.id,
            )
        : null;
    const contextImport =
      constitution
        ? this.store
            .aroRealizationContextImportById(
              constitution
                .contextImportRef.id,
            )
        : null;
    if (
      !constitution ||
      constitution.digest !==
        handoffRun
          .constitutionRef.digest ||
      !contract ||
      contract.digest !==
        constitution.contractRef.digest ||
      !contextImport ||
      contextImport.digest !==
        constitution
          .contextImportRef.digest
    ) {
      const error = new Error(
        "world_manager_aro_execution_lineage_unavailable",
      );
      error.code =
        "world_manager_aro_execution_lineage_unavailable";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          constitution.comparisonRef.id,
        digest:
          constitution.comparisonRef
            .digest,
      },
    );
    const observationRequestId =
      normalizeString(
        input.observationRequestId,
        "",
      );
    const scheduled =
      this.store
        .scheduleAroExecutionEvidenceRun({
          handoffRun,
          observationRequestId,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      const projection =
        this.snapshot();
      return {
        receipt:
          this
            .aroExecutionEvidenceReceipt(
              scheduled.run,
              projection,
              true,
            ),
        projection,
      };
    }
    const running =
      reviseAroExecutionEvidenceRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroExecutionEvidenceRun({
        run: running,
      });
    let terminal;
    try {
      const project =
        this.projectForAroReconstruction(
          projectId,
        ) || {
          id: projectId,
        };
      const [
        runtimeObservation,
        repositoryObservation,
      ] = await Promise.all([
        this.aroWorkerEvidenceProvider(
          project,
          {
            workerSessionId:
              handoffRun
                .workerSessionRef.id,
            workerTurnId:
              handoffRun
                .workerTurnRef.id,
            handoffRunRef: {
              kind:
                "aro_worker_handoff_run",
              id:
                handoffRun.runId,
              digest:
                handoffRun.digest,
              projectId,
            },
          },
        ),
        this.aroRealizationContextProvider(
          project,
          {
            relativePaths:
              contextImport.evidence
                .map((entry) =>
                  entry.relativePath),
            maxFiles:
              contextImport
                .selectionWitness
                ?.maxFiles,
            maxExcerptBytesPerFile:
              contextImport
                .selectionWitness
                ?.maxExcerptBytesPerFile,
            maxTotalExcerptBytes:
              contextImport
                .selectionWitness
                ?.maxTotalExcerptBytes,
            contractRef:
              mutationContractRef(
                contract,
              ),
            repositorySnapshotRef:
              contract
                .repositorySnapshotRef,
          },
        ),
      ]);
      const bundle =
        buildAroExecutionEvidenceBundle({
          handoffRun,
          constitution,
          contract,
          contextImport,
          runtimeObservation,
          repositoryObservation,
          acquisitionRunRef: {
            kind:
              "aro_execution_evidence_run",
            id: running.runId,
            digest:
              running.digest,
            projectId,
          },
          now: this.now,
        });
      this.store
        .registerAroExecutionEvidenceBundle({
          bundle,
        });
      terminal =
        reviseAroExecutionEvidenceRun(
          running,
          {
            state:
              bundle.captureState,
            evidenceBundleRef:
              evidenceBundleRef(
                bundle,
              ),
            workspaceMutationObserved:
              bundle
                .workspaceMutationObserved,
            repositoryChanged:
              bundle.repositoryChanged,
            ambiguityObserved:
              bundle.ambiguityObserved,
            missingEvidenceKindCount:
              bundle
                .missingEvidenceKindCount,
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    } catch (error) {
      terminal =
        reviseAroExecutionEvidenceRun(
          running,
          {
            state: "failed",
            error:
              rendererSafeError(error),
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    }
    this.store
      .registerAroExecutionEvidenceRun({
        run: terminal,
      });
    const projection =
      this.snapshot();
    const receipt =
      this.aroExecutionEvidenceReceipt(
        terminal,
        projection,
        false,
      );
    this.emit("transition", {
      reason:
        terminal.state === "acquired"
          ? "aro-execution-evidence-acquired"
          : terminal.state ===
              "observing"
            ? "aro-execution-evidence-observing"
            : "aro-execution-evidence-failed",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  aroSemanticVerificationReceipt(
    run,
    projection,
    reused = false,
  ) {
    return {
      schema:
        "direct_aro_semantic_verification_receipt@1",
      state: run.state,
      reused,
      projectId: run.projectId,
      runRef: {
        kind:
          "aro_semantic_verification_run",
        id: run.runId,
        digest: run.digest,
        projectId: run.projectId,
      },
      evidenceBundleRef:
        run.evidenceBundleRef,
      assessmentRef:
        run.assessmentRef,
      closureCandidateRef:
        run.closureCandidateRef,
      openDecisionRefs:
        run.openDecisionRefs,
      error: run.error,
      semanticTruthAssessed:
        run.semanticTruthAssessed,
      semanticTruthCanonical: false,
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      canonicalAdmissionAvailable:
        false,
      closureCertified: false,
      projectionRevision:
        projection.projectionRevision,
      grantsAuthority: false,
    };
  }

  async verifyAroRealization(
    input = {},
  ) {
    this.ensureStarted();
    if (
      !this.aroSemanticVerificationAvailable()
    ) {
      const error = new Error(
        "world_manager_aro_semantic_verification_unavailable",
      );
      error.code =
        "world_manager_aro_semantic_verification_unavailable";
      throw error;
    }
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const evidenceBundleId =
      normalizeString(
        input.evidenceBundleId,
        "",
      );
    const evidenceBundleDigest =
      normalizeString(
        input.evidenceBundleDigest,
        "",
      );
    const bundle =
      this.store
        .aroExecutionEvidenceBundleById(
          evidenceBundleId,
        );
    if (
      !bundle ||
      bundle.projectId !== projectId ||
      bundle.digest !==
        evidenceBundleDigest ||
      bundle.captureState !==
        "acquired" ||
      bundle.workerTurnTerminal !== true
    ) {
      const error = new Error(
        "world_manager_aro_semantic_verification_evidence_stale_or_unknown",
      );
      error.code =
        "world_manager_aro_semantic_verification_evidence_stale_or_unknown";
      throw error;
    }
    const constitution =
      this.store
        .aroWorkerConstitutionById(
          bundle.constitutionRef.id,
        );
    const contract =
      this.store
        .aroMutationContractById(
          bundle.contractRef.id,
        );
    const mappingWitness =
      constitution
        ? this.store
            .aroRealizationMappingWitnessById(
              constitution
                .mappingWitnessRef.id,
            )
        : null;
    if (
      !constitution ||
      constitution.digest !==
        bundle.constitutionRef.digest ||
      !contract ||
      contract.digest !==
        bundle.contractRef.digest ||
      !mappingWitness ||
      mappingWitness.digest !==
        constitution
          .mappingWitnessRef.digest
    ) {
      const error = new Error(
        "world_manager_aro_semantic_verification_lineage_unavailable",
      );
      error.code =
        "world_manager_aro_semantic_verification_lineage_unavailable";
      throw error;
    }
    const resolved =
      this.resolveAroMutationComparison({
        projectId,
        comparisonId:
          contract.comparisonRef.id,
        comparisonDigest:
          contract.comparisonRef.digest,
      });
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_current_target_comparison",
        id:
          resolved.comparison
            .comparisonId,
        digest:
          resolved.comparison.digest,
      },
    );
    const previousRuns =
      this.store
        .listAroSemanticVerificationRuns({
          evidenceBundleId,
          currentOnly: true,
        });
    let attempt = 1;
    if (input.retry === true) {
      const previous =
        previousRuns[0] || null;
      if (
        !previous ||
        !previous.retryable ||
        previous.digest !==
          normalizeString(
            input.expectedRunDigest,
            "",
          )
      ) {
        const error = new Error(
          "world_manager_aro_semantic_verification_retry_stale_or_unavailable",
        );
        error.code =
          "world_manager_aro_semantic_verification_retry_stale_or_unavailable";
        throw error;
      }
      attempt = previous.attempt + 1;
    }
    const scheduled =
      this.store
        .scheduleAroSemanticVerificationRun({
          bundle,
          attempt,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      const projection =
        this.snapshot();
      return {
        receipt:
          this
            .aroSemanticVerificationReceipt(
              scheduled.run,
              projection,
              true,
            ),
        projection,
      };
    }
    const running =
      reviseAroSemanticVerificationRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroSemanticVerificationRun({
        run: running,
      });
    let terminal;
    try {
      const runtimeResult =
        await this
          .aroSemanticVerificationRuntime
          .run({
            projectId,
            project:
              this
                .projectForAroReconstruction(
                  projectId,
                ) || {
                id: projectId,
              },
            bundle,
            constitution,
            contract,
            mappingWitnessRef:
              constitution
                .mappingWitnessRef,
            comparison:
              resolved.comparison,
            currentAro:
              resolved.currentAro,
            targetAro:
              resolved.targetAro,
            attempt,
            reasoningEffort:
              normalizeString(
                input.reasoningEffort,
                "medium",
              ),
          });
      let openDecisionRefs = [];
      if (
        runtimeResult.state ===
          "completed"
      ) {
        const registered =
          this.store
            .registerAroSemanticVerificationBundle({
              assessment:
                runtimeResult.assessment,
              closureCandidate:
                runtimeResult
                  .closureCandidate,
            });
        openDecisionRefs =
          registered.openDecisions
            .map((decision) => ({
              kind: "open_decision",
              id: decision.decisionId,
              digest: decision.digest,
              projectId,
            }));
      }
      terminal =
        reviseAroSemanticVerificationRun(
          running,
          {
            state:
              runtimeResult.state,
            requestManifest:
              runtimeResult
                .requestManifest,
            validation:
              runtimeResult.validation,
            assessmentRef:
              runtimeResult.assessment
                ? assessmentRef(
                    runtimeResult
                      .assessment,
                  )
                : null,
            closureCandidateRef:
              runtimeResult
                .closureCandidate
                ? closureCandidateRef(
                    runtimeResult
                      .closureCandidate,
                  )
                : null,
            openDecisionRefs,
            telemetry:
              runtimeResult.telemetry,
            error:
              runtimeResult.error,
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    } catch (error) {
      terminal =
        reviseAroSemanticVerificationRun(
          running,
          {
            state: "failed",
            error:
              rendererSafeError(error),
            updatedAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
    }
    this.store
      .registerAroSemanticVerificationRun({
        run: terminal,
      });
    const projection = this.snapshot();
    const receipt =
      this
        .aroSemanticVerificationReceipt(
          terminal,
          projection,
          false,
        );
    this.emit("transition", {
      reason:
        terminal.state === "completed"
          ? "aro-semantic-verification-completed"
          : terminal.state === "remanded"
            ? "aro-semantic-verification-remanded"
            : "aro-semantic-verification-failed",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  contextCanvasSourceCatalog(
    input = {},
  ) {
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const targetProjectId =
      normalizeString(
        input.targetProjectId,
        "",
      );
    const canvas =
      input.canvas || null;
    const catalog = [];
    const keys = new Set();
    const push = (entry) => {
      const key =
        normalizeString(
          entry?.key,
          "",
        );
      if (!key || keys.has(key)) {
        return;
      }
      keys.add(key);
      catalog.push(entry);
    };
    const scopedProjects =
      new Set([
        projectId,
        targetProjectId,
        canvas?.activeProjectId,
      ].filter(Boolean));
    for (const project of this.projects) {
      const id =
        normalizeString(
          project.id ||
            project.projectId,
          "",
        );
      if (
        !id ||
        (
          scopedProjects.size &&
          !scopedProjects.has(id)
        )
      ) {
        continue;
      }
      const descriptor = {
        projectId: id,
        name:
          normalizeString(
            project.name,
            id,
          ),
        summary:
          normalizeString(
            project.summary ||
              project.description,
            "Project semantic scope.",
          ),
        runtimePath:
          normalizeString(
            project.runtimePath,
            "unknown",
          ),
      };
      push({
        key: `project:${id}`,
        ref: {
          kind: "project_context",
          id,
          digest: digestFor(
            "direct_context_canvas_project_source@1",
            descriptor,
          ),
          projectId: id,
          label:
            descriptor.name,
        },
        projectId: id,
        objectClass:
          "project_context",
        label: descriptor.name,
        summary:
          descriptor.summary,
        contradiction: false,
        discriminator:
          id !== projectId,
        pinned: false,
      });
    }
    const aros =
      this.store
        .listAbstractReasoningObjects({
          currentOnly: true,
        });
    for (const aro of aros) {
      if (
        scopedProjects.size &&
        !scopedProjects.has(
          aro.projectId,
        )
      ) {
        continue;
      }
      push({
        key:
          `aro:${aro.aroId}:${aro.posture}`,
        ref:
          abstractReasoningObjectRef(
            aro,
          ),
        projectId:
          aro.projectId,
        objectClass:
          "abstract_reasoning_object",
        label:
          aro.semanticIdentity,
        summary:
          `${aro.purpose} · ${aro.branches.length} intensional branches · ${aro.coverageWitness.coveragePosture} realization coverage`,
        contradiction:
          aro.branches.some(
            (branch) =>
              branch.semanticState ===
                "contradicted",
          ),
        discriminator:
          aro.projectId !==
            projectId,
        pinned: false,
      });
    }
    const candidates =
      this.store
        .listAroReconstructionCandidates({
          currentOnly: true,
        });
    for (const candidate of candidates) {
      if (
        scopedProjects.size &&
        !scopedProjects.has(
          candidate.projectId,
        )
      ) {
        continue;
      }
      push({
        key:
          `aro_candidate:${candidate.candidateId}`,
        ref:
          aroReconstructionCandidateRef(
            candidate,
          ),
        projectId:
          candidate.projectId,
        objectClass:
          "aro_reconstruction_candidate",
        label:
          candidate.candidateAro
            .semanticIdentity,
        summary:
          `${candidate.reconstructionMethod.replace(/_/g, " ")} · ${candidate.candidateAro.branches.length} branches · ${candidate.lifecycle}`,
        contradiction:
          candidate
            .contradictionRefs
            .length > 0,
        discriminator:
          candidate.projectId !==
            projectId,
        pinned: false,
      });
    }
    const decisions =
      this.store
        .listSemanticArtifacts({
          currentOnly: true,
        })
        .filter((artifact) =>
          ["open", "blocked"].includes(
            artifact.decisionState,
          ));
    for (const decision of decisions) {
      const decisionProjectId =
        normalizeString(
          decision.header?.scope
            ?.projectId,
          "",
        );
      if (
        decisionProjectId &&
        scopedProjects.size &&
        !scopedProjects.has(
          decisionProjectId,
        )
      ) {
        continue;
      }
      push({
        key:
          `decision:${decision.decisionId}`,
        ref: {
          kind: "open_decision",
          id: decision.decisionId,
          digest: decision.digest,
          ...(decisionProjectId
            ? {
                projectId:
                  decisionProjectId,
              }
            : {}),
          label:
            decision.header
              .semanticIdentity,
        },
        projectId:
          decisionProjectId,
        objectClass:
          "open_decision",
        label:
          decision.header
            .semanticIdentity,
        summary: decision.question,
        contradiction:
          decision.decisionState ===
            "blocked" ||
          decision.header.lifecycle ===
            "conflicted",
        discriminator:
          Boolean(
            decisionProjectId &&
            decisionProjectId !==
              projectId,
          ),
        pinned:
          !decisionProjectId,
      });
    }
    const shelves =
      this.store
        .listSemanticShelves({
          currentOnly: true,
          limit: 200,
        });
    for (const shelf of shelves) {
      const anchorProjectId =
        shelf.anchorRefs
          .map((ref) =>
            normalizeString(
              ref.projectId,
              "",
            ))
          .find(Boolean) ||
        [...scopedProjects].find(
          (id) =>
            shelf.anchorRefs
              .some((ref) =>
                ref.id === id ||
                ref.id.includes(id)),
        ) ||
        "";
      if (
        anchorProjectId &&
        scopedProjects.size &&
        !scopedProjects.has(
          anchorProjectId,
        )
      ) {
        continue;
      }
      const worldShelf =
        shelf.shelfKind ===
          "user_world_project_ecology";
      push({
        key:
          `shelf:${shelf.shelfId}`,
        ref: {
          kind: "semantic_shelf",
          id: shelf.shelfId,
          digest: shelf.digest,
          ...(anchorProjectId
            ? {
                projectId:
                  anchorProjectId,
              }
            : {}),
          label:
            shelf.shelfKind,
        },
        projectId:
          anchorProjectId,
        objectClass:
          "semantic_shelf",
        label:
          shelf.shelfKind
            .replace(/_/g, " "),
        summary:
          `${shelf.sourceEventRefs.length} semantic events · ${shelf.semanticObjectRefs.length} objects · ${shelf.freshness}`,
        contradiction: false,
        discriminator:
          Boolean(
            anchorProjectId &&
            anchorProjectId !==
              projectId,
          ),
        pinned: worldShelf,
      });
    }
    const contexts =
      this.store
        .listOperationalMetaContexts({
          currentOnly: true,
          limit: 120,
        });
    for (const context of contexts) {
      const event =
        this.store
          .eventBySemanticEventId(
            context.semanticEventId,
          );
      const contextProjectId =
        normalizeString(
          event?.projectId,
          "",
        );
      if (
        contextProjectId &&
        scopedProjects.size &&
        !scopedProjects.has(
          contextProjectId,
        )
      ) {
        continue;
      }
      push({
        key:
          `context:${context.operationalMetaContextRef.id}`,
        ref: {
          ...context
            .contextBundleRef,
          projectId:
            contextProjectId,
          label:
            "Operational meta-context bundle",
        },
        projectId:
          contextProjectId,
        objectClass:
          "semantic_context_bundle",
        label:
          context.purpose,
        summary:
          `${context.sourceShelfCount} shelves · ${context.selectedSemanticObjectCount} objects · ${context.estimatedInputTokens}/${context.maxInputTokens} estimated tokens`,
        contradiction:
          context.freshness !==
            "fresh",
        discriminator:
          Boolean(
            contextProjectId &&
            contextProjectId !==
              projectId,
          ),
        pinned: false,
      });
    }
    if (canvas) {
      for (
        const object
        of canvas
          .temporarySemanticObjects
      ) {
        push({
          key:
            `canvas_object:${object.temporaryObjectId}`,
          ref: {
            kind:
              "context_canvas_temporary_object",
            id:
              object
                .temporaryObjectId,
            digest: object.digest,
            projectId:
              canvas.activeProjectId,
            label: object.label,
          },
          projectId:
            canvas.activeProjectId,
          objectClass:
            object.objectKind,
          label: object.label,
          summary: object.summary,
          contradiction:
            object
              .temporaryPosture ===
              "counterfactual",
          discriminator: false,
          pinned: false,
        });
      }
      for (
        const insight
        of canvas.candidateInsights
      ) {
        push({
          key:
            `canvas_insight:${insight.candidateInsightId}`,
          ref: {
            kind:
              "context_canvas_candidate_insight",
            id:
              insight
                .candidateInsightId,
            digest: insight.digest,
            projectId:
              canvas.activeProjectId,
            label:
              insight
                .semanticIdentity,
          },
          projectId:
            canvas.activeProjectId,
          objectClass:
            "candidate_insight",
          label:
            insight.semanticIdentity,
          summary:
            insight.rationale,
          contradiction:
            insight.branches.some(
              (branch) =>
                branch
                  .semanticState ===
                "contradicted",
            ),
          discriminator: false,
          pinned: false,
        });
      }
    }
    return catalog;
  }

  contextCanvasForRequest(
    input = {},
  ) {
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    if (!projectId) {
      const error = new Error(
        "world_manager_context_canvas_project_required",
      );
      error.code =
        "world_manager_context_canvas_project_required";
      throw error;
    }
    const canvasId =
      normalizeString(
        input.contextCanvasId,
        "",
      );
    const canvasDigest =
      normalizeString(
        input.contextCanvasDigest,
        "",
      );
    if (canvasId || canvasDigest) {
      const canvas =
        this.store
          .currentContextCanvas({
            contextCanvasId:
              canvasId,
          });
      if (
        !canvas ||
        canvas.digest !==
          canvasDigest ||
        canvas.activeProjectId !==
          projectId
      ) {
        const error = new Error(
          "world_manager_context_canvas_stale_or_unknown",
        );
        error.code =
          "world_manager_context_canvas_stale_or_unknown";
        throw error;
      }
      return {
        canvas,
        created: false,
      };
    }
    const prepared =
      this.store
        .ensureBaseContextCanvas({
          ownerId:
            normalizeString(
              input.ownerId,
              "operator",
            ),
          projectId,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    return {
      canvas: prepared.canvas,
      created: prepared.changed,
    };
  }

  async applyThoughtBrush(
    input = {},
  ) {
    this.ensureStarted();
    if (!this.thoughtBrushAvailable()) {
      const error = new Error(
        "world_manager_thought_brush_unavailable",
      );
      error.code =
        "world_manager_thought_brush_unavailable";
      throw error;
    }
    const projectId =
      normalizeString(
        input.projectId,
        this.store.focusedProjectId(),
      );
    const project =
      this.projectForAroReconstruction(
        projectId,
      );
    if (!project) {
      const error = new Error(
        "world_manager_thought_brush_project_unknown",
      );
      error.code =
        "world_manager_thought_brush_project_unknown";
      throw error;
    }
    const targetProjectId =
      normalizeString(
        input.targetProjectId,
        "",
      );
    if (
      targetProjectId &&
      !this
        .projectForAroReconstruction(
          targetProjectId,
        )
    ) {
      const error = new Error(
        "world_manager_thought_brush_target_project_unknown",
      );
      error.code =
        "world_manager_thought_brush_target_project_unknown";
      throw error;
    }
    const {
      canvas,
    } = this.contextCanvasForRequest({
      ...input,
      projectId,
    });
    const catalog =
      this.contextCanvasSourceCatalog({
        projectId,
        targetProjectId,
        canvas,
      });
    const latestContext =
      catalog
        .filter((source) =>
          source.objectClass ===
            "semantic_context_bundle" &&
          (
            !source.projectId ||
            source.projectId ===
              projectId
          ))
        .at(-1) || null;
    const request =
      buildThoughtBrushRequest({
        projectId,
        targetProjectId,
        brush: input.brush,
        currentCanvasRef:
          contextCanvasRef(canvas),
        sourceCatalog: catalog,
        altitude:
          input.altitude,
        userInstruction:
          input.userInstruction,
        preservationRules:
          input.preservationRules,
        operatorActionId:
          input.operatorActionId,
        requestedAt:
          new Date(
            this.now(),
          ).toISOString(),
        now: this.now,
      });
    const stroke =
      await this
        .thoughtBrushRuntime
        .run({
          request,
          reasoningEffort:
            normalizeString(
              input.reasoningEffort,
              "medium",
            ),
        });
    this.store
      .registerThoughtBrushStroke({
        stroke,
      });
    let nextCanvas = canvas;
    if (stroke.state === "completed") {
      nextCanvas =
        buildAppliedContextCanvas(
          canvas,
          stroke,
          {
            baseOperationalMetaContextRef:
              latestContext
                ? {
                    kind:
                      "semantic_context_bundle",
                    id:
                      latestContext.ref.id,
                    digest:
                      latestContext
                        .ref.digest,
                    projectId:
                      latestContext
                        .projectId,
                  }
                : canvas
                    .baseOperationalMetaContextRef,
            createdAt:
              new Date(
                this.now(),
              ).toISOString(),
            now: this.now,
          },
        );
      this.store
        .registerContextCanvas({
          canvas: nextCanvas,
        });
    }
    const projection = this.snapshot();
    const receipt = {
      schema:
        "direct_thought_brush_transition_receipt@1",
      state: stroke.state,
      brush: stroke.brush,
      brushStrokeRef:
        thoughtBrushStrokeRef(
          stroke,
        ),
      contextCanvasRef:
        contextCanvasRef(
          nextCanvas,
        ),
      canvasRevisionAdvanced:
        stroke.state ===
          "completed",
      candidateInsightCount:
        stroke.result
          ?.candidateInsights
          ?.length || 0,
      error: stroke.error,
      persistencePosture:
        "temporary_reversible",
      worldEffect: "none",
      canonicalAdmissionEffect:
        false,
      workspaceMutationEffect:
        false,
      grantsAuthority: false,
      projectionRevision:
        projection
          .projectionRevision,
    };
    this.emit("transition", {
      reason:
        stroke.state === "completed"
          ? "thought-brush-completed"
          : stroke.state ===
              "remanded"
            ? "thought-brush-remanded"
            : "thought-brush-failed",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  undoContextCanvas(
    input = {},
  ) {
    this.ensureStarted();
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const {
      canvas,
    } = this.contextCanvasForRequest({
      ...input,
      projectId,
    });
    if (
      canvas.revision <= 1 ||
      !canvas.predecessorRef
    ) {
      const error = new Error(
        "world_manager_context_canvas_undo_unavailable",
      );
      error.code =
        "world_manager_context_canvas_undo_unavailable";
      throw error;
    }
    const restored =
      this.store
        .contextCanvasRevision({
          contextCanvasId:
            canvas.contextCanvasId,
          digest:
            canvas.predecessorRef
              .digest,
        });
    if (!restored) {
      const error = new Error(
        "world_manager_context_canvas_undo_lineage_missing",
      );
      error.code =
        "world_manager_context_canvas_undo_lineage_missing";
      throw error;
    }
    const next =
      buildUndoContextCanvas(
        canvas,
        restored,
        {
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerContextCanvas({
        canvas: next,
      });
    const projection = this.snapshot();
    const receipt = {
      schema:
        "direct_context_canvas_undo_receipt@1",
      state: "restored",
      previousCanvasRef:
        contextCanvasRef(canvas),
      restoredCanvasRef:
        contextCanvasRef(
          restored,
        ),
      contextCanvasRef:
        contextCanvasRef(next),
      worldEffect: "none",
      canonicalAdmissionEffect:
        false,
      workspaceMutationEffect:
        false,
      grantsAuthority: false,
      projectionRevision:
        projection
          .projectionRevision,
    };
    this.emit("transition", {
      reason:
        "context-canvas-undone",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  extractContextCanvasInsight(
    input = {},
  ) {
    this.ensureStarted();
    validateContextCanvasInsightExtractionRequest(
      input,
    );
    const projectId =
      normalizeString(
        input.projectId,
        "",
      );
    const {
      canvas,
    } = this.contextCanvasForRequest({
      ...input,
      projectId,
    });
    const candidate =
      buildThoughtBrushAroCandidate({
        canvas,
        candidateInsightId:
          input.candidateInsightId,
        createdAt:
          new Date(
            this.now(),
          ).toISOString(),
        now: this.now,
      });
    const registered =
      this.store
        .registerAroReconstructionCandidate({
          candidate,
        });
    const projection = this.snapshot();
    const receipt = {
      schema:
        "direct_context_canvas_insight_extraction_receipt@1",
      state: registered.reused
        ? "reused"
        : "candidate_registered",
      contextCanvasRef:
        contextCanvasRef(canvas),
      candidateInsightId:
        normalizeString(
          input.candidateInsightId,
          "",
        ),
      aroCandidateRef:
        aroReconstructionCandidateRef(
          registered.candidate,
        ),
      canonicalAdmissionEffect:
        false,
      workspaceMutationEffect:
        false,
      worldEffect:
        "candidate_only",
      grantsAuthority: false,
      projectionRevision:
        projection
          .projectionRevision,
    };
    this.emit("transition", {
      reason:
        registered.reused
          ? "context-canvas-insight-extraction-reused"
          : "context-canvas-insight-extracted",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  projectForAroReconstruction(
    projectId,
  ) {
    return this.runtimeProjectDescriptor(
      normalizeString(projectId, ""),
    );
  }

  unavailableRepositoryObservation(
    project,
    error,
  ) {
    const projectId = normalizeString(
      project?.id ||
        project?.projectId,
      "",
    );
    return {
      schema:
        "workspace_repository_semantic_observation@1",
      projectId,
      workspaceKind: normalizeString(
        project?.workspaceKind,
        "unavailable",
      ),
      observationState:
        "unavailable",
      observationError: {
        code: normalizeString(
          error?.code,
          "world_manager_repository_observation_unavailable",
        ),
        message: normalizeString(
          error?.message,
          "Repository evidence could not be observed in the declared project substrate.",
        ),
      },
      gitAvailable: false,
      headOid: "",
      branch: "",
      dirtyPathCount: 0,
      statusDigest: stableId(
        "wm_repository_unavailable_status",
        {
          projectId,
          errorCode:
            error?.code || "",
        },
      ),
      diffDigest: stableId(
        "wm_repository_unavailable_diff",
        {
          projectId,
          errorCode:
            error?.code || "",
        },
      ),
      untrackedStateDigest: stableId(
        "wm_repository_unavailable_untracked",
        {
          projectId,
          errorCode:
            error?.code || "",
        },
      ),
      manifestDigest: stableId(
        "wm_repository_unavailable_manifest",
        {
          projectId,
          errorCode:
            error?.code || "",
        },
      ),
      trackedFileCount: 0,
      manifestPaths: [],
      manifestTruncated: false,
      evidence: [],
      evidenceCatalogComplete: false,
      rawWorkspacePathIncluded: false,
      rawSecretIncluded: false,
      observedAt:
        new Date(this.now()).toISOString(),
    };
  }

  noteAroSourceStaleness(
    snapshot,
  ) {
    if (
      snapshot.observationState !==
        "observed"
    ) {
      return 0;
    }
    const newRefsByIdentity =
      new Map(
        snapshot.evidence.map((entry) => [
          `${entry.sourceRef.kind}:${entry.sourceRef.id}`,
          entry.sourceRef,
        ]),
      );
    let changed = 0;
    for (
      const aro of
        this.store
          .listAbstractReasoningObjects({
            projectId:
              snapshot.projectId,
            currentOnly: true,
          })
    ) {
      const changedSourceRefs =
        aro.realizationBindings
          .map((binding) => {
            const next =
              newRefsByIdentity.get(
                `${binding.sourceRef.kind}:${binding.sourceRef.id}`,
              );
            return next &&
              next.digest !==
                binding.sourceRef.digest
              ? next
              : null;
          })
          .filter(Boolean);
      if (!changedSourceRefs.length) {
        continue;
      }
      const result =
        this.store
          .markAroRealizationsStale({
            aroId: aro.aroId,
            expectedAroDigest:
              aro.digest,
            expectedAroRevision:
              aro.revision,
            changedSourceRefs,
            changedAt:
              snapshot.observedAt,
          });
      if (!result.reused) changed += 1;
    }
    return changed;
  }

  queueAutomaticAroReconstructions() {
    if (!this.aroReconstructionAvailable()) {
      return [];
    }
    const queued = [];
    for (const project of this.projects) {
      const projectId = normalizeString(
        project.id ||
          project.projectId,
        "",
      );
      if (!projectId) continue;
      if (
        this.aroAutomaticallyObservedProjects
          .has(projectId)
      ) {
        continue;
      }
      this.aroAutomaticallyObservedProjects
        .add(projectId);
      queued.push(
        this.queueAroReconstruction({
          projectId,
          retry: false,
          trigger: "project_bootstrap",
        }),
      );
    }
    return queued;
  }

  queueAroReconstruction(
    input = {},
  ) {
    const projectId = normalizeString(
      input.projectId,
      "",
    );
    if (!this.aroReconstructionAvailable()) {
      const error = new Error(
        "world_manager_aro_reconstruction_unavailable",
      );
      error.code =
        "world_manager_aro_reconstruction_unavailable";
      return Promise.reject(error);
    }
    const project =
      this.projectForAroReconstruction(
        projectId,
      );
    if (!project) {
      const error = new Error(
        `world_manager_aro_reconstruction_project_unknown:${projectId}`,
      );
      error.code =
        "world_manager_aro_reconstruction_project_unknown";
      return Promise.reject(error);
    }
    const active =
      this.aroReconstructionJobs.get(
        projectId,
      );
    if (active) return active;
    const generation =
      ++this.aroReconstructionGeneration;
    const job =
      this.runAroReconstruction({
        project,
        retry:
          input.retry === true,
        trigger: normalizeString(
          input.trigger,
          "project_bootstrap",
        ),
        generation,
      })
        .catch((error) => {
          this.emit("transition", {
            reason:
              "aro-reconstruction-orchestration-failed",
            receipt: {
              schema:
                "direct_aro_reconstruction_orchestration_receipt@1",
              state: "failed",
              projectId,
              error:
                rendererSafeError(error),
              retryable: true,
              grantsAuthority: false,
            },
            projection: this.snapshot(),
          });
          return {
            state: "failed",
            error:
              rendererSafeError(error),
          };
        })
        .finally(() => {
          if (
            this.aroReconstructionJobs.get(
              projectId,
            ) === job
          ) {
            this.aroReconstructionJobs.delete(
              projectId,
            );
          }
        });
    this.aroReconstructionJobs.set(
      projectId,
      job,
    );
    return job;
  }

  async runAroReconstruction(
    input = {},
  ) {
    const project = input.project;
    const projectId = normalizeString(
      project.id ||
        project.projectId,
      "",
    );
    let observation;
    try {
      observation =
        await this.repositorySnapshotProvider(
          project,
        );
    } catch (error) {
      observation =
        this.unavailableRepositoryObservation(
          project,
          error,
        );
    }
    const snapshot =
      buildRepositorySemanticSnapshot({
        projectId,
        observation,
        now: this.now,
      });
    this.store
      .registerRepositorySemanticSnapshot({
        snapshot,
      });
    const staleAroCount =
      this.noteAroSourceStaleness(
        snapshot,
      );
    const scheduled =
      this.store
        .scheduleAroReconstructionRun({
          snapshot,
          retry:
            input.retry === true,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      return {
        state: scheduled.run.state,
        reused: true,
        run: scheduled.run,
        snapshot,
      };
    }
    this.emit("transition", {
      reason:
        "aro-reconstruction-scheduled",
      receipt: {
        schema:
          "direct_aro_reconstruction_orchestration_receipt@1",
        state: "scheduled",
        projectId,
        trigger: input.trigger,
        runRef: {
          kind:
            "aro_reconstruction_run",
          id: scheduled.run.runId,
          digest:
            scheduled.run.digest,
          projectId,
        },
        repositorySnapshotRef:
          scheduled.run
            .repositorySnapshotRef,
        staleAroCount,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const running =
      reviseAroReconstructionRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroReconstructionRun({
        run: running,
      });
    this.emit("transition", {
      reason:
        snapshot.observationState ===
          "observed"
          ? "aro-reconstruction-running"
          : "aro-reconstruction-evidence-unavailable",
      receipt: {
        schema:
          "direct_aro_reconstruction_orchestration_receipt@1",
        state: "running",
        projectId,
        runRef: {
          kind:
            "aro_reconstruction_run",
          id: running.runId,
          digest: running.digest,
          projectId,
        },
        repositorySnapshotRef:
          running.repositorySnapshotRef,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const result =
      await this.aroReconstructionRuntime
        .run({
          projectId,
          project,
          snapshot,
          attempt: running.attempt,
          reasoningEffort: "medium",
        });
    const candidateRefs = [];
    if (result.state === "completed") {
      for (const candidate of
        result.candidates) {
        const registered =
          this.store
            .registerAroReconstructionCandidate({
              candidate,
            });
        candidateRefs.push({
          kind:
            "aro_reconstruction_candidate",
          id:
            registered.candidate
              .candidateId,
          digest:
            registered.candidate.digest,
          projectId,
        });
      }
    }
    const terminal =
      reviseAroReconstructionRun(
        running,
        {
          state: result.state,
          requestManifest:
            result.requestManifest,
          validation:
            result.validation,
          candidateRefs,
          repositorySummary:
            result.repositorySummary,
          selectionRationale:
            result.selectionRationale,
          telemetry:
            result.telemetry,
          error: result.error,
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroReconstructionRun({
        run: terminal,
      });
    this.emit("transition", {
      reason:
        result.state === "completed"
          ? "aro-reconstruction-completed"
          : result.state === "remanded"
            ? "aro-reconstruction-remanded"
            : "aro-reconstruction-failed",
      receipt: {
        schema:
          "direct_aro_reconstruction_orchestration_receipt@1",
        state: result.state,
        projectId,
        runRef: {
          kind:
            "aro_reconstruction_run",
          id: terminal.runId,
          digest: terminal.digest,
          projectId,
        },
        repositorySnapshotRef:
          terminal.repositorySnapshotRef,
        candidateRefs,
        retryable:
          terminal.retryable,
        semanticTruthValidated: false,
        codeMutationExecuted: false,
        downstreamEffectsExecuted: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    return {
      state: terminal.state,
      reused: false,
      run: terminal,
      snapshot,
      candidates:
        result.candidates,
    };
  }

  async retryAroReconstruction(
    input = {},
  ) {
    this.ensureStarted();
    const projectId = normalizeString(
      input.projectId,
      "",
    );
    const latest =
      this.store
        .latestAroReconstructionRun({
          projectId,
        });
    if (
      !latest ||
      latest.retryable !== true
    ) {
      const error = new Error(
        "world_manager_aro_reconstruction_retry_unavailable",
      );
      error.code =
        "world_manager_aro_reconstruction_retry_unavailable";
      throw error;
    }
    const expectedRunDigest =
      normalizeString(
        input.expectedRunDigest,
        "",
      );
    if (
      expectedRunDigest &&
      expectedRunDigest !== latest.digest
    ) {
      const error = new Error(
        "world_manager_aro_reconstruction_retry_stale",
      );
      error.code =
        "world_manager_aro_reconstruction_retry_stale";
      throw error;
    }
    await this.queueAroReconstruction({
      projectId,
      retry: true,
      trigger: "operator_retry",
    });
    const projection = this.snapshot();
    return {
      receipt: {
        schema:
          "direct_aro_reconstruction_retry_receipt@1",
        state:
          this.store
            .latestAroReconstructionRun({
              projectId,
            })?.state ||
          "failed",
        projectId,
        currentProjectionRevision:
          projection.projectionRevision,
        semanticTruthValidated: false,
        codeMutationExecuted: false,
        downstreamEffectsExecuted: false,
        grantsAuthority: false,
      },
      projection,
    };
  }

  settleIngress(input = {}) {
    const existing = this.store.settlementForSemanticEvent(
      input.event.semanticEventId,
    );
    if (existing) {
      const routingDecision =
        this.store.routingDecisionForSemanticEvent(
          input.event.semanticEventId,
        );
      const contextBundle =
        this.store.managerContextForSemanticEvent(
          input.event.semanticEventId,
        );
      let agentWorld = this.store.agentWorldForSemanticEvent(
        input.event.semanticEventId,
      );
      if (
        existing.taskSettlement.state === "settled" &&
        contextBundle &&
        !agentWorld
      ) {
        const managerContext = this.worldmodel.buildManagerContext({
          taskSettlement: existing.taskSettlement,
          ingressEnvelope: existing.ingressEnvelope,
          targetResolution: existing.targetResolution,
        });
        const trustedEvidenceArtifacts = this.trustedEvidenceForTask(
          existing.taskSettlement,
        );
        const { compilation } = compileWorldManagerAgentWorld({
          taskSettlement: existing.taskSettlement,
          managerContext,
          graphBinding: this.worldmodelBinding,
          userWorldId: this.userWorldId,
          trustedEvidenceArtifacts,
          environment: this.compilationEnvironment(
            existing.taskSettlement,
            trustedEvidenceArtifacts,
          ),
        });
        agentWorld = this.store.commitAgentWorld({
          userEvent: input.event,
          taskSettlement: existing.taskSettlement,
          contextBundle,
          compilation,
        }).summary;
      }
      let operationalMetaContext = null;
      if (existing.taskSettlement.state === "settled") {
        const fullAgentWorld =
          this.store.agentWorldForSemanticEvent(
            input.event.semanticEventId,
            { full: true },
          );
        if (fullAgentWorld?.compilation) {
          operationalMetaContext =
            this.prepareOperationalMetaContext(
              existing.taskSettlement,
              fullAgentWorld.compilation,
            );
        }
      }
      return {
        reused: true,
        ...existing,
        routingDecision,
        contextBundle,
        agentWorld,
        operationalMetaContext:
          operationalMetaContext?.summary || null,
      };
    }
    const bootstrap = this.store.currentBootstrap();
    const pendingClarifications =
      this.store.listPendingDecisions().map(
        (decision) => ({
          ...decision,
          ambiguityReasons:
            this.store.settlementForSemanticEvent(
              decision.semanticEventId,
            )?.taskSettlement?.ambiguityReasons || [],
        }),
      );
    const completeSettlement = (semanticIngressRun) => {
      const bundle = settleWorldManagerIngress(
        {
          bootstrap,
          event: input.event,
          message: input.message,
          request: input.request,
          focusedProjectId: this.store.focusedProjectId(),
          graphBinding: this.worldmodelBinding,
          pendingClarifications,
          semanticIngressRun,
        },
        { now: this.now },
      );
      const managerContext =
        bundle.taskSettlement.state === "settled"
          ? this.worldmodel.buildManagerContext(bundle)
          : null;
      const committed = this.store.commitSettlement({
        userEvent: input.event,
        ...bundle,
        contextBundle: managerContext?.contextBundle || null,
        resolvedClarificationId:
          bundle.resolvedClarificationId,
      });
      if (!managerContext) return committed;
      const trustedEvidenceArtifacts =
        this.trustedEvidenceForTask(
          bundle.taskSettlement,
        );
      const { compilation } = compileWorldManagerAgentWorld({
        taskSettlement: bundle.taskSettlement,
        managerContext,
        graphBinding: this.worldmodelBinding,
        userWorldId: this.userWorldId,
        trustedEvidenceArtifacts,
        environment: this.compilationEnvironment(
          bundle.taskSettlement,
          trustedEvidenceArtifacts,
        ),
      });
      const agentWorldCommit = this.store.commitAgentWorld({
        userEvent: input.event,
        taskSettlement: bundle.taskSettlement,
        contextBundle: managerContext.contextBundle,
        compilation,
      });
      const operationalMetaContext =
        this.prepareOperationalMetaContext(
          bundle.taskSettlement,
          agentWorldCommit.compilation,
        );
      return {
        ...committed,
        agentWorld: agentWorldCommit.summary,
        agentWorldCompilation:
          agentWorldCommit.compilation,
        agentWorldTransitionEvent:
          agentWorldCommit.transitionEvent,
        projectionRevision:
          operationalMetaContext.projectionRevision,
        operationalMetaContext:
          operationalMetaContext.summary,
      };
    };
    const semanticIngressRun = this.semanticIngress.run({
      userWorldId: this.userWorldId,
      projects: this.store.semanticProjectIndex(),
      event: input.event,
      message: input.message,
      request: input.request,
      focusedProjectId: this.store.focusedProjectId(),
      graphBinding: this.worldmodelBinding,
      pendingDecisions:
        this.semanticPendingDecisions(),
      semanticChildContract:
        this.store.semanticChildContractForEvent(
          input.event.semanticEventId,
        )?.contract || null,
    });
    if (
      semanticIngressRun &&
      typeof semanticIngressRun.then === "function"
    ) {
      return semanticIngressRun.then(completeSettlement);
    }
    return completeSettlement(semanticIngressRun);
  }

  semanticPendingDecisions() {
    const projectIndex = new Map(
      this.store.semanticProjectIndex()
        .map((project) => [
          project.projectId,
          project,
        ]),
    );
    const typed = this.store
      .listSemanticArtifacts({
        artifactKind: "open_decision",
        currentOnly: true,
        limit: 5000,
      })
      .filter((decision) =>
        ["open", "blocked", "conflicted"].includes(
          decision.decisionState,
        ))
      .map((decision) => {
        const semanticDecisionRef = {
          kind: "open_decision",
          id: decision.decisionId,
          digest: decision.digest,
          projectId:
            decision.header.scope.projectId,
        };
        const governedTargetRef =
          (decision.options || [])
            .map((option) =>
              option.semanticValue?.targetArtifactRef)
            .find((candidate) =>
              candidate?.kind &&
              candidate?.id &&
              candidate?.digest) ||
          decision.header.provenanceRefs
            .find((candidate) =>
              candidate?.kind &&
              candidate?.id &&
              candidate?.digest &&
              candidate.kind !== "world_manager_semantic_event") ||
          semanticDecisionRef;
        const targetArtifactRef = {
          kind: governedTargetRef.kind,
          id: governedTargetRef.id,
          digest: governedTargetRef.digest,
          projectId:
            governedTargetRef.projectId ||
            decision.header.scope.projectId ||
            "",
        };
        const executableDispositions =
          decision.decisionKind ===
            "plan_proposal_admission" &&
          decision.decisionState === "open" &&
          (decision.options || []).some((option) =>
            option.optionKey ===
              "admit_exact_plan_revision" &&
            option.availability === "available")
            ? ["authorize_exact_target"]
            : [];
        return {
          decisionRequestId: decision.decisionId,
          semanticDecisionRef,
          decisionKind: decision.decisionKind,
          targetArtifactRef,
          state: decision.decisionState,
          semanticIdentity:
            decision.header.semanticIdentity,
          question: decision.question,
          resolutionMode:
            decision.resolutionMode,
          options: (decision.options || [])
            .map((option) => ({
              optionKey: option.optionKey,
              label: option.label,
              availability:
                option.availability,
              semanticValue:
                option.semanticValue,
            })),
          executableDispositions,
          targetProjectStatusClass:
            projectIndex.get(
              decision.header.scope.projectId,
            )?.statusClass || "",
          targetProjectRoleRuntimeAddressable:
            projectIndex.get(
              decision.header.scope.projectId,
            )?.roleRuntimeAddressable ===
              true,
        };
      });
    return typed.length
      ? typed
      : this.store.listPendingDecisions();
  }

  verifyRestartContexts() {
    const checks = [];
    for (const settlement of this.store.listSettlements({ limit: 1000 })) {
      if (settlement.state !== "settled") continue;
      const stored = this.store.managerContextForSemanticEvent(
        settlement.semanticEventId,
      );
      const persisted = this.store.settlementForSemanticEvent(
        settlement.semanticEventId,
      );
      if (!stored || !persisted) {
        checks.push({
          semanticEventId: settlement.semanticEventId,
          reason: "context_receipt_missing",
        });
        continue;
      }
      const contextDigestValid =
        stored.schema ===
          WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA &&
        stored.semanticEventId ===
          settlement.semanticEventId &&
        stored.digest === digestFor(
          WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA,
          stored,
          ["digest"],
        ) &&
        stored.contextAdmissionState ===
          "deferred_to_k3" &&
        stored.providerRoleTurnState ===
          "not_started" &&
        stored.grantsAuthority === false;
      if (!contextDigestValid) {
        checks.push({
          semanticEventId: settlement.semanticEventId,
          reason:
            "historical_context_binding_invalid",
        });
      }
    }
    this.restartContextVerification = {
      checked: this.store.listManagerContexts({ limit: 1000 }).length,
      valid: checks.length === 0,
      mismatches: checks,
    };
    if (checks.length) {
      const error = new Error("world_manager_context_restart_verification_failed");
      error.code = "world_manager_context_restart_verification_failed";
      throw error;
    }
    const agentWorldChecks = [];
    const historicalCompilerAccepted = [];
    let agentWorldChecked = 0;
    for (const settlement of this.store.listSettlements({ limit: 1000 })) {
      if (settlement.state !== "settled") continue;
      const persisted = this.store.settlementForSemanticEvent(
        settlement.semanticEventId,
      );
      const stored = this.store.agentWorldForSemanticEvent(
        settlement.semanticEventId,
        { full: true },
      );
      if (!persisted || !stored?.compilation) {
        agentWorldChecks.push({
          semanticEventId: settlement.semanticEventId,
          reason: "agent_world_compilation_missing",
        });
        continue;
      }
      const contextBundle =
        this.store.managerContextForSemanticEvent(
          settlement.semanticEventId,
        );
      agentWorldChecked += 1;
      const bindingMismatches =
        historicalCompilationBindingMismatches({
          compilation: stored.compilation,
          taskSettlement: settlement,
          contextBundle,
        });
      if (bindingMismatches.length) {
        agentWorldChecks.push({
          semanticEventId: settlement.semanticEventId,
          reason:
            "historical_compiler_source_binding_mismatch",
          bindingMismatches,
        });
        continue;
      }
      const storedCompilerRevision =
        stored.compilation.manifest?.compilerRevision || "";
      const storedRegistryDigest =
        stored.compilation.roleTemplateRegistryRef?.digest || "";
      const currentRegistryDigest =
        trustedRoleTemplateRegistry().digest;
      if (
        storedCompilerRevision &&
        storedCompilerRevision !== COMPILER_REVISION
      ) {
        historicalCompilerAccepted.push({
          semanticEventId: settlement.semanticEventId,
          reason:
            "historical_agent_world_compiler_revision",
          storedCompilerRevision,
          currentCompilerRevision: COMPILER_REVISION,
          persistedCompilationDigest:
            stored.compilation.digest,
        });
      } else if (
        storedRegistryDigest &&
        storedRegistryDigest !== currentRegistryDigest
      ) {
        historicalCompilerAccepted.push({
          semanticEventId: settlement.semanticEventId,
          reason:
            "historical_role_template_registry_revision",
          storedCompilerRevision,
          currentCompilerRevision: COMPILER_REVISION,
          storedRegistryDigest,
          currentRegistryDigest,
          persistedCompilationDigest:
            stored.compilation.digest,
        });
      }
    }
    this.restartAgentWorldVerification = {
      checked: agentWorldChecked,
      valid: agentWorldChecks.length === 0,
      mismatches: agentWorldChecks,
      historicalCompilerAccepted,
    };
    if (agentWorldChecks.length) {
      const error = new Error(
        "world_manager_agent_world_restart_verification_failed",
      );
      error.code =
        "world_manager_agent_world_restart_verification_failed";
      throw error;
    }
    return this.restartContextVerification;
  }

  workThreads() {
    if (!this.workThreadStore?.listWorkThreads) return [];
    try {
      return this.workThreadStore.listWorkThreads({ includeArchived: false });
    } catch {
      return [];
    }
  }

  currentPlanProposal(projectId) {
    return this.store.currentPlanProposalRevision(projectId);
  }

  registerReconciledPlanProposal(input = {}) {
    const parent = this.currentPlanProposal(input.projectId);
    const semanticPayload = input.semanticPayload || {};
    const proposal = buildPlanProposalRevision({
      projectId: input.projectId,
      proposalLineageId: parent?.proposalLineageId,
      revision: parent ? parent.revision + 1 : 1,
      parentProposalRevisionRef: parent ? planProposalRef(parent) : null,
      title:
        normalizeString(semanticPayload.title, "") ||
        parent?.title ||
        `Project plan for ${input.projectId}`,
      summary:
        normalizeString(semanticPayload.summary, "") ||
        input.reconciliation?.semanticSummary ||
        input.finalAssistantMessage?.text ||
        "Reconciled project plan",
      proposalText: input.finalAssistantMessage?.text || "",
      features: Array.isArray(semanticPayload.features)
        ? semanticPayload.features
        : [],
      semanticSummary: input.reconciliation?.semanticSummary,
      blindspots: input.reconciliation?.blindspots,
      continuationPaths: input.reconciliation?.continuationPaths,
      recommendation: input.reconciliation?.recommendation,
      sourceAgentResultRef: {
        kind: "agent_result",
        id: input.managerAgentResult.agentResultId,
        digest: input.managerAgentResult.digest,
        projectId: input.projectId,
      },
      sourceFinalMessageRef: {
        kind: "final_assistant_message",
        id: input.finalAssistantMessage.finalAssistantMessageId,
        digest: input.finalAssistantMessage.digest,
        projectId: input.projectId,
      },
      sourceSemanticEventRef: {
        kind: "world_manager_semantic_event",
        id: input.userEvent.semanticEventId,
        digest: input.userEvent.eventDigest,
        projectId: input.projectId,
      },
      reconciliationRef: {
        kind: "world_manager_reconciliation",
        id: input.reconciliation.reconciliationId,
        digest: input.reconciliation.digest,
        projectId: input.projectId,
      },
      expectedCanonicalRevisionRefs:
        this.worldmodel.canonicalArtifactRevisionRefs({
          kind: "project",
          projectId: input.projectId,
        }),
      createdAt: new Date(this.now()).toISOString(),
    });
    return this.store.registerPlanProposalRevision({ proposal });
  }

  inspectPlanProposal(input = {}) {
    this.ensureStarted();
    const proposal = this.store.planProposalRevisionById(
      input.proposalRevisionId || input.proposalId,
    );
    if (!proposal) serviceFail("world_manager_plan_proposal_missing");
    const reviewed = this.store.reviewPlanProposalRevision({
      proposalRevisionId: proposal.proposalRevisionId,
      proposalDigest: input.proposalDigest || proposal.digest,
      actorId: input.actorId || "operator",
      reviewedAt: new Date(this.now()).toISOString(),
    });
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "plan-proposal-evidence-reviewed",
      receipt: {
        schema: "direct_world_manager_plan_review_receipt@1",
        state: "reviewed",
        proposalRevisionRef: planProposalRef(proposal),
        reviewReceiptRef: {
          kind: "plan_proposal_review_receipt",
          id: reviewed.reviewReceipt.reviewReceiptId,
          digest: reviewed.reviewReceipt.digest,
        },
        grantsAuthority: false,
      },
      projection,
    });
    return { ...reviewed, projection };
  }

  planAdmissionAdapterInput(proposal, request) {
    const artifactRevision = {
      artifactRevisionId: proposal.proposalRevisionId,
      artifactDigest: proposal.digest,
      artifactTypeId: "PlanProposalRevision",
      revision: proposal.revision,
      artifactContentRef: planProposalRef(proposal),
    };
    const lifecycle = {
      lifecycleId: stableId("wm_plan_admission_lifecycle", {
        admissionRequestId: request.admissionRequestId,
      }),
      state: "admission_pending",
      digest: request.digest,
      createdAt: request.requestedAt,
      updatedAt: request.requestedAt,
    };
    const gateDecision = {
      gateDecisionId: request.admissionRequestId,
      decisionState: "gate_ready",
      digest: request.digest,
      targetAdmissionScope: request.targetAdmissionScope,
      assuranceGraphRef: request.reviewReceiptRef,
    };
    return {
      lifecycle,
      artifactRevision,
      gateDecision,
      targetAdmissionScope: request.targetAdmissionScope,
      expectedCanonicalRevisionRefs: request.expectedCanonicalRevisionRefs,
      actorRef: this.worldmodel.projectManagerAdmissionActorRef(
        proposal.projectId,
      ),
      issuedAt: request.requestedAt,
    };
  }

  completePlanProposalAdmission(record) {
    const request = record.request;
    const proposal = this.store.planProposalRevisionById(
      request.proposalRevisionRef.id,
    );
    if (!proposal || proposal.digest !== request.proposalRevisionRef.digest) {
      serviceFail("world_manager_plan_proposal_stale_or_unknown");
    }
    let graphAdmission;
    let decision = record.decision;
    try {
      graphAdmission = this.worldmodel.admitArtifactRevision(
        this.planAdmissionAdapterInput(proposal, request),
      );
      decision = decision?.admissionDecisionId
        ? decision
        : buildPlanAdmissionDecision({
            projectId: proposal.projectId,
            proposalRevisionRef: planProposalRef(proposal),
            admissionRequestRef: {
              kind: "plan_admission_request",
              id: request.admissionRequestId,
              digest: request.digest,
              projectId: proposal.projectId,
            },
            graphTransitionRef: graphAdmission.trustStoreReceiptRef,
            canonicalGraphRef: graphAdmission.canonicalGraphRef,
            activationState: "contract_pending",
            decidedAt: new Date(this.now()).toISOString(),
          });
      this.store.recordPlanAdmissionProgress({
        admissionRequestId: request.admissionRequestId,
        state: "graph_admitted",
        decision,
      });
    } catch (error) {
      if (/stale|revision/i.test(error?.code || error?.message || "")) {
        this.store.recordPlanAdmissionProgress({
          admissionRequestId: request.admissionRequestId,
          state: "stale_conflict",
          error: error.code || error.message,
        });
      }
      throw error;
    }
    const workThreadId = stableId("wm_plan_implementation_work_thread", {
      proposalRevisionRef: planProposalRef(proposal),
      admissionDecisionId: decision.admissionDecisionId,
    });
    const contract = buildImplementationContract({
      projectId: proposal.projectId,
      proposalRevisionRef: planProposalRef(proposal),
      admissionDecisionRef: {
        kind: "plan_admission_decision",
        id: decision.admissionDecisionId,
        digest: decision.digest,
        projectId: proposal.projectId,
      },
      canonicalGraphRef: decision.canonicalGraphRef,
      graphTransitionRef: decision.graphTransitionRef,
      workThreadId,
      objective: proposal.summary,
      deliverables: proposal.features.map((feature) => feature.title),
      actorId: request.actorId,
      createdAt: decision.decidedAt,
    });
    try {
      const workThread = this.workThreadStore.upsertWorkThread({
        workThreadId,
        projectId: proposal.projectId,
        title: proposal.title,
        lifecycleState: "contract_received",
        objective: {
          summary: contract.objective,
          currentObjective:
            "Await a separately authorized worker-start transition.",
          priority: "normal",
        },
        ontologyProfileRef: planProposalRef(proposal),
        implementationContractRef: {
          kind: "implementation_contract",
          id: contract.implementationContractId,
          digest: contract.digest,
          projectId: proposal.projectId,
        },
        contextPacketRef: {
          kind: "plan_admission_decision",
          id: decision.admissionDecisionId,
          digest: decision.digest,
          projectId: proposal.projectId,
        },
        phaseState: {
          phaseId: "wm_k5_contract_received",
          phaseKind: "implementation_contract",
          status: "contract_received",
        },
        activeRuntimePath: "direct-implementation",
        authorityBoundary: {
          allowedActions: ["inspect_admitted_contract"],
          forbiddenActions: [
            "worker_start_without_authorization",
            "workspace_mutation",
            "remote_mutation",
          ],
          summary:
            "The contract is canonical, but implementation has not started.",
        },
        evidenceRefs: [
          planProposalRef(proposal),
          decision.graphTransitionRef,
        ],
        createdAt: contract.createdAt,
        updatedAt: new Date(this.now()).toISOString(),
      });
      this.store.recordPlanAdmissionProgress({
        admissionRequestId: request.admissionRequestId,
        state: "contract_received",
        decision,
        implementationContract: contract,
        workThreadId: workThread.workThreadId,
      });
      return { proposal, decision, contract, workThread, graphAdmission };
    } catch (error) {
      this.store.recordPlanAdmissionProgress({
        admissionRequestId: request.admissionRequestId,
        state: "pending_repair",
        decision,
        implementationContract: contract,
        workThreadId,
        error: error.code || error.message,
      });
      throw error;
    }
  }

  admitPlanProposal(input = {}) {
    this.ensureStarted();
    if (!this.workThreadStore?.upsertWorkThread) {
      serviceFail("world_manager_plan_work_thread_store_unavailable");
    }
    const proposal = this.store.planProposalRevisionById(
      input.proposalRevisionId || input.proposalId,
    );
    if (!proposal) serviceFail("world_manager_plan_proposal_missing");
    const begun = this.store.beginPlanProposalAdmission({
      proposalRevisionId: proposal.proposalRevisionId,
      proposalDigest: input.proposalDigest || proposal.digest,
      actorId: input.actorId || "operator",
      requestedAt: new Date(this.now()).toISOString(),
    });
    let result = begun.state === "contract_received"
      ? null
      : this.completePlanProposalAdmission(begun);
    if (!result) {
      const admission = this.store.listPlanAdmissions()
        .find((record) =>
          record.request?.proposalRevisionRef?.id ===
            proposal.proposalRevisionId &&
          record.state === "contract_received");
      const contract = this.store.listImplementationContracts()
        .find((candidate) =>
          candidate.implementationContractId ===
            admission?.implementationContractId) || null;
      const workThread = admission?.workThreadId &&
        this.workThreadStore?.readWorkThread
        ? this.workThreadStore.readWorkThread(
            admission.workThreadId,
          )
        : null;
      result = {
        proposal,
        decision: admission?.decision || null,
        contract,
        workThread,
        reused: true,
      };
    }
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "plan-proposal-contract-received",
      receipt: {
        schema: "direct_world_manager_plan_admission_receipt@1",
        state: "contract_received",
        proposalRevisionRef: planProposalRef(proposal),
        implementationStarted: false,
        grantsWorkerStartAuthority: false,
      },
      projection,
    });
    return { ...result, projection };
  }

  recoverPlanProposalAdmissions() {
    if (!this.workThreadStore?.upsertWorkThread) return;
    const pending = this.store.listPlanAdmissions({
      states: ["pending_graph_admission", "graph_admitted", "pending_repair"],
    });
    for (const record of pending) {
      try {
        this.completePlanProposalAdmission(record);
      } catch {
        // The durable admission state remains visibly stale or pending repair.
      }
    }
  }

  recoverPlanExecutions() {
    if (!this.workThreadStore?.readWorkThread) return;
    for (const record of this.store.listPlanExecutions()) {
      if (record.state === "completed") {
        try {
          this.admitCompletedPlanExecution(record);
        } catch {
          // The completed record remains durable and retryable.
        }
        continue;
      }
      if (record.state !== "starting") continue;
      const workThread = this.workThreadStore.readWorkThread(
        record.workThreadRef.id,
      );
      let workThreadRef = record.workThreadRef;
      if (workThread) {
        const paused = this.workThreadStore.upsertWorkThread({
          ...workThread,
          lifecycleState: "paused",
          objective: {
            ...workThread.objective,
            currentObjective:
              "Resolve the uncertain worker-start outcome from the prior runtime before any new authorization.",
          },
          phaseState: {
            phaseId: "wm_k6_plan_execution_restart",
            phaseKind: "worker_start_recovery",
            status: "paused_uncertain",
          },
          authorityBoundary: {
            allowedActions: ["inspect_persisted_worker_lineage"],
            forbiddenActions: [
              "automatic_worker_start_replay",
              "workspace_mutation",
              "remote_mutation",
              "canonical_worldstate_admission",
            ],
            summary:
              "The runtime restarted across the worker-start boundary. Automatic replay is forbidden.",
          },
          updatedAt: new Date(this.now()).toISOString(),
        });
        workThreadRef = {
          kind: "work_thread",
          id: paused.workThreadId,
          digest: paused.digest,
          projectId: paused.projectId,
        };
      }
      const failed = revisePlanExecutionRecord(
        record,
        {
          state: "failed",
          workThreadRef,
          error: {
            schema: "direct_world_manager_error@1",
            code:
              "world_manager_plan_execution_worker_start_outcome_uncertain",
            message:
              "The runtime restarted before the worker-start result was durably reconciled. The start was not replayed.",
            detail: "",
            grantsAuthority: false,
          },
        },
        { now: this.now },
      );
      this.store.registerPlanExecutionRecord(failed);
    }
  }

  planExecutionAvailable() {
    return Boolean(
      this.planProposalLifecycleEnabled &&
      this.workThreadStore?.readWorkThread &&
      this.workThreadStore?.upsertWorkThread &&
      this.planExecutionRuntime &&
      typeof this.planExecutionRuntime.start === "function" &&
      typeof this.planExecutionRuntime.observe === "function" &&
      typeof this.planExecutionRuntime.evaluateClosure === "function" &&
      (typeof this.planExecutionRuntime.available !== "function" ||
        this.planExecutionRuntime.available()),
    );
  }

  currentPlanExecution(input = {}, allowedStates = []) {
    const record = this.store.planExecutionById(
      input.executionId,
    );
    if (!record) {
      serviceFail(
        "world_manager_plan_execution_missing",
        input.executionId,
      );
    }
    if (
      normalizeString(input.executionDigest, "") &&
      record.digest !== input.executionDigest
    ) {
      serviceFail(
        "world_manager_plan_execution_stale_revision",
        record.executionId,
      );
    }
    if (
      allowedStates.length &&
      !allowedStates.includes(record.state)
    ) {
      serviceFail(
        "world_manager_plan_execution_state_invalid",
        `${record.state}->${allowedStates.join("|")}`,
      );
    }
    return record;
  }

  async preparePlanExecution(input = {}) {
    this.ensureStarted();
    if (!this.planExecutionAvailable()) {
      serviceFail("world_manager_plan_execution_runtime_unavailable");
    }
    const contractId = normalizeString(
      input.implementationContractId || input.contractId,
      "",
    );
    const contract = this.store.listImplementationContracts()
      .find((candidate) =>
        candidate.implementationContractId === contractId);
    if (!contract) {
      serviceFail(
        "world_manager_plan_execution_contract_missing",
        contractId,
      );
    }
    validateImplementationContract(contract);
    if (
      normalizeString(input.implementationContractDigest, "") &&
      input.implementationContractDigest !== contract.digest
    ) {
      serviceFail(
        "world_manager_plan_execution_contract_stale",
        contractId,
      );
    }
    const existing = this.store.planExecutionForContract(contractId);
    if (existing) {
      return {
        reused: true,
        record: existing,
        projection: this.snapshot(),
      };
    }
    const workThread = this.workThreadStore.readWorkThread(
      contract.workThreadId,
    );
    if (!workThread) {
      serviceFail(
        "world_manager_plan_execution_work_thread_missing",
        contract.workThreadId,
      );
    }
    const capabilitySnapshot =
      typeof this.planExecutionRuntime.capabilitySnapshot === "function"
        ? await this.planExecutionRuntime.capabilitySnapshot({
            projectId: contract.projectId,
            contract,
            workThread,
          }) || {}
        : {};
    if (capabilitySnapshot.turnRunnable === false) {
      serviceFail(
        "world_manager_plan_execution_runtime_not_runnable",
        capabilitySnapshot.reason || contract.projectId,
      );
    }
    const targetScope = {
      kind: "project",
      projectId: contract.projectId,
    };
    const constitution = buildPlanExecutionConstitution({
      contract,
      workThread,
      userWorldId: this.userWorldId,
      projectManagerAgentId:
        this.worldmodel.projectManagerAdmissionActorRef(
          contract.projectId,
        ).id,
      availableToolNames:
        capabilitySnapshot.availableToolNames,
      environment:
        capabilitySnapshot.environment || "local_repository",
      sourceScopeRevisions:
        this.worldmodel.graph.scopedRevisionRefs.filter((entry) =>
          entry.scopeKind === "project" &&
          entry.projectId === contract.projectId),
      compiledAt: new Date(this.now()).toISOString(),
      now: this.now,
    });
    const handoffPacket = buildPlanExecutionHandoff({
      constitution,
      workThread,
      now: this.now,
    });
    const record = buildPlanExecutionRecord({
      constitution,
      handoffPacket,
      now: this.now,
    });
    const registered = this.store.registerPlanExecutionRecord(record);
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "plan-execution-prepared",
      receipt: {
        schema: "direct_world_manager_plan_execution_receipt@1",
        state: "prepared",
        executionRef: planExecutionRecordRef(registered.record),
        workerStarted: false,
        providerCallStarted: false,
        canonicalEffect: false,
        grantsAuthority: false,
      },
      projection,
    });
    return {
      reused: registered.reused,
      record: registered.record,
      projection,
    };
  }

  async authorizePlanExecution(input = {}) {
    this.ensureStarted();
    if (!this.planExecutionAvailable()) {
      serviceFail("world_manager_plan_execution_runtime_unavailable");
    }
    const record = this.currentPlanExecution(input, ["prepared"]);
    const workThread = this.workThreadStore.readWorkThread(
      record.workThreadRef.id,
    );
    if (
      !workThread ||
      workThread.digest !== record.workThreadRef.digest ||
      workThread.lifecycleState !== "contract_received"
    ) {
      serviceFail(
        "world_manager_plan_execution_work_thread_stale",
        record.workThreadRef.id,
      );
    }
    const authorization = buildPlanExecutionAuthorization({
      constitution: record.constitution,
      handoffPacket: record.handoffPacket,
      handoffPacketDigest: input.handoffPacketDigest,
      operatorActionId: input.operatorActionId,
      actorId: input.actorId || "operator",
      authorizedAt: new Date(this.now()).toISOString(),
      now: this.now,
    });
    let starting = revisePlanExecutionRecord(
      record,
      { state: "starting", authorization },
      { now: this.now },
    );
    starting = this.store.registerPlanExecutionRecord(starting).record;
    try {
      if (typeof this.roleRuntime?.registerCompilation === "function") {
        this.roleRuntime.registerCompilation({
          compiledAgentContext:
            record.constitution.compiledAgentContext,
        });
      }
      const runtimeResult = await this.planExecutionRuntime.start({
        projectId: record.projectId,
        record: starting,
        authorization,
        handoffPacket: record.handoffPacket,
        workerPrompt: planExecutionWorkerPrompt(
          record.constitution,
        ),
        workThread,
        operatorActionId: authorization.operatorActionId,
        compiledAgentContext:
          record.constitution.compiledAgentContext,
        compiledAgentContextRef: {
          kind: "compiled_agent_context",
          id: record.constitution.compiledAgentContext
            .compiledAgentContextId,
          digest: record.constitution.compiledAgentContext.digest,
          projectId: record.projectId,
        },
      });
      const result = runtimeResult?.result || runtimeResult;
      if (
        result?.status !== "started" ||
        !normalizeString(result.workerSessionId, "") ||
        !normalizeString(result.workerTurnId, "")
      ) {
        serviceFail(
          "world_manager_plan_execution_worker_start_invalid",
        );
      }
      const resultRef = exactExecutionRef({
        kind: "direct_worker_start_result",
        id: result.resultId || stableId(
          "wm_plan_execution_worker_start_result",
          {
            executionId: record.executionId,
            workerSessionId: result.workerSessionId,
            workerTurnId: result.workerTurnId,
          },
        ),
        digest: result.resultDigest || digestFor(
          "direct-worker-start-result-observation@1",
          result,
        ),
        projectId: record.projectId,
      });
      const consumedAuthorization = {
        ...authorization,
        consumed: true,
        consumedAt: new Date(this.now()).toISOString(),
      };
      consumedAuthorization.digest = digestFor(
        consumedAuthorization.schema,
        consumedAuthorization,
        ["digest"],
      );
      const activeWorkThread = this.workThreadStore.upsertWorkThread({
        ...workThread,
        lifecycleState: "active",
        objective: {
          ...workThread.objective,
          currentObjective:
            "Execute the admitted implementation contract and return evidence-bearing completion witnesses.",
        },
        phaseState: {
          phaseId: "wm_k6_plan_execution",
          phaseKind: "admitted_plan_implementation",
          status: "active",
        },
        authorityBoundary: {
          allowedActions: [
            "provider_turn",
            "separately_approved_local_effect",
          ],
          forbiddenActions: [
            "workspace_mutation_without_per_call_approval",
            "remote_mutation",
            "canonical_worldstate_admission",
            "worker_self_certified_completion",
          ],
          summary:
            "One Direct worker turn is active. Every local effect remains separately gated; completion and canonical admission remain Project Manager-owned.",
        },
        evidenceRefs: [
          ...(workThread.evidenceRefs || []),
          resultRef,
        ],
        updatedAt: new Date(this.now()).toISOString(),
      });
      const workerStart = {
        authorizationRef: exactExecutionRef({
          kind: "plan_execution_authorization",
          id: consumedAuthorization.authorizationId,
          digest: consumedAuthorization.digest,
          projectId: record.projectId,
        }),
        result,
        resultRef,
        transition: runtimeResult?.transition || null,
        canonicalEffect: false,
      };
      const active = revisePlanExecutionRecord(
        starting,
        {
          state: "active",
          authorization: consumedAuthorization,
          workerStart,
          workThreadRef: {
            kind: "work_thread",
            id: activeWorkThread.workThreadId,
            digest: activeWorkThread.digest,
            projectId: activeWorkThread.projectId,
          },
        },
        { now: this.now },
      );
      const persisted = this.store.registerPlanExecutionRecord(active).record;
      const projection = this.snapshot();
      this.emit("transition", {
        reason: "plan-execution-worker-started",
        receipt: {
          schema: "direct_world_manager_plan_execution_receipt@1",
          state: "active",
          executionRef: planExecutionRecordRef(persisted),
          workerStartResultRef: resultRef,
          providerCallStarted: true,
          workThreadActive: true,
          canonicalEffect: false,
          grantsAuthority: false,
        },
        projection,
      });
      return { record: persisted, projection };
    } catch (error) {
      const current = this.store.planExecutionById(
        starting.executionId,
      );
      if (current?.digest === starting.digest) {
        const currentWorkThread = this.workThreadStore.readWorkThread(
          starting.workThreadRef.id,
        );
        let failedWorkThreadRef = starting.workThreadRef;
        if (currentWorkThread) {
          const paused = this.workThreadStore.upsertWorkThread({
            ...currentWorkThread,
            lifecycleState: "paused",
            objective: {
              ...currentWorkThread.objective,
              currentObjective:
                "Resolve the failed or uncertain worker-start outcome before any new execution authority is issued.",
            },
            phaseState: {
              phaseId: "wm_k6_plan_execution_start_failure",
              phaseKind: "worker_start_recovery",
              status: "paused_uncertain",
            },
            authorityBoundary: {
              allowedActions: ["inspect_persisted_worker_lineage"],
              forbiddenActions: [
                "automatic_worker_start_replay",
                "workspace_mutation",
                "remote_mutation",
                "canonical_worldstate_admission",
              ],
              summary:
                "The worker-start operation did not produce a fully reconciled durable result. Automatic replay is forbidden.",
            },
            updatedAt: new Date(this.now()).toISOString(),
          });
          failedWorkThreadRef = {
            kind: "work_thread",
            id: paused.workThreadId,
            digest: paused.digest,
            projectId: paused.projectId,
          };
        }
        const failed = revisePlanExecutionRecord(
          starting,
          {
            state: "failed",
            workThreadRef: failedWorkThreadRef,
            error: rendererSafeError(error),
          },
          { now: this.now },
        );
        this.store.registerPlanExecutionRecord(failed);
      }
      throw error;
    }
  }

  async completePlanExecution(input = {}) {
    this.ensureStarted();
    let record = this.currentPlanExecution(
      input,
      ["active", "completed", "admitted"],
    );
    if (record.state === "admitted") {
      return {
        reused: true,
        record,
        projection: this.snapshot(),
      };
    }
    if (record.state === "active") {
      const observation = await this.planExecutionRuntime.observe({
        projectId: record.projectId,
        record,
        workerSessionId:
          record.workerStart.result.workerSessionId,
        workerTurnId:
          record.workerStart.result.workerTurnId,
      });
      let runtimeEvidenceRefs = Array.isArray(
        observation.runtimeEvidenceRefs,
      )
        ? [...observation.runtimeEvidenceRefs]
        : [];
      const contract = this.store.listImplementationContracts()
        .find((candidate) =>
          candidate.implementationContractId ===
            record.implementationContractRef.id);
      if (
        !contract ||
        contract.digest !== record.implementationContractRef.digest
      ) {
        serviceFail(
          "world_manager_plan_execution_contract_stale",
          record.implementationContractRef.id,
        );
      }
      const closureAssessment =
        await this.planExecutionRuntime.evaluateClosure({
          projectId: record.projectId,
          implementationContractRef:
            record.implementationContractRef,
          workThreadRef: record.workThreadRef,
          objective: contract.objective,
          deliverables: contract.deliverables,
          completionCriteria:
            record.constitution.completionEvaluator
              .requiredCriteria,
          runtimeEvidenceRefs,
          finalAssistantText:
            observation.finalAssistantText,
        });
      validatePlanExecutionClosureAssessment(closureAssessment);
      if (
        closureAssessment.projectId !== record.projectId ||
        !exactRefMatches(
          closureAssessment.implementationContractRef,
          record.implementationContractRef,
        ) ||
        !exactRefMatches(
          closureAssessment.workThreadRef,
          record.workThreadRef,
        )
      ) {
        serviceFail(
          "world_manager_plan_execution_closure_assessment_binding_invalid",
        );
      }
      const assessmentRef = exactExecutionRef({
        kind: "plan_execution_closure_assessment",
        id: closureAssessment.assessmentId,
        digest: closureAssessment.digest,
        projectId: record.projectId,
      });
      runtimeEvidenceRefs.push(assessmentRef);
      const criterionWitnesses = closureAssessment.criterionWitnesses;
      const evaluation = buildPlanExecutionClosureEvaluation({
        record,
        workerStartResultRef:
          observation.workerStartResultRef ||
          record.workerStart.resultRef,
        workerTerminalState:
          observation.workerTerminalState,
        runtimeEvidenceRefs,
        criterionWitnesses: criterionWitnesses || [],
        now: this.now,
      });
      if (evaluation.decision === "remand") {
        const remanded = revisePlanExecutionRecord(
          record,
          {
            state: "active",
            closureEvaluation: evaluation,
            closureAssessment,
          },
          { now: this.now },
        );
        const persisted = this.store
          .registerPlanExecutionRecord(remanded).record;
        const projection = this.snapshot();
        this.emit("transition", {
          reason: "plan-execution-closure-remanded",
          receipt: {
            schema: "direct_world_manager_plan_execution_receipt@1",
            state: "active",
            executionRef: planExecutionRecordRef(persisted),
            closureDecision: "remand",
            blockerCodes: evaluation.blockerCodes,
            workThreadActive: true,
            canonicalEffect: false,
            grantsAuthority: false,
          },
          projection,
        });
        return {
          record: persisted,
          closureEvaluation: evaluation,
          projection,
        };
      }
      const workThread = this.workThreadStore.readWorkThread(
        record.workThreadRef.id,
      );
      if (
        !workThread ||
        workThread.digest !== record.workThreadRef.digest
      ) {
        serviceFail(
          "world_manager_plan_execution_work_thread_stale",
          record.workThreadRef.id,
        );
      }
      const closureRef = exactExecutionRef({
        kind: "plan_execution_closure_evaluation",
        id: evaluation.closureEvaluationId,
        digest: evaluation.digest,
        projectId: record.projectId,
      });
      const completedWorkThread = this.workThreadStore.upsertWorkThread({
        ...workThread,
        lifecycleState: "completed",
        objective: {
          ...workThread.objective,
          currentObjective:
            "Implementation closure was witnessed; Project Manager memory admission is pending.",
        },
        phaseState: {
          phaseId: "wm_k6_plan_execution",
          phaseKind: "admitted_plan_implementation",
          status: "completed",
        },
        authorityBoundary: {
          allowedActions: [],
          forbiddenActions: [
            "additional_worker_effect",
            "remote_mutation",
            "worker_canonical_write",
          ],
          summary:
            "The worker lifecycle is closed. Only Project Manager admission may promote the evidence into project memory.",
        },
        evidenceRefs: [
          ...(workThread.evidenceRefs || []),
          closureRef,
          ...runtimeEvidenceRefs,
        ],
        updatedAt: new Date(this.now()).toISOString(),
      });
      const completed = revisePlanExecutionRecord(
        record,
        {
          state: "completed",
          closureEvaluation: evaluation,
          closureAssessment,
          workThreadRef: {
            kind: "work_thread",
            id: completedWorkThread.workThreadId,
            digest: completedWorkThread.digest,
            projectId: completedWorkThread.projectId,
          },
        },
        { now: this.now },
      );
      record = this.store.registerPlanExecutionRecord(completed).record;
    }
    return this.admitCompletedPlanExecution(record);
  }

  admitCompletedPlanExecution(record) {
    if (record.state !== "completed") {
      serviceFail(
        "world_manager_plan_execution_admission_requires_completed",
      );
    }
    const workThread = this.workThreadStore.readWorkThread(
      record.workThreadRef.id,
    );
    if (
      !workThread ||
      workThread.digest !== record.workThreadRef.digest ||
      workThread.lifecycleState !== "completed"
    ) {
      serviceFail(
        "world_manager_plan_execution_completed_thread_stale",
        record.workThreadRef.id,
      );
    }
    const observedAt = normalizeString(
      record.updatedAt,
      new Date(this.now()).toISOString(),
    );
    const closureRef = exactExecutionRef({
      kind: "plan_execution_closure_evaluation",
      id: record.closureEvaluation.closureEvaluationId,
      digest: record.closureEvaluation.digest,
      projectId: record.projectId,
    });
    const managerActorRef =
      this.worldmodel.projectManagerAdmissionActorRef(
        record.projectId,
      );
    const closureIdentity = {
      managerProfileId: stableId("project_manager_profile", {
        userWorldId: this.userWorldId,
        projectId: record.projectId,
      }),
      managerAgentId: managerActorRef.id,
      runId: record.executionId,
      callId: record.closureEvaluation.closureEvaluationId,
    };
    const closureResultEnvelope = buildOdeuResultEnvelope({
      resultEnvelopeId: stableId("wm_plan_execution_closure_result", {
        closureRef,
      }),
      capabilityId: "wm_k6_plan_execution_closure",
      callId: closureIdentity.callId,
      transactionId: closureIdentity.runId,
      resultKind: "agent_result",
      sourceRefs: [
        semanticExecutionSourceRef(closureRef, observedAt),
      ],
      rendererSafeSummary:
        "The implementation contract completed with evidence-bearing runtime witnesses.",
      visibility: {
        rendererVisible: "summary",
        residentVisible: "summary",
        providerVisible: "not_seen",
        transcriptVisible: "none",
      },
      payloadPolicy: {
        rawPayloadStored: false,
        rawPayloadProviderSent: false,
        rawPayloadRendererVisible: false,
        redactionState: "none_needed",
        truncationState: "none",
      },
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawProviderPayloadIncluded: false,
      confidence: "exact",
    }, { now: this.now });
    const closureWitness = buildWorkThreadClosureEvidenceWitness({
      projectId: record.projectId,
      witnessId: stableId("wm_plan_execution_closure_witness", {
        executionRef: planExecutionRecordRef(record),
      }),
      workThread,
      closureResultEnvelope,
      closureIdentity,
      sourceRefs: [
        semanticExecutionSourceRef(closureRef, observedAt),
      ],
    }, { now: this.now });
    const closureEvidenceContexts = [{
      witness: closureWitness,
      workThread,
      closureResultEnvelope,
      closureIdentity,
    }];
    const graph = this.worldmodel.graph;
    const projectRevision = graph.scopedRevisionRefs.find((entry) =>
      entry.scopeKind === "project" &&
      entry.projectId === record.projectId);
    const candidate = buildProjectMemoryCandidate({
      candidateId: stableId("wm_plan_execution_project_memory", {
        executionRef: planExecutionRecordRef(record),
      }),
      projectId: record.projectId,
      projectManagerAgentId: managerActorRef.id,
      closureEvidenceContexts,
      candidateKind: "progress",
      proposedSemanticPath: [
        "projects",
        record.projectId,
        "memory",
        "implementation_closures",
      ],
      proposedNode: {
        nodeId: stableId("wm_plan_execution_memory_node", {
          executionRef: planExecutionRecordRef(record),
        }),
        graphId: graph.graphId,
        nodeKind: "progress",
        abstractionLevel: "execution",
        semanticSummary:
          `Implementation contract ${record.implementationContractRef.id} completed with admitted closure evidence.`,
        odeuImpact: {
          O: ["implementation_contract_completed"],
          E: ["runtime_observed_closure_witnesses"],
          D: ["project_manager_admission"],
          U: ["project_progress_memory"],
        },
        epistemicStatus: "accepted",
        normativeForce: "informational",
        projectionEligibility: "eligible",
      },
      expectedProjectRevision:
        Number(projectRevision?.revision || 0),
      sourceRefs: [
        semanticExecutionSourceRef(closureRef, observedAt),
      ],
    }, { now: this.now });
    const targetAdmissionScope = {
      kind: "project",
      projectId: record.projectId,
    };
    const lifecycle = {
      lifecycleId: stableId("wm_plan_execution_memory_lifecycle", {
        candidateId: candidate.candidateId,
      }),
      state: "admission_pending",
      digest: candidate.candidateDigest,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const gateDecision = {
      gateDecisionId: stableId("wm_plan_execution_memory_gate", {
        candidateId: candidate.candidateId,
      }),
      decisionState: "gate_ready",
      digest: record.closureEvaluation.digest,
      targetAdmissionScope,
      assuranceGraphRef: closureRef,
    };
    const admission = this.worldmodel.admitArtifactRevision({
      lifecycle,
      artifactRevision: {
        artifactRevisionId: candidate.candidateId,
        artifactDigest: candidate.candidateDigest,
        artifactTypeId: "project_memory_candidate",
        revision: record.revision,
        artifactContentRef: {
          kind: "project_memory_candidate",
          id: candidate.candidateId,
          digest: candidate.candidateDigest,
          projectId: record.projectId,
        },
      },
      gateDecision,
      targetAdmissionScope,
      expectedCanonicalRevisionRefs:
        this.worldmodel.canonicalArtifactRevisionRefs(
          targetAdmissionScope,
        ),
      actorRef: managerActorRef,
      issuedAt: observedAt,
    });
    const upwardStatus = buildProjectToWorldStatusProjection({
      projectionId: stableId("wm_plan_execution_upward_status", {
        candidateId: candidate.candidateId,
        canonicalGraphRef: admission.canonicalGraphRef,
      }),
      projectId: record.projectId,
      graph: this.worldmodel.graph,
      sourceRefs: [
        semanticExecutionSourceRef({
          kind: "project_memory_candidate",
          id: candidate.candidateId,
          digest: candidate.candidateDigest,
          projectId: record.projectId,
        }, observedAt),
      ],
    }, { now: this.now });
    const admitted = revisePlanExecutionRecord(
      record,
      {
        state: "admitted",
        projectMemory: {
          candidate,
          closureWitness,
          closureResultEnvelope,
          admission,
        },
        upwardStatus,
        canonicalEffect: true,
      },
      { now: this.now },
    );
    const persisted = this.store.registerPlanExecutionRecord(admitted).record;
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "plan-execution-project-memory-admitted",
      receipt: {
        schema: "direct_world_manager_plan_execution_receipt@1",
        state: "admitted",
        executionRef: planExecutionRecordRef(persisted),
        projectMemoryCandidateRef: {
          kind: "project_memory_candidate",
          id: candidate.candidateId,
          digest: candidate.candidateDigest,
          projectId: record.projectId,
        },
        trustStoreReceiptRef: admission.trustStoreReceiptRef,
        workThreadCompleted: true,
        canonicalEffect: true,
        grantsAuthority: false,
      },
      projection,
    });
    return {
      reused: admission.reused === true,
      record: persisted,
      projectMemory: persisted.projectMemory,
      upwardStatus,
      projection,
    };
  }

  semanticPlanAdmissionDisposition(settlement) {
    const discharge =
      settlement?.semanticIngressRun?.semanticDischarge;
    const args = discharge?.arguments;
    if (
      discharge?.actionName !== ACTION_NAMES.DECISION_CONCERN ||
      args?.disposition !== "authorize_exact_target"
    ) {
      return null;
    }
    if (!this.planProposalLifecycleEnabled) {
      serviceFail(
        "world_manager_plan_semantic_admission_unavailable",
      );
    }
    const decision = this.store.semanticArtifact(
      args.decisionId,
    );
    if (
      !decision ||
      decision.decisionKind !==
        "plan_proposal_admission" ||
      decision.resolutionMode !== "authority_request" ||
      !["open", "resolved"].includes(
        decision.decisionState,
      ) ||
      (args.ambiguities || []).length > 0
    ) {
      serviceFail(
        "world_manager_plan_semantic_admission_decision_invalid",
        args.decisionId,
      );
    }
    const exactOption = (decision.options || []).find(
      (option) =>
        option.optionKey ===
          "admit_exact_plan_revision" &&
        option.availability === "available",
    );
    const target =
      exactOption?.semanticValue?.targetArtifactRef;
    if (
      !target ||
      target.kind !== "plan_proposal_revision" ||
      args.targetArtifactRef?.kind !== target.kind ||
      args.targetArtifactRef?.projectId !==
        (target.projectId ||
          decision.header.scope.projectId || "") ||
      !exactRefMatches(args.targetArtifactRef, target)
    ) {
      serviceFail(
        "world_manager_plan_semantic_admission_target_mismatch",
        args.targetArtifactRef?.id,
      );
    }
    const proposal = this.store.planProposalRevisionById(
      target.id,
    );
    if (
      !proposal ||
      proposal.digest !== target.digest ||
      proposal.projectId !==
        args.targetArtifactRef.projectId
    ) {
      serviceFail(
        "world_manager_plan_proposal_stale_or_unknown",
        target.id,
      );
    }
    return {
      decision,
      exactOption,
      proposal,
      targetArtifactRef: args.targetArtifactRef,
      semanticDischargeRef: {
        kind: "world_manager_semantic_discharge",
        id: discharge.semanticDischargeId,
        digest: discharge.digest,
      },
    };
  }

  executeSemanticPlanAdmission(input = {}) {
    const disposition =
      this.semanticPlanAdmissionDisposition(
        input.settlement,
      );
    if (!disposition) return null;
    const admitted = this.admitPlanProposal({
      proposalRevisionId:
        disposition.proposal.proposalRevisionId,
      proposalDigest:
        disposition.proposal.digest,
      actorId: "operator",
    });
    const planAdmissionDecisionRef =
      admitted.decision
        ? {
            kind: "plan_admission_decision",
            id:
              admitted.decision
                .admissionDecisionId,
            digest: admitted.decision.digest,
            projectId:
              disposition.proposal.projectId,
          }
        : null;
    const implementationContractRef =
      admitted.contract
        ? {
            kind: "implementation_contract",
            id:
              admitted.contract
                .implementationContractId,
            digest: admitted.contract.digest,
            projectId:
              disposition.proposal.projectId,
          }
        : null;
    return {
      ...admitted,
      disposition,
      planAdmissionDecisionRef,
      implementationContractRef,
    };
  }

  snapshot() {
    if (!this.started) {
      return this.bootstrap().projection;
    }
    const data = this.store.snapshotData();
    const latestContract = data.implementationContracts?.at(-1) || null;
    const latestContractExecution = latestContract
      ? [...(data.planExecutions || [])].reverse().find((record) =>
          record.implementationContractRef?.id ===
            latestContract.implementationContractId)
      : null;
    const projection = buildWorldManagerWorkbenchProjection({
      ...data,
      pipelineStage:
        this.roleRuntime && latestContractExecution
          ? "wm_k6_execution"
        : this.roleRuntime && data.planProposalRevisions?.length
          ? "wm_k5_planning"
        : this.roleRuntime && this.realizationSnapshotProvider
          ? "wm_k6_genesis"
          : this.roleRuntime
            ? "wm_k4"
            : "wm_k3",
      semanticIngressAvailable:
        this.semanticIngress.available(),
      constitutionalMetaRoles:
        this.semanticIngress.metaRoleProjection?.() || null,
      aroReconstructionAutomaticSchedulingAvailable:
        this.aroReconstructionAvailable(),
      aroTargetDefinitionAvailable:
        this.aroTargetDefinitionAvailable(),
      aroMutationCompilationAvailable:
        this.aroMutationCompilationAvailable(),
      aroRealizationMappingAvailable:
        this.aroRealizationMappingAvailable(),
      aroWorkerHandoffAvailable:
        this.aroWorkerHandoffAvailable(),
      aroExecutionEvidenceAvailable:
        this.aroExecutionEvidenceAvailable(),
      aroSemanticVerificationAvailable:
        this.aroSemanticVerificationAvailable(),
      thoughtBrushAvailable:
        this.thoughtBrushAvailable(),
      projectSubstrateProvisioningAvailable:
        this.projectSubstrateProvisioningAvailable(),
      workThreads: this.workThreads(),
      generatedAt: new Date(this.now()).toISOString(),
    });
    if (this.epistemicFabric?.projection) {
      projection.epistemicFabric =
        this.epistemicFabric.projection();
      projection.projectionDigest = digestFor(
        "direct_world_manager_workbench_projection@1",
        projection,
        ["projectionDigest"],
      );
    }
    assertWorldManagerWorkbenchProjectionSafe(projection);
    return projection;
  }

  submit(input = {}) {
    this.ensureStarted();
    const request = normalizeWorldManagerSubmitRequest({
      ...input,
      schema: input?.schema || WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
    });
    try {
      const result = this.store.appendUserIngress(request);
      if (!result.reused && this.epistemicFabric?.recordWorldManagerEvent) {
        this.epistemicFabric.recordWorldManagerEvent(result.event);
      }
      if (!result.reused) {
        this.emit("transition", {
          reason: "ingress-recorded",
          receipt: {
            schema: "direct_world_manager_ingress_receipt@1",
            state: "accepted",
            accepted: true,
            reused: false,
            remanded: false,
            presentationState: "received",
            settlementState: "settling",
            grantsAuthority: false,
          },
          projection: this.snapshot(),
        });
      }
      const settlementResult = this.settleIngress({
        event: result.event,
        message: result.message,
        request,
      });
      const completeSubmission = (settlement) => {
        const projection = this.snapshot();
        const settlementState =
          settlement.taskSettlement.state === "settled"
            ? settlement.agentWorld
              ? "agent_world_ready"
              : "context_ready"
            : settlement.taskSettlement.state;
        const receipt = {
          schema: "direct_world_manager_ingress_receipt@1",
          state: result.reused ? "reused" : "accepted",
          accepted: true,
          reused: result.reused,
          remanded: settlementState === "remanded",
          semanticEventRef: {
            kind: "world_manager_semantic_event",
            id: result.event.semanticEventId,
            digest: result.event.eventDigest,
            label: "Durable user ingress",
          },
          messageRef: {
            kind: "world_manager_message",
            id: result.message.messageId,
            digest: result.message.messageDigest,
            label: "User-authored message",
          },
          semanticSettlementRef:
            settlement.semanticIngressRun
              ? {
                  kind:
                    "world_manager_semantic_settlement",
                  id:
                    settlement.semanticIngressRun
                      .semanticSettlement
                      .semanticSettlementId,
                  digest:
                    settlement.semanticIngressRun
                      .semanticSettlement.digest,
                  label:
                    "WorldManager semantic ingress",
                }
              : null,
          presentationState: settlementState,
          settlementState,
          taskSettlementRef: {
            kind: "world_manager_task_settlement",
            id:
              settlement.taskSettlement.taskSettlementId,
            digest: settlement.taskSettlement.digest,
            label: "K2 task settlement",
          },
          routingDecisionRef: {
            kind: "world_manager_routing_decision",
            id:
              settlement.routingDecision.routingDecisionId,
            digest: settlement.routingDecision.digest,
            label: "K2 routing decision",
          },
          agentWorldCompilationRef: settlement.agentWorld
            ? {
                kind:
                  "world_manager_agent_world_compilation",
                id:
                  settlement.agentWorld
                    .agentWorldCompilationId,
                digest:
                  settlement.agentWorld
                    .agentWorldCompilationDigest,
                label: "K3 validated agent world",
              }
            : null,
          currentProjectionRevision:
            projection.projectionRevision,
          grantsAuthority: false,
        };
        const semanticAdmission =
          this.executeSemanticPlanAdmission({
            settlement,
            request,
            userEvent: result.event,
          });
        if (semanticAdmission) {
          const admittedProjection =
            semanticAdmission.projection;
          const dispositionReceipt = {
            ...receipt,
            presentationState: "completed",
            settlementState: "contract_received",
            semanticDisposition:
              "authorize_exact_target",
            semanticDispositionRef:
              semanticAdmission.disposition
                .semanticDischargeRef,
            targetArtifactRef:
              semanticAdmission.disposition
                .targetArtifactRef,
            planAdmissionDecisionRef:
              semanticAdmission
                .planAdmissionDecisionRef,
            implementationContractRef:
              semanticAdmission
                .implementationContractRef,
            workThreadRef:
              semanticAdmission.workThread
                ? {
                    kind: "work_thread",
                    id:
                      semanticAdmission.workThread
                        .workThreadId,
                    digest:
                      semanticAdmission.workThread
                        .digest,
                    projectId:
                      semanticAdmission.workThread
                        .projectId,
                  }
                : null,
            implementationStarted: false,
            grantsWorkerStartAuthority: false,
            currentProjectionRevision:
              admittedProjection
                .projectionRevision,
            grantsAuthority: false,
          };
          this.emit("transition", {
            reason:
              "semantic-plan-admission-contract-received",
            receipt: dispositionReceipt,
            projection: admittedProjection,
          });
          return {
            receipt: dispositionReceipt,
            projection: admittedProjection,
          };
        }
        const response = { receipt, projection };
        this.emit("transition", {
          reason: result.reused
            ? "settlement-reused"
            : settlementState === "agent_world_ready"
              ? "agent-world-compiled"
              : settlementState === "context_ready"
                ? "manager-context-prepared"
                : "clarification-required",
          receipt,
          projection,
        });
        if (
          settlement.semanticIngressRun?.semanticSettlement
            ?.formulationDisposition === "split"
        ) {
          const materialized =
            this.store.materializeSemanticSplit({
              parentEvent: result.event,
              semanticIngressRun:
                settlement.semanticIngressRun,
            });
          const splitProjection = this.snapshot();
          const splitResponse = {
            receipt: {
              ...receipt,
              settlementState:
                this.roleRuntime
                  ? "split_executing"
                  : "split_materialized",
              semanticSplitCoordinationRef: {
                kind:
                  "semantic_split_coordination",
                id:
                  materialized.coordination
                    .coordinationId,
                digest:
                  materialized.coordination.digest,
              },
              splitChildEventRefs:
                materialized.coordination
                  .childEventRefs,
              currentProjectionRevision:
                splitProjection.projectionRevision,
            },
            projection: splitProjection,
          };
          this.emit("transition", {
            reason: "semantic-split-materialized",
            receipt: splitResponse.receipt,
            projection: splitProjection,
          });
          if (this.roleRuntime) {
            return this.runSplitRolePipeline({
              request,
              parentEvent: result.event,
              parentMessage: result.message,
              parentSettlement: settlement,
              materialized,
              initialResponse: splitResponse,
            });
          }
          return splitResponse;
        }
        if (
          this.roleRuntime &&
          settlement.taskSettlement.state === "settled" &&
          settlement.agentWorld
        ) {
          return this.runK4RolePipeline({
            request,
            userEvent: result.event,
            message: result.message,
            settlement,
            initialResponse: response,
          });
        }
        return response;
      };
      if (
        settlementResult &&
        typeof settlementResult.then === "function"
      ) {
        return settlementResult
          .then(completeSubmission)
          .catch((error) => {
            error.worldManager = rendererSafeError(error);
            throw error;
          });
      }
      return completeSubmission(settlementResult);
    } catch (error) {
      error.worldManager = rendererSafeError(error);
      throw error;
    }
  }

  managerResultForSemanticEvent(semanticEventId) {
    const reconciliationResultIds = new Set(
      this.store.listReconciliations({ limit: 1000 })
        .map((record) =>
          record.reconciliationAgentResultRef?.id)
        .filter(Boolean),
    );
    return this.store.listAgentResults({
      limit: 1000,
    }).find((record) =>
      record.agentResult?.sourceSemanticEventId ===
        semanticEventId &&
      !reconciliationResultIds.has(
        record.agentResult?.agentResultId,
      )) || null;
  }

  candidateRefsForSemanticEvent(semanticEventId) {
    return this.store.listCandidateArtifacts()
      .filter((candidate) =>
        candidate.sourceSemanticEventRef?.id ===
          semanticEventId)
      .map((candidate) => ({
        kind: candidate.artifactKind ===
          "project_constitution"
          ? "project_constitution_candidate"
          : "candidate_artifact",
        id:
          candidate.candidateId ||
          candidate.artifactId,
        digest: candidate.digest,
        label:
          candidate.identity ||
          candidate.artifactKind ||
          "Candidate artifact",
      }));
  }

  async runSplitRolePipeline(input = {}) {
    const parentEvent = input.parentEvent;
    const parentSettlement =
      input.parentSettlement;
    const materialized = input.materialized;
    const currentCoordination =
      this.store.semanticSplitCoordinationForParent(
        parentEvent.semanticEventId,
      );
    const existingParentResult =
      this.managerResultForSemanticEvent(
        parentEvent.semanticEventId,
      );
    if (
      currentCoordination &&
      existingParentResult &&
      [
        "completed",
        "partially_remanded",
        "remanded",
        "failed",
      ].includes(currentCoordination.state)
    ) {
      let reusableCoordination =
        currentCoordination;
      if (
        ["interrupted", "failed"].includes(
          currentCoordination.state,
        ) &&
        existingParentResult.agentResult
          .resultState === "completed"
      ) {
        const completedChildCount =
          currentCoordination.childOutcomes.filter(
            (outcome) =>
              outcome.state === "completed",
          ).length;
        const desiredState =
          completedChildCount ===
            currentCoordination.childEventRefs.length
            ? "completed"
            : completedChildCount > 0
              ? "partially_remanded"
              : "remanded";
        reusableCoordination =
          this.store.updateSemanticSplitCoordination({
            parentEvent,
            state: desiredState,
            childOutcomes:
              currentCoordination.childOutcomes,
            parentAgentResultRef: {
              kind: "agent_result",
              id:
                existingParentResult.agentResult
                  .agentResultId,
              digest:
                existingParentResult.agentResult
                  .digest,
              label:
                "Unified parent WorldManager result",
            },
            summary:
              "Persisted child outcomes and the unified parent result were recovered after runtime restart.",
          }).coordination;
      }
      const projection = this.snapshot();
      return {
        receipt: {
          ...input.initialResponse.receipt,
          state: "reused",
          reused: true,
          settlementState:
            existingParentResult.agentResult
              .resultState,
          agentResultRef: {
            kind: "agent_result",
            id:
              existingParentResult.agentResult
                .agentResultId,
            digest:
              existingParentResult.agentResult.digest,
          },
          semanticSplitCoordinationRef: {
            kind: "semantic_split_coordination",
            id: reusableCoordination.coordinationId,
            digest: reusableCoordination.digest,
          },
          splitChildEventRefs:
            reusableCoordination.childEventRefs,
          splitChildOutcomes:
            reusableCoordination.childOutcomes,
          currentProjectionRevision:
            projection.projectionRevision,
          grantsAuthority: false,
        },
        projection,
      };
    }
    let childOutcomes = [];
    try {
      this.store.updateSemanticSplitCoordination({
        parentEvent,
        state: "executing",
        childOutcomes,
        summary:
          `Executing ${materialized.children.length} independently settled semantic children.`,
      });
      this.emit("transition", {
        reason: "semantic-split-execution-started",
        receipt: {
          schema:
            "direct_semantic_split_runtime_receipt@1",
          state: "executing",
          coordinationRef: {
            kind: "semantic_split_coordination",
            id:
              materialized.coordination
                .coordinationId,
            digest:
              this.store
                .semanticSplitCoordinationForParent(
                  parentEvent.semanticEventId,
                ).digest,
          },
          grantsAuthority: false,
        },
        projection: this.snapshot(),
      });
      const childRecords = [];
      for (const child of materialized.children) {
        const childRequest = {
          schema: WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
          clientRequestId:
            child.event.clientRequestId,
          text: child.message.text,
          scopeHint: {
            projectId:
              child.event.projectId ||
              this.activeProjectId,
            proposalId: "",
            workThreadId: "",
            bindingPosture: "ambient_focus",
          },
          expectedProjectionRevision: null,
          attachmentDraftRefs: [],
        };
        const persistedChildSettlement =
          this.store.settlementForSemanticEvent(
            child.event.semanticEventId,
          );
        const settled = persistedChildSettlement
          ? {
              ...persistedChildSettlement,
              agentWorld:
                this.store.agentWorldForSemanticEvent(
                  child.event.semanticEventId,
                ),
            }
          : await this.settleIngress({
              event: child.event,
              message: child.message,
              request: childRequest,
            });
        if (
          settled.taskSettlement.state === "settled" &&
          settled.agentWorld
        ) {
          await this.runK4RolePipeline({
            request: childRequest,
            userEvent: child.event,
            message: child.message,
            settlement: settled,
            initialResponse: {
              receipt: {
                schema:
                  "direct_world_manager_child_ingress_receipt@1",
                state: "accepted",
                accepted: true,
                reused: false,
                remanded: false,
                semanticEventRef: {
                  kind:
                    "world_manager_semantic_event",
                  id: child.event.semanticEventId,
                  digest: child.event.eventDigest,
                },
                taskSettlementRef: {
                  kind:
                    "world_manager_task_settlement",
                  id:
                    settled.taskSettlement
                      .taskSettlementId,
                  digest:
                    settled.taskSettlement.digest,
                },
                settlementState:
                  "agent_world_ready",
                grantsAuthority: false,
              },
              projection: this.snapshot(),
            },
          });
        }
        const resultRecord =
          this.managerResultForSemanticEvent(
            child.event.semanticEventId,
          );
        const candidateArtifactRefs =
          this.candidateRefsForSemanticEvent(
            child.event.semanticEventId,
          );
        const childState = resultRecord
          ? resultRecord.agentResult.resultState
          : settled.taskSettlement.state;
        const outcome = {
          childContractRef: {
            kind: "semantic_child_contract",
            id: child.contract.childContractId,
            digest: child.contract.digest,
            label:
              `Semantic child ${
                child.contract.childIndex + 1
              }`,
          },
          childEventRef: {
            kind: "world_manager_semantic_event",
            id: child.event.semanticEventId,
            digest: child.event.eventDigest,
            label:
              `Semantic child ${
                child.contract.childIndex + 1
              } event`,
          },
          childIndex: child.contract.childIndex,
          state: childState,
          taskSettlementRef: {
            kind: "world_manager_task_settlement",
            id:
              settled.taskSettlement
                .taskSettlementId,
            digest: settled.taskSettlement.digest,
            label: "Child task settlement",
          },
          agentResultRef: resultRecord
            ? {
                kind: "agent_result",
                id:
                  resultRecord.agentResult
                    .agentResultId,
                digest:
                  resultRecord.agentResult.digest,
                label: "Child manager result",
              }
            : null,
          candidateArtifactRefs,
          summary: resultRecord
            ? resultRecord.userFacingResponse.text
            : settled.taskSettlement
                .clarificationPrompt ||
              settled.taskSettlement.rationale,
        };
        childOutcomes = [
          ...childOutcomes,
          outcome,
        ];
        this.store.updateSemanticSplitCoordination({
          parentEvent,
          state: "executing",
          childOutcomes,
          summary:
            `${childOutcomes.length} of ${materialized.children.length} semantic children reached a terminal child boundary.`,
        });
        childRecords.push({
          childIndex: child.contract.childIndex,
          contract: child.contract,
          event: child.event,
          settlement: settled.taskSettlement,
          resultRecord,
          candidateArtifactRefs,
        });
      }
      const joining =
        this.store.updateSemanticSplitCoordination({
          parentEvent,
          state: "joining",
          childOutcomes,
          summary:
            "Child results are complete enough for one parent WorldManager closure turn.",
        });
      const parentResponse =
        await this.runK4RolePipeline({
          request: input.request,
          userEvent: parentEvent,
          message: {
            ...input.parentMessage,
            text: semanticSplitJoinPrompt({
              parentMessage: input.parentMessage,
              coordination:
                joining.coordination,
              children: childRecords,
            }),
          },
          settlement: parentSettlement,
          initialResponse:
            input.initialResponse,
        });
      const parentResult =
        this.managerResultForSemanticEvent(
          parentEvent.semanticEventId,
        );
      const incompleteChildCount =
        childOutcomes.filter((outcome) =>
          outcome.state !== "completed").length;
      const completedChildCount =
        childOutcomes.filter((outcome) =>
          outcome.state === "completed").length;
      const parentResultState =
        parentResult?.agentResult?.resultState || "";
      const coordinationState =
        ["failed", "interrupted"].includes(
          parentResultState,
        )
          ? "failed"
          : parentResultState !== "completed"
            ? "remanded"
          : incompleteChildCount === 0
            ? "completed"
            : completedChildCount > 0
              ? "partially_remanded"
              : "remanded";
      const completed =
        this.store.updateSemanticSplitCoordination({
          parentEvent,
          state: coordinationState,
          childOutcomes,
          parentAgentResultRef: parentResult
            ? {
                kind: "agent_result",
                id:
                  parentResult.agentResult
                    .agentResultId,
                digest:
                  parentResult.agentResult.digest,
                label:
                  "Unified parent WorldManager result",
              }
            : null,
          summary:
            coordinationState === "completed"
              ? "All semantic children completed and one unified parent response was rendered."
              : coordinationState ===
                  "partially_remanded"
                ? "A unified parent response was rendered with one or more child limitations preserved."
                : "The split reached a terminal boundary without claiming that all child work completed.",
        });
      const projection = this.snapshot();
      const receipt = {
        ...parentResponse.receipt,
        settlementState:
          parentResult?.agentResult?.resultState ||
          coordinationState,
        semanticSplitCoordinationRef: {
          kind: "semantic_split_coordination",
          id:
            completed.coordination.coordinationId,
          digest: completed.coordination.digest,
        },
        splitChildEventRefs:
          completed.coordination.childEventRefs,
        splitChildOutcomes:
          completed.coordination.childOutcomes,
        currentProjectionRevision:
          projection.projectionRevision,
        grantsAuthority: false,
      };
      this.emit("transition", {
        reason: "semantic-split-joined",
        receipt,
        projection,
      });
      return { receipt, projection };
    } catch (error) {
      const safe = rendererSafeError(error);
      const failed =
        this.store.updateSemanticSplitCoordination({
          parentEvent,
          state: "failed",
          childOutcomes,
          summary:
            `Semantic split coordination failed visibly: ${safe.message}`,
        });
      const projection = this.snapshot();
      const receipt = {
        ...input.initialResponse.receipt,
        state: "failed",
        settlementState: "failed",
        semanticSplitCoordinationRef: {
          kind: "semantic_split_coordination",
          id: failed.coordination.coordinationId,
          digest: failed.coordination.digest,
        },
        splitChildEventRefs:
          failed.coordination.childEventRefs,
        splitChildOutcomes:
          failed.coordination.childOutcomes,
        currentProjectionRevision:
          projection.projectionRevision,
        grantsAuthority: false,
      };
      this.emit("transition", {
        reason: "semantic-split-failed",
        receipt,
        projection,
      });
      return { receipt, projection };
    }
  }

  async runK4RolePipeline(input = {}) {
    const userEvent = input.userEvent;
    const taskSettlement = input.settlement.taskSettlement;
    const reconciliationResultIds = new Set(
      this.store.listReconciliations({ limit: 1000 })
        .map((record) =>
          record.reconciliationAgentResultRef?.id)
        .filter(Boolean),
    );
    const existingResult = this.store.listAgentResults({
      limit: 1000,
    }).find((record) =>
      record.agentResult?.sourceSemanticEventId ===
        userEvent.semanticEventId &&
      !reconciliationResultIds.has(
        record.agentResult?.agentResultId,
      ));
    if (existingResult) {
      const projection = this.snapshot();
      return {
        receipt: {
          ...input.initialResponse.receipt,
          state: "reused",
          reused: true,
          settlementState:
            this.store.listReconciliations({ limit: 1000 })
              .find((entry) =>
                entry.sourceSemanticEventId ===
                  userEvent.semanticEventId)?.state ||
            existingResult.agentResult.resultState,
          agentResultRef: {
            kind: "agent_result",
            id: existingResult.agentResult.agentResultId,
            digest: existingResult.agentResult.digest,
          },
          currentProjectionRevision: projection.projectionRevision,
        },
        projection,
      };
    }
    const stored = this.store.agentWorldForSemanticEvent(
      userEvent.semanticEventId,
      { full: true },
    );
    if (!stored?.compilation) {
      const error = new Error("world_manager_k4_agent_world_missing");
      error.code = "world_manager_k4_agent_world_missing";
      throw error;
    }
    const sourceCompilation = stored.compilation;
    const operationalMetaContext =
      this.prepareOperationalMetaContext(
        taskSettlement,
        sourceCompilation,
      );
    const parentAgentWorldEventId = stableId("wm_event", {
      semanticEventId: userEvent.semanticEventId,
      transition: "agent_world_compiled",
    });
    const managerRun = await this.roleRuntime.run({
      compilation: sourceCompilation,
      projectId: taskSettlement.projectId,
      runtimeProjectId:
        taskSettlement.projectId || this.activeProjectId,
      sourceSemanticEventId: userEvent.semanticEventId,
      lineageRootId: userEvent.lineageRootId,
      prompt: input.message.text,
      operationalMetaContextBinding:
        operationalMetaContext.binding,
      reasoningEffort:
        sourceCompilation.runtimeProfile?.reasoningEffort || "medium",
      onStarted: async (run) => {
        const started = this.store.recordRoleRunStarted({
          userEvent,
          run,
          taskType: taskSettlement.taskType,
          parentSemanticEventId: parentAgentWorldEventId,
          sourceScopeRevisions:
            sourceCompilation.manifest.worldstateRevisionRefs,
        });
        this.emit("transition", {
          reason: "role-turn-started",
          receipt: {
            schema: "direct_world_manager_role_runtime_receipt@1",
            state: "running",
            runRef: {
              kind: "direct_role_run",
              id: run.runId,
              digest: run.digest,
            },
            grantsAuthority: false,
          },
          projection: this.snapshot(),
        });
        return started;
      },
    });
    if (managerRun.run.requestManifestId) {
      this.store
        .linkOperationalMetaContextToRequestManifest({
          operationalContext:
            operationalMetaContext,
          directSessionId:
            managerRun.run.directSessionId,
          directTurnId:
            managerRun.run.directTurnId,
          requestManifestId:
            managerRun.run.requestManifestId,
        });
    }
    const requiresWorldManagerReconciliation =
      managerRun.agentResult.roleKind !== "world_manager" ||
      taskSettlement.taskType === "project_initialization";
    const managerCommit = this.store.commitAgentResult({
      userEvent,
      taskType: taskSettlement.taskType,
      enqueue: requiresWorldManagerReconciliation,
      ...managerRun,
    });
    this.epistemicFabric?.recordAgentResult?.({
      agentResult: managerRun.agentResult,
      finalAssistantMessage: managerRun.finalAssistantMessage,
      projectId: taskSettlement.projectId,
      taskType: taskSettlement.taskType,
    });
    this.emit("transition", {
      reason:
        managerRun.agentResult.resultState === "completed"
          ? "agent-result-relayed"
          : "agent-result-remanded",
      receipt: {
        schema: "direct_world_manager_agent_result_receipt@1",
        state: managerRun.agentResult.resultState,
        agentResultRef: {
          kind: "agent_result",
          id: managerRun.agentResult.agentResultId,
          digest: managerRun.agentResult.digest,
        },
        inboxEntryId: managerCommit.inboxEntry?.inboxEntryId || "",
        renderedFromSameAgentResult: true,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    if (managerRun.agentResult.resultState !== "completed") {
      const projection = this.snapshot();
      return {
        receipt: {
          ...input.initialResponse.receipt,
          settlementState: managerRun.agentResult.resultState,
          agentResultRef: {
            kind: "agent_result",
            id: managerRun.agentResult.agentResultId,
            digest: managerRun.agentResult.digest,
          },
          currentProjectionRevision: projection.projectionRevision,
        },
        projection,
      };
    }
    if (!requiresWorldManagerReconciliation) {
      const projection = this.snapshot();
      const receipt = {
        ...input.initialResponse.receipt,
        settlementState: "completed",
        agentResultRef: {
          kind: "agent_result",
          id: managerRun.agentResult.agentResultId,
          digest: managerRun.agentResult.digest,
        },
        reconciliationRef: null,
        currentProjectionRevision: projection.projectionRevision,
        grantsAuthority: false,
      };
      this.emit("transition", {
        reason: "worldmanager-natural-response-completed",
        receipt,
        projection,
      });
      return { receipt, projection };
    }

    const reconciliationStart = this.store.startReconciliation({
      userEvent,
      sourceAgentResult: managerRun.agentResult,
      taskType: taskSettlement.taskType,
    });
    this.emit("transition", {
      reason: "worldmanager-reconciliation-started",
      receipt: {
        schema: "direct_world_manager_reconciliation_receipt@1",
        state: "processing",
        sourceAgentResultRef:
          reconciliationStart.reconciliation.sourceAgentResultRef,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const reconciliationCompilation = buildReconciliationCompilation({
      sourceCompilation,
      agentResult: managerRun.agentResult,
    });
    const reconciliationOperationalMetaContext =
      this.prepareOperationalMetaContext(
        taskSettlement,
        reconciliationCompilation,
        { purpose: "review" },
      );
    const reconciliationRun = await this.roleRuntime.run({
      compilation: reconciliationCompilation,
      projectId: taskSettlement.projectId,
      runtimeProjectId:
        taskSettlement.projectId || this.activeProjectId,
      sourceSemanticEventId: userEvent.semanticEventId,
      lineageRootId: userEvent.lineageRootId,
      prompt: reconciliationPrompt({
        agentResult: managerRun.agentResult,
        typedPayload: managerRun.typedPayload,
        userFacingResponse: managerRun.userFacingResponse,
        telemetry: managerRun.telemetry,
      }),
      operationalMetaContextBinding:
        reconciliationOperationalMetaContext.binding,
      reasoningEffort: "medium",
      onStarted: async (run) => {
        this.store.recordRoleRunStarted({
          userEvent,
          run,
          taskType: taskSettlement.taskType,
          parentSemanticEventId:
            reconciliationStart.transitionEvent.semanticEventId,
          sourceScopeRevisions:
            sourceCompilation.manifest.worldstateRevisionRefs,
        });
        this.emit("transition", {
          reason: "worldmanager-role-turn-started",
          receipt: {
            schema: "direct_world_manager_role_runtime_receipt@1",
            state: "reconciling",
            runRef: {
              kind: "direct_role_run",
              id: run.runId,
              digest: run.digest,
            },
            grantsAuthority: false,
          },
          projection: this.snapshot(),
        });
      },
    });
    if (reconciliationRun.run.requestManifestId) {
      this.store
        .linkOperationalMetaContextToRequestManifest({
          operationalContext:
            reconciliationOperationalMetaContext,
          directSessionId:
            reconciliationRun.run.directSessionId,
          directTurnId:
            reconciliationRun.run.directTurnId,
          requestManifestId:
            reconciliationRun.run.requestManifestId,
        });
    }
    this.store.commitAgentResult({
      userEvent,
      taskType: taskSettlement.taskType,
      enqueue: false,
      ...reconciliationRun,
    });
    this.epistemicFabric?.recordAgentResult?.({
      agentResult: reconciliationRun.agentResult,
      finalAssistantMessage:
        reconciliationRun.finalAssistantMessage,
      projectId: taskSettlement.projectId,
      taskType: `${taskSettlement.taskType}:reconciliation`,
    });
    const completed = this.store.completeReconciliation({
      userEvent,
      taskType: taskSettlement.taskType,
      sourceAgentResult: managerRun.agentResult,
      reconciliationAgentResult: reconciliationRun.agentResult,
      typedPayload: reconciliationRun.typedPayload,
      error: reconciliationRun.error,
    });
    let projectGenesis = null;
    let planProposal = null;
    if (
      taskSettlement.taskType === "project_initialization" &&
      managerRun.agentResult.resultState === "completed" &&
      completed.reconciliation.state === "reconciled"
    ) {
      const realizationSnapshot = this.realizationSnapshot();
      const candidate = buildProjectConstitutionCandidate({
        typedPayload: managerRun.typedPayload,
        realizationSnapshot,
        sourceAgentResultRef: {
          kind: "agent_result",
          id: managerRun.agentResult.agentResultId,
          digest: managerRun.agentResult.digest,
        },
        sourceSemanticEventRef: {
          kind: "world_manager_semantic_event",
          id: userEvent.semanticEventId,
          digest: userEvent.eventDigest,
        },
        lineageRootId: userEvent.lineageRootId,
        reconciliationState: completed.reconciliation.state,
        createdAt: new Date(this.now()).toISOString(),
      });
      projectGenesis = this.store.registerProjectGenesisCandidate({
        userEvent,
        candidate,
        realizationSnapshot,
      });
    }
    if (
      taskSettlement.taskType === "project_planning" &&
      this.planProposalLifecycleEnabled &&
      managerRun.agentResult.resultState === "completed" &&
      completed.reconciliation.state === "reconciled"
    ) {
      const registrationAction =
        completed.reconciliation.semanticActions?.find((action) =>
          action.actionType === "register_plan_proposal");
      if (registrationAction) {
        planProposal = this.registerReconciledPlanProposal({
          projectId: taskSettlement.projectId,
          userEvent,
          managerAgentResult: managerRun.agentResult,
          finalAssistantMessage: managerRun.finalAssistantMessage,
          reconciliation: completed.reconciliation,
          semanticPayload: registrationAction.semanticPayload,
        });
      }
    }
    const projection = this.snapshot();
    const receipt = {
      ...input.initialResponse.receipt,
      settlementState: completed.reconciliation.state,
      agentResultRef: {
        kind: "agent_result",
        id: managerRun.agentResult.agentResultId,
        digest: managerRun.agentResult.digest,
      },
      reconciliationRef: {
        kind: "world_manager_reconciliation",
        id: completed.reconciliation.reconciliationId,
        digest: completed.reconciliation.digest,
      },
      currentProjectionRevision: projection.projectionRevision,
      projectConstitutionCandidateRef: projectGenesis
        ? {
            kind: "project_constitution_candidate",
            id: projectGenesis.candidate.candidateId,
            digest: projectGenesis.candidate.digest,
          }
        : null,
      planProposalRevisionRef: planProposal
        ? planProposalRef(planProposal.proposal)
        : null,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason: "worldmanager-reconciliation-completed",
      receipt,
      projection,
    });
    return { receipt, projection };
  }

  async transitionDecision(input = {}) {
    this.ensureStarted();
    if (input.semanticRegionBindingRef) {
      verifySemanticRegionBinding(
        this.snapshot(),
        input.semanticRegionBindingRef,
        {
          kind: "open_decision",
          id: input.decisionId,
          digest: input.decisionDigest,
        },
      );
    }
    const transition =
      this.store.transitionSemanticDecision(input);
    const baseProjection = this.snapshot();
    this.emit("transition", {
      reason:
        transition.receipt.state === "resolved"
          ? "semantic-decision-resolved"
          : transition.receipt.state === "blocked"
            ? "semantic-decision-transition-blocked"
            : "semantic-decision-relay-registered",
      receipt: {
        ...transition.receipt,
        reused: transition.reused,
        currentProjectionRevision:
          baseProjection.projectionRevision,
      },
      projection: baseProjection,
    });
    if (
      transition.request.transitionKind ===
        "resolve_option" ||
      ["blocked", "resolved", "relayed", "failed"]
        .includes(transition.receipt.state)
    ) {
      return {
        receipt: {
          ...transition.receipt,
          reused: transition.reused,
          currentProjectionRevision:
            baseProjection.projectionRevision,
        },
        projection: baseProjection,
      };
    }

    const relayEnvelope =
      transition.transitionArtifact;
    const targetProjectId =
      relayEnvelope.scope.projectId || "";
    const roleRuntimeAddressable =
      this.store.currentBootstrap()
        ?.projects?.some((project) =>
          project.projectId ===
            targetProjectId) === true;
    try {
      const relayResult = await this.submit({
        schema:
          WORLD_MANAGER_SUBMIT_REQUEST_SCHEMA,
        clientRequestId:
          relayEnvelope.ingressClientRequestId,
        text: relayEnvelope.semanticInput,
        scopeHint: {
          projectId: roleRuntimeAddressable
            ? targetProjectId
            : "",
          proposalId:
            transition.request.decisionRef.id,
          workThreadId:
            relayEnvelope.scope.workThreadId || "",
          bindingPosture:
            "explicit_constraint",
        },
        expectedProjectionRevision:
          this.store.revision(),
        attachmentDraftRefs: [
          transition.request.decisionRef,
        ],
      });
      const completed =
        this.store.completeDecisionTransitionRelay({
          decisionTransitionRequestId:
            transition.request
              .decisionTransitionRequestId,
          relayEventRef:
            relayResult.receipt.semanticEventRef,
          relayState:
            relayResult.receipt.settlementState ||
            relayResult.receipt.state,
        });
      const projection = this.snapshot();
      const receipt = {
        ...completed.receipt,
        reused: transition.reused,
        relayIngressReceipt: {
          semanticEventRef:
            relayResult.receipt.semanticEventRef,
          settlementState:
            relayResult.receipt.settlementState,
          grantsAuthority: false,
        },
        currentProjectionRevision:
          projection.projectionRevision,
      };
      this.emit("transition", {
        reason:
          "semantic-decision-relay-completed",
        receipt,
        projection,
      });
      return { receipt, projection };
    } catch (error) {
      const completed =
        this.store.completeDecisionTransitionRelay({
          decisionTransitionRequestId:
            transition.request
              .decisionTransitionRequestId,
          error: rendererSafeError(error),
        });
      const projection = this.snapshot();
      const receipt = {
        ...completed.receipt,
        reused: transition.reused,
        currentProjectionRevision:
          projection.projectionRevision,
      };
      this.emit("transition", {
        reason: "semantic-decision-relay-failed",
        receipt,
        projection,
      });
      return { receipt, projection };
    }
  }

  focusProject(input = {}) {
    this.ensureStarted();
    const projectId = normalizeString(input.projectId, "");
    const result = this.store.setFocusedProject(
      projectId,
      input.expectedProjectionRevision,
    );
    const projection = this.snapshot();
    const response = {
      receipt: {
        schema: "direct_world_manager_focus_receipt@1",
        state: result.changed ? "accepted" : "reused",
        projectId,
        currentProjectionRevision: projection.projectionRevision,
        grantsAuthority: false,
      },
      projection,
    };
    this.emit("transition", {
      reason: result.changed ? "project-focus-changed" : "project-focus-reused",
      receipt: response.receipt,
      projection,
    });
    return response;
  }

  inspectProjectGenesisCandidate(input = {}) {
    this.ensureStarted();
    if (input.semanticRegionBindingRef) {
      const candidate =
        this.store.projectGenesisCandidateById(
          input.candidateId,
        );
      verifySemanticRegionBinding(
        this.snapshot(),
        input.semanticRegionBindingRef,
        {
          kind:
            "project_constitution_candidate",
          id: candidate?.candidateId,
          digest: candidate?.digest,
        },
      );
    }
    const result = this.store.reviewProjectGenesisCandidate({
      candidateId: input.candidateId,
      reviewedAt: new Date(this.now()).toISOString(),
    });
    const projection = this.snapshot();
    const response = {
      receipt: {
        schema: "direct_project_constitution_evidence_review_receipt@1",
        state: result.reused ? "reused" : "reviewed",
        candidateRef: {
          kind: "project_constitution_candidate",
          id: result.candidate.candidateId,
          digest: result.candidate.digest,
        },
        grantsAuthority: false,
      },
      projection,
    };
    this.emit("transition", {
      reason: result.reused
        ? "project-genesis-evidence-review-reused"
        : "project-genesis-evidence-reviewed",
      receipt: response.receipt,
      projection,
    });
    return response;
  }

  admitProjectGenesisCandidate(input = {}) {
    this.ensureStarted();
    if (input.semanticRegionBindingRef) {
      const candidate =
        this.store.projectGenesisCandidateById(
          input.candidateId,
        );
      verifySemanticRegionBinding(
        this.snapshot(),
        input.semanticRegionBindingRef,
        {
          kind:
            "project_constitution_candidate",
          id: candidate?.candidateId,
          digest: candidate?.digest,
        },
      );
    }
    const result = this.store.admitProjectGenesisCandidate({
      candidateId: input.candidateId,
      actorId: input.actorId || "operator",
      admittedAt: new Date(this.now()).toISOString(),
    });
    const projection = this.snapshot();
    const response = {
      receipt: {
        schema: "direct_project_constitution_admission_receipt@1",
        state: result.reused ? "reused" : "admitted",
        constitutionRef: {
          kind: "project_constitution",
          id: result.constitution.projectId,
          digest: result.constitution.digest,
        },
        runtimeDefaultBindingRef: {
          kind: "project_runtime_default_binding",
          id: result.runtimeBinding.bindingId,
          digest: result.runtimeBinding.digest,
        },
        activationState: result.constitution.activationState,
        grantsAuthority: false,
      },
      projection,
    };
    this.emit("transition", {
      reason: result.reused
        ? "project-constitution-admission-reused"
        : "project-constitution-admitted",
      receipt: response.receipt,
      projection,
    });
    return response;
  }

  projectRuntimeDefaultRef(runtimeDefault) {
    return {
      kind: "project_runtime_default_binding",
      id: runtimeDefault.bindingId,
      digest: runtimeDefault.digest,
    };
  }

  runtimeProjectDescriptor(projectId) {
    const configured = this.projects.find((project) =>
      normalizeString(project.id || project.projectId, "") ===
        normalizeString(projectId, ""));
    const constitution = this.store.listProjectConstitutions().find((entry) =>
      entry.projectId === projectId);
    const binding = this.store.projectWorkspaceBinding(projectId);
    const locator = this.store.projectWorkspaceLocator(projectId);
    if (!constitution || !binding || !locator) return configured || null;
    const workspace = locator.workspaceKind === "wsl"
      ? {
          kind: "wsl",
          distro: locator.distro,
          linuxPath: locator.nativeWorkspacePath,
          label: binding.workspaceLabel,
        }
      : locator.workspaceKind === "windows"
        ? {
            kind: "windows",
            windowsPath: locator.nativeWorkspacePath,
            windowsNodePath: locator.windowsNodePath,
            label: binding.workspaceLabel,
          }
        : {
            kind: "local",
            localPath: locator.nativeWorkspacePath,
            label: binding.workspaceLabel,
          };
    return {
      id: projectId,
      projectId,
      name: constitution.identity,
      summary: constitution.purpose,
      runtimePath: "direct",
      workspaceKind: locator.workspaceKind,
      workspace,
      repoPath: locator.nativeWorkspacePath,
      surfaceBinding: {
        codex: {
          mode: "managed",
          bindingProvider: "direct-chatgpt-codex",
          runtimeMode: "direct-experimental",
          directTier: "implementation-lane",
          directTransport: "live-text",
          runtime:
            locator.workspaceKind === "windows"
              ? "windows"
              : "wsl",
        },
      },
      semanticSource:
        "canonical_project_workspace_binding",
      projectWorkspaceBindingRef:
        workspaceBindingRef(binding),
    };
  }

  async observeProjectEnvironmentReadiness(projectId) {
    const binding = this.store.projectWorkspaceBinding(projectId);
    const locator = this.store.projectWorkspaceLocator(projectId);
    if (!binding || !locator) {
      const error = new Error(
        "world_manager_project_workspace_not_provisioned",
      );
      error.code =
        "world_manager_project_workspace_not_provisioned";
      throw error;
    }
    if (!this.environmentReadinessProvider) {
      const persisted = this.store.environmentProbeByRef(binding.probeRef);
      if (!persisted) {
        const error = new Error(
          "world_manager_environment_probe_missing",
        );
        error.code = "world_manager_environment_probe_missing";
        throw error;
      }
      return persisted;
    }
    const observation = await this.environmentReadinessProvider({
      project: this.runtimeProjectDescriptor(projectId),
      projectId,
      workspaceBinding: binding,
      workspaceLocator: locator,
    });
    const receipt = buildEnvironmentProbeReceipt({
      projectId,
      environmentId: binding.environmentId,
      workspaceKind: locator.workspaceKind,
      adapterKind: observation.adapterKind || binding.adapterKind,
      probeState: observation.probeState,
      nativePlatform: observation.nativePlatform,
      backendSessionId: observation.backendSessionId,
      processContinuityObserved:
        observation.processContinuityObserved,
      workspaceIdentityMatched:
        observation.workspaceIdentityMatched,
      capabilityClasses: observation.capabilityClasses,
      blockerCodes: observation.blockerCodes,
      observedAt:
        observation.observedAt ||
        new Date(this.now()).toISOString(),
    });
    this.store.registerEnvironmentProbeReceipt({ receipt });
    return receipt;
  }

  async ensureWorkThreadEnvironment(input = {}) {
    const projectId = normalizeString(input.projectId, "");
    const threadId = normalizeString(input.threadId, "");
    const workThreadId = normalizeString(input.workThreadId, "");
    const stepId = normalizeString(input.stepId, "");
    const runtimeDefault = this.store.projectRuntimeDefault(projectId);
    const workspaceBinding = this.store.projectWorkspaceBinding(projectId);
    if (!runtimeDefault || !workspaceBinding) return null;
    let threadBinding = this.store.threadEnvironmentBinding(threadId);
    if (!threadBinding) {
      threadBinding = buildThreadEnvironmentBinding({
        projectId,
        threadId,
        workThreadId,
        projectRuntimeDefaultRef:
          this.projectRuntimeDefaultRef(runtimeDefault),
        workspaceBindingRef:
          workspaceBindingRef(workspaceBinding),
        primaryEnvironmentId:
          runtimeDefault.defaultEnvironmentId,
        selectedEnvironmentIds: [
          runtimeDefault.defaultEnvironmentId,
        ],
        allowedEnvironmentIds:
          runtimeDefault.allowedEnvironmentIds,
        inheritedFromStepSnapshotRef:
          input.inheritedFromStepSnapshotRef,
        createdAt: new Date(this.now()).toISOString(),
      });
      threadBinding = this.store.registerThreadEnvironmentBinding({
        binding: threadBinding,
      }).binding;
    } else if (
      threadBinding.projectId !== projectId ||
      threadBinding.workThreadId !== workThreadId ||
      threadBinding.workspaceBindingRef.id !==
        workspaceBinding.workspaceBindingId ||
      threadBinding.workspaceBindingRef.digest !==
        workspaceBinding.digest
    ) {
      const error = new Error(
        "world_manager_thread_environment_binding_scope_mismatch",
      );
      error.code =
        "world_manager_thread_environment_binding_scope_mismatch";
      throw error;
    }
    const existingSnapshot =
      this.store.stepEnvironmentSnapshot?.(threadId, stepId);
    if (existingSnapshot) {
      return {
        threadEnvironmentBinding: threadBinding,
        stepEnvironmentSnapshot: existingSnapshot,
      };
    }
    const probe = await this.observeProjectEnvironmentReadiness(projectId);
    const snapshot = buildStepEnvironmentSnapshot({
      threadEnvironmentBinding: threadBinding,
      stepId,
      environmentObservations: [{
        environmentId: probe.environmentId,
        readiness: probe.probeState,
        adapterKind: probe.adapterKind,
        capabilityClasses: probe.capabilityClasses,
        capabilityRootRefs: [],
        probeRef: environmentProbeRef(probe),
      }],
      observedAt: probe.observedAt,
    });
    const registered = this.store.registerStepEnvironmentSnapshot({
      snapshot,
    });
    return {
      threadEnvironmentBinding: threadBinding,
      stepEnvironmentSnapshot: registered.snapshot,
    };
  }

  async provisionProjectSubstrate(input = {}) {
    this.ensureStarted();
    if (!this.projectSubstrateProvisioningAvailable()) {
      const error = new Error(
        "world_manager_project_substrate_provisioning_unavailable",
      );
      error.code =
        "world_manager_project_substrate_provisioning_unavailable";
      throw error;
    }
    const projectId = normalizeString(input.projectId, "");
    const constitution = this.store.listProjectConstitutions().find((entry) =>
      entry.projectId === projectId);
    const runtimeDefault = this.store.projectRuntimeDefault(projectId);
    if (!constitution || !runtimeDefault) {
      const error = new Error(
        "world_manager_project_substrate_constitution_missing",
      );
      error.code =
        "world_manager_project_substrate_constitution_missing";
      throw error;
    }
    const existing = this.store.projectWorkspaceBinding(projectId);
    if (existing) {
      const locator = this.store.projectWorkspaceLocator(projectId);
      if (!workspaceRequestMatchesLocator(input.workspace, locator)) {
        const error = new Error(
          `world_manager_project_workspace_port_operation_required:${projectId}`,
        );
        error.code =
          "world_manager_project_workspace_port_operation_required";
        throw error;
      }
      const projection = this.snapshot();
      return {
        receipt: {
          schema: "direct_project_substrate_provisioning_receipt@1",
          state: "reused",
          projectId,
          workspaceBindingRef: workspaceBindingRef(existing),
          currentProjectionRevision: projection.projectionRevision,
          grantsAuthority: false,
        },
        projection,
      };
    }
    const observation = await this.projectSubstrateProvisioner({
      projectId,
      constitution,
      runtimeDefault,
      workspace: input.workspace,
      actorId: input.actorId || "operator",
    });
    if (
      observation.environmentId !== runtimeDefault.defaultEnvironmentId ||
      observation.probeState !== "ready" ||
      observation.workspaceIdentityMatched !== true
    ) {
      const error = new Error(
        "world_manager_project_substrate_native_probe_failed",
      );
      error.code =
        "world_manager_project_substrate_native_probe_failed";
      throw error;
    }
    const createdAt = normalizeString(
      observation.observedAt,
      new Date(this.now()).toISOString(),
    );
    const locator = buildProjectWorkspaceLocator({
      projectId,
      environmentId: observation.environmentId,
      workspaceKind: observation.workspaceKind,
      nativeWorkspacePath: observation.nativeWorkspacePath,
      distro: observation.distro,
      windowsNodePath: observation.windowsNodePath,
      createdAt,
    });
    const environmentProbe = buildEnvironmentProbeReceipt({
      projectId,
      environmentId: observation.environmentId,
      workspaceKind: observation.workspaceKind,
      adapterKind: observation.adapterKind,
      probeState: observation.probeState,
      nativePlatform: observation.nativePlatform,
      backendSessionId: observation.backendSessionId,
      processContinuityObserved:
        observation.processContinuityObserved,
      workspaceIdentityMatched:
        observation.workspaceIdentityMatched,
      capabilityClasses: observation.capabilityClasses,
      blockerCodes: observation.blockerCodes,
      observedAt: createdAt,
    });
    const workspaceBinding = buildProjectWorkspaceBinding({
      projectId,
      runtimeDefaultBindingRef:
        this.projectRuntimeDefaultRef(runtimeDefault),
      environmentId: observation.environmentId,
      workspaceKind: observation.workspaceKind,
      workspaceLabel: observation.workspaceLabel,
      workspaceIdentityDigest: digestFor(
        "direct-project-workspace-identity@1",
        {
          projectId,
          environmentId: observation.environmentId,
          workspaceKind: observation.workspaceKind,
          nativeWorkspacePath: observation.nativeWorkspacePath,
        },
      ),
      locatorRef: {
        kind: "project_workspace_locator",
        id: locator.locatorId,
        digest: locator.digest,
      },
      probeRef: environmentProbeRef(environmentProbe),
      adapterKind: observation.adapterKind,
      createdAt,
    });
    const registered = this.store.registerProjectSubstrateProvisioning({
      workspaceBinding,
      workspaceLocator: locator,
      environmentProbe,
    });
    const workThread = this.workThreadStore.upsertWorkThread({
      workThreadId: stableId("project_substrate_work_thread", {
        workspaceBindingRef: workspaceBindingRef(workspaceBinding),
      }),
      projectId,
      title: "Project substrate activation",
      lifecycleState: "active",
      objective: {
        summary:
          "Maintain the admitted project workspace and native execution environment binding.",
        currentObjective:
          "Prove the primary environment and freeze it into the thread runtime binding.",
        priority: "normal",
      },
      ontologyProfileRef: {
        kind: "project_constitution",
        id: constitution.projectId,
        digest: constitution.digest,
      },
      workspaceKind: observation.workspaceKind,
      workspaceIdentity: {
        workspaceKind: observation.workspaceKind,
        workspaceEvidenceKey:
          workspaceBinding.workspaceIdentityDigest,
        workspaceLabel: workspaceBinding.workspaceLabel,
        workspaceDigest: workspaceBinding.digest,
        confidence: "exact",
      },
      phaseState: {
        phaseId: "wm_env1_project_provisioning",
        phaseKind: "project_runtime_provisioning",
        status: "active",
      },
      activeRuntimePath: "direct-implementation",
      authorityBoundary: {
        allowedActions: ["native_environment_probe"],
        forbiddenActions: [
          "workspace_mutation",
          "remote_mutation",
          "project_port_without_explicit_operation",
        ],
        summary:
          "ENV1 proves and binds the native environment without granting workspace mutation authority.",
      },
      evidenceRefs: [
        workspaceBindingRef(workspaceBinding),
        environmentProbeRef(environmentProbe),
      ],
    });
    const environmentRuntime = await this.ensureWorkThreadEnvironment({
      projectId,
      threadId: workThread.workThreadId,
      workThreadId: workThread.workThreadId,
      stepId: "project_substrate_native_probe",
    });
    const projection = this.snapshot();
    const receipt = {
      schema: "direct_project_substrate_provisioning_receipt@1",
      state: registered.reused ? "reused" : "provisioned",
      projectId,
      workspaceBindingRef: workspaceBindingRef(workspaceBinding),
      environmentProbeRef: environmentProbeRef(environmentProbe),
      workThreadRef: {
        kind: "work_thread",
        id: workThread.workThreadId,
        digest: workThread.digest,
      },
      threadEnvironmentBindingRef:
        threadEnvironmentBindingRef(
          environmentRuntime.threadEnvironmentBinding,
        ),
      stepEnvironmentSnapshotRef:
        stepEnvironmentSnapshotRef(
          environmentRuntime.stepEnvironmentSnapshot,
        ),
      primaryEnvironmentId:
        environmentRuntime.stepEnvironmentSnapshot.primaryEnvironmentId,
      nativePlatform: environmentProbe.nativePlatform,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      currentProjectionRevision: projection.projectionRevision,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason: registered.reused
        ? "project-substrate-provisioning-reused"
        : "project-substrate-provisioned",
      receipt,
      projection,
    });
    return { receipt, projection };
  }

  async defineAroTarget(input = {}) {
    this.ensureStarted();
    if (!this.aroTargetDefinitionAvailable()) {
      const error = new Error(
        "world_manager_aro_target_definition_unavailable",
      );
      error.code =
        "world_manager_aro_target_definition_unavailable";
      throw error;
    }
    const currentAro =
      this.store
        .abstractReasoningObjectById(
          input.currentAroId,
        );
    if (
      !currentAro ||
      currentAro.digest !==
        normalizeString(
          input.currentAroDigest,
          "",
        ) ||
      (
        normalizeString(
          input.projectId,
          currentAro?.projectId || "",
        ) !== currentAro?.projectId
      ) ||
      currentAro.posture !== "current" ||
      currentAro.canonical !== true ||
      currentAro.lifecycle !== "active"
    ) {
      const error = new Error(
        "world_manager_aro_target_current_invalid",
      );
      error.code =
        "world_manager_aro_target_current_invalid";
      throw error;
    }
    const targetIntent =
      normalizeString(
        input.targetIntent,
        "",
      );
    if (!targetIntent) {
      const error = new Error(
        "world_manager_aro_target_intent_required",
      );
      error.code =
        "world_manager_aro_target_intent_required";
      throw error;
    }
    if (!input.semanticRegionBindingRef) {
      const error = new Error(
        "world_manager_aro_region_binding_required",
      );
      error.code =
        "world_manager_aro_region_binding_required";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "abstract_reasoning_object",
        id: currentAro.aroId,
        digest: currentAro.digest,
      },
    );
    const repositorySnapshot =
      this.store
        .listRepositorySemanticSnapshots({
          projectId:
            currentAro.projectId,
          limit: 1,
        })[0] || null;
    if (!repositorySnapshot) {
      const error = new Error(
        "world_manager_aro_target_repository_snapshot_missing",
      );
      error.code =
        "world_manager_aro_target_repository_snapshot_missing";
      throw error;
    }
    const targetBaselineAro =
      this.store
        .listAbstractReasoningObjects({
          projectId:
            currentAro.projectId,
          posture: "target",
          currentOnly: true,
        })
        .find((aro) =>
          aro.conceptKey ===
            currentAro.conceptKey) ||
      null;
    const scheduled =
      this.store
        .scheduleAroTargetDefinitionRun({
          currentAro,
          targetBaselineAro,
          targetIntent,
          retry: input.retry === true,
          createdAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    if (scheduled.reused) {
      const projection = this.snapshot();
      return {
        receipt: {
          schema:
            "direct_aro_target_definition_orchestration_receipt@1",
          state: scheduled.run.state,
          reused: true,
          projectId:
            currentAro.projectId,
          currentAroRef:
            scheduled.run
              .currentAroRef,
          runRef: {
            kind:
              "aro_target_definition_run",
            id: scheduled.run.runId,
            digest:
              scheduled.run.digest,
            projectId:
              scheduled.run.projectId,
          },
          candidateRef:
            scheduled.run
              .candidateRef,
          sourceInspectionEffect: false,
          realizationBindingEffect: false,
          canonicalAdmissionEffect: false,
          mutationContractEffect: false,
          workerLaunchEffect: false,
          workspaceMutationEffect: false,
          grantsAuthority: false,
        },
        projection,
      };
    }
    this.emit("transition", {
      reason:
        "aro-target-definition-scheduled",
      receipt: {
        schema:
          "direct_aro_target_definition_orchestration_receipt@1",
        state: "scheduled",
        projectId:
          currentAro.projectId,
        currentAroRef:
          scheduled.run.currentAroRef,
        runRef: {
          kind:
            "aro_target_definition_run",
          id: scheduled.run.runId,
          digest:
            scheduled.run.digest,
          projectId:
            scheduled.run.projectId,
        },
        sourceInspectionEffect: false,
        realizationBindingEffect: false,
        canonicalAdmissionEffect: false,
        mutationContractEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    const running =
      reviseAroTargetDefinitionRun(
        scheduled.run,
        {
          state: "running",
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroTargetDefinitionRun({
        run: running,
      });
    this.emit("transition", {
      reason:
        "aro-target-definition-running",
      receipt: {
        schema:
          "direct_aro_target_definition_orchestration_receipt@1",
        state: "running",
        projectId:
          currentAro.projectId,
        currentAroRef:
          running.currentAroRef,
        runRef: {
          kind:
            "aro_target_definition_run",
          id: running.runId,
          digest: running.digest,
          projectId:
            running.projectId,
        },
        sourceInspectionEffect: false,
        realizationBindingEffect: false,
        canonicalAdmissionEffect: false,
        mutationContractEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      },
      projection: this.snapshot(),
    });
    let result;
    try {
      result =
        await this
          .aroTargetDefinitionRuntime
          .run({
            projectId:
              currentAro.projectId,
            project:
              this.projectForAroReconstruction(
                currentAro.projectId,
              ) || {
                id:
                  currentAro.projectId,
              },
            currentAro,
            existingTargetAro:
              targetBaselineAro,
            targetIntent,
            repositorySnapshotRef: {
              kind:
                "repository_snapshot",
              id:
                repositorySnapshot
                  .snapshotId,
              digest:
                repositorySnapshot
                  .snapshotDigest,
              projectId:
                repositorySnapshot
                  .projectId,
            },
            attempt: running.attempt,
            reasoningEffort: "medium",
          });
    } catch (error) {
      result = {
        state: "failed",
        requestManifest: null,
        validation: null,
        candidate: null,
        definitionRationale: "",
        assumptions: [],
        unresolvedQuestions: [],
        telemetry: null,
        error:
          rendererSafeError(error),
      };
    }
    let candidate = null;
    if (
      result.state === "completed" &&
      result.candidate
    ) {
      candidate =
        this.store
          .registerAroReconstructionCandidate({
            candidate:
              result.candidate,
          }).candidate;
    }
    const terminal =
      reviseAroTargetDefinitionRun(
        running,
        {
          state: result.state,
          requestManifest:
            result.requestManifest,
          validation:
            result.validation,
          candidateRef: candidate
            ? {
                kind:
                  "aro_reconstruction_candidate",
                id:
                  candidate.candidateId,
                digest:
                  candidate.digest,
                projectId:
                  candidate.projectId,
              }
            : null,
          definitionRationale:
            result.definitionRationale,
          assumptions:
            result.assumptions,
          unresolvedQuestions:
            result.unresolvedQuestions,
          telemetry: result.telemetry,
          error: result.error,
          updatedAt:
            new Date(
              this.now(),
            ).toISOString(),
          now: this.now,
        },
      );
    this.store
      .registerAroTargetDefinitionRun({
        run: terminal,
      });
    const projection = this.snapshot();
    const receipt = {
      schema:
        "direct_aro_target_definition_orchestration_receipt@1",
      state: terminal.state,
      reused: false,
      projectId:
        currentAro.projectId,
      currentAroRef:
        terminal.currentAroRef,
      runRef: {
        kind:
          "aro_target_definition_run",
        id: terminal.runId,
        digest: terminal.digest,
        projectId:
          terminal.projectId,
      },
      candidateRef:
        terminal.candidateRef,
      error: terminal.error,
      sourceInspectionEffect: false,
      realizationBindingEffect: false,
      canonicalAdmissionEffect: false,
      mutationContractEffect: false,
      workerLaunchEffect: false,
      workspaceMutationEffect: false,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason:
        terminal.state === "completed"
          ? "aro-target-definition-completed"
          : terminal.state === "remanded"
            ? "aro-target-definition-remanded"
            : "aro-target-definition-failed",
      receipt,
      projection,
    });
    return { receipt, projection };
  }

  reviewAroReconstructionCandidate(
    input = {},
  ) {
    this.ensureStarted();
    const candidate =
      this.store
        .aroReconstructionCandidateById(
          input.candidateId,
        );
    if (!candidate) {
      const error = new Error(
        "world_manager_aro_candidate_missing",
      );
      error.code =
        "world_manager_aro_candidate_missing";
      throw error;
    }
    if (!input.semanticRegionBindingRef) {
      const error = new Error(
        "world_manager_aro_region_binding_required",
      );
      error.code =
        "world_manager_aro_region_binding_required";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_reconstruction_candidate",
        id: candidate.candidateId,
        digest: candidate.digest,
      },
    );
    const result =
      this.store
        .reviewAroReconstructionCandidate({
          candidateId:
            candidate.candidateId,
          candidateDigest:
            input.candidateDigest,
          expectedCandidateRevision:
            input.expectedCandidateRevision,
          actorId:
            input.actorId ||
            "operator",
          reviewedAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    const projection = this.snapshot();
    const receipt = {
      ...result.receipt,
      state: result.reused
        ? "reused"
        : "reviewed",
      candidateRef: {
        kind:
          "aro_reconstruction_candidate",
        id: result.candidate.candidateId,
        digest:
          result.candidate.digest,
        projectId:
          result.candidate.projectId,
      },
      currentProjectionRevision:
        projection.projectionRevision,
      semanticTruthValidated: false,
      codeMutationExecuted: false,
      downstreamEffectsExecuted: false,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason: result.reused
        ? "aro-reconstruction-review-reused"
        : "aro-reconstruction-reviewed",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  admitAroReconstructionCandidate(
    input = {},
  ) {
    this.ensureStarted();
    const candidate =
      this.store
        .aroReconstructionCandidateById(
          input.candidateId,
        );
    if (!candidate) {
      const error = new Error(
        "world_manager_aro_candidate_missing",
      );
      error.code =
        "world_manager_aro_candidate_missing";
      throw error;
    }
    if (!input.semanticRegionBindingRef) {
      const error = new Error(
        "world_manager_aro_region_binding_required",
      );
      error.code =
        "world_manager_aro_region_binding_required";
      throw error;
    }
    verifySemanticRegionBinding(
      this.snapshot(),
      input.semanticRegionBindingRef,
      {
        kind:
          "aro_reconstruction_candidate",
        id: candidate.candidateId,
        digest: candidate.digest,
      },
    );
    const result =
      this.store
        .admitAroReconstructionCandidate({
          candidateId:
            candidate.candidateId,
          candidateDigest:
            input.candidateDigest,
          expectedCandidateRevision:
            input.expectedCandidateRevision,
          actorId:
            input.actorId ||
            "operator",
          admittedAt:
            new Date(
              this.now(),
            ).toISOString(),
        });
    const projection = this.snapshot();
    const receipt = {
      ...result.receipt,
      state: result.reused
        ? "reused"
        : "admitted",
      candidateRef: {
        kind:
          "aro_reconstruction_candidate",
        id: result.candidate.candidateId,
        digest:
          result.candidate.digest,
        projectId:
          result.candidate.projectId,
      },
      aroRef: {
        kind:
          "abstract_reasoning_object",
        id: result.aro.aroId,
        digest: result.aro.digest,
        projectId: result.aro.projectId,
      },
      currentProjectionRevision:
        projection.projectionRevision,
      codeMutationExecuted: false,
      downstreamEffectsExecuted: false,
      grantsAuthority: false,
    };
    this.emit("transition", {
      reason: result.reused
        ? "aro-admission-reused"
        : "aro-admitted",
      receipt,
      projection,
    });
    return {
      receipt,
      projection,
    };
  }

  epistemicFabricSnapshot() {
    this.ensureStarted();
    if (!this.epistemicFabric?.projection) {
      const error = new Error(
        "world_manager_epistemic_fabric_unavailable",
      );
      error.code =
        "world_manager_epistemic_fabric_unavailable";
      throw error;
    }
    return this.epistemicFabric.projection();
  }

  compileEpistemicLedgerTools(input = {}) {
    this.ensureStarted();
    return this.epistemicFabric.compileRoleTools(input);
  }

  resolveArtifactLedgerBinding(input = {}) {
    this.ensureStarted();
    return this.epistemicFabric.resolveArtifactLedgerBinding(input);
  }

  async invokeEpistemicLedgerTool(input = {}) {
    this.ensureStarted();
    const result = this.epistemicFabric.invokeLedgerTool(input);
    const lifecycleIngestion =
      this.epistemicFabric.ingestLifecycleLedgerAct({
        ledgerToolResult: result,
        operationName: input.operationName,
        artifactLifecycleBinding: input.artifactLifecycleBinding,
      });
    let lifecycleAutomation = null;
    const nextAction = lifecycleIngestion?.receipt?.nextAction || "none";
    try {
      lifecycleAutomation =
        await this.epistemicFabric.automateLifecycleIngestion(
          lifecycleIngestion,
        );
    } catch (error) {
      lifecycleAutomation = {
        action: nextAction,
        state: "failed_visible",
        errorCode:
          error?.code || error?.message ||
          "artifact_lifecycle_automation_failed",
        canonicalEffect: false,
      };
    }
    const deliveryDrain =
      typeof this.epistemicFabric.dispatchQueuedDeliveries === "function"
        ? await this.epistemicFabric.dispatchQueuedDeliveries()
        : null;
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "epistemic-ledger-act-recorded",
      receipt:
        lifecycleIngestion?.receipt ||
        result.append?.receipt ||
        result.decision,
      projection,
    });
    return {
      result,
      lifecycleIngestion,
      lifecycleAutomation,
      deliveryDrain,
      projection,
    };
  }

  async activateImplementationPatchLifecycle(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.activateImplementationPatch(input);
    const producerDispatch = result.producerAssignment
      ? await this.epistemicFabric.dispatchProducerAssignment(
          result.lifecycle.lifecycleId,
        )
      : null;
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-lifecycle-activated",
      receipt: result.producerResolution,
      projection,
    });
    return { result, producerDispatch, projection };
  }

  publishImplementationPatchRevision(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.publishArtifactRevision(input);
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-revision-published",
      receipt: {
        schema: "direct_artifact_revision_registration_receipt@1",
        artifactRevisionRef: {
          kind: "artifact_revision",
          id: result.revision.artifactRevisionId,
          digest: result.revision.digest,
        },
        canonicalEffect: false,
        grantsAuthority: false,
      },
      projection,
    });
    return { result, projection };
  }

  async routeImplementationPatchAudits(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.routeArtifactAudits(input);
    const auditDispatches = result.assignments?.length
      ? await this.epistemicFabric.dispatchAuditAssignments(
          input.lifecycleId,
        )
      : [];
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-audits-routed",
      receipt: result.plan,
      projection,
    });
    return { result, auditDispatches, projection };
  }

  submitImplementationPatchAudit(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.submitAuditVerdict(input);
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-audit-assessed",
      receipt: result,
      projection,
    });
    return { result, projection };
  }

  joinImplementationPatchWitness(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.joinMechanicalWitness(input);
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-mechanical-witness-joined",
      receipt: result,
      projection,
    });
    return { result, projection };
  }

  evaluateImplementationPatchAssurance(input = {}) {
    this.ensureStarted();
    const result =
      this.epistemicFabric.evaluateArtifactAssurance(input);
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "artifact-assurance-evaluated",
      receipt: result.gateDecision,
      projection,
    });
    return { result, projection };
  }

  async requestImplementationPatchAdmission(input = {}) {
    this.ensureStarted();
    const lifecycle = this.epistemicFabric.lifecycle(input.lifecycleId);
    const actorRef = input.actorRef ||
      this.worldmodel.projectManagerAdmissionActorRef(
        lifecycle.subjectScope.projectId,
      );
    const result = await
      this.epistemicFabric.requestArtifactAdmission({
        ...input,
        actorRef,
      });
    const projection = this.snapshot();
    this.emit("transition", {
      reason: result.receipt?.admitted
        ? "artifact-admitted"
        : "artifact-admission-failed",
      receipt: result.receipt,
      projection,
    });
    return { result, projection };
  }

  async requestImplementationPatchAdmissionFromSurface(input = {}) {
    this.ensureStarted();
    if (
      input.schema !==
        "direct_world_manager_artifact_admission_request@1" ||
      input.operatorReviewAcknowledged !== true
    ) {
      serviceFail(
        "world_manager_artifact_admission_surface_request_invalid",
      );
    }
    const lifecycleId = normalizeString(input.lifecycleId, "");
    const lifecycle = this.epistemicFabric.lifecycle(lifecycleId);
    const card = this.epistemicFabric.projection().lifecycleCards.find(
      (candidate) => candidate.lifecycleRef?.id === lifecycleId,
    );
    if (
      !card ||
      card.state !== "gate_ready" ||
      card.authorityState !== "gate_ready" ||
      card.receiptBackedCanonical === true ||
      !exactRefMatches(input.lifecycleRef, card.lifecycleRef) ||
      !exactRefMatches(
        input.artifactRevisionRef,
        card.currentArtifactRevisionRef,
      ) ||
      !exactRefMatches(input.gateDecisionRef, card.gateDecisionRef) ||
      !exactRefMatches(
        input.admissionAuthorityRef,
        card.admissionAuthorityRef,
      ) ||
      !exactAdmissionScopeMatches(
        input.targetAdmissionScope,
        card.targetAdmissionScope,
      ) ||
      !exactRefVectorMatches(
        input.expectedCanonicalRevisionRefs,
        card.expectedCanonicalRevisionRefs,
      ) ||
      !exactRefVectorMatches(
        input.reviewedEvidenceRefs,
        card.evidenceRefs,
      ) ||
      !exactRefMatches(
        lifecycle.currentArtifactRevisionRef,
        card.currentArtifactRevisionRef,
      ) ||
      !exactRefMatches(lifecycle.gateDecisionRef, card.gateDecisionRef)
    ) {
      serviceFail(
        "world_manager_artifact_admission_surface_binding_stale",
      );
    }
    return this.requestImplementationPatchAdmission({
      lifecycleId,
      expectedCanonicalRevisionRefs:
        card.expectedCanonicalRevisionRefs,
    });
  }

  acknowledgeEpistemicDelivery(input = {}) {
    this.ensureStarted();
    const result = this.epistemicFabric.acknowledgeDelivery(
      input.deliveryId,
      input,
    );
    const projection = this.snapshot();
    this.emit("transition", {
      reason: "epistemic-delivery-acknowledged",
      receipt: result.acknowledgement || result.cursor,
      projection,
    });
    return { result, projection };
  }

  async importEpistemicDeliveryContext(input = {}) {
    this.ensureStarted();
    const result = await this.epistemicFabric.importDeliveryContext(
      input.deliveryId,
      input,
    );
    const projection = this.snapshot();
    this.emit("transition", {
      reason: result.deliveryTransition,
      receipt: {
        schema: "direct_epistemic_delivery_context_import_receipt@1",
        deliveryRef: {
          kind: "ledger_delivery",
          id: result.delivery.deliveryId,
          digest: result.delivery.deliveryDigest,
        },
        contextAdmissionRef: {
          kind: "ledger_context_admission",
          id: result.admission.contextAdmissionId,
          digest: result.admission.admissionDigest,
        },
        dispatchRef: result.dispatch
          ? {
              kind: "ledger_context_dispatch",
              id: result.dispatch.dispatchId,
              digest: result.dispatch.dispatchDigest,
            }
          : null,
        runtimeDispatchStarted: result.runtimeDispatchStarted,
        wakeStarted: result.wakeStarted,
        canonicalEffect: false,
        grantsAuthority: false,
      },
      projection,
    });
    return { result, projection };
  }

  status() {
    this.ensureStarted();
    return {
      schema: "direct_world_manager_service_status@1",
      pipelineStage:
        this.roleRuntime && this.realizationSnapshotProvider
          ? "wm_k6_genesis"
          : this.roleRuntime
            ? "wm_k4"
            : "wm_k3",
      available: true,
      settlementAvailable: this.semanticIngress.available(),
      semanticIngressAvailable:
        this.semanticIngress.available(),
      semanticIngressMode:
        "constitutional_meta_role",
      constitutionalMetaRoles:
        this.semanticIngress.metaRoleProjection?.() || null,
      graphProjectionAvailable: true,
      managerTurnBootPacketAvailable: true,
      taskConstitutionAvailable: true,
      agentWorldCompilationAvailable: true,
      projectionAgreementAvailable: true,
      roleRuntimeAvailable: Boolean(this.roleRuntime),
      projectGenesisAvailable: Boolean(
        this.roleRuntime && this.realizationSnapshotProvider,
      ),
      projectGenesisAdmissionAvailable: Boolean(
        this.roleRuntime && this.realizationSnapshotProvider,
      ),
      projectSubstrateProvisioningAvailable:
        this.projectSubstrateProvisioningAvailable(),
      aroMutationCompilationAvailable:
        this.aroMutationCompilationAvailable(),
      aroRealizationMappingAvailable:
        this.aroRealizationMappingAvailable(),
      aroTargetDefinitionAvailable:
        this.aroTargetDefinitionAvailable(),
      aroWorkerHandoffAvailable:
        this.aroWorkerHandoffAvailable(),
      aroExecutionEvidenceAvailable:
        this.aroExecutionEvidenceAvailable(),
      aroSemanticVerificationAvailable:
        this.aroSemanticVerificationAvailable(),
      thoughtBrushAvailable:
        this.thoughtBrushAvailable(),
      contextCanvasAvailable: true,
      contextCanvasWorldEffect:
        "none",
      contextCanvasCanonicalAdmissionAvailable:
        false,
      aroMutationExecutionAvailable: false,
      store: this.store.descriptor(),
      ledgerVerification: this.store.verifyLedger(),
      restartContextVerification: this.restartContextVerification,
      restartAgentWorldVerification:
        this.restartAgentWorldVerification,
      semanticHistoryReconstruction:
        this.semanticHistoryReconstruction,
      semanticArtifactKernelAvailable: true,
      aroRegistryAvailable: true,
      repositorySemanticSnapshotAvailable:
        Boolean(
          this.repositorySnapshotProvider,
        ),
      aroReconstructionRuntimeAvailable:
        this.aroReconstructionRuntime
          ?.available?.() === true,
      aroReconstructionAutomaticSchedulingAvailable:
        this.aroReconstructionAvailable(),
      aroReconstructionRetryAvailable:
        this.aroReconstructionAvailable(),
      aroReconstructionReviewAvailable: true,
      aroAdmissionAvailable: true,
      aroAdmissionMutatesCode: false,
      semanticDecisionTransitionAvailable: true,
      semanticDecisionKernelSynchronization:
        this.semanticDecisionKernelSynchronization,
      semanticContextImportAvailable: true,
      operationalMetaContextAvailable: true,
      contextRequestManifestLinkageAvailable: true,
      semanticContextPreparation:
        this.semanticContextPreparation,
      epistemicFabricAvailable:
        Boolean(this.epistemicFabric),
      epistemicFabric:
        this.epistemicFabric?.status?.() || null,
    };
  }

  close() {
    this.removeAllListeners();
    this.epistemicFabric?.close?.();
    this.store?.close?.();
    this.started = false;
    this.readyPromise = null;
    this.aroReconstructionJobs.clear();
    this.aroMutationJobs.clear();
    this.aroRealizationMappingJobs.clear();
    this.aroAutomaticallyObservedProjects
      .clear();
  }
}

module.exports = {
  DirectWorldManagerService,
  rendererSafeError,
};
