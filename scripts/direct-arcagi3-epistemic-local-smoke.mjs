#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectEpistemicService } = require("../src/main/direct/epistemic/service");
const { persistNativeChildProviderTurn } = require("../src/main/direct/epistemic/native-child-capture");
const {
  inspectArcagi3Repository,
  profile,
} = require("../src/main/direct/epistemic/repository-runtime");

const repoRoot = path.resolve(
  process.argv[2] || process.env.ARCAGI3_REPO || "/home/rose/work/arcagi3-odeu-local",
);

function gitStatus() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(result.status, 0, String(result.stderr || "git status failed"));
  return Buffer.from(result.stdout);
}

assert.ok(fs.existsSync(path.join(repoRoot, "AGENTS.md")), `ArcAGI3 repository not found at ${repoRoot}`);
const statusBefore = gitStatus();
const observationBefore = inspectArcagi3Repository(repoRoot);
assert.equal(observationBefore.observationComplete, true, "actual ArcAGI3 observation must be complete");
assert.equal(observationBefore.captureCoherent, true, "actual ArcAGI3 observation must have a coherent before/after witness");
assert.deepEqual(observationBefore.validationOmissions, []);
assert.equal(observationBefore.sources.length, profile.sources.length);
assert.equal(observationBefore.sources.every((source) => source.validationPosture === "exact"), true);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-arcagi3-epistemic-smoke-"));
const sessionStore = new DirectSessionStore({ rootDir: path.join(tempRoot, "sessions") });
sessionStore.ensure();
const session = sessionStore.createSession({
  sessionId: "arcagi3_smoke_session",
  projectId: "project_arcagi3_local",
  title: "ArcAGI3 epistemic smoke thread",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  agentId: "arcagi3_smoke_observer",
  agentRole: "read_only_observer",
});
const turn = sessionStore.createTurn(session.sessionId, {
  turnId: "arcagi3_smoke_turn",
  state: "completed",
});
sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
  { type: "session_started", sequence: 0, responseId: "smoke_response", model: "gpt-5.6-sol" },
  { type: "message_delta", sequence: 1, itemId: "smoke_message", text: "The repository profile was inspected read-only." },
  { type: "response_completed", sequence: 2, responseId: "smoke_response", stopReason: "completed" },
]);
const childCapture = persistNativeChildProviderTurn(sessionStore, {
  projectId: "project_arcagi3_local",
  workThreadId: "arcagi3_smoke_parallel_workthread",
  primaryThreadId: session.sessionId,
  agent: {
    agentThreadId: "arcagi3_smoke_native_child",
    displayLabel: "Native child Arc boundary observer",
    role: "boundary_observer",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  },
  requestBody: { model: "gpt-5.6-sol", reasoning: { effort: "high" } },
  promptDigest: "sha256:read_only_arcagi3_smoke_prompt",
  contextDigest: "sha256:read_only_arcagi3_smoke_context",
}, {
  terminal: { state: "completed" },
  responseId: "arcagi3_smoke_child_response",
  normalizedEvents: [
    { type: "session_started", sequence: 0, responseId: "arcagi3_smoke_child_response", model: "gpt-5.6-sol" },
    { type: "message_delta", sequence: 1, itemId: "arcagi3_smoke_child_message", text: "The child observed the ArcAGI3 boundary without mutating the repository." },
    { type: "response_completed", sequence: 2, responseId: "arcagi3_smoke_child_response", stopReason: "completed" },
  ],
});

const service = new DirectEpistemicService({
  rootDir: tempRoot,
  sessionStore,
});
const project = {
  id: "project_arcagi3_local",
  workspace: { kind: "wsl", linuxPath: repoRoot },
};
const repository = service.initializeRepository(project);
const thread = service.syncThread(session.sessionId);
const childThread = service.syncThread(childCapture.sessionId);
const repoContext = service.importContext({
  projectId: project.id,
  subjectKind: "repository",
  portName: "repo.failure_diagnosis",
  purpose: "read-only local ArcAGI3 pilot",
});
const threadContext = service.importContext({
  projectId: project.id,
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.execution_outcomes",
  purpose: "verify pilot observation outcome",
});
const snapshot = service.snapshot(project);

assert.equal(repository.observation.observationComplete, true);
assert.ok(repository.recordCount >= 10);
assert.equal(repository.ports.length, 6);
assert.ok(repoContext.records.some((record) => record.semanticKey === "arcagi3.earliest_invalid_odeu_boundary"));
assert.ok(thread.recordCount >= 3);
assert.ok(childThread.recordCount >= 3);
assert.ok(threadContext.records.some((record) => record.recordType === "TurnOutcome"));
assert.equal(JSON.stringify(snapshot).includes(repoRoot), false);
assert.ok(snapshot.threads.some((entry) => entry.subject.label === "Native child Arc boundary observer"));

const statusAfter = gitStatus();
assert.deepEqual(statusAfter, statusBefore, "the read-only pilot must not alter ArcAGI3 Git state");
const observationAfter = inspectArcagi3Repository(repoRoot);
assert.equal(observationAfter.observationComplete, true);
assert.equal(observationAfter.worktreeDigest, observationBefore.worktreeDigest,
  "the read-only pilot must preserve tracked, dirty, untracked, and pinned-source content evidence");
assert.equal(observationAfter.sourceSetDigest, observationBefore.sourceSetDigest);
assert.equal(observationAfter.gitHead, observationBefore.gitHead);
service.close();
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  profile: repository.observation.profileId,
  gitHead: repository.observation.gitHead,
  dirty: repository.observation.dirty,
  statusEntryCount: repository.observation.statusEntryCount,
  captureCoherent: repository.observation.captureCoherent,
  captureAttempts: repository.observation.captureAttempts,
  validatedPinnedSources: repository.observation.validatedSourceCount,
  validationOmissions: repository.observation.validationOmissions,
  repositoryO: repository.oRevision.oRevisionId,
  repositoryE: repository.eRevision.eRevisionId,
  repositoryRecords: repository.recordCount,
  repositoryPorts: repository.ports.map((port) => port.name),
  threadO: thread.oRevision.oRevisionId,
  threadE: thread.eRevision.eRevisionId,
  threadRecords: thread.recordCount,
  nativeChildThreadRecords: childThread.recordCount,
  importedRepositoryRecords: repoContext.records.length,
  importedThreadRecords: threadContext.records.length,
  repositoryMutated: false,
}, null, 2));
