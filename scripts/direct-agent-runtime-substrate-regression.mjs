#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_AGENT_AUTHORITY_BOUNDARY_SCHEMA,
  DIRECT_AGENT_CONTEXT_PACKET_FAMILY_SCHEMA,
  DIRECT_AGENT_LIFECYCLE_REGISTRY_SCHEMA,
  DIRECT_AGENT_MAILBOX_SCHEMA,
  DIRECT_AGENT_RUNTIME_RECOVERY_CLASSIFICATION_SCHEMA,
  DIRECT_AGENT_RUNTIME_REGISTRY_SCHEMA,
  DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA,
  DIRECT_AGENT_SPAWN_PLAN_SCHEMA,
  DIRECT_AGENT_THREAD_GRAPH_SCHEMA,
  assertAgentRuntimeSubstrateSafe,
  buildAgentAuthorityBoundary,
  buildAgentContextPacketFamily,
  buildAgentLifecycleRegistry,
  buildAgentMailbox,
  buildAgentRuntimeRecoveryClassification,
  buildAgentRuntimeRegistry,
  buildAgentRuntimeSubstrateStatus,
  buildAgentSpawnPlan,
  buildAgentThreadGraph,
  classifyAgentRuntimeRecovery,
} = require("../src/main/direct/agents/runtime-substrate");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const projectId = "project_agent_runtime_fixture";
  const primaryThreadId = "thread_primary_agent_runtime_fixture";

  const contextPacketFamily = buildAgentContextPacketFamily({
    projectId,
    family: "text_only_child_context",
    agentClassKind: "sub_agent_worker",
    allowedContextFamilies: ["work_thread_identity", "authority_boundary", "context_packet"],
    requiredArtifactOutputFamilies: ["sub_agent_result_artifact"],
    nowMs: 0,
  });
  assert(contextPacketFamily.schema === DIRECT_AGENT_CONTEXT_PACKET_FAMILY_SCHEMA, "context packet family schema mismatch");
  assert(contextPacketFamily.toolsAllowed === false, "child context family must not allow tools");
  assert(contextPacketFamily.recursiveSpawnAllowed === false, "child context family must not allow recursive spawn");

  const authorityBoundary = buildAgentAuthorityBoundary({
    projectId,
    parentAgentId: primaryThreadId,
    childAgentId: "agent_child_fixture",
    agentClassKind: "sub_agent_worker",
    nowMs: 0,
  });
  assert(authorityBoundary.schema === DIRECT_AGENT_AUTHORITY_BOUNDARY_SCHEMA, "authority boundary schema mismatch");
  assert(authorityBoundary.childMayUseTools === false, "child must not inherit tool authority");
  assert(authorityBoundary.childMaySpawnChildren === false, "child must not inherit recursive spawn authority");
  assert(authorityBoundary.childMayPromoteFinalAnswer === false, "child reply must not become primary final answer");
  assert(authorityBoundary.childTranscriptMayEnterPrimary === false, "child transcript must not enter primary transcript");

  const spawnPlan = buildAgentSpawnPlan({
    projectId,
    parentAgentId: primaryThreadId,
    childAgentId: "agent_child_fixture",
    authorityBoundary,
    contextPacketFamily,
  });
  assert(spawnPlan.schema === DIRECT_AGENT_SPAWN_PLAN_SCHEMA, "spawn plan schema mismatch");
  assert(spawnPlan.providerSpawnExecutable === false, "spawn plan must not execute provider spawn");
  assert(spawnPlan.localSpawnExecutable === false, "spawn plan must not execute local spawn");
  assert(spawnPlan.childSuccessClaimAllowed === false, "spawn intent must not become child success");
  assert(spawnPlan.parentSpawnIntentIsChildSuccess === false, "spawn intent must be distinct from child success");

  const registry = buildAgentRuntimeRegistry({
    projectId,
    primaryThreadId,
    contextPacketFamilies: [contextPacketFamily],
    authorityBoundaries: [authorityBoundary],
    nowMs: 0,
  });
  assert(registry.schema === DIRECT_AGENT_RUNTIME_REGISTRY_SCHEMA, "runtime registry schema mismatch");
  assert(registry.providerSpawnEnabledInThisPr === false, "runtime registry must not enable provider spawn");
  assert(registry.listAgentsToolEnabledInThisPr === false, "runtime registry must not enable list_agents");
  assert(registry.waitAgentToolEnabledInThisPr === false, "runtime registry must not enable wait_agent");

  const graph = buildAgentThreadGraph({
    projectId,
    primaryThreadId,
    graphRevision: 2,
    nodes: [
      {
        agentThreadId: "agent_child_fixture",
        parentAgentThreadId: primaryThreadId,
        displayLabel: "Child fixture",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        nodeState: "running",
        authorityBoundaryId: authorityBoundary.boundaryId,
        contextPacketFamilyId: contextPacketFamily.contextPacketFamilyId,
      },
    ],
    edges: [
      {
        edgeKind: "spawn_intent",
        parentAgentThreadId: primaryThreadId,
        childAgentThreadId: "agent_child_fixture",
        sourceMailboxMessageId: "msg_1",
      },
    ],
    nowMs: 0,
  });
  assert(graph.schema === DIRECT_AGENT_THREAD_GRAPH_SCHEMA, "thread graph schema mismatch");
  assert(graph.canonicalRuntimeEvidence === true, "agent graph must be canonical runtime evidence");
  assert(graph.subAgentPanelProjectionOnly === true, "sub-agent panel must remain projection");
  assert(graph.childTranscriptPromotionAllowed === false, "child transcript promotion must be blocked");
  assert(graph.parentSpawnIntentMayClaimChildSuccess === false, "spawn intent must not claim child success");

  const mailbox = buildAgentMailbox({
    projectId,
    primaryThreadId,
    graphId: graph.graphId,
    messages: [
      {
        messageId: "msg_1",
        sequence: 1,
        messageKind: "spawn_intent",
        direction: "parent_to_child",
        parentAgentId: primaryThreadId,
        childAgentId: "agent_child_fixture",
        payloadRef: { kind: "spawn_prompt_ref", id: "spawn_prompt_1", digest: "sha256:spawn" },
      },
      {
        messageId: "msg_2",
        sequence: 2,
        messageKind: "status_update",
        direction: "runtime_to_parent",
        parentAgentId: primaryThreadId,
        childAgentId: "agent_child_fixture",
        payloadRef: { kind: "status_ref", id: "status_1", digest: "sha256:status" },
      },
    ],
    nowMs: 0,
  });
  assert(mailbox.schema === DIRECT_AGENT_MAILBOX_SCHEMA, "mailbox schema mismatch");
  assert(mailbox.sequenceLaw === "strictly_increasing_per_mailbox", "mailbox must declare sequence law");
  assert(mailbox.idempotencyLaw === "idempotency_key_required_per_message", "mailbox must declare idempotency law");
  assert(mailbox.duplicateMessageCount === 0, "fixture mailbox should be idempotent");
  assert(mailbox.providerTransportAllowed === false, "mailbox must not allow provider transport");

  const lifecycleRegistry = buildAgentLifecycleRegistry({
    projectId,
    graphId: graph.graphId,
    entries: [
      { agentThreadId: "agent_child_fixture", lifecycleState: "running", lastEventAt: "1970-01-01T00:00:00.000Z" },
      { agentThreadId: "agent_done_fixture", lifecycleState: "completed", parentNotified: true, resultAccepted: true },
    ],
    nowMs: 0,
  });
  assert(lifecycleRegistry.schema === DIRECT_AGENT_LIFECYCLE_REGISTRY_SCHEMA, "lifecycle registry schema mismatch");
  assert(lifecycleRegistry.activeCount === 1, "lifecycle registry should count active agents");
  assert(lifecycleRegistry.terminalCount === 1, "lifecycle registry should count terminal agents");

  const recoveryInputs = [
    { lifecycleState: "created", expected: "child_created" },
    { lifecycleState: "request_started", expected: "result_pending" },
    { lifecycleState: "running", hasRequestStart: true, expected: "result_pending" },
    { lifecycleState: "handoff_unknown", expected: "handoff_unknown" },
    { lifecycleState: "recovery_required", expected: "recovery_required" },
    { lifecycleState: "completed", expected: "terminal_known" },
    { lifecycleState: "unknown", expected: "not_started" },
  ];
  for (const item of recoveryInputs) {
    assert(classifyAgentRuntimeRecovery(item) === item.expected, `unexpected recovery class for ${item.lifecycleState}`);
    const classification = buildAgentRuntimeRecoveryClassification({
      projectId,
      graphId: graph.graphId,
      agentThreadId: `agent_${item.expected}`,
      ...item,
    });
    assert(classification.schema === DIRECT_AGENT_RUNTIME_RECOVERY_CLASSIFICATION_SCHEMA, "recovery classification schema mismatch");
    assert(classification.automaticReplayAllowed === false, "recovery classification must not permit automatic replay");
  }

  const status = buildAgentRuntimeSubstrateStatus({
    projectId,
    registry,
    graph,
    mailbox,
    lifecycleRegistry,
    recoveryClassifications: recoveryInputs.map((item) => ({
      agentThreadId: `agent_${item.expected}`,
      lifecycleState: item.lifecycleState,
      hasRequestStart: item.hasRequestStart,
    })),
    nowMs: 0,
  });
  assert(status.schema === DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA, "status schema mismatch");
  assert(status.agentSpawnPlanExists === true, "status should expose AgentSpawnPlan existence");
  assert(status.agentContextPacketFamilyExists === true, "status should expose AgentContextPacketFamily existence");
  assert(status.agentAuthorityBoundaryExplicit === true, "status should expose AgentAuthorityBoundary existence");
  assert(status.mailboxSequenceLaw === "strictly_increasing_per_mailbox", "status should expose mailbox sequence law");
  assert(status.mailboxIdempotencyLaw === "idempotency_key_required_per_message", "status should expose mailbox idempotency law");
  assertAgentRuntimeSubstrateSafe(status);

  const projection = buildDirectSettingsSurfaceProjection({
    projectId,
    agentRuntimeStatus: status,
  });
  assert(projection.sections.agentRuntime.available === true, "settings surface should expose agent runtime substrate");
  assert(projection.sections.agentRuntime.agentSpawnExecutable === false, "settings surface must show spawn blocked");
  assert(projection.authority.agentRuntimeSpawnAllowed === false, "settings authority must block agent runtime spawn");
  assertDirectSettingsSurfaceRendererSafe(projection);

  console.log(JSON.stringify({
    ok: true,
    registryDigest: registry.registryDigest,
    graphDigest: graph.graphDigest,
    mailboxDigest: mailbox.mailboxDigest,
    statusDigest: status.statusDigest,
    projectionDigest: projection.projectionDigest,
  }, null, 2));
}

main();
