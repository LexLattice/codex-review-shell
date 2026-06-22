#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DirectAgentRegistryStore,
  agentIdFor,
  buildAgentRun,
  defaultAgentRunInputForSession,
  defaultResidentAgentInputForSession,
} from "../src/main/direct/bridge/agent-registry.js";
import {
  DirectSessionStore,
} from "../src/main/direct/session/session-store.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mkTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-agent-run-links-"));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
    return output;
  }
  return value;
}

function legacyThreadLinkId(input = {}) {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue({
      projectId: input.projectId || "",
      agentId: input.agentId || "direct_agent",
      threadId: input.threadId || input.sessionId || "direct_session",
      relationship: input.relationship || "unknown",
    })))
    .digest("hex")
    .slice(0, 24);
  return `agent_thread_link_${digest}`;
}

function exerciseReviewEdgeCases() {
  const rootDir = mkTempRoot();
  try {
    const sessionStore = new DirectSessionStore({ rootDir });
    const registry = new DirectAgentRegistryStore({
      rootDir,
      now: () => Date.parse("2026-06-21T12:00:00.000Z"),
    });

    const declaredAgentId = "direct_agent_declared_primary";
    registry.upsertAgentIdentity({
      agentId: declaredAgentId,
      projectId: "codex-review-shell-direct",
      agentClass: "primary_coder",
      roleLane: "implementation",
      displayName: "Declared primary agent",
      identityConfidence: "declared",
      lifecycleState: "active",
    });

    const statusFixtures = [
      ["direct_session_done_terminal", "done", "completed"],
      ["direct_session_error_terminal", "error", "failed"],
      ["direct_session_response_incomplete_terminal", "response_incomplete", "failed"],
      ["direct_session_tool_blocked_terminal", "tool_call_blocked_text_only", "failed"],
    ];
    for (const [sessionId, status] of statusFixtures) {
      const session = sessionStore.createSession({
        sessionId,
        projectId: "codex-review-shell-direct",
        title: `${status} session`,
        agentId: declaredAgentId,
      }, { nowMs: Date.parse("2026-06-21T12:05:00.000Z") });
      sessionStore.writeSession({
        ...session,
        status,
        updatedAt: "2026-06-21T12:10:00.000Z",
      });
    }

    const legacySession = sessionStore.createSession({
      sessionId: "direct_session_legacy_link_migration",
      projectId: "codex-review-shell-direct",
      title: "Legacy link migration",
      agentId: declaredAgentId,
      agentRunId: "direct_agent_run_legacy_link_migration",
    }, { nowMs: Date.parse("2026-06-21T12:15:00.000Z") });
    const legacyLinkId = legacyThreadLinkId({
      projectId: legacySession.projectId,
      agentId: declaredAgentId,
      threadId: legacySession.sessionId,
      relationship: "owned_by_agent",
    });
    registry.upsertThreadLink({
      linkId: legacyLinkId,
      projectId: legacySession.projectId,
      agentId: declaredAgentId,
      threadId: legacySession.sessionId,
      sessionId: legacySession.sessionId,
      relationship: "owned_by_agent",
      linkState: "active",
      linkConfidence: "backfilled",
      sourceRefs: [{ kind: "direct_session", id: legacySession.sessionId }],
    });

    registry.upsertAgentRun({
      agentRunId: "direct_agent_run_dedup_refs",
      agentId: declaredAgentId,
      projectId: "codex-review-shell-direct",
      runKind: "resident_thread",
      objective: { objectiveKind: "interactive_resident", objectivePreview: "dedupe refs" },
      threadIds: ["direct_session_dedup_refs"],
      lifecycle: "running",
      contextPacketRefs: [{ kind: "ctx", id: "same-ref" }],
      sourceRefs: [{ kind: "direct_session", id: "direct_session_dedup_refs" }],
    });
    registry.upsertAgentRun({
      agentRunId: "direct_agent_run_dedup_refs",
      agentId: declaredAgentId,
      projectId: "codex-review-shell-direct",
      runKind: "resident_thread",
      objective: { objectiveKind: "interactive_resident", objectivePreview: "dedupe refs" },
      threadIds: ["direct_session_dedup_refs"],
      lifecycle: "running",
      contextPacketRefs: [{ kind: "ctx", id: "same-ref" }],
      sourceRefs: [{ kind: "direct_session", id: "direct_session_dedup_refs" }],
    });

    registry.backfillFromSessionStore(sessionStore, { projectId: "codex-review-shell-direct" });

    const identity = registry.readAgentIdentity(declaredAgentId);
    assert(identity.identityConfidence === "declared", "backfill must not downgrade declared identity confidence");

    const runs = registry.listAgentRuns({ projectId: "codex-review-shell-direct" });
    for (const [sessionId, , expectedLifecycle] of statusFixtures) {
      const run = runs.find((candidate) => candidate.threadIds.includes(sessionId));
      assert(run?.lifecycle === expectedLifecycle, `terminal session ${sessionId} mapped to ${run?.lifecycle}`);
      assert(run.endedAt === "2026-06-21T12:10:00.000Z", `terminal session ${sessionId} missing endedAt`);
    }
    const dedupRun = registry.readAgentRun("direct_agent_run_dedup_refs");
    assert(dedupRun.contextPacketRefs.length === 1, "agent run context refs should be deduplicated");
    assert(dedupRun.sourceRefs.length === 1, "agent run source refs should be deduplicated");

    const links = registry.listThreadLinks({ projectId: "codex-review-shell-direct" });
    assert(!links.some((link) => link.linkId === legacyLinkId), "legacy thread-link id should be migrated out of the index");
    const migratedLink = links.find((link) => link.threadId === legacySession.sessionId);
    assert(migratedLink?.agentRunId === legacySession.agentRunId, "migrated thread link should cite the bounded agent run");
    assert(migratedLink?.linkKind === "resident_primary", "migrated thread link should use current link kind");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

function main() {
  const rootDir = mkTempRoot();
  try {
    const sessionStore = new DirectSessionStore({ rootDir });
    const exactAgentId = "direct_agent_exact_primary";
    const exactRunId = "direct_agent_run_exact_primary_session";
    const linked = sessionStore.createSession({
      sessionId: "direct_session_exact_linked",
      projectId: "codex-review-shell-direct",
      title: "Exact linked resident session",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      agentId: exactAgentId,
      agentRunId: exactRunId,
      parentAgentId: "",
      parentAgentRunId: "",
    }, { nowMs: Date.parse("2026-06-21T10:00:00.000Z") });
    assert(linked.agentId === exactAgentId, "session should preserve optional agentId");
    assert(linked.agentRunId === exactRunId, "session should preserve optional agentRunId");

    const legacy = sessionStore.createSession({
      sessionId: "direct_session_legacy_worker",
      projectId: "codex-review-shell-direct",
      title: "Legacy worker session",
      model: "gpt-5.5",
      reasoningEffort: "high",
      agentKind: "worker",
      agentRole: "implementation worker",
      agentThreadId: "worker_provider_thread_legacy",
      parentThreadId: "direct_session_exact_linked",
      primaryThreadId: "direct_session_exact_linked",
      agentLabel: "Legacy Worker Label",
      workerContextPacketId: "worker_context_packet_1",
      workerContextPacketDigest: "sha256:worker_context_packet",
      workerStartTransitionDigest: "sha256:worker_start",
      workThreadId: "work_thread_direct",
    }, { nowMs: Date.parse("2026-06-21T10:05:00.000Z") });

    const registry = new DirectAgentRegistryStore({
      rootDir,
      now: () => Date.parse("2026-06-21T11:00:00.000Z"),
    });
    registry.upsertAgentIdentity({
      agentId: exactAgentId,
      projectId: "codex-review-shell-direct",
      agentClass: "primary_coder",
      roleLane: "implementation",
      displayName: "Exact primary agent",
      identityConfidence: "exact",
      lifecycleState: "active",
      linkedThreadIds: [linked.sessionId],
      activeRunIds: [exactRunId],
      sourceRefs: [{ kind: "manual_fixture", id: "exact_agent_identity" }],
    });
    const exactRun = registry.upsertAgentRun({
      agentRunId: exactRunId,
      agentId: exactAgentId,
      projectId: "codex-review-shell-direct",
      runKind: "resident_thread",
      objective: {
        objectiveKind: "interactive_resident",
        objectivePreview: "Exact linked resident session",
      },
      threadIds: [linked.sessionId],
      lifecycle: "running",
      sourceRefs: [{ kind: "direct_session", id: linked.sessionId }],
    });
    registry.upsertThreadLink({
      agentId: exactAgentId,
      agentRunId: exactRun.agentRunId,
      projectId: "codex-review-shell-direct",
      threadId: linked.sessionId,
      sessionId: linked.sessionId,
      linkKind: "resident_primary",
      relationship: "owned_by_agent",
      linkState: "active",
      sourceRefs: [{ kind: "direct_session", id: linked.sessionId }],
    });

    const runInput = defaultAgentRunInputForSession(legacy, agentIdFor(defaultResidentAgentInputForSession(legacy)));
    const builtRun = buildAgentRun(runInput, { nowMs: Date.parse("2026-06-21T11:00:00.000Z") });
    assert(builtRun.runKind === "spawned_worker", "legacy worker should map to spawned_worker run");
    assert(builtRun.objective.objectiveKind === "worker_task", "legacy worker objective kind mismatch");
    assert(builtRun.threadIds.includes(legacy.sessionId), "worker run should cite legacy session");
    assert(builtRun.contextPacketRefs.length === 1, "worker run should cite context packet evidence");
    assert(builtRun.workThreadId === "work_thread_direct", "worker run should preserve workThreadId");

    const backfill = registry.backfillFromSessionStore(sessionStore, { projectId: "codex-review-shell-direct" });
    assert(backfill.sessionRewritePerformed === false, "backfill must not rewrite sessions");

    const runs = registry.listAgentRuns({ projectId: "codex-review-shell-direct" });
    assert(runs.some((run) => run.agentRunId === exactRunId && run.lifecycle === "running"), "exact session run missing");
    assert(runs.some((run) => run.runKind === "spawned_worker" && run.threadIds.includes(legacy.sessionId)), "legacy worker run missing after backfill");
    assert(!runs.some((run) => run.runKind === "resident" && run.threadIds.length > 1), "resident runs must be bounded, not immortal cross-thread runs");

    const exactSessionAfter = sessionStore.readSession(linked.sessionId);
    const legacySessionAfter = sessionStore.readSession(legacy.sessionId);
    assert(exactSessionAfter.agentId === exactAgentId && exactSessionAfter.agentRunId === exactRunId, "linked session refs changed");
    assert(legacySessionAfter.agentId === "" && legacySessionAfter.agentRunId === "", "legacy session should not be rewritten with inferred refs");

    const links = registry.listThreadLinks({ projectId: "codex-review-shell-direct" });
    const exactLink = links.find((link) => link.threadId === linked.sessionId && link.agentRunId === exactRunId);
    assert(exactLink?.relationship === "owned_by_agent", "exact link should preserve owner relationship");
    const legacyLink = links.find((link) => link.threadId === legacy.sessionId);
    assert(legacyLink?.linkKind === "worker_thread", "legacy worker link kind mismatch");
    assert(legacyLink?.relationship === "parent_child", "legacy worker relationship mismatch");

    const missingRefSession = sessionStore.createSession({
      sessionId: "direct_session_missing_agent_ref",
      projectId: "codex-review-shell-direct",
      title: "Missing agent ref session",
      agentId: "direct_agent_missing",
      agentRunId: "direct_agent_run_missing",
    }, { nowMs: Date.parse("2026-06-21T10:10:00.000Z") });
    const missingRefState = registry.readAgentIdentity(missingRefSession.agentId) && registry.readAgentRun(missingRefSession.agentRunId)
      ? "linked"
      : "unknown_agent";
    assert(missingRefState === "unknown_agent", "missing refs must degrade to unknown_agent, not primary agent");

    const projection = registry.buildProjection({ projectId: "codex-review-shell-direct" });
    assert(projection.runCount >= 2, "projection should expose run count");
    assert(projection.rows.some((row) => row.agentId === exactAgentId && row.runCount >= 1), "projection should expose exact agent run count");
    assert(projection.rows.every((row) => row.rawTextIncluded === false && row.rawPathIncluded === false), "projection rows must remain renderer-safe");

    exerciseReviewEdgeCases();

    console.log("direct-agent-run-session-links regression passed");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

main();
