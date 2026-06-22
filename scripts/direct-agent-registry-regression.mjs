#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DirectAgentRegistryStore,
  agentIdFor,
  defaultResidentAgentInputForSession,
} from "../src/main/direct/bridge/agent-registry.js";
import {
  DirectSessionStore,
} from "../src/main/direct/session/session-store.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mkTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-agent-registry-"));
}

function createSessions(sessionStore) {
  const base = {
    projectId: "codex-review-shell-direct",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    runtimeMode: "direct-implementation",
  };
  const primaryA = sessionStore.createSession({
    ...base,
    sessionId: "direct_session_primary_a",
    title: "Primary session A",
    agentLabel: "Rose main helper",
  }, { nowMs: Date.parse("2026-06-20T10:00:00.000Z") });
  const primaryB = sessionStore.createSession({
    ...base,
    sessionId: "direct_session_primary_b",
    title: "Primary session B",
    agentLabel: "Different visible label",
  }, { nowMs: Date.parse("2026-06-20T10:01:00.000Z") });
  const worker = sessionStore.createSession({
    ...base,
    sessionId: "direct_session_worker_a",
    title: "Worker session",
    agentKind: "worker",
    agentRole: "implementation worker",
    agentThreadId: "worker_provider_thread_a",
    parentThreadId: "direct_session_primary_a",
    primaryThreadId: "direct_session_primary_a",
    agentLabel: "Carver",
  }, { nowMs: Date.parse("2026-06-20T10:02:00.000Z") });
  const otherProject = sessionStore.createSession({
    ...base,
    projectId: "other-project",
    sessionId: "direct_session_other_project",
    title: "Other project session",
    agentLabel: "Rose main helper",
  }, { nowMs: Date.parse("2026-06-20T10:03:00.000Z") });
  return { primaryA, primaryB, worker, otherProject };
}

function main() {
  const rootDir = mkTempRoot();
  try {
    const sessionStore = new DirectSessionStore({ rootDir });
    const sessions = createSessions(sessionStore);
    const beforePrimaryA = sessionStore.readSession(sessions.primaryA.sessionId);
    const beforePrimaryB = sessionStore.readSession(sessions.primaryB.sessionId);

    const registry = new DirectAgentRegistryStore({
      rootDir,
      now: () => Date.parse("2026-06-20T11:00:00.000Z"),
    });
    const report = registry.backfillFromSessionStore(sessionStore, {
      projectId: "codex-review-shell-direct",
    });

    assert(report.schema === "direct_agent_registry_backfill_report@1", "backfill report schema mismatch");
    assert(report.sessionRewritePerformed === false, "agent backfill must not rewrite sessions");
    assert(report.touchedAgentCount === 2, `expected primary + worker identities, got ${report.touchedAgentCount}`);
    assert(report.touchedThreadLinkCount === 3, `expected 3 project thread links, got ${report.touchedThreadLinkCount}`);
    assert(report.status.projectionDigest === report.projection.projectionDigest, "backfill status must cite the attached projection digest");

    const afterPrimaryA = sessionStore.readSession(sessions.primaryA.sessionId);
    const afterPrimaryB = sessionStore.readSession(sessions.primaryB.sessionId);
    assert(JSON.stringify(beforePrimaryA) === JSON.stringify(afterPrimaryA), "primary session A was destructively rewritten");
    assert(JSON.stringify(beforePrimaryB) === JSON.stringify(afterPrimaryB), "primary session B was destructively rewritten");

    const primaryAgentId = agentIdFor(defaultResidentAgentInputForSession(sessions.primaryA));
    const primaryIdentity = registry.readAgentIdentity(primaryAgentId);
    assert(primaryIdentity, "missing default resident primary identity");
    assert(primaryIdentity.identityConfidence === "backfilled", "default resident identity must be backfilled");
    assert(primaryIdentity.backfillPolicy?.grouping === "project_role_lane", "resident backfill must group by project + role lane");
    assert(primaryIdentity.backfillPolicy?.mayMergeByDisplayLabel === false, "resident backfill must not merge by display label");
    assert(primaryIdentity.backfillPolicy?.mayRewriteSessions === false, "resident backfill must not rewrite sessions");
    assert(primaryIdentity.linkedThreadIds.length === 2, `expected 2 primary links, got ${primaryIdentity.linkedThreadIds.length}`);
    assert(primaryIdentity.linkedThreadIds.includes("direct_session_primary_a"), "missing primary A link");
    assert(primaryIdentity.linkedThreadIds.includes("direct_session_primary_b"), "missing primary B link");
    assert(!primaryIdentity.linkedThreadIds.includes("direct_session_other_project"), "cross-project session leaked into identity");
    assert(primaryIdentity.agentId !== sessions.primaryA.sessionId, "agent identity must not be the thread id");
    assert(primaryIdentity.agentId !== sessions.primaryA.agentLabel, "agent identity must not be the display label");
    assert(primaryIdentity.rawTextIncluded === false && primaryIdentity.rawPathIncluded === false, "identity must be renderer-safe");

    const workerAgentId = agentIdFor(defaultResidentAgentInputForSession(sessions.worker));
    const workerIdentity = registry.readAgentIdentity(workerAgentId);
    assert(workerIdentity, "missing worker identity");
    assert(workerIdentity.agentClass === "implementation_worker", "worker class not preserved");
    assert(workerIdentity.roleLane === "implementation", "worker role lane mismatch");
    assert(workerIdentity.linkedThreadIds.length === 1, "worker identity should link only one worker thread");

    const links = registry.listThreadLinks({ projectId: "codex-review-shell-direct" });
    assert(links.length === 3, `expected 3 thread links, got ${links.length}`);
    assert(links.every((link) => link.schema === "direct_agent_thread_link@1"), "thread link schema mismatch");
    assert(links.every((link) => link.sourceRefs.length >= 1), "thread links must cite session/thread evidence");
    assert(links.every((link) => link.rawTextIncluded === false && link.rawPathIncluded === false), "thread links must be renderer-safe");
    assert(links.some((link) => link.threadId === "direct_session_worker_a" && link.relationship === "worker_thread"), "worker relationship missing");
    assert(links.some((link) => link.threadId === "direct_session_primary_a" && link.relationship === "primary_thread"), "primary relationship missing");

    const projection = registry.buildProjection({ projectId: "codex-review-shell-direct" });
    assert(projection.schema === "direct_agent_registry_projection@1", "projection schema mismatch");
    assert(projection.rowCount === 2, "projection should include primary + worker");
    assert(projection.backfilledCount === 2, "projection should report backfilled identities");
    assert(projection.rows.every((row) => row.rawTextIncluded === false && row.rawPathIncluded === false), "projection rows must be renderer-safe");

    const status = registry.status({ projectId: "codex-review-shell-direct" });
    assert(status.schema === "direct_agent_registry_status@1", "status schema mismatch");
    assert(status.available === true, "registry should be available");
    assert(status.state === "healthy", `expected healthy status, got ${status.state}`);
    assert(status.agentCount === 2, "status agent count mismatch");
    assert(status.threadLinkCount === 3, "status thread link count mismatch");
    assert(status.registryPathExposed === false, "status must not expose registry path");

    const secondReport = registry.backfillFromSessionStore(sessionStore, {
      projectId: "codex-review-shell-direct",
    });
    assert(secondReport.status.projectionDigest === secondReport.projection.projectionDigest, "second backfill status/projection digest mismatch");
    assert(secondReport.projection.rowCount === 2, "idempotent backfill changed agent count");
    assert(registry.listThreadLinks({ projectId: "codex-review-shell-direct" }).length === 3, "idempotent backfill duplicated links");

    console.log("direct-agent-registry regression passed");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

main();
