#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ExecutorProcessHandle, EnvironmentExecutorProcessBackend } = require("../src/main/direct/tools/executor-process-backend.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { EXECUTOR_PROCESS_EVENTS } = require("../src/shared/executor-protocol.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ startPending = false } = {}) {
  const attached = deferred();
  const started = deferred();
  const calls = [];
  const session = new EventEmitter();
  session.projectContext = { root: "/synthetic", workspaceKind: "wsl", projectId: "fixture" };
  session.transport = { request: async (method, params) => {
    calls.push({ method, params });
    return method === "process/start" && startPending ? started.promise : { launcher: "fixture", shell: "bash" };
  } };
  const options = {
    workspaceBackends: { ensureForProject: () => attached.promise },
    project: { id: "fixture" },
    sessionId: "fixture_session",
    plan: { sandboxMode: "read-only", shellCommand: "synthetic command", tty: { rows: 20, cols: 70 } },
  };
  return { attached, started, calls, session, options };
}
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`ok - ${name}`);
}

for (const signal of ["SIGTERM", "SIGKILL", "SIGINT"]) {
  for (const timing of ["before attachment", "during attachment"]) {
    await check(`${signal} ${timing} never dispatches a command`, async () => {
      const f = fixture();
      const handle = new ExecutorProcessHandle(f.options);
      const exits = [];
      const errors = [];
      const inputErrors = [];
      handle.onClose((code, sig) => exits.push({ code, signal: sig }));
      handle.onError((error) => errors.push(error));
      handle.writeStdin("queued", (error) => inputErrors.push(error?.code));
      handle.endStdin((error) => inputErrors.push(error?.code));
      handle.resize(33, 99);
      if (timing === "during attachment") await tick();
      assert.equal(handle.kill(signal), true);
      f.attached.resolve(f.session);
      await tick();
      assert.deepEqual(f.calls, []);
      assert.deepEqual(exits, [{ code: null, signal }]);
      assert.deepEqual(errors, []);
      assert.deepEqual(inputErrors, ["EPIPE", "EPIPE"]);
      assert.equal(handle.state, "closed");
      assert.equal(handle.stdinWritable(), false);
      assert.equal(handle.kill(), false);
      assert.equal(f.session.listenerCount("executor-process-event"), 0);
      assert.equal(f.session.listenerCount("transport-closed"), 0);
    });
  }
}

await check("a cancelled attachment failure does not replace the killed exit", async () => {
  const f = fixture();
  const handle = new ExecutorProcessHandle(f.options);
  const exits = [];
  const errors = [];
  handle.onClose((code, signal) => exits.push({ code, signal }));
  handle.onError((error) => errors.push(error));
  await tick();
  handle.kill();
  f.attached.reject(new Error("attachment failed"));
  await tick();
  assert.deepEqual(exits, [{ code: null, signal: "SIGTERM" }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(f.calls, []);
});

await check("queued stdin, EOF and resize still follow a normal start", async () => {
  const f = fixture();
  const handle = new ExecutorProcessHandle(f.options);
  const callbacks = [];
  handle.writeStdin("hello", (error) => callbacks.push(error));
  handle.endStdin((error) => callbacks.push(error));
  handle.resize(33, 99);
  await tick();
  f.attached.resolve(f.session);
  await tick();
  assert.deepEqual(f.calls.map((call) => call.method), ["process/start", "process/write", "process/write", "process/resize"]);
  assert.deepEqual(f.calls[1].params, { processSessionId: "fixture_session", data: "hello", eof: false });
  assert.equal(f.calls[2].params.eof, true);
  assert.deepEqual([f.calls[0].params.rows, f.calls[0].params.cols], [33, 99]);
  assert.deepEqual([f.calls[3].params.rows, f.calls[3].params.cols], [33, 99]);
  assert.deepEqual(callbacks, [null, null]);
  f.session.emit("executor-process-event", { processSessionId: "fixture_session", event: EXECUTOR_PROCESS_EVENTS.exited, exitCode: 0 });
});

await check("a kill after dispatch is sent after the start acknowledgement", async () => {
  const f = fixture({ startPending: true });
  const handle = new ExecutorProcessHandle(f.options);
  const exits = [];
  handle.onClose((code, signal) => exits.push({ code, signal }));
  await tick();
  f.attached.resolve(f.session);
  await tick();
  assert.deepEqual(f.calls.map((call) => call.method), ["process/start"]);
  handle.kill("SIGKILL");
  f.started.resolve({ launcher: "fixture" });
  await tick();
  assert.deepEqual(f.calls.map((call) => call.method), ["process/start", "process/signal"]);
  assert.equal(f.calls[1].params.signal, "SIGKILL");
  assert.deepEqual(exits, []);
  f.session.emit("executor-process-event", { processSessionId: "fixture_session", event: EXECUTOR_PROCESS_EVENTS.exited, exitCode: null, signal: "SIGKILL" });
  assert.deepEqual(exits, [{ code: null, signal: "SIGKILL" }]);
});

await check("cold cancellation settles the caller as cancelled with no command effects", async () => {
  const f = fixture();
  const project = { id: "fixture", workspace: { kind: "wsl", distro: "Ubuntu", linuxPath: "/synthetic" } };
  const grant = DirectThreadHarnessGrant.issue({
    taskId: "fixture_task", threadId: "fixture_thread", projectId: project.id,
    executionEnvironment: { kind: "wsl", environmentId: "fixture_env", bindingDigest: "sha256:fixture" },
    capabilities: ["exec_command", "write_stdin"], accessProfile: "full_access",
  });
  const binding = { taskId: grant.taskId, threadId: grant.threadId, projectId: project.id, project, harnessGrant: grant, executionEnvironmentDigest: grant.executionEnvironmentDigest };
  const backend = new EnvironmentExecutorProcessBackend({ workspaceBackends: f.options.workspaceBackends });
  const manager = new DirectStatefulExecSessionManager({ backendResolver: () => backend });
  try {
    const started = manager.start({ ...binding, cmd: "synthetic command", stdinPolicy: "disabled" });
    await tick();
    manager.cancel({ ...binding, sessionId: started.sessionId });
    f.attached.resolve(f.session);
    await tick();
    assert.deepEqual(f.calls, []);
    const result = await manager.wait({ ...binding, sessionId: started.sessionId });
    assert.equal(result.status, "cancelled");
    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGTERM");
    assert.equal(result.stdoutPreview, "");
    assert.equal(result.stderrPreview, "");
  } finally {
    await manager.dispose("fixture");
  }
});

console.log(JSON.stringify({ schema: "direct_executor_process_start_regression@1", status: "passed", hostPlatform: process.platform, checks }));
