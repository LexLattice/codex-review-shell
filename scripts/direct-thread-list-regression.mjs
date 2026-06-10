import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DirectSessionStore } = require(path.join(repoRoot, "src/main/direct/session/session-store.js"));
const { DirectLiveTextController } = require(path.join(repoRoot, "src/main/direct/controller/live-text-controller.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-thread-list-"));

try {
  const sessionStore = new DirectSessionStore({ rootDir: tempRoot });
  sessionStore.ensure();
  const older = sessionStore.createSession({
    projectId: "project-a",
    title: "Older direct session",
    model: "gpt-5.5",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    directTransport: "direct-live-text",
  });
  const newer = sessionStore.createSession({
    projectId: "project-a",
    title: "Newer direct session",
    model: "gpt-5.4",
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:00:00.000Z",
    directTransport: "direct-live-text",
  });
  const otherProject = sessionStore.createSession({
    projectId: "project-b",
    title: "Other project session",
    model: "gpt-5.3",
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:00.000Z",
    directTransport: "direct-live-text",
  });

  const controller = new DirectLiveTextController({ sessionStore });
  const result = controller.listThreads({ limit: 10 }, { project: { id: "project-a" } });

  assert.equal(result.schema, "direct_thread_list@1");
  assert.equal(result.runtime, "direct-live-text");
  assert.equal(result.projectId, "project-a");
  assert.equal(result.rawPathsExposed, false);
  assert.equal(result.count, 2);
  assert.deepEqual(result.threads.map((thread) => thread.id), [newer.sessionId, older.sessionId]);
  assert.equal(result.threads[0].title, "Newer direct session");
  assert.equal(result.threads[0].model, "gpt-5.4");
  assert.equal(result.threads[0].rawPathExposed, false);
  assert.equal(result.threads.some((thread) => thread.title === "Other project session"), false);
  assert.equal(result.storeStatus.sessionCount, 2);

  sessionStore.readIndex().sessions.push(null);
  const malformedIndexResult = controller.listThreads({ limit: 10 }, { project: { id: "project-a" } });
  assert.equal(malformedIndexResult.count, 2);
  assert.equal(malformedIndexResult.storeStatus.sessionCount, 2);

  const ignoredProjectParam = controller.listThreads({ projectId: "project-b", limit: 10 }, { project: { id: "project-a" } });
  assert.deepEqual(ignoredProjectParam.threads.map((thread) => thread.id), [newer.sessionId, older.sessionId]);

  assert.throws(
    () => controller.readThread({ threadId: otherProject.sessionId }, { project: { id: "project-a" } }),
    /active project/,
  );

  console.log("direct thread/list regression passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
