"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { DirectLiveTextSurfaceSession } = require("../controller/live-text-controller");
const {
  HEADLESS_TURN_PACKET_SCHEMA,
  normalizeString,
  stableStringify,
} = require("./bridge-store");

const HEADLESS_DIRECT_TEXT_RUNTIME_SCHEMA = "headless_direct_text_runtime@1";
const TERMINAL_PACKET_STATES = new Set([
  "provider_completed",
  "failed",
  "handoff_unknown",
  "replay_unsafe",
]);
const SUPPORTED_RUNTIME_PATHS = new Set(["direct-text", "direct-implementation"]);
const IMPLEMENTATION_PENDING_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
]);
const IMPLEMENTATION_AUTO_APPROVE_METHODS = new Set([
  "direct/tool/readOnly/requestApproval",
  "direct/tool/patchApply/requestApproval",
  "direct/tool/command/requestApproval",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function shortDigest(value) {
  return sha256(value).slice(7, 31);
}

function promptTextFromEvent(input = {}) {
  const direct = normalizeString(input.promptText || input.prompt_text || input.text || input.message, "");
  if (direct) return direct;
  const facts = isPlainObject(input.facts) ? input.facts : {};
  return normalizeString(facts.promptText || facts.prompt_text || facts.text || facts.message, "");
}

function targetRuntimePath(route = {}) {
  const ref = isPlainObject(route.targetThreadRef) ? route.targetThreadRef : {};
  return normalizeString(ref.runtimePath || ref.runtime_path, "direct-text");
}

function routeTargetThreadId(route = {}) {
  const ref = isPlainObject(route.targetThreadRef) ? route.targetThreadRef : {};
  return normalizeString(ref.threadId || ref.thread_id, "");
}

function routeImplementationPolicy(route = {}) {
  const configured = isPlainObject(route.headlessImplementationPolicy) ? route.headlessImplementationPolicy : {};
  const toolAuthorityMode = normalizeString(route.toolAuthorityMode || route.tool_authority_mode, "disabled");
  return {
    schema: "headless_implementation_policy@1",
    toolAuthorityMode,
    autoDecisionMode: normalizeString(configured.autoDecisionMode || configured.autoDecision || route.autoDecisionMode, "disabled"),
    disposableWorkspace: configured.disposableWorkspace === true || route.disposableWorkspace === true,
    allowedMethods: Array.isArray(configured.allowedMethods)
      ? configured.allowedMethods.map((method) => normalizeString(method, "")).filter(Boolean)
      : [],
    maxAutoDecisions: Math.max(0, Number(configured.maxAutoDecisions || 0) || 0),
  };
}

function projectForRuntime(project = {}, runtimePath = "") {
  if (runtimePath !== "direct-implementation") return project;
  const surfaceBinding = isPlainObject(project.surfaceBinding) ? project.surfaceBinding : {};
  const codex = isPlainObject(surfaceBinding.codex) ? surfaceBinding.codex : {};
  return {
    ...project,
    surfaceBinding: {
      ...surfaceBinding,
      codex: {
        ...codex,
        runtimeMode: "direct-experimental",
        directTransport: "live-text",
        directTier: "implementation-lane",
      },
    },
  };
}

function safeError(error) {
  return {
    code: normalizeString(error?.code, "headless_direct_text_failed"),
    message: normalizeString(error?.message, "Headless direct text turn failed."),
  };
}

function terminalStateForTurn(turn = {}) {
  const state = normalizeString(turn.state || turn.status, "");
  if (state === "completed") return "provider_completed";
  if (state === "tool_waiting" || state === "authority_waiting") return "authority_waiting";
  if (state === "transport_handoff_unknown") return "handoff_unknown";
  if (!state) return "failed";
  return state === "failed" || state.endsWith("_terminal") || state.includes("blocked") ? "failed" : "provider_completed";
}

class HeadlessSurfaceSession extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.serverRequests = new Map();
  }

  sendEvent(event) {
    this.events.push(event);
    this.emit("event", event);
  }

  hasServerRequest(key = "") {
    if (!key) return [...this.serverRequests.values()].some((request) => request.status === "pending");
    return this.serverRequests.has(key);
  }
}

class DirectHeadlessTextRuntime {
  constructor(options = {}) {
    if (!options.store) throw new Error("headless_text_runtime_missing_store");
    if (!options.controller) throw new Error("headless_text_runtime_missing_controller");
    this.store = options.store;
    this.controller = options.controller;
    this.project = isPlainObject(options.project) ? options.project : {};
    this.activeByThread = new Map();
    this.queueByThread = new Map();
    this.retryTimersByThread = new Map();
    this.deferNextByThread = new Set();
    this.activeTurnRetryDelayMs = Math.max(100, Number(options.activeTurnRetryDelayMs) || 1000);
    this.implementationSettleTimeoutMs = Math.max(500, Number(options.implementationSettleTimeoutMs) || 5000);
  }

  statusProjection() {
    return {
      schema: "headless_direct_text_runtime_status@1",
      activeTurns: this.activeByThread.size,
      queuedTurns: [...this.queueByThread.values()].reduce((sum, queue) => sum + queue.length, 0),
      turnPackets: this.store.turnPacketSummary(),
    };
  }

  submitEvent(body = {}) {
    const result = this.store.submitEvent(body);
    if (!result.ok) return result;
    if (result.duplicate) {
      const existingPacket = result.event?.envelopeId
        ? this.store.readTurnPacketForEnvelope(result.event.envelopeId)
        : null;
      if (existingPacket) {
        return {
          ...result,
          turnPacket: existingPacket,
          queued: !TERMINAL_PACKET_STATES.has(existingPacket.state),
        };
      }
      return result;
    }
    const packetResult = this.enqueueAcceptedEvent(result, body);
    return {
      ...result,
      turnPacket: packetResult.packet,
      queued: packetResult.queued,
    };
  }

  enqueueAcceptedEvent(result = {}, body = {}) {
    const event = result.event || {};
    const existingPacket = this.store.readTurnPacketForEnvelope(event.envelopeId);
    if (existingPacket) {
      return {
        packet: existingPacket,
        queued: !TERMINAL_PACKET_STATES.has(existingPacket.state),
      };
    }
    const packet = this.buildTurnPacket(result, body);
    const stored = this.store.writeTurnPacket(packet);
    const targetThreadId = stored.targetThreadId;
    if (this.activeByThread.has(targetThreadId)) {
      this.queuePacket(stored);
      return { packet: stored, queued: true };
    }
    this.startPacket(stored);
    return { packet: this.store.readTurnPacket(stored.packetId) || stored, queued: false };
  }

  buildTurnPacket(result = {}, body = {}) {
    const event = result.event || {};
    const route = this.store.readRoute(event.requestedRouteId, event.routeVersion);
    if (!route) throw new Error("headless_text_route_missing_after_accept");
    const runtimePath = targetRuntimePath(route);
    const routeTargetId = routeTargetThreadId(route);
    const promptText = promptTextFromEvent(body);
    const packetId = `headless_turn_packet_${shortDigest(`${event.envelopeId}:${event.payloadDigest}:${runtimePath}`)}`;
    const now = nowIso();
    const implementationPolicy = routeImplementationPolicy(route);
    if (!SUPPORTED_RUNTIME_PATHS.has(runtimePath)) {
      return {
        schema: HEADLESS_TURN_PACKET_SCHEMA,
        packetId,
        envelopeId: event.envelopeId,
        routeId: route.routeId,
        routeVersion: route.routeVersion,
        routeDigest: route.routeDigest,
        workThreadId: event.declaredWorkThreadId || result.routeDecision?.workThreadId || "",
        targetThreadId: routeTargetId,
        runtimePath,
        state: "failed",
        blockerCode: "unsupported_runtime_path",
        replayState: "replay_unsafe",
        promptDigest: promptText ? sha256(promptText) : "",
        promptText: "",
        rawEventPayloadIncluded: false,
        providerStarted: false,
        providerCompleted: false,
        createdAt: now,
        updatedAt: now,
        statusHistory: [{ state: "failed", at: now, reason: "unsupported_runtime_path" }],
      };
    }
    if (
      runtimePath === "direct-implementation" &&
      implementationPolicy.autoDecisionMode === "approve" &&
      implementationPolicy.disposableWorkspace !== true
    ) {
      return {
        schema: HEADLESS_TURN_PACKET_SCHEMA,
        packetId,
        envelopeId: event.envelopeId,
        routeId: route.routeId,
        routeVersion: route.routeVersion,
        routeDigest: route.routeDigest,
        workThreadId: event.declaredWorkThreadId || result.routeDecision?.workThreadId || "",
        targetThreadId: routeTargetId,
        runtimePath,
        state: "failed",
        blockerCode: "headless_implementation_auto_approval_requires_disposable_workspace",
        replayState: "replay_unsafe",
        promptDigest: promptText ? sha256(promptText) : "",
        promptText: "",
        rawEventPayloadIncluded: false,
        providerStarted: false,
        providerCompleted: false,
        headlessImplementationPolicy: implementationPolicy,
        createdAt: now,
        updatedAt: now,
        statusHistory: [{ state: "failed", at: now, reason: "headless_implementation_auto_approval_requires_disposable_workspace" }],
      };
    }
    if (!promptText) {
      return {
        schema: HEADLESS_TURN_PACKET_SCHEMA,
        packetId,
        envelopeId: event.envelopeId,
        routeId: route.routeId,
        routeVersion: route.routeVersion,
        routeDigest: route.routeDigest,
        workThreadId: event.declaredWorkThreadId || result.routeDecision?.workThreadId || "",
        targetThreadId: routeTargetId,
        runtimePath,
        state: "failed",
        blockerCode: "missing_prompt_text",
        replayState: "replay_unsafe",
        promptDigest: "",
        promptText: "",
        rawEventPayloadIncluded: false,
        providerStarted: false,
        providerCompleted: false,
        ...(runtimePath === "direct-implementation" ? { headlessImplementationPolicy: implementationPolicy } : {}),
        createdAt: now,
        updatedAt: now,
        statusHistory: [{ state: "failed", at: now, reason: "missing_prompt_text" }],
      };
    }
    return {
      schema: HEADLESS_TURN_PACKET_SCHEMA,
      packetId,
      envelopeId: event.envelopeId,
      routeId: route.routeId,
      routeVersion: route.routeVersion,
      routeDigest: route.routeDigest,
      workThreadId: event.declaredWorkThreadId || result.routeDecision?.workThreadId || "",
      targetThreadId: routeTargetId,
      runtimePath,
      state: "queued",
      activeTurnPolicy: "queue_after_active_turn",
      replayState: "replay_safe_before_provider",
      promptDigest: sha256(promptText),
      promptText,
      promptChars: promptText.length,
      rawEventPayloadIncluded: false,
      providerStarted: false,
      providerCompleted: false,
      ...(runtimePath === "direct-implementation" ? { headlessImplementationPolicy: implementationPolicy } : {}),
      headlessImplementationDecisions: [],
      clientTurnRequestId: `headless_${shortDigest(`${event.envelopeId}:${promptText}`)}`,
      createdAt: now,
      updatedAt: now,
      statusHistory: [{ state: "queued", at: now }],
    };
  }

  queuePacket(packet = {}) {
    const threadId = normalizeString(packet.targetThreadId, "");
    if (!this.queueByThread.has(threadId)) this.queueByThread.set(threadId, []);
    this.queueByThread.get(threadId).push(packet.packetId);
  }

  scheduleRetry(threadId = "") {
    if (this.retryTimersByThread.has(threadId)) return;
    const timer = setTimeout(() => {
      this.retryTimersByThread.delete(threadId);
      if (!this.activeByThread.has(threadId)) this.processNext(threadId);
    }, this.activeTurnRetryDelayMs);
    if (typeof timer.unref === "function") timer.unref();
    this.retryTimersByThread.set(threadId, timer);
  }

  startPacket(packet = {}) {
    if (packet.state === "failed") return packet;
    const threadId = normalizeString(packet.targetThreadId, "");
    this.activeByThread.set(threadId, packet.packetId);
    this.runPacket(packet).finally(() => {
      if (this.activeByThread.get(threadId) === packet.packetId) this.activeByThread.delete(threadId);
      const deferred = this.deferNextByThread.delete(threadId);
      if (!deferred) this.processNext(threadId);
    });
    return packet;
  }

  processNext(threadId = "") {
    if (this.activeByThread.has(threadId)) return;
    const queue = this.queueByThread.get(threadId);
    if (!queue?.length) {
      this.queueByThread.delete(threadId);
      return;
    }
    while (queue.length) {
      const nextPacketId = queue.shift();
      const packet = nextPacketId ? this.store.readTurnPacket(nextPacketId) : null;
      if (!packet || TERMINAL_PACKET_STATES.has(packet.state)) continue;
      if (!queue.length) this.queueByThread.delete(threadId);
      this.startPacket(packet);
      return;
    }
    this.queueByThread.delete(threadId);
  }

  createImplementationSurfaceSession(packet = {}, route = {}) {
    const project = projectForRuntime(this.project, packet.runtimePath);
    const surfaceSession = new DirectLiveTextSurfaceSession({
      isDestroyed: () => true,
      send: () => {},
    }, {
      controller: this.controller,
      project,
    });
    surfaceSession.on("event", (event) => {
      this.handleImplementationSurfaceEvent(packet, route, surfaceSession, event).catch(() => {});
    });
    return surfaceSession;
  }

  async handleImplementationSurfaceEvent(packet = {}, route = {}, surfaceSession, event = {}) {
    if (event.type !== "rpc-request") return;
    const request = event.request || {};
    const policy = isPlainObject(packet.headlessImplementationPolicy)
      ? packet.headlessImplementationPolicy
      : routeImplementationPolicy(route);
    const method = normalizeString(request.method, "");
    const allowedMethods = Array.isArray(policy.allowedMethods) && policy.allowedMethods.length
      ? new Set(policy.allowedMethods)
      : IMPLEMENTATION_AUTO_APPROVE_METHODS;
    const existingDecisions = Array.isArray(packet.headlessImplementationDecisions)
      ? packet.headlessImplementationDecisions
      : [];
    if (
      policy.autoDecisionMode !== "approve" ||
      policy.disposableWorkspace !== true ||
      !allowedMethods.has(method) ||
      existingDecisions.length >= Number(policy.maxAutoDecisions || 0)
    ) {
      const latest = this.store.readTurnPacket(packet.packetId) || packet;
      this.store.updateTurnPacket(packet.packetId, {
        headlessImplementationDecisions: [
          ...(Array.isArray(latest.headlessImplementationDecisions) ? latest.headlessImplementationDecisions : []),
          {
            requestKey: normalizeString(request.key, ""),
            method,
            decision: "pending_for_human",
            reason: "headless_auto_approval_not_available",
            at: nowIso(),
          },
        ],
      });
      return;
    }
    const approveToken = normalizeString(request.params?.actionTokens?.approve, "");
    const decisionId = `headless_decision_${shortDigest(`${packet.packetId}:${request.key}:approve`)}`;
    const response = await surfaceSession.respond(request.key, {
      decision: "approve",
      clientToolDecisionId: decisionId,
      actionTokenId: approveToken,
    });
    const latest = this.store.readTurnPacket(packet.packetId) || packet;
    this.store.updateTurnPacket(packet.packetId, {
      headlessImplementationDecisions: [
        ...(Array.isArray(latest.headlessImplementationDecisions) ? latest.headlessImplementationDecisions : []),
        {
          requestKey: normalizeString(request.key, ""),
          method,
          decision: "approve",
          responseSummary: normalizeString(response?.request?.responseSummary || response?.response?.decision, ""),
          at: nowIso(),
          rawProviderPayloadIncluded: false,
          rawWorkspacePathIncluded: false,
        },
      ],
    });
  }

  async waitForImplementationSettled(surfaceSession, sessionId = "", turnId = "") {
    const deadline = Date.now() + this.implementationSettleTimeoutMs;
    while (Date.now() < deadline) {
      const pending = surfaceSession?.hasServerRequest?.() === true;
      const turn = this.controller.sessionStore?.readTurn
        ? this.controller.sessionStore.readTurn(sessionId, turnId)
        : null;
      const state = normalizeString(turn?.state, "");
      if (!pending && state && !IMPLEMENTATION_PENDING_TURN_STATES.has(state)) return turn;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.controller.sessionStore?.readTurn
      ? this.controller.sessionStore.readTurn(sessionId, turnId)
      : null;
  }

  async runPacket(packet = {}) {
    const packetId = normalizeString(packet.packetId, "");
    const mark = (state, patch = {}) => {
      return this.store.updateTurnPacket(packetId, {
        ...patch,
        state,
        statusHistory: [{ state, at: nowIso(), reason: normalizeString(patch.reason, "") }],
      });
    };
    try {
      const route = this.store.readRoute(packet.routeId, packet.routeVersion);
      const implementationRuntime = packet.runtimePath === "direct-implementation";
      mark("context_built", {
        replayState: "replay_safe_before_provider",
      });
      const surfaceSession = implementationRuntime
        ? this.createImplementationSurfaceSession(packet, route || {})
        : new HeadlessSurfaceSession();
      if (implementationRuntime && typeof surfaceSession.connect === "function") {
        await surfaceSession.connect({ transport: "direct-live-text-headless" });
      }
      const context = {
        project: projectForRuntime(this.project, packet.runtimePath),
        surfaceSession,
      };
      const startThreadParams = {
        sessionId: packet.targetThreadId,
        threadId: packet.targetThreadId,
        title: `Headless ${packet.routeId}`,
        workThreadId: packet.workThreadId,
      };
      const thread = implementationRuntime
        ? await surfaceSession.request("thread/start", startThreadParams)
        : this.controller.startThread(startThreadParams, context);
      mark("provider_started", {
        providerStarted: true,
        replayState: "replay_unsafe",
        threadId: thread?.thread?.id || packet.targetThreadId,
      });
      const startTurnParams = {
        sessionId: packet.targetThreadId,
        threadId: packet.targetThreadId,
        clientTurnRequestId: packet.clientTurnRequestId,
        promptText: packet.promptText,
        workThreadId: packet.workThreadId,
      };
      const turnAck = implementationRuntime
        ? await surfaceSession.request("turn/start", startTurnParams)
        : await this.controller.startTurn(startTurnParams, context);
      const active = this.controller.activeRuns?.get(turnAck?.turn?.id);
      if (active?.promise) await active.promise;
      if (implementationRuntime) {
        await this.waitForImplementationSettled(surfaceSession, packet.targetThreadId, turnAck?.turn?.id);
      }
      const finalTurn = this.controller.sessionStore?.readTurn
        ? this.controller.sessionStore.readTurn(packet.targetThreadId, turnAck?.turn?.id)
        : null;
      const terminalState = terminalStateForTurn(finalTurn || turnAck?.turn || {});
      mark(terminalState, {
        providerCompleted: terminalState === "provider_completed",
        turnId: turnAck?.turn?.id || "",
        terminalTurnState: normalizeString(finalTurn?.state || turnAck?.turn?.state || turnAck?.turn?.status, ""),
        error: isPlainObject(finalTurn?.error) ? finalTurn.error : null,
      });
    } catch (error) {
      const code = normalizeString(error?.code, "");
      mark(code === "active_turn_exists" ? "queued" : "failed", {
        reason: code || "headless_direct_text_failed",
        error: safeError(error),
        replayState: "replay_unsafe",
      });
      if (code === "active_turn_exists") {
        const queued = this.store.readTurnPacket(packetId);
        this.queuePacket(queued || packet);
        this.deferNextByThread.add(normalizeString(packet.targetThreadId, ""));
        this.scheduleRetry(normalizeString(packet.targetThreadId, ""));
      }
    }
  }
}

module.exports = {
  DirectHeadlessTextRuntime,
  HEADLESS_DIRECT_TEXT_RUNTIME_SCHEMA,
  HeadlessSurfaceSession,
  promptTextFromEvent,
};
