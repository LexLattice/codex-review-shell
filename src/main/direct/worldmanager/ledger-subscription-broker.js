"use strict";

const {
  canonicalJson,
  sha256,
} = require("../meta-session/digest");

const DIRECT_NOTIFICATION_STANDING_SCHEMA =
  "direct_notification_standing@1";
const DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA =
  "direct_discretionary_ledger_watch@1";
const DIRECT_LEDGER_SUBSCRIPTION_MATCH_SCHEMA =
  "direct_ledger_subscription_match@1";
const DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA =
  "direct_ledger_delivery_envelope@1";
const DIRECT_LEDGER_SUBSCRIPTION_CURSOR_SCHEMA =
  "direct_ledger_subscription_cursor@1";
const DIRECT_LEDGER_DELIVERY_ACK_SCHEMA =
  "direct_ledger_delivery_ack@1";
const DIRECT_LEDGER_BACKPRESSURE_NOTICE_SCHEMA =
  "direct_ledger_backpressure_notice@1";
const DIRECT_LEDGER_SUBSCRIPTION_BROKER_SNAPSHOT_SCHEMA =
  "direct_ledger_subscription_broker_snapshot@1";

// All hooks are optional and synchronous. A durable store can use the narrow
// transition hooks, or persist the complete snapshot at a transaction boundary.
// Provider/model work must never run inside one of these hooks.
const BROKER_PERSISTENCE_CONTRACT = Object.freeze({
  commitOutbox: "Persist a newly queued delivery before dispatch.",
  persistDelivery: "Persist a delivery posture or attempt transition.",
  persistCursorAndAck: "Atomically persist acknowledgement and monotonic cursor.",
  persistBackpressureNotice: "Persist a visible rejected or deferred delivery notice.",
  persistPendingState: "Persist the coalescing buffer after a routing transition.",
  persistSnapshot: "Persist the complete restart snapshot atomically.",
});

const DELIVERY_POLICIES = Object.freeze([
  "immediate_delta",
  "safe_boundary",
  "coalesced_digest",
  "terminal_only",
]);
const WAKE_POLICIES = Object.freeze([
  "never",
  "if_suspended",
  "if_material",
  "always_new_run",
]);
const DELIVERY_POSTURES = Object.freeze([
  "queued",
  "delivered",
  "acknowledged",
  "superseded",
  "failed",
]);
const MATERIALITY_ORDER = Object.freeze({
  routine: 0,
  low: 1,
  normal: 2,
  material: 3,
  high: 4,
  critical: 5,
});
const DIGEST_KEYS = new Set([
  "digest",
  "standingDigest",
  "watchDigest",
  "matchDigest",
  "deliveryDigest",
  "cursorDigest",
  "ackDigest",
  "noticeDigest",
  "snapshotDigest",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_KEYS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(
    `${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`,
  );
}

function stableId(prefix, value) {
  return `${prefix}_${digestFor(prefix, value).slice(0, 24)}`;
}

function sortedUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function exactRef(value, label = "ledgerSubscription.ref") {
  if (!isPlainObject(value)) fail("ledger_subscription_ref_invalid", label);
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id || value.refId, ""),
    digest: text(value.digest, ""),
    ...(text(value.label, "") ? { label: text(value.label, "") } : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail("ledger_subscription_ref_invalid", label);
  }
  if (value.rawTextIncluded || value.rawPathIncluded || value.rawSecretIncluded) {
    fail("ledger_subscription_raw_ref_exposure", label);
  }
  return ref;
}

function uniqueRefs(values = [], label = "refs") {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value, index) => exactRef(value, `${label}.${index}`))
    .filter((ref) => {
      const key = `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.kind}:${left.id}:${left.digest}`.localeCompare(
        `${right.kind}:${right.id}:${right.digest}`,
      ));
}

function sameRefIdentity(left, right, { exactRevision = false } = {}) {
  if (!left || !right) return false;
  if (text(left.kind, "") !== text(right.kind, "")) return false;
  if (text(left.id, "") !== text(right.id, "")) return false;
  return !exactRevision || text(left.digest, "") === text(right.digest, "");
}

function normalizeScope(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const scope = {
    kind: text(source.kind, source.projectId ? "project" : "user_world"),
    userWorldId: text(source.userWorldId, "user_world_local"),
    projectId: text(source.projectId, ""),
    taskId: text(source.taskId, ""),
    taskType: text(source.taskType, ""),
    workThreadId: text(source.workThreadId, ""),
    artifactLifecycleId: text(source.artifactLifecycleId, ""),
  };
  if (!["user_world", "project", "task", "workthread", "artifact"].includes(scope.kind)) {
    fail("ledger_subscription_scope_invalid", scope.kind);
  }
  if (scope.kind !== "user_world" && !scope.projectId) {
    fail("ledger_subscription_scope_invalid", "projectId");
  }
  if (scope.kind === "workthread" && !scope.workThreadId) {
    fail("ledger_subscription_scope_invalid", "workThreadId");
  }
  if (scope.kind === "task" && !scope.taskId && !scope.taskType) {
    fail("ledger_subscription_scope_invalid", "taskId_or_taskType");
  }
  if (scope.kind === "artifact" && !scope.artifactLifecycleId) {
    fail("ledger_subscription_scope_invalid", "artifactLifecycleId");
  }
  return scope;
}

function scopeContains(container, subject) {
  const outer = normalizeScope(container);
  const inner = normalizeScope(subject);
  if (outer.userWorldId !== inner.userWorldId) return false;
  if (outer.kind === "user_world") return true;
  if (outer.projectId !== inner.projectId) return false;
  if (outer.kind === "project") return true;
  if (outer.kind === "task") {
    return (!outer.taskId || outer.taskId === inner.taskId) &&
      (!outer.taskType || outer.taskType === inner.taskType);
  }
  if (outer.kind === "workthread") return outer.workThreadId === inner.workThreadId;
  return outer.artifactLifecycleId === inner.artifactLifecycleId;
}

function normalizeOperationalPolicy(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const integer = (key, fallback, minimum = 0) =>
    Number.isInteger(source[key]) && source[key] >= minimum
      ? source[key]
      : fallback;
  return {
    debounceWindowMs: integer("debounceWindowMs", 750),
    maximumEventsPerDelivery: integer("maximumEventsPerDelivery", 32, 1),
    maximumPendingEvents: integer("maximumPendingEvents", 512, 1),
    maximumQueuedDeliveries: integer("maximumQueuedDeliveries", 128, 1),
    maximumWakeFrequencyMs: integer("maximumWakeFrequencyMs", 2_000),
    priorityThreshold: MATERIALITY_ORDER[text(source.priorityThreshold, "normal")]
      === undefined ? "normal" : text(source.priorityThreshold, "normal"),
    coalescingKey: text(source.coalescingKey, "semantic_scope"),
    supersessionBehavior: ["retain_all", "latest_per_object", "latest_only"].includes(
      source.supersessionBehavior,
    ) ? source.supersessionBehavior : "latest_per_object",
  };
}

function buildNotificationStanding(input = {}, options = {}) {
  const standing = {
    schema: DIRECT_NOTIFICATION_STANDING_SCHEMA,
    standingId: text(input.standingId, "") || stableId("notification_standing", input),
    subscriberRoleRef: exactRef(input.subscriberRoleRef, "standing.subscriberRoleRef"),
    subscriberScope: normalizeScope(input.subscriberScope),
    sourceStreamPatterns: sortedUnique(input.sourceStreamPatterns),
    eventActTypeRefs: uniqueRefs(input.eventActTypeRefs, "standing.eventActTypeRefs"),
    epistemicPostures: sortedUnique(input.epistemicPostures),
    objectScopeRefs: uniqueRefs(input.objectScopeRefs, "standing.objectScopeRefs"),
    materialityPredicateRef: exactRef(
      input.materialityPredicateRef,
      "standing.materialityPredicateRef",
    ),
    deliveryPolicy: DELIVERY_POLICIES.includes(input.deliveryPolicy)
      ? input.deliveryPolicy : "safe_boundary",
    wakePolicy: WAKE_POLICIES.includes(input.wakePolicy)
      ? input.wakePolicy : "never",
    coalescingPolicyRef: exactRef(
      input.coalescingPolicyRef,
      "standing.coalescingPolicyRef",
    ),
    evidenceVisibilityPolicyRef: exactRef(
      input.evidenceVisibilityPolicyRef,
      "standing.evidenceVisibilityPolicyRef",
    ),
    operationalPolicy: normalizeOperationalPolicy(input.operationalPolicy),
    revision: Number.isInteger(input.revision) && input.revision > 0
      ? input.revision : 1,
    canonical: true,
    active: input.active !== false,
    createdAt: text(input.createdAt, nowIso(options.now)),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!standing.sourceStreamPatterns.length) {
    fail("ledger_subscription_stream_pattern_missing", standing.standingId);
  }
  standing.standingDigest = digestFor("direct-notification-standing@1", standing);
  validateNotificationStanding(standing);
  return standing;
}

function validateNotificationStanding(standing) {
  if (!isPlainObject(standing) || standing.schema !== DIRECT_NOTIFICATION_STANDING_SCHEMA) {
    fail("ledger_notification_standing_invalid");
  }
  if (!text(standing.standingId, "") || standing.canonical !== true) {
    fail("ledger_notification_standing_invalid", "identity_or_authority");
  }
  exactRef(standing.subscriberRoleRef, "standing.subscriberRoleRef");
  normalizeScope(standing.subscriberScope);
  if (!Array.isArray(standing.sourceStreamPatterns) || !standing.sourceStreamPatterns.length) {
    fail("ledger_notification_standing_invalid", "sourceStreamPatterns");
  }
  standing.eventActTypeRefs.forEach((ref, index) => exactRef(ref, `standing.eventActTypeRefs.${index}`));
  standing.objectScopeRefs.forEach((ref, index) => exactRef(ref, `standing.objectScopeRefs.${index}`));
  exactRef(standing.materialityPredicateRef, "standing.materialityPredicateRef");
  exactRef(standing.coalescingPolicyRef, "standing.coalescingPolicyRef");
  exactRef(standing.evidenceVisibilityPolicyRef, "standing.evidenceVisibilityPolicyRef");
  if (!DELIVERY_POLICIES.includes(standing.deliveryPolicy) || !WAKE_POLICIES.includes(standing.wakePolicy)) {
    fail("ledger_notification_standing_invalid", "delivery_or_wake_policy");
  }
  if (!Number.isInteger(standing.revision) || standing.revision < 1 || !isPlainObject(standing.operationalPolicy)) {
    fail("ledger_notification_standing_invalid", "revision_or_operational_policy");
  }
  if (standing.rawPayloadIncluded || standing.rawTextIncluded || standing.rawPathIncluded || standing.rawSecretIncluded) {
    fail("ledger_subscription_raw_exposure", standing.standingId);
  }
  if (standing.standingDigest !== digestFor("direct-notification-standing@1", standing)) {
    fail("ledger_notification_standing_digest_mismatch", standing.standingId);
  }
  return true;
}

function buildDiscretionaryLedgerWatch(input = {}, options = {}) {
  const ownerScope = normalizeScope(input.ownerScope || input.subscriberScope);
  const subscriberScope = normalizeScope(input.subscriberScope || input.ownerScope);
  if (!scopeContains(ownerScope, subscriberScope)) {
    fail("ledger_watch_scope_widening", "subscriberScope");
  }
  const readableScopes = (Array.isArray(input.readableScopes) && input.readableScopes.length
    ? input.readableScopes : [ownerScope]).map(normalizeScope);
  if (!readableScopes.some((scope) => scopeContains(scope, subscriberScope))) {
    fail("ledger_watch_scope_widening", "readableScopes");
  }
  const wakePolicy = WAKE_POLICIES.includes(input.wakePolicy)
    ? input.wakePolicy : "never";
  if (wakePolicy === "always_new_run") {
    fail("ledger_watch_always_wake_forbidden");
  }
  const watch = {
    schema: DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA,
    watchId: text(input.watchId, "") || stableId("ledger_watch", input),
    ownerRoleRef: exactRef(input.ownerRoleRef, "watch.ownerRoleRef"),
    ownerScope,
    subscriberScope,
    readableScopes,
    sourceStreamPatterns: sortedUnique(input.sourceStreamPatterns),
    eventActTypeRefs: uniqueRefs(input.eventActTypeRefs, "watch.eventActTypeRefs"),
    epistemicPostures: sortedUnique(input.epistemicPostures),
    objectScopeRefs: uniqueRefs(input.objectScopeRefs, "watch.objectScopeRefs"),
    deliveryPolicy: DELIVERY_POLICIES.includes(input.deliveryPolicy)
      ? input.deliveryPolicy : "coalesced_digest",
    wakePolicy,
    evidenceVisibilityPolicyRef: exactRef(
      input.evidenceVisibilityPolicyRef,
      "watch.evidenceVisibilityPolicyRef",
    ),
    operationalPolicy: normalizeOperationalPolicy(input.operationalPolicy),
    revision: Number.isInteger(input.revision) && input.revision > 0
      ? input.revision : 1,
    canonical: false,
    active: input.active !== false,
    createdAt: text(input.createdAt, nowIso(options.now)),
    expiresAt: text(input.expiresAt, ""),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!watch.sourceStreamPatterns.length) {
    fail("ledger_subscription_stream_pattern_missing", watch.watchId);
  }
  watch.watchDigest = digestFor("direct-discretionary-ledger-watch@1", watch);
  validateDiscretionaryLedgerWatch(watch);
  return watch;
}

function validateDiscretionaryLedgerWatch(watch) {
  if (!isPlainObject(watch) || watch.schema !== DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA) {
    fail("ledger_watch_invalid");
  }
  if (!text(watch.watchId, "") || watch.canonical !== false || watch.wakePolicy === "always_new_run") {
    fail("ledger_watch_invalid", "identity_or_authority");
  }
  exactRef(watch.ownerRoleRef, "watch.ownerRoleRef");
  const ownerScope = normalizeScope(watch.ownerScope);
  const subscriberScope = normalizeScope(watch.subscriberScope);
  if (!scopeContains(ownerScope, subscriberScope)) fail("ledger_watch_scope_widening");
  if (!Array.isArray(watch.readableScopes) || !watch.readableScopes.some((scope) => scopeContains(scope, subscriberScope))) {
    fail("ledger_watch_scope_widening", "readableScopes");
  }
  exactRef(watch.evidenceVisibilityPolicyRef, "watch.evidenceVisibilityPolicyRef");
  if (!DELIVERY_POLICIES.includes(watch.deliveryPolicy) || !WAKE_POLICIES.includes(watch.wakePolicy)) {
    fail("ledger_watch_invalid", "delivery_or_wake_policy");
  }
  if (watch.rawPayloadIncluded || watch.rawTextIncluded || watch.rawPathIncluded || watch.rawSecretIncluded) {
    fail("ledger_subscription_raw_exposure", watch.watchId);
  }
  if (watch.watchDigest !== digestFor("direct-discretionary-ledger-watch@1", watch)) {
    fail("ledger_watch_digest_mismatch", watch.watchId);
  }
  return true;
}

function subscriptionRef(subscription) {
  if (subscription.schema === DIRECT_NOTIFICATION_STANDING_SCHEMA) {
    return exactRef({
      kind: "notification_standing",
      id: subscription.standingId,
      digest: subscription.standingDigest,
      label: "Constitutional notification standing",
    });
  }
  return exactRef({
    kind: "discretionary_ledger_watch",
    id: subscription.watchId,
    digest: subscription.watchDigest,
    label: "Discretionary ledger watch",
  });
}

function eventRef(event) {
  const id = text(event?.ledgerEventId || event?.eventId, "");
  const digest = text(event?.ledgerEventDigest || event?.eventDigest || event?.digest, "");
  if (!id || !digest) fail("ledger_subscription_event_ref_invalid");
  return exactRef({ kind: "epistemic_ledger_event", id, digest, label: text(event.rendererSafeSummary, "Ledger event") });
}

function streamNames(event) {
  return sortedUnique((Array.isArray(event?.streamRefs) ? event.streamRefs : [])
    .map((stream) => typeof stream === "string"
      ? stream
      : text(
          stream?.streamKey ||
          (stream?.streamType && stream?.streamId
            ? `${stream.streamType}:${stream.streamId}`
            : stream?.id || stream?.name),
          "",
        )));
}

function patternMatches(pattern, value) {
  const source = text(pattern, "");
  if (!source) return false;
  if (source === "*") return true;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function eventScope(event) {
  if (isPlainObject(event?.subjectScope)) return normalizeScope(event.subjectScope);
  if (isPlainObject(event?.scope)) return normalizeScope(event.scope);
  const streams = streamNames(event);
  const project = streams.find((stream) => stream.startsWith("project:"));
  const workthread = streams.find((stream) => stream.startsWith("workthread:"));
  const artifact = streams.find((stream) => stream.startsWith("artifact:"));
  return normalizeScope({
    kind: artifact ? "artifact" : workthread ? "workthread" : project ? "project" : "user_world",
    userWorldId: text(event?.userWorldId, "user_world_local"),
    projectId: project ? project.slice("project:".length) : text(event?.projectId, ""),
    workThreadId: workthread ? workthread.slice("workthread:".length) : "",
    artifactLifecycleId: artifact ? artifact.slice("artifact:".length) : "",
  });
}

function affectedRefs(event) {
  return uniqueRefs([
    ...(Array.isArray(event?.objectRefs) ? event.objectRefs : []),
    ...(Array.isArray(event?.subjectRefs) ? event.subjectRefs : []),
    ...(Array.isArray(event?.affectsRefs) ? event.affectsRefs : []),
    ...(Array.isArray(event?.affectedRefs) ? event.affectedRefs : []),
    ...(Array.isArray(event?.affectedContextRefs) ? event.affectedContextRefs : []),
    ...(Array.isArray(event?.contradictsRefs) ? event.contradictsRefs : []),
    ...(Array.isArray(event?.supersedesRefs) ? event.supersedesRefs : []),
    ...(Array.isArray(event?.typedPayload?.contradictsRefs) ? event.typedPayload.contradictsRefs : []),
    ...(Array.isArray(event?.typedPayload?.supersedesRefs) ? event.typedPayload.supersedesRefs : []),
  ], "event.affectedRefs");
}

function eventIsTerminal(event) {
  return event?.terminal === true || [
    "closure_submitted",
    "audit_supported",
    "audit_contradicted",
    "artifact_admitted",
    "artifact_rejected",
  ].includes(text(event?.epistemicPosture, ""));
}

function defaultMaterialityResolver(subscription, event) {
  const threshold = MATERIALITY_ORDER[subscription.operationalPolicy.priorityThreshold] ?? 2;
  const materiality = MATERIALITY_ORDER[text(event?.materiality, "normal")] ?? 2;
  return materiality >= threshold;
}

function matchSubscriptionToEvent(subscription, event, options = {}) {
  if (subscription.schema === DIRECT_NOTIFICATION_STANDING_SCHEMA) {
    validateNotificationStanding(subscription);
  } else if (subscription.schema === DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA) {
    validateDiscretionaryLedgerWatch(subscription);
  } else {
    fail("ledger_subscription_unknown_schema");
  }
  if (!subscription.active) return null;
  const clock = options.now || Date.now;
  const nowMs = Number(typeof clock === "function" ? clock() : clock) || Date.now();
  if (subscription.expiresAt && Date.parse(subscription.expiresAt) <= nowMs) return null;
  const streams = streamNames(event);
  if (!subscription.sourceStreamPatterns.some((pattern) => streams.some((stream) => patternMatches(pattern, stream)))) {
    return null;
  }
  const scope = eventScope(event);
  if (!scopeContains(subscription.subscriberScope, scope)) return null;
  if (subscription.eventActTypeRefs.length && !subscription.eventActTypeRefs.some((ref) => sameRefIdentity(ref, event.actTypeRef, { exactRevision: true }))) {
    return null;
  }
  if (subscription.epistemicPostures.length && !subscription.epistemicPostures.includes(text(event.epistemicPosture, ""))) {
    return null;
  }
  const refs = affectedRefs(event);
  if (subscription.objectScopeRefs.length && !subscription.objectScopeRefs.some((wanted) => refs.some((ref) => sameRefIdentity(wanted, ref)))) {
    return null;
  }
  if (subscription.schema === DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA &&
      !subscription.readableScopes.some((readable) => scopeContains(readable, scope))) {
    return null;
  }
  if (subscription.deliveryPolicy === "terminal_only" && !eventIsTerminal(event)) return null;
  const materialityResolver = typeof options.materialityResolver === "function"
    ? options.materialityResolver : defaultMaterialityResolver;
  const material = Boolean(materialityResolver(subscription, event));
  if (!material && subscription.deliveryPolicy === "immediate_delta") return null;
  const ref = subscriptionRef(subscription);
  const ledgerRef = eventRef(event);
  const match = {
    schema: DIRECT_LEDGER_SUBSCRIPTION_MATCH_SCHEMA,
    matchId: stableId("ledger_subscription_match", {
      subscriptionRef: ref,
      ledgerEventRef: ledgerRef,
    }),
    subscriptionRef: ref,
    subscriptionKind: subscription.canonical ? "constitutional" : "discretionary",
    recipientRoleRef: subscription.subscriberRoleRef || subscription.ownerRoleRef,
    recipientScope: subscription.subscriberScope,
    ledgerEventRef: ledgerRef,
    globalSequence: Number(event.globalSequence || 0),
    eventScope: scope,
    affectedRefs: refs,
    materiality: text(event.materiality, "normal"),
    material,
    terminal: eventIsTerminal(event),
    bypassCoalescing: event.bypassCoalescing === true ||
      ["critical", "high"].includes(text(event.materiality, "")) ||
      ["challenge", "authorization", "admission"].includes(text(event.actClass, "")),
    deliveryPolicy: subscription.deliveryPolicy,
    wakePolicy: subscription.wakePolicy,
    operationalPolicy: subscription.operationalPolicy,
    evidenceVisibilityPolicyRef: subscription.evidenceVisibilityPolicyRef,
    coalescingPolicyRef: subscription.coalescingPolicyRef || null,
    rendererSafeSummary: text(event.rendererSafeSummary, "Ledger event available."),
    matchedAt: text(options.matchedAt, nowIso(options.now)),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  match.matchDigest = digestFor("direct-ledger-subscription-match@1", match);
  return match;
}

function coalescingKeyFor(match) {
  const kind = match.operationalPolicy.coalescingKey;
  if (kind === "subscription") return match.subscriptionRef.id;
  if (kind === "object" && match.affectedRefs[0]) {
    return `${match.subscriptionRef.id}:${match.affectedRefs[0].kind}:${match.affectedRefs[0].id}`;
  }
  const scope = match.eventScope;
  return `${match.subscriptionRef.id}:${scope.projectId || scope.userWorldId}:${scope.workThreadId || scope.artifactLifecycleId || "scope"}`;
}

function applySupersession(matches, behavior) {
  if (behavior === "retain_all") return matches;
  if (behavior === "latest_only") return matches.length ? [matches[matches.length - 1]] : [];
  const latest = new Map();
  for (const match of matches) {
    const first = match.affectedRefs[0];
    const key = first ? `${first.kind}:${first.id}` : match.ledgerEventRef.id;
    latest.set(key, match);
  }
  return [...latest.values()].sort((left, right) => left.globalSequence - right.globalSequence);
}

function visibilityProjectionFor(matches, subscription, options = {}) {
  const resolver = typeof options.visibilityResolver === "function"
    ? options.visibilityResolver
    : ({ match }) => ({
        eventRef: match.ledgerEventRef,
        semanticSummary: match.rendererSafeSummary,
        visibleObjectRefs: [],
        visibleEvidenceRefs: [],
        withheldEvidenceCount: 0,
      });
  const entries = matches.map((match) => {
    const resolved = resolver({
      subscription,
      match,
      visibilityPolicyRef: match.evidenceVisibilityPolicyRef,
    }) || {};
    return {
      eventRef: match.ledgerEventRef,
      semanticSummary: text(resolved.semanticSummary, match.rendererSafeSummary),
      visibleObjectRefs: uniqueRefs(resolved.visibleObjectRefs, "projection.visibleObjectRefs"),
      visibleEvidenceRefs: uniqueRefs(resolved.visibleEvidenceRefs, "projection.visibleEvidenceRefs"),
      withheldEvidenceCount: Number.isInteger(resolved.withheldEvidenceCount) && resolved.withheldEvidenceCount > 0
        ? resolved.withheldEvidenceCount : 0,
      protectedNoticeOnly: resolved.protectedNoticeOnly === true,
    };
  });
  return {
    eventCount: entries.length,
    entries,
    visibleObjectRefs: uniqueRefs(entries.flatMap((entry) => entry.visibleObjectRefs)),
    visibleEvidenceRefs: uniqueRefs(entries.flatMap((entry) => entry.visibleEvidenceRefs)),
    withheldEvidenceCount: entries.reduce((sum, entry) => sum + entry.withheldEvidenceCount, 0),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildLedgerDeliveryEnvelope(input = {}, options = {}) {
  const matches = (Array.isArray(input.matches) ? input.matches : [])
    .slice()
    .sort((left, right) => left.globalSequence - right.globalSequence);
  if (!matches.length) fail("ledger_delivery_matches_missing");
  const first = matches[0];
  const subscription = input.subscription;
  const subscriptionExactRef = first.subscriptionRef;
  if (!matches.every((match) => sameRefIdentity(match.subscriptionRef, subscriptionExactRef, { exactRevision: true }))) {
    fail("ledger_delivery_subscription_mismatch");
  }
  const cursorBefore = Number.isInteger(input.cursorBefore) && input.cursorBefore >= 0
    ? input.cursorBefore : 0;
  const cursorAfter = Math.max(...matches.map((match) => Number(match.globalSequence || 0)));
  if (cursorAfter < cursorBefore) fail("ledger_delivery_cursor_regression");
  const recipient = typeof options.recipientResolver === "function"
    ? options.recipientResolver({ subscription, matches }) || {}
    : {};
  const projection = visibilityProjectionFor(matches, subscription, options);
  const eventRefs = uniqueRefs(matches.map((match) => match.ledgerEventRef));
  const hydrationRequirementRef = projection.visibleObjectRefs.length || projection.visibleEvidenceRefs.length
    ? exactRef({
        kind: "ledger_context_hydration_requirement",
        id: stableId("ledger_hydration_requirement", { subscriptionExactRef, eventRefs }),
        digest: digestFor("ledger-context-hydration-requirement@1", {
          subscriptionExactRef,
          eventRefs,
          visibleObjectRefs: projection.visibleObjectRefs,
          visibleEvidenceRefs: projection.visibleEvidenceRefs,
        }),
        label: "Bounded ledger delivery hydration",
      })
    : null;
  const delivery = {
    schema: DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA,
    deliveryId: text(input.deliveryId, "") || stableId("ledger_delivery", {
      subscriptionExactRef,
      eventRefs,
      cursorBefore,
      cursorAfter,
    }),
    subscriptionRef: subscriptionExactRef,
    recipientRoleRef: first.recipientRoleRef,
    recipientAgentRef: recipient.agentRef ? exactRef(recipient.agentRef, "delivery.recipientAgentRef") : null,
    recipientAgentRunRef: recipient.agentRunRef ? exactRef(recipient.agentRunRef, "delivery.recipientAgentRunRef") : null,
    eventRefs,
    boundedProjection: projection,
    hydrationRequirementRef,
    deliveryPosture: "queued",
    wakeEligible: matches.some((match) => match.wakePolicy !== "never" && (match.material || match.wakePolicy === "always_new_run")),
    wakePolicy: first.wakePolicy,
    deliveryPolicy: first.deliveryPolicy,
    cursorBefore,
    cursorAfter,
    idempotencyKey: text(input.idempotencyKey, "") || `${subscriptionExactRef.id}:${cursorBefore}:${cursorAfter}:${eventRefs.map((ref) => ref.id).join(",")}`,
    attemptCount: Number.isInteger(input.attemptCount) && input.attemptCount >= 0 ? input.attemptCount : 0,
    backpressureState: "accepted",
    queuedAt: text(input.queuedAt, nowIso(options.now)),
    deliveredAt: "",
    acknowledgedAt: "",
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  delivery.deliveryDigest = digestFor("direct-ledger-delivery-envelope@1", delivery);
  validateLedgerDeliveryEnvelope(delivery);
  return delivery;
}

function validateLedgerDeliveryEnvelope(delivery) {
  if (!isPlainObject(delivery) || delivery.schema !== DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA) {
    fail("ledger_delivery_invalid");
  }
  if (!text(delivery.deliveryId, "") || !text(delivery.idempotencyKey, "")) fail("ledger_delivery_invalid", "identity");
  exactRef(delivery.subscriptionRef, "delivery.subscriptionRef");
  exactRef(delivery.recipientRoleRef, "delivery.recipientRoleRef");
  if (delivery.recipientAgentRef) exactRef(delivery.recipientAgentRef, "delivery.recipientAgentRef");
  if (delivery.recipientAgentRunRef) exactRef(delivery.recipientAgentRunRef, "delivery.recipientAgentRunRef");
  if (!Array.isArray(delivery.eventRefs) || !delivery.eventRefs.length) fail("ledger_delivery_invalid", "eventRefs");
  delivery.eventRefs.forEach((ref, index) => exactRef(ref, `delivery.eventRefs.${index}`));
  if (delivery.hydrationRequirementRef) exactRef(delivery.hydrationRequirementRef, "delivery.hydrationRequirementRef");
  if (!DELIVERY_POSTURES.includes(delivery.deliveryPosture) || !WAKE_POLICIES.includes(delivery.wakePolicy)) {
    fail("ledger_delivery_invalid", "posture_or_policy");
  }
  if (!Number.isInteger(delivery.cursorBefore) || !Number.isInteger(delivery.cursorAfter) || delivery.cursorAfter < delivery.cursorBefore) {
    fail("ledger_delivery_cursor_invalid");
  }
  if (!isPlainObject(delivery.boundedProjection) || delivery.boundedProjection.rawPayloadIncluded !== false) {
    fail("ledger_delivery_projection_invalid");
  }
  if (delivery.rawPayloadIncluded || delivery.rawTextIncluded || delivery.rawPathIncluded || delivery.rawSecretIncluded) {
    fail("ledger_subscription_raw_exposure", delivery.deliveryId);
  }
  if (delivery.deliveryDigest !== digestFor("direct-ledger-delivery-envelope@1", delivery)) {
    fail("ledger_delivery_digest_mismatch", delivery.deliveryId);
  }
  return true;
}

function buildSubscriptionCursor(input = {}, options = {}) {
  const cursor = {
    schema: DIRECT_LEDGER_SUBSCRIPTION_CURSOR_SCHEMA,
    subscriptionRef: exactRef(input.subscriptionRef, "cursor.subscriptionRef"),
    acknowledgedSequence: Number.isInteger(input.acknowledgedSequence) && input.acknowledgedSequence >= 0
      ? input.acknowledgedSequence : 0,
    lastDeliveryRef: input.lastDeliveryRef ? exactRef(input.lastDeliveryRef, "cursor.lastDeliveryRef") : null,
    updatedAt: text(input.updatedAt, nowIso(options.now)),
    rawPayloadIncluded: false,
  };
  cursor.cursorDigest = digestFor("direct-ledger-subscription-cursor@1", cursor);
  return cursor;
}

function acknowledgeLedgerDelivery(delivery, cursor, input = {}, options = {}) {
  validateLedgerDeliveryEnvelope(delivery);
  const current = cursor || buildSubscriptionCursor({ subscriptionRef: delivery.subscriptionRef }, options);
  if (!sameRefIdentity(current.subscriptionRef, delivery.subscriptionRef, { exactRevision: true })) {
    fail("ledger_ack_subscription_mismatch");
  }
  if (delivery.cursorAfter < current.acknowledgedSequence) {
    return {
      state: "idempotent_or_stale",
      cursor: current,
      acknowledgement: null,
    };
  }
  const deliveryRef = exactRef({
    kind: "ledger_delivery",
    id: delivery.deliveryId,
    digest: delivery.deliveryDigest,
    label: "Ledger delivery",
  });
  const acknowledgedAt = text(input.acknowledgedAt, nowIso(options.now));
  const nextCursor = buildSubscriptionCursor({
    subscriptionRef: delivery.subscriptionRef,
    acknowledgedSequence: Math.max(current.acknowledgedSequence, delivery.cursorAfter),
    lastDeliveryRef: deliveryRef,
    updatedAt: acknowledgedAt,
  }, options);
  const acknowledgement = {
    schema: DIRECT_LEDGER_DELIVERY_ACK_SCHEMA,
    acknowledgementId: text(input.acknowledgementId, "") || stableId("ledger_delivery_ack", {
      deliveryRef,
      acknowledgedSequence: nextCursor.acknowledgedSequence,
    }),
    deliveryRef,
    subscriptionRef: delivery.subscriptionRef,
    previousCursor: current.acknowledgedSequence,
    acknowledgedCursor: nextCursor.acknowledgedSequence,
    acknowledgedByRef: input.acknowledgedByRef
      ? exactRef(input.acknowledgedByRef, "ack.acknowledgedByRef")
      : delivery.recipientAgentRunRef || delivery.recipientRoleRef,
    worldEffect: "none",
    grantsAuthority: false,
    acknowledgedAt,
    rawPayloadIncluded: false,
  };
  acknowledgement.ackDigest = digestFor("direct-ledger-delivery-ack@1", acknowledgement);
  return { state: "acknowledged", cursor: nextCursor, acknowledgement };
}

function buildBackpressureNotice(input = {}, options = {}) {
  const notice = {
    schema: DIRECT_LEDGER_BACKPRESSURE_NOTICE_SCHEMA,
    noticeId: stableId("ledger_backpressure_notice", input),
    subscriptionRef: exactRef(input.subscriptionRef, "backpressure.subscriptionRef"),
    reason: text(input.reason, "queue_capacity_exceeded"),
    pendingEventCount: Number(input.pendingEventCount || 0),
    queuedDeliveryCount: Number(input.queuedDeliveryCount || 0),
    acceptedAsDelivered: false,
    retryRequired: true,
    createdAt: text(input.createdAt, nowIso(options.now)),
    rawPayloadIncluded: false,
  };
  notice.noticeDigest = digestFor("direct-ledger-backpressure-notice@1", notice);
  return notice;
}

class DirectLedgerSubscriptionBroker {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.visibilityResolver = options.visibilityResolver;
    this.materialityResolver = options.materialityResolver;
    this.recipientResolver = options.recipientResolver;
    this.persistence = isPlainObject(options.persistence) ? options.persistence : {};
    this.standings = new Map();
    this.watches = new Map();
    this.pending = new Map();
    this.deliveries = new Map();
    this.deliveryByIdempotencyKey = new Map();
    this.cursors = new Map();
    this.acknowledgements = new Map();
    this.backpressureNotices = [];
    this.lastWakeAtBySubscription = new Map();
    for (const standing of options.standings || []) this.registerStanding(standing);
    for (const watch of options.watches || []) this.registerWatch(watch);
    this.restore(options.state);
  }

  restore(state) {
    if (!isPlainObject(state)) return;
    if (state.schema === DIRECT_LEDGER_SUBSCRIPTION_BROKER_SNAPSHOT_SCHEMA) {
      validateLedgerSubscriptionBrokerSnapshot(state);
    }
    for (const standing of state.standings || []) {
      if (!this.standings.has(standing.standingId)) this.registerStanding(standing);
    }
    for (const watch of state.watches || []) {
      if (!this.watches.has(watch.watchId)) this.registerWatch(watch);
    }
    for (const delivery of state.deliveries || []) {
      validateLedgerDeliveryEnvelope(delivery);
      this.deliveries.set(delivery.deliveryId, delivery);
      this.deliveryByIdempotencyKey.set(delivery.idempotencyKey, delivery.deliveryId);
    }
    for (const cursor of state.cursors || []) {
      this.cursors.set(cursor.subscriptionRef.id, cursor);
    }
    for (const acknowledgement of state.acknowledgements || []) {
      if (acknowledgement?.deliveryRef?.id) {
        this.acknowledgements.set(
          acknowledgement.deliveryRef.id,
          acknowledgement,
        );
      }
    }
    this.backpressureNotices.push(...(state.backpressureNotices || []));
    for (const entry of state.lastWakeAtBySubscription || []) {
      if (
        text(entry?.subscriptionId, "") &&
        Number.isFinite(Number(entry?.lastWakeAt))
      ) {
        this.lastWakeAtBySubscription.set(
          entry.subscriptionId,
          Number(entry.lastWakeAt),
        );
      }
    }
    for (const item of state.pending || []) {
      if (item?.key && Array.isArray(item.matches)) this.pending.set(item.key, item);
    }
  }

  registerStanding(value) {
    const standing = value?.schema === DIRECT_NOTIFICATION_STANDING_SCHEMA
      ? value : buildNotificationStanding(value, { now: this.now });
    validateNotificationStanding(standing);
    const current = this.standings.get(standing.standingId);
    if (current && standing.revision <= current.revision && standing.standingDigest !== current.standingDigest) {
      fail("ledger_notification_standing_revision_stale", standing.standingId);
    }
    this.standings.set(standing.standingId, standing);
    return standing;
  }

  removeStanding() {
    fail("ledger_constitutional_subscription_removal_forbidden");
  }

  registerWatch(value) {
    const watch = value?.schema === DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA
      ? value : buildDiscretionaryLedgerWatch(value, { now: this.now });
    validateDiscretionaryLedgerWatch(watch);
    const current = this.watches.get(watch.watchId);
    if (current && watch.revision <= current.revision && watch.watchDigest !== current.watchDigest) {
      fail("ledger_watch_revision_stale", watch.watchId);
    }
    this.watches.set(watch.watchId, watch);
    return watch;
  }

  removeWatch(watchId, actorRoleRef) {
    const watch = this.watches.get(text(watchId, ""));
    if (!watch) return false;
    if (actorRoleRef && !sameRefIdentity(watch.ownerRoleRef, actorRoleRef, { exactRevision: true })) {
      fail("ledger_watch_owner_mismatch", watchId);
    }
    this.watches.delete(watch.watchId);
    return true;
  }

  subscriptions() {
    return [...this.standings.values(), ...this.watches.values()];
  }

  cursorFor(subscription) {
    const ref = subscriptionRef(subscription);
    return this.cursors.get(ref.id) || buildSubscriptionCursor({ subscriptionRef: ref }, { now: this.now });
  }

  _persist(method, value) {
    if (typeof this.persistence[method] === "function") this.persistence[method](value);
  }

  routeEvents(events = [], options = {}) {
    const matches = [];
    const duplicates = [];
    const subscriptionIdsByEvent = isPlainObject(
      options.subscriptionIdsByEvent,
    )
      ? options.subscriptionIdsByEvent
      : null;
    for (const event of events) {
      for (const subscription of this.subscriptions()) {
        const allowedSubscriptionIds = subscriptionIdsByEvent
          ? subscriptionIdsByEvent[
              text(event?.ledgerEventId || event?.eventId, "")
            ]
          : null;
        if (
          Array.isArray(allowedSubscriptionIds) &&
          !allowedSubscriptionIds.includes(subscriptionRef(subscription).id)
        ) {
          continue;
        }
        const match = matchSubscriptionToEvent(subscription, event, {
          now: options.now || this.now,
          materialityResolver: this.materialityResolver,
        });
        if (!match) continue;
        const key = coalescingKeyFor(match);
        const pending = this.pending.get(key) || {
          key,
          subscription,
          matches: [],
          openedAt: text(options.openedAt, nowIso(options.now || this.now)),
        };
        const duplicate = pending.matches.some((entry) => sameRefIdentity(entry.ledgerEventRef, match.ledgerEventRef, { exactRevision: true })) ||
          [...this.deliveries.values()].some((delivery) =>
            sameRefIdentity(delivery.subscriptionRef, match.subscriptionRef, { exactRevision: true }) &&
            delivery.eventRefs.some((ref) => sameRefIdentity(ref, match.ledgerEventRef, { exactRevision: true })));
        if (duplicate) {
          duplicates.push(match.ledgerEventRef);
          continue;
        }
        if (pending.matches.length >= subscription.operationalPolicy.maximumPendingEvents) {
          const notice = buildBackpressureNotice({
            subscriptionRef: match.subscriptionRef,
            pendingEventCount: pending.matches.length,
            queuedDeliveryCount: [...this.deliveries.values()].filter((delivery) => delivery.deliveryPosture === "queued").length,
          }, { now: options.now || this.now });
          this.backpressureNotices.push(notice);
          this._persist("persistBackpressureNotice", notice);
          continue;
        }
        pending.matches.push(match);
        pending.matches.sort((left, right) => left.globalSequence - right.globalSequence);
        this.pending.set(key, pending);
        matches.push(match);
      }
    }
    const flushed = this.flush({
      ...options,
      immediateOnly: options.flushAll !== true,
      force: options.flushAll === true,
    });
    this._persist("persistPendingState", [...this.pending.values()]);
    return {
      matches,
      deliveries: flushed.deliveries,
      duplicates,
      deferredMatchCount: [...this.pending.values()].reduce((sum, item) => sum + item.matches.length, 0),
      backpressureNotices: [...this.backpressureNotices],
    };
  }

  flush(options = {}) {
    const deliveries = [];
    const nowMs = Number(typeof (options.now || this.now) === "function" ? (options.now || this.now)() : (options.now || this.now)) || Date.now();
    for (const [key, pending] of [...this.pending.entries()]) {
      const subscription = pending.subscription;
      const policy = subscription.operationalPolicy;
      const age = Math.max(0, nowMs - Date.parse(pending.openedAt));
      const hasBypass = pending.matches.some((match) => match.bypassCoalescing);
      const immediate = subscription.deliveryPolicy === "immediate_delta" || hasBypass;
      const due = options.force || immediate || age >= policy.debounceWindowMs ||
        pending.matches.length >= policy.maximumEventsPerDelivery;
      if (!due || (options.immediateOnly && !immediate && pending.matches.length < policy.maximumEventsPerDelivery)) continue;
      const queuedCount = [...this.deliveries.values()].filter((delivery) =>
        delivery.deliveryPosture === "queued" &&
        delivery.subscriptionRef.id === subscriptionRef(subscription).id).length;
      if (queuedCount >= policy.maximumQueuedDeliveries) {
        const notice = buildBackpressureNotice({
          subscriptionRef: subscriptionRef(subscription),
          pendingEventCount: pending.matches.length,
          queuedDeliveryCount: queuedCount,
        }, { now: nowMs });
        this.backpressureNotices.push(notice);
        this._persist("persistBackpressureNotice", notice);
        continue;
      }
      const max = policy.maximumEventsPerDelivery;
      const consumed = pending.matches.slice(0, max);
      const selected = applySupersession(consumed, policy.supersessionBehavior);
      const consumedIds = new Set(consumed.map((match) => match.matchId));
      pending.matches = pending.matches.filter((match) => !consumedIds.has(match.matchId));
      if (!selected.length) {
        this.pending.delete(key);
        continue;
      }
      const cursor = this.cursorFor(subscription);
      const delivery = buildLedgerDeliveryEnvelope({
        subscription,
        matches: selected,
        cursorBefore: cursor.acknowledgedSequence,
      }, {
        now: nowMs,
        visibilityResolver: this.visibilityResolver,
        recipientResolver: this.recipientResolver,
      });
      const priorId = this.deliveryByIdempotencyKey.get(delivery.idempotencyKey);
      if (priorId) {
        deliveries.push(this.deliveries.get(priorId));
      } else {
        const lastWake = this.lastWakeAtBySubscription.get(delivery.subscriptionRef.id) || 0;
        if (delivery.wakeEligible && nowMs - lastWake < policy.maximumWakeFrequencyMs) {
          delivery.wakeEligible = false;
          delivery.wakeDeferredByStormControl = true;
          delivery.deliveryDigest = digestFor("direct-ledger-delivery-envelope@1", delivery);
        }
        this.deliveries.set(delivery.deliveryId, delivery);
        this.deliveryByIdempotencyKey.set(delivery.idempotencyKey, delivery.deliveryId);
        this._persist("commitOutbox", delivery);
        deliveries.push(delivery);
      }
      if (pending.matches.length) {
        pending.openedAt = nowIso(nowMs);
        this.pending.set(key, pending);
      } else {
        this.pending.delete(key);
      }
    }
    this._persist("persistPendingState", [...this.pending.values()]);
    return { deliveries };
  }

  markDelivered(deliveryId, input = {}) {
    const current = this.deliveries.get(text(deliveryId, ""));
    if (!current) fail("ledger_delivery_unknown", deliveryId);
    if (["acknowledged", "delivered"].includes(current.deliveryPosture)) return current;
    const delivery = {
      ...current,
      deliveryPosture: "delivered",
      attemptCount: current.attemptCount + 1,
      deliveredAt: text(input.deliveredAt, nowIso(input.now || this.now)),
    };
    delivery.deliveryDigest = digestFor("direct-ledger-delivery-envelope@1", delivery);
    validateLedgerDeliveryEnvelope(delivery);
    this.deliveries.set(delivery.deliveryId, delivery);
    if (delivery.wakeEligible) this.lastWakeAtBySubscription.set(delivery.subscriptionRef.id, Date.parse(delivery.deliveredAt));
    this._persist("persistDelivery", delivery);
    return delivery;
  }

  acknowledge(deliveryId, input = {}) {
    const delivery = this.deliveries.get(text(deliveryId, ""));
    if (!delivery) fail("ledger_delivery_unknown", deliveryId);
    const priorAck = this.acknowledgements.get(delivery.deliveryId);
    if (priorAck) return { state: "idempotent_replay", cursor: this.cursors.get(delivery.subscriptionRef.id), acknowledgement: priorAck };
    if (delivery.deliveryPosture === "acknowledged") {
      return {
        state: "idempotent_replay",
        cursor: this.cursors.get(delivery.subscriptionRef.id),
        acknowledgement: null,
      };
    }
    const result = acknowledgeLedgerDelivery(
      delivery,
      this.cursors.get(delivery.subscriptionRef.id),
      input,
      { now: input.now || this.now },
    );
    if (result.acknowledgement) {
      this.cursors.set(delivery.subscriptionRef.id, result.cursor);
      this.acknowledgements.set(delivery.deliveryId, result.acknowledgement);
      const acknowledged = {
        ...delivery,
        deliveryPosture: "acknowledged",
        acknowledgedAt: result.acknowledgement.acknowledgedAt,
      };
      acknowledged.deliveryDigest = digestFor("direct-ledger-delivery-envelope@1", acknowledged);
      this.deliveries.set(delivery.deliveryId, acknowledged);
      this._persist("persistCursorAndAck", {
        delivery: acknowledged,
        cursor: result.cursor,
        acknowledgement: result.acknowledgement,
      });
    }
    return result;
  }

  retryableDeliveries() {
    return [...this.deliveries.values()]
      .filter((delivery) => ["queued", "failed"].includes(delivery.deliveryPosture))
      .sort((left, right) => left.cursorAfter - right.cursorAfter);
  }

  snapshot() {
    const snapshot = {
      schema: DIRECT_LEDGER_SUBSCRIPTION_BROKER_SNAPSHOT_SCHEMA,
      standings: [...this.standings.values()],
      watches: [...this.watches.values()],
      pending: [...this.pending.values()],
      deliveries: [...this.deliveries.values()],
      cursors: [...this.cursors.values()],
      acknowledgements: [...this.acknowledgements.values()],
      backpressureNotices: [...this.backpressureNotices],
      lastWakeAtBySubscription: [
        ...this.lastWakeAtBySubscription.entries(),
      ].map(([subscriptionId, lastWakeAt]) => ({
        subscriptionId,
        lastWakeAt,
      })).sort((left, right) =>
        left.subscriptionId.localeCompare(right.subscriptionId)),
      deliverySemantics:
        "at_least_once_with_delivery_id_dedupe",
      acknowledgementSemantics:
        "monotonic_per_subscription_cursor",
      pollingRequired: false,
      rawPayloadIncluded: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
      createdAt: nowIso(this.now),
    };
    snapshot.snapshotDigest = digestFor(
      "direct-ledger-subscription-broker-snapshot@1",
      snapshot,
    );
    validateLedgerSubscriptionBrokerSnapshot(snapshot);
    return snapshot;
  }

  persistDurableSnapshot() {
    const snapshot = this.snapshot();
    this._persist("persistSnapshot", snapshot);
    return snapshot;
  }
}

function validateLedgerSubscriptionBrokerSnapshot(snapshot) {
  if (
    !isPlainObject(snapshot) ||
    snapshot.schema !==
      DIRECT_LEDGER_SUBSCRIPTION_BROKER_SNAPSHOT_SCHEMA
  ) {
    fail("ledger_subscription_snapshot_invalid");
  }
  for (const key of [
    "standings",
    "watches",
    "pending",
    "deliveries",
    "cursors",
    "acknowledgements",
    "backpressureNotices",
    "lastWakeAtBySubscription",
  ]) {
    if (!Array.isArray(snapshot[key])) {
      fail("ledger_subscription_snapshot_invalid", key);
    }
  }
  snapshot.standings.forEach(validateNotificationStanding);
  snapshot.watches.forEach(validateDiscretionaryLedgerWatch);
  snapshot.deliveries.forEach(validateLedgerDeliveryEnvelope);
  if (
    snapshot.deliverySemantics !==
      "at_least_once_with_delivery_id_dedupe" ||
    snapshot.acknowledgementSemantics !==
      "monotonic_per_subscription_cursor" ||
    snapshot.pollingRequired !== false
  ) {
    fail("ledger_subscription_snapshot_contract_invalid");
  }
  if (
    snapshot.rawPayloadIncluded ||
    snapshot.rawTextIncluded ||
    snapshot.rawPathIncluded ||
    snapshot.rawSecretIncluded
  ) {
    fail("ledger_subscription_raw_exposure", "snapshot");
  }
  if (
    snapshot.snapshotDigest !== digestFor(
      "direct-ledger-subscription-broker-snapshot@1",
      snapshot,
    )
  ) {
    fail("ledger_subscription_snapshot_digest_mismatch");
  }
  return true;
}

module.exports = {
  BROKER_PERSISTENCE_CONTRACT,
  DELIVERY_POLICIES,
  DELIVERY_POSTURES,
  DIRECT_DISCRETIONARY_LEDGER_WATCH_SCHEMA,
  DIRECT_LEDGER_BACKPRESSURE_NOTICE_SCHEMA,
  DIRECT_LEDGER_DELIVERY_ACK_SCHEMA,
  DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA,
  DIRECT_LEDGER_SUBSCRIPTION_CURSOR_SCHEMA,
  DIRECT_LEDGER_SUBSCRIPTION_BROKER_SNAPSHOT_SCHEMA,
  DIRECT_LEDGER_SUBSCRIPTION_MATCH_SCHEMA,
  DIRECT_NOTIFICATION_STANDING_SCHEMA,
  DirectLedgerSubscriptionBroker,
  MATERIALITY_ORDER,
  WAKE_POLICIES,
  acknowledgeLedgerDelivery,
  buildBackpressureNotice,
  buildDiscretionaryLedgerWatch,
  buildLedgerDeliveryEnvelope,
  buildNotificationStanding,
  buildSubscriptionCursor,
  matchSubscriptionToEvent,
  normalizeScope,
  scopeContains,
  subscriptionRef,
  validateDiscretionaryLedgerWatch,
  validateLedgerDeliveryEnvelope,
  validateLedgerSubscriptionBrokerSnapshot,
  validateNotificationStanding,
};
