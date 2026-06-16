"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
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

function safeError(error) {
  return {
    code: normalizeString(error?.code, "headless_direct_text_failed"),
    message: normalizeString(error?.message, "Headless direct text turn failed."),
  };
}

function terminalStateForTurn(turn = {}) {
  const state = normalizeString(turn.state || turn.status, "");
  if (state === "completed") return "provider_completed";
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
    if (!result.ok || result.duplicate) return result;
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
    if (runtimePath !== "direct-text") {
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

  startPacket(packet = {}) {
    if (packet.state === "failed") return packet;
    const threadId = normalizeString(packet.targetThreadId, "");
    this.activeByThread.set(threadId, packet.packetId);
    this.runPacket(packet).finally(() => {
      if (this.activeByThread.get(threadId) === packet.packetId) this.activeByThread.delete(threadId);
      this.processNext(threadId);
    });
    return packet;
  }

  processNext(threadId = "") {
    const queue = this.queueByThread.get(threadId) || [];
    const nextPacketId = queue.shift();
    if (!queue.length) this.queueByThread.delete(threadId);
    if (!nextPacketId) return;
    const packet = this.store.readTurnPacket(nextPacketId);
    if (packet && !TERMINAL_PACKET_STATES.has(packet.state)) this.startPacket(packet);
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
      mark("context_built", {
        replayState: "replay_safe_before_provider",
      });
      const surfaceSession = new HeadlessSurfaceSession();
      const context = {
        project: this.project,
        surfaceSession,
      };
      const thread = this.controller.startThread({
        sessionId: packet.targetThreadId,
        threadId: packet.targetThreadId,
        title: `Headless ${packet.routeId}`,
        workThreadId: packet.workThreadId,
      }, context);
      mark("provider_started", {
        providerStarted: true,
        replayState: "replay_unsafe",
        threadId: thread.thread?.id || packet.targetThreadId,
      });
      const turnAck = await this.controller.startTurn({
        sessionId: packet.targetThreadId,
        threadId: packet.targetThreadId,
        clientTurnRequestId: packet.clientTurnRequestId,
        promptText: packet.promptText,
        workThreadId: packet.workThreadId,
      }, context);
      const active = this.controller.activeRuns?.get(turnAck.turn?.id);
      if (active?.promise) await active.promise;
      const finalTurn = this.controller.sessionStore?.readTurn
        ? this.controller.sessionStore.readTurn(packet.targetThreadId, turnAck.turn?.id)
        : null;
      const terminalState = terminalStateForTurn(finalTurn || turnAck.turn || {});
      mark(terminalState, {
        providerCompleted: terminalState === "provider_completed",
        turnId: turnAck.turn?.id || "",
        terminalTurnState: normalizeString(finalTurn?.state || turnAck.turn?.state || turnAck.turn?.status, ""),
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
