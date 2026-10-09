#!/usr/bin/env node
// A process started before request_permissions raised the thread's Access
// keeps taking input afterwards: write_stdin follows the thread's current
// grant (same task and environment), so the raise doesn't strand it.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

// The thread starts in Workspace access, whose commands run in bubblewrap on
// Linux; without a working one the first exec_command is refused before
// the raise this test is about.
if (process.platform === "linux") {
  const { BubblewrapExecSandbox } = require("../src/main/direct/tools/exec-sandbox.js");
  const sandbox = new BubblewrapExecSandbox();
  let usable = false;
  if (sandbox.available()) {
    const probeRoot = os.tmpdir();
    const plan = sandbox.wrap({ sandboxMode: "workspace-write", root: probeRoot, cwd: probeRoot, command: "/bin/true" });
    usable = spawnSync(plan.command, plan.args, { timeout: 5000 }).status === 0;
  }
  if (!usable) {
    console.log("SKIPPED: Workspace access needs a working bubblewrap sandbox on this host.");
    process.exit(77);
  }
}

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const outputs = (body) => body.input.filter((item) => item.type === "function_call_output").map((item) => JSON.parse(item.output));
// Works in bash and PowerShell (no quotes inside the script).
const nodeCommand = (script) => `${process.platform === "win32" ? "& " : ""}'${process.execPath}' -e '${script}'`;
const READER = nodeCommand("process.stdin.on(`data`,(d)=>{console.log(`got:`+String(d).trim());process.exit(0)})");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-stdin-after-raise-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const project = {
  id: "stdin_after_raise", name: "Stdin after raise",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const bodies = [];
const steps = [
  () => ({ name: "exec_command", args: { cmd: READER, yield_time_ms: 300 } }),
  () => ({ name: "request_permissions", args: { access: "full_access", scope: "turn", reason: "needs the network" } }),
  (body) => {
    const started = outputs(body).find((output) => output.sessionId && output.status === "running");
    assert(started, `the reader is still running before the raise: ${JSON.stringify(outputs(body)).slice(0, 400)}`);
    return { name: "write_stdin", args: { session_id: started.sessionId, chars: "hello\n", yield_time_ms: 3000 } };
  },
  () => null,
];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    assert(bodies.length <= steps.length, "no extra request");
    return response(`r${bodies.length}`, steps[bodies.length - 1](body));
  },
});
const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
surface.on("event", (e) => {
  const request = e.request;
  if (e.type !== "rpc-request" || request?.method !== "item/tool/requestUserInput") return;
  setImmediate(() => surface.respond(request.key, { answers: { permission_decision: { answers: ["allow_turn"] } } }).catch(() => {}));
});

// Opening a thread warms its shell for the first command (Windows; the call
// is made on every host and is a no-op where shells aren't prewarmed).
const prewarmCalls = [];
const realPrewarm = manager.prewarm.bind(manager);
manager.prewarm = (input) => {
  prewarmCalls.push(input);
  return realPrewarm(input);
};

try {
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", {
    title: "Raise", model: "gpt-5.6-sol", accessProfile: "workspace", workThreadId: "work_thread_raise",
  }, context)).thread.id;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prewarmCalls.length, 1, "thread/start warms the thread's shell");
  assert.equal(prewarmCalls[0].taskId, threadId);
  assert(prewarmCalls[0].harnessGrant?.grantId, "with the thread's grant");
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "raise_1", promptText: "Start the reader, get full access, then feed it." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const deadline = Date.now() + 10_000;
  while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turn.turn.id).state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(bodies.length, 4);
  const stdin = outputs(bodies[3]).at(-1);
  assert.notEqual(stdin.status, "rejected", `write_stdin was refused: ${JSON.stringify(stdin).slice(0, 400)}`);
  assert.equal(stdin.stdinAccepted, true, JSON.stringify(stdin).slice(0, 400));
  assert.match(JSON.stringify(stdin), /got:hello/, "the process got the input");
  console.log(JSON.stringify({ ok: true, status: stdin.status }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
