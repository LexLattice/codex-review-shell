"use strict";

const crypto = require("node:crypto");
const {
  createDirectProviderBackedSubAgentRoute,
} = require("../agents/provider-backed-route");
const {
  normalizeString,
  stableStringify,
} = require("./bridge-store");

const HEADLESS_AFFORDANCE_COMMAND_SCHEMA = "headless_affordance_command@1";
const HEADLESS_AFFORDANCE_RESULT_SCHEMA = "headless_affordance_command_result@1";

const COMMAND_KINDS = new Set([
  "read_bridge_status",
  "submit_text_turn",
  "queue_text_turn",
  "submit_implementation_turn",
  "queue_implementation_turn",
  "spawn_provider_backed_sub_agent",
  "steer_text_turn",
  "stop_active_turn",
  "pause_intake",
  "resume_intake",
  "drain",
  "shutdown",
  "read_event",
  "read_turn_packet",
  "read_reduced_result",
  "read_outbox_action",
  "read_human_decision",
]);
const TEXT_TURN_COMMAND_KINDS = new Set(["submit_text_turn", "queue_text_turn"]);
const IMPLEMENTATION_TURN_COMMAND_KINDS = new Set(["submit_implementation_turn", "queue_implementation_turn"]);
const FAILED_TURN_PACKET_STATES = new Set(["failed"]);
const RAW_RESULT_KEYS = [
  "promptText",
  "rawPrompt",
  "rawPromptText",
  "rawPayload",
  "rawEventPayload",
  "rawProviderPayload",
  "rawProviderFrame",
  "rawToolOutput",
];
const providerBackedSubAgentRoutesByDaemon = new WeakMap();

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function shortDigest(value) {
  return sha256(value).slice(7, 31);
}

function nowIso(nowMs = Date.now()) {
  const timestamp = nowMs !== undefined && nowMs !== null ? Number(nowMs) : Date.now();
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
}

function evidenceRef(kind, label, extra = {}) {
  return {
    kind,
    rendererSafeLabel: label,
    ...extra,
  };
}

function sanitizeTurnPacket(packet = {}) {
  if (!isPlainObject(packet)) return null;
  const sanitized = { ...packet };
  for (const key of RAW_RESULT_KEYS) delete sanitized[key];
  sanitized.rawEventPayloadIncluded = false;
  sanitized.rawPromptIncluded = false;
  sanitized.rawProviderPayloadIncluded = false;
  sanitized.rawProviderFrameIncluded = false;
  return sanitized;
}

function sanitizeBridgeResult(result = {}) {
  if (!isPlainObject(result)) return result;
  const sanitized = { ...result };
  if (isPlainObject(sanitized.turnPacket)) sanitized.turnPacket = sanitizeTurnPacket(sanitized.turnPacket);
  if (isPlainObject(sanitized.packet)) sanitized.packet = sanitizeTurnPacket(sanitized.packet);
  for (const key of RAW_RESULT_KEYS) delete sanitized[key];
  sanitized.rawPayloadIncluded = false;
  sanitized.rawPromptIncluded = false;
  sanitized.rawProviderPayloadIncluded = false;
  sanitized.rawProviderFrameIncluded = false;
  return sanitized;
}

function normalizeCommand(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const commandKind = normalizeString(source.commandKind || source.command_kind || source.action || source.affordance, "");
  const text = normalizeString(source.text || source.promptText || source.prompt_text || source.message, "");
  const idempotencyKey = normalizeString(source.idempotencyKey || source.idempotency_key, "");
  const createdAt = normalizeString(source.createdAt || source.created_at, nowIso(options.nowMs));
  const fallbackIdentity = idempotencyKey
    ? stableStringify({
      commandKind,
      clientId: source.clientId || source.client_id || options.clientId || "",
      idempotencyKey,
      textDigest: text ? sha256(text) : "",
    })
    : `${createdAt}:${crypto.randomUUID()}`;
  const commandId = normalizeString(
    source.commandId || source.command_id,
    `headless_affordance_cmd_${shortDigest(fallbackIdentity)}`,
  );
  const target = isPlainObject(source.target) ? source.target : {};
  return {
    schema: HEADLESS_AFFORDANCE_COMMAND_SCHEMA,
    commandId,
    commandKind,
    clientId: normalizeString(source.clientId || source.client_id || options.clientId, ""),
    idempotencyKey,
    requestedRouteId: normalizeString(source.requestedRouteId || source.requested_route_id || source.routeId || source.route_id, ""),
    routeVersion: normalizeString(source.routeVersion || source.route_version, ""),
    workThreadId: normalizeString(source.workThreadId || source.work_thread_id || source.declaredWorkThreadId || source.declared_work_thread_id, ""),
    text,
    model: normalizeString(source.model || source.modelId || source.model_id, ""),
    reasoningEffort: normalizeString(source.reasoningEffort || source.reasoning_effort || source.effort, ""),
    childAgentId: normalizeString(source.childAgentId || source.child_agent_id || target.childAgentId || target.child_agent_id, ""),
    displayLabel: normalizeString(source.displayLabel || source.display_label || source.nickname || target.displayLabel || target.display_label, ""),
    role: normalizeString(source.role || source.agentRole || source.agent_role || target.role, ""),
    noInterferencePolicy: normalizeString(source.noInterferencePolicy || source.no_interference_policy || source.selfBindingPolicy || source.self_binding_policy, ""),
    instructions: normalizeString(source.instructions || source.systemInstructions || source.system_instructions, ""),
    eventSchema: normalizeString(source.eventSchema || source.event_schema, "headless_text_event@1"),
    eventClass: normalizeString(source.eventClass || source.event_class, "operator_affordance"),
    eventKind: normalizeString(source.eventKind || source.event_kind, commandKind || "unknown"),
    sourceSystem: normalizeString(source.sourceSystem || source.source_system, "headless_affordance_command_surface"),
    factSourcePosture: normalizeString(source.factSourcePosture || source.fact_source_posture, "operator_declared"),
    target: {
      envelopeId: normalizeString(target.envelopeId || target.envelope_id || source.envelopeId || source.envelope_id, ""),
      packetId: normalizeString(target.packetId || target.packet_id || source.packetId || source.packet_id, ""),
      resultId: normalizeString(target.resultId || target.result_id || source.resultId || source.result_id, ""),
      actionId: normalizeString(target.actionId || target.action_id || source.actionId || source.action_id, ""),
      decisionId: normalizeString(target.decisionId || target.decision_id || source.decisionId || source.decision_id, ""),
      threadId: normalizeString(target.threadId || target.thread_id || source.threadId || source.thread_id, ""),
    },
    evidenceRefs: [
      evidenceRef("headless_affordance_command", "Headless affordance command received", {
        artifactId: commandId,
      }),
      ...(Array.isArray(source.evidenceRefs) ? source.evidenceRefs : []),
    ],
    createdAt,
    rawPayloadIncluded: false,
  };
}

function commandResult(command = {}, patch = {}) {
  const status = normalizeString(patch.status, "completed");
  const blockerCode = normalizeString(patch.blockerCode || patch.error, "");
  return {
    schema: HEADLESS_AFFORDANCE_RESULT_SCHEMA,
    commandId: normalizeString(command.commandId, ""),
    commandKind: normalizeString(command.commandKind, ""),
    status,
    blockerCode,
    authorityDecision: {
      schema: "headless_affordance_authority_decision@1",
      status: status === "blocked" || status === "failed" ? "blocked" : "allowed",
      blockerCode,
      providerRequestStarted: patch.providerRequestStarted === true,
      routeAuthorityMutable: false,
      rawPayloadIncluded: false,
    },
    evidenceRefs: [
      ...(Array.isArray(command.evidenceRefs) ? command.evidenceRefs : []),
      ...(Array.isArray(patch.evidenceRefs) ? patch.evidenceRefs : []),
    ],
    observedAt: normalizeString(patch.observedAt, nowIso()),
    providerRequestStarted: patch.providerRequestStarted === true,
    routeAuthorityMutable: false,
    ...patch,
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawProviderFrameIncluded: false,
  };
}

function eventBodyForTextCommand(command = {}) {
  return {
    clientId: command.clientId,
    idempotencyKey: command.idempotencyKey || command.commandId,
    eventSchema: command.eventSchema,
    eventClass: command.eventClass,
    eventKind: command.eventKind,
    sourceSystem: command.sourceSystem,
    factSourcePosture: command.factSourcePosture,
    requestedRouteId: command.requestedRouteId,
    routeVersion: command.routeVersion,
    declaredWorkThreadId: command.workThreadId,
    promptText: command.text,
    model: command.model,
    reasoningEffort: command.reasoningEffort,
    facts: {
      affordanceCommandId: command.commandId,
      affordanceIntent: command.commandKind,
      textDigest: command.text ? sha256(command.text) : "",
      textChars: command.text.length,
      model: command.model,
      reasoningEffort: command.reasoningEffort,
      implementationRequested: IMPLEMENTATION_TURN_COMMAND_KINDS.has(command.commandKind),
    },
    evidenceRefs: command.evidenceRefs,
    rawPayloadIncluded: false,
  };
}

function routeRuntimePath(route = {}) {
  const ref = isPlainObject(route.targetThreadRef) ? route.targetThreadRef : {};
  return normalizeString(ref.runtimePath || ref.runtime_path, "direct-text");
}

function validateImplementationCommandRoute(daemon, command = {}, eventBody = {}) {
  const validation = daemon?.store?.validateIngress?.(eventBody);
  if (!validation?.ok) {
    const auditResult = sanitizeBridgeResult(daemon?.store?.submitEvent?.(eventBody));
    const error = normalizeString(auditResult?.error || validation?.errorCode, "route_validation_blocked");
    return commandResult(command, {
      status: "blocked",
      error,
      blockerCode: error,
      providerRequestStarted: false,
      result: auditResult,
      evidenceRefs: [evidenceRef("bridge_ingress", "Implementation command rejected by shared bridge ingress validation")],
    });
  }
  const runtimePath = routeRuntimePath(validation.route);
  if (runtimePath !== "direct-implementation") {
    const auditResult = sanitizeBridgeResult(daemon?.store?.submitEvent?.(eventBody));
    return commandResult(command, {
      status: "blocked",
      error: "implementation_command_requires_direct_implementation_route",
      blockerCode: "implementation_command_requires_direct_implementation_route",
      providerRequestStarted: false,
      result: {
        audit: auditResult,
        routeId: validation.route?.routeId || command.requestedRouteId,
        routeVersion: validation.route?.routeVersion || command.routeVersion,
        runtimePath,
        rawPayloadIncluded: false,
      },
      evidenceRefs: [evidenceRef("headless_route_policy", "Implementation command rejected for non-implementation route")],
    });
  }
  return null;
}

function validateAffordanceRoute(daemon, command = {}) {
  const eventBody = eventBodyForTextCommand(command);
  const validation = daemon?.store?.validateIngress?.(eventBody);
  if (!validation?.ok) {
    const error = normalizeString(validation?.errorCode, "route_validation_blocked");
    return {
      ok: false,
      result: commandResult(command, {
        status: "blocked",
        error,
        blockerCode: error,
        providerRequestStarted: false,
        result: sanitizeBridgeResult({
          status: validation?.lifecycle || "route_blocked",
          routeId: validation?.requestedRouteId || command.requestedRouteId,
          routeVersion: validation?.routeVersion || command.routeVersion,
          workThreadId: validation?.workThreadId || command.workThreadId,
          rawPayloadIncluded: false,
        }),
        evidenceRefs: [evidenceRef("bridge_ingress", "Affordance command rejected by shared bridge ingress validation")],
      }),
    };
  }
  return { ok: true, validation, eventBody };
}

function validateDaemonIngressGate(daemon, command = {}) {
  if (daemon?.draining) {
    return commandResult(command, {
      status: "blocked",
      error: "daemon_draining",
      blockerCode: "daemon_draining",
      providerRequestStarted: false,
      evidenceRefs: [evidenceRef("headless_daemon_control", "Provider-backed sub-agent command blocked while daemon is draining")],
    });
  }
  if (daemon?.intakePaused) {
    return commandResult(command, {
      status: "blocked",
      error: "intake_paused",
      blockerCode: "intake_paused",
      providerRequestStarted: false,
      evidenceRefs: [evidenceRef("headless_daemon_control", "Provider-backed sub-agent command blocked while intake is paused")],
    });
  }
  if (Number.isFinite(Number(daemon?.maxInboxEvents))
    && typeof daemon?.store?.count === "function"
    && (daemon.store.count("direct_bridge_inbox_events") + (typeof daemon.store.providerAffordanceIngressCount === "function" ? daemon.store.providerAffordanceIngressCount() : 0)) >= Number(daemon.maxInboxEvents)) {
    return commandResult(command, {
      status: "blocked",
      error: "queue_full",
      blockerCode: "queue_full",
      providerRequestStarted: false,
      evidenceRefs: [evidenceRef("headless_daemon_control", "Provider-backed sub-agent command blocked by daemon queue capacity")],
    });
  }
  return null;
}

function providerBackedSubAgentRunnerFor(daemon) {
  if (typeof daemon?.providerBackedSubAgentRunner === "function") return daemon.providerBackedSubAgentRunner.bind(daemon);
  if (typeof daemon?.providerTurnRunner === "function") return daemon.providerTurnRunner.bind(daemon);
  if (typeof daemon?.turnRuntime?.runProviderBackedSubAgent === "function") {
    return daemon.turnRuntime.runProviderBackedSubAgent.bind(daemon.turnRuntime);
  }
  return null;
}

function providerBackedSubAgentRouteFor(daemon, validation = {}) {
  const route = validation.route || {};
  const routeKey = stableStringify({
    routeId: route.routeId || validation.requestedRouteId || "",
    routeVersion: route.routeVersion || validation.routeVersion || "",
    workThreadId: validation.workThreadId || "",
    targetThreadId: validation.targetThreadId || "",
  });
  let routes = providerBackedSubAgentRoutesByDaemon.get(daemon);
  if (!routes) {
    routes = new Map();
    providerBackedSubAgentRoutesByDaemon.set(daemon, routes);
  }
  if (!routes.has(routeKey)) {
    routes.set(routeKey, createDirectProviderBackedSubAgentRoute({
      projectId: route.projectId || validation.projectId || "project_headless_provider_backed_sub_agent",
      workThreadId: validation.workThreadId,
      primaryThreadId: validation.targetThreadId,
      routeId: `headless_${route.routeId || "provider_backed_sub_agent_route"}`,
      defaultModel: route.defaultModel || route.model || route.modelPolicyRef,
      defaultReasoningEffort: route.defaultReasoningEffort || route.reasoningEffort,
      providerTurnRunner: providerBackedSubAgentRunnerFor(daemon),
    }));
  }
  return routes.get(routeKey);
}

function providerAffordanceClaimInput(command = {}, validation = {}) {
  const route = validation.route || {};
  const identity = {
    clientId: command.clientId,
    routeId: route.routeId || validation.requestedRouteId || "",
    routeVersion: route.routeVersion || validation.routeVersion || "",
    routeDigest: route.routeDigest || "",
    idempotencyKey: command.idempotencyKey || command.commandId,
  };
  const input = {
    ...identity,
    commandKind: command.commandKind,
    childAgentId: command.childAgentId,
    promptDigest: command.text ? sha256(command.text) : "",
    model: command.model,
    reasoningEffort: command.reasoningEffort,
    instructionsDigest: command.instructions ? sha256(command.instructions) : "",
    displayLabel: command.displayLabel,
    role: command.role,
    noInterferencePolicy: command.noInterferencePolicy,
  };
  return {
    claimId: sha256(`headless-provider-affordance-identity:${stableStringify(identity)}`),
    inputDigest: sha256(`headless-provider-affordance-input:${stableStringify(input)}`),
    ...identity,
  };
}

function submitOutcome(result = null) {
  if (!isPlainObject(result)) {
    return {
      status: "blocked",
      error: "submit_result_unavailable",
      blockerCode: "submit_result_unavailable",
      providerRequestStarted: false,
    };
  }
  if (!result.ok) {
    const error = normalizeString(result.error, "submit_blocked");
    return {
      status: "blocked",
      error,
      blockerCode: error,
      providerRequestStarted: Boolean(result.turnPacket?.providerStarted),
    };
  }
  const packet = isPlainObject(result.turnPacket) ? result.turnPacket : {};
  const packetState = normalizeString(packet.state, "");
  const packetBlocker = normalizeString(packet.blockerCode || packet.error?.code || packet.reason, "");
  if (FAILED_TURN_PACKET_STATES.has(packetState) || packetBlocker) {
    return {
      status: "blocked",
      error: packetBlocker || "turn_packet_failed",
      blockerCode: packetBlocker || "turn_packet_failed",
      providerRequestStarted: Boolean(packet.providerStarted),
    };
  }
  return {
    status: "accepted",
    error: "",
    blockerCode: "",
    providerRequestStarted: Boolean(packet.providerStarted),
  };
}

function providerAffordanceReplayResult(command, claim) {
  if (claim.conflict) {
    return commandResult(command, {
      status: "blocked",
      error: "provider_affordance_idempotency_conflict",
      blockerCode: "provider_affordance_idempotency_conflict",
      result: { claimId: claim.claimId, replayed: true, conflict: true, rawPayloadIncluded: false },
    });
  }
  if (!claim.replay) return null;
  if (claim.result) {
    const replayedResult = sanitizeBridgeResult(claim.result);
    return commandResult(command, {
      status: replayedResult.status || "completed",
      error: replayedResult.blockerCode || replayedResult.error || "",
      blockerCode: replayedResult.blockerCode || replayedResult.error || "",
      providerRequestStarted: replayedResult.providerRequestStarted === true,
      result: replayedResult,
      replayed: true,
      evidenceRefs: [evidenceRef("provider_backed_sub_agent_replay", "Durable provider-backed affordance result replay")],
    });
  }
  return commandResult(command, {
    status: "accepted",
    providerRequestStarted: false,
    result: { schema: "headless_provider_affordance_in_progress@1", claimId: claim.claimId, status: "in_progress", replayed: true, rawPayloadIncluded: false },
    evidenceRefs: [evidenceRef("provider_backed_sub_agent_replay", "Durable provider-backed affordance is already in progress")],
  });
}

async function executeHeadlessAffordanceCommand({ daemon, command: input } = {}) {
  if (!daemon) throw new Error("headless_affordance_missing_daemon");
  const command = normalizeCommand(input);
  if (!COMMAND_KINDS.has(command.commandKind)) {
    return commandResult(command, {
      status: "blocked",
      error: "unsupported_affordance_command",
      blockerCode: "unsupported_affordance_command",
      result: null,
    });
  }

  if (command.commandKind === "read_bridge_status") {
    return commandResult(command, {
      status: "completed",
      result: daemon.statusProjection(),
      evidenceRefs: [evidenceRef("bridge_status", "Headless bridge status projection")],
    });
  }

  if (TEXT_TURN_COMMAND_KINDS.has(command.commandKind) || IMPLEMENTATION_TURN_COMMAND_KINDS.has(command.commandKind)) {
    if (!command.text) {
      return commandResult(command, {
        status: "blocked",
        error: "missing_text",
        blockerCode: "missing_text",
      });
    }
    const eventBody = eventBodyForTextCommand(command);
    if (IMPLEMENTATION_TURN_COMMAND_KINDS.has(command.commandKind)) {
      const routeBlock = validateImplementationCommandRoute(daemon, command, eventBody);
      if (routeBlock) return routeBlock;
    }
    const result = sanitizeBridgeResult(daemon.submitEvent(eventBody));
    const outcome = submitOutcome(result);
    return commandResult(command, {
      status: outcome.status,
      error: outcome.error,
      blockerCode: outcome.blockerCode,
      providerRequestStarted: outcome.providerRequestStarted,
      result,
      evidenceRefs: [evidenceRef("bridge_event", "Affordance command submitted through bridge event ingress")],
    });
  }

  if (command.commandKind === "spawn_provider_backed_sub_agent") {
    if (!command.text) {
      return commandResult(command, {
        status: "blocked",
        error: "missing_text",
        blockerCode: "missing_text",
      });
    }
    if (!command.childAgentId) {
      return commandResult(command, {
        status: "blocked",
        error: "missing_child_agent_id",
        blockerCode: "missing_child_agent_id",
      });
    }
    const validation = validateAffordanceRoute(daemon, command);
    if (!validation.ok) return validation.result;
    const claimInput = providerAffordanceClaimInput(command, validation.validation);
    const existingClaim = daemon.store?.readProviderAffordance?.(claimInput);
    const existingResult = existingClaim ? providerAffordanceReplayResult(command, existingClaim) : null;
    if (existingResult) return existingResult;
    const daemonGate = validateDaemonIngressGate(daemon, command);
    if (daemonGate) return daemonGate;
    const claim = daemon.store?.claimProviderAffordance?.(claimInput);
    if (!claim) {
      return commandResult(command, {
        status: "blocked",
        error: "provider_affordance_claim_unavailable",
        blockerCode: "provider_affordance_claim_unavailable",
      });
    }
    const claimedReplayResult = providerAffordanceReplayResult(command, claim);
    if (claimedReplayResult) return claimedReplayResult;
    const route = providerBackedSubAgentRouteFor(daemon, validation.validation);
    let result;
    try {
      result = sanitizeBridgeResult(await route.spawnAndRun({
        childAgentId: command.childAgentId,
        displayLabel: command.displayLabel,
        role: command.role,
        noInterferencePolicy: command.noInterferencePolicy,
        prompt: command.text,
        model: command.model,
        reasoningEffort: command.reasoningEffort,
        instructions: command.instructions,
      }));
    } catch (error) {
      result = sanitizeBridgeResult({ status: "failed", blockerCode: normalizeString(error?.code, "provider_affordance_failed"), providerRequestStarted: false });
    }
    daemon.store.completeProviderAffordance(claim.claimId, {
      status: normalizeString(result.status, "failed"),
      result,
    });
    return commandResult(command, {
      status: result.status,
      error: result.blockerCode,
      blockerCode: result.blockerCode,
      providerRequestStarted: result.providerRequestStarted === true,
      result,
      evidenceRefs: [evidenceRef("provider_backed_sub_agent_route", "Provider-backed sub-agent command executed through direct route")],
    });
  }

  if (command.commandKind === "steer_text_turn") {
    return commandResult(command, {
      status: "blocked",
      error: "steer_not_supported_by_headless_runtime",
      blockerCode: "steer_not_supported_by_headless_runtime",
      evidenceRefs: [evidenceRef("headless_runtime_capability", "Current headless runtime does not expose steer semantics")],
    });
  }

  if (command.commandKind === "stop_active_turn") {
    if (typeof daemon.turnRuntime?.stopActiveTurn === "function") {
      const result = sanitizeBridgeResult(daemon.turnRuntime.stopActiveTurn({
        threadId: command.target.threadId,
        workThreadId: command.workThreadId,
        commandId: command.commandId,
      }));
      return commandResult(command, {
        status: result?.ok ? "completed" : "blocked",
        error: result?.ok ? "" : normalizeString(result?.error, "stop_blocked"),
        blockerCode: result?.ok ? "" : normalizeString(result?.error, "stop_blocked"),
        result,
      });
    }
    return commandResult(command, {
      status: "blocked",
      error: "stop_not_supported_by_headless_runtime",
      blockerCode: "stop_not_supported_by_headless_runtime",
      evidenceRefs: [evidenceRef("headless_runtime_capability", "Current headless runtime does not expose stop semantics")],
    });
  }

  if (["pause_intake", "resume_intake", "drain", "shutdown"].includes(command.commandKind)) {
    const result = sanitizeBridgeResult(daemon.controlDaemon({
      clientId: command.clientId,
      action: command.commandKind,
    }));
    return commandResult(command, {
      status: result?.ok ? "completed" : "blocked",
      error: result?.ok ? "" : normalizeString(result?.error, "control_blocked"),
      blockerCode: result?.ok ? "" : normalizeString(result?.error, "control_blocked"),
      result,
      evidenceRefs: [evidenceRef("headless_daemon_control", "Affordance command applied through daemon control surface")],
    });
  }

  if (command.commandKind === "read_event") {
    const event = daemon.readEvent(command.target.envelopeId);
    return commandResult(command, {
      status: event ? "completed" : "blocked",
      error: event ? "" : "event_not_found",
      blockerCode: event ? "" : "event_not_found",
      result: event,
    });
  }

  if (command.commandKind === "read_turn_packet") {
    const packet = daemon.store.readTurnPacket(command.target.packetId);
    return commandResult(command, {
      status: packet ? "completed" : "blocked",
      error: packet ? "" : "turn_packet_not_found",
      blockerCode: packet ? "" : "turn_packet_not_found",
      result: sanitizeTurnPacket(packet),
    });
  }

  if (command.commandKind === "read_reduced_result") {
    const result = daemon.store.readReducedResult(command.target.resultId);
    return commandResult(command, {
      status: result ? "completed" : "blocked",
      error: result ? "" : "reduced_result_not_found",
      blockerCode: result ? "" : "reduced_result_not_found",
      result: sanitizeBridgeResult(result),
    });
  }

  if (command.commandKind === "read_outbox_action") {
    const action = daemon.store.readOutboxAction(command.target.actionId);
    return commandResult(command, {
      status: action ? "completed" : "blocked",
      error: action ? "" : "outbox_action_not_found",
      blockerCode: action ? "" : "outbox_action_not_found",
      result: sanitizeBridgeResult(action),
    });
  }

  if (command.commandKind === "read_human_decision") {
    const decision = daemon.store.readHumanDecisionPacket(command.target.decisionId);
    return commandResult(command, {
      status: decision ? "completed" : "blocked",
      error: decision ? "" : "human_decision_not_found",
      blockerCode: decision ? "" : "human_decision_not_found",
      result: sanitizeBridgeResult(decision),
    });
  }

  return commandResult(command, {
    status: "blocked",
    error: "unhandled_affordance_command",
    blockerCode: "unhandled_affordance_command",
  });
}

module.exports = {
  COMMAND_KINDS,
  HEADLESS_AFFORDANCE_COMMAND_SCHEMA,
  HEADLESS_AFFORDANCE_RESULT_SCHEMA,
  executeHeadlessAffordanceCommand,
  normalizeCommand,
  providerAffordanceClaimInput,
  sanitizeBridgeResult,
  sanitizeTurnPacket,
};
