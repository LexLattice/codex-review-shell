"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  createDirectProviderBackedSubAgentRoute,
  normalizeEpistemicCapture,
} = require("./provider-backed-route");
const {
  WORKSPACE_MODE_ISOLATED_WORKTREE,
  WORKSPACE_MODE_REASONING_ONLY,
  normalizeToolProfile,
  normalizeWorkspaceMode,
  safeWorkspaceExecutionProjection,
} = require("./workspace-worker-contract");
const {
  validateWorkspaceParentAuthorityPacket,
} = require("./workspace-worker-policy-profile");
const {
  admittedWorkspaceWorkerCancellationReceipt,
  validateWorkspaceWorkerCancellationReceipt,
} = require("./workspace-worker-runtime");
const {
  validateWorkspaceDelegatedParentAuthorityPacket,
} = require("./workspace-worker-delegation-policy");

const DIRECT_NATIVE_AGENT_POOL_SCHEMA = "direct_native_agent_pool@1";
const DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA = "direct_native_agent_launch@1";
const DIRECT_NATIVE_AGENT_STATUS_SCHEMA = "direct_native_agent_status@1";
const TERMINAL_STATES = new Set(["completed", "failed", "timeout", "cancelled"]);
const CANCELLATION_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const DIRECT_WORKSPACE_WORKER_LAUNCH_IDENTITY_SCHEMA = "direct_workspace_worker_launch_identity@1";
const DIRECT_WORKSPACE_WORKER_DELEGATION_AUTHORITY_BINDING_SCHEMA = "direct_workspace_worker_delegation_authority_binding@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCancellationReason(value, fallback = "direct_agent_cancelled") {
  const reasonCode = normalizeString(value, fallback);
  return CANCELLATION_REASON_PATTERN.test(reasonCode) ? reasonCode : fallback;
}

function publicAgentErrorCode(value, fallback = "direct_agent_runtime_exception") {
  const code = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(code) ? code : fallback;
}

function publicResultDigest(value) {
  const digest = normalizeString(value, "");
  return /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : "";
}

function publicEvidenceConfidence(value, fallback = "unknown") {
  const confidence = normalizeString(value, fallback);
  return new Set(["exact", "partial", "unknown"]).has(confidence) ? confidence : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.floor(number)))
    : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function safeMutationOutcome(value) {
  if (!isPlainObject(value) || value.schema !== "workspace_backend_mutation_outcome@1") return null;
  const outcomeDigest = normalizeString(value.outcomeDigest, "");
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId: normalizeString(value.requestId, ""),
    method: normalizeString(value.method, ""),
    commitKind: normalizeString(value.commitKind, ""),
    committed: value.committed === true,
    ...(value.committed === true ? {} : {
      indeterminate: value.indeterminate === true,
      partialMutationPossible: value.partialMutationPossible === true,
    }),
    retainedForInspection: value.retainedForInspection === true,
    ...(value.committed === true
      ? { resultDigest: normalizeString(value.resultDigest, "") }
      : { failureCode: publicAgentErrorCode(value.failureCode, "") }),
    rawPathIncluded: false,
  };
  if (
    !base.requestId || !base.method || !base.commitKind ||
    value.rawPathIncluded !== false ||
    (base.committed && !/^sha256:[a-f0-9]{64}$/.test(base.resultDigest)) ||
    (!base.committed && (
      base.indeterminate !== true ||
      base.partialMutationPossible !== true ||
      !base.failureCode
    ))
  ) {
    return null;
  }
  const expectedDigest = `sha256:${crypto.createHash("sha256").update(stableStringify(base)).digest("hex")}`;
  return outcomeDigest === expectedDigest ? { ...base, outcomeDigest } : null;
}

function buildPreStartCancellationReceipt(record) {
  const base = {
    schema: "direct_workspace_worker_cancellation_receipt@1",
    targetRequestId: normalizeString(record.childAgentId, ""),
    launchDigest: normalizeString(record.launchDigest, ""),
    lifecycleSessionId: normalizeString(record._lifecycleSessionId, ""),
    lifecycleLeaseId: normalizeString(record._lifecycleProjection?.leaseId, ""),
    reasonCode: normalizeString(record._cancelReasonCode, "direct_agent_cancelled"),
    acknowledged: true,
    quiesced: true,
    acknowledgementKind: "cancelled_before_runner_start",
    outcomeDigest: "",
    rawProcessDetailsIncluded: false,
  };
  return {
    ...base,
    receiptDigest: digestFor("direct-workspace-worker-cancellation-receipt@1", base),
  };
}

function preStartCancellationReceipt(record, evidence = {}) {
  if (
    evidence?.cancelledBeforeStart !== true ||
    record?._runnerStarted === true ||
    record?._cancelRequested !== true
  ) return null;
  const receipt = buildPreStartCancellationReceipt(record);
  return stableStringify(evidence.cancellationReceipt) === stableStringify(receipt)
    ? receipt
    : null;
}

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function normalizeForkTurns(value) {
  const text = normalizeString(value, "all").toLowerCase();
  if (text === "all") return { mode: "full", recentTurnCount: 0, forkTurns: "all" };
  if (text === "none") return { mode: "none", recentTurnCount: 0, forkTurns: "none" };
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    const error = new Error("fork_turns must be `none`, `all`, or a positive integer string up to 200");
    error.code = "direct_agent_invalid_fork_turns";
    throw error;
  }
  return { mode: "recent", recentTurnCount: count, forkTurns: String(count) };
}

function selectContextMessages(messages = [], handoff = normalizeForkTurns("none")) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: normalizeString(message?.role, ""),
      text: normalizeString(message?.text || message?.content, ""),
      turnId: normalizeString(message?.turnId, ""),
    }))
    .filter((message) => ["user", "assistant"].includes(message.role) && message.text);
  if (handoff.mode === "none") return [];
  if (handoff.mode === "full") return normalized;
  const turnIds = [];
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const turnId = normalized[index].turnId || `message_${index}`;
    if (!turnIds.includes(turnId)) turnIds.push(turnId);
    if (turnIds.length >= handoff.recentTurnCount) break;
  }
  const accepted = new Set(turnIds);
  return normalized.filter((message, index) => accepted.has(message.turnId || `message_${index}`));
}

function safeTaskName(value) {
  const normalized = normalizeString(value, "agent")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "agent";
}

function scopeKey(projectId, primaryThreadId) {
  return `${normalizeString(projectId, "project_direct")}::${normalizeString(primaryThreadId, "primary_direct")}`;
}

function safeStatusCode(value, fallback = "") {
  const code = normalizeString(value, "");
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(code) ? code : fallback;
}

function safeWorkspaceStatusCode(value, fallback = "") {
  const code = safeStatusCode(value, "");
  return /^(?:direct_|workspace_|provider_|response_|content_|max_|stream_|missing_|target_)/.test(code)
    ? code
    : fallback;
}

function safeDigest(value, fallback = "") {
  const digest = normalizeString(value, "");
  return /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest : fallback;
}

function workspaceDelegationAuthorityBinding(packet = {}) {
  const ref = packet.delegationPolicyRef;
  if (!isPlainObject(ref)) return null;
  const lineageBase = {
    policyId: normalizeString(ref.policyId, ""),
    policyRevision: Number(ref.policyRevision || 0),
    sourceId: normalizeString(ref.sourceId, ""),
    sourceDigest: normalizeString(ref.sourceDigest, ""),
    upstreamToolPolicyDigest: normalizeString(packet.upstreamToolPolicy?.policyDigest, ""),
    projectId: normalizeString(ref.projectId, ""),
    workThreadId: normalizeString(ref.workThreadId, ""),
    roleLane: normalizeString(ref.roleLane, ""),
  };
  const base = {
    schema: DIRECT_WORKSPACE_WORKER_DELEGATION_AUTHORITY_BINDING_SCHEMA,
    parentAuthorityBoundaryDigest: normalizeString(packet.boundaryDigest, ""),
    policyId: normalizeString(ref.policyId, ""),
    policyRevision: Number(ref.policyRevision || 0),
    policyDigest: normalizeString(ref.policyDigest, ""),
    sourceId: normalizeString(ref.sourceId, ""),
    sourceDigest: normalizeString(ref.sourceDigest, ""),
    upstreamToolPolicyDigest: lineageBase.upstreamToolPolicyDigest,
    authorityLineageDigest: digestFor(
      "direct-workspace-worker-delegation-authority-lineage@1",
      lineageBase,
    ),
    issuedAt: normalizeString(ref.issuedAt, ""),
    expiresAt: normalizeString(ref.expiresAt, ""),
    projectId: normalizeString(ref.projectId, ""),
    workThreadId: normalizeString(ref.workThreadId, ""),
    roleLane: normalizeString(ref.roleLane, ""),
    rawAuthorityPacketIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  return Object.freeze({
    ...base,
    authorityDigest: digestFor("direct-workspace-worker-delegation-authority-binding@1", base),
  });
}

function workspaceSpawnLaunchIdentity(input = {}) {
  const source = isPlainObject(input.spawnOperation) ? input.spawnOperation : {};
  const parentSessionId = normalizeString(source.parentSessionId, "");
  const parentTurnId = normalizeString(source.parentTurnId, "");
  const obligationId = normalizeString(source.obligationId, "");
  if (!parentSessionId || !parentTurnId || !obligationId) {
    const error = new Error("Provider-visible workspace launch requires an exact session, turn, and obligation identity.");
    error.code = "direct_workspace_worker_spawn_operation_missing";
    throw error;
  }
  const operationKeyDigest = digestFor("direct-workspace-worker-spawn-operation-key@1", {
    parentSessionId,
    parentTurnId,
    obligationId,
  });
  const launchOperationId = `provider_workspace_spawn_${operationKeyDigest.slice(7, 39)}`;
  const canonicalInputDigest = digestFor("direct-workspace-worker-spawn-canonical-input@1", {
    operationKeyDigest,
    callId: normalizeString(source.callId, ""),
    projectId: input.projectId,
    workThreadId: input.workThreadId,
    primaryThreadId: input.primaryThreadId,
    parentAgentId: input.parentAgentId,
    taskName: input.taskName,
    taskDigest: input.taskDigest,
    role: input.role,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    contextHandoff: input.contextHandoff,
    contextDigest: input.contextDigest,
    workspaceMode: input.workspaceMode,
    toolProfile: input.toolProfile,
    delegationAuthorityLineageDigest: input.delegationAuthority?.authorityLineageDigest || "",
  });
  const base = {
    schema: DIRECT_WORKSPACE_WORKER_LAUNCH_IDENTITY_SCHEMA,
    launchOperationId,
    operationKeyDigest,
    parentSessionDigest: digestFor("direct-workspace-worker-parent-session-id@1", parentSessionId),
    parentTurnDigest: digestFor("direct-workspace-worker-parent-turn-id@1", parentTurnId),
    obligationDigest: digestFor("direct-workspace-worker-provider-obligation-id@1", obligationId),
    callDigest: normalizeString(source.callId, "")
      ? digestFor("direct-workspace-worker-provider-call-id@1", normalizeString(source.callId, ""))
      : "",
    taskName: input.taskName,
    canonicalInputDigest,
    authorityDigest: input.delegationAuthority?.authorityDigest || "",
    authorityLineageDigest: input.delegationAuthority?.authorityLineageDigest || "",
    rawProviderArgumentsIncluded: false,
    rawTaskIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  return Object.freeze({
    ...base,
    launchIdentityDigest: digestFor("direct-workspace-worker-launch-identity@1", base),
  });
}

function typedWorkspaceResultSummary(record = {}, patch = {}) {
  const state = TERMINAL_STATES.has(patch.state) ? patch.state : "failed";
  if (state !== "completed") {
    return safeWorkspaceStatusCode(patch.blockerCode, `direct_workspace_worker_${state}`);
  }
  return normalizeEpistemicCapture(patch.epistemicCapture).complete
    ? "direct_workspace_worker_completed_captured"
    : "direct_workspace_worker_completed";
}

class DirectNativeAgentPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxActiveChildren = boundedInteger(options.maxActiveChildren, 8, 1, 32);
    this.maxQueuedChildren = boundedInteger(options.maxQueuedChildren, 64, 0, 512);
    this.defaultModel = normalizeString(options.defaultModel, "gpt-5.6-sol");
    this.defaultReasoningEffort = normalizeString(options.defaultReasoningEffort, "medium");
    this.providerTurnRunner = typeof options.providerTurnRunner === "function"
      ? options.providerTurnRunner
      : null;
    this.workspaceWorkerRunner = typeof options.workspaceWorkerRunner === "function"
      ? options.workspaceWorkerRunner
      : null;
    this.workspaceWorkerLifecycleRegistry = options.workspaceWorkerLifecycleRegistry || null;
    const recovery = this.workspaceWorkerLifecycleRegistry?.recoverySnapshot?.() || {
      status: "clean",
      candidates: [],
    };
    this.recoveredSessionIds = new Set(
      (Array.isArray(recovery.candidates) ? recovery.candidates : []).map((row) => row.sessionId),
    );
    this.settlementRetryAttempts = boundedInteger(options.settlementRetryAttempts, 3, 1, 10);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.routes = new Map();
    this.jobs = new Map();
    this.taskIndex = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.sequence = 0;
    this.closed = false;
    this.closeReasonCode = "";
    this.cancellationRequestedAll = false;
  }

  descriptor() {
    const recovery = this.recoverySnapshot();
    const descriptor = {
      schema: DIRECT_NATIVE_AGENT_POOL_SCHEMA,
      maxActiveChildren: this.maxActiveChildren,
      maxQueuedChildren: this.maxQueuedChildren,
      activeChildren: this.activeCount,
      cancellingChildren: [...this.jobs.values()].filter((record) => record.state === "cancelling").length,
      cancellationUnacknowledgedChildren: [...this.jobs.values()].filter((record) => record.state === "cancellation_unacknowledged").length,
      settlementBlockedChildren: [...this.jobs.values()].filter((record) => record.state === "settlement_blocked").length,
      durableRecoveryStatus: recovery.status,
      durableRecoveryCandidateCount: recovery.candidateCount,
      queuedChildren: this.queue.length,
      totalChildren: this.jobs.size,
      providerTransportAvailable: Boolean(this.providerTurnRunner),
      workspaceWorkerRuntimeAvailable: Boolean(this.workspaceWorkerRunner),
      supportedWorkspaceModes: [WORKSPACE_MODE_REASONING_ONLY, WORKSPACE_MODE_ISOLATED_WORKTREE],
      supportedWorkspaceToolProfiles: ["read_only_worker", "implementation_worker"],
      closed: this.closed,
      acceptingNewChildren: !this.closed,
      cancellationRequestedAll: this.cancellationRequestedAll,
      drainComplete: this.closed && this.activeCount === 0 && recovery.status === "clean",
      capacityScope: "direct_runtime_process_shared_across_agent_tree",
      capacityIncludesPrimaryAgent: false,
      contextHandoffIndependentOfModel: true,
      contextHandoffIndependentOfReasoningEffort: true,
      supportedForkTurns: ["none", "all", "positive_integer"],
      generatedAt: nowIso(this.now),
    };
    descriptor.poolDigest = digestFor("direct-native-agent-pool@1", descriptor);
    return descriptor;
  }

  recoverySnapshot() {
    const durable = this.workspaceWorkerLifecycleRegistry?.recoverySnapshot?.() || {
      schema: "direct_workspace_worker_recovery_snapshot@1",
      candidates: [],
    };
    const candidates = (Array.isArray(durable.candidates) ? durable.candidates : [])
      .filter((row) => this.recoveredSessionIds.has(row.sessionId));
    return {
      schema: "direct_workspace_worker_pool_recovery@1",
      status: candidates.length ? "reconciliation_required" : "clean",
      candidateCount: candidates.length,
      candidates,
      automaticReplayAllowed: false,
      rawWorkspacePathIncluded: false,
    };
  }

  reconcileRecoveredSession(input = {}) {
    const sessionId = normalizeString(input.sessionId || input.receipt?.sessionId, "");
    if (!this.recoveredSessionIds.has(sessionId)) {
      const error = new Error("direct_workspace_worker_recovery_candidate_missing");
      error.code = "direct_workspace_worker_recovery_candidate_missing";
      throw error;
    }
    const session = this.workspaceWorkerLifecycleRegistry.reconcileInterruptedSession(sessionId, input);
    this.recoveredSessionIds.delete(sessionId);
    this.emit("changed", { type: "durable-recovery-reconciled", recovery: this.recoverySnapshot() });
    return this.safeLifecycleProjection(session);
  }

  routeFor(record) {
    const key = scopeKey(record.projectId, record.primaryThreadId);
    if (!this.routes.has(key)) {
      this.routes.set(key, createDirectProviderBackedSubAgentRoute({
        projectId: record.projectId,
        workThreadId: record.workThreadId,
        primaryThreadId: record.primaryThreadId,
        routeId: `direct_native_agent_pool_${digestFor("direct-native-agent-pool-route@1", key).slice(7, 23)}`,
        defaultModel: this.defaultModel,
        defaultReasoningEffort: this.defaultReasoningEffort,
        providerTurnRunner: this.providerTurnRunner,
      }));
    }
    return this.routes.get(key);
  }

  validateWorkspaceOperationLease(record) {
    if (
      !record ||
      record.workspaceMode !== WORKSPACE_MODE_ISOLATED_WORKTREE ||
      record._settled ||
      record._cancelRequested ||
      record._leaseActive !== true
    ) {
      const error = new Error("Workspace operation lease is no longer active.");
      error.code = "direct_workspace_worker_operation_lease_inactive";
      throw error;
    }
    if (record._lifecycleSessionId && this.workspaceWorkerLifecycleRegistry) {
      const session = this.workspaceWorkerLifecycleRegistry.session(record._lifecycleSessionId);
      if (
        !session ||
        session.state !== "active" ||
        session.leaseState !== "active" ||
        session.processState !== "running" ||
        session.delegationAuthority?.authorityDigest !== record._delegationAuthority?.authorityDigest
      ) {
        const error = new Error("Durable workspace operation lease does not match the active launch authority.");
        error.code = "direct_workspace_worker_operation_lease_unverified";
        throw error;
      }
    }
    return Object.freeze({
      status: "active",
      childAgentId: record.childAgentId,
      delegationAuthorityDigest: record._delegationAuthority?.authorityDigest || "",
      rawWorkspacePathIncluded: false,
    });
  }

  launch(input = {}) {
    if (this.closed) return this.launchResult(null, "blocked", "direct_agent_pool_closed");
    if (input.signal?.aborted) return this.launchResult(null, "blocked", "direct_agent_launch_aborted");
    let workspaceMode;
    let toolProfile;
    try {
      workspaceMode = normalizeWorkspaceMode(input.workspaceMode || input.workspace_mode);
      const requestedToolProfile = normalizeString(input.toolProfile || input.tool_profile, "");
      if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE && !requestedToolProfile) {
        const error = new Error("isolated_worktree requires one explicit tool_profile");
        error.code = "direct_workspace_worker_tool_profile_missing";
        throw error;
      }
      if (workspaceMode === WORKSPACE_MODE_REASONING_ONLY && requestedToolProfile) {
        const error = new Error("reasoning_only children cannot request a workspace tool_profile");
        error.code = "direct_workspace_worker_tool_profile_without_workspace";
        throw error;
      }
      toolProfile = workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE
        ? normalizeToolProfile(requestedToolProfile)
        : "reasoning_only";
    } catch (error) {
      return this.launchResult(null, "blocked", normalizeString(error?.code, "direct_workspace_worker_request_invalid"));
    }
    if (workspaceMode === WORKSPACE_MODE_REASONING_ONLY && !this.providerTurnRunner) {
      return this.launchResult(null, "blocked", "provider_runner_missing");
    }
    if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE && !this.workspaceWorkerRunner) {
      return this.launchResult(null, "blocked", "workspace_worker_runner_missing");
    }
    if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE && !isPlainObject(input.project)) {
      return this.launchResult(null, "blocked", "workspace_worker_project_binding_missing");
    }
    if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE && this.recoverySnapshot().status !== "clean") {
      return this.launchResult(null, "blocked", "direct_workspace_worker_restart_reconciliation_required");
    }
    const projectId = normalizeString(input.projectId, "project_direct_agents");
    const primaryThreadId = normalizeString(input.primaryThreadId || input.parentThreadId, "primary_direct_agent");
    const workThreadId = normalizeString(input.workThreadId, "work_thread_direct_agents");
    const parentAgentId = normalizeString(input.parentAgentId, primaryThreadId);
    let parentAuthorityPacket = null;
    let delegationAuthority = null;
    if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE) {
      if (!isPlainObject(input.parentAuthorityPacket)) {
        return this.launchResult(null, "blocked", "direct_workspace_parent_authority_missing");
      }
      try {
        parentAuthorityPacket = validateWorkspaceParentAuthorityPacket(input.parentAuthorityPacket);
      } catch (error) {
        return this.launchResult(null, "blocked", normalizeString(error?.code, "direct_workspace_parent_authority_invalid"));
      }
      const delegationRef = parentAuthorityPacket.delegationPolicyRef;
      if (delegationRef) {
        try {
          validateWorkspaceDelegatedParentAuthorityPacket(parentAuthorityPacket, {
            projectId,
            workThreadId,
            roleLane: "implementation_worker",
            requestedProfileId: toolProfile,
            nowMs: Number(this.now()),
          });
          delegationAuthority = workspaceDelegationAuthorityBinding(parentAuthorityPacket);
        } catch (error) {
          const policyCode = normalizeString(error?.code, "");
          return this.launchResult(null, "blocked", normalizeString(
            [
              "direct_workspace_worker_delegation_policy_project_mismatch",
              "direct_workspace_worker_delegation_policy_work_thread_mismatch",
            ].includes(policyCode)
              ? "direct_workspace_worker_delegation_policy_scope_mismatch"
              : policyCode,
            "direct_workspace_worker_delegation_policy_untrusted",
          ));
        }
      }
    }
    const task = normalizeString(input.message || input.prompt || input.task, "");
    if (!task) return this.launchResult(null, "blocked", "missing_spawn_prompt");
    const taskName = safeTaskName(input.taskName || input.task_name || `agent_${this.sequence + 1}`);
    const handoff = normalizeForkTurns(input.forkTurns || input.fork_turns);
    const contextMessages = selectContextMessages(input.parentContextMessages, handoff);
    const contextDigest = contextMessages.length
      ? digestFor("direct-native-agent-context@1", contextMessages)
      : "";
    const taskDigest = digestFor("direct-native-agent-task@1", task);
    const model = normalizeString(input.model, normalizeString(input.parentModel, this.defaultModel));
    const reasoningEffort = normalizeString(
      input.reasoningEffort || input.reasoning_effort,
      normalizeString(input.parentReasoningEffort, this.defaultReasoningEffort),
    );
    const requestedRoleLabel = normalizeString(input.agentType || input.agent_type || input.role, "");
    const role = delegationAuthority?.roleLane || requestedRoleLabel || "sub_agent_worker";
    let launchIdentity = null;
    if (delegationAuthority && this.workspaceWorkerLifecycleRegistry && !isPlainObject(input.spawnOperation)) {
      return this.launchResult(null, "blocked", "direct_workspace_worker_spawn_operation_missing");
    }
    if (delegationAuthority && isPlainObject(input.spawnOperation)) {
      if (!this.workspaceWorkerLifecycleRegistry) {
        return this.launchResult(null, "blocked", "direct_workspace_worker_spawn_lifecycle_required");
      }
      try {
        launchIdentity = workspaceSpawnLaunchIdentity({
          spawnOperation: input.spawnOperation,
          projectId,
          workThreadId,
          primaryThreadId,
          parentAgentId,
          taskName,
          taskDigest,
          role,
          model,
          reasoningEffort,
          contextHandoff: handoff,
          contextDigest,
          workspaceMode,
          toolProfile,
          delegationAuthority,
        });
        const prior = this.workspaceWorkerLifecycleRegistry.sessionForLaunchOperation?.(
          launchIdentity.launchOperationId,
        );
        if (prior) {
          if (
            prior.launchIdentity?.canonicalInputDigest !== launchIdentity.canonicalInputDigest ||
            prior.launchIdentity?.authorityLineageDigest !== launchIdentity.authorityLineageDigest ||
            prior.delegationAuthority?.authorityLineageDigest !== delegationAuthority.authorityLineageDigest
          ) {
            return this.launchResult(null, "blocked", "direct_workspace_worker_spawn_operation_conflict");
          }
          const resident = this.jobs.get(prior.childAgentId);
          return resident
            ? this.launchResult(resident, resident.state, "", { replayed: true })
            : this.lifecycleReplayLaunchResult(prior);
        }
      } catch (error) {
        return this.launchResult(null, "blocked", normalizeString(
          error?.code,
          "direct_workspace_worker_spawn_operation_invalid",
        ));
      }
    }
    const taskKey = `${scopeKey(projectId, primaryThreadId)}::${taskName}`;
    const existingId = this.taskIndex.get(taskKey);
    if (existingId && !TERMINAL_STATES.has(this.jobs.get(existingId)?.state)) {
      return this.launchResult(this.jobs.get(existingId), "blocked", "duplicate_live_task_name");
    }
    if (this.queue.length >= this.maxQueuedChildren && this.activeCount >= this.maxActiveChildren) {
      return this.launchResult(null, "blocked", "direct_agent_queue_full");
    }
    const childAgentId = normalizeString(
      input.childAgentId,
      `direct_child_${++this.sequence}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    );
    if (this.jobs.has(childAgentId) || this.workspaceWorkerLifecycleRegistry?.sessionForChild?.(childAgentId)) {
      return this.launchResult(null, "blocked", "direct_agent_child_identity_reused");
    }
    const launchId = `direct_agent_launch_${crypto.randomUUID().replace(/-/g, "")}`;
    const launchDigest = digestFor("direct-native-agent-launch-identity@1", {
      launchId,
      childAgentId,
      projectId,
      workThreadId,
      primaryThreadId,
    });
    const record = {
      schema: DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
      childAgentId,
      taskName,
      projectId,
      workThreadId,
      primaryThreadId,
      launchDigest,
      parentAgentId,
      role,
      providerRoleLabelAcceptedAsAuthority: false,
      providerRoleLabelIgnored: Boolean(delegationAuthority && requestedRoleLabel && requestedRoleLabel !== role),
      displayLabel: normalizeString(input.displayLabel, taskName),
      workspaceMode,
      toolProfile,
      workspaceExecution: workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE
          ? {
            schema: "direct_workspace_worker_execution@1",
            status: "provisioning_pending",
            workspaceMode,
            toolProfile,
            workspaceWorkerDelegationPolicyRef: parentAuthorityPacket?.delegationPolicyRef
              ? { ...parentAuthorityPacket.delegationPolicyRef }
              : null,
            rawWorkspacePathIncluded: false,
          }
        : null,
      state: this.activeCount < this.maxActiveChildren ? "accepted" : "queued",
      model,
      reasoningEffort,
      contextHandoff: handoff,
      contextMessageCount: contextMessages.length,
      contextDigest,
      taskDigest,
      runtimeProfileIndependentOfContext: true,
      createdAt: nowIso(this.now),
      startedAt: "",
      completedAt: "",
      resultSummary: "",
      resultSummaryKind: workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE
        ? "typed_status_code"
        : "provider_summary",
      blockerCode: "",
      resultDigest: "",
      mutationOutcome: null,
      partialMutationPossible: false,
      epistemicCapture: {
        status: "pending",
        errorCode: "",
        receiptDigest: "",
        sessionId: "",
        turnId: "",
      },
      epistemicCaptureComplete: false,
      epistemicCaptureOmission: null,
      evidenceConfidence: "unknown",
      rawTaskPersisted: false,
      rawContextPersisted: false,
      _task: task,
      _contextMessages: contextMessages,
      _project: workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE ? input.project : null,
      _parentAuthorityPacket: parentAuthorityPacket,
      _delegationAuthority: delegationAuthority,
      _launchIdentity: launchIdentity,
      _waiters: new Set(),
      _settled: false,
      _leaseActive: false,
      _abortController: null,
      _externalSignal: input.signal || null,
      _externalAbortListener: null,
      _runnerStarted: false,
      _runnerPromise: null,
      _cancelRequested: false,
      _cancelReasonCode: "",
      _cancelRequestedAt: "",
      _cancelAcknowledgedAt: "",
      _cancellationReceipt: null,
      _pendingSettlement: null,
      _settlementAttempts: 0,
      _lifecycleSessionId: "",
      _lifecycleProjection: null,
      _lifecycleErrorCode: "",
    };
    if (workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE && this.workspaceWorkerLifecycleRegistry) {
      try {
        const session = this.workspaceWorkerLifecycleRegistry.openSession({
          sessionId: `workspace_worker_session_${childAgentId}`,
          leaseId: `workspace_worker_lease_${childAgentId}`,
          childAgentId,
          projectId,
          workThreadId,
          primaryThreadId,
          launchDigest,
          toolProfile,
          operationId: launchIdentity?.launchOperationId || `pool-open:${childAgentId}`,
          launchIdentity,
          delegationAuthority,
        });
        record._lifecycleSessionId = session.sessionId;
        record._lifecycleProjection = this.safeLifecycleProjection(session);
      } catch (error) {
        return this.launchResult(null, "blocked", normalizeString(
          error?.code,
          "direct_workspace_worker_lifecycle_registration_failed",
        ));
      }
    }
    this.jobs.set(childAgentId, record);
    this.taskIndex.set(taskKey, childAgentId);
    if (record._externalSignal?.addEventListener) {
      record._externalAbortListener = () => this.cancelRecord(record, "direct_agent_launch_aborted");
      record._externalSignal.addEventListener("abort", record._externalAbortListener, { once: true });
    }
    if (record._externalSignal?.aborted) {
      this.cancelRecord(record, "direct_agent_launch_aborted");
      return this.launchResult(record, record.state, record.blockerCode);
    }
    if (record.state === "queued") this.queue.push(childAgentId);
    else this.startRecord(record);
    this.emit("changed", this.publicRecord(record));
    return this.launchResult(record, record.state, "");
  }

  launchResult(record, status, blockerCode, options = {}) {
    const result = {
      schema: DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA,
      status,
      blockerCode: normalizeString(blockerCode, ""),
      childAgentId: normalizeString(record?.childAgentId, ""),
      launchDigest: normalizeString(record?.launchDigest, ""),
      taskName: normalizeString(record?.taskName, ""),
      state: normalizeString(record?.state, status),
      model: normalizeString(record?.model, ""),
      reasoningEffort: normalizeString(record?.reasoningEffort, ""),
      workspaceMode: normalizeString(record?.workspaceMode, WORKSPACE_MODE_REASONING_ONLY),
      toolProfile: normalizeString(record?.toolProfile, "reasoning_only"),
      workspaceExecution: record?.workspaceExecution
        ? safeWorkspaceExecutionProjection(record.workspaceExecution)
        : null,
      contextHandoff: record?.contextHandoff || null,
      contextMessageCount: Number(record?.contextMessageCount || 0),
      runtimeProfileIndependentOfContext: record?.runtimeProfileIndependentOfContext === true,
      replayed: options.replayed === true,
      providerRoleLabelAcceptedAsAuthority: false,
      pool: this.descriptor(),
      rawTaskIncluded: false,
      rawContextIncluded: false,
    };
    result.resultDigest = digestFor("direct-native-agent-launch@1", result);
    return result;
  }

  lifecycleReplayLaunchResult(session = {}) {
    const ref = session.delegationAuthority
      ? {
          schema: "direct_workspace_worker_delegation_policy_ref@1",
          policyId: session.delegationAuthority.policyId,
          policyRevision: session.delegationAuthority.policyRevision,
          policyDigest: session.delegationAuthority.policyDigest,
          sourceId: session.delegationAuthority.sourceId,
          sourceDigest: session.delegationAuthority.sourceDigest,
          issuedAt: session.delegationAuthority.issuedAt,
          expiresAt: session.delegationAuthority.expiresAt,
          projectId: session.delegationAuthority.projectId,
          workThreadId: session.delegationAuthority.workThreadId,
          roleLane: session.delegationAuthority.roleLane,
        }
      : null;
    return this.launchResult({
      childAgentId: session.childAgentId,
      taskName: session.launchIdentity?.taskName,
      state: session.state,
      workspaceMode: session.workspaceMode,
      toolProfile: session.toolProfile,
      workspaceExecution: {
        schema: "direct_workspace_worker_execution@1",
        status: session.state,
        workspaceMode: session.workspaceMode,
        toolProfile: session.toolProfile,
        workspaceWorkerDelegationPolicyRef: ref,
        rawWorkspacePathIncluded: false,
      },
      runtimeProfileIndependentOfContext: true,
    }, session.state, "", { replayed: true });
  }

  startRecord(record) {
    if (!record || record._settled) return;
    if (this.closed) {
      this.cancelRecord(record, "direct_agent_pool_closed");
      return;
    }
    if (record._externalSignal?.aborted) {
      this.cancelRecord(record, "direct_agent_launch_aborted");
      return;
    }
    record._leaseActive = true;
    record._abortController = new AbortController();
    this.activeCount += 1;
    if (record._lifecycleSessionId) {
      const lifecycleError = this.transitionLifecycle(record, "activateLease", {
        operationId: `pool-activate:${record.childAgentId}`,
      });
      if (lifecycleError) {
        this.settleRecord(record, {
          state: "failed",
          blockerCode: lifecycleError,
          resultSummary: lifecycleError,
          evidenceConfidence: "partial",
        });
        return;
      }
    }
    record.state = "running";
    record.startedAt = nowIso(this.now);
    const runnerPromise = Promise.resolve().then(async () => {
      if (record._settled) return { cancelledBeforeStart: true };
      if (record._cancelRequested) return {
        cancelledBeforeStart: true,
        cancellationAcknowledged: true,
        backendQuiesced: true,
        cancellationReceipt: buildPreStartCancellationReceipt(record),
      };
      record._runnerStarted = true;
      const commonInput = {
        childAgentId: record.childAgentId,
        displayLabel: record.displayLabel,
        role: record.role,
        prompt: record._task,
        model: record.model,
        reasoningEffort: record.reasoningEffort,
        contextHandoffMode: record.contextHandoff.mode,
        contextMessages: record._contextMessages,
        projectId: record.projectId,
        workThreadId: record.workThreadId,
        primaryThreadId: record.primaryThreadId,
        launchDigest: record.launchDigest,
        lifecycleSessionId: record._lifecycleSessionId,
        lifecycleLeaseId: normalizeString(record._lifecycleProjection?.leaseId, ""),
        signal: record._abortController.signal,
        now: this.now,
        workspaceOperationLeaseValidator: () => this.validateWorkspaceOperationLease(record),
      };
      return record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE
        ? await this.workspaceWorkerRunner({
            ...commonInput,
            workspaceMode: record.workspaceMode,
            toolProfile: record.toolProfile,
            parentAuthorityPacket: record._parentAuthorityPacket,
            project: record._project,
          })
        : await this.routeFor(record).spawnAndRun(commonInput);
    });
    record._runnerPromise = runnerPromise;
    runnerPromise.then((result) => {
      if (record._settled) return;
      if (
        record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE &&
        result?.backendOwnershipUnresolved === true &&
        !record._cancelRequested
      ) {
        this.markBackendQuiescenceUnacknowledged(record, result);
        return;
      }
      if (record._cancelRequested) {
        const mutationOutcome = safeMutationOutcome(result?.mutationOutcome);
        if (!this.workspaceCancellationQuiesced(record, result)) {
          this.markCancellationUnacknowledged(record, result);
          return;
        }
        record._cancelAcknowledgedAt = nowIso(this.now);
        const cancellationReceipt = preStartCancellationReceipt(record, result) ||
          admittedWorkspaceWorkerCancellationReceipt(result, {
            childAgentId: record.childAgentId,
            projectId: record.projectId,
            workThreadId: record.workThreadId,
            primaryThreadId: record.primaryThreadId,
            launchDigest: record.launchDigest,
            lifecycleSessionId: record._lifecycleSessionId,
            lifecycleLeaseId: normalizeString(record._lifecycleProjection?.leaseId, ""),
            cancellationReasonCode: record._cancelReasonCode,
          });
        if (mutationOutcome?.partialMutationPossible === true) {
          this.settleRecord(record, {
            state: "failed",
            blockerCode: "workspace_backend_mutation_commit_failed_indeterminate",
            resultSummary: "Workspace mutation may be partial; inspect retained evidence before any retry.",
            resultDigest: normalizeString(result?.resultDigest, ""),
            mutationOutcome,
            epistemicCapture: result?.epistemicCapture,
            evidenceConfidence: "partial",
            workspaceExecution: result?.workspaceExecution,
            cancellationReceipt,
          });
          return;
        }
        this.settleRecord(record, {
          state: "cancelled",
          blockerCode: record._cancelReasonCode,
          resultSummary: record._cancelReasonCode,
          epistemicCapture: result?.epistemicCapture,
          evidenceConfidence: "partial",
          workspaceExecution: result?.workspaceExecution,
          resultDigest: normalizeString(result?.resultDigest, ""),
          mutationOutcome,
          cancellationReceipt,
        });
        return;
      }
      this.settleRecord(record, {
        state: TERMINAL_STATES.has(result.status) ? result.status : "failed",
        blockerCode: normalizeString(result.blockerCode, ""),
        resultSummary: normalizeString(
          result.reducedSummary?.summaryText || result.childResultPreview || result.outputText || result.blockerCode,
          result.status === "completed" ? "Child agent completed." : `Child agent ${result.status || "failed"}.`,
        ),
        resultDigest: normalizeString(result.resultDigest, ""),
        epistemicCapture: result.epistemicCapture,
        evidenceConfidence: normalizeString(result.resultEnvelope?.confidence, "unknown"),
        workspaceExecution: result.workspaceExecution,
        mutationOutcome: result.mutationOutcome,
      });
    }).catch((error) => {
      if (record._settled) return;
      if (
        record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE &&
        error?.workspaceBackendRequest === true &&
        error?.backendQuiesced !== true &&
        !record._cancelRequested
      ) {
        this.markBackendQuiescenceUnacknowledged(record, error);
        return;
      }
      const aborted = record._abortController?.signal.aborted || error?.name === "AbortError";
      const mutationOutcome = safeMutationOutcome(error?.mutationOutcome);
      if (record._cancelRequested && !this.workspaceCancellationQuiesced(record, error)) {
        this.markCancellationUnacknowledged(record, error);
        return;
      }
      if (
        mutationOutcome?.partialMutationPossible === true &&
        (!record._cancelRequested || this.workspaceCancellationQuiesced(record, error))
      ) {
        if (record._cancelRequested) record._cancelAcknowledgedAt = nowIso(this.now);
        this.settleRecord(record, {
          state: "failed",
          blockerCode: "workspace_backend_mutation_commit_failed_indeterminate",
          resultSummary: "Workspace mutation may be partial; inspect retained evidence before any retry.",
          mutationOutcome,
          epistemicCapture: { status: "unavailable", errorCode: mutationOutcome.failureCode },
          evidenceConfidence: "partial",
        });
        return;
      }
      const blockerCode = aborted
        ? "direct_agent_provider_aborted"
        : publicAgentErrorCode(error?.code, "direct_agent_runtime_exception");
      if (record._cancelRequested) record._cancelAcknowledgedAt = nowIso(this.now);
      this.settleRecord(record, {
        state: aborted ? "cancelled" : "failed",
        blockerCode: record._cancelRequested ? record._cancelReasonCode : blockerCode,
        resultSummary: record._cancelRequested ? record._cancelReasonCode : blockerCode,
        epistemicCapture: {
          status: "unavailable",
          errorCode: blockerCode,
        },
        evidenceConfidence: "partial",
      });
    });
  }

  workspaceCancellationQuiesced(record, evidence = {}) {
    if (record?.workspaceMode !== WORKSPACE_MODE_ISOLATED_WORKTREE) return true;
    if (preStartCancellationReceipt(record, evidence)) return true;
    return Boolean(admittedWorkspaceWorkerCancellationReceipt(evidence, {
      childAgentId: record.childAgentId,
      projectId: record.projectId,
      workThreadId: record.workThreadId,
      primaryThreadId: record.primaryThreadId,
      launchDigest: record.launchDigest,
      lifecycleSessionId: record._lifecycleSessionId,
      lifecycleLeaseId: normalizeString(record._lifecycleProjection?.leaseId, ""),
      cancellationReasonCode: record._cancelReasonCode,
    }));
  }

  markCancellationUnacknowledged(record, evidence = {}) {
    const mutationOutcome = safeMutationOutcome(evidence?.mutationOutcome);
    if (mutationOutcome) {
      const lifecycleError = this.transitionLifecycle(record, "recordMutationOutcome", {
        operationId: `pool-record-mutation-outcome:${record.childAgentId}:${mutationOutcome.outcomeDigest.slice(7, 31)}`,
        mutationOutcome,
      });
      if (lifecycleError) record._lifecycleErrorCode = lifecycleError;
      record.mutationOutcome = mutationOutcome;
      record.partialMutationPossible = mutationOutcome.partialMutationPossible === true;
    }
    record.state = "cancellation_unacknowledged";
    record.blockerCode = safeWorkspaceStatusCode(
      evidence?.code || evidence?.blockerCode,
      "direct_workspace_worker_cancellation_unacknowledged",
    );
    record.resultSummary = record.blockerCode;
    record._lifecycleErrorCode = record.blockerCode;
    this.emit("changed", this.publicRecord(record));
  }

  markBackendQuiescenceUnacknowledged(record, evidence = {}) {
    const reasonCode = normalizeCancellationReason(
      publicAgentErrorCode(
        evidence?.code || evidence?.blockerCode,
        "direct_workspace_worker_backend_quiescence_unacknowledged",
      ),
      "direct_workspace_worker_backend_quiescence_unacknowledged",
    );
    record._cancelRequested = true;
    record._cancelReasonCode = reasonCode;
    record._cancelRequestedAt = nowIso(this.now);
    const lifecycleError = this.transitionLifecycle(record, "requestCancellation", {
      operationId: `pool-request-cancel:${record.childAgentId}`,
      reasonCode,
    });
    if (lifecycleError) record._lifecycleErrorCode = lifecycleError;
    if (record._abortController && !record._abortController.signal.aborted) {
      record._abortController.abort(reasonCode);
    }
    this.markCancellationUnacknowledged(record, evidence);
  }

  safeLifecycleProjection(session) {
    if (!session) return null;
    return {
      schema: session.schema,
      sessionId: session.sessionId,
      leaseId: session.leaseId,
      state: session.state,
      leaseState: session.leaseState,
      processState: session.processState,
      revision: session.revision,
      bindingDigest: normalizeString(session.binding?.bindingDigest, ""),
      mutationOutcomeDigest: normalizeString(session.mutationOutcome?.outcomeDigest, ""),
      partialMutationPossible: session.mutationOutcome?.partialMutationPossible === true,
      launchDigest: normalizeString(session.launchDigest, ""),
      cancellationReceiptDigest: normalizeString(session.cancellationReceipt?.receiptDigest, ""),
      launchOperationId: normalizeString(session.launchIdentity?.launchOperationId, ""),
      launchIdentityDigest: safeDigest(session.launchIdentity?.launchIdentityDigest, ""),
      delegationAuthorityDigest: safeDigest(session.delegationAuthority?.authorityDigest, ""),
      rawWorkspacePathIncluded: false,
    };
  }

  transitionLifecycle(record, method, input = {}) {
    if (!record?._lifecycleSessionId || !this.workspaceWorkerLifecycleRegistry) return "";
    try {
      const session = this.workspaceWorkerLifecycleRegistry[method](record._lifecycleSessionId, input);
      record._lifecycleProjection = this.safeLifecycleProjection(session);
      record._lifecycleErrorCode = "";
      return "";
    } catch (error) {
      const code = normalizeString(error?.code, "direct_workspace_worker_lifecycle_transition_failed");
      record._lifecycleErrorCode = code;
      return code;
    }
  }

  bindWorkspaceForChild(childAgentId, input = {}) {
    const record = this.jobs.get(normalizeString(childAgentId, ""));
    if (!record || !record._lifecycleSessionId) {
      const error = new Error("direct_workspace_worker_lifecycle_session_missing");
      error.code = "direct_workspace_worker_lifecycle_session_missing";
      throw error;
    }
    const lifecycleError = this.transitionLifecycle(record, "bindWorkspace", {
      operationId: normalizeString(input.operationId, `pool-bind:${record.childAgentId}`),
      binding: input.binding,
    });
    if (lifecycleError) {
      const error = new Error(lifecycleError);
      error.code = lifecycleError;
      throw error;
    }
    this.emit("changed", this.publicRecord(record));
    return record._lifecycleProjection;
  }

  beginWorkspaceProvisioning(childAgentId, input = {}) {
    const record = this.jobs.get(normalizeString(childAgentId, ""));
    if (!record || !record._lifecycleSessionId) {
      const error = new Error("direct_workspace_worker_lifecycle_session_missing");
      error.code = "direct_workspace_worker_lifecycle_session_missing";
      throw error;
    }
    const lifecycleError = this.transitionLifecycle(record, "beginProvisioning", {
      operationId: normalizeString(input.operationId, `pool-provision:${record.childAgentId}`),
      workerKey: input.workerKey,
      branchName: input.branchName,
    });
    if (lifecycleError) {
      const error = new Error(lifecycleError);
      error.code = lifecycleError;
      throw error;
    }
    this.emit("changed", this.publicRecord(record));
    return record._lifecycleProjection;
  }

  commitLifecycleSettlement(record, patch = {}) {
    if (!record?._lifecycleSessionId || !this.workspaceWorkerLifecycleRegistry) return "";
    try {
      const session = this.workspaceWorkerLifecycleRegistry.session(record._lifecycleSessionId);
      if (!session) return "direct_workspace_worker_lifecycle_session_missing";
      if (TERMINAL_STATES.has(session.state)) {
        const expectedState = patch.state === "completed"
          ? "completed"
          : patch.state === "cancelled" ? "cancelled" : "failed";
        if (session.state !== expectedState) {
          return "direct_workspace_worker_lifecycle_settlement_conflict";
        }
        const expectedMutationOutcome = safeMutationOutcome(patch.mutationOutcome);
        const storedMutationOutcome = safeMutationOutcome(session.mutationOutcome);
        if (
          normalizeString(expectedMutationOutcome?.outcomeDigest, "") !==
          normalizeString(storedMutationOutcome?.outcomeDigest, "")
        ) return "direct_workspace_worker_lifecycle_settlement_conflict";
        const expectedReceipt = isPlainObject(patch.cancellationReceipt)
          ? patch.cancellationReceipt
          : null;
        const expectedCancellationReason = expectedReceipt
          ? normalizeString(record._cancelReasonCode, patch.blockerCode)
          : "";
        const canonicalExpectedReceipt = expectedReceipt
          ? validateWorkspaceWorkerCancellationReceipt(expectedReceipt, expectedMutationOutcome, {
              launchDigest: record.launchDigest,
              lifecycleSessionId: record._lifecycleSessionId,
              lifecycleLeaseId: normalizeString(record._lifecycleProjection?.leaseId, ""),
              cancellationReasonCode: expectedCancellationReason,
            })
          : null;
        if (expectedReceipt && !canonicalExpectedReceipt) {
          return "direct_workspace_worker_lifecycle_settlement_conflict";
        }
        if (
          normalizeString(session.blockerCode, "") !== normalizeString(patch.blockerCode, "") ||
          normalizeString(session.resultDigest, "") !== normalizeString(patch.resultDigest, "") ||
          normalizeString(session.cancellationReceipt?.runtimeReceiptDigest, "") !==
            normalizeString(canonicalExpectedReceipt?.receiptDigest, "") ||
          normalizeString(session.cancellationReceipt?.outcomeDigest, "") !==
            normalizeString(canonicalExpectedReceipt?.outcomeDigest, "") ||
          normalizeString(session.cancellationReceipt?.launchDigest, "") !==
            normalizeString(canonicalExpectedReceipt?.launchDigest, "") ||
          normalizeString(session.cancellationReceipt?.runtimeLifecycleSessionId, "") !==
            normalizeString(canonicalExpectedReceipt?.lifecycleSessionId, "") ||
          normalizeString(session.cancellationReceipt?.runtimeLifecycleLeaseId, "") !==
            normalizeString(canonicalExpectedReceipt?.lifecycleLeaseId, "") ||
          normalizeString(session.cancellationReceipt?.targetRequestId, "") !==
            normalizeString(canonicalExpectedReceipt?.targetRequestId, "") ||
          normalizeString(session.cancellationReceipt?.acknowledgementKind, "") !==
            normalizeString(canonicalExpectedReceipt?.acknowledgementKind, "") ||
          normalizeString(session.cancellationReceipt?.reasonCode, "") !== expectedCancellationReason
        ) return "direct_workspace_worker_lifecycle_settlement_conflict";
        record._lifecycleProjection = this.safeLifecycleProjection(session);
        return "";
      }
      if (patch.state === "cancelled") {
        if (session.state === "registered" || session.state === "active") {
          const requestError = this.transitionLifecycle(record, "requestCancellation", {
            operationId: `pool-request-cancel:${record.childAgentId}`,
            reasonCode: record._cancelReasonCode || patch.blockerCode,
          });
          if (requestError) return requestError;
        }
        const current = this.workspaceWorkerLifecycleRegistry.session(record._lifecycleSessionId);
        if (current.state === "cancelled") {
          record._lifecycleProjection = this.safeLifecycleProjection(current);
          return "";
        }
        return this.transitionLifecycle(record, "acknowledgeCancellation", {
          operationId: `pool-ack-cancel:${record.childAgentId}`,
          reasonCode: record._cancelReasonCode || patch.blockerCode,
          blockerCode: patch.blockerCode,
          resultDigest: patch.resultDigest,
          mutationOutcome: patch.mutationOutcome,
          cancellationReceipt: patch.cancellationReceipt,
        });
      }
      return this.transitionLifecycle(record, "settleSession", {
        operationId: `pool-settle:${record.childAgentId}:${patch.state}`,
        state: patch.state === "completed" ? "completed" : "failed",
        blockerCode: patch.blockerCode,
        resultDigest: patch.resultDigest,
        mutationOutcome: patch.mutationOutcome,
        cancellationReceipt: patch.cancellationReceipt,
      });
    } catch (error) {
      const code = normalizeString(error?.code, "direct_workspace_worker_lifecycle_settlement_failed");
      record._lifecycleErrorCode = code;
      return code;
    }
  }

  settleRecord(record, patch = {}) {
    if (!record || record._settled) return false;
    let settledState = TERMINAL_STATES.has(patch.state) ? patch.state : "failed";
    const isolatedWorkspace = record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE;
    if (isolatedWorkspace && settledState === "timeout") settledState = "failed";
    const originalBlockerCode = normalizeString(patch.blockerCode, "");
    const blockerFallback = settledState === "completed"
      ? ""
      : settledState === "cancelled"
        ? "direct_agent_cancelled"
        : isolatedWorkspace && patch.state === "timeout"
          ? "direct_workspace_worker_timeout"
        : `direct_agent_child_${settledState}`;
    const blockerCode = settledState === "completed"
      ? ""
      : publicAgentErrorCode(originalBlockerCode, blockerFallback);
    const suppliedSummary = normalizeString(patch.resultSummary, "");
    const projectedMutationOutcome = safeMutationOutcome(patch.mutationOutcome);
    const isolatedSummary = settledState === "completed"
      ? "Workspace worker completed."
      : projectedMutationOutcome?.partialMutationPossible === true
        ? "Workspace mutation may be partial; inspect retained evidence before any retry."
        : blockerCode;
    patch = {
      ...patch,
      state: settledState,
      blockerCode,
      resultSummary: isolatedWorkspace
        ? isolatedSummary
        : suppliedSummary && suppliedSummary !== originalBlockerCode
          ? suppliedSummary
          : blockerCode || "Child agent completed.",
      resultDigest: publicResultDigest(patch.resultDigest),
    };
    let workspaceExecution = null;
    if (isPlainObject(patch.workspaceExecution)) {
      try {
        workspaceExecution = safeWorkspaceExecutionProjection(patch.workspaceExecution);
      } catch (error) {
        patch = {
          ...patch,
          state: "failed",
          blockerCode: normalizeString(error?.code, "direct_workspace_worker_execution_projection_unsafe"),
          resultSummary: "Workspace worker execution evidence was rejected at the public projection boundary.",
        };
        workspaceExecution = {
          schema: "direct_workspace_worker_execution@1",
          status: "failed",
          workspaceMode: record.workspaceMode,
          toolProfile: record.toolProfile,
          rawWorkspacePathIncluded: false,
        };
      }
    }
    if (record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE) {
      const safeBlockerCode = safeWorkspaceStatusCode(
        patch.blockerCode,
        patch.state === "completed" ? "" : "direct_workspace_worker_failed",
      );
      patch = {
        ...patch,
        blockerCode: safeBlockerCode,
        resultSummary: typedWorkspaceResultSummary(record, {
          ...patch,
          blockerCode: safeBlockerCode,
        }),
        resultDigest: safeDigest(patch.resultDigest, record.resultDigest),
      };
    }
    const lifecycleError = this.commitLifecycleSettlement(record, patch);
    if (lifecycleError) {
      record._settlementAttempts += 1;
      record.state = "settlement_blocked";
      record.blockerCode = lifecycleError;
      record.resultSummary = lifecycleError;
      record._pendingSettlement = { ...patch };
      this.emit("changed", this.publicRecord(record));
      return false;
    }
    record._settled = true;
    record.state = patch.state;
    record.blockerCode = patch.blockerCode;
    record.resultSummary = normalizeString(
      patch.resultSummary || record.blockerCode,
      record.state === "completed" ? "Child agent completed." : `Child agent ${record.state}.`,
    );
    record.resultDigest = patch.resultDigest;
    const mutationOutcome = safeMutationOutcome(patch.mutationOutcome);
    if (mutationOutcome) {
      record.mutationOutcome = mutationOutcome;
      record.partialMutationPossible = mutationOutcome.partialMutationPossible === true;
    }
    if (isPlainObject(patch.cancellationReceipt)) {
      record._cancellationReceipt = {
        receiptDigest: normalizeString(patch.cancellationReceipt.receiptDigest, ""),
        acknowledgementKind: normalizeString(patch.cancellationReceipt.acknowledgementKind, ""),
        outcomeDigest: normalizeString(patch.cancellationReceipt.outcomeDigest, ""),
      };
    }
    record.resultSummaryKind = record.workspaceMode === WORKSPACE_MODE_ISOLATED_WORKTREE
      ? "typed_status_code"
      : "provider_summary";
    if (workspaceExecution) record.workspaceExecution = workspaceExecution;
    const capture = normalizeEpistemicCapture(patch.epistemicCapture || record.epistemicCapture);
    record.epistemicCapture = {
      status: capture.status,
      errorCode: capture.errorCode,
      receiptDigest: capture.receiptDigest,
      sessionId: capture.sessionId,
      turnId: capture.turnId,
    };
    record.epistemicCaptureComplete = capture.complete;
    record.epistemicCaptureOmission = capture.omission;
    record.evidenceConfidence = publicEvidenceConfidence(
      patch.evidenceConfidence,
      capture.complete ? "exact" : "partial",
    );
    record.completedAt = nowIso(this.now);
    record._task = "";
    record._contextMessages = [];
    record._project = null;
    record._parentAuthorityPacket = null;
    record._pendingSettlement = null;
    this.queue = this.queue.filter((childAgentId) => childAgentId !== record.childAgentId);
    if (record._leaseActive) {
      record._leaseActive = false;
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    if (record._externalSignal?.removeEventListener && record._externalAbortListener) {
      record._externalSignal.removeEventListener("abort", record._externalAbortListener);
    }
    record._externalAbortListener = null;
    const publicRecord = this.publicRecord(record);
    for (const waiter of record._waiters) waiter(publicRecord);
    record._waiters.clear();
    this.emit("changed", publicRecord);
    if (!this.closed) this.drain();
    return true;
  }

  cancelRecord(record, blockerCode = "direct_agent_pool_closed") {
    if (!record || record._settled) return false;
    if (record._cancelRequested) return true;
    const reasonCode = normalizeCancellationReason(blockerCode);
    record._cancelRequested = true;
    record._cancelReasonCode = reasonCode;
    record._cancelRequestedAt = nowIso(this.now);
    const lifecycleError = this.transitionLifecycle(record, "requestCancellation", {
      operationId: `pool-request-cancel:${record.childAgentId}`,
      reasonCode,
    });
    if (lifecycleError) record._lifecycleErrorCode = lifecycleError;
    if (!record._leaseActive) {
      record._cancelAcknowledgedAt = nowIso(this.now);
      return this.settleRecord(record, {
        state: "cancelled",
        blockerCode: reasonCode,
        resultSummary: reasonCode,
        epistemicCapture: {
          status: "unavailable",
          errorCode: reasonCode,
        },
        evidenceConfidence: "partial",
      });
    }
    record.state = "cancelling";
    if (record._abortController && !record._abortController.signal.aborted) {
      record._abortController.abort(reasonCode);
    }
    this.emit("changed", this.publicRecord(record));
    return true;
  }

  close(options = {}) {
    this.stopAccepting(options);
    this.requestCancellationForAll(options);
    return this.descriptor();
  }

  stopAccepting(options = {}) {
    this.closed = true;
    const blockerCode = normalizeString(options.reasonCode, "direct_agent_pool_closed");
    this.closeReasonCode = blockerCode;
    return this.descriptor();
  }

  requestCancellationForAll(options = {}) {
    if (!this.closed) this.stopAccepting(options);
    if (this.cancellationRequestedAll) return this.descriptor();
    const blockerCode = normalizeString(
      options.reasonCode,
      this.closeReasonCode || "direct_agent_pool_closed",
    );
    this.retryPendingSettlements({ attempts: this.settlementRetryAttempts });
    this.cancellationRequestedAll = true;
    const pending = [...this.jobs.values()].filter((record) =>
      !record._settled && !record._pendingSettlement);
    this.queue = [];
    for (const record of pending) this.cancelRecord(record, blockerCode);
    this.routes.clear();
    return this.descriptor();
  }

  async drainAndClose(options = {}) {
    const recovery = this.recoverySnapshot();
    if (recovery.status !== "clean") {
      this.stopAccepting(options);
      return {
        status: "reconciliation_required",
        blockerCode: "direct_workspace_worker_restart_reconciliation_required",
        recovery,
        pool: this.descriptor(),
      };
    }
    this.close(options);
    this.retryPendingSettlements({ attempts: this.settlementRetryAttempts });
    const timeoutMs = boundedInteger(options.timeoutMs, 30_000, 0, 300_000);
    if (this.activeCount === 0) {
      return { status: "drained", blockerCode: "", pool: this.descriptor() };
    }
    if (timeoutMs === 0) {
      return { status: "timeout", blockerCode: "direct_agent_pool_drain_timeout", pool: this.descriptor() };
    }
    return new Promise((resolve) => {
      let finished = false;
      let retryTimer = null;
      const finish = (status) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearInterval(retryTimer);
        this.removeListener("changed", onChanged);
        resolve({
          status,
          blockerCode: status === "drained" ? "" : "direct_agent_pool_drain_timeout",
          pool: this.descriptor(),
        });
      };
      const onChanged = () => {
        this.retryPendingSettlements({ attempts: this.settlementRetryAttempts });
        if (this.activeCount === 0) finish("drained");
      };
      this.on("changed", onChanged);
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      retryTimer = setInterval(onChanged, Math.min(50, Math.max(10, timeoutMs)));
      retryTimer.unref?.();
      onChanged();
    });
  }

  interrupt(input = {}) {
    const record = this.resolveTarget(
      input.target || input.childAgentId || input.taskName || input.task_name,
      input,
    );
    if (!record) {
      return { status: "blocked", blockerCode: "target_agent_missing", record: null, pool: this.descriptor() };
    }
    const requestedReasonCode = normalizeString(input.reasonCode, "direct_agent_interrupted");
    if (!CANCELLATION_REASON_PATTERN.test(requestedReasonCode)) {
      return {
        status: "blocked",
        blockerCode: "direct_agent_cancellation_reason_invalid",
        record: this.publicRecord(record),
        pool: this.descriptor(),
      };
    }
    this.cancelRecord(record, requestedReasonCode);
    return {
      status: TERMINAL_STATES.has(record.state) ? "completed" : "cancelling",
      blockerCode: "",
      record: this.publicRecord(record),
      pool: this.descriptor(),
    };
  }

  retrySettlement(input = {}) {
    const record = this.resolveTarget(
      input.target || input.childAgentId || input.taskName || input.task_name,
      input,
    );
    if (!record || !record._pendingSettlement) return false;
    const patch = record._pendingSettlement;
    record._pendingSettlement = null;
    return this.settleRecord(record, patch);
  }

  retryPendingSettlements(input = {}) {
    if (this._retryingSettlements) {
      return {
        status: "reconciliation_required",
        blockerCode: "direct_workspace_worker_settlement_retry_in_progress",
        remainingChildAgentIds: [...this.jobs.values()]
          .filter((record) => !record._settled && record._pendingSettlement)
          .map((record) => record.childAgentId),
        attempts: 0,
      };
    }
    const attempts = boundedInteger(input.attempts, this.settlementRetryAttempts, 1, 10);
    this._retryingSettlements = true;
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const pending = [...this.jobs.values()].filter((record) =>
          !record._settled && record._pendingSettlement &&
          record._settlementAttempts < this.settlementRetryAttempts);
        if (!pending.length) break;
        for (const record of pending) this.retrySettlement({ childAgentId: record.childAgentId });
      }
    } finally {
      this._retryingSettlements = false;
    }
    const remaining = [...this.jobs.values()].filter((record) =>
      !record._settled && record._pendingSettlement);
    return {
      status: remaining.length ? "reconciliation_required" : "settled",
      blockerCode: remaining.length ? "direct_workspace_worker_settlement_reconciliation_required" : "",
      remainingChildAgentIds: remaining.map((record) => record.childAgentId),
      attempts,
    };
  }

  drain() {
    if (this.closed) return;
    while (this.activeCount < this.maxActiveChildren && this.queue.length) {
      const childAgentId = this.queue.shift();
      const record = this.jobs.get(childAgentId);
      if (record?.state === "queued") this.startRecord(record);
    }
  }

  publicRecord(record) {
    if (!record) return null;
    return {
      schema: DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
      childAgentId: record.childAgentId,
      taskName: record.taskName,
      projectId: record.projectId,
      workThreadId: record.workThreadId,
      primaryThreadId: record.primaryThreadId,
      launchDigest: record.launchDigest,
      parentAgentId: record.parentAgentId,
      role: record.role,
      providerRoleLabelAcceptedAsAuthority: false,
      providerRoleLabelIgnored: record.providerRoleLabelIgnored === true,
      displayLabel: record.displayLabel,
      state: record.state,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      workspaceMode: record.workspaceMode,
      toolProfile: record.toolProfile,
      workspaceExecution: record.workspaceExecution
        ? safeWorkspaceExecutionProjection(record.workspaceExecution)
        : null,
      contextHandoff: record.contextHandoff,
      contextMessageCount: record.contextMessageCount,
      contextDigest: record.contextDigest,
      taskDigest: record.taskDigest,
      runtimeProfileIndependentOfContext: true,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      resultSummary: record.resultSummary,
      resultSummaryKind: record.resultSummaryKind,
      blockerCode: record.blockerCode,
      resultDigest: record.resultDigest,
      mutationOutcome: record.mutationOutcome ? { ...record.mutationOutcome } : null,
      partialMutationPossible: record.partialMutationPossible === true,
      epistemicCapture: { ...record.epistemicCapture },
      epistemicCaptureComplete: record.epistemicCaptureComplete === true,
      epistemicCaptureOmission: record.epistemicCaptureOmission
        ? { ...record.epistemicCaptureOmission }
        : null,
      evidenceConfidence: record.evidenceConfidence,
      cancellation: {
        requested: record._cancelRequested === true,
        reasonCode: record._cancelReasonCode,
        requestedAt: record._cancelRequestedAt,
        acknowledged: Boolean(record._cancelAcknowledgedAt),
        acknowledgedAt: record._cancelAcknowledgedAt,
        leaseActive: record._leaseActive === true,
        receiptDigest: normalizeString(
          record._lifecycleProjection?.cancellationReceiptDigest,
          normalizeString(record._cancellationReceipt?.receiptDigest, ""),
        ),
        acknowledgementKind: normalizeString(record._cancellationReceipt?.acknowledgementKind, ""),
        outcomeDigest: normalizeString(record._cancellationReceipt?.outcomeDigest, ""),
      },
      workspaceLifecycle: record._lifecycleProjection ? { ...record._lifecycleProjection } : null,
      lifecycleErrorCode: record._lifecycleErrorCode,
      rawTaskIncluded: false,
      rawContextIncluded: false,
    };
  }

  records(input = {}) {
    const projectId = normalizeString(input.projectId, "");
    const primaryThreadId = normalizeString(input.primaryThreadId, "");
    return [...this.jobs.values()]
      .filter((record) => (!projectId || record.projectId === projectId) &&
        (!primaryThreadId || record.primaryThreadId === primaryThreadId))
      .map((record) => this.publicRecord(record));
  }

  resolveTarget(target, input = {}) {
    const text = normalizeString(target, "");
    const projectId = normalizeString(input.projectId, "");
    const primaryThreadId = normalizeString(input.primaryThreadId, "");
    if (this.jobs.has(text)) {
      const record = this.jobs.get(text);
      return (
        (!projectId || record.projectId === projectId) &&
        (!primaryThreadId || record.primaryThreadId === primaryThreadId)
      ) ? record : null;
    }
    return [...this.jobs.values()].find((record) =>
      record.taskName === text &&
      (!projectId || record.projectId === projectId) &&
      (!primaryThreadId || record.primaryThreadId === primaryThreadId)) || null;
  }

  inspect(input = {}) {
    const record = this.resolveTarget(
      input.target || input.childAgentId || input.taskName || input.task_name,
      input,
    );
    return record ? this.publicRecord(record) : null;
  }

  async wait(input = {}) {
    const rawTargets = Array.isArray(input.targets)
      ? input.targets
      : [input.target || input.childAgentId || input.taskName || input.task_name].filter(Boolean);
    const records = rawTargets.map((target) => this.resolveTarget(target, input)).filter(Boolean);
    if (!records.length) {
      return { status: "blocked", blockerCode: "target_agent_missing", updates: [], pool: this.descriptor() };
    }
    const terminal = records.filter((record) => TERMINAL_STATES.has(record.state));
    if (terminal.length) {
      return { status: "completed", blockerCode: "", updates: terminal.map((record) => this.publicRecord(record)), pool: this.descriptor() };
    }
    const timeoutMs = boundedInteger(input.timeoutMs ?? input.timeout_ms, 30_000, 0, 300_000);
    if (timeoutMs === 0) {
      return { status: "timeout", blockerCode: "", updates: [], pool: this.descriptor() };
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const record of records) record._waiters.delete(onUpdate);
        resolve(payload);
      };
      const onUpdate = (record) => finish({
        status: "completed",
        blockerCode: "",
        updates: [record],
        pool: this.descriptor(),
      });
      for (const record of records) record._waiters.add(onUpdate);
      const timer = setTimeout(() => finish({
        status: "timeout",
        blockerCode: "",
        updates: [],
        pool: this.descriptor(),
      }), timeoutMs);
    });
  }

  statusSurface(input = {}) {
    const scoped = { projectId: input.projectId, primaryThreadId: input.primaryThreadId };
    const resultBase = (toolName, result, blockerCode = "") => ({
      schema: "direct_live_sub_agent_tool_result@1",
      toolName,
      status: blockerCode ? "blocked" : "completed",
      blockerCode,
      projectId: normalizeString(input.projectId, "project_direct_agents"),
      workThreadId: normalizeString(input.workThreadId, "work_thread_direct_agents"),
      primaryThreadId: normalizeString(input.primaryThreadId, "primary_direct_agent"),
      graphRevision: this.jobs.size,
      providerTransportStarted: false,
      providerDeclarationStarted: false,
      workspaceMutationStarted: false,
      childTranscriptPromotionStarted: false,
      parentSelfBindingRespected: true,
      result,
      rawPromptIncluded: false,
      rawTranscriptIncluded: false,
      rawProviderFrameIncluded: false,
      rawSecretIncluded: false,
      observedAt: nowIso(this.now),
    });
    return {
      listAgents: () => {
        const rows = this.records(scoped);
        return resultBase("list_agents", {
          listProjection: {
            schema: "direct_native_agent_list_projection@1",
            rowCount: rows.length,
            activeCount: rows.filter((row) => ["running", "accepted", "cancelling", "cancellation_unacknowledged", "settlement_blocked"].includes(row.state)).length,
            queuedCount: rows.filter((row) => row.state === "queued").length,
            terminalCount: rows.filter((row) => TERMINAL_STATES.has(row.state)).length,
            rows,
          },
          pool: this.descriptor(),
        });
      },
      inspectAgent: (args = {}) => {
        const record = this.inspect({ ...scoped, ...args, target: args.childAgentId || args.taskName });
        return resultBase("inspect_agent", record ? { inspectPacket: record, pool: this.descriptor() } : {}, record ? "" : "target_agent_missing");
      },
    };
  }
}

module.exports = {
  DIRECT_NATIVE_AGENT_LAUNCH_SCHEMA,
  DIRECT_NATIVE_AGENT_POOL_SCHEMA,
  DIRECT_NATIVE_AGENT_STATUS_SCHEMA,
  DirectNativeAgentPool,
  normalizeForkTurns,
  selectContextMessages,
};
