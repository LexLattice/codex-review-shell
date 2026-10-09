#!/usr/bin/env node
// Runs a fixed set of real workflows against the real app through
// direct-drive (test control port, isolated test profile, real provider) and
// checks each outcome: edit and run, a slow command, patch recovery, Stop,
// a question to the owner, paths in a prompt, and a follow-up turn.
//
//   node scripts/direct-live-suite.mjs [--only a,b] [--keep-running] [--json]
//                                      [--model gpt-6-luna] [--effort low]
//
// Runs on the host whose app it drives (Windows Node for the Windows app,
// WSL Node for the Linux app), like direct-drive. Uses the owner's quota:
// luna/low and short prompts by default.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const driveScript = path.join(repoRoot, "scripts", "direct-drive.mjs");
const isWindows = process.platform === "win32";
const SUITE_PROJECT_NAME = "Live suite";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) options[key] = argv[++index];
    else options[key] = true;
  }
  return options;
}
const options = parseArgs(process.argv.slice(2));

function suiteFolder() {
  return isWindows
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "direct-test", "suite")
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "direct-test", "suite");
}

function drive(args, { timeoutMs = 300_000, json = true } = {}) {
  const result = spawnSync(process.execPath, [driveScript, ...args, ...(json ? ["--json"] : [])], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && result.status !== 3) {
    throw new Error(`direct-drive ${args[0]} failed (exit ${result.status}): ${(result.stderr || result.stdout || "").trim().slice(0, 800)}`);
  }
  if (!json) return result.stdout;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`direct-drive ${args[0]} printed no JSON: ${result.stdout.slice(0, 400)}`);
  }
}

const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-live-suite-"));
let promptCount = 0;
function chat(prompt, extra = []) {
  const file = path.join(promptDir, `prompt-${++promptCount}.txt`);
  fs.writeFileSync(file, prompt);
  const modelArgs = [
    ...(options.model ? ["--model", String(options.model)] : []),
    ...(options.effort ? ["--effort", String(options.effort)] : []),
  ];
  return drive(["chat", ...extra, ...modelArgs, "--prompt-file", file, "--text-limit", "4000"]);
}

// Shell-specific commands, so each scenario tells the model exactly what to run.
const shell = isWindows
  ? {
      python: "python",
      slow: "Start-Sleep -Seconds 3; 'waited-ok'",
      counter: "for ($i = 1; $i -le 120; $i++) { Add-Content -Path counter.txt -Value $i; Start-Sleep -Seconds 1 }",
    }
  : {
      python: "python3",
      slow: "sleep 3; echo waited-ok",
      counter: "for i in $(seq 1 120); do echo $i >> counter.txt; sleep 1; done",
    };

const toolNames = (report) => (report.toolCalls || []).map((call) => call.tool);
const failedCalls = (report) => (report.toolCalls || []).filter((call) => call.failure || call.status === "unsupported");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarios = [
  {
    name: "edit_and_run",
    async run(ctx) {
      fs.writeFileSync(path.join(ctx.folder, "hello.py"), 'print("hello")\n');
      const result = chat(`Edit hello.py so it prints "suite ok", then run it with ${shell.python}. Tell me the output.`, ["--project", ctx.projectId]);
      ctx.editThreadId = result.report.threadId;
      const text = fs.readFileSync(path.join(ctx.folder, "hello.py"), "utf8");
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [text.includes("suite ok"), "hello.py prints suite ok"],
        [/suite ok/i.test(result.report.assistant || ""), "reply quotes the output"],
        [failedCalls(result.report).length === 0, "no failed tool calls"],
      ].concat([[true, "", result]]);
    },
  },
  {
    name: "slow_command_one_call",
    async run(ctx) {
      const result = chat(`Run exactly this command and tell me what it printed: ${shell.slow}`, ["--project", ctx.projectId]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [!toolNames(result.report).includes("write_stdin"), "no polling with write_stdin"],
        [/waited-ok/.test(result.report.assistant || ""), "reply has waited-ok"],
        [true, "", result],
      ];
    },
  },
  {
    name: "patch_recovery",
    async run(ctx) {
      fs.writeFileSync(path.join(ctx.folder, "notes.txt"), "title = suite\ncolor = blue\n");
      const result = chat("notes.txt has a line `color = red`. Use apply_patch to change that line to `color = green`. If the patch doesn't apply, look at the file and fix it.", ["--project", ctx.projectId]);
      const text = fs.readFileSync(path.join(ctx.folder, "notes.txt"), "utf8");
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [/color = green/.test(text), "notes.txt has color = green"],
        [toolNames(result.report).includes("apply_patch"), "used apply_patch"],
        [true, "", result],
      ];
    },
  },
  {
    name: "workspace_patch",
    async run(ctx) {
      // Workspace patches are written from inside the sandbox.
      fs.writeFileSync(path.join(ctx.folder, "ws.txt"), "mode = old\n");
      const result = chat("In ws.txt, use apply_patch to change `mode = old` to `mode = new`.", ["--project", ctx.projectId, "--access", "workspace"]);
      const text = fs.readFileSync(path.join(ctx.folder, "ws.txt"), "utf8");
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [toolNames(result.report).includes("apply_patch"), "used apply_patch"],
        [/mode = new/.test(text), "ws.txt changed"],
        [failedCalls(result.report).length === 0, "no failed tool calls"],
        [true, "", result],
      ];
    },
  },
  {
    name: "stop_ends_commands",
    async run(ctx) {
      const counter = path.join(ctx.folder, "counter.txt");
      fs.rmSync(counter, { force: true });
      const result = chat(`Run exactly this command and wait for it to finish: ${shell.counter}`, ["--project", ctx.projectId, "--stop-after-ms", "15000", "--timeout-ms", "90000"]);
      const lines = () => (fs.existsSync(counter) ? fs.readFileSync(counter, "utf8").split(/\r?\n/).filter(Boolean).length : 0);
      const before = lines();
      await sleep(3500);
      const after = lines();
      return [
        [result.stopPressed === true, "Stop pressed"],
        [result.report.state === "aborted", `turn ${result.report.state}`],
        [before > 0, `the command ran (${before} lines)`],
        [after === before, `the command stopped (${before} → ${after} lines)`],
        [true, "", result],
      ];
    },
  },
  {
    name: "question_to_owner",
    async run(ctx) {
      const result = chat("Use request_user_input to ask me whether to proceed (yes or no). Then reply with only my answer, in upper case.", ["--project", ctx.projectId, "--answer", "yes"]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [(result.ownerDecisions || []).some((decision) => decision.decision === "answered"), "the question reached the owner"],
        [/\bYES\b/.test(result.report.assistant || ""), "reply is YES"],
        [true, "", result],
      ];
    },
  },
  {
    name: "permission_request",
    async run(ctx) {
      const target = path.join(ctx.folder, "perm.txt");
      fs.rmSync(target, { force: true });
      const result = chat("Create a file named perm.txt in the project containing the text ok. This thread is Read only, so use request_permissions to ask for Workspace access for this turn first.", ["--project", ctx.projectId, "--access", "read_only", "--answer", "allow_turn"]);
      const thread = drive(["report", "--thread", result.report.threadId]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [toolNames(result.report).includes("request_permissions"), "asked with request_permissions"],
        [fs.existsSync(target) && fs.readFileSync(target, "utf8").includes("ok"), "perm.txt was written after the grant"],
        [thread.thread?.accessProfile === "read_only", `thread back at Read only (${thread.thread?.accessProfile || "?"})`],
        [true, "", result],
      ];
    },
  },
  {
    name: "path_in_prompt",
    async run(ctx) {
      const result = chat(`List the files in ${ctx.folder} and tell me whether hello.py is there.`, ["--project", ctx.projectId]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [/hello\.py/.test(result.report.assistant || ""), "reply mentions hello.py"],
        [true, "", result],
      ];
    },
  },
  {
    name: "remembers_tool_output",
    async run(ctx) {
      const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
      const first = chat(`Run exactly this command and just say done: ${isWindows ? `Write-Output ${token}` : `echo ${token}`}`, ["--project", ctx.projectId]);
      const second = chat("Without running anything, what exactly did that command print?", ["--project", ctx.projectId, "--thread", first.report.threadId]);
      return [
        [first.report.state === "completed" && second.report.state === "completed", `turns ${first.report.state}, ${second.report.state}`],
        [(second.report.toolCalls || []).length === 0, `answered from history (${(second.report.toolCalls || []).length} tool calls)`],
        [(second.report.assistant || "").includes(token), "reply quotes the earlier output"],
        [true, "", second],
      ];
    },
  },
  {
    name: "auto_compaction",
    async run(ctx) {
      // A number that appears only in a command's output; after the history
      // is compacted the model must still know it.
      const first = chat('Run exactly this command and just say done (I will ask about its number later): node -e "console.log(6007*7*3)"', ["--project", ctx.projectId]);
      // Below any real request, so the next turn compacts first.
      drive(["test-settings", "--auto-compact-limit", "1000"]);
      let second;
      try {
        second = chat("Without running anything, what number did that command print?", ["--project", ctx.projectId, "--thread", first.report.threadId]);
      } finally {
        drive(["test-settings", "--auto-compact-limit", "0"]);
      }
      const before = second.report.compaction?.beforeTurn;
      return [
        [first.report.state === "completed" && second.report.state === "completed", `turns ${first.report.state}, ${second.report.state}`],
        [Boolean(before), `history compacted before the turn (${before?.mode || "no"}${before ? `, ${before.tokensBefore} → ${before.tokensAfter} tokens` : ""})`],
        [(second.report.toolCalls || []).length === 0, "answered without a tool call"],
        [/126,?147/.test(second.report.assistant || ""), "reply has 126147"],
        [true, "", second],
      ];
    },
  },
  {
    name: "mcp_tool_call",
    async run(ctx) {
      const result = chat("Use the get_secret_word tool and tell me the word it returns.", ["--project", ctx.mcpProjectId]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [toolNames(result.report).includes("mcp__suite__get_secret_word"), "called the MCP tool"],
        [(result.report.assistant || "").includes(ctx.secretWord), "reply has the secret word"],
        [true, "", result],
      ];
    },
  },
  {
    name: "mcp_form",
    async run(ctx) {
      const result = chat("Call the ask_color tool, then tell me which color the user picked.", ["--project", ctx.mcpProjectId, "--answer", "{\"color\":\"teal\"}"]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [(result.ownerDecisions || []).some((decision) => decision.method === "mcpServer/elicitation/request"), "the server's form reached the owner"],
        [/teal/i.test(result.report.assistant || ""), "reply has the picked color"],
        [true, "", result],
      ];
    },
  },
  {
    name: "mcp_approval",
    async run(ctx) {
      const notes = path.join(ctx.mcpFolder, "notes.log");
      fs.rmSync(notes, { force: true });
      const result = chat("Use the record_note tool to record the note \"suite-note\".", ["--project", ctx.mcpProjectId, "--access", "workspace"]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [(result.ownerDecisions || []).some((decision) => decision.method === "mcpServer/elicitation/request"), "the tool call was put to the owner"],
        [fs.existsSync(notes) && fs.readFileSync(notes, "utf8").includes("suite-note"), "the approved call ran"],
        [true, "", result],
      ];
    },
  },
  {
    name: "exec_escalation",
    async run(ctx) {
      const target = path.join(ctx.folder, "esc.txt");
      fs.rmSync(target, { force: true });
      const command = isWindows ? "Set-Content -Path esc.txt -Value ok" : "echo ok > esc.txt";
      const result = chat(`This thread is Read only. Run exactly this command with exec_command, asking to run it outside the sandbox (sandbox_permissions "require_escalated", with a short justification): ${command}`, ["--project", ctx.projectId, "--access", "read_only"]);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [(result.ownerDecisions || []).some((decision) => decision.method === "item/commandExecution/requestApproval"), "the escalation was put to the owner"],
        [fs.existsSync(target) && fs.readFileSync(target, "utf8").includes("ok"), "esc.txt was written outside the sandbox"],
        [true, "", result],
      ];
    },
  },
  {
    name: "follow_up_turn",
    async run(ctx) {
      if (!ctx.editThreadId) return [[false, "needs edit_and_run first"]];
      const result = chat("Run it again and tell me the output.", ["--project", ctx.projectId, "--thread", ctx.editThreadId]);
      const cached = Number(result.report.totals?.cachedInputTokens || 0);
      return [
        [result.report.state === "completed", `turn ${result.report.state}`],
        [/suite ok/i.test(result.report.assistant || ""), "reply quotes the output"],
        [true, `cached input ${cached} of ${result.report.totals?.inputTokens || 0} tokens`],
        [true, "", result],
      ];
    },
  },
];

// A project with one MCP server (stdio, Direct's own settings): a read-only
// tool, an unannotated one (asks for approval outside Full access), and one
// that asks the owner a form question.
const MCP_PROJECT_NAME = "Live suite MCP";
function mcpSuiteProject(projects) {
  const folder = `${suiteFolder()}-mcp`;
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const secretWord = `word-${Math.random().toString(36).slice(2, 8)}`;
  const script = path.join(folder, "server.js");
  fs.writeFileSync(script, `
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const waiting = new Map();
const text = (id, value) => send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: value }] } });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const q = JSON.parse(line);
  if (!q.method && waiting.has(q.id)) { const done = waiting.get(q.id); waiting.delete(q.id); return done(q.result || {}); }
  if (q.id === undefined) return;
  if (q.method === "initialize") return send({ jsonrpc: "2.0", id: q.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
  if (q.method === "tools/list") return send({ jsonrpc: "2.0", id: q.id, result: { tools: [
    { name: "get_secret_word", description: "Returns today's secret word.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "record_note", description: "Records a note in the project's notes.log.", inputSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } },
    { name: "ask_color", description: "Asks the user to pick a color and returns it.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  ] } });
  if (q.method !== "tools/call") return send({ jsonrpc: "2.0", id: q.id, result: {} });
  const args = q.params.arguments || {};
  if (q.params.name === "get_secret_word") return text(q.id, ${JSON.stringify(secretWord)});
  if (q.params.name === "record_note") { fs.appendFileSync(path.join(${JSON.stringify(folder)}, "notes.log"), String(args.note) + "\\n"); return text(q.id, "recorded"); }
  if (q.params.name === "ask_color") {
    waiting.set("form-" + q.id, (answer) => text(q.id, answer.action === "accept" ? "picked " + answer.content.color : "no color: " + answer.action));
    return send({ jsonrpc: "2.0", id: "form-" + q.id, method: "elicitation/create", params: { mode: "form", message: "Pick a color", requestedSchema: { type: "object", properties: { color: { type: "string" } }, required: ["color"] } } });
  }
  send({ jsonrpc: "2.0", id: q.id, error: { code: -32602, message: "unknown tool" } });
});
`);
  const servers = path.join(promptDir, "mcp-servers.json");
  fs.writeFileSync(servers, JSON.stringify([{
    serverIdentityId: "suite",
    displayName: "suite",
    transport: "stdio",
    command: process.execPath,
    args: [script],
    cwd: folder,
    runsIn: { kind: "project" },
    trustState: "configured",
    enabledState: "enabled",
    freshness: "fresh",
    authPosture: "local_config",
  }]));
  // The definition is the same each run (the script it runs is rewritten).
  const existing = (Array.isArray(projects) ? projects : []).find((candidate) => candidate.name === MCP_PROJECT_NAME && candidate.state !== "archived");
  const project = existing || drive(["project-add", "--name", MCP_PROJECT_NAME, "--path", folder, "--mcp-servers", servers]);
  return { mcpProjectId: project.id, mcpFolder: folder, secretWord };
}

async function main() {
  const only = options.only ? new Set(String(options.only).split(",").map((name) => name.trim())) : null;
  const selected = scenarios.filter((scenario) => !only || only.has(scenario.name));
  if (!selected.length) throw new Error(`no scenario matches --only ${options.only}`);

  const status = drive(["status"]);
  // start's output mixes the Windows mirror sync log with its JSON.
  if (!status.running && !status.auth) drive(["start"], { timeoutMs: 600_000, json: false });

  const folder = suiteFolder();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const projects = drive(["projects"]);
  let project = (Array.isArray(projects) ? projects : []).find((entry) => entry.name === SUITE_PROJECT_NAME && entry.state !== "archived");
  if (!project) project = drive(["project-add", "--name", SUITE_PROJECT_NAME, "--path", folder]);
  const ctx = { projectId: project.id, folder };
  if (selected.some((scenario) => scenario.name.startsWith("mcp_"))) Object.assign(ctx, mcpSuiteProject(projects));

  const results = [];
  for (const scenario of selected) {
    const started = Date.now();
    let checks;
    try {
      checks = await scenario.run(ctx);
    } catch (error) {
      checks = [[false, `error: ${error.message}`]];
    }
    const chatResult = checks.find((check) => check[2])?.[2] || null;
    const shown = checks.filter((check) => check[1]);
    const passed = shown.every(([ok]) => ok);
    const totals = chatResult?.report?.totals || {};
    results.push({
      name: scenario.name,
      passed,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      turnSeconds: chatResult?.report?.durationMs ? Number((chatResult.report.durationMs / 1000).toFixed(1)) : null,
      requests: totals.requests ?? null,
      toolCalls: totals.toolCalls ?? null,
      inputTokens: totals.inputTokens ?? null,
      cachedInputTokens: totals.cachedInputTokens ?? null,
      threadId: chatResult?.report?.threadId || "",
      turnId: chatResult?.report?.turnId || "",
      checks: shown.map(([ok, label]) => ({ ok, label })),
    });
    const row = results.at(-1);
    console.log(`${passed ? "PASS" : "FAIL"} ${scenario.name} · turn ${row.turnSeconds ?? "?"}s · requests ${row.requests ?? "?"} · tools ${row.toolCalls ?? "?"} · in ${row.inputTokens ?? "?"} (cached ${row.cachedInputTokens ?? "?"})`);
    for (const check of row.checks) console.log(`     ${check.ok ? "ok  " : "FAIL"} ${check.label}`);
    if (!passed && row.threadId) console.log(`     inspect: node scripts/direct-drive.mjs report --thread ${row.threadId} --turn ${row.turnId}`);
  }
  const failed = results.filter((row) => !row.passed).length;
  console.log(`${results.length - failed}/${results.length} passed on ${isWindows ? "Windows" : "Linux/WSL"}`);
  if (options.json) console.log(JSON.stringify({ host: isWindows ? "windows" : "linux", results }, null, 2));
  if (!options["keep-running"]) drive(["stop"]);
  fs.rmSync(promptDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}

await main();
