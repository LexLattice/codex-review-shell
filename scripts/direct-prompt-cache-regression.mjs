#!/usr/bin/env node
// Every request of a thread can reuse the backend's prompt cache, as Codex's
// do: each carries the thread ID as prompt_cache_key and as the session-id /
// thread-id headers (the ChatGPT backend takes cache affinity from those), and
// a turn's requests share an exact prefix. Continuations keep the turn's
// instructions and tools byte-identical and add their guidance as a trailing
// developer message; before, each appended its guidance to the instructions,
// which shifted everything after them, so no continuation hit the cache.
// Across turns the instructions stay identical too: the per-turn
// self-constitution digest follows the dialogue instead of leading it.
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

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-prompt-cache-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "hello.txt"), "hello\n");
const project = {
  id: "prompt_cache_project", name: "Prompt cache",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
// One of each continuation path: command, patch, file read, self-constitution.
const steps = [
  { name: "exec_command", args: { cmd: `${node} -e ${quote("console.log(require('node:fs').readFileSync('hello.txt', 'utf8'))")}` } },
  { name: "apply_patch", args: { patch: "*** Begin Patch\n*** Update File: hello.txt\n@@\n-hello\n+hello, cache\n*** End Patch" } },
  { name: "read_file", args: { path: "hello.txt" } },
  { name: "inspect_self_constitution", args: {} },
];
const requests = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    requests.push({ body: JSON.parse(init.body), headers: init.headers });
    assert(requests.length <= 20, "unexpected request loop");
    const turnRequests = requests.length - turnStartIndex;
    return response(`r${requests.length}`, currentSteps[turnRequests - 1]);
  },
});
let turnStartIndex = 0;
let currentSteps = steps;
const isSnapshotNote = (item) => item?.role === "developer" && /^Self constitution snapshot/.test(item.content?.[0]?.text || "");
const isGuidance = (item) => item?.role === "developer" && !isSnapshotNote(item);

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "Prompt cache", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_prompt_cache",
  }, context);
  const threadId = started.thread.id;
  const runTurn = async (text, turnSteps) => {
    turnStartIndex = requests.length;
    currentSteps = turnSteps;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `cache_${requests.length}`, promptText: text }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const stored = sessionStore.readTurn(threadId, turn.turn.id);
    assert.equal(stored.state, "completed", JSON.stringify(stored.error));
    return requests.slice(turnStartIndex);
  };

  const first = await runTurn("Show hello.txt, change it, read it back, and check your setup.", steps);
  assert.equal(first.length, steps.length + 1);

  for (const { body, headers } of requests) {
    assert.equal(body.prompt_cache_key, threadId, "every request carries the thread as its cache key");
    assert.equal(headers["session-id"], threadId, "cache affinity header");
    assert.equal(headers["thread-id"], threadId);
  }
  const [initial, ...continuations] = first;
  assert(!initial.body.input.some(isGuidance), "the first request has no continuation guidance");
  assert(isSnapshotNote(initial.body.input.at(-1)), "the per-turn snapshot digest follows the dialogue");
  assert(!/sha256:[0-9a-f]{64}/.test(initial.body.instructions), "no per-turn digest in the instructions");
  for (const [index, { body }] of continuations.entries()) {
    const previous = first[index].body;
    assert.equal(body.instructions, initial.body.instructions, `request ${index + 2}: instructions stay identical`);
    assert.equal(JSON.stringify(body.tools), JSON.stringify(initial.body.tools), `request ${index + 2}: tools stay identical`);
    const stablePrevious = previous.input.filter((item) => !isGuidance(item));
    assert.deepEqual(body.input.slice(0, stablePrevious.length), stablePrevious, `request ${index + 2}: input extends the previous request's input`);
    const guidance = body.input.at(-1);
    assert(isGuidance(guidance), `request ${index + 2}: guidance is the last input item`);
    assert.match(guidance.content[0].text, /continuing the user's turn|Keep working|declared tools/);
    assert.equal(body.input.filter(isGuidance).length, 1, "only the current guidance is sent");
  }
  // The command's guidance still pins its live session ID for write_stdin.
  assert.match(continuations[0].body.input.at(-1).content[0].text, /write_stdin/);
  assert.equal(await fs.readFile(path.join(workspace, "hello.txt"), "utf8"), "hello, cache\n");

  // A second turn on the same thread uses the same key, the same
  // instructions and tools, and a user message that starts with the earlier
  // dialogue, so the cache covers everything up to the new turn.
  const second = await runTurn("Thanks.", []);
  assert.equal(second.length, 1);
  assert.equal(second[0].body.prompt_cache_key, threadId);
  assert.equal(second[0].headers["session-id"], threadId);
  assert.equal(second[0].body.instructions, initial.body.instructions, "instructions are identical across turns");
  assert.equal(JSON.stringify(second[0].body.tools), JSON.stringify(initial.body.tools), "tools are identical across turns");
  const third = await runTurn("And once more.", []);
  const userText = (body) => body.input[0].content[0].text;
  const secondDialogue = userText(second[0].body).split("[CURRENT USER INTENT]")[0];
  assert(secondDialogue.length > 0 && userText(third[0].body).startsWith(secondDialogue), "the next turn's dialogue extends the previous one");
  assert.equal(third[0].body.instructions, initial.body.instructions);

  console.log(JSON.stringify({ ok: true, requests: requests.length, cacheKey: "thread", instructionsStable: true, toolsStable: true, inputPrefixStable: true }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true });
}
