#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_NATIVE_ACTIONS,
  LEGACY_COMPATIBILITY_MAPPINGS,
  SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA,
  buildSubAgentLifecycleCompatibilityPacket,
  validateSubAgentLifecycleCompatibilityPacket,
} = require("../src/main/direct/agents/sub-agent-lifecycle-compatibility");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const fixedNow = () => Date.UTC(2026, 5, 20, 12, 0, 0);

const packet = buildSubAgentLifecycleCompatibilityPacket({
  packetId: "sub_agent_lifecycle_compatibility_packet_pr97_fixture",
  projectId: "project_wave16_pr97_fixture",
  workThreadId: "work_thread_wave16_pr97_fixture",
  primaryThreadId: "primary_thread_wave16_pr97_fixture",
  parentThreadId: "primary_thread_wave16_pr97_fixture",
  agents: [
    {
      agentId: "agent_terminal_exact",
      childThreadId: "child_terminal_exact",
      lifecycleStatus: "completed",
      lifecycleEvidence: "exact",
      transportStatus: "provider_running",
      mailboxStatus: "closed",
      transcriptStatus: "full_history_available",
      usageStatus: "exact",
      resultStatus: "summary_admitted",
    },
    {
      agentId: "agent_provider_running",
      childThreadId: "child_provider_running",
      lifecycleStatus: "unknown",
      transportStatus: "provider_running",
      mailboxStatus: "ready",
      transcriptStatus: "turn_activity_available",
      usageStatus: "partial",
      resultStatus: "pending",
    },
    {
      agentId: "agent_stale",
      childThreadId: "child_stale",
      lifecycleStatus: "running",
      transportStatus: "unknown",
      stale: true,
      transcriptStatus: "full_history_available",
      usageStatus: "unavailable",
    },
    {
      agentId: "agent_not_found",
      childThreadId: "child_not_found",
      notFound: true,
      transportStatus: "provider_unsupported",
    },
    {
      agentId: "agent_handoff_unknown",
      childThreadId: "child_handoff_unknown",
      lifecycleStatus: "running",
      transportStatus: "provider_handoff_unknown",
      mailboxStatus: "delivery_unknown",
    },
    {
      agentId: "agent_lifecycle_handoff_unknown",
      childThreadId: "child_lifecycle_handoff_unknown",
      lifecycleStatus: "handoff_unknown",
      mailboxStatus: "delivery_unknown",
    },
  ],
}, { now: fixedNow });

assert.equal(packet.schema, SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA, "packet schema mismatch");
validateSubAgentLifecycleCompatibilityPacket(packet);
assert.equal(packet.providerTransportStarted, false, "PR97 must not start provider transport");
assert.equal(packet.lifecycleMutationStarted, false, "PR97 must not mutate lifecycle");
assert.equal(packet.transcriptInjectedIntoPrimary, false, "PR97 must not inject transcript into primary");

const stateByAgent = new Map(packet.stateModels.map((row) => [row.agentId, row]));
assert.equal(stateByAgent.get("agent_terminal_exact").lifecycleStatus, "completed", "terminal exact should outrank provider running");
assert.equal(stateByAgent.get("agent_terminal_exact").transcriptStatus, "full_history_available", "transcript axis should remain independent");
assert.equal(stateByAgent.get("agent_provider_running").lifecycleStatus, "running", "provider running should resolve running");
assert.equal(stateByAgent.get("agent_provider_running").mailboxStatus, "ready", "mailbox axis should be visible");
assert.equal(stateByAgent.get("agent_provider_running").usageStatus, "partial", "usage axis should be visible");
assert.equal(stateByAgent.get("agent_stale").lifecycleStatus, "stale", "stale projection should degrade lifecycle");
assert.equal(stateByAgent.get("agent_stale").conflictState, "stale_projection", "stale projection conflict should be explicit");
assert.equal(stateByAgent.get("agent_stale").controlPosture, "blocked", "stale agent should block mutating controls");
assert.equal(stateByAgent.get("agent_stale").targetActionPosture, "status_only", "stale agent should remain status-only");
assert.equal(stateByAgent.get("agent_not_found").lifecycleStatus, "not_found", "not_found should be canonical");
assert.equal(stateByAgent.get("agent_not_found").targetActionPosture, "target_actions_blocked", "not_found blocks target actions");
assert.equal(stateByAgent.get("agent_handoff_unknown").targetActionPosture, "target_actions_blocked", "handoff_unknown blocks target actions");
assert.equal(stateByAgent.get("agent_lifecycle_handoff_unknown").transportStatus, "provider_handoff_unknown", "lifecycle handoff_unknown should map to provider handoff");
assert.equal(stateByAgent.get("agent_lifecycle_handoff_unknown").targetActionPosture, "target_actions_blocked", "lifecycle handoff_unknown should block target actions");

const authorityRows = new Map(packet.authorityMatrix.rows.map((row) => [row.directNativeName, row]));
for (const action of DIRECT_NATIVE_ACTIONS) {
  const row = authorityRows.get(action);
  assert(row, `missing authority row ${action}`);
  assert.equal(row.compatibilitySourceAllowed, false, `${action} must not accept compatibility authority`);
  assert.equal(row.providerTransportAllowedInPr97, false, `${action} must not start provider transport in PR97`);
  assert.equal(row.lifecycleMutationAllowedInPr97, false, `${action} must not mutate lifecycle in PR97`);
}
assert.equal(authorityRows.get("send_message").authorityPosture, "blocked_until_pr100", "send_message should remain blocked until PR100");
assert.equal(authorityRows.get("resume_agent").authorityPosture, "operator_gated_future_pr101", "resume_agent should be future operator-gated");
for (const action of ["spawn_agent", "list_agents", "inspect_agent", "wait_agent"]) {
  assert.equal(authorityRows.get(action).residentCallable, true, `${action} should preserve Wave 15 resident-callable posture`);
}

const mapperRows = new Map(packet.compatibilityMapper.rows.map((row) => [row.legacyName, row]));
for (const [legacyName, directNativeName] of LEGACY_COMPATIBILITY_MAPPINGS) {
  const row = mapperRows.get(legacyName);
  assert(row, `missing compatibility row ${legacyName}`);
  assert.equal(row.directNativeName, directNativeName, `${legacyName} mapping mismatch`);
  assert.equal(row.compatibilityOnly, true, `${legacyName} must be compatibility-only`);
  assert.equal(row.sourceAuthority, "direct_native_row", `${legacyName} must use direct-native source authority`);
  assert.equal(row.authorityBypassAllowed, false, `${legacyName} must not bypass authority`);
}

const probes = new Map(packet.compatibilityBypassProbes.map((row) => [row.legacyName, row]));
for (const legacyName of ["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent"]) {
  const row = probes.get(legacyName);
  assert(row, `missing bypass probe ${legacyName}`);
  assert.equal(row.finalDecision, "requires_direct_native_authority", `${legacyName} should require direct-native authority`);
  assert.equal(row.grantsAuthority, false, `${legacyName} must not grant authority`);
  assert.equal(row.providerTransportStarted, false, `${legacyName} must not start provider transport`);
  assert.equal(row.lifecycleMutationStarted, false, `${legacyName} must not mutate lifecycle`);
}
assert.equal(probes.get("unknownLegacyAction").finalDecision, "blocked_compatibility_unknown", "unknown legacy action should block");

const serialized = JSON.stringify(packet);
assert(!serialized.includes("\"providerTransportStarted\":true"), "provider transport leak");
assert(!serialized.includes("\"lifecycleMutationStarted\":true"), "lifecycle mutation leak");
assert(!serialized.includes("\"transcriptInjectedIntoPrimary\":true"), "transcript injection leak");
assert(!serialized.includes("\"authorityBypassAllowed\":true"), "compatibility authority bypass leak");
assert(!serialized.includes("\"compatibilityOnly\":false"), "compatibility-only leak");

{
  const malformed = clone(packet);
  malformed.stateModels[2].controlPosture = "followup_allowed";
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "unsafe_control_posture:agent_stale");
}
{
  const malformed = clone(packet);
  malformed.compatibilityMapper.rows[0].authorityBypassAllowed = true;
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "compatibility_authority_bypass:spawnAgent");
}
{
  const malformed = clone(packet);
  malformed.authorityMatrix.rows.find((row) => row.directNativeName === "send_message").compatibilitySourceAllowed = true;
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "compatibility_source_authority_leak:send_message");
}
{
  const malformed = clone(packet);
  malformed.compatibilityBypassProbes.find((row) => row.legacyName === "sendInput").grantsAuthority = true;
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "compatibility_probe_grants_authority:sendInput");
}
{
  const malformed = clone(packet);
  malformed.providerTransportStarted = true;
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "packet_boundary_leak:providerTransportStarted");
}
{
  const malformed = clone(packet);
  malformed.stateModels[4].targetActionPosture = "read_only_available";
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "handoff_unknown_action_leak:agent_handoff_unknown");
}
{
  const malformed = clone(packet);
  malformed.stateModels = {};
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "state_models_missing");
}
{
  const malformed = clone(packet);
  malformed.authorityMatrix.rows = {};
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "authority_row_missing:spawn_agent");
}
{
  const malformed = clone(packet);
  malformed.compatibilityMapper.rows = {};
  expectThrows(() => validateSubAgentLifecycleCompatibilityPacket(malformed), "compatibility_mapper_rows_missing");
}
{
  const malformed = clone(packet);
  malformed.compatibilityBypassProbes = {};
  validateSubAgentLifecycleCompatibilityPacket(malformed);
}

console.log(JSON.stringify({
  ok: true,
  packetId: packet.packetId,
  stateRows: packet.stateModels.length,
  compatibilityRows: packet.compatibilityMapper.rows.length,
  authorityRows: packet.authorityMatrix.rows.length,
  packetDigest: packet.packetDigest,
}, null, 2));
