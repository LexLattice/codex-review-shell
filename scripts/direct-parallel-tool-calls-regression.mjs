#!/usr/bin/env node
// As in Codex, requests allow parallel tool calls, and when one response
// makes several calls the parallel-safe ones (commands, process input,
// granted reads) run at the same time while a patch runs alone, after the
// calls before it and before the calls after it. The continuation lists
// every call and its output in the order the model made them, not the order
// they finished.
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

// Works in bash and PowerShell: no quotes inside the script (backticks for
// JS strings), and PowerShell needs & to run a quoted program path.
const nodeCommand = (script) => `${process.platform === "win32" ? "& " : ""}'${process.execPath}' -e '${script}'`;
const timedRead = (label, delayMs) => nodeCommand(
  `const s=Date.now();setTimeout(()=>{const n=require(\`fs\`).readFileSync(\`notes.txt\`,\`utf8\`).trim();console.log(\`${label} start=\${s} end=\${Date.now()} notes=\${n}\`)},${delayMs})`,
);
const PATCH = "*** Begin Patch\n*** Update File: notes.txt\n@@\n-alpha\n+beta\n*** End Patch";
const CALLS = [
  { name: "exec_command", args: { cmd: timedRead("A", 1500) } },
  { name: "exec_command", args: { cmd: timedRead("B", 300) } },
  { name: "apply_patch", args: { patch: PATCH } },
  { name: "exec_command", args: { cmd: timedRead("C", 0) } },
];

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, calls) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  for (const [index, call] of (calls || []).entries()) {
    const item = { id: `fc_${id}_${index}`, type: "function_call", call_id: `call_${index}`, name: call.name, arguments: JSON.stringify(call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  }
  if (!calls) text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-parallel-tool-calls-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "notes.txt"), "alpha\n");
const project = {
  id: "parallel_tool_calls_project", name: "Parallel tool calls",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const executor = new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace });
const bodies = [];
let script = [CALLS, null];
let scriptStart = 0;
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: executor,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const index = bodies.length - 1 - scriptStart;
    assert(index < script.length, "no extra continuation");
    return response(`r${bodies.length}`, script[index]);
  },
});

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Parallel", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_parallel",
  }, context);
  const threadId = started.thread.id;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: "parallel_1", promptText: "Read, patch, read." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].parallel_tool_calls, true, "the first request allows parallel calls");
  assert.equal(bodies[1].parallel_tool_calls, true, "continuations allow parallel calls");

  const input = bodies[1].input;
  const pairs = input.filter((item) => item.type === "function_call" || item.type === "function_call_output");
  assert.deepEqual(
    pairs.map((item) => `${item.type === "function_call" ? "call" : "output"}:${item.call_id}`),
    ["call:call_0", "output:call_0", "call:call_1", "output:call_1", "call:call_2", "output:call_2", "call:call_3", "output:call_3"],
    "calls and outputs in the order the model made them (B finished before A)",
  );
  const callIdFor = { A: "call_0", B: "call_1", C: "call_3" };
  const timing = (label) => {
    const output = pairs.find((item) => item.type === "function_call_output" && item.call_id === callIdFor[label]).output;
    const match = output.match(new RegExp(`${label} start=(\\d+) end=(\\d+) notes=(\\w+)`));
    assert(match, `${label} printed its timing: ${output.slice(0, 400)}`);
    return { start: Number(match[1]), end: Number(match[2]), notes: match[3] };
  };
  const a = timing("A");
  const b = timing("B");
  const c = timing("C");
  assert(b.start < a.end, `A and B ran at the same time (B started ${b.start}, A ended ${a.end})`);
  assert(b.end < a.end, "B finished first");
  assert.equal(a.notes, "alpha", "the patch waited for A");
  assert.equal(b.notes, "alpha", "the patch waited for B");
  assert.equal(c.notes, "beta", "C ran after the patch");
  assert(c.start >= a.end, "C started after the patch, which started after A");
  assert.equal((await fs.readFile(path.join(workspace, "notes.txt"), "utf8")).trim(), "beta");

  // A parallel call that fails outright (a backend error, not an answer for
  // the model) ends the turn as failed even though its sibling succeeded
  // after it; the sibling doesn't wait for it forever.
  const realStart = manager.start.bind(manager);
  manager.start = (input = {}) => {
    if (String(input.cmd || "").includes("FAIL_ME")) {
      const error = new Error("fixture backend failure");
      error.code = "fixture_backend_failure";
      throw error;
    }
    return realStart(input);
  };
  const events = [];
  surface.on("event", (e) => events.push(e));
  scriptStart = bodies.length;
  script = [[
    { name: "exec_command", args: { cmd: "echo FAIL_ME" } },
    { name: "exec_command", args: { cmd: timedRead("D", 300) } },
  ], null];
  const failThread = (await controller.handleRequest("thread/start", {
    title: "Parallel failure", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_parallel_failure",
  }, context)).thread.id;
  const failTurn = await controller.handleRequest("turn/start", { threadId: failThread, clientTurnRequestId: "parallel_fail", promptText: "Run both." }, context);
  await Promise.race([
    controller.waitForTurnCompletion({ sessionId: failThread, turnId: failTurn.turn.id }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("turn never finished")), 15_000).unref()),
  ]);
  const deadline = Date.now() + 5_000;
  while (sessionStore.readTurn(failThread, failTurn.turn.id).state !== "failed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const failedTurn = sessionStore.readTurn(failThread, failTurn.turn.id);
  assert.equal(failedTurn.state, "failed", `the turn ends failed (state ${failedTurn.state})`);
  assert.equal(failedTurn.error?.code, "fixture_backend_failure");
  assert.equal(bodies.length - scriptStart, 1, "no continuation after the failure");
  assert.equal(controller.toolBatches.size, 0, "the batch is cleared");
  assert(events.some((e) => /turn\/completed/.test(JSON.stringify(e)) && /"failed"/.test(JSON.stringify(e))), "the UI is told the turn failed");
  const sibling = failedTurn.unresolvedObligations.find((entry) => /D start/.test(JSON.stringify(entry.result || {})) || entry.callId?.endsWith("_1"));
  assert(sibling?.result, "the sibling still ran");

  console.log(JSON.stringify({ ok: true, overlapMs: a.end - b.start, requests: bodies.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  // On Windows the warm PowerShell shells exit a moment after disposal.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
