#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentGraph,
  buildProgressRegistry,
  buildProgressWitness,
  buildSubAgentTranscriptProjection,
} = require("../src/main/direct/agents/observability");
const {
  buildContainedTabProjection,
  buildInspectPacket,
  buildWaitStatusPacket,
  validateContainedTabProjection,
  validateInspectPacket,
  validateWaitStatusPacket,
} = require("../src/main/direct/agents/inspect-wait-containment");

const projectId = "codex-review-shell-direct";
const workThreadId = "work_thread_sub_agent_containment";
const primaryThreadId = "primary_direct_thread";
const nowMs = Date.parse("2026-06-13T18:00:00.000Z");

function graphFixture() {
  return buildAgentGraph({
    projectId,
    primaryThreadId,
    runtimeSourceClass: "direct_harness_agent_run",
    graphRevision: 12,
    activationEpoch: 7,
    nodes: [
      {
        agentThreadId: "agent_single",
        parentThreadId: primaryThreadId,
        nickname: "Scout",
        role: "worker",
        model: "gpt-5.4-mini",
        reasoningEffort: "medium",
        lifecycleState: "running",
        activityState: "active",
        identityResolution: { confidence: "exact" },
      },
      {
        agentThreadId: "agent_waiting",
        parentThreadId: primaryThreadId,
        nickname: "Verifier",
        role: "audit",
        model: "gpt-5.5",
        reasoningEffort: "high",
        lifecycleState: "waiting",
        activityState: "blocked",
        identityResolution: { confidence: "exact" },
      },
      {
        agentThreadId: "agent_stale",
        parentThreadId: primaryThreadId,
        role: "worker",
        lifecycleState: "running",
        activityState: "active",
        identityResolution: { confidence: "exact" },
      },
      {
        agentThreadId: "agent_failed",
        parentThreadId: primaryThreadId,
        nickname: "Faulty",
        role: "worker",
        lifecycleState: "failed",
        activityState: "attention_required",
        identityResolution: { confidence: "exact" },
      },
      {
        agentThreadId: "agent_unknown_identity",
        parentThreadId: primaryThreadId,
        lifecycleState: "discovered",
        activityState: "unknown",
        identityResolution: { confidence: "unknown" },
      },
    ],
    edges: [
      { edgeKind: "spawned_child", parentThreadId: primaryThreadId, childThreadId: "agent_single", status: "completed" },
      { edgeKind: "spawned_child", parentThreadId: primaryThreadId, childThreadId: "agent_waiting", status: "completed" },
      { edgeKind: "waited_on", parentThreadId: primaryThreadId, childThreadId: "agent_waiting", status: "in_progress" },
    ],
  });
}

function registryFixture(graph) {
  return buildProgressRegistry({
    projectId,
    primaryThreadId,
    agentGraph: graph,
    nowMs,
    stalenessPolicy: { staleAfterMs: 60000 },
    entries: [
      {
        agentThreadId: "agent_single",
        phase: "running",
        activeWorkSummary: "Scout is reconstructing the target behavior.",
        lastEventAt: "2026-06-13T17:59:45.000Z",
      },
      {
        agentThreadId: "agent_waiting",
        phase: "waiting",
        activeWorkSummary: "Verifier is waiting for parent follow-up.",
        blockerCodes: ["wait_deadlock_risk"],
        lastEventAt: "2026-06-13T17:59:20.000Z",
      },
      {
        agentThreadId: "agent_stale",
        phase: "running",
        activeWorkSummary: "Stale worker has not emitted progress.",
        lastEventAt: "2026-06-13T17:50:00.000Z",
      },
      {
        agentThreadId: "agent_failed",
        phase: "failed",
        activeWorkSummary: "Faulty worker failed.",
        blockerCodes: ["worker_failed"],
        lastEventAt: "2026-06-13T17:59:10.000Z",
      },
      {
        agentThreadId: "agent_unknown_identity",
        phase: "discovered",
        activeWorkSummary: "Unknown identity worker discovered.",
        lastEventAt: "2026-06-13T17:59:00.000Z",
      },
    ],
  });
}

function transcriptsFixture(graph) {
  return graph.nodes.map((node) => buildSubAgentTranscriptProjection({
    projectId,
    primaryThreadId,
    agentThreadId: node.agentThreadId,
    agentGraphId: graph.agentGraphId,
    graphRevision: graph.graphRevision,
    activationEpoch: graph.activationEpoch,
    items: [
      {
        sourceItemId: `${node.agentThreadId}_parent_prompt`,
        role: "user",
        rendererSafeTextPreview: `Parent agent prompt to ${node.displayLabel}`,
      },
      {
        sourceItemId: `${node.agentThreadId}_child_reply`,
        role: "assistant",
        rendererSafeTextPreview: `${node.displayLabel} child-agent reply preview`,
      },
    ],
  }));
}

const graph = graphFixture();
const progressRegistry = registryFixture(graph);
const witnesses = progressRegistry.entries.map((entry) => buildProgressWitness({
  projectId,
  primaryThreadId,
  progressRegistry,
  progressEntry: entry,
}));
const transcriptProjections = transcriptsFixture(graph);
const containedProjection = buildContainedTabProjection({
  projectId,
  workThreadId,
  primaryThreadId,
  agentGraph: graph,
  progressRegistry,
  witnesses,
  transcriptProjections,
});
validateContainedTabProjection(containedProjection);

assert.equal(containedProjection.schema, "direct_sub_agent_contained_tab_projection@1");
assert.equal(containedProjection.counts.total, 5);
assert.equal(containedProjection.counts.failed, 1);
assert.equal(containedProjection.counts.stale, 1);
assert.equal(containedProjection.counts.blocked, 1);
assert.equal(containedProjection.counts.unknownIdentity, 1);
assert.equal(containedProjection.recursiveSpawnAllowed, false);
assert.equal(containedProjection.sendInputAllowed, false);
assert.equal(containedProjection.resumeAllowed, false);
assert.equal(containedProjection.closeAllowed, false);
assert.equal(containedProjection.autonomousScheduleAllowed, false);
assert.equal(containedProjection.providerTransportAllowed, false);
assert.equal(containedProjection.workspaceMutationAllowed, false);

const scoutPacket = containedProjection.inspectPackets.find((packet) => packet.agent.agentThreadId === "agent_single");
validateInspectPacket(scoutPacket);
assert.equal(scoutPacket.readOnly, true);
assert.equal(scoutPacket.agent.model, "gpt-5.4-mini");
assert.equal(scoutPacket.agent.reasoningEffort, "medium");
assert.equal(scoutPacket.attentionState, "active");
assert.equal(scoutPacket.childTranscriptRenderedAsOperator, false);
assert.equal(scoutPacket.childReplyRenderedAsPrimaryFinal, false);
assert(scoutPacket.transcriptProjection.rendererSafeItems.some((item) => item.authorKind === "parent_agent"));
assert(scoutPacket.transcriptProjection.rendererSafeItems.some((item) => item.authorKind === "child_agent"));
assert(!scoutPacket.transcriptProjection.rendererSafeItems.some((item) => ["operator", "primary_agent"].includes(item.authorKind)));

const waitingPacket = containedProjection.inspectPackets.find((packet) => packet.agent.agentThreadId === "agent_waiting");
assert.equal(waitingPacket.waitState, "deadlock_risk");
assert(waitingPacket.statusBadges.includes("deadlock_risk"));
assert(waitingPacket.statusBadges.includes("blocked"));

const stalePacket = containedProjection.inspectPackets.find((packet) => packet.agent.agentThreadId === "agent_stale");
assert.equal(stalePacket.waitState, "stale");
assert.equal(stalePacket.attentionState, "stale");

const failedPacket = containedProjection.inspectPackets.find((packet) => packet.agent.agentThreadId === "agent_failed");
assert.equal(failedPacket.waitState, "failed");
assert.equal(failedPacket.attentionState, "failed");

const unknownIdentityPacket = containedProjection.inspectPackets.find((packet) => packet.agent.agentThreadId === "agent_unknown_identity");
assert(unknownIdentityPacket.statusBadges.includes("unknown_identity"));
assert.equal(unknownIdentityPacket.agent.displayLabel.startsWith("Agent "), true);

const waitPackets = containedProjection.waitStatusPackets;
for (const packet of waitPackets) {
  validateWaitStatusPacket(packet);
  assert.equal(packet.waitOperationStarted, false);
  assert.equal(packet.waitOperationAuthorityGranted, false);
  assert.equal(packet.providerWaitToolCalled, false);
  assert.equal(packet.appServerMutationUsed, false);
  assert.equal(packet.recursiveControlAllowed, false);
  assert.equal(packet.autonomousScheduleAllowed, false);
}
assert(waitPackets.find((packet) => packet.agentThreadId === "agent_waiting").blockerCodes.includes("wait_deadlock_risk"));
assert(waitPackets.find((packet) => packet.agentThreadId === "agent_stale").blockerCodes.includes("stale_worker"));
assert(waitPackets.find((packet) => packet.agentThreadId === "agent_failed").blockerCodes.includes("worker_failed"));

const standaloneInspect = buildInspectPacket({
  projectId,
  workThreadId,
  primaryThreadId,
  agentGraphId: graph.agentGraphId,
  agentNode: graph.nodes[0],
  progressRegistry,
  progressWitness: witnesses[0],
  transcriptProjection: transcriptProjections[0],
  inspectReason: "wait_status_refresh",
});
validateInspectPacket(standaloneInspect);
const standaloneWait = buildWaitStatusPacket({ inspectPacket: standaloneInspect });
validateWaitStatusPacket(standaloneWait);

console.log(JSON.stringify({
  ok: true,
  projection: containedProjection.projectionId,
  total: containedProjection.counts.total,
  selected: containedProjection.selectedAgentThreadId,
  scout: scoutPacket.attentionState,
  waiting: waitingPacket.waitState,
  stale: stalePacket.waitState,
  failed: failedPacket.waitState,
  unknownIdentity: unknownIdentityPacket.statusBadges.includes("unknown_identity"),
}, null, 2));
