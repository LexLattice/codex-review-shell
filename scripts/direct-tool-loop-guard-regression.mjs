#!/usr/bin/env node
// A turn once called inspect_self_constitution 58 times in a row and kept
// going after Stop. Distinct calls stay uncapped, but the same call returning
// the same result round after round ends the turn, and Stop ends the tool
// loop between any two steps.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function response(id, { calls = [], text = "" } = {}) {
  let body = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  calls.forEach(([name, args], index) => {
    const item = { id: `item_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name, arguments: JSON.stringify(args) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  });
  if (text) body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: text });
  body += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}

// Runs one Full-access turn whose provider answers come from `next(index,
// body, ctx)`; returns the stored turn, request bodies, and notifications.
async function runTurn(name, next) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `direct-loop-guard-${name}-`));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const project = {
    id: `loop_guard_${name}`, name: "Loop guard",
    workspace: { kind: "local", localPath: workspace },
    surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
  };
  const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
  const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
  const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
  const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
  const bodies = [];
  const ctx = {};
  const controller = new DirectLiveTextController({
    sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
    fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
    profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
    endpoint: "https://chatgpt.test/backend-api/codex/responses",
    authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
    activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert(bodies.length <= 12, "the turn must not run away");
      const answer = await next(bodies.length - 1, body, ctx);
      if (answer.honorSignal && init.signal?.aborted) {
        const aborted = new Error("The operation was aborted.");
        aborted.name = "AbortError";
        throw aborted;
      }
      return response(`${name}_${bodies.length}`, answer);
    },
  });
  const notifications = [];
  try {
    const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
    surface.on("event", (e) => {
      if (e.type === "rpc-notification") notifications.push({ method: e.method, params: e.params || {} });
    });
    const context = { project, ownerControlled: true, surfaceSession: surface };
    const started = await controller.handleRequest("thread/start", {
      title: "Loop guard", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: `work_thread_${name}`,
    }, context);
    const taskId = started.thread.id;
    const turnStart = await controller.handleRequest("turn/start", {
      threadId: taskId, clientTurnRequestId: `${name}_turn`, promptText: "What about now? Any change in tools that you see?",
    }, context);
    Object.assign(ctx, { controller, taskId, turnId: turnStart.turn.id, context, workspace });
    await controller.waitForTurnCompletion({ sessionId: taskId, turnId: turnStart.turn.id });
    return { turn: sessionStore.readTurn(taskId, turnStart.turn.id), bodies, notifications };
  } finally {
    controller.close("regression cleanup");
    await manager.dispose("regression cleanup");
    threadStore.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

let checks = 0;

// 1. The same self-inspection, forever: refused on the fourth identical round.
{
  const { turn, bodies, notifications } = await runTurn("same_call", () => ({ calls: [["inspect_self_constitution", {}]] }));
  assert.equal(turn.state, "failed");
  assert.equal(turn.error?.code, "repeated_tool_call");
  assert.match(turn.error.message, /inspect_self_constitution 4 times in a row/);
  assert.equal(bodies.length, 4, "the initial request and three continuations, then the loop is refused");
  assert.equal(turn.toolResults.length, 3, "the refused fourth call does not run");
  assert(notifications.some((n) => n.method === "warning" && /4 times in a row/.test(n.params.message)));
  assert(notifications.some((n) => n.method === "turn/completed" && n.params.turn?.status === "failed"));
  checks += 1;

  // The model sees its own earlier calls and their outputs, not a quoted blob.
  const last = bodies[3].input;
  const calls = last.filter((item) => item.type === "function_call");
  const outputs = last.filter((item) => item.type === "function_call_output");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((item) => item.call_id), outputs.map((item) => item.call_id));
  assert(calls.every((item) => item.name === "inspect_self_constitution" && item.arguments === "{}"));
  assert.match(outputs[0].output, /direct_self_constitution_snapshot@1/);
  assert.doesNotMatch(JSON.stringify(last), /PRIOR TOOL EVIDENCE/);
  assert.match(bodies[1].instructions, /inspecting again returns the same account/);
  checks += 1;
}

// 2. The same command with a different result each time is real progress.
{
  let round = 0;
  const cmd = `${node} -e ${quote("console.log('tick-' + process.hrtime.bigint())")}`;
  const { turn, bodies } = await runTurn("same_call_new_output", () => {
    round += 1;
    return round <= 5 ? { calls: [["exec_command", { cmd }]] } : { text: "Five ticks observed." };
  });
  assert.equal(turn.state, "completed", JSON.stringify(turn.error));
  assert.equal(bodies.length, 6);
  assert.equal(turn.toolResults.length, 5);
  checks += 1;
}

// 3. Stop during a continuation ends the loop before the next call runs.
{
  const { turn, bodies, notifications } = await runTurn("stop", async (index, _body, ctx) => {
    if (index === 2) {
      const stopped = await ctx.controller.handleRequest("turn/interrupt", { threadId: ctx.taskId, turnId: ctx.turnId }, ctx.context);
      assert.match(stopped.status, /abort/);
    }
    return { calls: [["exec_command", { cmd: `${node} -e ${quote(`console.log('round-${index}')`)}` }]] };
  });
  assert.equal(turn.state, "aborted");
  assert.equal(bodies.length, 3, "nothing is sent after Stop");
  assert.equal(turn.toolResults.length, 2, "the call returned after Stop does not run");
  assert(notifications.some((n) => n.method === "turn/completed" && n.params.turn?.status === "aborted"));
  checks += 1;
}

// 4. Stop while a continuation request is in flight aborts that request.
{
  const { turn, bodies, notifications } = await runTurn("stop_in_flight", async (index, _body, ctx) => {
    if (index === 1) await ctx.controller.handleRequest("turn/interrupt", { threadId: ctx.taskId, turnId: ctx.turnId }, ctx.context);
    return { calls: [["inspect_self_constitution", {}]], honorSignal: true };
  });
  assert.equal(turn.state, "aborted", JSON.stringify({ state: turn.state, error: turn.error }));
  assert.equal(bodies.length, 2);
  assert(notifications.some((n) => n.method === "turn/completed" && n.params.turn?.status === "aborted"));
  checks += 1;
}

// 5. Stop ends the command the turn left running.
{
  let pid = 0;
  let diedAfterStop = false;
  const { turn } = await runTurn("stop_kills_process", async (index, _body, ctx) => {
    if (index === 0) {
      return { calls: [["exec_command", {
        cmd: `${node} -e ${quote("require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => console.log('tick'), 200)")}`,
        yield_time_ms: 500,
      }]] };
    }
    pid = Number(await fs.readFile(path.join(ctx.workspace, "pid.txt"), "utf8"));
    process.kill(pid, 0);
    await ctx.controller.handleRequest("turn/interrupt", { threadId: ctx.taskId, turnId: ctx.turnId }, ctx.context);
    for (let attempt = 0; attempt < 50 && !diedAfterStop; attempt += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        diedAfterStop = true;
      }
    }
    return { text: "unused", honorSignal: true };
  });
  assert(pid > 0, "the command started and wrote its pid");
  assert.equal(diedAfterStop, true, "Stop ended the turn's running command");
  assert.equal(turn.state, "aborted");
  checks += 1;
}

console.log(JSON.stringify({ ok: true, checks }));
