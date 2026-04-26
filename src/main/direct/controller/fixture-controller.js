"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { loadFixtureFile, NORMALIZED_FIXTURE_DIR } = require("../fixtures/fixture-loader");

const DIRECT_FIXTURE_SURFACE_TRANSPORT = "direct-fixture";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
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

function fixtureThreadTitle(project = {}) {
  return `${normalizeString(project.name, "Direct fixture")} fixture session`;
}

function buildDirectFixtureCapabilities() {
  return {
    version: 1,
    status: "ready",
    generatedAt: nowIso(),
    coreRuntime: {
      canConnect: true,
      canInitialize: true,
      transport: DIRECT_FIXTURE_SURFACE_TRANSPORT,
      transports: [DIRECT_FIXTURE_SURFACE_TRANSPORT],
      schemaSource: "direct-fixture-controller",
    },
    threads: {
      canStart: true,
      canRead: false,
      canResume: false,
      canList: false,
      canFork: false,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: true,
      canSteer: false,
      canInterrupt: false,
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
      runtime: DIRECT_FIXTURE_SURFACE_TRANSPORT,
      source: "direct-fixture-controller",
      fixtureId: "plain-text-turn",
    },
  };
}

function threadSnapshotFromSession(session, model = "") {
  return {
    id: session.sessionId,
    title: normalizeString(session.title, "Direct fixture session"),
    preview: normalizeString(session.title, "Direct fixture session"),
    turns: Array.isArray(session.messages) ? session.messages : [],
    model: normalizeString(model, session.model),
  };
}

function assistantItemId(turnId, event) {
  return normalizeString(event.itemId, "") || `${turnId}_assistant`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

class DirectFixtureController {
  constructor(options = {}) {
    this.sessionStore = options.sessionStore;
    this.profileDoc = isPlainObject(options.profileDoc) ? options.profileDoc : {};
    this.fixturePath = options.fixturePath || path.join(NORMALIZED_FIXTURE_DIR, "plain-text-turn.json");
    this.normalizedEvents = this.readNormalizedEvents();
  }

  defaultModel(project = {}) {
    const configured = normalizeString(project.surfaceBinding?.codex?.model || project.codex?.model, "");
    if (configured) return configured;
    const models = this.profileDoc.profile?.ontology?.models;
    const accepted = Array.isArray(models) ? models.find((model) => model?.id && model.status !== "rejected") : null;
    return normalizeString(accepted?.id, "gpt-5.4");
  }

  readNormalizedEvents() {
    const fixture = loadFixtureFile(this.fixturePath, { requireRedacted: true });
    return Array.isArray(fixture.records) ? fixture.records : [];
  }

  loadNormalizedEvents() {
    return cloneJson(this.normalizedEvents);
  }

  initialize() {
    return {
      runtime: DIRECT_FIXTURE_SURFACE_TRANSPORT,
      capabilities: buildDirectFixtureCapabilities(),
    };
  }

  accountRead() {
    return {
      account: {
        type: "chatgpt",
        planType: "fixture",
        email: "direct-fixture@local",
      },
      requiresOpenaiAuth: false,
    };
  }

  startThread(params = {}, context = {}) {
    const project = context.project || {};
    const model = normalizeString(params.model, "") || this.defaultModel(project);
    const session = this.sessionStore.createSession({
      projectId: normalizeString(project.id, ""),
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      title: fixtureThreadTitle(project),
      model,
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
    });
    return {
      thread: threadSnapshotFromSession(session, model),
      model,
    };
  }

  emitNotification(surfaceSession, method, params = {}) {
    surfaceSession.sendEvent({
      type: "rpc-notification",
      method,
      params,
    });
  }

  appendSessionTurn(session, turnId, items, model, status = "completed") {
    const nextMessages = [
      ...(Array.isArray(session.messages) ? session.messages : []),
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

  completedItemsForTurn(userItem, assistantItems) {
    return [
      userItem,
      ...Array.from(assistantItems.values()).filter((item) => item?.type === "agentMessage"),
    ];
  }

  async startTurn(params = {}, context = {}) {
    const surfaceSession = context.surfaceSession;
    const threadId = normalizeString(params.threadId, "");
    const session = this.sessionStore.readSession(threadId);
    if (!session) throw new Error(`Direct fixture session not found: ${threadId}`);
    const model = normalizeString(params.model, "") || this.defaultModel(context.project || {});
    const input = Array.isArray(params.input) ? params.input : [];
    const prompt = firstTextInput(input);
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input,
      model,
    });
    const turnId = turn.turnId;
    const userItem = {
      id: `${turnId}_user`,
      type: "userMessage",
      turnId,
      content: prompt ? [{ type: "text", text: prompt, text_elements: [] }] : input,
    };
    const assistantItems = new Map();
    const normalizedEvents = this.loadNormalizedEvents();
    const eventsToPersist = [];

    this.emitNotification(surfaceSession, "turn/started", {
      threadId: session.sessionId,
      turnId,
      turn: { id: turnId, status: "inProgress", startedAt: nowSeconds() },
    });
    this.emitNotification(surfaceSession, "item/started", {
      threadId: session.sessionId,
      turnId,
      item: userItem,
    });
    this.emitNotification(surfaceSession, "item/completed", {
      threadId: session.sessionId,
      turnId,
      item: userItem,
    });

    for (const event of normalizedEvents) {
      eventsToPersist.push(event);
      if (event.type === "message_delta") {
        const itemId = assistantItemId(turnId, event);
        if (!assistantItems.has(itemId)) {
          const item = { id: itemId, type: "agentMessage", turnId, text: "" };
          assistantItems.set(itemId, item);
          this.emitNotification(surfaceSession, "item/started", {
            threadId: session.sessionId,
            turnId,
            item,
          });
        }
        const item = assistantItems.get(itemId);
        item.text = `${item.text || ""}${event.text || ""}`;
        this.emitNotification(surfaceSession, "item/agentMessage/delta", {
          threadId: session.sessionId,
          turnId,
          itemId,
          delta: event.text || "",
        });
      } else if (event.type === "reasoning_delta") {
        const itemId = normalizeString(event.itemId, "") || `${turnId}_reasoning`;
        if (!assistantItems.has(itemId)) {
          const item = { id: itemId, type: "agentMessage", phase: "commentary", turnId, text: "" };
          assistantItems.set(itemId, item);
          this.emitNotification(surfaceSession, "item/started", {
            threadId: session.sessionId,
            turnId,
            item,
          });
        }
        const item = assistantItems.get(itemId);
        item.text = `${item.text || ""}${event.text || ""}`;
        this.emitNotification(surfaceSession, "item/agentMessage/delta", {
          threadId: session.sessionId,
          turnId,
          itemId,
          delta: event.text || "",
          phase: "commentary",
        });
      } else if (event.type === "response_failed" || event.type === "transport_error" || event.type === "auth_error" || event.type === "quota_error") {
        this.sessionStore.appendNormalizedEvents(session.sessionId, turnId, eventsToPersist);
        const failedTurn = this.sessionStore.updateTurnState(session.sessionId, turnId, "failed", {
          error: {
            code: normalizeString(event.code, event.type),
            message: normalizeString(event.message, "Direct fixture turn failed."),
          },
        });
        this.emitNotification(surfaceSession, "error", {
          threadId: session.sessionId,
          turnId,
          error: failedTurn.error,
        });
        const failedSession = this.sessionStore.readSession(session.sessionId);
        this.appendSessionTurn(
          failedSession || session,
          turnId,
          this.completedItemsForTurn(userItem, assistantItems),
          model,
          "failed",
        );
        return { turn: { id: turnId, status: "failed", error: failedTurn.error } };
      }
    }

    this.sessionStore.appendNormalizedEvents(session.sessionId, turnId, eventsToPersist);
    for (const item of assistantItems.values()) {
      if (item.type === "agentMessage") {
        this.emitNotification(surfaceSession, "item/completed", {
          threadId: session.sessionId,
          turnId,
          item,
        });
      }
    }
    const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turnId, "completed");
    const nextSession = this.sessionStore.readSession(session.sessionId);
    this.appendSessionTurn(nextSession || session, turnId, this.completedItemsForTurn(userItem, assistantItems), model);
    this.emitNotification(surfaceSession, "turn/completed", {
      threadId: session.sessionId,
      turnId,
      turn: {
        id: turnId,
        status: "completed",
        completedAt: nowSeconds(),
        durationMs: Math.max(0, Date.parse(completedTurn.updatedAt) - Date.parse(completedTurn.createdAt)),
      },
    });
    return {
      turn: {
        id: turnId,
        status: "completed",
      },
    };
  }

  async handleRequest(method, params = {}, context = {}) {
    if (method === "initialize") return this.initialize(params, context);
    if (method === "account/read") return this.accountRead(params, context);
    if (method === "thread/start") return this.startThread(params, context);
    if (method === "turn/start") return this.startTurn(params, context);
    throw new Error(`Direct fixture controller does not support ${method}.`);
  }
}

class DirectFixtureSurfaceSession extends EventEmitter {
  constructor(webContents, options = {}) {
    super();
    this.webContents = webContents;
    this.controller = options.controller;
    this.project = options.project || null;
    this.connection = null;
    this.connectionId = "";
    this.transportKind = DIRECT_FIXTURE_SURFACE_TRANSPORT;
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
    this.connection = {
      ...connection,
      transport: DIRECT_FIXTURE_SURFACE_TRANSPORT,
      connectionId: this.connectionId,
      capabilities: connection.capabilities || buildDirectFixtureCapabilities(),
    };
    this.emitStatus("connected");
    return {
      connected: true,
      connection: this.connection,
      connectionId: this.connectionId,
    };
  }

  async request(method, params = {}) {
    if (!this.controller) throw new Error("Direct fixture controller is unavailable.");
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
    throw new Error("Direct fixture runtime has no pending server request.");
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
  DIRECT_FIXTURE_SURFACE_TRANSPORT,
  DirectFixtureController,
  DirectFixtureSurfaceSession,
  buildDirectFixtureCapabilities,
};
