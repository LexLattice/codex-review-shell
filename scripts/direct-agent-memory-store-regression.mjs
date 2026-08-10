#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentMemoryStore,
  buildAgentMemoryRow,
  extractionTransitionIdFor,
  memoryContextEligible,
  memoryIdFor,
} from "../src/main/direct/bridge/agent-memory-store.js";

function mkTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-agent-memory-store-"));
}

function assertThrowsWith(fn, text) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `expected error containing ${text}`);
  assert(String(thrown.message).includes(text), `unexpected error: ${thrown.message}`);
}

function assertThrowsSyntaxError(fn) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof SyntaxError, `expected SyntaxError, got ${thrown?.name || "none"}`);
}

function main() {
  const rootDir = mkTempRoot();
  try {
    const store = new AgentMemoryStore({
      rootDir,
      now: () => Date.parse("2026-06-22T10:00:00.000Z"),
    });
    const projectId = "codex-review-shell-direct";
    const agentId = "direct_agent_memory_fixture";
    const acceptedMemoryId = memoryIdFor({
      projectId,
      agentId,
      kind: "preference",
      scope: { projectId, roleLane: "implementation", memoryScope: "project_role" },
      contentSummaryDigest: "sha256:accepted_summary",
      revision: 1,
    });
    const extractionTransitionId = extractionTransitionIdFor({
      projectId,
      agentId,
      extractionMode: "manual_fixture",
      outputMemoryIds: [acceptedMemoryId],
      sourceRefs: [{ kind: "direct_session", id: "direct_session_memory_source" }],
    });

    const transition = store.upsertExtractionTransition({
      extractionTransitionId,
      projectId,
      agentId,
      extractionMode: "manual_fixture",
      outputMemoryIds: [acceptedMemoryId],
      extractionPolicyId: "manual_fixture_memory_extraction@1",
      sourceRefs: [{ kind: "direct_session", id: "direct_session_memory_source" }],
    });
    assert.equal(transition.schema, "direct_agent_memory_extraction_transition@1");
    assert.equal(transition.rawTranscriptIncluded, false);

    const accepted = store.upsertMemoryRow({
      memoryId: acceptedMemoryId,
      projectId,
      agentId,
      scope: { projectId, roleLane: "implementation", memoryScope: "project_role" },
      kind: "preference",
      contentSummary: "Use concise implementation summaries when closing direct harness PRs.",
      contentSummaryDigest: "sha256:accepted_summary",
      summaryPolicyId: "manual_fixture_summary@1",
      provenance: {
        sourceThreadIds: ["direct_session_memory_source"],
        sourceTurnIds: ["direct_turn_memory_source"],
        sourceArtifactRefs: [{ kind: "thread_summary", id: "thread_summary_memory_source" }],
        extractionTransitionId,
      },
      confidence: "high",
      authorityUse: "preference_hint",
      contextEligibility: "eligible",
      conflictState: "none",
      conflictResolution: "unknown",
      auditState: "accepted",
      revision: 1,
    });
    assert.equal(accepted.schema, "direct_agent_memory_row@1");
    assert.equal(accepted.actionAuthorityGranted, false);
    assert.equal(accepted.rawTranscriptIncluded, false);
    assert.equal(accepted.rawPathIncluded, false);
    assert.equal(accepted.rawSecretIncluded, false);
    assert.equal(memoryContextEligible(accepted, { projectId, roleLane: "implementation", nowMs: Date.parse("2026-06-22T10:00:00.000Z") }), true);
    assert.equal(memoryContextEligible(accepted, { projectId, roleLane: "research", nowMs: Date.parse("2026-06-22T10:00:00.000Z") }), false);
    assert.equal(memoryContextEligible(accepted, { projectId, nowMs: Date.parse("2026-06-22T10:00:00.000Z") }), false);

    const duplicate = store.upsertMemoryRow({
      ...accepted,
      provenance: {
        ...accepted.provenance,
        sourceArtifactRefs: [{ kind: "thread_summary", id: "thread_summary_memory_source" }],
      },
    });
    assert.equal(duplicate.provenance.sourceArtifactRefs.length, 1, "source artifact refs should dedupe");

    const blockedRows = [
      {
        suffix: "candidate",
        confidence: "candidate",
        auditState: "accepted",
        conflictState: "none",
        contextEligibility: "eligible",
        expectedEligibility: "not_eligible_candidate",
      },
      {
        suffix: "stale",
        confidence: "stale",
        auditState: "accepted",
        conflictState: "none",
        contextEligibility: "eligible",
        expectedEligibility: "not_eligible_stale",
      },
      {
        suffix: "conflicted",
        confidence: "high",
        auditState: "accepted",
        conflictState: "conflicts_with_current_user",
        contextEligibility: "eligible",
        expectedEligibility: "not_eligible_conflicted",
      },
      {
        suffix: "rejected",
        confidence: "high",
        auditState: "rejected",
        conflictState: "none",
        contextEligibility: "eligible",
        expectedEligibility: "not_eligible_rejected",
      },
    ];
    for (const row of blockedRows) {
      const memoryId = `direct_agent_memory_${row.suffix}`;
      const transitionId = `direct_agent_memory_extraction_${row.suffix}`;
      store.upsertExtractionTransition({
        extractionTransitionId: transitionId,
        projectId,
        agentId,
        extractionMode: "operator_curated",
        outputMemoryIds: [memoryId],
        sourceRefs: [{ kind: "operator_note", id: `operator_note_${row.suffix}` }],
      });
      const memory = store.upsertMemoryRow({
        memoryId,
        projectId,
        agentId,
        scope: { projectId, memoryScope: "agent_private" },
        kind: "decision",
        contentSummary: `${row.suffix} memory remains visible but not context eligible.`,
        provenance: {
          sourceArtifactRefs: [{ kind: "operator_note", id: `operator_note_${row.suffix}` }],
          extractionTransitionId: transitionId,
        },
        confidence: row.confidence,
        authorityUse: "context_evidence",
        contextEligibility: row.contextEligibility,
        conflictState: row.conflictState,
        conflictResolution: "memory_omitted",
        auditState: row.auditState,
      });
      assert.equal(memory.contextEligibility, row.expectedEligibility);
      assert.equal(memoryContextEligible(memory, { projectId }), false);
    }

    const patternTransitionId = "direct_agent_memory_extraction_pattern";
    store.upsertExtractionTransition({
      extractionTransitionId: patternTransitionId,
      projectId,
      agentId,
      extractionMode: "manual_fixture",
      outputMemoryIds: ["direct_agent_memory_pattern"],
      sourceRefs: [{ kind: "manual_fixture", id: "manual_fixture_pattern" }],
    });
    const pattern = store.upsertMemoryRow({
      memoryId: "direct_agent_memory_pattern",
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "pattern",
      contentSummary: "Pattern memory should not be context eligible in V0.",
      provenance: {
        sourceArtifactRefs: [{ kind: "manual_fixture", id: "manual_fixture_pattern" }],
        extractionTransitionId: patternTransitionId,
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    });
    assert.equal(memoryContextEligible(pattern, { projectId }), false);

    const workThreadTransitionId = "direct_agent_memory_extraction_work_thread";
    store.upsertExtractionTransition({
      extractionTransitionId: workThreadTransitionId,
      projectId,
      agentId,
      extractionMode: "manual_fixture",
      outputMemoryIds: ["direct_agent_memory_work_thread"],
      sourceRefs: [{ kind: "manual_fixture", id: "manual_fixture_work_thread" }],
    });
    const workThreadMemory = store.upsertMemoryRow({
      memoryId: "direct_agent_memory_work_thread",
      projectId,
      agentId,
      scope: { projectId, workThreadId: "work_thread_alpha", memoryScope: "work_thread" },
      kind: "procedure",
      contentSummary: "Work-thread memory must match the active work thread.",
      provenance: {
        sourceArtifactRefs: [{ kind: "manual_fixture", id: "manual_fixture_work_thread" }],
        extractionTransitionId: workThreadTransitionId,
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    });
    assert.equal(memoryContextEligible(workThreadMemory, { projectId, workThreadId: "work_thread_alpha" }), true);
    assert.equal(memoryContextEligible(workThreadMemory, { projectId, workThreadId: "work_thread_beta" }), false);

    assertThrowsWith(() => store.upsertMemoryRow({
      memoryId: "direct_agent_memory_no_transition",
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "decision",
      contentSummary: "Missing transition should fail.",
      provenance: {
        sourceArtifactRefs: [{ kind: "operator_note", id: "missing_transition" }],
        extractionTransitionId: "direct_agent_memory_extraction_missing",
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    }), "real AgentMemoryExtractionTransition");

    assertThrowsWith(() => store.upsertMemoryRow({
      memoryId: "direct_agent_memory_missing_transition_and_source",
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "decision",
      contentSummary: "Missing transition should be reported before missing source.",
      provenance: {
        extractionTransitionId: "direct_agent_memory_extraction_missing_and_no_source",
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    }), "real AgentMemoryExtractionTransition");

    assertThrowsWith(() => store.upsertExtractionTransition({
      extractionTransitionId: "direct_agent_memory_extraction_missing_agent",
      projectId,
      extractionMode: "manual_fixture",
      outputMemoryIds: ["direct_agent_memory_missing_agent"],
      sourceRefs: [{ kind: "manual_fixture", id: "missing_agent" }],
    }), "requires agentId");

    const futureModeTransitionId = "direct_agent_memory_extraction_automated";
    store.upsertExtractionTransition({
      extractionTransitionId: futureModeTransitionId,
      projectId,
      agentId,
      extractionMode: "automated_candidate",
      outputMemoryIds: ["direct_agent_memory_automated"],
      sourceRefs: [{ kind: "direct_session", id: "direct_session_automated" }],
    });
    assertThrowsWith(() => store.upsertMemoryRow({
      memoryId: "direct_agent_memory_automated",
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "decision",
      contentSummary: "Automated candidate cannot materialize as memory in V0.",
      provenance: {
        sourceThreadIds: ["direct_session_automated"],
        extractionTransitionId: futureModeTransitionId,
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    }), "manual fixture/operator curated");

    const expiredAtEpoch = buildAgentMemoryRow({
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "risk",
      contentSummary: "Epoch-expired memory should respect nowMs=0.",
      provenance: {
        sourceArtifactRefs: [{ kind: "manual_fixture", id: "epoch_expiry" }],
        extractionTransitionId,
      },
      confidence: "high",
      authorityUse: "context_evidence",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
      expiresAt: "1970-01-01T00:00:00.000Z",
    }, { nowMs: 0 });
    assert.equal(expiredAtEpoch.contextEligibility, "not_eligible_stale");

    const projection = store.buildInventoryProjection({ projectId, agentId, roleLane: "implementation" });
    assert.equal(projection.schema, "direct_agent_memory_inventory_projection@1");
    assert.equal(projection.rowCount, 7);
    assert.equal(projection.contextEligibleCount, 1);
    assert.equal(projection.rejectedCount, 1);
    assert.equal(projection.staleCount, 1);
    assert.equal(projection.conflictedCount, 1);
    assert.equal(projection.candidateCount, 1);
    assert(projection.rows.some((row) => row.memoryId === acceptedMemoryId && row.contextEligible === true));
    assert(projection.rows.some((row) => row.memoryId === "direct_agent_memory_pattern" && row.contextEligible === false));
    assert(projection.rows.every((row) => row.rawTranscriptIncluded === false && row.rawPathIncluded === false && row.rawSecretIncluded === false));
    assert.equal(projection.rawTranscriptIncluded, false);
    assert(!JSON.stringify(projection).includes("providerContext"));
    assert(!JSON.stringify(projection).includes("actionAuthorityGranted\":true"));

    const scopeMismatchProjection = store.buildInventoryProjection({ projectId, agentId, roleLane: "research", workThreadId: "work_thread_beta" });
    assert.equal(scopeMismatchProjection.contextEligibleCount, 0);

    const corruptRoot = mkTempRoot();
    try {
      const corruptStore = new AgentMemoryStore({ rootDir: corruptRoot });
      corruptStore.ensureRoot();
      fs.writeFileSync(path.join(corruptRoot, "agent-memory", "index.json"), "{ invalid json", "utf8");
      assertThrowsSyntaxError(() => corruptStore.readIndex());
    } finally {
      fs.rmSync(corruptRoot, { recursive: true, force: true });
    }

    const builtOnly = buildAgentMemoryRow({
      projectId,
      agentId,
      scope: { projectId, memoryScope: "agent_private" },
      kind: "risk",
      contentSummary: "Pure builder cannot authorize actions either.",
      provenance: {
        sourceArtifactRefs: [{ kind: "manual_fixture", id: "builder_only" }],
        extractionTransitionId,
      },
      confidence: "high",
      authorityUse: "constraint_candidate",
      contextEligibility: "eligible",
      conflictState: "none",
      auditState: "accepted",
    });
    assert.equal(builtOnly.actionAuthorityGranted, false);

    console.log("direct-agent-memory-store regression passed");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

main();
