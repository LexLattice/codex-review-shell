#!/usr/bin/env node
// The test control port that scripts/direct-drive.mjs uses to drive the real
// Direct runtime: token required, threads and turns run through the real
// controller, reports show requests, tool calls and the reply, owner
// questions can be left pending and answered, and Stop works mid-loop.
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
const {
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  TERMINAL_TURN_STATES,
} = require("../src/main/direct/controller/live-text-controller.js");
const { DirectTestControlServer, CONTROL_FILE_NAME } = require("../src/main/direct/test-control/test-control-server.js");

const quote = (s) => `'${s.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
const node = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)}`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function response(id, { calls = [], text = "" } = {}) {
  let body = event("response.created", { response: { id, model: "gpt-6-luna" } });
  calls.forEach(([name, args], index) => {
    const item = { id: `item_${id}_${index}`, type: "function_call", call_id: `call_${id}_${index}`, name, arguments: JSON.stringify(args) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  });
  if (text) body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: text });
  body += event("response.completed", { response: { id, status: "completed", usage: { input_tokens: 100, output_tokens: 10 } } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-test-control-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
const projects = [];
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
let script = [];
const bodies = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-6-luna", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-6-luna", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const step = typeof script === "function" ? script(bodies.length) : script.shift();
    assert(step, `unexpected provider request ${bodies.length}`);
    return response(`control_${bodies.length}`, step);
  },
});
const server = new DirectTestControlServer({
  userDataDir: path.join(root, "profile"),
  controller: () => controller,
  createSurfaceSession: (project) => new DirectLiveTextSurfaceSession(null, { controller, project }),
  projects: {
    list: () => projects,
    get: async (id) => projects.find((project) => project.id === id) || null,
    create: async (spec) => {
      const project = {
        id: `project_${projects.length + 1}`,
        name: spec.name,
        workspace: spec.workspace,
        surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
      };
      projects.push(project);
      return project;
    },
  },
  createThread: async (project, payload) => {
    const started = await controller.handleRequest("thread/start", {
      title: payload.title, model: payload.model, reasoningEffort: payload.reasoningEffort, workThreadId: `work_thread_${Date.now()}`,
    }, { project, ownerControlled: true });
    return { status: "created", thread: { id: started.thread.id, workThreadId: "", model: payload.model } };
  },
  terminalStates: TERMINAL_TURN_STATES,
  appInfo: { experience: "direct-workbench" },
});

let checks = 0;
try {
  await server.listen();
  const info = JSON.parse(await fs.readFile(path.join(root, "profile", CONTROL_FILE_NAME), "utf8"));
  const call = async (method, route, body, token = info.token) => {
    const res = await fetch(`http://127.0.0.1:${info.port}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const denied = await call("GET", "/v1/status", null, "wrong-token");
  assert.equal(denied.status, 401, "a wrong token is refused");
  const status = await call("GET", "/v1/status");
  assert.equal(status.body.auth.status, "authenticated");
  checks += 1;

  const created = await call("POST", "/v1/projects", { name: "Control test", workspace: { kind: "local", localPath: workspace } });
  const projectId = created.body.project.id;
  const thread = await call("POST", "/v1/threads", { projectId, model: "gpt-6-luna", reasoningEffort: "low", accessProfile: "full_access" });
  assert.equal(thread.status, 200, JSON.stringify(thread.body));
  const threadId = thread.body.threadId;
  checks += 1;

  // A command, then the reply: the report reads like what happened.
  script = [
    { calls: [["exec_command", { cmd: `${node} -e ${quote("console.log('control-ok')")}` }]] },
    { text: "The command printed control-ok." },
  ];
  const turn = await call("POST", "/v1/turns", { projectId, threadId, text: "Run the check.", model: "gpt-6-luna", reasoningEffort: "low" });
  const waited = await call("POST", "/v1/turns/wait", { projectId, threadId, turnId: turn.body.turnId, timeoutMs: 30000 });
  const report = waited.body.report;
  assert.equal(report.state, "completed", JSON.stringify(report.error));
  assert.equal(report.totals.requests, 2);
  assert.equal(report.requests[0].toolsDeclared > 0, true);
  assert.equal(report.requests[1].callOutputs, 1, "the continuation replays the call output");
  assert.equal(report.toolCalls.length, 1);
  assert.equal(report.toolCalls[0].tool, "exec_command");
  assert.match(report.toolCalls[0].output, /^completed · exit 0\nstdout: control-ok/);
  assert.equal(report.assistant, "The command printed control-ok.");
  assert.equal(report.user, "Run the check.");
  // The timeline splits wall time into requests and the gaps between them.
  assert(report.requests.every((request) => Number.isFinite(request.timing?.sentAtMs) && Number.isFinite(request.timing?.modelMs)));
  assert.deepEqual(report.timeline.map((entry) => entry.phase), [
    "before first request", "request 1", "tools/harness before request 2", "request 2", "after last request",
  ]);
  assert(report.timeline.every((entry) => Number.isFinite(entry.ms) && entry.ms >= 0), JSON.stringify(report.timeline));
  assert(Number.isFinite(report.toolCalls[0].execMs), "an exec call reports how long the process ran");
  assert.equal(bodies[0].reasoning?.effort, "low");
  assert.equal(bodies[0].model, "gpt-6-luna");
  const events = await call("GET", `/v1/events?projectId=${projectId}&since=${turn.body.eventSeq}`);
  assert(events.body.events.some((e) => e.method === "turn/completed"), "events show the turn completing");
  checks += 1;

  // An owner question left pending, then answered.
  script = [
    { calls: [["request_user_input", { prompt: "Continue?", choices: [{ choiceId: "yes", label: "Yes" }], freeTextAllowed: true }]] },
    { text: "You said yes." },
  ];
  const asking = await call("POST", "/v1/turns", { projectId, threadId, text: "Ask me first." });
  const pending = await call("POST", "/v1/turns/wait", { projectId, threadId, turnId: asking.body.turnId, approvals: "pending", timeoutMs: 30000 });
  assert.equal(pending.body.outcome, "waiting_for_owner", JSON.stringify(pending.body.report));
  const question = pending.body.pendingOwnerRequests[0];
  assert.equal(question.method, "item/tool/requestUserInput");
  const answered = await call("POST", "/v1/respond", { projectId, key: question.key, answer: "yes" });
  assert.equal(answered.body.decision, "answered");
  const settled = await call("POST", "/v1/turns/wait", { projectId, threadId, turnId: asking.body.turnId, timeoutMs: 30000 });
  assert.equal(settled.body.report.state, "completed", JSON.stringify(settled.body.report));
  assert.match(JSON.stringify(bodies.at(-1).input), /yes/);
  checks += 1;

  // Stop after two calls of an endless (distinct) command loop.
  script = (n) => ({ calls: [["exec_command", { cmd: `${node} -e ${quote(`console.log('round-${n}')`)}` }]] });
  const looping = await call("POST", "/v1/turns", { projectId, threadId, text: "Keep going." });
  const stopped = await call("POST", "/v1/turns/wait", { projectId, threadId, turnId: looping.body.turnId, stopAfterToolCalls: 2, timeoutMs: 30000 });
  assert.equal(stopped.body.stopPressed, true);
  assert.equal(stopped.body.report.state, "aborted");
  assert(stopped.body.report.toolCalls.length <= 3);
  checks += 1;

  const threadReport = await call("GET", `/v1/threads/report?threadId=${threadId}`);
  assert.equal(threadReport.body.turns.length, 3);
  assert.deepEqual(threadReport.body.turns.map((t) => t.state), ["completed", "completed", "aborted"]);
  checks += 1;

  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  await server.close();
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
