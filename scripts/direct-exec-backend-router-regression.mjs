#!/usr/bin/env node

// Turn 2 of the dual-environment track: the stateful exec manager is a host
// router over pluggable process backends. This proves the seam works for a
// backend that is not a local ChildProcess, which turn 3's WSL executor
// backend relies on.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectThreadHarnessGrant } = require("../src/main/direct/authority/direct-thread-harness-grant");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session");
const {
  LOCAL_CHILD_BACKEND_ID,
  LocalChildProcessBackend,
} = require("../src/main/direct/tools/exec-process-backends");

const projectId = "project_exec_router";
const executionEnvironment = { environmentId: "env_exec_router", kind: "local", bindingDigest: "sha256:exec-router" };

function grantFor(threadId, accessProfile = "full_access") {
  return DirectThreadHarnessGrant.issue({
    taskId: threadId,
    threadId,
    projectId,
    executionEnvironment,
    capabilities: ["exec_command", "write_stdin"],
    accessProfile,
  });
}

function bindingFor(grant) {
  return {
    taskId: grant.taskId,
    threadId: grant.threadId,
    projectId,
    executionEnvironmentDigest: grant.executionEnvironmentDigest,
    harnessGrant: grant,
  };
}

// A handle with no ChildProcess behind it, driven entirely by the test.
class ScriptedHandle extends EventEmitter {
  constructor() {
    super();
    this.killSignals = [];
    this.stdinWrites = [];
    this.stdinEnded = false;
    this.writable = true;
  }

  onStdout(fn) { this.on("stdout", fn); }
  onStderr(fn) { this.on("stderr", fn); }
  onStdoutError(fn) { this.on("stdout-error", fn); }
  onStderrError(fn) { this.on("stderr-error", fn); }
  onStdinError(fn) { this.on("stdin-error", fn); }
  onError(fn) { this.on("process-error", fn); }
  onClose(fn) { this.on("close", fn); }
  stdinWritable() { return this.writable; }
  writeStdin(text, callback) { this.stdinWrites.push(text); callback?.(); }
  endStdin(callback) { this.stdinEnded = true; this.writable = false; callback?.(); }
  kill(signal) { this.killSignals.push(signal); return true; }
}

class ScriptedBackend {
  constructor() {
    this.id = "scripted-remote";
    this.plans = [];
    this.handles = [];
    this.planError = null;
    this.launchError = null;
  }

  resolveWorkspace(input) {
    if (input.cwd === "outside") {
      const error = new Error("cwd outside");
      error.code = "direct_stateful_exec_cwd_outside_workspace";
      throw error;
    }
    return { root: "/remote/root", cwd: "/remote/root/sub", cwdRelPath: "sub" };
  }

  planLaunch(spec) {
    if (this.planError) throw this.planError;
    this.plans.push(spec);
    return { command: "remote-shell", args: [spec.shellCommand], shell: false, launcher: "scripted", networkAccess: spec.sandboxMode === "danger-full-access" };
  }

  launch() {
    if (this.launchError) throw this.launchError;
    const handle = new ScriptedHandle();
    this.handles.push(handle);
    return handle;
  }
}

// Relays a real local process through a handle that hides the ChildProcess,
// the way a remote executor backend will.
class RelayBackend {
  constructor(local) {
    this.id = "relay";
    this.local = local;
  }

  resolveWorkspace(input, grant) { return this.local.resolveWorkspace(input, grant); }

  planLaunch(spec) { return this.local.planLaunch(spec); }

  launch(plan, options) {
    const inner = this.local.launch(plan, options);
    const relay = new ScriptedHandle();
    inner.onStdout((chunk) => relay.emit("stdout", Buffer.from(chunk)));
    inner.onStderr((chunk) => relay.emit("stderr", Buffer.from(chunk)));
    inner.onError((error) => relay.emit("process-error", error));
    inner.onClose((code, signal) => relay.emit("close", code, signal));
    relay.kill = (signal) => inner.kill(signal);
    relay.writeStdin = (text, callback) => inner.writeStdin(text, callback);
    relay.endStdin = (callback) => inner.endStdin(callback);
    relay.stdinWritable = () => inner.stdinWritable();
    return relay;
  }
}

// Drops identifiers and timestamps that legitimately differ between two runs.
function comparable(result) {
  const { sessionId, startedAt, completedAt, resultDigest, surface, outputFrames, grantId, taskId, threadId, executionEnvironmentDigest, recoveryClassification, ...rest } = result;
  const { sessionId: _s, recoveryId, recoveryDigest, ...recovery } = recoveryClassification || {};
  return { ...rest, recoveryClassification: recovery };
}

const report = { schema: "direct_exec_backend_router_regression_report@1", checks: [] };
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "direct-exec-router-"));
try {
  // 1. Default: the local backend is used and the raw child stays reachable.
  const local = new DirectStatefulExecSessionManager({ workspaceRootResolver: () => workspace });
  assert(local.localBackend instanceof LocalChildProcessBackend);
  const localGrant = grantFor("router_local");
  const localStarted = local.start({ ...bindingFor(localGrant), command: process.execPath, args: ["-e", "process.stdout.write('hi')"], stdinPolicy: "disabled" });
  const localRecord = local.sessions.get(localStarted.sessionId);
  assert.equal(localRecord.backendId, LOCAL_CHILD_BACKEND_ID);
  assert(localRecord.child, "local sessions keep the raw ChildProcess");
  const localResult = await local.wait({ ...bindingFor(localGrant), sessionId: localStarted.sessionId });
  assert.equal(localResult.status, "completed");
  assert.equal(localResult.stdoutPreview, "hi");
  await local.dispose("router-local");
  report.checks.push("local_backend_default");

  // 2. A scripted non-child backend through the router.
  const scripted = new ScriptedBackend();
  const routed = new DirectStatefulExecSessionManager({ backendResolver: () => scripted });
  const scriptedGrant = grantFor("router_scripted", "workspace");
  const scriptedBinding = bindingFor(scriptedGrant);
  const started = routed.start({ ...scriptedBinding, cmd: "echo routed", stdinPolicy: "line_input" });
  const record = routed.sessions.get(started.sessionId);
  assert.equal(record.backendId, "scripted-remote");
  assert.equal(record.child, null, "non-local backends expose no ChildProcess");
  assert.equal(record.cwdRelPath, "sub");
  assert.equal(scripted.plans[0].sandboxMode, "workspace-write");
  assert.equal(scripted.plans[0].shellCommand, "echo routed");
  assert.equal(started.networkAccess, false);
  const handle = scripted.handles[0];
  // UTF-8 split across chunks still decodes in the host router.
  handle.emit("stdout", Buffer.from([0xe2]));
  handle.emit("stdout", Buffer.from([0x82, 0xac]));
  handle.emit("stderr", Buffer.from("warn"));
  const written = routed.writeStdin({ ...scriptedBinding, sessionId: started.sessionId, chars: "line\n" });
  assert.equal(written.stdinAccepted, true);
  assert.deepEqual(handle.stdinWrites, ["line\n"]);
  routed.writeStdin({ ...scriptedBinding, sessionId: started.sessionId, eof: true });
  assert.equal(handle.stdinEnded, true);
  assert.throws(
    () => routed.writeStdin({ ...scriptedBinding, sessionId: started.sessionId, chars: "late\n" }),
    (error) => error.code === "direct_stateful_exec_session_not_live",
  );
  handle.emit("close", 0, null);
  const scriptedResult = await routed.wait({ ...scriptedBinding, sessionId: started.sessionId });
  assert.equal(scriptedResult.status, "completed");
  assert.equal(scriptedResult.stdoutPreview, "€");
  assert.equal(scriptedResult.stderrPreview, "warn");
  report.checks.push("scripted_backend_lifecycle");

  // 3. Cancel and failures go through the handle's tree kill.
  const cancelled = routed.start({ ...scriptedBinding, cmd: "sleep", stdinPolicy: "disabled" });
  const cancelHandle = scripted.handles[1];
  routed.cancel({ ...scriptedBinding, sessionId: cancelled.sessionId });
  assert.deepEqual(cancelHandle.killSignals, ["SIGTERM"]);
  cancelHandle.emit("close", null, "SIGTERM");
  assert.equal((await routed.wait({ ...scriptedBinding, sessionId: cancelled.sessionId })).status, "cancelled");

  const errored = routed.start({ ...scriptedBinding, cmd: "boom", stdinPolicy: "disabled" });
  const errorHandle = scripted.handles[2];
  errorHandle.emit("stdout-error", new Error("relay read failed"));
  assert.deepEqual(errorHandle.killSignals, ["SIGTERM"], "stream errors terminate before close");
  errorHandle.emit("close", 1, "SIGTERM");
  const erroredResult = await routed.wait({ ...scriptedBinding, sessionId: errored.sessionId });
  assert.equal(erroredResult.status, "failed");
  assert.equal(erroredResult.errorCode, "direct_stateful_exec_stdout_read_failed");
  report.checks.push("scripted_backend_kill_and_failure");

  // 4. Plan-time refusals throw before a session exists; launch failures
  // become failed sessions.
  const sessionCount = routed.sessions.size;
  scripted.planError = Object.assign(new Error("no sandbox"), { code: "direct_stateful_exec_sandbox_unavailable" });
  assert.throws(() => routed.start({ ...scriptedBinding, cmd: "x" }), (error) => error.code === "direct_stateful_exec_sandbox_unavailable");
  assert.equal(routed.sessions.size, sessionCount);
  scripted.planError = null;
  assert.throws(
    () => routed.start({ ...scriptedBinding, cmd: "x", cwd: "outside" }),
    (error) => error.code === "direct_stateful_exec_cwd_outside_workspace",
  );
  assert.equal(routed.sessions.size, sessionCount);
  scripted.launchError = new Error("executor unreachable");
  const launchFailed = routed.start({ ...scriptedBinding, cmd: "x" });
  assert.equal(launchFailed.status, "failed");
  assert.match(launchFailed.spawnError, /executor unreachable/);
  scripted.launchError = null;
  const unrouted = new DirectStatefulExecSessionManager({ backendResolver: () => null });
  assert.throws(() => unrouted.start({ ...scriptedBinding, cmd: "x" }), (error) => error.code === "direct_stateful_exec_backend_unavailable");
  await routed.dispose("router-scripted");
  report.checks.push("plan_and_launch_failures");

  // 5. Parity: a real process relayed through a child-less handle produces the
  // same public result as the local backend.
  const script = "process.stdout.write('out:' + 'x'.repeat(40)); process.stderr.write('err'); process.exit(3)";
  const parityLocal = new DirectStatefulExecSessionManager({ workspaceRootResolver: () => workspace });
  const parityRelay = new DirectStatefulExecSessionManager({
    backendResolver: () => new RelayBackend(new LocalChildProcessBackend({ workspaceRootResolver: () => workspace })),
  });
  const parityGrant = grantFor("router_parity");
  const parityBinding = bindingFor(parityGrant);
  const directRun = parityLocal.start({ ...parityBinding, command: process.execPath, args: ["-e", script], stdinPolicy: "disabled" });
  const relayRun = parityRelay.start({ ...parityBinding, command: process.execPath, args: ["-e", script], stdinPolicy: "disabled" });
  const directResult = await parityLocal.wait({ ...parityBinding, sessionId: directRun.sessionId });
  const relayResult = await parityRelay.wait({ ...parityBinding, sessionId: relayRun.sessionId });
  assert.equal(directResult.status, "failed");
  assert.equal(directResult.exitCode, 3);
  assert.deepEqual(comparable(relayResult), comparable(directResult));
  await parityLocal.dispose("router-parity-local");
  await parityRelay.dispose("router-parity-relay");
  report.checks.push("relay_parity");

  report.status = "passed";
  console.log(JSON.stringify(report));
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
