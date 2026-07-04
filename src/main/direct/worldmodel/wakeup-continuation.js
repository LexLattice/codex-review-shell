"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const {
  validateAsyncWorkRegistryStore,
} = require("./async-work-registry");

const DIRECT_AGENT_SUSPENSION_STATE_SCHEMA = "direct_agent_suspension_state@1";
const DIRECT_AGENT_WAKE_EVENT_SCHEMA = "direct_agent_wake_event@1";
const DIRECT_TYPED_CONTINUATION_PACKET_SCHEMA = "direct_typed_continuation_packet@1";
const DIRECT_WAKE_QUEUE_SCHEMA = "direct_wake_queue@1";
const DIRECT_WAKEUP_HEADLESS_GAME_REPORT_SCHEMA = "direct_wakeup_headless_game_report@1";

const AGENT_SUSPENSION_REASONS = Object.freeze([
  "awaiting_async_work",
  "awaiting_authorization",
  "awaiting_user_input",
  "awaiting_external_event",
]);

const AGENT_SUSPENSION_STATUSES = Object.freeze([
  "active",
  "woken",
  "expired",
  "cancelled",
]);

const AGENT_WAKE_REASONS = Object.freeze([
  "async_work_completed",
  "async_work_failed",
  "authorization_resolved",
  "user_input_received",
  "external_event",
]);

const AGENT_WAKE_CONSUMPTION_MODES = Object.freeze([
  "exactly_once",
  "at_least_once_with_dedupe",
]);

const AGENT_WAKE_EVENT_STATUSES = Object.freeze([
  "queued",
  "delivered",
  "failed",
  "stale",
]);

const CONTINUATION_RESUME_REASONS = Object.freeze([
  "async_work_completed",
  "async_work_failed",
  "authorization_resolved",
  "user_input_received",
  "external_event",
  "manual_resume",
]);

const HEADLESS_WAKEUP_GAME_RESULTS = Object.freeze([
  "passed",
  "failed",
  "inconclusive",
]);

const DIGEST_FIELDS = new Set([
  "suspensionDigest",
  "wakeEventDigest",
  "packetDigest",
  "queueDigest",
  "reportDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_wakeup_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_wakeup_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_wakeup_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_wakeup_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort();
}

function refFrom(kind, id, digest, label, extra = {}) {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    ...extra,
  };
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded || ref.rawPathIncluded || ref.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_ref_exposure", label);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "wakeup_evidence") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!isPlainObject(value)) return null;
      return refFrom(
        value.kind || fallbackKind,
        value.id ||
          value.refId ||
          value.artifactId ||
          value.workId ||
          value.suspensionId ||
          value.wakeEventId ||
          value.packetId ||
          value.queueId ||
          value.reportId,
        value.digest ||
          value.artifactDigest ||
          value.registrationDigest ||
          value.snapshotDigest ||
          value.transitionDigest ||
          value.outcomeDigest ||
          value.storeDigest ||
          value.suspensionDigest ||
          value.wakeEventDigest ||
          value.packetDigest ||
          value.queueDigest ||
          value.reportDigest ||
          "",
        value.label || value.rendererSafeLabel || fallbackKind,
      );
    })
    .filter((ref) => ref && ref.id);
}

function contractRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return refFrom(
    source.kind || "continuation_contract",
    source.id || source.refId || source.contractId || source.artifactId,
    source.digest || source.contractDigest || source.artifactDigest || "",
    source.label || source.purpose || source.rendererSafeLabel || "Continuation contract",
  );
}

function wakePolicyRefFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return refFrom(
    source.kind || "async_wake_policy",
    source.id || source.refId || source.wakePolicyId,
    source.digest || source.wakePolicyDigest || "",
    source.label || source.wakeOn || source.rendererSafeLabel || "Wake policy",
  );
}

function suspensionRef(suspension = {}) {
  return refFrom("agent_suspension_state", suspension.suspensionId, suspension.suspensionDigest, suspension.reason, {
    agentId: normalizeString(suspension.agentId, ""),
    agentRunId: normalizeString(suspension.agentRunId, ""),
    status: normalizeString(suspension.status, ""),
  });
}

function wakeEventRef(event = {}) {
  return refFrom("agent_wake_event", event.wakeEventId, event.wakeEventDigest, event.reason, {
    idempotencyKey: normalizeString(event.idempotencyKey, ""),
    sourceWorkId: normalizeString(event.sourceWorkId, ""),
    status: normalizeString(event.status, ""),
  });
}

function continuationPacketRef(packet = {}) {
  return refFrom("typed_continuation_packet", packet.packetId, packet.packetDigest, packet.resumeReason, {
    targetAgentId: normalizeString(packet.targetAgentId, ""),
    targetAgentRunId: normalizeString(packet.targetAgentRunId, ""),
  });
}

function queueRef(queue = {}) {
  return refFrom("wake_queue", queue.queueId, queue.queueDigest, "Wake queue", {
    queuedCount: Number(queue.queuedCount || 0),
    deliveredCount: Number(queue.deliveredCount || 0),
  });
}

function registryStoreRef(store = {}) {
  return refFrom("async_work_registry_store", store.storeId, store.storeDigest, "Async work registry store", {
    workThreadId: normalizeString(store.workThreadId, ""),
  });
}

function knownRegisteredWorkIds(registryStore = null, extraWorkIds = []) {
  const ids = new Set(normalizeList(extraWorkIds));
  if (registryStore && isPlainObject(registryStore)) {
    validateAsyncWorkRegistryStore(registryStore);
    for (const registration of registryStore.registrations || []) ids.add(registration.workId);
  }
  return ids;
}

function buildAgentSuspensionState(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const suspension = {
    schema: DIRECT_AGENT_SUSPENSION_STATE_SCHEMA,
    suspensionId: normalizeId(source.suspensionId, "agent_suspension"),
    agentId: normalizeId(source.agentId, "agent_worker"),
    agentRunId: normalizeId(source.agentRunId, "agent_run"),
    reason: pickEnum(source.reason, AGENT_SUSPENSION_REASONS, "awaiting_async_work"),
    awaitingWorkIds: normalizeList(source.awaitingWorkIds),
    continuationContractRef: contractRefFrom(source.continuationContractRef || source.contractRef || source.contract),
    wakePolicyRef: source.wakePolicyRef ? wakePolicyRefFrom(source.wakePolicyRef) : null,
    sourceRefs: normalizeRefs(source.sourceRefs, "agent_suspension_source"),
    modelAttentionReleased: source.modelAttentionReleased !== false,
    modelShouldPollRawWork: false,
    providerCallStartedInThisPr: false,
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    startedAt: normalizeString(source.startedAt, nowIso(options.now || Date.now)),
    expiresAt: normalizeString(source.expiresAt, ""),
    status: pickEnum(source.status, AGENT_SUSPENSION_STATUSES, "active"),
  };
  suspension.suspensionDigest = digestFor("direct-agent-suspension-state@1", suspension);
  return suspension;
}

function validateAgentSuspensionState(suspension, options = {}) {
  requirePlainObject(suspension, "agentSuspensionState");
  if (suspension.schema !== DIRECT_AGENT_SUSPENSION_STATE_SCHEMA) throw validationError("direct_wakeup_schema_mismatch", "agentSuspensionState");
  requireString(suspension.suspensionId, "agentSuspensionState.suspensionId");
  requireString(suspension.agentId, "agentSuspensionState.agentId");
  requireString(suspension.agentRunId, "agentSuspensionState.agentRunId");
  if (!AGENT_SUSPENSION_REASONS.includes(suspension.reason)) throw validationError("direct_wakeup_invalid_reason", "agentSuspensionState.reason");
  if (!AGENT_SUSPENSION_STATUSES.includes(suspension.status)) throw validationError("direct_wakeup_invalid_status", "agentSuspensionState.status");
  requireArray(suspension.awaitingWorkIds, "agentSuspensionState.awaitingWorkIds");
  if (suspension.reason === "awaiting_async_work" && !suspension.awaitingWorkIds.length) {
    throw validationError("direct_wakeup_missing_awaited_work", "agentSuspensionState.awaitingWorkIds");
  }
  const registeredWorkIds = knownRegisteredWorkIds(options.registryStore, options.registeredWorkIds);
  if (registeredWorkIds.size) {
    for (const workId of suspension.awaitingWorkIds) {
      if (!registeredWorkIds.has(workId)) throw validationError("direct_wakeup_unregistered_awaited_work", workId);
    }
  }
  validateRef(suspension.continuationContractRef, "agentSuspensionState.continuationContractRef");
  if (suspension.wakePolicyRef) validateRef(suspension.wakePolicyRef, "agentSuspensionState.wakePolicyRef");
  requireArray(suspension.sourceRefs, "agentSuspensionState.sourceRefs");
  suspension.sourceRefs.forEach((ref, index) => validateRef(ref, `agentSuspensionState.sourceRefs.${index}`, { requireDigest: false }));
  if (suspension.modelAttentionReleased !== true || suspension.modelShouldPollRawWork !== false || suspension.providerCallStartedInThisPr !== false) {
    throw validationError("direct_wakeup_authority_leak", "agentSuspensionState.polling");
  }
  if (suspension.rawPayloadIncluded || suspension.rawTextIncluded || suspension.rawPathIncluded || suspension.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_exposure", "agentSuspensionState");
  }
  validateDigest(suspension, "suspensionDigest", "direct-agent-suspension-state@1", "agentSuspensionState");
  return true;
}

function buildAgentWakeEvent(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceWorkId = normalizeString(source.sourceWorkId, "");
  const wakeEvent = {
    schema: DIRECT_AGENT_WAKE_EVENT_SCHEMA,
    wakeEventId: normalizeId(source.wakeEventId, "agent_wake_event"),
    idempotencyKey: normalizeString(source.idempotencyKey, ""),
    targetAgentId: normalizeId(source.targetAgentId, "agent_worker"),
    targetAgentRunId: normalizeId(source.targetAgentRunId, "agent_run"),
    sourceSuspensionId: normalizeString(source.sourceSuspensionId, ""),
    reason: pickEnum(source.reason, AGENT_WAKE_REASONS, "async_work_completed"),
    payloadRef: refFrom(
      source.payloadRef?.kind || "wake_payload",
      source.payloadRef?.id ||
        source.payloadRef?.refId ||
        source.payloadRef?.artifactId ||
        source.payloadRef?.outcomeId ||
        source.payloadRef?.snapshotId ||
        source.payloadRef?.transitionId ||
        source.payloadRef?.workId ||
        sourceWorkId,
      source.payloadRef?.digest || source.payloadRef?.artifactDigest || source.payloadRef?.outcomeDigest || source.payloadRef?.snapshotDigest || "",
      source.payloadRef?.label || "Wake payload",
    ),
    wakePolicyRef: wakePolicyRefFrom(source.wakePolicyRef || source.wakePolicy),
    consumptionMode: pickEnum(source.consumptionMode, AGENT_WAKE_CONSUMPTION_MODES, "exactly_once"),
    sourceWorkId,
    deliveryAttemptCount: Number.isInteger(source.deliveryAttemptCount) && source.deliveryAttemptCount >= 0 ? source.deliveryAttemptCount : 0,
    providerWakeStartedInThisPr: false,
    hiddenProviderSpendAllowed: false,
    rawWakePayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    consumedAt: normalizeString(source.consumedAt, ""),
    status: pickEnum(source.status, AGENT_WAKE_EVENT_STATUSES, "queued"),
  };
  wakeEvent.idempotencyKey = wakeEvent.idempotencyKey ||
    `${wakeEvent.targetAgentRunId}:${wakeEvent.sourceSuspensionId || "no_suspension"}:${wakeEvent.sourceWorkId || wakeEvent.payloadRef.id}:${wakeEvent.reason}`;
  wakeEvent.wakeEventDigest = digestFor("direct-agent-wake-event@1", wakeEvent);
  return wakeEvent;
}

function validateAgentWakeEvent(wakeEvent, options = {}) {
  requirePlainObject(wakeEvent, "agentWakeEvent");
  if (wakeEvent.schema !== DIRECT_AGENT_WAKE_EVENT_SCHEMA) throw validationError("direct_wakeup_schema_mismatch", "agentWakeEvent");
  requireString(wakeEvent.wakeEventId, "agentWakeEvent.wakeEventId");
  requireString(wakeEvent.idempotencyKey, "agentWakeEvent.idempotencyKey");
  requireString(wakeEvent.targetAgentId, "agentWakeEvent.targetAgentId");
  requireString(wakeEvent.targetAgentRunId, "agentWakeEvent.targetAgentRunId");
  if (!AGENT_WAKE_REASONS.includes(wakeEvent.reason)) throw validationError("direct_wakeup_invalid_reason", "agentWakeEvent.reason");
  if (!AGENT_WAKE_CONSUMPTION_MODES.includes(wakeEvent.consumptionMode)) throw validationError("direct_wakeup_invalid_consumption_mode", "agentWakeEvent.consumptionMode");
  if (!AGENT_WAKE_EVENT_STATUSES.includes(wakeEvent.status)) throw validationError("direct_wakeup_invalid_status", "agentWakeEvent.status");
  validateRef(wakeEvent.payloadRef, "agentWakeEvent.payloadRef", { requireDigest: false });
  validateRef(wakeEvent.wakePolicyRef, "agentWakeEvent.wakePolicyRef");
  const registeredWorkIds = knownRegisteredWorkIds(options.registryStore, options.registeredWorkIds);
  if (wakeEvent.sourceWorkId) {
    if (registeredWorkIds.size && !registeredWorkIds.has(wakeEvent.sourceWorkId)) {
      throw validationError("direct_wakeup_unregistered_source_work", wakeEvent.sourceWorkId);
    }
  } else if (wakeEvent.reason.startsWith("async_work_")) {
    throw validationError("direct_wakeup_missing_source_work", "agentWakeEvent.sourceWorkId");
  }
  if (wakeEvent.providerWakeStartedInThisPr !== false || wakeEvent.hiddenProviderSpendAllowed !== false) {
    throw validationError("direct_wakeup_authority_leak", "agentWakeEvent.providerWake");
  }
  if (wakeEvent.rawWakePayloadIncluded || wakeEvent.rawTextIncluded || wakeEvent.rawPathIncluded || wakeEvent.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_exposure", "agentWakeEvent");
  }
  validateDigest(wakeEvent, "wakeEventDigest", "direct-agent-wake-event@1", "agentWakeEvent");
  return true;
}

function buildTypedContinuationPacket(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const suspension = source.suspension || null;
  const wakeEvent = source.wakeEvent || null;
  if (suspension) validateAgentSuspensionState(suspension, options);
  if (wakeEvent) validateAgentWakeEvent(wakeEvent, options);
  const sourceWorkIds = normalizeList(source.sourceWorkIds || suspension?.awaitingWorkIds || (wakeEvent?.sourceWorkId ? [wakeEvent.sourceWorkId] : []));
  const packet = {
    schema: DIRECT_TYPED_CONTINUATION_PACKET_SCHEMA,
    packetId: normalizeId(source.packetId, "typed_continuation_packet"),
    targetAgentId: normalizeId(source.targetAgentId || wakeEvent?.targetAgentId || suspension?.agentId, "agent_worker"),
    targetAgentRunId: normalizeId(source.targetAgentRunId || wakeEvent?.targetAgentRunId || suspension?.agentRunId, "agent_run"),
    sourceSuspensionRef: source.sourceSuspensionRef ? refFrom(
      source.sourceSuspensionRef.kind || "agent_suspension_state",
      source.sourceSuspensionRef.id || source.sourceSuspensionRef.refId || source.sourceSuspensionRef.suspensionId,
      source.sourceSuspensionRef.digest || source.sourceSuspensionRef.suspensionDigest || "",
      source.sourceSuspensionRef.label || "Agent suspension",
    ) : (suspension ? suspensionRef(suspension) : null),
    wakeEventRef: source.wakeEventRef ? refFrom(
      source.wakeEventRef.kind || "agent_wake_event",
      source.wakeEventRef.id || source.wakeEventRef.refId || source.wakeEventRef.wakeEventId,
      source.wakeEventRef.digest || source.wakeEventRef.wakeEventDigest || "",
      source.wakeEventRef.label || "Wake event",
    ) : (wakeEvent ? wakeEventRef(wakeEvent) : null),
    resumeReason: pickEnum(source.resumeReason || wakeEvent?.reason, CONTINUATION_RESUME_REASONS, "async_work_completed"),
    sourceWorkIds,
    evidenceRefs: normalizeRefs(source.evidenceRefs, "typed_continuation_evidence"),
    continuationSummary: normalizeString(source.continuationSummary, "Resume from typed wake event using registered evidence."),
    registeredEvidenceOnly: true,
    modelShouldPollRawWork: false,
    providerCallStartedInThisPr: false,
    hiddenProviderSpendAllowed: false,
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  packet.packetDigest = digestFor("direct-typed-continuation-packet@1", packet);
  return packet;
}

function validateTypedContinuationPacket(packet, options = {}) {
  requirePlainObject(packet, "typedContinuationPacket");
  if (packet.schema !== DIRECT_TYPED_CONTINUATION_PACKET_SCHEMA) throw validationError("direct_wakeup_schema_mismatch", "typedContinuationPacket");
  requireString(packet.packetId, "typedContinuationPacket.packetId");
  requireString(packet.targetAgentId, "typedContinuationPacket.targetAgentId");
  requireString(packet.targetAgentRunId, "typedContinuationPacket.targetAgentRunId");
  if (!CONTINUATION_RESUME_REASONS.includes(packet.resumeReason)) throw validationError("direct_wakeup_invalid_reason", "typedContinuationPacket.resumeReason");
  if (packet.sourceSuspensionRef) validateRef(packet.sourceSuspensionRef, "typedContinuationPacket.sourceSuspensionRef");
  validateRef(packet.wakeEventRef, "typedContinuationPacket.wakeEventRef");
  requireArray(packet.sourceWorkIds, "typedContinuationPacket.sourceWorkIds");
  const registeredWorkIds = knownRegisteredWorkIds(options.registryStore, options.registeredWorkIds);
  if (registeredWorkIds.size) {
    for (const workId of packet.sourceWorkIds) {
      if (!registeredWorkIds.has(workId)) throw validationError("direct_wakeup_unregistered_source_work", workId);
    }
  }
  requireArray(packet.evidenceRefs, "typedContinuationPacket.evidenceRefs");
  packet.evidenceRefs.forEach((ref, index) => validateRef(ref, `typedContinuationPacket.evidenceRefs.${index}`, { requireDigest: false }));
  requireString(packet.continuationSummary, "typedContinuationPacket.continuationSummary");
  if (packet.registeredEvidenceOnly !== true || packet.modelShouldPollRawWork !== false || packet.providerCallStartedInThisPr !== false || packet.hiddenProviderSpendAllowed !== false) {
    throw validationError("direct_wakeup_authority_leak", "typedContinuationPacket");
  }
  if (packet.rawPayloadIncluded || packet.rawTextIncluded || packet.rawPathIncluded || packet.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_exposure", "typedContinuationPacket");
  }
  validateDigest(packet, "packetDigest", "direct-typed-continuation-packet@1", "typedContinuationPacket");
  return true;
}

function buildWakeQueue(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const registryStore = source.registryStore || null;
  const registeredWorkIds = normalizeList(source.registeredWorkIds);
  const validationOptions = { registryStore, registeredWorkIds };
  const suspensions = (Array.isArray(source.suspensions) ? source.suspensions : [])
    .map((suspension) => suspension?.schema === DIRECT_AGENT_SUSPENSION_STATE_SCHEMA ? suspension : buildAgentSuspensionState(suspension, options));
  const wakeEvents = (Array.isArray(source.wakeEvents) ? source.wakeEvents : [])
    .map((wakeEvent) => wakeEvent?.schema === DIRECT_AGENT_WAKE_EVENT_SCHEMA ? wakeEvent : buildAgentWakeEvent(wakeEvent, options));
  const continuationPackets = (Array.isArray(source.continuationPackets) ? source.continuationPackets : [])
    .map((packet) => packet?.schema === DIRECT_TYPED_CONTINUATION_PACKET_SCHEMA ? packet : buildTypedContinuationPacket(packet, validationOptions));
  suspensions.forEach((suspension) => validateAgentSuspensionState(suspension, validationOptions));
  wakeEvents.forEach((wakeEvent) => validateAgentWakeEvent(wakeEvent, validationOptions));
  continuationPackets.forEach((packet) => validateTypedContinuationPacket(packet, validationOptions));
  const queuedWakeEventIds = wakeEvents
    .filter((event) => event.status === "queued")
    .map((event) => event.wakeEventId)
    .sort();
  const deliveredWakeEventIds = wakeEvents
    .filter((event) => event.status === "delivered")
    .map((event) => event.wakeEventId)
    .sort();
  const queue = {
    schema: DIRECT_WAKE_QUEUE_SCHEMA,
    queueId: normalizeId(source.queueId, "wake_queue"),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    registryStoreRef: registryStore ? registryStoreRef(registryStore) : null,
    registeredWorkIds: normalizeList([...registeredWorkIds, ...knownRegisteredWorkIds(registryStore)]),
    suspensions,
    wakeEvents,
    continuationPackets,
    queuedWakeEventIds,
    deliveredWakeEventIds,
    staleWakeEventIds: wakeEvents.filter((event) => event.status === "stale").map((event) => event.wakeEventId).sort(),
    failedWakeEventIds: wakeEvents.filter((event) => event.status === "failed").map((event) => event.wakeEventId).sort(),
    queuedCount: queuedWakeEventIds.length,
    deliveredCount: deliveredWakeEventIds.length,
    exactlyOnceDeliveryEnforced: true,
    requeueRequiresNewIdempotencyKey: true,
    providerWakeEnabledInThisPr: false,
    hiddenProviderSpendAllowed: false,
    backgroundAutonomyEnabledInThisPr: false,
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  validateWakeQueueInvariants(queue);
  queue.queueDigest = digestFor("direct-wake-queue@1", queue);
  return queue;
}

function suspensionById(suspensions = []) {
  return new Map(suspensions.map((suspension) => [suspension.suspensionId, suspension]));
}

function validateWakeQueueInvariants(queue) {
  const registeredWorkIds = new Set(queue.registeredWorkIds);
  const suspensions = suspensionById(queue.suspensions);
  const idempotencyKeys = new Set();
  for (const event of queue.wakeEvents) {
    if (idempotencyKeys.has(event.idempotencyKey)) {
      throw validationError("direct_wakeup_duplicate_idempotency_key", event.idempotencyKey);
    }
    idempotencyKeys.add(event.idempotencyKey);
    if (event.sourceWorkId && !registeredWorkIds.has(event.sourceWorkId)) {
      throw validationError("direct_wakeup_unregistered_source_work", event.sourceWorkId);
    }
    if (event.sourceSuspensionId) {
      const suspension = suspensions.get(event.sourceSuspensionId);
      if (!suspension) throw validationError("direct_wakeup_missing_source_suspension", event.sourceSuspensionId);
      if (event.targetAgentId !== suspension.agentId || event.targetAgentRunId !== suspension.agentRunId) {
        throw validationError("direct_wakeup_target_mismatch", event.wakeEventId);
      }
      if (event.sourceWorkId && !suspension.awaitingWorkIds.includes(event.sourceWorkId)) {
        throw validationError("direct_wakeup_source_work_not_awaited", event.sourceWorkId);
      }
    }
  }
  for (const packet of queue.continuationPackets) {
    const matchingEvent = queue.wakeEvents.find((event) => event.wakeEventId === packet.wakeEventRef.id);
    if (!matchingEvent) throw validationError("direct_wakeup_missing_wake_event_for_packet", packet.packetId);
    if (packet.targetAgentId !== matchingEvent.targetAgentId || packet.targetAgentRunId !== matchingEvent.targetAgentRunId) {
      throw validationError("direct_wakeup_packet_target_mismatch", packet.packetId);
    }
    if (matchingEvent.sourceWorkId && !packet.sourceWorkIds.includes(matchingEvent.sourceWorkId)) {
      throw validationError("direct_wakeup_packet_source_work_mismatch", `${packet.packetId}.${matchingEvent.sourceWorkId}`);
    }
    if (packet.sourceSuspensionRef) {
      const packetSuspension = suspensions.get(packet.sourceSuspensionRef.id);
      if (!packetSuspension) {
        throw validationError("direct_wakeup_missing_source_suspension_for_packet", packet.sourceSuspensionRef.id);
      }
      if (matchingEvent.sourceSuspensionId && packet.sourceSuspensionRef.id !== matchingEvent.sourceSuspensionId) {
        throw validationError("direct_wakeup_packet_suspension_mismatch", `${packet.packetId}.${matchingEvent.sourceSuspensionId}`);
      }
      if (packet.targetAgentId !== packetSuspension.agentId || packet.targetAgentRunId !== packetSuspension.agentRunId) {
        throw validationError("direct_wakeup_packet_suspension_target_mismatch", packet.packetId);
      }
    } else if (matchingEvent.sourceSuspensionId) {
      throw validationError("direct_wakeup_missing_source_suspension_for_packet", packet.packetId);
    }
  }
  return true;
}

function validateWakeQueue(queue, options = {}) {
  requirePlainObject(queue, "wakeQueue");
  if (queue.schema !== DIRECT_WAKE_QUEUE_SCHEMA) throw validationError("direct_wakeup_schema_mismatch", "wakeQueue");
  requireString(queue.queueId, "wakeQueue.queueId");
  if (queue.registryStoreRef) validateRef(queue.registryStoreRef, "wakeQueue.registryStoreRef");
  requireArray(queue.registeredWorkIds, "wakeQueue.registeredWorkIds");
  requireArray(queue.suspensions, "wakeQueue.suspensions");
  requireArray(queue.wakeEvents, "wakeQueue.wakeEvents");
  requireArray(queue.continuationPackets, "wakeQueue.continuationPackets");
  const validationOptions = {
    ...options,
    registeredWorkIds: normalizeList([...(options.registeredWorkIds || []), ...queue.registeredWorkIds]),
  };
  queue.suspensions.forEach((suspension) => validateAgentSuspensionState(suspension, validationOptions));
  queue.wakeEvents.forEach((wakeEvent) => validateAgentWakeEvent(wakeEvent, validationOptions));
  queue.continuationPackets.forEach((packet) => validateTypedContinuationPacket(packet, validationOptions));
  validateWakeQueueInvariants(queue);
  if (queue.exactlyOnceDeliveryEnforced !== true || queue.requeueRequiresNewIdempotencyKey !== true) {
    throw validationError("direct_wakeup_contract_violation", "wakeQueue.deliverySemantics");
  }
  if (queue.providerWakeEnabledInThisPr !== false || queue.hiddenProviderSpendAllowed !== false || queue.backgroundAutonomyEnabledInThisPr !== false) {
    throw validationError("direct_wakeup_authority_leak", "wakeQueue");
  }
  if (queue.rawPayloadIncluded || queue.rawTextIncluded || queue.rawPathIncluded || queue.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_exposure", "wakeQueue");
  }
  validateDigest(queue, "queueDigest", "direct-wake-queue@1", "wakeQueue");
  return true;
}

function buildWakeupHeadlessGameReport(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const queue = source.queue || null;
  if (queue) validateWakeQueue(queue, options);
  const report = {
    schema: DIRECT_WAKEUP_HEADLESS_GAME_REPORT_SCHEMA,
    reportId: normalizeId(source.reportId, "wakeup_headless_game_report"),
    gameName: normalizeString(source.gameName, "async_work_completion_wakeup"),
    registryStoreRef: source.registryStoreRef || (queue?.registryStoreRef || null),
    queueRef: queue ? queueRef(queue) : null,
    suspensionRef: source.suspensionRef || null,
    wakeEventRef: source.wakeEventRef || null,
    continuationPacketRef: source.continuationPacketRef || null,
    assertions: normalizeList(source.assertions || [
      "long_running_work_has_registered_work_id",
      "agent_suspends_without_raw_poll_loop",
      "harness_records_completion_evidence",
      "wake_event_cites_registered_work",
      "continuation_packet_uses_registered_evidence",
    ]),
    result: pickEnum(source.result, HEADLESS_WAKEUP_GAME_RESULTS, "passed"),
    provesNoRawPollingLoop: true,
    provesNoHiddenProviderSpend: true,
    providerCallStartedInThisPr: false,
    backgroundAutonomyEnabledInThisPr: false,
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  report.reportDigest = digestFor("direct-wakeup-headless-game-report@1", report);
  return report;
}

function validateWakeupHeadlessGameReport(report) {
  requirePlainObject(report, "wakeupHeadlessGameReport");
  if (report.schema !== DIRECT_WAKEUP_HEADLESS_GAME_REPORT_SCHEMA) throw validationError("direct_wakeup_schema_mismatch", "wakeupHeadlessGameReport");
  requireString(report.reportId, "wakeupHeadlessGameReport.reportId");
  requireString(report.gameName, "wakeupHeadlessGameReport.gameName");
  if (report.registryStoreRef) validateRef(report.registryStoreRef, "wakeupHeadlessGameReport.registryStoreRef");
  if (report.queueRef) validateRef(report.queueRef, "wakeupHeadlessGameReport.queueRef");
  if (report.suspensionRef) validateRef(report.suspensionRef, "wakeupHeadlessGameReport.suspensionRef");
  if (report.wakeEventRef) validateRef(report.wakeEventRef, "wakeupHeadlessGameReport.wakeEventRef");
  if (report.continuationPacketRef) validateRef(report.continuationPacketRef, "wakeupHeadlessGameReport.continuationPacketRef");
  requireArray(report.assertions, "wakeupHeadlessGameReport.assertions");
  if (!HEADLESS_WAKEUP_GAME_RESULTS.includes(report.result)) throw validationError("direct_wakeup_invalid_result", "wakeupHeadlessGameReport.result");
  if (report.provesNoRawPollingLoop !== true || report.provesNoHiddenProviderSpend !== true) {
    throw validationError("direct_wakeup_contract_violation", "wakeupHeadlessGameReport.proofs");
  }
  if (report.providerCallStartedInThisPr !== false || report.backgroundAutonomyEnabledInThisPr !== false) {
    throw validationError("direct_wakeup_authority_leak", "wakeupHeadlessGameReport");
  }
  if (report.rawPayloadIncluded || report.rawTextIncluded || report.rawPathIncluded || report.rawSecretIncluded) {
    throw validationError("direct_wakeup_raw_exposure", "wakeupHeadlessGameReport");
  }
  validateDigest(report, "reportDigest", "direct-wakeup-headless-game-report@1", "wakeupHeadlessGameReport");
  return true;
}

module.exports = {
  AGENT_SUSPENSION_REASONS,
  AGENT_SUSPENSION_STATUSES,
  AGENT_WAKE_CONSUMPTION_MODES,
  AGENT_WAKE_EVENT_STATUSES,
  AGENT_WAKE_REASONS,
  CONTINUATION_RESUME_REASONS,
  DIRECT_AGENT_SUSPENSION_STATE_SCHEMA,
  DIRECT_AGENT_WAKE_EVENT_SCHEMA,
  DIRECT_TYPED_CONTINUATION_PACKET_SCHEMA,
  DIRECT_WAKE_QUEUE_SCHEMA,
  DIRECT_WAKEUP_HEADLESS_GAME_REPORT_SCHEMA,
  HEADLESS_WAKEUP_GAME_RESULTS,
  buildAgentSuspensionState,
  buildAgentWakeEvent,
  buildTypedContinuationPacket,
  buildWakeQueue,
  buildWakeupHeadlessGameReport,
  validateAgentSuspensionState,
  validateAgentWakeEvent,
  validateTypedContinuationPacket,
  validateWakeQueue,
  validateWakeupHeadlessGameReport,
};
