"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  buildTextOnlyProbeRequest,
  requestShapeForDiagnostic,
  runTextOnlyDirectProbe,
} = require("../transport/codex-responses-transport");
const { toolTranscriptItemFromObligation } = require("../session/session-store");

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function nowSeconds() {
  return Date.now() / 1000;
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
      approvalPolicies: [],
      sandboxModes: [],
    },
    requests: {
      supportedServerMethods: [],
      unsupportedButHandledMethods: [],
      unknownRequestPolicy: "error-visible",
    },
    diagnostics: {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      source: "direct-live-text-controller",
      appServerRequired: false,
      toolsEnabled: false,
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
    this.refreshCredentials = typeof options.refreshCredentials === "function" ? options.refreshCredentials : null;
    this.fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : null;
    this.endpoint = normalizeString(options.endpoint, "");
    this.maxPromptChars = Number(options.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS);
    this.maxAssistantChars = Number(options.maxAssistantChars || DEFAULT_MAX_ASSISTANT_CHARS);
    this.activeRuns = new Map();
  }

  authStatus() {
    return this.authStore && typeof this.authStore.readStatus === "function"
      ? sanitizeStatus(this.authStore.readStatus())
      : sanitizeStatus(null);
  }

  statusForProject(project = {}) {
    const auth = this.authStatus();
    const evidence = modelEvidenceFor(this.profileDoc, project.surfaceBinding?.codex?.model || project.codex?.model || "");
    let status = "ready";
    let reason = "";
    if (auth.status !== "authenticated") {
      status = "auth_required";
      reason = "direct_auth_required";
    } else if (!evidence.accepted) {
      status = "profile_required";
      reason = "accepted_text_model_required";
    }
    return {
      status,
      turnRunnable: status === "ready",
      model: evidence.model,
      modelSource: evidence.modelSource,
      modelEvidenceState: evidence.modelEvidenceState,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      appServerRequired: false,
      toolsEnabled: false,
      reason,
      auth,
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
    const requestBody = buildTextOnlyProbeRequest({
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
    this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
      requestShape: requestShapeForDiagnostic(requestBody),
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
      prompt,
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
      authStore: this.authStore,
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model,
      prompt,
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
        assistantItem.text += String(event.text || "").slice(0, room);
      }
      this.emitNotification(surfaceSession, "item/agentMessage/delta", {
        threadId: sessionId,
        turnId,
        itemId: assistantItem.id,
        delta: String(event.text || ""),
      });
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
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: "Direct live text detected a model tool call. Execution and continuation are disabled in this bundle.",
      });
    }

    const terminalState = obligationResult.obligations.length ? "tool_waiting" : terminal.state;
    const completedTurn = this.sessionStore.updateTurnState(sessionId, turnId, terminalState, {
      ...(terminal.error ? { error: terminal.error } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
    });
    this.appendSessionTurn(sessionId, turnId, emittedItems, model, terminalState);

    if (terminalState === "failed" || terminalState === "aborted") {
      this.emitNotification(surfaceSession, "error", {
        threadId: sessionId,
        turnId,
        error: completedTurn.error || result.error || { code: terminalState, message: `Direct live text turn ${terminalState}.` },
      });
    }
    if (!terminalSent) {
      terminalSent = true;
      this.emitNotification(surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: terminalStatusForState(terminalState),
          completedAt: nowSeconds(),
          durationMs: Math.max(0, Date.parse(completedTurn.updatedAt) - Date.parse(completedTurn.createdAt)),
        },
      });
    }
    return {
      turn: turnSnapshot(completedTurn),
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

  async respond() {
    throw new Error("Direct live text runtime has no pending server request.");
  }

  hasServerRequest() {
    return false;
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
