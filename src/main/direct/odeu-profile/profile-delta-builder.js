"use strict";

const NORMALIZED_EVENT_CAPABILITIES = Object.freeze({
  session_started: "event.normalized.session_started",
  message_delta: "event.normalized.message_delta",
  reasoning_delta: "event.normalized.reasoning_delta",
  tool_call_started: "event.normalized.tool_call_started",
  tool_call_delta: "event.normalized.tool_call_delta",
  tool_call_completed: "event.normalized.tool_call_completed",
  usage_delta: "event.normalized.usage_delta",
  response_completed: "event.normalized.response_completed",
  response_incomplete: "event.normalized.response_incomplete",
  response_failed: "event.normalized.response_failed",
  transport_error: "event.normalized.transport_error",
  auth_error: "event.normalized.auth_error",
  quota_error: "event.normalized.quota_error",
  aborted: "event.normalized.aborted",
});

function unique(values) {
  return [...new Set(values)];
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function buildFixtureProfileDelta(input = {}) {
  const fixtureId = input.fixtureId || "inline-fixture";
  const normalizedEvents = Array.isArray(input.normalizedEvents) ? input.normalizedEvents : [];
  const normalizedTypes = normalizedEvents.map((event) => event.type).filter(Boolean);
  const rawTypes = normalizedEvents.map((event) => event.source?.rawType).filter(Boolean);
  const unknownRawTypes = Array.isArray(input.unknownRawTypes) ? input.unknownRawTypes : [];

  const capabilities = unique(normalizedTypes)
    .sort()
    .map((eventType) => ({
      capabilityId: NORMALIZED_EVENT_CAPABILITIES[eventType] || `event.normalized.${eventType}`,
      eventType,
      proposedState: "probed",
      evidence: {
        fixtureId,
        eventCount: countBy(normalizedTypes)[eventType],
      },
    }));

  return {
    schema: "direct_codex_profile_delta@1",
    source: "fixture",
    fixtureId,
    generatedAt: new Date().toISOString(),
    normalizedEventCounts: countBy(normalizedTypes),
    rawEventTypes: unique(rawTypes).sort(),
    unknownRawTypes: unique(unknownRawTypes).sort(),
    proposedCapabilities: capabilities,
    acceptance: unknownRawTypes.length ? "needs-review" : "candidate",
  };
}

module.exports = {
  NORMALIZED_EVENT_CAPABILITIES,
  buildFixtureProfileDelta,
};
