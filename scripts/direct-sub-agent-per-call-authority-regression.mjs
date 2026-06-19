#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA,
  SUB_AGENT_SPAWN_IDEMPOTENCY_LEDGER_SCHEMA,
  SUB_AGENT_SPAWN_PLAN_SCHEMA,
  SUB_AGENT_WAIT_PLAN_SCHEMA,
  buildSubAgentPerCallAuthorityPacket,
  validateSubAgentPerCallAuthorityPacket,
} = require("../src/main/direct/agents/sub-agent-call-authority");
const {
  buildSubAgentCapabilityProfile,
} = require("../src/main/direct/agents/sub-agent-capability-profile");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const fixedNow = () => Date.UTC(2026, 5, 20, 9, 0, 0);
const projectId = "project_wave15_pr93_fixture";
const workThreadId = "work_thread_wave15_pr93_fixture";
const parentThreadId = "thread_wave15_pr93_parent";
const parentTurnId = "turn_wave15_pr93_parent";

const profile = buildSubAgentCapabilityProfile({
  projectId,
  workThreadId,
  profileId: "sub_agent_capability_profile_wave15_pr93_fixture",
}, { now: fixedNow });

const common = {
  projectId,
  workThreadId,
  parentThreadId,
  parentTurnId,
  profile,
};

const spawn = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "spawn_agent",
  callId: "call_spawn_agent_fixture",
  arguments: {
    task: "Summarize the fixture evidence without writing files.",
    agentRole: "summarizer",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    noInterferencePolicy: "observe_only",
    idempotencyKey: "spawn_fixture_key",
  },
}, { now: fixedNow });

assert(spawn.schema === SUB_AGENT_PER_CALL_AUTHORITY_PACKET_SCHEMA, "spawn packet schema mismatch");
assert(spawn.spawnPlan.schema === SUB_AGENT_SPAWN_PLAN_SCHEMA, "spawn plan schema mismatch");
assert(spawn.idempotencyLedgerRow.schema === SUB_AGENT_SPAWN_IDEMPOTENCY_LEDGER_SCHEMA, "idempotency ledger schema mismatch");
assert(spawn.spawnPlan.accepted === true, "spawn should be accepted by argument policy");
assert(spawn.spawnPlan.childToolsEnabled === false, "spawn must not enable child tools");
assert(spawn.spawnPlan.recursiveSpawnEnabled === false, "spawn must not enable recursion");
assert(spawn.spawnPlan.inheritedParentAuthority === false, "spawn must not inherit parent authority");
assert(spawn.spawnPlan.perCallAuthorityDecisionId === spawn.authorityDecision.authorityDecisionId, "spawn plan must cite authority decision");
assert(spawn.authorityDecision.finalDecision === "shadow_only", "PR93 accepted spawn should remain shadow-only before resident declaration");
assert(spawn.transaction.lifecycle === "planned", "accepted PR93 spawn should remain planned");
assert(spawn.transaction.replayAllowed === false, "PR93 transaction should not replay execution");
assert(spawn.providerTransportStarted === false, "spawn must not start provider transport");
assert(spawn.executorStarted === false, "spawn must not start executor");
assert(spawn.childProviderRunStarted === false, "spawn must not start child provider run");
assert(spawn.rawTaskIncluded === false, "spawn must not include raw task as payload");
validateSubAgentPerCallAuthorityPacket(spawn);

const duplicateSpawn = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "spawn_agent",
  callId: "call_spawn_agent_duplicate_fixture",
  existingIdempotencyLedger: [{
    idempotencyKey: "spawn_fixture_key",
    canonicalInputDigest: spawn.idempotencyLedgerRow.canonicalInputDigest,
    childAgentId: "child_existing_fixture",
  }],
  arguments: {
    task: "Summarize the fixture evidence without writing files.",
    agentRole: "summarizer",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    noInterferencePolicy: "observe_only",
    idempotencyKey: "spawn_fixture_key",
  },
}, { now: fixedNow });
assert(duplicateSpawn.idempotencyLedgerRow.status === "duplicate_same_input", "same idempotency input should suppress duplicate");
assert(duplicateSpawn.idempotencyLedgerRow.duplicateSuppressed === true, "duplicate should be marked suppressed");
assert(duplicateSpawn.spawnPlan.accepted === true, "same-input duplicate remains accepted as existing child identity");

const conflictSpawn = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "spawn_agent",
  callId: "call_spawn_agent_conflict_fixture",
  existingIdempotencyLedger: [{
    idempotencyKey: "spawn_fixture_key",
    canonicalInputDigest: spawn.idempotencyLedgerRow.canonicalInputDigest,
    childAgentId: "child_existing_fixture",
  }],
  arguments: {
    task: "A different task under the same key must not spawn.",
    agentRole: "summarizer",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    noInterferencePolicy: "observe_only",
    idempotencyKey: "spawn_fixture_key",
  },
}, { now: fixedNow });
assert(conflictSpawn.idempotencyLedgerRow.status === "idempotency_conflict", "different input under same key should conflict");
assert(conflictSpawn.authorityDecision.finalDecision === "block", "idempotency conflict must block authority");
assert(conflictSpawn.transaction.lifecycle === "authority_blocked", "idempotency conflict must create blocked transaction");

const badRoleSpawn = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "spawn_agent",
  callId: "call_spawn_agent_bad_role_fixture",
  arguments: {
    task: "Try to spawn with an unknown role.",
    agentRole: "god_agent",
    model: "gpt-5.5",
    reasoningEffort: "medium",
  },
}, { now: fixedNow });
assert(badRoleSpawn.spawnPlan.blockers.includes("unknown_agent_role"), "unknown role should block");
assert(badRoleSpawn.authorityDecision.finalDecision === "block", "unknown role should block authority");

const badModelSpawn = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "spawn_agent",
  callId: "call_spawn_agent_bad_model_fixture",
  allowedModels: ["gpt-5.4-mini"],
  arguments: {
    task: "Try to spawn with a disallowed model.",
    agentRole: "child_worker",
    model: "gpt-5.5",
    reasoningEffort: "medium",
  },
}, { now: fixedNow });
assert(badModelSpawn.spawnPlan.blockers.includes("model_not_allowed"), "disallowed model should block");

const list = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "list_agents",
  callId: "call_list_agents_fixture",
  arguments: {},
}, { now: fixedNow });
assert(list.authorityDecision.finalDecision === "shadow_only", "list remains shadow-only in PR93");
assert(list.transaction.lifecycle === "planned", "list should create planned transaction");

const agents = [
  {
    agentThreadId: "child_running_fixture",
    workThreadId,
    parentThreadId,
    lifecycleState: "running",
    ancestors: [],
  },
  {
    agentThreadId: "child_stale_fixture",
    workThreadId,
    parentThreadId,
    lifecycleState: "running",
    stale: true,
  },
  {
    agentThreadId: "child_wrong_workthread_fixture",
    workThreadId: "other_work_thread",
    parentThreadId,
    lifecycleState: "running",
  },
  {
    agentThreadId: "child_cycle_fixture",
    workThreadId,
    parentThreadId,
    lifecycleState: "running",
    ancestors: [parentThreadId],
  },
];

const inspect = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "inspect_agent",
  callId: "call_inspect_agent_fixture",
  agents,
  arguments: {
    agentThreadId: "child_running_fixture",
  },
}, { now: fixedNow });
assert(inspect.authorityDecision.finalDecision === "shadow_only", "valid inspect remains shadow-only");
assert(inspect.transaction.lifecycle === "planned", "valid inspect creates planned transaction");

const missingInspect = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "inspect_agent",
  callId: "call_inspect_missing_fixture",
  agents,
  arguments: {
    agentThreadId: "missing_child",
  },
}, { now: fixedNow });
assert(missingInspect.authorityDecision.argumentValidation.blockers.includes("child_missing"), "inspect missing child should block");
assert(missingInspect.transaction.lifecycle === "authority_blocked", "missing inspect should be authority blocked");

const wrongWorkThreadInspect = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "inspect_agent",
  callId: "call_inspect_wrong_workthread_fixture",
  agents,
  arguments: {
    agentThreadId: "child_wrong_workthread_fixture",
  },
}, { now: fixedNow });
assert(wrongWorkThreadInspect.authorityDecision.argumentValidation.blockers.includes("child_wrong_work_thread"), "wrong work-thread child should block");

const wait = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "wait_agent",
  callId: "call_wait_agent_fixture",
  agents,
  arguments: {
    agentThreadId: "child_running_fixture",
    timeoutMs: 30000,
    maxWaitDepth: 1,
  },
}, { now: fixedNow });
assert(wait.waitPlan.schema === SUB_AGENT_WAIT_PLAN_SCHEMA, "wait plan schema mismatch");
assert(wait.waitPlan.cycleCheck === "passed", "wait cycle check should pass");
assert(wait.waitPlan.replayAllowed === false, "wait replay must be false");
assert(wait.waitPlan.lifecycle === "planned", "running target should produce planned wait");
assert(wait.authorityDecision.finalDecision === "shadow_only", "valid wait remains shadow-only");

const staleWait = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "wait_agent",
  callId: "call_wait_stale_fixture",
  agents,
  arguments: {
    agentThreadId: "child_stale_fixture",
    timeoutMs: 30000,
    maxWaitDepth: 1,
  },
}, { now: fixedNow });
assert(staleWait.waitPlan.blockers.includes("child_stale"), "stale child should block wait");
assert(staleWait.transaction.lifecycle === "authority_blocked", "stale wait should be blocked");

const cycleWait = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "wait_agent",
  callId: "call_wait_cycle_fixture",
  agents,
  arguments: {
    agentThreadId: "child_cycle_fixture",
    timeoutMs: 30000,
    maxWaitDepth: 1,
  },
}, { now: fixedNow });
assert(cycleWait.waitPlan.cycleCheck === "failed", "ancestor cycle should fail");
assert(cycleWait.waitPlan.blockers.includes("wait_cycle_ancestor"), "ancestor cycle blocker missing");
assert(cycleWait.authorityDecision.finalDecision === "block", "cycle wait should block authority");

const timeoutWait = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "wait_agent",
  callId: "call_wait_timeout_fixture",
  agents,
  arguments: {
    agentThreadId: "child_running_fixture",
    timeoutMs: 999999,
    maxWaitDepth: 1,
  },
}, { now: fixedNow });
assert(timeoutWait.waitPlan.blockers.includes("invalid_timeout"), "oversized timeout should block");

const unsupported = buildSubAgentPerCallAuthorityPacket({
  ...common,
  toolName: "send_message",
  callId: "call_send_message_fixture",
  arguments: {
    agentThreadId: "child_running_fixture",
    text: "not allowed in PR93",
  },
}, { now: fixedNow });
assert(unsupported.authorityDecision.argumentValidation.blockers.includes("tool_not_in_first_slice"), "deferred control should block");
assert(unsupported.authorityDecision.finalDecision === "block", "deferred control should block authority");

expectThrows(() => validateSubAgentPerCallAuthorityPacket({
  ...spawn,
  executorStarted: true,
}), "sub_agent_per_call_authority_boundary_leak:executorStarted");
expectThrows(() => validateSubAgentPerCallAuthorityPacket({
  ...spawn,
  providerTransportStarted: true,
}), "sub_agent_per_call_authority_boundary_leak:providerTransportStarted");

const serialized = JSON.stringify({ spawn, duplicateSpawn, conflictSpawn, wait, unsupported });
assert(!serialized.includes("\"providerTransportStarted\":true"), "provider transport must not start");
assert(!serialized.includes("\"executorStarted\":true"), "executor must not start");
assert(!serialized.includes("\"workspaceMutationStarted\":true"), "workspace mutation must not start");
assert(!serialized.includes("\"rawTaskIncluded\":true"), "raw task must not be included");
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt must not be included");
assert(!serialized.includes("\"rawTranscriptIncluded\":true"), "raw transcript must not be included");
assert(!serialized.includes("\"rawProviderPayloadIncluded\":true"), "raw provider payload must not be included");

console.log(JSON.stringify({
  ok: true,
  spawnFinalDecision: spawn.authorityDecision.finalDecision,
  conflictFinalDecision: conflictSpawn.authorityDecision.finalDecision,
  waitLifecycle: wait.waitPlan.lifecycle,
  blockedWaitLifecycle: cycleWait.transaction.lifecycle,
  spawnPacketDigest: spawn.packetDigest.value,
}, null, 2));
