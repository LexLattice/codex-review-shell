#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildAgentIdentity,
  buildAgentRun,
  buildAgentThreadLink,
} = require("../src/main/direct/bridge/agent-registry");
const {
  buildAgentMemoryRow,
  buildMemoryInventoryProjection,
} = require("../src/main/direct/bridge/agent-memory-store");
const {
  buildToolCapabilityRegistry,
  buildToolCapabilityStatusProjection,
} = require("../src/main/direct/bridge/tool-capability-registry");
const {
  RESIDENT_AGENT_CONTEXT_WITNESS_SCHEMA,
  RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA,
  buildResidentAgentIdentitySnapshot,
  validateResidentAgentIdentitySnapshot,
} = require("../src/main/direct/bridge/resident-agent-identity-snapshot");

const nowMs = Date.parse("2026-06-23T12:00:00.000Z");

const identity = buildAgentIdentity({
  agentId: "agent_project_primary",
  projectId: "project_alpha",
  roleLane: "primary",
  agentClass: "primary_resident",
  displayName: "Project Alpha Resident",
  identityConfidence: "exact",
  lifecycleState: "active",
  linkedThreadIds: ["direct_session_current", "direct_session_prior"],
  activeRunIds: ["agent_run_current"],
  sourceRefs: [{ kind: "manual_fixture", id: "identity_fixture", digest: "sha256:identity_fixture" }],
}, { nowMs });

const currentRun = buildAgentRun({
  agentRunId: "agent_run_current",
  projectId: "project_alpha",
  agentId: identity.agentId,
  runKind: "resident_thread",
  objective: {
    objectiveKind: "interactive_resident",
    objectiveLabel: "Current resident turn",
  },
  lifecycle: "running",
  threadIds: ["direct_session_current"],
  sourceRefs: [{ kind: "session", id: "direct_session_current", digest: "sha256:session_current" }],
}, { nowMs });

const priorRun = buildAgentRun({
  agentRunId: "agent_run_prior",
  projectId: "project_alpha",
  agentId: identity.agentId,
  runKind: "resident_thread",
  lifecycle: "completed",
  threadIds: ["direct_session_prior"],
  sourceRefs: [{ kind: "session", id: "direct_session_prior", digest: "sha256:session_prior" }],
}, { nowMs });

const currentLink = buildAgentThreadLink({
  projectId: "project_alpha",
  agentId: identity.agentId,
  agentRunId: currentRun.agentRunId,
  threadId: "direct_session_current",
  linkKind: "resident_primary",
  relationship: "owned_by_agent",
  linkState: "active",
  sourceRefs: [{ kind: "session", id: "direct_session_current", digest: "sha256:session_current" }],
}, { nowMs });

const priorLink = buildAgentThreadLink({
  projectId: "project_alpha",
  agentId: identity.agentId,
  agentRunId: priorRun.agentRunId,
  threadId: "direct_session_prior",
  linkKind: "resident_primary",
  relationship: "owned_by_agent",
  linkState: "inactive",
  sourceRefs: [{ kind: "session", id: "direct_session_prior", digest: "sha256:session_prior" }],
}, { nowMs });

function memoryRow(overrides = {}) {
  return buildAgentMemoryRow({
    agentId: identity.agentId,
    projectId: "project_alpha",
    scope: {
      memoryScope: "project_role",
      projectId: "project_alpha",
      roleLane: "primary",
    },
    kind: "preference",
    contentSummary: "This content summary must not appear in the resident agent snapshot.",
    confidence: "high",
    authorityUse: "preference_hint",
    auditState: "accepted",
    contextEligibility: "eligible",
    conflictState: "none",
    provenance: {
      extractionTransitionId: "extract_fixture",
      sourceThreadIds: ["direct_session_prior"],
      sourceTurnIds: ["turn_prior"],
      sourceRefs: [{ kind: "manual_fixture", id: "memory_fixture", digest: "sha256:memory_fixture" }],
    },
    ...overrides,
  }, { nowMs });
}

const memoryInventoryProjection = buildMemoryInventoryProjection([
  memoryRow({ memoryId: "memory_preference" }),
  memoryRow({
    memoryId: "memory_work_thread",
    kind: "decision",
    scope: {
      memoryScope: "work_thread",
      projectId: "project_alpha",
      workThreadId: "work_thread_alpha",
    },
    authorityUse: "context_evidence",
  }),
  memoryRow({
    memoryId: "memory_rejected",
    auditState: "rejected",
    contextEligibility: "eligible",
  }),
], {
  projectId: "project_alpha",
  agentId: identity.agentId,
  roleLane: "primary",
  workThreadId: "work_thread_alpha",
  nowMs,
});

const toolCapabilityRegistry = buildToolCapabilityRegistry({
  projectId: "project_alpha",
  workThreadId: "work_thread_alpha",
  nowMs,
});
const toolCapabilityStatusProjection = buildToolCapabilityStatusProjection({
  registry: toolCapabilityRegistry,
  projectId: "project_alpha",
  workThreadId: "work_thread_alpha",
});

const snapshot = buildResidentAgentIdentitySnapshot({
  identity,
  threadLinks: [currentLink, priorLink],
  agentRuns: [currentRun, priorRun],
  currentThreadId: "direct_session_current",
  currentWorkThreadId: "work_thread_alpha",
  memoryInventoryProjection,
  toolCapabilityRegistry,
  toolCapabilityStatusProjection,
  nowMs,
  projectionBudget: { maxRows: 18, maxChars: 3200, truncationPolicy: "priority_then_summary" },
});

assert.equal(snapshot.schema, RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA);
assert.equal(snapshot.identity.agentId, identity.agentId);
assert.equal(snapshot.identity.roleLane, "primary");
assert.equal(snapshot.identity.agentClass, "primary_resident");
assert.equal(snapshot.identity.currentThreadRef.threadId, "direct_session_current");
assert.equal(snapshot.continuity.linkedThreadCount, 2);
assert.equal(snapshot.continuity.activeRunCount, 1);
assert.equal(snapshot.continuity.currentRunRef.agentRunId, "agent_run_current");
assert.equal(snapshot.continuity.fullLinkedThreadIdsIncluded, false);
assert.deepEqual(snapshot.continuity.linkedThreadIds, []);
assert.equal(snapshot.memoryScopeInventory.rowCount, 3);
assert.equal(snapshot.memoryScopeInventory.contentSummariesIncluded, false);
assert.equal(snapshot.memoryScopeInventory.memoryIdsIncluded, false);
assert.equal(snapshot.memoryScopeInventory.countsByScope.project_role, 2);
assert.equal(snapshot.memoryScopeInventory.countsByScope.work_thread, 1);
assert.equal(snapshot.capabilityWitness.rowCount, toolCapabilityRegistry.rows.length);
assert.equal(snapshot.capabilityWitness.capabilityRowsIncludeAuthority, false);
assert.equal(snapshot.contextWitness.schema, RESIDENT_AGENT_CONTEXT_WITNESS_SCHEMA);
assert.equal(snapshot.contextWitness.grantsAuthority, false);
assert.equal(snapshot.contextWitness.rawPrivateMemoryIncluded, false);
assert.equal(snapshot.contextWitness.fullLinkedThreadIdsIncluded, false);
assert.equal(snapshot.contextWitness.broadCrossThreadTranscriptIncluded, false);
assert.equal(snapshot.contextWitness.contextItem.grantsAuthority, false);
assert.equal(snapshot.rawPrivateMemoryIncluded, false);
assert.equal(snapshot.rawTranscriptIncluded, false);
assert.equal(snapshot.authorityGranted, false);
assert.equal(snapshot.residentEpistemicSnapshot.rows.some((row) => row.family === "agent_identity"), true);
assert.equal(snapshot.residentEpistemicSnapshot.rows.some((row) => row.family === "agent_continuity"), true);
assert.equal(snapshot.residentEpistemicSnapshot.rows.some((row) => row.family === "agent_memory"), true);
assert.equal(snapshot.residentEpistemicSnapshot.rows.some((row) => row.subjectKind === "tool"), true);
assert.match(snapshot.contextWitness.compactText, /agentId=agent_project_primary/);
assert.match(snapshot.contextWitness.compactText, /linked thread/);
assert.doesNotMatch(JSON.stringify(snapshot), /This content summary must not appear/);
assert.doesNotMatch(JSON.stringify(snapshot), /direct_session_prior","direct_session_current/);
validateResidentAgentIdentitySnapshot(snapshot);

const mutated = {
  ...snapshot,
  continuity: {
    ...snapshot.continuity,
    linkedThreadIds: ["direct_session_prior"],
  },
};
assert.throws(() => validateResidentAgentIdentitySnapshot(mutated), /linked_ids_exposed/);

const memoryLeak = {
  ...snapshot,
  memoryScopeInventory: {
    ...snapshot.memoryScopeInventory,
    contentSummariesIncluded: true,
  },
};
assert.throws(() => validateResidentAgentIdentitySnapshot(memoryLeak), /memory_content_exposed/);

const authorityLeak = {
  ...snapshot,
  contextWitness: {
    ...snapshot.contextWitness,
    grantsAuthority: true,
  },
};
assert.throws(() => validateResidentAgentIdentitySnapshot(authorityLeak), /authority_leak/);

console.log("direct resident agent identity snapshot regression passed");
