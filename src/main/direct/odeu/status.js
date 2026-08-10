"use strict";

const ODEU_LIVE_CAPABILITY_KERNEL_VERSION = "odeu_live_capability_kernel@1";

const ODEU_OBJECT_STATUSES = Object.freeze([
  "valid",
  "blocked",
  "stale",
  "corrupt",
  "partial",
  "diagnostic_only",
  "superseded",
  "unknown",
]);

const ODEU_SOURCE_CONFIDENCE_VALUES = Object.freeze([
  "exact",
  "provider_reported",
  "runtime_probed",
  "accepted_profile",
  "derived",
  "diagnostic",
  "fixture",
  "unknown",
]);

const ODEU_FRESHNESS_VALUES = Object.freeze([
  "fresh",
  "expiring",
  "stale",
  "unknown",
]);

const ODEU_SOURCE_KINDS = Object.freeze([
  "operation_ledger",
  "request_manifest",
  "context_pack",
  "provider_response",
  "provider_stream_event",
  "tool_call",
  "tool_result",
  "activation_registry",
  "promotion_decision",
  "resident_snapshot",
  "workspace_effect",
  "sub_agent_graph",
  "mcp_server",
  "hosted_provider_tool",
  "code_session",
  "quota_snapshot",
  "legacy_adapter",
  "family_specific",
]);

const ODEU_SCAN_SCOPES = Object.freeze([
  "artifact",
  "renderer_projection",
  "provider_envelope",
  "report",
  "context_item",
  "operator_ui",
  "resident_witness",
]);

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

module.exports = {
  ODEU_FRESHNESS_VALUES,
  ODEU_LIVE_CAPABILITY_KERNEL_VERSION,
  ODEU_OBJECT_STATUSES,
  ODEU_SCAN_SCOPES,
  ODEU_SOURCE_CONFIDENCE_VALUES,
  ODEU_SOURCE_KINDS,
  pickEnum,
};
