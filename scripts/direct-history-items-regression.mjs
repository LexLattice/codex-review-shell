#!/usr/bin/env node
// Earlier turns reach the model as Codex sends them: each user message, the
// calls the model made with their (bounded) outputs, and its reply, as input
// items. Before, they were one quoted transcript in which every tool call
// was a placeholder line, so the model couldn't see what it had done, and
// the shape changed each turn. Each turn's input now extends the previous
// turn's history, so the prompt cache carries across turns.
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
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

// Works in bash and PowerShell: no quotes inside the script (backticks for
// JS strings), and PowerShell needs & to run a quoted program path.
const nodeCommand = (script) => `${process.platform === "win32" ? "& " : ""}'${process.execPath}' -e '${script}'`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, step) {
  let text = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (step?.call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: step.call.name, arguments: JSON.stringify(step.call.args) };
    text += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    text += event("response.output_text.delta", { item_id: `msg_${id}`, delta: step?.text || "Done." });
  }
  text += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); } },
  };
}
const textOf = (item) => item?.content?.[0]?.text;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "direct-history-items-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "hello.txt"), "hello from the file\n");
const project = {
  id: "history_items_project", name: "History items",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const requests = [];
let script = [];
let turnStart = 0;
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return response(`r${requests.length}`, script[requests.length - 1 - turnStart]);
  },
});

try {
  const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const started = await controller.handleRequest("thread/start", {
    title: "History", model: "gpt-5.6-sol", accessProfile: "full_access", workThreadId: "work_thread_history",
  }, context);
  const threadId = started.thread.id;
  const runTurn = async (prompt, steps) => {
    turnStart = requests.length;
    script = steps;
    const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `history_${requests.length}`, promptText: prompt }, context);
    await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
    const stored = sessionStore.readTurn(threadId, turn.turn.id);
    assert.equal(stored.state, "completed", JSON.stringify(stored.error));
    return { first: requests[turnStart], stored };
  };

  await runTurn("Show me hello.txt.", [
    { call: { name: "exec_command", args: { cmd: nodeCommand("process.stdout.write(require(`node:fs`).readFileSync(`hello.txt`, `utf8`))") } } },
    { text: "It says hello from the file." },
  ]);
  const second = await runTurn("What did the command print?", [{ text: "hello from the file" }]);
  const input = second.first.input;
  assert(!JSON.stringify(input).includes("HISTORICAL TRANSCRIPT EVIDENCE"), "no quoted transcript");
  assert.equal(input[0].role, "user");
  assert.equal(textOf(input[0]), "Show me hello.txt.");
  const call = input.find((item) => item.type === "function_call");
  const output = input.find((item) => item.type === "function_call_output");
  assert.equal(call.name, "exec_command");
  assert.match(call.arguments, /readFileSync/);
  assert.equal(output.call_id, call.call_id, "the call and its output are paired");
  assert.match(output.output, /hello from the file/, "the earlier command's output is in history");
  const reply = input.find((item) => item.role === "assistant");
  assert.equal(textOf(reply), "It says hello from the file.");
  const currentIndex = input.findIndex((item) => item.role === "user" && textOf(item) === "What did the command print?");
  assert(currentIndex > input.indexOf(reply), "the current message follows the history, in the user's own words");
  assert.equal(input.at(-1).role, "developer", "the per-turn snapshot note stays last");
  assert.equal(second.stored.requestShape.historyItemsUsed, true);
  assert.equal(second.stored.requestShape.historyTurnCount, 1);
  // The request manifest records that history went as items, not as the
  // pack's quoted transcript.
  const manifest = threadStore.readRequestManifest(second.stored.requestManifestId);
  assert.equal(manifest.continuity.continuityPolicy, "fresh_request_with_history_items");
  assert.equal(manifest.providerHistory.form, "structured_items");
  assert.equal(manifest.providerHistory.turnCount, 1);
  assert.equal(manifest.providerHistory.quotedTranscriptSentToProvider, false);

  // The next turn's input begins with everything up to this turn's message.
  const third = await runTurn("Thanks.", [{ text: "You're welcome." }]);
  assert.deepEqual(third.first.input.slice(0, currentIndex + 1), input.slice(0, currentIndex + 1), "history extends the previous turn's input");
  assert.equal(third.stored.requestShape.historyTurnCount, 2);

  console.log(JSON.stringify({ ok: true, historyItems: second.stored.requestShape.historyItemCount, thirdTurnHistory: third.stored.requestShape.historyTurnCount }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  await fs.rm(root, { recursive: true, force: true });
}
