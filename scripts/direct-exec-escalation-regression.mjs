#!/usr/bin/env node
// Codex's per-command escalation and command rules in sandboxed threads.
// exec_command can ask (sandbox_permissions: require_escalated) to run one
// command outside the sandbox; the owner approves once, for the thread, or
// always for a prefix (this project's environment or everywhere), or
// declines. A command whose every part matches an allow rule runs outside
// the sandbox without asking. Commands split into parts only when every word
// is a plain literal (Bash and PowerShell), as Codex lowers them.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.CODEX_EXPERIENCE = "direct-workbench";
const rules = require("../src/main/direct/tools/command-rules.js");
const { DirectApprovalRuleStore } = require("../src/main/direct/authority/approval-rule-store.js");

// Splitting, as Codex: literals only.
assert.deepEqual(rules.parseBashSegments("git status && npm test -- --watch=false | head -5"), [["git", "status"], ["npm", "test", "--", "--watch=false"], ["head", "-5"]]);
assert.deepEqual(rules.parseBashSegments(`echo 'a b' "c d" e\\ f`), [["echo", "a b", "c d", "e f"]]);
for (const opaque of ["echo $HOME", "ls > out.txt", "echo `id`", "a=1 make", "cat <<EOF", "(cd x && ls)", "ls *.js", "sleep 1 &", "echo \"$(id)\""]) {
  assert.equal(rules.parseBashSegments(opaque), null, opaque);
}
assert.deepEqual(rules.parsePowerShellSegments("Get-ChildItem -Recurse | Select-Object -First 5; git log --oneline"), [["Get-ChildItem", "-Recurse"], ["Select-Object", "-First", "5"], ["git", "log", "--oneline"]]);
assert.deepEqual(rules.parsePowerShellSegments("Write-Output 'it''s'"), [["Write-Output", "it's"]]);
for (const opaque of ["Write-Output $env:PATH", "& 'C:\\x.exe'", "Get-Item (Get-Location)", "ls > out.txt", "Write-Output \"$x\""]) {
  assert.equal(rules.parsePowerShellSegments(opaque), null, opaque);
}
// Matching: token prefixes, a program's path matching a bare rule, every part.
const allowGit = [{ decision: "allow", pattern: ["git", "status"] }];
assert(rules.ruleMatches(["/usr/bin/git", "status", "-s"], ["git", "status"]));
assert(!rules.ruleMatches(["git", "stash"], ["git", "status"]));
assert(rules.ruleMatches(["GIT.EXE", "status"], ["git", "status"], "powershell"));
assert(rules.ruleMatches(["C:\\Tools\\Git.EXE", "branch", "-d", "topic"], ["git", "branch", "-d"], "powershell"));
assert(!rules.ruleMatches(["Git", "branch", "-D", "topic"], ["git", "branch", "-d"], "powershell"), "native option case must not broaden a rule");
assert(!rules.ruleMatches(["git", "branch", "-d", "Topic"], ["git", "branch", "-d", "topic"], "powershell"), "native argument values keep their case");
assert(!rules.ruleMatches(["git", "STATUS"], ["git", "status"], "powershell"));
assert(!rules.ruleMatches(["NODE.EXE", "-e", "write('A')"], ["node", "-e", "write('a')"], "powershell"), "native source text is case-sensitive");
assert(rules.ruleMatches(["get-childitem", "-Recurse"], ["Get-ChildItem", "-Recurse"], "powershell"), "cmdlet command names still ignore case");
assert(!rules.ruleMatches(["GIT", "status"], ["git", "status"], "bash"), "Bash command names stay case-sensitive");
const allowDelete = [{ decision: "allow", pattern: ["git", "branch", "-d"] }];
const forceDelete = rules.commandSegments("GIT.EXE branch -D topic", "powershell");
assert.equal(rules.evaluateCommandRules(forceDelete, allowDelete, "powershell").allAllowed, false);
assert.deepEqual(rules.proposeCommandRule(forceDelete, allowDelete, ["git", "branch", "-d"], "powershell"), ["GIT.EXE", "branch", "-D", "topic"], "a proposal must not substitute a differently cased option");
assert.equal(rules.evaluateCommandRules([["git", "status"], ["rm", "-rf", "x"]], allowGit).allAllowed, false, "every part must be allowed");
assert.equal(rules.evaluateCommandRules(null, allowGit).allAllowed, false, "an opaque command matches nothing");
// Proposals: the model's prefix when reasonable and covering, else the whole
// command; never a bare interpreter or git.
assert.deepEqual(rules.proposeCommandRule([["git", "pull", "origin"]], [], ["git", "pull"]), ["git", "pull"]);
assert.deepEqual(rules.proposeCommandRule([["git", "pull"]], [], ["git"]), ["git", "pull"], "a banned prefix falls back to the whole command");
assert.equal(rules.proposeCommandRule([["python3", "-c", "x"], ["curl", "y"]], [], null), null, "one rule can't cover two different commands");
assert.equal(rules.proposeCommandRule([["bash"]], [], null), null);
// A program by path or with a Windows suffix is the same program.
for (const broad of [["/bin/bash"], ["/usr/bin/env"], ["C:\\Windows\\System32\\cmd.exe"], ["pwsh.exe"], ["/usr/bin/git"], ["/bin/rm"], ["/usr/bin/python3"]]) {
  assert.equal(rules.bannedPrefix(broad), true, broad.join(" "));
}
assert.deepEqual(rules.proposeCommandRule([["/usr/bin/env", "make"]], [], ["/usr/bin/env"]), ["/usr/bin/env", "make"], "a path to a banned program is not offered; the whole command is");
assert.equal(rules.proposeCommandRule([["/bin/bash"]], [], ["/bin/bash"]), null);

// The store: global rules apply everywhere, project rules to one project
// and environment.
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-exec-escalation-store-"));
try {
  const store = new DirectApprovalRuleStore({ rootDir: storeRoot });
  store.addCommandRule({ scope: "global", pattern: ["cargo", "build"] });
  store.addCommandRule({ scope: "project", projectId: "p1", environmentKind: "wsl", pattern: ["make"] });
  assert.equal(store.addCommandRule({ scope: "global", pattern: ["cargo", "build"] }), false, "no duplicates");
  assert.deepEqual(store.commandRulesFor("p1", "wsl").map((rule) => rule.pattern), [["cargo", "build"], ["make"]]);
  assert.deepEqual(store.commandRulesFor("p1", "windows").map((rule) => rule.pattern), [["cargo", "build"]]);
  assert.deepEqual(store.commandRulesFor("p2", "wsl").map((rule) => rule.pattern), [["cargo", "build"]]);
} finally {
  fs.rmSync(storeRoot, { recursive: true, force: true });
}

// End to end in a Read only thread (its sandbox can't write the project).
if (process.platform === "linux") {
  const { BubblewrapExecSandbox } = require("../src/main/direct/tools/exec-sandbox.js");
  const sandbox = new BubblewrapExecSandbox();
  let usable = false;
  if (sandbox.available()) {
    const plan = sandbox.wrap({ sandboxMode: "read-only", root: os.tmpdir(), cwd: os.tmpdir(), command: "/bin/true" });
    usable = spawnSync(plan.command, plan.args, { timeout: 5000 }).status === 0;
  }
  if (!usable) {
    console.log("SKIPPED: Read only access needs a working bubblewrap sandbox on this host.");
    process.exit(77);
  }
}
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function response(id, call) {
  let body = event("response.created", { response: { id, model: "gpt-5.6-sol" } });
  if (call) {
    const item = { id: `item_${id}`, type: "function_call", call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args) };
    body += event("response.output_item.added", { item }) + event("response.output_item.done", { item });
  } else {
    body += event("response.output_text.delta", { item_id: `msg_${id}`, delta: "Done." });
  }
  body += event("response.completed", { response: { id, status: "completed" } });
  return {
    ok: true, status: 200, headers: { get: () => "text/event-stream" },
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } },
  };
}
const lastOutput = (body) => JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-exec-escalation-"));
const workspace = path.join(root, "workspace");
fs.mkdirSync(workspace, { recursive: true });
const project = {
  id: "exec_escalation",
  name: "Exec escalation",
  workspace: { kind: "local", localPath: workspace },
  surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane" } },
};
const WRITER = "require(`fs`).writeFileSync(process.argv[1], `x`)";
const write = (name, extra = {}, flag = "-e") => ({ name: "exec_command", args: { command: process.execPath, args: [flag, WRITER, name], yield_time_ms: 10_000, ...extra } });
const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace });
const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
const bodies = [];
let steps = [];
const controller = new DirectLiveTextController({
  sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
  profileDoc: { profile: { ontology: { models: [{ id: "gpt-5.6-sol", status: "accepted" }] } } },
  endpoint: "https://chatgpt.test/backend-api/codex/responses",
  authStore: { readStatus: () => ({ status: "authenticated", hasAccessToken: true }), readCredentials: () => ({ accessToken: "fixture" }) },
  activationStatusResolver: () => ({ status: "ready", model: "gpt-5.6-sol", context: { contextWindow: 100000, usedTokens: 1, remainingTokens: 99999 } }),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    assert(steps.length, "no extra request");
    return response(`r${bodies.length}`, steps.shift());
  },
});
const surface = new DirectLiveTextSurfaceSession(null, { controller, project });
const prompts = [];
let answers = [];
surface.on("event", (e) => {
  if (e.type !== "rpc-request" || e.request?.method !== "item/commandExecution/requestApproval") return;
  prompts.push(e.request);
  const answer = answers.shift();
  assert(answer, `unexpected prompt for ${e.request.summary}`);
  setImmediate(() => surface.respond(e.request.key, typeof answer === "function" ? answer(e.request) : answer).catch((error) => prompts.push({ refused: error.message })));
});

async function runTurn(accessProfile, turnSteps, turnAnswers) {
  steps = [...turnSteps];
  answers = [...turnAnswers];
  const context = { project, ownerControlled: true, surfaceSession: surface };
  const threadId = (await controller.handleRequest("thread/start", { title: "Escalation", model: "gpt-5.6-sol", accessProfile, workThreadId: "work_thread_escalation" }, context)).thread.id;
  const start = bodies.length;
  const turn = await controller.handleRequest("turn/start", { threadId, clientTurnRequestId: `t_${bodies.length}`, promptText: "Write the files." }, context);
  await controller.waitForTurnCompletion({ sessionId: threadId, turnId: turn.turn.id });
  const deadline = Date.now() + 30_000;
  while (!["completed", "failed", "aborted"].includes(sessionStore.readTurn(threadId, turn.turn.id).state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const stored = sessionStore.readTurn(threadId, turn.turn.id);
  assert.equal(stored.state, "completed", JSON.stringify(stored.error));
  assert.equal(steps.length, 0);
  const turnBodies = bodies.slice(start);
  assert.equal(answers.length, 0, `every planned prompt appeared: ${JSON.stringify({
    prompts: prompts.map((prompt) => prompt.summary || prompt.refused),
    outputs: turnBodies.slice(1).map((body) => body.input.filter((item) => item.type === "function_call_output").at(-1)?.output.slice(0, 300)),
  })}`);
  return turnBodies;
}
const exists = (name) => fs.existsSync(path.join(workspace, name));

try {
  const turn = await runTurn("read_only", [
    write("a.txt"),
    write("b.txt", { sandbox_permissions: "require_escalated", justification: "Do you want to write b.txt?" }),
    write("c.txt", { sandbox_permissions: "require_escalated", prefix_rule: [process.execPath, "-e"] }),
    write("d.txt"),
    // --eval: not covered by the [node, -e] rule saved above.
    write("e.txt", { sandbox_permissions: "require_escalated" }, "--eval"),
    null,
  ], [
    { decision: "accept" },
    (request) => ({ decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: request.params.proposedExecpolicyAmendment, scope: "project" } } }),
    { decision: "decline" },
  ]);
  const exec = turn[0].tools.find((tool) => tool.name === "exec_command");
  assert.deepEqual(exec.parameters.properties.sandbox_permissions.enum, ["use_default", "require_escalated"], "sandboxed threads get the escalation parameters");
  assert(exec.parameters.properties.prefix_rule && exec.parameters.properties.justification);
  assert.equal(exists("a.txt"), false, "a plain command stays in the Read only sandbox");
  assert.notEqual(lastOutput(turn[1]).exitCode, 0);
  assert.equal(exists("b.txt"), true, "an approved command runs outside the sandbox");
  assert.equal(lastOutput(turn[2]).escalated, true);
  assert.equal(prompts[0].params.reason, "Do you want to write b.txt?");
  assert.equal(prompts[0].params.command, `${process.execPath} -e ${WRITER} b.txt`);
  assert.deepEqual(prompts[0].params.proposedExecpolicyAmendment, [process.execPath, "-e", WRITER, "b.txt"], "without a prefix_rule the whole command is offered");
  assert.deepEqual(prompts[1].params.proposedExecpolicyAmendment, [process.execPath, "-e"], "the model's prefix_rule is offered");
  assert.equal(exists("c.txt"), true);
  assert.equal(exists("d.txt"), true, "a command the saved rule covers runs outside the sandbox without asking");
  assert.equal(lastOutput(turn[4]).escalated, true);
  assert.equal(exists("e.txt"), false, "a declined command doesn't run");
  assert.equal(lastOutput(turn[5]).status, "rejected");
  assert.match(lastOutput(turn[5]).message, /declined/);
  assert.equal(prompts.filter((prompt) => prompt.params).length, 3);
  const saved = controller.approvalRuleStore.commandRulesFor(project.id, process.platform === "win32" ? "windows" : "linux");
  assert.deepEqual(saved.map((rule) => rule.pattern), [[process.execPath, "-e"]]);

  // "For this thread" approves that exact invocation: the same program with
  // differently split arguments (one "g h.txt" vs "g" and "h.txt") asks
  // again. (--eval: not covered by the saved [node, -e] rule.)
  prompts.length = 0;
  const splitWriter = { name: "exec_command", args: { command: process.execPath, args: ["--eval", WRITER, "g", "h.txt"], yield_time_ms: 10_000, sandbox_permissions: "require_escalated" } };
  await runTurn("read_only", [
    write("g h.txt", { sandbox_permissions: "require_escalated" }, "--eval"),
    write("g h.txt", { sandbox_permissions: "require_escalated" }, "--eval"),
    splitWriter,
    null,
  ], [{ decision: "acceptForSession" }, { decision: "decline" }]);
  assert.equal(prompts.filter((prompt) => prompt.params).length, 2, "the repeat ran without asking; the split one asked");
  assert.equal(exists("g h.txt"), true);
  assert.equal(exists("g"), false, "the differently split command was declined");

  // Full access has no sandbox to leave: no escalation parameters.
  prompts.length = 0;
  const full = await runTurn("full_access", [write("f.txt"), null], []);
  assert.equal(full[0].tools.find((tool) => tool.name === "exec_command").parameters.properties.sandbox_permissions, undefined);
  assert.equal(exists("f.txt"), true);
  console.log(JSON.stringify({ ok: true, requests: bodies.length }));
} finally {
  controller.close("regression cleanup");
  await manager.dispose("regression cleanup");
  threadStore.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
