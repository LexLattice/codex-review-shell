#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentIdentityContextSourceRef,
  buildAgentMemoryContextProjection,
  buildAgentRunContextSourceRef,
  normalizeDirectContextSourceRef,
} = require("../src/main/direct/bridge/agent-context-source-refs");
const {
  buildAgentMemoryRow,
} = require("../src/main/direct/bridge/agent-memory-store");
const {
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  buildContextPack,
  buildContextRecentDialogueProjection,
  buildRequestManifest,
  providerInputFromContextPack,
} = require("../src/main/direct/thread/context-pack");

const nowMs = Date.parse("2026-06-23T10:00:00.000Z");

function memoryRow(overrides = {}) {
  return buildAgentMemoryRow({
    agentId: "direct_agent_primary",
    projectId: "project_alpha",
    scope: {
      memoryScope: "project_role",
      projectId: "project_alpha",
      roleLane: "primary",
    },
    kind: "decision",
    contentSummary: "Use the direct harness as the default active backend for this lane.",
    confidence: "high",
    authorityUse: "context_evidence",
    auditState: "accepted",
    contextEligibility: "eligible",
    conflictState: "none",
    provenance: {
      extractionTransitionId: "extract_1",
      sourceThreadIds: ["thread_1"],
      sourceTurnIds: ["turn_1"],
      sourceRefs: [{ kind: "manual_fixture", id: "fixture_1" }],
    },
    ...overrides,
  }, { nowMs });
}

const sourceRef = normalizeDirectContextSourceRef({
  sourceClass: "agent_identity",
  sourceId: "direct_agent_primary",
  projectId: "project_alpha",
  agentId: "direct_agent_primary",
  sourceConfidence: "exact",
  freshness: "fresh",
  authorityUse: "identity_witness",
  contextRole: "agent_identity_witness",
  digest: "sha256:identity",
}, { nowMs });
assert.equal(sourceRef.schema, "direct_context_source_ref@1");
assert.equal(sourceRef.providerInstruction, false);
assert.equal(sourceRef.rawTextIncluded, false);
assert.equal(sourceRef.contextRole, "agent_identity_witness");

const identityRef = buildAgentIdentityContextSourceRef({
  projectId: "project_alpha",
  agentId: "direct_agent_primary",
  displayName: "Primary resident",
  identityConfidence: "declared",
  identityDigest: "sha256:agent_identity",
}, { nowMs });
const runRef = buildAgentRunContextSourceRef({
  projectId: "project_alpha",
  agentId: "direct_agent_primary",
  agentRunId: "agent_run_1",
  threadId: "thread_1",
  lifecycle: "running",
  runKind: "resident_thread",
  runDigest: "sha256:agent_run",
}, { nowMs });
assert.equal(identityRef.contextRole, "agent_identity_witness");
assert.equal(runRef.contextRole, "agent_run_witness");
assert.equal(identityRef.providerInstruction, false);
assert.equal(runRef.providerInstruction, false);

const eligiblePreference = memoryRow({
  memoryId: "memory_preference_1",
  kind: "preference",
  authorityUse: "preference_hint",
  contentSummary: "Prefer concise review summaries in this project.",
});
const eligibleDecision = memoryRow({
  memoryId: "memory_decision_1",
  kind: "decision",
  authorityUse: "context_evidence",
  contentSummary: "Use WorkThread ids as bridge identity in direct harness context packs.",
});
const rejected = memoryRow({
  memoryId: "memory_rejected_1",
  auditState: "rejected",
  contextEligibility: "eligible",
});
const stale = memoryRow({
  memoryId: "memory_stale_1",
  confidence: "stale",
  contextEligibility: "eligible",
});
const conflicted = memoryRow({
  memoryId: "memory_conflicted_1",
  conflictState: "conflicts_with_newer_memory",
});
const outOfScope = memoryRow({
  memoryId: "memory_other_project_1",
  projectId: "project_beta",
  scope: {
    memoryScope: "project_role",
    projectId: "project_beta",
    roleLane: "primary",
  },
});

const disabledProjection = buildAgentMemoryContextProjection({
  projectId: "project_alpha",
  agentId: "direct_agent_primary",
  threadId: "thread_1",
  turnId: "turn_1",
  roleLane: "primary",
  memoryRows: [eligiblePreference, eligibleDecision],
  nowMs,
});
assert.equal(disabledProjection.selectedCount, 0, "memory rows should not select without explicit selection enablement");
assert.equal(disabledProjection.omissionCounters.notSelected, 2);

const projection = buildAgentMemoryContextProjection({
  projectId: "project_alpha",
  agentId: "direct_agent_primary",
  threadId: "thread_1",
  turnId: "turn_1",
  roleLane: "primary",
  memoryRows: [eligiblePreference, eligibleDecision, rejected, stale, conflicted, outOfScope],
  selectionEnabled: true,
  maxSelectedRows: 1,
  selectionPolicyId: "fixture_manual_memory_projection@1",
  nowMs,
});
assert.equal(projection.schema, "direct_agent_memory_context_projection@1");
assert.equal(projection.selectedCount, 1, "budget should select exactly one eligible memory");
assert.equal(projection.selectedMemoryRefs[0].contextRole, "preference_hint");
assert.equal(projection.selectedMemoryRefs[0].sourceRef.schema, "direct_context_source_ref@1");
assert.equal(Boolean(projection.selectedMemoryRefs[0].digest), true, "selected memory must cite digest");
assert.equal(projection.omissionCounters.rejected, 1);
assert.equal(projection.omissionCounters.stale, 1);
assert.equal(projection.omissionCounters.conflicted, 1);
assert.equal(projection.omissionCounters.outOfScope, 1);
assert.equal(projection.omissionCounters.overBudget, 1);
assert.equal(projection.rawMemoryTextIncluded, false);
assert.equal(projection.providerInstruction, false);
assert.equal(Object.prototype.hasOwnProperty.call(projection, "providerContext"), false);

const recentProjection = buildContextRecentDialogueProjection({
  rendererProjection: {
    projectId: "project_alpha",
    threadId: "thread_1",
    projectionId: "renderer_projection_1",
    projectionKind: "renderer_transcript",
    projectionDigest: "sha256:renderer",
    status: "valid",
    unsafeForRenderer: false,
  },
  rendererItems: [
    {
      role: "user",
      itemKind: "user_message",
      text: "Previous operator question.",
      authority: "historical-evidence",
    },
    {
      role: "assistant",
      itemKind: "assistant_message",
      text: "Previous assistant answer.",
      authority: "historical-evidence",
    },
  ],
  nowMs,
});

const basePack = buildContextPack({
  projectId: "project_alpha",
  threadId: "thread_1",
  turnId: "turn_2",
  purpose: "direct_text_turn",
  policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  contextProjection: recentProjection,
  contextItems: recentProjection.items,
  currentUserPrompt: "Continue the work.",
  nowMs,
});
const noOpAgentPack = buildContextPack({
  projectId: "project_alpha",
  threadId: "thread_1",
  turnId: "turn_2",
  purpose: "direct_text_turn",
  policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  contextProjection: recentProjection,
  contextItems: recentProjection.items,
  currentUserPrompt: "Continue the work.",
  agentContextSourceRefs: [],
  nowMs,
});
assert.equal(noOpAgentPack.contextPackShapeHash, basePack.contextPackShapeHash, "empty agent refs should not alter pack shape");
assert.equal(providerInputFromContextPack(noOpAgentPack).projection.providerInputTextHash, providerInputFromContextPack(basePack).projection.providerInputTextHash);

const packWithAgentRefs = buildContextPack({
  projectId: "project_alpha",
  threadId: "thread_1",
  turnId: "turn_2",
  purpose: "direct_text_turn",
  policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  contextProjection: recentProjection,
  contextItems: recentProjection.items,
  currentUserPrompt: "Continue the work.",
  agentContextSourceRefs: [identityRef, runRef],
  agentMemoryContextProjection: projection,
  nowMs,
});
assert.equal(Boolean(packWithAgentRefs.agentContextSources), true);
assert.equal(packWithAgentRefs.agentContextSources.providerInputMutation, false);
assert.equal(packWithAgentRefs.sourceArtifacts.some((artifact) => artifact.artifactKind === "agent_memory_context_projection"), true);
assert.equal(providerInputFromContextPack(packWithAgentRefs).projection.providerInputTextHash, providerInputFromContextPack(basePack).projection.providerInputTextHash, "agent refs should not mutate provider prompt text");
assert.equal(packWithAgentRefs.caps.omittedCounts.agent_memory_rejected, 1);
assert.equal(packWithAgentRefs.caps.omittedCounts.agent_memory_stale, 1);

const { requestManifest } = buildRequestManifest({
  contextPack: packWithAgentRefs,
  model: "gpt-5.5",
  requestShape: { requestShapeClass: "direct_text_turn", toolCount: 0 },
  nowMs,
});
assert.equal(requestManifest.agentContextSources.sourceRefCount >= 3, true);
assert.equal(requestManifest.agentContextSources.providerInputMutation, false);
assert.equal(requestManifest.agentContextSources.memoryProjectionRef.rawMemoryTextIncluded, false);
assert.equal(requestManifest.providerInputProjection.providerInputTextHash, providerInputFromContextPack(basePack).projection.providerInputTextHash);

console.log("direct-agent-context-source-refs regression passed");
