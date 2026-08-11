import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directoryModel = require(path.join(repoRoot, "src/renderer/direct-thread-directory-model.js"));
const { DirectSessionStore } = require(path.join(repoRoot, "src/main/direct/session/session-store.js"));
const { DirectFixtureController } = require(path.join(repoRoot, "src/main/direct/controller/fixture-controller.js"));
const { buildDirectThreadDeckProjection } = require(path.join(repoRoot, "src/main/direct/thread/thread-deck.js"));

const rawWslPath = "/home/rose/work/private-project";
const rawRolloutPath = "/home/rose/.codex/sessions/2026/private.jsonl";
const rawCursor = "opaque-provider-cursor-secret";

const appServerDirectory = directoryModel.normalizeThreadDirectory({
  data: [{
    id: "app-thread-2",
    name: "Investigate transport continuity",
    preview: "Investigate transport continuity",
    cwd: rawWslPath,
    path: rawRolloutPath,
    source: { vscode: {} },
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
    modelProvider: "openai",
    createdAt: 1_786_435_200,
    updatedAt: 1_786_438_800,
    turns: [{ id: "turn-a" }],
  }, {
    id: "app-thread-1",
    preview: "Older CLI thread",
    cwd: rawWslPath,
    path: rawRolloutPath,
    source: "cli",
    status: { type: "notLoaded" },
    createdAt: 1_786_348_800,
    updatedAt: 1_786_352_400,
    turns: [],
  }],
  nextCursor: rawCursor,
  backwardsCursor: "opaque-backwards-cursor-secret",
}, {
  projectId: "project-app-server",
  runtimePath: "app-server",
  observedAt: "2026-08-11T12:00:00.000Z",
  capabilities: { canRead: true, canResume: true },
});

assert.equal(appServerDirectory.schema, "direct_workbench_thread_directory@1");
assert.equal(appServerDirectory.runtimePath, "app-server");
assert.equal(appServerDirectory.status, "partial");
assert.equal(appServerDirectory.partial, true);
assert.equal(appServerDirectory.counts.rows, 2);
assert.equal(appServerDirectory.counts.running, 1);
assert.deepEqual(appServerDirectory.rows.map((row) => row.threadId), ["app-thread-2", "app-thread-1"]);
assert.equal(appServerDirectory.rows[0].schema, "direct_workbench_thread_directory_row@1");
assert.equal(appServerDirectory.rows[0].sourceKind, "vscode");
assert.equal(appServerDirectory.rows[0].sourceLabel, "VS Code");
assert.equal(appServerDirectory.rows[0].runtimeLabel, "App Server");
assert.equal(appServerDirectory.rows[0].continuationMode, "provider_resume");
assert.equal(appServerDirectory.rows[0].lifecycleState, "active");
assert.equal(appServerDirectory.rows[0].activeTurnCount, 1);
assert.match(appServerDirectory.rows[0].updatedAt, /^2026-/);
assert.equal(appServerDirectory.rows[1].sourceLabel, "Codex CLI");
assert.equal(appServerDirectory.rows[1].lifecycleState, "not-loaded");
assert.equal(directoryModel.assertRendererSafe(appServerDirectory), true);
const serializedAppServerDirectory = JSON.stringify(appServerDirectory);
assert.equal(serializedAppServerDirectory.includes(rawWslPath), false);
assert.equal(serializedAppServerDirectory.includes(rawRolloutPath), false);
assert.equal(serializedAppServerDirectory.includes(rawCursor), false);
assert.equal(serializedAppServerDirectory.includes("backwardsCursor"), false);

const directDeck = buildDirectThreadDeckProjection({
  projectId: "project-direct",
  runtime: "direct-live-text",
  threads: [{
    id: "direct-thread-new",
    projectId: "project-direct",
    title: "New Direct work",
    status: "completed",
    createdAt: "2026-08-10T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
    model: "gpt-5.6-sol",
    turnCount: 2,
  }, {
    id: "direct-thread-old",
    projectId: "project-direct",
    title: "Old Direct work",
    status: "completed",
    storageState: "session_unreadable",
    createdAt: "2026-08-09T09:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
  }],
  canStart: true,
});
const directDirectory = directoryModel.normalizeThreadDirectory({
  threads: [{ id: "ignored-when-deck-present" }],
  deck: directDeck,
}, {
  projectId: "project-direct",
  runtimePath: "direct-text",
  capabilities: { canRead: true },
});

assert.equal(directDirectory.partial, false);
assert.equal(directDirectory.rows.length, 2);
assert.equal(directDirectory.rows[0].threadId, "direct-thread-new");
assert.equal(directDirectory.rows[0].sourceKind, "direct");
assert.equal(directDirectory.rows[0].continuationMode, "direct_project_read");
assert.equal(directDirectory.rows[0].focusEligible, true);
assert.equal(directDirectory.rows[1].focusEligible, false);
assert.deepEqual(directDirectory.rows[1].blockerCodes, ["session_unreadable"]);

const focusable = directDirectory.rows[0];
assert.deepEqual(directoryModel.resolveThreadFocusPosture(focusable, {
  activeThreadId: "another-thread",
  directoryStatus: "ready",
}), {
  selected: false,
  enabled: true,
  state: "available",
  blockerCodes: [],
});
assert.deepEqual(directoryModel.resolveThreadFocusPosture(focusable, {
  activeThreadId: focusable.threadId,
  activeThreadAttached: true,
}), {
  selected: true,
  enabled: false,
  state: "active",
  blockerCodes: ["thread_already_active"],
});
assert.deepEqual(directoryModel.resolveThreadFocusPosture(focusable, {
  activeThreadId: focusable.threadId,
  activeThreadAttached: false,
}), {
  selected: false,
  enabled: true,
  state: "available",
  blockerCodes: [],
});
assert.equal(directoryModel.pendingProviderRequestCount([
  { threadId: "active-thread", status: "pending" },
  { threadId: "background-thread", status: "pending" },
  { params: { sessionId: "active-thread" }, status: "responding" },
  { params: { threadId: "active-thread" }, status: "resolved" },
  { status: "pending" },
], "active-thread"), 2);
assert.equal(directoryModel.pendingProviderRequestCount([
  { threadId: "background-thread", status: "pending" },
], "active-thread"), 0);
for (const [options, expectedCode] of [
  [{ currentTurnActive: true }, "active_turn_in_current_thread"],
  [{ pendingProviderRequestCount: 1 }, "pending_provider_request_in_current_thread"],
  [{ transitionState: "opening", transitionTargetThreadId: focusable.threadId }, "thread_focus_transition_in_progress"],
  [{ directoryStatus: "loading" }, "thread_directory_loading"],
  [{ directoryStatus: "error" }, "thread_directory_refresh_failed"],
]) {
  const posture = directoryModel.resolveThreadFocusPosture(focusable, {
    activeThreadId: "another-thread",
    directoryStatus: "ready",
    ...options,
  });
  assert.equal(posture.enabled, false);
  assert.equal(posture.blockerCodes.includes(expectedCode), true);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-workbench-thread-directory-"));
try {
  const sessionStore = new DirectSessionStore({ rootDir: fixtureRoot });
  sessionStore.ensure();
  const projectAOlder = sessionStore.createSession({
    projectId: "project-a",
    title: "Project A older",
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
  });
  const projectANewer = sessionStore.createSession({
    projectId: "project-a",
    title: "Project A newer",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  });
  const projectB = sessionStore.createSession({
    projectId: "project-b",
    title: "Project B private",
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
  });
  const fixtureController = new DirectFixtureController({ sessionStore });
  const fixtureList = fixtureController.listThreads({
    limit: 10,
    projectId: "project-b",
  }, {
    project: { id: "project-a", name: "Project A" },
  });

  assert.equal(fixtureList.schema, "direct_thread_list@1");
  assert.equal(fixtureList.runtime, "direct-fixture");
  assert.equal(fixtureList.projectId, "project-a");
  assert.deepEqual(fixtureList.threads.map((thread) => thread.threadId), [projectANewer.sessionId, projectAOlder.sessionId]);
  assert.equal(fixtureList.threads.some((thread) => thread.threadId === projectB.sessionId), false);
  assert.equal(fixtureList.deck.runtime, "direct-fixture");
  assert.equal(fixtureList.deck.counts.rows, 2);
  assert.equal(fixtureList.rawPathsExposed, false);
  assert.equal(fixtureController.readThread({ threadId: projectANewer.sessionId }, {
    project: { id: "project-a" },
  }).thread.id, projectANewer.sessionId);
  assert.throws(
    () => fixtureController.readThread({ threadId: projectB.sessionId }, { project: { id: "project-a" } }),
    /active project/,
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("Direct Workbench runtime-neutral thread directory regression passed.");
