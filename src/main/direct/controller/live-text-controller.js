"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  buildTextOnlyProbeRequest,
  requestShapeForDiagnostic,
  runPersistedReadOnlyToolContinuation,
  runTextOnlyDirectProbe,
} = require("../transport/codex-responses-transport");
const {
  DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
  assistantTextFromNormalizedEvents,
  checkpointTerminalFromEvents,
} = require("../import/checkpoint-continuation");
const { toolTranscriptItemFromObligation } = require("../session/session-store");
const {
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  cancelReadOnlyToolObligation,
  declineReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
} = require("../tools/read-only-authority");

const DIRECT_LIVE_TEXT_SURFACE_TRANSPORT = "direct-live-text";
const ACTIVE_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
]);
const TERMINAL_TURN_STATES = new Set(["completed", "failed", "aborted"]);
const DEFAULT_MAX_PROMPT_CHARS = 64_000;
const DEFAULT_MAX_ASSISTANT_CHARS = 256_000;
const DEFAULT_READONLY_WORKSPACE_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_DECISION_CACHE_LIMIT = 512;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nowSeconds() {
  return Date.now() / 1000;
}

function boundedPositiveInteger(value, fallback, min = 1, max = 10_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function firstTextInput(input) {
  const entries = Array.isArray(input) ? input : [];
  for (const entry of entries) {
    if (typeof entry?.text === "string" && entry.text.trim()) return entry.text.trim();
  }
  return "";
}

function workspaceDisplayPath(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return normalizeString(workspace.linuxPath, "");
  if (workspace.kind === "local") return normalizeString(workspace.localPath, "");
  return normalizeString(project.repoPath, "");
}

function modelEntries(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  return Array.isArray(models) ? models.filter((model) => isPlainObject(model) && model.id) : [];
}

function modelEvidenceState(status) {
  if (status === "accepted") return "accepted";
  if (status === "probed" || status === "runtime_probed") return "runtime_probed";
  if (status === "rejected") return "rejected";
  if (status === "observed" || status === "unstable") return "candidate";
  return "unknown";
}

function modelEvidenceFor(profileDoc = {}, requestedModel = "") {
  const entries = modelEntries(profileDoc);
  const requested = normalizeString(requestedModel, "");
  const entry = (requested ? entries.find((model) => model.id === requested) : null) ||
    entries.find((model) => ["accepted", "probed", "runtime_probed"].includes(model.status)) ||
    entries.find((model) => model.status !== "rejected") ||
    null;
  const state = modelEvidenceState(entry?.status);
  return {
    model: normalizeString(entry?.id, requested || "gpt-5.4"),
    modelSource: "odeu-profile",
    modelEvidenceState: state,
    accepted: state === "accepted" || state === "runtime_probed",
    entry: entry || null,
  };
}

function readOnlyContinuationEvidenceFor(profileDoc = {}) {
  const shapes = profileDoc.profile?.ontology?.continuationShapes;
  const entries = Array.isArray(shapes) ? shapes : [];
  const entry = entries.find((shape) =>
    shape?.id === "continuation.tool_result" ||
    String(shape?.field || "").toLowerCase().includes("tool-result") ||
    String(shape?.field || "").toLowerCase().includes("tool result"));
  const state = modelEvidenceState(entry?.status);
  const accepted = state === "accepted" || state === "runtime_probed";
  return {
    accepted,
    status: accepted ? "ready" : "profile_required",
    capabilityId: normalizeString(entry?.id, "continuation.tool_result"),
    evidenceState: state,
    reason: accepted ? "" : "accepted_readonly_tool_continuation_required",
  };
}

function sanitizeStatus(status = {}) {
  return {
    status: normalizeString(status.status, "unauthenticated"),
    accountId: normalizeString(status.accountId, ""),
    expiresAt: Number(status.expiresAt || 0),
    expiresInMs: Number(status.expiresInMs || 0),
    hasAccessToken: Boolean(status.hasAccessToken),
    hasRefreshToken: Boolean(status.hasRefreshToken),
    storageMode: normalizeString(status.storageMode, ""),
    rawTokensExposed: false,
  };
}

function buildDirectLiveTextCapabilities(status = {}) {
  const ready = status.status === "ready";
  const readOnlyToolReady = ready && status.readOnlyToolContinuation?.status === "ready";
  return {
    version: 1,
    status: ready ? "ready" : "blocked",
    generatedAt: nowIso(),
    coreRuntime: {
      canConnect: true,
      canInitialize: true,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      transports: [DIRECT_LIVE_TEXT_SURFACE_TRANSPORT],
      schemaSource: "direct-live-text-controller",
    },
    threads: {
      canStart: ready,
      canRead: true,
      canResume: false,
      canList: false,
      canFork: false,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: ready,
      canSteer: false,
      canInterrupt: true,
      canOverrideModel: false,
      canOverrideReasoning: false,
      canUseOutputSchema: false,
    },
    authority: {
      commandApproval: false,
      fileChangeApproval: false,
      permissionsApproval: false,
      approvalPolicies: ["explicit-read-only-tool"],
      sandboxModes: [],
      readOnlyToolApproval: readOnlyToolReady,
    },
    requests: {
      supportedServerMethods: readOnlyToolReady ? ["direct/tool/readOnly/requestApproval"] : [],
      unsupportedButHandledMethods: [],
      unknownRequestPolicy: "error-visible",
    },
    diagnostics: {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      source: "direct-live-text-controller",
      appServerRequired: false,
      toolsEnabled: readOnlyToolReady,
      rawBackendFramesExposed: false,
    },
  };
}

function threadSnapshotFromSession(session = {}) {
  return {
    id: session.sessionId,
    title: normalizeString(session.title, "Direct live text session"),
    preview: normalizeString(session.title, "Direct live text session"),
    turns: Array.isArray(session.messages) ? session.messages : [],
    model: normalizeString(session.model, ""),
  };
}

function terminalStatusForState(state) {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "aborted") return "aborted";
  if (state === "tool_waiting") return "tool_waiting";
  if (state === "streaming" || state === "request_built" || state === "created") return "inProgress";
  return normalizeString(state, "unknown");
}

function turnSnapshot(turn = {}) {
  return {
    id: turn.turnId,
    status: terminalStatusForState(turn.state),
    state: turn.state,
    startedAt: turn.streamStartedAt ? Date.parse(turn.streamStartedAt) / 1000 : Date.parse(turn.createdAt || nowIso()) / 1000,
    completedAt: turn.completedAt ? Date.parse(turn.completedAt) / 1000 : 0,
    error: turn.error || null,
    clientTurnRequestId: normalizeString(turn.clientTurnRequestId, ""),
  };
}

class DirectLiveTextController {
  constructor(options = {}) {
    this.sessionStore = options.sessionStore;
    this.profileDoc = isPlainObject(options.profileDoc) ? options.profileDoc : {};
    this.authStore = options.authStore || null;
    this.directThreadStore = options.directThreadStore || options.threadStore || null;
    this.refreshCredentials = typeof options.refreshCredentials === "function" ? options.refreshCredentials : null;
    this.modelEvidenceResolver = typeof options.modelEvidenceResolver === "function" ? options.modelEvidenceResolver : null;
    this.activationStatusResolver = typeof options.activationStatusResolver === "function" ? options.activationStatusResolver : null;
    this.fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : null;
    this.workspaceRequest = typeof options.workspaceRequest === "function" ? options.workspaceRequest : null;
    this.endpoint = normalizeString(options.endpoint, "");
    this.maxPromptChars = Number(options.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS);
    this.maxAssistantChars = Number(options.maxAssistantChars || DEFAULT_MAX_ASSISTANT_CHARS);
    this.readOnlyWorkspaceTimeoutMs = boundedPositiveInteger(
      options.readOnlyWorkspaceTimeoutMs,
      DEFAULT_READONLY_WORKSPACE_TIMEOUT_MS,
      1_000,
      10 * 60_000,
    );
    this.toolDecisionCacheLimit = boundedPositiveInteger(options.toolDecisionCacheLimit, DEFAULT_TOOL_DECISION_CACHE_LIMIT, 16, 10_000);
    this.activeRuns = new Map();
    this.toolDecisionLocks = new Map();
    this.toolDecisionClaims = new Map();
    this.toolDecisionResults = new Map();
    this.forkStartLocks = new Map();
  }

  currentAuthStore() {
    const store = typeof this.authStore === "function" ? this.authStore() : this.authStore;
    return store && typeof store.readStatus === "function" ? store : null;
  }

  authStatus() {
    const store = this.currentAuthStore();
    return store
      ? sanitizeStatus(store.readStatus())
      : sanitizeStatus(null);
  }

  currentAuthCredentials() {
    const store = this.currentAuthStore();
    if (!store || typeof store.readCredentials !== "function") return {};
    try {
      return store.readCredentials() || {};
    } catch {
      return {};
    }
  }

  requestedModelForProject(project = {}) {
    return normalizeString(project.surfaceBinding?.codex?.model || project.codex?.model || "", "");
  }

  resolveLiveModelEvidence(project = {}, requestedModel = "") {
    if (!this.modelEvidenceResolver) return null;
    try {
      return this.modelEvidenceResolver({
        project,
        profileDoc: this.profileDoc,
        model: requestedModel,
        endpoint: this.endpoint,
        authStatus: this.authStatus(),
        credentials: this.currentAuthCredentials(),
      }) || null;
    } catch (error) {
      return {
        model: requestedModel,
        modelSource: "live-probe",
        modelEvidenceState: "unknown",
        accepted: false,
        reason: "live_probe_evidence_unavailable",
        liveProbeEvidence: {
          available: false,
          usable: false,
          status: "error",
          reason: error?.message || "live_probe_evidence_unavailable",
          rawTokensExposed: false,
          rawBackendFramesExposed: false,
        },
      };
    }
  }

  modelEvidenceForProject(project = {}) {
    const requestedModel = this.requestedModelForProject(project);
    const staticEvidence = modelEvidenceFor(this.profileDoc, requestedModel);
    const liveEvidence = this.resolveLiveModelEvidence(project, requestedModel || staticEvidence.model);
    if (liveEvidence?.accepted) return liveEvidence;
    return {
      ...staticEvidence,
      reason: liveEvidence?.reason || (staticEvidence.accepted ? "" : "accepted_text_model_required"),
      liveProbeEvidence: liveEvidence?.liveProbeEvidence || null,
      liveProbeEvidenceId: normalizeString(liveEvidence?.evidenceId, ""),
    };
  }

  statusForProject(project = {}) {
    const auth = this.authStatus();
    const evidence = this.modelEvidenceForProject(project);
    const readOnlyToolContinuation = readOnlyContinuationEvidenceFor(this.profileDoc);
    let status = "ready";
    let reason = "";
    if (auth.status !== "authenticated") {
      status = "auth_required";
      reason = "direct_auth_required";
    } else if (!evidence.accepted) {
      status = "profile_required";
      reason = evidence.reason || "accepted_text_model_required";
    }
    return {
      status,
      turnRunnable: status === "ready",
      model: evidence.model,
      modelSource: evidence.modelSource,
      modelEvidenceState: evidence.modelEvidenceState,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      appServerRequired: false,
      toolsEnabled: status === "ready" && readOnlyToolContinuation.status === "ready",
      reason,
      auth,
      evidenceId: normalizeString(evidence.evidenceId || evidence.liveProbeEvidenceId, ""),
      liveProbeEvidence: evidence.liveProbeEvidence || null,
      readOnlyToolContinuation,
    };
  }

  assertReady(project = {}) {
    const status = this.statusForProject(project);
    if (status.status !== "ready") {
      const error = new Error(status.reason || status.status);
      error.code = status.status;
      error.directLiveTextStatus = status;
      throw error;
    }
    if (this.activationStatusResolver) {
      const activation = this.activationStatusResolver(project) || {};
      const canStart = activation.state === "enabled" ||
        (activation.state === "degraded" && activation.degradedCapabilities?.canStartNewTextTurn === true);
      if (!canStart) {
        const reason = activation.state === "eligible"
          ? "direct_experimental_activation_required"
          : (activation.state === "rollback_required" ? "direct_experimental_rollback_required" : "direct_experimental_not_enabled");
        const error = new Error(reason);
        error.code = reason;
        error.directActivationStatus = activation;
        error.directLiveTextStatus = status;
        throw error;
      }
    }
    return status;
  }

  initialize(_params = {}, context = {}) {
    const status = this.statusForProject(context.project || {});
    return {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      capabilities: buildDirectLiveTextCapabilities(status),
      directLiveText: status,
    };
  }

  accountRead() {
    const status = this.authStatus();
    if (status.status === "authenticated") {
      return {
        account: {
          type: "chatgpt",
          planType: "direct-live-text",
          accountId: status.accountId,
        },
        requiresOpenaiAuth: false,
        rawTokensExposed: false,
      };
    }
    return {
      account: null,
      requiresOpenaiAuth: true,
      authStatus: status,
      rawTokensExposed: false,
    };
  }

  startThread(params = {}, context = {}) {
    const project = context.project || {};
    const status = this.assertReady(project);
    const requestedSessionId = normalizeString(params.sessionId || params.threadId, "");
    if (requestedSessionId) {
      const existing = this.sessionStore.readSession(requestedSessionId);
      if (existing) return { thread: threadSnapshotFromSession(existing), model: existing.model };
    }
    const session = this.sessionStore.createSession({
      projectId: normalizeString(project.id, ""),
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: workspaceDisplayPath(project),
      title: `${normalizeString(project.name, "Direct")} live text session`,
      model: status.model,
      runtimeMode: "direct-experimental",
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      modelSource: status.modelSource,
      modelEvidenceState: status.modelEvidenceState,
      modelEvidenceId: normalizeString(status.evidenceId, ""),
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
    });
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
    };
  }

  emitNotification(surfaceSession, method, params = {}) {
    surfaceSession?.sendEvent?.({
      type: "rpc-notification",
      method,
      params,
    });
  }

  findTurnByClientRequestId(session, clientTurnRequestId) {
    const key = normalizeString(clientTurnRequestId, "");
    if (!key) return null;
    const mappedTurnId = normalizeString(session.clientTurnRequests?.[key], "");
    if (mappedTurnId) return this.sessionStore.readTurn(session.sessionId, mappedTurnId);
    for (const summary of Array.isArray(session.turns) ? session.turns : []) {
      const turn = this.sessionStore.readTurn(session.sessionId, summary.turnId);
      if (turn?.clientTurnRequestId === key) return turn;
    }
    return null;
  }

  activeTurnForSession(session) {
    for (const summary of Array.isArray(session.turns) ? session.turns : []) {
      if (!ACTIVE_TURN_STATES.has(summary?.state)) continue;
      const turn = this.sessionStore.readTurn(session.sessionId, summary.turnId);
      if (turn && ACTIVE_TURN_STATES.has(turn.state)) return turn;
    }
    return null;
  }

  rememberClientTurnRequest(sessionId, clientTurnRequestId, turnId) {
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return;
    this.sessionStore.writeSession({
      ...session,
      updatedAt: nowIso(),
      clientTurnRequests: {
        ...(isPlainObject(session.clientTurnRequests) ? session.clientTurnRequests : {}),
        [clientTurnRequestId]: turnId,
      },
    });
  }

  appendSessionTurn(sessionId, turnId, items, model, status) {
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return;
    const nextMessages = [
      ...(Array.isArray(session.messages) ? session.messages.filter((message) => message.id !== turnId) : []),
      {
        id: turnId,
        status,
        items,
      },
    ];
    this.sessionStore.writeSession({
      ...session,
      updatedAt: nowIso(),
      status,
      model: normalizeString(model, session.model),
      messages: nextMessages,
    });
  }

  indexDirectThreadStoreSession(sessionId, options = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.indexSessionArtifacts !== "function") return null;
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return null;
    const turns = this.sessionStore.listTurnIdsFromDisk(sessionId)
      .map((turnId) => this.sessionStore.readTurn(sessionId, turnId))
      .filter(Boolean);
    return store.indexSessionArtifacts(this.sessionStore, session, turns, options);
  }

  prepareDirectContextProjection(sessionId, options = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.buildRendererTranscriptProjection !== "function") return null;
    const turnIds = this.sessionStore.listTurnIdsFromDisk(sessionId);
    if (!turnIds.length) return null;
    this.indexDirectThreadStoreSession(sessionId, options);
    return store.buildRendererTranscriptProjection(sessionId, {
      sessionStore: this.sessionStore,
      nowMs: options.nowMs,
    });
  }

  forkStartRequestShapeHash(input = {}) {
    return sha256(stableStringify({
      schema: "direct_fork_start_live_text@1",
      model: normalizeString(input.model, ""),
      endpointHash: normalizeString(input.endpointHash, ""),
      store: false,
      tools: false,
      previousResponseId: false,
      contextPolicy: "direct_fork_start_from_preview@1",
      roleMapping: "direct_context_role_mapping@1",
      streamEvents: [
        "response_created",
        "message_delta",
        "usage",
        "response_completed",
        "response_failed",
        "response_incomplete",
      ],
    }));
  }

  derivedPreviewForkStartRequestShapeHash(input = {}) {
    return sha256(stableStringify({
      schema: "direct_derived_preview_fork_start_live_text@1",
      sourcePreviewKind: normalizeString(input.sourcePreviewKind, ""),
      model: normalizeString(input.model, ""),
      endpointHash: normalizeString(input.endpointHash, ""),
      store: false,
      tools: false,
      previousResponseId: false,
      contextPolicy: "direct_derived_preview_fork_start@1",
      roleMapping: "direct_context_role_mapping@1",
      streamEvents: [
        "response_created",
        "message_delta",
        "usage",
        "response_completed",
        "response_failed",
        "response_incomplete",
      ],
    }));
  }

  async startForkFromPreview(options = {}) {
    const project = options.project || {};
    const projectId = normalizeString(project.id, "");
    const status = this.assertReady(project);
    const store = this.directThreadStore;
    if (!store) {
      const error = new Error("context_store_unhealthy");
      error.code = "context_store_unhealthy";
      throw error;
    }
    const sourcePreviewId = normalizeString(options.sourcePreviewId, "");
    const clientForkStartId = normalizeString(options.clientForkStartId, "");
    const clientOperationId = normalizeString(options.clientOperationId, "");
    const currentUserPrompt = normalizeString(options.currentUserPrompt, "");
    if (!clientForkStartId || !clientOperationId) {
      const error = new Error("idempotency_key_conflict");
      error.code = "idempotency_key_conflict";
      throw error;
    }
    if (!sourcePreviewId) {
      const error = new Error("source_preview_missing");
      error.code = "source_preview_missing";
      throw error;
    }
    if (!currentUserPrompt) {
      const error = new Error("current_user_prompt_missing");
      error.code = "current_user_prompt_missing";
      throw error;
    }
    const lockKey = `${projectId}:${sourcePreviewId}`;
    if (this.forkStartLocks.has(lockKey) && this.forkStartLocks.get(lockKey) !== clientForkStartId) {
      const error = new Error("active_fork_start_exists");
      error.code = "active_fork_start_exists";
      throw error;
    }
    this.forkStartLocks.set(lockKey, clientForkStartId);
    let planned = null;
    let session = null;
    let turn = null;
    let forkStartId = "";
    let operationInputDigest = "";
    let operationCommitted = false;
    try {
      const existing = store.operationByClient(projectId, clientOperationId);
      if (existing) {
        const existingResult = store.operationResult(existing);
        const existingForkStartId = normalizeString(existingResult?.result?.forkStartId, "");
        if (existingForkStartId && existingForkStartId !== clientForkStartId) {
          const error = new Error("client_operation_id_conflict");
          error.code = "client_operation_id_conflict";
          throw error;
        }
        let existingTurnState = "";
        try {
          existingTurnState = normalizeString(this.sessionStore.readTurn(
            normalizeString(existingResult?.result?.createdSessionId, ""),
            normalizeString(existingResult?.result?.createdTurnId, ""),
          )?.state, "");
        } catch {}
        return {
          forkStartId: existingForkStartId,
          operationId: existingResult.operationId,
          threadId: normalizeString(existingResult?.result?.createdThreadId, ""),
          sessionId: normalizeString(existingResult?.result?.createdSessionId, ""),
          turnId: normalizeString(existingResult?.result?.createdTurnId, ""),
          status: existingTurnState || normalizeString(existingResult?.result?.forkStatus, existingResult.status),
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      if (store.activeTurnCountForProject(projectId) > 0 && options.allowConcurrentDirectTurns !== true) {
        const error = new Error("active_direct_turn_exists");
        error.code = "active_direct_turn_exists";
        throw error;
      }
      const model = normalizeString(options.selectedModel || options.model, "") || status.model;
      const endpointHash = this.endpoint ? sha256(this.endpoint) : "";
      const requestShapeHash = this.forkStartRequestShapeHash({ model, endpointHash });
      operationInputDigest = sha256(stableStringify({
        schema: "direct_fork_start_operation_input@1",
        projectId,
        sourcePreviewId,
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, ""),
        clientForkStartId,
        model,
        requestShapeHash,
      }));
      forkStartId = `fork_start_${sha256(`${projectId}:${clientForkStartId}:${sourcePreviewId}`).slice(0, 24)}`;
      planned = store.planOperation({
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId },
        parameters: { operationInputDigest, clientForkStartId, requestShapeHash },
        safety: { requiresConfirmation: true },
      }, options);
      const seedPreview = store.previewProjectionRecord(projectId, sourcePreviewId);
      const sourceKind = normalizeString(seedPreview.items[0]?.seed?.sourceKind || seedPreview.projection.source?.sourceKind, "direct_thread");
      if (sourceKind !== "direct_thread") {
        const error = new Error(sourceKind === "merge_preview" ? "merge_preview_fork_start_deferred" : (sourceKind === "prune_preview" ? "prune_preview_fork_start_deferred" : "fork_preview_source_kind_unsupported"));
        error.code = error.message;
        throw error;
      }
      session = this.sessionStore.createSession({
        projectId,
        workspace: isPlainObject(project.workspace) ? project.workspace : {},
        workspaceDisplayPath: workspaceDisplayPath(project),
        title: `Fork from ${normalizeString(seedPreview.items[0]?.threadId, "direct thread")}`,
        model,
        runtimeMode: "direct-experimental",
        directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
        modelSource: status.modelSource,
        modelEvidenceState: status.modelEvidenceState,
        modelEvidenceId: normalizeString(status.evidenceId, ""),
        profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        providerContinuityAvailable: false,
        continuityState: "fresh_session_only",
        composerState: "disabled_until_first_turn_terminal",
        forkStartId,
        sourcePreviewId,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        sourcePreviousResponseIdUsed: false,
      }, options);
      turn = this.sessionStore.createTurn(session.sessionId, {
        input: [{ role: "current_user_intent", text: currentUserPrompt }],
        model,
        clientTurnRequestId: clientForkStartId,
        requestShape: { schema: "direct_fork_start_live_text@1", requestShapeHash },
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        forkStartId,
        sourcePreviewId,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        sourceProviderContinuityHandleUsed: false,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_session_created", forkStartId, sourcePreviewId },
      ], options);
      const forkSeedResult = store.buildForkSeedFromPreview({
        projectId,
        forkStartId,
        sourcePreviewId,
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, seedPreview.projection.projectionDigest),
        targetThreadId: session.sessionId,
        targetTurnId: turn.turnId,
        currentUserPrompt,
      }, options);
      const forkSeed = forkSeedResult.forkSeed;
      const patchedSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...patchedSession,
        forkSeedId: forkSeed.forkSeedId,
        seedShapeHash: forkSeed.seedShapeHash,
        parentForkLineage: forkSeed.parentLineage,
      });
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_seed_built", forkStartId, forkSeedId: forkSeed.forkSeedId, seedShapeHash: forkSeed.seedShapeHash },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const contextResult = store.buildAndPersistContextForForkStart({
        session: this.sessionStore.readSession(session.sessionId),
        projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        forkStartId,
        forkSeed,
        currentUserPrompt,
        model,
        requestShape: { schema: "direct_fork_start_live_text@1", model, stream: true, store: false, tools: false, previousResponseId: false },
        requestShapeHash,
        endpointClass: "chatgpt-codex-responses",
        endpointHash,
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: "direct_fork_start_live_text@1",
        endpointEvidenceRef: endpointHash,
        accountEvidenceRef: normalizeString(status.auth?.accountId, ""),
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "context_pack_built", contextBuildId: contextResult.contextPack.contextBuildId, contextPackContentHash: contextResult.contextPack.contextPackContentHash },
        { type: "request_manifest_built", requestManifestId: contextResult.requestManifest.requestManifestId },
      ], options);
      const requestShape = {
        schema: "direct_fork_start_live_text@1",
        requestShapeHash,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        store: false,
        tools: false,
      };
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
        requestShape,
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        forkSeedId: forkSeed.forkSeedId,
        seedShapeHash: forkSeed.seedShapeHash,
        parentForkLineage: forkSeed.parentLineage,
        contextSummary: contextResult.rendererSafeSummary,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        {
          type: "request_built",
          forkStartId,
          forkSeedId: forkSeed.forkSeedId,
          seedShapeHash: forkSeed.seedShapeHash,
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          requestShapeHash,
          previousResponseIdUsed: false,
          providerContinuityHandleUsed: false,
        },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const lineageEdges = store.createForkLineageEdges({
        projectId,
        operationId: planned.operationId,
        forkThreadId: session.sessionId,
        sourcePreviewId,
        sourceThreadIds: forkSeed.parentLineage.sourceThreadIds,
      }, options);
      const committed = store.commitOperation(planned.operationId, {
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, threadIds: [session.sessionId] },
        result: {
          status: "committed",
          operationInputDigest,
          forkStartId,
          forkStatus: "request_built",
          createdThreadId: session.sessionId,
          createdSessionId: session.sessionId,
          createdTurnId: turn.turnId,
          effects: [
            { effectKind: "fork_seed_created", targetKind: "projection", targetId: forkSeed.forkSeedId, rendererSafeSummary: "fork_seed_created" },
            { effectKind: "fork_thread_created", targetKind: "direct_thread", targetId: session.sessionId, rendererSafeSummary: "fork_thread_created" },
            { effectKind: "fork_turn_request_built", targetKind: "direct_thread", targetId: turn.turnId, rendererSafeSummary: "provider turn pending" },
            ...lineageEdges.map((edge) => ({ effectKind: "lineage_edge_created", targetKind: "thread_edge", targetId: edge.edgeId, rendererSafeSummary: edge.edgeKind })),
          ],
        },
      }, options);
      operationCommitted = true;
      let requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      const callerLifecycle = options.onLifecycle;
      let result;
      try {
        result = await runTextOnlyDirectProbe({
          endpoint: this.endpoint || undefined,
          authStore: this.currentAuthStore(),
          refreshCredentials: this.refreshCredentials,
          profileDoc: this.profileDoc,
          model: requestBody.model,
          prompt: requestBody.input?.[0]?.content?.[0]?.text || contextResult.providerInput.prompt,
          instructions: requestBody.instructions,
          fetchImpl: this.fetchImpl || undefined,
          signal: options.signal,
          onLifecycle: (event) => {
            if (event.phase === "streaming") {
              this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
                streamStartedAt: event.at,
                responseStatus: event.status,
                responseContentType: event.contentType,
              }, options);
            }
            if (typeof callerLifecycle === "function") callerLifecycle(event);
          },
        });
      } catch (error) {
        this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
          error: { code: error.code || "provider_transport_failed", message: error.message || "Provider transport failed." },
          forkStartStatus: "sent_unknown",
        }, options);
        return {
          forkStartId,
          operationId: committed.operationId,
          threadId: session.sessionId,
          sessionId: session.sessionId,
          turnId: turn.turnId,
          status: "sent_unknown",
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      this.sessionStore.writeDiagnostic(session.sessionId, "direct_fork_start", {
        ...result.diagnostic,
        forkStartId,
        forkSeedId: forkSeed.forkSeedId,
        rawBackendFramesExposed: false,
        rawAuthHeadersExposed: false,
      }, options);
      if (result.normalizedEvents.length) this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
      const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
      const unsupportedTool = result.normalizedEvents.some((event) => String(event.type || "").startsWith("tool_call_"));
      const terminal = unsupportedTool
        ? { state: "failed", error: { code: "tool_call_unsupported", message: "Fork start does not support provider tool calls." } }
        : (!assistantText && result.terminal?.state === "completed"
            ? { state: "failed", error: { code: "empty_fork_output", message: "Fork start completed without assistant text." } }
            : (result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null }));
      const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
        ...(terminal.error ? { error: terminal.error } : {}),
        responseId: result.responseId || "",
        responseStatus: result.response?.status || 0,
        responseContentType: result.response?.contentType || "",
        forkStartStatus: terminal.state,
      }, options);
      const currentSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...currentSession,
        composerState: terminal.state === "completed" ? "enabled" : "disabled_interrupted",
      });
      this.appendSessionTurn(session.sessionId, turn.turnId, [
        {
          id: `${turn.turnId}_fork_seed`,
          type: "harnessForkSeed",
          turnId: turn.turnId,
          text: forkSeed.seedText.slice(0, 4096),
          forkStartId,
          forkSeedId: forkSeed.forkSeedId,
          seedShapeHash: forkSeed.seedShapeHash,
        },
        ...(assistantText ? [{
          id: `${turn.turnId}_assistant`,
          type: "agentMessage",
          turnId: turn.turnId,
          text: assistantText,
        }] : []),
      ], model, terminal.state);
      this.prepareDirectContextProjection(session.sessionId, options);
      return {
        forkStartId,
        operationId: committed.operationId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        status: completedTurn.state,
        refreshRequired: true,
        rawPathExposed: false,
        rawUrlExposed: false,
        contextTextExposed: false,
        requestBodyExposed: false,
      };
    } catch (error) {
      if (!operationCommitted && session?.sessionId && turn?.turnId) {
        try {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
            error: {
              code: error.code || error.message || "fork_start_pre_transport_failed",
              message: error.message || "Fork start failed before provider transport.",
            },
            forkStartStatus: "failed",
          }, options);
          const currentSession = this.sessionStore.readSession(session.sessionId);
          this.sessionStore.writeSession({
            ...currentSession,
            composerState: "disabled_failed_pre_transport",
          });
          this.indexDirectThreadStoreSession(session.sessionId, options);
        } catch {}
      }
      if (!operationCommitted && planned?.operationId && typeof store.failOperation === "function") {
        try {
          store.failOperation(planned.operationId, {
            operationType: "start_fork_turn",
            projectId,
            clientOperationId,
            target: {
              previewId: sourcePreviewId,
              threadIds: session?.sessionId ? [session.sessionId] : [],
            },
            result: {
              status: "failed",
              operationInputDigest,
              forkStartId,
              forkStatus: "failed",
              blockerCode: error.code || error.message || "fork_start_pre_transport_failed",
              createdThreadId: session?.sessionId || "",
              createdSessionId: session?.sessionId || "",
              createdTurnId: turn?.turnId || "",
              effects: [{
                effectKind: "operation_failed_no_effect",
                targetKind: session?.sessionId ? "direct_thread" : "projection",
                targetId: session?.sessionId || sourcePreviewId,
                rendererSafeSummary: error.code || error.message || "fork_start_pre_transport_failed",
              }],
            },
          }, options);
        } catch {}
      }
      throw error;
    } finally {
      this.forkStartLocks.delete(lockKey);
    }
  }

  async startForkFromDerivedPreview(options = {}) {
    const project = options.project || {};
    const projectId = normalizeString(project.id, "");
    const status = this.assertReady(project);
    const store = this.directThreadStore;
    if (!store) {
      const error = new Error("context_store_unhealthy");
      error.code = "context_store_unhealthy";
      throw error;
    }
    const sourcePreviewId = normalizeString(options.sourcePreviewId, "");
    const sourcePreviewKind = normalizeString(options.sourcePreviewKind, "");
    const clientDerivedForkStartId = normalizeString(options.clientDerivedForkStartId || options.clientForkStartId, "");
    const clientOperationId = normalizeString(options.clientOperationId, "");
    const currentUserPrompt = normalizeString(options.currentUserPrompt, "");
    if (!clientDerivedForkStartId || !clientOperationId) {
      const error = new Error("idempotency_key_conflict");
      error.code = "idempotency_key_conflict";
      throw error;
    }
    if (!sourcePreviewId) {
      const error = new Error("source_preview_missing");
      error.code = "source_preview_missing";
      throw error;
    }
    if (sourcePreviewKind !== "merge_preview" && sourcePreviewKind !== "prune_preview") {
      const error = new Error(sourcePreviewKind === "fork_preview" ? "intermediate_fork_preview_not_supported" : "derived_preview_source_kind_unsupported");
      error.code = error.message;
      throw error;
    }
    if (!currentUserPrompt) {
      const error = new Error("current_user_prompt_missing");
      error.code = "current_user_prompt_missing";
      throw error;
    }
    const lockKey = `${projectId}:derived:${sourcePreviewKind}:${sourcePreviewId}`;
    if (this.forkStartLocks.has(lockKey) && this.forkStartLocks.get(lockKey) !== clientDerivedForkStartId) {
      const error = new Error("active_fork_start_exists");
      error.code = "active_fork_start_exists";
      throw error;
    }
    this.forkStartLocks.set(lockKey, clientDerivedForkStartId);
    let planned = null;
    let session = null;
    let turn = null;
    let forkStartId = "";
    let operationInputDigest = "";
    let operationCommitted = false;
    try {
      const existing = store.operationByClient(projectId, clientOperationId);
      if (existing) {
        const existingResult = store.operationResult(existing);
        const existingForkStartId = normalizeString(existingResult?.result?.forkStartId, "");
        if (existingForkStartId && existingForkStartId !== clientDerivedForkStartId) {
          const error = new Error("client_operation_id_conflict");
          error.code = "client_operation_id_conflict";
          throw error;
        }
        let existingTurnState = "";
        try {
          existingTurnState = normalizeString(this.sessionStore.readTurn(
            normalizeString(existingResult?.result?.createdSessionId, ""),
            normalizeString(existingResult?.result?.createdTurnId, ""),
          )?.state, "");
        } catch {}
        return {
          forkStartId: existingForkStartId,
          operationId: existingResult.operationId,
          threadId: normalizeString(existingResult?.result?.createdThreadId, ""),
          sessionId: normalizeString(existingResult?.result?.createdSessionId, ""),
          turnId: normalizeString(existingResult?.result?.createdTurnId, ""),
          status: existingTurnState || normalizeString(existingResult?.result?.forkStatus, existingResult.status),
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      if (store.activeTurnCountForProject(projectId) > 0 && options.allowConcurrentDirectTurns !== true) {
        const error = new Error("active_direct_turn_exists");
        error.code = "active_direct_turn_exists";
        throw error;
      }
      const model = normalizeString(options.selectedModel || options.model, "") || status.model;
      const endpointHash = this.endpoint ? sha256(this.endpoint) : "";
      const requestShapeHash = this.derivedPreviewForkStartRequestShapeHash({ model, endpointHash, sourcePreviewKind });
      operationInputDigest = sha256(stableStringify({
        schema: "direct_derived_preview_fork_start_operation_input@1",
        projectId,
        sourcePreviewId,
        sourcePreviewKind,
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, ""),
        expectedSourcePreviewOperationId: normalizeString(options.expectedSourcePreviewOperationId, ""),
        clientDerivedForkStartId,
        model,
        requestShapeHash,
      }));
      forkStartId = `derived_fork_start_${sha256(`${projectId}:${clientDerivedForkStartId}:${sourcePreviewKind}:${sourcePreviewId}`).slice(0, 24)}`;
      const existingByForkStartId = store.db.prepare(`
        select *
        from direct_operations
        where project_id = ? and operation_type = 'start_fork_turn'
        order by requested_at desc
        limit 200
      `).all(projectId).map((row) => store.operationResult(row))
        .find((entry) => normalizeString(entry?.result?.forkStartId, "") === forkStartId);
      if (existingByForkStartId && normalizeString(existingByForkStartId.clientOperationId, "") !== clientOperationId) {
        const error = new Error("idempotency_key_conflict");
        error.code = "idempotency_key_conflict";
        throw error;
      }
      planned = store.planOperation({
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, previewKind: sourcePreviewKind },
        parameters: { operationInputDigest, clientDerivedForkStartId, requestShapeHash },
        safety: { requiresConfirmation: true },
      }, options);
      const seedPreview = store.previewProjectionRecord(projectId, sourcePreviewId, sourcePreviewKind);
      const derivedSeedResult = store.buildDerivedForkSeedFromPreview({
        projectId,
        forkStartId,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewOperationId: normalizeString(options.sourcePreviewOperationId || options.expectedSourcePreviewOperationId, ""),
        expectedSourcePreviewOperationId: normalizeString(options.expectedSourcePreviewOperationId, ""),
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, seedPreview.projection.projectionDigest),
        currentUserPrompt,
      }, options);
      const derivedForkSeed = derivedSeedResult.derivedForkSeed;
      session = this.sessionStore.createSession({
        projectId,
        workspace: isPlainObject(project.workspace) ? project.workspace : {},
        workspaceDisplayPath: workspaceDisplayPath(project),
        title: `Fork from ${sourcePreviewKind.replace("_", " ")}`,
        model,
        runtimeMode: "direct-experimental",
        directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
        modelSource: status.modelSource,
        modelEvidenceState: status.modelEvidenceState,
        modelEvidenceId: normalizeString(status.evidenceId, ""),
        profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        providerContinuityAvailable: false,
        continuityState: "fresh_session_only",
        composerState: "disabled_until_first_turn_terminal",
        forkStartId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        sourcePreviewOperationId: derivedForkSeed.sourcePreviewOperationId,
        sourcePreviousResponseIdUsed: false,
      }, options);
      turn = this.sessionStore.createTurn(session.sessionId, {
        input: [{ role: "current_user_intent", text: currentUserPrompt }],
        model,
        clientTurnRequestId: clientDerivedForkStartId,
        requestShape: { schema: "direct_derived_preview_fork_start_live_text@1", requestShapeHash, sourcePreviewKind },
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        forkStartId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        sourceProviderContinuityHandleUsed: false,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_session_created", forkStartId, sourcePreviewId, sourcePreviewKind },
        {
          type: "derived_fork_seed_built",
          forkStartId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
          sourcePreviewId,
          sourcePreviewKind,
          sourcePreviewDigest: seedPreview.projection.projectionDigest,
        },
      ], options);
      const patchedSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...patchedSession,
        forkSeedId: derivedForkSeed.derivedForkSeedId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        seedShapeHash: derivedForkSeed.seedShapeHash,
        parentForkLineage: derivedForkSeed.parentLineage,
      });
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const contextResult = store.buildAndPersistContextForDerivedPreviewForkStart({
        session: this.sessionStore.readSession(session.sessionId),
        projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        forkStartId,
        derivedForkSeed,
        currentUserPrompt,
        model,
        requestShape: {
          schema: "direct_derived_preview_fork_start_live_text@1",
          sourcePreviewKind,
          model,
          stream: true,
          store: false,
          tools: false,
          previousResponseId: false,
        },
        requestShapeHash,
        endpointClass: "chatgpt-codex-responses",
        endpointHash,
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: "direct_derived_preview_fork_start_live_text@1",
        endpointEvidenceRef: endpointHash,
        accountEvidenceRef: normalizeString(status.auth?.accountId, ""),
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "context_pack_built", contextBuildId: contextResult.contextPack.contextBuildId, contextPackContentHash: contextResult.contextPack.contextPackContentHash },
        { type: "request_manifest_built", requestManifestId: contextResult.requestManifest.requestManifestId },
      ], options);
      const requestShape = {
        schema: "direct_derived_preview_fork_start_live_text@1",
        requestShapeHash,
        sourcePreviewKind,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        store: false,
        tools: false,
      };
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
        requestShape,
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        seedShapeHash: derivedForkSeed.seedShapeHash,
        parentForkLineage: derivedForkSeed.parentLineage,
        contextSummary: contextResult.rendererSafeSummary,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        {
          type: "request_built",
          forkStartId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          requestShapeHash,
          sourcePreviewKind,
          previousResponseIdUsed: false,
          providerContinuityHandleUsed: false,
        },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const lineageEdges = store.createDerivedForkLineageEdges({
        projectId,
        operationId: planned.operationId,
        forkThreadId: session.sessionId,
        sourcePreviewId,
        sourcePreviewKind,
        sourceThreadIds: derivedForkSeed.parentLineage.sourceThreadIds,
      }, options);
      const committed = store.commitOperation(planned.operationId, {
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, previewKind: sourcePreviewKind, threadIds: [session.sessionId] },
        result: {
          status: "committed",
          operationInputDigest,
          forkStartId,
          derivedForkStartId: forkStartId,
          sourcePreviewKind,
          forkStatus: "request_built",
          createdThreadId: session.sessionId,
          createdSessionId: session.sessionId,
          createdTurnId: turn.turnId,
          effects: [
            { effectKind: "derived_fork_seed_created", targetKind: "projection", targetId: derivedForkSeed.derivedForkSeedId, rendererSafeSummary: "derived_fork_seed_created" },
            { effectKind: "fork_thread_created", targetKind: "direct_thread", targetId: session.sessionId, rendererSafeSummary: "fork_thread_created" },
            { effectKind: "fork_turn_request_built", targetKind: "direct_thread", targetId: turn.turnId, rendererSafeSummary: "provider turn pending" },
            ...lineageEdges.map((edge) => ({ effectKind: "lineage_edge_created", targetKind: "thread_edge", targetId: edge.edgeId, rendererSafeSummary: edge.edgeKind })),
          ],
        },
      }, options);
      operationCommitted = true;
      const requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      let result;
      const callerLifecycle = options.onLifecycle;
      try {
        result = await runTextOnlyDirectProbe({
          endpoint: this.endpoint || undefined,
          authStore: this.currentAuthStore(),
          refreshCredentials: this.refreshCredentials,
          profileDoc: this.profileDoc,
          model: requestBody.model,
          prompt: requestBody.input?.[0]?.content?.[0]?.text || contextResult.providerInput.prompt,
          instructions: requestBody.instructions,
          fetchImpl: this.fetchImpl || undefined,
          signal: options.signal,
          onLifecycle: (event) => {
            if (event.phase === "streaming") {
              this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
                streamStartedAt: event.at,
                responseStatus: event.status,
                responseContentType: event.contentType,
              }, options);
            }
            if (typeof callerLifecycle === "function") callerLifecycle(event);
          },
        });
      } catch (error) {
        this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
          error: { code: error.code || "provider_transport_failed", message: error.message || "Provider transport failed." },
          forkStartStatus: "transport_handoff_unknown",
        }, options);
        return {
          forkStartId,
          operationId: committed.operationId,
          threadId: session.sessionId,
          sessionId: session.sessionId,
          turnId: turn.turnId,
          status: "transport_handoff_unknown",
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      this.sessionStore.writeDiagnostic(session.sessionId, "direct_derived_preview_fork_start", {
        ...result.diagnostic,
        forkStartId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        rawBackendFramesExposed: false,
        rawAuthHeadersExposed: false,
      }, options);
      if (result.normalizedEvents.length) this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
      const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
      const unsupportedTool = result.normalizedEvents.some((event) => String(event.type || "").startsWith("tool_call_"));
      const terminal = unsupportedTool
        ? { state: "failed", error: { code: "tool_call_unsupported", message: "Derived fork start does not support provider tool calls." } }
        : (!assistantText && result.terminal?.state === "completed"
            ? { state: "failed", error: { code: "empty_fork_output", message: "Derived fork start completed without assistant text." } }
            : (result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null }));
      const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
        ...(terminal.error ? { error: terminal.error } : {}),
        responseId: result.responseId || "",
        responseStatus: result.response?.status || 0,
        responseContentType: result.response?.contentType || "",
        forkStartStatus: terminal.state,
      }, options);
      const currentSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...currentSession,
        composerState: terminal.state === "completed" ? "enabled_after_completed_first_turn" : "disabled_streaming_interrupted",
      });
      this.appendSessionTurn(session.sessionId, turn.turnId, [
        {
          id: `${turn.turnId}_derived_fork_seed`,
          type: "harnessForkSeed",
          turnId: turn.turnId,
          text: derivedForkSeed.seedText.slice(0, 4096),
          forkStartId,
          forkSeedId: derivedForkSeed.derivedForkSeedId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
        },
        ...(assistantText ? [{
          id: `${turn.turnId}_assistant`,
          type: "agentMessage",
          turnId: turn.turnId,
          text: assistantText,
        }] : []),
      ], model, terminal.state);
      this.prepareDirectContextProjection(session.sessionId, options);
      return {
        forkStartId,
        operationId: committed.operationId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        status: completedTurn.state,
        sourcePreviewKind,
        refreshRequired: true,
        rawPathExposed: false,
        rawUrlExposed: false,
        contextTextExposed: false,
        requestBodyExposed: false,
      };
    } catch (error) {
      if (!operationCommitted && session?.sessionId && turn?.turnId) {
        try {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
            error: {
              code: error.code || error.message || "derived_fork_start_pre_transport_failed",
              message: error.message || "Derived preview fork start failed before provider transport.",
            },
            forkStartStatus: "failed",
          }, options);
          const currentSession = this.sessionStore.readSession(session.sessionId);
          this.sessionStore.writeSession({
            ...currentSession,
            composerState: "disabled_failed_pre_transport",
          });
          this.indexDirectThreadStoreSession(session.sessionId, options);
        } catch {}
      }
      if (!operationCommitted && planned?.operationId && typeof store.failOperation === "function") {
        try {
          store.failOperation(planned.operationId, {
            operationType: "start_fork_turn",
            projectId,
            clientOperationId,
            target: {
              previewId: sourcePreviewId,
              previewKind: sourcePreviewKind,
              threadIds: session?.sessionId ? [session.sessionId] : [],
            },
            result: {
              status: "failed",
              operationInputDigest,
              forkStartId,
              sourcePreviewKind,
              forkStatus: "failed",
              blockerCode: error.code || error.message || "derived_fork_start_pre_transport_failed",
              createdThreadId: session?.sessionId || "",
              createdSessionId: session?.sessionId || "",
              createdTurnId: turn?.turnId || "",
              effects: [{
                effectKind: "operation_failed_no_effect",
                targetKind: session?.sessionId ? "direct_thread" : "projection",
                targetId: session?.sessionId || sourcePreviewId,
                rendererSafeSummary: error.code || error.message || "derived_fork_start_pre_transport_failed",
              }],
            },
          }, options);
        } catch {}
      }
      throw error;
    } finally {
      this.forkStartLocks.delete(lockKey);
    }
  }

  async runImportCheckpointContinuation(options = {}) {
    const project = options.project || {};
    const status = this.assertReady(project);
    const seed = isPlainObject(options.seed) ? options.seed : null;
    if (!seed?.seedText) throw new Error("Direct import checkpoint continuation requires a seed.");
    const clientCheckpointContinuationId = normalizeString(options.clientCheckpointContinuationId, "");
    if (!clientCheckpointContinuationId) {
      const error = new Error("Direct import checkpoint continuation requires clientCheckpointContinuationId.");
      error.code = "missing_client_checkpoint_continuation_id";
      throw error;
    }
    const model = normalizeString(options.model, "") || status.model;
    const session = this.sessionStore.createSession({
      projectId: normalizeString(project.id || seed.projectId, ""),
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: workspaceDisplayPath(project),
      title: `Checkpoint continuation ${normalizeString(seed.source?.sourceDisplayName, seed.importId)}`,
      model,
      runtimeMode: "direct-experimental",
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      modelSource: status.modelSource,
      modelEvidenceState: status.modelEvidenceState,
      modelEvidenceId: normalizeString(status.evidenceId, ""),
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      requestShapeHash: normalizeString(seed.requestShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    let requestBody = buildTextOnlyProbeRequest({
      profileDoc: this.profileDoc,
      model,
      prompt: seed.seedText,
      instructions: "You are Codex running a fresh direct checkpoint continuation from quoted imported transcript evidence. Do not request tools.",
    });
    let requestShape = {
      ...requestShapeForDiagnostic(requestBody),
      schema: DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
      seedShapeHash: seed.seedShapeHash,
      requestShapeHash: seed.requestShapeHash,
      previousResponseIdFromImportUsed: false,
      importedToolReplayAttempted: false,
    };
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input: [{ role: "harness_checkpoint_seed", text: seed.seedText }],
      model: requestBody.model,
      clientTurnRequestId: clientCheckpointContinuationId,
      requestShape,
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    let contextResult = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForCheckpointContinuation === "function") {
      this.indexDirectThreadStoreSession(session.sessionId, options);
      contextResult = this.directThreadStore.buildAndPersistContextForCheckpointContinuation({
        session,
        projectId: session.projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        seed,
        currentUserPrompt: normalizeString(options.userPromptText, ""),
        model: requestBody.model,
        requestShape,
        requestShapeHash: normalizeString(seed.requestShapeHash, ""),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: normalizeString(seed.requestShapeHash, ""),
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
      }, options);
      requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      requestShape = {
        ...requestShapeForDiagnostic(requestBody),
        schema: DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
        seedShapeHash: seed.seedShapeHash,
        requestShapeHash: seed.requestShapeHash,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdFromImportUsed: false,
        importedToolReplayAttempted: false,
      };
    }
    this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
      requestShape,
      ...(contextResult ? {
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        contextSummary: contextResult.rendererSafeSummary,
      } : {}),
    }, options);

    const callerLifecycle = options.onLifecycle;
    const result = await runTextOnlyDirectProbe({
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: requestBody.model,
      prompt: requestBody.input?.[0]?.content?.[0]?.text || seed.seedText,
      instructions: requestBody.instructions,
      fetchImpl: this.fetchImpl || undefined,
      signal: options.signal,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
            streamStartedAt: event.at,
            responseStatus: event.status,
            responseContentType: event.contentType,
          }, options);
        }
        if (typeof callerLifecycle === "function") callerLifecycle(event);
      },
    });
    this.sessionStore.writeDiagnostic(session.sessionId, "direct_import_checkpoint_continuation", {
      ...result.diagnostic,
      clientCheckpointContinuationId,
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      checkpointSeedId: seed.seedId,
      seedShapeHash: seed.seedShapeHash,
      rawBackendFramesExposed: false,
      rawAuthHeadersExposed: false,
    }, options);
    if (result.normalizedEvents.length) {
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
    }
    const terminal = checkpointTerminalFromEvents(result.normalizedEvents, result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null });
    const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
      ...(terminal.error ? { error: terminal.error } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
      sourceClass: "direct-import-checkpoint-continuation",
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
    }, options);
    const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
    this.appendSessionTurn(
      session.sessionId,
      turn.turnId,
      [
        {
          id: `${turn.turnId}_checkpoint_seed`,
          type: "harnessCheckpointSeed",
          turnId: turn.turnId,
          text: seed.seedText.slice(0, 4096),
          seedId: seed.seedId,
          seedShapeHash: seed.seedShapeHash,
          importedSessionId: seed.materializedSessionId,
        },
        ...(assistantText
          ? [{
              id: `${turn.turnId}_assistant`,
              type: "agentMessage",
              turnId: turn.turnId,
              text: assistantText,
            }]
          : []),
      ],
      model,
      completedTurn.state,
    );
    const persistedSession = this.sessionStore.readSession(session.sessionId) || session;
    this.sessionStore.writeSession({
      ...persistedSession,
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      requestShapeHash: normalizeString(seed.requestShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    return {
      ...result,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      turnState: completedTurn.state,
      terminal,
    };
  }

  readOnlyToolRequestParams(obligation = {}, turn = {}, project = {}) {
    let relPath = "";
    let argumentsError = "";
    try {
      const parsed = JSON.parse(normalizeString(obligation.argumentsText, "{}"));
      if (isPlainObject(parsed)) relPath = normalizeString(parsed.path || parsed.relPath || parsed.relativePath, "");
    } catch (error) {
      argumentsError = error?.message || "invalid_tool_arguments";
    }
    const hasContinuityHandle = Boolean(normalizeString(turn.responseId, ""));
    const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
    const namespace = normalizeString(obligation.namespace, "");
    const supportedCallType = providerCallType === "function_call" || providerCallType === "custom_tool_call";
    const supportedNamespace = !namespace;
    const continuationEvidence = this.statusForProject(project).readOnlyToolContinuation || readOnlyContinuationEvidenceFor(this.profileDoc);
    const approvalAvailable = normalizeString(obligation.status, "") === "waiting" &&
      !argumentsError &&
      Boolean(normalizeString(obligation.callId, "")) &&
      hasContinuityHandle &&
      supportedCallType &&
      supportedNamespace &&
      continuationEvidence.status === "ready";
    return {
      sessionId: obligation.sessionId,
      threadId: obligation.sessionId,
      turnId: obligation.turnId,
      obligationId: obligation.obligationId,
      tool: normalizeString(obligation.name, "read_file"),
      relPath,
      providerCallType,
      namespace,
      toolCallSource: normalizeString(obligation.toolCallSource, "provider-native-implicit"),
      callIdPresent: Boolean(normalizeString(obligation.callId, "")),
      hasContinuityHandle,
      toolContinuationEvidence: continuationEvidence,
      approvalAvailable,
      argumentsError,
      maxReadFileBytes: 384 * 1024,
      maxProviderOutputChars: 64 * 1024,
      maxApprovalPreviewChars: 4 * 1024,
      sensitivePathPolicy: "deny-by-default",
      rawWorkspacePathExposed: false,
    };
  }

  emitToolApprovalRequests(surfaceSession, sessionId, turnId, obligations = [], project = {}) {
    if (!surfaceSession || typeof surfaceSession.createReadOnlyToolRequest !== "function") return 0;
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    if (obligations.length !== 1) {
      for (const obligation of obligations) {
        this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          status: "unsupported",
          authorityState: "unsupported",
          approvalAvailable: false,
          executionAllowed: false,
          continuationAllowed: false,
          failureKind: "multiple_tool_calls_unsupported",
        }, {
          nextTurnState: "failed",
          turnPatch: {
            error: {
              code: "multiple_tool_calls_unsupported",
              message: "Direct read-only continuation supports exactly one tool obligation in this bundle.",
            },
          },
        });
      }
      return 0;
    }
    let createdCount = 0;
    for (const obligation of obligations) {
      const params = this.readOnlyToolRequestParams(obligation, turn, project);
      if (!params.approvalAvailable) {
        this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          status: "unsupported",
          authorityState: "unsupported",
          approvalAvailable: false,
          executionAllowed: false,
          continuationAllowed: false,
          failureKind: params.argumentsError
            ? "invalid_tool_arguments"
            : (!params.hasContinuityHandle
                ? "continuation_missing_context_handle"
                : (params.toolContinuationEvidence?.status !== "ready" ? "tool_continuation_profile_required" : "unsupported_tool_call_shape")),
        }, {
          nextTurnState: "failed",
          turnPatch: {
            error: {
              code: params.argumentsError
                ? "invalid_tool_arguments"
                : (!params.hasContinuityHandle
                    ? "continuation_missing_context_handle"
                    : (params.toolContinuationEvidence?.status !== "ready" ? "tool_continuation_profile_required" : "unsupported_tool_call_shape")),
              message: "Direct read-only tool call cannot be approved for continuation in this runtime bundle.",
            },
          },
        });
        continue;
      }
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        approvalAvailable: true,
        authorityState: "approval_waiting",
      }, {
        nextTurnState: "tool_waiting",
      });
      surfaceSession.createReadOnlyToolRequest({
        params,
        summary: params.relPath || params.tool,
      });
      createdCount += 1;
    }
    return createdCount;
  }

  async withToolDecisionLock(key, action) {
    const lockKey = normalizeString(key, "");
    const existing = this.toolDecisionLocks.get(lockKey);
    if (existing) return existing;
    const run = Promise.resolve()
      .then(action)
      .finally(() => {
        if (this.toolDecisionLocks.get(lockKey) === run) this.toolDecisionLocks.delete(lockKey);
      });
    this.toolDecisionLocks.set(lockKey, run);
    return run;
  }

  pruneToolDecisionCache() {
    const limit = this.toolDecisionCacheLimit;
    while (this.toolDecisionClaims.size > limit) {
      const oldestKey = this.toolDecisionClaims.keys().next().value;
      if (!oldestKey) break;
      this.toolDecisionClaims.delete(oldestKey);
      this.toolDecisionResults.delete(oldestKey);
    }
    while (this.toolDecisionResults.size > limit) {
      const oldestKey = this.toolDecisionResults.keys().next().value;
      if (!oldestKey) break;
      this.toolDecisionResults.delete(oldestKey);
      this.toolDecisionClaims.delete(oldestKey);
    }
  }

  async handleReadOnlyToolResponse(record = {}, result = {}, context = {}) {
    const params = record.params || {};
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId, "");
    const obligationId = normalizeString(params.obligationId, "");
    const decision = normalizeString(result.decision || result.action, "decline");
    const clientToolDecisionId = normalizeString(result.clientToolDecisionId, `${record.key}:${decision}`);
    const decisionKey = clientToolDecisionId;
    const existingClaim = this.toolDecisionClaims.get(decisionKey);
    if (existingClaim && (existingClaim.obligationId !== obligationId || existingClaim.decision !== decision)) {
      const error = new Error("clientToolDecisionId was reused for a different read-only tool decision.");
      error.code = "tool_decision_id_conflict";
      throw error;
    }
    this.toolDecisionClaims.set(decisionKey, { obligationId, decision });
    this.pruneToolDecisionCache();
    const previousDecision = this.toolDecisionResults.get(decisionKey);
    if (previousDecision) {
      if (previousDecision.obligationId !== obligationId || previousDecision.decision !== decision) {
        const error = new Error("clientToolDecisionId was reused for a different read-only tool decision.");
        error.code = "tool_decision_id_conflict";
        throw error;
      }
      return previousDecision.response;
    }
    const response = await this.withToolDecisionLock(obligationId, async () => {
      if (decision === "approve" || decision === "approved" || decision === "accept") {
        return this.approveExecuteAndContinueReadOnlyTool({
          project: context.project || this.project || {},
          surfaceSession: context.surfaceSession,
          sessionId,
          turnId,
          obligationId,
          clientToolDecisionId,
        });
      }
      if (decision === "cancel" || decision === "canceled" || decision === "abort") {
        const canceled = cancelReadOnlyToolObligation({
          sessionStore: this.sessionStore,
          sessionId,
          turnId,
          obligationId,
          decidedBy: "local-user",
          reason: "User canceled read-only tool execution.",
        });
        this.emitNotification(context.surfaceSession, "turn/completed", {
          threadId: sessionId,
          turnId,
          turn: { id: turnId, status: "aborted", completedAt: nowSeconds() },
        });
        return { decision: "canceled", turn: turnSnapshot(canceled.turn), obligation: canceled.obligation };
      }
      const declined = declineReadOnlyToolObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        decidedBy: "local-user",
        reason: "User declined read-only tool execution.",
      });
      this.emitNotification(context.surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: { id: turnId, status: "failed", completedAt: nowSeconds() },
      });
      return { decision: "declined", turn: turnSnapshot(declined.turn), obligation: declined.obligation };
    });
    this.toolDecisionResults.set(decisionKey, { obligationId, decision, response });
    this.pruneToolDecisionCache();
    return response;
  }

  emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, normalizedEvents = []) {
    const itemId = `${turnId}_${continuationId}_assistant`;
    const item = { id: itemId, type: "agentMessage", turnId, text: "" };
    let started = false;
    for (const event of normalizedEvents) {
      if (event.type !== "message_delta") continue;
      if (!started) {
        started = true;
        this.emitNotification(surfaceSession, "item/started", { threadId: sessionId, turnId, item });
      }
      const delta = String(event.text || "");
      item.text += delta;
      this.emitNotification(surfaceSession, "item/agentMessage/delta", {
        threadId: sessionId,
        turnId,
        itemId,
        delta,
      });
    }
    if (started) this.emitNotification(surfaceSession, "item/completed", { threadId: sessionId, turnId, item });
  }

  async approveExecuteAndContinueReadOnlyTool(options = {}) {
    if (typeof this.workspaceRequest !== "function") {
      const error = new Error("Direct read-only tool execution requires the workspace backend.");
      error.code = "workspace_backend_unavailable";
      throw error;
    }
    const { sessionId, turnId, obligationId, project, surfaceSession } = options;
    const approved = approveReadOnlyToolObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      approvedBy: "local-user",
    });
    const executed = await executeApprovedReadOnlyToolObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
    });
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    let continuationRequest = null;
    let continuationContext = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForToolContinuation === "function") {
      this.indexDirectThreadStoreSession(sessionId);
      const baseContinuationRequest = buildReadOnlyToolContinuationRequest({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        continuationLiveSendEnabled: true,
      });
      continuationRequest = {
        ...baseContinuationRequest,
        source: {
          ...(baseContinuationRequest.source || {}),
          previousResponseId: normalizeString(turn?.responseId, ""),
          previousResponseIdSource: "initial_stream",
        },
      };
      const outputType = normalizeString(continuationRequest.toolResult?.outputType || continuationRequest.toolResult?.content?.[0]?.type, "");
      const continuationShape = {
        kind: "read_only_tool_continuation",
        stream: true,
        store: false,
        tools: false,
        hasInstructions: true,
        hasPreviousResponseId: Boolean(normalizeString(turn?.responseId, "")),
        functionCallOutputCount: outputType === "function_call_output" ? 1 : 0,
        customToolCallOutputCount: outputType === "custom_tool_call_output" ? 1 : 0,
        providerCallType: normalizeString(continuationRequest.toolResult?.providerCallType, ""),
        providerOutputType: outputType,
      };
      continuationContext = this.directThreadStore.buildAndPersistContextForToolContinuation({
        sessionStore: this.sessionStore,
        session: this.sessionStore.readSession(sessionId),
        projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
        threadId: sessionId,
        turnId,
        obligationId,
        continuationRequest,
        previousResponseId: normalizeString(turn?.responseId, ""),
        model: normalizeString(turn?.model, ""),
        requestShape: continuationShape,
        requestShapeHash: sha256(stableStringify(continuationShape)),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(this.statusForProject(project).evidenceId, ""),
        requestShapeEvidenceRef: "continuation.tool_result",
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
      }, {
        sessionStore: this.sessionStore,
      });
      continuationRequest = {
        ...continuationRequest,
        source: {
          ...(continuationRequest.source || {}),
          contextBuildId: continuationContext.contextPack.contextBuildId,
          requestManifestId: continuationContext.requestManifest.requestManifestId,
        },
        safety: {
          ...(continuationRequest.safety || {}),
          contextPackBuilt: true,
          requestManifestBuilt: true,
          rawRequestBodyStored: false,
        },
      };
    }
    const continuation = await runPersistedReadOnlyToolContinuation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationRequest,
      previousResponseId: normalizeString(turn?.responseId, ""),
      instructions: normalizeString(continuationContext?.providerInput?.instructions, ""),
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: normalizeString(turn?.model, ""),
      fetchImpl: this.fetchImpl || undefined,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.emitNotification(surfaceSession, "turn/started", {
            threadId: sessionId,
            turnId,
            turn: { id: turnId, status: "inProgress", startedAt: nowSeconds(), streamPhase: "continuation" },
          });
        }
      },
    });
    if (this.directThreadStore) {
      this.indexDirectThreadStoreSession(sessionId);
    }
    const continuationId = normalizeString(continuation.continuation?.continuationId || continuation.obligation?.continuationRequest?.continuationId, "continuation");
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, continuation.normalizedEvents || []);
    this.emitNotification(surfaceSession, "turn/completed", {
      threadId: sessionId,
      turnId,
      turn: {
        id: turnId,
        status: terminalStatusForState(continuation.turnState),
        completedAt: nowSeconds(),
        streamPhase: "continuation",
      },
    });
    return {
      decision: "approved",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: continuation.obligation || approved.obligation,
      result: executed.result,
      continuation: {
        ok: continuation.ok,
        continuationId,
        terminal: continuation.terminal || null,
      },
    };
  }

  textPrompt(params = {}) {
    const prompt = normalizeString(params.promptText, "") || firstTextInput(params.input);
    if (!prompt) throw new Error("Direct live text turn requires prompt text.");
    if (prompt.length > this.maxPromptChars) {
      const error = new Error("Direct live text prompt exceeds the configured size limit.");
      error.code = "prompt_too_large";
      throw error;
    }
    return prompt;
  }

  async startTurn(params = {}, context = {}) {
    const project = context.project || {};
    const status = this.assertReady(project);
    const surfaceSession = context.surfaceSession;
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    const clientTurnRequestId = normalizeString(params.clientTurnRequestId, "");
    if (!clientTurnRequestId) {
      const error = new Error("Direct live text turn requires clientTurnRequestId.");
      error.code = "missing_client_turn_request_id";
      throw error;
    }
    const duplicate = this.findTurnByClientRequestId(session, clientTurnRequestId);
    if (duplicate) {
      return {
        turn: turnSnapshot(duplicate),
        reused: true,
        clientTurnRequestId,
      };
    }
    const activeTurn = this.activeTurnForSession(session);
    if (activeTurn) {
      const error = new Error(`Direct live text session already has an active turn: ${activeTurn.turnId}`);
      error.code = "active_turn_exists";
      error.activeTurnId = activeTurn.turnId;
      error.status = activeTurn.state;
      throw error;
    }
    const prompt = this.textPrompt(params);
    const model = normalizeString(params.model, "") || status.model;
    const existingTurnCount = this.sessionStore.listTurnIdsFromDisk(session.sessionId).length;
    if (this.directThreadStore) {
      this.prepareDirectContextProjection(session.sessionId);
    }
    let requestBody = buildTextOnlyProbeRequest({
      profileDoc: this.profileDoc,
      model,
      prompt,
    });
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input: [{ role: "user", text: prompt }],
      model: requestBody.model,
      clientTurnRequestId,
      requestShape: requestShapeForDiagnostic(requestBody),
    });
    this.rememberClientTurnRequest(session.sessionId, clientTurnRequestId, turn.turnId);
    let contextResult = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForTextTurn === "function") {
      this.indexDirectThreadStoreSession(session.sessionId);
      contextResult = this.directThreadStore.buildAndPersistContextForTextTurn({
        session: this.sessionStore.readSession(session.sessionId) || session,
        projectId: session.projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        currentUserPrompt: prompt,
        useRecentDialogue: existingTurnCount > 0,
        model: requestBody.model,
        requestShape: requestShapeForDiagnostic(requestBody),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: "direct_text_only_response",
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
      });
      requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
    }
    const requestShape = {
      ...requestShapeForDiagnostic(requestBody),
      ...(contextResult ? {
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        rawRequestBodyStored: false,
        previousResponseIdUsed: false,
      } : {}),
    };
    this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
      requestShape,
      ...(contextResult ? {
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        contextSummary: contextResult.rendererSafeSummary,
      } : {}),
    });

    const userItem = {
      id: `${turn.turnId}_user`,
      type: "userMessage",
      turnId: turn.turnId,
      content: [{ type: "text", text: prompt, text_elements: [] }],
    };
    this.emitNotification(surfaceSession, "turn/started", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      turn: { id: turn.turnId, status: "inProgress", startedAt: nowSeconds(), clientTurnRequestId },
    });
    this.emitNotification(surfaceSession, "item/started", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      item: userItem,
    });
    this.emitNotification(surfaceSession, "item/completed", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      item: userItem,
    });

    const abortController = new AbortController();
    const run = this.runTurn({
      sessionId: session.sessionId,
      turnId: turn.turnId,
      clientTurnRequestId,
      prompt: requestBody.input?.[0]?.content?.[0]?.text || prompt,
      instructions: requestBody.instructions,
      model: requestBody.model,
      project,
      surfaceSession,
      userItem,
      abortController,
    }).finally(() => {
      const active = this.activeRuns.get(turn.turnId);
      if (active?.promise === run) this.activeRuns.delete(turn.turnId);
    });
    this.activeRuns.set(turn.turnId, { abortController, promise: run });

    return {
      turn: {
        id: turn.turnId,
        status: "inProgress",
        state: "request_built",
        clientTurnRequestId,
      },
      reused: false,
    };
  }

  async runTurn(options = {}) {
    const {
      sessionId,
      turnId,
      clientTurnRequestId,
      prompt,
      instructions,
      model,
      project,
      surfaceSession,
      userItem,
      abortController,
    } = options;
    let terminalSent = false;
    const callerLifecycle = (event) => {
      if (event.phase === "streaming") {
        this.sessionStore.updateTurnState(sessionId, turnId, "streaming", {
          streamStartedAt: event.at,
          responseStatus: event.status,
          responseContentType: event.contentType,
        });
      }
    };
    const result = await runTextOnlyDirectProbe({
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model,
      prompt,
      instructions,
      fetchImpl: this.fetchImpl || undefined,
      signal: abortController.signal,
      onLifecycle: callerLifecycle,
    });
    this.sessionStore.writeDiagnostic(sessionId, "direct_live_text_turn", {
      ...result.diagnostic,
      clientTurnRequestId,
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
    });
    if (result.normalizedEvents.length) {
      this.sessionStore.appendNormalizedEvents(sessionId, turnId, result.normalizedEvents);
    }
    const terminal = result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null };
    const assistantItem = { id: `${turnId}_assistant`, type: "agentMessage", turnId, text: "" };
    let assistantStarted = false;
    let assistantCompleted = false;
    const emittedItems = [userItem];

    const emitAssistantStarted = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      this.emitNotification(surfaceSession, "item/started", {
        threadId: sessionId,
        turnId,
        item: assistantItem,
      });
    };
    const emitAssistantCompleted = () => {
      if (!assistantStarted || assistantCompleted) return;
      assistantCompleted = true;
      this.emitNotification(surfaceSession, "item/completed", {
        threadId: sessionId,
        turnId,
        item: assistantItem,
      });
    };

    for (const event of result.normalizedEvents) {
      if (event.type !== "message_delta") continue;
      emitAssistantStarted();
      if (assistantItem.text.length < this.maxAssistantChars) {
        const room = Math.max(0, this.maxAssistantChars - assistantItem.text.length);
        const truncatedDelta = String(event.text || "").slice(0, room);
        if (!truncatedDelta) continue;
        assistantItem.text += truncatedDelta;
        this.emitNotification(surfaceSession, "item/agentMessage/delta", {
          threadId: sessionId,
          turnId,
          itemId: assistantItem.id,
          delta: truncatedDelta,
        });
      }
    }
    if (assistantStarted) {
      emittedItems.push(assistantItem);
      emitAssistantCompleted();
    }

    const obligationResult = this.sessionStore.addToolObligations(sessionId, turnId, result.normalizedEvents);
    if (obligationResult.obligations.length) {
      for (const item of obligationResult.obligations.map(toolTranscriptItemFromObligation)) {
        emittedItems.push(item);
        this.emitNotification(surfaceSession, "item/started", { threadId: sessionId, turnId, item });
        this.emitNotification(surfaceSession, "item/completed", { threadId: sessionId, turnId, item });
      }
    }

    const terminalState = obligationResult.obligations.length ? "tool_waiting" : terminal.state;
    const completedTurn = this.sessionStore.updateTurnState(sessionId, turnId, terminalState, {
      ...(terminal.error ? { error: terminal.error } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
    });
    this.appendSessionTurn(sessionId, turnId, emittedItems, model, terminalState);
    if (obligationResult.obligations.length) {
      const createdApprovalRequests = this.emitToolApprovalRequests(surfaceSession, sessionId, turnId, obligationResult.obligations, project);
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: createdApprovalRequests
          ? "Direct live text detected a read-only tool call. Local approval is required before workspace content is sent back to the provider."
          : "Direct live text detected a tool call, but read-only tool continuation is not enabled by accepted evidence.",
      });
    }

    const finalTurn = this.sessionStore.readTurn(sessionId, turnId) || completedTurn;
    if (finalTurn.state === "failed" || finalTurn.state === "aborted") {
      this.emitNotification(surfaceSession, "error", {
        threadId: sessionId,
        turnId,
        error: finalTurn.error || result.error || { code: finalTurn.state, message: `Direct live text turn ${finalTurn.state}.` },
      });
    }
    if (!terminalSent) {
      terminalSent = true;
      this.emitNotification(surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: terminalStatusForState(finalTurn.state),
          completedAt: nowSeconds(),
          durationMs: Math.max(0, Date.parse(finalTurn.updatedAt) - Date.parse(finalTurn.createdAt)),
        },
      });
    }
    return {
      turn: turnSnapshot(finalTurn),
      result,
    };
  }

  readThread(params = {}) {
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
    };
  }

  interruptTurn(params = {}) {
    const turnId = normalizeString(params.turnId, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turn = turnId && sessionId ? this.sessionStore.readTurn(sessionId, turnId) : null;
    if (!turn) throw new Error(`Direct live text turn not found: ${turnId || "missing"}.`);
    if (TERMINAL_TURN_STATES.has(turn.state)) {
      return { turn: turnSnapshot(turn), status: `${turn.state}_already` };
    }
    const active = this.activeRuns.get(turn.turnId);
    if (active?.abortController) {
      active.abortController.abort();
      return { turn: turnSnapshot(turn), status: "abort_requested" };
    }
    const aborted = this.sessionStore.updateTurnState(sessionId, turnId, "aborted", {
      error: null,
    });
    return { turn: turnSnapshot(aborted), status: "aborted" };
  }

  async handleRequest(method, params = {}, context = {}) {
    if (method === "initialize") return this.initialize(params, context);
    if (method === "account/read") return this.accountRead(params, context);
    if (method === "thread/start") return this.startThread(params, context);
    if (method === "thread/read") return this.readThread(params, context);
    if (method === "turn/start") return this.startTurn(params, context);
    if (method === "turn/interrupt" || method === "turn/abort") return this.interruptTurn(params, context);
    throw new Error(`Direct live text controller does not support ${method}.`);
  }
}

class DirectLiveTextSurfaceSession extends EventEmitter {
  constructor(webContents, options = {}) {
    super();
    this.webContents = webContents;
    this.controller = options.controller;
    this.project = options.project || null;
    this.connection = null;
    this.connectionId = "";
    this.transportKind = DIRECT_LIVE_TEXT_SURFACE_TRANSPORT;
    this.serverRequests = new Map();
  }

  sendEvent(payload) {
    this.emit("event", payload);
    if (!this.webContents || this.webContents.isDestroyed()) return;
    this.webContents.send("codex-surface:event", payload);
  }

  emitStatus(status, extra = {}) {
    this.sendEvent({
      type: "connection-status",
      status,
      error: extra.error || "",
      connection: this.connection,
      connectionId: this.connectionId,
    });
  }

  async connect(connection = {}) {
    this.connectionId = crypto.randomUUID();
    const status = this.controller?.statusForProject?.(this.project || {}) || {};
    this.connection = {
      ...connection,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      connectionId: this.connectionId,
      capabilities: connection.capabilities || buildDirectLiveTextCapabilities(status),
    };
    this.emitStatus("connected");
    return {
      connected: true,
      connection: this.connection,
      connectionId: this.connectionId,
    };
  }

  async request(method, params = {}) {
    if (!this.controller) throw new Error("Direct live text controller is unavailable.");
    return this.controller.handleRequest(String(method || ""), params || {}, {
      project: this.project,
      surfaceSession: this,
      connection: this.connection,
    });
  }

  async notify() {
    return true;
  }

  publicServerRequest(record = {}) {
    return {
      key: record.key,
      id: record.id,
      method: record.method,
      title: record.title,
      summary: record.summary,
      riskCategory: record.riskCategory,
      status: record.status,
      params: record.params,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      responseSummary: record.responseSummary || "",
      errorSummary: record.errorSummary || "",
      rawBackendFramesExposed: false,
      rawAuthHeadersExposed: false,
    };
  }

  createReadOnlyToolRequest(input = {}) {
    const params = isPlainObject(input.params) ? input.params : {};
    const id = normalizeString(input.id, `direct_readonly_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const key = `direct:${id}`;
    const now = nowIso();
    const record = {
      id,
      key,
      method: "direct/tool/readOnly/requestApproval",
      title: "Approve read-only file access",
      summary: normalizeString(input.summary || params.relPath || params.tool, "read_file"),
      riskCategory: "readOnly",
      status: "pending",
      params,
      createdAt: now,
      updatedAt: now,
    };
    this.serverRequests.set(key, record);
    this.sendEvent({
      type: "rpc-request",
      request: this.publicServerRequest(record),
    });
    return this.publicServerRequest(record);
  }

  async respond(key, result = {}) {
    const requestKey = normalizeString(key, "");
    const record = this.serverRequests.get(requestKey);
    if (!record) throw new Error("Direct live text runtime has no pending server request.");
    if (record.status !== "pending") {
      return { request: this.publicServerRequest(record), reused: true };
    }
    try {
      const response = await this.controller.handleReadOnlyToolResponse(record, result || {}, {
        project: this.project,
        surfaceSession: this,
        connection: this.connection,
      });
      const next = {
        ...record,
        status: "completed",
        updatedAt: nowIso(),
        response,
        responseSummary: response?.decision || "completed",
      };
      this.serverRequests.set(requestKey, next);
      this.sendEvent({
        type: "rpc-request-updated",
        request: this.publicServerRequest(next),
      });
      return { request: this.publicServerRequest(next), response };
    } catch (error) {
      const next = {
        ...record,
        status: "failed",
        updatedAt: nowIso(),
        errorSummary: error?.message || "Direct read-only tool response failed.",
      };
      this.serverRequests.set(requestKey, next);
      this.sendEvent({
        type: "rpc-request-updated",
        request: this.publicServerRequest(next),
      });
      throw error;
    }
  }

  hasServerRequest(key = "") {
    if (!key) return [...this.serverRequests.values()].some((request) => request.status === "pending");
    return this.serverRequests.has(key);
  }

  async dispose(options = {}) {
    if (!options.silent) this.emitStatus("disconnected", { error: options.reason || "" });
    this.connection = null;
    this.connectionId = "";
  }
}

module.exports = {
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  buildDirectLiveTextCapabilities,
  modelEvidenceFor,
};
