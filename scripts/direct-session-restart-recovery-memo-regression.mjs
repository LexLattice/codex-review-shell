#!/usr/bin/env node
// Restart recovery skips sessions whose files haven't changed since a launch
// found nothing to do in them, and still recovers anything that changed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-restart-recovery-memo-"));

// Files the previous run wrote long enough ago to be vouched for.
function ageFiles(directory, secondsAgo) {
  const at = new Date(Date.now() - secondsAgo * 1000);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) ageFiles(full, secondsAgo);
    else fs.utimesSync(full, at, at);
  }
}

// A fresh store per launch, counting reads of turn records.
function launch() {
  const originalRead = fs.readFileSync;
  const turnFilesRead = [];
  fs.readFileSync = function counted(file) {
    if (String(file).includes(`${path.sep}turns${path.sep}`)) turnFilesRead.push(String(file));
    return originalRead.apply(this, arguments);
  };
  try {
    const store = new DirectSessionStore({ rootDir: tempRoot });
    store.ensure();
    const result = store.recoverInterruptedTurns();
    return { store, result, turnReads: turnFilesRead.length, turnFilesRead };
  } finally {
    fs.readFileSync = originalRead;
  }
}

function memo() {
  const file = path.join(tempRoot, "restart-recovery-memo.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { sessions: {} };
}

try {
  const setup = new DirectSessionStore({ rootDir: tempRoot });
  setup.ensure();
  const quiet = setup.createSession({ projectId: "project-memo", title: "Finished thread" });
  setup.createTurn(quiet.sessionId, { turnId: "direct_turn_done", state: "completed", model: "gpt-5.5" });
  const later = setup.createSession({ projectId: "project-memo", title: "Thread that runs again" });
  setup.createTurn(later.sessionId, { turnId: "direct_turn_first", state: "completed", model: "gpt-5.5" });

  // Files written moments ago aren't memoized: the next launch reads them again.
  const fresh = launch();
  assert.equal(fresh.result.recoveredTurnCount, 0);
  assert.ok(fresh.turnReads >= 2, "the first launch reads every turn");
  assert.deepEqual(memo().sessions, {}, "just-written files are not vouched for");
  assert.ok(launch().turnReads >= 2, "still read while the files are fresh");

  ageFiles(tempRoot, 120);
  const settling = launch();
  assert.ok(settling.turnReads >= 2);
  assert.deepEqual(Object.keys(memo().sessions).sort(), [quiet.sessionId, later.sessionId].sort());

  const skipped = launch();
  assert.equal(skipped.turnReads, 0, "unchanged sessions are not read again");
  assert.equal(skipped.result.recoveredTurnCount, 0);

  // A crash mid-turn in one thread: only that thread is read, and its turn
  // is recovered exactly as without the memo.
  const writer = new DirectSessionStore({ rootDir: tempRoot });
  writer.createTurn(later.sessionId, { turnId: "direct_turn_interrupted", state: "request_built", model: "gpt-5.5" });
  ageFiles(path.join(tempRoot, "sessions", later.sessionId), 60);
  ageFiles(path.join(tempRoot, "turns", later.sessionId), 60);
  const crashed = launch();
  assert.equal(crashed.result.recoveredTurnCount, 1);
  assert.equal(crashed.store.readTurn(later.sessionId, "direct_turn_interrupted").state, "failed");
  assert.equal(crashed.store.readTurn(later.sessionId, "direct_turn_interrupted").error.code, "restart_interrupted_turn");
  assert.ok(crashed.turnReads > 0);
  assert.ok(crashed.turnFilesRead.every((file) => file.includes(later.sessionId)), "only the changed thread is read");
  assert.equal(memo().sessions[quiet.sessionId] !== undefined, true);
  assert.equal(memo().sessions[later.sessionId], undefined, "a session recovery wrote is checked again next launch");

  // An executing tool claim written into a memoized session is still found.
  ageFiles(tempRoot, 30);
  launch();
  assert.ok(memo().sessions[later.sessionId], "settled after a clean launch");
  const claimWriter = new DirectSessionStore({ rootDir: tempRoot });
  const turnPath = claimWriter.turnPath(quiet.sessionId, "direct_turn_done");
  const turn = JSON.parse(fs.readFileSync(turnPath, "utf8"));
  turn.unresolvedObligations = [{
    obligationId: "obligation_memo_cmd",
    status: "command_executing",
    executionOperationDigest: "sha256:memo",
  }];
  fs.writeFileSync(turnPath, `${JSON.stringify(turn, null, 2)}\n`);
  ageFiles(path.join(tempRoot, "turns", quiet.sessionId), 10);
  const claimed = launch();
  const recoveredClaim = claimed.store.readTurn(quiet.sessionId, "direct_turn_done").unresolvedObligations[0];
  assert.equal(recoveredClaim.status, "command_execution_ambiguous");

  // A memo from other recovery rules is ignored.
  const stale = memo();
  fs.writeFileSync(path.join(tempRoot, "restart-recovery-memo.json"), JSON.stringify({ ...stale, key: "direct_session_restart_recovery_memo@0" }));
  assert.ok(launch().turnReads >= 2, "a memo with another key is not trusted");

  console.log("direct session restart recovery memo regression passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
