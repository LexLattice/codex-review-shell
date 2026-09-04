"use strict";

const {
  buildEpistemicLedgerEvent,
  buildLedgerActTypeConstitution,
  buildLedgerStreamRef,
  epistemicLedgerEventRef,
  ledgerActTypeConstitutionRef,
} = require("./epistemic-ledger-kernel");
const {
  DirectEpistemicLedgerStore,
} = require("./epistemic-ledger-store");
const {
  compileRoleLedgerToolBundle,
  decideLedgerToolCall,
  operationRegistry,
} = require("./ledger-tool-compiler");
const {
  DirectLedgerSubscriptionBroker,
  buildNotificationStanding,
  matchSubscriptionToEvent,
  subscriptionRef,
} = require("./ledger-subscription-broker");
const {
  adaptLedgerDeliveryToContinuation,
  deriveContextInvalidationNotices,
  hydrateLedgerDeliveryAsync,
} = require("./ledger-context-runtime");
const {
  artifactLifecycleInstanceRef,
  artifactRevisionRefFor,
  artifactTypeConstitutionRef,
  buildArtifactTypeConstitution,
  buildAuditAssessment,
  buildMechanicalWitnessJoin,
  digestFor,
  exactRef: exactArtifactRef,
  exactRefMatches,
  normalizeScope,
  producerAssignmentRef,
  reviseArtifactLifecycleInstance,
  validateAuditAssignment,
  validateProducerAssignment,
} = require("./artifact-lifecycle-kernel");
const {
  DirectArtifactLifecycleRuntime,
} = require("./artifact-lifecycle-runtime");
const {
  compileEpistemicFabricProjection,
} = require("./epistemic-ledger-projection");
const {
  DirectEpistemicFabricStateStore,
} = require("./epistemic-fabric-state-store");
const {
  buildArtifactWorkThreadStartAuthorization,
  validateArtifactWorkThreadStartAuthorization,
} = require("../bridge/worker-start");
const {
  artifactRuntimeEvidenceReceiptRef,
  buildArtifactRuntimeEvidenceReceipt,
} = require("./artifact-runtime-evidence");

const EPISTEMIC_FABRIC_RUNTIME_SCHEMA =
  "direct_world_manager_epistemic_fabric_runtime@1";
const ARTIFACT_STATE_COMPONENT = "artifact_lifecycle_runtime";
const BROKER_STATE_COMPONENT = "ledger_subscription_broker";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ref(kind, id, seed = {}) {
  return {
    kind,
    id,
    digest: digestFor(`direct_${kind}@1`, { id, ...seed }),
    ...(text(seed.projectId, "")
      ? { projectId: text(seed.projectId, "") }
      : {}),
  };
}

function roleRef(roleLane, projectId = "") {
  return ref("role_lane", roleLane, { projectId });
}

function scopeForKernel(scope = {}) {
  const kind = text(scope.kind, scope.projectId ? "project" : "user_world");
  return {
    kind:
      kind === "work_thread"
        ? "workthread"
        : kind === "agent_run"
          ? "task"
          : kind,
    userWorldId: text(scope.userWorldId, "user_world_local"),
    projectId: text(scope.projectId, ""),
    taskId: text(scope.taskId || scope.agentRunId, ""),
    taskType: text(scope.taskType, ""),
    workThreadId: text(scope.workThreadId, ""),
    artifactLifecycleId: text(scope.artifactLifecycleId, ""),
  };
}

function streamRefsForScope(scope) {
  const values = [
    buildLedgerStreamRef({
      streamType: "world",
      streamId: scope.userWorldId,
    }),
  ];
  if (scope.projectId) {
    values.push(buildLedgerStreamRef({
      streamType: "project",
      streamId: scope.projectId,
    }));
  }
  if (scope.workThreadId) {
    values.push(buildLedgerStreamRef({
      streamType: "workthread",
      streamId: scope.workThreadId,
    }));
  }
  if (scope.artifactLifecycleId) {
    values.push(buildLedgerStreamRef({
      streamType: "artifact",
      streamId: scope.artifactLifecycleId,
    }));
  }
  if (scope.taskId) {
    values.push(buildLedgerStreamRef({
      streamType: "agent_run",
      streamId: scope.taskId,
    }));
  }
  return values;
}

function emptyArtifactState() {
  return {
    schema: "direct_artifact_lifecycle_runtime_state@1",
    constitutions: [],
    lifecycles: [],
    assuranceGraphs: [],
    producerAssignments: [],
    artifactRevisions: [],
    mechanicalWitnesses: [],
    auditAssignments: [],
    auditAssessments: [],
    auditRoutingPlans: [],
    gateDecisions: [],
    admissionReceiptCandidates: [],
    remandObligations: [],
    remandRoutings: [],
    escalationCandidates: [],
    admissionReceipts: [],
    compatibilityReceipts: [],
    contextAdmissions: [],
    contextInvalidations: [],
    contextDispatches: [],
    contextDispatchReceipts: [],
    workThreadDispatchAuthorizations: [],
    workThreadDispatchReceipts: [],
    lifecycleAuditorCandidateSets: [],
    lifecycleIngestionReceipts: [],
    artifactRuntimeEvidenceReceipts: [],
    activeLifecycleId: "",
    canonicalWorldstateWriter: false,
    grantsAuthority: false,
  };
}

function upsert(values, value, idField) {
  const next = values.filter((entry) => entry[idField] !== value[idField]);
  next.push(value);
  return next;
}

function buildDispatchReceipt(dispatch, adapterReceipt = {}, now = Date.now) {
  const accepted = adapterReceipt?.accepted === true;
  const receipt = {
    schema: "direct_ledger_delivery_dispatch_receipt@1",
    dispatchReceiptId: `receipt:${dispatch.dispatchId}`,
    dispatchRef: {
      kind: "ledger_context_dispatch",
      id: dispatch.dispatchId,
      digest: dispatch.dispatchDigest,
    },
    deliveryRef: dispatch.deliveryRef,
    contextAdmissionRef: dispatch.contextAdmissionRef,
    accepted,
    wakeStarted: accepted && adapterReceipt.wakeStarted === true,
    retryable: adapterReceipt.retryable === true,
    errorCode: text(adapterReceipt.errorCode, ""),
    activationRef: adapterReceipt.activationRef
      ? {
          kind: text(adapterReceipt.activationRef.kind, "agent_run"),
          id: text(adapterReceipt.activationRef.id, ""),
          digest: text(adapterReceipt.activationRef.digest, ""),
        }
      : null,
    directSessionId: text(adapterReceipt.directSessionId, ""),
    directTurnId: text(adapterReceipt.directTurnId, ""),
    terminalState: text(
      adapterReceipt.terminalState,
      accepted ? "completed" : "declined",
    ),
    safeBoundaryContinuation:
      adapterReceipt.safeBoundaryContinuation === true,
    providerCallStarted:
      accepted && adapterReceipt.providerCallStarted === true,
    canonicalEffect: false,
    grantsAuthority: false,
    rawProviderPayloadIncluded: false,
    recordedAt: new Date(
      Number(typeof now === "function" ? now() : now) || Date.now(),
    ).toISOString(),
  };
  receipt.receiptDigest = digestFor(
    "direct_ledger_delivery_dispatch_receipt@1",
    receipt,
  );
  return receipt;
}

function exactRefVectorMatches(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((candidate) =>
    b.some((entry) => exactRefMatches(candidate, entry)));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactAdmissionScopeMatches(left, right) {
  try {
    return JSON.stringify(normalizeScope(left)) ===
      JSON.stringify(normalizeScope(right));
  } catch {
    return false;
  }
}

function implementationPatchConstitution(projectId, now) {
  const exact = (kind, id) => ref(kind, id, { projectId });
  return buildArtifactTypeConstitution({
    artifactTypeId: `ImplementationPatch:${projectId}`,
    semanticScope: {
      kind: "project",
      projectId,
      taskType: "implementation",
    },
    producedObjectKindRefs: [
      exact("artifact_kind", "implementation_patch"),
    ],
    producerEligibilityRef: exact(
      "eligibility_policy",
      "implementation_worker",
    ),
    requiredMechanicalWitnesses: [
      {
        requirementId: "source_digest_current",
        witnessKind: "source_digest_current",
        freshnessPolicyRef: exact(
          "freshness_policy",
          "exact_source_digest",
        ),
      },
      {
        requirementId: "focused_test_exit",
        witnessKind: "focused_test_exit",
        dependencyRequirementIds: ["source_digest_current"],
        freshnessPolicyRef: exact(
          "freshness_policy",
          "same_artifact_revision",
        ),
      },
    ],
    requiredSemanticAudits: [
      {
        requirementId: "semantic_contract_conformance",
        auditType: "semantic_contract_conformance",
        dependencyRequirementIds: ["focused_test_exit"],
        auditorEligibilityRef: exact(
          "auditor_eligibility",
          "contract_reviewer",
        ),
        verdictPolicyRef: exact(
          "verdict_policy",
          "supported_only",
        ),
      },
      {
        requirementId: "regression_preservation",
        auditType: "regression_preservation",
        dependencyRequirementIds: [
          "semantic_contract_conformance",
        ],
        auditorEligibilityRef: exact(
          "auditor_eligibility",
          "regression_reviewer",
        ),
        verdictPolicyRef: exact(
          "verdict_policy",
          "supported_only",
        ),
      },
    ],
    conditionalAuditRules: [
      {
        ruleId: "external_effect_specialist",
        allOf: [{
          path: "governedActionClasses",
          operator: "includes",
          expected: "external_effect",
        }],
        settledPropertySourceRef: exact(
          "semantic_settlement",
          "artifact_properties",
        ),
        auditRequirement: {
          requirementId: "external_effect_safety",
          auditType: "external_effect_safety",
          dependencyRequirementIds: ["regression_preservation"],
          auditorEligibilityRef: exact(
            "auditor_eligibility",
            "external_effect_reviewer",
          ),
          verdictPolicyRef: exact(
            "verdict_policy",
            "supported_only",
          ),
        },
      },
    ],
    auditorIndependenceRuleRef: exact(
      "independence_policy",
      "producer_run_distinct",
    ),
    lifecycleGatePolicyRef: exact(
      "gate_policy",
      "all_required_supported",
    ),
    admissionAuthorityRef: exact(
      "authority",
      "project_manager",
    ),
    remandPolicyRef: exact(
      "remand_policy",
      "typed_obligations",
    ),
    escalationPolicyRef: exact(
      "escalation_policy",
      "three_remands",
    ),
    notificationStandingRefs: [
      exact("notification_standing", "project_manager_material"),
    ],
    budgetPolicyRef: exact("budget_policy", "six_attempts"),
    assuranceRootPolicyRef: exact(
      "assurance_root_policy",
      "bounded_roots",
    ),
    assuranceRoots: [{
      rootKind: "deterministic_validator",
      rootRef: exact(
        "assurance_root",
        "schema_and_digest_validator",
      ),
      permitsRecursiveAudit: false,
      maximumAuditDepth: 0,
    }],
    constitutionAdmissionReceiptRef: exact(
      "canonical_admission_receipt",
      "implementation_patch_constitution_admitted",
    ),
    revision: 1,
    now,
  });
}

class DirectWorldManagerEpistemicFabricRuntime {
  constructor(options = {}) {
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.userWorldId = text(options.userWorldId, "user_world_local");
    this.ledgerStore =
      options.ledgerStore ||
      new DirectEpistemicLedgerStore({
        dbPath: options.dbPath,
        rootDir: options.rootDir,
        now: this.now,
      });
    this.stateStore =
      options.stateStore ||
      new DirectEpistemicFabricStateStore({
        db: this.ledgerStore.db,
        now: this.now,
      });
    this.operationRegistry = operationRegistry({ now: this.now });
    this.lifecycleRuntime =
      options.lifecycleRuntime ||
      new DirectArtifactLifecycleRuntime({ now: this.now });
    this.authorityAdapter =
      typeof options.authorityAdapter === "function"
        ? options.authorityAdapter
        : null;
    this.canonicalRevisionResolver =
      typeof options.canonicalRevisionResolver === "function"
        ? options.canonicalRevisionResolver
        : null;
    this.nativeContextImporterEnabled =
      options.nativeContextImporterEnabled === true;
    this.contextImporter =
      typeof options.contextImporter === "function"
        ? options.contextImporter
        : this.nativeContextImporterEnabled
          ? (request) => this.importNativeLedgerContext(request)
          : null;
    this.contextManifestProvider =
      typeof options.contextManifestProvider === "function"
        ? options.contextManifestProvider
        : null;
    this.contextInvalidationVisibilityResolver =
      typeof options.contextInvalidationVisibilityResolver === "function"
        ? options.contextInvalidationVisibilityResolver
        : null;
    this.deliveryDispatchAdapter =
      typeof options.deliveryDispatchAdapter === "function"
        ? options.deliveryDispatchAdapter
        : null;
    this.deliveryTargetResolver =
      typeof options.deliveryTargetResolver === "function"
        ? options.deliveryTargetResolver
        : null;
    this.artifactWorkThreadDispatchAdapter =
      typeof options.artifactWorkThreadDispatchAdapter === "function"
        ? options.artifactWorkThreadDispatchAdapter
        : null;
    this.artifactRuntimeEvidenceResolver =
      typeof options.artifactRuntimeEvidenceResolver === "function"
        ? options.artifactRuntimeEvidenceResolver
        : null;
    this.deliveryDrainPromise = null;
    const scheduler = isPlainObject(options.scheduler) ? options.scheduler : {};
    const scheduleFlush = typeof options.scheduleFlush === "function"
      ? options.scheduleFlush
      : typeof scheduler.schedule === "function"
        ? scheduler.schedule
        : typeof scheduler.setTimeout === "function"
          ? scheduler.setTimeout
          : null;
    const cancelFlush = typeof options.cancelFlush === "function"
      ? options.cancelFlush
      : typeof scheduler.cancel === "function"
        ? scheduler.cancel
        : typeof scheduler.clearTimeout === "function"
          ? scheduler.clearTimeout
          : null;
    this.scheduleFlush = scheduleFlush || ((callback, delayMs) =>
      setTimeout(callback, delayMs));
    this.cancelFlush = cancelFlush || ((timer) => clearTimeout(timer));
    this.pendingFlushTimer = null;
    this.pendingFlushDueAt = 0;
    this.pendingFlushRetryDelayMs = 0;
    this.closed = false;
    const persistedArtifactState =
      this.stateStore.read(ARTIFACT_STATE_COMPONENT)?.state || null;
    this.artifactState = persistedArtifactState
      ? { ...emptyArtifactState(), ...persistedArtifactState }
      : emptyArtifactState();
    const brokerState =
      this.stateStore.read(BROKER_STATE_COMPONENT)?.state || null;
    this.broker = new DirectLedgerSubscriptionBroker({
      now: this.now,
      state: brokerState,
      visibilityResolver: options.visibilityResolver,
      recipientResolver: options.recipientResolver,
    });
    this.started = false;
  }

  bootstrap(options = {}) {
    if (this.started) return this.status();
    this.registerActTypes();
    for (const projectId of options.projectIds || []) {
      this.ensureProjectConstitution(projectId);
      this.ensureProjectStanding(projectId);
    }
    this.drainPendingOutbox();
    this.reconcileContextInvalidations();
    this.persistBroker();
    this.persistArtifacts();
    this.started = true;
    this.schedulePendingFlush();
    return this.status();
  }

  registerActTypes() {
    for (const operation of this.operationRegistry.operations) {
      if (
        this.ledgerStore.getActTypeConstitution(
          `${operation.operationName}@1`,
        )
      ) {
        continue;
      }
      this.ledgerStore.registerActTypeConstitution(
        buildLedgerActTypeConstitution({
          actTypeId: operation.operationName,
          operationName: operation.operationName,
          actClass: operation.actClass,
          authorshipKinds: ["semantic_role", "operator"],
          allowedRights: [operation.requiredRight],
          allowedRoleLanes: operation.allowedRoleLanes,
          typedPayloadSchema: "direct_ledger_tool_payload@1",
          canonicalAdmissionCapable: operation.authorityBearing,
          rendererSafeLabel: operation.operationName.replaceAll("_", " "),
          revision: 1,
        }, { now: this.now }),
      );
    }
    const harnessTypes = [
      ["harness_worldmanager_event_observed", "mechanical_witness", "direct_world_manager_event_ledger_adapter_payload@1"],
      ["harness_agent_turn_closed", "mechanical_witness", "direct_turn_closure_envelope@1"],
      ["harness_artifact_lifecycle_transition", "mechanical_witness", "direct_artifact_lifecycle_transition_payload@1"],
      ["harness_canonical_admission_observed", "admission", "direct_canonical_admission_observation_payload@1"],
      ["harness_canonical_admission_failed", "mechanical_witness", "direct_canonical_admission_failure_payload@1"],
    ];
    for (const [actTypeId, actClass, typedPayloadSchema] of harnessTypes) {
      if (
        this.ledgerStore.getActTypeConstitution(
          `${actTypeId}@1`,
        )
      ) {
        continue;
      }
      this.ledgerStore.registerActTypeConstitution(
        buildLedgerActTypeConstitution({
          actTypeId,
          operationName: actTypeId,
          actClass,
          authorshipKinds: ["harness_mechanical"],
          allowedRights: ["observe"],
          allowedRoleLanes: ["harness"],
          typedPayloadSchema,
          defaultEpistemicPosture:
            actClass === "admission" ? "admitted" : "observed",
          defaultAuthorityPosture:
            actClass === "admission"
              ? "canonical_admission_receipt"
              : "descriptive",
          canonicalAdmissionCapable: actClass === "admission",
          rendererSafeLabel: actTypeId.replaceAll("_", " "),
          revision: 1,
        }, { now: this.now }),
      );
    }
  }

  actTypeRef(actTypeId) {
    const constitution = this.ledgerStore.getActTypeConstitution(
      `${actTypeId}@1`,
    );
    if (!constitution) fail("epistemic_fabric_act_type_unknown", actTypeId);
    return ledgerActTypeConstitutionRef(constitution);
  }

  ensureProjectConstitution(projectId) {
    const id = text(projectId, "");
    if (!id) fail("epistemic_fabric_project_id_required");
    const existing = this.artifactState.constitutions.find(
      (entry) => entry.semanticScope?.projectId === id,
    );
    if (existing) return existing;
    const constitution = implementationPatchConstitution(id, this.now);
    this.artifactState.constitutions.push(constitution);
    this.persistArtifacts();
    return constitution;
  }

  ensureProjectStanding(projectId) {
    const id = text(projectId, "");
    const standingId = `project_manager_material:${id}`;
    const existing = this.broker.standings.get(standingId);
    if (existing) return existing;
    const standing = buildNotificationStanding({
      standingId,
      subscriberRoleRef: roleRef("project_manager", id),
      subscriberScope: {
        kind: "project",
        userWorldId: this.userWorldId,
        projectId: id,
      },
      sourceStreamPatterns: [`project:${id}`],
      eventActTypeRefs: [],
      epistemicPostures: [
        "challenged",
        "supported",
        "contradicted",
        "remanded",
        "admitted",
        "stale",
      ],
      objectScopeRefs: [],
      materialityPredicateRef: ref(
        "materiality_policy",
        "project_manager_material",
        { projectId: id },
      ),
      deliveryPolicy: "safe_boundary",
      wakePolicy: "if_material",
      coalescingPolicyRef: ref(
        "coalescing_policy",
        "semantic_scope",
        { projectId: id },
      ),
      evidenceVisibilityPolicyRef: ref(
        "evidence_visibility_policy",
        "project_bounded",
        { projectId: id },
      ),
      operationalPolicy: {
        debounceWindowMs: 250,
        maximumEventsPerDelivery: 24,
        maximumPendingEvents: 256,
        maximumQueuedDeliveries: 64,
        maximumWakeFrequencyMs: 2_000,
        priorityThreshold: "material",
        coalescingKey: "semantic_scope",
        supersessionBehavior: "latest_per_object",
      },
      revision: 1,
    }, { now: this.now });
    this.broker.registerStanding(standing);
    this.persistBroker();
    return standing;
  }

  persistBroker() {
    return this.stateStore.write(
      BROKER_STATE_COMPONENT,
      this.broker.snapshot(),
    );
  }

  persistArtifacts() {
    return this.stateStore.write(
      ARTIFACT_STATE_COMPONENT,
      this.artifactState,
    );
  }

  clearPendingFlushSchedule() {
    if (this.pendingFlushTimer === null) return false;
    this.cancelFlush(this.pendingFlushTimer);
    this.pendingFlushTimer = null;
    this.pendingFlushDueAt = 0;
    return true;
  }

  pendingFlushDueTime() {
    let earliest = 0;
    for (const pending of this.broker.pending.values()) {
      const openedAt = Date.parse(text(pending.openedAt, ""));
      const debounceWindowMs = Number(
        pending.subscription?.operationalPolicy?.debounceWindowMs,
      );
      if (!Number.isFinite(openedAt) || !Number.isFinite(debounceWindowMs)) {
        continue;
      }
      const dueAt = openedAt + Math.max(0, debounceWindowMs);
      if (!earliest || dueAt < earliest) earliest = dueAt;
    }
    return earliest;
  }

  schedulePendingFlush(options = {}) {
    if (this.closed) return false;
    if (!this.broker.pending.size) {
      this.clearPendingFlushSchedule();
      this.pendingFlushRetryDelayMs = 0;
      return false;
    }
    const dueAt = this.pendingFlushDueTime();
    if (!dueAt) return false;
    const force = options.force === true;
    if (force && this.pendingFlushTimer !== null) this.clearPendingFlushSchedule();
    // Keep one runtime-owned timer, but always point it at the earliest
    // currently pending delivery. A later append can introduce a subscription
    // whose deadline precedes the timer that was already installed.
    if (
      !force && this.pendingFlushTimer !== null &&
      this.pendingFlushDueAt > 0 &&
      this.pendingFlushDueAt <= dueAt
    ) {
      return false;
    }
    if (this.pendingFlushTimer !== null) this.clearPendingFlushSchedule();
    const nowMs = Number(this.now()) || Date.now();
    const requestedRetryDelayMs = Number(options.retryDelayMs);
    const retryDelayMs = Number.isFinite(requestedRetryDelayMs)
      ? Math.max(0, requestedRetryDelayMs)
      : Math.max(0, Number(this.pendingFlushRetryDelayMs) || 0);
    this.pendingFlushDueAt = dueAt;
    this.pendingFlushTimer = this.scheduleFlush(() => {
      this.pendingFlushTimer = null;
      this.pendingFlushDueAt = 0;
      if (this.closed) return;
      let flushResult;
      try {
        flushResult = this.flushPendingOutbox();
        this.pendingFlushRetryDelayMs = flushResult.backpressureBlocked ? 250 : 0;
      } catch (_) {
        // A timer callback is a terminal scheduling boundary: preserve the
        // broker/outbox state and retry at the bounded backpressure cadence,
        // without allowing a synchronous flush error to escape the timer.
        this.pendingFlushRetryDelayMs = 250;
      }
      // Flushing broker groups only creates queued deliveries. Join the same
      // coalesced downstream drain used by normal production paths so a group
      // that becomes due while the resident is idle cannot strand in queue.
      this.dispatchQueuedDeliveries().catch(() => {});
      this.schedulePendingFlush();
    }, dueAt > nowMs ? dueAt - nowMs : retryDelayMs);
    return true;
  }

  reconcileRoutedOutbox(entries = []) {
    const deliveries = [
      ...this.broker.deliveries.values(),
    ];
    let dispatched = 0;
    for (const entry of entries) {
      if (!["pending", "retry_pending"].includes(entry.dispatchState)) {
        continue;
      }
      const seed = entry.seed;
      const delivery = deliveries.find((candidate) =>
        candidate.subscriptionRef?.id === seed.subscriptionRef.id &&
        candidate.subscriptionRef?.digest === seed.subscriptionRef.digest &&
        candidate.eventRefs?.some((eventRef) =>
          eventRef.id === seed.ledgerEventRef.id &&
          eventRef.digest === seed.ledgerEventRef.digest));
      if (!delivery) continue;
      this.ledgerStore.markOutboxDispatched(seed.outboxSeedId, {
        kind: "ledger_delivery",
        id: delivery.deliveryId,
        digest: delivery.deliveryDigest,
      });
      dispatched += 1;
    }
    return {
      dispatched,
      pending: entries.length - dispatched,
    };
  }

  flushPendingOutbox() {
    const pending = this.ledgerStore.listPendingOutboxEntries();
    const nowMs = Number(this.now()) || Date.now();
    const dueAt = this.pendingFlushDueTime();
    const flushed = this.broker.flush({ now: this.now });
    // Persist exact broker delivery identities before acknowledging any
    // durable outbox seed. A crash after this write is recovered idempotently
    // by the durable delivery identity on the next bootstrap.
    this.persistBroker();
    if (!pending.length) {
      return { flushed: flushed.deliveries.length, dispatched: 0, pending: 0, backpressureBlocked: false };
    }
    const reconciliation = this.reconcileRoutedOutbox(pending);
    return {
      flushed: flushed.deliveries.length,
      ...reconciliation,
      backpressureBlocked:
        flushed.deliveries.length === 0 &&
        this.broker.pending.size > 0 &&
        dueAt > 0 &&
        dueAt <= nowMs,
    };
  }

  compileRoleTools(input = {}) {
    return compileRoleLedgerToolBundle({
      ...input,
      registry: this.operationRegistry,
      scope: input.scope || {
        kind: input.projectId ? "project" : "user_world",
        userWorldId: this.userWorldId,
        projectId: text(input.projectId, ""),
      },
      // Authority-bearing ledger operations remain absent until they have a
      // dedicated trust-store adapter that validates the exact receipt, scope,
      // and revision vector. Merely having an artifact-admission callback is
      // not sufficient authority for the generic ledger tool family.
      canonicalAdmissionEnabled: false,
      now: this.now,
    });
  }

  resolveArtifactLedgerBinding(input = {}) {
    const authorizationId = text(input.authorizationId, "");
    const authorizationDigest = text(input.authorizationDigest, "");
    const authorization = this.artifactState
      .workThreadDispatchAuthorizations.find((candidate) =>
        candidate.authorizationId === authorizationId &&
        (!authorizationDigest ||
          candidate.authorizationDigest === authorizationDigest));
    if (!authorization) return null;
    validateArtifactWorkThreadStartAuthorization(authorization);
    const assignment = authorization.assignmentKind === "producer"
      ? this.artifactState.producerAssignments.find((candidate) =>
          candidate.assignmentId === authorization.assignmentRef.id)
      : this.artifactState.auditAssignments.find((candidate) =>
          candidate.auditAssignmentId === authorization.assignmentRef.id);
    if (!assignment) return null;
    const lifecycle = this.artifactState.lifecycles.find((candidate) =>
      candidate.lifecycleId === assignment.lifecycleId);
    if (!lifecycle) return null;
    if (authorization.assignmentKind === "producer") {
      validateProducerAssignment(assignment);
      if (!exactRefMatches(
        authorization.assignmentRef,
        producerAssignmentRef(
          assignment,
          lifecycle.subjectScope.projectId,
        ),
      ) || !exactRefMatches(
        authorization.lifecycleRef,
        artifactLifecycleInstanceRef(lifecycle),
      )) return null;
    } else {
      validateAuditAssignment(assignment);
      if (
        assignment.digest !== authorization.assignmentRef.digest ||
        !exactRefMatches(
          assignment.artifactRevisionRef,
          authorization.artifactRevisionRef,
        ) ||
        !exactRefMatches(
          lifecycle.currentArtifactRevisionRef,
          authorization.artifactRevisionRef,
        ) ||
        [
          "remanded",
          "admission_pending",
          "admitted",
          "rejected",
          "superseded",
          "stale",
        ].includes(lifecycle.state)
      ) return null;
    }
    if (
      text(input.roleLane, authorization.assignedRoleKind) !==
        authorization.assignedRoleKind ||
      (input.actorRef && !exactRefMatches(
        input.actorRef,
        authorization.assignedAgentRef,
      ))
    ) {
      return null;
    }
    const binding = {
      schema: "direct_artifact_ledger_invocation_binding@1",
      authorizationRef: {
        kind: "artifact_workthread_start_authorization",
        id: authorization.authorizationId,
        digest: authorization.authorizationDigest,
      },
      lifecycleRef: authorization.lifecycleRef,
      lifecycleId: lifecycle.lifecycleId,
      assignmentKind: authorization.assignmentKind,
      assignmentRef: authorization.assignmentRef,
      artifactRevisionRef: authorization.artifactRevisionRef || null,
      assignedAgentRef: authorization.assignedAgentRef,
      assignedRoleKind: authorization.assignedRoleKind,
      projectId: authorization.projectId,
      workThreadRef: authorization.workThreadRef,
      canonicalEffect: false,
      grantsAuthority: false,
    };
    binding.bindingDigest = digestFor(
      "direct_artifact_ledger_invocation_binding@1",
      binding,
    );
    return binding;
  }

  outboxSeedsForIntent(intent) {
    const descriptor = this.ledgerStore.descriptor();
    const createdAt = new Date(Number(this.now())).toISOString();
    const preview = buildEpistemicLedgerEvent(intent, {
      globalSequence: Number(descriptor.chain?.headSequence || 0) + 1,
      previousLedgerDigest:
        descriptor.chain?.headDigest ||
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      createdAt,
    });
    return this.broker.subscriptions()
      .map((subscription) => ({
        subscription,
        match: matchSubscriptionToEvent(subscription, preview, {
          now: this.now,
        }),
      }))
      .filter((entry) => entry.match)
      .map(({ subscription, match }) => ({
        subscriptionRef: subscriptionRef(subscription),
        recipientRef:
          subscription.subscriberRoleRef || subscription.ownerRoleRef,
        deliveryPolicy: subscription.deliveryPolicy,
        matchReason: match.matchReason,
        materiality: match.materiality,
      }));
  }

  deriveAndStoreContextInvalidations(event) {
    const eventTime = Date.parse(text(event?.createdAt, ""));
    const manifests = this.contextManifestProvider
      ? (this.contextManifestProvider() || []).filter((manifest) => {
          const manifestTime = Date.parse(text(manifest?.createdAt, ""));
          return !Number.isFinite(eventTime) ||
            !Number.isFinite(manifestTime) ||
            manifestTime <= eventTime;
        })
      : [];
    const invalidations = deriveContextInvalidationNotices({
      event,
      manifests,
      visibilityResolver:
        this.contextInvalidationVisibilityResolver || undefined,
    }, { now: this.now });
    let changed = false;
    for (const notice of invalidations) {
      const current = this.artifactState.contextInvalidations.find(
        (entry) =>
          entry.invalidationNoticeId === notice.invalidationNoticeId,
      );
      if (current?.noticeDigest === notice.noticeDigest) continue;
      this.artifactState.contextInvalidations = upsert(
        this.artifactState.contextInvalidations,
        notice,
        "invalidationNoticeId",
      );
      changed = true;
    }
    return { invalidations, changed };
  }

  reconcileContextInvalidations() {
    let afterSequence = 0;
    let reconciled = 0;
    let changed = false;
    for (;;) {
      const events = this.ledgerStore.listEvents({
        afterSequence,
        limit: 10_000,
      });
      if (!events.length) break;
      for (const event of events) {
        const result = this.deriveAndStoreContextInvalidations(event);
        reconciled += result.invalidations.length;
        changed = changed || result.changed;
      }
      afterSequence = Number(events.at(-1)?.globalSequence || afterSequence);
      if (events.length < 10_000) break;
    }
    if (changed) this.persistArtifacts();
    return { reconciled, changed };
  }

  appendIntent(intent) {
    const appended = this.ledgerStore.appendEvent(intent, {
      outboxSeeds: this.outboxSeedsForIntent(intent),
    });
    const entries = this.ledgerStore.listOutboxEntries({
      ledgerEventId: appended.event.ledgerEventId,
    });
    const pendingEntries = entries.filter((entry) =>
      ["pending", "retry_pending"].includes(entry.dispatchState));
    if (
      appended.receipt.appendState === "idempotent_replay" &&
      pendingEntries.length === 0
    ) {
      return {
        ...appended,
        routing: {
          matches: [],
          deliveries: [],
          duplicates: [appended.event.ledgerEventId],
          deferredMatchCount: 0,
          backpressureNotices: [],
          replayedWithoutRedispatch: true,
        },
        invalidations: [],
      };
    }
    const routed = this.broker.routeEvents([appended.event], {
      now: this.now,
      subscriptionIdsByEvent: {
        [appended.event.ledgerEventId]: pendingEntries.map(
          (entry) => entry.seed.subscriptionRef.id,
        ),
      },
    });
    // Persist exact delivery identities before acknowledging the durable
    // outbox. Restart may then retry idempotently, but cannot lose a delivery
    // after its outbox row says it was dispatched.
    this.persistBroker();
    // A bypass or maximum-events flush may consume matches buffered by an
    // earlier append, so reconcile the complete pending outbox, not only the
    // seed belonging to this event.
    this.reconcileRoutedOutbox(this.ledgerStore.listPendingOutboxEntries());
    this.schedulePendingFlush();
    const invalidationResult =
      this.deriveAndStoreContextInvalidations(appended.event);
    const invalidations = invalidationResult.invalidations;
    if (invalidationResult.changed) this.persistArtifacts();
    return { ...appended, routing: routed, invalidations };
  }

  invokeLedgerTool(input = {}) {
    const bundle = input.bundle;
    const decision = decideLedgerToolCall({
      registry: this.operationRegistry,
      bundle,
      operationName: input.operationName,
      arguments: input.arguments,
      currentRevisionByScope: input.currentRevisionByScope,
      visibleEvidenceRefs: input.visibleEvidenceRefs,
      externalAuthorityReceiptPresent: false,
      now: this.now,
    });
    if (!decision.allowed) {
      return { decision, append: null, canonicalEffect: false };
    }
    const operation = this.operationRegistry.operations.find(
      (entry) => entry.operationName === input.operationName,
    );
    const args = input.arguments || {};
    const scope = scopeForKernel(args.subjectScope);
    const epistemicPosture = {
      proposal: "candidate",
      challenge: "challenged",
      assessment: text(args.semanticPayload?.verdict, "") === "supported"
        ? "supported"
        : text(args.semanticPayload?.verdict, "") === "requires_revision"
          ? "remanded"
          : text(args.semanticPayload?.verdict, "") === "contradicted"
            ? "contradicted"
            : text(args.semanticPayload?.verdict, "") === "blocked"
              ? "challenged"
              : "observed",
      admission: "admitted",
      retraction: "superseded",
    }[operation.actClass] || "observed";
    const intent = {
      streamRefs: streamRefsForScope(scope),
      actTypeRef: this.actTypeRef(operation.operationName),
      actClass: operation.actClass,
      authorshipKind: text(input.authorshipKind, "semantic_role"),
      actorRef: bundle.actorRef,
      roleLaneRef: roleRef(bundle.roleLane, scope.projectId),
      agentRunRef: input.agentRunRef || null,
      subjectScope: scope,
      objectRefs: args.objectRefs || [],
      artifactLifecycleRef: args.artifactLifecycleRef || null,
      evidenceRefs: args.evidenceRefs || [],
      affectsRefs: args.affectsRefs || [],
      sourceEventRefs: args.sourceEventRefs || [],
      expectedRevisionVector: (args.expectedRevisionVector || []).map(
        (entry) => ({
          scopeRef: ref(
            text(entry.scopeKind, "semantic_scope"),
            text(entry.scopeId, "scope"),
            { projectId: scope.projectId },
          ),
          revision: Number(entry.revision || 0),
        }),
      ),
      epistemicPosture,
      authorityPosture: operation.authorityBearing
        ? "canonical_admission_receipt"
        : operation.actClass === "proposal"
          ? "proposal_only"
          : "descriptive",
      typedPayloadSchema: "direct_ledger_tool_payload@1",
      typedPayload: clone(args.semanticPayload || {}),
      rendererSafeSummary: text(
        args.rendererSafeSummary,
        input.operationName.replaceAll("_", " "),
      ),
      idempotencyKey: args.idempotencyKey,
      operationScope: input.operationName,
    };
    return {
      decision,
      append: this.appendIntent(intent),
      canonicalEffect: operation.authorityBearing,
    };
  }

  appendHarnessEvent(input = {}) {
    const scope = scopeForKernel(input.subjectScope || {});
    return this.appendIntent({
      streamRefs: streamRefsForScope(scope),
      actTypeRef: this.actTypeRef(input.actTypeId),
      actClass: text(input.actClass, "mechanical_witness"),
      authorshipKind: "harness_mechanical",
      actorRef: ref("harness", "direct_world_manager_harness"),
      roleLaneRef: roleRef("harness", scope.projectId),
      agentRunRef: input.agentRunRef || null,
      subjectScope: scope,
      objectRefs: input.objectRefs || [],
      artifactLifecycleRef: input.artifactLifecycleRef || null,
      evidenceRefs: input.evidenceRefs || [],
      affectsRefs: input.affectsRefs || [],
      sourceEventRefs: input.sourceEventRefs || [],
      expectedRevisionVector: [],
      epistemicPosture: text(input.epistemicPosture, "observed"),
      authorityPosture: text(input.authorityPosture, "descriptive"),
      typedPayloadSchema: input.typedPayloadSchema,
      typedPayload: clone(input.typedPayload || {}),
      rendererSafeSummary: input.rendererSafeSummary,
      idempotencyKey: input.idempotencyKey,
      operationScope: input.actTypeId,
      affectedContextRefs: input.affectedContextRefs || [],
      lifecycleTransitionRefs: input.lifecycleTransitionRefs || [],
    });
  }

  recordWorldManagerEvent(sourceEvent) {
    return this.appendHarnessEvent({
      actTypeId: "harness_worldmanager_event_observed",
      subjectScope: {
        kind: sourceEvent.projectId ? "project" : "user_world",
        userWorldId: this.userWorldId,
        projectId: text(sourceEvent.projectId, ""),
      },
      objectRefs: [{
        kind: "world_manager_semantic_event",
        id: sourceEvent.semanticEventId,
        digest: sourceEvent.eventDigest,
      }],
      sourceEventRefs: [{
        kind: "world_manager_semantic_event",
        id: sourceEvent.semanticEventId,
        digest: sourceEvent.eventDigest,
      }],
      typedPayloadSchema:
        "direct_world_manager_event_ledger_adapter_payload@1",
      typedPayload: {
        eventKind: sourceEvent.eventKind,
        presentationState: sourceEvent.presentationState,
        lineageRootId: sourceEvent.lineageRootId,
        rawEventBodyIncluded: false,
      },
      rendererSafeSummary: `WorldManager event observed: ${sourceEvent.eventKind}`,
      idempotencyKey: `wm-event:${sourceEvent.semanticEventId}:${sourceEvent.eventDigest}`,
    });
  }

  recordAgentResult(input = {}) {
    const result = input.agentResult;
    const finalMessage = input.finalAssistantMessage;
    if (!result?.agentResultId || !result?.digest ||
        !finalMessage?.finalAssistantMessageId || !finalMessage?.digest) {
      fail("epistemic_fabric_agent_result_anchor_required");
    }
    const agentRunRef = (result.evidenceRefs || []).find(
      (entry) => entry.kind === "direct_role_run",
    ) || null;
    const priorRunEvents = agentRunRef
      ? this.ledgerStore.listEvents({ limit: 10_000 }).filter(
          (event) => event.agentRunRef?.id === agentRunRef.id,
        )
      : [];
    const closureAct = priorRunEvents.find(
      (event) => event.actTypeRef.id === "ledger_submit_closure@1",
    );
    return this.appendHarnessEvent({
      actTypeId: "harness_agent_turn_closed",
      subjectScope: {
        kind: text(input.projectId, "") ? "project" : "user_world",
        userWorldId: this.userWorldId,
        projectId: text(input.projectId, ""),
        taskType: text(input.taskType, ""),
      },
      agentRunRef,
      objectRefs: [
        {
          kind: "agent_result",
          id: result.agentResultId,
          digest: result.digest,
        },
        {
          kind: "final_assistant_message",
          id: finalMessage.finalAssistantMessageId,
          digest: finalMessage.digest,
        },
      ],
      evidenceRefs: [
        ...(result.evidenceRefs || []),
        ...(result.telemetryEnvelopeRef
          ? [result.telemetryEnvelopeRef]
          : []),
      ],
      typedPayloadSchema: "direct_turn_closure_envelope@1",
      typedPayload: {
        agentResultRef: {
          kind: "agent_result",
          id: result.agentResultId,
          digest: result.digest,
        },
        finalAssistantMessageRef: {
          kind: "final_assistant_message",
          id: finalMessage.finalAssistantMessageId,
          digest: finalMessage.digest,
        },
        ledgerEventRange: priorRunEvents.length
          ? {
              from: priorRunEvents[0].globalSequence,
              to: priorRunEvents.at(-1).globalSequence,
            }
          : null,
        closureClaimRef: closureAct
          ? epistemicLedgerEventRef(closureAct)
          : null,
        closurePosture: closureAct
          ? "closure_claimed"
          : "closure_unsettled",
        resultState: result.resultState,
        unresolvedObligationRefs:
          result.unresolvedQuestionRefs || [],
        finalProseReinterpretedByHarness: false,
      },
      rendererSafeSummary: closureAct
        ? "Agent turn ended with an exact final message and a typed closure claim."
        : "Agent turn ended with an exact final message; semantic closure remains unsettled.",
      idempotencyKey: `turn-closure:${result.agentResultId}:${result.digest}`,
    });
  }

  activateImplementationPatch(input = {}) {
    const projectId = text(input.projectId, "");
    const constitution = this.ensureProjectConstitution(projectId);
    this.ensureProjectStanding(projectId);
    const initialized = this.lifecycleRuntime.initialize({
      constitution,
      lifecycleId: input.lifecycleId,
      requestRef: input.requestRef,
      subjectScope: {
        kind: text(input.workThreadId, "") ? "workthread" : "project",
        projectId,
        workThreadId: text(input.workThreadId, ""),
        taskType: "implementation",
      },
    });
    const resolved = this.lifecycleRuntime.resolveProducer({
      constitution,
      lifecycle: initialized.lifecycle,
      producerRole: "implementation_worker",
      candidates: input.producerCandidates || [],
    });
    let lifecycle = initialized.lifecycle;
    if (resolved.assignment) {
      lifecycle = this.lifecycleRuntime.applyProducerAssignment({
        constitution,
        lifecycle,
        assignment: resolved.assignment,
      });
      this.artifactState.producerAssignments = upsert(
        this.artifactState.producerAssignments,
        resolved.assignment,
        "assignmentId",
      );
    }
    this.artifactState.lifecycles = upsert(
      this.artifactState.lifecycles,
      lifecycle,
      "lifecycleId",
    );
    this.artifactState.assuranceGraphs = upsert(
      this.artifactState.assuranceGraphs,
      initialized.graph,
      "assuranceGraphId",
    );
    if (Array.isArray(input.auditorCandidates) && input.auditorCandidates.length) {
      const candidateSet = {
        schema: "direct_artifact_lifecycle_auditor_candidate_set@1",
        candidateSetId:
          `artifact_auditor_candidates:${lifecycle.lifecycleId}`,
        lifecycleId: lifecycle.lifecycleId,
        projectId,
        candidates: input.auditorCandidates.map((candidate, index) => ({
          agentRef: exactArtifactRef(
            candidate.agentRef,
            `auditorCandidates[${index}].agentRef`,
          ),
          agentRunRef: candidate.agentRunRef
            ? exactArtifactRef(
                candidate.agentRunRef,
                `auditorCandidates[${index}].agentRunRef`,
              )
            : null,
          role: text(candidate.role, "review_auditor"),
          active: candidate.active !== false,
          substrateAvailable: candidate.substrateAvailable !== false,
          budgetAvailable: candidate.budgetAvailable !== false,
          visibleProjectIds: (Array.isArray(candidate.visibleProjectIds)
            ? candidate.visibleProjectIds
            : []).map((entry) => text(entry, "")).filter(Boolean),
          auditTypes: (Array.isArray(candidate.auditTypes)
            ? candidate.auditTypes
            : []).map((entry) => text(entry, "")).filter(Boolean),
          independenceReceiptRef: exactArtifactRef(
            candidate.independenceReceiptRef,
            `auditorCandidates[${index}].independenceReceiptRef`,
          ),
          boundedCapabilityNames: (Array.isArray(
            candidate.boundedCapabilityNames,
          )
            ? candidate.boundedCapabilityNames
            : []).map((entry) => text(entry, "")).filter(Boolean),
        })),
        canonicalEffect: false,
        grantsAuthority: false,
      };
      candidateSet.digest = digestFor(
        "direct_artifact_lifecycle_auditor_candidate_set@1",
        candidateSet,
      );
      this.artifactState.lifecycleAuditorCandidateSets = upsert(
        this.artifactState.lifecycleAuditorCandidateSets,
        candidateSet,
        "candidateSetId",
      );
    }
    this.artifactState.activeLifecycleId = lifecycle.lifecycleId;
    this.persistArtifacts();
    this.recordLifecycleTransition(lifecycle, "Artifact lifecycle activated.");
    return {
      constitution,
      lifecycle,
      assuranceGraph: initialized.graph,
      producerResolution: resolved.resolution,
      producerAssignment: resolved.assignment,
    };
  }

  async dispatchArtifactAssignment(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    const constitution = this.constitutionForLifecycle(lifecycle);
    const assignment = input.assignment;
    if (!assignment || assignment.lifecycleId !== lifecycle.lifecycleId) {
      fail("epistemic_fabric_workthread_assignment_unknown");
    }
    const authorization = buildArtifactWorkThreadStartAuthorization({
      projectId: lifecycle.subjectScope.projectId,
      workThreadId: lifecycle.subjectScope.workThreadId,
      constitution,
      lifecycle,
      assignment,
      remandObligations: this.artifactState.remandObligations
        .filter((obligation) =>
          obligation.lifecycleRef?.id === lifecycle.lifecycleId &&
          obligation.state === "open")
        .map((obligation) => ({
          obligationRef: {
            kind: "artifact_remand_obligation",
            id: obligation.remandObligationId,
            digest: obligation.digest,
          },
          obligation: obligation.obligation,
        })),
      createdAt: assignment.createdAt,
    });
    const existingAuthorization =
      this.artifactState.workThreadDispatchAuthorizations.find(
        (candidate) =>
          candidate.authorizationId === authorization.authorizationId,
      );
    if (
      existingAuthorization &&
      existingAuthorization.authorizationDigest !==
        authorization.authorizationDigest
    ) {
      fail("epistemic_fabric_workthread_authorization_conflict");
    }
    this.artifactState.workThreadDispatchAuthorizations = upsert(
      this.artifactState.workThreadDispatchAuthorizations,
      existingAuthorization || authorization,
      "authorizationId",
    );
    const priorReceipt = this.artifactState.workThreadDispatchReceipts.find(
      (candidate) =>
        candidate.authorizationRef?.id === authorization.authorizationId &&
        candidate.authorizationRef?.digest ===
          authorization.authorizationDigest &&
        candidate.accepted === true,
    );
    this.persistArtifacts();
    if (priorReceipt) {
      return {
        authorization: existingAuthorization || authorization,
        receipt: priorReceipt,
        reused: true,
      };
    }
    if (!this.artifactWorkThreadDispatchAdapter) {
      return {
        authorization: existingAuthorization || authorization,
        receipt: null,
        reused: false,
        boundary: "artifact_workthread_dispatch_adapter_unavailable",
      };
    }
    const adapterReceipt = await this.artifactWorkThreadDispatchAdapter({
      schema: "direct_artifact_workthread_dispatch_request@1",
      authorization: existingAuthorization || authorization,
      canonicalEffect: false,
      grantsCanonicalAuthority: false,
    });
    const accepted = adapterReceipt?.accepted === true;
    const receipt = {
      schema: "direct_artifact_workthread_dispatch_receipt@1",
      dispatchReceiptId:
        `artifact_workthread_receipt:${authorization.authorizationId}`,
      authorizationRef: {
        kind: "artifact_workthread_start_authorization",
        id: authorization.authorizationId,
        digest: authorization.authorizationDigest,
      },
      assignmentRef: authorization.assignmentRef,
      accepted,
      workerStartTransitionRef:
        adapterReceipt?.workerStartTransitionRef || null,
      workerSessionId: text(adapterReceipt?.workerSessionId, ""),
      workerTurnId: text(adapterReceipt?.workerTurnId, ""),
      workerAgentRunId:
        text(adapterReceipt?.workerSessionId, "") &&
        text(adapterReceipt?.workerTurnId, "")
          ? `${text(adapterReceipt.workerSessionId, "")}:${text(adapterReceipt.workerTurnId, "")}`
          : "",
      authorityMode: text(adapterReceipt?.authorityMode, ""),
      providerCallStarted:
        accepted && adapterReceipt?.providerCallStarted === true,
      workspaceMutationAuthorized: false,
      canonicalEffect: false,
      grantsCanonicalAuthority: false,
      rawProviderPayloadIncluded: false,
      recordedAt: new Date(Number(this.now())).toISOString(),
    };
    receipt.receiptDigest = digestFor(
      "direct_artifact_workthread_dispatch_receipt@1",
      receipt,
    );
    if (accepted) {
      this.artifactState.workThreadDispatchReceipts = upsert(
        this.artifactState.workThreadDispatchReceipts,
        receipt,
        "dispatchReceiptId",
      );
      this.persistArtifacts();
    }
    return {
      authorization: existingAuthorization || authorization,
      receipt,
      reused: false,
    };
  }

  async dispatchProducerAssignment(lifecycleId) {
    const assignment = this.artifactState.producerAssignments.find(
      (candidate) => candidate.lifecycleId === lifecycleId,
    );
    if (!assignment) {
      fail("epistemic_fabric_producer_assignment_unknown", lifecycleId);
    }
    return this.dispatchArtifactAssignment({ lifecycleId, assignment });
  }

  async dispatchAuditAssignments(lifecycleId) {
    const assignments = this.artifactState.auditAssignments.filter(
      (candidate) => candidate.lifecycleId === lifecycleId,
    );
    return Promise.all(assignments.map((assignment) =>
      this.dispatchArtifactAssignment({
        lifecycleId,
        assignment,
      })));
  }

  publishArtifactRevision(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    if (["admission_pending", "admitted", "rejected", "superseded"].includes(
      lifecycle.state,
    )) {
      fail(
        "epistemic_fabric_artifact_revision_transition_forbidden",
        lifecycle.state,
      );
    }
    const constitution = this.constitutionForLifecycle(lifecycle);
    const producerAssignment = this.artifactState.producerAssignments.find(
      (entry) => entry.lifecycleId === lifecycle.lifecycleId,
    );
    const previousRevision = lifecycle.currentArtifactRevisionRef
      ? this.currentArtifactRevision(lifecycle)
      : null;
    const published = this.lifecycleRuntime.publishRevision({
      constitution,
      lifecycle,
      producerAssignment,
      previousRevision,
      priorAuditAssessments: this.artifactState.auditAssessments,
      artifactId: input.artifactId,
      artifactContentRef: input.artifactContentRef,
      evidenceRefs: input.evidenceRefs || [],
      settledProperties: input.settledProperties || {},
    });
    this.artifactState.artifactRevisions.push(published.revision);
    this.artifactState.assuranceGraphs = upsert(
      this.artifactState.assuranceGraphs,
      published.graph,
      "assuranceGraphId",
    );
    this.artifactState.lifecycles = upsert(
      this.artifactState.lifecycles,
      published.lifecycle,
      "lifecycleId",
    );
    this.persistArtifacts();
    this.recordLifecycleTransition(
      published.lifecycle,
      `Artifact revision ${published.revision.revision} registered; required audits are pending.`,
      [artifactRevisionRefFor(published.revision)],
    );
    return published;
  }

  routeArtifactAudits(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    const constitution = this.constitutionForLifecycle(lifecycle);
    const revision = this.currentArtifactRevision(lifecycle);
    const graph = this.assuranceGraphForLifecycle(lifecycle);
    const producerAssignment = this.artifactState.producerAssignments.find(
      (entry) => entry.lifecycleId === lifecycle.lifecycleId,
    );
    const routing = this.lifecycleRuntime.routeAudits({
      constitution,
      lifecycle,
      artifactRevision: revision,
      assuranceGraph: graph,
      producerAssignment,
      candidates: input.auditorCandidates || [],
    });
    for (const assignment of routing.assignments) {
      this.artifactState.auditAssignments = upsert(
        this.artifactState.auditAssignments,
        assignment,
        "auditAssignmentId",
      );
    }
    this.artifactState.auditRoutingPlans = upsert(
      Array.isArray(this.artifactState.auditRoutingPlans)
        ? this.artifactState.auditRoutingPlans
        : [],
      routing.plan,
      "auditRoutingPlanId",
    );
    this.persistArtifacts();
    return routing;
  }

  routeRegisteredArtifactAudits(lifecycleId) {
    const candidateSet = this.artifactState.lifecycleAuditorCandidateSets
      .find((entry) => entry.lifecycleId === lifecycleId);
    return this.routeArtifactAudits({
      lifecycleId,
      auditorCandidates: candidateSet?.candidates || [],
    });
  }

  submitAuditVerdict(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    if (["admission_pending", "admitted", "rejected", "superseded"].includes(
      lifecycle.state,
    )) {
      fail("epistemic_fabric_assurance_mutation_forbidden", lifecycle.state);
    }
    const revision = this.currentArtifactRevision(lifecycle);
    const revisionRef = artifactRevisionRefFor(revision);
    const graph = this.assuranceGraphForLifecycle(lifecycle);
    const assignment = this.artifactState.auditAssignments.find(
      (entry) => entry.auditAssignmentId === input.auditAssignmentId,
    );
    if (!assignment) fail("epistemic_fabric_audit_assignment_unknown");
    if (
      assignment.lifecycleId !== lifecycle.lifecycleId ||
      !exactRefMatches(assignment.artifactRevisionRef, revisionRef) ||
      (text(input.auditAssignmentDigest, "") &&
        input.auditAssignmentDigest !== assignment.digest)
    ) {
      fail("epistemic_fabric_audit_assignment_stale_or_foreign");
    }
    const requirementNode = graph.nodes.find(
      (node) => node.nodeId === assignment.requirementId,
    );
    if (
      !requirementNode ||
      requirementNode.active !== true ||
      requirementNode.requirementKind !== "semantic_audit" ||
      requirementNode.requirement.auditType !== assignment.auditType
    ) {
      fail("epistemic_fabric_audit_assignment_requirement_mismatch");
    }
    const assessment = buildAuditAssessment({
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: revisionRef,
      auditAssignmentRef: {
        kind: "artifact_audit_assignment",
        id: assignment.auditAssignmentId,
        digest: assignment.digest,
        projectId: lifecycle.subjectScope.projectId,
      },
      requirementId: assignment.requirementId,
      verdict: input.verdict,
      findingRefs: input.findingRefs || [],
      remandObligations: input.remandObligations || [],
      evidenceRefs: input.evidenceRefs || [],
      rendererSafeSummary: input.rendererSafeSummary,
      now: this.now,
    });
    this.artifactState.auditAssessments.push(assessment);
    this.persistArtifacts();
    this.revalidateGateAfterEvidenceMutation(lifecycle);
    return assessment;
  }

  joinMechanicalWitness(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    if (["admission_pending", "admitted", "rejected", "superseded"].includes(
      lifecycle.state,
    )) {
      fail("epistemic_fabric_assurance_mutation_forbidden", lifecycle.state);
    }
    const revision = this.currentArtifactRevision(lifecycle);
    const witness = buildMechanicalWitnessJoin({
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: artifactRevisionRefFor(revision),
      requirementId: input.requirementId,
      state: input.state,
      evidenceRefs: input.evidenceRefs || [],
      freshnessWitnessRef: input.freshnessWitnessRef,
      now: this.now,
    });
    this.artifactState.mechanicalWitnesses.push(witness);
    this.persistArtifacts();
    this.revalidateGateAfterEvidenceMutation(lifecycle);
    return witness;
  }

  async ingestArtifactRuntimeEvidence(input = {}) {
    const lifecycleIngestionReceipt = input.receipt || input;
    if (
      lifecycleIngestionReceipt?.ingestionState !== "applied" ||
      lifecycleIngestionReceipt?.transitionKind !==
        "artifact_revision_registered"
    ) {
      return null;
    }
    if (!this.artifactRuntimeEvidenceResolver) {
      return {
        state: "unavailable",
        blockerCodes: ["artifact_runtime_evidence_resolver_unavailable"],
        canonicalEffect: false,
      };
    }
    const lifecycle = this.lifecycle(lifecycleIngestionReceipt.lifecycleId);
    const revision = this.currentArtifactRevision(lifecycle);
    if (!exactRefMatches(
      artifactRevisionRefFor(revision),
      lifecycleIngestionReceipt.transitionRef,
    )) {
      fail("artifact_runtime_evidence_revision_stale");
    }
    const authorization = this.artifactState
      .workThreadDispatchAuthorizations.find((candidate) =>
        candidate.authorizationId ===
          lifecycleIngestionReceipt.authorizationRef?.id &&
        candidate.authorizationDigest ===
          lifecycleIngestionReceipt.authorizationRef?.digest);
    if (!authorization || authorization.assignmentKind !== "producer") {
      fail("artifact_runtime_evidence_authorization_unknown");
    }
    const dispatchReceipt = this.artifactState.workThreadDispatchReceipts.find(
      (candidate) =>
        exactRefMatches(
          candidate.authorizationRef,
          lifecycleIngestionReceipt.authorizationRef,
        ) && candidate.accepted === true,
    );
    if (!dispatchReceipt) {
      fail("artifact_runtime_evidence_dispatch_receipt_unknown");
    }
    const runtimeObservation = await this.artifactRuntimeEvidenceResolver({
      schema: "direct_artifact_runtime_evidence_resolution_request@1",
      projectId: lifecycle.subjectScope.projectId,
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: artifactRevisionRefFor(revision),
      authorization,
      dispatchReceipt,
      canonicalEffect: false,
      grantsAuthority: false,
    });
    const evidenceReceipt = buildArtifactRuntimeEvidenceReceipt({
      projectId: lifecycle.subjectScope.projectId,
      lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      artifactRevisionRef: artifactRevisionRefFor(revision),
      authorization,
      dispatchReceipt,
      runtimeObservation,
      repositoryObservation: runtimeObservation?.repositoryObservation,
      now: this.now,
    });
    const prior = this.artifactState.artifactRuntimeEvidenceReceipts.find(
      (candidate) => candidate.runtimeEvidenceReceiptId ===
        evidenceReceipt.runtimeEvidenceReceiptId,
    );
    if (prior) {
      if (prior.receiptDigest !== evidenceReceipt.receiptDigest) {
        fail("artifact_runtime_evidence_receipt_conflict");
      }
      return { receipt: prior, joins: [], reused: true };
    }
    const currentAfterResolution = this.lifecycle(lifecycle.lifecycleId);
    if (!exactRefMatches(
      currentAfterResolution.currentArtifactRevisionRef,
      artifactRevisionRefFor(revision),
    )) {
      fail("artifact_runtime_evidence_revision_changed_during_resolution");
    }
    const receiptRef = artifactRuntimeEvidenceReceiptRef(evidenceReceipt);
    const joins = evidenceReceipt.requirementDischarges.map((discharge) =>
      buildMechanicalWitnessJoin({
        lifecycleRef: artifactLifecycleInstanceRef(currentAfterResolution),
        artifactRevisionRef: artifactRevisionRefFor(revision),
        requirementId: discharge.requirementId,
        state: discharge.state,
        evidenceRefs: [
          receiptRef,
          ...(discharge.evidenceRefs || []),
        ],
        freshnessWitnessRef: discharge.freshnessWitnessRef,
        now: this.now,
      }));
    this.artifactState.artifactRuntimeEvidenceReceipts.push(evidenceReceipt);
    this.artifactState.mechanicalWitnesses.push(...joins);
    this.persistArtifacts();
    this.revalidateGateAfterEvidenceMutation(currentAfterResolution);
    return {
      receipt: evidenceReceipt,
      joins,
      reused: false,
    };
  }

  revalidateGateAfterEvidenceMutation(lifecycle) {
    if (lifecycle.state !== "gate_ready") return null;
    const gateDecision = this.artifactState.gateDecisions.find((entry) =>
      entry.gateDecisionId === lifecycle.gateDecisionRef?.id &&
      entry.digest === lifecycle.gateDecisionRef?.digest);
    if (!gateDecision) {
      fail("epistemic_fabric_artifact_gate_stale_or_unsupported");
    }
    const candidate = this.artifactState.admissionReceiptCandidates.find(
      (entry) => exactRefMatches(
        entry.gateDecisionRef,
        lifecycle.gateDecisionRef,
      ),
    );
    return this.evaluateArtifactAssurance({
      lifecycleId: lifecycle.lifecycleId,
      targetAdmissionScope: gateDecision.targetAdmissionScope,
      expectedCanonicalRevisionRefs:
        candidate?.expectedCanonicalRevisionRefs || [],
    });
  }

  evaluateArtifactAssurance(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    const constitution = this.constitutionForLifecycle(lifecycle);
    const revision = this.currentArtifactRevision(lifecycle);
    const graph = this.assuranceGraphForLifecycle(lifecycle);
    const targetAdmissionScope =
      input.targetAdmissionScope || lifecycle.subjectScope;
    const expectedCanonicalRevisionRefs =
      Object.prototype.hasOwnProperty.call(
        input,
        "expectedCanonicalRevisionRefs",
      )
        ? input.expectedCanonicalRevisionRefs || []
        : this.canonicalRevisionResolver
          ? this.canonicalRevisionResolver({
              lifecycle,
              artifactRevision: revision,
              targetAdmissionScope,
            })
          : [];
    const evaluated = this.lifecycleRuntime.evaluateAssurance({
      constitution,
      lifecycle,
      artifactRevision: revision,
      assuranceGraph: graph,
      mechanicalWitnesses: this.artifactState.mechanicalWitnesses,
      auditAssessments: this.artifactState.auditAssessments,
      // Remand obligations govern the revision they rejected. The next exact
      // revision supersedes that failed candidate and must earn assurance
      // afresh; old obligations remain immutable history, not permanent
      // blockers on every successor revision.
      remandObligations: this.artifactState.remandObligations.filter(
        (obligation) => exactRefMatches(
          obligation.artifactRevisionRef,
          artifactRevisionRefFor(revision),
        ),
      ),
      authorityResolvable: Boolean(this.authorityAdapter),
      targetAdmissionScope,
      expectedCanonicalRevisionRefs,
      auditDisagreement: input.auditDisagreement === true,
      escalationThresholds: input.escalationThresholds,
    });
    this.artifactState.assuranceGraphs = upsert(
      this.artifactState.assuranceGraphs,
      evaluated.graph,
      "assuranceGraphId",
    );
    this.artifactState.gateDecisions = upsert(
      this.artifactState.gateDecisions,
      evaluated.gateDecision,
      "gateDecisionId",
    );
    if (evaluated.admissionReceiptCandidate) {
      this.artifactState.admissionReceiptCandidates = upsert(
        this.artifactState.admissionReceiptCandidates,
        evaluated.admissionReceiptCandidate,
        "admissionReceiptCandidateId",
      );
    }
    this.artifactState.lifecycles = upsert(
      this.artifactState.lifecycles,
      evaluated.lifecycle,
      "lifecycleId",
    );
    this.persistArtifacts();
    this.recordLifecycleTransition(
      evaluated.lifecycle,
      evaluated.join.gateReady
        ? "All required witnesses and independent audits support the exact artifact revision; admission remains separate."
        : "Artifact assurance remains incomplete or remanded.",
      [artifactRevisionRefFor(revision)],
    );
    return evaluated;
  }

  createArtifactRemand(input = {}) {
    const lifecycle = this.lifecycle(input.lifecycleId);
    const constitution = this.constitutionForLifecycle(lifecycle);
    const revision = this.currentArtifactRevision(lifecycle);
    const revisionRef = artifactRevisionRefFor(revision);
    const remanded = this.lifecycleRuntime.createRemand({
      constitution,
      lifecycle,
      artifactRevision: revision,
      auditAssessments: this.artifactState.auditAssessments.filter(
        (assessment) => exactRefMatches(
          assessment.artifactRevisionRef,
          revisionRef,
        ),
      ),
      remandThreshold: input.remandThreshold,
    });
    this.artifactState.remandRoutings = upsert(
      this.artifactState.remandRoutings,
      remanded.routing,
      "remandRoutingId",
    );
    for (const obligation of remanded.obligations) {
      this.artifactState.remandObligations = upsert(
        this.artifactState.remandObligations,
        obligation,
        "remandObligationId",
      );
    }
    if (remanded.escalation) {
      this.artifactState.escalationCandidates = upsert(
        this.artifactState.escalationCandidates,
        remanded.escalation,
        "escalationCandidateId",
      );
    }
    this.artifactState.lifecycles = upsert(
      this.artifactState.lifecycles,
      remanded.lifecycle,
      "lifecycleId",
    );
    this.persistArtifacts();
    this.recordLifecycleTransition(
      remanded.lifecycle,
      remanded.escalation
        ? "Artifact remand threshold reached; manager authority is required before another producer run."
        : "Artifact revision was remanded with typed obligations and routed back to its producer assignment.",
      [revisionRef],
    );
    return remanded;
  }

  ingestionReceipt(input = {}) {
    const event = input.event;
    const existing = this.artifactState.lifecycleIngestionReceipts.find(
      (entry) => entry.ledgerEventRef?.id === event.ledgerEventId,
    );
    if (existing) return { receipt: existing, reused: true };
    const receipt = {
      schema: "direct_artifact_lifecycle_ingestion_receipt@1",
      ingestionReceiptId:
        `artifact_lifecycle_ingestion:${event.ledgerEventId}`,
      ledgerEventRef: epistemicLedgerEventRef(event),
      authorizationRef: input.binding?.authorizationRef || null,
      assignmentRef: input.binding?.assignmentRef || null,
      lifecycleRef: input.lifecycleRef || input.binding?.lifecycleRef || null,
      lifecycleId:
        text(input.lifecycleId, "") ||
        text(input.binding?.lifecycleId, ""),
      agentRunRef: event.agentRunRef || null,
      operationName: input.operationName,
      ingestionState: input.ingestionState,
      transitionKind: input.transitionKind || "none",
      transitionRef: input.transitionRef || null,
      nextAction: input.nextAction || "none",
      blockerCodes: [...new Set(input.blockerCodes || [])],
      dispatchReceiptObserved: input.dispatchReceiptObserved === true,
      canonicalEffect: false,
      grantsCanonicalAuthority: false,
      workspaceMutationAuthorized: false,
      rawProviderPayloadIncluded: false,
      recordedAt: new Date(Number(this.now())).toISOString(),
    };
    receipt.receiptDigest = digestFor(
      "direct_artifact_lifecycle_ingestion_receipt@1",
      receipt,
    );
    this.artifactState.lifecycleIngestionReceipts = upsert(
      this.artifactState.lifecycleIngestionReceipts,
      receipt,
      "ingestionReceiptId",
    );
    this.persistArtifacts();
    return { receipt, reused: false };
  }

  ingestLifecycleLedgerAct(input = {}) {
    const ledgerToolResult = input.ledgerToolResult || input.result;
    const event = ledgerToolResult?.append?.event;
    const operationName = text(input.operationName, "");
    if (!event || ![
      "ledger_submit_closure",
      "ledger_submit_audit_verdict",
    ].includes(operationName)) {
      return null;
    }
    const payload = isPlainObject(event.typedPayload)
      ? event.typedPayload
      : {};
    if (
      operationName === "ledger_submit_closure" &&
      text(payload.closureKind, "") !== "artifact_candidate"
    ) {
      return null;
    }
    const prior = this.artifactState.lifecycleIngestionReceipts.find(
      (entry) => entry.ledgerEventRef?.id === event.ledgerEventId,
    );
    if (prior) return { receipt: prior, reused: true };
    const binding = isPlainObject(input.artifactLifecycleBinding)
      ? input.artifactLifecycleBinding
      : null;
    const blockers = [];
    if (!binding) {
      blockers.push("artifact_lifecycle_binding_missing");
    } else {
      const bindingValue = { ...binding };
      delete bindingValue.bindingDigest;
      if (
        binding.schema !== "direct_artifact_ledger_invocation_binding@1" ||
        binding.bindingDigest !== digestFor(
          "direct_artifact_ledger_invocation_binding@1",
          bindingValue,
        )
      ) blockers.push("artifact_lifecycle_binding_invalid");
    }
    const resolved = blockers.length
      ? null
      : this.resolveArtifactLedgerBinding({
          authorizationId: binding.authorizationRef?.id,
          authorizationDigest: binding.authorizationRef?.digest,
          actorRef: event.actorRef,
          roleLane: event.roleLaneRef?.id,
        });
    if (!resolved) blockers.push("artifact_lifecycle_binding_stale");
    if (resolved && binding.bindingDigest !== resolved.bindingDigest) {
      blockers.push("artifact_lifecycle_binding_changed");
    }
    if (resolved && (
      event.subjectScope?.projectId !== resolved.projectId ||
      event.subjectScope?.workThreadId !== resolved.workThreadRef.id
    )) {
      blockers.push("artifact_lifecycle_event_scope_mismatch");
    }
    if (!event.agentRunRef?.id || !event.agentRunRef?.digest) {
      blockers.push("artifact_lifecycle_agent_run_missing");
    }
    const dispatchReceipt = resolved
      ? this.artifactState.workThreadDispatchReceipts.find((entry) =>
          exactRefMatches(
            entry.authorizationRef,
            resolved.authorizationRef,
          ))
      : null;
    if (
      dispatchReceipt?.workerAgentRunId &&
      dispatchReceipt.workerAgentRunId !== event.agentRunRef?.id
    ) {
      blockers.push("artifact_lifecycle_agent_run_mismatch");
    }
    if (blockers.length) {
      return this.ingestionReceipt({
        event,
        binding,
        operationName,
        ingestionState: "rejected",
        blockerCodes: blockers,
        dispatchReceiptObserved: Boolean(dispatchReceipt),
      });
    }
    try {
      if (operationName === "ledger_submit_closure") {
        if (resolved.assignmentKind !== "producer") {
          fail("artifact_lifecycle_producer_closure_assignment_mismatch");
        }
        const artifactContentRef = exactArtifactRef(
          payload.artifactContentRef,
          "closure.artifactContentRef",
        );
        const published = this.publishArtifactRevision({
          lifecycleId: resolved.lifecycleId,
          artifactId: text(payload.artifactId, resolved.lifecycleId),
          artifactContentRef,
          evidenceRefs: [
            ...(event.evidenceRefs || []),
            epistemicLedgerEventRef(event),
          ],
          settledProperties: isPlainObject(payload.settledProperties)
            ? payload.settledProperties
            : {},
        });
        return this.ingestionReceipt({
          event,
          binding: resolved,
          lifecycleRef: artifactLifecycleInstanceRef(published.lifecycle),
          operationName,
          ingestionState: "applied",
          transitionKind: "artifact_revision_registered",
          transitionRef: artifactRevisionRefFor(published.revision),
          nextAction: "route_required_audits",
          dispatchReceiptObserved: Boolean(dispatchReceipt),
        });
      }
      if (resolved.assignmentKind !== "auditor") {
        fail("artifact_lifecycle_audit_verdict_assignment_mismatch");
      }
      const assessment = this.submitAuditVerdict({
        lifecycleId: resolved.lifecycleId,
        auditAssignmentId: resolved.assignmentRef.id,
        auditAssignmentDigest: resolved.assignmentRef.digest,
        verdict: text(payload.verdict, ""),
        findingRefs: Array.isArray(payload.findingRefs)
          ? payload.findingRefs
          : [],
        remandObligations: Array.isArray(payload.remandObligations)
          ? payload.remandObligations
          : [],
        evidenceRefs: [
          ...(event.evidenceRefs || []),
          epistemicLedgerEventRef(event),
        ],
        rendererSafeSummary: event.rendererSafeSummary,
      });
      const evaluated = this.evaluateArtifactAssurance({
        lifecycleId: resolved.lifecycleId,
      });
      let nextAction = "await_assurance_inputs";
      let transitionKind = "audit_assessment_registered";
      let transitionRef = {
        kind: "artifact_audit_assessment",
        id: assessment.auditAssessmentId,
        digest: assessment.digest,
      };
      let lifecycle = evaluated.lifecycle;
      if (assessment.verdict === "requires_revision") {
        const remanded = this.createArtifactRemand({
          lifecycleId: resolved.lifecycleId,
        });
        lifecycle = remanded.lifecycle;
        transitionKind = remanded.escalation
          ? "artifact_escalation_required"
          : "artifact_revision_remanded";
        transitionRef = remanded.escalation
          ? {
              kind: "artifact_escalation_candidate",
              id: remanded.escalation.escalationCandidateId,
              digest: remanded.escalation.digest,
            }
          : {
              kind: "artifact_remand_routing",
              id: remanded.routing.remandRoutingId,
              digest: remanded.routing.digest,
            };
        nextAction = remanded.routing.routeToProducer
          ? "redispatch_producer"
          : "wake_manager_for_escalation";
      }
      return this.ingestionReceipt({
        event,
        binding: resolved,
        lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
        operationName,
        ingestionState: "applied",
        transitionKind,
        transitionRef,
        nextAction,
        dispatchReceiptObserved: Boolean(dispatchReceipt),
      });
    } catch (error) {
      return this.ingestionReceipt({
        event,
        binding: resolved || binding,
        operationName,
        ingestionState: "rejected",
        blockerCodes: [
          error?.code || error?.message ||
            "artifact_lifecycle_ingestion_failed",
        ],
        dispatchReceiptObserved: Boolean(dispatchReceipt),
      });
    }
  }

  async automateLifecycleIngestion(ingestion = null) {
    const receipt = ingestion?.receipt;
    const nextAction = receipt?.nextAction || "none";
    if (nextAction === "route_required_audits") {
      let runtimeEvidence = null;
      try {
        runtimeEvidence = await this.ingestArtifactRuntimeEvidence(receipt);
      } catch (error) {
        runtimeEvidence = {
          state: "failed_visible",
          blockerCodes: [
            error?.code || error?.message ||
              "artifact_runtime_evidence_ingestion_failed",
          ],
          canonicalEffect: false,
        };
      }
      const routing = this.routeRegisteredArtifactAudits(
        receipt.lifecycleId,
      );
      const dispatches = routing.assignments?.length
        ? await this.dispatchAuditAssignments(receipt.lifecycleId)
        : [];
      return {
        action: nextAction,
        runtimeEvidence,
        routingPlan: routing.plan,
        dispatches,
        unresolved: routing.plan?.unresolved || [],
      };
    }
    if (nextAction === "redispatch_producer") {
      return {
        action: nextAction,
        producerDispatch: await this.dispatchProducerAssignment(
          receipt.lifecycleId,
        ),
      };
    }
    if (nextAction === "wake_manager_for_escalation") {
      return {
        action: nextAction,
        managerWakeDelegatedToLedgerStanding: true,
      };
    }
    return null;
  }

  async requestArtifactAdmission(input = {}) {
    let lifecycle = this.lifecycle(input.lifecycleId);
    if (lifecycle.state === "admitted") {
      const existing = this.artifactState.admissionReceipts.find((receipt) =>
        receipt.receiptPosture === "admitted" &&
        receipt.admitted === true &&
        receipt.lifecycleRef?.digest === lifecycle.digest);
      if (!existing) {
        fail("epistemic_fabric_admitted_receipt_missing");
      }
      return { lifecycle, receipt: existing, reused: true };
    }
    const resumingPending = lifecycle.state === "admission_pending";
    if (lifecycle.state !== "gate_ready" && !resumingPending) {
      fail("epistemic_fabric_artifact_not_gate_ready", lifecycle.state);
    }
    if (!this.authorityAdapter) {
      fail("epistemic_fabric_canonical_authority_adapter_unavailable");
    }
    const constitution = this.constitutionForLifecycle(lifecycle);
    const revision = this.currentArtifactRevision(lifecycle);
    const revisionRef = artifactRevisionRefFor(revision);
    const graph = this.assuranceGraphForLifecycle(lifecycle);
    const gateDecision = this.artifactState.gateDecisions.find(
      (entry) =>
        entry.gateDecisionId === lifecycle.gateDecisionRef?.id &&
        entry.digest === lifecycle.gateDecisionRef?.digest,
    );
    const admissionCandidate = this.artifactState.admissionReceiptCandidates.find(
      (entry) => exactRefMatches(
        entry.gateDecisionRef,
        lifecycle.gateDecisionRef,
      ),
    );
    if (
      !gateDecision ||
      !admissionCandidate ||
      gateDecision.decisionState !== "gate_ready" ||
      gateDecision.assuranceSupported !== true ||
      gateDecision.authorityResolvable !== true ||
      gateDecision.blockerCodes?.length ||
      !exactRefMatches(lifecycle.currentArtifactRevisionRef, revisionRef) ||
      !exactRefMatches(gateDecision.artifactRevisionRef, revisionRef) ||
      !exactRefMatches(admissionCandidate.artifactRevisionRef, revisionRef) ||
      !exactRefMatches(
        admissionCandidate.gateDecisionRef,
        lifecycle.gateDecisionRef,
      ) ||
      !exactAdmissionScopeMatches(
        admissionCandidate.targetAdmissionScope,
        gateDecision.targetAdmissionScope,
      ) ||
      !exactRefMatches(gateDecision.assuranceGraphRef, lifecycle.assuranceGraphRef) ||
      graph.joinState !== "supported" ||
      !exactRefMatches(
        lifecycle.assuranceGraphRef,
        {
          kind: "artifact_assurance_graph",
          id: graph.assuranceGraphId,
          digest: graph.digest,
          projectId: lifecycle.subjectScope.projectId,
        },
      )
    ) {
      fail("epistemic_fabric_artifact_gate_stale_or_unsupported");
    }
    if (
      Object.prototype.hasOwnProperty.call(
        input,
        "expectedCanonicalRevisionRefs",
      ) &&
      !exactRefVectorMatches(
        input.expectedCanonicalRevisionRefs,
        admissionCandidate.expectedCanonicalRevisionRefs,
      )
    ) {
      fail("epistemic_fabric_admission_revision_vector_mismatch");
    }
    const expectedCanonicalRevisionRefs =
      admissionCandidate.expectedCanonicalRevisionRefs;
    let actorRef;
    let pending;
    let pendingReceipt;
    if (resumingPending) {
      pending = lifecycle;
      pendingReceipt = [...this.artifactState.admissionReceipts]
        .reverse()
        .find((receipt) =>
          receipt.receiptPosture === "pending" &&
          receipt.lifecycleRef?.digest === pending.digest &&
          exactRefMatches(receipt.artifactRevisionRef, revisionRef) &&
          exactRefMatches(receipt.gateDecisionRef, pending.gateDecisionRef));
      if (!pendingReceipt) {
        fail("epistemic_fabric_admission_pending_receipt_missing");
      }
      actorRef = exactArtifactRef(
        pendingReceipt.actorRef,
        "pendingAdmission.actorRef",
      );
      if (
        input.actorRef &&
        !exactRefMatches(actorRef, input.actorRef)
      ) {
        fail("epistemic_fabric_admission_actor_mismatch");
      }
      if (!exactRefVectorMatches(
        pendingReceipt.expectedCanonicalRevisionRefs,
        expectedCanonicalRevisionRefs,
      )) {
        fail("epistemic_fabric_admission_pending_revision_mismatch");
      }
    } else {
      actorRef = exactArtifactRef(
        input.actorRef,
        "artifactAdmission.actorRef",
      );
      pending = reviseArtifactLifecycleInstance(lifecycle, {
        constitution,
        state: "admission_pending",
        now: this.now,
      });
      const admissionAttemptId = `artifact_admission_attempt_${digestFor(
        "direct_artifact_admission_attempt_id@1",
        {
          lifecycleId: lifecycle.lifecycleId,
          artifactRevisionRef: revisionRef,
          gateDecisionRef: lifecycle.gateDecisionRef,
          actorRef,
          expectedCanonicalRevisionRefs,
        },
      ).slice(7, 31)}`;
      pendingReceipt = {
        schema: "direct_artifact_admission_receipt@1",
        admissionReceiptId: `${admissionAttemptId}_pending`,
        admissionAttemptId,
        lifecycleRef: artifactLifecycleInstanceRef(pending),
        artifactRevisionRef: artifactRevisionRefFor(revision),
        gateDecisionRef: pending.gateDecisionRef,
        actorRef,
        expectedCanonicalRevisionRefs: clone(
          expectedCanonicalRevisionRefs,
        ),
        targetAdmissionScope: clone(
          gateDecision.targetAdmissionScope,
        ),
        receiptPosture: "pending",
        admitted: false,
        canonicalEffect: false,
        createdAt: new Date(Number(this.now())).toISOString(),
      };
      pendingReceipt.digest = digestFor(
        "direct_artifact_admission_receipt@1",
        pendingReceipt,
      );
      this.artifactState.lifecycles = upsert(
        this.artifactState.lifecycles,
        pending,
        "lifecycleId",
      );
      this.artifactState.admissionReceipts = upsert(
        this.artifactState.admissionReceipts,
        pendingReceipt,
        "admissionReceiptId",
      );
      this.persistArtifacts();
    }
    let authorityResult;
    try {
      authorityResult = await this.authorityAdapter({
        lifecycle: pending,
        artifactRevision: revision,
        gateDecision,
        actorRef,
        expectedCanonicalRevisionRefs,
        admissionAttemptRef: {
          kind: "artifact_admission_attempt",
          id: pendingReceipt.admissionAttemptId,
          digest: pendingReceipt.digest,
          projectId: pending.subjectScope.projectId,
        },
      });
    } catch (error) {
      authorityResult = {
        admitted: false,
        failureCode:
          error?.code || "canonical_admission_adapter_failed",
      };
    }
    const lifecycleAfterAuthority = this.lifecycle(input.lifecycleId);
    if (
      !exactRefMatches(
        artifactLifecycleInstanceRef(lifecycleAfterAuthority),
        artifactLifecycleInstanceRef(pending),
      )
    ) {
      fail("epistemic_fabric_admission_transition_changed_during_authority_call");
    }
    if (
      authorityResult?.admitted === true &&
      !exactAdmissionScopeMatches(
        authorityResult.targetAdmissionScope,
        gateDecision.targetAdmissionScope,
      )
    ) {
      authorityResult = {
        ...authorityResult,
        admitted: false,
        failureCode: "canonical_admission_scope_mismatch",
      };
    }
    if (
      authorityResult?.admitted !== true ||
      !authorityResult?.trustStoreReceiptRef?.id ||
      !authorityResult?.trustStoreReceiptRef?.digest
    ) {
      const failureCode = text(
        authorityResult?.failureCode,
        "canonical_admission_receipt_missing",
      );
      const failure = {
        schema: "direct_artifact_admission_receipt@1",
        admissionReceiptId:
          `${pendingReceipt.admissionAttemptId}_${
            /stale.*cas|stale.*revision|stale.*scope/i.test(failureCode)
              ? "stale_cas"
              : "failed"}`,
        admissionAttemptId: pendingReceipt.admissionAttemptId,
        lifecycleRef: artifactLifecycleInstanceRef(pending),
        artifactRevisionRef: artifactRevisionRefFor(revision),
        gateDecisionRef: pending.gateDecisionRef,
        pendingReceiptRef: {
          kind: "artifact_admission_receipt",
          id: pendingReceipt.admissionReceiptId,
          digest: pendingReceipt.digest,
          projectId: pending.subjectScope.projectId,
        },
        actorRef,
        expectedCanonicalRevisionRefs: clone(expectedCanonicalRevisionRefs),
        targetAdmissionScope: clone(gateDecision.targetAdmissionScope),
        receiptPosture:
          /stale.*cas|stale.*revision|stale.*scope/i.test(failureCode)
            ? "stale_cas"
            : "failed",
        failureCode,
        admitted: false,
        canonicalEffect: false,
        createdAt: new Date(Number(this.now())).toISOString(),
      };
      failure.digest = digestFor(
        "direct_artifact_admission_receipt@1",
        failure,
      );
      this.artifactState.admissionReceipts = upsert(
        this.artifactState.admissionReceipts,
        failure,
        "admissionReceiptId",
      );
      this.persistArtifacts();
      this.appendHarnessEvent({
        actTypeId: "harness_canonical_admission_failed",
        actClass: "mechanical_witness",
        subjectScope: pending.subjectScope,
        objectRefs: [artifactRevisionRefFor(revision)],
        artifactLifecycleRef: artifactLifecycleInstanceRef(pending),
        evidenceRefs: [failure.pendingReceiptRef],
        epistemicPosture:
          failure.receiptPosture === "stale_cas"
            ? "stale"
            : "observed",
        authorityPosture: "descriptive",
        typedPayloadSchema:
          "direct_canonical_admission_failure_payload@1",
        typedPayload: {
          admissionFailureReceiptRef: {
            kind: "artifact_admission_receipt",
            id: failure.admissionReceiptId,
            digest: failure.digest,
            projectId: pending.subjectScope.projectId,
          },
          failureCode,
          targetAdmissionScope: failure.targetAdmissionScope,
        },
        rendererSafeSummary:
          "Canonical artifact admission failed closed; no canonical standing was inferred.",
        idempotencyKey:
          `artifact-admission-failed:${failure.admissionReceiptId}:${failure.digest}`,
      });
      return {
        lifecycle: pending,
        receipt: failure,
        pendingReceipt,
      };
    }
    const admitted = reviseArtifactLifecycleInstance(pending, {
      constitution,
      state: "admitted",
      now: this.now,
    });
    const receipt = {
      schema: "direct_artifact_admission_receipt@1",
      admissionReceiptId: `artifact_admission_${admitted.lifecycleId}_${admitted.lifecycleRevision}`,
      lifecycleRef: artifactLifecycleInstanceRef(admitted),
      artifactRevisionRef: artifactRevisionRefFor(revision),
      gateDecisionRef: admitted.gateDecisionRef,
      expectedCanonicalRevisionRefs: clone(expectedCanonicalRevisionRefs),
      admissionAttemptId: pendingReceipt.admissionAttemptId,
      pendingReceiptRef: {
        kind: "artifact_admission_receipt",
        id: pendingReceipt.admissionReceiptId,
        digest: pendingReceipt.digest,
        projectId: admitted.subjectScope.projectId,
      },
      actorRef,
      trustStoreReceiptRef: clone(authorityResult.trustStoreReceiptRef),
      canonicalGraphRef: authorityResult.canonicalGraphRef
        ? clone(authorityResult.canonicalGraphRef)
        : null,
      targetAdmissionScope: clone(gateDecision.targetAdmissionScope),
      receiptPosture: "admitted",
      admitted: true,
      canonicalEffect: true,
      createdAt: new Date(Number(this.now())).toISOString(),
    };
    receipt.digest = digestFor(
      "direct_artifact_admission_receipt@1",
      receipt,
    );
    this.artifactState.admissionReceipts = upsert(
      this.artifactState.admissionReceipts,
      receipt,
      "admissionReceiptId",
    );
    this.artifactState.lifecycles = upsert(
      this.artifactState.lifecycles,
      admitted,
      "lifecycleId",
    );
    this.persistArtifacts();
    this.appendHarnessEvent({
      actTypeId: "harness_canonical_admission_observed",
      actClass: "admission",
      subjectScope: admitted.subjectScope,
      objectRefs: [artifactRevisionRefFor(revision)],
      artifactLifecycleRef: artifactLifecycleInstanceRef(admitted),
      evidenceRefs: [authorityResult.trustStoreReceiptRef],
      epistemicPosture: "admitted",
      authorityPosture: "canonical_admission_receipt",
      typedPayloadSchema:
        "direct_canonical_admission_observation_payload@1",
      typedPayload: {
        admissionReceiptRef: {
          kind: "artifact_admission_receipt",
          id: receipt.admissionReceiptId,
          digest: receipt.digest,
        },
        trustStoreReceiptRef: authorityResult.trustStoreReceiptRef,
        targetAdmissionScope: receipt.targetAdmissionScope,
      },
      rendererSafeSummary:
        "Canonical artifact admission was observed through an exact trust-store receipt.",
      idempotencyKey: `artifact-admitted:${receipt.admissionReceiptId}:${receipt.digest}`,
    });
    return { lifecycle: admitted, receipt };
  }

  recordLifecycleTransition(lifecycle, summary, objectRefs = []) {
    return this.appendHarnessEvent({
      actTypeId: "harness_artifact_lifecycle_transition",
      subjectScope: lifecycle.subjectScope,
      objectRefs,
      artifactLifecycleRef: artifactLifecycleInstanceRef(lifecycle),
      epistemicPosture:
        lifecycle.state === "remanded"
          ? "remanded"
          : lifecycle.state === "gate_ready"
            ? "supported"
            : lifecycle.state === "admitted"
              ? "admitted"
              : "observed",
      typedPayloadSchema:
        "direct_artifact_lifecycle_transition_payload@1",
      typedPayload: {
        lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
        state: lifecycle.state,
        canonical: lifecycle.state === "admitted",
      },
      rendererSafeSummary: summary,
      idempotencyKey: `artifact-lifecycle:${lifecycle.lifecycleId}:${lifecycle.lifecycleRevision}:${lifecycle.digest}`,
      lifecycleTransitionRefs: [artifactLifecycleInstanceRef(lifecycle)],
    });
  }

  lifecycle(lifecycleId) {
    const lifecycle = this.artifactState.lifecycles.find(
      (entry) => entry.lifecycleId === lifecycleId,
    );
    if (!lifecycle) fail("epistemic_fabric_artifact_lifecycle_unknown", lifecycleId);
    return lifecycle;
  }

  constitutionForLifecycle(lifecycle) {
    const constitution = this.artifactState.constitutions.find(
      (entry) =>
        artifactTypeConstitutionRef(entry).id ===
          lifecycle.artifactTypeConstitutionRef.id &&
        artifactTypeConstitutionRef(entry).digest ===
          lifecycle.artifactTypeConstitutionRef.digest,
    );
    if (!constitution) fail("epistemic_fabric_artifact_constitution_unknown");
    return constitution;
  }

  currentArtifactRevision(lifecycle) {
    const revision = this.artifactState.artifactRevisions.find(
      (entry) =>
        entry.artifactRevisionId === lifecycle.currentArtifactRevisionRef?.id,
    );
    if (
      !revision ||
      !exactRefMatches(
        lifecycle.currentArtifactRevisionRef,
        artifactRevisionRefFor(revision),
      )
    ) {
      fail("epistemic_fabric_artifact_revision_unknown");
    }
    return revision;
  }

  assuranceGraphForLifecycle(lifecycle) {
    const graph = this.artifactState.assuranceGraphs.find(
      (entry) =>
        entry.assuranceGraphId === lifecycle.assuranceGraphRef.id &&
        entry.digest === lifecycle.assuranceGraphRef.digest,
    );
    if (!graph) fail("epistemic_fabric_assurance_graph_unknown");
    return graph;
  }

  acknowledgeDelivery(deliveryId, input = {}) {
    const delivery = this.broker.deliveries.get(deliveryId);
    if (!delivery) fail("epistemic_fabric_delivery_unknown", deliveryId);
    if (
      !["delivered", "acknowledged"].includes(
        delivery.deliveryPosture,
      )
    ) {
      fail(
        "epistemic_fabric_delivery_not_delivered",
        delivery.deliveryPosture,
      );
    }
    const result = this.broker.acknowledge(deliveryId, input);
    this.persistBroker();
    return result;
  }

  importNativeLedgerContext(adapterRequest = {}) {
    if (
      adapterRequest.schema !==
        "direct_ledger_import_context_adapter_request@1" ||
      adapterRequest.operation !== "IMPORT_CONTEXT" ||
      adapterRequest.rawPayloadIncluded !== false ||
      adapterRequest.grantsAuthority !== false
    ) {
      fail("epistemic_fabric_native_context_request_invalid");
    }
    const request = adapterRequest.hydrationRequest || {};
    const delivery = adapterRequest.delivery || {};
    if (
      request.deliveryRef?.id !== delivery.deliveryId ||
      request.deliveryRef?.digest !== delivery.deliveryDigest
    ) {
      fail("epistemic_fabric_native_context_delivery_mismatch");
    }
    const eventRefs = [];
    for (const eventRef of request.eventRefs || []) {
      const event = this.ledgerStore.getEvent(eventRef.id);
      const observedRef = event ? epistemicLedgerEventRef(event) : null;
      if (
        !observedRef ||
        observedRef.kind !== eventRef.kind ||
        observedRef.id !== eventRef.id ||
        observedRef.digest !== eventRef.digest
      ) {
        fail(
          "epistemic_fabric_native_context_event_revision_unknown",
          eventRef.id,
        );
      }
      eventRefs.push(eventRef);
    }
    const projectedEventIds = new Set(
      (delivery.boundedProjection?.entries || []).map((entry) =>
        text(entry.eventRef?.id, "")),
    );
    if (eventRefs.some((eventRef) => !projectedEventIds.has(eventRef.id))) {
      fail("epistemic_fabric_native_context_projection_widening");
    }
    const selectedObjectRefs = clone(request.requestedObjectRefs || []);
    const selectedEvidenceRefs = clone(
      request.requestedEvidenceRefs || [],
    );
    const bundleRef = ref(
      "semantic_context_bundle",
      `ledger_delivery_bundle:${delivery.deliveryId}`,
      {
        hydrationRequestId: request.hydrationRequestId,
        eventRefs,
        selectedObjectRefs,
        selectedEvidenceRefs,
      },
    );
    const selectionWitnessRef = ref(
      "semantic_context_selection_witness",
      `ledger_delivery_selection:${delivery.deliveryId}`,
      {
        hydrationRequestId: request.hydrationRequestId,
        visibilityPolicyRef: request.visibilityPolicyRef,
        selectedObjectRefs,
        selectedEvidenceRefs,
        withheldEvidenceCount:
          Number(delivery.boundedProjection?.withheldEvidenceCount || 0),
      },
    );
    return {
      schema: "direct_native_ledger_context_import_result@1",
      bundleRef,
      selectionWitnessRef,
      selectedObjectRefs,
      selectedEvidenceRefs,
      omittedRefs: [],
      omittedCounts: {
        withheldEvidence:
          Number(delivery.boundedProjection?.withheldEvidenceCount || 0),
      },
      freshness: "fresh",
      importedEventRefs: eventRefs,
      semanticSummaries:
        (delivery.boundedProjection?.entries || []).map((entry) => ({
          eventRef: entry.eventRef,
          semanticSummary: text(
            entry.semanticSummary,
            "Bounded ledger event available.",
          ),
        })),
      canonicalEffect: false,
      grantsAuthority: false,
      rawPayloadIncluded: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }

  async dispatchQueuedDeliveries() {
    if (this.closed) {
      return {
        attempted: 0,
        delivered: 0,
        deferred: 0,
        boundary: "runtime_closed_before_delivery_drain",
      };
    }
    if (!this.contextImporter || !this.deliveryTargetResolver) {
      return {
        attempted: 0,
        delivered: 0,
        deferred: 0,
        boundary: "runtime_delivery_dependencies_unavailable",
      };
    }
    if (this.deliveryDrainPromise) return this.deliveryDrainPromise;
    this.deliveryDrainPromise = (async () => {
      let attempted = 0;
      let delivered = 0;
      let deferred = 0;
      const failures = [];
      const queued = [...this.broker.deliveries.values()].filter(
        (delivery) => delivery.deliveryPosture === "queued",
      );
      for (const delivery of queued) {
        if (this.closed) {
          deferred += 1;
          continue;
        }
        const subscription = this.broker.subscriptions().find((candidate) => {
          const candidateRef = subscriptionRef(candidate);
          return candidateRef.id === delivery.subscriptionRef.id &&
            candidateRef.digest === delivery.subscriptionRef.digest;
        });
        if (!subscription) {
          deferred += 1;
          continue;
        }
        const target = await this.deliveryTargetResolver({
          delivery,
          subscription,
        });
        if (this.closed) {
          deferred += 1;
          continue;
        }
        if (!target?.targetAgentRef) {
          deferred += 1;
          continue;
        }
        attempted += 1;
        try {
          const result = await this.importDeliveryContext(
            delivery.deliveryId,
            target,
          );
          if (["delivered", "acknowledged"].includes(
            result.delivery?.deliveryPosture,
          )) {
            delivered += 1;
          } else {
            deferred += 1;
          }
        } catch (error) {
          deferred += 1;
          failures.push({
            deliveryId: delivery.deliveryId,
            errorCode: text(error?.code, "delivery_dispatch_failed"),
          });
        }
      }
      return {
        attempted,
        delivered,
        deferred,
        failures,
        boundary: "bounded_role_delivery_drain",
      };
    })().finally(() => {
      this.deliveryDrainPromise = null;
    });
    return this.deliveryDrainPromise;
  }

  async importDeliveryContext(deliveryId, input = {}) {
    let delivery = this.broker.deliveries.get(deliveryId);
    if (!delivery) fail("epistemic_fabric_delivery_unknown", deliveryId);
    const closedResult = (admission = null, dispatch = null) => ({
      schema: "direct_epistemic_delivery_context_import_result@1",
      delivery,
      admission,
      dispatch,
      dispatchReceipt: null,
      deliveryTransition: "runtime_closed",
      runtimeDispatchStarted: false,
      wakeStarted: false,
      productionDispatchBoundary: "runtime_closed_before_delivery_effect",
      canonicalEffect: false,
      grantsAuthority: false,
    });
    if (this.closed) return closedResult();
    const priorAdmission = this.artifactState.contextAdmissions
      .slice()
      .reverse()
      .find((candidate) =>
        candidate.deliveryRef?.id === delivery.deliveryId &&
        candidate.safeForPromptProjection === true);
    const priorDispatch = priorAdmission
      ? this.artifactState.contextDispatches
          .slice()
          .reverse()
          .find((candidate) =>
            candidate.deliveryRef?.id === delivery.deliveryId &&
            candidate.contextAdmissionRef?.id ===
              priorAdmission.contextAdmissionId)
      : null;
    const priorDispatchReceipt = priorDispatch
      ? this.artifactState.contextDispatchReceipts
          .slice()
          .reverse()
          .find((candidate) =>
            candidate.dispatchRef?.id === priorDispatch.dispatchId &&
            candidate.dispatchRef?.digest === priorDispatch.dispatchDigest &&
            candidate.accepted === true)
      : null;
    if (["delivered", "acknowledged"].includes(delivery.deliveryPosture)) {
      if (!priorAdmission) {
        fail(
          "epistemic_fabric_completed_delivery_context_unknown",
          deliveryId,
        );
      }
      return {
        schema: "direct_epistemic_delivery_context_import_result@1",
        delivery,
        admission: priorAdmission,
        dispatch: priorDispatch,
        dispatchReceipt: priorDispatchReceipt,
        deliveryTransition: "already_delivered",
        runtimeDispatchStarted: false,
        wakeStarted: false,
        productionDispatchBoundary: "idempotent_delivery_replay",
        canonicalEffect: false,
        grantsAuthority: false,
      };
    }
    const subscription = this.broker.subscriptions().find((candidate) =>
      subscriptionRef(candidate).id === delivery.subscriptionRef.id);
    const visibilityPolicyRef =
      input.visibilityPolicyRef ||
      subscription?.evidenceVisibilityPolicyRef;
    if (!visibilityPolicyRef) {
      fail(
        "epistemic_fabric_delivery_visibility_policy_unknown",
        deliveryId,
      );
    }
    const admission = priorAdmission ||
      await hydrateLedgerDeliveryAsync({
        delivery,
        visibilityPolicyRef,
        requestedObjectRefs:
          input.requestedObjectRefs ||
          delivery.boundedProjection?.visibleObjectRefs,
        requestedEvidenceRefs:
          input.requestedEvidenceRefs ||
          delivery.boundedProjection?.visibleEvidenceRefs,
        importContext: input.contextImporter || this.contextImporter,
        recipientContext: input.recipientContext || {},
        maxInputTokens:
          input.maxInputTokens || input.contextBudget?.maxInputTokens,
      }, { now: this.now });
    if (this.closed) return closedResult(admission);
    this.artifactState.contextAdmissions = upsert(
      this.artifactState.contextAdmissions,
      admission,
      "contextAdmissionId",
    );

    let dispatch = null;
    let dispatchReceipt = null;
    let runtimeDispatchStarted = false;
    let wakeStarted = false;
    let deliveryTransition = "queued_awaiting_context";
    let productionDispatchBoundary = this.contextImporter || input.contextImporter
      ? "context_import_failed_or_pending"
      : "context_importer_unavailable";

    if (admission.safeForPromptProjection) {
      const targetAgentRef =
        input.targetAgentRef || delivery.recipientAgentRef;
      const runPosture = text(input.runPosture, "idle_role_resident");
      if (targetAgentRef) {
        const queuedSafeBoundaryDispatch = priorDispatch?.disposition ===
          "safe_boundary_queued" && !priorDispatchReceipt
          ? priorDispatch
          : null;
        const candidateDispatch = queuedSafeBoundaryDispatch ||
          adaptLedgerDeliveryToContinuation({
            delivery,
            contextAdmission: admission,
            targetAgentRef,
            targetAgentRunRef:
              input.targetAgentRunRef || delivery.recipientAgentRunRef,
            runPosture,
            suspension: input.suspension,
            newRunAuthorized: input.newRunAuthorized === true,
            allocatedAgentRunRef: input.allocatedAgentRunRef,
            wakePolicyRef: input.wakePolicyRef,
          }, { now: this.now });
        dispatch = queuedSafeBoundaryDispatch ||
          this.artifactState.contextDispatches.find(
            (candidate) =>
              candidate.dispatchId === candidateDispatch.dispatchId,
          ) || candidateDispatch;
        this.artifactState.contextDispatches = upsert(
          this.artifactState.contextDispatches,
          dispatch,
          "dispatchId",
        );
      }

      // Persist the exact admission and dispatch identity before crossing the
      // external runtime boundary. If the process stops after acceptance but
      // before broker delivery persistence, retry uses the same dispatchId.
      this.persistArtifacts();

      if (
        dispatch &&
        dispatch.disposition !== "semantic_inbox_only" &&
        this.deliveryDispatchAdapter
      ) {
        if (this.closed) return closedResult(admission, dispatch);
        try {
          const acceptedReceipt =
            this.artifactState.contextDispatchReceipts
              .slice()
              .reverse()
              .find((candidate) =>
                candidate.dispatchRef?.id === dispatch.dispatchId &&
                candidate.dispatchRef?.digest === dispatch.dispatchDigest &&
                candidate.accepted === true);
          const adapterReceipt = acceptedReceipt ||
            await this.deliveryDispatchAdapter({
              schema: "direct_ledger_delivery_dispatch_adapter_request@1",
              delivery,
              contextAdmission: admission,
              dispatch,
              canonicalEffect: false,
              grantsAuthority: false,
            });
          dispatchReceipt = acceptedReceipt ||
            buildDispatchReceipt(dispatch, adapterReceipt, this.now);
          runtimeDispatchStarted = dispatchReceipt.accepted === true;
          wakeStarted =
            runtimeDispatchStarted &&
            Boolean(
              dispatch.wakeEvent ||
              dispatch.continuationPacket ||
              dispatch.safeBoundaryInjection,
            ) &&
            dispatchReceipt.wakeStarted === true;
          if (runtimeDispatchStarted && !acceptedReceipt) {
            this.artifactState.contextDispatchReceipts = upsert(
              this.artifactState.contextDispatchReceipts,
              dispatchReceipt,
              "dispatchReceiptId",
            );
            // Persist provider acceptance before consuming the broker
            // delivery. Replay therefore cannot create a second activation
            // if the process stops between these two durable transitions.
            this.persistArtifacts();
          }
          productionDispatchBoundary = runtimeDispatchStarted
            ? acceptedReceipt
              ? "role_runtime_dispatch_receipt_replayed"
              : "role_runtime_dispatch_accepted"
            : "role_runtime_dispatch_declined";
        } catch (error) {
          dispatchReceipt = {
            accepted: false,
            errorCode: text(
              error?.code,
              "role_runtime_dispatch_failed",
            ),
          };
          productionDispatchBoundary = "role_runtime_dispatch_failed";
        }
      } else if (dispatch) {
        productionDispatchBoundary =
          dispatch.disposition === "semantic_inbox_only"
            ? "durable_semantic_inbox"
            : "prepared_only_no_role_runtime_dispatch_adapter";
      } else {
        productionDispatchBoundary =
          "durable_semantic_role_inbox_recipient_runtime_unresolved";
      }

      const durableInboxAccepted =
        !dispatch || dispatch.disposition === "semantic_inbox_only";
      if (this.closed) return closedResult(admission, dispatch);
      if (durableInboxAccepted || runtimeDispatchStarted) {
        delivery = this.broker.markDelivered(deliveryId, {
          now: this.now,
        });
        this.persistBroker();
        // A delivered queue item releases one slot for any debounce group
        // that was held at maximumQueuedDeliveries.  Wake the pending flush
        // from this actual delivery transition instead of waiting for a
        // zero-delay timer loop.
        this.pendingFlushRetryDelayMs = 0;
        this.schedulePendingFlush({ force: true, retryDelayMs: 0 });
        deliveryTransition = durableInboxAccepted
          ? "delivered_to_semantic_inbox"
          : "delivered_to_role_runtime";
      } else {
        deliveryTransition = "queued_awaiting_runtime_dispatch";
      }
    }
    this.persistArtifacts();
    this.persistBroker();
    return {
      schema: "direct_epistemic_delivery_context_import_result@1",
      delivery,
      admission,
      dispatch,
      dispatchReceipt,
      deliveryTransition,
      runtimeDispatchStarted,
      wakeStarted,
      productionDispatchBoundary,
      canonicalEffect: false,
      grantsAuthority: false,
    };
  }

  drainPendingOutbox() {
    const pending = this.ledgerStore.listPendingOutboxEntries();
    if (!pending.length) return { drained: 0, failed: 0 };
    const events = pending
      .map((entry) => this.ledgerStore.getEvent(entry.seed.ledgerEventRef.id))
      .filter(Boolean);
    const routed = this.broker.routeEvents(events, {
      flushAll: true,
      now: this.now,
      subscriptionIdsByEvent: pending.reduce((byEvent, entry) => {
        const eventId = entry.seed.ledgerEventRef.id;
        byEvent[eventId] = Array.from(new Set([
          ...(byEvent[eventId] || []),
          entry.seed.subscriptionRef.id,
        ]));
        return byEvent;
      }, {}),
    });
    this.persistBroker();
    const reconciliation = this.reconcileRoutedOutbox(pending);
    this.schedulePendingFlush();
    return {
      drained: reconciliation.dispatched,
      failed: reconciliation.pending,
    };
  }

  projection() {
    const broker = this.broker.snapshot();
    return compileEpistemicFabricProjection({
      ledgerDescriptor: {
        ...this.ledgerStore.descriptor(),
        available: true,
        verified: this.ledgerStore.verifyRestartState().ok,
        globalSequence:
          this.ledgerStore.descriptor().chain?.headSequence || 0,
        eventCount:
          this.ledgerStore.descriptor().chain?.eventCount || 0,
      },
      events: this.ledgerStore.listEvents({ limit: 100 }),
      lifecycles: this.artifactState.lifecycles,
      assuranceGraphs: this.artifactState.assuranceGraphs,
      gateDecisions: this.artifactState.gateDecisions,
      mechanicalWitnesses: this.artifactState.mechanicalWitnesses,
      auditAssignments: this.artifactState.auditAssignments,
      auditAssessments: this.artifactState.auditAssessments,
      admissionReceiptCandidates:
        this.artifactState.admissionReceiptCandidates,
      admissionReceipts: this.artifactState.admissionReceipts,
      deliveries: broker.deliveries,
      lifecycleIngestionReceipts:
        this.artifactState.lifecycleIngestionReceipts,
      artifactRuntimeEvidenceReceipts:
        this.artifactState.artifactRuntimeEvidenceReceipts,
      invalidations: this.artifactState.contextInvalidations.map(
        (notice) => ({
          ...notice,
          invalidationId: notice.invalidationNoticeId,
          digest: notice.noticeDigest,
          targetAgentRunRef: notice.affectedAgentRunRef,
          posture: notice.contextBindingStale
            ? "stale"
            : notice.invalidationPosture,
          rendererSafeSummary: notice.protectedNoticeOnly
            ? "A protected context dependency changed; governed actions must pause."
            : `${notice.invalidatedDependencyRefs.length} admitted context dependency ${notice.invalidatedDependencyRefs.length === 1 ? "is" : "are"} stale.`,
        }),
      ),
      activeLifecycleId: this.artifactState.activeLifecycleId,
      generatedAt: new Date(Number(this.now())).toISOString(),
    });
  }

  status() {
    return {
      schema: EPISTEMIC_FABRIC_RUNTIME_SCHEMA,
      started: this.started,
      ledger: this.ledgerStore.descriptor(),
      durableState: this.stateStore.descriptor(),
      broker: this.broker.snapshot(),
      artifactCounts: Object.fromEntries(
        Object.entries(this.artifactState)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, value.length]),
      ),
      canonicalAdmissionAdapterAvailable: Boolean(this.authorityAdapter),
      canonicalRevisionResolverAvailable: Boolean(
        this.canonicalRevisionResolver,
      ),
      contextImporterAvailable: Boolean(this.contextImporter),
      nativeContextImporterEnabled: this.nativeContextImporterEnabled,
      roleRuntimeDispatchAdapterAvailable: Boolean(
        this.deliveryDispatchAdapter,
      ),
      deliveryTargetResolverAvailable: Boolean(
        this.deliveryTargetResolver,
      ),
      pendingFlushScheduled: this.pendingFlushTimer !== null,
      pendingFlushDueAt: this.pendingFlushDueAt || null,
      artifactWorkThreadDispatchAdapterAvailable: Boolean(
        this.artifactWorkThreadDispatchAdapter,
      ),
      artifactRuntimeEvidenceResolverAvailable: Boolean(
        this.artifactRuntimeEvidenceResolver,
      ),
      productionDispatchBoundary: this.deliveryDispatchAdapter
        ? "role_runtime_adapter_configured"
        : "prepared_only_no_role_runtime_dispatch_adapter",
      pollingRequired: false,
      rawChainOfThoughtIncluded: false,
      grantsAuthority: false,
    };
  }

  close() {
    this.closed = true;
    this.clearPendingFlushSchedule();
    this.pendingFlushRetryDelayMs = 0;
    this.persistBroker();
    this.persistArtifacts();
    this.ledgerStore.close();
    this.started = false;
  }
}

module.exports = {
  DirectWorldManagerEpistemicFabricRuntime,
  EPISTEMIC_FABRIC_RUNTIME_SCHEMA,
  implementationPatchConstitution,
};
