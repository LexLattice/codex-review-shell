import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSubAgentEChannelSnapshot,
  buildSubAgentEpistemicRows,
  buildSubAgentGovernanceEnvelope,
  validateSubAgentEChannelSnapshot,
  validateSubAgentGovernanceEnvelope,
} = require("../src/main/direct/bridge/sub-agent-governance-envelope.js");

const generatedAt = "2026-06-18T12:00:00.000Z";
const graph = {
  agentGraphId: "graph_pr75_fixture",
  graphDigest: "sha256:graph_pr75_fixture",
  graphRevision: 7,
  projectId: "project_pr75_fixture",
  primaryThreadId: "primary_thread_pr75",
  nodes: [
    {
      agentThreadId: "agent_running",
      agentNodeId: "node_running",
      parentThreadId: "primary_thread_pr75",
      displayLabel: "Carver",
      role: "worker",
      nickname: "Carver",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      lifecycleState: "running",
      activityState: "active",
      evidenceRefs: [{ refId: "graph_row_running", source: "agent_graph", digest: "sha256:graph_running" }],
    },
    {
      agentThreadId: "agent_stale",
      agentNodeId: "node_stale",
      parentThreadId: "primary_thread_pr75",
      displayLabel: "Tesla",
      role: "reviewer",
      model: "gpt-5.5",
      reasoningEffort: "high",
      lifecycleState: "stale",
      activityState: "unknown",
    },
    {
      agentThreadId: "agent_done",
      agentNodeId: "node_done",
      parentThreadId: "primary_thread_pr75",
      displayLabel: "Pasteur",
      role: "auditor",
      model: "gpt-5.3-codex",
      reasoningEffort: "low",
      lifecycleState: "completed",
      activityState: "idle",
    },
    {
      agentThreadId: "agent_blind",
      agentNodeId: "node_blind",
      parentThreadId: "primary_thread_pr75",
      displayLabel: "Curie",
      role: "probe",
      lifecycleState: "discovered",
      activityState: "responding",
    },
    {
      agentThreadId: "agent_future",
      agentNodeId: "node_future",
      parentThreadId: "primary_thread_pr75",
      displayLabel: "Feynman",
      role: "worker",
      lifecycleState: "created",
      activityState: "active",
    },
  ],
};

const progressRegistry = {
  entries: [
    {
      agentThreadId: "agent_running",
      progressWitnessId: "progress_running",
      phase: "running",
      evidenceRefs: [{ refId: "progress_running", source: "sub_agent_e_channel", digest: "sha256:progress_running" }],
    },
    { agentThreadId: "agent_stale", progressWitnessId: "progress_stale", phase: "stale" },
    { agentThreadId: "agent_done", progressWitnessId: "progress_done", phase: "completed" },
    { agentThreadId: "agent_blind", progressWitnessId: "progress_blind", phase: "input_sent" },
    { agentThreadId: "agent_future", progressWitnessId: "progress_future", phase: "created" },
  ],
};

const inspectPackets = [
  {
    requestedAgentThreadId: "agent_running",
    rendererSafeSummary: "Reading source catalog; no mutation requested.",
    waitState: "running",
    attentionState: "none",
    evidenceRefs: [{ refId: "inspect_running", source: "sub_agent_e_channel", digest: "sha256:inspect_running" }],
  },
];

const transcriptProjections = [
  {
    agentThreadId: "agent_running",
    transcriptProjectionId: "transcript_running",
    projectionDigest: "sha256:transcript_running",
    itemCount: 5,
    rendererSafeItems: [
      { role: "parent_agent", textPreview: "Inspect tail rules." },
      { role: "child_agent", textPreview: "Tail rule audit in progress." },
    ],
    hasMore: true,
  },
  {
    agentThreadId: "agent_done",
    transcriptProjectionId: "transcript_done",
    projectionDigest: "sha256:transcript_done",
    itemCount: 2,
    rendererSafeItems: [{ role: "child_agent", textPreview: "Completed." }],
  },
];

const envelope = buildSubAgentGovernanceEnvelope({
  generatedAt,
  workThreadId: "work_thread_pr75",
  agentGraph: graph,
  progressRegistry,
  inspectPackets,
  transcriptProjections,
  policies: [
    { agentThreadId: "agent_stale", noInterferencePolicy: "operator_locked" },
    {
      agentThreadId: "agent_done",
      noInterferencePolicy: "time_boxed",
      releaseAt: "2026-06-18T11:00:00.000Z",
      releaseEvidenceRefs: [{ refId: "release_done", source: "sub_agent_e_channel", digest: "sha256:release_done" }],
    },
    { agentThreadId: "agent_blind", noInterferencePolicy: "blind_run" },
    { agentThreadId: "agent_future", noInterferencePolicy: "time_boxed", releaseAt: "2026-06-18T13:00:00.000Z" },
  ],
});

assert.deepEqual(validateSubAgentGovernanceEnvelope(envelope), []);
assert.equal(envelope.schema, "sub_agent_governance_envelope@1");
assert.equal(envelope.rowCount, 5);
assert.equal(envelope.contextInjectionEnabled, false);
assert.equal(envelope.providerDeclarationsBlocked, true);
assert.equal(envelope.childTranscriptPromotionBlocked, true);

const byAgent = new Map(envelope.rows.map((row) => [row.agentThreadId, row]));
const running = byAgent.get("agent_running");
assert.equal(running.noInterferencePolicy, "observe_only");
assert.equal(running.governanceStatus, "observing");
assert.equal(running.model, "gpt-5.4-mini");
assert.equal(running.reasoningEffort, "medium");
assert.equal(running.currentActivity, "Reading source catalog; no mutation requested.");
assert.ok(running.observableActions.includes("observe_status"));
for (const action of ["send_input", "resume", "interrupt", "close", "workspace_mutation", "provider_declaration", "child_transcript_promotion"]) {
  assert.ok(running.blockedActions.includes(action), `running blocks ${action}`);
}
assert.equal(running.transcriptWitness.itemCount, 5);
assert.equal(running.transcriptWitness.rendererSafeItemCount, 2);
assert.equal(running.transcriptWitness.rawTranscriptIncluded, false);
assert.equal(running.transcriptWitness.childTranscriptRenderedAsOperator, false);
assert.equal(running.transcriptWitness.childReplyRenderedAsPrimaryFinal, false);

const stale = byAgent.get("agent_stale");
assert.equal(stale.noInterferencePolicy, "operator_locked");
assert.equal(stale.governanceStatus, "stale");
assert.equal(stale.releaseState, "operator_required");
assert.ok(stale.blockedActions.includes("release_without_operator"));

const done = byAgent.get("agent_done");
assert.equal(done.governanceStatus, "completed");
assert.equal(done.noInterferencePolicy, "time_boxed");
assert.equal(done.releaseState, "release_available");
assert.equal(done.transcriptWitness.visibility, "summary_only");
assert.equal(done.releaseEvidenceRefs.length, 1);

const blind = byAgent.get("agent_blind");
assert.equal(blind.noInterferencePolicy, "blind_run");
assert.equal(blind.governanceStatus, "observing");
assert.deepEqual(blind.observableActions, ["observe_summary"]);
assert.ok(blind.blockedActions.includes("inspect_full_transcript"));

const future = byAgent.get("agent_future");
assert.equal(future.governanceStatus, "observing");
assert.equal(future.releaseState, "not_releasable");
assert.ok(future.blockedActions.includes("send_input"));

const rows = buildSubAgentEpistemicRows({ envelope });
assert.equal(rows.length, 5);
const runningResident = rows.find((row) => row.subjectId === "agent_running");
assert.equal(runningResident.subjectKind, "sub_agent");
assert.equal(runningResident.callableInCurrentRequest, false);
assert.equal(runningResident.declaredAsProviderTool, false);
assert.equal(runningResident.controlState, "blocked_by_policy");
assert.equal(runningResident.transcriptSourceRefs[0].source, "sub_agent_e_channel");
assert.equal(runningResident.extensions.parentSelfBindingEnforced, true);

const staleResident = rows.find((row) => row.subjectId === "agent_stale");
assert.equal(staleResident.status, "stale");
assert.equal(staleResident.freshness, "stale");
assert.equal(staleResident.callableInCurrentRequest, false);

const snapshot = buildSubAgentEChannelSnapshot({ envelope });
assert.deepEqual(validateSubAgentEChannelSnapshot(snapshot), []);
assert.equal(snapshot.schema, "sub_agent_e_channel_snapshot@1");
assert.equal(snapshot.controlAuthorityGranted, false);
assert.equal(snapshot.contextInjectionEnabled, false);
assert.equal(snapshot.residentSnapshot.rows.length, 5);

const providerLeak = structuredClone(envelope);
providerLeak.providerDeclarationsBlocked = false;
assert.ok(validateSubAgentGovernanceEnvelope(providerLeak).includes("sub_agent_governance_required_block_missing:providerDeclarationsBlocked"));

const flattened = structuredClone(envelope);
flattened.rows[0].transcriptWitness.childTranscriptRenderedAsOperator = true;
assert.ok(validateSubAgentGovernanceEnvelope(flattened).includes("sub_agent_governance_transcript_flattened:agent_running"));

const missingBlock = structuredClone(envelope);
missingBlock.rows[0].blockedActions = missingBlock.rows[0].blockedActions.filter((action) => action !== "provider_transport");
assert.ok(validateSubAgentGovernanceEnvelope(missingBlock).includes("sub_agent_governance_interference_action_not_blocked:agent_running:provider_transport"));

const malformedBlock = structuredClone(envelope);
malformedBlock.rows[0].blockedActions = null;
assert.ok(validateSubAgentGovernanceEnvelope(malformedBlock).includes("sub_agent_governance_interference_action_not_blocked:agent_running:provider_declaration"));

const partialEnvelopeRows = buildSubAgentEpistemicRows({
  envelope: {
    ...envelope,
    rows: [
      {
        ...running,
        transcriptWitness: undefined,
      },
    ],
  },
});
assert.equal(partialEnvelopeRows[0].transcriptSourceRefs.length, 0);
assert.equal(partialEnvelopeRows[0].extensions.transcriptItemCount, undefined);

console.log("direct-sub-agent-governance-envelope regression passed");
