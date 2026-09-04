"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { DirectLiveTextSurfaceSession } = require("../controller/live-text-controller");
const {
  HEADLESS_TURN_PACKET_SCHEMA,
  normalizeString,
  stableStringify,
} = require("./bridge-store");
const { reduceHeadlessTurnOutput } = require("./output-reducer");

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
const IMPLEMENTATION_TERMINAL_TURN_STATES = new Set([
  "completed",
  "failed",
  "aborted",
  "tool_call_blocked_text_only",
  "transport_handoff_unknown",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "empty_output_terminal",
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

function modelFromEvent(input = {}) {
  const direct = normalizeString(input.model || input.model_id || input.modelId, "");
  if (direct) return direct;
  const facts = isPlainObject(input.facts) ? input.facts : {};
  return normalizeString(facts.model || facts.model_id || facts.modelId, "");
}

function reasoningEffortFromEvent(input = {}) {
  const direct = normalizeString(input.reasoningEffort || input.reasoning_effort || input.effort, "");
  if (direct) return direct;
  const facts = isPlainObject(input.facts) ? input.facts : {};
  return normalizeString(facts.reasoningEffort || facts.reasoning_effort || facts.effort, "");
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
  const configuredAllowedMethods = configured.allowedMethods || configured.allowed_methods;
  return {
    schema: "headless_implementation_policy@1",
    toolAuthorityMode,
    autoDecisionMode: normalizeString(
      configured.autoDecisionMode ||
        configured.auto_decision_mode ||
        configured.autoDecision ||
        route.autoDecisionMode ||
        route.auto_decision_mode,
      "disabled",
    ),
    disposableWorkspace: configured.disposableWorkspace === true ||
      configured.disposable_workspace === true ||
      route.disposableWorkspace === true ||
      route.disposable_workspace === true,
    allowedMethods: Array.isArray(configuredAllowedMethods)
      ? configuredAllowedMethods
        .map((method) => normalizeString(method, ""))
        .filter((method) => IMPLEMENTATION_AUTO_APPROVE_METHODS.has(method))
      : [],
    maxAutoDecisions: Math.max(0, Number(configured.maxAutoDecisions ?? configured.max_auto_decisions ?? 0) || 0),
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
  if (state === "completed" && turn.settled !== false) return "provider_completed";
  if (state === "transport_handoff_unknown") return "handoff_unknown";
  if (IMPLEMENTATION_TERMINAL_TURN_STATES.has(state)) return "failed";
  return "failed";
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
    this.artifactRoot = normalizeString(options.artifactRoot, "");
    this.runtimeId = normalizeString(options.runtimeId, `headless_runtime_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);
    this.recoverPersistedPackets();
  }

  recoverPersistedPackets() {
    if (typeof this.store.listTurnPackets !== "function") return;
    const packets = this.store.listTurnPackets({ states: ["queued"] });
    for (const packet of packets) this.queuePacket(packet);
    for (const threadId of this.queueByThread.keys()) this.processNext(threadId);
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
    const model = modelFromEvent(body);
    const reasoningEffort = reasoningEffortFromEvent(body);
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
      model,
      reasoningEffort,
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
    const queue = this.queueByThread.get(threadId);
    if (!queue.includes(packet.packetId)) queue.push(packet.packetId);
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
    const claim = typeof this.store.claimTurnPacket === "function"
      ? this.store.claimTurnPacket(packet.packetId, { runtimeId: this.runtimeId })
      : { claimed: true, packet };
    if (!claim.claimed) return claim.packet || packet;
    packet = claim.packet || packet;
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
    const allowedMethods = new Set((Array.isArray(policy.allowedMethods) ? policy.allowedMethods : [])
      .filter((allowedMethod) => IMPLEMENTATION_AUTO_APPROVE_METHODS.has(allowedMethod)));
    const latestPacket = this.store.readTurnPacket(packet.packetId) || packet;
    const existingDecisions = Array.isArray(latestPacket.headlessImplementationDecisions)
      ? latestPacket.headlessImplementationDecisions
      : [];
    if (
      policy.autoDecisionMode !== "approve" ||
      policy.disposableWorkspace !== true ||
      !allowedMethods.has(method) ||
      existingDecisions.length >= Number(policy.maxAutoDecisions || 0)
    ) {
      const declineToken = normalizeString(request.params?.actionTokens?.decline, "");
      let responseSummary = "declined";
      try {
        const response = await surfaceSession.respond(request.key, {
          decision: "decline",
          clientToolDecisionId: `headless_decision_${shortDigest(`${packet.packetId}:${request.key}:decline`)}`,
          actionTokenId: declineToken,
        });
        responseSummary = normalizeString(response?.request?.responseSummary || response?.response?.decision, responseSummary);
      } catch (error) {
        responseSummary = normalizeString(error?.message, "decline_failed");
      }
      const latest = this.store.readTurnPacket(packet.packetId) || latestPacket;
      this.store.updateTurnPacket(packet.packetId, {
        headlessImplementationDecisions: [
          ...(Array.isArray(latest.headlessImplementationDecisions) ? latest.headlessImplementationDecisions : []),
          {
            requestKey: normalizeString(request.key, ""),
            method,
            decision: "decline",
            reason: "headless_auto_approval_not_available",
            responseSummary,
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
    const readTurn = () => this.controller.sessionStore?.readTurn
      ? this.controller.sessionStore.readTurn(sessionId, turnId)
      : null;
    const isSettled = (turn, { sessionClosed = false } = {}) => {
      const state = normalizeString(turn?.state || turn?.status, "");
      return (sessionClosed || !surfaceSession?.hasServerRequest?.()) && IMPLEMENTATION_TERMINAL_TURN_STATES.has(state);
    };
    while (Date.now() < deadline) {
      const turn = readTurn();
      if (isSettled(turn)) return { ...turn, settled: true };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const timeoutError = {
      code: "headless_implementation_settle_timeout",
      message: "Headless implementation turn did not settle before the bounded wait expired.",
    };
    const activeBeforeClose = this.controller.activeRuns?.get(turnId);
    const activePromise = activeBeforeClose?.promise || null;
    try {
      if (typeof this.controller.interruptTurn === "function") {
        const interruptResult = this.controller.interruptTurn({ sessionId, threadId: sessionId, turnId }, {});
        if (interruptResult?.then) Promise.resolve(interruptResult).catch(() => {});
      }
    } catch (_) {}
    if (activeBeforeClose?.abortController && !activeBeforeClose.abortController.signal.aborted) {
      try { activeBeforeClose.abortController.abort(timeoutError.message); } catch (_) {}
    }
    try {
      const disposeResult = surfaceSession?.dispose?.({ silent: true, reason: timeoutError.code });
      if (disposeResult?.then) Promise.resolve(disposeResult).catch(() => {});
    } catch (_) {}
    const turn = readTurn();
    const activeAfterClose = this.controller.activeRuns?.get(turnId);
    const observedActivePromise = activePromise || activeAfterClose?.promise || null;
    if (observedActivePromise || !isSettled(turn, { sessionClosed: true })) {
      return {
        ...(turn || { state: "cancellation_pending", status: "cancellation_pending" }),
        error: timeoutError,
        boundedWaitExpired: true,
        cancellationPending: true,
        cancellationSettled: false,
        settled: false,
        activePromise: observedActivePromise,
        surfaceSessionClosed: true,
      };
    }
    return {
      ...turn,
      error: turn.error || timeoutError,
      boundedWaitExpired: true,
      cancellationSettled: true,
      settled: true,
    };
  }

  async awaitImplementationCancellationSettled(surfaceSession, sessionId = "", turnId = "", pending = {}) {
    const readTurn = () => this.controller.sessionStore?.readTurn
      ? this.controller.sessionStore.readTurn(sessionId, turnId)
      : null;
    let activePromise = pending.activePromise || this.controller.activeRuns?.get(turnId)?.promise;
    if (activePromise) await Promise.resolve(activePromise).catch(() => {});
    while (true) {
      const active = this.controller.activeRuns?.get(turnId);
      if (active?.promise && active.promise !== activePromise) {
        activePromise = active.promise;
        await Promise.resolve(activePromise).catch(() => {});
        continue;
      }
      const turn = readTurn();
      if ((pending.surfaceSessionClosed === true || !surfaceSession?.hasServerRequest?.()) &&
          IMPLEMENTATION_TERMINAL_TURN_STATES.has(normalizeString(turn?.state || turn?.status, ""))) {
        return {
          ...turn,
          error: turn.error || pending.error,
          boundedWaitExpired: true,
          cancellationSettled: true,
          settled: true,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async runPacket(packet = {}) {
    const packetId = normalizeString(packet.packetId, "");
    const mark = (state, patch = {}) => {
      const current = this.store.readTurnPacket(packetId) || packet;
      const claim = isPlainObject(current.executionClaim) ? current.executionClaim : null;
      const claimPatch = claim && TERMINAL_PACKET_STATES.has(state) && claim.status === "in_progress"
        ? {
          executionClaim: {
            ...claim,
            status: "settled",
            settledAt: nowIso(),
            updatedAt: nowIso(),
          },
        }
        : {};
      return this.store.updateTurnPacket(packetId, {
        ...patch,
        ...claimPatch,
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
        model: normalizeString(packet.model, ""),
        reasoningEffort: normalizeString(packet.reasoningEffort, ""),
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
        model: normalizeString(packet.model, ""),
        reasoningEffort: normalizeString(packet.reasoningEffort, ""),
        workThreadId: packet.workThreadId,
      };
      const turnAck = implementationRuntime
        ? await surfaceSession.request("turn/start", startTurnParams)
        : await this.controller.startTurn(startTurnParams, context);
      const active = this.controller.activeRuns?.get(turnAck?.turn?.id);
      let finalTurn = implementationRuntime
        ? await this.waitForImplementationSettled(surfaceSession, packet.targetThreadId, turnAck?.turn?.id)
        : (active?.promise ? await active.promise : null);
      if (implementationRuntime && finalTurn?.cancellationPending && finalTurn.settled !== true) {
        mark("cancellation_pending", {
          providerCompleted: false,
          replayState: "replay_unsafe",
          turnId: turnAck?.turn?.id || "",
          terminalTurnState: normalizeString(finalTurn.state || finalTurn.status, ""),
          blockerCode: "headless_implementation_settle_timeout",
          boundedWaitExpired: true,
          cancellationRequested: true,
          cancellationSettled: false,
          error: isPlainObject(finalTurn.error) ? finalTurn.error : null,
        });
        finalTurn = await this.awaitImplementationCancellationSettled(
          surfaceSession,
          packet.targetThreadId,
          turnAck?.turn?.id,
          finalTurn,
        );
      }
      const settledTurn = this.controller.sessionStore?.readTurn
        ? this.controller.sessionStore.readTurn(packet.targetThreadId, turnAck?.turn?.id)
        : null;
      const terminalState = terminalStateForTurn(settledTurn || finalTurn || turnAck?.turn || {});
      const terminalPacket = mark(terminalState, {
        providerCompleted: terminalState === "provider_completed",
        turnId: turnAck?.turn?.id || "",
        terminalTurnState: normalizeString(settledTurn?.state || finalTurn?.state || turnAck?.turn?.state || turnAck?.turn?.status, ""),
        error: isPlainObject(settledTurn?.error || finalTurn?.error) ? (settledTurn?.error || finalTurn?.error) : null,
        ...(finalTurn?.boundedWaitExpired ? {
          blockerCode: "headless_implementation_settle_timeout",
          boundedWaitExpired: true,
          cancellationSettled: finalTurn.cancellationSettled === true,
        } : {}),
      });
      if (terminalState === "provider_completed") {
        const reduction = reduceHeadlessTurnOutput({
          store: this.store,
          controller: this.controller,
          packet: terminalPacket || this.store.readTurnPacket(packetId) || packet,
          route: route || {},
          artifactRoot: this.artifactRoot,
        });
        if (reduction) {
          mark(terminalState, {
            outputReduction: {
              reducedResultId: reduction.reducedResult?.resultId || "",
              reductionStatus: reduction.reducedResult?.reductionStatus || "",
              reducerMode: reduction.reducedResult?.reducerMode || "",
              writeArtifactActionId: reduction.artifacts?.writeArtifact?.action?.actionId || "",
              humanDecisionId: reduction.artifacts?.humanDecision?.decisionId || "",
              rawOutputIncluded: false,
              rawProviderPayloadIncluded: false,
              rawPathIncluded: false,
            },
          });
        }
      }
    } catch (error) {
      const code = normalizeString(error?.code, "");
      mark(code === "active_turn_exists" ? "queued" : "failed", {
        reason: code || "headless_direct_text_failed",
        error: safeError(error),
        replayState: "replay_unsafe",
        ...(code === "active_turn_exists" ? {
          executionClaim: {
            ...(isPlainObject((this.store.readTurnPacket(packetId) || packet).executionClaim)
              ? (this.store.readTurnPacket(packetId) || packet).executionClaim
              : {}),
            status: "retry_pending",
            releasedAt: nowIso(),
            updatedAt: nowIso(),
          },
        } : {}),
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
