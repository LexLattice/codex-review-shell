#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_LIVE_SUB_AGENT_TOOL_RESULT_SCHEMA,
  DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA,
  assertDirectLiveSubAgentToolSurfaceSafe,
  createDirectLiveSubAgentToolSurface,
} = require("../src/main/direct/agents/live-tool-surface");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../src/main/direct/bridge/tool-capability-registry");

const surface = createDirectLiveSubAgentToolSurface({
  projectId: "project_live_sub_agent_fixture",
  workThreadId: "work_thread_live_sub_agent_fixture",
  primaryThreadId: "primary_live_sub_agent_fixture",
  defaultModel: "gpt-5.5",
  defaultReasoningEffort: "medium",
  nowMs: 0,
});

const initial = surface.snapshot();
assert.equal(initial.schema, DIRECT_LIVE_SUB_AGENT_TOOL_SURFACE_SCHEMA, "live surface schema mismatch");
assert.equal(initial.agentCount, 0, "fixture should start with no sub-agents");
assert.equal(initial.providerTransportAllowed, false, "live sub-agent surface must not start provider transport directly");
assert.equal(initial.providerDeclarationAllowed, false, "live sub-agent surface must not declare provider tools by itself");
assert.equal(initial.childTranscriptPromotionAllowed, false, "child transcript must not be promoted into primary transcript");
assert(initial.toolNames.includes("inspect_agent"), "live surface should expose inspect_agent affordance");
assertDirectLiveSubAgentToolSurfaceSafe(initial);

const normalSpawn = surface.spawnAgent({
  childAgentId: "agent_normal_control",
  displayLabel: "Normal controlled worker",
  role: "worker",
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  prompt: "Inspect this bounded packet and report a short finding.",
});
assert.equal(normalSpawn.schema, DIRECT_LIVE_SUB_AGENT_TOOL_RESULT_SCHEMA, "spawn result schema mismatch");
assert.equal(normalSpawn.status, "completed", "normal spawn should complete");
assert.equal(normalSpawn.providerTransportStarted, false, "spawn should not start provider transport directly");
assert.equal(normalSpawn.result.agent.parentSelfBindingEnforced, false, "normal spawn should not self-bind no-interference");
assert.equal(normalSpawn.result.agent.model, "gpt-5.4-mini", "spawn should preserve agent model");
assert.equal(normalSpawn.result.agent.reasoningEffort, "medium", "spawn should preserve agent effort");
assert(normalSpawn.result.liveToolCatalog.callableToolIds.includes("vanilla.agent.send_message"), "normal target should keep send_message callable");

const listAfterNormal = surface.listAgents();
assert.equal(listAfterNormal.status, "completed", "list_agents should complete");
assert.equal(listAfterNormal.result.listProjection.rowCount, 1, "list should include normal child");
assert.equal(listAfterNormal.result.listProjection.rows[0].model, "gpt-5.4-mini", "list should preserve model");

const sendNormal = surface.sendMessage({
  targetAgentId: "agent_normal_control",
  text: "Add one more bounded check.",
});
assert.equal(sendNormal.status, "completed", "send_message should work for normally controlled child");
assert.equal(sendNormal.result.writeAccepted, true, "send_message should append mailbox event");
assert.equal(sendNormal.result.mailbox.messageCount, 2, "mailbox should include spawn and send");
assert.equal(sendNormal.result.mailbox.rawPayloadIncluded, false, "mailbox must not expose raw payload");

const inspectNormal = surface.inspectAgent({ targetAgentId: "agent_normal_control" });
assert.equal(inspectNormal.status, "completed", "inspect_agent should complete");
assert.equal(inspectNormal.result.inspectPacket.readOnly, true, "inspect packet must be read-only");
assert.equal(inspectNormal.result.inspectPacket.sendInputAllowed, false, "inspect packet must not itself grant send authority");
assert.equal(inspectNormal.result.inspectPacket.agent.model, "gpt-5.4-mini", "inspect should preserve model");
assert.equal(inspectNormal.result.inspectPacket.agent.reasoningEffort, "medium", "inspect should preserve effort");
assert.equal(inspectNormal.result.eChannelSnapshot.controlAuthorityGranted, false, "E-channel must not grant control authority");

const waitNormal = surface.waitAgent({ targetAgentId: "agent_normal_control", timeoutMs: 1000 });
assert.equal(waitNormal.status, "completed", "wait_agent should complete as bounded status read");
assert.equal(waitNormal.result.waitPlan.noDeadlockLawSatisfied, true, "wait should satisfy no-deadlock law");
assert.equal(waitNormal.result.waitStatus.providerTransportAllowed, false, "wait status must not start provider transport");

const sealedSpawn = surface.spawnAgent({
  childAgentId: "agent_sealed_audit",
  displayLabel: "Sealed audit worker",
  role: "auditor",
  noInterferencePolicy: "sealed_audit",
  prompt: "Run independently under sealed audit policy.",
});
assert.equal(sealedSpawn.status, "completed", "sealed spawn should complete");
assert.equal(sealedSpawn.result.agent.parentSelfBindingEnforced, true, "sealed spawn should enforce parent self-binding");
assert.equal(sealedSpawn.result.agent.noInterferencePolicy, "sealed_audit", "sealed policy should be preserved");

const duplicateSealedSpawn = surface.spawnAgent({
  childAgentId: "agent_sealed_audit",
  displayLabel: "Attempted duplicate sealed audit worker",
  role: "auditor",
  prompt: "Attempt to overwrite the sealed worker without no-interference policy.",
});
assert.equal(duplicateSealedSpawn.status, "blocked", "duplicate child agent ids must be blocked");
assert.equal(duplicateSealedSpawn.blockerCode, "duplicate_child_agent_id", "duplicate spawn should cite duplicate_child_agent_id");
assert.equal(surface.inspectAgent({ targetAgentId: "agent_sealed_audit" }).result.inspectPacket.agent.displayLabel, "Sealed audit worker", "duplicate spawn must not overwrite existing agent identity");

const blockedSend = surface.sendMessage({
  targetAgentId: "agent_sealed_audit",
  text: "This should be blocked by the no-interference policy.",
});
assert.equal(blockedSend.status, "blocked", "send_message must block under no-interference policy");
assert(blockedSend.blockerCode.includes("no_interference_policy_blocks_send_input"), "blocked send should cite no-interference policy");
assert(blockedSend.result.liveToolCatalog.blockedToolIds.includes("vanilla.agent.send_message"), "resident catalog should report send_message blocked for sealed target");
assert(!blockedSend.result.liveToolCatalog.callableToolIds.includes("vanilla.agent.send_message"), "sealed target should not list send_message callable");

const sealedInspect = surface.inspectAgent({ targetAgentId: "agent_sealed_audit" });
assert.equal(sealedInspect.status, "completed", "inspect should remain available under no-interference");
assert(sealedInspect.result.liveToolCatalog.callableToolIds.includes("vanilla.agent.inspect_agent"), "inspect should remain callable for sealed target");
assert(sealedInspect.result.eChannelSnapshot.residentSnapshot.rows.some((row) => row.subjectId === "agent_sealed_audit"), "E-channel should include sealed agent row");

const missingCatalog = surface.liveToolCatalog({ targetAgentId: "agent_missing" });
assert(missingCatalog.blockedToolIds.includes("vanilla.agent.inspect_agent"), "missing target catalog should block inspect");
assert(missingCatalog.blockedToolIds.includes("vanilla.agent.wait_agent"), "missing target catalog should block wait");
assert(missingCatalog.blockedToolIds.includes("vanilla.agent.send_message"), "missing target catalog should block send");
assert(!missingCatalog.callableToolIds.includes("vanilla.agent.send_message"), "missing target catalog must not advertise send_message callable");

const finalSnapshot = surface.snapshot();
assert.equal(finalSnapshot.agentCount, 2, "final surface should include two agents");
assert.equal(finalSnapshot.mailboxMessageCount, 3, "final mailbox should include spawn/send/spawn only");
assert.equal(finalSnapshot.liveToolCatalog.providerDeclarationsEnabledByCatalog, false, "catalog must not enable provider declarations");
assert.equal(finalSnapshot.liveToolCatalog.localExecutionEnabledByCatalog, false, "catalog must not claim global local execution authority");
assert.equal(finalSnapshot.rawPromptIncluded, false, "surface must not expose raw prompts");
assert.equal(finalSnapshot.rawTranscriptIncluded, false, "surface must not expose raw transcript");
assertDirectLiveSubAgentToolSurfaceSafe(finalSnapshot);

const registry = buildToolCapabilityRegistry({
  projectId: "project_live_sub_agent_fixture",
  workThreadId: "work_thread_live_sub_agent_fixture",
  nowMs: 0,
});
assert.equal(validateToolCapabilityRegistry(registry), true, "tool registry should validate");
const rows = new Map(registry.rows.map((row) => [row.toolId, row]));
assert.equal(rows.get("vanilla.agent.inspect_agent").promotionState, "direct_restricted", "inspect_agent should be direct restricted");
assert.equal(rows.get("vanilla.agent.inspect_agent").sideEffectClass, "none", "inspect_agent should be read-only");
assert.equal(rows.get("vanilla.agent.spawn_agent").providerDeclarationEnabledInThisPr, false, "spawn_agent must not enable provider declaration");

const serialized = JSON.stringify({ finalSnapshot, blockedSend, sealedInspect });
assert(!serialized.includes("\"rawPromptIncluded\":true"), "raw prompt must not be exposed");
assert(!serialized.includes("\"rawTranscriptIncluded\":true"), "raw transcript must not be exposed");
assert(!serialized.includes("\"rawProviderFrameIncluded\":true"), "raw provider frame must not be exposed");
assert(!serialized.includes("This should be blocked by the no-interference policy."), "raw blocked message text must not be retained");
assert(!serialized.includes("Inspect this bounded packet"), "raw spawn prompt text must not be retained");

console.log(JSON.stringify({
  ok: true,
  surfaceDigest: finalSnapshot.surfaceDigest,
  agents: finalSnapshot.agentCount,
  mailboxMessages: finalSnapshot.mailboxMessageCount,
  blockedToolIds: blockedSend.result.liveToolCatalog.blockedToolIds,
}, null, 2));
