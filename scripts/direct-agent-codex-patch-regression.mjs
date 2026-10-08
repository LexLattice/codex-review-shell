#!/usr/bin/env node
// The workspace agent's own patch path (used without a task grant) takes
// Codex's patch format as well as unified diffs: `*** Begin Patch`, bare
// `@@` hunks located by context, and `*** Add File`. Deletes stay deferred
// on this path, as before.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentPath = path.join(appRoot, "src", "backend", "wsl-agent.js");

async function runAgentBatch(root, requests) {
  const child = spawn(process.execPath, [agentPath, "--root", root, "--workspace-kind", "local", "--project-id", "codex_patch"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const responses = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (!message.event) responses.set(message.id, message);
    }
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 10_000);
  await once(child, "exit");
  clearTimeout(timer);
  return { responses, stderr };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-agent-codex-patch-"));
try {
  await fs.writeFile(path.join(root, "notes.txt"), "title\nalpha\nbeta\ngamma\n");
  await fs.writeFile(path.join(root, "gone.txt"), "x\n");
  const update = [
    "*** Begin Patch",
    "*** Update File: notes.txt",
    "@@",
    " alpha",
    "-beta",
    "+beta two",
    " gamma",
    "*** Add File: src/new.txt",
    "+created by codex patch",
    "*** End Patch",
  ].join("\n");
  const unified = "--- a/notes.txt\n+++ b/notes.txt\n@@ -1,1 +1,1 @@\n-title\n+Title\n";
  const remove = "*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch";
  // The agent serves a batch's requests concurrently, so writes to the same
  // file go in separate batches.
  const responses = new Map();
  let stderr = "";
  for (const batch of [
    [{ id: "dry", method: "applyPatch", params: { mode: "dryRun", patch: update } }],
    [{ id: "apply", method: "applyPatch", params: { mode: "apply", patch: update } }],
    [
      { id: "unified", method: "applyPatch", params: { mode: "apply", patch: unified } },
      { id: "delete", method: "applyPatch", params: { mode: "apply", patch: remove } },
    ],
  ]) {
    const run = await runAgentBatch(root, batch);
    for (const [id, response] of run.responses) responses.set(id, response);
    stderr += run.stderr;
  }
  const ok = (id) => {
    const response = responses.get(id);
    assert(response && !response.error, `${id}: ${JSON.stringify(response?.error || stderr.slice(-400))}`);
    return response.result;
  };
  ok("dry");
  ok("apply");
  ok("unified");
  assert.equal(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "Title\nalpha\nbeta two\ngamma\n");
  assert.equal(await fs.readFile(path.join(root, "src", "new.txt"), "utf8"), "created by codex patch\n");
  const deleted = responses.get("delete");
  assert(deleted?.error, "deletes stay deferred on this path");
  assert.match(JSON.stringify(deleted.error), /deferred/i);
  assert.equal(await fs.readFile(path.join(root, "gone.txt"), "utf8"), "x\n");
  console.log(JSON.stringify({ ok: true, codexUpdate: true, codexAdd: true, unifiedStillWorks: true, deleteDeferred: true }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
