"use strict";

const { digestFor, text } = require("./kernel");
const { typedEventClass } = require("./thread-transcriber");

const DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA = "direct_live_activity_projection@1";
const LIVE_ACTIVITY_RECORD_TYPES = new Set([
  "ProviderResponseStarted",
  "AgentUtteranceFragment",
  "AgentReasoningFragment",
  "ToolInvocation",
  "UsageObservation",
  "TurnOutcome",
  "UnclassifiedNormalizedEvent",
  "ToolResult",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function selectedTurn(sessionStore, session, requestedTurnId = "") {
  const turnIds = [...new Set([
    ...(Array.isArray(session?.turns) ? session.turns.map((turn) => turn?.turnId) : []),
    ...(sessionStore.listTurnIdsFromDisk?.(session.sessionId) || []),
  ].filter(Boolean))];
  const turnId = text(requestedTurnId, turnIds[turnIds.length - 1]);
  return turnId ? sessionStore.readTurn(session.sessionId, turnId) : null;
}

function typedCounts(events = [], toolResults = []) {
  const counts = {};
  for (const event of Array.isArray(events) ? events : []) {
    const eventClass = typedEventClass(event);
    counts[eventClass.recordType] = Number(counts[eventClass.recordType] || 0) + 1;
  }
  if (Array.isArray(toolResults) && toolResults.length) {
    counts.ToolResult = Number(counts.ToolResult || 0) + toolResults.length;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertSafeLiveActivityProjection(projection = {}) {
  if (projection.schema !== DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA) {
    fail("direct_live_activity_projection_schema_invalid");
  }
  const forbiddenKeys = new Set([
    "text",
    "prompt",
    "arguments",
    "argumentsjson",
    "argumentsdelta",
    "providerframe",
    "providerpayload",
    "nativeroot",
    "worktreepath",
    "repositorypath",
    "localpath",
    "linuxpath",
    "windowspath",
    "contextbody",
  ]);
  const absolutePathShaped = (value) => {
    const candidate = String(value || "");
    return /(?:^|[\s"'`(=])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/.test(candidate) ||
      /(?:^|[\s"'`(=])[A-Za-z]:[\\/][^\s"']+/.test(candidate) ||
      /(?:^|[\s"'`(=])\\\\[^\\\s]+\\[^\s"']+/.test(candidate) ||
      /file:\/\//i.test(candidate);
  };
  const inspect = (value) => {
    if (typeof value === "string") {
      if (absolutePathShaped(value)) fail("direct_live_activity_projection_path_value_present");
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) inspect(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) fail("direct_live_activity_projection_raw_field_present");
      inspect(entry);
    }
  };
  const exactKeys = (value, keys, code) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    const expected = new Set(keys);
    if (
      Object.keys(value).length !== expected.size ||
      Object.keys(value).some((key) => !expected.has(key))
    ) fail(code);
  };
  const safeToken = (value, maxLength = 200, allowEmpty = false) => {
    const candidate = String(value || "");
    return (allowEmpty || candidate.length > 0) &&
      candidate.length <= maxLength &&
      /^[A-Za-z0-9_.:-]*$/.test(candidate);
  };
  const safeDigest = (value, allowEmpty = true) => {
    const candidate = String(value || "");
    return (allowEmpty && !candidate) || /^[a-f0-9]{64}$/.test(candidate);
  };
  const nonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
  exactKeys(projection, [
    "schema",
    "projectId",
    "sessionId",
    "turnId",
    "actorKind",
    "state",
    "terminal",
    "activityCursor",
    "eventCursor",
    "typedRecordCounts",
    "latestTypedClass",
    "capture",
    "deterministicProjection",
    "safety",
    "authority",
    "projectionDigest",
  ], "direct_live_activity_projection_fields_invalid");
  if (
    !safeToken(projection.projectId) ||
    !safeToken(projection.sessionId, 121) ||
    !safeToken(projection.turnId, 121) ||
    !safeToken(projection.actorKind) ||
    !safeToken(projection.state) ||
    typeof projection.terminal !== "boolean" ||
    !safeDigest(projection.activityCursor, false) ||
    !safeToken(projection.latestTypedClass, 80, true) ||
    (projection.latestTypedClass && !LIVE_ACTIVITY_RECORD_TYPES.has(projection.latestTypedClass))
  ) fail("direct_live_activity_projection_identity_invalid");
  exactKeys(projection.eventCursor, [
    "persistedEventCount",
    "lastPersistedIndex",
    "lastSourceEnvelopeDigest",
  ], "direct_live_activity_projection_event_cursor_invalid");
  if (
    !nonnegativeInteger(projection.eventCursor.persistedEventCount) ||
    !Number.isInteger(projection.eventCursor.lastPersistedIndex) ||
    projection.eventCursor.lastPersistedIndex < -1 ||
    projection.eventCursor.lastPersistedIndex !== projection.eventCursor.persistedEventCount - 1 ||
    !safeDigest(projection.eventCursor.lastSourceEnvelopeDigest)
  ) fail("direct_live_activity_projection_event_cursor_invalid");
  if (!projection.typedRecordCounts ||
    typeof projection.typedRecordCounts !== "object" ||
    Array.isArray(projection.typedRecordCounts)) {
    fail("direct_live_activity_projection_typed_counts_invalid");
  }
  if (Object.entries(projection.typedRecordCounts).some(([key, count]) =>
    !LIVE_ACTIVITY_RECORD_TYPES.has(key) || !nonnegativeInteger(count))) {
    fail("direct_live_activity_projection_typed_counts_invalid");
  }
  exactKeys(projection.capture, [
    "status",
    "complete",
    "eventCount",
    "toolResultCount",
    "eventPrefixDigest",
    "finalCaptureDigest",
    "gapReceiptRefs",
  ], "direct_live_activity_projection_capture_invalid");
  if (
    !safeToken(projection.capture.status, 80) ||
    typeof projection.capture.complete !== "boolean" ||
    !nonnegativeInteger(projection.capture.eventCount) ||
    !nonnegativeInteger(projection.capture.toolResultCount) ||
    !safeDigest(projection.capture.eventPrefixDigest) ||
    !safeDigest(projection.capture.finalCaptureDigest) ||
    !Array.isArray(projection.capture.gapReceiptRefs) ||
    projection.capture.gapReceiptRefs.length > 128
  ) fail("direct_live_activity_projection_capture_invalid");
  for (const ref of projection.capture.gapReceiptRefs) {
    exactKeys(ref, ["kind", "id", "digest"], "direct_live_activity_projection_gap_ref_invalid");
    if (
      ref.kind !== "direct_turn_capture_gap" ||
      !safeToken(ref.id, 160) ||
      !safeDigest(ref.digest, false)
    ) fail("direct_live_activity_projection_gap_ref_invalid");
  }
  exactKeys(projection.deterministicProjection, [
    "status",
    "cursorDigest",
    "sourceDigest",
    "oRevisionId",
    "eRevisionId",
    "epistemicPromotion",
  ], "direct_live_activity_projection_deterministic_invalid");
  if (
    !new Set(["current", "catch_up_pending", "indexed_cursor_available"]).has(projection.deterministicProjection.status) ||
    !safeDigest(projection.deterministicProjection.cursorDigest) ||
    !safeDigest(projection.deterministicProjection.sourceDigest) ||
    !safeToken(projection.deterministicProjection.oRevisionId, 200, true) ||
    !safeToken(projection.deterministicProjection.eRevisionId, 200, true) ||
    projection.deterministicProjection.epistemicPromotion !== false
  ) fail("direct_live_activity_projection_deterministic_invalid");
  exactKeys(projection.safety, [
    "rawPartialProseIncluded",
    "rawArgumentsIncluded",
    "rawNativePathIncluded",
    "rawProviderFrameIncluded",
    "rawContextIncluded",
    "usableForContextBuild",
    "composerAuthority",
  ], "direct_live_activity_projection_safety_invalid");
  exactKeys(projection.authority, [
    "posture",
    "activeCommunicationDirection",
    "grantsControl",
    "grantsContextAuthority",
    "grantsEpistemicPromotion",
    "grantsCanonicalStanding",
  ], "direct_live_activity_projection_authority_invalid");
  inspect(projection);
  if (
    projection.safety?.rawPartialProseIncluded !== false ||
    projection.safety?.rawArgumentsIncluded !== false ||
    projection.safety?.rawNativePathIncluded !== false ||
    projection.safety?.rawProviderFrameIncluded !== false ||
    projection.safety?.usableForContextBuild !== false ||
    projection.authority?.grantsControl !== false ||
    projection.authority?.grantsContextAuthority !== false ||
    projection.authority?.grantsEpistemicPromotion !== false ||
    projection.safety?.rawContextIncluded !== false ||
    projection.safety?.composerAuthority !== false
  ) fail("direct_live_activity_projection_safety_invalid");
  if (
    projection.authority.posture !== "passive_read_model" ||
    projection.authority.activeCommunicationDirection !== "top_down_only" ||
    projection.authority.grantsCanonicalStanding !== false
  ) fail("direct_live_activity_projection_authority_invalid");
  const { projectionDigest, ...projectionCore } = projection;
  if (
    !safeDigest(projectionDigest, false) ||
    projectionDigest !== digestFor({
      kind: DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA,
      ...projectionCore,
    })
  ) fail("direct_live_activity_projection_digest_invalid");
  return projection;
}

function buildLiveActivityProjection(input = {}) {
  const { sessionStore, epistemicStore } = input;
  if (!sessionStore) fail("direct_live_activity_projection_session_store_required");
  const session = sessionStore.readSession(text(input.sessionId));
  if (!session) fail("direct_live_activity_projection_session_missing");
  const turn = selectedTurn(sessionStore, session, input.turnId);
  if (!turn) fail("direct_live_activity_projection_turn_missing");
  const events = sessionStore.readNormalizedEvents(session.sessionId, turn.turnId);
  const counts = typedCounts(events, turn.toolResults);
  const lastEvent = events[events.length - 1] || null;
  const lastClass = lastEvent ? typedEventClass(lastEvent).recordType : "";
  const capture = turn.capture || {};
  const epistemicCursor = epistemicStore?.readThreadProjectionCursor?.(session.sessionId) || null;
  const currentSourceDigest = text(input.currentSourceDigest);
  const cursorCore = {
    sessionId: session.sessionId,
    turnId: turn.turnId,
    turnState: text(turn.state, "unknown"),
    persistedEventCount: events.length,
    persistedToolResultCount: Array.isArray(turn.toolResults) ? turn.toolResults.length : 0,
    lastSourceEnvelopeDigest: text(lastEvent?.sourceEnvelopeDigest),
    captureStatus: text(capture.status, "unmanaged"),
    captureComplete: capture.complete === true,
    typedCounts: counts,
  };
  const activityCursor = digestFor({ kind: "direct_live_activity_cursor", ...cursorCore });
  const projection = {
    schema: DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA,
    projectId: text(session.projectId),
    sessionId: session.sessionId,
    turnId: turn.turnId,
    actorKind: text(turn.agentKind || session.agentKind, "unknown"),
    state: cursorCore.turnState,
    terminal: [
      "completed",
      "failed",
      "aborted",
      "response_incomplete",
      "content_filter_terminal",
      "max_output_terminal",
      "empty_output_terminal",
    ].includes(cursorCore.turnState),
    activityCursor,
    eventCursor: {
      persistedEventCount: cursorCore.persistedEventCount,
      lastPersistedIndex: events.length ? events.length - 1 : -1,
      lastSourceEnvelopeDigest: cursorCore.lastSourceEnvelopeDigest,
    },
    typedRecordCounts: counts,
    latestTypedClass: lastClass,
    capture: {
      status: cursorCore.captureStatus,
      complete: cursorCore.captureComplete,
      eventCount: Number(capture.eventCount || cursorCore.persistedEventCount),
      toolResultCount: Number(capture.toolResultCount || cursorCore.persistedToolResultCount),
      eventPrefixDigest: text(capture.eventPrefixDigest),
      finalCaptureDigest: text(capture.finalCaptureDigest),
      gapReceiptRefs: (Array.isArray(capture.gapReceipts) ? capture.gapReceipts : []).map((gap) => ({
        kind: "direct_turn_capture_gap",
        id: text(gap?.gapReceiptId),
        digest: text(gap?.receiptDigest),
      })).filter((ref) => ref.id && ref.digest),
    },
    deterministicProjection: epistemicCursor ? {
      status: currentSourceDigest
        ? epistemicCursor.sourceDigest === currentSourceDigest ? "current" : "catch_up_pending"
        : "indexed_cursor_available",
      cursorDigest: text(epistemicCursor.cursorDigest),
      sourceDigest: text(epistemicCursor.sourceDigest),
      oRevisionId: text(epistemicCursor.oRevisionId),
      eRevisionId: text(epistemicCursor.eRevisionId),
      epistemicPromotion: false,
    } : {
      status: "catch_up_pending",
      cursorDigest: "",
      sourceDigest: "",
      oRevisionId: "",
      eRevisionId: "",
      epistemicPromotion: false,
    },
    safety: {
      rawPartialProseIncluded: false,
      rawArgumentsIncluded: false,
      rawNativePathIncluded: false,
      rawProviderFrameIncluded: false,
      rawContextIncluded: false,
      usableForContextBuild: false,
      composerAuthority: false,
    },
    authority: {
      posture: "passive_read_model",
      activeCommunicationDirection: "top_down_only",
      grantsControl: false,
      grantsContextAuthority: false,
      grantsEpistemicPromotion: false,
      grantsCanonicalStanding: false,
    },
  };
  projection.projectionDigest = digestFor({
    kind: DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA,
    ...projection,
  });
  return assertSafeLiveActivityProjection(projection);
}

module.exports = {
  DIRECT_LIVE_ACTIVITY_PROJECTION_SCHEMA,
  assertSafeLiveActivityProjection,
  buildLiveActivityProjection,
  typedCounts,
};
